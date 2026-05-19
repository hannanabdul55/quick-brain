---
phase: 04-smb-audit-gbrain-skill
plan: "02"
subsystem: api
tags: [insights, cache, tenant-isolation, typescript, bun]

# Dependency graph
requires:
  - phase: 03-dashboard-insights
    provides: lib/insights/cache.ts with computeAndCache; lib/insights/prewarm.ts; app/api/tenants/[id]/insights/route.ts

provides:
  - computeAndCache(tenantId, sourceDir) — per-tenant sourceDir resolved at call site, no hardcoded FIXTURES_ROOT
  - insights route passes FIXTURES_ROOT for seed tenant; brainHome(tenantId)/brain-repo for non-seed tenants
  - scripts/test-tenant-isolation.ts integration test confirming tenant data isolation (SKIL-09)

affects:
  - 04-03-smb-audit-skill-seed-integration
  - any future plan that calls computeAndCache

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "sourceDir-explicit: every computeAndCache call site resolves its own sourceDir rather than relying on a module-level constant"
    - "tenant-branch: isSeed branch in route handler resolves to FIXTURES_ROOT vs brainHome/brain-repo"

key-files:
  created:
    - scripts/test-tenant-isolation.ts
  modified:
    - app/api/tenants/[id]/insights/route.ts

key-decisions:
  - "cache.ts and prewarm.ts were already correct (no-op for those two files); only route.ts needed the fix"
  - "Non-seed tenants receive join(brainHome(tenantId), 'brain-repo') as sourceDir — matching the gbrain skill output location documented in CONTEXT.md line 110/116"
  - "brains/seed/ did not exist at execution time; confirmed brain-repo subdir is the correct path per CONTEXT.md decision block"

patterns-established:
  - "Tenant sourceDir resolved at the call site (route handler) not inside the cache module"

requirements-completed: [SKIL-09]

# Metrics
duration: 2min
completed: 2026-05-19
---

# Phase 4 Plan 02: FIXTURES_ROOT -> sourceDir Refactor Summary

**Per-tenant sourceDir wired into the insights route — seed tenant reads data/maras-coffee/, real tenants read brains/<id>/brain-repo/, verified by a bun isolation integration test (SKIL-09)**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-19T15:11:52Z
- **Completed:** 2026-05-19T15:13:24Z
- **Tasks:** 2
- **Files modified:** 2 (route.ts modified; test-tenant-isolation.ts created)

## Accomplishments

- Confirmed cache.ts (lines 25-28) and prewarm.ts (line 28) already had the correct two-param signature and FIXTURES_ROOT call — partial no-op
- Fixed the actual bug in app/api/tenants/[id]/insights/route.ts: non-seed tenants now receive their own brain dir instead of always reading Mara's data
- Added scripts/test-tenant-isolation.ts integration test; exits 0 confirming seed=3 anomalies vs fresh=empty/error

## No-Op Detection Result

**Partial no-op.** The plan's interfaces block warned to check if the refactor was already done.

Evidence (line numbers):
- `lib/insights/cache.ts` lines 25-28: `computeAndCache(tenantId: string, fixturesDir: string)` — **already correct, no change needed**
- `lib/insights/prewarm.ts` line 28: `await computeAndCache(SEED_TENANT_ID, FIXTURES_ROOT)` — **already correct, no change needed**
- `app/api/tenants/[id]/insights/route.ts` line 74 (pre-fix): `bundle = await computeAndCache(tenantId, FIXTURES_ROOT)` — **BUG: passed FIXTURES_ROOT for all tenants regardless of isSeed**

Only the route.ts call site required the fix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify and fix computeAndCache call sites** - `d3a3ef8` (fix)
2. **Task 2: Integration test — two tenants yield different anomaly counts** - `75cca1c` (test)

## Files Created/Modified

- `app/api/tenants/[id]/insights/route.ts` — Added `join` import from node:path, `brainHome` import from paths; resolved sourceDir before computeAndCache call using isSeed branch
- `scripts/test-tenant-isolation.ts` — New Bun script; runs computeAnomalies against FIXTURES_ROOT (expects >=3 rows) and empty temp dir (expects error/0 rows); exits 0 on pass

## Decisions Made

- **Non-seed brain subdir is `brain-repo`**: Per CONTEXT.md lines 110 and 116, gbrain skill output lands in `brains/<tenantId>/brain-repo/` — used `join(brainHome(tenantId), "brain-repo")` in the route. No brains/seed/ dir existed to inspect at runtime; decision confirmed from CONTEXT.md.
- **isSeed branch in route handler**: Reused the existing `isSeed` constant (already at line 57 of route.ts) to drive the sourceDir fork — no new logic added.

## Deviations from Plan

None — plan executed exactly as written. The partial no-op (cache.ts + prewarm.ts already correct) was anticipated by the plan's interfaces block note and required no special handling.

## Issues Encountered

- `bunx` not on PATH in the Bash execution environment; resolved by prepending `/Users/abdulhannankanji/.bun/bin` to PATH. No code impact.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The sourceDir change reduces information disclosure risk (T-04-02-01) by ensuring each tenant reads only their own brain data.

## Known Stubs

None. The sourceDir parameter flows directly to the filesystem parsers; no stub values introduced.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Route.ts now correctly routes real tenants to their own brain-repo dir; 04-03 skill integration can proceed
- When the smb-audit skill writes `concepts/march-anomaly-summary.md` into `brains/<tenantId>/brain-repo/concepts/`, the insight parser will pick it up automatically
- No regression to seed/demo flow — seed tenant still reads from data/maras-coffee/

---

## Self-Check

**Files created/exist:**
- `app/api/tenants/[id]/insights/route.ts` — modified (pre-existing file)
- `scripts/test-tenant-isolation.ts` — created

**Commits exist:**
- `d3a3ef8` — fix(04-02): resolve per-tenant sourceDir in insights route (T-04-02-01)
- `75cca1c` — test(04-02): add tenant isolation integration test (SKIL-09)

## Self-Check: PASSED

*Phase: 04-smb-audit-gbrain-skill*
*Completed: 2026-05-19*
