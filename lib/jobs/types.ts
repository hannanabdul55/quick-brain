/**
 * lib/jobs/types.ts — Generic job contract.
 *
 * JobKind is a literal union of all supported job kinds.
 * Phase 7 adds "qbo-ingest" here when that connector ships.
 *
 * JobOperation is the single function shape every job kind implements.
 * It receives untyped params (validated by jobRequestSchema before dispatch)
 * and an async reportProgress callback the operation calls to push progress
 * rows into the Supabase jobs table.
 *
 * Design mirrors the OnboardingEvent discriminated-union in
 * lib/onboarding/orchestrator.ts and the Phase literal-union in
 * lib/gbrain/onboard.ts — consistent codebase style.
 */

// ---------------------------------------------------------------------------
// JobKind — all known job types (one per registered operation)
// Phase 7 adds: "qbo-ingest"
// ---------------------------------------------------------------------------
export type JobKind = "onboarding-import";

// ---------------------------------------------------------------------------
// JobStatus — lifecycle states of a job row
// ---------------------------------------------------------------------------
export type JobStatus = "queued" | "running" | "done" | "error";

// ---------------------------------------------------------------------------
// JobProgress — the progress snapshot written to app.jobs per tick
// ---------------------------------------------------------------------------
export interface JobProgress {
  /** Human-readable stage label, e.g. "Reading your invoices and emails" */
  stage: string;
  /** 0..100 integer percent complete */
  percent: number;
}

// ---------------------------------------------------------------------------
// JobOperation — the function shape every JobKind must implement
//
// params: untyped record; each operation casts the fields it needs.
//   Validated by jobRequestSchema at the trigger route before dispatch.
//
// reportProgress: async DB write; the operation calls it on significant
//   milestones. Callers MUST NOT block the main async loop waiting for this
//   — fire-and-forget or void-await if called from a sync emit callback.
//
// Returns: an arbitrary result stored as JSONB in app.jobs.result.
// ---------------------------------------------------------------------------
export type JobOperation = (
  params: Record<string, unknown>,
  reportProgress: (p: JobProgress) => Promise<void>,
) => Promise<unknown>;
