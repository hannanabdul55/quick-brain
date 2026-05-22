# Phase 6: Auth + Multi-Tenant Isolation - Research

**Researched:** 2026-05-22
**Domain:** Email magic-link auth, multi-tenant isolation, Next.js 15 middleware, Supabase Postgres app store, gbrain brain/source model
**Confidence:** HIGH on auth stack and Next.js wiring; **HIGH on the gbrain multi-tenant model — and it contradicts a phase assumption (see BLOCKING FINDING below).**

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

These were auto-selected (`--auto` mode) using the recommended option. CONTEXT.md
states they are "defaults the planner may refine with research, not hard locks."
**D-11 is directly contradicted by research — see BLOCKING FINDING.**

- **D-01:** Replace the filesystem `brains/<slug>/` + `readdir(BRAINS_ROOT)` registry
  (`lib/gbrain/tenants.ts`) with a Supabase Postgres-backed registry. The `users`
  table **is** the registry — one row per user carrying the user↔brain mapping
  (`brain_slug` / `brain_id`). Tenant identity resolves from the authenticated
  session, not from a URL slug or disk scan. Mirror the `app` schema + `postgres`
  pooler pattern from `lib/jobs/store.ts`.
- **D-02:** A brand-new user gets a fresh **empty** brain auto-provisioned on first
  sign-in — **not** a copy of the synthetic Mara's Coffee seed. Provisioning no
  longer copies `brains/seed/` on disk; it registers a per-user brain namespace in
  Supabase Postgres.
- **D-03:** The seed/demo tenant stays reachable **only** behind the dev-only
  `AUTH_ENABLED=0` bypass. Phase 6 introduces `AUTH_ENABLED` (default `1` / on);
  Phase 9 (CLEAN-03) deletes the `0` path.
- **D-04:** DB-backed sessions. Opaque random session ID in the cookie; session
  record (id, user, expiry) in `app.sessions`. Sign-out deletes the row.
  `jose` is used to sign the **magic-link** token only, not the session.
- **D-05:** Session cookie shape: `HttpOnly` + `Secure` + `SameSite=Lax` +
  30-day `maxAge`, cookie name `qb_session`. Cleared on sign-out via `maxAge: 0`.
- **D-06:** Auth gating runs in a new `middleware.ts`. Coarse cookie-presence check
  in middleware; full session validation in Node-runtime routes/pages.
- **D-07:** Magic-link token TTL = **15 minutes**. Single-use, enforced atomically
  via `UPDATE ... WHERE used=false` + row-count check (no TOCTOU). Second/expired
  click shows a clear "link already used / expired" page with a resend path.
- **D-08:** Sign-in **replaces** the hackathon `/onboard` business-name form. No
  business-name step. New routes: `/sign-in`, a magic-link verify route, and a
  post-sign-in redirect to the user's `/dash/[brain]`.
- **D-09:** Rate limiting (1 magic-link per email per 60s, AUTH-09) is DB-backed —
  a `last_sent_at` timestamp checked on the user / magic-link row.
- **D-10:** The `users` table includes nullable QBO columns now — `qbo_realm_id`
  and `qbo_tokens_encrypted` — populated in Phase 7.
- **D-11:** Cross-tenant isolation leans on gbrain's auto-enabled RLS (Spike 005:
  RLS on 41/41 public tables). App-owned tables live in the `app` schema, clear of
  gbrain's auto-RLS event trigger. **⚠ See BLOCKING FINDING — gbrain RLS does NOT
  isolate one user's brain from another's. It only blocks the Supabase anon key.**

### Claude's Discretion

- Exact table and column names, the verify-route path name, the magic-link email
  HTML template, the resend-page layout, polling/UI specifics, and the precise
  Node-vs-Edge middleware split — all left to research/planning.

### Deferred Ideas (OUT OF SCOPE)

- **ES256 JWT key-pair** — HS256 is the v2.0 choice; ES256 is a comment-documented
  upgrade path.
- **Team / multi-user-per-brain sharing** — explicitly v2.1.
- **Account self-service data export + deletion (GDPR)** — v2.1.
- **The QBO OAuth flow** — Phase 7. Only the encrypted-token *columns* land in
  Phase 6 (D-10).
- **Removing the `AUTH_ENABLED=0` bypass and the synthetic seed** — Phase 9.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | User signs in with email; magic link via Resend; clicking it establishes a session | §Magic-Link Auth; §Resend |
| AUTH-02 | Magic link single-use + time-limited; second/expired click shows clear message + resend path | §Atomic Single-Use Consume; §Sign-In UX |
| AUTH-03 | Signed-in user persists across browser sessions/devices via secure session cookie | §Session Model; §Cookie Shape |
| AUTH-04 | Each user has exactly one brain; sign-in routes to their brain; auto-provisioned on first sign-in | §Per-User Brain Provisioning |
| AUTH-05 | A user's brain data cannot be read/queried by another user — DB-layer isolation | §BLOCKING FINDING; §Isolation Architecture |
| AUTH-06 | Routes exposing tenant data require an authenticated session; unauth redirected to sign-in | §middleware.ts; §Route Protection |
| AUTH-07 | A user can sign out, ending the session | §Session Model (server-side revocation) |
| AUTH-08 | User store (email→brain mapping, session + magic-link records) lives in Supabase Postgres | §Schema Design (app schema) |
| AUTH-09 | Magic-link requests rate-limited per email | §DB-Backed Rate Limiting |
</phase_requirements>

## Summary

Phase 6 layers email magic-link authentication and enforced multi-tenant isolation
onto a hosted Next.js 15 + Supabase + Vercel stack. The auth half is well-trodden:
`jose` (pure Web Crypto, Edge-safe) signs the 15-minute magic-link token, Resend
sends it, an opaque DB-backed session in `app.sessions` survives sign-out as
true server-side revocation, and `middleware.ts` does coarse gating. The v1.x
archived auth research (`.planning/archive/v1.x/phases/05-.../05-RESEARCH.md`) is
~80% reusable — but every claim that the store is `bun:sqlite` is **obsolete**;
v2.0 is hosted, so the store is Supabase Postgres via the `postgres` package,
mirroring `lib/jobs/store.ts` exactly (`app` schema, `prepare:false` pooler).

The isolation half contains a **BLOCKING FINDING that contradicts D-11**. The phase
context assumed gbrain's auto-enabled RLS isolates one user's brain from another's.
**It does not.** gbrain's RLS is a single binary "deny the Supabase anon key, allow
the `BYPASSRLS` service role" posture — confirmed by reading gbrain's own
`src/schema.sql` and `docs/guides/rls-and-you.md`. There are no per-user RLS
policies, no `tenant_id` column on `pages`/`content_chunks`, and no per-user DB
role. Because QuickBrain's `lib/gbrain/engine.ts` connects with the service-role
pooler URL (`GBRAIN_DATABASE_URL`) which has `BYPASSRLS`, **RLS is bypassed on
every query QuickBrain makes.** If two users' brains share gbrain's `pages` table,
RLS provides zero isolation between them.

gbrain *does* have a real multi-tenant model — two of them, in fact: **brains**
(separate databases) and **sources** (named partitions inside one database, every
`pages` row carries `source_id`). The viable Phase 6 path is **per-user `source_id`
partitioning + application-enforced scoping**: every gbrain query QuickBrain runs
is scoped to the authenticated user's `source_id`, and the AUTH-05 test verifies
the *application layer* blocks cross-tenant reads. This is a real, defensible
isolation model — it is just not "gbrain RLS." The planner must treat D-11 as
**superseded** and surface this to the user via discuss-phase before locking it.

**Primary recommendation:** Auth — install `jose` + `resend`, build the
`app.users` / `app.sessions` / `app.magic_links` store via a `scripts/setup-auth-tables.ts`
DDL script (mirror `setup-jobs-table.ts`), wire `middleware.ts` for coarse gating +
Node-runtime route validation. Isolation — adopt per-user `source_id` scoping for
the gbrain brain; provision a fresh empty brain by inserting a `sources` row +
running `engine.initSchema()` once for the shared DB; enforce the scope in every
`lib/gbrain/*` call; write the AUTH-05 test against the application boundary.

---

## ⚠ BLOCKING FINDING — gbrain RLS Does Not Isolate Tenants

**This is the open question CONTEXT.md `<specifics>` asked the researcher to resolve.
The answer overturns D-11.**

### What Spike 005 actually confirmed

Spike 005 confirmed `[OK] rls: RLS enabled on 41/41 public tables`. That is a true
statement — but it does **not** mean per-user isolation. Reading gbrain's source:

`src/schema.sql` lines 882–931 (`[VERIFIED: node_modules/gbrain/src/schema.sql]`):

```sql
-- Row Level Security: block anon access, postgres role bypasses
-- The postgres role (used by gbrain via pooler) has BYPASSRLS.
-- Enabling RLS with no policies means the anon key can't read anything.
DO $$ ... IF has_bypass THEN
  ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
  ... (every table) ...
```

`docs/guides/rls-and-you.md` (`[VERIFIED: node_modules/gbrain/docs/guides/rls-and-you.md]`):

> "gbrain's service-role connection holds `BYPASSRLS`, so enabling RLS without
> policies does NOT break gbrain itself. It just blocks the anon key's default
> read. That's the security posture: deny-by-default to anon, full access for
> the service role."

**Three facts that kill the D-11 assumption:**

1. **There are zero `CREATE POLICY` statements in gbrain.** `ENABLE ROW LEVEL
   SECURITY` with no policy = "deny everyone who is not `BYPASSRLS`." It is not
   a per-row filter. There is no `USING (tenant_id = current_setting(...))` clause.
2. **`pages` and `content_chunks` have no owner/tenant column.** They have
   `source_id` (a partition key, see below) — but no user identity. RLS could not
   filter by user even if a policy existed.
3. **QuickBrain connects with the `BYPASSRLS` service role.** `lib/gbrain/engine.ts`
   `buildConfig()` reads `GBRAIN_DATABASE_URL`/`SUPABASE_DB_URL_POOLER` — the
   Supavisor pooler URL with the `postgres` superuser. Every QuickBrain query
   **bypasses RLS entirely.** RLS is invisible to the app.

**Conclusion:** If User A's brain and User B's brain share gbrain's `pages` table,
RLS provides **no isolation between them**. AUTH-05's test ("User A cannot read
User B's data — enforced at the DB layer via gbrain RLS") cannot pass as written.

### gbrain's actual multi-tenant models

gbrain has two real, documented multi-tenancy axes (`[VERIFIED:
node_modules/gbrain/docs/architecture/brains-and-sources.md]`,
`[VERIFIED: node_modules/gbrain/CLAUDE.md]`):

| Axis | What it is | Isolation strength | Phase 6 fit |
|------|-----------|---------------------|-------------|
| **Brain** | A whole separate **database** (PGLite file, or a distinct Postgres DB). Routed via `--brain` / `GBRAIN_BRAIN_ID` / `mounts.json`. | Strong — physically separate `pages` tables. | **Not viable** — one Supabase free-tier project = one database. A DB-per-user needs one Supabase project per user (free tier is one project; not feasible). |
| **Source** | A named content partition **inside one database**. Every `pages` / `content_chunks` / `links` / `files` row carries `source_id`. Slugs are unique per source. Added via `addSource()` / `gbrain sources add`. | Application-enforced — gbrain's read ops accept a `sourceId` and apply `WHERE source_id = $N`. **Not** RLS; the app must pass the scope. | **Viable** — one `sources` row per user inside the shared gbrain Postgres DB. |

The `sources` table (`src/schema.sql` lines 26–47): `id TEXT PRIMARY KEY` (the
partition key, `[a-z0-9-]{1,32}`), `name`, `config JSONB`. A `default` source is
seeded; `federated=false` sources are only searched when explicitly named.

gbrain's `BrainEngine` search methods take `sourceId` / `sourceIds` and apply
`WHERE source_id = $N` / `= ANY($N)` at the SQL layer (`[VERIFIED:
node_modules/gbrain/CLAUDE.md` — "`SearchOpts` + `PageFilters` add `sourceIds`",
"`searchKeyword` / `searchVector` apply source-aware ranking"]). gbrain v0.34.1.0
explicitly hardened this read path (`sourceScopeOpts(ctx)`) to "close the
source-isolation leak on the read path" — meaning **source isolation is real, but
it is the *caller's* job to pass the right `sourceId`.**

### Recommended Phase 6 isolation model

**Per-user `source_id` partitioning + application-enforced scoping.**

- Each user's brain = one `sources` row in the shared gbrain Postgres DB. The
  `source_id` *is* the brain identity. Store it on `app.users.brain_id`.
- Provisioning a "fresh empty brain" = `INSERT INTO sources (id, name, config)`
  for that user's `source_id`. No data copied; the source starts empty.
- Every QuickBrain gbrain call (`query`, `think`, future QBO import) is scoped to
  the authenticated user's `source_id`. `lib/gbrain/engine.ts` /
  `lib/gbrain/client.ts` must thread `sourceId` through `hybridSearch` /
  `runThink` so gbrain applies `WHERE source_id = $N`.
- **The isolation boundary is the application, not RLS.** The AUTH-05 test asserts
  that a request authenticated as User A, attempting to reach User B's `source_id`,
  is rejected — because tenant identity comes from the verified session and the
  query is hard-scoped to that user's source. There is no code path where a user
  can pass an arbitrary `source_id`.
- The `app.sessions` check in every tenant-data route IS the access-control
  mechanism. D-11's framing ("RLS is the block, the session check is just for the
  app tables") inverts reality: **the session check is the only block for everything.**

**Why this is still defensible for AUTH-05.** AUTH-05's *requirement* text says
"isolation is enforced at the database layer via gbrain's row-level security."
The *intent* is "User A provably cannot read User B's data." The intent is fully
satisfied by source-scoping + session-derived identity; the *mechanism named in
the requirement is wrong*. The planner must either (a) get the user to amend
AUTH-05's wording via discuss-phase, or (b) document in PLAN that AUTH-05's
"RLS" mechanism is superseded by source-scoping and the test verifies the
application boundary. Recommended: (a) — this is a real requirement-vs-reality
gap, not a planning detail.

### Defense-in-depth option (recommended, low cost)

Source-scoping is application-enforced, so a scoping bug = a cross-tenant leak.
Two cheap hardening layers worth a PLAN task each:

1. **A single chokepoint for `sourceId`.** Resolve `source_id` exactly once, from
   the verified session, in one helper (`lib/auth/resolve-tenant.ts`). No route or
   `lib/gbrain` function ever accepts a `source_id` from request input. This makes
   "can a user pass another user's source_id?" answerable by inspecting one file.
2. **A real Postgres RLS policy on gbrain's `pages` (optional, Phase 6+ or later).**
   gbrain's `BYPASSRLS` role bypasses any policy, so adding `CREATE POLICY ... USING
   (source_id = current_setting('app.current_source'))` would be *inert* for
   QuickBrain's own queries — it only helps if a non-`BYPASSRLS` role ever touches
   the DB. Document as a future option; **do not rely on it for Phase 6.** The
   honest Phase 6 answer is "application-layer scoping."

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Magic-link token sign/verify | API (Route Handler, Node runtime) | — | Signing needs `JWT_SECRET`; must stay server-side |
| Email delivery | API → Resend (external) | — | HTTP call from a Route Handler |
| Session create/destroy | API (Route Handler, Node runtime) | — | `Set-Cookie` + `app.sessions` Postgres write/delete |
| Coarse auth gating (cookie presence) | Middleware (Edge or Node) | — | Runs before every matched request; cookie-only, no DB |
| Full session validation (`app.sessions` lookup) | API + Pages (Node runtime) | Middleware (if Node-runtime middleware adopted) | DB lookup; `postgres` client is not Edge-compatible |
| Tenant identity resolution (`source_id`) | API (Node runtime) | — | Derived from the verified session, never from request input |
| gbrain query/think scoped to a brain | API → gbrain in-process | — | `lib/gbrain/*` threads `sourceId` into `hybridSearch`/`runThink` |
| Cross-tenant isolation enforcement | API (session-derived scoping) | — | **Application layer — NOT gbrain RLS (see BLOCKING FINDING)** |
| Per-user empty-brain provisioning | API (Node runtime) → gbrain `sources` | — | `INSERT INTO sources` for the user's `source_id` on first verify |
| Sign-in / resend / check-email UI | Browser (Client Components) | — | Form + loading state |
| Rate-limit persistence | API (Postgres `last_sent_at`) | — | Must survive serverless cold starts / multiple instances |

---

## Standard Stack

### Core (Phase 6 additions)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `jose` | `^6.x` (verify latest at plan time) | Sign + verify the 15-minute magic-link token (HS256) | Pure Web Crypto API; no native bindings; Edge-safe; canonical JOSE library for JS runtimes |
| `resend` | `^6.x` (verify latest at plan time) | Transactional email — sends the magic link | Official Resend SDK; pure HTTP, no native deps; first-class TypeScript; project's locked email provider |
| `node:crypto` | built-in | `randomUUID()` for opaque session IDs + magic-link `jti`; AES-256-GCM helper for the QBO-token column (schema lands here, encryption used Phase 7) | Bun's Node compat layer fully supports `node:crypto` |
| `postgres` | already installed (gbrain transitive dep) | `app.users` / `app.sessions` / `app.magic_links` CRUD | Already in `node_modules`, already force-bundled. **NO new install** — mirror `lib/jobs/store.ts` exactly |

### Already in package.json (no new install)

| Library | Purpose |
|---------|---------|
| `zod` | Validate the `/api/auth/send-link` body (email string) before issuing a token |
| `gbrain` | `addSource` (via `engine.executeRaw`) for per-user brain provisioning; `hybridSearch`/`runThink` scoped by `sourceId` |
| `next` `^15.3.2` | App Router, Route Handlers, `middleware.ts`, `cookies()` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| DB-backed opaque session (D-04) | Stateless signed-JWT session cookie | JWT cannot be revoked server-side — sign-out (AUTH-07) cannot truly end the session. D-04 is correct; keep it. |
| `jose` HS256 | `jose` ES256 key-pair | ES256 needs two PEM env vars + key gen; HS256 needs one `JWT_SECRET`. Single-server app — HS256 is right (deferred-ideas confirms). |
| `resend` | Postmark / AWS SES direct | Resend is the project-locked provider (SKILL.md, CLAUDE.md). No decision to make. |
| Per-user `source_id` (recommended) | One Supabase project per user | Free tier = one project. Project-per-user is not viable; rejected. |
| Per-user `source_id` | gbrain RLS per-user policies | gbrain has no per-user policies and QuickBrain bypasses RLS via `BYPASSRLS`. Not possible (BLOCKING FINDING). |
| `scripts/setup-auth-tables.ts` DDL | Supabase migration file (`supabase/migrations/`) | The job-table precedent (`scripts/setup-jobs-table.ts`) is a standalone idempotent DDL script, not a Supabase CLI migration. Follow the precedent for consistency. |

**Installation (new packages only):**
```bash
bun add jose resend
```

**Version verification — run before writing the Standard Stack into PLAN.md:**
```bash
npm view jose version       # confirm current 6.x
npm view resend version     # confirm current 6.x
```
Training data versions are stale. The v1.x archived research recorded
`jose@6.2.3` and `resend@6.12.3` as of 2026-05-19 — re-verify; both move.

## Package Legitimacy Audit

> slopcheck was not installable in this research environment. Both packages are
> tagged `[ASSUMED]` below — the planner MUST gate each install behind a
> `checkpoint:human-verify` task, OR rely on the manual verification evidence.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `jose` | npm | 11+ yrs (since 2014) | Very high — industry-standard JWT/JOSE lib | github.com/panva/jose | unavailable → [ASSUMED] | Approved — `panva/jose` is the canonical JOSE implementation for Web Crypto runtimes; referenced in official Next.js, Cloudflare Workers, and Deno docs |
| `resend` | npm | 8+ yrs (registered 2017) | High — Resend is a well-known ESP | github.com/resend/resend-node | unavailable → [ASSUMED] | Approved — official SDK from resend.com; pure HTTP; no postinstall script |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Manual verification evidence (substitutes for slopcheck):**
- `jose` — run `npm view jose repository.url` → expect `git+https://github.com/panva/jose.git`. No postinstall. Canonical across all Web Crypto runtimes.
- `resend` — run `npm view resend repository.url` → expect `git+https://github.com/resend/resend-node.git`. Run `npm view resend scripts.postinstall` → expect empty.
- `postgres` is **not** a new install (gbrain transitive dep, already in `node_modules`) — no audit needed; it is already in production use via `lib/jobs/store.ts` and `lib/health/probes.ts`.

---

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────┐
   Browser                │  Email client (Resend mail) │
   ───────                └──────────────┬──────────────┘
   /sign-in form                         │ click magic link
       │ POST /api/auth/send-link         │
       ▼                                  ▼
 ┌──────────────────┐         ┌──────────────────────────────┐
 │ send-link route  │         │ verify route (Node runtime)  │
 │ (Node runtime)   │         │ 1. jose.jwtVerify(token)     │
 │ 1. zod validate  │         │ 2. atomic consume magic_link │
 │    email         │         │    UPDATE..WHERE used=false  │
 │ 2. rate-limit    │         │    + rowCount check          │
 │    check         │         │ 3. get-or-create app.users   │
 │    last_sent_at  │         │ 4. first sign-in →           │
 │ 3. issue jose    │         │    provision source_id +     │
 │    HS256 token   │         │    INSERT sources row        │
 │ 4. INSERT        │         │ 5. INSERT app.sessions row   │
 │    magic_links   │         │ 6. Set-Cookie qb_session     │
 │ 5. resend.send   │         │ 7. redirect /dash/<brain>    │
 └────────┬─────────┘         └───────────────┬──────────────┘
          │                                   │
          ▼                                   ▼
 ┌─────────────────────────────────────────────────────────┐
 │  Supabase Postgres — `app` schema (app-owned tables)     │
 │  app.users  ·  app.sessions  ·  app.magic_links          │
 │  (separate schema — clear of gbrain's public-schema       │
 │   auto-RLS event trigger)                                 │
 └─────────────────────────────────────────────────────────┘

 Every request to a tenant-data route:
   middleware.ts ──coarse: qb_session cookie present?──► no → redirect /sign-in
        │ yes
        ▼
   Node-runtime route/page ──full: SELECT app.sessions WHERE id=cookie,
        │                          not expired──► invalid → redirect /sign-in
        │ valid → session.user_id → app.users.brain_id (= source_id)
        ▼
   lib/gbrain  ── hybridSearch / runThink scoped: WHERE source_id = <user's> ──►
        │
        ▼
 ┌─────────────────────────────────────────────────────────┐
 │  Supabase Postgres — gbrain `public` schema              │
 │  pages · content_chunks · sources (one row per user)     │
 │  Isolation = application source-scoping, NOT RLS         │
 │  (QuickBrain connects as BYPASSRLS service role)         │
 └─────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
app/
├── sign-in/page.tsx              # email form (D-08, replaces /onboard)
├── auth/
│   ├── verify/route.ts           # magic-link verify (Node runtime)
│   └── link-used/page.tsx        # "already used / expired" + resend (D-07)
├── api/auth/
│   ├── send-link/route.ts        # POST: rate-limit, issue token, Resend send
│   └── sign-out/route.ts         # POST: delete app.sessions row, clear cookie
├── dash/[id]/page.tsx            # existing — gains session validation
└── page.tsx                      # repurposed: AUTH_ENABLED=1 → redirect /sign-in
lib/auth/
├── tokens.ts                     # jose issueMagicToken / verifyToken (HS256)
├── store.ts                      # app.users/sessions/magic_links CRUD (mirrors lib/jobs/store.ts)
├── session.ts                    # createSession / validateSession / destroySession
├── resolve-tenant.ts             # the ONE chokepoint: session → source_id
└── email.ts                      # Resend client + magic-link HTML template
middleware.ts                     # NEW — coarse cookie gating (repo root)
scripts/setup-auth-tables.ts      # NEW — idempotent DDL (mirrors setup-jobs-table.ts)
```

### Pattern 1: Supabase Postgres app store (mirror lib/jobs/store.ts)

**What:** Module-level `postgres()` singleton, `prepare:false` (Supavisor pooler
port 6543), tagged-template parameterized SQL, all tables in the `app` schema.
**When to use:** every `app.users` / `app.sessions` / `app.magic_links` read/write.

```typescript
// lib/auth/store.ts — Source: lib/jobs/store.ts (verified in-repo)
import postgres, { type JSONValue } from "postgres";

const databaseUrl =
  process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
if (!databaseUrl) {
  throw new Error("lib/auth/store.ts: GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set");
}
const sql = postgres(databaseUrl, { prepare: false }); // prepare:false MANDATORY for pooler
```
`[VERIFIED: lib/jobs/store.ts]` — this exact shape (singleton, `prepare:false`,
`app` schema, tagged templates) is in production today for `app.jobs`.

### Pattern 2: Atomic single-use magic-link consume (no TOCTOU)

**What:** Consume the token with a single `UPDATE ... WHERE used = false` and
check the affected-row count. **Never** `SELECT used` then `UPDATE` — that is a
race two concurrent clicks can both win.
**When to use:** the verify route, exactly once per token.

```typescript
// Source: v1.x archived research §2, adapted to postgres.js
// rows.count === 0 means the token was already consumed (or never existed)
const rows = await sql`
  UPDATE app.magic_links
  SET used = true, used_at = now()
  WHERE jti = ${jti}
    AND used = false
    AND expires_at > now()
  RETURNING email
`;
if (rows.count === 0) {
  // already-used OR expired OR not-found — show link-used page with resend path
}
const email = rows[0].email;
```
postgres.js returns the result array with a `.count` property = affected rows.
This is the postgres.js equivalent of the v1.x `bun:sqlite` `result.changes`
pattern. `[CITED: github.com/porsager/postgres — result array carries .count]`

### Pattern 3: jose HS256 magic-link token

```typescript
// lib/auth/tokens.ts — Source: v1.x archived research §1 (jose pattern unchanged)
import { SignJWT, jwtVerify, errors } from "jose";
const secret = new TextEncoder().encode(process.env.JWT_SECRET!); // ≥32 bytes

export async function issueMagicToken(email: string) {
  const jti = crypto.randomUUID();
  const token = await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("15m")        // D-07: 15-minute TTL
    .setJti(jti)
    .sign(secret);
  return { token, jti };
}

export async function verifyMagicToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret, { clockTolerance: "30s" });
    return { ok: true as const, email: payload.email as string, jti: payload.jti! };
  } catch (err) {
    if (err instanceof errors.JWTExpired) return { ok: false as const, reason: "expired" };
    return { ok: false as const, reason: "invalid" };
  }
}
```
`[CITED: npmjs.com/package/jose]` — `SignJWT` / `jwtVerify` / `errors` API.

### Pattern 4: Per-user empty-brain provisioning (gbrain source)

**What:** Provisioning a fresh empty brain = inserting one `sources` row in the
shared gbrain Postgres DB for the user's `source_id`. The gbrain schema
(`pages`, `content_chunks`, etc.) already exists DB-wide; a new source adds
**no** rows until the user ingests data (QBO, Phase 7).
**When to use:** the verify route, on first sign-in only (idempotent).

```typescript
// Source: node:gbrain src/core/sources-ops.ts addSource() — VERIFIED
// gbrain has no exported "createBrain"; a per-user "brain" is a sources row.
// QuickBrain reuses the engine pool (lib/gbrain/engine.ts) and runs:
await engine.executeRaw(
  `INSERT INTO sources (id, name, config)
   VALUES ($1, $2, $3::jsonb)
   ON CONFLICT (id) DO NOTHING`,
  [userSourceId, displayName, JSON.stringify({ federated: false })],
);
```
- `userSourceId` must match gbrain's source-id rule: `[a-z0-9-]{1,32}`
  (`src/schema.sql` comment). `lib/gbrain/slug.ts` `TENANT_SLUG_REGEX` is
  compatible (1–40 chars — tighten the generator to ≤32 for safety).
- `federated: false` so the source is NOT swept into cross-source default search
  — gbrain only searches it when QuickBrain explicitly names it. This is a small
  extra safety layer (`[VERIFIED: src/schema.sql` lines 18–25]`).
- **Latency:** an `INSERT` into `sources` is a single sub-millisecond Postgres
  write. It is **not** the old "copy `brains/seed/` + `gbrain init` + `import` +
  `embed`" multi-minute path. It runs **inline in the verify route** — no Phase 5
  background-job path needed. `engine.initSchema()` (idempotent DB-wide schema
  bootstrap) only needs to run once for the whole gbrain DB; Phase 2 already
  migrated the seed brain onto Supabase, so the gbrain schema already exists.
  Provisioning a new user adds only the `sources` row.

### Pattern 5: middleware.ts coarse gating + Node-runtime full validation (D-06)

**What:** `middleware.ts` does a cheap, DB-free check — is the `qb_session`
cookie present? Full validation (`SELECT app.sessions`) happens in the
Node-runtime route/page that touches tenant data.
**Why split:** The `postgres` client is **not** Edge-compatible. On Next.js
15.3.2, middleware defaults to the **Edge runtime**. A DB lookup in Edge
middleware is impossible without an HTTP-based DB driver.

```typescript
// middleware.ts — Source: v1.x archived research §4, adapted to opaque-session model
import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  if (process.env.AUTH_ENABLED === "0") return NextResponse.next(); // D-03 dev bypass
  const { pathname } = request.nextUrl;
  const hasCookie = request.cookies.has("qb_session");
  if (!hasCookie) {
    const next = encodeURIComponent(pathname);
    return NextResponse.redirect(new URL(`/sign-in?next=${next}`, request.url));
  }
  return NextResponse.next(); // cookie present — full DB validation happens downstream
}
export const config = { matcher: ["/dash/:path*", "/api/tenants/:path*"] };
```

**Node-runtime middleware option.** Next.js Node-runtime middleware became
**stable in 15.5** (`export const runtime = "nodejs"` in `middleware.ts`). This
project is on **15.3.2** — Node-runtime middleware is **NOT available**. Two
choices for the planner:

1. **Recommended for 15.3.2 (no upgrade):** keep middleware Edge + cookie-only;
   do full `app.sessions` validation in a shared helper called by every
   Node-runtime route handler and `dash/[id]/page.tsx`. This is exactly D-06's
   "coarse in middleware, full in Node routes" split. Zero version risk.
2. **Optional:** bump Next.js to ≥15.5 and run full validation in Node-runtime
   middleware. This consolidates the check but adds a framework-upgrade task to
   Phase 6 scope. **Not recommended** — D-06 already chose the split, and a
   minor-version bump mid-phase is avoidable scope. If the planner wants it,
   make it an explicit, isolated task with its own verification.

`[CITED: nextjs.org docs — Node.js runtime for middleware stable in v15.5]`

### Anti-Patterns to Avoid

- **Trusting gbrain RLS for tenant isolation.** It does not isolate users (see
  BLOCKING FINDING). Do not write the AUTH-05 test to assert RLS does anything.
- **Accepting `source_id` from request input.** A user must never be able to name
  another user's `source_id`. Resolve it once from the verified session in
  `lib/auth/resolve-tenant.ts`. Routes take a session, not a tenant id.
- **SELECT-then-UPDATE on magic-link consume.** TOCTOU race; two clicks both win.
  Use the single atomic `UPDATE ... WHERE used = false` + `.count` check.
- **Stateless JWT session cookie.** Cannot be revoked → sign-out (AUTH-07) is a
  lie. D-04's opaque DB session is correct.
- **`SameSite=Strict` session cookie.** The magic-link click is a cross-site
  navigation from the email client; `Strict` drops the cookie on first load.
  D-05's `SameSite=Lax` is correct.
- **Putting app tables in the `public` schema.** gbrain's auto-RLS event trigger
  fires on every new `public.*` table. Keep `app.users` / `app.sessions` /
  `app.magic_links` in the `app` schema (D-11's one correct half).
- **In-memory rate-limit Map.** Serverless cold starts and multiple Vercel
  instances each have their own memory; the limit must be a DB column (D-09).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JWT signing/verifying | Custom HMAC + base64url | `jose` `SignJWT`/`jwtVerify` | Constant-time compare, header validation, expiry parsing, `errors.JWTExpired` typing — all edge cases jose already handles |
| Transactional email | Raw SMTP / SES API calls | `resend` SDK | Project-locked provider; SDK handles auth, retries, typed errors |
| Opaque session token | `Math.random()` string | `crypto.randomUUID()` | 122-bit cryptographically-random; guessable IDs = session hijacking |
| Single-use token race | SELECT-then-UPDATE | Atomic `UPDATE ... WHERE used=false` + `.count` | Two concurrent clicks both pass a SELECT check; the DB `WHERE` clause is the only race-free guard |
| Per-tenant brain isolation | Custom `tenant_id` columns on gbrain tables | gbrain `source_id` partition + session-scoped queries | gbrain already carries `source_id` on `pages`/`chunks`/`links`/`files` and its search ops apply `WHERE source_id` — reuse it, don't fork the schema |
| Postgres parameterization | String-concat SQL | postgres.js tagged templates `sql\`... ${v}\`` | SQL-injection-safe by construction; the established `lib/jobs/store.ts` pattern |
| Per-user gbrain DB schema | `gbrain init` per user | DB-wide `initSchema()` once + a `sources` row per user | The gbrain schema is DB-global; only the `sources` row is per-user |

**Key insight:** Phase 6's only genuinely novel code is the *wiring* — magic-link
flow, session lifecycle, the `source_id` chokepoint. Every primitive (JWT, email,
random IDs, source partitioning) already exists in a library or in gbrain. The
risk is integration seams, not algorithms.

## Runtime State Inventory

> This phase replaces a registry and adds new persistent state. Not a rename, but
> the "what runtime state changes" question still applies.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) The filesystem `brains/<slug>/` registry (`lib/gbrain/tenants.ts` `readdir(BRAINS_ROOT)`) — replaced by `app.users` (D-01). (2) gbrain's shared Postgres `pages`/`content_chunks` — currently one `default` source; Phase 6 adds one `sources` row per user. | Code change (new registry) + per-user `sources` INSERT on first sign-in |
| Live service config | Vercel env config — Phase 6 adds `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `AUTH_ENABLED`. STATE.md flags Vercel Production env config is **empty** ("all 13 app secrets must be added"). The Resend `RESEND_API_KEY` + verified domain is a **pending operator action** per STATE.md. | Operator must add the new vars to Vercel + `.env.local`; Resend domain must be verified before AUTH-01 can pass |
| OS-registered state | None — Vercel serverless; no Task Scheduler / cron / pm2. Verified: no OS-level registrations in the repo. | None |
| Secrets / env vars | New: `JWT_SECRET` (≥32 bytes, `openssl rand -hex 32`), `TOKEN_ENCRYPTION_KEY` (≥32 bytes), `RESEND_API_KEY`. Existing `GBRAIN_DATABASE_URL` / `SUPABASE_DB_URL_POOLER` reused for the app store. | Generate the two keys; add all three to Vercel + `.env.local` |
| Build artifacts / installed packages | `bun add jose resend` adds two `node_modules` entries + `bun.lock` changes. No stale artifacts. | `bun install` after the add; commit `bun.lock` |

**The DDL question (D-12 / how schema is applied):** the job table used
`scripts/setup-jobs-table.ts` — a standalone idempotent `CREATE SCHEMA / CREATE
TABLE IF NOT EXISTS` script, **not** a Supabase CLI migration file. **Follow that
precedent.** Create `scripts/setup-auth-tables.ts` mirroring `setup-jobs-table.ts`
(same URL resolution, `prepare:false`, the post-DDL visibility check). It is run
once manually (operator step) before the feature is exercised. The planner should
make running it an explicit precondition/task, not assume Next.js applies it.

## Common Pitfalls

### Pitfall 1: Assuming Spike 005's "RLS on 41/41 tables" means tenant isolation
**What goes wrong:** The plan writes AUTH-05's test against gbrain RLS; the test
either can't be written or passes vacuously (RLS is bypassed by the service role).
Two users' data is actually commingled.
**Why it happens:** "RLS enabled" sounds like "isolated." gbrain's RLS is anon-key
blocking with zero policies — a different thing entirely.
**How to avoid:** Adopt per-user `source_id` scoping; write AUTH-05 against the
application boundary; surface the D-11 contradiction to the user.
**Warning signs:** A PLAN task that says "verify RLS blocks User B" with no
`source_id` scoping anywhere; a query path that takes a tenant id from the URL.

### Pitfall 2: `postgres` client imported into Edge middleware
**What goes wrong:** Module-load crash — the `postgres` package needs Node APIs
unavailable in the Edge runtime.
**Why it happens:** Wanting full session validation in `middleware.ts`; on
15.3.2 middleware is Edge-only.
**How to avoid:** Middleware does cookie-presence only (no `lib/auth/store.ts`
import). Full validation lives in Node-runtime routes/pages (D-06).
**Warning signs:** `import ... from "@/lib/auth/store"` at the top of
`middleware.ts`; a build error mentioning `Buffer`/`net`/`dns` in middleware.

### Pitfall 3: SameSite cookie drops the session on the magic-link click
**What goes wrong:** User clicks the link in their email client (gmail.com →
quickbrain.vercel.app — cross-site). With `SameSite=Strict`, the browser omits
the cookie on that first navigation; the user lands logged-out.
**Why it happens:** `Strict` feels "more secure" so it gets picked by default.
**How to avoid:** `SameSite=Lax` (D-05). `Lax` sends the cookie on top-level
cross-site GET navigations — exactly the magic-link case.
**Warning signs:** Sign-in works in local dev (same-site) but fails when the
link is clicked from a real email.

### Pitfall 4: Magic-link prefetch consumes the token before the user clicks
**What goes wrong:** Some email clients / link scanners (Outlook Safe Links,
antivirus, corporate proxies) issue a `GET` on the link to scan it. If the verify
route consumes the token on `GET`, the scanner burns it and the real click shows
"already used."
**Why it happens:** The verify route is a `GET` (it must be — it's a link) and
consumes on first hit.
**How to avoid:** Two mitigations, pick per planner judgment: (a) the verify
`GET` consumes the token but renders a confirm page on first hit and only sets
the session on an explicit `POST`/button — robust but adds a click; or (b)
accept single-`GET` consume and lean on the clear "already used → resend" path
(D-07 already requires that resend path). For a v2.0 with a small user base, (b)
+ a friendly resend page is acceptable; document the tradeoff.
**Warning signs:** Users on corporate email reporting "link already used" on the
first click.

### Pitfall 5: Rate-limit state lost across serverless instances
**What goes wrong:** An in-memory `Map` rate-limiter resets on every Vercel cold
start and is per-instance; a user can request many magic links by hitting
different instances.
**Why it happens:** In-memory is the obvious first implementation.
**How to avoid:** D-09 — a `last_sent_at TIMESTAMPTZ` column checked with
`now() - last_sent_at < interval '60 seconds'`. Persisted, instance-independent.
**Warning signs:** AUTH-09 test passes locally (single process) but fails on the
deployed URL.

### Pitfall 6: `source_id` collides with gbrain's reserved `default` or exceeds 32 chars
**What goes wrong:** A generated `source_id` longer than 32 chars, or equal to
`default`, breaks gbrain's source rules or commingles a user with the seed.
**Why it happens:** `lib/gbrain/slug.ts` allows up to 40 chars; gbrain's source
id is `[a-z0-9-]{1,32}`.
**How to avoid:** Generate `u-<hex>` ≤32 chars; never emit `default`, `seed`,
or `host`. Validate against both rules.
**Warning signs:** gbrain throwing a source-id validation error; a new user
seeing Mara's Coffee data.

## Code Examples

### Session create / validate / destroy (opaque DB session, D-04)

```typescript
// lib/auth/session.ts — opaque session, server-side revocation
import { randomUUID } from "node:crypto";
// sql = postgres singleton from lib/auth/store.ts

export async function createSession(userId: string): Promise<string> {
  const id = randomUUID(); // 122-bit unguessable
  await sql`
    INSERT INTO app.sessions (id, user_id, expires_at)
    VALUES (${id}, ${userId}, now() + interval '30 days')
  `;
  return id;
}

export async function validateSession(id: string) {
  const rows = await sql`
    SELECT user_id FROM app.sessions
    WHERE id = ${id} AND expires_at > now()
  `;
  return rows[0]?.user_id ?? null; // null → unauthenticated
}

export async function destroySession(id: string): Promise<void> {
  await sql`DELETE FROM app.sessions WHERE id = ${id}`; // true revocation (AUTH-07)
}
```

### DB-backed rate limit (D-09 / AUTH-09)

```typescript
// In /api/auth/send-link, before issuing a token:
const recent = await sql`
  SELECT 1 FROM app.magic_links
  WHERE email = ${email}
    AND created_at > now() - interval '60 seconds'
  LIMIT 1
`;
if (recent.count > 0) {
  return Response.json({ error: "rate_limited" }, { status: 429 }); // do not send
}
```
(Or a dedicated `last_sent_at` column on `app.users` — both are valid; checking
the most-recent `magic_links` row avoids an extra column. Planner's call.)

### Session cookie (D-05)

```typescript
// In the verify route, after createSession():
import { cookies } from "next/headers";
const c = await cookies();
c.set("qb_session", sessionId, {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",                 // D-05: Lax — magic-link click is cross-site
  maxAge: 60 * 60 * 24 * 30,       // 30 days
  path: "/",
});
// Sign-out: c.set("qb_session", "", { maxAge: 0 })
```
`[CITED: nextjs.org/docs — cookies() set options]`

## State of the Art

| Old Approach (v1.x archived research) | Current Approach (v2.0) | Why Changed |
|---------------------------------------|-------------------------|-------------|
| `bun:sqlite` for users/tokens/rate-limits | Supabase Postgres `app` schema via `postgres` package | v2.0 is hosted on Vercel serverless — no persistent local filesystem; the job store already proved the Postgres `app`-schema pattern |
| Filesystem `brains/<slug>/` + `readdir` registry | `app.users` table as the registry | Vercel's filesystem is ephemeral; `readdir(BRAINS_ROOT)` sees zero tenants (the folded `tenant-registry-deploy-persistent` todo) |
| Stateless signed-JWT session | Opaque DB-backed session in `app.sessions` | Sign-out (AUTH-07) needs true server-side revocation; a JWT can't be revoked |
| gbrain via `child_process.spawn` of the CLI | gbrain in-process (`createEngine` + `hybridSearch`/`runThink`) | Phase 3 (INPROC) refactor — affects how Phase 6 scopes queries by `source_id` |
| ES256 in AUTH-02 wording | HS256 with single `JWT_SECRET` | Single-server app; ES256 is overkill; documented upgrade path |

**Deprecated / superseded for Phase 6:**
- **`bun:sqlite` everywhere in the v1.x research** — superseded by Supabase
  Postgres. Read the v1.x research for the *jose* patterns, the *atomic-consume*
  pattern, the *middleware* pattern, the *Resend* pattern, the *pitfall catalog*
  — all still valid. Ignore every `bun:sqlite` / `data/quickbrain-app.sqlite` /
  `PRAGMA` / `db.prepare().run()` detail.
- **D-11's "gbrain RLS isolates tenants"** — superseded by per-user `source_id`
  scoping (BLOCKING FINDING). D-11's *other* claim — app tables go in the `app`
  schema clear of the auto-RLS trigger — remains correct.
- **`proxy.ts` naming** — that is Next.js 16. This project is 15.3.2 → use
  `middleware.ts` + `export function middleware()`.

## Project Constraints (from CLAUDE.md)

CLAUDE.md is the hackathon-era doc (v1.0). STATE.md / CONTEXT.md / REQUIREMENTS.md
are the authoritative v2.0 sources where they differ. Still-binding directives:

- **Bun runtime end-to-end.** `bun add jose resend`, not npm. API routes pin
  `bun@1.2.0` via `vercel.json` (gbrain loads raw `.ts`).
- **Next.js 15 App Router**, single app, Route Handlers — no separate API server.
- **`zod`** validates any payload reaching a Route Handler — applies to
  `/api/auth/send-link` (the email body).
- **`app` schema** for app-owned Postgres tables — the auth tables follow the job
  store precedent (CLAUDE.md "Brain Schema Contract" / job-store convention).
- **API routes use `runtime = "nodejs"` + `dynamic = "force-dynamic"`** — gbrain's
  Postgres client and the `postgres` package are not Edge-compatible. New auth
  routes follow this.
- **GSD workflow enforcement** — file edits happen through a GSD command.
- **No background-job queue for short work** — the per-user provisioning is a
  single `sources` INSERT, well under the inline threshold; no Phase 5 job path.
- ⚠ **CLAUDE.md's "what NOT to use" table is hackathon-era** and partly stale
  (it predates the in-process refactor and Supabase migration). CLEAN-05 (Phase
  10) rewrites it. Do not treat its v1.0 stack table as a v2.0 constraint where
  STATE.md says otherwise.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `jose@6.x` and `resend@6.x` are current; exact patch versions unverified this session | Standard Stack | Low — APIs are stable across 6.x; planner re-runs `npm view` |
| A2 | slopcheck unavailable → `jose` + `resend` tagged `[ASSUMED]` despite being well-known | Package Legitimacy Audit | Low — both are canonical packages with manual evidence; planner gates with a `checkpoint:human-verify` |
| A3 | A `sources` INSERT + the already-migrated DB-wide gbrain schema means provisioning is fast enough to run inline in the verify route (no background job) | Pattern 4 | Medium — if `engine.initSchema()` must run per-request it would be slow; mitigated because Phase 2 already bootstrapped the schema DB-wide, so only the INSERT runs per user. Planner should add a quick spike to confirm `lib/gbrain/engine.ts` does not re-run schema bootstrap per source |
| A4 | gbrain's in-process `hybridSearch`/`runThink` accept a `sourceId` and apply `WHERE source_id` | BLOCKING FINDING; Isolation model | Medium-High — gbrain's `CLAUDE.md` documents `SearchOpts.sourceIds` and source-scoped reads, but `lib/gbrain/engine.ts` currently passes **no** `sourceId` to `hybridSearch`. The planner MUST include a task to thread `sourceId` through `lib/gbrain/engine.ts` + `client.ts`, and a spike to confirm the gbrain `@/types/gbrain` shim exposes the `sourceId` option on `hybridSearch`/`runThink` |
| A5 | Resend free tier = 100 emails/day, 3,000/month, one verified domain | Resend Free-Tier section | Low — confirmed by web search May 2026; daily cap may bite if the demo sends heavily |
| A6 | Magic-link prefetch by email scanners is a real risk for this user base | Pitfall 4 | Low-Medium — depends on which email providers real users use; D-07's resend path is the safety net regardless |
| A7 | The DDL is applied via a standalone `scripts/setup-auth-tables.ts` (job-table precedent), not a Supabase migration | Runtime State Inventory | Low — `setup-jobs-table.ts` is the verified in-repo precedent; if the team later adopts Supabase migrations this is a trivial port |

**These are exactly the items discuss-phase should confirm with the user before
the plan locks — A3 and A4 in particular gate the isolation architecture.**

## Open Questions

1. **AUTH-05 requirement wording vs. reality.**
   - What we know: AUTH-05 says isolation is "enforced at the database layer via
     gbrain's row-level security." gbrain RLS does not do per-user isolation.
   - What's unclear: whether the user wants AUTH-05's *wording* amended, or
     accepts source-scoping as the satisfying mechanism with a PLAN note.
   - Recommendation: surface to the user via discuss-phase. The cleanest outcome
     is amending AUTH-05 to "enforced by session-derived source-scoping" so the
     requirement and the implementation agree.

2. **Does `lib/gbrain/engine.ts` need a `source_id` retrofit, and how deep?**
   - What we know: `queryInProcess` / `think` currently key the engine pool by
     `tenantId` but pass **no** `sourceId` to `hybridSearch`/`runThink`. The
     seed brain is the single `default` source today.
   - What's unclear: the exact option name on the gbrain `@/types/gbrain` shim
     (`SearchOpts.sourceId` vs `sourceIds`), and whether `runThink` accepts a
     source scope at all.
   - Recommendation: a short (≤30 min) spike in the plan — grep the gbrain
     `hybridSearch`/`runThink` signatures in `node_modules/gbrain` and confirm
     the shim re-exports the source option. This is on the critical path for
     AUTH-05 and D-02.

3. **Resend verified domain readiness.**
   - What we know: STATE.md flags `RESEND_API_KEY` + a verified Resend domain as
     a **pending operator action**.
   - What's unclear: whether the operator has completed it.
   - Recommendation: a hard precondition task in the plan. Until the domain is
     verified, magic links can only go to addresses verified in the Resend
     dashboard (test mode) — AUTH-01's "magic link arrives within 5 seconds" to
     an arbitrary real address cannot be validated.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | All scripts + `bun add` | ✓ | 1.2.x (project pins `bun@1.2.0` for Vercel) | — |
| Supabase Postgres (pooler) | `app.users/sessions/magic_links` store | ✓ | Reused — `GBRAIN_DATABASE_URL` / `SUPABASE_DB_URL_POOLER` already in production for `app.jobs` | — |
| `postgres` npm package | App store | ✓ | gbrain transitive dep, already in `node_modules` | — |
| `jose` | Magic-link token | ✗ — not yet installed | — | `bun add jose` (one task) |
| `resend` | Email delivery | ✗ — not yet installed | — | `bun add resend` (one task) |
| `RESEND_API_KEY` + verified Resend domain | AUTH-01 | ✗ — **pending operator action** (STATE.md) | — | Test mode (`onboarding@resend.dev` to dashboard-verified recipients only) until the domain is verified — **blocks full AUTH-01 validation** |
| `JWT_SECRET` (≥32 bytes) | Magic-link signing | ✗ — must be generated | — | `openssl rand -hex 32`; add to Vercel + `.env.local` |
| `TOKEN_ENCRYPTION_KEY` (≥32 bytes) | QBO-token column (schema lands here) | ✗ — must be generated | — | `openssl rand -hex 32`; add to Vercel + `.env.local` |
| Vercel env config | All of the above in production | ⚠ — STATE.md: Production env config is **empty** ("all 13 app secrets must be added") | — | Operator adds every secret to Vercel before the deployed app works |

**Missing dependencies with no fallback (block execution):**
- `RESEND_API_KEY` + verified Resend domain — without it AUTH-01 cannot be
  validated end-to-end against a real email address. Operator step.
- Vercel Production env config is empty — the deployed app's auth flow will fail
  until `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY`, `RESEND_API_KEY`, `AUTH_ENABLED`
  (and the already-needed gbrain/Supabase secrets) are added.

**Missing dependencies with fallback:**
- `jose`, `resend` — `bun add` installs them; trivial.
- `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` — `openssl rand -hex 32` generates them.

## Resend Free-Tier Constraints

`[VERIFIED: web search, May 2026 — resend.com/pricing, resend.com/docs/knowledge-base/account-quotas-and-limits]`

- **Free tier:** 3,000 emails/month, **100 emails/day**, **one verified domain**,
  30-day email-log retention, basic webhooks.
- **The daily cap (100/day) is the binding constraint** for an auth flow — every
  sign-in and every resend is one email. Fine for v2.0 early users; watch it
  during heavy demo/testing sessions.
- **Verified domain requirement:** the free tier includes one verified domain.
  Until a custom domain is verified (SPF + DKIM DNS records, ~5–30 min
  propagation), Resend only delivers from `onboarding@resend.dev` to recipients
  **verified in the Resend dashboard** — i.e. test mode. Sending magic links to
  arbitrary real user addresses **requires** the verified domain. This is the
  STATE.md "pending operator action."
- **`resend` SDK on Bun:** pure HTTP, no native bindings — runs cleanly on the
  Bun runtime; `new Resend(process.env.RESEND_API_KEY!)` as a module-level
  singleton in a Node-runtime Route Handler.
- **Latency:** the `resend.emails.send()` call returns in ~200–500ms (it queues
  the send via Amazon SES). AUTH-01's "within 5 seconds" is the API-call
  completion, not inbox arrival; inbox delivery is typically a few seconds more.

## Sources

### Primary (HIGH confidence)
- `node_modules/gbrain/src/schema.sql` — gbrain Postgres DDL: the `sources` table
  (multi-brain-in-one-DB partition), `pages`/`content_chunks` columns (no tenant
  column), the RLS `DO $$` block (ENABLE-only, no policies, `BYPASSRLS` bypass).
- `node_modules/gbrain/docs/guides/rls-and-you.md` — gbrain's RLS posture in its
  own words: "deny-by-default to anon, full access for the service role."
- `node_modules/gbrain/docs/architecture/brains-and-sources.md` — the brain
  (database) vs source (in-DB partition) model.
- `node_modules/gbrain/CLAUDE.md` — `BrainEngine` source-scoped search
  (`SearchOpts.sourceIds`, `sourceScopeOpts`), engine factory, in-process API.
- `node_modules/gbrain/src/core/sources-ops.ts` — `addSource()` implementation
  (the `INSERT INTO sources` shape for provisioning).
- `lib/jobs/store.ts`, `scripts/setup-jobs-table.ts` (in-repo) — the verified
  Supabase `app`-schema + `postgres` pooler pattern to mirror.
- `lib/gbrain/engine.ts`, `client.ts`, `tenants.ts`, `slug.ts` (in-repo) — current
  brain construction; confirms no `sourceId` is passed to `hybridSearch` today.
- `.planning/archive/v1.x/phases/05-.../05-RESEARCH.md` — jose/atomic-consume/
  middleware/Resend patterns + pitfall catalog (reuse, minus `bun:sqlite`).

### Secondary (MEDIUM confidence)
- WebSearch (May 2026) verified against resend.com — Resend free-tier limits.
- nextjs.org docs (cited via v1.x research) — `middleware.ts` vs `proxy.ts`,
  Node-runtime middleware stable in 15.5, `cookies()` set options.
- npmjs.com/package/jose — `SignJWT`/`jwtVerify`/`errors` API shape.

### Tertiary (LOW confidence — flagged for validation)
- Exact current patch versions of `jose` / `resend` — re-verify with `npm view`.
- Magic-link prefetch behavior across specific email providers (Pitfall 4) —
  general industry knowledge, not measured for this user base.

## Metadata

**Confidence breakdown:**
- gbrain multi-tenant model (the BLOCKING FINDING): **HIGH** — read directly from
  gbrain's own `schema.sql`, `rls-and-you.md`, `brains-and-sources.md`.
- Auth stack (`jose`, `resend`, opaque session, `app` schema): **HIGH** —
  patterns proven in `lib/jobs/store.ts`; libraries are canonical.
- Next.js 15.3.2 middleware split: **HIGH** — version verified in `package.json`;
  Edge-default + Node-runtime-in-15.5 confirmed.
- `lib/gbrain` `source_id` retrofit depth: **MEDIUM** — gbrain supports it, but
  the exact shim option name + `runThink` source-scope support need a spike
  (Open Question 2).
- Resend free-tier numbers: **MEDIUM** — web-search confirmed, may shift.

**Research date:** 2026-05-22
**Valid until:** ~2026-06-21 for the auth stack (stable); re-check `jose`/`resend`
versions and Resend pricing if planning slips past 7 days. The gbrain findings
are pinned to the SHA-locked `gbrain@github:garrytan/gbrain#3933eb6` dependency
and stay valid as long as that pin holds.
