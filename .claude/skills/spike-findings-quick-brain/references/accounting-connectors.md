# Accounting Connector Strategy

## Requirements

Non-negotiable design decisions from spike 002. Apply to any work in `lib/qbo/` (v1.1 Phase 6) or any future connector adapter.

- **v1.1 Phase 6 stays QBO-only.** Highest US SMB market share (~80%), best raw throughput (500 req/min), longest refresh tokens (100 days). No multi-connector work in v1.1.
- **Name connector-agnostic types from day one** in a shared file. Proposed path: `lib/connectors/types.ts`. Shapes: `Bill`, `Vendor`, `BankLine`, `Invoice`. Each connector's transformer outputs these shapes; the markdown writer is connector-blind.
- **The transformer module is per-connector**, at `lib/connectors/<connector>/transformer.ts`. v1.1 ships `lib/connectors/qbo/transformer.ts`. v1.2 will add `lib/connectors/xero/transformer.ts`. Same interface, different bodies.
- **All connectors emit `qbo-` / `xero-` / `<connector>-` prefixed slugs** on vendor pages (`companies/qbo-beanstalk.md`). Prevents collision when a tenant carries both synthetic seed and live data.
- **Vendor email is a required transformer output** when the source connector exposes it (QBO + Xero). It populates `companies/<connector>-<slug>.md` frontmatter as `vendor_email: <address>`. Downstream features (Spike 001's vendor digest) depend on this field.
- **Refresh-token persistence is connector-uniform**: every connector must persist the newest `refresh_token` immediately after every token exchange. Intuit (QBO) rotates every 24-26h since Nov 2025; Xero rotates per-refresh. A "Reconnect" banner fires at `(token_age / token_lifetime) > 0.86`.
- **No connector without a `Bill` / `Invoice` / `Vendor` first-class entity.** Wave and FreshBooks both fail this test (free-text vendor names). Don't pursue them unless the persona shifts toward freelancer/solo operators.

## How to Build It

### v1.1 — QBO single connector

Already covered by `.planning/research/SUMMARY.md` and the v1.1 Phase 6 plan in REQUIREMENTS.md (QBO-01..13). One refinement from spike 002:

```
lib/connectors/types.ts                  # NEW — shared types
lib/connectors/qbo/oauth.ts              # was lib/qbo/oauth.ts
lib/connectors/qbo/client.ts             # was lib/qbo/client.ts
lib/connectors/qbo/transformer.ts        # was lib/qbo/transformer.ts
lib/connectors/qbo/encrypt.ts            # was lib/qbo/encrypt.ts
```

Reason: this is a 1-line rename in v1.1 Phase 6 that saves a multi-file refactor in v1.2 when Xero arrives. The Phase 6 PLAN.md should be updated to use the `lib/connectors/qbo/` path before execute begins.

Suggested `lib/connectors/types.ts` shape (matches `docs/brain-schema.md` from Phase 4):

```typescript
export interface ConnectorVendor {
  source: 'qbo' | 'xero';
  source_id: string;          // realm-scoped vendor id
  slug: string;               // e.g. "qbo-beanstalk-roasters"
  display_name: string;       // "Beanstalk Roasters"
  email?: string;             // top-level for both QBO + Xero
  currency: string;           // ISO 4217
}

export interface ConnectorBill {
  source: 'qbo' | 'xero';
  source_id: string;
  vendor_slug: string;        // links to ConnectorVendor.slug
  date: string;               // YYYY-MM-DD
  amount: number;             // in vendor's currency, no rounding
  currency: string;
  description: string;        // free text, line-items joined
  raw: unknown;               // verbatim API response for debugging
}

export interface ConnectorBankLine {
  source: 'qbo' | 'xero';
  source_id: string;
  vendor_slug?: string;       // optional — bank lines often unattributed
  date: string;
  amount: number;             // signed: negative = spend, positive = receive
  currency: string;
  description: string;
  raw: unknown;
}
```

Each connector's transformer is a pure function returning these shapes. The markdown writer (`lib/connectors/<source>/markdown.ts`, or shared as `lib/connectors/markdown.ts`) walks these and emits the brain pages.

### v1.2 — Add Xero as the second connector

When the time comes:

1. Generate an app at developer.xero.com → use Demo Company immediately (no separate sandbox env, no manual seeding — the data is preloaded).
2. Install `xero-node` (official, TS-first, no native binds, Bun-compatible).
3. Implement `lib/connectors/xero/{oauth,client,transformer,encrypt}.ts` against the same `ConnectorBill` / `ConnectorVendor` / `ConnectorBankLine` shapes.
4. Add Xero-specific quirks:
   - **OAuth scopes**: `accounting.transactions` + `accounting.contacts` + `offline_access`.
   - **Header `xero-tenant-id`** required on every API call (analogous to QBO's `realmId`).
   - **Filter `Contact.IsSupplier === true`** to get vendor-side contacts (Xero combines customers + vendors in one `Contact` entity).
   - **Map `Invoice.Type === 'ACCPAY'`** to `ConnectorBill` (Xero's "Bill" is exposed as `Invoice` with the `ACCPAY` type discriminator).
   - **Use `BankTransaction.Type` (`SPEND`/`RECEIVE`) directly** — cleaner than QBO's `Purchase`/`Deposit` split.
   - **Reconnect banner fires at day 50** (Xero refresh tokens last 60 days, not 100 like QBO).
   - **Rate limit: 60/min and 5000/day** — back off using `X-MinLimit-Remaining` + `X-DayLimit-Remaining` response headers. Implement backoff once, share across connectors.
5. UI: dashboard "Connect" button becomes a dropdown — Connect QuickBooks / Connect Xero. The flows mount under `/api/connectors/{qbo,xero}/{connect,callback,sync,disconnect}`.

### Refresh-token rotation pattern (uniform across connectors)

```typescript
async function refreshTokens(connector: 'qbo' | 'xero', userId: string) {
  const stored = await loadTokens(userId, connector);
  const fresh = await connectors[connector].oauth.refresh(stored.refresh_token);

  // CRITICAL: persist newest refresh_token IMMEDIATELY. Both QBO and Xero
  // rotate refresh tokens on every exchange. A stale refresh_token write
  // results in invalid_grant on the next call.
  await saveTokens(userId, connector, {
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,  // <-- new token, must persist
    expires_at: Date.now() + fresh.expires_in * 1000,
    issued_at: Date.now(),
  });

  return fresh.access_token;
}
```

The `refreshTokens` function is identical for QBO and Xero — same persistence pattern, same write-immediately discipline.

## What to Avoid

- **Do NOT add Wave as a connector.** Wave deprecated new public-developer API access in 2024 — your app registration will be rejected. Even if Wave reverses course, the data model is wrong (no `Bill` entity, free-text vendor names). Hard skip.
- **Do NOT add FreshBooks as a connector for the SMB persona.** The 12-hour refresh-token TTL fights every scheduled-sync use case (Phase 6 background refresh + Spike 001 weekly digest). The Time Tracking + Expense OCR surfaces are interesting *only* for a hypothetical freelancer SKU — not for Mara.
- **Do NOT use Wave's GraphQL endpoint as a model for our own.** GraphQL doesn't simplify integration complexity, it just shifts where the complexity lives (cursor pagination is harder than offset/limit). Don't be seduced by "modern API stack" framing.
- **Do NOT write `lib/qbo/` in v1.1.** Write `lib/connectors/qbo/` from the start. Saves the v1.2 refactor.
- **Do NOT key the encryption-at-rest pattern to a specific connector.** The `TOKEN_ENCRYPTION_KEY` and `node:crypto` AES-256-GCM pattern is generic; reuse for Xero verbatim.
- **Do NOT skip writing the canonical schema doc (`docs/brain-schema.md`) in Phase 4.** The v1.2 Xero transformer needs that contract to know which fields to emit. It's a Phase 4 deliverable (SKIL-08) that quietly underwrites Phase 6 + v1.2.
- **Do NOT model vendor and customer as a single combined entity in QuickBrain's internal types** even though Xero does so externally. Filter early in the Xero transformer; the rest of the app sees clean `ConnectorVendor` records only.

## Constraints

### QBO (v1.1)

| Axis | Value |
|---|---|
| OAuth scope | `com.intuit.quickbooks.accounting` |
| Rate limit | 500 req/min per realm |
| Refresh token TTL | 100 days from issuance |
| Refresh token rotation | Every 24-26h (since Nov 2025) |
| Sandbox URL | `sandbox-quickbooks.api.intuit.com` (env-switch in code) |
| Vendor email field | `Vendor.PrimaryEmailAddr.Address` (nested) |
| Bank-feed access | Not in Accounting API; use `Purchase` + `Bill` + `Deposit` |
| TS SDK | Community-maintained `node-quickbooks` — needs `declare module` shim |

### Xero (v1.2)

| Axis | Value |
|---|---|
| OAuth scopes | `accounting.transactions accounting.contacts offline_access` |
| Rate limit | 60 req/min + 5000 req/day per tenant |
| Refresh token TTL | 60 days from issuance |
| Refresh token rotation | Every refresh |
| Sandbox | Demo Company on same URL, no env-switch |
| Vendor email field | `Contact.EmailAddress` (flat string) |
| Bank-feed access | Not raw, but `BankTransaction` is closer to our `bank-statement` shape than QBO's split |
| TS SDK | Official `xero-node` — TS-first, ~5MB install |

### Persona fit

- **QBO**: ~80% US SMB market share; Mara is the canonical fit.
- **Xero**: dominant in NZ / AU / UK; meaningful US presence in design/consulting niches.
- **Wave**: freelancer/solo niche; access deprecated.
- **FreshBooks**: service-business freelancers (consultants, agencies); not Mara.

## Origin

Synthesized from spikes: **002 (parent), 002a-xero, 002b-wave, 002c-freshbooks** — verdict VALIDATED ✓ (keep QBO, add Xero in v1.2, skip Wave + FreshBooks).

Source files available in:
- `sources/comparison.html` — 4-way head-to-head matrix
- `sources/README.md` — parent verdict summary
- `sources/002a-xero/README.md`
- `sources/002b-wave/README.md`
- `sources/002c-freshbooks/README.md`
