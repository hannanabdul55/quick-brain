/**
 * Spike 011 — proposed lib/gbrain/tenant-scoped.ts
 *
 * Spike artifact. NOT yet landed in production code (`lib/gbrain/`). Phase 7
 * plan execution lands the production version based on this blueprint, after
 * spike validation confirms the shape works against real call sites.
 *
 * Purpose: every gbrain call in QuickBrain MUST be tenant-scoped per spike 010
 * (the BYPASSRLS reality). This file is the SINGLE place app code reaches gbrain.
 * The ESLint rule (sibling .eslintrc-fragment.cjs) bans direct engine.* access
 * outside `lib/gbrain/` so silent leak via call-site oversight is killed at
 * compile time.
 *
 * Consolidates:
 *   - lib/gbrain/client.ts:query / think  (already tenant-scoped — moves here)
 *   - lib/auth/provision.ts:provisionBrain (already scoped via sourceId arg, but
 *     uses awkward type cast on engine.executeRaw — wrapper kills the cast)
 *
 * Adds (Phase 7 write side):
 *   - tenantSafeImportFromContent  (Spike 007 — primary QBO ingest entrypoint)
 *   - tenantSafeGetPage            (idempotency lookups, dashboard reads)
 *   - tenantSafeDeletePage         (single-page corrections — rare)
 *   - tenantSafeListPages          (dashboard counts, admin paths)
 *   - tenantSafeRegisterSource     (Spike 007 — connect-time source provisioning)
 *   - tenantSafeWipeSource         (Spike 007 — D-08 wipe-and-reingest, one SQL via FK cascade)
 *
 * Architecture invariants enforced here:
 *   I1: every wrapper REQUIRES a tenantId arg (not optional).
 *   I2: tenantId → sourceId resolution goes through resolveTenant() (chokepoint).
 *   I3: bare engine.* / hybridSearch / importFromContent calls are forbidden
 *       outside this file (lint rule).
 *   I4: executeRaw is exposed via a typed wrapper so callers (provision.ts) don't
 *       need the `engine as unknown as { executeRaw }` cast.
 *   I5: ALL executeRaw calls pass at least one $N parameter (spike 008 finding —
 *       parameterless calls hang against Supavisor).
 */

// In production: import from "@/types/gbrain" and "@/lib/gbrain/engine" + "@/lib/auth/resolve-tenant".
// For the spike, we use relative imports so the file is testable standalone.
import {
  type BrainEngine,
  type SearchResult,
  type HybridSearchOpts,
  hybridSearch,
  expandQuery,
  runThink,
  type RunThinkOpts,
  type ThinkResult,
} from "../../../types/gbrain";

// Spike-only: shim for createGBrainEngine + resolveTenant. In production, import:
//   import { createGBrainEngine } from "@/lib/gbrain/engine";
//   import { resolveTenantSourceId } from "@/lib/auth/resolve-tenant";
import { createGBrainEngine } from "./spike-engine-shim";
import { resolveTenantSourceId } from "./spike-tenant-shim";

// ─────────────────────────────────────────────────────────────────────────────
// Type re-exports — callers import these from tenant-scoped.ts, never from
// types/gbrain directly. This is enforced by the ESLint rule.
// ─────────────────────────────────────────────────────────────────────────────

export type { SearchResult, ThinkResult };

export interface ImportResult {
  slug: string;
  status: "imported" | "skipped" | "errored";
  chunks: number;
  error?: string;
}

export interface ImportFromContentOpts {
  forceRechunk?: boolean;
  noEmbed?: boolean;
  filename?: string;
  sourcePath?: string;
}

export interface PageRow {
  slug: string;
  type: string;
  title: string;
  source_id: string;
  content_hash?: string;
  frontmatter?: Record<string, unknown>;
  compiled_truth?: string;
  timeline?: string;
}

export interface ListPagesFilters {
  type?: string;
  limit?: number;
  offset?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// READ-SIDE WRAPPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tenant-safe hybrid search. Replaces the existing pattern in lib/gbrain/client.ts:query.
 *
 * tenantId is REQUIRED (TS enforced). Internally resolves to sourceId via the
 * Phase 6 chokepoint.
 */
export async function tenantSafeHybridSearch(
  tenantId: string,
  query: string,
  opts: Omit<HybridSearchOpts, "sourceId" | "sourceIds"> = {},
): Promise<SearchResult[]> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  const expandFn: (q: string) => Promise<string[]> =
    (opts.expandFn as ((q: string) => Promise<string[]>) | undefined) ?? expandQuery;
  return hybridSearch(engine, query, {
    ...opts,
    sourceId,
    expandFn,
    expansion: (opts.expansion as boolean | undefined) ?? true,
  });
}

/**
 * Tenant-safe LLM synthesis. Replaces the existing pattern in lib/gbrain/client.ts:think.
 */
export async function tenantSafeRunThink(
  tenantId: string,
  opts: Omit<RunThinkOpts, "sourceId">,
): Promise<ThinkResult> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  return runThink(engine, { ...opts, sourceId });
}

/**
 * Tenant-safe page lookup. Used by Phase 7 connectors to check "does this page
 * already exist before we ingest?" — spike 007 confirmed (slug, source_id)
 * composite key returns the right row.
 *
 * IMPLEMENTATION NOTE: BrainEngine declares `getPage` only via [key: string]: unknown
 * in the shim — see "Ergonomic finding #1" in README.md. Production version
 * threads the typed signature through types/gbrain.ts.
 */
export async function tenantSafeGetPage(
  tenantId: string,
  slug: string,
): Promise<PageRow | null> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  const typed = engine as unknown as {
    getPage: (slug: string, opts: { sourceId: string }) => Promise<PageRow | null>;
  };
  return typed.getPage(slug, { sourceId });
}

/**
 * Tenant-safe single-page delete. Rarely needed in production (full re-sync
 * uses tenantSafeWipeSource); useful for manual corrections.
 */
export async function tenantSafeDeletePage(
  tenantId: string,
  slug: string,
): Promise<void> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  const typed = engine as unknown as {
    deletePage: (slug: string, opts: { sourceId: string }) => Promise<void>;
  };
  await typed.deletePage(slug, { sourceId });
}

/**
 * Tenant-safe list-pages. Used by dashboard counts and admin paths.
 */
export async function tenantSafeListPages(
  tenantId: string,
  filters: ListPagesFilters = {},
): Promise<PageRow[]> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  const typed = engine as unknown as {
    listPages: (filters: ListPagesFilters & { sourceId: string }) => Promise<PageRow[]>;
  };
  return typed.listPages({ ...filters, sourceId });
}

// ─────────────────────────────────────────────────────────────────────────────
// WRITE-SIDE WRAPPERS (Phase 7 — primary QBO ingest path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tenant-safe importFromContent. Primary Phase 7 entrypoint for QBO ingest.
 * Validated in spike 007 — 1.9s/page incl. one OpenAI embedding call,
 * idempotent via content_hash, isolated by sourceId.
 *
 * Requires the source row to already exist (FK pages_source_id_fkey).
 * Callers should ensure tenantSafeRegisterSource ran first (typically at OAuth-connect).
 */
export async function tenantSafeImportFromContent(
  tenantId: string,
  slug: string,
  content: string,
  opts: ImportFromContentOpts = {},
): Promise<ImportResult> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  // import-file subpath is in gbrain's package.json exports (spike 007 confirmed).
  // In production: import importFromContent from "@/types/gbrain" after the shim
  // is extended in Phase 7's first plan (mechanical _load("import-file") wrapper).
  //
  // We cast m.importFromContent to a signature using the SHIM's BrainEngine
  // (not gbrain's source-tree BrainEngine, which has 105+ methods the shim
  // intentionally hides behind [key: string]: unknown). Same pattern types/gbrain.ts
  // uses for every dynamic-import boundary.
  const m = (await import(/* webpackIgnore: true */ "gbrain/import-file")) as unknown as {
    importFromContent: (
      engine: BrainEngine,
      slug: string,
      content: string,
      opts: ImportFromContentOpts & { sourceId?: string },
    ) => Promise<ImportResult>;
  };
  return m.importFromContent(engine, slug, content, { ...opts, sourceId });
}

/**
 * Tenant-safe source-row INSERT — must run at OAuth-connect BEFORE any
 * tenantSafeImportFromContent call (spike 007 FK pre-registration finding).
 *
 * Replaces the existing pattern in lib/auth/provision.ts:provisionBrain.
 * Idempotent via ON CONFLICT (id) DO NOTHING.
 *
 * Spike 008 invariant: always passes a parameter (3 params here).
 */
export async function tenantSafeRegisterSource(
  tenantId: string,
  displayName: string,
  config: Record<string, unknown> = {},
): Promise<void> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  await tenantSafeExecuteRaw(
    engine,
    `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
    [sourceId, displayName, JSON.stringify({ federated: false, ...config })],
  );
}

/**
 * Tenant-safe wipe-and-reingest primitive. Spike 007 measured ~120ms — one SQL
 * via FK ON DELETE CASCADE (pages + chunks + tags + links + content_chunks).
 *
 * Phase 7 D-08 ("Re-sync Now" button) is just this followed by
 * tenantSafeRegisterSource + re-enqueuing the ingest job.
 */
export async function tenantSafeWipeSource(tenantId: string): Promise<void> {
  const sourceId = await resolveTenantSourceId(tenantId);
  const engine = await createGBrainEngine();
  await tenantSafeExecuteRaw(
    engine,
    `DELETE FROM sources WHERE id = $1`,
    [sourceId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOW-LEVEL ESCAPE HATCH — typed executeRaw for ops the wrappers don't cover
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed engine.executeRaw — kills the `as unknown as { executeRaw }` cast in
 * lib/auth/provision.ts. Internal to this file; callers should prefer the
 * higher-level wrappers above.
 *
 * Spike 008 invariant: REQUIRES at least one $N parameter. Parameterless calls
 * hang indefinitely against the Supavisor pooler. The runtime guard below is
 * belt-and-suspenders for the lint rule.
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
  const typed = engine as unknown as {
    executeRaw: (sql: string, params: unknown[]) => Promise<T[]>;
  };
  return typed.executeRaw(sql, params);
}
