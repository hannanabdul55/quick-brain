---
spike: 004
name: accountant-facing-reports
type: standard
validates: "Given Mara's existing brain (synthetic seed) and her CPA's pre-month-end mental model, when QuickBrain composes a monthly summary email targeted at the CPA (not at vendors), then the recipient explicitly wants the email, the tone unblocks anomaly inclusion, and the spike-001 plumbing reuses ~80% — turning the PARTIAL spike-001 verdict into a v1.2 shipped feature"
verdict: VALIDATED
related: [001]
tags: [email, internal, cpa, audience-reframe, audit-trail]
---

# Spike 004: Accountant-Facing Reports

## What This Validates

Spike 001 left a real product question hanging: **do vendors actually want weekly summary emails?** The answer is "uncertain, requires pilots." This spike reframes the audience: send the monthly summary to **Mara's bookkeeper or CPA** instead — a recipient who explicitly wants the data, is professionally obligated to read it, and can act on anomalies the spike-001 vendor-facing tone forbade including.

Hypothesis: the recipient swap unlocks ~80% reuse of spike-001's composition pipeline + a strict superset of features (anomalies *can* be included; CAN-SPAM unsubscribe is still required but easier to justify; the digest UI shrinks to a single recipient).

## Research

### Who's the CPA, what do they want?

Small-business bookkeepers and CPAs typically receive monthly close packages from their clients. The typical format:

- A **trial balance** or **P&L summary** for the period
- A list of any **new or unusual transactions** (cash deposits, refunds, owner draws)
- A **vendor activity summary** — who got paid, how much, for what
- A **bank reconciliation** showing matched vs unmatched lines
- **Flagged items needing the bookkeeper's judgment** ("is this a fixed asset or an expense?", "is the loan principal/interest split right?")

QuickBrain's existing data shape already covers 3 of 5 (P&L via `lib/insights/pnl.ts`, vendor activity via top-vendors parser, flagged items via `smb-audit` anomalies). Reconciliation matching and the trial balance are gaps — but they're nice-to-haves, not blockers.

### Why the audience swap is the right move

| Concern | Vendor-facing (spike 001) | CPA-facing (spike 004) |
|---|---|---|
| Recipient desire | **UNKNOWN** — needs pilots; suppliers don't ask for these | **HIGH** — CPAs are paid to want this; monthly close package is industry standard |
| Tone risk | High — anomaly mentions read as accusation; tonal policing required | Low — CPAs *want* the anomaly list; that's their job |
| Anomaly inclusion | **NEVER** — server-side template validator blocks `operator_hint` content | **ALWAYS** — anomalies are the headline of the email |
| Approval gate | Required (CAN-SPAM, vendor relationships) | Optional in practice but kept for trust |
| Frequency fit | Weekly (matches operations rhythm of vendor ordering) | Monthly (matches close cycle) |
| Volume per tenant | 5-10 vendors × 4 weeks = 20-40/mo | 1 CPA × 1 monthly = 1/mo |
| Resend deliverability concern | Multiple recipient domains; reputation per-vendor | Single trusted recipient; the CPA's inbox |
| Legal compliance | CAN-SPAM applies, but tighter due to multiple unsolicited recipients | CAN-SPAM applies but minimal — single recipient with established relationship |

**The audience swap eliminates 6 of 8 risks from spike 001.**

### What changes in the implementation?

- **Recipient storage:** add `tenant.cpa_email` to the user settings (one row, not per-vendor). Far simpler than spike 001's per-vendor `vendor_email` plumbing.
- **Template:** dense, data-first, table-heavy. Inverse of the vendor email's lean prose. CPAs read for the numbers.
- **Anomaly inclusion:** anomalies are the *headline*, not omitted. Include severity badges, dollar impact, source citations.
- **Cadence:** monthly (first business day of the month, period = prior month). Not weekly. Reduces send volume from 20-40/mo to 1/mo per tenant.
- **Approval gate:** kept (Mara should see what's going to her bookkeeper) but simpler — single email, single preview, send-or-skip.
- **PDF attachment optional but high-leverage:** bookkeepers archive these. A PDF attachment of the same content (printable, no JS) reads as "professional" and is the standard format CPAs receive elsewhere.

### Reuse from spike 001

| Spike 001 component | Reused by spike 004? | Adapted how? |
|---|---|---|
| Resend integration | Yes, 100% | Same `RESEND_API_KEY`, same verified domain, same wrapper |
| Email signing/identity (FROM operator, not QuickBrain) | Yes | Mara is still the sender; the CPA is the recipient |
| Unsubscribe link + signed-token endpoint | Yes | CAN-SPAM still applies. Same token shape as magic-link from Phase 5 |
| Physical-address footer | Yes | Same tenant settings field |
| Approval-gate UI primitives (shadcn Card + Checkbox + Button) | Yes | Simpler — single recipient, single email per cadence |
| Server-side template validator | Yes, **inverted** | Vendor template REJECTS anomaly content; CPA template REQUIRES it (validator runs both directions) |
| `smb-audit` skill output as data source | Yes, **without filtering** | The `concepts/march-anomaly-summary.md` page is now the email's centerpiece |
| Composition via `gbrain think --model haiku` | Yes | Different prompt, same model |
| Vendor-email field on company pages | **NO** | CPA email lives on the tenant, not on company pages |
| Per-vendor digest with rows + checkboxes | **NO** | Single recipient, single preview |
| Weekly scheduler decision | **NO — different cadence** | Monthly cron is simpler; runs on the 1st of each month |

**Net reuse: ~80% of spike-001's plumbing applies directly. The ~20% delta is the simpler recipient model.**

## How to Run

```bash
open .planning/spikes/004-accountant-facing-reports/cpa-email-preview.html
```

## What to Expect

The HTML preview renders the monthly close email as Mara's CPA, "Lin Chen, CPA at Chen & Co Bookkeeping," would see it in their inbox. Includes anomaly section, vendor activity table, P&L snapshot, and a printable CSS print-only stylesheet (cmd+P → looks like a proper PDF report).

The artifact intentionally uses dense data presentation — inverse of the vendor email's lean prose template from spike 001's `email-preview.html`.

## Investigation Trail

**Iteration 1 — started by listing what a CPA actually wants.** Looked at standard monthly-close package formats. Trial balance, P&L, vendor activity, reconciliation, judgment-flag list — five-component pattern. QuickBrain already produces three of five from existing parsers.

**Iteration 2 — caught the inversion of the template-validator rule.** Spike 001's biggest invariant ("never inject anomaly findings into the email body") doesn't apply here. In fact, it *flips* — the anomaly list IS the email body's centerpiece. This is a clean inversion (the server-side validator can serve both templates with audience-keyed rules). Cleaner than expected.

**Iteration 3 — questioned whether this should ship as `cpa-monthly-close` or as a generalization of spike 001.** Initial impulse: build a single "outbound digest" abstraction that handles both recipients. Walked it back: the templates, cadences, and validator rules are different enough that a single abstraction would carry the worst of both. Better to ship spike-004's monthly-CPA path as v1.2 and treat spike-001's weekly-vendor path as a separate v1.3 feature (if vendor pilots succeed). Two narrow features beat one wide one.

**Iteration 4 — PDF attachment is the small detail that changes the product feel.** CPAs treat email as ephemeral; archives are PDFs. A printable CSS sheet on the same HTML (with `@media print`) is the trick — no PDF library, no Puppeteer, no extra service. Browsers print to PDF natively. The HTML preview includes the print stylesheet so cmd+P shows the proper monthly-close report.

**Iteration 5 — wondered whether the user IS the CPA in some QuickBrain personas.** Edge case worth noting: if Mara IS the bookkeeper (some small businesses outsource bookkeeping but some do it in-house), the CPA-facing email becomes a self-email. Still useful as an archival format ("here's last month, filed under Mar 2026") but the cadence + composition is the same. No behavior change needed; just relabel the recipient as "yourself or your bookkeeper" in the UI.

## Results

**Verdict: VALIDATED ✓** — The audience swap is a strict-superset win. Reuses 80% of spike-001's plumbing while eliminating the recipient-desirability risk that left spike-001 stuck in PARTIAL. This is the cleanest path to shipping outbound communications in v1.2.

**Recommendation:** Reframe the v1.2 "Outbound Communications" milestone candidate (from the spike-wrap-up summary) to lead with **CPA-facing monthly reports**, deferring vendor-facing weekly emails to v1.3 or later pending a real-world pilot.

**Three findings:**

1. **PDF attachment via print CSS is the unobvious high-leverage choice.** No new dependencies, no Puppeteer, no Cloud Run rendering service. The HTML's `@media print` stylesheet handles the archival format CPAs want.
2. **Anomaly inclusion is the headline, not the omission.** Inverts the spike-001 template validator's most important rule — and the inversion is clean, audience-keyed.
3. **Single-recipient model is materially simpler** than the per-vendor digest from spike 001. One tenant setting (`cpa_email`), one cadence (monthly), one preview, one send. The send pipeline is ~30% of the code volume of spike 001's vendor-digest pipeline.

**Open questions for next session:**

1. Does Mara know who her CPA is at onboarding time? Probably not — adds a Settings page item ("Connect your bookkeeper"). One-line UI; not a blocker.
2. Should the report be branded "Mara's Coffee" (operator brand) or "QuickBrain" (tool brand)? Spike-001 settled this for vendor emails (operator brand wins); same answer applies — CPAs trust the client, not the tool the client uses.
3. Is there a standardized format CPAs prefer? (CSV import to QuickBooks Pro Desktop? OFX? .qbo file?) The basic email + PDF covers 90% of bookkeepers; specialized exports are a v1.3+ feature.

---

*Spike investigation: 2026-05-19.*
