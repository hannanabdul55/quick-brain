/**
 * lib/gbrain/tenants.ts — Postgres-backed tenant registry.
 *
 * Replaces the in-memory Map + readdir(BRAINS_ROOT) filesystem registry (D-01).
 * The app.users table IS the registry — user row holds brain_id (source_id)
 * and brain_slug. No filesystem scan; no shared in-memory Map.
 *
 * Uses the shared `sql` singleton from lib/auth/store.ts — one connection pool,
 * no second postgres() client constructed here.
 *
 * Functions:
 *   - getBySlug(brainSlug)    → TenantRecord | null  (dashboard page lookup)
 *   - getBySourceId(sourceId) → TenantRecord | null  (engine call lookup)
 *   - list()                  → TenantRecord[]       (admin/debug)
 *   - isSeed(tenantId)        → boolean              (seed guard for AUTH_ENABLED=0)
 *
 * init() and reload() are removed — there is no disk scan to perform.
 * Callers that called init() can remove the call (it was a no-op initialization
 * barrier; Postgres queries run on demand without a warm-up step).
 *
 * Security:
 *   T-06-21: no shared in-memory Map rebuilt from disk scan — no cross-tenant
 *   row leakage from a stale filesystem state.
 *
 * Analog: lib/jobs/store.ts (exact — Postgres-backed CRUD via shared sql singleton,
 * tagged-template parameterization, SELECT row|null pattern).
 */

import { sql } from "@/lib/auth/store";
import { SEED_TENANT_ID } from "./paths.ts";

// ---------------------------------------------------------------------------
// TenantRecord — shape kept compatible with callers; filesystem fields removed
// ---------------------------------------------------------------------------

export type TenantStatus = "ready";

export type TenantRecord = {
  /** Brain slug (URL-safe, ≤40 chars) — used as the dashboard URL segment */
  id: string;
  /** gbrain source_id (u-<14hex> format, ≤32 chars) */
  sourceId: string;
  /** User's email address */
  email: string;
  /** Always "ready" — Postgres-backed tenants are live by definition */
  status: TenantStatus;
};

// ---------------------------------------------------------------------------
// Registry queries — SELECT app.users via shared sql singleton
// ---------------------------------------------------------------------------

/**
 * Look up a tenant by their brain_slug (the dashboard URL segment).
 *
 * Used by the dashboard page to verify the URL slug matches the session-resolved
 * tenant. Returns null when no matching user row exists.
 */
export async function getBySlug(brainSlug: string): Promise<TenantRecord | null> {
  const rows = await sql<
    { id: string; email: string; brain_id: string; brain_slug: string }[]
  >`
    SELECT id, email, brain_id, brain_slug
    FROM app.users
    WHERE brain_slug = ${brainSlug}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.brain_slug,
    sourceId: row.brain_id,
    email: row.email,
    status: "ready",
  };
}

/**
 * Look up a tenant by their brain_id / source_id (gbrain sources table key).
 *
 * Used when the engine needs the TenantRecord given a session-resolved sourceId.
 * Returns null when no matching user row exists.
 */
export async function getBySourceId(sourceId: string): Promise<TenantRecord | null> {
  const rows = await sql<
    { id: string; email: string; brain_id: string; brain_slug: string }[]
  >`
    SELECT id, email, brain_id, brain_slug
    FROM app.users
    WHERE brain_id = ${sourceId}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.brain_slug,
    sourceId: row.brain_id,
    email: row.email,
    status: "ready",
  };
}

/**
 * List all tenants (admin/debug use — SELECT all users rows).
 *
 * Ordered by created_at ascending for deterministic output.
 */
export async function list(): Promise<TenantRecord[]> {
  const rows = await sql<
    { id: string; email: string; brain_id: string; brain_slug: string }[]
  >`
    SELECT id, email, brain_id, brain_slug
    FROM app.users
    ORDER BY created_at ASC
  `;
  return rows.map((row) => ({
    id: row.brain_slug,
    sourceId: row.brain_id,
    email: row.email,
    status: "ready" as TenantStatus,
  }));
}

/**
 * Returns true if this tenantId matches the seed tenant (used with AUTH_ENABLED=0
 * dev bypass — the seed tenant is still reachable, D-03).
 */
export function isSeed(tenantId: string): boolean {
  return tenantId === SEED_TENANT_ID;
}
