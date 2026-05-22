/**
 * POST /api/tenants/[id]/chat
 *
 * Accepts { question } JSON body, calls `think()` in-process against the
 * tenant's brain, and streams the response as a single SSE event.
 * Emits exactly one frame (answer or error), then closes.
 *
 * SSE event format:
 *   event: answer   data: { markdown: string }    — success path
 *   event: error    data: { message: string }      — non-zero exit or error
 *
 * HTTP status codes:
 *   200   — SSE stream started (body may contain an error frame)
 *   400   — invalid tenant slug or invalid/missing JSON body
 *   404   — valid slug but tenant not registered
 *   405   — method not allowed (OPTIONS returns 204)
 *
 * Route Handler constraints:
 * - runtime = "nodejs" — gbrain's postgres client requires Node.js runtime
 *   (not edge-compatible). Previously this was required for child_process.spawn;
 *   with in-process gbrain on Postgres the Node.js requirement remains.
 * - dynamic = "force-dynamic" — no caching; POST has side-effects
 *
 * CHAT-02: in-process think() via engine pool, streams single SSE event.
 * CHAT-05: system-prompt scaffold via buildThinkArgs() (env-var gated, retained
 *   for compatibility — see lib/chat/system-prompt.ts comment).
 * CHAT-06: in-process think() completes or errors naturally; no 30s SIGKILL
 *   (subprocess timeout is gone). Phase 5 will add AbortController timeout for
 *   serverless environments.
 *
 * INPROC-04: spawnGBrain removed from the chat request path. think() is
 *   now in-process via lib/gbrain/engine.ts + gbrain/core/think/index.
 */

import * as tenants from "@/lib/gbrain/tenants";
import { tenantSlugSchema } from "@/lib/gbrain/slug";
import { think } from "@/lib/gbrain/client";
import { sseEventStream } from "@/lib/onboarding/sse";
import { chatQuestionSchema } from "@/lib/chat/schemas";

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
  if (!await tenants.getBySlug(tenantId)) {
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

  // ── 4. Build SSE stream and run in-process think ──────────────────────────
  const startMs = Date.now();

  const stream = sseEventStream(async (write) => {
    try {
      // think() runs in-process via the engine pool and per-tenant mutex (INPROC-04).
      // No timeoutMs — in-process think has no subprocess to kill. Phase 5 will add
      // an AbortController-based timeout for Vercel's 10s limit.
      const result = await think(tenantId, question, { model: "haiku" });

      const durationMs = Date.now() - startMs;
      // Log metadata only — do NOT log the question text (operator privacy).
      console.log("[chat]", { tenantId, questionLen: question.length, exitCode: result.code, durationMs });

      if (result.code !== 0) {
        // think() returned code 1 — gbrain error (model error, gather failure, etc.)
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

      // For in-process think, errors come from network issues, DB connection
      // failures, or unexpected throws — surface as error frame.
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
