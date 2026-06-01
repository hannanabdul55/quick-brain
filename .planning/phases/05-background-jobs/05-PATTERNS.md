# Phase 5: Background Jobs - Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 11 new / 1 modified
**Analogs found:** 11 / 11 (every new file has a strong in-repo analog)

> Phase 5 is greenfield mechanism-building. Almost nothing here is invented:
> the codebase already has SSE route handlers, zod-validated POST routes, a
> `postgres` access pattern, in-process gbrain entry points, a 5-stage progress
> orchestrator, smoke scripts, and the exact progress component the UI-SPEC
> says to generalize. This map points each new file at its analog.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `lib/inngest/client.ts` | config | — | `lib/gbrain/engine.ts` (module-level singleton) | role-match |
| `lib/inngest/functions.ts` | service | event-driven | `lib/onboarding/orchestrator.ts` (callback-driven async flow) | role-match |
| `app/api/inngest/route.ts` | route | event-driven | `app/api/tenants/[id]/onboard/route.ts` (route segment config + handler export) | role-match |
| `app/api/jobs/route.ts` | route | request-response | `app/api/tenants/route.ts` (zod-validated POST → side effect → JSON) | exact |
| `app/api/jobs/[id]/route.ts` | route | request-response | `app/api/tenants/[id]/insights/route.ts` (`[id]` GET, validate, read, JSON) | exact |
| `lib/jobs/store.ts` | service | CRUD | `lib/health/probes.ts` (`import postgres from "postgres"`, pooler URL) | role-match (only `postgres` consumer) |
| `lib/jobs/types.ts` | model | — | `lib/onboarding/orchestrator.ts` (discriminated-union event types) | exact |
| `lib/jobs/registry.ts` | utility | transform | `lib/gbrain/onboard.ts` (dispatch table over phases) | role-match |
| `lib/jobs/schemas.ts` | config | — | `lib/onboarding/schemas.ts` / `lib/chat/schemas.ts` (zod body schema + `z.infer`) | exact |
| `scripts/bench-gbrain.ts` | utility | batch | `scripts/concurrent-smoke.ts` / `scripts/mutex-smoke.ts` (`#!/usr/bin/env bun`, timed runs) | exact |
| `components/jobs/job-progress.tsx` | component | request-response (polled) | `components/onboard/onboarding-progress.tsx` (8px bar + stage checklist) | exact |
| `lib/jobs/use-job-status.ts` (poll hook) | hook | request-response (polled) | `app/onboard/page.tsx` `openEventSource` + `useEffect` cleanup (event-loop lifecycle) | role-match |

**Modified:** `lib/onboarding/orchestrator.ts` is *referenced* (not edited) by the
job registry. CONTEXT D-05 routes `runOnboarding` behind the job path via the
registry adapter — `orchestrator.ts` itself stays unchanged; its existing
`emit(OnboardingEvent)` callback is adapted to `reportProgress`.

## Pattern Assignments

### `app/api/jobs/route.ts` (route, request-response) — job trigger

**Analog:** `app/api/tenants/route.ts` (exact — zod-validated POST with a side effect, returns JSON)

**Route segment config** (copy verbatim — both must be present, see CONTEXT "Established Patterns"):
```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";   // gbrain Postgres client not edge-compatible
```
`tenants/route.ts` declares only `dynamic`. The job routes touch `postgres`, so
ALSO add `runtime = "nodejs"` — matching `chat/route.ts` and `onboard/route.ts`.

**JSON parse + zod validation pattern** (`app/api/tenants/route.ts` lines 19-39 — copy this exact shape):
```typescript
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "validation_failed", issues: [{ message: "invalid JSON body" }] },
      { status: 400 },
    );
  }

  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  // ...
}
```

**Side effect + response pattern** (`app/api/tenants/route.ts` lines 41-56):
```typescript
try {
  const jobId = await createJob(parsed.data.kind, parsed.data.params);
  await inngest.send({ name: "app/job.requested", data: { jobId, ...parsed.data } });
  console.log(`[jobs] created job kind=${parsed.data.kind}`);  // log metadata, NOT params (PII)
  return Response.json({ jobId }, { status: 202 });  // 202 Accepted — work is async
} catch (err) {
  // mirror TenantCreationError handling: typed error → JSON 500; unknown → re-throw
  throw err;
}
```
Note the `console.log` logs only the `kind`, never `params` — `tenants/route.ts`
line 43-44 sets this precedent ("log only slug ... to avoid leaking PII").
RESEARCH §Security V7 requires the same here.

---

### `app/api/jobs/[id]/route.ts` (route, request-response) — status polling

**Analog:** `app/api/tenants/[id]/insights/route.ts` (exact — `[id]` GET, validate, read, JSON; also a cache-then-DB read shape)

**`[id]` param + handler signature** (`insights/route.ts` lines 38-51):
```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;        // Next 15: params is a Promise — must await
  // ...
}
```
`insights/route.ts` omits `runtime` — add `runtime = "nodejs"` here because this
route imports `lib/jobs/store.ts` → `postgres`.

**Not-found → 404 pattern** (`insights/route.ts` lines 61-66, `onboard/route.ts` lines 49-54):
```typescript
const job = await getJob(id);
if (!job) {
  return Response.json(
    { error: "job_not_found", message: `No job with id: ${id}` },
    { status: 404 },
  );
}
```

**Status-projected JSON response** — return only browser-safe fields. RESEARCH
§Security V7 + RESEARCH "Pattern 3":
```typescript
return Response.json({
  status: job.status,
  progress: job.progress,
  stage: job.stage,
  result: job.status === "done" ? job.result : undefined,
  error: job.status === "error" ? job.error : undefined,
});
```
Keep `result` to a small structured payload (`{ tenantId }`), not raw gbrain
output. Truncate `error` — the chat route slices stderr to 500 chars
(`chat/route.ts` line 108: `result.stderr.slice(0, 500)`); do the same.

---

### `lib/jobs/store.ts` (service, CRUD) — Supabase Postgres job-row access

**Analog:** `lib/health/probes.ts` (the ONLY existing app-level `postgres` consumer — exact import + URL-resolution pattern)

**Import + connection** (`lib/health/probes.ts` line 18 + lines 92-109):
```typescript
import postgres from "postgres";

// Resolve URL with the SAME fallback chain engine.ts buildConfig() uses.
const database_url =
  process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
```
`probes.ts` uses a throwaway connection (`max: 1`, closed in `finally`) because
it is a one-shot probe. `store.ts` is called repeatedly per job, so create ONE
module-level `sql` client (the engine-pool singleton precedent — `engine.ts`
lines 53-54). **Critical pooler flag** (RESEARCH "Job store" example + `probes.ts` line 104):
```typescript
// port 6543 = Supavisor pooler → prepare:false is mandatory (gbrain's db.ts does this too)
const sql = postgres(process.env.SUPABASE_DB_URL_POOLER!, { prepare: false });
```

**Parameterized SQL — tagged templates, never string concat** (RESEARCH §Security "Tampering" + "Code Examples"):
```typescript
export async function createJob(kind: JobKind, params: Record<string, unknown>): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO app.jobs (kind, params) VALUES (${kind}, ${sql.json(params)})
    RETURNING id`;
  return row.id;
}
export async function updateProgress(jobId: string, p: JobProgress): Promise<void> {
  await sql`UPDATE app.jobs SET progress=${p.percent}, stage=${p.stage},
            updated_at=now() WHERE id=${jobId}`;
}
```
`${value}` interpolation in a `postgres` tagged template is parameterized — it
is NOT string concatenation. `probes.ts` line 112 uses the same form (`sql\`SELECT 1\``).

**Error text — no secrets/stack traces** (`probes.ts` security note T-04-02, lines 8-10):
the DB-probe failure detail "never echoes the postgres:// URL". `failJob()` must
sanitize before storing `error` — never the raw connection string or a full
stack trace.

> **Pitfall 4 (RESEARCH):** gbrain installs an auto-RLS event trigger on `public`
> tables. Create the `jobs` table in a separate `app` schema (`app.jobs`), or
> add an explicit allow policy. The plan MUST include a verify step: INSERT a
> row, then SELECT it back from a fresh connection.

---

### `lib/jobs/types.ts` (model) — the generic job contract

**Analog:** `lib/onboarding/orchestrator.ts` lines 28-50 (exact — discriminated-union event types) and `lib/gbrain/onboard.ts` lines 4-9 (`Phase` union + `ProgressEvent`)

**Discriminated-union + literal-union pattern** (`orchestrator.ts` lines 35-50):
```typescript
export type JobKind = "onboarding-import";          // Phase 7 adds "qbo-ingest"
export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobProgress {
  stage: string;     // human label, e.g. "Reading invoices"
  percent: number;   // 0..100
}

export type JobOperation = (
  params: Record<string, unknown>,
  reportProgress: (p: JobProgress) => Promise<void>,
) => Promise<unknown>;
```
The existing `OnboardingEvent` (`orchestrator.ts` lines 35-50) is the template:
a `type`-discriminated union. `lib/gbrain/onboard.ts` `Phase`/`ProgressEvent`
shows the same literal-union-of-string-stages convention. Stay consistent.

---

### `lib/jobs/registry.ts` (utility, transform) — JobKind → operation dispatch

**Analog:** `lib/gbrain/onboard.ts` (role-match — a dispatch table over a `Phase` enum) + RESEARCH "Pattern 1"

**Registry-map pattern** (RESEARCH "Pattern 1"):
```typescript
import type { JobKind, JobOperation } from "./types";
import { runOnboarding } from "@/lib/onboarding/orchestrator";

export const JOB_REGISTRY: Record<JobKind, JobOperation> = {
  "onboarding-import": async (params, reportProgress) => {
    const tenantId = params.tenantId as string;
    // Adapt runOnboarding's emit(OnboardingEvent) callback to reportProgress.
    await runOnboarding(tenantId, (event) => {
      if (event.type === "stage") {
        void reportProgress({
          stage: event.label,
          percent: Math.round(event.progress * 100),
        });
      }
    });
    return { tenantId };
  },
};
```
**Adapter detail:** `runOnboarding` (`orchestrator.ts` line 125) takes a SYNC
`emit` callback. `reportProgress` is async (a DB write). The registry adapter
bridges them — fire-and-forget the progress write (`void reportProgress(...)`)
or buffer it; do NOT block the orchestrator's tick loop on a DB round-trip.

> **Pitfall 6 (RESEARCH):** `runOnboarding` → `tenants.get(tenantId)` reads the
> in-memory filesystem-scanned registry, empty on a fresh serverless invocation.
> CONTEXT D-05 + RESEARCH Open Q1: prove the job path with the **seed tenant**
> (`SEED_TENANT_ID` from `lib/gbrain/paths.ts`) — it is ephemeral-FS-safe and in
> the registry on boot. Per-new-tenant job onboarding is Phase 6.

---

### `lib/jobs/schemas.ts` (config) — job-trigger payload validation

**Analog:** `lib/onboarding/schemas.ts` + `lib/chat/schemas.ts` (exact — both are ~15-line zod schema modules)

**Pattern** (`lib/onboarding/schemas.ts` lines 1-16, copy structure exactly):
```typescript
import { z } from "zod";

export const jobRequestSchema = z.object({
  kind: z.enum(["onboarding-import"]),     // reject unknown kinds (RESEARCH §Security V5)
  params: z.record(z.unknown()).default({}),
});

export type JobRequest = z.infer<typeof jobRequestSchema>;
```
`chat/schemas.ts` shows `.min()/.max()` constraints with custom messages;
`onboarding/schemas.ts` shows the `z.object` + `z.infer` export pair. The
`kind` enum MUST match `JobKind` in `types.ts` — RESEARCH §Security V5 requires
rejecting unknown `kind` values against the registry.

---

### `lib/inngest/client.ts` (config) — Inngest client singleton

**Analog:** `lib/gbrain/engine.ts` lines 53-54 (role-match — module-level singleton export)

**Pattern** (RESEARCH "Pattern 2" + engine.ts singleton precedent):
```typescript
import { Inngest } from "inngest";
export const inngest = new Inngest({ id: "quickbrain" });
```
A single module-level export, imported by both the serve route and the trigger
route — exactly how `enginePool` is a single module-level `Map` in `engine.ts`.

---

### `lib/inngest/functions.ts` (service, event-driven) — the one generic job function

**Analog:** `lib/onboarding/orchestrator.ts` (role-match — a callback-driven async flow with try/catch around the whole run and a terminal event)

**Pattern** (RESEARCH "Pattern 2"):
```typescript
import { inngest } from "./client";
import { JOB_REGISTRY } from "@/lib/jobs/registry";
import { setRunning, updateProgress, finishJob, failJob } from "@/lib/jobs/store";

export const runJob = inngest.createFunction(
  { id: "run-job", retries: 1 },              // retries LOW — import is not idempotent (Pitfall 3)
  { event: "app/job.requested" },
  async ({ event, step }) => {
    const { jobId, kind, params } = event.data as { /* ... */ };
    await step.run("mark-running", () => setRunning(jobId));
    try {
      const result = await step.run("execute", async () => {
        const op = JOB_REGISTRY[kind];
        return op(params, (p) => updateProgress(jobId, p)); // progress writes NOT a step
      });
      await step.run("mark-done", () => finishJob(jobId, result));
    } catch (err) {
      await step.run("mark-error", () => failJob(jobId, String(err)));
      throw err;                              // let Inngest record the failure
    }
  },
);
```
**Error-handling shape mirrors `orchestrator.ts` lines 152-220:** one try/catch
wrapping the whole run, terminal `done`/`error` events. Here the terminal events
are DB writes (`finishJob`/`failJob`) instead of SSE frames.

> **Anti-patterns (RESEARCH):** do NOT wrap each progress write in `step.run`
> (steps are memoized + replayed); keep `retries: 1` (re-running `gbrain import`
> double-imports — Pitfall 3).

---

### `app/api/inngest/route.ts` (route, event-driven) — Inngest serve handler

**Analog:** `app/api/tenants/[id]/onboard/route.ts` (role-match — route segment config + handler exports)

**Pattern** (RESEARCH "Pattern 2"):
```typescript
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { runJob } from "@/lib/inngest/functions";

export const runtime = "nodejs";    // codebase convention (onboard/chat routes both set this)
export const { GET, POST, PUT } = serve({ client: inngest, functions: [runJob] });
```
Unlike every other route this exports a destructured `{ GET, POST, PUT }` from
`serve()` rather than hand-written handlers — Inngest's App Router contract.
Keep `runtime = "nodejs"` for codebase consistency (`onboard/route.ts` line 26).

> **Pitfall 5 (RESEARCH):** `vercel.json` pins `bun@1.2.0` for `app/api/**/*.ts`
> — this route is caught by that glob. The plan MUST include a deploy-time smoke
> step: `GET /api/inngest` returns 200 JSON on the deployed URL. `INNGEST_SIGNING_KEY`
> must be set in prod so `serve()` verifies request signatures (RESEARCH §Security).

---

### `scripts/bench-gbrain.ts` (utility, batch) — p50/p95 latency benchmark (D-04)

**Analog:** `scripts/concurrent-smoke.ts` + `scripts/mutex-smoke.ts` (exact — both are `bun`-shebang scripts that time runs and `process.exit(1)` on failure)

**Shebang + import + timing pattern** (`concurrent-smoke.ts` lines 1-31):
```typescript
#!/usr/bin/env bun
// Measures p50/p95 of query / think / import against the seed brain (D-04).
import { queryInProcess } from "@/lib/gbrain/engine";
import { think } from "@/lib/gbrain/client";

const SEED = "seed";   // SEED_TENANT_ID from lib/gbrain/paths.ts

async function timed(label: string, fn: () => Promise<unknown>): Promise<number> {
  const start = Date.now();
  await fn();
  return Date.now() - start;
}
```
`concurrent-smoke.ts` imports in-process gbrain entry points (`query`,
`SEED_TENANT_ID`) from `lib/gbrain/index.ts` and prints timing — copy that. The
bench must call the SAME in-process entry points the app uses (`queryInProcess`,
`think`) — RESEARCH "Code Examples" gives the full percentile + warm-up
methodology (discard first run, n≥20 query / n≥10 think / n≥3 import).

**Top-level await + exit-code pattern** (`concurrent-smoke.ts` lines 33-42,
`mutex-smoke.ts` lines 89-93): both run top-level `await` and `process.exit(1)`
on failure. Bench prints `p50/p95/max` lines; commit the script + record the
numbers in the phase verification doc.

---

### `components/jobs/job-progress.tsx` (component, polled) — job progress UI

**Analog:** `components/onboard/onboarding-progress.tsx` (exact — UI-SPEC explicitly says "build by generalizing `OnboardingProgress`, not inventing a new look")

**`"use client"` + imports** (`onboarding-progress.tsx` lines 1-5):
```typescript
"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
```
Add `Badge` from `@/components/ui/badge` for the "Queued" / "Running" / "Still
working" pill (UI-SPEC Component Inventory: `variant="secondary"`, never `destructive`).

**Progress bar — 8px track, MUST stay identical** (`onboarding-progress.tsx` lines 34-45 — copy verbatim, do not change dimensions):
```tsx
<div
  className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
  role="progressbar"
  aria-valuenow={Math.round(progress * 100)}
  aria-valuemin={0}
  aria-valuemax={100}
>
  <div
    className="h-full rounded-full bg-neutral-900 transition-all duration-500"
    style={{ width: `${progress * 100}%` }}
  />
</div>
```
UI-SPEC: "Progress-bar track height: 8px (`h-2`) ... MUST stay 8px so polling
progress and SSE progress look identical." `transition-all duration-500` is the
required smooth-fill animation between polls.

**Stage checklist — done/current/pending tri-state** (`onboarding-progress.tsx` lines 48-79 — copy the `isDone/isCurrent/isPending` logic and the icon slot):
```tsx
<span className="flex h-4 w-4 shrink-0 items-center justify-center">
  {isDone &&    <span className="text-green-600 font-bold">&#10003;</span>}
  {isCurrent && <Loader2 className="h-4 w-4 animate-spin text-neutral-900" />}
  {isPending && <span className="h-2 w-2 rounded-full bg-neutral-300 block" />}
</span>
```
16×16 icon slot, green check, `animate-spin` `Loader2`, muted dot — UI-SPEC
Spacing/Color contracts require this exact treatment.

**New states to add (UI-SPEC Interaction Contract)** beyond `OnboardingProgress`:
`queued` (muted dot, 0% bar, "Queued" badge), `done` (100% bar, all checks,
"View results" primary `Button`), `error` (reuse `ErrorBanner` — see below),
slow-but-healthy ("Still working" badge after ~20s), poll give-up (neutral
"taking longer than expected"). The error state reuses `components/onboard/error-banner.tsx`
**as-is** (UI-SPEC: "SHOULD reuse this exact component").

---

### `lib/jobs/use-job-status.ts` (hook, polled) — bounded poll loop

**Analog:** `app/onboard/page.tsx` `openEventSource` + `useEffect` cleanup (role-match — the existing event-loop lifecycle, but `EventSource` → `setInterval` poll)

**Lifecycle + cleanup pattern** (`app/onboard/page.tsx` lines 44-51 — `useRef` holds the loop handle, `useEffect` cleans it up):
```typescript
const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
useEffect(() => {
  return () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };
}, []);
```
`onboard/page.tsx` uses `eventSourceRef` + a cleanup `useEffect` — the poll hook
mirrors it with an interval handle. **Bounded loop** — RESEARCH §Don't Hand-Roll:
never an unbounded `setInterval`; cap max-attempts, stop on `status: done`/`error`,
surface a soft-timeout state (~2s interval per UI-SPEC). The `done`-handler in
`onboard/page.tsx` lines 74-86 (close stream, navigate) is the template for the
poll's terminal handling.

## Shared Patterns

### Route segment config (every route file)
**Source:** `app/api/tenants/[id]/chat/route.ts` lines 41-42, `onboard/route.ts` lines 25-26
**Apply to:** `app/api/inngest/route.ts`, `app/api/jobs/route.ts`, `app/api/jobs/[id]/route.ts`
```typescript
export const dynamic = "force-dynamic";   // side effects / no caching
export const runtime = "nodejs";          // gbrain + postgres are not edge-compatible
```
CONTEXT "Established Patterns" makes this mandatory. `tenants/route.ts` and
`insights/route.ts` set only `dynamic` — the new job routes import `postgres`
so they need BOTH. The Inngest route also gets `runtime = "nodejs"` for
consistency (note: distinct from the `bun@1.2.0` *Vercel function* runtime in
`vercel.json` — see Pitfall 5).

### zod validation before side effects
**Source:** `app/api/tenants/route.ts` lines 31-39, `lib/onboarding/schemas.ts`
**Apply to:** `app/api/jobs/route.ts` (+ `lib/jobs/schemas.ts`)
```typescript
const parsed = someSchema.safeParse(body);
if (!parsed.success) {
  return Response.json({ error: "validation_failed", issues: parsed.error.issues }, { status: 400 });
}
```
`safeParse` + `{ error: "validation_failed", issues }` is the locked error
shape across `tenants`, `chat`, `insights` routes. CLAUDE.md + RESEARCH §Security
V5: any payload crossing into a Route Handler before a side effect MUST be
zod-validated.

### `[id]` param extraction (Next 15)
**Source:** `app/api/tenants/[id]/insights/route.ts` lines 38-43, `chat/route.ts` lines 48-53
**Apply to:** `app/api/jobs/[id]/route.ts`
```typescript
ctx: { params: Promise<{ id: string }> }
// ...
const { id } = await ctx.params;   // params is a Promise in Next 15 — must await
```

### `postgres` client access
**Source:** `lib/health/probes.ts` line 18 + lines 92-109
**Apply to:** `lib/jobs/store.ts`
- `import postgres from "postgres"` — the package is a gbrain transitive dep,
  already in `node_modules`, already force-bundled via `next.config.ts`
  `outputFileTracingIncludes` (`node_modules/postgres/**`). No `bun add`.
- URL fallback chain: `process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER`
- `{ prepare: false }` is mandatory — port 6543 is the Supavisor pooler.
- Tagged-template `${value}` interpolation is parameterized — never concatenate SQL.

### Error logging — metadata only, no PII / no secrets
**Source:** `chat/route.ts` line 100-101 ("Log metadata only — do NOT log the question text"), `tenants/route.ts` line 43-44 ("Log only slug ... avoid leaking PII"), `probes.ts` lines 8-10 (DB detail never echoes the postgres:// URL)
**Apply to:** `app/api/jobs/route.ts`, `lib/jobs/store.ts` (`failJob`), `app/api/jobs/[id]/route.ts`
- Log `kind` / `jobId` / `durationMs` — never `params` (may contain PII).
- `failJob` must sanitize `error` before storing — no raw stack trace, no
  connection string. Slice long strings (`chat/route.ts` line 108 slices stderr
  to 500 chars — copy that ceiling).

### Discriminated-union event/state types
**Source:** `lib/onboarding/orchestrator.ts` lines 35-50, `lib/gbrain/onboard.ts` lines 4-9
**Apply to:** `lib/jobs/types.ts`
`type`-discriminated unions for events, literal-string unions for enum-like
status/kind fields. Keep `lib/jobs` consistent with this established style.

### Client component lifecycle (`useRef` handle + `useEffect` cleanup)
**Source:** `app/onboard/page.tsx` lines 44-51, 53-99
**Apply to:** `lib/jobs/use-job-status.ts`, `components/jobs/job-progress.tsx`
A long-lived browser resource (there: `EventSource`; here: a poll interval) is
held in a `useRef` and torn down in a `useEffect` return. Terminal events
(`done`/`error`) stop the loop and trigger navigation/state change.

## No Analog Found

None. Every Phase 5 file maps to a strong in-repo analog. The only genuinely
*new* shape is the `serve({ client, functions })` destructured export in
`app/api/inngest/route.ts` — but that is Inngest's documented App Router
contract (RESEARCH "Pattern 2"), not a pattern the planner needs to invent. The
`scripts/bench-gbrain.ts` percentile methodology is documented end-to-end in
RESEARCH "Code Examples" / "Don't Hand-Roll".

## Metadata

**Analog search scope:** `app/api/**`, `lib/**`, `components/**`, `scripts/**`, `next.config.ts`, `package.json`
**Files scanned:** 16 (5 API routes, 6 lib files, 3 components, 2 scripts) + config
**Key infra facts confirmed by inspection:**
- `lib/health/probes.ts` is the sole existing app-level `postgres` consumer — exact analog for `lib/jobs/store.ts`.
- `next.config.ts` `outputFileTracingIncludes` already lists `node_modules/postgres/**` for `app/api/**/route.ts` — the `jobs`-table driver is pre-bundled.
- `inngest` is NOT in `package.json` — `bun add inngest` required (gate behind `checkpoint:human-verify` per RESEARCH A2).
- `components.json` present, shadcn `base-nova` preset; `Badge` (`@base-ui/react`-based), `Card`, `Button`, `Skeleton` all already in `components/ui/` — no new `shadcn add`.
- LSP note: cclsp MCP not connected this session; analogs inspected via plain-text grep / `cat` per the pattern-mapping fallback instruction.

**Pattern extraction date:** 2026-05-21
