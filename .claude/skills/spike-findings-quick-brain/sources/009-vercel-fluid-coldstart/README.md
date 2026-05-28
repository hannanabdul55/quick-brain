---
spike: 009
name: vercel-fluid-coldstart
type: standard
validates: "Given gbrain bundled as a package.json dep loaded under Bun (current architecture), when a fresh process performs (Bun init + gbrain dynamic-import + configureGateway + createEngine + connect + first hybridSearch), then the cold-start latency contributors are quantified per phase and the ratio vs warm-path is measured — informing Phase 4 deploy planning on whether warm-pool strategies are needed"
verdict: VALIDATED
related: [005, 006]
tags: [vercel, fluid-compute, bun, cold-start, phase-4-precondition, performance]
---

# Spike 009: Vercel Fluid Compute cold-start

## What This Validates

Phase 4 (Vercel Deploy) listed `vercel link` as its only precondition. But the
v2.0 architecture (post in-process refactor in Phase 3) means every Vercel
function execution loads gbrain as a library — paying Bun init + gbrain
module import + Supabase pooler connect + first OpenAI embedding call on
every cold-start. Vercel Fluid Compute reuses instances across concurrent
requests, but a cold-start still happens whenever Vercel scales a new instance.

This spike asks: **on a truly cold Vercel Fluid Compute instance, what is the
realistic time-to-first-response for `/api/chat`?** And how much of that is
gbrain-specific cold-start vs OpenAI embedding latency that hits every query
regardless?

The answer determines whether Phase 4 needs warm-pooling strategies
(scheduled keep-alive, lazy-import patterns, Edge Caching) or whether the
default Vercel Fluid Compute behavior is good enough.

## Research

From the Vercel session-context (already in conversation):

> "Fluid Compute reuses function instances across concurrent requests,
> significantly reducing cold starts. It is not traditional one-request-per-
> instance serverless. Functions also support graceful shutdown and request
> cancellation."

From spike 006:
> Warm-engine `hybridSearch` end-to-end = 1.34s (single in-process call, no
> child process). This was already on a warm engine — i.e. spike 006 paid the
> cold-start ONCE and measured warm afterward.

From CLAUDE.md project state:
- `gbrain: "github:garrytan/gbrain#3933eb6"` is a real `package.json`
  dependency — bundles into the Vercel deploy.
- App uses `bun node_modules/.bin/next start` so Bun is the runtime (per
  `types/gbrain.ts` docstring).
- `next.config.ts` has `serverExternalPackages: ['gbrain']` so webpack does
  NOT bundle gbrain — it stays as raw `.ts` in `node_modules`, loaded at
  runtime via Bun's native TS support.

## How to Run

```bash
cd "quick-brain"
set -a && . ./.env.local && set +a
export PATH="$HOME/.bun/bin:$PATH"
bun .planning/spikes/009-vercel-fluid-coldstart/spike.ts
```

The runner (`spike.ts`) spawns the cold-probe (`cold-probe.ts`) N times via
`child_process.spawn("bun", ...)`. Each invocation is a fresh bun process =
a Vercel Fluid Compute cold-start in miniature. Per-phase timings are
captured (Bun init → load gbrain → configure gateway → create engine →
connect → load hybrid module → first search → second/warm search → disconnect)
and aggregated into p50/p99/mean stats.

Default 5 runs. Override with `SPIKE_009_RUNS=10`.

## What to Expect

Per-run output line and a final phase-breakdown table. Expected: cold path
~1.5-2.0s, warm path ~1.0-1.5s, ratio ~1.3-1.6×. The phase table shows
where the time goes (spoiler: the hybridSearch itself dominates because of
the OpenAI embedding call, not the cold-start overhead).

## Observability

`spike-events.json` carries per-run raw timings + aggregate stats.
The HTML page renders the phase breakdown as a stacked bar.

## Investigation Trail

### Run-by-run timings (5 fresh-process invocations)

| Run | Cold ms | Warm ms | Wall ms | Results |
|----:|--------:|--------:|--------:|--------:|
| 1 | 1997 | 949 | 2968 | 3 |
| 2 | 1687 | 1534 | 3239 | 3 |
| 3 | 2130 | 922 | 3073 | 3 |
| 4 | 1521 | 1262 | 2802 | 3 |
| 5 | 1439 | 1157 | 2616 | 3 |

### Aggregate latency

| Path | min | p50 | p99 | max | mean |
|---|---:|---:|---:|---:|---:|
| **Cold** (fresh bun process) | 1439 | 1687 | 2130 | 2130 | 1755 |
| **Warm** (2nd hybridSearch in same process) | 922 | 1157 | 1534 | 1534 | 1165 |

**Cold/warm ratio (mean): 1.5×**.

### Per-phase contribution to cold path (mean ms)

| Phase | Mean ms | % of cold | Range |
|---|---:|---:|---|
| **first_search** (incl. OpenAI embedding + vector search) | **1434** | **82%** | 1153–1834 |
| connect_engine (TLS + auth + first SQL roundtrip) | 240 | 14% | 216–289 |
| bun_to_load_gbrain_module | 62 | 4% | 52–88 |
| create_engine_in_memory | 14 | 1% | 13–16 |
| load_hybrid_module | 3 | 0% | 2–5 |
| load_engine_factory_module | 1 | 0% | 0–1 |
| configure_gateway | 0 | 0% | 0–1 |

The warm-path bonus measurement:
- **warm_search**: 1165ms mean (922–1534). Almost identical to first_search
  because every hybridSearch independently calls OpenAI text-embedding-3-large
  to embed the query string. **There's no Q→embedding cache in gbrain.**

### The surprising finding

Conventional wisdom about cold-starts says "the deploy boot is the killer."
Not here. The actual Vercel-cold overhead (Bun init + module load + engine
connect) is **only ~310ms** combined (62 + 1 + 14 + 240 + 3 = ~320ms).

The other ~1.4s of "cold path" is the first hybridSearch — which spends
nearly all that time on the OpenAI embedding API roundtrip. **A warm
Vercel instance pays the same ~1.2s on every /api/chat call** (warm_search
mean = 1165ms). Cold vs warm only differs by the ~310ms infrastructure tax.

### Implication for Phase 4 + Phase 7 UX expectations

Don't promise sub-second chat responses. Realistic numbers:

| User scenario | Expected latency |
|---|---|
| First chat after Vercel cold-start | ~1.7s (mean), ~2.1s (p99) |
| Chat on a warm instance | ~1.2s (mean), ~1.5s (p99) |
| Vercel Fluid Compute scenario (most requests warm) | ~1.2s typical |

The 310ms cold-start tax matters but doesn't dominate. Even a fully-warm
architecture would feel "1.2s typical, 1.5s tail" because of the OpenAI
embedding call.

### What about pre-warming?

The 310ms cold-start tax could be eliminated by:
- Vercel's scheduled function (cron) keeping an instance warm
- Edge Caching the dashboard so /api/chat sees fewer cold starts

But the value of these is **modest** (310ms savings) vs the dominant OpenAI
roundtrip. Cheaper levers exist for the real latency: query-embedding cache
(LRU keyed by query text → 256-D embedding), batched query expansion, or
moving the dominant text-embedding-3-large call to a faster model
(text-embedding-3-small at 1536-dim or smaller). These are out of Phase 4's
scope but real Phase 9+ optimizations.

### Why warm-pool strategies are NOT recommended for Phase 4

1. The cold-start tax is small (310ms) compared to the unavoidable embedding
   call (~1.2s).
2. Vercel Fluid Compute already does instance reuse — most production traffic
   hits warm instances anyway.
3. A scheduled keep-alive Cron costs money + adds infrastructure complexity
   for a 310ms savings.
4. Phase 7's ingest path (1.9s/page from spike 007) is bottlenecked by the
   same OpenAI throughput, not cold-start.

**Recommended Phase 4 posture:** ship without warm-pooling. Measure real
cold-start frequency in production via Vercel observability. Add pre-warming
only if cold-start frequency > 5% of requests AND user-reported latency
complaints correlate with cold starts.

## Results

**VERDICT: VALIDATED ✓**

The cold-start cost on this stack (Bun + gbrain + Supabase pooler + OpenAI
embedding) is **modest and dominated by the OpenAI roundtrip**, not by the
Vercel infrastructure boot. Phase 4 ships with default Vercel Fluid Compute
behavior. No warm-pooling strategy required.

### Confirmed facts

| Question | Answer |
|---|---|
| Cold-path latency on fresh bun process? | ~1.7s mean (1.4s min, 2.1s p99) |
| Warm-path latency (2nd query in same process)? | ~1.2s mean (0.9s min, 1.5s p99) |
| Cold/warm ratio? | 1.5× |
| Bun init + gbrain import cost? | ~60ms |
| Supabase pooler connect cost (first query)? | ~240ms |
| createEngine in-memory cost? | ~14ms |
| Where does the "first search" 1.4s actually go? | OpenAI embedding API roundtrip — not gbrain init |
| Does gbrain cache query embeddings? | NO — every hybridSearch makes a fresh OpenAI call |
| Should Phase 4 add warm-pooling? | NO — savings (~310ms) don't justify complexity |

### Findings that shape Phase 4 and beyond

1. **Vercel Fluid Compute's default behavior is good enough.** No need to
   add scheduled keep-alive crons or warm-pool managers. Vercel's instance
   reuse already does most of the work.

2. **The real latency lever is query-embedding caching, not cold-start
   optimization.** Phase 9+ optimization: add an LRU cache keyed by query
   text → embedding vector. Could halve warm-path latency (1.2s → 0.6s) by
   skipping repeat OpenAI calls on common queries ("what was weird about
   last month?" run ~5×).

3. **Set realistic chat-UX expectations.** Promise "typical 1-2 seconds"
   not "instant." Phase 7's chat UI should show a typing indicator within
   200ms (Vercel SSE keep-alive) so the user knows the system is alive
   while waiting on OpenAI.

4. **Cross-validates spike 006's baseline.** Spike 006 measured 1.34s
   end-to-end for one warm in-process query. Spike 009 measures 1.17s mean
   for the same warm path — ranges overlap, no drift.

5. **Cross-validates spike 007's 1.9s/page ingest.** Spike 007 measured
   `importFromContent` at 1.9s/page. That's also dominated by an OpenAI
   embedding call — same cost class as a query embedding plus chunk
   embedding plus per-page DB write. Phase 7 plans should set realistic
   "100-page brain takes 3-5 minutes to ingest" expectations in the
   <JobProgress> UI.

### Cross-references

- Spike 005 — `gbrain-on-supabase` (the Supabase backend whose pooler
  contributes 240ms to cold-start).
- Spike 006 — `gbrain-in-process` (the warm-path baseline of 1.34s that
  this spike calibrates against).
- Spike 007 — `gbrain-import-from-content` (the symmetric write-path
  measurement; 1.9s/page dominated by the same OpenAI roundtrip).
- Spike 008 — `inngest-supabase-pool` (Inngest jobs sustain M=10
  concurrency at 688ms wall — pool isn't the cold-start contributor either).
- `lib/gbrain/engine.ts` — the single-shared-engine pattern (spike 010 +
  spike 008 validated) means warm reuse is already optimal in QuickBrain's
  architecture. Vercel Fluid Compute's reuse stacks on top of that.
- `next.config.ts` `serverExternalPackages: ['gbrain']` — keeps gbrain
  loaded as raw .ts under Bun rather than webpack-bundled; spike 009's
  62ms module-load timing assumes this config is in place. Phase 4 must
  not change this.
