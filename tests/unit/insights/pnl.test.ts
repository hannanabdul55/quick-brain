/**
 * Unit tests for lib/insights/pnl.ts
 *
 * Tests computePnl via temp file fixtures.
 * Verifies correct arithmetic and optional prevMonth behavior.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePnl } from "../../../lib/insights/pnl.ts";

let tempDir: string;

afterEach(async () => {
  if (tempDir) {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    tempDir = "";
  }
});

async function createTempDir(): Promise<string> {
  const base = tmpdir();
  const dir = join(
    base,
    `qb-pnl-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(join(dir, "originals"), { recursive: true });
  return dir;
}

/**
 * Build a monthly-close markdown file.
 * Format the body lines as: - YYYY-MM-DD: Label $X,XXX.XX
 */
function buildMonthlyCloseFile(
  month: string,
  revenue: number,
  cogs: number,
  opex: number,
  net: number
): string {
  const lastDay = `${month}-31`;
  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `---
type: monthly-close
date: ${lastDay}
---

- ${lastDay}: Revenue $${fmt(revenue)}
- ${lastDay}: COGS $${fmt(cogs)}
- ${lastDay}: Opex $${fmt(opex)}
- ${lastDay}: Net $${fmt(net)}
`;
}

describe("computePnl", () => {
  it("returns correct revenue, cogs, opex, net from monthly-close file", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "originals", "monthly-close-2026-03.md"),
      buildMonthlyCloseFile("2026-03", 27480, 1830, 6857.95, 18792.05),
      "utf-8"
    );

    const result = await computePnl(tempDir);
    expect(result.month).toBe("2026-03");
    expect(result.revenue).toBeCloseTo(27480, 2);
    expect(result.cogs).toBeCloseTo(1830, 2);
    expect(result.opex).toBeCloseTo(6857.95, 2);
    expect(result.net).toBeCloseTo(18792.05, 2);
  });

  it("net equals revenue minus cogs minus opex", async () => {
    tempDir = await createTempDir();
    const revenue = 10000;
    const cogs = 2000;
    const opex = 3000;
    const net = revenue - cogs - opex; // 5000
    await writeFile(
      join(tempDir, "originals", "monthly-close-2026-03.md"),
      buildMonthlyCloseFile("2026-03", revenue, cogs, opex, net),
      "utf-8"
    );

    const result = await computePnl(tempDir);
    expect(result.net).toBeCloseTo(net, 2);
  });

  it("populates prevMonth when monthly-close-2026-02.md also exists", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "originals", "monthly-close-2026-03.md"),
      buildMonthlyCloseFile("2026-03", 27480, 1830, 6857.95, 18792.05),
      "utf-8"
    );
    await writeFile(
      join(tempDir, "originals", "monthly-close-2026-02.md"),
      buildMonthlyCloseFile("2026-02", 25000, 1500, 6000, 17500),
      "utf-8"
    );

    const result = await computePnl(tempDir);
    expect(result.prevMonth).toBeDefined();
    expect(result.prevMonth!.month).toBe("2026-02");
    expect(result.prevMonth!.revenue).toBeCloseTo(25000, 2);
    expect(result.prevMonth!.net).toBeCloseTo(17500, 2);
  });

  it("returns prevMonth as undefined when monthly-close-2026-02.md is missing", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "originals", "monthly-close-2026-03.md"),
      buildMonthlyCloseFile("2026-03", 27480, 1830, 6857.95, 18792.05),
      "utf-8"
    );
    // No 2026-02 file

    const result = await computePnl(tempDir);
    expect(result.prevMonth).toBeUndefined();
  });

  it("throws when current monthly-close file is missing required fields", async () => {
    tempDir = await createTempDir();
    // Incomplete file — missing Net line
    const incomplete = `---
type: monthly-close
date: 2026-03-31
---

- 2026-03-31: Revenue $27,480.00
- 2026-03-31: COGS $1,830.00
`;
    await writeFile(
      join(tempDir, "originals", "monthly-close-2026-03.md"),
      incomplete,
      "utf-8"
    );

    await expect(computePnl(tempDir)).rejects.toThrow(
      "Monthly close file is missing required P&L fields"
    );
  });
});
