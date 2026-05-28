# v2.0 Supabase Foundation (gbrain on Postgres + pool capacity)

## Requirements

- **gbrain runs on Supabase Postgres** (not PGLite). Engine config `{ engine: "postgres", database_url: SUPABASE_DB_URL_POOLER }`. The PGLite fast path is dev-only post-v2.0.
- **Connect via the Supavisor transaction pooler (port 6543), NOT the direct 5432 connection,** for app runtime. Direct 5432 is only for migrations / DDL (one-time `gbrain migrate --to supabase` per project).
- **The `database_url` must NOT live in `<brain>/.gbrain/config.json`** — gbrain writes the password in plaintext into config on `migrate`. Use `GBRAIN_DATABASE_URL` env var; keep config.json password-free.
- **gbrain's default `max: 10` connection pool is sufficient for v2.0** — no `GBRAIN_POOL_SIZE` tuning required at any realistic concurrency.
- **Every `engine.executeRaw` call MUST pass at least one $N parameter.** Parameterless calls hang indefinitely against Supavisor (statement_timeout doesn't fire because the query never reaches Postgres).
- **gbrain auto-enables RLS on every public table, but the role we connect as has `BYPASSRLS`.** RLS is defense-in-depth against the Supabase `anon` role only — it does NOT protect against in-app code paths that forget to scope. See `v20-multi-tenant-isolation.md` for the app-layer isolation primitive.

## How to Build It

### One-time migration from PGLite → Supabase

```bash
# 1. Provision free-tier Supabase project. Postgres 17+ with pgvector + pg_trgm
#    available. Pro tier ($25/mo) is recommended for zero-ops backups but is
#    NOT a technical requirement.

# 2. Migrate the brain (single resumable command, ~45s for 48 pages):
cp -r brains/seed brains/spike-supabase   # always work on a copy
export GBRAIN_HOME="$(pwd)/brains/spike-supabase"
gbrain migrate --to supabase --url "$SUPABASE_DB_URL_DIRECT"
gbrain doctor      # expect 90/100; RLS auto-enabled on 41/41 tables

# 3. Confirm hybrid search works against Postgres:
GBRAIN_DATABASE_URL="$SUPABASE_DB_URL_POOLER" gbrain query "what was weird about last month?"
```

### App runtime connection (the production code pattern)

Use `lib/gbrain/engine.ts`'s single-shared-engine pattern (proven correct under concurrent multi-tenant load):

```ts
function buildConfig() {
  const database_url =
    process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!database_url) throw new Error("GBRAIN_DATABASE_URL must be set");
  return { engine: "postgres" as const, database_url };
}

// ONE engine per Node process; reused across every tenant + every request
const enginePool = new Map<string, Promise<BrainEngine>>();

export async function createGBrainEngine(): Promise<BrainEngine> {
  if (enginePool.has("__shared__")) return enginePool.get("__shared__")!;

  // configureGateway MUST come before createEngine (mirrors CLI's connectEngine())
  await configureGateway({ env: { ...process.env } });

  const config = buildConfig();
  const enginePromise = createEngine(config).then((engine) =>
    engine.connect(config).then(() => engine),
  );
  enginePool.set("__shared__", enginePromise);
  return enginePromise;
}
```

### Concurrency expectations (measured)

| Concurrent SELECTs through single max:10 pool | Total ms | p50 | p99 | Errors |
|---:|---:|---:|---:|---:|
| 1 | 71 | 71 | 71 | 0 |
| 10 | 80 | 79 | 80 | 0 |
| 50 | 407 | 223 | 407 | 0 |
| 100 | 753 | 404 | 753 | 0 |
| **200** | **1897** | **841** | **1895** | **0** |

Clean M/M/c queue model with c=10. **No cliff, no failure cutoff** — just predictable queueing.

Inngest-shaped pattern (M jobs × 5 serial `step.run()` each, ~50ms per step):
| M concurrent jobs | Effective queries | Total ms |
|---:|---:|---:|
| 1 | 5 | 595 |
| 5 | 25 | 694 |
| **10** | **50** | **688** |

M=10 finishes in basically the same wall-clock as M=1 — the 10 jobs proceed in lockstep through their step chains.

### executeRaw call template

Every direct SQL site must include at least one parameter, even if it's a sentinel:

```ts
// SAFE
await engine.executeRaw(
  `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
  [sourceId, displayName, JSON.stringify(config)],
);

// SAFE — sentinel param even though logically parameterless
await engine.executeRaw(`SELECT $1::int = 1 AS healthy`, [1]);

// HANGS — parameterless
await engine.executeRaw(`SELECT 1`);
```

## What to Avoid

- **DO NOT use direct connection (5432) for app runtime.** Direct connections cap at ~60 backends per project and the gbrain pool isn't sized for them. Use the pooler (6543).
- **DO NOT raise `GBRAIN_POOL_SIZE` above 10 without measurement.** Higher pool size = more wire-side backends = closer to Supabase free-tier ceiling. The default absorbs N=200 cleanly.
- **DO NOT call `engine.executeRaw(template)` with no parameters.** Hangs forever; statement_timeout doesn't fire. Add a sentinel `$1`.
- **DO NOT trust gbrain's RLS to protect tenant isolation.** The role has BYPASSRLS. See `v20-multi-tenant-isolation.md`.
- **DO NOT commit `brains/<name>/.gbrain/config.json`** — `gbrain migrate` writes the password in plaintext into `database_url`. Either gitignore the brain dir or scrub the config before commit.
- **DO NOT pre-warm with scheduled Vercel functions for cold-start mitigation.** Cold tax is ~310ms; OpenAI embedding dominates both paths. See `v20-in-process-gbrain.md`.
- **DO NOT add a second database client.** PGLite owns the dev fast path; Supabase Postgres owns prod. No second client (no Drizzle, no Prisma, no separate postgres.js singleton).

## Constraints

- **Supabase free tier:** Postgres 17.6 + pgvector 0.8.0 + pg_trgm 1.6. Direct connection ~60 backend cap; Supavisor pooler much higher effective concurrency via backend recycling.
- **gbrain default pool:** `max: 10`, `idle_timeout: 20`, `connect_timeout: 10`, `prepare: false` (auto-detected on port 6543).
- **Migration is one-way at a time:** `gbrain migrate --to supabase` flips `config.json` `engine: postgres`; subsequent gbrain CLI commands on that brain dir hit Supabase, not the local PGLite file. PGLite source is preserved as a backup. `migrate --to pglite` reverses.
- **Hybrid search latency on Supabase pgvector:** ~6.5s for retrieval-only (no LLM synthesis) on a 48-page brain. In-process call typically 1.2-1.7s (different code path; see `v20-in-process-gbrain.md`).
- **Brain config gotcha:** `gbrain migrate --to supabase` writes the connection string with password plaintext into `<brain>/.gbrain/config.json` (`database_url` field). For deployed apps, the gbrain config must NOT carry the password — use `GBRAIN_DATABASE_URL` env var instead.

## Origin

Synthesized from spikes:
- **005** — `gbrain-on-supabase` (VALIDATED ✓): the one-time migration + free-tier viability proof.
- **008** — `inngest-supabase-pool` (VALIDATED ✓): N=200 / M=10 Inngest-shape concurrency, plus the parameterless-executeRaw-hangs finding.

Source files available in: `sources/005-gbrain-on-supabase/`, `sources/008-inngest-supabase-pool/`.

Related:
- `v20-in-process-gbrain.md` — the runtime read/write/perf patterns built on this foundation.
- `v20-multi-tenant-isolation.md` — the app-layer tenant isolation primitive (since RLS doesn't protect us).
