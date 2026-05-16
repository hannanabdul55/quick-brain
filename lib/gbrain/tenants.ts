import { readdir, stat } from "node:fs/promises";
import { BRAINS_ROOT, brainHome, SEED_TENANT_ID } from "./paths.ts";
import { isValidTenantSlug } from "./slug.ts";

export type TenantStatus = "pending" | "ready" | "error";

export type TenantRecord = {
  id: string;
  brainHome: string;
  status: TenantStatus;
  createdAt: number;
  // Set during onboarding; never persisted. Display only.
  name?: string;
  businessType?: string;
  ownerName?: string;
};

// HARN-05: in-memory registry. Rebuilt from filesystem on Next.js boot
// (or on demand via reload()). The brain dir IS the source of truth;
// this Map is only for fast lookup + display metadata.
const registry = new Map<string, TenantRecord>();
let initialized = false;

export async function init(): Promise<void> {
  if (initialized) return;
  await reload();
  initialized = true;
}

export async function reload(): Promise<void> {
  registry.clear();
  let entries: string[];
  try {
    entries = await readdir(BRAINS_ROOT);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || !isValidTenantSlug(entry)) continue;
    const home = brainHome(entry);
    try {
      const s = await stat(home);
      if (!s.isDirectory()) continue;
      registry.set(entry, {
        id: entry,
        brainHome: home,
        status: "ready",
        createdAt: s.birthtimeMs || s.ctimeMs,
      });
    } catch {
      // ignore unreadable entries
    }
  }
}

export function get(tenantId: string): TenantRecord | undefined {
  return registry.get(tenantId);
}

export function list(): TenantRecord[] {
  return Array.from(registry.values()).sort((a, b) => a.createdAt - b.createdAt);
}

export function upsert(record: TenantRecord): TenantRecord {
  registry.set(record.id, record);
  return record;
}

export function remove(tenantId: string): boolean {
  return registry.delete(tenantId);
}

export function isSeed(tenantId: string): boolean {
  return tenantId === SEED_TENANT_ID;
}
