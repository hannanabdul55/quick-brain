# Phase 4: Vercel Deploy + Observability - Research

**Researched:** 2026-05-20
**Domain:** Serverless deployment (Vercel) + observability (Sentry) for a Next.js 15 App Router app that runs gbrain in-process against Supabase Postgres
**Confidence:** HIGH (Vercel platform facts, Sentry setup, codebase state) / MEDIUM (gbrain-on-serverless cold-path behavior, which needs one build spike)

## Summary

Phase 4 takes the QuickBrain app — already refactored in Phase 3 to call gbrain
**in-process** (no `child_process.spawn` in the query/think path) against Supabase
Postgres — and deploys it to Vercel at a real URL with secrets in encrypted env
config, a `/api/health` probe endpoint, and Sentry error tracking. The hard work
of making the app serverless-compatible was done in Phases 2 and 3; Phase 4 is
mostly platform wiring plus one genuine architectural risk to verify.

The risk: gbrain ships **raw TypeScript** and is imported via a runtime computed
dynamic-import shim (`types/gbrain.ts`). Next.js's webpack/Turbopack does static
analysis on imports; gbrain's `.ts` source, its WASM dependencies
(`@electric-sql/pglite`, `tree-sitter-wasms`, `web-tree-sitter`), and the AI SDK
must either bundle cleanly into the serverless function or be externalized via
`serverExternalPackages`. STATE.md flags this explicitly: `next.config.ts` has no
`serverExternalPackages` entry yet, and the in-process chat Route Handler has
never been verified in a real `next build`. This is the one item that can break
the deploy, and it must be de-risked with a `next build` spike before — or as the
first task of — the phase.

**Primary recommendation:** Add `serverExternalPackages: ['gbrain']` to
`next.config.ts`, run a local `next build` to confirm the gbrain chat route
compiles and the WASM/AI-SDK deps resolve, then deploy via Vercel Git integration.
Use the Vercel CLI (`vercel env add`) to load all secrets per-environment, build
a three-probe `/api/health` Route Handler (app / gbrain Postgres / Supabase
Storage), wire `@sentry/nextjs` via the modern `instrumentation.ts` +
`instrumentation-client.ts` + `global-error.tsx` file set, and document the
Hobby→Pro upgrade trigger. **Verified platform fact correction:** the Vercel
function timeout is **300s default on all plans** (Fluid Compute is default-on),
not the old 10s/60s Hobby cap — this materially changes the Phase 5 background-job
threshold and removes the urgency the roadmap implied.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Git-push → build → live URL (DEPLOY-01) | CDN / Build Platform (Vercel) | — | Vercel's Git integration owns build + deploy; the repo only declares build settings |
| Secret storage + injection (DEPLOY-02) | CDN / Build Platform (Vercel env config) | API / Backend (reads at runtime) | Vercel encrypts at rest, injects into the function runtime; app code only reads `process.env` |
| `/api/health` probe (DEPLOY-03) | API / Backend (Next.js Route Handler) | Database (Supabase Postgres), CDN/Storage (Supabase Storage) | A Route Handler is the only tier that can reach both the DB pooler and the Storage REST API |
| gbrain DB reachability check | API / Backend | Database (Supabase Postgres via Supavisor pooler) | gbrain's engine connects from the function; the probe runs the same path |
| Supabase Storage reachability check | API / Backend | CDN / Storage (Supabase Storage REST) | `lib/storage/` already abstracts this; the probe calls a cheap HEAD/list |
| Sentry server error capture (DEPLOY-04) | API / Backend (Node.js function) | Observability SaaS (Sentry) | `onRequestError` + `sentry.server.config` run inside the serverless function |
| Sentry client error capture (DEPLOY-04) | Browser / Client | Observability SaaS (Sentry) | `instrumentation-client.ts` + `global-error.tsx` run in the browser |
| Source map upload (DEPLOY-04) | CDN / Build Platform (build step) | Observability SaaS (Sentry) | `withSentryConfig` uploads maps during the Vercel build |
| Hobby-tier budget tracking (DEPLOY-05) | CDN / Build Platform (Vercel usage) | — | A documentation + monitoring concern, no app code |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | `^15.3.2` (already installed) | App framework + Route Handlers | Already the project framework; Vercel is its first-party host |
| Vercel platform | n/a (project `quickbrain` already linked) | Build + host + secrets + edge network | Locked v2.0 deploy stack (MEMORY.md) |
| `@sentry/nextjs` | `^10.x` [ASSUMED — verify with `npm view @sentry/nextjs version`] | Error tracking, server + client | The official, Next.js-aware Sentry SDK; `onRequestError` support requires `>= 8.28.0` and Next.js 15 [CITED: docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `vercel` CLI | latest (operator already authenticated, `vercel link` done) | `vercel env add`, `vercel env pull`, `vercel deploy` | Used to load secrets and run a pre-flight deploy; not a runtime dependency |
| (none new for `/api/health`) | — | The health route uses only `fetch` + the existing `gbrain` engine + `lib/storage/` | No new dependency needed — probe with what is already wired |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@sentry/nextjs` manual setup | Vercel Marketplace Sentry integration | The Marketplace integration auto-creates a Sentry project and injects `SENTRY_*` env vars, but still requires the same instrumentation files in-repo. Manual setup is more explicit and avoids a billing-linked marketplace connection. Either works; manual setup recommended for a single-developer project with an existing Sentry account. [ASSUMED] |
| `@sentry/nextjs` | `console.error` + Vercel log drains | Vercel's built-in logs show server errors but have short retention, no client-error capture, no grouping/alerting. DEPLOY-04 explicitly requires Sentry. |
| Git-integration deploy | `vercel deploy` from CLI / GitHub Action | Git integration (push `main` → auto-build) is the DEPLOY-01 acceptance criterion. CLI deploy is fine for the pre-flight spike but is not the production path. |
| `serverExternalPackages: ['gbrain']` | `outputFileTracingIncludes` to force-include gbrain files | `serverExternalPackages` is the documented, simpler mechanism for "load from node_modules at runtime, do not bundle" [CITED: nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages]. `outputFileTracingIncludes` is a fallback if tracing still misses WASM assets. |

**Installation:**
```bash
# Sentry SDK (run the wizard OR add manually)
bun add @sentry/nextjs
# OR: bunx @sentry/wizard@latest -i nextjs   # scaffolds all instrumentation files

# Vercel CLI is already present (operator authenticated; `vercel link` done 2026-05-20)
```

**Version verification:** Before writing the plan, run:
```bash
npm view @sentry/nextjs version          # confirm current major (training data: ~v10.x in 2026)
npm view vercel version                  # confirm CLI current
```
The `@sentry/nextjs` version is `[ASSUMED]` from training data — the planner must
verify and pin it. The `onRequestError` hook (used to capture server errors)
requires `@sentry/nextjs >= 8.28.0`; any current version satisfies this.

## Package Legitimacy Audit

> Phase 4 installs exactly one new external package: `@sentry/nextjs`. The Vercel
> CLI is already installed and authenticated.

slopcheck was **not run in this research session** (the tool may not be installed
on the research host). Per the Package Legitimacy Gate graceful-degradation rule,
the one new package below is tagged `[ASSUMED]` and the planner should gate its
install behind a `checkpoint:human-verify` task, or the operator may simply
confirm — `@sentry/nextjs` is a well-known, first-party Sentry package.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `@sentry/nextjs` | npm | ~7 yrs (first published 2019) [ASSUMED] | millions/wk [ASSUMED] | github.com/getsentry/sentry-javascript | not run | Approved — verify version with `npm view`; well-known first-party SDK |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Recommended planner action:* a single `checkpoint:human-verify` or a `npm view
@sentry/nextjs` step before `bun add @sentry/nextjs`, then pin the resolved
version in `package.json`. Risk is low (canonical package, official org repo).

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
   git push main →  │  Vercel Git Integration                     │
                    │   • detects Next.js                         │
                    │   • bun install (zero-config, or            │
                    │     bunVersion in vercel.json)              │
                    │   • next build  ← serverExternalPackages    │
                    │     externalizes 'gbrain'                   │
                    │   • withSentryConfig uploads source maps    │
                    └───────────────┬─────────────────────────────┘
                                    │  produces
                                    ▼
        ┌───────────────────────────────────────────────────────┐
        │  Vercel Edge Network  →  https://quickbrain*.vercel.app │
        └───────────────┬───────────────────────────────────────┘
                         │  routes /api/* to
                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  Vercel Function (Node.js runtime, Fluid Compute, 300s max)   │
   │  process.env ← Vercel encrypted env config (DEPLOY-02)        │
   │                                                                │
   │  ┌─ /api/tenants/[id]/chat ──────────────────────────────┐    │
   │  │  think() → in-process gbrain engine (Phase 3)         │    │
   │  └────────────────────────────────────────────────────────┘    │
   │  ┌─ /api/health  (DEPLOY-03) ────────────────────────────┐    │
   │  │  probe app     → always ok (process is running)       │    │
   │  │  probe gbrain DB → engine.connect / SELECT 1 ─────────┼────┼──→ Supabase Postgres
   │  │  probe storage → lib/storage HEAD/list ───────────────┼────┼──→ Supabase Storage
   │  │  → JSON { app, gbrainDb, storage } + 200/503          │    │      (Supavisor pooler :6543)
   │  └────────────────────────────────────────────────────────┘    │
   │                                                                │
   │  unhandled error → onRequestError → Sentry (server)  ──────────┼──→ Sentry SaaS
   └──────────────────────────────────────────────────────────────┘
                         ▲
                         │ browser
   ┌──────────────────────────────────────────────────────────────┐
   │  Browser: instrumentation-client.ts + app/global-error.tsx    │
   │  unhandled client error → Sentry.captureException ────────────┼──→ Sentry SaaS
   └──────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (new/changed files this phase)

```
quick-brain/
├── next.config.ts                    # ADD serverExternalPackages + wrap with withSentryConfig
├── vercel.json                       # NEW (optional) — bunVersion, function maxDuration if needed
├── instrumentation.ts                # NEW — registers server/edge Sentry config, exports onRequestError
├── instrumentation-client.ts         # NEW — client Sentry init
├── sentry.server.config.ts           # NEW — server Sentry init
├── sentry.edge.config.ts             # NEW — edge Sentry init
├── app/
│   ├── global-error.tsx              # NEW — client error boundary → Sentry.captureException
│   └── api/
│       └── health/
│           └── route.ts              # NEW — GET /api/health, three-subsystem probe
├── lib/
│   └── health/                       # NEW (optional) — extract probe fns for unit testability
│       └── probes.ts
└── .env.example                      # UPDATE — document every env key (no values)
```

### Pattern 1: Externalize gbrain from the Next.js server bundle

**What:** Tell Next.js not to bundle `gbrain` (and its raw `.ts` + WASM deps)
into the serverless function; load it from `node_modules` at runtime.
**When to use:** Required this phase — STATE.md flags it as a carried-forward gap.
**Why it matters:** gbrain ships raw TypeScript and depends on
`@electric-sql/pglite` (WASM), `tree-sitter-wasms`, `web-tree-sitter` (WASM), and
the Vercel `ai` SDK. webpack/Turbopack static analysis can choke on raw `.ts` in
`node_modules` and may not trace WASM assets into the function bundle.

```typescript
// Source: next.config.ts — pattern per nextjs.org/docs/.../serverExternalPackages
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // gbrain ships raw .ts + WASM deps; load from node_modules at runtime,
  // do not bundle into the serverless function.
  serverExternalPackages: ["gbrain"],
};

export default nextConfig;
```

> **Verification required (do not skip):** After adding this, run a local
> `next build` and exercise the chat route. If the build still fails to trace
> WASM files (`pglite.wasm`, tree-sitter `.wasm`), add
> `outputFileTracingIncludes` for the gbrain package paths. This is the single
> highest-risk item in the phase — make it the first task or a Wave 0 spike.

### Pattern 2: Three-subsystem health probe with per-check isolation + timeout

**What:** A `GET /api/health` Route Handler that probes app, gbrain DB, and
Supabase Storage **independently** — one failing subsystem must not mask the
others, and a hung probe must not hang the endpoint.
**When to use:** DEPLOY-03.
**Key design rules** (from health-check best practice [CITED: nurbak.com health-check guide]):
- Run the three probes with `Promise.allSettled` so one rejection does not abort the others.
- Wrap each probe in a timeout (~2-3 s) — "a health check that hangs 30 s waiting for a dead DB is worse than no health check."
- Return HTTP **200** when all healthy, **503** when any subsystem is down (so uptime monitors flag it).
- `export const dynamic = "force-dynamic"` and `runtime = "nodejs"` (the gbrain Postgres client is not edge-compatible — same constraint the chat route already documents).
- Do **not** leak secrets in the payload — report status + latency only.

```typescript
// Source: app/api/health/route.ts — composed from project patterns + Next.js Route Handler conventions
import { createGBrainEngine } from "@/lib/gbrain/client"; // or engine.ts — see note below
import { createStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Probe = { ok: boolean; latencyMs: number; detail?: string };

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

async function timed(fn: () => Promise<void>, ms = 2500): Promise<Probe> {
  const start = Date.now();
  try {
    await withTimeout(fn(), ms);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function GET(): Promise<Response> {
  const [gbrainDb, storage] = await Promise.all([
    timed(async () => {
      // gbrain DB reachability — connect via the same pooler the app uses.
      // See "Open Questions" for the exact probe call to confirm with gbrain's API.
      const engine = await createGBrainEngine("seed");
      // a connected engine IS the reachability signal; optionally run a light query.
    }),
    timed(async () => {
      const store = createStorage(); // STORAGE_BACKEND from env
      await store.exists(".health-check"); // cheap HEAD; false is fine, an error is not
    }),
  ]);

  const app: Probe = { ok: true, latencyMs: 0 }; // the process answered = app is up
  const healthy = app.ok && gbrainDb.ok && storage.ok;

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: { app, gbrainDb, storage },
    },
    { status: healthy ? 200 : 503 },
  );
}
```

### Pattern 3: Sentry on Next.js 15 — the modern file set

**What:** `@sentry/nextjs` for Next.js 15 App Router uses the **instrumentation**
file convention (not the legacy `sentry.client.config.ts`).
**When to use:** DEPLOY-04.
**Files** [CITED: docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup]:

| File | Runtime | Role |
|------|---------|------|
| `instrumentation.ts` | server + edge | `register()` imports `sentry.server.config` / `sentry.edge.config` by runtime; **exports `onRequestError = Sentry.captureRequestError`** — this is what captures unhandled server errors from Route Handlers, Server Components, middleware |
| `instrumentation-client.ts` | browser | Calls `Sentry.init({ dsn, ... })`; runs before the app is interactive — captures unhandled client errors |
| `sentry.server.config.ts` | Node.js function | `Sentry.init` for the server runtime |
| `sentry.edge.config.ts` | edge | `Sentry.init` for the edge runtime |
| `app/global-error.tsx` | browser | Client component error boundary; calls `Sentry.captureException(error)` for React render errors that escape page boundaries |
| `next.config.ts` (wrapped) | build | `withSentryConfig(nextConfig, { ... })` — uploads source maps, applies tunneling |

The two DEPLOY-04 acceptance signals map cleanly:
- **unhandled server error** → caught by `onRequestError` exported from `instrumentation.ts` (requires `@sentry/nextjs >= 8.28.0`, Next.js 15 — both satisfied).
- **unhandled client error** → caught by `instrumentation-client.ts` global handlers + `app/global-error.tsx`.

```typescript
// Source: instrumentation.ts — per Sentry Next.js manual-setup docs
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

**Source maps:** `withSentryConfig` uploads maps at build time and needs a
`SENTRY_AUTH_TOKEN` env var — set it as a Vercel env var (Production + Preview),
keep it out of the repo. The Bun runtime on Vercel does not yet support automatic
source maps for its own runtime, but Sentry's webpack-plugin-based upload works
regardless because `next build` runs the bundler [CITED: bun.com/blog/vercel-adds-native-bun-support].

### Pattern 4: Vercel env config via CLI, per-environment, nothing in the repo

**What:** Load every secret into Vercel's encrypted env store, scoped to
Production / Preview / Development, never committed.
**When to use:** DEPLOY-02.

```bash
# Per-secret, per-environment. `vercel env add` defaults to "sensitive" for
# production/preview (value cannot be read back, only used at build/runtime).
vercel env add GBRAIN_DATABASE_URL production       # = Supavisor pooler URL :6543
vercel env add SUPABASE_DB_URL_DIRECT  production   # :5432, only if migrations run from the app
vercel env add SUPABASE_URL            production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add OPENAI_API_KEY          production
vercel env add ANTHROPIC_API_KEY       production
vercel env add SENTRY_AUTH_TOKEN       production   # build-time source-map upload
vercel env add STORAGE_BACKEND         production   # = "supabase"
# Repeat for `preview` as needed. `development` pulls into .env.local via:
vercel env pull .env.local
```

[CITED: vercel.com/docs/cli/env, vercel.com/docs/environment-variables]
- `vercel env add` defaults sensitive values to encrypted-and-unreadable for production/preview.
- Variables are encrypted at rest, decrypted only at build/runtime.
- `vercel env pull` keeps local `.env.local` in sync.
- The app already reads everything from `process.env` (see `lib/gbrain/engine.ts::buildConfig`, `lib/storage/index.ts`) — **no app-code change** is required for DEPLOY-02, only Vercel configuration and a gitignore audit.

### Anti-Patterns to Avoid

- **Re-introducing `gbrain serve --http` or a child-process spawn for the deploy.** CLAUDE.md's "What NOT to Use" forbids `gbrain serve --http`; Phase 3 already removed `spawn` from the query/think path. The health probe must use the **in-process engine**, never spawn a `gbrain` binary (the binary is not on PATH in a Vercel function).
- **A health probe that runs a full `think()` / LLM call.** That costs money and seconds per uptime ping. Probe with a connection check or a `SELECT 1`, not a synthesis call.
- **Returning 200 when a subsystem is down.** Uptime monitors rely on the status code; a degraded subsystem must yield 503.
- **Committing `.env.local` or any secret.** `.gitignore` already excludes `.env`, `.env.local`, `.env.*.local`, and `.vercel` — the plan must include a verification step (`git ls-files | grep -E '\.env'` returns nothing) but should not "fix" what is already correct.
- **Adding `@supabase/supabase-js` for the storage probe.** `lib/storage/` deliberately uses raw `fetch` (CLAUDE.md constraint). The health probe reuses `lib/storage/`'s `exists()` — no new dependency.
- **Bundling gbrain into the function.** Without `serverExternalPackages`, webpack will try to bundle raw `.ts` + WASM and likely fail or bloat past the 250 MB function limit.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Server + client error capture, grouping, alerting, source-mapped stack traces | A custom `console.error` + log-shipping pipeline | `@sentry/nextjs` | DEPLOY-04 requires it; Sentry's `onRequestError` + `global-error.tsx` handle the exact two cases in the acceptance criterion |
| Build + deploy pipeline | A custom GitHub Action that runs `vercel deploy` | Vercel Git integration (push `main` → auto-build) | DEPLOY-01's acceptance criterion is literally "`git push main` triggers a Vercel build" — the native integration *is* the requirement |
| Encrypted secret storage | A custom KMS / encrypted-file scheme | Vercel encrypted env config | Vercel encrypts at rest, injects at runtime, scopes per-environment — DEPLOY-02 names it directly |
| Per-environment config switching | Hand-rolled `if (process.env.NODE_ENV)` branches for secrets | Vercel's Production / Preview / Development env scoping | Vercel resolves the right value per deployment automatically |
| Promise timeout wrapper | (this one IS small enough to hand-roll) | `Promise.race` with a `setTimeout` reject | The 10-line `withTimeout` in Pattern 2 is fine — no library needed |

**Key insight:** Phase 4 is almost entirely *platform configuration*, not code.
The only meaningful new code is the `/api/health` Route Handler and the Sentry
instrumentation files (mostly boilerplate the Sentry wizard generates). The
real engineering risk is not "what to write" but "does the in-process gbrain
build and run inside a Vercel function" — that is a verification problem, not a
coding problem.

## Runtime State Inventory

> This is a deploy/config phase, not a rename or migration. There is no string
> rename, no datastore key change, no OS-registered state. The inventory below
> records the deploy-relevant state surfaces for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | gbrain brain lives in **Supabase Postgres** (migrated in Phase 2; 48 pages, schema v66). Not changed by Phase 4. | None — Phase 4 only adds a *reachability probe* against it |
| Live service config | **Vercel project `quickbrain`** already linked (`vercel link` done 2026-05-20). **Vercel env config** is empty of QuickBrain secrets — must be populated (DEPLOY-02). **Supabase Storage bucket `brain-files`** exists (Phase 2). **A Sentry project** must be created (operator step, or Marketplace integration). | Populate Vercel env config; create Sentry project + DSN |
| OS-registered state | None — Vercel functions are ephemeral; nothing is OS-registered. The local `bun link`-ed `gbrain` binary is **irrelevant on Vercel** (Phase 3 removed the spawn path; INPROC-01 made gbrain a `package.json` dependency: `github:garrytan/gbrain#3933eb6`). | None |
| Secrets/env vars | Current `.env.local` has 4 keys: `SUPABASE_DB_URL_DIRECT`, `SUPABASE_DB_URL_POOLER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. The roadmap/STATE also require `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GBRAIN_DATABASE_URL` (engine.ts falls back to `SUPABASE_DB_URL_POOLER` if `GBRAIN_DATABASE_URL` is absent). `STORAGE_BACKEND`/`STORAGE_BUCKET` are read by `lib/storage/`. `SENTRY_AUTH_TOKEN` + `NEXT_PUBLIC_SENTRY_DSN` are new this phase. **Resend key (`RESEND_API_KEY`) is a Phase 6 precondition** — the DEPLOY-02 success criterion *names* it, but it does not yet exist; see Open Questions. | Add all keys to Vercel env config; verify `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` are actually present locally (they are required by gbrain but were NOT in the `.env.local` key dump — flag) |
| Build artifacts | `.next/`, `tsconfig.tsbuildinfo` — gitignored, rebuilt by Vercel. `node_modules/gbrain` is a git-dependency (`github:garrytan/gbrain#3933eb6`) — Vercel's `bun install` will fetch and (per INPROC) run gbrain's install. | Confirm Vercel's install step builds the git-dependency `gbrain` cleanly (it ships raw `.ts`, no build step needed, but verify) |

**Notable gap surfaced:** `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` did **not**
appear in the local `.env.local` key dump (only the four Supabase keys did). gbrain
*requires* both for embeddings (vector search) and query expansion / `think`
synthesis. Either they live in the operator's shell env (not the file), or they
are missing. **The plan must verify these exist before deploy** — without them the
deployed chat route returns empty/degraded answers, and `/api/health`'s gbrain
probe may pass (DB reachable) while chat silently fails.

## Common Pitfalls

### Pitfall 1: gbrain does not build/bundle inside the Vercel function

**What goes wrong:** `next build` fails, or the deployed chat/health route throws
`ERR_MODULE_NOT_FOUND` / a WASM-load error, because webpack tried to bundle
gbrain's raw `.ts` source and its WASM deps and either failed static analysis or
did not trace the `.wasm` files into the function bundle.
**Why it happens:** gbrain ships raw TypeScript (no compiled JS), is loaded via a
computed dynamic-import shim (`types/gbrain.ts`), and depends on
`@electric-sql/pglite`, `tree-sitter-wasms`, `web-tree-sitter` (all WASM) plus the
`ai` SDK. The project has only ever run this under the **Bun** runtime locally —
`next build` (webpack/Turbopack) compilation of this path is **unverified**
(STATE.md says so explicitly).
**How to avoid:**
1. Add `serverExternalPackages: ['gbrain']` to `next.config.ts`.
2. Run a local `next build` and hit `/api/tenants/seed/chat` against the running
   build (`next start`) **before** the first Vercel deploy.
3. If WASM assets are still missing at runtime, add `outputFileTracingIncludes`
   pointing at gbrain's package dir.
**Warning signs:** `next build` errors mentioning `node_modules/gbrain/src/...ts`,
`Cannot find module`, `.wasm` 404 at runtime, or a function bundle approaching
250 MB.

### Pitfall 2: Assuming the old 10 s / 60 s Hobby function timeout

**What goes wrong:** The plan over-engineers around a 10 s or 60 s cap that no
longer exists, or the Phase 5 background-job threshold is set against a stale
number.
**Why it happens:** Older Vercel docs and most blog posts (and the QuickBrain
roadmap's own DEPLOY-05 criterion text "enabling 60s function timeout") describe
the pre-Fluid-Compute limits.
**How to avoid:** Use the current verified numbers — **300 s default maximum on
all plans** (Hobby, Pro, Enterprise) with Fluid Compute enabled, which is the
default [VERIFIED: vercel.com/docs/functions/limitations, last_updated 2026-02-24].
Pro raises the *maximum* to 800 s, but the *default* is 300 s everywhere. The
Hobby plan is **not** the timeout bottleneck.
**Warning signs:** Plan text or DEPLOY-05 doc that says "Hobby caps functions at
10s/60s" — that is the obsolete model.

### Pitfall 3: The health probe is too expensive or too coupled

**What goes wrong:** `/api/health` runs a full LLM `think()` call or a multi-query
search, so every uptime ping costs Anthropic/OpenAI tokens and several seconds;
or one dead subsystem makes the whole endpoint hang or 500, masking the others.
**Why it happens:** Reaching for the highest-fidelity check ("prove the brain can
answer") instead of the cheapest reachability signal.
**How to avoid:** Probe **reachability**, not **functionality** — a DB connection
or `SELECT 1`, a Storage `HEAD`/`exists`. Run probes with `Promise.allSettled`,
wrap each in a ~2.5 s timeout, and report per-subsystem status independently.
**Warning signs:** `/api/health` latency in hundreds of ms→seconds; Anthropic
usage rising from uptime pings; a single subsystem outage returning 500.

### Pitfall 4: Sentry set up with the legacy `sentry.client.config.ts` file

**What goes wrong:** Client errors are not captured because the SDK init never
runs — the file convention changed.
**Why it happens:** Pre-Next.js-15 / pre-`@sentry/nextjs` v8 docs and tutorials
use `sentry.client.config.ts`. Next.js 15 + current `@sentry/nextjs` use
`instrumentation-client.ts` [CITED: docs.sentry.io manual-setup; nextjs.org instrumentation-client docs].
**How to avoid:** Use the current file set (Pattern 3). Prefer running
`bunx @sentry/wizard@latest -i nextjs` so the scaffolded files match the installed
SDK version exactly. Verify `onRequestError` is exported from `instrumentation.ts`.
**Warning signs:** A `sentry.client.config.ts` in the repo; client errors absent
from the Sentry dashboard while server errors appear.

### Pitfall 5: Secrets present locally but absent on Vercel (or vice versa)

**What goes wrong:** The deploy builds and the home page loads, but chat returns
empty answers or `/api/health` reports `gbrainDb: down` — because
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GBRAIN_DATABASE_URL` were never added to
Vercel's env config (they may live only in the operator's shell locally).
**Why it happens:** Local dev inherits the operator's shell env; Vercel functions
get **only** what is in Vercel's env config. The two environments drift.
**How to avoid:** Enumerate every key the app reads (`process.env.*` across
`lib/gbrain/engine.ts`, `lib/gbrain/client.ts`, `lib/storage/`), add each to
Vercel for Production (and Preview), and after deploy hit `/api/health` —
DEPLOY-03's probe is the verification mechanism for DEPLOY-02's completeness.
**Warning signs:** `/api/health` green for `app` but red for `gbrainDb`/`storage`
on the deployed URL while green locally.

## Code Examples

### `vercel.json` — pin Bun, optionally raise function duration

```jsonc
// Source: bun.com/docs/guides/deployment/vercel + vercel.com/docs/project-configuration
// Only needed if you want Bun explicitly pinned. Next.js deploys fine with the
// default Node.js runtime even when the repo uses Bun as the package manager.
{
  "bunVersion": "1.x"
  // "functions": { "app/api/**/route.ts": { "maxDuration": 300 } }  // default is already 300s
}
```

> **Decision point for the planner:** The project uses Bun locally, but Next.js on
> Vercel runs fine under the **default Node.js runtime** even when `bun install`
> is the package-manager step. The Bun *runtime* on Vercel is still Beta (no
> automatic source maps, `Bun.serve` unsupported) [CITED: bun.com/blog/vercel-adds-native-bun-support].
> **Recommendation:** deploy on the Node.js runtime (default), let Vercel use
> `bun install` for dependencies (zero-config, auto-detected from `bun.lock`)
> [CITED: vercel.com/changelog/bun-install-is-now-supported-with-zero-configuration].
> Do NOT opt into the Bun runtime — it would lose Sentry's automatic source maps
> and is unproven for this app. The codebase already anticipates this:
> `lib/gbrain/paths.ts` falls back from `import.meta.dir` (Bun-only) to
> `process.cwd()` precisely so it works under the Next.js/webpack/Node runtime.

### `next.config.ts` — externalize gbrain AND wrap with Sentry

```typescript
// Source: composed from next.config docs + Sentry Next.js manual-setup
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  serverExternalPackages: ["gbrain"],
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN, // build-time source-map upload only
  silent: !process.env.CI,
});
```

### `app/global-error.tsx` — client error boundary → Sentry

```typescript
// Source: docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup
"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <html>
      <body>Something went wrong.</body>
    </html>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hobby functions cap at 10 s, Pro at 60 s | **300 s default max on all plans** (Fluid Compute default-on); Pro/Ent can raise to 800 s | Fluid Compute became default through 2025; limits page `last_updated: 2026-02-24` [VERIFIED] | DEPLOY-05's "enabling 60s timeout" framing is obsolete; Phase 5's background-job threshold should use 300 s, not 60 s |
| `sentry.client.config.ts` / `sentry.server.config.ts` pair, manual error handlers | `instrumentation.ts` (+ `onRequestError`) + `instrumentation-client.ts` + `global-error.tsx` | `@sentry/nextjs` v8 + Next.js 15 (`onRequestError` requires SDK >= 8.28.0) | Use the instrumentation file convention; the wizard generates it correctly |
| `serverComponentsExternalPackages` (experimental) | `serverExternalPackages` (stable, top-level) | Next.js 15 stabilized it | Use the stable top-level key |
| Vercel needed `npm`/`yarn`; Bun unsupported | `bun install` zero-config auto-detected; Bun *runtime* in Beta | Bun install support shipped; Bun runtime still Beta in 2026 | Let Vercel `bun install`; deploy on Node.js runtime |

**Deprecated/outdated:**
- The 10 s / 60 s Hobby/Pro timeout model — superseded by Fluid Compute defaults.
- `sentry.client.config.ts` — superseded by `instrumentation-client.ts`.
- The `bun link`-ed `gbrain` binary on PATH — Phase 3 (INPROC-01) made gbrain a
  `package.json` git-dependency; nothing on Vercel relies on a PATH binary.

## Assumptions Log

> Claims tagged `[ASSUMED]` that the planner / discuss-phase should confirm.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@sentry/nextjs` current major is `~10.x` | Standard Stack | Low — `npm view` resolves it; any version >= 8.28.0 supports `onRequestError`. Planner must pin the verified version. |
| A2 | The Vercel Marketplace Sentry integration and manual setup are equivalent for this project | Alternatives Considered | Low — both produce the same instrumentation files; choice is operator preference |
| A3 | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` live in the operator's shell env (they were absent from the `.env.local` key dump) | Runtime State Inventory | **HIGH** — if missing entirely, the deployed chat route returns empty answers and gbrain embeddings fail. Must be verified before deploy. |
| A4 | `serverExternalPackages: ['gbrain']` alone is sufficient for the gbrain WASM deps to load in a Vercel function | Pattern 1 / Pitfall 1 | **HIGH** — unverified; the project has never run this path under `next build`. Needs a build spike. May additionally need `outputFileTracingIncludes`. |
| A5 | The gbrain `BrainEngine` exposes a cheap connectivity signal (a connected engine, or a light query) suitable for a health probe without an LLM call | Pattern 2 / Open Questions | Medium — `createGBrainEngine` connecting successfully IS a reachability signal; the exact "cheapest" probe call needs confirmation against gbrain's engine API |
| A6 | `RESEND_API_KEY` is a Phase 6 precondition and does not exist yet | Open Questions | Low — STATE.md confirms it is a Phase 6 operator step; DEPLOY-02's mention of it is forward-looking |

## Open Questions

1. **Does `next build` + a Vercel Node.js function actually run the in-process gbrain path?**
   - What we know: Phase 3 verified in-process query/think under the **Bun** runtime (tests + live). STATE.md explicitly flags `next.config.ts` lacks `serverExternalPackages` and the chat route is unverified under `next build`.
   - What's unclear: Whether `serverExternalPackages: ['gbrain']` alone resolves the raw-`.ts` + WASM (`pglite`, tree-sitter) bundling, or whether `outputFileTracingIncludes` is also needed.
   - Recommendation: Make a local `next build` + `next start` + chat-route smoke test the **first task (or a Wave 0 spike)** of Phase 4. Do not attempt the Vercel deploy until this passes locally. This is the phase's critical path.

2. **What is the cheapest correct "gbrain DB reachable" probe call?**
   - What we know: `createGBrainEngine(tenantId)` connects to Supabase Postgres via the pooler; a successful connect is itself a reachability signal. gbrain's `postgres` (porsager) client is pure JS.
   - What's unclear: Whether to (a) treat a successful `createGBrainEngine` as the probe, (b) run a raw `SELECT 1` on the pooler URL with the `postgres` client directly, or (c) call a lightweight gbrain operation. The engine pool also caches connections — a probe should not poison or exhaust the pool.
   - Recommendation: Planner should pick the simplest of (a)/(b). Option (b) — a direct `postgres` `SELECT 1` against `GBRAIN_DATABASE_URL` with a short timeout, connection closed immediately — is the most isolated and does not touch the app's engine pool. Confirm during planning.

3. **`RESEND_API_KEY` in DEPLOY-02's criterion vs. its non-existence until Phase 6.**
   - What we know: DEPLOY-02's success criterion lists "Resend key" among secrets that must be in Vercel config. STATE.md lists `RESEND_API_KEY` as a **Phase 6 precondition** (operator must obtain it with a verified domain) — it does not exist yet.
   - What's unclear: Whether Phase 4 should add a placeholder, skip it, or whether the criterion is simply forward-looking.
   - Recommendation: Phase 4 sets up the **mechanism** (Vercel env config + the `vercel env add` workflow) and adds every secret that exists today. `RESEND_API_KEY` is added later by Phase 6 using the same mechanism. The plan should note this explicitly so the DEPLOY-02 criterion is not read as "blocked on Resend."

4. **Sentry project + DSN — who creates it?**
   - What we know: DEPLOY-04 needs a Sentry project, a DSN (`NEXT_PUBLIC_SENTRY_DSN`), and a `SENTRY_AUTH_TOKEN` for source-map upload.
   - What's unclear: Whether the operator has an existing Sentry account/project.
   - Recommendation: Treat "create Sentry project + obtain DSN + auth token" as an operator precondition step (like `vercel link` was), or use the Vercel Marketplace integration which provisions it. Surface this in the plan as a `checkpoint:human-verify` or precondition.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Vercel project `quickbrain` | DEPLOY-01 | ✓ | n/a (`vercel link` done 2026-05-20) | — |
| Vercel CLI (authenticated) | DEPLOY-02 deploy/env workflow | ✓ | latest (operator authenticated) | Vercel dashboard UI |
| Supabase project + Postgres | DEPLOY-03 gbrain DB probe | ✓ | schema v66, 48 pages (Phase 2) | — |
| Supabase Storage `brain-files` bucket | DEPLOY-03 storage probe | ✓ | n/a (Phase 2) | — |
| `OPENAI_API_KEY` | gbrain embeddings (chat correctness, not the health probe) | ✗ (not in `.env.local` dump) | — | none — required for vector search; **verify before deploy** |
| `ANTHROPIC_API_KEY` | gbrain `think` synthesis | ✗ (not in `.env.local` dump) | — | none — required for chat answers; **verify before deploy** |
| Sentry project + DSN | DEPLOY-04 | ✗ (unknown) | — | Vercel Marketplace Sentry integration provisions one |
| `@sentry/nextjs` package | DEPLOY-04 | ✗ (not installed) | — | none — `bun add @sentry/nextjs` |

**Missing dependencies with no fallback:**
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` — gbrain cannot do vector search or
  synthesis without them. They may already be in the operator's shell env (the
  research only inspected `.env.local`). **The plan must verify their presence
  and add them to Vercel env config; otherwise the deployed chat route is broken
  even though the deploy itself "succeeds."**
- `@sentry/nextjs` — install it (`bun add @sentry/nextjs`).

**Missing dependencies with fallback:**
- Sentry project/DSN — if the operator has no Sentry account, the Vercel
  Marketplace Sentry integration creates the project and injects the env vars.

## Project Constraints (from CLAUDE.md)

CLAUDE.md's hackathon-era tech stack is mostly superseded by the v2.0 pivot
(STATE.md / MEMORY.md), but these directives still bind Phase 4:

- **No `gbrain serve --http`, no custom MCP client.** The health probe and chat
  route must use the **in-process** gbrain engine — never spawn a `gbrain` binary
  and never start gbrain's HTTP/MCP server. (Phase 3 already removed the
  query/think spawn path; Phase 4 must not regress it.)
- **No `@supabase/supabase-js` / `@supabase/storage-js`.** `lib/storage/` uses raw
  `fetch`. The storage health probe must reuse `lib/storage/`'s `exists()` — do
  not add a Supabase SDK for the probe.
- **No Vercel AI SDK `useChat` / streaming-protocol coupling.** Not relevant to
  Phase 4 directly, but the Sentry setup must not pull in or assume the `ai` SDK
  client surface — Sentry is independent of the chat transport.
- **No background-job queue (BullMQ/Inngest) in this phase.** The roadmap puts
  Inngest in Phase 5. Phase 4 must not pre-emptively add a job queue.
- **Bun end-to-end for local tooling**; `bunx` over `npx`. Use `bun add` /
  `bunx @sentry/wizard`. (On Vercel, `bun install` runs zero-config; the function
  runtime should stay Node.js — see the `vercel.json` code example.)
- **GSD workflow enforcement** — all file edits go through a GSD command.
- **Note for the planner:** Several CLAUDE.md statements are stale post-pivot
  (PGLite as runtime DB, "single laptop", "demo runs once"). Phase 10 (CLEAN-05)
  rewrites CLAUDE.md. Phase 4 should follow CLAUDE.md's *still-valid* constraints
  above and **not** treat the stale demo-era statements as binding (e.g.,
  "Sentry/observability stack" is in the old "What NOT to Use" table — that
  entry is explicitly overridden by the v2.0 DEPLOY-04 requirement).

## Security Domain

> `security_enforcement` is not set in `.planning/config.json` → treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth in Phase 4 (auth is Phase 6) |
| V3 Session Management | no | No sessions this phase |
| V4 Access Control | partial | `/api/health` is public by design — it must expose **no secret, no PII, no tenant data**; status + latency only |
| V5 Input Validation | minimal | `/api/health` takes no input. The existing routes already validate tenant slugs with zod — unchanged. |
| V6 Cryptography | no (consume, don't implement) | Vercel encrypts env vars at rest; the app never implements crypto. `SENTRY_AUTH_TOKEN` and `SUPABASE_SERVICE_ROLE_KEY` are secrets — store only in Vercel encrypted config. |
| V7 Error Handling & Logging | yes | Sentry must not capture secrets in error context. The chat route already logs metadata only (not question text) — keep that. Health-probe error `detail` strings must not echo connection strings. |
| V14 Configuration | yes | Secrets in Vercel encrypted env config, never in repo; `.gitignore` already covers `.env*` and `.vercel` |

### Known Threat Patterns for {Vercel deploy + Sentry + public health endpoint}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret committed to git (`.env.local`, `SERVICE_ROLE_KEY`) | Information Disclosure | `.gitignore` already excludes `.env*`/`.vercel`; plan adds a verification grep (`git ls-files`) — do not commit, only verify |
| `/api/health` leaks DB host, connection string, or version in its JSON / error detail | Information Disclosure | Probe returns boolean `ok` + `latencyMs` only; sanitize error `detail` to a generic message, never echo the connection string |
| `/api/health` used for DoS / cost amplification (each ping triggers an LLM call) | Denial of Service | Probe with `SELECT 1` / `HEAD`, never `think()`; per-probe timeout caps cost and latency |
| Sentry event payload contains a secret or PII in the error context/breadcrumbs | Information Disclosure | Configure Sentry `beforeSend` to scrub if needed; do not pass `process.env` or question text into captured context |
| `SENTRY_AUTH_TOKEN` exposed in client bundle | Information Disclosure | The auth token is **build-time only** (`next.config.ts` / `withSentryConfig`); never prefix it `NEXT_PUBLIC_`. Only `NEXT_PUBLIC_SENTRY_DSN` is client-side (a DSN is not a secret) |
| `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS) reachable from the client | Elevation of Privilege | Already mitigated in `lib/storage/` (server-only, raw fetch); the health probe runs server-side in a Node.js Route Handler — keep it server-only |

## Validation Architecture

> `workflow.nyquist_validation` is **`false`** in `.planning/config.json` — this
> section is included for the planner's awareness only; full Nyquist test mapping
> is not required.

The project has a Vitest suite (`bun run test`, 114 CI / 121 live as of Phase 3)
and a GitHub Actions CI gate (Phase 1). For Phase 4:
- The `/api/health` Route Handler's pure probe functions (if extracted to
  `lib/health/probes.ts`) are unit-testable with mocked `fetch`/engine — a small
  test is cheap and worthwhile.
- The Sentry instrumentation files are mostly SDK boilerplate; the meaningful
  verification is **live** (trigger a server error and a client error on the
  deployed URL, confirm both appear in the Sentry dashboard — exactly DEPLOY-04's
  acceptance criterion).
- The end-to-end Phase 4 verification is operational, not unit-test-shaped:
  `git push main` → build succeeds → URL reachable → `/api/health` returns 200
  with three green subsystems → two test errors land in Sentry.

## Sources

### Primary (HIGH confidence)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) — `last_updated: 2026-02-24` — function duration (300s default all plans, 800s max Pro), memory (2GB Hobby), 250MB bundle, 4.5MB body, Fluid Compute defaults
- [Sentry for Next.js — Manual Setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/) — instrumentation files, `onRequestError`, `global-error.tsx`, source maps, `withSentryConfig`
- [Next.js — serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages) — opting packages out of server bundling
- [Vercel CLI — `vercel env`](https://vercel.com/docs/cli/env) — `env add` / `env pull`, per-environment scoping, sensitive defaults
- [Vercel — Environment Variables](https://vercel.com/docs/environment-variables) — encryption at rest, Production/Preview/Development scopes
- Codebase (read directly): `next.config.ts`, `package.json`, `lib/gbrain/engine.ts`, `lib/gbrain/client.ts`, `lib/storage/*`, `app/api/tenants/[id]/chat/route.ts`, `app/api/tenants/[id]/insights/route.ts`, `types/gbrain.ts`, `node_modules/gbrain/package.json` (exports + deps), `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`, Phase 2/3 SUMMARY files

### Secondary (MEDIUM confidence)
- [Deploy a Bun application on Vercel](https://bun.com/docs/guides/deployment/vercel) — `bunVersion` in `vercel.json`, `bun --bun` script syntax
- [Vercel now supports the Bun Runtime](https://bun.com/blog/vercel-adds-native-bun-support) — Bun runtime Beta, no automatic source maps, `Bun.serve` unsupported
- [Bun install zero-config on Vercel](https://vercel.com/changelog/bun-install-is-now-supported-with-zero-configuration) — auto-detection from `bun.lock`
- [Next.js Health Check guide (Nurbak)](https://nurbak.com/en/blog/how-to-add-health-checks-nextjs-app/) — `/api/health` pattern, parallel probes, per-check timeout, 200/503
- [Next.js — instrumentation-client](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation-client) — client instrumentation file convention

### Tertiary (LOW confidence)
- Various 2026 Vercel-pricing blog posts (FENCODE, Schematic, Costbench) — used only to cross-check Hobby-tier numbers; the authoritative source is the Vercel docs above

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — Vercel + Sentry + Next.js are all first-party-documented; only the exact `@sentry/nextjs` version is `[ASSUMED]` pending `npm view`
- Architecture (health probe, Sentry files, env workflow): HIGH — documented patterns, codebase already structured to support them
- gbrain-on-serverless build behavior: MEDIUM — `serverExternalPackages` is the right mechanism, but the in-process gbrain path has never run under `next build`; needs a build spike (the phase's critical risk)
- Pitfalls: HIGH — derived from verified platform facts + explicit STATE.md carried-forward gaps

**Research date:** 2026-05-20
**Valid until:** ~2026-06-20 for Vercel/Sentry platform facts (fast-moving — re-verify function limits and `@sentry/nextjs` version at plan time); codebase facts valid until the next phase changes them
</content>
</invoke>
