# Spike Wrap-Up Summary

**Date:** 2026-05-19
**Spikes processed:** 5 (1 standalone + 1 parent + 3 comparison children)
**Feature areas:** 2 — Outbound vendor communications, Accounting connector strategy
**Skill output:** `./.claude/skills/spike-findings-quick-brain/`
**Auto-load:** wired into `CLAUDE.md`

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | vendor-report-emails | standard | PARTIAL ⚠ | Outbound vendor communications |
| 002 | accounting-api-comparison | comparison-parent | VALIDATED ✓ | Accounting connector strategy |
| 002a | accounting-api-xero | comparison | VALIDATED ✓ (add in v1.2) | Accounting connector strategy |
| 002b | accounting-api-wave | comparison | INVALIDATED ✗ | Accounting connector strategy |
| 002c | accounting-api-freshbooks | comparison | PARTIAL ⚠ (freelancer-niche) | Accounting connector strategy |

## Key Findings

**Spike 001 — Vendor outbound emails:**
- The content composition path is feasible — the brain already has every fact the email needs (orders, totals, dates, vendor identity, citations). No new data layer required.
- Resend (already locked for Phase 5 magic-link) handles 5-10 vendors × 4 weeks = 20-40 emails/month inside its free tier with order-of-magnitude headroom.
- **The single load-bearing UX call is the operator approval gate** — never auto-send. Converts "automated outbound" (legal + tone + trust risks) into "operator's weekly admin assist" (high value, low risk).
- Anomaly findings from the `smb-audit` skill (Phase 4) must **never** auto-inject into vendor-facing email bodies — they surface only in the operator's digest. Mara reviewing an anomaly is intelligence; Beanstalk receiving an accusation is broken relationship.
- The scheduler choice (Minions vs system cron vs GH Actions) is downstream of the Phase 4 spike on Minions-over-PGLite. First implementation should be manual-trigger; cron is a v1.2+ concern.
- **Open product question, not engineering question:** do vendors actually *want* these emails? Suppliers want POs and payments, not summary emails from their customer's "AI brain." Recommend a 3-pilot test with friendly real-world cafés before enabling beyond opt-in-per-vendor.

**Spike 002 — Accounting connector comparison:**
- **Keep QBO for v1.1 Phase 6.** Highest US SMB market share (~80%), best raw throughput (500 req/min — 8× Xero), longest refresh tokens (100 days). The "harder dev experience" axes (separate sandbox URL, community-maintained TS SDK) cost ~1-2 hours of one-time setup.
- **Add Xero as the second connector in v1.2.** Comparable persona fit in non-US markets, materially better dev velocity (Demo Company preloaded, official `xero-node` TS SDK, single base URL).
- **Skip Wave** — Wave deprecated new public-developer API access in 2024. Even if reopened, the data model is wrong (no `Bill` entity, free-text vendor names).
- **Skip FreshBooks for the Mara persona** — 12h refresh-token TTL fights every scheduled-sync use case. Time Tracking + Expense OCR matter for a freelancer SKU only.
- **Architectural call surfaced for Phase 6:** name connector-agnostic types (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`) in `lib/connectors/types.ts` from day one. Write Phase 6 code under `lib/connectors/qbo/` (not `lib/qbo/`). Saves a multi-file refactor when Xero arrives in v1.2.
- **Vendor email field availability is the unsung consequence of the connector choice.** QBO (`Vendor.PrimaryEmailAddr.Address`) + Xero (`Contact.EmailAddress`) both expose it as a first-class field; Wave + FreshBooks don't. This means the connector choice and the spike-001 vendor-email feasibility are structurally tied.

## Cross-Spike Themes

- **Both spikes converged on the same connectors (QBO + Xero) as the "future-proof" picks** — Wave and FreshBooks fail spike 002's data-shape test *and* spike 001's vendor-email-availability test simultaneously.
- **Compliance pressure is high but tractable.** CAN-SPAM is a hard constraint that drives template design, but the constraint is well-documented and the cost of compliance is template + audit-table boilerplate, not architecture work.
- **Manual-trigger before scheduled** is a pattern that surfaces in both spikes: the v1.2 Outbound Communications work should ship its manual button before any cron; the v1.2 Multi-Connector work should ship Xero before any auto-refresh-token-on-schedule cron.

## Roadmap Implications

Two new v1.2+ milestone candidates emerged:

1. **v1.2 "Outbound Communications"** — vendor digest UI + manual-trigger compose + CAN-SPAM template + audit table. Pairs spike 001's findings with the connector-required `vendor_email` field. ~6-10h.
2. **v1.2 "Multi-Connector"** — Xero adapter against the shared `lib/connectors/types.ts` interface introduced in v1.1 Phase 6. Connector-abstraction refactor + Xero `transformer.ts` + dashboard "Connect" dropdown. ~10-14h.

These do not block v1.1 — they extend it. Capture as `v1.2-CANDIDATES.md` after v1.1 closes, not now.

## Action Items for v1.1 Phase 6 (Before Execute)

One small change to the existing Phase 6 plan, derived from spike 002:

- **Update 04-04-PLAN.md or the Phase 6 PLAN files** so QBO code lives at `lib/connectors/qbo/` (not `lib/qbo/`). Add `lib/connectors/types.ts` with the connector-agnostic shapes. Trivial in Phase 6; saves a multi-file refactor in v1.2.

This is the only mid-spike action that should land in v1.1 itself.

---

*Wrap-up complete: 2026-05-19.*
