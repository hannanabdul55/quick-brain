# QuickBrain

## What This Is

QuickBrain is a 60-second onboarding shell around [gbrain](https://github.com/garrytan/gbrain) that lets a non-technical small-business owner spin up a working business brain. The demo persona is Mara, who owns a neighborhood coffee shop: she lands on the page, answers two or three questions, and a real gbrain instance is initialized for her business with synthetic invoices, vendor emails, and bank statements pre-ingested. Once it's alive she gets a chat surface with auto-generated insight cards (top vendors, P&L snapshot, anomalies flagged) and can ask things like *"what was weird about March?"* in plain English.

The product is built as a YC hackathon entry for the gbrain "mom-and-pop SMB" prize — it answers the question *"how would a non-technical SMB owner actually get a gbrain?"*

## Core Value

A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.

## Current Milestone: v1.1 Beyond the Demo

**Goal:** Move QuickBrain from a single-persona hackathon demo to a real-data SMB onboarding tool — replace the hand-rolled TS detector with a real gbrain skill, support persistent multi-tenant accounts via email magic-link auth, and ingest live QuickBooks Online data so a small business owner can answer questions over their own books.

**Target features:**
- Custom `smb-audit` gbrain skill (markdown + TypeScript) that runs as a gbrain minion at import time and writes the same `concepts/` anomaly pages — closing the hackathon's biggest deferred stretch (SKIL-01)
- Email magic-link sign-in with persistent per-user tenants (PGLite-backed; no Postgres for the app layer)
- QuickBooks Online OAuth 2.0 + Accounting API → markdown ingest pipeline that drops invoices, bills, and bank-statement-shaped transactions into a fresh per-tenant brain dir
- Production-shaped wiring: encrypted OAuth token storage, structured error states across the onboarding stream, panic-reset that survives real-tenant rebuild

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Onboarding flow: business-name + business-type form → triggers brain provisioning *(v1.0, Phase 2)*
- [x] Per-tenant `gbrain init`-equivalent driven from the web app (`cp -r brains/seed/` strategy + real CLI shell-out) *(v1.0, Phase 2)*
- [x] Synthetic coffee-shop dataset (~46 invoices/statements/emails) committed to repo with 3 planted anomalies *(v1.0, Phase 1)*
- [x] Real `gbrain import` of the synthetic dataset during seed build, with visible SSE progress during onboarding *(v1.0, Phases 1–2)*
- [x] Chat surface backed by real `gbrain think --model haiku` (CLI shell-out, no `gbrain serve --http`) *(v1.0, Phase 2)*
- [x] Insight cards on the post-onboarding dashboard: top vendors, monthly P&L snapshot, anomalies flagged *(v1.0, Phase 3)*
- [x] Demo-readiness: deterministic 60-second flow, reset button, three curated "wow" queries that always work *(v1.0, Phase 3)*
- [x] Slide-free 3-minute demo script the operator can run from memory *(v1.0, Phase 3)*

### Active

<!-- Current scope. Building toward these. Refined by REQUIREMENTS.md and roadmap. -->

- [ ] Custom `smb-audit` gbrain skill replaces the hand-rolled TS anomaly detector and ships as part of the seed pipeline
- [ ] Email magic-link sign-in (no password) with rate-limited send and short-lived signed link tokens
- [ ] Persistent users + tenants: a logged-in user always lands on their own brain across sessions
- [ ] QuickBooks Online OAuth flow with token refresh and per-tenant encrypted token storage
- [ ] QBO Accounting API → markdown transformer producing `originals/` and `companies/` pages compatible with the existing seed schema
- [ ] Live-data onboarding alternative: after sign-in, user can choose "Connect QuickBooks" instead of (or in addition to) the demo seed

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Gmail / Stripe / Square live ingestion — same shape as QBO connector; ship QBO first, others land in a future milestone once the markdown-transformer pattern is proven
- ML-based anomaly detection — the rule-based `smb-audit` skill produces identical user-visible output and is easier to demo and explain
- Charts library (recharts, visx, chart.js) — typography + numbers carry the insight cards; charts are still time we don't need to spend
- Multi-persona branching from a single account — one user, one tenant, one brain in v1.1
- Mobile responsive design — desktop-first; mobile is its own design pass
- Custom MCP client / `gbrain serve --http` integration — the CLI shell-out path is simpler and proven; revisit only if external MCP-aware tools need to connect to a user's brain
- Replacement of QuickBooks / Xero — QuickBrain is a brain *on top of* SMB books, not the books themselves
- Native mobile apps — web-first
- Real PDF rendering / OCR — QBO data arrives structured; OCR is a separate workstream
- Production billing, RBAC, enterprise SSO — out of scope for v1.1; revisit when there are paying users
- Backups / disaster recovery beyond panic-reset — per-tenant brain dirs are reproducible from the QBO sync

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
| Custom `smb-audit` gbrain skill = stretch goal, not v1 | Strongest possible prize story but unsafe at 7.5h; ship core path first, skill if time allows | Deferred to v1.1 |
| Promote `smb-audit` skill to v1.1 Phase 4 | Hackathon shipped; modest scope, validates gbrain skill authoring path before any data-connector work | — Pending |
| Email magic-link auth (no password) for v1.1 multi-tenant support | Required to attach QBO tokens to a stable user identity; cheapest auth that survives across sessions; no compliance burden vs SSO/OIDC | — Pending |
| QuickBooks Online as the first live connector | Dominant SMB accounting tool; well-documented OAuth 2.0 + Accounting API; same target-schema shape as the synthetic seed (invoices/bills/bank lines → markdown) | — Pending |
| Continue using PGLite + brain-dir-per-tenant for persistence | App-layer user/tenant state can live alongside gbrain's PGLite without a second database; matches v1.0's "no extra DB" pattern | — Pending |

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
*Last updated: 2026-05-17 — milestone v1.1 "Beyond the Demo" initialized*
