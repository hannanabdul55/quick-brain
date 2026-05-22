/**
 * GET /api/jobs/[id]
 *
 * Status polling endpoint. The browser polls this route every ~2s while a
 * background job is running, stopping once status reaches "done" or "error".
 *
 * Responses:
 *   200  { status, progress, stage, result?, error? }  — job found
 *   404  { error: "job_not_found", message }           — no job with that id
 *
 * Response projection (T-05-11 / RESEARCH Security V7):
 *   Only browser-safe fields are returned. `params`, `created_at`, `updated_at`,
 *   and raw DB columns are never included. `result` is only present when
 *   status === "done" (small structured payload, e.g. { tenantId }). `error` is
 *   only present when status === "error" (already sanitized by failJob — sliced
 *   to 500 chars, postgres:// URLs stripped). No stack traces or DB internals
 *   reach the browser.
 *
 * `jobId` is a gen_random_uuid() (122-bit) — not guessable, acts as a
 * capability token pre-auth. Phase 6 adds per-user scoping (V4).
 */

// Prevent Next.js static optimization — reads live DB state.
export const dynamic = "force-dynamic";
// nodejs runtime: lib/jobs/store.ts imports postgres, which is not edge-compatible.
export const runtime = "nodejs";

import { getJob } from "@/lib/jobs/store";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Next.js 15: params is a Promise — must be awaited
  const { id } = await ctx.params;

  const job = await getJob(id);
  if (!job) {
    return Response.json(
      { error: "job_not_found", message: "No job with id: " + id },
      { status: 404 },
    );
  }

  // Project only browser-safe fields — never return params, created_at, updated_at
  return Response.json({
    status: job.status,
    progress: job.progress,
    stage: job.stage,
    result: job.status === "done" ? job.result : undefined,
    error: job.status === "error" ? job.error : undefined,
  });
}
