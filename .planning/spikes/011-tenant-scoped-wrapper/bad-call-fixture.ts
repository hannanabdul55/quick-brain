/**
 * Spike 011 — synthetic "bad call" fixture for the ESLint rule.
 *
 * The proposed ESLint rule (see spike-lint-rule.cjs) bans every line below.
 * This file exists ONLY so the lint rule has something to flag — it is never
 * imported, never run, never landed in production.
 *
 * In production, the lint rule sits in the root .eslintrc.cjs `overrides`
 * section for `app/**\/*.ts`, `app/**\/*.tsx`, and `lib/!(gbrain)/**\/*.ts`.
 * This fixture file lives under `.planning/spikes/` so it stays out of the
 * production lint scope and we can demonstrate the rule against a synthetic
 * file with `--no-eslintrc --rulesdir`.
 */

// Pretend imports — the rule fires at the call-site shape, not the import.
declare const engine: {
  getPage: (slug: string, opts?: { sourceId?: string }) => Promise<unknown>;
  deletePage: (slug: string, opts?: { sourceId?: string }) => Promise<unknown>;
  listPages: (filters: unknown) => Promise<unknown>;
  getTags: (slug: string, opts?: { sourceId?: string }) => Promise<unknown>;
  putPage: (slug: string, page: unknown, opts?: { sourceId?: string }) => Promise<unknown>;
  executeRaw: (sql: string, params?: unknown[]) => Promise<unknown>;
};
declare const hybridSearch: (engine: unknown, query: string, opts?: unknown) => Promise<unknown>;
declare const importFromContent: (engine: unknown, slug: string, content: string, opts?: unknown) => Promise<unknown>;
declare const runThink: (engine: unknown, opts: unknown) => Promise<unknown>;

// Each of these MUST be flagged by the rule.
export async function bad1() {
  return await engine.getPage("some/slug"); // 🚩 bare engine.getPage
}
export async function bad2() {
  return await engine.deletePage("some/slug"); // 🚩 bare engine.deletePage
}
export async function bad3() {
  return await engine.listPages({}); // 🚩 bare engine.listPages
}
export async function bad4() {
  return await engine.getTags("some/slug"); // 🚩 bare engine.getTags
}
export async function bad5() {
  return await engine.putPage("some/slug", {}); // 🚩 bare engine.putPage
}
export async function bad6() {
  return await hybridSearch(engine, "what changed"); // 🚩 bare hybridSearch
}
export async function bad7() {
  return await importFromContent(engine, "some/slug", "# content"); // 🚩 bare importFromContent
}
export async function bad8() {
  return await runThink(engine, { question: "?" }); // 🚩 bare runThink
}
export async function bad9() {
  return await engine.executeRaw("SELECT 1"); // 🚩 parameterless executeRaw (spike 008 hang invariant)
}
export async function bad10() {
  return await engine.executeRaw("SELECT 1", []); // 🚩 empty-params executeRaw (also hangs)
}

// These are PERMITTED (would not flag) — kept here as the lint rule's "false positive"
// regression guard. The rule should NOT fire on:
export async function permitted1() {
  return await engine.executeRaw("SELECT $1::int", [1]); // ✓ has parameter
}
// (No "permitted call to engine.getPage" example — the rule's whole point is
//  that bare engine.* calls are banned outside lib/gbrain/. Callers must go
//  through tenantSafeGetPage etc.)
