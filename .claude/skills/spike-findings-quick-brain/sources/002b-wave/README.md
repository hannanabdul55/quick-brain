---
spike: 002b
name: accounting-api-wave
type: comparison
validates: "Given Wave's GraphQL API + OAuth, when we walk through sandbox signup → consent → first Bills fetch → markdown transformer, then we can score Wave against QBO on the same five axes (time-to-first-fetch, data-shape fit, rate-limit pain, sandbox accessibility, refresh-token UX)"
verdict: INVALIDATED
related: [002a, 002c]
tags: [accounting, oauth, graphql, comparison, free-tier]
---

# Spike 002b: Accounting API — Wave

## What This Validates

Same five axes as Spike 002a, applied to Wave Apps' GraphQL API. Wave was acquired by H&R Block in 2019, runs a free accounting product targeting freelancers and very small businesses, and is the **only major SMB accounting platform with a GraphQL API**. The interesting questions: is GraphQL materially easier or harder than QBO's REST? Does the free-tier customer base map to QuickBrain's persona?

## Research

### Critical pre-finding — API access status

**Wave deprecated public developer access to its API in 2024**, effective for new applications. Existing partner apps continue to function. Per Wave's own developer docs (last accessed via web archive, snapshot from late 2025):

> "We are no longer accepting new developer applications for the Wave API. Existing partners may continue to use the API; new integrations should be built on Wave's published Zapier connectors instead."

This is the single largest finding of the spike and it INVALIDATES Wave as a v1.1/v1.2 connector candidate. Everything below is recorded for completeness, but the verdict at the bottom is settled by this paragraph alone.

(Verifying this in production would require Wave's developer-portal signup flow rejecting a new application — operator would need to test this directly. The spike's read is documentation-based.)

### Hypothetical scoring (had access remained open)

Recorded for the Phase-7+ "if Wave reopens" file.

| Axis | Wave | QBO (baseline) |
|---|---|---|
| OAuth flow | OAuth 2.0; standard `authorize → callback → exchange` | OAuth 2.0 (Intuit-flavored Basic auth header) |
| Query model | **GraphQL** — single `/graphql` endpoint, request the exact fields needed | REST — multiple endpoints per entity, response shape fixed |
| Initial-sync queries | One query can return Invoices + their Customers + their Items in one round-trip via nested selection | 3+ round-trips: `findInvoices`, then per-invoice `getCustomer`, then per-line `getItem` |
| Rate limit | 60 req/min per access token | 500/min |
| Sandbox | Wave's "sandbox" is a real free production account — no separate environment | Distinct sandbox base URL |
| Data shape | Smaller object graph than QBO/Xero; no Bills/Vendors split (Wave models everything as `Transactions` with categories) | Rich object graph |

### Why GraphQL is structurally interesting but not enough

GraphQL's promise is "request exactly the fields you need in one round-trip." For an SSE-streamed onboarding flow, that's a real win — fewer waterfalls. But:

- We still have to write the markdown transformer.
- We still have to handle pagination cursors (GraphQL pagination is *more* complex than REST, not less — `pageInfo` and `cursor` semantics).
- The transformer logic is the dominant complexity. Saving 2-3 round-trips per record reduces wall-clock by ~5-10s on a 12-month sync. Real, not transformative.

**GraphQL would shift complexity, not eliminate it.** Worth knowing for connector #3 or #4, but not a reason to pick Wave even if access were available.

### Wave's data model — biggest fit problem

Wave does not have a `Bill` entity. Everything is a `Transaction` with a category. To produce our `originals/bill-<id>.md` files we'd need to:

1. Query all `Transactions` filtered by category `Expense`
2. Group by vendor (which is a free-text string in Wave, NOT a structured entity)
3. Synthesize a "bill" abstraction from N transactions

This is materially more transformer complexity than Xero or QBO (both of which expose `Bill` directly). For Mara-shaped SMBs who actually use Wave, the data hygiene is also typically lower — vendor names are typed by the operator into a free-text field, leading to "Beanstalk", "Beanstalk Roasters", "Beanstalk LLC" all being the same vendor in three rows.

### Customer base fit

Wave's user base is heavily freelancers + sole proprietors. Mara's persona (10-employee café with structured operations) is *not* Wave's target. The persona overlap is poor. If we ever build a QuickBrain-for-freelancers SKU, Wave matters; for the SMB persona, it doesn't.

## How to Run

```bash
open .planning/spikes/002-accounting-api-comparison/comparison.html
```

## What to Expect

The comparison HTML in the parent dir shows Wave alongside QBO and Xero. Wave's row carries a "❌ NOT ACCEPTING NEW DEV APPS" tag.

## Investigation Trail

**Iteration 1 — opened with the assumption Wave's free tier + GraphQL = killer-easier dev experience.** That was the v1.2 hypothesis worth testing.

**Iteration 2 — the deprecation finding hit immediately.** No new developer applications since 2024. That settles the spike before any of the technical axes matter.

**Iteration 3 — completed the technical scoring anyway** because: (a) Wave could un-deprecate, (b) the GraphQL question generalizes to other future connectors (Pennylane has GraphQL, some EU SMB tools), (c) the data-model fit problem (no `Bill` entity) is a real warning sign about how Wave structures its product — they treat accounting as journaling, not as discrete invoice/bill objects, which is a different worldview from QBO/Xero.

## Results

**Verdict: INVALIDATED ✗** — Wave is unavailable for new dev access and would have been the wrong technical fit anyway. The data model (free-text vendors, no `Bill` entity) creates transformer complexity that QBO and Xero don't have. The GraphQL angle is interesting but doesn't compensate.

**Key takeaways:**
- **Do not pursue Wave.** Even if access reopens, the data-model fit is bad.
- **GraphQL ≠ easier.** It shifts complexity from round-trips to pagination semantics. Worth knowing for evaluating future GraphQL-based connectors.
- **Free-tier accounting tools have free-tier data hygiene.** Free-text vendor names are a transformer's worst input. This generalizes — if a connector says "everything is a Transaction with a free-text category," walk away.
- **Open question for Phase-7+:** is there a Zapier-based ingest path? Zapier→webhook→QuickBrain might be a "long-tail connector" pattern for SMBs on Wave, FreshBooks Lite, Quicken, etc. Not v1.1 work; flag for a future spike.

---

*Spike investigation: 2026-05-18.*
