# Phase 5: Email Magic-Link Auth + Persistent Tenants — Research

**Researched:** 2026-05-19
**Domain:** Email auth, JWT tokens, bun:sqlite, Next.js 15 middleware, branded TypeScript types
**Confidence:** HIGH on all locked decisions (stack, patterns, pitfalls). The pre-locked choices (jose/HS256, bun:sqlite, Resend) are confirmed correct; this research surfaces exact implementation patterns.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | `/sign-in` page POSTs to `/api/auth/send-link` → Resend email within 5s | §3 Resend pattern; §9 AUTH_ENABLED flag |
| AUTH-02 | 15-min expiry signed JWT (jose, ES256) in URL; branded email | §1 jose token pattern |
| AUTH-03 | `/api/auth/verify` atomically marks jti used, sets 30-day cookie, redirects | §1 jwtVerify; §2 atomic UPDATE; §4 cookie set |
| AUTH-04 | Second magic-link click → "already used" message + fresh-link path | §2 rows-affected guard; §10 Pitfall 8 |
| AUTH-05 | Rate limit: 1 link/60s/email; sqlite-backed preferred | §6 rate-limit table pattern |
| AUTH-06 | `users` table with all columns including QBO phase-6 columns | §2 schema DDL |
| AUTH-07 | First sign-in auto-provisions brain_slug; subsequent sign-ins reuse | §2 upsert pattern; §4 redirect |
| AUTH-08 | `middleware.ts` protects `/dash/*` and `/api/qbo/*` | §4 middleware pattern |
| AUTH-09 | Sign-out clears cookie, redirects to `/` | §4 sign-out pattern |
| AUTH-10 | `AUTH_ENABLED=0` → anonymous flow unchanged; `AUTH_ENABLED=1` → `/sign-in` | §9 feature flag |
| AUTH-11 | BrainSlug branded type; mutex key stays brainSlug | §5 branded type pattern |
| AUTH-12 | panic-reset.sh gated on AUTH_ENABLED=0 or --force-real-tenants | §7 panic-reset hardening |
| AUTH-13 | demo-check.sh verifies RESEND_API_KEY, JWT_SECRET, TOKEN_ENCRYPTION_KEY ≥32 bytes | §3 env var checks |
| AUTH-14 | End-to-end smoke gate before phase close | §8 smoke gate extension |
</phase_requirements>

---

## Summary

Phase 5 layers email-only magic-link authentication onto the existing v1.0 anonymous onboarding stack. The implementation is straightforward because the pre-locked decisions are well-suited to the constraint set: `jose` 6.x is pure Web Crypto (no native bindings, works on Bun + Next.js middleware), `bun:sqlite` is Bun 1.2 built-in (zero install, synchronous API, safe in Route Handlers), and Resend's SDK is pure HTTP with no native deps. The riskiest parts are not the libraries — they are the integration seams: (1) `bun:sqlite` is only available in Node.js runtime routes, not Edge Runtime, which constrains where session verification can run; (2) Next.js 15 is on version 15.3.2 in this project, using `middleware.ts` / `export function middleware()` — NOT the newer `proxy.ts` convention from Next.js 16; (3) the Resend free tier restricts sending to `onboarding@resend.dev` until a custom domain is verified (a prerequisite the precondition spike must confirm).

The mutex key migration (AUTH-11) requires adding a branded `BrainSlug` type to `lib/gbrain/mutex.ts` and updating a single call site: `spawnGBrain` in `lib/gbrain/client.ts` which calls `withTenantLock(tenantId, ...)`. The current `tenantId` parameter is already equivalent to `brainSlug` — the branded type makes this constraint compile-time-visible without changing runtime semantics.

**Primary recommendation:** Implement in plan order — (1) DB schema + jose helpers, (2) send-link + verify endpoints + rate limit, (3) sign-in/check-email pages + middleware, (4) panic-reset hardening + demo-check.sh extension, (5) branded BrainSlug migration + mutex smoke gate.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Magic-link token issue + verify | API (Route Handlers) | — | Token signing requires secret key; must stay server-side |
| Session cookie set/clear | API (Route Handlers) | — | `Set-Cookie` headers cannot be set during streaming or from Edge for cookie writes |
| Route protection guard | Middleware (proxy layer) | — | Runs before every request; reads cookie from `NextRequest` |
| bun:sqlite user/token reads | API (Route Handlers, Node runtime) | — | bun:sqlite is Node-only; not available in Edge Runtime |
| Email delivery | API → Resend (external) | — | HTTP call to Resend API from Route Handler |
| Sign-in / check-email UI | Browser (Client Components) | — | Form state, loading state |
| AUTH_ENABLED flag routing | Middleware | app/page.tsx | Middleware redirects unauthenticated; page.tsx reads flag for hero CTA |
| BrainSlug branded type | API + middleware | lib/gbrain | Compile-time only; zero runtime overhead |
| Rate limit persistence | API (bun:sqlite) | — | Must survive restarts; sqlite preferred over in-memory Map |

---

## Standard Stack

### Core (Phase 5 additions — already present in prior research)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jose` | `6.2.3` | JWT sign + verify for magic-link tokens and session tokens | Pure Web Crypto API; zero native bindings; Bun-compatible; works in Next.js middleware |
| `resend` | `6.12.3` | Transactional email delivery | Pure HTTP SDK; no native deps; free tier 3k/month; first-class TypeScript |
| `bun:sqlite` | built-in (Bun 1.2) | Users, magic_tokens, rate_limits tables | Zero install; synchronous API; single-file DB; no ABI risk |
| `node:crypto` | built-in | AES-256-GCM encryption for QBO tokens column (schema lands in Phase 5) | Bun 1.2 Node.js compat layer fully supports node:crypto |

[VERIFIED: npm registry] `jose@6.2.3` — `npm view jose version` = `6.2.3`, first published 2014-02-27, source repo github.com/panva/jose
[VERIFIED: npm registry] `resend@6.12.3` — `npm view resend version` = `6.12.3`, first published 2017-02-25 (original package), source repo github.com/resend/resend-node

### Already in package.json (no new install needed)

| Library | Purpose |
|---------|---------|
| `zod` | Validate `/api/auth/send-link` body before accepting an email address |
| `node:child_process` | Unchanged; gbrain spawns still go through `withTenantLock(brainSlug, ...)` |

**Installation (only new packages):**
```bash
bun add jose resend
```

**Version verification (run before writing PLAN.md tasks):**
```bash
npm view jose version       # 6.2.3 as of 2026-05-19
npm view resend version     # 6.12.3 as of 2026-05-19
```

---

## Package Legitimacy Audit

> slopcheck was not installable on this system — all packages are tagged [ASSUMED] below. Planner must gate each install behind a `checkpoint:human-verify` task or use the manual verification evidence provided.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `jose` | npm | 11+ yrs (2014) | Very high (industry standard JWT lib) | github.com/panva/jose | unavailable → [ASSUMED] | Approved — panva/jose is the canonical JOSE implementation for Web Crypto environments, referenced in Next.js, Cloudflare Workers, and Deno official docs |
| `resend` | npm | 8+ yrs (registered 2017) | High (Resend is a well-known email provider) | github.com/resend/resend-node | unavailable → [ASSUMED] | Approved — official SDK from resend.com, no postinstall script, pure HTTP |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Manual verification evidence (substitutes for slopcheck):**
- `jose`: `npm view jose repository.url` = `git+https://github.com/panva/jose.git`; homepage = `https://github.com/panva/jose`. Well-established across all Web Crypto runtimes. [CITED: nextjs.org middleware docs reference jose for token verification]
- `resend`: `npm view resend repository.url` = `git+https://github.com/resend/resend-node.git`; no postinstall script detected. Official SDK maintained by Resend Inc.

---

## Section 1: jose Magic-Link JWT Pattern

### Algorithm Decision: HS256 (pragmatic hackathon path)

The pre-lock specifies ES256 in AUTH-02, but the v1.1 STACK.md research already resolved this to HS256 in practice. Here is the explicit rationale:

| Criterion | HS256 (symmetric) | ES256 (asymmetric) |
|-----------|-------------------|---------------------|
| Key management | One `JWT_SECRET` env var (32-byte hex) | Two env vars: PEM private key + PEM public key, or a JWK pair |
| Key generation | `openssl rand -hex 32` | `jose generateKeyPair('ES256')` → export PEM → store in env |
| Edge Runtime compat | Yes (Web Crypto HMAC) | Yes (Web Crypto ECDSA) |
| Security for magic-link | Sufficient — single server, secret never leaves process | Better for distributed systems; overkill for single-process Next.js |
| Implementation effort | 5 min | 20–30 min (key gen + PEM parsing + env management) |

**Recommendation: use HS256 with `JWT_SECRET`.** Document in PLAN comments that the architecture can be upgraded to ES256 by swapping `TextEncoder().encode(secret)` for `await importJWK(privateJwk)` — zero API change in caller code. AUTH-02 says "ES256" but the planner should accept HS256 with a code comment noting the upgrade path. If the operator wants strict AUTH-02 compliance, see the ES256 key-pair section below.

### HS256 Implementation (recommended)

```typescript
// lib/auth/tokens.ts
import { SignJWT, jwtVerify, errors } from "jose";

const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
// JWT_SECRET must be ≥ 32 bytes. Generate: openssl rand -hex 32

/** Issue a 15-minute one-time magic-link token. */
export async function issueMagicToken(email: string): Promise<{ token: string; jti: string }> {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setJti(jti)
    .sign(secret);
  return { token, jti };
}

/** Issue a 30-day session token. Payload carries userId and brainSlug. */
export async function issueSession(userId: string, brainSlug: string): Promise<string> {
  return new SignJWT({ userId, brainSlug })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export type MagicTokenPayload = { email: string; jti: string };
export type SessionPayload = { userId: string; brainSlug: string };

/**
 * Verify any token. Returns the payload or throws.
 * Callers must catch errors.JWTExpired and errors.JWSInvalid separately.
 */
export async function verifyToken(token: string) {
  return jwtVerify(token, secret, {
    clockTolerance: "30s",  // allow 30s clock skew — sufficient for demo
  });
}
```

[CITED: npmjs.com/package/jose — HS256 SignJWT pattern]
[CITED: WebSearch: jose jwtVerify clockTolerance option confirmed]

### ES256 Variant (if AUTH-02 must be met verbatim)

```typescript
// Key generation (run once, store output in env):
import { generateKeyPair, exportPKCS8, exportSPKI } from "jose";
const { privateKey, publicKey } = await generateKeyPair("ES256");
const privatePem = await exportPKCS8(privateKey);   // → ES256_PRIVATE_KEY env var
const publicPem  = await exportSPKI(publicKey);     // → ES256_PUBLIC_KEY env var

// Usage in Route Handler (Node runtime only — avoid Edge for this):
import { importPKCS8, importSPKI } from "jose";
const priv = await importPKCS8(process.env.ES256_PRIVATE_KEY!, "ES256");
const pub  = await importSPKI(process.env.ES256_PUBLIC_KEY!, "ES256");

const token = await new SignJWT({ email })
  .setProtectedHeader({ alg: "ES256" })
  .setIssuedAt()
  .setExpirationTime("15m")
  .setJti(jti)
  .sign(priv);

const { payload } = await jwtVerify(token, pub);
```

[ASSUMED] ES256 key-pair generation API — training knowledge, not verified against Context7 this session. The pattern is stable (jose has not changed these APIs in v4–v6).

### Error Handling

jose exports named error classes from the `errors` sub-export. Distinguish expired vs. invalid signature for user-friendly UI:

```typescript
import { errors } from "jose";

try {
  const { payload } = await verifyToken(token);
  // use payload
} catch (err) {
  if (err instanceof errors.JWTExpired) {
    // 15-min window passed — show "link expired, request a new one"
    return redirect("/sign-in?error=link-expired");
  }
  if (err instanceof errors.JWSInvalid || err instanceof errors.JWTInvalid) {
    // Tampered token or wrong secret — show generic error
    return redirect("/sign-in?error=invalid-link");
  }
  throw err;  // unexpected error — let Next.js error boundary handle it
}
```

[CITED: WebSearch — jose exports JWTExpired, JWSInvalid, JWTInvalid from `errors` namespace]

### Runtime Constraints

- `jose` works in both Edge Runtime and Node.js runtime — no constraint here.
- **`bun:sqlite` is Node.js runtime only** — the `/api/auth/verify` route that reads `magic_tokens` MUST NOT run in Edge Runtime. Ensure no `export const runtime = "edge"` in auth route files.
- The `middleware.ts` session check (read cookie → call `verifyToken`) CAN use jose because it's pure Web Crypto. Middleware runs in Node.js runtime as of Next.js 15.2+ (Node.js middleware stable in 15.5; Edge is still the default unless opted in). In Next.js 15.3.2, middleware defaults to the Edge Runtime. **jose is safe in Edge**; bun:sqlite is NOT.

---

## Section 2: bun:sqlite Schema + Migration Pattern

### Database Initialization Pattern

```typescript
// lib/db/client.ts
import { Database } from "bun:sqlite";
import { resolve } from "node:path";

// Path: data/quickbrain-app.sqlite (gitignored — see .gitignore addition below)
const DB_PATH = resolve(process.cwd(), "data", "quickbrain-app.sqlite");

const db = new Database(DB_PATH, { create: true });

// WAL mode: writers don't block readers. Required for Next.js Route Handlers
// which can be called concurrently.
db.run("PRAGMA journal_mode=WAL;");

// busy_timeout: wait up to 5s before throwing SQLITE_BUSY on write contention.
// In bun:sqlite, set via PRAGMA (not a constructor option).
db.run("PRAGMA busy_timeout=5000;");

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id                    TEXT PRIMARY KEY,
    email                 TEXT UNIQUE NOT NULL,
    brain_slug            TEXT UNIQUE,        -- null until first verify completes
    qbo_realm_id          TEXT,               -- Phase 6 — nullable
    qbo_tokens_encrypted  TEXT,               -- Phase 6 — AES-256-GCM blob
    created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
    last_login_at         INTEGER
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS magic_tokens (
    jti        TEXT PRIMARY KEY,
    email      TEXT NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0,   -- 1 = consumed; never reuse
    expires_at INTEGER NOT NULL              -- unix timestamp
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS rate_limits (
    email        TEXT PRIMARY KEY,
    last_sent_at INTEGER NOT NULL            -- unix timestamp of last send
  );
`);

// Indexes for hot paths
db.run("CREATE INDEX IF NOT EXISTS idx_magic_tokens_email ON magic_tokens(email);");
db.run("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);");

export { db };
```

[CITED: bun.com/docs/runtime/sqlite — Database open, WAL, prepare/run, .changes]
[ASSUMED] PRAGMA busy_timeout syntax — confirmed by SQLite docs patterns; bun:sqlite exposes the raw PRAGMA interface.

### Atomic Single-Use Token Guard (AUTH-03 / AUTH-04)

The single-use invariant is enforced atomically with a single UPDATE + rows-affected check. **Do NOT pre-SELECT to check `used=0` and then UPDATE — that is a TOCTOU race.** [CITED: WebSearch — race conditions in single-use token guard]

```typescript
// lib/auth/magic-tokens.ts
import { db } from "@/lib/db/client";

export type RedeemResult =
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "expired" | "already_used" };

export function redeemMagicToken(jti: string): RedeemResult {
  // 1. Fetch the row first to distinguish "not found" from "already used"
  const row = db
    .prepare("SELECT email, used, expires_at FROM magic_tokens WHERE jti = ?")
    .get(jti) as { email: string; used: number; expires_at: number } | undefined;

  if (!row) return { ok: false, reason: "not_found" };
  if (row.expires_at < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };
  if (row.used === 1) return { ok: false, reason: "already_used" };

  // 2. Atomic mark-used: only succeeds if still unused at DB level
  const result = db
    .prepare("UPDATE magic_tokens SET used = 1 WHERE jti = ? AND used = 0")
    .run(jti);

  // result.changes === 0 means another request beat us (concurrent redemption race)
  if (result.changes === 0) return { ok: false, reason: "already_used" };

  return { ok: true, email: row.email };
}

export function storeMagicToken(jti: string, email: string, expiresAt: number): void {
  db.prepare(
    "INSERT INTO magic_tokens (jti, email, used, expires_at) VALUES (?, ?, 0, ?)"
  ).run(jti, email, expiresAt);
}
```

[CITED: bun.com/docs/runtime/sqlite — `.run()` returns `{ changes: number }`]

### User Upsert Pattern (AUTH-07)

```typescript
// lib/auth/users.ts
import { db } from "@/lib/db/client";
import { randomUUID } from "node:crypto";

export type UserRow = {
  id: string;
  email: string;
  brain_slug: string | null;
  created_at: number;
  last_login_at: number | null;
};

/** Get or create a user by email. Returns userId and brainSlug (may be null if first visit). */
export function getOrCreateUser(email: string): UserRow {
  const existing = db
    .prepare("SELECT id, email, brain_slug, created_at, last_login_at FROM users WHERE email = ?")
    .get(email) as UserRow | undefined;
  if (existing) return existing;

  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, email) VALUES (?, ?)"
  ).run(id, email);

  return { id, email, brain_slug: null, created_at: Math.floor(Date.now() / 1000), last_login_at: null };
}

/** Assign brain_slug to user on first verify. Idempotent (noop if already set). */
export function assignBrainSlug(userId: string, brainSlug: string): void {
  db.prepare(
    "UPDATE users SET brain_slug = ?, last_login_at = unixepoch() WHERE id = ? AND brain_slug IS NULL"
  ).run(brainSlug, userId);
}

/** Update last_login_at on each verify for existing users. */
export function touchLastLogin(userId: string): void {
  db.prepare("UPDATE users SET last_login_at = unixepoch() WHERE id = ?").run(userId);
}
```

### brain_slug Generation (AUTH-07)

New users get a UUID-prefixed slug: `u-<first8charsOfUUID>-<sanitizedBusinessFragment>`. For Phase 5 (no onboarding form on the auth path), use a simpler pattern:

```typescript
// lib/auth/brain-slug.ts
import { randomUUID } from "node:crypto";

/**
 * Generate a stable, unique brain slug for a new user.
 * Pattern: u-<8 hex chars>   (e.g. "u-7a2c3b1f")
 * Guarantees: lowercase, a-z0-9 with hyphens, ≤40 chars — passes TENANT_SLUG_REGEX.
 */
export function generateUserBrainSlug(): string {
  const uuid = randomUUID().replace(/-/g, "").slice(0, 8);
  return `u-${uuid}`;
}
```

[ASSUMED] UUID prefix format — matches AUTH-07 example `u-7a2c-coffee`; the coffee fragment comes from a business name field that does not exist in the magic-link auth flow (no onboarding form for signed-in users). Use the 8-char UUID suffix only.

### Migration Story

Phase 5 uses a single embedded schema (in `lib/db/client.ts`) with `CREATE TABLE IF NOT EXISTS` on every startup. This is acceptable for a hackathon:

- **First boot:** creates `data/quickbrain-app.sqlite` with all three tables.
- **Schema changes (e.g., adding a column):** for Phase 5 → 6 migration, add a `CREATE TABLE IF NOT EXISTS` and an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in client.ts init block. bun:sqlite supports `PRAGMA user_version` for tracking schema versions if needed.
- **Wipe and rebuild:** `rm data/quickbrain-app.sqlite` + restart resets all auth state. Real users lose their accounts — this is the `panic-reset.sh` concern (AUTH-12).

**Gitignore:** add `data/*.sqlite` to `.gitignore`. The `data/maras-coffee/` markdown files are committed; the SQLite DB is not.

```gitignore
# Add to .gitignore:
data/*.sqlite
data/*.sqlite-shm
data/*.sqlite-wal
```

---

## Section 3: Resend Email — Concrete Pattern

### SDK Integration

```typescript
// lib/email/client.ts
import { Resend } from "resend";

// Singleton — safe to import at module level in Route Handlers
const resend = new Resend(process.env.RESEND_API_KEY!);

export async function sendMagicLink(
  to: string,
  magicLinkUrl: string,
): Promise<void> {
  const { error } = await resend.emails.send({
    from: "QuickBrain <noreply@yourdomain.com>",  // SPIKE: verify domain first
    to,
    subject: "Your QuickBrain sign-in link",
    html: magicLinkHtml(magicLinkUrl),
  });
  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}

function magicLinkHtml(url: string): string {
  return `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">Sign in to QuickBrain</h2>
  <p style="color:#444">Click the button below to sign in. This link expires in 15 minutes.</p>
  <a href="${url}"
     style="display:inline-block;background:#000;color:#fff;padding:12px 24px;
            border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0">
    Sign in to QuickBrain
  </a>
  <p style="color:#888;font-size:13px;margin-top:24px">
    If you did not request this link, you can safely ignore this email.
    Someone may have entered your email address by mistake.
  </p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#bbb;font-size:12px">QuickBrain · Your business brain in 60 seconds</p>
</body>
</html>
  `.trim();
}
```

[CITED: resend.com/docs/send-with-nodejs — `resend.emails.send()` API shape]

### Sending Domain — CRITICAL PRECONDITION

**Free tier restriction:** Resend allows sending from `onboarding@resend.dev` ONLY for testing (recipients must be verified in the dashboard). For sending to arbitrary addresses (e.g., the operator's own Gmail for the sign-in spike), a verified custom domain is required.

**What the 30-minute precondition spike must confirm:**
1. Send from `onboarding@resend.dev` → `hannanmannankanji@gmail.com` — does it arrive in primary inbox?
2. If yes: use `onboarding@resend.dev` for the demo. Note: this is a Resend-controlled test address; do not use for production.
3. If spam: add a custom domain in the Resend dashboard, add SPF + DKIM DNS records, wait for propagation (typically 5–30 minutes on modern DNS providers), then send from `noreply@<your-domain>`.

**SPF/DKIM setup (if needed):**
- Resend provides the DNS records in the dashboard after adding a domain.
- Add two TXT records: one for SPF (`v=spf1 include:amazonses.com ~all` or Resend-provided equivalent), one for DKIM (a long `p=` public key string).
- Do NOT use `onboarding@resend.dev` for the demo if primary inbox delivery is not confirmed — magic links landing in spam breaks the AUTH-14 smoke gate.

[CITED: resend.com/docs/dashboard/domains/introduction — SPF/DKIM required for custom domain]
[CITED: resend.com/blog/new-free-tier — 100 emails/day, 3000/month free]

### Latency Expectations

Resend routes through Amazon SES infrastructure. API call → delivery latency:
- API call returns within ~200–500ms (just queues the send).
- Primary inbox delivery: typically 2–8s from API call to inbox appearance.
- The AUTH-01 requirement ("within 5 seconds") refers to the API call completing, not inbox delivery. Structure the Route Handler to: validate → issue token → store jti → call Resend API (await) → return 200. If `resend.emails.send()` takes >4.5s, it is a Resend infrastructure issue, not a code issue.

[ASSUMED] Resend latency 2–8s — training knowledge; verify during spike.

### Environment Variable Check (AUTH-13 extension)

In `scripts/demo-check.sh`, add:

```bash
# RESEND_API_KEY
if [ -n "${RESEND_API_KEY:-}" ]; then
  if [ ${#RESEND_API_KEY} -ge 32 ]; then
    green "  [ok] RESEND_API_KEY set (${#RESEND_API_KEY} chars)"
  else
    red "  [FAIL] RESEND_API_KEY too short (got ${#RESEND_API_KEY}, need ≥32)"
    FAIL=1
  fi
else
  red "  [FAIL] RESEND_API_KEY is unset"
  FAIL=1
fi

# JWT_SECRET
if [ -n "${JWT_SECRET:-}" ] && [ ${#JWT_SECRET} -ge 32 ]; then
  green "  [ok] JWT_SECRET set (${#JWT_SECRET} chars)"
else
  red "  [FAIL] JWT_SECRET missing or < 32 chars"
  FAIL=1
fi

# TOKEN_ENCRYPTION_KEY
if [ -n "${TOKEN_ENCRYPTION_KEY:-}" ] && [ ${#TOKEN_ENCRYPTION_KEY} -ge 32 ]; then
  green "  [ok] TOKEN_ENCRYPTION_KEY set (${#TOKEN_ENCRYPTION_KEY} chars)"
else
  red "  [FAIL] TOKEN_ENCRYPTION_KEY missing or < 32 chars"
  FAIL=1
fi
```

---

## Section 4: Next.js 15 App Router Auth Wiring

### CRITICAL: This Project Runs Next.js 15.3.2 — Use `middleware.ts`, NOT `proxy.ts`

Next.js 16 renamed `middleware.ts` → `proxy.ts` and `export function middleware` → `export function proxy`. This project is on **Next.js 15.3.2** (verified in `package.json`). Use the v15 convention:

```
middleware.ts          ← correct for Next.js 15.x
export function middleware(request: NextRequest) { ... }
```

Do NOT use `proxy.ts` or `export function proxy` — that is Next.js 16+ only and will break on the current version.

[VERIFIED: package.json] `"next": "^15.3.2"`
[CITED: nextjs.org/docs — proxy.ts is the Next.js 16 rename of middleware.ts, version history confirms v16.0.0 change]

### middleware.ts Pattern (AUTH-08, AUTH-10)

```typescript
// middleware.ts (at repo root, same level as app/)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Must be importable from Edge — jose is fine here; bun:sqlite is NOT
const secret = new TextEncoder().encode(process.env.JWT_SECRET!);

// Paths that require authentication when AUTH_ENABLED=1
const PROTECTED_PREFIXES = ["/dash", "/api/qbo"];

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const authEnabled = process.env.AUTH_ENABLED !== "0";

  // AUTH-10: when AUTH_ENABLED=0, skip all auth checks
  if (!authEnabled) {
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (!isProtected) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get("qb_session")?.value;
  if (!sessionCookie) {
    const next = encodeURIComponent(pathname);
    return NextResponse.redirect(new URL(`/sign-in?next=${next}`, request.url));
  }

  try {
    await jwtVerify(sessionCookie, secret, { clockTolerance: "30s" });
    return NextResponse.next();
  } catch {
    // Invalid or expired session — clear cookie + redirect
    const response = NextResponse.redirect(
      new URL(`/sign-in?error=session-expired`, request.url)
    );
    response.cookies.delete("qb_session");
    return response;
  }
}

export const config = {
  matcher: [
    // Run middleware only on dash and qbo API paths — skip static assets
    "/dash/:path*",
    "/api/qbo/:path*",
  ],
};
```

[CITED: nextjs.org/docs/app/api-reference/file-conventions/proxy (migration guide)] — middleware.ts pattern and config.matcher array syntax
[CITED: nextjs.org middleware docs — `request.cookies.get()` API available in NextRequest]

### Runtime Constraint: Middleware Uses Edge by Default in Next.js 15

In Next.js 15.3.x, middleware runs in the Edge Runtime by default. jose is safe in Edge. bun:sqlite is NOT safe in Edge. This means:

- **middleware.ts:** can use `jose jwtVerify` — OK.
- **middleware.ts:** CANNOT import `from "@/lib/db/client"` — bun:sqlite will throw at module load time.
- **`/api/auth/verify` route:** must NOT set `export const runtime = "edge"`. Omit the export (defaults to Node.js for Route Handlers).

As of Next.js 15.5 (stable), middleware can opt into Node.js runtime with `export const runtime = "nodejs"` in middleware.ts. Since this project is on 15.3.2, do NOT use that option — it is not available. Design middleware to be pure Edge-safe (jose only, no bun:sqlite).

[CITED: nextjs.org version history — Node.js runtime for middleware stable in v15.5.0; v15.3.2 is pre-stable]

### Cookie Set in Route Handler (AUTH-03, AUTH-09)

```typescript
// In /api/auth/verify route handler (Node runtime — no edge export):
import { cookies } from "next/headers";

// Set session cookie
const cookieStore = await cookies();
cookieStore.set("qb_session", sessionToken, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",        // lax required for magic-link cross-site redirect (see §10 Pitfall 4)
  maxAge: 60 * 60 * 24 * 30,  // 30 days in seconds
  path: "/",
});
```

```typescript
// In /api/auth/sign-out:
const cookieStore = await cookies();
cookieStore.set("qb_session", "", { maxAge: 0 });
return NextResponse.redirect(new URL("/", request.url));
```

[CITED: nextjs.org/docs/app/api-reference/functions/cookies — set options: httpOnly, secure, sameSite, maxAge]

### app/page.tsx Redirect Logic (AUTH-10)

```typescript
// app/page.tsx — server component
export default async function Home() {
  const authEnabled = process.env.AUTH_ENABLED !== "0";
  if (authEnabled) {
    // When AUTH_ENABLED=1, redirect / → /sign-in
    redirect("/sign-in");
  }
  // When AUTH_ENABLED=0, render the v1.0 anonymous hero
  return <AnonymousHeroPage />;
}
```

### next param Round-Trip (AUTH-08 → AUTH-03)

When middleware redirects unauthenticated users to `/sign-in?next=/dash/u-7a2c3b1f`, the sign-in page must preserve this `next` param through the magic-link round-trip so the verify endpoint can redirect to the original destination.

```
Flow:
1. User visits /dash/u-7a2c3b1f (unauthenticated)
2. middleware → redirect → /sign-in?next=%2Fdash%2Fu-7a2c3b1f
3. sign-in page: render form with next param hidden
4. POST /api/auth/send-link { email, next: "/dash/u-7a2c3b1f" }
5. Magic link URL: /api/auth/verify?token=<jwt>&next=%2Fdash%2Fu-7a2c3b1f
6. /api/auth/verify: verify token → set cookie → redirect to next (or /dash/<brainSlug>)
```

The `next` param is carried in the magic link URL itself. Store it as a query param in the link, not in the JWT payload (keeps token smaller; next param is not sensitive).

---

## Section 5: BrainSlug Branded Type + Mutex Migration (AUTH-11)

### Current Call Sites of `withTenantLock`

The only call site of `withTenantLock` in the production codebase is in `lib/gbrain/client.ts`:

```typescript
// lib/gbrain/client.ts (line 23 approximately):
export function spawnGBrain(args: string[], opts: SpawnGBrainOpts): Promise<GBrainResult> {
  const tenantId = assertTenantSlug(opts.tenantId);
  return withTenantLock(tenantId, () => runOnce(args, { ...opts, tenantId }));
  //                   ^^^^^^^^ this is the only production call site
}
```

`pendingTenants()` is called in `scripts/mutex-smoke.ts` only (not production code).

**No Route Handler directly calls `withTenantLock`.** All gbrain operations go through `spawnGBrain`. This means the branded type migration touches exactly two files: `lib/gbrain/mutex.ts` (parameter type) and `lib/gbrain/client.ts` (mint the BrainSlug at entry).

### Branded Type Implementation

```typescript
// lib/gbrain/brain-slug.ts  (NEW FILE)
//
// Branded TypeScript type for brain slugs used as mutex keys.
// Prevents accidentally passing a userId or tenantId where a brainSlug is expected.
// This is a compile-time-only constraint — zero runtime overhead.

export type BrainSlug = string & { readonly __brand: "BrainSlug" };

/**
 * Mint a BrainSlug from a validated string.
 * Use only after assertTenantSlug() confirms the format is correct.
 */
export function asBrainSlug(s: string): BrainSlug {
  return s as BrainSlug;
}

/**
 * Runtime guard for API boundaries.
 * Throws if the string doesn't match TENANT_SLUG_REGEX.
 * Use at Route Handler entry points before passing to spawnGBrain.
 */
export function assertBrainSlug(s: string): BrainSlug {
  // Reuse existing assertTenantSlug which throws on invalid format
  const { assertTenantSlug } = require("./slug.ts");
  assertTenantSlug(s);
  return s as BrainSlug;
}
```

### Updated mutex.ts

```typescript
// lib/gbrain/mutex.ts (MODIFIED — type annotation only, no logic change)
import type { BrainSlug } from "./brain-slug.ts";

// Queue is keyed by BrainSlug. Different tenants run in parallel; same
// tenant serializes. The branded type prevents userId keys silently diverging
// from filesystem identity (PGLite lock contention regression).
const queues = new Map<BrainSlug, Promise<unknown>>();

export function withTenantLock<T>(brainSlug: BrainSlug, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(brainSlug) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(brainSlug, next);
  next.finally(() => {
    if (queues.get(brainSlug) === next) queues.delete(brainSlug);
  }).catch(() => {});
  return next;
}

export function pendingTenants(): BrainSlug[] {
  return Array.from(queues.keys());
}
```

### Updated client.ts call site

```typescript
// lib/gbrain/client.ts (MODIFIED — two lines change)
import { asBrainSlug } from "./brain-slug.ts";

export function spawnGBrain(args: string[], opts: SpawnGBrainOpts): Promise<GBrainResult> {
  const tenantId = assertTenantSlug(opts.tenantId);
  const brainSlug = asBrainSlug(tenantId);   // ← mint BrainSlug after validation
  return withTenantLock(brainSlug, () => runOnce(args, { ...opts, tenantId }));
  //                   ^^^^^^^^^^ typed as BrainSlug now
}
```

### TenantRecord Update (AUTH-11)

```typescript
// lib/gbrain/tenants.ts (MODIFIED — add userId field)
import type { BrainSlug } from "./brain-slug.ts";

export type TenantRecord = {
  id: string;           // brainSlug (filesystem identity, mutex key)
  brainHome: string;
  status: TenantStatus;
  createdAt: number;
  userId?: string;      // NEW — set when AUTH_ENABLED=1 and user is authenticated
  name?: string;
  businessType?: string;
  ownerName?: string;
};
```

Note: `TenantRecord.id` is already the `brainSlug` in v1.0. The `userId` field is additive. No rename required.

### mutex-smoke.ts Regression (AUTH-14)

The existing `scripts/mutex-smoke.ts` tests the mutex with string keys. After the branded type migration, update Test 1's key from `"seed"` to `asBrainSlug("seed")` to satisfy TypeScript:

```typescript
// scripts/mutex-smoke.ts (MODIFIED — import + key minting)
import { withTenantLock, pendingTenants } from "../lib/gbrain/mutex.ts";
import { asBrainSlug } from "../lib/gbrain/brain-slug.ts";

// Test 1: same-tenant work serializes
await Promise.all(
  [1, 2, 3].map(() =>
    withTenantLock(asBrainSlug("seed"), async () => { ... })
  )
);
```

---

## Section 6: Rate Limiting (AUTH-05)

### bun:sqlite-Backed Rate Limit (preferred over in-memory Map)

Rationale: the `rate_limits` table is already part of the schema in §2. sqlite-backed survives process restarts; the demo smoke gate expects deterministic behavior even after a `panic-reset.sh` cycle.

```typescript
// lib/auth/rate-limit.ts
import { db } from "@/lib/db/client";

const RATE_LIMIT_WINDOW_SECONDS = 60;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function checkRateLimit(email: string): RateLimitResult {
  const row = db
    .prepare("SELECT last_sent_at FROM rate_limits WHERE email = ?")
    .get(email) as { last_sent_at: number } | undefined;

  const now = Math.floor(Date.now() / 1000);

  if (!row) {
    // First request — upsert timestamp
    db.prepare(
      "INSERT OR REPLACE INTO rate_limits (email, last_sent_at) VALUES (?, ?)"
    ).run(email, now);
    return { allowed: true };
  }

  const elapsed = now - row.last_sent_at;
  if (elapsed < RATE_LIMIT_WINDOW_SECONDS) {
    return { allowed: false, retryAfterSeconds: RATE_LIMIT_WINDOW_SECONDS - elapsed };
  }

  // Update timestamp
  db.prepare("UPDATE rate_limits SET last_sent_at = ? WHERE email = ?").run(now, email);
  return { allowed: true };
}
```

### Route Handler Integration Pattern

```typescript
// app/api/auth/send-link/route.ts
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getOrCreateUser } from "@/lib/auth/users";
import { issueMagicToken } from "@/lib/auth/tokens";
import { storeMagicToken } from "@/lib/auth/magic-tokens";
import { sendMagicLink } from "@/lib/email/client";
import { z } from "zod";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid_email" }, { status: 400 });
  }

  const { email, next } = parsed.data;

  // Rate limit check
  const rl = checkRateLimit(email);
  if (!rl.allowed) {
    return Response.json(
      { error: "rate_limited", retryAfterSeconds: rl.retryAfterSeconds },
      { status: 429 }
    );
  }

  // Issue token (15 min)
  const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
  const { token, jti } = await issueMagicToken(email);
  storeMagicToken(jti, email, expiresAt);

  // Build magic link URL
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const url = new URL(`${base}/api/auth/verify`);
  url.searchParams.set("token", token);
  if (next) url.searchParams.set("next", next);

  // Send email (await — must complete within request)
  await sendMagicLink(email, url.toString());

  return Response.json({ ok: true });
}
```

---

## Section 7: panic-reset.sh Hardening (AUTH-12)

### Current State

`scripts/panic-reset.sh` currently: kills Next.js + gbrain processes, wipes all `brains/*` except `seed`. It does NOT know about real users and does NOT check `AUTH_ENABLED`.

### Required Changes

```bash
#!/usr/bin/env bash
# DEMO-02 (extended AUTH-12): Terminal panic-reset for the QuickBrain demo.
# ... (existing header comments) ...
#
# AUTH_ENABLED behavior:
#   AUTH_ENABLED=0 (default): wipes brain dirs except seed. No user data prompt.
#   AUTH_ENABLED=1 (real tenants): refuses to run without --force-real-tenants flag.
#     With --force-real-tenants: prints affected user emails, prompts for confirmation.

set -uo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd )"
DB_PATH="${REPO_ROOT}/data/quickbrain-app.sqlite"

FORCE_REAL=0
for arg in "$@"; do
  [ "$arg" = "--force-real-tenants" ] && FORCE_REAL=1
done

AUTH_ENABLED="${AUTH_ENABLED:-0}"

# Gate: if AUTH_ENABLED=1 and no --force-real-tenants, refuse
if [ "$AUTH_ENABLED" = "1" ] && [ $FORCE_REAL -eq 0 ]; then
  echo "[panic-reset] ERROR: AUTH_ENABLED=1 (real users exist)."
  echo "[panic-reset] Run with --force-real-tenants to confirm you want to wipe real user data."
  echo "[panic-reset] This will delete all user accounts and their brain dirs."
  exit 1
fi

# If AUTH_ENABLED=1 and --force-real-tenants passed, show affected users
if [ "$AUTH_ENABLED" = "1" ] && [ $FORCE_REAL -eq 1 ]; then
  if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DB_PATH" ]; then
    echo "[panic-reset] Real users affected:"
    sqlite3 "$DB_PATH" "SELECT email FROM users;" | while read -r email; do
      echo "[panic-reset]   - $email"
    done
  else
    echo "[panic-reset] WARNING: Cannot enumerate users (sqlite3 not on PATH or DB not found)"
  fi
  echo ""
  read -r -p "[panic-reset] Type 'yes' to confirm deletion of all real user data: " confirm
  if [ "$confirm" != "yes" ]; then
    echo "[panic-reset] Aborted."
    exit 1
  fi
fi

# ... (existing kill + wipe logic unchanged) ...
```

**Note:** The `sqlite3` CLI (not bun:sqlite) is used for the shell-based panic-reset query. `sqlite3` is available on macOS via Homebrew or pre-installed. If not available, fall back to a warning. The planner should add a `sqlite3` availability check to demo-check.sh.

---

## Section 8: Mutex Smoke Regression Test Extension (AUTH-14)

### Current mutex-smoke.ts

Tests 4 behavioral invariants (serialization, parallelism, post-reject recovery, queue cleanup) using sleep-based mocks — no actual `gbrain` CLI calls. This is correct and fast.

### Extension: 5 Concurrent BrainSlug-Typed Calls

Add Test 5 to the existing script. The test validates that:
1. The BrainSlug-typed `withTenantLock` correctly serializes 5 concurrent calls to the same brainSlug.
2. A userId string literal causes a TypeScript compile error (not a runtime test).

```typescript
// Test 5: BrainSlug typed mutex — 5 concurrent calls, same slug (AUTH-11)
{
  const slug = asBrainSlug("seed");
  const order: number[] = [];
  const start = Date.now();

  await Promise.all(
    [1, 2, 3, 4, 5].map((n) =>
      withTenantLock(slug, async () => {
        order.push(n);
        await sleep(100);
      }),
    ),
  );

  // All 5 must have run (mutex didn't drop any)
  const ok = order.length === 5;
  // Total time must be ≥ 5 * 100ms (serialized, not parallel)
  const elapsed = Date.now() - start;
  const serialized = elapsed >= 450;  // allow 50ms slack

  console.log(
    `[mutex] AUTH-11 BrainSlug 5-concurrent: ${ok && serialized ? "PASS" : "FAIL"} ` +
    `(ran=${order.length}/5, elapsed=${elapsed}ms)`,
  );
  if (!ok || !serialized) failed++;
}
```

Note: The compile-time enforcement of BrainSlug is verified by TypeScript, not by the runtime test. Add a comment in the test file explaining that `withTenantLock("raw-string", ...)` should produce a TS error after the migration.

### No gbrain CLI in Smoke Test

The mutex-smoke.ts intentionally does NOT call gbrain (no API keys needed). This is the right design. The AUTH-14 end-to-end smoke gate is a separate manual flow (sign-in → verify → dashboard → reload → sign-out → `/dash/*` redirect).

---

## Section 9: AUTH_ENABLED Feature Flag

### Centralized Config Helper

Avoid scattered `process.env.AUTH_ENABLED !== "0"` checks. One helper, used everywhere:

```typescript
// lib/config.ts
export const config = {
  /**
   * AUTH_ENABLED=1: email sign-in required; anonymous /onboard disabled.
   * AUTH_ENABLED=0 (default): anonymous /onboard works; middleware skips auth checks.
   */
  authEnabled: process.env.AUTH_ENABLED === "1",

  /** Cookie name for the session JWT. */
  sessionCookieName: "qb_session",

  /** App base URL — used for building magic link URLs. */
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
} as const;
```

### Implication Checklist

| Location | AUTH_ENABLED=0 behavior | AUTH_ENABLED=1 behavior |
|----------|------------------------|------------------------|
| `middleware.ts` | `NextResponse.next()` immediately | verify `qb_session` cookie |
| `app/page.tsx` | render anonymous hero | `redirect("/sign-in")` |
| `app/onboard/page.tsx` | works as v1.0 | show "Sign in to access" or redirect |
| `app/api/tenants/route.ts` | works as v1.0 | optionally requires session (or leaves anonymous) |
| `scripts/panic-reset.sh` | wipes freely | requires --force-real-tenants |

**v1.0 regression guarantee:** With `AUTH_ENABLED=0`, no auth code path executes during the anonymous demo flow. The middleware matcher only runs on `/dash/*` and `/api/qbo/*` — the `/onboard` and `/api/tenants` paths are not in the matcher. The `app/page.tsx` redirect is conditional on `config.authEnabled`. The anonymous path is fully preserved.

---

## Section 10: Common Pitfalls

### Pitfall 1: bun:sqlite in Edge Runtime crashes at module load
**What goes wrong:** `lib/db/client.ts` imports `Database from "bun:sqlite"`. If any file in the Edge Runtime module graph imports this (even transitively), Next.js throws `Module not found: Can't resolve 'bun:sqlite'` at build time or silently fails at runtime.
**Why:** `bun:sqlite` is a Bun built-in only available in Node.js runtime processes. The Next.js 15 middleware defaults to Edge Runtime.
**How to avoid:** Never import `lib/db/client.ts` in `middleware.ts`. Keep auth Route Handlers without `export const runtime = "edge"`. Add an ESLint rule or a comment banner on `lib/db/client.ts` noting the Node-only constraint.
**Warning signs:** TypeScript compiles fine but `next build` throws `Error: Cannot find module 'bun:sqlite'` during the Edge bundle phase.

### Pitfall 2: Pre-SELECT + UPDATE race on magic token redemption
**What goes wrong:** Code reads `SELECT used FROM magic_tokens WHERE jti=?` → checks `used === 0` → calls `UPDATE … SET used=1`. Two concurrent redemption requests both read `used=0` before either UPDATE lands. Both succeed. Token is redeemed twice.
**Why:** SELECT + UPDATE is not atomic without explicit locking.
**How to avoid:** Use the pattern in §2: `UPDATE … WHERE jti=? AND used=0` → check `result.changes === 0`. The WHERE clause is the guard. The UPDATE is atomic. No pre-SELECT needed for the guard (only for returning the email — do that in a separate SELECT after the UPDATE succeeds).
**Warning signs:** AUTH-04 smoke gate fails; a second click on the same link succeeds when it shouldn't.

### Pitfall 3: SameSite=Strict breaks magic-link redirect
**What goes wrong:** The magic-link URL opens from the user's email client. This is a cross-site navigation (from `mail.google.com` or the email app to `localhost:3000`). With `SameSite=Strict`, the browser does NOT send the session cookie on the first navigation. The user lands on `/dash/<slug>` without a session cookie — middleware redirects them to `/sign-in` even though they just verified.
**Why:** `Strict` blocks cookies on ALL cross-site navigations, including safe GET navigations from email links.
**How to avoid:** Use `SameSite=Lax`. Lax sends cookies on top-level GET navigations (clicking links), which is exactly the magic-link flow. CSRF protection is maintained for POST requests. This is the standard recommendation for magic-link auth.
**Warning signs:** Verify → set cookie → redirect to `/dash/<slug>` → middleware sees no cookie → redirect back to `/sign-in` in a loop.

### Pitfall 4: JWT_SECRET less than 32 bytes breaks HS256 security
**What goes wrong:** Using a weak `JWT_SECRET` (e.g., "mysecret") makes HMAC trivially brutable. A magic-link token signed with a weak secret can be forged.
**Why:** HS256 security is directly proportional to key entropy.
**How to avoid:** Generate with `openssl rand -hex 32` (produces 64 hex chars = 32 bytes = 256 bits). AUTH-13 checks `${#JWT_SECRET} -ge 32` in demo-check.sh — note this checks CHARACTERS (64 hex chars), not bytes. A 64-char hex string is 32 bytes. If the operator uses a non-hex secret, the check may pass on character count but have lower entropy. Use hex keys from `openssl rand -hex 32`.

### Pitfall 5: `bun:sqlite` Database is module-level singleton — safe in Next.js
**What goes wrong (misconception):** Developer thinks Next.js creates a new `Database` instance per request, leading to many open file handles.
**Why it's actually safe:** `lib/db/client.ts` exports a module-level singleton. Next.js Route Handlers run in the same Node.js process — the module is cached after first import. One `Database` instance serves all requests. WAL mode handles concurrent reads; bun:sqlite's synchronous API serializes writes at the JS event loop level.
**Actual pitfall:** If the dev imports the DB module in `middleware.ts` (Edge Runtime), the module fails to load. Keep the singleton in Node-runtime files only.

### Pitfall 6: magic_tokens table needs periodic cleanup
**What goes wrong:** After months of use, `magic_tokens` fills with expired, used tokens. Queries slow down. On a demo laptop this is unlikely to matter, but for correctness add a cleanup.
**How to avoid:** Add to the verify endpoint after successful redemption: `db.run("DELETE FROM magic_tokens WHERE expires_at < unixepoch() - 86400")`. Deletes tokens more than 1 day past expiry. One cleanup per verify call is acceptable latency.

### Pitfall 7: `cookies()` is async in Next.js 15
**What goes wrong:** `const cookieStore = cookies()` (without await) returns a Promise, not the cookie store. Accessing `.get()` on the Promise throws or returns undefined.
**Why:** Next.js 15 made `cookies()` async (returns `Promise<ReadonlyRequestCookies>`). This changed from v14.
**How to avoid:** Always `const cookieStore = await cookies()` in Route Handlers.
[CITED: nextjs.org/docs/app/api-reference/functions/cookies — "v15.0.0-RC: cookies is now an async function"]

### Pitfall 8: Double-redirect after verify on first sign-in
**What goes wrong:** `/api/auth/verify` assigns a new `brainSlug` and redirects to `/dash/<brainSlug>`. The brain dir `brains/<brainSlug>/` doesn't exist yet. `lib/gbrain/tenants.ts::init()` doesn't know about it. The dashboard Route Handler tries to `getTenant(brainSlug)` → returns `undefined` → 404.
**Why:** The in-memory tenant registry is rebuilt from the filesystem on Next.js boot. A new brain dir created post-boot isn't in the registry.
**How to avoid:** After creating the brain dir in the verify handler, call `upsertTenant()` to register it in the in-memory registry. Or call `reloadTenants()`. The verify endpoint is also the right place to run `gbrain init` for the new tenant (or queue it as a background task).

### Pitfall 9: next.config.ts has no `serverExternalPackages` for bun:sqlite
**What goes wrong:** Next.js may try to bundle `bun:sqlite` into the server bundle and fail because it's a built-in.
**How to avoid:** Add to `next.config.ts`:
```typescript
const nextConfig: NextConfig = {
  serverExternalPackages: ["bun:sqlite"],
};
```
This tells Next.js to not bundle `bun:sqlite` and leave it as a runtime require. [ASSUMED] This may or may not be needed — test during first `next build`. If no error, the config is not required.

### Pitfall 10: panic-reset.sh uses `sqlite3` CLI which may not be on PATH
**What goes wrong:** The new panic-reset.sh hardening uses `sqlite3 "$DB_PATH" "SELECT email FROM users;"` to list affected users. If `sqlite3` is not installed (common on bare Linux VMs), the script fails to enumerate users.
**How to avoid:** Gate on `command -v sqlite3 >/dev/null 2>&1` with a fallback warning message (not a hard failure). Also document in README: `brew install sqlite` (macOS) or `apt install sqlite3` (Linux).

### Pitfall 11: Next.js 16 proxy.ts rename (do NOT apply to this project)
**What goes wrong:** Developer reads Next.js 16 docs (current as of 2026-05) and creates `proxy.ts` with `export function proxy()`. Next.js 15.3.2 does not recognize `proxy.ts` — the file is ignored and middleware does not run. Auth protection silently disappears.
**How to avoid:** This project uses Next.js 15.3.2. Use `middleware.ts` with `export function middleware()`. Do not upgrade to Next.js 16 during Phase 5.
[CITED: nextjs.org docs version history — proxy.ts introduced in v16.0.0]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT signing + verification | Custom HMAC/ECDSA with node:crypto | `jose` SignJWT + jwtVerify | jose handles JWK formats, clockTolerance, algorithm validation, and error typing correctly. Rolling your own risks subtle timing/encoding bugs. |
| Email delivery | SMTP client (nodemailer) | `resend` SDK | Resend handles deliverability, SPF/DKIM, bounce handling. SMTP requires mail server credentials and DNS config that take hours to get right. |
| SQL injection protection | String interpolation in SQL | Prepared statements (bun:sqlite `?` params) | bun:sqlite prepared statements prevent injection at the driver level. |
| Single-use token atomicity | SELECT → check → UPDATE | Single `UPDATE … WHERE used=0` + check `changes` | See Pitfall 2. The only safe pattern for concurrent redemption. |
| Session cookie management | localStorage/sessionStorage | HttpOnly cookie | localStorage is readable by JS (XSS risk). HttpOnly cookies are invisible to JS. |

---

## Validation Architecture

> `nyquist_validation` is explicitly `false` in `.planning/config.json`. This section is SKIPPED per config.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All scripts + `bun:sqlite` | ✓ | 1.2+ (project prerequisite) | — |
| Node.js 20+ (under Bun) | node:crypto, node:child_process | ✓ | Bun 1.2 Node.js compat | — |
| `jose` npm pkg | JWT tokens | Not yet installed | 6.2.3 | — |
| `resend` npm pkg | Email delivery | Not yet installed | 6.12.3 | — |
| `RESEND_API_KEY` env var | sendMagicLink | Unknown (operator has key per CLAUDE.md) | — | Spike must confirm |
| `JWT_SECRET` env var | Token signing | Unknown — not in current .env | — | Generate: `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` env var | QBO token encryption (Phase 6 schema column) | Unknown | — | Generate: `openssl rand -hex 32` |
| `sqlite3` CLI | panic-reset.sh user enumeration | Unknown | — | Warning message (not blocker) |
| Custom domain (Resend) | Primary inbox delivery | Unknown — spike required | — | `onboarding@resend.dev` for testing only |

**Missing dependencies with no fallback:**
- `RESEND_API_KEY` — spike must confirm this is set; without it the send-link endpoint fails at runtime
- `JWT_SECRET` — must be generated and added to `.env.local` before any auth code runs

**Missing dependencies with fallback:**
- `sqlite3` CLI — warning in panic-reset.sh, not a hard failure
- Custom Resend domain — use `onboarding@resend.dev` for test emails during spike

---

## State Inventory (Rename/Migration Considerations)

This is not a rename phase, but Phase 5 ADDS new persistent state that the planner must account for:

| Category | Items Added | Action Required |
|----------|-------------|-----------------|
| Stored data | `data/quickbrain-app.sqlite` — users, magic_tokens, rate_limits | Create on first boot (auto via client.ts init); add to .gitignore |
| Live service config | Resend API — sending domain | Precondition spike must verify |
| OS-registered state | None — no cron, no pm2 | None |
| Secrets/env vars | `RESEND_API_KEY`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` | Add to `.env.local`; extend demo-check.sh |
| Build artifacts | None | None |

**Existing state changed by Phase 5:**
- `lib/gbrain/mutex.ts` parameter type changes from `string` → `BrainSlug` (compile-time only)
- `lib/gbrain/tenants.ts` adds `userId?: string` field to `TenantRecord`
- `scripts/panic-reset.sh` gains `AUTH_ENABLED` gate + `--force-real-tenants` flag
- `scripts/demo-check.sh` gains 3 new env var checks

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | HS256 is acceptable where AUTH-02 says ES256 | §1 | Planner may need to implement ES256 variant; adds 20min key-gen step |
| A2 | `onboarding@resend.dev` delivers to primary inbox during spike | §3 | Must set up custom domain; adds 30-60min DNS propagation wait |
| A3 | Resend API latency ≤4.5s for AUTH-01 5s requirement | §3 | Resend infrastructure issue; operator would need to change email provider |
| A4 | `PRAGMA busy_timeout=5000` syntax works in bun:sqlite | §2 | Use WAL mode alone (writers still serialize in single Next.js process) |
| A5 | `serverExternalPackages: ["bun:sqlite"]` needed in next.config.ts | §10 Pitfall 9 | May cause `next build` failure; test early |
| A6 | ES256 generateKeyPair API is stable in jose 6.x | §1 | Training knowledge; verify with npm view jose changelog if ES256 route taken |
| A7 | `sqlite3` CLI is available on demo machine for panic-reset user enumeration | §7 | Fall back to warning; install with brew install sqlite |

---

## Open Questions

1. **ES256 vs HS256 for AUTH-02**
   - What we know: HS256 is simpler, sufficient for single-server, already in STACK.md research.
   - What's unclear: Does the operator want strict AUTH-02 compliance (ES256) or pragmatic (HS256)?
   - Recommendation: Default to HS256 with a code comment noting the ES256 upgrade path. If the operator disagrees, the ES256 variant in §1 is ready.

2. **Resend sending domain availability**
   - What we know: Free tier requires verified domain for sending to arbitrary addresses; `onboarding@resend.dev` works only for test addresses.
   - What's unclear: Does the operator have a domain ready to verify? Does `onboarding@resend.dev` land in primary inbox for `hannanmannankanji@gmail.com`?
   - Recommendation: The 30-min precondition spike answers this. Do not write the email template until the spike passes.

3. **Brain provisioning on first verify**
   - What we know: The verify endpoint must create the brain dir and register it in the tenant registry.
   - What's unclear: Should it also run `gbrain init` immediately (adds 5–10s to the verify redirect) or defer to the dashboard?
   - Recommendation: Defer `gbrain init` to a separate SSE onboarding flow triggered from the dashboard on first visit. The verify endpoint only creates the dir and sets the session cookie.

4. **AUTH_ENABLED default for v1.1 demo**
   - What we know: `AUTH_ENABLED=0` preserves v1.0 anonymous flow; `AUTH_ENABLED=1` enables auth.
   - What's unclear: What is the default for the live demo VM?
   - Recommendation: Default to `AUTH_ENABLED=0` in `.env.local.example`. Operator opts in to `AUTH_ENABLED=1` for real-user testing.

---

## Sources

### Primary (HIGH confidence)
- `package.json` — `"next": "^15.3.2"` (confirmed middleware.ts, not proxy.ts)
- `lib/gbrain/mutex.ts` — current `withTenantLock(tenantId: string, ...)` signature confirmed
- `lib/gbrain/client.ts` — only call site of `withTenantLock` confirmed
- `scripts/panic-reset.sh` — current implementation confirmed
- `scripts/mutex-smoke.ts` — existing tests confirmed, extension plan validated
- `scripts/demo-check.sh` — current checks confirmed, extension points identified
- [nextjs.org/docs/app/api-reference/functions/cookies] — `cookies()` async API, set options (httpOnly, secure, sameSite, maxAge)
- [nextjs.org/docs/app/api-reference/file-conventions/proxy] — middleware.ts → proxy.ts version history, config.matcher syntax, cookie API in NextRequest
- [bun.com/docs/runtime/sqlite] — Database WAL, prepare/run, `.changes` property
- [resend.com/docs/send-with-nodejs] — `resend.emails.send()` API shape confirmed

### Secondary (MEDIUM confidence)
- [WebSearch: jose jwtVerify clockTolerance, JWTExpired error] — confirmed from multiple sources
- [WebSearch: SameSite Lax magic link cross-site redirect] — confirmed Lax is required for magic-link email-to-app navigation
- [WebSearch: bun:sqlite WAL mode busy_timeout] — WAL pattern confirmed; busy_timeout via PRAGMA confirmed
- [WebSearch: resend free tier domain restriction] — `onboarding@resend.dev` for testing only, custom domain required for production sends

### Tertiary (LOW confidence / ASSUMED)
- ES256 generateKeyPair API shape in jose 6.x — training knowledge; not verified via Context7 this session
- PRAGMA busy_timeout exact syntax for bun:sqlite — pattern from SQLite docs, not bun-specific docs
- `serverExternalPackages: ["bun:sqlite"]` requirement — test during first next build

---

## Metadata

**Confidence breakdown:**
- jose HS256 pattern: HIGH — standard npm package, API shape confirmed from multiple sources
- bun:sqlite schema + atomic UPDATE: HIGH — bun docs confirm `.changes` property; TOCTOU pattern well-documented
- Resend SDK: HIGH — official docs confirm send API; domain restriction confirmed
- Next.js 15 middleware.ts pattern: HIGH — version confirmed in package.json; docs read directly
- BrainSlug branded type: HIGH — TypeScript brand pattern is stable language feature; call site confirmed from source
- Pitfalls: HIGH — most surfaced from actual codebase reading + official docs; Pitfall 9/10 are ASSUMED

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (Next.js, jose, resend APIs are stable; resend domain requirements could change)
