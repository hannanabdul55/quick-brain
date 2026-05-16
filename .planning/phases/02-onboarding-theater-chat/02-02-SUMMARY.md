---
phase: 02-onboarding-theater-chat
plan: 02
subsystem: api
tags: [nextjs, route-handler, zod, tenant-creation, slug, filesystem, typescript]

requires:
  - phase: 02-onboarding-theater-chat
    plan: 01
    provides: Next.js 15 App Router scaffold, tsconfig.json with @/* alias, lib/gbrain/* Phase 1 harness

provides:
  - POST /api/tenants Route Handler (201/400/500) with zod validation and tenant creation
  - lib/onboarding/schemas.ts: createTenantBodySchema + CreateTenantBody type
  - lib/onboarding/create-tenant.ts: createTenant() + TenantCreationError class
  - HARN-06 invariant: shell-special chars stripped by slugifier before any filesystem use
  - ONBD-03 satisfied: POST /api/tenants completes in <1.2s warm path

affects: [02-03, 02-04, phase-03-insights]

tech-stack:
  added: []
  patterns:
    - "node:fs/promises cp() for recursive directory copy (Node 16.7+ / Bun native)"
    - "Collision-safe slugify: NFD normalize, strip diacritics, replace non-alphanumeric with -, collapse, truncate 38 chars, append -2..-99"
    - "TenantCreationError typed error class (INVALID_INPUT | SLUG_EXHAUSTED | COPY_FAILED | SEED_MISSING)"
    - "import.meta.dir ?? process.cwd() guard in paths.ts for Bun/Next.js cross-runtime compat"
    - "Response.json() (not NextResponse) for portable Route Handler responses"
    - "export const dynamic = force-dynamic to opt out of static optimization on POST routes"

key-files:
  created:
    - lib/onboarding/schemas.ts
    - lib/onboarding/create-tenant.ts
    - app/api/tenants/route.ts
  modified:
    - lib/gbrain/paths.ts (cross-runtime REPO_ROOT derivation fix)

decisions:
  - "process.cwd() fallback in paths.ts: import.meta.dir is Bun-only; Next.js webpack/Node.js runtime returns undefined for it. Guard: typeof import.meta.dir === string"
  - "Slugifier truncates at 38 chars (not 40) to leave 2-char headroom for -N collision suffix"
  - "Collision resolution cap at 99 (DoS-bounded); throws SLUG_EXHAUSTED after 99 attempts"
  - "No businessName in logs: log slug only to avoid operator PII in server console"
  - "brainHome field in TenantRecord (not home): matched Phase 1 TenantRecord shape exactly"

metrics:
  duration: "~5 min"
  started: "2026-05-16T22:29:10Z"
  completed: "2026-05-16T22:34:19Z"
  tasks: 2/2
  files_created: 3
  files_modified: 1
---

# Phase 2 Plan 02: Tenant Creation API Summary

**POST /api/tenants Route Handler with zod validation, collision-safe slugifier, seed brain copy, and in-memory tenant registry — ONBD-03 satisfied in <1.2s warm path**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-16T22:29:10Z
- **Completed:** 2026-05-16T22:34:19Z
- **Tasks:** 2/2
- **Files created:** 3, files modified: 1

## Accomplishments

- Created `lib/onboarding/schemas.ts` exporting `createTenantBodySchema` (businessName max 80, businessType max 40, ownerName max 80) and `CreateTenantBody` type
- Created `lib/onboarding/create-tenant.ts` with `createTenant()` function and `TenantCreationError` class:
  - Slugifier: NFD normalize, strip diacritics, lowercase, replace non-alphanumeric with `-`, collapse repeats, trim, truncate to 38 chars
  - Fallback: all-symbols input produces `business-<timestamp-base36>` to avoid empty slugs
  - Collision resolution: checks both in-memory registry AND filesystem; appends `-2`, `-3`, up to `-99`
  - SEED_MISSING guard: `access(seedBrainHome())` before any cp
  - Uses `node:fs/promises cp(..., { recursive: true })` for atomic seed copy
  - Calls `tenants.init()` once at first use; calls `tenants.upsert()` with full TenantRecord
- Created `app/api/tenants/route.ts` with named `POST` export:
  - JSON parse failure → 400 `{ error: "validation_failed", issues: [{ message: "invalid JSON body" }] }`
  - Zod failure → 400 `{ error: "validation_failed", issues: [...] }`
  - TenantCreationError → 500 `{ error: "creation_failed", code, message }`
  - Success → 201 `{ tenantId, slug }`
  - `export const dynamic = "force-dynamic"` to disable static optimization
- Fixed `lib/gbrain/paths.ts`: `import.meta.dir` is Bun-only and undefined in Next.js/webpack context; added `typeof import.meta.dir === "string"` guard with `process.cwd()` fallback
- Verified: `bun run mutex-smoke` PASS (Phase 1 regression clean), `bunx tsc --noEmit` PASS

## Task Commits

1. **Task 1: zod schema + createTenant domain function** - `8436f0e` (feat)
2. **Task 2: POST /api/tenants Route Handler + paths.ts fix** - `5aa1062` (feat)

## Files Created/Modified

- `lib/onboarding/schemas.ts` - createTenantBodySchema + CreateTenantBody
- `lib/onboarding/create-tenant.ts` - createTenant() + TenantCreationError with 4 error codes
- `app/api/tenants/route.ts` - POST Route Handler (201/400/500)
- `lib/gbrain/paths.ts` - Cross-runtime REPO_ROOT fix (import.meta.dir → process.cwd())

## Decisions Made

- **import.meta.dir → process.cwd() fallback:** `import.meta.dir` is a Bun-specific ESM extension. Next.js (even when run with `bun run dev`) compiles Route Handlers via webpack targeting Node.js runtime. In that context `import.meta.dir` is `undefined`, causing `resolve(undefined, "..", "..")` to throw. Fix: guard with `typeof import.meta.dir === "string"` and fall back to `process.cwd()`, which returns the project root in both runtimes.
- **Slugifier truncates at 38 chars:** The `TENANT_SLUG_REGEX` allows up to 40 chars, but collision suffix `-N` (2 chars) must fit. Truncating base at 38 keeps all collision candidates within the 40-char limit.
- **No PII in logs:** `console.log` emits `slug=<slug>` only, never businessName/ownerName.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed import.meta.dir undefined in Next.js/webpack runtime**
- **Found during:** Task 2 (first dev server test)
- **Issue:** `lib/gbrain/paths.ts` uses `import.meta.dir` (Bun-specific API). When Next.js compiles the Route Handler via webpack/Node.js, `import.meta.dir` is `undefined`, causing `resolve(undefined, "..", "..")` to throw `TypeError: The "paths[0]" argument must be of type string. Received undefined`
- **Fix:** Added `typeof import.meta.dir === "string"` guard; falls back to `process.cwd()` (returns project root in both Bun and Node.js)
- **Files modified:** `lib/gbrain/paths.ts`
- **Commit:** `5aa1062`
- **Impact:** Phase 1 scripts (mutex-smoke, seed) continue to use `import.meta.dir` path (fast, no cwd lookup); Next.js routes use `process.cwd()` path

## Known Stubs

None. The Route Handler is fully wired: zod → createTenant → 201/400/500.

## Threat Flags

None. The slug is validated via `tenantSlugSchema` (regex-enforced) before any filesystem use. Business name is never used directly as a path component (HARN-06 preserved). No new network endpoints beyond the planned `POST /api/tenants`.

## Self-Check: PASSED

- `lib/onboarding/schemas.ts` exists: YES
- `lib/onboarding/create-tenant.ts` exists: YES
- `app/api/tenants/route.ts` exists: YES
- `lib/gbrain/paths.ts` modified: YES
- Commit `8436f0e` exists: YES
- Commit `5aa1062` exists: YES
- `grep -q "export.*createTenantBodySchema" lib/onboarding/schemas.ts`: PASS
- `grep -E "^export.*POST" app/api/tenants/route.ts`: PASS
- `bunx tsc --noEmit`: PASS
- `bun run mutex-smoke`: PASS
- POST /api/tenants 201 in <2s warm path: PASS (1.15s)
- POST /api/tenants {} → 400: PASS
- POST /api/tenants "not json" → 400: PASS
- `brains/<slug>/` created on success: PASS
