/**
 * GET /api/auth/verify
 *
 * The magic-link verify route. A user clicks the link in their email and lands here.
 * This route performs the atomic single-use token consume, first-sign-in brain
 * provisioning, session establishment, and post-sign-in redirect.
 *
 * Flow:
 *   1. Read ?token= from searchParams → missing → redirect /auth/link-used
 *   2. verifyMagicToken(token) → {ok:false} → redirect /auth/link-used
 *   3. consumeMagicLink(jti) → null (used/expired) → redirect /auth/link-used
 *   4. getUserByEmail(email) → null → first sign-in → generateSourceId + provisionBrain + createUser
 *                           → user exists → reuse (AUTH-04: exactly one brain per user)
 *   5. createSession(userId) → set qb_session cookie (D-05 shape)
 *   6. Redirect: ?next= if present + isSafeNextPath → else /dash/<brainSlug>
 *
 * Pitfall 4 mitigation (email-scanner prefetch consuming the token):
 *   Email scanners (Gmail, Outlook SafeLinks, etc.) may GET every link in the email
 *   before the user sees it. A single-GET consume means the scanner eats the token.
 *   Accepted tradeoff (option b from RESEARCH.md): the /auth/link-used resend path
 *   is the user's safety net. This is the industry-standard approach for magic links;
 *   the alternative (two-step click → POST) adds UX friction for all users.
 *
 * Security:
 *   T-06-09: verifyMagicToken validates HS256 signature + expiry
 *   T-06-10: consumeMagicLink is a single atomic UPDATE WHERE used=false — two concurrent
 *            clicks cannot both win (TOCTOU-free)
 *   T-06-12: isSafeNextPath rejects open redirects before honoring ?next=
 *   T-06-13: metadata-only logging — never the email or token
 *   T-06-14: source_id generated server-side; never from request input
 *   T-06-15: fresh session ID minted on every verify (session fixation prevention)
 */

// Prevent Next.js static optimization — side effects + DB writes.
export const dynamic = "force-dynamic";
// nodejs runtime: postgres client + next/headers not Edge-compatible.
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { type NextRequest } from "next/server";
import { verifyMagicToken } from "@/lib/auth/tokens";
import { consumeMagicLink, getUserByEmail, createUser } from "@/lib/auth/store";
import { createSession } from "@/lib/auth/session";
import { generateSourceId, provisionBrain } from "@/lib/auth/provision";
import { isSafeNextPath } from "@/lib/auth/schemas";

// D-05: 30-day maxAge in seconds
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 2592000

export async function GET(request: NextRequest): Promise<Response> {
  const searchParams = request.nextUrl.searchParams;
  const token = searchParams.get("token");
  const next = searchParams.get("next");

  // ── 1. Missing token → link-used page ────────────────────────────────────
  if (!token) {
    return redirect("/auth/link-used");
  }

  // ── 2. Verify JWT signature + expiry (T-06-09) ────────────────────────────
  const verified = await verifyMagicToken(token);
  if (!verified.ok) {
    // expired or tampered/invalid — both lead to the link-used resend page
    return redirect("/auth/link-used");
  }
  const { email, jti } = verified;

  // ── 3. Atomic single-use consume (T-06-10, D-07) ─────────────────────────
  // consumeMagicLink does UPDATE...WHERE used=false + checks rows.count.
  // Two concurrent clicks cannot both win — TOCTOU-free.
  const consumedEmail = await consumeMagicLink(jti);
  if (!consumedEmail) {
    // Already consumed, expired, or not found → link-used page
    return redirect("/auth/link-used");
  }

  // ── 4. Get-or-provision the user (AUTH-04: exactly one brain per user) ───
  let user = await getUserByEmail(email);
  if (!user) {
    // First sign-in: provision a fresh empty brain then create the user row
    // D-02: empty brain (NOT a copy of the Mara's Coffee seed)
    // T-06-14: sourceId is generated server-side, never from request input
    const { sourceId, brainSlug } = generateSourceId();
    await provisionBrain(sourceId, email);
    user = await createUser({ email, brainId: sourceId, brainSlug });
    // Log only that provisioning occurred (T-06-13: never log the email)
    console.log("[auth/verify] first sign-in — brain provisioned");
  } else {
    // Returning user: reuse existing brain (AUTH-04 idempotent)
    console.log("[auth/verify] returning user — session created");
  }

  // ── 5. Establish session + set cookie (D-05, T-06-15) ────────────────────
  // Fresh session ID minted on every verify — prevents session fixation.
  const sessionId = await createSession(user.id);
  const cookieStore = await cookies();
  cookieStore.set("qb_session", sessionId, {
    httpOnly: true,
    // Secure in production so the cookie is not sent over plain HTTP
    secure: process.env.NODE_ENV === "production",
    // SameSite=Lax (not Strict) so the cross-site navigation from the email client works
    sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE,
    path: "/",
  });

  // ── 6. Post-sign-in redirect ──────────────────────────────────────────────
  // Honor ?next= only when it passes the same-origin guard (T-06-12)
  if (next && isSafeNextPath(next)) {
    return redirect(next);
  }
  return redirect(`/dash/${user.brain_slug}`);
}
