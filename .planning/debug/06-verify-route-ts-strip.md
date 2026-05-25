---
slug: 06-verify-route-ts-strip
status: investigating
trigger: "Phase 6 UAT test 6 — clicking the magic-link email locally hits GET /auth/verify?token=… and returns 500 with `Error: Stripping types is currently unsupported for files under node_modules, for file:///…/node_modules/gbrain/src/core/ai/gateway.ts` (Node 24 stripTypeScriptModuleTypes / ModuleLoader). Recent fixes (297c326, a0aad1e, eff1537, b86de7d) addressed this on deployed Vercel but local `bun dev` still 500s on test 6 only; tests 1–5 and 7 pass."
created: 2026-05-24
updated: 2026-05-24
---

# Debug Session: 06-verify-route-ts-strip

## Summary

**Failure manifests:** local `bun dev` only. The deployed Vercel function (after commits 297c326 / a0aad1e / eff1537 / b86de7d) is fine because Vercel's `functions.runtime: "bun@1.2.0"` makes the deployed function process run under Bun, which natively loads gbrain's raw `.ts` files. Locally, the user types `bun dev`, which runs `bun run dev`, which executes `next dev`. Bun's `bun run` respects the `next` CLI shebang (`#!/usr/bin/env node`) and **launches Next.js under Node, not Bun** (bun.com/docs/runtime). The dev server then honors `export const runtime = "nodejs"` in `app/api/auth/verify/route.ts` and runs the route under Node. The route imports `provisionBrain` → `createGBrainEngine` → `@/types/gbrain::configureGateway` → `import(/* webpackIgnore: true */ "gbrain/ai/gateway")`. Because `next.config.ts` declares `serverExternalPackages: ["gbrain"]`, Next.js does NOT bundle gbrain — the dynamic import falls through to Node's native ESM loader, which resolves `gbrain/ai/gateway` to `node_modules/gbrain/src/core/ai/gateway.ts` (gbrain ships only raw `.ts`, no `dist/`). Node 24's `--experimental-strip-types` (on by default in v24) **refuses to strip TypeScript types from files inside `node_modules`** — this is a hard Node policy with no config knob (nodejs/node #57215). The route 500s before it even reaches the token-verify code.

Send-link (test 3) and every other Phase 6 route passes because none of them transitively reach a gbrain import.

## Reproduction

### Steps

1. From a fresh clone on Node 24 + Bun, run `bun install && bun dev`.
2. Visit `http://localhost:3000/sign-in`, submit an email. Test 3 passes (200 from POST /api/auth/send-link); a real email arrives via Resend.
3. Click the magic-link in the email. Browser navigates to `http://localhost:3000/api/auth/verify?token=…`.
4. Response: HTTP 500. Server stderr:

   ```
   Error: Stripping types is currently unsupported for files under node_modules,
   for "file:///…/node_modules/gbrain/src/core/ai/gateway.ts"
     at stripTypeScriptModuleTypes (node:internal/modules/typescript:183:11)
     at ModuleLoader  (node:internal/modules/esm/translators:616:16)
   ```

### Failing import chain

```
GET /api/auth/verify?token=…
  → app/api/auth/verify/route.ts          (line 45: imports `provisionBrain` from @/lib/auth/provision)
    → lib/auth/provision.ts               (line 22: imports `createGBrainEngine` from @/lib/gbrain/engine)
      → lib/gbrain/engine.ts              (line 47–54: imports `configureGateway` from @/types/gbrain)
        → types/gbrain.ts                 (line 142–146: configureGateway() calls _load("ai/gateway"))
          → types/gbrain.ts:112–116       (_load returns `import(/* webpackIgnore: true */ "gbrain/" + subpath)`)
            → Node 24 ESM loader resolves "gbrain/ai/gateway"
              → node_modules/gbrain/package.json `exports["./ai/gateway"]` → "./src/core/ai/gateway.ts"
                → Node 24 stripTypeScriptModuleTypes called
                  → REJECTS (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING — by design)
                  → 500
```

`configureGateway` is the FIRST gbrain symbol invoked on the verify path (see `engine.ts:123` — `await configureGateway(...)` before `createEngine`). So `ai/gateway.ts` is the first `node_modules/gbrain/src/**.ts` Node touches. Any other gbrain subpath (`engine-factory`, `search/hybrid`, …) would fail identically — `ai/gateway` is just first in the call order.

### Why send-link (test 3) passes

`app/api/auth/send-link/route.ts` imports only `lib/auth/schemas` (zod), `lib/auth/tokens` (jose), `lib/auth/store` (postgres), and `lib/auth/email` (resend). Grep over `app/api/auth/` confirms only `app/api/auth/verify/route.ts` and `lib/auth/provision.ts` reach anything that pulls gbrain. So send-link never triggers Node's TS-stripper on `node_modules/gbrain/**`, never 500s, and tests 1–5 + 7 are unaffected.

## Root Cause Verdicts

### A. Local `bun dev` doesn't honor `vercel.ts` runtime pins → **CONFIRMED**

- `vercel.json` (lines 3–7): `"functions": { "app/api/**/*.ts": { "runtime": "bun@1.2.0" } }`. This is a Vercel platform-level config — it only takes effect during Vercel deploys (the platform spawns the function under Bun). The Next.js dev server does not read `vercel.json` and has no concept of a per-route runtime override beyond `export const runtime = 'nodejs' | 'edge'`.
- `package.json:7` — `"dev": "next dev"`. No `bun --bun` prefix. Bun's `bun run` respects the `next` CLI shebang (`#!/usr/bin/env node` in `node_modules/.bin/next`) and executes Next.js under Node (Bun docs: "By default, Bun respects this shebang and executes the script with node"). Compare `package.json:9` `"start": "bun node_modules/.bin/next start"` — for production the script explicitly invokes Bun against the Next binary, bypassing the shebang. The dev script was never updated to match.
- Inside the dev process (Node), the verify route honors `export const runtime = "nodejs"` (`verify/route.ts:37`) and runs under the same Node host. No `vercel.json` config can change this.
- **Verdict:** This is the proximate cause. The local dev story has no Bun-runtime path for the verify route.

### B. The verify route imports gbrain unnecessarily → **RULED OUT**

- The verify route MUST call `provisionBrain` on first sign-in to create the user's gbrain `sources` row. This is the AUTH-04 / D-02 contract — there is no other place this can happen (the user has no session before verify; the row must exist before chat/insights queries; nothing else runs at the verify boundary).
- `provisionBrain` (`lib/auth/provision.ts:96–107`) does `engine.executeRaw("INSERT INTO sources …")`. Reaching `executeRaw` requires `createGBrainEngine`, which requires `configureGateway`, which loads `gbrain/ai/gateway.ts`. There is no lazy/conditional path that skips the gateway load.
- Could provisioning be deferred to first chat? No — every chat/insights route immediately scopes by `sourceId`, and `sourceId` must exist in `sources` before it can be passed to `hybridSearch` (gbrain rejects unknown source IDs). Deferring would just move the same 500 to the first chat request.
- Could provisioning be done via raw `postgres` (no gbrain import)? **Yes, in principle**, but: the `sources.config` JSONB shape, `id` length rules (≤32 chars, `[a-z0-9-]`), reserved-id blacklist, and ON CONFLICT semantics are gbrain contract — bypassing gbrain to write the row makes us responsible for keeping those invariants in sync with gbrain's schema across versions. The patches/3933eb6 file already gates us to a specific gbrain version; adding a second invariant surface is risky for Phase 6 stability.
- **Verdict:** Lazy-import gymnastics or a no-gbrain INSERT are possible workarounds, but they sidestep the real problem (B) rather than fix it. The fundamental issue is A. See "Recommended Fix — Tier 3" below for the lazy-import escape hatch as a fallback.

### C. The verify route file is in the wrong location → **RULED OUT (for both local and deploy)**

- Verify lives at `app/api/auth/verify/route.ts` (commit `a0aad1e`). Confirmed via `find app -type d -name verify` — only one directory exists, under `app/api/auth/`. The legacy `app/auth/verify/` is gone.
- `vercel.json:4` glob `app/api/**/*.ts` matches `app/api/auth/verify/route.ts` (this glob is file-path-shaped, not URL-path-shaped — file-path-shaped is correct for `vercel.json` functions).
- `next.config.ts:48–51` `outputFileTracingIncludes`: key `/api/auth/verify` (URL-path shape — correct per the prior `gbrain-not-found-on-verify.md` resolution). picomatch returns true for normalized app path `/api/auth/verify`.
- So on deploy, the verify route IS pinned to Bun runtime AND traces gbrain into the bundle. The current Vercel-side fix is correct and complete; this bug is purely local-dev.
- **Verdict:** Route is in the right place. Glob conventions are correct.

### D. Next.js + Bun runtime config gap → **CONFIRMED (and there's no in-Next.js fix)**

- Next.js 15 `export const runtime` accepts ONLY `'nodejs' | 'edge'` (Next.js docs `/api-reference/file-conventions/route`). There is no `'bun'` value. No `bunPlugins`, no `unstable_runtime`. Issues/PRs requesting per-route Bun runtime selection in Next.js exist but are not shipped.
- `serverExternalPackages: ["gbrain"]` (`next.config.ts:19`) instructs webpack NOT to bundle gbrain — falls through to the host runtime's native resolver. On Node 24 host, that resolver hits the TS-strip refusal. The setting is correct for the *Bun host* case (it's what makes gbrain loadable on the Vercel Bun function) but is what makes Node-host failure inevitable for the verify route.
- The webpack `gbrainExternalsFn` (`next.config.ts:65–77`) marks `gbrain/*` requests as `commonjs gbrain/*` externals. Same story: webpack stays out, host runtime resolves at request time.
- Conclusion: the gap is real and lives at the boundary between Next.js (which can't run a route under Bun) and Bun (which can run all of Next.js if you launch the process that way). The fix must be at the *process-launch* layer, not in route code.
- **Verdict:** No in-Next.js knob exists. The fix is to launch the dev server's host runtime as Bun.

## Recommended Fixes

Ranked by effort (low → high) and confidence (high → medium).

### Tier 1 — Run `next dev` under Bun (RECOMMENDED, parity with production)

**Effort:** 1 line change. **Confidence:** HIGH.

`package.json:7` — change:

```diff
-    "dev": "next dev",
+    "dev": "bun --bun next dev",
```

This makes Bun's `bun run` flag the `next` CLI as a Bun-runtime invocation instead of respecting its `#!/usr/bin/env node` shebang. The entire Next.js dev server then runs under Bun, which natively loads `.ts` files from anywhere — including `node_modules/gbrain/src/core/ai/gateway.ts`.

**Why this is the correct fix:**
- Mirrors `package.json:9` `"start": "bun node_modules/.bin/next start"` — production already uses Bun as the host. Dev should match.
- The shim's design assumption (`types/gbrain.ts:22–25`) explicitly says "the production server is started with `bun …` so that Bun is the runtime. Bun natively loads gbrain's raw .ts source files… Node.js would fail with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING." Dev was simply never wired up to match.
- All other dev-server behavior (HMR, fast refresh, route compilation) works fine under Bun — there are widely-deployed Next 15 + Bun setups (Next.js / Bun docs).
- Zero application-code changes. Zero gbrain changes. Zero risk to deployed-Vercel behavior (Vercel still runs `next build` + Bun function runtime as today).

**Verification after fix:**
1. `bun dev`.
2. Run the same UAT step 4 (submit email) → step 6 (click link). Expect 302 redirect to `/dash/<slug>` with `qb_session` cookie set.
3. `curl -i http://localhost:3000/api/auth/verify?token=junk` — expect 302 to `/auth/link-used` (NOT 500).
4. Also confirm `app/api/tenants/[id]/chat/route.ts` still loads — same gbrain code path.

**Caveats to flag (none are blockers):**
- Bun's Next.js compatibility is "very good" in 2026 but not bit-for-bit identical to Node — if any other Phase routes have Node-specific behavior that breaks under Bun, this surfaces them. Unlikely given production already runs on Bun.
- Some Next.js dev features (e.g., the new TurboPack devtools UI) work under Bun but may emit different warnings. Cosmetic only.

### Tier 2 — Provide a Bun-explicit dev script alongside the existing one

**Effort:** add 1 script. **Confidence:** HIGH but less elegant.

```diff
     "dev": "next dev",
+    "dev:bun": "bun --bun next dev",
```

Document in README: "use `bun dev:bun` if you need gbrain-touching routes (verify, chat, insights). Plain `bun dev` is fine for UI-only iteration." Discouraged: increases cognitive load, leaves a foot-gun in `dev`, doesn't match production. Only justified if the team has a specific Node-dev workflow (e.g., debugger tooling) that Bun breaks.

### Tier 3 — Lazy-import + isolate gbrain off the request-handling path

**Effort:** moderate. **Confidence:** MEDIUM. **Only use if Tier 1 is rejected.**

If the team insists on `next dev` under Node, the only escape is to keep gbrain entirely out of any module the Node loader touches at request time. Options, ordered by viability:

1. **Provision via raw `postgres` insert, no gbrain import.** Write the `sources` row directly:
   ```ts
   // lib/auth/provision.ts (rewritten — no gbrain import)
   import { sql } from "./store";
   export async function provisionBrain(sourceId: string, displayName: string) {
     await sql`
       INSERT INTO sources (id, name, config)
       VALUES (${sourceId}, ${displayName}, ${JSON.stringify({ federated: false })}::jsonb)
       ON CONFLICT (id) DO NOTHING
     `;
   }
   ```
   Verify-route never imports `@/lib/gbrain/engine`. Verify passes under Node. **Cost:** we now own the `sources` schema shape (id length, JSONB config keys, ON CONFLICT semantics) independent of gbrain — every gbrain version bump needs a manual schema-diff check. Document this in the patches/ README. **This is the smallest-risk Tier-3 option.**

2. **Spawn a Bun subprocess to do provisioning.** `Bun.spawn(["bun", "scripts/provision-brain.ts", sourceId, email])` from the verify route. Removes gbrain from Node's import graph. **Cost:** ~50–200ms cold-start per first sign-in; requires Bun on the dev box; ugly. Don't.

3. **Move provisioning to a server-side action that only runs in Bun.** Use a Next.js Server Action or a separate route that gets invoked client-side after redirect. **Cost:** breaks the "atomic verify+provision+session-set" guarantee (D-02 / AUTH-04 / T-06-15) — opens a window where the session exists but the brain doesn't. Worse than #1.

**Recommendation:** Tier 1. Tier 3.1 is the fallback if Tier 1 exposes some unrelated Bun-vs-Next dev breakage.

### Tier 4 — Compile gbrain to .js before importing (DON'T)

Patch gbrain's postinstall to run `tsc` over its `src/` and rewrite `package.json` exports to point at `dist/*.js`. Two reasons to avoid:
- gbrain master is bun-native by design; a tsc compile of its source is likely to surface dozens of strict-mode errors (`types/gbrain.ts:4–8`).
- Tier 1 fixes the problem in 1 line. This takes hours and creates a maintenance burden.

### Tier 5 — Wait for Next.js to support per-route Bun runtime (DON'T)

No timeline. Don't block on this.

## Local-vs-Deploy Fix Matrix

| Environment    | Status today                          | Fix needed                                       |
|----------------|---------------------------------------|--------------------------------------------------|
| Vercel deploy  | Working (per prior fixes)             | None — `outputFileTracingIncludes` + `vercel.json` runtime pin are correct. |
| Local `bun dev`| Broken — Node host, TS-strip refusal  | **Tier 1: change `"dev"` to `"bun --bun next dev"` in `package.json:7`**. |

The local-dev fix and the deploy fix are different code (and live in different files), but they share the same root principle: **the host process must be Bun whenever a request can reach a gbrain import**.

## Open Questions

1. **Does Bun-as-host introduce regressions in any other Phase route?** Production `next start` already runs under Bun on Vercel, and `package.json:9` confirms local `bun start` also runs under Bun. So in principle, Tier 1 just makes dev match prod. But: if there's any Phase 1–6 code path that's only exercised in dev (e.g., `next dev`'s HMR overlay, dev-only middleware, Next.js dev-error-stack rendering) and it relies on a Node-only API that Bun doesn't fully shim, that surfaces here. Recommend a 10-minute smoke-test pass over all UAT 1–12 tests after applying Tier 1.

2. **Does `bun --bun next dev` exhibit the documented Next 15 + Bun "module resolution race" on first request?** Some older Bun versions had a cold-start race with Next.js's RSC chunk loader. As of Bun 1.2.x (2026) this is resolved per Bun's changelog, but worth one cold-start request to confirm.

3. **Should the dev README document that `bun dev` now actually means Bun (vs the old shebang-respecting behavior)?** Minor doc update — out of scope for the bug fix itself, but worth a sentence in the eventual PR description.

4. **Is the cclsp MCP server available in this environment?** It is referenced in CLAUDE.md / global rules but is not connected in this debug session — investigation was Grep + Read-based. Doesn't change the diagnosis (the import chain is short and unambiguous), but flagging in case the planner expects LSP-grade evidence.

## Eliminated Hypotheses

- **H: Provision is bypassable.** Eliminated — AUTH-04 / D-02 require the `sources` row to exist before any per-user chat/insights query. Verify is the only boundary where this can happen atomically with session creation (T-06-15).
- **H: Route file path mismatch.** Eliminated — `app/api/auth/verify/route.ts` exists; `app/auth/verify/` is gone; `vercel.json` glob and `next.config.ts` glob both match.
- **H: Glob convention bug recurrence.** Eliminated — `next.config.ts:50` correctly uses `/api/auth/verify` (URL-path shape, fix from `gbrain-not-found-on-verify.md`). `.nft.json` includes are present on Vercel.
- **H: Different chunk graph between verify and send-link.** Eliminated — they share no transitive imports beyond `next/server`. Send-link doesn't reach gbrain at all (verified by grep over `app/api/auth/` and `lib/auth/`).
- **H: Patched gbrain source corrupted.** Eliminated — `node_modules/gbrain/src/core/ai/gateway.ts` exists and is not in `patches/gbrain+3933eb6.patch`'s diff (the patch only touches `think/`, `gather/`, `hybrid/`, `searchTakes/`).
- **H: Node 24 has a flag to allow node_modules TS stripping.** Eliminated — confirmed via Node issue #57215; Node's stance is "publish .js artifacts, not .ts". No flag exists; not planned.

## Files Involved (Read-Only Findings)

- `package.json:7` — `"dev": "next dev"` — **the fix locus for local dev**.
- `package.json:9` — `"start": "bun node_modules/.bin/next start"` — already correct for local prod / Vercel.
- `vercel.json:3–7` — `functions["app/api/**/*.ts"].runtime: "bun@1.2.0"` — correct for Vercel deploy; irrelevant locally.
- `next.config.ts:19` — `serverExternalPackages: ["gbrain"]` — correct for Bun host; the proximate cause that funnels gbrain resolution to the host runtime, which fails when host is Node 24.
- `next.config.ts:48–51` — `outputFileTracingIncludes` — correct globs (URL-path shape).
- `next.config.ts:65–77` — webpack `gbrainExternalsFn` — correct.
- `app/api/auth/verify/route.ts:37` — `export const runtime = "nodejs"` — correct (postgres + next/headers); the Bun-vs-Node decision is at the host process layer, not here.
- `app/api/auth/verify/route.ts:45` — `import { generateSourceId, provisionBrain } from "@/lib/auth/provision"` — first reach into the gbrain chain.
- `lib/auth/provision.ts:22` — `import { createGBrainEngine } from "@/lib/gbrain/engine"`.
- `lib/gbrain/engine.ts:47–54` — imports `configureGateway` from `@/types/gbrain`.
- `lib/gbrain/engine.ts:123` — `await configureGateway({ env: { ...process.env } })` — first dynamic gbrain load.
- `types/gbrain.ts:22–25` — explicit docstring: production must run under Bun; Node will fail with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
- `types/gbrain.ts:112–116` — `_load` does `import(/* webpackIgnore: true */ "gbrain/" + subpath)`.
- `types/gbrain.ts:142–146` — `configureGateway` calls `_load("ai/gateway")` → resolves to `node_modules/gbrain/src/core/ai/gateway.ts`.
- `app/api/auth/send-link/route.ts` — imports only schemas/tokens/store/email; no gbrain reach (explains test 3 pass).
