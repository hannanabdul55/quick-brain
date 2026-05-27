# Phase 7: QuickBooks Online Ingest — Research

**Researched:** 2026-05-26
**Domain:** Intuit OAuth 2.0, QBO Accounting API, AES-256-GCM token encryption, Inngest step-divided jobs, gbrain importFromContent ingest API
**Confidence:** HIGH (all major technical domains verified via official sources or direct codebase inspection)

---

## Summary

Phase 7 wires together four distinct technical layers: (1) Intuit OAuth 2.0 Authorization Code grant, (2) a raw-fetch QBO API client over sandbox API base URL, (3) an Inngest step-divided background job writing transformed markdown into the tenant brain, and (4) `gbrain.importFromContent()` to re-index each document in-process. All four layers have clear, verified integration points and no surprise blockers.

The most critical implementation discipline is **refresh-token rotation**: Intuit has rotated refresh tokens on every 24-hour exchange since November 2025; a failed persist before the next API call triggers `invalid_grant` and forces a full reconnect. The spike findings in `lib/connectors/` already encode this discipline — the only risk is a dev oversight during implementation.

The existing job infrastructure (`lib/inngest/functions.ts::runJob`, `lib/jobs/store.ts`, `app/api/jobs/route.ts`) dispatches jobs via a single generic `"app/job.requested"` Inngest event. Phase 7 adds `"qbo-ingest"` to `JobKind` in `lib/jobs/types.ts` + `lib/jobs/schemas.ts` + `JOB_REGISTRY` in `lib/jobs/registry.ts` — everything else (retry, progress, lifecycle) is inherited from `runJob`.

**Primary recommendation:** Build in this order: (1) `lib/connectors/crypto.ts` + migration, (2) `lib/connectors/qbo/oauth.ts` + route handlers, (3) `lib/connectors/qbo/client.ts`, (4) `lib/connectors/qbo/transformer.ts`, (5) `lib/jobs/qbo/ingest.ts` + registry wiring, (6) UI surfaces.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Reuse `qbo_realm_id` and `qbo_tokens_encrypted` columns already on `app.users` (from Phase 6 D-10). No separate `qbo_connections` table. Add three nullable columns via additive migration: `qbo_access_token_expires_at timestamptz`, `qbo_last_synced_at timestamptz`, `qbo_connection_status text CHECK (status IN ('connected','revoked')) DEFAULT NULL`. Token bundle stored as encrypted JSON `{access_token, refresh_token, refresh_token_expires_at}` in `qbo_tokens_encrypted`.
- **D-02:** `lib/connectors/crypto.ts` — AES-256-GCM via `crypto.createCipheriv("aes-256-gcm", ...)`, 32-byte key from `TOKEN_ENCRYPTION_KEY`, ciphertext format `base64({iv(12B) || authTag(16B) || ciphertext})`.
- **D-03:** Roll own OAuth client in `lib/connectors/qbo/oauth.ts` using native `fetch`. No `intuit-oauth` SDK.
- **D-04:** OAuth `state` param = HS256 JWT via existing `lib/auth/tokens.ts` (jose, `JWT_SECRET`), 10-min TTL, payload `{user_id, nonce}`.
- **D-05:** `lib/connectors/qbo/client.ts` raw fetch wrapper: `listVendors`, `listInvoices`, `listBills`, `listPurchases`, `request<T>()`. Transparent 401 → refresh → persist rotated token → retry once. No `node-quickbooks`.
- **D-06:** All connector code under `lib/connectors/qbo/`. Shared cross-connector types in `lib/connectors/types.ts` (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`). Connector-agnostic markdown writer in `lib/connectors/writer.ts`.
- **D-07:** `qbo.ingest` Inngest function at `lib/jobs/qbo/ingest.ts`. Five `step.run()` phases: connecting → vendors → invoices/bills → writing → indexing. Terminal "Sync complete". Enqueued from OAuth callback after token persist. Progress via existing `lib/jobs/store.ts::updateProgress`.
- **D-08:** Re-sync = wipe qbo-*.md → `deleteSource()` on qbo-prefix → re-enqueue ingest. Confirmation modal first.
- **D-09:** Two failure states: `connector_temporary` (retry via Inngest step) and `connector_revoked` (set status='revoked', show yellow banner, return 409 `connector_revoked` on insights/chat). No email notification.
- **D-10:** Connect-QBO callout on `/dash/<slug>` when no qbo-*.md exist. Permanent `/connections/quickbooks` page with status, last-synced, Re-sync, Disconnect.
- **D-11:** QBO fixture snapshots under `tests/fixtures/qbo/`. One-shot `scripts/snapshot-qbo-fixtures.ts` for regeneration.
- **D-12:** Use Intuit's "Sandbox Company_US_1".
- **D-13:** Token logging discipline via `TokenBundle` brand + `lib/connectors/redact.ts` + Sentry `beforeSend` strip.
- **D-14:** `QBO_ENV` env var (`sandbox`|`production`, default `sandbox`) selects endpoint URLs. Pin in `lib/connectors/qbo/endpoints.ts`.

### Claude's Discretion

- Migration file naming + numbering convention.
- Exact QBO Inngest function ID string.
- Whether the gbrain reindex step batches per-document or runs one bulk call.
- Empty-state callout exact copy and illustration.
- Disconnect-confirmation modal exact copy.
- `/connections/quickbooks` page layout grid.
- OAuth callback redirect target route name (the "Sync in progress" route).

### Deferred Ideas (OUT OF SCOPE)

- Production-mode Intuit OAuth + production-app review.
- Incremental sync (QBO CDC, change tokens, per-entity idempotency keys).
- Historical backfill beyond 12 months.
- Scheduled/cron-triggered automatic resync.
- Email notifications on connection failure.
- Additional connectors (Xero, Stripe, Plaid, vendor email).
- smb-audit anomaly-correctness validation against QBO data (Phase 8).
- Privacy policy, TOS, Intuit production-mode legal review.
- QBO webhooks/push notifications.
- Multi-realm support per user.
- PDF/OCR/receipt parsing.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QBO-01 | Signed-in user connects QBO account via Intuit OAuth 2.0 | OAuth endpoints verified; state JWT pattern via existing lib/auth/tokens.ts |
| QBO-02 | OAuth access + refresh tokens and realm ID stored encrypted at rest | AES-256-GCM pattern confirmed; TOKEN_ENCRYPTION_KEY already in env |
| QBO-03 | Connecting QBO ingests vendors/invoices/bank transactions into brain as markdown matching brain-schema.md | QBO entity shapes verified; gbrain importFromContent API confirmed |
| QBO-04 | QBO ingest runs as background job with visible progress in browser | Inngest runJob pattern confirmed; JobProgress component accepts allStages |
| QBO-05 | Expired access tokens transparently refreshed; revoked connection surfaces reconnect prompt | Token rotation discipline documented; invalid_grant triggers confirmed |
| QBO-06 | After ingest user can ask questions in chat over real QBO data; smb-audit anomaly cards reflect that data | gbrain importFromContent with sourceId confirmed; brain-schema.md field map locked |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OAuth authorize redirect | API (Route Handler) | Browser | Server builds the signed state JWT; browser receives the redirect URL and follows it |
| OAuth callback / code exchange | API (Route Handler) | — | Must be server-side; client secret never leaves server |
| Token encryption/decryption | API (Backend lib) | — | `lib/connectors/crypto.ts`; never in client code |
| Token storage | Database (Supabase) | — | Encrypted columns on `app.users` |
| QBO API fetching | API (Inngest job) | — | Background job; not inline request handler |
| Brain document writing | API (Inngest job) | — | Files written server-side into `brainHome(slug)/brain-repo/` |
| gbrain reindex (embeddings) | API (Inngest job via engine.ts) | — | In-process gbrain `importFromContent`; requires server Bun runtime |
| Progress display | Browser | — | `<JobProgress>` polls `/api/jobs/[id]`; pure read |
| Connection status banner | Frontend Server (SSR) | Browser | DashLayout reads `qbo_connection_status` column server-side on each render |
| Reconnect / 409 error | API (Route Handler) | Browser | 409 returned by insights/chat routes; banner rendered by layout SSR |

---

## Standard Stack

### Core (all already installed — zero new packages required)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `inngest` | `^4.4.0` (installed) | Background job orchestration | Phase 5 locked; `runJob` generic function handles all job kinds |
| `jose` | `^6.2.3` (installed) | HS256 JWT for OAuth state param | Phase 6 locked; `lib/auth/tokens.ts` already exports signers |
| `zod` | `^3.23.8` (installed) | Input validation on route handlers | Phase 6 convention; every route validates inputs |
| `postgres` | (gbrain dep, installed) | DB access for token storage | Phase 5/6 convention; `prepare:false` on port 6543 |
| `node:crypto` | Built-in | AES-256-GCM token encryption | D-02 locked; no new dep |
| `node:fetch` | Built-in (Node 18+) | QBO API + Intuit OAuth HTTP | D-03 / D-05 locked; no `intuit-oauth` SDK, no `node-quickbooks` |

### Supporting (new shadcn component only)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `alert-dialog` (shadcn) | official registry | Re-sync + disconnect confirmation modals | UI-SPEC locked; install via `bunx shadcn@latest add alert-dialog` |

### Explicitly Excluded

| Avoid | Reason |
|-------|--------|
| `intuit-oauth` | Express-coupled, last published 2023; OAuth surface is ~100 LOC of native fetch |
| `node-quickbooks` | Callback-style, no TS types, last published 2023; raw fetch wrapper is simpler |
| Any new encryption library | `node:crypto` `createCipheriv("aes-256-gcm")` is the standard; no dep needed |

**No new packages to install.** The only registry action is `bunx shadcn@latest add alert-dialog` (official shadcn registry, no vetting gate needed per UI-SPEC).

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All package recommendations use only already-installed packages from Phase 5/6 or the official shadcn registry. No new third-party packages are introduced by this phase.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| `inngest@^4.4.0` | npm | Already installed Phase 5 | Approved — no install needed |
| `jose@^6.2.3` | npm | Already installed Phase 6 | Approved — no install needed |
| `zod@^3.23.8` | npm | Already installed Phase 6 | Approved — no install needed |
| `alert-dialog` (shadcn) | shadcn official | Not installed | Approved — official registry, `bunx shadcn@latest add alert-dialog` |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Net new npm installs:** zero

---

## Architecture Patterns

### System Architecture Diagram

```
Browser
  │
  │  1. Click "Connect QuickBooks" → GET /connections/quickbooks
  │  2. Click "Connect QuickBooks" button → POST /api/connections/quickbooks/start
  │     ← returns { url: "https://appcenter.intuit.com/connect/oauth2?..." }
  │  3. Browser follows redirect → Intuit consent screen
  │  4. Intuit redirects → GET /api/connections/quickbooks/callback?code=&state=&realmId=
  │
  ▼
Next.js Route Handlers
  ├── POST /api/connections/quickbooks/start
  │     ├── resolveTenant() [REQUIRED first]
  │     ├── sign state JWT (lib/auth/tokens.ts, 10-min TTL, {user_id, nonce})
  │     └── return Intuit authorize URL
  │
  ├── GET /api/connections/quickbooks/callback
  │     ├── verify state JWT signature + TTL
  │     ├── exchange code → {access_token, refresh_token, x_refresh_token_expires_in}
  │     │     POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
  │     ├── encryptTokens() → base64(iv||authTag||ciphertext)
  │     ├── UPDATE app.users SET qbo_realm_id, qbo_tokens_encrypted, qbo_access_token_expires_at,
  │     │         qbo_connection_status='connected'
  │     ├── createJob("qbo-ingest", {userId, brainSlug}) → jobId
  │     ├── inngest.send("app/job.requested", {jobId, kind:"qbo-ingest", params})
  │     └── redirect → /dash/<slug>/sync?jobId=<jobId>
  │
  ├── POST /api/connections/quickbooks/resync
  │     ├── resolveTenant() + verify status='connected'
  │     ├── glob delete originals/qbo-*.md + companies/qbo-*.md
  │     ├── gbrain deleteSource (qbo- prefix) [if API available]
  │     └── createJob("qbo-ingest") + inngest.send
  │
  └── POST /api/connections/quickbooks/disconnect
        ├── resolveTenant()
        ├── POST https://developer.api.intuit.com/v2/oauth2/tokens/revoke
        └── UPDATE app.users: clear qbo_* columns, status=NULL
  │
  ▼
Inngest (qbo.ingest function — 5 steps)
  ├── Step 1 "connecting": decrypt tokens, validate connection
  ├── Step 2 "vendors": GET QBO /query?query=SELECT * FROM Vendor
  ├── Step 3 "invoices": GET QBO /query?query=SELECT * FROM Bill/Invoice/Purchase WHERE TxnDate >= cutoff
  ├── Step 4 "writing": transformer → markdown → write files to brainHome(slug)/brain-repo/{originals,companies}/
  └── Step 5 "indexing": gbrain importFromContent() per file with sourceId
  │
  ▼
gbrain engine (in-process, shared pool from lib/gbrain/engine.ts)
  └── importFromContent(engine, slug, content, {sourceId: user.brain_id})
        → chunk + embed → pgvector in Supabase
  │
  ▼
Supabase Postgres
  └── app.users (qbo_* columns), app.jobs (progress tracking)
      gbrain schema (pages, chunks, vectors — in gbrain's own tables)
```

### Recommended Project Structure

```
lib/connectors/
├── types.ts              # ConnectorVendor, ConnectorBill, ConnectorBankLine (shared)
├── crypto.ts             # encryptTokens / decryptTokens (AES-256-GCM)
├── writer.ts             # connector-blind markdown file writer
├── redact.ts             # sanitizeError — strips token fields before logging
└── qbo/
    ├── endpoints.ts      # QBO_ENV-keyed URL constants
    ├── oauth.ts          # exchange(), refresh(), revoke() via native fetch
    ├── client.ts         # listVendors / listBills / listInvoices / listPurchases / request<T>
    ├── transformer.ts    # QBO entity → ConnectorVendor / ConnectorBill / ConnectorBankLine
    └── types.ts          # QBO-specific raw entity types (Vendor, Bill, Invoice, Purchase)

lib/jobs/qbo/
└── ingest.ts             # Inngest step-divided qbo.ingest function

scripts/
└── snapshot-qbo-fixtures.ts   # one-shot fixture generator (D-11)

tests/fixtures/qbo/
├── vendor.json           # Intuit sandbox Vendor response snapshot
├── bill.json             # Bill response snapshot
├── invoice.json          # Invoice response snapshot
└── purchase.json         # Purchase response snapshot

app/api/connections/quickbooks/
├── start/route.ts        # POST — build authorize URL
├── callback/route.ts     # GET — code exchange + job enqueue
├── resync/route.ts       # POST — wipe + re-enqueue
└── disconnect/route.ts   # POST — revoke + clear columns

app/connections/quickbooks/
└── page.tsx              # /connections/quickbooks status page

app/dash/[id]/sync/
└── page.tsx              # post-callback sync-progress screen

components/connections/
├── reconnect-banner.tsx  # yellow sticky banner (client component)
└── qbo-empty-callout.tsx # connect CTA card (server-renderable)

scripts/migrations/
└── 007-add-qbo-status-columns.ts   # additive: 3 new columns on app.users
```

---

## Domain 1: Intuit OAuth 2.0

### Endpoint Constants

[VERIFIED via satvasolutions.com/blog/quickbooks-online-api-guide and zuplo.com/learning-center/quickbooks-api]

```typescript
// lib/connectors/qbo/endpoints.ts
const isSandbox = (process.env.QBO_ENV ?? "sandbox") === "sandbox";

export const QBO_OAUTH_AUTHORIZE_URL =
  "https://appcenter.intuit.com/connect/oauth2";
// Both sandbox and production share the same OAuth infrastructure:
export const QBO_OAUTH_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const QBO_OAUTH_REVOKE_URL =
  "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export const QBO_API_BASE = isSandbox
  ? "https://sandbox-quickbooks.api.intuit.com/v3/company"
  : "https://quickbooks.api.intuit.com/v3/company";

// Pin minorversion=75 (Intuit deprecated minorversions 1-74 as of 2025):
export const QBO_MINOR_VERSION = "75";

export const QBO_SCOPE = "com.intuit.quickbooks.accounting";
```

### OAuth Authorize URL Construction

```typescript
// lib/connectors/qbo/oauth.ts
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID!,
    redirect_uri: process.env.QBO_REDIRECT_URI!,
    response_type: "code",
    scope: QBO_SCOPE,
    state,
  });
  return `${QBO_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}
```

### Token Exchange (exchange code for tokens)

```typescript
// lib/connectors/qbo/oauth.ts
export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: Date;   // now + expires_in seconds
  refresh_token_expires_at: Date;  // now + x_refresh_token_expires_in seconds
}

export async function exchange(code: string): Promise<TokenBundle & { realm_id?: string }> {
  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(QBO_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.QBO_REDIRECT_URI!,
    }),
  });
  // Parse + map to TokenBundle — never log the raw body
}
```

### Token Response Shape

[VERIFIED: zuplo.com/learning-center/quickbooks-api, intuit.github.io/QuickBooks-V3-PHP-SDK/authorization.html]

```json
{
  "token_type": "bearer",
  "access_token": "<opaque>",
  "expires_in": 3600,
  "refresh_token": "<opaque>",
  "x_refresh_token_expires_in": 8640000
}
```

- `expires_in`: 3600 seconds = 1 hour. Hard-coded by Intuit; cannot be changed. [VERIFIED]
- `x_refresh_token_expires_in`: 8640000 seconds = **100 days** from issuance. [VERIFIED — matches spike findings]
- Note: Per November 2025 Intuit policy update [CITED: medium.com/intuitdev/important-changes-to-refresh-token-policy], tokens generated from Oct 2023 under `com.intuit.quickbooks.accounting` scope now have a 5-year absolute maximum. The `x_refresh_token_expires_in` returned in the response still reflects 100 days of rolling activity window (the token expires if unused for 100 days OR hits the 5-year absolute cap). For v2.0, treat `x_refresh_token_expires_in` as-is: store it as the per-token expiry.

### Refresh Token Rotation (CRITICAL)

[VERIFIED: intuit.github.io/QuickBooks-V3-PHP-SDK, nango.dev/blog/quickbooks-oauth-refresh-token-invalid-grant]

- QBO rotates the refresh token on **every exchange** (access token refresh). The old refresh token is invalidated immediately after exchange.
- Rotation cadence: daily (every 24-26 hours) per the PHP SDK docs. If the token was refreshed in the last 24 hours, Intuit may return the same refresh token. Always overwrite with whatever is returned.
- **Consequence of not persisting:** the next refresh call gets `invalid_grant`. This is the most common integration pitfall.
- **Concurrency hazard:** two simultaneous refresh calls will race; one will overwrite the other's new token with a stale value → `invalid_grant` on the next call. For this phase, Inngest step retries are sequential (not concurrent), so the race is not a risk within the job. The OAuth callback itself is user-initiated (one at a time). No mutex needed for v2.0.

```typescript
// CRITICAL discipline — inside client.ts 401 handler:
const newBundle = await refresh(storedRefreshToken);
// Persist BEFORE the retry request:
await persistTokens(userId, newBundle);
// Only then retry:
return request(endpoint, options);
```

### Revoke Token

```typescript
export async function revoke(token: string): Promise<void> {
  const credentials = Buffer.from(
    `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
  ).toString("base64");

  await fetch(QBO_OAUTH_REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ token }),
  });
  // Revoke either the access_token or refresh_token; revoking one invalidates both.
}
```

### State / CSRF Protection

[VERIFIED: D-04 decision; lib/auth/tokens.ts already ships this]

The OAuth `state` param is a HS256 JWT signed with `JWT_SECRET` (10-min TTL, `{user_id, nonce: crypto.randomUUID()}`). Callback verifies signature + TTL before code exchange. No server-side state table needed.

The callback also receives `realmId` as a query param from Intuit. Store it in `app.users.qbo_realm_id`.

---

## Domain 2: QBO API Query Language + Entity Shapes

### Query Language

[VERIFIED: zuplo.com/learning-center/quickbooks-api, satvasolutions.com/blog/quickbooks-online-api-guide]

QBO uses a SQL-like query language delivered via HTTP GET with a `query=` URL parameter:

```
GET https://sandbox-quickbooks.api.intuit.com/v3/company/{realmId}/query
  ?query=SELECT * FROM Invoice WHERE TxnDate >= '2025-05-26' STARTPOSITION 1 MAXRESULTS 1000
  &minorversion=75
```

Key rules:
- `TxnDate` format: `'YYYY-MM-DD'` (ISO date string). Use `>=` for date range. [VERIFIED]
- `STARTPOSITION` is 1-indexed. `MAXRESULTS` max is 1000. [VERIFIED]
- No cursor-based pagination; offset-based only.
- Response shape: `{ QueryResponse: { Invoice: [...], totalCount: N, startPosition: 1, maxResults: 1000 } }`

### 12-Month Cutoff Computation

```typescript
// Computed once at job start; shared across all entity queries:
const since = new Date();
since.setMonth(since.getMonth() - 12);
const sinceDate = since.toISOString().slice(0, 10); // "2025-05-26"
```

### Vendor Entity Shape

[CITED: developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor]

```json
{
  "Id": "56",
  "DisplayName": "Books by Bessie",
  "PrintOnCheckName": "Books by Bessie",
  "Active": true,
  "PrimaryEmailAddr": {
    "Address": "Books@Intuit.com"
  },
  "PrimaryPhone": { "FreeFormNumber": "650-555-5555" },
  "BillAddr": { "Line1": "15 Main St", "City": "Palo Alto" },
  "Balance": 0,
  "MetaData": { "CreateTime": "...", "LastUpdatedTime": "..." }
}
```

- Vendor email: `Vendor.PrimaryEmailAddr.Address` (nested object; the `.Address` property holds the string). [VERIFIED: apideck.com/blog/exploring-the-quickbooks-online-accounting-api]
- `Active: false` vendors can appear; the transformer SHOULD filter to `Active === true` only.
- Vendor `Id` is realm-scoped (not globally unique). The `qbo-` prefix + slugified `DisplayName` is the correct slug strategy.

### Bill Entity Shape (Vendor Expenses — AP)

[VERIFIED: developers.getknit.dev/docs/quickbooks-usecases-1]

```json
{
  "Id": "25",
  "VendorRef": { "value": "56", "name": "Books by Bessie" },
  "TxnDate": "2025-03-15",
  "TotalAmt": 500.00,
  "CurrencyRef": { "value": "USD", "name": "United States Dollar" },
  "Line": [
    {
      "Id": "1",
      "Amount": 500.00,
      "DetailType": "AccountBasedExpenseLineDetail",
      "AccountBasedExpenseLineDetail": {
        "AccountRef": { "value": "7", "name": "Advertising" }
      }
    }
  ],
  "Balance": 500.00,
  "MetaData": { "CreateTime": "...", "LastUpdatedTime": "..." }
}
```

- `Bill` = Accounts Payable (AP) — a vendor invoice you owe. Maps cleanly to `ConnectorBill`.
- `VendorRef.name` is the human-readable vendor name for transformer output.
- `TxnDate` is the bill date (NOT `MetaData.LastUpdatedTime` — see pitfalls).
- `TotalAmt` is the sum of all line amounts.
- `CurrencyRef.value` is ISO 4217; defaults to `"USD"` if absent.

### Invoice Entity Shape (Sales — AR)

[VERIFIED: developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice]

`Invoice` in QBO is a **sales** transaction — a bill you send to a customer (not a vendor expense). The brain-schema.md spec names "Invoice" as one of the entities to ingest, but in QBO's model the invoices a business receives from its vendors are `Bill` entities.

**Resolution for the transformer:** For the brain-schema contract (tracking vendor spend), ingest `Bill` as the primary AP expense entity. `Invoice` entities in QBO represent sales revenue; they carry `CustomerRef`, not `VendorRef`. The transformer should:
- Ingest `Bill` → `ConnectorBill` (vendor expense)
- Ingest `Invoice` → only if the plan interprets "invoices received from vendors" as `Bill` in QBO terms (the SPEC says "vendors, bills, invoices, and purchases" but the CONTEXT.md clarifies these are the four entity types the client is told to fetch)
- The planner should include both `Bill` AND `Invoice` queries; the transformer emits `ConnectorBill` from `Bill` records, and optionally maps `Invoice` records (AR) if the demo data requires them

**Practical recommendation for v2.0:** Ingest `Bill` + `Purchase` for vendor-side spend. Skip `Invoice` (AR). The `07-SPEC.md` acceptance criterion is file count by sandbox entity, so whatever the sandbox company has is correct. The transformer can include a type-guard: `if (!entity.VendorRef) skip`.

### Purchase Entity Shape (Direct Spend — Credit Card / Cash)

[VERIFIED: developers.getknit.dev/docs/quickbooks-usecases-1]

```json
{
  "Id": "41",
  "PaymentType": "CreditCard",
  "AccountRef": { "value": "35", "name": "MyStanrd Bank Chequing" },
  "TxnDate": "2025-02-14",
  "TotalAmt": 250.00,
  "VendorRef": { "value": "56", "name": "Books by Bessie" },
  "CurrencyRef": { "value": "USD" },
  "Line": [...]
}
```

- `Purchase` = direct payment (credit card or cash) not routed through AP. Has a `VendorRef` (may be absent for unattributed purchases).
- Maps to `ConnectorBankLine` in the connector-agnostic types (it's a bank-line / direct debit).
- The transformer must handle `VendorRef` being absent: use `vendor_slug: "qbo-unknown"` if missing.

### QBO Entity → Brain Schema Mapping (locked in docs/brain-schema.md lines 209-223)

| QBO API Field | Brain Frontmatter Field | Notes |
|---------------|------------------------|-------|
| `TxnDate` | `date` | Use `TxnDate`, NOT `MetaData.LastUpdatedTime` |
| `TotalAmt` | `amount` | Raw number, no currency symbol |
| `VendorRef.name` | `vendor` | Human-readable vendor name |
| `VendorRef.name` slugified | `vendor_slug` | `qbo-` prefix + lowercase/hyphenated; e.g. `qbo-books-by-bessie` |
| `CurrencyRef.value` | `currency` | ISO 4217; default `"USD"` if absent |

**Additional transformer outputs:**
- `type: invoice` on originals/ bill/purchase pages
- `type: vendor` + `slug: qbo-<slug>` on companies/ vendor pages
- `vendor_email:` from `PrimaryEmailAddr.Address` (required per spike findings, even if insights parsers don't consume it today)
- Wikilinks: `[[companies/qbo-<vendor-slug>]]` in body of originals/ pages

### Rate Limit

[VERIFIED: zuplo.com/learning-center/quickbooks-api]

- 500 requests/minute per realmId (standard endpoints)
- 429 status with error code `003001` on breach
- For 12 months of typical SMB data: ~200 vendors + ~500 bills = ~10-20 paginated API calls — well under the 500/min ceiling. No throttling needed for v2.0.

---

## Domain 3: AES-256-GCM Token Encryption

### Recommended Pattern

[VERIFIED: nodejs.org/api/crypto.html, gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81]

Use `crypto.createCipheriv` (not `crypto.subtle`). `createCipheriv` is synchronous, well-tested, and the standard Node.js server-side pattern. `crypto.subtle` is the Web Crypto API (primarily browser/edge-facing); in Node it works but adds async overhead and is unnecessarily complex here.

```typescript
// lib/connectors/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;  // 96-bit IV — NIST recommendation for GCM
const TAG_BYTES = 16; // 128-bit auth tag — GCM default

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY must be set");
  // Derive 32-byte key from the env string (Phase 5 established this key)
  const key = Buffer.from(raw, "utf-8");
  if (key.length < 32) throw new Error("TOKEN_ENCRYPTION_KEY must be ≥32 bytes");
  return key.subarray(0, 32);
}

export interface TokenBundle {
  access_token: string;
  refresh_token: string;
  refresh_token_expires_at: string; // ISO timestamp
  [Symbol.for("redacted")]?: true;  // D-13 brand — stripped by redact.ts
}

/** Returns base64 of: iv(12B) || authTag(16B) || ciphertext */
export function encryptTokens(bundle: TokenBundle): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const plaintext = JSON.stringify(bundle);
  const cipherBuf = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Layout: iv(12) || authTag(16) || ciphertext
  return Buffer.concat([iv, tag, cipherBuf]).toString("base64");
}

/** Decrypts base64(iv || authTag || ciphertext) → TokenBundle */
export function decryptTokens(encrypted: string): TokenBundle {
  const buf = Buffer.from(encrypted, "base64");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf-8");
  return JSON.parse(plaintext) as TokenBundle;
}
```

**Key storage note:** `TOKEN_ENCRYPTION_KEY` is a plain UTF-8 string (established Phase 5). The helper takes the first 32 bytes. If the env value is base64-encoded, the planner should confirm or document the expected encoding. For now, treat as UTF-8 per Phase 5 precedent.

---

## Domain 4: Inngest Step-Divided Job Pattern

### How the Existing runJob Generic Function Works

[VERIFIED: lib/inngest/functions.ts — direct codebase read]

`runJob` in `lib/inngest/functions.ts` is triggered by `"app/job.requested"` events. It calls `JOB_REGISTRY[kind](params, reportProgress)`. The QBO ingest job adds to this registry — it does NOT create a separate Inngest function.

This is important: Phase 7 does NOT call `inngest.createFunction()` for `qbo.ingest`. Instead it exports a `JobOperation` from `lib/jobs/qbo/ingest.ts` and registers it in `JOB_REGISTRY` under `"qbo-ingest"`. The step-division described in D-07 happens within the operation using the `step` handle passed by `runJob`.

Wait — checking the `runJob` signature: the operation is called with `op(params, reportProgress)` inside a single `step.run("execute", ...)`. The `step` object is NOT passed to `JobOperation`. The five phases in D-07 are therefore sequential `await` calls within the single `"execute"` step — NOT five separate `step.run()` boundaries.

**Implication for D-07:** The five "phases" are sequential operations within `runJob`'s single `"execute"` step. Each phase calls `reportProgress()` to update the job row. If the entire execute step fails and Inngest retries, the whole ingest restarts. This is acceptable for v2.0 (wipe-and-reingest semantics anyway).

**Alternative (if deeper step isolation is needed):** Create a dedicated `inngest.createFunction()` for `qbo.ingest` (separate from `runJob`) and register it in `app/api/inngest/route.ts`. This enables per-phase `step.run()` retries. The CONTEXT.md D-07 says "Register `qbo.ingest` as a step-divided Inngest function in `lib/jobs/qbo/ingest.ts`" which implies a dedicated function. The planner must choose: generic `runJob` (simpler) vs dedicated function (better isolation). Research recommendation: **dedicated function** — D-07 explicitly says "step-divided" and `runJob` doesn't thread `step` into operations.

### Dedicated Inngest Function Pattern (recommended)

```typescript
// lib/jobs/qbo/ingest.ts
import { inngest } from "@/lib/inngest/client";
import { setRunning, updateProgress, finishJob, failJob } from "@/lib/jobs/store";

export const qboIngest = inngest.createFunction(
  {
    id: "qbo-ingest",
    retries: 2, // each step retries independently
    triggers: [{ event: "app/qbo.ingest.requested" }],
  },
  async ({ event, step }) => {
    const { jobId, userId, brainSlug } = event.data as { ... };

    await step.run("mark-running", () => setRunning(jobId));

    const vendors = await step.run("fetch-vendors", async () => {
      await updateProgress(jobId, { stage: "vendors", percent: 20 });
      return fetchVendors(userId);
    });

    const transactions = await step.run("fetch-transactions", async () => {
      await updateProgress(jobId, { stage: "invoices", percent: 40 });
      return fetchTransactions(userId, since);
    });

    await step.run("write-documents", async () => {
      await updateProgress(jobId, { stage: "writing", percent: 60 });
      await writeMarkdown(brainSlug, vendors, transactions);
    });

    await step.run("reindex", async () => {
      await updateProgress(jobId, { stage: "indexing", percent: 80 });
      await reindexBrain(brainSlug, userId);
    });

    await step.run("mark-done", () => finishJob(jobId, { vendorCount, txnCount }));
  },
);
```

If using a dedicated function, enqueue via a DIFFERENT event name (e.g., `"app/qbo.ingest.requested"`) to avoid conflicting with `runJob`'s `"app/job.requested"` handler.

**Register in `app/api/inngest/route.ts`:**
```typescript
const { GET, POST, PUT } = serve({ client: inngest, functions: [runJob, qboIngest] });
```

### Inngest Limits Relevant to QBO Ingest

[VERIFIED: inngest.com/docs/usage-limits/inngest]

- Step return data: 4MB max
- Function run state (all steps combined): 32MB max
- Maximum steps per function: 1000
- Event payload size: 256KB (free tier)

For a typical 12-month SMB dataset (200 vendors + 500 bills): vendor JSON ≈ 200 × 2KB = 400KB, transaction JSON ≈ 500 × 3KB = 1.5MB. Both under 4MB per step. Write all markdown in a single `"write-documents"` step (batch, not per-file steps) to stay far from the 1000 step limit.

---

## Domain 5: gbrain Reindex / Document Ingest

### The Correct API: importFromContent

[VERIFIED: direct read of node_modules/gbrain/src/core/import-file.ts]

`importFromContent(engine, slug, content, opts)` is the in-process gbrain function for indexing a markdown document. It is NOT exposed through the current `types/gbrain.ts` shim — the shim only exports `createEngine`, `hybridSearch`, `expandQuery`, `configureGateway`, and `runThink`.

**Phase 7 must add `importFromContent` to the gbrain shim** in `types/gbrain.ts`:

```typescript
// Add to types/gbrain.ts
export interface ImportResult {
  slug: string;
  status: "imported" | "skipped" | "error";
  chunks: number;
  error?: string;
}

export async function importFromContent(
  engine: BrainEngine,
  slug: string,
  content: string,
  opts?: {
    noEmbed?: boolean;
    sourceId?: string;
    filename?: string;
    sourcePath?: string;
    forceRechunk?: boolean;
  }
): Promise<ImportResult> {
  const m = await _load("import-file");
  return m.importFromContent(engine, slug, content, opts) as Promise<ImportResult>;
}
```

### importFromContent Call Pattern for QBO

```typescript
// In the "indexing" step of the ingest job:
const engine = await createGBrainEngine(); // from lib/gbrain/engine.ts
const sourceId = user.brain_id; // session-derived (D-11)

for (const { slug, content } of markdownDocs) {
  await importFromContent(engine, slug, content, {
    sourceId,
    forceRechunk: true, // re-sync wipes files; force re-index on resync
  });
}
```

### Slug Convention for QBO Documents

- Originals: `originals/qbo-<bill-id>` (e.g., `originals/qbo-bill-25`)
- Companies: `companies/qbo-<vendor-slug>` (e.g., `companies/qbo-books-by-bessie`)

The `slug` passed to `importFromContent` must match the relative path used for wikilinks in the markdown body (`[[companies/qbo-books-by-bessie]]`).

### gbrain deleteSource for Re-Sync Wipe

For the "Indexing for search" step on re-sync, after deleting the files, call gbrain to remove the old chunks from the vector index. Look for `deleteSource` or equivalent in the gbrain engine. From the codebase listing, `sources-ops.ts` is the likely home. The planner should add a Wave 0 investigation task: inspect `node_modules/gbrain/src/core/sources-ops.ts` for the correct delete-by-slug-prefix API. If no bulk delete exists, delete individual slugs by iterating the file list before deletion.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| OAuth CSRF protection | Custom state nonce table | HS256 JWT state (lib/auth/tokens.ts) | Already exists; stateless; zero new table |
| Token encryption | Custom XOR or Base64 "encoding" | `crypto.createCipheriv("aes-256-gcm")` | GCM provides both confidentiality + tamper detection |
| Token logging protection | Manual field-by-field exclusion | `TokenBundle` brand + `lib/connectors/redact.ts` | Structural, not reviewer-dependent |
| QBO pagination | Custom cursor logic | `STARTPOSITION` + `MAXRESULTS` offset loop | QBO's only pagination mechanism |
| Progress tracking | New progress table | `lib/jobs/store.ts::updateProgress` | Already exists; `<JobProgress>` polls it |
| Inngest event dispatch | Raw HTTP to Inngest API | `inngest.send()` from `lib/inngest/client.ts` | Already exists; handles signing |

---

## Common Pitfalls

### Pitfall 1: Not Persisting the Rotated Refresh Token Before the Retry

**What goes wrong:** `refresh()` returns a new `{access_token, refresh_token}`. The code retries the original API call before persisting the new `refresh_token`. On the next 401, `refresh()` uses the stale (now-invalid) refresh token → `invalid_grant` → forced reconnect.

**Why it happens:** Developers think "I'll persist after the whole request succeeds." Intuit invalidates the old token immediately on exchange.

**How to avoid:** In `client.ts`'s 401 handler: `const bundle = await refresh(...); await persistTokens(userId, bundle); const result = await retry(request);` — persist is always step 2, not step 3.

**Warning signs:** Users report "sudden disconnect" every 24-26 hours.

### Pitfall 2: Using MetaData.LastUpdatedTime Instead of TxnDate for the 12-Month Filter

**What goes wrong:** The query filters on `MetaData.LastUpdatedTime >= cutoff` instead of `TxnDate`. This returns recently-edited old transactions and misses transactions that haven't been edited.

**Why it happens:** `MetaData.LastUpdatedTime` is what you'd use for incremental sync (change detection). For initial load, `TxnDate` is correct.

**How to avoid:** Always use `WHERE TxnDate >= '${since}'` for date-range queries. This is locked in `docs/brain-schema.md` lines 209-223.

### Pitfall 3: Calling importFromContent Without the sourceId

**What goes wrong:** Indexed documents land in the default source partition, not the user's partition. Other users' queries may surface QBO data (tenant isolation violation).

**Why it happens:** `sourceId` is an optional parameter; it's easy to omit.

**How to avoid:** Every `importFromContent` call in the ingest job MUST pass `{ sourceId: user.brain_id }`. The `brain_id` comes from `resolveTenant()` or from the job params (user's `brain_id` stored at job-create time).

### Pitfall 4: Trusting Invoice in QBO = Vendor Expense

**What goes wrong:** The transformer queries `SELECT * FROM Invoice WHERE TxnDate >= ...` expecting vendor bills. In QBO, `Invoice` is an Accounts Receivable (AR) document (money customers owe you). It carries `CustomerRef`, not `VendorRef`. Result: zero matches or wrong entity type.

**How to avoid:** Map vendor expenses to `Bill` and direct-payment expenses to `Purchase`. Optionally query `Invoice` for revenue-side data, but do not expect vendor names from `Invoice.VendorRef`.

### Pitfall 5: Sandbox Callback URL Mismatch

**What goes wrong:** The Intuit sandbox app is configured with `http://localhost:3000/api/connections/quickbooks/callback`, but the app runs on a different port or the Vercel preview URL. OAuth fails with "redirect_uri_mismatch".

**How to avoid:** The `QBO_REDIRECT_URI` env var must exactly match a URI registered in the Intuit Developer dashboard. For local dev: `http://localhost:3000/api/connections/quickbooks/callback`. For Vercel preview: the preview URL must also be registered. Register both at app setup time.

### Pitfall 6: Inngest Event Payload > 256KB on Free Tier

**What goes wrong:** The OAuth callback includes QBO API response data in the Inngest event payload; for large companies this exceeds 256KB and Inngest rejects the event.

**How to avoid:** The job params must contain only identifiers (`userId`, `brainSlug`, `realmId`) — NOT the QBO API responses. The Inngest job fetches QBO data from within its steps, not from the event payload.

### Pitfall 7: Missing `runtime = "nodejs"` + `dynamic = "force-dynamic"` on New Routes

**What goes wrong:** New route handlers default to Edge runtime or get statically optimized, breaking `postgres` client usage and `lib/auth/resolve-tenant.ts`.

**How to avoid:** Every new route file in `app/api/connections/quickbooks/` must include:
```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

### Pitfall 8: slug Collision Between Seed Data and QBO Data

**What goes wrong:** A vendor in QBO named "Beanstalk Roasters" produces slug `beanstalk-roasters`, which collides with the seed tenant's synthetic `companies/beanstalk-roasters.md`.

**How to avoid:** Always prefix QBO slugs with `qbo-`. This is locked: `qbo-beanstalk-roasters`. The seed tenant uses unprefixed slugs, so no collision.

---

## Code Examples

### Vendor Page Markdown (companies/qbo-books-by-bessie.md)

```markdown
---
type: vendor
slug: qbo-books-by-bessie
vendor_email: Books@Intuit.com
---

# Books by Bessie

- 2025-01-10: Invoice received — $500 [[companies/qbo-books-by-bessie]]
- 2025-02-14: Invoice received — $250 [[companies/qbo-books-by-bessie]]
```

### Bill/Originals Markdown (originals/qbo-bill-25.md)

```markdown
---
type: invoice
vendor: Books by Bessie
vendor_slug: qbo-books-by-bessie
date: 2025-03-15
amount: 500.00
currency: USD
---

Invoice from [[companies/qbo-books-by-bessie]] on 2025-03-15 for $500.00 USD.
```

### QBO Query for Bills (last 12 months)

```typescript
// lib/connectors/qbo/client.ts
async listBills(since: string): Promise<QBOBill[]> {
  const q = encodeURIComponent(
    `SELECT * FROM Bill WHERE TxnDate >= '${since}' MAXRESULTS 1000`
  );
  const res = await this.request<{ QueryResponse: { Bill?: QBOBill[]; totalCount: number } }>(
    `/query?query=${q}&minorversion=${QBO_MINOR_VERSION}`
  );
  return res.QueryResponse.Bill ?? [];
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `intuit-oauth` SDK | Native fetch OAuth | D-03 locked | Eliminates Express coupling; 100 LOC vs 3MB dep |
| `node-quickbooks` | Raw fetch QBO client | D-05 locked | Full TS types; no callback-style API |
| Separate `qbo_connections` table | `app.users` QBO columns | D-01 (Phase 6 carry-forward) | Single-table tenant read; no JOIN |
| 100-day refresh TTL (rolling) | 5-year absolute max + 100-day activity window | Intuit Nov 2025 policy | `x_refresh_token_expires_in` in response is still 8640000s (100 days); store as-is |
| `minorversion=1-74` | All deprecated; minimum is 75 | Intuit 2025 | Always pass `?minorversion=75` |

**Deprecated/outdated:**
- `intuit-oauth` npm package: last published 2023, Express-coupled, not recommended for new serverless integrations.
- QBO API minorversions 1–74: deprecated by Intuit in 2025; requests default to v75 but pin explicitly.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `x_refresh_token_expires_in = 8640000` (100 days) is still the value returned in token responses despite the 5-year policy update | Domain 1 | Token expiry stored incorrectly; reconnect banner fires too early or too late |
| A2 | `importFromContent` in the gbrain shim can be added as a new export without breaking existing exports | Domain 5 | Shim update breaks existing engine usage; needs careful testing |
| A3 | Intuit sandbox "Company_US_1" has Vendor, Bill, and Purchase records in the last 12 months | Domain 2 | Zero files written; acceptance criteria fails; need to seed sandbox data manually |
| A4 | `sources-ops.ts` in gbrain exposes a function to delete documents by slug prefix for re-sync wipe | Domain 5 | Re-sync may leave orphaned vectors; alternative is full re-embed rather than targeted delete |
| A5 | The `TOKEN_ENCRYPTION_KEY` env is a UTF-8 string (first 32 bytes used as AES key) | Domain 3 | Decryption fails if key was base64-stored; confirm with Phase 5 implementation |

---

## Open Questions

1. **gbrain deleteSource API for re-sync**
   - What we know: `node_modules/gbrain/src/core/sources-ops.ts` exists
   - What's unclear: whether it exposes a bulk-delete-by-slug-prefix operation, or only per-slug delete
   - Recommendation: Wave 0 task — inspect `sources-ops.ts` exports; if no bulk delete, implement re-sync wipe as: delete files → re-run `importFromContent` with `forceRechunk: true` (the existing doc gets overwritten, stale chunks garbage-collected by gbrain on next import)

2. **Dedicated `qboIngest` Inngest function vs generic `runJob`**
   - What we know: D-07 says "step-divided Inngest function"; `runJob` wraps the entire operation in a single `step.run("execute")`; step-division requires passing `step` to the operation
   - What's unclear: D-07's intent — whether "step-divided" means true `step.run()` boundaries or just sequential phases with `updateProgress()` calls
   - Recommendation: Create a dedicated `inngest.createFunction({ id: "qbo-ingest" })` registered alongside `runJob` in the serve route. Use a different event name (`"app/qbo.ingest.requested"`). This enables per-phase retry isolation and matches D-07's "step-divided" wording.

3. **Sandbox Company data availability**
   - What we know: D-12 specifies "Sandbox Company_US_1"
   - What's unclear: whether this company has Bills and Purchases in the last 12 months, or whether the operator must manually add test data
   - Recommendation: Planner should add a Wave 0 task: "Operator verifies Sandbox Company_US_1 has ≥1 Bill and ≥1 Purchase dated within last 12 months; if not, adds them via the QBO sandbox UI before running acceptance tests."

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun runtime | gbrain importFromContent (raw .ts loading) | ✓ | Not verified in CI — inherits Phase 6 constraint | Use `bun node_modules/.bin/next start` for prod |
| Node.js `crypto` | AES-256-GCM encryption | ✓ | Node 24.7.0 | — |
| Inngest SDK | Background job dispatch | ✓ | `^4.4.0` (installed) | — |
| `QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` / `QBO_REDIRECT_URI` | OAuth flow | NOT SET | Operator precondition | Phase blocked until operator registers Intuit sandbox app |
| `TOKEN_ENCRYPTION_KEY` | Token encryption | Assumed set (Phase 5) | — | Phase blocked if missing |
| `JWT_SECRET` | OAuth state JWT | Assumed set (Phase 6) | — | Phase blocked if missing |

**Missing dependencies blocking execution:**
- `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` — operator must register Intuit sandbox app at developer.intuit.com before any OAuth testing. This is the SPEC-documented operator precondition.

**Missing dependencies with fallback:**
- None beyond the above.

---

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (uses existing Phase 6 session auth) | `resolveTenant()` — all new routes MUST call this first |
| V3 Session Management | No (existing Phase 6 session cookies) | — |
| V4 Access Control | Yes | `resolveTenant()` chokepoint — never trust `params.id` for tenant identity |
| V5 Input Validation | Yes | Zod validation on all route handler bodies; QBO API responses validated by TypeScript types |
| V6 Cryptography | Yes | AES-256-GCM for token encryption; HS256 JWT for state param |

### Threat Patterns for OAuth + Token Storage

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CSRF on OAuth callback | Spoofing | HMAC-signed state JWT (D-04) verified before code exchange |
| Token theft via logs | Information Disclosure | `TokenBundle` brand + `redact.ts` + Sentry strip (D-13) |
| Token theft via API response | Information Disclosure | Tokens never returned in HTTP response bodies; encrypted at rest |
| Stale refresh token → reconnect loop | Denial of Service | Persist new refresh_token BEFORE retry (D-05 discipline) |
| Tenant isolation violation via QBO import | Elevation of Privilege | `sourceId` required on every `importFromContent` call |
| SQL injection via QBO query params | Tampering | QBO date params are computed server-side (never user input); tagged-template SQL for all DB writes |
| Redirect URI mismatch / open redirect | Spoofing | `redirect_uri` is a server-side constant from env, never user-supplied |

---

## Sources

### Primary (HIGH confidence)
- **lib/connectors/crypto.ts** pattern — direct Node.js crypto docs: [nodejs.org/api/crypto.html](https://nodejs.org/api/crypto.html) + [gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81](https://gist.github.com/rjz/15baffeab434b8125ca4d783f4116d81)
- **QBO OAuth endpoints** — [satvasolutions.com/blog/quickbooks-online-api-guide](https://satvasolutions.com/blog/quickbooks-online-api-guide) + [zuplo.com/learning-center/quickbooks-api](https://zuplo.com/learning-center/quickbooks-api)
- **QBO entity shapes + query language** — [developers.getknit.dev/docs/quickbooks-usecases-1](https://developers.getknit.dev/docs/quickbooks-usecases-1) + [apideck.com/blog/exploring-the-quickbooks-online-accounting-api](https://www.apideck.com/blog/exploring-the-quickbooks-online-accounting-api)
- **Token rotation discipline** — [intuit.github.io/QuickBooks-V3-PHP-SDK/authorization.html](https://intuit.github.io/QuickBooks-V3-PHP-SDK/authorization.html) + [nango.dev/blog/quickbooks-oauth-refresh-token-invalid-grant](https://www.nango.dev/blog/quickbooks-oauth-refresh-token-invalid-grant)
- **Refresh token policy update (Nov 2025)** — [medium.com/intuitdev/important-changes-to-refresh-token-policy-8443779d40db](https://medium.com/intuitdev/important-changes-to-refresh-token-policy-8443779d40db)
- **Inngest limits** — [inngest.com/docs/usage-limits/inngest](https://www.inngest.com/docs/usage-limits/inngest)
- **gbrain importFromContent API** — direct read of `node_modules/gbrain/src/core/import-file.ts` lines 187-240 [VERIFIED]
- **Existing job infrastructure** — direct read of `lib/inngest/functions.ts`, `lib/jobs/registry.ts`, `lib/jobs/store.ts`, `lib/jobs/types.ts`, `lib/jobs/schemas.ts`, `app/api/jobs/route.ts` [VERIFIED]
- **QBO columns on app.users** — direct read of `scripts/setup-auth-tables.ts` lines 59-79 [VERIFIED]
- **lib/auth/resolve-tenant.ts** — direct read [VERIFIED]
- **lib/auth/tokens.ts** — direct read [VERIFIED]
- **Spike 002 / accounting-connectors.md** — direct read of `.claude/skills/spike-findings-quick-brain/references/accounting-connectors.md` [VERIFIED]
- **docs/brain-schema.md** — direct read lines 209-223 [VERIFIED]

### Secondary (MEDIUM confidence)
- **x_refresh_token_expires_in = 8640000** — cross-reference of PHP SDK docs + Nango blog; Intuit official docs page content was inaccessible (rendered empty)
- **QBO revoke URL** = `https://developer.api.intuit.com/v2/oauth2/tokens/revoke` — satvasolutions.com + nango.dev agreement; official docs page inaccessible
- **minorversion=75** (minimum, all 1-74 deprecated) — zuplo.com; Intuit changelog inaccessible

### Tertiary (LOW confidence)
- None — all critical claims have at least medium-confidence verification.

---

## Metadata

**Confidence breakdown:**
- OAuth endpoints + token shape: MEDIUM — official Intuit docs page returned empty HTML; confirmed via two independent technical blogs that agree
- Token rotation discipline: HIGH — PHP SDK docs + Nango blog + spike findings all agree
- QBO entity shapes: HIGH — getknit.dev + apideck.com agree on Bill/Vendor/Purchase shapes
- gbrain importFromContent API: HIGH — direct codebase read of actual source
- Inngest job pattern: HIGH — direct codebase read of existing runJob implementation
- AES-256-GCM pattern: HIGH — Node.js official docs + rjz gist

**Research date:** 2026-05-26
**Valid until:** 2026-07-01 (Intuit API stable; refresh token policy change is recent but documented)
