---
phase: 02-gbrain-on-supabase-asset-storage
plan: "02"
subsystem: infra
tags: [gbrain, supabase, storage, asset-storage, lib-storage, ephemeral-fs, phase-5-handoff]

dependency_graph:
  requires:
    - phase: 02-01
      provides: "seed brain on Supabase Postgres, GBRAIN_DATABASE_URL pooler injection in client.ts"
  provides:
    - data/maras-coffee/gbrain.yml with 4 db_tracked directories (storage tiering for seed brain)
    - lib/storage/ shim — StorageBackend interface + Supabase Storage (raw fetch) + local dev fallback
    - STORAGE_BACKEND env var factory (createStorage) for backend selection
    - tests/infra/storage.test.ts — 6 CI-safe unit tests for local backend
    - lib/gbrain/onboard.ts Phase 2 scope note (PGLite ephemeral-FS constraint documented)
    - docs/phase-5-onboarding-handoff.md — per-tenant provisioning scope boundary
  affects:
    - Phase 3 (Vercel Deploy) — onboarding not ephemeral-FS-safe for new tenants until Phase 5
    - Phase 5 (Auth + Multi-Tenant) — onboard.ts replacement with Postgres provisioning

tech_stack:
  added: []
  patterns:
    - "raw fetch for Supabase Storage REST API (no @supabase/* dep — hackathon constraint honored)"
    - "STORAGE_BACKEND env var factory pattern for backend selection (supabase | local)"
    - "Buffer → ArrayBuffer cast for Bun's strict BodyInit types in fetch calls"
    - "describe.skipIf (from 02-01) established as the CI-safe Vitest pattern for infra tests"

key_files:
  created:
    - data/maras-coffee/gbrain.yml
    - lib/storage/types.ts
    - lib/storage/local.ts
    - lib/storage/supabase.ts
    - lib/storage/index.ts
    - tests/infra/storage.test.ts
    - docs/phase-5-onboarding-handoff.md
  modified:
    - lib/gbrain/onboard.ts

key-decisions:
  - "Used raw fetch for Supabase Storage REST API — no @supabase/storage-js dep, honored CLAUDE.md constraint"
  - "Buffer → ArrayBuffer cast (not Uint8Array) because Bun's fetch overloads accept ArrayBuffer in its strict BodyInit"
  - "exists() returns Promise<boolean> on both backends for uniform await usage, even though local uses existsSync internally"
  - "gbrain.yml db_only is [] — no machine-generated dirs in seed brain; enables capability without false entries"
  - "getUrl() for Supabase returns a 1-hour signed URL via POST /storage/v1/object/sign/{bucket}/{path}"

patterns-established:
  - "StorageBackend interface: upload/download/getUrl/exists — four methods, all async"
  - "createStorage(backend?) factory: reads STORAGE_BACKEND env var, throws credential-free error on missing creds"
  - "Supabase Storage via raw fetch: PUT upload, GET download, HEAD exists, POST sign for getUrl"

requirements-completed: [STOR-01, STOR-02, STOR-03]

duration: "~25 minutes"
completed: "2026-05-19"
---

# Phase 2 Plan 02: Asset Storage Shim + gbrain.yml Summary

**StorageBackend shim (Supabase Storage via raw fetch + local dev fallback) wired behind a STORAGE_BACKEND factory; gbrain.yml storage tiering for the seed brain; Phase 5 ephemeral-FS scope boundary documented.**

## Performance

- **Duration:** ~25 minutes
- **Started:** 2026-05-19T22:14Z
- **Completed:** 2026-05-19T22:19Z
- **Tasks:** 2 (TDD Task 1 + Task 2) + 1 pre-cleared checkpoint
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments

- `data/maras-coffee/gbrain.yml` written with 4 db_tracked directories; `gbrain storage status` reads it cleanly — "DB tracked: 4 directories, 46 pages"
- `lib/storage/` shim: `StorageBackend` interface + Supabase Storage (raw fetch, no new deps) + local filesystem fallback + `createStorage()` factory
- Supabase Storage round-trip verified manually: upload → download → exists → signed URL — all PASS against the live `brain-files` bucket
- `STORAGE_BACKEND=local` fallback works without any Supabase credentials (CI-safe)
- 6 new unit tests in `tests/infra/storage.test.ts` — all pass; full suite now 96 passed / 3 skipped
- `lib/gbrain/onboard.ts` annotated with Phase 2 scope note — no behavior change
- `docs/phase-5-onboarding-handoff.md` documents the per-tenant provisioning constraint precisely
- Seed brain query via pooler writes 0 new files to `brains/seed/` (STOR-03 verified)

## Task Commits

1. **RED phase (storage.test.ts)** — `73e0ea2` (test)
2. **Task 1: gbrain.yml + lib/storage/ scaffold** — `08bcbcf` (feat)
3. **Task 2: onboard.ts scope note + Phase 5 handoff doc** — `b70efb0` (feat)

## Files Created/Modified

- `data/maras-coffee/gbrain.yml` — storage tiering (db_tracked: companies, people, concepts, originals; db_only: [])
- `lib/storage/types.ts` — `StorageBackend` interface: upload/download/getUrl/exists
- `lib/storage/local.ts` — `createLocalStorage(baseDir?)`: local disk backend using node:fs/promises
- `lib/storage/supabase.ts` — `createSupabaseStorage(bucket, url, key)`: Supabase REST API via raw fetch; Buffer → ArrayBuffer for Bun BodyInit compat
- `lib/storage/index.ts` — `createStorage(backend?)` factory: reads `STORAGE_BACKEND` env var; throws credential-free error if supabase creds missing
- `tests/infra/storage.test.ts` — 6 CI-safe unit tests (local backend round-trip, exists, getUrl, env var factory, missing-creds error)
- `lib/gbrain/onboard.ts` — added 7-line Phase 2 scope note comment (no implementation change)
- `docs/phase-5-onboarding-handoff.md` — Phase 5 provisioning scope boundary, code locations, explicit deviation acknowledgment

## Decisions Made

- **Raw fetch for Supabase Storage**: CLAUDE.md explicitly warns against `@supabase/supabase-js`. The Storage REST API is simple enough (PUT/GET/HEAD/POST sign) that raw fetch is cleaner and avoids a new dep entirely.
- **Buffer → ArrayBuffer cast**: Bun's `types: ["bun"]` in tsconfig gives fetch a strict `BodyInit` that rejects both `Buffer` and `Uint8Array<ArrayBufferLike>`. `ArrayBuffer` (via `buffer.slice(...)`) is accepted by all three overloads.
- **`exists()` returns `Promise<boolean>` on local backend**: even though `existsSync` is sync internally, the interface contract is async. Wrapped in `Promise.resolve()` for uniform `await` usage across both backends.
- **`db_only: []` in gbrain.yml**: the seed brain has no machine-generated directories today. An empty explicit list is cleaner than omitting the key — it makes intent explicit and passes gbrain's validator.
- **getUrl uses signed URL (1h TTL)**: the Supabase Storage bucket is private (`public: false`). Direct object URLs would be denied. Signed URLs are the correct pattern for private buckets.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] storage.test.ts: missing await on exists() calls**
- **Found during:** Task 1 (GREEN phase — running tests)
- **Issue:** Test called `backend.exists("not-there.txt")` without `await`, comparing a `Promise` object to `false`. 1 of 6 tests failed.
- **Fix:** Added `await` to both `exists()` calls in the test. Interface contract is `Promise<boolean>` so `await` is required.
- **Files modified:** `tests/infra/storage.test.ts`
- **Verification:** All 6 tests pass after fix.
- **Committed in:** `08bcbcf` (Task 1 feat commit — test was updated before committing the impl)

**2. [Rule 1 - Bug] supabase.ts: Buffer not assignable to BodyInit in Bun's strict fetch types**
- **Found during:** Task 1 (tsc --noEmit)
- **Issue:** `tsc` error TS2769 — `Buffer<ArrayBufferLike>` is not assignable to `BodyInit | null | undefined` in Bun's fetch overloads. Tried `Uint8Array` first — same error. `ArrayBuffer` (via `data.buffer.slice(...)`) is accepted.
- **Fix:** `body: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer`
- **Files modified:** `lib/storage/supabase.ts`
- **Verification:** `bunx tsc --noEmit` clean, full test suite passes.
- **Committed in:** `08bcbcf` (Task 1 feat commit)

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs during implementation)
**Impact on plan:** Both required for correctness. No scope creep.

## Checkpoint Verification Results (Pre-Cleared by Orchestrator)

The `checkpoint:human-verify` between Task 1 and Task 2 was pre-cleared. Verification results:

| Check | Result |
|---|---|
| `brain-files` bucket exists | PASS — orchestrator confirmed HTTP 200 before execution |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` | PASS — both present and non-empty |
| `gbrain storage status --repo data/maras-coffee` | PASS — "DB tracked: 4 directories, 46 pages (companies, people, concepts, originals)" |
| curl PUT to `brain-files/test.txt` | PASS — HTTP 200, `{"Key":"brain-files/test.txt","Id":"c1e54..."}` |
| `createStorage('supabase')` round-trip (upload→download→exists→getUrl) | PASS — all four methods verified against live bucket |

## STOR-03 Ephemeral-FS Verification

Seed brain query via the transaction pooler writes **0 new files** to `brains/seed/`:
- `find brains/seed -newer brains/seed/.gbrain/config.json -type f` = 0 before and after `gbrain query`
- `runOnce()` `mkdir(home, {recursive:true})` is a no-op (dir exists); no other writes occur at query time.

STOR-03 satisfied for the seed/demo tenant. New tenant onboarding is NOT ephemeral-FS-safe (Phase 5 scope).

## Known Stubs

None. `lib/storage/` is fully wired to real Supabase Storage (when `STORAGE_BACKEND=supabase`) and to real local disk (when `STORAGE_BACKEND=local`). No placeholder values or mock data.

## Threat Flags

No new security-relevant surface beyond the plan's threat model. Specific mitigations applied:

| Threat | Mitigation Applied |
|---|---|
| T-02B-01: SERVICE_ROLE_KEY disclosure | Key never logged; error messages are credential-free (`throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required...")`) |
| T-02B-02: Service role bypasses RLS | Key used only in `lib/storage/` (app-layer binary assets); NOT passed to gbrain child processes (Postgres uses pooler via `GBRAIN_DATABASE_URL`) |
| T-02B-03: gbrain.yml tier overlap | `db_only: []` — no overlap possible; `gbrain storage status` ran clean |
| T-02B-04: Missing creds in ephemeral env | `createStorage("supabase")` throws clear credential-free error |

## Self-Check: PASSED

### Files created/modified exist:

- [x] data/maras-coffee/gbrain.yml
- [x] lib/storage/types.ts
- [x] lib/storage/local.ts
- [x] lib/storage/supabase.ts
- [x] lib/storage/index.ts
- [x] tests/infra/storage.test.ts
- [x] lib/gbrain/onboard.ts (modified)
- [x] docs/phase-5-onboarding-handoff.md
- [x] .planning/phases/02-gbrain-on-supabase-asset-storage/02-02-SUMMARY.md

### Commits exist:

- [x] 73e0ea2 — test(02-02): add failing storage.test.ts for lib/storage/ shim
- [x] 08bcbcf — feat(02-02): write gbrain.yml and scaffold lib/storage/ shim
- [x] b70efb0 — feat(02-02): add Phase 2 scope note to onboard.ts and Phase 5 handoff doc

### Verification results:

- `bun run test`: 96 passed, 3 skipped — PASS
- `bunx tsc --noEmit`: clean — PASS
- `gbrain storage status --repo data/maras-coffee`: 4 db_tracked dirs — PASS
- Supabase round-trip (upload/download/exists/getUrl): PASS
- Seed brain query writes 0 new files to brains/seed/: PASS
