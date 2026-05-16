/**
 * POST /api/tenants
 *
 * Accepts the onboarding form payload, validates with zod, creates the
 * tenant (slugify + copy seed + register), and returns the tenantId.
 *
 * Responses:
 *   201  { tenantId: string; slug: string }
 *   400  { error: "validation_failed"; issues: [...] }
 *   500  { error: "creation_failed"; code: string; message: string }
 */

// Bypass Next.js static optimization — this Route Handler has side effects.
export const dynamic = "force-dynamic";

import { createTenantBodySchema } from "@/lib/onboarding/schemas";
import { createTenant, TenantCreationError } from "@/lib/onboarding/create-tenant";

export async function POST(req: Request): Promise<Response> {
  // ── 1. Parse JSON body ────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: "validation_failed", issues: [{ message: "invalid JSON body" }] },
      { status: 400 },
    );
  }

  // ── 2. Zod validation ─────────────────────────────────────────────────────
  const parsed = createTenantBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // ── 3. Create tenant ──────────────────────────────────────────────────────
  try {
    const { tenantId, slug } = await createTenant(parsed.data);
    // Log only slug (not business name) to avoid leaking PII to console.
    console.log(`[tenants] created tenant slug=${slug}`);
    return Response.json({ tenantId, slug }, { status: 201 });
  } catch (err) {
    if (err instanceof TenantCreationError) {
      console.error(`[tenants] creation failed code=${err.code}:`, err.message);
      return Response.json(
        { error: "creation_failed", code: err.code, message: err.message },
        { status: 500 },
      );
    }
    // Unexpected error — re-throw so Next.js error boundary catches it.
    throw err;
  }
}
