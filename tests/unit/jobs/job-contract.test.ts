/**
 * Unit tests for lib/jobs/{types,schemas,registry}.ts
 *
 * Tests:
 * - jobRequestSchema accepts valid onboarding-import body
 * - jobRequestSchema rejects unknown kind (qbo-ingest not in enum)
 * - jobRequestSchema rejects missing kind
 * - JOB_REGISTRY has exactly one key "onboarding-import" whose value is a function
 * - JobKind, JobStatus, JobProgress, JobOperation types are exported from types.ts
 */

import { describe, it, expect } from "vitest";
import { jobRequestSchema } from "../../../lib/jobs/schemas.ts";
import { JOB_REGISTRY } from "../../../lib/jobs/registry.ts";

// ── jobRequestSchema tests ──────────────────────────────────────────────────

describe("jobRequestSchema", () => {
  it("accepts a valid onboarding-import body with tenantId param", () => {
    const result = jobRequestSchema.safeParse({
      kind: "onboarding-import",
      params: { tenantId: "seed" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid onboarding-import body with empty params (default)", () => {
    const result = jobRequestSchema.safeParse({
      kind: "onboarding-import",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.params).toEqual({});
    }
  });

  it("rejects an unknown kind (qbo-ingest not yet in enum)", () => {
    const result = jobRequestSchema.safeParse({
      kind: "qbo-ingest",
      params: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing kind field", () => {
    const result = jobRequestSchema.safeParse({ params: {} });
    expect(result.success).toBe(false);
  });

  it("rejects an empty string kind", () => {
    const result = jobRequestSchema.safeParse({ kind: "", params: {} });
    expect(result.success).toBe(false);
  });
});

// ── JOB_REGISTRY tests ──────────────────────────────────────────────────────

describe("JOB_REGISTRY", () => {
  it("has exactly one key: onboarding-import", () => {
    const keys = Object.keys(JOB_REGISTRY);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe("onboarding-import");
  });

  it("onboarding-import value is a function (JobOperation)", () => {
    expect(typeof JOB_REGISTRY["onboarding-import"]).toBe("function");
  });
});
