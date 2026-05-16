---
phase: 02-onboarding-theater-chat
plan: 01
subsystem: ui
tags: [nextjs, react, tailwindcss, shadcn, typescript, app-router]

requires:
  - phase: 01-brain-spine-synthetic-seed
    provides: lib/gbrain/*.ts harness, package.json Phase 1 scripts (seed, demo-check, mutex-smoke, concurrent-smoke, detect-anomalies), tsconfig.json strict settings

provides:
  - Next.js 15 App Router scaffold layered over Phase 1 terminal-only codebase
  - shadcn/ui primitives: button, card, input, skeleton, scroll-area, badge in components/ui/
  - Landing page at / with "Start your business brain" CTA linking to /onboard (ONBD-01)
  - 3-field onboarding form skeleton at /onboard: businessName, businessType, ownerName (ONBD-02)
  - No auth/payment/api-key affordances anywhere (ONBD-08)
  - Merged tsconfig.json retaining Phase 1 strict+noUncheckedIndexedAccess+bun+@-alias alongside Next.js jsx/plugins
  - Merged package.json with both Phase 1 and Next.js scripts coexisting

affects: [02-02, 02-03, 02-04, phase-03-insights]

tech-stack:
  added:
    - next@15.5.18 (App Router)
    - react@19.2.6
    - react-dom@19.2.6
    - tailwindcss@4.3.0
    - "@tailwindcss/postcss@4.3.0"
    - shadcn (CLI, components copied into repo)
    - "@base-ui/react (via shadcn)"
    - class-variance-authority@0.7.1
    - clsx@2.1.1
    - tailwind-merge@3.6.0
    - lucide-react@1.16.0
    - tw-animate-css@1.4.0
  patterns:
    - "Hand-rolled Next.js scaffold (create-next-app refused non-empty dir — FALLBACK executed)"
    - "shadcn/ui Tailwind v4 pattern: @import tailwindcss + CSS custom properties in globals.css"
    - "RSC landing page — no use client; client boundary only at interactive forms"
    - "buttonVariants used with next/link for accessible CTA routing"
    - "Form name attributes use camelCase (businessName, businessType, ownerName) per plan spec"

key-files:
  created:
    - next.config.ts
    - postcss.config.mjs
    - eslint.config.mjs
    - next-env.d.ts
    - components.json
    - app/layout.tsx
    - app/page.tsx
    - app/globals.css
    - app/onboard/page.tsx
    - components/ui/button.tsx
    - components/ui/card.tsx
    - components/ui/input.tsx
    - components/ui/skeleton.tsx
    - components/ui/scroll-area.tsx
    - components/ui/badge.tsx
    - lib/utils.ts
  modified:
    - package.json (merged: added next/react/tailwind, kept Phase 1 scripts + zod)
    - tsconfig.json (merged: added jsx/incremental/allowJs/plugins[next]/app+components includes)
    - .gitignore (added next-env.d.ts, tsconfig.tsbuildinfo)
    - bun.lock (updated with new deps)

key-decisions:
  - "Hand-rolled Next.js scaffold instead of create-next-app — CLI refused non-empty directory; FALLBACK per environment_note"
  - "Used buttonVariants + Link instead of Button wrapper around Link — avoids base-ui/react button rendering inside an anchor"
  - "shadcn init -d produced base-nova style with @base-ui/react primitives (not Radix) — accepted as correct for shadcn 2026"
  - "tsconfig.json: kept allowImportingTsExtensions=true from Phase 1 alongside jsx=preserve for Next.js (noEmit=true makes this valid)"

patterns-established:
  - "Next.js App Router + Bun: run via bun run dev (delegates to next dev); Bun 1.3 fully compatible"
  - "shadcn components use @base-ui/react (not @radix-ui) in 2026 version — import paths differ from older docs"
  - "RSC pattern: /app/page.tsx is RSC (no use client), /app/onboard/page.tsx has use client as first line"
  - "Tailwind v4 CSS vars via @import tailwindcss + @theme inline block in globals.css"

requirements-completed:
  - ONBD-01
  - ONBD-02
  - ONBD-08

duration: ~5min
completed: 2026-05-16
---

# Phase 2 Plan 01: Next.js Scaffold + shadcn Primitives Summary

**Next.js 15 App Router with shadcn/ui (base-nova/Tailwind v4) scaffolded over Phase 1 terminal codebase; landing CTA at / and 3-field form skeleton at /onboard; zero auth/payment affordances**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-05-16T22:20:44Z
- **Completed:** 2026-05-16T22:25:38Z
- **Tasks:** 3/3
- **Files created:** 16, files modified: 4

## Accomplishments

- Hand-rolled Next.js 15 App Router scaffold (create-next-app refused non-empty dir; used FALLBACK path from environment_note); bun install installed 321 packages
- Merged package.json preserves all 5 Phase 1 scripts (seed, demo-check, detect-anomalies, concurrent-smoke, mutex-smoke) alongside Next.js scripts (dev, build, start, lint)
- Merged tsconfig.json retains Phase 1 strict/noUncheckedIndexedAccess/types:bun/@-alias; adds jsx/incremental/allowJs/plugins[next]; include covers lib/**/*.ts, scripts/**/*.ts, app/**/*.tsx, components/**/*.tsx
- shadcn/ui initialized with `bunx shadcn@latest init -d` (base-nova style, Tailwind v4, CSS vars); 6 primitives installed: button, card, input, skeleton, scroll-area, badge
- Landing page at / is RSC: "QuickBrain" headline + subhead + "Start your business brain" CTA using buttonVariants + next/link to /onboard
- /onboard form skeleton has 3 labeled inputs (businessName, businessType, ownerName); onSubmit is no-op console.log (real handler in Plan 04); zero auth/payment affordances
- bun run dev starts on :3000, both routes return 200, CTA and field names present in HTML; tsc --noEmit passes

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold Next.js 15 + merge with Phase 1** - `d128a93` (feat)
2. **Task 2: Initialize shadcn/ui and add primitive components** - `1ae3dc7` (feat)
3. **Task 3: Landing CTA + /onboard form skeleton** - `d7e5611` (feat)
4. **Cleanup: add tsconfig.tsbuildinfo to .gitignore** - `4b804f2` (chore)

## Files Created/Modified

- `app/page.tsx` - RSC landing with "Start your business brain" CTA; buttonVariants + next/link to /onboard
- `app/onboard/page.tsx` - Client component; 3-field form skeleton (businessName, businessType, ownerName); no-op submit handler
- `app/layout.tsx` - Root layout with Geist font, globals.css import
- `app/globals.css` - Tailwind v4 CSS vars + shadcn theme (@base-nova)
- `next.config.ts` - Minimal Next.js config
- `postcss.config.mjs` - Tailwind v4 PostCSS plugin
- `eslint.config.mjs` - next/core-web-vitals + next/typescript extends
- `next-env.d.ts` - Next.js type references (gitignored, regenerated by Next)
- `components.json` - shadcn config: base-nova style, rsc:true, tsx:true, @/components alias
- `lib/utils.ts` - cn() helper (clsx + tailwind-merge)
- `components/ui/button.tsx` - shadcn Button via @base-ui/react + buttonVariants cva
- `components/ui/card.tsx` - shadcn Card, CardHeader, CardContent, CardTitle, CardDescription, CardFooter
- `components/ui/input.tsx` - shadcn Input via @base-ui/react/input
- `components/ui/skeleton.tsx` - shadcn Skeleton (div with animate-pulse)
- `components/ui/scroll-area.tsx` - shadcn ScrollArea
- `components/ui/badge.tsx` - shadcn Badge + badgeVariants
- `package.json` - Merged: added next/react/react-dom/tailwindcss/shadcn-deps; kept Phase 1 scripts and zod
- `tsconfig.json` - Merged: Next.js jsx/incremental/plugins added; Phase 1 strict settings preserved
- `.gitignore` - Added next-env.d.ts, tsconfig.tsbuildinfo
- `bun.lock` - Updated with 321 packages

## Decisions Made

- **Hand-rolled over create-next-app FALLBACK:** `create-next-app@latest` refused to scaffold into the non-empty Phase 1 directory ("directory contains files that could conflict"). Executed the hand-roll fallback as specified in environment_note: wrote next.config.ts, postcss.config.mjs, eslint.config.mjs, next-env.d.ts, app/layout.tsx, app/page.tsx, app/globals.css manually; merged package.json and tsconfig.json; ran `bun install`. Result is identical to what create-next-app would have produced.
- **buttonVariants + Link pattern:** Used `<Link href="/onboard" className={cn(buttonVariants(...))}>` instead of wrapping shadcn Button around Link. The base-nova Button uses @base-ui/react/button which renders as a `<button>` element — wrapping it in a `<Link>` (which renders `<a>`) would nest interactive elements. The buttonVariants class approach is the correct pattern for accessible CTA links.
- **shadcn base-nova style:** The 2026 shadcn CLI defaults produced base-nova style (not "new-york" from older docs) using @base-ui/react primitives. Accepted as correct — the API surface matches the plan's shadcn component expectations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Hand-rolled Next.js scaffold instead of create-next-app**
- **Found during:** Task 1 (scaffold step)
- **Issue:** `bunx create-next-app@latest . --yes` refused to run in the non-empty Phase 1 directory: "directory contains files that could conflict"
- **Fix:** Executed the FALLBACK path specified in environment_note: hand-wrote all 7 scaffold files (next.config.ts, postcss.config.mjs, eslint.config.mjs, next-env.d.ts, app/layout.tsx, app/page.tsx, app/globals.css); merged package.json and tsconfig.json manually; ran `bun install`
- **Files modified:** package.json, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs, next-env.d.ts, app/layout.tsx, app/page.tsx, app/globals.css
- **Verification:** `bun run dev` returns 200; `bunx tsc --noEmit` passes
- **Committed in:** d128a93 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — FALLBACK path specified in plan)
**Impact on plan:** The FALLBACK was explicitly documented in the environment_note. No scope creep. Output is equivalent to what create-next-app would have produced.

## Known Stubs

- `app/onboard/page.tsx` onSubmit handler: `event.preventDefault(); console.log(formData)` — intentional no-op per plan spec. Real submit logic (POST /api/tenants + SSE onboarding stream) lands in Plan 04.

## Issues Encountered

None beyond the create-next-app conflict (handled via FALLBACK, documented as deviation above).

## Next Phase Readiness

- Wave 2 (Plans 02-03): Route handlers at `app/api/tenants/` can now be created; `@/lib/gbrain` imports will resolve correctly via the @/* alias; all Next.js Route Handler patterns available
- Wave 3 (Plan 04): Form submit wiring to POST /api/tenants + SSE EventSource consumption ready to implement; onboard page stub at app/onboard/page.tsx is the target for enhancement
- Wave 4 (dashboard): components/ui/scroll-area and components/ui/skeleton are pre-installed and ready for chat surface
- Phase 1 lib/gbrain/* remains untouched and importable via @/lib/gbrain from any Route Handler

---
*Phase: 02-onboarding-theater-chat*
*Completed: 2026-05-16*
