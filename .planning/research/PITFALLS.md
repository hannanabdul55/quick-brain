# Pitfalls Research — QuickBrain v1.1

**Domain:** Adding smb-audit gbrain skill, email magic-link auth, and QBO ingest to an existing v1.0 hackathon Next.js + gbrain CLI shell.
**Researched:** 2026-05-17
**Confidence:** HIGH on v1.0 codebase specifics (read from actual source). MEDIUM on gbrain skill internals and QBO API behavior (informed by v1.0 research + official QBO docs patterns). LOW flagged inline where first-run spike is required.

> Every pitfall below is specific to **adding these three features on top of this codebase**. Generic OAuth/auth advice is out of scope. The dominant question is: what breaks the existing working demo when you layer v1.1 on top?

---

## Critical Pitfalls

### Pitfall 1 (CRITICAL): Insight parsers are hardcoded to `data/maras-coffee/` — every real-data tenant gets Mara's numbers

**What goes wrong:**
A QBO user signs in, connects their QuickBooks, completes onboarding. Their dashboard shows insight cards — but the cards show Mara's vendor spend, Mara's P&L, and Mara's anomalies. The bug is invisible because the numbers look plausible.

**Why it happens:**
`lib/insights/cache.ts → computeAndCache(tenantId, FIXTURES_ROOT)` always receives `FIXTURES_ROOT` which is `data/maras-coffee/` regardless of which tenant is loading. This was a deliberate v1.0 decision (documented in the audit: "Insight cards parse static markdown directly — locked decision per CONTEXT.md, but worth knowing for v1.1 when QB live data lands"). The v1.0 code does not pass per-tenant brain dir to the insight parsers — it passes the global fixtures constant. All three parsers (`computeTopVendors`, `computePnl`, `computeAnomalies`) read from `fixturesDir/originals/` and `fixturesDir/concepts/`.

**Detection:** A real QBO user's dashboard shows data that doesn't match their QuickBooks. If both users onboard, both see identical cards.

**Prevention:**
- Gate: before implementing QBO ingest, update `computeAndCache` signature to accept either `FIXTURES_ROOT` (seed/demo path) or the per-tenant brain dir.
- The existing `GET /api/tenants/[id]/insights` already has access to the tenant record (including `brainHome`). Pass `tenant.brainHome` instead of `FIXTURES_ROOT` for non-seed tenants.
- The smb-audit skill (Phase 4) writes its output to the brain dir, not to `data/maras-coffee/` — so the anomaly parser MUST use the brain dir for skill output to appear.
- Phase 4 gate: verify that after `smb-audit` runs, `computeAnomalies(brainDir)` returns skill output, not the static seed anomalies.

**Phase:** Phase 4 (smb-audit skill) — must fix before skill output can reach insight cards. Also blocks Phase 6 (QBO) if skipped.

---

### Pitfall 2 (CRITICAL): smb-audit skill writes concept pages that don't match the insight-card parser's exact regex — anomaly card silently shows 0 items

**What goes wrong:**
The skill runs successfully, `concepts/march-anomaly-summary.md` is written to the brain dir, but the anomaly insight card shows empty or throws "Expected at least 3 anomaly rows, got 0."

**Why it happens:**
`lib/insights/anomalies.ts → computeAnomalies` parses anomaly bullets with a specific regex:
```
/^- (\d{4}-\d{2}-\d{2}):\s+\[\[([^\]]+)\]\]\s+(.+?)$/
```
It requires:
1. A date in `YYYY-MM-DD` format
2. A `[[wikilink]]` as the second token immediately after the date
3. Wikilinks must start with `companies/` (lines not matching `companies/` prefix are filtered out)
4. Lines starting with "Detection method" are also filtered

If the skill's output format varies (bare `[[slug]]` instead of `[[companies/slug]]`, different bullet structure, description before the wikilink, missing date) the parser produces zero rows and throws. The card shows an error state, not the skill findings.

**Detection:** After skill runs, `bun -e "import('./lib/insights/anomalies.ts').then(m => m.computeAnomalies('./brains/<id>')).then(console.log).catch(console.error)"` returns an error or empty array.

**Prevention:**
- Before writing the skill, write a unit test for `computeAnomalies` against the expected skill output format. Lock the format contract first, then build the skill to match it.
- The skill's SKILL.md must specify the exact bullet format: `- YYYY-MM-DD: [[companies/<slug>]] <description>`. No deviations.
- After skill authoring, run the parser against the skill's actual output before declaring Phase 4 done.
- Do NOT silently change the bullet format in the skill without updating `anomalies.ts` — the parser is the contract.

**Phase:** Phase 4 (smb-audit skill) — this is the primary integration gate for the skill.

---

### Pitfall 3 (CRITICAL): QBO transactions use different field names and structures than the synthetic seed schema — smb-audit skill produces zero anomalies on real data

**What goes wrong:**
The smb-audit skill was validated against the synthetic seed (invoice files with `vendor:`, `date:`, `amount:` frontmatter). QBO Accounting API returns vendor IDs (not slugs), `TxnDate` (not `date:`), `TotalAmt` (not `amount:`), line items, tax, and currency fields. The QBO transformer writes invoices in a subtly different frontmatter shape. The skill's pattern matching finds nothing on real data.

**Why it happens:**
The skill was authored and tested only against synthetic data. The QBO transformer (Phase 6) writes a schema that was designed independently. Schema divergence between them is never caught because there is no shared schema contract and the skill was never run against QBO-format invoices.

**Detection:** After QBO ingest, the anomaly insight card shows "0 anomalies detected" or throws. Running the skill manually against a QBO-imported brain returns no findings.

**Prevention:**
- Define a canonical invoice frontmatter schema BEFORE writing either the skill or the QBO transformer. Both must emit/consume the same fields: `type: invoice`, `vendor: <slug>`, `date: YYYY-MM-DD`, `amount: <number>`. Document this schema in a shared spec file (`docs/brain-schema.md` or similar).
- The QBO transformer's primary job is to normalize QBO's `TxnDate` → `date:` and `TotalAmt` → `amount:` and `VendorRef.name` → a slug in `companies/<slug>.md`. This normalization is the schema contract.
- Phase 4 gate: `smb-audit` skill must be validated against a manually-constructed QBO-shaped invoice (even one fixture file) before Phase 6 starts.
- Phase 6 gate: the first QBO sync must run the skill against the imported brain and verify at least one anomaly is detected.

**Phase:** Cross-cutting — Phase 4 must define the schema contract, Phase 6 must honor it. Phase ordering dependency: Phase 4 must ship before Phase 6 transformer is written.

---

### Pitfall 4 (CRITICAL): Per-tenant mutex is keyed by tenantId (slug) — after the user model migrates to userId + brain_slug, old in-flight requests from slug-keyed queue silently bypass isolation

**What goes wrong:**
v1.0 mutex is `Map<tenantId, Promise>` where tenantId is the brain slug (e.g. `maras-coffee`). v1.1 introduces userId for auth. If the code migrates to keying the mutex by userId instead of brain_slug, two users who happen to have brains with the same slug (unlikely but possible) share a mutex. Worse, during the migration, if some callers pass userId and some pass brain_slug, the mutex has no entries to find — PGLite exclusive-lock contention re-emerges silently.

**Why it happens:**
The mutex key in `lib/gbrain/mutex.ts` is a plain string. Nothing enforces what string is passed. During a tenant model refactor, callers can diverge.

**Detection:** Concurrent requests to the same brain (e.g. two chat calls fired together) produce "database is locked" errors in stderr — the same symptom as Pitfall 3 from v1.0.

**Prevention:**
- The mutex MUST be keyed by brain_slug (the filesystem directory name), not userId. The invariant is: one mutex per brain dir, not one mutex per user.
- If a user has multiple brains (out of scope for v1.1 but worth designing for), each brain_slug gets its own mutex entry.
- In `lib/gbrain/client.ts`, `spawnGBrain` receives `tenantId` which IS the brain_slug in v1.0. If `TenantRecord` gains a `userId` field, the spawn helper must still pass `record.id` (the brain slug) to `withTenantLock`, not `record.userId`.
- Add a TypeScript type guard: define `type BrainSlug = string & { readonly __brand: 'BrainSlug' }` and use it as the mutex map key to catch passing the wrong string type at compile time.

**Phase:** Phase 5 (auth) — the tenant model migration happens here. Gate: after migration, run `scripts/concurrent-smoke.ts` (already exists in the repo) against a v1.1 tenant.

---

### Pitfall 5 (CRITICAL): `scripts/panic-reset.sh` wipes ALL non-seed brain dirs including real-user data — invoking it in production nukes paying users

**What goes wrong:**
The script's loop is: "for each dir in brains/ that is not 'seed': `rm -rf $entry`". In v1.0 this is safe because all tenants are anonymous demo sessions with no durable data. In v1.1, a real user's QBO-synced brain lives in `brains/<slug>/`. Running `panic-reset.sh` destroys it irreversibly (the brain dir is the only copy; QBO data can be re-synced but the user's queries and context are lost).

**Detection:** After a panic-reset, a logged-in user visits their dashboard and finds their brain is gone. They see an error or empty state. No warning was shown.

**Prevention:**
- v1.1 needs two separate reset operations:
  1. **Demo reset** (original behavior): wipe all non-seed brains. Rename to `scripts/demo-reset.sh` and add a `DEMO_ONLY=1` gate that refuses to run if `AUTH_ENABLED=1` is set in env.
  2. **User brain reset**: per-user via the existing `POST /api/tenants/[id]/reset` button, which only resets the calling user's own brain.
- `panic-reset.sh` must be gated in v1.1: add a prompt "WARNING: This will delete ALL user brains. Type 'CONFIRM' to proceed" and check `AUTH_ENABLED` env.
- The QBO re-sync endpoint (Phase 6) is the recovery path for a wiped real-user brain, not the panic-reset script.

**Phase:** Phase 5 (auth) — the reset script must be audited before any real users can create accounts.

---

### Pitfall 6 (CRITICAL): Magic-link tokens stored in URL are replayed — single-use enforcement is missing

**What goes wrong:**
A user clicks the magic link in their email. The link contains a signed token in the URL. The link is recorded in email server logs, browser history, and the user's sent-folder preview text. If the token can be used more than once (or if there is no expiry check), anyone who sees the URL (even later) can log in as that user.

**Why it happens:**
Implementing token invalidation requires a persistent token store. Without one, the JWT signature check alone passes every time. There is no app-layer database in v1.0, so adding token invalidation means adding state somewhere.

**Detection:** Clicking the magic link a second time (after the first use) still logs the user in. An expired link (>15 minutes old) still works.

**Prevention:**
- Use a PGLite SQLite file at `data/auth.db` (separate from gbrain's brain dirs) owned by the Next.js app layer. Store token hashes with `used_at` timestamps.
- On verification: check token expiry (≤15min), check hash not in `used_tokens` table, then mark used. All three checks before setting the session cookie.
- Token must be a cryptographically random 32-byte value, NOT a signed JWT whose payload reveals the email. HMAC-sign the random token for authenticity, but the random component is the token.
- Signing key must come from `AUTH_SECRET` env var. If the env var is missing, refuse to start — do not fall back to a hardcoded default. Gate this in `scripts/demo-check.sh` alongside the existing API key checks.

**Phase:** Phase 5 (auth) — this is the primary security constraint for the auth feature.

---

### Pitfall 7 (CRITICAL): QBO OAuth refresh tokens expire 100 days after issuance — silent sync failure after the 100-day window

**What goes wrong:**
QBO's OAuth 2.0 access tokens expire after 1 hour; refresh tokens expire 100 days after issuance (not after last use). If the app refreshes the access token frequently, the refresh token itself silently expires at day 100. The next sync attempt gets a 401. The user sees no anomalies because no new data was ingested, but the error is swallowed or shown only in server logs.

**Detection:** QBO sync returns 401 after approximately 100 days. User's insight cards stop updating but show no error.

**Prevention:**
- Store `refresh_token_issued_at` alongside the refresh token in the encrypted token store.
- On each sync, check if `refresh_token_issued_at` is within 14 days of expiry (day 86+). If so, surface a "Reconnect QuickBooks" banner to the user before the token actually expires.
- The sync endpoint must return a structured error state (`{ error: 'qbo_token_expired' }`) that the UI translates to the reconnect CTA rather than a generic failure.
- Proactive re-auth UX: on dashboard load, check token freshness and show a non-blocking warning banner if expiry is approaching.

**Phase:** Phase 6 (QBO) — must be in the initial implementation, not a follow-up. The 100-day window means it won't surface during testing but will hit real users.

---

## High Pitfalls

### Pitfall 8 (HIGH): smb-audit skill fails during `gbrain import` — does gbrain abort the import or silently skip?

**What goes wrong:**
The skill throws during import (e.g. because the invoice format doesn't match its parser, or a dependency is missing). The import command exits successfully from the app's perspective (exit code 0) but the concept pages are never written. The anomaly insight card then throws on first load.

**Why it happens:**
gbrain's skill failure semantics are not explicitly documented for the import pipeline. The behavior — abort vs. skip vs. partial write — is unknown without a test spike. If gbrain treats skill failures as warnings and continues, the app has no signal that the skill didn't run.

**Detection:** Import succeeds (exit 0), but `concepts/march-anomaly-summary.md` does not exist in the brain dir after import.

**Prevention:**
- Spike required at the start of Phase 4: intentionally break the skill (e.g. throw unconditionally) and observe `gbrain import` exit code and stdout/stderr. This is a LOW-confidence area requiring direct observation.
- Add a post-import check in the seed script: assert that `concepts/march-anomaly-summary.md` exists and `concepts/recurring-charges.md` exists after import. Fail loudly if either is missing.
- The SSE onboarding stream (Phase 5, per-user onboarding) should check for skill output existence and emit a warning event if missing, rather than silently continuing to the dashboard.

**Phase:** Phase 4 (smb-audit skill) — spike at day one of the phase.

---

### Pitfall 9 (HIGH): smb-audit skill is not idempotent — re-running `gbrain import` appends duplicate bullets to concept pages

**What goes wrong:**
`gbrain import` is called both during initial onboarding and (in v1.1) during QBO re-sync. If the skill appends to concept pages rather than overwriting them, every re-sync doubles the anomaly bullets. After three syncs, the anomaly card shows 9 items instead of 3.

**Why it happens:**
gbrain skills that write to concept pages may append timeline bullets to an existing page rather than regenerating the page from scratch — this is the "timeline" pattern gbrain encourages for ongoing facts. A skill written in append mode is correct for event logs but wrong for a summary page that should reflect the current state.

**Detection:** Run `gbrain import` twice against the same brain dir. Check `concepts/march-anomaly-summary.md` line count — if it grew, the skill is appending.

**Prevention:**
- The skill must explicitly overwrite the summary page, not append. Use gbrain's `write_page` skill action in replace mode, or check for the existing page and delete it before writing.
- The existing `scripts/detect-anomalies.ts` is idempotent (it uses `writeFile` which overwrites). The skill must match this behavior.
- Phase 4 gate: run `gbrain import` three times consecutively. Verify `concepts/march-anomaly-summary.md` has the same line count and content after each run.

**Phase:** Phase 4 (smb-audit skill).

---

### Pitfall 10 (HIGH): Cookie `SameSite=Lax` blocks the magic-link redirect — user clicks email link, lands on a broken auth callback

**What goes wrong:**
The magic-link flow is: user clicks link in email → browser navigates to `/api/auth/verify?token=X` → server validates token → sets session cookie → redirects to `/dash/<brain-slug>`. If the email client opens the link in a new browser window (common with Gmail's "Open in new tab"), the cross-site navigation may trip `SameSite=Lax` cookie restrictions in certain configurations. The session cookie is not set, the redirect lands on the dashboard, which sees no session and shows the login wall again.

**Detection:** Magic link works when clicked in the same browser session but fails when forwarded via email or opened in an incognito window.

**Prevention:**
- For a magic-link redirect flow, `SameSite=Lax` is actually correct (Lax allows top-level navigation GET requests). The issue only arises if the verify endpoint is triggered via a POST or if the redirect is from a cross-origin iframe.
- Verify endpoint must be a `GET` (not a POST) to be compatible with Lax. The token is in the URL query string, not the body.
- After the cookie is set via `Set-Cookie` on the redirect response, verify it persists by testing the flow end-to-end from an email client (not just the browser address bar). Gmail's link proxy (`https://links.gmail.com/...`) is the most common failure vector.
- Add a `/auth/link-clicked` landing page that sets the cookie and then does a client-side redirect, as a fallback for stubborn email clients that strip cookies on the initial navigation.

**Phase:** Phase 5 (auth) — test the complete email-to-dashboard flow from an actual email client, not just the browser.

---

### Pitfall 11 (HIGH): Email deliverability — magic links land in spam on a VM with no domain auth

**What goes wrong:**
The app sends transactional email from an Oracle Cloud VM IP. The VM's IP has no SPF record, no DKIM signing, and no DMARC policy. Gmail, Outlook, and Apple Mail route the message to spam or refuse it entirely. The user never sees the magic link.

**Detection:** Magic link email is not received within 60 seconds. Checking spam folder reveals it there.

**Prevention:**
- Do NOT send email directly from the VM via SMTP. Use a transactional email provider with established domain reputation: Resend (has a generous free tier, DX-friendly Node SDK, SPF/DKIM handled for you) or SendGrid.
- Use a dedicated subdomain for sending (e.g. `mail.quickbrain.app`) with SPF and DKIM records pointing to the provider's infrastructure. The provider's dashboard guides through this in under 10 minutes.
- For the development/staging path: Resend supports sandbox mode where emails are captured but not delivered, enabling testing without spam risk.
- If domain setup is not possible before v1.1 ships, rate-limit magic-link sends to one per email per 5 minutes to prevent abuse even without DMARC.

**Phase:** Phase 5 (auth) — must be resolved before any end-to-end testing of the login flow.

---

### Pitfall 12 (HIGH): QBO rate limits hit during initial 12-month sync — 500 calls/min per realm exhausted before all invoices are fetched

**What goes wrong:**
Initial QBO sync fetches 12 months of transactions: invoices, bills, bank transactions. A small business might have 300–500 invoices per year plus bank lines. Fetching with naive pagination (one QBO API call per page of 100 records, across bills + invoices + bank transactions) can reach 15–30 API calls for the initial sync. This is well within 500/min for a single user. However, if multiple users are syncing simultaneously, or if the code makes redundant calls (re-fetching for error handling), the limit surfaces.

The real risk is not the initial sync rate limit but the **error handling path**: QBO returns `429 Too Many Requests` with a `Retry-After` header. If the sync code does not read `Retry-After` and backs off, it retries immediately, burns through the limit, and the sync fails with no clear error shown to the user.

**Detection:** Sync completes but is missing some months of data. Server logs show 429 responses.

**Prevention:**
- Parse `Retry-After` header on every QBO response. Implement exponential backoff with a maximum of 3 retries.
- Use QBO's `query` endpoint with `MAXRESULTS 1000` and `STARTPOSITION` pagination rather than multiple entity-type calls where possible, to minimize call count.
- The SSE onboarding stream must emit real progress events for the sync ("Fetching January invoices… Fetching February invoices…") so the user knows why it takes more than 60 seconds on initial sync.
- Surface a clear "still importing in the background" state when the onboarding SSE stream ends before the import is complete. The 60-second onboarding promise applies to the demo seed, not the live QBO sync.

**Phase:** Phase 6 (QBO) — implement with proper backoff from the start, not as a hotfix.

---

### Pitfall 13 (HIGH): QBO transformer writes vendor names as arbitrary strings — wikilinks are broken and gbrain graph stays orphaned

**What goes wrong:**
The QBO transformer creates `originals/invoice-<id>.md` with `vendor: Beanstalk Coffee Roasters LLC` (the QBO display name, with spaces and capitalization). The wikilink it emits is `[[companies/beanstalk-coffee-roasters-llc]]`. But the company page was created as `companies/beanstalk-roasters.md` (slug derived differently). The wikilink target doesn't exist; gbrain's graph extractor finds no match; the vendor has no edges in the knowledge graph. The "Top Vendors" card works (it reads frontmatter directly) but `gbrain query "what was weird about March?"` has no graph context for the vendor.

**Why it happens:**
QBO vendor names have no canonical slug form. The transformer must derive a slug from the display name. If the slug derivation is inconsistent (different logic for the company page vs. the invoice wikilink), they don't match.

**Detection:** After QBO sync, `gbrain graph-query <vendor-slug> --depth 2` returns no neighbors. `gbrain orphans` lists most originals pages.

**Prevention:**
- Define one canonical slug function used in both the company page writer and the invoice wikilink emitter. Input: QBO `VendorRef.name`. Output: `kebab-case-slug-max-40-chars`. One function, called twice.
- Write the `companies/<slug>.md` page FIRST during sync, then reference `[[companies/<slug>]]` in all invoice and bank pages. The company page is the anchor; invoice pages are the edges.
- Test the graph immediately after the first QBO sync: `gbrain graph-query <first-vendor-slug> --depth 2` must return at least 2 neighbors (its invoices).

**Phase:** Phase 6 (QBO) — slug derivation must be a shared utility defined before the transformer is written.

---

### Pitfall 14 (HIGH): QBO `TxnDate` vs. `MetaData.LastUpdatedTime` — wrong date field means "last month" filter misidentifies transactions

**What goes wrong:**
The smb-audit skill and the top-vendors insight parser both filter by date. If the QBO transformer uses `MetaData.LastUpdatedTime` (when the record was last edited in QBO) instead of `TxnDate` (the actual transaction date), a January invoice that was edited in April appears in April's data. Month-over-month comparisons are meaningless, and the "weird about March?" query returns incorrect or empty results.

**Detection:** After QBO sync, querying "what was weird about March?" returns anomalies from the wrong months, or more than expected.

**Prevention:**
- Always use `TxnDate` for the invoice `date:` frontmatter field. `MetaData.LastUpdatedTime` must never be used as the document date.
- `MetaData.LastUpdatedTime` is useful only for incremental sync (detecting which records changed since last sync). Store it separately as `qbo_last_updated:` in frontmatter if needed.
- The QBO transformer must have an explicit field mapping table documented in code comments: `TxnDate → date`, `TotalAmt → amount`, `VendorRef.name → vendor`, `Id → qbo_id`.

**Phase:** Phase 6 (QBO) — enforce this in the field mapping table before first integration test.

---

### Pitfall 15 (HIGH): Auth session cookie + Next.js App Router RSC streaming — cookie set in Route Handler is not visible to Server Components in the same request

**What goes wrong:**
The magic-link verify endpoint (`GET /api/auth/verify`) sets the session cookie via `Set-Cookie` on the redirect response. The user lands on `/dash/[slug]`, which is a Server Component. If the Server Component tries to read the cookie in the same request cycle as the redirect, it may not see it (the cookie was set on the *previous* response, the redirect itself). This is the normal browser behavior, not a Next.js bug. But if the dashboard page tries to read the session before the cookie is flushed by the redirect, it shows the unauthenticated state.

**Detection:** After clicking the magic link, the user is redirected to the dashboard but sees the login wall instead of their brain. Refreshing the page shows the correct state.

**Prevention:**
- This is standard behavior: the verify endpoint redirects, the browser follows the redirect, the new request carries the cookie. The Server Component reads the cookie on the *second* request (the redirect target), not the first. This works correctly as long as the cookie is set on the redirect response.
- Use `cookies().set()` from `next/headers` before calling `redirect()` in the Route Handler. In Next.js 15, `cookies()` is async — `await cookies()` before setting.
- Do not attempt to read the session in a streaming RSC before the cookie is confirmed present. Add a client component that handles the "no session" → "has session" transition.
- Test by checking the Network tab: verify the `Set-Cookie` header is on the 302 response, and the `Cookie` header is on the subsequent GET to the dashboard.

**Phase:** Phase 5 (auth).

---

### Pitfall 16 (HIGH): QBO OAuth tokens stored unencrypted or committed to env files — credential leak path

**What goes wrong:**
The QBO OAuth client secret and per-user refresh tokens are stored in plain text in `.env.local`, or the token store writes them to a JSON file committed to git. Someone with repo access gets all tokens. A user whose token is leaked can have their QBO data accessed without their knowledge.

**Detection:** `git log --all --full-history -- .env.local` or `git log -p | grep -i refresh_token` shows credentials in history.

**Prevention:**
- QBO client secret belongs in environment variables (`QBO_CLIENT_SECRET`, `QBO_CLIENT_ID`) — never committed.
- Per-user refresh tokens must be encrypted at rest. Use AES-256-GCM with a key derived from `AUTH_SECRET`. The PGLite auth.db stores `encrypted_refresh_token` and `encrypted_access_token` blobs, not plaintext.
- Add `.env.local`, `data/auth.db`, and `brains/` to `.gitignore` (verify brains/ is already there). Add a pre-commit hook check that refuses to commit files matching `*_token*` or `*secret*` outside of the expected env-var format.
- `AUTH_SECRET` must be a 256-bit random value generated at setup. Document this in `scripts/demo-check.sh` — if `AUTH_SECRET` is absent or shorter than 32 bytes, refuse to start.

**Phase:** Phase 5 (auth) for token storage design. Phase 6 (QBO) for per-user QBO token encryption.

---

## Moderate Pitfalls

### Pitfall 17 (MEDIUM): smb-audit skill has no access to app env vars or `FIXTURES_ROOT` — anything it needs must be in the brain dir

**What goes wrong:**
During skill authoring, the developer tries to read `process.env.FIXTURES_ROOT` inside the skill's TypeScript hook to reference the synthetic seed data. The skill runs inside gbrain's process, which does not inherit the Next.js app's env vars. The reference is undefined. The skill silently reads from the wrong path or crashes.

**Detection:** Skill works when run via `scripts/detect-anomalies.ts` (which runs in the app context) but fails or produces empty output when run via `gbrain import`.

**Prevention:**
- Skills must be self-contained. All data the skill needs must be accessible via the brain dir (what gbrain passes as context). The skill's TS hook receives the brain's page graph, not the app filesystem.
- The smb-audit skill must derive its inputs from pages already in the brain (imported `originals/` and `companies/` pages), not from external files.
- Verify this constraint before authoring: read the gbrain skill authoring docs for the exact API signature of the TS hook. The skill receives a context object — understand its shape before writing logic against it. LOW confidence on exact API — spike required.

**Phase:** Phase 4 (smb-audit skill) — spike the skill API surface before writing logic.

---

### Pitfall 18 (MEDIUM): gbrain skill manifest: wrong `trigger` declaration means the skill never fires after `gbrain import`

**What goes wrong:**
The skill is correctly authored but declares `trigger: on_query` instead of `trigger: on_import`. It never runs during the import pipeline. Concept pages are never written. The seed script appears to succeed (exit 0), but the brain has no anomaly summary.

**Detection:** `gbrain import` completes, no concept pages exist in the brain dir. Running `gbrain jobs list` shows the skill was never queued.

**Prevention:**
- Read the skill manifest documentation before declaring trigger type. The smb-audit skill should fire at the end of import, not on query. Likely trigger value: `on_import` or `post_import`. LOW confidence on exact field name — verify against gbrain source or skill authoring docs.
- After skill registration, do a dry-run: `gbrain import data/test-fixture.md` against an isolated brain dir and verify the skill was queued and executed.
- The `gbrain check-resolvable --strict` command (documented in v1.0 PITFALLS.md Pitfall 17) must pass before declaring the skill done.

**Phase:** Phase 4 (smb-audit skill).

---

### Pitfall 19 (MEDIUM): v1.0 insight parsers read `data/maras-coffee/` directly for the Mara demo path — migrating to per-tenant brain dirs breaks the demo tenant's insight cards

**What goes wrong:**
After fixing Pitfall 1 (making insight parsers tenant-aware), the Mara demo tenant (`seed` or any demo-mode tenant) now reads from its brain dir instead of `data/maras-coffee/`. If the brain dir doesn't contain the static markdown files (only the gbrain-internal PGLite state), the parsers throw "file not found" and the insight cards break for the demo path.

**Why it happens:**
`brains/seed/` is a PGLite brain dir with gbrain's internal tables and indexes. The original `data/maras-coffee/` markdown source files are NOT copied into `brains/seed/`. The v1.0 insight parsers work because they read from `data/maras-coffee/` directly, bypassing the brain dir entirely.

**Detection:** After the tenant-aware fix, the demo/seed tenant's insight cards show 500 or empty.

**Prevention:**
- Two options, pick one before Phase 4 coding begins:
  1. Keep `FIXTURES_ROOT` as a special-case for the seed tenant. The insights route already has `const isSeed = tenantId === SEED_TENANT_ID` — use this to pass `FIXTURES_ROOT` for seed and `tenant.brainHome` for everyone else.
  2. Copy the `data/maras-coffee/` markdown source files into `brains/seed/` during the seed script, so `brains/seed/originals/` and `brains/seed/concepts/` exist. This is cleaner but requires updating `seed.sh`.
- Option 1 is lower risk because it minimizes changes to the seed script. Option 2 is architecturally cleaner for v1.1.
- Gate: after the change, verify the seed tenant's insight cards still load correctly AND a real-data tenant's cards load from their brain dir.

**Phase:** Phase 4 (smb-audit skill) — must resolve before the skill's concept output can be read.

---

### Pitfall 20 (MEDIUM): QBO sandbox vs. production realm confusion — user connects the wrong environment

**What goes wrong:**
QBO has separate sandbox and production environments with different OAuth endpoints and realm IDs. During development, the app is registered as a sandbox app. A real business owner tries to connect their real QuickBooks — the OAuth consent screen says "Sandbox" or the app uses the sandbox API URL and their real data is inaccessible. Alternatively, the developer accidentally hardcodes the sandbox API base URL and the production OAuth flow silently fetches no real data.

**Detection:** After "successful" QBO connect, importing returns 0 transactions despite the user having real data in QuickBooks.

**Prevention:**
- Use environment-controlled base URLs: `QBO_BASE_URL=https://quickbooks.api.intuit.com` (prod) vs `https://sandbox-quickbooks.api.intuit.com` (sandbox). Never hardcode either.
- The OAuth consent screen realm selector in Intuit's flow naturally routes to the correct environment if the app is registered appropriately. Register the v1.1 app under production from the start to avoid late-stage environment migration.
- Display the connected company name prominently after OAuth completes so the user can immediately verify they connected the right QuickBooks account.

**Phase:** Phase 6 (QBO).

---

### Pitfall 21 (MEDIUM): Per-user brain dir created with user-derived slug — two users with similar business names get the same brain slug, one overwrites the other

**What goes wrong:**
v1.1 creates brain dirs as `brains/<slug>` where slug is derived from the user's business name (same as v1.0's `tenantId`). If two users name their business "Corner Coffee" and "Corner Coffee Shop", the slugs collide (`corner-coffee` and `corner-coffee-shop` might both map to `corner-coffee` under the truncation logic). The second user's `cp -r brains/seed/` silently overwrites the first user's imported data.

**Detection:** Two different users see identical insight cards. One user's QBO data overwrites another's.

**Prevention:**
- In v1.1, brain_slug must include the userId (or a hash of it) as a namespace prefix: `brains/<user-id-prefix>-<business-slug>`. This guarantees uniqueness per user even with identical business names.
- Alternatively, generate a UUID-based brain_slug at account creation time and store the human-readable name separately in the user record. The slug never collides because it's random, not derived.
- The existing `assertTenantSlug` function in `lib/gbrain/slug.ts` validates the slug regex — it must be updated if the format changes. The regex is currently `[a-z0-9-]+` with a length limit.

**Phase:** Phase 5 (auth) — brain_slug generation logic must be defined as part of user account creation.

---

### Pitfall 22 (MEDIUM): QBO initial sync wall-clock exceeds 60 seconds — the onboarding UX promise is broken for real-data users

**What goes wrong:**
The v1.0 onboarding SSE stream plays a 36-second narrated sequence and then resolves. For a QBO user, the actual gbrain import of 12 months of transactions may take 2–5 minutes (QBO API calls + markdown generation + gbrain import + embedding). The SSE stream ends after 36 seconds (following the same choreography as the demo) but the brain isn't ready. The dashboard loads with empty or cached-seed insight cards while import continues in the background.

**Detection:** Dashboard loads, insight cards show Mara's seed data (from cache), real QBO data arrives minutes later and cache is never invalidated.

**Prevention:**
- The 60-second onboarding promise is for the **demo persona only**. For QBO users, the SSE stream must honestly communicate the import status: "Fetching 12 months of QuickBooks data… This takes 1–3 minutes."
- Use a two-phase onboarding: Phase A (quick, 10s) creates the account and shows the dashboard skeleton. Phase B (background) runs the QBO sync and emits progress via a polling endpoint or persisted SSE. The dashboard shows "Import in progress" until Phase B completes.
- Invalidate the insight cache and re-compute when Phase B finishes (emit a `reload` SSE event to the browser).
- The existing abort-tracker and mutex are sufficient for Phase B — the QBO sync runs through `spawnGBrain` as a long-lived operation.

**Phase:** Phase 6 (QBO) — the two-phase onboarding UX must be designed before the sync pipeline is built.

---

### Pitfall 23 (MEDIUM): Reset endpoint runs outside the per-tenant mutex — firing reset during an active QBO sync corrupts the brain dir

**What goes wrong:**
The v1.0 audit documents this: "Reset endpoint runs outside per-tenant mutex (deliberate trade-off; risks lock contention if reset fires mid-spawn)." In v1.0 this was acceptable because resets were infrequent and the user-facing reset button required a 2-second press. In v1.1, a QBO sync takes 2–5 minutes. If the user gets impatient and hits Reset mid-sync, the reset deletes `brains/<id>/` while a `gbrain import` subprocess is actively writing to the PGLite file inside it. This produces a corrupted brain state (partial PGLite file, orphaned lock files).

**Detection:** After a mid-sync reset, the next `gbrain import` or `gbrain query` exits non-zero with a PGLite error, or hangs waiting for a lock that no longer exists.

**Prevention:**
- The reset endpoint must check `pendingTenants()` (already exported from `lib/gbrain/mutex.ts`) before executing the reset. If the tenant is in the pending queue, either: (a) abort the in-flight spawns first (via `abortTenant`, which already exists), wait for the abort to complete, then proceed; or (b) return a 409 Conflict with a "sync in progress, try again in a moment" message.
- The existing `abortTenant` + 2-second kill timeout in `client.ts` is the right mechanism. The reset endpoint must await the abort before calling `rm -rf`.
- For QBO users, the Reset button label changes to "Cancel Import" during an active sync, and the behavior is: cancel sync (not reset data).

**Phase:** Phase 6 (QBO) — this becomes critical when syncs are long-running.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `FIXTURES_ROOT` hardcoded as insight source for all tenants | Zero code change needed for v1.0 demo | Every real user gets Mara's insight data — silent wrong results | Never acceptable in v1.1; fix in Phase 4 |
| `panic-reset.sh` wipes all non-seed brains without confirmation | One-command clean slate for demo | Destroys real user data in v1.1 | Acceptable only in demo-mode (add `DEMO_ONLY` gate) |
| No token store (no auth.db) | No database setup | Magic-link tokens are infinitely replayable | Never acceptable once auth exists |
| Brain slug derived from business name | Human-readable dir names | Slug collisions between users | Acceptable in demo mode; add userId prefix in v1.1 |
| Mutex key is an untyped string | Simple implementation | Wrong string type silently bypasses isolation during migration | Acceptable in v1.0 single-slug world; add branded type in v1.1 |
| Insight cache is tenant-keyed but data source is global | Fast cache lookups | All tenants share one data source if not fixed | Never acceptable in v1.1 |
| QBO tokens stored in memory only (no persistence) | No storage needed for testing | Tokens lost on server restart; user must re-auth every deploy | Acceptable for Phase 6 first-pass; add persistence before any real user onboards |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| smb-audit skill ↔ `anomalies.ts` parser | Skill emits bare `[[slug]]` wikilinks | Parser requires `[[companies/<slug>]]` prefix; skill must always emit full path form |
| smb-audit skill ↔ QBO transformer | Skill tuned to synthetic schema, transformer writes QBO schema | Define canonical frontmatter schema (`type`, `vendor`, `date`, `amount`) before writing either; both must use it |
| `gbrain import` ↔ skill execution | Assuming non-zero exit means skill failed | gbrain may exit 0 and silently skip a failing skill; always check for output file existence after import |
| QBO OAuth ↔ Next.js Route Handler | Handling `code` exchange in a client component | OAuth callback must be a server-side Route Handler; never expose `QBO_CLIENT_SECRET` to the browser |
| QBO API ↔ token refresh | Calling refresh on every request | Refresh only when `expires_at < now + 5min`; unnecessary refreshes burn rate limit headroom |
| Magic-link token ↔ email delivery | Embedding the raw token in the link body | Hash the token for storage; verify by comparing `hash(incoming) === stored_hash`; prevents timing attacks |
| Per-user brain dir ↔ mutex | Passing userId as the mutex key | Mutex key must be `brain_slug` (the dir name); userId is not the lock domain |
| `panic-reset.sh` ↔ real user brains | Running panic-reset after first real user onboards | Add `AUTH_ENABLED` env check; refuse to wipe when real users exist |
| QBO `VendorRef.name` ↔ wikilink slug | Using raw QBO display name as the wikilink target | Slugify once with a shared function; use the same function for company page filename and invoice wikilinks |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Magic-link token reusable after first click | Account takeover via email log / browser history access | Single-use enforcement: mark token as used on first verification; store `used_at` in auth.db |
| `AUTH_SECRET` absent at startup → fallback to weak default | Token forgery — anyone can generate valid signed tokens | Refuse to start if `AUTH_SECRET` is missing or < 32 bytes; add to `demo-check.sh` |
| QBO OAuth secret committed to git | All users' QBO data accessible to anyone with repo access | Environment variable only; never in code; `.gitignore` the `.env.local` file |
| Per-user QBO refresh tokens in plaintext auth.db | Single database file leak exposes all user QBO connections | AES-256-GCM encrypt all token fields at rest; key from `AUTH_SECRET` |
| Brain_slug derived from user input without secondary validation | Path traversal: a slug like `../../etc` escapes `brains/` | The existing `assertTenantSlug` regex `[a-z0-9-]+` prevents this; ensure it is always called before brain dir operations |
| Reset endpoint callable by any authenticated user for any tenantId | User A resets User B's brain | Verify that the caller's session userId matches the tenantRecord's userId before executing reset |

---

## "Looks Done But Isn't" Checklist

- [ ] **smb-audit skill output:** Often missing correct format — verify `computeAnomalies(brainDir)` returns ≥3 rows after `gbrain import`.
- [ ] **Idempotent skill:** Often missing — run `gbrain import` twice; verify `concepts/march-anomaly-summary.md` has identical line count both times.
- [ ] **Tenant-aware insight source:** Often missing — verify that a real-user tenant's insight card shows THEIR data, not Mara's vendor spend.
- [ ] **QBO wikilinks to companies/:** Often missing — after QBO sync, run `gbrain graph-query <vendor-slug> --depth 2`; must return ≥2 neighbors.
- [ ] **Magic-link single-use:** Often missing — click the magic link a second time; must return an error ("link already used"), not log in.
- [ ] **QBO refresh token expiry warning:** Often missing — verify `refresh_token_issued_at` is stored and the banner logic is wired.
- [ ] **panic-reset.sh auth gate:** Often missing — verify the script refuses to wipe when `AUTH_ENABLED=1` is set.
- [ ] **Brain slug uniqueness:** Often missing — onboard two users with the same business name; verify they get separate brain dirs.
- [ ] **Mutex key is brain_slug not userId:** Often missing — run `scripts/concurrent-smoke.ts` against a v1.1 tenant after auth migration.
- [ ] **QBO date field is TxnDate:** Often missing — verify a January invoice's frontmatter `date:` matches QBO `TxnDate`, not `MetaData.LastUpdatedTime`.
- [ ] **Email delivery from real email client:** Often missing — send the magic link and receive it in Gmail; verify it does not land in spam.
- [ ] **QBO onboarding "still importing" UX:** Often missing — start QBO sync and immediately navigate away; verify the "import in progress" state persists correctly.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Insight parsers use FIXTURES_ROOT for all tenants | MEDIUM — caught late | Update `computeAndCache` call sites to pass `tenant.brainHome`; requires tenant record to carry brainHome; ~1h |
| Skill output format mismatch | LOW — caught early via test | Update skill template string to match `anomalies.ts` regex; re-run `gbrain import`; ~30min |
| QBO schema divergence from synthetic seed | MEDIUM | Define canonical schema; update transformer field mapping; re-run QBO sync; ~2h |
| Mutex key migration bug | LOW — caught via concurrent-smoke | Revert to brain_slug keying; restart server; ~30min |
| panic-reset wipes real user data | HIGH — data is gone | Re-trigger QBO sync to reimport; brain is reproducible from QBO but takes 2–5min per user |
| Magic-link replay attack | HIGH if exploited | Immediately rotate `AUTH_SECRET` (invalidates all existing sessions); deploy fix; notify affected users |
| QBO refresh token expired | LOW if detected early | Surface reconnect CTA; user re-auths in QBO; ~1min user action |
| QBO 429 during sync | LOW — retryable | Implement `Retry-After` backoff; resume sync from last successful page; ~1h to implement properly |
| Brain slug collision | MEDIUM | Add userId prefix to slug; migrate existing brain dirs; update tenant registry; ~1h |

---

## Pitfall-to-Phase Mapping

| # | Pitfall | Severity | Phase | Verification |
|---|---------|----------|-------|--------------|
| 1 | Insight parsers hardcoded to FIXTURES_ROOT | Critical | Phase 4 | Demo tenant cards load from FIXTURES_ROOT; real-user tenant cards load from brain dir |
| 2 | Skill output format mismatch breaks anomaly parser | Critical | Phase 4 | `computeAnomalies(brainDir)` returns ≥3 rows after import |
| 3 | QBO schema diverges from synthetic seed schema | Critical | Phase 4 defines contract, Phase 6 honors it | smb-audit skill run against QBO-imported brain returns ≥1 anomaly |
| 4 | Mutex keyed by wrong identifier during tenant model migration | Critical | Phase 5 | `concurrent-smoke.ts` passes against v1.1 tenant |
| 5 | panic-reset.sh wipes real user data | Critical | Phase 5 | Script refused with `AUTH_ENABLED=1` set |
| 6 | Magic-link tokens are replayable | Critical | Phase 5 | Second click on used link returns 400/401 |
| 7 | QBO refresh token 100-day expiry | Critical | Phase 6 | `refresh_token_issued_at` stored; reconnect banner fires at day 86 |
| 8 | Skill failure mode during import unknown | High | Phase 4 | Spike: intentionally break skill, observe exit code and stderr |
| 9 | Skill appends instead of overwrites (non-idempotent) | High | Phase 4 | Three consecutive imports produce identical concept page |
| 10 | `SameSite=Lax` cookie + email link redirect | High | Phase 5 | End-to-end flow tested from Gmail in a fresh browser window |
| 11 | Email deliverability — magic links go to spam | High | Phase 5 | Magic link received in primary Gmail inbox within 60s |
| 12 | QBO rate limits hit during initial sync | High | Phase 6 | Sync completes with `Retry-After` backoff; no 429 errors in logs |
| 13 | QBO vendor slug inconsistency — graph stays orphaned | High | Phase 6 | `gbrain graph-query <vendor>` returns ≥2 neighbors after QBO sync |
| 14 | Wrong QBO date field — TxnDate vs LastUpdatedTime | High | Phase 6 | January invoice `date:` frontmatter matches QBO `TxnDate` |
| 15 | Session cookie not visible in RSC same-request | High | Phase 5 | Network tab shows `Set-Cookie` on 302; `Cookie` on dashboard GET |
| 16 | QBO OAuth tokens stored unencrypted | High | Phase 5 (design), Phase 6 (impl) | `data/auth.db` contains no plaintext token fields |
| 17 | Skill has no access to app env vars | Medium | Phase 4 | Skill reads only from brain dir pages, not process.env or FIXTURES_ROOT |
| 18 | Wrong skill trigger declaration | Medium | Phase 4 | `gbrain check-resolvable --strict` passes; concept pages appear after import |
| 19 | Migrating to per-tenant brain dir breaks demo seed path | Medium | Phase 4 | Demo/seed tenant insight cards still load after tenant-aware fix |
| 20 | QBO sandbox vs. production realm confusion | Medium | Phase 6 | Connected company name displayed after OAuth; matches real QuickBooks company |
| 21 | Brain slug collision between users | Medium | Phase 5 | Two users with identical business names get separate brain dirs |
| 22 | QBO sync exceeds 60-second onboarding promise | Medium | Phase 6 | "Import in progress" UX shown for QBO users; cards load when sync completes |
| 23 | Reset during active QBO sync corrupts brain dir | Medium | Phase 6 | Reset button shows "Cancel Import" during sync; awaits abort before rm -rf |

---

## Sources

- v1.0 codebase — read directly: `lib/gbrain/client.ts`, `lib/gbrain/mutex.ts`, `lib/gbrain/tenants.ts`, `lib/gbrain/paths.ts`, `lib/insights/anomalies.ts`, `lib/insights/cache.ts`, `lib/insights/prewarm.ts`, `lib/insights/top-vendors.ts`, `lib/insights/pnl.ts`, `app/api/tenants/[id]/insights/route.ts`, `app/api/tenants/[id]/reset/route.ts`, `scripts/detect-anomalies.ts`, `scripts/panic-reset.sh`. (HIGH confidence — sourced from the actual repo.)
- `.planning/v1.0-MILESTONE-AUDIT.md` — tech debt section, confirmed architectural decisions and known trade-offs. (HIGH confidence.)
- `.planning/research/v1.0-archive/PITFALLS.md` — v1.0 pitfall catalogue; Pitfall 17 (skill authoring), Pitfall 3 (PGLite mutex). (HIGH confidence — no re-research needed.)
- `CLAUDE.md` stack section — confirmed GBRAIN_HOME behavior, per-tenant brain dir pattern, slug validation. (HIGH confidence.)
- QuickBooks Online OAuth 2.0 documentation (Intuit Developer) — 100-day refresh token expiry, realm IDs, rate limits (500 req/min per realm). (MEDIUM confidence — from training data pattern, should be verified against current Intuit docs before Phase 6.)
- Next.js 15 App Router cookie semantics — `cookies()` async behavior, `Set-Cookie` on redirect, RSC streaming. (MEDIUM confidence — well-established 2025/2026 pattern.)

---
*Pitfalls research for: QuickBrain v1.1 — smb-audit skill + email auth + QBO ingest on top of v1.0 codebase.*
*Researched: 2026-05-17*
