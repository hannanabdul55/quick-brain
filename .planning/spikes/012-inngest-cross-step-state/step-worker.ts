/**
 * Spike 012 step-worker.
 *
 * Simulates ONE Inngest step.run() boundary by running in a fresh process
 * (mirroring Inngest's production "each step = separate HTTP request" model,
 * which on Vercel means a fresh Fluid Compute invocation by default).
 *
 * Modes:
 *   STEP=connect    — just createEngine + connect + getStats (no gbrain work)
 *   STEP=insert     — createEngine + executeRaw INSERT (no embedding)
 *   STEP=ingest     — createEngine + importFromContent (incl. OpenAI embedding)
 *   STEP=all-in-one — createEngine + INSERT source + 3 importFromContent calls
 *                     (the "consolidated single step.run('execute')" pattern
 *                     that Phase 5's runJob already uses)
 *
 * Output: one JSON line on stdout with per-phase timings + engine instance fingerprint.
 *
 * Why fingerprint the engine? To prove that across spawn'd processes, gbrain
 * always creates a fresh engine (no module-state persistence). Production behavior
 * mirrors this: Inngest's separate HTTP requests may or may not hit the same
 * warm Vercel instance, but the worst case is that they don't, and that's what
 * this simulation measures.
 */

const t0 = Date.now();
const marks: Record<string, number> = {};
const mark = (k: string) => { marks[k] = Date.now() - t0; };

async function loadGbrain(subpath: string): Promise<any> {
  return import(/* @vite-ignore */ "gbrain/" + subpath);
}

const STEP = process.env.STEP ?? "connect";
const TENANT = process.env.TENANT_ID ?? "spike-012-tenant";
const RUN_ID = process.env.RUN_ID ?? String(Date.now());

async function buildEngine() {
  mark("script_start");
  const dbUrl = process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!dbUrl) {
    console.error(JSON.stringify({ error: "missing SUPABASE_DB_URL_POOLER" }));
    process.exit(1);
  }

  const gateway = await loadGbrain("ai/gateway");
  mark("gateway_loaded");
  await gateway.configureGateway({ env: { ...process.env } });
  mark("gateway_configured");

  const ef = await loadGbrain("engine-factory");
  const cfg = { engine: "postgres" as const, database_url: dbUrl };
  const engine = await ef.createEngine(cfg);
  mark("engine_created");
  await engine.connect(cfg);
  mark("engine_connected");

  // Use Node's process.pid + a Date.now() as the "engine fingerprint" — two
  // step invocations that hit the same warm instance would share PID; fresh
  // instances have different PIDs. This is the cheap proxy for "is the
  // enginePool the same Map across these invocations?" without needing a
  // long-lived process.
  return { engine, fingerprint: `${process.pid}-${process.platform}` };
}

async function ingestOnce(engine: any, slug: string, marker: string) {
  const im = await loadGbrain("import-file");
  return im.importFromContent(
    engine,
    slug,
    `---
type: bill
vendor: spike-012-vendor
date: "2026-05-31"
amount: 100.00
currency: USD
---

Bill for ${marker}. Spike 012 step worker.`,
    { sourceId: TENANT, forceRechunk: true },
  );
}

async function main() {
  const { engine, fingerprint } = await buildEngine();

  let work: unknown = null;
  if (STEP === "connect") {
    work = await engine.getStats();
    mark("work_done");
  } else if (STEP === "insert") {
    await engine.executeRaw(
      `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
      [TENANT, TENANT, JSON.stringify({ kind: "spike-012" })],
    );
    work = "source-inserted";
    mark("work_done");
  } else if (STEP === "ingest") {
    work = await ingestOnce(engine, `originals/spike-012-${RUN_ID}-${process.pid}`, `pid-${process.pid}`);
    mark("work_done");
  } else if (STEP === "all-in-one") {
    // Simulates the "one big step.run('execute')" pattern: register source +
    // 3 ingest calls all in one process invocation (engine reused warm).
    await engine.executeRaw(
      `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
      [TENANT, TENANT, JSON.stringify({ kind: "spike-012" })],
    );
    mark("source_inserted");
    const r1 = await ingestOnce(engine, `originals/spike-012-${RUN_ID}-page-1`, "page-1");
    mark("ingest_1_done");
    const r2 = await ingestOnce(engine, `originals/spike-012-${RUN_ID}-page-2`, "page-2");
    mark("ingest_2_done");
    const r3 = await ingestOnce(engine, `originals/spike-012-${RUN_ID}-page-3`, "page-3");
    mark("ingest_3_done");
    work = { r1, r2, r3 };
  } else if (STEP === "cleanup") {
    await engine.executeRaw(`DELETE FROM sources WHERE id = $1`, [TENANT]);
    work = "cascade-deleted";
    mark("work_done");
  }

  await engine.disconnect();
  mark("disconnected");

  console.log(JSON.stringify({
    step: STEP,
    fingerprint,
    totalMs: Date.now() - t0,
    marks,
    phases: {
      gateway_load_ms: marks.gateway_loaded - marks.script_start,
      gateway_configure_ms: marks.gateway_configured - marks.gateway_loaded,
      engine_create_ms: marks.engine_created - marks.gateway_configured,
      engine_connect_ms: marks.engine_connected - marks.engine_created,
      work_ms: (marks.work_done ?? marks.ingest_3_done) - marks.engine_connected,
    },
    work,
  }));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ step: STEP, error: String(err?.message ?? err), stack: err?.stack?.split("\n").slice(0, 3) }));
  process.exit(1);
});

export {};
