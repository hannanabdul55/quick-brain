# Feature Research

**Domain:** SMB ops / accounting copilot — coffee-shop persona "Mara's Coffee" anchored on **monthly P&L / invoice auditing**
**Researched:** 2026-05-16
**Confidence:** HIGH on feature taxonomy and coffee-shop vendor reality, MEDIUM on which 3 questions will "wow" YC judges (subjective)

---

## Anchor Validation: "Monthly P&L / Invoice Auditing"

Before listing features, restating the anchor so nothing drifts: the user's original framing was **"monthly auditing of P&L / invoices."** Every table-stakes feature below must ladder back to one of these audit jobs-to-be-done:

1. **"Where did my money go last month?"** — vendor concentration, expense category breakdown
2. **"What's weird about this month?"** — anomalies vs. prior months (price hikes, duplicates, drift)
3. **"What am I still paying for that I shouldn't be?"** — recurring/subscription audit
4. **"Did I actually make money?"** — P&L snapshot, gross margin trend
5. **"Did anything get billed wrong?"** — invoice vs. statement reconciliation, missing receipts

Features that don't serve one of those five jobs are out of scope for v1 — they belong in differentiators or anti-features. This is the filter I'm using throughout.

---

## Feature Landscape — Axis 1: Onboarding

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Single form: business name + business type | A non-technical owner abandons anything that asks for more than 2-3 fields ([Arcade SaaS onboarding](https://www.arcade.software/post/customer-onboarding-best-practices), [Supademo onboarding](https://supademo.com/blog/saas-onboarding-flow-examples)) | S (15-30m) | Two fields: `business_name`, `business_type`. Type defaults to "Coffee Shop" — that's the only choice the demo persona will pick anyway. |
| Visible progress during brain provisioning | If "60 seconds" passes with a blank spinner the user assumes it crashed. Industry pattern: stream progress events ([Supademo](https://supademo.com/blog/saas-onboarding-flow-examples)) | S (30-45m) | Stream `gbrain init` → `gbrain import` stdout. Show stepwise: "Initializing brain... ingesting invoices (12/47)... wiring knowledge graph... done." |
| Auto-route to dashboard on completion | Empty-state drop-off is the #1 onboarding killer. Pre-populated workspace pattern (Canva, Notion, Airtable) ([Arcade](https://www.arcade.software/post/customer-onboarding-best-practices)) | S (15m) | No "click here to continue" — push them straight into chat + insight cards |
| Synthetic dataset preloaded *by name* ("Mara's Coffee") | The form values must show up in the brain — owner needs to feel ownership of the brain instantly | S (30m) | String-substitute persona name into dataset at import time, or commit pre-rendered for the canonical persona |

**Onboarding table-stakes subtotal: ~2 hours**

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Reset button (operator-visible) | Demo determinism — judges will see the flow twice if it goes well | S (30m) | `rm -rf` per-tenant brain dir + re-seed. Required for demo discipline, not user-facing |
| "Pre-flight" warm-up of gbrain query path | First query can be cold/slow; warm it during onboarding so the user's first ask feels instant | S (15m) | Issue a dummy query post-import; ignore result |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Email/phone signup | "All SaaS has it" | 2h sunk cost (forms, validation, session, password reset thoughts) with zero demo payoff — and breaks the 60-second narrative | Single-session demo, no account |
| OAuth to QuickBooks / Stripe / Gmail | "Real integrations are the wow" | Each OAuth = 60-120m of plumbing, plus sandbox/test account headaches, plus non-determinism in the demo | Synthetic dataset is *faster and more deterministic* |
| Industry picker with 20 options | "Looks general-purpose" | Branching synthetic datasets is hours of work. Demo is for ONE persona | Coffee shop only; mention "more verticals coming" verbally |
| File-upload of real invoices | "Mom-and-pop would do this" | OCR/extraction is its own product. PDF→structured is a week, not 7.5h | Pre-baked synthetic dataset |

---

## Feature Landscape — Axis 2: Ingestion (Synthetic Coffee-Shop Dataset)

**Confidence on vendor categories: HIGH.** Sourced from [Bellwether Coffee startup costs](https://bellwethercoffee.com/blog/coffee-shop-startup-costs), [Financial Models Lab coffee shop budget](https://financialmodelslab.com/blogs/operating-costs/coffee-shop), [Beancount.io coffee shop bookkeeping](https://beancount.io/blog/2026/01/25/coffee-shop-bookkeeping-complete-financial-guide), [Toast restaurant accounting guide](https://pos.toasttab.com/blog/on-the-line/restaurant-accounting-guide).

### Real coffee-shop vendor categories (ground truth)

A neighborhood coffee shop's monthly books realistically include:

1. **Coffee roaster** (largest COGS) — $4–8/lb wholesale, 50–150 lb/month. Concrete vendor names that read as real: *Royal Cup, Stumptown, Counter Culture, Blue Bottle, La Colombe,* or a local roaster like "Heart Coffee Roasters"
2. **Dairy supplier** ($300–800/mo) — milk, oat milk, cream. Concrete: *Strauss Family Creamery, local dairy co-op, or Sysco dairy line*
3. **Foodservice distributor** — pastries, syrups, cups, lids, sleeves, napkins. Concrete: *Sysco, US Foods, restaurant depot*
4. **POS / payment processor** — *Square, Toast, Clover, Stripe Terminal* — both subscription fee ($50–250/mo) AND % of sales as processing fees
5. **Rent / lease** ($1k–8k/mo) — landlord ACH or check, single line
6. **Payroll** ($5k–15k/mo) — *Gusto, ADP, QuickBooks Payroll* — biweekly
7. **Utilities** — *PG&E, ConEd, local water dept, internet (Comcast Business, Verizon)*
8. **SaaS subscriptions** — POS subscription, scheduling (*7shifts, Homebase*), accounting (*QuickBooks Online, Xero*), email (*Google Workspace*), loyalty (*Square Loyalty, Toast Marketing*), music licensing (*Soundtrack Your Brand*)
9. **Insurance** — workers comp, general liability, often monthly auto-pay
10. **Repairs/maintenance** — espresso machine service, plumbing one-offs
11. **Marketing/social** — *Meta Ads, occasional Canva, local print*
12. **Permits/licenses** — annual lump or quarterly
13. **Linen/uniform service** — *Cintas, Aramark* (apron/towel rental, common in food service)
14. **Cleaning supplies** — *Costco, Restaurant Depot* — variable

### Table Stakes (Synthetic Data Categories — must include or "demo doesn't smell real")

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Bank statement CSV** (60-90 days, ~150-200 transactions) | Source of truth for "where did money go" — every vendor category above shows up here | M (45-60m to generate, 15m to import) | Generate via deterministic script (faker + fixed seed). Use the 14 vendor categories above. Mix in 30% cash POS deposits. |
| **Vendor invoices** (PDF or markdown, ~10-20 across 3-4 vendors) | Anchors the "monthly invoice audit" narrative. Lets the brain answer "show me my March invoices from [roaster]" | M (60m for 10-15 hand-crafted markdown invoices) | Markdown is faster than PDF and gbrain handles markdown natively — *huge* time saver. PDFs only if time permits. |
| **Vendor emails** (~5-10 markdown emails) | Demonstrates the "email-to-brain" gbrain story; lets a price-hike anomaly tie to a *narrative* ("our roaster emailed us about a 12% increase") | S (30m) | Markdown files in `inbox/` directory format. Subject + body + sender. |
| **POS daily sales summary** (60-90 days) | Without revenue, the P&L is just expenses — useless | S (30m generate, 15m import) | Single daily total per day. Skip per-transaction detail (not needed for monthly P&L audit, would blow up token budget) |

**Ingestion table-stakes subtotal: ~3 hours** (largely upfront one-time work; reusable across demo runs)

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Receipt image attachments (placeholder PNGs) | Visual texture in the chat ("here's the invoice you asked about") | M (45m, mostly fiddly UI) | Only if demo has dead time |
| Multi-month timeline (6+ months) | Lets "year-over-year" questions land, not just "vs prior month" | M (60m more data generation) | Adds depth for "show trend" questions but inflates dataset size — risk slower ingest in 60s window |
| Synthetic Slack messages from "manager" | Adds "people graph" dimension gbrain is known for | M (60m) | Off-anchor — doesn't serve the P&L audit JTBD. Skip. |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Realistic PDF rendering of invoices | "Looks more real" | gbrain's PDF ingest works, but rendering 15 unique-looking PDFs eats 1-2h of design time | Markdown invoices look professional in the chat surface; PDFs only if a stretch hour exists |
| Live email server import via IMAP | "Show off email-to-brain recipe" | Adds auth, IMAP plumbing, network risk during the demo | Drop markdown files into a folder — gbrain ingest is filesystem-first anyway |
| 1000+ transaction dataset | "Looks like real volume" | gbrain ingest at that size could take >60s, killing the onboarding wow | 150-200 transactions is plenty to surface anomalies and answer the demo questions |
| Realistic POS data per-transaction (item-level) | "Coffee shops have item-level data" | Item-level isn't required for monthly P&L audit (the anchor) — daily totals suffice. Item-level inflates data 100x. | Daily summaries; mention "per-item available in v2" |

---

## Feature Landscape — Axis 3: Chat / Q&A

**Confidence on common SMB questions: HIGH.** Sourced from [Hello Alice CFO questions](https://helloalice.com/financial-questions-small-business/), [Fyle 14 SMB accounting questions](https://www.fylehq.com/blog/accounting-questions-for-small-business), [Toast restaurant accounting](https://pos.toasttab.com/blog/on-the-line/restaurant-accounting-guide), [Restaurant CFO month-end checklist](https://therestaurantcfo.com/restaurant-month-end-close-accounting-checklist/), [CloudCPA top 100 questions for restaurant owners](https://thecloudcpa.net/top-100-questions-restaurant-owners-should-ask-an-accountant/).

### The ~12 questions SMB owners actually ask (real, sourced)

1. **"How much did I spend on [vendor / category] last month?"** — vendor concentration ([Hello Alice](https://helloalice.com/financial-questions-small-business/))
2. **"What's weird about last month?"** — anomaly surfacing, the headline demo question
3. **"What am I paying for monthly that I forgot about?"** — recurring SaaS audit ([Beancount SaaS guide](https://beancount.io/blog/2026/03/11/saas-subscription-management-small-business-guide), [Linkenheimer CPA subscription creep](https://www.linkcpa.com/the-great-subscription-creep-how-software-costs-are-quietly-eating-your-budget/))
4. **"Did I make money last month?"** — P&L snapshot, gross margin ([Fyle](https://www.fylehq.com/blog/accounting-questions-for-small-business))
5. **"Where is my money going?"** — top-N expense categories ([Hello Alice](https://helloalice.com/financial-questions-small-business/))
6. **"What did I spend on coffee beans vs. last month?"** — month-over-month line item comparison (price-change detection)
7. **"Did any vendor charge me twice?"** — duplicate detection ([uSafe red flags](https://usafe-ca.com/2025/05/15/common-audit-red-flags-and-how-to-avoid-them-in-your-business/))
8. **"Am I over/under on labor cost percentage?"** — prime cost ratio for restaurants ([Restaurant CFO](https://therestaurantcfo.com/restaurant-month-end-close-accounting-checklist/))
9. **"How much rent did I pay this year?"** — ad-hoc lookup
10. **"What invoices are unpaid?"** — A/P aging ([uSafe](https://usafe-ca.com/2025/05/15/common-audit-red-flags-and-how-to-avoid-them-in-your-business/))
11. **"How does my March compare to last March?"** — YoY (needs more data — defer)
12. **"What's my tax estimate for this quarter?"** — quarterly liability (way out of scope — anti-feature)

### The 3-5 demo "wow" questions (the must-nail set)

Picking for: (a) tied to the P&L/invoice audit anchor, (b) feasible against a 150-tx synthetic dataset, (c) emotionally resonant for a non-technical owner, (d) showcases multiple gbrain capabilities (hybrid retrieval + cross-linking + synthesis).

**P0 — These MUST land:**

1. **"What was weird about last month?"** — the headline. Surfaces the planted anomalies (price hike on beans, duplicate charge, ghost SaaS). Showcases `signal-detector` / synthesis. *This is the demo's emotional climax — the moment a non-technical owner says "huh, I would never have caught that."*
2. **"Who are my top 5 vendors and how much did I pay each?"** — concrete, easy to verify visually, anchors the "see your money" narrative. Showcases knowledge graph (vendor entity aggregation).
3. **"What am I paying for every month that I shouldn't be?"** — the SaaS creep play. Industry data: [a single audit cuts costs 20%+](https://renewalscout.com/blog/the-hidden-cost-of-forgotten-subscriptions/), 30-50% more subs than expected. Visceral pain point.

**P1 — Nice to have if they work reliably:**

4. **"How much did I spend on coffee beans in March vs. February?"** — concrete numeric Q&A with explanation. Tests whether the brain can do simple arithmetic over filtered events.
5. **"Show me all my invoices from [Royal Cup / roaster name]"** — citation/retrieval showcase. Lets the operator demo gbrain's source-linked answers.

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Plain-English question input | Without this it's not a "brain", it's a dashboard | S (30m for input UI) | Single textbox + send |
| Streaming response | Static "loading..." kills perceived intelligence; modern LLM UX = stream | S (30-45m) | `gbrain query` stdout streaming or `gbrain serve --http` SSE |
| Source citations on answers | "Show me the invoice that says that" — without sources, judges will assume it's hallucinating | M (60m) | gbrain's `query` skill already produces citations — surface them in UI |
| Suggested-question chips below input | Empty chat = blank-page paralysis. Pre-fill the 3-5 wow questions as one-tap chips | S (15m) | Static list, no logic |
| Conversation persistence within session | Owner asks follow-ups: "drill into that one" — chat history is expected | S (15m, in-memory only) | No DB persistence needed; refresh = new session is fine for demo |

**Chat table-stakes subtotal: ~2 hours**

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Inline drill-downs (click a vendor in answer → opens vendor page) | Showcases gbrain's knowledge graph beautifully | M (60-90m) | High-impact if it works; risky to add late |
| Voice input ("press to talk") | Visceral "wow", non-technical owner couldn't do it any other way | M (60m, browser SpeechRecognition + gbrain query) | gbrain has voice-note-ingest skill — narrative fit, but no demo time to test on stage |
| Answer "confidence" badge | Honesty signal for hallucination-skeptical judges | S (30m) | gbrain already returns confidence; just surface it |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Multi-turn agentic planning ("first I'll look at X, then Y...") | "Looks AI-native" | Long agent monologues are slow and lose the audience. Demo wants fast, decisive answers | Single-pass `gbrain query` with synthesis |
| User feedback / thumbs up-down | "All chat UIs have it" | Adds DB, adds backend route, zero demo payoff | Skip |
| Markdown/code rendering | "Looks polished" | Coffee shop answers are prose + numbers, not code | Plain text + bold numbers |
| Question history sidebar | "Like ChatGPT" | Multi-session UX = persistence, accounts, etc. Demo is single-session | In-memory chat only |
| Forced disclaimers ("I am an AI...") | "Compliance" | Breaks immersion in a 3-minute demo | Skip |

---

## Feature Landscape — Axis 4: Insight Cards / Dashboard

**Confidence on which dashboards matter: HIGH.** SMB owners want dashboards in this priority order ([Restaurant CFO month-end](https://therestaurantcfo.com/restaurant-month-end-close-accounting-checklist/), [Toast accounting](https://pos.toasttab.com/blog/on-the-line/restaurant-accounting-guide), [Fyle](https://www.fylehq.com/blog/accounting-questions-for-small-business)):

1. **Top vendors by spend** — answers "where did my money go", anchor question
2. **P&L snapshot** (revenue, COGS, opex, net) — answers "did I make money"
3. **Anomalies flagged** — answers "what's weird"
4. **Recurring subscriptions** — answers "what am I paying for"
5. Cash flow trend, A/R aging, tax liability — useful but deeper

### Table Stakes (Pick the 2-3 highest-signal)

**Recommendation: 3 cards, in this exact priority order.** Each card should be glanceable in under 5 seconds — that's the rule for SMB dashboards ([SYZYGY 5 questions](https://www.syzygy.la/blog-2/the-5-questions-small-business-owners-need-to-ask-about-their-financial-reports)).

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Card 1: Top 5 vendors this month** | Most universally requested SMB view ([Hello Alice](https://helloalice.com/financial-questions-small-business/)). Visceral, instant. | S (45m: aggregate query + bar/list UI) | Bar list with vendor name + $ + delta vs prior month. Click-through = pre-filled "show me my [vendor] invoices" question |
| **Card 2: Monthly P&L snapshot** | The headline financial: revenue / COGS / opex / net. Anchors the "did I make money" question | M (60m: aggregate + simple table UI) | Just 4 rows + the delta vs prior month. Skip charts. |
| **Card 3: Anomalies flagged (3-5 items)** | The "wow" — emotional reaction is visible on a non-technical face. Surfaces planted anomalies on load. | M (60-90m: detection logic + card UI) | This is the demo's punchline before the user even asks a question. See Axis 5 for what to plant. |

**Dashboard table-stakes subtotal: ~3 hours**

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Card 4: Recurring subscriptions / "still paying" | High emotional resonance (everyone hates SaaS creep) — could be ranked higher | M (60m) | Detection = "any vendor charging same amount ≥3 months". If time, add this as the 4th card. |
| Click-through from card to chat prompt | Already noted on Card 1; if applied to all cards = strong product feel | S (30m if cards are already done) | "Wow why does this work so smoothly" feeling |
| Trend sparklines on P&L lines | Adds visual sophistication | M (60m + chart library) | Skip unless time, demo is verbal anyway |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full-page dashboard with 10+ widgets | "Looks like a product" | Becomes a dashboard demo, not a *brain* demo. The chat must be the hero. | 3 cards above the fold + chat below — chat dominates screen real estate |
| Configurable / draggable cards | "Like Datadog/Grafana" | Customization = hours of UI plumbing, judges don't customize anything | Hardcoded layout |
| Export to CSV/PDF | "Owner wants to send to accountant" | Real value but zero demo payoff | Mention verbally if asked |
| Time-range picker (custom date ranges) | "Real dashboards have one" | More UI states = more demo failure modes | Hardcode to "last 30 days" + an internal toggle for "March" if needed for demo narrative |
| Charts (Chart.js, Recharts, etc.) | "Looks data-rich" | Library install + theme + responsive = 1-2h sunk; lists with bold numbers read just as well at demo distance | Tables and bar-list visuals only |

---

## Feature Landscape — Axis 5: Anomaly Detection

**Confidence on what's realistic and dramatic: HIGH.** Sourced from [uSafe red flags](https://usafe-ca.com/2025/05/15/common-audit-red-flags-and-how-to-avoid-them-in-your-business/), [Camonk red flags forensic audit](https://blog.camonk.com/top-forensic-audit-red-flags-in-financial-statements-balance-sheet/), [Beancount SaaS subscription guide](https://beancount.io/blog/2026/03/11/saas-subscription-management-small-business-guide), [Renewal Scout subscription audit](https://renewalscout.com/blog/the-hidden-cost-of-forgotten-subscriptions/), [Ramp anomaly detection](https://ramp.com/blog/ai-expense-management).

### The 5 anomaly archetypes for coffee-shop data (real, common)

1. **Vendor price hike** — coffee bean cost goes from $5.20/lb to $6.10/lb (a real 2026 pattern; coffee prices have risen 15-30%). Detection: line-item $/unit or invoice-total month-over-month >10% delta on a recurring vendor.
2. **Duplicate charge** — same vendor, same amount, within 7 days (POS double-billed, foodservice distributor delivered twice but billed once for both). Industry-cited as a top P&L red flag ([uSafe](https://usafe-ca.com/2025/05/15/common-audit-red-flags-and-how-to-avoid-them-in-your-business/)).
3. **Ghost SaaS** — a recurring subscription that's still hitting the card but the owner forgot they had it (cited everywhere: [Beancount](https://beancount.io/blog/2026/03/11/saas-subscription-management-small-business-guide), [Kiplinger](https://www.kiplinger.com/personal-finance/subscription-audit-save-money), [Renewal Scout](https://renewalscout.com/blog/the-hidden-cost-of-forgotten-subscriptions/)). Highly relatable.
4. **Recurring SaaS drift** — same SaaS but the price quietly went up (Adobe-style renewal hike). Detection: same vendor, same recurrence cadence, amount delta >5%.
5. **Missing invoice for a charge** — bank statement shows a charge with no corresponding invoice in the ingested set. Detection: graph join — bank txn lacks linked invoice page.

### The 2-3 anomalies to PLANT in synthetic data (must-nail set)

Picking for: (a) easy to plant deterministically, (b) easy to detect with simple logic (no ML), (c) dramatic when surfaced, (d) tied to P&L/invoice audit anchor.

**P0 — These MUST be in the seed dataset and MUST get flagged in the anomaly card:**

1. **Coffee bean price hike** — Royal Cup invoice went from $520 in Jan/Feb to $620 in Mar. Vendor email in inbox dataset *announces* the hike ("Dear Mara, due to global coffee market conditions our prices will increase by 12% starting March 1..."). This is the *narrative anomaly* — the email + invoice combo lets gbrain answer "why did my coffee cost more?" by citing the email. **Highest signal because it showcases gbrain's cross-linking.**
2. **Duplicate POS subscription charge** — Square charged $79 on Mar 4 and again on Mar 11 (their actual support docs note this happens). Both show as separate bank txns with identical amounts and merchant strings.
3. **Ghost SaaS — abandoned scheduling tool** — A "7shifts" or similar charge that's been hitting monthly for 6+ months but no recent vendor activity or owner usage. ($29.99/mo). Even more dramatic if surfaced as "you've paid $360 over the past year for this".

**P1 — Plant if dataset size allows:**

4. **Missing-invoice anomaly** — one bank statement line item ($340 to "ABCD Plumbing") has no invoice/receipt anywhere. Surfaces "you might want to ask the vendor for a receipt".

### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Rule-based anomaly detection for the 3 planted types | If anomalies card is empty, the demo dies | M (60-90m total: 20-30m per anomaly type) | Hand-rolled rules, NOT ML. Run as a one-shot at ingest time and write findings to a markdown page in the brain. |
| Anomaly cards link to source documents | Without "show me the email about the price hike" the anomaly feels like magic — judges will assume it's faked | S (30m) | Each anomaly object holds source page IDs; UI renders as "View invoice →" link |
| Plain-English anomaly text ("Your coffee supplier raised prices 12% in March — you can see the email here") | Non-technical owner needs language, not "vendor_id 7 delta +0.18" | S (15m per anomaly type, included in detection time) | Templated strings, deterministic |

**Anomaly table-stakes subtotal: ~1.5 hours**

### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Use gbrain `signal-detector` skill for detection | Strong prize-narrative fit ("the brain noticed this on its own") | M (90m to wire up + tune) | High-risk: signal-detector is built for "original thinking" not for $ anomaly detection. Hybrid: hand-rolled rules write to brain pages → signal-detector picks them up = best of both. |
| Severity ranking (critical/warning/info) | Visual hierarchy in the card | S (15m) | Red/yellow/grey dots — adds polish |
| "Dismiss anomaly" action | Real product feel | S (30m, in-memory only) | But adds a demo failure mode (judge clicks it accidentally) — skip |

### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| ML-based anomaly detection | "Real AI" | Training + thresholding takes longer than the entire 7.5h budget. Cannot guarantee planted anomalies will be flagged. | Rule-based with planted anomalies the rules are tuned for. Judges can't tell the difference in 3 minutes. |
| Real-time anomaly stream | "Live ops feel" | Synthetic data doesn't stream; faking it adds zero value | One-shot detection at ingest time |
| User-configurable rules | "Power users want it" | Coffee shop owner isn't writing rules; UI for rule config = hours | Hardcoded |
| Fraud detection / chargeback handling | Adjacent to anomaly detection | Different problem (transactional, not analytical). Adjacent to demo anchor but not on it. | Skip |
| Predictive anomalies ("you'll likely overpay rent next month") | "Forward-looking AI" | Requires forecasting model, way out of scope | Stick to historical detection |

---

## Feature Landscape — Axis 6: Multi-Tenancy / Accounts

### Anti-Features (everything is here — that's intentional, PROJECT.md already says no auth)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Email/password signup + login | "It's SaaS, it has accounts" | 2-3h minimum (form, hashing, session, password reset thoughts, edge cases) with zero demo payoff. Operator runs the demo with one tenant, one session, one fictional persona. | Single-session: when the page loads, an ephemeral tenant ID is generated and bound to the synthetic dataset. Reset button wipes it. |
| Google/OAuth login | "Faster than email" | Still 1-2h with redirect handling. Adds OAuth client config to deployment. Adds a demo failure mode if network blip happens. | Same as above |
| Multi-user / team roles | "Mara's manager would also log in" | Out of scope by definition for a 60-second-onboarding demo | Verbal: "team access is a v1.1 feature" |
| Workspace switching | "Mara owns 2 cafes" | Requires multi-brain navigation UI | Single-persona demo |
| RBAC / permissions | "Bookkeeper has different access than owner" | Same as above | Skip |
| SSO / SAML | "Enterprise readiness" | Way out of scope for SMB hackathon demo | Skip |
| Email verification | "Anti-spam" | Pre-supposes signup which we already deferred | Skip |
| Per-user data isolation guarantees | "Security" | Single-session means there's nothing to isolate from | Skip |

**Per-tenant isolation IS still in scope mechanically:** brains live in per-tenant directories on disk (e.g., `./brains/{tenant_id}/`) so the architecture is *isolation-ready* for v1.1 without spending demo hours on auth.

### Differentiators (defer until post-hackathon)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Magic-link email login | Lowest-friction real signup | M (60-90m + Resend/Postmark wiring) | Mention in pitch: "post-hackathon path is magic link → real brain init for your real business" |
| Brain export/download | "Owner owns their data" — strong gbrain narrative | S (30m: tar the per-tenant dir) | Stretch if time; aligns with gbrain's "your brain on your disk" ethos |

---

## Feature Landscape — Axis 7: gbrain Skills Usage

**Confidence: HIGH** — sourced directly from the [gbrain repo skills inventory](https://github.com/garrytan/gbrain) (skill list extracted via WebFetch above).

### Critical finding: gbrain has NO bundled invoice / accounting / anomaly skill

The bundled 34 skills are personal-knowledge oriented (signal-detector, idea-ingest, meeting-ingestion, media-ingest, voice-note-ingest, soul-audit, briefing, etc.). There is **no `smb-audit`, `invoice-extract`, or `anomaly-detector` skill**. This is both a risk (we cannot just point gbrain at the data and get instant SMB answers) AND the prize opportunity (a custom `smb-audit` skill is the strongest possible prize-narrative — see stretch goal below).

### Bundled skills that ARE useful for QuickBrain v1

| Skill | Used For | Complexity to Wire Up | Notes |
|-------|----------|----------------------|-------|
| **`setup`** | First-run brain provisioning (PGLite auto-provision) | S — already runs on `gbrain init` | Free, no work needed |
| **`migrate`** | Importing the synthetic dataset (supports CSV, markdown, JSON) | S — `gbrain import` already invokes it | Use markdown + CSV formats for the synthetic dataset → migrate handles it natively |
| **`ingest`** + **`idea-ingest`** + **`media-ingest`** | Routes the synthetic invoices/emails/statements into pages | S — automatic during import | Markdown invoices land as pages; bank statement CSV becomes structured pages; emails ingest cleanly |
| **`enrich`** | Builds vendor pages, links transactions to vendors | M (~30m to verify it triggers on vendor entities) | gbrain auto-wires entity mentions — vendor names in invoices should auto-create vendor pages with timeline of transactions. **This is the magic moment** — knowledge graph appears for free. |
| **`query`** | Powers the chat surface (hybrid search + synthesis + citations) | S — `gbrain query` is a one-liner CLI | This is the main chat backbone. Three-layer hybrid search + citations = exactly what we want. |
| **`signal-detector`** | Could surface anomalies as "signals" (always-on skill, runs on every message) | M (~60m to tune signals for $ anomalies) | Risky — designed for "original thinking" signals, not financial. Try as differentiator, hand-rolled rules as fallback. |
| **`webhook-transforms`** | Could convert "import" events into anomaly pages | S — not strictly needed for v1 | Skip unless minion-orchestrator approach is taken |

### Bundled skills that are NOT useful for v1 (intentionally skipping)

| Skill | Why Skip |
|-------|----------|
| `voice-note-ingest` | No voice data in the synthetic dataset; would impress judges but voice input is a chat differentiator (Axis 3) not an ingestion play |
| `meeting-ingestion`, `book-mirror`, `strategic-reading`, `concept-synthesis` | Not relevant to SMB books |
| `perplexity-research` | Adds external API dependency and demo failure mode |
| `daily-task-manager`, `daily-task-prep`, `briefing` | Personal-productivity skills, not on-anchor |
| `soul-audit` | Identity setup, irrelevant |
| `publish`, `brain-pdf` | Output format skills, not needed for v1 (demo is on-screen) |
| `minion-orchestrator`, `cron-scheduler` | Background job infra — useful conceptually but NO scheduled jobs in v1 (everything is one-shot at ingest). **Strong v1.1 candidate** — "your brain audits your books every Monday morning" is a great pitch. |
| `archive-crawler`, `academic-verify` | Off-domain |
| `migrate` for Obsidian/Notion/Logseq/Roam | Coffee shop owner doesn't have these |

### Stretch goal: custom `smb-audit` skill

**Hours: M-L (90-180m)** — only if core path completes with ≥2h to spare.

**What it would do:** A new markdown+TypeScript skill that runs at ingest time and emits structured anomaly findings as brain pages. Plain-English templates like "Your roaster's price increased by 12% on March 1 (Royal Cup invoice #4521 vs. #4498)". Tagged so the dashboard can render them.

**Why it's the prize-strongest feature:**
- Demonstrates that gbrain's skills system is *extensible by SMB-vertical builders* — exactly the platform story the prize is about
- The custom skill IS the differentiation between QuickBrain and "gbrain with a UI"
- Judge-resonant pitch: "we built a vertical skill in 90 minutes — anyone can do this for their domain"

**Why it's NOT v1 table stakes:**
- 90+ minutes of risk for a feature that can be substituted with hand-rolled JS rules in the web app's import path with same demo output
- gbrain skill development docs may have a learning curve we haven't budgeted for
- If it doesn't load correctly the day of, the whole demo flakes

**Recommendation:** Build the hand-rolled detection FIRST (Axis 5 table stakes). Refactor it into a `smb-audit` skill ONLY if all P0 demo path is solid with ≥2h remaining. The skill version and the hand-rolled version produce identical UI output, so the work isn't wasted — it's the same logic in a different file.

### Differentiators on the gbrain integration

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| MCP server live during demo (`gbrain serve --http`) | Pitch: "her brain is *also* accessible from Claude Desktop, ChatGPT, Perplexity" — extends the prize narrative | S (30m, gbrain already supports it) | Just start the server during onboarding; mention it verbally; optional Claude-Desktop screenshot |
| Visible "knowledge graph wiring" animation during import | Showcases gbrain's auto-wiring (the README's headline feature) | M (45-60m for a simple graph viz) | Stretch — visual polish |

---

## Feature Dependencies

```
[Onboarding form]
    └──triggers──> [Per-tenant gbrain init shell-out]
                       └──triggers──> [Synthetic dataset import via gbrain import]
                                          └──unlocks──> [Vendor knowledge graph via enrich skill]
                                                           └──unlocks──> [Top vendors card]
                                                                              └──unlocks──> [Top vendors chat answers]
                                          └──unlocks──> [Anomaly detection runs at end-of-import]
                                                           └──unlocks──> [Anomaly card]
                                                                              └──unlocks──> ["What was weird" chat answer]
                                          └──unlocks──> [P&L aggregation queries]
                                                           └──unlocks──> [P&L card]

[Chat UI]
    └──requires──> [gbrain query CLI or serve --http]
    └──enhances──> [Insight cards] (cards become click-to-prefill chat prompts)

[Anomaly detection]
    ──conflicts──> [Live data integration] (live data → non-deterministic anomalies → demo flakes)

[Custom smb-audit skill (stretch)]
    └──replaces──> [Hand-rolled detection logic] (same UI output, riskier impl)
    └──requires──> [Hand-rolled detection working first] (so the skill can be ported, not authored from scratch under time pressure)
```

### Dependency Notes

- **Onboarding form → gbrain init:** the whole 60-second narrative hinges on this shell-out working reliably. This is the *first* feature to validate end-to-end (Phase 1 should de-risk this immediately).
- **Synthetic dataset → all downstream answers:** if the dataset is shallow or the planted anomalies aren't in it, everything below collapses. The dataset is on the critical path.
- **enrich (gbrain) → vendor cards & answers:** if gbrain's auto-wiring doesn't kick in on the markdown invoices, vendor entity aggregation fails, and the "top 5 vendors" card has to be hand-rolled SQL instead. **Validate this early** (Phase 1 spike).
- **Hand-rolled detection → smb-audit skill:** build the working detection FIRST in plain JS, port to a skill ONLY if there's time. The skill is a refactor, not a feature.
- **Anomalies conflict with live data:** if anyone is tempted to "just hook up real Stripe", the planted anomalies disappear and the demo loses its punch. Live data is an anti-feature for v1 specifically because it kills the demo.

---

## MVP Definition

### Launch With (v1 — the 7.5-hour build)

**Onboarding (target: ~2h)**
- [ ] Two-field form (business name + business type)
- [ ] Per-tenant `gbrain init` shell-out with streaming progress
- [ ] Auto-route to dashboard
- [ ] Reset button (operator-only)

**Synthetic Dataset (target: ~3h, mostly upfront)**
- [ ] Bank statement CSV: 60-90 days, ~150-200 transactions across the 14 coffee-shop vendor categories
- [ ] 10-15 markdown invoices from 3-4 vendors (roaster, dairy, foodservice, POS)
- [ ] 5-10 markdown vendor emails (including the price-hike email that ties to the planted anomaly)
- [ ] Daily POS sales summaries (60-90 days)
- [ ] 3 planted anomalies: coffee bean price hike, duplicate POS charge, ghost SaaS subscription
- [ ] `gbrain import` runs successfully against this dataset and finishes in <30s

**Chat / Q&A (target: ~2h)**
- [ ] Plain-text input + send + streaming response
- [ ] Source citations rendered in response
- [ ] Suggested-question chips (the 3-5 "wow" questions pre-filled)
- [ ] In-session conversation persistence
- [ ] Three P0 demo questions answer correctly and reliably:
  1. "What was weird about last month?"
  2. "Who are my top 5 vendors?"
  3. "What am I paying for every month that I shouldn't be?"

**Dashboard / Insight Cards (target: ~3h)**
- [ ] Card 1: Top 5 vendors this month (with $ amounts)
- [ ] Card 2: P&L snapshot (revenue / COGS / opex / net)
- [ ] Card 3: Anomalies flagged (3 items from the planted set)
- [ ] Each anomaly card links to its source invoice/email

**Anomaly Detection (target: ~1.5h)**
- [ ] Rule-based detection for the 3 planted anomalies (hand-rolled, runs at end-of-import)
- [ ] Writes findings as markdown pages into the brain (so they're queryable via `gbrain query` too)

**Demo prep (target: ~1.5h, in budget)**
- [ ] Reset-and-rerun script that completes in <10s
- [ ] 3-minute spoken demo script
- [ ] Two practice runs end-to-end

**Total target: ~13h of feature work compressed into 7.5h — meaning Phase 0/1 MUST identify which 30-40% gets cut.** The dashboard and chat both have hidden polish work that will eat hours; the synthetic dataset can probably be partially generated by Claude (script + LLM-fill).

### Add After Validation (v1.x)

- [ ] Card 4: Recurring subscriptions (high resonance, deferred only for time)
- [ ] Click-through from card → pre-filled chat question (UX polish, all cards)
- [ ] Severity ranking on anomaly cards (red/yellow/grey)
- [ ] Custom `smb-audit` gbrain skill (refactor of hand-rolled detection)
- [ ] MCP server live + Claude Desktop screenshot in pitch
- [ ] Voice input (browser SpeechRecognition + gbrain query)
- [ ] More planted anomalies (missing invoice, SaaS drift)

### Future Consideration (v2+, post-hackathon)

- [ ] Magic-link signup / real onboarding (defer until prize/post-hackathon validation)
- [ ] Live QuickBooks / Stripe / Square OAuth ingestion (defer — synthetic was the right v1 call)
- [ ] OCR for real invoice PDFs (defer — different product)
- [ ] Multi-tenant auth and roles (defer until paying customers)
- [ ] Scheduled audit (using `minion-orchestrator` + `cron-scheduler` — "your brain audits your books every Monday")
- [ ] Year-over-year comparisons (defer — needs deeper dataset)
- [ ] Tax estimate liability (defer — different domain, accountant territory)
- [ ] Mobile responsive (defer — desktop demo only)

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Two-field onboarding form | HIGH | LOW | **P1** |
| Per-tenant `gbrain init` shell-out | HIGH | LOW | **P1** |
| Synthetic bank statement + invoices + emails | HIGH | MEDIUM | **P1** |
| 3 planted anomalies in dataset | HIGH | MEDIUM | **P1** |
| Chat with streaming + citations | HIGH | LOW | **P1** |
| 3 P0 demo questions working reliably | HIGH | MEDIUM | **P1** |
| Top vendors card | HIGH | LOW | **P1** |
| P&L snapshot card | HIGH | MEDIUM | **P1** |
| Anomalies card | HIGH | MEDIUM | **P1** |
| Hand-rolled anomaly detection rules | HIGH | MEDIUM | **P1** |
| Reset button + demo script | HIGH | LOW | **P1** |
| Suggested-question chips | MEDIUM | LOW | **P1** (cheap insurance against demo dead-air) |
| Recurring subscriptions card (4th card) | MEDIUM | MEDIUM | **P2** |
| Click-through cards → chat prefill | MEDIUM | LOW | **P2** |
| MCP server + Claude Desktop screenshot | MEDIUM | LOW | **P2** |
| Custom `smb-audit` gbrain skill | HIGH | HIGH | **P2** (stretch only) |
| Knowledge graph visualization | LOW | MEDIUM | **P3** |
| Voice input | MEDIUM | MEDIUM | **P3** |
| Charts/sparklines | LOW | MEDIUM | **P3** |
| Auth / login | LOW (for demo) | HIGH | **P3 / anti-feature** |
| OAuth integrations | LOW (for demo) | HIGH | **anti-feature** |
| OCR / PDF parsing | LOW (for demo) | HIGH | **anti-feature** |

**Priority key:**
- **P1: Must have for the demo to land.** If any P1 is at risk after Phase 2, scope MUST be cut from P2/P3.
- **P2: Should have, dramatically strengthens the pitch.** Built only after all P1 is green.
- **P3: Nice to have, future consideration.** Don't even start unless P1 + P2 are wrapped.
- **anti-feature:** Explicit out-of-scope with documented reasoning — re-adding requires re-justifying against the 7.5h budget.

---

## Competitor Feature Analysis

How adjacent SMB copilots handle each axis, and where QuickBrain's positioning lands.

| Feature | Truewind | Pilot.com / Bench | Ramp / Brex | Our Approach |
|---------|----------|-------------------|-------------|--------------|
| **Onboarding** | Connect QuickBooks + bank feeds + Stripe via OAuth ([Truewind](https://www.truewind.ai/solutions/smb)) | Hand off to a human bookkeeper after a sales call ([Pilot](https://pilot.com/solutions/smb)) | Apply for a corporate card, KYC, days to activate | **60-second form → instant working brain (no integrations, no humans, no waiting).** Faster than any incumbent — explicitly because we're built on synthetic for the demo. The "fast onboarding" promise is *the* differentiation. |
| **Data sources** | QuickBooks, Xero, 100+ bank feeds, Stripe ([Truewind](https://www.truewind.ai/solutions/smb)) | QuickBooks-based | Card transaction stream | **Synthetic for v1 demo;** committed to repo. Markdown-first ingestion via gbrain. Roadmap path to real integrations post-hackathon. |
| **Insights** | Monthly GAAP reports, month-end close ([Truewind aichief](https://aichief.com/ai-business-tools/truewind/)) | Monthly financial statements + tax filing | Spend analytics, category breakdowns, vendor negotiation suggestions ([Ramp blog](https://ramp.com/blog/ai-expense-management)) | **3 insight cards** (top vendors, P&L, anomalies) — pared down. We're not bookkeeping, we're audit-copilot. |
| **Chat / Q&A** | AI copilot for month-end close ([Truewind aichief](https://aichief.com/ai-business-tools/truewind/)) | None — humans only | Limited (Ramp Intelligence — see [Ramp Intelligence](https://ramp.com/intelligence)) | **Plain-English chat is the primary surface.** Hybrid retrieval + citations. The "interrogate your books" angle nobody else nails. |
| **Anomaly detection** | Anomaly flagging via AI copilot | Manual review by bookkeeper | Spend anomaly detection, duplicate receipt block, fraud monitoring ([Ramp blog](https://ramp.com/blog/ai-expense-management)) | **Rule-based for v1**, 3 planted anomalies, gbrain `signal-detector` integration optional. |
| **Multi-tenancy** | Account + multi-entity ([Pilot review](https://www.smbguide.com/review/pilot/)) | Account + dedicated bookkeeper | Full account/team/RBAC | **Single-session demo, no accounts** — anti-feature for v1. |
| **Pricing** | $395-1395+/mo ([Truewind](https://www.truewind.ai/solutions/smb)) | $349/mo+ ([NerdWallet on Pilot](https://www.nerdwallet.com/article/small-business/pilot-bookkeeping)) | Free card; revenue from interchange ([Ramp](https://ramp.com/)) | N/A for demo — pitch is "free for the first month, pay $X/mo after" |
| **Time to first insight** | Days to weeks (after onboarding + first close) | Weeks (humans involved) | Days after card application | **60 seconds.** This is THE pitch. |

**Positioning takeaway for the pitch:** Truewind/Pilot/Bench replace the bookkeeper; Ramp/Brex replace the corporate card. **QuickBrain replaces neither — it sits on top of whatever bookkeeping the SMB owner already has, and lets them *interrogate* it in plain English.** It's the "brain on top of your books" — the gap none of these incumbents fill.

---

## What I'm Confident About vs Less Confident About

### HIGH confidence
- The 14 coffee-shop vendor categories and concrete vendor names (corroborated across Bellwether, Financial Models Lab, Beancount, Toast).
- The 5 anomaly archetypes (corroborated across uSafe, Camonk, Beancount, Renewal Scout, Ramp).
- The ~12 questions SMB owners actually ask (corroborated across Hello Alice, Fyle, Toast, Restaurant CFO, CloudCPA).
- The gbrain skill inventory and which skills apply (sourced directly from the GitHub README).
- The competitive landscape (Truewind/Pilot/Bench/Ramp/Brex/Mercury feature sets all sourced).

### MEDIUM confidence
- Which 3 of the 5 "wow" questions will land hardest with YC judges. The choice (price hike + top vendors + SaaS audit) is my best read, but a different operator might pick "duplicate charges" over "SaaS audit" depending on judge body language.
- The exact hour estimates per feature. I've calibrated them to "experienced TypeScript/Next.js dev who knows gbrain" but the operator's familiarity with gbrain skill internals will swing some estimates by 30-50%.
- Whether gbrain's `enrich` skill auto-wires vendor entities from markdown invoices without tuning. **This is the single biggest research gap and should be validated in Phase 0/1 spike** — if `enrich` doesn't fire on the invoice format we choose, the top-vendors card has to be hand-rolled aggregation, adding ~1h.

### LOW confidence
- Whether `signal-detector` can be coerced into surfacing financial anomalies. I'd plan for "no" and treat any positive result as bonus.
- Whether 150-200 transactions is the right dataset size. Too small = anomalies look thin; too large = ingest exceeds 60s. May need tuning in Phase 1.

---

## Sources

### gbrain platform
- [gbrain GitHub repo (Garry Tan)](https://github.com/garrytan/gbrain) — skill inventory, ingestion recipes, CLI surface

### SMB accounting copilots (competitive landscape)
- [Truewind Solutions for SMBs](https://www.truewind.ai/solutions/smb)
- [Truewind: AI-Powered Bookkeeping (aichief)](https://aichief.com/ai-business-tools/truewind/)
- [Pilot SMB solutions](https://pilot.com/solutions/smb)
- [Pilot.com Review (NerdWallet)](https://www.nerdwallet.com/article/small-business/pilot-bookkeeping)
- [Bench vs. Pilot (Pilot blog)](https://pilot.com/blog/bench-vs-pilot-bookkeeping-service)
- [Ramp AI expense management blog](https://ramp.com/blog/ai-expense-management)
- [Ramp Intelligence overview](https://ramp.com/intelligence)
- [Mercury vs Brex vs Ramp (Fintech Labs)](https://fintechlabs.com/mercury-vs-brex-vs-ramp-2026-which-finance-stack-should-smbs-use/)

### Coffee-shop financial reality
- [Bellwether Coffee Shop Startup Costs](https://bellwethercoffee.com/blog/coffee-shop-startup-costs)
- [Financial Models Lab — Coffee Shop Running Costs](https://financialmodelslab.com/blogs/operating-costs/coffee-shop)
- [BusinessDojo Monthly Coffee Shop Expenses](https://dojobusiness.com/blogs/news/coffee-shop-monthly-expenses)
- [Beancount.io Coffee Shop Bookkeeping Guide](https://beancount.io/blog/2026/01/25/coffee-shop-bookkeeping-complete-financial-guide)
- [Rigits Bookkeeping Essentials for Coffee Shops](https://rigits.com/blog/bookkeeping-essentials-for-coffee-shops/)
- [Coffee Shop Startups bookkeeping tips](https://coffeeshopstartups.com/bookkeeping-tips-for-coffee-shop-owners/)
- [Royal Cup Coffee (vendor example)](https://www.royalcupcoffee.com/)

### SMB pain points & common questions
- [Hello Alice — 6 financial questions every SMB owner should ask](https://helloalice.com/financial-questions-small-business/)
- [Fyle — 14 accounting questions for SMB](https://www.fylehq.com/blog/accounting-questions-for-small-business)
- [Toast Restaurant Accounting Guide](https://pos.toasttab.com/blog/on-the-line/restaurant-accounting-guide)
- [Restaurant CFO Month-End Checklist](https://therestaurantcfo.com/restaurant-month-end-close-accounting-checklist/)
- [CloudCPA Top 100 Restaurant Owner Questions](https://thecloudcpa.net/top-100-questions-restaurant-owners-should-ask-an-accountant/)
- [SYZYGY 5 Questions for SMB Financial Reports](https://www.syzygy.la/blog-2/the-5-questions-small-business-owners-need-to-ask-about-their-financial-reports)

### Anomaly detection & audit red flags
- [uSafe — Common Audit Red Flags](https://usafe-ca.com/2025/05/15/common-audit-red-flags-and-how-to-avoid-them-in-your-business/)
- [Camonk — Forensic Audit Red Flags in P&L](https://blog.camonk.com/top-forensic-audit-red-flags-in-financial-statements-balance-sheet/)

### SaaS subscription creep (anchor for ghost-SaaS anomaly)
- [Beancount.io — SaaS Subscription Management for SMBs](https://beancount.io/blog/2026/03/11/saas-subscription-management-small-business-guide)
- [Renewal Scout — Hidden Cost of Forgotten Subscriptions](https://renewalscout.com/blog/the-hidden-cost-of-forgotten-subscriptions/)
- [Linkenheimer LLP — Subscription Creep](https://www.linkcpa.com/the-great-subscription-creep-how-software-costs-are-quietly-eating-your-budget/)
- [Kiplinger — 30-Minute Subscription Audit](https://www.kiplinger.com/personal-finance/subscription-audit-save-money)
- [BILL — Manage SaaS Subscriptions](https://www.bill.com/blog/manage-saas-subscriptions)

### SaaS onboarding patterns (the "60-second" benchmark)
- [Arcade — Customer Onboarding Best Practices](https://www.arcade.software/post/customer-onboarding-best-practices)
- [Supademo — 10 SaaS Onboarding Flow Examples](https://supademo.com/blog/saas-onboarding-flow-examples)
- [ProductLed — First 7 Minutes of Onboarding](https://productled.com/blog/the-first-7-minutes-of-the-onboarding-user-experience)

---

*Feature research for: SMB ops / accounting copilot (coffee-shop persona, P&L/invoice audit anchor)*
*Researched: 2026-05-16*
*Researcher: GSD project researcher (features dimension)*
