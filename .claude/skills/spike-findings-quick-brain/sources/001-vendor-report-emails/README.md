---
spike: 001
name: vendor-report-emails
type: standard
validates: "Given a tenant brain with 7 days of invoices+bank lines for a vendor, when a weekly job composes a per-vendor activity summary email and queues it for send via Resend, then the email arrives with correct totals + citations and an approval gate (review before send) — and we can articulate the scheduler choice"
verdict: PARTIAL
related: []
tags: [email, outbound, compliance, scheduler]
---

# Spike 001: Vendor Report Emails

## What This Validates

**Given** a tenant brain (Mara's Coffee) with 7 days of invoices + bank-statement debits for a vendor (Beanstalk Roasters),
**When** a weekly job composes a per-vendor activity-summary email and queues it for send via Resend,
**Then** the email arrives with correct totals + citations to the brain's source pages, an approval gate (operator reviews before send) prevents accidental outbound, and we can articulate the scheduler choice (Minions vs system cron vs Vercel Cron vs GH Actions).

## Research

### Email delivery — Resend reuse from Phase 5

Phase 5 already commits Resend as the email provider for magic-link auth (see `.planning/research/SUMMARY.md` and `STACK.md`). Reusing the same `RESEND_API_KEY` and verified domain for vendor outbound is operationally free.

**Volume math:** A typical Mara-shaped SMB has ~5–10 active vendors. Weekly per-vendor email = 5–10/week = 20–40/month. Resend free tier is 3,000/month and 100/day — order-of-magnitude headroom. (Source: resend.com/pricing as of 2026.)

**Deliverability:** Resend's published primary-inbox rate is "good" (sufficient for transactional + ongoing-relationship email) but trails Postmark's 98.7% inbox placement. For vendor email — which is *relationship*, not cold acquisition — the gap doesn't matter. SPF/DKIM/DMARC on the sending domain is mandatory either way; without them, even Postmark lands in spam.

### Scheduler options

| Option | Pros | Cons | Demo VM fit |
|---|---|---|---|
| `gbrain` Minions | Durable; deterministic; $0 token cost; survives crashes; runs in same Bun process | Tied to gbrain process lifecycle; Minions docs are Postgres-native (PGLite path is the Phase 4 spike's open question); cron-shaped scheduling needs a wrapper | **Best fit** if Phase 4 spike validates shell-job execution on PGLite |
| System `cron` / `launchd` | Zero extra infra; persists across reboots; OS-native; the entire demo VM already runs one user | Off-process: must hit a Route Handler or invoke a CLI command from cron; logs land in syslog, not the app; brittle on different operator machines | Easy for the Oracle Cloud VM; awkward for the operator to set up on their own laptop |
| Vercel Cron (if deployed there) | Declarative in `vercel.json`; managed; no infra; per-deployment | Locks us to Vercel hosting; minimum cron resolution is daily on hobby tier | N/A — we're not on Vercel currently |
| GitHub Actions cron | Free; declarative; easy to manage; can call a webhook | Off-deployment infrastructure; GHA cron has a known 5–15 min jitter; secrets live in GH | Easy to set up but feels overkill for a demo VM |
| `node-cron` / `croner` in-process | In-Bun-process; tight integration with the brain; can read from `lib/gbrain` directly | Dies if Next.js restarts (which it does on every deploy); not durable; competes with HTTP request handling for the event loop | Anti-pattern for production but fine for the demo |

**Chosen approach for the spike:** Simulate the schedule as a stdout-only "demo trigger" — the HTML preview shows what the email *would* contain if the scheduler fired. The actual scheduler choice is a Phase-7+ decision; the spike answers "is this content shape right?" first.

### CAN-SPAM + B2B email compliance

**US — CAN-SPAM Act (2003):**
- Applies to *all* commercial email, including B2B. B2B is NOT exempt.
- Required: accurate `From` header, accurate `Subject` line, physical postal address, clear opt-out mechanism, opt-out honored within 10 business days.
- A "weekly vendor activity summary" sent to an *existing supplier* is borderline. If the email facilitates the transactional relationship (e.g. "here's confirmation of orders placed this week"), it's plausibly transactional. If it pushes a value proposition (e.g. "we've identified you're overcharging us"), it's commercial — full CAN-SPAM applies.
- Penalty: up to $51,744 per violation (2024 inflation-adjusted FTC figure).

**EU — GDPR + CASL (Canada):**
- Stricter. Generally require prior consent ("soft opt-in" exists for existing customers but vendor relationships are murkier).
- For a US-built product where Mara's vendors are also US: GDPR/CASL exposure is low unless a vendor happens to be EU/Canada-based.

**Practical implications for the spike:**
- An unsubscribe link MUST be in every email. Resend templates support this; the URL can point to `/api/email/unsubscribe?token=…` (signed, similar to magic-link).
- The email must clearly identify "Mara's Coffee" as the sender, not "QuickBrain." QuickBrain is the tool; the relationship is Mara ↔ Beanstalk.
- An approval gate (operator reviews each batch before send) is the cleanest legal and trust posture — it converts "automated outbound" into "operator-assisted compose," shifting liability to the operator and reducing the chance of accidental spam.
- A first-send opt-in flow (the very first email asks "would you like a weekly summary?") would be ideal long-term but is over-scoped for the spike.

**Sources:**
- [FTC CAN-SPAM Act Compliance Guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business) — definitive for US.
- [GDPR Article 6 / 7](https://gdpr-info.eu/art-6-gdpr/) — lawful basis for processing.
- [Resend deliverability docs](https://resend.com/docs/dashboard/deliverability) — DKIM/SPF/DMARC requirements.

### What does the email actually contain?

The brain already produces three building blocks the email can compose from:

1. **Top vendors / activity** — `lib/insights/top-vendors.ts` produces per-vendor totals.
2. **Anomaly findings** — `concepts/march-anomaly-summary.md` per-vendor lines (after v1.1 Phase 4 smb-audit skill lands).
3. **Source citations** — every line has a `[[companies/<slug>]]` or `[[originals/<file>]]` wikilink.

Per-vendor email skeleton (worked example for Beanstalk Roasters, week of 2026-03-01..07):

```
Subject: Mara's Coffee — Weekly Activity Summary (Beanstalk Roasters, week of Mar 1)

Hi Beanstalk team,

Here's a quick summary of activity from our side for the past week:

  • Orders placed: 2 × 25lb bags (whole bean, medium roast)
  • Total billed: $1,830.00 ($915.00/bag — new pricing in effect since Mar 1)
  • Open invoices: BR-2026-03-A (paid Mar 4), BR-2026-03-B (paid Mar 11)

A note on our end: we recorded the +22% unit-price change effective Mar 1
(was $750/bag, now $915/bag). Please let us know if any of the above looks off.

— Mara, Mara's Coffee

[Unsubscribe from these weekly summaries]
[Sent by Mara's Coffee via QuickBrain]
```

**Two design calls the spike highlights:**

1. **Subject line tone matters.** "Weekly Activity Summary" reads as transactional. "Beanstalk Performance Report" reads as adversarial. The former survives CAN-SPAM; the latter risks a relationship.
2. **Do NOT auto-include anomaly findings.** The smb-audit skill flags "Beanstalk +22% MoM" as a *notable event*, but the email should describe the change neutrally, not accuse. The anomaly summary is operator-internal. The email is vendor-facing.

### Approval gate UX

**Strong recommendation:** never auto-send. Operator reviews each batch in a digest:

```
This week — 5 emails ready to send
─────────────────────────────────────────────────
☑ Beanstalk Roasters         2 orders, $1,830     [Preview] [Edit] [Skip]
☑ Square POS                  no orders            [Preview] [Edit] [Skip]
☑ 7shifts                     $43 (1× monthly)    [Preview] [Edit] [Skip]
☑ Landlord LLC                $3,200 rent paid    [Preview] [Edit] [Skip]
☑ PG&E                        $412 utility paid   [Preview] [Edit] [Skip]
─────────────────────────────────────────────────
[Send 5 emails]   [Send later]   [Skip all this week]
```

This converts the spike from "spam risk" into "operator's weekly admin assist" — Mara remains in control. The bigger workflow question: should the spike test the *send* path at all? Even with Resend's free tier, hitting a real vendor mailbox in a spike is a one-way action with reputation cost. **Test with `to: hannanmannankanji@gmail.com`** (the operator's own address), never a real vendor.

## How to Run

```bash
# Open the email preview in a browser:
open .planning/spikes/001-vendor-report-emails/email-preview.html

# Open the scheduler-comparison page:
open .planning/spikes/001-vendor-report-emails/scheduler-comparison.html
```

## What to Expect

- `email-preview.html` renders the proposed Beanstalk weekly email *as it would appear in the recipient's inbox*. Includes the approval-gate digest UI as a Mara-facing companion view.
- `scheduler-comparison.html` is a side-by-side comparison of the 5 scheduler options against this use case.
- Neither page sends real email. They are visual rehearsals.

## Observability

No backend log layer needed — both artifacts are pure HTML for visual rehearsal. The "send" buttons are inert.

## Investigation Trail

**Iteration 1 — initial framing as "vendor performance reports":** The original idea was "weekly audit emails to vendors." Reading the actual gbrain data revealed the obvious legal risk — Mara reporting "you overcharged us" to her supplier is hostile, not helpful. Pivoted the framing to "weekly activity summary," which is what most SaaS operations tooling actually does (Stripe sends merchants weekly stats; QuickBooks sends invoice reminders).

**Iteration 2 — does the vendor even want these?** The spike asks Mara's perspective ("would Mara want to send these?") but the relevant audience is the vendor. Coffee roasters don't *want* an automated weekly summary from every café they supply — they want clean POs and timely payment. The product-shape question this surfaces: is the actual value of these emails *internal* (Mara reviews them before sending and learns about her own business), and the "send to vendor" step is a deferred maybe? Worth flagging — the spike's content-composition path is high-value even if outbound is never enabled.

**Iteration 3 — approval gate is mandatory, not optional:** Both for legal (CAN-SPAM unsubscribe) and trust (Mara doesn't want an autopilot bot sending her supplier accusatory emails). The digest pattern from Stripe Dashboard's "Weekly digest" is the template.

**Iteration 4 — scheduler choice is downstream of "does the workflow ship?":** Each scheduler option works; picking one is a Phase-7+ implementation detail. The spike's job is to confirm there's a viable option, not pick the final one. Minions is the most aesthetically-correct (everything else QuickBrain does runs through gbrain), but PGLite-compat is unverified — the Phase 4 spike is the unlock.

## Results

**Verdict: PARTIAL ⚠**

**What's validated:**
- Email composition from the brain's existing data is feasible — the brain already knows everything the email needs (orders, totals, vendor identity, dates). No new data layer required.
- Resend at 5–10 vendors × 4 weeks = ~30 emails/month sits comfortably in the free tier and reuses Phase 5's verified domain. No new vendor relationship needed.
- Approval-gate UX is straightforward — same shadcn primitives we already use for the dashboard.
- A viable scheduler exists for every realistic deployment shape (Minions for self-hosted, GHA cron for managed).

**What's surfaced as risk:**
- **Vendor-side desirability is unknown.** Suppliers want POs and payments, not summary emails from their customer's "AI brain." A real-world pilot with 1 friendly vendor is the only way to find out. Until then, the feature should be opt-in per-vendor at minimum.
- **The framing question is real.** "Audit emails" → hostile. "Activity summaries" → benign. Tone-policing is non-trivial; this is a copy/UX problem more than an engineering problem. The smb-audit skill (Phase 4) flags anomalies *internally*; vendor emails should NEVER auto-include flagged anomalies.
- **CAN-SPAM unsubscribe + physical address are mandatory.** Adds a new endpoint (`/api/email/unsubscribe`), a footer template, and a `physical_address` field in tenant settings (small but new).

**What's invalidated:**
- Nothing core. The technical path is clear.

**Recommendation:**
- **Build it, ship it BEHIND a dashboard "Compose vendor emails" button that DOES NOT auto-send.** The brain composes drafts, Mara reviews, Mara hits send for the week. This is high-value-low-risk and is the natural extension of the v1.0 dashboard.
- **Defer the cron path until Phase 6 closes** — adding a scheduler is meaningful complexity (PGLite + Minions interaction, plus the unsubscribe + opt-out plumbing) and the manual-trigger path already delivers 80% of the value.
- **Roadmap candidate:** v1.2 milestone "Outbound Communications" — pairs this spike's findings with a CRM-lite layer for vendor contact info (right now QuickBrain doesn't store a vendor's email address; the seed brain doesn't either; QBO has `Vendor.PrimaryEmailAddr`).

**Open questions for next session:**
1. Does Mara even want this enough to use it weekly? (User-research-shaped; we'd want a 3-pilot test with real café operators.)
2. What's the LLM-prompt + structured-output pattern for composing the email body? (gbrain `think --model haiku` is the right model; the prompt should produce JSON with `subject`, `body`, `flagged_anomalies_omitted_for_safety: true` fields so we have provenance.)
3. Is there a fully-on-platform alternative — e.g., a "Send to your accountant" button (Mara's CPA) instead of "Send to your vendor"? That's a friendlier first surface and surfaces the same brain insight without the supplier-relationship risk.

---

*Spike investigation: 2026-05-18.*
