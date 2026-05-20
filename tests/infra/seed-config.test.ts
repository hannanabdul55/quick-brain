/**
 * tests/infra/seed-config.test.ts
 *
 * Guards the on-disk seed brain config.json against accidental password leakage
 * and confirms the engine has been migrated to Postgres.
 *
 * CI SAFETY: brains/seed/.gbrain/config.json is gitignored (brains/* in .gitignore).
 * On a fresh CI checkout the file does NOT exist. All assertions are wrapped in
 * describe.skipIf(!existsSync(configPath)) so the suite skips cleanly in CI and
 * only runs when the file is present (local dev, post-migration).
 *
 * INFRA-01, INFRA-02 — Phase 2: gbrain on Supabase
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const configPath = resolve(REPO_ROOT, "brains", "seed", ".gbrain", "config.json");

// CI-safe: skip all assertions if the gitignored file is absent.
// The `describe.skipIf` form is the canonical Vitest pattern for conditional skipping.
describe.skipIf(!existsSync(configPath))("seed brain config.json", () => {
  const config: Record<string, unknown> = JSON.parse(
    readFileSync(configPath, "utf-8"),
  );

  it("has engine === 'postgres' (Phase 2 migration)", () => {
    expect(config.engine).toBe("postgres");
  });

  it("does NOT contain a database_url field (T-02-01: no plaintext password on disk)", () => {
    expect(Object.prototype.hasOwnProperty.call(config, "database_url")).toBe(false);
  });

  it("does NOT contain a password field (defense-in-depth)", () => {
    expect(Object.prototype.hasOwnProperty.call(config, "password")).toBe(false);
  });
});
