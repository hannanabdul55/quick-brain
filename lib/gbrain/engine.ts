/**
 * In-process gbrain engine layer (INPROC-01..03)
 *
 * Provides a connection pool and query function that replicate the CLI's full
 * query pipeline — multi-query expansion + RRF fusion — without spawning a
 * child process. The engine connects to Supabase Postgres via the pooler URL.
 *
 * Design decisions:
 * - enginePool is a SINGLE shared engine (one entry, keyed by the DB URL).
 *   With in-process Postgres + per-call sourceId scoping (AUTH-05 / D-11),
 *   every user's query reuses the same engine and passes their own sourceId
 *   as a call option. There is no per-user engine needed — and a per-user
 *   engine would accumulate one connection per user, creating an unbounded
 *   connection leak under multi-tenant load (T-06-25 / T-03-03 gap closed).
 *   Prior to Phase 6, the pool was keyed by tenantId (1 tenant demo — no leak).
 *   Phase 6 collapses it to a single shared engine: O(1) connections, no eviction
 *   needed. Isolation is enforced per-call via the sourceId argument to hybridSearch.
 *
 * - The pool stores Promise<BrainEngine> (not BrainEngine) to prevent race
 *   conditions when two concurrent requests call createGBrainEngine simultaneously.
 *   Awaiting the same promise is safe; calling createEngine twice is not (double-connect).
 *
 * - GBRAIN_HOME is NOT set. With in-process Postgres, gbrain reads its config
 *   from the GBRAIN_DATABASE_URL environment variable, not from a local
 *   config.json. createEngine takes the config object directly.
 *
 * - configureGateway is called once per new engine (when the pool misses) to
 *   initialize gbrain's AI gateway so that expandQuery's
 *   gatewayIsAvailable('expansion') check returns true. Without this, expandQuery
 *   returns [query] (no expansion) and hybridSearch returns only 1 result instead
 *   of the CLI's 21. The CLI calls configureGateway in connectEngine(); we
 *   replicate that here (INPROC-03 fix).
 *
 * Threat model:
 * - T-03-02: GBRAIN_DATABASE_URL is read in-process (accepted — same exposure
 *   as Phase 2's child-env injection; key never leaves the process).
 * - T-06-25: Pool collapsed to a single shared engine — no per-user connection
 *   accumulation, no eviction needed. Scoping is per-call via sourceId.
 *   (Closes the T-03-03 multi-tenant connection leak gap documented in Phase 3.)
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
  configureGateway,
  type SearchResult,
  type BrainEngine,
} from "@/types/gbrain";

export type { SearchResult };

/**
 * Single shared engine pool, keyed by the DB URL.
 *
 * Phase 3 used one entry per tenantId — fine for a 1-tenant demo, but an
 * O(n) connection leak under multi-tenant (T-03-03). Phase 6 collapses this
 * to a single shared engine: all users share one engine and pass their own
 * sourceId per call. Scoping is per-call, not per-engine (T-06-25 closed).
 *
 * The Map is retained (instead of a bare let) so that disconnectEngine() and
 * the pool-miss path remain structurally identical to Phase 3 — minimizing
 * diff noise and making future per-pool-key changes easier to introduce.
 */
const enginePool = new Map<string, Promise<BrainEngine>>();

/**
 * The key used for the single shared engine entry in enginePool.
 * We derive it lazily from the DB URL so the value is not evaluated at
 * module load time (avoids env-var-not-set errors during static analysis).
 */
const SHARED_ENGINE_KEY = "__shared__";

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
 * Get or create the shared BrainEngine.
 *
 * All users and all requests share one engine. Per-user scoping is applied
 * at the call site by passing sourceId to hybridSearch / runThink (AUTH-05, D-11).
 *
 * The tenantId parameter is kept for backward-compatibility with callers
 * (provision.ts, orchestrator.ts) but is no longer used for pool keying.
 *
 * Calls configureGateway before creating the engine, mirroring the CLI's
 * connectEngine() which calls configureGateway() before createEngine(). This
 * initializes gbrain's AI gateway singleton so expandQuery can reach the
 * expansion provider (ANTHROPIC_API_KEY) and gatewayIsAvailable('expansion')
 * returns true.
 *
 * @param _tenantId - Ignored for pool keying (kept for backward compat)
 * @returns A connected BrainEngine ready for queries
 */
export async function createGBrainEngine(_tenantId: string): Promise<BrainEngine> {
  if (enginePool.has(SHARED_ENGINE_KEY)) {
    return enginePool.get(SHARED_ENGINE_KEY)!;
  }

  // Initialize gbrain's AI gateway with the current process.env snapshot.
  // Mirrors CLI's connectEngine() which calls configureGateway(buildGatewayConfig(config))
  // before createEngine(). The gateway is a module-level singleton in gbrain;
  // configureGateway() is idempotent (just sets _config) so calling it on
  // pool-miss is safe and ensures fresh env vars are always picked up.
  await configureGateway({ env: { ...process.env } });

  const config = buildConfig();
  const enginePromise: Promise<BrainEngine> = createEngine(config).then(
    (engine) => engine.connect(config).then(() => engine),
  );

  enginePool.set(SHARED_ENGINE_KEY, enginePromise);
  return enginePromise;
}

/**
 * Disconnect and remove the shared engine from the pool.
 *
 * Safe to call even if no engine has been created (no-op).
 * After disconnect, the next createGBrainEngine call will create a fresh connection.
 *
 * The tenantId parameter is kept for backward-compatibility but is ignored.
 *
 * @param _tenantId - Ignored (kept for backward compat)
 */
export async function disconnectEngine(_tenantId: string): Promise<void> {
  if (!enginePool.has(SHARED_ENGINE_KEY)) return;
  const engine = await enginePool.get(SHARED_ENGINE_KEY)!;
  await engine.disconnect();
  enginePool.delete(SHARED_ENGINE_KEY);
}

/**
 * Run an in-process hybrid search query.
 *
 * Replicates the CLI's full query pipeline:
 *   1. Get or create the shared engine connection (T-06-25: single shared engine)
 *   2. Run hybridSearch with expandFn wired in (INPROC-03)
 *      - expandFn: expandQuery enables multi-query expansion + RRF fusion
 *      - This is what makes the in-process path return 20+ results like the CLI
 *        (bare hybridSearch without expandFn returns only 1 result — see Spike 006)
 *   3. sourceId scopes the search to a specific user's brain (AUTH-05 / D-11)
 *
 * @param tenantId - Used only for pool keying (currently a no-op — single shared engine)
 * @param question - The natural-language question to search for
 * @param opts.noExpand - When true, disables query expansion (mirrors CLI --no-expand)
 * @param opts.sourceId - When set, scopes the search to this gbrain source (AUTH-05)
 * @returns Array of SearchResult objects (slug, score, chunk_text, ...)
 */
export async function queryInProcess(
  tenantId: string,
  question: string,
  opts?: { noExpand?: boolean; sourceId?: string },
): Promise<SearchResult[]> {
  const engine = await createGBrainEngine(tenantId);
  const results = await hybridSearch(engine, question, {
    expandFn: opts?.noExpand ? undefined : expandQuery,
    expansion: !opts?.noExpand,
    sourceId: opts?.sourceId,
  });
  return results;
}
