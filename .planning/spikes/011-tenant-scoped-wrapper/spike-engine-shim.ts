/**
 * Spike-only shim around lib/gbrain/engine.ts's createGBrainEngine.
 *
 * In production, tenant-scoped.ts imports:
 *   import { createGBrainEngine } from "@/lib/gbrain/engine";
 *
 * For the spike, we replicate the same pattern (single shared engine + configureGateway).
 * This keeps the spike independent of the production engine pool's lifecycle so
 * we can run + tear down cleanly.
 */

import {
  type BrainEngine,
  createEngine,
  configureGateway,
} from "../../../types/gbrain";

let _enginePromise: Promise<BrainEngine> | null = null;

export async function createGBrainEngine(_tenantId?: string): Promise<BrainEngine> {
  if (_enginePromise) return _enginePromise;

  const database_url =
    process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
  if (!database_url) throw new Error("SUPABASE_DB_URL_POOLER required for spike 011");

  await configureGateway({ env: { ...process.env } });

  const config = { engine: "postgres" as const, database_url };
  _enginePromise = createEngine(config).then(async (engine) => {
    await engine.connect(config);
    return engine;
  });
  return _enginePromise;
}

export async function disconnectSpikeEngine(): Promise<void> {
  if (!_enginePromise) return;
  const engine = await _enginePromise;
  await engine.disconnect();
  _enginePromise = null;
}
