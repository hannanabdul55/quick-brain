#!/usr/bin/env bun
// Emits the templated portion of the Mara's Coffee synthetic dataset
// (invoices, bank statements, monthly closes) into data/maras-coffee/originals/.
//
// The handcrafted files (companies/*, people/*, the two anomaly-anchoring
// vendor emails) are committed separately. This generator is idempotent —
// running it again overwrites the same files.
//
// Planted anomalies (intentionally encoded in the data, not the generator
// itself, so they survive regeneration):
//   1. Beanstalk price hike: $750 -> $915 per bag (+22%) starting Mar 1, 2026
//   2. Square duplicate charge: $79 on both Mar 4 AND Mar 11
//   3. Ghost 7shifts SaaS: $43/mo recurring, last meaningful event Nov 2025
//
// Run:  bun scripts/generate-fixtures.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const ORIGINALS = resolve(REPO_ROOT, "data", "maras-coffee", "originals");

mkdirSync(ORIGINALS, { recursive: true });

type Invoice = {
  vendor: string;
  date: string;
  amount: number;
  invoiceNum: string;
  sku: string;
  description: string;
  category: string;
};

const BEAN_PRICE_PRE = 750;
const BEAN_PRICE_POST = 915;
const beanPriceFor = (yyyymm: string) => (yyyymm >= "2026-03" ? BEAN_PRICE_POST : BEAN_PRICE_PRE);

const invoices: Invoice[] = [];

for (const month of ["2026-01", "2026-02", "2026-03"]) {
  const price = beanPriceFor(month);
  for (const [day, suffix] of [
    ["04", "A"],
    ["18", "B"],
  ] as const) {
    invoices.push({
      vendor: "beanstalk-roasters",
      date: `${month}-${day}`,
      amount: price,
      invoiceNum: `BR-${month}-${suffix}`,
      sku: "25LB-WB-MED",
      description: "25 lb whole bean medium roast (Mara's standard SKU)",
      category: "COGS — beans",
    });
  }
}

for (const month of ["2026-01", "2026-02", "2026-03"]) {
  invoices.push({
    vendor: "square-pos",
    date: `${month}-04`,
    amount: 79.0,
    invoiceNum: `SQ-${month}-SUB`,
    sku: "POS-PLUS",
    description: "Square POS Plus subscription, monthly",
    category: "Opex — POS",
  });
  const transMap: Record<string, { day: string; amount: number }> = {
    "2026-01": { day: "31", amount: 1240.5 },
    "2026-02": { day: "28", amount: 1180.2 },
    "2026-03": { day: "31", amount: 1390.75 },
  };
  const t = transMap[month]!;
  invoices.push({
    vendor: "square-pos",
    date: `${month}-${t.day}`,
    amount: t.amount,
    invoiceNum: `SQ-${month}-FEES`,
    sku: "POS-FEES",
    description: "Monthly card-processing fee summary, 2.6% + $0.10/swipe",
    category: "Opex — payments",
  });
}

for (const month of ["2026-01", "2026-02", "2026-03"]) {
  invoices.push({
    vendor: "seven-shifts",
    date: `${month}-12`,
    amount: 29.0,
    invoiceNum: `7S-${month}-SUB`,
    sku: "SCHED-BASIC",
    description: "7shifts scheduling subscription, monthly",
    category: "Opex — SaaS",
  });
  invoices.push({
    vendor: "seven-shifts",
    date: `${month}-12`,
    amount: 14.0,
    invoiceNum: `7S-${month}-USER`,
    sku: "SCHED-USER",
    description: "7shifts single-user add-on, monthly",
    category: "Opex — SaaS",
  });
}

for (const month of ["2026-01", "2026-02", "2026-03"]) {
  const day = month === "2026-01" ? "03" : month === "2026-02" ? "02" : "02";
  invoices.push({
    vendor: "landlord-llc",
    date: `${month}-${day}`,
    amount: 4200.0,
    invoiceNum: `RENT-${month}`,
    sku: "LEASE-BASE",
    description: "Base monthly rent for 412 3rd Street",
    category: "Opex — rent",
  });
  invoices.push({
    vendor: "landlord-llc",
    date: `${month}-${day}`,
    amount: 350.0,
    invoiceNum: `CAM-${month}`,
    sku: "LEASE-CAM",
    description: "Common Area Maintenance (CAM), monthly",
    category: "Opex — rent",
  });
}

const pgeMap: Record<string, { electric: number; gas: number }> = {
  "2026-01": { electric: 612.4, gas: 192.1 },
  "2026-02": { electric: 605.2, gas: 188.4 },
  "2026-03": { electric: 618.9, gas: 176.3 },
};
for (const month of ["2026-01", "2026-02", "2026-03"]) {
  const m = pgeMap[month]!;
  invoices.push({
    vendor: "pge-utility",
    date: `${month}-12`,
    amount: m.electric,
    invoiceNum: `PGE-${month}-E`,
    sku: "UTIL-ELEC",
    description: "Electric service, monthly",
    category: "Opex — utilities",
  });
  invoices.push({
    vendor: "pge-utility",
    date: `${month}-12`,
    amount: m.gas,
    invoiceNum: `PGE-${month}-G`,
    sku: "UTIL-GAS",
    description: "Natural gas service, monthly",
    category: "Opex — utilities",
  });
}

const usd = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fileFor(inv: Invoice): string {
  return resolve(ORIGINALS, `invoice-${inv.vendor}-${inv.invoiceNum.toLowerCase()}.md`);
}

for (const inv of invoices) {
  const body = `---
type: invoice
title: Invoice ${inv.invoiceNum} — ${inv.vendor}
date: ${inv.date}
vendor: ${inv.vendor}
amount: ${inv.amount.toFixed(2)}
sku: ${inv.sku}
category: ${inv.category.replaceAll(":", " -")}
tags: [invoice, ${inv.vendor}]
---

Compiled truth: Invoice ${inv.invoiceNum} from [[companies/${inv.vendor}]] dated ${inv.date} for $${usd(inv.amount)}. Line item: ${inv.description}. Category: ${inv.category}. Paid from the operating account; see [[bank-statement-${inv.date.slice(0, 7)}]] for the reconciling debit.

---

- ${inv.date}: Invoice ${inv.invoiceNum} from [[companies/${inv.vendor}]] for $${usd(inv.amount)} (${inv.description})
- ${inv.date}: Auto-imported by QuickBrain
`;
  writeFileSync(fileFor(inv), body, "utf8");
}

type StatementLine = { day: string; amount: number; memo: string };

function statementForMonth(month: string): { date: string; debits: StatementLine[]; credits: StatementLine[] } {
  const debits: StatementLine[] = [];
  const credits: StatementLine[] = [];

  for (const inv of invoices.filter((i) => i.date.startsWith(month))) {
    debits.push({
      day: inv.date.slice(-2),
      amount: inv.amount,
      memo: `${inv.description} — [[companies/${inv.vendor}]]`,
    });
  }

  if (month === "2026-03") {
    debits.push({
      day: "11",
      amount: 79.0,
      memo: `Square POS Plus subscription — [[companies/square-pos]] (DUPLICATE of 2026-03-04 charge)`,
    });
  }

  const revenueMap: Record<string, number[]> = {
    "2026-01": [4820, 5210, 4990, 5340, 5110],
    "2026-02": [4710, 4880, 5020, 5180, 4960],
    "2026-03": [5410, 5630, 5820, 5240, 5380],
  };
  const weekly = revenueMap[month] ?? [];
  weekly.forEach((amt, i) => {
    const d = String(6 + i * 6).padStart(2, "0");
    credits.push({
      day: d,
      amount: amt,
      memo: `Weekly card-batch deposit — [[companies/square-pos]]`,
    });
  });

  debits.sort((a, b) => a.day.localeCompare(b.day));
  credits.sort((a, b) => a.day.localeCompare(b.day));

  return { date: `${month}-31`, debits, credits };
}

for (const month of ["2026-01", "2026-02", "2026-03"]) {
  const s = statementForMonth(month);
  const totalDebits = s.debits.reduce((a, l) => a + l.amount, 0);
  const totalCredits = s.credits.reduce((a, l) => a + l.amount, 0);

  const debitLines = s.debits
    .map((l) => `- ${month}-${l.day}: $${usd(l.amount)} debit — ${l.memo}`)
    .join("\n");
  const creditLines = s.credits
    .map((l) => `- ${month}-${l.day}: $${usd(l.amount)} credit — ${l.memo}`)
    .join("\n");

  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // gbrain derives slug from the file path; do NOT set `slug:` in frontmatter
  // (mismatch with the path-derived slug causes the page to be skipped on import).
  const body = `---
type: bank-statement
title: Bank Statement — ${monthName}
date: ${month}-${s.debits.at(-1)?.day ?? "28"}
account: Main Operating
tags: [bank, statement, ${month}]
---

Compiled truth: Operating-account statement for ${monthName}. ${s.debits.length} debits totaling $${usd(totalDebits)} and ${s.credits.length} credits totaling $${usd(totalCredits)}. Vendors paid: [[companies/beanstalk-roasters]], [[companies/square-pos]], [[companies/seven-shifts]], [[companies/landlord-llc]], [[companies/pge-utility]]. Source of revenue: card-batch deposits from [[companies/square-pos]].

---

${debitLines}
${creditLines}
`;
  writeFileSync(resolve(ORIGINALS, `bank-statement-${month}.md`), body, "utf8");
}

function closeForMonth(month: string) {
  const ms = invoices.filter((i) => i.date.startsWith(month));
  const cogs = ms.filter((i) => i.category.includes("COGS")).reduce((a, i) => a + i.amount, 0);
  const opex = ms.filter((i) => i.category.includes("Opex")).reduce((a, i) => a + i.amount, 0);

  const revenueMap: Record<string, number> = {
    "2026-01": 25470,
    "2026-02": 24750,
    "2026-03": 27480,
  };
  const revenue = revenueMap[month] ?? 0;
  const net = revenue - cogs - opex;

  const dupNote =
    month === "2026-03"
      ? "\n- 2026-03-31: Note — operating account shows TWO [[companies/square-pos]] subscription debits in March ($79 on 2026-03-04 and $79 on 2026-03-11). Only one should have been charged."
      : "";

  const beanNote =
    month === "2026-03"
      ? "\n- 2026-03-31: Note — [[companies/beanstalk-roasters]] invoices in March total $1,830.00, up from $1,500.00 in February (+22%) due to the 2026-02-22 price-update notice"
      : "";

  const ghostNote = `\n- ${month}-31: Note — [[companies/seven-shifts]] continues to bill ($43.00/month combined) with no recent product usage by [[people/mara-okafor]]`;

  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  const body = `---
type: monthly-close
title: Monthly Close — ${monthName}
date: ${month}-31
month: ${month}
tags: [close, ledger, ${month}]
---

Compiled truth: Monthly close for ${monthName} for [[people/mara-okafor]] / Mara's Coffee. Revenue $${usd(revenue)} (card-batch deposits via [[companies/square-pos]]). COGS $${usd(cogs)} (beans from [[companies/beanstalk-roasters]]). Operating expenses $${usd(opex)} ([[companies/square-pos]] subscription + fees, [[companies/seven-shifts]] SaaS, [[companies/landlord-llc]] rent + CAM, [[companies/pge-utility]] electric + gas). Net $${usd(net)}.

---

- ${month}-31: Month-end close for ${monthName}
- ${month}-31: Revenue $${usd(revenue)}
- ${month}-31: COGS $${usd(cogs)} ([[companies/beanstalk-roasters]])
- ${month}-31: Opex $${usd(opex)} ([[companies/square-pos]] + [[companies/seven-shifts]] + [[companies/landlord-llc]] + [[companies/pge-utility]])
- ${month}-31: Net $${usd(net)}${beanNote}${dupNote}${ghostNote}
`;
  writeFileSync(resolve(ORIGINALS, `monthly-close-${month}.md`), body, "utf8");
}

for (const month of ["2026-01", "2026-02", "2026-03"]) {
  closeForMonth(month);
}

console.log(
  `Wrote ${invoices.length} invoices + 3 bank statements + 3 monthly closes to ${ORIGINALS}`,
);
