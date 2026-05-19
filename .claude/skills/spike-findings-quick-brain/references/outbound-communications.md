# Outbound Communications

Composing and sending email from QuickBrain on the operator's behalf. Two recipient classes have been spiked:

- **CPA-facing monthly close reports** (spike 004 — VALIDATED, lead the v1.2 milestone with this)
- **Vendor-facing weekly activity summaries** (spike 001 — PARTIAL, gated on a real-world pilot before shipping)

These share ~80% of plumbing but live behind different audience contracts and template-validator rules.

## Requirements

Non-negotiable for any outbound email feature. Apply to both audiences unless explicitly marked.

### Shared (both audiences)

- **No auto-send. Every outbound email passes through an operator approval gate.** Mara reviews the preview, optionally edits, and explicitly hits Send.
- **Email is sent FROM the operator's identity** (`mara@maras-coffee.com`), not from QuickBrain. The footer credits QuickBrain as the tool that composed it.
- **Reuse the existing Resend integration** (locked for v1.1 Phase 5 magic-link auth) — one provider, one verified domain, one `RESEND_API_KEY`. SPF/DKIM/DMARC must be configured on the sending domain.
- **A physical postal address and unsubscribe link** appear in every email footer (CAN-SPAM §5.3 + §5.4).
- **Token shape for unsubscribe links matches Phase 5's magic-link token shape** — same signing key, same JWT claim layout. Reuse the verification helpers from `lib/auth/jwt.ts`.
- **A server-side template validator runs on every outbound payload** before send. The validator is audience-keyed:
  - For CPA emails: anomaly inclusion is REQUIRED (presence-check on `concepts/*-anomaly*` references in the body)
  - For vendor emails: anomaly inclusion is FORBIDDEN (substring-check rejects any content matching `severity:` / `flagged anomaly` / `operator_hint`)

### CPA-specific (spike 004)

- **v1.2 leads with CPA-facing monthly reports** — recipient explicitly wants them, anomalies are the headline (not the omission), single-recipient model is materially simpler than per-vendor digest.
- **Cadence is monthly** (first business day, period = prior month). Not weekly. Reduces send volume to ~1/mo per tenant.
- **CPA email is a single tenant setting (`tenant.cpa_email`)** — not per-vendor plumbing.
- **PDF archival format is a print-CSS stylesheet on the HTML email body** (`@media print`) — NOT Puppeteer / Cloud Run / a PDF library. CPAs cmd+P to save the PDF; the print stylesheet strips chrome and produces the close-package format they archive.
- **Anomaly inclusion is the headline.** The `concepts/*-anomaly-summary*.md` pages (from the Phase 4 `smb-audit` skill) are surfaced first, with severity badges, dollar impact, and source citations.

### Vendor-specific (spike 001, GATED on pilot)

- **Vendor email path requires a 3-tenant pilot test** before general availability. The recipient-desirability question is uncertain enough that shipping without pilot data is irresponsible.
- **Anomaly findings from `smb-audit` MUST NEVER auto-inject into vendor-facing email bodies.** Server-side validator enforces this; failed payloads return 400 with the offending substring in the error.
- **Cadence is weekly** (Monday morning, period = prior week).
- **Vendor email field comes from the QBO/Xero `vendor_email`** transformer output on `companies/<connector>-<slug>.md` frontmatter. If absent, that vendor is excluded from the digest with "Add email to enable" affordance.
- **First implementation is manual-trigger** ("Compose this week's vendor emails" button), not scheduled. Cron decision deferred until after pilot validates vendor desirability.
- **Subject pattern: `"<Business> — Weekly Activity Summary (<Vendor>, week of <Mon> <D>)"`.** "Activity Summary" is the canonical wording — neutral, transactional. "Performance Report" / "Audit" / "Review" all read as adversarial and break vendor relationships.

## How to Build It

### v1.2 Phase A — CPA-facing monthly close (recommended ship path)

The pipeline has 4 stages. Build in order; each is independently testable.

1. **Tenant settings**: add `cpa_email`, `cpa_name` (optional), `business_physical_address` to the tenant row in `data/quickbrain-app.sqlite` (bun:sqlite, established for Phase 5). One row per tenant, written once during settings setup.

2. **Composition**: a monthly cron (or manual trigger) gathers the prior month's data from the tenant's brain:
   - Anomaly findings from `concepts/march-anomaly-summary.md` (Phase 4 skill output)
   - P&L snapshot from `lib/insights/pnl.ts` (parsed monthly close, MoM delta)
   - Top vendors for the period from `lib/insights/top-vendors.ts`
   - Optionally: a flagged-items list from `concepts/audit-error.md` if the skill failed

   These compose into a structured `CPAMonthlyClose` object — pure data, no styling.

3. **Render to HTML**: a template function takes the `CPAMonthlyClose` object and renders the HTML email body. The template at `sources/004-accountant-facing-reports/cpa-email-preview.html` is the working reference. Key invariants:
   - Subject: `"<Business> — <Month> <YYYY> Monthly Close"`
   - Flagged anomalies as the lede (3 max, sorted by `severity DESC, dollar_impact DESC`)
   - P&L snapshot table with MoM delta
   - Top vendors table
   - `@media print` stylesheet so cmd+P produces the archive PDF format

4. **Approval gate + send**: simple preview UI (single email per cadence, no per-row checkboxes — much simpler than vendor digest). Mara hits Send. Server validates payload (CPA path: anomaly content REQUIRED). Resend send. Log to `outbound_emails` audit table.

### v1.3 Phase B — Vendor-facing weekly (gated on pilot)

If 3+ friendly real-world cafés validate vendors want these, build it. The composition pipeline mirrors Phase A with audience-keyed differences. The template at `sources/001-vendor-report-emails/email-preview.html` is the working reference.

Key delta vs CPA path: the operator digest UI is per-vendor (one row per vendor per week), the cadence is weekly, the template validator REJECTS anomaly content, and the vendor email comes from `companies/qbo-<slug>.md` frontmatter (which is only populated when the QBO connector is connected — see `accounting-connectors.md`).

### Server-side template validator (shared module)

```typescript
// lib/outbound/validator.ts
type Audience = 'cpa' | 'vendor';

const FORBIDDEN_VENDOR_SUBSTRINGS = ['severity:', 'flagged anomaly', 'operator_hint', 'anomaly_type'];
const REQUIRED_CPA_SUBSTRINGS = ['concepts/', 'severity'];  // anomaly section must be present

export function validateOutboundPayload(
  audience: Audience,
  subject: string,
  body: string,
  footer: string,
): { ok: true } | { ok: false; reason: string } {
  // Shared invariants
  if (!footer.includes('Unsubscribe')) return { ok: false, reason: 'missing unsubscribe link' };
  if (!footer.match(/[A-Z][a-z]+ St|Ave|Blvd|Rd/)) return { ok: false, reason: 'missing physical address' };

  // Audience-keyed rules
  if (audience === 'vendor') {
    for (const forbidden of FORBIDDEN_VENDOR_SUBSTRINGS) {
      if (body.includes(forbidden)) {
        return { ok: false, reason: `vendor email contains forbidden content: ${forbidden}` };
      }
    }
  } else if (audience === 'cpa') {
    for (const required of REQUIRED_CPA_SUBSTRINGS) {
      if (!body.includes(required)) {
        return { ok: false, reason: `cpa email missing required content: ${required}` };
      }
    }
  }

  return { ok: true };
}
```

This validator runs on every send. It's the single load-bearing safety check that prevents anomaly hints from leaking to vendors and ensures CPA emails actually contain the data CPAs want.

## What to Avoid

- **Do NOT auto-send to any audience.** Even with an "Mara opted into autopilot" toggle. The cost of one wrong email (relationship damage, possible CAN-SPAM penalty up to $51,744/violation, broken CPA trust) dwarfs the operator-time savings.
- **Do NOT skip the audience-keyed template validator** even in early-internal-testing mode. Bake the guardrail in from day one — the send pipeline should reject any payload that fails validation.
- **Do NOT use Puppeteer / Chromium-headless / Cloud Run for PDF generation.** Browser print stylesheet handles it natively. New dependency, new failure mode, zero added value.
- **Do NOT ship vendor-facing emails before the 3-tenant pilot validates recipient desirability.** Spike 001 explicitly defers this. Building the path is fine; enabling general availability without pilot data is the mistake.
- **Do NOT use a different email subject pattern per vendor or per CPA.** Subject creativity reads as marketing, not transactional. Consistency = trust.
- **Do NOT pursue an in-process scheduler** (node-cron, croner inside Next.js). Next.js processes restart; in-process crons die silently. Use gbrain Minions (validated for PGLite in Spike 003 — see `gbrain-skill-infrastructure.md`) or system cron / GH Actions.
- **Do NOT add Vercel Cron to v1.x's vercel.json** — we're not on Vercel. Locks future hosting choices.
- **Do NOT skip the unsubscribe link or physical address.** Both required by CAN-SPAM. Template validator must reject any payload missing either.
- **Do NOT send to a real CPA or vendor address during dev/test.** Always route to `hannanmannankanji@gmail.com` or a known test mailbox during development.
- **Do NOT bundle vendor + CPA emails into a single "outbound digest" abstraction.** Spike 004's investigation walked back this initial impulse: the templates, cadences, and validator rules are different enough that a single abstraction carries the worst of both. Ship them as two narrow features.

## Constraints

- **Resend free tier**: 3,000 emails/month, 100/day.
  - CPA path: 1 email/month per tenant = order-of-magnitude headroom for v1.x.
  - Vendor path (if shipped): 5-10 vendors × 4 weeks = 20-40/month per tenant. Still fits.
- **CAN-SPAM (US)** applies to all commercial email. B2B not exempt. Penalty up to $51,744/violation (FTC 2024 figure). Required: accurate From + Subject, physical address, unsubscribe mechanism, opt-out within 10 business days.
- **SPF / DKIM / DMARC** on the sending domain are mandatory before any live send.
- **Vendor email field availability**: present on QBO (`Vendor.PrimaryEmailAddr.Address`) + Xero (`Contact.EmailAddress`); absent on Wave + FreshBooks. Vendor outbound is structurally tied to the QBO/Xero connector choice (see `accounting-connectors.md`).
- **CPA email field**: lives on the tenant, not per-vendor. Set once in tenant settings.
- **Vendor recipient-desirability is the open product question.** Suppliers want POs and payments, not summary emails. Recommend 3-pilot test with real-world cafés before enabling beyond opt-in-per-vendor.
- **CPA recipient-desirability is the opposite** — CPAs are professionally obligated to read monthly close packages. Spike 004 verdict explicit on this.

## Origin

Synthesized from spikes:
- **004-accountant-facing-reports** (VALIDATED ✓) — leads the v1.2 ship path
- **001-vendor-report-emails** (PARTIAL ⚠) — supplementary path, gated on real-world pilots

Source files available in:
- `sources/004-accountant-facing-reports/` — README + cpa-email-preview.html (with print CSS)
- `sources/001-vendor-report-emails/` — README + email-preview.html + scheduler-comparison.html
