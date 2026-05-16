import { resolve } from "node:path";

// import.meta.dir is Bun-only and is undefined when compiled by Next.js/webpack.
// process.cwd() returns the project root in both runtimes when the server is
// started from the repo root (bun run dev, bun run seed, etc.).
const REPO_ROOT =
  typeof import.meta.dir === "string"
    ? resolve(import.meta.dir, "..", "..")
    : process.cwd();

export const SEED_TENANT_ID = "seed";

export const BRAINS_ROOT = resolve(REPO_ROOT, "brains");
export const FIXTURES_ROOT = resolve(REPO_ROOT, "data", "maras-coffee");

export function brainHome(tenantId: string): string {
  return resolve(BRAINS_ROOT, tenantId);
}

export function seedBrainHome(): string {
  return brainHome(SEED_TENANT_ID);
}
