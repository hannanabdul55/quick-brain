/**
 * POST /api/tenants/[id]/chat
 *
 * Accepts { question } JSON body, spawns `gbrain think --model haiku` against
 * the tenant's brain via the per-tenant mutex, and streams the response as a
 * single SSE event. Emits exactly one frame (answer or error), then closes.
 *
 * SSE event format:
 *   event: answer   data: { markdown: string }    — success path
 *   event: error    data: { message: string }      — timeout or non-zero exit
 *
 * HTTP status codes:
 *   200   — SSE stream started (body may contain an error frame)
 *   400   — invalid tenant slug or invalid/missing JSON body
 *   404   — valid slug but tenant not registered
 *   405   — method not allowed (OPTIONS returns 204)
 *
 * Route Handler constraints:
 * - runtime = "nodejs" (NOT "edge") — spawnGBrain uses node:child_process
 * - dynamic = "force-dynamic" — no caching; POST has side-effects
 *
 * CHAT-02: spawns gbrain through the mutex, streams single SSE event.
 * CHAT-05: system-prompt scaffold via buildThinkArgs() (env-var gated).
 * CHAT-06: 30s timeout → SIGKILL → error frame with locked "running slow" message.
 */

import * as tenants from "@/lib/gbrain/tenants";
import { tenantSlugSchema } from "@/lib/gbrain/slug";
import { spawnGBrain } from "@/lib/gbrain/client";
import { sseEventStream } from "@/lib/onboarding/sse";
import { chatQuestionSchema } from "@/lib/chat/schemas";
import { buildThinkArgs } from "@/lib/chat/system-prompt";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Locked timeout message text (CONTEXT.md D-chat-ux / CHAT-06 acceptance criterion).
// Acceptance grep checks for this literal string — do NOT modify.
const TIMEOUT_MESSAGE = "That one's running slow — try again or pick a suggested question";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ── 1. Validate tenant ID ─────────────────────────────────────────────────
  const { id } = await ctx.params;
  const slugResult = tenantSlugSchema.safeParse(id);
  if (!slugResult.success) {
    return Response.json(
      { error: "invalid_tenant_id", message: slugResult.error.issues[0]?.message ?? "invalid slug" },
      { status: 400 },
    );
  }
  const tenantId = slugResult.data;

  // ── 2. Verify tenant exists ───────────────────────────────────────────────
  await tenants.init();
  if (!tenants.get(tenantId)) {
    return Response.json(
      { error: "tenant_not_found", message: `No tenant with id: ${tenantId}` },
      { status: 404 },
    );
  }

  // ── 3. Parse + validate request body ─────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return Response.json({ error: "invalid_json", message: "Request body is not valid JSON" }, { status: 400 });
  }

  const bodyResult = chatQuestionSchema.safeParse(rawBody);
  if (!bodyResult.success) {
    return Response.json(
      { error: "validation_failed", issues: bodyResult.error.issues },
      { status: 400 },
    );
  }
  const { question } = bodyResult.data;

  // ── 4. Build SSE stream and spawn gbrain think ────────────────────────────
  const startMs = Date.now();
  const args = buildThinkArgs(question);

  const stream = sseEventStream(async (write) => {
    try {
      // spawnGBrain routes through the per-tenant mutex (HARN-04).
      // timeoutMs: 30_000 → SIGKILL at 30s → rejects with "timed out" error (CHAT-06).
      const result = await spawnGBrain(args, {
        tenantId,
        timeoutMs: 30_000,
      });

      const durationMs = Date.now() - startMs;
      // Log metadata only — do NOT log the question text (operator privacy).
      console.log("[chat]", { tenantId, questionLen: question.length, exitCode: result.code, durationMs });

      if (result.code !== 0) {
        // gbrain exited non-zero (parse error, model error, etc.) — surface as error frame.
        write("error", {
          message: TIMEOUT_MESSAGE,
          code: result.code,
          stderr: result.stderr.slice(0, 500),
        });
        return;
      }

      write("answer", { markdown: result.stdout.trim() });
    } catch (err: unknown) {
      const durationMs = Date.now() - startMs;
      console.log("[chat:error]", { tenantId, questionLen: question.length, durationMs, err: String(err) });

      // Distinguish timeout/kill from other errors.
      const isTimeout = err instanceof Error && /timeout|killed|SIGKILL/i.test(err.message);
      const message = isTimeout
        ? TIMEOUT_MESSAGE
        : `Brain error: ${err instanceof Error ? err.message : String(err)}`;

      write("error", { message });
    }
  }, req.signal);

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      // Prevents nginx/proxy buffering — important for streaming demos
      "X-Accel-Buffering": "no",
    },
  });
}

// Defensive CORS preflight handler — returns 204 with no body.
export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204 });
}
