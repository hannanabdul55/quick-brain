/**
 * gbrain shim — redirected to by tsconfig paths for all gbrain/* imports.
 *
 * PURPOSE
 * -------
 * gbrain ships raw TypeScript (.ts) with no compiled .js or .d.ts output.
 * tsc strict-checks gbrain's own source under QuickBrain's noUncheckedIndexedAccess
 * settings, producing dozens of errors we don't own.
 *
 * This shim intercepts all gbrain/* imports at the tsc level (via paths redirect
 * in tsconfig.json) and provides opaque but correctly-typed declarations.
 * At runtime (Bun / Next.js webpack) the real gbrain package is loaded via a
 * dynamic import that bypasses the paths redirect.
 *
 * RUNTIME MECHANISM
 * -----------------
 * tsc cannot statically resolve dynamic imports whose specifier is a computed
 * string, so it does not follow into node_modules/gbrain/src/core/*.ts.
 * Bun and webpack evaluate the string at runtime and load the real package.
 */

// ── Type declarations (used by tsc) ─────────────────────────────────────────

export type PageType = string;

export interface SearchResult {
  slug: string;
  page_id: number;
  title: string;
  type: PageType;
  chunk_text: string;
  chunk_source: "compiled_truth" | "timeline";
  chunk_id: number;
  chunk_index: number;
  score: number;
  stale: boolean;
  source_id?: string;
}

export interface EngineConfig {
  database_url?: string;
  database_path?: string;
  engine?: "postgres" | "pglite";
}

export interface BrainEngine {
  readonly kind: "postgres" | "pglite";
  connect(config: EngineConfig): Promise<void>;
  disconnect(): Promise<void>;
  [key: string]: unknown;
}

export interface HybridSearchOpts {
  expansion?: boolean;
  expandFn?: (query: string) => Promise<string[]>;
  limit?: number;
  [key: string]: unknown;
}

export interface AIGatewayConfig {
  /** Current embedding model as "provider:modelId" (e.g. "openai:text-embedding-3-large"). */
  embedding_model?: string;
  /** Target embedding dims. */
  embedding_dimensions?: number;
  /** Current expansion model as "provider:modelId". */
  expansion_model?: string;
  /** Default chat model. */
  chat_model?: string;
  /** Optional per-provider base URL override. */
  base_urls?: Record<string, string>;
  /**
   * Env snapshot read once at configuration time.
   * Gateway never reads process.env at call time — pass process.env here.
   */
  env: Record<string, string | undefined>;
}

// ── Runtime loaders (bypasses paths redirect via computed specifier) ─────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _load(subpath: string): Promise<any> {
  const pkg = "gbrain/" + subpath;
  return import(pkg);
}

// ── Exported functions (typed here, loaded from real gbrain at runtime) ──────

export async function createEngine(config: EngineConfig): Promise<BrainEngine> {
  const m = await _load("engine-factory");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return m.createEngine(config) as Promise<BrainEngine>;
}

export async function hybridSearch(
  engine: BrainEngine,
  query: string,
  opts?: HybridSearchOpts,
): Promise<SearchResult[]> {
  const m = await _load("search/hybrid");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return m.hybridSearch(engine, query, opts) as Promise<SearchResult[]>;
}

export async function expandQuery(query: string): Promise<string[]> {
  const m = await _load("search/expansion");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return m.expandQuery(query) as Promise<string[]>;
}

export async function configureGateway(config: AIGatewayConfig): Promise<void> {
  const m = await _load("ai/gateway");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  m.configureGateway(config);
}
