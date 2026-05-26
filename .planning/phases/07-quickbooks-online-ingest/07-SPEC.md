# Phase 7: QuickBooks Online Ingest — Specification

**Created:** 2026-05-26
**Ambiguity score:** 0.14 (gate: ≤ 0.20)
**Requirements:** 8 locked

## Goal

A signed-in QuickBrain user connects a QuickBooks Online **sandbox** account via Intuit OAuth 2.0 and, within a single phase-labeled background job, has the last 12 months of QBO invoices, vendors, and bank-line transactions written into their per-tenant brain as markdown matching `docs/brain-schema.md`; immediately after, their chat returns answers grounded in that QBO data and `smb-audit` runs end-to-end against the qbo-prefixed slugs without error.

## Background

**What exists today** (from Phase 1–6 ship):
- Per-user brain directories: `brainHome(brainSlug)/brain-repo/` is provisioned on first sign-in (Phase 6, `lib/auth/provision.ts`).
- Background-job platform: Inngest + `app.jobs` table + generic `lib/jobs/` registry + `<JobProgress>` UI component (Phase 5; complete).
- Encrypted-at-rest pattern: `TOKEN_ENCRYPTION_KEY` env is established (Phase 5); reused for OAuth token storage in this phase.
- gbrain source-scoping: every chat/insights call is hard-scoped to the session-derived `sourceId` (Phase 6 patched gbrain). New QBO docs ingested into a user's brain are automatically isolated to that user.
- Brain schema contract: `docs/brain-schema.md` locks the QBO field mapping table (lines 209–223): `TxnDate → date`, `TotalAmt → amount`, `VendorRef.name → vendor`, slugified `→ vendor_slug`, wikilinks `[[companies/qbo-<slug>]]`, vendor pages have `slug: qbo-<slug>` so the ghost-saas rule can resolve them.
- Insights route already handles the no-data case gracefully (06-06 gap closure): a tenant with no `originals/` returns a 200 empty bundle and `PnlCard` renders "No P&L data yet". After QBO ingest writes the first invoice, the next insights request hits the real compute path with zero additional changes.
- Spike 002 verdict: QBO over Xero/Wave/FreshBooks for v1.x. Spike 002a/findings dictate `lib/connectors/qbo/` (not `lib/qbo/`) and connector-agnostic types in `lib/connectors/types.ts` from day one.

**What does NOT exist** (the delta this phase closes):
- `lib/connectors/` directory and connector-agnostic types.
- Any Intuit OAuth client wiring, redirect handler, or token store.
- A `qbo_connections` Postgres table (encrypted tokens + realm_id + last_synced_at, keyed by user_id).
- A QBO API client + QBO→brain-markdown transformer.
- A connect-QBO call-to-action on the dashboard and a `/connections/quickbooks` reconnect page.
- A QBO-ingest Inngest job that walks Vendor + Invoice + Purchase + BankAccount endpoints and writes markdown into `brainHome(slug)/brain-repo/originals/` and `companies/`.
- A reconnect banner that surfaces when a tenant's stored connection is revoked or its refresh-token chain breaks.

**Operator precondition** (not engineering scope but required before this phase ships):
- Register an Intuit Developer app in **sandbox** mode at developer.intuit.com to obtain `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`. Set these in Vercel env config (Preview + Production) and `.env.local`. Production-app review is **out of scope** for this phase.

## Requirements

1. **OAuth connect (QBO-01)**: A signed-in user clicks "Connect QuickBooks" on the dashboard and completes Intuit's sandbox OAuth 2.0 flow.
   - Current: No connect UI exists. No OAuth client.
   - Target: A "Connect QuickBooks" button on `/dash/<slug>` initiates Intuit OAuth (Authorization Code grant). After consent, Intuit redirects to `/api/connections/quickbooks/callback`, which exchanges the code for access + refresh tokens, persists them, and redirects the user to a "Sync in progress" screen.
   - Acceptance: With sandbox credentials configured, a signed-in user completing OAuth lands on the post-connect screen and a row exists in `app.qbo_connections` for their `user_id` with non-null encrypted `access_token`, `refresh_token`, and `realm_id`.

2. **Encrypted token storage (QBO-02)**: Access + refresh tokens and the realm ID are stored encrypted at rest in Postgres, never logged, and never returned in API responses.
   - Current: No `qbo_connections` table. No connector token storage code.
   - Target: `app.qbo_connections (user_id uuid primary key, realm_id text, access_token_encrypted bytea, refresh_token_encrypted bytea, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz, last_synced_at timestamptz, status text)` exists. All token columns are AES-GCM encrypted with `TOKEN_ENCRYPTION_KEY` (the same key Phase 5 established). The encryption helper lives in `lib/connectors/crypto.ts`.
   - Acceptance: A `SELECT access_token_encrypted FROM app.qbo_connections WHERE user_id = ...` returns bytes whose UTF-8 decoding is NOT a valid JWT/opaque token. A grep across the codebase for log/console statements that reference token fields returns zero matches. No HTTP response body anywhere in `app/api/connections/quickbooks/**` contains the token plaintext (verified by integration test).

3. **QBO→brain transformer (QBO-03 part 1)**: A pure function transforms QBO API entities into markdown matching `docs/brain-schema.md`.
   - Current: No transformer exists.
   - Target: `lib/connectors/qbo/transformer.ts` exports pure functions that map QBO `Vendor`, `Bill`, `Invoice`, and `Purchase` entities to brain markdown documents using the field mapping locked in `docs/brain-schema.md` lines 209–223. Connector-agnostic types live in `lib/connectors/types.ts` (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`). Vendor slugs are prefixed `qbo-`; wikilinks use `[[companies/qbo-<slug>]]`.
   - Acceptance: Given a fixture set of QBO API responses (committed under `tests/fixtures/qbo/`), the transformer produces markdown that round-trips through the existing `lib/insights/anomalies.ts` and `lib/insights/top-vendors.ts` parsers without throwing. Vendor pages created carry `type: vendor` + `slug: qbo-<slug>` so `smb-audit`'s ghost-saas rule can resolve them.

4. **Initial-load ingest job (QBO-03 part 2 + QBO-04)**: Ingestion runs as an Inngest background job that walks the last 12 months of the user's QBO data and writes the resulting markdown into their per-tenant brain.
   - Current: No QBO job. No QBO API client. No ingest pipeline.
   - Target: A `qbo.ingest` Inngest function (`lib/jobs/qbo/ingest.ts`) is triggered by the OAuth callback. It uses a QBO API client (`lib/connectors/qbo/client.ts`) to fetch all `Vendor`s, then all `Bill`s + `Invoice`s + `Purchase`s with `TxnDate >= today - 12 months`, transforms them, and writes the resulting `.md` files into `brainHome(slug)/brain-repo/originals/` and `companies/`. After writing, it calls the gbrain ingest pipeline so embeddings are populated.
   - Acceptance: For an Intuit sandbox company with N invoices in the last 12 months, the job completes and `ls brainHome(<slug>)/brain-repo/originals/qbo-*.md | wc -l` equals N. The job's final status in `app.jobs` is `succeeded`.

5. **Initial-load + user-triggered resync only — no incremental sync (boundary)**: Subsequent syncs are **wipe-and-reingest**, not incremental.
   - Current: No sync code at all.
   - Target: A "Re-sync from QuickBooks" button on `/connections/quickbooks` deletes every file matching `qbo-*.md` in the tenant's `originals/` and `companies/` directories, then re-runs the same ingest job. There is **no** delta-query / CDC / change-token logic, **no** per-entity idempotency keys, **no** scheduled background resync.
   - Acceptance: Clicking "Re-sync" while the same sandbox data is present produces the same final file count (per requirement 4). Modifying one fixture invoice's `TotalAmt`, then re-syncing, results in the markdown file's `amount:` frontmatter matching the modified value (because the file was deleted and rewritten, not patched).

6. **Phase-labeled progress UX (QBO-04 part 2)**: The user sees ≥ 3 distinct named-phase status messages plus a terminal "Sync complete" line.
   - Current: Phase 5's `<JobProgress>` component streams arbitrary status text via the Postgres-backed jobs table; no QBO-specific labels exist.
   - Target: The ingest job writes status messages at four discrete phases: `"Connecting to QuickBooks..."`, `"Fetching vendors (X found)"`, `"Fetching invoices (Y of Z)"`, `"Writing brain documents..."`, then a terminal `"Sync complete"` message. The post-connect screen renders these via the existing `<JobProgress>` component.
   - Acceptance: An end-to-end test that triggers the job and reads the `app.jobs.status_history` (or equivalent) for the run finds ≥ 4 distinct status messages plus a final "Sync complete". Manual test: the post-connect screen visibly cycles through ≥ 3 different labels (no flicker, no single-spinner-forever state).

7. **Chat + smb-audit + insights work on QBO data (QBO-06)**: After ingest completes, all three read paths produce non-empty output for the connected tenant.
   - Current: Chat already source-scopes to the session brain (Phase 6); insights already handles populated brains; smb-audit already exists as a gbrain skill. None has ever been exercised against QBO-shaped data.
   - Target:
     - Chat: a question like "What were my top vendors this month?" returns a real gbrain answer that cites a QBO-prefixed vendor.
     - Insights API: `GET /api/tenants/<slug>/insights` returns 200 with `topVendors.length > 0`, a non-null `pnl`, and (if the sandbox data warrants) anomalies whose `vendor_slug` starts with `qbo-`.
     - smb-audit (Phase 4 skill): invoking the skill against the tenant's `GBRAIN_HOME` runs to exit 0 and writes ≥ 1 file under `brainHome(slug)/brain-repo/concepts/`. The skill is NOT required to detect specific anomalies — only to run end-to-end without error against qbo-prefixed slugs. **Anomaly-correctness validation is Phase 8 scope.**
   - Acceptance: After a successful sandbox ingest, all three of the above produce the expected outputs. Verified by integration test (CI-safe with fixtures) plus a manual sandbox run before sign-off.

8. **Reconnect UX on token failure (QBO-05)**: When the stored connection cannot be refreshed (revoked at Intuit, refresh-token expired beyond 100 days, or any non-transient OAuth error), the dashboard shows a persistent reconnect banner; on-demand API failures surface a typed `connector_revoked` error.
   - Current: No connection-status concept exists.
   - Target: `lib/connectors/qbo/client.ts` performs transparent access-token refresh on 401 from QBO, persisting the rotated refresh_token immediately. If refresh itself fails with `invalid_grant` (or any 400-class OAuth error), the client marks `app.qbo_connections.status = 'revoked'` for that user. The dashboard layout reads the connection status and, when `revoked`, renders a yellow banner with "Reconnect QuickBooks" CTA linking to `/connections/quickbooks`. Insights/chat API routes return `{error: "connector_revoked"}` with status 409 when called against a revoked connection. **No email notification.**
   - Acceptance: Manually revoking the sandbox connection at Intuit and refreshing the dashboard renders the banner. Clicking the CTA restarts the OAuth flow and, after success, the banner disappears on next dashboard render. `/api/tenants/<slug>/insights` against the revoked connection returns 409 with the typed error (not 500, not the empty bundle).

## Boundaries

**In scope:**
- Intuit OAuth 2.0 against Intuit's **sandbox** environment (sandbox app credentials).
- Encrypted storage of access_token + refresh_token + realm_id, keyed by `user_id`.
- Transparent access-token refresh on 401; immediate persistence of rotated refresh_token; revoked-status detection.
- QBO API client for Vendor, Invoice, Bill, Purchase endpoints (whichever combination yields the bank-line shape locked in `docs/brain-schema.md`).
- Pure transformer producing brain markdown that satisfies `docs/brain-schema.md` (including `qbo-` slug prefixing and `companies/qbo-<slug>.md` vendor pages with `type: vendor` + `slug: qbo-<slug>`).
- Connector-agnostic shared types in `lib/connectors/types.ts` (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`).
- Connector-specific code under `lib/connectors/qbo/` (not `lib/qbo/`).
- Inngest background job that runs the last-12-months initial-load ingest end-to-end.
- "Connect QuickBooks" CTA on `/dash/<slug>`; post-connect "Sync in progress" screen using existing `<JobProgress>`.
- `/connections/quickbooks` page with current connection status, last-synced timestamp, "Re-sync" button, and "Disconnect" button.
- Reconnect banner on the dashboard when status is `revoked`; typed `connector_revoked` API error on insights/chat routes.
- Integration tests using committed QBO API fixtures under `tests/fixtures/qbo/`.

**Out of scope:**
- **Intuit production-app review and production-mode OAuth** — multi-week Intuit approval process, blocked on legal docs (privacy policy / TOS); a follow-up phase ships this.
- **Incremental sync (QBO CDC, change tokens, per-entity idempotency keys)** — explicitly traded away for ship-speed; re-sync is wipe-and-reingest. Future incremental-sync phase will replace requirement 5.
- **Historical backfill beyond 12 months** — first sync ingests trailing 12 months only; an older-history backfill is a separate later action.
- **Scheduled / cron-triggered automatic resync** — every resync is user-initiated.
- **Email notifications on connection failure** — banner + reconnect page only.
- **Additional connectors (Xero, Stripe, Plaid, vendor email)** — spike 002 says Xero is v1.2; the others are explicitly excluded from v2.0.
- **smb-audit anomaly-correctness validation against QBO data** — Phase 7 only requires smb-audit runs end-to-end against qbo-prefixed slugs; Phase 8 ("smb-audit Scale Validation") is the home for anomaly-quality work.
- **Privacy policy, terms of service, Intuit production-mode legal review** — required before production-app review (also a separate later phase).
- **QBO webhooks / push notifications** — no real-time updates; resyncs are user-triggered only.
- **Multi-realm support per user** (one user connecting multiple QuickBooks companies) — single connection per user.
- **PDF / OCR / receipt parsing** — QBO data arrives structured; this phase does not touch any PDF/image path.

## Constraints

- Must reuse Phase 5's Inngest + `lib/jobs/` infrastructure (no new background-job framework).
- Must reuse Phase 5/6's `TOKEN_ENCRYPTION_KEY` for token encryption — no new key management.
- Must reuse Phase 6's `brainHome(slug)` + session-derived sourceId — no new tenant-resolution path.
- Transformer output MUST satisfy `docs/brain-schema.md` exactly (the locked contract); any QBO-specific deviation requires updating the schema doc first.
- Vendor slugs MUST be `qbo-` prefixed so they cannot collide with the synthetic seed (Mara's Coffee) slugs in the seed tenant.
- No connector code outside `lib/connectors/` (no rogue `lib/qbo/`).
- Refresh-token rotation discipline: the new `refresh_token` returned from any token exchange MUST be persisted before the next QBO API call is made.
- Tokens MUST NEVER be logged (no `console.log`, no Sentry breadcrumb, no error message body) — enforced by code review + integration test.
- QBO sandbox API rate ceiling is 500 req/min per realm; 12-months-of-typical-SMB is well under this and no client-side throttling is required for v2.0.

## Acceptance Criteria

- [ ] Operator has registered an Intuit Developer sandbox app and `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_REDIRECT_URI` are present in `.env.local` and Vercel Preview + Production env.
- [ ] `app.qbo_connections` table exists with the schema in requirement 2 and all token columns encrypted at rest.
- [ ] A signed-in user can complete the OAuth flow end-to-end against Intuit sandbox in under 60 seconds wall-clock.
- [ ] After OAuth completes, an Inngest job runs to completion and writes ≥ 1 `qbo-*.md` file per sandbox-vendor and per sandbox-invoice into the user's brain.
- [ ] The post-connect screen displays ≥ 4 distinct phase-labeled status messages plus a final "Sync complete" line via `<JobProgress>`.
- [ ] After sync completes, chat against the tenant returns a real gbrain answer that cites a `qbo-` prefixed vendor.
- [ ] After sync completes, `GET /api/tenants/<slug>/insights` returns 200 with `topVendors.length > 0` and a non-null `pnl`.
- [ ] Running `smb-audit` against the tenant's `GBRAIN_HOME` exits 0 and writes ≥ 1 file under `brain-repo/concepts/`.
- [ ] Clicking "Re-sync from QuickBooks" wipes every `qbo-*.md` and rewrites them; modifying one fixture entity's value between syncs is reflected in the post-resync markdown.
- [ ] Manually revoking the sandbox connection at Intuit and refreshing the dashboard renders the yellow reconnect banner; clicking it restarts OAuth; insights API returns 409 `connector_revoked` (not 500, not empty bundle) while revoked.
- [ ] A grep across the codebase for log statements referencing token fields returns zero matches; integration test confirms no API response body contains token plaintext.
- [ ] Transformer output round-trips through `lib/insights/anomalies.ts` and `lib/insights/top-vendors.ts` without throwing on the committed `tests/fixtures/qbo/` set.

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                              |
|--------------------|-------|------|--------|--------------------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Sandbox scope, sync model, history window, deliverable all locked. |
| Boundary Clarity   | 0.88  | 0.70 | ✓      | Production OAuth, incremental sync, scheduled resync, email, additional connectors, anomaly-correctness, multi-realm, webhooks, PDF — all explicitly OUT. |
| Constraint Clarity | 0.78  | 0.65 | ✓      | Inherits Phase 5/6 infra; schema contract pre-locked; rate limit verified non-blocking for 12mo window. |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | Every criterion is a discrete pass/fail check tied to a file, row, status code, or visible UI element. |
| **Ambiguity**      | **0.14** | ≤0.20 | ✓ | Gate passed in 2 interview rounds.                                |

## Interview Log

| Round | Perspective       | Question summary                            | Decision locked                                                                              |
|-------|-------------------|---------------------------------------------|----------------------------------------------------------------------------------------------|
| 1     | Researcher        | Intuit app scope                            | Sandbox-only for v2.0; production-app review deferred to a follow-up phase.                  |
| 1     | Researcher        | Sync model                                  | Initial-load only; user-triggered "Re-sync" is wipe-and-reingest; no incremental/CDC.        |
| 1     | Researcher        | Historical data window                      | Last 12 months on first sync; older-history backfill is a later separate action.             |
| 2     | Boundary Keeper   | Progress UX bar                             | Phase-labeled status messages (≥ 3 distinct + "Sync complete"); reuse `<JobProgress>`.       |
| 2     | Boundary Keeper   | smb-audit + QBO data acceptance bar         | Code-compat only: smb-audit runs end-to-end against qbo- slugs and exits 0. Anomaly-correctness is Phase 8. |
| 2     | Failure Analyst   | Reconnect / failure UX                      | In-app yellow banner + `/connections/quickbooks` reconnect page; typed `connector_revoked` 409 on API; no email. |

---

*Phase: 07-quickbooks-online-ingest*
*Spec created: 2026-05-26*
*Next step: /gsd:discuss-phase 07 — implementation decisions (how to build what's specified above)*
