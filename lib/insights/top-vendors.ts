import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import type { TopVendorRow } from "./types.js";

/**
 * Compute the top 5 vendors by total spend across Q1 2026
 * (January, February, March) from invoice frontmatter files.
 *
 * Reads from `data/maras-coffee/originals/invoice-*.md`.
 * No gbrain invocations — pure static file parsing.
 */
export async function computeTopVendors(
  fixturesDir: string
): Promise<TopVendorRow[]> {
  const originalsDir = join(fixturesDir, "originals");
  const allFiles = await readdir(originalsDir);
  const invoiceFiles = allFiles.filter((f) => /^invoice-.*\.md$/.test(f));

  const vendorMap = new Map<string, { total: number; invoiceCount: number }>();

  for (const filename of invoiceFiles) {
    const filePath = join(originalsDir, filename);
    const text = await readFile(filePath, "utf-8");
    const fm = parseFrontmatter(text);

    // Require all fields
    if (fm["type"] !== "invoice") continue;
    if (typeof fm["vendor"] !== "string" || !fm["vendor"]) continue;
    if (typeof fm["date"] !== "string" || !fm["date"]) continue;
    if (typeof fm["amount"] !== "number") continue;

    const vendor = fm["vendor"] as string;
    const date = fm["date"] as string;
    const amount = fm["amount"] as number;

    // Filter to Q1 2026 only
    if (
      !date.startsWith("2026-01") &&
      !date.startsWith("2026-02") &&
      !date.startsWith("2026-03")
    ) {
      continue;
    }

    const existing = vendorMap.get(vendor) ?? { total: 0, invoiceCount: 0 };
    vendorMap.set(vendor, {
      total: existing.total + amount,
      invoiceCount: existing.invoiceCount + 1,
    });
  }

  // Sort by total descending, take top 5
  const sorted = Array.from(vendorMap.entries())
    .map(([vendor, { total, invoiceCount }]) => ({
      vendor,
      total: Math.round(total * 100) / 100,
      invoiceCount,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return sorted;
}
