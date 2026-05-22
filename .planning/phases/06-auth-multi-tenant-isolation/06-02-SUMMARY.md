---
phase: 06-auth-multi-tenant-isolation
plan: "02"
subsystem: gbrain-integration
tags: [gbrain-patch, source-isolation, multi-tenant, D-12, auth]
dependency_graph:
  requires: []
  provides: [gbrain-sourceId-threading, D-12-patch-applied]
  affects: [lib/gbrain/engine.ts, lib/gbrain/client.ts, types/gbrain.ts]
tech_stack:
  added: [native-patch-cli]
  patterns: [patch-on-postinstall, source-scoped-retrieval]
key_files:
  created:
    - patches/gbrain+3933eb6.patch
    - scripts/apply-gbrain-patch.js
  modified:
    - package.json
    - types/gbrain.ts
    - lib/gbrain/engine.ts
    - lib/gbrain/client.ts
decisions:
  - "Switch from patch-package to native patch CLI: patch-package 8.x rejects gbrain's 4-part version (0.35.1.0) via semver.valid() and does not support bun.lock; native patch command applied via scripts/apply-gbrain-patch.js with idempotency check"
  - "Patch filename stays gbrain+3933eb6.patch (human-readable SHA reference per PLAN.md spec) rather than patch-package semver naming"
metrics:
  duration: "~90 minutes (including round-trip debugging)"
  completed: "2026-05-22T18:03:58Z"
  tasks_completed: 3
  files_created: 2
  files_modified: 4
---

# Phase 06 Plan 02: gbrain sourceId threading (D-12) Summary

gbrain's chat path now accepts an optional `sourceId` scope parameter end-to-end, from `client.ts::think()` through `queryInProcess`, `runThink`, `runGather`, down to `hybridSearch` and `searchTakes`. The AUTH-05 mechanical foundation is in place. Session-derived `source_id` wiring is deferred to plan 06-05.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Verify patch-package legitimacy | (checkpoint — no code) | N/A |
| 2 | Install patch-package; thread sourceId through gbrain think internals; capture D-12 patch | 08ae622 | patches/gbrain+3933eb6.patch, scripts/apply-gbrain-patch.js, package.json |
| 3 | Expose sourceId on shim; thread through queryInProcess and think() | bbc2b0b | types/gbrain.ts, lib/gbrain/engine.ts, lib/gbrain/client.ts |

## What Was Built

**D-12 patch** (`patches/gbrain+3933eb6.patch`): threads `sourceId?: string` through:
- `ThinkGatherOpts` (gather.ts) — new field
- `runGather` (gather.ts) — passes `sourceId` to `hybridSearch` (already accepts it natively) and `searchTakes`
- `RunThinkOpts` (index.ts) — new field
- `runThink` (index.ts) — passes `sourceId` into `runGather` call

**Postinstall mechanism** (`scripts/apply-gbrain-patch.js`): custom Node.js script that uses the system `patch` command to re-apply `patches/gbrain+3933eb6.patch` on every `bun install`. Idempotent — checks for the `QuickBrain D-12 patch` marker before applying.

**Shim updates** (`types/gbrain.ts`):
- `HybridSearchOpts`: explicit `sourceId?: string` and `sourceIds?: string[]` fields alongside existing index signature
- `RunThinkOpts`: `sourceId?: string` with patch-invalidation comment

**Engine/client threading**:
- `queryInProcess(tenantId, question, opts?)`: `opts.sourceId` forwarded to `hybridSearch`
- `query(tenantId, question, opts?)`: `opts.sourceId` forwarded to `queryInProcess`
- `think(tenantId, question, opts?)`: `opts.sourceId` forwarded to `runThink`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] patch-package incompatible with gbrain's 4-part version and bun.lock**

- **Found during:** Task 2 round-trip verification
- **Issue:** `patch-package 8.x` uses `semver.valid()` to parse the installed package version. gbrain uses `0.35.1.0` (4-part version), which `semver.valid()` returns `null` for. Result: `patch-package` throws `"Version string '0.35.1.0' cannot be parsed"` and exits with an error. Additionally, `patch-package` doesn't recognize `bun.lock` as a supported lock file format. The plan originally called for `"postinstall": "patch-package"` but this combination (bun + gbrain 4-part version) makes patch-package silently inert.
- **Fix:** Created `scripts/apply-gbrain-patch.js` — a custom Node.js script that uses the system `patch` command directly. Switched `postinstall` to `node scripts/apply-gbrain-patch.js`. Removed `patch-package` from `devDependencies` (the package itself was useless for this case). The round-trip is equivalent: the patch is re-applied on every `bun install` via the postinstall hook, using the standard `patch` CLI which is available on all macOS/Linux systems.
- **Round-trip verified:** Reverted node_modules/gbrain files manually, ran `node scripts/apply-gbrain-patch.js` — patch applied cleanly. Second run skipped idempotently.
- **Files modified:** `package.json`, `scripts/apply-gbrain-patch.js` (created)
- **Commits:** 08ae622

**2. [Rule 1 - Bug] Incorrect patch filename for patch-package (investigated but root cause was the version issue)**

- **Found during:** Task 2 round-trip attempt
- **Issue:** Created `patches/gbrain+0.35.1.0.patch` to match patch-package's semver naming convention, but this also failed because semver.valid() rejects `0.35.1.0`. Cleaned up by removing this incorrectly named file.
- **Fix:** Removed `patches/gbrain+0.35.1.0.patch`; kept `patches/gbrain+3933eb6.patch` per PLAN.md spec.

## Verification Results

- `bun x tsc --noEmit`: exits 0 (all types correct)
- `patches/gbrain+3933eb6.patch` contains `sourceId`: confirmed
- `node_modules/gbrain/src/core/think/gather.ts` passes `sourceId` to both `hybridSearch` and `searchTakes`: confirmed
- `node_modules/gbrain/src/core/think/index.ts` has `sourceId` in `RunThinkOpts` and `runGather` call: confirmed
- Round-trip (revert + postinstall re-apply): confirmed working

## Known Stubs

None. The `sourceId` parameters are optional and default to `undefined` — existing calls (seed tenant, onboarding) continue working without scoping. The actual enforcement (passing session-derived `source_id`) is wired in plan 06-05.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced by this plan. The patch modifies node_modules (tracked via committed patch file) and adds optional parameters to existing internal call paths.

## Self-Check: PASSED

- `patches/gbrain+3933eb6.patch` exists: FOUND
- `scripts/apply-gbrain-patch.js` exists: FOUND
- Commit 08ae622 exists: FOUND
- Commit bbc2b0b exists: FOUND
- `bun x tsc --noEmit`: exits 0 (verified above)
