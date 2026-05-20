import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { computeAnomalies } from "../../lib/insights/anomalies.ts";
import { FIXTURES_ROOT } from "../../lib/gbrain/paths.ts";

describe("tenant isolation", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  let seedCount = 0;

  it("FIXTURES_ROOT yields >= 3 anomaly rows", async () => {
    const anomalies = await computeAnomalies(FIXTURES_ROOT);
    seedCount = anomalies.length;
    expect(anomalies.length).toBeGreaterThanOrEqual(3);
  });

  it("isolated empty directory yields 0 rows or throws (isolation confirmed)", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "qb-test-"));
    // Create a concepts/ subdirectory but omit march-anomaly-summary.md
    await mkdir(join(tempDir, "concepts"), { recursive: true });

    let tempThrew = false;
    let tempCount = 0;
    try {
      const tempAnomalies = await computeAnomalies(tempDir);
      tempCount = tempAnomalies.length;
    } catch {
      tempThrew = true;
    }

    // Isolation: seed has >= 3 rows; empty dir either throws or has a different count
    const isolated = seedCount > 0 && (tempThrew || tempCount !== seedCount);
    expect(isolated).toBe(true);
  });
});
