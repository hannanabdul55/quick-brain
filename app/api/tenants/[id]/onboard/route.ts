/**
 * GET /api/tenants/[id]/onboard
 *
 * Returns a Server-Sent Events stream that narrates the 30–45s onboarding
 * "theater" for a newly created tenant. The stream emits:
 *
 *   event: stage   data: { stage, label, progress }   × multiple per stage
 *   event: done    data: { tenantId }                 × 1 at completion
 *   event: error   data: { stage, message }           × 1 on failure (then closes)
 *
 * Satisfies ONBD-04 (5 named stage labels), ONBD-05 (real gbrain warm-up),
 * ONBD-07 (30–45s wall-clock duration).
 *
 * Route Handler constraints:
 * - runtime = "nodejs" (NOT "edge") because spawnGBrain uses node:child_process
 * - dynamic = "force-dynamic" to disable static optimization on GET routes with
 *   no caching intent
 */

import * as tenants from "@/lib/gbrain/tenants";
import { tenantSlugSchema } from "@/lib/gbrain/slug";
import { sseEventStream } from "@/lib/onboarding/sse";
import { runOnboarding } from "@/lib/onboarding/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  // ------------------------------------------------------------------
  // 1. Validate the tenant ID
  // ------------------------------------------------------------------
  const { id } = await ctx.params;
  const parseResult = tenantSlugSchema.safeParse(id);
  if (!parseResult.success) {
    return Response.json(
      { error: "invalid_tenant_id", message: "tenantId must be a valid slug (lowercase a-z0-9 with hyphens)" },
      { status: 400 },
    );
  }

  // ------------------------------------------------------------------
  // 2. Verify the tenant exists in the Postgres registry
  // ------------------------------------------------------------------
  const tenant = await tenants.getBySlug(id);
  if (!tenant) {
    return Response.json(
      { error: "tenant_not_found", message: `No tenant with id: ${id}` },
      { status: 404 },
    );
  }

  // ------------------------------------------------------------------
  // 3. Build and return the SSE stream
  // ------------------------------------------------------------------
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
