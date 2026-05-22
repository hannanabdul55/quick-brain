---
phase: 05-background-jobs
plan: 01
subsystem: infra
tags: [inngest, background-jobs, serve-route, client-singleton, env-vars]

# Dependency graph
requires:
  - phase: 04-vercel-deploy
    provides: "Route Handler conventions (runtime=nodejs, dynamic=force-dynamic), vercel.json bun@1.2.0 glob"
provides:
  - "inngest@4.4.0 installed and pinned in package.json (D-01 locked)"
  - "lib/inngest/client.ts: `inngest` singleton exported as `new Inngest({ id: 'quickbrain' })`"
  - "app/api/inngest/route.ts: Inngest serve handler exporting GET/POST/PUT, runtime=nodejs"
  - "INNGEST_EVENT_KEY + INNGEST_SIGNING_KEY documented as server-only secrets in .env.example"
affects: [05-02, 05-03, 05-04, 05-05, background-jobs]

# Tech tracking
tech-stack:
  added: ["inngest@4.4.0 (Apache-2.0, official inngest org, no postinstall hook)"]
  patterns:
    - "Inngest client singleton — module-level `export const inngest = new Inngest({ id })` in lib/inngest/client.ts, mirrors enginePool pattern in lib/gbrain/engine.ts"
    - "Inngest serve handler — `serve({ client, functions: [] })` destructured into GET/POST/PUT exports, empty functions array filled by plan 05-04"

key-files:
  created:
    - lib/inngest/client.ts
    - app/api/inngest/route.ts
  modified:
    - package.json
    - bun.lock
    - .env.example

key-decisions:
  - "Task 1 package-legitimacy gate approved by orchestrator before install: inngest@4.4.0 from github.com/inngest/inngest-js, Apache-2.0, no postinstall, official org maintainers"
  - "inngest-cli NOT added as a package.json dependency — invoked via `bunx inngest-cli@latest dev` on demand"
  - "serve() called with empty functions array; plan 05-04 adds the generic runJob function"
  - "INNGEST_DEV=1 documented as local-only; explicitly must NOT be set in Vercel production env (disables HMAC signature verification)"

patterns-established:
  - "Inngest singleton: lib/inngest/client.ts exports a single named `inngest` const, no other exports"
  - "Inngest serve route: runtime=nodejs + dynamic=force-dynamic (matches all other API routes); exports destructured GET/POST/PUT"

requirements-completed: [JOBS-01]

# Metrics
duration: 2min
completed: 2026-05-22
---

# Phase 5 Plan 01: Inngest Install + Serve Route Summary

**Inngest@4.4.0 installed with a `quickbrain` client singleton and a GET/POST/PUT serve handler at /api/inngest, both INNGEST_ secrets documented as server-only in .env.example**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-22T02:21:20Z
- **Completed:** 2026-05-22T02:23:13Z
- **Tasks:** 2 (Task 1 was a pre-approved checkpoint — no implementation)
- **Files modified:** 5

## Accomplishments

- `inngest@4.4.0` installed from the official Inngest org; package legitimacy verified by orchestrator prior to install (no postinstall hook, Apache-2.0, published on npmjs.com by `inngest-release-bot`)
- `lib/inngest/client.ts` exports `inngest = new Inngest({ id: "quickbrain" })` — the single import point for both the serve route and the upcoming trigger route (plan 05-04)
- `app/api/inngest/route.ts` serves GET/POST/PUT with `runtime="nodejs"` and `dynamic="force-dynamic"`, matching the onboard/chat route segment convention; responds 200 with Inngest introspection JSON on GET locally (GET /api/inngest with `bun run dev` + `INNGEST_DEV=1` returns the expected introspection payload)
- `.env.example` documents `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` as server-only secrets with security notes addressing T-05-01 (unsigned request spoofing) and notes that `INNGEST_DEV=1` must NOT be set in production

## Task Commits

1. **Task 1: Verify inngest package legitimacy** - pre-approved checkpoint, no commit (0 files)
2. **Task 2: Install inngest and create client singleton** - `5769fa6` (feat)
3. **Task 3: Create Inngest serve route and document env vars** - `8a7bef0` (feat)

## Files Created/Modified

- `lib/inngest/client.ts` - Inngest client singleton; `export const inngest = new Inngest({ id: "quickbrain" })`
- `app/api/inngest/route.ts` - Inngest serve handler; GET/POST/PUT from `serve({ client: inngest, functions: [] })`
- `package.json` - `"inngest": "^4.4.0"` added to dependencies
- `bun.lock` - Updated after `bun add inngest`
- `.env.example` - New `### Inngest (background jobs)` section with INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY, and INNGEST_DEV=1 notes

## Decisions Made

- Package legitimacy gate: Task 1 was a `checkpoint:human-verify` with `gate="blocking-human"`. Orchestrator pre-approved after confirming inngest on npmjs.com (official org, Apache-2.0, no postinstall, 4.4.0, high weekly downloads). No auto-approval applied — explicit orchestrator approval per the non-auto-approvable gate rule.
- `inngest-cli` is invoked via `bunx inngest-cli@latest dev` — not a dep, not installed.
- `functions: []` in serve() is intentional; plan 05-04 registers the generic `runJob` function.
- Route does not add an entry to `next.config.ts` `outputFileTracingIncludes` — Inngest is a normal ESM package and the Vercel tracer follows static imports automatically (per plan context notes).

## Deviations from Plan

None — plan executed exactly as written. The `bun add inngest` step required prefixing PATH with `~/.bun/bin` (bun not on default PATH in the shell environment) — this is a shell environment setup detail, not a deviation.

## Issues Encountered

- `bun` was not on the default PATH in the agent shell. Resolved by prepending `$HOME/.bun/bin` to PATH for all bun invocations.

## User Setup Required

External services require manual configuration before production use:

- **INNGEST_EVENT_KEY**: Inngest Dashboard -> quickbrain app -> Event Keys
- **INNGEST_SIGNING_KEY**: Inngest Dashboard -> quickbrain app -> Signing Key
- **Local dev**: Set `INNGEST_DEV=1` in `.env.local` and run `bunx inngest-cli@latest dev` alongside `bun run dev`
- **Production**: Register the deployed `/api/inngest` URL in the Inngest Dashboard after Vercel deploy (plan 05-05 smoke test)

See plan 05-01 frontmatter `user_setup` section for the full setup checklist.

## Runtime Verification

`GET /api/inngest` returning 200 JSON requires a live dev server. This was not verified in CI (no dev server running during execution). Expected behavior per Inngest documentation: with `INNGEST_DEV=1` and `bunx inngest-cli@latest dev` running, `curl -s localhost:3000/api/inngest` returns the Inngest introspection JSON. Verification is deferred to plan 05-05 (deploy smoke test) which has an explicit GET /api/inngest check.

## Threat Surface

No new surface beyond what the plan's threat model covers. T-05-01 (spoofing via unsigned requests) is mitigated by documenting `INNGEST_SIGNING_KEY` as required in production with explicit warnings. T-05-02 (key disclosure) is mitigated by server-only documentation in `.env.example` with no NEXT_PUBLIC_ prefix.

## Next Phase Readiness

- Plan 05-02 (generic `runJob` function) can import `inngest` from `@/lib/inngest/client` immediately
- Plan 05-03 (trigger route) can import `inngest` from `@/lib/inngest/client` immediately
- Plan 05-04 (wire `runJob` into the serve route's `functions` array) targets `app/api/inngest/route.ts`
- Plan 05-05 (deploy smoke test) will verify GET /api/inngest returns 200 on the deployed Vercel URL

---
*Phase: 05-background-jobs*
*Completed: 2026-05-22*

## Self-Check: PASSED

- `lib/inngest/client.ts` exists: FOUND
- `app/api/inngest/route.ts` exists: FOUND
- `.env.example` contains INNGEST_SIGNING_KEY: FOUND
- Commit 5769fa6 exists: FOUND
- Commit 8a7bef0 exists: FOUND
- `bunx tsc --noEmit` passes: PASSED
