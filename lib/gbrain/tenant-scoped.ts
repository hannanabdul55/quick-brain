/**
 * lib/gbrain/tenant-scoped.ts — the single safe call site for every gbrain
 * operation in QuickBrain v2.0.
 *
 * Spike 010 (PARTIAL ⚠ → CLOSED-BY-011) found that gbrain has no fail-safe
 * default for `sourceId`. Bare engine.getPage / deletePage / listPages /
 * hybridSearch / importFromContent calls silently leak across tenants — no
 * exception, no warning. Spike 011 validated this wrapper layer against the
 * live Supabase brain (6/6 probes pass) and proved the companion ESLint rule
 * fires on 10/10 bad-call shapes.
 *
 * Architecture invariants enforced here:
 *   I1: every wrapper requires a tenant identity (either a session or an
 *       explicit sourceId). TypeScript signatures enforce this — there is no
 *       overload that takes neither.
 *   I2: session-derived wrappers go through resolveTenant() (the Phase 6
 *       chokepoint, lib/auth/resolve-tenant.ts). NEVER trust params.id.
 *   I3: explicit-sourceId variants are suffixed *Explicit and used by jobs
 *       and provisioning paths (no session available there). Their existence
 *       is the documented boundary — surfacing them makes "where does this
 *       sourceId come from?" auditable.
 *   I4: ALL executeRaw calls pass at least one $N parameter (spike 008 — the
 *       parameterless call hangs against Supavisor). tenantSafeExecuteRaw
 *       throws if params.length === 0; the ESLint rule catches the static
 *       case at compile time.
 *   I5: bare engine.* / hybridSearch / importFromContent calls are forbidden
 *       outside lib/gbrain/ (ESLint rule in eslint.config.mjs).
 *
 * Design note: session-only as primary API was chosen because production's
 * resolveTenant() reads the qb_session cookie and takes NO arguments — D-11
 * forbids accepting a tenant/source id from caller args. The spike's original
 * blueprint had tenantId-as-arg which would have re-introduced the very
 * "trust params.id" antipattern Phase 6 closed. *Explicit variants exist
 * solely for contexts where there is no session (Inngest jobs, scripts,
 * provisioning).
 */

import { resolveTenant } from "@/lib/auth/resolve-tenant";
import { createGBrainEngine } from "@/lib/gbrain/engine";
import {
  type BrainEngine,
  type HybridSearchOpts,
  type ImportFromContentOpts,
  type ImportResult,
  type ListPagesFilters,
  type PageRow,
  type RunThinkOpts,
  type SearchResult,
  type ThinkResult,
  expandQuery,
  hybridSearch,
  importFromContent,
  runThink,
} from "@/types/gbrain";

// Re-export types so callers import them from here, not from @/types/gbrain
// directly. Combined with the ESLint rule, this funnels every gbrain touchpoint
// through this file.
export type {
  ImportResult,
  ListPagesFilters,
  PageRow,
  RunThinkOpts,
  SearchResult,
  ThinkResult,
};

// ─────────────────────────────────────────────────────────────────────────────
// Session chokepoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the authenticated user's sourceId from the qb_session cookie, or
 * throw. Used internally by every session-derived wrapper below.
 *
 * The throw is intentional: app code calling these wrappers without an
 * authenticated session is a bug — the route should have run auth middleware
 * first (Phase 6).
 */
async function resolveSessionSourceId(): Promise<string> {
  const ctx = await resolveTenant();
  if (!ctx.authenticated) {
    throw new Error(
      "tenant-scoped: no authenticated session — call resolveTenant() first " +
        "or use the *Explicit variant with a sourceId from a verified job payload.",
    );
  }
  return ctx.sourceId;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-SIDE WRAPPERS (session-derived; primary API for app routes)
// ─────────────────────────────────────────────────────────────────────────────

export async function tenantSafeHybridSearch(
  query: string,
  opts: Pick<HybridSearchOpts, "expansion" | "expandFn" | "limit"> = {},
): Promise<SearchResult[]> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeHybridSearchExplicit(sourceId, query, opts);
}

export async function tenantSafeRunThink(
  opts: Omit<RunThinkOpts, "sourceId">,
): Promise<ThinkResult> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeRunThinkExplicit(sourceId, opts);
}

export async function tenantSafeGetPage(slug: string): Promise<PageRow | null> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeGetPageExplicit(sourceId, slug);
}

export async function tenantSafeDeletePage(slug: string): Promise<void> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeDeletePageExplicit(sourceId, slug);
}

export async function tenantSafeListPages(
  filters: ListPagesFilters = {},
): Promise<PageRow[]> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeListPagesExplicit(sourceId, filters);
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-SIDE WRAPPERS (explicit sourceId; for jobs / scripts / provisioning)
// ─────────────────────────────────────────────────────────────────────────────

export async function tenantSafeHybridSearchExplicit(
  sourceId: string,
  query: string,
  opts: Pick<HybridSearchOpts, "expansion" | "expandFn" | "limit"> = {},
): Promise<SearchResult[]> {
  const engine = await createGBrainEngine(sourceId);
  return hybridSearch(engine, query, {
    ...opts,
    sourceId,
    expandFn: opts.expandFn ?? expandQuery,
    expansion: opts.expansion ?? true,
  });
}

export async function tenantSafeRunThinkExplicit(
  sourceId: string,
  opts: Omit<RunThinkOpts, "sourceId">,
): Promise<ThinkResult> {
  const engine = await createGBrainEngine(sourceId);
  return runThink(engine, { ...opts, sourceId });
}

export async function tenantSafeGetPageExplicit(
  sourceId: string,
  slug: string,
): Promise<PageRow | null> {
  const engine = await createGBrainEngine(sourceId);
  return engine.getPage(slug, { sourceId });
}

export async function tenantSafeDeletePageExplicit(
  sourceId: string,
  slug: string,
): Promise<void> {
  const engine = await createGBrainEngine(sourceId);
  return engine.deletePage(slug, { sourceId });
}

export async function tenantSafeListPagesExplicit(
  sourceId: string,
  filters: ListPagesFilters = {},
): Promise<PageRow[]> {
  const engine = await createGBrainEngine(sourceId);
  return engine.listPages({ ...filters, sourceId });
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE-SIDE WRAPPERS (session-derived; primary API for app routes)
// ─────────────────────────────────────────────────────────────────────────────

export async function tenantSafeImportFromContent(
  slug: string,
  content: string,
  opts: Omit<ImportFromContentOpts, "sourceId"> = {},
): Promise<ImportResult> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeImportFromContentExplicit(sourceId, slug, content, opts);
}

export async function tenantSafeRegisterSource(
  displayName: string,
  config: Record<string, unknown> = {},
): Promise<void> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeRegisterSourceExplicit(sourceId, displayName, config);
}

export async function tenantSafeWipeSource(): Promise<void> {
  const sourceId = await resolveSessionSourceId();
  return tenantSafeWipeSourceExplicit(sourceId);
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE-SIDE WRAPPERS (explicit sourceId; for jobs / scripts / provisioning)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Spike 007 primary entrypoint. Requires the source row to exist already
 * (FK pages_source_id_fkey) — callers must run tenantSafeRegisterSourceExplicit
 * at OAuth-connect before the first ingest.
 */
export async function tenantSafeImportFromContentExplicit(
  sourceId: string,
  slug: string,
  content: string,
  opts: Omit<ImportFromContentOpts, "sourceId"> = {},
): Promise<ImportResult> {
  const engine = await createGBrainEngine(sourceId);
  return importFromContent(engine, slug, content, { ...opts, sourceId });
}

/**
 * Idempotent source-row INSERT. Replaces lib/auth/provision.ts's direct
 * executeRaw call. Spike 008 invariant: 3 $N params, never zero.
 */
export async function tenantSafeRegisterSourceExplicit(
  sourceId: string,
  displayName: string,
  config: Record<string, unknown> = {},
): Promise<void> {
  const engine = await createGBrainEngine(sourceId);
  await tenantSafeExecuteRaw(
    engine,
    `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
    [sourceId, displayName, JSON.stringify({ federated: false, ...config })],
  );
}

/**
 * Wipe-and-reingest primitive. Spike 007 measured ~120ms via FK ON DELETE
 * CASCADE (pages + chunks + tags + links + content_chunks). Phase 7 D-08
 * ("Re-sync Now") chains this with tenantSafeRegisterSourceExplicit + a
 * re-enqueued ingest job.
 */
export async function tenantSafeWipeSourceExplicit(sourceId: string): Promise<void> {
  const engine = await createGBrainEngine(sourceId);
  await tenantSafeExecuteRaw(
    engine,
    `DELETE FROM sources WHERE id = $1`,
    [sourceId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Low-level escape hatch — typed executeRaw with spike-008 runtime guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed wrapper around engine.executeRaw. Internal — callers should prefer
 * the higher-level tenantSafe wrappers above. Exposed (lowercase, no export)
 * only to the wrappers in this file.
 *
 * Spike 008 invariant: REQUIRES at least one $N parameter. Parameterless calls
 * hang indefinitely against the Supavisor pooler (statement_timeout doesn't
 * fire). The runtime guard below is belt-and-suspenders for the lint rule;
 * if the lint rule is ever bypassed, this still catches it.
 */
async function tenantSafeExecuteRaw<T = unknown>(
  engine: BrainEngine,
  sql: string,
  params: unknown[],
): Promise<T[]> {
  if (params.length === 0) {
    throw new Error(
      "tenantSafeExecuteRaw: parameterless calls hang against Supavisor — pass at least one $N parameter. " +
        "If the query truly has no params, add a sentinel like `SELECT $1::int = 1` with `[1]`.",
    );
  }
  return engine.executeRaw<T>(sql, params);
}
