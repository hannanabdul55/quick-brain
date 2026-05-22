/**
 * lib/auth/resolve-tenant.ts — THE single session→source_id isolation chokepoint.
 *
 * D-11: Cross-tenant isolation is application-enforced via per-user source_id
 * partitioning. This module is the single place where an authenticated session
 * cookie becomes a verified (userId, sourceId, brainSlug) triple.
 *
 * NO route handler or lib/gbrain function may accept a source_id / tenant id
 * as an argument from request input. Tenant identity comes ONLY from the verified
 * session resolved here.
 *
 * Pattern: mirrors lib/gbrain/slug.ts::assertTenantSlug's assert-or-return shape —
 * a tight module that returns a discriminated union result rather than throwing,
 * so callers can redirect/401 without catching.
 *
 * Security:
 *   T-06-14: source_id is NEVER accepted from request input. provisionBrain is
 *   the only sources writer; the source id is generated server-side only.
 *   T-06-15: session fixation prevention — only validated session IDs (opaque
 *   UUIDs, 122-bit) are accepted here.
 */

import { cookies } from "next/headers";
import { validateSession } from "./session";
import { getUserByEmail } from "./store";
import { sql } from "./store";

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type TenantContext =
  | { authenticated: true; userId: string; sourceId: string; brainSlug: string }
  | { authenticated: false };

// ---------------------------------------------------------------------------
// resolveTenant — the chokepoint
// ---------------------------------------------------------------------------

/**
 * Resolve the authenticated tenant context from the qb_session cookie.
 *
 * This function takes NO arguments. Tenant identity is derived solely from the
 * verified session cookie — never from URL params, query strings, or request body.
 *
 * Flow:
 *   1. Read the qb_session cookie via next/headers cookies()
 *   2. If missing → unauthenticated sentinel
 *   3. validateSession(cookieValue) → user_id | null
 *   4. If null (expired/missing session) → unauthenticated sentinel
 *   5. SELECT app.users WHERE id = user_id → UserRow | null
 *   6. If null (deleted user) → unauthenticated sentinel
 *   7. Return { authenticated: true, userId, sourceId: brain_id, brainSlug: brain_slug }
 *
 * @returns TenantContext — discriminated union; callers check authenticated: true
 */
export async function resolveTenant(): Promise<TenantContext> {
  // Step 1: Read the session cookie
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("qb_session");

  if (!sessionCookie?.value) {
    return { authenticated: false };
  }

  // Step 2: Validate the session (DB lookup — T-06-15 session fixation prevention)
  const userId = await validateSession(sessionCookie.value);
  if (!userId) {
    return { authenticated: false };
  }

  // Step 3: Resolve the user's brain from app.users
  const rows = await sql<
    { id: string; brain_id: string; brain_slug: string }[]
  >`
    SELECT id, brain_id, brain_slug FROM app.users WHERE id = ${userId}
  `;
  const user = rows[0];
  if (!user) {
    // User row deleted after session was created (should not happen in normal flow)
    return { authenticated: false };
  }

  return {
    authenticated: true,
    userId: user.id,
    sourceId: user.brain_id,
    brainSlug: user.brain_slug,
  };
}
