---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: Real-World Foundation
status: planning
last_updated: "2026-05-20T03:07:57.701Z"
last_activity: 2026-05-20
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-19)

**Core value:** A non-technical small-business owner can connect their real business data and get a live, queryable business brain — useful answers about their own books — without ever touching a terminal, persistent across sessions.
**Current focus:** Milestone v2.0 "Real-World Foundation" — defining requirements; hackathon-era v1.x artifacts archived to `.planning/archive/v1.x/`.

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-05-20 — Milestone v2.0 started

## Performance Metrics

**Velocity:**

- Total plans completed: 17 across 3 phases (6 + 6 + 5) — v1.0
- Milestone wall-clock: ~7.5h hackathon budget (per PROJECT.md timeline)

**By Phase:**

| Phase | Plans | Status |
|-------|-------|--------|
| 1. Brain Spine + Synthetic Seed | 6/6 | Passed |
| 2. Onboarding Theater + Chat | 6/6 | Passed |
| 3. Insight Cards + Demo Readiness | 5/5 | Passed (DEMO-04 operator-driven) |
| 4. smb-audit gbrain Skill | 4/4 | Complete (2026-05-19) |
| 5. Email Magic-Link Auth + Persistent Tenants | 0/5 | Not started |
| 6. QuickBooks Online Ingest | 0/6 | Not started |

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
- v1.1 pre-roadmap: `FIXTURES_ROOT` hardcoding in `lib/insights/cache.ts` is the highest-severity data bug — every real tenant sees Mara's numbers. Must be fixed inside Phase 4 before skill output can be observed.
- v1.1 pre-roadmap: Auth library choices — `jose` (pure Web Crypto, no native bindings) + `bun:sqlite` (built-in, synchronous, zero ABI risk). Rejecting Auth.js v5 (dns module conflict with App Router Edge) and better-auth (too heavy for one boolean column).
- v1.1 pre-roadmap: QBO transformer and smb-audit skill share `docs/brain-schema.md` as a hard contract. Schema is defined in Phase 4 and binds Phase 6 transformer output.
- v1.1 pre-roadmap: Per-tenant mutex must remain keyed by `brainSlug` (not `userId`) — enforced via branded TypeScript type to prevent silent PGLite lock contention regressions.

### Pending Todos

- **Phase 5 precondition spike (30 min):** verify `jose` + `bun:sqlite` email magic-link round-trip before writing plan-code.
- **Operator follow-up for Phase 4:** spot-check the dashboard (http://localhost:3000/dash/seed) renders ≥4 anomaly rows including a `missing-invoice` row after `bun run seed` + `bun dev`. Automated parts (seed wall-clock, idempotency, typecheck, lint, all 4 anomaly types in the markdown) verified green by 04-03 and 04-04 plans.

### Blockers/Concerns

None active. Tech debt and deferred items are catalogued in `.planning/v1.0-MILESTONE-AUDIT.md`.

## Deferred Items

Carried forward to v2 from v1.1 scope-out:

| Category | Item | Notes |
|----------|------|-------|
| Integration | Stripe + Gmail connectors | Same shape as QBO connector; ship QBO first. |
| Stretch | INSI-07/08/09 | 4th card, severity badges (UI-only after SKIL-05), click-to-prefill |
| Stretch | CHAT-07/08/09 | Vendor linkification, behind-the-scenes panel, typewriter reveal |
| Brain ops | BRAIN-01/02/03 | Incremental sync schedule, multi-realm QBO, account deletion UI |

## Operator Gates (still open at milestone close)

- **DEMO-04** — Operator runs 3 back-to-back demo rehearsals before recording. Procedure documented in `docs/DEMO-SCRIPT.md#rehearsal-playbook`.
- **DEMO-06** — Operator runs `git tag -a demo-final` after rehearsals pass.

## Session Continuity

Last session: 2026-05-19 (Phase 4 executed end-to-end via --auto --chain; 4 plans, 3 waves, all SUMMARY.md files merged to main)
Stopped at: Phase 4 complete; ready to start Phase 5.
Resume file: `.planning/ROADMAP.md` (Phase 5 detail section, starting at line ~106)
Resume command: `/gsd:plan-phase 5` — after running the 30-min Phase 5 spike (jose + bun:sqlite magic-link round-trip).
