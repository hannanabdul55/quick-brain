import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Tenant isolation rule (spike-010 / spike-011). gbrain has no fail-safe
    // sourceId default — bare engine.* / hybridSearch / runThink /
    // importFromContent calls silently leak across tenants. Force every
    // gbrain touchpoint outside lib/gbrain/ through the tenantSafe wrappers
    // in lib/gbrain/tenant-scoped.ts. Spike 008 hang invariant on executeRaw
    // is also enforced here.
    files: ["app/**/*.{ts,tsx}", "lib/**/*.ts"],
    ignores: ["lib/gbrain/**"],
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
        // Class 2: bare hybridSearch / runThink / importFromContent / expandQuery / configureGateway
        {
          selector:
            "CallExpression[callee.type='Identifier'][callee.name=/^(hybridSearch|runThink|importFromContent|expandQuery|configureGateway)$/]",
          message:
            "Direct gbrain function calls are banned outside lib/gbrain/. " +
            "Use the tenantSafe wrappers in lib/gbrain/tenant-scoped.ts " +
            "(tenantSafeHybridSearch, tenantSafeRunThink, tenantSafeImportFromContent). " +
            "Reason: spike 010 silent-leak class.",
        },
        // Class 3a: engine.executeRaw with single arg (no params array)
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='engine'][callee.property.name='executeRaw'][arguments.length<2]",
          message:
            "engine.executeRaw must pass a params array (spike 008: parameterless calls " +
            "hang indefinitely against the Supavisor pooler). " +
            "If the query truly has no params, pass a sentinel: `executeRaw('SELECT $1::int = 1', [1])`.",
        },
        // Class 3b: engine.executeRaw with empty array literal as second arg
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.object.name='engine'][callee.property.name='executeRaw'][arguments.length=2][arguments.1.type='ArrayExpression'][arguments.1.elements.length=0]",
          message:
            "engine.executeRaw must pass at least one parameter (spike 008 hang invariant). " +
            "Empty params array `[]` hangs the same as a missing arg.",
        },
      ],
    },
  },
];

export default eslintConfig;
