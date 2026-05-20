/**
 * Unit tests for lib/insights/anomalies.ts
 *
 * Tests:
 * - bulletRegex contract (inline, not imported — it is not exported)
 * - computeAnomalies happy-path with temp file fixtures
 * - computeAnomalies throws when fewer than 3 valid anomaly rows
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeAnomalies } from "../../../lib/insights/anomalies.ts";

// Inline reconstruction of bulletRegex (not exported from anomalies.ts)
// Exact regex from the codebase
const bulletRegex = /^- (\d{4}-\d{2}-\d{2}):\s+\[\[([^\]]+)\]\]\s+(.+?)$/;

// ---- bulletRegex contract tests ---------------------------------------------

describe("bulletRegex", () => {
  it("matches a valid anomaly bullet with companies/ prefix", () => {
    const line =
      "- 2026-03-15: [[companies/beanstalk-roasters]] Price hike: $330 ($150 more this month)";
    const match = line.match(bulletRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("2026-03-15");
    expect(match![2]).toBe("companies/beanstalk-roasters");
    expect(match![3]).toContain("Price hike");
  });

  it("matches any wikilink format (bulletRegex is not selective about companies/ prefix)", () => {
    // The regex itself matches any [[target]] — the companies/ filter is applied in code
    const line =
      "- 2026-03-15: [[beanstalk-roasters]] Bad format";
    const match = line.match(bulletRegex);
    // The regex matches — the code filters non-companies/ targets separately
    expect(match).not.toBeNull();
    expect(match![2]).toBe("beanstalk-roasters");
  });

  it("does NOT match detection method footer line (different format)", () => {
    // The footer bullet looks like: "- YYYY-MM-DD: [[companies/detection-method]] Detection method..."
    // But the raw "Detection method" line without proper structure won't match
    const line = "- Detection method: hike (no wikilink here)";
    const match = line.match(bulletRegex);
    expect(match).toBeNull();
  });

  it("does NOT match empty lines or non-bullet lines", () => {
    expect("".match(bulletRegex)).toBeNull();
    expect("just some text".match(bulletRegex)).toBeNull();
    expect("# Header".match(bulletRegex)).toBeNull();
  });

  it("matches a duplicate-charge bullet correctly", () => {
    const line =
      "- 2026-03-01: [[companies/square-pos]] charged $50.00 twice in March 2026";
    const match = line.match(bulletRegex);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("2026-03-01");
    expect(match![2]).toBe("companies/square-pos");
    expect(match![3]).toContain("charged $50.00");
  });

  it("does NOT match when there is no date in proper format", () => {
    const line = "- March 15: [[companies/vendor]] description";
    expect(line.match(bulletRegex)).toBeNull();
  });
});

// ---- computeAnomalies with temp file fixtures --------------------------------

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
  const dir = join(base, `qb-anomalies-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(dir, "concepts"), { recursive: true });
  return dir;
}

const VALID_SUMMARY_CONTENT = `---
type: concept
title: March 2026 Anomaly Summary
date: 2026-03-31
tags: [anomaly, summary, 2026-03, weird]
anomalies:
  - severity: high
    dollar_impact: 330.00
    anomaly_type: price-hike
    vendor_slug: beanstalk-roasters
  - severity: medium
    dollar_impact: 50.00
    anomaly_type: duplicate
    vendor_slug: square-pos
  - severity: high
    dollar_impact: 29.99
    anomaly_type: ghost-saas
    vendor_slug: seven-shifts
---

Compiled truth: 3 anomalies detected.

---

- 2026-03-15: [[companies/beanstalk-roasters]] invoices jumped from $1,500.00 in January 2026 to $1,830.00 in March 2026 — a +22.0% increase ($330.00 more this month)
- 2026-03-01: [[companies/square-pos]] charged $50.00 twice in March 2026 (on 2026-03-01 and 2026-03-05); only one charge was expected
- 2026-03-31: [[companies/seven-shifts]] billed $29.99 this month and has been billing for 4+ months, but the last meaningful vendor activity was 2025-12-01 (125 days ago) — likely a forgotten recurring subscription
- 2026-03-31: [[companies/detection-method]] Detection method — month-over-month invoice totals per vendor (price-hike rule, threshold +20%); bank-statement debit deduplication within a 7-day window; recurring-charge audit against [[companies]] last-event timestamps (ghost threshold 90 days); bank-debit-without-invoice cross-reference (missing-invoice rule).
`;

describe("computeAnomalies", () => {
  it("happy-path: returns correct AnomalyRow[] from valid march-anomaly-summary.md", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "concepts", "march-anomaly-summary.md"),
      VALID_SUMMARY_CONTENT,
      "utf-8"
    );

    const rows = await computeAnomalies(tempDir);
    expect(rows).toHaveLength(3); // Detection method line is filtered out
    expect(rows[0]!.vendorSlug).toBe("beanstalk-roasters");
    expect(rows[0]!.date).toBe("2026-03-15");
    expect(rows[0]!.dollarImpact).toBe(330); // parenthetical extraction
    expect(rows[1]!.vendorSlug).toBe("square-pos");
    expect(rows[2]!.vendorSlug).toBe("seven-shifts");
  });

  it("each AnomalyRow has the correct shape (date, vendorSlug, description, dollarImpact, sourcePath)", async () => {
    tempDir = await createTempDir();
    await writeFile(
      join(tempDir, "concepts", "march-anomaly-summary.md"),
      VALID_SUMMARY_CONTENT,
      "utf-8"
    );

    const rows = await computeAnomalies(tempDir);
    const row = rows[0]!;
    expect(typeof row.date).toBe("string");
    expect(typeof row.vendorSlug).toBe("string");
    expect(typeof row.description).toBe("string");
    expect(typeof row.dollarImpact).toBe("number");
    expect(typeof row.sourcePath).toBe("string");
  });

  it("throws when fewer than 3 valid anomaly rows are found", async () => {
    tempDir = await createTempDir();
    // Only 2 valid bullets (not enough)
    const insufficientContent = `---
type: concept
---

---

- 2026-03-15: [[companies/beanstalk-roasters]] invoices jumped from $1,500.00 to $1,830.00 ($330.00 more this month)
- 2026-03-01: [[companies/square-pos]] charged $50.00 twice
`;
    await writeFile(
      join(tempDir, "concepts", "march-anomaly-summary.md"),
      insufficientContent,
      "utf-8"
    );

    await expect(computeAnomalies(tempDir)).rejects.toThrow(
      "Expected at least 3 anomaly rows"
    );
  });

  it("filters out non-companies/ wikilinks from anomaly rows", async () => {
    tempDir = await createTempDir();
    const contentWithMixedLinks = `---
type: concept
---

---

- 2026-03-15: [[companies/vendor-a]] Price hike ($100.00 more this month)
- 2026-03-15: [[companies/vendor-b]] Duplicate charge $50.00
- 2026-03-15: [[companies/vendor-c]] Ghost subscription $29.99 this month
- 2026-03-31: [[people/mara-okafor]] Not a vendor link (should be filtered)
- 2026-03-31: [[companies/detection-method]] Detection method — filtered by code logic
`;
    await writeFile(
      join(tempDir, "concepts", "march-anomaly-summary.md"),
      contentWithMixedLinks,
      "utf-8"
    );

    const rows = await computeAnomalies(tempDir);
    // detection-method is filtered by "Detection method" description check
    // people/mara-okafor is filtered by companies/ prefix check
    expect(rows.every((r) => r.vendorSlug !== "mara-okafor")).toBe(true);
    expect(rows.every((r) => r.vendorSlug !== "detection-method")).toBe(true);
    expect(rows).toHaveLength(3); // vendor-a, vendor-b, vendor-c
  });
});
