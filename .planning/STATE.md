# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-16)

**Core value:** A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.
**Current focus:** Phase 1 — Brain Spine + Synthetic Seed

## Current Position

Phase: 1 of 3 (Brain Spine + Synthetic Seed)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-05-16 — Roadmap created (3 phases, 42 v1 requirements mapped, coarse granularity)

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1. Brain Spine + Synthetic Seed | 0/TBD | — | — |
| 2. Onboarding Theater + Chat | 0/TBD | — | — |
| 3. Insight Cards + Demo Readiness | 0/TBD | — | — |

**Recent Trend:**
- Last 5 plans: (none yet)
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Pre-roadmap (research): Use `child_process.spawn` per request with in-process mutex queue, NOT `gbrain serve --http` (OAuth 2.1 + PGLite incompatibility blocks the HTTP path at 7.5h).
- Pre-roadmap (research): Synthetic data MUST sit under gbrain's whitelisted dirs (`companies/`, `originals/`, `media/`, `concepts/`, `people/`) — custom dir names silently kill ~70% of graph cross-refs.
- Pre-roadmap (research): Pre-bake seed brain once via `scripts/seed.sh`; onboarding is `cp -r brains/seed/ brains/<tenantId>/` plus a 30–45s narrated SSE stream — honest *and* deterministic.
- Pre-roadmap (research): Hand-rolled SSE via `ReadableStream`. No Vercel AI SDK (gbrain query is single-response, not token-stream — wrong shape).
- Pre-roadmap (research): Custom `smb-audit` skill is STRETCH ONLY — hand-rolled TS anomaly rules produce identical UI output in less time.

### Pending Todos

None yet.

### Blockers/Concerns

None yet. Phase 1 doubles as critical-path spike — if `gbrain graph-query`, `gbrain orphans`, or the "what was weird" smoke gate fails, replan before any UI work.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-16 (roadmap creation)
Stopped at: ROADMAP.md + STATE.md + REQUIREMENTS.md traceability written
Resume file: None
