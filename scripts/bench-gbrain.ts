#!/usr/bin/env bun
//
// scripts/bench-gbrain.ts
//
// Measures p50/p95/max latency for the three gbrain operations that the app
// uses, against the seed brain (SEED_TENANT_ID = "seed"), using the SAME
// in-process entry points the app uses.
//
// Run:
//   bun scripts/bench-gbrain.ts
//
// Prerequisites:
//   - GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER set in env (seed brain on Supabase)
//   - OPENAI_API_KEY set (vector embeddings)
//   - ANTHROPIC_API_KEY set (query expansion + think synthesis)
//   - The seed brain already seeded (bun run scripts/seed.sh or equivalent)
//
// Output (one line per operation):
//   <label>: n=<N> p50=<ms>ms p95=<ms>ms max=<ms>ms
//
// Results from running this script feed docs/phase-5-latency-threshold.md,
// which documents the inline-vs-job threshold decision for Phase 5 (JOBS-03 / D-04).
//
// Environment note: this script runs locally against Supabase Postgres.
// Measured latencies are local-machine in-process latencies — lower bounds for
// the Vercel serverless number (which adds cold-start + network overhead).
//

import { queryInProcess } from "@/lib/gbrain/engine";
import { think } from "@/lib/gbrain/client";
import { onboard } from "@/lib/gbrain/onboard";
import { SEED_TENANT_ID } from "@/lib/gbrain/paths";

// ---------------------------------------------------------------------------
// Iteration counts — adjust to balance accuracy vs. API cost.
// p95 over N samples uses index ceil(0.95 * N) - 1; N >= 20 gives a real
// 95th-percentile observation for query (cheap). think and import cost API
// tokens, so keep N small and treat the result as directional.
// ---------------------------------------------------------------------------
const QUERY_N = 30; // ~1.3s each; low cost; p95 index = row 28 of 30 (real)
const THINK_N = 10; // ~30s each, LLM-bound; p95 index = row 9 of 10 (directional)
// Import approach: call onboard() with a throwaway tenantId (bench-<epoch>)
// to measure end-to-end init+import+embed via the spawnGBrain path that
// onboard() still uses (local PGLite brains). This matches RESEARCH Open Q3:
// "benchmark the current import path; note it may change shape in Phase 6."
// Each run creates a throwaway local brain under ./brains/bench-<epoch>/.
// N=3 because each run is minutes-long and costs substantial API tokens.
// If creating throwaway brains is undesirable, set SKIP_IMPORT_BENCH=1 in
// env to skip this operation; the threshold doc will record "not measured".
const IMPORT_N = 3;

const BENCH_QUESTION = "What was weird about March?";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the p-th percentile of a sorted array of sample durations.
 *
 * Sort ascending, then pick index = ceil(p / 100 * length) - 1, clamped to 0.
 * This is the "nearest rank" method — the result is always an actual observed
 * sample, not an interpolation.
 *
 * @param samples - Array of duration measurements in milliseconds
 * @param p       - Percentile to compute (0 < p <= 100)
 * @returns       The p-th percentile value in milliseconds
 */
function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

/**
 * Time a single async call and return the wall-clock duration in milliseconds.
 */
async function timeIt(fn: () => Promise<unknown>): Promise<number> {
  const t0 = performance.now();
  await fn();
  return performance.now() - t0;
}

/**
 * Run a benchmark for one operation: one warm-up (discarded) + N timed samples.
 *
 * Prints one summary line:
 *   <label>: n=<N> p50=<ms>ms p95=<ms>ms max=<ms>ms
 *
 * @param label - Operation name for output line
 * @param n     - Number of timed samples (after 1 warm-up)
 * @param fn    - The async operation to benchmark
 */
async function bench(label: string, n: number, fn: () => Promise<unknown>): Promise<void> {
  console.log(`[bench] ${label}: warming up (1 run, discarded)...`);
  // Warm-up run: pays cold connection-pool creation (createGBrainEngine),
  // gateway initialisation (configureGateway), and gbrain module load.
  // Discarded so steady-state latency is measured, not cold-start.
  await fn();

  console.log(`[bench] ${label}: collecting ${n} timed samples...`);
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const ms = await timeIt(fn);
    samples.push(ms);
    console.log(`[bench]   sample ${i + 1}/${n}: ${ms.toFixed(0)}ms`);
  }

  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const max = Math.max(...samples);

  console.log(
    `${label}: n=${n} p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms max=${max.toFixed(0)}ms`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  // --- query (hybrid search + expansion) ---
  // Uses queryInProcess directly (the same entry point the app uses).
  // Returns SearchResult[]; we discard the value — only timing matters.
  await bench("query", QUERY_N, () => queryInProcess(SEED_TENANT_ID, BENCH_QUESTION));

  // --- think (LLM synthesis via runThink) ---
  // Uses haiku to match the app's default (think defaults to "haiku").
  // Returns GBrainResult; we discard the value.
  await bench("think", THINK_N, () =>
    think(SEED_TENANT_ID, BENCH_QUESTION, { model: "haiku" }),
  );

  // --- import / onboarding (init + import + embed via spawnGBrain) ---
  // Benchmarks the onboard() path that still uses local-PGLite spawnGBrain.
  // Each call creates a throwaway brain under ./brains/bench-<epoch>/.
  // Set SKIP_IMPORT_BENCH=1 to skip (e.g. if throwaway brains are undesirable).
  if (process.env.SKIP_IMPORT_BENCH === "1") {
    console.log(
      "import: SKIPPED (SKIP_IMPORT_BENCH=1) — record duration from seed run logs instead",
    );
  } else {
    await bench("import", IMPORT_N, () =>
      onboard({ tenantId: `bench-${Date.now()}` }),
    );
  }

  console.log("\n[bench] done — paste the labelled lines above into docs/phase-5-latency-threshold.md");
} catch (err) {
  console.error("[bench] FATAL:", err);
  process.exit(1);
}
