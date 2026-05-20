import { describe, it, expect } from "vitest";
import { withTenantLock, pendingTenants } from "../../../lib/gbrain/mutex.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("withTenantLock", { timeout: 5000 }, () => {
  it("serializes same-tenant concurrent calls", async () => {
    const start = Date.now();
    const starts: number[] = [];

    await Promise.all(
      [1, 2, 3].map(() =>
        withTenantLock("seed1", async () => {
          starts.push(Date.now() - start);
          await sleep(300);
        }),
      ),
    );

    expect(starts.length).toBe(3);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(250);
    expect(starts[2]! - starts[1]!).toBeGreaterThanOrEqual(250);
  });

  it("runs different tenants in parallel", async () => {
    const start = Date.now();
    const finishes: Array<{ tenant: string; ms: number }> = [];

    await Promise.all(
      ["alpha2", "beta2", "gamma2"].map((tenant) =>
        withTenantLock(tenant, async () => {
          await sleep(300);
          finishes.push({ tenant, ms: Date.now() - start });
        }),
      ),
    );

    const maxMs = Math.max(...finishes.map((f) => f.ms));
    expect(finishes.length).toBe(3);
    // All 3 parallel 300ms tasks should finish in < 600ms total
    expect(maxMs).toBeLessThan(600);
  });

  it("next task runs after a rejected task", async () => {
    const swallow = () => {};
    process.on("unhandledRejection", swallow);

    let secondRan = false;

    await withTenantLock("delta2", async () => {
      throw new Error("intentional reject");
    }).catch(swallow);

    await withTenantLock("delta2", async () => {
      secondRan = true;
    });

    process.off("unhandledRejection", swallow);

    expect(secondRan).toBe(true);
  });

  it("queue is empty after tenant drains", async () => {
    await withTenantLock("epsilon2", async () => {
      await sleep(50);
    });

    // Allow finally() callback to settle
    await sleep(10);

    const pending = pendingTenants();
    expect(pending).not.toContain("epsilon2");
  });
});
