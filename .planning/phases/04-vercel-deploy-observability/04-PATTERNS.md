# Phase 4: Vercel Deploy + Observability - Pattern Map

**Mapped:** 2026-05-20
**Files analyzed:** 9 new/modified files
**Analogs found:** 7 / 9 (2 are SDK-boilerplate with no internal analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `app/api/health/route.ts` | route (Route Handler) | request-response | `app/api/tenants/[id]/insights/route.ts` | role-match (GET handler, no params) |
| `lib/health/probes.ts` *(optional)* | utility | request-response | `lib/storage/index.ts` + `lib/gbrain/engine.ts` | role-match (env-driven pure-ish fns) |
| `next.config.ts` | config | n/a | `next.config.ts` (existing, modified in place) | exact (same file) |
| `instrumentation.ts` | config (instrumentation hook) | event-driven | none in repo | no analog (Sentry/Next.js boilerplate) |
| `instrumentation-client.ts` | config (instrumentation hook) | event-driven | none in repo | no analog (Sentry boilerplate) |
| `sentry.server.config.ts` | config | n/a | none in repo | no analog (Sentry boilerplate) |
| `sentry.edge.config.ts` | config | n/a | none in repo | no analog (Sentry boilerplate) |
| `app/global-error.tsx` | component (error boundary) | event-driven | `app/layout.tsx` | partial (root-level `<html>`/`<body>` shell) |
| `vercel.json` *(optional)* | config | n/a | `components.json` / `tsconfig.json` | partial (root JSON config convention) |
| `.env.example` | config (docs) | n/a | `.env.local` (existing, 4 keys) | role-match (key inventory, no values) |

## Pattern Assignments

### `app/api/health/route.ts` (route, request-response)

**Analog:** `app/api/tenants/[id]/insights/route.ts` — the only existing GET Route Handler. Use it for the file-doc-comment style, the `dynamic` export, the `Response.json(..., { status })` shape, and the `try/catch` error envelope. The chat route (`app/api/tenants/[id]/chat/route.ts`) is the analog for the `runtime = "nodejs"` export and the privacy-aware `console.log` metadata pattern.

**File header doc-comment convention** (insights route lines 1-24): every Route Handler in this repo opens with a block comment listing the method+path, the response shape, an explicit "HTTP status codes" list, and the requirement IDs it satisfies. The health route MUST follow this — list 200/503 and reference DEPLOY-03.

**Route-segment config exports** — both analogs declare these as top-level `export const`. The health route needs **both** (chat route has both; insights route has only `dynamic`):
```typescript
// app/api/tenants/[id]/chat/route.ts lines 41-42
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```
`runtime = "nodejs"` is mandatory — RESEARCH.md Pattern 2 and the chat route doc-comment (lines 18-22) both state gbrain's `postgres` client is not edge-compatible. `dynamic = "force-dynamic"` prevents the probe being statically cached.

**Imports pattern** — `@/`-prefixed path aliases for `lib/*`, Node built-ins prefixed `node:`:
```typescript
// app/api/tenants/[id]/insights/route.ts lines 26-30
import { join } from "node:path";
import { tenantSlugSchema } from "@/lib/gbrain/slug";
import * as tenants from "@/lib/gbrain/tenants";
import { FIXTURES_ROOT, SEED_TENANT_ID, brainHome } from "@/lib/gbrain/paths";
import { getCachedInsights, computeAndCache } from "@/lib/insights/cache";
```
For the health route, import `createStorage` from `@/lib/storage` and the DB probe helper (see DB-probe note below). NOTE: in-`lib` modules use **explicit `.ts` extensions** in their relative imports (`engine.ts`, `./paths.ts`, `./types.ts`) — see `lib/gbrain/client.ts` lines 3-6 and `lib/storage/index.ts` lines 15-17 — but Route Handlers under `app/` use the **`@/` alias without extension**. Match whichever convention the file's location dictates.

**JSON response shape + status-code pattern** (insights route lines 46-49, 87-97; chat route lines 56-59):
```typescript
// success
return Response.json(bundle, { status: 200 });
// error envelope — { error: "<snake_case_code>", message: string }, never leaks secrets
return Response.json(
  { error: "compute_failed", message: err instanceof Error ? err.message : String(err) },
  { status: 500 },
);
```
The health route's body should be `{ status: "ok"|"degraded", timestamp, checks: { app, gbrainDb, storage } }` with HTTP 200 when healthy / 503 when any subsystem is down (RESEARCH.md Pattern 2). Per-probe `detail` strings MUST be sanitized — do not echo connection strings (Security Domain, V7).

**Error-handling pattern** — every analog wraps fallible work in `try/catch`, logs with a `[tag]` prefix via `console.error`, and either returns a JSON error envelope or re-throws unexpected errors to Next.js:
```typescript
// app/api/tenants/[id]/insights/route.ts lines 83-94
try {
  bundle = await computeAndCache(tenantId, sourceDir);
} catch (err: unknown) {
  console.error("[insights] compute failed for", tenantId, err);
  return Response.json(
    { error: "compute_failed", message: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
```
For `/api/health` the catch is per-probe (see `lib/health/probes.ts` below), not whole-handler — a failing subsystem yields a 503 envelope, not a thrown error.

**Privacy-aware logging** (chat route lines 100-101; tenants route lines 43-44): logs use a `[tag]` prefix and log **metadata only** — never secrets, never PII. The health route should log probe outcomes (`{ gbrainDb: false, storage: true, latencyMs }`) but never the connection string or service-role key.

**No `OPTIONS` needed** — the chat route adds an `OPTIONS` handler (lines 142-144) only because it is POST/CORS-sensitive. `/api/health` is GET-only; skip `OPTIONS` like the insights route does.

---

### `lib/health/probes.ts` (utility, request-response) — *optional extraction*

**Analog:** `lib/storage/index.ts` (env-driven factory + clear credential-free throw) and `lib/gbrain/engine.ts` (`buildConfig()` env-resolution pattern). RESEARCH.md Validation Architecture suggests extracting the three probe functions here so they are unit-testable with a mocked `fetch`/engine.

**Env-resolution pattern with clear, credential-free errors** (engine.ts lines 61-70):
```typescript
// lib/gbrain/engine.ts buildConfig — read env, fall back, throw without echoing values
function buildConfig(): { engine: "postgres"; database_url: string } {
  const database_url =
    process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!database_url) {
    throw new Error(
      "GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set for in-process gbrain queries",
    );
  }
  return { engine: "postgres", database_url };
}
```
The DB probe reads the **same** env keys with the **same** fallback order — `GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER` — so the probe verifies exactly the URL the app's engine uses. Do not invent a new env key.

**Storage probe — reuse the existing backend, no new dependency** (`lib/storage/index.ts` lines 21-39 + `lib/storage/supabase.ts` lines 80-89):
```typescript
// storage probe — createStorage() reads STORAGE_BACKEND; exists() is a cheap HEAD
const store = createStorage();              // index.ts factory, env-driven
await store.exists(".health-check");        // supabase.ts exists() = HEAD request, res.ok
```
`createSupabaseStorage().exists()` is already a single `fetch` HEAD returning `res.ok` — that is the cheapest reachability signal. CLAUDE.md / RESEARCH.md anti-pattern: do NOT add `@supabase/supabase-js` for this; `lib/storage/` uses raw `fetch` deliberately.

**DB-probe decision (RESEARCH.md Open Question 2):** the recommended option is a direct `postgres` `SELECT 1` against the resolved `GBRAIN_DATABASE_URL` with a short timeout and the connection closed immediately — this isolates the probe from the app's `enginePool` (engine.ts line 54) so a probe never poisons or exhausts the production pool. `engine.ts`'s `disconnectEngine` (lines 119-124) shows the connect→use→`disconnect()` lifecycle; the probe mirrors it on a throwaway connection. Avoid `createGBrainEngine` for the probe (it caches into the shared pool). The planner must confirm the exact `postgres` client import path during planning.

**Timeout wrapper** — RESEARCH.md Pattern 2 supplies a 10-line `withTimeout`/`timed` helper (`Promise.race` + `setTimeout` reject). This is small enough to hand-roll (RESEARCH.md "Don't Hand-Roll" explicitly says so) — place it in `lib/health/probes.ts`. The repo has prior art for `Promise`-race-style settle-once logic in `lib/gbrain/client.ts` lines 97-117 (the `settled` guard + `timer` cleanup) if a robust version is wanted.

---

### `next.config.ts` (config) — modify in place

**Analog:** the existing `next.config.ts` (3 lines, empty config object). This is a modify-in-place file. RESEARCH.md "Code Examples" gives the exact target:
```typescript
// next.config.ts — current state (modify this file)
import type { NextConfig } from "next";
const nextConfig: NextConfig = { /* config options here */ };
export default nextConfig;
```
Two changes (RESEARCH.md Pattern 1 + Code Examples):
1. Add `serverExternalPackages: ["gbrain"]` to the `NextConfig` object — gbrain ships raw `.ts` + WASM deps (`@electric-sql/pglite`, `tree-sitter-wasms`, `web-tree-sitter`) and must load from `node_modules` at runtime, not be bundled. The shim `types/gbrain.ts` (lines 1-20, read) confirms gbrain is loaded via a runtime computed dynamic import that webpack must not statically follow.
2. Wrap the default export with `withSentryConfig(nextConfig, { org, project, authToken, silent })`. `authToken` is **build-time only** — never `NEXT_PUBLIC_`-prefixed (Security Domain threat table).

This is the phase's highest-risk file — RESEARCH.md Open Question 1 / Pitfall 1 / Assumption A4 all flag that `serverExternalPackages` alone may be insufficient and `outputFileTracingIncludes` may also be needed; the planner must gate this behind a local `next build` spike.

---

### `app/global-error.tsx` (component, event-driven)

**Analog:** `app/layout.tsx` — the only existing root-level component that renders the `<html>`/`<body>` shell. `global-error.tsx` is a client component that replaces the root layout on a render crash, so it must also emit `<html><body>`.

**Root-shell structure to mirror** (`app/layout.tsx` lines 13-23): a default-exported React component returning `<html lang="en"><body>{...}</body></html>`. `global-error.tsx` differs in two ways from `layout.tsx`: it needs the `"use client"` directive at the top (layout is a Server Component), and it receives an `error` prop instead of `children`.

**Target shape** (RESEARCH.md Code Examples — Sentry manual-setup boilerplate):
```typescript
"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html><body>Something went wrong.</body></html>
  );
}
```
Keep the body copy plain — no secrets, no `error.message` rendered to the user (consistency with the repo's secret-free error surfaces). Import style: `import * as Sentry from "@sentry/nextjs"` matches the repo's existing namespace-import style (`import * as tenants from "@/lib/gbrain/tenants"` in chat/insights/reset routes).

---

### `instrumentation.ts`, `instrumentation-client.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` (config)

**Analog:** none in the repo — these are `@sentry/nextjs` SDK boilerplate. RESEARCH.md Pattern 3 + Pitfall 4 are the source of truth. The planner SHOULD prefer running `bunx @sentry/wizard@latest -i nextjs` so the scaffolded files match the installed SDK version exactly, rather than hand-writing them.

**The one project-specific convention to enforce** — `instrumentation.ts` MUST export `onRequestError`:
```typescript
// instrumentation.ts — RESEARCH.md Pattern 3
import * as Sentry from "@sentry/nextjs";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
  if (process.env.NEXT_RUNTIME === "edge")   await import("./sentry.edge.config");
}
export const onRequestError = Sentry.captureRequestError;
```
This is what captures unhandled errors thrown by the existing Route Handlers (`app/api/tenants/route.ts` line 55 re-throws unexpected errors specifically so a higher boundary catches them — `onRequestError` is now that boundary). Anti-pattern (RESEARCH.md Pitfall 4): do NOT create a legacy `sentry.client.config.ts` — the Next.js 15 convention is `instrumentation-client.ts`.

**Env-var convention** — `instrumentation-client.ts` reads `NEXT_PUBLIC_SENTRY_DSN` (client-safe, a DSN is not a secret); server/edge configs read the DSN too. `SENTRY_AUTH_TOKEN` is build-time only and belongs in `next.config.ts`'s `withSentryConfig`, never in a client-loaded file.

---

### `vercel.json` (config) — *optional*

**Analog:** root JSON config files `components.json`, `tsconfig.json` — the repo's convention for tool config is a single root-level JSON file. RESEARCH.md Code Examples shows `vercel.json` is optional (Next.js deploys zero-config). If created, keep it minimal:
```jsonc
{ "bunVersion": "1.x" }   // function maxDuration default is already 300s — omit it
```
RESEARCH.md decision point: deploy on the **Node.js runtime** (default), let Vercel run `bun install` zero-config. Do NOT opt into the Bun runtime (loses Sentry source maps).

---

### `.env.example` (config docs)

**Analog:** the existing `.env.local` (4 keys: `SUPABASE_DB_URL_DIRECT`, `SUPABASE_DB_URL_POOLER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). `.env.example` is new — it documents every key the app reads, with **no values**.

**Key inventory to document** — enumerate every `process.env.*` the codebase reads (verified from the files read this session):
- `GBRAIN_DATABASE_URL`, `SUPABASE_DB_URL_POOLER` — `lib/gbrain/engine.ts` line 62-63, `lib/gbrain/client.ts` line 53
- `SUPABASE_DB_URL_DIRECT` — present in `.env.local` (migrations)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — `lib/storage/index.ts` lines 25-26
- `STORAGE_BACKEND`, `STORAGE_BUCKET` — `lib/storage/index.ts` lines 22, 27
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — required by gbrain (engine.ts doc-comment lines 22-25 references the gateway / `ANTHROPIC_API_KEY`); RESEARCH.md Assumption A3 flags these as possibly absent — the plan must verify them
- `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` — new this phase
- `CI` — set by `lib/gbrain/client.ts` line 49 (not a user-supplied secret; document as informational)

`.gitignore` already excludes `.env`, `.env.local`, `.env.*.local`, `.vercel` (verified — lines 4-6, 13). `.env.example` is the only env file that IS committed. The plan should add a verification grep (`git ls-files | grep -E '\.env'` returns only `.env.example`), not "fix" the already-correct `.gitignore`.

## Shared Patterns

### Route Handler file structure
**Source:** `app/api/tenants/[id]/insights/route.ts`, `app/api/tenants/[id]/chat/route.ts`, `app/api/tenants/route.ts`
**Apply to:** `app/api/health/route.ts`
Every Route Handler: (1) opens with a block doc-comment listing method+path, response shape, an explicit HTTP-status-code list, and requirement IDs; (2) declares route-segment config as top-level `export const` (`dynamic`, and `runtime` when DB/Node-only); (3) numbers its logical steps with `// ── N. … ──` comment banners; (4) returns `Response.json(payload, { status })`; (5) uses snake_case `error` codes in the error envelope.

### Env resolution + credential-free errors
**Source:** `lib/gbrain/engine.ts` lines 61-70 (`buildConfig`), `lib/storage/index.ts` lines 21-39
**Apply to:** `lib/health/probes.ts`, any new env read
Read `process.env.X ?? process.env.Y` with an explicit fallback chain; if a required key is missing, `throw new Error("<KEY_A> and <KEY_B> required for …")` — name the keys, never echo a partial value. The health route's DB probe reuses engine.ts's exact `GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER` chain.

### Privacy-aware, tagged logging
**Source:** `app/api/tenants/[id]/chat/route.ts` lines 100-101, `app/api/tenants/route.ts` lines 43-44, `lib/gbrain/engine.ts` threat-model comment
**Apply to:** `app/api/health/route.ts`, all Sentry config (`beforeSend` scrubbing)
`console.log("[tag]", { metadataOnly })` — log lengths, codes, durations, slugs; never log secrets, connection strings, question text, or business names. Sentry must be configured the same way: no `process.env` dump, no PII into captured context (Security Domain V7).

### Path-alias / extension import convention
**Source:** `app/api/*` (`@/lib/...` no extension) vs `lib/*` (`./foo.ts` explicit extension)
**Apply to:** all new files
Files under `app/` import via `@/lib/...` with no file extension. Files under `lib/` import siblings via relative path **with** explicit `.ts` (`./paths.ts`, `engine.ts`). New files match the convention of their directory. Node built-ins are always `node:`-prefixed (`node:path`, `node:fs/promises`, `node:child_process`).

### Error re-throw to framework boundary
**Source:** `app/api/tenants/route.ts` lines 54-55
**Apply to:** rationale for `instrumentation.ts` `onRequestError`
The codebase already catches *expected* errors and re-throws *unexpected* ones so a higher boundary handles them. `onRequestError` (from `instrumentation.ts`) becomes that boundary on Vercel — this is why Sentry's server capture works without touching existing route code.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `instrumentation.ts` | config | event-driven | No instrumentation hook exists yet; pure `@sentry/nextjs` + Next.js 15 boilerplate — use RESEARCH.md Pattern 3 or the Sentry wizard |
| `instrumentation-client.ts` | config | event-driven | No client instrumentation exists; `Sentry.init` boilerplate — use the wizard for version-matched output |
| `sentry.server.config.ts` | config | n/a | `Sentry.init` boilerplate; no internal analog — wizard-generated |
| `sentry.edge.config.ts` | config | n/a | `Sentry.init` boilerplate; no internal analog — wizard-generated |

For these four, the planner should reference RESEARCH.md Pattern 3 and the Sentry manual-setup docs, and prefer `bunx @sentry/wizard@latest -i nextjs` so files match the installed SDK version. The only project-specific requirement is the `onRequestError` export in `instrumentation.ts`.

## Metadata

**Analog search scope:** `app/api/**/route.ts` (5 handlers), `app/*.tsx`, `lib/gbrain/`, `lib/storage/`, `types/gbrain.ts`, root config files (`next.config.ts`, `package.json`, `.gitignore`, `tsconfig.json`)
**Files scanned:** ~16 (5 Route Handlers, 4 gbrain lib files, 3 storage files, layout, next.config, gbrain shim head, env/gitignore)
**Pattern extraction date:** 2026-05-20
