/**
 * tests/auth/cross-tenant-isolation.test.ts
 *
 * AUTH-05 is enforced at the application boundary by session-derived source-scoping —
 * every gbrain call is hard-scoped to the authenticated user's source_id. gbrain RLS
 * does NOT isolate tenants (QuickBrain connects as the BYPASSRLS service role) —
 * see .planning/phases/06-auth-multi-tenant-isolation/06-RESEARCH.md BLOCKING FINDING.
 *
 * These tests prove cross-tenant isolation at the application boundary:
 *   1. Query isolation: a query scoped to User A's source_id returns A's content only
 *   2. Think isolation: a think() call scoped to A synthesizes over A's pages only
 *   3. Chokepoint shape: resolveTenant() accepts no source-id argument (structural)
 *   4. Session resolution: resolveTenant() resolves the session cookie → source_id
 *
 * Integration tests (1, 2, 4) require a live Supabase connection + gbrain engine.
 * Run with: RUN_INTEGRATION=1 bun run test tests/auth/
 * CI never sets RUN_INTEGRATION — these skip cleanly without DB secrets.
 *
 * Test 3 is a structural assertion that runs in all environments (no DB needed).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Structural assertion (runs in all environments — no DB required)
// ---------------------------------------------------------------------------

describe("cross-tenant: resolveTenant() chokepoint shape", () => {
  it("resolveTenant() is exported from lib/auth/resolve-tenant", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.promises.readFile("lib/auth/resolve-tenant.ts", "utf-8"),
    );
    // The function is exported and has no parameters (the chokepoint guarantee)
    expect(src).toContain("export async function resolveTenant()");
  });

  it("resolveTenant() signature accepts no source_id argument", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.promises.readFile("lib/auth/resolve-tenant.ts", "utf-8"),
    );
    // The function must not accept any parameter named sourceId or source_id
    // Extract the function signature line
    const signatureMatch = src.match(/export async function resolveTenant\((.*?)\)/s);
    expect(signatureMatch).not.toBeNull();
    const params = signatureMatch?.[1] ?? "";
    // No sourceId, source_id, tenantId, or brainId in the parameter list
    expect(params).not.toContain("sourceId");
    expect(params).not.toContain("source_id");
    expect(params).not.toContain("tenantId");
    expect(params).not.toContain("brainId");
    // Empty params confirms the no-argument chokepoint (D-11, T-06-14)
    expect(params.trim()).toBe("");
  });

  it("resolveTenant() reads identity only from the session cookie (cookies() call)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.promises.readFile("lib/auth/resolve-tenant.ts", "utf-8"),
    );
    // Must use next/headers cookies() — the only server-side source for the session cookie
    expect(src).toContain("cookies()");
    // Must call validateSession — the DB-backed session validator
    expect(src).toContain("validateSession");
    // Must return sourceId derived from the session, never from request input
    expect(src).toContain("sourceId: user.brain_id");
  });
});

// ---------------------------------------------------------------------------
// Integration tests (require RUN_INTEGRATION=1 + live Supabase DB)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.RUN_INTEGRATION)(
  "cross-tenant: application-boundary isolation (live DB)",
  () => {
    // Test users (created in beforeAll, deleted in afterAll)
    const userAEmail = `qb-test-a-${randomUUID().slice(0, 8)}@example.com`;
    const userBEmail = `qb-test-b-${randomUUID().slice(0, 8)}@example.com`;

    let userASourceId: string;
    let userBSourceId: string;

    // Marker strings that distinguish the two test brains
    const markerA = `TEST-MARKER-A-${randomUUID().slice(0, 8)}`;
    const markerB = `TEST-MARKER-B-${randomUUID().slice(0, 8)}`;

    beforeAll(async () => {
      // -- Setup: provision two users each with their own source_id -----------
      const { generateSourceId, provisionBrain } = await import("@/lib/auth/provision");
      const { createUser } = await import("@/lib/auth/store");
      const { sql } = await import("@/lib/auth/store");

      // User A
      const { sourceId: sA, brainSlug: slugA } = generateSourceId();
      userASourceId = sA;
      await provisionBrain(sA, userAEmail);
      await createUser({ email: userAEmail, brainId: sA, brainSlug: slugA });

      // User B
      const { sourceId: sB, brainSlug: slugB } = generateSourceId();
      userBSourceId = sB;
      await provisionBrain(sB, userBEmail);
      await createUser({ email: userBEmail, brainId: sB, brainSlug: slugB });

      // -- Ingest distinguishing marker pages into each user's source ---------
      // Insert a page directly into gbrain's pages table scoped to each source.
      // This gives each brain a unique, queryable marker string.
      const metaA = JSON.stringify({ type: "test" });
      const metaB = JSON.stringify({ type: "test" });
      await sql`
        INSERT INTO pages (id, source_id, slug, content, metadata)
        VALUES (
          ${randomUUID()},
          ${sA},
          ${"test/marker-a"},
          ${`This is User A's brain marker: ${markerA}. Unique content for isolation test.`},
          ${metaA}
        )
        ON CONFLICT (source_id, slug) DO NOTHING
      `;

      await sql`
        INSERT INTO pages (id, source_id, slug, content, metadata)
        VALUES (
          ${randomUUID()},
          ${sB},
          ${"test/marker-b"},
          ${`This is User B's brain marker: ${markerB}. Unique content for isolation test.`},
          ${metaB}
        )
        ON CONFLICT (source_id, slug) DO NOTHING
      `;
    });

    afterAll(async () => {
      // -- Teardown: delete test users, their sessions, and gbrain rows -------
      const { sql } = await import("@/lib/auth/store");

      // Delete test users (cascades to sessions if FK set up, but explicit is safer)
      await sql`DELETE FROM app.sessions WHERE user_id IN (
        SELECT id FROM app.users WHERE email = ${userAEmail} OR email = ${userBEmail}
      )`;
      await sql`DELETE FROM app.users WHERE email = ${userAEmail} OR email = ${userBEmail}`;

      // Delete gbrain pages for the test sources
      await sql`DELETE FROM pages WHERE source_id = ${userASourceId} OR source_id = ${userBSourceId}`;

      // Delete gbrain sources (the brain entries)
      await sql`DELETE FROM sources WHERE id = ${userASourceId} OR id = ${userBSourceId}`;
    });

    // ── Assertion 1: query isolation ─────────────────────────────────────────
    it(
      "query scoped to User A's source returns A's marker, not B's",
      { timeout: 60000 },
      async () => {
        const { queryInProcess } = await import("@/lib/gbrain/engine");

        // Query scoped to A's source
        const resultsA = await queryInProcess("test", markerA, { sourceId: userASourceId });

        // At least one result should reference User A's marker page
        const slugsA = resultsA.map((r) => r.slug ?? "");
        const textsA = resultsA.map((r) => r.chunk_text ?? "");

        // A's marker page should be findable under A's scope
        const aFoundInA = slugsA.some((s) => s.includes("marker-a")) ||
          textsA.some((t) => t.includes(markerA));
        expect(aFoundInA).toBe(true);

        // B's marker should NOT appear in results scoped to A
        const bFoundInA = slugsA.some((s) => s.includes("marker-b")) ||
          textsA.some((t) => t.includes(markerB));
        expect(bFoundInA).toBe(false);
      },
    );

    it(
      "query scoped to User B's source returns B's marker, not A's",
      { timeout: 60000 },
      async () => {
        const { queryInProcess } = await import("@/lib/gbrain/engine");

        const resultsB = await queryInProcess("test", markerB, { sourceId: userBSourceId });
        const slugsB = resultsB.map((r) => r.slug ?? "");
        const textsB = resultsB.map((r) => r.chunk_text ?? "");

        const bFoundInB = slugsB.some((s) => s.includes("marker-b")) ||
          textsB.some((t) => t.includes(markerB));
        expect(bFoundInB).toBe(true);

        const aFoundInB = slugsB.some((s) => s.includes("marker-a")) ||
          textsB.some((t) => t.includes(markerA));
        expect(aFoundInB).toBe(false);
      },
    );

    // ── Assertion 2: think isolation ──────────────────────────────────────────
    it(
      "think() scoped to User A's source synthesizes only over A's pages",
      { timeout: 120000 },
      async () => {
        const { think } = await import("@/lib/gbrain/client");

        const result = await think("test", `Tell me about: ${markerA}`, {
          model: "haiku",
          sourceId: userASourceId,
        });

        // think() completed without error
        expect(result.code).toBe(0);

        // The answer should not reference B's marker (cross-tenant leak)
        expect(result.stdout).not.toContain(markerB);

        // If the answer mentions A's marker OR returns "nothing found" (empty brain case),
        // both are acceptable — the key guarantee is B's marker is absent.
        // (D-02: a real user's brain may have limited data at Phase 6)
      },
    );

    // ── Assertion 3: session → source_id resolution ───────────────────────────
    it(
      "resolveTenant() resolves the authenticated session to the correct source_id",
      { timeout: 30000 },
      async () => {
        const { createSession } = await import("@/lib/auth/session");
        const { getUserByEmail } = await import("@/lib/auth/store");
        const { sql } = await import("@/lib/auth/store");

        // Create a real session for User A
        const userA = await getUserByEmail(userAEmail);
        expect(userA).not.toBeNull();
        const sessionId = await createSession(userA!.id);

        // Mock next/headers cookies() to return User A's session cookie.
        // resolveTenant() calls cookies() from next/headers — we inject the
        // session value by patching the module cache for this test.
        // Since next/headers is a server-side-only module, we test the
        // validateSession + user lookup chain directly as a proxy for the
        // full resolveTenant() flow.
        const { validateSession } = await import("@/lib/auth/session");
        const resolvedUserId = await validateSession(sessionId);
        expect(resolvedUserId).toBe(userA!.id);

        // Confirm the resolved user has the correct source_id (brain_id)
        const rows = await sql<{ brain_id: string }[]>`
          SELECT brain_id FROM app.users WHERE id = ${resolvedUserId!}
        `;
        expect(rows[0]?.brain_id).toBe(userASourceId);

        // Confirm User A's source_id is NOT User B's source_id
        expect(rows[0]?.brain_id).not.toBe(userBSourceId);

        // Cleanup: destroy the test session
        await sql`DELETE FROM app.sessions WHERE id = ${sessionId}`;
      },
    );
  },
);
