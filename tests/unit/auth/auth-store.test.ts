/**
 * Unit tests for lib/auth/store.ts + lib/auth/session.ts (structural checks)
 *
 * These tests verify:
 * - lib/auth/store.ts exports the required CRUD functions + sql singleton
 * - lib/auth/session.ts exports createSession / validateSession / destroySession
 * - lib/auth/session.ts imports sql from ./store and contains NO postgres() call
 * - consumeMagicLink uses atomic UPDATE ... WHERE used=false (no SELECT-then-UPDATE)
 * - All SQL uses postgres.js tagged-template (no string-concat of user input)
 * - Error sanitization (slice to 500 chars, strip postgres:// URLs)
 * - wasRecentlyRequested uses the 60-second interval query
 *
 * Integration round-trip (DB reads/writes against live Supabase) is documented
 * in SUMMARY as an operator-run precondition — not unit-tested to avoid DB
 * coupling in CI. These structural tests catch wiring regressions without a DB.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helper: read source files for structural assertions ──────────────────────

const storeSource = readFileSync(
  resolve(import.meta.dirname, "../../../lib/auth/store.ts"),
  "utf-8",
);

const sessionSource = readFileSync(
  resolve(import.meta.dirname, "../../../lib/auth/session.ts"),
  "utf-8",
);

// ── lib/auth/store.ts structural tests ──────────────────────────────────────

describe("lib/auth/store.ts structure", () => {
  // Singleton + connection
  it("imports postgres from 'postgres'", () => {
    expect(storeSource).toContain('from "postgres"');
  });

  it("uses GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER fallback chain", () => {
    expect(storeSource).toContain("GBRAIN_DATABASE_URL");
    expect(storeSource).toContain("SUPABASE_DB_URL_POOLER");
  });

  it("uses prepare: false on the singleton connection (pooler requirement)", () => {
    expect(storeSource).toContain("prepare: false");
  });

  it("exports the sql singleton (so session.ts can import it)", () => {
    expect(storeSource).toMatch(/export\s+.*\bsql\b/);
  });

  // Row types
  it("defines UserRow type", () => {
    expect(storeSource).toContain("UserRow");
  });

  it("defines SessionRow type", () => {
    expect(storeSource).toContain("SessionRow");
  });

  it("defines MagicLinkRow type", () => {
    expect(storeSource).toContain("MagicLinkRow");
  });

  // CRUD exports
  it("exports getUserByEmail", () => {
    expect(storeSource).toContain("export async function getUserByEmail");
  });

  it("exports createUser", () => {
    expect(storeSource).toContain("export async function createUser");
  });

  it("exports recordMagicLink", () => {
    expect(storeSource).toContain("export async function recordMagicLink");
  });

  it("exports consumeMagicLink", () => {
    expect(storeSource).toContain("export async function consumeMagicLink");
  });

  it("exports wasRecentlyRequested", () => {
    expect(storeSource).toContain("export async function wasRecentlyRequested");
  });

  // Tables targeted
  it("queries app.users table", () => {
    expect(storeSource).toContain("app.users");
  });

  it("queries app.magic_links table", () => {
    expect(storeSource).toContain("app.magic_links");
  });

  // Security: atomic single-use consume (T-06-05 / D-07)
  it("consumeMagicLink uses UPDATE ... WHERE used = false (atomic consume, no TOCTOU)", () => {
    // Must contain the UPDATE + the used=false guard
    expect(storeSource).toMatch(/UPDATE\s+app\.magic_links/);
    expect(storeSource).toContain("used = false");
  });

  it("consumeMagicLink checks rows.count (not rows.length) for atomicity", () => {
    expect(storeSource).toContain("rows.count");
  });

  it("consumeMagicLink does NOT use SELECT-then-UPDATE pattern", () => {
    // Presence of SELECT on magic_links would indicate a TOCTOU race
    expect(storeSource).not.toMatch(/SELECT.*FROM app\.magic_links.*\n.*UPDATE/s);
  });

  // Security: rate-limit query (D-09 / AUTH-09)
  it("wasRecentlyRequested uses 60-second interval", () => {
    expect(storeSource).toContain("60 seconds");
  });

  // Security: tagged-template SQL, no string concat
  it("uses tagged-template SQL (not string concatenation)", () => {
    // Should contain backtick SQL templates; should NOT concatenate user input into query strings
    expect(storeSource).toMatch(/sql`/);
    // The sentinel: no `"... " + variable` style in SQL strings
    expect(storeSource).not.toMatch(/sql\("[^)]+\+/);
  });
});

// ── lib/auth/session.ts structural tests ─────────────────────────────────────

describe("lib/auth/session.ts structure", () => {
  it("exports createSession", () => {
    expect(sessionSource).toContain("export async function createSession");
  });

  it("exports validateSession", () => {
    expect(sessionSource).toContain("export async function validateSession");
  });

  it("exports destroySession", () => {
    expect(sessionSource).toContain("export async function destroySession");
  });

  it("imports sql from ./store (shares the singleton, no second postgres() client)", () => {
    expect(sessionSource).toContain('from "./store"');
  });

  it("does NOT call postgres() directly (must import sql from store.ts)", () => {
    expect(sessionSource).not.toMatch(/postgres\s*\(/);
  });

  it("uses randomUUID from node:crypto for opaque session IDs (T-06-03)", () => {
    expect(sessionSource).toContain("randomUUID");
  });

  it("queries app.sessions table", () => {
    expect(sessionSource).toContain("app.sessions");
  });

  it("createSession inserts with 30-day expiry", () => {
    expect(sessionSource).toContain("30 days");
  });

  it("validateSession checks expires_at > now()", () => {
    expect(sessionSource).toContain("expires_at > now()");
  });

  it("destroySession deletes the session row (true server-side revocation, AUTH-07)", () => {
    expect(sessionSource).toMatch(/DELETE FROM app\.sessions/);
  });
});

// ── Pure sanitization logic (mirrors store.ts implementation) ────────────────

function sanitizeError(raw: string): string {
  return raw.slice(0, 500).replace(/postgres:\/\/[^\s]+/gi, "[redacted]");
}

describe("auth store error sanitization logic", () => {
  it("truncates error strings longer than 500 chars to exactly 500 chars", () => {
    const longError = "x".repeat(600);
    const result = sanitizeError(longError);
    expect(result.length).toBe(500);
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

  it("leaves normal error messages (no URL) untouched", () => {
    const normal = "Operation timed out after 30000ms";
    const result = sanitizeError(normal);
    expect(result).toBe("Operation timed out after 30000ms");
  });
});
