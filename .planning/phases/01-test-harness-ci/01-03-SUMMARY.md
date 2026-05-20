---
phase: 01-test-harness-ci
plan: "03"
subsystem: test-harness
tags: [vitest, testing, mutex, tenant-isolation, ci, integration]
dependency_graph:
  requires: ["01-01"]
  provides: ["TEST-02"]
  affects: ["CI pipeline", "lib/gbrain/mutex.ts", "lib/insights/anomalies.ts"]
tech_stack:
  added: []
  patterns: ["Vitest describe.skipIf for opt-in integration tests", "dual-guard pattern (project exclusion + env flag)"]
key_files:
  created:
    - tests/unit/gbrain/mutex.test.ts
    - tests/integration/tenant-isolation.test.ts
    - tests/integration/gbrain/concurrent-smoke.test.ts
  modified: []
decisions:
  - "Unique tenant IDs per mutex test (seed1, delta2, epsilon2, alpha2/beta2/gamma2) to prevent cross-test state leakage when Vitest runs sequentially"
  - "concurrent-smoke.test.ts is dual-guarded: placed in tests/integration/gbrain/ (excluded from default vitest project) AND guarded with describe.skipIf(!process.env.RUN_INTEGRATION)"
  - "tenant-isolation uses afterEach cleanup to ensure temp dir is always removed even if the test fails"
  - "seedCount shared in describe scope between Test 1 and Test 2 to enable isolation assertion"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-19"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 01 Plan 03: Smoke Scripts to Vitest Tests Summary

Port the three v1.x smoke scripts into proper Vitest tests, enabling CI-default runs for pure/filesystem tests and opt-in gating for gbrain-CLI-dependent tests.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Port mutex-smoke.ts to Vitest unit test | 026e3fb | tests/unit/gbrain/mutex.test.ts |
| 2 | Port tenant-isolation + concurrent-smoke to Vitest | 8102c37 | tests/integration/tenant-isolation.test.ts, tests/integration/gbrain/concurrent-smoke.test.ts |

## What Was Built

**tests/unit/gbrain/mutex.test.ts** — 4 Vitest `it()` blocks mirroring `scripts/mutex-smoke.ts` exactly:
- "serializes same-tenant concurrent calls": 3 concurrent locks on same tenant with 300ms sleep; asserts starts are >= 250ms apart
- "runs different tenants in parallel": 3 locks on distinct tenants; asserts all finish in < 600ms
- "next task runs after a rejected task": throws in first lock, asserts second lock runs
- "queue is empty after tenant drains": asserts `pendingTenants()` does not include the drained tenant

**tests/integration/tenant-isolation.test.ts** — 2 Vitest `it()` blocks mirroring `scripts/test-tenant-isolation.ts`:
- "FIXTURES_ROOT yields >= 3 anomaly rows": reads committed `data/maras-coffee/` fixtures (CI-safe, no API keys)
- "isolated empty directory yields 0 rows or throws": creates temp dir, asserts isolation

**tests/integration/gbrain/concurrent-smoke.test.ts** — 3 opt-in query tests:
- Wrapped in `describe.skipIf(!process.env.RUN_INTEGRATION)`
- Lives in `tests/integration/gbrain/` (excluded from default vitest project in vitest.config.ts)
- Tests Q1, Q2, Q3 from the concurrent-smoke demo questions
- 30s timeout per test for gbrain CLI latency

## Verification Results

```
bun run test --reporter=verbose

 Test Files  3 passed | 1 skipped (4)
      Tests  7 passed | 3 skipped (10)
   Duration  1.44s
```

- 7 tests pass (1 smoke + 2 tenant-isolation + 4 mutex)
- 3 tests skipped (concurrent-smoke, RUN_INTEGRATION not set)
- Exit 0
- `bunx tsc --noEmit` clean

## CI Constraint Compliance

- `mutex.test.ts`: pure in-process Promise logic, no subprocess, no API keys — always runs in CI
- `tenant-isolation.test.ts`: reads `data/maras-coffee/` committed to repo, no gbrain CLI — runs in CI
- `concurrent-smoke.test.ts`: dual-guarded by project exclusion + `describe.skipIf(!RUN_INTEGRATION)` — CI never runs it

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — test files only, no new network endpoints or auth paths.

## Self-Check: PASSED

- FOUND: tests/unit/gbrain/mutex.test.ts
- FOUND: tests/integration/tenant-isolation.test.ts
- FOUND: tests/integration/gbrain/concurrent-smoke.test.ts
- FOUND commit: 026e3fb (Task 1)
- FOUND commit: 8102c37 (Task 2)
- Original scripts/mutex-smoke.ts, scripts/concurrent-smoke.ts, scripts/test-tenant-isolation.ts: all intact
- `bun run test` exits 0 (verified)
- `bunx tsc --noEmit` exits 0 (verified)
