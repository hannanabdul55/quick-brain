/**
 * Unit tests for the in-process query() and think() paths in lib/gbrain/client.ts
 * (INPROC-02, INPROC-04).
 *
 * All gbrain I/O is mocked — no DB connections, no Anthropic API calls.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock engine layer ────────────────────────────────────────────────────────
vi.mock("../../../lib/gbrain/engine.ts", () => ({
  createGBrainEngine: vi.fn().mockResolvedValue({ kind: "postgres" }),
  queryInProcess: vi.fn(),
}));

// ── Mock runThink shim ───────────────────────────────────────────────────────
vi.mock("@/types/gbrain", async (importOriginal) => {
  // Preserve non-think exports (not used in these tests but keep module coherent)
  const original = await importOriginal<typeof import("@/types/gbrain")>();
  return {
    ...original,
    runThink: vi.fn(),
  };
});

import { query, think } from "../../../lib/gbrain/client.ts";
import { queryInProcess } from "../../../lib/gbrain/engine.ts";
import { runThink } from "@/types/gbrain";

const mockQueryInProcess = vi.mocked(queryInProcess);
const mockRunThink = vi.mocked(runThink);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSearchResult(slug: string, score: number, chunk_text = "sample text") {
  return {
    slug,
    page_id: 1,
    title: slug,
    type: "page",
    chunk_text,
    chunk_source: "compiled_truth" as const,
    chunk_id: 1,
    chunk_index: 0,
    score,
    stale: false,
  };
}

function makeThinkResult(answer: string, warnings: string[] = []) {
  return {
    question: "test question",
    answer,
    citations: [],
    gaps: [],
    pagesGathered: 3,
    takesGathered: 0,
    graphHits: 0,
    modelUsed: "haiku",
    rounds: 1,
    warnings,
    diagnostics: {
      pagesFromHybrid: 3,
      takesFromKeyword: 0,
      takesFromVector: 0,
      graphHits: 0,
    },
  };
}

// ── Tests: query() ───────────────────────────────────────────────────────────

describe("query() — in-process", () => {
  it("Test 1: calls queryInProcess and returns formatted string", async () => {
    mockQueryInProcess.mockResolvedValueOnce([
      makeSearchResult("invoices/march", 0.9231, "March coffee supplies invoice"),
      makeSearchResult("vendors/bean-co", 0.8100, "Bean Co vendor record"),
    ]);

    const result = await query("seed", "what invoices do we have?");

    expect(mockQueryInProcess).toHaveBeenCalledWith("seed", "what invoices do we have?", {
      noExpand: false,
    });
    expect(result).toContain("0.9231");
    expect(result).toContain("invoices/march");
    expect(result).toContain("March coffee supplies invoice");
    expect(result).toContain("vendors/bean-co");
  });

  it("Test 2: passes noExpand: true when specified", async () => {
    mockQueryInProcess.mockResolvedValueOnce([makeSearchResult("test/slug", 0.5)]);

    await query("seed", "warm-up query", { noExpand: true });

    expect(mockQueryInProcess).toHaveBeenCalledWith("seed", "warm-up query", {
      noExpand: true,
    });
  });

  it("returns 'No results.' when queryInProcess returns empty array", async () => {
    mockQueryInProcess.mockResolvedValueOnce([]);

    const result = await query("seed", "something obscure");

    expect(result).toBe("No results.\n");
  });
});

// ── Tests: think() ───────────────────────────────────────────────────────────

describe("think() — in-process", () => {
  it("Test 3: calls runThink with question + model and returns GBrainResult code 0", async () => {
    mockRunThink.mockResolvedValueOnce(makeThinkResult("March saw unusual spend on espresso beans."));

    const result = await think("seed", "what was weird about March?", { model: "haiku" });

    expect(mockRunThink).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "postgres" }),
      expect.objectContaining({ question: "what was weird about March?", model: "haiku" }),
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("March saw unusual spend on espresso beans.");
    expect(result.stderr).toBe("");
  });

  it("Test 4: when runThink throws, returns GBrainResult code 1 with error in stderr", async () => {
    mockRunThink.mockRejectedValueOnce(new Error("Anthropic API timeout"));

    const result = await think("seed", "what happened?");

    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Anthropic API timeout");
  });

  it("Test 5: when runThink returns partial output (degraded — no ANTHROPIC_API_KEY), returns code 0 with partial answer", async () => {
    // Simulate gbrain degrading gracefully: returns gather-only partial answer with a warning.
    // result.answer goes to stdout; result.warnings go to stderr.
    const partialAnswer = "I found 3 pages but could not synthesize (LLM unavailable).";
    const warning = "ANTHROPIC_KEY_MISSING: synthesis skipped";
    mockRunThink.mockResolvedValueOnce(makeThinkResult(partialAnswer, [warning]));

    const result = await think("seed", "summarize March", { model: "haiku" });

    // think() does NOT throw — returns code 0 with whatever answer gbrain provides.
    expect(result.code).toBe(0);
    // stdout = the partial answer text (not the warning)
    expect(result.stdout).toBe(partialAnswer);
    // stderr = warnings joined (informational, not fatal)
    expect(result.stderr).toContain("ANTHROPIC_KEY_MISSING");
  });

  it("uses haiku as default model when no model opt is provided", async () => {
    mockRunThink.mockResolvedValueOnce(makeThinkResult("answer text"));

    await think("seed", "test question");

    expect(mockRunThink).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: "haiku" }),
    );
  });
});
