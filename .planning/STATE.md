# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-16)

**Core value:** A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.
**Current focus:** Phase 1 — Brain Spine + Synthetic Seed

## Current Position

Phase: 1 of 3 (Brain Spine + Synthetic Seed)
Plan: 0 of 6 plans executed
Status: PAUSED — blocked on API keys before execute
Last activity: 2026-05-16 — Smart discuss + planner done (6 plans, 5 waves, 17/17 reqs); halted before execute pending OPENAI_API_KEY + ANTHROPIC_API_KEY

Progress: [██░░░░░░░░] 20% (discuss + plan complete; execute paused)

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

**ACTIVE (2026-05-16):** Phase 1 execute is blocked on API keys.
- `OPENAI_API_KEY` — not set. Required for gbrain embeddings + vector search.
- `ANTHROPIC_API_KEY` — not set. Required for `gbrain think`/`gbrain query` answer synthesis (verified in `~/Git repos/gbrain/src/core/think/index.ts:225`: returns placeholder `(no LLM available — set ANTHROPIC_API_KEY or pass 'client')` without it).
- Without both: Phase 1's smoke gate (DATA-10, success criterion #4) cannot pass — `gbrain query "what was weird about last month?"` returns the placeholder, not an answer.

**Resume instructions** when keys are available:
1. Add to `~/.zshenv` (NOT `~/.zshrc` — non-interactive subshells only source zshenv):
   ```
   export OPENAI_API_KEY="sk-..."
   export ANTHROPIC_API_KEY="sk-ant-..."
   ```
2. Run: `/gsd-autonomous --only 1` to resume Phase 1 from execute.

**Already-completed operator setup (do not redo):**
- `bun 1.3.14` installed at `~/.bun/bin/bun` (path added to `~/.zshrc`)
- `gbrain 0.35.1` installed via `git clone ~/Git repos/gbrain && bun install && bun link`
- `brains/` directory writable in repo
- Phase 1 CONTEXT.md + 6 PLAN.md files committed (52fed6c, e7b4388)

Note: Phase 1 doubles as critical-path spike — if `gbrain graph-query`, `gbrain orphans`, or the "what was weird" smoke gate fails on resume, replan before any UI work.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-16 (smart discuss + planner for Phase 1)
Stopped at: Phase 1 plans committed; halted before `/gsd-execute-phase 01` pending API keys
Resume file: `.planning/phases/01-brain-spine-synthetic-seed/01-CONTEXT.md` + the 6 `01-NN-PLAN.md` files
Resume command: `/gsd-autonomous --only 1` (after exporting OPENAI + ANTHROPIC keys to `~/.zshenv`)
