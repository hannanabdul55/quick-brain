/**
 * POST /api/auth/send-link
 *
 * Issues a 15-minute magic-link JWT and sends it via Resend to the given email.
 * Returns 429 with no send if the email was requested within the last 60 seconds
 * (DB-backed rate limit, D-09 / AUTH-09).
 *
 * Responses:
 *   200  { ok: true }                            — link sent
 *   400  { error: "invalid_json" }               — unparseable body
 *   400  { error: "validation_failed"; issues }  — schema failure
 *   429  { error: "rate_limited" }               — within 60s window; no send
 *
 * Security:
 *   T-06-11: wasRecentlyRequested (DB-backed, not in-memory) prevents email flooding
 *   T-06-12: isSafeNextPath validates ?next= before including it in the verify URL
 *   T-06-13: logs metadata only — never the email address or token text
 *   T-06-09: issueMagicToken issues an HS256-signed token (15-min TTL)
 *
 * Analog: app/api/jobs/route.ts (POST + zod-body + runtime/dynamic exports)
 */

// Prevent Next.js static optimization — this route has side effects.
export const dynamic = "force-dynamic";
// nodejs runtime: lib/auth/store.ts imports postgres, not Edge-compatible.
export const runtime = "nodejs";

import { sendLinkBodySchema, isSafeNextPath } from "@/lib/auth/schemas";
import { issueMagicToken } from "@/lib/auth/tokens";
import { recordMagicLink, wasRecentlyRequested } from "@/lib/auth/store";
import { sendMagicLink } from "@/lib/auth/email";

export async function POST(req: Request): Promise<Response> {
  // ── 1. Parse JSON body ────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  // ── 2. Zod validation ─────────────────────────────────────────────────────
  const parsed = sendLinkBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { email, next } = parsed.data;

  // ── 3. DB-backed rate limit (D-09 / AUTH-09) ─────────────────────────────
  // wasRecentlyRequested checks the DB — survives serverless cold starts.
  // Never log the email (T-06-13).
  const rateLimited = await wasRecentlyRequested(email);
  if (rateLimited) {
    // Log only that a rate limit was hit, not who triggered it
    console.log("[auth/send-link] rate limit hit");
    return Response.json({ error: "rate_limited" }, { status: 429 });
  }

  // ── 4. Issue the magic-link JWT (15-min TTL, D-07) ───────────────────────
  const { token, jti } = await issueMagicToken(email);

  // ── 5. Record the magic-link row (enables atomic single-use consume) ──────
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
  await recordMagicLink({ jti, email, expiresAt });

  // ── 6. Build the verify URL ───────────────────────────────────────────────
  // Use the request origin so it works on any deployed URL (not hardcoded domain).
  const origin = new URL(req.url).origin;
  const verifyUrl = new URL(`${origin}/auth/verify`);
  verifyUrl.searchParams.set("token", token);
  // Only append ?next= when it passes the same-origin guard (T-06-12)
  if (next && isSafeNextPath(next)) {
    verifyUrl.searchParams.set("next", next);
  }

  // ── 7. Send the magic-link email ──────────────────────────────────────────
  // sendMagicLink never logs the email or token internally (T-06-13).
  await sendMagicLink(email, verifyUrl.toString());

  // Log only that a send occurred, never to whom (T-06-13)
  console.log("[auth/send-link] magic link dispatched");

  // ── 8. Return success ─────────────────────────────────────────────────────
  return Response.json({ ok: true }, { status: 200 });
}
