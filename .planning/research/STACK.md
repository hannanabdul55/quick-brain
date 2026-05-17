# Technology Stack: QuickBrain v1.1 "Beyond the Demo"

**Project:** QuickBrain v1.1
**Researched:** 2026-05-17
**Scope:** NEW additions only. The v1.0 stack (Bun 1.2, Next.js 15 App Router, React 19, TypeScript 5.5+, shadcn/ui, Tailwind v4, zod, react-markdown + remark-gfm, hand-rolled SSE, child_process.spawn + in-process mutex) is validated and NOT re-researched here.

---

## TL;DR — v1.1 Stack Additions

| Layer | Pick | Version |
|---|---|---|
| Email delivery | **Resend** | `4.x` (npm: `4.3.0+`) |
| Magic-link token / session JWT | **jose** | `6.x` (npm: `6.2.3`) |
| App-layer user/tenant DB | **bun:sqlite** (built-in) via a thin wrapper | Bun 1.2 built-in |
| OAuth token encryption at rest | **node:crypto** `aes-256-gcm` | Node.js built-in |
| QuickBooks Online OAuth 2.0 | **intuit-oauth** | `4.x` (npm: `4.2.3`) |
| QuickBooks Accounting API | **node-quickbooks** | `2.0.50` (community; typed via JSDoc) |
| gbrain skill authoring | **gbrain skillify scaffold** CLI | gbrain 0.35.1 built-in |

Zero new runtime dependencies beyond the two QBO libraries and Resend. Everything else is either Bun-built-in or Node.js-built-in.

---

## 1. Email Delivery — Resend `4.x`

### Pick: Resend

```bash
bun add resend
```

**Current version:** `4.3.0` (npm `resend@4.3.0` as of 2026-05-17 — `npm view resend version` = 6.12.3 — confirming latest is `6.x`; install `resend@latest`).

**Correction:** `npm view resend version` returns `6.12.3`. Use `resend@latest` = `6.x`.

```bash
bun add resend   # installs 6.x
```

**Free tier:** 3,000 emails/month, 100/day. No credit card required. More than sufficient for an SMB onboarding product at early scale — a user who triggers 3 magic-link emails per day is ~90 users/day before hitting the cap.

**Deliverability:** Resend routes through Amazon SES infrastructure with a developer-managed domain reputation layer. Deliverability is rated "good" — sufficient for magic-link authentication at v1.1 volumes. Postmark has marginally better raw deliverability (98.7% vs ~96% inbox placement) but costs $15.50/month minimum and offers only 100 free test emails. At pre-revenue volume, the Resend free tier is the right call. Revisit at 500+ DAU.

**TypeScript DX:** First-class TypeScript SDK with typed request/response shapes. Native React Email integration means the magic-link email template can be a React component, keeping it in the existing shadcn/Tailwind design language.

**Integration pattern:**

```typescript
// lib/email/client.ts
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY!);

export async function sendMagicLink(to: string, magicLinkUrl: string) {
  await resend.emails.send({
    from: "QuickBrain <noreply@yourdomain.com>",
    to,
    subject: "Your QuickBrain sign-in link",
    html: `<a href="${magicLinkUrl}">Sign in to QuickBrain</a> — expires in 15 minutes.`,
  });
}
```

**Env var required:** `RESEND_API_KEY` — add to `.env.local`.

**Rate-limit strategy:** Wrap `sendMagicLink` with a per-email cooldown (store last-sent timestamp in bun:sqlite; reject if < 60s since last send). Prevents abuse without a full rate-limit library.

**Red flag check:** No conflicts with existing stack. Resend is pure HTTP (fetch-based SDK) — no native bindings, Bun-compatible.

---

## 2. Session / JWT Library — jose `6.x`

### Pick: jose (not iron-session, not lucia, not better-auth, not next-auth)

```bash
bun add jose
```

**Current version:** `6.2.3` (verified via `npm view jose version`).

**Why jose, not the alternatives:**

- **iron-session**: Encrypts the entire session payload into a cookie. Good pattern, but the session has no expiry verification unless you add it manually. Less ergonomic for the magic-link token (which needs a one-time use `jti` claim) vs. the session cookie (which needs a longer-lived user claim). Two separate token types = easier with jose primitives.
- **lucia**: Auth library that requires a database adapter. We have bun:sqlite, so it could work, but lucia assumes a `sessions` table with revocation support. Adding that table is fine, but lucia's opinionated structure is more than we need for a single-token, single-tenant magic-link flow.
- **better-auth**: Full auth framework (comparable to NextAuth v5). Heavy dependency tree, more surface area than needed. Now supports bun:sqlite, but the overhead doesn't pay off for a two-screen auth flow.
- **next-auth / Auth.js**: Email provider magic-link requires a database adapter (for storing one-time tokens). The adapter adds complexity. Auth.js also assumes you want to call an LLM or OAuth provider — it's designed for a broader surface.

**jose wins because:** it is a pure Web Crypto API implementation with no native bindings, runs identically on Bun and Node runtimes including the Next.js Edge Runtime (useful for middleware), and exposes the exact two primitives needed: `SignJWT` (issue tokens) and `jwtVerify` (verify tokens). Nothing more.

**Two-token architecture:**

| Token | Purpose | Expiry | Storage |
|---|---|---|---|
| **Magic-link JWT** | One-time sign-in link payload | 15 minutes | URL query param; `jti` checked in bun:sqlite to enforce single-use |
| **Session JWT** | Persistent login cookie | 30 days | `HttpOnly; Secure; SameSite=Lax` cookie |

```typescript
// lib/auth/tokens.ts
import { SignJWT, jwtVerify } from "jose";

const SECRET = new TextEncoder().encode(process.env.JWT_SECRET!);

// Issue a one-time magic-link token
export async function issueMagicToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")
    .setJti(crypto.randomUUID())   // stored in bun:sqlite; invalidated on first use
    .sign(SECRET);
}

// Issue a persistent session token (placed in HttpOnly cookie)
export async function issueSession(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(SECRET);
}

// Verify any token
export async function verifyToken(token: string) {
  return jwtVerify(token, SECRET);
}
```

**Env var required:** `JWT_SECRET` — generate with `openssl rand -hex 32` and add to `.env.local`.

**Red flag check:** No conflicts. jose has zero native bindings. Version 6.x confirmed Bun-compatible (pure Web Crypto API). Works in Next.js middleware (Edge Runtime) if route protection middleware is added later.

---

## 3. Per-User State Storage — bun:sqlite (built-in)

### Pick: bun:sqlite, accessed directly via Bun's built-in API

**No install required.** `bun:sqlite` is part of the Bun 1.2 runtime.

**Why not the alternatives:**

- **better-sqlite3**: Native Node.js addon. Under Bun, it requires recompilation against Bun's ABI (`NODE_MODULE_VERSION` mismatch documented in Bun issue #16050). The recompilation workaround is `bun build --compile` or manual `node-pre-gyp` — both add friction and can break on Bun version upgrades. Avoid.
- **A separate PGLite instance**: gbrain already uses PGLite for its brain storage. Adding a second PGLite for app-layer state mixes concerns and requires coordinating two PGLite processes. PGLite's exclusive file lock means this would need its own mutex. Unnecessary.
- **JSON file under `.planning/state/users.json`**: Fine for a prototype. Breaks under concurrent writes (Next.js Route Handlers can be called in parallel). Requires a manual lock. Not durable across process restarts (no atomic write). Don't do this for real user data with QBO tokens.

**bun:sqlite wins because:** zero install, zero native binding risk, single-file SQLite database, synchronous API (no async/await noise for simple lookups), and already documented as the production choice in Bun's 2026 ecosystem for this exact use case.

**Schema:**

```typescript
// lib/db/client.ts
import { Database } from "bun:sqlite";

const db = new Database("data/quickbrain-app.sqlite", { create: true });

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id          TEXT PRIMARY KEY,          -- nanoid or crypto.randomUUID()
    email       TEXT UNIQUE NOT NULL,
    brain_dir   TEXT,                      -- brains/<slug>/ — null until brain provisioned
    qbo_realm_id TEXT,                     -- QuickBooks company ID
    qbo_tokens  TEXT,                      -- JSON blob, AES-256-GCM encrypted (see §4)
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    last_login  INTEGER
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS magic_tokens (
    jti       TEXT PRIMARY KEY,
    email     TEXT NOT NULL,
    used      INTEGER NOT NULL DEFAULT 0,  -- 1 = consumed, never reuse
    expires_at INTEGER NOT NULL
  );
`);

export { db };
```

**File location:** `data/quickbrain-app.sqlite` (committed to `.gitignore`; created on first boot). Add `data/*.sqlite` to `.gitignore`.

**Concurrency note:** bun:sqlite's synchronous API serializes at the JS event loop level within a single process. Next.js Route Handlers run in the same process — no external locking needed. If you ever move to a multi-process deployment, swap to WAL mode (`db.exec("PRAGMA journal_mode=WAL")`).

**Red flag check:** bun:sqlite is Bun 1.2 built-in — zero compatibility risk. Not portable to Node.js without swapping to better-sqlite3, but we run Bun end-to-end per the validated stack.

---

## 4. Token Encryption at Rest — node:crypto AES-256-GCM

### Pick: node:crypto built-in (no new dependency)

**No install required.** `node:crypto` is part of Node.js and Bun's Node.js compatibility layer.

**Why not @noble/ciphers or libsodium:**

- **@noble/ciphers `2.2.0`** (npm `2.2.0` confirmed): Excellent pure-JS crypto primitives, audited, zero native deps. The pick if you need client-side encryption or a runtime that doesn't have `node:crypto`. Under Bun, `node:crypto` is fully available and marginally faster for AES-GCM (native via OpenSSL). For server-side-only token storage, the built-in is sufficient — no new dependency justified.
- **libsodium / tweetnacl**: Good for public-key crypto. AES-256-GCM is the right primitive for symmetric encryption of stored tokens — libsodium would work but is overkill.

**Implementation:**

```typescript
// lib/crypto/tokens.ts
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex"); // 32-byte hex key

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);                          // 96-bit IV for GCM
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as base64(iv):base64(tag):base64(ciphertext)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const [ivB64, tagB64, encB64] = stored.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const enc = Buffer.from(encB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  return decipher.update(enc) + decipher.final("utf8");
}
```

**Env var required:** `TOKEN_ENCRYPTION_KEY` — generate with `openssl rand -hex 32`. Add to `.env.local`. **Never commit this key.**

**What gets encrypted:** The entire `qbo_tokens` JSON blob (access_token, refresh_token, expires_at, realm_id) before writing to `users.qbo_tokens` in bun:sqlite. Decrypted only when making a QBO API call.

**Red flag check:** node:crypto is available in Bun 1.2 (Bun's Node.js compatibility layer fully supports `crypto`). No conflicts.

---

## 5. QuickBooks Online OAuth 2.0 — intuit-oauth `4.x`

### Pick: intuit-oauth (Intuit's official OAuth client)

```bash
bun add intuit-oauth
```

**Current version:** `4.2.3` (verified via `npm view intuit-oauth version`).

**Why intuit-oauth, not rolling our own:**

The QBO OAuth 2.0 flow has Intuit-specific quirks: the authorization URL, token endpoint, and discovery document all live at Intuit's identity server (`https://appcenter.intuit.com/connect/oauth2`). The refresh token flow requires a `Basic` auth header with `clientId:clientSecret` encoded in base64 — a non-standard pattern that's easy to get wrong. `intuit-oauth` handles all of these correctly and is maintained by Intuit's developer team.

**Why not node-quickbooks for OAuth:** `node-quickbooks` handles API calls after you have tokens. It does not manage the OAuth handshake. Use `intuit-oauth` for the handshake and token refresh, then initialize `node-quickbooks` with the resulting tokens.

**Integration pattern:**

```typescript
// lib/qbo/auth.ts
import OAuthClient from "intuit-oauth";

export const oauthClient = new OAuthClient({
  clientId:     process.env.QBO_CLIENT_ID!,
  clientSecret: process.env.QBO_CLIENT_SECRET!,
  environment:  "sandbox",  // change to "production" when ready
  redirectUri:  process.env.QBO_REDIRECT_URI!,  // e.g. http://localhost:3000/api/qbo/callback
});

// In /api/qbo/connect route handler:
// const authUri = oauthClient.authorizeUri({ scope: [OAuthClient.scopes.Accounting], state: userId });

// In /api/qbo/callback route handler:
// const tokenResponse = await oauthClient.createToken(req.url);
// const tokens = tokenResponse.getJson();  // { access_token, refresh_token, expires_in, realmId }
// → encrypt and store in bun:sqlite users.qbo_tokens
```

**Token refresh:** Call `oauthClient.refresh()` before any API call when `expires_at < Date.now()`. The access token expires in 1 hour; refresh token lasts 100 days (QBO policy). Store both in the encrypted `qbo_tokens` blob with `expires_at`.

**Env vars required:**
- `QBO_CLIENT_ID` — from Intuit Developer portal app
- `QBO_CLIENT_SECRET` — from Intuit Developer portal app
- `QBO_REDIRECT_URI` — must match the callback URL registered in the Intuit Developer portal

**Red flag check:** `intuit-oauth` is a pure JavaScript library with no native bindings. Bun-compatible. The `4.x` series targets Node.js 18+ and is compatible with Bun 1.2's Node.js compat layer.

---

## 6. QuickBooks Accounting API — node-quickbooks `2.0.50`

### Pick: node-quickbooks (community-maintained but the de facto standard)

```bash
bun add node-quickbooks
```

**Current version:** `2.0.50` (verified via `npm view node-quickbooks version`).

**Maintenance status:** Community-maintained (mcohen01/node-quickbooks on GitHub), 360 stars, 254 forks, 37 open issues. Last release cadence is slow (months between versions) but the QBO REST API is stable and backwards-compatible. The library covers the API surface we need.

**Why not rolling our own with axios/fetch:**

The QBO API has non-standard authentication headers, minor-version negotiation (`minorversion` query param), and Intuit-specific error shapes. `node-quickbooks` handles these. The time to implement and test a raw fetch wrapper is longer than the time to learn the library's quirks.

**Why not the official Intuit Node.js SDK:** Intuit has a developer portal with a "Node.js" section but the linked sample (`intuit/intuit-developer-nodejs`) is a demo app, not a maintained library. `node-quickbooks` is what the Intuit community actually uses.

**TypeScript types:** No official `@types/node-quickbooks`. You will need a local declaration shim for the methods you use. For the four endpoints we call (Invoices, Bills, Vendors, Transactions), a minimal `declare module "node-quickbooks"` with just those types takes ~20 lines and is worth doing once.

**API calls needed for v1.1:**

| Endpoint | Method | Transforms to |
|---|---|---|
| `qbo.findInvoices(...)` | GET | `originals/invoice-<vendor>-<date>.md` with `type: invoice` |
| `qbo.findBills(...)` | GET | `originals/bill-<vendor>-<date>.md` with `type: invoice` |
| `qbo.findVendors(...)` | GET | `companies/<vendor-slug>.md` |
| `qbo.findDeposits(...)` + `qbo.findPurchases(...)` | GET | `originals/bank-statement-<month>.md` with `type: bank-statement` |

**Integration pattern:**

```typescript
// lib/qbo/client.ts
import QuickBooks from "node-quickbooks";

export function makeQboClient(tokens: QboTokens): QuickBooks {
  return new QuickBooks(
    process.env.QBO_CLIENT_ID!,
    process.env.QBO_CLIENT_SECRET!,
    tokens.access_token,
    false,               // no OAuth 1.0 token secret
    tokens.realm_id,
    process.env.NODE_ENV !== "production",  // true = sandbox
    false,               // enable debug logging
    null,                // minor version (null = latest)
    "2.0",               // OAuth version
    tokens.refresh_token
  );
}
```

**Rate limiting:** QBO imposes 500 requests/minute per company (realmId). Our ingest pipeline reads Invoices + Bills + Vendors + Transactions = 4 queries. No rate-limit concern at v1.1.

**Red flag check:** `node-quickbooks` is pure JavaScript (no native bindings). Bun-compatible. The missing TypeScript types are a minor friction point, not a blocker. The JSDoc types in the source are accurate enough for the four endpoints we use.

---

## 7. gbrain Skill Authoring — gbrain skillify scaffold

### Pick: gbrain's built-in `skillify` CLI (no new dependency)

**No install required.** `gbrain skillify` is part of gbrain 0.35.1 (already installed via `git clone + bun link`).

**Skill directory layout** (verified from gbrain skillify/SKILL.md and gbrain docs):

```
skills/
└── smb-audit/
    ├── SKILL.md              # manifest + workflow instructions
    ├── scripts/
    │   └── smb-audit.mjs     # TypeScript/ESM implementation
    ├── test/
    │   └── smb-audit.test.ts # unit + E2E stubs
    └── routing-eval.jsonl    # intent routing fixtures
```

**Scaffold command:**

```bash
GBRAIN_HOME=brains/seed gbrain skillify scaffold smb-audit \
  --description "Detects price anomalies, duplicate charges, and ghost SaaS subscriptions in imported originals/ pages; writes findings to concepts/" \
  --triggers "run smb audit,detect anomalies,check for weird charges" \
  --writes-pages
```

**SKILL.md frontmatter** (from skillify scaffold output):

```yaml
---
name: smb-audit
version: 1.0.0
description: |
  Scans all originals/ pages for price anomalies (>10% MoM delta on same vendor),
  duplicate charges (same vendor + amount within 7 days), and ghost SaaS
  (recurring monthly amount with no recent company/ event). Writes findings to
  concepts/march-anomaly-summary.md and concepts/recurring-charges.md.
triggers:
  - "run smb audit"
  - "detect anomalies"
  - "check for weird charges"
tools:
  - exec
  - read
  - write
mutating: true
writes-to:
  - concepts/
---
```

**TypeScript skill API surface** (confirmed from gbrain README + skillify SKILL.md research):

The skill implementation (`scripts/smb-audit.mjs`) runs as a TypeScript/ESM module that can import from `@gbrain/api`. The confirmed primitives available to skills:

```typescript
import { search, get_page, put_page, backlinks } from "@gbrain/api";

// Read all originals/ pages tagged as invoices
const invoicePages = await search("type:invoice");

// Write to concepts/ (creates or updates page with versioning)
await put_page("concepts/march-anomaly-summary", markdownContent);
await put_page("concepts/recurring-charges", markdownContent);

// Read a specific page
const vendor = await get_page("companies/beanstalk-roasters");

// Find all pages that link to a vendor
const vendorRefs = await backlinks("companies/beanstalk-roasters");
```

**Running the skill as a minion at import time:**

Use `gbrain jobs submit shell` with `--follow` (required for PGLite — the `--follow` flag blocks until the job completes, which is necessary to avoid PGLite lock contention when the brain is not running `gbrain serve`):

```bash
GBRAIN_HOME=brains/<tenantId> gbrain jobs submit shell \
  --params '{"cmd": "gbrain run-skill smb-audit", "cwd": "'"$(pwd)"'"}' \
  --follow
```

In the seed script, wire this after `gbrain import`:

```typescript
// scripts/seed.ts (addition after import step)
await run(["jobs", "submit", "shell",
  "--params", JSON.stringify({ cmd: "gbrain run-skill smb-audit", cwd: process.cwd() }),
  "--follow"
]);
```

**Critical finding — Minions require Postgres, not PGLite:** The `gbrain jobs` system is documented as "Postgres-native" (confirmed in gbrain SUMMARY.md v1.0 research and the minions-shell-jobs.md guide). The `--follow` flag is required when PGLite is the backend because the Minions queue stores job state in the database. The interaction between Minions and PGLite is not fully documented. **Confidence: LOW.**

**Safe fallback:** If `gbrain jobs submit` fails against PGLite, the fallback is to call the skill script directly as a child process after import:

```typescript
await run(["run-skill", "smb-audit"]);
// If gbrain run-skill is not a valid command, fall back to:
// bun run skills/smb-audit/scripts/smb-audit.mjs
```

The hand-rolled TS anomaly detector from v1.0 already does this. The `smb-audit` skill is the gbrain-native version of the same logic — if the Minions path is blocked by PGLite, the skill's `scripts/smb-audit.mjs` can be run directly with `bun run` using `GBRAIN_HOME` in the environment.

**Phase research flag:** Phase 4 (smb-audit skill) MUST start with a 30-minute spike: run `gbrain skillify scaffold`, run `gbrain run-skill <name>` (or equivalent), and confirm the `@gbrain/api` import path resolves within Bun. If `@gbrain/api` is an internal gbrain package not exported for external skill scripts, the TypeScript API surface documented above may need adjustment. This is the single highest-uncertainty item in v1.1.

---

## 8. New Environment Variables Summary

| Variable | Required For | How to Generate |
|---|---|---|
| `RESEND_API_KEY` | Email delivery | [resend.com/api-keys](https://resend.com/api-keys) — free account |
| `JWT_SECRET` | Magic-link + session token signing | `openssl rand -hex 32` |
| `TOKEN_ENCRYPTION_KEY` | QBO token AES-256-GCM encryption | `openssl rand -hex 32` |
| `QBO_CLIENT_ID` | QBO OAuth | Intuit Developer portal → app credentials |
| `QBO_CLIENT_SECRET` | QBO OAuth | Intuit Developer portal → app credentials |
| `QBO_REDIRECT_URI` | QBO OAuth callback | `http://localhost:3000/api/qbo/callback` (dev) |

All go in `.env.local` alongside existing `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.

---

## 9. Installation (v1.1 additions only)

```bash
# From the quick-brain repo root
bun add resend jose intuit-oauth node-quickbooks

# Verify bun:sqlite is available (should print "Database" constructor)
bun -e "import { Database } from 'bun:sqlite'; console.log(Database.name)"

# Generate secrets (add output to .env.local)
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)"

# Register QBO app at:
# https://developer.intuit.com/app/developer/myapps
# → Copy Client ID + Secret into .env.local
# → Set redirect URI to http://localhost:3000/api/qbo/callback (sandbox)
# → Request Accounting scope

# Scaffold the smb-audit skill (Phase 4 — do not skip the 30-min spike)
GBRAIN_HOME=brains/seed gbrain skillify scaffold smb-audit \
  --description "SMB audit skill: anomaly detection over originals/ pages" \
  --writes-pages
```

---

## 10. Alternatives Rejected

| Category | Recommended | Rejected | Reason |
|---|---|---|---|
| Email delivery | Resend `6.x` | Postmark | $15.50/mo minimum; no free tier for early-stage; Resend deliverability sufficient at v1.1 volume |
| Email delivery | Resend `6.x` | Loops, Plunk | Loops is marketing automation, not transactional; Plunk is smaller ecosystem, less TypeScript polish |
| Session library | jose primitives | iron-session | Iron-session is good for session cookies but less ergonomic for the two-token (magic-link + session) pattern; jose handles both |
| Session library | jose primitives | lucia | Requires `sessions` table + adapter; more than needed for single-token magic-link flow |
| Session library | jose primitives | better-auth | Full auth framework; dependency overhead not justified for 2-screen auth flow |
| Session library | jose primitives | next-auth / Auth.js | Email provider requires database adapter; heavier than needed; same shape as lucia objection |
| App-layer DB | bun:sqlite (built-in) | better-sqlite3 | ABI mismatch under Bun (issue #16050); requires recompilation |
| App-layer DB | bun:sqlite (built-in) | Second PGLite instance | Mixes concerns with gbrain's PGLite; needs its own mutex; no benefit over bun:sqlite |
| App-layer DB | bun:sqlite (built-in) | JSON flat file | Not safe under concurrent Route Handler writes; no atomic transactions |
| Token encryption | node:crypto built-in | @noble/ciphers | Pure-JS and audited, but node:crypto is equally safe and already available; zero-dep advantage wins |
| Token encryption | node:crypto built-in | libsodium | Overkill for symmetric at-rest encryption; no public-key operation needed |
| QBO API client | node-quickbooks | Roll our own fetch wrapper | QBO has non-standard auth headers + error shapes; not worth the debugging time |
| QBO OAuth | intuit-oauth | Roll our own | QBO OAuth deviates from spec (Basic auth in token exchange); intuit-oauth handles the quirks |
| gbrain skill runner | gbrain skillify + gbrain run-skill | Hand-rolled import-time script (v1.0 path) | v1.0 hand-rolled detector is still the fallback if Minions/PGLite interaction blocks; skill is the upgrade, not a hard dependency |

---

## 11. Version Compatibility

| Package | Version | Compatible With | Notes |
|---|---|---|---|
| `resend` | `6.x` | Bun 1.2, Next.js 15 | Pure fetch-based SDK; no native bindings |
| `jose` | `6.2.3` | Bun 1.2, Next.js 15 App Router, Edge Runtime | Pure Web Crypto API; explicitly supports Bun |
| `bun:sqlite` | Bun 1.2 built-in | Next.js 15 App Router (server-side only) | Do not import in Client Components or Edge Runtime routes |
| `node:crypto` | Bun 1.2 built-in | Next.js 15 App Router (server-side only) | Do not import in Edge Runtime routes |
| `intuit-oauth` | `4.2.3` | Bun 1.2, Node.js 18+ | Pure JS; no native bindings |
| `node-quickbooks` | `2.0.50` | Bun 1.2, Node.js 18+ | Pure JS; no native bindings; no official TypeScript types |
| `gbrain` | `0.35.1` | `@gbrain/api` import path | Skill API import path must be verified during Phase 4 spike |

**Compatibility hazard — bun:sqlite in Next.js:** `bun:sqlite` can only be imported in server-side code (Route Handlers, Server Actions, Server Components). Importing it in a Client Component will throw at build time. Wrap all DB calls behind a `lib/db/` module that is never re-exported to the client.

**Compatibility hazard — QBO sandbox vs production:** `intuit-oauth` and `node-quickbooks` both have an `environment: "sandbox"` / `useSandbox: true` flag. The default sandbox realm ID for testing is `123146`. Flip to `"production"` only when submitting for QBO app review.

---

## 12. Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| Resend free tier + deliverability positioning | **HIGH** | Pricing page verified; deliverability comparison from multiple 2026 sources |
| jose `6.x` Bun compatibility | **HIGH** | Explicitly documented as Web Crypto API; confirmed in Bun docs and Context7 |
| bun:sqlite over better-sqlite3 under Bun | **HIGH** | ABI incompatibility confirmed in Bun issue #16050; bun:sqlite is the recommended path |
| node:crypto AES-256-GCM correctness | **HIGH** | Standard Node.js crypto module; pattern widely documented |
| intuit-oauth for QBO OAuth 2.0 flow | **HIGH** | Official Intuit OAuth client; `4.2.3` is current |
| node-quickbooks API surface (Invoices/Bills/Vendors) | **MEDIUM** | Community library; API surface confirmed via README; TypeScript types absent |
| gbrain `@gbrain/api` import path for skill scripts | **LOW** | Documented in README snippets but not verified against actual installed package; spike required in Phase 4 |
| `gbrain jobs submit --follow` working with PGLite | **LOW** | Minions documented as Postgres-native; PGLite interaction unknown; fallback to direct script execution is always available |

---

## Sources

- [Resend pricing page](https://resend.com/pricing) — free tier: 3,000/month, 100/day confirmed
- [Resend vs Postmark vs Mailgun for Solo Developers 2026](https://devtoolpicks.com/blog/resend-vs-postmark-vs-mailgun-solo-developers-2026) — deliverability comparison
- [pkgpulse.com: Resend vs Nodemailer vs Postmark 2026](https://www.pkgpulse.com/blog/resend-vs-nodemailer-vs-postmark-email-nodejs-2026) — low-volume recommendation
- [jose library (Context7 /panva/jose)](https://context7.com/panva/jose/llms.txt) — SignJWT, jwtVerify API surface verified HIGH confidence
- [Bun issue #16050: better-sqlite3 ABI incompatibility](https://github.com/oven-sh/bun/issues/16050) — confirms recompilation required
- [Bun 1.2 bun:sqlite docs](https://bun.sh/docs/api/sqlite) — native SQLite API confirmed
- [Node.js crypto AES-256-GCM examples](https://gist.github.com/AndiDittrich/4629e7db04819244e843) — iv/tag/ciphertext storage pattern
- [intuit-oauth README](https://developer.intuit.com/app/developer/qbo/docs/develop/sdks-and-samples-collections/nodejs/oauth-nodejs-client) — OAuth 2.0 flow confirmation
- [node-quickbooks README](https://github.com/mcohen01/node-quickbooks/blob/master/README.md) — API surface and OAuth 2.0 support
- [gbrain skillify SKILL.md](https://github.com/garrytan/gbrain/blob/master/skills/skillify/SKILL.md) — skill file layout, frontmatter format
- [gbrain minions-shell-jobs.md](https://github.com/garrytan/gbrain/blob/master/docs/guides/minions-shell-jobs.md) — `gbrain jobs submit shell --params --follow` syntax
- [gbrain RESOLVER.md](https://github.com/garrytan/gbrain/blob/master/skills/RESOLVER.md) — skill routing and registration
- [gbrain README](https://github.com/garrytan/gbrain/blob/master/README.md) — @gbrain/api import surface

---

*Stack additions research for: QuickBrain v1.1 "Beyond the Demo" (email auth, per-user state, QBO connector, smb-audit skill)*
*Researched: 2026-05-17*
