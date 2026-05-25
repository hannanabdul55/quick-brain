/**
 * lib/auth/provision.ts — Per-user empty brain provisioning.
 *
 * Provisioning a new user brain = a single idempotent INSERT into gbrain's
 * `sources` table. No brains/seed/ copy, no initSchema() call — gbrain's
 * schema is already DB-wide (Phase 2 migrated it).
 *
 * Source ID rules (RESEARCH.md Pitfall 6 — tighter than lib/gbrain/slug.ts):
 *   - gbrain sources: [a-z0-9-]{1,32} (not the 40-char app tenant slug limit)
 *   - Format: `u-<hex>` where hex is 14 lowercase hex chars → total 17 chars
 *   - Never emit the reserved ids: "default", "seed", "host"
 *
 * D-02: first sign-in provisions a fresh empty brain. The brain has nothing to
 * query until data is imported (Phase 7 QBO ingest). That is acceptable — Phase
 * 6 delivers auth + isolation, not data.
 *
 * Security:
 *   T-06-14: source_id is generated server-side here; it is NEVER accepted from
 *   request input. provisionBrain is the ONLY writer to gbrain's sources table.
 */

import { createGBrainEngine } from "@/lib/gbrain/engine";

// ---------------------------------------------------------------------------
// Reserved source IDs (never emit these — gbrain internals use them)
// ---------------------------------------------------------------------------
const RESERVED_SOURCE_IDS = new Set(["default", "seed", "host"]);

// Gbrain source ID regex (tighter than the 40-char app slug — 1-32 chars)
const GBRAIN_SOURCE_REGEX = /^[a-z0-9-]{1,32}$/;

// ---------------------------------------------------------------------------
// generateSourceId
// ---------------------------------------------------------------------------

/**
 * Generate a unique gbrain source ID and a matching brain slug.
 *
 * Format: `u-<14 random hex chars>` (17 chars total, well within 32-char limit).
 * The brainSlug is the same value — it is used as the dashboard URL slug
 * (/dash/<brainSlug>) and doubles as the gbrain source ID stored on app.users.
 *
 * Never emits "default", "seed", or "host" (RESEARCH.md Pitfall 6).
 *
 * @returns { sourceId: string; brainSlug: string }
 */
export function generateSourceId(): { sourceId: string; brainSlug: string } {
  // Generate 7 random bytes → 14 hex chars; prefix with "u-" → 16 chars
  const randomBytes = crypto.getRandomValues(new Uint8Array(7));
  const hex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const sourceId = `u-${hex}`;

  // Defensive guards (belt-and-suspenders — the format above cannot produce these,
  // but explicit checks prevent future regressions if the format changes)
  if (RESERVED_SOURCE_IDS.has(sourceId)) {
    // Recurse once — astronomically unlikely, documents the invariant
    return generateSourceId();
  }
  if (!GBRAIN_SOURCE_REGEX.test(sourceId)) {
    throw new Error(`generateSourceId: produced invalid source id: ${sourceId}`);
  }
  if (sourceId.length > 32) {
    throw new Error(`generateSourceId: source id exceeds 32 chars: ${sourceId}`);
  }

  return { sourceId, brainSlug: sourceId };
}

// ---------------------------------------------------------------------------
// provisionBrain
// ---------------------------------------------------------------------------

/**
 * Provision a fresh empty gbrain brain for a new user.
 *
 * Inserts a row into gbrain's `sources` table with the given sourceId.
 * Uses `ON CONFLICT (id) DO NOTHING` — idempotent, safe to call on sign-in
 * even if a row already exists (returning-user path, AUTH-04).
 *
 * `config: { federated: false }` — the source is not federated across other
 * sources. Only this user's documents are searched when their sourceId is passed.
 *
 * This runs inline (not as a background job) — it is a single sub-millisecond
 * DB write. The gbrain schema is already DB-wide (Phase 2 migration).
 * Do NOT call engine.initSchema() here — that is DB-wide and already done.
 *
 * @param sourceId    The gbrain source ID (= brain_id on app.users)
 * @param displayName A human-readable name for the source (e.g. the user's email)
 */
export async function provisionBrain(
  sourceId: string,
  displayName: string,
): Promise<void> {
  const engine = await createGBrainEngine(sourceId);
  // engine.executeRaw is a gbrain BrainEngine method (see node_modules/gbrain/src/core/sql-query.ts).
  // The BrainEngine interface uses [key: string]: unknown for extensibility; cast the
  // engine to access the method type-safely. Call as `engine.executeRaw(...)` rather than
  // aliasing — extracting the method into a variable detaches `this`, and the method
  // body reads `this.sql`, which then throws "undefined is not an object".
  const typedEngine = engine as unknown as {
    executeRaw: (sql: string, params: unknown[]) => Promise<unknown>;
  };
  await typedEngine.executeRaw(
    `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING`,
    [sourceId, displayName, JSON.stringify({ federated: false })],
  );
  // Log only the fact that provisioning occurred, never the email (T-06-13)
  console.log("[auth/provision] brain provisioned sourceId=<redacted>");
}
