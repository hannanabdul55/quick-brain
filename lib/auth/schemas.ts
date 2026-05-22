import { z } from "zod";

/**
 * lib/auth/schemas.ts — Zod schemas for auth route body validation.
 *
 * Mirrors lib/chat/schemas.ts and lib/jobs/schemas.ts — a tight module of
 * zod schemas and inferred types with no I/O.
 *
 * Security:
 *   T-06-12: isSafeNextPath rejects open-redirect attempts via `//` and
 *   scheme prefixes before any redirect is performed (UI-SPEC Accessibility
 *   Contract).
 */

/**
 * Validates the POST /api/auth/send-link request body.
 *
 * - `email` is required and must be a valid email address
 * - `next` is optional; callers must additionally validate with isSafeNextPath
 *   before honoring the redirect (server-side open-redirect guard)
 */
export const sendLinkBodySchema = z.object({
  email: z.string().email("Enter a valid email address."),
  next: z.string().optional(),
});

export type SendLinkBody = z.infer<typeof sendLinkBodySchema>;

/**
 * Returns true only when `next` is safe to use as a same-origin redirect.
 *
 * A safe next path:
 *   - Is a non-empty string
 *   - Starts with a single `/`
 *   - Does NOT start with `//` (protocol-relative open redirect)
 *   - Does NOT start with `/\` (edge-case bypass — see OWASP)
 *   - Does NOT contain a scheme (`https://`, `http://`, etc.)
 *
 * This guard must be applied everywhere `?next=` is consumed
 * (send-link route when building the verify URL, verify route when redirecting).
 *
 * T-06-12: open-redirect mitigation.
 */
export function isSafeNextPath(next: string): boolean {
  if (!next || !next.startsWith("/")) return false;
  // Reject protocol-relative URLs (//evil.com)
  if (next.startsWith("//")) return false;
  // Reject Windows-style path-traversal bypass (/\evil)
  if (next.startsWith("/\\")) return false;
  // Reject any scheme prefix that snuck past the leading / check
  // (belt-and-suspenders: the startsWith("/") check above already blocks
  //  "https://..." but this also catches edge cases like "/https://...")
  if (/^\/[a-z][a-z0-9+\-.]*:\/\//i.test(next)) return false;
  return true;
}
