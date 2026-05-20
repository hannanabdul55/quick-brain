---
phase: 03-insight-cards-demo-readiness
plan: 04
subsystem: reset-flow
tags: [demo, reset, abort-tracker, press-and-hold, panic-reset]
dependency_graph:
  requires: [03-02, 03-03]
  provides: [reset-endpoint, abort-tracker, reset-button, panic-reset-script]
  affects: [lib/gbrain, app/api/tenants, components/insights, scripts]
tech_stack:
  added: []
  patterns: [abort-controller-registry, press-and-hold-raf, pointer-capture, fs-cp-rm-reset]
key_files:
  created:
    - lib/gbrain/abort-tracker.ts
    - app/api/tenants/[id]/reset/route.ts
    - components/insights/reset-button.tsx
    - scripts/panic-reset.sh
  modified:
    - components/insights/insight-cards-row.tsx
    - package.json
decisions:
  - Reset proceeds outside the mutex — in-flight spawns may fail mid-reset (acceptable demo trade-off)
  - abort-tracker uses AbortController registry separate from withTenantLock to avoid deadlock
  - panic-reset.sh uses set -uo pipefail (not set -e) so pkill non-zero return does not abort the script
  - bun run seed excluded from panic-reset.sh — seed is pre-baked; operator restarts dev server only
metrics:
  duration: 3m
  completed: 2026-05-16T23:49:46Z
  tasks_completed: 3
  files_created: 4
  files_modified: 2
---

# Phase 03 Plan 04: Reset Path End-to-End Summary

Reset flow built end-to-end: abort-controller registry + POST reset endpoint (rm -rf + cp -r seed) + 2s press-and-hold UI + terminal panic-reset script.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Abort tracker + reset Route Handler | 5d24e7c | lib/gbrain/abort-tracker.ts, app/api/tenants/[id]/reset/route.ts |
| 2 | Press-and-hold ResetButton + mount in InsightCardsRow | 25dd138 | components/insights/reset-button.tsx, components/insights/insight-cards-row.tsx |
| 3 | scripts/panic-reset.sh (terminal nuke) | 5cd390e | scripts/panic-reset.sh, package.json |

## Implementation Details

### Reset Endpoint Contract

`POST /api/tenants/[id]/reset` — measured duration on demo laptop: 0-2s typical (50MB cp -r completes well under 1s locally).

Response shape:
```json
{ "ok": true, "durationMs": 847, "abortedSpawns": 0 }
```

Error responses:
- 400 `{ error: "invalid_slug" }` — tenant id fails slug regex
- 403 `{ error: "cannot_reset_seed" }` — attempted reset of the seed tenant
- 404 `{ error: "tenant_not_found" }` — valid slug but no registered tenant
- 500 `{ error: "copy_failed" }` — fs.cp threw (seed dir missing)

Steps in order: slug validate → seed guard (403) → tenants.init() + get() (404) → abortTenant() → rm -rf brains/\<id\>/ → cp -r brains/seed/ brains/\<id\>/ → invalidate cache → upsert tenant → return 200.

### Abort Tracker Pattern

`lib/gbrain/abort-tracker.ts` — module-scoped `Map<tenantId, Set<AbortController>>`.

```typescript
registerAbortable(tenantId)   // → AbortController; lazy-init Set; caller calls unregisterAbortable in finally
unregisterAbortable(tenantId, ctrl)  // → removes controller; deletes Set if empty
abortTenant(tenantId)         // → signals all controllers for tenant; clears Set; returns count aborted
```

Smoke test verified: `abortTenant("a")` returns 2, both controllers `.aborted === true`, unrelated tenant "b" controller untouched.

**Deliberate trade-off:** Reset proceeds OUTSIDE the `withTenantLock` mutex. An in-flight chat spawn may write to a brain dir that is about to be `rm -rf`'d. That spawn exits non-zero and the chat surface shows an error — acceptable demo behavior. The alternative (waiting for the mutex) could block reset for the full `timeoutMs` of a chat spawn.

### panic-reset.sh Script Duration + Behavior

Measured: 0s on the demo laptop (just process kills + one `rm -rf`).

Behavior in order:
1. `pkill -9 -f "next dev"` + `pkill -9 -f "next-server"` — kills Next.js dev server
2. `pkill -9 -f "gbrain "` + `pkill -9 -f "bun .*gbrain"` — kills orphaned gbrain spawns
3. `find brains/ -mindepth 1 -maxdepth 1 -type d -print0` loop — rm -rf every dir except `seed`
4. Prints completion time; tells operator to `bun run dev`

Does NOT run `bun run seed` or `gbrain init/import`. The seed brain is pre-baked.
`brains/seed/` is preserved on every run (verified by test: dummy tenant wiped, seed intact).

### Press-and-Hold UI (ResetButton)

- `onPointerDown` — captures pointer (`e.currentTarget.setPointerCapture`), records `Date.now()`, starts RAF loop
- RAF tick — `progress = Math.min(1, elapsed / 2000)` each frame; when `progress >= 1` cancels RAF and fires reset (does NOT depend on pointer-up)
- `onPointerUp` / `onPointerLeave` / `onPointerCancel` — if `firedRef.current` is false, resets all state without API call
- Visual feedback: absolute-positioned translucent white `<span>` fills left-to-right at `progress * 100%` width
- Label cycles: "Reset" → "Hold to reset…" → "Resetting…" → back to "Reset"
- After 200 OK: `onResetComplete?.()` (increments `reloadKey` in InsightCardsRow) + `router.refresh()` (reloads server component)
- Pointer capture ensures hold tracking survives dragging off the button on touch devices

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

None — the reset endpoint is gated by slug validation (400), seed guard (403), and tenant registry check (404). No new unauthenticated surface beyond what was already present in the tenant API.

## Self-Check: PASSED

Files created:
- lib/gbrain/abort-tracker.ts: EXISTS
- app/api/tenants/[id]/reset/route.ts: EXISTS
- components/insights/reset-button.tsx: EXISTS
- scripts/panic-reset.sh: EXISTS (executable)

Files modified:
- components/insights/insight-cards-row.tsx: ResetButton imported and mounted
- package.json: panic-reset script added

Commits:
- 5d24e7c: Task 1 — abort tracker + reset route handler
- 25dd138: Task 2 — ResetButton + InsightCardsRow update
- 5cd390e: Task 3 — panic-reset.sh + package.json

TypeScript: tsc --noEmit CLEAN
