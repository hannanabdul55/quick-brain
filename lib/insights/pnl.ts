import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PnlSnapshot } from "./types.ts";

type MonthlyCloseData = {
  revenue: number;
  cogs: number;
  opex: number;
  net: number;
};

/**
 * Parse a monthly-close markdown file body for P&L figures.
 *
 * Expects body lines like:
 *   - 2026-03-31: Revenue $27,480.00
 *   - 2026-03-31: COGS $1,830.00
 *   - 2026-03-31: Opex $6,857.95
 *   - 2026-03-31: Net $18,792.05
 */
async function parseMonthlyClose(filePath: string): Promise<MonthlyCloseData> {
  const text = await readFile(filePath, "utf-8");

  // Split on `\n---\n` to get the body (after frontmatter)
  const parts = text.split(/\n---\n/);
  // The body is the last section (after the frontmatter divider)
  const body = parts.length > 1 ? parts.slice(1).join("\n---\n") : text;

  const result: Partial<MonthlyCloseData> = {};

  const lineRegex =
    /^- \d{4}-\d{2}-\d{2}:\s+(Revenue|COGS|Opex|Net)\s+\$([0-9,]+\.\d{2})/;

  for (const line of body.split("\n")) {
    const match = line.match(lineRegex);
    if (!match) continue;

    const label = match[1]!;
    const rawAmount = match[2]!.replace(/,/g, "");
    const amount = parseFloat(rawAmount);

    switch (label) {
      case "Revenue":
        result.revenue = amount;
        break;
      case "COGS":
        result.cogs = amount;
        break;
      case "Opex":
        result.opex = amount;
        break;
      case "Net":
        result.net = amount;
        break;
    }
  }

  // All 4 fields are required
  if (
    result.revenue === undefined ||
    result.cogs === undefined ||
    result.opex === undefined ||
    result.net === undefined
  ) {
    throw new Error(
      `Monthly close file is missing required P&L fields: ${filePath}`
    );
  }

  return result as MonthlyCloseData;
}

/**
 * Compute P&L snapshot for March 2026 (current demo month) with February 2026
 * as the prior month for delta comparison.
 *
 * Reads directly from data/maras-coffee/originals/ — no gbrain invocations.
 */
export async function computePnl(fixturesDir: string): Promise<PnlSnapshot> {
  const currentPath = join(
    fixturesDir,
    "originals",
    "monthly-close-2026-03.md"
  );
  const prevPath = join(fixturesDir, "originals", "monthly-close-2026-02.md");

  const current = await parseMonthlyClose(currentPath);

  let prevMonth:
    | { month: string; revenue: number; cogs: number; opex: number; net: number }
    | undefined;

  try {
    const prev = await parseMonthlyClose(prevPath);
    prevMonth = {
      month: "2026-02",
      ...prev,
    };
  } catch {
    // If prev-month file is missing, omit prevMonth (card renders "—" for delta)
    prevMonth = undefined;
  }

  return {
    month: "2026-03",
    ...current,
    ...(prevMonth !== undefined ? { prevMonth } : {}),
  };
}
