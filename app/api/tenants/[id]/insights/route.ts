/**
 * GET /api/tenants/[id]/insights
 *
 * Batch endpoint returning the three insight card bundles for the authenticated
 * user's brain. Cache-first: serves the pre-warmed InsightBundle from
 * lib/insights/cache.ts on cache hit (<5ms); computes + caches on first miss.
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
 *   401  — unauthenticated (no valid session cookie)
 *   403  — URL slug does not match the session-resolved brain slug
 *   500  — fixture parse error (corrupt data files)
 *
 * AUTH-05 (D-11): identity is resolved from the verified session cookie via
 * resolveTenant(). The URL [id] slug is NEVER trusted for identity. For real
 * authenticated tenants, insight computation is scoped to the session-derived
 * sourceId (T-06-26). A real user's brain is empty until Phase 7 QBO ingest —
 * an empty insight result is the correct, acceptable outcome for Phase 6 (D-02).
 *
 * The AUTH_ENABLED=0 seed path reads from FIXTURES_ROOT (static fixture dir)
 * and is the only path that does NOT require a session (dev bypass, D-03).
 *
 * INSI-01: serves the 3 insight cards on dashboard mount.
 * No gbrain CLI spawn — pure in-process static-file computation.
 */

import { join } from "node:path";
import { stat } from "node:fs/promises";
import { resolveTenant } from "@/lib/auth/resolve-tenant";
import { FIXTURES_ROOT, SEED_TENANT_ID, brainHome } from "@/lib/gbrain/paths";
import { getCachedInsights, computeAndCache } from "@/lib/insights/cache";

// Ensure seed pre-warm fires at server startup (idempotent singleton).
// Import side-effect only — no exported symbol needed.
import "@/lib/insights/prewarm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // ── AUTH_ENABLED=0 seed bypass (D-03) ─────────────────────────────────────
  // Dev-only path: the seed tenant is served without auth. Phase 9 removes this.
  const isDevBypass = process.env.AUTH_ENABLED === "0" && id === SEED_TENANT_ID;

  if (isDevBypass) {
    // Seed tenant: read from the static fixture dir (data/maras-coffee/)
    let bundle = getCachedInsights(SEED_TENANT_ID);
    if (!bundle) {
      try {
        bundle = await computeAndCache(SEED_TENANT_ID, FIXTURES_ROOT);
      } catch (err: unknown) {
        console.error("[insights] seed compute failed", err);
        return Response.json(
          { error: "compute_failed", message: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
      }
    }
    return Response.json(bundle, { status: 200 });
  }

  // ── 1. Resolve identity from the session (D-11 / AUTH-05) ─────────────────
  const tenantCtx = await resolveTenant();
  if (!tenantCtx.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { brainSlug } = tenantCtx;

  // ── 2. Optional slug mismatch guard ───────────────────────────────────────
  if (id !== brainSlug) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // ── 3. Cache-first read ───────────────────────────────────────────────────
  // Real authenticated tenant: reads from their brain dir. A real user's brain
  // is empty until Phase 7 QBO ingest — computeAndCache returns an empty bundle
  // (no vendors, no P&L, no anomalies). That is the correct Phase 6 outcome (D-02).
  // T-06-26: insight computation is scoped to the session-resolved brain slug
  // (brainHome(brainSlug)); no other user's data is reachable.
  const sourceDir = join(brainHome(brainSlug), "brain-repo");

  let bundle = getCachedInsights(brainSlug);
  if (!bundle) {
    // D-02 (gap closed 06-06): fresh tenants with no originals/ dir return empty
    // bundle (not 500). See .planning/debug/06-insights-enoent-fresh-tenant.md.
    // One stat syscall per cache miss — negligible. Once Phase 7 QBO ingest
    // populates the brain, computeAndCache caches the result and stat is skipped.
    const originalsExists = await stat(join(sourceDir, "originals"))
      .then((s) => s.isDirectory())
      .catch(() => false);

    if (!originalsExists) {
      bundle = { topVendors: [], pnl: null, anomalies: [], computedAt: Date.now() };
      // Intentionally NOT calling cache.set — leaves cache empty so the first
      // request after Phase 7 ingest triggers a fresh compute (Open Question 2,
      // debug session 06-insights-enoent-fresh-tenant.md).
    } else {
      try {
        bundle = await computeAndCache(brainSlug, sourceDir);
      } catch (err: unknown) {
        console.error("[insights] compute failed for", brainSlug, err);
        return Response.json(
          {
            error: "compute_failed",
            message: err instanceof Error ? err.message : String(err),
          },
          { status: 500 },
        );
      }
    }
  }

  return Response.json(bundle, { status: 200 });
}
