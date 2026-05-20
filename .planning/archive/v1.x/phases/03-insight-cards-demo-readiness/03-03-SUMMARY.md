---
phase: 03-insight-cards-demo-readiness
plan: 03
subsystem: ui
tags: [typescript, react, shadcn, insight-cards, sse, client-component]

# Dependency graph
requires:
  - phase: 03-insight-cards-demo-readiness
    plan: 01
    provides: lib/insights/types.ts — InsightBundle, TopVendorRow, PnlSnapshot, AnomalyRow
  - phase: 02-onboarding-theater-chat
    provides: app/dash/[id]/page.tsx, components/chat/chat-surface.tsx, components/ui/* primitives
affects:
  - 03-02 (shares the /api/tenants/[id]/insights endpoint this plan's client fetches)
  - 03-04 (reset button will sit in the same dashboard page)
provides:
  - components/insights/insight-card.tsx — InsightCard shell with loading/data/error states + label badge
  - components/insights/top-vendors-card.tsx — Top 5 vendors card consuming TopVendorRow[]
  - components/insights/pnl-card.tsx — Monthly P&L snapshot card consuming PnlSnapshot
  - components/insights/anomalies-card.tsx — 3 anomaly rows with dollar impact + View source links
  - components/insights/insight-cards-row.tsx — client component fetching /insights once + distributing to 3 cards
  - app/dash/[id]/page.tsx — extended to mount InsightCardsRow above ChatSurface

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "InsightCard discriminated union state machine: loading | data | error"
    - "Single batch fetch from InsightCardsRow with reloadKey-driven retry"
    - "shadcn Card + Badge + Skeleton + Button composition pattern"
    - "Client component receiving tenantId prop, server component dashboard page unchanged"

key-files:
  created:
    - components/insights/insight-card.tsx
    - components/insights/top-vendors-card.tsx
    - components/insights/pnl-card.tsx
    - components/insights/anomalies-card.tsx
    - components/insights/insight-cards-row.tsx
  modified:
    - app/dash/[id]/page.tsx

key-decisions:
  - "InsightCardsRow fetches a single batch endpoint (not 3 separate requests) — simpler retry semantics"
  - "Single reloadKey state drives retry for all 3 cards simultaneously — matches INSI-06 batch cache design"
  - "AbortController used in useEffect cleanup to prevent stale state on fast tenantId changes"
  - "View source link uses /source?path=encodeURIComponent(sourcePath) — visibly present per INSI-04"

requirements-completed:
  - INSI-01
  - INSI-02
  - INSI-03
  - INSI-04
  - INSI-05

# Metrics
duration: ~12min
completed: 2026-05-16T23:41:47Z
---

# Phase 3 Plan 03: Insight Cards UI Summary

**Three shadcn-based insight cards (Top Vendors / P&L / Anomalies) wired to /api/tenants/[id]/insights with loading-skeleton → data → error+retry state machine; mounted above the existing ChatSurface in the dashboard**

## Performance

- **Duration:** ~12 min (including merge of Wave 1 plan 03-01 into worktree)
- **Started:** 2026-05-16T23:37:55Z
- **Completed:** 2026-05-16T23:41:47Z
- **Tasks:** 2 completed
- **Files modified:** 6 (5 created + 1 modified)

## Accomplishments

- `InsightCard` shell handles loading (3 Skeleton rows), data (pass-through node), and error (red text + Retry button) states via a discriminated union prop
- `TopVendorsCard` renders 5 vendor rows with spend ($X,XXX.XX) and invoice count, label "from graph"
- `PnlCard` renders Revenue/COGS/Opex/Net with prev-month delta line, label "from timeline"
- `AnomaliesCard` renders 3 anomaly rows with vendor slug, dollar impact, plain-English description, and "View source →" link per row, label "from skill: recurring-charges"
- `InsightCardsRow` fetches `/api/tenants/[id]/insights` once on mount, maps the single RowState to all 3 cards' local states; retry increments `reloadKey` to re-trigger the effect
- `app/dash/[id]/page.tsx` extended with a React fragment mounting `<InsightCardsRow tenantId={tenant.id} />` above the existing `<ChatSurface>`
- All Phase 2 invariants preserved: `tenants.init()` awaited, `notFound()` branches intact, dashboard remains a Server Component, ChatSurface props unchanged

## Task Commits

Each task was committed atomically:

1. **Task 1: InsightCard shell + TopVendorsCard + PnlCard + AnomaliesCard** - `6ddb2f5` (feat)
2. **Task 2: InsightCardsRow client component + dashboard mount** - `a1f40f7` (feat)

## Card Component Shapes

### InsightCard (shell)
```typescript
type InsightCardState =
  | { kind: "loading" }
  | { kind: "data"; node: React.ReactNode }
  | { kind: "error"; message: string; onRetry: () => void }

interface InsightCardProps {
  title: string
  label: string   // "from graph" | "from timeline" | "from skill: recurring-charges"
  state: InsightCardState
}
```
Renders a shadcn `<Card>` with `<CardHeader>` containing the title and a `<Badge variant="secondary">` label beneath it, and `<CardContent>` conditionally rendering Skeleton rows / data node / error banner.

### InsightCardsRow state machine
Single `RowState` (`loading | data | error`) drives all 3 cards simultaneously. A `reloadKey` integer incremented by `handleRetry()` re-triggers the `useEffect` fetch. `AbortController` cleans up on unmount or `tenantId`/`reloadKey` change.

## Dashboard Extension

```tsx
// app/dash/[id]/page.tsx — change summary
// BEFORE:
return <ChatSurface tenantId={tenant.id} businessName={tenant.id} />

// AFTER:
return (
  <>
    <InsightCardsRow tenantId={tenant.id} />
    <ChatSurface tenantId={tenant.id} businessName={tenant.id} />
  </>
)
```

The `InsightCardsRow` renders as a 3-column grid (`grid-cols-1 md:grid-cols-3`) `max-w-3xl mx-auto` matching the ChatSurface container width.

## Deviations from Plan

### Worktree Missing Wave 1 Artifacts

- **Found during:** Plan start (Task 1 setup)
- **Issue:** The worktree branch (`worktree-agent-a8fb42502c48e3ce0`) was at commit `dad431e` (Phase 2 close), predating the 03-01 plan merge (`94e625a`). `lib/insights/` and the planning files did not exist in the worktree.
- **Fix:** Ran `git merge main --no-edit` (fast-forward) to bring the Wave 1 artifacts into the worktree. This is expected for Wave 2 executors that depend on Wave 1 merges.
- **Files added via merge:** All 7 `lib/insights/*.ts` files + planning files from 03-01 through 03-05

### Live E2E Check Skipped (Worktree Brains Directory)

- **Found during:** Task 2 verification
- **Issue:** The plan's automated verify step starts `bun run dev` and curls `/dash/seed`. The worktree's `brains/` directory only contains `.gitkeep` — the `brains/seed/` brain directory exists in the main repo filesystem, not the worktree. The server correctly returns 404 (tenant not found) when the `brains/seed/` directory is absent from `process.cwd()/brains/`.
- **Impact:** The live curl check could not verify card titles in rendered HTML. TypeScript type-checking + static grep verification confirms all required strings and patterns.
- **Alternative verification:**
  - `bunx tsc --noEmit` returned zero errors across all 5 component files and the modified dashboard page
  - `grep -q '"from graph"'` — PASS
  - `grep -q '"from timeline"'` — PASS
  - `grep -q '"from skill: recurring-charges"'` — PASS
  - `grep -q 'View source'` — PASS
  - `grep -q 'Retry'` — PASS
  - `grep -q 'InsightCardsRow' app/dash/[id]/page.tsx` — PASS
  - `grep -q 'ChatSurface' app/dash/[id]/page.tsx` — PASS
  - `grep -q 'tenants.init()' app/dash/[id]/page.tsx` — PASS
  - `grep -q 'fetch.*tenants.*insights' components/insights/insight-cards-row.tsx` — PASS
  - `grep -rE 'spawn|gbrain' components/insights/` — zero matches (PASS)

## Known Stubs

None. All data in the cards flows from the `/api/tenants/[id]/insights` endpoint (plan 03-02). The cards correctly show skeleton loading state until the API responds.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. The client-side fetch to `/api/tenants/[id]/insights` uses an already-defined API surface (plan 03-02).

---
*Phase: 03-insight-cards-demo-readiness*
*Completed: 2026-05-16*
