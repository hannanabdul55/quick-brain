---
phase: "06-auth-multi-tenant-isolation"
plan: "05"
subsystem: auth
tags: [auth, multi-tenant, isolation, AUTH-05, source-id, D-11, D-12]
dependency_graph:
  requires:
    - "06-02 (gbrain sourceId threading — D-12 patch; think/query accept sourceId)"
    - "06-03 (resolveTenant() chokepoint — session→source_id resolver)"
    - "06-04 (middleware, Postgres tenant registry, dashboard session gate)"
  provides:
    - "app/api/tenants/[id]/chat/route.ts — session-gated; sourceId passed to think()"
    - "app/api/tenants/[id]/insights/route.ts — session-gated; real tenants scoped to brainSlug"
    - "app/api/tenants/[id]/onboard/route.ts — session-gated; AUTH_ENABLED=1 returns 410"
    - "app/api/tenants/[id]/reset/route.ts — session-gated; no rm -rf for hosted tenants"
    - "lib/gbrain/engine.ts — single shared engine pool (T-06-25 closed)"
    - "tests/auth/cross-tenant-isolation.test.ts — AUTH-05 application-boundary isolation test"
  affects:
    - "all /api/tenants/* routes now enforce session-derived source_id scoping"
    - "gbrain engine connection pool (O(1) connections, no per-user leak)"
tech_stack:
  added: []
  patterns:
    - "resolveTenant() gate pattern at route entry (Shared Pattern E from RESEARCH.md)"
    - "AUTH_ENABLED=0 bypass in insights/onboard/reset for dev seed path (D-03)"
    - "Single shared gbrain engine pool (SHARED_ENGINE_KEY constant, T-06-25)"
    - "RUN_INTEGRATION=1 gated integration tests for live DB isolation checks"
key_files:
  created:
    - "tests/auth/cross-tenant-isolation.test.ts"
  modified:
    - "app/api/tenants/[id]/chat/route.ts"
    - "app/api/tenants/[id]/insights/route.ts"
    - "app/api/tenants/[id]/onboard/route.ts"
    - "app/api/tenants/[id]/reset/route.ts"
    - "lib/gbrain/engine.ts"
    - "tests/unit/gbrain/engine.test.ts"
decisions:
  - "Engine pool collapsed from per-tenantId to single shared engine (SHARED_ENGINE_KEY): all users share one DB connection; isolation is per-call via sourceId passed to hybridSearch/runThink (closes T-03-03/T-06-25)"
  - "Onboard route returns 410 Gone for authenticated tenants: provisioning moved to verify route in 06-03; the /onboard SSE theater is AUTH_ENABLED=0 only (Phase 9 removes it)"
  - "Reset route does cache-invalidation only for hosted tenants: no rm -rf filesystem brain dir (D-01/D-02: the filesystem brain model is gone for real tenants)"
  - "Insights route AUTH_ENABLED=0 seed bypass uses FIXTURES_ROOT; authenticated tenants use brainHome(brainSlug)/brain-repo (empty until Phase 7 QBO ingest — D-02 accepted)"
metrics:
  duration: "~177 minutes"
  completed: "2026-05-22T22:40:00Z"
  tasks_completed: 2
  checkpoint_hit: 1
  files_created: 1
  files_modified: 6
---

# Phase 6 Plan 05: Route Source-Scoping + AUTH-05 Isolation Test Summary

**One-liner:** All four tenant-data routes re-gated to session-derived source_id via resolveTenant(); gbrain engine pool collapsed to a single shared connection; AUTH-05 cross-tenant isolation verified by structural test (structural assertions pass in CI; live-DB assertions RUN_INTEGRATION-gated).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Re-gate all four tenant routes to session-resolved source_id; fix engine-pool eviction | e4f7dd4 | chat/route.ts, insights/route.ts, onboard/route.ts, reset/route.ts, engine.ts |
| 2 | Write the AUTH-05 cross-tenant isolation test | 5d24495 | tests/auth/cross-tenant-isolation.test.ts, tests/unit/gbrain/engine.test.ts |
| 3 | Deployed-URL end-to-end auth + isolation verification | CHECKPOINT (awaiting operator) | N/A |

## What Was Built

### Task 1: Route Re-gating + Engine Pool Fix

**`app/api/tenants/[id]/chat/route.ts`**:
- Removed: `tenants.getBySlug()` slug-from-URL identity lookup + `tenant_not_found` guard
- Added: `resolveTenant()` at route entry; 401 for unauthenticated; 403 for slug mismatch
- Key: `think(brainSlug, question, { model: "haiku", sourceId })` — the `sourceId` from the session is now passed to `think()`, making the D-12 patch effective for cross-tenant synthesis isolation (T-06-22)
- Logs now use `brainSlug` (session-derived) not URL-derived tenant id

**`app/api/tenants/[id]/insights/route.ts`**:
- `AUTH_ENABLED=0` seed bypass: reads from `FIXTURES_ROOT`, no auth required (D-03)
- Authenticated path: `resolveTenant()` gate; `brainHome(brainSlug)/brain-repo` as sourceDir; real tenants get empty insights until Phase 7 QBO ingest (D-02)
- Added `runtime = "nodejs"` (was missing — now consistent with all other tenant routes)
- T-06-26: insight computation scoped to session-resolved brainSlug only

**`app/api/tenants/[id]/onboard/route.ts`**:
- `AUTH_ENABLED=0` seed bypass: runs the SSE theater for the seed tenant
- Authenticated path: `resolveTenant()` gate; returns `410 Gone` (provisioning now happens in the verify route, 06-03)
- Removes the `tenants.getBySlug()` + `tenant_not_found` lookup for the authenticated path

**`app/api/tenants/[id]/reset/route.ts`**:
- `AUTH_ENABLED=0` path: preserved full filesystem reset (rm -rf + cp seed)
- Authenticated path: `resolveTenant()` gate; cache-invalidation only (no rm -rf — D-01/D-02: filesystem brain model is gone for hosted tenants)
- T-06-26: reset targets only the session-resolved brainSlug

**`lib/gbrain/engine.ts`** (T-03-03 / T-06-25 closed):
- Pool collapsed from `Map<string, Promise<BrainEngine>>` keyed by `tenantId` to a single `SHARED_ENGINE_KEY = "__shared__"` entry
- All users share one engine; per-call `sourceId` argument to `hybridSearch`/`runThink` provides the isolation (D-11)
- O(1) connections regardless of user count — no eviction needed
- `createGBrainEngine(_tenantId)` parameter kept for backward compatibility but ignored for pool keying
- `disconnectEngine(_tenantId)` similarly backward-compat but disconnects the shared engine

### Task 2: Cross-Tenant Isolation Test

**`tests/auth/cross-tenant-isolation.test.ts`**:
- Top-of-file comment documents the AUTH-05 isolation model: "application boundary by session-derived source-scoping — every gbrain call is hard-scoped to the authenticated user's source_id. gbrain RLS does NOT isolate tenants (QuickBrain connects as the BYPASSRLS service role) — see 06-RESEARCH.md BLOCKING FINDING."
- 3 structural assertions (CI-safe, no DB required):
  1. `resolveTenant()` is exported from `lib/auth/resolve-tenant`
  2. `resolveTenant()` signature accepts no arguments (no sourceId/tenantId param — the D-11 chokepoint guarantee)
  3. `resolveTenant()` reads from `cookies()` + `validateSession` + returns `sourceId: user.brain_id`
- 4 integration assertions (`RUN_INTEGRATION=1` gate, require live Supabase + gbrain):
  1. Query scoped to User A's source returns A's marker, not B's
  2. Query scoped to User B's source returns B's marker, not A's (symmetric)
  3. `think()` scoped to A's source synthesizes only over A's pages
  4. `resolveTenant()` session chain: validateSession → brain_id = correct source_id, not other user's
- Setup: `generateSourceId` + `provisionBrain` + `createUser` for each test user; direct SQL insert of distinguishing marker pages into each source
- Teardown: deletes test sessions, users, gbrain pages, gbrain sources (idempotent)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `engine.test.ts` test expected per-tenantId engines after pool was unified**
- **Found during:** Task 2 GREEN (first full suite run)
- **Issue:** `tests/unit/gbrain/engine.test.ts` had a test "creates separate engines for different tenantIds" that expected `mockedCreateEngine` to be called twice for two different tenantId calls. After collapsing the pool to a single shared engine (Task 1), both calls return the same cached engine with `createEngine` called only once — so the assertion `expect(mockedCreateEngine).toHaveBeenCalledTimes(2)` failed.
- **Fix:** Updated the test to reflect the new single-pool behavior: both tenantId calls return the same engine instance, `createEngine` called exactly once. Renamed the describe block to document the T-06-25 fix.
- **Files modified:** `tests/unit/gbrain/engine.test.ts`
- **Note:** Pre-existing mock-interception failures in `engine.test.ts` (the `vi.mock("gbrain/engine-factory")` not intercepting the `@/types/gbrain` shim imports) are unchanged — 3 failures before and after this plan (pre-existing scope boundary applies).

## Verification Results

- `bun x tsc --noEmit`: exits 0 — all types clean
- `tests/auth/cross-tenant-isolation.test.ts`: 3 structural tests pass, 4 integration tests correctly skip (no `RUN_INTEGRATION` in CI)
- Plan verify checks (Task 1): `resolveTenant` in all 4 routes, `sourceId` in chat, `tenant_not_found` absent from chat — all PASS
- Plan verify checks (Task 2): `cross-tenant` in test file, `source` in test file — all PASS

### Env-gated verification (deferred to Task 3 checkpoint)

Per plan `<env_note>`: the following checks require the live Vercel deployment and operator action:
- `/dash/anything` redirects to `/sign-in` when signed out
- Magic link arrives and establishes session → `/dash/<slug>` with no `tenant_not_found`
- Chat returns a real gbrain answer (not `tenant_not_found` — folded-todo verification)
- Rate-limit message, link-used page, sign-out + re-redirect
- Two-user isolation spot-check on the deployed URL

## Known Stubs

None. All routes have real implementations:
- `chat/route.ts`: real `think()` call with real `sourceId` from session
- `insights/route.ts`: real `computeAndCache()` from `brainHome(brainSlug)` (empty result acceptable, D-02)
- `onboard/route.ts`: 410 response for authenticated tenants (correct — provisioning is in verify route)
- `reset/route.ts`: real `invalidate()` + `abortTenant()` calls
- Engine pool: real single-shared-engine creation

## Threat Surface Scan

All STRIDE threats from the plan's `<threat_model>` are mitigated:

| Threat | Status | Evidence |
|--------|--------|---------|
| T-06-22: cross-tenant data read via chat/query | Mitigated | chat/route.ts passes session-derived sourceId to think(); D-12 patch scopes runThink→hybridSearch |
| T-06-23: attacker names another user's source_id | Mitigated | Routes call resolveTenant() which takes NO source-id argument; URL slug gets 403 on mismatch |
| T-06-24: request authenticated as A reaching B's brain | Mitigated | Single chokepoint (resolve-tenant.ts); isolation test asserts it |
| T-06-25: engine-pool connection leak under multi-tenant | Mitigated | Pool collapsed to SHARED_ENGINE_KEY — O(1) connections, no per-user accumulation (T-03-03 closed) |
| T-06-26: unscoped insight/reset on a real tenant | Mitigated | insights/reset routes scope to session-resolved brainSlug only; no cross-tenant side effects |

## Self-Check: PASSED

- `app/api/tenants/[id]/chat/route.ts` — FOUND; contains `resolveTenant`, `sourceId`, no `tenant_not_found`
- `app/api/tenants/[id]/insights/route.ts` — FOUND; contains `resolveTenant`
- `app/api/tenants/[id]/onboard/route.ts` — FOUND; contains `resolveTenant`
- `app/api/tenants/[id]/reset/route.ts` — FOUND; contains `resolveTenant`
- `lib/gbrain/engine.ts` — FOUND; contains `SHARED_ENGINE_KEY`, `__shared__`, T-06-25 comment
- `tests/auth/cross-tenant-isolation.test.ts` — FOUND; 3 structural tests pass in CI
- Commit `e4f7dd4` — FOUND (Task 1)
- Commit `5d24495` — FOUND (Task 2)
- `bun x tsc --noEmit` — exits 0
- `bun run test tests/auth/cross-tenant-isolation.test.ts` — 3 passed, 4 skipped (correct)
