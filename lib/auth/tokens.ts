/**
 * lib/auth/tokens.ts — Magic-link JWT signing and verification.
 *
 * Uses jose (HS256, pure Web Crypto, Edge-safe) to sign 15-minute
 * magic-link tokens per D-07. The secret is read from JWT_SECRET at
 * module load and must be ≥32 bytes.
 *
 * Pattern: mirrors lib/gbrain/slug.ts's shape — a tight module of pure
 * functions with a module-level constant.
 *
 * Security:
 *   T-06-09: jose HS256 with a >=32-byte JWT_SECRET; jwtVerify validates
 *   signature and expiry; tampered tokens return reason:"invalid".
 *   T-06-10: jti (crypto.randomUUID) is used as the token identifier for
 *   the atomic single-use consume in lib/auth/store.ts::consumeMagicLink.
 */

import { SignJWT, jwtVerify, errors } from "jose";

// ---------------------------------------------------------------------------
// Module-level secret guard — fail loudly at startup, not at first request
// ---------------------------------------------------------------------------
const jwtSecretEnv = process.env.JWT_SECRET;
if (!jwtSecretEnv) {
  throw new Error(
    "lib/auth/tokens.ts: JWT_SECRET must be set (>=32 bytes for HS256)",
  );
}

const secret = new TextEncoder().encode(jwtSecretEnv);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IssueResult = {
  token: string;
  jti: string;
};

export type VerifyResult =
  | { ok: true; email: string; jti: string }
  | { ok: false; reason: "expired" | "invalid" };

// ---------------------------------------------------------------------------
// issueMagicToken
// ---------------------------------------------------------------------------

/**
 * Issue a signed magic-link JWT for the given email address.
 *
 * Token claims:
 *   - `email`: the target address (custom claim)
 *   - `iat`: issued-at (setIssuedAt)
 *   - `exp`: 15 minutes from now (D-07)
 *   - `jti`: a unique UUID — used as the atomic single-use key in magic_links
 *
 * @param email  Target email address
 * @returns      { token: string; jti: string }
 */
export async function issueMagicToken(email: string): Promise<IssueResult> {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setJti(jti)
    .sign(secret);
  return { token, jti };
}

// ---------------------------------------------------------------------------
// verifyMagicToken
// ---------------------------------------------------------------------------

/**
 * Verify a magic-link JWT and extract its claims.
 *
 * - Valid, unexpired token → `{ ok: true, email, jti }`
 * - Expired token → `{ ok: false, reason: "expired" }` (D-07 — clear "link expired" page)
 * - Tampered / garbage / any other error → `{ ok: false, reason: "invalid" }`
 *
 * clockTolerance: "30s" absorbs minor clock skew between issue and verify.
 *
 * @param token  The raw JWT string from the ?token= query parameter
 * @returns      VerifyResult
 */
export async function verifyMagicToken(token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      clockTolerance: "30s",
    });
    const email = payload["email"] as string | undefined;
    const jti = payload.jti as string | undefined;
    if (!email || !jti) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, email, jti };
  } catch (err) {
    if (err instanceof errors.JWTExpired) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}
