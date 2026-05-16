import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");

export const SEED_TENANT_ID = "seed";

export const BRAINS_ROOT = resolve(REPO_ROOT, "brains");
export const FIXTURES_ROOT = resolve(REPO_ROOT, "data", "maras-coffee");

export function brainHome(tenantId: string): string {
  return resolve(BRAINS_ROOT, tenantId);
}

export function seedBrainHome(): string {
  return brainHome(SEED_TENANT_ID);
}
