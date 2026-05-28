---
spike: 005
name: gbrain-on-supabase
type: standard
validates: "Given gbrain 0.35.1 with a PGLite-backed brain, when `gbrain migrate --to supabase --url <direct-connection>` is run against a free-tier Supabase project, then all pages/chunks/embeddings/links transfer losslessly, the schema (pgvector + pg_trgm + RLS) applies cleanly, and both `gbrain doctor` and `gbrain query` pass against the Postgres backend — confirming the v2.0 foundation (PGLite → Supabase Postgres) is viable on the free tier"
verdict: VALIDATED
related: [003]
tags: [gbrain, supabase, postgres, pgvector, v2.0-foundation, phase-1-precondition]
---

# Spike 005: gbrain on Supabase

## What This Validates

The v2.0 "Real-World Foundation" roadmap (post-hackathon pivot, 2026-05-19) opens with Phase 1: migrate gbrain off PGLite onto Supabase Postgres. Every later phase (file storage, Vercel deploy, multi-tenant, QBO ingest) assumes Postgres-as-truth. If `gbrain migrate --to supabase` is broken, slow, lossy, or requires a paid Supabase tier, the whole roadmap warps.

This spike was run **before** committing the v2.0 roadmap to files, specifically to de-risk Phase 1 (flagged as a possible "1-week unknown").

## Research

Findings from reading the gbrain 0.35.1 source at `/Users/abdulhannankanji/Git repos/gbrain/`:

- gbrain ships **two engines**: `PostgresEngine` (v0, Supabase) and `PGLiteEngine` (v0.7, embedded WASM Postgres). Same SQL dialect — not separate code paths. `docs/ENGINES.md`.
- `gbrain migrate --to <supabase|pglite>` is documented as "bidirectional, lossless" — transfers pages, chunks, embeddings, links, tags, timeline. Source: `src/commands/migrate-engine.ts`.
- The migrate command reads the target connection from `--url`, else `GBRAIN_DATABASE_URL`, else `DATABASE_URL`.
- gbrain's docs *recommend* Supabase Pro ($25/mo) for hosting — but that is a zero-ops/backups preference, not a technical gate. Free tier has Postgres 17 + pgvector. This spike tests the free tier explicitly.
- Anticipated gotcha: Supabase exposes a **direct connection** (port 5432) and a **Supavisor transaction pooler** (port 6543). DDL/migrations typically need the direct/session connection; transaction-mode pooling breaks prepared statements. Which one does gbrain want?

## How to Run

```bash
# Free-tier Supabase project provisioned by operator; connection strings in
# quick-brain/.env.local (gitignored) as SUPABASE_DB_URL_DIRECT + _POOLER.

cd "quick-brain"
export PATH="$HOME/.bun/bin:$PATH"
set -a && . ./.env.local && set +a

# Copy the seed brain so the working PGLite seed stays intact, then migrate the copy.
cp -r brains/seed brains/spike-supabase
# (fix the copied config.json database_path to point at the copy)

export GBRAIN_HOME="$(pwd)/brains/spike-supabase"
gbrain migrate --to supabase --url "$SUPABASE_DB_URL_DIRECT"
gbrain doctor
gbrain query "what was weird about last month?"
gbrain files list
GBRAIN_DATABASE_URL="$SUPABASE_DB_URL_POOLER" gbrain list -n 2   # runtime via pooler
```

## What to Expect

Lossless migration, a passing health check, working hybrid search, and confirmation that the transaction pooler is usable for runtime queries.

## Investigation Trail

### Pre-flight — connectivity + extensions (verbatim, 2026-05-19)

- **Direct connection (port 5432):** `PostgreSQL 17.6 on aarch64-unknown-linux-gnu` — connects, IPv4-reachable (no IPv6 add-on needed).
- **Transaction pooler (port 6543, `prepare: false`):** `POOLER OK: true`.
- **Extensions available, not yet installed:** `vector` 0.8.0, `pg_trgm` 1.6. gbrain's `initSchema()` is expected to `CREATE EXTENSION` them.

**Assumption going in:** the direct connection might be IPv6-only (a known 2024+ Supabase change for new projects without the IPv4 add-on). **Reality:** the direct connection resolved over IPv4 fine on this network. Did not need the pooler as a fallback for migration DDL.

### Migration — `gbrain migrate --to supabase` (verbatim tail)

```
[migrate.copy_pages] 48/48 (100%) done
Copying links...
[migrate.copy_links] 48/48 (100%) done

Migration complete. 48 pages transferred.
Config updated to engine: postgres
Original PGLite brain preserved at .../brains/spike-supabase/.gbrain/brain.pglite (backup).

Verifying target...
  ok  pages: 48 (matches source)
  ok  embeddings: 100% coverage, 0 missing
  ok  schema: version 66
```

**Wall clock: 45.5s** for 48 pages + links + embeddings. Run against the **direct** connection (5432).

**Three observations:**
1. **Lossless + self-verifying** — gbrain re-counts pages and embedding coverage on the target after copy and reports a match. 48/48, 100% embeddings.
2. **The PGLite source is preserved** — migrate does not delete the source `.pglite` file; it flips `config.json` `engine` to `postgres` but leaves the old file as a backup. Rollback is trivial.
3. **`config.json` now contains the connection string with the password in plaintext** (`database_url` field). See Gotcha 1 below.

### Health check — `gbrain doctor` (verbatim, relevant lines)

```
[OK] pgvector: Extension installed
[OK] rls: RLS enabled on 41/41 public tables
[OK] schema_version: Version 66 (latest: 66)
[OK] rls_event_trigger: Auto-RLS event trigger installed
[OK] embedding_provider: openai:text-embedding-3-large ✓ 1536 dims, DB aligned
Health score: 90/100. All checks OK (some warnings).
```

**Critical finding:** gbrain **enables RLS on all 41 public tables automatically** and installs an auto-RLS event trigger so new tables inherit it. This is load-bearing for v2.0 multi-tenant isolation (Phase 5) — gbrain does not leave tenant isolation to the application layer; it pushes it into Postgres RLS by default.

### Hybrid search — `gbrain query` against Supabase (verbatim tail)

```
[1.2454] march-anomaly-summary -- ... everything weird, unusual, or unexpected ...
[0.8899] recurring-charges -- ... every vendor that debited Mara's account ...
... 21 ranked results ...
gbrain query "what was weird about last month?"  6.512 total
```

Vector search + RRF fusion against Supabase pgvector works. **Wall clock 6.5s** for the retrieval pass (no Anthropic synthesis in this invocation — `query` is retrieval; `think`/synthesis adds more).

### Runtime via the pooler

`GBRAIN_DATABASE_URL=<transaction-pooler-6543> gbrain list` works — the Supavisor transaction pooler is usable for runtime read queries. The split is: **direct (5432) for migration/DDL, pooler (6543) for app runtime.**

### `files` subsystem probe

`gbrain files list` → "No files stored." `gbrain storage` → "All pages are stored in git by default. Total pages: 48. No gbrain.yml configuration found." The `files` subsystem exists and is configured via a `gbrain.yml` storage-tiering config. Markdown *pages* live in Postgres after migration; *binary* assets (PDFs, images) are what `files` + Supabase Storage would handle.

## Results

**VERDICT: VALIDATED ✓**

Phase 1 of the v2.0 roadmap is **not** a 1-week unknown. The migration is a single resumable, lossless, self-verifying command that completed in 45s on the Supabase free tier.

### Confirmed facts

| Question | Answer |
|---|---|
| Does `gbrain migrate --to supabase` work? | Yes — 48/48 pages, 100% embeddings, 45s, self-verified |
| Free tier sufficient? | Yes — Postgres 17.6 + pgvector 0.8.0 + pg_trgm 1.6, no Pro needed for dev |
| Does the schema apply cleanly? | Yes — schema v66, pgvector + RLS + event trigger all OK, doctor 90/100 |
| Direct vs pooler? | Direct (5432) for migration DDL; transaction pooler (6543, `prepare:false`) for runtime |
| Is migration reversible? | Yes — source PGLite file preserved as backup; `migrate --to pglite` goes back |
| Does hybrid search work on Postgres? | Yes — vector + RRF, 6.5s retrieval |

### Findings that shape the v2.0 roadmap

1. **Phase 1 (Postgres migration) is small.** The risky part — does gbrain-on-Supabase even work — is answered. Phase 1 is really: provision the prod Supabase project, run `migrate`, repoint the app's gbrain config, regression-test. Likely 1-2 days, not a week.

2. **gbrain RLS changes Phase 5 (multi-tenant).** gbrain auto-enables RLS on every table. v2.0 multi-tenant isolation should *lean on gbrain's RLS*, not reinvent it at the app layer. Phase 5 scope shrinks accordingly — but needs research into how gbrain scopes RLS per brain/tenant (per-brain database? shared DB with a tenant key? — open question for Phase 5 discuss).

3. **Phase 2 (file storage) is smaller than scoped.** Markdown pages are in Postgres post-migration — they were never going to need object storage. Only *binary* assets need Supabase Storage, via gbrain's own `files` subsystem + a `gbrain.yml`. Phase 2 may collapse into "write a `gbrain.yml`, point `files` at a Supabase Storage bucket" rather than building a `lib/storage/` shim.

4. **The 6.5s retrieval latency confirms the Phase 4 (background jobs) concern is real but borderline.** `gbrain query` retrieval alone is 6.5s; with multi-query expansion + Anthropic synthesis a full chat answer will exceed Vercel Hobby's 10s timeout. Background jobs / streaming will be needed before the dashboard chat is reliable on a free Vercel deploy.

### Gotchas

1. **`gbrain migrate` writes the connection string — password and all — into `<brain>/.gbrain/config.json` in plaintext.** For the deployed app, the gbrain config must NOT carry the password. Use the `GBRAIN_DATABASE_URL` env var instead and keep `config.json` password-free (or out of the repo). For this spike, `brains/` is gitignored so nothing leaked, but Phase 1 must explicitly handle this — the prod brain config cannot contain a plaintext secret.

2. **Two connection strings, two jobs.** Direct (5432) for migrations/DDL; transaction pooler (6543) for app runtime, and runtime clients must set `prepare: false` (transaction-mode pooling breaks prepared statements). gbrain's runtime accepts the pooler via `GBRAIN_DATABASE_URL`.

3. **`migrate` flips the source brain's engine config.** After `migrate --to supabase`, the brain's `config.json` says `engine: postgres` — subsequent gbrain commands on that brain dir hit Supabase, not the local file. The PGLite file is kept as a backup but is no longer "live". Plan around this: the prod brain is migrated once; dev brains stay PGLite.

### Cleanup

- `brains/spike-supabase/` is a throwaway copy (gitignored). Safe to `rm -rf` once the spike is reviewed.
- The Supabase `quickbrain-dev` project now holds the 48 seed pages. Either keep it as the dev database or wipe it (`gbrain migrate --to supabase --force` overwrites; or drop tables) before Phase 1 provisions the real one.
