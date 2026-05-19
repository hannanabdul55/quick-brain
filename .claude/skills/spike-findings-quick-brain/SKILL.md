---
name: spike-findings-quick-brain
description: Implementation blueprint from spike experiments for QuickBrain. Requirements, proven patterns, and verified knowledge for building outbound communications (CPA + vendor), accounting connectors, and gbrain skill infrastructure. Auto-loaded during implementation work.
---

<context>
## Project: quick-brain

QuickBrain is a 60-second onboarding shell around gbrain that lets a non-technical small-business owner spin up a working business brain. v1.0 shipped a hackathon demo with synthetic Mara's Coffee data. v1.1 "Beyond the Demo" extends it with a custom gbrain skill (Phase 4), email magic-link auth (Phase 5), and QuickBooks Online ingest (Phase 6). Three feasibility questions have been spiked: (1) email composition + send on the operator's behalf (vendors AND CPAs), (2) accounting-connector choice (QBO vs Xero vs Wave vs FreshBooks), (3) skill-execution infrastructure on gbrain Minions over PGLite.

Spike sessions wrapped: 2026-05-18 (spikes 001 + 002), 2026-05-19 (spikes 003 + 004 + wrap-up).
</context>

<requirements>
## Requirements

Non-negotiable design decisions that emerged from spike sessions. Every feature area reference honors these.

### Outbound communications (from spikes 001 + 004)

- **No auto-send to any audience.** Every outbound email passes through an operator approval gate. CPA path: simpler single-recipient preview. Vendor path: per-vendor digest with checkboxes.
- **Audience-keyed template validator** is the load-bearing safety check. CPA payloads REQUIRE anomaly content; vendor payloads REJECT it. Server-side, runs on every send.
- **v1.2 leads with CPA-facing monthly close emails** (spike 004 — recipient explicitly wants them; anomalies are the headline; single-recipient model is materially simpler).
- **Vendor-facing weekly emails are gated on a 3-tenant pilot** before general availability (spike 001 — recipient-desirability question is unresolved).
- **Reuse Resend** (already locked for v1.1 Phase 5 magic-link auth). One provider, one verified domain.
- **PDF archival format is `@media print` CSS** on the HTML body. No Puppeteer / Cloud Run / PDF library — browsers print to PDF natively.
- **Email is sent FROM the operator's identity**, not from QuickBrain. Footer credits QuickBrain as the composing tool.
- **Physical postal address + unsubscribe link** required in every email footer (CAN-SPAM §5.3 + §5.4). Validator must reject any payload missing either.
- **Unsubscribe link token shape matches Phase 5's magic-link token shape** — same signing key, reuse `lib/auth/jwt.ts` helpers.

### Accounting connectors (from spike 002)

- **v1.1 Phase 6 stays QBO-only.** Highest US SMB market share + best raw throughput (500 req/min) + longest refresh tokens (100 days). No multi-connector work in v1.1.
- **Name connector-agnostic types from day one** in `lib/connectors/types.ts` — `ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`. The transformer is per-connector; the markdown writer is connector-blind.
- **Use `lib/connectors/qbo/` path in v1.1** (not `lib/qbo/`). Trivial diff in Phase 6, saves a multi-file refactor when Xero arrives in v1.2.
- **Slug prefixing**: every connector emits prefixed slugs (`qbo-`, `xero-`) on vendor pages. Prevents collision when a tenant carries both synthetic seed and live data.
- **Vendor email is a required transformer output** when the source connector exposes it (QBO + Xero). Wave + FreshBooks don't expose it.
- **Refresh-token rotation discipline is uniform across connectors**: persist newest `refresh_token` immediately after every exchange.
- **No connector without a `Bill` / `Invoice` / `Vendor` first-class entity.** Wave and FreshBooks both fail (free-text vendor names) and are explicitly skipped.
- **Skip Wave** (no new dev applications since 2024; wrong data model anyway).
- **Skip FreshBooks for SMB persona** (12h refresh-token TTL kills scheduled syncs).

### gbrain skill infrastructure (from spike 003)

- **PGLite backend supports `gbrain jobs submit shell --follow` inline** — no `jobs work` daemon required. Empirically confirmed against gbrain 0.35.1.
- **Every custom skill (including `smb-audit`) MUST always exit 0.** Non-zero shell exits trigger Minions' 3-attempt retry policy. Internal errors → write `concepts/<skill>-error.md` and exit cleanly.
- **`scripts/seed.sh` MUST parse the `Result:` JSON line's `exit_code` field** to detect job failure — `gbrain jobs submit --follow`'s own exit code is always 0 regardless of job outcome.
- **`bun` must be in PATH** when invoking `gbrain`. `export PATH="$HOME/.bun/bin:$PATH"` defensively in `scripts/seed.sh` + `scripts/demo-check.sh` + any cron wrapper.
- **gbrain overhead per `jobs submit shell --follow` invocation is ~300ms.** Acceptable for Phase 4 (one skill invocation per seed); not appropriate for high-frequency per-request use.
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Outbound communications | [references/outbound-communications.md](references/outbound-communications.md) | v1.2 leads with CPA-facing monthly close (recipient explicitly wants it; anomalies are the headline; print-CSS for PDF). Vendor-facing weekly is gated on a 3-tenant pilot. Audience-keyed template validator is the load-bearing safety check. |
| Accounting connector strategy | [references/accounting-connectors.md](references/accounting-connectors.md) | Keep QBO for v1.1, add Xero in v1.2, skip Wave + FreshBooks. Structure code as `lib/connectors/<source>/` from day one with shared `lib/connectors/types.ts`. |
| gbrain skill infrastructure | [references/gbrain-skill-infrastructure.md](references/gbrain-skill-infrastructure.md) | `gbrain jobs submit shell --follow` works on PGLite. Skill must always exit 0; seed.sh parses `Result:` JSON `exit_code`; `bun` must be in PATH. Three Phase 4 plan edits identified. |

## Source Files

Original spike source files preserved in `sources/` for complete reference:

- `sources/001-vendor-report-emails/` — README + email-preview.html (vendor inbox + operator digest UI) + scheduler-comparison.html
- `sources/002a-xero/README.md` — Xero scoring (VALIDATED, add in v1.2)
- `sources/002b-wave/README.md` — Wave scoring (INVALIDATED, access deprecated 2024)
- `sources/002c-freshbooks/README.md` — FreshBooks scoring (PARTIAL, freelancer SKU only)
- `sources/comparison.html` — 4-way head-to-head matrix
- `sources/README.md` — accounting-comparison parent verdict
- `sources/003-minions-over-pglite/README.md` — empirical test output from gbrain 0.35.1 (Phase 4 unblock)
- `sources/004-accountant-facing-reports/` — README + cpa-email-preview.html (with print CSS for PDF archival)
</findings_index>

<metadata>
## Processed Spikes

- 001-vendor-report-emails (PARTIAL ⚠)
- 002-accounting-api-comparison (VALIDATED ✓, parent)
- 002a-xero (VALIDATED ✓)
- 002b-wave (INVALIDATED ✗)
- 002c-freshbooks (PARTIAL ⚠)
- 003-minions-over-pglite (VALIDATED ✓)
- 004-accountant-facing-reports (VALIDATED ✓)
</metadata>
