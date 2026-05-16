/**
 * POST /api/tenants/[id]/reset
 *
 * Resets a tenant brain to seed state:
 *   1. Validate tenant slug (400 on failure).
 *   2. Reject seed tenant (403 — cannot_reset_seed).
 *   3. Verify tenant exists in registry (404 if not).
 *   4. Abort any in-flight spawns for this tenant.
 *   5. rm -rf brains/<id>/
 *   6. cp -r brains/seed/ brains/<id>/
 *   7. Invalidate the insight cache for this tenant.
 *   8. Re-register tenant in-memory so the registry stays consistent.
 *   9. Return 200 { ok, durationMs, abortedSpawns }.
 *
 * Total budget: <10s, typically ~2s (D-Reset-Flow).
 */

export const dynamic = "force-dynamic";

import { cp, rm } from "node:fs/promises";
import { tenantSlugSchema } from "@/lib/gbrain/slug";
import * as tenants from "@/lib/gbrain/tenants";
import { SEED_TENANT_ID, brainHome, seedBrainHome } from "@/lib/gbrain/paths";
import { invalidate } from "@/lib/insights/cache";
import { abortTenant } from "@/lib/gbrain/abort-tracker";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const t0 = Date.now();

  // ── 1. Extract + validate tenant slug ────────────────────────────────────
  const { id } = await ctx.params;
  const parsed = tenantSlugSchema.safeParse(id);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_slug", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const tenantId = parsed.data;

  // ── 2. Reject the seed tenant — it is the source-of-truth for every reset
  if (tenantId === SEED_TENANT_ID || tenants.isSeed(tenantId)) {
    return Response.json(
      { error: "cannot_reset_seed" },
      { status: 403 },
    );
  }

  // ── 3. Verify tenant exists in in-memory registry ─────────────────────────
  await tenants.init();
  const existing = tenants.get(tenantId);
  if (!existing) {
    return Response.json(
      { error: "tenant_not_found", message: `No tenant registered with id: ${tenantId}` },
      { status: 404 },
    );
  }

  // ── 4. Abort in-flight spawns for this tenant ──────────────────────────────
  const killed = abortTenant(tenantId);
  console.log(`[reset] aborted=${killed} spawn(s) for tenant=${tenantId}`);

  // ── 5. Remove existing brain dir ───────────────────────────────────────────
  try {
    await rm(brainHome(tenantId), { recursive: true, force: true });
  } catch (err: unknown) {
    // Non-fatal: if the dir was already missing, the cp step creates it fresh.
    console.warn(
      `[reset] rm failed for tenant=${tenantId}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  // ── 6. Copy seed brain into place ─────────────────────────────────────────
  try {
    await cp(seedBrainHome(), brainHome(tenantId), { recursive: true });
  } catch (err: unknown) {
    console.error(
      `[reset] cp failed for tenant=${tenantId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return Response.json(
      {
        error: "copy_failed",
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // ── 7. Invalidate insight cache ────────────────────────────────────────────
  invalidate(tenantId);

  // ── 8. Re-register tenant in memory ───────────────────────────────────────
  tenants.upsert({
    id: tenantId,
    brainHome: brainHome(tenantId),
    status: "ready",
    createdAt: Date.now(),
    // Preserve display metadata from the existing record if available.
    name: existing.name,
    businessType: existing.businessType,
    ownerName: existing.ownerName,
  });

  const durationMs = Date.now() - t0;
  console.log(`[reset] complete tenant=${tenantId} duration_ms=${durationMs}`);

  return Response.json(
    { ok: true, durationMs, abortedSpawns: killed },
    { status: 200 },
  );
}
