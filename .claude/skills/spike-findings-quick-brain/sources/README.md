---
spike: 002
name: accounting-api-comparison
type: comparison-parent
validates: "Head-to-head verdict across QBO baseline + Xero + Wave + FreshBooks on 5 axes"
verdict: VALIDATED
related: [002a, 002b, 002c]
tags: [accounting, oauth, comparison, parent]
---

# Spike 002: Accounting API Head-to-Head (parent)

This dir aggregates the three comparison spikes (002a Xero, 002b Wave, 002c FreshBooks) into a single verdict against the v1.1 Phase 6 QBO baseline.

## How to Run

```bash
open .planning/spikes/002-accounting-api-comparison/comparison.html
```

## Sub-spikes

| # | Name | Verdict | One-line |
|---|------|---------|----------|
| 002a | `xero` | VALIDATED ✓ | Credible peer. Best dev velocity. Add as 2nd connector in v1.2. |
| 002b | `wave` | INVALIDATED ✗ | No new dev applications since 2024. Data model is wrong shape anyway. |
| 002c | `freshbooks` | PARTIAL ⚠ | Freelancer-targeted. 12h refresh tokens kill scheduled syncs. Defer to a freelancer SKU. |

## Verdict

**For v1.1: keep QBO** — its rate-limit ceiling (500/min vs Xero's 60/min) and refresh-token longevity (100 days vs Xero's 60) outweigh Xero's better dev velocity for the chosen US-SMB persona.

**For v1.2: add Xero** as the second connector. Comparable persona fit in non-US markets (NZ/AU/UK), materially better dev velocity (Demo Company, official TS SDK, single base URL). Design the connector abstraction against both QBO and Xero from day one.

**Skip Wave + FreshBooks for v1.x.** Wave is access-blocked; FreshBooks is wrong-persona.

## Key Architectural Implication for Phase 6

When writing `lib/qbo/transformer.ts` in v1.1 Phase 6, name the connector-agnostic types (`Bill`, `Vendor`, `BankLine`) in a shared file (proposed: `lib/connectors/types.ts`) so a Xero adapter can target the same interface in v1.2 without a retro-fit. The transformer module itself stays connector-specific: `lib/connectors/qbo/transformer.ts`.

---

*Comparison verdict: 2026-05-18.*
