# Stack Research

**Domain:** Web onboarding shell wrapping a local CLI/knowledge-graph engine (gbrain) for SMB persona demo
**Researched:** 2026-05-16
**Confidence:** HIGH on gbrain layer (verified against the gbrain repo), HIGH on web layer (mainstream Next.js + Vercel AI SDK), MEDIUM on streaming-progress-from-shell-out specifics (confirmed pattern but exact ergonomics emerge during build).

---

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

---

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

---

## Installation (First 30 Minutes — Copy-Paste Ready)

```bash
# 1. Install bun if not already on the box
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"
bun --version  # expect 1.2.x+

# 2. Install gbrain (CRITICAL: clone+link, not global)
git clone https://github.com/garrytan/gbrain.git ~/gbrain
cd ~/gbrain && bun install && bun link
gbrain --version  # sanity check

# 3. Verify keys are set in the shell that will run the demo
export OPENAI_API_KEY=sk-...        # required: embeddings (vector search dies without this)
export ANTHROPIC_API_KEY=sk-ant-... # required for query expansion / good answers
gbrain models doctor                # confirms both keys reach their providers

# 4. Bootstrap the Next.js app (back in the quick-brain repo)
cd /Users/abdulhannankanji/Git\ repos/quick-brain
bun create next-app@latest . --typescript --tailwind --app --no-src-dir --import-alias "@/*"
# When asked, accept all defaults

# 5. Add shadcn (initializes Tailwind v4 config automatically)
bunx shadcn@latest init -d
bunx shadcn@latest add button card input textarea scroll-area badge separator

# 6. Add the safety libs
bun add zod react-markdown remark-gfm

# 7. Smoke-test the integration once before writing any UI
mkdir -p brains/maras-coffee
GBRAIN_HOME=$(pwd)/brains/maras-coffee gbrain init
echo "---\ntitle: Smoke Test\n---\nMara sells coffee." > /tmp/smoke.md
GBRAIN_HOME=$(pwd)/brains/maras-coffee gbrain import /tmp/smoke.md
GBRAIN_HOME=$(pwd)/brains/maras-coffee gbrain query "what does Mara sell?"
# If this returns useful text, the entire integration spine is proven.
```

If step 7 fails, **stop and debug before writing any UI code.** Everything downstream depends on `GBRAIN_HOME=<dir> gbrain query` working from the same shell environment Next.js will inherit.

---

## Architectural Picks (Answering The Numbered Questions)

### 1. Frontend framework + routing — Next.js 15 App Router. **Confirmed.**

The App Router is the right call. Reasons:
- Operator already knows it.
- Route Handlers (`app/api/.../route.ts`) can both proxy to children and stream — no Express/Fastify needed.
- Server Components let the dashboard render insight cards from a *server-side* `gbrain query` without round-tripping through the browser.
- Single repo, single `bun dev` command, single `next build` for the demo machine.

### 2. Server-side runtime — **Next.js Route Handlers + `child_process.spawn` (or `Bun.spawn`)**. No separate bun server.

A separate bun server would cost ~30min of wiring (proxying, CORS, port choice) for zero demo value. Route Handlers in App Router already run on the server with full `node:child_process` access. Bun is fully API-compatible with `node:child_process.spawn`/`execFile`.

**Long-running ingest:** `gbrain import` on ~50–100 markdown files with `--no-embed` is fast (<5s). With embeddings (default), it makes one OpenAI call per file. For 100 files this is ~5–30s — still inside an HTTP request window. Stream progress over SSE, do NOT introduce a job queue. (gbrain itself ships "Minions" for durable jobs, but for 100 files committed in-repo this is overkill.)

If you somehow exceed 60s of import time, the demo dataset is too big — trim it before introducing background workers.

### 3. Brain process lifecycle — **No long-running per-tenant `gbrain serve`. Fire one-shot CLI invocations per request.**

The demo runs one persona (Mara's Coffee). Spawn `gbrain query` per chat message with `GBRAIN_HOME=brains/maras-coffee`. Single brain dir; no process management; no port allocation; no zombie-cleanup logic. PGLite opens, runs the query, closes — typical end-to-end <500ms per query after the first.

If we ever needed multi-tenant in a real product, the answer would be "one shared `gbrain serve --http` per brain dir on rotating ports" — but for a 7.5h demo that's a trap.

### 4. Talking to gbrain — **Raw CLI invocations.** Skip `gbrain serve --http` entirely. Skip MCP.

This is the most important time-saving decision in the project.

| Approach | Setup cost | Time-to-first-query | Verdict |
|---|---|---|---|
| `gbrain serve --http` + MCP JSON-RPC | OAuth 2.1 client registration, bootstrap token via admin dashboard, MCP client implementation in Next.js, request signing | 60–120 min | **AVOID** |
| MCP stdio from Next.js | Speak JSON-RPC over a piped stdio child, frame messages correctly | 30–60 min | AVOID |
| **Raw `gbrain query` CLI shell-out** | `spawn("gbrain", ["query", q], { env: { ...env, GBRAIN_HOME } })`, read stdout | 5 min | **PICK THIS** |

The HTTP server requires OAuth 2.1 (confirmed in gbrain docs: "OAuth 2.1 + admin dashboard baked into the binary" since v0.26). There is no documented unauthenticated local mode for the MCP endpoint. Even for localhost-only binding, you must register a client and exchange tokens. For a 7.5h project this is straight-up unaffordable.

Shell-out costs you: one `spawn` call. That's it.

### 5. Streaming UX — **Server-Sent Events via Route Handler `ReadableStream`. Do NOT use Vercel AI SDK's `useChat`.**

`useChat` assumes you're calling an LLM provider that speaks a token-streaming protocol. We aren't — gbrain returns a complete formatted answer (markdown + citations) after it does its own retrieval + LLM call. The "streaming" we need is:

- **For ingest:** progress events ("imported 12/100 files", "extracting links", "computing embeddings").
- **For query:** a typing-indicator + final answer, optionally streamed line-by-line from `gbrain`'s stdout.

Implementation pattern:

```ts
// app/api/ingest/route.ts
export async function POST(req: Request) {
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const child = Bun.spawn(["gbrain", "import", "data/maras-coffee", "--workers", "4"], {
        env: { ...process.env, GBRAIN_HOME: "brains/maras-coffee" },
        stdout: "pipe", stderr: "pipe",
      });
      for await (const chunk of child.stdout) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ log: new TextDecoder().decode(chunk) })}\n\n`));
      }
      await child.exited;
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
```

On the client, a single `useEffect` with `new EventSource("/api/ingest")` consumes it. Total streaming code: <80 lines.

**Do NOT install the Vercel AI SDK at all** unless you also decide to bypass gbrain (which would forfeit the prize narrative).

### 6. UI primitives — **shadcn/ui + Tailwind v4.** Locked in.

shadcn is the lowest-friction option in 2026:
- One CLI command initializes everything (`bunx shadcn@latest init -d`).
- Components are copied into your repo, not installed — zero version-pinning drama.
- All components are pre-styled, accessible (Radix under the hood), and Tailwind-v4-ready as of the 2026 release.
- Operator gets a "looks like a product" UI for ~zero design hours.

Add only what you use: `button card input textarea scroll-area badge separator` covers chat + insight cards.

**Do NOT use:** Material UI / Chakra (heavy runtime, theme config eats time), pure Tailwind without shadcn (you'll spend an hour styling buttons), custom CSS (no).

### 7. Synthetic data format — **Markdown files with YAML frontmatter**, committed to `data/maras-coffee/`.

gbrain's documented import format (verified against the gbrain README/INSTALL_FOR_AGENTS):

```markdown
---
type: invoice           # or: vendor-email | bank-statement | concept | company
title: Invoice 2026-03-04 — Beanstalk Roasters
tags: [vendor:beanstalk, month:2026-03, category:cogs]
source: synthetic
---

Beanstalk Roasters — Mar 4, 2026
Subtotal: $1,840
Notes: First delivery after the unannounced $0.40/lb price increase.

---

- 2026-03-04: Invoice received
- 2026-03-04: Auto-imported by QuickBrain
```

The `---` separator after the body is gbrain's compiled-truth / append-only-timeline divider. Honor it for at least the "interesting" pages (vendor history, P&L summary, anomalies), so timeline-aware queries work.

Recommended file layout under `data/maras-coffee/`:

```
data/maras-coffee/
├── companies/beanstalk-roasters.md   # vendor profile with timeline
├── companies/landlord-llc.md          # rent payee
├── companies/<other vendors>.md
├── media/invoices/2026-01-*.md        # ~25 invoice pages
├── media/invoices/2026-02-*.md
├── media/invoices/2026-03-*.md        # plant the price-hike anomaly here
├── media/bank-statements/<month>.md   # ~3 statements
├── media/emails/<thread>.md           # ~10 vendor-email threads
└── concepts/march-anomaly.md          # optional "narrative" page that ties the price hike + double-rent + SaaS creep together
```

On `gbrain init`, copy these into `brains/maras-coffee/` (don't symlink — gbrain may write back). Then `gbrain import brains/maras-coffee/`.

### 8. Local LLM provider — **OpenAI (embeddings) + Anthropic (chat).** Required.

Per gbrain's INSTALL_FOR_AGENTS.md (verified):

- `OPENAI_API_KEY` — **required** for vector search. Without it, only keyword search works and most "weird about March?" type questions degrade. Embeddings call `text-embedding-3-small` by default.
- `ANTHROPIC_API_KEY` — **strongly required**. Without it, gbrain "skips query expansion" and answer quality drops noticeably. Default chat model: Claude Opus (configurable via `gbrain config set models.default sonnet` if you want to save cost during dev).

For the demo, set `gbrain config set models.default sonnet` after `init` — Opus is 3–5x the cost for marginal quality gains on this dataset. Sonnet 4.x is plenty.

Both keys must be in the **shell that runs `bun dev`** so they get inherited by spawned `gbrain` children. Put them in `.env.local` AND echo them in your start script:

```bash
# scripts/dev.sh
set -a; source .env.local; set +a
bun dev
```

`process.env.OPENAI_API_KEY` will then flow through the spawn `env` option. **Do not** try to read `.env.local` only from Next.js — `gbrain` is a child process, it doesn't know about Next's env loader.

### 9. Package manager + tooling — **Bun, end to end.**

- Bun for installing app deps (`bun add`).
- Bun for running scripts (`bun run seed`, `bun run dev`).
- `bunx` instead of `npx` for one-off CLIs (`bunx shadcn@latest add ...`).
- `Bun.spawn` is fine in places we control, but prefer `node:child_process.spawn` inside Route Handlers — it's API-identical under Bun and keeps the code portable if anyone ever runs `next dev` under Node.

### 10. Reset / seed strategy — **One script. Idempotent. <10s.**

```ts
// scripts/seed.ts
import { rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";

const BRAIN = "brains/maras-coffee";

await rm(BRAIN, { recursive: true, force: true });
await cp("data/maras-coffee", BRAIN, { recursive: true });

const env = { ...process.env, GBRAIN_HOME: `${process.cwd()}/${BRAIN}` };
const run = (args: string[]) => new Promise<void>((res, rej) => {
  const p = spawn("gbrain", args, { env, stdio: "inherit" });
  p.on("exit", c => c === 0 ? res() : rej(new Error(`gbrain ${args.join(" ")} exited ${c}`)));
});

await run(["init"]);
await run(["config", "set", "models.default", "sonnet"]);
await run(["import", BRAIN, "--workers", "4"]);
console.log("Brain reseeded. Run `bun dev` and refresh the page.");
```

Expose a **Reset button** in the demo UI that calls a `POST /api/reset` Route Handler, which spawns this script and streams progress over SSE. Operator can also run `bun run seed` from the terminal if the UI is borked.

Why this works: gbrain `init` + `import` on 100 markdown files with `--no-embed` is sub-3s; with embeddings it's ~5–15s depending on OpenAI latency. If a judge says "let me try one" and breaks state, you hit Reset and you're back in the demo in <15s.

---

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

---

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

---

## Stack Patterns by Variant

**If the embedding API rate-limits or fails mid-demo:**
- Run `gbrain config set search.mode conservative` to reduce vector calls per query.
- Pre-warm the brain by running every "wow" query once before the demo so embeddings are cached.

**If `gbrain query` end-to-end latency is >2s on the demo machine:**
- Set `models.default` to `haiku` (cheaper, faster, slightly less polished prose).
- Pre-bake the answer to the curated demo question into the insight-card UI so the chat is "the live one" and the cards prove correctness.

**If the operator gets a fresh machine on demo day:**
- The full setup (clone gbrain, install bun, `bun install`, `bun run seed`, `bun dev`) is ~5–8min.
- Bake a `scripts/bootstrap.sh` that runs all of it end-to-end.

**If `gbrain serve` somehow becomes necessary** (e.g., a stretch goal requires Claude Desktop demo):
- Run it on a fixed port with `--bind 127.0.0.1 --port 3131`, use a single bootstrap token, and skip OAuth client registration by hitting only routes that accept the bootstrap token. **This is a known time-trap — defer.**

---

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

**Known compatibility hazard:** If anyone runs the project under `next dev --turbo` and a future Bun release ships a Turbopack regression with `child_process`, fall back to `next dev` (non-Turbo). Not currently a problem as of 2026-05 but worth knowing.

---

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

---

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

---
*Stack research for: hackathon-grade web shell wrapping local gbrain CLI for an SMB persona*
*Researched: 2026-05-16*
