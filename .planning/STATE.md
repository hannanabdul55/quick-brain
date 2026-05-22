---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Real-World Foundation
status: ready_to_plan
stopped_at: Phase 05 complete (5/5) — ready to discuss Phase 6
last_updated: 2026-05-22T03:41:52.298Z
last_activity: 2026-05-22 -- Phase 05 execution started
progress:
  total_phases: 10
  completed_phases: 4
  total_plans: 16
  completed_plans: 16
  percent: 40
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-21)

**Core value:** A non-technical small-business owner can connect their real business data and get a live, queryable business brain — useful answers about their own books — without ever touching a terminal, persistent across sessions.
**Current focus:** Phase 6 — auth + multi tenant isolation

## Current Position

Phase: 6
Plan: Not started
Status: Ready to plan
Last activity: 2026-05-22

Progress: [████░░░░░░] 40% — 4 of 10 phases

## Performance Metrics

**Velocity (v1.x history):**

- Total plans completed: 29 across 4 phases (6 + 6 + 5 + 4)
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
| Phase 04 P03 | 45 | 6 tasks | 3 files |

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
- [Phase ?]: Bun runtime bun@1.2.0 required for Vercel functions loading gbrain raw .ts
- [Phase ?]: Hobby→Pro upgrade trigger: first commercial user (commercial use prohibited on Hobby), NOT a function timeout (300s default all plans)
- [Phase ?]: Secrets blocker: Vercel Production env config has no variables despite user confirming secrets loaded — gbrainDb probe fails on deployed URL

### Pending Todos

- **Phase 7 precondition (operator action):** Register an Intuit developer app at developer.intuit.com to obtain `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`. Not yet done — flag before Phase 7 planning begins.
- **Phase 6 precondition (operator action):** `RESEND_API_KEY` + a verified Resend domain for the auth email flow.
- **Phase 4 precondition:** `vercel link` — DONE (project `quickbrain`). Phase 4 must add `gbrain` to `serverExternalPackages` in `next.config.ts` so webpack does not bundle gbrain's raw TS into the server build.

### Blockers/Concerns

active. Phase 4 (Vercel Deploy) precondition `vercel link` is done. Carried-forward gap: gbrain has no `serverExternalPackages` entry yet — Phase 4 concern.

- Vercel Production env config is empty — all 13 app secrets must be added. /api/health returns 503 (gbrainDb down) and chat fails until secrets are loaded.

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

Last session: 2026-05-22T01:40:41.242Z
Stopped at: Phase 5 UI-SPEC approved
Resume file: .planning/phases/05-background-jobs/05-UI-SPEC.md
Resume command: `/gsd:plan-phase 4` — `vercel link` precondition done; the plan must externalize gbrain for the Next.js server build.
