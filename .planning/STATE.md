---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Real-World Foundation
status: executing
stopped_at: Phase 3 complete (3/3 plans). Phase 4 (Vercel Deploy) not started.
last_updated: "2026-05-20T08:46:55.092Z"
last_activity: 2026-05-20 -- Phase 4 planning complete
progress:
  total_phases: 10
  completed_phases: 3
  total_plans: 11
  completed_plans: 8
  percent: 30
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-19)

**Core value:** A non-technical small-business owner can connect their real business data and get a live, queryable business brain — useful answers about their own books — without ever touching a terminal, persistent across sessions.
**Current focus:** Milestone v2.0 "Real-World Foundation" — Phases 1-3 shipped; Phase 4 (Vercel Deploy + Observability) next.

## Current Position

Phase: 4 of 10 — Vercel Deploy + Observability (not started)
Plan: —
Status: Ready to execute
Last activity: 2026-05-20 -- Phase 4 planning complete

Progress: [███░░░░░░░] 30% — 3 of 10 phases

## Performance Metrics

**Velocity (v1.x history):**

- Total plans completed: 21 across 4 phases (6 + 6 + 5 + 4)
- v1.0 wall-clock: ~7.5h hackathon budget

**By Phase (v2.0):**

| Phase | Plans | Status |
|-------|-------|--------|
| 1. Test Harness + CI | 3/3 | Complete (2026-05-20) |
| 2. gbrain on Supabase + Asset Storage | 2/2 | Complete (2026-05-20) |
| 3. In-Process gbrain Refactor | 3/3 | Complete (2026-05-20) |
| 4. Vercel Deploy + Observability | TBD | Not started |
| 5. Background Jobs | TBD | Not started |
| 6. Auth + Multi-Tenant Isolation | TBD | Not started |
| 7. QuickBooks Online Ingest | TBD | Not started |
| 8. smb-audit Scale Validation | TBD | Not started |
| 9. Hackathon Artifact Removal | TBD | Not started |
| 10. CLAUDE.md + Codebase Hygiene | TBD | Not started |

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

- **Phase 7 precondition (operator action):** Register an Intuit developer app at developer.intuit.com to obtain `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`. Not yet done — flag before Phase 7 planning begins.
- **Phase 6 precondition (operator action):** `RESEND_API_KEY` + a verified Resend domain for the auth email flow.
- **Phase 4 precondition:** `vercel link` — DONE (project `quickbrain`). Phase 4 must add `gbrain` to `serverExternalPackages` in `next.config.ts` so webpack does not bundle gbrain's raw TS into the server build.

### Blockers/Concerns

None active. Phase 4 (Vercel Deploy) precondition `vercel link` is done. Carried-forward gap: gbrain has no `serverExternalPackages` entry yet — Phase 4 concern.

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

Last session: 2026-05-20 — Phase 3 (In-Process gbrain Refactor) executed end-to-end; in-process query (25 results) and think (1873-char synthesis) verified live against the Supabase brain.
Stopped at: Phase 3 complete (3/3 plans). Phase 4 (Vercel Deploy) not started.
Resume file: None.
Resume command: `/gsd:plan-phase 4` — `vercel link` precondition done; the plan must externalize gbrain for the Next.js server build.
