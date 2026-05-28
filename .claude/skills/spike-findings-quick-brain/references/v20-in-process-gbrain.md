# v2.0 In-Process gbrain (read path, write path, cold-start)

## Requirements

- **No CLI shell-out from app code.** `lib/gbrain/engine.ts` imports gbrain as a library and calls its API in-process. The Phase 3 refactor retired `spawn("gbrain", …)` entirely; `bun link`-ing gbrain locally is dev-only.
- **gbrain MUST be a real `package.json` dependency** (currently `"gbrain": "github:garrytan/gbrain#3933eb6"`) so it lands in `node_modules` and the Vercel build bundles it.
- **Import gbrain via `import("gbrain/" + subpath)` with the `/* webpackIgnore: true */` magic comment** so webpack doesn't try to parse gbrain's raw `.ts`. The `types/gbrain.ts` shim is the canonical pattern; spike scripts replicate it.
- **`next.config.ts` MUST have `serverExternalPackages: ['gbrain']`** — keeps gbrain loaded as raw `.ts` under Bun at runtime. Changing this inflates cold-start dramatically.
- **App runtime MUST be Bun** (`bun node_modules/.bin/next start`). Node.js fails on gbrain's raw `.ts` with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.
- **`configureGateway({env: process.env})` MUST be called before `createEngine`** — gbrain's AI gateway is a module-level singleton that reads env at config time. Without it, `expandQuery` silently returns `[query]` and hybridSearch yields 1 result instead of 21.
- **`importFromContent` requires the `sourceId` to ALREADY exist as a row in `sources`** (FK `pages_source_id_fkey`). Provisioning step must `INSERT INTO sources (...)` BEFORE the first ingest job is enqueued.
- **Re-sync (wipe-and-reingest) is `DELETE FROM sources WHERE id = $1`** — FK `ON DELETE CASCADE` sweeps every page + chunk + tag + link atomically. No per-slug iteration needed.

## How to Build It

### Reading: production query pattern (`lib/gbrain/engine.ts:queryInProcess`)

```ts
// types/gbrain.ts already exposes createEngine, hybridSearch, expandQuery,
// configureGateway via the _load() dynamic-import pattern.

export async function queryInProcess(
  tenantId: string,
  question: string,
  opts?: { noExpand?: boolean; sourceId?: string },
): Promise<SearchResult[]> {
  const engine = await createGBrainEngine(tenantId);

  // expandFn enables multi-query expansion + RRF fusion — the CLI-equivalent
  // 21-result behavior. Without it bare hybridSearch returns 1 result.
  return await hybridSearch(engine, question, {
    expandFn: opts?.noExpand ? undefined : expandQuery,
    expansion: !opts?.noExpand,
    sourceId: opts?.sourceId,   // ← per-call tenant scope (REQUIRED in production)
  });
}
```

Measured warm-path latency: **~1.2s mean** (922–1534ms range) per query — dominated by the OpenAI text-embedding-3-large API roundtrip to embed the query string.

### Writing: extend `types/gbrain.ts` for Phase 7 ingest

Add this to the shim (the pattern is mechanical — same `_load` pattern as `createEngine`/`hybridSearch`):

```ts
// types/gbrain.ts — add after existing exports

export interface ImportResult {
  slug: string;
  status: "imported" | "skipped" | "errored";
  chunks: number;
  error?: string;
}

export interface ImportFromContentOpts {
  sourceId?: string;
  forceRechunk?: boolean;
  noEmbed?: boolean;
  filename?: string;
  sourcePath?: string;
}

export async function importFromContent(
  engine: BrainEngine,
  slug: string,
  content: string,
  opts: ImportFromContentOpts = {},
): Promise<ImportResult> {
  const m = await _load("import-file");
  return m.importFromContent(engine, slug, content, opts) as Promise<ImportResult>;
}
```

Then connector code uses it through the tenant-scoped wrapper (see `v20-multi-tenant-isolation.md`):

```ts
// Connect-time provisioning (e.g., QBO OAuth callback handler)
await engine.executeRaw(
  `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
  [`qbo-${userId}`, displayName, JSON.stringify({ kind: "qbo", realm_id })],
);

// Per-page ingest (1.9s/page including OpenAI embedding call)
const result = await importFromContent(
  engine,
  `originals/qbo-bill-${qboBillId}`,
  markdownBody,
  { sourceId: `qbo-${userId}`, forceRechunk: false },
);
// result.status = "imported" first time, "skipped" on idempotent re-run

// Re-sync (wipe-and-reingest from D-08):
await engine.executeRaw(`DELETE FROM sources WHERE id = $1`, [`qbo-${userId}`]);
// FK ON DELETE CASCADE sweeps pages + chunks + tags + links in ~120ms
// Then re-provision the source row and re-enqueue ingest job.
```

### Cold-start expectations (Vercel Fluid Compute)

Measured across 5 fresh-bun-process invocations (simulating Fluid Compute cold-start):

| Phase | Mean ms | % of cold | Range |
|---|---:|---:|---|
| Bun init + gbrain dynamic-import | 62 | 4% | 52–88 |
| configureGateway | 0 | 0% | 0–1 |
| createEngine in-memory | 14 | 1% | 13–16 |
| connect to Supabase pooler (TLS + auth + first query) | 240 | 14% | 216–289 |
| **first hybridSearch (OpenAI embedding + vector search)** | **1434** | **82%** | 1153–1834 |
| warm hybridSearch (2nd query, same process) | 1165 | — | 922–1534 |

**Headline:** cold tax = ~310ms infrastructure. Total cold path 1.75s mean / warm 1.17s mean / ratio 1.5×. **The OpenAI embedding call dominates both paths** — every hybridSearch independently calls `text-embedding-3-large` to embed the query string (no Q→embedding cache in gbrain).

**Implication:** Phase 4 ships without warm-pooling. Default Vercel Fluid Compute instance reuse handles 95%+ of requests. The ~310ms cold tax doesn't justify a scheduled keep-alive cron's complexity.

### Realistic chat-UX expectations

| Scenario | Latency |
|---|---|
| First chat after cold-start | ~1.7s mean, ~2.1s p99 |
| Chat on warm instance | ~1.2s mean, ~1.5s p99 |
| Typical (with Fluid Compute reuse) | ~1.2s |

Show a typing indicator within 200ms via SSE so the user knows the system is alive while OpenAI is roundtripping.

## What to Avoid

- **DO NOT call `spawn("gbrain", …)` from production code.** That architecture is retired. The CLI is dev-only.
- **DO NOT call gbrain functions before `configureGateway`** — the AI gateway is a module-level singleton; expansion + chat silently degrade if it isn't initialized first.
- **DO NOT skip the source-row INSERT before `importFromContent`** — throws `PostgresError: pages_source_id_fkey violation` immediately (caught in spike 007).
- **DO NOT use `forceRechunk: true` for normal ingest** — defeats the content_hash idempotency short-circuit (75ms cheap re-runs become full 1.9s re-embeds).
- **DO NOT iterate per-slug for re-sync.** `DELETE FROM sources WHERE id = $1` with FK cascade is one SQL and ~120ms; per-slug iteration is N round-trips.
- **DO NOT remove `serverExternalPackages: ['gbrain']`** from `next.config.ts`. Without it, webpack tries to bundle gbrain's raw `.ts` and explodes.
- **DO NOT rely on bare `hybridSearch(engine, query)` returning multiple results** — it returns 1. You need `expansion: true` + `expandFn: expandQuery` for the CLI-equivalent 21-result behavior.
- **DO NOT use `import.meta.resolve()` or `createRequire.resolve("gbrain/engine")`** in the shim — webpack rewrites both to broken values. Use the `_load(subpath)` dynamic-import pattern with `/* webpackIgnore: true */`.
- **DO NOT add a query-embedding cache yet (premature optimization).** Defer to Phase 9+ when there's real traffic to measure. Current 1.2s warm latency is acceptable.
- **DO NOT pre-warm Vercel instances.** ~310ms savings not worth the operational complexity. Vercel Fluid Compute instance reuse already handles it.
- **DO NOT use Node.js runtime in production.** Bun is required for raw `.ts` import. Vercel function runtime config: `runtime: "bun"`.

## Constraints

- **Bun runtime required**: `bun@1.2.x` minimum. Bun loads gbrain's raw `.ts` source natively; Node refuses.
- **Cold-start tax**: ~310ms infrastructure boot (Bun + import + connect). OpenAI embedding latency (~1.2-1.4s) dominates both cold and warm paths.
- **Embedding cost per page**: `importFromContent` calls `text-embedding-3-large` for every chunk. ~1.9s/page for a small markdown page in spike 007 measurement. For a real SMB with 5 years of QBO data (~10-50K transactions), full ingest is the hours-long workflow Phase 7 progress UI must communicate.
- **`content_hash` idempotency**: re-importing the same content returns `{status: "skipped", chunks: 0}` in ~75ms — no embedding call. Wipe-and-reingest (D-08) bypasses this by deleting the source row first.
- **No Q→embedding cache in gbrain core**: every `hybridSearch(engine, query)` makes a fresh OpenAI call. Phase 9+ optimization opportunity.
- **`gbrain/import-file` subpath** is in `node_modules/gbrain/package.json#exports`. Other relevant subpaths: `./ai/gateway`, `./engine-factory`, `./search/hybrid`, `./search/expansion`, `./operations`.
- **`importFromContent` signature**: `(engine, slug, content, opts: {sourceId?, forceRechunk?, noEmbed?, filename?, sourcePath?})`. Returns `Promise<ImportResult>`.

## Origin

Synthesized from spikes:
- **006** — `gbrain-in-process` (VALIDATED ✓): read path; 1.34s warm-engine baseline.
- **007** — `gbrain-import-from-content` (VALIDATED ✓): write path via `importFromContent`; 1.9s/page; idempotency; positive+negative isolation; FK pre-registration gap finding.
- **009** — `vercel-fluid-coldstart` (VALIDATED ✓): cold-start breakdown across 5 fresh-process runs; 310ms infra tax; OpenAI dominates.

Source files available in: `sources/006-gbrain-in-process/`, `sources/007-gbrain-import-from-content/`, `sources/009-vercel-fluid-coldstart/`.

Related:
- `v20-supabase-foundation.md` — the Supabase pooler + pool capacity this runs on.
- `v20-multi-tenant-isolation.md` — the tenant-scope wrapper layer required around every gbrain call.
