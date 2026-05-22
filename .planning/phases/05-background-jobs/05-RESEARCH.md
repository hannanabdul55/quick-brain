# Phase 5: Background Jobs - Research

**Researched:** 2026-05-21
**Domain:** Serverless background-job execution (Inngest) + latency benchmarking + polling-based progress UI
**Confidence:** HIGH

## Summary

Phase 5 builds a background-job mechanism for QuickBrain so that gbrain operations which exceed the serverless function timeout run out-of-band with visible browser progress. The single most consequential finding for planning is the **real Vercel timeout ceiling**: the CONTEXT.md contradiction resolves decisively in favor of the modern number. Vercel enabled Fluid Compute by default for all new projects as of 2025-04-23, and the QuickBrain Vercel project (`quickbrain`, created 2026-05-20 — well after that date) therefore runs with a **300-second default and 300-second maximum on the Hobby plan** `[VERIFIED: vercel.com/docs/functions/configuring-functions/duration]`. The legacy "10s Hobby / 60s Pro" figures in PROJECT.md and ROADMAP are stale pre-Fluid-Compute numbers. STATE.md's Accumulated Context already records this correction ("300s default all plans"). **This means the D-04 benchmark must be interpreted against a 300s line, not a 10s or 60s line** — and the current measured operations (query ~1.3s, `think` ~30s, onboarding 30-45s) all fit comfortably inside it. The operation that genuinely needs a background job is **QuickBooks ingest at real scale** (Phase 7), not anything Phase 5 measures today.

That reframes Phase 5's deliverable. It is not "move slow things off the request thread now" — nothing measured is slow enough. It is "**build the generic job path once, prove it with the onboarding/import operation routed through it (D-05), and document the measured threshold so Phase 7's QBO ingest plugs in without rework.**" Inngest (D-01, locked) is the runner: `inngest` v4.4.0 `[VERIFIED: npm registry]` is a mature, Apache-2.0 package from `github.com/inngest/inngest-js` with a first-class Next.js App Router serve handler. Its durable-execution model — each `step.run` is a *separate* HTTP invocation with its own fresh 300s window — is exactly the mechanism that lets a multi-minute workflow run on Hobby-tier serverless. The free tier (50,000 executions/month, 5 concurrent steps) is far above any plausible low-volume SMB load.

Progress reaches the browser by **polling a Supabase Postgres job-status row** (D-02/D-03, locked), not a long-lived SSE stream — correct, because the Inngest worker runs in a different invocation than the request that triggered it and cannot hold the browser's stream. The cleanest table-access path, given the project has no app-level ORM and gbrain owns its schema, is the **`postgres` npm package** (`postgres` v3.4.9) — which is **already an installed transitive dependency of gbrain** and is already force-included in the Vercel function bundle via `next.config.ts` `outputFileTracingIncludes`. No new database driver, no new vendor.

**Primary recommendation:** Install `inngest` v4.x. Build one generic `job` shape: a `jobs` table in Supabase Postgres (accessed via the already-bundled `postgres` package), an Inngest serve route at `app/api/inngest/route.ts`, one generic Inngest function that runs a registered operation and writes incremental progress rows, a job-trigger route, and a job-status polling route. Route onboarding/import through it as the first consumer. Keep `query` and chat `think` inline (both measured well under 300s). Deliver a committed `scripts/bench-gbrain.ts` that measures p50/p95 of query / `think` / import against the seed brain, and document the threshold as "300s Vercel ceiling; nothing inline today exceeds it; jobs exist for Phase 7 QBO scale."

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Trigger a background job | API / Backend (Route Handler) | — | A POST route validates input, inserts a `jobs` row, sends an Inngest event, returns the `jobId` immediately |
| Execute the long operation | Inngest worker (a separate serverless invocation of `app/api/inngest`) | API / Backend | Inngest invokes the serve route per step; each step gets a fresh 300s window. The in-process gbrain library runs *inside* this invocation |
| Persist job state + progress | Database / Storage (Supabase Postgres) | — | A `jobs` table is the app-owned progress surface the browser polls. Inngest's own run state is the execution record, not the UI surface |
| Deliver progress to browser | API / Backend (status polling route) + Browser (poll loop) | — | Browser polls `GET .../jobs/<id>` on an interval; route reads one `jobs` row. No long-lived connection |
| Render progress UI | Browser / Client | Frontend Server (SSR) | A client component drives the poll loop and renders stage label + percent (UI hint: yes) |
| Measure operation latency | Local dev script (`scripts/`) | — | Not production instrumentation — a repeatable benchmark run by a developer against the seed brain (D-04) |
| Inline operations (query, chat `think`) | API / Backend (Route Handler) | — | Stay exactly as they are today — in-process gbrain call inside the request, SSE for chat. No job overhead |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `inngest` | `^4.4.0` | Background-job runner: durable functions, step API, retries, dev dashboard, Next.js serve handler | Locked by D-01 and named in ROADMAP. Mature, Apache-2.0, first-class Next.js App Router integration (`inngest/next` serve handler). Durable step model gives each step a fresh full-duration window — the mechanism that beats serverless timeouts `[CITED: inngest.com/docs/learn/how-functions-are-executed]` |
| `postgres` | `3.4.9` (already installed) | SQL client for the app-owned `jobs` table in Supabase Postgres | **Already a transitive dependency of `gbrain`** and already force-bundled into the Vercel function via `next.config.ts` `outputFileTracingIncludes` (`node_modules/postgres/**`). Zero new dependency, zero new vendor. The project has no app-level ORM; raw parameterized SQL via `postgres` is the cleanest access path `[VERIFIED: package.json + next.config.ts inspection]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `inngest-cli` | `1.21.0` (dev-only, run via `bunx`) | Local Inngest Dev Server (`inngest dev`) — UI at `localhost:8288`, lets you trigger and inspect functions without the Inngest cloud | Local development only. Do NOT add as a `package.json` dependency — invoke as `bunx inngest-cli@latest dev` or rely on `npx inngest-cli@latest dev` per Inngest docs. Production uses the Inngest cloud + the deployed serve route `[CITED: inngest.com/docs/getting-started/nextjs-quick-start]` |
| `zod` | `^3.23.8` (already installed) | Validate the job-trigger route payload | The job-trigger route accepts a body and inserts a DB row + sends an Inngest event. One schema prevents malformed job parameters. Same pattern already used in `lib/onboarding/schemas.ts` and `lib/chat/schemas.ts` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inngest | Vercel Queues | Still public beta as of 2026 — too unproven for a foundation phase. Rejected in CONTEXT.md D-01 |
| Inngest | gbrain Minions | Durable but engine-coupled; designed for gbrain-internal *skill* jobs, not app-level orchestration. Spike 003 only validated it on PGLite, not Postgres. Rejected in CONTEXT.md D-01 |
| Inngest | Trigger.dev | Comparable durable-job product; would pull in a *second* job vendor with no benefit over the ROADMAP-sanctioned Inngest. Violates "no second cloud vendor without strong cause" |
| `postgres` (raw SQL) | Supabase JS client (`@supabase/supabase-js`) | The Supabase JS client targets the PostgREST/Auth API surface, not raw Postgres. Adding it pulls a new dependency for a job table that is plain SQL. `postgres` is already bundled — strictly less work |
| `postgres` (raw SQL) | Drizzle / Prisma | The project deliberately has no app-level ORM (CLAUDE.md "What NOT to Use" lists Drizzle/Prisma). gbrain owns its schema; the `jobs` table is one table — an ORM is pure overhead |
| Polling | Long-lived SSE for job progress | The Inngest worker runs in a *separate* invocation from the trigger request; it cannot write to the browser's SSE stream. A kept-alive SSE connection also risks the function-duration limit. Rejected in CONTEXT.md D-02 |

**Installation:**
```bash
bun add inngest
# postgres + zod are already installed (postgres is a gbrain transitive dep, zod is direct)
# inngest-cli is run on-demand, not installed:
bunx inngest-cli@latest dev
```

**Version verification (performed this session):**
- `npm view inngest version` → `4.4.0`, `time.modified` `2026-05-19` — current, published 2 days before research date `[VERIFIED: npm registry]`
- `npm view inngest license` → `Apache-2.0`; `repository.url` → `git+https://github.com/inngest/inngest-js.git` `[VERIFIED: npm registry]`
- `npm view inngest scripts.postinstall` → empty (no postinstall script — no install-time code execution risk)
- `npm view inngest-cli version` → `1.21.0` `[VERIFIED: npm registry]`
- `npm view postgres version` → `3.4.9` — already present in `node_modules` as a gbrain transitive dep `[VERIFIED: npm registry + next.config.ts references node_modules/postgres/**]`

## Package Legitimacy Audit

> slopcheck could not be installed in this environment (`pip install slopcheck` failed — no network/index access for the package). Per the graceful-degradation protocol, `inngest` is tagged `[ASSUMED]` and the planner SHOULD gate its install behind a `checkpoint:human-verify` task. The mitigating evidence below is strong: `inngest` is the package explicitly named in the project ROADMAP, has an official GitHub org repo, an Apache-2.0 license, a stable maintainer, no postinstall script, and millions of weekly downloads (a well-known product, not a niche package).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `inngest` | npm | mature (v4.x; org `inngest` active for years) | high (well-known background-job product) | github.com/inngest/inngest-js | unavailable | `[ASSUMED]` — planner adds `checkpoint:human-verify` before `bun add inngest` |
| `postgres` | npm | mature (v3.4.x) | very high | github.com/porsager/postgres | unavailable | Approved — **already installed** as a gbrain transitive dep; no new install action |
| `zod` | npm | mature | very high | github.com/colinhacks/zod | n/a | Approved — already a direct dependency |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Manual legitimacy notes:** `inngest` postinstall script confirmed empty (`npm view inngest scripts.postinstall` returned nothing) — no install-time code execution. The `inngest-cli` binary is run via `bunx` on demand, never installed, so it is not part of the dependency tree.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────────┐
  Browser                 │                Vercel                   │
  ───────                 │                                          │
                          │   app/api/jobs/route.ts  (TRIGGER)        │
  [Start onboarding]──POST─┼──▶ 1. zod-validate body                  │
                          │   2. INSERT jobs row (status=queued) ─────┼──▶ Supabase
       │                  │   3. inngest.send({ name, data:{jobId} }) ┼──▶ Postgres
       │  ◀── { jobId } ──┼── 4. return jobId immediately             │   "jobs" table
       │                  │                                          │       ▲
       │                  │   Inngest Cloud  ──invokes per step──▶    │       │
       │                  │   app/api/inngest/route.ts  (WORKER)      │       │
       │                  │     step.run("import", async () => {      │       │
       │                  │       runOnboarding / gbrain in-process ──┼───────┤ write
       │                  │       writeProgress(jobId, stage, pct) ───┼───────┘ progress
       │                  │     })  ← each step = fresh 300s window    │       rows
       │                  │     final: UPDATE jobs status=done|error ─┼──────▶│
       │                  │                                          │       │
       │  poll every ~2s  │   app/api/jobs/[id]/route.ts  (STATUS)    │       │
       └────────GET───────┼──▶ SELECT one jobs row ───────────────────┼───────┘ read
            { status,     │                                          │
              progress,   └─────────────────────────────────────────┘
              stage, result }
       │
  [render progress bar; on status=done → render result / redirect]
```

Data flow for the primary use case (onboarding behind a job):
1. Browser POSTs to the trigger route → row inserted, Inngest event sent, `jobId` returned in < 1s.
2. Inngest cloud calls the serve route (`app/api/inngest`); the worker runs the operation, writing progress rows mid-run.
3. Browser polls the status route every ~2s, reading the one `jobs` row.
4. When the row's `status` flips to `done`, the browser stops polling and renders the result.

### Recommended Project Structure
```
lib/
├── jobs/
│   ├── types.ts          # Job, JobStatus, JobKind, JobProgress types — the generic contract
│   ├── store.ts          # Supabase Postgres access: createJob, updateProgress, finishJob, getJob
│   │                     #   uses the `postgres` package; reads SUPABASE_DB_URL_POOLER
│   └── registry.ts       # maps JobKind -> the async operation to run (the generic dispatch)
├── inngest/
│   ├── client.ts         # new Inngest({ id: "quickbrain" })
│   └── functions.ts      # one generic runJob function: looks up registry, runs op, writes progress
├── gbrain/               # unchanged
└── onboarding/           # orchestrator.ts becomes a registered job operation (D-05)

app/api/
├── inngest/route.ts      # serve({ client, functions }) — exports GET, POST, PUT
├── jobs/route.ts         # POST: trigger a job (validate, INSERT row, inngest.send)
└── jobs/[id]/route.ts    # GET: poll job status (SELECT one row)
```

### Pattern 1: The generic job contract (D-05 — built once, Phase 7 plugs in)
**What:** A single `JobKind`-keyed registry maps an enum kind (`"onboarding-import"`, later `"qbo-ingest"`) to an async operation that accepts a `reportProgress` callback. The Inngest function, trigger route, and status route are all kind-agnostic.
**When to use:** Every long operation Phase 5+ routes off the request thread.
**Example:**
```typescript
// lib/jobs/types.ts
export type JobKind = "onboarding-import"; // Phase 7 adds "qbo-ingest"
export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobProgress {
  stage: string;      // human label, e.g. "Reading invoices"
  percent: number;    // 0..100
}

export type JobOperation = (
  params: Record<string, unknown>,
  reportProgress: (p: JobProgress) => Promise<void>,
) => Promise<unknown>; // resolved value becomes jobs.result

// lib/jobs/registry.ts
import type { JobKind, JobOperation } from "./types";
import { runOnboarding } from "@/lib/onboarding/orchestrator";

export const JOB_REGISTRY: Record<JobKind, JobOperation> = {
  "onboarding-import": async (params, reportProgress) => {
    const tenantId = params.tenantId as string;
    await runOnboarding(tenantId, async (event) => {
      if (event.type === "stage") {
        await reportProgress({ stage: event.label, percent: Math.round(event.progress * 100) });
      }
    });
    return { tenantId };
  },
};
```

### Pattern 2: Inngest serve route + one generic function
**What:** A single Inngest function reacts to `app/job.requested`, looks up the registry, runs the operation, and writes job state to Postgres throughout. Each `step.run` is a separate invocation with a fresh 300s window.
**Example:**
```typescript
// lib/inngest/client.ts
import { Inngest } from "inngest";
export const inngest = new Inngest({ id: "quickbrain" });

// lib/inngest/functions.ts
import { inngest } from "./client";
import { JOB_REGISTRY } from "@/lib/jobs/registry";
import { setRunning, updateProgress, finishJob, failJob } from "@/lib/jobs/store";

export const runJob = inngest.createFunction(
  { id: "run-job", retries: 1 },                       // keep retries low — see Pitfall 3
  { event: "app/job.requested" },
  async ({ event, step }) => {
    const { jobId, kind, params } = event.data as {
      jobId: string; kind: keyof typeof JOB_REGISTRY; params: Record<string, unknown>;
    };
    await step.run("mark-running", () => setRunning(jobId));
    try {
      const result = await step.run("execute", async () => {
        const op = JOB_REGISTRY[kind];
        return op(params, (p) => updateProgress(jobId, p)); // progress writes are NOT a step
      });
      await step.run("mark-done", () => finishJob(jobId, result));
    } catch (err) {
      await step.run("mark-error", () => failJob(jobId, String(err)));
      throw err; // let Inngest record the failure
    }
  },
);

// app/api/inngest/route.ts
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { runJob } from "@/lib/inngest/functions";

export const runtime = "nodejs";              // gbrain Postgres client is not edge-compatible
export const { GET, POST, PUT } = serve({ client: inngest, functions: [runJob] });
```

### Pattern 3: Trigger route + status polling route
**Example:**
```typescript
// app/api/jobs/route.ts  — POST: create + dispatch a job
import { inngest } from "@/lib/inngest/client";
import { createJob } from "@/lib/jobs/store";
import { jobRequestSchema } from "@/lib/jobs/schemas";  // zod

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const body = jobRequestSchema.safeParse(await req.json());
  if (!body.success) return Response.json({ error: "validation_failed", issues: body.error.issues }, { status: 400 });
  const jobId = await createJob(body.data.kind, body.data.params);   // INSERT row, status=queued
  await inngest.send({ name: "app/job.requested", data: { jobId, kind: body.data.kind, params: body.data.params } });
  return Response.json({ jobId }, { status: 202 });                  // 202 Accepted — work is async
}

// app/api/jobs/[id]/route.ts  — GET: poll status
import { getJob } from "@/lib/jobs/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "job_not_found" }, { status: 404 });
  return Response.json({
    status: job.status, progress: job.progress, stage: job.stage,
    result: job.status === "done" ? job.result : undefined,
    error: job.status === "error" ? job.error : undefined,
  });
}
```

### Anti-Patterns to Avoid
- **Holding an SSE stream open for a background job.** The worker runs in a different invocation; it physically cannot write to the trigger request's stream. Use polling (D-02).
- **Wrapping each progress write in `step.run`.** Steps are memoized and re-played on every function re-invocation. A progress write is a transient side-effect, not a checkpoint — keep it a plain `await` inside the operation. Only checkpoint at meaningful boundaries (`mark-running`, `execute`, `mark-done`).
- **Routing `query` or chat `think` through the job path.** Both are measured well under the 300s ceiling (query ~1.3s per Spike 006; `think` ~30s with haiku). Job infrastructure would add a poll round-trip and a DB write for zero benefit and break the chat UX. D-05 keeps them inline.
- **Putting the `jobs` table in gbrain's schema namespace.** gbrain owns and auto-migrates its 41 tables (and installs an auto-RLS event trigger on them). A `gbrain migrate` could collide with or RLS-lock an app-owned table. Create `jobs` as a plain app-owned table — and verify gbrain's auto-RLS trigger does not silently enable RLS on it (see Pitfall 4).
- **Adding `@supabase/supabase-js` for one table.** The `postgres` driver is already bundled. Adding the Supabase SDK is a new dependency for no gain.
- **Long Inngest retry counts on a non-idempotent import.** Re-running `runOnboarding`/`gbrain import` from scratch can double-import. Keep `retries: 1` or design the operation to be re-entrant (see Pitfall 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Running work past the serverless timeout | A custom `setTimeout`/detached-promise scheme that survives the response returning | Inngest durable functions | A detached promise on Vercel is killed when the function returns or the instance is recycled. Inngest re-invokes per step with managed state — the only reliable serverless pattern `[CITED: inngest.com/blog/how-to-solve-nextjs-timeouts]` |
| Job retries / failure handling | Hand-rolled retry loop + dead-letter logic | Inngest's built-in `retries` + run history | Inngest persists every run, retries with backoff, and shows failures in its dashboard. Re-implementing this is weeks of work and bugs |
| Knowing when a step already ran | A custom "have I done this?" flag table | Inngest step memoization | Inngest memoizes completed steps and replays them — re-invocation is automatic and correct |
| Latency percentiles | Eyeballing a few `console.time` numbers | A small benchmark script computing real p50/p95 over N runs | A p95 from 3 samples is meaningless. The script must run enough iterations (see D-04 methodology) and sort. This is ~30 lines, not a library — but it must be *written deliberately*, not guessed |
| Polling cadence / give-up logic | An unbounded `setInterval` with no ceiling | A bounded poll loop with a max-attempts cap and backoff | Unbounded polling leaks timers and hammers the DB if a job hangs. Cap attempts; surface a timeout state |

**Key insight:** The hard part of background jobs on serverless is not "start a job" — it is surviving function termination, retries, and state. Inngest exists precisely because hand-rolling that is a multi-week trap. Phase 5's job is to *wire* Inngest cleanly and generically, not to reinvent any of it.

## Runtime State Inventory

> Phase 5 is **greenfield mechanism-building**, not a rename/refactor/migration. It adds new files (Inngest routes, job lib, a new `jobs` table) and routes one existing operation through the new path. It does not rename or migrate existing stored data. This section is included only to record the one new stateful surface and the one external-config item Inngest introduces — both are *new state created by this phase*, not pre-existing state to migrate.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New `jobs` table created in Supabase Postgres (the existing gbrain database). No existing data renamed or migrated. | Create-table DDL — a new migration/setup step in this phase |
| Live service config | New: an **Inngest cloud app** must be created and synced. The Vercel↔Inngest integration (Inngest Marketplace) registers the deployed serve route URL with Inngest. This config lives in the Inngest dashboard, not git. | Operator step: create Inngest account/app, install the Vercel integration OR set env vars manually. Flag as a Phase 5 precondition |
| OS-registered state | None — no cron, no Task Scheduler, no pm2. Verified: `package.json` scripts and `vercel.json` contain no scheduled-job registration. | None |
| Secrets/env vars | New: `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` must be added to Vercel encrypted env config and `.env.local`. `INNGEST_DEV=1` is set only for local `bun run dev`. The `jobs` table reuses the existing `SUPABASE_DB_URL_POOLER` — no new DB credential. | Add 2 secrets to Vercel env config + `.env.example`; document in the phase |
| Build artifacts | None — `bun add inngest` updates `package.json` + lockfile normally; no egg-info / compiled-binary equivalent. Note `next.config.ts` `outputFileTracingIncludes` already covers `node_modules/postgres/**` — the `jobs` table's driver is already bundled. Confirm `node_modules/inngest/**` is reachable by the tracer (Inngest is a normal ESM package with static imports — the tracer follows it; no extra `outputFileTracingIncludes` entry expected, but verify on first deploy). | Verify Inngest bundles correctly on first Vercel deploy |

## Common Pitfalls

### Pitfall 1: Interpreting D-04 against the wrong timeout ceiling
**What goes wrong:** The plan treats "10s Hobby / 60s Pro" (from stale PROJECT.md/ROADMAP text) as the inline-vs-job line, concludes `think` (~30s) and onboarding (30-45s) must become jobs, and over-builds.
**Why it happens:** PROJECT.md and ROADMAP were written before Vercel's Fluid Compute default flip (2025-04-23) and were never updated. CONTEXT.md flags the contradiction explicitly.
**How to avoid:** The real ceiling is **300s default / 300s max on Hobby with Fluid Compute** `[VERIFIED: vercel.com/docs/functions/configuring-functions/duration]`. The QuickBrain project was created 2026-05-20, after the flip, so it has Fluid Compute on by default. STATE.md already records "300s default all plans." Interpret D-04 against 300s. Verify the project's Fluid Compute status in the Vercel dashboard (Settings → Functions) during the phase and document the confirmed number.
**Warning signs:** A plan task that says "route `think` through the job path because it exceeds 60s."

### Pitfall 2: Confusing Inngest's free-tier limits with a function-duration cap
**What goes wrong:** The plan assumes a single Inngest function run is capped at some short duration and over-decomposes.
**Why it happens:** Inngest's docs separate *platform* limits (50k executions/month, 5 concurrent steps on free `[CITED: inngest.com/docs/usage-limits/inngest]`) from *step* duration, which is bounded by the host platform (Vercel = 300s per step on Hobby).
**How to avoid:** Each `step.run` gets a fresh full 300s window because Inngest re-invokes the serve route per step `[CITED: inngest.com/docs/learn/how-functions-are-executed]`. A workflow can run for many minutes by chaining steps. The free tier (50k executions/month) is far above QuickBrain's low-volume SMB load — one onboarding ≈ a handful of executions. No paid tier needed for development. Stays within the "$0/mo free tier" constraint.
**Warning signs:** A plan that splits a 40s operation into ten artificial steps "to avoid timing out."

### Pitfall 3: Non-idempotent operations + Inngest retries causing double-imports
**What goes wrong:** `gbrain import` runs on a retry after a partial failure, ingesting the same documents twice.
**Why it happens:** Inngest retries failed functions by default. If `step.run("execute")` fails partway and re-runs, `runOnboarding`/`gbrain import` starts over without knowing prior work happened.
**How to avoid:** Set `retries: 1` (or `0`) on the job function for now — a failed import surfaces a clean error the user can re-trigger, rather than silently double-importing. Phase 7's QBO ingest, which is genuinely long, should be designed re-entrant (upsert by external ID, slug-prefixed per Spike 002a) so retries are safe. Document this as a Phase 7 design requirement.
**Warning signs:** Two copies of every vendor page after a transient network blip during import.

### Pitfall 4: gbrain's auto-RLS event trigger silently locking the app-owned `jobs` table
**What goes wrong:** The `jobs` table is created in the gbrain database; gbrain's installed auto-RLS event trigger (Spike 005: "RLS enabled on 41/41 public tables", and an auto-RLS event trigger) fires on the `CREATE TABLE` and enables RLS on `jobs` with no policy — so every `SELECT`/`INSERT` from the app silently returns or affects zero rows.
**Why it happens:** Spike 005 confirmed gbrain installs an *event trigger* that auto-enables RLS on new public tables. An app-owned table created in the same `public` schema is caught by it.
**How to avoid:** Three viable options, in order of preference: (a) create the `jobs` table in a **separate schema** (e.g. `app.jobs`) that the event trigger does not target — verify the trigger's scope; (b) after `CREATE TABLE jobs`, explicitly add an RLS policy that allows the app's connection role full access, or `ALTER TABLE jobs DISABLE ROW LEVEL SECURITY` if the connection is a trusted service role; (c) connect as a role that bypasses RLS (the Postgres table owner / service role). The phase MUST include a verification step: insert a row, then SELECT it back from a fresh connection, and confirm the row is visible. Do not assume the table is readable.
**Warning signs:** `INSERT` reports success, `SELECT` returns nothing, no error anywhere.

### Pitfall 5: Inngest serve route under the `bun@1.2.0` Vercel runtime
**What goes wrong:** `app/api/inngest/route.ts` is matched by `vercel.json`'s `app/api/**/*.ts` → `runtime: "bun@1.2.0"` glob. If the Inngest serve handler relies on a Node-only API the bun runtime doesn't cover, the route fails on deploy.
**Why it happens:** `vercel.json` pins the bun runtime for *all* API routes to load gbrain's raw `.ts`. The Inngest serve route is caught by that glob whether or not it touches gbrain.
**How to avoid:** Inngest's `inngest/next` serve handler is standard Web-Fetch-API code (it exports `GET`/`POST`/`PUT` returning `Response`) and works on Web-standard runtimes; bun's Node compatibility is high (CLAUDE.md confirms bun↔Node `child_process` parity). Expectation: it runs fine under `bun@1.2.0`. Risk is LOW but unverified for *this exact* runtime pin. The plan MUST include a deploy-time smoke step: hit `GET /api/inngest` on the deployed URL (Inngest's introspection endpoint returns 200 JSON) and trigger one job end-to-end. Also set `export const runtime = "nodejs"` on the inngest route for consistency with the codebase convention (chat/onboard routes already do this) — note that is the *Next.js* runtime segment, distinct from the *Vercel function* runtime in `vercel.json`.
**Warning signs:** `GET /api/inngest` returns 500 on the deployed URL but works locally.

### Pitfall 6: The in-memory tenant registry breaks job-triggered onboarding on serverless
**What goes wrong:** The job worker calls `runOnboarding(tenantId, ...)`, which calls `tenants.get(tenantId)` — but `lib/gbrain/tenants.ts` is an in-memory `Map` rebuilt by scanning the `brains/` filesystem directory. On a fresh serverless invocation (the Inngest worker is a *different* invocation than the trigger request) that Map is empty and the directory may not exist on the ephemeral FS.
**Why it happens:** The tenant registry is filesystem-backed (HARN-05) and was designed for a persistent-FS local demo. `docs/phase-5-onboarding-handoff.md` explicitly flags `lib/gbrain/tenants.ts` as needing a DB-backed replacement.
**How to avoid:** This is the seam between Phase 5 and Phase 6. The handoff doc assigns the *tenant-registry-on-Supabase* rework to Phase 6 (CONTEXT.md "Deferred Ideas" confirms: `tenant-registry-deploy-persistent.md` is `resolves_phase: 6`). **Phase 5 should build the generic job path and prove it, but the planner must decide how to demonstrate it without depending on the not-yet-built DB tenant registry.** Cleanest option: route the *seed* tenant's onboarding/import through the job path as the proof — the seed brain is already ephemeral-FS-safe (handoff doc) and exists in the registry on boot. Per-new-tenant job-triggered onboarding genuinely lands in Phase 6 when the tenant registry moves to Postgres. The plan must state this boundary explicitly and not assume new-tenant provisioning works on Vercel yet.
**Warning signs:** A plan task that routes "new tenant signup" through the job path and expects it to work on the deployed URL before Phase 6.

## Code Examples

### Job-status table schema (Claude's discretion — D-03 leaves column names open)
```sql
-- Create in a separate schema to dodge gbrain's auto-RLS event trigger (Pitfall 4).
-- Verify the trigger's scope; if it targets only `public`, `app` schema is safe.
CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app.jobs (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text        NOT NULL,                       -- 'onboarding-import', later 'qbo-ingest'
  status       text        NOT NULL DEFAULT 'queued',      -- queued | running | done | error
  progress     integer     NOT NULL DEFAULT 0,             -- 0..100
  stage        text,                                       -- human label, e.g. 'Reading invoices'
  params       jsonb       NOT NULL DEFAULT '{}'::jsonb,    -- operation input
  result       jsonb,                                      -- set when status=done
  error        text,                                       -- set when status=error
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_status ON app.jobs (status);
-- If gbrain's auto-RLS still catches app.jobs, add an explicit allow-all policy
-- for the app's connection role, or disable RLS on this table (service-role conn).
```

### Job store via the already-bundled `postgres` package
```typescript
// lib/jobs/store.ts
// Source pattern: `postgres` v3 docs (github.com/porsager/postgres). The driver
// is already bundled (next.config.ts outputFileTracingIncludes node_modules/postgres/**).
import postgres from "postgres";
import type { JobKind, JobProgress } from "./types";

// Reuse the SAME pooler URL gbrain uses (port 6543 → prepare:false for Supavisor).
const sql = postgres(process.env.SUPABASE_DB_URL_POOLER!, { prepare: false });

export async function createJob(kind: JobKind, params: Record<string, unknown>): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO app.jobs (kind, params) VALUES (${kind}, ${sql.json(params)})
    RETURNING id`;
  return row.id;
}

export async function setRunning(jobId: string): Promise<void> {
  await sql`UPDATE app.jobs SET status='running', updated_at=now() WHERE id=${jobId}`;
}

export async function updateProgress(jobId: string, p: JobProgress): Promise<void> {
  await sql`UPDATE app.jobs SET progress=${p.percent}, stage=${p.stage}, updated_at=now()
            WHERE id=${jobId}`;
}

export async function finishJob(jobId: string, result: unknown): Promise<void> {
  await sql`UPDATE app.jobs SET status='done', progress=100, result=${sql.json(result as object)},
            updated_at=now() WHERE id=${jobId}`;
}

export async function failJob(jobId: string, error: string): Promise<void> {
  await sql`UPDATE app.jobs SET status='error', error=${error}, updated_at=now() WHERE id=${jobId}`;
}

export async function getJob(jobId: string) {
  const [row] = await sql`SELECT * FROM app.jobs WHERE id=${jobId}`;
  return row ?? null;
}
```

### Benchmark script methodology (D-04)
```typescript
// scripts/bench-gbrain.ts  — run with: bun scripts/bench-gbrain.ts
// Measures p50/p95 of the three gbrain operations against the seed brain,
// using the SAME in-process entry points the app uses (lib/gbrain/*).
import { queryInProcess } from "@/lib/gbrain/engine";
import { think } from "@/lib/gbrain/client";
import { onboard } from "@/lib/gbrain/onboard";

const SEED = "seed";

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

async function bench(label: string, n: number, fn: () => Promise<unknown>) {
  await fn(); // 1 warm-up run, discarded — excludes cold connection-pool + gateway init
  const samples: number[] = [];
  for (let i = 0; i < n; i++) samples.push(await timeIt(fn));
  console.log(`${label}: n=${n} p50=${percentile(samples, 50).toFixed(0)}ms ` +
              `p95=${percentile(samples, 95).toFixed(0)}ms max=${Math.max(...samples).toFixed(0)}ms`);
}

// query retrieval (hybridSearch + expansion) — cheap, run many iterations
await bench("query", 30, () => queryInProcess(SEED, "What was weird about March?"));
// think synthesis — LLM-bound, expensive; fewer iterations
await bench("think", 10, () => think(SEED, "What was weird about March?", { model: "haiku" }));
// import / onboarding — very expensive; few iterations against a throwaway brain
await bench("import", 3, () => onboard({ tenantId: `bench-${Date.now()}` }));
```
**Methodology notes:**
- **Iteration counts:** p95 needs enough samples that the 95th-percentile index is a real observation, not an extrapolation. Use **n≥20 for `query`** (cheap, ~1.3s each — Spike 006), **n≥10 for `think`** (LLM-bound, ~30s each, costs API calls), **n≥3 for `import`** (minutes each, costs API calls + creates brains). Document the chosen n alongside the result so the number is reproducible.
- **Warm-up:** discard the first run of each operation — it pays cold connection-pool creation (`createGBrainEngine`), gateway init (`configureGateway`), and gbrain module load. The benchmark measures steady-state.
- **Environment caveat:** the script runs *locally* against the Supabase-backed seed brain. Vercel function latency (cold starts, network) differs. Document the measurement as "local in-process latency against Supabase Postgres" and treat it as a lower bound for the serverless number.
- **Output:** commit the script under `scripts/` and record the p50/p95 numbers + the 300s ceiling interpretation in the phase's verification doc. This script + the documented threshold *is* the deliverable for Success Criterion 1.
- **`import` measurement caveat:** `onboard()` still uses `gbrain init --yes` (local PGLite) and the `spawnGBrain` path. Benchmarking it creates throwaway local brains. If that is undesirable, measure import time from the existing seed-flow logs instead, or measure only the `gbrain import` + `embed` steps. The planner should decide; either way the numbers feed the same threshold doc.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Vercel serverless: 10s Hobby / 60s Pro hard cap | Fluid Compute default: 300s default + 300s max Hobby, 800s max Pro | 2025-04-23 (Fluid Compute default for new projects) | The "long operation must be a job" line moved from ~10s to 300s. Most QuickBrain operations now fit inline. The PROJECT.md/ROADMAP "10s/60s" text is stale `[VERIFIED: vercel.com/docs]` |
| Hand-rolled job queues (BullMQ + Redis) on serverless | Durable-execution platforms (Inngest, Trigger.dev) — no queue infra to run | ~2023-2024 onward | No Redis, no worker process to keep alive. Inngest re-invokes your existing serverless function per step. CLAUDE.md already lists BullMQ/Inngest under "avoid a background job queue" for the *hackathon* — that constraint is v1.0-scoped; v2.0 ROADMAP explicitly sanctions Inngest |
| `vercel.json` `functions` with `maxDuration` | Per-route `export const maxDuration = N` segment config (Next.js ≥13.5) | Next.js 13.5+ | A specific route can raise/lower its own ceiling in code. QuickBrain's `vercel.json` sets *runtime* (`bun@1.2.0`) but not `maxDuration` — so every route currently uses the 300s default. A route can opt into a shorter cap with `export const maxDuration` `[CITED: vercel.com/docs/functions/configuring-functions/duration]` |

**Deprecated/outdated:**
- "Vercel Hobby caps functions at 10s" — pre-Fluid-Compute. False for any project created after 2025-04-23, which includes `quickbrain` (created 2026-05-20).
- The CLAUDE.md "What NOT to Use → A background job queue (BullMQ, Inngest...)" row — explicitly a v1.0 hackathon constraint; superseded by the v2.0 ROADMAP which names Inngest as the Phase 5 runner. Phase 10 (CLEAN-05) will rewrite that table.

## Project Constraints (from CLAUDE.md)

CLAUDE.md is hackathon-era (v1.0); several directives are explicitly superseded by the v2.0 ROADMAP. The planner must honor the *still-current* ones and ignore the superseded ones:

**Still binding:**
- **Bun end-to-end.** `bun add inngest`, `bunx` for one-off CLIs (`bunx inngest-cli@latest dev`), `bun run` for scripts.
- **`zod` for any payload that crosses into a Route Handler before side effects.** The job-trigger route MUST zod-validate its body (same pattern as `lib/onboarding/schemas.ts`).
- **No second cloud vendor without strong cause.** Inngest is the *one* sanctioned new vendor (ROADMAP names it). The `jobs` table reuses existing Supabase Postgres. Pull in nothing else.
- **Real gbrain integration, not mocked.** The benchmark and the job operation call real in-process gbrain entry points (`lib/gbrain/*`).
- **`runtime = "nodejs"` + `dynamic = "force-dynamic"` on API routes.** gbrain's Postgres client is not edge-compatible. New job/inngest routes follow this.
- **`vercel.json` pins `bun@1.2.0` for `app/api/**/*.ts`.** The new Inngest + job routes are caught by this glob — verify they run under the bun runtime (Pitfall 5).

**Superseded by v2.0 ROADMAP (do NOT treat as binding):**
- CLAUDE.md "What NOT to Use → background job queue (BullMQ, Inngest...)" — v1.0-scoped; ROADMAP sanctions Inngest for Phase 5.
- CLAUDE.md PGLite-as-runtime, single-laptop, 7.5h-hackathon framing — v2.0 is hosted on Vercel + Supabase.

**GSD workflow:** CLAUDE.md requires file-changing work to go through a GSD command — this research and the resulting plan satisfy that.

## Assumptions Log

> Claims tagged `[ASSUMED]` that need user/operator confirmation before becoming locked decisions.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `quickbrain` Vercel project has Fluid Compute enabled (300s ceiling). Inferred from project creation date 2026-05-20, after the 2025-04-23 default flip. | Pitfall 1 / State of the Art | If somehow disabled, the ceiling drops to 60s and `think`/onboarding may need jobs after all. **Mitigation: the plan MUST include a verification step — check Vercel dashboard Settings → Functions for Fluid Compute status and the default max duration.** |
| A2 | `inngest` v4.x is legitimate and safe to install. slopcheck was unavailable this session. | Package Legitimacy Audit | Low risk — `inngest` is ROADMAP-named, has an official org repo, Apache-2.0 license, no postinstall. **Mitigation: planner adds a `checkpoint:human-verify` task before `bun add inngest`.** |
| A3 | The Inngest `inngest/next` serve handler runs correctly under the `bun@1.2.0` Vercel function runtime. | Pitfall 5 | Medium risk — not verified for this exact runtime pin. **Mitigation: the plan MUST include a deploy-time smoke test (`GET /api/inngest` returns 200; one job runs end-to-end on the deployed URL).** |
| A4 | gbrain's auto-RLS event trigger will catch a new app-owned table in the `public` schema. Inferred from Spike 005's "auto-RLS event trigger installed" finding. | Pitfall 4 | Medium risk — the trigger's exact scope (all `public` tables vs. only gbrain-created ones) is not verified. **Mitigation: the plan MUST verify after `CREATE TABLE` that the app can read its own rows; use a separate `app` schema or an explicit RLS policy as a hedge.** |
| A5 | `query` (~1.3s) and chat `think` (~30s, haiku) stay comfortably under 300s and remain inline. Latency figures from Spike 006 / CONTEXT.md, not re-measured this session. | Don't Hand-Roll / D-05 | Low risk — even a 5-10x regression keeps them under 300s. The D-04 benchmark re-measures and confirms; the plan should not lock the inline decision until the benchmark runs. |

## Open Questions

1. **How does Phase 5 demonstrate the job path without the Phase 6 DB-backed tenant registry?**
   - What we know: D-05 routes onboarding/import through the job path. `runOnboarding` depends on `lib/gbrain/tenants.ts`, an in-memory filesystem-scanned registry that is empty on a fresh serverless invocation (Pitfall 6). The DB-backed tenant registry is explicitly Phase 6.
   - What's unclear: whether the planner routes the *seed* tenant through the job path (works today — seed brain is ephemeral-FS-safe) or builds a minimal stopgap.
   - Recommendation: prove the generic job path with the **seed tenant's import/onboarding** as the consumer. The job *mechanism* is fully testable that way. New-tenant job-triggered onboarding genuinely lands in Phase 6. State this boundary in the plan.

2. **Vercel↔Inngest integration vs. manual env vars.**
   - What we know: Inngest has a Vercel Marketplace integration that auto-syncs the serve route and sets keys; alternatively `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` can be set manually in Vercel env config.
   - What's unclear: which the operator prefers. The integration is one click but adds a marketplace connection; manual env vars are explicit and match how the project already handles all 13 secrets.
   - Recommendation: manual env vars — consistent with the project's existing "secrets in Vercel encrypted env config" pattern (DEPLOY-02) and avoids a marketplace dependency. Document both `INNGEST_*` keys in `.env.example`. Flag "create an Inngest account + app" as an operator precondition.

3. **Should the `import`/onboarding job operation be re-measured given `onboard()` still uses the local-PGLite `spawnGBrain` path?**
   - What we know: `lib/gbrain/onboard.ts` still calls `gbrain init --yes` + `gbrain import` via `spawnGBrain` (local PGLite). The handoff doc assigns the Postgres-provisioning rewrite to Phase 6.
   - What's unclear: whether Phase 5 benchmarks the *current* (PGLite-spawn) import or waits for the Phase 6 Postgres-provisioning rewrite.
   - Recommendation: benchmark the current import path for the threshold doc (it is what exists), and note in the plan that the import operation behind the job path may change shape in Phase 6 — the *generic job contract* insulates the trigger/poll/status code from that change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `inngest` npm package | The whole job runner (D-01) | ✗ (not installed) | target `^4.4.0` | none — `bun add inngest` required |
| `postgres` npm package | `jobs` table access | ✓ (transitive dep of gbrain) | 3.4.9 | none needed — already present |
| `zod` npm package | Job-trigger payload validation | ✓ (direct dep) | ^3.23.8 | none needed |
| `inngest-cli` (local dev server) | Local job testing | ✗ (run on demand) | 1.21.0 | run via `bunx inngest-cli@latest dev` — no install |
| Inngest cloud account + app | Production job execution + dashboard | ✗ (operator must create) | — | none — operator precondition |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest SDK ↔ cloud auth | ✗ (not set) | — | none — must add to Vercel env config + `.env.local` |
| Supabase Postgres (gbrain DB) | `jobs` table host | ✓ (Phase 2) | PG 17 | none needed — reuses `SUPABASE_DB_URL_POOLER` |
| Bun 1.2.x | Runtime for everything | ✓ | 1.2.x | none needed |

**Missing dependencies with no fallback:**
- `inngest` npm package — `bun add inngest` is a required phase task (gated behind `checkpoint:human-verify` per A2).
- Inngest cloud account/app + `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` — **operator preconditions.** Flag before the phase can fully deploy/verify. Local dev can proceed with `INNGEST_DEV=1` + `bunx inngest-cli dev` without cloud keys.

**Missing dependencies with fallback:**
- `inngest-cli` — never installed; run via `bunx` on demand.

## Security Domain

> `security_enforcement` is not set in `.planning/config.json` (absent = enabled). This section is included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partially | Phase 5 has no user auth (that is Phase 6). But the Inngest serve route MUST verify request signatures so only Inngest can invoke it — `INNGEST_SIGNING_KEY` provides this automatically when set |
| V3 Session Management | no | No sessions in Phase 5 |
| V4 Access Control | yes | The job-status route (`GET /api/jobs/[id]`) exposes job state. Pre-auth (Phase 6 adds auth), a `jobId` is an unguessable UUID acting as a capability token — anyone with the UUID can read the job. Acceptable pre-auth; Phase 6 should scope job rows to the owning user |
| V5 Input Validation | yes | The job-trigger route MUST zod-validate its body (`kind`, `params`) before INSERT + `inngest.send`. Reject unknown `kind` values against the registry |
| V6 Cryptography | no | No crypto in Phase 5. Inngest signature verification is library-handled |
| V7 Error Handling / Logging | yes | Job `error` text is stored and surfaced. Do NOT store raw stack traces or secrets in `app.jobs.error`. Follow the existing chat-route pattern (log metadata, not payloads); never log `params` if they could contain PII |

### Known Threat Patterns for Inngest + Next.js + Supabase Postgres

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Forged request to the Inngest serve route triggers arbitrary job execution | Spoofing | `INNGEST_SIGNING_KEY` set in env → `inngest/next` `serve` verifies the HMAC signature on every request automatically. MUST be set in production. Without it, the route accepts unsigned requests |
| Signing/event keys leak via repo or client bundle | Information Disclosure | `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` are server-only — never `NEXT_PUBLIC_` prefixed. Store in Vercel encrypted env config + gitignored `.env.local` (matches DEPLOY-02 pattern) |
| SQL injection via job `params` into the `jobs` table | Tampering | Use the `postgres` package's tagged-template parameterization (`sql\`... ${value}\``) — never string-concatenate SQL. Validate `params` with zod first |
| Unbounded job triggering (no auth pre-Phase-6) → execution-quota exhaustion / cost | Denial of Service | Pre-auth the trigger route is unauthenticated. Inngest free tier caps at 50k executions/month — a runaway loop could exhaust it. Mitigation: keep the trigger route minimal pre-auth (it is exercised only by the demo/seed flow); Phase 6 gates it behind a session. Consider a simple per-IP or global rate cap if the route is publicly reachable before Phase 6 |
| `jobId` enumeration to read other jobs' results | Information Disclosure | Use `gen_random_uuid()` (122-bit) for `jobs.id` — not sequential integers. An attacker cannot guess a UUID. Phase 6 adds per-user scoping |
| Job `result`/`error` columns leak gbrain internals or PII to the browser | Information Disclosure | The status route returns `result`/`error` to the browser. Keep `result` to a small structured payload (e.g. `{ tenantId }`), not raw gbrain output; truncate/sanitize `error` (the chat route already slices stderr to 500 chars) |

## Sources

### Primary (HIGH confidence)
- `vercel.com/docs/functions/configuring-functions/duration` — Fluid Compute duration table: Hobby 300s default / 300s max, Pro 300s/800s; per-route `export const maxDuration`; `vercel.json` `functions` config. Page `last_updated: 2026-02-27`.
- `inngest.com/docs/getting-started/nextjs-quick-start` — Next.js App Router setup: client, `serve` route, `createFunction`, `step` API, `inngest dev`, env vars.
- `inngest.com/docs/learn/serving-inngest-functions` + `inngest.com/docs/reference/serve` — App Router serve handler requires `GET`/`POST`/`PUT`; `INNGEST_SIGNING_KEY` env var.
- `inngest.com/docs/learn/how-functions-are-executed` — durable execution: each step is a separate HTTP request with a fresh full-duration window; step memoization.
- npm registry (`npm view`) — `inngest` 4.4.0 (Apache-2.0, repo inngest/inngest-js, no postinstall), `inngest-cli` 1.21.0, `postgres` 3.4.9.
- Codebase inspection (`git show`) — `package.json`, `vercel.json`, `next.config.ts`, `lib/gbrain/{client,engine,onboard,tenants,paths}.ts`, `lib/onboarding/{orchestrator,sse,create-tenant,schemas}.ts`, `app/api/tenants/[id]/{onboard,chat}/route.ts`, `vitest.config.ts`, `types/gbrain.ts`, `.planning/config.json`.

### Secondary (MEDIUM confidence)
- `inngest.com/docs/usage-limits/inngest` (via WebSearch) — free tier: 50,000 executions/month, 5 concurrent steps, 256KB event payload. Per-step duration bounded by host platform.
- `vercel.com/changelog/higher-defaults-and-limits-for-vercel-functions-running-fluid-compute` (via WebSearch) — Fluid Compute default for new projects since 2025-04-23.
- `docs/phase-5-onboarding-handoff.md`, `.claude/skills/spike-findings-quick-brain/SKILL.md` — gbrain RLS auto-trigger, in-memory tenant registry, spike 003 Minions findings.

### Tertiary (LOW confidence)
- None relied upon. slopcheck was unavailable — `inngest` is consequently tagged `[ASSUMED]` (see A2) despite strong corroborating evidence.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `inngest` and `postgres` verified on npm; Inngest setup verified against official docs; `postgres` already bundled per `next.config.ts`.
- Architecture: HIGH — the trigger→worker→poll pattern is the documented Inngest+serverless pattern; integration points read directly from the codebase.
- Vercel timeout ceiling: HIGH — verified against `vercel.com/docs` (page dated 2026-02-27) and corroborated by STATE.md's own recorded correction.
- Pitfalls: MEDIUM-HIGH — Pitfalls 1, 2, 3 are HIGH (doc-verified). Pitfalls 4 (gbrain auto-RLS scope) and 5 (Inngest under `bun@1.2.0`) are MEDIUM — flagged in the Assumptions Log with required verification steps.

**Research date:** 2026-05-21
**Valid until:** 2026-06-20 (30 days — stable domain; Inngest API and Vercel limits move slowly. Re-verify the Vercel duration table and Inngest free-tier numbers if planning slips past this date.)
