---
spike: 006
name: gbrain-in-process
type: standard
validates: "Given the QuickBrain app currently shells out to the `gbrain` CLI via child_process (incompatible with Vercel serverless), when gbrain's exported library API is imported directly and a hybrid search is run in-process against the Supabase-backed brain, then the query completes with ranked results and no child process — confirming the app can drop CLI shell-out for an in-process architecture that survives serverless"
verdict: VALIDATED
related: [003, 005]
tags: [gbrain, vercel, serverless, in-process, architecture, phase-3-precondition]
---

# Spike 006: gbrain in-process

## What This Validates

v2.0 Phase 3 is "Vercel Deploy". But `lib/gbrain/client.ts:51` does `spawn("gbrain", args, …)` — the app shells out to the `gbrain` CLI binary, which is `bun link`-ed from a local clone and is **not** a `package.json` dependency. On Vercel's serverless runtime there is no `gbrain` on PATH, and gbrain itself spawns a `bun` worker subprocess. The roadmap's Phase 3 listed only `vercel link` as a precondition and did not reckon with this.

This spike answers the load-bearing question: **can the app import gbrain as a library and run queries in-process** (no `child_process`), so the architecture survives serverless? If yes, Phase 3 needs an "in-process gbrain refactor" phase before the deploy. If no, the deploy target itself is wrong.

## Research

From the gbrain 0.35.1 source at `/Users/abdulhannankanji/Git repos/gbrain/`:

- gbrain's `package.json` has `type: module`, `main: src/core/index.ts`, and a **first-class `exports` map** — it is explicitly built to be consumed as a library, not only as a CLI. Exported subpaths include `.`, `./engine`, `./engine-factory`, `./operations`, `./search/hybrid`, `./search/expansion`, `./config`, `./embedding`, `./minions`, `./ai/gateway`, and more.
- `bin: { gbrain: src/cli.ts }` — the CLI is just one consumer of the same core.
- The query path: `createEngine(config)` (from `./engine-factory`) → `engine.connect(config)` → `hybridSearch(engine, query, opts?)` (from `./search/hybrid`) → `Promise<SearchResult[]>`.
- `gbrain query` in `cli.ts:544` is a thin wrapper that formats `hybridSearch` results for stdout.

## How to Run

```bash
cd "quick-brain"
export PATH="$HOME/.bun/bin:$PATH"
set -a && . ./.env.local && set +a   # SUPABASE_DB_URL_POOLER + OPENAI_API_KEY
```

Test script (imports gbrain core directly, queries the Supabase seed brain in-process):

```js
const G = "<gbrain-checkout>/src/core";
const { createEngine } = await import(`${G}/engine-factory.ts`);
const { hybridSearch } = await import(`${G}/search/hybrid.ts`);
const cfg = { engine: "postgres", database_url: process.env.SUPABASE_DB_URL_POOLER };
const engine = await createEngine(cfg);
await engine.connect(cfg);
const stats = await engine.getStats();
const results = await hybridSearch(engine, "what was weird about last month?");
await engine.disconnect();
```

Run with `bun` (native TS import).

## Investigation Trail

### Verbatim output (2026-05-20)

```
[128ms] imports OK
[gbrain] Prepared statements disabled (PgBouncer transaction-mode convention on port 6543).
         Override with GBRAIN_PREPARE=true if your pooler runs in session mode.
[487ms] engine connected (postgres/pooler)
[602ms] getStats: 48 pages, 48 embedded
[1332ms] hybridSearch: 1 results
   [1.061] march-anomaly-summary
[1340ms] IN-PROCESS QUERY OK — no child process
```

**Observations:**

1. **Imports resolve and run** — gbrain's core TS modules import directly under Bun in 128ms. No build step, no CLI.
2. **The Postgres pooler connection works in-process** — gbrain auto-detects port 6543 and disables prepared statements ("PgBouncer transaction-mode convention"). The same pooler-handling the CLI does, the library does. No child process.
3. **`hybridSearch` returns ranked results** — full retrieval (vector + keyword) against Supabase pgvector, 1.34s end-to-end including connect + embed-the-query. Well under any Vercel function timeout.
4. **Assumption going in:** the app might need the CLI for some capability the library doesn't expose. **Reality:** the CLI *is* a library consumer — `gbrain query` literally calls `hybridSearch`. There is no capability gap for retrieval.

### Gotcha — bare `hybridSearch` ≠ CLI `gbrain query`

The in-process call returned **1 result**; the CLI `gbrain query "what was weird about last month?"` (spike 005) returned **21**. The CLI's `query` path adds **multi-query expansion + RRF fusion** on top of the raw `hybridSearch`. `hybridSearch(engine, query)` with no `opts` is the un-expanded core. To match CLI behavior the app must either pass the right `HybridSearchOpts` (expansion enabled) or replicate the CLI's full query pipeline (`./search/expansion` is exported for exactly this). This is a wiring detail for the refactor, not a blocker.

### Gotcha — `think` (synthesis) is a separate entry point

This spike validated **retrieval** (`hybridSearch`). The chat surface uses `gbrain think` — LLM synthesis over retrieved context. `think` is its own in-process path (the CLI has a `think` command at `cli.ts:1154`). The refactor must wire `think` in-process too; this spike did not exercise it. Low risk — same library, same pattern — but explicitly unverified here.

### Constraint — gbrain must become a real dependency

Today gbrain is `bun link`-ed (a global symlink) and absent from `package.json`. For a Vercel build, gbrain must be a declared dependency — e.g. `"gbrain": "github:garrytan/gbrain#<pinned-sha>"` — so it lands in `node_modules` and bundles. Its transitive deps (`postgres`, AI SDK clients, pgvector helpers) come along. Pinning a SHA matters: gbrain is pre-1.0 and moves fast.

## Results

**VERDICT: VALIDATED ✓**

The app can drop CLI shell-out entirely and call gbrain in-process. Confirmed: imports resolve, the Postgres pooler connection works, `hybridSearch` returns ranked results — all in 1.34s with no child process. The serverless-incompatible `spawn("gbrain", …)` architecture is replaceable.

### Confirmed facts

| Question | Answer |
|---|---|
| Does gbrain expose an importable API? | Yes — first-class `exports` map; the CLI is just one consumer |
| Can the app query gbrain in-process? | Yes — `createEngine` + `connect` + `hybridSearch`, 1.34s, no subprocess |
| Does the Supabase pooler work from the library? | Yes — auto prepare:false on port 6543, same as the CLI |
| Is there a retrieval capability gap vs the CLI? | No — `gbrain query` calls `hybridSearch` internally |
| What still needs wiring? | Query expansion (to match CLI result counts) + the `think` synthesis path |

### Implication for the v2.0 roadmap

Phase 3 ("Vercel Deploy") cannot be a pure deploy phase. It must be preceded by an **in-process gbrain refactor**:

- Rewrite `lib/gbrain/client.ts` — replace `spawn("gbrain", …)` / `spawnGBrain` with in-process `createEngine` + `hybridSearch` + `think` calls.
- Add `gbrain` to `package.json` as a SHA-pinned dependency.
- The per-tenant mutex (`lib/gbrain/mutex.ts`) changes meaning — there is no longer a child process to serialize, but engine-connection pooling still wants management. Re-evaluate.
- Replicate the CLI's query-expansion pipeline so in-process results match what users saw before.
- Wire `think` (synthesis) in-process for the chat surface.

**Recommended roadmap change:** insert a new phase — "In-Process gbrain Refactor" — as the new Phase 3, pushing "Vercel Deploy" to Phase 4 and renumbering the rest. The refactor is real work (it touches the whole `lib/gbrain/` surface) and the deploy is trivial once the app no longer needs a `gbrain` binary on PATH.

### Cross-references

- Spike 003 — confirmed CLI shell-out worked for the hackathon (PGLite + Minions). That architecture is now being retired for serverless.
- Spike 005 — migrated the brain to Supabase Postgres, which is exactly what makes this in-process path viable (a Postgres engine is reachable from anywhere; a PGLite file is not).
