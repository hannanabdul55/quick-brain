/**
 * POST /api/jobs
 *
 * Validates the request body with zod (jobRequestSchema), inserts a job row
 * in app.jobs (status=queued), sends an Inngest event, and returns the jobId.
 *
 * Responses:
 *   202  { jobId: string }             — job created and dispatched (async work)
 *   400  { error: "validation_failed"; issues: [...] }  — invalid body
 *   502  { error: "dispatch_failed"; jobId: string }    — Inngest send failed;
 *        the job row is marked 'error' so polling surfaces it terminally
 *
 * Security notes:
 *   - T-05-10: zod validates `kind` against the registry enum; unknown kinds
 *     are rejected before any side effect. `params` is validated as a record.
 *   - T-05-12: console.log records only `kind` and `jobId` — never `params`
 *     (params may carry PII; mirrors tenants/route.ts log-only-slug precedent).
 *   - T-05-09 (accept): This route is unauthenticated pre-Phase-6. Inngest free
 *     tier caps at 50k executions/month; retries:1 caps per-job executions.
 *     Phase 6 (AUTH-06) gates this route behind a session.
 */

// Prevent Next.js static optimization — this route has side effects.
export const dynamic = "force-dynamic";
// nodejs runtime: lib/jobs/store.ts imports postgres, which is not edge-compatible.
export const runtime = "nodejs";

import { inngest } from "@/lib/inngest/client";
import { createJob, failJob } from "@/lib/jobs/store";
import { jobRequestSchema } from "@/lib/jobs/schemas";

export async function POST(req: Request): Promise<Response> {
  // ── 1. Parse JSON body ────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      {
        error: "validation_failed",
        issues: [{ message: "invalid JSON body" }],
      },
      { status: 400 },
    );
  }

  // ── 2. Zod validation ─────────────────────────────────────────────────────
  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // ── 3. Create job row (status=queued) + dispatch Inngest event ────────────
  const jobId = await createJob(parsed.data.kind, parsed.data.params);

  // If inngest.send() throws (network failure, missing INNGEST_EVENT_KEY,
  // Inngest outage) the job row would otherwise be stranded forever in
  // 'queued' with no consumer and no error surface. Mark it failed so the
  // status route reports `error` (the poll hook handles `error` terminally)
  // and return 502 so the client knows dispatch — not the job — failed.
  try {
    await inngest.send({
      name: "app/job.requested",
      data: {
        jobId,
        kind: parsed.data.kind,
        params: parsed.data.params,
      },
    });
  } catch (err) {
    await failJob(jobId, "Failed to dispatch background job. Please retry.");
    // Log only kind + jobId — never params (T-05-12: params may contain PII)
    console.error(
      `[jobs] dispatch failed kind=${parsed.data.kind} jobId=${jobId}`,
      err,
    );
    return Response.json({ error: "dispatch_failed", jobId }, { status: 502 });
  }

  // Log only kind + jobId — never params (T-05-12: params may contain PII)
  console.log(`[jobs] dispatched kind=${parsed.data.kind} jobId=${jobId}`);

  // ── 4. Return 202 Accepted — the work is async ────────────────────────────
  return Response.json({ jobId }, { status: 202 });
}
