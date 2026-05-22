---
phase: 05-background-jobs
verified: 2026-05-21T00:00:00Z
status: human_needed
score: 4/4
overrides_applied: 0
human_verification:
  - test: "Deploy to Vercel, set INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY in Vercel encrypted env, register the /api/inngest URL in the Inngest Dashboard. Then: (1) curl https://<deploy-url>/api/inngest returns HTTP 200 JSON introspection; (2) POST { kind: 'onboarding-import', params: { tenantId: 'seed' } } to https://<deploy-url>/api/jobs returns 202 + jobId; (3) polling https://<deploy-url>/api/jobs/<jobId> shows status progressing queued/running -> done with progress climbing to 100 and stage labels updating; (4) the Inngest cloud dashboard shows the run-job execution for that run."
    expected: "GET /api/inngest returns 200 JSON (Inngest runs under bun@1.2.0 Vercel runtime — Pitfall 5 discharged). The job reaches status=done with visible progress transitions. Inngest dashboard shows the run. The JobProgress UI looks visually indistinguishable from the SSE onboarding progress theater."
    why_human: "App is not yet deployed; Vercel CLI is not installed in this environment. All code is complete and builds cleanly (bunx tsc --noEmit clean, next build succeeds). Only the live runtime confirmation on the deployed URL is pending. Per the known outstanding item documented in the verification prompt, this is a human_needed item, not a code gap."
---

# Phase 5: Background Jobs Verification Report

**Phase Goal:** gbrain operations that exceed the serverless timeout run as background jobs with visible browser progress; the inline-vs-job split is driven by measured latency, not guessed.
**Verified:** 2026-05-21T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The p95 latency of each gbrain operation (query retrieval, think synthesis, import) is measured and documented; the inline-vs-job threshold is set from this data. | VERIFIED | `docs/phase-5-latency-threshold.md` contains measured p50/p95 values (query p95=6222ms, think p95=11289ms, import ~120s+), confirms the 300s Vercel Fluid Compute ceiling, explicitly states query and think stay INLINE and import must be a background job, references `scripts/bench-gbrain.ts` as the reproducible source. |
| 2 | Operations confirmed to exceed the timeout run as Inngest background jobs, not inline in a Route Handler. | VERIFIED | `lib/inngest/functions.ts` exports `runJob` — an Inngest function that handles `app/job.requested` events, runs `JOB_REGISTRY[kind](params, reportProgress)` out-of-band, and writes lifecycle state to `app.jobs`. `app/api/jobs/route.ts` dispatches the job via `inngest.send` and returns 202 (not the result inline). The import/onboarding operation is wired via `JOB_REGISTRY["onboarding-import"]` in `lib/jobs/registry.ts`. |
| 3 | The browser receives real-time progress for a background job via SSE or polling — no silent multi-minute wait. | VERIFIED (code only; deployed runtime: human_needed) | `lib/jobs/use-job-status.ts` implements a bounded poll loop (`setInterval` at 2000ms, `MAX_POLL_ATTEMPTS=150`, clears on done/error/cap). `components/jobs/job-progress.tsx` renders all six states (queued/running/slow-but-healthy/done/error/poll-give-up) with an 8px progress bar, stage-checklist tri-state, `aria-live` region, and ErrorBanner reuse — visually identical to SSE onboarding progress. Hook fetches from `/api/jobs/<id>`. Component is a `"use client"` module consuming `useJobStatus`. |
| 4 | Operations that complete under the timeout continue to run inline with no latency overhead from job infrastructure. | VERIFIED | `docs/phase-5-latency-threshold.md` explicitly records that `query` (p95~6s) and `think` (p95~11s) stay on the existing inline chat route (`app/api/tenants/[tenantId]/chat/route.ts`). No changes were made to the chat route or query path in Phase 5. The job infrastructure is only triggered by an explicit POST to `/api/jobs`. |

**Score:** 4/4 truths verified (success criterion 3 has a pending deployed-runtime item under human_verification; the code evidence is complete)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/inngest/client.ts` | Inngest client singleton exported as `inngest` | VERIFIED | File exists; exports `const inngest = new Inngest({ id: "quickbrain" })`. Single export, no other exports. |
| `app/api/inngest/route.ts` | Inngest serve handler exporting GET/POST/PUT, runtime=nodejs | VERIFIED | Exports GET/POST/PUT from `serve({ client: inngest, functions: [runJob] })`; declares `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`. |
| `.env.example` | INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY documented | VERIFIED | Both keys present at lines 69 and 77 of `.env.example` with server-only comments. |
| `scripts/bench-gbrain.ts` | p50/p95 benchmark for query/think/import | VERIFIED | File exists with `#!/usr/bin/env bun` shebang, `percentile()` function, iteration constants (QUERY_N=30, THINK_N=10, IMPORT_N=3), warm-up logic, and calls to `queryInProcess`, `think`, `onboard`. |
| `docs/phase-5-latency-threshold.md` | Measured latencies + inline-vs-job threshold decision with 300s Vercel ceiling | VERIFIED | File exists; contains measured p50/p95 table, states "300s" Fluid Compute ceiling with two evidence points, explicit inline/job decision per operation, references bench script. Notes stale 10s/60s figures superseded. |
| `lib/jobs/types.ts` | JobKind, JobStatus, JobProgress, JobOperation contract | VERIFIED | All four types exported. JobKind = "onboarding-import" (Phase 7 comment for "qbo-ingest"). JobProgress has `stage: string` and `percent: number`. |
| `lib/jobs/schemas.ts` | zod jobRequestSchema | VERIFIED | `jobRequestSchema` exported with `kind: z.enum(["onboarding-import"])` and `params: z.record(z.unknown()).default({})`. `JobRequest` type exported via `z.infer`. |
| `lib/jobs/store.ts` | Supabase Postgres CRUD with createJob/setRunning/updateProgress/finishJob/failJob/getJob | VERIFIED | All six functions exported. Module-level `sql` singleton with `prepare: false`. All SQL targets `app.jobs`. `failJob` sanitizes with `.slice(0, 500).replace(/postgres:\/\//gi, "[redacted]")`. No string concatenation of values into SQL. |
| `lib/jobs/registry.ts` | JOB_REGISTRY — JobKind to JobOperation dispatch | VERIFIED | `JOB_REGISTRY` exported as `Record<JobKind, JobOperation>`. One entry `"onboarding-import"` that calls `runOnboarding` and adapts the sync `emit` callback to async `reportProgress` via `void reportProgress(...)` (fire-and-forget). |
| `scripts/setup-jobs-table.ts` | Idempotent DDL with RLS visibility check | VERIFIED | File exists with `#!/usr/bin/env bun`. Creates `app` schema and `app.jobs` table with all 10 columns and `gen_random_uuid()` default on `id`. INSERT-then-SELECT from a fresh connection visibility check. `process.exit(1)` with three remediation options on failure. `prepare: false` on all connections. |
| `docs/phase-5-jobs-table.md` | Schema contract reference | VERIFIED | File exists. Documents all columns, lifecycle state machine, security properties, setup instructions, and verified round-trip example. |
| `lib/inngest/functions.ts` | Generic runJob Inngest function | VERIFIED | Exports `runJob` via `inngest.createFunction` with `id: "run-job"`, `retries: 1`, `triggers: [{ event: "app/job.requested" }]` (Inngest v4 2-arg API). Three `step.run` boundaries: `mark-running`, `execute`, `mark-done`/`mark-error`. `updateProgress` is a plain await inside the operation (not a step boundary). Catch branch calls `failJob` then re-throws. |
| `app/api/jobs/route.ts` | POST job-trigger route | VERIFIED | Exports `POST`; declares `dynamic = "force-dynamic"` and `runtime = "nodejs"`. JSON parse failure → 400. Zod validation failure → 400 with issues. Success → `createJob` + `inngest.send("app/job.requested")` → 202 `{ jobId }`. Logs only kind+jobId. T-05-09 comment present. |
| `app/api/jobs/[id]/route.ts` | GET job-status polling route | VERIFIED | Exports `GET`; declares `dynamic = "force-dynamic"` and `runtime = "nodejs"`. Awaits `ctx.params` (Next.js 15). Unknown id → 404 `{ error: "job_not_found", message }`. Known id → projects only `{ status, progress, stage, result?, error? }`. Raw DB columns excluded. |
| `lib/jobs/use-job-status.ts` | Bounded poll-loop hook | VERIFIED | `"use client"` at top. Exports `useJobStatus(jobId)`. `setInterval` at 2000ms in `useRef`. `MAX_POLL_ATTEMPTS = 150`. Stops on `done`, `error`, or cap. Cap hit → `pollState = "timed-out"`. `isSlow` flag after `SLOW_THRESHOLD_MS = 20000ms`. `restart()` re-arms the loop. Effect cleanup clears interval. Returns `{ status, progress, stage, result, error, pollState, isSlow, restart }`. |
| `components/jobs/job-progress.tsx` | Polled job-progress client component | VERIFIED | `"use client"` at top. Exports `JobProgress`. Consumes `useJobStatus`. 8px (`h-2`) progress bar with `role="progressbar"` + `aria-valuenow`/`valuemin`/`valuemax` + `transition-all duration-500` + `bg-neutral-900` fill — copied verbatim from `OnboardingProgress`. Stage-checklist tri-state (isDone green ✓, isCurrent Loader2 animate-spin, isPending muted dot) in 16×16 icon slot. All six states render. `ErrorBanner` reused for error state. `Badge variant="secondary"` for Queued/Running/Still working (never destructive). `aria-live="polite"` sr-only region present. No raw job IDs, stack traces, or "Inngest"/"serverless" in UI copy. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/api/inngest/route.ts` | `lib/inngest/client.ts` | `import inngest` | VERIFIED | Line 24: `import { inngest } from "@/lib/inngest/client"` |
| `app/api/inngest/route.ts` | `lib/inngest/functions.ts` | `serve functions array includes runJob` | VERIFIED | Line 25: `import { runJob } from "@/lib/inngest/functions"`. Line 30: `serve({ client: inngest, functions: [runJob] })` |
| `app/api/jobs/route.ts` | Inngest | `inngest.send app/job.requested` | VERIFIED | Lines 57-64: `await inngest.send({ name: "app/job.requested", data: { jobId, kind, params } })` |
| `lib/inngest/functions.ts` | `lib/jobs/registry.ts` | `JOB_REGISTRY lookup` | VERIFIED | Line 27: `import { JOB_REGISTRY } from "@/lib/jobs/registry"`. Line 57: `const op = JOB_REGISTRY[kind]` |
| `lib/jobs/registry.ts` | `lib/onboarding/orchestrator.ts` | `runOnboarding adapted to reportProgress` | VERIFIED | Line 18: `import { runOnboarding } from "@/lib/onboarding/orchestrator"`. Lines 44-56: adapts sync emit to async reportProgress via fire-and-forget. |
| `lib/jobs/use-job-status.ts` | `/api/jobs/[id]` | `fetch in bounded poll loop` | VERIFIED | Line 98: `fetch('/api/jobs/' + id)` inside the setInterval callback |
| `components/jobs/job-progress.tsx` | `lib/jobs/use-job-status.ts` | `useJobStatus hook` | VERIFIED | Line 8: `import { useJobStatus } from "@/lib/jobs/use-job-status"`. Line 64: `const { status, progress, ... } = useJobStatus(jobId)` |
| `lib/jobs/store.ts` | Supabase Postgres `app.jobs` table | `postgres tagged-template SQL` | VERIFIED | All SQL statements target `app.jobs` with tagged-template interpolation. Module-level `sql` singleton with `prepare: false`. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `components/jobs/job-progress.tsx` | `status, progress, stage, error, pollState, isSlow` | `useJobStatus(jobId)` → `fetch('/api/jobs/<id>')` → `GET /api/jobs/[id]` → `getJob(id)` → `SELECT * FROM app.jobs WHERE id=<id>` | Yes — live DB query on every poll tick | FLOWING |
| `app/api/jobs/[id]/route.ts` | `job` | `getJob(id)` → `sql<JobRow[]>\`SELECT * FROM app.jobs WHERE id=${jobId}\`` | Yes — parameterized SQL returning live row | FLOWING |
| `app/api/jobs/route.ts` | `jobId` | `createJob(kind, params)` → `INSERT INTO app.jobs RETURNING id` | Yes — INSERT with RETURNING | FLOWING |
| `lib/inngest/functions.ts` | `result` | `step.run("execute", () => JOB_REGISTRY[kind](params, reportProgress))` → `runOnboarding(tenantId, emit)` | Yes — real orchestrator execution against the brain | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for the deployed-URL test (no running server or Vercel CLI available). Static checks only.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `inngest` package present at ^4.4.0 | `grep '"inngest"' package.json` | `"inngest": "^4.4.0"` at line 25 | PASS |
| `inngest-cli` absent from package.json | `grep "inngest-cli" package.json` | Not found | PASS |
| INNGEST_SIGNING_KEY in .env.example | `grep "INNGEST_SIGNING_KEY" .env.example` | Found at line 77 | PASS |
| INNGEST_EVENT_KEY in .env.example | `grep "INNGEST_EVENT_KEY" .env.example` | Found at line 69 | PASS |
| `scripts/bench-gbrain.ts` has shebang and percentile | `head -1` + content check | `#!/usr/bin/env bun`, `percentile` function defined | PASS |
| `docs/phase-5-latency-threshold.md` contains 300 and p50/p95 | File content check | "300" (Vercel ceiling), p50/p95 table with measured values | PASS |
| `lib/jobs/store.ts` has `prepare: false` and `app.jobs` references | File content check | Both present | PASS |
| `failJob` sanitizes error | File content check | `.slice(0, 500).replace(/postgres:\/\//gi, "[redacted]")` | PASS |
| `lib/jobs/use-job-status.ts` has `"use client"`, bounded poll | File content check | `"use client"` line 1, `MAX_POLL_ATTEMPTS=150`, `setInterval` in `useRef` | PASS |
| `components/jobs/job-progress.tsx` has `"use client"`, `role="progressbar"`, `aria-live` | File content check | All three present | PASS |
| Vitest test files exist for jobs | `ls tests/unit/jobs/` | `job-contract.test.ts`, `store.test.ts` (25 tests per SUMMARY) | PASS |
| All phase 5 commits verified | `git log --oneline <hashes>` | All 14 documented commits found in git history | PASS |

---

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` files declared or found for this phase. PLAN files declare no probes. Step 7c: SKIPPED.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| JOBS-01 | 05-01, 05-03, 05-04 | gbrain operations that exceed the serverless function timeout run as background jobs, not inline in a Route Handler | SATISFIED | `lib/inngest/functions.ts` (runJob), `app/api/jobs/route.ts` (POST trigger), `app/api/inngest/route.ts` (serve handler), `lib/jobs/store.ts` (state persistence). The import/onboarding operation routes via `JOB_REGISTRY["onboarding-import"]`. Inline path (chat/query) unchanged. |
| JOBS-02 | 05-04, 05-05 | The browser sees progress for a background job via SSE or polling — no silent multi-minute waits | SATISFIED (code) / human_needed (deployed runtime) | `lib/jobs/use-job-status.ts` (bounded poll hook), `components/jobs/job-progress.tsx` (renders all six lifecycle states), `app/api/jobs/[id]/route.ts` (status polling endpoint). Code is complete. Deployed-URL smoke test is the human verification item. |
| JOBS-03 | 05-02 | Operations that complete under the timeout still run inline; the inline-vs-job threshold is set from measured latency, not guessed | SATISFIED | `docs/phase-5-latency-threshold.md` records measured p50/p95 for all three operations, confirms the 300s Vercel ceiling from dashboard evidence, and explicitly states which operations are INLINE (query, think) vs. BACKGROUND JOB (import). `scripts/bench-gbrain.ts` is the reproducible measurement source. |

All three Phase 5 requirement IDs are accounted for. No orphaned requirements were found in REQUIREMENTS.md for Phase 5.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `app/api/inngest/route.ts` | 18-19 | Stale comment says "functions array is empty here. plan 05-04 adds the generic runJob function." | Info | Comment is outdated — code on line 30 already has `functions: [runJob]`. No functional impact. |

No `TBD`, `FIXME`, or `XXX` markers found in any Phase 5 modified file. No stub patterns (empty returns, hardcoded empty arrays, placeholder text) found in the implementation files. The single comment discrepancy is informational only — the code is correct.

---

### Human Verification Required

#### 1. Deployed-URL End-to-End Smoke Test (Plan 05-05 Task 3)

**Test:** Deploy the app to Vercel (or use an existing deployment). Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in the Vercel project's encrypted env config. Register the deployed `/api/inngest` URL in the Inngest Dashboard. Then:
1. `curl -s https://<deploy-url>/api/inngest` — confirm HTTP 200 and a JSON introspection body (Inngest runs under bun@1.2.0 Vercel runtime — Pitfall 5 discharged).
2. `POST { kind: "onboarding-import", params: { tenantId: "seed" } }` to `https://<deploy-url>/api/jobs` — confirm 202 + `jobId`.
3. Poll `https://<deploy-url>/api/jobs/<jobId>` (or open a page rendering `JobProgress`) — confirm status progresses `queued`/`running` → `done`, progress bar fills to 100%, stage labels update.
4. Confirm the Inngest cloud dashboard shows the `run-job` function execution.
5. Visually confirm the polled `JobProgress` UI looks identical to the SSE onboarding progress theater.

**Expected:** GET /api/inngest returns 200 JSON. The seed-tenant onboarding-import job reaches `status=done` with visible progress transitions. Inngest dashboard shows the run. JobProgress UI is visually indistinguishable from SSE onboarding progress.

**Why human:** The app is not yet deployed; the Vercel CLI is not installed in this environment. All Phase 5 code is complete and builds cleanly (`bunx tsc --noEmit` clean, `next build` succeeds). This is purely a live runtime confirmation on the deployed URL — it cannot be performed programmatically from this environment.

---

### Gaps Summary

No gaps found. All four success criteria are satisfied at the code level:

1. **SC1 (latency measurement):** `docs/phase-5-latency-threshold.md` and `scripts/bench-gbrain.ts` — VERIFIED.
2. **SC2 (background jobs for long operations):** Full Inngest stack (`lib/inngest/`, `lib/jobs/`, `app/api/jobs/`, `app/api/inngest/`) — VERIFIED.
3. **SC3 (browser progress):** `lib/jobs/use-job-status.ts` + `components/jobs/job-progress.tsx` — VERIFIED at code level; deployed runtime requires human confirmation.
4. **SC4 (inline operations stay inline):** Confirmed by latency doc + no changes to inline chat/query path — VERIFIED.

The only pending item is the deployed-URL end-to-end smoke test (Plan 05-05 Task 3), which is a known outstanding item per the verification prompt. Per the prompt: "Treat the deployed-URL end-to-end run as a `human_verification` item (status `human_needed` for that item), NOT as a code gap."

---

_Verified: 2026-05-21T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
