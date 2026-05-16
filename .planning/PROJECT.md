# QuickBrain

## What This Is

QuickBrain is a 60-second onboarding shell around [gbrain](https://github.com/garrytan/gbrain) that lets a non-technical small-business owner spin up a working business brain. The demo persona is Mara, who owns a neighborhood coffee shop: she lands on the page, answers two or three questions, and a real gbrain instance is initialized for her business with synthetic invoices, vendor emails, and bank statements pre-ingested. Once it's alive she gets a chat surface with auto-generated insight cards (top vendors, P&L snapshot, anomalies flagged) and can ask things like *"what was weird about March?"* in plain English.

The product is built as a YC hackathon entry for the gbrain "mom-and-pop SMB" prize — it answers the question *"how would a non-technical SMB owner actually get a gbrain?"*

## Core Value

A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. Refined by REQUIREMENTS.md and roadmap. -->

- [ ] Onboarding flow: business-name + business-type form → triggers brain provisioning
- [ ] Per-tenant `gbrain init` driven from the web app (real CLI shell-out, real brain repo on disk)
- [ ] Synthetic coffee-shop dataset (~50–100 invoices/statements/emails) committed to repo with planted anomalies
- [ ] Real `gbrain import` of the synthetic dataset during onboarding, with visible progress
- [ ] Chat surface backed by real `gbrain query` (via `gbrain serve --http` or direct CLI shell-out)
- [ ] Insight cards on the post-onboarding dashboard: top vendors, monthly P&L snapshot, anomalies flagged
- [ ] Demo-readiness: deterministic 60-second flow, reset button, one curated "wow" query that always works
- [ ] Slide-free 3-minute demo script the operator can run from memory

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multi-tenant auth / accounts — single-session demo, no login (would burn hours with zero demo payoff)
- Live Gmail / QuickBooks / Stripe integration — synthetic dataset is faster and more deterministic for the demo
- Mobile responsive design — demo runs on the operator's laptop projector
- Custom gbrain skill authoring beyond what ships out of the box — `smb-audit` skill is a stretch goal, not v1
- Production-grade deployment (auth, billing, isolation, observability) — this is a demo, not a SaaS
- Replacement of QuickBooks or Xero — we're a *brain on top of* an SMB's existing data, not bookkeeping software
- Native mobile apps
- Any feature that breaks the 7.5-hour budget

## Context

**Domain**: SMB ops / accounting copilot. Mom-and-pop shops drown in receipts, vendor emails, and recurring charges. They use QuickBooks but rarely have the time, vocabulary, or tooling to *interrogate* their own data. They want answers, not dashboards.

**Platform — what gbrain actually is** (from https://github.com/garrytan/gbrain):
- Markdown-first, git-tracked "brain repo" with a PGLite/Postgres engine.
- Self-wiring knowledge graph extracted from page writes (zero LLM calls).
- Hybrid search (vectors + keywords + reciprocal rank fusion); intent classification; timeline-based fact tracking.
- **Skills system**: 34 bundled markdown+TypeScript skills (signal-detector, ingestion, enrich, query, minion-orchestrator, etc.).
- **CLI**: `gbrain init`, `gbrain import`, `gbrain query`, `gbrain sync`, `gbrain serve --http`, `gbrain jobs submit`.
- **MCP**: 30+ MCP tools via stdio; HTTP OAuth 2.1 server for Claude Desktop / ChatGPT / Perplexity.
- **Minions**: durable, deterministic background job queue (~$0 token cost).
- Built by gbrain author for personal use (people/companies/notes) — QuickBrain reframes the same engine for SMB books.

**Hackathon framing**:
- This is a YC hackathon project competing for the gbrain SMB prize.
- Judges are looking for *gbrain showcase* + *real SMB pain*. Anything mocked weakens the prize narrative.
- 7.5h hard ceiling, **including demo prep**. That is the dominant constraint of the entire project.

**Operator (the user) context**:
- Solo builder.
- Comfortable with bun/TypeScript/Next.js stack (gbrain ecosystem).
- Has an unrelated startup ("Yaarbal") — IP-overlap risk was reviewed and judged a non-issue for this build.

## Constraints

- **Timeline**: 7.5 hours total, including demo prep — every decision is filtered through this.
- **Tech stack**: gbrain CLI (bun/TypeScript) for the brain layer; Next.js + TypeScript for the web shell. Single repo, local-only runtime.
- **gbrain integration depth**: Real gbrain CLI + MCP, not mocked. The prize requires authentic gbrain showcase; faking the engine kills the narrative.
- **Demo surface**: Minimal web chat with insight cards. No Claude Desktop, no CLI-only, no full dashboard.
- **Data**: Synthetic dataset for the coffee shop persona, pre-baked into the repo. No live email/QuickBooks/Stripe plumbing.
- **Determinism**: Demo must run identically every time — judges don't tolerate flakiness. Reset script must restore state in <10s.
- **Persona**: Single fictional persona ("Mara's Coffee") — no multi-persona branching during the demo.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build for the gbrain SMB prize at YC hackathon | Prize is winnable; gbrain is a strong primitive for SMB ops; no IP conflict with Yaarbal | — Pending |
| Persona = neighborhood coffee shop ("Mara's Coffee") | Emotional resonance with YC judges; easy to plant believable anomalies (price hike on beans, recurring SaaS, double-charged rent) | — Pending |
| Onboarding-flow as the "wow" moment (not anomaly detection, not tax prep) | Demonstrates the *gap* gbrain has today — non-technical onboarding — which is the SMB story the prize asks about | — Pending |
| Demo surface = minimal Next.js chat + insight cards | Looks like a product without burning the 7.5h on UI; chat-only is too plain, full dashboard too greedy | — Pending |
| Real gbrain CLI + MCP integration (not mocked) | Prize requires authentic gbrain showcase; mocked engine kills the narrative | — Pending |
| Synthetic dataset committed to repo (not live ingest) | Deterministic demo; no API plumbing time; planted anomalies under our control | — Pending |
| Single-session demo, no auth or multi-tenancy | Auth is a 2h tax with zero demo payoff; per-tenant brain dirs simulate isolation | — Pending |
| Brand = QuickBrain (matches repo name `quick-brain`) | On-the-nose ("your business, with a brain"); zero time spent on branding | — Pending |
| Custom `smb-audit` gbrain skill = stretch goal, not v1 | Strongest possible prize story but unsafe at 7.5h; ship core path first, skill if time allows | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-16 after initialization*
