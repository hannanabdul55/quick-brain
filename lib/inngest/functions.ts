/**
 * lib/inngest/functions.ts — The one generic Inngest function (JOBS-01, D-05).
 *
 * runJob reacts to any "app/job.requested" event, looks up the operation in
 * JOB_REGISTRY, runs it with a progress callback, and writes job lifecycle
 * state to app.jobs throughout.
 *
 * Design decisions:
 *   - retries: 1 — gbrain import / runOnboarding is NOT idempotent; retrying
 *     from scratch can double-import (RESEARCH Pitfall 3). Keep it low.
 *   - Three step.run boundaries: mark-running, execute, mark-done/mark-error.
 *     These are the only meaningful checkpoints.
 *   - updateProgress is NOT inside a step.run — steps are memoized and
 *     replayed on every re-invocation. A progress write is a transient
 *     side-effect, not a checkpoint. Plain awaits inside the operation.
 *   - catch re-throws after failJob so Inngest records the failure in its
 *     own run history (mirrors orchestrator.ts one-try/catch-with-terminal-
 *     events shape).
 *
 * Inngest v4 createFunction API: 2 arguments — options (includes triggers)
 * and the handler. The 3-argument form is v3 syntax.
 *
 * Phase 7 adds "qbo-ingest" to JOB_REGISTRY only — no changes here.
 */

import { inngest } from "./client";
import { JOB_REGISTRY } from "@/lib/jobs/registry";
import {
  setRunning,
  updateProgress,
  finishJob,
  failJob,
} from "@/lib/jobs/store";

export const runJob = inngest.createFunction(
  {
    id: "run-job",
    retries: 1, // keep low — gbrain import is NOT idempotent (RESEARCH Pitfall 3)
    triggers: [{ event: "app/job.requested" }],
  },
  async ({ event, step }) => {
    const { jobId, kind, params } = event.data as {
      jobId: string;
      kind: keyof typeof JOB_REGISTRY;
      params: Record<string, unknown>;
    };

    // ── Step 1: mark the job row as running ───────────────────────────────────
    await step.run("mark-running", () => setRunning(jobId));

    // ── Step 2: execute the registered operation ──────────────────────────────
    // updateProgress writes happen INSIDE the operation as plain awaits —
    // NOT wrapped in step.run (steps are memoized; progress writes are
    // transient side-effects that must not be replayed).
    try {
      const result = await step.run("execute", async () => {
        const op = JOB_REGISTRY[kind];
        return op(params, (p) => updateProgress(jobId, p));
      });

      // ── Step 3a: mark done ────────────────────────────────────────────────
      await step.run("mark-done", () => finishJob(jobId, result));
    } catch (err: unknown) {
      // ── Step 3b: mark error, then re-throw so Inngest records the failure ──
      // Extract the real message/stack — String(err) on a non-Error throw
      // (object, undefined) yields "[object Object]"/"undefined". failJob
      // already truncates to 500 chars and strips postgres:// URLs, so
      // passing the stack is safe and more diagnostic. Mirrors orchestrator.ts.
      const message =
        err instanceof Error ? (err.stack ?? err.message) : String(err);
      await step.run("mark-error", () => failJob(jobId, message));
      throw err;
    }
  },
);
