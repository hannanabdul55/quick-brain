---
spike: 011
name: tenant-scoped-wrapper
type: integration
validates: "Given spike 010's prescribed lib/gbrain/tenant-scoped.ts wrapper layer + ESLint rule banning bare engine.* / hybridSearch / importFromContent outside lib/gbrain/, when both are built and tested against the live Supabase brain with two test tenants AND against a synthetic bad-call fixture, then every wrapper compiles + runs + isolates correctly, the lint rule flags every expected violation (and does not false-positive on parameterized calls), and the existing app call-site audit confirms the wrapper shape replaces every gbrain caller cleanly — closing spike 010 from PARTIAL to VALIDATED"
verdict: VALIDATED
related: [007, 008, 010]
tags: [gbrain, multi-tenant, isolation, lint, architecture, phase-7-precondition, integration]
---

# Spike 011: tenant-scoped wrapper layer + ESLint rule

## What This Validates

Spike 010 found the silent-leak class: gbrain has no fail-safe default for
`sourceId` because the Supabase pooler role has `BYPASSRLS`. The fix
prescribed was:

1. `lib/gbrain/tenant-scoped.ts` — wrapper functions that take `tenantId` and
   resolve to `sourceId` via `lib/auth/resolve-tenant.ts` (Phase 6 chokepoint).
2. An ESLint rule banning bare `engine.*` / `hybridSearch` / `importFromContent`
   calls outside `lib/gbrain/`.

The prescription was on paper. Spike 011 builds both as spike artifacts +
tests them against:
- The live Supabase brain (real-engine integration; two tenants; write +
  read + wipe + cascade).
- A synthetic bad-call fixture (so the lint rule has something to flag).
- An audit of the existing app code to confirm the wrapper shape replaces
  every gbrain caller cleanly.

If all of that holds, spike 010 closes from PARTIAL → VALIDATED, and Phase 7
plan execution lands the production version of these files with high
confidence.

## Research

Audit of existing app code that touches gbrain (`rg -l "engine\." lib/ app/ scripts/`):

| File | Direct engine.* access? | Already tenant-scoped? | Verdict |
|------|---|---|---|
| `lib/gbrain/engine.ts` | Yes (it owns the engine) | N/A | Internal — allowed |
| `lib/gbrain/client.ts` | Yes (`createGBrainEngine` + `runThink`) | YES — exports `query(tenantId, ...)`, `think(tenantId, ...)` | Already disciplined; needs write-side extension |
| `lib/auth/provision.ts` | Yes (`engine.executeRaw` via type cast) | YES — takes `sourceId` arg | Ergonomic blocker: awkward type cast |
| `lib/health/probes.ts` | NO — direct postgres | N/A | Not a gbrain call |
| `lib/jobs/store.ts` | NO — direct postgres to `app.jobs` | N/A | Not a gbrain call |
| `app/` routes | NONE | N/A | Route handlers use `lib/gbrain/client.ts` |
| `scripts/*.sh` | bash shelling to gbrain CLI | N/A | CLI, not in-process |

**Surprising finding**: Phase 6 already shipped well-disciplined wrappers in
`lib/gbrain/client.ts`. Zero app-route call sites need refactoring. The only
"bare" gbrain call outside `lib/gbrain/` is the `engine.executeRaw` in
`lib/auth/provision.ts` — and even it takes `sourceId` as a function argument,
just with an awkward type-cast workaround because the gbrain shim
(`types/gbrain.ts`) doesn't expose `executeRaw` as a typed method.

So the Phase 7 prereq work is materially smaller than spike 010 suggested:
add the missing **write-side** wrappers + a typed `executeRaw` to kill the
cast + the ESLint rule.

## How to Run

### A. Live wrapper validation (against real Supabase)

```bash
set -a && . ./.env.local && set +a
export PATH="$HOME/.bun/bin:$PATH"
bun .planning/spikes/011-tenant-scoped-wrapper/spike.ts
```

The script writes two pages with the SAME slug under two different sourceIds,
then probes positive + negative isolation through every wrapper, then wipes
both sources via FK cascade. Total runtime ~21s. Expect `FINAL VERDICT:
VALIDATED ✓ (6/6 probes)`.

### B. Lint-rule validation (against synthetic bad-call fixture)

```bash
node_modules/.bin/eslint \
  --config .planning/spikes/011-tenant-scoped-wrapper/spike-lint.config.mjs \
  --no-config-lookup \
  .planning/spikes/011-tenant-scoped-wrapper/bad-call-fixture.ts
```

The fixture has 10 lines that MUST be flagged (5 bare `engine.*`, 3 bare
function calls, 2 parameterless `executeRaw`) plus 1 line that MUST NOT be
flagged (parameterized `executeRaw`). All 10 violations are reported with
the right rule-message; the parameterized call is silent.

## What to Expect

- **Spike runner**: 6/6 probes pass — register-source idempotency,
  importFromContent round-trip, positive + negative isolation via both
  `getPage` and `hybridSearch`, parameterless-executeRaw guard, wipe-source
  cascade.
- **Lint runner**: 10 errors reported with descriptive messages pointing at
  the right `tenantSafe*` wrapper.

## Observability

`spike-events.json` carries the forensic event log + per-probe verdicts.
`result.html` renders the verdict table + the lint-rule before/after as a
side-by-side panel.

## Investigation Trail

### Live spike — per-wrapper validation

| Probe | Outcome | Detail |
|---|---|---|
| V4 — `tenantSafeRegisterSource` idempotent | ✓ | second call with different display name didn't throw (ON CONFLICT DO NOTHING) |
| V7a — `tenantSafeImportFromContent` round-trip | ✓ | A=imported, B=imported (same slug, different sourceIds → two independent rows) |
| V2+V3 — `tenantSafeGetPage` isolation | ✓ | A→A=true / A→B=false / B→B=true / B→A=false |
| V2+V3 — `tenantSafeHybridSearch` isolation | ✓ | A→A=true / A→B=false / B→B=true / B→A=false |
| V6 — parameterless `executeRaw` guard | ✓ | throws "would hang against Supavisor" (matches spike 008 invariant) |
| V5 — `tenantSafeWipeSource` cascade | ✓ | post-wipe `getPage` returned null (FK ON DELETE CASCADE swept pages + chunks) |

### Lint rule — verdict matrix against fixture

| Fixture line | Pattern | Flagged? |
|---|---|---|
| `engine.getPage(...)` | bare engine.* | ✓ |
| `engine.deletePage(...)` | bare engine.* | ✓ |
| `engine.listPages(...)` | bare engine.* | ✓ |
| `engine.getTags(...)` | bare engine.* | ✓ |
| `engine.putPage(...)` | bare engine.* | ✓ |
| `hybridSearch(engine, "...")` | bare gbrain fn | ✓ |
| `importFromContent(engine, ...)` | bare gbrain fn | ✓ |
| `runThink(engine, ...)` | bare gbrain fn | ✓ |
| `engine.executeRaw("SELECT 1")` | parameterless | ✓ |
| `engine.executeRaw("SELECT 1", [])` | empty params | ✓ |
| `engine.executeRaw("SELECT $1::int", [1])` | parameterized (control) | ✗ (correctly NOT flagged) |

**11/11 expected outcomes match.** No false positives, no false negatives.

### Ergonomic findings

1. **Shim doesn't expose `executeRaw` / `getPage` / `deletePage` / `listPages`
   etc.** The current `types/gbrain.ts` only declares the 5 functions Phase 3
   needed (`createEngine`, `hybridSearch`, `expandQuery`, `configureGateway`,
   `runThink`). Every other BrainEngine method is reachable only through the
   shim's `[key: string]: unknown` index signature — which means callers need
   `as unknown as { method: ... }` casts (see `lib/auth/provision.ts:102-104`).
   The proposed wrappers absorb the cast once, in the wrapper file, so app
   code never sees it. Phase 7's first plan should consider extending the
   shim with these typed signatures too.

2. **`importFromContent` requires double-cast on the dynamic-import**
   because the gbrain source-tree `BrainEngine` (the type the dynamic-import
   returns) has 105+ methods and isn't structurally assignable to the shim's
   `BrainEngine` (which uses `[key: string]: unknown`). The wrapper does
   `as unknown as { importFromContent: ... }` to bridge. Same pattern the
   shim's `runThink` uses. Production landing: when Phase 7's first plan
   adds `importFromContent` to the shim, the wrapper imports it from there
   and the double-cast disappears.

3. **The `permitted1` (parameterized executeRaw) regression test** is the
   load-bearing piece of the lint rule. Without it, a future tightening of
   the rule could silently start flagging legitimate parameterized calls.
   Production should keep this fixture (under `.planning/spikes/`) and CI
   could run the lint against it as a regression guard.

### Latency note (unrelated to verdict)

First `tenantSafeImportFromContent` took 15.2s; second took 1.7s. Spike 007's
single-import measurement showed 1.9s. The 13-second delta on the first call
is most likely OpenAI's `text-embedding-3-large` cold latency — spike 007
only ran one import, so this cold spike never appeared. Not a verdict
blocker but a real number: **the first ingest call after a cold gbrain
engine can take ~15s end-to-end including OpenAI cold-warmup.** Phase 7's
JobProgress UI should not promise sub-5s per page for the first page of
each tenant's first sync.

### What this means for spike 010

Spike 010's PARTIAL verdict was about the silent-leak class existing AND not
having a built fix. Spike 011 builds the fix + proves it works end-to-end +
demonstrates the lint rule fires. The prescribed pattern is no longer
hypothetical; it is empirically validated.

**Spike 010 closes: PARTIAL ⚠ → CLOSED-BY-011 (closure verdict: VALIDATED ✓
via spike 011's wrapper + lint).** The manifest carries this annotation.

## Results

**VERDICT: VALIDATED ✓**

Both prescribed pieces (wrapper layer + lint rule) work. The audit of
existing app code shows Phase 6 already shipped the read-side wrappers and
only the write-side wrappers are new. The lint rule fires cleanly on every
expected bad call. The runtime guard against parameterless executeRaw fires.
Tenant isolation holds across all three boundaries (write, get, search).

### Confirmed facts

| Question | Answer |
|---|---|
| Do the proposed wrappers compile + run against the real engine? | YES |
| Does positive + negative isolation hold? | YES (4/4 directions correct on both getPage and hybridSearch) |
| Is tenantSafeRegisterSource idempotent? | YES (ON CONFLICT DO NOTHING) |
| Does tenantSafeWipeSource cascade properly? | YES (~200ms, FK ON DELETE CASCADE) |
| Does the parameterless-executeRaw guard fire? | YES (spike 008 invariant enforced at the wrapper level) |
| Does the ESLint rule flag every bad shape? | YES (10/10 expected violations) |
| Does the ESLint rule false-positive on parameterized calls? | NO (1/1 control case correctly silent) |
| How many existing app call sites need refactoring? | ONE — lib/auth/provision.ts (cast cleanup only; logic unchanged) |
| Does spike 010's PARTIAL verdict close? | YES (CLOSED-BY-011) |

### Findings that shape Phase 7

Phase 7's first plan (or a new pre-execute plan) should:

1. **Land `lib/gbrain/tenant-scoped.ts`** — copy from this spike's
   `tenant-scoped.ts`, swap `./spike-engine-shim` → `@/lib/gbrain/engine`,
   swap `./spike-tenant-shim` → `@/lib/auth/resolve-tenant`. Remove the
   `forceRechunk: true` test invocation; production uses `false`.
2. **Extend `types/gbrain.ts`** — add typed exports for `importFromContent`,
   `getPage`, `deletePage`, `listPages`, `executeRaw` so the wrappers don't
   need the `as unknown as { ... }` casts. Same `_load(subpath)` pattern as
   the existing exports.
3. **Refactor `lib/auth/provision.ts`** — replace `provisionBrain(sourceId, displayName)`
   with `tenantSafeRegisterSource(tenantId, displayName, config)`. Caller
   sites resolve to the same effect; the awkward cast goes away.
4. **Refactor `lib/gbrain/client.ts`** — move `query(tenantId, ...)` into
   `tenantSafeHybridSearch` and `think(tenantId, ...)` into `tenantSafeRunThink`.
   Keep `spawnGBrain` (it's the CLI escape hatch for `gbrain init/import/embed/config`
   per HARN-03 — out of scope for the wrappers).
5. **Add the ESLint rule** to the root `eslint.config.mjs` — copy from
   `spike-lint-rule.cjs` into the project's flat config under an `overrides`
   block scoped to `app/**/*.{ts,tsx}` + `lib/!(gbrain)/**/*.ts`. The lib/gbrain
   exception lets the wrapper file itself use bare engine.* without flagging.
6. **Keep `bad-call-fixture.ts` + `spike-lint.config.mjs` as a CI regression
   test** — ensures the `permitted1` parameterized call stays unflagged even
   as the rule tightens.

### Cross-references

- Spike 007 — gave us the FK pre-registration finding that `tenantSafeRegisterSource`
  enforces, and the round-trip baseline for `tenantSafeImportFromContent`.
- Spike 008 — gave us the parameterless-executeRaw hang invariant that the
  wrapper's runtime guard enforces (and the lint rule statically catches).
- Spike 010 — found the silent-leak class. This spike builds the fix +
  closes that one's PARTIAL verdict.
- `lib/gbrain/engine.ts` — the single-shared-engine architecture every
  wrapper sits on top of. Unchanged by this spike.
- `lib/auth/provision.ts` — the one existing app file that needs a small
  refactor (cast cleanup; logic unchanged) when Phase 7 lands the production
  wrappers.
