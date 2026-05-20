/**
 * Unit tests for lib/audit/anomaly-detector.ts
 *
 * All fixtures are in-memory — no filesystem access to brains/ or API keys.
 * Tests cover all 4 anomaly detector functions + pure helpers.
 */

import { describe, it, expect } from "vitest";
import {
  detectPriceHikes,
  detectDuplicates,
  detectGhosts,
  detectMissingInvoices,
  parseFrontmatter,
  parseDebits,
  ym,
  usd,
  severityFor,
  DEMO_TODAY,
  GHOST_THRESHOLD_DAYS,
  PRICE_HIKE_THRESHOLD_PCT,
  DUPLICATE_WINDOW_DAYS,
  type Doc,
  type BankDebit,
} from "../../../lib/audit/anomaly-detector.ts";

// ---- Fixture helpers --------------------------------------------------------

function makeInvoice(vendor: string, date: string, amount: number, slug?: string): Doc {
  return {
    path: `/fixtures/${slug ?? vendor}-${date}.md`,
    slug: slug ?? `invoice-${vendor}-${date}`,
    frontmatter: { type: "invoice", vendor, date, amount },
    body: "",
  };
}

function makeDebit(vendor: string, date: string, amount: number): BankDebit {
  return { vendor, date, amount, sourceSlug: `bank-statement-${date.slice(0, 7)}` };
}

function makeCompany(slug: string, body: string): Doc {
  return {
    path: `/fixtures/companies/${slug}.md`,
    slug,
    frontmatter: { type: "company", slug },
    body,
  };
}

// ---- Constants sanity -------------------------------------------------------

describe("constants", () => {
  it("DEMO_TODAY is 2026-04-05", () => {
    expect(DEMO_TODAY.toISOString().startsWith("2026-04-05")).toBe(true);
  });

  it("GHOST_THRESHOLD_DAYS is 90", () => {
    expect(GHOST_THRESHOLD_DAYS).toBe(90);
  });

  it("PRICE_HIKE_THRESHOLD_PCT is 20", () => {
    expect(PRICE_HIKE_THRESHOLD_PCT).toBe(20);
  });

  it("DUPLICATE_WINDOW_DAYS is 7", () => {
    expect(DUPLICATE_WINDOW_DAYS).toBe(7);
  });
});

// ---- Pure helpers -----------------------------------------------------------

describe("ym", () => {
  it('returns "YYYY-MM" from a full date string', () => {
    expect(ym("2026-03-15")).toBe("2026-03");
  });

  it("returns first 7 chars regardless of day", () => {
    expect(ym("2026-01-01")).toBe("2026-01");
    expect(ym("2026-12-31")).toBe("2026-12");
  });
});

describe("usd", () => {
  it("formats 12.5 as 12.50 (no dollar sign)", () => {
    expect(usd(12.5)).toBe("12.50");
  });

  it("formats 1000 with comma separator", () => {
    expect(usd(1000)).toBe("1,000.00");
  });

  it("formats 0 as 0.00", () => {
    expect(usd(0)).toBe("0.00");
  });
});

describe("severityFor", () => {
  it("returns high when dollarImpact > 100", () => {
    expect(severityFor(150, "price-hike")).toBe("high");
  });

  it("returns medium when dollarImpact is between 30 and 100 inclusive", () => {
    expect(severityFor(50, "duplicate")).toBe("medium");
    expect(severityFor(30, "duplicate")).toBe("medium");
    expect(severityFor(100, "duplicate")).toBe("medium");
  });

  it("returns low when dollarImpact < 30 and not ghost or missing", () => {
    expect(severityFor(20, "price-hike")).toBe("low");
    expect(severityFor(0, "duplicate")).toBe("low");
  });

  it("returns high for ghost-saas regardless of dollar impact", () => {
    expect(severityFor(20, "ghost-saas")).toBe("high");
    expect(severityFor(5, "ghost-saas")).toBe("high");
  });

  it("returns high for missing-invoice regardless of dollar impact", () => {
    expect(severityFor(20, "missing-invoice")).toBe("high");
    expect(severityFor(0, "missing-invoice")).toBe("high");
  });
});

// ---- parseFrontmatter (audit) -----------------------------------------------

describe("parseFrontmatter (audit)", () => {
  it("parses frontmatter and body correctly", () => {
    const raw = "---\ntype: invoice\namount: 123.45\n---\nbody text here";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter["type"]).toBe("invoice");
    expect(frontmatter["amount"]).toBe(123.45);
    expect(body).toBe("body text here");
  });

  it("returns empty frontmatter and original text when no frontmatter block", () => {
    const raw = "no frontmatter at all";
    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter).toEqual({});
    expect(body).toBe("no frontmatter at all");
  });

  it("parses array fields correctly", () => {
    const raw = "---\ntags: [anomaly, summary]\n---\n";
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter["tags"]).toEqual(["anomaly", "summary"]);
  });
});

// ---- detectPriceHikes -------------------------------------------------------

describe("detectPriceHikes", () => {
  it("detects a price hike above threshold (30% > 20%)", () => {
    const invoices: Doc[] = [
      makeInvoice("beanstalk-roasters", "2026-01-15", 100),
      makeInvoice("beanstalk-roasters", "2026-02-15", 130), // +30%
    ];
    const result = detectPriceHikes(invoices);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("beanstalk-roasters");
    expect(result[0]!.pctChange).toBeCloseTo(30, 1);
    expect(result[0]!.dollarDelta).toBeCloseTo(30, 2);
    expect(result[0]!.prevMonth).toBe("2026-01");
    expect(result[0]!.curMonth).toBe("2026-02");
  });

  it("does not trigger for 20% hike (exactly at threshold — should trigger)", () => {
    // PRICE_HIKE_THRESHOLD_PCT = 20, condition is >= 20, so exactly 20% triggers
    const invoices: Doc[] = [
      makeInvoice("vendor-a", "2026-01-15", 100),
      makeInvoice("vendor-a", "2026-02-15", 120), // +20% exactly
    ];
    const result = detectPriceHikes(invoices);
    expect(result).toHaveLength(1); // 20% is at threshold (>=), so it fires
    expect(result[0]!.pctChange).toBeCloseTo(20, 1);
  });

  it("does not trigger for hike under threshold (10% < 20%)", () => {
    const invoices: Doc[] = [
      makeInvoice("vendor-b", "2026-01-15", 100),
      makeInvoice("vendor-b", "2026-02-15", 110), // +10%
    ];
    const result = detectPriceHikes(invoices);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(detectPriceHikes([])).toHaveLength(0);
  });

  it("aggregates multiple invoices from same vendor same month", () => {
    const invoices: Doc[] = [
      makeInvoice("vendor-c", "2026-01-10", 50),
      makeInvoice("vendor-c", "2026-01-20", 50), // Jan total = 100
      makeInvoice("vendor-c", "2026-02-15", 130), // Feb total = 130, +30%
    ];
    const result = detectPriceHikes(invoices);
    expect(result).toHaveLength(1);
    expect(result[0]!.prevTotal).toBe(100);
    expect(result[0]!.curTotal).toBe(130);
  });
});

// ---- detectDuplicates -------------------------------------------------------

describe("detectDuplicates", () => {
  it("detects duplicate when same vendor, same amount, within 7-day window", () => {
    const debits: BankDebit[] = [
      makeDebit("square-pos", "2026-03-01", 50),
      makeDebit("square-pos", "2026-03-05", 50), // 4 days apart — within window
    ];
    const result = detectDuplicates(debits);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("square-pos");
    expect(result[0]!.amount).toBe(50);
  });

  it("does not flag when same vendor same amount but outside 7-day window", () => {
    const debits: BankDebit[] = [
      makeDebit("square-pos", "2026-03-01", 50),
      makeDebit("square-pos", "2026-03-09", 50), // 8 days apart — outside window
    ];
    const result = detectDuplicates(debits);
    expect(result).toHaveLength(0);
  });

  it("does not flag when different vendors even if same amount and date", () => {
    const debits: BankDebit[] = [
      makeDebit("vendor-a", "2026-03-01", 50),
      makeDebit("vendor-b", "2026-03-01", 50), // Same amount, same day, different vendor
    ];
    const result = detectDuplicates(debits);
    expect(result).toHaveLength(0);
  });

  it("does not flag when same vendor same day (0 days apart — excluded by days < 1)", () => {
    const debits: BankDebit[] = [
      makeDebit("vendor-a", "2026-03-01", 50),
      makeDebit("vendor-a", "2026-03-01", 50), // Same day — 0 days apart, excluded
    ];
    const result = detectDuplicates(debits);
    expect(result).toHaveLength(0);
  });

  it("does not flag when same vendor and date but different amounts", () => {
    const debits: BankDebit[] = [
      makeDebit("vendor-a", "2026-03-01", 50),
      makeDebit("vendor-a", "2026-03-02", 75),
    ];
    const result = detectDuplicates(debits);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty or single-entry input", () => {
    expect(detectDuplicates([])).toHaveLength(0);
    expect(detectDuplicates([makeDebit("vendor-a", "2026-03-01", 50)])).toHaveLength(0);
  });
});

// ---- detectGhosts -----------------------------------------------------------

describe("detectGhosts", () => {
  it("flags a ghost when company has events but last event is >= 90 days before DEMO_TODAY and has 2+ debit months", () => {
    // DEMO_TODAY = 2026-04-05. 90 days before = ~2026-01-05
    // Last event on 2025-12-01 (125 days before DEMO_TODAY) => ghost
    const companyBody =
      "- 2025-12-01: Invoice received\n- 2025-11-01: Contract signed\n";
    const company = makeCompany("acme-saas", companyBody);

    const debits: BankDebit[] = [
      makeDebit("acme-saas", "2026-02-15", 29.99),
      makeDebit("acme-saas", "2026-03-15", 29.99), // 2 distinct months
    ];

    const result = detectGhosts([company], debits);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("acme-saas");
    expect(result[0]!.ageDays).toBeGreaterThanOrEqual(90);
    expect(result[0]!.monthsActive).toBe(2);
  });

  it("does not flag when company has a recent event (within 90 days)", () => {
    // DEMO_TODAY = 2026-04-05. Within 90 days means after 2026-01-05
    const companyBody = "- 2026-03-01: Recent renewal meeting\n";
    const company = makeCompany("active-vendor", companyBody);

    const debits: BankDebit[] = [
      makeDebit("active-vendor", "2026-02-15", 49.99),
      makeDebit("active-vendor", "2026-03-15", 49.99),
    ];

    const result = detectGhosts([company], debits);
    expect(result).toHaveLength(0);
  });

  it("does not flag when fewer than 2 debit months (one-off charge)", () => {
    const companyBody = "- 2025-12-01: Old event\n";
    const company = makeCompany("one-time-vendor", companyBody);

    // Only 1 debit month — not recurring
    const debits: BankDebit[] = [makeDebit("one-time-vendor", "2026-03-15", 99.99)];

    const result = detectGhosts([company], debits);
    expect(result).toHaveLength(0);
  });

  it("does not flag when company has no body events (body is empty)", () => {
    // If dateLines.length === 0, the function continues (skips) per source line 258
    const company = makeCompany("no-events-vendor", "");
    const debits: BankDebit[] = [
      makeDebit("no-events-vendor", "2026-02-15", 29.99),
      makeDebit("no-events-vendor", "2026-03-15", 29.99),
    ];
    const result = detectGhosts([company], debits);
    expect(result).toHaveLength(0);
  });
});

// ---- detectMissingInvoices --------------------------------------------------

describe("detectMissingInvoices", () => {
  it("flags a missing invoice when debit has no matching invoice for vendor+month", () => {
    const invoices: Doc[] = [
      makeInvoice("beanstalk-roasters", "2026-03-15", 500), // different vendor
    ];
    const debits: BankDebit[] = [
      makeDebit("seven-shifts", "2026-03-10", 250), // no invoice for seven-shifts in 2026-03
    ];

    const result = detectMissingInvoices(invoices, debits);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("seven-shifts");
    expect(result[0]!.month).toBe("2026-03");
    expect(result[0]!.amount).toBe(250);
  });

  it("does not flag when a matching invoice exists for the same vendor and month", () => {
    const invoices: Doc[] = [
      makeInvoice("seven-shifts", "2026-03-01", 250), // matching invoice
    ];
    const debits: BankDebit[] = [makeDebit("seven-shifts", "2026-03-10", 250)];

    const result = detectMissingInvoices(invoices, debits);
    expect(result).toHaveLength(0);
  });

  it("deduplicates — only one missing entry per unique (vendor, month)", () => {
    const invoices: Doc[] = [];
    const debits: BankDebit[] = [
      makeDebit("vendor-x", "2026-03-01", 50),
      makeDebit("vendor-x", "2026-03-15", 50), // same vendor, same month — should be 1 entry
    ];

    const result = detectMissingInvoices(invoices, debits);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("vendor-x");
  });

  it("returns empty for empty inputs", () => {
    expect(detectMissingInvoices([], [])).toHaveLength(0);
  });
});

// ---- parseDebits ------------------------------------------------------------

describe("parseDebits", () => {
  it("parses bank statement body into BankDebit records", () => {
    const body = "- 2026-03-15: $50.00 debit — Square POS [[companies/square-pos]]\n";
    const doc: Doc = {
      path: "/fixtures/bank-statement.md",
      slug: "bank-statement-2026-03",
      frontmatter: { type: "bank-statement" },
      body,
    };
    const result = parseDebits([doc]);
    expect(result).toHaveLength(1);
    expect(result[0]!.vendor).toBe("square-pos");
    expect(result[0]!.amount).toBe(50.0);
    expect(result[0]!.date).toBe("2026-03-15");
    expect(result[0]!.sourceSlug).toBe("bank-statement-2026-03");
  });

  it("returns empty array when body has no debit lines", () => {
    const doc: Doc = {
      path: "/fixtures/bank-statement.md",
      slug: "bank-statement-2026-03",
      frontmatter: { type: "bank-statement" },
      body: "no debit lines here\njust some text",
    };
    expect(parseDebits([doc])).toHaveLength(0);
  });

  it("handles path-prefixed wikilinks [[companies/slug]]", () => {
    const body = "- 2026-03-10: $1,200.00 debit — Vendor [[companies/some-vendor]]\n";
    const doc: Doc = {
      path: "/fixtures/bank.md",
      slug: "bank",
      frontmatter: {},
      body,
    };
    const result = parseDebits([doc]);
    expect(result[0]!.amount).toBe(1200.0);
    expect(result[0]!.vendor).toBe("some-vendor");
  });
});
