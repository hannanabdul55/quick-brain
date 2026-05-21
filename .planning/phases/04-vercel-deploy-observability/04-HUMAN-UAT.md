---
status: partial
phase: 04-vercel-deploy-observability
source: [04-VERIFICATION.md]
started: 2026-05-21T09:12:46Z
updated: 2026-05-21T09:12:46Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Sentry captures an unhandled server error
expected: Trigger an unhandled error in a deployed Route Handler; the event appears in the Sentry dashboard within ~1 minute, with no secrets (connection strings, API keys) in its context.
result: [pending]

### 2. Sentry captures an unhandled client error
expected: Trigger a React render crash on the deployed app; `global-error.tsx` shows "Something went wrong." and the event reaches the Sentry dashboard.
result: [pending]

### 3. Sentry events carry no secrets or PII
expected: Inspect a captured event's context and breadcrumbs; the `beforeSend` pass-through does not leak connection strings, API keys, or chat question text.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
