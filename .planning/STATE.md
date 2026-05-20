---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Real-World Foundation
status: completed
stopped_at: Roadmap created, no phases planned yet.
last_updated: "2026-05-20T05:21:27.336Z"
last_activity: 2026-05-20 -- Phase 02 marked complete
progress:
  total_phases: 9
  completed_phases: 2
  total_plans: 5
  completed_plans: 5
  percent: 22
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-19)

**Core value:** A non-technical small-business owner can connect their real business data and get a live, queryable business brain — useful answers about their own books — without ever touching a terminal, persistent across sessions.
**Current focus:** Milestone v2.0 "Real-World Foundation" — Phase 1 (Test Harness + CI) ready to plan.

## Current Position

Phase: 02 — COMPLETE
Plan: —
Status: Phase 02 complete
Last activity: 2026-05-20 -- Phase 02 marked complete

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity (v1.x history):**

- Total plans completed: 21 across 4 phases (6 + 6 + 5 + 4)
- v1.0 wall-clock: ~7.5h hackathon budget

**By Phase (v2.0):**

| Phase | Plans | Status |
|-------|-------|--------|
| 1. Test Harness + CI | TBD | Not started |
| 2. gbrain on Supabase + Asset Storage | TBD | Not started |
| 3. Vercel Deploy + Observability | TBD | Not started |
| 4. Background Jobs | TBD | Not started |
| 5. Auth + Multi-Tenant Isolation | TBD | Not started |
| 6. QuickBooks Online Ingest | TBD | Not started |
| 7. smb-audit Scale Validation | TBD | Not started |
| 8. Hackathon Artifact Removal | TBD | Not started |
| 9. CLAUDE.md + Codebase Hygiene | TBD | Not started |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Active v2.0 highlights:

- gbrain integration: `child_process.spawn` per request with in-process mutex queue; never `gbrain serve --http` (OAuth 2.1 overhead, not needed for CLI shell-out).
- Phase 2 (INFRA): migrate via `gbrain migrate --to supabase` (lossless, 45s, Spike 005 VALIDATED). Three gotchas: plaintext password in `config.json`, direct-vs-pooler split, migrate flips engine config in place.
- Phase 2 (STOR): markdown pages live in Postgres post-migration; only binary assets need Supabase Storage via gbrain's `files` subsystem + `gbrain.yml`. `lib/storage/` shim scope is narrower than originally scoped.
- Phase 5 (AUTH): multi-tenant isolation leans on gbrain's auto-enabled RLS (41/41 tables, confirmed in Spike 005) rather than a custom app-layer scheme. User store goes in Supabase Postgres, not `bun:sqlite` (v2.0 is hosted, not local-demo).
- Phase 5 (AUTH): auth stack = `jose` (HS256, pure Web Crypto) + Resend (transactional email) + Supabase Postgres (user/session/token tables).
- Phase 6 (QBO): `docs/brain-schema.md` (locked in v1.1 Phase 4) is the hard transformer contract. Connector-agnostic types in `lib/connectors/types.ts` from day one (Spike 002a).
- Pre-roadmap: Synthetic data dirs must be under gbrain whitelisted paths (`companies/`, `originals/`, `concepts/`, etc.) — custom dirs silently kill ~70% of graph cross-refs.

### Pending Todos

- **Phase 6 precondition (operator action):** Register an Intuit developer app at developer.intuit.com to obtain `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`. Not yet done — flag before Phase 6 planning begins.
- **Phase 3 precondition (operator action):** Run `vercel link` to associate the repo with the Vercel project before Phase 3 begins.

### Blockers/Concerns

None active. Phase 1 has no operator-credential preconditions — safe to start immediately.

## Deferred Items

| Category | Item | Deferred At |
|----------|------|-------------|
| Connectors | Xero, Wave, FreshBooks — same shape as QBO; ship QBO first | v1.1 / Spike 002 |
| Connectors | Stripe, Gmail/Outlook vendor email, bank (Plaid/Teller) | v2.0 (v2.1+) |
| Insights UI | INSI-07/08/09 — 4th card, severity badges, click-to-prefill | v1.1 scope-out |
| Chat UX | CHAT-07/08/09 — vendor linkification, behind-the-scenes panel, typewriter reveal | v1.1 scope-out |
| Auth | CPA-facing monthly reports (spike 004 outbound-comms candidate) | v2.1 |
| Platform | Billing / Stripe subscriptions, pricing tiers | v2.1 |
| Platform | Landing page, marketing site, privacy policy / TOS | v2.1 |
| Platform | Team / sharing — owner + accountant per brain | v2.1+ |

## Session Continuity

Last session: 2026-05-20 — v2.0 roadmap created; 9 phases defined; REQUIREMENTS.md traceability filled.
Stopped at: Roadmap created, no phases planned yet.
Resume file: None — start fresh with `/gsd:plan-phase 1`.
Resume command: `/gsd:plan-phase 1` — no preconditions for Phase 1.
