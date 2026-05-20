---
phase: 02-onboarding-theater-chat
plan: 04
subsystem: ui
tags: [nextjs, react, client-component, sse, eventsource, state-machine, zod, shadcn, onboarding]

requires:
  - phase: 02-onboarding-theater-chat
    plan: 01
    provides: Next.js 15 App Router scaffold, shadcn primitives (Card, Button, Input, Skeleton), lib/utils.ts cn() helper
  - phase: 02-onboarding-theater-chat
    plan: 02
    provides: POST /api/tenants returning {tenantId, slug} on 201; lib/onboarding/schemas.ts createTenantBodySchema

provides:
  - app/onboard/page.tsx: full onboarding client flow — form + POST + SSE consumer + redirect (ONBD-02, ONBD-04, ONBD-06, ONBD-07, ONBD-08)
  - components/onboard/onboarding-progress.tsx: OnboardingProgress — Card with progress bar and 5-stage checklist
  - components/onboard/error-banner.tsx: ErrorBanner — red banner with message and retry callback

affects: [02-03, 02-05, phase-03-insights]

tech-stack:
  added: []
  patterns:
    - "useState state machine: 'form' | 'submitting' | 'streaming' | 'error' — drives all render branches"
    - "EventSource with typed addEventListener (stage/done/error) for SSE consumption"
    - "useRef to hold EventSource for cleanup in useEffect on unmount"
    - "Client-side zod safeParse before POST — gates submission, no server round-trip for empty fields"
    - "ALL_STAGES constant defined once in page.tsx, passed as prop to OnboardingProgress (no hardcoding in child)"
    - "ErrorBanner receives onRetry callback, resets page state to 'form' — no retry-in-place"

key-files:
  created:
    - components/onboard/onboarding-progress.tsx
    - components/onboard/error-banner.tsx
  modified:
    - app/onboard/page.tsx (replaced skeleton with full implementation)

key-decisions:
  - "EventSource only supports GET — client opens GET /api/tenants/<id>/onboard after POST returns 201; tenantId passed via URL path not body"
  - "Error handler on EventSource: e.data may be null for network-level errors (server unreachable), so parse is wrapped in try/catch with fallback message"
  - "Merged main into worktree branch (fast-forward) to pick up Wave 1 + 2 scaffold before implementing"
  - "ONBD-08 gate: grep confirms zero matches for api-key/password/sign-in/sign-up/payment/stripe/credit-card in page.tsx"
  - "E2E redirect testing deferred to Wave 3 merge — /api/tenants/<id>/onboard SSE route built by plan 02-03 in parallel"

requirements-completed: [ONBD-02, ONBD-04, ONBD-06, ONBD-07, ONBD-08]

duration: "~15 min"
started: "2026-05-16T22:55:00Z"
completed: "2026-05-16T23:10:00Z"
---

# Phase 2 Plan 04: Onboarding Client Flow Summary

**Full /onboard client: 4-state machine (form → submitting → streaming → error), zod-validated POST, EventSource SSE consumer with 5-stage progress bar, router.push on done, ErrorBanner with retry on error — ONBD-02/04/06/07/08 satisfied**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-16T22:55:00Z
- **Completed:** 2026-05-16T23:10:00Z
- **Tasks:** 2/2
- **Files modified:** 3

## Accomplishments

- Created `OnboardingProgress` client component — shadcn Card with animated progress bar (bg-neutral-200/900), 5-stage checklist using Loader2 spinner (current), checkmark (done), dot (pending)
- Created `ErrorBanner` client component — red-50/red-200/red-900 div with message text and shadcn outline Button calling onRetry
- Replaced `/onboard` skeleton with full state-machine page: submits JSON to `/api/tenants`, opens `EventSource` to `/api/tenants/<id>/onboard`, renders live progress, redirects to `/dash/<tenantId>` on `done`, shows retry banner on `error`
- All acceptance criteria verified: `tsc --noEmit` passes, dev server boots and serves `/onboard` with `businessName` field in HTML, no forbidden auth/payment terms

## Task Commits

1. **Task 1: Progress + ErrorBanner components** - `9c6e2b0` (feat)
2. **Task 2: Full onboard page — form, POST, EventSource, redirect** - `d299d79` (feat)

## Files Created/Modified

- `components/onboard/onboarding-progress.tsx` — OnboardingProgress: Card + progress bar + 5-stage checklist with check/spinner/dot per state
- `components/onboard/error-banner.tsx` — ErrorBanner: red banner with message + Try again button
- `app/onboard/page.tsx` — Full onboarding page with useState state machine, fetch POST, EventSource SSE, router.push redirect

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Merged main into worktree before implementing**
- **Found during:** Setup
- **Issue:** Worktree branch was at Phase 1 commit (d63dc2c) — missing Next.js scaffold, shadcn components, and Wave 2 API/schemas from main
- **Fix:** `git merge main --no-edit` fast-forwarded the worktree to Wave 2 tip (8f9caec) bringing in all scaffold files
- **Files modified:** All Wave 1 + Wave 2 files (app/, components/ui/, lib/onboarding/)
- **Commit:** (fast-forward merge, no separate commit)

None beyond the above.

## Known Stubs

None — all rendered data is driven by live EventSource events from the server (plan 02-03). The ALL_STAGES constant is pre-defined to match the locked stage list from 02-CONTEXT.md; no hardcoded placeholder data flows to the UI.

## E2E Deferred

- **Redirect test deferred:** `event: done → router.push('/dash/<tenantId>')` cannot be E2E-verified in isolation because `/api/tenants/<id>/onboard` SSE route is built concurrently by plan 02-03. Full redirect flow will be verified after Wave 3 merge.
- **404 at /dash/<tenantId>** is expected until plan 02-05 (dashboard chrome) is merged.

## Threat Flags

None — this plan adds only client-side UI (no new network endpoints, no server-side file access, no new auth paths). The POST to `/api/tenants` and EventSource to `/api/tenants/<id>/onboard` are existing routes from plans 02-02 and 02-03 respectively.

## Self-Check: PASSED

- `components/onboard/onboarding-progress.tsx` — FOUND
- `components/onboard/error-banner.tsx` — FOUND
- `app/onboard/page.tsx` — FOUND (modified)
- Task 1 commit `9c6e2b0` — FOUND
- Task 2 commit `d299d79` — FOUND
- `bunx tsc --noEmit` — PASSED (0 errors)
- Dev server `/onboard` renders `businessName` — PASSED
