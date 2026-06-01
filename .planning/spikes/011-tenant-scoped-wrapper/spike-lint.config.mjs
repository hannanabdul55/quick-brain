// Spike-only ESLint flat config — runs the proposed rule against the bad-call
// fixture so the spike can demonstrate it fires.
//
// Usage:
//   node_modules/.bin/eslint \
//     --config .planning/spikes/011-tenant-scoped-wrapper/spike-lint.config.mjs \
//     --no-config-lookup \
//     .planning/spikes/011-tenant-scoped-wrapper/bad-call-fixture.ts

import tsParser from "@typescript-eslint/parser";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const proposed = require(resolve(__dirname, "./spike-lint-rule.cjs"));

export default [
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: proposed.rules,
  },
];
