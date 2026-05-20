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
- **v1.1 Phase 6 stays QBO-only.** Highest US SMB market share + best raw throughput + longest refresh tokens. Source: spike 002 head-to-head.
- **Name connector-agnostic types from day one** in `lib/connectors/types.ts` (proposed) — `Bill`, `Vendor`, `BankLine` shapes shared across QBO + future Xero adapter. Avoid retro-fit cost in v1.2. Source: spike 002a.
- **Vendor email composition (spike 001) targets `Vendor.PrimaryEmailAddr.Address` (QBO) and `Contact.EmailAddress` (Xero).** Both expose vendor email as a first-class field. Wave + FreshBooks do not — they store vendor names as free text. The QBO+Xero choice is also a vendor-email-feasibility choice. Source: spikes 001 + 002.
- **The `smb-audit` skill (Phase 4) must ALWAYS exit 0.** Non-zero exits trigger gbrain Minions' 3-attempt retry policy (1s/2s/4s backoff = ~7s wasted on a deterministic skill failure). Internal errors handled internally → write `concepts/audit-error.md` rather than throwing. Source: spike 003.
- **`scripts/seed.sh` must parse the `Result:` JSON line's `exit_code` field**, not `gbrain jobs submit --follow`'s own exit code (which is always 0 regardless of job outcome). Source: spike 003.
- **`bun` must be in PATH when invoking `gbrain`.** gbrain spawns its worker via `bun` internally. `scripts/seed.sh` + `scripts/demo-check.sh` should `export PATH="$HOME/.bun/bin:$PATH"` defensively. Source: spike 003.
- **v1.2 "Outbound Communications" leads with CPA-facing monthly reports**, not vendor-facing weekly emails. Audience swap eliminates 6 of 8 risks from spike 001 (recipient desirability, tone policing, multi-recipient deliverability, per-vendor template gymnastics). Anomalies are the headline, not the omission. Source: spike 004.
- **PDF archival format = `@media print` stylesheet on the HTML email**, not Puppeteer / Cloud Run / a PDF library. Browsers print to PDF natively; CPAs cmd+P to archive. Source: spike 004.

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | vendor-report-emails | standard | Weekly per-vendor activity-summary email composition + send + approval gate | **PARTIAL ⚠** | email, outbound, compliance, scheduler |
| 002a | accounting-api-xero | comparison | Xero OAuth 2.0 + Accounting API ergonomics vs QBO | **VALIDATED ✓** (add in v1.2 as 2nd connector) | accounting, oauth, rest, comparison |
| 002b | accounting-api-wave | comparison | Wave GraphQL + OAuth ergonomics vs QBO | **INVALIDATED ✗** (no new dev apps; data model wrong) | accounting, oauth, graphql, comparison, free-tier |
| 002c | accounting-api-freshbooks | comparison | FreshBooks OAuth 2.0 + Accounting API ergonomics vs QBO | **PARTIAL ⚠** (freelancer SKU only) | accounting, oauth, rest, comparison, freelancer-niche |
| 003 | minions-over-pglite | standard | Does `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow` complete cleanly with PGLite as the gbrain backend? Phase 4 unblock. | **VALIDATED ✓** (works inline; 3 gotchas for Phase 4) | gbrain, minions, pglite, phase-4-precondition |
| 004 | accountant-facing-reports | standard | Reframe spike 001's vendor-email plumbing for Mara's CPA — same composition, different audience, different tone. Does sidestepping vendor desirability convert the v2 candidate into a v1.2 shipped feature? | **VALIDATED ✓** (audience swap eliminates 6/8 spike-001 risks) | email, internal, cpa, audience-reframe |
| 005 | gbrain-on-supabase | standard | Does `gbrain migrate --to supabase` move a PGLite brain onto a free-tier Supabase project losslessly, with pgvector + RLS intact and search working? v2.0 foundation (Phase 1) precondition. | **VALIDATED ✓** (lossless 45s migrate; free tier sufficient; 3 gotchas) | gbrain, supabase, postgres, pgvector, v2.0-foundation |
| 006 | gbrain-in-process | standard | Can the app import gbrain as a library and run queries in-process (no child_process), so the architecture survives Vercel serverless? v2.0 Phase 3 precondition. | **VALIDATED ✓** (in-process query works 1.34s; recommends inserting an in-process-refactor phase before deploy) | gbrain, vercel, serverless, in-process, architecture |

## Related Project Context

- v1.0 (shipped): synthetic Mara's Coffee seed brain + 3-min demo path; see `.planning/v1.0-MILESTONE-AUDIT.md`
- v1.1 Phase 6 (planned, not yet executed): QuickBooks Online ingest; see `.planning/ROADMAP.md` and `.planning/research/SUMMARY.md`
- v2 stretch (deferred): Stripe / Gmail connectors (`STRP-01`, `GMAIL-01` in REQUIREMENTS.md)

---

*Manifest created: 2026-05-18.*
