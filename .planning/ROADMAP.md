# Roadmap: QuickBrain

## Overview

QuickBrain started as a 7.5-hour hackathon demo (v1.0, Phases 1-3) and extended with a gbrain skill (v1.1, Phase 4). As of 2026-05-19 it pivots from a single-laptop demo to a hosted multi-tenant product. v2.0 "Real-World Foundation" resets phase numbering to 1 and delivers ten sequential capability layers: a regression net (TEST), gbrain migrated to Supabase Postgres with durable asset storage (INFRA + STOR), the app refactored to call gbrain in-process so it survives serverless (INPROC), a real Vercel deployment with observability (DEPLOY), background-job execution for long-running operations (JOBS), email magic-link auth with per-tenant isolation via per-user source-scoping (AUTH), live QuickBooks Online data ingest (QBO), smb-audit validated at real scale (AUDIT), hackathon artifacts removed (CLEAN x2). Each phase unblocks the next; nothing reaches a real user until AUTH gates the door.

## Milestones

- ✅ **v1.0 Demo** — Phases 1-3 (shipped 2026-05-18)
- ✅ **v1.1 smb-audit** — Phase 4 (shipped 2026-05-19)
- 🚧 **v2.0 Real-World Foundation** — Phases 1-10 (in progress; phase numbering reset)

## Phases

**Phase Numbering:** Reset to 1 for v2.0 (major version bump; supersedes archived v1.1 Phases 5-6).

- [x] **Phase 1: Test Harness + CI** — Vitest suite + GitHub Actions gate; regression net before the risky INFRA migration
- [x] **Phase 2: gbrain on Supabase + Asset Storage** — Migrate gbrain from PGLite to Supabase Postgres; wire binary-asset storage via gbrain's `files` subsystem; no credentials in committed files
- [x] **Phase 3: In-Process gbrain Refactor** — Replace `spawn("gbrain")` CLI shell-out with in-process library calls (`createEngine`/`hybridSearch`/`think`); SHA-pin gbrain as a dependency. Prerequisite for serverless (Spike 006)
- [x] **Phase 4: Vercel Deploy + Observability** — Real URL, secrets in Vercel config, `/api/health`, Sentry error tracking
- [ ] **Phase 5: Background Jobs** — Measure what exceeds the serverless timeout; route long work through Inngest (or equivalent) with visible browser progress
- [ ] **Phase 6: Auth + Multi-Tenant Isolation** — Email magic-link sign-in via Resend; per-user brain provisioning; isolation via per-user gbrain source-scoping
- [ ] **Phase 7: QuickBooks Online Ingest** — Intuit OAuth 2.0; ingest invoices/vendors/transactions into a per-tenant hosted brain as a background job
- [ ] **Phase 8: smb-audit Scale Validation** — Run smb-audit against real-scale QBO data; measure and fix quality or timeout regressions
- [ ] **Phase 9: Hackathon Artifact Removal** — Delete panic-reset, synthetic-data generator, AUTH_ENABLED bypass, and demo-specific copy
- [ ] **Phase 10: CLAUDE.md + Codebase Hygiene** — Update CLAUDE.md for the v2.0 stack; remove hackathon constraints; update architecture section

## Phase Details

<details>
<summary>✅ v1.0 Demo (Phases 1-3) + v1.1 smb-audit (Phase 4) — SHIPPED 2026-05-19</summary>

### Phase 1: Brain Spine + Synthetic Seed (v1.0)

**Goal:** A seeded gbrain instance running locally answers the three P0 demo questions correctly from the terminal.
**Plans:** 3/3 plans complete

### Phase 2: Onboarding Theater + Chat (v1.0)

**Goal:** A non-technical operator can complete onboarding and ask a P0 question through the browser.
**Plans:** 2/2 plans complete

### Phase 3: Insight Cards + Demo Readiness (v1.0)

**Goal:** Dashboard loads with three insight cards; 3 back-to-back rehearsals pass; `git tag demo-final` committed.
**Plans:** 2/3 plans executed

### Phase 4: smb-audit gbrain Skill (v1.1)

**Goal:** A real gbrain skill replaces the hand-rolled TS detector; FIXTURES_ROOT hardcoding removed; canonical brain schema locked.
**Plans:** 3/3 plans complete

Full detail for all v1.x phases: `.planning/archive/v1.x/ROADMAP.md`

</details>

---

### 🚧 v2.0 Real-World Foundation

**Milestone Goal:** A real SMB owner can sign up, connect their QuickBooks, and get a live queryable brain — persisted across sessions and devices — without touching a terminal.

---

### Phase 1: Test Harness + CI

**Goal**: A regression net exists before any risky infra changes — every push is automatically checked
**Depends on**: Nothing (first v2.0 phase)
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):

  1. `bun run test` runs the full suite locally and exits 0 on a clean codebase
  2. The v1.x smoke scripts (mutex, concurrent, tenant-isolation, anomaly checks) pass as proper Vitest tests
  3. `lib/audit` anomaly detector and `lib/insights` parsers have unit tests covering all four anomaly types and the bullet-regex output contract
  4. A GitHub Actions workflow fails any push or PR that has a typecheck error, lint error, or failing test

**Plans**: 3 plans
Plans:

- [x] 01-01-PLAN.md — Vitest setup + CI workflow (vitest.config.ts, package.json test scripts, tests/smoke.test.ts, .github/workflows/ci.yml)
- [x] 01-02-PLAN.md — Unit tests for lib/audit + lib/insights (anomaly detector pure functions, bulletRegex contract, pnl/top-vendors/frontmatter parsers)
- [x] 01-03-PLAN.md — Port smoke scripts to Vitest (mutex-smoke → unit test, tenant-isolation → CI-safe integration test, concurrent-smoke → opt-in RUN_INTEGRATION test)

### Phase 2: gbrain on Supabase + Asset Storage

**Goal**: gbrain's storage runs on Supabase Postgres + Supabase Storage; no credentials live in committed files; the demo flow works end-to-end
**Depends on**: Phase 1
**Precondition**: Supabase project provisioned (operator already has one); `SUPABASE_DB_URL_DIRECT` (port 5432) and `SUPABASE_DB_URL_POOLER` (port 6543) set in `.env.local` (gitignored). Spike 005 confirms the free tier is sufficient.
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, STOR-01, STOR-02, STOR-03
**Context** (Spike 005 — three gotchas must be addressed):

  - Gotcha 1: `gbrain migrate` writes the DB password into `<brain>/.gbrain/config.json` in plaintext. The prod brain config must use `GBRAIN_DATABASE_URL` env var; `config.json` must carry no plaintext secret.
  - Gotcha 2: Two connection strings, two jobs — direct (5432) for migration/DDL; Supavisor pooler (6543, `prepare:false`) for app runtime. gbrain accepts the pooler via `GBRAIN_DATABASE_URL`.
  - Gotcha 3: After `migrate --to supabase` the brain's `config.json` flips to `engine: postgres`. Plan migration as a one-shot; dev brains stay PGLite.
  - STOR scope: markdown pages live in Postgres post-migration (no object storage needed for them). Only binary assets need Supabase Storage, via gbrain's `files` subsystem + a `gbrain.yml`. The `lib/storage/` shim scope is narrower — a `STORAGE_BACKEND=local` fallback is still required for local dev.

**Success Criteria** (what must be TRUE):

  1. `gbrain migrate --to supabase` completes on the Supabase project; `gbrain doctor` reports pgvector + RLS + schema version all OK (matching Spike 005: 48/48 pages, 100% embeddings, schema v66)
  2. Runtime gbrain queries via `lib/gbrain/` use the Supavisor pooler; no DB credential appears in any committed file
  3. Binary brain assets (uploaded files) are stored in a Supabase Storage bucket via gbrain's `files` subsystem and a `gbrain.yml`, not local disk
  4. The existing demo flow (onboarding → seed brain → chat → insight cards) works end-to-end against Supabase Postgres
  5. `gbrain migrate --to pglite` successfully restores a local brain — the rollback path is documented and tested
  6. The app runs correctly with an ephemeral local filesystem; it does not depend on a persistent writable `brains/<slug>/` directory at runtime

**Plans**: 2 plans
Plans:

- [x] 02-01-PLAN.md — Migrate gbrain to Supabase Postgres (INFRA-01..05): run migration, sanitize config.json, inject GBRAIN_DATABASE_URL pooler into client.ts, update seed.sh, document rollback
- [x] 02-02-PLAN.md — Asset storage on Supabase Storage (STOR-01..03): write gbrain.yml, scaffold lib/storage/ shim with local fallback, ephemeral-FS audit, Phase 5 handoff doc

**UI hint**: no

### Phase 3: In-Process gbrain Refactor

**Goal**: The app calls gbrain in-process as a library — no `child_process.spawn` — so it can run on a serverless platform; query result quality matches the pre-refactor CLI behavior
**Depends on**: Phase 2
**Requirements**: INPROC-01, INPROC-02, INPROC-03, INPROC-04, INPROC-05, INPROC-06
**Context** (Spike 006 — VALIDATED):

  - The app currently does `spawn("gbrain", …)` in `lib/gbrain/client.ts`. The `gbrain` binary is `bun link`-ed (not a `package.json` dependency) and absent on serverless; gbrain also spawns a `bun` worker subprocess. This blocks the Vercel deploy.
  - Spike 006 confirmed gbrain has a first-class `exports` map and is built for library consumption: `createEngine` (`gbrain/engine-factory`) + `hybridSearch` (`gbrain/search/hybrid`) ran in-process against Supabase in 1.34s, no child process. The CLI is just one consumer of the same core.
  - Gotcha 1: bare `hybridSearch(engine, query)` lacks the CLI's multi-query expansion + RRF fusion (returned 1 result vs the CLI's 21). The refactor must replicate the CLI query pipeline (`gbrain/search/expansion` is exported) so result quality does not regress.
  - Gotcha 2: the chat surface uses `gbrain think` (LLM synthesis) — a separate in-process entry point that must be wired alongside `hybridSearch`.
  - Gotcha 3: gbrain is pre-1.0 (0.35.1) and moves fast. Pin it to a specific commit SHA in `package.json`; library import couples to gbrain's internal module API.

**Success Criteria** (what must be TRUE):

  1. `gbrain` is a SHA-pinned dependency in `package.json`; the app no longer relies on a `bun link`-ed binary on PATH
  2. `lib/gbrain/client.ts` runs queries via in-process `createEngine` + `hybridSearch`; no `child_process.spawn` of `gbrain` remains in the query path
  3. In-process query results match the pre-refactor CLI quality — query expansion is replicated, result counts and ranking are equivalent
  4. The chat `think` (synthesis) path runs in-process; the chat surface returns answers without shelling out
  5. The per-tenant concurrency model is re-evaluated for the in-process world (engine-connection management replaces subprocess serialization); the mutex-smoke regression test still passes
  6. The Phase 1 test suite stays green and the demo flow (onboarding → chat → insight cards) works end-to-end against in-process gbrain

**Plans**: 3 plans
Plans:

- [x] 03-01-PLAN.md — Pin gbrain as SHA-pinned dep + build in-process engine + queryInProcess with expansion pipeline (INPROC-01, INPROC-02, INPROC-03)
- [x] 03-02-PLAN.md — Rewrite client.ts query/think in-process; update chat route; re-evaluate mutex (INPROC-02, INPROC-04, INPROC-05)
- [ ] 03-03-PLAN.md — Integration test + full suite regression + end-to-end demo verification (INPROC-06)

**UI hint**: no

### Phase 4: Vercel Deploy + Observability

**Goal**: The app runs at a real public URL with secrets in Vercel config, error tracking active, and a health endpoint confirming all subsystems are reachable
**Depends on**: Phase 3
**Precondition**: Vercel project linked to this repo; operator authenticated with Vercel CLI (`vercel link` — done 2026-05-20, project `quickbrain`). The local `bun run build` + production server are a solved problem (debug session `gbrain-next-build-prod` resolved; commits 52be411, c49a927).
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03, DEPLOY-04, DEPLOY-05
**Success Criteria** (what must be TRUE):

  1. A `git push main` triggers a Vercel build; the app is reachable at a real URL
  2. All secrets (gbrain DB URLs, OpenAI/Anthropic keys, Supabase keys, Resend key) are in Vercel's encrypted env config; none appear in the repo
  3. `GET /api/health` returns a JSON payload reporting app, gbrain database, and Supabase Storage reachability — each subsystem individually flagged
  4. Sentry captures an unhandled server error and an unhandled client error; both surface in the Sentry dashboard
  5. The deployed app stays within Vercel Hobby free-tier limits; a documented decision records what triggers the Pro upgrade (first real/commercial user)

**Plans**: 3 plans
Plans:

- [x] 04-01-PLAN.md — GET /api/health three-subsystem probe (app / gbrain DB / Supabase Storage) with per-probe timeout isolation (DEPLOY-03)
- [x] 04-02-PLAN.md — @sentry/nextjs install (legitimacy-gated) + Next.js 15 instrumentation file set; withSentryConfig wrap preserving gbrain externalization; .env.example (DEPLOY-04)
- [x] 04-03-PLAN.md — Vercel deploy via Git integration: resolve runtime + file-tracing risks, load secrets into encrypted env config, live verification, Hobby/Pro decision doc (DEPLOY-01, DEPLOY-02, DEPLOY-05)

**UI hint**: no

### Phase 5: Background Jobs

**Goal**: gbrain operations that exceed the serverless timeout run as background jobs with visible browser progress; the inline-vs-job split is driven by measured latency, not guessed
**Depends on**: Phase 4
**Requirements**: JOBS-01, JOBS-02, JOBS-03
**Success Criteria** (what must be TRUE):

  1. The p95 latency of each gbrain operation (query retrieval, think synthesis, import) is measured and documented; the inline-vs-job threshold is set from this data
  2. Operations confirmed to exceed the timeout run as Inngest (or equivalent) background jobs, not inline in a Route Handler
  3. The browser receives real-time progress for a background job via SSE or polling — no silent multi-minute wait
  4. Operations that complete under the timeout continue to run inline with no latency overhead from job infrastructure

**Plans**: 5 plans
Plans:
**Wave 1**

- [x] 05-01-PLAN.md — Install Inngest (legitimacy-gated) + client singleton + serve route
- [x] 05-02-PLAN.md — Benchmark script (p50/p95 of query/think/import) + 300s threshold doc
- [x] 05-03-PLAN.md — Generic job contract: types/schema/registry + app.jobs table + Postgres store

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-04-PLAN.md — Generic Inngest function + POST trigger route + GET status polling route

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-05-PLAN.md — Bounded poll hook + JobProgress UI component + deployed-URL verification

**UI hint**: yes

### Phase 6: Auth + Multi-Tenant Isolation

**Goal**: A real user can sign in with email, have exactly one brain provisioned and persisted, and be certain no other user can reach their data
**Depends on**: Phase 4, Phase 5
**Precondition**: `RESEND_API_KEY` with a verified Resend sending domain (operator step); `JWT_SECRET` ≥32 bytes (`openssl rand -hex 32`); `TOKEN_ENCRYPTION_KEY` ≥32 bytes (for QBO token encryption, schema lands here). All must be in Vercel env config and `.env.local`.
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09
**Context** (Spike 005 + v1.x auth research):

  - Multi-tenant isolation uses per-user gbrain `source_id` partitioning + application-enforced scoping — **NOT gbrain RLS**. Phase 6 research (`06-RESEARCH.md` BLOCKING FINDING) found gbrain's auto-enabled RLS only denies the Supabase anon key (zero per-user policies); QuickBrain connects as the `BYPASSRLS` service role, so RLS provides no inter-tenant isolation. Each user's brain = one gbrain `sources` row; every query is hard-scoped to the session-derived `source_id`. gbrain's `think`/chat path is patched (`patch-package`) to accept the same scope.
  - Auth stack: `jose` (pure Web Crypto, no native bindings, works in middleware) + Supabase Postgres for user/session/token store (AUTH-08 requires this — not `bun:sqlite`, which was the local-demo choice). Resend for transactional email.
  - HS256 is the practical JWT algorithm for a single-server Next.js app; one `JWT_SECRET` env var vs. a key-pair. Upgrade to ES256 is a comment-documented path.

**Success Criteria** (what must be TRUE):

  1. A user enters their email on the sign-in page; a magic link arrives in their inbox via Resend within 5 seconds
  2. Clicking the link establishes a 30-day session cookie; a second or expired click shows a clear "already used" message with a resend path
  3. A signed-in user is routed to their own brain dashboard on every device and browser session; the brain is auto-provisioned on first sign-in
  4. Route handlers and pages that expose tenant data redirect unauthenticated requests to sign-in
  5. A test confirms User A cannot query, read, or list any data belonging to User B — cross-tenant access is blocked by session-derived source-scoping (every gbrain query hard-scoped to the user's `source_id`)
  6. A user can sign out; accessing a protected link after sign-out redirects to sign-in
  7. More than one magic-link request per email per 60 seconds is rate-limited; the email is not sent again

**Plans**: 5 plans
Plans:
**Wave 1**

- [x] 06-01-PLAN.md — Supabase Postgres app store: jose+resend installs (legitimacy-gated), app.users/sessions/magic_links DDL, lib/auth/store.ts + session.ts (AUTH-08)
- [x] 06-02-PLAN.md — gbrain source-scoping: patch-package + committed patch threading sourceId through gbrain think; shim + engine/client sourceId plumbing (AUTH-05 foundation)

**Wave 2** *(blocked on 06-01)*

- [ ] 06-03-PLAN.md — Magic-link auth backend: tokens, Resend email, resolve-tenant chokepoint, send-link/verify/sign-out routes, per-user brain provisioning (AUTH-01, AUTH-02, AUTH-04, AUTH-09)

**Wave 3** *(blocked on 06-03)*

- [ ] 06-04-PLAN.md — middleware coarse gate, sign-in/link-used pages, sign-out button, landing CTA, dashboard session gate, Postgres-backed tenant registry (AUTH-03, AUTH-06, AUTH-07, AUTH-04)

**Wave 4** *(blocked on 06-02, 06-03, 06-04)*

- [ ] 06-05-PLAN.md — Session-scoped gbrain calls across all tenant routes, engine-pool fix, AUTH-05 cross-tenant isolation test, deployed-URL verification (AUTH-05)

**UI hint**: yes

### Phase 7: QuickBooks Online Ingest

**Goal**: A signed-in user can connect their QuickBooks Online account and have their invoices, vendors, and transactions ingested into their hosted brain as a background job with visible progress; chat and smb-audit reflect real QBO data
**Depends on**: Phase 6, Phase 5
**Precondition**: An Intuit developer app (sandbox) with `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, and `QBO_REDIRECT_URI` — **operator does not have these yet; registering at developer.intuit.com is a required operator step before this phase can be planned.** Add to Vercel env config and `.env.local`.
**Requirements**: QBO-01, QBO-02, QBO-03, QBO-04, QBO-05, QBO-06
**Context**:

  - Spike 002a confirmed QBO as the right first connector (highest US SMB market share, longest refresh tokens, best raw throughput).
  - `docs/brain-schema.md` (defined in v1.1 Phase 4) is the hard ingest contract; the QBO transformer must produce markdown matching it.
  - Connector-agnostic types (`Bill`, `Vendor`, `BankLine`) in `lib/connectors/types.ts` from Spike 002a avoid retro-fit cost when Xero is added later.
  - OAuth tokens must be encrypted at rest; `TOKEN_ENCRYPTION_KEY` precondition is established in Phase 5.

**Success Criteria** (what must be TRUE):

  1. A signed-in user clicks "Connect QuickBooks"; completing Intuit OAuth links the account and stores encrypted access token, refresh token, and realm ID in Supabase Postgres
  2. After connecting, a background job ingests the user's invoices, vendors, and bank-statement-shaped transactions; the browser shows real progress, not a silent wait
  3. The user can ask questions in chat over their real QBO data; `smb-audit` anomaly cards reflect that data
  4. When the access token expires it is transparently refreshed; a revoked or failed connection surfaces a clear reconnect prompt
  5. Subsequent syncs correctly update changed records without creating duplicates

**Plans**: TBD
**UI hint**: yes

### Phase 8: smb-audit Scale Validation

**Goal**: The smb-audit skill is confirmed correct and performant against real-scale QBO data (multi-year, thousands of rows) before the product is opened to real users
**Depends on**: Phase 7
**Requirements**: AUDIT-01, AUDIT-02, AUDIT-03
**Success Criteria** (what must be TRUE):

  1. The `smb-audit` skill completes without errors or timeouts against a real-scale dataset (minimum: multi-year, 1000+ invoices/transactions)
  2. Anomaly-detection quality (false positive and false negative rate per rule type) is measured and documented for the real-scale run; any rule that materially degrades at scale is fixed or flagged with a known-limitation note
  3. The skill's real-scale runtime fits within the background-job model established in Phase 4 — it does not require inline execution above the measured timeout threshold

**Plans**: TBD
**UI hint**: no

### Phase 9: Hackathon Artifact Removal

**Goal**: Every shortcut added for the hackathon demo is removed; the hosted product always requires sign-in and carries no destructive controls
**Depends on**: Phase 6 (the `AUTH_ENABLED=0` bypass can only be safely removed once real auth is live and verified)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04
**Success Criteria** (what must be TRUE):

  1. `scripts/panic-reset.sh` and any demo-reset UI controls are deleted; no destructive "wipe everything" path exists in the deployed product
  2. The synthetic Mara's Coffee dataset and synthetic-data generator are removed from the runtime path; the app no longer references them except optionally as test fixtures
  3. The `AUTH_ENABLED=0` code path is deleted; the deployed app always requires sign-in with no bypass
  4. Hackathon-specific UI copy (demo instructions, demo-script references, "Mara's Coffee" persona strings) is removed or rewritten for the real product

**Plans**: TBD
**UI hint**: yes

### Phase 10: CLAUDE.md + Codebase Hygiene

**Goal**: CLAUDE.md accurately describes the v2.0 stack, conventions, and architecture; a developer following it alone can run, extend, and deploy the app correctly
**Depends on**: Phase 9 (all hackathon artifacts must be removed before CLAUDE.md is updated, so the documented stack matches reality)
**Requirements**: CLEAN-05
**Success Criteria** (what must be TRUE):

  1. CLAUDE.md's technology stack, constraints, and architecture sections reflect the live v2.0 system (Vercel + Supabase + Supabase Storage + Inngest + Resend + real auth) — no references to PGLite runtime, the 7.5-hour hackathon timeline, or the single-laptop demo remain
  2. The hackathon "What NOT to Use" table is replaced with v2.0-specific conventions (patterns to follow, anti-patterns to avoid, and why)
  3. A developer following CLAUDE.md alone can understand how to run, extend, and deploy the app correctly without reading archived docs

**Plans**: TBD
**UI hint**: no

---

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Test Harness + CI | v2.0 | 3/3 | Complete | 2026-05-20 |
| 2. gbrain on Supabase + Asset Storage | v2.0 | 2/2 | Complete | 2026-05-20 |
| 3. In-Process gbrain Refactor | v2.0 | 2/3 | In Progress|  |
| 4. Vercel Deploy + Observability | v2.0 | 3/3 | Complete   | 2026-05-21 |
| 5. Background Jobs | v2.0 | 5/5 | Complete   | 2026-05-22 |
| 6. Auth + Multi-Tenant Isolation | v2.0 | 2/5 | In Progress|  |
| 7. QuickBooks Online Ingest | v2.0 | 0/TBD | Not started | - |
| 8. smb-audit Scale Validation | v2.0 | 0/TBD | Not started | - |
| 9. Hackathon Artifact Removal | v2.0 | 0/TBD | Not started | - |
| 10. CLAUDE.md + Codebase Hygiene | v2.0 | 0/TBD | Not started | - |

v1.x phases (shipped): see `.planning/archive/v1.x/ROADMAP.md`.

---

*Roadmap created: 2026-05-16 · Extended for v1.1: 2026-05-17 · v2.0 phases defined (numbering reset): 2026-05-20 · Phase 4 replanned: 2026-05-20 · Phase 6 planned: 2026-05-22*
