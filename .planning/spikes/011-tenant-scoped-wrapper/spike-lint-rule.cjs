/**
 * Spike 011 — proposed ESLint rule banning bare gbrain calls outside lib/gbrain/.
 *
 * Production landing: this content goes into the root .eslintrc.cjs `overrides`
 * section, scoped to `app/**\/*.ts`, `app/**\/*.tsx`, `lib/!(gbrain)/**\/*.ts`.
 *
 * Three classes of violation:
 *   1. Bare `engine.<method>()` access where <method> is a gbrain BrainEngine method.
 *   2. Bare `hybridSearch(engine, ...)` / `runThink(engine, ...)` / `importFromContent(engine, ...)` calls.
 *   3. `engine.executeRaw(template)` with no second arg OR second arg `[]` (Spike 008 hang invariant).
 *
 * All three route the caller to a `tenantSafe*` wrapper. False positives are
 * possible only inside `lib/gbrain/` itself — the production `overrides` glob
 * scopes the rule away from there.
 *
 * This file uses ESLint's built-in `no-restricted-syntax` (no custom plugin
 * needed). The drawback: the AST selectors are tied to the literal call shape,
 * not to type information. That's the right tradeoff for "static defense
 * against accidental misuse" — the lint rule complements the runtime guard
 * in tenantSafeExecuteRaw.
 */

module.exports = {
  rules: {
    "no-restricted-syntax": [
      "error",

      // Class 1: bare engine.<bannedMethod>()
      {
        selector:
          "CallExpression[callee.type='MemberExpression'][callee.object.name='engine'][callee.property.name=/^(getPage|deletePage|listPages|getTags|putPage|deleteTag|addTag|upsertChunks|deleteChunks|createVersion|getStats|transaction)$/]",
        message:
          "Direct `engine.<method>()` is banned outside lib/gbrain/. " +
          "Use the tenantSafe wrappers in lib/gbrain/tenant-scoped.ts " +
          "(tenantSafeGetPage, tenantSafeDeletePage, tenantSafeListPages, ...). " +
          "Reason: gbrain has no fail-safe sourceId default (spike 010); " +
          "bare calls silently leak across tenants.",
      },

      // Class 2: bare hybridSearch / runThink / importFromContent
      {
        selector:
          "CallExpression[callee.type='Identifier'][callee.name=/^(hybridSearch|runThink|importFromContent|expandQuery|configureGateway)$/]",
        message:
          "Direct gbrain function calls are banned outside lib/gbrain/. " +
          "Use the tenantSafe wrappers in lib/gbrain/tenant-scoped.ts " +
          "(tenantSafeHybridSearch, tenantSafeRunThink, tenantSafeImportFromContent). " +
          "Reason: spike 010 silent-leak class.",
      },

      // Class 3: engine.executeRaw with missing or empty params
      // (a) engine.executeRaw('...')  — single arg
      {
        selector:
          "CallExpression[callee.type='MemberExpression'][callee.object.name='engine'][callee.property.name='executeRaw'][arguments.length<2]",
        message:
          "engine.executeRaw must pass a params array (spike 008: parameterless calls " +
          "hang indefinitely against the Supavisor pooler). " +
          "If the query truly has no params, pass a sentinel: `executeRaw('SELECT $1::int = 1', [1])`.",
      },
      // (b) engine.executeRaw('...', [])  — empty array literal
      {
        selector:
          "CallExpression[callee.type='MemberExpression'][callee.object.name='engine'][callee.property.name='executeRaw'][arguments.length=2][arguments.1.type='ArrayExpression'][arguments.1.elements.length=0]",
        message:
          "engine.executeRaw must pass at least one parameter (spike 008 hang invariant). " +
          "Empty params array `[]` hangs the same as a missing arg.",
      },
    ],
  },
};
