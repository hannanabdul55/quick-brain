/**
 * tests/unit/auth/auth-verify-signout.test.ts
 *
 * RED-phase tests for Task 3 of plan 06-03:
 *   - app/auth/verify/route.ts (structural checks)
 *   - app/api/auth/sign-out/route.ts (structural checks)
 *
 * These tests verify exported shapes and code conventions without a live DB.
 * The routes touch next/headers (cookies) which requires Next.js request context,
 * so we use source-level structural checks.
 */

import { describe, it, expect } from "bun:test";

// ---------------------------------------------------------------------------
// app/auth/verify/route.ts
// ---------------------------------------------------------------------------
describe("app/auth/verify/route.ts", () => {
  it("declares dynamic = force-dynamic", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("declares runtime = nodejs", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain('runtime = "nodejs"');
  });

  it("exports a GET function (verify is a clicked link, not a POST)", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toMatch(/export\s+async\s+function\s+GET/);
  });

  it("reads the token from searchParams, not from a JSON body", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("searchParams");
    expect(src).toContain("token");
  });

  it("redirects to /auth/link-used on missing token", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("/auth/link-used");
  });

  it("calls consumeMagicLink for atomic single-use consume", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("consumeMagicLink");
  });

  it("calls verifyMagicToken for signature + expiry check", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("verifyMagicToken");
  });

  it("calls getUserByEmail and createUser for first sign-in provisioning", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("getUserByEmail");
    expect(src).toContain("createUser");
  });

  it("calls generateSourceId and provisionBrain for new users (AUTH-04)", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("generateSourceId");
    expect(src).toContain("provisionBrain");
  });

  it("calls createSession and sets the qb_session cookie", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("createSession");
    expect(src).toContain("qb_session");
  });

  it("sets cookie with sameSite lax (D-05)", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toMatch(/sameSite.*lax|lax.*sameSite/i);
  });

  it("sets cookie with 30-day maxAge (D-05)", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    // 30 days = 60*60*24*30 = 2592000
    expect(src).toMatch(/maxAge.*2592000|30.*days|60\*60\*24\*30/);
  });

  it("redirects to /dash/<brainSlug> on successful verify", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("/dash/");
  });

  it("uses isSafeNextPath before honoring the ?next= redirect", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    expect(src).toContain("isSafeNextPath");
  });

  it("documents Pitfall 4 (email-scanner prefetch) as a code comment", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    // Pitfall 4 is the email-scanner prefetch tradeoff
    expect(src).toMatch(/prefetch|Pitfall 4|scanner/i);
  });

  it("does not log the email or token from the verify URL", async () => {
    const src = await Bun.file("app/auth/verify/route.ts").text();
    // Must not log email directly in a console.log call
    expect(src).not.toMatch(/console\.log\s*\(\s*[^)]*\bemail\b/);
    expect(src).not.toMatch(/console\.log\s*\(\s*[^)]*\btoken\b/);
  });
});

// ---------------------------------------------------------------------------
// app/api/auth/sign-out/route.ts
// ---------------------------------------------------------------------------
describe("app/api/auth/sign-out/route.ts", () => {
  it("declares dynamic = force-dynamic", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("declares runtime = nodejs", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toContain('runtime = "nodejs"');
  });

  it("exports a POST function", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toMatch(/export\s+async\s+function\s+POST/);
  });

  it("calls destroySession for true server-side revocation (AUTH-07)", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toContain("destroySession");
  });

  it("clears the qb_session cookie with maxAge: 0 (D-05)", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toContain("qb_session");
    expect(src).toContain("maxAge: 0");
  });

  it("returns 200 ok even when no session was present (resilient)", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toContain("ok: true");
    expect(src).toContain("200");
  });

  it("reads the session cookie from qb_session", async () => {
    const src = await Bun.file("app/api/auth/sign-out/route.ts").text();
    expect(src).toContain("qb_session");
    expect(src).toContain("cookies");
  });
});
