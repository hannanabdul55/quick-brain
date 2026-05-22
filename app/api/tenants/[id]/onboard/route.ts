/**
 * GET /api/tenants/[id]/onboard
 *
 * Onboarding theater route. Under the auth model (Phase 6+), brain provisioning
 * happens atomically in the verify route (app/auth/verify/route.ts) on first
 * sign-in — not here. This route is retained for the AUTH_ENABLED=0 dev/seed
 * path only (D-03). Phase 9 (CLEAN-03) will remove this route entirely.
 *
 * HTTP status codes:
 *   200   — SSE stream (AUTH_ENABLED=0 seed path only)
 *   401   — unauthenticated (AUTH_ENABLED=1: no valid session cookie)
 *   403   — URL slug does not match the session-resolved brain slug
 *   410   — Gone (AUTH_ENABLED=1: real auth path; onboarding UI redirects to /sign-in)
 *   405   — method not allowed (non-GET)
 *
 * AUTH-05 (D-11): for the authenticated path, identity is resolved from the
 * verified session cookie via resolveTenant(). The URL [id] slug is NEVER
 * trusted for identity. Since provisioning is now session-controlled, a real
 * user arriving here receives 410 — their brain is already provisioned.
 *
 * Route Handler constraints:
 * - runtime = "nodejs"
 * - dynamic = "force-dynamic"
 */

import { resolveTenant } from "@/lib/auth/resolve-tenant";
import { SEED_TENANT_ID } from "@/lib/gbrain/paths";
import { sseEventStream } from "@/lib/onboarding/sse";
import { runOnboarding } from "@/lib/onboarding/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;

  // ── AUTH_ENABLED=0 seed bypass (D-03) ─────────────────────────────────────
  // Dev-only path for the hackathon seed onboarding theater. Phase 9 removes this.
  const isDevBypass = process.env.AUTH_ENABLED === "0" && id === SEED_TENANT_ID;

  if (isDevBypass) {
    // Run the onboarding theater for the seed tenant without auth.
    const stream = sseEventStream(async (write) => {
      try {
        await runOnboarding(
          id,
          (event) => {
            if (event.type === "stage") {
              write("stage", {
                stage: event.stage,
                label: event.label,
                progress: event.progress,
              });
            } else if (event.type === "done") {
              write("done", { tenantId: event.tenantId });
            } else {
              // event.type === "error"
              write("error", { stage: event.stage, message: event.message });
            }
          },
        );
      } catch (err: unknown) {
        write("error", {
          stage: "init",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, req.signal);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // Prevents nginx/proxy buffering — important for streaming demos
        "X-Accel-Buffering": "no",
      },
    });
  }

  // ── Authenticated path: resolve identity from the session ─────────────────
  const tenantCtx = await resolveTenant();
  if (!tenantCtx.authenticated) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { brainSlug } = tenantCtx;

  // Slug mismatch guard
  if (id !== brainSlug) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Brain provisioning now happens in the verify route on first sign-in (Phase 6+).
  // This onboarding theater route is no longer the provisioning entry point.
  // Return 410 Gone — the UI should redirect users to /sign-in / /dash/<slug>.
  return Response.json(
    { error: "gone", message: "Onboarding via this route is no longer supported. Brain provisioning happens on sign-in." },
    { status: 410 },
  );
}
