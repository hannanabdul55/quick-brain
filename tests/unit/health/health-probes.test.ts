/**
 * Unit tests for lib/health/probes.ts
 *
 * Tests all seven behaviors:
 * 1. withTimeout resolves successfully when promise resolves before timeout
 * 2. withTimeout rejects with "timed out" message when promise hangs
 * 3. timed returns { ok: true, latencyMs: <number> } on successful fn
 * 4. timed returns { ok: false, latencyMs: <number>, detail: <string> } on throw
 * 5. probeStorage with mocked createStorage whose exists resolves returns ok: true
 * 6. probeStorage with mocked exists that throws returns ok: false and detail without URL
 * 7. probeGbrainDb with neither env var set returns ok: false with detail naming missing keys
 *
 * All tests are CI-safe — no real network connections.
 * Per DEPLOY-03 requirements.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module-level mocks (hoisted by vitest) ---

// Mock postgres (porsager) — the DB probe imports it directly
vi.mock("postgres", () => {
  const mockSql = vi.fn(async () => [{ "?column?": 1 }]) as any;
  // sql.end is called in finally to close the connection
  mockSql.end = vi.fn(async () => undefined);
  // Make it behave like a tagged-template function too
  const factory = vi.fn(() => mockSql);
  return { default: factory };
});

// Mock @/lib/storage — the storage probe uses createStorage()
vi.mock("@/lib/storage", () => {
  const mockExists = vi.fn().mockResolvedValue(true);
  const mockStore = { exists: mockExists };
  const mockCreateStorage = vi.fn(() => mockStore);
  return { createStorage: mockCreateStorage };
});

// Import AFTER mocks are hoisted
import { withTimeout, timed, probeGbrainDb, probeStorage } from "../../../lib/health/probes.ts";
import { createStorage } from "@/lib/storage";
import postgres from "postgres";

const mockedCreateStorage = vi.mocked(createStorage);
const mockedPostgres = vi.mocked(postgres);

describe("lib/health/probes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish default mock implementations after clearAllMocks
    const mockSqlCall = vi.fn(async () => [{ "?column?": 1 }]) as any;
    mockSqlCall.end = vi.fn(async () => undefined);
    mockedPostgres.mockReturnValue(mockSqlCall);

    const mockExists = vi.fn().mockResolvedValue(true);
    const mockStore = { exists: mockExists };
    mockedCreateStorage.mockReturnValue(mockStore as any);

    // Set env vars for DB probe tests — cleared in afterEach
    process.env.GBRAIN_DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  });

  afterEach(() => {
    delete process.env.GBRAIN_DATABASE_URL;
    delete process.env.SUPABASE_DB_URL_POOLER;
  });

  // ── Test 1: withTimeout resolves when promise resolves before timeout ────────
  describe("withTimeout", () => {
    it("resolves to the promise value when it resolves before timeout", async () => {
      const result = await withTimeout(Promise.resolve("x"), 1000);
      expect(result).toBe("x");
    });

    // ── Test 2: withTimeout rejects with "timed out" when promise hangs ────────
    it("rejects with an Error containing 'timed out' when the promise never settles", async () => {
      const hangingPromise = new Promise<never>(() => {/* never resolves */});
      await expect(withTimeout(hangingPromise, 20)).rejects.toMatchObject({
        message: expect.stringContaining("timed out"),
      });
    });
  });

  // ── Test 3: timed returns { ok: true, latencyMs } on successful fn ──────────
  describe("timed", () => {
    it("returns { ok: true, latencyMs: <number> } when fn resolves", async () => {
      const probe = await timed(async () => { /* no-op success */ });
      expect(probe.ok).toBe(true);
      expect(typeof probe.latencyMs).toBe("number");
      expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    });

    // ── Test 4: timed returns { ok: false, latencyMs, detail } when fn throws ──
    it("returns { ok: false, latencyMs: <number>, detail: <string> } when fn throws", async () => {
      const probe = await timed(async () => { throw new Error("something broke"); });
      expect(probe.ok).toBe(false);
      expect(typeof probe.latencyMs).toBe("number");
      expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof probe.detail).toBe("string");
      expect(probe.detail).toContain("something broke");
    });
  });

  // ── Test 5 & 6: probeStorage ─────────────────────────────────────────────────
  describe("probeStorage", () => {
    // Test 5: probeStorage with mocked createStorage whose exists resolves → ok: true
    it("resolves successfully when createStorage().exists() returns true", async () => {
      const mockStore = { exists: vi.fn().mockResolvedValue(true) };
      mockedCreateStorage.mockReturnValue(mockStore as any);

      await expect(probeStorage()).resolves.toBeUndefined();
    });

    it("resolves successfully when createStorage().exists() returns false (file absent is fine)", async () => {
      const mockStore = { exists: vi.fn().mockResolvedValue(false) };
      mockedCreateStorage.mockReturnValue(mockStore as any);

      await expect(probeStorage()).resolves.toBeUndefined();
    });

    // Test 6: probeStorage with mocked exists that throws → ok: false, detail without URL
    it("throws when exists() throws, and timed() captures a detail string without 'http' or any URL", async () => {
      const mockStore = {
        exists: vi.fn().mockRejectedValue(new Error("Connection refused")),
      };
      mockedCreateStorage.mockReturnValue(mockStore as any);

      // probeStorage throws — timed() catches this and returns ok: false
      const probe = await timed(probeStorage);
      expect(probe.ok).toBe(false);
      expect(typeof probe.detail).toBe("string");
      // The detail must NOT contain a URL or 'http'
      expect(probe.detail).not.toMatch(/https?:\/\//);
    });
  });

  // ── Test 7: probeGbrainDb returns ok: false when no env var is set ──────────
  describe("probeGbrainDb", () => {
    it("throws naming the missing env keys when neither GBRAIN_DATABASE_URL nor SUPABASE_DB_URL_POOLER is set", async () => {
      // Remove both env vars for this test
      delete process.env.GBRAIN_DATABASE_URL;
      delete process.env.SUPABASE_DB_URL_POOLER;

      // probeGbrainDb should throw — when wrapped in timed() it returns ok: false
      const probe = await timed(probeGbrainDb);
      expect(probe.ok).toBe(false);
      expect(typeof probe.detail).toBe("string");
      // The detail must name the missing env keys but NOT echo any value
      expect(probe.detail).toMatch(/GBRAIN_DATABASE_URL|SUPABASE_DB_URL_POOLER/);
    });

    it("resolves when GBRAIN_DATABASE_URL is set (mocked postgres)", async () => {
      // GBRAIN_DATABASE_URL is set in beforeEach
      const mockSqlCall = vi.fn(async () => [{ "?column?": 1 }]) as any;
      mockSqlCall.end = vi.fn(async () => undefined);
      mockedPostgres.mockReturnValue(mockSqlCall);

      await expect(probeGbrainDb()).resolves.toBeUndefined();
    });

    it("resolves using SUPABASE_DB_URL_POOLER as fallback (mocked postgres)", async () => {
      delete process.env.GBRAIN_DATABASE_URL;
      process.env.SUPABASE_DB_URL_POOLER = "postgresql://fallback:pass@host:5432/db";

      const mockSqlCall = vi.fn(async () => [{ "?column?": 1 }]) as any;
      mockSqlCall.end = vi.fn(async () => undefined);
      mockedPostgres.mockReturnValue(mockSqlCall);

      await expect(probeGbrainDb()).resolves.toBeUndefined();
    });
  });
});
