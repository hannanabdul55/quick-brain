import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AnomalyRow } from "./types.ts";

/**
 * Source path mapping: for known vendors, use the originating document.
 * Fallback for unknown vendors: the anomaly summary itself.
 */
const SOURCE_PATH_MAP = new Map<string, string>([
  [
    "beanstalk-roasters",
    "originals/invoice-beanstalk-roasters-br-2026-03-a.md",
  ],
  ["square-pos", "originals/bank-statement-2026-03.md"],
  ["seven-shifts", "originals/bank-statement-2026-03.md"],
]);

const FALLBACK_SOURCE = "concepts/march-anomaly-summary.md";

/**
 * Extract the dollar impact from a description string.
 *
 * Special-case for the price-hike bullet (beanstalk-roasters): prefer the
 * parenthetical `($330.00 more this month)` value over the max-dollar fallback,
 * because the description also contains $1,500.00 and $1,830.00 which are
 * larger but represent the full invoice totals, not the anomaly impact.
 */
function extractDollarImpact(description: string): number {
  // Special-case: look for parenthetical "($X more this month)"
  const parentheticalMatch = description.match(
    /\(\$([0-9,]+(?:\.\d{2})?)\s+more this month\)/
  );
  if (parentheticalMatch) {
    return parseFloat(parentheticalMatch[1]!.replace(/,/g, ""));
  }

  // Fallback: largest dollar figure in description
  const allMatches = [...description.matchAll(/\$([0-9,]+(?:\.\d{2})?)/g)];
  if (allMatches.length === 0) return 0;

  const amounts = allMatches.map((m) => parseFloat(m[1]!.replace(/,/g, "")));
  return Math.max(...amounts);
}

/**
 * Parse anomaly bullets from concepts/march-anomaly-summary.md.
 *
 * Each bullet has the shape:
 *   - YYYY-MM-DD: [[companies/slug]] description text
 *
 * The 4th "Detection method" footer bullet is filtered out.
 * Throws if fewer than 3 anomaly rows are extracted.
 */
export async function computeAnomalies(
  fixturesDir: string
): Promise<AnomalyRow[]> {
  const filePath = join(fixturesDir, "concepts", "march-anomaly-summary.md");
  const text = await readFile(filePath, "utf-8");

  // Split on `\n---\n` and take body (after the first divider)
  const parts = text.split(/\n---\n/);
  const body = parts.length > 1 ? parts.slice(1).join("\n---\n") : text;

  const rows: AnomalyRow[] = [];

  // Regex: date, wikilink target, description
  const bulletRegex =
    /^- (\d{4}-\d{2}-\d{2}):\s+\[\[([^\]]+)\]\]\s+(.+?)$/;

  for (const line of body.split("\n")) {
    const match = line.match(bulletRegex);
    if (!match) continue;

    const date = match[1]!;
    const wikilinkTarget = match[2]!; // e.g. "companies/beanstalk-roasters"
    const description = match[3]!;

    // CRITICAL filter: skip if not a companies/ link or if it's a metadata footer
    if (!wikilinkTarget.startsWith("companies/")) continue;
    if (description.startsWith("Detection method")) continue;

    const vendorSlug = wikilinkTarget.replace(/^companies\//, "");
    const dollarImpact = extractDollarImpact(description);
    const sourcePath =
      SOURCE_PATH_MAP.get(vendorSlug) ?? FALLBACK_SOURCE;

    rows.push({
      date,
      vendorSlug,
      description,
      dollarImpact,
      sourcePath,
    });
  }

  if (rows.length < 3) {
    throw new Error(
      `Expected at least 3 anomaly rows, got ${rows.length}. Check march-anomaly-summary.md format.`
    );
  }

  return rows;
}
