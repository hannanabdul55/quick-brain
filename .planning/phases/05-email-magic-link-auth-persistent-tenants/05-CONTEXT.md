---
phase: 05-email-magic-link-auth-persistent-tenants
type: context
created: 2026-05-19
---

# Phase 5: Locked Decisions

These decisions are non-negotiable during execution. Do not propose alternatives; implement exactly as specified.

## Decisions

**D-01: JWT Algorithm — HS256 (not ES256)**
AUTH-02 specifies ES256, but planning research resolved this to HS256 for the hackathon timeline (RESEARCH §1). Implementation uses `new SignJWT({ email }).setProtectedHeader({ alg: "HS256" })` with `JWT_SECRET` env var (≥32 bytes, generated via `openssl rand -hex 32`). Every JWT file MUST include a comment: "// HS256 per RESEARCH §1 pragmatic decision. Upgrade path: swap TextEncoder secret for importPKCS8(privateKey,'ES256') — zero caller API change required."

**D-02: User store — bun:sqlite at data/quickbrain-app.sqlite**
Built-in to Bun 1.2. Node-runtime only. `lib/auth/db.ts` must carry banner comment "NODE RUNTIME ONLY — DO NOT import from middleware.ts or Edge route handlers". `next.config.ts` must include `serverExternalPackages: ["bun:sqlite"]`. `data/*.sqlite` (and .sqlite-shm, .sqlite-wal) must be in `.gitignore`.

**D-03: Email — Resend SDK (resend@6.12.3)**
`from` field: read from `RESEND_FROM_ADDRESS` env var (default: `"QuickBrain <onboarding@resend.dev>"` for dev; set to verified domain for production). Resend free tier restricts sending to `onboarding@resend.dev` until a custom domain is verified. See RESEARCH §3 for SPF/DKIM setup steps.

**D-04: Session cookie — HttpOnly + Secure + SameSite=Lax + 30d + name qb_session**
SameSite MUST be Lax (not Strict). Strict breaks magic-link cross-site navigation from email client (RESEARCH §10 Pitfall 3). maxAge = `60 * 60 * 24 * 30`. Set via `await cookies()` (async in Next.js 15 — always await). Cookie cleared on sign-out via `maxAge: 0`.

**D-05: Mutex key — BrainSlug branded type**
`type BrainSlug = string & { readonly __brand: "BrainSlug" }`. Lives in `lib/gbrain/brain-slug.ts`. `withTenantLock` signature changes from `(tenantId: string, ...)` to `(brainSlug: BrainSlug, ...)`. Only one production call site in `lib/gbrain/client.ts` — update to `asBrainSlug(tenantId)` after `assertTenantSlug` validation.

**D-06: Atomic single-use token — UPDATE WHERE used=0 + result.changes check**
NEVER pre-SELECT then UPDATE (TOCTOU race). Single `UPDATE magic_tokens SET used = 1 WHERE jti = ? AND used = 0` → check `result.changes === 0` for concurrent-race guard. RESEARCH §2, RESEARCH §10 Pitfall 2.

**D-07: QBO column schema (Phase 6 prep) — AES-256-GCM via node:crypto**
`users` table includes `qbo_realm_id TEXT` (nullable) and `qbo_tokens_encrypted TEXT` (nullable). The encrypted column stores a Phase 6 AES-256-GCM blob; key = `TOKEN_ENCRYPTION_KEY` env (≥32 bytes). Column defined in Phase 5 schema, used in Phase 6.

**D-08: Middleware runtime — Edge (default in Next.js 15.3.2)**
`middleware.ts` runs in Edge Runtime. Only `jose jwtVerify` permitted there. NO imports from `lib/auth/*` in middleware (bun:sqlite transitive import crashes Edge bundler). File named `middleware.ts`, export named `function middleware` — NOT `proxy.ts` / `function proxy` (those are Next.js 16 names; RESEARCH §10 Pitfall 11).

**D-09: Next.js version — 15.3.2 (pinned)**
Do NOT upgrade to 15.4+ or 16.x during Phase 5. `middleware.ts` convention confirmed for 15.3.2.

## Deferred Ideas

- ES256 key-pair (alternative JWT algorithm) — deferred per D-01.
- `gbrain serve --http` / MCP client — not applicable to this phase.
- Multi-persona auth branching — single persona only (Mara's Coffee demo + any signed-in user).
- Real-time email delivery confirmation automation — manual checkpoint only (AUTH-14 gate).
- QBO OAuth flow — Phase 6.

## Claude's Discretion

- HTML email template styling (button color, layout) — use the RESEARCH §3 template exactly; do not redesign.
- auth-smoke.ts test output format — use `[auth-smoke] Test N — description: PASS/FAIL` pattern.
- docs/auth-runbook.md structure — follow the template in Plan 05 Task 2.

## Source Audit

| Source | Item | Status | Plan |
|--------|------|--------|------|
| GOAL | Persistent email sign-in + anonymous demo preserved + brainSlug mutex regression | COVERED | 05-01 through 05-05 |
| REQ AUTH-01 | /sign-in POSTs to send-link → Resend within 5s | COVERED | 05-02 (API), 05-03 (UI) |
| REQ AUTH-02 | 15-min jose JWT in magic link | COVERED | 05-01 (jwt.ts), 05-02 (send-link) |
| REQ AUTH-03 | Atomic jti mark-used + 30d cookie + redirect | COVERED | 05-02 (verify route) |
| REQ AUTH-04 | Second click → already-used page | COVERED | 05-02 (verify), 05-03 (used page) |
| REQ AUTH-05 | Rate limit 1/60s per email | COVERED | 05-01 (rate-limit.ts), 05-02 (send-link) |
| REQ AUTH-06 | users table with all columns | COVERED | 05-01 (db.ts schema) |
| REQ AUTH-07 | First sign-in auto-provisions brain_slug + brains dir | COVERED | 05-02 (verify route) |
| REQ AUTH-08 | middleware.ts protects /dash/* /api/qbo/* | COVERED | 05-03 |
| REQ AUTH-09 | Sign-out clears cookie + redirects / | COVERED | 05-02 (route), 05-03 (button) |
| REQ AUTH-10 | AUTH_ENABLED=0 → anonymous flow unchanged | COVERED | 05-03 (middleware + page.tsx) |
| REQ AUTH-11 | BrainSlug branded type on mutex | COVERED | 05-01 (type + migration) |
| REQ AUTH-12 | panic-reset.sh gate on AUTH_ENABLED | COVERED | 05-04 |
| REQ AUTH-13 | demo-check.sh verifies 3 env vars | COVERED | 05-04 |
| REQ AUTH-14 | E2E smoke gate | COVERED | 05-05 |
| RESEARCH §3 | Resend free-tier domain restriction | COVERED | 05-02 (RESEND_FROM_ADDRESS env) |
| RESEARCH §9 | Centralized config.authEnabled | COVERED | 05-01 (lib/config.ts) |
| RESEARCH §10 Pitfall 9 | serverExternalPackages bun:sqlite | COVERED | 05-01 (next.config.ts) |
