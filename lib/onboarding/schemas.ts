import { z } from "zod";

/**
 * Zod schema for the onboarding form body.
 * Used by both the Route Handler (server-side validation) and
 * can be imported in client code for field-level hints.
 *
 * businessName is free-text; slugification happens server-side.
 */
export const createTenantBodySchema = z.object({
  businessName: z.string().min(1).max(80),
  businessType: z.string().min(1).max(40),
  ownerName: z.string().min(1).max(80),
});

export type CreateTenantBody = z.infer<typeof createTenantBodySchema>;
