---
phase: 04-vercel-deploy-observability
reviewed: 2026-05-21T00:00:00Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - .env.example
  - app/api/health/route.ts
  - app/global-error.tsx
  - instrumentation-client.ts
  - instrumentation.ts
  - lib/health/probes.ts
  - next.config.ts
  - package.json
  - sentry.edge.config.ts
  - sentry.server.config.ts
  - tests/unit/health/health-probes.test.ts
  - vercel.json
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-21
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Phase 04 adds a `/api/health` endpoint with three subsystem probes, Sentry
instrumentation across server/edge/client runtimes, and Vercel deploy config.
The code is generally clean and well-commented, but the **storage health probe
has a correctness defect that makes the health check unable to detect a broken
storage subsystem** — the exact failure mode a health endpoint exists to catch.
Several Sentry instrumentation gaps were also found: the client config is missing
the router-transition hook required by `@sentry/nextjs@10`, and an `onUncaughtException`
/ unhandled-rejection path is unverified. The probe timeout has a resource-leak
edge case, and `vercel.json` uses an undocumented `bunVersion` key whose churn is
visible in the commit history.

No source files were modified during review.

## Critical Issues

### CR-01: Storage probe reports healthy when Supabase returns 401/403/500

**File:** `lib/health/probes.ts:132-136` (in conjunction with `lib/storage/supabase.ts:80-89`)

**Issue:** `probeStorage()` calls `store.exists(".health-check")` and treats any
non-throwing return as success — the doc comment explicitly says "A `false` return
is fine (file absent); only a thrown error is a failure."

But `createSupabaseStorage().exists()` is implemented as:

```ts
async exists(path: string): Promise<boolean> {
  const res = await fetch(url, { method: "HEAD", headers: { Authorization: ... } });
  return res.ok;   // returns false for ANY non-2xx, never throws
}
```

`res.ok` is `false` for `401` (bad/rotated service-role key), `403` (RLS / bucket
permission), `404` (bucket deleted/renamed), and `5xx` (Supabase Storage outage).
`fetch` only rejects on transport-level failure (DNS, connection refused, TLS).
So if the storage *credentials are wrong* or the *bucket is gone* or *Supabase
Storage is down with a 503*, `exists()` returns `false`, `probeStorage()` resolves
normally, `timed()` reports `{ ok: true }`, and `/api/health` returns
`status: "ok"` with HTTP 200.

This is a health endpoint that cannot detect a dead storage backend — it defeats
the stated purpose of DEPLOY-03 and will make Vercel/uptime monitors believe the
deploy is healthy during a real storage outage.

**Fix:** The probe needs to distinguish "file absent" (200/404 → healthy,
reachable) from "subsystem broken" (401/403/5xx → unhealthy). Since `exists()`
collapses all of these to a boolean, either probe at a lower level or extend the
storage interface. Minimal fix — give the probe its own reachability check that
inspects status codes without leaking the URL:

```ts
export async function probeStorage(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.STORAGE_BUCKET ?? "brain-files";
  if (!supabaseUrl || !key) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set");
  }
  const res = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/.health-check`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${key}` },
  });
  // 200 (present) and 404 (absent) both prove the subsystem is reachable & authorized.
  // 401/403/5xx mean the storage backend is misconfigured or down.
  if (res.status !== 200 && res.status !== 404) {
    throw new Error(`storage probe failed with status ${res.status}`);
  }
}
```

Alternatively, add an `exists()`-vs-`ping()` distinction to `StorageBackend`, but
that is a wider change. Either way, the current probe must not equate `false` with
"healthy."

## Warnings

### WR-01: `withTimeout` leaks the underlying probe work and its setTimeout on timeout

**File:** `lib/health/probes.ts:44-51`

**Issue:** `withTimeout` uses `Promise.race`. When the timeout wins, the original
promise `p` is **not cancelled** — the postgres connection attempt or storage
`fetch` keeps running in the background until it settles or its own
`connect_timeout` fires. Worse, in the success path the `setTimeout` is never
cleared, so a 2.5s timer stays armed and holds an unhandled rejecting promise
(`new Error("probe timed out")`) that, if it fires after `p` already won the race,
becomes a swallowed rejection inside the dead branch. In a serverless function
that returns quickly, a still-pending `setTimeout` can also delay function
freeze/teardown.

**Fix:** Clear the timer in both branches:

```ts
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`probe timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
```

For the DB probe, also `sql.end()` is reachable on success but on *timeout* the
`finally` in `probeGbrainDb` never runs (the function's promise was abandoned by
the race), so the throwaway postgres connection is leaked until `idle_timeout`
(2s) reclaims it. Acceptable given the short idle timeout, but worth noting.

### WR-02: `instrumentation-client.ts` is missing `onRouterTransitionStart` — Sentry navigation instrumentation silently disabled

**File:** `instrumentation-client.ts:1-15`

**Issue:** With `@sentry/nextjs@10.53.1` and Next.js 15 App Router, client-side
instrumentation must export `onRouterTransitionStart` so Sentry can hook
navigation transitions for tracing. The Sentry Next.js setup wizard generates:

```ts
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

This file only calls `Sentry.init(...)` and exports nothing. The build will not
fail, but client-side navigation spans / pageload→navigation tracing will be
missing, and recent `@sentry/nextjs` versions emit a build-time warning about the
missing export. Since `tracesSampleRate: 0.1` is set, the intent is clearly to
collect transactions — they will be incomplete without this hook.

**Fix:** Append to `instrumentation-client.ts`:

```ts
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

### WR-03: No `app/error.tsx` boundary — only `global-error.tsx` exists

**File:** `app/global-error.tsx` (and absence of `app/error.tsx`)

**Issue:** `global-error.tsx` only activates when an error escapes the **root
layout** — i.e. a crash so severe it replaces the entire `<html>` shell. Errors
thrown inside normal page/segment rendering (the common case — a failing
`/dash` server component, a throwing client component) are caught by the nearest
`error.tsx` segment boundary, of which there are none. Those errors will fall
through to `global-error.tsx`, which is a poor UX (whole-page replacement, loses
layout/nav) and is the heavyweight path. More importantly, segment-level
`error.tsx` boundaries are the recommended place to call
`Sentry.captureException` for recoverable render errors; without one, recoverable
errors either crash to the global boundary or are reported only via
`onRequestError` (server) — client-side render errors in a segment may not be
captured at all.

**Fix:** Add at least one `app/error.tsx` (`"use client"`) boundary that renders a
recoverable error UI and calls `Sentry.captureException(error)` in a `useEffect`,
mirroring `global-error.tsx`. Place it at `app/` or per-route as the UX requires.

### WR-04: `vercel.json` `bunVersion` is not a documented top-level Vercel config key

**File:** `vercel.json:2`

**Issue:** `vercel.json` declares a top-level `"bunVersion": "1.x"`. This is not a
recognized key in the Vercel project-config schema — Vercel does not document a
top-level `bunVersion` field, and unknown keys in `vercel.json` are silently
ignored (no schema validation error). The functions block separately pins
`"runtime": "bun@1.2.0"`. The commit history shows real churn here
(`241a84c fix: bun@1 not bun`, `a386c4d fix: try full semver bun@1.2.0`),
indicating the runtime specifier was unstable. A silently-ignored top-level key
gives a false sense that the Bun version is controlled when only the per-function
`runtime` actually takes effect.

**Fix:** Remove the unrecognized top-level `"bunVersion"` key and rely solely on
the `functions[].runtime` specifier (`bun@1.2.0`), which is the documented
mechanism. If a build-time Bun version must be pinned, do it via the Vercel
project settings / `package.json` `engines`, not an invented `vercel.json` key.
Verify the deploy actually selects Bun 1.2.0 by checking the build log.

### WR-05: `vercel.json` function glob `app/api/**/*.ts` mismatches Next.js compiled output

**File:** `vercel.json:4`

**Issue:** The `functions` key matches paths relative to the **build output**, not
your source tree. For a Next.js App Router project the serverless functions Vercel
produces are not named `app/api/**/*.ts` — Next compiles route handlers into
`.next/` output and Vercel maps them under paths like
`app/api/health/route` (no `.ts` extension on the deployed function, and the
matching semantics are Next-version specific). A `functions` glob that does not
match any produced function is silently ignored, meaning the intended
`runtime: bun@1.2.0` may not be applied to the health route at all. Combined with
WR-04, the Bun-runtime configuration is unverified end to end.

**Fix:** Confirm against a real Vercel build log that the `functions` pattern
matches the deployed health function. The correct App Router pattern is typically
`app/api/**/route.ts` (matching source route files), not `app/api/**/*.ts`.
Inspect the deploy and confirm the health function reports the Bun runtime; if it
does not, correct the glob.

### WR-06: `next.config.ts` `outputFileTracingIncludes` key `app/api/**/route.ts` may not match all gbrain-using functions

**File:** `next.config.ts:20-28`

**Issue:** `outputFileTracingIncludes` is keyed on `app/api/**/route.ts`, which
forces the gbrain + WASM deps into the bundle **only for API route handlers**.
The header comment for `serverExternalPackages`/`gbrainExternalsFn` notes gbrain
is also used from server components (`computeAndCache`, the dashboard insight
cards described in CLAUDE.md render gbrain output server-side). Any Server
Component or non-`route.ts` server module that transitively imports gbrain will
not get the forced includes and can hit `MODULE_NOT_FOUND` on Vercel — the exact
failure the includes were added to prevent. The health route itself is fine
(it does not import gbrain), but the scoping is narrower than the gbrain usage
surface.

**Fix:** Verify whether any server component or server action imports gbrain. If
so, broaden the key (e.g. add a second entry keyed to the relevant page/layout
paths, or use a wildcard that covers them). At minimum document why route-handler
scoping is sufficient, since the in-repo gbrain usage is not limited to API routes.

## Info

### IN-01: `sentry.server.config.ts` and `sentry.edge.config.ts` are byte-identical duplicates

**File:** `sentry.server.config.ts:1-15`, `sentry.edge.config.ts:1-15`

**Issue:** The two files are identical (`sentry.server.config.ts` even keeps the
client-oriented "chat question text" comment wording — actually it differs by one
comment line from `instrumentation-client.ts`, but server vs edge are exact
copies). Duplicated config drifts over time — a future change to `beforeSend`
scrubbing must be made in three places and one will be forgotten.

**Fix:** Extract the shared `Sentry.init` options into a single
`lib/sentry-shared.ts` exporting an options object, and have each runtime config
spread it. This is a known pattern Sentry supports.

### IN-02: `beforeSend` is a no-op pass-through despite PII-scrubbing intent

**File:** `instrumentation-client.ts:12-14`, `sentry.server.config.ts:12-14`, `sentry.edge.config.ts:12-14`

**Issue:** All three `beforeSend(event) { return event; }` are pass-throughs. The
comments explicitly reference Security Domain V7 / T-04-05 and warn against
sending connection strings, env, and chat question text — but nothing actually
strips them. Sentry's default integrations capture request data, breadcrumbs, and
local variables in stack frames, any of which can carry a `postgres://` URL
(e.g. the `probeGbrainDb` error path includes the env var *name* only, which is
safe — but an unhandled error elsewhere in `lib/gbrain` could surface the URL in a
frame variable). The scrubbing the comments promise is not implemented.

**Fix:** Implement at least minimal field scrubbing in the shared `beforeSend`:
strip `request.data`/`request.headers.cookie`, redact any string matching
`postgres://` / `Bearer ` / known key prefixes from `event.exception` frame vars
and `event.extra`. Or accept the gap explicitly and update the comments so they
do not claim protection that does not exist.

### IN-03: `app` probe `latencyMs: 0` and hard-coded `ok: true` is misleading telemetry

**File:** `app/api/health/route.ts:54`

**Issue:** `const app = { ok: true, latencyMs: 0 };` is a constant. It can never
report `false` and its latency is always `0`. As a literal "the process is alive"
signal this is fine, but it is shaped exactly like the real `Probe` results from
`timed()`, so a consumer parsing the JSON cannot tell it apart from a measured
probe. Minor, but the `latencyMs: 0` will read as "instantaneous" rather than
"not measured."

**Fix:** Either drop `latencyMs` from the `app` entry, or comment the response
shape so consumers know `app` is a liveness constant, not a measured probe.

### IN-04: `.env.example` documents secrets but there is no runtime env validation

**File:** `.env.example` (whole file)

**Issue:** `.env.example` is a thorough inventory, but nothing validates that the
required vars are present at boot. `createStorage()` throws only when called, and
`probeGbrainDb`/`buildConfig` throw only when invoked — a missing
`NEXT_PUBLIC_SENTRY_DSN` silently disables Sentry with no warning (`Sentry.init`
with `dsn: undefined` is a no-op). CLAUDE.md mandates `zod` "for safety." A
fail-fast env check at startup would surface a misconfigured Vercel deploy before
the first request rather than via a degraded health check.

**Fix:** Optional given hackathon constraints — add a small `zod` schema validated
in `instrumentation.ts register()` (or a dedicated `lib/env.ts`) for the
must-have server vars. At minimum, log a warning when `NEXT_PUBLIC_SENTRY_DSN` is
unset so the operator notices observability is off.

### IN-05: `console.log("[health]", ...)` runs on every health hit

**File:** `app/api/health/route.ts:70`

**Issue:** The endpoint is described as "Public" and is `force-dynamic`. Uptime
monitors / Vercel health checks will hit it frequently (often every 10-60s),
producing a `console.log` line per request. On Vercel this is ingested log volume
and noise. CLAUDE.md does say `console.log` is the chosen observability tool, so
this is consistent with project convention — flagging only as noise to be aware
of post-hackathon now that the project has pivoted to real-world use.

**Fix:** Optional — gate the log behind a non-degraded check (`if (!healthy)
console.warn(...)`) so only failing probes log, reducing steady-state noise.

---

_Reviewed: 2026-05-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
