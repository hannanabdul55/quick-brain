# Phase 5: Background Jobs - Context

**Gathered:** 2026-05-21
**Status:** Ready for planning

<domain>
## Phase Boundary

A background-job execution path for gbrain operations that exceed the
serverless function timeout. This phase delivers three things and nothing more:

1. **Measurement** — the p95 latency of each gbrain operation (query retrieval,
   `think` synthesis, import) is measured and documented, and the inline-vs-job
   threshold is set from that data.
2. **A job runner** — operations confirmed to exceed the timeout run as
   background jobs, not inline in a Route Handler.
3. **Visible progress** — the browser sees real-time progress for a running
   job; no silent multi-minute wait.

Operations that complete under the timeout keep running inline with no job
infrastructure overhead.

**Not this phase:** auth, per-user/per-tenant brain provisioning, QBO ingest,
the tenant-registry-on-Supabase rework, or any new product feature. Phase 5
builds the job *mechanism*; later phases are its consumers.

</domain>

<decisions>
## Implementation Decisions

All decisions below were auto-selected (`--auto` mode) using the recommended
option. They are defaults the planner may refine with research, not hard locks.

### Job Runner
- **D-01:** Use **Inngest** as the background-job runner. ROADMAP names it
  explicitly ("route long work through Inngest (or equivalent)"). Inngest has a
  mature free tier, a first-class Next.js/Vercel integration (Vercel
  Marketplace), and built-in step functions, retries, and a dev dashboard.
  Rejected alternatives: **Vercel Queues** (still public beta — too unproven
  for a foundation phase) and **gbrain Minions** (durable, but engine-coupled
  and designed for gbrain-internal *skill* jobs, not app-level orchestration;
  spike 003 only validated it on PGLite, not Postgres).

### Progress Delivery
- **D-02:** The browser receives job progress by **polling a status endpoint**,
  not via a long-lived SSE connection. A background job runs in a *separate*
  invocation from the request that started it, so it cannot hold the browser's
  SSE stream. Polling a `GET .../jobs/<id>` status route is the robust
  serverless pattern (no function-timeout risk on a kept-alive connection). The
  existing `lib/onboarding/sse.ts` SSE helpers remain valid for *inline*
  operations.
- **D-03:** Job state and progress persist in a **Supabase Postgres table** —
  the project's existing datastore, so no new vendor and the "no second cloud
  vendor without strong cause" constraint holds. Inngest's own run state is the
  execution record; the app-owned table is the progress surface the browser
  polls.

### Latency Measurement
- **D-04:** Derive the inline-vs-job threshold from a **repeatable benchmark
  script** (committed under `scripts/`) that runs query / `think` / import N
  times against the seed brain and reports p50/p95. Not production
  instrumentation — there is no real traffic yet (pre-auth, pre-QBO). The script
  plus a documented threshold is the deliverable for success criterion 1.

### Job-Path Scope
- **D-05:** Build **one generic job path** and route the onboarding/import
  operation through it now. Keep `query` (retrieval, ~1.3s per spike 006) and
  chat `think` **inline** pending the D-04 measurement. The job path is built
  generically so Phase 7's QBO ingest plugs in without rework. The chat route
  already carries a `Phase 5 will add...` marker comment on `think()` timeout
  handling — Phase 5 resolves that marker by confirming `think` stays inline
  unless measurement says otherwise.

### Claude's Discretion
- Exact Inngest function/step decomposition, job-table column names, and
  polling interval are left to research/planning.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 5: Background Jobs" — phase goal, the 4
  success criteria, JOBS-01..03 mapping, "UI hint: yes".
- `.planning/REQUIREMENTS.md` §JOBS — JOBS-01 (long ops as jobs), JOBS-02
  (browser progress via SSE or polling), JOBS-03 (measured inline-vs-job
  threshold).

### Phase 5 handoff + carried context
- `docs/phase-5-onboarding-handoff.md` — Phase 2→5 handoff doc. **Caveat:** it
  predates the v2.0 roadmap renumber. Its "Phase 5" content (Postgres per-tenant
  provisioning + tenant-registry-on-Supabase) is now Phase 6 work, NOT this
  phase. The researcher must reconcile: only the *background-jobs* concern is
  this phase. Useful here for code locations (`lib/gbrain/onboard.ts`,
  `client.ts`) and the ephemeral-FS context.
- `.claude/skills/spike-findings-quick-brain/SKILL.md` §"gbrain skill
  infrastructure" — spike 003: gbrain Minions / `jobs submit shell --follow`
  works on PGLite (~300ms overhead per invocation). Informs the "why not gbrain
  Minions" rejection in D-01.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/onboarding/sse.ts` — `sseFrame(event, data)` + `sseEventStream(generate)`
  (a `ReadableStream<Uint8Array>` wrapper). Reusable for *inline* progress
  streaming; the cross-function job-progress path uses polling instead (D-02).
- `lib/onboarding/orchestrator.ts` — `runOnboarding`, the existing 30–45s
  onboarding flow. The first operation to route behind the job path (D-05).
- `lib/gbrain/client.ts` — in-process `think()` + query entry points (from the
  Phase 3 in-process refactor). These are the operations D-04 measures.

### Established Patterns
- API routes use `runtime = "nodejs"` + `dynamic = "force-dynamic"` (gbrain's
  Postgres client is not edge-compatible). Any new job-trigger or job-status
  route must follow this.
- `vercel.json` pins `bun@1.2.0` runtime for all `app/api/**/*.ts`. Inngest's
  serve handler must run correctly under that runtime.
- SSE is already the in-app streaming convention — both the chat and onboard
  routes stream via `sseEventStream`.

### Integration Points
- `app/api/tenants/[id]/chat/route.ts` (~line 95) — explicit "Phase 5 will add"
  comment marker on `think()` timeout handling; D-05 resolves it.
- `app/api/tenants/[id]/onboard/route.ts` — onboarding SSE route; the import
  operation that moves behind the job path.
- New code expected: an Inngest serve route (`app/api/inngest/route.ts` by
  convention) and a job-status polling route.
- No `inngest` dependency is installed yet — package add required.

</code_context>

<specifics>
## Specific Ideas

**Open question the researcher MUST resolve before D-04 is interpreted:**

The real serverless timeout ceiling must be verified. PROJECT.md and ROADMAP
state "Vercel functions cap at 10s (Hobby) / 60s (Pro)". The current Vercel
platform default is **300s on all plans**, and `vercel.json` uses the modern
`functions` runtime config. The actual configured/allowed `maxDuration`
directly determines which operations even need a job. If the ceiling is 300s,
the inline-vs-job line moves substantially — possibly only QBO-scale import
ever needs a background job. The researcher must establish the true ceiling
first, then interpret the D-04 benchmark against it.

Also confirm Inngest free-tier limits (steps/month, concurrency) against
expected QuickBrain volume.

</specifics>

<deferred>
## Deferred Ideas

### Reviewed Todos (not folded)
- `.planning/todos/pending/tenant-registry-deploy-persistent.md` — the tenant
  registry is filesystem-based and breaks on stateless serverless. Matched
  Phase 5 weakly (0.4, keyword "phase" only) but is explicitly tagged
  `resolves_phase: 6` and aligns with Phase 6's per-user brain provisioning.
  Reviewed and correctly **not folded** — it belongs to Phase 6.
- Postgres per-tenant provisioning flow (the `onboard()` rewrite described in
  `docs/phase-5-onboarding-handoff.md`) — also Phase 6 territory under the
  renumbered v2.0 roadmap, not this phase.

</deferred>

---

*Phase: 5-Background Jobs*
*Context gathered: 2026-05-21*
