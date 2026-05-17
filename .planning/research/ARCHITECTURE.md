# Architecture Patterns — QuickBrain v1.1

**Domain:** SMB accounting brain shell — v1.1 integration architecture for smb-audit skill, magic-link auth, and QBO ingest
**Researched:** 2026-05-17
**Confidence:** HIGH on skill authoring path (verified via Context7/gbrain docs), HIGH on auth pattern (standard Next.js JWT/cookie), MEDIUM on QBO transformer contract (QBO API shape verified, markdown schema is our design)

---

## Scope

This document covers only the three new v1.1 capabilities and how they integrate with the existing v1.0 codebase. The v1.0 architecture (spawn-per-request, per-tenant mutex, in-memory tenant Map, SSE streaming, filesystem-as-state) is preserved and extended — not re-designed.

**v1.0 baseline (do not re-research):**
- Routes: `/`, `/onboard`, `/dash/[id]`
- API: `POST /api/tenants`, `GET /api/tenants/[id]/onboard` (SSE), `POST /api/tenants/[id]/chat` (SSE), `GET /api/tenants/[id]/insights`, `POST /api/tenants/[id]/reset`
- `lib/gbrain/client.ts` — `spawnGBrain()`, `query()`, `think()`
- `lib/gbrain/mutex.ts` — per-tenant Promise mutex via `withTenantLock()`
- `lib/gbrain/tenants.ts` — in-memory `Map<tenantId, TenantRecord>` rebuilt from `./brains/*`
- `lib/gbrain/paths.ts` — `brainHome()`, `seedBrainHome()`, `FIXTURES_ROOT`
- `lib/gbrain/slug.ts` — `TENANT_SLUG_REGEX`, `assertTenantSlug()`
- `lib/gbrain/abort-tracker.ts` — `registerAbortable()`, `abortTenant()`
- `lib/insights/` — parsers reading `data/maras-coffee/` markdown + in-process cache
- `scripts/detect-anomalies.ts` — hand-rolled TS anomaly detector writing `concepts/` pages
- `scripts/seed.sh` — full seed pipeline

---

## Capability 1: Custom `smb-audit` gbrain Skill (Phase 4)

### Key finding: gbrain has two distinct skill mechanisms

gbrain distinguishes between:
1. **Routing skills** — `SKILL.md` + TypeScript handlers that gbrain's router dispatches to on natural-language queries. These live **inside the gbrain install** under `skills/`. They are NOT the right mechanism for QuickBrain because they require modifying the upstream gbrain repo.
2. **Shell jobs** — `gbrain jobs submit shell --params '{"cmd":"bun scripts/detect-anomalies.ts","cwd":"..."}'` executed by a Minions worker. This is exactly our existing `detect-anomalies.ts` elevated into gbrain's job queue.
3. **Plugin handlers** — `MinionWorker` + `worker.register('smb-audit', async ctx => {...})` registered from outside the gbrain repo via `GBRAIN_PLUGIN_PATH`. This is the canonical "custom skill" path for downstream hosts. Requires running a long-lived worker process.

**Decision: use gbrain's shell-job mechanism, not the plugin handler.** The plugin handler path requires a persistent `gbrain jobs work` daemon, which adds process lifecycle complexity we explicitly avoided for v1.0's CLI shell-out architecture. The shell-job approach (`GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow`) runs our existing TypeScript logic via gbrain's Minions queue — gbrain's job infrastructure tracks it, retries it, and surfaces it as a real gbrain skill. This satisfies the prize narrative ("gbrain's skill system runs the audit") without a daemon.

The existing `scripts/detect-anomalies.ts` already writes `concepts/` pages in exactly the right format. Phase 4 is a structural refactor, not a logic rewrite.

### Where the skill lives

```
quick-brain/
├── skills/
│   └── smb-audit/
│       ├── SKILL.md          NEW — gbrain skill frontmatter + contract doc
│       └── index.ts          NEW — skill entry point (thin wrapper; logic stays in lib/)
├── lib/
│   └── audit/
│       ├── anomaly-detector.ts   MODIFIED — extracted from scripts/detect-anomalies.ts
│       └── index.ts              NEW — exports for scripts + skill entry point
└── scripts/
    └── detect-anomalies.ts   MODIFIED — becomes a thin CLI wrapper calling lib/audit/
```

`skills/smb-audit/` lives at the repo root, NOT inside `brains/seed/.gbrain/skills/`. gbrain skill routing directories (`skills/`) are part of the gbrain **install** repo, not the brain content repo. Our skill is a host-side construct invoked as a shell job.

### SKILL.md frontmatter

```yaml
---
name: smb-audit
version: 1.0.0
description: |
  Scans originals/ invoices and bank-statement debits for three SMB anomaly
  patterns: vendor price hike (>20% MoM), duplicate same-vendor charges within
  7 days, and ghost recurring subscriptions (monthly debit, no company event
  >90 days). Writes findings to concepts/march-anomaly-summary.md and
  concepts/recurring-charges.md.
triggers:
  - "run smb audit"
  - "scan for anomalies"
  - "detect unusual charges"
tools:
  - read_file
  - write_file
mutating: true
---
```

### Minion declaration in seed.sh (MODIFIED)

```bash
# After gbrain embed --stale:
log "Submitting smb-audit as a gbrain shell job"
GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell \
  --params "{\"cmd\":\"bun ${REPO_ROOT}/skills/smb-audit/index.ts\",\"cwd\":\"${REPO_ROOT}\"}" \
  --max-attempts 2 \
  --timeout-ms 60000 \
  --follow
```

The `--follow` flag blocks until the job completes, preserving the synchronous seed pipeline contract.

### Relationship to existing `lib/insights/anomalies.ts`

`lib/insights/anomalies.ts` reads the **already-written** `concepts/march-anomaly-summary.md` to populate the Anomalies insight card. It does NOT run detection — it parses output. This relationship is unchanged.

After Phase 4 the pipeline is:
- **Detection** → `lib/audit/anomaly-detector.ts` (extracted from `scripts/detect-anomalies.ts`) — writes `concepts/march-anomaly-summary.md` and `concepts/recurring-charges.md`
- **Reading** → `lib/insights/anomalies.ts` — parses the written concept pages into `AnomalyRow[]`

The insight card contract (what `InsightBundle.anomalies` contains) does not change.

### Data flow: smb-audit skill

```
scripts/seed.sh
  └─ gbrain jobs submit shell → skills/smb-audit/index.ts
       └─ lib/audit/anomaly-detector.ts
            ├─ reads data/maras-coffee/originals/*.md  (invoices, bank-statements)
            ├─ reads data/maras-coffee/companies/*.md  (vendor pages)
            └─ writes data/maras-coffee/concepts/march-anomaly-summary.md
                       data/maras-coffee/concepts/recurring-charges.md

                  ↓ (seed.sh continues)

gbrain import data/maras-coffee/  [already ran before skill step]
  → concept pages are already in the brain by the time gbrain embed runs

                  ↓ (at runtime)

GET /api/tenants/[id]/insights
  └─ lib/insights/anomalies.ts → reads concepts/march-anomaly-summary.md
       └─ AnomalyRow[] → InsightBundle.anomalies → insight card
```

Wait — there is an ordering issue. The seed pipeline currently runs `gbrain import` THEN `detect-anomalies`. The concept pages are written AFTER import, so they exist on disk but are NOT in the brain's PGLite index. Currently the insight card reads them directly from the filesystem (not from gbrain's index), so this works. In v1.1, the skill job runs AFTER import, same position. No ordering change needed.

If we later want `gbrain query "what anomalies were found?"` to return the concept pages (i.e., the pages to be indexed in PGLite), we need to run a second `gbrain import data/maras-coffee/concepts/` after the skill. Add to seed.sh:

```bash
# After smb-audit job completes:
log "gbrain import concepts/ (post-skill)"
gbrain import "${DATA_DIR}/concepts/" --no-embed
gbrain embed --stale
```

### New vs modified files — Phase 4

| File | Status | Notes |
|------|--------|-------|
| `skills/smb-audit/SKILL.md` | NEW | gbrain skill declaration |
| `skills/smb-audit/index.ts` | NEW | Shell entry point; calls `lib/audit/anomaly-detector.ts` |
| `lib/audit/anomaly-detector.ts` | NEW | Logic extracted from `scripts/detect-anomalies.ts` |
| `lib/audit/index.ts` | NEW | Re-exports |
| `scripts/detect-anomalies.ts` | MODIFIED | Becomes thin CLI wrapper: `import { runDetection } from '../lib/audit'; runDetection(DATA_ROOT)` |
| `scripts/seed.sh` | MODIFIED | Replace `bun scripts/detect-anomalies.ts` with `gbrain jobs submit shell` invocation; add post-skill import step |
| `lib/insights/anomalies.ts` | UNCHANGED | Still reads the concept pages from filesystem |
| `lib/insights/types.ts` | UNCHANGED | `AnomalyRow` contract unchanged |

---

## Capability 2: Email Magic-Link Auth (Phase 5)

### Auth boundary placement

Auth lives in **Next.js Middleware** (`middleware.ts` at repo root). Middleware runs on the Edge runtime before any Route Handler or page — it reads the session cookie, verifies the JWT, and either allows the request or redirects to `/sign-in`.

Protected routes: `/dash/:id`, `/api/tenants/*`, `/api/qbo/*`
Public routes: `/`, `/sign-in`, `/api/auth/*`

### Route map

```
/sign-in                           NEW page — email input form
/api/auth/send-link   POST         NEW Route Handler — generate + email token, rate-limit
/api/auth/verify      GET          NEW Route Handler — verify token, issue session cookie, redirect
/api/auth/sign-out    POST         NEW Route Handler — clear session cookie
middleware.ts                      NEW — JWT check on protected routes
```

### Session state propagation

**HttpOnly cookie, SameSite=Lax, signed JWT.**

- Token library: `jose` (Web Crypto API, works in both Node.js Route Handlers and Edge Middleware)
- Cookie name: `qb_session`
- JWT payload: `{ sub: userId, email, brainSlug, iat, exp }`
- Session TTL: 7 days
- Magic-link TTL: 15 minutes (short-lived, one-time-use)
- Magic-link token: separate signed JWT with `{ purpose: 'magic-link', email, nonce, exp }` — the nonce is stored in the user record to enforce single-use

No refresh tokens needed. Session re-issuance on magic-link click is the "refresh" mechanic.

### Where users live

**App-layer PGLite instance at `./data/app.pglite`** — a separate PGLite database owned by QuickBrain (not gbrain's brain database). This matches PROJECT.md's "PGLite-backed; no Postgres for the app layer" decision.

Schema (minimal):
```sql
CREATE TABLE users (
  id          TEXT PRIMARY KEY,   -- UUID v4
  email       TEXT UNIQUE NOT NULL,
  brain_slug  TEXT,               -- FK to brains/<slug>/ — set after first sign-in + onboard
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  magic_nonce TEXT               -- last-issued magic-link nonce (for single-use enforcement)
);
```

The PGLite instance is a module-level singleton in `lib/db/app-db.ts`. It opens `./data/app.pglite` on first import, runs `CREATE TABLE IF NOT EXISTS`, and exports the connection.

**Why not reuse gbrain's PGLite?** gbrain's brain database (at `brains/<tenantId>/brain.pglite`) is per-tenant, managed by gbrain. User records span tenants. A separate app-layer database is cleaner and avoids touching gbrain's schema.

**Why not a JSON file?** Single-user demo plus multi-user v1.1 with QBO tokens — a structured DB is worth the 10-line setup, especially given PGLite's zero-install overhead.

### Anonymous onboarding fate

The existing anonymous `/onboard` flow is preserved as **demo mode**. Sign-in is opt-in:

- `/` landing page: "Start your business brain" (anonymous, existing) + "Sign in" link (new)
- `/onboard` anonymous path: unchanged; creates a tenant without a user record
- `/dash/[id]` page: if a session cookie exists AND `user.brain_slug === id`, render the authenticated dashboard. If no session cookie, render the public demo dashboard (no reset, no QBO connect button)
- The reset button and QBO connect button are **only** rendered for authenticated users whose `brain_slug` matches the current `tenantId`

This preserves the YC demo's "no sign-in required" story while adding auth for real-user onboarding.

### Identity model: tenantId vs userId

v1.0's `TenantRecord` in `lib/gbrain/tenants.ts` uses `tenantId` as the key and identifies the brain directory. This is preserved.

Users are tracked separately in the `users` table. The relationship is `user.brain_slug = tenantId`. There is no rename of `tenantId` to `userId` — the concepts are distinct.

The per-tenant mutex in `lib/gbrain/mutex.ts` continues to key by `tenantId`. No change needed; user identity is resolved before the mutex is acquired.

### Data flow: magic-link auth

```
[Browser /sign-in]
  └─ POST /api/auth/send-link { email }
       ├─ rate-limit check (max 3 tokens / 10 min per email, tracked in users table)
       ├─ upsert user record by email
       ├─ generate magic-link JWT (15 min, nonce stored in users.magic_nonce)
       ├─ send email via nodemailer (SMTP config in .env.local)
       └─ 200 { sent: true }

[User clicks link in email]
  └─ GET /api/auth/verify?token=<jwt>
       ├─ verify JWT signature + expiry
       ├─ look up user by email from JWT payload
       ├─ compare nonce in JWT vs users.magic_nonce (single-use enforcement)
       ├─ clear users.magic_nonce (invalidate link)
       ├─ issue 7-day session cookie (qb_session)
       └─ redirect to /dash/<brain_slug> if brain_slug set, else /onboard

[Middleware on every protected request]
  └─ read qb_session cookie
       ├─ verify JWT (jose, Edge runtime)
       ├─ attach { userId, email, brainSlug } to request headers
       └─ pass through (or redirect /sign-in on failure)

[POST /api/tenants — after auth]
  └─ creates tenant + sets users.brain_slug = tenantId
```

### New vs modified files — Phase 5

| File | Status | Notes |
|------|--------|-------|
| `middleware.ts` | NEW | Edge JWT check; protects `/dash/*`, `/api/tenants/*`, `/api/qbo/*` |
| `lib/db/app-db.ts` | NEW | Module-level PGLite singleton; `data/app.pglite`; schema init |
| `lib/db/users.ts` | NEW | `getUser()`, `upsertUser()`, `setMagicNonce()`, `clearMagicNonce()`, `setBrainSlug()` |
| `lib/auth/tokens.ts` | NEW | `signMagicToken()`, `verifyMagicToken()`, `signSession()`, `verifySession()` using `jose` |
| `lib/auth/rate-limit.ts` | NEW | In-memory or DB-backed rate limiter (3 tokens / 10 min per email) |
| `app/sign-in/page.tsx` | NEW | Email input form |
| `app/api/auth/send-link/route.ts` | NEW | POST: generate + email magic link |
| `app/api/auth/verify/route.ts` | NEW | GET: verify token, set cookie, redirect |
| `app/api/auth/sign-out/route.ts` | NEW | POST: clear cookie |
| `app/api/tenants/route.ts` | MODIFIED | After tenant creation, call `users.setBrainSlug(userId, tenantId)` if authenticated |
| `app/dash/[id]/page.tsx` | MODIFIED | Check session; conditionally render reset/QBO buttons for authenticated owner |
| `app/page.tsx` | MODIFIED | Add "Sign in" link |
| `lib/gbrain/tenants.ts` | UNCHANGED | `TenantRecord` shape unchanged |
| `lib/gbrain/mutex.ts` | UNCHANGED | Still keyed by tenantId |

---

## Capability 3: QuickBooks Online Ingest (Phase 6)

### OAuth flow routes

```
/api/qbo/connect      GET    NEW — build QBO auth URL (state=tenantId), redirect user to Intuit
/api/qbo/callback     GET    NEW — receive auth code, exchange for tokens, store encrypted, redirect /dash/<tenantId>
/api/qbo/disconnect   POST   NEW — revoke tokens, clear from user record
/api/qbo/sync         POST   NEW — SSE stream: fetch QBO data → transform → import to brain
```

All QBO routes are auth-protected (middleware). `realmId` (QBO company ID) and tokens are stored in the users table.

### Token storage

Schema addition to users table:
```sql
ALTER TABLE users ADD COLUMN qbo_realm_id        TEXT;
ALTER TABLE users ADD COLUMN qbo_access_token     TEXT;  -- AES-256-GCM encrypted
ALTER TABLE users ADD COLUMN qbo_refresh_token    TEXT;  -- AES-256-GCM encrypted
ALTER TABLE users ADD COLUMN qbo_token_expires_at TIMESTAMPTZ;
```

Encryption: `node:crypto` `createCipheriv('aes-256-gcm', QBO_ENCRYPTION_KEY, iv)`. Key from `QBO_ENCRYPTION_KEY` env var (32-byte hex string). The encrypted column stores `iv:ciphertext:authTag` as a base64 concatenation.

The QBO access token expires in 1 hour; refresh token expires in 100 days. Refresh is triggered inline at the start of every `/api/qbo/sync` call.

### Sync execution pattern

**Inline SSE during a button-press**, matching the onboarding flow. No background daemon.

The `/api/qbo/sync` Route Handler:
1. Refreshes QBO access token if needed (inline)
2. Fetches QBO entities: Invoices, Bills, Purchases (bank-feed transactions), Vendors
3. Transforms each entity to a markdown file via `lib/qbo/transformer.ts`
4. Writes transformed files to `brains/<tenantId>/brain-repo/originals/` and `brains/<tenantId>/brain-repo/companies/`
5. Calls `gbrain import <brain-repo-dir>` via `spawnGBrain()` (through mutex)
6. Calls `gbrain embed --stale` via `spawnGBrain()`
7. Runs the smb-audit skill (via `spawnGBrain(['jobs', 'submit', 'shell', ...])`)
8. Emits SSE progress events throughout
9. Invalidates the insight cache for this tenant

### Transformer contract

Location: `lib/qbo/transformer.ts` — NEW file.

```typescript
// Input: QBO API response object for a single entity
// Output: { path: string; content: string }

type QboInvoice = { Id: string; TxnDate: string; TotalAmt: number; CustomerRef: { name: string }; Line: QboLineItem[]; ... }
type QboVendor  = { Id: string; DisplayName: string; PrimaryPhone?: {...}; ... }
type QboPayment = { Id: string; TxnDate: string; TotalAmt: number; VendorRef: { name: string }; ... }

export function transformInvoice(inv: QboInvoice): { path: string; content: string }
export function transformVendor(v: QboVendor): { path: string; content: string }
export function transformPayment(p: QboPayment): { path: string; content: string }
```

Output paths follow the exact same schema as the synthetic seed data:
- Invoices → `originals/invoice-<vendor-slug>-<date>.md`
- Vendors → `companies/<vendor-slug>.md`
- Bank transactions (Purchases) → `originals/bank-statement-<year-month>.md` (grouped by month)

Each file follows the three-element seed format: YAML frontmatter (`type:`, `title:`, `tags:`, `date:`), "Compiled truth:" paragraph, `---`, timeline bullets with `[[wikilinks]]`.

The transformer is **pure functions** — no I/O. The sync Route Handler does all file writing via `node:fs/promises`. This makes the transformer fully testable without gbrain.

### Brain dir population: QBO vs seed scenarios

Two scenarios when a user connects QBO:

**Scenario A: User connects QBO at first sign-in (before any seed copy)**
1. `/api/tenants` route is skipped — instead `/api/qbo/connect` is the entry point
2. After OAuth callback succeeds, Route Handler calls `gbrain init` via `spawnGBrain(['init', '--yes'], { tenantId })`
3. `/api/qbo/sync` runs: fetch QBO data → transform → write to `brains/<tenantId>/brain-repo/` → `gbrain import` → `gbrain embed` → skill
4. No `brains/seed/` copy involved

**Scenario B: User connects QBO after demo seed is in place (most common during v1.1)**
1. User already has `brains/<tenantId>/` populated from the seed copy
2. `/api/qbo/sync` runs in **additive mode**: transformer writes to `originals/qbo-*.md` and `companies/` (using QBO data path prefix to distinguish from seed data)
3. Existing seed concept pages are preserved; `gbrain import` picks up the new QBO-sourced files
4. `gbrain embed --stale` only embeds new/changed pages
5. Insight cache is invalidated; next GET `/api/tenants/[id]/insights` recomputes

No "wipe and replace" of the seed. Additive merge is safer and simpler. The smb-audit skill will run over both seed and QBO data, which is the correct behavior.

### Dashboard refresh after QBO sync

Current: insight cache is an in-memory `Map` populated by `computeAndCache()` reading `data/maras-coffee/` (fixed path).

After QBO sync, the insight parsers need to read from the brain dir, not the static fixtures dir. Required change:

`lib/insights/cache.ts` `computeAndCache()` currently hardcodes `FIXTURES_ROOT`. It must accept a `sourceDir` parameter: the per-tenant `brainHome(tenantId)/brain-repo/` directory for QBO-connected tenants, or `FIXTURES_ROOT` for seed-only tenants.

The insight Route Handler already passes `FIXTURES_ROOT` for seed and newly-created tenants. After QBO sync completes, the sync Route Handler calls `invalidate(tenantId)` (already in `lib/insights/cache.ts`). The next dashboard load triggers recomputation from the correct source directory.

The sync Route Handler emits a final `SSE 'done'` event; the browser refreshes the dashboard by re-fetching `/api/tenants/[id]/insights`.

### QBO API endpoints used

| Data | QBO endpoint | Mapped to |
|------|-------------|-----------|
| Vendors (suppliers) | `GET /v3/company/<realmId>/query?query=SELECT * FROM Vendor` | `companies/<slug>.md` |
| Bills (AP invoices) | `GET /v3/company/<realmId>/query?query=SELECT * FROM Bill` | `originals/invoice-<vendor>-<date>.md` |
| Purchases (bank transactions) | `GET /v3/company/<realmId>/query?query=SELECT * FROM Purchase` | `originals/bank-statement-<ym>.md` |
| Invoices (AR, if any) | `GET /v3/company/<realmId>/query?query=SELECT * FROM Invoice` | `originals/invoice-ar-<date>.md` |

OAuth scope: `com.intuit.quickbooks.accounting` (covers all the above read-only). No write scopes needed.

### Data flow: QBO sync

```
[Browser /dash/<tenantId>]
  └─ clicks "Connect QuickBooks"
       └─ GET /api/qbo/connect
            ├─ build QBO auth URL (clientId, scope, state=tenantId, redirectUri=/api/qbo/callback)
            └─ 302 → Intuit OAuth consent screen

[Intuit OAuth consent screen]
  └─ user authorizes → 302 → /api/qbo/callback?code=<auth_code>&realmId=<realm>

[GET /api/qbo/callback]
  ├─ exchange auth_code for {access_token, refresh_token}
  ├─ encrypt tokens → store in users table (qbo_access_token, qbo_refresh_token, qbo_realm_id)
  └─ 302 → /dash/<tenantId>?qbo=connected

[Browser /dash/<tenantId>]
  └─ sees "Sync QuickBooks" button → clicks
       └─ POST /api/qbo/sync → SSE stream

[SSE stream /api/qbo/sync]
  ├─ refresh QBO token if needed (inline)
  ├─ SSE: "Fetching your QuickBooks data..."
  ├─ fetch Vendors, Bills, Purchases (parallel)
  ├─ SSE: "Transforming <N> records..."
  ├─ transform → markdown files via lib/qbo/transformer.ts
  ├─ write files to brains/<tenantId>/brain-repo/originals/ + companies/
  ├─ SSE: "Importing into brain..."
  ├─ spawnGBrain(['import', brainRepoDir]) → mutex-queued
  ├─ spawnGBrain(['embed', '--stale']) → mutex-queued
  ├─ SSE: "Running anomaly scan..."
  ├─ spawnGBrain(['jobs', 'submit', 'shell', ...smb-audit-params]) → mutex-queued
  ├─ invalidate(tenantId) in insight cache
  ├─ SSE: 'done'
  └─ Browser re-fetches /api/tenants/<id>/insights → cards refresh
```

### New vs modified files — Phase 6

| File | Status | Notes |
|------|--------|-------|
| `lib/qbo/transformer.ts` | NEW | Pure functions: QBO JSON → `{ path, content }` markdown |
| `lib/qbo/client.ts` | NEW | QBO API fetch wrapper; token refresh; `fetchVendors()`, `fetchBills()`, `fetchPurchases()` |
| `lib/qbo/tokens.ts` | NEW | `encryptToken()`, `decryptToken()` using `node:crypto` AES-256-GCM |
| `lib/db/users.ts` | MODIFIED | Add `getQboTokens()`, `setQboTokens()`, `clearQboTokens()` |
| `app/api/qbo/connect/route.ts` | NEW | GET: redirect to QBO OAuth |
| `app/api/qbo/callback/route.ts` | NEW | GET: exchange code, store tokens |
| `app/api/qbo/disconnect/route.ts` | NEW | POST: revoke + clear tokens |
| `app/api/qbo/sync/route.ts` | NEW | POST SSE: fetch → transform → import → skill → invalidate |
| `app/dash/[id]/page.tsx` | MODIFIED | Add "Connect QuickBooks" / "Sync QuickBooks" buttons (auth-gated) |
| `lib/insights/cache.ts` | MODIFIED | `computeAndCache(tenantId, sourceDir)` — accept dir param instead of hardcoding `FIXTURES_ROOT` |
| `lib/insights/top-vendors.ts` | MODIFIED | Accept `sourceDir` param |
| `lib/insights/pnl.ts` | MODIFIED | Accept `sourceDir` param |
| `lib/insights/anomalies.ts` | MODIFIED | Accept `sourceDir` param |
| `app/api/tenants/[id]/insights/route.ts` | MODIFIED | Pass correct `sourceDir` (QBO brain-repo dir or FIXTURES_ROOT) |

---

## Unified Component Map (v1.1)

```
quick-brain/
├── app/
│   ├── page.tsx                          MODIFIED — add "Sign in" link
│   ├── sign-in/page.tsx                  NEW
│   ├── onboard/page.tsx                  UNCHANGED
│   ├── dash/[id]/page.tsx                MODIFIED — auth-gated QBO + reset buttons
│   └── api/
│       ├── tenants/route.ts              MODIFIED — link user on creation
│       ├── tenants/[id]/...              UNCHANGED (onboard, chat, insights, reset)
│       ├── auth/
│       │   ├── send-link/route.ts        NEW
│       │   ├── verify/route.ts           NEW
│       │   └── sign-out/route.ts         NEW
│       └── qbo/
│           ├── connect/route.ts          NEW
│           ├── callback/route.ts         NEW
│           ├── disconnect/route.ts       NEW
│           └── sync/route.ts             NEW (SSE)
├── middleware.ts                         NEW
├── lib/
│   ├── auth/
│   │   ├── tokens.ts                    NEW — jose JWT helpers
│   │   └── rate-limit.ts               NEW — email send rate limiter
│   ├── db/
│   │   ├── app-db.ts                    NEW — PGLite singleton (data/app.pglite)
│   │   └── users.ts                     NEW — user CRUD
│   ├── qbo/
│   │   ├── transformer.ts               NEW — pure transform functions
│   │   ├── client.ts                    NEW — QBO API + token refresh
│   │   └── tokens.ts                    NEW — AES-256-GCM encrypt/decrypt
│   ├── audit/
│   │   ├── anomaly-detector.ts          NEW — logic from scripts/detect-anomalies.ts
│   │   └── index.ts                     NEW
│   ├── gbrain/                          UNCHANGED
│   ├── insights/
│   │   ├── cache.ts                     MODIFIED — accept sourceDir param
│   │   ├── top-vendors.ts               MODIFIED — accept sourceDir param
│   │   ├── pnl.ts                       MODIFIED — accept sourceDir param
│   │   ├── anomalies.ts                 MODIFIED — accept sourceDir param
│   │   ├── prewarm.ts                   UNCHANGED
│   │   └── types.ts                     UNCHANGED
│   ├── onboarding/                      UNCHANGED
│   ├── chat/                            UNCHANGED
│   └── utils.ts                         UNCHANGED
├── skills/
│   └── smb-audit/
│       ├── SKILL.md                     NEW
│       └── index.ts                     NEW
├── data/
│   ├── app.pglite                       NEW — app-layer user DB (gitignored)
│   └── maras-coffee/                    UNCHANGED
├── brains/                              UNCHANGED
└── scripts/
    ├── seed.sh                          MODIFIED — skill job submission step
    ├── detect-anomalies.ts              MODIFIED — thin CLI wrapper
    └── ...                              UNCHANGED
```

---

## Cross-Capability Integration Notes

### Build order dependency graph

```
Phase 4 (SKIL) — INDEPENDENT of auth and QBO
  ↓ no dependency
Phase 5 (AUTH) — INDEPENDENT of SKIL, but QBO depends on AUTH
  ↓ provides: userId, users table, session cookie, middleware
Phase 6 (QBO) — DEPENDS ON: AUTH (for user identity + token storage)
                             SKIL (the smb-audit skill runs after sync)
```

This confirms the roadmap phase order: SKIL → AUTH → QBO. SKIL has zero dependencies on the other two. AUTH provides the identity plumbing QBO needs. QBO needs both AUTH (token storage) and SKIL (audit post-sync).

### Mutex behavior with QBO sync

QBO sync calls `spawnGBrain(['import', ...])` and `spawnGBrain(['embed', '--stale'])` sequentially. Both go through `withTenantLock()`. The sync handler is the only in-flight operation for that tenant during sync (the dashboard is in a loading state). Mutex contention is not a concern.

### Insight cache sourceDir resolution

After Phase 6, `computeAndCache()` needs to know which directory to read from:

```typescript
// lib/insights/cache.ts
export async function computeAndCache(
  tenantId: string,
  sourceDir: string  // MODIFIED: was implicitly FIXTURES_ROOT
): Promise<InsightBundle>
```

The insights Route Handler resolves `sourceDir`:
- Seed-only tenant (no QBO connection): `FIXTURES_ROOT`
- QBO-connected tenant: `path.join(brainHome(tenantId), 'brain-repo')`

This is determined by checking `users.qbo_realm_id` for the tenant owner (requires mapping tenantId → userId, which the users table provides via `brain_slug`).

### Session cookie on anonymous tenants

Anonymous tenants (no sign-in) are not in the users table. The middleware allows anonymous access to `/dash/[id]` for demo purposes. The dashboard renders a subset of features:
- Chat: available (no auth needed)
- Insight cards: available (no auth needed)
- Reset button: available (no auth needed, same as v1.0)
- "Connect QuickBooks" button: hidden (requires sign-in)

---

## Environment Variables (additions for v1.1)

```bash
# .env.local additions

# Auth
JWT_SECRET=<32-byte random hex>        # Signs session and magic-link JWTs

# Email delivery (magic links)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<email address>
SMTP_PASS=<app password>
SMTP_FROM="QuickBrain <noreply@quickbrain.app>"

# QBO OAuth
QBO_CLIENT_ID=<from Intuit Developer Portal>
QBO_CLIENT_SECRET=<from Intuit Developer Portal>
QBO_REDIRECT_URI=http://localhost:3000/api/qbo/callback
QBO_ENVIRONMENT=sandbox  # or "production"

# QBO token encryption
QBO_ENCRYPTION_KEY=<32-byte random hex>  # AES-256 key for token encryption
```

---

## Dependencies to Add

| Package | Purpose | Phase |
|---------|---------|-------|
| `jose` | JWT sign/verify (Web Crypto, works in Edge Middleware + Node.js) | Phase 5 |
| `nodemailer` | SMTP email delivery for magic links | Phase 5 |
| `@electric-sql/pglite` | App-layer user database | Phase 5 |
| `intuit-oauth` (or manual fetch) | QBO OAuth token exchange + refresh | Phase 6 |

`@electric-sql/pglite` is NOT the same as gbrain's PGLite (which is bundled inside gbrain). This is a separate install for the app-layer user DB. Confidence MEDIUM on API — verify the current package name and import path at install time.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| smb-audit skill placement and shell-job mechanism | HIGH | Verified via Context7 gbrain docs: `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow` is the correct path for a deterministic post-import script; GBRAIN_PLUGIN_PATH / MinionWorker is for LLM subagents requiring a daemon |
| Skill SKILL.md frontmatter format | HIGH | Template verified via Context7 from `skills/skill-creator/SKILL.md` |
| seed.sh ordering: skill runs after import, concepts re-imported after skill | MEDIUM | Ordering logic is ours; gbrain's shell job `--follow` flag blocks as expected (verified) |
| Auth: jose + HttpOnly cookie + app-layer PGLite | HIGH | Standard 2026 Next.js App Router auth pattern; jose works in both Edge and Node.js runtimes |
| Anonymous onboarding preserved alongside auth | HIGH | Design decision consistent with PROJECT.md constraints |
| QBO OAuth 2.0 flow (Authorization Code, scope `accounting`) | HIGH | Standard Intuit OAuth 2.0 pattern, well-documented |
| QBO token refresh (inline before sync) | HIGH | Standard pattern; refresh token expires in 100 days |
| QBO transformer contract (QBO JSON → seed-schema markdown) | MEDIUM | QBO response shape verified; our markdown output format is our design — needs integration test |
| Insight cache sourceDir parameterization | HIGH | Mechanical change to existing pure parsers |
| Additive merge (seed + QBO data coexist) | MEDIUM | Depends on gbrain correctly processing both sources without collision on slug uniqueness — verify no slug collisions between QBO vendor names and synthetic seed company slugs |

---

## Pitfalls Specific to v1.1 Integration

### Skill ordering: concept pages must exist before second `gbrain import`
If `gbrain import` runs before `detect-anomalies` writes concept pages, those pages are not in the PGLite index. The chat surface cannot retrieve them via `gbrain query`. Current v1.0 workaround: insight parsers read concept pages directly from filesystem. This works but means `gbrain query "what anomalies were found?"` returns nothing from the brain. Fix in v1.1: run `gbrain import data/maras-coffee/concepts/` AFTER the skill job completes.

### PGLite dual-instance: one for gbrain, one for app layer
The app-layer `data/app.pglite` and gbrain's per-tenant `brains/<id>/brain.pglite` are two separate PGLite instances. They do not share connections or locks. The app-layer PGLite is opened once per Next.js process. gbrain's PGLite is opened/closed per CLI invocation via the mutex. No conflict, but developers must not confuse the two.

### QBO sandbox vs production: realmId differs
The QBO sandbox and production environments use different realmIds for the same company. If a user authorizes in sandbox and then the environment switches to production, their stored realmId is invalid. Keep `QBO_ENVIRONMENT=sandbox` in dev and add a migration check for production.

### Magic-link JWTs vs session JWTs: different signing keys
Use the same `JWT_SECRET` for both but different `purpose` claims (`'magic-link'` vs `'session'`). Verify the purpose claim at each verification point to prevent a magic-link token from being accepted as a session token and vice versa.

### Slug collision: QBO vendor names vs synthetic seed company slugs
The QBO transformer slugifies `Vendor.DisplayName` to generate `companies/<slug>.md`. If a QBO vendor has the same slug as a synthetic seed company (e.g., a user named their vendor "Square POS"), the QBO transformer will overwrite the seed company page. Fix: prefix QBO-sourced company pages with `qbo-` (e.g., `companies/qbo-square-pos.md`). Update the `smb-audit` detector to recognize both prefixed and unprefixed slugs when matching debits to companies.

---

## Sources

- [gbrain skills/skill-creator/SKILL.md](https://github.com/garrytan/gbrain/blob/master/skills/skill-creator/SKILL.md) — SKILL.md frontmatter format, `gbrain skillify scaffold` command (HIGH)
- [gbrain docs/guides/plugin-authors.md](https://github.com/garrytan/gbrain/blob/master/docs/guides/plugin-authors.md) — GBRAIN_PLUGIN_PATH, subagent plugin discovery (HIGH)
- [gbrain docs/guides/plugin-handlers.md](https://github.com/garrytan/gbrain/blob/master/docs/guides/plugin-handlers.md) — MinionWorker.register() for custom handlers (HIGH)
- [gbrain docs/guides/minions-shell-jobs.md](https://github.com/garrytan/gbrain/blob/master/docs/guides/minions-shell-jobs.md) — GBRAIN_ALLOW_SHELL_JOBS=1 shell job pattern (HIGH)
- [gbrain skills/minion-orchestrator/SKILL.md](https://github.com/garrytan/gbrain/blob/master/skills/minion-orchestrator/SKILL.md) — shell vs subagent routing decision (HIGH)
- [gbrain README — SKILLS section](https://github.com/garrytan/gbrain/blob/master/README.md) — `gbrain skillify scaffold`, `gbrain jobs submit` commands (HIGH)
- [Next.js magic-link JWT cookie pattern](https://www.scalekit.com/blog/passwordless-authentication-next-js) — HttpOnly cookie, jose, send-link/verify flow (MEDIUM)
- [jose documentation](https://github.com/panva/jose) — Web Crypto JWT, works Edge + Node.js (HIGH)
- [PGLite documentation](https://pglite.dev/docs/) — in-process Postgres, filesystem persistence, Node.js/Bun support (HIGH)
- [QuickBooks Online OAuth guide](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/oauth-2.0) — Authorization Code flow, scopes, token refresh (HIGH)
- [QuickBooks API integration guide](https://zuplo.com/learning-center/quickbooks-api) — endpoint shape, realmId, minor versions (MEDIUM)
- [node-quickbooks npm](https://www.npmjs.com/package/node-quickbooks) — Node.js QBO client reference (MEDIUM)
- Context7 `/garrytan/gbrain` — skill mechanism verification, shell job docs, MinionWorker docs (HIGH)

---

*Architecture research for: QuickBrain v1.1 integration (smb-audit skill, magic-link auth, QBO ingest)*
*Researched: 2026-05-17*
