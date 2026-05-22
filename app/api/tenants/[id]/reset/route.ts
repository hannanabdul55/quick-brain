/**
 * POST /api/tenants/[id]/reset
 *
 * Resets a tenant brain. The behavior differs by auth mode:
 *
 * AUTH_ENABLED=0 (dev/seed path, D-03):
 *   1. Validate tenant slug (400 on failure).
 *   2. Reject seed tenant (403 — cannot_reset_seed).
 *   3. Abort any in-flight spawns for this tenant.
 *   4. rm -rf brains/<id>/  +  cp -r brains/seed/ brains/<id>/  (filesystem reset).
 *   5. Invalidate the insight cache.
 *   6. Return 200 { ok, durationMs, abortedSpawns }.
 *
 * AUTH_ENABLED=1 (real authenticated tenants, Phase 6+):
 *   1. Resolve identity from the verified session cookie via resolveTenant().
 *   2. Return 401 if unauthenticated; 403 if URL slug mismatches session.
 *   3. Reject seed tenant (403 — cannot_reset_seed).
 *   4. Invalidate the insight cache for the session-resolved brain slug.
 *   5. Return 200 { ok, durationMs, abortedSpawns }.
 *   NOTE: Does NOT rm -rf a filesystem brain dir for hosted tenants. The
 *   filesystem brain model is gone (D-01/D-02); the hosted brain lives in
 *   Supabase Postgres (T-06-26 / anti-pattern: no destructive ops on hosted data).
 *   A full brain data reset for hosted tenants is Phase 7+ scope.
 *
 * Route Handler constraints:
 * - dynamic = "force-dynamic"
 * - runtime = "nodejs"
 *
 * AUTH-05 (D-11): identity is resolved from the verified session cookie via
 * resolveTenant(). The URL [id] slug is NEVER trusted for identity.
 * T-06-26: reset only targets the session-resolved sourceId; cannot touch
 * another user's brain data.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { cp, rm } from "node:fs/promises";
import { resolveTenant } from "@/lib/auth/resolve-tenant";
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
  const { id } = await ctx.params;

  // ── AUTH_ENABLED=0 seed bypass (D-03) ─────────────────────────────────────
  // The legacy filesystem reset is only valid in dev mode with the seed path.
  if (process.env.AUTH_ENABLED === "0") {
    // ── 1. Extract + validate tenant slug ──────────────────────────────────
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

    // ── 3. Abort in-flight spawns for this tenant ───────────────────────────
    const killed = abortTenant(tenantId);
    console.log(`[reset] aborted=${killed} spawn(s) for tenant=${tenantId}`);

    // ── 4. Remove existing brain dir ────────────────────────────────────────
    try {
      await rm(brainHome(tenantId), { recursive: true, force: true });
    } catch (err: unknown) {
      console.warn(
        `[reset] rm failed for tenant=${tenantId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    // ── 5. Copy seed brain into place ───────────────────────────────────────
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

    // ── 6. Invalidate insight cache ─────────────────────────────────────────
    invalidate(tenantId);

    const durationMs = Date.now() - t0;
    console.log(`[reset] complete tenant=${tenantId} duration_ms=${durationMs}`);
    return Response.json(
      { ok: true, durationMs, abortedSpawns: killed },
      { status: 200 },
    );
  }

  // ── Authenticated path (AUTH_ENABLED=1) ───────────────────────────────────
  // Identity comes from the verified session cookie — never from the URL slug.

  // ── 1. Resolve identity from the session (D-11 / AUTH-05) ─────────────────
  const tenantCtx = await resolveTenant();
  if (!tenantCtx.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { brainSlug } = tenantCtx;

  // ── 2. Slug mismatch guard ─────────────────────────────────────────────────
  if (id !== brainSlug) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // ── 3. Reject seed tenant ──────────────────────────────────────────────────
  if (brainSlug === SEED_TENANT_ID || tenants.isSeed(brainSlug)) {
    return Response.json(
      { error: "cannot_reset_seed" },
      { status: 403 },
    );
  }

  // ── 4. Invalidate insight cache ────────────────────────────────────────────
  // For hosted tenants, the brain lives in Supabase Postgres — we do NOT
  // rm -rf a filesystem dir. Invalidating the cache is a lightweight reset
  // of the cached insight cards. Full brain data reset is Phase 7+ scope.
  // T-06-26: only the session-resolved brainSlug is affected.
  invalidate(brainSlug);

  // ── 5. Abort any in-flight spawns (if any) ────────────────────────────────
  const killed = abortTenant(brainSlug);
  if (killed > 0) {
    console.log(`[reset] aborted=${killed} spawn(s) for brainSlug=${brainSlug}`);
  }

  const durationMs = Date.now() - t0;
  console.log(`[reset] cache-invalidated brainSlug=${brainSlug} duration_ms=${durationMs}`);

  return Response.json(
    { ok: true, durationMs, abortedSpawns: killed },
    { status: 200 },
  );
}
