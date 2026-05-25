---
status: diagnosed
trigger: "Phase 6 UAT: GET /api/tenants/u-748ccc135b0073/insights returns 500 compute_failed (ENOENT scandir brains/<slug>/brain-repo/originals) for a freshly-provisioned authenticated tenant. D-02 says fresh tenants should yield empty insights, not crash."
created: 2026-05-25T00:00:00Z
updated: 2026-05-25T00:00:00Z
mode: diagnose-only (find_root_cause_only)
---

## Current Focus

hypothesis: The insights compute pipeline is fixture-shaped — it assumes `<sourceDir>/originals/*.md` exists. For authenticated tenants the route passes `brains/<slug>/brain-repo` as `sourceDir`, but a fresh tenant has no `brain-repo/originals/` directory (Phase 7 QBO ingest hasn't run, and even when it does, gbrain owns brain-repo layout and is not guaranteed to produce a fixture-shaped tree). The throw is unhandled in `computeAndCache`, so the route's catch-block converts it to a 500 instead of returning an empty bundle.
test: Read all three compute functions and the route; verify the scandir/readdir call sites and the lack of a no-data guard.
expecting: Confirmation that `top-vendors.ts::computeTopVendors` calls `readdir(join(fixturesDir, "originals"))` unguarded, and that nothing in the cache/route path tolerates a missing source dir for authenticated tenants.
next_action: Diagnosis only — do NOT apply fixes. Return root-cause analysis and recommended fix(es) to the caller (plan-phase --gaps).

## Symptoms

expected: For a freshly-provisioned authenticated tenant (no QBO data yet) at `/dash/<slug>`, `GET /api/tenants/<slug>/insights` should return an empty/null insight bundle (200 OK with empty arrays / null pnl), per D-02 ("real tenants get empty insights until Phase 7 QBO ingest").
actual: `GET /api/tenants/u-748ccc135b0073/insights` returns 500 with body `{"error":"compute_failed","message":"ENOENT: no such file or directory, scandir '/Users/abdulhannankanji/Git repos/quick-brain/brains/u-748ccc135b0073/brain-repo/originals'"}`. The `InsightCardsRow` dashboard component logs `Insights API error: 500 ...`.
errors: |
  ENOENT: no such file or directory, scandir '/Users/abdulhannankanji/Git repos/quick-brain/brains/u-748ccc135b0073/brain-repo/originals'
  (Earlier transient variant during another invocation: ENOENT on `open .../brain-repo/originals/monthly-close-2026-03.md` — same root cause, different Promise.all arm winning the race.)
reproduction: |
  1. Have `AUTH_ENABLED=1` and sign in as a brand-new user. A tenant slug like `u-748ccc135b0073` is provisioned.
  2. Confirm `brains/u-748ccc135b0073/` either does not exist OR exists but contains no `brain-repo/originals/` subtree (it does not, on the affected machine).
  3. Visit `/dash/u-748ccc135b0073`. The dashboard mounts `InsightCardsRow` which calls `GET /api/tenants/u-748ccc135b0073/insights`.
  4. Observe 500 `compute_failed` with the ENOENT scandir message above.
started: Always, for any authenticated tenant that has no QBO data yet (Phase 6 territory — Phase 7 is what would populate the brain).

## Eliminated

- hypothesis: Fixture filename leakage (e.g. `monthly-close-2026-03.md` literally appears in the tenant's failure path, suggesting a stale cache or path bleed).
  evidence: `lib/insights/pnl.ts:83` hardcodes the literal string `"monthly-close-2026-03.md"` and joins it onto whatever `fixturesDir` is passed in (`join(fixturesDir, "originals", "monthly-close-2026-03.md")`). When the route passes `brain-repo` as `fixturesDir`, the resulting path is `<brain-repo>/originals/monthly-close-2026-03.md` — that is the path *the code is constructing on every call for that tenant*, not leakage from the seed cache. There is no stale cache: `cache.set(tenantId, bundle)` (cache.ts:42) keys strictly by `tenantId`, and the seed prewarm only populates `SEED_TENANT_ID`. The fresh tenant slug is never in the cache.
  timestamp: 2026-05-25 (diagnosis)

- hypothesis: Stale insights cache from a previous seed run referencing fixture paths.
  evidence: Same as above — cache is keyed by tenantId, never crosses tenants, and the throw occurs *during* the first compute (no cache write happens because `Promise.all` rejects before the bundle is built).
  timestamp: 2026-05-25 (diagnosis)

## Evidence

- timestamp: 2026-05-25
  checked: `app/api/tenants/[id]/insights/route.ts:74-108`
  found: For authenticated tenants the route computes `sourceDir = join(brainHome(brainSlug), "brain-repo")` (line 92) and calls `computeAndCache(brainSlug, sourceDir)` (line 97). No `fs.access`/`stat` guard for the directory's existence before the call. The catch-block on lines 98-107 converts any throw into a 500 `compute_failed`, including ENOENT.
  implication: The route trusts `computeAndCache` to be safe for empty/missing source dirs, but `computeAndCache` does not handle that case.

- timestamp: 2026-05-25
  checked: `lib/insights/cache.ts:25-44`
  found: `computeAndCache` does `Promise.all([computeTopVendors(fixturesDir), computePnl(fixturesDir), computeAnomalies(fixturesDir)])`. No try/catch wrapper, no existence check. Any rejection from any of the three propagates out and the cache is never set.
  implication: No no-data guard at the cache layer. The function has no notion of "this tenant has no data yet, return empty bundle."

- timestamp: 2026-05-25
  checked: `lib/insights/top-vendors.ts:13-18`
  found: `const originalsDir = join(fixturesDir, "originals"); const allFiles = await readdir(originalsDir);` — this is the literal throw site. `readdir` on a non-existent directory throws `ENOENT: ... scandir <path>`, matching the user's exact error string.
  implication: **CONFIRMED throw site for the current symptom.** No try/catch, no existence check, no empty-array fallback.

- timestamp: 2026-05-25
  checked: `lib/insights/pnl.ts:79-87`
  found: `computePnl` does `await parseMonthlyClose(join(fixturesDir, "originals", "monthly-close-2026-03.md"))` *unguarded* (line 87). The optional prev-month read is wrapped in try/catch, but the current-month read is not. `parseMonthlyClose` calls `readFile` which throws ENOENT for a missing file.
  implication: This is the source of the earlier transient error variant the operator saw (`open .../monthly-close-2026-03.md`). Same root cause; whichever arm of the `Promise.all` rejects first wins the error message. Both arms throw ENOENT for fresh tenants — `readdir` (top-vendors) and `readFile` (pnl).

- timestamp: 2026-05-25
  checked: `lib/insights/anomalies.ts:54-58`
  found: `computeAnomalies` does `await readFile(join(fixturesDir, "concepts", "march-anomaly-summary.md"), "utf-8")` unguarded — third independent ENOENT source for fresh tenants.
  implication: All three compute functions share the same bug class: they assume fixture-shaped layout and throw on absence.

- timestamp: 2026-05-25
  checked: Filesystem — `brains/` and `brains/u-748ccc135b0073/`
  found: `brains/` exists with subdirs `mara-s-coffee/`, `seed/`, `spike-supabase/`, plus a `.gitkeep`. The user's affected slug `u-748ccc135b0073/` is **not present at all** on disk on this machine. Even if it were, gbrain owns the `brain-repo/` layout — there is no contract that gbrain produces an `originals/` subdir matching the hand-curated `data/maras-coffee/originals/` shape.
  implication: Verdict B (wrong sourceDir layout assumption) is structurally correct in addition to verdict A — even *after* Phase 7 QBO ingest, the compute functions are unlikely to find their hand-curated fixture filenames (e.g. `monthly-close-2026-03.md`, `march-anomaly-summary.md`) at the expected paths inside `brain-repo`. Phase 7 will produce QBO-derived markdown via the conventions in `docs/brain-schema.md`, not seed-style aggregates.

- timestamp: 2026-05-25
  checked: `lib/insights/prewarm.ts:21-44` and `app/api/tenants/[id]/insights/route.ts:42`
  found: Prewarm only fires for `SEED_TENANT_ID` against `FIXTURES_ROOT`. The route imports `prewarm` for its side-effect. Prewarm errors are swallowed (`console.warn`, no throw). Cache writes are keyed by tenantId.
  implication: No cross-tenant cache contamination. Rules out verdict D (stale cache) and verdict C (fixture leakage) cleanly. The seed bundle, if any, sits at `cache.get("seed")` and is invisible to `cache.get("u-748ccc135b0073")`.

## Resolution

root_cause: |
  The three insight compute functions (`computeTopVendors`, `computePnl`, `computeAnomalies`) are fixture-shape-coupled. They assume the source directory has the exact layout of `data/maras-coffee/`:
    - `<sourceDir>/originals/invoice-*.md`
    - `<sourceDir>/originals/monthly-close-YYYY-MM.md`
    - `<sourceDir>/concepts/march-anomaly-summary.md`
  Each function calls `fs.readdir` or `fs.readFile` unguarded and throws ENOENT when the path doesn't exist. The insights route (`app/api/tenants/[id]/insights/route.ts:92`) passes `join(brainHome(brainSlug), "brain-repo")` as the sourceDir for authenticated tenants. A freshly-provisioned tenant has no such directory — gbrain only creates `brain-repo` once data is ingested, and even when Phase 7 QBO ingest runs, the resulting layout will not contain the hand-curated fixture filenames the compute functions hard-code. `computeAndCache` propagates the ENOENT unchanged, the route catch-block converts it to 500 `compute_failed`, and the dashboard renders an error instead of empty cards.

  **Primary throw site (current symptom):** `lib/insights/top-vendors.ts:17` — `await readdir(originalsDir)` where `originalsDir = join(fixturesDir, "originals")`.

  **Secondary throw sites (same bug class, different `Promise.all` arms):**
    - `lib/insights/pnl.ts:87` — `await parseMonthlyClose(currentPath)` → `readFile`
    - `lib/insights/anomalies.ts:58` — `await readFile(filePath, "utf-8")`

  Violates D-02 ("real tenants get empty insights until Phase 7 QBO ingest") because "empty insights" was never actually implemented — only the seed path was exercised end-to-end before this UAT.

fix: |
  Not applied (diagnose-only mode). See "Recommended fix" section below for ranked options.
verification: |
  Pending fix application.
files_changed: []

---

## Root Cause Verdicts

### A. Missing directory guard in computeAndCache — **CONFIRMED**

- `lib/insights/cache.ts:25-44`: `computeAndCache` runs all three compute functions inside `Promise.all` with no try/catch, no existence check. Any ENOENT bubbles up unhandled.
- `lib/insights/top-vendors.ts:17`: `await readdir(originalsDir)` is the literal `scandir` call in the user's error message.
- `lib/insights/pnl.ts:87` and `lib/insights/anomalies.ts:58`: same bug class (unguarded `readFile`).
- Route (`app/api/tenants/[id]/insights/route.ts:96-107`) has a catch-block but it converts the throw into a 500 instead of treating ENOENT as "empty bundle."

### B. Wrong sourceDir layout assumption — **CONFIRMED (structural)**

- The compute functions are coupled to the fixture layout: `<sourceDir>/originals/{invoice-*.md, monthly-close-YYYY-MM.md}` and `<sourceDir>/concepts/march-anomaly-summary.md` (literal filenames at `pnl.ts:83-85` and `anomalies.ts:57`).
- The route passes `brains/<slug>/brain-repo` as sourceDir (route.ts:92). Even *after* Phase 7 QBO ingest, gbrain's `brain-repo` will not contain hand-curated aggregates like `march-anomaly-summary.md` or `monthly-close-2026-03.md`.
- This is not the immediate cause of the 500 (verdict A is) but it means even guarding ENOENT yields *permanently* empty insights for real tenants until the compute functions are reworked to read from gbrain query output or QBO-derived markdown (per Phase 7's QBO transformer + `docs/brain-schema.md`).

### C. Fixture leakage (cache or path bleed) — **RULED OUT**

- The cache is strictly tenantId-keyed (`cache.ts:12, 42`). Seed prewarm writes `cache.get("seed")`; the fresh tenant slug has its own cache slot.
- The literal string `monthly-close-2026-03.md` appears once in code (`pnl.ts:83`) and is joined onto whatever `fixturesDir` is passed in. The earlier `monthly-close-2026-03.md` error was simply that variable being interpolated into the tenant's brain-repo path — not leakage from a seed run.

### D. Stale insights cache from a previous seed run — **RULED OUT**

- `cache.set(tenantId, bundle)` only fires *after* `Promise.all` resolves successfully. For fresh tenants the rejection happens first, so no bundle is ever written.
- No cross-tenant cache reads happen anywhere in `lib/insights/`.
- Prewarm only fires for `SEED_TENANT_ID` (`prewarm.ts:28`), so cache cannot be polluted by the fresh tenant's failure.

---

## Recommended Fix(es) — ranked by effort

### Fix 1 (recommended, smallest, restores D-02 invariant). Add a no-data guard in the route or computeAndCache.

**Effort:** ~10 min, ~10 LOC.

**Where:** Two equally good options — pick one. I recommend the route, because it keeps `computeAndCache` semantics ("throw on broken fixtures") clean for the seed path.

**Option 1a — guard at the route (preferred):**

`app/api/tenants/[id]/insights/route.ts` — replace the authenticated cache-fill block (lines 92-108) with:

```ts
const sourceDir = join(brainHome(brainSlug), "brain-repo");

let bundle = getCachedInsights(brainSlug);
if (!bundle) {
  // D-02: a real tenant's brain is empty until Phase 7 QBO ingest.
  // If the source directory doesn't exist (fresh tenant, no ingest yet),
  // return an empty bundle rather than 500.
  const originalsExists = await stat(join(sourceDir, "originals"))
    .then((s) => s.isDirectory())
    .catch(() => false);

  if (!originalsExists) {
    bundle = {
      topVendors: [],
      pnl: null,
      anomalies: [],
      computedAt: Date.now(),
    };
    // Optionally cache it so subsequent requests don't re-stat.
    // Skipping cache.set keeps the door open for prompt refresh after Phase 7 ingest.
  } else {
    try {
      bundle = await computeAndCache(brainSlug, sourceDir);
    } catch (err: unknown) {
      console.error("[insights] compute failed for", brainSlug, err);
      return Response.json(
        { error: "compute_failed", message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }
  }
}

return Response.json(bundle, { status: 200 });
```

Add `import { stat } from "node:fs/promises";` at the top.

**`PnlSnapshot | null`** — verify the type allows `null`. If not, add `| null` to the route's response type and to the `pnl` field in `lib/insights/types.ts`. The dashboard `InsightCardsRow` must also tolerate `pnl: null` and render a "no data yet" state — check `components/.../InsightCardsRow*` before merging.

**Option 1b — guard inside computeAndCache:**

`lib/insights/cache.ts` — wrap each compute call so missing-dir/missing-file ENOENT becomes an empty result, but other errors still throw. Slightly more code, but localizes the policy. Skip unless the dashboard already calls `computeAndCache` from another path that also needs the guard (it does not as of this commit).

**Preserves seed path:** YES. The seed route branch (lines 57-72) still calls `computeAndCache(SEED_TENANT_ID, FIXTURES_ROOT)` against the well-populated fixture dir. No code on that branch changes.

### Fix 2 (defensive, complementary, still small). Make each compute function safe when source files are missing.

**Effort:** ~15 min, ~15 LOC across three files.

Defense in depth — even if Fix 1 misses an edge case, the compute layer can't 500.

- `top-vendors.ts:17`: wrap `readdir` in try/catch and return `[]` on ENOENT (rethrow other errors).
- `pnl.ts:87`: wrap `parseMonthlyClose(currentPath)` in try/catch and return `null` (or a sentinel with `month: "2026-03"` and zeros) on ENOENT.
- `anomalies.ts:58`: wrap `readFile` in try/catch and return `[]` on ENOENT (but only if the *anomaly summary file* is missing; do NOT swallow the "<3 rows" parse-error throw on line 96-100, which still indicates corrupt fixtures).

This makes the modules robust to *any* caller that hands them a sparse source dir, not just the route.

**Preserves seed path:** YES. Seed has fully-populated fixtures, so none of the guards fire.

### Fix 3 (longer term, Phase 7 territory — do NOT apply now).

After Phase 7 ships the QBO transformer per `docs/brain-schema.md`, the compute functions will need to be reworked to read from QBO-derived markdown (whose layout will match the canonical schema, not the hand-curated `monthly-close-*` / `march-anomaly-summary.md` aggregates). Either:

- Have the QBO transformer emit fixture-shaped aggregates (`monthly-close-YYYY-MM.md`, an `originals/` subdir of synthesized invoices, etc.) so the compute functions work unchanged.
- OR rewrite the compute functions to consume gbrain query output / a structured QBO-cache the transformer publishes.

This is out of scope for Phase 6. Fix 1 unblocks UAT now; Fix 3 is a Phase 7 design discussion.

### Recommendation

**Ship Fix 1a only.** It is the smallest change that restores the D-02 invariant ("empty insights for fresh tenants is acceptable") and unblocks Phase 6 UAT. Fix 2 is nice-to-have defense-in-depth but not strictly necessary — once Fix 1 lands, the only path that calls these compute functions for non-existent dirs is gone. Skip Fix 3 entirely until Phase 7 planning.

---

## Open Questions

1. **`InsightBundle` type and `InsightCardsRow` UI:** does the bundle type permit `pnl: null` and empty `topVendors`/`anomalies` arrays without breaking rendering? I did not read `lib/insights/types.ts` or the `InsightCardsRow` component during this read-only investigation. The fix may also need a small type adjustment (`PnlSnapshot | null`) and a UI "no data yet" empty state. Worth checking before merging Fix 1.
2. **Should the empty bundle be cached?** Fix 1a deliberately does NOT call `cache.set` for the empty case so that the *first* request after Phase 7 ingest does a fresh compute. If the route is ever hit thousands of times before ingest, the per-request `stat` is the only overhead — negligible, but worth a one-line note in the route.
3. **Phase 7 layout contract:** Once QBO ingest lands, will the compute functions read fixture-shaped aggregates (so they keep working) or QBO-derived markdown directly? This decision affects whether Fix 3 is "regenerate aggregates" or "rewrite compute". Defer to Phase 7 planning.
4. **Why did the operator see two different errors (`scandir originals` and `open monthly-close-2026-03.md`) on different runs?** Both are the same bug class — three `Promise.all` arms each capable of ENOENT, and whichever rejects first wins the rejection. Non-deterministic but harmless once Fix 1 lands.
