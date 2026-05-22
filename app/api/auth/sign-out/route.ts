/**
 * POST /api/auth/sign-out
 *
 * Signs out the current user: deletes the session row (true server-side
 * revocation, AUTH-07) and clears the qb_session cookie (D-05).
 *
 * Resilient: always clears the cookie and returns 200 even if no session was
 * present (idempotent — safe to call multiple times).
 *
 * Responses:
 *   200  { ok: true }  — session destroyed (or no session was present)
 *
 * Security:
 *   AUTH-07: destroySession deletes the row — the session is invalid immediately
 *   on all servers (no TTL to wait out, unlike stateless JWT sessions)
 *   D-05: cookie cleared via maxAge: 0
 *
 * Analog: app/api/jobs/route.ts (POST handler, runtime/dynamic exports)
 */

// Prevent Next.js static optimization — side effects (DB delete + Set-Cookie).
export const dynamic = "force-dynamic";
// nodejs runtime: postgres client + next/headers not Edge-compatible.
export const runtime = "nodejs";

import { cookies } from "next/headers";
import { destroySession } from "@/lib/auth/session";

export async function POST(): Promise<Response> {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get("qb_session");

  // Destroy the session row if a session cookie is present (AUTH-07)
  if (sessionCookie?.value) {
    try {
      await destroySession(sessionCookie.value);
    } catch {
      // If the DB call fails (e.g. session already deleted), still clear the cookie.
      // A failed destroySession should not prevent the user from being signed out
      // client-side. Log that it occurred but do not surface to the user.
      console.log("[auth/sign-out] destroySession error — clearing cookie anyway");
    }
  }

  // Always clear the cookie (D-05: maxAge: 0 = expire immediately)
  cookieStore.set("qb_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });

  return Response.json({ ok: true }, { status: 200 });
}
