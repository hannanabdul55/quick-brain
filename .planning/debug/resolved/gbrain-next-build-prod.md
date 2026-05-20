---
status: resolved
trigger: "In-process gbrain integration does not survive a Next.js 15 production build (next build + next start) — blocks Phase 4 Vercel deploy; discovered at the 04-01 build-readiness checkpoint."
created: 2026-05-20T12:48:00Z
updated: 2026-05-20T07:30:00Z
---

## Current Focus
<!-- OVERWRITE on each update - always reflects NOW -->

hypothesis: RESOLVED — see Resolution section.
test: PASSED — bun run build + bun run start + chat smoke test all pass.
expecting: N/A
next_action: none — fix applied and verified.
reasoning_checkpoint: null
tdd_checkpoint: null

## Symptoms
<!-- Written during gathering, then immutable -->

expected: `bun run build` followed by `bun run start` produces a working app where the in-process gbrain chat path (`POST /api/tenants/[id]/chat` → `think()` via `lib/gbrain/client` → `types/gbrain.ts`) returns a real answer. Phase 4 deploys this production build to Vercel.
actual: `bun run build` compiles (with warnings) but `bun run start` does not serve a working app. With committed `serverExternalPackages: ["gbrain"]` every route 500s; without it the gbrain chat path throws `Cannot find module 'gbrain/ai/gateway'`.
errors: (1) production server with `serverExternalPackages`: `GET /api/tenants` → HTTP 500 instead of 405; `next start` logs nothing. (2) without `serverExternalPackages`: `POST /api/tenants/seed/chat` → SSE error frame `Brain error: Cannot find module 'gbrain/ai/gateway'`; server log `[chat:error] err: "Error: Cannot find module 'gbrain/ai/gateway'"`. (3) `next build` warnings on `./types/gbrain.ts`: `Critical dependency: the request of a dependency is an expression` and `Critical dependency: Accessing import.meta directly is unsupported`.
reproduction: `export PATH="$HOME/.bun/bin:$PATH"; bun run build; PORT=<free-port> bun run start` then `curl http://localhost:<port>/api/tenants` and `curl -X POST http://localhost:<port>/api/tenants/seed/chat -H 'Content-Type: application/json' -d '{"question":"what was weird about March?"}'`. NOTE: chat route body field is `question`, not `message`. Works fine under `bun run dev`.
started: Always — the in-process gbrain path (built in Phase 3) has only ever run under `bun run dev`; `next build` was never exercised until the Phase 4 04-01 checkpoint.

## Eliminated
<!-- APPEND only - prevents re-investigating after /clear -->

- hypothesis: `lib/gbrain/paths.ts` `import.meta.dir` (Bun-only) is the cause.
  evidence: `paths.ts` lines 6-9 already guard with `typeof import.meta.dir === "string"` and fall back to `process.cwd()` — confirmed by reading the file. Not the failure point.
  timestamp: 2026-05-20T12:48:00Z

- hypothesis: the route module fails to evaluate (throws on import) under production.
  evidence: `require()`-ing the compiled `.next/server/app/api/tenants/route.js` from the `.next/server` cwd loaded OK (`keys: [handler, patchFetch, routeModule, ...]`). Module eval succeeds; the 500 originates elsewhere in the server runtime.
  timestamp: 2026-05-20T12:48:00Z

- hypothesis: `serverExternalPackages: ["gbrain"]` alone fixes the MODULE_NOT_FOUND error.
  evidence: `serverExternalPackages` only externalizes statically-analyzable module paths. The computed `import("gbrain/" + subpath)` becomes webpack's empty context module (module ID 4285) regardless of externals. The 500-on-every-route was a prior-session artifact caused by a different code state.
  timestamp: 2026-05-20T07:00:00Z

- hypothesis: `createRequire(import.meta.url).resolve("gbrain/engine")` can find the think path.
  evidence: webpack intercepts `.resolve()` on createRequire-built functions and returns a numeric webpack module ID (e.g. 3350) instead of the actual file path. Not usable for path computation.
  timestamp: 2026-05-20T07:00:00Z

- hypothesis: explicit literal `import("gbrain/ai/gateway")` + externals function solves the build.
  evidence: explicit literal imports compile but cause tsc to follow into gbrain's node_modules source and fail on `noUncheckedIndexedAccess` violations in gbrain's own code (e.g. `env[required[0]]`). webpack externals function prevents webpack from parsing but does not help tsc.
  timestamp: 2026-05-20T07:00:00Z

## Evidence
<!-- APPEND only - facts discovered during investigation -->

- timestamp: 2026-05-20T12:48:00Z
  checked: `bun run build` with committed `next.config.ts` (`serverExternalPackages: ["gbrain"]`).
  found: Compiles successfully in ~16s; only gbrain-related output is `Critical dependency` WARNINGS on `./types/gbrain.ts` (computed dependency + `import.meta`). No WASM/module-resolution errors, no oversized bundle.
  implication: The build is not the failure surface; the failure is at production runtime.

- timestamp: 2026-05-20T12:48:00Z
  checked: `bun run start` (next start) with committed `serverExternalPackages: ["gbrain"]`, probed `/`, `/onboard`, `/dash/seed`, `/api/tenants`, `/api/tenants/seed/insights`, `/api/tenants/seed/chat`.
  found: `/` → 200; EVERY other route → 500, including `GET /api/tenants` (route only exports POST → expected 405, got 500). `next start` logs nothing. 500 body is plaintext "Internal Server Error" with an `ETag` header.
  implication: `serverExternalPackages: ["gbrain"]` breaks the production server runtime globally, before per-route method dispatch — not isolated to gbrain code paths.

- timestamp: 2026-05-20T12:48:00Z
  checked: Reverted `next.config.ts` to empty `{}`, rebuilt, `bun run start`, probed same routes.
  found: `/`=200, `/api/tenants`=405 (correct), `/onboard`=200, `/dash/seed`=200 — all routes work. (next.config.ts has since been restored to the committed `serverExternalPackages` state.)
  implication: `serverExternalPackages: ["gbrain"]` is the sole cause of the all-routes-500 failure. The build does NOT need it to compile.

- timestamp: 2026-05-20T12:48:00Z
  checked: `POST /api/tenants/seed/chat` against the reverted (empty-config) production build.
  found: HTTP 200 with SSE error frame `Brain error: Cannot find module 'gbrain/ai/gateway'`. Server log `[chat:error] durationMs: 0, err: "Error: Cannot find module 'gbrain/ai/gateway'"`.
  implication: Even without `serverExternalPackages`, the webpack-bundled production server cannot resolve gbrain's computed dynamic imports. `types/gbrain.ts::_load(subpath)` does `import("gbrain/" + subpath)` (webpack context module) and `_loadThink()` uses `import.meta.resolve("gbrain/engine")`. gbrain ships raw `.ts` and Next excludes `node_modules` from its TS loader by default — the context module has no usable `gbrain/ai/gateway` entry at runtime.

- timestamp: 2026-05-20T12:48:00Z
  checked: `bun run dev` (next dev), `GET /api/tenants`.
  found: Returns 405 correctly; app works under dev.
  implication: The failure is specific to the webpack production build path, not the application logic.

- timestamp: 2026-05-20T07:00:00Z
  checked: Compiled `.next/server/chunks/709.js` for the empty context module.
  found: Module ID 4285 is `function b(a){return Promise.resolve().then(()=>{var b=Error("Cannot find module '"+a+"'");throw b.code="MODULE_NOT_FOUND",b})}` — an empty context stub that always throws.
  implication: webpack's `import("gbrain/" + subpath)` computed string creates an empty context module. The MODULE_NOT_FOUND error at runtime is from this stub, not from the OS module resolver.

- timestamp: 2026-05-20T07:00:00Z
  checked: `bun run start` under the `bun node_modules/.bin/next start` form (vs `next start`).
  found: `next start` (via shebang) runs under Node.js 24.7.0. `bun node_modules/.bin/next start` runs under Bun 1.3.14. Node 24 throws `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` when loading gbrain's raw .ts; Bun loads it natively.
  implication: The production server MUST be invoked as `bun node_modules/.bin/next start` to get Bun's TypeScript-aware runtime for gbrain module loading. The package.json "start" script must be updated.

- timestamp: 2026-05-20T07:00:00Z
  checked: `/* webpackIgnore: true */` on `import(pkg)` where `pkg = "gbrain/" + subpath`.
  found: webpack emits the `import()` verbatim — no context module created, no empty stub, no Critical dependency warning. At runtime under Bun, `import("gbrain/engine-factory")` resolves correctly to gbrain's raw .ts source.
  implication: `/* webpackIgnore: true */` is the correct fix for the `_load()` function. Eliminates module 4285.

- timestamp: 2026-05-20T07:00:00Z
  checked: `import.meta.resolve("gbrain/engine")` in `_loadThink()` under the webpack bundle.
  found: webpack transforms `import.meta.resolve` to `({}).resolve` — undefined at runtime. Calling `({}).resolve("gbrain/engine")` throws `TypeError: {}.resolve is not a function`.
  implication: `import.meta.resolve` cannot be used in webpack bundles. Must use alternative to find think/index.ts path.

- timestamp: 2026-05-20T07:00:00Z
  checked: `process.cwd() + "node_modules/gbrain/src/core/think/index.ts"` as the think path.
  found: `bun run start` runs from project root; `process.cwd()` = project root. Path is valid. `import(/* webpackIgnore: true */ thinkUrl)` loads correctly under Bun.
  implication: process.cwd()-based path is the correct fix for `_loadThink()`. Avoids all require.resolve / import.meta.resolve interception by webpack.

- timestamp: 2026-05-20T07:30:00Z
  checked: Full smoke test — `bun run build` + `bun run start` (as `bun node_modules/.bin/next start`) + `POST /api/tenants/seed/chat` with `{"question":"what was weird about March?"}`.
  found: exitCode: 0, durationMs: 18160. Real gbrain answer returned: "March 2026 contained four documented anomalies..." with citations. All other routes (/, /api/tenants, /onboard) return correct status codes.
  implication: Fix is complete and verified. Production build now serves real gbrain answers.

## Resolution

root_cause: Three compounding issues:
  (1) webpack converts `import("gbrain/" + subpath)` to an empty context module (module ID 4285) that always throws MODULE_NOT_FOUND. serverExternalPackages cannot intercept this because context modules bypass the externals hook. 
  (2) import.meta.resolve("gbrain/engine") is transformed by webpack to ({}).resolve which is undefined at runtime.
  (3) `bun run start` invokes `next start` via its #!/usr/bin/env node shebang, running under Node.js 24 which cannot load gbrain's raw .ts files (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). Must use `bun node_modules/.bin/next start` to get Bun's TypeScript-aware runtime.

fix: Three-part fix applied:
  (1) types/gbrain.ts: add `/* webpackIgnore: true */` to `import(pkg)` in `_load()` — webpack emits the import verbatim, Bun handles it at runtime.
  (2) types/gbrain.ts: replace `import.meta.resolve("gbrain/engine")` in `_loadThink()` with `join(process.cwd(), "node_modules", "gbrain", "src", "core", "think", "index.ts")` — webpack-safe path construction.
  (3) package.json "start" script: change from `next start` to `bun node_modules/.bin/next start` — forces Bun as the runtime for the production server.
  (4) next.config.ts: retain `serverExternalPackages: ["gbrain"]` for defense-in-depth + add webpack externals function to intercept "gbrain/*" requests before module parsing.

verification: bun run build (succeeds, no errors, only pre-existing ESLint warnings) + PORT=3090 bun run start + curl POST /api/tenants/seed/chat → exitCode 0, real gbrain answer with citations. All other routes return correct HTTP status codes.

files_changed:
  - types/gbrain.ts (webpackIgnore on _load import, process.cwd() path for _loadThink)
  - next.config.ts (added webpack externals function for gbrain/* interception)
  - package.json (start script: next start → bun node_modules/.bin/next start)
