---
phase: 05-background-jobs
plan: "04"
subsystem: background-jobs
tags: [inngest, job-runner, api-routes, background-jobs]
dependency_graph:
  requires: [05-01, 05-03]
  provides: [generic-job-runner, job-trigger-route, job-status-route]
  affects: [app/api/inngest/route.ts]
tech_stack:
  added: []
  patterns:
    - Inngest v4 2-arg createFunction API (options with triggers array + handler)
    - step.run boundaries at mark-running / execute / mark-done or mark-error only
    - updateProgress as plain await inside operation (not a step — prevents replay)
    - Next.js 15 App Router: await ctx.params in dynamic segments
    - 202 Accepted response for async job dispatch
key_files:
  created:
    - lib/inngest/functions.ts
    - app/api/jobs/route.ts
    - app/api/jobs/[id]/route.ts
  modified:
    - app/api/inngest/route.ts
decisions:
  - "Inngest v4 createFunction uses 2-arg API: options (includes triggers array) + handler. The 3-arg form (config, trigger, handler) is v3 syntax and produces TS error TS2554."
  - "retries: 1 on runJob — gbrain import / runOnboarding is not idempotent; retry from scratch can double-import (RESEARCH Pitfall 3)."
  - "updateProgress NOT inside step.run — steps are memoized and replayed; progress writes are transient side-effects that must not be replayed."
  - "T-05-09 accepted: trigger route is unauthenticated pre-Phase-6; documented inline."
metrics:
  duration: "~20 minutes"
  completed: "2026-05-22T03:16:27Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 1
---

# Phase 05 Plan 04: Generic Job Runner (Inngest + HTTP Routes) Summary

One-liner: Generic Inngest runJob function wired end-to-end — kind-agnostic trigger (POST /api/jobs), worker (lib/inngest/functions.ts), and status polling (GET /api/jobs/[id]) using the app.jobs Supabase table.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Build generic runJob Inngest function + register it | 911771c | lib/inngest/functions.ts, app/api/inngest/route.ts |
| 2 | Build POST /api/jobs job-trigger route | bdf0838 | app/api/jobs/route.ts |
| 3 | Build GET /api/jobs/[id] job-status route | f6fb460 | app/api/jobs/[id]/route.ts |

## What Was Built

### lib/inngest/functions.ts (new)
The one generic Inngest function (`runJob`) that handles any registered `JobKind`:

- Config: `id: "run-job"`, `retries: 1`, `triggers: [{ event: "app/job.requested" }]` (Inngest v4 2-arg API)
- Three `step.run` boundaries: `mark-running`, `execute`, `mark-done` / `mark-error`
- `updateProgress` runs as a plain `await` inside the operation (inside `step.run("execute")`) — NOT as its own `step.run` to avoid memoization replay
- `catch` branch calls `failJob` then re-throws so Inngest records the failure in its dashboard

### app/api/inngest/route.ts (modified)
Added `import { runJob } from "@/lib/inngest/functions"` and changed `functions: []` to `functions: [runJob]`.

### app/api/jobs/route.ts (new)
POST job-trigger route:
- Parses JSON body (bad JSON → 400)
- `jobRequestSchema.safeParse` validates `kind` + `params` (unknown kind → 400)
- `createJob` inserts `status=queued` row; `inngest.send` dispatches `app/job.requested`
- Returns 202 Accepted `{ jobId }`
- Logs only `kind` + `jobId`, never `params` (T-05-12 PII guard)
- Inline comment documents T-05-09 acceptance (unauthenticated pre-Phase-6)

### app/api/jobs/[id]/route.ts (new)
GET job-status polling route:
- Awaits `ctx.params` (Next.js 15 App Router)
- `getJob(id)` → null returns 404 `{ error: "job_not_found", message }`
- Response projects only browser-safe fields: `{ status, progress, stage, result?, error? }`
- `result` present only when `status === "done"`; `error` present only when `status === "error"`
- `params`, `created_at`, `updated_at`, and raw DB columns never returned (T-05-11)

## Key Decisions

### Decision 1: Inngest v4 uses 2-argument createFunction API
Inngest v4 `createFunction` signature is `(options, handler)` where `options` includes a `triggers` array. The v3 3-argument form `(config, {event}, handler)` produces TypeScript error TS2554 "Expected 2 arguments, but got 3." All RESEARCH pattern examples show the 3-arg form (v3 docs) — the implementation used the correct v4 API discovered via TS type inspection.

### Decision 2: retries: 1 (not the default)
`runOnboarding` / `gbrain import` is not idempotent — retrying from scratch can double-import documents. `retries: 1` surfaces a clean error on failure the user can re-trigger, rather than silently double-importing (RESEARCH Pitfall 3).

### Decision 3: updateProgress placement
`updateProgress` writes happen as plain `await` calls inside the `step.run("execute")` closure — they are NOT separate `step.run` boundaries. Inngest memoizes completed steps and replays them on re-invocation; a progress write is a transient side-effect that must not be replayed.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written, with one discovery:

**[Rule 1 - Bug] Inngest v4 API uses 2-arg createFunction, not 3-arg**
- **Found during:** Task 1 — `bunx tsc --noEmit` reported TS2554 "Expected 2 arguments, but got 3" on the initial implementation that followed the RESEARCH pattern examples (v3 syntax)
- **Issue:** RESEARCH pattern examples used the v3 `createFunction(config, {event}, handler)` form; Inngest v4's TypeScript types expect `createFunction(options, handler)` where `options` includes a `triggers` array
- **Fix:** Changed to `{ id: "run-job", retries: 1, triggers: [{ event: "app/job.requested" }] }` as the single options object, confirmed via inspection of `node_modules/inngest/components/Inngest.d.ts`
- **Files modified:** lib/inngest/functions.ts
- **Commit:** 911771c (corrected in same commit — initial Write + immediate fix before commit)

## Verification Results

### Static Checks (Passed)
- `npx tsc --noEmit`: PASS — no TypeScript errors across the whole repo
- `npx eslint app/api/jobs/ app/api/inngest/route.ts lib/inngest/functions.ts`: PASS — no ESLint errors

### Runtime Checks (Requires Dev Server)
The end-to-end test (POST seed-tenant `onboarding-import` job, poll to `done`) requires:
1. `bunx inngest-cli@latest dev` running on `localhost:8288`
2. `bun run dev` running on `localhost:3000`
3. `INNGEST_DEV=1` set in `.env.local`

The agent shell does not have `bun` on PATH (bun binary is at `~/.bun/bin/bun`), and running an interactive dev server + Inngest worker is outside the executor's scope. All static correctness checks pass. The runtime verification must be performed by the operator after `bun run dev` + `bunx inngest-cli@latest dev` are started.

**Expected progress transitions for the seed-tenant job:**
```
queued    (immediately after POST /api/jobs returns 202)
running   (after Inngest invokes mark-running step)
running   stage="Creating your brain"   progress=0..20
running   stage="Reading your invoices and emails"  progress=20..50
running   stage="Building the knowledge graph"      progress=50..75
running   stage="Indexing for search"               progress=75..95
running   stage="Ready"                             progress=95..100
done      progress=100, result={ tenantId: "seed" }
```

## Known Stubs

None — no hardcoded empty values, placeholder text, or unconnected data sources. The trigger and status routes are fully wired to `app.jobs` via `lib/jobs/store.ts`.

## Threat Surface Scan

All threat mitigations from the plan's threat register are implemented:

| Threat ID | Status | Implementation |
|-----------|--------|----------------|
| T-05-09 (DoS) | Accepted | Inline comment in trigger route; retries:1 caps per-job executions |
| T-05-10 (Tampering/Spoofing) | Mitigated | jobRequestSchema validates before createJob+inngest.send |
| T-05-11 (Info Disclosure — status route) | Mitigated | Response projects only status/progress/stage/result/error |
| T-05-12 (Info Disclosure — logging) | Mitigated | console.log logs only kind+jobId, never params |
| T-05-13 (Spoofing — inngest serve) | Mitigated | No change needed; INNGEST_SIGNING_KEY already verified by serve() |

No new security surface beyond the plan's threat model.

## Self-Check: PASSED

**Files exist:**
- FOUND: lib/inngest/functions.ts
- FOUND: app/api/jobs/route.ts
- FOUND: app/api/jobs/[id]/route.ts
- FOUND: .planning/phases/05-background-jobs/05-04-SUMMARY.md

**Commits exist:**
- FOUND: 911771c (feat(05-04): build generic runJob Inngest function and register it)
- FOUND: bdf0838 (feat(05-04): build POST /api/jobs job-trigger route)
- FOUND: f6fb460 (feat(05-04): build GET /api/jobs/[id] job-status polling route)
