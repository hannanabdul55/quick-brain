/**
 * Unit tests for lib/insights/top-vendors.ts
 *
 * Tests computeTopVendors via temp directory fixtures with synthetic invoice files.
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeTopVendors } from "../../../lib/insights/top-vendors.ts";

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
    `qb-vendors-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(join(dir, "originals"), { recursive: true });
  return dir;
}

function buildInvoiceFile(
  vendor: string,
  date: string,
  amount: number,
  type = "invoice"
): string {
  return `---
type: ${type}
vendor: ${vendor}
date: ${date}
amount: ${amount}
currency: USD
---

Invoice from ${vendor}.
`;
}

describe("computeTopVendors", () => {
  it("returns vendors sorted by total descending", async () => {
    tempDir = await createTempDir();
    // 3 vendors with different totals
    await writeFile(
      join(tempDir, "originals", "invoice-beanstalk-001.md"),
      buildInvoiceFile("Beanstalk Roasters", "2026-03-01", 1500),
      "utf-8"
    );
    await writeFile(
      join(tempDir, "originals", "invoice-square-001.md"),
      buildInvoiceFile("Square POS", "2026-03-01", 500),
      "utf-8"
    );
    await writeFile(
      join(tempDir, "originals", "invoice-seven-001.md"),
      buildInvoiceFile("Seven Shifts", "2026-03-01", 250),
      "utf-8"
    );

    const result = await computeTopVendors(tempDir);
    expect(result).toHaveLength(3);
    // Sorted descending
    expect(result[0]!.vendor).toBe("Beanstalk Roasters");
    expect(result[0]!.total).toBe(1500);
    expect(result[1]!.vendor).toBe("Square POS");
    expect(result[1]!.total).toBe(500);
    expect(result[2]!.vendor).toBe("Seven Shifts");
    expect(result[2]!.total).toBe(250);
  });

  it("accumulates multiple invoices from the same vendor", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "originals", "invoice-beans-jan.md"),
      buildInvoiceFile("Beanstalk Roasters", "2026-01-15", 500),
      "utf-8"
    );
    await writeFile(
      join(tempDir, "originals", "invoice-beans-feb.md"),
      buildInvoiceFile("Beanstalk Roasters", "2026-02-15", 750),
      "utf-8"
    );
    await writeFile(
      join(tempDir, "originals", "invoice-beans-mar.md"),
      buildInvoiceFile("Beanstalk Roasters", "2026-03-15", 1000),
      "utf-8"
    );

    const result = await computeTopVendors(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("Beanstalk Roasters");
    expect(result[0]!.total).toBe(2250);
    expect(result[0]!.invoiceCount).toBe(3);
  });

  it("ignores files without type: invoice in frontmatter", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "originals", "invoice-valid.md"),
      buildInvoiceFile("Vendor A", "2026-03-01", 300),
      "utf-8"
    );
    // bank-statement should be ignored
    await writeFile(
      join(tempDir, "originals", "invoice-not-an-invoice.md"),
      buildInvoiceFile("Vendor B", "2026-03-01", 9999, "bank-statement"),
      "utf-8"
    );

    const result = await computeTopVendors(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("Vendor A");
  });

  it("ignores invoices outside Q1 2026 (Jan-Mar 2026)", async () => {
    tempDir = await createTempDir();
    // Q1 2026 invoice — included
    await writeFile(
      join(tempDir, "originals", "invoice-q1.md"),
      buildInvoiceFile("Vendor Q1", "2026-02-15", 400),
      "utf-8"
    );
    // 2025 invoice — excluded
    await writeFile(
      join(tempDir, "originals", "invoice-old.md"),
      buildInvoiceFile("Vendor Old", "2025-12-01", 9000),
      "utf-8"
    );
    // 2026-04 invoice — excluded (outside Q1)
    await writeFile(
      join(tempDir, "originals", "invoice-q2.md"),
      buildInvoiceFile("Vendor Q2", "2026-04-01", 8000),
      "utf-8"
    );

    const result = await computeTopVendors(tempDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("Vendor Q1");
    expect(result[0]!.total).toBe(400);
  });

  it("returns at most 5 vendors (top-5 cap)", async () => {
    tempDir = await createTempDir();
    // Create 7 vendors
    const vendors = ["V1", "V2", "V3", "V4", "V5", "V6", "V7"];
    for (const [i, v] of vendors.entries()) {
      await writeFile(
        join(tempDir, "originals", `invoice-${v.toLowerCase()}.md`),
        buildInvoiceFile(v, "2026-03-01", 1000 + i * 10),
        "utf-8"
      );
    }

    const result = await computeTopVendors(tempDir);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns empty array when no invoice files exist", async () => {
    tempDir = await createTempDir();
    const result = await computeTopVendors(tempDir);
    expect(result).toHaveLength(0);
  });

  it("TopVendorRow has correct shape (vendor, total, invoiceCount)", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "originals", "invoice-shape-test.md"),
      buildInvoiceFile("Shape Vendor", "2026-03-01", 100),
      "utf-8"
    );

    const result = await computeTopVendors(tempDir);
    expect(result).toHaveLength(1);
    const row = result[0]!;
    expect(typeof row.vendor).toBe("string");
    expect(typeof row.total).toBe("number");
    expect(typeof row.invoiceCount).toBe("number");
    expect(row.invoiceCount).toBe(1);
  });
});
