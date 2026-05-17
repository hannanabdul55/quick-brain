---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Beyond the Demo
status: planning
last_updated: "2026-05-17T16:50:43.862Z"
last_activity: 2026-05-17
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-16)

**Core value:** A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.
**Current focus:** Milestone v1.0 COMPLETE. Demo running live at http://64.181.231.190:3000.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-17 — Milestone v1.1 started

## Performance Metrics

**Velocity:**

- Total plans completed: 17 across 3 phases (6 + 6 + 5)
- Milestone wall-clock: ~7.5h hackathon budget (per PROJECT.md timeline)

**By Phase:**

| Phase | Plans | Status |
|-------|-------|--------|
| 1. Brain Spine + Synthetic Seed | 6/6 | Passed |
| 2. Onboarding Theater + Chat | 6/6 | Passed |
| 3. Insight Cards + Demo Readiness | 5/5 | Passed (DEMO-04 operator-driven) |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table. Highlights:

- Pre-roadmap: Use `child_process.spawn` per request with in-process mutex queue, NOT `gbrain serve --http` (OAuth 2.1 + PGLite incompatibility blocks the HTTP path at 7.5h).
- Pre-roadmap: Synthetic data MUST sit under gbrain's whitelisted dirs (`companies/`, `originals/`, `media/`, `concepts/`, `people/`) — custom dir names silently kill ~70% of graph cross-refs.
- Pre-roadmap: Pre-bake seed brain once via `scripts/seed.sh`; onboarding is `cp -r brains/seed/ brains/<tenantId>/` plus a 30–45s narrated SSE stream — honest *and* deterministic.
- Pre-roadmap: Hand-rolled SSE via `ReadableStream`. No Vercel AI SDK (gbrain query is single-response, not token-stream — wrong shape).
- Phase 1 retest: Use `gbrain think --model haiku` for synthesis (not `gbrain query`, which is retrieval-only; not default tier `deep`, which uses Opus and hangs minute-scale).
- Phase 2: Wikilinks must use `[[dir/slug]]` form (e.g. `[[companies/beanstalk-roasters]]`) for gbrain's `WIKILINK_RE` to match.
- Phase 3: Insight cards parse static markdown directly (no gbrain spawns) for <200ms loads; locked per CONTEXT.md spec_override.

### Pending Todos

None — milestone v1.0 closed.

### Blockers/Concerns

None active. Tech debt and deferred items are catalogued in `.planning/v1.0-MILESTONE-AUDIT.md`.

## Deferred Items

Carried forward to v1.1 per the milestone audit:

| Category | Item | Notes |
|----------|------|-------|
| Integration | Real QuickBooks Online connector | OAuth 2.0 + Accounting API → markdown ingest. ~12-20h. |
| Integration | Stripe + Gmail connectors | Same shape as QB connector. |
| Stretch | INSI-07/08/09 | 4th card, severity badges, click-to-prefill |
| Stretch | CHAT-07/08/09 | Vendor linkification, behind-the-scenes panel, typewriter reveal |
| Stretch | SKIL-01 | Custom `smb-audit` gbrain skill replacing TS detector |
| Stretch | DATA-12 | 4th planted anomaly (ABCD Plumbing missing-invoice) |

## Operator Gates (still open at milestone close)

- **DEMO-04** — Operator runs 3 back-to-back demo rehearsals before recording. Procedure documented in `docs/DEMO-SCRIPT.md#rehearsal-playbook`.
- **DEMO-06** — Operator runs `git tag -a demo-final` after rehearsals pass.

## Session Continuity

Last session: 2026-05-16 (Phase 1+2+3 shipped; milestone audit passed; repo public; live VM deploy)
Stopped at: Milestone v1.0 close — repo public, README rewrite landed, LICENSE added.
Resume file: `.planning/v1.0-MILESTONE-AUDIT.md`
Resume command: ready for v1.1 planning when judges' feedback arrives.
