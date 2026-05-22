/**
 * Inngest serve route (JOBS-01)
 *
 * Handles the Inngest webhook endpoint used by:
 *   - Inngest cloud in production (to invoke registered functions)
 *   - bunx inngest-cli dev in local development (no cloud keys needed locally)
 *
 * Security: INNGEST_SIGNING_KEY MUST be set in production. serve() from
 * inngest/next verifies the HMAC signature on every inbound POST/PUT request.
 * Without it the route accepts unsigned requests — see T-05-01 in the threat
 * model and the comment in .env.example.
 *
 * Route segment config:
 * - runtime = "nodejs" matches every other API route (onboard, chat, health).
 *   This is the Next.js runtime segment — distinct from the bun@1.2.0
 *   Vercel function runtime configured in vercel.json.
 * - dynamic = "force-dynamic" prevents Next.js static optimization on this route.
 *
 * functions array is empty here. plan 05-04 adds the generic runJob function.
 * GET /api/inngest returns a 200 Inngest introspection JSON even with zero
 * functions registered.
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const { GET, POST, PUT } = serve({ client: inngest, functions: [] });

export { GET, POST, PUT };
