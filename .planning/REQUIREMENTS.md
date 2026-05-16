# Requirements: QuickBrain

**Defined:** 2026-05-16
**Core Value:** A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.

---

## v1 Requirements

Requirements for the hackathon demo. Every requirement maps to exactly one roadmap phase. All requirements are scoped to the 7.5-hour hackathon ceiling; anything that doesn't fit lives in v2 or Out of Scope.

### Brain Harness (HARN)

The plumbing that lets Next.js talk to the real `gbrain` CLI safely.

- [ ] **HARN-01**: Operator can install `gbrain` from a pinned git SHA via `git clone + bun install && bun link` (the `bun install -g` path is documented as broken in the README).
- [ ] **HARN-02**: A `scripts/demo-check.sh` exits non-zero if `gbrain --version`, `gbrain doctor --fast`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or write-access to `./brains/` is missing.
- [ ] **HARN-03**: `lib/gbrain/client.ts` exposes a `spawnGBrain(args, opts)` helper that spawns the `gbrain` CLI with `GBRAIN_HOME=./brains/<tenantId>/` and inherits `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` from the parent process env.
- [ ] **HARN-04**: Every `spawnGBrain(...)` call is routed through an in-process Promise mutex queue keyed by tenant ID, so concurrent requests against the same brain serialize at the application layer (resolves PGLite exclusive-lock contention).
- [ ] **HARN-05**: `lib/gbrain/tenants.ts` maintains an in-memory `Map<tenantId, TenantRecord>` that is rebuilt from `./brains/*` on Next.js boot (no separate database).
- [ ] **HARN-06**: Form input that becomes part of a `GBRAIN_HOME` path is validated by zod with a strict slug regex; no shell-special characters can flow into a spawn.

### Synthetic Data (DATA)

The fictional Mara's Coffee dataset that makes the demo land.

- [ ] **DATA-01**: All synthetic data lives under gbrain's whitelisted directory names exclusively: `companies/`, `people/`, `originals/`, `media/`, `concepts/`. No custom directory names (would silently break graph cross-linking per gbrain issue #424).
- [ ] **DATA-02**: At least 5 vendor company pages exist in `companies/` covering the 4 anomaly-anchoring vendors (`beanstalk-roasters`, `square-pos`, `seven-shifts`, `landlord-llc`) plus one additional supplier.
- [ ] **DATA-03**: Every invoice, vendor-email, and bank-statement page lives in `originals/`, has a `type:` frontmatter value (`invoice` / `vendor-email` / `bank-statement` / `monthly-close`), a "Compiled truth:" prose section above the `---` divider, and at least one `[[wikilink]]` to its anchor `companies/` vendor.
- [ ] **DATA-04**: The dataset contains 3 months (Jan–Mar 2026) of monthly close pages, bank statements, and ≥2 invoices per vendor per month for the 5 core vendors.
- [ ] **DATA-05**: Planted anomaly #1 (Beanstalk price hike +22% in March) is detectable via month-over-month invoice-total delta against `companies/beanstalk-roasters.md`.
- [ ] **DATA-06**: Planted anomaly #2 (duplicate Square POS charge — $79 on Mar 4 and Mar 11) appears in `originals/bank-statement-2026-03.md` and is also surfaced by `originals/email-square-receipt-2026-03-11.md`.
- [ ] **DATA-07**: Planted anomaly #3 (ghost 7shifts SaaS — $29/mo recurring, last vendor-event >90 days ago) appears in 6+ months of bank statements with no recent event on `companies/seven-shifts.md`.
- [ ] **DATA-08**: A hand-rolled TypeScript anomaly detector reads the imported brain and writes its findings to `concepts/march-anomaly-summary.md` and `concepts/recurring-charges.md` as queryable markdown pages.
- [ ] **DATA-09**: `scripts/seed.sh` runs end-to-end in a fresh shell and produces a working `brains/seed/` containing `gbrain init` defaults, model config set to `sonnet`, the imported synthetic data, completed embeddings, and the anomaly-detection concept pages.
- [ ] **DATA-10**: A smoke gate passes before Phase 1 is declared done: `gbrain graph-query beanstalk-roasters --depth 2` returns ≥3 neighbors, `gbrain orphans` returns a short list, and `gbrain query "what was weird about last month?"` names all 3 planted anomalies in one response.
- [ ] **DATA-11**: The committed `brains/seed/` tarball (or directory) is reproducible from `scripts/seed.sh` and is the artifact that onboarding clones from.

### Onboarding (ONBD)

The 60-second "spin up your brain" theater.

- [ ] **ONBD-01**: A user can land on `/` and see a "Start your business brain" call-to-action that requires no login.
- [ ] **ONBD-02**: A user can click the CTA and reach a form at `/onboard` that asks at most three fields (business name, business type, owner name).
- [ ] **ONBD-03**: Submitting the onboarding form POSTs to `/api/tenants`, which validates input via zod, creates the tenant by `cp -r brains/seed/ brains/<tenantId>/`, registers the tenant in the in-memory `Map`, and returns the tenant ID — all in under 2 seconds wall-clock.
- [ ] **ONBD-04**: After submit, the browser opens an `EventSource` to `/api/tenants/<id>/onboard` (SSE) and renders a 30–45 second narrated progress sequence with 5 honest stage labels: "Creating your brain → Reading your invoices and emails → Building the knowledge graph → Indexing for search → Ready."
- [ ] **ONBD-05**: During the onboarding stream, the backend interleaves at least one real `gbrain query` warm-up call so the stream is not pure theater — the brain is actually exercised before the dashboard loads.
- [ ] **ONBD-06**: When the SSE stream ends, the browser is redirected to `/dash/<tenantId>` automatically.
- [ ] **ONBD-07**: Total time from form submit to dashboard interactivity is consistently between 30 and 60 seconds (3 consecutive measurements on the demo laptop required).
- [ ] **ONBD-08**: No screen during onboarding asks for an API key, sign-up, or payment.

### Chat (CHAT)

The plain-English Q&A surface.

- [ ] **CHAT-01**: The dashboard at `/dash/<tenantId>` renders a chat surface with shadcn input + send button + message list + scroll-area.
- [ ] **CHAT-02**: Sending a message POSTs to `/api/tenants/<id>/chat` (SSE), which spawns `gbrain query` through the mutex queue, streams a single SSE event carrying the full markdown response, and closes the stream.
- [ ] **CHAT-03**: Responses render through `react-markdown + remark-gfm` so gbrain's `[Source: ...]` citations are visible inline.
- [ ] **CHAT-04**: Three hardcoded suggested-question chips appear above the input on first load: "What was weird about last month?", "Who are my top 5 vendors and how much did I pay each?", "What am I paying for every month that I shouldn't be?". Clicking a chip submits that question.
- [ ] **CHAT-05**: The system prompt instructs gbrain to say "I don't have data on that" rather than guess when the brain has no relevant pages.
- [ ] **CHAT-06**: A query that exceeds 30 seconds is aborted and shows a graceful error message in the chat ("That one's running slow — try again or pick a suggested question").

### Insight Cards (INSI)

The dashboard-load proof-of-value cards.

- [ ] **INSI-01**: On dashboard mount, the page fires 3 canned `gbrain query` calls in parallel through the mutex queue and renders the results into three insight cards.
- [ ] **INSI-02**: Card "Top 5 vendors this quarter" lists vendor names with dollar totals and shows the label "from graph" beneath the card title.
- [ ] **INSI-03**: Card "Monthly P&L snapshot" shows revenue / COGS / opex / net for the most recent month with a delta vs. prior month and the label "from timeline" beneath the card title.
- [ ] **INSI-04**: Card "Anomalies flagged" shows 3 anomaly items (Beanstalk price hike, Square duplicate, ghost 7shifts), each with a plain-English description, a dollar-impact figure, a "View source →" link to the originating page, and the label "from skill: recurring-charges" beneath the card title.
- [ ] **INSI-05**: Each card distinguishes three visible states: loading (skeleton), data (populated), and error (named error with a Retry button). No silent empty states.
- [ ] **INSI-06**: Insight queries are cached in-process per tenant after first computation; the dashboard does not re-spawn `gbrain query` on every render.

### Demo Readiness (DEMO)

The safety net and the polish that makes the demo land.

- [ ] **DEMO-01**: The dashboard has a "Reset" button that, when held for 2 seconds (or confirmed), kills any in-flight spawn for the tenant, deletes the tenant brain dir, re-copies `brains/seed/`, clears in-memory caches, and reloads the dashboard. Completes in under 10 seconds.
- [ ] **DEMO-02**: `scripts/panic-reset.sh` resets the entire demo state (all tenants, caches, ports) from the terminal in under 15 seconds without rebuilding the seed.
- [ ] **DEMO-03**: At Next.js boot, each of the 3 P0 chat questions is run once against `brains/seed/` to pre-warm the OS page cache and PGLite buffer pool.
- [ ] **DEMO-04**: The operator can run the full 3-minute demo (onboarding → dashboard → 1 chat question → reset → repeat) at least 3 times back-to-back on the demo laptop with no errors and identical anomaly findings each time.
- [ ] **DEMO-05**: A `docs/DEMO-SCRIPT.md` exists, documenting the 3-minute spoken script, and the script names "graph" / "timeline" / "skill" out loud at least 3 times each (per prize-narrative checklist).
- [ ] **DEMO-06**: A `git tag demo-final` is created when the build is frozen for the demo, with a README pointer for "if everything breaks, `git checkout demo-final && bun install && scripts/panic-reset.sh && bun dev`."

---

## v2 Requirements

Deferred. Tracked but explicitly not in the v1 roadmap.

### Stretch — Custom gbrain skill (SKIL)

- **SKIL-01**: A custom gbrain skill `smb-audit` (markdown + TypeScript) replaces the hand-rolled anomaly detector, runs as a gbrain minion at import time, and writes the same `concepts/` pages.

### Stretch — Extra anomalies (DATA)

- **DATA-12**: A 4th planted anomaly (missing invoice — $340 bank-statement debit to "ABCD Plumbing" with no matching invoice page) is detectable by a "bank-debit-without-invoice" rule.

### Stretch — Chat polish (CHAT)

- **CHAT-07**: Vendor names in chat answers are inline-linked to their `companies/` pages and clicking opens a side panel showing the raw page.
- **CHAT-08**: Each chat response has a "Behind the scenes" expandable that shows the gbrain query payload, which pages were cited, and which graph edges were traversed.
- **CHAT-09**: Chat responses use a client-side typewriter visual (no backend change) that types the response at ~20 chars/interval for theatrical effect.

### Stretch — Extra insight cards (INSI)

- **INSI-07**: A 4th insight card "Recurring subscriptions" lists every monthly recurring charge with last-used-on and cancel-likely flags.
- **INSI-08**: Anomaly card items carry severity badges (red/yellow/grey) based on a configurable threshold.
- **INSI-09**: Clicking an insight card prefills the chat with a relevant follow-up question.

---

## Out of Scope

Explicit exclusions. Each has a reason documented to prevent re-adding under hackathon panic.

| Feature | Reason |
|---|---|
| Multi-tenant authentication / accounts / login | Burns 2+ hours for zero demo payoff; the demo is single-session, single-laptop. |
| Live Gmail / QuickBooks / Stripe / Square integration | Synthetic dataset is deterministic and demo-safe; live ingest is fragile under conference Wi-Fi. |
| OAuth 2.1 / `gbrain serve --http` integration | Bootstrap-token + admin-dashboard client registration is multi-hour and PGLite-incompatible (DEPLOY.md). |
| Vercel AI SDK | `gbrain query` is single-response, not a token stream — the SDK is the wrong shape and would cost more time than it saves. |
| Custom MCP client / stdio framing | The CLI path is simpler and more debuggable in 7.5h. |
| Multi-persona branching during demo | One persona (Mara's Coffee) — keeps the synthetic dataset tractable. |
| Mobile responsive design | The demo runs on the operator's laptop projector. |
| Production deployment (auth, billing, isolation, observability) | This is a demo, not a SaaS. |
| Replacement of QuickBooks or Xero | QuickBrain is a brain on top of existing SMB data, not bookkeeping software. |
| Native mobile apps | Web-first. |
| Real PDF rendering / OCR | All synthetic data is markdown; PDF UX is an anti-feature for the 7.5h scope. |
| Charts library (recharts, visx, chart.js, etc.) | Insight cards use typography + numbers; charts cost time without changing the prize narrative. |
| ML-based anomaly detection | Rule-based is faster to ship, easier to demo, and produces identical visible output. |
| Item-level POS data (per-drink itemization) | Daily POS summaries in `media/` are sufficient for the P&L card. |
| Backups / disaster recovery | Pre-baked seed brain + reset script is the only persistence we need. |
| User onboarding analytics / telemetry | No production users; not relevant. |
| Tests beyond the smoke gate | Smoke gate in DATA-10 + 3-rehearsal pass in DEMO-04 are the only verification. Anything else is time we don't have. |
| Any feature that breaks the 7.5h budget | Filter every late-stage decision through this. |

---

## Traceability

Empty initially. Populated by the roadmapper in the next step.

| Requirement | Phase | Status |
|---|---|---|
| HARN-01 | Phase ? | Pending |
| HARN-02 | Phase ? | Pending |
| HARN-03 | Phase ? | Pending |
| HARN-04 | Phase ? | Pending |
| HARN-05 | Phase ? | Pending |
| HARN-06 | Phase ? | Pending |
| DATA-01 | Phase ? | Pending |
| DATA-02 | Phase ? | Pending |
| DATA-03 | Phase ? | Pending |
| DATA-04 | Phase ? | Pending |
| DATA-05 | Phase ? | Pending |
| DATA-06 | Phase ? | Pending |
| DATA-07 | Phase ? | Pending |
| DATA-08 | Phase ? | Pending |
| DATA-09 | Phase ? | Pending |
| DATA-10 | Phase ? | Pending |
| DATA-11 | Phase ? | Pending |
| ONBD-01 | Phase ? | Pending |
| ONBD-02 | Phase ? | Pending |
| ONBD-03 | Phase ? | Pending |
| ONBD-04 | Phase ? | Pending |
| ONBD-05 | Phase ? | Pending |
| ONBD-06 | Phase ? | Pending |
| ONBD-07 | Phase ? | Pending |
| ONBD-08 | Phase ? | Pending |
| CHAT-01 | Phase ? | Pending |
| CHAT-02 | Phase ? | Pending |
| CHAT-03 | Phase ? | Pending |
| CHAT-04 | Phase ? | Pending |
| CHAT-05 | Phase ? | Pending |
| CHAT-06 | Phase ? | Pending |
| INSI-01 | Phase ? | Pending |
| INSI-02 | Phase ? | Pending |
| INSI-03 | Phase ? | Pending |
| INSI-04 | Phase ? | Pending |
| INSI-05 | Phase ? | Pending |
| INSI-06 | Phase ? | Pending |
| DEMO-01 | Phase ? | Pending |
| DEMO-02 | Phase ? | Pending |
| DEMO-03 | Phase ? | Pending |
| DEMO-04 | Phase ? | Pending |
| DEMO-05 | Phase ? | Pending |
| DEMO-06 | Phase ? | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 42 ⚠️ (to be resolved by `/gsd:roadmap`)

---

*Requirements defined: 2026-05-16*
*Last updated: 2026-05-16 after initial definition*
