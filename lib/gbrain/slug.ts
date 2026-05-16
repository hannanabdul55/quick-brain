import { z } from "zod";

// HARN-06: strict slug regex.
// Lowercase letters, digits, and single hyphens. Must start and end with
// alphanumeric. 1-40 chars. Shell-metacharacter free. Path-traversal safe.
export const TENANT_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export const tenantSlugSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(
    TENANT_SLUG_REGEX,
    "tenantId must be lowercase a-z0-9 with hyphens, 1-40 chars, no leading/trailing hyphen",
  );

export function isValidTenantSlug(s: string): boolean {
  return TENANT_SLUG_REGEX.test(s);
}

export function assertTenantSlug(s: string): string {
  const r = tenantSlugSchema.safeParse(s);
  if (!r.success) {
    throw new Error(`Invalid tenant slug: ${r.error.issues[0]?.message ?? "unknown"}`);
  }
  return r.data;
}
