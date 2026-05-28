---
spike: 008
name: inngest-supabase-pool
type: integration
validates: "Given the Supabase free-tier transaction pooler (port 6543, ~60 backend cap) reached through gbrain's default max:10 connection pool, when N concurrent queries fire from a single in-process engine and when M concurrent Inngest-shaped jobs each run 5 serial step.run() boundaries, then no concurrency failure mode (error / silent stall / timeout) manifests up to the practical limits Phase 7 expects (M ≤ 10 jobs, N ≤ 50 effective concurrent queries)"
verdict: VALIDATED
related: [005, 006, 007]
tags: [supabase, postgres, pool, inngest, concurrency, phase-7-risk, performance]
---

# Spike 008: Inngest concurrency × Supabase free-tier pool

## What This Validates

Phase 7's step-divided Inngest function (D-07) fires 5 `step.run()` boundaries
per ingest job. With M concurrent QBO ingest jobs across tenants → up to M×5
effective concurrent queries through the SINGLE shared engine
(`lib/gbrain/engine.ts`, gbrain's default `max: 10` connection pool via
`DEFAULT_POOL_SIZE_FALLBACK`).

The architectural question for Phase 7: at what concurrency does the Supabase
free-tier pool (or the gbrain max:10 pool sitting in front of it) become the
failure mode? Does Phase 7 need to pre-tune `GBRAIN_POOL_SIZE`, batch ingest
work, or stage Inngest fanout?

## Research

From gbrain source:

- `node_modules/gbrain/src/core/db.ts:16` — `DEFAULT_POOL_SIZE_FALLBACK = 10`.
  Override via `GBRAIN_POOL_SIZE` env var.
- `node_modules/gbrain/src/core/postgres-engine.ts:130` — instance pool
  configured with `max: size, idle_timeout: 20, connect_timeout: 10`.
- gbrain auto-detects port 6543 → `prepare: false` (Supavisor transaction-mode
  convention). Each tagged-template query runs in an implicit single-query
  transaction; no prepared-statement caching.
- Spike 006 baseline: in-process engine + connect + first hybridSearch = 1.34s
  cold path (single tenant).

Supabase free tier documented limits:
- Direct connection: 60 concurrent backends per project.
- Transaction pooler (port 6543, Supavisor): much higher effective concurrency
  by recycling backends across transaction boundaries.

## How to Run

```bash
cd "quick-brain"
set -a && . ./.env.local && set +a   # SUPABASE_DB_URL_POOLER
export PATH="$HOME/.bun/bin:$PATH"
bun .planning/spikes/008-inngest-supabase-pool/spike.ts
```

The script:
1. Connect a single shared engine (same pattern as `lib/gbrain/engine.ts`).
2. **Baseline pool-stat:** 30 concurrent `pg_backend_pid()` queries (parameterized
   — see Investigation Trail #1) to count distinct Supavisor backends issued
   by the cold pool.
3. **Burst ramp:** N = 1, 5, 10, 20, 50, 100, 200 concurrent simple queries.
   Record success count, error count, p50/p99/max latency at each N.
4. **Inngest-shaped simulation:** M = 1, 3, 5, 10 concurrent jobs. Each job
   runs 5 serial queries (each `SELECT pg_sleep(0.05)` to mimic step.run()
   work). Wall-clock measured per M.
5. Disconnect.

Read-only — no rows written. Total runtime ~7s.

## What to Expect

`FINAL VERDICT: VALIDATED ✓` after ~7s with 0 errors at every N. Burst latency
table + Inngest-sim table printed to stdout. Forensic log in
`spike-events.json`.

## Observability

`spike-events.json` is the forensic log with per-phase timings + burst result
tables + the verdict block. The HTML page (`result.html`) renders the burst
ramp as a tableau.

## Investigation Trail

### Burst ramp — Supabase + gbrain pool absorbs every level tested

| N (concurrent SELECTs) | total ms | p50 ms | p99 ms | max ms | success |
|---:|---:|---:|---:|---:|---:|
| 1 | 71 | 71 | 71 | 71 | 1/1 |
| 5 | 74 | 65 | 74 | 74 | 5/5 |
| 10 | 80 | 79 | 80 | 80 | 10/10 |
| 20 | 162 | 127 | 162 | 162 | 20/20 |
| 50 | 407 | 223 | 407 | 407 | 50/50 |
| 100 | 753 | 404 | 753 | 753 | 100/100 |
| 200 | **1897** | **841** | **1895** | **1897** | **200/200** |

**0 errors at every level.** The pool absorbs everything from 1 to 200
concurrent queries through a single engine instance.

Latency rises linearly with queue depth above N=10 (the pool ceiling):
- At N≤10 the pool is uncontended; latency ≈ network RTT to Supabase.
- At N=50 queue depth is ~5 (50 queries / 10 conns); p50 ≈ 223ms.
- At N=200 queue depth is ~20; p50 ≈ 841ms, p99 ≈ 1.9s.

The latency growth is **predictable** — there's no cliff or hard cutoff, just
M/M/c queueing where c = 10.

### Inngest-shaped simulation — 5-step jobs scale well

| M (concurrent jobs) | total ms | effective queries | failed |
|---:|---:|---:|---:|
| 1 | 595 | 5 | 0 |
| 3 | 647 | 15 | 0 |
| 5 | 694 | 25 | 0 |
| 10 | 688 | 50 | 0 |

Each job runs 5 serial `SELECT pg_sleep(0.05)` queries (~50ms each = 250ms
ideal wall-clock per job). The interesting observation: **M=10 jobs (50
effective queries) finished in 688ms — basically the same wall-clock as M=1**
(595ms).

Why: each Inngest-shaped job spends most of its 250ms in `pg_sleep` (Postgres
side, not pool-blocking on conn acquisition). With 10 pool conns + 10
concurrent jobs running 50ms sleeps, pool utilization stays well below
saturation. The 10 jobs all chew through their 5 steps in lockstep.

**For Phase 7 this means:** firing 10 concurrent QBO ingest jobs (across 10
tenants OR 10 connector phases) is well within the pool's capacity. The
real-world embedding call latency (1.9s from spike 007) is going to dominate,
not pool contention.

### Bonus finding — parameterless `executeRaw` HANGS against Supavisor

The original spike included a post-load pool-stat probe with this query:

```typescript
await engine.executeRaw(`SELECT pg_backend_pid() AS pid`);
//                                                ^ no parameters
```

The first run got through the entire ramp + Inngest sim, then hung
indefinitely on the post-load probe. Reproduced cold (before any load) too —
parameterless `executeRaw` hangs forever against this Supavisor pooler.

**The fix:** add any dummy parameter:

```typescript
await engine.executeRaw(`SELECT $1::int AS i, pg_backend_pid() AS pid`, [i]);
//                                                                       ^ params present
```

With the parameter, the same probe completed in 71ms and returned 9 distinct
Supavisor backends (proving gbrain's max:10 ceiling is active wire-side).

Most likely root cause: postgres.js with `prepare: false` against Supavisor
treats parameterless tagged templates differently — possibly trying to use a
prepared statement on a code path the pooler refuses. (Not verified — gbrain's
internal code paths probably never call `executeRaw` with zero params, so this
isn't a gbrain bug — it's an integration footgun.)

**Phase 7 implication:** every direct `engine.executeRaw` call in production
code (e.g. the QBO connector's source-row INSERT from spike 007's finding)
MUST include at least one $N parameter. Use a sentinel if needed:

```typescript
// SAFE — has a parameter
await engine.executeRaw(`SELECT $1::text FROM sources WHERE id = $1`, [tenantId]);

// HANGS — parameterless
await engine.executeRaw(`SELECT 1 FROM sources LIMIT 1`);
```

### Surprising gotcha — the hang doesn't time out

`gbrain/src/core/postgres-engine.ts:132` sets `connect_timeout: 10` but NOT a
per-query timeout. There's a separate `resolveSessionTimeouts()` that wires
`statement_timeout` + `idle_in_transaction_session_timeout` via the
connection's `startup parameters`. These should bound any single query — yet
the parameterless probe hung indefinitely (killed via `pkill -9` after 60s).

Hypothesis: the query never reaches Postgres at all — it's stuck in
postgres.js's client-side handling of the empty-params tagged template, never
emerging onto the wire. statement_timeout doesn't fire on traffic that never
left the client. This is an additional reason to enforce the "always pass at
least one parameter" rule.

## Results

**VERDICT: VALIDATED ✓**

Phase 7 can ship at any realistic v2.0 concurrency without pool-tuning
concerns. The Supabase free tier + gbrain's default max:10 pool sustains 200
concurrent simple queries and 10 concurrent Inngest-shaped 5-step jobs (50
effective queries) without any errors. The bottleneck is pool queueing
(predictable M/M/c growth), not the upstream pooler or Postgres.

### Confirmed facts

| Question | Answer |
|---|---|
| Does Supabase free-tier pool error at N=200 concurrent SELECTs through a single max:10 gbrain engine? | NO — 0/200 failed, 1.9s wall-clock |
| Does the Inngest 5-step ingest shape scale to M=10 concurrent jobs? | YES — 688ms wall-clock at M=10 (basically unchanged from M=1) |
| Does gbrain's max:10 default need to be raised for Phase 7? | NO — even at N=200 the pool is the rate-limit, not Supabase |
| What's the practical Phase 7 ceiling we tested? | M=10 concurrent jobs / N=200 queries / 50 effective Inngest-step queries — all clean |
| Is there a hidden failure mode at any tested concurrency? | NO normal errors; BUT discovered the parameterless-executeRaw-hang footgun |

### Findings that shape Phase 7

1. **Default pool sizing (gbrain max:10) is sufficient.** Phase 7 plans do not
   need `GBRAIN_POOL_SIZE` tuning. The Supabase free tier easily handles M=10
   concurrent Inngest jobs at the rate Phase 7 will see in v2.0.

2. **Latency is predictable, not cliff-y.** Phase 7's progress UI (07-UI-SPEC.md
   `<JobProgress>` phase-labeled stream) shouldn't promise specific timing
   for ingest — at low load each step is sub-100ms; under M=10 concurrent
   load each step is ~140ms (688/5). The real wall-clock blocker will be the
   1.9s OpenAI embedding call per page (spike 007), not pool contention.

3. **Add a lint rule: `engine.executeRaw` must have at least one parameter.**
   Parameterless calls hang silently against the Supavisor pooler in
   production. Suggested rule: any `engine.executeRaw(template)` call where
   the second arg is missing or `[]` is a lint error. Auto-fix: append a
   sentinel `SELECT $1::int FROM ... WHERE $1 = 1` argument.

4. **The 10-conn pool ceiling is wire-active.** The bonus probe (30 cold
   queries) returned only **9 distinct Supavisor backends** — confirming
   gbrain's `max: 10` is the effective wire concurrency, not 1 (singleton
   client) and not 30+ (unlimited). The pool reuses backends after each
   transaction.

5. **No need to per-tenant the engine.** Spike 010 already proved a single
   shared engine survives concurrent multi-tenant access (20 interleaved
   queries, 0 leaks). Spike 008 adds: a single shared engine also has more
   than enough pool capacity for v2.0's tenant volume. The cheap "one engine"
   pattern is fully validated.

### Cross-references

- Spike 005 — established the Supabase free-tier baseline (gbrain on
  Supabase works; 45s migration; 90/100 doctor score).
- Spike 006 — established in-process retrieval baseline (1.34s cold path
  single-tenant).
- Spike 007 — measured the cost of one importFromContent call (1.9s incl.
  OpenAI embedding); confirmed the real Phase 7 latency dominator is OpenAI,
  not Supabase/gbrain.
- Spike 010 — proved the single-shared-engine pattern survives concurrent
  multi-tenant reads. Spike 008 extends: that same single engine has
  sufficient pool capacity to back v2.0's expected concurrency.
- `lib/gbrain/engine.ts` — the single-shared-engine architecture under test.
  Spikes 006 + 007 + 008 + 010 all validate it from different angles.
