/**
 * Test 3 (INPROC-03): queryInProcess returns >1 result from live brain
 *
 * Originally in tests/unit/gbrain/engine.test.ts, moved here because:
 * - The unit file uses vi.mock("gbrain/search/hybrid", ...) which intercepts all
 *   dynamic imports including those inside engine.ts's @/types/gbrain shim. This
 *   means the unit file cannot test the REAL hybridSearch path.
 * - This file is in the gbrain-integration vitest project (no vi.mocks), so all
 *   gbrain submodule imports resolve to the real library.
 *
 * Skip condition: SUPABASE_DB_URL_POOLER must be set (live DB required).
 * Also gates on RUN_INTEGRATION so CI never runs this without creds.
 *
 * Run: RUN_INTEGRATION=1 bun run test
 * (or: set -a && . .env.local && set +a && RUN_INTEGRATION=1 bun run test)
 */

import { describe, it, expect } from "vitest";

describe.skipIf(!process.env.SUPABASE_DB_URL_POOLER || !process.env.RUN_INTEGRATION)(
  "Test 3 [integration]: queryInProcess returns results from live brain (INPROC-03)",
  () => {
    it("returns >1 result for demo query when expansion is active", async () => {
      // Import after describe.skipIf so we only load gbrain when creds are present.
      // No vi.mocks in this file — all imports go to the real gbrain library.
      const { queryInProcess } = await import("../../../lib/gbrain/engine.ts");
      const results = await queryInProcess("seed", "what was weird about last month?");
      expect(Array.isArray(results)).toBe(true);
      // With expansion, we expect >1 result (CLI returns 21 for this query).
      // Passing this confirms gatewayIsAvailable('expansion') is true in-process.
      expect(results.length).toBeGreaterThan(1);
    }, 30_000); // Allow 30s for live DB query + LLM expansion call
  }
);
