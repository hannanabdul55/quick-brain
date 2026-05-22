---
phase: 05-background-jobs
plan: "02"
subsystem: background-jobs
tags: [latency, benchmarking, jobs, threshold, vercel, gbrain]
dependency_graph:
  requires: []
  provides: [latency-threshold-doc, bench-script]
  affects: [05-03, 05-04, 05-05]
tech_stack:
  added: []
  patterns: [p50/p95-percentile-benchmark, inline-vs-job-threshold]
key_files:
  created:
    - scripts/bench-gbrain.ts
    - docs/phase-5-latency-threshold.md
  modified: []
decisions:
  - "query (p95 ~6s) and think (p95 ~11s) stay INLINE — both well within the 300s Vercel ceiling"
  - "import (~120s+, variable) MUST route to Inngest as a background job — not because of the 300s ceiling but because of unbounded variance, no progress feedback, and no recovery path if connection drops"
  - "The stale 10s/60s Hobby/Pro timeout figures in PROJECT.md/ROADMAP are superseded — the real ceiling is 300s (Fluid Compute default-on since 2025-04-23)"
metrics:
  duration: "~10 minutes"
  completed: "2026-05-22"
  tasks_completed: 3
  files_created: 2
  files_modified: 0
---

# Phase 5 Plan 02: Latency Benchmark and Threshold Document Summary

**One-liner:** Measured gbrain p50/p95 latencies against Supabase seed brain, confirmed the 300s Vercel Fluid Compute ceiling, and documented that query/think stay inline while import routes to a background job.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write the p50/p95 benchmark script | a1468c5 | scripts/bench-gbrain.ts |
| 2 | Run the benchmark and confirm Vercel ceiling | (orchestrator-run, no commit) | — |
| 3 | Write the latency-threshold decision document | a985060 | docs/phase-5-latency-threshold.md |

## What Was Built

**Task 1 (committed at plan base `a1468c5`):** `scripts/bench-gbrain.ts` — a reproducible
benchmark that measures p50/p95/max for `query`, `think`, and `import` against the seed brain.
Uses the same in-process entry points the app uses (`queryInProcess`, `think`, `onboard`).
Implements `percentile()` (nearest-rank method), `timeIt()` (performance.now), and a
`bench()` helper with one warm-up run discarded before N timed samples. Iteration counts:
QUERY_N=30, THINK_N=10, IMPORT_N=3.

**Task 2 (resolved by orchestrator):** The benchmark was run locally against the Supabase
Postgres seed brain. Results:
- query: n=30, p50=2537ms, p95=6222ms, max=7073ms
- think: n=10 (haiku), p50=9215ms, p95=11289ms, max=11289ms
- import: warm-up completed <120s; first timed sample exceeded the `onboard()` 120000ms
  spawn-timeout. Duration is ~120s+ and highly variable.

Vercel ceiling confirmed at **300s** via two facts: (1) Fluid Compute is default-on since
2025-04-23; (2) `vercel.json` has no `maxDuration` override.

**Task 3 (commit a985060):** `docs/phase-5-latency-threshold.md` — records the measured
numbers, confirms the 300s ceiling with evidence, states the inline-vs-job decision per
operation, and notes that the stale "10s/60s" PROJECT.md/ROADMAP figures are superseded.

## Inline vs. Job Decision (D-04 / JOBS-03)

| Operation | p95 | Decision |
|-----------|-----|----------|
| query | ~6s | INLINE |
| think | ~11s | INLINE |
| import | ~120s+ (variable) | BACKGROUND JOB |

Import is not a background job because it exceeds the 300s ceiling — it doesn't. It is a
background job because: (1) the variance is unbounded; (2) a multi-minute inline request
gives the user no progress feedback; (3) there is no recovery path if the connection drops.

## Deviations from Plan

None — plan executed as written. Task 2 was resolved by the orchestrator before this
continuation agent spawned; measured numbers were supplied in the agent prompt.

## Known Stubs

None — this plan produces documentation only. No UI, no data wiring.

## Threat Flags

None — `docs/phase-5-latency-threshold.md` records only aggregate timing numbers and a
design decision. No credentials, API keys, or query response bodies are committed.

## Self-Check

Files created:
- scripts/bench-gbrain.ts: EXISTS (committed at a1468c5)
- docs/phase-5-latency-threshold.md: EXISTS (committed at a985060)

Commits:
- a1468c5: feat(05-02): add p50/p95 latency benchmark script for gbrain operations
- a985060: docs(05-02): write latency-threshold decision document (Task 3)
