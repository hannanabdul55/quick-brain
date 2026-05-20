// Opt-in integration test. Run with: RUN_INTEGRATION=1 bun run test tests/integration/gbrain/
// CI never sets RUN_INTEGRATION — this file is excluded from the default bun run test.
import { describe, it, expect } from "vitest";
import { query, SEED_TENANT_ID } from "../../../lib/gbrain/index.ts";

describe.skipIf(!process.env.RUN_INTEGRATION)("concurrent gbrain query smoke", () => {
  it("Q1: what was weird about last month", { timeout: 30000 }, async () => {
    const result = await query(SEED_TENANT_ID, "What was weird about last month?");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("Q2: top vendors", { timeout: 30000 }, async () => {
    const result = await query(SEED_TENANT_ID, "Who are my top 5 vendors and how much did I pay each?");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("Q3: unnecessary recurring", { timeout: 30000 }, async () => {
    const result = await query(SEED_TENANT_ID, "What am I paying for every month that I shouldn't be?");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });
});
