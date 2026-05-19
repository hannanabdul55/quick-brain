---
name: spike-findings-quick-brain
description: Implementation blueprint from spike experiments for QuickBrain. Requirements, proven patterns, and verified knowledge for building outbound vendor communications and accounting connectors. Auto-loaded during implementation work.
---

<context>
## Project: quick-brain

QuickBrain is a 60-second onboarding shell around gbrain that lets a non-technical small-business owner spin up a working business brain. v1.0 shipped a hackathon demo with synthetic Mara's Coffee data. v1.1 "Beyond the Demo" extends it with a custom gbrain skill (Phase 4), email magic-link auth (Phase 5), and QuickBooks Online ingest (Phase 6). Two spike sessions explored adjacent feasibility questions: (1) can QuickBrain compose and send weekly per-vendor activity-summary emails on the operator's behalf, and (2) are there accounting connectors easier than QBO that should compete for the Phase 6 slot.

Spike sessions wrapped: 2026-05-18 (spikes 001 + 002) and 2026-05-19 (wrap-up).
</context>

<requirements>
## Requirements

Non-negotiable design decisions that emerged from spike sessions. Every feature area reference honors these.

### Vendor outbound communications (from spike 001)

- **Vendor email path must have an approval gate** — operator reviews each weekly batch before send. CAN-SPAM + trust + tone-policing all converge here. No auto-send.
- **Anomaly findings from `smb-audit` must NEVER auto-inject into vendor-facing email bodies.** They surface in the operator's digest only.
- **Reuse Resend** (already locked for v1.1 Phase 5 magic-link auth) — no second email provider.
- **First implementation is manual-trigger** ("Compose this week's vendor emails" button), not scheduled. The cron decision is downstream of the Phase 4 Minions-over-PGLite spike.
- **Email is sent FROM the operator's identity**, not from QuickBrain. The footer credits QuickBrain as the tool.
- **Physical postal address + unsubscribe link** required in every email footer (CAN-SPAM §5.3 + §5.4).

### Accounting connectors (from spike 002)

- **v1.1 Phase 6 stays QBO-only.** Highest US SMB market share + best raw throughput (500 req/min) + longest refresh tokens (100 days). No multi-connector work in v1.1.
- **Name connector-agnostic types from day one** in `lib/connectors/types.ts` — `ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`. The transformer is per-connector; the markdown writer is connector-blind.
- **Use `lib/connectors/qbo/` path in v1.1** (not `lib/qbo/`). Trivial diff in Phase 6, saves a multi-file refactor when Xero arrives in v1.2.
- **Slug prefixing**: every connector emits prefixed slugs (`qbo-`, `xero-`) on vendor pages. Prevents collision when a tenant carries both synthetic seed and live data.
- **Vendor email is a required transformer output** when the source connector exposes it (QBO + Xero). Wave + FreshBooks don't expose it — they fail this test and the spike 001 test simultaneously.
- **Refresh-token rotation discipline is uniform across connectors**: persist newest `refresh_token` immediately after every exchange. Both QBO and Xero rotate; stale writes → `invalid_grant`.
- **No connector without a `Bill` / `Invoice` / `Vendor` first-class entity.** Wave and FreshBooks both fail (free-text vendor names) and are explicitly skipped.
- **Skip Wave** (no new dev applications since 2024; wrong data model anyway).
- **Skip FreshBooks for SMB persona** (12h refresh-token TTL kills scheduled syncs; freelancer-only fit).
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Outbound vendor communications | [references/outbound-vendor-comms.md](references/outbound-vendor-comms.md) | Build manual-trigger digest UI with operator approval gate; anomaly hints stay internal; reuse Resend + Phase 5 token shape; defer cron until Phase 4 spike resolves Minions-over-PGLite |
| Accounting connector strategy | [references/accounting-connectors.md](references/accounting-connectors.md) | Keep QBO for v1.1, add Xero in v1.2, skip Wave + FreshBooks; structure code as `lib/connectors/<source>/` from day one with shared `lib/connectors/types.ts` |

## Source Files

Original spike source files preserved in `sources/` for complete reference:

- `sources/001-vendor-report-emails/` — README + email-preview.html (vendor inbox + operator digest UI) + scheduler-comparison.html (5 cron options scored)
- `sources/002a-xero/README.md` — Xero scoring (VALIDATED, add in v1.2)
- `sources/002b-wave/README.md` — Wave scoring (INVALIDATED, access deprecated 2024)
- `sources/002c-freshbooks/README.md` — FreshBooks scoring (PARTIAL, freelancer SKU only)
- `sources/comparison.html` — 4-way head-to-head matrix
- `sources/README.md` — comparison parent verdict
</findings_index>

<metadata>
## Processed Spikes

- 001-vendor-report-emails (PARTIAL ⚠)
- 002-accounting-api-comparison (VALIDATED ✓, parent)
- 002a-xero (VALIDATED ✓)
- 002b-wave (INVALIDATED ✗)
- 002c-freshbooks (PARTIAL ⚠)
</metadata>
