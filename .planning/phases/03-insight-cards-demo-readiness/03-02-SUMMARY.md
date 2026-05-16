---
phase: 03-insight-cards-demo-readiness
plan: 02
subsystem: api
tags: [typescript, insights, route-handler, cache, next-js]

# Dependency graph
requires:
  - phase: 03-insight-cards-demo-readiness
    plan: 01
    provides: lib/insights/cache.ts (getCachedInsights, computeAndCache), lib/insights/types.ts (InsightBundle), lib/insights/prewarm.ts
  - phase: 02-onboarding-theater-chat
    provides: lib/gbrain/slug.ts (tenantSlugSchema), lib/gbrain/tenants.ts (init, get), lib/gbrain/paths.ts (FIXTURES_ROOT, SEED_TENANT_ID)
provides:
  - app/api/tenants/[id]/insights/route.ts — GET handler returning InsightBundle JSON
affects:
  - 03-03 (dashboard UI fetches this endpoint for insight card data)
  - 03-04 (reset endpoint invalidates cache; this endpoint reads from same cache)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Seed tenant special-cased to bypass filesystem tenant registry (brains/ dir not required for seed)"
    - "Prewarm import side-effect in Route Handler to ensure seed cache is filled at module load"
    - "Cache-first read: getCachedInsights() → computeAndCache() fallback"

key-files:
  created:
    - app/api/tenants/[id]/insights/route.ts
  modified:
    - lib/insights/cache.ts (fix .js → .ts import extensions for Next.js webpack compat)
    - lib/insights/anomalies.ts (fix .js → .ts import extension)
    - lib/insights/pnl.ts (fix .js → .ts import extension)
    - lib/insights/prewarm.ts (fix .js → .ts import extensions)
    - lib/insights/top-vendors.ts (fix .js → .ts import extensions)

key-decisions:
  - "Special-case seed tenant: isSeed check bypasses tenants.get() to avoid dependency on brains/seed/ directory existence in the running process cwd"
  - "Import prewarm.ts as a side-effect import in the Route Handler to ensure the seed cache is filled before the first request arrives"
  - "Fix .js → .ts import extensions in all lib/insights/* files: Wave 1 agent wrote Bun-native .js extensions which Next.js/webpack cannot resolve to .ts source files"

patterns-established:
  - "route.ts: export const dynamic = 'force-dynamic' prevents Next.js static optimization"
  - "Seed tenant bypass: isSeed = tenantId === SEED_TENANT_ID; skip registry check for seed"

requirements-completed:
  - INSI-01

# Metrics
duration: 6min
completed: 2026-05-16
---

# Phase 3 Plan 02: Insights Batch API Endpoint Summary

**GET /api/tenants/[id]/insights Route Handler backed by lib/insights/cache.ts — cache-first read, seed tenant special-cased, 400/404/500 guards, zero gbrain CLI spawns, <10ms cache-hit response time**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-16T23:37:08Z
- **Completed:** 2026-05-16T23:43:00Z
- **Tasks:** 1 completed
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `GET /api/tenants/seed/insights` returns 200 with `{topVendors[5], pnl{month:"2026-03"}, anomalies[3], computedAt:<number>}`
- Cache hit proven: repeated requests return identical `computedAt` in ~5ms
- Invalid slug (`INVALID!`) → 400 with Zod issues array
- Unknown tenant (`does-not-exist`) → 404 with error message
- No gbrain CLI spawn anywhere in the GET path
- TypeScript compiles clean (`bunx tsc --noEmit`)

## Endpoint Details

| Attribute | Value |
|-----------|-------|
| URL | `GET /api/tenants/[id]/insights` |
| Success status | 200 |
| Response shape | `{topVendors: TopVendorRow[], pnl: PnlSnapshot, anomalies: AnomalyRow[], computedAt: number}` |
| Cache hit latency | ~5ms (pre-warmed seed tenant) |
| First request latency | ~100ms (compute from fixtures) |
| Slug validation | 400 on fail (tenantSlugSchema) |
| Tenant not found | 404 (skipped for seed tenant) |
| Compute failure | 500 with error message |

## Verified Output (seed tenant)

```json
{
  "topVendors": [
    {"vendor": "landlord-llc",      "total": 13650,    "invoiceCount": 6},
    {"vendor": "beanstalk-roasters", "total": 4830,    "invoiceCount": 6},
    {"vendor": "square-pos",         "total": 4048.45, "invoiceCount": 6},
    {"vendor": "pge-utility",        "total": 2393.30, "invoiceCount": 6},
    {"vendor": "seven-shifts",       "total": 129,     "invoiceCount": 6}
  ],
  "pnl": {
    "month": "2026-03",
    "revenue": 27480, "cogs": 1830, "opex": 6857.95, "net": 18792.05,
    "prevMonth": {"month": "2026-02", "revenue": 24750, "cogs": 1500, "opex": 6645.8, "net": 16604.2}
  },
  "anomalies": [
    {"date": "2026-03-01", "vendorSlug": "beanstalk-roasters", "dollarImpact": 330, ...},
    {"date": "2026-03-04", "vendorSlug": "square-pos",         "dollarImpact": 79,  ...},
    {"date": "2026-03-31", "vendorSlug": "seven-shifts",       "dollarImpact": 43,  ...}
  ],
  "computedAt": 1778974959330
}
```

## Task Commits

1. **Task 1: GET /api/tenants/[id]/insights batch endpoint** — `cf02997` (feat)

## Files Created/Modified

- `app/api/tenants/[id]/insights/route.ts` — GET Route Handler: slug validation → seed special-case → cache-first read → 200/400/404/500
- `lib/insights/cache.ts` — Fixed `.js` → `.ts` import extensions (webpack compat)
- `lib/insights/anomalies.ts` — Fixed `.js` → `.ts` import extension
- `lib/insights/pnl.ts` — Fixed `.js` → `.ts` import extension
- `lib/insights/prewarm.ts` — Fixed `.js` → `.ts` import extensions
- `lib/insights/top-vendors.ts` — Fixed `.js` → `.ts` import extensions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed .js → .ts import extensions in lib/insights/* files**
- **Found during:** Task 1 verification (HTTP 500 on first dev server run)
- **Issue:** Wave 1 agent wrote Bun-native `.js` extensions for relative imports in `lib/insights/cache.ts`, `top-vendors.ts`, `pnl.ts`, `anomalies.ts`, `prewarm.ts`. Next.js webpack bundler cannot resolve `.js` to `.ts` source files (unlike Bun which does this natively). This caused `Module not found: Can't resolve './top-vendors.js'` at runtime.
- **Fix:** Changed all relative import extensions from `.js` to `.ts` across all 5 lib/insights files.
- **Files modified:** `lib/insights/cache.ts`, `lib/insights/top-vendors.ts`, `lib/insights/pnl.ts`, `lib/insights/anomalies.ts`, `lib/insights/prewarm.ts`
- **Commit:** `cf02997`

**2. [Rule 2 - Missing functionality] Seed tenant special-case for registry bypass**
- **Found during:** Task 1 verification (HTTP 404 after fixing the .js extension bug)
- **Issue:** `tenants.init()` scans the `brains/` directory under the process CWD. In the worktree context, no `brains/seed/` directory exists (it's in the main repo). The environment note explicitly warned about this: "CRITICAL — `brains/seed/` is a special tenant. Do NOT block on `getTenant('seed')` returning a record."
- **Fix:** Added `isSeed` check: when `tenantId === SEED_TENANT_ID`, skip the tenant registry lookup entirely. The seed's InsightBundle is always in the cache (pre-warmed by prewarm.ts at module load). Also added `import "@/lib/insights/prewarm"` as a side-effect import to ensure pre-warm fires.
- **Files modified:** `app/api/tenants/[id]/insights/route.ts`
- **Commit:** `cf02997`

## Known Stubs

None — the endpoint returns real computed data from the seed fixtures.

## Threat Surface Scan

No new network endpoints beyond the one this plan is implementing. The route validates tenant slugs via `tenantSlugSchema` (zod regex; prevents path traversal and shell injection). No file paths are constructed from user input (FIXTURES_ROOT is a compile-time constant). No new trust boundaries introduced.

## Self-Check: PASSED

Files verified:
- FOUND: app/api/tenants/[id]/insights/route.ts
- FOUND: lib/insights/cache.ts
- FOUND: lib/insights/anomalies.ts
- FOUND: lib/insights/pnl.ts
- FOUND: lib/insights/prewarm.ts
- FOUND: lib/insights/top-vendors.ts

Commits verified:
- cf02997: feat(03-02): GET /api/tenants/[id]/insights batch endpoint

---
*Phase: 03-insight-cards-demo-readiness*
*Completed: 2026-05-16*
