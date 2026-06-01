/**
 * Spike-only shim for lib/auth/resolve-tenant.ts.
 *
 * In production, tenant-scoped.ts imports:
 *   import { resolveTenantSourceId } from "@/lib/auth/resolve-tenant";
 *
 * Phase 6 already ships the verified tenantId → sourceId chokepoint (it lives
 * in lib/auth/provision.ts + lib/gbrain/tenants.ts today; Phase 7 should
 * consolidate to lib/auth/resolve-tenant.ts).
 *
 * For the spike, we use a two-tenant fixture map so the spike can be run
 * deterministically without hitting the real users/sessions tables.
 */

const FIXTURE_TENANT_TO_SOURCE: Record<string, string> = {
  "spike-011-tenant-a": "spike-011-tenant-a",
  "spike-011-tenant-b": "spike-011-tenant-b",
};

export async function resolveTenantSourceId(tenantId: string): Promise<string> {
  // In production: real lookup via app.users.brain_id WHERE id = $1
  // (Phase 6 already implements this; never trust params.id).
  const sourceId = FIXTURE_TENANT_TO_SOURCE[tenantId];
  if (!sourceId) {
    throw new Error(`spike-tenant-shim: unknown tenantId "${tenantId}" — register in FIXTURE_TENANT_TO_SOURCE`);
  }
  return sourceId;
}
