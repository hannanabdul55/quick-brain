# Spike Wrap-Up Summary

**Initial wrap-up:** 2026-05-19 (spikes 001 + 002)
**Appended:** 2026-05-19 (spikes 003 + 004 from frontier-mode pass)
**Spikes processed:** 7 (2 standalone + 1 parent + 3 comparison children + 1 infrastructure)
**Feature areas:** 3 — Outbound communications · Accounting connector strategy · gbrain skill infrastructure
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
| 003 | minions-over-pglite | standard | VALIDATED ✓ | gbrain skill infrastructure |
| 004 | accountant-facing-reports | standard | VALIDATED ✓ (leads v1.2) | Outbound communications |

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

## Key Findings — Frontier Pass (spikes 003 + 004)

**Spike 003 — Minions over PGLite:**
- Empirically tested against installed gbrain 0.35.1 with PGLite backend. `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow` **works inline, no daemon required.**
- Three Phase 4 design gotchas surfaced:
  1. The `smb-audit` skill (and every future custom skill) **must always exit 0**. Non-zero triggers gbrain Minions' 3-attempt retry policy with ~1s/2s/4s backoff (~7s wasted on deterministic failure). Internal errors → write `concepts/<skill>-error.md` and exit cleanly.
  2. **`scripts/seed.sh` must parse the `Result:` JSON line's `exit_code` field.** `gbrain jobs submit --follow`'s own exit code is always 0 regardless of job outcome.
  3. **`bun` must be in PATH** when invoking `gbrain` — it spawns its worker via `bun` internally. Defensive export at the top of all wrapper scripts.
- Phase 4 precondition spike embedded in 04-01-PLAN.md is empirically resolved. The skill mechanism is unblocked; the canonical shell-job pattern is the path.

**Spike 004 — Accountant-facing reports:**
- **Audience swap from "vendor" to "Mara's CPA / bookkeeper" eliminates 6 of 8 risks from spike 001.** The recipient explicitly wants the email (CPAs are paid to read monthly close packages), anomalies become the headline (not the omission), single-recipient model is materially simpler than per-vendor digest.
- **Reuses ~80% of spike-001's plumbing** — Resend, signed-token unsubscribe URLs, approval gate primitives, server-side template validator (with rule inversion).
- **PDF archival format = `@media print` stylesheet on the HTML body.** No Puppeteer / Cloud Run / PDF library. Browsers print to PDF natively; CPAs cmd+P to archive.
- **The audience-keyed template validator is the load-bearing safety check** — CPA payloads REQUIRE anomaly content; vendor payloads REJECT it. One module, two rule sets.
- Refines v1.2 "Outbound Communications": lead with **Phase A: CPA monthly close**, gate **Phase B: vendor weekly** on a 3-tenant pilot.

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

## Action Items for v1.1 Phase 4 (Before Execute) — added from spikes 003 + 004

Three small edits to the existing Phase 4 plans, derived from spike 003:

- **`04-01-PLAN.md`** — replace the "30-min spike" precondition with a 5-min "verify env" task. The actual spike (003) is empirically resolved and the canonical pattern is documented.
- **`04-03-PLAN.md`** — `scripts/seed.sh` must parse the `Result:` JSON line's `exit_code` field, not rely on `gbrain jobs submit --follow`'s own exit code (always 0 regardless of job outcome). Acceptance: a 5-line shell snippet to extract + check.
- **`04-04-PLAN.md`** — cleanup task should include updating `scripts/demo-check.sh` to verify `bun` is on PATH (`export PATH="$HOME/.bun/bin:$PATH"` defensive export).
- **`skills/smb-audit/scripts/smb-audit.mjs`** must use try/catch + write `concepts/audit-error.md` + always `process.exit(0)` to avoid Minions' 3× retry on non-zero exit.

## v1.2 Milestone Direction (post-frontier)

The wrap-up's v1.2 candidates refine:

- **v1.2 "Outbound Communications"** — **lead with Phase A: CPA-facing monthly close** (spike 004 VALIDATED). Vendor-facing weekly (spike 001 PARTIAL) becomes Phase B, gated on a 3-tenant real-world pilot. Same composition pipeline, audience-keyed template validator.
- **v1.2 "Multi-Connector"** (unchanged) — Xero adapter against the shared `lib/connectors/types.ts` interface.

---

*Initial wrap-up: 2026-05-19. Frontier-spike append: 2026-05-19 (spikes 003 + 004).*
