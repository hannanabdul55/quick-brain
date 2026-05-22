---
phase: "06-auth-multi-tenant-isolation"
plan: "03"
subsystem: "auth"
tags: ["auth", "magic-link", "jose", "resend", "sessions", "multi-tenant", "provision"]
dependency_graph:
  requires:
    - "06-01 (lib/auth/store.ts sql singleton + CRUD layer)"
    - "06-02 (gbrain sourceId threading — D-12 patch)"
  provides:
    - "lib/auth/schemas.ts — sendLinkBodySchema + isSafeNextPath (T-06-12)"
    - "lib/auth/tokens.ts — issueMagicToken / verifyMagicToken (jose HS256, 15-min TTL)"
    - "lib/auth/email.ts — sendMagicLink via Resend singleton"
    - "lib/auth/provision.ts — generateSourceId (u-<hex>) + provisionBrain (sources INSERT)"
    - "lib/auth/resolve-tenant.ts — THE session→source_id isolation chokepoint (D-11)"
    - "app/api/auth/send-link/route.ts — POST send-link with DB-backed rate limit"
    - "app/auth/verify/route.ts — GET verify with atomic consume + provisioning + session"
    - "app/api/auth/sign-out/route.ts — POST sign-out with server-side revocation"
  affects:
    - "plan 06-04 (auth UI + route protection — builds sign-in page, middleware on top of these routes)"
    - "plan 06-05 (resolveTenant wired into gbrain calls — uses this plan's chokepoint)"
tech_stack:
  added: []
  patterns:
    - "jose HS256 issueMagicToken/verifyMagicToken with 15-min TTL + jti (D-07, T-06-09)"
    - "Resend module-level singleton (mirrors lib/inngest/client.ts)"
    - "isSafeNextPath same-origin guard (rejects //, /\\, schemes — T-06-12)"
    - "generateSourceId u-<7-byte-hex> format — <=17 chars, gbrain [a-z0-9-]{1,32} compliant"
    - "provisionBrain engine.executeRaw INSERT INTO sources ON CONFLICT DO NOTHING (D-02)"
    - "resolveTenant() no-argument chokepoint — cookies() only, never request input (D-11, T-06-14)"
    - "Atomic consumeMagicLink UPDATE...WHERE used=false (already in 06-01; referenced here)"
    - "DB-backed rate limit via wasRecentlyRequested (D-09/AUTH-09; already in 06-01)"
    - "D-05 cookie shape: httpOnly + Secure(prod) + SameSite=Lax + 30-day maxAge"
key_files:
  created:
    - "lib/auth/schemas.ts"
    - "lib/auth/tokens.ts"
    - "lib/auth/email.ts"
    - "lib/auth/provision.ts"
    - "lib/auth/resolve-tenant.ts"
    - "app/api/auth/send-link/route.ts"
    - "app/auth/verify/route.ts"
    - "app/api/auth/sign-out/route.ts"
    - "tests/unit/auth/auth-tokens-schemas.test.ts"
    - "tests/unit/auth/auth-provision-sendlink.test.ts"
    - "tests/unit/auth/auth-verify-signout.test.ts"
  modified: []
decisions:
  - "Pitfall 4 (email-scanner prefetch consuming the verify token) — accepted tradeoff (option b): single-GET consume + /auth/link-used resend path is the safety net; two-step flow adds friction for all users"
  - "provisionBrain uses engine.executeRaw cast (BrainEngine [key: string]: unknown index signature) — the gbrain BrainEngine interface is generic; casting is documented and verified against gbrain's sql-query.ts"
  - "generateSourceId emits u-<14-hex-chars> = 17 chars total (well within gbrain's 32-char limit and tighter than lib/gbrain/slug.ts's 40-char app slug)"
  - "SESSION_COOKIE_MAX_AGE constant (60*60*24*30) used in verify route rather than inline literal — makes D-05 invariant explicit"
metrics:
  duration: "~35 minutes"
  completed: "2026-05-22T18:17:35Z"
  tasks_completed: 3
  files_created: 11
  files_modified: 0
---

# Phase 6 Plan 03: Magic-Link Auth Backend Summary

**One-liner:** jose HS256 magic-link engine with Resend delivery, DB-backed rate limiting, atomic single-use verify, first-sign-in brain provisioning, and the single `resolveTenant()` session→source_id isolation chokepoint.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Failing tests for schemas, tokens, email, resolve-tenant | `759fa19` | `tests/unit/auth/auth-tokens-schemas.test.ts` |
| 1 (GREEN) | Implement schemas, tokens, email, resolve-tenant | `b994937` | `lib/auth/schemas.ts`, `lib/auth/tokens.ts`, `lib/auth/email.ts`, `lib/auth/resolve-tenant.ts` |
| 2 (RED) | Failing tests for provision.ts and send-link route | `7857fb7` | `tests/unit/auth/auth-provision-sendlink.test.ts` |
| 2 (GREEN) | Implement provision.ts and send-link route | `5770aaa` | `lib/auth/provision.ts`, `app/api/auth/send-link/route.ts`, test fix |
| 3 (RED) | Failing tests for verify route and sign-out route | `99e6cf7` | `tests/unit/auth/auth-verify-signout.test.ts` |
| 3 (GREEN) | Implement verify and sign-out routes | `c89a05e` | `app/auth/verify/route.ts`, `app/api/auth/sign-out/route.ts`, test fix |

## What Was Built

### Task 1: Schemas, Tokens, Email, Resolve-Tenant

**`lib/auth/schemas.ts`** — Zod schema module mirroring `lib/chat/schemas.ts`:
- `sendLinkBodySchema`: `z.object({ email: z.string().email(), next: z.string().optional() })`
- `isSafeNextPath(next)`: same-origin guard — rejects `//`, `/\`, `https://`, `http://` prefixes (T-06-12 open-redirect mitigation)

**`lib/auth/tokens.ts`** — Pure utility module mirroring `lib/gbrain/slug.ts`'s shape:
- `issueMagicToken(email)` → `{ token, jti }`: `SignJWT` HS256, `setExpirationTime("15m")`, `setJti(crypto.randomUUID())`
- `verifyMagicToken(token)` → `{ ok, email, jti } | { ok: false, reason: "expired" | "invalid" }`: `jwtVerify` with `clockTolerance: "30s"`, `errors.JWTExpired` branching
- Module-level `JWT_SECRET` guard — fails at startup not at first request

**`lib/auth/email.ts`** — Resend singleton (mirrors `lib/inngest/client.ts`):
- Module-level `new Resend(process.env.RESEND_API_KEY)` + `RESEND_API_KEY` guard
- `sendMagicLink(email, verifyUrl)`: sends HTML + plain-text email; never logs email/token (T-06-13)
- UI-SPEC Copywriting Contract honored: "one-time sign-in link", "expires in 15 minutes", plain/non-technical tone

**`lib/auth/resolve-tenant.ts`** — THE single isolation chokepoint (D-11):
- `resolveTenant()` — zero arguments; reads `qb_session` cookie via `next/headers cookies()`, calls `validateSession()`, reads `app.users` for brain_id/brain_slug
- Returns `{ authenticated: true; userId; sourceId; brainSlug }` or `{ authenticated: false }` sentinel
- T-06-14: source_id is NEVER accepted from request input — tenant identity from verified session only

### Task 2: Brain Provisioning + Send-Link Route

**`lib/auth/provision.ts`** — Server-side brain lifecycle:
- `generateSourceId()` → `{ sourceId, brainSlug }`: `u-<14 random hex chars>` (17 chars, gbrain `[a-z0-9-]{1,32}` compliant), never emits `default`/`seed`/`host`
- `provisionBrain(sourceId, displayName)`: `engine.executeRaw("INSERT INTO sources ... ON CONFLICT (id) DO NOTHING")` via `createGBrainEngine`; does NOT call `initSchema()` (DB-wide, already done in Phase 2)

**`app/api/auth/send-link/route.ts`** — POST handler:
- `dynamic = "force-dynamic"` + `runtime = "nodejs"` (Shared Pattern D)
- Flow: JSON parse → `sendLinkBodySchema.safeParse` → `wasRecentlyRequested` (429 rate_limited) → `issueMagicToken` → `recordMagicLink` → verify URL (request origin, `isSafeNextPath` guard for `?next=`) → `sendMagicLink`
- Logs only `"magic link dispatched"` — never email or token (T-06-13)

### Task 3: Verify Route + Sign-Out Route

**`app/auth/verify/route.ts`** — GET handler (clicked link):
- `dynamic = "force-dynamic"` + `runtime = "nodejs"`
- Flow: `searchParams.get("token")` → `verifyMagicToken` → `consumeMagicLink` (atomic) → `getUserByEmail` → first-sign-in: `generateSourceId + provisionBrain + createUser` / returning: reuse row → `createSession` → `cookies().set("qb_session", ...)` (D-05 shape) → redirect `/dash/<brainSlug>` or `?next=` if safe
- Pitfall 4 (email-scanner prefetch) documented as accepted tradeoff — `/auth/link-used` resend path is the safety net

**`app/api/auth/sign-out/route.ts`** — POST handler:
- `destroySession(cookieValue)` — true server-side revocation (AUTH-07)
- Always clears `qb_session` cookie via `maxAge: 0` (D-05)
- Resilient: returns 200 even if no session was present or `destroySession` threw

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test regex for `initSchema()` matched the "Do NOT call" comment string**
- **Found during:** Task 2 GREEN (first test run)
- **Issue:** The test `expect(src).not.toContain("initSchema()")` matched the JSDoc comment `"Do NOT call engine.initSchema() here"` in `provision.ts`, producing a false failure. The intent was to verify no actual `initSchema()` code call existed.
- **Fix:** Updated the test to filter out comment lines (starting with `*` or `//`) before applying the regex check — same approach as the Phase 6-01 `auth-store.test.ts` fix.
- **Files modified:** `tests/unit/auth/auth-provision-sendlink.test.ts`
- **Commit:** `5770aaa`

**2. [Rule 1 - Bug] Test regex for 30-day maxAge didn't match the `SESSION_COOKIE_MAX_AGE` constant pattern**
- **Found during:** Task 3 GREEN (first test run)
- **Issue:** The test checked for `maxAge.*2592000|30.*days|60\*60\*24\*30` but the implementation uses `const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 2592000` (spaces around `*`). The regex `60\*60\*24\*30` only matches literal `*` characters, not `*` with surrounding spaces.
- **Fix:** Updated the regex to accept `\s*` around operators: `/2592000|30[- ]days?|60\s*\*\s*60\s*\*\s*24\s*\*\s*30|SESSION_COOKIE_MAX_AGE/`
- **Files modified:** `tests/unit/auth/auth-verify-signout.test.ts`
- **Commit:** `c89a05e`

**3. [Design] `engine.executeRaw` type cast in provisionBrain**
- **Found during:** Task 2 implementation
- **Context:** `BrainEngine` uses `[key: string]: unknown` index signature. `engine.executeRaw` is a real gbrain method (verified in `node_modules/gbrain/src/core/sql-query.ts`) but not in the typed shim interface. TypeScript cannot call a method on `unknown` directly.
- **Fix:** Cast `engine["executeRaw"]` to a typed function signature `(sql: string, params: unknown[]) => Promise<unknown>` with a documented comment referencing the gbrain source. Not a Rule 4 issue (no schema change needed; the method already exists).

## Verification Results

- `bun x tsc --noEmit`: exits 0
- All 105 auth unit tests pass (4 files, 0 failures)
- Full test suite: 227 pass, 8 skip, 3 fail (pre-existing `vi.mocked` issue in `health-probes.test.ts` — unrelated to this plan, same count before and after)
- Plan verify checks (all 5): 15m TTL, JWTExpired, isSafeNextPath, validateSession, resolveTenant-no-args — all FOUND/PASS

### Env-gated verification (deferred)

Per plan `<env_note>`: the following checks require live secrets not present in this environment:

- `POST /api/auth/send-link` → real Resend email delivery (requires `RESEND_API_KEY` + verified domain)
- `GET /auth/verify` → end-to-end magic-link click flow (requires live DB + `JWT_SECRET`)
- `POST /api/auth/sign-out` → real session revocation (requires live DB)

All code paths are fully implemented and compile. The above manual verifications are documented as operator preconditions in STATE.md.

## Known Stubs

None. All routes and modules have real implementations wired to real dependencies (`lib/auth/store.ts` CRUD, `jose`, `resend`, `next/headers`). The Resend email template is complete (not a "TODO"). The brain provisioning INSERT is idempotent real SQL.

## Threat Surface Scan

All STRIDE threats from the plan's `<threat_model>` are mitigated:

| Threat | Status | Evidence |
|--------|--------|----------|
| T-06-09: Tampering — magic-link token | Mitigated | `verifyMagicToken` uses `jose` HS256 + `jwtVerify`; tampered tokens return `reason: "invalid"` |
| T-06-10: TOCTOU replay | Mitigated | `consumeMagicLink` is pre-existing atomic UPDATE (06-01); verify route calls it correctly |
| T-06-11: Email flooding | Mitigated | `wasRecentlyRequested` DB-backed 60s window; 429 returned before any send |
| T-06-12: Open-redirect via ?next= | Mitigated | `isSafeNextPath` rejects `//`, `/\`, scheme prefixes; applied in both send-link and verify routes |
| T-06-13: Email/token in logs | Mitigated | All routes log metadata only — no email, no token text |
| T-06-14: Attacker-supplied source_id | Mitigated | `resolveTenant()` has no arguments; `generateSourceId()` is the only source_id generator; `provisionBrain` is the only sources writer |
| T-06-15: Session fixation | Mitigated | Fresh `randomUUID` session ID minted on every verify; D-05 cookie shape (httpOnly + Secure + SameSite=Lax) |
| T-06-16: Email-scanner prefetch | Accept | Documented in verify route comment; `/auth/link-used` resend path is the safety net |

## TDD Gate Compliance

All three tasks followed RED → GREEN flow:

| Task | RED commit | GREEN commit |
|------|-----------|-------------|
| 1 (schemas/tokens/email/resolve-tenant) | `759fa19` (test) | `b994937` (feat) |
| 2 (provision/send-link) | `7857fb7` (test) | `5770aaa` (feat) |
| 3 (verify/sign-out) | `99e6cf7` (test) | `c89a05e` (feat) |

## Self-Check: PASSED

- `lib/auth/schemas.ts` — FOUND
- `lib/auth/tokens.ts` — FOUND
- `lib/auth/email.ts` — FOUND
- `lib/auth/provision.ts` — FOUND
- `lib/auth/resolve-tenant.ts` — FOUND
- `app/api/auth/send-link/route.ts` — FOUND
- `app/auth/verify/route.ts` — FOUND
- `app/api/auth/sign-out/route.ts` — FOUND
- Commit `759fa19` — FOUND
- Commit `b994937` — FOUND
- Commit `7857fb7` — FOUND
- Commit `5770aaa` — FOUND
- Commit `99e6cf7` — FOUND
- Commit `c89a05e` — FOUND
- `bun x tsc --noEmit` — exits 0
- Full auth test suite (105 tests) — all pass
