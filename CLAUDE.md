<!-- GSD:project-start source:PROJECT.md -->
## Project

**QuickBrain**

QuickBrain is a 60-second onboarding shell around [gbrain](https://github.com/garrytan/gbrain) that lets a non-technical small-business owner spin up a working business brain. The demo persona is Mara, who owns a neighborhood coffee shop: she lands on the page, answers two or three questions, and a real gbrain instance is initialized for her business with synthetic invoices, vendor emails, and bank statements pre-ingested. Once it's alive she gets a chat surface with auto-generated insight cards (top vendors, P&L snapshot, anomalies flagged) and can ask things like *"what was weird about March?"* in plain English.

The product is built as a YC hackathon entry for the gbrain "mom-and-pop SMB" prize — it answers the question *"how would a non-technical SMB owner actually get a gbrain?"*

**Core Value:** A non-technical small-business owner can go from zero to a live, queryable gbrain in under 60 seconds and immediately see useful answers — without ever touching a terminal.

### Constraints

- **Timeline**: 7.5 hours total, including demo prep — every decision is filtered through this.
- **Tech stack**: gbrain CLI (bun/TypeScript) for the brain layer; Next.js + TypeScript for the web shell. Single repo, local-only runtime.
- **gbrain integration depth**: Real gbrain CLI + MCP, not mocked. The prize requires authentic gbrain showcase; faking the engine kills the narrative.
- **Demo surface**: Minimal web chat with insight cards. No Claude Desktop, no CLI-only, no full dashboard.
- **Data**: Synthetic dataset for the coffee shop persona, pre-baked into the repo. No live email/QuickBooks/Stripe plumbing.
- **Determinism**: Demo must run identically every time — judges don't tolerate flakiness. Reset script must restore state in <10s.
- **Persona**: Single fictional persona ("Mara's Coffee") — no multi-persona branching during the demo.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

## TL;DR — The 30-Second Stack
| Layer | Pick |
|---|---|
| Runtime | **Bun 1.2+** for everything (Next.js dev server, scripts, gbrain child processes) |
| Web framework | **Next.js 15 App Router**, single app, no separate API server |
| gbrain integration | **Shell out to the `gbrain` CLI** via `Bun.spawn` / `node:child_process`. NOT `gbrain serve --http`. |
| Streaming | **Server-Sent Events** via Next.js Route Handlers + `ReadableStream`. **Skip** `useChat` from AI SDK because we are not calling an LLM provider — we are calling `gbrain query` which already runs the model. |
| UI primitives | **shadcn/ui** + **Tailwind v4** (initialized via the shadcn CLI in one command) |
| LLM providers (used by gbrain, not by us) | `OPENAI_API_KEY` (embeddings) + `ANTHROPIC_API_KEY` (chat/expansion) — both must be in shell env when our app spawns gbrain |
| Persistence | **PGLite, owned by gbrain** under each tenant's brain dir. We do not run our own DB. |
| Per-tenant isolation | A `brains/<slug>/` directory per persona; we pass `GBRAIN_HOME=brains/<slug>` to every `gbrain` child process. |
| Reset | `rm -rf brains/maras-coffee && bun run scripts/seed.ts` (one script, <10s wall clock) |
| Synthetic data | Markdown files with YAML frontmatter, committed to `data/maras-coffee/`, copied into the brain dir on init, then `gbrain import` |
## Recommended Stack
### Core Technologies
| Technology | Version | Purpose | Why Recommended |
|---|---|---|---|
| **Bun** | `1.2.x` (latest stable) | Runtime for `gbrain` CLI, Next.js dev server, and our seed/reset scripts | gbrain is bun-native (`bun install && bun link`); using bun as the host runtime avoids node/bun ABI surprises when `child_process.spawn` invokes the `gbrain` binary. Bun's `node:child_process` is API-compatible. |
| **Next.js** | `15.x` (App Router) | Single app: UI + Route Handlers + server-side gbrain orchestration | Operator is already comfortable with it (PROJECT.md). App Router Route Handlers can stream SSE natively via `ReadableStream` — no separate backend needed, saving ~1–2h of plumbing. |
| **React** | `19.x` (ships with Next 15) | UI | Default with Next 15. No extra decision. |
| **TypeScript** | `5.5+` | Type safety across web + scripts | Matches gbrain ecosystem; reduces wiring bugs at speed. |
| **Tailwind CSS** | `4.x` | Styling primitives | Zero design budget. shadcn CLI configures it for you. Tailwind v4 is the current shadcn target as of 2026. |
| **shadcn/ui** | latest CLI | Prebuilt accessible chat/card/form components | Copy-paste components mean no design system to invent. Initialized in one command; `npx shadcn@latest add button card input` and you're done. |
### Supporting Libraries
| Library | Version | Purpose | When to Use |
|---|---|---|---|
| **lucide-react** | latest | Icons | Comes for free with shadcn. Use for the chat send button, vendor card icons, anomaly flag. |
| **zod** | `3.x` | Validate the onboarding form payload | The form goes to a Route Handler before spawning a child process; one schema prevents bad `GBRAIN_HOME` injection. **Required for safety**, not optional. |
| **clsx** + **tailwind-merge** | latest | Conditional classnames | Shipped automatically by shadcn `cn()` util. |
| **react-markdown** + **remark-gfm** | latest | Render gbrain query output (markdown with citations) | `gbrain query` returns markdown-ish text with `[Source: ...]` citations. Don't roll your own renderer. |
### Development Tools
| Tool | Purpose | Notes |
|---|---|---|
| `gbrain` CLI | The actual brain | Install via `git clone + bun install && bun link` from `garrytan/gbrain` master. Do NOT use `bun install -g github:garrytan/gbrain` — bun blocks the postinstall hook and PGLite migration never runs (documented gotcha in INSTALL_FOR_AGENTS.md). |
| Bun's built-in test runner | Smoke-test the seed script | Use only if time allows. Demo is the real test. |
| ESLint defaults from `create-next-app` | Catch broken imports | Keep defaults; no time for custom rules. |
## Installation (First 30 Minutes — Copy-Paste Ready)
# 1. Install bun if not already on the box
# 2. Install gbrain (CRITICAL: clone+link, not global)
# 3. Verify keys are set in the shell that will run the demo
# 4. Bootstrap the Next.js app (back in the quick-brain repo)
# When asked, accept all defaults
# 5. Add shadcn (initializes Tailwind v4 config automatically)
# 6. Add the safety libs
# 7. Smoke-test the integration once before writing any UI
# If this returns useful text, the entire integration spine is proven.
## Architectural Picks (Answering The Numbered Questions)
### 1. Frontend framework + routing — Next.js 15 App Router. **Confirmed.**
- Operator already knows it.
- Route Handlers (`app/api/.../route.ts`) can both proxy to children and stream — no Express/Fastify needed.
- Server Components let the dashboard render insight cards from a *server-side* `gbrain query` without round-tripping through the browser.
- Single repo, single `bun dev` command, single `next build` for the demo machine.
### 2. Server-side runtime — **Next.js Route Handlers + `child_process.spawn` (or `Bun.spawn`)**. No separate bun server.
### 3. Brain process lifecycle — **No long-running per-tenant `gbrain serve`. Fire one-shot CLI invocations per request.**
### 4. Talking to gbrain — **Raw CLI invocations.** Skip `gbrain serve --http` entirely. Skip MCP.
| Approach | Setup cost | Time-to-first-query | Verdict |
|---|---|---|---|
| `gbrain serve --http` + MCP JSON-RPC | OAuth 2.1 client registration, bootstrap token via admin dashboard, MCP client implementation in Next.js, request signing | 60–120 min | **AVOID** |
| MCP stdio from Next.js | Speak JSON-RPC over a piped stdio child, frame messages correctly | 30–60 min | AVOID |
| **Raw `gbrain query` CLI shell-out** | `spawn("gbrain", ["query", q], { env: { ...env, GBRAIN_HOME } })`, read stdout | 5 min | **PICK THIS** |
### 5. Streaming UX — **Server-Sent Events via Route Handler `ReadableStream`. Do NOT use Vercel AI SDK's `useChat`.**
- **For ingest:** progress events ("imported 12/100 files", "extracting links", "computing embeddings").
- **For query:** a typing-indicator + final answer, optionally streamed line-by-line from `gbrain`'s stdout.
### 6. UI primitives — **shadcn/ui + Tailwind v4.** Locked in.
- One CLI command initializes everything (`bunx shadcn@latest init -d`).
- Components are copied into your repo, not installed — zero version-pinning drama.
- All components are pre-styled, accessible (Radix under the hood), and Tailwind-v4-ready as of the 2026 release.
- Operator gets a "looks like a product" UI for ~zero design hours.
### 7. Synthetic data format — **Markdown files with YAML frontmatter**, committed to `data/maras-coffee/`.
- 2026-03-04: Invoice received
- 2026-03-04: Auto-imported by QuickBrain
### 8. Local LLM provider — **OpenAI (embeddings) + Anthropic (chat).** Required.
- `OPENAI_API_KEY` — **required** for vector search. Without it, only keyword search works and most "weird about March?" type questions degrade. Embeddings call `text-embedding-3-small` by default.
- `ANTHROPIC_API_KEY` — **strongly required**. Without it, gbrain "skips query expansion" and answer quality drops noticeably. Default chat model: Claude Opus (configurable via `gbrain config set models.default sonnet` if you want to save cost during dev).
# scripts/dev.sh
### 9. Package manager + tooling — **Bun, end to end.**
- Bun for installing app deps (`bun add`).
- Bun for running scripts (`bun run seed`, `bun run dev`).
- `bunx` instead of `npx` for one-off CLIs (`bunx shadcn@latest add ...`).
- `Bun.spawn` is fine in places we control, but prefer `node:child_process.spawn` inside Route Handlers — it's API-identical under Bun and keeps the code portable if anyone ever runs `next dev` under Node.
### 10. Reset / seed strategy — **One script. Idempotent. <10s.**
## Alternatives Considered
| Recommended | Alternative | When to Use Alternative |
|---|---|---|
| Next.js Route Handlers as the only backend | Separate Bun/Hono server + Next.js as pure frontend | If you needed shared state across multiple Next.js servers (you don't — single demo laptop) or WebSocket-heavy bidirectional protocol (you don't — SSE is enough) |
| Raw CLI shell-out | `gbrain serve --http` + MCP client | If you needed Claude Desktop or another MCP-aware product to also connect to the same brain (out of scope for this demo) |
| Raw CLI shell-out | `gbrain serve --http` (HTTP REST, if it existed) | gbrain's HTTP server is MCP-only with OAuth 2.1 — there is no documented REST surface. Don't pursue this. |
| SSE | WebSockets via `ws`/`socket.io` | If you needed bidirectional control mid-ingest (you don't — kick off and watch logs). WebSockets in Next.js Route Handlers are not supported without a custom server, which we are explicitly skipping. |
| SSE | Vercel AI SDK `useChat` | Only if you give up gbrain entirely and stream straight from an LLM. That kills the prize narrative. |
| shadcn/ui | Mantine, Chakra UI | If shadcn's copy-into-repo workflow is a dealbreaker for some reason. It isn't here. |
| Anthropic Sonnet (set via `gbrain config`) | Opus default | Use Opus if the answer-quality bar is unmissable for the demo question. Sonnet has been adequate in similar gbrain demos. |
| PGLite (gbrain default) | Supabase backend (`gbrain init --supabase`) | If the demo had to survive across machines or auth was required. Single laptop, single demo session — PGLite is faster and zero-config. |
| Synthetic markdown committed to repo | Generate-on-the-fly with an LLM | If the dataset needs to be huge. ~75 hand-curated files with planted anomalies always beats LLM-generated noise for a 3-min demo. |
## What NOT to Use
| Avoid | Why | Use Instead |
|---|---|---|
| `gbrain serve --http` for talking to the brain | Requires OAuth 2.1 client registration + bootstrap token + admin dashboard flow. Hours of yak-shaving for zero demo benefit. | Direct `spawn("gbrain", ["query", ...])` |
| A custom MCP client in Next.js | Implementing MCP JSON-RPC framing, capability negotiation, and OAuth from scratch is a multi-day project | Shell-out to `gbrain query` |
| Vercel AI SDK (`ai`, `useChat`) | It's designed for "Next.js calls OpenAI/Anthropic directly." We don't — gbrain is the LLM layer. Adding the SDK introduces a streaming protocol we don't need and confuses the rendering path. | Plain `ReadableStream` + `EventSource` |
| `bun install -g gbrain` or `npm install -g gbrain` | Documented in gbrain's INSTALL_FOR_AGENTS: bun blocks postinstall (PGLite never migrates, crashes with `Aborted()`); npm pulls a squatted unrelated package | `git clone + bun install && bun link` |
| Postgres / Supabase as a tenant DB | gbrain ships PGLite and owns its own storage. Adding a second DB is pure overhead. | PGLite under each `brains/<slug>/` |
| Custom auth (NextAuth, Clerk, anything) | Out of scope per PROJECT.md. ~2h sink with zero prize payoff. | Single anonymous session. |
| A background job queue (BullMQ, Inngest, etc.) | 75 markdown files imports in <30s — well within an HTTP request. gbrain has its own "Minions" if you ever need it. | SSE streaming the import command's stdout |
| Drizzle / Prisma | We have no DB of our own. | (nothing — we don't query a DB) |
| Tailwind v3 | shadcn 2026 ships v4. Mixing versions wastes ~30min in upgrade dance. | Tailwind v4 from the shadcn CLI |
| Custom gbrain skill authoring on day 1 | PROJECT.md flags `smb-audit` as a stretch goal, not v1 | Ship the core onboarding + chat + insights path first |
| WebSockets | No bidirectional protocol need; not natively supported by App Router Route Handlers | SSE |
| Docker for local demo | Extra layer between you and `gbrain`; permission/env-var headaches | Run everything on the host with `bun dev` |
| Sentry / OpenTelemetry / observability stack | Demo runs once on a laptop in front of judges | `console.log` |
## Stack Patterns by Variant
- Run `gbrain config set search.mode conservative` to reduce vector calls per query.
- Pre-warm the brain by running every "wow" query once before the demo so embeddings are cached.
- Set `models.default` to `haiku` (cheaper, faster, slightly less polished prose).
- Pre-bake the answer to the curated demo question into the insight-card UI so the chat is "the live one" and the cards prove correctness.
- The full setup (clone gbrain, install bun, `bun install`, `bun run seed`, `bun dev`) is ~5–8min.
- Bake a `scripts/bootstrap.sh` that runs all of it end-to-end.
- Run it on a fixed port with `--bind 127.0.0.1 --port 3131`, use a single bootstrap token, and skip OAuth client registration by hitting only routes that accept the bootstrap token. **This is a known time-trap — defer.**
## Version Compatibility
| Package A | Compatible With | Notes |
|---|---|---|
| `bun@1.2.x` | `gbrain@master` | gbrain requires Bun 1.0+; 1.2 is the current stable in 2026. |
| `next@15` | `react@19`, `tailwindcss@4` | Matched by `create-next-app@latest` defaults. |
| `next@15` App Router | `node:child_process` under Bun | Confirmed: `Bun.spawn` and `node:child_process.spawn` are interchangeable. |
| `shadcn@latest` CLI | Tailwind v4 + React 19 | Both supported in 2026 release; CLI auto-detects. |
| `gbrain` (PGLite default) | PostgreSQL 17.5 (embedded) + pgvector | All bundled, no host Postgres needed. |
| `OPENAI_API_KEY` | `text-embedding-3-small` (gbrain default) | Required for vector search. |
| `ANTHROPIC_API_KEY` | Claude Sonnet 4.x / Opus 4.x | Required for query expansion and chat output. |
## Confidence Assessment
| Area | Confidence | Notes |
|---|---|---|
| gbrain CLI surface (init / import / query / serve) | **HIGH** | Verified against gbrain README + INSTALL_FOR_AGENTS.md (live fetched from master). |
| gbrain env requirements (OPENAI + ANTHROPIC) | **HIGH** | Explicitly documented in INSTALL_FOR_AGENTS.md. |
| gbrain brain dir layout & markdown frontmatter format | **HIGH** | Documented in GBRAIN_RECOMMENDED_SCHEMA reference and gbrain README. |
| `GBRAIN_HOME` env var for per-tenant brain dirs | **HIGH** | Documented; the standard way to point gbrain at a non-default brain location. |
| Next.js 15 App Router + SSE streaming pattern | **HIGH** | Well-trodden 2025/2026 path. |
| Bun ↔ Node `child_process` compat | **HIGH** | Bun docs confirm full API compatibility. |
| shadcn/ui + Tailwind v4 install in 2026 | **HIGH** | shadcn CLI now initializes Tailwind v4 + React 19 out of the box. |
| Skipping `gbrain serve --http` is correct call | **HIGH** | Confirmed OAuth 2.1 is required; no documented anonymous-localhost mode for MCP endpoint. |
| Exact ingest stream-progress UX | **MEDIUM** | `gbrain import` stdout format isn't fully documented; build will need a 10-min spike to confirm log shape and parse it into UI progress events. |
| Demo always-works "wow" query | **MEDIUM** | Depends on the synthetic dataset's anomaly construction. Validate by running the question against the seeded brain before demo. |
## Sources
- [gbrain repository (master)](https://github.com/garrytan/gbrain) — CLI surface, MCP server modes, environment vars, directory layout.
- [gbrain INSTALL_FOR_AGENTS.md](https://raw.githubusercontent.com/garrytan/gbrain/master/INSTALL_FOR_AGENTS.md) — Required `OPENAI_API_KEY` + `ANTHROPIC_API_KEY` behavior; `bun install -g` gotcha; `GBRAIN_HOME`; default search mode.
- [gbrain README](https://raw.githubusercontent.com/garrytan/gbrain/master/README.md) — `gbrain init`, `gbrain import`, `gbrain query` behavior; pipeline stages; example output.
- [gbrain docs/mcp/DEPLOY.md](https://github.com/garrytan/gbrain/blob/master/docs/mcp/DEPLOY.md) — Confirms `/mcp` + `/admin` + OAuth-discovery endpoints; v0.26+ OAuth 2.1 baked in.
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next) — Current install procedure with Tailwind v4 + Next 15.
- [shadcn/ui Tailwind v4 guide](https://ui.shadcn.com/docs/tailwind-v4) — Verified Tailwind v4 + React 19 support.
- [AI SDK Next.js App Router guide](https://ai-sdk.dev/docs/getting-started/nextjs-app-router) — Used only to confirm we are deliberately NOT using `useChat` because we're not calling an LLM directly.
- [Bun child_process docs](https://bun.com/docs/runtime/child-process) — Confirms node:child_process API compatibility under Bun runtime.
- [Bun Compatibility 2026 (Cloudstar)](https://www.alexcloudstar.com/blog/bun-compatibility-2026-npm-nodejs-nextjs/) — Confirms current state of Bun ↔ Next.js interop in 2026.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

- **Spike findings for quick-brain** (implementation patterns, constraints, gotchas from spike sessions on outbound vendor emails + accounting connectors) → `Skill("spike-findings-quick-brain")`
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
