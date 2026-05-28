---
spike: 010
name: per-tenant-engine-rls
type: standard
validates: "Given gbrain's single-shared-engine + per-call sourceId pattern (lib/gbrain/engine.ts) under multi-tenant load, when 20 interleaved concurrent queries hit two tenants and the same slug is written under both sourceIds, then per-call scoping prevents cross-tenant content leakage — AND surface any 'forgot to pass sourceId' bug class that would leak across tenants by default"
verdict: PARTIAL
related: [005, 006, 007]
tags: [rls, multi-tenant, in-process, architecture, isolation, gbrain, sourceId, security]
---

# Spike 010: per-tenant engine context

## What This Validates

The architectural commitment of `lib/gbrain/engine.ts` is that **one** long-lived
`BrainEngine` instance serves every tenant in the Vercel Fluid Compute worker
(no per-tenant connection accumulation, no eviction), with isolation enforced
**per call** via the `sourceId` argument to `hybridSearch` and friends. This
spike asks whether that bet survives:

1. Concurrent multi-tenant access on the same shared engine.
2. A slug-name collision across two tenants (same `originals/march-bills`
   slug, two different tenants, different content).
3. The "forgot to pass sourceId" bug class (a missing arg in a call site).

The answer determines whether QuickBrain can keep the cheap one-engine
architecture (Phase 4 / Phase 7) or must pay per-request engine cost.

## Research

Key finding from pre-spike research at `node_modules/gbrain/src/core/schema-embedded.ts:889`:

> "The postgres role (used by gbrain via pooler) has BYPASSRLS."

gbrain ENABLES RLS on every public table (spike 005 confirmed 41/41 tables) BUT
the role we connect as via the Supabase pooler holds `BYPASSRLS`. **So RLS does
NOT enforce isolation for QuickBrain.** RLS is defense-in-depth against the
Supabase `anon` role (e.g., if someone bypasses our Next.js and connects with
the Supabase public anon key, they hit RLS — that's its job). For our own
app-layer code, isolation must come entirely from per-call `sourceId` scoping.

This reframed the spike: it's now an **app-layer** isolation spike, not an RLS
spike. The original framing (does RLS protect us with shared engine?) was wrong;
the spike asks instead: does the existing app-layer pattern survive concurrent
multi-tenant load, and what call shapes leak across tenants by default?

Other prior art:
- Spike 006 — proved in-process retrieval works with the single-engine pattern
  in `lib/gbrain/engine.ts` (1 tenant only).
- Spike 007 — proved positive + negative isolation for **one** sequential query
  pair against the same engine.
- gbrain operations: `sourceId` is plumbed through `getPage(slug, {sourceId})`,
  `hybridSearch(engine, query, {sourceId})`, `engine.listPages({sourceId})`,
  `importFromContent(engine, slug, content, {sourceId})`. Every method that
  takes a sourceId scopes correctly when one is passed. Behavior when one is
  NOT passed is the bug-class boundary.

## How to Run

```bash
cd "quick-brain"
set -a && . ./.env.local && set +a   # SUPABASE_DB_URL_POOLER + OPENAI_API_KEY
export PATH="$HOME/.bun/bin:$PATH"
bun .planning/spikes/010-per-tenant-engine-rls/spike.ts
```

The script:
1. Configures gbrain (gateway + engine, same as production).
2. Pre-registers two source rows: `spike-010-tenant-a`, `spike-010-tenant-b`.
3. Writes the **same** slug `originals/spike-010-shared-slug` to BOTH tenants
   with different content (each carries a per-tenant secret marker).
4. **PROBE 1:** `getPage(slug, {sourceId: A})` returns A's content, `getPage(slug, {sourceId: B})` returns B's content, no cross-talk.
5. **PROBE 2:** Fire 20 concurrent `hybridSearch` calls via `Promise.all`, alternating tenants every other call. None may see the other tenant's secret marker.
6. **PROBE 3 (informational leak class):** Call `hybridSearch` WITHOUT a sourceId. What does it return?
7. **PROBE 4 (the dangerous bug class):** Call `engine.getPage(slug)` WITHOUT a sourceId on a slug that exists under both tenants. Which tenant wins?
8. **PROBE 5:** `engine.listPages()` with and without scope — admin enumeration shape.
9. Cleanup: `DELETE FROM sources WHERE id = ANY($1)` cascades pages + chunks.

Open `result.html` for a visual verdict matrix.

## What to Expect

PROBES 1, 2, 3, 5 pass (existing design works as intended). PROBE 4 fails —
`getPage(slug)` without sourceId arbitrarily returns one tenant's row. This is
the architectural finding: **gbrain has no fail-safe default for sourceId.**

## Observability

`spike-events.json` is the forensic log with 5 probe verdicts + 28 timed events.
The verdicts table at the top of the file is the at-a-glance summary. Each
probe carries a `detail` field documenting exactly what it observed.

## Investigation Trail

### Probes that passed (the design works under load)

**PROBE 1: Composite-key isolation.** Wrote the same slug under two sourceIds.
`getPage(slug, {sourceId: A})` returned A's content with marker
`TENANT_A_SECRET_MARKER`; `getPage(slug, {sourceId: B})` returned B's content
with `TENANT_B_SECRET_MARKER`. Neither saw the other. The `(slug, source_id)`
composite key works as documented. 165ms total.

**PROBE 2: 20 concurrent interleaved queries.** Fired
`Array.from({length: 20}, (_, i) => hybridSearch(engine, query, {sourceId: i%2 ? A : B}))`
through `Promise.all`. All 20 completed in 7586ms (~380ms each, amortized via
pool concurrency). **0/20 calls leaked the other tenant's secret marker.** The
single-shared-engine pattern survives concurrent multi-tenant access. There is
no connection-state pollution or "sticky sourceId" hazard.

**PROBE 3: Unscoped `hybridSearch` (informational).** Called
`hybridSearch(engine, query)` with NO sourceId. Returned 10 results spanning
all sources — `spike-010-tenant-a` page (score 0.86), `spike-010-tenant-b` page
(score 0.88), and 8 unrelated pages from the `default` source. This is gbrain's
documented "federated" default — but for QuickBrain in production, ANY code
path that omits sourceId becomes a cross-tenant leak. (Not failed per se —
spike's purpose was to surface the boundary, which it did.)

**PROBE 5: `listPages` scope.** With `{sourceId: A}` returned 1 page (A's
shared-slug row); with `{sourceId: B}` returned 1 page (B's); with `{}`
returned 50 pages (federated across default + both tenants). Same finding as
PROBE 3 — scoping works, no scoping = federated.

### The probe that failed (the real finding)

**PROBE 4: `getPage(slug)` WITHOUT sourceId — `getPage('originals/spike-010-shared-slug')`.**

```
Expected: null (safe — defaults to source_id='default' which has no such slug)
Actual:   returns tenant A's page (arbitrary winner across tenants)
```

The same slug exists in two sourceIds (A + B). `engine.getPage(slug)` with no
options returned **tenant A's row** — apparently because Postgres returned the
first row matched without a `WHERE source_id = $1` filter.

**This is the bug class:** any QuickBrain code path that calls `engine.getPage(slug)`
or `engine.deletePage(slug)` or `getTags(slug)` without passing the authenticated
user's sourceId will return / mutate **someone else's** content arbitrarily.
There is no exception thrown, no warning logged, no audit trail. The leak is
silent.

In a Phase 7 production setting with N tenants each storing pages under their
own sourceId, a call like `engine.getPage('originals/march-bills')` (no scope)
would return whichever tenant's row happened to win the implicit Postgres
selection — potentially leaking financial data across tenants.

### Surprising gotcha

PROBE 3 (the unscoped hybridSearch) showed that **even sources OTHER than the
two test tenants leaked into the unscoped result set** (8 of 10 results were
from the `default` source's seed brain). This means gbrain's "no sourceId =
federated" is fully open by default, not even constrained to the caller's
known sources. For Phase 7's `/api/chat` route, an unscoped query would also
return the synthetic seed brain's pages alongside any tenant's. The fix is
the same — every call site must scope.

### Why this is a Phase 7 blocker (not just informational)

The `lib/gbrain/engine.ts` design documented that "isolation is enforced per
call via the sourceId argument." That's true and proven (PROBE 1 + 2). But the
**failure mode is silent**. There is no compile-time guard ("you must pass
sourceId"), no runtime guard ("missing sourceId in multi-tenant context →
throw"), no test that fails when a new call site forgets the arg.

Phase 7 will add `lib/connectors/qbo/` with several new gbrain call sites
(transformer's wipe-on-resync `deletePage`, status checks, `getPage` lookups
to test whether a vendor has been ingested before). Each one is a potential
silent leak vector.

## Results

**VERDICT: PARTIAL ⚠**

The architectural design is **sound when used correctly** — per-call sourceId
isolates writes and reads across tenants, the single-shared-engine pattern
survives concurrent multi-tenant load, and the composite key
`(source_id, slug)` cleanly partitions rows.

But the failure mode is silent. **gbrain has no fail-safe default for sourceId.**
Any call to `getPage` / `deletePage` / `getTags` / `hybridSearch` without a
sourceId arg silently returns / mutates / federates across all sources. There
is no exception, no warning, no audit trail.

### Confirmed facts

| Question | Answer |
|---|---|
| Does the single-shared-engine pattern work for multi-tenant? | YES under concurrency (20 interleaved queries, 0 leaks) |
| Do `(source_id, slug)` composite keys actually isolate? | YES — same slug under two sourceIds = two independent rows |
| Is RLS protecting us against in-app code paths that forget sourceId? | NO — postgres role has BYPASSRLS |
| Does `engine.getPage(slug)` without sourceId fail safely? | NO — returns one tenant's row arbitrarily, silently |
| Does `engine.hybridSearch(engine, q)` without sourceId fail safely? | NO — returns federated rows across all sources |
| Is there a fail-safe sourceId default in gbrain? | NO |

### Findings that shape Phase 4 + Phase 7 (and every future gbrain caller)

1. **The `lib/auth/resolve-tenant.ts` chokepoint pattern is necessary but not
   sufficient.** It scopes the tenant for the request's identity layer. But
   the chokepoint must extend to a **wrapping API** for every gbrain call so
   no code path can call `engine.getPage(slug)` directly. Proposal: introduce
   `lib/gbrain/tenant-scoped.ts` exporting `tenantSafeGetPage(tenantId, slug)`,
   `tenantSafeListPages(tenantId, filters)`, `tenantSafeHybridSearch(tenantId, q)`.
   The bare `engine.*` methods become forbidden imports outside `lib/gbrain/`.

2. **Add a lint rule.** A custom ESLint rule rejects `engine.getPage(`,
   `engine.deletePage(`, `engine.listPages(` directly in app code (anywhere
   outside `lib/gbrain/`). All callers go through the tenant-safe wrappers.
   Cheap structural defense, killed at compile time.

3. **Audit existing call sites NOW.** Before Phase 7 lands, grep every
   existing `engine.getPage`, `engine.deletePage`, `engine.listPages`,
   `engine.getTags`, `hybridSearch` call across `lib/`, `app/`, `scripts/`
   and confirm each one passes a per-request tenantId-derived sourceId. The
   Phase 6 work shipped without this audit; any oversight is a live leak.

4. **No engine-side fix is forthcoming.** gbrain's `OperationContext`
   threading (`sourceScopeOpts`) already handles the MCP/OAuth path — the
   federated-vs-scalar precedence at the engine level is correct. The gap is
   that the BARE engine methods don't refuse a missing sourceId, because in
   the gbrain CLI context (single-user, single-source) there's only ever one
   source and the bare call is the desired behavior. The fix has to live in
   QuickBrain's wrapper layer, not gbrain's.

5. **The concurrency story is good news.** PROBE 2 means the v2.0 architecture
   can keep the cheap single-engine pattern under multi-tenant load. No need
   to per-tenant the engine pool, no need to re-evaluate the mutex layer. The
   only required change is the **wrapper layer** (item 1) — the engine itself
   is fine.

### What this means for Phase 7 plan changes

Before Phase 7 plan 07-01 (or wherever first ingest lands) executes, Phase 7
needs a new plan / new task: **`lib/gbrain/tenant-scoped.ts` + ESLint rule
banning bare `engine.*` access outside `lib/gbrain/`**. Otherwise every new
QBO call site is another opportunity for a silent leak. This is non-negotiable
for a "real-world SMB owner" product (memory: project-post-hackathon-pivot
locked v2.0 priorities around production safety).

### Cross-references

- Spike 005 — `gbrain-on-supabase` discovered that RLS is auto-enabled on 41/41
  tables. THIS spike is the follow-up that finds out RLS doesn't help against
  in-app leaks because we connect with BYPASSRLS.
- Spike 006 — `gbrain-in-process` proved the single-engine pattern works for
  retrieval. THIS spike validates it survives concurrent multi-tenant load.
- Spike 007 — `gbrain-import-from-content` proved positive + negative isolation
  for one sequential write + query. THIS spike pushes the same primitive
  through 20 interleaved concurrent calls.
- `lib/gbrain/engine.ts` — the design under test. PROBE 2's pass means the
  design holds; PROBE 4's fail means the wrapper layer (above the engine,
  below the app routes) needs new structure before Phase 7 lands.
