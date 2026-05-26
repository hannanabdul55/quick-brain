/**
 * tests/unit/insights/route-empty-bundle.test.ts
 *
 * RED tests for the fresh-tenant no-data guard in the insights route.
 * Covers D-02 gap (UAT test 11): GET /api/tenants/<slug>/insights must return
 * 200 with an empty bundle (not 500 compute_failed ENOENT) when the tenant has
 * no originals/ directory.
 *
 * Strategy: mock resolveTenant + node:fs/promises stat to avoid filesystem
 * dependencies and DB connections.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { FIXTURES_ROOT, SEED_TENANT_ID, brainHome } from "@/lib/gbrain/paths";
import { invalidate } from "@/lib/insights/cache";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before imports
// ---------------------------------------------------------------------------

// Mock resolveTenant so the route doesn't hit Supabase
vi.mock("@/lib/auth/resolve-tenant", () => ({
  resolveTenant: vi.fn(),
}));

// Mock node:fs/promises stat — only the stat call; readdir etc. used by
// computeAndCache are left real (they'll fail on a missing path, which is
// intentional for test A's "originalsExists = false" branch).
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    stat: vi.fn(),
  };
});

// Mock @/lib/insights/prewarm to avoid the seed prewarm side-effect
// (seed prewarm reads from FIXTURES_ROOT synchronously on import; in this
// test we want full control of the cache).
vi.mock("@/lib/insights/prewarm", () => ({}));

// ---------------------------------------------------------------------------
// Lazy imports AFTER mocks are registered
// ---------------------------------------------------------------------------

// We use dynamic imports inside tests so vi.mock hoisting runs first.

// Helper: build a minimal Next.js-style route request context
function makeCtx(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/tenants/[id]/insights — no-data guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore AUTH_ENABLED so later tests start clean
    delete process.env.AUTH_ENABLED;
  });

  // ── Test A: fresh tenant with no originals/ dir → 200 empty bundle ────────

  it(
    "A: authenticated tenant with missing originals/ dir → 200 + empty bundle",
    async () => {
      process.env.AUTH_ENABLED = "1";

      const { resolveTenant } = await import("@/lib/auth/resolve-tenant");
      const fsMod = await import("node:fs/promises");

      // resolveTenant returns an authenticated fresh tenant
      vi.mocked(resolveTenant).mockResolvedValueOnce({
        authenticated: true,
        userId: "user-abc",
        sourceId: "u-freshtest001",
        brainSlug: "u-freshtest001",
      });

      // stat throws ENOENT — simulates missing originals/ directory
      const enoent = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      vi.mocked(fsMod.stat).mockRejectedValueOnce(enoent);

      const { GET } = await import("@/app/api/tenants/[id]/insights/route");

      const req = new Request("http://localhost/api/tenants/u-freshtest001/insights");
      const res = await GET(req, makeCtx("u-freshtest001"));

      expect(res.status).toBe(200);

      const body = await res.json() as {
        topVendors: unknown[];
        pnl: unknown;
        anomalies: unknown[];
        computedAt: number;
      };
      expect(body.topVendors).toEqual([]);
      expect(body.pnl).toBeNull();
      expect(body.anomalies).toEqual([]);
      expect(typeof body.computedAt).toBe("number");
    },
  );

  // ── Test B: slug mismatch → 403 (guard fires before new stat code) ────────
  //
  // Note: Test B from the plan ("originals/ exists as empty dir → 200") is
  // reframed here as a slug-mismatch guard test, because:
  //   - All three compute functions throw ENOENT even on an empty originals/
  //     (pnl.ts reads monthly-close-2026-03.md, anomalies.ts reads concepts/).
  //   - An empty dir still causes 500 compute_failed with the current code.
  //   - The slug-mismatch 403 guard fires BEFORE the new stat call and is
  //     worth asserting as a regression guard.
  // The plan acknowledges either framing is acceptable.

  it(
    "B: URL slug that mismatches session brainSlug → 403 (guard still fires)",
    async () => {
      process.env.AUTH_ENABLED = "1";

      const { resolveTenant } = await import("@/lib/auth/resolve-tenant");

      // Session resolves to slug-a but URL says slug-b
      vi.mocked(resolveTenant).mockResolvedValueOnce({
        authenticated: true,
        userId: "user-abc",
        sourceId: "u-slug-a",
        brainSlug: "u-slug-a",
      });

      const { GET } = await import("@/app/api/tenants/[id]/insights/route");

      const req = new Request("http://localhost/api/tenants/u-slug-b/insights");
      const res = await GET(req, makeCtx("u-slug-b"));

      expect(res.status).toBe(403);
    },
  );

  // ── Test C: seed bypass branch still computes from FIXTURES_ROOT ──────────

  it(
    "C: AUTH_ENABLED=0 + id=seed → 200 with non-empty topVendors from FIXTURES_ROOT",
    async () => {
      process.env.AUTH_ENABLED = "0";

      // Clear the seed cache so the route exercises the compute path
      invalidate(SEED_TENANT_ID);

      const { GET } = await import("@/app/api/tenants/[id]/insights/route");

      const req = new Request("http://localhost/api/tenants/seed/insights");
      const res = await GET(req, makeCtx(SEED_TENANT_ID));

      expect(res.status).toBe(200);

      const body = await res.json() as { topVendors: unknown[] };
      // Mara's coffee has invoices — topVendors must be non-empty
      expect(Array.isArray(body.topVendors)).toBe(true);
      expect(body.topVendors.length).toBeGreaterThan(0);
    },
  );
});
