# Phase 6: Auth + Multi-Tenant Isolation - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Email magic-link authentication plus enforced multi-tenant isolation. A real
user signs in with their email, has exactly one brain auto-provisioned and
persisted across devices, and is provably unable to reach another user's data.

This phase delivers:

1. **Magic-link sign-in** — email → Resend magic link → clicking it establishes
   a session (AUTH-01, AUTH-02).
2. **Persistent sessions** — a 30-day session cookie survives browser/device
   changes; a user can sign out (AUTH-03, AUTH-07).
3. **Per-user brain provisioning** — first sign-in auto-provisions exactly one
   brain; sign-in always routes the user to that brain (AUTH-04).
4. **A deploy-persistent tenant registry** — the user↔brain mapping lives in
   Supabase Postgres, replacing the filesystem `brains/<slug>/` registry that
   breaks on stateless serverless.
5. **Multi-tenant isolation** — User A cannot query/read/list User B's data;
   the block is enforced at the database layer via gbrain RLS (AUTH-05).
6. **Route protection** — routes that expose tenant data redirect
   unauthenticated requests to sign-in (AUTH-06).
7. **Abuse control** — magic-link requests are rate-limited per email (AUTH-09);
   the user store lives in Supabase Postgres (AUTH-08).

**Not this phase:** the QBO OAuth flow itself (Phase 7 — only the encrypted
QBO-token *columns* land here), removing the `AUTH_ENABLED=0` bypass or the
synthetic seed (Phase 9), team/sharing, and GDPR export/deletion (v2.1). Phase 6
gates the door; nothing reaches a real user before it.

</domain>

<decisions>
## Implementation Decisions

All decisions below were auto-selected (`--auto` mode) using the recommended
option. They are defaults the planner may refine with research, not hard locks.

### Tenant Resolution & Registry
- **D-01:** Replace the filesystem `brains/<slug>/` + `readdir(BRAINS_ROOT)`
  registry (`lib/gbrain/tenants.ts`) with a Supabase Postgres-backed registry.
  The `users` table **is** the registry — one row per user carrying the
  user↔brain mapping (`brain_slug` / `brain_id`). Tenant identity resolves from
  the authenticated session, not from a URL slug or a disk scan. Mirror the
  `app` schema + `postgres` pooler pattern from `lib/jobs/store.ts`. Rejected: a
  separate `app.tenants` table — AUTH-04 ("each user has exactly one brain")
  makes the user row sufficient.

### Brain Provisioning
- **D-02:** A brand-new user gets a fresh **empty** brain auto-provisioned on
  first sign-in — **not** a copy of the synthetic Mara's Coffee seed.
  Provisioning no longer copies `brains/seed/` on disk; it registers a per-user
  brain namespace in Supabase Postgres. Real users fill their brain via QBO
  ingest (Phase 7). An empty brain has nothing to chat about until Phase 7 —
  that is acceptable; Phase 6 delivers auth + isolation, not data.
- **D-03:** The existing seed/demo tenant stays reachable **only** behind the
  dev-only `AUTH_ENABLED=0` bypass; it is never provisioned for real users.
  Phase 6 introduces `AUTH_ENABLED` (default `1` / on); Phase 9 (CLEAN-03)
  deletes the `0` path.

### Session Model & Sign-Out
- **D-04:** DB-backed sessions. The session cookie carries an opaque,
  unguessable random session ID; the session record (id, user, expiry) lives in
  an `app.sessions` table in Supabase Postgres (satisfies AUTH-08 literally).
  Sign-out deletes the session row — true server-side revocation (AUTH-07).
  Rejected: a stateless signed-JWT session cookie — sign-out cannot truly revoke
  it server-side. `jose` is still used to sign the **magic-link** token
  (AUTH-01/02), not the session.
- **D-05:** Session cookie shape carried forward from v1.x archived auth:
  `HttpOnly` + `Secure` + `SameSite=Lax` + 30-day `maxAge`, cookie name
  `qb_session`. `SameSite=Lax` (not `Strict`) so the cross-site navigation from
  the email client works. Cleared on sign-out via `maxAge: 0`.
- **D-06:** Auth gating runs in a new `middleware.ts`. Middleware does a coarse
  session-cookie-presence check and redirects unauthenticated requests to
  `/sign-in`; full session validation (the `app.sessions` DB lookup) happens in
  the Node-runtime route handlers/pages that touch tenant data. Researcher to
  confirm the cleanest Node-vs-Edge middleware split (Vercel middleware now
  supports the Node runtime).

### Magic-Link & Sign-In UX
- **D-07:** Magic-link token TTL = **15 minutes** (v1.x archived precedent).
  Single-use, enforced **atomically** — a single `UPDATE ... WHERE used=false`
  with a row-count check, never SELECT-then-UPDATE (TOCTOU race). A second or
  expired click shows a clear "link already used / expired" page with a
  one-click resend path (AUTH-02, ROADMAP criterion 2).
- **D-08:** Sign-in **replaces** the hackathon `/onboard` business-name form.
  First sign-in auto-provisions the brain with no business-name step — there is
  no form to fill. The `/` landing CTA and `/onboard` page are repurposed toward
  `/sign-in`. The business name is not collected in Phase 6 (it can be derived
  from QBO company info in Phase 7). New routes: `/sign-in`, a magic-link verify
  route, and a post-sign-in redirect to the user's `/dash/[brain]`.
- **D-09:** Rate limiting (1 magic-link request per email per 60s, AUTH-09) is
  **DB-backed** — a `last_sent_at` timestamp checked on the user / magic-link
  row. In-memory rate-limit state does not survive serverless cold starts or
  multiple instances, so it must be persisted.

### Schema — QBO Prep
- **D-10:** The `users` table includes nullable QBO columns now —
  `qbo_realm_id` and `qbo_tokens_encrypted` — populated in Phase 7. The
  encrypted-token schema lands here per the ROADMAP Phase 6 precondition
  (`TOKEN_ENCRYPTION_KEY` ≥32 bytes). This is not scope creep — it is explicitly
  in the phase precondition; only the *columns* land, the OAuth flow is Phase 7.

### Multi-Tenant Isolation (REVISED 2026-05-22 — research + user decision superseded the original D-11)
- **D-11:** Cross-tenant isolation uses **per-user gbrain `source_id`
  partitioning + application-enforced scoping**. Each user's brain = one row in
  gbrain's `sources` table inside the shared Supabase Postgres DB; the
  `source_id` IS the brain identity (stored on the `users` registry row — this
  is what D-01's `brain_id` resolves to). Every gbrain query/think call is
  hard-scoped to the authenticated user's `source_id`, resolved exactly once
  from the verified session in a single `lib/auth/resolve-tenant.ts` chokepoint
  — never from request input. **NOT gbrain RLS:** Phase 6 research
  (`06-RESEARCH.md` BLOCKING FINDING) found gbrain's auto-enabled RLS only
  denies the Supabase anon key — there are zero per-user policies, and
  QuickBrain connects as the `BYPASSRLS` service role, so RLS provides no
  inter-tenant isolation. The isolation boundary is the application. App-owned
  tables (`app.users`, `app.sessions`, `app.magic_links`) still live in the
  `app` schema, clear of gbrain's auto-RLS event trigger.

### gbrain Chat-Path Patch (NEW 2026-05-22 — from research spike addendum + user decision)
- **D-12:** gbrain's `think` path (the chat surface — `lib/gbrain/client.ts::think`
  → `runThink`) does **not** accept a `source_id` scope: `RunThinkOpts`,
  `ThinkGatherOpts`, and `runGather` carry no source field, so chat would
  synthesize over every user's pages. Phase 6 **patches gbrain via
  `patch-package`** to thread `sourceId` through `RunThinkOpts` → `runThink` →
  `ThinkGatherOpts` → `runGather` and into its `hybridSearch` / `searchTakes`
  calls (~10–15 mechanical lines; the primitives already accept `sourceId`). A
  committed `patch-package` patch against the SHA-pinned `gbrain` dependency was
  chosen (user decision) over a fork (maintenance cost) or an upstream PR
  (maintainer-timeline dependency). The query/retrieval path needs no patch —
  `hybridSearch` already accepts `sourceId` natively. See `06-RESEARCH.md`
  §Spike Addendum.

### Claude's Discretion
- Exact table and column names, the verify-route path name, the magic-link
  email HTML template, the resend-page layout, polling/UI specifics, and the
  precise Node-vs-Edge middleware split — all left to research/planning.

### Folded Todos
- **`tenant-registry-deploy-persistent`** (`.planning/todos/pending/`) — the
  filesystem-based tenant registry (`lib/gbrain/tenants.ts` rebuilds via
  `readdir(BRAINS_ROOT)`) sees zero tenants on Vercel's stateless filesystem, so
  every `POST /api/tenants/<id>/chat` returns `404 tenant_not_found`. Tagged
  `resolves_phase: 6`. Folded into D-01: the Postgres-backed registry is this
  phase's deliverable. Verification: a deployed-URL chat call returns a real
  gbrain answer, not `tenant_not_found`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + requirements
- `.planning/ROADMAP.md` §"Phase 6: Auth + Multi-Tenant Isolation" — phase goal,
  the 7 success criteria, AUTH-01..09 mapping, the precondition block
  (`RESEND_API_KEY` + verified domain, `JWT_SECRET` ≥32 bytes,
  `TOKEN_ENCRYPTION_KEY` ≥32 bytes), and the Context block (Spike 005 RLS
  finding, auth stack = `jose` + Supabase Postgres + Resend, HS256 rationale).
  "UI hint: yes".
- `.planning/REQUIREMENTS.md` §AUTH — AUTH-01..09 full text.

### Carried-forward auth context (v1.x — superseded where noted)
- `.planning/archive/v1.x/phases/05-email-magic-link-auth-persistent-tenants/05-CONTEXT.md`
  — archived locked decisions: HS256 `jose`, the session-cookie shape (D-04
  there), the atomic single-use token via `UPDATE WHERE used=0` (D-06 there),
  `middleware.ts` route protection, QBO column prep (D-07 there). **SUPERSEDED:**
  the user store is Supabase Postgres, **not** `bun:sqlite` (v2.0 is hosted, not
  a single-laptop demo).
- `.planning/archive/v1.x/phases/05-email-magic-link-auth-persistent-tenants/05-RESEARCH.md`
  — auth research: Resend SPF/DKIM domain setup, magic-link pitfall catalog
  (SameSite navigation, TOCTOU on token use, middleware naming/runtime). Read
  for the pitfall list; reconcile against the v2.0 Supabase store.

### Tenant registry migration
- `.planning/todos/pending/tenant-registry-deploy-persistent.md` — **FOLDED**
  into this phase (see D-01). The filesystem registry breaks on stateless
  serverless; replace it with the Supabase-backed registry.

### Spike + project context
- `.planning/spikes/MANIFEST.md` §Spike 005 (`gbrain-on-supabase`) — confirmed
  `gbrain migrate --to supabase` is lossless and RLS stays intact (41/41
  tables). The basis for the gbrain-RLS isolation decision (D-11).
- `.claude/skills/spike-findings-quick-brain/SKILL.md` — Resend is the locked,
  single email provider; a future v1.2 unsubscribe-token shape is planned to
  reuse this phase's magic-link token signing (a forward dependency to keep in
  mind, not Phase 6 work).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/jobs/store.ts` — the canonical Supabase Postgres app-table pattern:
  module-level `postgres()` singleton, `prepare:false` (Supavisor pooler, port
  6543), the `app` schema (not `public` — hedges gbrain's auto-RLS event
  trigger), tagged-template parameterized SQL, error sanitization. The new
  `app.users` / `app.sessions` / `app.magic_links` store mirrors this exactly.
- `lib/gbrain/slug.ts` — `isValidTenantSlug` / `tenantSlugSchema`, reusable for
  brain-slug validation on the registry rows.
- `lib/onboarding/orchestrator.ts` + `lib/gbrain/onboard.ts` — the existing
  provisioning flow; per-user empty-brain provisioning on first sign-in adapts
  this.

### Established Patterns
- API routes use `runtime = "nodejs"` + `dynamic = "force-dynamic"` (gbrain's
  Postgres client is not edge-compatible); `vercel.json` pins `bun@1.2.0` for
  `app/api/**`. New auth routes follow this.
- App-owned data goes in a separate `app` schema in the same Supabase Postgres
  (job store precedent) — the auth tables follow the same isolation choice.

### Integration Points
- `lib/gbrain/tenants.ts` — the in-memory + `readdir(BRAINS_ROOT)` registry;
  **replaced** by the Postgres-backed registry (D-01). Its `get()` / `list()` /
  `upsert()` / `reload()` callers in `app/api/tenants/[id]/*` must be updated.
- `lib/onboarding/create-tenant.ts` — copies `brains/seed/` on disk and
  upserts the in-memory Map; replaced by per-user empty-brain provisioning (D-02).
- `app/api/tenants/[id]/{chat,insights,onboard,reset}/route.ts` — all four
  return `tenant_not_found`; they must move to authenticated-session resolution.
- `app/page.tsx` + `app/onboard/page.tsx` — hackathon landing + onboarding form;
  repurposed toward `/sign-in` (D-08).
- No `middleware.ts` exists yet — Phase 6 creates it.
- No `lib/auth/` directory exists yet — Phase 6 creates it.
- No `resend` or `jose` dependency is installed yet — package adds required.

</code_context>

<specifics>
## Specific Ideas

**RESOLVED (2026-05-22) — gbrain multi-tenant model.** Research + a read-only
spike established it: gbrain RLS does NOT isolate tenants (it only denies the
anon key); the viable model is per-user `source_id` partitioning (see revised
D-11). The `think`/chat path additionally needs a `patch-package` patch to
accept the scope (see D-12). Full evidence in `06-RESEARCH.md` (BLOCKING
FINDING + Spike Addendum). The remaining operator precondition below still
stands.

Also confirm: Resend free-tier sending limits and whether the operator's
verified Resend domain is ready (the `RESEND_API_KEY` precondition is an
operator action still flagged pending in STATE.md).

</specifics>

<deferred>
## Deferred Ideas

- **ES256 JWT key-pair** — HS256 is the v2.0 choice (single `JWT_SECRET`, works
  everywhere); ES256 is a comment-documented upgrade path. Carried from archived
  v1.x D-01.
- **Team / multi-user-per-brain sharing** (owner + accountant on one brain) —
  explicitly v2.1 (PROJECT.md out of scope).
- **Account self-service data export + deletion (GDPR)** — v2.1; lands with
  go-to-market (REQUIREMENTS.md future requirements).
- **The QBO OAuth flow** — Phase 7. Only the encrypted-token *columns* land in
  Phase 6 (D-10).
- **Removing the `AUTH_ENABLED=0` bypass and the synthetic Mara's Coffee seed
  from the runtime path** — Phase 9 (CLEAN-02 / CLEAN-03).

</deferred>

---

*Phase: 6-Auth + Multi-Tenant Isolation*
*Context gathered: 2026-05-22*
