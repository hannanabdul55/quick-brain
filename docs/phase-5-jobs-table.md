# Phase 5: app.jobs Table — Design & Operation Reference

**Created:** Phase 5 Plan 03 (2026-05-22)
**Status:** LIVE — table exists in Supabase Postgres

## Overview

The `app.jobs` table is the app-owned job state surface for the background-job
execution path. It stores the lifecycle state (queued → running → done/error),
progress ticks, and result/error payloads for every background job submitted via
`POST /api/jobs`.

The table is in a separate `app` schema (not `public`) to hedge against gbrain's
auto-RLS event trigger (RESEARCH Pitfall 4), which activates on tables in the
`public` schema.

## Schema

```sql
CREATE SCHEMA IF NOT EXISTS app;

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
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON app.jobs (status);
```

## Column Reference

| Column       | Type        | Default              | Description |
|------------- |-------------|----------------------|-------------|
| `id`         | uuid        | gen_random_uuid()    | Unguessable capability token (122-bit, T-05-07) |
| `kind`       | text        | —                    | Job kind string, e.g. `"onboarding-import"` |
| `status`     | text        | `'queued'`           | Lifecycle: queued → running → done / error |
| `progress`   | integer     | 0                    | 0..100 percent complete |
| `stage`      | text        | NULL                 | Human-readable stage label |
| `params`     | jsonb       | `'{}'`               | Trigger payload (may contain PII — never logged) |
| `result`     | jsonb       | NULL                 | Operation return value (written on finishJob) |
| `error`      | text        | NULL                 | Sanitized error message (written on failJob; max 500 chars, no postgres:// URL) |
| `created_at` | timestamptz | now()                | Row creation timestamp |
| `updated_at` | timestamptz | now()                | Updated on every state transition |

## Lifecycle State Machine

```
queued → running → done
                 → error
```

| Transition           | Store function    | Fields updated                          |
|----------------------|-------------------|-----------------------------------------|
| Insert               | `createJob`       | kind, params, status='queued'           |
| Start execution      | `setRunning`      | status='running', updated_at            |
| Progress tick        | `updateProgress`  | progress, stage, updated_at             |
| Execution complete   | `finishJob`       | status='done', progress=100, result, updated_at |
| Execution failed     | `failJob`         | status='error', error (sanitized), updated_at |

## Security Properties

| Threat ID | Mitigation |
|-----------|-----------|
| T-05-05 | All SQL in `lib/jobs/store.ts` uses `postgres` tagged-template parameterization — no string concatenation. SQL injection via `params` is structurally blocked. |
| T-05-06 | `failJob` sanitizes `error` before storing: truncated to 500 chars, `postgres://` strings replaced with `[redacted]`. No raw stack trace or DB URL reaches `app.jobs.error`. |
| T-05-07 | `id` defaults to `gen_random_uuid()` (122-bit). A `jobId` acts as an unguessable capability token; enumeration is infeasible. Per-user scoping arrives in Phase 6. |
| T-05-08 | Table lives in `app` schema (not `public`). `scripts/setup-jobs-table.ts` performs an INSERT-then-SELECT from a fresh connection and `process.exit(1)` with a remediation hint if the row is not visible (gbrain auto-RLS trigger caught the table). Silent zero-rows failure is not possible. |

## Setup

Run the idempotent setup script against your Supabase project:

```bash
# Load environment variables
set -a && . ./.env.local && set +a

# Create schema, table, index; verify RLS visibility
bun scripts/setup-jobs-table.ts
```

Expected output:
```
[setup-jobs-table] Starting DDL setup...
[setup-jobs-table] Schema app: ready
[setup-jobs-table] Table app.jobs: ready
[setup-jobs-table] Index idx_jobs_status: ready
[setup-jobs-table] Running RLS-visibility check...
[setup-jobs-table] Probe row inserted: id=<uuid>
[setup-jobs-table] Probe row deleted
[setup-jobs-table] jobs table ready / row visible — setup complete.
```

If the visibility check fails (`process.exit(1)`), the script prints remediation options:
1. Add an explicit allow-all RLS policy for the app's connection role
2. `ALTER TABLE app.jobs DISABLE ROW LEVEL SECURITY` (if using a trusted service role)
3. Verify gbrain's auto-RLS trigger does not target the `app` schema

## Access Pattern

`lib/jobs/store.ts` owns all SQL against `app.jobs`. It creates a single module-level
`postgres` client singleton with `{ prepare: false }` (mandatory for Supavisor pooler
port 6543). No other module should query `app.jobs` directly.

## Verified Round-Trip (Phase 5 Plan 03)

The full lifecycle was verified manually against the Supabase `app.jobs` table:

```
createJob("onboarding-import", { tenantId: "seed" })
  → id: <uuid>, status: "queued", progress: 0

setRunning(<id>)
  → status: "running"

updateProgress(<id>, { stage: "Indexing for search", percent: 60 })
  → progress: 60, stage: "Indexing for search"

finishJob(<id>, { tenantId: "seed" })
  → status: "done", progress: 100, result: { tenantId: "seed" }

getJob(<id>)
  → full row

getJob("00000000-0000-0000-0000-000000000000")
  → null
```

## Phase 7 Extension

Phase 7 (QuickBooks Online Ingest) adds `"qbo-ingest"` as a second `JobKind`.
Changes required:
1. Add `"qbo-ingest"` to `JobKind` in `lib/jobs/types.ts`
2. Add `"qbo-ingest"` to the `z.enum` in `lib/jobs/schemas.ts`
3. Add the QBO ingest operation to `JOB_REGISTRY` in `lib/jobs/registry.ts`

No schema migration needed — the `app.jobs` table is kind-agnostic (kind is a `text`
column, not a constraint-checked enum). Adding a new kind is a pure application-layer change.
