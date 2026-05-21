# Deploy Runbook — QuickBrain on Vercel

**Version:** Phase 4 (2026-05-20)  
**Platform:** Vercel (Hobby plan, project `quickbrain`)  
**Repository:** `git@github.com:hannanabdul55/quick-brain.git`

---

## How a Deploy Happens

Every push to `main` triggers an automatic Vercel build via the Vercel Git integration:

```
git push origin main
  → Vercel detects push (Git integration)
  → bun install (zero-config, auto-detected from bun.lock)
  → next build  (serverExternalPackages externalises gbrain;
                 withSentryConfig uploads source maps)
  → deploy to production URL
```

**Production URL:** `https://quickbrain-hannanabdul55s-projects.vercel.app` (canonical URL for the `quickbrain` Vercel project; also accessible at `https://quickbrain-brown.vercel.app`)

No CLI step is needed for a normal deploy — push `main` and Vercel handles the rest.

### First-time setup checklist (one-time operator actions)

1. Connect the GitHub repo to the Vercel project: Vercel dashboard → Project `quickbrain` → Settings → Git.
2. Load all env vars into Vercel's encrypted env config (see inventory below).
3. Verify the build succeeds in the Vercel dashboard → Deployments.

---

## Environment Variable Inventory

All secrets live **only** in Vercel's encrypted env config (Production environment).
None of these values appear in the repository. The app reads them exclusively from
`process.env` at runtime.

Add each with `vercel env add <KEY> production` or via the Vercel dashboard.

| Variable | Purpose | Source |
|----------|---------|--------|
| `GBRAIN_DATABASE_URL` | gbrain engine Postgres connection (Supavisor transaction pooler, port 6543) | Supabase → Database → Transaction pooler URL |
| `SUPABASE_DB_URL_POOLER` | Supabase transaction pooler URL (port 6543); fallback for `GBRAIN_DATABASE_URL` | Supabase → Database → Transaction pooler |
| `SUPABASE_DB_URL_DIRECT` | Direct Postgres connection (port 5432) for migration-time use | Supabase → Database → Direct connection |
| `SUPABASE_URL` | Supabase project REST/Auth API base URL | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (bypasses RLS); server-only, never `NEXT_PUBLIC_`-prefixed | Supabase → Project Settings → API → service_role key |
| `OPENAI_API_KEY` | Required by gbrain for vector embeddings (`text-embedding-3-small`); without it, semantic search degrades to keyword-only | OpenAI dashboard |
| `ANTHROPIC_API_KEY` | Required by gbrain for query expansion and `think()` synthesis; without it, chat answers are empty/degraded | Anthropic console |
| `STORAGE_BACKEND` | Storage backend selector; set to literal `"supabase"` | Literal value: `supabase` |
| `STORAGE_BUCKET` | Supabase Storage bucket name; set to literal `"brain-files"` | Literal value: `brain-files` |
| `NEXT_PUBLIC_SENTRY_DSN` | Sentry DSN for client-side error capture (safe to expose to the browser) | Sentry → Project Settings → Client Keys (DSN) |
| `SENTRY_AUTH_TOKEN` | Build-time Sentry source-map upload token; **never** `NEXT_PUBLIC_`-prefixed | Sentry → Settings → Auth Tokens |
| `SENTRY_ORG` | Sentry organization slug (used by `withSentryConfig` at build time) | Sentry organization settings |
| `SENTRY_PROJECT` | Sentry project slug (used by `withSentryConfig` at build time) | Sentry project settings |

**Not yet set (Phase 6 precondition):** `RESEND_API_KEY` — transactional email for auth flow. Add via the same `vercel env add` mechanism when Phase 6 is ready.

**Security note:** `SUPABASE_SERVICE_ROLE_KEY` bypasses Supabase Row-Level Security.
It is injected only into the server-side function runtime by Vercel; it is never sent
to the browser and never `NEXT_PUBLIC_`-prefixed.

**Verify no secrets are committed:**

```bash
git ls-files | grep -E '\.env'
# must return only .env.example (or nothing)
```

---

## Runtime Decision — Bun Function Runtime

**Decision:** Vercel functions run on the **Bun runtime** (configured in `vercel.json`).

**Why:** gbrain ships raw TypeScript (no compiled JS output). On the **Node.js runtime**,
loading gbrain's raw `.ts` at module resolution time causes Node 24 to throw:

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
```

This was proven in the Phase 3 debug session (`docs/debug/gbrain-next-build-prod.md`)
and cannot be worked around without pre-compiling gbrain at build time (fragile, not
supported by gbrain's own repo structure). The Bun runtime loads raw `.ts` natively —
the same path that runs locally with `bun node_modules/.bin/next start`.

**`vercel.json` config applied (Task 3, corrected in Task 6):**

```jsonc
{
  "bunVersion": "1.x",
  "functions": {
    "app/api/**/*.ts": {
      "runtime": "bun@1.2.0"
    }
  }
}
```

**Important:** Vercel requires a full `runtime@version` specifier (e.g. `bun@1.2.0`).
Using `"bun"` or `"bun@1"` causes an immediate build failure with:
`Function Runtimes must have a valid version, for example now-php@1.0.0`.

**Tradeoff accepted:** The Bun runtime on Vercel is Beta (2026). Sentry's webpack-based
source-map upload (`withSentryConfig`) still works at build time regardless of the function
runtime; only Bun-native runtime source maps (Bun-specific stack traces) are not
automatically symbolicated. This is an acceptable tradeoff — server errors still reach
Sentry with useful context.

**Do NOT regress to the Node.js runtime** without first resolving how gbrain's raw `.ts`
will be loaded on Node. The `serverExternalPackages: ["gbrain"]` entry in `next.config.ts`
tells webpack not to bundle gbrain, but that alone does not make Node capable of loading
raw TypeScript — you still need a Bun (or Deno) runtime, or a pre-compilation step.

---

## File Tracing — gbrain + WASM Dependencies

Vercel's serverless function bundler uses static import analysis to decide which files
to include in the function bundle. gbrain is loaded via `/* webpackIgnore: true */`
dynamic imports with computed specifiers — the tracer cannot follow these statically.

`next.config.ts` includes an `outputFileTracingIncludes` block that force-includes
gbrain and its WASM dependencies:

```typescript
outputFileTracingIncludes: {
  "app/api/**/route.ts": [
    "node_modules/gbrain/**",
    "node_modules/postgres/**",
    "node_modules/@electric-sql/pglite/**",
    "node_modules/tree-sitter-wasms/**",
    "node_modules/web-tree-sitter/**",
  ],
},
```

All four WASM-dep packages are at top-level `node_modules/` (verified 2026-05-20).

---

## Vercel Hobby Free-Tier Limits

**Current numbers (verified from Vercel docs, `last_updated: 2026-02-24`):**

| Limit | Hobby | Pro | Notes |
|-------|-------|-----|-------|
| Function timeout (default max) | **300 s** | 300 s default, up to 800 s configurable | Fluid Compute is default-on for all plans — the old 10 s / 60 s Hobby cap is **obsolete** |
| Function memory | 2 GB | 2 GB | Same across plans |
| Function bundle size | 250 MB | 250 MB | Force-including gbrain + WASM pushes this; monitor if approaching limit |
| Included bandwidth | 100 GB / month | 1 TB / month | |
| Included compute | 100 GB-hours / month | Scales with plan | |
| **Commercial use** | **Prohibited** | Permitted | This is the binding Hobby→Pro trigger (see below) |

**The old "10s/60s timeout" framing in the roadmap is obsolete.** The 300 s default
already covers `think()` synthesis latency for chat queries. Timeout is NOT the reason
to upgrade to Pro.

---

## Hobby → Pro Upgrade Trigger

**Trigger: First real / commercial user — NOT a timeout.**

Vercel's Hobby plan [Terms of Service] **prohibits commercial use**. QuickBrain is a
commercial product (the v2.0 pivot targets paying SMB owners). The upgrade to Pro must
happen when the first real (paying or trialling) external user is onboarded — regardless
of function latency.

At that point, run:

```bash
vercel upgrade   # or upgrade via the Vercel dashboard
```

The Pro plan primarily adds:
- Commercial use permitted
- Higher compute/bandwidth inclusions
- Function timeout ceiling raised to 800 s (configurable per-function)
- Team collaboration features

**Summary:** The Hobby plan is fine for development and internal testing. The instant
QuickBrain serves any real user, upgrade to Pro. Do not frame this as a timeout issue.

---

## Health Check

Verify the deployment is healthy after any push:

```bash
# 1. App loads
curl -s -o /dev/null -w "%{http_code}" https://quick-brain.vercel.app/
# expect: 200

# 2. All three subsystems green
curl -s -w "\nHTTP %{http_code}\n" https://quick-brain.vercel.app/api/health
# expect: HTTP 200 + JSON { status: "ok", checks: { app: ..., gbrainDb: ..., storage: ... } }
# if gbrainDb or storage is down, a required secret is missing in Vercel — add it and redeploy

# 3. Chat returns a real gbrain answer (the real test)
curl -s -X POST https://quick-brain.vercel.app/api/tenants/seed/chat \
  -H 'Content-Type: application/json' \
  -d '{"question":"what was weird about March?"}'
# expect: SSE stream with an 'answer' frame containing a real gbrain analysis
# if you see: error frame with MODULE_NOT_FOUND → file tracing or Bun runtime misconfigured
```

---

## Observability

**Error tracking:** `@sentry/nextjs` is wired via `instrumentation.ts` (server) and
`instrumentation-client.ts` (browser). Unhandled server errors and client React errors
are captured automatically.

- Server errors: `onRequestError = Sentry.captureRequestError` in `instrumentation.ts`
- Client errors: `instrumentation-client.ts` + `app/global-error.tsx`
- Source maps uploaded at build time by `withSentryConfig` in `next.config.ts`

**Sentry scrubbing:** The `beforeSend` hook in `sentry.server.config.ts` redacts event
body and removes known-sensitive keys (see 04-02-SUMMARY.md for details).

---

## Reset / Re-seed (Local Development)

The Vercel production deployment uses the `seed` tenant backed by Supabase Postgres
(migrated in Phase 2). To re-seed the brain from the local synthetic data:

```bash
# WARNING: destructive — wipes the seed tenant brain and re-imports
bun run scripts/seed.ts
```

See `scripts/seed.ts` for the full re-seed procedure.
