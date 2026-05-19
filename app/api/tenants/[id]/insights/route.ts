/**
 * GET /api/tenants/[id]/insights
 *
 * Batch endpoint returning the three insight card bundles for a given tenant.
 * Cache-first: serves the pre-warmed InsightBundle from lib/insights/cache.ts
 * on cache hit (<5ms); computes + caches on first miss (~50-100ms).
 *
 * Response shape (200):
 *   {
 *     topVendors: TopVendorRow[],   // top 5 vendors by Q1-2026 spend
 *     pnl: PnlSnapshot,             // March 2026 P&L + February delta
 *     anomalies: AnomalyRow[],      // 3 flagged anomalies
 *     computedAt: number            // Date.now() at cache-fill time
 *   }
 *
 * HTTP status codes:
 *   200  — InsightBundle JSON (cache hit or freshly computed)
 *   400  — invalid tenant slug (fails TENANT_SLUG_REGEX)
 *   404  — valid slug but no tenant brain dir found
 *   500  — fixture parse error (corrupt data files)
 *
 * INSI-01: serves the 3 insight cards on dashboard mount.
 * No gbrain CLI spawn — pure in-process static-file computation.
 */

import { join } from "node:path";
import { tenantSlugSchema } from "@/lib/gbrain/slug";
import * as tenants from "@/lib/gbrain/tenants";
import { FIXTURES_ROOT, SEED_TENANT_ID, brainHome } from "@/lib/gbrain/paths";
import { getCachedInsights, computeAndCache } from "@/lib/insights/cache";

// Ensure seed pre-warm fires at server startup (idempotent singleton).
// Import side-effect only — no exported symbol needed.
import "@/lib/insights/prewarm";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ── 1. Validate tenant slug ───────────────────────────────────────────────
  const { id } = await ctx.params;
  const parsed = tenantSlugSchema.safeParse(id);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_slug", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const tenantId = parsed.data;

  // ── 2. Verify tenant exists ───────────────────────────────────────────────
  // Special-case: seed tenant is a fixed constant that always exists.
  // The brains/seed/ directory is pre-seeded and its cache is pre-warmed.
  // For other tenants, verify against the filesystem-backed registry.
  const isSeed = tenantId === SEED_TENANT_ID;
  if (!isSeed) {
    await tenants.init();
    const tenant = tenants.get(tenantId);
    if (!tenant) {
      return Response.json(
        { error: "tenant_not_found", message: `No tenant registered with id: ${tenantId}` },
        { status: 404 },
      );
    }
  }

  // ── 3. Cache-first read ───────────────────────────────────────────────────
  // The seed tenant's bundle is pre-warmed at boot by lib/insights/prewarm.ts.
  // Other tenants compute on first dashboard mount and cache for subsequent loads.
  //
  // sourceDir resolution (T-04-02-01 fix):
  //   - seed tenant: reads from the static fixture dir (data/maras-coffee/)
  //   - real tenants: reads from their gbrain-populated brain-repo dir
  //     (brains/<tenantId>/brain-repo/ — where the smb-audit skill writes concept pages)
  const sourceDir = isSeed
    ? FIXTURES_ROOT
    : join(brainHome(tenantId), "brain-repo");

  let bundle = getCachedInsights(tenantId);
  if (!bundle) {
    try {
      bundle = await computeAndCache(tenantId, sourceDir);
    } catch (err: unknown) {
      console.error("[insights] compute failed for", tenantId, err);
      return Response.json(
        {
          error: "compute_failed",
          message: err instanceof Error ? err.message : String(err),
        },
        { status: 500 },
      );
    }
  }

  return Response.json(bundle, { status: 200 });
}
