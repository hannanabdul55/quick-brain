/**
 * POST /api/tenants/[id]/chat
 *
 * Accepts { question } JSON body, calls `think()` in-process against the
 * authenticated user's brain, and streams the response as a single SSE event.
 * Emits exactly one frame (answer or error), then closes.
 *
 * SSE event format:
 *   event: answer   data: { markdown: string }    — success path
 *   event: error    data: { message: string }      — non-zero exit or error
 *
 * HTTP status codes:
 *   200   — SSE stream started (body may contain an error frame)
 *   400   — invalid JSON body
 *   401   — unauthenticated (no valid session cookie)
 *   403   — URL slug does not match the session-resolved brain slug
 *   405   — method not allowed (OPTIONS returns 204)
 *
 * Route Handler constraints:
 * - runtime = "nodejs" — gbrain's postgres client requires Node.js runtime
 *   (not edge-compatible).
 * - dynamic = "force-dynamic" — no caching; POST has side-effects
 *
 * AUTH-05 (D-11): identity is resolved from the verified session cookie via
 * resolveTenant(). The URL [id] slug is NEVER trusted for identity — it is
 * only used for optional slug-mismatch guard. The session-derived sourceId is
 * passed to think() so the gbrain query is hard-scoped to this user's brain
 * (D-12 patch applies the scope through runThink → runGather → hybridSearch).
 *
 * CHAT-02: in-process think() via engine pool, streams single SSE event.
 * CHAT-06: in-process think() completes or errors naturally; no SIGKILL.
 * INPROC-04: spawnGBrain removed from the chat request path.
 */

import { resolveTenant } from "@/lib/auth/resolve-tenant";
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
  // ── 1. Resolve identity from the session (D-11 / AUTH-05) ─────────────────
  // The session cookie — not the URL slug — is the authoritative identity source.
  // Returning 401 before the SSE stream opens is correct defense-in-depth
  // (middleware already gates unauthenticated requests, but routes must not trust that).
  const tenantCtx = await resolveTenant();
  if (!tenantCtx.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sourceId, brainSlug } = tenantCtx;

  // ── 2. Optional slug mismatch guard ──────────────────────────────────────
  // Identity is taken from the session regardless. If the URL slug does not match
  // the session-resolved brain slug, return 403. (An attacker naming another
  // user's slug would fail here — T-06-23.)
  const { id } = await ctx.params;
  if (id !== brainSlug) {
    return Response.json({ error: "forbidden" }, { status: 403 });
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
      // think() runs in-process via the shared engine pool (T-06-25 fixed: single
      // shared engine, no per-user connection accumulation). The session-derived
      // sourceId scopes this query to the authenticated user's brain only (D-12,
      // AUTH-05, T-06-22). No other user's pages are reachable from this call.
      const result = await think(brainSlug, question, { model: "haiku", sourceId });

      const durationMs = Date.now() - startMs;
      // Log metadata only — do NOT log the question text (operator privacy).
      console.log("[chat]", { brainSlug, questionLen: question.length, exitCode: result.code, durationMs });

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
      console.log("[chat:error]", { brainSlug, questionLen: question.length, durationMs, err: String(err) });

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
