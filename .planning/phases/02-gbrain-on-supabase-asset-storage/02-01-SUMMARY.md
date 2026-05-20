---
phase: 02-gbrain-on-supabase-asset-storage
plan: "01"
subsystem: gbrain-integration
tags: [gbrain, supabase, postgres, migration, pooler, infra]
dependency_graph:
  requires: []
  provides:
    - seed brain on Supabase Postgres (engine:postgres, 48 pages, schema v66)
    - GBRAIN_DATABASE_URL pooler injection in lib/gbrain/client.ts
    - scripts/migrate-to-supabase.sh (idempotent migration + rollback)
    - scripts/seed.sh Postgres mode (dual-mode PGLite/Postgres)
    - tests/infra/seed-config.test.ts (CI-safe config guard)
  affects:
    - lib/gbrain/client.ts (all spawned gbrain child processes)
    - scripts/seed.sh (Postgres mode changes import flow)
tech_stack:
  added: []
  patterns:
    - gbrain migrate --to supabase --force (non-empty target override)
    - GBRAIN_DATABASE_URL env injection via SUPABASE_DB_URL_POOLER spread
    - describe.skipIf(!existsSync(path)) for CI-safe Vitest on gitignored files
key_files:
  created:
    - scripts/migrate-to-supabase.sh
    - tests/infra/seed-config.test.ts
  modified:
    - lib/gbrain/client.ts
    - scripts/seed.sh
decisions:
  - "Used --force on gbrain migrate because the quickbrain-dev Supabase project already held 48 pages from Spike 005 (disposable spike data per spike README)"
  - "Rollback uses gbrain migrate --to pglite --force (not git checkout) because the pglite target also has existing data from the spike round-trip"
  - "describe.skipIf(!existsSync(configPath)) chosen over conditional it.skip — cleaner Vitest pattern that skips the entire describe block, not individual tests"
  - "gbrain has no bulk pages delete command; documented manual SQL truncation path in seed.sh comment instead of guessing at an API that does not exist"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-19"
  tasks_completed: 3
  tasks_total: 3
  files_created: 2
  files_modified: 2
---

# Phase 2 Plan 01: Supabase Migration + gbrain Rewire Summary

**One-liner:** Migrated seed brain from PGLite to Supabase Postgres (48 pages, 100% embeddings, schema v66) and wired all gbrain child processes through the Supavisor pooler via GBRAIN_DATABASE_URL injection.

## What Was Built

### Task 1 — Migration + migration script (commit af05d6f)

- Ran `gbrain migrate --to supabase --url $SUPABASE_DB_URL_DIRECT --force` against the Supabase `quickbrain-dev` project (--force required: project had 48 leftover pages from Spike 005)
- Migration completed: 48/48 pages, 100% embeddings, schema v66 — self-verified by gbrain
- Sanitized `brains/seed/.gbrain/config.json`: stripped `database_url` field, left `{"engine":"postgres"}`
- Tested rollback (`gbrain migrate --to pglite --force`): exited 0, `gbrain list -n 2` confirmed 48 pages in PGLite
- Re-migrated to Supabase and re-sanitized config.json
- Created `scripts/migrate-to-supabase.sh`: idempotent (checks engine before running), credential-guarded (exits with clear error if SUPABASE_DB_URL_DIRECT unset), documents rollback path with exact commands
- `gbrain doctor`: pgvector OK, RLS 41/41 OK, schema_version v66 OK, health score 90/100

### Task 2 — TDD: test + client.ts rewire (commits 40f5997, 40e85fc)

- **RED** (40f5997): `tests/infra/seed-config.test.ts` — 3 assertions: engine=postgres, no database_url, no password field. Uses `describe.skipIf(!existsSync(configPath))` for CI safety (file is gitignored).
- **GREEN** (40e85fc): `lib/gbrain/client.ts` `runOnce()` env block updated to spread `GBRAIN_DATABASE_URL: process.env.SUPABASE_DB_URL_POOLER` when SUPABASE_DB_URL_POOLER is set. Falls back to inherited GBRAIN_DATABASE_URL if unset. gbrain confirms `prepare:false` mode on port 6543.

### Task 3 — seed.sh dual-mode guard (commit b71d60e)

- `scripts/seed.sh` now branches on `$SUPABASE_DB_URL_DIRECT`:
  - **Postgres mode** (set): skips `gbrain init`, exports `GBRAIN_DATABASE_URL=$SUPABASE_DB_URL_DIRECT`, runs import + extract + embed, re-sanitizes config.json
  - **PGLite mode** (unset): original `rm -rf brains/seed && gbrain init` behavior unchanged
- Documents that `gbrain pages delete --all` does not exist; instructs manual SQL truncation for clean reseed
- `bash -n scripts/seed.sh`: passes

## Deviations from Plan

### Deviation 1 — Correction to plan framing (from orchestrator)

The plan framed `brains/seed/.gbrain/config.json` as a **committed** file. In reality `brains/*` is gitignored (line 7 of `.gitignore`). This was flagged by the orchestrator before execution and applied as follows:

- Config.json sanitization still performed (defense-in-depth — strips database_url from disk even though it cannot leak into git)
- `tests/infra/seed-config.test.ts` uses `describe.skipIf(!existsSync(configPath))` instead of an unconditional read — CI-safe when the gitignored file is absent
- `git add brains/seed/.gbrain/config.json` NOT attempted (correctly skipped)

### Deviation 2 — Migration required --force (Spike 005 residual data)

The plan mentioned using `--force` if the target had stale spike data but framed it as a conditional. In practice: the first `gbrain migrate --to supabase` returned exit 1 with "Target brain is not empty (48 pages) — run with --force." Re-ran with `--force` successfully.

Similarly, rollback required `--force` because the PGLite target already had 48 pages from the earlier spike round-trip.

### Deviation 3 — gbrain pages delete --all does not exist

The plan mentioned `gbrain pages delete --all --yes` as a potential command for Postgres reseed. `gbrain --help` confirms this command does not exist (`Unknown command: pages`). Only `gbrain delete <slug>` (single page) exists. Applied per plan fallback: documented manual SQL path in seed.sh comment, continued with import (idempotent on slug).

## Self-Check

### Files created/modified exist:

- [x] scripts/migrate-to-supabase.sh — exists, executable
- [x] tests/infra/seed-config.test.ts — exists
- [x] lib/gbrain/client.ts — modified (GBRAIN_DATABASE_URL injection)
- [x] scripts/seed.sh — modified (dual-mode Postgres/PGLite guard)

### Commits exist:

- af05d6f — feat(02-01): add migrate-to-supabase.sh and run seed brain migration
- 40f5997 — test(02-01): add CI-safe seed-config.test.ts
- 40e85fc — feat(02-01): inject GBRAIN_DATABASE_URL (pooler) into gbrain child env
- b71d60e — feat(02-01): update seed.sh with dual Postgres/PGLite mode guard

### Verification results:

- Config guard (no database_url): PASS
- Pooler runtime query: PASS — ranked results returned
- gbrain doctor (3+ [OK] lines): PASS — pgvector OK, RLS 41/41 OK, schema_version v66 OK
- Unit tests (bun run test): PASS — 90 passed, 3 skipped, 0 failed
- bunx tsc --noEmit: PASS — clean

## Self-Check: PASSED

## Known Stubs

None. All functionality is wired to real data (Supabase Postgres). No placeholder values or empty collections.

## Threat Flags

No new security-relevant surface introduced beyond what was described in the plan's threat model. The `GBRAIN_DATABASE_URL` pooler URL with password is injected via child process env (never logged by our code). Config.json sanitization is defense-in-depth against future gitignore removal.
