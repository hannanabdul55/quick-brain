---
phase: 05-background-jobs
plan: "03"
subsystem: jobs
tags: [jobs, supabase, postgres, ddl, zod, registry, tdd]
dependency_graph:
  requires:
    - "04 (Vercel Deploy) — Supabase Postgres accessible via SUPABASE_DB_URL_POOLER"
  provides:
    - "lib/jobs/types.ts — JobKind, JobStatus, JobProgress, JobOperation contract"
    - "lib/jobs/schemas.ts — jobRequestSchema (zod, rejects unknown kinds)"
    - "lib/jobs/registry.ts — JOB_REGISTRY dispatch table (onboarding-import entry)"
    - "lib/jobs/store.ts — createJob/setRunning/updateProgress/finishJob/failJob/getJob"
    - "scripts/setup-jobs-table.ts — idempotent DDL + RLS visibility check"
    - "docs/phase-5-jobs-table.md — schema contract reference"
  affects:
    - "05-04 (trigger + status routes) — imports all lib/jobs/* modules"
    - "05-05 (Inngest function) — imports store + registry"
    - "Phase 7 (QBO ingest) — adds qbo-ingest to JobKind + registry without rework"
tech_stack:
  added: []
  patterns:
    - "postgres tagged-template singleton (prepare:false, Supavisor pooler)"
    - "zod enum schema rejecting unknown kind values (Security V5)"
    - "JobKind-keyed dispatch table (JOB_REGISTRY)"
    - "failJob error sanitization: slice(0,500) + strip postgres:// URLs"
    - "INSERT-then-SELECT fresh-connection RLS visibility check (Pitfall 4)"
key_files:
  created:
    - lib/jobs/types.ts
    - lib/jobs/schemas.ts
    - lib/jobs/registry.ts
    - lib/jobs/store.ts
    - scripts/setup-jobs-table.ts
    - docs/phase-5-jobs-table.md
    - tests/unit/jobs/job-contract.test.ts
    - tests/unit/jobs/store.test.ts
  modified: []
decisions:
  - "JobKind as string literal union (not enum) — consistent with OnboardingEvent and Phase union style in existing codebase"
  - "sql.json() with JSONValue type import (not any cast) — ESLint-clean without suppressions"
  - "Store tests use readFileSync for structural assertions — avoids live DB in CI while validating key implementation invariants"
metrics:
  duration: "7 minutes"
  completed: "2026-05-22"
  tasks_completed: 3
  files_created: 8
---

# Phase 5 Plan 03: Job Data Layer (Types, Schema, Store, Registry, DDL) Summary

Generic job data layer: `JobKind`-keyed contract, zod trigger schema, Supabase Postgres job-row store, operation registry, and DDL for the `app.jobs` table.

## What Was Built

### Task 1: Generic job contract, zod schema, and registry (TDD)

**lib/jobs/types.ts** — The core contract:
- `JobKind = "onboarding-import"` (Phase 7 adds `"qbo-ingest"`)
- `JobStatus = "queued" | "running" | "done" | "error"`
- `JobProgress = { stage: string; percent: number }` (0..100)
- `JobOperation = (params, reportProgress) => Promise<unknown>` — the single function shape all kinds implement

**lib/jobs/schemas.ts** — Zod trigger payload validation:
- `jobRequestSchema` with `kind: z.enum(["onboarding-import"])` — rejects unknown kinds (Security V5)
- `params: z.record(z.unknown()).default({})` — optional, defaults to empty record
- `export type JobRequest = z.infer<typeof jobRequestSchema>`

**lib/jobs/registry.ts** — Dispatch table:
- `JOB_REGISTRY: Record<JobKind, JobOperation>` with one entry `"onboarding-import"`
- Adapts `runOnboarding`'s sync `emit(OnboardingEvent)` callback to async `reportProgress` via fire-and-forget (`void reportProgress(...)`) — never blocks the orchestrator's tick loop
- Phase 5 seed-tenant-only scope comment (Pitfall 6)

### Task 2: DDL setup script

**scripts/setup-jobs-table.ts** — Idempotent `#!/usr/bin/env bun` script:
- `CREATE SCHEMA IF NOT EXISTS app` + `CREATE TABLE IF NOT EXISTS app.jobs` (10 columns)
- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (T-05-07: unguessable capability token)
- `CREATE INDEX IF NOT EXISTS idx_jobs_status ON app.jobs (status)`
- INSERT-then-SELECT from a **fresh connection** visibility check (T-05-08 / Pitfall 4)
- `process.exit(1)` with three remediation options if SELECT returns zero rows
- `prepare: false` on all connections; `postgres://` URLs stripped from error messages

### Task 3: Supabase Postgres job store (TDD)

**lib/jobs/store.ts** — All CRUD against `app.jobs`:
- One module-level `sql` client singleton (`prepare: false`, URL from `GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER`)
- `createJob(kind, params)` → `string` (uuid)
- `setRunning(jobId)` → `void`
- `updateProgress(jobId, p)` → `void`
- `finishJob(jobId, result)` → `void` (stores result as JSONB)
- `failJob(jobId, error)` → `void` (sanitizes: `.slice(0, 500).replace(/postgres:\/\//gi, "[redacted]")`)
- `getJob(jobId)` → `JobRow | null`
- All SQL uses `postgres` tagged-template parameterization (no string concatenation, T-05-05)

## Test Results

| Test File | Tests | Result |
|-----------|-------|--------|
| tests/unit/jobs/job-contract.test.ts | 7 | PASS |
| tests/unit/jobs/store.test.ts | 18 | PASS |
| **Total** | **25** | **PASS** |

TDD gate compliance:
- Task 1: RED commit `e319b69` → GREEN commit `2df1d56` ✓
- Task 3: RED commit `d178a05` → GREEN commit `0cc9348` ✓

## Verification

```
bunx tsc --noEmit              → clean (no errors)
bunx eslint lib/jobs/ scripts/setup-jobs-table.ts → no errors
bun run test tests/unit/jobs/  → 25/25 pass
```

**Acceptance criteria for `scripts/setup-jobs-table.ts`:**
The script runs against Supabase, creates `app.jobs`, and the INSERT-then-SELECT visibility check passes (exit 0). This must be verified by running `bun scripts/setup-jobs-table.ts` after loading `.env.local`. The round-trip store verification (create → setRunning → updateProgress → finishJob → getJob) should also be confirmed manually against the live table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript `noUncheckedIndexedAccess` narrowing in setup script**
- **Found during:** Task 2 automated verify
- **Issue:** `postgres()` call on line 108 got `string | undefined` type error because TypeScript doesn't narrow `database_url` across `process.exit(1)` under `noUncheckedIndexedAccess=true`
- **Fix:** Assigned `const DB_URL: string = database_url` after the guard and used `DB_URL` for both connections
- **Files modified:** `scripts/setup-jobs-table.ts`
- **Commit:** Part of `798b418`

**2. [Rule 1 - Bug] TypeScript `noUncheckedIndexedAccess` on INSERT RETURNING row**
- **Found during:** Task 2 automated verify  
- **Issue:** `const [probeRow] = await sql<...>` destructure typed as `T | undefined` under strict settings
- **Fix:** Used explicit `insertResult[0]` with a null guard before dereferencing `.id`
- **Files modified:** `scripts/setup-jobs-table.ts`
- **Commit:** Part of `798b418`

**3. [Rule 1 - Bug] ESLint `@typescript-eslint/no-explicit-any` on sql.json() calls**
- **Found during:** Task 3 ESLint check
- **Issue:** `sql.json(params as any)` and `sql.json(result as any)` triggered ESLint errors; `Record<string, unknown>` and `unknown` are not directly assignable to `postgres.JSONValue`
- **Fix:** Imported `JSONValue` from the `postgres` package; used `as unknown as JSONValue` double cast (safe: `sql.json` serializes to PostgreSQL JSONB regardless of TypeScript type)
- **Files modified:** `lib/jobs/store.ts`
- **Commit:** `2bfd429`

## Threat Surface Scan

All threats introduced by this plan are already in the `<threat_model>`:

| Flag | File | Description |
|------|------|-------------|
| T-05-05 (mitigated) | lib/jobs/store.ts | Tagged-template SQL parameterization — no injection surface |
| T-05-06 (mitigated) | lib/jobs/store.ts | failJob sanitization: slice(0,500) + strip postgres:// |
| T-05-07 (mitigated) | app.jobs DDL | gen_random_uuid() id — unguessable capability token |
| T-05-08 (mitigated) | scripts/setup-jobs-table.ts | Separate app schema + INSERT-then-SELECT visibility check |

No new unplanned threat surface introduced.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `e319b69` | test | RED — failing tests for job contract, schema, and registry |
| `2df1d56` | feat | GREEN — job contract (types, schemas, registry) |
| `798b418` | feat | DDL setup script with RLS visibility check |
| `d178a05` | test | RED — failing tests for job store |
| `0cc9348` | feat | GREEN — job store full lifecycle CRUD |
| `2bfd429` | fix | ESLint: replace any cast with JSONValue import |
| `ef5c6df` | docs | phase-5-jobs-table.md schema reference |

## Self-Check: PASSED

Files exist:
- lib/jobs/types.ts: FOUND
- lib/jobs/schemas.ts: FOUND
- lib/jobs/store.ts: FOUND
- lib/jobs/registry.ts: FOUND
- scripts/setup-jobs-table.ts: FOUND
- docs/phase-5-jobs-table.md: FOUND
- tests/unit/jobs/job-contract.test.ts: FOUND
- tests/unit/jobs/store.test.ts: FOUND

Commits exist: e319b69, 2df1d56, 798b418, d178a05, 0cc9348, 2bfd429, ef5c6df — all verified in git log.
