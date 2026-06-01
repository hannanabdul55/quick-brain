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
 * At runtime (Bun / Next.js webpack) the real gbrain package is loaded via
 * webpackIgnore-annotated dynamic imports that Bun handles natively.
 *
 * RUNTIME MECHANISM
 * -----------------
 * The `/* webpackIgnore: true *\/` magic comment on each import() call tells
 * webpack to emit the dynamic import AS-IS at runtime without processing it.
 * No module graph entry, no context module, no parse attempt on gbrain source.
 *
 * The production server is started with `bun node_modules/.bin/next start`
 * (package.json "start" script) so that Bun is the runtime. Bun natively loads
 * gbrain's raw .ts source files via its TypeScript support. Node.js would fail
 * with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
 *
 * tsc cannot statically resolve dynamic imports whose specifier is a computed
 * string, so it does not follow into node_modules/gbrain/src/core/*.ts.
 *
 * THINK MODULE LOADING
 * --------------------
 * gbrain/src/core/think/index.ts is NOT in gbrain's package.json exports map,
 * so import("gbrain/think/index") throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * We construct the absolute path using process.cwd() + the known package
 * structure (node_modules/gbrain/src/core/think/index.ts) and load it as a
 * file:// URL with webpackIgnore.
 *
 * We avoid:
 * - import.meta.resolve() — webpack transforms it to ({}).resolve (undefined)
 * - createRequire.resolve("gbrain/engine") — webpack intercepts and returns a
 *   numeric module ID instead of the actual file path
 */

import { join } from "node:path";

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

/**
 * A page row scoped to a single source (tenant).
 * Returned by BrainEngine.getPage / listPages.
 */
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

/**
 * Filters for BrainEngine.listPages. sourceId is required for tenant isolation
 * (spike 010 — silent leak class when omitted).
 */
export interface ListPagesFilters {
  type?: string;
  limit?: number;
  offset?: number;
}

export interface BrainEngine {
  readonly kind: "postgres" | "pglite";
  connect(config: EngineConfig): Promise<void>;
  disconnect(): Promise<void>;

  // Tenant-scoped data methods. ALL require a sourceId per spike 010
  // (BYPASSRLS pooler role means RLS is not the isolation primitive — app-layer
  // sourceId scoping is). Bare calls without sourceId silently leak across
  // sources. lib/gbrain/tenant-scoped.ts is the single safe call site.
  getPage(slug: string, opts: { sourceId: string }): Promise<PageRow | null>;
  deletePage(slug: string, opts: { sourceId: string }): Promise<void>;
  listPages(filters: ListPagesFilters & { sourceId: string }): Promise<PageRow[]>;

  // Low-level SQL escape hatch. Spike 008 invariant: REQUIRES at least one $N
  // parameter — parameterless calls hang indefinitely against Supavisor.
  executeRaw<T = unknown>(sql: string, params: unknown[]): Promise<T[]>;

  [key: string]: unknown;
}

export interface HybridSearchOpts {
  expansion?: boolean;
  expandFn?: (query: string) => Promise<string[]>;
  limit?: number;
  /** Scope results to a single source partition (tenant isolation). */
  sourceId?: string;
  /** Federated multi-source scope; wins over scalar sourceId when set. */
  sourceIds?: string[];
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

// ── Runtime loaders ───────────────────────────────────────────────────────────
//
// The /* webpackIgnore: true */ magic comment tells webpack to skip processing
// this import() entirely — no module graph, no context module, no file parsing.
// Webpack emits the import() verbatim; Bun handles it at runtime.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _load(subpath: string): Promise<any> {
  const pkg = "gbrain/" + subpath;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return import(/* webpackIgnore: true */ pkg);
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

// ── Think (LLM synthesis) shim ───────────────────────────────────────────────
// gbrain/src/core/think/index.ts is NOT in gbrain's package.json exports map.
//
// Path construction strategy: process.cwd() + "node_modules/gbrain/src/core/think/index.ts"
// This avoids all require.resolve / import.meta.resolve approaches that webpack intercepts:
//   - import.meta.resolve() → webpack transforms to ({}).resolve (undefined at runtime)
//   - createRequire.resolve("gbrain/engine") → webpack intercepts and returns numeric module ID
//
// process.cwd() is the project root in all expected runtime environments:
//   - Local: `bun run start` from the repo directory
//   - Vercel: function runs from the project root
// The "file://" prefix is required for ESM import() to accept a path string.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function _loadThink(): Promise<any> {
  const thinkPath = join(process.cwd(), "node_modules", "gbrain", "src", "core", "think", "index.ts");
  const thinkUrl = "file://" + thinkPath;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return import(/* webpackIgnore: true */ thinkUrl);
}

export interface RunThinkOpts {
  question: string;
  anchor?: string;
  rounds?: number;
  save?: boolean;
  take?: boolean;
  model?: string;
  since?: string;
  until?: string;
  /**
   * Scope chat synthesis to a single source partition (tenant isolation — D-12).
   *
   * This field is threaded into gbrain's think path via patches/gbrain+3933eb6.patch.
   * A gbrain version bump invalidates the patch; re-run `diff -u` against the new
   * gbrain source and update patches/gbrain+3933eb6.patch after any bump.
   */
  sourceId?: string;
  /** Inject an LLM client (for tests — avoids real Anthropic calls). */
  client?: unknown;
  /** Pure-test escape: return synthesized payload without calling any LLM. */
  stubResponse?: {
    answer: string;
    citations: Array<{ page_slug: string; row_num: number | null; citation_index?: number }>;
    gaps: string[];
  };
}

export interface ThinkResult {
  question: string;
  answer: string;
  citations: Array<{
    page_slug: string;
    row_num: number | null;
    text: string;
    citation_index: number;
  }>;
  gaps: string[];
  pagesGathered: number;
  takesGathered: number;
  graphHits: number;
  modelUsed: string;
  rounds: number;
  warnings: string[];
  savedSlug?: string;
  diagnostics: {
    pagesFromHybrid: number;
    takesFromKeyword: number;
    takesFromVector: number;
    graphHits: number;
  };
}

export async function runThink(engine: BrainEngine, opts: RunThinkOpts): Promise<ThinkResult> {
  const m = await _loadThink();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return m.runThink(engine, opts) as Promise<ThinkResult>;
}

// ── ImportFromContent (Phase 7 — primary QBO ingest entrypoint) ───────────────
//
// gbrain's import-file subpath is in its package.json exports map (spike 007
// confirmed). Loaded via the same _load("subpath") dynamic-import pattern as
// every other entrypoint in this shim.

export interface ImportFromContentOpts {
  /** Required: scope to a single source (tenant isolation). Spike 010. */
  sourceId?: string;
  forceRechunk?: boolean;
  noEmbed?: boolean;
  filename?: string;
  sourcePath?: string;
}

export interface ImportResult {
  slug: string;
  status: "imported" | "skipped" | "errored";
  chunks: number;
  error?: string;
}

export async function importFromContent(
  engine: BrainEngine,
  slug: string,
  content: string,
  opts: ImportFromContentOpts,
): Promise<ImportResult> {
  const m = await _load("import-file");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  return m.importFromContent(engine, slug, content, opts) as Promise<ImportResult>;
}
