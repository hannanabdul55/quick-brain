---
phase: 03-in-process-gbrain-refactor
plan: "02"
subsystem: gbrain-client
tags: [inprocess, query, think, chat, mutex, refactor]
dependency_graph:
  requires: ["03-01"]
  provides: ["in-process query()", "in-process think()", "chat route in-process"]
  affects: ["app/api/tenants/[id]/chat/route.ts", "lib/gbrain/client.ts", "lib/gbrain/mutex.ts"]
tech_stack:
  added: ["runThink shim in types/gbrain.ts (dynamic _load('core/think/index'))"]
  patterns: ["in-process LLM synthesis via runThink", "engine pool reuse for gateway init", "GBrainResult wrapper around ThinkResult"]
key_files:
  created:
    - tests/unit/gbrain/client-inprocess.test.ts
  modified:
    - lib/gbrain/client.ts
    - types/gbrain.ts
    - app/api/tenants/[id]/chat/route.ts
    - lib/gbrain/mutex.ts
    - lib/chat/system-prompt.ts
decisions:
  - "runThink loaded via dynamic _load('core/think/index') — not in gbrain package.json exports map; computed import bypasses both tsc and the exports map restriction"
  - "think() calls createGBrainEngine before withTenantLock to ensure configureGateway ran (gateway singleton init); engine pool deduplication makes concurrent calls safe"
  - "withTenantLock retained unchanged — serializes onboarding sequence and preserves Phase 1 mutex-smoke regression test; harmless for query/think on Postgres"
  - "system-prompt not forwarded in-process (RunThinkOpts v0.28 has no systemPrompt field); buildThinkArgs retained for compatibility; Phase 6 resolves"
  - "query() uses noExpand: false default; opts.noExpand passed through for onboarding warm-up (ONBD-05 compat)"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  files_changed: 5
  files_created: 1
---

# Phase 03 Plan 02: In-Process Query + Think Rewrite Summary

Rewrote `query()` and `think()` in `lib/gbrain/client.ts` to run in-process via the engine layer built in 03-01. Wired the chat route to the in-process `think()` path. Re-evaluated and documented `withTenantLock`. No child process is spawned in the query or chat paths.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite query() and think() in client.ts | 94fa5f5 | lib/gbrain/client.ts, types/gbrain.ts, tests/unit/gbrain/client-inprocess.test.ts |
| 2 | Update chat route + mutex comment; system-prompt | b765ae7 | app/api/tenants/[id]/chat/route.ts, lib/gbrain/mutex.ts, lib/chat/system-prompt.ts |

## What Was Built

**query() in-process (INPROC-02):** Delegates to `queryInProcess(tenantId, question, { noExpand })` from `engine.ts`. Formats results as `[score] slug -- chunk_snippet` lines matching CLI output style. Wraps in `withTenantLock` for serialization. The `noExpand` opt is threaded through so the onboarding warm-up (ONBD-05) can call `query(tenantId, q, { noExpand: true })` without expansion.

**think() in-process (INPROC-04):** Calls `createGBrainEngine(tenantId)` first (ensures `configureGateway` ran — critical for LLM calls), then calls `runThink(engine, { question, model })` via the `types/gbrain.ts` shim. Returns `GBrainResult { code, stdout, stderr }` so the chat route works unchanged. Errors are caught and returned as `code: 1` (not thrown) so the route handler can emit a proper SSE error frame.

**runThink shim (types/gbrain.ts):** `gbrain/core/think/index` is NOT in the package.json exports map. Added `RunThinkOpts`, `ThinkResult`, and `runThink()` to the shim using the existing `_load("core/think/index")` computed-import pattern. This bypasses both tsc strict-checking of gbrain's source and the exports map restriction.

**Chat route (INPROC-04):** Replaced `spawnGBrain(buildThinkArgs(question), { tenantId, timeoutMs: 30_000 })` with `think(tenantId, question, { model: "haiku" })`. Removed `spawnGBrain` and `buildThinkArgs` imports. `runtime = "nodejs"` retained (gbrain's Postgres client is not edge-compatible). Comment updated to explain the Node.js requirement is now the DB client, not child_process.

**Mutex re-evaluation (INPROC-05):** `withTenantLock` logic unchanged. Comment updated from "PGLite exclusive file lock serialization" to document Phase 3 role: serializes the onboarding init/import/embed sequence per tenant; harmless for query/think (Postgres handles concurrency). The mutex-smoke regression test (4 tests) passes unchanged.

**system-prompt.ts:** Added Phase 3 note explaining system-prompt is not forwarded in-process (RunThinkOpts v0.28 has no `systemPrompt` field). `buildThinkArgs` retained for compatibility. Added `getThinkModel()` helper for callers that need the configured model string without the full args array.

## Test Results

- New tests: 7 (client-inprocess.test.ts) — all pass
- Full suite: 113 passed / 4 skipped (117 total)
- Mutex-smoke: 4 passed
- `bunx tsc --noEmit`: exit 0 (no errors)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Discovery] runThink not in gbrain exports map**
- **Found during:** Task 1 implementation
- **Issue:** The plan's `<action>` suggested `import runThink from "gbrain/core/think/index"`, but `gbrain/core/think/index` is NOT in the package.json exports map (confirmed by reading exports). A direct import would fail at runtime.
- **Fix:** Added `runThink` to `types/gbrain.ts` shim using the existing `_load("core/think/index")` dynamic-import pattern that bypasses both tsc and the exports map. This is the established pattern for all gbrain functions in this codebase.
- **Files modified:** types/gbrain.ts
- **Commit:** 94fa5f5

**2. [Rule 1 - Bug] Test 5 assertion corrected**
- **Found during:** Task 1 test run
- **Issue:** Initial Test 5 expected `result.stdout.toContain("gather summary")` but `result.stdout` is the answer text; warnings go to `result.stderr`.
- **Fix:** Updated assertion to `expect(result.stdout).toBe(partialAnswer)` and `expect(result.stderr).toContain("ANTHROPIC_KEY_MISSING")` — correctly reflecting the `GBrainResult` contract.
- **Files modified:** tests/unit/gbrain/client-inprocess.test.ts

## Decisions Made

1. **runThink import strategy:** Dynamic `_load("core/think/index")` in types/gbrain.ts shim — consistent with all other gbrain function shims in this project.
2. **createGBrainEngine before withTenantLock:** Engine pool creation (and gateway init) is safe to call concurrently (pool deduplicates via `Promise<BrainEngine>`). Called outside the lock so multiple tenants can init engines in parallel.
3. **withTenantLock retained unchanged:** Harmless for query/think with Postgres; load-bearing for onboarding sequence. Changing it would break the Phase 1 mutex regression test and the onboarding serialization guarantee.
4. **system-prompt gap accepted for Phase 3:** `RunThinkOpts` in gbrain v0.28 has no `systemPrompt` field. The QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT env-var gate already made this best-effort. Phase 6 resolves when gbrain adds the field or a wrapper prompt is injected differently.

## Known Stubs

None — the in-process paths are wired to real gbrain functions.

## Threat Flags

No new security surface introduced beyond what was documented in the plan's threat model:
- T-03-04: ANTHROPIC_API_KEY consumed in-process (accepted — same exposure as child env)
- T-03-05: think() no longer sandboxed in child process (accepted — zod validation at route boundary)
- T-03-06: runThink blocks event loop on slow Anthropic calls (Phase 5 deferred — AbortController timeout)

## Self-Check

## Self-Check: PASSED

- [x] SUMMARY.md exists at .planning/phases/03-in-process-gbrain-refactor/03-02-SUMMARY.md
- [x] Commit 94fa5f5 exists (Task 1: client.ts + types/gbrain.ts + tests)
- [x] Commit b765ae7 exists (Task 2: chat route + mutex + system-prompt)
- [x] lib/gbrain/client.ts: query() calls queryInProcess, think() calls runThink — no spawn("gbrain") in either path
- [x] spawnGBrain and runOnce retained for onboarding path
- [x] app/api/tenants/[id]/chat/route.ts imports only think() — no spawnGBrain, no buildThinkArgs
- [x] lib/gbrain/mutex.ts: comment updated, withTenantLock logic unchanged
- [x] mutex.test.ts: 4 tests pass unchanged
- [x] 113 tests pass / 4 skipped; bunx tsc --noEmit clean
