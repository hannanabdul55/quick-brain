/**
 * tests/unit/auth/auth-provision-sendlink.test.ts
 *
 * RED-phase tests for Task 2 of plan 06-03:
 *   - lib/auth/provision.ts (generateSourceId, provisionBrain)
 *   - app/api/auth/send-link/route.ts (structural checks)
 *
 * These tests are structural — they verify exported shapes, ID generation
 * rules, and route code conventions without a live DB or Resend call.
 */

import { describe, it, expect, beforeAll } from "bun:test";

// ---------------------------------------------------------------------------
// Environment stubs
// ---------------------------------------------------------------------------
const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET;
const ORIGINAL_RESEND_KEY = process.env.RESEND_API_KEY;
beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-that-is-32-bytes-long!!";
  process.env.RESEND_API_KEY = "re_test_key";
});

// ---------------------------------------------------------------------------
// lib/auth/provision.ts
// ---------------------------------------------------------------------------
describe("lib/auth/provision.ts", () => {
  it("exports generateSourceId and provisionBrain", async () => {
    const src = await Bun.file("lib/auth/provision.ts").text();
    expect(src).toContain("generateSourceId");
    expect(src).toContain("provisionBrain");
    expect(src).toContain("export");
  });

  it("generateSourceId returns an object with sourceId and brainSlug", async () => {
    const provision = await import("@/lib/auth/provision");
    const result = provision.generateSourceId();
    expect(result).toHaveProperty("sourceId");
    expect(result).toHaveProperty("brainSlug");
  });

  it("generateSourceId produces a sourceId starting with u-", async () => {
    const provision = await import("@/lib/auth/provision");
    const { sourceId } = provision.generateSourceId();
    expect(sourceId.startsWith("u-")).toBe(true);
  });

  it("generateSourceId produces a sourceId of at most 32 chars", async () => {
    const provision = await import("@/lib/auth/provision");
    for (let i = 0; i < 10; i++) {
      const { sourceId } = provision.generateSourceId();
      expect(sourceId.length).toBeLessThanOrEqual(32);
    }
  });

  it("generateSourceId produces a sourceId matching gbrain [a-z0-9-]{1,32}", async () => {
    const provision = await import("@/lib/auth/provision");
    const GBRAIN_SOURCE_REGEX = /^[a-z0-9-]{1,32}$/;
    for (let i = 0; i < 10; i++) {
      const { sourceId } = provision.generateSourceId();
      expect(GBRAIN_SOURCE_REGEX.test(sourceId)).toBe(true);
    }
  });

  it("generateSourceId never returns reserved ids (default, seed, host)", async () => {
    const provision = await import("@/lib/auth/provision");
    const RESERVED = new Set(["default", "seed", "host"]);
    for (let i = 0; i < 20; i++) {
      const { sourceId } = provision.generateSourceId();
      expect(RESERVED.has(sourceId)).toBe(false);
    }
  });

  it("generateSourceId returns unique ids across calls", async () => {
    const provision = await import("@/lib/auth/provision");
    const ids = new Set<string>();
    for (let i = 0; i < 20; i++) {
      ids.add(provision.generateSourceId().sourceId);
    }
    expect(ids.size).toBe(20);
  });

  it("provisionBrain source code uses INSERT INTO sources ... ON CONFLICT (id) DO NOTHING", async () => {
    const src = await Bun.file("lib/auth/provision.ts").text();
    expect(src).toContain("ON CONFLICT");
    expect(src).toContain("sources");
    expect(src).toContain("INSERT");
  });

  it("provisionBrain source code does NOT call initSchema per user", async () => {
    const src = await Bun.file("lib/auth/provision.ts").text();
    // initSchema is DB-wide and only called once at startup, not per user
    expect(src).not.toContain("initSchema()");
  });
});

// ---------------------------------------------------------------------------
// app/api/auth/send-link/route.ts — structural checks
// ---------------------------------------------------------------------------
describe("app/api/auth/send-link/route.ts", () => {
  it("declares dynamic = force-dynamic", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("declares runtime = nodejs", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain('runtime = "nodejs"');
  });

  it("imports and uses wasRecentlyRequested for rate limiting", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("wasRecentlyRequested");
  });

  it("returns 429 rate_limited when rate limit triggered", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("rate_limited");
    expect(src).toContain("429");
  });

  it("uses sendLinkBodySchema for validation", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("sendLinkBodySchema");
  });

  it("returns 400 validation_failed on bad body", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("validation_failed");
    expect(src).toContain("400");
  });

  it("uses isSafeNextPath before including next in the verify URL", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("isSafeNextPath");
  });

  it("does not log the email address or token", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    // Must not have console.log(email...) or console.log(token...)
    expect(src).not.toMatch(/console\.log\s*\(\s*[^)]*\bemail\b/);
    expect(src).not.toMatch(/console\.log\s*\(\s*[^)]*\btoken\b/);
  });

  it("calls issueMagicToken and recordMagicLink", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("issueMagicToken");
    expect(src).toContain("recordMagicLink");
  });

  it("calls sendMagicLink to dispatch the email", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    expect(src).toContain("sendMagicLink");
  });

  it("uses request origin for verify URL construction (not a hardcoded domain)", async () => {
    const src = await Bun.file("app/api/auth/send-link/route.ts").text();
    // Should use URL(req.url).origin or equivalent
    expect(src).toMatch(/new URL\s*\(\s*req\.url/);
  });
});
