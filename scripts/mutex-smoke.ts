#!/usr/bin/env bun
// Phase 1 success criterion #5 — proves the in-process per-tenant mutex
// serializes concurrent work without involving gbrain (which requires
// ANTHROPIC_API_KEY to complete a `query` call). This isolates the HARN-04
// behavior we care about: same-tenant work serializes; different-tenant
// work runs in parallel.
//
// Run:  bun scripts/mutex-smoke.ts
//
// Companion: scripts/concurrent-smoke.ts is the canonical end-to-end
// gbrain-query smoke gate (DATA-10); it will pass once ANTHROPIC_API_KEY
// is set. This script is the LLM-free proof that the mutex itself works.

import { withTenantLock, pendingTenants } from "../lib/gbrain/mutex.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failed = 0;

// Test 1: same-tenant work serializes
{
  const start = Date.now();
  const starts: number[] = [];
  await Promise.all(
    [1, 2, 3].map(() =>
      withTenantLock("seed", async () => {
        starts.push(Date.now() - start);
        await sleep(300);
      }),
    ),
  );
  const ok =
    starts.length === 3 &&
    starts[1]! - starts[0]! >= 250 &&
    starts[2]! - starts[1]! >= 250;
  console.log(`[mutex] same-tenant serialization: ${ok ? "PASS" : "FAIL"} (starts at ms ${starts.join(", ")})`);
  if (!ok) failed++;
}

// Test 2: different tenants run in parallel (mutex is keyed per tenant)
{
  const start = Date.now();
  const finishes: Array<{ tenant: string; ms: number }> = [];
  await Promise.all(
    ["alpha", "beta", "gamma"].map((tenant) =>
      withTenantLock(tenant, async () => {
        await sleep(300);
        finishes.push({ tenant, ms: Date.now() - start });
      }),
    ),
  );
  const maxMs = Math.max(...finishes.map((f) => f.ms));
  const ok = finishes.length === 3 && maxMs < 600; // 3 parallel ~300ms each, total < 600ms
  console.log(`[mutex] cross-tenant parallelism: ${ok ? "PASS" : "FAIL"} (slowest finish ${maxMs}ms; ideal <600ms)`);
  if (!ok) failed++;
}

// Test 3: rejected task doesn't block successor (mutex.ts uses .then(task, task))
// Note: mutex.ts also caches the rejected promise into `queues.set` and adds a
// `.finally()` cleanup. The .finally's promise can surface as an unhandled
// rejection — silence Bun's default handler for THIS test only.
{
  const swallow = () => {};
  process.on("unhandledRejection", swallow);
  let secondRan = false;
  await withTenantLock("delta", async () => {
    throw new Error("intentional reject");
  }).catch(swallow);
  await withTenantLock("delta", async () => {
    secondRan = true;
  });
  process.off("unhandledRejection", swallow);
  console.log(`[mutex] post-reject recovery: ${secondRan ? "PASS" : "FAIL"}`);
  if (!secondRan) failed++;
}

// Test 4: queue self-cleans after each tenant drains
{
  await withTenantLock("epsilon", async () => {
    await sleep(50);
  });
  await sleep(10); // allow finally callback to settle
  const pending = pendingTenants();
  const ok = !pending.includes("epsilon");
  console.log(`[mutex] queue cleanup after drain: ${ok ? "PASS" : "FAIL"} (pending: ${pending.length === 0 ? "[]" : pending.join(",")})`);
  if (!ok) failed++;
}

if (failed > 0) {
  console.error(`\n${failed} mutex test(s) failed`);
  process.exit(1);
}
console.log("\nall mutex tests passed — HARN-04 serialization invariant proven");
