# Architecture Research

**Domain:** Single-operator demo shell wrapping a real CLI brain engine (gbrain) behind a Next.js web UI, with deterministic 60-second onboarding and chat.
**Researched:** 2026-05-16
**Confidence:** HIGH (gbrain CLI surface verified against official repo + INSTALL_FOR_AGENTS.md; Next.js streaming patterns verified against Next.js 15 docs)

---

## TL;DR (for the time-boxed reader)

- **One Next.js app**, App Router, Bun runtime. **No separate backend service.**
- **Brain layer = real `gbrain` CLI** invoked via `child_process.spawn` from Next.js Route Handlers. **Do NOT use `gbrain serve --http`** for v1 — its OAuth 2.1 dance burns hours we don't have.
- **Per-tenant isolation = per-tenant `GBRAIN_HOME`** env var pointing at `./brains/<tenantId>/` on disk. Verified pattern: `~/.gbrain` is the default, `GBRAIN_HOME` overrides it.
- **Streaming = SSE via `ReadableStream` in a Route Handler.** Hand-rolled. No Vercel AI SDK for v1 — its protocol assumes LLM-shaped streams; our progress events are simpler.
- **State = filesystem.** No DB in the web app. The brain directory IS the state. Reset = `rm -rf ./brains/<tenantId>/`.
- **Insight cards = pre-run canned `gbrain query` calls on dashboard mount, cached in-memory.** Not streamed. Run them in parallel.
- **Build order:** (1) gbrain shell harness → (2) onboarding flow with SSE → (3) chat → (4) insights → (5) reset + polish.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Browser (operator's laptop)                       │
│  ┌────────────┐    ┌──────────────┐    ┌──────────────────────────┐  │
│  │   /        │    │  /onboard    │    │   /dash/[tenantId]       │  │
│  │ Landing +  │    │  Form +      │    │   Chat UI +              │  │
│  │ "Start"    │    │  SSE progress│    │   Insight cards +        │  │
│  │            │    │  log         │    │   Reset button           │  │
│  └─────┬──────┘    └──────┬───────┘    └────────────┬─────────────┘  │
└────────┼──────────────────┼─────────────────────────┼────────────────┘
         │                  │                         │
         │   POST /api/tenants                        │
         │   GET  /api/tenants/[id]/onboard (SSE)     │
         │                  │   POST /api/tenants/[id]/chat (SSE)
         │                  │   GET  /api/tenants/[id]/insights
         │                  │   POST /api/tenants/[id]/reset
         ▼                  ▼                         ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Next.js App (Bun runtime, localhost:3000)          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                    Route Handlers (App Router)                  │  │
│  │   app/api/tenants/route.ts            (POST: create tenant)    │  │
│  │   app/api/tenants/[id]/onboard/route.ts  (GET: SSE init+import)│  │
│  │   app/api/tenants/[id]/chat/route.ts     (POST: SSE query)     │  │
│  │   app/api/tenants/[id]/insights/route.ts (GET: cached queries) │  │
│  │   app/api/tenants/[id]/reset/route.ts    (POST: wipe & restart)│  │
│  └────────────────────────────┬───────────────────────────────────┘  │
│                               │                                       │
│  ┌────────────────────────────┴───────────────────────────────────┐  │
│  │              lib/gbrain/                                        │  │
│  │   client.ts        — spawn helpers, GBRAIN_HOME wiring         │  │
│  │   onboard.ts       — orchestrates init → import → embed        │  │
│  │   query.ts         — wraps `gbrain query` shell-out            │  │
│  │   insights.ts      — canned queries + in-memory cache          │  │
│  │   tenants.ts       — tenant registry (in-memory Map)           │  │
│  └────────────────────────────┬───────────────────────────────────┘  │
└───────────────────────────────┼───────────────────────────────────────┘
                                │ child_process.spawn
                                │ env: { GBRAIN_HOME, OPENAI_API_KEY, ANTHROPIC_API_KEY }
                                │ cwd: ./brains/<tenantId>/
                                ▼
┌──────────────────────────────────────────────────────────────────────┐
│              gbrain CLI (real, unmodified, bun-linked globally)       │
│   gbrain init     → creates GBRAIN_HOME/{config.json,brain.pglite,…} │
│   gbrain import   → indexes ./fixtures/maras-coffee/**/*.md          │
│   gbrain embed --stale  → vector embeddings (OpenAI API)             │
│   gbrain query    → hybrid search → stdout response                  │
└─────────────────────────────────┬────────────────────────────────────┘
                                  │ reads/writes
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│                          Filesystem (repo)                            │
│   ./brains/<tenantId>/                                                │
│     ├─ brain.pglite       (embedded Postgres, vector + text index)   │
│     ├─ config.json        (search mode, model routing)               │
│     └─ brain-repo/        (markdown source of truth, git-tracked)    │
│   ./fixtures/maras-coffee/                                            │
│     ├─ invoices/*.md                                                 │
│     ├─ vendor-emails/*.md                                            │
│     ├─ bank-statements/*.md                                          │
│     └─ MANIFEST.md         (planted anomalies index for dev)         │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| **Frontend pages** (`app/page.tsx`, `app/onboard/page.tsx`, `app/dash/[tenantId]/page.tsx`) | UI: form, SSE log, chat, cards, reset button | React Server Components + small Client Components for `EventSource`/streaming |
| **Route Handlers** (`app/api/**/route.ts`) | HTTP boundary, SSE framing, request validation | Next.js 15 App Router, `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` |
| **gbrain client lib** (`lib/gbrain/`) | spawn wrapper, env injection, stdout/stderr line-parsing, tenant→path mapping | TS module, `node:child_process`, `node:fs/promises` |
| **Tenant registry** (`lib/gbrain/tenants.ts`) | In-process Map of `tenantId → { name, type, brainHome, createdAt, status }` | Process-local `Map`; resets on server restart (acceptable for demo) |
| **Insight cache** (`lib/gbrain/insights.ts`) | Pre-runs ~3 canned queries once per tenant, caches results | Process-local `Map<tenantId, InsightSet>`; invalidated on reset |
| **gbrain CLI** | Real brain: `init`, `import`, `embed`, `query` | Unmodified upstream binary, `bun link`-installed globally |
| **Brain directories** (`./brains/<tenantId>/`) | Per-tenant state: PGLite DB, config, markdown repo | Filesystem only; no DB in the web app |
| **Synthetic fixtures** (`./fixtures/maras-coffee/`) | Pre-baked markdown corpus consumed by `gbrain import` | Committed to repo, ~50–100 files, planted anomalies |

---

## Recommended Project Structure

```
quick-brain/
├── app/
│   ├── page.tsx                          # Landing: "Start your business brain"
│   ├── onboard/
│   │   └── page.tsx                      # Form + SSE progress log
│   ├── dash/
│   │   └── [tenantId]/
│   │       ├── page.tsx                  # Chat surface + insight cards
│   │       └── ChatClient.tsx            # Client component, EventSource
│   ├── api/
│   │   └── tenants/
│   │       ├── route.ts                  # POST: create tenant (no spawn yet)
│   │       └── [tenantId]/
│   │           ├── onboard/route.ts      # GET (SSE): init → import → embed
│   │           ├── chat/route.ts         # POST (SSE): query stream
│   │           ├── insights/route.ts     # GET: cached canned queries
│   │           └── reset/route.ts        # POST: rm -rf + clear caches
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   └── gbrain/
│       ├── client.ts                     # spawn() wrapper, env helpers
│       ├── onboard.ts                    # init → import → embed orchestration
│       ├── query.ts                      # gbrain query stdin/stdout
│       ├── insights.ts                   # canned queries + cache
│       ├── tenants.ts                    # in-memory registry
│       └── paths.ts                      # tenantId → brain dir, fixture dir
├── brains/                               # .gitignore — per-tenant brain dirs
│   └── .gitkeep
├── fixtures/
│   └── maras-coffee/
│       ├── invoices/                     # *.md, 30 files
│       ├── vendor-emails/                # *.md, 20 files
│       ├── bank-statements/              # *.md, 10 files
│       ├── notes/                        # *.md, ad-hoc business notes
│       └── MANIFEST.md                   # planted-anomaly index (dev only)
├── scripts/
│   ├── reset-all.sh                      # nuke all brain dirs
│   └── demo-check.sh                     # verify env, fixtures, gbrain version
├── .env.local                            # OPENAI_API_KEY, ANTHROPIC_API_KEY
├── .planning/                            # gsd workflow artifacts
├── next.config.ts
├── package.json
└── tsconfig.json
```

### Structure Rationale

- **`app/api/tenants/[tenantId]/...`** — RESTful per-tenant routes map cleanly to gbrain operations. Each route has one job; easy to reason about under time pressure.
- **`lib/gbrain/`** — The gbrain integration is the highest-risk surface. Concentrating it in one folder lets us debug, mock, and instrument it without scattering. **Route Handlers stay thin; logic lives here.**
- **`brains/` next to the repo (not `~/.gbrain`)** — Keeping brain dirs inside the project (a) makes reset trivial (`rm -rf brains/`), (b) keeps the operator's real `~/.gbrain` (if any) untouched, (c) makes it obvious to judges that brains are real on disk.
- **`fixtures/maras-coffee/` committed to repo** — Deterministic. No fetching at demo time. Markdown-first matches what `gbrain import` expects natively (no parser needed).
- **No `src/` layer** — Next.js convention. Don't fight it.

---

## Architectural Patterns

### Pattern 1: CLI-as-Backend via `child_process.spawn`

**What:** Treat the `gbrain` binary as the backend service. Next.js Route Handlers `spawn()` it per request with `GBRAIN_HOME` set to the tenant's brain directory.

**Why this over `gbrain serve --http`:**
- `gbrain serve --http` is an **OAuth 2.1 server** with bootstrap-token registration, scope control, and Dynamic Client Registration. Even loopback mode (`127.0.0.1`) requires OAuth client setup. **Multi-hour distraction at 7.5h budget.**
- CLI invocations are **stateless from our perspective** — gbrain reads `GBRAIN_HOME` per process. No long-running daemon to manage, restart, or port-collide.
- `gbrain init` is **non-TTY-aware**: when stdin is not a TTY (which `spawn` guarantees), it uses defaults. No interactive hang risk.
- One concrete failure mode is removed: no port to clash, no PID to track, no daemon lifecycle.

**Trade-offs:**
- ✅ Zero state in our app, trivial reset, simple mental model.
- ✅ Each invocation gets fresh env — perfect tenant isolation via `GBRAIN_HOME`.
- ❌ Per-invocation startup cost (~hundreds of ms for `gbrain query`). Acceptable for demo throughput (1 operator).
- ❌ No persistent connection for chat. Each query is one spawn. Streaming is over stdout, not WebSocket.

**Example:**

```typescript
// lib/gbrain/client.ts
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export type GBrainEnv = {
  brainHome: string;          // e.g. ./brains/<tenantId>/
  openaiKey: string;
  anthropicKey?: string;
};

export function spawnGBrain(args: string[], env: GBrainEnv) {
  return spawn('gbrain', args, {
    cwd: env.brainHome,
    env: {
      ...process.env,
      GBRAIN_HOME: env.brainHome,
      OPENAI_API_KEY: env.openaiKey,
      ANTHROPIC_API_KEY: env.anthropicKey ?? '',
      // CI=1 hints to non-interactive defaults if any prompt sneaks in
      CI: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
```

### Pattern 2: SSE via `ReadableStream` in Route Handlers (no Vercel AI SDK)

**What:** Stream onboarding progress and chat responses using a hand-rolled `ReadableStream` returned from a Route Handler. Frame events as standard SSE (`data: ...\n\n`).

**Why not Vercel AI SDK:**
- AI SDK's `streamText` expects LLM-shaped output (tokens, tool calls). Our chat is `gbrain query` stdout — a single response, not a token stream. Adapting it costs more than rolling our own.
- AI SDK's data stream protocol (with `x-vercel-ai-ui-message-stream: v1`) is overkill for "emit 5 progress lines then redirect."
- Hand-rolled SSE is ~30 lines and uses native `EventSource` on the client. Zero deps.

**When `streamText` *would* win:** if we were exposing the brain's token-by-token LLM output (e.g. if gbrain streamed assistant tokens directly). It doesn't — `gbrain query` returns a single response block.

**Example:**

```typescript
// app/api/tenants/[tenantId]/onboard/route.ts
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { tenantId: string } }) {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );

      try {
        send('phase', { name: 'init', message: 'Creating your brain…' });
        await runInit(params.tenantId, send);

        send('phase', { name: 'import', message: 'Reading invoices and emails…' });
        await runImport(params.tenantId, send);

        send('phase', { name: 'embed', message: 'Indexing for search…' });
        await runEmbed(params.tenantId, send);

        send('done', { tenantId: params.tenantId });
      } catch (err) {
        send('error', { message: String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
```

The runner functions pipe `child.stdout` line-by-line through `send('log', { line })` so the UI gets visible "ingesting invoice_0017.md…" feedback. **This is the demo "wow."**

### Pattern 3: Filesystem-as-State (no app DB)

**What:** The web app has zero database. All durable state lives in `./brains/<tenantId>/`. The tenant registry is an in-memory `Map` rebuilt by scanning `./brains/*` on server boot.

**Why:** A demo running for ~5 minutes on one laptop doesn't need durability. Adding SQLite/Postgres/Prisma is a multi-hour tax with zero demo payoff. The brain directory is the single source of truth — `ls ./brains/` is the tenant list.

**Trade-offs:**
- ✅ Reset is one `rm -rf` away.
- ✅ Inspect a tenant by `cd brains/<id> && ls`.
- ✅ Survives server restart by re-scanning the dir.
- ❌ Concurrent writes from two requests to the same tenant could race. Acceptable: single operator, single demo.

### Pattern 4: Insights as Pre-Run Canned Queries (parallel, cached)

**What:** On dashboard mount, fire 3 canned `gbrain query` calls in parallel (top vendors, monthly P&L, anomalies). Cache results in a process-local `Map<tenantId, InsightSet>`. Render skeleton cards immediately, swap in answers as each resolves.

**Why:** Insight cards must look "instant" but `gbrain query` takes seconds. Pre-running on dashboard mount means they're warm by the time the operator finishes saying "and here are the insights gbrain extracted." Parallel = floor wall-time at the slowest single query.

**Example:**

```typescript
// lib/gbrain/insights.ts
const CANNED_QUERIES = [
  { id: 'top-vendors', q: 'Who are my top 5 vendors by spend last quarter?' },
  { id: 'pnl-snapshot', q: 'Show monthly revenue vs expenses for the last 6 months.' },
  { id: 'anomalies',    q: 'What unusual charges or pattern breaks should I look at?' },
];

const cache = new Map<string, InsightSet>();

export async function getInsights(tenantId: string): Promise<InsightSet> {
  if (cache.has(tenantId)) return cache.get(tenantId)!;
  const results = await Promise.all(
    CANNED_QUERIES.map(async (c) => ({
      id: c.id,
      q: c.q,
      answer: await runQuery(tenantId, c.q),
    }))
  );
  const set: InsightSet = { tenantId, results, at: Date.now() };
  cache.set(tenantId, set);
  return set;
}
```

---

## Data Flow

### Flow 1: Onboarding (the 60-second wow moment)

```
[Browser /onboard]
   │
   │ 1. POST /api/tenants { name, type }
   ▼
[Route Handler]
   │  - generate tenantId (slug)
   │  - mkdir ./brains/<tenantId>/
   │  - add to in-memory registry { status: 'pending' }
   │  - return { tenantId } 200
   ▼
[Browser]
   │ 2. open EventSource('/api/tenants/<id>/onboard')
   ▼
[Route Handler — SSE stream]
   │
   │ 3. spawn `gbrain init`     (cwd=brains/<id>, GBRAIN_HOME=brains/<id>)
   │    pipe stdout → SSE 'log' events
   │    on exit code 0 → SSE 'phase' { name: 'import' }
   │
   │ 4. spawn `gbrain import ../../fixtures/maras-coffee/ --no-embed`
   │    pipe stdout → SSE 'log' events  (visible per-file progress)
   │
   │ 5. spawn `gbrain embed --stale`
   │    pipe stdout → SSE 'log' events
   │
   │ 6. SSE 'done' { tenantId }; close stream
   ▼
[Browser]
   │ 7. on 'done': router.push(`/dash/${tenantId}`)
   ▼
[/dash/[tenantId]]
   │ 8. mount triggers GET /api/tenants/<id>/insights (parallel canned queries)
   │ 9. user can immediately chat
```

**Why split init / import / embed into three spawns** (vs one): each is a distinct progress phase the user sees, and each can fail independently with a specific error message. `--no-embed` on import + explicit `embed --stale` is the documented pattern for visible-progress imports.

### Flow 2: Chat

```
[Browser ChatClient]
   │ POST /api/tenants/<id>/chat { question }
   ▼
[Route Handler — SSE stream]
   │  spawn `gbrain query "<question>"` (env: GBRAIN_HOME=brains/<id>)
   │  buffer stdout (gbrain query returns a single response block)
   │  on close → SSE 'answer' { text }; close
   ▼
[Browser]
   │ append assistant message to chat log
```

**v1 stays simple:** wait for full `gbrain query` response, send as single SSE event. The UI shows a "thinking" indicator. If we later find time, we can word-stream by chunking the response client-side for a typewriter effect — pure UI, no backend change.

### Flow 3: Insights

```
[/dash/[tenantId] mount]
   │ GET /api/tenants/<id>/insights
   ▼
[Route Handler]
   │  if cached → return cached JSON
   │  else → Promise.all([query1, query2, query3]) → cache → return
   ▼
[Browser]
   │ render 3 cards; skeleton until response, then fade in
```

### Flow 4: Reset (demo safety net)

```
[Browser reset button]
   │ POST /api/tenants/<id>/reset
   ▼
[Route Handler]
   │  - rm -rf ./brains/<tenantId>/
   │  - delete from registry
   │  - delete from insight cache
   │  - 204
   ▼
[Browser]
   │ router.push('/')
```

**Reset is global-safe:** kills only the named tenant. For a "nuke everything between rehearsals" path, `scripts/reset-all.sh` does `rm -rf ./brains/*` from the shell.

### State Locations

| State | Where it lives | Lifetime |
|-------|---------------|----------|
| Tenant metadata (name, type, status) | `Map` in `lib/gbrain/tenants.ts` | Process lifetime; rebuilt by scanning `./brains/*` on boot |
| Brain content (PGLite DB, markdown) | `./brains/<tenantId>/` filesystem | Durable until reset |
| Insight results | `Map` in `lib/gbrain/insights.ts` | Process lifetime; cleared on reset |
| Chat history | Client-side React state in `ChatClient.tsx` | Page-session only (refresh = gone, fine for demo) |
| Onboarding progress | SSE stream + transient client state | Stream duration only |

---

## Build Order (this becomes phase order)

The roadmapper should slice this into ~4 phases. Recommended:

### Phase 1 — Foundation: gbrain shell harness *(must work end-to-end before any UI polish)*

**Deliverable:** `lib/gbrain/client.ts` + a CLI smoke script that, given a tenantId, runs `init → import → embed → query` against `./fixtures/maras-coffee/` and prints results.

- `lib/gbrain/client.ts` — `spawnGBrain()`, stdout line iterator, error normalization.
- `lib/gbrain/paths.ts` — tenant → brain dir, fixtures path.
- `lib/gbrain/tenants.ts` — Map registry + filesystem rescan.
- `lib/gbrain/onboard.ts` — init/import/embed orchestration with progress callback.
- `lib/gbrain/query.ts` — single-shot query wrapper.
- `scripts/demo-check.sh` — verifies `gbrain --version`, `OPENAI_API_KEY`, fixtures exist.
- Minimal fixture set (5–10 files) for harness verification — the full ~50–100 file corpus lands in its own task but doesn't block this.

**Why first:** every downstream feature is "this, but with a UI on top." If gbrain shells out cleanly with per-tenant isolation, everything else is plumbing. If it doesn't, no UI saves us.

**Risk gate:** if `gbrain init` doesn't honor `GBRAIN_HOME` cleanly (e.g. it writes to `~/.gbrain` regardless), we discover it here and pivot to per-tenant `cwd`-only with relative paths before any UI is built.

### Phase 2 — Onboarding flow (form → SSE → redirect)

**Deliverable:** operator can fill in "Mara's Coffee / coffee shop" and watch a live progress log until dashboard loads.

- `app/page.tsx` — landing with "Start" CTA.
- `app/onboard/page.tsx` — form + client component subscribing to SSE.
- `app/api/tenants/route.ts` — POST creates tenant record + dir.
- `app/api/tenants/[id]/onboard/route.ts` — SSE stream wiring `onboard.ts` events through.
- Full synthetic fixture corpus (50–100 files) committed.

**Why second:** this is the demo's centerpiece. Build it before chat so we don't push it to the end and run out of time.

### Phase 3 — Chat surface

**Deliverable:** `/dash/[tenantId]` with a working chat that hits real `gbrain query`.

- `app/dash/[tenantId]/page.tsx` — server component scaffolding.
- `app/dash/[tenantId]/ChatClient.tsx` — client component with input, message list, EventSource.
- `app/api/tenants/[id]/chat/route.ts` — SSE wrapper around `query.ts`.

**Why third:** depends on Phase 1 (`query.ts`) and Phase 2 (a tenant exists). Can be a single afternoon block.

### Phase 4 — Insight cards + reset + demo polish

**Deliverable:** dashboard shows 3 insight cards, reset button works, "wow" query is rehearsed.

- `lib/gbrain/insights.ts` — canned queries + cache.
- `app/api/tenants/[id]/insights/route.ts` — JSON endpoint.
- Insight card components on the dashboard.
- `app/api/tenants/[id]/reset/route.ts` + reset button.
- One curated "what was weird about March?" query rehearsed end-to-end.
- `scripts/reset-all.sh`.

**Why last:** insights are nice-to-have; they're the polish layer. If we're at hour 6 with no insights, we still have a working demo. Reset is mandatory but trivial once everything else exists.

### Parallelizable

- **Fixture authoring** (writing the 50–100 markdown files with planted anomalies) is independent of all engineering after Phase 1's smoke set lands. The operator can ghostwrite these between code blocks or use an LLM batch-generation script.
- **Demo script** (the 3-minute talk track) can be drafted while Phase 3/4 land.

### Latest-possible additions

- `smb-audit` custom gbrain skill — out of scope unless 6+ hours remain, and even then only as a stretch.
- Word-by-word streaming of chat responses — pure client-side polish, last 30 min.
- Visual polish (animations, colors) — last 30 min.

---

## Scaling Considerations

| Scale | Adjustments |
|-------|------------|
| **1 operator, 1 demo (target)** | Current architecture is correct as-is. |
| **Several concurrent demo tenants on same machine** | Already supported via per-tenant `GBRAIN_HOME`. Watch for OpenAI API rate limits if multiple imports embed simultaneously. |
| **Hosted public demo** | Out of scope. Would require: real auth, per-user storage backend, gbrain-as-service (probably `gbrain serve --http` with OAuth), embedding cost controls, sandboxing of `spawn`. Don't build for this. |

### First bottleneck

**OpenAI embeddings during `gbrain embed`.** A 50–100 file corpus is ~100 embedding calls. Latency-bound, not us-bound. Mitigation: cache embeddings if we ever re-run; for the demo, accept the 5–10 second embed wall-time as part of the visible "indexing" phase — it makes the brain feel real.

---

## Anti-Patterns

### Anti-Pattern 1: Spinning up `gbrain serve --http` per tenant

**What people do:** Run a long-lived `gbrain serve --http` daemon per tenant on different ports, route the chat API through it.

**Why it's wrong:** `gbrain serve --http` is an OAuth 2.1 server — bootstrap tokens, client registration, scope management. Even loopback requires the OAuth dance. We'd burn 2+ hours on auth setup that delivers zero demo value. Port management, daemon lifecycle, and PID tracking are pure tax.

**Do this instead:** Stateless `child_process.spawn` of the CLI per request. Per-tenant isolation via `GBRAIN_HOME` env. Verified in gbrain docs: CLI commands honor `GBRAIN_HOME`.

### Anti-Pattern 2: Putting a database in the web app

**What people do:** Add Prisma + SQLite to track tenants, sessions, chat history "to do it right."

**Why it's wrong:** The brain directory IS the database. Adding another DB doubles the state stores and costs 1–2 hours in schema + migrations + queries for state we can derive from `ls ./brains/`.

**Do this instead:** In-memory `Map` rebuilt from filesystem on boot. Chat history is client-side React state.

### Anti-Pattern 3: Vercel AI SDK for non-LLM streams

**What people do:** Wire onboarding progress through `streamText` because "it's the streaming SDK."

**Why it's wrong:** AI SDK assumes LLM-shaped streams (tokens, tool calls, finish reasons). Forcing progress logs into that shape adds adapter code with no payoff. The data protocol header (`x-vercel-ai-ui-message-stream: v1`) is solving a problem we don't have.

**Do this instead:** Hand-rolled SSE via `ReadableStream` in a Route Handler. ~30 lines, native `EventSource` on the client, zero deps.

### Anti-Pattern 4: Streaming `gbrain query` token-by-token

**What people do:** Try to stream gbrain's response tokens to the UI.

**Why it's wrong:** `gbrain query` returns a single response block to stdout — not a token stream. Trying to make it stream tokens means modifying gbrain (out of scope) or faking it server-side. Pointless.

**Do this instead:** Send the full response as one SSE event. If you want a typewriter effect, do it client-side after receiving the answer. UI illusion, zero backend cost.

### Anti-Pattern 5: Trusting `~/.gbrain` as the brain location

**What people do:** Skip `GBRAIN_HOME` and let `gbrain init` write to `~/.gbrain`, then "figure out multi-tenancy later."

**Why it's wrong:** First two tenants will collide on `~/.gbrain`. Worse, if the operator already has a personal gbrain, this corrupts it. Reset becomes scary.

**Do this instead:** Set `GBRAIN_HOME=./brains/<tenantId>/` on every single spawn. Make the helper enforce it — no path means no spawn.

---

## Failure Modes & Fallbacks (demo-survival oriented)

| Failure | What user sees | Recovery / Fallback |
|---------|---------------|---------------------|
| `gbrain init` fails (missing API key, gbrain not on PATH, etc.) | SSE `error` event during onboarding. | Onboarding page shows error + "Try again" button. Pre-demo: `scripts/demo-check.sh` catches this before judges arrive. |
| `gbrain import` crashes halfway | SSE log shows last successful file; final `error` event. | Reset button → restart onboarding. **Pre-demo**: rehearse onboarding 3x to surface flakes. |
| `gbrain embed` rate-limited by OpenAI | Slow / hung embed step. | Per-spawn 60s timeout. On timeout: surface "indexing slowed — using keyword-only search for now" message and proceed. `gbrain query` works on keyword-only without embeddings. |
| `gbrain query` times out during live chat | Chat indicator hangs. | 15s timeout on query spawn. On timeout: append assistant message "Let me try a different angle — try asking again." **Pre-demo**: rehearsed "wow" query is timed and validated. |
| `gbrain query` returns empty/junk for the rehearsed question | Visible bad answer. | The dashboard has one **canned, hardcoded "demo highlight" card** with the rehearsed answer baked in if needed — labeled as a real gbrain result. (Stretch fallback; only if a query proves unreliable in rehearsal.) |
| Server-side process crashes mid-demo | Browser sees connection drop. | Tenant registry is rebuilt from filesystem on restart — `./brains/<id>/` still exists. Operator hits refresh. **Hot tip**: leave a terminal open with `bun dev` visible to catch this within 1s. |
| Port 3000 in use | Next dev fails. | `PORT=3001 bun dev`. `scripts/demo-check.sh` checks port availability. |
| Operator clicks reset by accident mid-demo | Tenant gone. | Reset button has a 2-second hold-to-confirm. Cheaper: put it behind a small modal. |
| Filesystem permission error writing `./brains/` | init fails on first run. | `scripts/demo-check.sh` creates `./brains/` with correct perms on startup. |

**Universal fallback:** the reset script makes any failure recoverable in <10 seconds. The demo is one fresh onboarding away from working again at any point.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes / Gotchas |
|---------|---------------------|-----------------|
| **OpenAI Embeddings** | Used by `gbrain embed`/`gbrain query`. We set `OPENAI_API_KEY` in spawned process env. | **Required for semantic search.** Without it, gbrain falls back to keyword-only. Pre-demo: verify quota. |
| **Anthropic (Claude)** | Optional. Used by gbrain for query expansion if `ANTHROPIC_API_KEY` set. | Optional — improves answer quality. Set it. |
| **gbrain CLI itself** | Installed via `git clone + bun install + bun link` (NOT npm). | Lock to a known-good commit hash in install instructions. Document version in README. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Route Handler ↔ `lib/gbrain` | Direct TS function calls | Keep handlers thin: parse → call lib → frame response |
| `lib/gbrain` ↔ gbrain CLI | `child_process.spawn` over stdout/stderr/exit code | Always set `GBRAIN_HOME`. Always parse stderr separately. Always set a timeout. |
| Frontend ↔ Backend | HTTP + SSE (`EventSource`) | No WebSockets. No tRPC. App Router conventions only. |
| Tenants ↔ Brains | tenantId is the directory name | tenantId = `slugify(name) + '-' + shortRand(4)` — collision-safe enough for one operator |

---

## Sources

- [gbrain README & install (verbatim INSTALL_FOR_AGENTS quotes)](https://github.com/garrytan/gbrain) — HIGH confidence: CLI commands, `GBRAIN_HOME`, env-var requirements, `--no-embed`+`embed --stale` import pattern
- [gbrain INSTALL_FOR_AGENTS.md (DeepWiki mirror & web search of repo file)](https://github.com/garrytan/gbrain/blob/master/INSTALL_FOR_AGENTS.md) — HIGH: exact install steps, OPENAI_API_KEY required vs ANTHROPIC_API_KEY optional
- [gbrain TODOS.md — `gbrain init` TTY detection plan](https://github.com/garrytan/gbrain/blob/master/TODOS.md) — HIGH: confirms non-TTY (spawn) gets defaults, no interactive hang
- [Next.js Streaming guide (App Router)](https://nextjs.org/docs/app/guides/streaming) — HIGH: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'` are required for SSE
- [Pedro Alonso — SSE in Next.js Route Handlers](https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/) — MEDIUM: pattern reference for `ReadableStream` SSE
- [Server Actions vs Route Handlers — Makerkit](https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers) — MEDIUM: confirms Route Handlers for SSE / long-running / `EventSource` consumers
- [Vercel AI SDK Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) — MEDIUM: confirms SDK targets LLM-shaped streams; reinforces decision to skip it
- [Next.js SSE Guide 2026 — nextjslaunchpad](https://nextjslaunchpad.com/article/nextjs-server-sent-events-real-time-notifications-progress-tracking-live-dashboards) — MEDIUM: current SSE patterns + caveats
- [gbrain.homes / DeepWiki gbrain pages](https://deepwiki.com/garrytan/gbrain/1.1-getting-started-and-installation) — MEDIUM: brain dir layout, PGLite default, search-mode config

---
*Architecture research for: QuickBrain (60-second SMB-onboarding shell around real gbrain)*
*Researched: 2026-05-16*
