/**
 * GET /api/health
 *
 * Public endpoint that probes three subsystems independently and reports
 * each one's reachability in a JSON payload.
 *
 * Response shape (200 — all healthy):
 *   {
 *     status: "ok",
 *     timestamp: string,          // ISO 8601
 *     checks: {
 *       app:      { ok: true,  latencyMs: 0 },
 *       gbrainDb: { ok: boolean, latencyMs: number, detail?: string },
 *       storage:  { ok: boolean, latencyMs: number, detail?: string }
 *     }
 *   }
 *
 * Response shape (503 — any subsystem down):
 *   { status: "degraded", timestamp: string, checks: { app, gbrainDb, storage } }
 *
 * HTTP status codes:
 *   200  — all three subsystems are reachable
 *   503  — one or more subsystems are down
 *
 * Route Handler constraints:
 * - runtime nodejs — gbrain's postgres client is not edge-compatible.
 *   Previously required for child_process.spawn; with in-process Postgres
 *   the Node.js runtime requirement remains.
 * - dynamic = "force-dynamic" — prevents the health response from being
 *   statically cached; the point of a health check is to be live.
 *
 * Security:
 * - T-04-01: payload carries only booleans, latencyMs, and sanitized detail
 *   strings — never the connection string, host, service-role key, or env
 *   values. The probes themselves sanitize error paths (T-04-02).
 * - T-04-03: each probe is wrapped in a ~2.5s timeout via timed(); a dead
 *   subsystem cannot hang the endpoint or amplify cost (no LLM call).
 * - T-04-04: probeGbrainDb uses a throwaway postgres connection, never the
 *   app's enginePool.
 *
 * DEPLOY-03: health endpoint required for Vercel deploy observability.
 */

import { probeGbrainDb, probeStorage, timed } from "@/lib/health/probes";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ── GET /api/health ───────────────────────────────────────────────────────────

export async function GET(): Promise<Response> {
  // ── 1. Probe app ─────────────────────────────────────────────────────────────
  // The process answering this request IS the app-up signal.
  const app = { ok: true, latencyMs: 0 };

  // ── 2. Probe gbrain DB and Supabase Storage concurrently ─────────────────────
  // Promise.all runs both probes in parallel. timed() wraps each probe in a
  // 2.5s timeout and catches all errors internally — one failing subsystem
  // cannot abort or hang the other (RESEARCH.md Pattern 2, T-04-03).
  const [gbrainDb, storage] = await Promise.all([
    timed(probeGbrainDb),
    timed(probeStorage),
  ]);

  // ── 3. Compute overall health ─────────────────────────────────────────────────
  const healthy = app.ok && gbrainDb.ok && storage.ok;

  // ── 4. Log metadata only — never the connection string or any secret ──────────
  // Logs probe outcomes for observability without exposing credentials (V7).
  console.log("[health]", { app: app.ok, gbrainDb: gbrainDb.ok, storage: storage.ok });

  // ── 5. Return JSON payload with 200 (all healthy) or 503 (any subsystem down) ─
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      checks: { app, gbrainDb, storage },
    },
    { status: healthy ? 200 : 503 },
  );
}
