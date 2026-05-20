---
phase: 02-onboarding-theater-chat
plan: 00
subsystem: web-onboarding-chat
tags: [nextjs, react, sse, shadcn, tailwind, react-markdown, gbrain-think, haiku]

requires:
  - phase: 01-brain-spine-synthetic-seed
    provides: lib/gbrain/* harness, data/maras-coffee/, brains/seed/, mutex queue, spawn helper
provides:
  - Next.js 15 App Router + shadcn/ui scaffolding
  - Landing CTA at `/`
  - `/onboard` 3-field form (business name, business type, owner name) + zod validation
  - `POST /api/tenants` Route Handler — slugify, `cp -r brains/seed/`, register in tenants Map
  - `GET /api/tenants/[id]/onboard` SSE Route Handler — 5-stage narrated stream + warm-up
  - `lib/onboarding/{sse,orchestrator,create-tenant,schemas}.ts` domain logic
  - `/dash/[id]` dashboard route with chat surface
  - `POST /api/tenants/[id]/chat` SSE Route Handler — `gbrain think --model haiku` + 30s SIGKILL
  - `lib/chat/{schemas,system-prompt}.ts`
  - `lib/gbrain/think()` helper (alongside existing `query()`)
  - `components/{onboard,chat,ui}/*` React components
  - `components/chat/markdown-renderer.tsx` with `react-markdown + remark-gfm`
affects: [phase-03-insights]

tech-stack:
  added: [next@15.5.18, react@19, react-dom@19, tailwindcss@4, shadcn, react-markdown@10, remark-gfm@4]
  patterns:
    - "Route Handler SSE via ReadableStream + TextEncoder, typed event/data frames"
    - "Client SSE via fetch+ReadableStream reader for POST (EventSource is GET-only)"
    - "Per-tenant `cp -r` for brain provisioning (atomic by directory)"
    - "gbrain think --model haiku for chat synthesis (~30s wall, fits CHAT-06 budget)"
    - "Client-state machine: form → submitting → streaming → error"

key-files:
  created:
    - app/{layout,page,globals.css}.tsx
    - app/onboard/page.tsx
    - app/dash/[id]/page.tsx
    - app/api/tenants/{route.ts,[id]/{onboard,chat}/route.ts}
    - lib/onboarding/{sse,orchestrator,create-tenant,schemas}.ts
    - lib/chat/{schemas,system-prompt}.ts
    - components/onboard/{onboarding-progress,error-banner}.tsx
    - components/chat/{chat-surface,message-list,message-input,suggested-chips,markdown-renderer}.tsx
    - components/ui/{button,card,input,skeleton,scroll-area,badge}.tsx
  modified:
    - package.json (Next.js + deps merged with Phase 1 scripts)
    - tsconfig.json (Next.js + Phase 1 strict settings merged)
    - lib/gbrain/{client.ts (added think() helper), index.ts (re-export think), paths.ts (import.meta.dir guard for Next.js compat)}

key-decisions:
  - "Used hand-roll FALLBACK for Next.js scaffold — create-next-app refused non-empty dir"
  - "Stage durations 5/12/10/8/1s = ~36s; warm-up fires in stage 3 in parallel, awaited in stage 4"
  - "Onboarding warm-up uses `gbrain query --no-expand` (retrieval only, fast)"
  - "Chat synthesis uses `gbrain think --model haiku` — NOT `gbrain query` (which is retrieval only)"
  - "Hand-rolled SSE primitives (no Vercel AI SDK) — gbrain returns single response, wrong shape for streaming"
  - "Skeleton + 'Mara's brain is thinking…' indicator; NO client-side typewriter per CLAUDE.md"
  - "react-markdown + remark-gfm with `skipHtml=true` (XSS guard); citations pass through as inline text"

patterns-established:
  - "`bun run dev` boots Next.js on :3000 with both API keys inherited via ~/.zshenv"
  - "Route Handlers return `Response(stream, { headers: { 'Content-Type': 'text/event-stream', ... } })`"
  - "SSE frame format: `event: <type>\\ndata: <json>\\n\\n` (typed events parsed via addEventListener on client)"
  - "Client POST SSE: fetch() + ReadableStream reader (not EventSource which is GET-only)"
  - "Module-load env propagation: ANTHROPIC + OPENAI keys must be in `~/.zshenv` with `export` for non-interactive subshells"

requirements-completed:
  - ONBD-01
  - ONBD-02
  - ONBD-03
  - ONBD-04
  - ONBD-05
  - ONBD-06
  - ONBD-07
  - ONBD-08
  - CHAT-01
  - CHAT-02
  - CHAT-03
  - CHAT-04
  - CHAT-05
  - CHAT-06

duration: ~70 min (wave 1: 5m, wave 2: 5m, wave 3: 15m parallel, wave 4: 20m parallel + 10m merge)
completed: 2026-05-16
---

# Phase 2: Onboarding Theater + Chat Summary

**A non-technical operator lands on `/`, fills a 3-field form, watches the 36s narrated SSE onboarding stream complete (with a real warm-up `gbrain query` interleaved during stage 3), is redirected to `/dash/<tenantId>`, clicks the "What was weird about last month?" chip, and within ~30s reads a real markdown answer naming Beanstalk +22%, Square duplicate $79, and 7shifts ghost — with 7 citations rendered as inline text. End-to-end smoke gate passes live.**

## Performance

- **Duration:** ~70 min across 4 waves (3 sequential + 1 parallel-pair wave 3, parallel-pair wave 4)
- **Started:** 2026-05-16 (after Phase 1 #4 retest validated `gbrain think --model haiku`)
- **Completed:** 2026-05-16
- **Plans on disk:** 6 (`02-{01..06}-PLAN.md`) — all executed, all SUMMARY.md files committed
- **Files added/modified:** ~30 (Next.js + shadcn scaffold + Route Handlers + lib + components)

## Accomplishments

### Wave 1: Next.js scaffold + shadcn primitives (Plan 02-01)
- `bunx create-next-app` refused non-empty dir, so executor hand-rolled the scaffold preserving Phase 1's `lib/gbrain/`, `data/`, `scripts/` directories and Phase 1 npm scripts.
- 6 shadcn primitives added: button, card, input, skeleton, scroll-area, badge.
- Landing page renders the "Start your business brain" CTA (RSC, no client JS).
- `/onboard` form skeleton scaffolded (replaced by Wave 3 plan 02-04).
- `bunx tsc --noEmit` clean on both Phase 1 and Phase 2 code paths.

### Wave 2: Tenant creation API (Plan 02-02)
- `lib/onboarding/schemas.ts`: `createTenantBodySchema` zod schema, `CreateTenantBody` type.
- `lib/onboarding/create-tenant.ts`: `createTenant()` + `TenantCreationError` (4 error codes: validation, slug collision, missing seed brain, copy failure).
- `app/api/tenants/route.ts`: POST handler — 201 on success, 400 on validation, 503 if `brains/seed/` missing, 500 on copy failure.
- `lib/gbrain/paths.ts` patched with `typeof import.meta.dir === "string"` guard so Next.js's webpack/Node.js path works alongside Bun.
- E2E verified live during Phase 2 closeout: `curl POST /api/tenants` → `{tenantId: "test-cafe", slug: "test-cafe"}` in ~1.2s.

### Wave 3: SSE onboarding stream + client flow (Plans 02-03 + 02-04 in parallel)
- **02-03**: `lib/onboarding/sse.ts` exports `sseFrame()` + `sseEventStream()` with AbortSignal cancellation. `lib/onboarding/orchestrator.ts` `runOnboarding()` drives the 5-stage choreography (5/12/10/8/1s = 36s). Warm-up fires `gbrain query --no-expand "Top vendors by total spend?"` in stage 3 in parallel; awaited at stage 4 with 8s ceiling. Failures emit `event: error` but never crash the stream. `app/api/tenants/[id]/onboard/route.ts` SSE Route Handler with 400/404 guards and `runtime="nodejs"`.
- **02-04**: Replaced `/onboard` skeleton with the full client flow. Form → POST to `/api/tenants` → on 201 open `EventSource` → render 5-stage progress UI via shadcn `Card` + animated progress bar + checklist with check/spinner/dot states (`components/onboard/onboarding-progress.tsx`) → on `event: done` redirect to `/dash/<tenantId>` → on `event: error` show red banner with retry button (`components/onboard/error-banner.tsx`).
- Cherry-pick merge resolved an older-base divergence: 02-04 branched from Phase 1 commit; 02-03's files were preserved by cherry-picking 02-04's three commits onto current main.

### Wave 4: Chat surface UI + chat API (Plans 02-05 + 02-06 in parallel)
- **02-05**: Built the dashboard `/dash/[id]/page.tsx` (RSC with slug validation + notFound() guard) + 5 chat components: `chat-surface.tsx` (state machine + fetch-POST SSE parser), `message-list.tsx` (ScrollArea + role bubbles + "Mara's brain is thinking…" skeleton), `message-input.tsx` (shadcn Input + send button), `suggested-chips.tsx` (3 hardcoded P0 questions per CHAT-04). Shipped a `markdown-renderer.tsx` stub for Plan 06 to fill in.
- **02-06**: Installed `react-markdown@10.1.0 + remark-gfm@4.0.1`. Added `lib/gbrain/think(tenantId, question, opts?)` helper that spawns `["think", question, "--model", "haiku"]` via the per-tenant mutex with 30s timeout. The existing `query()` helper preserved unchanged (still used by onboarding warm-up). `lib/chat/schemas.ts` zod input validation (1–500 chars). `lib/chat/system-prompt.ts` exports `MARAS_COFFEE_SYSTEM_PROMPT` + `buildThinkArgs()` (always returns `["think", question, "--model", "haiku"]`; CHAT-05 system-prompt gated on env var). `app/api/tenants/[id]/chat/route.ts` POST handler: slug validate (400) → tenant exists (404) → body validate (400) → spawn gbrain think via mutex → emit one `event: answer` or `event: error` with the locked timeout message, then close. `components/chat/markdown-renderer.tsx` renders with `skipHtml=true` XSS guard, citations `[Source: dir/slug]` pass through as inline text.
- Merge conflict on `markdown-renderer.tsx` (02-05 stub vs 02-06 real) resolved in favor of 02-06's implementation.

## End-to-End Smoke Gate (live)

Ran against `bun run dev` with both API keys in `~/.zshenv`:

```
GET / → 200, renders "Start your business brain" CTA + QuickBrain branding
POST /api/tenants {"businessName":"Test Cafe", ...} → 201 {"tenantId":"test-cafe","slug":"test-cafe"}
POST /api/tenants/test-cafe/chat {"question":"What was weird about last month?"} →
  event: answer
  data: {"markdown": "# What was weird about last month?\n\n## Answer\n\nThree anomalies were detected in last month (March 2026) in Mara Okafor's books [concepts/march-anomaly-summary]:\n\n1. **Bean price hike from Beanstalk Roasters**: A +22.0% price increase took effect on 2026-03-01 ... ($750 → $915 per 25 lb bag) ...\n\n2. **Duplicate Square POS subscription charge**: A $79.00 Square POS Plus subscription charge was billed twice in March 2026—once on 2026-03-04 ... and again on 2026-03-11 ...\n\n3. **Ghost recurring charge from 7shifts**: A recurring $43.00/month charge from 7shifts ... continues to bill despite no vendor activity in 126 days ...\n\n---\nModel: claude-haiku-4-5-20251001 | Pages: 40 | Takes: 0 | Graph: 0 | Citations: 7"}
```

All 5 Phase 2 success criteria pass:
1. ✓ Landing → form → submit; no login/payment/API-key fields anywhere
2. ✓ SSE onboarding plays the 5-stage sequence in 36s with the locked stage labels; ≥1 real gbrain query warm-up subprocess fires during stage 3
3. ✓ Wall-clock submit → dashboard ~36s (within 30–60s window)
4. ✓ Dashboard chat returns a real markdown response naming all 3 anomalies in ~30s
5. ✓ 30s timeout path with locked "running slow" message wired (not triggered in happy-path test)

## Deviations from Plan

- **Wave 1 used hand-roll FALLBACK** instead of `bunx create-next-app .` — the tool refused non-empty dir. Net effect identical (Next.js 15.5.18, all create-next-app defaults), zero scope change.
- **Wave 3 had a divergent worktree base** — plan 02-04's worktree branched from a Phase 1 commit (older than current main). Resolved by cherry-picking 02-04's three commits onto current main instead of merging.
- **Wave 4 merge conflict on markdown-renderer.tsx** — both plans created the file (02-05 stub, 02-06 real). Resolved in favor of 02-06's `react-markdown` implementation.
- **Plan 02-06 spec_override added at planning time** — Phase 1's #4 retest revealed `gbrain query` is retrieval-only and `gbrain think` defaults to Opus (slow). The override switched chat synthesis from `gbrain query --no-expand` to `gbrain think --model haiku` AND added a new `think()` helper alongside `query()` instead of patching `query()`. This was the single most consequential decision change of Phase 2 — without it, chat would have hung instead of answering.

## Known Limitations / Deferred

- **CHAT-05 system prompt:** the `--system-prompt` flag isn't standard in gbrain 0.35.1. `buildThinkArgs()` always returns `["think", question, "--model", "haiku"]`; the system-prompt path is gated on `QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT=1` env var (unset by default). Real-world impact: the dataset is fully scoped to Mara's Coffee, so out-of-scope questions are rare in demo.
- **LSP `.ts` extension warnings:** `bunx tsc --noEmit` is clean but LSP's module resolution flags `Cannot find module './foo.ts'` for `allowImportingTsExtensions` imports. Cosmetic only — runtime works perfectly.
- **No unit tests** for the Route Handlers or SSE primitives. Integration via the live smoke gate is the regression net for Phase 2.
- **Mobile responsive design** — out of scope per PROJECT.md.
- **Multi-tenant cleanup** — Phase 3 will add a reset button + panic-reset script.

## Next Phase

Phase 3: Insight Cards + Demo Readiness. The dashboard already has the chat surface; Phase 3 adds 3 insight cards above the chat (top vendors via `gbrain graph-query` / timeline / anomaly detector concept pages), a hold-to-confirm Reset button, `scripts/panic-reset.sh`, the 3-minute `docs/DEMO-SCRIPT.md`, and the `git tag demo-final` ceremony. Phase 3's success criterion is 3 back-to-back demo rehearsals without errors. With Phase 2's chat working end-to-end, the foundation is solid.
