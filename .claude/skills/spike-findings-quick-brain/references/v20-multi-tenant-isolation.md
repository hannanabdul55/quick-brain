# v2.0 Multi-Tenant Isolation (the gbrain `sourceId` discipline)

## Requirements

- **All tenant isolation lives in app-layer per-call `sourceId` scoping.** RLS is NOT the primitive — gbrain enables RLS on every public table BUT the Supabase pooler role we connect as has `BYPASSRLS`. RLS protects against the Supabase `anon` role only (defense-in-depth) — it does NOT protect against in-app code that forgets to scope.
- **A single long-lived `BrainEngine` instance serves every tenant in the Vercel Fluid Compute worker** (no per-tenant pool accumulation, no eviction). This survives concurrent multi-tenant access — 20 interleaved queries from 2 tenants produce 0 cross-tenant leaks.
- **Every call to `engine.getPage`, `engine.deletePage`, `engine.listPages`, `engine.getTags`, `hybridSearch`, or `importFromContent` MUST pass an explicit `sourceId` derived from the authenticated user.** There is NO fail-safe default in gbrain — bare calls without sourceId silently return / mutate / federate across all sources. Silent leak class.
- **The `(source_id, slug)` composite key isolates rows correctly.** Same slug under two sourceIds = two independent rows with no cross-contamination — confirmed positively and negatively.
- **Tenant→sourceId resolution goes through a single chokepoint** (`lib/auth/resolve-tenant.ts` from Phase 6, never trust `params.id`). The wrapper layer below must call it for every gbrain access.

## How to Build It

### The wrapper layer (required before any new gbrain caller lands)

Create `lib/gbrain/tenant-scoped.ts`. Every app code path goes through these wrappers. Bare `engine.*` access is forbidden outside `lib/gbrain/`.

```ts
// lib/gbrain/tenant-scoped.ts
import { createGBrainEngine } from "./engine";
import { resolveTenant } from "@/lib/auth/resolve-tenant";
import {
  hybridSearch, expandQuery, importFromContent,
  type SearchResult, type ImportResult, type HybridSearchOpts, type ImportFromContentOpts,
} from "@/types/gbrain";

/** Derive the sourceId from the request's authenticated tenant. */
async function sourceIdFor(tenantId: string): Promise<string> {
  // Phase 6's resolveTenant verifies the session AND returns the canonical
  // tenantId. This is the single chokepoint — never trust params.id.
  const tenant = await resolveTenant(tenantId);
  if (!tenant) throw new Error(`tenant ${tenantId} not found or revoked`);
  return tenant.gbrain_source_id;   // e.g. "qbo-<userId>" or "default"
}

export async function tenantSafeHybridSearch(
  tenantId: string,
  query: string,
  opts: Omit<HybridSearchOpts, "sourceId" | "sourceIds"> = {},
): Promise<SearchResult[]> {
  const sourceId = await sourceIdFor(tenantId);
  const engine = await createGBrainEngine();
  return hybridSearch(engine, query, {
    ...opts,
    sourceId,
    expandFn: opts.expandFn ?? expandQuery,
    expansion: opts.expansion ?? true,
  });
}

export async function tenantSafeGetPage(
  tenantId: string,
  slug: string,
) {
  const sourceId = await sourceIdFor(tenantId);
  const engine = await createGBrainEngine();
  return engine.getPage(slug, { sourceId });
}

export async function tenantSafeImportFromContent(
  tenantId: string,
  slug: string,
  content: string,
  opts: Omit<ImportFromContentOpts, "sourceId"> = {},
): Promise<ImportResult> {
  const sourceId = await sourceIdFor(tenantId);
  const engine = await createGBrainEngine();
  return importFromContent(engine, slug, content, { ...opts, sourceId });
}

// ... tenantSafeDeletePage, tenantSafeListPages, etc.
```

### The ESLint rule (compile-time defense)

Add a custom ESLint rule (or use `no-restricted-syntax`) banning bare `engine.*` access outside `lib/gbrain/`:

```js
// .eslintrc.js — partial
module.exports = {
  // ...
  overrides: [
    {
      files: ["app/**/*.ts", "app/**/*.tsx", "lib/!(gbrain)/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            selector: "MemberExpression[object.name='engine'][property.name=/^(getPage|deletePage|listPages|getTags|putPage)$/]",
            message: "Direct engine.* calls are banned outside lib/gbrain/. Use lib/gbrain/tenant-scoped.ts wrappers (tenantSafeGetPage / tenantSafeDeletePage / ...).",
          },
          {
            selector: "CallExpression[callee.name='hybridSearch']",
            message: "Bare hybridSearch() is banned outside lib/gbrain/. Use tenantSafeHybridSearch(tenantId, query, opts).",
          },
          {
            selector: "CallExpression[callee.name='importFromContent']",
            message: "Bare importFromContent() is banned outside lib/gbrain/. Use tenantSafeImportFromContent(tenantId, slug, content, opts).",
          },
        ],
      },
    },
  ],
};
```

### Audit existing call sites (one-time sweep before Phase 7 lands)

```bash
# Find every bare engine.* and bare gbrain function call
rg -n 'engine\.(getPage|deletePage|listPages|getTags)' lib/ app/ scripts/
rg -n '\bhybridSearch\(' lib/ app/ scripts/
rg -n '\bimportFromContent\(' lib/ app/ scripts/
```

Every match must either:
1. Be inside `lib/gbrain/` (wrapper internals — allowed).
2. Pass an explicit `sourceId` derived from `resolveTenant()`.

Anything else is a live silent-leak vector.

### Verified isolation properties (under concurrent load)

| Probe | Outcome |
|---|---|
| Same slug under tenants A + B → `getPage(slug, {sourceId: A})` returns A's content | ✓ |
| Same query → `getPage(slug, {sourceId: B})` returns B's content | ✓ |
| 20 concurrent interleaved queries from A + B via `Promise.all` | ✓ 0/20 leaks |
| `hybridSearch(engine, query)` WITHOUT sourceId | ✗ Returns federated rows across ALL sources (default + tenant A + tenant B) |
| `engine.getPage(slug)` WITHOUT sourceId | ✗ Silently returns one tenant's row arbitrarily (no exception, no warning) |
| `engine.listPages({})` WITHOUT scope | Returns federated count across all sources (expected for admin paths) |
| `DELETE FROM sources WHERE id = $1` cleanup | ✓ FK cascade sweeps pages + chunks + tags + links in ~120ms |

### Source-row provisioning (Phase 7 OAuth-connect handler)

Each tenant's `sourceId` MUST exist as a row in `sources` before any `importFromContent` call (FK `pages_source_id_fkey`):

```ts
// QBO OAuth callback handler — runs before first ingest
const sourceId = `qbo-${userId}`;
await engine.executeRaw(
  `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
  [sourceId, `${userDisplayName} (QBO)`, JSON.stringify({ kind: "qbo", realm_id: qboRealmId, federated: false })],
);
// Now safe to enqueue ingest jobs that write under this sourceId.
```

## What to Avoid

- **DO NOT call `engine.getPage(slug)` / `engine.deletePage(slug)` / `engine.listPages()` / `hybridSearch(engine, q)` without an explicit `sourceId`.** Silent leak across all tenants. There is no exception, no warning, no audit trail.
- **DO NOT rely on gbrain's RLS for tenant isolation.** The role we connect as has `BYPASSRLS`. RLS is defense-in-depth against the Supabase `anon` role only.
- **DO NOT introduce per-tenant engine pools.** Spike 008 + 010 prove the single-shared-engine pattern works under concurrent multi-tenant load. Per-tenant engines would accumulate one connection per user (T-03-03 unbounded leak documented in `lib/gbrain/engine.ts`).
- **DO NOT use `SET LOCAL app.current_tenant`** or similar Postgres-session-scoped vars for isolation. gbrain queries hit the Supavisor pooler in transaction mode — each query gets a fresh transaction; session state doesn't persist between calls.
- **DO NOT trust `params.id` from request URLs as the tenant identifier.** Always run through `lib/auth/resolve-tenant.ts` (Phase 6 chokepoint). The wrapper layer above enforces this.
- **DO NOT skip the source-row INSERT before `importFromContent`** — throws `PostgresError: pages_source_id_fkey violation`. Phase 7 OAuth-connect handler must register the source row.
- **DO NOT call `engine.getPage(slug)` directly in app code** even with a sourceId in scope. The lint rule will reject it; use `tenantSafeGetPage(tenantId, slug)` so resolution is always centralized.

## Constraints

- **gbrain's `BYPASSRLS` posture is by design** — gbrain was built for single-user CLI contexts where one role owns everything. The schema enables RLS so Supabase's `anon` role can't read the data, but the gbrain-app role bypasses it for normal CRUD. This is **not** going to change upstream.
- **No engine-side fix is forthcoming.** gbrain's `OperationContext` threading via `sourceScopeOpts(ctx)` already handles the MCP/OAuth context-bound path (federated_read array etc). The gap is bare engine method calls outside that path. Fix lives in the QuickBrain wrapper layer, not gbrain.
- **`(source_id, slug)` composite key**: confirmed in spike 010. Schema enforces; same slug under two sources is allowed and isolated.
- **`DELETE FROM sources WHERE id = $1` cascades**: `ON DELETE CASCADE` on `pages.source_id` sweeps pages + chunks + tags + links atomically. ~120ms in measurement.
- **Wrapper layer overhead**: zero functional cost (just a function call + a resolveTenant lookup, which is already O(1) DB hit in Phase 6). Catches what the lint rule misses (e.g., bare engine.* via a typed-out variable name).

## Reconciliation with gbrain's documented stance

**gbrain does not document a multi-tenant SaaS pattern.** Confirmed 2026-05-31 by reading every relevant gbrain doc (`docs/architecture/{brains-and-sources,topologies,system-of-record,infra-layer,serve-sync-concurrency}.md`, `docs/mcp/DEPLOY.md`, `SECURITY.md`, `INSTALL_FOR_AGENTS.md`, `README.md`). gbrain's own taxonomy points away from the path QuickBrain chose — surface this explicitly so future agents don't assume the path is gbrain-blessed.

### gbrain's two scoping axes (`docs/architecture/brains-and-sources.md`)

- **Brain** = a database (PGLite / Postgres / Supabase). Has its own `pages`, `chunks`, `embeddings` tables, lifecycle, backup, access control.
- **Source** = a named repo *within* a brain. Slugs are unique per source.
- **The decision rule, verbatim:** *"if the data owner changes, it's a brain boundary. If the data owner stays the same but the topic/repo changes, it's a source boundary."*

By that rule, each SMB = different data owner = **separate brain**. Sources are framed in `docs/mcp/DEPLOY.md` (v0.34+ `--source` flag) as *intra-brain dept separation* (e.g., `dept-x` vs `dept-y` inside one company's brain), not as cross-customer isolation.

### Other relevant gbrain signals

- **`GBRAIN_HOME`** (`docs/architecture/topologies.md`): "selects which `~/.gbrain` directory is active. Set per worktree." Per-process config switch, not a request-time tenancy primitive.
- **Explicit non-goal:** *"There's no global gbrain orchestrator that knows about all of them simultaneously — that's by design."*
- **Brain mounts** (`gbrain mounts add <id>`): federation pattern across already-independent brains. Assumes the isolation already exists at the brain layer.
- **No mention anywhere of:** RLS, schema-per-tenant, sourceId-as-tenantId, multi-customer SaaS, or hosting N businesses on one engine.

### Why QuickBrain v2.0 deviates (one brain, sourceId=tenantId)

| | One brain per tenant (gbrain's canonical answer) | One brain, sourceId-per-tenant (QuickBrain v2.0) |
|---|---|---|
| Aligns with gbrain docs | ✓ | ✗ |
| Isolation level | Separate tables/lifecycle/backup per tenant | App-layer only (RLS bypassed by pooler role) |
| Cost on Supabase | Separate project/DB per tenant → doesn't scale (free tier = 2 projects) | One project for all tenants → scales cheaply |
| Engine pool | N pools, cold-start × N | One shared engine (spikes 008 + 010 validated) |
| Future gbrain features (mounts, per-brain config) | Map cleanly | Won't map without rework |
| Failure mode | Bug in tenant routing → wrong DB connection (loud) | Bug in `tenant-scoped.ts` → silent cross-tenant leak |

The deviation is deliberate: Supabase cost/scale + the validated single-shared-engine architecture (spikes 008 + 010) make the canonical "brain per tenant" infeasible at QuickBrain's price point. The `tenant-scoped.ts` wrapper + ESLint rule described above is the engineered mitigation for the silent-leak class that the deviation introduces.

### If isolation pressure ever increases, the migration targets are

1. **Schema-per-tenant in one Supabase project** — one Postgres schema per tenant within the same DB. Stronger DB-level isolation, one bill. Requires verifying gbrain wires through schema-scoped engines (not natively supported in v0.35 — would need a small upstream patch or per-tenant engine pool, which contradicts spike 010's "single-engine" finding).
2. **Brain-per-tenant across Supabase projects** — gbrain's canonical answer. Lossy on cost; requires hitting Supabase pro tier early. Probably the right move for HIPAA/PCI-grade isolation pressure, not for normal SMB use.
3. **Stay on sourceId-per-tenant** and harden the wrapper layer (current path).

Don't reach for option 1 or 2 unless a concrete event forces it (e.g., regulated-data SMB customer, breach drill, or a gbrain upstream change that makes brain-per-tenant cheap). The wrapper layer + lint rule is the right v2.0 answer.

## Origin

Synthesized from spikes:
- **010** — `per-tenant-engine-rls` (PARTIAL ⚠): the architectural test that found the BYPASSRLS reality, confirmed the single-shared-engine works under concurrency, and surfaced the silent-leak bug class.

Plus 2026-05-31 doc-review of gbrain upstream (`docs/architecture/brains-and-sources.md`, `docs/architecture/topologies.md`, `docs/mcp/DEPLOY.md`, `SECURITY.md`, `INSTALL_FOR_AGENTS.md`, `README.md`) — confirmed gbrain documents no multi-tenant SaaS pattern, and its data-owner=brain rule disagrees with the path we picked.

Related context from:
- **007** — `gbrain-import-from-content`: validated positive+negative isolation for ONE tenant's sequential queries; left concurrent multi-tenant to spike 010.
- **008** — `inngest-supabase-pool`: confirmed the single shared engine has enough pool capacity for v2.0's multi-tenant load.

Source files available in: `sources/010-per-tenant-engine-rls/` (the architecture test); cross-refs in `sources/007-gbrain-import-from-content/` and `sources/008-inngest-supabase-pool/`.

Related references:
- `v20-supabase-foundation.md` — the Supabase backend behavior the isolation primitive runs on.
- `v20-in-process-gbrain.md` — every gbrain function the wrapper layer fronts.
