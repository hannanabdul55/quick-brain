# Phase 6: Auth + Multi-Tenant Isolation - Pattern Map

**Mapped:** 2026-05-22
**Files analyzed:** 18 (13 new, 5 modified)
**Analogs found:** 15 / 18 (3 net-new with no in-repo analog)

This map tells the planner which existing file each Phase 6 file should copy
patterns from. Excerpts are concrete (file path + line numbers). The file list
is taken from RESEARCH.md §"Recommended Project Structure" and CONTEXT.md
decisions D-01..D-12.

---

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `lib/auth/store.ts` | NEW | service (data store) | CRUD | `lib/jobs/store.ts` | exact |
| `lib/auth/tokens.ts` | NEW | utility | transform | `lib/gbrain/slug.ts` (zod-util shape) + RESEARCH Pattern 3 | role-match |
| `lib/auth/session.ts` | NEW | service | CRUD | `lib/jobs/store.ts` (CRUD fns over `sql`) | role-match |
| `lib/auth/resolve-tenant.ts` | NEW | service (chokepoint) | request-response | `lib/gbrain/slug.ts::assertTenantSlug` + `lib/auth/session.ts` | partial |
| `lib/auth/email.ts` | NEW | service (external I/O) | request-response | `lib/inngest/client.ts` (module-level client singleton) | role-match |
| `lib/auth/schemas.ts` | NEW | utility (validation) | transform | `lib/chat/schemas.ts` / `lib/jobs/schemas.ts` | exact |
| `scripts/setup-auth-tables.ts` | NEW | config (DDL) | batch | `scripts/setup-jobs-table.ts` | exact |
| `app/api/auth/send-link/route.ts` | NEW | route (controller) | request-response | `app/api/jobs/route.ts` | exact |
| `app/api/auth/sign-out/route.ts` | NEW | route (controller) | request-response | `app/api/jobs/route.ts` | role-match |
| `app/auth/verify/route.ts` | NEW | route (controller) | request-response | `app/api/jobs/route.ts` + `app/api/tenants/[id]/chat/route.ts` | role-match |
| `app/sign-in/page.tsx` | NEW | component (page) | event-driven (form) | `app/onboard/page.tsx` | exact |
| `app/auth/link-used/page.tsx` | NEW | component (page) | event-driven (form) | `app/onboard/page.tsx` | role-match |
| `components/auth/sign-out-button.tsx` | NEW | component | event-driven | `components/onboard/error-banner.tsx` + `components/jobs/job-progress.tsx` | role-match |
| `middleware.ts` | NEW | middleware | request-response | **none in repo** | no analog |
| `patches/gbrain+*.patch` | NEW | config (tooling) | n/a | **none in repo** (no `patches/` dir) | no analog |
| `lib/gbrain/tenants.ts` | MODIFIED | service (registry) | CRUD | self → rewrite toward `lib/jobs/store.ts` | exact |
| `lib/gbrain/engine.ts` | MODIFIED | service | request-response | self (thread `sourceId`) | self |
| `lib/gbrain/client.ts` | MODIFIED | service | request-response | self (thread `sourceId`) | self |
| `app/page.tsx` | MODIFIED | component (page) | static | self (one-line CTA change) | self |
| `app/dash/[id]/page.tsx` | MODIFIED | component (page) | request-response | self (add session gate) | self |
| `app/api/tenants/[id]/{chat,insights,onboard,reset}/route.ts` | MODIFIED | route | request-response | self (add `resolve-tenant` gate) | self |
| `package.json` | MODIFIED | config | n/a | self (`bun add jose resend`) | self |

---

## Shared Patterns

These cross-cut multiple Phase 6 files. The planner should apply them in every
plan that touches the relevant file class.

### Shared Pattern A — Supabase Postgres `app`-schema store

**Source:** `lib/jobs/store.ts` (lines 23-48)
**Apply to:** `lib/auth/store.ts`, `lib/auth/session.ts`, `scripts/setup-auth-tables.ts`

Module-level `postgres()` singleton, `prepare:false` (mandatory for the
Supavisor pooler on port 6543), explicit URL guard before the cast, all tables
in the `app` schema (not `public` — hedges gbrain's auto-RLS event trigger).
`postgres` is a gbrain transitive dep — **already in `node_modules`, no `bun add`.**

```typescript
// lib/jobs/store.ts:23-48 — copy this header verbatim into lib/auth/store.ts
import postgres, { type JSONValue } from "postgres";

const databaseUrl =
  process.env.GBRAIN_DATABASE_URL ?? process.env.SUPABASE_DB_URL_POOLER;
if (!databaseUrl) {
  throw new Error(
    "lib/jobs/store.ts: GBRAIN_DATABASE_URL or SUPABASE_DB_URL_POOLER must be set",
  );
}

const sql = postgres(databaseUrl, {
  // prepare:false is MANDATORY — port 6543 is Supavisor pooler, not direct Postgres.
  prepare: false,
});
```

`lib/auth/store.ts` owns the one `sql` singleton; `lib/auth/session.ts` imports
it from `store.ts` rather than constructing a second client.

### Shared Pattern B — Tagged-template parameterized SQL (no string-concat)

**Source:** `lib/jobs/store.ts` (lines 81-91, 170-175)
**Apply to:** every query in `lib/auth/store.ts` and `lib/auth/session.ts`

```typescript
// lib/jobs/store.ts:81-91 — INSERT ... RETURNING with a no-row guard
const rows = await sql<{ id: string }[]>`
  INSERT INTO app.jobs (kind, params)
  VALUES (${kind}, ${sql.json(params as unknown as JSONValue)})
  RETURNING id
`;
const row = rows[0];
if (!row) {
  throw new Error(`createJob: INSERT returned no row for kind=${kind}`);
}
return row.id;
```

```typescript
// lib/jobs/store.ts:170-175 — SELECT-by-id returning row|null
const rows = await sql<JobRow[]>`
  SELECT * FROM app.jobs WHERE id = ${jobId}
`;
return rows[0] ?? null;
```

**Critical for D-07 (atomic single-use magic-link consume):** use the postgres.js
`.count` on the result array — never SELECT-then-UPDATE. RESEARCH Pattern 2:

```typescript
const rows = await sql`
  UPDATE app.magic_links
  SET used = true, used_at = now()
  WHERE jti = ${jti} AND used = false AND expires_at > now()
  RETURNING email
`;
if (rows.count === 0) { /* already used / expired / not found */ }
```

### Shared Pattern C — Error sanitization before storing/logging

**Source:** `lib/jobs/store.ts` (lines 148-162) and `scripts/setup-jobs-table.ts` (lines 147-154)
**Apply to:** `lib/auth/store.ts` writes, all three route handlers, `scripts/setup-auth-tables.ts`

```typescript
// lib/jobs/store.ts:152-156 — truncate + strip postgres:// URLs before persist
const sanitized = error
  .slice(0, 500)
  .replace(/postgres:\/\/[^\s]+/gi, "[redacted]");
```

```typescript
// scripts/setup-jobs-table.ts:148-154 — never echo the DB URL on a thrown error
.catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  const safe = msg.replace(/postgres:\/\/[^\s]+/gi, "[redacted]");
  console.error("[setup-jobs-table] FATAL:", safe);
  process.exit(1);
})
```

Auth additionally must **never log email addresses or tokens** — mirror the
`chat/route.ts:101` precedent ("Log metadata only — do NOT log the question text").

### Shared Pattern D — Route Handler runtime/dynamic exports + zod-first body parse

**Source:** `app/api/jobs/route.ts` (lines 24-26, 32-54) and `app/api/tenants/[id]/chat/route.ts` (lines 41-42, 73-87)
**Apply to:** `app/api/auth/send-link/route.ts`, `app/api/auth/sign-out/route.ts`, `app/auth/verify/route.ts`

Every gbrain/postgres-touching Route Handler MUST declare both exports — the
`postgres` client is not Edge-compatible:

```typescript
// app/api/jobs/route.ts:24-26
// Prevent Next.js static optimization — this route has side effects.
export const dynamic = "force-dynamic";
// nodejs runtime: lib/jobs/store.ts imports postgres, which is not edge-compatible.
export const runtime = "nodejs";
```

Body-parse → zod-validate → act, with a try/catch around `req.json()`:

```typescript
// app/api/jobs/route.ts:33-54
let body: unknown;
try {
  body = await req.json();
} catch {
  return Response.json(
    { error: "validation_failed", issues: [{ message: "invalid JSON body" }] },
    { status: 400 },
  );
}
const parsed = jobRequestSchema.safeParse(body);
if (!parsed.success) {
  return Response.json(
    { error: "validation_failed", issues: parsed.error.issues },
    { status: 400 },
  );
}
```

`app/auth/verify/route.ts` is a `GET` (it is a clicked link) — it reads
`request.nextUrl.searchParams.get("token")` instead of a JSON body, but keeps
the same runtime/dynamic exports and the same `Response.json(..., {status})`
error shape. RESEARCH Pitfall 4 (email-scanner prefetch consuming the token)
applies to this route.

### Shared Pattern E — `sourceId` chokepoint applied to gbrain calls

**Source:** D-11 / D-12, RESEARCH "Anti-Patterns to Avoid"
**Apply to:** `lib/auth/resolve-tenant.ts` (the chokepoint itself), `lib/gbrain/engine.ts`,
`lib/gbrain/client.ts`, all four `app/api/tenants/[id]/*` routes

Tenant identity (`source_id`) is resolved **exactly once** from the verified
`app.sessions` row in `lib/auth/resolve-tenant.ts`. No route handler and no
`lib/gbrain/*` function ever accepts a `source_id` (or tenant slug) from request
input. Routes take a session cookie, resolve the source, then pass it down.

---

## Pattern Assignments

### `lib/auth/store.ts` (service, CRUD) — NEW

**Analog:** `lib/jobs/store.ts` (exact match — same role, same data flow)

Copy the file header (Shared Pattern A) and the CRUD function shape verbatim.
This file owns `app.users` / `app.sessions` / `app.magic_links` CRUD.

- **Imports + singleton:** `lib/jobs/store.ts:23-48` — copy verbatim, retitle.
- **Row types:** `lib/jobs/store.ts:53-64` — define `UserRow`, `SessionRow`,
  `MagicLinkRow` the same way (reflecting `setup-auth-tables.ts` DDL columns).
- **INSERT...RETURNING with no-row guard:** `lib/jobs/store.ts:81-91`.
- **UPDATE by id:** `lib/jobs/store.ts:97-103`.
- **SELECT row|null:** `lib/jobs/store.ts:170-175`.
- **Atomic single-use consume (D-07):** Shared Pattern B `.count` excerpt.
- **DB-backed rate-limit query (D-09 / AUTH-09):** RESEARCH "Code Examples" —
  `SELECT 1 FROM app.magic_links WHERE email=${email} AND created_at > now() - interval '60 seconds'`.

### `lib/auth/session.ts` (service, CRUD) — NEW

**Analog:** `lib/jobs/store.ts` (role-match — small CRUD module over the shared `sql`)

`createSession` / `validateSession` / `destroySession`, opaque random ID via
`node:crypto`. Imports the `sql` singleton from `lib/auth/store.ts` (do not
construct a second `postgres()` client). RESEARCH "Code Examples" gives the
exact three-function body:

```typescript
import { randomUUID } from "node:crypto";
// sql imported from lib/auth/store.ts

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
    SELECT user_id FROM app.sessions WHERE id = ${id} AND expires_at > now()
  `;
  return rows[0]?.user_id ?? null;
}
export async function destroySession(id: string): Promise<void> {
  await sql`DELETE FROM app.sessions WHERE id = ${id}`; // true revocation (AUTH-07)
}
```

`randomUUID` precedent: gbrain's `id uuid DEFAULT gen_random_uuid()` in
`scripts/setup-jobs-table.ts:71` is the DB-side equivalent; here the app
generates the opaque ID itself.

### `lib/auth/tokens.ts` (utility, transform) — NEW

**Analog:** `lib/gbrain/slug.ts` (role-match — small pure-utility module with a
zod-style export surface) + RESEARCH Pattern 3 for the `jose` body.

`issueMagicToken` / `verifyMagicToken` using `jose` HS256 (15-min TTL, D-07).
RESEARCH Pattern 3 is the canonical body. Mirror `slug.ts`'s shape: a tightly-
scoped module exporting 2-3 pure functions, a module-level constant, and typed
results. `errors.JWTExpired` → `reason: "expired"`; anything else → `"invalid"`.

`jose` is a **new dependency** — `bun add jose` (RESEARCH Standard Stack;
gate behind a `checkpoint:human-verify` per the Package Legitimacy Audit).

### `lib/auth/resolve-tenant.ts` (service chokepoint, request-response) — NEW

**Analog:** `lib/gbrain/slug.ts::assertTenantSlug` (lines 21-27) for the
assert-or-throw shape; consumes `lib/auth/session.ts::validateSession`.

This is the **single isolation chokepoint** (D-11, RESEARCH defense-in-depth #1).
It takes the `qb_session` cookie value, calls `validateSession`, then reads
`app.users.brain_id` (= `source_id`) for that user. It NEVER accepts a tenant
id / source id as an argument. Shape to mirror:

```typescript
// lib/gbrain/slug.ts:21-27 — assert-or-throw chokepoint shape
export function assertTenantSlug(s: string): string {
  const r = tenantSlugSchema.safeParse(s);
  if (!r.success) {
    throw new Error(`Invalid tenant slug: ${r.error.issues[0]?.message ?? "unknown"}`);
  }
  return r.data;
}
```

`resolve-tenant.ts` returns `{ userId, sourceId }` or a sentinel that the route
maps to a redirect/401. RESEARCH Anti-Pattern: "Routes take a session, not a
tenant id."

### `lib/auth/email.ts` (service, external I/O) — NEW

**Analog:** `lib/inngest/client.ts` (role-match — module-level external-SDK
client singleton; same pattern as `inngest` in `app/api/jobs/route.ts:28`).

Module-level `new Resend(process.env.RESEND_API_KEY)` singleton + a
`sendMagicLink(email, url)` function with the magic-link HTML template
(template HTML is Claude's Discretion per CONTEXT.md). `resend` is a **new
dependency** — `bun add resend`, gate behind `checkpoint:human-verify`.

### `lib/auth/schemas.ts` (utility, validation) — NEW

**Analog:** `lib/chat/schemas.ts` (exact match) / `lib/jobs/schemas.ts` (exact match)

The ~12-15 line `z.object` + `z.infer` pattern. The send-link body is a single
email field:

```typescript
// lib/chat/schemas.ts:10-14 — copy this exact shape
export const chatQuestionSchema = z.object({
  question: z.string().min(1, "Question cannot be empty").max(500, "..."),
});
export type ChatQuestion = z.infer<typeof chatQuestionSchema>;
```

For Phase 6: `sendLinkBodySchema = z.object({ email: z.string().email(), next: z.string().optional() })`.
The `?next=` value must be validated same-origin server-side (UI-SPEC
Accessibility Contract) — a `.startsWith("/")` + no-`//` check.

### `scripts/setup-auth-tables.ts` (config DDL, batch) — NEW

**Analog:** `scripts/setup-jobs-table.ts` (exact match — copy the entire structure)

Idempotent `CREATE SCHEMA IF NOT EXISTS app` + `CREATE TABLE IF NOT EXISTS`
for `app.users`, `app.sessions`, `app.magic_links`. Copy verbatim:

- **URL guard + exit(1):** `setup-jobs-table.ts:31-40`.
- **`prepare:false` connection:** `setup-jobs-table.ts:47-48`.
- **`CREATE SCHEMA IF NOT EXISTS app`:** `setup-jobs-table.ts:54`.
- **`CREATE TABLE IF NOT EXISTS app.<name>` block:** `setup-jobs-table.ts:69-82`
  — note `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (line 71). The
  `app.users` table carries the nullable QBO columns `qbo_realm_id` /
  `qbo_tokens_encrypted` per D-10, plus `brain_id`/`brain_slug` (= `source_id`),
  `email UNIQUE`, `created_at`, and a `last_sent_at` rate-limit column (D-09).
  `app.sessions` carries `id`, `user_id`, `expires_at`. `app.magic_links`
  carries `jti`, `email`, `used` (bool), `used_at`, `expires_at`, `created_at`.
- **`CREATE INDEX IF NOT EXISTS`:** `setup-jobs-table.ts:86` (index `app.sessions.user_id`,
  `app.magic_links.email`).
- **RLS-visibility probe (Pitfall 4 / T-05-08):** `setup-jobs-table.ts:89-140`
  — INSERT a probe row, SELECT it from a fresh `postgres(..., {max:1})`
  connection, fail loudly if zero rows. Copy this whole block.
- **Sanitized fatal handler:** `setup-jobs-table.ts:147-158`.

Add to `package.json` scripts as `"setup-auth-tables": "bun scripts/setup-auth-tables.ts"`
mirroring no equivalent yet for jobs — RESEARCH says run once as an operator
precondition task.

### `app/api/auth/send-link/route.ts` (route, request-response) — NEW

**Analog:** `app/api/jobs/route.ts` (exact match — POST, zod body, side-effecting)

- **runtime/dynamic exports:** `app/api/jobs/route.ts:24-26` (Shared Pattern D).
- **try/catch `req.json()` + `safeParse`:** `app/api/jobs/route.ts:33-54`.
- **Flow:** validate email → DB-backed rate-limit check (D-09, return `429
  {error:"rate_limited"}` like `jobs/route.ts:80`'s `502` shape) → `issueMagicToken`
  → `INSERT app.magic_links` → `resend.send` → `202`/`200`.
- **Log only metadata:** `app/api/jobs/route.ts:84` ("Log only kind + jobId —
  never params") — here log nothing identifying (no email, no token).

### `app/api/auth/sign-out/route.ts` (route, request-response) — NEW

**Analog:** `app/api/jobs/route.ts` (role-match — POST handler, runtime/dynamic exports)

POST → `resolve-tenant`/`validateSession` to get the session id from the
`qb_session` cookie → `destroySession(id)` → clear cookie via
`cookies().set("qb_session", "", { maxAge: 0 })` (D-05) → redirect/200.
Cookie API per RESEARCH "Code Examples §Session cookie".

### `app/auth/verify/route.ts` (route, request-response) — NEW

**Analog:** `app/api/jobs/route.ts` (runtime/dynamic exports + side-effecting)
plus `app/api/tenants/[id]/chat/route.ts` (the `redirect`-on-failure intent).

A `GET` route (clicked link). Flow per RESEARCH architecture diagram:
1. `verifyMagicToken(searchParams.token)` (`lib/auth/tokens.ts`).
2. Atomic consume `UPDATE app.magic_links ... WHERE used=false` + `.count` (Shared Pattern B).
3. Get-or-create `app.users` row.
4. **First sign-in → provision source:** RESEARCH Pattern 4 —
   `engine.executeRaw("INSERT INTO sources (id,name,config) VALUES ($1,$2,$3::jsonb) ON CONFLICT (id) DO NOTHING", ...)`.
   `source_id` generated as `u-<hex>` ≤32 chars (gbrain rule `[a-z0-9-]{1,32}`;
   `lib/gbrain/slug.ts` allows 40 — tighten the generator). Never emit
   `default`/`seed`/`host` (Pitfall 6).
5. `createSession` → `Set-Cookie qb_session` (D-05 cookie shape) → redirect `/dash/<brain>`.
6. On `.count === 0` (used/expired) → redirect `/auth/link-used`.

Pitfall 4 (email-scanner prefetch) is a documented tradeoff for this route.

### `app/sign-in/page.tsx` (component page, event-driven form) — NEW

**Analog:** `app/onboard/page.tsx` (exact match — UI-SPEC says reuse it verbatim)

`app/onboard/page.tsx` IS the template the planner copies. It is being
*repurposed away* (D-08), so the sign-in page inherits its structure:

- **`"use client"` + hooks:** `app/onboard/page.tsx:1-3`.
- **`PageState` discriminated union:** `app/onboard/page.tsx:27` — for sign-in:
  `"form" | "submitting" | "sent" | "error"` (UI-SPEC Interaction Contract).
- **Centered-card layout (LOCKED by UI-SPEC):** `app/onboard/page.tsx:163-164`
  — `<main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">`
  wrapping `<div className="w-full max-w-md mx-auto space-y-4">`.
- **Card + form + labeled Input:** `app/onboard/page.tsx:167-235` — single email
  `Input` (`type="email"`, `required`, `autoComplete="email"`, `autoFocus`),
  label `text-sm font-medium text-foreground` (line 178-183), full-width
  `Button` with `mt-2` and a label-swap disabled state (line 228-234,
  `{isSubmitting ? "Sending…" : "Send magic link"}`).
- **`fetch` + status branching:** `app/onboard/page.tsx:120-150` — POST to
  `/api/auth/send-link`, branch on `response.status`, set error/sent state.
- **`?next=` param:** read on mount, carry opaquely (UI-SPEC) — `useSearchParams`.
- **zod client-side validation:** `app/onboard/page.tsx:111-116` — mirror
  `createTenantBodySchema.safeParse` with the new `sendLinkBodySchema`.
- **Error rendering:** `<ErrorBanner>` from `components/onboard/error-banner.tsx`
  (`app/onboard/page.tsx:251-253`); inline field errors use plain
  `<p className="text-sm text-red-900">` per UI-SPEC Color section.

### `app/auth/link-used/page.tsx` (component page, event-driven) — NEW

**Analog:** `app/onboard/page.tsx` (role-match — same centered-card + Card + Button)

Static explanatory `Card` with one primary "Resend magic link" `Button`.
On click: `resending` → `resent` (swap to the same confirmation copy as
`/sign-in`'s `sent` state). Copy the layout shell and the `submitting`-style
label-swap from `app/onboard/page.tsx:163-164, 228-234`. Copywriting locked by
UI-SPEC Copywriting Contract.

### `components/auth/sign-out-button.tsx` (component, event-driven) — NEW

**Analog:** `components/onboard/error-banner.tsx` (the small `"use client"` +
`Button` component shape) + `components/jobs/job-progress.tsx:1-9` (lucide icon
import + `Button` usage).

- **Component shell:** `components/onboard/error-banner.tsx:1-19` — `"use client"`,
  named export, typed props, returns a `Button`.
- **lucide icon import:** `components/jobs/job-progress.tsx:3` —
  `import { Loader2 } from "lucide-react"`; here `import { LogOut } from "lucide-react"`.
- Per UI-SPEC: `Button variant="ghost"` (or `"outline"`) `size="sm"` + `LogOut`
  icon + "Sign out" label; `idle → signing-out` (disabled, "Signing out…").
  POSTs to `/api/auth/sign-out`, then client-side redirect to `/sign-in`.

### `lib/gbrain/tenants.ts` (service registry, CRUD) — MODIFIED

**Analog:** `lib/jobs/store.ts` (exact — the filesystem registry is *replaced*
by the Postgres-backed registry, D-01)

Currently a `Map` rebuilt from `readdir(BRAINS_ROOT)` (`tenants.ts:18-54`). D-01
replaces it: the `app.users` table IS the registry. The `get()` / `list()` /
`upsert()` / `reload()` surface (`tenants.ts:56-71`, re-exported in
`lib/gbrain/index.ts:3-13`) must become Postgres-backed queries via the
`lib/auth/store.ts` `sql` singleton. Keep `TenantRecord`'s shape where callers
depend on it, but `brainHome`/`createdAt`-from-disk fields go away; `brain_id`
(= `source_id`) and `brain_slug` come from the user row. All callers in
`app/api/tenants/[id]/*` and `app/dash/[id]/page.tsx` must move from
slug-from-URL lookup to session-resolved lookup (Shared Pattern E).

### `lib/gbrain/engine.ts` (service, request-response) — MODIFIED

**Analog:** self (thread `sourceId` through, D-11/D-12)

`queryInProcess` (`engine.ts:141-152`) calls `hybridSearch(engine, question,
{...})`. Thread an explicit `sourceId` into the `HybridSearchOpts` — the
`@/types/gbrain` `HybridSearchOpts` interface (`types/gbrain.ts:76-81`) has an
index signature `[key: string]: unknown` so `sourceId` passes through without a
shim change; RESEARCH confirms `hybridSearch` already accepts `sourceId`
natively. `SearchResult` already carries `source_id?` (`types/gbrain.ts:60`).
The `enginePool` key (`engine.ts:54`) stays keyed by tenant — or by the shared
gbrain DB — see RESEARCH note T-03-03 (pool eviction is a documented gap Phase 6
should address).

### `lib/gbrain/client.ts` (service, request-response) — MODIFIED

**Analog:** self (thread `sourceId` through `query` and `think`, D-11/D-12)

- `query()` (`client.ts:152-171`) → forward `sourceId` to `queryInProcess`.
- `think()` (`client.ts:197-226`) → forward `sourceId` to `runThink`. **This is
  the D-12 patch target:** `RunThinkOpts` (`types/gbrain.ts:165-182`) currently
  has NO source field. The `patches/gbrain+*.patch` threads `sourceId` through
  gbrain's `RunThinkOpts → runThink → ThinkGatherOpts → runGather → hybridSearch
  /searchTakes`. After patching, add `sourceId` to the `@/types/gbrain`
  `RunThinkOpts` interface so `client.ts::think` can pass it type-safely.

### `middleware.ts` (middleware, request-response) — NEW — NO ANALOG

No `middleware.ts` exists in the repo. RESEARCH Pattern 5 is the canonical body.
Coarse cookie-presence check only (D-06) — **must not import `lib/auth/store.ts`**
(`postgres` is not Edge-compatible; Next.js 15.3.2 middleware is Edge-only —
Node-runtime middleware is 15.5+, NOT available here, RESEARCH Pitfall 2). The
`AUTH_ENABLED=0` dev bypass (D-03) and `matcher: ["/dash/:path*",
"/api/tenants/:path*"]` belong here. Full `app.sessions` validation happens
downstream in the Node-runtime routes via `lib/auth/resolve-tenant.ts`.

### `patches/gbrain+*.patch` (config tooling) — NEW — NO ANALOG

No `patches/` directory exists; `patch-package` is **not** in `package.json`.
This is net-new tooling (D-12). The planner must add a task to: `bun add -d
patch-package`, add a `"postinstall": "patch-package"` script, edit
`node_modules/gbrain/src/core/think/*` to thread `sourceId`, then
`bunx patch-package gbrain`. The committed patch pins against
`gbrain` `github:garrytan/gbrain#3933eb6` (`package.json` dependencies) —
flag that the patch filename embeds the resolved version and a `gbrain` version
bump invalidates it.

### `app/page.tsx` / `app/dash/[id]/page.tsx` / `app/api/tenants/[id]/*` — MODIFIED — self

- `app/page.tsx`: one-line change — the `<Link href="/onboard">` (line 17-22)
  becomes `href="/sign-in"` with label "Sign in" (D-08, UI-SPEC). Keep the
  `text-4xl`/`text-lg`/large-button treatment.
- `app/dash/[id]/page.tsx`: currently `tenants.init()` + slug-from-URL lookup
  (lines 19-24). Add a session gate — resolve the user via
  `lib/auth/resolve-tenant.ts` and `notFound()`/redirect on mismatch (Shared
  Pattern E). Also gains the minimal header row holding `<SignOutButton>`
  (UI-SPEC). Note: `app/dash/` has NO `layout.tsx` today.
- `app/api/tenants/[id]/{chat,insights,onboard,reset}/route.ts`: each currently
  does `tenants.init()` + `tenants.get(slug)` (`chat/route.ts:64-70`). Replace
  the slug-from-URL `404 tenant_not_found` path with session resolution via
  `resolve-tenant.ts` — this is the folded `tenant-registry-deploy-persistent`
  todo fix. Keep the existing runtime/dynamic exports and SSE machinery.

---

## No Analog Found

| File | Role | Data Flow | Reason / Substitute |
|------|------|-----------|---------------------|
| `middleware.ts` | middleware | request-response | No `middleware.ts` in repo. Use RESEARCH Pattern 5 verbatim. Edge-runtime constraint (Next 15.3.2) is load-bearing — cookie-presence only, no DB import. |
| `patches/gbrain+3933eb6.patch` | config tooling | n/a | No `patches/` dir; `patch-package` not installed. Net-new tooling per D-12 — add `patch-package` dev dep + `postinstall` script. |
| `lib/auth/email.ts` (partial) | service | request-response | No Resend usage in repo. Closest shape is the `inngest` client singleton (`lib/inngest/client.ts`); the Resend HTML template has no in-repo precedent (Claude's Discretion). |

---

## Metadata

**Analog search scope:** `lib/`, `app/`, `scripts/`, `components/`, `types/`, `package.json`
**Files scanned:** `lib/jobs/store.ts`, `lib/jobs/schemas.ts`, `scripts/setup-jobs-table.ts`,
`lib/gbrain/{tenants,engine,client,onboard,slug,index}.ts`, `types/gbrain.ts`,
`app/api/jobs/route.ts`, `app/api/tenants/[id]/chat/route.ts`,
`app/onboard/page.tsx`, `app/page.tsx`, `app/dash/[id]/page.tsx`,
`app/layout.tsx`, `components/onboard/error-banner.tsx`,
`components/jobs/job-progress.tsx`, `lib/chat/schemas.ts`,
`lib/onboarding/create-tenant.ts`
**Pattern extraction date:** 2026-05-22
**Key constraint surfaced:** D-11 isolation is application-layer `source_id`
scoping, NOT gbrain RLS (RESEARCH BLOCKING FINDING). Every gbrain call routes
through the single `lib/auth/resolve-tenant.ts` chokepoint.
