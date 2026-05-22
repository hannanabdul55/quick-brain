/**
 * middleware.ts — Coarse cookie-presence gate for protected routes.
 *
 * D-06: Auth gating runs in middleware as a coarse qb_session cookie-presence
 * check. Full session validation (DB lookup via lib/auth/store.ts) happens
 * downstream in Node-runtime routes/pages.
 *
 * D-03: AUTH_ENABLED=0 dev bypass — middleware is a no-op when AUTH_ENABLED=0.
 * The default is auth-on (absent or any other value).
 *
 * CRITICAL — Edge runtime constraint (Next.js 15.3.2):
 * This middleware runs in the Edge runtime. Importing `postgres` or any module
 * that transitively imports it (e.g. lib/auth/store.ts) will crash the Edge
 * bundler. Only Web Platform APIs are safe here — cookies via NextRequest.cookies.
 * Full session validation is in Node-runtime routes via lib/auth/resolve-tenant.ts.
 * (RESEARCH.md Pitfall 2, D-06)
 */

import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  // D-03: dev-only AUTH_ENABLED=0 bypass — skip all auth gating
  if (process.env.AUTH_ENABLED === "0") return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Coarse presence check only — no DB call, no JWT verify (Edge constraint)
  if (!request.cookies.has("qb_session")) {
    const next = encodeURIComponent(pathname);
    return NextResponse.redirect(new URL(`/sign-in?next=${next}`, request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dash/:path*", "/api/tenants/:path*"],
};
