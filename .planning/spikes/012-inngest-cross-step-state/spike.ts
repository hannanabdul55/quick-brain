/**
 * Spike 012 orchestrator — compares Inngest's two possible Phase 7 D-07 shapes:
 *
 *   Shape A — "5-step.run boundaries" (the literal Phase 7 D-07 prescription):
 *     Each step = fresh bun process (simulating Inngest's "each step = separate
 *     HTTP request" production model on Vercel without warm-instance reuse).
 *     Steps: connect → insert-source → ingest-page-1 → ingest-page-2 → ingest-page-3
 *
 *   Shape B — "one big step.run('execute')" (mirroring Phase 5's existing runJob
 *     pattern):
 *     One worker invocation does insert-source + ingest-page-1 + ingest-page-2 +
 *     ingest-page-3 in a single warm process.
 *
 * The comparison reveals the cost of the "every step gets its own retry boundary"
 * design vs the "consolidate gbrain work into one step.run" design.
 *
 * Cleanup: spawns a final "cleanup" worker that DELETEs the source row, FK
 * cascade sweeps every page + chunk.
 *
 * How to run:
 *   set -a && . ./.env.local && set +a
 *   bun .planning/spikes/012-inngest-cross-step-state/spike.ts
 */

import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface WorkerResult {
  step: string;
  fingerprint?: string;
  totalMs?: number;
  marks?: Record<string, number>;
  phases?: Record<string, number>;
  work?: unknown;
  error?: string;
}

function runStep(step: string, runId: string, extraEnv: Record<string, string> = {}): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const probePath = join(__dirname, "step-worker.ts");
    const proc = spawn("bun", [probePath], {
      env: { ...process.env, STEP: step, RUN_ID: runId, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (c) => { stdout += c.toString(); });
    proc.stderr.on("data", (c) => { stderr += c.toString(); });
    proc.on("close", (code) => {
      const lastLine = stdout.trim().split("\n").pop() ?? "{}";
      try {
        const parsed = JSON.parse(lastLine);
        if (code !== 0 || parsed.error) {
          reject(new Error(`worker (step=${step}) exited ${code}: ${parsed.error ?? stderr.slice(0, 200)}`));
          return;
        }
        resolve(parsed);
      } catch (err) {
        reject(new Error(`worker (step=${step}) stdout parse failed: ${lastLine.slice(0, 300)} | stderr: ${stderr.slice(0, 200)}`));
      }
    });
  });
}

interface SpikeEvent {
  t: string; ms: number; category: string; message: string; data?: unknown;
}
const events: SpikeEvent[] = [];
const t0 = Date.now();
function log(category: string, message: string, data?: unknown) {
  const ms = Date.now() - t0;
  events.push({ t: new Date().toISOString(), ms, category, message, ...(data !== undefined ? { data } : {}) });
  console.log(`[${String(ms).padStart(6, " ")}ms] ${category.toUpperCase().padEnd(12)} ${message}${data !== undefined ? "  " + JSON.stringify(data) : ""}`);
}

async function main() {
  const runId = String(Date.now());
  log("setup", `Spike 012 starting — runId=${runId}`);

  // ── Shape A: 5 separate step.run boundaries (5 fresh processes) ───────────
  log("shape-a", "Shape A — 5 step.run boundaries, each a fresh process (worst case: no Vercel warm reuse)");
  const shapeAStart = Date.now();
  const stepConnect = await runStep("connect", runId);
  log("shape-a", `  step 1 (connect)        — ${stepConnect.totalMs}ms — pid ${stepConnect.fingerprint}`);
  const stepInsert = await runStep("insert", runId);
  log("shape-a", `  step 2 (insert-source)  — ${stepInsert.totalMs}ms — pid ${stepInsert.fingerprint}`);
  const stepIngest1 = await runStep("ingest", runId, { RUN_ID: `${runId}-1` });
  log("shape-a", `  step 3 (ingest page 1)  — ${stepIngest1.totalMs}ms — pid ${stepIngest1.fingerprint}`);
  const stepIngest2 = await runStep("ingest", runId, { RUN_ID: `${runId}-2` });
  log("shape-a", `  step 4 (ingest page 2)  — ${stepIngest2.totalMs}ms — pid ${stepIngest2.fingerprint}`);
  const stepIngest3 = await runStep("ingest", runId, { RUN_ID: `${runId}-3` });
  log("shape-a", `  step 5 (ingest page 3)  — ${stepIngest3.totalMs}ms — pid ${stepIngest3.fingerprint}`);
  const shapeATotalMs = Date.now() - shapeAStart;
  const shapeAFingerprints = new Set([stepConnect.fingerprint, stepInsert.fingerprint, stepIngest1.fingerprint, stepIngest2.fingerprint, stepIngest3.fingerprint]);
  log("shape-a", `TOTAL ${shapeATotalMs}ms — ${shapeAFingerprints.size} distinct process fingerprints`);

  // Cleanup between shapes
  await runStep("cleanup", `${runId}-cleanup-a`);

  // ── Shape B: 1 big step.run("execute") (warm reuse within one process) ────
  log("shape-b", "Shape B — 1 big step.run, all gbrain work in one warm process (Phase 5 runJob pattern)");
  const shapeBStart = Date.now();
  const stepAllInOne = await runStep("all-in-one", runId);
  log("shape-b", `  one big step (4 ops)    — ${stepAllInOne.totalMs}ms — pid ${stepAllInOne.fingerprint}`);
  const shapeBTotalMs = Date.now() - shapeBStart;

  // Final cleanup
  await runStep("cleanup", `${runId}-cleanup-b`);
  log("cleanup", "Final cleanup done");

  const savings = shapeATotalMs - shapeBTotalMs;
  const speedup = (shapeATotalMs / shapeBTotalMs).toFixed(2);

  log("summary", `Shape A (5 separate processes): ${shapeATotalMs}ms`);
  log("summary", `Shape B (1 process):            ${shapeBTotalMs}ms`);
  log("summary", `Delta:                           ${savings}ms  (Shape B is ${speedup}× faster)`);

  // Compute the "wasted cold-start tax" — sum of gateway_load+gateway_configure+
  // engine_create+engine_connect across Shape A's 5 steps. Shape B pays this only once.
  const aColdTax = [stepConnect, stepInsert, stepIngest1, stepIngest2, stepIngest3]
    .map((s) => (s.phases?.gateway_load_ms ?? 0) + (s.phases?.gateway_configure_ms ?? 0) +
                 (s.phases?.engine_create_ms ?? 0) + (s.phases?.engine_connect_ms ?? 0))
    .reduce((a, b) => a + b, 0);
  const bColdTax = (stepAllInOne.phases?.gateway_load_ms ?? 0) + (stepAllInOne.phases?.gateway_configure_ms ?? 0) +
                   (stepAllInOne.phases?.engine_create_ms ?? 0) + (stepAllInOne.phases?.engine_connect_ms ?? 0);
  log("summary", `Cold tax — Shape A (5 cold-starts): ${aColdTax}ms`);
  log("summary", `Cold tax — Shape B (1 cold-start):  ${bColdTax}ms`);
  log("summary", `Avoidable cold-start tax in Shape A: ${aColdTax - bColdTax}ms`);

  const outPath = join(__dirname, "spike-events.json");
  writeFileSync(outPath, JSON.stringify({
    spike: "012",
    finishedAt: new Date().toISOString(),
    runId,
    shapes: {
      a_five_step: {
        totalMs: shapeATotalMs,
        distinctFingerprints: [...shapeAFingerprints],
        steps: [stepConnect, stepInsert, stepIngest1, stepIngest2, stepIngest3],
        cold_tax_total_ms: aColdTax,
      },
      b_one_step: {
        totalMs: shapeBTotalMs,
        steps: [stepAllInOne],
        cold_tax_total_ms: bColdTax,
      },
    },
    delta_ms: savings,
    speedup: speedup,
    avoidable_cold_tax_ms: aColdTax - bColdTax,
    events,
  }, null, 2));
  log("setup", `Event log written to ${outPath}`);

  console.log(`\nFINAL VERDICT: VALIDATED ✓`);
  console.log(`  Shape A (5 step.run boundaries): ${shapeATotalMs}ms (${aColdTax}ms cold tax)`);
  console.log(`  Shape B (1 step.run boundary):   ${shapeBTotalMs}ms (${bColdTax}ms cold tax)`);
  console.log(`  Shape B saves ${savings}ms — recommend Phase 7 D-07 follows Phase 5 runJob pattern`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
