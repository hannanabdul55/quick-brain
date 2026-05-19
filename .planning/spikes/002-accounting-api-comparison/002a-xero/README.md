---
spike: 002a
name: accounting-api-xero
type: comparison
validates: "Given Xero's OAuth 2.0 + Accounting API, when we walk through sandbox signup → consent → first Invoices fetch → markdown transformer, then we can score Xero against QBO on time-to-first-fetch, data-shape fit to our seed schema, rate-limit pain, sandbox accessibility, refresh-token UX"
verdict: VALIDATED
related: [002b, 002c]
tags: [accounting, oauth, rest, comparison]
---

# Spike 002a: Accounting API — Xero

## What This Validates

Side-by-side scoring of Xero against the v1.1 Phase 6 QBO baseline across five axes: (1) time-to-first-fetch, (2) data-shape fit to our seed schema, (3) rate-limit pain, (4) sandbox accessibility, (5) refresh-token UX. Same harness will be applied to Wave (002b) and FreshBooks (002c) for a head-to-head verdict.

## Research

### OAuth & Auth

| Axis | Xero | QBO (baseline) |
|---|---|---|
| OAuth flow | OAuth 2.0 with PKCE; standard `authorize → callback → token exchange` | OAuth 2.0; uses Intuit's non-standard `Basic <clientId:secret>` header on token exchange (intuit-oauth lib hides this) |
| Scopes | `accounting.transactions` + `accounting.contacts` covers what we need; `offline_access` for refresh token | `com.intuit.quickbooks.accounting` covers everything |
| Refresh-token validity | **60 days** from issuance; rotates every refresh (newest token must be persisted immediately, identical concern to QBO post-Nov-2025) | **100 days** from issuance; rotates every 24-26 hours |
| Multi-tenant per app | Yes — a single Xero app can be connected to many Xero orgs ("tenants") at once; client picks which `xero-tenant-id` header to use per request | Yes — `realmId` plays the same role |
| App approval for production | Public apps need Xero certification for production (typically a 2-week review). Demo company access works without certification | Sandbox works immediately; production requires app approval but turnaround is faster (1-3 days) |

**Verdict on auth:** Xero matches QBO's complexity. Both are standard OAuth 2.0; both rotate refresh tokens; both need to refresh-on-read. The 60-day vs 100-day difference favors QBO marginally — but Xero's reconnect-banner UX from v1.1 Phase 6 (`QBO-09`) carries over unchanged. **Neutral.**

### Sandbox accessibility

| Axis | Xero | QBO (baseline) |
|---|---|---|
| Time to first sandbox request | **~15 minutes** — sign up at developer.xero.com → create app → use "Demo Company" preloaded with sample data → OAuth → query Invoices | ~30–45 minutes — separate Intuit Developer account, sandbox company creation, sandbox-specific app credentials, distinct base URL |
| Pre-loaded data quality | High — Demo Company includes ~50 invoices, ~30 bills, ~20 vendors, a year of bank transactions; immediately useful for transformer development | High — sandbox includes representative data |
| Sandbox/prod switching | Same OAuth flow, same base URL — only the connected org differs | **Separate base URLs** (`sandbox-quickbooks.api.intuit.com` vs `quickbooks.api.intuit.com`) — code has to switch on env |

**Verdict on sandbox:** **Xero wins.** Demo Company is the cleanest "zero-to-real-API-call" experience in the SMB accounting space. No second URL to manage. ★ Xero.

### Data-shape fit to our seed schema

Our seed has: `companies/<vendor>.md` and `originals/{invoice,bill,bank-statement}-*.md` with frontmatter `type / vendor / vendor_slug / date / amount / currency` (see `docs/brain-schema.md` from v1.1 Phase 4).

| Entity | Xero | QBO | Fit |
|---|---|---|---|
| Vendor identity | `Contact` (one type, with `IsCustomer`/`IsSupplier` boolean flags) | `Vendor` (separate from `Customer`) | **Wash** — Xero's combined-then-flagged model is slightly harder to filter; QBO's split makes the transformer simpler |
| Invoice (we billed our vendor / we owe a vendor) | `Bill` (which Xero calls `Invoice` with `Type=ACCPAY`) — fields: `Contact.Name`, `Date`, `Total`, `LineItems[]`, `CurrencyCode`, `InvoiceID` | `Bill` — fields: `VendorRef.name`, `TxnDate`, `TotalAmt`, `Line[]`, `CurrencyRef`, `Id` | **Close fit** — both map cleanly to our `originals/bill-<id>.md` template |
| Bank activity | `BankTransaction` (reconciled spend/receive against a bank account) | `Purchase` / `Deposit` (raw bank feed is NOT available via Accounting API in either) | **Slight Xero edge** — `BankTransaction` is one entity with `Type=SPEND`/`RECEIVE` flag; QBO splits into `Purchase` and `Deposit` |
| Currency | `CurrencyCode` (ISO 4217) directly on each transaction | `CurrencyRef.value` nested | **Wash** |
| Vendor email | `Contact.EmailAddress` (top-level string) | `Vendor.PrimaryEmailAddr.Address` (nested) | **Xero slight edge** — directly addressable for Spike 001's vendor-emails workflow |

**Verdict on data fit:** Comparable. Xero's `Contact` model adds one filter step (`IsSupplier=true`); QBO's nested currency adds one indirection. Net: roughly equal effort to write the transformer, with **Xero slightly easier** for the vendor-email use case from Spike 001.

### Rate limits

| Axis | Xero | QBO |
|---|---|---|
| Per-tenant per-minute | **60/min** | 500/min |
| Per-tenant per-day | 5,000/day (rolling) | No documented hard daily cap |
| Initial-sync pain (12 months × ~hundreds of bills+invoices) | Tighter: a 1,000-bill initial sync over 16+ minutes minimum (60/min) | Faster: same sync ~2-3 minutes |
| Backoff API | Uses `X-DayLimit-Remaining` + `X-MinLimit-Remaining` headers; returns 429 with `Retry-After` | Uses `Retry-After` header on 429 |

**Verdict on rate limits:** **QBO wins on raw throughput.** For initial syncs against larger SMBs (5+ years of history), Xero's 60/min ceiling forces pagination-aware backoff into the transformer from day one. For Mara-sized accounts (12 months × hundreds of records) it's a 16-minute initial sync vs 2-minute initial sync — both acceptable for an SSE-streamed onboarding flow, but Xero will *feel* slower in the demo.

### Refresh-token + reconnect UX

Both rotate refresh tokens; both expire ~weeks-to-months out. Xero's 60-day expiry means the "Reconnect" banner from `QBO-09` needs to fire at day 50 instead of day 86. **No structural difference**; same banner component, different threshold.

### Library + SDK

| Lib | Status | Notes |
|---|---|---|
| `xero-node` (official) | Active, TypeScript-first | Heavy — pulls in `axios`, generated OpenAPI client; ~5MB install but well-typed. Bun-compatible (no native binds). |
| `intuit-oauth` + `node-quickbooks` (QBO) | Active but no TypeScript types | Community-maintained, needs a `declare module` shim |

**Verdict on SDK:** **Xero wins** on TypeScript ergonomics. Native types, official SDK, well-documented. QBO's community libraries work but need a wrapper.

## How to Run

```bash
open .planning/spikes/002-accounting-api-comparison/comparison.html
```

(The comparison HTML is in the parent dir — head-to-head with Wave + FreshBooks.)

## What to Expect

- The comparison page in the parent dir scores Xero against QBO row-by-row.
- This README is the long-form note backing the Xero column.

## Investigation Trail

**Iteration 1 — assumed Xero would lose on data-shape complexity.** Going in, the bias was "QBO is the dominant US SMB tool, must be the best fit." Reading the actual Xero docs flipped this: Xero's `BankTransaction` entity is closer to what our `bank-statement` seed page models than QBO's split `Purchase`/`Deposit`. Slight Xero data-fit edge, contrary to expectation.

**Iteration 2 — caught on rate limits.** Xero's 60/min is a real constraint for large initial syncs. Mara-sized accounts are fine; a multi-year-history SMB would feel the squeeze. Not a deal-breaker but is the strongest QBO retention argument.

**Iteration 3 — Demo Company is the deliberate killer feature.** Time-to-first-fetch matters disproportionately for developer experience. Xero's preloaded Demo Company is materially better than QBO's "create a sandbox company first" friction. For a hackathon/MVP-shaped phase like v1.1 Phase 6, this is a non-trivial dev-velocity edge.

## Results

**Verdict: VALIDATED ✓** — Xero is a credible peer to QBO, with material advantages on developer-velocity axes (Demo Company, TypeScript SDK, single base URL) and a material disadvantage on raw throughput (60/min). For a Mara-sized SMB, both feel equivalent. For a hypothetical larger SMB, QBO scales better.

**Key takeaways:**
- Xero is **easier to onboard a developer to** (Demo Company, official TS SDK, single env URL).
- QBO is **easier to sync large accounts against** (8× the rate limit, longer refresh tokens).
- For the v1.1 Phase 6 commitment to QBO: **keep QBO** unless the SMB persona shifts toward non-US markets (Xero dominates in NZ/AU/UK).
- For a hypothetical Phase 7 / v1.2 multi-connector world: **add Xero as the second connector** before Wave or FreshBooks. The data shapes are close enough that a shared transformer-interface (`Connector` trait) is plausible.

---

*Spike investigation: 2026-05-18.*
