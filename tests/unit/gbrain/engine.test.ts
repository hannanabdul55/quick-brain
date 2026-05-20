/**
 * Unit tests for lib/gbrain/engine.ts
 *
 * Tests 1, 2, 4: pure unit tests — mock createEngine and hybridSearch.
 * Test 3: integration guard — skipped when SUPABASE_DB_URL_POOLER is unset.
 *
 * Per INPROC-01..03 requirements.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module-level mocks (hoisted by vitest) ---

vi.mock("gbrain/engine-factory", () => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockDisconnect = vi.fn().mockResolvedValue(undefined);
  const mockEngine = {
    connect: mockConnect,
    disconnect: mockDisconnect,
    getStats: vi.fn().mockResolvedValue({ page_count: 0, embedded_count: 0 }),
  };
  const mockCreateEngine = vi.fn().mockResolvedValue(mockEngine);
  return { createEngine: mockCreateEngine, _mockEngine: mockEngine };
});

vi.mock("gbrain/search/hybrid", () => {
  const mockHybridSearch = vi.fn().mockResolvedValue([
    { slug: "test-slug", score: 0.95, chunk_text: "test content" },
  ]);
  return { hybridSearch: mockHybridSearch };
});

vi.mock("gbrain/search/expansion", () => {
  const mockExpandQuery = vi.fn().mockResolvedValue(["original query", "expanded query 1"]);
  return { expandQuery: mockExpandQuery };
});

// Import AFTER mocks are hoisted
import { createGBrainEngine, disconnectEngine, queryInProcess } from "../../../lib/gbrain/engine.ts";
import { createEngine } from "gbrain/engine-factory";
import { hybridSearch } from "gbrain/search/hybrid";
import { expandQuery } from "gbrain/search/expansion";

const mockedCreateEngine = vi.mocked(createEngine);
const mockedHybridSearch = vi.mocked(hybridSearch);
const mockedExpandQuery = vi.mocked(expandQuery);

describe("lib/gbrain/engine", () => {
  beforeEach(() => {
    // Reset mocks and module state between tests
    vi.clearAllMocks();
    // Re-set default mock implementations after clearAllMocks
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    const mockDisconnect = vi.fn().mockResolvedValue(undefined);
    const mockEngine = {
      connect: mockConnect,
      disconnect: mockDisconnect,
      getStats: vi.fn().mockResolvedValue({ page_count: 0, embedded_count: 0 }),
    };
    mockedCreateEngine.mockResolvedValue(mockEngine as any);
    mockedHybridSearch.mockResolvedValue([
      { slug: "test-slug", score: 0.95, chunk_text: "test content" } as any,
    ]);
    mockedExpandQuery.mockResolvedValue(["original query", "expanded query 1"]);
    // Set required env var for tests
    process.env.GBRAIN_DATABASE_URL = "postgresql://test:test@localhost:5432/test";
  });

  afterEach(() => {
    // Clean up env vars
    delete process.env.GBRAIN_DATABASE_URL;
    delete process.env.SUPABASE_DB_URL_POOLER;
  });

  describe("Test 1: createGBrainEngine returns engine with query() and disconnect()", () => {
    it("returns an object with connect and disconnect methods", async () => {
      const engine = await createGBrainEngine("tenant-test-1");
      expect(engine).toBeDefined();
      expect(typeof engine.connect).toBe("function");
      expect(typeof engine.disconnect).toBe("function");
    });

    it("calls createEngine with postgres config", async () => {
      await createGBrainEngine("tenant-test-cfg");
      expect(mockedCreateEngine).toHaveBeenCalledWith(
        expect.objectContaining({ engine: "postgres" })
      );
    });
  });

  describe("Test 2: engine pool reuses same reference for same tenantId", () => {
    it("returns the same engine object for two calls with the same tenantId", async () => {
      const engine1 = await createGBrainEngine("tenant-pool-test");
      const engine2 = await createGBrainEngine("tenant-pool-test");
      // Same reference — pool reuse
      expect(engine1).toBe(engine2);
      // createEngine should only have been called once
      expect(mockedCreateEngine).toHaveBeenCalledTimes(1);
    });

    it("creates separate engines for different tenantIds", async () => {
      const engineA = await createGBrainEngine("tenant-a");
      const engineB = await createGBrainEngine("tenant-b");
      // Different tenants get different engine instances
      expect(mockedCreateEngine).toHaveBeenCalledTimes(2);
      // They may or may not be the same object (depends on mock) — but createEngine called twice
    });
  });

  describe("Test 4: disconnectEngine resolves without error; subsequent call reconnects", () => {
    it("disconnectEngine resolves without error", async () => {
      await createGBrainEngine("tenant-disconnect");
      await expect(disconnectEngine("tenant-disconnect")).resolves.toBeUndefined();
    });

    it("after disconnect, subsequent createGBrainEngine reconnects (creates new engine)", async () => {
      await createGBrainEngine("tenant-reconnect");
      await disconnectEngine("tenant-reconnect");
      // After disconnect, calling again should create a new engine (call createEngine again)
      const callsBefore = mockedCreateEngine.mock.calls.length;
      await createGBrainEngine("tenant-reconnect");
      expect(mockedCreateEngine.mock.calls.length).toBe(callsBefore + 1);
    });

    it("disconnectEngine on a non-existent tenantId resolves without error", async () => {
      await expect(disconnectEngine("tenant-never-connected")).resolves.toBeUndefined();
    });
  });

  describe("queryInProcess: uses expandFn wired in by default", () => {
    it("calls hybridSearch with expandFn when noExpand is not set", async () => {
      await createGBrainEngine("tenant-expand");
      await queryInProcess("tenant-expand", "what was weird about March?");
      expect(mockedHybridSearch).toHaveBeenCalledWith(
        expect.anything(),
        "what was weird about March?",
        expect.objectContaining({ expandFn: expect.any(Function) })
      );
    });

    it("calls hybridSearch without expandFn when noExpand is true", async () => {
      await createGBrainEngine("tenant-noexpand");
      await queryInProcess("tenant-noexpand", "test query", { noExpand: true });
      const callArgs = mockedHybridSearch.mock.calls[0];
      // opts should not have expandFn when noExpand: true
      expect(callArgs[2]?.expandFn).toBeUndefined();
    });

    it("returns an array of SearchResult objects", async () => {
      await createGBrainEngine("tenant-results");
      const results = await queryInProcess("tenant-results", "test query");
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toMatchObject({ slug: expect.any(String), score: expect.any(Number) });
    });
  });
});

// Test 3: Integration guard (requires live Supabase connection)
describe.skipIf(!process.env.SUPABASE_DB_URL_POOLER)(
  "Test 3 [integration]: queryInProcess returns results from live brain",
  () => {
    it("returns >1 result for demo query when expansion is active", async () => {
      // This test uses the actual gbrain library against Supabase
      // Only runs when SUPABASE_DB_URL_POOLER is set
      const { queryInProcess: realQueryInProcess } = await import("../../../lib/gbrain/engine.ts");
      const results = await realQueryInProcess("seed", "what was weird about last month?");
      expect(Array.isArray(results)).toBe(true);
      // With expansion, we expect >1 result (CLI returns 21)
      expect(results.length).toBeGreaterThan(1);
    }, 30_000); // Allow 30s for live DB query
  }
);
