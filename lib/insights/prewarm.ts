import { SEED_TENANT_ID, FIXTURES_ROOT } from "../gbrain/paths.ts";
import { computeAndCache } from "./cache.ts";

/**
 * Singleton promise for the seed tenant pre-warm.
 * Stored at module scope to ensure idempotence across multiple imports
 * (e.g. Next.js dev-server HMR re-imports the same module instance).
 */
let _prewarmPromise: Promise<void> | undefined;

/**
 * Fill the in-process insight cache for the seed tenant.
 *
 * Idempotent: calling this multiple times returns the same promise.
 * Does NOT throw — pre-warm failure is non-fatal; the dashboard falls
 * back to computing on first request.
 *
 * Per D-Insight-Lifecycle: pre-warms ONLY the static insight bundle.
 * Never spawns gbrain.
 */
export function prewarmSeed(): Promise<void> {
  if (_prewarmPromise !== undefined) {
    return _prewarmPromise;
  }

  _prewarmPromise = (async () => {
    try {
      await computeAndCache(SEED_TENANT_ID, FIXTURES_ROOT);
      console.log("[insights] seed pre-warm complete");
    } catch (e) {
      console.warn(
        "[insights] seed pre-warm failed:",
        e instanceof Error ? e.message : String(e)
      );
      // Do not throw — dashboard still works without pre-warm
    }
  })();

  return _prewarmPromise;
}

// Auto-fire at module load: pre-warm runs once per server process.
// The void operator marks the unhandled promise as intentional.
void prewarmSeed();
