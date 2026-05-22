# Phase 6: Auth + Multi-Tenant Isolation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-22
**Phase:** 6-Auth + Multi-Tenant Isolation
**Mode:** `--auto` — all gray areas auto-selected, recommended option chosen per question.
**Areas discussed:** Tenant Resolution & Registry, Brain Provisioning, Session Model & Sign-Out, Magic-Link & Sign-In UX

---

## Tenant Resolution & Registry

| Option | Description | Selected |
|--------|-------------|----------|
| `users` table is the registry | One row per user carries the user↔brain mapping; resolve from the session | ✓ |
| Separate `app.tenants` table | A tenants table keyed by slug, plus a `users` table mapping into it | |

**User's choice:** `users` table is the registry (recommended default).
**Notes:** AUTH-04 ("each user has exactly one brain") makes a separate tenants table redundant. Replaces the filesystem `readdir(BRAINS_ROOT)` registry in `lib/gbrain/tenants.ts`; folds the `tenant-registry-deploy-persistent` todo. → CONTEXT D-01.

---

## Brain Provisioning

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh empty brain | New users get an empty brain; QBO ingest (Phase 7) fills it | ✓ |
| Clone the synthetic seed | Copy the Mara's Coffee seed so chat has something to answer immediately | |

**User's choice:** Fresh empty brain (recommended default).
**Notes:** The synthetic seed is hackathon-only and is removed from the runtime path in Phase 9 (CLEAN-02). An empty brain has nothing to chat about until Phase 7 — acceptable, since Phase 6 delivers auth + isolation, not data. The seed/demo tenant stays reachable only behind the dev-only `AUTH_ENABLED=0` bypass. → CONTEXT D-02, D-03.

---

## Session Model & Sign-Out

| Option | Description | Selected |
|--------|-------------|----------|
| DB-backed sessions | Opaque session ID in the cookie; record in `app.sessions`; sign-out deletes the row | ✓ |
| Stateless JWT cookie | Signed JWT carries the session; sign-out only clears the cookie client-side | |

**User's choice:** DB-backed sessions (recommended default).
**Notes:** AUTH-08 mandates session records in Supabase Postgres; AUTH-07 needs real sign-out. A stateless JWT cannot be revoked server-side. `jose` is still used to sign the magic-link token. Cookie shape (`HttpOnly`+`Secure`+`SameSite=Lax`, 30-day, `qb_session`) carried forward from v1.x archived auth. → CONTEXT D-04, D-05, D-06.

---

## Magic-Link & Sign-In UX

| Option | Description | Selected |
|--------|-------------|----------|
| Sign-in replaces the onboarding form | First sign-in auto-provisions the brain; no business-name step | ✓ |
| Keep a post-sign-in business-name step | Sign in, then collect a business name before provisioning | |

**User's choice:** Sign-in replaces the onboarding form (recommended default).
**Notes:** Magic-link TTL = 15 min (v1.x precedent), single-use enforced atomically (`UPDATE WHERE used=false` + row-count check, no TOCTOU). Rate limiting (1/email/60s) is DB-backed — in-memory state does not survive serverless. The `/` landing CTA and `/onboard` page are repurposed toward `/sign-in`; the business name can come from QBO in Phase 7. → CONTEXT D-07, D-08, D-09.

---

## Claude's Discretion

- Exact table and column names for `app.users` / `app.sessions` / `app.magic_links`.
- The magic-link verify-route path name and the resend-page layout.
- The magic-link email HTML template.
- The precise Node-vs-Edge `middleware.ts` runtime split.

## Deferred Ideas

- ES256 JWT key-pair — HS256 is the v2.0 choice; ES256 is a documented upgrade path.
- Team / multi-user-per-brain sharing — v2.1 (PROJECT.md out of scope).
- Account self-service data export + deletion (GDPR) — v2.1.
- The QBO OAuth flow — Phase 7 (only the encrypted-token columns land in Phase 6).
- Removing the `AUTH_ENABLED=0` bypass and the synthetic seed — Phase 9 (CLEAN-02/03).
