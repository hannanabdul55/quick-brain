# Feature Research — v1.1 "Beyond the Demo"

**Domain:** SMB ops / accounting copilot — QuickBrain v1.1 new pillars only
**Researched:** 2026-05-17
**Confidence:** HIGH on skill authoring mechanics and QBO API surface. MEDIUM on auth library PGLite fit (no confirmed PGLite adapter for better-auth). MEDIUM on QBO "bank statement" entity mapping (bank feed raw transactions are NOT queryable via Accounting API; a substitute approach is needed).

---

> **Scope note:** This document covers only the three new v1.1 capabilities:
> A. Custom `smb-audit` gbrain skill
> B. Email magic-link auth
> C. QuickBooks Online ingest
>
> Everything shipped in v1.0 (onboarding flow, chat surface, insight cards, seed data, reset) is captured in `.planning/research/v1.0-archive/FEATURES.md` and is not re-researched here.

---

## Pillar A — Custom `smb-audit` gbrain Skill

### Context

The v1.0 `lib/insights/anomalies.ts` file reads `concepts/march-anomaly-summary.md` (a hand-written markdown page committed to the seed). Detection logic is in `scripts/seed.ts` (or equivalent), not inside gbrain itself. The v1.1 goal is to move that logic into a real gbrain skill so the brain, not the Next.js app, owns the analysis.

gbrain's skill system uses a **markdown + TypeScript dual-document pattern** (`SKILL.md` manifest + `scripts/<name>.mjs` deterministic logic). Skills are scaffolded with `gbrain skillify scaffold <name>` and registered in `skills/RESOLVER.md`. The system validates registration with `gbrain check-resolvable`. Skills that write brain pages require a `brain/RESOLVER.md` entry. The minion-orchestrator skill handles background execution via `gbrain jobs submit`.

### Table Stakes

Features that must exist for the skill to be functionally equivalent to the current hand-rolled detector.

| Feature | Why Required | Complexity | v1.0 Dependency | Notes |
|---------|--------------|------------|-----------------|-------|
| `SKILL.md` manifest with correct frontmatter (`type`, `title`, `tags`, `triggers`, `tools`, `mutating: true`) | gbrain's resolver cannot route to the skill without a valid manifest | S | None — new file | Triggers should be import-event-shaped, not chat-query-shaped (e.g., "run anomaly audit", "audit imported data") |
| `scripts/smb-audit.mjs` implementing all 3 existing detection rules | Port of `lib/insights/anomalies.ts` logic: price-hike rule (>15% MoM vendor delta), duplicate-charge rule (same vendor + amount within 14 days), ghost-SaaS rule (recurring debit, last vendor-event >90 days) | M | `lib/insights/anomalies.ts` — same logic, different container | Reads `originals/*.md` frontmatter + `companies/*.md` event timestamps. Writes `concepts/march-anomaly-summary.md` and `concepts/recurring-charges.md` using `gbrain put <slug>`. |
| Idempotent writes — re-running the skill produces identical output | Insight card and `gbrain query` depend on deterministic page content | S | `INSI-04`, `INSI-06` (cache relies on stable content) | Use content-hash check before writing; gbrain's `put` is auto-versioning so duplicate writes create new timeline entries but same compiled-truth section |
| Skill registered in `skills/RESOLVER.md` and passes `gbrain check-resolvable` | Required for the skill to be callable via `gbrain jobs submit smb-audit` | S | None | One resolver entry maps "run anomaly audit" → `skills/smb-audit/SKILL.md` |
| `scripts/seed.ts` updated: replace direct `anomalies.ts` invocation with `gbrain jobs submit smb-audit --follow` | Without this, the skill exists but nothing calls it during seed build | S | `DATA-08`, `DATA-09` (seed pipeline) | `--follow` streams job output to SSE progress during onboarding; equivalent to current stdout streaming |
| `lib/insights/anomalies.ts` continues to read `concepts/march-anomaly-summary.md` unchanged | Insight card parsing is already wired to this file; the skill's job is to write it, not change the reading side | S (zero change) | `INSI-04` | No changes needed on the reading side — the skill replaces the writer only |

**Table-stakes complexity total: M (approximately 4–6 hours including testing)**

The dominant cost is porting the 3 detection rules to a gbrain-idiomatic mjs script and wiring the seed pipeline to call `gbrain jobs submit smb-audit` instead of the inline TS function. The skill manifest itself is quick (< 30 min).

### Differentiators (pick at most 2 for v1.1)

| Feature | Value Proposition | Complexity | Recommendation | Notes |
|---------|-------------------|------------|----------------|-------|
| Dollar-impact computation per anomaly | Quantifies the financial cost of each finding (e.g., "+$330 overspend on Beanstalk this month") — the v1.0 `extractDollarImpact()` function does this already but as a post-parse step in the Next.js app | S (refactor only — logic already exists in `anomalies.ts`) | **Ship in v1.1** — trivially ports alongside the other logic | Move dollar-impact calculation into the skill so the emitted page has `dollar_impact: 330.00` in frontmatter; removes parsing fragility from the Next.js layer |
| Structured frontmatter on emitted concept pages (`severity`, `dollar_impact`, `anomaly_type`, `vendor_slug`) | Allows insight cards to render severity badges and filter by type without re-parsing prose; opens path to INSI-08 (v1.0 stretch) | S | **Ship in v1.1** — same file, just richer frontmatter | Extend the existing YAML front-matter with `severity: critical/warning/info`, `dollar_impact: N`, `anomaly_type: price-hike/duplicate/ghost-saas/missing-invoice`, `vendor_slug: beanstalk-roasters`. The existing `computeAnomalies()` parser in `anomalies.ts` would then read frontmatter instead of parsing prose |
| 4th anomaly type: missing-invoice (DATA-12 from v1.0 stretch) | Detects bank-statement debits with no matching `originals/invoice-*.md` in the brain — the planted "ABCD Plumbing $340" anomaly becomes detectable | M (requires adding the planted anomaly to `data/maras-coffee` AND implementing the join rule) | **Ship in v1.1** — DATA-12 was explicitly named as a v1.1 target | Rule: for each `originals/bank-statement-*.md` line item, check whether a `originals/invoice-*.md` with matching vendor + amount ± 5% + date ± 14 days exists. Write a 4th bullet to the anomaly summary if not found. |
| Severity tiers with configurable thresholds | Allows operators to tune what counts as "critical" (e.g., price hike threshold 15% vs 20%) without touching code | M (adds config file + runtime read) | Defer to v1.2 — thresholds hardcoded in the mjs script are fine for v1.1; configurability adds complexity without demo payoff | |
| Cross-modal eval receipt (gbrain skillify 10-item checklist) | Prize narrative: "we ran the full gbrain skillify flow including LLM evals" | M (requires gbrain cross-modal eval setup) | Defer — the full eval chain is impressive but not load-bearing for the demo. Unit tests suffice for v1.1 | |

**Recommended for v1.1: dollar-impact computation + structured frontmatter (both S, ship together) + 4th anomaly type (M, ship if DATA-12 dataset work is done).**

### Anti-Features

| Feature | Why Avoid | What to Do Instead |
|---------|-----------|-------------------|
| ML-based detection | Training, threshold-tuning, and non-deterministic output all conflict with demo reproducibility | Rule-based detection: price-hike = MoM delta > threshold; duplicate = same vendor+amount within window; ghost = recurrence count > N with last event > 90 days |
| Per-line-item POS analysis (individual drink sales) | POS daily summaries in `media/` are sufficient for P&L; per-drink itemization inflates data 100x and has no demo payoff | Daily POS summary totals are the right grain |
| Real-time alerting on new transactions | Requires a long-running process and is incompatible with the one-shot CLI integration pattern | One-shot at import time via `gbrain jobs submit smb-audit` |
| Using `gbrain serve --http` + MCP for skill invocation | Requires OAuth 2.1 setup; the skill runs deterministically and needs no LLM round-trip | `gbrain jobs submit smb-audit --follow` via the existing `spawnGBrain` harness |
| Deleting `lib/insights/anomalies.ts` immediately | It still reads the skill-emitted page; it's the parser, not the detector | Keep `anomalies.ts` as the reading side; remove only the detection logic that moves into the skill |

### Dependencies on v1.0 Surfaces

| v1.0 Surface | How v1.1 Skill Touches It | Change Required |
|---|---|---|
| `lib/insights/anomalies.ts` | Continues to read `concepts/march-anomaly-summary.md` as before; frontmatter fields expand | Add frontmatter field reads for `severity`, `dollar_impact`, `anomaly_type` — non-breaking if new fields are optional |
| `scripts/seed.ts` (seed pipeline) | Currently calls the TS anomaly detector inline; must be updated to call `gbrain jobs submit smb-audit --follow` instead | Replace one function call; SSE streaming continues via `onStdoutLine` callback on the `spawnGBrain` call |
| `app/api/tenants/[id]/onboard/route.ts` | SSE progress stream already passes through `spawnGBrain` output; no change needed if seed script emits progress via stdout | Verify that `gbrain jobs submit --follow` streams job output to stdout (HIGH confidence it does based on gbrain docs) |
| `INSI-04` (anomaly card) | Currently renders `rows[].dollarImpact` extracted by prose regex; upgrade to read from frontmatter | Update `computeAnomalies()` to prefer `dollar_impact` frontmatter field over regex extraction |
| `data/maras-coffee/` (seed dataset) | DATA-12 requires adding one new bank-statement line item for "ABCD Plumbing $340" and confirming no matching invoice exists | Additive change to seed data — no existing test should break |

---

## Pillar B — Email Magic-Link Auth

### Context

v1.0 has no auth at all — tenants are ephemeral session IDs. v1.1 needs a stable user identity to (a) attach QBO OAuth tokens to a user, and (b) let a signed-in user return to their brain across sessions. The auth must survive Next.js server restarts, which means the verification token and session must be stored somewhere persistent.

The project already uses PGLite (owned by gbrain) for brain storage. The decision from PROJECT.md is to continue using PGLite for app-layer user/tenant state rather than spinning up a second database. **Critical research finding:** better-auth supports SQLite via Bun's built-in SQLite module and does not require a separate DB server. A dedicated `auth.db` file (PGLite or Bun SQLite) alongside the brain dirs is the correct pattern.

**Recommended auth library: better-auth** (not Auth.js / NextAuth). Rationale:
- better-auth has a first-class magic link plugin with atomic single-use token enforcement (tokens consumed on first use; retries fail with `INVALID_TOKEN`)
- Token expiry is configurable: `expiresIn` in seconds (default 300s = 5 min; set to 900s = 15 min for v1.1)
- Works with Bun's built-in SQLite — no separate DB server
- Does NOT require Prisma or Drizzle (can use a raw SQLite/kysely adapter)
- Auth.js v5 is viable but requires a database adapter and its magic link token expiry defaults to 24 hours (too long for v1.1 security requirements)

**Recommended email service: Resend** (not Postmark, not Nodemailer). Rationale:
- Free tier: 3,000 emails/month, 100/day — more than enough for a v1.1 pilot
- Simple HTTP API (`POST /emails`) — no SMTP config, no DNS headaches
- First-class Next.js + Bun support
- Same vendor used in the rest of the shadcn/ui ecosystem (Resend is the default example in shadcn form demos)

### Table Stakes

| Feature | Why Required | Complexity | v1.0 Dependency | Notes |
|---------|--------------|------------|-----------------|-------|
| Sign-in page (`/auth/sign-in`) with email input form | Entry point to the auth flow; replaces the current anonymous onboarding in v1.1 | S | `app/onboard/page.tsx` — sign-in must come before or alongside onboarding | Single field (email), shadcn `Input` + `Button`; "Enter your email to sign in" |
| "Check your email" interstitial screen | Without this, users don't know a link was sent — UX dead-end | S | None | Static page at `/auth/verify-email`; shows "We sent a link to [email]" with a "Resend" button (rate-limited) |
| Magic-link generation + Resend email send | Core mechanism: create a HMAC-signed token, store in DB with expiry, send via Resend | M | None — new `app/api/auth/[...betterauth]/route.ts` | Use better-auth's magic link plugin; `expiresIn: 900` (15 min); template the email with QuickBrain brand |
| Click handler that verifies token, creates session, redirects to brain | Must validate token hasn't expired, hasn't been used, and matches stored hash; then create a DB session | M | None | better-auth handles token verification atomically; the route handler redirects to `/dash/[tenantId]` on success (or `/onboard` if the user has no brain yet) |
| Sign-out | Session destruction + redirect to `/auth/sign-in` | S | `/app/dash/[id]/page.tsx` — add sign-out button to dashboard | One API call to better-auth's sign-out endpoint; clear session cookie |
| Session persistence across server restarts | Sessions stored in `auth.db` (Bun SQLite file), not in-memory | S | `lib/gbrain/tenants.ts` — the in-memory tenant registry is separate from auth sessions; both can coexist | `auth.db` lives at `./auth.db` alongside `./brains/`; Bun SQLite file is durable across restarts |
| User–tenant linkage: a user ID maps to exactly one tenant ID (one brain) | Required for "return to your brain" flow | S | `lib/gbrain/tenants.ts` — add `userId` field to `TenantRecord` | On onboarding completion, store `{ userId, tenantId }` in `auth.db` (a `user_tenants` join table); on sign-in, look up this mapping and redirect |

**Table-stakes complexity total: M (approximately 4–6 hours including DB setup and email template)**

### Differentiators (pick at most 2 for v1.1)

| Feature | Value Proposition | Complexity | Recommendation | Notes |
|---------|-------------------|------------|----------------|-------|
| Rate limiting: 1 link per 60 seconds per email | Prevents spam and Resend quota abuse; expected by any non-trivial auth system | S (middleware + DB timestamp check) | **Ship in v1.1** — check `lastSentAt` in DB; return 429 with "Wait 60 seconds before requesting another link" if within window | better-auth does not have built-in rate limiting; implement as a thin middleware layer on the send endpoint |
| Link expiry at 15 min with friendly "link expired" error state | Security hygiene; prevents link-in-inbox reuse attacks | S (already in better-auth `expiresIn` config) | **Ship in v1.1** — trivially configured; the friendly error state is one shadcn `Alert` component on the redirect destination | On expired token click: redirect to `/auth/sign-in?error=expired` and render an "This link has expired — request a new one" banner |
| Single-use enforcement with "already used" error state | Prevents replay attacks | S (built into better-auth — atomic token consumption) | **Ship in v1.1** — zero extra work; just handle `INVALID_TOKEN` error response with a "This link has already been used" message | |
| Branded email HTML (QuickBrain logo, consistent typography) | Trust signal; prevents link from looking like phishing | S (one React email template or HTML string) | **Ship in v1.1** — Resend supports HTML emails; a minimal template (logo, greeting, CTA button, footer) takes < 1 hour | Use `@react-email/components` or a plain HTML string |
| "Resend link" button on the check-your-email screen | Reduces friction when email is slow | S | **Ship in v1.1** — one extra API call, rate-limited by the same 1/60s rule | |

**Recommended for v1.1: rate limiting (S) + link expiry + single-use + branded email (all S, bundle together).**
Effectively all four recommended differentiators are small and should be shipped as part of the table-stakes M work — they add < 1 hour total.

### Anti-Features

| Feature | Why Avoid | What to Do Instead |
|---------|-----------|-------------------|
| Passwords | Compliance burden (hashing, reset flow, brute-force protection); directly contradicts the project decision to use magic links | Magic link only |
| Social SSO (Google/Apple/GitHub OAuth) | Each adds its own OAuth client setup, redirect handling, and edge cases; 1-2h per provider with zero additional demo payoff | Magic link covers all email addresses; no social needed for v1.1 |
| 2FA / TOTP / SMS | Out of scope — adds complexity without any security narrative for an SMB tool | Skip entirely |
| Account deletion UI | User-facing delete flow requires data retention decisions; ship in v1.2 when real users exist | Admin-only `scripts/delete-user.ts` is sufficient for v1.1 |
| Email verification beyond the magic link itself | The magic link IS the email verification; asking for a separate verification step is redundant | The act of clicking the link proves email ownership |
| NextAuth / Auth.js instead of better-auth | Auth.js magic link token defaults to 24h (wrong for security), requires a db adapter that doesn't cleanly support Bun SQLite without workarounds, and Edge Runtime has Node.js module conflicts (dns module issue in Next.js App Router, documented in nextauthjs/next-auth#12979) | better-auth with Bun SQLite adapter |

### Dependencies on v1.0 Surfaces

| v1.0 Surface | How v1.1 Auth Touches It | Change Required |
|---|---|---|
| `/onboard/page.tsx` + `/api/tenants/route.ts` | Currently anonymous; must now check session and attach the new tenant to the authenticated user | Gate the POST `/api/tenants` route behind session middleware; on success, write `{ userId, tenantId }` to `auth.db` |
| `/dash/[id]/page.tsx` | Add sign-out button; protect route (unauthenticated access redirects to sign-in) | Add `getSession()` check in the Server Component; render `<SignOutButton>` in the dashboard header |
| `lib/gbrain/tenants.ts` | `TenantRecord` needs a `userId?: string` field | Additive change — no breaking change to existing in-memory registry |
| `/` (landing page) | CTA currently routes to `/onboard`; in v1.1 it should route to sign-in first | Change the CTA href; signed-in users who already have a brain skip onboarding and go directly to `/dash/[id]` |
| `scripts/panic-reset.sh` | Must also clear `auth.db` or at minimum the `user_tenants` table when resetting demo state | Add `rm -f auth.db` or a targeted SQL DELETE to the reset script |

---

## Pillar C — QuickBooks Online Ingest

### Context

**Critical research finding — bank transactions:** The QBO Accounting API does NOT expose raw bank feed transactions (the "For Review" tab in QBO). Bank statement-style debits are stored as `Purchase` entities (credit card purchases, check payments) and `Deposit` entities, not as a `BankTransaction` entity. Unreviewed/uncategorized bank feed lines are not accessible via API at all. To reconstruct a "bank statement," you must query: `Invoice` (A/R), `Bill` (A/P), `Purchase` (expenses/payments), `Deposit` (income deposits), and `Vendor` (master data).

**Rate limits (2025/2026):** 500 req/min per realm; 10 concurrent per app. Access tokens expire after 60 min; refresh tokens expire after ~100 days (Intuit extended to 5-year maximum validity as of November 2025, but the value rotates every 24–26 hours — you must persist the newest value on each refresh cycle). Free tier (Intuit App Partner Program, live July 28 2025): 500,000 CorePlus credits/month; reads are metered (writes are free).

**Scope:** `com.intuit.quickbooks.accounting` is the single scope needed for all Accounting API entities.

**Incremental sync:** Use the CDC (Change Data Capture) endpoint: `GET /v3/company/{realmId}/cdc?entities=Invoice,Bill,Purchase,Vendor&changedSince=<ISO8601>` — lookback window up to 30 days.

**Multi-realm:** Each QBO company is identified by a `realmId`. A user may have multiple QBO companies. The token set is per-realm, not per-user.

**Recommended QBO client library:** `node-quickbooks` (npm) or `intuit-oauth` for the OAuth dance, plus raw `fetch` for API calls. The official Intuit JS SDK exists but is underspecified; raw fetch with the scope + bearer token is simpler.

### Table Stakes

| Feature | Why Required | Complexity | v1.0 Dependency | Notes |
|---------|--------------|------------|-----------------|-------|
| "Connect QuickBooks" button on dashboard (or onboarding flow) | Entry point for live data; without it there is no QBO feature | S | `/dash/[id]/page.tsx` or `/onboard/page.tsx` — the button can live in either place; onboarding is cleaner | Show the button only after sign-in; render "Connected: [company name]" after successful OAuth |
| OAuth redirect flow: `/api/qbo/connect` → Intuit auth page → `/api/qbo/callback` | The OAuth authorization code exchange is mandatory; scope = `com.intuit.quickbooks.accounting openid email profile` | M | Auth pillar (B) — requires a user session to attach the token to | Store `{ userId, realmId, accessToken, refreshToken, expiresAt }` in `auth.db` after token exchange |
| Encrypted token storage | Storing raw OAuth tokens on disk is a security risk even for a local app | S | `auth.db` (Pillar B) | AES-256-GCM with a key derived from `QUICKBOOKS_ENCRYPTION_KEY` env var; encrypt `accessToken` and `refreshToken` at rest |
| Initial sync of 12 months: `Invoice + Bill + Purchase + Vendor` | These 4 entity types cover: A/R invoices, A/P bills, expense purchases (bank statement equivalent), and vendor master data | L (the transformer + import pipeline is the main effort) | `data/maras-coffee/` schema — output markdown must match the existing seed schema (`type: invoice`, `vendor`, `amount`, `date` frontmatter) | Query in order: Vendor first (to build a slug → DisplayName map), then Bill + Purchase (AP/expenses), then Invoice (AR). Paginate at 100 records per query. |
| QBO → markdown transformer matching seed schema | The markdown output must be importable via `gbrain import` and queryable by the existing insight card parsers | L (transformer is the most complex piece) | `data/maras-coffee/originals/*.md` schema — frontmatter fields: `type`, `vendor`, `amount`, `date`, `description`. Company pages: `data/maras-coffee/companies/*.md` | One transformer function per entity type; emit to `brains/<tenantId>/originals/` and `brains/<tenantId>/companies/` |
| `gbrain import` after transformer writes files | Triggers gbrain's ingest + embed + enrich pipeline so the brain becomes queryable | S (reuses existing `spawnGBrain` harness) | `HARN-03` (`spawnGBrain`), `HARN-04` (mutex), `lib/gbrain/onboard.ts` | Call `gbrain import brains/<tenantId>/` after transformer completes; stream progress via SSE |
| Success state shown in chat / dashboard | User must see confirmation that their data is loaded | S | `/dash/[id]/page.tsx` — update connection status banner | "Your QuickBooks data is synced — [N] transactions imported" |
| Demo seed fallback: "Use demo data instead" path remains intact | Users without QBO can still use QuickBrain; demo mode is required for the hackathon narrative | S (zero change to seed path) | Entire v1.0 onboarding flow — keep as-is | The onboarding choice screen adds one radio: "Connect QuickBooks" vs "Try with sample data" |

**Table-stakes complexity total: L (approximately 10–14 hours — the transformer is the dominant cost)**

### Differentiators (pick at most 1–2 for v1.1)

| Feature | Value Proposition | Complexity | Recommendation | Notes |
|---------|-------------------|------------|----------------|-------|
| Incremental sync via CDC (delta-based, not full re-sync) | Full re-sync on each connect is slow (12 months × 4 entities × pagination); CDC fetches only changes since last sync | M | **Ship in v1.1** — CDC endpoint is straightforward; store `lastSyncedAt` per realm in `auth.db`; call CDC instead of full query on subsequent syncs | `GET /v3/company/{realmId}/cdc?entities=Invoice,Bill,Purchase,Vendor&changedSince={lastSyncedAt}` — lookback max 30 days |
| Multi-realm picker: if user has multiple QBO companies, show a picker | A user who owns two businesses shouldn't have to create two QuickBrain accounts | M | Defer to v1.2 — adds UI complexity and a second OAuth token set; handle first by building single-realm support cleanly | Store realmId per user; if multiple realms are detected after OAuth, show a radio picker before token storage |
| "Disconnect QuickBooks" button | Data ownership story; allows the user to revoke QuickBrain's access and clear synced data | S | **Ship in v1.1** — one button + one API call that clears tokens from `auth.db` and optionally wipes the tenant brain dir | Call Intuit's token revocation endpoint + delete `auth.db` token row |
| Background refresh on a schedule | Keeps the brain current without manual re-sync | M | Defer to v1.2 — requires a cron job or `gbrain cron-scheduler` wiring; adds background process complexity | In v1.1, sync is triggered manually via a "Sync now" button |
| QBO error state UX (expired token, revoked access, rate limit hit) | Production-quality error handling avoids silent stale data | S | **Ship in v1.1** — implement a token refresh helper that catches 401s and re-exchanges the refresh token; surface user-facing error for "QuickBooks disconnected, please reconnect" | Refresh token rotation means you must persist the new refresh token on every successful refresh or the next refresh will fail with `invalid_grant` |

**Recommended for v1.1: incremental sync (M) + disconnect button (S) + QBO error state UX (S, mandatory for reliability).**

### Anti-Features

| Feature | Why Avoid | What to Do Instead |
|---------|-----------|-------------------|
| Live webhook ingestion | Requires a publicly accessible endpoint (ngrok or deployment), not available on local laptop; adds event-processing complexity | Poll-only with manual "Sync now" trigger for v1.1 |
| Write-back to QBO (creating invoices, updating bills) | Read-only is safer and sufficient; write-back adds QBO business-rules validation overhead | Read-only integration; scope is `com.intuit.quickbooks.accounting` which allows writes, but our code only GETs |
| Payroll data | QBO Payroll is a separate API with separate OAuth scopes; adds compliance considerations | Out of scope; payroll appears as a lump sum in `Purchase` entities with payroll vendor |
| Per-transaction POS/Items data | Item-level sales are not in the Accounting API; they require the QBO Payments API (different product) | Daily POS totals in `Purchase` entities are sufficient for P&L |
| PDF attachment / receipt OCR | QBO returns metadata, not file attachments, in the standard Accounting API query response | Structured data from Bill/Purchase/Invoice entities covers all needed fields |
| Bank feed raw transactions ("For Review") | These are NOT accessible via the Accounting API (confirmed via Intuit developer support forum); unreviewed/uncategorized transactions cannot be queried | Use `Purchase` entities (categorized expenses) as the bank-statement substitute; for anomaly detection, this is sufficient |
| OAuth PKCE or client-credentials flow | The Accounting API requires Authorization Code flow with client_id + client_secret; no PKCE-only option | Standard Authorization Code flow with client_secret stored in env vars |

### Dependencies on v1.0 Surfaces

| v1.0 Surface | How v1.1 QBO Touches It | Change Required |
|---|---|---|
| `/onboard/page.tsx` | Add a "Connect QuickBooks" vs "Use demo data" choice at the start of onboarding | New radio/button group; clicking QBO path triggers OAuth redirect instead of seed copy |
| `/api/tenants/route.ts` (POST) | Currently always copies `brains/seed/`; QBO path must create an empty brain dir and then run the transformer + `gbrain import` | Add `source: "qbo" | "seed"` to the request body; branch on source in the handler |
| `/api/tenants/[id]/onboard/route.ts` (SSE) | Currently streams seed-copy + gbrain init progress; QBO path streams transformer progress + gbrain import | Extract a shared SSE progress helper; the QBO path has more stages ("Fetching vendors... Transforming invoices... Importing...") |
| `lib/gbrain/client.ts` | No changes needed — `spawnGBrain` + `query` + `think` are reused as-is | None |
| `lib/gbrain/tenants.ts` | `TenantRecord` needs a `qboRealmId?: string` field and `dataSource: "seed" | "qbo"` field | Additive change |
| `INSI-04` (anomaly card) | Anomalies are detected by the `smb-audit` skill (Pillar A); QBO data must conform to the same markdown schema so the skill's detection rules fire correctly | Transformer output must match the exact frontmatter fields the skill reads (`type: invoice`, `vendor`, `amount`, `date`) |
| `data/maras-coffee/` seed (fixed) | The seed path is unchanged; QBO and seed paths are parallel, not intersecting | None |
| `scripts/panic-reset.sh` | Must also revoke/clear QBO tokens for the demo tenant on reset | Add token deletion SQL to reset script |

---

## Feature Dependencies (Cross-Pillar)

```
[Pillar B: Magic-Link Auth]
    └──required by──> [Pillar C: QBO Ingest]
                          (QBO tokens must attach to a stable user identity)

[Pillar A: smb-audit skill]
    └──required by──> [Pillar C: QBO Ingest]
                          (QBO-imported data triggers smb-audit at import time)
                          (the skill must be installed before QBO data arrives)

[Pillar B: Auth] ──touches──> [v1.0 Onboarding flow]
                                   (POST /api/tenants now requires a session)

[Pillar C: QBO Ingest] ──touches──> [v1.0 Onboarding SSE stream]
                                         (new progress stages injected into same stream)

[Pillar C: QBO Ingest] ──requires same schema as──> [v1.0 Seed Data]
                                                         (transformer output must match data/maras-coffee/ frontmatter)

[Pillar A: smb-audit skill] ──replaces writer in──> [v1.0 scripts/seed.ts]
                                 (keep reader in lib/insights/anomalies.ts unchanged)
```

### Dependency Notes

- **Auth must be built before QBO:** You cannot store per-user OAuth tokens without a user identity. Auth (Pillar B) is the prerequisite for QBO (Pillar C). Ship Pillar B first.
- **smb-audit skill can be built in parallel with Auth:** The skill does not depend on Auth or QBO. It only depends on the existing seed data and the existing `spawnGBrain` harness. It can be phased before or after Auth.
- **QBO transformer must output the seed schema:** The insight card parsers (`computeAnomalies`, `computeTopVendors`, `computePnl`) were written against the seed markdown schema. If the transformer emits different frontmatter field names, the cards break. Enforce the schema contract in the transformer and test it against a QBO sandbox account before shipping.
- **QBO "bank statement" substitute:** Because raw bank feed transactions are not queryable, the transformer must produce `originals/` pages from `Purchase` + `Bill` entities. This means the planted anomalies (price-hike, duplicate, ghost-SaaS) must be detectable from these entity types in real QBO data — or the insight card degrades gracefully when live data has no planted anomalies.

---

## MVP Definition for v1.1

### Phase ordering recommendation (feeds roadmap)

**Phase A (independent): smb-audit skill**
- No auth or QBO dependency
- Relatively bounded scope (port existing logic + new 4th anomaly)
- Validates gbrain skill authoring end-to-end before the more complex pillars
- Recommended: ship as Phase 1 of v1.1

**Phase B: Magic-link auth**
- Prerequisite for QBO
- Bounded scope: one new library (better-auth), one new DB file, 3–4 new routes
- Recommended: Phase 2 of v1.1

**Phase C: QBO ingest**
- Depends on Auth (Pillar B complete)
- Largest scope: OAuth dance + transformer + CDC sync + error handling
- Recommended: Phase 3 of v1.1 (or split into 3a: OAuth flow + 3b: transformer + 3c: CDC)

### Ship in v1.1 (must-have)

**Pillar A — smb-audit skill:**
- [ ] `SKILL.md` manifest + `scripts/smb-audit.mjs` implementing all 3 existing anomaly rules
- [ ] 4th anomaly type (missing-invoice, DATA-12) — dataset + detection rule
- [ ] Dollar-impact computation + structured frontmatter (`severity`, `dollar_impact`, `anomaly_type`, `vendor_slug`)
- [ ] `scripts/seed.ts` updated to call `gbrain jobs submit smb-audit` instead of inline TS detection
- [ ] Skill registered in `skills/RESOLVER.md` + passes `gbrain check-resolvable`

**Pillar B — Magic-link auth:**
- [ ] `/auth/sign-in` page + email form
- [ ] Magic-link send via better-auth + Resend (15-min expiry, single-use)
- [ ] Click handler → session creation → redirect to brain or onboarding
- [ ] Sign-out button on dashboard
- [ ] `auth.db` (Bun SQLite) for session + token storage
- [ ] Rate limiting: 1 link/60s per email
- [ ] Expiry + single-use error states with friendly messages
- [ ] Branded email HTML

**Pillar C — QBO ingest:**
- [ ] OAuth redirect + callback: `/api/qbo/connect` + `/api/qbo/callback`
- [ ] Encrypted token storage in `auth.db`
- [ ] Initial sync: Invoice + Bill + Purchase + Vendor for past 12 months
- [ ] QBO → markdown transformer matching seed schema
- [ ] `gbrain import` after transformer
- [ ] Success state + disconnect button
- [ ] QBO error state UX (expired token, revoked access)
- [ ] Incremental CDC sync for subsequent syncs
- [ ] Onboarding choice: "Connect QuickBooks" vs "Try with sample data"

### Defer to v1.2

- [ ] Multi-realm picker (user has multiple QBO companies)
- [ ] Background scheduled sync (cron-based)
- [ ] gbrain cross-modal eval receipt for smb-audit skill (full 10-item skillify audit)
- [ ] Severity threshold configurability for anomaly detection
- [ ] Account deletion UI
- [ ] Gmail / Stripe / Square connectors (same transformer pattern, different APIs)

---

## Feature Prioritization Matrix

| Feature | User Value | Impl. Cost | Priority |
|---------|------------|------------|----------|
| smb-audit skill (3 rules + structured frontmatter) | HIGH — prize narrative + cleaner architecture | MEDIUM | **P1** |
| 4th anomaly: missing-invoice (DATA-12) | MEDIUM — good demo story, not load-bearing | MEDIUM | **P1** |
| Magic-link auth (table stakes) | HIGH — required for QBO and session persistence | MEDIUM | **P1** |
| Rate limiting + expiry error states | MEDIUM — polish; prevents Resend quota burn | LOW | **P1** (bundle with auth, minimal extra cost) |
| QBO OAuth + token storage | HIGH — prerequisite for everything else in Pillar C | MEDIUM | **P1** |
| QBO → markdown transformer | HIGH — the actual data value | HIGH | **P1** |
| `gbrain import` after QBO transform | HIGH — makes data queryable | LOW (reuses existing harness) | **P1** |
| QBO error state UX (token refresh, revoked) | HIGH — without this, stale data silently breaks the brain | LOW | **P1** |
| Incremental CDC sync | MEDIUM — avoids re-syncing 12 months on every open | MEDIUM | **P2** |
| Disconnect button | MEDIUM — data ownership | LOW | **P2** |
| Onboarding choice screen (QBO vs demo) | HIGH — demo mode must stay intact | LOW | **P1** |
| Multi-realm picker | LOW — few SMBs have multiple QBO companies | MEDIUM | **P3** |
| Background scheduled sync | MEDIUM — power-user feature | MEDIUM | **P3** |
| Branded email HTML | LOW — polish | LOW | **P2** (bundle with auth send, < 1h) |

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| gbrain skill authoring (SKILL.md format, `skillify scaffold`, `jobs submit`) | HIGH | Sourced from gbrain README + SKILL.md in repo master branch (WebFetch verified) |
| smb-audit detection rules (porting from anomalies.ts) | HIGH | anomalies.ts is in the codebase; the rules are verified against the seed data |
| better-auth magic link plugin (expiry, single-use atomicity) | HIGH | Sourced from official better-auth docs; atomic token consumption confirmed in current docs |
| better-auth + Bun SQLite adapter | HIGH | Bun's built-in SQLite confirmed supported; PGLite support unconfirmed but unnecessary (Bun SQLite is simpler and already available) |
| Resend free tier (3k/mo, 100/day) | HIGH | Publicly documented; confirmed suitable for v1.1 pilot scale |
| QBO OAuth 2.0 flow (Authorization Code, scope, token exchange) | HIGH | Confirmed via multiple sources (Zuplo, Truto, official Intuit docs summary) |
| QBO entity surface: Invoice, Bill, Purchase, Vendor | HIGH | All confirmed via official Intuit API reference links and secondary sources |
| QBO CDC for incremental sync | HIGH | Confirmed via multiple sources; 30-day lookback window documented |
| Access token: 60-min expiry; refresh token: rotates every 24–26h, valid 5 years | HIGH | Confirmed November 2025 change (previously 100 days) via Truto 2026 guide |
| QBO free tier: 500k CorePlus credits/month | HIGH | Intuit App Partner Program live July 28 2025; confirmed metered reads |
| Bank feed raw transactions NOT accessible via Accounting API | HIGH | Confirmed via Intuit developer support forum (multiple questions, same answer: unreviewed/uncategorized transactions not exposed) |
| Purchase entity as bank-statement substitute | MEDIUM | Confirmed Purchase entity exists; that it maps cleanly to the seed schema's `bank-statement` format requires a hands-on spike |
| gbrain `jobs submit smb-audit --follow` streams stdout correctly | MEDIUM | `--follow` flag documented; stdout streaming behavior with the existing `onStdoutLine` callback needs verification during build |
| better-auth PGLite adapter | LOW (irrelevant — Bun SQLite is the right choice; this question is moot) | PGLite via Kysely is reportedly possible but undocumented; Bun SQLite is simpler and avoids the question entirely |

---

## Sources

### gbrain skill authoring
- [gbrain GitHub repository (master)](https://github.com/garrytan/gbrain) — skill system, `skillify scaffold`, jobs submit, RESOLVER.md format
- [gbrain skills/skillify/SKILL.md (master)](https://github.com/garrytan/gbrain/blob/master/skills/skillify/SKILL.md) — SKILL.md frontmatter spec, 11-item checklist, 7-phase workflow
- [gbrain skills/RESOLVER.md (master)](https://github.com/garrytan/gbrain/blob/master/skills/RESOLVER.md) — trigger-to-skill routing format, minion vs inline distinction
- [gbrain README (master, WebFetch)](https://raw.githubusercontent.com/garrytan/gbrain/master/README.md) — `gbrain put`, minion job system, skill architecture overview

### Magic-link auth
- [better-auth magic link plugin docs](https://better-auth.com/docs/plugins/magic-link) — `expiresIn` config, atomic single-use token behavior
- [better-auth SQLite adapter docs](https://better-auth.com/docs/adapters/sqlite) — Bun built-in SQLite confirmed supported
- [Auth.js Resend provider](https://authjs.dev/getting-started/providers/resend) — comparison reference (24h default expiry, DB required)
- [nextauthjs/next-auth issue #12979](https://github.com/nextauthjs/next-auth/issues/12979) — Auth.js v5 Edge Runtime DNS module conflict in Next.js App Router (reason to prefer better-auth)

### QuickBooks Online API
- [Truto — How to Integrate with the QBO API (2026 Guide)](https://truto.one/blog/how-to-integrate-with-the-quickbooks-online-api-2026-guide) — CDC endpoint, token lifetimes, rate limits
- [Truto — QBO API Cost 2026 (Rate Limits)](https://truto.one/blog/how-much-does-the-quickbooks-api-cost-2026-pricing-rate-limits) — App Partner Program free tier (500k CorePlus/month), metered reads
- [Zuplo — QuickBooks API Complete Developer's Guide (2026)](https://zuplo.com/learning-center/quickbooks-api) — scope (`com.intuit.quickbooks.accounting`), Purchase/Deposit/Transfer as bank-statement entities, CDC syntax, rate limit behavior
- [Intuit Developer — OAuth 2.0 FAQ](https://developer.intuit.com/app/developer/qbo/docs/develop/authentication-and-authorization/faq) — token expiry, refresh rotation
- [Intuit Developer — Bill entity reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/bill)
- [Intuit Developer — Vendor entity reference](https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/vendor)
- [Intuit Developer support — bank feed raw transactions not accessible](https://help.developer.intuit.com/s/question/0D5TR000001d0Xq0AI/how-do-i-use-quickbooks-api-to-pull-bank-feed-information-that-i-see-in-my-transactions-tab) — confirms "For Review" bank feed transactions are NOT available via Accounting API

---

*Feature research for: QuickBrain v1.1 — smb-audit skill, magic-link auth, QBO ingest*
*Researched: 2026-05-17*
