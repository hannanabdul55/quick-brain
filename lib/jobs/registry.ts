/**
 * lib/jobs/registry.ts — JobKind-to-JobOperation dispatch table.
 *
 * JOB_REGISTRY maps every known JobKind to its operation implementation.
 * The trigger route validates `kind` via jobRequestSchema, then looks up
 * the operation here. Phase 7 adds "qbo-ingest" to this table.
 *
 * Design mirrors lib/gbrain/onboard.ts (a dispatch table over a Phase enum).
 *
 * Pitfall 6 (RESEARCH): runOnboarding calls tenants.get(tenantId), which
 * reads the in-memory filesystem-scanned registry. On a fresh serverless
 * invocation the registry is populated from the seed tenant only. Phase 5
 * proves the job path with the SEED tenant ("seed", lib/gbrain/paths.ts);
 * per-new-tenant job onboarding is Phase 6.
 */

import type { JobKind, JobOperation } from "./types";
import { runOnboarding } from "@/lib/onboarding/orchestrator";

/**
 * Registry mapping every JobKind to its executable JobOperation.
 *
 * Each operation receives:
 *   params         - validated params from the trigger payload
 *   reportProgress - async DB write; fire-and-forget from sync emit callbacks
 *
 * Returning a value stores it as JSONB in app.jobs.result.
 */
export const JOB_REGISTRY: Record<JobKind, JobOperation> = {
  /**
   * onboarding-import — runs the 5-stage onboarding timeline for a tenant.
   *
   * params.tenantId must be a string that exists in the tenants registry.
   * Phase 5 proves this with the seed tenant only (Pitfall 6 / RESEARCH Open Q1).
   * Per-new-tenant onboarding is Phase 6.
   *
   * Adapter detail: runOnboarding takes a SYNC emit(OnboardingEvent) callback.
   * reportProgress is async (a DB write). The adapter bridges them with
   * void reportProgress(...) — fire-and-forget so the orchestrator's tick
   * loop is never blocked on a Postgres round-trip.
   */
  "onboarding-import": async (params, reportProgress) => {
    const tenantId = params.tenantId as string;

    await runOnboarding(tenantId, (event) => {
      if (event.type === "stage") {
        // Fire-and-forget: do NOT await the DB write inside the sync emit callback.
        // Blocking here would stall the orchestrator's sleep/tick loop.
        // Store the stage ID (e.g. "creating-brain"), NOT the human label.
        // JobProgress matches the stage-checklist on StageItem.id — storing
        // event.label here would never match and pin the checklist at stage 0.
        void reportProgress({
          stage: event.stage,
          percent: Math.round(event.progress * 100),
        }).catch((e) =>
          console.error("[jobs] progress write failed", e),
        );
      }
      // "done" and "error" events are handled by the Inngest function wrapper
      // (finishJob / failJob) — no action needed here.
    });

    return { tenantId };
  },
};
