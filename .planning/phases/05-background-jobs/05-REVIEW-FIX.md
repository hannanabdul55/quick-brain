---
phase: 05-background-jobs
fixed_at: 2026-05-21T00:00:00Z
review_path: .planning/phases/05-background-jobs/05-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-05-21
**Source review:** .planning/phases/05-background-jobs/05-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 9 (2 Critical, 7 Warning)
- Fixed: 9
- Skipped: 0

All Critical and Warning findings were fixed and verified. Full project
typecheck (`bunx tsc --noEmit` with node_modules linked) passes clean.

## Fixed Issues

### CR-01: Stage checklist never advances — registry stores label, component matches on id

**Files modified:** `lib/jobs/registry.ts`
**Commit:** 7f290bb
**Applied fix:** Changed the `reportProgress` call in the `onboarding-import`
operation to store `event.stage` (the stage ID, e.g. `"creating-brain"`)
instead of `event.label` (the human string). Confirmed against
`lib/onboarding/orchestrator.ts` that `OnboardingEvent` carries both a `stage`
ID field and a `label` field, and against `components/jobs/job-progress.tsx`
that the stage-checklist matches entries by `StageItem.id`. Storing the ID
makes `findIndex((s) => s.id === stage)` resolve, so the checklist advances and
`JobProgress` derives the correct display label. **Requires human verification:**
this is a correctness/logic fix — confirm the checklist advances end-to-end
against a real onboarding run before the phase proceeds.

### CR-02: `inngest.send()` failure orphans a queued job with no error surface

**Files modified:** `app/api/jobs/route.ts`
**Commit:** 0be35e3
**Applied fix:** Wrapped `inngest.send()` in a try/catch. On failure the route
now calls `failJob(jobId, ...)` to mark the row `status='error'` (so the poll
hook handles it terminally), logs the error (kind + jobId only, never params,
per T-05-12), and returns `502 { error: "dispatch_failed", jobId }`. Imported
`failJob` from the store and documented the new 502 response in the route
header comment.

### WR-01: `store.ts` casts a possibly-undefined env var to `string`

**Files modified:** `lib/jobs/store.ts`
**Commit:** d62d22f
**Applied fix:** Replaced the `as string` cast with an explicit guard:
resolve `GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER` into a `databaseUrl`
const and `throw new Error(...)` if it is falsy, before constructing the
postgres client. Matches the existing guard in `scripts/setup-jobs-table.ts`.

### WR-02: Status route response shape contradicts `JobStatusResponse`

**Files modified:** `app/api/jobs/[id]/route.ts`
**Commit:** d1a29de
**Applied fix:** Tightened the route projection so it satisfies the documented
`JobStatusResponse` contract. `progress` is forwarded raw (always a number per
the `NOT NULL DEFAULT 0` DDL, which satisfies `number | null`). For an errored
job whose `error` column is `NULL`, the route now sends a generic fallback
message (`"The job failed. Please retry."`) instead of `error: null`, so the
UI never renders a blank error card. Updated the route header comment.

### WR-03: Poll hook only stops on `done`/`error` — a stuck `queued` job polls 5 minutes

**Files modified:** `lib/jobs/use-job-status.ts`
**Commit:** 4194666
**Applied fix:** Added `MAX_QUEUED_POLL_ATTEMPTS = 15` (~30s). The data handler
now triggers the `timed-out` give-up early if a job is still `queued` after
that many attempts — a job that has not started running by then is almost
certainly a dispatch failure. CR-02's fix already addresses the primary
dispatch-failure case; this is the review's recommended secondary signal.

### WR-04: `restart()` does not reset `status`/`progress`/`stage` — stale state flashes on retry

**Files modified:** `lib/jobs/use-job-status.ts`
**Commit:** 00cc0c3
**Applied fix:** Extracted a `resetState()` `useCallback` that clears the full
state set (`status`, `progress`, `stage`, `result`, `error`, `isSlow`) and
called it from both the `jobId`-change `useEffect` and `restart()`. Previously
`restart()` reset only `error`/`isSlow`, leaving stale percent/stage visible
until the first new poll response arrived.

### WR-05: Poll hook treats every non-404 non-ok response as a transient blip

**Files modified:** `lib/jobs/use-job-status.ts`
**Commit:** abbde54
**Applied fix:** Added a `serverErrorStreakRef` counter and a
`MAX_CONSECUTIVE_SERVER_ERRORS = 5` threshold. The fetch handler now branches
on `res.status >= 500`: it increments the streak and, once 5 consecutive 5xx
responses have arrived (~10s), surfaces a terminal error state instead of
polling silently for ~5 minutes. Any ok or 404 response resets the streak;
`startPolling` also resets it on (re)arm.

### WR-06: `failJob(jobId, String(err))` can lose the real error message

**Files modified:** `lib/inngest/functions.ts`
**Commit:** 3564d5b
**Applied fix:** Changed `runJob`'s catch to extract
`err instanceof Error ? (err.stack ?? err.message) : String(err)` before
passing to `failJob`, instead of `String(err)` (which yields
`"[object Object]"`/`"undefined"` for non-Error throws). `failJob` already
truncates to 500 chars and strips `postgres://` URLs, so passing the stack is
safe. Mirrors the existing pattern in `orchestrator.ts`.

### WR-07: `updateProgress` fire-and-forget rejections are completely unobserved

**Files modified:** `lib/jobs/registry.ts`
**Commit:** 7f290bb
**Applied fix:** Attached a `.catch((e) => console.error(...))` to the
fire-and-forget `reportProgress(...)` call so a failed progress write is logged
rather than producing an unhandled promise rejection. This change modifies the
exact same statement as CR-01, so it was committed atomically in the same
commit (`7f290bb`) — splitting it into a separate commit was not possible
without an artificial intermediate state.

---

_Fixed: 2026-05-21_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
