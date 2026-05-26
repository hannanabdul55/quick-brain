# Phase 7: QuickBooks Online Ingest - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 07-quickbooks-online-ingest
**Mode:** `--auto --chain` (Claude auto-selected recommended options on every gray area; no user prompts)
**Areas discussed:** Token storage, OAuth library, QBO API client, Inngest job shape, Re-sync semantics, Reconnect UX, Connect-QBO CTA placement, Test fixture strategy, Sandbox env, OAuth CSRF, Token-logging discipline

---

## Token Storage Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Extend prepared columns on `app.users` (D-01) | Add `qbo_access_token_expires_at`, `qbo_last_synced_at`, `qbo_connection_status` to `app.users`; tokens stay in the prepared `qbo_tokens_encrypted` JSON blob from Phase 6 D-10. Single-row-per-user, no JOIN on dashboard. | ✓ |
| Separate `app.qbo_connections` table | What SPEC.md req #2 originally described. Cleaner separation but adds a JOIN on every resolve-tenant call. | |
| Hybrid: tokens in `app.users`, sync metadata in separate table | Splits concerns but contradicts Phase 6 D-10's "single row" intent. | |

**User's choice:** First (auto-selected — supersedes SPEC.md req #2 wording per Phase 6 D-10 carry-forward).
**Notes:** This is a reconciliation, not a new decision — Phase 6 D-10 already prepared the columns on `app.users`. The auto-recommendation honors the locked Phase 6 design; SPEC.md req #2 wording will be referenced through CONTEXT.md D-01.

---

## OAuth Library Choice

| Option | Description | Selected |
|--------|-------------|----------|
| Roll-our-own via native fetch (D-03) | ~100 LOC in `lib/connectors/qbo/oauth.ts`; no dep; full control. | ✓ |
| `intuit-oauth` SDK | Official SDK; Express-coupled patterns; last-published 2023; ~150KB on a serverless function. | |
| `simple-oauth2` | Generic OAuth client; would still need Intuit-specific wiring. | |

**User's choice:** Roll-our-own (auto-selected — recommended).
**Notes:** OAuth surface is small enough (`exchange` + `refresh` + `revoke`) that the SDK adapter would be longer than the fetch implementation.

---

## QBO API Client

| Option | Description | Selected |
|--------|-------------|----------|
| Raw fetch wrapper in `lib/connectors/qbo/client.ts` (D-05) | ~200 LOC, fully typed, plays well with Inngest step boundaries. Owns transparent 401-refresh + immediate refresh-token persistence. | ✓ |
| `node-quickbooks` library | Callback-style API; no TS types; last-published 2023; would need a Promise wrapper. | |
| `@intuit/intuit-oauth` + raw fetch for data calls | Hybrid; doubles the surface area for marginal benefit. | |

**User's choice:** Raw fetch wrapper (auto-selected — recommended).
**Notes:** Refresh-token persistence MUST happen BEFORE retry (Spike findings invariant — locked).

---

## Inngest Job Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Step-divided via `step.run()` (D-07) | Five phases: connect → vendors → invoices/bills → write → index. Each phase gets retry boundary + clean progress message. Satisfies SPEC "≥4 distinct phase-labeled messages". | ✓ |
| Single mega-function with manual `updateProgress()` calls | Simpler; loses Inngest retry granularity per phase. | |
| Multi-function pipeline (event-driven) | Each phase is its own Inngest function emitting events. Highest fidelity but heaviest. | |

**User's choice:** Step-divided (auto-selected — recommended).
**Notes:** Inngest default retry policy (4 attempts) absorbs QBO 5xx blips without restarting the whole ingest.

---

## Re-Sync Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Wipe-and-reingest with explicit confirmation modal (D-08) | Delete qbo-*.md, call gbrain `deleteSource()`, re-enqueue job. Destructive-confirm modal first. | ✓ |
| Wipe-and-reingest without confirmation | Faster but easy to misclick. | |
| Soft delete + tombstone (idempotent rewrite) | Complexity climbs into incremental-sync territory which SPEC.md explicitly defers. | |

**User's choice:** With confirmation modal (auto-selected — recommended).
**Notes:** Reuses Phase 6's existing destructive-confirm pattern for sign-out-from-other-browsers.

---

## Reconnect / Failure UX

| Option | Description | Selected |
|--------|-------------|----------|
| Two-state surface: `connector_temporary` (silent) + `connector_revoked` (banner + 409) (D-09) | Failures the client can recover from never bubble up; only persistent revocation surfaces. | ✓ |
| Five-state surface (temporary / rate-limited / revoked / expired / network) | High fidelity but overwhelms a non-technical SMB owner. | |
| Single state: any failure shows the banner | Noisy on transient errors; degrades trust. | |

**User's choice:** Two-state (auto-selected — recommended; matches SPEC req #8).
**Notes:** No email notification (already locked at SPEC level).

---

## Connect-QBO CTA Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Conditional empty-state callout on `/dash` + permanent on `/connections/quickbooks` (D-10) | Promotes the action on empty dashboards; doesn't nag connected users. | ✓ |
| Persistent header-bar button | Visible always; nags connected users to re-click. | |
| Connect inside the onboarding flow only | Hides the action post-onboarding; bad for users who skip on first visit. | |

**User's choice:** Conditional empty-state + permanent settings (auto-selected — recommended).
**Notes:** Uses the same visual treatment as the 06-06 "no insights yet" state.

---

## Test Fixture Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Snapshot real sandbox responses → commit (D-11) | Deterministic CI; no Intuit network dep; `scripts/snapshot-qbo-fixtures.ts` regenerates. | ✓ |
| Hand-authored fixtures | Manual maintenance overhead; risk of shape drift from real Intuit responses. | |
| Live calls to Intuit sandbox in CI | Flaky; requires Intuit creds in CI; rate-limit risk. | |

**User's choice:** Snapshot + commit (auto-selected — recommended).

---

## Sandbox Company Choice

| Option | Description | Selected |
|--------|-------------|----------|
| Intuit's pre-built "Sandbox Company_US_1" (D-12) | Well-documented; covers Vendor/Bill/Invoice/Purchase; zero fixture maintenance. | ✓ |
| Author a custom sandbox dataset | Higher control; significant ongoing maintenance. | |
| Use multiple sandbox companies for varied test coverage | Useful for Phase 8 scale validation; unnecessary here. | |

**User's choice:** Intuit's pre-built (auto-selected — recommended).

---

## OAuth State / CSRF

| Option | Description | Selected |
|--------|-------------|----------|
| HMAC-signed `state` via existing `lib/auth/tokens.ts` JWT (D-04) | Reuses Phase 6 `JWT_SECRET`; 10-min TTL; payload `{user_id, nonce}`; stateless. | ✓ |
| Server-side state table | Stateful; introduces a new `app.oauth_state` table. | |
| Cookie-stored random nonce | Simple but cookie can be stripped by browsers; less robust than signed state. | |

**User's choice:** Signed `state` via existing JWT (auto-selected — recommended).

---

## Token Logging Discipline

| Option | Description | Selected |
|--------|-------------|----------|
| Three-layer enforcement: type brand + grep test + Sentry strip (D-13) | Structural; doesn't rely on reviewer diligence. | ✓ |
| Code review only | Relies on humans; SPEC says zero matches must be verifiable. | |
| Type brand only | Catches `JSON.stringify` paths but not direct string interpolation. | |

**User's choice:** Three-layer enforcement (auto-selected — recommended).

---

## Sandbox vs Production Env Switching

| Option | Description | Selected |
|--------|-------------|----------|
| Single `QBO_ENV` env flag selects base URLs (D-14) | One-flag flip post-Intuit-production-review; zero code change. | ✓ |
| Per-environment client classes | Heavier; more test surface. | |
| Hard-code sandbox URLs (no production path) | Cleanest for v2.0 ship; forces follow-up code change later. | |

**User's choice:** `QBO_ENV` env flag (auto-selected — recommended).

---

## Claude's Discretion

The following are explicitly left to planner / UI / research agents (no decision needed at discuss-phase):

- Exact migration file naming + numbering convention.
- The precise QBO Inngest function ID string.
- Whether the gbrain reindex step batches per-document or runs one bulk call (research question).
- The empty-state callout's exact copy and illustration.
- The disconnect-confirmation modal's exact copy.
- The `/connections/quickbooks` page layout grid.
- The OAuth callback redirect target after success (the "Sync in progress" route name).

---

## Deferred Ideas

The following came up during analysis and are tracked in CONTEXT.md `<deferred>` for future phases:

- Production-mode Intuit OAuth + production-app review — explicit follow-up phase after legal docs.
- Incremental sync via QBO ChangeDataCapture — later phase, replaces SPEC req #5.
- Older-history backfill beyond 12 months — separate later action.
- Scheduled / cron resync — explicit v2.0 out-of-scope.
- Xero connector — v1.2 (Spike 002a).
- Stripe / Plaid / vendor-email connectors — PROJECT.md out of scope for v2.0.
- smb-audit anomaly-correctness validation against QBO data — Phase 8.
- Email notifications on connection failure — discussed and dropped in favor of in-app banner.
- QBO webhooks for real-time updates — out of v2.0 (needs production-mode + public webhook endpoint).
- Multi-realm per user — PROJECT.md v2.1.
- CPA-facing monthly close emails — Spike 004 deliverable; future phase folds onto QBO data.
