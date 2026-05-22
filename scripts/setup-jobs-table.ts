#!/usr/bin/env bun
/**
 * scripts/setup-jobs-table.ts — Idempotent DDL for the app.jobs table.
 *
 * Creates the `app` schema and `app.jobs` table in Supabase Postgres if they
 * do not already exist. Then verifies the app's connection can read its own
 * rows (INSERT-then-SELECT from a fresh connection).
 *
 * The `app` schema is the primary hedge against gbrain's auto-RLS event
 * trigger, which targets public tables (RESEARCH Pitfall 4 / A4). Creating
 * app.jobs outside the `public` schema avoids the trigger. The visibility
 * check catches the "silent zero rows" failure if the trigger still fires.
 *
 * Security:
 *   - T-05-07: id defaults to gen_random_uuid() (122-bit) — unguessable capability token.
 *   - T-05-08: Separate `app` schema + visibility check — RLS trigger failure cannot
 *     pass silently.
 *
 * Usage:
 *   # Load env vars first (SUPABASE_DB_URL_POOLER or GBRAIN_DATABASE_URL)
 *   set -a && . ./.env.local && set +a
 *   bun scripts/setup-jobs-table.ts
 *
 * Exit codes:
 *   0 — table created/exists; visibility check passed; probe row cleaned up.
 *   1 — connection failed, DDL failed, or visibility check failed.
 */

import postgres from "postgres";

// ── URL resolution — exact fallback chain from lib/health/probes.ts ────────────
const database_url =
  process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;

if (!database_url) {
  console.error(
    "ERROR: GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set",
  );
  process.exit(1);
}

// ── Connections ────────────────────────────────────────────────────────────────
// Connection 1: DDL + INSERT (main)
// Connection 2: fresh connection for the SELECT visibility check (Pitfall 4)
// Both use prepare:false — mandatory for the Supavisor pooler on port 6543.
// database_url is guaranteed non-undefined — validated above (process.exit(1) on falsy)
const DB_URL: string = database_url;
const sql = postgres(DB_URL, { prepare: false });

async function main(): Promise<void> {
  console.log("[setup-jobs-table] Starting DDL setup...");

  // ── Step 1: Create the app schema ──────────────────────────────────────────
  await sql`CREATE SCHEMA IF NOT EXISTS app`;
  console.log("[setup-jobs-table] Schema app: ready");

  // ── Step 2: Create the app.jobs table ──────────────────────────────────────
  // Columns:
  //   id          — uuid, gen_random_uuid() default (T-05-07: unguessable)
  //   kind        — job kind string (e.g. "onboarding-import")
  //   status      — lifecycle: queued | running | done | error
  //   progress    — 0..100 integer percent
  //   stage       — human-readable stage label (nullable)
  //   params      — jsonb, the trigger payload (PII — never logged, see jobs/route.ts)
  //   result      — jsonb, the operation return value (stored on finishJob)
  //   error       — text, sanitized error message (stored on failJob, max 500 chars)
  //   created_at  — timestamptz, immutable
  //   updated_at  — timestamptz, bumped on every state change
  await sql`
    CREATE TABLE IF NOT EXISTS app.jobs (
      id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      kind        text        NOT NULL,
      status      text        NOT NULL DEFAULT 'queued',
      progress    integer     NOT NULL DEFAULT 0,
      stage       text,
      params      jsonb       NOT NULL DEFAULT '{}'::jsonb,
      result      jsonb,
      error       text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("[setup-jobs-table] Table app.jobs: ready");

  // ── Step 3: Create index on status for efficient polling queries ────────────
  await sql`CREATE INDEX IF NOT EXISTS idx_jobs_status ON app.jobs (status)`;
  console.log("[setup-jobs-table] Index idx_jobs_status: ready");

  // ── Step 4: RLS-visibility check (Pitfall 4 / T-05-08) ─────────────────────
  // INSERT a probe row, then SELECT it back from a SEPARATE fresh connection.
  // If the SELECT returns zero rows, gbrain's auto-RLS trigger caught app.jobs
  // despite the separate schema — fail loudly with a remediation hint.
  console.log("[setup-jobs-table] Running RLS-visibility check...");

  // 4a. Insert probe row via the main connection
  const insertResult = await sql<{ id: string }[]>`
    INSERT INTO app.jobs (kind, params)
    VALUES ('__setup_probe__', '{"_probe": true}'::jsonb)
    RETURNING id
  `;
  const probeRow = insertResult[0];
  if (!probeRow) {
    console.error("[setup-jobs-table] FATAL: probe INSERT returned no row");
    process.exit(1);
  }
  const probeId = probeRow.id;
  console.log(`[setup-jobs-table] Probe row inserted: id=${probeId}`);

  // 4b. Open a fresh connection and SELECT the probe row back
  const sqlFresh = postgres(DB_URL, { prepare: false, max: 1 });
  let visibilityPassed = false;
  try {
    const rows = await sqlFresh<{ id: string }[]>`
      SELECT id FROM app.jobs WHERE id = ${probeId}
    `;
    visibilityPassed = rows.length > 0;
  } finally {
    await sqlFresh.end({ timeout: 5 });
  }

  if (!visibilityPassed) {
    // Clean up probe row before failing so the script is idempotent on re-run
    await sql`DELETE FROM app.jobs WHERE id = ${probeId}`;
    console.error(
      "[setup-jobs-table] FATAL: RLS-visibility check FAILED — " +
        "the INSERT row is not visible from a fresh connection.\n" +
        "Remediation options:\n" +
        "  1. Add an explicit allow-all RLS policy for the app's connection role:\n" +
        "       ALTER TABLE app.jobs ENABLE ROW LEVEL SECURITY;\n" +
        "       CREATE POLICY allow_all ON app.jobs USING (true) WITH CHECK (true);\n" +
        "  2. If the connection uses a trusted service role:\n" +
        "       ALTER TABLE app.jobs DISABLE ROW LEVEL SECURITY;\n" +
        "  3. Verify gbrain's auto-RLS trigger does not target the `app` schema.",
    );
    process.exit(1);
  }

  // 4c. Clean up probe row
  await sql`DELETE FROM app.jobs WHERE id = ${probeId}`;
  console.log("[setup-jobs-table] Probe row deleted");

  console.log(
    "[setup-jobs-table] jobs table ready / row visible — setup complete.",
  );
}

main()
  .catch((err) => {
    // Never echo the DB URL or a raw connection error that might contain it
    const msg = err instanceof Error ? err.message : String(err);
    const safe = msg.replace(/postgres:\/\/[^\s]+/gi, "[redacted]");
    console.error("[setup-jobs-table] FATAL:", safe);
    process.exit(1);
  })
  .finally(() => {
    // Always close the main connection
    sql.end({ timeout: 5 }).catch(() => {});
  });
