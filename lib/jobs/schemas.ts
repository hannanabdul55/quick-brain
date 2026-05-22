/**
 * lib/jobs/schemas.ts — Zod schema for the job-trigger route payload.
 *
 * jobRequestSchema validates the POST /api/jobs request body before any
 * side effect (DB INSERT or Inngest event send). Rejects unknown `kind`
 * values that are not in the JobKind registry — RESEARCH Security V5.
 *
 * Mirrors lib/onboarding/schemas.ts and lib/chat/schemas.ts (same ~15-line
 * zod-object + z.infer pattern).
 *
 * The `kind` enum values MUST exactly match JobKind in lib/jobs/types.ts.
 * Phase 7 adds "qbo-ingest" to BOTH the enum here and to JobKind in types.ts.
 */

import { z } from "zod";

export const jobRequestSchema = z.object({
  /**
   * The job kind — must match a registered entry in JOB_REGISTRY.
   * Unknown kinds are rejected at validation time (Security V5).
   */
  kind: z.enum(["onboarding-import"]),

  /**
   * Arbitrary params passed to the job operation.
   * Defaults to an empty record if omitted.
   * Each operation casts the fields it needs (e.g. params.tenantId).
   */
  params: z.record(z.unknown()).default({}),
});

export type JobRequest = z.infer<typeof jobRequestSchema>;
