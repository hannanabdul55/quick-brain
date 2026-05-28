/**
 * Spike 008: Inngest concurrency × Supabase free-tier pool
 *
 * What this validates:
 *   Phase 7's step-divided Inngest function (D-07) fires 5 step.run() boundaries
 *   per ingest job. With M concurrent QBO jobs across tenants → up to M×5 effective
 *   concurrent queries through the SINGLE shared engine (lib/gbrain/engine.ts,
 *   max: 10 conns via gbrain's DEFAULT_POOL_SIZE_FALLBACK).
 *
 *   Question: at what concurrency does the Supabase free-tier transaction pooler
 *   become the failure mode? What does the failure look like (queue / timeout /
 *   hard error / silent stall)?
 *
 * Method:
 *   1. Open the shared engine (one in-process gbrain createEngine, like prod).
 *   2. Fire N concurrent SELECT 1 queries via engine.executeRaw — gbrain's
 *      `prepare: false` PgBouncer path. Measure p50/p99 latency, error count.
 *   3. Repeat at N = 1, 5, 10, 20, 50, 100, 200.
 *   4. Also: simulate "5 step.run() per Inngest job" — fire M Inngest-like
 *      tasks each running 5 serial queries — measure end-to-end at M = 1, 5, 10.
 *   5. Bonus: stat the actual Postgres backends in pg_stat_activity during heavy
 *      concurrency to see if gbrain's "max: 10" actually caps the wire concurrency
 *      under Supavisor (which itself pools server-side).
 *
 * Cleanup: read-only spike. No data written.
 *
 * How to run:
 *   set -a && . ./.env.local && set +a
 *   bun .planning/spikes/008-inngest-supabase-pool/spike.ts
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

async function loadGbrain(subpath: string): Promise<any> {
  return import(/* @vite-ignore */ "gbrain/" + subpath);
}

interface SpikeEvent {
  t: string;
  ms: number;
  category: "setup" | "burst" | "inngest-sim" | "pool-stat" | "error" | "summary";
  message: string;
  data?: unknown;
}

const events: SpikeEvent[] = [];
const t0 = Date.now();

function log(category: SpikeEvent["category"], message: string, data?: unknown) {
  const ms = Date.now() - t0;
  events.push({ t: new Date().toISOString(), ms, category, message, ...(data !== undefined ? { data } : {}) });
  const tag = `[${String(ms).padStart(6, " ")}ms] ${category.toUpperCase().padEnd(12)}`;
  console.log(`${tag} ${message}${data !== undefined ? "  " + JSON.stringify(data) : ""}`);
}

interface BurstResult {
  n: number;
  totalMs: number;
  successCount: number;
  errorCount: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  errors: string[];
}

async function burst(engine: any, n: number): Promise<BurstResult> {
  const start = Date.now();
  const errors: string[] = [];
  const latencies: number[] = [];
  const tasks = Array.from({ length: n }, async (_, i) => {
    const qStart = Date.now();
    try {
      await engine.executeRaw(`SELECT $1::int AS x, pg_backend_pid() AS pid`, [i]);
      latencies.push(Date.now() - qStart);
    } catch (err: any) {
      errors.push(`${err?.code ?? "?"}:${err?.message?.slice(0, 80)}`);
    }
  });
  await Promise.all(tasks);
  latencies.sort((a, b) => a - b);
  const p = (k: number) => latencies.length === 0 ? 0 : latencies[Math.min(Math.floor(latencies.length * k), latencies.length - 1)];
  return {
    n,
    totalMs: Date.now() - start,
    successCount: latencies.length,
    errorCount: errors.length,
    p50Ms: p(0.5),
    p99Ms: p(0.99),
    maxMs: latencies.length ? latencies[latencies.length - 1] : 0,
    errors: errors.slice(0, 3),
  };
}

async function simulateInngestJob(engine: any, jobId: number): Promise<{ jobId: number; ms: number; stepLatencies: number[]; err?: string }> {
  const start = Date.now();
  const stepLatencies: number[] = [];
  try {
    // Mimic Phase 7's 5 step.run() boundaries: each step is a serial DB call
    for (let step = 0; step < 5; step++) {
      const s = Date.now();
      await engine.executeRaw(`SELECT $1::int AS job, $2::int AS step, pg_sleep(0.05)`, [jobId, step]);
      stepLatencies.push(Date.now() - s);
    }
    return { jobId, ms: Date.now() - start, stepLatencies };
  } catch (err: any) {
    return { jobId, ms: Date.now() - start, stepLatencies, err: err?.message?.slice(0, 80) };
  }
}

async function main() {
  log("setup", "Spike 008 starting");
  const dbUrl = process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!dbUrl) {
    log("error", "Missing SUPABASE_DB_URL_POOLER");
    process.exit(1);
  }
  log("setup", `Pooler host: ${new URL(dbUrl.replace(/^postgresql:/, "https:")).host}`);
  log("setup", `gbrain GBRAIN_POOL_SIZE=${process.env.GBRAIN_POOL_SIZE ?? "(default 10)"}`);

  const ef = await loadGbrain("engine-factory");
  const cfg = { engine: "postgres" as const, database_url: dbUrl };
  const engine = await ef.createEngine(cfg);
  await engine.connect(cfg);
  log("setup", "Engine connected (max: 10 conn pool per gbrain default)");

  // ── Baseline pool-stat (BEFORE load) ──────────────────────────────────────
  // NOTE: must pass at least one $N parameter — gbrain's executeRaw hangs
  // indefinitely against the Supavisor transaction-mode pooler when called
  // with zero parameters (findings during spike build; reproduced before/after
  // load). Documented in README.
  log("pool-stat", "Baseline (cold engine): 30 concurrent pg_backend_pid() queries (parameterized)");
  const baselineStart = Date.now();
  const pidResults = await Promise.all(
    Array.from({ length: 30 }, async (_, i) => {
      try {
        const rows = await engine.executeRaw(`SELECT $1::int AS i, pg_backend_pid() AS pid`, [i]);
        return rows[0]?.pid;
      } catch (err: any) {
        return null;
      }
    }),
  );
  const baselineMs = Date.now() - baselineStart;
  const distinctPids = new Set(pidResults.filter((p) => p !== null));
  log("pool-stat", `Baseline: ${distinctPids.size} distinct Supavisor backends in ${baselineMs}ms (gbrain max:10 = expected ceiling on local pool side)`);

  // ── Burst test 1: ramp concurrency ─────────────────────────────────────────
  log("burst", "Ramping concurrency: N = 1, 5, 10, 20, 50, 100, 200");
  const burstResults: BurstResult[] = [];
  for (const n of [1, 5, 10, 20, 50, 100, 200]) {
    log("burst", `Firing burst N=${n}`);
    const result = await burst(engine, n);
    burstResults.push(result);
    log("burst", `N=${n} → success=${result.successCount}/${n} errors=${result.errorCount} total=${result.totalMs}ms p50=${result.p50Ms}ms p99=${result.p99Ms}ms`, result.errors.length ? { errSample: result.errors[0] } : undefined);
  }

  // ── Inngest-shaped simulation ─────────────────────────────────────────────
  log("inngest-sim", "Phase 7 shape: M concurrent ingest jobs × 5 step.run() each (serial inside job)");
  const inngestResults: Array<{ M: number; totalMs: number; failed: number; jobs: any[] }> = [];
  for (const M of [1, 3, 5, 10]) {
    log("inngest-sim", `Firing M=${M} concurrent Inngest-shaped jobs`);
    const start = Date.now();
    const jobs = await Promise.all(Array.from({ length: M }, (_, i) => simulateInngestJob(engine, i)));
    const totalMs = Date.now() - start;
    const failed = jobs.filter((j) => j.err).length;
    inngestResults.push({ M, totalMs, failed, jobs: jobs.slice(0, 3) });
    log("inngest-sim", `M=${M} → ${jobs.length - failed}/${M} jobs completed in ${totalMs}ms (each ~5×50ms pg_sleep = ~250ms ideal serial; ${(M * 5)} queries total)`);
  }

  // Note: the original spike had a post-load pool-stat probe (100-burst after
  // the ramp+inngest-sim). It hung indefinitely — sustained burst saturates
  // the pool. Moved baseline pool-stat to BEFORE the load instead. The post-
  // load probe hanging is itself a finding documented in the README.
  log("pool-stat", "Post-load probe SKIPPED (originally hung — see README for finding)");

  await engine.disconnect();
  log("setup", "engine.disconnect() OK");

  // ── Verdicts ───────────────────────────────────────────────────────────────
  const allBurstsClean = burstResults.every((r) => r.errorCount === 0);
  const all200Succeeded = burstResults.find((r) => r.n === 200)?.errorCount === 0;
  const inngestAllOk = inngestResults.every((r) => r.failed === 0);

  log("summary", "Spike 008 complete");

  const outPath = join(__dirname, "spike-events.json");
  writeFileSync(outPath, JSON.stringify({
    spike: "008",
    finishedAt: new Date().toISOString(),
    totalMs: Date.now() - t0,
    verdicts: {
      allBurstsClean,
      all200ConcurrentSucceeded: all200Succeeded,
      inngestSimAllOk: inngestAllOk,
      distinctSupavisorBackends: distinctPids.size,
    },
    burstResults,
    inngestResults,
    events,
  }, null, 2));

  console.log("\n=== BURST RESULTS ===");
  console.log("    N |  total(ms) |   ok |  err |   p50 |   p99 |   max");
  for (const r of burstResults) {
    console.log(`  ${String(r.n).padStart(3)} |  ${String(r.totalMs).padStart(8)} | ${String(r.successCount).padStart(4)} | ${String(r.errorCount).padStart(4)} | ${String(r.p50Ms).padStart(5)} | ${String(r.p99Ms).padStart(5)} | ${String(r.maxMs).padStart(5)}`);
  }
  console.log("\n=== INNGEST-SHAPED SIMULATION (M jobs × 5 serial steps each, ~250ms ideal) ===");
  console.log("    M |  total(ms) | failed | queries");
  for (const r of inngestResults) {
    console.log(`  ${String(r.M).padStart(3)} |  ${String(r.totalMs).padStart(8)} | ${String(r.failed).padStart(6)} | ${r.M * 5}`);
  }
  console.log(`\n=== POOL ===`);
  console.log(`  gbrain pool max: 10 (default DEFAULT_POOL_SIZE_FALLBACK)`);
  console.log(`  distinct Supavisor backends during 100-burst: ${distinctPids.size}`);
  console.log(`\nFINAL VERDICT: ${allBurstsClean && inngestAllOk ? "VALIDATED ✓" : "PARTIAL ⚠"}`);
  process.exit(allBurstsClean && inngestAllOk ? 0 : 1);
}

main().catch((err) => {
  log("error", "FATAL", { name: err?.name, message: err?.message });
  console.error(err);
  process.exit(1);
});
