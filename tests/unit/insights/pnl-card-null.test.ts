/**
 * tests/unit/insights/pnl-card-null.test.ts
 *
 * RED tests for PnlCard null-snapshot handling (D-02 empty state).
 *
 * Note: PnlCard is a "use client" React component. Vitest's node environment
 * cannot load it via dynamic import without a jsdom + RSC plugin setup that
 * is intentionally absent from this project (tight dep list, no @testing-library).
 *
 * Approach: structural source-code assertions (same pattern used in
 * tests/auth/cross-tenant-isolation.test.ts for chokepoint verification).
 * This verifies:
 *   D: The component source accepts a null snapshot prop and renders a
 *      "No P&L data yet" empty-state string — required by D-02 / UAT test 11.
 *   E: The existing dollar-formatting path remains (not deleted by the fix).
 *
 * RED: before Task 2, `pnl-card.tsx` does not contain the null guard or the
 *      "No P&L data yet" string, so Test D fails.
 * GREEN: after Task 2 adds the null branch, both tests pass.
 *
 * Why structural testing is sufficient here:
 *   The route test (route-empty-bundle.test.ts) already proves the API contract
 *   at the boundary (200 + null pnl). The PnlCard null branch is a rendering
 *   concern: we assert the guard is present and the exact UI copy is in the code.
 *   Integration-level UI correctness is verified by the operator during UAT.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve path relative to project root (process.cwd() = repo root in vitest)
const PNL_CARD_PATH = resolve(process.cwd(), "components/insights/pnl-card.tsx");

describe("PnlCard — null snapshot structural assertions", () => {
  // ── Test D: null snapshot → "No P&L data yet" empty state ────────────────

  it(
    "D: pnl-card.tsx accepts a null snapshot and renders 'No P&L data yet'",
    () => {
      const src = readFileSync(PNL_CARD_PATH, "utf-8");

      // The props type must allow null snapshot (Task 2 widens to PnlSnapshot | null)
      expect(src).toContain("PnlSnapshot | null");

      // The component must render the exact empty-state string for null snapshot
      expect(src).toContain("No P&L data yet");

      // The null guard must be an explicit runtime check (not just a type change)
      // Either: if (snapshot === null) or snapshot === null
      expect(src).toMatch(/snapshot\s*===\s*null/);
    },
  );

  // ── Test E: non-null path still formats dollar amounts (regression guard) ──

  it(
    "E: pnl-card.tsx still formats dollar amounts for non-null snapshots",
    () => {
      const src = readFileSync(PNL_CARD_PATH, "utf-8");

      // Revenue, COGS, Opex, Net formatting must still be present
      expect(src).toContain("snapshot.revenue");
      expect(src).toContain("snapshot.cogs");
      expect(src).toContain("snapshot.opex");
      expect(src).toContain("snapshot.net");

      // The Intl formatter must still exist
      expect(src).toContain("fmt.format");
    },
  );
});
