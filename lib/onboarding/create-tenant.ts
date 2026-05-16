/**
 * createTenant domain function.
 *
 * Responsibilities:
 * 1. Slugify businessName (collision-safe, shell-special-char-free, HARN-06).
 * 2. Verify brains/seed/ exists; throw SEED_MISSING if not.
 * 3. Copy brains/seed/ → brains/<slug>/ using node:fs/promises cp.
 * 4. Register the new tenant in the in-memory Map via tenants.upsert().
 * 5. Return { tenantId, slug }.
 *
 * No Next.js imports — this module is Next.js-agnostic and fully testable
 * in isolation.
 */

import { access, cp } from "node:fs/promises";
import { tenantSlugSchema } from "@/lib/gbrain/slug.ts";
import * as tenants from "@/lib/gbrain/tenants.ts";
import { brainHome, seedBrainHome } from "@/lib/gbrain/paths.ts";
import type { CreateTenantBody } from "./schemas.ts";

// ─── Error type ──────────────────────────────────────────────────────────────

export type TenantCreationCode =
  | "INVALID_INPUT"
  | "SLUG_EXHAUSTED"
  | "COPY_FAILED"
  | "SEED_MISSING";

export class TenantCreationError extends Error {
  code: TenantCreationCode;

  constructor(message: string, code: TenantCreationCode) {
    super(message);
    this.name = "TenantCreationError";
    this.code = code;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Slugify a business name:
 * - Lowercase
 * - Strip diacritics (NFD + strip combining marks)
 * - Replace any non-alphanumeric character (including shell specials) with "-"
 * - Collapse repeated "-" into one
 * - Trim leading/trailing "-"
 * - Truncate to 38 characters (leaving 2 chars budget for "-N" suffix)
 *
 * Returns empty string if the result is blank (e.g., all-symbols input).
 */
function slugify(businessName: string): string {
  return businessName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric runs with "-"
    .replace(/^-+|-+$/g, "") // trim leading/trailing "-"
    .slice(0, 38); // leave room for "-N" collision suffix
}

/**
 * Check whether a slug candidate is already taken:
 * - Registered in the in-memory tenants Map, OR
 * - Has a corresponding directory on disk (defensive against partial state).
 */
async function isSlugTaken(slug: string): Promise<boolean> {
  if (tenants.get(slug) !== undefined) return true;
  try {
    await access(brainHome(slug));
    return true;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new tenant from an onboarding form payload.
 *
 * @param body - Validated onboarding body (already parsed by createTenantBodySchema).
 * @returns Promise resolving to { tenantId, slug } on success.
 * @throws TenantCreationError on failure.
 */
export async function createTenant(
  body: CreateTenantBody,
): Promise<{ tenantId: string; slug: string }> {
  // Ensure the in-memory registry is populated from disk on first call.
  await tenants.init();

  // ── Step 1: Build a unique, safe slug ──────────────────────────────────────
  let baseSlug = slugify(body.businessName);

  // If slugification produced an empty string (e.g., all-symbols input),
  // fall back to a time-based identifier.
  if (!baseSlug) {
    baseSlug = `business-${Date.now().toString(36)}`;
  }

  // Validate the base candidate against the strict regex.
  const baseValidation = tenantSlugSchema.safeParse(baseSlug);
  if (!baseValidation.success) {
    // The slug is still invalid after slugification — this can happen if
    // the result starts/ends with a digit after truncation but is otherwise
    // fine. Fall back to a time-based slug.
    baseSlug = `business-${Date.now().toString(36)}`;
  }

  // Resolve collisions by appending "-2", "-3", ... up to "-99".
  const MAX_ATTEMPTS = 99;
  let resolvedSlug = baseSlug;
  let attempt = 1;

  while (await isSlugTaken(resolvedSlug)) {
    attempt++;
    if (attempt > MAX_ATTEMPTS) {
      throw new TenantCreationError(
        `Slug collision exhausted after ${MAX_ATTEMPTS} attempts for base "${baseSlug}". ` +
          `Choose a different business name.`,
        "SLUG_EXHAUSTED",
      );
    }
    resolvedSlug = `${baseSlug}-${attempt}`;
  }

  const slug = resolvedSlug;

  // ── Step 2: Verify seed brain exists ──────────────────────────────────────
  try {
    await access(seedBrainHome());
  } catch {
    throw new TenantCreationError(
      "brains/seed/ directory not found. Run `bun run seed` to initialize the seed brain before creating tenants.",
      "SEED_MISSING",
    );
  }

  // ── Step 3: Copy seed → new brain dir ─────────────────────────────────────
  try {
    await cp(seedBrainHome(), brainHome(slug), { recursive: true });
  } catch (err) {
    throw new TenantCreationError(
      `Failed to copy brains/seed/ to brains/${slug}/: ${err instanceof Error ? err.message : String(err)}`,
      "COPY_FAILED",
    );
  }

  // ── Step 4: Register in-memory ────────────────────────────────────────────
  tenants.upsert({
    id: slug,
    brainHome: brainHome(slug),
    status: "ready",
    createdAt: Date.now(),
    name: body.businessName,
    businessType: body.businessType,
    ownerName: body.ownerName,
  });

  // ── Step 5: Return ─────────────────────────────────────────────────────────
  return { tenantId: slug, slug };
}
