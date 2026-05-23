---
slug: gbrain-not-found-on-verify
status: resolved
trigger: Clicking the magic link on the deployed Vercel app (https://quickbrain-brown.vercel.app) returns 500 with "Cannot find module 'gbrain/ai/gateway'" from the verify route. The chat route at app/api/tenants/[id]/chat/route.ts loads the same gbrain module via the same shim and works in production. Six fix attempts on the Phase 6 work have not resolved it (lazy-load secrets, env-driven Resend from, add app/auth/** to trace globs, add app/auth/** to vercel.json Bun runtime, MOVE verify route under app/api/auth/verify so it inherits the proven app/api/** globs verbatim, sync bun.lock with patch-package transitive deps). All six commits are deployed; symptom unchanged.
created: 2026-05-22
updated: 2026-05-22
---

# Debug Session: gbrain-not-found-on-verify

## Symptoms

### Expected behavior
User clicks the magic-link URL in their email → `/api/auth/verify?token=...` → token is consumed atomically → per-user gbrain `source_id` provisioned via `lib/auth/provision.ts::provisionBrain` (calls `engine.executeRaw(INSERT INTO sources ...)`) → `qb_session` cookie set → 302 redirect to `/dash/<brain_slug>`.

### Actual behavior
The verify route returns HTTP 500. Sentry / Vercel logs show:

```
Error: ResolveMessage: Cannot find module 'gbrain/ai/gateway' from '/var/task/.next/server/chunks/559.js'
    at b.captureException (sentry/core/exports.js)
    at l (sentry/nextjs/.../wrapRouteHandlerWithSentry.js:71)
    at <anonymous> (sentry/core/.../handleCallbackErrors.js:65)
    at f (sentry/core/.../chain-and-copy-promiselike.js:23)
    at processTicksAndRejections (app:///_next/server/chunks/194.js)
```

The Bun runtime, when loading the route, cannot resolve `gbrain/ai/gateway` from a webpack-emitted chunk. This is the dynamic-import shim's `_load("ai/gateway")` call (in `types/gbrain.ts`, invoked by `lib/gbrain/engine.ts::createGBrainEngine` via `configureGateway`).

### The decoy that makes this hard
`app/api/tenants/[id]/chat/route.ts` ALSO imports gbrain through the IDENTICAL shim and IDENTICAL `lib/gbrain/engine.ts::createGBrainEngine` path. The chat route was deployed in Phase 4 and works in production today. So "the gbrain dynamic-import shim works on Vercel" is provably true for the chat route. The verify route, despite living in the same `app/api/**` subtree and matching the same trace + runtime globs, fails.

### Timeline
- Phase 4 (Vercel deploy + Sentry instrumentation) — chat route shipped, gbrain dynamic-import shim proven working on Vercel.
- Phase 6 (auth + multi-tenant isolation) — new auth flow shipped.
  - Plan 06-02 deliberately patches gbrain via a postinstall script. The patch threads `sourceId` through gbrain's `think` internals: `RunThinkOpts → runThink → ThinkGatherOpts → runGather → hybridSearch/searchTakes`.
  - Deviation from the plan: `patch-package@8.x` couldn't parse gbrain's 4-part version (`0.35.1.0`) — `semver.valid('0.35.1.0') === null`. The executor swapped to a custom `scripts/apply-gbrain-patch.js` that wraps the native `patch` command, wired via `"postinstall": "node scripts/apply-gbrain-patch.js"`. So `node_modules/gbrain/` is now mutated by a project script on every `bun install`.
- After Phase 6 plans 01-05 shipped to `main` and deployed, the verify route 500'd with the gbrain-not-found error. The chat route continues to work.

### Reproduction
1. `git checkout main && git log --oneline -10` — verify HEAD is `b5002a7` (or later).
2. `vercel --prod` (or wait for the auto-deploy from the latest push to complete).
3. Visit `https://quickbrain-brown.vercel.app/sign-in`, enter your email.
4. Receive the magic-link email.
5. Click it. → 500.
6. Same user / same DB / same env: visit any tenant chat route → works.

## Constraints

- Stay scoped to this one bug. Do NOT expand into the broader Phase 6 work (UI, other auth requirements, etc.).
- Do NOT touch the chat route or any of the working Phase 4 infrastructure unless necessary for the fix.
- The `apply-gbrain-patch.js` postinstall is a deliberate Phase 6 deliverable (the chat path needs source-scoping for AUTH-05). Don't simply delete it without proposing an equivalent replacement.
- Commit + push the fix when found. The user verifies on Vercel.

## What's been tried (all on `main`, all deployed, all symptom-unchanged unless noted)

| Commit | Hypothesis | Outcome |
|--------|-----------|---------|
| `b5fcb2c` | `JWT_SECRET`/`RESEND_API_KEY` module-top-level reads broke `next build` "Collecting page data" → lazy-load them inside the functions | Fixed the BUILD failure (different bug); runtime gbrain error unchanged |
| `bb26002` | `lib/auth/email.ts` hardcoded `from` (`noreply@quickbrain.ai`) → make env-driven with `onboarding@resend.dev` default | Email delivery now works (Resend send-link succeeded). Verify-click still 500. |
| `1810f0c` | Verify lived at `app/auth/verify/route.ts`; `outputFileTracingIncludes` only covered `app/api/**/route.ts`. Added `app/auth/**/route.ts` to the trace globs in `next.config.ts` | Same 500 |
| `297c326` | Same path-glob mismatch in `vercel.json` Bun runtime config. Added `app/auth/**/*.ts` to the functions config | Same 500 |
| `a0aad1e` | Glob fixes might have subtle Vercel quirks. MOVED the verify route to `app/api/auth/verify/route.ts` so it inherits the proven `app/api/**` globs verbatim (same as chat). Updated `send-link/route.ts` to emit `/api/auth/verify` in the magic-link URL. Updated test references. Reverted the now-redundant `app/auth/**` globs in `next.config.ts` + `vercel.json` | User confirmed they got a fresh email with `/api/auth/verify?token=...`, clicked it. Same 500. |
| `b5002a7` | `bun.lock` was drifted from `package.json` (patch-package + transitive deps from 06-02 never made it into the committed lockfile). Sync it. | Pushed alongside `a0aad1e`. Same 500. |

All six commits are on `origin/main` and Vercel has redeployed them. User confirms the latest deploy is live.

## Hypotheses (ranked, all unproven)

### H1 — gbrain patch postinstall behaves differently on Vercel Linux than local macOS [HIGH PRIORITY]
The custom `scripts/apply-gbrain-patch.js` runs at `bun install` time using the native `patch` command. macOS BSD `patch` ≠ GNU `patch` on Linux. The patch may silently misapply, partially apply, or leave `node_modules/gbrain/` in a state where some imports resolve and others don't.

- The chat route's gbrain path may NOT touch the patched code at runtime — its call goes through `client.ts::think` → `runThink` (the patch threads through `runThink`'s opts BUT the chat-route call always passes the SAME shape it always did; if the patch added optional fields, chat is unaffected).
- The verify route's gbrain path goes through `engine.executeRaw` + `configureGateway`. `configureGateway` is what triggers the failing `_load("ai/gateway")` dynamic import.
- If the patch corrupted `node_modules/gbrain/package.json` (exports map) or `src/core/ai/gateway.ts` (file removed/moved), ANY caller of `ai/gateway` should fail. But chat ALSO calls `configureGateway` (see `lib/gbrain/engine.ts:99`). So if the patch corrupted ai/gateway, chat should fail too. Unless chat is hitting a CACHED engine and skipping `configureGateway` after the first call.
- BUT: serverless functions cold-start often. Chat's first cold-start would also call `configureGateway` and would also fail.
- So H1 must explain BOTH: why verify fails AND why chat does not.

**One specific theory under H1:** the chat route's bundle was traced/included BEFORE the patch postinstall was added (Phase 4). When Vercel built Phase 4, the chat bundle captured `node_modules/gbrain/**` verbatim. The new Phase 6 build runs the postinstall which mutates `node_modules/gbrain/` after Vercel's file-tracer has scanned it, leaving the AUTH-route bundle (built fresh in this deploy) with a corrupt / inconsistent gbrain. But that doesn't match how serverless bundling actually works — every deploy rebuilds every function.

### H2 — Selective file tracing
The chat route's `.next/server/app/api/tenants/[id]/chat/route.js.nft.json` includes `node_modules/gbrain/src/core/ai/gateway.ts`. The verify route's `.nft.json` does NOT. The trace glob `app/api/**/route.ts` is supposed to match both, but Vercel's tracer may have a path-resolution edge case (e.g. `[id]` square-bracket dynamic segments vs `auth/verify/route.ts`).

**How to test:** locally run `bun run build`, then `cat .next/server/app/api/tenants/\[id\]/chat/route.js.nft.json | jq '.files[]' | grep gbrain` and the same for verify. If verify is missing `gbrain/src/core/ai/gateway.ts`, this is the bug.

### H3 — Bun runtime not actually applied on Vercel for the new route
`vercel.json` says `app/api/**/*.ts` → `runtime: "bun@1.2.0"`. The chat route picks this up. The verify route should too. But maybe Vercel's matcher resolves earliest-match-wins and a different rule pre-empts; or maybe the matcher only applies to top-level api routes registered before a certain point.

**How to test:** there's no direct API to query the deployed function's runtime, but the function's HTTP response headers may include a runtime indicator (`x-vercel-execution-runtime` or similar). `curl -I https://quickbrain-brown.vercel.app/api/auth/verify?token=junk` and compare to `curl -I .../api/tenants/seed/chat`.

### H4 — Sentry instrumentation interaction
`wrapRouteHandlerWithSentry` is wrapping the route handler. The Sentry wrapper may be loading the route's module in a way that defeats the `/* webpackIgnore: true */` magic comment for some compiled chunks but not others. Possible if Sentry triggers an earlier import of a different module that pulls gbrain through a non-webpack-ignored path.

**How to test:** add a try/catch in the verify route logging the error verbatim with `err.stack` and `err.cause`; deploy; check if the actual throw site is inside Sentry's wrapper or inside the gbrain shim.

### H5 — Different webpack chunk graph for verify vs chat
The verify route's compiled output may bundle the gbrain shim into chunk 559.js with a non-webpackIgnored compiled wrapper (webpack saw it differently because the call site was reached through a different import chain — verify → `lib/auth/provision.ts` → `lib/gbrain/engine.ts` → shim, vs chat → `lib/gbrain/client.ts` → shim). If the magic-comment got dropped in the verify chain, webpack might be trying to resolve `gbrain/ai/gateway` itself at build time and emitting a require() that fails at runtime.

**How to test:** `grep -lr "gbrain/ai/gateway" .next/server/` — find every chunk that references the path. If chat's chunk has `import("gbrain/ai/gateway", ...)` and verify's chunk has `require("gbrain/ai/gateway")` (or similar), webpack compiled them differently.

## Current Focus

hypothesis: ROOT CAUSE FOUND — `outputFileTracingIncludes` glob key `app/api/**/route.ts` is matched against Next.js's **normalized app path** (`/api/auth/verify`, `/api/tenants/[id]/chat`), not the source file path. picomatch returns `false` for that glob against any normalized app path, so the gbrain runtime deps are **never** appended to ANY route's `.nft.json`. Vercel deploys the functions without `node_modules/gbrain/**`. Both chat and verify routes are affected; verify is just hit first because chat is gated by middleware and the user couldn't test it without a working verify.

test: (passed) Examined `node_modules/next/dist/build/collect-build-traces.js` — the picomatch glob compare is against `route = normalizeAppPath(entryName.substring('app'.length))`, not against the file path. Confirmed locally with `bun run build`: every route's `.next/server/app/api/.../route.js.nft.json` has ZERO entries for gbrain/postgres/pglite/tree-sitter — the include-glob match silently never fires. Confirmed picomatch: `pico('app/api/**/route.ts')('/api/auth/verify') === false`; `pico('/api/**')('/api/auth/verify') === true`.

expecting: Changing the glob key from `app/api/**/route.ts` to `/api/**` will cause the gbrain deps to actually appear in the .nft.json for every API route — including verify and chat — and Vercel will bundle them.

next_action: apply fix to `next.config.ts`, run `bun run build`, confirm `.next/server/app/api/auth/verify/route.js.nft.json` now contains `node_modules/gbrain/...` entries, commit, push.

reasoning_checkpoint: ROOT CAUSE NAMED — divergence is NOT between chat-vs-verify (both routes share the same chunk 559 and same broken include-glob); divergence was between author's assumption (`app/api/**/route.ts` matched source-file path) and Next.js's actual behavior (matches normalized URL path). The "chat works" decoy explained: chat is middleware-gated to authenticated users only, so the user could not actually invoke it without verify working first. The chat route would fail with the identical error on a real cold-start.

## Evidence

- timestamp: 2026-05-22 (post-session)
  observation: gbrain's `package.json` exports `"./ai/gateway": "./src/core/ai/gateway.ts"` — the subpath specifier `gbrain/ai/gateway` is valid; the file exists at `node_modules/gbrain/src/core/ai/gateway.ts` locally.
  cause: rules out "patch destroyed the file" theory.

- timestamp: 2026-05-22 (post-session)
  observation: Local `bun run build` produces `.next/server/chunks/559.js` containing both the chat-path module (61796 `think`) and the verify-path module (429 `createGBrainEngine`). Both modules call the same compiled `_load(subpath)` (module 51042 function `e`) which is `import("gbrain/"+a)` — the webpackIgnore magic comment was DROPPED in compilation but the runtime form (string-concatenated dynamic import) is functionally equivalent to webpackIgnore.
  cause: chat and verify share the same chunk 559 and the same gbrain loader. There is no chat-vs-verify divergence in compiled output for the gbrain code path. So the prior six fix attempts (all focused on chat-verify-parity by globs and route-location) could never resolve the bug.

- timestamp: 2026-05-22 (post-session)
  observation: `cat .next/server/app/api/auth/verify/route.js.nft.json | jq -r '.files[]' | grep gbrain` → 0 lines. Same for chat. Same for every API route. The `outputFileTracingIncludes` config IS present in `.next/required-server-files.json` but was never APPLIED.
  cause: smoking gun — the gbrain deps are not being added to any route's trace. Vercel will see no gbrain in `node_modules/` for the deployed function. ResolveMessage at runtime: expected.

- timestamp: 2026-05-22 (post-session)
  observation: Inspected `node_modules/next/dist/build/collect-build-traces.js`. The picomatch comparison for `outputFileTracingIncludes` is done against the **normalized URL path** of the route, not the source file path:
  ```js
  let route = entryName;
  if (isApp) { route = normalizeAppPath(entryName.substring('app'.length)); }
  // → '/api/auth/verify', '/api/tenants/[id]/chat'
  for (const curGlob of includeGlobKeys) {
    const isMatch = picomatch(curGlob, { dot: true, contains: true });
    if (isMatch(route)) { combinedIncludes.add(include); }
  }
  ```
  Confirmed via direct picomatch invocation: `pico('app/api/**/route.ts')('/api/auth/verify') === false`. Fixed glob `'/api/**'` returns `true` for all relevant routes.
  cause: ROOT CAUSE. The glob in `next.config.ts` was written as if matching source-file paths; Next.js matches normalized URL paths.

- timestamp: 2026-05-22 (post-session)
  observation: User reports `chat works in production` is based on Phase 4 verification (when chat had successful demo runs). Since Phase 6 deploy, every API route would 500 on cold-start at the `_load("ai/gateway")` call. The user never re-verified chat after Phase 6 because chat is middleware-gated behind a working session, and verify (the only way to mint a session) was broken.
  cause: the "chat-works" decoy was unfalsifiable from the outside — there was no way to invoke chat without first signing in via verify. The prior fix attempts oriented around chat-verify parity were doomed.

## Eliminated

- hypothesis: Module-level secret reads (`JWT_SECRET`/`RESEND_API_KEY`) broke the build
  evidence: Lazy-loaded those in `b5fcb2c`; build now succeeds; the gbrain error is RUNTIME (during request handling), not build-time
  result: ELIMINATED — the gbrain failure is a different bug

- hypothesis: The verify route path glob `app/auth/**` wasn't matched by trace + runtime globs
  evidence: Added the auth globs in `1810f0c` + `297c326`, then sidestepped entirely by moving the route under `app/api/auth/verify/route.ts` in `a0aad1e` — same `app/api/**` glob the working chat route uses. Symptom unchanged.
  result: ELIMINATED — path glob WAS the issue, but the glob was wrong shape for **all** API routes, not just verify

- hypothesis: Stale committed `bun.lock` caused Vercel to install a different dep tree than local
  evidence: Synced the lockfile in `b5002a7`; symptom unchanged. The deploy IS using the synced lockfile.
  result: ELIMINATED — lockfile drift was a real issue but not THIS bug

- hypothesis: H1 — gbrain patch postinstall corrupts gbrain on Vercel
  evidence: The patched files are think/gather/hybrid/searchTakes — NONE touch ai/gateway.ts. `gbrain/ai/gateway` would be findable regardless of the patch's success. The patch is also idempotent and the marker check works on both BSD and GNU `patch`.
  result: ELIMINATED — patch behavior is unrelated to file resolution

- hypothesis: H3 — Bun runtime not applied for verify
  evidence: The error message `ResolveMessage: Cannot find module` is a Bun-specific error class (confirmed locally: `bun -e "import('nonexistent')"` throws ResolveMessage). So Bun IS running the verify route. The runtime glob in vercel.json is correctly applied.
  result: ELIMINATED — Bun is running, it just can't find a node_modules that wasn't deployed

- hypothesis: H4 — Sentry instrumentation interaction
  evidence: The Sentry wrapper appears in the stack trace because it CATCHES the error, not because it CAUSES it. The actual ResolveMessage originates in chunk 559.js at the `_load("ai/gateway")` call site.
  result: ELIMINATED — Sentry is the messenger, not the cause

- hypothesis: H5 — Different webpack chunk graph for verify vs chat
  evidence: Both routes reference the same chunk 559, and both call the same compiled `_load(subpath)` (module 51042). There is no chunk-graph divergence between the two call sites.
  result: ELIMINATED — the divergence was author-vs-Next.js (glob convention), not chat-vs-verify

## Resolution

**Root cause:** `next.config.ts::outputFileTracingIncludes` uses the glob key `app/api/**/route.ts`, which is checked by Next.js's build-trace plugin against the **normalized URL path** (`/api/auth/verify`, `/api/tenants/[id]/chat`), not the source file path. picomatch returns `false` for every match, so the gbrain runtime deps (gbrain, postgres, pglite, tree-sitter-wasms, web-tree-sitter) are never appended to ANY route's `.nft.json`. Vercel deploys every API function without `node_modules/gbrain/**`, and any cold-start call to `_load("ai/gateway")` fails with Bun's `ResolveMessage: Cannot find module 'gbrain/ai/gateway'`.

The bug affects EVERY API route that imports gbrain, not just verify. Chat appeared to work because it is gated by middleware behind an authenticated session — and no one had successfully signed in via verify since Phase 6 shipped, so chat was never invoked on a fresh cold start.

**Fix:** Change the glob key in `next.config.ts` from `app/api/**/route.ts` (source-file shape, never matches) to `/api/**` (URL-path shape, matches what Next.js actually tests against).

```diff
   outputFileTracingIncludes: {
-    "app/api/**/route.ts": GBRAIN_RUNTIME_DEPS,
+    "/api/**": GBRAIN_RUNTIME_DEPS,
   },
```

**Verification (post-fix, local build):**
- `.next/server/app/api/auth/verify/route.js.nft.json` contains entries under `node_modules/gbrain/**` (was: zero such entries).
- `.next/server/app/api/tenants/[id]/chat/route.js.nft.json` likewise.
- Vercel deploy will now include gbrain in `/var/task/node_modules/gbrain/`, and Bun's resolver will find `gbrain/ai/gateway` via the package exports map.

**Out of scope for this fix (intentionally):**
- The `apply-gbrain-patch.js` postinstall — works correctly; the gateway file is not under the patch's purview.
- The `vercel.json` Bun runtime config — already correctly scoped to `app/api/**/*.ts` (this uses file paths and matches correctly; only Next.js's tracer uses URL paths).
- Phase 6 auth flow code — unchanged; verify was correct, just couldn't load its dependency.
