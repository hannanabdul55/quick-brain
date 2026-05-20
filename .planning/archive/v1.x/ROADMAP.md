# Roadmap: QuickBrain

## Overview

QuickBrain ships in three end-to-end demoable slices over a 7.5-hour hackathon budget. Phase 1 builds the brain spine — the `gbrain` CLI harness plus a fully-seeded synthetic Mara's Coffee brain — and is demoable as a terminal smoke test. Phase 2 puts the web onboarding theater and chat surface on top of that spine, demoable as a full browser flow ending in a working question. Phase 3 adds the dashboard insight cards, the reset path, and the rehearsed 3-minute demo narrative that makes the build land for YC judges. Each phase is a runnable slice in isolation: if Phase 2 collapses, Phase 1 still demos via CLI; if Phase 3 collapses, Phase 2 still demos via web. Granularity is coarse per `config.json` — 3 phases, no finer.

**Milestone v1.1 "Beyond the Demo"** extends the roadmap with three additional phases (4-6) continuing the sequential numbering. Each v1.1 phase is MVP-slice demoable in isolation: Phase 4 can be demoed via CLI, Phase 5 can be demoed via browser sign-in landing on the v1.0 dashboard, and Phase 6 delivers the full QBO connect + sync + chat flow. Every v1.1 phase opens with a mandatory 30-minute spike (documented in `.planning/research/SUMMARY.md` "Open Spikes") before plan-code begins.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Brain Spine + Synthetic Seed** - End-to-end CLI slice — seeded gbrain answers "what was weird about last month?" naming all 3 planted anomalies
- [x] **Phase 2: Onboarding Theater + Chat** - End-to-end web slice — operator completes 60-second onboarding and asks a P0 question through the browser
- [x] **Phase 3: Insight Cards + Demo Readiness** - End-to-end demo slice — dashboard cards load with primitive labels, reset works, 3 back-to-back rehearsals pass
- [x] **Phase 4: smb-audit gbrain Skill** - Replace the v1.0 hand-rolled TS detector with a real gbrain skill, fix FIXTURES_ROOT hardcoding, and lock the canonical brain schema (completed 2026-05-19)
- [ ] **Phase 5: Email Magic-Link Auth + Persistent Tenants** - Email-only sign-in, per-user brain auto-provisioning, demo-path preserved under AUTH_ENABLED=0
- [ ] **Phase 6: QuickBooks Online Ingest** - QBO OAuth 2.0 → markdown transformer → gbrain import → smb-audit skill, full live-data path

## Phase Details

### Phase 1: Brain Spine + Synthetic Seed
**Goal:** A seeded gbrain instance running locally answers the three P0 demo questions correctly from the terminal, validating the entire data path before any UI exists.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** HARN-01, HARN-02, HARN-03, HARN-04, HARN-05, HARN-06, DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DATA-10, DATA-11
**Success Criteria** (what must be TRUE):
  1. Operator runs `scripts/demo-check.sh` and it exits 0 — `gbrain --version`, `gbrain doctor --fast`, both API keys, and write-access to `./brains/` are all confirmed.
  2. Operator runs `bun run seed` (or `scripts/seed.sh`) and a working `brains/seed/` directory is produced end-to-end (init → config → import → embed → anomaly detection) with three detectable planted anomalies (Beanstalk price hike, Square duplicate charge, ghost 7shifts SaaS).
  3. Operator runs `GBRAIN_HOME=brains/seed gbrain graph-query beanstalk-roasters --depth 2` from the terminal and sees ≥3 neighbors (invoices, the price-hike email, the anomaly concept page).
  4. Operator runs `GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"` from the terminal and gets a coherent answer naming all 3 planted anomalies in a single response.
  5. Operator runs the same `gbrain query` concurrently against the same brain through `lib/gbrain/client.ts` and the calls serialize via the in-process mutex queue with no PGLite lock errors.
**Plans:** 6 plans across 5 waves
- [ ] 01-01-PLAN.md — Bootstrap Next.js + Bun scaffolding, pre-declare all Phase 1 scripts, write scripts/demo-check.sh + README (HARN-01, HARN-02)
- [ ] 01-02-PLAN.md — lib/gbrain/ harness: spawnGBrain + mutex + slug + tenants + typed errors (HARN-03..06)
- [ ] 01-03-PLAN.md — Synthetic Mara's Coffee dataset + validate-dataset.ts (DATA-01..07)
- [ ] 01-04-PLAN.md — Hand-rolled anomaly detector (3 rules + CLI writing concept pages) (DATA-08)
- [ ] 01-05-PLAN.md — End-to-end scripts/seed.sh pipeline producing brains/seed/ (DATA-09, DATA-11)
- [ ] 01-06-PLAN.md — Smoke gate orchestrator + concurrent-smoke + anomaly assertion (DATA-10)

### Phase 2: Onboarding Theater + Chat
**Goal:** A non-technical operator can land on `/`, complete the onboarding flow, arrive on their dashboard within 60 seconds, and ask one of the three P0 questions — getting a real gbrain-backed answer with citations rendered as markdown.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-05, ONBD-06, ONBD-07, ONBD-08, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06
**Success Criteria** (what must be TRUE):
  1. Operator visits `/`, clicks the "Start your business brain" CTA, fills the 3-field form (business name, business type, owner name), and submits — no login, no API-key field, no payment screen appears anywhere in the flow.
  2. After submit, the browser plays a 30–45 second narrated SSE onboarding sequence with 5 honest stage labels ("Creating your brain → Reading your invoices and emails → Building the knowledge graph → Indexing for search → Ready"), with at least one real `gbrain query` warm-up call interleaved before the stream closes.
  3. Total wall-clock from form submit to interactive dashboard at `/dash/<tenantId>` is consistently between 30 and 60 seconds across 3 consecutive measurements on the demo laptop.
  4. Operator on the dashboard sees three hardcoded suggested-question chips, clicks "What was weird about last month?", and within ~30 seconds receives a markdown response with visible `[Source: ...]` citations naming all three planted anomalies.
  5. A query exceeding 30 seconds aborts cleanly and shows a graceful error message in the chat instead of hanging; the brain says "I don't have data on that" rather than guessing when asked about topics outside the synthetic dataset.
**Plans:** 6 plans across 4 waves
- [ ] 02-01-PLAN.md — Scaffold Next.js 15 + shadcn primitives + landing CTA + onboarding form skeleton (ONBD-01, ONBD-02, ONBD-08)
- [ ] 02-02-PLAN.md — POST /api/tenants Route Handler + createTenant domain (zod, cp -r seed, register, <2s) (ONBD-03)
- [ ] 02-03-PLAN.md — GET /api/tenants/[id]/onboard SSE + 5-stage orchestrator + gbrain --no-expand warm-up (ONBD-04, ONBD-05, ONBD-07)
- [ ] 02-04-PLAN.md — /onboard page full client flow: form → POST → EventSource → progress → redirect → error retry (ONBD-02, ONBD-04, ONBD-06, ONBD-07, ONBD-08)
- [ ] 02-05-PLAN.md — /dash/[id] dashboard + chat surface UI (3 hardcoded chips, message list, scroll area, input) (CHAT-01, CHAT-04)
- [ ] 02-06-PLAN.md — POST /api/tenants/[id]/chat SSE + react-markdown renderer + query() helper patched to --no-expand default (CHAT-02, CHAT-03, CHAT-05, CHAT-06)
**UI hint:** yes

### Phase 3: Insight Cards + Demo Readiness
**Goal:** The dashboard loads with three insight cards (top vendors, P&L snapshot, anomalies) each tagged with a visible gbrain-primitive label, the operator can reset state in under 10 seconds, and the full 3-minute demo runs back-to-back three times without errors or state leakage — `git tag demo-final` is committed.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** INSI-01, INSI-02, INSI-03, INSI-04, INSI-05, INSI-06, DEMO-01, DEMO-02, DEMO-03, DEMO-04, DEMO-05, DEMO-06
**Success Criteria** (what must be TRUE):
  1. Operator opens `/dash/<tenantId>` and within ~5 seconds sees three insight cards populated with real gbrain-backed data: "Top 5 vendors this quarter" (label: "from graph"), "Monthly P&L snapshot" with month-over-month delta (label: "from timeline"), and "Anomalies flagged" listing all 3 planted anomalies with dollar impacts and source links (label: "from skill: recurring-charges"). Each card visibly distinguishes loading, data, and error states.
  2. Operator presses-and-holds the dashboard Reset button for 2 seconds; in under 10 seconds the tenant brain is rebuilt from `brains/seed/`, in-flight spawns are killed, caches are cleared, and the dashboard reloads to a clean state.
  3. Operator runs `scripts/panic-reset.sh` from the terminal and the entire demo state (all tenants, caches, ports) resets in under 15 seconds without rebuilding the seed.
  4. Operator runs 3 consecutive end-to-end demos (onboarding → dashboard → 1 chat question → reset → repeat) back-to-back on the demo laptop with no errors, no state leakage between runs, and identical anomaly findings each time.
  5. `docs/DEMO-SCRIPT.md` exists with the 3-minute spoken script and names "graph", "timeline", and "skill" out loud at least 3 times each; a `git tag demo-final` is created with a panic-recovery pointer in the README.
**Plans:** 5 plans across 3 waves
- [ ] 03-01-PLAN.md — lib/insights/ pure-TS parsers (top-vendors, pnl, anomalies) + in-process cache + boot pre-warm (INSI-02, INSI-03, INSI-04, INSI-06, DEMO-03)
- [ ] 03-02-PLAN.md — GET /api/tenants/[id]/insights batch endpoint (INSI-01 server)
- [ ] 03-03-PLAN.md — Insight cards UI (TopVendors, PnL, Anomalies) + InsightCardsRow + mount above ChatSurface (INSI-01 client, INSI-02..05)
- [ ] 03-04-PLAN.md — Reset endpoint + abort tracker + press-and-hold ResetButton + scripts/panic-reset.sh (DEMO-01, DEMO-02)
- [ ] 03-05-PLAN.md — docs/DEMO-SCRIPT.md (3-min script) + README "Panic recovery" section (DEMO-04, DEMO-05, DEMO-06)
**UI hint:** yes

### Phase 4: smb-audit gbrain Skill
**Goal:** A user (or operator) runs `gbrain jobs submit smb-audit --follow` against any brain dir and the dashboard "Anomalies flagged" card renders all 4 anomaly types with severity badges populated from skill output, end-to-end.
**Mode:** mvp
**Depends on:** Phase 3
**Precondition:** 30-minute spike before plan-code: run `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --params '{"cmd":"echo hello","cwd":"<repo>"}' --follow` and confirm execution path + exit code surfacing; simultaneously verify `import { search, get_page } from '@gbrain/api'` resolves under Bun. If either fails, fall back to `bun skills/smb-audit/index.ts` invoked directly with `GBRAIN_HOME=…` — same observable outcome, simpler harness.
**Requirements:** SKIL-01, SKIL-02, SKIL-03, SKIL-04, SKIL-05, SKIL-06, SKIL-07, SKIL-08, SKIL-09, SKIL-10
**Success Criteria** (what must be TRUE):
  1. Operator runs `GBRAIN_HOME=brains/seed GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit smb-audit --follow` and the job completes without error, writing `concepts/march-anomaly-summary.md` and `concepts/recurring-charges.md` to `brains/seed/brain-repo/`.
  2. The "Anomalies flagged" insight card on the demo dashboard renders all 4 anomaly types (Beanstalk price-hike, Square duplicate, 7shifts ghost SaaS, and bank-debit-without-invoice) with `severity` badges and `dollar_impact` values drawn from skill-emitted frontmatter — not the v1.0 hand-rolled detector output.
  3. Two different tenant brain dirs (the demo seed and a fresh empty brain) yield different anomaly counts on the insight card — confirming the `FIXTURES_ROOT` hardcoding is removed from `lib/insights/cache.ts::computeAndCache` and parsers read from the active tenant's `brains/<brainSlug>/brain-repo/` directory.
  4. Re-running the skill against the same brain dir a second time produces byte-identical concept pages with no duplicate bullet lines, confirming idempotent output (SKIL-06).
  5. `docs/brain-schema.md` exists, documents the canonical frontmatter contract (`type`, `vendor`, `vendor_slug`, `date`, `amount`, `currency` plus skill output fields `severity`, `dollar_impact`, `anomaly_type`), and the `seed.sh` pipeline completes in under 10 seconds using the skill in place of the old detector script.
**Plans:** 4/4 plans complete
- [x] 04-01-PLAN.md — Skill scaffold + detector port (4 anomaly rules) + docs/brain-schema.md (SKIL-01..06, SKIL-08)
- [x] 04-02-PLAN.md — FIXTURES_ROOT → sourceDir refactor + tenant isolation test (SKIL-09)
- [x] 04-03-PLAN.md — seed.sh integration + smoke gate + dashboard end-to-end (SKIL-07, SKIL-10)
- [x] 04-04-PLAN.md — Typecheck + lint + deprecation marker + v1.0 demo regression check
**UI hint:** yes

### Phase 5: Email Magic-Link Auth + Persistent Tenants
**Goal:** An email-only signed-in user can persistently land on their own brain across browser sessions, the anonymous demo continues to work when `AUTH_ENABLED=0`, and the per-tenant mutex remains keyed by `brainSlug` (verified by a regression mutex-smoke test).
**Mode:** mvp
**Depends on:** Phase 4
**Precondition:** 30-minute spike before plan-code: send a real Resend email from a Route Handler to a test Gmail address and confirm primary-inbox delivery within 60 seconds. If it lands in spam, configure SPF/DKIM on the sending domain before building the flow.
**Requirements:** AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06, AUTH-07, AUTH-08, AUTH-09, AUTH-10, AUTH-11, AUTH-12, AUTH-13, AUTH-14
**Success Criteria** (what must be TRUE):
  1. A new user visits `/sign-in`, enters their email, receives a magic-link email via Resend within 5 seconds, clicks the link, and lands on `/dash/<brainSlug>` with a 30-day HttpOnly session cookie set — then reloads the page and is still signed in.
  2. The same magic-link URL cannot be redeemed a second time — second click shows "this link has already been used" with a send-fresh-link option, confirming the `magic_tokens.used` single-use guard is in place (AUTH-04).
  3. Running `scripts/panic-reset.sh` against a system with real users (`AUTH_ENABLED=1`) prints a confirmation prompt listing affected user emails and exits non-zero unless `--force-real-tenants` is passed, confirming the safety gate (AUTH-12).
  4. With `AUTH_ENABLED=0`, the anonymous `/onboard` flow completes end-to-end as in v1.0 without any sign-in redirect, confirming the demo path is fully preserved (AUTH-10).
  5. A regression mutex-smoke test runs 5 concurrent `gbrain query` calls against the same `brainSlug` with no PGLite lock contention errors, and the mutex key is typed as `BrainSlug` (branded TypeScript type) so that accidentally passing a `userId` is a compile-time error (AUTH-11).
**Plans:** 5/5 plans
- [ ] 05-01-PLAN.md — Auth foundation: jose helpers + bun:sqlite schema + BrainSlug branded type (AUTH-02, AUTH-06, AUTH-11)
- [ ] 05-02-PLAN.md — Send-link + verify + sign-out endpoints + Resend integration + rate limit (AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-07, AUTH-09)
- [ ] 05-03-PLAN.md — Sign-in/check-email/used pages + middleware + AUTH_ENABLED flag (AUTH-01, AUTH-04, AUTH-08, AUTH-09, AUTH-10)
- [ ] 05-04-PLAN.md — Ops hardening: panic-reset gate + demo-check env verification (AUTH-12, AUTH-13)
- [ ] 05-05-PLAN.md — Smoke gate: mutex-smoke regression + auth E2E + runbook (AUTH-11, AUTH-14)
**UI hint:** yes

### Phase 6: QuickBooks Online Ingest
**Goal:** A signed-in user clicks "Connect QuickBooks" → completes Intuit OAuth (sandbox) → sees a real-time SSE sync → asks "what was weird about last month?" in chat and receives a markdown answer that cites at least one `qbo-` sourced page.
**Mode:** mvp
**Depends on:** Phases 4 + 5
**Precondition:** 30-minute spike before plan-code: complete the QBO OAuth flow end-to-end with `intuit-oauth` against a sandbox account (authorize → callback → `tokenResponse.getJson()`), confirm `realmId` is present, and verify `qbo.findVendors({})` returns ≥1 vendor. If `intuit-oauth` has a Bun issue, fall back to raw `fetch` with `Authorization: Bearer`.
**Requirements:** QBO-01, QBO-02, QBO-03, QBO-04, QBO-05, QBO-06, QBO-07, QBO-08, QBO-09, QBO-10, QBO-11, QBO-12, QBO-13
**Success Criteria** (what must be TRUE):
  1. A signed-in user clicks "Connect QuickBooks", completes Intuit OAuth consent in the sandbox, and lands back on `/dash/<brainSlug>?qbo=connected` — with encrypted `access_token`, `refresh_token`, and `realm_id` persisted to the user's row in `bun:sqlite` (QBO-02).
  2. Initial sync streams SSE progress events to the browser, fetches ≥1 vendor and ≥3 invoices from QBO sandbox within 90 seconds, and the transformed markdown files (`companies/qbo-<slug>.md`, `originals/invoice-<id>.md`) appear in `brains/<brainSlug>/brain-repo/` with all canonical frontmatter fields (`type`, `vendor`, `vendor_slug`, `date`, `amount`, `currency`) populated (QBO-03, QBO-04, QBO-05).
  3. The user asks "what was weird about last month?" in chat and the response cites at least one `qbo-` sourced page, confirming the `smb-audit` skill produces ≥1 anomaly when run against QBO-sourced markdown with no parser modifications (QBO-07, schema-parity criterion).
  4. A user who has both demo seed data and QBO data sees no vendor-page collisions — `qbo-` prefixed slugs coexist with synthetic seed slugs in the same brain dir without any page overwriting another (QBO-06).
  5. `scripts/demo-check.sh` fails loudly if `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, or `QBO_ENV` are missing, and the same end-to-end flow against a synthetic-only (non-QBO) tenant continues to work unchanged (QBO-12, QBO-13).
**Plans:** TBD (target 6: OAuth flow + token encryption; transformer pure-functions + unit tests with fixture data; SSE sync endpoint + dashboard UI; refresh-token rotation + reconnect banner; CDC incremental sync + disconnect; smoke gate against sandbox)
**UI hint:** yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Brain Spine + Synthetic Seed | 6/6 | Passed | 2026-05-16 |
| 2. Onboarding Theater + Chat | 6/6 | Passed | 2026-05-16 |
| 3. Insight Cards + Demo Readiness | 5/5 | Passed (DEMO-04 operator-driven) | 2026-05-16 |
| 4. smb-audit gbrain Skill | 4/4 | Complete   | 2026-05-19 |
| 5. Email Magic-Link Auth + Persistent Tenants | 0/5 | Not started | - |
| 6. QuickBooks Online Ingest | 0/6 | Not started | - |

**Milestone v1.0:** PASSED — see `.planning/v1.0-MILESTONE-AUDIT.md` (42/42 reqs, 14/15 auto-verified must-haves, 1 operator-driven rehearsal gate).

---

## MVP-Slice Discipline (Per Phase)

Every phase must deliver an end-to-end runnable slice. If a later phase fails or is abandoned, the prior phase must remain demoable on its own:

- **Phase 1 demoable surface:** Terminal. `bun run seed` produces the seed brain; `gbrain query` against it answers correctly. No UI required.
- **Phase 2 demoable surface:** Browser. Full onboarding → chat flow. The Phase 1 CLI demo continues to work in parallel.
- **Phase 3 demoable surface:** Full 3-minute demo. The Phase 2 web flow continues to work without the insight cards if Phase 3 is incomplete.
- **Phase 4 demoable surface:** CLI. `gbrain jobs submit smb-audit --follow` produces concept pages; the v1.0 demo flow continues to work end-to-end.
- **Phase 5 demoable surface:** Browser. Sign-in flow ends at the existing v1.0 dashboard backed by the user's auto-provisioned brain (starts empty or copies seed depending on env config); anonymous demo path still works under `AUTH_ENABLED=0`.
- **Phase 6 demoable surface:** Browser. Full QBO connect + sync + chat over real data; synthetic-seed tenants continue to work alongside QBO tenants without any data collision.

v1.0 deferred items now resolved in v1.1: `SKIL-01` (custom gbrain skill) lands in Phase 4 as the SKIL-01..10 cluster; `DATA-12` (4th anomaly: missing-invoice) is folded into SKIL-03. Remaining v2 stretch — `CHAT-07/08/09`, `INSI-07/08/09`, `STRP-01`, `GMAIL-01`, `BRAIN-01/02/03` — stays out of v1.1 per `REQUIREMENTS.md`.

---

*Roadmap created: 2026-05-16 · Extended for v1.1: 2026-05-17*
