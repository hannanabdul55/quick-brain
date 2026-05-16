#!/usr/bin/env bun
// DATA-08: TypeScript anomaly detector.
//
// Reads the imported brain source (data/maras-coffee/{originals,companies})
// and writes its findings to data/maras-coffee/concepts/. Two output pages:
//
//   concepts/march-anomaly-summary.md — natural-language summary of all
//     detected anomalies for the most recent month, written so that a hybrid
//     search for "what was weird about March / last month" hits this page.
//   concepts/recurring-charges.md     — list of every recurring monthly
//     charge with a "last meaningful vendor event" age. Ghost subscriptions
//     surface here because their last-event age is large.
//
// Run:  bun scripts/detect-anomalies.ts
//
// Idempotent — overwrites the two concept pages each run.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const DATA_ROOT = resolve(REPO_ROOT, "data", "maras-coffee");
const ORIGINALS = resolve(DATA_ROOT, "originals");
const COMPANIES = resolve(DATA_ROOT, "companies");
const CONCEPTS = resolve(DATA_ROOT, "concepts");

// Treat this as "today" for the demo. Pinned so anomaly framing doesn't drift.
const DEMO_TODAY = new Date("2026-04-05T00:00:00Z");
const GHOST_THRESHOLD_DAYS = 90;
const PRICE_HIKE_THRESHOLD_PCT = 20;
// Bi-weekly orders (e.g. beans) are 14 days apart and are NOT duplicates.
// True billing duplicates land within a week. Use a strict <7 day window.
const DUPLICATE_WINDOW_DAYS = 7;

type Frontmatter = Record<string, string | number | string[]>;
type Doc = { path: string; slug: string; frontmatter: Frontmatter; body: string };

function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
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
    let value = m[2]!.trim();
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

function ym(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(ymStr: string): string {
  return new Date(`${ymStr}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function usd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const originals = await readDocs(ORIGINALS);
const companies = await readDocs(COMPANIES);

const invoices = originals.filter((d) => d.frontmatter.type === "invoice");
const bankStatements = originals.filter((d) => d.frontmatter.type === "bank-statement");

// ---- Anomaly #1: month-over-month price hike per vendor ----------------------
type VendorMonthTotal = { vendor: string; month: string; total: number };
const totals = new Map<string, number>();
for (const inv of invoices) {
  const vendor = String(inv.frontmatter.vendor ?? "");
  const date = String(inv.frontmatter.date ?? "");
  const amount = Number(inv.frontmatter.amount ?? 0);
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

type PriceHike = {
  vendor: string;
  prevMonth: string;
  curMonth: string;
  prevTotal: number;
  curTotal: number;
  pctChange: number;
  dollarDelta: number;
};
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

// ---- Anomaly #2: duplicate vendor charges on bank statements -----------------
type BankDebit = { vendor: string; date: string; amount: number; sourceSlug: string };
const debits: BankDebit[] = [];
for (const stmt of bankStatements) {
  for (const line of stmt.body.split("\n")) {
    const m = line.match(/^-\s+(\d{4}-\d{2}-\d{2}):\s+\$([0-9,]+\.\d{2})\s+debit\s+—.*\[\[([a-z0-9-]+)\]\]/);
    if (!m) continue;
    debits.push({
      date: m[1]!,
      amount: Number(m[2]!.replaceAll(",", "")),
      vendor: m[3]!,
      sourceSlug: stmt.slug,
    });
  }
}

type Duplicate = {
  vendor: string;
  amount: number;
  dates: string[];
  sourceSlug: string;
};
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

// ---- Anomaly #3: ghost subscriptions -----------------------------------------
type Ghost = {
  vendor: string;
  monthlyTotal: number;
  lastEvent: string;
  ageDays: number;
  monthsActive: number;
};
const ghosts: Ghost[] = [];
const debitsByVendor = new Map<string, BankDebit[]>();
for (const d of debits) {
  const arr = debitsByVendor.get(d.vendor) ?? [];
  arr.push(d);
  debitsByVendor.set(d.vendor, arr);
}

for (const company of companies) {
  const slug = String(company.frontmatter.slug ?? company.slug);
  const vendorDebits = debitsByVendor.get(slug) ?? [];
  if (vendorDebits.length === 0) continue;

  const months = new Set(vendorDebits.map((d) => ym(d.date)));
  if (months.size < 2) continue;
  const monthlyTotal =
    vendorDebits
      .filter((d) => ym(d.date) === Array.from(months).sort().at(-1))
      .reduce((a, d) => a + d.amount, 0);

  const dateLines = [...company.body.matchAll(/^-\s+(\d{4}-\d{2}-\d{2}):/gm)].map((m) => m[1]!);
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

// ---- Determine "last month" for the summary --------------------------------
const allMonths = Array.from(new Set([...totals.keys()].map((k) => k.split("|")[1]!))).sort();
const lastMonth = allMonths.at(-1) ?? "2026-03";

const lastMonthHikes = priceHikes.filter((h) => h.curMonth === lastMonth);
const lastMonthDuplicates = duplicates.filter((d) => d.dates.some((x) => ym(x) === lastMonth));

// ---- Write concept pages ---------------------------------------------------
await mkdir(CONCEPTS, { recursive: true });

const summaryBullets: string[] = [];
for (const h of lastMonthHikes) {
  summaryBullets.push(
    `- ${h.curMonth}-01: [[${h.vendor}]] invoices jumped from $${usd(h.prevTotal)} in ${monthLabel(h.prevMonth)} to $${usd(h.curTotal)} in ${monthLabel(h.curMonth)} — a +${h.pctChange.toFixed(1)}% increase ($${usd(h.dollarDelta)} more this month)`,
  );
}
for (const d of lastMonthDuplicates) {
  summaryBullets.push(
    `- ${d.dates[0]}: [[${d.vendor}]] charged $${usd(d.amount)} twice in ${monthLabel(ym(d.dates[0]!))} (on ${d.dates.join(" and ")}); only one charge was expected — see [[${d.sourceSlug}]]`,
  );
}
for (const g of ghosts) {
  summaryBullets.push(
    `- ${lastMonth}-31: [[${g.vendor}]] billed $${usd(g.monthlyTotal)} this month and has been billing for ${g.monthsActive}+ months, but the last meaningful vendor activity on [[${g.vendor}]] was ${g.lastEvent} (${g.ageDays} days ago) — likely a forgotten recurring subscription`,
  );
}

const summaryPlain = [
  `In ${monthLabel(lastMonth)}, three anomalies were detected in [[mara-okafor]]'s books:`,
  ...lastMonthHikes.map(
    (h) =>
      `(1) a +${h.pctChange.toFixed(1)}% price hike from [[${h.vendor}]] — spend rose from $${usd(h.prevTotal)} to $${usd(h.curTotal)}`,
  ),
  ...lastMonthDuplicates.map(
    (d) =>
      `(2) a duplicate $${usd(d.amount)} charge from [[${d.vendor}]] on ${d.dates.join(" and ")}`,
  ),
  ...ghosts.map(
    (g) =>
      `(3) a ghost recurring charge from [[${g.vendor}]] at $${usd(g.monthlyTotal)}/mo with no vendor activity in ${g.ageDays} days`,
  ),
].join(" ");

const summary = `---
type: concept
title: ${monthLabel(lastMonth)} Anomaly Summary
slug: ${lastMonth}-anomaly-summary
date: ${lastMonth}-31
tags: [anomaly, summary, ${lastMonth}, weird]
---

Compiled truth: This page enumerates everything weird, unusual, or unexpected detected in [[mara-okafor]]'s books for ${monthLabel(lastMonth)} (also known as "last month"). ${summaryPlain}

---

${summaryBullets.join("\n")}
- ${lastMonth}-31: Detection method — month-over-month invoice totals per vendor (price-hike rule, threshold +${PRICE_HIKE_THRESHOLD_PCT}%); bank-statement debit deduplication within a ${DUPLICATE_WINDOW_DAYS}-day window; recurring-charge audit against [[companies]] last-event timestamps (ghost threshold ${GHOST_THRESHOLD_DAYS} days).
`;

const recurringBullets: string[] = [];
for (const [vendor, vendorDebits] of debitsByVendor) {
  const months = Array.from(new Set(vendorDebits.map((d) => ym(d.date))));
  if (months.length < 2) continue;
  const recent = months.sort().at(-1)!;
  const recentTotal = vendorDebits
    .filter((d) => ym(d.date) === recent)
    .reduce((a, d) => a + d.amount, 0);

  const company = companies.find((c) => (c.frontmatter.slug ?? c.slug) === vendor);
  const eventDates = company
    ? [...company.body.matchAll(/^-\s+(\d{4}-\d{2}-\d{2}):/gm)].map((m) => m[1]!)
    : [];
  const lastEvent = eventDates.sort().at(-1) ?? "(no events on company page)";
  const ageDays = company
    ? Math.round((DEMO_TODAY.getTime() - Date.parse(lastEvent)) / 86_400_000)
    : -1;
  const tag = ageDays >= GHOST_THRESHOLD_DAYS ? " ⚠ GHOST" : "";

  recurringBullets.push(
    `- ${recent}-31: [[${vendor}]] — $${usd(recentTotal)} in ${monthLabel(recent)}, active across ${months.length} months; last meaningful vendor event ${lastEvent} (${ageDays} days ago)${tag}`,
  );
}

const recurringPage = `---
type: concept
title: Recurring Charges Audit
slug: recurring-charges
date: ${lastMonth}-31
tags: [recurring, subscriptions, audit, saas]
---

Compiled truth: Every vendor that debited [[mara-okafor]]'s operating account in two or more distinct months, with the most recent monthly total and the age of the last meaningful vendor event on the company timeline. Vendors flagged ⚠ GHOST have no vendor activity in the last ${GHOST_THRESHOLD_DAYS} days — candidates for cancellation.

---

${recurringBullets.join("\n")}
- ${lastMonth}-31: Audit generated by scripts/detect-anomalies.ts; ghost threshold ${GHOST_THRESHOLD_DAYS} days
`;

await writeFile(resolve(CONCEPTS, `march-anomaly-summary.md`), summary, "utf8");
await writeFile(resolve(CONCEPTS, `recurring-charges.md`), recurringPage, "utf8");

console.log(`Detected:`);
console.log(`  ${priceHikes.length} price hikes (${lastMonthHikes.length} in ${lastMonth})`);
console.log(`  ${duplicates.length} duplicate charges (${lastMonthDuplicates.length} in ${lastMonth})`);
console.log(`  ${ghosts.length} ghost subscriptions`);
console.log(`Wrote ${CONCEPTS}/march-anomaly-summary.md`);
console.log(`Wrote ${CONCEPTS}/recurring-charges.md`);

if (lastMonthHikes.length === 0 || lastMonthDuplicates.length === 0 || ghosts.length === 0) {
  console.error(`\nERROR: expected all 3 anomaly classes to be detected for ${lastMonth}`);
  process.exit(2);
}
