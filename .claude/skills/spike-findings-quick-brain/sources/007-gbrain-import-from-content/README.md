---
spike: 007
name: gbrain-import-from-content
type: integration
validates: "Given a Supabase-backed brain reached via in-process createEngine (spike 006), when importFromContent(engine, slug, markdown, {sourceId, forceRechunk}) is called with a QBO-shape markdown payload, then the page persists, embeddings are written, idempotent re-imports short-circuit on content_hash, hybridSearch retrieves it under the same sourceId, and the same query under sourceId='default' does NOT see it — proving Phase 7's write path against the v2.0 in-process architecture"
verdict: VALIDATED
related: [005, 006]
tags: [gbrain, in-process, write-path, qbo, phase-7-precondition, integration]
---

# Spike 007: in-process gbrain `importFromContent`

## What This Validates

Spike 006 proved gbrain can be queried in-process (no `child_process`) — a 1.34s
end-to-end `hybridSearch` against the Supabase pgvector backend. But that only
validated the **read** side of the architecture.

Phase 7 (QuickBooks Online ingest) is about to execute. Its 9-plan rollout
assumes the **write** side works the same way: the QBO transformer calls
`importFromContent(engine, slug, markdown, {sourceId})` on the same in-process
engine, per-tenant `sourceId` scoping isolates writes, and `hybridSearch`
returns the new page to the chat surface.

Phase 7's RESEARCH.md flagged that `importFromContent` is **not in the
`types/gbrain.ts` shim** today. Adding it is a Phase 7 task; this spike
de-risks that task by proving the underlying call works end-to-end through
the same dynamic-import pattern the shim uses, against the live Supabase
brain, with tenant isolation enforced.

## Research

Findings from reading gbrain 0.35.1 source at `node_modules/gbrain/`:

- `importFromContent` is exported from `gbrain/import-file` (subpath
  `./import-file` is in `package.json#exports`). Signature:
  `(engine, slug, content, opts: {sourceId?, forceRechunk?, noEmbed?, filename?, sourcePath?})`.
  Lives at `src/core/import-file.ts:187`.
- The function calls `embedBatch()` (OpenAI text-embedding-3-large) **before**
  the DB transaction. The transaction then upserts the page row, reconciles
  tags, and upserts chunks. Code-ref extraction adds wikilink-to-code edges
  in the same tx.
- Content idempotency: gbrain computes `content_hash` over the parsed
  page (title + type + compiled_truth + timeline + frontmatter + sorted tags).
  Existing page with same hash → returns `{status: "skipped", chunks: 0}`
  unless `forceRechunk: true`.
- Multi-source: every per-tx call (`putPage`, `getTags`, `addTag`,
  `upsertChunks`, `addLink`) carries the caller's `sourceId` so writes
  target `(sourceId, slug)`. Without it, writes default to the schema
  DEFAULT (`'default'`).
- **FK invariant:** `pages.source_id` has `REFERENCES sources(id) ON DELETE
  CASCADE`. The `sourceId` you pass must exist as a row in the `sources`
  table FIRST. gbrain ships an `addSource` helper in `src/core/sources-ops.ts`
  but it's not exported in the package's `exports` map and bakes in
  git-clone behavior we don't need for virtual QBO sources.

## How to Run

```bash
cd "quick-brain"
set -a && . ./.env.local && set +a   # SUPABASE_DB_URL_POOLER + OPENAI_API_KEY
export PATH="$HOME/.bun/bin:$PATH"
bun .planning/spikes/007-gbrain-import-from-content/spike.ts
```

The script:
1. Loads `gbrain/ai/gateway` + calls `configureGateway({env: process.env})`.
2. Loads `gbrain/engine-factory` + calls `createEngine` + `engine.connect()`.
3. Pre-registers a throwaway source row via `engine.executeRaw('INSERT INTO sources …')`.
4. Loads `gbrain/import-file` + calls `importFromContent(engine, slug, qbo_markdown, {sourceId, forceRechunk: true})`.
5. Verifies persistence via `engine.getPage(slug, {sourceId})`.
6. Re-imports the same content to confirm `content_hash` short-circuits to `status: "skipped"`.
7. Calls `hybridSearch(engine, query, {sourceId, limit: 5})` — must return the new page.
8. Calls `hybridSearch(engine, query, {sourceId: "default", limit: 5})` — must NOT see it.
9. `DELETE FROM sources WHERE id=$1` to cascade-clean (verifies the FK-cascade primitive).
10. `engine.disconnect()`.

Open `result.html` after the run for a visual summary of all events + verdicts.

## What to Expect

Final stdout line: `FINAL VERDICT: VALIDATED ✓` with all 4 probes (`ingest`,
`idempotency`, `retrieval`, `isolation`) checked. Wall-clock around 5–6s
end-to-end. `spike-events.json` carries the full timeline.

## Observability

`spike-events.json` is a forensic log: every step (setup, config, engine,
ingest, search, cleanup) carries an ISO timestamp + ms-since-start + category +
data payload. Read it directly or open `result.html` to render the timeline.
The HTML page also stamps the 4 acceptance verdicts and the timing of each
probe so the user can confirm "this matches what the spike claims" without
re-running.

## Investigation Trail

### Attempt 1 — fail-loud on FK violation (this was the finding)

The first run threw immediately on `importFromContent`:

```
PostgresError: insert or update on table "pages" violates foreign key
constraint "pages_source_id_fkey"
detail: Key (source_id)=(qbo-spike-007) is not present in table "sources"
```

**Assumption going in:** any `sourceId` string passed to `importFromContent`
just becomes a partition tag.
**Reality:** gbrain enforces a real FK on `pages.source_id → sources(id)`.
The QBO transformer must register its tenant's source row at OAuth-connect
time, not lazily at first-ingest. Phase 7's "qbo-`<userId>`" sourceId scheme
needs an upstream provisioning step.

This finding alone justifies the spike. Without it, Phase 7's first ingest
job would throw — likely after Inngest already counted attempts against
retry budget — and the failure mode would be discovered in execution,
mid-wave-4, not in planning.

### Attempt 2 — full round-trip

After pre-registering the source row via direct `executeRaw('INSERT INTO sources …')`,
the full sequence ran clean:

| Step | Time | Outcome |
|---|---|---|
| `configureGateway` + `createEngine` + `connect` | 481ms | OK |
| `INSERT INTO sources` pre-registration | 72ms | OK |
| `importFromContent` (incl. 1 OpenAI embedding call) | **1915ms** | `{status: "imported", chunks: 1}` |
| `engine.getPage()` verify persistence | 82ms | Page present, source_id=qbo-spike-007, all 7 frontmatter keys round-tripped |
| Re-import same content | 75ms | `{status: "skipped", chunks: 0}` — content_hash gate held |
| `hybridSearch` with sourceId=qbo-spike-007 | 1528ms | 1 result, score 0.896, target slug retrieved |
| `hybridSearch` with sourceId='default' (negative probe) | 1284ms | 5 unrelated results, target slug NOT in set |
| `DELETE FROM sources WHERE id=$1` cleanup | 119ms | Source row deleted; cascade swept pages + chunks |
| `engine.disconnect()` | 11ms | OK |
| **Total wall-clock** | **5.6s** | VALIDATED |

### Gotcha — frontmatter date round-tripped as ISO datetime

The payload had `date: 2026-05-28` (a YYYY-MM-DD string). `engine.getPage()`
returned `frontmatter.date: '2026-05-28T00:00:00.000Z'`. gbrain's YAML
parser auto-typed the date string. The smb-audit skill consumes `date` as a
string; the Phase 7 QBO transformer should either emit the date wrapped in
quotes (`date: "2026-05-28"`) to keep it a string, or the consumer must
handle both shapes. Worth a Phase 7 transformer test.

### Gotcha — auto-link to companies/spike-vendor-007 failed silently

The body contained `[[companies/spike-vendor-007]]`. gbrain's auto-link
post-hook would normally create a `links` row pointing at that target. The
target page didn't exist in the spike — no error was thrown, no log line
fired. This is the gbrain "addLink throws when either endpoint is missing"
behavior wrapped in `try/catch` (per `src/core/import-file.ts:362-372`),
recoverable via `gbrain reconcile-links`. **Phase 7 implication:** the
QBO transformer must emit vendor/company pages BEFORE bill pages in the
same ingest job, or accept that vendor-link edges will be filled in by a
later reconciliation step.

### Gotcha — only 1 search result returned (not 21 like the CLI)

The `hybridSearch` call passed no `expandFn` and `expansion` defaulted to
off, so it returned 1 result (just the spike target). The production
`lib/gbrain/engine.ts:queryInProcess()` correctly wires `expandFn: expandQuery`
and `expansion: true` for the CLI-equivalent 21-result behavior. This
spike intentionally kept retrieval bare to avoid muddying the write-path
proof; the production write path is unaffected.

## Results

**VERDICT: VALIDATED ✓**

The in-process write path works. Phase 7 can execute.

### Confirmed facts

| Question | Answer |
|---|---|
| Does `importFromContent` work in-process against the v2.0 Supabase brain? | Yes — 1.9s end-to-end including one OpenAI embedding call |
| Does it require pre-registered source rows? | YES — FK `pages_source_id_fkey` enforces it (finding) |
| Does idempotency work? | Yes — re-import same content → `status: "skipped"` via content_hash |
| Does per-tenant sourceId isolate writes from neighboring tenants? | Yes — verified both directions (positive: retrieval finds it under matching sourceId; negative: invisible under default) |
| Does `DELETE FROM sources … CASCADE` clean up pages + chunks? | Yes — ~120ms, one SQL, atomic |
| Does the shim's `_load("gbrain/" + subpath)` pattern work for `import-file`? | Yes — same pattern as `engine-factory`, `search/hybrid` etc. The shim can be safely extended |

### Findings that shape Phase 7

1. **Connect-time source provisioning is required.** When a user completes the
   QBO OAuth flow, the connection handler MUST `INSERT INTO sources (id, name,
   config) VALUES ('qbo-<userId>', '<display>', '{"federated": false, "kind":
   "qbo", ...}'::jsonb) ON CONFLICT (id) DO NOTHING` BEFORE the first ingest
   job is enqueued. This is a new step Phase 7 plans 07-01..07-03 need to
   include — currently they assume the sourceId is just a string.

2. **Re-sync is one DELETE.** Phase 7 D-08 ("wipe-and-reingest") can be
   implemented as `DELETE FROM sources WHERE id='qbo-<userId>'` followed by
   the connect-time INSERT + a fresh ingest job. The FK cascade does all the
   pages + chunks + tags + links cleanup atomically. No need for a separate
   `deleteSource()` engine method or per-slug iteration. The destructive-
   confirm modal in 07-UI-SPEC.md is gating exactly the right primitive.

3. **`types/gbrain.ts` extension is mechanical for Phase 7.** Add an
   `importFromContent(engine, slug, content, opts)` typed wrapper that
   delegates to `_load("import-file")`. The runtime path is proven.

4. **One ingest = ~1.9s for a small page.** A real QBO sync (say 100 bills,
   50 vendors, 1 year of statements) at this rate is ~5 minutes serialized.
   Phase 7's Inngest step-divided shape (D-07) is the right design —
   parallel chunked imports OR accept the 5-minute progress bar. Spike 008
   will measure what concurrency the Supabase free-tier pool can sustain.

5. **`forceRechunk` semantics matter.** For the QBO transformer's first
   write of a page, `forceRechunk: false` (default) is fine — there's no
   prior content to hash against. For incremental sync (a future post-v2.0
   feature, not Phase 7), `forceRechunk: true` is needed to bypass the
   short-circuit when only embedding-impacting code changed. Phase 7's
   wipe-and-reingest sidesteps this entirely.

### Recommended shim addition for Phase 7

```ts
// types/gbrain.ts — add after expandQuery / configureGateway exports

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

### Cross-references

- Spike 005 — `gbrain-on-supabase` (foundation: the Supabase backend that
  this spike writes to, with auto-enabled RLS).
- Spike 006 — `gbrain-in-process` (validated retrieval; this spike is the
  symmetric validation for ingest).
- Phase 7 — `RESEARCH.md` flagged the `importFromContent`-not-in-shim gap;
  Phase 7 PLANs 07-02 (QBO transformer) + 07-04 (ingest worker) need the
  shim extension and the connect-time source-row INSERT (NEW finding).
- `lib/gbrain/engine.ts` — the single-shared-engine + per-call sourceId
  pattern that this spike's retrieval probe validates is still the right
  shape for writes too. Spike 010 will prove the same engine can serve
  multiple tenants safely without per-tenant engine instances.
