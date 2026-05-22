---
phase: "06-auth-multi-tenant-isolation"
plan: "01"
subsystem: "auth"
tags: ["auth", "postgres", "supabase", "jose", "resend", "sessions", "magic-links"]
dependency_graph:
  requires: []
  provides:
    - "scripts/setup-auth-tables.ts — idempotent DDL for app.users/sessions/magic_links"
    - "lib/auth/store.ts — sql singleton + users/magic_links CRUD"
    - "lib/auth/session.ts — createSession/validateSession/destroySession"
  affects:
    - "lib/auth/tokens.ts (plan 06-02, imports sql from store.ts)"
    - "app/api/auth/send-link/route.ts (plan 06-03, calls wasRecentlyRequested/recordMagicLink)"
    - "app/auth/verify/route.ts (plan 06-03, calls consumeMagicLink/createSession)"
tech_stack:
  added:
    - "jose@6.2.3 — HS256 magic-link token sign/verify (pure Web Crypto, Edge-safe)"
    - "resend@6.12.3 — transactional email SDK (used in plan 06-03 for magic-link delivery)"
  patterns:
    - "postgres.js tagged-template parameterized SQL (no string concat, T-06-01)"
    - "Module-level sql singleton with prepare:false (Supavisor pooler, mirroring lib/jobs/store.ts)"
    - "Atomic UPDATE...WHERE used=false + rows.count (TOCTOU-free magic-link consume, D-07)"
    - "DB-backed rate-limit query with 60-second interval (D-09/AUTH-09)"
    - "node:crypto randomUUID for opaque session IDs (122-bit, T-06-03)"
key_files:
  created:
    - "scripts/setup-auth-tables.ts"
    - "lib/auth/store.ts"
    - "lib/auth/session.ts"
    - "tests/unit/auth/auth-store.test.ts"
  modified:
    - "package.json (added jose, resend, setup-auth-tables script)"
    - "bun.lock"
decisions:
  - "jose@6.2.3 and resend@6.12.3 verified legitimate before install (Task 1 checkpoint)"
  - "sql singleton exported from store.ts so session.ts shares it — no second postgres() client"
  - "consumeMagicLink uses atomic UPDATE rather than SELECT-then-UPDATE to prevent TOCTOU race"
  - "wasRecentlyRequested uses DB-backed 60s window (not in-memory Map) for serverless safety"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-22T17:45:07Z"
  tasks_completed: 3
  files_created: 4
  files_modified: 2
---

# Phase 6 Plan 01: Auth Foundation (Dependencies + DDL + CRUD Layer) Summary

**One-liner:** Supabase Postgres auth foundation — jose@6.2.3 + resend@6.12.3 installed; idempotent DDL for app.users/sessions/magic_links; typed CRUD layer (lib/auth/store.ts + session.ts) with atomic single-use token consume and DB-backed rate limiting.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Verify jose + resend package legitimacy | (checkpoint — no code) | — |
| 2 | Install jose + resend; create auth-tables DDL script | `29d7a3e` | `scripts/setup-auth-tables.ts`, `package.json`, `bun.lock` |
| 3 (RED) | Failing tests for lib/auth/store.ts + session.ts | `1a365c4` | `tests/unit/auth/auth-store.test.ts` |
| 3 (GREEN) | Implement lib/auth/store.ts + lib/auth/session.ts | `a096bd3` | `lib/auth/store.ts`, `lib/auth/session.ts`, `tests/unit/auth/auth-store.test.ts` |

## What Was Built

### Task 1: Package Legitimacy Checkpoint (APPROVED)

Task 1 was a `checkpoint:human-verify` gate (gate="blocking-human"). The orchestrator
performed verification before this executor was spawned:

- **jose@6.2.3** — `npm view jose repository.url` returned `git+https://github.com/panva/jose.git` (canonical `panva/jose` JOSE library, 11+ years old). `scripts.postinstall` is empty — no install-time code execution.
- **resend@6.12.3** — `npm view resend repository.url` returned `git+https://github.com/resend/resend-node.git` (official Resend SDK from resend.com). `scripts.postinstall` is empty.

Both packages confirmed canonical. Install proceeded with pinned versions: `bun add jose resend`.

### Task 2: Install + DDL Script

- `bun add jose resend` installed both packages at the verified 6.x versions.
- `scripts/setup-auth-tables.ts` created, mirroring `scripts/setup-jobs-table.ts` exactly:
  - `#!/usr/bin/env bun` shebang, `GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER` URL guard
  - `CREATE SCHEMA IF NOT EXISTS app` then three idempotent `CREATE TABLE IF NOT EXISTS` statements
  - `app.users` (id, email, brain_id, brain_slug, qbo_realm_id, qbo_tokens_encrypted, created_at)
  - `app.sessions` (id, user_id FK→app.users CASCADE, expires_at, created_at)
  - `app.magic_links` (jti PRIMARY KEY, email, used, used_at, expires_at, created_at)
  - Two indexes: `idx_sessions_user_id`, `idx_magic_links_email`
  - RLS-visibility probe: INSERT probe into app.users, SELECT from fresh connection, fail loudly on zero rows
  - Sanitized fatal handler strips `postgres://` URLs (T-06-02)
- `package.json` scripts block gets `"setup-auth-tables": "bun scripts/setup-auth-tables.ts"`

### Task 3: CRUD Layer (TDD — RED/GREEN)

**RED:** 33 structural tests written and confirmed failing (files did not exist).

**GREEN:** `lib/auth/store.ts` and `lib/auth/session.ts` implemented. All 33 tests pass.

`lib/auth/store.ts`:
- Module-level `sql` singleton exported (prepare:false, pooler-safe)
- `UserRow`, `SessionRow`, `MagicLinkRow` types reflecting DDL columns
- `getUserByEmail` — SELECT row | null
- `createUser` — INSERT...RETURNING with no-row guard
- `recordMagicLink` — INSERT into app.magic_links
- `consumeMagicLink` — **atomic** `UPDATE...WHERE used=false AND expires_at>now() RETURNING email`, checks `rows.count` (no SELECT-then-UPDATE; TOCTOU-free per D-07/T-06-05)
- `wasRecentlyRequested` — `SELECT 1 FROM app.magic_links WHERE email=... AND created_at > now() - interval '60 seconds'` (D-09/AUTH-09 rate limit, DB-backed for serverless safety)

`lib/auth/session.ts`:
- Imports `sql` from `./store` — zero second postgres() client
- `createSession(userId)` — `randomUUID()` (122-bit, T-06-03) + INSERT with 30-day expiry
- `validateSession(id)` — SELECT user_id WHERE not expired, returns string | null
- `destroySession(id)` — DELETE the row (true server-side revocation, AUTH-07)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TDD test regex too broad for postgres() in comments**
- **Found during:** Task 3 GREEN phase (first test run)
- **Issue:** The test `expect(sessionSource).not.toMatch(/postgres\s*\(/)` matched the string `postgres()` inside a JSDoc comment in session.ts, producing a false failure. The test intent was to verify no actual `postgres()` call/import, not to prohibit the word in comments.
- **Fix:** Updated the test to filter out comment lines before applying the regex, making the check precise to actual code invocations.
- **Files modified:** `tests/unit/auth/auth-store.test.ts`
- **Commit:** `a096bd3` (combined with GREEN implementation)

## Known Stubs

None. The CRUD layer is fully wired — all functions have real SQL bodies. The `qbo_realm_id` and `qbo_tokens_encrypted` columns are nullable per D-10; they are not stubs, they are intentional Phase 7 placeholders defined in the schema now (per the plan).

## Threat Surface Scan

No new network endpoints or auth paths beyond what the plan's `<threat_model>` covers. The files in this plan are pure data-access layer (no HTTP routes). All STRIDE mitigations applied:

| Threat | Status |
|--------|--------|
| T-06-01: SQL injection via string concat | Mitigated — all SQL uses postgres.js tagged templates |
| T-06-02: Info disclosure via DB errors | Mitigated — sanitized fatal handler in DDL script; no email/session logging in CRUD |
| T-06-03: Session fixation via guessable ID | Mitigated — `node:crypto.randomUUID()` (122-bit) |
| T-06-04: gbrain auto-RLS trigger on app tables | Mitigated — all three tables in `app` schema; RLS-visibility probe in DDL script |
| T-06-05: Magic-link double-consume (repudiation) | Mitigated — atomic UPDATE+rows.count; `used_at` audit field |
| T-06-SC: Package legitimacy | Mitigated — Task 1 blocking-human checkpoint approved both packages |

## Self-Check: PASSED

- `scripts/setup-auth-tables.ts` — FOUND
- `lib/auth/store.ts` — FOUND
- `lib/auth/session.ts` — FOUND
- `tests/unit/auth/auth-store.test.ts` — FOUND
- Commit `29d7a3e` — FOUND
- Commit `1a365c4` — FOUND
- Commit `a096bd3` — FOUND
- `bun x tsc --noEmit` — exits 0
- Full test suite (182 tests) — all pass
