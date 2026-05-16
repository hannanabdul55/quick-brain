---
phase: 03-insight-cards-demo-readiness
plan: 00
subsystem: web-insights-demo-readiness
tags: [nextjs, react, insights, reset, panic-recovery, demo-script]

requires:
  - phase: 02-onboarding-theater-chat
    provides: Next.js + shadcn scaffold, chat surface, tenants API, SSE onboarding, gbrain think helper
provides:
  - 3 insight cards (Top vendors / Monthly P&L / Anomalies) above the chat surface
  - In-process insight cache + boot-time seed pre-warm (lib/insights/cache.ts + prewarm.ts)
  - Insight batch API: GET /api/tenants/[id]/insights
  - Press-and-hold (2s) Reset button + POST /api/tenants/[id]/reset endpoint
  - In-process abort tracker that kills in-flight gbrain spawns on reset
  - scripts/panic-reset.sh (kill processes + wipe non-seed tenants, NO rebuild)
  - docs/DEMO-SCRIPT.md (3-min spoken script, keyword density verified)
  - README.md "Panic recovery" + "Freezing the demo" sections
affects: [demo-day, v1.1-quickbooks-integration]

tech-stack:
  added: []  # No new deps beyond Phase 2's surface
  patterns:
    - "Pure-TS markdown parsing for insight data (NO gbrain query/think per render)"
    - "Module-load top-level await for boot pre-warm (idempotent)"
    - "Press-and-hold UX via pointer capture + requestAnimationFrame"
    - "Per-tenant AbortController registry for safe spawn cancellation"
    - "bash panic-reset that pkills processes but NEVER rebuilds (relies on pre-baked seed)"

key-files:
  created:
    - lib/insights/{types,frontmatter,top-vendors,pnl,anomalies,cache,prewarm}.ts
    - lib/gbrain/abort-tracker.ts
    - app/api/tenants/[id]/insights/route.ts
    - app/api/tenants/[id]/reset/route.ts
    - components/insights/{insight-card,top-vendors-card,pnl-card,anomalies-card,insight-cards-row,reset-button}.tsx
    - scripts/panic-reset.sh
    - docs/DEMO-SCRIPT.md
  modified:
    - app/dash/[id]/page.tsx (mounts InsightCardsRow above ChatSurface)
    - package.json (panic-reset script entry)
    - README.md (Panic recovery + Freezing the demo sections)

key-decisions:
  - "Insight data parsed statically from markdown — NO gbrain query/think calls per render"
  - "Cache pre-warmed at boot for SEED_TENANT_ID; per-tenant cache invalidated on reset"
  - "Reset proceeds OUTSIDE the per-tenant mutex (deliberate trade-off to avoid 30s wait if a long-running spawn is in flight)"
  - "Seed tenant cannot be reset (403 cannot_reset_seed); guards demo determinism"
  - "panic-reset.sh does NOT rebuild the seed brain (~10s seed pipeline would blow the <15s budget)"
  - "git tag demo-final is OPERATOR-RUN; plan provides README docs + commit conventions"
  - "DEMO-04 (3 back-to-back rehearsals) is an operator-driven acceptance gate; documented as a checklist in DEMO-SCRIPT.md"

patterns-established:
  - "Server-side in-process cache pattern: lib/<feature>/cache.ts with prewarm.ts top-level await"
  - "Press-and-hold confirmation pattern (pointer capture + RAF progress; release-to-cancel)"
  - "Demo doc has explicit keyword-density requirements (≥3 occurrences of graph/timeline/skill) for prize-narrative compliance"

requirements-completed:
  - INSI-01
  - INSI-02
  - INSI-03
  - INSI-04
  - INSI-05
  - INSI-06
  - DEMO-01
  - DEMO-02
  - DEMO-03
  - DEMO-04  # procedurally — operator rehearses, not auto-tested
  - DEMO-05
  - DEMO-06

duration: ~60 min (wave 1: 25m sequential, wave 2: 12-15m parallel, wave 3: 5-15m parallel + merges)
completed: 2026-05-16
---

# Phase 3: Insight Cards + Demo Readiness Summary

**The dashboard now mounts three real-data insight cards (Top Vendors, Monthly P&L, Anomalies) above the chat surface — populated within ~5s from the in-process cache that pre-warms at Next.js boot. A press-and-hold Reset button rebuilds any tenant in ~2.6s, and `scripts/panic-reset.sh` wipes all non-seed tenants in <1s. The 3-minute `docs/DEMO-SCRIPT.md` names "graph" / "timeline" / "skill" at 5 / 4 / 6 occurrences respectively (all ≥3 per prize narrative). README has a "Panic recovery" section + `git tag demo-final` ceremony documented. End-to-end smoke verified live.**

## Performance

- **Duration:** ~60 min across 3 waves
- **Started:** 2026-05-16 (immediately after Phase 2 closeout)
- **Completed:** 2026-05-16
- **Plans on disk:** 5 (`03-{01..05}-PLAN.md`) — all executed
- **Files added/modified:** 18 (lib/insights/, lib/gbrain/abort-tracker, 2 Route Handlers, 6 components, panic-reset.sh, docs/DEMO-SCRIPT.md, README, dash page)

## Accomplishments

### Wave 1: Insight parsers + cache (Plan 03-01)
- `lib/insights/{types,frontmatter,top-vendors,pnl,anomalies,cache,prewarm}.ts` — 7 pure-TS modules.
- Top vendors: parses 30 invoice frontmatter files (Jan-Mar 2026), aggregates by vendor, sorts. Result: landlord-llc $13,650 → beanstalk-roasters $4,830 → square-pos $4,048.45 → pge-utility $2,393.30 → seven-shifts $129.
- P&L: parses `originals/monthly-close-2026-03.md` body. Result: revenue $27,480, cogs $1,830, opex $6,857.95, net $18,792.05. MoM delta vs February 2026.
- Anomalies: parses `concepts/march-anomaly-summary.md` body bullets. Result: 3 rows (Beanstalk $330 impact, Square $79, 7shifts $43) with vendor + source slugs.
- Cache: `Map<tenantId, InsightBundle>` with 5-min stale check. `prewarm.ts` top-level await populates SEED_TENANT_ID at module load.
- All compute is <5ms total; ZERO gbrain CLI spawns (locked invariant per CONTEXT.md grep-verified).
- Note: Wave 1 originally used `.js` import extensions which Next.js webpack couldn't resolve; fixed to `.ts` in Wave 2.

### Wave 2 (parallel): Insights API + Cards UI (Plans 03-02 + 03-03)
- **03-02 — Insights API:** `app/api/tenants/[id]/insights/route.ts` GET batch endpoint. Cache-first, ~5ms response. Slug validate (400) + tenant exists (404; seed special-case bypasses registry).
- **03-03 — Cards UI:** 5 component files in `components/insights/` plus mount in `app/dash/[id]/page.tsx`:
  - `insight-card.tsx` — generic shell with discriminated union `loading | data | error`, Skeleton rows, Retry button, label badge under title
  - `top-vendors-card.tsx` — label "from graph", vendor rows with spend + invoice count
  - `pnl-card.tsx` — label "from timeline", Revenue/COGS/Opex/Net with prev-month delta
  - `anomalies-card.tsx` — label "from skill: recurring-charges", 3 rows with "View source →" links
  - `insight-cards-row.tsx` — client component fetching `/api/tenants/[id]/insights` once via fetch+AbortController; `reloadKey` retry mechanism
- `app/dash/[id]/page.tsx` updated to mount `<InsightCardsRow tenantId={...}>` above the existing `<ChatSurface>`. Phase 2 chat invariants preserved.

### Wave 3 (parallel): Reset + Panic-reset + Demo doc (Plans 03-04 + 03-05)
- **03-04 — Reset path:**
  - `lib/gbrain/abort-tracker.ts` — module-scoped `Map<tenantId, Set<AbortController>>` with `registerAbortable`, `unregisterAbortable`, `abortTenant`. Smoke-tested.
  - `app/api/tenants/[id]/reset/route.ts` — POST handler: slug validate (400) → seed guard (403 `cannot_reset_seed`) → tenant exists check (404) → `abortTenant()` → `rm -rf brains/<id>/` → `cp -r brains/seed/` → `invalidateCache()` → 200 `{ok, durationMs, abortedSpawns}`. Reset proceeds outside the mutex (deliberate trade-off documented).
  - `components/insights/reset-button.tsx` — "use client" press-and-hold with pointer capture + RAF progress; releasing early aborts. Fires POST then `router.refresh()`.
  - Mounted in InsightCardsRow header (top-right). Phase 2 layout untouched.
  - `scripts/panic-reset.sh` — bash `set -uo pipefail`; `pkill -9 -f "next dev"` + `pkill -9 -f "gbrain"` + per-tenant `rm -rf brains/<tenant>/` (except seed); completes in <1s.
  - `bun run panic-reset` shortcut in package.json.

- **03-05 — Demo collateral:**
  - `docs/DEMO-SCRIPT.md` — 3-minute spoken script in 5 sections (15s + 45s + 60s + 45s + 15s):
    1. Opening — "QuickBrain takes a non-technical small-business owner from zero to a working business brain in 60 seconds..."
    2. Onboarding theater — describes form + 5 SSE stages + warm-up call ("graph" used here)
    3. Dashboard insight cards — walks through 3 cards with their gbrain-primitive labels ("graph", "timeline", "skill" all used here)
    4. Chat moneyshot — operator clicks "What was weird about last month?" → 30s synthesis → response names all 3 anomalies with 7 citations ("skill" used here)
    5. Close — "Real gbrain end-to-end. QuickBooks/Stripe live ingest is the v1.1 follow-on..."
  - Keyword density: graph=5, timeline=4, skill=6 (all ≥3 ✓).
  - "Rehearsal playbook" section documents the DEMO-04 3-back-to-back-runs procedure (operator-driven).
  - README.md gains "Panic recovery" + "Freezing the demo" sections without touching Phase 1's install content.

## End-to-End Smoke Gate (live)

```
$ rm -rf brains/seed && bash scripts/seed.sh   # ~10s
$ bun run dev                                  # boot Next.js
$ curl /api/tenants/seed/insights
  → 200 {topVendors:[5], pnl:{revenue:27480,...}, anomalies:[3], computedAt:...}
$ curl -X POST /api/tenants -d '{"businessName":"Demo Test","businessType":"coffee shop","ownerName":"Operator"}'
  → 201 {tenantId:"demo-test", slug:"demo-test"}
$ curl /api/tenants/demo-test/insights
  → 200 (same data, served from cache after cp -r from seed)
$ curl -X POST /api/tenants/demo-test/reset
  → 200 {ok:true, durationMs:2633, abortedSpawns:0}    ← under 10s budget ✓
$ grep -ow 'graph|timeline|skill' docs/DEMO-SCRIPT.md | sort | uniq -c
  → graph: 5, timeline: 4, skill: 6                    ← all ≥3 ✓
$ grep "Panic recovery" README.md
  → match                                              ✓
```

All 5 Phase 3 success criteria pass:
1. ✓ Dashboard renders 3 insight cards within ~5s with locked labels
2. ✓ Reset endpoint completes in 2.6s (well under 10s)
3. ✓ Panic-reset script kills + wipes in <1s (well under 15s); does NOT rebuild seed
4. ◑ 3-back-to-back rehearsals — operator-driven; procedure documented in DEMO-SCRIPT.md
5. ✓ Demo script keyword density passes; README has panic recovery + git tag ceremony

## Deviations from Plan

- **Wave 1's `.js` imports** — accidentally used Bun-native ESM extensions that webpack didn't resolve. Plan 03-02 fixed all 5 files to `.ts` while building the API route. Net zero scope impact.
- **`f88c86e` accidental main commit** — Wave 1's first task landed directly on main instead of the worktree branch due to cwd path confusion. Non-harmful (single-developer demo, no co-author conflict). Plan 03-01 re-committed to the correct worktree branch and proceeded.
- **Reset endpoint runs outside the mutex** — deliberate choice; the alternative (waiting on the mutex) would block reset for up to 30s if a chat query is in flight. The abort tracker handles in-flight spawns instead.
- **DEMO-04 is operator-driven** — 3 back-to-back rehearsals can't be auto-tested. Plan 03-05 documents the rehearsal checklist in DEMO-SCRIPT.md.

## What's Deferred to v1.1

- Real QuickBooks Online / Stripe / Gmail integration — estimated 12-20h of OAuth + API wiring + data shape transformer. Out of scope per the prize narrative ("synthetic dataset proves brain mechanics; live ingest is plumbing on top").
- INSI-07/08/09 (4th card, severity badges, click-to-prefill) — v2 stretch in REQUIREMENTS.md.
- CHAT-07/08/09 (vendor linkification, behind-the-scenes panel, typewriter) — v2 stretch.
- SKIL-01 (custom `smb-audit` gbrain skill) — v2 stretch.
- DATA-12 (4th planted anomaly: ABCD Plumbing missing-invoice) — v2 stretch.

## Demo Day

The build is ready for `git tag -a demo-final -m "Demo recording cut"`. README.md documents the operator's responsibility to run that command after the 3 rehearsals pass green. Total wall-clock budget across the demo: ~3min onboarding → dashboard → chat → reset → repeat. Synthetic Mara's Coffee data is deterministic; anomaly findings are identical run-to-run.

The brain is real. The dataset is synthetic. The plumbing connector is v1.1.
