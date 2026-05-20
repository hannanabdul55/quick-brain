/**
 * lib/health/probes.ts — Reachability probe functions for GET /api/health
 *
 * Exports three independent subsystem probes plus timeout helpers.
 * Each probe resolves on success and throws on failure — callers use
 * the `timed()` helper to convert to a Probe result object.
 *
 * Security:
 * - T-04-02: Error catch handlers produce generic messages; the DB-probe
 *   failure detail never echoes the postgres:// URL; storage-probe detail
 *   never echoes the bucket URL or service-role key.
 * - T-04-04: The DB probe uses a throwaway postgres connection (max:1,
 *   closed in finally) and NEVER touches the app's enginePool.
 *
 * DEPLOY-03: required for GET /api/health (app/api/health/route.ts).
 */

import postgres from "postgres";
import { createStorage } from "@/lib/storage";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * The result shape returned by `timed()` for each subsystem probe.
 */
export type Probe = {
  ok: boolean;
  latencyMs: number;
  detail?: string;
};

// ── Timeout helpers ───────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout.
 *
 * Resolves with the promise's value if it settles before `ms` milliseconds.
 * Rejects with an Error containing "timed out after <ms>ms" if the timeout
 * fires first.
 *
 * @param p   - The promise to race
 * @param ms  - Timeout in milliseconds
 */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error(`probe timed out after ${ms}ms`)), ms),
    ),
  ]);
}

/**
 * Run an async probe function through `withTimeout`, measure elapsed time,
 * and return a `Probe` result.
 *
 * On success → `{ ok: true, latencyMs }`.
 * On failure → `{ ok: false, latencyMs, detail }` where detail is the
 *   error message (never the connection string or any secret).
 *
 * @param fn   - Async probe function that resolves on success, throws on failure
 * @param ms   - Per-probe timeout in milliseconds (default 2500)
 */
export async function timed(fn: () => Promise<void>, ms = 2500): Promise<Probe> {
  const start = Date.now();
  try {
    await withTimeout(fn(), ms);
    return { ok: true, latencyMs: Date.now() - start };
  } catch (e) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

// ── Probe: gbrain database ────────────────────────────────────────────────────

/**
 * Probe the gbrain Supabase Postgres database for reachability.
 *
 * Mirrors the exact env-resolution fallback chain from lib/gbrain/engine.ts
 * `buildConfig()`: GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER.
 *
 * Uses a throwaway postgres connection (max:1, closed in finally) — NEVER
 * calls createGBrainEngine() or touches the app's enginePool (T-04-04).
 *
 * Throws on failure. Caller should wrap in `timed()`.
 */
export async function probeGbrainDb(): Promise<void> {
  // ── 1. Resolve DB URL — exact fallback chain from engine.ts buildConfig ─────
  const database_url =
    process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!database_url) {
    throw new Error(
      "GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set",
    );
  }

  // ── 2. Open a throwaway connection, run SELECT 1, always close ───────────────
  // Options: prepare:false (pooler-safe), max:1 (single conn), short timeouts.
  // This probe MUST NOT call createGBrainEngine or touch enginePool.
  const sql = postgres(database_url, {
    prepare: false,
    max: 1,
    idle_timeout: 2,
    connect_timeout: 3,
  });

  try {
    await sql`SELECT 1`;
  } finally {
    // Always close the throwaway connection regardless of success/failure.
    // timeout:1 prevents hanging in the finally block.
    await sql.end({ timeout: 1 });
  }
}

// ── Probe: Supabase Storage ───────────────────────────────────────────────────

/**
 * Probe Supabase Storage for reachability.
 *
 * Uses createStorage() from @/lib/storage (env-driven; reuses STORAGE_BACKEND).
 * Calls exists(".health-check") — a single HEAD request via supabase.ts.
 * A `false` return is fine (file absent); only a thrown error is a failure.
 *
 * Does NOT add @supabase/supabase-js — lib/storage uses raw fetch (CLAUDE.md).
 * Throws on error. Caller should wrap in `timed()`.
 */
export async function probeStorage(): Promise<void> {
  const store = createStorage();
  // exists() returns false if the file is absent — that is fine; only a throw is a failure.
  await store.exists(".health-check");
}
