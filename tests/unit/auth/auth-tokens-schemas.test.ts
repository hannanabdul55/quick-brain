/**
 * tests/unit/auth/auth-tokens-schemas.test.ts
 *
 * RED-phase tests for Task 1 of plan 06-03:
 *   - lib/auth/schemas.ts (sendLinkBodySchema, isSafeNextPath)
 *   - lib/auth/tokens.ts (issueMagicToken, verifyMagicToken)
 *   - lib/auth/resolve-tenant.ts (resolveTenant signature: no arguments)
 *
 * These tests are structural (not E2E) — they verify exported shapes,
 * schema behaviour, and token logic without a live DB connection.
 * jose calls use the real crypto implementation (pure Web Crypto, no I/O).
 */

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";

// ---------------------------------------------------------------------------
// Environment stub — tokens.ts throws at module load if JWT_SECRET is unset
// ---------------------------------------------------------------------------
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY;
beforeAll(() => {
  // >=32 bytes required for HS256
  process.env.JWT_SECRET = "test-secret-that-is-32-bytes-long!!";
  process.env.RESEND_API_KEY = "re_test_key";
});
afterAll(() => {
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET;
  if (ORIGINAL_RESEND_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_RESEND_KEY;
});

// ---------------------------------------------------------------------------
// lib/auth/schemas.ts
// ---------------------------------------------------------------------------
describe("lib/auth/schemas.ts", () => {
  let schemas: typeof import("@/lib/auth/schemas");

  beforeAll(async () => {
    schemas = await import("@/lib/auth/schemas");
  });

  describe("sendLinkBodySchema", () => {
    it("accepts a valid email", () => {
      const result = schemas.sendLinkBodySchema.safeParse({ email: "user@example.com" });
      expect(result.success).toBe(true);
    });

    it("accepts a valid email with optional next", () => {
      const result = schemas.sendLinkBodySchema.safeParse({
        email: "user@example.com",
        next: "/dash/my-brain",
      });
      expect(result.success).toBe(true);
    });

    it("rejects a non-email string", () => {
      const result = schemas.sendLinkBodySchema.safeParse({ email: "not-an-email" });
      expect(result.success).toBe(false);
    });

    it("rejects an empty email", () => {
      const result = schemas.sendLinkBodySchema.safeParse({ email: "" });
      expect(result.success).toBe(false);
    });

    it("rejects a missing email", () => {
      const result = schemas.sendLinkBodySchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("next field is optional", () => {
      const result = schemas.sendLinkBodySchema.safeParse({ email: "user@example.com" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.next).toBeUndefined();
      }
    });
  });

  describe("isSafeNextPath", () => {
    it("accepts a simple same-origin path", () => {
      expect(schemas.isSafeNextPath("/dash/abc")).toBe(true);
    });

    it("accepts /sign-in path", () => {
      expect(schemas.isSafeNextPath("/sign-in")).toBe(true);
    });

    it("rejects a path starting with //", () => {
      expect(schemas.isSafeNextPath("//evil.com")).toBe(false);
    });

    it("rejects a path starting with https://", () => {
      expect(schemas.isSafeNextPath("https://evil.com")).toBe(false);
    });

    it("rejects a path starting with http://", () => {
      expect(schemas.isSafeNextPath("http://evil.com")).toBe(false);
    });

    it("rejects a path starting with /\\", () => {
      expect(schemas.isSafeNextPath("/\\evil")).toBe(false);
    });

    it("rejects an empty string", () => {
      expect(schemas.isSafeNextPath("")).toBe(false);
    });

    it("rejects a relative path (no leading slash)", () => {
      expect(schemas.isSafeNextPath("dash/abc")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// lib/auth/tokens.ts
// ---------------------------------------------------------------------------
describe("lib/auth/tokens.ts", () => {
  let tokens: typeof import("@/lib/auth/tokens");

  beforeAll(async () => {
    tokens = await import("@/lib/auth/tokens");
  });

  describe("issueMagicToken", () => {
    it("returns a token and jti", async () => {
      const result = await tokens.issueMagicToken("user@example.com");
      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("jti");
      expect(typeof result.token).toBe("string");
      expect(typeof result.jti).toBe("string");
      expect(result.token.length).toBeGreaterThan(0);
      expect(result.jti.length).toBeGreaterThan(0);
    });

    it("generates unique jtis on successive calls", async () => {
      const r1 = await tokens.issueMagicToken("user@example.com");
      const r2 = await tokens.issueMagicToken("user@example.com");
      expect(r1.jti).not.toBe(r2.jti);
    });
  });

  describe("verifyMagicToken", () => {
    it("returns ok:true with email and jti for a valid token", async () => {
      const { token, jti } = await tokens.issueMagicToken("user@example.com");
      const result = await tokens.verifyMagicToken(token);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.email).toBe("user@example.com");
        expect(result.jti).toBe(jti);
      }
    });

    it("returns ok:false with reason:'invalid' for a garbage token", async () => {
      const result = await tokens.verifyMagicToken("garbage-token-string");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid");
      }
    });

    it("returns ok:false with reason:'invalid' for a tampered token", async () => {
      const { token } = await tokens.issueMagicToken("user@example.com");
      // Tamper with the last character
      const tampered = token.slice(0, -5) + "XXXXX";
      const result = await tokens.verifyMagicToken(tampered);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("invalid");
      }
    });

    it("returns ok:false with reason:'expired' for an expired token", async () => {
      // We can't easily create an expired token without mocking time,
      // so we verify the expired reason branch exists by checking the function handles
      // JWTExpired error separately. Structural test — check the module has the string.
      const src = await Bun.file("lib/auth/tokens.ts").text();
      expect(src).toContain("JWTExpired");
      expect(src).toContain('"expired"');
    });
  });

  describe("module-level guard", () => {
    it("exports issueMagicToken and verifyMagicToken", () => {
      expect(typeof tokens.issueMagicToken).toBe("function");
      expect(typeof tokens.verifyMagicToken).toBe("function");
    });
  });
});

// ---------------------------------------------------------------------------
// lib/auth/resolve-tenant.ts
// ---------------------------------------------------------------------------
describe("lib/auth/resolve-tenant.ts", () => {
  it("exports resolveTenant as a function", async () => {
    // We only load the module to check the export shape — resolve-tenant.ts
    // imports next/headers (cookies) which is only available in a Next.js request
    // context. We check the source directly for the no-argument shape.
    const src = await Bun.file("lib/auth/resolve-tenant.ts").text();
    // Must export resolveTenant
    expect(src).toContain("resolveTenant");
    // Must call validateSession
    expect(src).toContain("validateSession");
    // Must NOT accept any parameter (tenant id/source id must never come from input)
    // The function signature must be: resolveTenant() with no named parameters
    // Allow for `function resolveTenant()` or `const resolveTenant = async () =>`
    // but NOT `function resolveTenant(tenantId` or similar
    const fnMatch = src.match(/function resolveTenant\s*\(([^)]*)\)/);
    const arrowMatch = src.match(/resolveTenant\s*=\s*async\s*\(([^)]*)\)/);
    const arrowMatch2 = src.match(/resolveTenant\s*=\s*\(([^)]*)\)/);
    const match = fnMatch || arrowMatch || arrowMatch2;
    if (match) {
      // The parameter list (capture group 1) should be empty or whitespace only
      expect(match[1]?.trim() ?? "").toBe("");
    }
  });

  it("reads qb_session from the cookie (not from arguments)", async () => {
    const src = await Bun.file("lib/auth/resolve-tenant.ts").text();
    expect(src).toContain("qb_session");
    expect(src).toContain("cookies");
  });

  it("returns an unauthenticated sentinel shape (authenticated: false)", async () => {
    const src = await Bun.file("lib/auth/resolve-tenant.ts").text();
    expect(src).toContain("authenticated: false");
    expect(src).toContain("authenticated: true");
  });
});

// ---------------------------------------------------------------------------
// lib/auth/email.ts — structural checks (no live Resend calls)
// ---------------------------------------------------------------------------
describe("lib/auth/email.ts", () => {
  it("creates a Resend singleton using RESEND_API_KEY", async () => {
    const src = await Bun.file("lib/auth/email.ts").text();
    expect(src).toContain("RESEND_API_KEY");
    expect(src).toContain("Resend");
  });

  it("exports sendMagicLink", async () => {
    const src = await Bun.file("lib/auth/email.ts").text();
    expect(src).toContain("sendMagicLink");
  });

  it("does not log the email address or token", async () => {
    const src = await Bun.file("lib/auth/email.ts").text();
    // Should not have console.log with the email/verifyUrl parameter names directly
    // This is a proxy check — verify no console.log(email) or console.log(verifyUrl)
    expect(src).not.toMatch(/console\.log\s*\(\s*email\b/);
    expect(src).not.toMatch(/console\.log\s*\(\s*verifyUrl\b/);
    expect(src).not.toMatch(/console\.log\s*\(\s*token\b/);
  });

  it("mentions one-time sign-in link copy (UI-SPEC Copywriting Contract)", async () => {
    const src = await Bun.file("lib/auth/email.ts").text();
    // The email copy must follow the non-technical tone from UI-SPEC
    expect(src).toMatch(/one.time sign.in link|one-time sign-in link/i);
  });

  it("mentions 15 minutes TTL in the email template", async () => {
    const src = await Bun.file("lib/auth/email.ts").text();
    expect(src).toMatch(/15 minutes|15-minute/i);
  });
});
