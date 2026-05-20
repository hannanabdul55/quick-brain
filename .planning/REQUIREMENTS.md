# Requirements: QuickBrain

**Defined:** 2026-05-19 (v2.0 "Real-World Foundation")
**Core Value:** A non-technical small-business owner can connect their real business data and get a live, queryable business brain — useful answers about their own books — without ever touching a terminal, persistent across sessions.

Prior milestones (v1.0 "Demo", v1.1 "Beyond the Demo" — Phase 4 only) shipped. Their requirements (HARN, DATA, ONBD, CHAT, INSI, DEMO, SKIL) and the unexecuted v1.1 AUTH/QBO sets are archived in `.planning/archive/v1.x/REQUIREMENTS.md`. The v2.0 AUTH/QBO IDs below supersede the archived ones.

---

## v2.0 Requirements

Take QuickBrain from a single-laptop hackathon demo to a hosted multi-tenant product on Vercel + Supabase. Nine capability groups.

### TEST — Test harness + CI

- [ ] **TEST-01**: A Vitest runner is configured; `bun run test` executes the suite locally.
- [ ] **TEST-02**: The v1.x smoke scripts (mutex-smoke, concurrent-smoke, tenant-isolation, anomaly checks) are ported into proper Vitest tests.
- [ ] **TEST-03**: A GitHub Actions workflow runs typecheck + lint + tests on every push and PR and fails the build on any error.
- [ ] **TEST-04**: The `lib/audit` anomaly detector and `lib/insights` parsers have unit tests covering each anomaly type and the bullet-regex output contract.

### INFRA — gbrain on Supabase Postgres

- [ ] **INFRA-01**: The seed brain runs on Supabase Postgres — `gbrain migrate --to supabase` completes losslessly and `gbrain query` returns ranked results.
- [ ] **INFRA-02**: gbrain runtime queries use the Supavisor transaction pooler (port 6543, `prepare:false`); migrations/DDL use the direct connection (port 5432).
- [ ] **INFRA-03**: No database credential lives in any committed file — gbrain reads its connection from `GBRAIN_DATABASE_URL`, and brain `config.json` carries no plaintext secret.
- [ ] **INFRA-04**: The web app's gbrain client (`lib/gbrain/`) talks to the Postgres-backed brain instead of a local PGLite directory, and the existing demo flow still works end-to-end.
- [ ] **INFRA-05**: A documented, tested rollback path exists — `gbrain migrate --to pglite` restores a local brain if Supabase is unavailable.

### STOR — Durable brain-asset storage

- [ ] **STOR-01**: Binary brain assets (uploaded files) are stored in Supabase Storage via gbrain's `files` subsystem (configured by a `gbrain.yml`), not local disk.
- [ ] **STOR-02**: A storage abstraction (`lib/storage/`) handles asset read/write with a `STORAGE_BACKEND=local` fallback for local development.
- [ ] **STOR-03**: The app runs correctly on an ephemeral filesystem — it does not depend on a persistent writable local `brains/<slug>/` directory at runtime.

### INPROC — In-process gbrain refactor

- [ ] **INPROC-01**: `gbrain` is a SHA-pinned dependency in `package.json`; the app no longer relies on a `bun link`-ed `gbrain` binary on PATH.
- [ ] **INPROC-02**: `lib/gbrain/client.ts` runs queries via in-process gbrain library calls (`createEngine` + `hybridSearch`); no `child_process.spawn` of `gbrain` remains in the query path.
- [ ] **INPROC-03**: The in-process query pipeline replicates the CLI's multi-query expansion + RRF fusion, so result counts and ranking match the pre-refactor CLI behavior.
- [ ] **INPROC-04**: The chat synthesis path (`gbrain think`) runs in-process; the chat surface returns answers without shelling out.
- [ ] **INPROC-05**: The per-tenant concurrency model is re-evaluated for the in-process world (engine-connection management replaces subprocess serialization); the mutex-smoke regression test still passes.
- [ ] **INPROC-06**: The Phase 1 test suite stays green and the demo flow (onboarding → chat → insight cards) works end-to-end against in-process gbrain.

### DEPLOY — Vercel deploy + observability

- [ ] **DEPLOY-01**: The app is deployed to Vercel at a real URL, building from `main`.
- [ ] **DEPLOY-02**: All secrets (gbrain DB URL, OpenAI/Anthropic keys, Supabase keys, Resend key) live in Vercel's encrypted env config, never in the repo.
- [ ] **DEPLOY-03**: A `/api/health` endpoint reports app, gbrain database, and storage reachability.
- [ ] **DEPLOY-04**: Sentry captures unhandled server and client errors in the deployed app.
- [ ] **DEPLOY-05**: The deployed app stays within Vercel Hobby free-tier limits during development; the commercial-use upgrade to Pro is a documented, deliberate step tied to the first real user.

### JOBS — Background-job execution

- [ ] **JOBS-01**: gbrain operations that exceed the serverless function timeout (long imports, multi-step syncs) run as background jobs, not inline in a Route Handler.
- [ ] **JOBS-02**: The browser sees progress for a background job via SSE or polling — no silent multi-minute waits.
- [ ] **JOBS-03**: Operations that complete under the timeout still run inline; the inline-vs-job threshold is set from measured latency, not guessed.

### AUTH — Email auth + multi-tenant isolation

- [ ] **AUTH-01**: A user signs in with email only — a magic link is sent via Resend and clicking it establishes a session.
- [ ] **AUTH-02**: The magic link is single-use and time-limited; a second or expired click shows a clear message with a resend path.
- [ ] **AUTH-03**: A signed-in user persists across browser sessions and devices via a secure session cookie.
- [ ] **AUTH-04**: Each user has exactly one brain; signing in always routes them to their own brain, auto-provisioned on first sign-in.
- [ ] **AUTH-05**: A user's brain data cannot be read or queried by another user — isolation is enforced at the database layer via gbrain's row-level security.
- [ ] **AUTH-06**: Routes that expose tenant data require an authenticated session; unauthenticated requests are redirected to sign-in.
- [ ] **AUTH-07**: A user can sign out, ending the session.
- [ ] **AUTH-08**: The user store (email → brain mapping, session and magic-link records) lives in Supabase Postgres, not a local file.
- [ ] **AUTH-09**: Magic-link requests are rate-limited per email address to prevent abuse and email flooding.

### QBO — QuickBooks Online ingest

- [ ] **QBO-01**: A signed-in user connects their QuickBooks Online account via Intuit OAuth 2.0.
- [ ] **QBO-02**: OAuth access + refresh tokens and the realm ID are stored encrypted at rest.
- [ ] **QBO-03**: Connecting QBO ingests the user's invoices, vendors, and bank-statement-shaped transactions into their brain as markdown matching `docs/brain-schema.md`.
- [ ] **QBO-04**: The QBO ingest runs as a background job with visible progress in the browser.
- [ ] **QBO-05**: Expired access tokens are transparently refreshed; a revoked or failed connection surfaces a clear reconnect prompt.
- [ ] **QBO-06**: After ingest the user can ask questions in chat over their real QBO data, and `smb-audit` anomaly cards reflect that data.

### AUDIT — smb-audit scale validation

- [ ] **AUDIT-01**: The `smb-audit` skill runs correctly against a real-scale dataset (multi-year, thousands of invoices/transactions) without errors or timeouts.
- [ ] **AUDIT-02**: Anomaly-detection quality on real-scale data is measured and documented; any rule that degrades (false positives/negatives at scale) is flagged or fixed.
- [ ] **AUDIT-03**: The skill's real-scale runtime fits within the background-job execution model (JOBS).

### CLEAN — Hackathon-artifact removal

- [ ] **CLEAN-01**: `scripts/panic-reset.sh` and the demo-reset UI are removed — the hosted product has no destructive "wipe everything" control.
- [ ] **CLEAN-02**: The synthetic-data generator and committed Mara's Coffee dataset are removed from the runtime path (retained only if needed as a test fixture).
- [ ] **CLEAN-03**: The `AUTH_ENABLED=0` anonymous-demo bypass is removed — the hosted product always requires sign-in.
- [ ] **CLEAN-04**: Hackathon-specific UI copy and demo-script docs are removed or rewritten for the real product.
- [ ] **CLEAN-05**: `CLAUDE.md` is updated — the hackathon constraints and "what NOT to use" table are replaced with the v2.0 stack, conventions, and architecture.

---

## Future Requirements (deferred to v2.1+)

- Billing / Stripe subscriptions, pricing tiers — v2.0 ends at "a real user can use it".
- Landing page, marketing site, privacy policy / TOS, in-product help — go-to-market readiness (legal docs become a hard blocker once real QBO data flows; Intuit's developer agreement requires them).
- Additional connectors — Stripe, Gmail/Outlook vendor email, bank (Plaid/Teller). Same shape as QBO; ship QBO first.
- Team / sharing — owner + accountant accessing one brain; roles, invites.
- Account self-service data export + deletion (GDPR) — desirable; lands with go-to-market.

## Out of Scope (v2.0)

- ML-based anomaly detection — the rule-based `smb-audit` skill is sufficient and explainable.
- Charts library — typography + numbers carry the insight cards.
- RBAC / enterprise SSO — revisit when there are teams.
- Native mobile apps; mobile-responsive design pass.
- Real PDF rendering / OCR — QBO data arrives structured.
- Self-hosted / multi-region deploy — single-region Vercel + Supabase suffices.
- `gbrain serve --http` / custom MCP client — CLI shell-out is proven.

---

## Traceability

**Coverage:** 49 v2.0 requirements mapped across 10 phases. All requirements covered. (INPROC group + Phase 3 added 2026-05-20 per Spike 006; DEPLOY..CLEAN renumbered +1.)

| Requirement | Phase | Status |
|-------------|-------|--------|
| TEST-01 | Phase 1: Test Harness + CI | Planned (01-01-PLAN.md) |
| TEST-02 | Phase 1: Test Harness + CI | Planned (01-03-PLAN.md) |
| TEST-03 | Phase 1: Test Harness + CI | Planned (01-01-PLAN.md) |
| TEST-04 | Phase 1: Test Harness + CI | Planned (01-02-PLAN.md) |
| INFRA-01 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-01-PLAN.md) |
| INFRA-02 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-01-PLAN.md) |
| INFRA-03 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-01-PLAN.md) |
| INFRA-04 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-01-PLAN.md) |
| INFRA-05 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-01-PLAN.md) |
| STOR-01 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-02-PLAN.md) |
| STOR-02 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-02-PLAN.md) |
| STOR-03 | Phase 2: gbrain on Supabase + Asset Storage | Planned (02-02-PLAN.md) |
| INPROC-01 | Phase 3: In-Process gbrain Refactor | Planned (03-01-PLAN.md) |
| INPROC-02 | Phase 3: In-Process gbrain Refactor | Planned (03-01-PLAN.md, 03-02-PLAN.md) |
| INPROC-03 | Phase 3: In-Process gbrain Refactor | Planned (03-01-PLAN.md, 03-03-PLAN.md) |
| INPROC-04 | Phase 3: In-Process gbrain Refactor | Planned (03-02-PLAN.md) |
| INPROC-05 | Phase 3: In-Process gbrain Refactor | Planned (03-02-PLAN.md) |
| INPROC-06 | Phase 3: In-Process gbrain Refactor | Planned (03-03-PLAN.md) |
| DEPLOY-01 | Phase 4: Vercel Deploy + Observability | Pending |
| DEPLOY-02 | Phase 4: Vercel Deploy + Observability | Pending |
| DEPLOY-03 | Phase 4: Vercel Deploy + Observability | Pending |
| DEPLOY-04 | Phase 4: Vercel Deploy + Observability | Pending |
| DEPLOY-05 | Phase 4: Vercel Deploy + Observability | Pending |
| JOBS-01 | Phase 5: Background Jobs | Pending |
| JOBS-02 | Phase 5: Background Jobs | Pending |
| JOBS-03 | Phase 5: Background Jobs | Pending |
| AUTH-01 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-02 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-03 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-04 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-05 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-06 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-07 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-08 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| AUTH-09 | Phase 6: Auth + Multi-Tenant Isolation | Pending |
| QBO-01 | Phase 7: QuickBooks Online Ingest | Pending |
| QBO-02 | Phase 7: QuickBooks Online Ingest | Pending |
| QBO-03 | Phase 7: QuickBooks Online Ingest | Pending |
| QBO-04 | Phase 7: QuickBooks Online Ingest | Pending |
| QBO-05 | Phase 7: QuickBooks Online Ingest | Pending |
| QBO-06 | Phase 7: QuickBooks Online Ingest | Pending |
| AUDIT-01 | Phase 8: smb-audit Scale Validation | Pending |
| AUDIT-02 | Phase 8: smb-audit Scale Validation | Pending |
| AUDIT-03 | Phase 8: smb-audit Scale Validation | Pending |
| CLEAN-01 | Phase 9: Hackathon Artifact Removal | Pending |
| CLEAN-02 | Phase 9: Hackathon Artifact Removal | Pending |
| CLEAN-03 | Phase 9: Hackathon Artifact Removal | Pending |
| CLEAN-04 | Phase 9: Hackathon Artifact Removal | Pending |
| CLEAN-05 | Phase 10: CLAUDE.md + Codebase Hygiene | Pending |

---

*Requirements defined: 2026-05-19 (v2.0 "Real-World Foundation"). v1.x requirements archived in `.planning/archive/v1.x/REQUIREMENTS.md`.*
