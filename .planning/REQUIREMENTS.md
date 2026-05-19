# Requirements: QuickBrain

**Defined:** 2026-05-16 (v1.0) · **Extended:** 2026-05-17 (v1.1 "Beyond the Demo")
**Core Value:** A non-technical small-business owner can go from zero to a live, queryable gbrain — with their own data — in under 60 seconds, without ever touching a terminal.

---

## v1.0 Requirements — SHIPPED

The hackathon scope. Delivered 2026-05-16 — see `.planning/v1.0-MILESTONE-AUDIT.md` (42/42 requirements, 14/15 must-haves auto-verified). Detail preserved in `.planning/research/v1.0-archive/`.

| Group | Count | Phase | Status |
|---|---|---|---|
| HARN — Brain Harness | 6 | Phase 1 | shipped |
| DATA — Synthetic Data | 11 | Phase 1 | shipped |
| ONBD — Onboarding | 8 | Phase 2 | shipped |
| CHAT — Chat | 6 | Phase 2 | shipped (CHAT-05 best-effort) |
| INSI — Insight Cards | 6 | Phase 3 | shipped |
| DEMO — Demo Readiness | 6 | Phase 3 | shipped (DEMO-04 operator-driven) |

---

## v1.1 Requirements — Beyond the Demo

The first post-hackathon milestone. Three pillars: replace the hand-rolled anomaly detector with a real gbrain skill, add email magic-link auth and persistent multi-tenant state, and ingest live QuickBooks Online data so a real SMB owner can answer questions over their own books.

### Custom gbrain Skill (SKIL)

The skill that replaces the hand-rolled TypeScript detector and finishes the v1.0 prize-narrative thread.

- [ ] **SKIL-01**: A `skills/smb-audit/` directory at the repo root contains a `SKILL.md` manifest and `scripts/smb-audit.mjs` runnable via `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit smb-audit --follow` against any brain dir.
- [ ] **SKIL-02**: The skill detects all three v1.0 anomaly types — Beanstalk-style price hike (>15% MoM vendor delta), Square-style duplicate charge (same vendor + amount within 14 days), 7shifts-style ghost SaaS (recurring monthly debit with no vendor email or invoice in >90 days) — by reading `originals/` and `companies/` pages in the active brain dir.
- [ ] **SKIL-03**: The skill detects a 4th anomaly type — bank-debit-without-invoice (a `bank-statement` line item with no matching `invoice` page for the same vendor + month) — fulfilling the v1.0 DATA-12 stretch.
- [ ] **SKIL-04**: The skill writes its findings to `concepts/march-anomaly-summary.md` and `concepts/recurring-charges.md` in a format byte-compatible with the existing `lib/insights/parsers/anomalies.ts` regex (`- YYYY-MM-DD: [[companies/<slug>]] <description>` bullet lines).
- [ ] **SKIL-05**: Every emitted anomaly bullet has a structured frontmatter sidecar entry (`severity: high|medium|low`, `dollar_impact`, `anomaly_type`, `vendor_slug`) that downstream insight cards can read without breaking the v1.0 parser contract.
- [ ] **SKIL-06**: Re-running the skill against the same brain dir produces deterministic concept-page output with no duplicate bullet lines and no stale findings from a prior run.
- [ ] **SKIL-07**: The skill is wired into `scripts/seed.sh` in place of the v1.0 `bun run scripts/detect-anomalies.ts` step, and the full seed pipeline still completes in under 10 seconds on the demo laptop.
- [ ] **SKIL-08**: A canonical schema document at `docs/brain-schema.md` documents the exact frontmatter fields (`type`, `vendor`, `vendor_slug`, `date`, `amount`, `currency`) and wikilink form (`[[companies/<slug>]]`) the skill consumes — this contract binds the QBO transformer (Phase 6).
- [ ] **SKIL-09**: `lib/insights/cache.ts::computeAndCache` accepts a `sourceDir` parameter and reads from the active tenant's `brains/<brainSlug>/brain-repo/` directory instead of the hardcoded `data/maras-coffee/` — every tenant sees its own anomalies, not Mara's. A fresh tenant brain yields different insight numbers than the demo brain.
- [ ] **SKIL-10**: A smoke gate passes before Phase 4 closes: skill runs against `brains/seed/`, writes concept pages, the dashboard "Anomalies flagged" card renders all 4 anomaly types with severity badges and dollar impacts populated from skill output.

### Authentication (AUTH)

Email magic-link sign-in with persistent multi-tenant state. No password, no SSO, no MFA.

- [ ] **AUTH-01**: A `/sign-in` page accepts an email address and POSTs to `/api/auth/send-link` which sends a magic-link email via Resend within 5 seconds.
- [ ] **AUTH-02**: The magic-link email contains a 15-minute expiry signed JWT (jose, ES256) in the URL fragment OR query param, branded with the QuickBrain header and a "did you not request this?" footer.
- [ ] **AUTH-03**: Clicking the link hits `/api/auth/verify`, verifies the JWT, atomically marks the `jti` as used in the `magic_tokens` table (`UPDATE … SET used=1 WHERE jti=? AND used=0` + rows-affected guard), sets a 30-day HttpOnly Secure SameSite=Lax session cookie, and redirects to `/dash/<brainSlug>`.
- [ ] **AUTH-04**: A single magic-link URL cannot be redeemed twice — second click shows "this link has already been used" with a path to send a fresh link.
- [ ] **AUTH-05**: Rate limiting: a given email address can request at most one magic link per 60 seconds; subsequent requests within the window return a friendly throttled message without sending a new email.
- [ ] **AUTH-06**: A `users` row exists per signed-up email with: `id`, `email`, `brain_slug`, `qbo_realm_id` (nullable), `qbo_tokens_encrypted` (nullable), `created_at`, `last_login_at` — stored in `bun:sqlite` at `data/quickbrain-app.sqlite`.
- [ ] **AUTH-07**: A user's first sign-in auto-provisions a `brain_slug` (UUID-prefixed, e.g. `u-7a2c-coffee`) and creates an empty `brains/<brain_slug>/` directory; subsequent sign-ins always route the user to the same brain.
- [ ] **AUTH-08**: `middleware.ts` protects `/dash/*` and `/api/qbo/*` — unauthenticated requests redirect to `/sign-in?next=<original-path>`.
- [ ] **AUTH-09**: A "Sign out" control on the dashboard hits `/api/auth/sign-out`, clears the session cookie, and redirects to `/`.
- [ ] **AUTH-10**: Demo path preserved — when `AUTH_ENABLED=0` (the default for the live demo VM), the anonymous `/onboard` flow continues to work exactly as v1.0; when `AUTH_ENABLED=1`, anonymous onboarding is disabled and `/` redirects to `/sign-in`.
- [ ] **AUTH-11**: `lib/gbrain/tenants.ts` adds a `userId` field to `TenantRecord`, but the per-tenant mutex remains keyed by `brainSlug` (not `userId`) — a branded TypeScript type (`type BrainSlug = string & { __brand: 'BrainSlug' }`) enforces this at the API surface to prevent silent PGLite lock contention regressions.
- [ ] **AUTH-12**: `scripts/panic-reset.sh` gates on `AUTH_ENABLED=0` or requires a `--force-real-tenants` flag — running it against a system with real users prints a confirmation prompt listing the user emails about to lose data and exits non-zero unless explicitly confirmed.
- [ ] **AUTH-13**: `scripts/demo-check.sh` is extended to verify `RESEND_API_KEY`, `JWT_SECRET`, and `TOKEN_ENCRYPTION_KEY` are present and at least 32 bytes each.
- [ ] **AUTH-14**: A smoke gate passes before Phase 5 closes: send-link → click-link → land on `/dash/<brainSlug>` → reload page → still signed in → sign out → `/dash/*` redirects to sign-in.

### QuickBooks Online Ingest (QBO)

Live SMB data instead of synthetic seed. OAuth 2.0 + Accounting API → markdown transformer → `gbrain import` → smb-audit skill.

- [ ] **QBO-01**: A "Connect QuickBooks" affordance on the signed-in dashboard kicks off an OAuth flow at `/api/qbo/connect` that redirects to Intuit's consent screen with scope `com.intuit.quickbooks.accounting`.
- [ ] **QBO-02**: `/api/qbo/callback` exchanges the auth code for tokens via `intuit-oauth`, stores the encrypted `access_token` + `refresh_token` + `realm_id` + `issued_at` on the user's row (AES-256-GCM via `node:crypto`, key from `TOKEN_ENCRYPTION_KEY`), and redirects to `/dash/<brainSlug>?qbo=connected`.
- [ ] **QBO-03**: Initial sync streams progress via SSE (same shape as v1.0 onboarding): fetches 12 months of `Vendor`, `Invoice`, `Bill`, and `Purchase` entities from QBO's Accounting API and pages through the results respecting the 500 req/min rate limit.
- [ ] **QBO-04**: `lib/qbo/transformer.ts` is a pure-function module mapping QBO entities to markdown files matching the canonical schema in `docs/brain-schema.md`: `Vendor → companies/qbo-<slug>.md`, `Invoice → originals/invoice-<id>.md`, `Bill → originals/bill-<id>.md`, `Purchase → originals/purchase-<id>.md`. All vendor cross-references use `[[companies/qbo-<slug>]]` wikilinks.
- [ ] **QBO-05**: Every transformed file's frontmatter includes the canonical fields (`type`, `vendor`, `vendor_slug`, `date`, `amount`, `currency`) so the existing insight parsers and the `smb-audit` skill work against QBO data without modification.
- [ ] **QBO-06**: The `qbo-` slug prefix on company pages prevents collision with synthetic seed slugs — a user can carry over the demo seed *and* connect QBO without any vendor page overwriting another.
- [ ] **QBO-07**: After the transformer writes files, the sync pipeline runs `gbrain import → smb-audit skill` through the existing per-tenant mutex; the dashboard refreshes insight cards and chat against the user's now-populated brain.
- [ ] **QBO-08**: Refresh tokens are persisted immediately after every token exchange (Intuit rotates refresh tokens every 24–26 hours since Nov 2025); a stale refresh-token write results in `invalid_grant` on the next call.
- [ ] **QBO-09**: When the access token age approaches the 100-day refresh-token expiry, the dashboard surfaces a "Reconnect QuickBooks" banner starting at day 86; the user can re-authorize without losing their imported markdown.
- [ ] **QBO-10**: A "Disconnect QuickBooks" affordance hits `/api/qbo/disconnect` which clears the OAuth record and revokes the token via Intuit's revoke endpoint, but leaves the imported markdown intact so the user can still chat over historical data.
- [ ] **QBO-11**: Incremental sync via QBO's CDC endpoint (`changedSince=<ISO8601>`, 30-day lookback) runs when the user clicks "Sync now" on the dashboard or on a scheduled interval; only changed entities are re-transformed.
- [ ] **QBO-12**: The QBO sandbox + production OAuth realms are switchable via the `QBO_ENV` env var (`sandbox|production`); demo-check.sh fails loudly if `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, and `QBO_ENV` aren't all set.
- [ ] **QBO-13**: A smoke gate passes before Phase 6 closes: sign in → connect QBO sandbox → initial sync of ≥1 vendor and ≥3 invoices completes within 90 seconds → ask "what was weird about last month?" in chat → response cites at least one `qbo-` source — and the same flow against a synthetic seed tenant continues to work unchanged.

---

## v2 Requirements

Deferred from v1.0 or scoped out of v1.1. Tracked but explicitly not in the v1.1 roadmap.

### Stretch — Chat polish (CHAT)

- **CHAT-07**: Vendor names in chat answers are inline-linked to their `companies/` pages; clicking opens a side panel showing the raw page.
- **CHAT-08**: Each chat response has a "Behind the scenes" expandable that shows the gbrain query payload, which pages were cited, and which graph edges were traversed.
- **CHAT-09**: Chat responses use a client-side typewriter visual (no backend change) that types the response at ~20 chars/interval.

### Stretch — Extra insight cards (INSI)

- **INSI-07**: A 4th insight card "Recurring subscriptions" lists every monthly recurring charge with last-used-on and cancel-likely flags.
- **INSI-08**: Anomaly card items carry severity badges (red / yellow / grey) based on `dollar_impact` thresholds — note: SKIL-05 now produces the underlying severity field, so this becomes a UI-only follow-up.
- **INSI-09**: Clicking an insight card prefills the chat with a relevant follow-up question.

### Stretch — More live connectors

- **STRP-01**: Stripe Connect ingest using the same transformer-shape contract as QBO (charges, payouts, refunds → `originals/`).
- **GMAIL-01**: Gmail OAuth + transactional-email scrape (invoices arriving as PDFs / inline HTML) → `originals/vendor-email-*.md`.

### Stretch — Brain ops (BRAIN)

- **BRAIN-01**: Per-user incremental sync schedule (cron-shaped) with last-synced-at surface.
- **BRAIN-02**: Multi-realm QBO support — a single user can carry multiple QuickBooks companies, each backed by its own brain dir.
- **BRAIN-03**: Account deletion UI that revokes OAuth tokens, deletes the user row, and purges the brain dir.

---

## Out of Scope

Explicit exclusions for v1.1. Each has a reason documented to prevent re-adding.

| Feature | Reason |
|---|---|
| Password auth, social SSO, 2FA | Magic-link is the cheapest path to a stable user identity; passwords add storage + reset flows for zero added value at v1.1 scale. |
| Live webhook ingestion from QBO | Poll-only is simpler and avoids exposing a public webhook URL; the user clicks "Sync now" or relies on the scheduled refresh. |
| Write-back to QuickBooks (creating invoices, marking paid, etc.) | QuickBrain is a brain *on top of* SMB books, not bookkeeping software. |
| QBO payroll, POS items, attachments / PDFs | Out of scope for v1.1 — Invoices + Bills + Vendors + Purchases cover the insight cards. |
| Raw bank-feed transactions ("For Review" items) | Not exposed by the Accounting API — `Purchase` / `Bill` / `Deposit` entities are the substitute. |
| ML-based anomaly detection | The rule-based `smb-audit` skill produces identical user-visible output and is easier to demo and explain. |
| Charts library (recharts, visx, chart.js) | Typography + numbers carry the insight cards; charts are still time we don't need to spend. |
| Multi-persona branching from a single account | One user, one tenant, one brain in v1.1. |
| Mobile responsive design | Desktop-first; mobile is its own design pass. |
| Custom MCP client / `gbrain serve --http` integration | CLI shell-out is simpler and proven; revisit only if external MCP-aware tools need to connect to a user's brain. |
| Replacement of QuickBooks / Xero | QuickBrain is a brain on top of SMB books, not the books themselves. |
| Native mobile apps | Web-first. |
| Real PDF rendering / OCR | QBO data arrives structured; OCR is a separate workstream. |
| Production billing, RBAC, enterprise SSO | Out of scope for v1.1; revisit when there are paying users. |
| Backups / disaster recovery beyond panic-reset | Per-tenant brain dirs are reproducible from the QBO sync; users can always re-sync. |
| Tests beyond smoke gates + transformer unit tests | Smoke gates per phase + transformer fixture-based unit tests are the verification bar for v1.1. |

---

## Traceability

Every v1.1 requirement maps to exactly one phase.

| Requirement | Phase | Status |
|---|---|---|
| SKIL-01 | Phase 4 | Pending |
| SKIL-02 | Phase 4 | Pending |
| SKIL-03 | Phase 4 | Pending |
| SKIL-04 | Phase 4 | Pending |
| SKIL-05 | Phase 4 | Pending |
| SKIL-06 | Phase 4 | Pending |
| SKIL-07 | Phase 4 | Pending |
| SKIL-08 | Phase 4 | Pending |
| SKIL-09 | Phase 4 | Pending |
| SKIL-10 | Phase 4 | Pending |
| AUTH-01 | Phase 5 | Planned |
| AUTH-02 | Phase 5 | Planned |
| AUTH-03 | Phase 5 | Planned |
| AUTH-04 | Phase 5 | Planned |
| AUTH-05 | Phase 5 | Planned |
| AUTH-06 | Phase 5 | Planned |
| AUTH-07 | Phase 5 | Planned |
| AUTH-08 | Phase 5 | Planned |
| AUTH-09 | Phase 5 | Planned |
| AUTH-10 | Phase 5 | Planned |
| AUTH-11 | Phase 5 | Planned |
| AUTH-12 | Phase 5 | Planned |
| AUTH-13 | Phase 5 | Planned |
| AUTH-14 | Phase 5 | Planned |
| QBO-01 | Phase 6 | Pending |
| QBO-02 | Phase 6 | Pending |
| QBO-03 | Phase 6 | Pending |
| QBO-04 | Phase 6 | Pending |
| QBO-05 | Phase 6 | Pending |
| QBO-06 | Phase 6 | Pending |
| QBO-07 | Phase 6 | Pending |
| QBO-08 | Phase 6 | Pending |
| QBO-09 | Phase 6 | Pending |
| QBO-10 | Phase 6 | Pending |
| QBO-11 | Phase 6 | Pending |
| QBO-12 | Phase 6 | Pending |
| QBO-13 | Phase 6 | Pending |

**Coverage:**
- v1.1 requirements: 37 total (SKIL: 10, AUTH: 14, QBO: 13)
- Mapped to phases: 37/37 (100%)

---

*Requirements defined: 2026-05-16 (v1.0). Extended for v1.1: 2026-05-17.*
