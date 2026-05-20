/**
 * lib/audit/anomaly-detector.ts
 *
 * Pure detection functions for all 4 SMB anomaly rules.
 *
 * Exported surface: runDetection(sourceDir: string): Promise<void>
 *
 * Reads from: sourceDir/{originals,companies}/*.md
 * Writes to:  sourceDir/concepts/march-anomaly-summary.md
 *             sourceDir/concepts/recurring-charges.md
 *
 * Security: sourceDir is validated to not contain path-traversal sequences
 * before any filesystem access (T-04-01 mitigation).
 *
 * Idempotent: overwrites concept pages each run.
 */

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

// ---- Thresholds (match v1.0 detect-anomalies.ts) ----------------------------
export const DEMO_TODAY = new Date("2026-04-05T00:00:00Z");
export const GHOST_THRESHOLD_DAYS = 90;
export const PRICE_HIKE_THRESHOLD_PCT = 20;
// Bi-weekly orders (e.g. beans) are 14 days apart and are NOT duplicates.
// True billing duplicates land within a week. Use a strict <7 day window.
export const DUPLICATE_WINDOW_DAYS = 7;

// ---- Types ------------------------------------------------------------------
export type Frontmatter = Record<string, string | number | string[]>;
export type Doc = { path: string; slug: string; frontmatter: Frontmatter; body: string };

type VendorMonthTotal = { vendor: string; month: string; total: number };
export type PriceHike = {
  vendor: string;
  prevMonth: string;
  curMonth: string;
  prevTotal: number;
  curTotal: number;
  pctChange: number;
  dollarDelta: number;
};
export type BankDebit = { vendor: string; date: string; amount: number; sourceSlug: string };
export type Duplicate = {
  vendor: string;
  amount: number;
  dates: string[];
  sourceSlug: string;
};
export type Ghost = {
  vendor: string;
  monthlyTotal: number;
  lastEvent: string;
  ageDays: number;
  monthsActive: number;
};
export type MissingInvoice = {
  vendor: string;
  month: string;
  debitDate: string;
  amount: number;
};

// ---- Helper functions -------------------------------------------------------

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  if (!raw.startsWith("---\n")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: raw };
  const fmRaw = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const fm: Frontmatter = {};
  for (const line of fmRaw.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      fm[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      fm[key] = Number(value);
    } else {
      fm[key] = value;
    }
  }
  return { frontmatter: fm, body };
}

async function readDocs(dir: string): Promise<Doc[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const docs: Doc[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const full = resolve(dir, entry);
    const raw = await readFile(full, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    docs.push({
      path: full,
      slug: entry.replace(/\.md$/, ""),
      frontmatter,
      body,
    });
  }
  return docs;
}

export function ym(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(ymStr: string): string {
  return new Date(`${ymStr}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function usd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function severityFor(dollarImpact: number, anomalyType: string): string {
  if (dollarImpact > 100 || anomalyType === "ghost-saas" || anomalyType === "missing-invoice") {
    return "high";
  }
  if (dollarImpact >= 30 && dollarImpact <= 100) {
    return "medium";
  }
  return "low";
}

// ---- Anomaly #1: Month-over-month price hike per vendor ---------------------
export function detectPriceHikes(invoices: Doc[]): PriceHike[] {
  const totals = new Map<string, number>();
  for (const inv of invoices) {
    const vendor = String(inv.frontmatter["vendor"] ?? "");
    const date = String(inv.frontmatter["date"] ?? "");
    const amount = Number(inv.frontmatter["amount"] ?? 0);
    if (!vendor || !date || !Number.isFinite(amount)) continue;
    const key = `${vendor}|${ym(date)}`;
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }

  const byVendor = new Map<string, VendorMonthTotal[]>();
  for (const [key, total] of totals) {
    const [vendor, month] = key.split("|") as [string, string];
    const arr = byVendor.get(vendor) ?? [];
    arr.push({ vendor, month, total });
    byVendor.set(vendor, arr);
  }

  const priceHikes: PriceHike[] = [];
  for (const [vendor, rows] of byVendor) {
    rows.sort((a, b) => a.month.localeCompare(b.month));
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1]!;
      const cur = rows[i]!;
      if (prev.total <= 0) continue;
      const pctChange = ((cur.total - prev.total) / prev.total) * 100;
      if (pctChange >= PRICE_HIKE_THRESHOLD_PCT) {
        priceHikes.push({
          vendor,
          prevMonth: prev.month,
          curMonth: cur.month,
          prevTotal: prev.total,
          curTotal: cur.total,
          pctChange,
          dollarDelta: cur.total - prev.total,
        });
      }
    }
  }
  return priceHikes;
}

// ---- Anomaly #2: Duplicate vendor charges on bank statements ----------------
export function parseDebits(bankStatements: Doc[]): BankDebit[] {
  const debits: BankDebit[] = [];
  for (const stmt of bankStatements) {
    for (const line of stmt.body.split("\n")) {
      // Accept both bare `[[vendor]]` and path-prefixed `[[companies/vendor]]` wikilinks.
      const m = line.match(
        /^-\s+(\d{4}-\d{2}-\d{2}):\s+\$([0-9,]+\.\d{2})\s+debit\s+—.*\[\[(?:companies\/)?([a-z0-9-]+)\]\]/
      );
      if (!m) continue;
      debits.push({
        date: m[1]!,
        amount: Number(m[2]!.replaceAll(",", "")),
        vendor: m[3]!,
        sourceSlug: stmt.slug,
      });
    }
  }
  return debits;
}

export function detectDuplicates(debits: BankDebit[]): Duplicate[] {
  const duplicates: Duplicate[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < debits.length; i++) {
    const a = debits[i]!;
    for (let j = i + 1; j < debits.length; j++) {
      const b = debits[j]!;
      if (a.vendor !== b.vendor) continue;
      if (Math.abs(a.amount - b.amount) > 0.005) continue;
      const ad = Date.parse(a.date);
      const bd = Date.parse(b.date);
      const days = Math.abs(bd - ad) / 86_400_000;
      if (days < 1 || days > DUPLICATE_WINDOW_DAYS) continue;
      const key = `${a.vendor}|${a.amount}|${a.date}|${b.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      duplicates.push({
        vendor: a.vendor,
        amount: a.amount,
        dates: [a.date, b.date].sort(),
        sourceSlug: a.sourceSlug,
      });
    }
  }
  return duplicates;
}

// ---- Anomaly #3: Ghost subscriptions ----------------------------------------
export function detectGhosts(companies: Doc[], debits: BankDebit[]): Ghost[] {
  const ghosts: Ghost[] = [];
  const debitsByVendor = new Map<string, BankDebit[]>();
  for (const d of debits) {
    const arr = debitsByVendor.get(d.vendor) ?? [];
    arr.push(d);
    debitsByVendor.set(d.vendor, arr);
  }

  for (const company of companies) {
    const slug = String(company.frontmatter["slug"] ?? company.slug);
    const vendorDebits = debitsByVendor.get(slug) ?? [];
    if (vendorDebits.length === 0) continue;

    const months = new Set(vendorDebits.map((d) => ym(d.date)));
    if (months.size < 2) continue;
    const monthlyTotal = vendorDebits
      .filter((d) => ym(d.date) === Array.from(months).sort().at(-1))
      .reduce((a, d) => a + d.amount, 0);

    const dateLines = [...company.body.matchAll(/^-\s+(\d{4}-\d{2}-\d{2}):/gm)].map(
      (m) => m[1]!
    );
    if (dateLines.length === 0) continue;
    const latest = dateLines.sort().at(-1)!;
    const ageDays = (DEMO_TODAY.getTime() - Date.parse(latest)) / 86_400_000;

    if (ageDays >= GHOST_THRESHOLD_DAYS) {
      ghosts.push({
        vendor: slug,
        monthlyTotal,
        lastEvent: latest,
        ageDays: Math.round(ageDays),
        monthsActive: months.size,
      });
    }
  }
  return ghosts;
}

// ---- Anomaly #4: Missing invoice (NEW — SKIL-03 / DATA-12) ------------------
export function detectMissingInvoices(invoices: Doc[], debits: BankDebit[]): MissingInvoice[] {
  // Build a set of (vendor, month) pairs that have at least one invoice
  const invoicedPairs = new Set<string>();
  for (const inv of invoices) {
    const vendor = String(inv.frontmatter["vendor"] ?? "");
    const date = String(inv.frontmatter["date"] ?? "");
    if (!vendor || !date) continue;
    invoicedPairs.add(`${vendor}|${ym(date)}`);
  }

  // Find debit (vendor, month) pairs with no matching invoice
  // Deduplicate — one bullet per unique (vendor, month) pair
  const seen = new Set<string>();
  const missing: MissingInvoice[] = [];
  for (const debit of debits) {
    const key = `${debit.vendor}|${ym(debit.date)}`;
    if (invoicedPairs.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    missing.push({
      vendor: debit.vendor,
      month: ym(debit.date),
      debitDate: debit.date,
      amount: debit.amount,
    });
  }
  return missing;
}

// ---- Main exported function -------------------------------------------------

/**
 * Run all 4 anomaly detection rules against the brain directory at sourceDir.
 *
 * Security: validates sourceDir does not contain path traversal before reads.
 * Writes concept pages to sourceDir/concepts/ (overwrites on each run — idempotent).
 */
export async function runDetection(sourceDir: string): Promise<void> {
  // T-04-01: validate sourceDir does not contain path traversal
  if (sourceDir.includes("..")) {
    throw new Error(
      `[smb-audit] Rejected sourceDir containing path traversal: ${sourceDir}`
    );
  }

  const ORIGINALS = resolve(sourceDir, "originals");
  const COMPANIES = resolve(sourceDir, "companies");
  const CONCEPTS = resolve(sourceDir, "concepts");

  const originals = await readDocs(ORIGINALS);
  const companies = await readDocs(COMPANIES);

  const invoices = originals.filter((d) => d.frontmatter["type"] === "invoice");
  const bankStatements = originals.filter((d) => d.frontmatter["type"] === "bank-statement");

  // ---- Run all 4 anomaly rules ----
  const allDebits = parseDebits(bankStatements);

  const priceHikes = detectPriceHikes(invoices);
  const duplicates = detectDuplicates(allDebits);
  const ghosts = detectGhosts(companies, allDebits);
  const missingInvoices = detectMissingInvoices(invoices, allDebits);

  // ---- Determine "last month" for the summary ----
  const totals = new Map<string, number>();
  for (const inv of invoices) {
    const vendor = String(inv.frontmatter["vendor"] ?? "");
    const date = String(inv.frontmatter["date"] ?? "");
    const amount = Number(inv.frontmatter["amount"] ?? 0);
    if (!vendor || !date || !Number.isFinite(amount)) continue;
    totals.set(`${vendor}|${ym(date)}`, (totals.get(`${vendor}|${ym(date)}`) ?? 0) + amount);
  }

  const allMonths = Array.from(new Set([...totals.keys()].map((k) => k.split("|")[1]!))).sort();
  const lastMonth = allMonths.at(-1) ?? "2026-03";

  const lastMonthHikes = priceHikes.filter((h) => h.curMonth === lastMonth);
  const lastMonthDuplicates = duplicates.filter((d) => d.dates.some((x) => ym(x) === lastMonth));
  const lastMonthMissing = missingInvoices.filter((m) => m.month === lastMonth);

  // ---- Build anomaly sidecar list ----
  type AnomalySidecar = {
    severity: string;
    dollar_impact: number;
    anomaly_type: string;
    vendor_slug: string;
  };
  const anomaliesSidecar: AnomalySidecar[] = [];

  for (const h of lastMonthHikes) {
    anomaliesSidecar.push({
      severity: severityFor(h.dollarDelta, "price-hike"),
      dollar_impact: Math.round(h.dollarDelta * 100) / 100,
      anomaly_type: "price-hike",
      vendor_slug: h.vendor,
    });
  }
  for (const d of lastMonthDuplicates) {
    anomaliesSidecar.push({
      severity: severityFor(d.amount, "duplicate"),
      dollar_impact: Math.round(d.amount * 100) / 100,
      anomaly_type: "duplicate",
      vendor_slug: d.vendor,
    });
  }
  for (const g of ghosts) {
    anomaliesSidecar.push({
      severity: severityFor(g.monthlyTotal, "ghost-saas"),
      dollar_impact: Math.round(g.monthlyTotal * 100) / 100,
      anomaly_type: "ghost-saas",
      vendor_slug: g.vendor,
    });
  }
  for (const mi of lastMonthMissing) {
    anomaliesSidecar.push({
      severity: severityFor(mi.amount, "missing-invoice"),
      dollar_impact: Math.round(mi.amount * 100) / 100,
      anomaly_type: "missing-invoice",
      vendor_slug: mi.vendor,
    });
  }

  // ---- Build bullet lines (must match bulletRegex) ----
  const summaryBullets: string[] = [];

  // Price-hike bullets: include "($X.XX more this month)" so extractDollarImpact works
  for (const h of lastMonthHikes) {
    summaryBullets.push(
      `- ${h.curMonth}-01: [[companies/${h.vendor}]] invoices jumped from $${usd(h.prevTotal)} in ${monthLabel(h.prevMonth)} to $${usd(h.curTotal)} in ${monthLabel(h.curMonth)} — a +${h.pctChange.toFixed(1)}% increase ($${usd(h.dollarDelta)} more this month)`
    );
  }

  // Duplicate bullets
  for (const d of lastMonthDuplicates) {
    summaryBullets.push(
      `- ${d.dates[0]}: [[companies/${d.vendor}]] charged $${usd(d.amount)} twice in ${monthLabel(ym(d.dates[0]!))} (on ${d.dates.join(" and ")}); only one charge was expected — see [[${d.sourceSlug}]]`
    );
  }

  // Ghost bullets
  for (const g of ghosts) {
    summaryBullets.push(
      `- ${lastMonth}-31: [[companies/${g.vendor}]] billed $${usd(g.monthlyTotal)} this month and has been billing for ${g.monthsActive}+ months, but the last meaningful vendor activity on [[companies/${g.vendor}]] was ${g.lastEvent} (${g.ageDays} days ago) — likely a forgotten recurring subscription`
    );
  }

  // Missing-invoice bullets
  for (const mi of lastMonthMissing) {
    summaryBullets.push(
      `- ${mi.debitDate}: [[companies/${mi.vendor}]] debited $${usd(mi.amount)} in ${monthLabel(mi.month)} with no matching invoice on file — request invoice from vendor`
    );
  }

  // ---- Build plain text summary ----
  const summaryPlain = [
    `In ${monthLabel(lastMonth)}, ${anomaliesSidecar.length} anomalies were detected in [[people/mara-okafor]]'s books:`,
    ...lastMonthHikes.map(
      (h) =>
        `(1) a +${h.pctChange.toFixed(1)}% price hike from [[companies/${h.vendor}]] — spend rose from $${usd(h.prevTotal)} to $${usd(h.curTotal)}`
    ),
    ...lastMonthDuplicates.map(
      (d) =>
        `(2) a duplicate $${usd(d.amount)} charge from [[companies/${d.vendor}]] on ${d.dates.join(" and ")}`
    ),
    ...ghosts.map(
      (g) =>
        `(3) a ghost recurring charge from [[companies/${g.vendor}]] at $${usd(g.monthlyTotal)}/mo with no vendor activity in ${g.ageDays} days`
    ),
    ...lastMonthMissing.map(
      (mi) =>
        `(4) a missing invoice for [[companies/${mi.vendor}]] — $${usd(mi.amount)} debit on ${mi.debitDate} with no invoice document on file`
    ),
  ].join(" ");

  // ---- Build YAML anomalies sidecar block ----
  const anomaliesYaml = anomaliesSidecar
    .map(
      (a) =>
        `  - severity: ${a.severity}\n    dollar_impact: ${usd(a.dollar_impact)}\n    anomaly_type: ${a.anomaly_type}\n    vendor_slug: ${a.vendor_slug}`
    )
    .join("\n");

  // ---- Write march-anomaly-summary.md ----
  await mkdir(CONCEPTS, { recursive: true });

  // gbrain derives slug from the file path; do NOT set `slug:` in frontmatter
  const summary = `---
type: concept
title: ${monthLabel(lastMonth)} Anomaly Summary
date: ${lastMonth}-31
tags: [anomaly, summary, ${lastMonth}, weird]
anomalies:
${anomaliesYaml}
---

Compiled truth: This page enumerates everything weird, unusual, or unexpected detected in [[people/mara-okafor]]'s books for ${monthLabel(lastMonth)} (also known as "last month"). ${summaryPlain}

---

${summaryBullets.join("\n")}
- ${lastMonth}-31: [[companies/detection-method]] Detection method — month-over-month invoice totals per vendor (price-hike rule, threshold +${PRICE_HIKE_THRESHOLD_PCT}%); bank-statement debit deduplication within a ${DUPLICATE_WINDOW_DAYS}-day window; recurring-charge audit against [[companies]] last-event timestamps (ghost threshold ${GHOST_THRESHOLD_DAYS} days); bank-debit-without-invoice cross-reference (missing-invoice rule).
`;

  // ---- Write recurring-charges.md ----
  const debitsByVendor = new Map<string, BankDebit[]>();
  for (const d of allDebits) {
    const arr = debitsByVendor.get(d.vendor) ?? [];
    arr.push(d);
    debitsByVendor.set(d.vendor, arr);
  }

  const recurringBullets: string[] = [];
  for (const [vendor, vendorDebits] of debitsByVendor) {
    const months = Array.from(new Set(vendorDebits.map((d) => ym(d.date))));
    if (months.length < 2) continue;
    const recent = months.sort().at(-1)!;
    const recentTotal = vendorDebits
      .filter((d) => ym(d.date) === recent)
      .reduce((a, d) => a + d.amount, 0);

    const company = companies.find((c) => (c.frontmatter["slug"] ?? c.slug) === vendor);
    const eventDates = company
      ? [...company.body.matchAll(/^-\s+(\d{4}-\d{2}-\d{2}):/gm)].map((m) => m[1]!)
      : [];
    const lastEvent = eventDates.sort().at(-1) ?? "(no events on company page)";
    const ageDays = company
      ? Math.round((DEMO_TODAY.getTime() - Date.parse(lastEvent)) / 86_400_000)
      : -1;
    const tag = ageDays >= GHOST_THRESHOLD_DAYS ? " ⚠ GHOST" : "";

    recurringBullets.push(
      `- ${recent}-31: [[companies/${vendor}]] — $${usd(recentTotal)} in ${monthLabel(recent)}, active across ${months.length} months; last meaningful vendor event ${lastEvent} (${ageDays} days ago)${tag}`
    );
  }

  const recurringPage = `---
type: concept
title: Recurring Charges Audit
date: ${lastMonth}-31
tags: [recurring, subscriptions, audit, saas]
---

Compiled truth: Every vendor that debited [[people/mara-okafor]]'s operating account in two or more distinct months, with the most recent monthly total and the age of the last meaningful vendor event on the company timeline. Vendors flagged ⚠ GHOST have no vendor activity in the last ${GHOST_THRESHOLD_DAYS} days — candidates for cancellation.

---

${recurringBullets.join("\n")}
- ${lastMonth}-31: Audit generated by lib/audit/anomaly-detector.ts; ghost threshold ${GHOST_THRESHOLD_DAYS} days
`;

  await writeFile(resolve(CONCEPTS, "march-anomaly-summary.md"), summary, "utf8");
  await writeFile(resolve(CONCEPTS, "recurring-charges.md"), recurringPage, "utf8");

  // ---- Progress report ----
  console.log(`Detected:`);
  console.log(
    `  ${priceHikes.length} price hikes (${lastMonthHikes.length} in ${lastMonth})`
  );
  console.log(
    `  ${duplicates.length} duplicate charges (${lastMonthDuplicates.length} in ${lastMonth})`
  );
  console.log(`  ${ghosts.length} ghost subscriptions`);
  console.log(
    `  ${missingInvoices.length} missing invoices (${lastMonthMissing.length} in ${lastMonth})`
  );
  console.log(`Wrote ${CONCEPTS}/march-anomaly-summary.md`);
  console.log(`Wrote ${CONCEPTS}/recurring-charges.md`);

  // ---- Exit condition: warn if 0 anomalies for seed brain ----
  const totalAnomalies =
    lastMonthHikes.length +
    lastMonthDuplicates.length +
    ghosts.length +
    lastMonthMissing.length;
  if (totalAnomalies === 0) {
    console.warn(
      `\nWARNING: 0 anomalies detected for ${lastMonth}. Concept pages written but may be empty.`
    );
  }
}
