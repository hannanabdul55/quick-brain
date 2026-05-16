# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-16)

**Core value:** A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.
**Current focus:** Phase 2 — Onboarding Theater + Chat (planning starts next)

## Current Position

Phase: 2 of 3 (Onboarding Theater + Chat) — pending
Last completed: Phase 1 — Brain Spine + Synthetic Seed (2026-05-16, passed_with_deferred_item)
Status: Phase 1 ships; Phase 2 ready to plan
Last activity: 2026-05-16 — Phase 1 verification written; 4 of 5 success criteria pass; criterion #4 deferred until ANTHROPIC_API_KEY arrives

Progress: [████░░░░░░] 33% (1 of 3 phases complete with one deferred verification item)

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

**OUTSTANDING (2026-05-16):** ANTHROPIC_API_KEY is still not set. Phase 1 verification #4 is deferred behind this key; Phase 2's chat surface and Phase 3's insight cards will return graceful timeout errors instead of LLM-synthesized answers until the key arrives. The non-LLM parts of Phase 2 (Next.js scaffold, onboarding theater, dashboard chrome, SSE plumbing, query routing, error UX) and Phase 3 (graph-backed insight cards using `gbrain graph-query`, reset script, demo doc) all build and demo without it.

**Resume Phase 1 criterion #4:** Once the key is added, `GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"` should name all 3 anomalies in one paragraph; flip `.planning/phases/01-brain-spine-synthetic-seed/01-VERIFICATION.md` `status:` to `passed`.

**Already-completed operator setup (do not redo):**
- `bun 1.3.14` installed at `~/.bun/bin/bun` (path added to `~/.zshrc`)
- `gbrain 0.35.1` installed via `git clone ~/Git repos/gbrain && bun install && bun link`
- `brains/` directory writable in repo
- `OPENAI_API_KEY` exported in `~/.zshenv` (with `export` keyword — non-interactive subshells inherit)
- Phase 1 shipped: `lib/gbrain/`, `data/maras-coffee/` (46 files), `scripts/` (seed.sh, demo-check.sh, detect-anomalies.ts, mutex-smoke.ts), `brains/seed/` reproducible artifact
- Phase 1 closeout docs: `01-SUMMARY.md`, `01-VERIFICATION.md` under `.planning/phases/01-brain-spine-synthetic-seed/`

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-05-16 (Phase 1 complete; PR #1 by lightspeed merged + 5 post-merge fixes + verification)
Stopped at: Phase 1 SUMMARY + VERIFICATION committed; ready to plan Phase 2
Resume file: `.planning/phases/01-brain-spine-synthetic-seed/{01-SUMMARY.md, 01-VERIFICATION.md}`
Resume command: continuing into Phase 2 — onboarding theater + chat
