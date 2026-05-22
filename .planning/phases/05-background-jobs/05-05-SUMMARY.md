---
phase: 05-background-jobs
plan: "05"
subsystem: jobs-ui
tags: [react, polling, jobs, accessibility, progress-ui]
dependency_graph:
  requires: ["05-04"]
  provides: ["JOBS-02-browser-half"]
  affects: ["components/jobs", "lib/jobs"]
tech_stack:
  added: []
  patterns:
    - "bounded setInterval poll loop in useRef (mirrors onboard EventSource pattern)"
    - "isSlow flag from elapsed time tracking per stage"
    - "pollState enum: idle | polling | stopped | timed-out"
key_files:
  created:
    - lib/jobs/use-job-status.ts
    - components/jobs/job-progress.tsx
  modified: []
decisions:
  - "useJobStatus returns isSlow as derived boolean (not a PollState variant) so components can show neutral reassurance without conflating it with timed-out"
  - "JobProgress uses DEFAULT_STAGES matching OnboardingProgress locked five for onboarding/import; consumers can pass allStages for other job kinds"
  - "Error state delegates to ErrorBanner with restart() as the onRetry handler — no new destructive or cancel controls"
  - "aria-live region is sr-only so stage transitions are announced without visible duplication"
metrics:
  duration: "~20min"
  completed: "2026-05-21"
  tasks_completed: 2
  files_changed: 2
---

# Phase 05 Plan 05: Browser Job Progress (Poll Hook + JobProgress Component) Summary

Bounded poll hook and `JobProgress` client component delivering the browser half of JOBS-02: polled job lifecycle (queued/running/slow/done/error/give-up) visually identical to SSE onboarding progress.

## What Was Built

**`lib/jobs/use-job-status.ts`** — `useJobStatus(jobId)` React hook:
- Polls `GET /api/jobs/[id]` every 2s via `setInterval` held in `useRef`
- Bounded by `MAX_POLL_ATTEMPTS = 150` (~5 min wall clock)
- Stops on `status === "done"` or `status === "error"` (interval cleared)
- Cap hit with job still running: surfaces `pollState === "timed-out"` (neutral, not error — T-05-15)
- `isSlow` flag set after 20s of running with no stage change
- `restart()` function re-arms the loop (drives "Check again" CTA after timed-out)
- Returns `{ status, progress, stage, result, error, pollState, isSlow, restart }`
- No leaked intervals: effect cleanup + terminal-state clearInterval (T-05-15)

**`components/jobs/job-progress.tsx`** — `JobProgress` client component:
- Consumes `useJobStatus`; renders all six states per UI-SPEC contract
- **Queued**: 0% bar, muted first-stage indicator, Badge "Queued", "Getting things ready…"
- **Running**: bar fills smoothly, current-stage `Loader2` spins, `tabular-nums` "%complete"
- **Slow-but-healthy**: Badge "Still working" + reassurance line — neutral colors, never red
- **Done**: 100% bar, all green checks, primary "View results" Button
- **Error**: `ErrorBanner` reused as-is; sanitized server error as secondary muted line only (T-05-14)
- **Poll give-up**: neutral "This is taking longer than expected." + "Check again" button → `restart()`
- 8px (`h-2`) progress bar with `role="progressbar"` + `aria-valuenow`/`valuemin`/`valuemax` copied verbatim from `OnboardingProgress`
- `bg-neutral-900` fill + `transition-all duration-500` copied verbatim
- Stage-checklist tri-state: `isDone` green `&#10003;`, `isCurrent` `Loader2 animate-spin`, `isPending` muted dot — 16×16 icon slot
- `aria-live="polite"` sr-only region announces stage transitions and terminal states
- No raw job IDs, stack traces, or "Inngest"/"serverless"/"function timeout" in UI copy (T-05-14)
- No new shadcn primitives; no destructive controls

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1: Poll hook | `0efde31` | feat(05-05): build bounded job-status poll hook |
| Task 2: JobProgress component | `153a4b8` | feat(05-05): build JobProgress polled-job lifecycle component |

## Deviations from Plan

None — plan executed exactly as written. Both new files match their `<artifacts>` and `<key_links>` contracts.

## Known Stubs

None. Both files are fully wired: the hook fetches from the real `/api/jobs/[id]` endpoint, and the component renders real data from the hook. No hardcoded empty values or placeholder text in the rendering paths.

## Threat Flags

No new threat surface introduced beyond what the plan's threat model covers. Both files are browser-only client code; neither references server-only secrets (`INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` are never imported). T-05-14 (no DB internals in DOM) and T-05-15 (bounded poll, no timer leaks) are mitigated in implementation.

## Checkpoint: Task 3 (Deployed-URL Smoke Test)

Task 3 is a `checkpoint:human-verify` — it requires a deployed Vercel URL and Inngest cloud credentials that are not available in this execution environment. The code tasks (Tasks 1 and 2) are complete and committed. The deployment verification must be performed by the operator per the steps below.

## Self-Check: PASSED

Files exist:
- `lib/jobs/use-job-status.ts` — FOUND
- `components/jobs/job-progress.tsx` — FOUND

Commits exist:
- `0efde31` (Task 1 hook) — FOUND
- `153a4b8` (Task 2 component) — FOUND

TypeScript: `bunx tsc --noEmit` — PASSED (no errors)
ESLint: `bunx eslint lib/jobs/use-job-status.ts components/jobs/job-progress.tsx` — PASSED (no errors)
