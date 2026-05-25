---
status: partial
phase: 06-auth-multi-tenant-isolation
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md, 06-05-SUMMARY.md]
started: 2026-05-23T00:00:00Z
updated: 2026-05-24T16:10:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete — 10 pass, 1 issue (insights ENOENT), 1 skipped (cross-tenant — covered by structural test)]

## Tests

### 1. Cold Start Smoke Test
expected: Kill dev server. Run `bun run setup-auth-tables` (idempotent DDL — should succeed on re-run with no errors). Start `bun dev` (or hit live URL). Server boots without errors, the landing page loads, no 500s, no "missing JWT_SECRET / RESEND_API_KEY" crashes on first request.
result: pass

### 2. Landing CTA Routes to Sign-In
expected: Visit `/` while signed out. CTA button label says "Sign in" (not "Onboard"). Clicking it navigates to `/sign-in`. The form is rendered, no /onboard reference visible on the landing page.
result: pass

### 3. Sign-In Form — Send Magic Link
expected: On `/sign-in`, type your email and submit. The form shows a "submitting" state (button disabled / loading), then transitions to a "sent" confirmation: "Check your email for a one-time sign-in link" with mention of 15-minute expiry. No errors on the page.
result: pass
note: "First attempt 500'd because JWT_SECRET was missing from .env.local (operator precondition not met). Resolved by generating a local JWT_SECRET and adding RESEND_API_KEY. Retried successfully. Vercel-side env vars for JWT_SECRET/RESEND_API_KEY/TOKEN_ENCRYPTION_KEY are saved as empty strings in Preview+Production — operator must re-save them in the Vercel dashboard before deploying."

### 4. Magic Link Email Arrives via Resend
expected: Within ~5 seconds of submitting the form, an email arrives in the typed inbox from the Resend sending domain. Email body contains a verification link pointing to `/auth/verify?token=...`, plus copy referencing "one-time sign-in link" and "expires in 15 minutes". Plain-text fallback present.
result: pass

### 5. Rate-Limit Resend (60s window)
expected: After step 3 succeeds, immediately submit the same email again. The form returns a rate-limited message (HTTP 429 surfaced as friendly copy — not a stack trace). After ~60s, submitting works again. No duplicate email arrives in inbox during the throttled window.
result: pass

### 6. Click Magic Link → Sign In + Brain Provisioned
expected: Click the magic link in the email. Browser lands on `/dash/<some-slug>` (a `u-<14-hex>`-derived slug for first sign-in). No "tenant_not_found" error. A dashboard surface renders with the sign-out control top-right. A `qb_session` cookie is set (DevTools → Application → Cookies: httpOnly, SameSite=Lax, ~30d maxAge).
result: pass
note: "Required TWO fixes to reach pass: (1) package.json dev script changed to `bun --bun next dev` so Bun runtime loads gbrain's raw .ts (commit 2c141f0). (2) lib/auth/provision.ts called engine.executeRaw via an aliased variable, detaching `this` from the receiver and throwing on `this.sql` access — fixed by calling on the engine directly (commit 67614fa). After both fixes, magic-link click landed on /dash/u-748ccc135b0073 with sign-out visible top-right. A separate insights 500 surfaced on the dashboard — logged under test 11."

### 7. Unauthenticated /dash Redirect
expected: Open a private/incognito window (no qb_session cookie). Visit `/dash/anything`. Middleware redirects you to `/sign-in?next=/dash/anything`. Visiting `/api/tenants/anything/insights` or `/api/tenants/anything/chat` returns 401 (not the dashboard, not a 500).
result: pass

### 8. Slug-Mismatch Redirect to Own Dashboard
expected: While signed in (from step 6) at `/dash/<your-slug>`, manually change the URL to `/dash/<some-other-slug>`. Page redirects you back to YOUR dashboard at `/dash/<your-slug>` (T-06-18). You never see another user's dashboard contents.
result: pass

### 9. Used / Expired Link Page
expected: Take the same magic link from step 4 (already consumed in step 6) and click it again. Browser lands on `/auth/link-used` showing "This link can't be used" copy and an email-input + "Resend magic link" action. Submitting the resend form triggers a new email.
result: pass

### 10. Sign-Out Revokes Session
expected: From the dashboard, click the Sign-out button (ghost button with LogOut icon, top-right). Button briefly shows "signing-out" state. You're redirected to `/sign-in` (or landing). The `qb_session` cookie is cleared. Refreshing `/dash/<your-slug>` redirects you back to `/sign-in` — old session is dead even server-side.
result: pass

### 11. Chat Returns Real Answer for Your Brain (not tenant_not_found)
expected: Sign in again (fresh session). On your dashboard, ask a chat question. The chat returns a real gbrain answer (or an empty/no-data answer if Phase 7 QBO ingest hasn't run — that's expected). It does NOT return "tenant_not_found" or 401/403/500. Insights cards render (may be empty for a fresh tenant with no ingested data — D-02 accepted).
result: issue
reported: "Chat returns a real gbrain answer (PASS half). Insights cards FAIL: 'Insights API error: 500 {\"error\":\"compute_failed\",\"message\":\"ENOENT: no such file or directory, scandir /Users/abdulhannankanji/Git repos/quick-brain/brains/u-748ccc135b0073/brain-repo/originals\"}'. The insights compute is scandir'ing a directory that doesn't exist for a fresh tenant. Per design D-02, missing data should yield empty insights, not 500."
severity: major

### 12. Cross-Tenant Isolation Spot Check
expected: Sign in as User A and ask a chat question with a unique marker phrase. Sign out. Sign in as a SECOND email (User B — fresh brain). Ask the same question. User B should NOT see User A's data or marker. Each user's chat/insights are scoped to their own session-derived source_id.
result: skipped
reason: "User skipped; no reason provided. Note: cross-tenant isolation is structurally covered by tests/auth/cross-tenant-isolation.test.ts (3 structural assertions pass in CI, 4 integration assertions RUN_INTEGRATION-gated)."

## Summary

total: 12
passed: 10
issues: 1
pending: 0
skipped: 1
blocked: 0

## Gaps

- truth: "Clicking the magic link signs the user in: GET /auth/verify consumes the token, provisions a brain on first sign-in, sets the qb_session cookie, and redirects to /dash/<brainSlug> without a 500"
  status: failed
  reason: "User reported: GET /auth/verify 500s with 'Stripping types is currently unsupported for files under node_modules' for node_modules/gbrain/src/core/ai/gateway.ts. Local dev only — deployed Vercel function is fixed by the four recent commits."
  severity: blocker
  test: 6
  root_cause: "TWO sequential bugs. (1) package.json:7 had `\"dev\": \"next dev\"`. `bun run` respected the `next` CLI's Node shebang, so dev server ran under Node 24, which refuses to TS-strip node_modules/gbrain/src/**. (2) lib/auth/provision.ts aliased engine.executeRaw into a local variable, detaching `this` — the method body reads this.sql which then threw `undefined is not an object`."
  artifacts:
    - path: "package.json"
      issue: "Line 7 dev script used `next dev` (Node host) instead of `bun --bun next dev` (Bun host) — inconsistent with start script."
    - path: "lib/auth/provision.ts"
      issue: "Line 100-103 aliased engine.executeRaw into a const, detaching `this` from the receiver."
  missing:
    - "package.json: change dev script to `bun --bun next dev` (commit 2c141f0)."
    - "lib/auth/provision.ts: call `engine.executeRaw(...)` directly via typed cast on engine, not via aliased method reference (commit 67614fa)."
  debug_session: ".planning/debug/06-verify-route-ts-strip.md"
  fixed_in: ["2c141f0", "67614fa"]
  status_resolved: passed

[Operator action still required to re-save the (currently empty-string) Vercel env vars for JWT_SECRET / RESEND_API_KEY / TOKEN_ENCRYPTION_KEY in Preview + Production before deploying — separately noted from test 3.]

- truth: "Insights cards render empty (or 200 with empty data) for a fresh authenticated tenant with no ingested data — D-02 accepted no-data case"
  status: failed
  reason: "User reported: GET /api/tenants/<slug>/insights returns 500 with 'ENOENT: no such file or directory, scandir .../brains/<slug>/brain-repo/originals'. For a fresh tenant the brain-repo/originals dir doesn't exist; the insights compute path (lib/insights/cache.ts::computeAndCache → file walker) throws instead of returning empty. Per D-02 + 06-05 SUMMARY, missing data should yield empty insights gracefully (not a 500). Chat works correctly — issue is scoped to the insights compute path."
  severity: major
  test: 11
  root_cause: ""     # Filled by diagnosis
  artifacts: []      # Filled by diagnosis
  missing: []        # Filled by diagnosis
  debug_session: ""  # Filled by diagnosis
