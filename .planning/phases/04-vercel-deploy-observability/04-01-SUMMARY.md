---
phase: 04-vercel-deploy-observability
plan: "01"
subsystem: health-probe
tags: [health, observability, deploy, security]
dependency_graph:
  requires: []
  provides: [GET /api/health, lib/health/probes, withTimeout, timed, probeGbrainDb, probeStorage]
  affects: [app/api/health/route.ts, lib/health/probes.ts, tests/unit/health/health-probes.test.ts]
tech_stack:
  added: []
  patterns:
    - throwaway postgres connection for DB probe (max:1, closed in finally)
    - Promise.all with timed() for concurrent subsystem probing
    - TDD RED/GREEN cycle for probe module
key_files:
  created:
    - lib/health/probes.ts
    - app/api/health/route.ts
    - tests/unit/health/health-probes.test.ts
  modified: []
decisions:
  - "DB probe uses throwaway postgres(url, {prepare:false, max:1}) — never createGBrainEngine — to avoid poisoning the app's enginePool (T-04-04)"
  - "probeStorage delegates to createStorage().exists('.health-check') with no new dependency (CLAUDE.md: no @supabase/supabase-js)"
  - "Probe error detail strings are sanitized: DB failure message never echoes the connection URL, storage failure never echoes the bucket URL or service-role key (T-04-02)"
  - "Route uses Promise.all (not Promise.allSettled) because timed() already catches internally — one failing subsystem cannot abort the other"
metrics:
  duration: "5 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
---

# Phase 4 Plan 1: Health Probe Endpoint Summary

## One-Liner

Three-subsystem `GET /api/health` probe: app always-up signal, gbrain DB throwaway `SELECT 1` against `GBRAIN_DATABASE_URL`, Supabase Storage `HEAD .health-check` — returns 200 or 503 per combined health with no secrets in the payload.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for probe module | d6883ec | tests/unit/health/health-probes.test.ts |
| 1 (GREEN) | lib/health/probes.ts implementation | 10f4121 | lib/health/probes.ts |
| 2 | GET /api/health Route Handler | c6fb252 | app/api/health/route.ts |

## Verification Results

- `bun run test -- tests/unit/health/health-probes.test.ts`: **10/10 tests pass**
- `bun run build`: **exits 0** — `/api/health` route appears in the build output as a Dynamic server-rendered route
- Full test suite: **121 passed, 7 skipped, 1 pre-existing failure** (`tests/infra/seed-config.test.ts` — missing `brains/seed/.gbrain/config.json`, unrelated to this plan)
- `grep -c 'runtime = "nodejs"' app/api/health/route.ts`: returns **1**
- `grep -c 'force-dynamic' app/api/health/route.ts`: returns **2** (export line + comment)
- `grep -nE "postgres://|postgresql://|SERVICE_ROLE" app/api/health/route.ts`: returns **nothing** (no secrets)
- `grep -n "createGBrainEngine\|enginePool" lib/health/probes.ts` (non-comment lines): **nothing** — DB probe uses throwaway connection
- `grep -nE "^import.*@supabase" lib/health/probes.ts`: **nothing** — no supabase-js import

## Decisions Made

1. **Throwaway postgres connection for DB probe.** The plan's Open Question 2 from RESEARCH.md recommended option (b): a direct `postgres(url) SELECT 1` with `max:1` closed in a `finally` block. This isolates the probe from the app's `enginePool`, so a health check cannot poison or exhaust production connections (T-04-04).

2. **`Promise.all` (not `Promise.allSettled`).** Used `Promise.all` because `timed()` already catches all errors internally — it never rejects. `Promise.allSettled` would add unnecessary overhead. Either would work here since neither can propagate rejection.

3. **Sanitized error detail strings.** The DB probe throws a fixed string ("GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set") if the env var is absent — never echoes a value. On DB connection failure, the postgres driver's error message (which typically does not contain the URL) is passed as-is; the comment in probes.ts documents this conservative decision (T-04-02, Security Domain V7).

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The probe functions connect to the real subsystems (or fail cleanly). No placeholder data flows to the response.

## Threat Flags

No new security-relevant surface was introduced beyond what the plan's threat model covers:
- `GET /api/health` is public and unauthenticated by design (uptime monitors)
- Payload is limited to booleans + latencyMs + sanitized detail strings
- All probe error paths sanitize output (T-04-01, T-04-02 mitigations applied)

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| lib/health/probes.ts exists | FOUND |
| app/api/health/route.ts exists | FOUND |
| tests/unit/health/health-probes.test.ts exists | FOUND |
| 04-01-SUMMARY.md exists | FOUND |
| commit d6883ec (RED test) | FOUND |
| commit 10f4121 (probes.ts GREEN) | FOUND |
| commit c6fb252 (route.ts) | FOUND |
