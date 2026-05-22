---
phase: 05-background-jobs
reviewed: 2026-05-21T00:00:00Z
depth: standard
files_reviewed: 19
files_reviewed_list:
  - .env.example
  - app/api/inngest/route.ts
  - app/api/jobs/[id]/route.ts
  - app/api/jobs/route.ts
  - components/jobs/job-progress.tsx
  - docs/phase-5-jobs-table.md
  - docs/phase-5-latency-threshold.md
  - lib/inngest/client.ts
  - lib/inngest/functions.ts
  - lib/jobs/registry.ts
  - lib/jobs/schemas.ts
  - lib/jobs/store.ts
  - lib/jobs/types.ts
  - lib/jobs/use-job-status.ts
  - package.json
  - scripts/bench-gbrain.ts
  - scripts/setup-jobs-table.ts
  - tests/unit/jobs/job-contract.test.ts
  - tests/unit/jobs/store.test.ts
findings:
  critical: 2
  warning: 7
  info: 5
  total: 14
status: issues_found
---

# Phase 5: Code Review Report

**Reviewed:** 2026-05-21
**Depth:** standard
**Files Reviewed:** 19
**Status:** issues_found

## Summary

Phase 5 builds a generic Inngest-backed background-job runner: an Inngest serve route, a single
`runJob` function, a POST trigger + GET status route, a Supabase Postgres job store, and a
browser-side poll hook with a JobProgress component. The security spine is mostly sound — zod
validation on the trigger, parameterized SQL throughout, error sanitization in `failJob`, a
narrowed response projection in the status route, and a bounded poll loop.

However, two correctness defects break the feature's core promise. The stage-checklist will never
advance because the registry stores the stage *label* while the component matches on the stage
*ID* — every job appears stuck at stage 0. And the status route's response projection contradicts
the `JobStatusResponse` type the hook expects: the route omits `result`/`error` keys when not in
a terminal state, but more importantly it can return `status` values the hook's `done`/`error`
branches will mis-handle when `progress` is absent. There are also several robustness gaps around
unvalidated env vars, an uncaught `inngest.send()` failure path, and a poll-hook closure staleness
bug. None of the security-labelled threats (T-05-05 through T-05-14) are violated, but the
feature does not function correctly as built.

## Critical Issues

### CR-01: Stage checklist never advances — registry stores label, component matches on id

**File:** `lib/jobs/registry.ts:50-51`, `components/jobs/job-progress.tsx:77`
**Issue:**
The onboarding orchestrator emits `OnboardingEvent` objects where `event.stage` is the stage
**ID** (`"creating-brain"`, `"reading-invoices"`, …) and `event.label` is the human-readable
string (`"Creating your brain"`, …). See `lib/onboarding/orchestrator.ts:28-50` and the
`STAGE_DEFS` table.

The registry adapter stores the **label**, not the ID:

```ts
void reportProgress({
  stage: event.label,            // "Creating your brain"  ← label, not id
  percent: Math.round(event.progress * 100),
});
```

That label flows through `updateProgress` → `app.jobs.stage` → the status route → the poll hook →
`JobProgress`. The component then resolves the current stage by **ID**:

```ts
const idx = allStages.findIndex((s) => s.id === stage);   // s.id === "creating-brain"
return idx === -1 ? 0 : idx;                              // stage === "Creating your brain" → -1 → 0
```

`DEFAULT_STAGES` entries have `id: "creating-brain"` / `label: "Creating your brain"`. Because
`stage` is the label, `findIndex` never matches, `idx === -1`, and `currentStageIndex` is pinned
to `0` for the entire run. The checklist shows stage 1 spinning forever and stages 2–5 pending —
even though the job is progressing. The `activeTitle` derivation at `job-progress.tsx:84-85` is
*accidentally* correct (it does `allStages.find((s) => s.id === stage)?.label ?? "Working on it…"`,
which also fails to match and falls back to `"Working on it…"`), so the title is also wrong.

This breaks the stated UI contract ("Visually identical to OnboardingProgress … same stage-checklist
tri-state").

**Fix:** Store the stage ID, not the label, so it round-trips to the component's `s.id`:

```ts
void reportProgress({
  stage: event.stage,            // "creating-brain" — matches StageItem.id
  percent: Math.round(event.progress * 100),
});
```

`JobProgress` already derives the display label from the ID via `allStages.find((s) => s.id === stage)?.label`,
so storing the ID fixes both the checklist and the title. If the DB column is intended to hold a
human label for other consumers, then instead change the component to match on label — but pick
one contract and make registry, store, route, hook, and component agree. (Add a unit test that
feeds a real orchestrator `event.stage` value through and asserts `findIndex` resolves.)

### CR-02: `inngest.send()` failure orphans a queued job with no error surface

**File:** `app/api/jobs/route.ts:55-70`
**Issue:**
The POST handler runs `createJob(...)` (inserts a row with `status='queued'`), then `await
inngest.send(...)`, then returns `202 { jobId }`. If `inngest.send()` throws — network failure,
invalid/missing `INNGEST_EVENT_KEY` in production, Inngest outage — the exception is **unhandled**.
Next.js converts it to a generic `500`, and:

1. The browser never receives `jobId`, so it cannot poll.
2. The `app.jobs` row is permanently stranded in `status='queued'` — no Inngest function will
   ever pick it up, and there is no reaper or TTL.
3. Worse: if a client *did* obtain the `jobId` some other way, the poll hook would poll a
   forever-`queued` job until it hits `MAX_POLL_ATTEMPTS` (~5 min) and shows "taking longer than
   expected" — masking a hard dispatch failure as a slow job.

The route comment claims "job created and dispatched" for the 202, but dispatch is not guaranteed
when it returns. There is also a narrower TOCTOU window: the row exists before the event is sent,
so a `getJob` between the two awaits sees a queued job that may never run.

**Fix:** Wrap `inngest.send()` in try/catch. On failure, either mark the row failed via `failJob`
so the status route reports `error` (preferred — the poll hook already handles `error` terminally),
or delete the row, and return a `502`/`503` so the client knows dispatch failed:

```ts
const jobId = await createJob(parsed.data.kind, parsed.data.params);
try {
  await inngest.send({
    name: "app/job.requested",
    data: { jobId, kind: parsed.data.kind, params: parsed.data.params },
  });
} catch (err) {
  await failJob(jobId, "Failed to dispatch background job. Please retry.");
  console.error(`[jobs] dispatch failed jobId=${jobId}`, err);
  return Response.json(
    { error: "dispatch_failed", jobId },
    { status: 502 },
  );
}
```

## Warnings

### WR-01: `store.ts` casts a possibly-undefined env var to `string` — silent NaN/crash

**File:** `lib/jobs/store.ts:31-38`
**Issue:**
The module-level singleton does:

```ts
const sql = postgres(
  (process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER) as string,
  { prepare: false },
);
```

If neither env var is set, the expression is `undefined`, and the `as string` cast silently lies
to the type system. `postgres(undefined, ...)` does not fail at import time — it lazily attempts a
connection on first query and produces an opaque error deep inside the `postgres` driver, far from
the actual cause (missing config). `scripts/setup-jobs-table.ts:35-40` correctly guards this exact
same fallback chain with an explicit `if (!database_url) { console.error(...); process.exit(1); }`.
The store module should match.

**Fix:** Validate before constructing the client:

```ts
const databaseUrl = process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
if (!databaseUrl) {
  throw new Error(
    "lib/jobs/store.ts: GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set",
  );
}
const sql = postgres(databaseUrl, { prepare: false });
```

### WR-02: Status route response shape contradicts the `JobStatusResponse` type the hook expects

**File:** `app/api/jobs/[id]/route.ts:46-52`, `lib/jobs/use-job-status.ts:21-28`
**Issue:**
The hook declares the response contract as:

```ts
export interface JobStatusResponse {
  status: JobStatus;        // non-nullable
  progress: number | null;
  stage: string | null;
  result?: unknown;
  error?: string;
}
```

The route returns:

```ts
return Response.json({
  status: job.status,
  progress: job.progress,                                  // always a number (DB default 0)
  stage: job.stage,                                        // string | null
  result: job.status === "done" ? job.result : undefined,  // key present, value undefined
  error: job.status === "error" ? job.error : undefined,
});
```

Two mismatches:
1. `JSON.stringify` **drops** keys whose value is `undefined`, so the wire payload has no `result`
   key for a running job — consistent with the optional `?` typing, fine. But for a *done* job
   where `job.result` is SQL `NULL` (e.g. an operation that returns `undefined`), `result` is
   `null` on the wire and the hook does `setResult(data.result ?? null)` — also fine. No bug here,
   but the projection's intent ("`result` only present when done") is partially defeated by JSON
   serialization rules, not by code. Document or assert it.
2. The real defect: `JobRow.error` is typed `string | null`, and the route forwards
   `job.status === "error" ? job.error : undefined`. If a job is in `status='error'` but `error`
   is `NULL` in the DB (possible if a future code path sets status without calling `failJob`), the
   route sends `error: null`. The hook's `setError(data.error ?? null)` handles `null`, but
   `JobProgress` then renders the error card with **no** secondary message and the user sees only
   the generic banner. Minor, but the projection should be defensive.

More importantly, the route's `progress` is forwarded raw. `app.jobs.progress` is `NOT NULL DEFAULT 0`,
so it is always a number — yet `JobStatusResponse.progress` is `number | null` and the hook treats
`null` as a valid state. The contract is looser than reality on one side and stricter on the other.

**Fix:** Tighten the route to return exactly the documented shape and make the hook's type match.
Either make `progress` non-nullable everywhere, or have the route explicitly emit `progress ?? null`.
Pick one and align the route, the `JobStatusResponse` interface, and the `JobProgress`
`typeof progress === "number"` guards. Add a contract test that round-trips a `JobRow` through the
route projection and asserts it satisfies `JobStatusResponse`.

### WR-03: Poll hook only stops on `status==='done'`/`'error'` — a stuck `queued` job polls 5 minutes

**File:** `lib/jobs/use-job-status.ts:88-148`
**Issue:**
The interval callback stops polling only on `MAX_POLL_ATTEMPTS`, HTTP 404, `status==='done'`, or
`status==='error'`. A job that Inngest never picks up (see CR-02) or that crashes between
`setRunning` and `finishJob`/`failJob` stays `queued`/`running` forever. The hook will poll 150
times over ~5 minutes and only then surface `timed-out`. That is the intended soft-timeout, so it
is not strictly a bug — but combined with CR-02 (dispatch failures leave rows `queued`), the user
waits a full 5 minutes on what is actually an instant, hard failure. The "slow-but-healthy"
detector also only triggers for `status === 'running'` (`use-job-status.ts:129`), so a stuck
`queued` job shows neither the slow message nor a faster give-up.

**Fix:** This is acceptable as a fallback but should not be the *only* signal. Once CR-02 marks
dispatch failures as `error`, the hook stops promptly. Separately, consider a shorter give-up for
jobs still `queued` after N attempts (a job that has not even started running after ~30s is
almost certainly a dispatch failure).

### WR-04: `restart()` does not reset `status`/`progress`/`stage` — stale state flashes on retry

**File:** `lib/jobs/use-job-status.ts:177-183`
**Issue:**
The `useEffect` arming path (`jobId` change) carefully resets every piece of state:
`setStatus(null)`, `setProgress(null)`, `setStage(null)`, `setResult(undefined)`, `setError(null)`,
`setIsSlow(false)`. But `restart()` resets only `error` and `isSlow`:

```ts
const restart = useCallback(() => {
  if (!jobId) return;
  clearPollInterval();
  setError(null);
  setIsSlow(false);
  startPolling(jobId);
}, [jobId, clearPollInterval, startPolling]);
```

After a `timed-out` give-up, the user clicks "Check again". `restart()` runs, but `status`,
`progress`, and `stage` still hold the last-seen values. Until the first poll response of the new
loop arrives (up to `POLL_INTERVAL_MS` = 2s), `JobProgress` renders the stale percent and stale
stage. If the previous run ended on a partial `running`/`60%`, the UI flashes 60% then re-derives.
Worse, if `restart()` is called from the error card and the new poll's first response is also an
error, `setStatus` was never cleared so there is a window where the component is consistent only
by luck.

**Fix:** Make `restart()` reset the full state set, identical to the `useEffect` path. Extract a
`resetState()` helper and call it from both:

```ts
const resetState = useCallback(() => {
  setStatus(null);
  setProgress(null);
  setStage(null);
  setResult(undefined);
  setError(null);
  setIsSlow(false);
}, []);
```

### WR-05: Poll hook treats every non-404 non-ok response as a transient blip — silent error masking

**File:** `lib/jobs/use-job-status.ts:99-110`
**Issue:**
The fetch handler:

```ts
if (!res.ok) {
  if (res.status === 404) { /* terminal error */ }
  // Other non-ok responses: keep polling (transient network blip)
  return null;
}
```

A `500` from the status route (e.g. `getJob` throws because the DB connection is down — see WR-01)
is silently swallowed and treated identically to a momentary `502` from a CDN. The loop keeps
polling for the full ~5 minutes. A genuine server-side failure is indistinguishable from a blip.
At minimum a `500` indicates the *server* is broken, not the job, and the user gets no signal for
5 minutes.

**Fix:** Distinguish persistent server errors from transient ones. Track consecutive non-ok
responses; after, say, 3–5 consecutive `5xx` responses, stop and surface an error state. A single
`500` could still be transient, but five in a row over 10s is a real outage.

### WR-06: `failJob(jobId, String(err))` can lose the real error message

**File:** `lib/inngest/functions.ts:65`
**Issue:**
`runJob`'s catch does `failJob(jobId, String(err))`. If `err` is an `Error`, `String(err)` yields
`"Error: tenant not found"` — acceptable. But if the operation throws a non-Error (a rejected
promise with an object, a string, `undefined`), `String(err)` produces `"[object Object]"` or
`"undefined"`, and that uninformative string is what `failJob` sanitizes and stores. The user's
error card then shows `"[object Object]"` as the secondary line. The orchestrator itself does the
right thing (`err instanceof Error ? err.message : String(err)` at `orchestrator.ts:218`); `runJob`
should match.

**Fix:**
```ts
const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
await step.run("mark-error", () => failJob(jobId, message));
```
`failJob` already truncates to 500 chars and strips `postgres://` URLs, so passing the stack is
safe and gives more diagnostic value.

### WR-07: `updateProgress` fire-and-forget rejections are completely unobserved

**File:** `lib/jobs/registry.ts:49-52`, `lib/inngest/functions.ts:56-59`
**Issue:**
The registry adapter intentionally fire-and-forgets the progress DB write: `void reportProgress({...})`.
The rationale (don't block the orchestrator's sync emit/tick loop) is sound. But `void` on a
rejecting promise means a failed progress write produces an **unhandled promise rejection** with no
`.catch`. In Node this logs a noisy unhandled-rejection warning (and on some configs can crash the
process); inside an Inngest serverless function it is simply lost. Either way, a transient DB hiccup
during a progress tick is invisible. It will not fail the job (correct), but it is silently dropped
rather than logged.

**Fix:** Attach a `.catch` that swallows-but-logs, so the fire-and-forget is explicit and observable:

```ts
void reportProgress({
  stage: event.stage,
  percent: Math.round(event.progress * 100),
}).catch((e) => console.error(`[jobs] progress write failed jobId`, e));
```

## Info

### IN-01: `lib/inngest/functions.ts` casts `event.data` instead of validating it

**File:** `lib/inngest/functions.ts:42-46`
**Issue:** `runJob` does `const { jobId, kind, params } = event.data as { … }`. The trigger route
validates the payload with zod before `inngest.send`, so in-system this is safe. But `runJob`
reacts to *any* `app/job.requested` event — including ones replayed from Inngest history or sent by
a future second producer. An unknown `kind` would make `JOB_REGISTRY[kind]` `undefined`, and
`op(params, ...)` throws `TypeError: op is not a function`, which the catch turns into a `failJob`.
That degrades gracefully, but a defensive `jobRequestSchema.parse(event.data)` (reusing the existing
schema) at the top of the handler would fail fast with a clear message and guard the registry lookup.

**Fix:** Re-validate `event.data` with `jobRequestSchema` (or a superset that includes `jobId`)
inside `runJob` rather than trusting the cast.

### IN-02: `client.ts` comment references a route that does not exist

**File:** `lib/inngest/client.ts:5-6`
**Issue:** The doc comment lists a consumer `app/api/inngest/trigger/route.ts (the event trigger
route — plan 05-04)`. That file does not exist; the trigger lives at `app/api/jobs/route.ts`. Stale
comment — harmless but misleading for the next reader. Same stale reference shape appears in
`app/api/inngest/route.ts:19` ("plan 05-04 adds the generic runJob function" — runJob now exists and
is imported).

**Fix:** Update the comment to point at `app/api/jobs/route.ts`.

### IN-03: `JobProgressProps.allStages` is mutable shared default

**File:** `components/jobs/job-progress.tsx:20-26,60`
**Issue:** `DEFAULT_STAGES` is a module-level array used as the default for the `allStages` prop.
React default props are evaluated per render but the *same* `DEFAULT_STAGES` reference is shared
across every `JobProgress` instance. The component only reads it, so there is no live bug — but if
any future code mutates `allStages` (e.g. `.push`), it would corrupt the shared default for all
consumers. Marking it `as const` / `readonly StageItem[]` makes the immutability intent explicit
and lets the compiler catch mutation.

**Fix:** `const DEFAULT_STAGES: readonly StageItem[] = [...] as const;` and widen the prop type to
`readonly StageItem[]`.

### IN-04: `getJob` SELECT * couples the store to schema column order

**File:** `lib/jobs/store.ts:160-165`
**Issue:** `getJob` uses `SELECT *`. It works today because `JobRow` happens to match the DDL. But
`SELECT *` means any future column added to `app.jobs` is silently pulled into the row object. The
status route's projection (`[id]/route.ts`) is the only thing keeping new columns from leaking to
the browser — the store itself has no allow-list. Given the explicit T-05-11 "never leak DB
internals" goal, an explicit column list in the store is defense-in-depth.

**Fix:** `SELECT id, kind, status, progress, stage, params, result, error, created_at, updated_at FROM app.jobs WHERE id = ${jobId}`.

### IN-05: No length/shape bound on `params` in `jobRequestSchema`

**File:** `lib/jobs/schemas.ts:29`
**Issue:** `params: z.record(z.unknown()).default({})` accepts an arbitrarily large/deep object.
It is stored verbatim as JSONB and echoed into the Inngest event payload. There is no per-job
authentication pre-Phase-6 (documented, accepted as T-05-09), so an unauthenticated caller can
POST a multi-megabyte `params` blob and have it written to the DB and shipped to Inngest. Not a
classic injection (SQL is parameterized), but an unbounded-input vector. Low severity given the
demo/early-stage context, but worth a `.refine` size cap or a stricter per-kind params schema once
kinds stabilize.

**Fix:** Add a coarse bound, e.g. `.refine((p) => JSON.stringify(p).length < 16_000, "params too large")`,
or define a discriminated per-`kind` params schema.

---

_Reviewed: 2026-05-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
