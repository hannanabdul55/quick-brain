---
phase: 04-vercel-deploy-observability
verified: 2026-05-21T09:10:28Z
status: human_needed
score: 4/5 must-haves verified
overrides_applied: 0
deferred:
  - truth: "The deployed POST /api/tenants/[id]/chat returns a real gbrain answer — not a 500 or MODULE_NOT_FOUND"
    addressed_in: "Phase 6"
    evidence: "Documented in .planning/todos/pending/tenant-registry-deploy-persistent.md (resolves_phase: 6). lib/gbrain/tenants.ts resolves tenants from brains/<slug>/ local filesystem directories (gitignored, absent on Vercel). Phase 6 AUTH-04 requires per-user brain provisioning from persistent storage (Supabase), which is the correct fix. The Bun runtime risk and file-tracing risk are both proven resolved — the chat route returns a clean 404 tenant_not_found, NOT MODULE_NOT_FOUND."
human_verification:
  - test: "Confirm a server error thrown by a deployed Route Handler appears in the Sentry dashboard"
    expected: "Within ~1 minute of triggering an unhandled server error on https://quickbrain-brown.vercel.app, an event is visible in the Sentry project under Issues; the event captures the stack trace but contains no secret values or chat question text in its context/breadcrumbs"
    why_human: "Sentry dashboard visibility requires a human with access to the Sentry project. The SDK wiring (onRequestError = Sentry.captureRequestError, withSentryConfig, correct DSN in Vercel env) is verified in code; operational capture in the live dashboard requires a human to trigger an error and inspect Sentry."
  - test: "Confirm an unhandled client-side React render error from the deployed app appears in the Sentry dashboard"
    expected: "Triggering a client render crash on the deployed app causes an event to appear in Sentry within ~1 minute, captured via global-error.tsx calling Sentry.captureException; no error.message is shown to the user"
    why_human: "Requires browser access to the deployed app plus Sentry dashboard access. The code path (global-error.tsx with captureException in useEffect) is verified in code; operational end-to-end requires a human."
  - test: "Confirm Sentry captured events carry no secrets or PII"
    expected: "Inspecting the event context and breadcrumbs in the Sentry dashboard: no connection string (postgres://...), no service-role key, no OPENAI_API_KEY/ANTHROPIC_API_KEY values, and no chat question text appear in any captured event"
    why_human: "The beforeSend hooks in sentry.server.config.ts and sentry.edge.config.ts are currently pass-through (intentionally minimal per plan); empirical verification that no secrets flow through requires inspecting actual captured events in Sentry."
---

# Phase 4: Vercel Deploy + Observability Verification Report

**Phase Goal:** The app runs at a real public URL with secrets in Vercel config, error tracking active, and a health endpoint confirming all subsystems are reachable
**Verified:** 2026-05-21T09:10:28Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | App is deployed at a real public URL, building from git push to main (DEPLOY-01) | VERIFIED | Live orchestrator check: GET https://quickbrain-brown.vercel.app returns HTTP 200. Vercel Git integration connects GitHub main branch. vercel.json confirms bunVersion 1.x + bun@1.2.0 function runtime. Commits a386c4d, 48c2a33 in git history. |
| 2 | All 13 secrets live in Vercel encrypted env config; none in the repo (DEPLOY-02) | VERIFIED | Live orchestrator check: vercel env ls production returns all 13 keys. git ls-files returns only .env.example (no .env or .env.local tracked). .env.example contains all 13 keys with no values. |
| 3 | GET /api/health returns 200 with app, gbrainDb, storage all ok:true (DEPLOY-03) | VERIFIED | Live orchestrator check: GET /api/health returns HTTP 200 with status:"ok" and all three subsystems ok:true. Code verified: route.ts exports GET + dynamic + runtime="nodejs", uses Promise.all([timed(probeGbrainDb), timed(probeStorage)]), returns 200/503. probes.ts exports probeGbrainDb (throwaway SELECT 1, never enginePool), probeStorage (createStorage().exists), withTimeout, timed, Probe type. No secrets in payload. |
| 4 | Sentry SDK is wired — server errors captured via onRequestError, client errors via global-error.tsx (DEPLOY-04 — code wiring) | VERIFIED | instrumentation.ts: exports onRequestError = Sentry.captureRequestError (count 1). instrumentation-client.ts: Sentry.init with DSN + beforeSend hook. sentry.server.config.ts + sentry.edge.config.ts: Sentry.init with beforeSend hooks. app/global-error.tsx: "use client", captureException in useEffect, html+body shell, no error.message rendered. next.config.ts: withSentryConfig wraps nextConfig. @sentry/nextjs@^10.53.1 in package.json. No sentry.client.config.ts. SENTRY_AUTH_TOKEN never NEXT_PUBLIC_-prefixed. |
| 5 | docs/deploy.md documents Hobby-tier limits and the deliberate Hobby-to-Pro upgrade trigger (DEPLOY-05) | VERIFIED | docs/deploy.md is 238 lines. Contains Vercel Hobby Free-Tier Limits table with 300s default timeout (not 10s/60s). Explicitly states "The old 10s/60s timeout framing in the roadmap is obsolete." Hobby->Pro trigger section states "Trigger: First real / commercial user — NOT a timeout." Documents all 13 env vars, runtime decision rationale (Bun required for gbrain raw .ts), and deploy flow. |

**Score:** 5/5 truths verified (DEPLOY-04 operational dashboard confirmation is a human_verification item; the code wiring is verified)

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Deployed POST /api/tenants/[id]/chat returns a real gbrain answer | Phase 6 | lib/gbrain/tenants.ts resolves tenants from local brains/<slug>/ directories (gitignored, absent on Vercel stateless filesystem). Explicitly deferred and documented in .planning/todos/pending/tenant-registry-deploy-persistent.md (resolves_phase: 6). Phase 6 AUTH-04 covers per-user brain provisioning from Supabase. The Bun runtime + file-tracing risks are resolved: chat route runs gbrain code and returns 404 tenant_not_found (clean app-level miss), NOT MODULE_NOT_FOUND. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|---------|--------|---------|
| `lib/health/probes.ts` | Three reachability probes + timeout helpers | VERIFIED | Exists, 140+ lines. Exports Probe type, withTimeout, timed, probeGbrainDb, probeStorage. DB probe uses throwaway postgres connection (never enginePool). Storage probe uses createStorage().exists. No @supabase/supabase-js import. All forbidden patterns (createGBrainEngine, enginePool, @supabase/supabase-js) appear only in comments. |
| `app/api/health/route.ts` | GET /api/health Route Handler | VERIFIED | Exists. Exports GET, dynamic="force-dynamic", runtime="nodejs". Uses Promise.all([timed(probeGbrainDb), timed(probeStorage)]). Returns 200/503. No postgres://, SERVICE_ROLE, or other secrets in the handler. |
| `tests/unit/health/health-probes.test.ts` | Unit tests for probe module | VERIFIED | Exists at tests/unit/health/health-probes.test.ts. SUMMARY-01 reports 10/10 tests passing. |
| `instrumentation.ts` | Server/edge Sentry registration + onRequestError | VERIFIED | Exists. Exports onRequestError = Sentry.captureRequestError. Conditionally imports sentry.server.config (nodejs) or sentry.edge.config (edge). |
| `instrumentation-client.ts` | Browser-side Sentry.init | VERIFIED | Exists. Calls Sentry.init with DSN + beforeSend hook. |
| `sentry.server.config.ts` | Node.js Sentry init with beforeSend | VERIFIED | Exists. Sentry.init with tracesSampleRate:0.1, beforeSend pass-through with PII scrubbing comment. |
| `sentry.edge.config.ts` | Edge Sentry init with beforeSend | VERIFIED | Exists. Same structure as server config. |
| `app/global-error.tsx` | Client error boundary with captureException | VERIFIED | Exists. "use client" directive. captureException in useEffect. Returns html+body shell. Never renders error.message. No sentry.client.config.ts. |
| `next.config.ts` | Sentry-wrapped; gbrain externalization preserved; outputFileTracingIncludes | VERIFIED | withSentryConfig wraps nextConfig. serverExternalPackages:["gbrain"] preserved. gbrainExternalsFn webpack externals function preserved. outputFileTracingIncludes for gbrain + postgres + @electric-sql/pglite + tree-sitter-wasms + web-tree-sitter. No `from "webpack"` import. |
| `vercel.json` | Bun runtime config | VERIFIED | bunVersion:"1.x", functions runtime bun@1.2.0 for app/api/**/*.ts. No maxDuration override. Valid JSON. |
| `docs/deploy.md` | Deploy runbook + Hobby limits + upgrade trigger | VERIFIED | 238 lines. Covers deploy flow, env inventory (13 keys), Bun runtime decision rationale, Hobby-tier table (300s timeout, commercial-use restriction), Hobby->Pro upgrade trigger (first commercial user). |
| `.env.example` | All 13 env keys, no values | VERIFIED | All 13 keys present with empty values. No real secrets. RESEND_API_KEY commented as Phase 6 precondition. Not git-ignored. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| app/api/health/route.ts | lib/health/probes.ts | import { probeGbrainDb, probeStorage, timed } | WIRED | Import confirmed in route.ts; probes called in Promise.all |
| lib/health/probes.ts | GBRAIN_DATABASE_URL / SUPABASE_DB_URL_POOLER env | process.env resolution fallback chain | WIRED | Exact fallback chain from engine.ts: GBRAIN_DATABASE_URL ?? SUPABASE_DB_URL_POOLER |
| lib/health/probes.ts | lib/storage createStorage().exists | Storage reachability HEAD request | WIRED | createStorage() imported from @/lib/storage; .exists(".health-check") called |
| instrumentation.ts | Sentry server error capture | export const onRequestError = Sentry.captureRequestError | WIRED | Verified in instrumentation.ts code |
| next.config.ts | gbrain externalization (commit c49a927) | serverExternalPackages + gbrainExternalsFn survive withSentryConfig wrap | WIRED | Both present in next.config.ts after Sentry wrap |
| app/global-error.tsx | Sentry client error capture | Sentry.captureException(error) in useEffect | WIRED | Verified in global-error.tsx |
| next.config.ts | gbrain WASM deps in Vercel bundle | outputFileTracingIncludes node_modules/gbrain/** and 4 WASM dep paths | WIRED | All 5 glob entries present in outputFileTracingIncludes |
| git push main | Vercel build then live URL | Vercel Git integration | WIRED (live) | Orchestrator confirmed: live deployment at quickbrain-brown.vercel.app |

### Data-Flow Trace (Level 4)

Health endpoint is not a dynamic data-rendering component — it probes subsystems and returns structured results. Level 4 data-flow check: the probes reach real subsystems (not static returns).

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| lib/health/probes.ts probeGbrainDb | SELECT 1 result | postgres() throwaway connection to GBRAIN_DATABASE_URL | Yes — actual DB round-trip; no static return | FLOWING |
| lib/health/probes.ts probeStorage | exists(".health-check") result | createStorage().exists HEAD request | Yes — actual HTTP call; false return on absent file is not a failure | FLOWING |
| app/api/health/route.ts | gbrainDb, storage probe results | timed(probeGbrainDb), timed(probeStorage) | Yes — live probe results drive 200/503 response | FLOWING |

Live confirmation: orchestrator verified GET /api/health returns 200 with all three subsystems ok:true, which requires real DB and storage connectivity.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| App loads at public URL (DEPLOY-01) | GET https://quickbrain-brown.vercel.app | HTTP 200 | PASS (live, orchestrator) |
| Health endpoint 3-subsystem JSON (DEPLOY-03) | GET /api/health | HTTP 200, status:"ok", all checks ok:true | PASS (live, orchestrator) |
| Secrets in Vercel env (DEPLOY-02) | vercel env ls production | 13 keys present | PASS (live, orchestrator) |
| No secrets in repo | git ls-files \| grep .env | Only .env.example | PASS |
| Bun runtime loads gbrain code | Deployed chat route | Returns tenant_not_found not MODULE_NOT_FOUND | PASS (live, orchestrator) — proves Bun runtime + file tracing work |

### Probe Execution

Step 7c: SKIPPED — no probe-*.sh files declared in plans or found at conventional paths. Phase relies on live Vercel deployment verification performed by the orchestrator.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DEPLOY-01 | 04-03-PLAN.md | App deployed to Vercel at a real URL, building from main | SATISFIED | Live: HTTP 200 at quickbrain-brown.vercel.app; Git integration confirmed; vercel.json + commits in repo |
| DEPLOY-02 | 04-03-PLAN.md | All secrets in Vercel encrypted env config, none in repo | SATISFIED | Live: vercel env ls production shows 13 keys; git ls-files returns only .env.example |
| DEPLOY-03 | 04-01-PLAN.md | /api/health endpoint reports app, gbrain DB, and storage reachability | SATISFIED | Live: HTTP 200, all three subsystems ok:true. Code verified at all four levels. |
| DEPLOY-04 | 04-02-PLAN.md | Sentry captures unhandled server and client errors in deployed app | PARTIALLY SATISFIED | Code wiring verified (onRequestError, global-error.tsx, withSentryConfig, DSN in Vercel env). Operational dashboard capture requires human verification (see Human Verification section). REQUIREMENTS.md marks this Pending — consistent with human_needed status. |
| DEPLOY-05 | 04-03-PLAN.md | App stays within Vercel Hobby limits; Hobby-to-Pro upgrade is documented and deliberate | SATISFIED | docs/deploy.md: 238 lines, 300s timeout documented, commercial-use restriction documented, upgrade trigger tied to first real user. REQUIREMENTS.md marks this Complete. |

Note: REQUIREMENTS.md traceability table marks DEPLOY-03 and DEPLOY-04 as "Pending" (not yet updated post-execution). Based on codebase evidence plus live orchestrator facts, DEPLOY-03 is fully satisfied. DEPLOY-04 is code-satisfied with operational confirmation pending human verification.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| sentry.server.config.ts | beforeSend | Pass-through hook | Info | Intentional — the beforeSend is explicitly a placeholder marked as the scrubbing point (T-04-05). Not a stub: it returns the event, meaning errors ARE captured. The comment instructs future maintainers to add field-level scrubbing when specific PII fields are identified. No blocker. |
| sentry.edge.config.ts | beforeSend | Pass-through hook | Info | Same as above. |
| instrumentation-client.ts | beforeSend | Pass-through hook | Info | Same pattern. |

No TBD, FIXME, or XXX markers found in any Phase 4 modified files. No unreferenced debt markers.

### Human Verification Required

### 1. Sentry Server Error Capture (DEPLOY-04)

**Test:** Trigger an unhandled server error on the deployed app at https://quickbrain-brown.vercel.app — for example, visit a route that throws deliberately, or invoke an endpoint with a malformed payload that bypasses try/catch.
**Expected:** Within ~1 minute, an error event appears in the Sentry project dashboard under Issues. The event should show the Route Handler call stack. The event context and breadcrumbs must NOT contain connection strings, API key values, or chat question text.
**Why human:** Requires access to the Sentry dashboard and the deployed app. The SDK wiring is code-verified but the operational end-to-end capture (DSN resolves, SDK initialises in the Bun runtime, events reach Sentry over the network) requires a live check.

### 2. Sentry Client Error Capture (DEPLOY-04)

**Test:** Trigger an unhandled client-side React render error on the deployed app — for example, by navigating to a page that throws in a render function, or by using browser DevTools to inject a JS error.
**Expected:** global-error.tsx boundary catches it, Sentry.captureException fires, and within ~1 minute the event appears in the Sentry dashboard. The page should show the generic "Something went wrong." message, not the raw error.message.
**Why human:** Requires browser access to the deployed app plus Sentry dashboard access to confirm the event arrived.

### 3. Sentry Events Carry No Secrets or PII (Security Domain V7)

**Test:** Inspect the context, extra, and breadcrumbs of any captured Sentry event from the deployed app.
**Expected:** No value matches any of: postgres connection string pattern (postgres://...), service-role key, OPENAI_API_KEY value, ANTHROPIC_API_KEY value, or any chat question text. The beforeSend hooks are currently pass-throughs; this check confirms that Next.js / @sentry/nextjs does not auto-attach process.env or request bodies that contain secrets.
**Why human:** Requires inspecting actual event payloads in the Sentry dashboard — not verifiable by static code analysis alone.

### Gaps Summary

No blocking gaps. All five DEPLOY requirements have code-level evidence. The only outstanding items are:

1. **Human verification of Sentry dashboard capture** (DEPLOY-04 operational) — code wiring is complete; live event visibility requires a human with Sentry access. This is the sole reason status is human_needed rather than passed.

2. **Deferred: chat returns real gbrain answer** — explicitly deferred to Phase 6 (tenant-registry-deploy-persistent.md). The infrastructure risk (Bun runtime + file tracing) is proven resolved. The remaining gap is architectural (tenant registry uses local filesystem, incompatible with Vercel stateless), not a Phase 4 failure.

---

_Verified: 2026-05-21T09:10:28Z_
_Verifier: Claude (gsd-verifier)_
