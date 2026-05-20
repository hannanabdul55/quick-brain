# Phase 2: Onboarding Theater + Chat - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Autonomous smart discuss (per user request — no per-area approval prompts)

<domain>
## Phase Boundary

A non-technical operator lands on `/`, fills a 3-field form, watches a 30–45s narrated SSE onboarding stream (with one real `gbrain query` warm-up call), arrives at `/dash/<tenantId>` within 60s total, sees 3 suggested-question chips, clicks one, and gets a real gbrain-synthesized markdown answer with citations within ~30s. The chat surface handles slow/failed queries with a graceful inline error message.

**In scope (14 reqs — ONBD-01..08, CHAT-01..06):**
- Next.js 15 App Router scaffold (greenfield — Phase 1 was terminal-only)
- shadcn/ui primitives + Tailwind v4
- `/` landing page with "Start your business brain" CTA
- `/onboard` 3-field form (business name, business type, owner name) + zod validation
- `POST /api/tenants` Route Handler: zod-validate, `cp -r brains/seed/ brains/<id>/`, register in `lib/gbrain/tenants.ts` Map
- `GET /api/tenants/<id>/onboard` SSE Route Handler — 5-stage narrated stream, ≥1 real `gbrain query` warm-up
- `/dash/<id>` dashboard chrome with 3 suggested-question chips + chat surface
- `POST /api/tenants/<id>/chat` SSE Route Handler — spawns `gbrain query --no-expand` via mutex, streams single final markdown response, 30s SIGKILL on timeout
- `react-markdown + remark-gfm` for rendering gbrain answers (citations as inline text)
- Per CHAT-05, system-prompt-style guidance: prefer "I don't have data on that" over guessing (passed via gbrain config or query env if supported; otherwise no-op until v0.36 ships system-prompt overrides)

**Out of scope (Phase 3):** insight cards, reset button, panic-reset script, demo doc, persistence beyond in-memory.

</domain>

<decisions>
## Implementation Decisions

### Next.js Scaffold + Project Shell
- Scaffold via `bunx create-next-app . --use-bun --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"` accepting defaults non-interactively. NOT hand-rolled.
- `bunx shadcn@latest init -d` then `bunx shadcn@latest add card input button skeleton scroll-area badge` — primitives only, no kitchen-sink.
- Route Handlers in `app/api/...`. Domain logic in `lib/onboarding/`, `lib/chat/` (Next.js-agnostic; importable in tests).
- Keep create-next-app's ESLint defaults. No Prettier, no Husky.

### Onboarding Choreography (30–45s total, 5 stages, ≥1 real gbrain call per ONBD-05)
- Stage durations: **5s / 12s / 10s / 8s / 1s = ~36s total** (within 30–45s budget).
  1. "Creating your brain" (5s) — real `cp -r brains/seed/ brains/<id>/` (typically <1s; pad with progress text).
  2. "Reading your invoices and emails" (12s) — paced text only; brain is already imported.
  3. "Building the knowledge graph" (10s) — paced text + parallel-launches a real `gbrain query --no-expand "Top vendors by total spend?"` warm-up call. The query result is discarded; we just want PGLite buffer warmth + Anthropic prompt cache.
  4. "Indexing for search" (8s) — paced text; the warm-up call typically completes during this stage.
  5. "Ready" (1s) — emit `event: done\ndata: {"tenantId":"..."}` so the client redirects to `/dash/<tenantId>`.
- SSE event format: typed events. `event: stage\ndata: {"stage":"indexing","label":"Indexing for search","progress":0.7}\n\n` for progress; `event: done\ndata: {"tenantId":"..."}` for completion; `event: error\ndata: {"stage":"...","message":"..."}` for failure.
- Failure handling: if `cp -r` fails or warm-up throws, emit `event: error` then close. Client renders an inline red banner with "Try again" button that resets the form. No retry-in-place — keep the demo deterministic.

### Chat Surface UX
- **Streaming UX:** Skeleton + "Mara's brain is thinking…" + animated dots while gbrain query is in flight. NO client-side typewriter (gbrain query is single-response per CLAUDE.md). When markdown arrives, render it in one paint.
- **Markdown rendering:** `react-markdown + remark-gfm`. Citations `[Source: companies/beanstalk-roasters]` stay as inline text in Phase 2; Phase 3 (stretch) can linkify them.
- **Message list:** plain `<ScrollArea>` from shadcn, no virtualization (max ~5 messages per demo session).
- **Timeout/error UX (CHAT-06):** server uses `lib/gbrain/client.ts` `spawnGBrain` with `timeoutMs: 30_000` (already supported); on timeout, SIGKILL fires, SSE emits `event: error\ndata: {"message":"That one's running slow — try again or pick a suggested question"}`, client renders the message as a system-style red banner with retry button.
- **Suggested chips (CHAT-04):** exactly 3, hardcoded:
  1. "What was weird about last month?"
  2. "Who are my top 5 vendors and how much did I pay each?"
  3. "What am I paying for every month that I shouldn't be?"
- **"I don't have data" prompting (CHAT-05):** pass via a `--system-prompt` flag if gbrain supports it, else accept as a known gap (the dataset is fully scoped to Mara's Coffee — out-of-scope questions are rare in demo).

### Performance Tuning (UPDATED 2026-05-16 after Phase 1 #4 retest)

**Critical insight from Phase 1 closeout:** `gbrain query` is **hybrid retrieval only — it does NOT synthesize**. The chat surface needs `gbrain think` for answer synthesis. Additionally, `gbrain think` defaults to Opus (`tier: 'deep'`) which hangs minute-scale on demo-class queries. The locked decision:

- **Chat answer synthesis (CHAT-02):** `spawnGBrain(["think", question, "--model", "haiku"], { tenantId, timeoutMs: 30_000 })`. Returns markdown with `[dir/slug]` citations in ~30s using `claude-haiku-4-5-20251001`. Verified working in Phase 1 #4 retest.
- **Onboarding warm-up (ONBD-05):** `spawnGBrain(["query", "Top vendors by total spend?", "--no-expand"], { tenantId, timeoutMs: 25_000 })`. Hybrid retrieval only (no Anthropic call), warms PGLite buffer + page cache. Fast (~1-3s).
- **`gbrain config set models.default sonnet`** in seed.sh stays as-is but is essentially cosmetic — `think --model haiku` is the per-call override.
- The `lib/gbrain/index.ts` `query()` helper from Phase 1 should be augmented with a new `think(tenantId, question, opts)` helper that defaults to `--model haiku`. Both call `spawnGBrain` directly.

### Claude's Discretion
- Exact Tailwind classes, component composition, color palette (within shadcn defaults).
- Internal structure of `lib/onboarding/orchestrator.ts` (just needs to satisfy ONBD-04, ONBD-05).
- Whether to use React Server Components for landing (`/`) or keep it a client component (likely RSC since no interactivity).
- Form library (raw HTML form vs. react-hook-form). Default: raw HTML form + manual handleSubmit, since the form is 3 fields. zod schema is on the server.
- Where exactly to put the suggested-chip click handler (component-level vs. hook).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `lib/gbrain/client.ts` — `spawnGBrain(args, opts)` with env injection, mutex queue, typed errors. Returns `{code, stdout, stderr}`. Already has 30s timeout support via `opts.timeoutMs`.
- `lib/gbrain/index.ts` — exports `query(tenantId, question, opts)` convenience helper; the default `timeoutMs: 30_000` is hard-coded but overridable. **Caveat:** the helper uses `gbrain query` WITHOUT `--no-expand`, which makes it too slow for the chat surface. Phase 2 should either patch the helper to add `--no-expand` by default OR call `spawnGBrain(["query", question, "--no-expand"], opts)` directly.
- `lib/gbrain/mutex.ts` — per-tenant Promise queue; safe to use directly from Route Handlers.
- `lib/gbrain/tenants.ts` — in-memory `Map<tenantId, TenantRecord>` with `init()`, `reload()`, `get()`, `list()`, `upsert()`, `remove()`. Phase 2 routes call `init()` at module load.
- `lib/gbrain/slug.ts` — `tenantSlugSchema` zod schema + `assertTenantSlug()` for input validation.
- `lib/gbrain/onboard.ts` — pre-built reusable orchestrator with `Phase` type (`"init" | "config" | "import" | "embed" | "warmup" | "done"`) and `ProgressEvent` type. Wraps the seed pipeline with progress callbacks — **Phase 2's `/api/tenants/<id>/onboard` SSE route consumes this directly**. Saves ~1h of plumbing.
- `lib/gbrain/paths.ts` — `BRAINS_ROOT`, `brainHome(id)`, `SEED_TENANT_ID`, `seedBrainHome()`.

### Established Patterns
- Bun runtime for everything (incl. Next.js dev server via `bun run dev`).
- TypeScript strict + `noUncheckedIndexedAccess` (`tsconfig.json`).
- Path-prefixed wikilinks (`[[dir/slug]]`) — applies if Phase 2 emits any markdown.
- Spawning gbrain CLI via `node:child_process.spawn` through the per-tenant mutex.
- ISO 8601 dates in any frontmatter.

### Integration Points
- `lib/onboarding/orchestrator.ts` (new) — wraps `lib/gbrain/onboard.ts` or replaces it. Drives the 5-stage SSE flow.
- `app/api/tenants/route.ts` (new) — POST handler that creates a tenant (cp -r + tenants.upsert).
- `app/api/tenants/[id]/onboard/route.ts` (new) — GET handler that returns an SSE stream.
- `app/api/tenants/[id]/chat/route.ts` (new) — POST handler that returns an SSE stream with the gbrain query response.
- `app/page.tsx` (replaces create-next-app default) — landing CTA.
- `app/onboard/page.tsx` (new) — 3-field form.
- `app/dash/[id]/page.tsx` (new) — dashboard chrome.
- `components/chat/*` (new) — message list, input, suggested chips.

</code_context>

<specifics>
## Specific Ideas

- Persona surface: keep Mara/Mara's Coffee invisible in the UI — the form lets the operator type their own business name. The seed brain is already populated with Mara's data; we copy it to the new tenant slug regardless of what the form says. (The synthetic data is the truth; the operator's input is theater for the prize narrative "non-technical owner spins up a brain.")

- **Tenant ID derivation:** Slugify business name input via `lib/gbrain/slug.ts` `tenantSlugSchema`. Collisions handled by appending `-2`, `-3`, etc. Hold tenants in memory (HARN-05), no DB.

- **Demo-time tenant cleanup:** Phase 3 will add a reset path. Phase 2 just creates tenants; we don't need to delete them mid-session.

- **API key requirements:** Both keys are now set in `~/.zshenv`. The Next.js dev server inherits env via `bun run dev` from a shell that sourced `.zshenv`. Document this in README's "Run the demo" section.

- **Browser SSE quirks:** Next.js 15 App Router's Route Handlers return a `Response(new ReadableStream(...), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" } })`. Client uses native `EventSource`. Note: EventSource only supports GET — for chat POST, use `fetch` with manual stream reader instead.

- **No tests in Phase 2** — the manual smoke gate is "operator clicks through the full flow." Phase 3's demo-readiness verification (3 back-to-back runs) is the regression net.

- **Visual style:** clean, neutral, "looks like a SaaS" — shadcn defaults. No custom colors. One headline font ("font-bold tracking-tight"), body is shadcn default sans. Buttons are shadcn `<Button>` default + `variant="default"`.

</specifics>

<deferred>
## Deferred Ideas

- **CHAT-07 (vendor name linkification → side panel):** v2 stretch in REQUIREMENTS.md.
- **CHAT-08 ("Behind the scenes" expandable showing gbrain query payload + citations):** v2 stretch.
- **CHAT-09 (typewriter visual):** v2 stretch + explicitly skipped per CLAUDE.md.
- **DATA-12 (4th planted anomaly):** v2 stretch.
- **Multi-tenant routing UX:** out of scope (single-session demo).
- **Persistence across page refreshes:** out of scope; refreshing `/dash/<id>` re-fetches but chat history is in-memory only.
- **Mobile responsive:** out of scope per PROJECT.md (demo runs on the operator's laptop).
- **Auth:** out of scope.

</deferred>
