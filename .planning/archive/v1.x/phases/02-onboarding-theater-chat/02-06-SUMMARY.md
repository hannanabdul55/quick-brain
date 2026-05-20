---
phase: 02-onboarding-theater-chat
plan: 06
subsystem: chat-backend
tags: [chat, gbrain, sse, react-markdown, think-command, markdown-renderer]
dependency_graph:
  requires: [02-02, 02-03]
  provides:
    - POST /api/tenants/[id]/chat SSE endpoint
    - MarkdownRenderer component (react-markdown + remark-gfm)
    - think() gbrain helper (gbrain think --model haiku)
    - chatQuestionSchema zod validation
    - MARAS_COFFEE_SYSTEM_PROMPT + buildThinkArgs() scaffold
  affects:
    - components/chat/markdown-renderer.tsx (plan 02-05 depends on this)
    - lib/gbrain/client.ts (new think() helper alongside query())
    - lib/gbrain/index.ts (re-exports think)
tech_stack:
  added:
    - react-markdown@10.1.0
    - remark-gfm@4.0.1
  patterns:
    - gbrain think --model haiku for LLM synthesis (per spec_override 2026-05-16)
    - SSE via sseEventStream + sseFrame (reusing plan 02-03 primitives)
    - Per-tenant mutex via spawnGBrain → withTenantLock (HARN-04)
    - Zod safeParse for all untrusted input (slug + JSON body)
key_files:
  created:
    - components/chat/markdown-renderer.tsx
    - lib/chat/schemas.ts
    - lib/chat/system-prompt.ts
    - app/api/tenants/[id]/chat/route.ts
  modified:
    - lib/gbrain/client.ts (added think() helper; query() unchanged)
    - lib/gbrain/index.ts (re-exports think)
    - package.json (react-markdown + remark-gfm added)
    - bun.lock (updated)
decisions:
  - "gbrain think --model haiku chosen over gbrain query for chat synthesis (spec_override 2026-05-16): query is retrieval-only, think does LLM synthesis; haiku avoids Opus minute-scale hangs"
  - "buildThinkArgs replaces buildQueryArgs per spec_override: always emits [think, question, --model, haiku]; system-prompt flag gated on QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT env var"
  - "think() helper added to lib/gbrain/client.ts without modifying query() — onboarding warm-up plan 02-03 still uses query() with --no-expand for retrieval-only behavior"
  - "skipHtml=true in MarkdownRenderer as XSS guard against raw HTML in gbrain output"
  - "Timeout message text locked per CONTEXT.md D-chat-ux: 'That one's running slow — try again or pick a suggested question'"
metrics:
  duration: "4 minutes"
  completed: "2026-05-16T22:49:58Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 4
---

# Phase 2 Plan 06: Chat Backend + Markdown Renderer Summary

**One-liner:** Chat SSE endpoint using `gbrain think --model haiku` with react-markdown renderer and XSS-safe citation pass-through.

## What Was Built

### Task 1: react-markdown + remark-gfm; MarkdownRenderer component

Installed `react-markdown@10.1.0` and `remark-gfm@4.0.1`. Created `components/chat/markdown-renderer.tsx` as a `"use client"` component:

- `<ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml={true}>` — GFM (tables, strikethrough, task lists) enabled; raw HTML disabled (XSS guard)
- Custom component overrides for `code`, `pre`, `a`, `p`, `ul`, `ol`, `h1/h2/h3`, `strong`, `blockquote`
- Citations like `[Source: companies/beanstalk-roasters]` pass through as inline text — ReactMarkdown treats brackets as plain text, not links
- No custom remark plugin for citations (CHAT-07 deferred to Phase 3)

### Task 2: think() helper + chat schemas + system-prompt scaffold

Per `spec_override` (2026-05-16 after Phase 1 #4 retest):

- Added `think(tenantId, question, opts?)` to `lib/gbrain/client.ts` — spawns `["think", question, "--model", "haiku"]` via `spawnGBrain`. Returns `GBrainResult` (not throws) so the caller can inspect code/stderr and emit the correct SSE frame.
- `query()` helper left completely untouched — plan 02-03's onboarding warm-up still uses it for retrieval-only behavior with `--no-expand`.
- Re-exported `think` from `lib/gbrain/index.ts`.
- Created `lib/chat/schemas.ts`: `chatQuestionSchema = z.object({ question: z.string().min(1).max(500) })`.
- Created `lib/chat/system-prompt.ts`: `MARAS_COFFEE_SYSTEM_PROMPT` (3-sentence instruction), `buildThinkArgs(question, model?)` always returns `["think", question, "--model", "haiku"]`. If `QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT=1`, prepends `--system-prompt` flag (CHAT-05 best-effort). One-time `console.warn` when system-prompt is disabled.

### Task 3: POST /api/tenants/[id]/chat SSE Route Handler

Created `app/api/tenants/[id]/chat/route.ts`:

1. Validate `[id]` via `tenantSlugSchema.safeParse` → 400 on invalid slug
2. `tenants.init()` + `tenants.get(tenantId)` → 404 if tenant not registered
3. Parse JSON body → 400 on malformed JSON; `chatQuestionSchema.safeParse` → 400 on validation failure
4. `buildThinkArgs(question)` → `["think", question, "--model", "haiku"]`
5. `spawnGBrain(args, { tenantId, timeoutMs: 30_000 })` — routes through per-tenant mutex (HARN-04)
6. On success (code 0): `write("answer", { markdown: result.stdout.trim() })`
7. On non-zero exit: `write("error", { message: TIMEOUT_MESSAGE, code, stderr })`
8. On timeout/SIGKILL exception: `write("error", { message: TIMEOUT_MESSAGE })`
9. Emits exactly one frame, then `sseEventStream` closes the stream
10. Logs `{ tenantId, questionLen, exitCode, durationMs }` — no question text (operator privacy)
11. `OPTIONS` handler returns 204 (defensive CORS preflight)
12. `runtime = "nodejs"`, `dynamic = "force-dynamic"`

## Deviations from Plan

### Auto-adaptations from spec_override (not deviations — plan-mandated substitutions)

**[spec_override] `buildQueryArgs` → `buildThinkArgs`**
- The spec_override explicitly renames this function throughout. Applied.
- `buildThinkArgs` returns `["think", question, "--model", "haiku"]` — not `["query", ..., "--no-expand"]`
- Route handler imports and calls `buildThinkArgs` from `@/lib/chat/system-prompt`

**[spec_override] `think()` added to `client.ts`, `query()` left unchanged**
- Plan task 2 had original text about patching `query()` to accept `{ expand?: boolean }`. Per spec_override: ADD `think()` instead. Done. `query()` is bit-for-bit identical to what it was before this plan.

**[spec_override] Acceptance greps use `--model haiku` and `think`, not `--no-expand`**
- All verified: `--model haiku` appears in `lib/gbrain/client.ts` and `lib/chat/system-prompt.ts`
- `think` appears as the command in `lib/gbrain/client.ts` and is referenced in `app/api/tenants/[id]/chat/route.ts` (indirectly via `buildThinkArgs`)

### Merge of main into worktree (infrastructure, not a code deviation)

The worktree branch `worktree-agent-a3d945e06040bd1fd` was created before Wave 2-4 merged to main. Before starting task work, merged `main` into the worktree via fast-forward (`git merge --no-edit main`). This brought in all Wave 1-4 changes (Next.js scaffold, SSE primitives, onboarding routes, chat UI shell stubs) needed to compile and test.

## Known Stubs

None — all files created in this plan are fully implemented.

The stub `markdown-renderer.tsx` that existed from plan 02-05's parallel work has been replaced with the full implementation. The stub used a dynamic `require("react-markdown")` fallback; the real implementation uses direct static import.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: new-network-endpoint | app/api/tenants/[id]/chat/route.ts | POST endpoint spawns gbrain subprocess with user-supplied question text. Mitigations: tenant slug validated via tenantSlugSchema regex (no traversal); question max 500 chars via zod; GBRAIN_HOME injected by spawnGBrain (not from user input); question passed as CLI arg (not shell-interpolated); gbrain binary is trusted. |

## Self-Check: PASSED

Files created/exist:
- components/chat/markdown-renderer.tsx: FOUND
- lib/chat/schemas.ts: FOUND
- lib/chat/system-prompt.ts: FOUND
- app/api/tenants/[id]/chat/route.ts: FOUND
- lib/gbrain/client.ts (modified): FOUND
- lib/gbrain/index.ts (modified): FOUND

Commits verified:
- 06c3fbf: feat(02-06): install react-markdown + remark-gfm; build MarkdownRenderer
- 2ded0b8: feat(02-06): add think() helper; create chat schemas + system-prompt scaffold
- 1109703: feat(02-06): POST /api/tenants/[id]/chat SSE Route Handler

TSC: clean (0 errors)
Mutex smoke: 4/4 tests pass (HARN-04 invariant preserved)
Acceptance greps:
- `--model haiku` in lib/gbrain/client.ts: PASS
- `think` command in lib/gbrain/client.ts: PASS
- `That one's running slow` in route.ts: PASS
- `timeoutMs: 30_000` in route.ts: PASS
- `text/event-stream` header in route.ts: PASS
- `chatQuestionSchema` exported from lib/chat/schemas.ts: PASS
- `MARAS_COFFEE_SYSTEM_PROMPT` exported from lib/chat/system-prompt.ts: PASS
- `buildThinkArgs` exported from lib/chat/system-prompt.ts: PASS
- `skipHtml` in markdown-renderer.tsx: PASS
- `react-markdown` and `remark-gfm` in package.json: PASS
