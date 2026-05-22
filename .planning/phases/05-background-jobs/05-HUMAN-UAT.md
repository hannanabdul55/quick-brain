---
status: partial
phase: 05-background-jobs
source: [05-VERIFICATION.md]
started: 2026-05-21T00:00:00Z
updated: 2026-05-21T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Deployed-URL End-to-End Smoke Test (Plan 05-05 Task 3)
expected: After deploying to Vercel and setting `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` in Vercel encrypted env and registering the `/api/inngest` URL in the Inngest Dashboard — (1) `curl https://<deploy-url>/api/inngest` returns HTTP 200 JSON introspection (proves Inngest runs under the `bun@1.2.0` Vercel runtime — RESEARCH Pitfall 5 discharged); (2) `POST { kind: "onboarding-import", params: { tenantId: "seed" } }` to `/api/jobs` returns 202 + a `jobId`; (3) polling `/api/jobs/<jobId>` shows status progressing `queued`/`running` → `done` with progress climbing to 100 and stage labels advancing; (4) the Inngest cloud dashboard shows the `run-job` execution; (5) the `JobProgress` UI is visually indistinguishable from the SSE onboarding progress theater.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
