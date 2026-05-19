# Spike Manifest

## Idea

Two adjacent feasibility questions for QuickBrain post-v1.0:

1. **Vendor outbound emails** — Can QuickBrain compose and send weekly per-vendor activity summary emails on behalf of a small-business owner like Mara? The brain already knows what was bought from whom; the question is whether automated outbound email to vendors is (a) deliverable, (b) legally clean, (c) something the operator would actually trust without an approval gate.

2. **Easier accounting connectors than QuickBooks Online** — The v1.1 Phase 6 commits to QBO as the first live-data connector. But Xero, Wave, and FreshBooks all sit in adjacent SMB niches with different OAuth/API ergonomics. Can we identify a connector with simpler integration cost, broader fit, or better dev-experience than QBO? The answer informs whether Phase 6 stays QBO-only or grows a multi-connector abstraction.

## Requirements

Captured as user choices and findings emerge.

- **Vendor email path must have an approval gate** (no auto-send) — operator reviews each weekly batch before send. CAN-SPAM + trust + tone-policing all converge here. Source: spike 001.
- **Anomaly findings from `smb-audit` must NEVER auto-inject into vendor-facing email bodies.** They surface in the operator's digest only. Source: spike 001.
- **Reuse Resend** (already locked for Phase 5 magic-link) — no second email provider for outbound. Source: spike 001.
- **First implementation should be manual-trigger ("compose this week's emails"), not scheduled.** Cron decision is downstream of the Phase 4 Minions-over-PGLite spike. Source: spike 001.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | vendor-report-emails | standard | Weekly per-vendor activity-summary email composition + send + approval gate | **PARTIAL ⚠** | email, outbound, compliance, scheduler |
| 002a | accounting-api-xero | comparison | Xero OAuth 2.0 + Accounting API ergonomics vs QBO | PENDING | accounting, oauth, rest, comparison |
| 002b | accounting-api-wave | comparison | Wave GraphQL + OAuth ergonomics vs QBO | PENDING | accounting, oauth, graphql, comparison, free-tier |
| 002c | accounting-api-freshbooks | comparison | FreshBooks OAuth 2.0 + Accounting API ergonomics vs QBO | PENDING | accounting, oauth, rest, comparison, freelancer-niche |

## Related Project Context

- v1.0 (shipped): synthetic Mara's Coffee seed brain + 3-min demo path; see `.planning/v1.0-MILESTONE-AUDIT.md`
- v1.1 Phase 6 (planned, not yet executed): QuickBooks Online ingest; see `.planning/ROADMAP.md` and `.planning/research/SUMMARY.md`
- v2 stretch (deferred): Stripe / Gmail connectors (`STRP-01`, `GMAIL-01` in REQUIREMENTS.md)

---

*Manifest created: 2026-05-18.*
