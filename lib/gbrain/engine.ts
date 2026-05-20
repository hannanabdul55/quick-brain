/**
 * In-process gbrain engine layer (INPROC-01..03)
 *
 * Provides a connection pool and query function that replicate the CLI's full
 * query pipeline — multi-query expansion + RRF fusion — without spawning a
 * child process. The engine connects to Supabase Postgres via the pooler URL.
 *
 * Design decisions:
 * - enginePool stores Promise<BrainEngine> to prevent race conditions when
 *   two concurrent requests call createGBrainEngine for the same tenant
 *   simultaneously. Awaiting the same promise is safe; calling createEngine
 *   twice is not (double-connect).
 * - GBRAIN_HOME is NOT set. With in-process Postgres, gbrain reads its config
 *   from the GBRAIN_DATABASE_URL environment variable, not from a local
 *   config.json. createEngine takes the config object directly.
 * - The noExpand option mirrors the CLI's --no-expand flag (used in onboarding
 *   warm-up where expansion is unnecessary and slow).
 *
 * Threat model:
 * - T-03-02: GBRAIN_DATABASE_URL is read in-process (accepted — same exposure
 *   as Phase 2's child-env injection; key never leaves the process).
 * - T-03-03: Pool accumulates connections per tenantId. Demo has 1 tenant.
 *   Phase 6 (multi-tenant) must add pool eviction. Documented gap.
 */

// gbrain ships raw .ts; importing gbrain/* directly makes tsc strict-check
// gbrain own source. The shim at @/types/gbrain exposes typed wrappers that
// load real gbrain at runtime via a computed dynamic import. Importing the
// shim by its own path (not gbrain/*) keeps tsc out of node_modules/gbrain AND
// avoids the paths-redirect self-recursion that hangs queryInProcess.
import {
  createEngine,
  hybridSearch,
  expandQuery,
  type SearchResult,
  type BrainEngine,
} from "@/types/gbrain";

export type { SearchResult };

/**
 * Module-level engine pool, keyed by tenantId.
 * Stores Promise<BrainEngine> to prevent double-connect races.
 */
const enginePool = new Map<string, Promise<BrainEngine>>();

/**
 * Build the engine config from environment variables.
 * Reads GBRAIN_DATABASE_URL first, falls back to SUPABASE_DB_URL_POOLER.
 * Throws clearly if neither is set.
 */
function buildConfig(): { engine: "postgres"; database_url: string } {
  const database_url =
    process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!database_url) {
    throw new Error(
      "GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set for in-process gbrain queries",
    );
  }
  return { engine: "postgres", database_url };
}

/**
 * Get or create a BrainEngine for the given tenantId.
 *
 * If the pool already has a promise for this tenant, return it (await the
 * existing promise — no second createEngine call, no double-connect).
 * Otherwise create, connect, and pool a new engine.
 *
 * @param tenantId - The tenant slug (e.g. "seed")
 * @returns A connected BrainEngine ready for queries
 */
export async function createGBrainEngine(tenantId: string): Promise<BrainEngine> {
  if (enginePool.has(tenantId)) {
    return enginePool.get(tenantId)!;
  }

  const config = buildConfig();
  const enginePromise: Promise<BrainEngine> = createEngine(config).then(
    (engine) => engine.connect(config).then(() => engine),
  );

  enginePool.set(tenantId, enginePromise);
  return enginePromise;
}

/**
 * Disconnect and remove the engine for the given tenantId from the pool.
 *
 * Safe to call even if no engine has been created for this tenant (no-op).
 * After disconnect, the next createGBrainEngine call for this tenant will
 * create a fresh connection.
 *
 * @param tenantId - The tenant slug to disconnect
 */
export async function disconnectEngine(tenantId: string): Promise<void> {
  if (!enginePool.has(tenantId)) return;
  const engine = await enginePool.get(tenantId)!;
  await engine.disconnect();
  enginePool.delete(tenantId);
}

/**
 * Run an in-process hybrid search query against the tenant's brain.
 *
 * Replicates the CLI's full query pipeline:
 *   1. Get or create a pooled engine connection
 *   2. Run hybridSearch with expandFn wired in (INPROC-03)
 *      - expandFn: expandQuery enables multi-query expansion + RRF fusion
 *      - This is what makes the in-process path return 20+ results like the CLI
 *        (bare hybridSearch without expandFn returns only 1 result — see Spike 006)
 *
 * @param tenantId - The tenant slug (e.g. "seed")
 * @param question - The natural-language question to search for
 * @param opts.noExpand - When true, disables query expansion (mirrors CLI --no-expand)
 * @returns Array of SearchResult objects (slug, score, chunk_text, ...)
 */
export async function queryInProcess(
  tenantId: string,
  question: string,
  opts?: { noExpand?: boolean },
): Promise<SearchResult[]> {
  const engine = await createGBrainEngine(tenantId);
  const results = await hybridSearch(engine, question, {
    expandFn: opts?.noExpand ? undefined : expandQuery,
    expansion: !opts?.noExpand,
  });
  return results;
}
