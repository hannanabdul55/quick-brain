---
phase: 03-in-process-gbrain-refactor
plan: "03"
subsystem: testing
tags: [inprocess, query, integration-test, vitest, regression-guard]
dependency_graph:
  requires: ["03-01", "03-02"]
  provides: ["INPROC-06 regression guard", "in-process query result-count parity test"]
  affects: ["tests/integration/gbrain/", "Phase 4 (Vercel deploy)", "Phase 5 (background jobs)"]
tech_stack:
  added: []
  patterns: ["integration test gated on SUPABASE_DB_URL_POOLER + OPENAI_API_KEY + RUN_INTEGRATION", "live block via describe.skipIf, pure unit test always runs"]
key_files:
  created:
    - tests/integration/gbrain/inprocess-query.test.ts
  modified:
    - types/gbrain.ts
decisions:
  - "think-shim loaded via _loadThink (import.meta.resolve sibling -> file URL), not import('gbrain/core/think/index') — the latter is not in gbrain's exports map and throws ERR_MODULE_NOT_FOUND"
  - "new integration test gates on RUN_INTEGRATION (matches engine-expansion.test.ts convention), not SUPABASE alone — keeps CI opt-in"
  - "concurrent-smoke.test.ts left unchanged — it already exercises the in-process query() wrapper, no spawnGBrain reference"
patterns_established:
  - "Integration test: describe.skipIf for live block + a sibling pure-unit describe that always runs"
requirements_completed: ["INPROC-06"]
metrics:
  duration: "~30 minutes"
  completed: "2026-05-20"
  tasks_completed: 2
  files_changed: 2
  files_created: 1
---

# Phase 03 Plan 03: In-Process Query Integration Test + Phase Verification Summary

**INPROC-06 regression guard (`inprocess-query.test.ts`) plus the full Phase 1+2+3 suite green — and the Wave 2 `think`-returns-empty blocker fixed: in-process `think()` now produces a real 1873-char synthesis.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-05-20
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 fixed)

## Accomplishments

- Fixed the Wave 2 blocker: in-process `think()` returned 0 chars because the
  shim imported `gbrain/core/think/index` — a subpath absent from gbrain's
  `package.json` exports map — which throws `ERR_MODULE_NOT_FOUND` at runtime.
- Wrote `tests/integration/gbrain/inprocess-query.test.ts` — the INPROC-03/06
  regression guard for in-process query result-count parity.
- Full suite green both ways: 114 passed / 7 skipped (CI, no creds) and
  121 passed / 0 skipped (live, creds + `RUN_INTEGRATION`).
- All six INPROC requirements verified by static gate + live run.

## Task Commits

1. **Pre-Wave-3 blocker fix: think-shim import path** - `ab6bc34` (fix)
2. **Task 1: in-process query integration test** - `e31f0e8` (test)
3. **Task 2: full-suite regression + static gates** - verification only, no file changes

**Plan metadata:** committed with this SUMMARY (docs)

## Files Created/Modified

- `tests/integration/gbrain/inprocess-query.test.ts` - 4 tests: result-count
  parity with expansion (INPROC-03), basic retrieval with `noExpand`, vendor
  query topic-relevance, and a pure-unit `disconnectEngine` test.
- `types/gbrain.ts` - `_loadThink()` resolves `gbrain/engine` (an exported
  subpath) to a file URL, rewrites it to `think/index.ts`, and imports that
  URL — file-URL imports are not subject to the package exports map.

## INPROC Requirements Checklist

| Req | Verification | Result |
|-----|--------------|--------|
| INPROC-01 | `package.json` gbrain dep | `github:garrytan/gbrain#3933eb6` (SHA-pinned) ✓ |
| INPROC-02 | no `spawn`/`child_process` in `engine.ts` | static gate PASS ✓ |
| INPROC-03 | integration test result count with expansion | **25 results** (threshold ≥10; Spike 006 CLI baseline = 21) ✓ |
| INPROC-04 | no live `spawnGBrain`/`buildThinkArgs` in chat route | static gate PASS (comment mentions only) ✓ |
| INPROC-05 | mutex tests pass unchanged | part of the 121-green suite ✓ |
| INPROC-06 | `bun run test` exits 0 | 114 passed CI / 121 passed live ✓ |

## Observed Result Counts (for future baseline comparison)

- `queryInProcess("seed", "what was weird about last month?")` → **25 results**, top slug `march-anomaly-summary`
- same query with `{ noExpand: true }` → 25 results (hybrid vector+keyword search saturates the default result limit even without query expansion — both modes cap at 25)
- `queryInProcess("seed", "top vendors by total spend")` → vendor/expense pages (`concepts/recurring-charges`, `invoice-*`)
- in-process `think()` (sonnet) → `code=0`, 1873-char synthesis with citations

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] In-process `think()` returned an empty answer**
- **Found during:** Wave 2 / Wave 3 boundary (documented in `.continue-here.md`)
- **Issue:** 03-02's shim loaded think via `import("gbrain/core/think/index")`. That subpath is not in gbrain's `package.json` exports map; the exports map is enforced for computed specifiers too, so the import throws `ERR_MODULE_NOT_FOUND`. `client.ts::think` caught the throw and returned `code:1 / stdout:""`. 03-02's SUMMARY claim that the computed import "bypasses the exports map restriction" was incorrect — the `_load` string-concat trick only hides the import from tsc, not from runtime resolution.
- **Fix:** Added `_loadThink()` — resolves `gbrain/engine` (an *exported* sibling under `src/core/`) via `import.meta.resolve`, rewrites the resolved file URL to `think/index.ts`, and imports that URL. File-URL imports bypass the exports map.
- **Files modified:** types/gbrain.ts
- **Verification:** live `think("seed", ...)` returns `code=0` + a 1873-char synthesis with `[concepts/...]` / `[originals/...]` citations.
- **Committed in:** ab6bc34

**2. [Rule 1 - Plan snippet correction] Integration test gating + import path**
- **Found during:** Task 1
- **Issue:** The plan's `<action>` snippet used a 2-level relative import (`../../lib/...`) and gated only on `SUPABASE_DB_URL_POOLER`/`OPENAI_API_KEY`. The sibling `engine-expansion.test.ts` (created in 03-01) established a 3-level path and a `RUN_INTEGRATION` gate.
- **Fix:** Used `../../../lib/gbrain/engine.ts` and added `RUN_INTEGRATION` to the skip condition — matches the established directory convention and keeps integration tests opt-in for CI.
- **Files modified:** tests/integration/gbrain/inprocess-query.test.ts
- **Committed in:** e31f0e8

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 plan-snippet correction)
**Impact on plan:** The blocking fix was the prerequisite for a usable chat path — without it the chat route would render empty answers. No scope creep.

## Issues Encountered

- **Anthropic 529 "Overloaded"** during `think` verification: the `haiku` model returned HTTP 529 on 5 consecutive attempts. The `sonnet` model (separate capacity pool) succeeded on the first try. This is a transient Anthropic-side capacity event, not a code defect — `client.ts::think` still defaults to `haiku`, which works when Anthropic is not overloaded.
- **`concurrent-smoke.test.ts`** needed no changes — it already calls the in-process `query()` wrapper (rewired in 03-02), with no `spawnGBrain` reference.

## Carried-Forward Gaps (not Phase 3 blockers)

- **Per-business system prompt:** gbrain v0.35 `runThink` (`RunThinkOpts`) has no `systemPrompt` parameter — the prompt is built internally by `buildThinkSystemPrompt`. The `MARAS_COFFEE_SYSTEM_PROMPT` genuinely cannot be injected via this API. Options for a later phase: prepend business context to the question string, or fork gbrain. Not a blocker — gbrain's built-in synthesis prompt produces competent answers.
- **Next.js bundling:** `next.config.ts` has no `serverExternalPackages`. The in-process gbrain path is verified under the Bun runtime (tests + live checks); whether webpack bundles gbrain (raw `.ts` + PGLite + Anthropic SDK) cleanly for the chat Route Handler is unverified. Belongs to Phase 4 (Vercel deploy) — gbrain likely needs to be added to `serverExternalPackages`.

## Next Phase Readiness

- Phase 3 complete: all six INPROC requirements satisfied. In-process query and
  think both verified live against the Supabase brain.
- Phase 4 (Vercel deploy) should add `gbrain` to `serverExternalPackages` in
  `next.config.ts` and verify the chat route in a real Next.js build.

---
*Phase: 03-in-process-gbrain-refactor*
*Completed: 2026-05-20*
