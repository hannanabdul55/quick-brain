/**
 * Spike 009 cold-probe: measures the (Bun init + gbrain import + gateway
 * config + Supabase connect + first hybridSearch) latency on a fresh
 * process. Run repeatedly via the runner — each invocation is a "cold"
 * Vercel Fluid Compute instance for measurement purposes.
 *
 * Emits one JSON line on stdout with phase timings.
 */

const t0 = Date.now();
const stages: Record<string, number> = {};
const mark = (k: string) => { stages[k] = Date.now() - t0; };

async function loadGbrain(subpath: string): Promise<any> {
  return import(/* @vite-ignore */ "gbrain/" + subpath);
}

async function main() {
  mark("script_start");

  const dbUrl = process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!dbUrl || !process.env.OPENAI_API_KEY) {
    console.error(JSON.stringify({ error: "missing env" }));
    process.exit(1);
  }

  const gateway = await loadGbrain("ai/gateway");
  mark("loaded_gateway_module");
  await gateway.configureGateway({ env: { ...process.env } });
  mark("gateway_configured");

  const ef = await loadGbrain("engine-factory");
  mark("loaded_engine_factory");

  const cfg = { engine: "postgres" as const, database_url: dbUrl };
  const engine = await ef.createEngine(cfg);
  mark("engine_created");
  await engine.connect(cfg);
  mark("engine_connected_first_query_done");

  const hs = await loadGbrain("search/hybrid");
  mark("loaded_hybrid_module");

  const results = await hs.hybridSearch(engine, "what is interesting", { sourceId: "default", limit: 3 });
  mark("first_hybrid_search_done");

  // Warm-path measurement: same engine, second query
  await hs.hybridSearch(engine, "another query", { sourceId: "default", limit: 3 });
  mark("warm_hybrid_search_done");

  await engine.disconnect();
  mark("disconnected");

  // Compute deltas
  const phases = {
    bun_to_load_gbrain_ms: stages.loaded_gateway_module - stages.script_start,
    configure_gateway_ms: stages.gateway_configured - stages.loaded_gateway_module,
    load_engine_factory_ms: stages.loaded_engine_factory - stages.gateway_configured,
    create_engine_ms: stages.engine_created - stages.loaded_engine_factory,
    connect_engine_ms: stages.engine_connected_first_query_done - stages.engine_created,
    load_hybrid_module_ms: stages.loaded_hybrid_module - stages.engine_connected_first_query_done,
    first_search_ms: stages.first_hybrid_search_done - stages.loaded_hybrid_module,
    warm_search_ms: stages.warm_hybrid_search_done - stages.first_hybrid_search_done,
    disconnect_ms: stages.disconnected - stages.warm_hybrid_search_done,
  };

  const totalColdMs = stages.first_hybrid_search_done;
  const totalWarmMs = stages.warm_hybrid_search_done - stages.first_hybrid_search_done;

  console.log(JSON.stringify({
    totalColdMs,
    totalWarmMs,
    resultCount: results.length,
    phases,
    raw: stages,
  }));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: String(err?.message ?? err) }));
  process.exit(1);
});

export {};
