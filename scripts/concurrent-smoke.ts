#!/usr/bin/env bun
// Phase 1 success criterion #5: concurrent gbrain queries against the same
// brain must serialize via the in-process mutex with no PGLite lock errors.
//
// Fires three queries in parallel against brains/seed/ and prints start/end
// timestamps so you can eyeball the serialization: each query starts only
// after the previous one finishes.
//
// Run:  bun scripts/concurrent-smoke.ts
import { query, SEED_TENANT_ID } from "../lib/gbrain/index.ts";

const QUESTIONS = [
  "What was weird about last month?",
  "Who are my top 5 vendors and how much did I pay each?",
  "What am I paying for every month that I shouldn't be?",
];

async function timed(label: string, q: string) {
  const start = Date.now();
  console.log(`[${new Date(start).toISOString()}] ${label} START`);
  try {
    const out = await query(SEED_TENANT_ID, q);
    const ms = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${label} END (${ms}ms, ${out.length} bytes)`);
    return { ok: true, ms };
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`[${new Date().toISOString()}] ${label} FAIL (${ms}ms): ${(err as Error).message}`);
    return { ok: false, ms };
  }
}

const results = await Promise.all(
  QUESTIONS.map((q, i) => timed(`Q${i + 1}`, q)),
);

const failed = results.filter((r) => !r.ok).length;
if (failed > 0) {
  console.error(`\n${failed}/${results.length} queries failed`);
  process.exit(1);
}
console.log(`\nall ${results.length} queries serialized cleanly`);
