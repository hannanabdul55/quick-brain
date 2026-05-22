/**
 * lib/jobs/store.ts — Supabase Postgres job-row CRUD via the postgres package.
 *
 * Creates ONE module-level sql singleton with prepare:false (mandatory for the
 * Supavisor pooler on port 6543). All SQL uses postgres tagged-template
 * parameterization — never string concatenation (T-05-05 / SQL injection prevention).
 *
 * All table references are app.jobs (separate app schema, not public —
 * hedges against gbrain's auto-RLS event trigger, RESEARCH Pitfall 4 / T-05-08).
 *
 * Security:
 *   T-05-05: Tagged-template ${value} interpolation — no SQL injection via params
 *   T-05-06: failJob sanitizes error before storing: slice(0, 500) + strip postgres:// URLs
 *   T-05-07: id defaults to gen_random_uuid() (created by DDL in setup-jobs-table.ts)
 *
 * Analog: lib/health/probes.ts (the ONLY existing app-level postgres consumer —
 * same import, URL resolution, and parameterized SQL pattern).
 *
 * `postgres` is a gbrain transitive dependency — already in node_modules,
 * already force-bundled via next.config.ts outputFileTracingIncludes. NO bun add.
 */

import postgres from "postgres";
import type { JobKind, JobProgress, JobStatus } from "./types";

// ---------------------------------------------------------------------------
// Module-level singleton (one persistent connection, not per-request throwaway)
// Mirrors engine.ts singleton precedent.
// URL resolution: exact fallback chain from lib/health/probes.ts / engine.ts buildConfig()
// ---------------------------------------------------------------------------
const sql = postgres(
  (process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER) as string,
  {
    // prepare:false is MANDATORY — port 6543 is Supavisor pooler, not direct Postgres.
    // gbrain's db.ts does this too; probes.ts line 104 sets the same.
    prepare: false,
  },
);

// ---------------------------------------------------------------------------
// Row type (reflects the app.jobs schema from setup-jobs-table.ts)
// ---------------------------------------------------------------------------
export type JobRow = {
  id: string;
  kind: string;
  status: JobStatus;
  progress: number;
  stage: string | null;
  params: Record<string, unknown>;
  result: unknown | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
};

// ---------------------------------------------------------------------------
// CRUD exports
// ---------------------------------------------------------------------------

/**
 * Create a new job row in app.jobs with status='queued'.
 *
 * @param kind   - The job kind (must be a valid JobKind)
 * @param params - Arbitrary params (written as JSONB; may contain PII — never log)
 * @returns      - The new job's uuid id (unguessable — gen_random_uuid() default)
 */
export async function createJob(
  kind: JobKind,
  params: Record<string, unknown>,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await sql<{ id: string }[]>`
    INSERT INTO app.jobs (kind, params)
    VALUES (${kind}, ${sql.json(params as any)})
    RETURNING id
  `;
  const row = rows[0];
  if (!row) {
    throw new Error(`createJob: INSERT returned no row for kind=${kind}`);
  }
  return row.id;
}

/**
 * Mark a job as running (status='running').
 * Called by the Inngest function immediately after it receives the event.
 */
export async function setRunning(jobId: string): Promise<void> {
  await sql`
    UPDATE app.jobs
    SET status = 'running', updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Update the job's progress (percent 0..100) and stage label.
 * Called by the Inngest function on each JobOperation progress tick.
 * NOT wrapped in step.run — progress writes are NOT memoized/replayed.
 */
export async function updateProgress(
  jobId: string,
  p: JobProgress,
): Promise<void> {
  await sql`
    UPDATE app.jobs
    SET progress = ${p.percent}, stage = ${p.stage}, updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Mark a job as done (status='done', progress=100, result stored as JSONB).
 * Called by the Inngest function after the JobOperation resolves.
 *
 * @param result - The operation's return value (stored as JSONB in app.jobs.result)
 */
export async function finishJob(
  jobId: string,
  result: unknown,
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await sql`
    UPDATE app.jobs
    SET status = 'done', progress = 100, result = ${sql.json(result as any)},
        updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Mark a job as failed (status='error', sanitized error text stored).
 *
 * Security (T-05-06): error is sanitized before storing:
 *   - Sliced to 500 chars (matches chat/route.ts stderr ceiling)
 *   - postgres:// connection strings stripped (never stored or returned to browser)
 *
 * @param error - Raw error message (stack trace, exception message, etc.)
 */
export async function failJob(
  jobId: string,
  error: string,
): Promise<void> {
  // Sanitize before storing: truncate + strip connection strings
  const sanitized = error
    .slice(0, 500)
    .replace(/postgres:\/\/[^\s]+/gi, "[redacted]");

  await sql`
    UPDATE app.jobs
    SET status = 'error', error = ${sanitized}, updated_at = now()
    WHERE id = ${jobId}
  `;
}

/**
 * Fetch a single job row by id.
 *
 * @param jobId - The job's uuid id
 * @returns     - The job row, or null if no job with that id exists
 */
export async function getJob(jobId: string): Promise<JobRow | null> {
  const rows = await sql<JobRow[]>`
    SELECT * FROM app.jobs WHERE id = ${jobId}
  `;
  return rows[0] ?? null;
}
