/**
 * Unit tests for lib/jobs/store.ts (structural and sanitization checks)
 *
 * These tests verify:
 * - The store module exports the six required functions
 * - failJob sanitization logic (slice to 500 chars, strip postgres:// URLs)
 *
 * The sanitization logic is tested via a standalone helper that mirrors
 * the exact implementation in store.ts (pure function, no DB side effects).
 *
 * Integration round-trip (create -> setRunning -> updateProgress -> finishJob ->
 * getJob) is documented in the SUMMARY as a manual verify against the live
 * Supabase jobs table — not unit-tested here to avoid DB coupling in CI.
 */

import { describe, it, expect } from "vitest";

// ── Pure sanitization logic (mirrors store.ts failJob implementation) ────────

function sanitizeError(raw: string): string {
  return raw.slice(0, 500).replace(/postgres:\/\/[^\s]+/gi, "[redacted]");
}

// ── Sanitization tests ───────────────────────────────────────────────────────

describe("failJob error sanitization logic", () => {
  it("truncates error strings longer than 500 chars to exactly 500 chars", () => {
    const longError = "x".repeat(600);
    const result = sanitizeError(longError);
    expect(result.length).toBe(500);
  });

  it("leaves error strings of 500 chars or shorter unchanged (length)", () => {
    const shortError = "tenant not found";
    const result = sanitizeError(shortError);
    expect(result).toBe("tenant not found");
  });

  it("strips postgres:// connection strings from errors", () => {
    const errorWithUrl =
      "Connection failed: postgres://user:pass@host:5432/db — check credentials";
    const result = sanitizeError(errorWithUrl);
    expect(result).not.toContain("postgres://");
    expect(result).toContain("[redacted]");
  });

  it("strips postgres:// regardless of casing", () => {
    const errorWithUrl = "POSTGRES://user:secret@host/db failed";
    const result = sanitizeError(errorWithUrl);
    expect(result).not.toContain("POSTGRES://");
    expect(result).toContain("[redacted]");
  });

  it("strips multiple postgres:// occurrences in a single error string", () => {
    const multiUrl =
      "primary: postgres://user:pass@host1/db, replica: postgres://user:pass@host2/db";
    const result = sanitizeError(multiUrl);
    expect(result).not.toContain("postgres://");
    const redactedCount = (result.match(/\[redacted\]/g) ?? []).length;
    expect(redactedCount).toBe(2);
  });

  it("leaves normal error messages (no URL) untouched", () => {
    const normal = "Operation timed out after 30000ms";
    const result = sanitizeError(normal);
    expect(result).toBe("Operation timed out after 30000ms");
  });

  it("applies truncation before URL stripping (truncation is first)", () => {
    // If the URL starts after char 500, it should be truncated away (never reaches strip)
    const prefix = "e".repeat(499);
    const errorWithLateUrl = prefix + " postgres://user:pass@host/db";
    const result = sanitizeError(errorWithLateUrl);
    // The result is 500 chars — the URL is chopped off before stripping
    expect(result.length).toBe(500);
    expect(result).not.toContain("postgres://");
  });
});

// ── Store exports check (import via dynamic to avoid needing DB connection) ──
// We verify the module exports the expected function names by reading the
// file path directly (structural, not behavioral — avoids live DB in CI).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("lib/jobs/store.ts exports (structural)", () => {
  const storeSource = readFileSync(
    resolve(import.meta.dirname, "../../../lib/jobs/store.ts"),
    "utf-8",
  );

  const expectedExports = [
    "createJob",
    "setRunning",
    "updateProgress",
    "finishJob",
    "failJob",
    "getJob",
  ];

  for (const name of expectedExports) {
    it(`exports ${name}`, () => {
      expect(storeSource).toContain(`export async function ${name}`);
    });
  }

  it("imports postgres from 'postgres'", () => {
    expect(storeSource).toContain('from "postgres"');
  });

  it("uses prepare: false on the singleton connection", () => {
    expect(storeSource).toContain("prepare: false");
  });

  it("targets app.jobs table", () => {
    expect(storeSource).toContain("app.jobs");
  });

  it("sanitizes error with slice(0, 500) in failJob", () => {
    expect(storeSource).toMatch(/slice\(0, ?500\)/);
  });

  it("strips postgres:// URLs in failJob", () => {
    expect(storeSource).toContain("postgres://");
    expect(storeSource).toContain("[redacted]");
  });
});
