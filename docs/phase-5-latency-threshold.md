# Phase 5 Latency Threshold — Inline vs. Job Decision

**Version:** Phase 5 (2026-05-22)
**Requirement:** JOBS-03 / Decision D-04  
**Reproducible measurement source:** `scripts/bench-gbrain.ts`

---

## Summary

The inline-vs-job threshold is derived from measured latency, not guessed. The Vercel function
duration ceiling is **300 s** (Fluid Compute default, confirmed — see below). All three gbrain
operations were measured against the production seed brain.

Result: **`query` and `think` stay INLINE. `import` MUST be a background job.**

---

## Measured Latencies

All measurements were taken locally against the Supabase Postgres seed brain using the same
in-process entry points the app uses (`queryInProcess`, `think`, `onboard`). These are
**lower bounds** for Vercel serverless numbers — the deployed path adds cold-start latency
and network overhead.

| Operation | Entry point | n | p50 | p95 | max | Notes |
|-----------|-------------|---|-----|-----|-----|-------|
| **query** | `queryInProcess(SEED_TENANT_ID, q)` | 30 | 2537 ms | 6222 ms | 7073 ms | 1 warm-up discarded |
| **think** | `think(SEED_TENANT_ID, q, { model: "haiku" })` | 10 | 9215 ms | 11289 ms | 11289 ms | 1 warm-up discarded; LLM-bound |
| **import** | `onboard({ tenantId: "bench-<epoch>" })` | — | ~120 s+ (variable) | — | ~120 s+ | See note below |

**Import note:** The warm-up run completed in under 120 s. The first timed sample exceeded
the `onboard()` / `spawnGBrain` 120 000 ms spawn-timeout and the benchmark aborted. Import
duration is therefore bounded at approximately **120 s and is highly variable** — it brushes
and exceeds the 120 s timeout even before hitting the 300 s Vercel ceiling. It is not cleanly
measurable above 120 s without raising the spawn-timeout constant. The benchmark recorded
the outcome and aborted rather than hang.

**Why iteration counts are correct for the confidence needed:**

- `query` n=30 → p95 index is the 29th of 30 observations — a real p95 measurement.
- `think` n=10 → p95 index is the 10th of 10 observations — directional (LLM-bound; variance
  is token count, not infrastructure noise). Directional confidence is sufficient for a
  threshold decision.
- `import` — one complete warm-up confirms the operation completes; the timeout abort on the
  first timed sample is the relevant data point.

---

## Confirmed Vercel Function Duration Ceiling

**Ceiling: 300 s** on all plans (Hobby and Pro) with Fluid Compute.

Evidence:

1. Vercel platform default function execution timeout is **300 s on all plans** following the
   2025-04-23 Fluid Compute default flip. Fluid Compute is the default runtime for all new
   Vercel projects.
2. `vercel.json` in this repo declares **no `maxDuration` override** — it only sets
   `bunVersion` and a `bun@1.2.0` runtime for `app/api/**/*.ts`. Functions therefore inherit
   the 300 s default.

**The stale "10s Hobby / 60s Pro" figures that appear in PROJECT.md and ROADMAP predate the
2025-04-23 Fluid Compute default flip and are superseded by this document.** Do not use those
figures for timeout planning. See also `docs/deploy.md` (Phase 4) which confirms 300 s under
"Vercel Hobby Free-Tier Limits."

---

## Inline vs. Job Threshold Decision

| Operation | p95 (local) | Fits in 300 s? | Decision | Rationale |
|-----------|-------------|----------------|----------|-----------|
| **query** | ~6 s | Yes (4.8% of ceiling) | **INLINE** | Well within a single request. No job needed. D-05 confirmed. |
| **think** | ~11 s | Yes (3.7% of ceiling) | **INLINE** | Comfortably inside one request even with Vercel overhead. D-05 confirmed. |
| **import** | ~120 s+ (variable) | Technically yes, but NOT safe | **BACKGROUND JOB** | See rationale below. |

### Why import must be a background job (not inline)

Even though ~120 s is below the 300 s ceiling, running `import` inline is unacceptable:

1. **User-facing silent wait.** A multi-minute inline onboarding request leaves the user
   staring at a spinner with zero progress feedback and no way to resume if the connection
   drops.
2. **Variable, ceiling-adjacent latency.** The measured duration already brushes the
   `onboard()` 120 000 ms spawn-timeout. Any additional overhead (Vercel cold start, network
   RTT, large-dataset tenant) will push it past 120 s and toward the 300 s ceiling. The
   variance is not bounded.
3. **No recovery path.** If an inline request times out or the client disconnects, the
   partially-initialized brain is orphaned with no mechanism to resume or clean up.

**Decision (D-04 / JOBS-03):** The import / onboarding operation routes to Inngest as a
background job. The Phase 5 plans build the generic job infrastructure and wire `import` to
it. Phase 7's QBO ingest at real scale will also use this path.

---

## Why `query` and `think` do NOT need a background job

Per decision D-05:

- `query` p95 ~6 s is fast enough to return in a single HTTP response (or SSE frame) with
  no perceptible hang and no risk of Vercel timeout.
- `think` p95 ~11 s is similarly safe. The chat UI already streams the answer via SSE, so
  the user sees incremental output rather than a blank wait.

Both operations stay on the existing `app/api/tenants/[tenantId]/chat/route.ts` inline path.

---

## Reproducibility

Run the benchmark at any time to update these numbers:

```bash
# Prerequisites: OPENAI_API_KEY, ANTHROPIC_API_KEY, GBRAIN_DATABASE_URL in env
# The seed brain must be seeded (bun run scripts/seed.ts)
bun scripts/bench-gbrain.ts
```

See `scripts/bench-gbrain.ts` for iteration counts, warm-up logic, and the import
SKIP_IMPORT_BENCH escape hatch.

To measure import without the 120 s spawn-timeout limit, increase `GBRAIN_SPAWN_TIMEOUT_MS`
in `lib/gbrain/onboard.ts` (or equivalent constant) before running the benchmark.
