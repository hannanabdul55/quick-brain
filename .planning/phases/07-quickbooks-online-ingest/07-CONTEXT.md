# Phase 7: QuickBooks Online Ingest - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 7 delivers: a signed-in QuickBrain user connects an Intuit **sandbox** QuickBooks Online company via OAuth 2.0; within a single Inngest background job (phase-labeled progress in the browser), the last 12 months of their QBO Vendors + Bills + Invoices + Purchases are transformed into `docs/brain-schema.md`-conforming markdown and written into their per-tenant brain at `brainHome(slug)/brain-repo/{originals,companies}/`; immediately after, chat / insights / `smb-audit` all run against the qbo-prefixed data without error. Re-sync is wipe-and-reingest, no incremental sync. Reconnect-on-revoke is an in-app banner + dedicated reconnect page; no email notification.

Discuss-phase confirms 8 SPEC-locked requirements and adds the implementation-decision overlay below. New capabilities (production-mode Intuit app, incremental sync, Xero connector, anomaly-correctness validation) are explicitly deferred.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**8 requirements are locked.** See `07-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `07-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- Intuit OAuth 2.0 against Intuit's **sandbox** environment (sandbox app credentials).
- Encrypted storage of access_token + refresh_token + realm_id, keyed by `user_id`.
- Transparent access-token refresh on 401; immediate persistence of rotated refresh_token; revoked-status detection.
- QBO API client for Vendor, Invoice, Bill, Purchase endpoints.
- Pure transformer producing brain markdown satisfying `docs/brain-schema.md` (qbo- slug prefixing, `companies/qbo-<slug>.md` vendor pages with `type: vendor` + `slug: qbo-<slug>`).
- Connector-agnostic shared types in `lib/connectors/types.ts` (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`).
- Connector-specific code under `lib/connectors/qbo/` (not `lib/qbo/`).
- Inngest background job for the last-12-months initial-load ingest end-to-end.
- "Connect QuickBooks" CTA on `/dash/<slug>`; post-connect "Sync in progress" screen using existing `<JobProgress>`.
- `/connections/quickbooks` page with current connection status, last-synced timestamp, "Re-sync" + "Disconnect" buttons.
- Reconnect banner on the dashboard when status is `revoked`; typed `connector_revoked` API error on insights/chat routes.
- Integration tests using committed QBO API fixtures under `tests/fixtures/qbo/`.

**Out of scope (from SPEC.md):**
- Intuit production-app review and production-mode OAuth (multi-week approval, blocked on legal docs) — follow-up phase.
- Incremental sync (QBO CDC, change tokens, per-entity idempotency keys) — explicitly traded for ship speed; future phase replaces requirement #5.
- Historical backfill beyond 12 months — older-history backfill is a separate later action.
- Scheduled / cron-triggered automatic resync — every resync is user-initiated.
- Email notifications on connection failure — banner + reconnect page only.
- Additional connectors (Xero, Stripe, Plaid, vendor email) — Xero is v1.2; others excluded from v2.0.
- smb-audit anomaly-correctness validation against QBO data — Phase 8.
- Privacy policy, terms of service, Intuit production-mode legal review.
- QBO webhooks / push notifications — no real-time; resyncs are user-triggered only.
- Multi-realm support per user — one connection per user.
- PDF / OCR / receipt parsing — QBO data arrives structured.

</spec_lock>

<decisions>
## Implementation Decisions

### Token Storage Shape
- **D-01:** Reuse the QBO columns already prepared on `app.users` by Phase 6 D-10 (`qbo_realm_id text`, `qbo_tokens_encrypted text`); **do not** create a separate `app.qbo_connections` table. This supersedes the wording in `07-SPEC.md` requirement #2, which described a separate table — the prepared columns are the locked carry-forward decision from Phase 6. Add three new nullable columns to `app.users` via an additive migration: `qbo_access_token_expires_at timestamptz`, `qbo_last_synced_at timestamptz`, `qbo_connection_status text CHECK (status IN ('connected','revoked')) DEFAULT NULL`. Tokens themselves stay encrypted in the single `qbo_tokens_encrypted` JSON blob `{access_token, refresh_token, refresh_token_expires_at}` per the Phase 6 D-10 design. **Why:** single-row-per-user keeps the resolve-tenant chokepoint (D-11) a one-table read; no JOIN to surface connection status on every dashboard render.

### Token Encryption Helper
- **D-02:** Implement `lib/connectors/crypto.ts` exporting `encryptTokens(plaintext: TokenBundle): string` and `decryptTokens(ciphertext: string): TokenBundle`. Use Node's native `crypto.createCipheriv("aes-256-gcm", ...)` with a 32-byte key derived from `process.env.TOKEN_ENCRYPTION_KEY` (the same env established in Phase 5 — no new key management). Ciphertext format: base64 of `{iv (12B) || authTag (16B) || ciphertext}` so rotation is in-place. **Why:** keeps connector-scoped crypto in `lib/connectors/`; reuses the locked key; no new dependency.

### OAuth Library Choice
- **D-03:** Do **not** install the `intuit-oauth` SDK. Roll the OAuth Authorization Code flow ourselves in `lib/connectors/qbo/oauth.ts` using native `fetch` against Intuit's `/oauth2/v1/tokens/bearer` endpoint (~100 LOC for the `exchange()` + `refresh()` + `revoke()` triple). **Why:** the Intuit SDK is Express-coupled and last-published-2023; the OAuth surface we need is small enough that a fetch wrapper is shorter than the SDK config + adapter code. Eliminates a heavy dep on a serverless function.

### OAuth State / CSRF
- **D-04:** Pass an HMAC-signed `state` parameter through the OAuth round-trip. Use `lib/auth/tokens.ts`'s existing `jose` JWT signer (HS256 via `JWT_SECRET`, locked Phase 6) with a 10-minute TTL and payload `{user_id, nonce}`. The callback verifies the signature and TTL before doing the code exchange. **Why:** zero new key management; reuses Phase 6's locked auth primitive; defeats both CSRF and replay without a server-side state table.

### QBO API Client
- **D-05:** Implement `lib/connectors/qbo/client.ts` as a raw fetch wrapper exporting a small typed surface: `listVendors({since})`, `listInvoices({since})`, `listBills({since})`, `listPurchases({since})`, plus a low-level `request<T>()`. The client owns transparent access-token refresh on 401: catch a 401 → call `refresh()` (D-03) → persist the rotated `refresh_token` to `app.users.qbo_tokens_encrypted` **before** the retry (Spike findings: "persist newest refresh_token immediately after every exchange") → retry the original request once. **Do not** use the `node-quickbooks` library (callback-style, no TS types, last-published 2023). **Why:** ~200 LOC, fully typed, plays well with Inngest step boundaries, no churn-prone dep.

### Connector Code Layout
- **D-06:** All connector-specific code under `lib/connectors/qbo/` (NOT `lib/qbo/`). Shared cross-connector types under `lib/connectors/types.ts` (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine` — exact names from Spike 002a). The QBO transformer's output uses these types, not QBO-specific types — that keeps a v1.2 Xero adapter a drop-in addition. The transformer is per-connector; the markdown writer (`lib/connectors/writer.ts`) is connector-blind and called the same way regardless of source. **Why:** locked by Spike 002 findings; avoids a multi-file refactor when Xero arrives in v1.2.

### Inngest Job Shape
- **D-07:** Register `qbo.ingest` as a step-divided Inngest function in `lib/jobs/qbo/ingest.ts`. Use `step.run()` to enclose each phase so each gets its own retry boundary and emits a clean progress message via the existing `lib/jobs/store.ts::updateProgress`:
  1. `"Connecting to QuickBooks…"` (validate connection + decrypt tokens)
  2. `"Fetching vendors (X found)"`
  3. `"Fetching invoices and bills (Y of Z)"`
  4. `"Writing brain documents…"`
  5. `"Indexing for search…"` (call gbrain's reindex via `lib/gbrain/engine.ts`)
  6. `"Sync complete"` (terminal)
- The job is enqueued in the OAuth callback handler after successful token exchange. Job kind is registered in `lib/jobs/registry.ts` per Phase 5 contract. **Why:** five discrete phases satisfies SPEC acceptance criterion "≥ 4 distinct phase-labeled messages + final 'Sync complete'"; step.run() retries (Inngest default 4 attempts) absorb QBO 5xx blips without restarting the whole ingest.

### Re-Sync Semantics
- **D-08:** "Re-sync from QuickBooks" on `/connections/quickbooks` is wipe-and-reingest:
  1. Glob delete `{originals,companies}/qbo-*.md` inside the tenant's `brainHome(slug)/brain-repo/`.
  2. Trigger gbrain's `deleteSource()` for any documents indexed under the `qbo-` prefix so embeddings stay consistent with the file truth.
  3. Re-enqueue the same `qbo.ingest` job from D-07.
- Show an explicit confirmation modal first: "This will replace all QuickBooks data in your QuickBrain. Your synthetic seed and any uploaded data are not affected." **Why:** the action is destructive; "click → wipe" UX is too easy to fire by accident. Reuse the same modal pattern Phase 6 uses for sign-out from existing browsers (consistent destructive-confirm UX).

### Reconnect / Failure UX
- **D-09:** Failure surface has exactly two states:
  - `connector_temporary` (QBO 5xx, network timeout, any retryable error) — handled inside the client (D-05) via the Inngest step retry; user never sees it.
  - `connector_revoked` (OAuth `invalid_grant`, any 400-class OAuth response, manual disconnect, refresh-token past 100 days) — the client sets `app.users.qbo_connection_status = 'revoked'` and returns a typed `ConnectorRevokedError`. The dashboard layout reads this column on every render and shows a sticky yellow banner: "Your QuickBooks connection needs reconnecting. [Reconnect]" linking to `/connections/quickbooks`. Insights/chat routes return `{error: "connector_revoked"}` 409 when called against a revoked tenant.
- No email notification, no Sentry alert for the revoked path (user-recoverable, not an ops issue).
- **Why:** matches SPEC requirement #8; keeps the failure-mode surface tiny (one banner, one 409 error code, one CTA destination).

### Connect-QBO CTA Placement
- **D-10:** Two surfaces for the connect action:
  1. **Conditional empty-state callout** on `/dash/<slug>` rendered when the tenant's brain has zero QBO documents (`stat(brainHome(slug)/brain-repo/originals/)` returns empty or no `qbo-*.md` matches). Same visual treatment as the existing "no insights yet" state introduced by 06-06.
  2. **Permanent presence** on a new `/connections/quickbooks` page with current status, last-synced timestamp, "Re-sync" and "Disconnect" buttons.
- No header-bar connect button (avoids re-prompt churn once connected).
- **Why:** promotes the action where it pays off (an empty dashboard) without nagging connected users.

### Test Fixture Strategy
- **D-11:** Snapshot real Intuit-sandbox API responses to JSON files under `tests/fixtures/qbo/` once at fixture-creation time; commit the snapshots. Integration tests use the snapshots, never live calls. Add a `scripts/snapshot-qbo-fixtures.ts` one-shot for regenerating snapshots when Intuit's response shape changes. **Why:** deterministic CI without an Intuit network dep; pinned to a known sandbox-company shape; cheap to refresh.

### Sandbox Company Choice
- **D-12:** Use Intuit's pre-built **"Sandbox Company_US_1"** for dev + QA; do not author a custom sandbox dataset. **Why:** no extra fixture maintenance; well-documented in Intuit's docs; covers the four entity types we need (Vendor / Bill / Invoice / Purchase) with realistic shape.

### Token Logging Discipline
- **D-13:** Tokens MUST NEVER reach logs, Sentry breadcrumbs, error message bodies, or HTTP response bodies. Enforce at three layers:
  1. The `TokenBundle` type carries a `[Symbol.for("redacted")]: true` brand; any `JSON.stringify` of an error bundle goes through `lib/connectors/redact.ts::sanitizeError` which strips fields matching the brand.
  2. A unit test greps the built output for the strings `access_token`, `refresh_token`, `qbo_tokens_encrypted` to assert none appear in any `console.*` or `Response.json()` site in `lib/connectors/qbo/` or `app/api/connections/quickbooks/`.
  3. Sentry's `beforeSend` (already configured Phase 4) gets a connector-token regex strip.
- **Why:** satisfies SPEC acceptance "grep across codebase for log statements referencing token fields returns zero matches" structurally rather than by reviewer diligence.

### Sandbox vs Production Env Switching
- **D-14:** A single `QBO_ENV` env (`sandbox` | `production`, default `sandbox`) selects between Intuit's sandbox and production OAuth + API base URLs. The Vercel env config sets `QBO_ENV=sandbox` for both Preview and Production in v2.0; flipping to production is a one-env-flag change once Intuit production-app review completes (out of scope for this phase). **Why:** clean upgrade path with zero code change; no per-environment client classes.

### Claude's Discretion
- Exact migration file naming + numbering convention; the precise QBO Inngest function ID string; whether the gbrain reindex step (D-07 step 5) batches per-document or runs one bulk call; the empty-state callout's exact copy and illustration; the disconnect-confirmation modal's exact copy; the `/connections/quickbooks` page layout grid; the OAuth callback redirect target after success ("Sync in progress" route name). All left to planner / UI agents.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements (MUST READ)
- `.planning/phases/07-quickbooks-online-ingest/07-SPEC.md` — **Locked requirements (MUST read before planning).** 8 requirements with current/target/acceptance + Boundaries (In/Out scope) + Acceptance Criteria checklist + Ambiguity Report.
- `.planning/ROADMAP.md` §"Phase 7: QuickBooks Online Ingest" — phase goal, 5 success criteria, QBO-01..06 mapping, the operator precondition (Intuit Developer sandbox app registration), the Spike 002a context block, and the connector-agnostic-types directive.
- `.planning/REQUIREMENTS.md` §QBO (lines 70–77) — QBO-01..06 full text.

### Hard transformer contract (MUST READ before writing the transformer)
- `docs/brain-schema.md` — the locked output contract for every ingested document. Specifically:
  - §"Invoice documents (`originals/invoice-*.md`)" — frontmatter (`type`/`vendor`/`vendor_slug`/`date`/`amount`/`currency`) + body wikilink form `[[companies/<vendor_slug>]]`.
  - §"Concept page bullets" — vendor body line shapes (debit/credit) that the insights parsers depend on.
  - §"QBO Field Mapping" (lines 209–223) — the per-field QBO→brain map: `TxnDate→date`, `TotalAmt→amount`, `VendorRef.name→vendor`, slugified `→vendor_slug`, `CurrencyRef.value→currency`. Wikilinks MUST use `[[companies/qbo-<slug>]]`. Vendor pages MUST carry `type: vendor` + `slug: qbo-<slug>` so ghost-saas resolves.
  - §"Immutability Contract" — `lib/insights/anomalies.ts` (bulletRegex) and `lib/insights/types.ts` (AnomalyRow shape) MUST NOT be modified.

### Carried-forward decisions from earlier phases
- `.planning/phases/06-auth-multi-tenant-isolation/06-CONTEXT.md` — D-10 (QBO columns prepared on `app.users`: `qbo_realm_id`, `qbo_tokens_encrypted`) → see this phase's D-01 which extends those columns; D-11 (per-user `source_id` partitioning is the isolation boundary, NOT gbrain RLS) → the QBO ingest writes into the session-resolved user's brain only; D-12 (gbrain `think` patch via `patch-package` threads `sourceId`) → no new patch needed for QBO; the ingest just writes files into the right `brainHome(slug)`.
- `.planning/phases/05-background-jobs/05-CONTEXT.md` — Inngest is the job runner; `lib/jobs/registry.ts` is the kind→operation registry; `lib/jobs/store.ts` is the Postgres-backed lifecycle (`createJob` / `setRunning` / `updateProgress` / `finishJob` / `failJob`); `<JobProgress>` polls and renders. The `qbo.ingest` function follows this contract exactly.
- `scripts/setup-auth-tables.ts` (lines 59–79) — confirms `app.users.qbo_realm_id text` and `app.users.qbo_tokens_encrypted text` columns already exist and are nullable. Phase 7's migration is **additive only** (adds 3 columns; does not touch the prepared ones).

### Spike + project context
- `.claude/skills/spike-findings-quick-brain/SKILL.md` §"Accounting connectors" — `lib/connectors/qbo/` path discipline, connector-agnostic types in `lib/connectors/types.ts`, qbo- slug prefix, refresh-token rotation discipline ("persist newest refresh_token immediately after every exchange"), skip Wave + FreshBooks (no first-class Bill/Vendor entity), Xero is v1.2.
- `.claude/skills/spike-findings-quick-brain/references/accounting-connectors.md` — full Spike 002 verdict and per-connector evidence.
- `.planning/spikes/002-accounting-api-comparison/README.md` — QBO chosen for v1.1; rate-limit ceiling (500/min vs Xero 60/min); refresh-token longevity (100 days). The transformer module stays connector-specific (`lib/connectors/qbo/transformer.ts`); shared types live in `lib/connectors/types.ts`.

### Encryption + auth primitives to reuse
- `lib/auth/tokens.ts` — `jose`-based HS256 JWT signer using `JWT_SECRET`. Reused for the OAuth `state` param (D-04).
- `lib/auth/resolve-tenant.ts` — `resolveTenant(): Promise<TenantContext>` is the per-request user_id chokepoint (Phase 6 D-11). The OAuth callback handler reads `user_id` from this; the QBO ingest job reads `brainSlug` from this; the dashboard banner reads `qbo_connection_status` keyed on this.
- Phase 5/6 env locked: `TOKEN_ENCRYPTION_KEY` (≥32 bytes) is established; D-02's `lib/connectors/crypto.ts` uses it directly.

### Job runner integration
- `app/api/inngest/route.ts` — the Inngest serve route. The new `qbo.ingest` function is registered here alongside existing Phase 5 functions.
- `components/jobs/job-progress.tsx` — the reusable progress UI. The post-OAuth-callback "Sync in progress" page renders this component pointed at the new job's ID.

### gbrain integration
- `lib/gbrain/paths.ts` — exports `brainHome(slug: string): string` resolving `brains/<slug>/`. Every QBO file write goes through `join(brainHome(slug), "brain-repo", "originals" | "companies")`.
- `lib/gbrain/engine.ts` — the in-process gbrain handle. The ingest job's "Indexing for search…" step calls into here to reindex the newly-written documents (exact API call left to planning).
- `lib/insights/anomalies.ts` + `lib/insights/top-vendors.ts` — IMMUTABLE; the transformer's output must satisfy these parsers' contracts (verified by D-11's fixture round-trip test).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/jobs/registry.ts::JOB_REGISTRY` — kind-keyed dispatch table; add `"qbo.ingest"` key with the `JobOperation` shape Phase 5 locked.
- `lib/jobs/store.ts` — full Postgres-backed lifecycle (`createJob` / `setRunning` / `updateProgress` / `finishJob` / `failJob` / `getJob`). The QBO job calls these directly; no new tracking table.
- `lib/auth/resolve-tenant.ts::resolveTenant()` — the single source of truth for `{user_id, brainSlug, sourceId}`. All four new routes (`POST /api/connections/quickbooks/start`, `GET /api/connections/quickbooks/callback`, `POST /api/connections/quickbooks/resync`, `POST /api/connections/quickbooks/disconnect`) MUST call this first; no slug-from-URL reads.
- `lib/auth/tokens.ts` — the `jose` HS256 signer for the OAuth `state` param (D-04).
- `components/jobs/job-progress.tsx` — reuse as-is for the post-connect "Sync in progress" page.
- `lib/gbrain/paths.ts::brainHome` + `FIXTURES_ROOT` + `SEED_TENANT_ID` — per-tenant path conventions. The QBO writer composes paths through `brainHome`; never hardcodes.
- `app/api/inngest/route.ts` — the single Inngest serve route. Append the new function to the existing array.

### Established Patterns
- All app routes pin `runtime = "nodejs"` + `dynamic = "force-dynamic"` (gbrain's Postgres client isn't edge-compatible; `vercel.json` pins `bun@1.2.0` for `app/api/**`). New QBO routes follow this.
- App-owned data lives in the `app` schema, NOT `public` (hedges gbrain's auto-RLS event trigger from Phase 6 D-11 / Spike 005). The Phase 7 migration that adds QBO bookkeeping columns to `app.users` stays in `app`.
- Module-level `postgres()` singleton with `prepare: false` (Supavisor pooler on port 6543), tagged-template parameterized SQL, error-message sanitization. The QBO crypto + token store follow this.
- Tenant isolation is **always** application-enforced via `resolveTenant()` (Phase 6 D-11) — never trust `params.id`. QBO routes follow this without exception.
- Custom gbrain skills MUST always exit 0 (Spike 003); the QBO ingest job is NOT a skill — it's an Inngest function — but the same "never let a process exit non-zero from an internal error" discipline applies to the job's outer wrapper (Inngest will retry on non-zero).
- `bun` must be in `PATH` when invoking gbrain (Spike 003); Inngest functions run inside the Next.js server, which is already started under `bun --bun next dev`. No PATH manipulation needed for the Inngest path; if any cron wrapper is later added, it MUST `export PATH="$HOME/.bun/bin:$PATH"`.

### Integration Points
- New API routes to create:
  - `POST /api/connections/quickbooks/start` — builds the Intuit authorization URL with signed `state`, returns the URL for client redirect.
  - `GET /api/connections/quickbooks/callback` — verifies `state`, exchanges `code` for tokens, persists encrypted to `app.users`, enqueues `qbo.ingest`, redirects to the sync-progress route.
  - `POST /api/connections/quickbooks/resync` — confirms `qbo_connection_status = 'connected'`, wipes qbo-*.md, re-enqueues `qbo.ingest`.
  - `POST /api/connections/quickbooks/disconnect` — calls `revoke()` against Intuit, clears the QBO columns + sets status to NULL (NOT 'revoked' — 'revoked' is reserved for involuntary loss).
- New pages to create:
  - `/connections/quickbooks` — status + last-synced + Re-sync + Disconnect.
  - The post-callback sync-progress screen (route name at planner's discretion).
- Existing pages to modify:
  - `app/dash/[id]/page.tsx` — add the conditional empty-state Connect-QBO callout (D-10).
  - `app/dash/[id]/layout.tsx` — read `qbo_connection_status` and render the sticky reconnect banner when status is `revoked` (D-09).
- Existing API routes to modify:
  - `app/api/tenants/[id]/chat/route.ts` and `app/api/tenants/[id]/insights/route.ts` — return `{error: "connector_revoked"}` 409 when the tenant's `qbo_connection_status = 'revoked'` AND the tenant has any qbo-*.md documents (a revoked-but-unused tenant should still serve their non-QBO data).
- No `lib/connectors/` directory exists yet — this phase scaffolds it (along with `lib/connectors/types.ts`, `lib/connectors/qbo/{client,oauth,transformer,types}.ts`, `lib/connectors/crypto.ts`, `lib/connectors/writer.ts`, `lib/connectors/redact.ts`).
- No `lib/jobs/qbo/` directory exists yet — the Inngest function lands at `lib/jobs/qbo/ingest.ts`.

</code_context>

<specifics>
## Specific Ideas

- The Intuit sandbox API base URL is `https://sandbox-quickbooks.api.intuit.com`; OAuth endpoints are `https://appcenter.intuit.com/connect/oauth2` (authorize) and `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` (token). `QBO_ENV=sandbox` keys these constants; `QBO_ENV=production` flips to the unprefixed hosts. Pin these in `lib/connectors/qbo/endpoints.ts` so the planner doesn't have to chase them down.
- Per Intuit docs: `minorversion=70` (or later) on every API call enables the modern response shape; pin a single `QBO_MINOR_VERSION` constant rather than scattering it.
- For the 12-month window, use `WHERE TxnDate >= today - INTERVAL '12 months'` syntax in QBO's SQL-ish query language (`SELECT * FROM Invoice WHERE TxnDate >= '2025-05-26'`). The client wrapper computes the date once at job-start so all four entity queries share the same cutoff.
- Vendor email is a required transformer output when the source exposes it (Spike 002 invariant). QBO Vendor entities carry `PrimaryEmailAddr.Address`; the transformer writes it as a `vendor_email:` frontmatter field on the `companies/qbo-<slug>.md` page. The insights parsers don't consume it today; future outbound-comms phases will (Spike 004 CPA-email work).

</specifics>

<deferred>
## Deferred Ideas

- **Production-mode Intuit OAuth + production-app review** — explicit follow-up phase after legal docs (privacy policy, TOS) land. SPEC.md boundary.
- **Incremental sync via QBO ChangeDataCapture** — replaces SPEC requirement #5 in a later "QBO Incremental Sync" phase; persists a per-tenant cursor and per-entity idempotency keys.
- **Older-history backfill** — a user-triggered "Import all-time history" action that walks beyond the 12-month default. Separate later action.
- **Scheduled / cron resync** — auto-refresh on a schedule; explicitly out of v2.0.
- **Xero connector (v1.2)** — Spike 002a verdict. The connector-agnostic types in `lib/connectors/types.ts` and the `lib/connectors/writer.ts` already pay rent here.
- **Stripe / Plaid / vendor-email connectors** — explicit PROJECT.md out-of-scope for v2.0.
- **smb-audit anomaly-correctness validation against QBO data** — Phase 8 ("smb-audit Scale Validation").
- **Email notifications on connection failure** — discussed and dropped in favor of in-app banner (D-09). If user retention data later shows users miss revoked connections, revisit in a "connection-health" phase that also handles outbound comms.
- **QBO webhooks for real-time updates** — needs production-mode + a public webhook endpoint with replay protection. Out of v2.0.
- **Multi-realm per user** — explicit PROJECT.md v2.1 deferral (team / multi-user-per-brain sharing).
- **CPA-facing monthly close emails** — Spike 004 deliverable for v1.2 / a future phase; not Phase 7 scope but folds cleanly onto QBO-ingested data once available.

</deferred>

---

*Phase: 07-quickbooks-online-ingest*
*Context gathered: 2026-05-26*
