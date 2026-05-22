# QuickBrain

## What This Is

QuickBrain is a hosted onboarding shell around [gbrain](https://github.com/garrytan/gbrain) that lets a non-technical small-business owner spin up a working business brain over their own data. The owner signs in with their email, connects their accounting data (QuickBooks Online first), and a real gbrain instance is provisioned for their business with invoices, vendor records, and bank-statement-shaped transactions ingested. Once it's alive they get a chat surface with auto-generated insight cards (top vendors, P&L snapshot, anomalies flagged) and can ask things like *"what was weird about March?"* in plain English.

QuickBrain started as a 7.5-hour YC hackathon entry for the gbrain "mom-and-pop SMB" prize. That phase shipped (v1.0 + v1.1 Phase 4 — see `.planning/archive/v1.x/`). As of 2026-05-19 the project has pivoted from a single-laptop demo to a **real, hosted product for SMB owners running their own books**.

## Core Value

A non-technical small-business owner can connect their real business data and get a live, queryable business brain — useful answers about their own books — without ever touching a terminal, and have it persist across sessions and devices.

## Current Milestone: v2.0 Real-World Foundation

**Goal:** Take QuickBrain from a single-laptop hackathon demo to a hosted multi-tenant product — migrate gbrain off embedded PGLite onto Supabase Postgres, move brain assets to durable object storage, deploy to a real URL on Vercel with error tracking, add email magic-link auth with per-tenant isolation, and ingest live QuickBooks Online data — so a real SMB owner can sign up, connect their books, and use it.

**Target features:**
- Test harness + CI so a regression today doesn't reach a user tomorrow
- gbrain migrated from PGLite to Supabase Postgres (engine swap; pgvector + RLS retained)
- Brain assets (markdown pages + binary files) on durable storage, not local disk
- Deployed to Vercel with Sentry error tracking and health checks — a real URL
- Background-job execution path for gbrain queries that exceed serverless timeouts
- Email magic-link auth with per-tenant brain isolation enforced via gbrain RLS
- QuickBooks Online OAuth + ingest into a per-tenant brain on hosted infra
- `smb-audit` skill validated against real-scale (multi-year, thousands-of-rows) QBO data
- Hackathon-only artifacts removed (panic-reset, synthetic-data generator, demo bypass)

**Free during development** ($0/mo on Vercel Hobby + Supabase free tier). First real paying user triggers ~$20/mo (Vercel Pro — commercial-use license + 60s function timeout).

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] Onboarding flow: business-name + business-type form → triggers brain provisioning *(v1.0, Phase 2)*
- [x] Per-tenant brain provisioning driven from the web app (real gbrain CLI shell-out) *(v1.0, Phase 2)*
- [x] Synthetic coffee-shop dataset committed to repo with planted anomalies *(v1.0, Phase 1)*
- [x] Real `gbrain import` during seed build, with SSE progress during onboarding *(v1.0, Phases 1–2)*
- [x] Chat surface backed by real `gbrain think` (CLI shell-out, no `gbrain serve --http`) *(v1.0, Phase 2)*
- [x] Insight cards: top vendors, monthly P&L snapshot, anomalies flagged *(v1.0, Phase 3)*
- [x] Custom `smb-audit` gbrain skill replaces the hand-rolled TS detector; 4 anomaly types; runs in the seed pipeline *(v1.1, Phase 4)*
- [x] Canonical `docs/brain-schema.md` ingest contract (binds the QBO transformer) *(v1.1, Phase 4)*
- [x] Per-tenant insight isolation — `computeAndCache` resolves `sourceDir` per tenant *(v1.1, Phase 4)*
- [x] Deployed to Vercel — real public URL, secrets in Vercel encrypted config, `/api/health` 3-subsystem probe, Sentry instrumentation *(v2.0, Phase 4)*
- [x] Background-job path for gbrain operations that exceed the serverless timeout — measured-latency threshold, generic Inngest job runner, bounded-poll `JobProgress` UI *(v2.0, Phase 5; deployed-URL smoke test pending — see `05-HUMAN-UAT.md`)*

### Active

<!-- Current scope. Building toward these. Refined by REQUIREMENTS.md and roadmap. -->

- [ ] Automated test suite + CI gate (Vitest + GitHub Actions) covering the v1.x smoke scripts and the migration
- [ ] gbrain migrated to Supabase Postgres — `gbrain migrate --to supabase`, runtime via the Supavisor pooler, no plaintext secret in brain config
- [ ] Brain assets on Supabase Storage (binary files via gbrain's `files` subsystem); markdown pages live in Postgres
- [ ] Email magic-link sign-in with per-user persistent tenants
- [ ] Multi-tenant data isolation — one user's brain cannot be read by another (lean on gbrain RLS)
- [ ] QuickBooks Online OAuth + ingest into a per-tenant hosted brain
- [ ] `smb-audit` validated against real-scale QBO data (multi-year, thousands of rows)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Gmail / Stripe / Square / bank (Plaid) connectors — same shape as the QBO connector; ship QBO first, others land in a later milestone once the markdown-transformer pattern is proven on real infra
- ML-based anomaly detection — the rule-based `smb-audit` skill produces identical user-visible output and is easier to explain
- Charts library — typography + numbers carry the insight cards
- Team / multi-user-per-brain (owner + accountant sharing one brain) — v2.0 is one user, one brain; sharing is a later milestone
- Billing / Stripe subscriptions, pricing, plan tiers — v2.0 ends at "a real user can use it"; monetization is v2.1
- Landing page, marketing site, privacy policy / TOS, in-product help — go-to-market readiness is a v2.1 concern (legal docs become a hard blocker once real QBO data flows — Intuit's developer agreement requires them)
- RBAC, enterprise SSO — revisit when there are teams, not solo owners
- Native mobile apps — web-first; mobile responsive is its own design pass
- Real PDF rendering / OCR — QBO data arrives structured
- Replacement of QuickBooks / Xero — QuickBrain is a brain *on top of* SMB books, not the books themselves
- Self-hosted / multi-region deploy — single-region Vercel + Supabase is sufficient until scale demands otherwise

## Context

**Domain**: SMB ops / accounting copilot. Mom-and-pop shops drown in receipts, vendor emails, and recurring charges. They use QuickBooks but rarely have the time, vocabulary, or tooling to *interrogate* their own data. They want answers, not dashboards.

**Target user (v2.0):** real SMB owners running their own books — coffee shops, plumbers, freelancers. They sign up, connect their accounts, and get ongoing insight. Not accountants (a high-leverage adjacent persona surfaced in spike 004, deferred), not internal-tool users.

**Platform — what gbrain is** (from https://github.com/garrytan/gbrain):
- Markdown-first, git-tracked "brain repo" with a swappable engine — **PGLite** (embedded WASM Postgres, the v1.x default) or **PostgresEngine** (Supabase). `gbrain migrate --to <engine>` moves between them losslessly.
- Self-wiring knowledge graph extracted from page writes; hybrid search (vectors + keywords + RRF); timeline-based fact tracking.
- Skills system (markdown + TypeScript); Minions durable background job queue; auto-enabled row-level security on all tables.
- CLI-first: `gbrain init`, `import`, `query`, `migrate`, `jobs submit`, `files`.

**Deploy stack (v2.0, locked):** Vercel (Next.js app) + Supabase (Postgres for gbrain) + Supabase Storage (brain assets). Validated by spike 005 — `gbrain migrate --to supabase` works losslessly on the Supabase free tier.

**Operator (the user) context**:
- Solo builder. Comfortable with the bun / TypeScript / Next.js stack.
- Has an unrelated startup ("Yaarbal") — IP-overlap reviewed, non-issue.
- Has existing Vercel + Supabase accounts.

**History:** v1.0 (Phases 1-3) shipped the hackathon demo; v1.1 Phase 4 shipped the `smb-audit` skill. v1.1 Phases 5-6 (auth, QBO) were *planned but never executed* under hackathon assumptions — their plans + research are archived in `.planning/archive/v1.x/` and inform v2.0's re-scoped phases. See also `.planning/v1.0-MILESTONE-AUDIT.md` and `.planning/spikes/`.

## Constraints

- **Tech stack**: gbrain CLI (bun/TypeScript) for the brain layer; Next.js 15 App Router + TypeScript for the web shell. Single repo.
- **Deploy stack**: Vercel + Supabase + Supabase Storage. No second cloud vendor without strong cause.
- **Cost discipline**: development stays on free tiers ($0/mo). The only sanctioned recurring cost before real users is none; the first real user triggers ~$20/mo Vercel Pro. Surface any decision that would add recurring cost.
- **gbrain integration depth**: real gbrain CLI, not mocked — the engine is the product's substance.
- **Serverless timeout**: Vercel functions cap at 10s (Hobby) / 60s (Pro). gbrain queries can exceed this — long work must move to background jobs or stream.
- **Multi-tenant safety**: one tenant's data must never be reachable by another. This is a hard correctness bar, not a nicety.
- **No hackathon shortcuts**: decisions that compromise real-user data integrity, security, or compliance are blockers even when expedient.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build for the gbrain SMB prize at YC hackathon | Prize winnable; gbrain strong primitive for SMB ops | Shipped (v1.0 + v1.1 P4) |
| Persona = neighborhood coffee shop ("Mara's Coffee") | Emotional resonance; easy to plant believable anomalies | Shipped |
| Real gbrain CLI integration (not mocked) | The engine is the product's substance | Validated |
| `smb-audit` as a real gbrain skill (v1.1 Phase 4) | Validates gbrain skill-authoring before connector work | Shipped 2026-05-19 |
| **Pivot from hackathon demo to real-world product (2026-05-19)** | Hackathon ended; the demo proved the concept — now make it usable by real SMB owners | — Active (v2.0) |
| **Target user = real SMB owners running their own books** | The original persona, but actual customers; not accountants, not internal use | — Active (v2.0) |
| **Deploy stack = Vercel + Supabase + Supabase Storage** | gbrain has first-class `--supabase` support; user has both accounts; lowest-friction Next.js host | — Active (v2.0) |
| **gbrain on Supabase Postgres, not PGLite** | PGLite is single-laptop; Postgres unlocks concurrency, backups, hosted multi-tenant. Spike 005 confirmed lossless migration on the free tier | — Active (v2.0) |
| **v2.0 phase numbering reset to Phase 1** | Major version bump + full re-scope; v2.0 phases supersede v1.1 Phases 5-6, so continuing at Phase 7 would be confusing | — Active (v2.0) |
| Defer billing, landing page, legal docs to v2.1 | v2.0's bar is "a real user can use it"; monetization + go-to-market is a separate milestone | — Active (v2.0) |

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
*Last updated: 2026-05-22 — Phase 5 (Background Jobs) complete: measured-latency threshold doc, generic Inngest job runner (trigger + status routes), Supabase `app.jobs` store, bounded-poll `JobProgress` UI. Code verified 4/4 and code-review-clean; deployed-URL end-to-end smoke test pending (see `05-HUMAN-UAT.md`). Phase 4 (Vercel Deploy + Observability) complete; app live at quickbrain-brown.vercel.app.*
