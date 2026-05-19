---
spike: 002c
name: accounting-api-freshbooks
type: comparison
validates: "Given FreshBooks OAuth 2.0 + Accounting API, when we walk through sandbox signup → consent → first Invoices/Expenses fetch → markdown transformer, then we can score FreshBooks against QBO on the same five axes (time-to-first-fetch, data-shape fit, rate-limit pain, sandbox accessibility, refresh-token UX)"
verdict: PARTIAL
related: [002a, 002b]
tags: [accounting, oauth, rest, comparison, freelancer-niche]
---

# Spike 002c: Accounting API — FreshBooks

## What This Validates

Same five axes as 002a, applied to FreshBooks. FreshBooks targets service-business freelancers and very-small SMBs (1-10 person teams). Unique surface area: explicit "Time Tracking" entity and an expense-receipt OCR pipeline, neither of which QBO/Xero expose in the Accounting API. Question: do those unique surfaces help QuickBrain's persona, or are they freelancer-specific noise?

## Research

### OAuth & Auth

| Axis | FreshBooks | QBO (baseline) |
|---|---|---|
| OAuth flow | OAuth 2.0 with PKCE; standard | OAuth 2.0 (Intuit-flavored) |
| Token scopes | `user:profile:read`, `user:invoices:read`, `user:expenses:read`, `user:clients:read`, `user:bills:read` — fine-grained, but the app needs them all for our use case | `com.intuit.quickbooks.accounting` — single scope, broader |
| Refresh-token validity | **12 hours** (!!) — much shorter than Xero (60d) or QBO (100d). Refresh tokens are short-lived; the app is expected to refresh frequently | 100 days |
| Multi-account per user | Yes — `business_id` plays the same role as Xero `tenant_id` / QBO `realm_id` | Yes — `realmId` |
| Production app approval | Required for production tokens, ~1-week review | Required, 1-3 days |

**Verdict on auth:** **FreshBooks loses.** 12-hour refresh tokens mean the user has to be active enough that the app refreshes regularly — for a "weekly summary" or "once-a-week QBO sync" use case, the token will frequently be expired when the cron fires. The app must implement aggressive refresh-on-schedule, not just refresh-on-use. This is the single biggest negative finding.

### Sandbox accessibility

| Axis | FreshBooks | QBO (baseline) |
|---|---|---|
| Time to first sandbox request | ~30 minutes — sign up at freshbooks.com → developer portal → create app → use **your own real FreshBooks account in trial mode** as the sandbox (FreshBooks does not have a separate sandbox environment) | 30-45 minutes |
| Pre-loaded data | None — your trial account starts empty, you have to seed sample data manually before any transformer work is testable | Sandbox includes sample data |
| Switching prod/test | Same base URL, same OAuth — only the connected business differs | Distinct base URL |

**Verdict on sandbox:** **Loss.** No preloaded data is a major dev-velocity issue. To work on the transformer you'd first need to manually create ~30 invoices, ~20 expenses, etc. in the trial UI — a 30-60 min seeding tax before any code-write begins.

### Data-shape fit to our seed schema

| Entity | FreshBooks | Our seed | Fit |
|---|---|---|---|
| Vendor | `Client` (FreshBooks has Clients = your customers, and... no first-class Vendor entity for entities-you-pay; "Expenses" track outgoing money but don't link to a structured vendor object) | `companies/<vendor>.md` | **Bad** — vendors are recovered from `Expense.vendor` free-text strings. Same problem as Wave. |
| What we billed our vendor (Bill) | `Bill` (added in 2023 — newer than Invoice/Expense; not all FreshBooks plans expose this) | `originals/bill-<id>.md` | **Partial** — only on Plus + Premium plans, not Lite. Worth flagging if Mara's persona is on the Lite tier. |
| Bank activity | `Expense` + `Payment` entities; raw bank feed not exposed | `originals/bank-statement-*.md` | Similar to QBO/Xero — no raw feed, just reconciled spend |
| Time Tracking | `TimeEntry` — unique. Hours billable to clients | (not in our schema) | **Irrelevant for SMB persona** but **highly relevant for a freelancer SKU** |
| Expense OCR | FreshBooks scans receipts uploaded to the app; the parsed result is on `Expense.attachments[]` | (not in our schema) | Tempting — could surface as a "we OCR'd your receipts so the brain has more context" feature. v2 differentiator. |

**Verdict on data fit:** **Worse than Xero, slightly worse than QBO.** No first-class Vendor entity is a real cost. The Time Tracking + OCR surface areas are *interesting* but irrelevant to Mara's persona — they'd matter for a freelancer-targeted QuickBrain SKU.

### Rate limits

| Axis | FreshBooks | QBO |
|---|---|---|
| Per-account per-minute | **Tiered**: ~120/min for most endpoints, but stricter on `/invoices` (60/min) and `/expenses` (60/min) | 500/min |
| 429 handling | `Retry-After` header | `Retry-After` header |
| Initial-sync pain | Similar to Xero — pagination + backoff required from day one | Faster than both |

**Verdict on rate limits:** Between Xero and QBO. Not a deal-breaker for Mara-sized accounts. Loses to QBO.

### Library + SDK

FreshBooks publishes `@freshbooks/api` Node SDK. TypeScript types exist but are partial — many endpoints return `any`. Less polished than `xero-node`, more polished than the `node-quickbooks` community shim. Net: middle of the pack.

## How to Run

```bash
open .planning/spikes/002-accounting-api-comparison/comparison.html
```

## What to Expect

Comparison table in the parent dir scores FreshBooks alongside QBO, Xero, and Wave. FreshBooks gets a "PARTIAL — freelancer niche only" tag.

## Investigation Trail

**Iteration 1 — opened with curiosity about Time Tracking + OCR.** These two surfaces are unique among SMB accounting tools. Could they justify a "FreshBooks-first" pivot? Reading the API docs, the answer is no — these are freelancer features. Mara doesn't bill her customers by the hour; she runs a café.

**Iteration 2 — caught the 12-hour refresh-token deal-breaker.** This is the single most important negative finding. For a cron-fired weekly sync (Spike 001 use case) or a once-a-week QBO refresh (Phase 6 use case), the refresh token will routinely be expired when the job fires. The app would need to refresh proactively on a separate schedule, doubling the scheduler burden. Painful.

**Iteration 3 — no first-class Vendor entity is the second-biggest issue.** Same problem as Wave. Free-text vendor names → bad transformer input → de-duplication code required upstream.

**Iteration 4 — re-framed FreshBooks as "the connector for a future freelancer SKU."** If QuickBrain ever forks a "QuickBrain for solo operators" product, FreshBooks is a *better* fit than QBO. For the SMB persona, it's worse than QBO and Xero.

## Results

**Verdict: PARTIAL ⚠** — FreshBooks is technically viable but is the worst fit of the three credible options for Mara's persona. The 12-hour refresh-token and free-text vendor model are real costs. The Time Tracking + Expense OCR surfaces are real differentiators *for a different persona*.

**Key takeaways:**
- **Do not pursue FreshBooks for v1.1 / v1.2.** Mara isn't the target user.
- **Time Tracking + OCR are interesting** — flag them as v3+ "if we build a freelancer SKU" features.
- **12-hour refresh tokens are a real constraint** that informs the cron-scheduler design. Any FreshBooks integration must refresh on a < 12h schedule, not on-demand only.
- **Trial-account-as-sandbox is acceptable but slow.** Adds ~30-60 min of data-seeding before transformer work can begin.

---

*Spike investigation: 2026-05-18.*
