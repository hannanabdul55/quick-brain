/**
 * Unit tests for lib/insights/frontmatter.ts
 *
 * Tests parseFrontmatter and coerceValue (exported after plan 01-02 adds export).
 * All tests are pure string-in / value-out — no filesystem I/O.
 */

import { describe, it, expect } from "vitest";
import { parseFrontmatter, coerceValue } from "../../../lib/insights/frontmatter.ts";

// ---- coerceValue ------------------------------------------------------------

describe("coerceValue", () => {
  it('coerces "123" to number 123', () => {
    expect(coerceValue("123")).toBe(123);
  });

  it('coerces "99.5" to number 99.5', () => {
    expect(coerceValue("99.5")).toBe(99.5);
  });

  it('coerces "0" to number 0', () => {
    expect(coerceValue("0")).toBe(0);
  });

  it('coerces "true" to boolean true', () => {
    expect(coerceValue("true")).toBe(true);
  });

  it('coerces "false" to boolean false', () => {
    expect(coerceValue("false")).toBe(false);
  });

  it("coerces array string [a, b] to array", () => {
    const result = coerceValue("[anomaly, summary]");
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(["anomaly", "summary"]);
  });

  it("coerces empty array [] to empty array", () => {
    const result = coerceValue("[]");
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[]).length).toBe(0);
  });

  it('coerces plain string "invoice" to "invoice"', () => {
    expect(coerceValue("invoice")).toBe("invoice");
  });

  it("coerces empty string to empty string", () => {
    expect(coerceValue("")).toBe("");
  });

  it("coerces a vendor slug string as-is", () => {
    expect(coerceValue("beanstalk-roasters")).toBe("beanstalk-roasters");
  });

  it("coerces a negative number string", () => {
    expect(coerceValue("-42")).toBe(-42);
  });
});

// ---- parseFrontmatter (lib/insights/frontmatter.ts) -------------------------

describe("parseFrontmatter (insights)", () => {
  it("parses a minimal invoice frontmatter block", () => {
    const text = "---\ntype: invoice\namount: 99.5\n---\nbody text";
    const result = parseFrontmatter(text);
    expect(result["type"]).toBe("invoice");
    expect(result["amount"]).toBe(99.5);
  });

  it("returns {} for text with no frontmatter block", () => {
    const result = parseFrontmatter("no frontmatter");
    expect(result).toEqual({});
  });

  it("returns {} for text starting without ---", () => {
    const result = parseFrontmatter("body\n---\nstill no frontmatter");
    expect(result).toEqual({});
  });

  it("returns {} for text with unclosed frontmatter block", () => {
    const result = parseFrontmatter("---\ntype: invoice\nno closing");
    expect(result).toEqual({});
  });

  it("parses boolean fields correctly", () => {
    const text = "---\nactive: true\narchived: false\n---\n";
    const result = parseFrontmatter(text);
    expect(result["active"]).toBe(true);
    expect(result["archived"]).toBe(false);
  });

  it("parses array tags field", () => {
    const text = "---\ntags: [anomaly, summary, 2026-03, weird]\n---\n";
    const result = parseFrontmatter(text);
    expect(result["tags"]).toEqual(["anomaly", "summary", "2026-03", "weird"]);
  });

  it("parses a full invoice frontmatter with all fields", () => {
    const text = `---
type: invoice
vendor: Beanstalk Roasters
date: 2026-03-15
amount: 1830.00
currency: USD
---

Invoice body text.
`;
    const result = parseFrontmatter(text);
    expect(result["type"]).toBe("invoice");
    expect(result["vendor"]).toBe("Beanstalk Roasters");
    expect(result["date"]).toBe("2026-03-15");
    expect(result["amount"]).toBe(1830.0);
    expect(result["currency"]).toBe("USD");
  });

  it("ignores lines that do not match key: value pattern", () => {
    const text = "---\ntype: invoice\n  badly indented\n---\n";
    const result = parseFrontmatter(text);
    expect(result["type"]).toBe("invoice");
    // The badly indented line has no key (doesn't start with word char) — ignored
    expect(Object.keys(result)).toHaveLength(1);
  });
});
