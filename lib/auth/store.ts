/**
 * lib/auth/store.ts — Supabase Postgres auth CRUD via the postgres package.
 *
 * Creates ONE module-level sql singleton with prepare:false (mandatory for the
 * Supavisor pooler on port 6543). All SQL uses postgres tagged-template
 * parameterization — never string concatenation (T-06-01 / SQL injection prevention).
 *
 * All table references are in the `app` schema (not `public`) — hedges against
 * gbrain's auto-RLS event trigger (RESEARCH Pitfall 4 / T-06-04).
 *
 * Security:
 *   T-06-01: Tagged-template ${value} interpolation — no SQL injection via params
 *   T-06-02: Error messages sanitized: slice(0, 500) + strip postgres:// URLs before any log
 *   T-06-03: Session id is node:crypto randomUUID (122-bit, unguessable) — in session.ts
 *   T-06-04: Tables in app schema, not public — clear of gbrain auto-RLS trigger
 *   T-06-05: magic_links.used_at records consume time; atomic UPDATE prevents double-consume
 *
 * Analog: lib/jobs/store.ts (the exact structural analog — same singleton, same
 * prepare:false, same parameterized SQL, same app schema, same no-row guard).
 *
 * `postgres` is a gbrain transitive dependency — already in node_modules,
 * already force-bundled via next.config.ts outputFileTracingIncludes. NO bun add.
 */

import postgres from "postgres";

// ---------------------------------------------------------------------------
// Module-level singleton (one persistent connection, not per-request throwaway)
// Mirrors lib/jobs/store.ts singleton precedent exactly.
// URL resolution: exact fallback chain from lib/health/probes.ts / lib/jobs/store.ts
// ---------------------------------------------------------------------------
const databaseUrl =
  process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
if (!databaseUrl) {
  throw new Error(
    "lib/auth/store.ts: GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set",
  );
}

export const sql = postgres(databaseUrl, {
  // prepare:false is MANDATORY — port 6543 is Supavisor pooler, not direct Postgres.
  // lib/jobs/store.ts does this too; probes.ts line 104 sets the same.
  prepare: false,
});

// ---------------------------------------------------------------------------
// Row types (reflect the app.* schema from setup-auth-tables.ts DDL)
// ---------------------------------------------------------------------------

export type UserRow = {
  id: string;
  email: string;
  brain_id: string;
  brain_slug: string;
  qbo_realm_id: string | null;
  qbo_tokens_encrypted: string | null;
  created_at: Date;
};

export type SessionRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  created_at: Date;
};

export type MagicLinkRow = {
  jti: string;
  email: string;
  used: boolean;
  used_at: Date | null;
  expires_at: Date;
  created_at: Date;
};

// ---------------------------------------------------------------------------
// CRUD exports — app.users
// ---------------------------------------------------------------------------

/**
 * Fetch a user row by email address.
 *
 * Returns null if no matching row exists (new user → first sign-in).
 * Security: never log the email argument (T-06-02).
 */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
    SELECT * FROM app.users WHERE email = ${email}
  `;
  return rows[0] ?? null;
}

/**
 * Insert a new user row and return the created row.
 *
 * Throws if the INSERT returns no row (should not happen with a valid DB connection
 * and schema, but mirrors the no-row guard pattern from lib/jobs/store.ts).
 *
 * @param args.email     - The user's email address (unique)
 * @param args.brainId   - The gbrain source_id for this user's brain (unique, ≤32 chars)
 * @param args.brainSlug - Human-readable dashboard URL slug
 */
export async function createUser(args: {
  email: string;
  brainId: string;
  brainSlug: string;
}): Promise<UserRow> {
  const rows = await sql<UserRow[]>`
    INSERT INTO app.users (email, brain_id, brain_slug)
    VALUES (${args.email}, ${args.brainId}, ${args.brainSlug})
    RETURNING *
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("createUser: INSERT returned no row");
  }
  return row;
}

// ---------------------------------------------------------------------------
// CRUD exports — app.magic_links
// ---------------------------------------------------------------------------

/**
 * Insert a magic-link record. Called by the send-link route after issuing the JWT.
 *
 * @param args.jti       - The JWT id (jti claim) from the magic-link token
 * @param args.email     - The target email address
 * @param args.expiresAt - Token expiry (15 minutes from issue, D-07)
 */
export async function recordMagicLink(args: {
  jti: string;
  email: string;
  expiresAt: Date;
}): Promise<void> {
  await sql`
    INSERT INTO app.magic_links (jti, email, expires_at)
    VALUES (${args.jti}, ${args.email}, ${args.expiresAt})
  `;
}

/**
 * Atomically consume a magic-link token (D-07: single-use, no TOCTOU).
 *
 * Uses a single UPDATE ... WHERE used = false AND expires_at > now() to both
 * check and consume the token in one atomic operation. Never SELECT-then-UPDATE
 * — two concurrent clicks would both pass a SELECT check (TOCTOU race).
 *
 * @param jti - The JWT id from the verified magic-link token
 * @returns   - The email associated with the token (rows.count === 1), or null
 *              when count === 0 (token already used, expired, or not found)
 *
 * Security: T-06-05 — used_at records consume time; .count check prevents double-consume
 */
export async function consumeMagicLink(jti: string): Promise<string | null> {
  const rows = await sql<{ email: string }[]>`
    UPDATE app.magic_links
    SET used = true, used_at = now()
    WHERE jti = ${jti}
      AND used = false
      AND expires_at > now()
    RETURNING email
  `;
  if (rows.count === 0) {
    // already used, expired, or not found — show link-used page with resend path
    return null;
  }
  return rows[0]!.email;
}

/**
 * DB-backed rate-limit check (D-09 / AUTH-09): 1 magic-link per email per 60s.
 *
 * Returns true if a magic_links row for this email was created within the last
 * 60 seconds — the send-link route must reject with 429 when this returns true.
 *
 * DB-backed (not in-memory) so it survives serverless cold starts and multiple
 * Vercel instances (RESEARCH anti-pattern: "In-memory rate-limit Map").
 *
 * Security: never log the email argument (T-06-02).
 */
export async function wasRecentlyRequested(email: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM app.magic_links
    WHERE email = ${email}
      AND created_at > now() - interval '60 seconds'
    LIMIT 1
  `;
  return rows.count > 0;
}
