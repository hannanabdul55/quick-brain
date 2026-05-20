---
phase: 01-test-harness-ci
plan: "01"
subsystem: test-infrastructure
tags: [vitest, ci, github-actions, test-harness]
dependency_graph:
  requires: []
  provides: [test-suite, ci-workflow]
  affects: [all-future-phases]
tech_stack:
  added: [vitest@4.1.6]
  patterns: [vitest-projects, two-project-config, opt-in-integration, forks-pool]
key_files:
  created:
    - vitest.config.ts
    - tests/smoke.test.ts
    - .github/workflows/ci.yml
  modified:
    - package.json
    - bun.lock
decisions:
  - "Use vitest projects (not workspaces file) for inline two-project config — unit always runs, gbrain-integration is opt-in via RUN_INTEGRATION env var"
  - "pool: forks to avoid shared state between test files (mutex tests in later phases need isolation)"
  - "No RUN_INTEGRATION=1 in CI workflow — all gbrain-spawning tests excluded by default until secrets are configured in Phase 2"
  - "No caching in CI — bun install is fast enough (~2.5s) for demo project; avoids stale cache complexity"
metrics:
  duration: "~8 minutes"
  completed_date: "2026-05-20"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 5
---

# Phase 01 Plan 01: Vitest Test Harness + GitHub Actions CI Summary

Installed Vitest with a two-project config that keeps gbrain-spawning integration tests fully excluded from CI, plus a green smoke test from day one and a GitHub Actions workflow that typechecks, lints, and tests every push and PR to main.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Install vitest and configure vitest.config.ts | 8c308d1 | vitest.config.ts, package.json, bun.lock |
| 2 | Create smoke test and CI workflow | 52bc29e | tests/smoke.test.ts, .github/workflows/ci.yml |

## Decisions Made

1. **Two vitest projects via inline config** — The `projects` array inside `defineConfig` (not a separate `vitest.workspace.ts` file) keeps all test configuration in one place. Project "unit" includes `tests/**/*.test.ts` and excludes `tests/integration/gbrain/**`; project "gbrain-integration" is opt-in only.

2. **`pool: "forks"` globally** — The mutex smoke test in later phases needs true process isolation to validate that the file-lock mechanism works correctly. Forks pool prevents shared state between test files.

3. **No `RUN_INTEGRATION=1` in CI** — GitHub-hosted runners have no gbrain CLI, OPENAI_API_KEY, ANTHROPIC_API_KEY, or Supabase secrets. Excluding the integration project at the config level (not just via `describe.skipIf`) is the clean approach.

4. **No bun install caching in CI** — `bun install` runs in ~2.5s on fresh runners. Avoiding cache configuration reduces complexity and eliminates cache-poisoning risk for a demo project.

## Deviations from Plan

None — plan executed exactly as written.

## Verification Results

- `bun run test`: 1 passed, exits 0
- `bun run test:watch` script: present in package.json
- `bunx tsc --noEmit`: exits 0, no type errors
- `.github/workflows/ci.yml`: valid YAML, uses oven-sh/setup-bun@v2, no API secrets
- gbrain-integration excluded from default run: confirmed (0 gbrain-integration output)

## Known Stubs

None.

## Threat Flags

None — this plan adds only dev tooling (vitest config, CI workflow). No new network endpoints, auth paths, file access patterns, or schema changes introduced.

## Self-Check: PASSED

- vitest.config.ts: FOUND
- tests/smoke.test.ts: FOUND
- .github/workflows/ci.yml: FOUND
- Commit 8c308d1: FOUND
- Commit 52bc29e: FOUND
