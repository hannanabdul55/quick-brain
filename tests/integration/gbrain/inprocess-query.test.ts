/**
 * INPROC-06 — in-process query integration + regression guard.
 *
 * Validates Spike 006 Gotcha 1: bare hybridSearch returned 1 result while the
 * CLI returned 21. queryInProcess wires expandQuery as expandFn so the
 * in-process path matches the CLI's result-count range. This suite is the
 * regression guard for that parity.
 *
 * Skip condition: SUPABASE_DB_URL_POOLER + OPENAI_API_KEY + RUN_INTEGRATION
 * must all be set (live DB + embeddings required). CI never sets these, so the
 * live block skips cleanly. The disconnectEngine unit test always runs.
 *
 * Run: set -a && . .env.local && set +a && RUN_INTEGRATION=1 bun run test
 */

import { describe, it, expect, afterAll } from "vitest";
import { queryInProcess, disconnectEngine } from "../../../lib/gbrain/engine.ts";

const hasSupabase = !!process.env.SUPABASE_DB_URL_POOLER;
const hasOpenAI = !!process.env.OPENAI_API_KEY;
const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
const runIntegration = !!process.env.RUN_INTEGRATION;

describe("queryInProcess — in-process hybrid search", () => {
  describe.skipIf(!hasSupabase || !hasOpenAI || !runIntegration)(
    "live Supabase integration",
    () => {
      afterAll(async () => {
        await disconnectEngine("seed").catch(() => {});
      });

      it(
        "returns >=10 results with expansion (INPROC-03)",
        async () => {
          const results = await queryInProcess(
            "seed",
            "what was weird about last month?",
          );
          console.log(
            `[inprocess-query] expansion query -> ${results.length} results; ` +
              `top slug: ${results[0]?.slug ?? "(none)"}`,
          );
          if (hasAnthropic) {
            // Full expansion pipeline: should match the CLI's ~21 results.
            // Threshold is half the Spike 006 baseline to absorb model variance.
            expect(results.length).toBeGreaterThanOrEqual(10);
          } else {
            // Degraded (no expansion): at least 1 hit from vector search alone.
            expect(results.length).toBeGreaterThanOrEqual(1);
          }
          expect(results[0]?.slug).toBeTruthy();
        },
        30_000,
      );

      it(
        "returns >=1 result with noExpand:true (INPROC-02 basic retrieval)",
        async () => {
          const results = await queryInProcess(
            "seed",
            "what was weird about last month?",
            { noExpand: true },
          );
          console.log(
            `[inprocess-query] noExpand query -> ${results.length} results`,
          );
          expect(results.length).toBeGreaterThanOrEqual(1);
        },
        30_000,
      );

      it(
        "vendor query returns relevant pages (INPROC-03 topic relevance)",
        async () => {
          const results = await queryInProcess(
            "seed",
            "top vendors by total spend",
          );
          console.log(
            "[inprocess-query] vendor query slugs:",
            results.slice(0, 5).map((r) => r.slug),
          );
          expect(results.length).toBeGreaterThanOrEqual(1);
          expect(results[0]?.score).toBeGreaterThan(0);
        },
        30_000,
      );
    },
  );
});

describe("disconnectEngine — unit", () => {
  it("resolves without throwing when engine not connected", async () => {
    await expect(
      disconnectEngine("nonexistent-tenant"),
    ).resolves.toBeUndefined();
  });
});
