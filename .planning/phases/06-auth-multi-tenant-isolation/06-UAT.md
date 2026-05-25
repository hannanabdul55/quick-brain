---
status: diagnosed
phase: 06-auth-multi-tenant-isolation
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md, 06-03-SUMMARY.md, 06-04-SUMMARY.md, 06-05-SUMMARY.md]
started: 2026-05-23T00:00:00Z
updated: 2026-05-24T15:40:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing paused — 4 tests blocked on test 6 gbrain TS-stripping bug; 1 real issue diagnosed and queued for fix planning]

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
result: issue
reported: "Error: Stripping types is currently unsupported for files under node_modules, for 'file:///Users/abdulhannankanji/Git%20repos/quick-brain/node_modules/gbrain/src/core/ai/gateway.ts' — stripTypeScriptModuleTypes / ModuleLoader (Node.js internal). Magic-link verify route imports gbrain (which ships raw .ts in node_modules) under Node.js runtime; Node 24's type stripper refuses to strip TS types from node_modules. Local `bun dev` doesn't honor the vercel.ts Bun-runtime pin for app/auth/**/*.ts — that only takes effect on deployed Vercel functions."
severity: blocker

### 7. Unauthenticated /dash Redirect
expected: Open a private/incognito window (no qb_session cookie). Visit `/dash/anything`. Middleware redirects you to `/sign-in?next=/dash/anything`. Visiting `/api/tenants/anything/insights` or `/api/tenants/anything/chat` returns 401 (not the dashboard, not a 500).
result: pass

### 8. Slug-Mismatch Redirect to Own Dashboard
expected: While signed in (from step 6) at `/dash/<your-slug>`, manually change the URL to `/dash/<some-other-slug>`. Page redirects you back to YOUR dashboard at `/dash/<your-slug>` (T-06-18). You never see another user's dashboard contents.
result: blocked
blocked_by: prior-phase
reason: "Depends on test 6 (sign-in via verify route), which currently 500s on the gbrain TS-stripping bug. Cannot reach a signed-in /dash/<slug> state to test slug-mismatch behavior."

### 9. Used / Expired Link Page
expected: Take the same magic link from step 4 (already consumed in step 6) and click it again. Browser lands on `/auth/link-used` showing "This link can't be used" copy and an email-input + "Resend magic link" action. Submitting the resend form triggers a new email.
result: blocked
blocked_by: prior-phase
reason: "Depends on test 6 (verify route consumes a link). Same gbrain TS-stripping 500 prevents producing a 'consumed link' state to retry."

### 10. Sign-Out Revokes Session
expected: From the dashboard, click the Sign-out button (ghost button with LogOut icon, top-right). Button briefly shows "signing-out" state. You're redirected to `/sign-in` (or landing). The `qb_session` cookie is cleared. Refreshing `/dash/<your-slug>` redirects you back to `/sign-in` — old session is dead even server-side.
result: blocked
blocked_by: prior-phase
reason: "Depends on test 6 (signed-in session reachable). Same gbrain TS-stripping 500 blocks any path to a dashboard sign-out button."

### 11. Chat Returns Real Answer for Your Brain (not tenant_not_found)
expected: Sign in again (fresh session). On your dashboard, ask a chat question. The chat returns a real gbrain answer (or an empty/no-data answer if Phase 7 QBO ingest hasn't run — that's expected). It does NOT return "tenant_not_found" or 401/403/500. Insights cards render (may be empty for a fresh tenant with no ingested data — D-02 accepted).
result: blocked
blocked_by: prior-phase
reason: "Depends on test 6 (signed-in session reachable). Without sign-in, no /dash/<slug> chat surface to query."

### 12. Cross-Tenant Isolation Spot Check
expected: Sign in as User A and ask a chat question with a unique marker phrase. Sign out. Sign in as a SECOND email (User B — fresh brain). Ask the same question. User B should NOT see User A's data or marker. Each user's chat/insights are scoped to their own session-derived source_id.
result: blocked
blocked_by: prior-phase
reason: "Depends on test 6 (signed-in session reachable). The whole multi-tenant isolation flow requires two working sign-ins; both gated by the same TS-stripping 500."

## Summary

total: 12
passed: 6
issues: 1
pending: 0
skipped: 0
blocked: 5

## Gaps

- truth: "Clicking the magic link signs the user in: GET /auth/verify consumes the token, provisions a brain on first sign-in, sets the qb_session cookie, and redirects to /dash/<brainSlug> without a 500"
  status: failed
  reason: "User reported: GET /auth/verify 500s with 'Stripping types is currently unsupported for files under node_modules' for node_modules/gbrain/src/core/ai/gateway.ts. Local dev only — deployed Vercel function is fixed by the four recent commits."
  severity: blocker
  test: 6
  root_cause: "`package.json:7` declares `\"dev\": \"next dev\"`. Bun's `bun run` respects the `next` CLI shebang (`#!/usr/bin/env node`), so `bun dev` actually launches Next.js under Node 24, not Bun. The verify route's `nodejs` runtime then runs under that Node host. Its import chain (provision.ts → engine.ts → @/types/gbrain::configureGateway) dynamically imports `gbrain/ai/gateway`; with `serverExternalPackages: [\"gbrain\"]` keeping webpack out, resolution falls to Node's loader, which refuses to TS-strip files under node_modules. Send-link route passes because it never imports gbrain."
  artifacts:
    - path: "package.json"
      issue: "Line 7 dev script uses `next dev` (Node host) instead of `bun --bun next dev` (Bun host). Existing start script already uses the Bun form — dev script is inconsistent."
  missing:
    - "Change `package.json` dev script to `bun --bun next dev` to match start script and the gbrain shim's documented Bun-runtime contract (types/gbrain.ts:22–25)."
  debug_session: ".planning/debug/06-verify-route-ts-strip.md"

[Operator action still required to re-save the (currently empty-string) Vercel env vars for JWT_SECRET / RESEND_API_KEY / TOKEN_ENCRYPTION_KEY in Preview + Production before deploying — separately noted from test 3.]
