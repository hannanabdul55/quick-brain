import { computeTopVendors } from "./top-vendors.ts";
import { computePnl } from "./pnl.ts";
import { computeAnomalies } from "./anomalies.ts";
import type { InsightBundle } from "./types.ts";

/**
 * In-process insight bundle cache, keyed by tenantId.
 *
 * No TTL — the demo runs within a single process lifetime and the reset
 * endpoint calls invalidate() explicitly (D-Insight-Lifecycle).
 */
const cache = new Map<string, InsightBundle>();

/**
 * Return the cached InsightBundle for the given tenant, or undefined if not cached.
 */
export function getCachedInsights(tenantId: string): InsightBundle | undefined {
  return cache.get(tenantId);
}

/**
 * Compute insight bundle from static markdown fixtures and store in cache.
 * Runs the three compute functions in parallel via Promise.all.
 */
export async function computeAndCache(
  tenantId: string,
  fixturesDir: string
): Promise<InsightBundle> {
  const [topVendors, pnl, anomalies] = await Promise.all([
    computeTopVendors(fixturesDir),
    computePnl(fixturesDir),
    computeAnomalies(fixturesDir),
  ]);

  const bundle: InsightBundle = {
    topVendors,
    pnl,
    anomalies,
    computedAt: Date.now(),
  };

  cache.set(tenantId, bundle);
  return bundle;
}

/**
 * Remove the cached bundle for this tenant.
 * Called by the reset endpoint (plan 03-04) to force recomputation.
 */
export function invalidate(tenantId: string): void {
  cache.delete(tenantId);
}

/**
 * Return the current number of cached tenants. Diagnostic only.
 */
export function size(): number {
  return cache.size;
}
