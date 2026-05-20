---
phase: 02-onboarding-theater-chat
plan: 05
subsystem: ui
tags: [nextjs, react, client-component, sse, fetch, shadcn, chat, dashboard, scroll-area, skeleton]

requires:
  - phase: 02-onboarding-theater-chat
    plan: 01
    provides: Next.js 15 App Router scaffold, shadcn primitives (Card, Button, Input, Skeleton, ScrollArea, Badge), lib/utils.ts cn()
  - phase: 02-onboarding-theater-chat
    plan: 02
    provides: lib/gbrain/tenants.ts (init, get, TenantRecord), lib/gbrain/slug.ts (tenantSlugSchema)

provides:
  - app/dash/[id]/page.tsx: RSC dashboard route validating slug regex + tenant registry before mounting ChatSurface
  - components/chat/chat-surface.tsx: ChatSurface — client state machine (messages, pending, inputValue) + fetch POST SSE consumer
  - components/chat/message-list.tsx: MessageList + ChatMessage type — ScrollArea-wrapped, role-based bubbles, thinking skeleton
  - components/chat/message-input.tsx: MessageInput — shadcn Input + Send button form
  - components/chat/suggested-chips.tsx: SuggestedChips + SUGGESTED_QUESTIONS — three exact CHAT-04 hardcoded chips
  - components/chat/markdown-renderer.tsx: MarkdownRenderer stub (pre fallback until Plan 06 installs react-markdown)
  - CHAT-01: /dash/<tenantId> renders shadcn input + send + message list + ScrollArea
  - CHAT-04: Exactly 3 hardcoded chips with locked text appear above input on first load

affects: [02-06, phase-03-insights]

tech-stack:
  added: []
  patterns:
    - "SSE fetch pattern: fetch POST + response.body.getReader() + manual SSE frame parsing (split on \\n\\n, parse event:/data: lines) — EventSource not used for POST"
    - "Chat state machine: messages[], pending bool, inputValue string — all useState in ChatSurface"
    - "renderAssistant prop pattern: MessageList accepts (markdown: string) => JSX.Element — decouples renderer from list"
    - "Thinking skeleton: Skeleton + animated dots + literal Mara's brain is thinking phrase below last message"
    - "RSC dashboard page wrapping a client ChatSurface — slug regex + tenants.get() validation before mount"
    - "MarkdownRenderer stub: Plan 06 ownership pattern — stub ships now, plan 06 replaces body with react-markdown"

key-files:
  created:
    - app/dash/[id]/page.tsx
    - components/chat/chat-surface.tsx
    - components/chat/message-list.tsx
    - components/chat/message-input.tsx
    - components/chat/suggested-chips.tsx
    - components/chat/markdown-renderer.tsx
  modified: []

key-decisions:
  - "Used direct import of MarkdownRenderer stub instead of dynamic() — avoids webpack module-not-found warning; Plan 06 will update the stub file in place"
  - "SuggestedChips hidden after first message (messages.length === 0 guard) — chips serve as onboarding affordance, not persistent UI"
  - "Removed stale-closure pending check at end of stream loop — setPending(false) unconditionally is always correct"
  - "Dashboard uses tenant.id as businessName — Plan 04 persists name in memory via tenants.upsert; Phase 3 can expose it via TenantRecord.name"

patterns-established:
  - "Chat component directory: components/chat/ — all chat-related client components live here"
  - "SSE manual reader: fetch POST → body.getReader() → buffer + split('\\n\\n') → parse event/data lines per frame"
  - "notFound() pattern for RSC pages: validate slug regex → validate tenant registry → mount client child"

requirements-completed: [CHAT-01, CHAT-04]

duration: ~20min
completed: 2026-05-16
---

# Phase 2 Plan 05: Dashboard Route + Chat Surface Summary

**Dashboard route at /dash/[id] with slug + tenant validation, ChatSurface client (SSE fetch, thinking skeleton), ScrollArea message list, 3 hardcoded chips (exact CHAT-04 strings), and a MarkdownRenderer stub for Plan 06 coordination**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-16T23:15:00Z
- **Completed:** 2026-05-16T23:35:00Z
- **Tasks:** 2/2
- **Files created:** 6

## Accomplishments

- Created 5 chat sub-components (SuggestedChips, MessageList, MessageInput, ChatSurface, MarkdownRenderer) all starting with "use client" where required
- SuggestedChips exports SUGGESTED_QUESTIONS with the three locked CHAT-04 strings (exact grep match verified); chips appear when messages.length === 0
- MessageList wraps content in shadcn ScrollArea (h-[60vh]), renders user/assistant/system-error role bubbles, shows thinking skeleton with literal "Mara's brain is thinking" phrase + animated dots; auto-scrolls via bottomRef
- ChatSurface implements manual SSE reader: fetch POST → body.getReader() → UTF-8 decode → split "\n\n" → parse event:/data: lines; handles answer/error frames; appends system-error message on network failure
- MarkdownRenderer stub: `<pre>` fallback for now; Plan 06 updates the file body with react-markdown + remark-gfm
- app/dash/[id]/page.tsx RSC: tenantSlugSchema.safeParse + tenants.init() + tenants.get() → notFound() on failure; mounts ChatSurface with tenant.id
- E2E verified twice: valid tenant 200, UPPERCASE 404, non-existent 404, chips + "Ask Mara" placeholder present in HTML; no build warnings; tsc --noEmit clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Message list, input, and suggested chips components** - `c27b926` (feat)
2. **Task 2: ChatSurface with SSE fetch + dashboard route** - `10b32b1` (feat)

## Files Created/Modified

- `components/chat/suggested-chips.tsx` — SuggestedChips + SUGGESTED_QUESTIONS readonly tuple with exact CHAT-04 strings
- `components/chat/message-list.tsx` — MessageList + ChatMessage type; ScrollArea, role bubbles, thinking skeleton
- `components/chat/message-input.tsx` — MessageInput; shadcn Input + Send button form; prevents default + clears value
- `components/chat/chat-surface.tsx` — ChatSurface; fetch POST SSE consumer with manual frame parsing; state machine
- `components/chat/markdown-renderer.tsx` — MarkdownRenderer stub; `<pre>` fallback; Plan 06 owns this file's implementation
- `app/dash/[id]/page.tsx` — RSC dashboard page; slug regex + tenant registry validation; notFound on bad ids

## Decisions Made

- **Direct import of MarkdownRenderer instead of dynamic():** The plan suggested `next/dynamic` with a catch-guard. However, using `require()` inside a try/catch is statically analyzed by webpack and still emits a "module not found" warning. The cleaner solution is a stub file that Plan 06 replaces — zero build warnings, no runtime error handling needed, Plan 06's ownership is explicit.
- **SuggestedChips hidden after first message:** Chips are an onboarding affordance. Once the user has sent a question, the chips would clutter the input area. Hidden via `messages.length === 0 && !pending` guard.
- **RSC page, client surface:** Dashboard page is a Server Component (no "use client") — slug validation and tenant lookup happen server-side before React hydration. ChatSurface is a Client Component for interactive state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Replaced dynamic() markdown import with direct stub import**
- **Found during:** Task 2 (chat-surface creation)
- **Issue:** The plan suggested `next/dynamic` with `require()` try/catch guard. When Next.js/webpack statically analyzes `require('react-markdown')` (even inside try/catch), it emits a build-time "Module not found" warning since react-markdown is not yet installed.
- **Fix:** Created `components/chat/markdown-renderer.tsx` as a stub file with `<pre>` fallback. ChatSurface imports it directly. Plan 06 will update the stub body in place with react-markdown — this is the documented coordination pattern.
- **Files modified:** components/chat/markdown-renderer.tsx, components/chat/chat-surface.tsx
- **Verification:** `bun run dev` compiles /dash/[id] with zero warnings; tsc --noEmit passes
- **Committed in:** 10b32b1 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — build warning from dynamic import approach)
**Impact on plan:** No scope creep. The stub pattern is equivalent to the dynamic() guard but cleaner. Plan 06 retains full ownership of markdown-renderer.tsx.

## Known Stubs

- `components/chat/markdown-renderer.tsx` — MarkdownRenderer renders `<pre>` fallback. Intentional: Plan 06 installs react-markdown + remark-gfm and replaces the component body. The stub is not a UI blocker — markdown is readable as preformatted text.

## Threat Flags

None — this plan adds client-side UI only. No new network endpoints (the POST /api/tenants/[id]/chat route is Plan 06's territory). The dashboard page uses tenants.get() for existence check — no user-controlled file system access. Slug validation via tenantSlugSchema (regex: `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`) prevents path traversal.

## Self-Check: PASSED

- `components/chat/suggested-chips.tsx` — FOUND
- `components/chat/message-list.tsx` — FOUND
- `components/chat/message-input.tsx` — FOUND
- `components/chat/chat-surface.tsx` — FOUND
- `components/chat/markdown-renderer.tsx` — FOUND
- `app/dash/[id]/page.tsx` — FOUND
- Task 1 commit `c27b926` — FOUND
- Task 2 commit `10b32b1` — FOUND
- `bunx tsc --noEmit` — PASSED (0 errors)
- E2E: valid tenant 200, UPPERCASE 404, non-existent 404 — PASSED
- Chip text + placeholder in HTML — PASSED

## Next Phase Readiness

- Plan 06 (chat backend): `POST /api/tenants/[id]/chat` route can be created immediately; ChatSurface already consumes `event: answer {markdown}` and `event: error {message}` SSE frames per the locked contract
- Plan 06 (markdown-renderer): replace `components/chat/markdown-renderer.tsx` body with react-markdown + remark-gfm implementation; no ChatSurface changes needed
- Phase 3: insight cards, reset button; the /dash/[id] page is the target for additional server-rendered content above the chat surface

---
*Phase: 02-onboarding-theater-chat*
*Completed: 2026-05-16*
