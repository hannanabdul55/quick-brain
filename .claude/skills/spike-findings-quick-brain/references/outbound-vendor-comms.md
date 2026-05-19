# Outbound Vendor Communications

## Requirements

These are non-negotiable for any vendor-facing outbound feature in QuickBrain. They emerged from Spike 001's investigation and apply to *every* future build conversation.

- **No auto-send. Every vendor email passes through an operator approval gate** — Mara reviews each weekly batch in a digest UI and explicitly hits "Send N emails" before anything leaves her account. CAN-SPAM compliance + tone-policing + trust-with-vendor all converge on this single design call.
- **Anomaly findings from the `smb-audit` skill MUST NEVER auto-inject into vendor-facing email bodies.** They appear in the operator's digest as one-line hints ("7shifts: ghost SaaS — double-check this one?") but the email Mara sends to her supplier stays neutral. Accusatory copy → broken vendor relationships.
- **Reuse the existing Resend integration** (already locked for v1.1 Phase 5 magic-link auth). One email provider, one verified domain, one `RESEND_API_KEY` env var. No second provider.
- **First implementation is manual-trigger — a dashboard button "Compose this week's vendor emails"** — not a scheduled cron job. The cron decision is downstream of the Phase 4 spike result on Minions-over-PGLite; the manual path delivers ~80% of the value at ~10% of the complexity.
- **Email is sent FROM the operator's identity ("Mara Okafor / Mara's Coffee"), not from QuickBrain.** The footer credits QuickBrain as the tool; the relationship is Mara ↔ Beanstalk.
- **A physical postal address must appear in the email footer** (CAN-SPAM §5.3). Add a `physical_address` field to the tenant settings.
- **An unsubscribe link must appear in every email**, pointing to `/api/email/unsubscribe?token=<signed>` (CAN-SPAM §5.4). Token shape mirrors the magic-link token from Phase 5.

## How to Build It

The pipeline has 4 stages. Build them in order; each is independently testable.

### 1. Vendor-email storage

QBO's `Vendor.PrimaryEmailAddr.Address` and Xero's `Contact.EmailAddress` both expose vendor email as a first-class field. The Phase 6 QBO transformer must populate it into the `companies/qbo-<slug>.md` frontmatter:

```yaml
---
type: company
title: Beanstalk Roasters
vendor_email: orders@beanstalkroasters.com
vendor_slug: beanstalk-roasters
category: coffee-beans
---
```

If `vendor_email` is missing on a company page, that vendor is excluded from the digest (greyed out, not silently skipped — show "Add email to enable").

### 2. Per-vendor email composition

Reuse the v1.1 Phase 4 `smb-audit` skill's reading-side: parse the brain dir, group recent activity (invoices, bills, bank lines) by vendor for the past 7 days. For each vendor produce:

```typescript
type VendorWeeklySummary = {
  vendor: string;           // "Beanstalk Roasters"
  vendor_slug: string;      // "beanstalk-roasters"
  vendor_email: string;     // "orders@beanstalkroasters.com"
  week_of: string;          // "2026-03-01"
  orders_placed: number;    // 2
  total_billed: number;     // 1830.00
  currency: string;         // "USD"
  invoice_refs: string[];   // ["BR-2026-03-A (paid Mar 4)", "BR-2026-03-B (paid Mar 11)"]
  operator_note: string;    // "we recorded the +22% unit-price change effective Mar 1"
  operator_hint: string;    // INTERNAL ONLY — "smb-audit flagged: price-hike high severity"
};
```

`operator_note` is composed by `gbrain think --model haiku` from the brain's relevant pages. `operator_hint` is computed locally from the `smb-audit` concept pages — **never** sent to the vendor; only shown in the digest UI.

### 3. Operator digest UI

The dashboard mounts a new card "Vendor digest — week of YYYY-MM-DD" above the chat surface. Each vendor row uses the shadcn primitives already in place (Card, Checkbox, Button). The exact layout is in `sources/001-vendor-report-emails/email-preview.html` (the right column). Key elements:

- One row per vendor with a default-checked toggle
- One-line summary (orders + total + flagged-hint)
- Per-row [Preview] [Edit] [Skip] buttons
- Footer CTA "Send N emails" + "Send later" + "Skip all this week"
- A visual indicator that anomaly hints are operator-only (greyed/italic styling)

### 4. Send pipeline

Per-row Send → POST `/api/vendor-emails/send` with `{ vendor_slug, email_body }` → server-side validation against the canonical template (must contain unsubscribe link, must contain physical address, must NOT contain `operator_hint` substring) → Resend send → log to a `vendor_emails_sent` table in `bun:sqlite` for audit + duplicate-send protection.

The server-side template validator is the load-bearing safety check. Even if a future iteration auto-fills more content, the validator prevents anomaly hints from leaking to vendors.

### Email template

The exact template that passed spike review is at `sources/001-vendor-report-emails/email-preview.html`. Key invariants:

- Subject: `"<Business Name> — Weekly Activity Summary (<Vendor Name>, week of <Mon> <D>)"` — "Activity Summary" not "Performance Report" / "Audit"
- Body: ≤6 short lines + bulleted recap + 1 neutral operator note + signoff
- Signoff includes the operator's name and the business's physical address inline
- Footer: unsubscribe link + reply CTA + "Sent by <Business Name> using QuickBrain"

## What to Avoid

- **Do NOT auto-send.** Even with an "Operator opted into autopilot" toggle. The cost of one wrong email to a vendor (relationship damage, possible CAN-SPAM penalty up to $51,744/violation) dwarfs the operator-time savings of skipping the digest review.
- **Do NOT include anomaly findings in the email body.** Even if the operator approves the batch. The smb-audit skill flags "Beanstalk +22% MoM" — that's *internal intelligence*, not vendor-facing reporting. Server-side template validator must enforce this.
- **Do NOT use a different email subject pattern per vendor.** Subject-line creativity reads as marketing, not transactional. Consistency = trust.
- **Do NOT pursue an in-process scheduler** (node-cron, croner inside Next.js). Next.js processes restart; in-process crons die silently. Either gbrain Minions (when Phase 4 spike confirms PGLite compat) or system cron / GH Actions.
- **Do NOT add Vercel Cron to v1.1's vendor.json** — we're not on Vercel. Locks future hosting choices.
- **Do NOT skip the unsubscribe link or physical address** even in early "internal testing" mode. The send pipeline should reject any payload missing either. Build the guardrail with the feature.
- **Do NOT send to a real vendor address during dev/test.** Always route to `hannanmannankanji@gmail.com` (operator's own address) or a known test mailbox. Spike 001's research notes this explicitly — one-way reputation cost is too high.

## Constraints

- **Resend free tier**: 3,000 emails/month, 100/day. At 5–10 vendors × 4 weeks = 20–40/month, order-of-magnitude headroom for v1.x.
- **CAN-SPAM (US)** applies to all commercial email, B2B included. Penalty up to $51,744/violation (FTC 2024 figure). Required: From accuracy, Subject accuracy, physical address, unsubscribe mechanism, opt-out honored within 10 business days.
- **SPF / DKIM / DMARC** must be configured on the sending domain before *any* live send. Without them, even Postmark lands in spam. Resend deliverability docs walk through the DNS setup.
- **Vendor-email field availability**: present on QBO (`Vendor.PrimaryEmailAddr.Address`) + Xero (`Contact.EmailAddress`); absent on Wave + FreshBooks (free-text only). Vendor outbound is structurally tied to the QBO/Xero connector choice — a Wave-connected tenant cannot send vendor emails without manually adding addresses.
- **Vendor desirability is the open question.** Suppliers want POs and payments, not summary emails from their customer. Recommend a 3-pilot test with friendly real-world cafés before enabling beyond opt-in-per-vendor.

## Origin

Synthesized from spike: **001-vendor-report-emails** (verdict: PARTIAL ⚠)
Source files available in: `sources/001-vendor-report-emails/` (README.md + email-preview.html + scheduler-comparison.html)
