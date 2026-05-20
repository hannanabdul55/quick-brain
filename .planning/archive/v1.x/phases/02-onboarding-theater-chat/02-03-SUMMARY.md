---
phase: 02-onboarding-theater-chat
plan: 03
subsystem: api
tags: [sse, streaming, orchestrator, nextjs, route-handler, gbrain, onboarding]

requires:
  - phase: 02-onboarding-theater-chat
    plan: 02
    provides: POST /api/tenants Route Handler, createTenant(), lib/onboarding/schemas.ts, lib/gbrain/* Phase 1 harness

provides:
  - lib/onboarding/sse.ts: sseFrame() + sseEventStream() primitives for Server-Sent Events
  - lib/onboarding/orchestrator.ts: runOnboarding() 5-stage choreography (creating-brain→reading-invoices→building-graph→indexing→ready)
  - GET /api/tenants/[id]/onboard Route Handler: SSE stream with real gbrain query --no-expand warm-up
  - ONBD-04 satisfied: 5 honest stage labels in order with "Ready" terminator
  - ONBD-05 satisfied: real gbrain query --no-expand warm-up fires during building-graph, awaited at indexing
  - ONBD-07 satisfied: 36s total wall-clock duration (within 30–45s budget)

affects: [02-04, 02-05, 02-06, phase-03-insights]

tech-stack:
  added: []
  patterns:
    - "ReadableStream<Uint8Array> SSE pattern: sseEventStream() wraps async producer with try/finally close"
    - "Fire-and-collect warm-up: spawnGBrain --no-expand started at stage 3, Promise.race'd with 8s ceiling at stage 4"
    - "No Next.js imports in orchestrator — emit callback pattern for pure testability"
    - "AbortSignal cancellation in sseEventStream — addEventListener + close on abort"
    - "export runtime = nodejs (not edge) on route handler — spawnGBrain requires node:child_process"
    - "fastMode: boolean option collapses durations to 5% for automated tests"

key-files:
  created:
    - lib/onboarding/sse.ts
    - lib/onboarding/orchestrator.ts
    - app/api/tenants/[id]/onboard/route.ts

key-decisions:
  - "sseEventStream accepts AbortSignal — allows clean close when client disconnects mid-stream"
  - "warmup ceiling = max(8000 * multiplier, 100)ms — prevents test hangs while preserving 8s production ceiling"
  - "Progress ticks use (ticks + 1) divisor so both intermediate and final progress = 1 are emitted"
  - "runOnboarding emits progress=0 immediately then ticks, then progress=1 — always bookends each stage"
  - "Warmup failure logged via console.log [onboard.warmup] with code + stderr snippet — not surfaced to client"

patterns-established:
  - "SSE streaming: sseFrame() + sseEventStream() are the canonical helpers; use in all subsequent streaming routes"
  - "Orchestrator isolation: domain logic (orchestrator.ts) has zero Next.js imports; tested via emit callback"
  - "Stage timing multiplier: fastMode = 0.05x for tests; production = 1x; no hardcoded durations in tests"

requirements-completed: [ONBD-04, ONBD-05, ONBD-07]

duration: ~4min
completed: 2026-05-16
---

# Phase 2 Plan 03: SSE Onboarding Stream Summary

**30–45s narrated SSE onboarding theater: 5-stage orchestrator with real gbrain query --no-expand warm-up, ReadableStream primitives, and a Next.js Route Handler — ONBD-04, ONBD-05, ONBD-07 satisfied**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-16T22:36:46Z
- **Completed:** 2026-05-16T22:41:06Z
- **Tasks:** 2/2
- **Files created:** 3, files modified: 0

## Accomplishments

- Created `lib/onboarding/sse.ts`: `sseFrame(event, data)` returns exact `"event: <e>\ndata: <JSON>\n\n"` format; `sseEventStream(generate, signal?)` wraps async producer in `ReadableStream<Uint8Array>` with try/finally close and AbortSignal cancellation
- Created `lib/onboarding/orchestrator.ts`: `runOnboarding(tenantId, emit, options?)` drives the 5-stage timeline (5s/12s/10s/8s/1s = 36s); spawns `gbrain query "Top vendors by total spend?" --no-expand` at building-graph without awaiting; awaits at indexing with 8s ceiling via `Promise.race`; warmup failure never fails stream; `fastMode: true` collapses durations to 5% completing in <2s; no Next.js imports
- Created `app/api/tenants/[id]/onboard/route.ts`: validates tenant id via `tenantSlugSchema` (400 on invalid); checks tenant exists (404 if missing); returns SSE `Response` with `runtime = "nodejs"`, `dynamic = "force-dynamic"`, correct SSE headers including `X-Accel-Buffering: no`
- Real-clock smoke test: 37s stream, 27 stage frames, 1 done frame, 5 stages in exact order `creating-brain→reading-invoices→building-graph→indexing→ready`, 400/404 error cases verified
- fastMode smoke test: 28 events, <2s completion, correct stage order, `done` emitted, no errors propagated despite gbrain not in PATH (warmup failed gracefully)

## Task Commits

Each task was committed atomically:

1. **Task 1: SSE primitives and orchestrator** - `b95a0fd` (feat)
2. **Task 2: GET /api/tenants/[id]/onboard SSE Route Handler** - `1ada3a2` (feat)

## Files Created/Modified

- `lib/onboarding/sse.ts` - sseFrame() + sseEventStream(); AbortSignal support; UTF-8 TextEncoder
- `lib/onboarding/orchestrator.ts` - runOnboarding(); 5-stage STAGE_DEFS array; fire-and-collect warm-up pattern; OnboardingStage + OnboardingEvent types
- `app/api/tenants/[id]/onboard/route.ts` - GET Route Handler; 400/404 guards; SSE response with nodejs runtime

## Decisions Made

- **AbortSignal in sseEventStream:** Route Handlers receive `req.signal` which aborts when the client disconnects. Passing it to `sseEventStream` lets the stream close cleanly without a dangling orchestrator that keeps sleeping through stage timers after the client has navigated away.
- **warmup ceiling = max(8000 * multiplier, 100)ms:** In fastMode (multiplier=0.05), 8000 * 0.05 = 400ms — which could still cause test slowness when awaiting a Promise.race. The 100ms floor prevents this. In production (multiplier=1), the ceiling is the full 8s.
- **runtime = "nodejs" not "edge":** `spawnGBrain` uses `node:child_process.spawn`. Edge runtime does not support `node:child_process`. Required to prevent runtime mismatch.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. The orchestrator is fully wired: real gbrain warm-up is spawned (fails gracefully if gbrain not in PATH), all 5 stages emit with real timings, the route handler validates inputs and returns SSE.

## Threat Flags

None. No new network endpoints beyond the planned `GET /api/tenants/[id]/onboard`. The tenant id is validated via `tenantSlugSchema` regex before any operation. No user input reaches the gbrain subprocess (the warm-up query string is hardcoded).

## Self-Check: PASSED

- `lib/onboarding/sse.ts` exists: YES
- `lib/onboarding/orchestrator.ts` exists: YES
- `app/api/tenants/[id]/onboard/route.ts` exists: YES
- Commit `b95a0fd` exists: YES
- Commit `1ada3a2` exists: YES
- `export function sseFrame` in sse.ts: YES
- `export function sseEventStream` in sse.ts: YES
- `export async function runOnboarding` in orchestrator.ts: YES
- `--no-expand` in orchestrator.ts: YES (3 occurrences — comment + code comment + CLI arg)
- `Content-Type: text/event-stream` in route.ts: YES
- `export async function GET` in route.ts: YES
- `bunx tsc --noEmit` exits 0: YES
- fastMode smoke test completes in <5s with correct event sequence: YES (1.83s, 28 events)
- Real-clock stream: 37s, 27 stage frames, 1 done frame, correct stage order: YES
- 400 on invalid slug (UPPERCASE): YES
- 404 on valid but nonexistent slug: YES
