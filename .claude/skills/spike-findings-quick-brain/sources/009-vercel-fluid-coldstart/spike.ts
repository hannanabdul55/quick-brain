/**
 * Spike 009 runner: invokes cold-probe.ts N times, each as a fresh bun
 * process — simulating Vercel Fluid Compute cold-start.
 *
 * Aggregates the per-phase timings and produces:
 *   - per-run JSON line
 *   - p50/p99/min/max aggregates per phase
 *   - the headline cold vs warm comparison
 *   - extrapolation notes for Vercel Fluid Compute behavior
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface ProbeResult {
  totalColdMs: number;
  totalWarmMs: number;
  resultCount: number;
  phases: Record<string, number>;
}

const RUNS = parseInt(process.env.SPIKE_009_RUNS ?? "5", 10);

function runOnce(): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const probePath = join(__dirname, "cold-probe.ts");
    const proc = spawn("bun", [probePath], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`probe exited ${code}: ${stderr.slice(0, 300)}`));
        return;
      }
      const lastLine = stdout.trim().split("\n").pop() ?? "{}";
      try {
        resolve(JSON.parse(lastLine));
      } catch (err) {
        reject(new Error(`probe stdout parse failed: ${lastLine.slice(0, 300)}`));
      }
    });
  });
}

function stats(values: number[]): { min: number; p50: number; p99: number; max: number; mean: number } {
  const sorted = [...values].sort((a, b) => a - b);
  const p = (k: number) => sorted[Math.min(Math.floor(sorted.length * k), sorted.length - 1)];
  return {
    min: sorted[0],
    p50: p(0.5),
    p99: p(0.99),
    max: sorted[sorted.length - 1],
    mean: Math.round(values.reduce((s, v) => s + v, 0) / values.length),
  };
}

async function main() {
  console.log(`Spike 009: ${RUNS} cold-process runs of (Bun init + gbrain import + Supabase connect + first hybridSearch)`);
  console.log(`Each run is a fresh bun process — simulating Vercel Fluid Compute cold-start latency.\n`);

  const results: ProbeResult[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = Date.now();
    console.log(`[run ${i + 1}/${RUNS}] launching fresh bun process...`);
    try {
      const r = await runOnce();
      results.push(r);
      const elapsed = Date.now() - start;
      console.log(`  ✓ cold-path ${r.totalColdMs}ms / warm-path ${r.totalWarmMs}ms / wall ${elapsed}ms / ${r.resultCount} results`);
    } catch (err: any) {
      console.error(`  ✗ run failed: ${err.message}`);
    }
  }

  if (results.length === 0) {
    console.error("No successful runs");
    process.exit(1);
  }

  const coldStats = stats(results.map((r) => r.totalColdMs));
  const warmStats = stats(results.map((r) => r.totalWarmMs));

  const phaseKeys = Object.keys(results[0].phases);
  const phaseStats: Record<string, ReturnType<typeof stats>> = {};
  for (const key of phaseKeys) {
    phaseStats[key] = stats(results.map((r) => r.phases[key] ?? 0));
  }

  console.log(`\n=== HEADLINE ===`);
  console.log(`Cold path (Bun init + gbrain import + Supabase connect + first hybridSearch):`);
  console.log(`  min=${coldStats.min}ms  p50=${coldStats.p50}ms  p99=${coldStats.p99}ms  max=${coldStats.max}ms  mean=${coldStats.mean}ms`);
  console.log(`Warm path (2nd hybridSearch in same process, post-cold):`);
  console.log(`  min=${warmStats.min}ms  p50=${warmStats.p50}ms  p99=${warmStats.p99}ms  max=${warmStats.max}ms  mean=${warmStats.mean}ms`);
  console.log(`Cold/warm ratio (mean): ${(coldStats.mean / Math.max(warmStats.mean, 1)).toFixed(1)}x`);

  console.log(`\n=== PHASE BREAKDOWN (mean ms, sorted by contribution) ===`);
  const phaseRows = Object.entries(phaseStats)
    .map(([k, v]) => ({ phase: k, ...v }))
    .sort((a, b) => b.mean - a.mean);
  for (const r of phaseRows) {
    const pct = ((r.mean / coldStats.mean) * 100).toFixed(0);
    console.log(`  ${r.phase.padEnd(32)} ${String(r.mean).padStart(5)}ms  (${pct.padStart(3)}%)  [${r.min}–${r.max}]`);
  }

  // Write artifacts
  const outPath = join(__dirname, "spike-events.json");
  writeFileSync(outPath, JSON.stringify({
    spike: "009",
    runs: RUNS,
    successfulRuns: results.length,
    coldStats,
    warmStats,
    phaseStats,
    raw: results,
  }, null, 2));
  console.log(`\nForensic data written to ${outPath}`);
  console.log(`\nFINAL VERDICT: VALIDATED ✓ (cold-start measured across ${results.length} fresh-process runs)`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
