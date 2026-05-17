# Research Summary: QuickBrain v1.1 "Beyond the Demo"

**Synthesized:** 2026-05-17
**Sources:** STACK.md · FEATURES.md · ARCHITECTURE.md · PITFALLS.md
**Mode:** Subsequent-milestone — only the deltas from v1.0 are in scope.

---

## Executive Summary

QuickBrain v1.1 extends a working hackathon demo into a real-data SMB tool by adding three orthogonal capabilities: a native gbrain skill replacing the hand-rolled anomaly detector (Phase 4), email magic-link auth tying users to persistent brain directories (Phase 5), and a QuickBooks Online ingest pipeline transforming live accounting data into gbrain-compatible markdown (Phase 6). Each capability has a clear dependency boundary — skill has none, auth provides the user-identity layer QBO requires, QBO depends on both. Building in that order minimises rework.

Stack additions are minimal. Every v1.1 choice follows the same logic that made v1.0 succeed — reach for the Bun/Node built-in first, ship the simplest mechanism that satisfies the security constraint, and keep the existing demo path fully intact.

The dominant risks are **data-layer correctness bugs, not architectural ones.** Two fragile paths:
1. Insight parsers are hardcoded to `data/maras-coffee/` (FIXTURES_ROOT). Every real-data tenant currently sees Mara's numbers. Must be fixed inside Phase 4 before the skill's output can even be observed.
2. The QBO transformer and `smb-audit` skill must share a canonical invoice frontmatter schema (`type`, `vendor`, `date`, `amount`). If divergent, anomaly detection produces zero results on real data. The schema is defined in Phase 4 and binds Phase 6.

---

## Stack Additions (final picks, post-reconciliation)

| Library | Version | Purpose | Why this over alternatives |
|---|---|---|---|
| `resend` | `6.x` | Transactional email for magic links | Free tier (3k/mo, 100/day) covers all of v1.1; pure-fetch SDK; first-class TS. Postmark wins on deliverability but only matters at scale (>500 DAU). |
| `jose` | `6.2.3` | JWT primitives — two-token architecture (15-min magic-link JWT + 30-day session JWT) | Pure Web Crypto API; zero native bindings; runs on Bun + Node + Edge. Rejecting `better-auth` because adding a full framework for one boolean column (`used`) isn't justified. Rejecting Auth.js v5 because of the documented `dns` module conflict with Next.js App Router Edge (`nextauthjs/next-auth#12979`). |
| `bun:sqlite` | built-in (Bun 1.2) | App-layer persistence: `users`, `magic_tokens`, `user_tenants` | Zero install; synchronous; no ABI risk. `better-sqlite3` is broken under Bun (issue #16050). A second PGLite instance (proposed by ARCHITECTURE.md) duplicates an exclusive-lock domain for zero benefit. DB file: `data/quickbrain-app.sqlite`. |
| `node:crypto` | built-in | AES-256-GCM for QBO OAuth token encryption at rest | Standard library; `randomBytes(12)` IV + `createCipheriv` + auth tag stored as `iv:tag:ciphertext` base64. No `@noble/ciphers` needed server-side. |
| `intuit-oauth` | `4.2.3` | QBO OAuth 2.0 client (auth URL, token exchange, refresh) | Official Intuit client; handles the non-standard `Basic <clientId:clientSecret>` token-exchange header that rolling-your-own typically gets wrong. |
| `node-quickbooks` | `2.0.50` | QBO Accounting API calls (Invoices, Bills, Vendors, Purchases) | Community-maintained but stable; covers all entities v1.1 needs. Ship a 20-line local `declare module` for the four methods we call. |

**New env vars:** `RESEND_API_KEY`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`. Extend `scripts/demo-check.sh` to gate on these.

---

## Feature Table Stakes (per pillar)

### Phase 4 — `smb-audit` gbrain Skill

**Table stakes (must ship):**
- `SKILL.md` manifest + `scripts/smb-audit.mjs` runnable via `gbrain jobs submit smb-audit --follow`
- Port the 3 v1.0 detection rules (Beanstalk price-hike, Square duplicate, 7shifts ghost) — read all `originals/` + `companies/`, emit `concepts/march-anomaly-summary.md` + `concepts/recurring-charges.md`
- Idempotent re-runs (no duplicate concept-page appends)
- Skill output frontmatter contract documented in `docs/brain-schema.md`

**Bundled differentiators (all S-complexity; ship together):**
- Dollar-impact computation reusing `extractDollarImpact()` from `lib/insights/anomalies.ts`
- Structured frontmatter on concept pages: `severity`, `dollar_impact`, `anomaly_type`, `vendor_slug`
- DATA-12 from v1.0 stretch: 4th anomaly type — bank-debit-without-invoice ("missing-invoice")

**Anti-features:** ML detection, per-line-item POS analysis, real-time alerting.

**Prerequisite refactor (must happen first inside Phase 4):**
- `lib/insights/cache.ts::computeAndCache` is hardcoded to `FIXTURES_ROOT`. Refactor signature to `computeAndCache(tenantId, sourceDir)`; special-case the demo tenant. Without this, skill output never reaches the dashboard.

### Phase 5 — Email Magic-Link Auth

**Table stakes:**
- Sign-in page (`/sign-in`), email submit form, "check your email" screen
- Magic-link click handler at `/api/auth/verify?token=…` that creates a session cookie + redirects to `/dash/<brainSlug>`
- Sign-out endpoint and persistent sessions (30-day cookie) across server restarts
- `bun:sqlite` schema: `users(id, email, brain_slug, qbo_realm_id, qbo_tokens_encrypted, created_at, last_login_at)` + `magic_tokens(jti, email, used, expires_at)`
- Single-use enforcement via `UPDATE magic_tokens SET used=1 WHERE jti=? AND used=0` + rows-affected check
- Rate limit (thin middleware): 1 send per 60s per email
- Token expiry: 15 minutes
- Next.js Middleware (root-level) protecting `/dash/*` + `/api/qbo/*`
- Demo path preserved: anonymous `/onboard` still works, gated by `AUTH_ENABLED` env var

**Bundled differentiators:**
- Friendly error states (expired / invalid / already-used) with retry path
- Branded Resend email template (header, support email, expiry note)

**Anti-features:** passwords, social SSO, 2FA, account deletion UI.

**Side effects on v1.0 code:**
- `scripts/panic-reset.sh` must gate on `AUTH_ENABLED=0` OR add `--force-real-tenants` flag — currently wipes `brains/*` unconditionally; would destroy any signed-in user's brain dir.
- `lib/gbrain/tenants.ts` adds `userId` field to `TenantRecord` but **mutex key stays `brainSlug`**. PGLite lock contention re-emerges if mutex is keyed by user ID instead.

### Phase 6 — QuickBooks Online Ingest

**Table stakes:**
- "Connect QuickBooks" button on dashboard
- OAuth flow: `/api/qbo/connect` → Intuit consent → `/api/qbo/callback` → store encrypted tokens against the user
- Initial sync (SSE-streamed like v1.0 onboarding): 12 months of Vendors, Invoices, Bills, Purchases
- Transformer `lib/qbo/transformer.ts`: pure functions emitting `{ path, content }` matching v1.0 seed schema exactly
- Per-tenant brain dir: write to `brains/<brainSlug>/brain-repo/companies/qbo-<slug>.md` + `brains/<brainSlug>/brain-repo/originals/invoice-<id>.md` (etc.). The `qbo-` prefix prevents slug collisions with synthetic seed.
- `gbrain import` → `smb-audit` skill chain runs through existing mutex after transform
- Refresh-token rotation: persist newest `refresh_token` immediately after every refresh (rotates every 24-26h since Nov 2025); 100-day issuance expiry — surface "reconnect" banner at day 86

**Bundled differentiators:**
- Incremental sync via QBO CDC endpoint (`changedSince` ISO8601 param, 30-day lookback)
- Disconnect button: revoke tokens + clear local OAuth record; leave imported markdown in place (user can still chat over historical data offline)
- Multi-realm UX: if user's QBO account has >1 company, pick one (single realm per QuickBrain tenant in v1.1)

**Anti-features:** webhooks (poll-only), write-back to QBO, payroll, POS items, attachments/PDFs, raw bank-feed transactions (not accessible via Accounting API — `Purchase`/`Bill`/`Deposit` are the substitute).

---

## Architecture Touch Points

| File / Dir | New or Modified | Purpose |
|---|---|---|
| `skills/smb-audit/SKILL.md` | **NEW** | Skill manifest + RESOLVER entry |
| `skills/smb-audit/scripts/smb-audit.mjs` | **NEW** | Detector logic (ported from `scripts/detect-anomalies.ts`) |
| `lib/audit/anomaly-detector.ts` | **NEW** | Shared detector lib usable by skill + (legacy fallback) seed script |
| `docs/brain-schema.md` | **NEW** | Canonical invoice/vendor/bank frontmatter contract |
| `lib/insights/cache.ts` | **MODIFIED** | `computeAndCache(tenantId, sourceDir)` — drop `FIXTURES_ROOT` |
| `lib/insights/parsers/*` | **MODIFIED** | Accept `sourceDir` param; read from `brains/<slug>/brain-repo/` not `data/maras-coffee/` |
| `scripts/seed.sh` | **MODIFIED** | Replace `bun run scripts/detect-anomalies.ts` with `gbrain jobs submit smb-audit --follow` |
| `lib/auth/jwt.ts` | **NEW** | jose helpers — sign/verify magic-link + session tokens |
| `lib/auth/db.ts` | **NEW** | bun:sqlite singleton + migration runner |
| `lib/auth/session.ts` | **NEW** | Cookie-based session reader/writer |
| `lib/auth/rate-limit.ts` | **NEW** | 60s-per-email rate limit |
| `lib/auth/email.ts` | **NEW** | Resend client + branded template |
| `app/sign-in/page.tsx` | **NEW** | Email input form |
| `app/check-email/page.tsx` | **NEW** | "Check your email" screen |
| `app/api/auth/send-link/route.ts` | **NEW** | Magic-link send endpoint |
| `app/api/auth/verify/route.ts` | **NEW** | Magic-link callback → session cookie |
| `app/api/auth/sign-out/route.ts` | **NEW** | Clear session |
| `middleware.ts` | **NEW** | Route protection for `/dash/*` + `/api/qbo/*` |
| `lib/gbrain/tenants.ts` | **MODIFIED** | Add `userId` to `TenantRecord`; mutex still keyed by `brainSlug` |
| `scripts/panic-reset.sh` | **MODIFIED** | Gate on `AUTH_ENABLED=0` OR `--force-real-tenants` |
| `scripts/demo-check.sh` | **MODIFIED** | Verify v1.1 env vars (`RESEND_API_KEY`, `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `QBO_*`) |
| `lib/qbo/oauth.ts` | **NEW** | intuit-oauth wrapper + token refresh |
| `lib/qbo/client.ts` | **NEW** | node-quickbooks wrapper (Vendors / Invoices / Bills / Purchases) |
| `lib/qbo/transformer.ts` | **NEW** | QBO entity → markdown (path + content) |
| `lib/qbo/encrypt.ts` | **NEW** | AES-256-GCM token encryption |
| `app/api/qbo/connect/route.ts` | **NEW** | OAuth start |
| `app/api/qbo/callback/route.ts` | **NEW** | OAuth callback + token storage |
| `app/api/qbo/sync/route.ts` | **NEW** | SSE-streamed sync (transform + gbrain import + skill) |
| `app/api/qbo/disconnect/route.ts` | **NEW** | Revoke + clear OAuth record |
| `app/dash/[brainSlug]/qbo-card.tsx` | **NEW** | Connect/Sync/Disconnect UI |

---

## Watch Out For (top 7 pitfalls, ranked by severity)

| # | Pitfall | Detection | Prevention | Owner Phase |
|---|---|---|---|---|
| 1 | `FIXTURES_ROOT` hardcoded — every tenant gets Mara's data | Real user signs in, sees Beanstalk anomalies on their own brain | Refactor `computeAndCache(tenantId, sourceDir)`; integration test asserts a fresh tenant brain yields different insight numbers than the demo brain | **Phase 4** |
| 2 | Skill output frontmatter must match `anomalies.ts` regex exactly (`- YYYY-MM-DD: [[companies/<slug>]] <description>`) | Insight card "Anomalies" empty after skill runs | Define `docs/brain-schema.md` first; snapshot-test the skill output against the parser | **Phase 4** |
| 3 | QBO entity field names diverge from seed schema (`VendorRef.name` vs `vendor`, `TxnDate` vs `date`, `TotalAmt` vs `amount`) — skill produces zero anomalies on real data | Real QBO tenant signs in, asks "what was weird last month", gets "I don't have data on that" despite invoices being present | Transformer must emit `vendor`, `date`, `amount`, `type` exactly. Unit-test the transformer with a fixture QBO response | **Phase 6** (binds to Phase 4 schema) |
| 4 | Mutex key migration — if a refactor accidentally keys mutex on `userId` instead of `brainSlug`, PGLite exclusive-lock contention silently re-emerges | Sporadic `gbrain query` failures, especially under concurrent insight-card + chat traffic | TypeScript wrapper that enforces `mutex.acquire(brainSlug: BrainSlug)` with branded type; add regression `mutex-smoke.ts` that exercises 5 concurrent calls | **Phase 5** |
| 5 | `panic-reset.sh` wipes real users' brain dirs unconditionally | First real user signs in, operator runs panic-reset, user's QBO-synced data is gone | Gate on `AUTH_ENABLED=0` env, OR require `--force-real-tenants` flag, OR scan for any brain dir not in `brains/seed/` and confirm before delete | **Phase 5** |
| 6 | Magic-link token replay — without persistent `used` tracking, link works indefinitely | Same magic-link URL grants sessions repeatedly across days | `magic_tokens` table with `used INTEGER NOT NULL DEFAULT 0`; verify endpoint uses `UPDATE … SET used=1 WHERE jti=? AND used=0` + rows-affected guard | **Phase 5** |
| 7 | QBO refresh token expires 100 days after issuance (not last-use); silent sync failure after day 100 | User reports "my data hasn't updated in a while" weeks later | At every sync, check token age; surface reconnect banner at day 86; refresh-on-read pattern catches the 24h rotation | **Phase 6** |

---

## Build Order Recommendation

**Phase 4 → Phase 5 → Phase 6.** The dependencies are linear and one-way:
- Phase 4 (smb-audit skill) has no auth or QBO dependency and validates the gbrain skill authoring path. It also forces the `FIXTURES_ROOT` refactor and pins the canonical brain schema — both prerequisites for Phase 6.
- Phase 5 (auth) introduces the user identity layer Phase 6 needs to store QBO tokens against. It must also harden `panic-reset.sh` before real users exist.
- Phase 6 (QBO) depends on both — schema from Phase 4, user identity from Phase 5 — and is the largest scope.

**Estimated complexity:** Phase 4 = M (~4-6h), Phase 5 = M (~4-6h), Phase 6 = L (~10-14h).

---

## Open Spikes (30-min experiments, run at the start of each phase before plan code)

**Phase 4 spike:**
```
GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell \
  --params '{"cmd":"echo hello","cwd":"<repo>"}' \
  --follow
```
Confirm execution path, blocking behavior, exit code surfacing. Simultaneously verify `import { search, get_page } from '@gbrain/api'` resolves under Bun. **If either fails:** fall back to `bun skills/smb-audit/index.ts` invoked directly with `GBRAIN_HOME=…`. Same observable outcome, simpler harness.

**Phase 5 spike:**
Send a real Resend email from a Route Handler to a test Gmail address. Confirm primary-inbox delivery within 60s. **If it lands in spam:** configure SPF/DKIM on the sending domain before building the flow.

**Phase 6 spike:**
Complete the QBO OAuth flow end-to-end with `intuit-oauth` against a sandbox account (authorize → callback → `tokenResponse.getJson()`). Confirm `realmId` is present and `qbo.findVendors({})` returns ≥1 vendor. **If `intuit-oauth` has a Bun issue:** fall back to raw `fetch` with `Authorization: Bearer`.

---

## Confidence

Overall: **MEDIUM-HIGH**

- **HIGH confidence:** Resend, jose, bun:sqlite, node:crypto, intuit-oauth versions and integration patterns. v1.0 codebase touch points (read source directly).
- **MEDIUM confidence:** node-quickbooks API surface (community lib, well-documented but no TS types). QBO Purchase entity as bank-statement substitute (confirmed conceptually, field mapping needs sandbox spike).
- **LOW confidence (Phase 4 spike resolves):** `@gbrain/api` import path under Bun. `gbrain jobs submit` over PGLite (Minions docs are Postgres-centric). Both have fallbacks documented above.

---

*Synthesis complete: 2026-05-17.*
