# Phase 5 Onboarding Handoff: Per-Tenant Provisioning

## What Phase 2 Did

- The seed/demo brain (`brains/seed/`) is migrated to Supabase Postgres (engine: postgres, 48 pages, schema v66, 100% embeddings, doctor 90/100).
- Runtime queries route through the Supavisor transaction pooler via `GBRAIN_DATABASE_URL` injected in `lib/gbrain/client.ts`.
- The app is ephemeral-FS-safe for the SEED tenant at query time:
  - `client.ts` `runOnce()` calls `mkdir(home, {recursive:true})` on `brains/seed/` — a no-op because the dir exists.
  - `gbrain query` against the seed brain reads `brains/seed/.gbrain/config.json` (engine flag only, no database_url) and then queries Supabase Postgres. No new files are written to disk.
- `lib/storage/` shim provides `StorageBackend` interface with Supabase Storage (production) and local filesystem (dev fallback) backends. `STORAGE_BACKEND=local` works without Supabase credentials.
- `data/maras-coffee/gbrain.yml` provides storage tiering config: 4 `db_tracked` directories, `db_only: []`.

## What Phase 5 Must Resolve

`onboard()` currently creates local PGLite brains via `gbrain init --yes`. This writes `brains/<tenantId>/.gbrain/config.json` to the local filesystem. In a Vercel serverless function or ephemeral container, this write will fail (read-only filesystem or wiped between invocations).

Phase 5 must replace `onboard()` with a Postgres provisioning flow:

1. Call `gbrain init` with `--engine postgres --url $GBRAIN_DATABASE_URL` so the brain is backed by Supabase Postgres, not PGLite.
2. Determine whether to pass a per-tenant `GBRAIN_HOME` (pointing to an ephemeral temp dir) or skip `GBRAIN_HOME` entirely — the right answer depends on whether gbrain supports per-tenant schema scoping via RLS without a local config file. Spike 005 confirmed RLS is enabled on 41/41 tables; the question is whether gbrain can be invoked without a `GBRAIN_HOME` at all once the brain is Postgres-backed.
3. Confirm gbrain RLS isolates each tenant's data in the shared Supabase project. Spike 005 shows the auto-RLS event trigger is installed — this is the load-bearing isolation mechanism for multi-tenant Phase 5.

## Code Locations

| File | What Phase 5 Must Change |
|---|---|
| `lib/gbrain/onboard.ts` | Replace `gbrain init --yes` with `gbrain init --engine postgres --url ...` provisioning flow |
| `lib/gbrain/paths.ts` | `BRAINS_ROOT` / `brainHome()` may no longer be needed post-Phase 5 if GBRAIN_HOME is dropped |
| `lib/gbrain/client.ts` | `runOnce()` `mkdir(home)` — add an ephemeral-env guard; skip mkdir if running in a container |
| `lib/gbrain/tenants.ts` | In-memory registry built from filesystem scan — must be replaced with a DB lookup (Supabase `tenants` table or equivalent) |

## Explicit Deviation

The existing per-tenant onboarding flow is NOT broken by Phase 2. It works correctly in local dev and on any machine with a persistent filesystem.

It WILL break in an ephemeral serverless environment (Vercel). This is a KNOWN limitation deferred to Phase 5.

Phase 3 (Vercel Deploy) must document this as a "not yet prod-ready for new tenant signups" constraint until Phase 5 ships. The seed/demo brain (the only brain used in the demo) is already ephemeral-FS-safe — Phase 3 can ship a working demo without Phase 5.
