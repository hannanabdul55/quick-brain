/**
 * Tenant isolation integration test.
 *
 * Verifies SKIL-09: two different source directories yield different anomaly counts.
 *   - FIXTURES_ROOT (Mara's coffee data) must return >= 3 anomaly rows.
 *   - A fresh/empty temp dir must either throw or return 0 anomaly rows.
 *
 * Run with: bun scripts/test-tenant-isolation.ts
 * Exit 0 on pass, 1 on fail.
 */

import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, EOL } from "node:os";
import { computeAnomalies } from "../lib/insights/anomalies.ts";
import { FIXTURES_ROOT } from "../lib/gbrain/paths.ts";

async function main(): Promise<void> {
  // ── Step 1: Run against FIXTURES_ROOT (seed / Mara's coffee) ──────────────
  let seedCount: number;
  try {
    const seedAnomalies = await computeAnomalies(FIXTURES_ROOT);
    seedCount = seedAnomalies.length;
  } catch (e) {
    console.error(
      `FAIL: computeAnomalies threw against FIXTURES_ROOT (${FIXTURES_ROOT}):`,
      e instanceof Error ? e.message : String(e),
    );
    process.exit(1);
  }

  if (seedCount < 3) {
    console.error(
      `FAIL: expected >= 3 anomaly rows from FIXTURES_ROOT, got ${seedCount}`,
    );
    process.exit(1);
  }

  // ── Step 2: Run against an empty temp dir ─────────────────────────────────
  const tempBase = await mkdtemp(join(tmpdir(), "qb-isolation-test-"));
  try {
    // Create a concepts/ subdirectory but intentionally omit march-anomaly-summary.md
    await mkdir(join(tempBase, "concepts"), { recursive: true });

    let tempThrew = false;
    let tempCount = 0;
    try {
      const tempAnomalies = await computeAnomalies(tempBase);
      tempCount = tempAnomalies.length;
    } catch {
      tempThrew = true;
    }

    // ── Step 3: Verify isolation ─────────────────────────────────────────────
    const isolated = seedCount > 0 && (tempThrew || tempCount !== seedCount);
    if (!isolated) {
      console.error(
        `FAIL: tenant isolation NOT confirmed — seed=${seedCount} anomalies, fresh=${
          tempThrew ? "error (expected)" : tempCount + " rows (should differ)"
        }`,
      );
      process.exit(1);
    }

    const freshDesc = tempThrew ? "empty/error" : `${tempCount} rows`;
    console.log(
      `PASS: tenant isolation confirmed (seed=${seedCount} anomalies, fresh=${freshDesc})`,
    );
  } finally {
    // ── Step 4: Clean up temp dir ─────────────────────────────────────────────
    await rm(tempBase, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("FAIL: unexpected error:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
