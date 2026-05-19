---
phase: 04-smb-audit-gbrain-skill
plan: "03"
subsystem: seed-pipeline
tags: [seed, skill-integration, smb-audit, anomaly-detection]
dependency_graph:
  requires:
    - 04-01: skills/smb-audit scaffold + lib/audit/anomaly-detector.ts
    - 04-02: per-tenant sourceDir routing (seed reads data/maras-coffee/)
  provides:
    - scripts/seed.sh — smb-audit skill wired in, detect-anomalies.ts replaced
    - data/maras-coffee/concepts/march-anomaly-summary.md — anomalies: YAML sidecar
    - data/maras-coffee/concepts/recurring-charges.md — recurring charge audit page
  affects:
    - Dashboard Anomalies card (reads data/maras-coffee/concepts/ for seed tenant)
    - Any future skill integration that writes concept pages via seed pipeline
tech_stack:
  added: []
  patterns:
    - "direct-bun skill invocation before gbrain init (shell-job path requires initialized brain)"
    - "skill writes to DATA_DIR; main gbrain import covers concepts/ directory"
    - "belt-and-suspenders concept reimport after orphans check (2 gbrain embed --stale calls)"
    - "fail-loud existence guard: exit 1 if skill does not write expected output"
key_files:
  created: []
  modified:
    - scripts/seed.sh
    - data/maras-coffee/concepts/march-anomaly-summary.md
    - data/maras-coffee/concepts/recurring-charges.md
decisions:
  - "Fallback direct-bun invocation chosen over shell-job: gbrain jobs submit requires an initialized brain; skill runs before gbrain init in seed.sh ordering"
  - "GBRAIN_HOME=${DATA_DIR} for skill invocation: seed tenant insight parser reads data/maras-coffee/ (confirmed by 04-02-SUMMARY)"
  - "Post-skill concept reimport placed before Seed brain ready log: belt-and-suspenders to ensure concept pages are embedded even if they were already imported by main gbrain import"
  - "detect-anomalies.ts NOT deleted: kept as deprecation marker per 04-CONTEXT.md deferred items"
metrics:
  duration: "12 minutes"
  completed: "2026-05-19T15:38:00Z"
  tasks: 1
  files: 3
---

# Phase 4 Plan 03: smb-audit Skill Seed Integration Summary

smb-audit skill wired into seed.sh as a direct-bun invocation (replacing detect-anomalies.ts); all 4 anomaly types detected, concept pages with anomalies: YAML sidecar written, seed pipeline completes in 7s (SKIL-07 met).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Swap detect-anomalies step for skill invocation + add post-skill concept import | e7f0a1d | scripts/seed.sh, data/maras-coffee/concepts/march-anomaly-summary.md, data/maras-coffee/concepts/recurring-charges.md |

## Verification Results

All automated smoke checks passed:

1. **bash -n scripts/seed.sh:** PASS — no syntax errors
2. **bun run seed (run 1):** Exit 0, wall clock 7s — SKIL-07 (<10s) met
3. **bun run seed (run 2):** Exit 0, wall clock 9s — second run stable
4. **concepts/march-anomaly-summary.md exists:** PASS — 5 bullet lines (>= 4 required)
5. **bulletRegex match:** 5 lines matching `^- \d{4}-\d{2}-\d{2}: \[\[companies/`
6. **frontmatter anomalies: list:** PASS — 4 anomaly entries (price-hike, duplicate, ghost-saas, missing-invoice)
7. **Idempotency:** md5sum identical across 2 consecutive `GBRAIN_HOME=${DATA_DIR} bun skills/smb-audit/scripts/smb-audit.mjs` runs
8. **bunx tsc --noEmit:** Exit 0 — no type errors

All 4 anomaly types detected with dollar impacts:
| Anomaly | Vendor | Dollar Impact | Severity |
|---------|--------|---------------|----------|
| price-hike | beanstalk-roasters | $330.00 | high |
| duplicate | square-pos | $79.00 | medium |
| ghost-saas | seven-shifts | $43.00 | high |
| missing-invoice | quick-clean | $150.00 | high |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Shell-job invocation replaced with fallback direct-bun path**

- **Found during:** Task 1 — first seed run attempt
- **Issue:** The plan specified `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell ...` as the preferred invocation. This fails with "No brain configured. Run: gbrain init" because `gbrain jobs submit` requires an initialized brain at GBRAIN_HOME, and the skill runs BEFORE `gbrain init` in the seed.sh pipeline order.
- **Fix:** Used the fallback invocation: `GBRAIN_HOME="${DATA_DIR}" bun "${REPO_ROOT}/skills/smb-audit/scripts/smb-audit.mjs"`. This is explicitly allowed by plan `must_haves.artifacts` ("gbrain jobs submit smb-audit OR bun skills/smb-audit/").
- **Files modified:** `scripts/seed.sh`
- **Commit:** e7f0a1d

**2. [Rule 3 - Blocking] Worktree branch was behind target base commit**

- **Found during:** Task 1 — skill file not found when running seed
- **Issue:** The worktree branch was at `0dcd351` (pre-04-01 state) and did not have `skills/smb-audit/` or `lib/audit/` present. The bun invocation failed with "Module not found".
- **Fix:** Applied the `<worktree_branch_check>` protocol from the prompt: `git reset --hard 2d40a875bd7fffdd9f1e94024b8a12287c2379a0` to bring the worktree to the post-04-02 merge state where skills exist. My edits were re-applied after the reset.
- **Files modified:** N/A (git operation)
- **Commit:** No separate commit — was a setup step before Task 1

### Out-of-Scope Discovery (deferred)

**generate-fixtures.ts vendor list in bank-statement compiled-truth line:**

- The `generate-fixtures.ts` script regenerates `bank-statement-2026-03.md` without including `[[companies/quick-clean]]` in the compiled-truth vendor list (only the raw debit entry on line 22 has it).
- This is cosmetic — the skill reads raw debit entries, not the compiled-truth summary, so detection is unaffected.
- Deferred to a future plan that updates `generate-fixtures.ts` to include quick-clean in the vendor list.

## Manual Operator Verification

The following check requires dashboard access and cannot be automated by the executor:

**Dashboard Anomalies Card — `http://localhost:3000/dash/seed`**

After running `bun run seed && bun run dev`, verify:
1. The "Anomalies flagged" insight card shows >= 4 anomaly line items
2. Each item shows a dollar impact (e.g., "$330.00", "$79.00", "$43.00", "$150.00")
3. All 4 anomaly types are represented: price-hike, duplicate, ghost-saas, missing-invoice
4. If severity badges render, they should show "high" or "medium" from the frontmatter sidecar

The executor has confirmed:
- `data/maras-coffee/concepts/march-anomaly-summary.md` has the complete `anomalies:` YAML sidecar
- The seed insight parser reads from `data/maras-coffee/` for the seed tenant (confirmed by 04-02-SUMMARY)
- The concept pages are indexed into PGLite (2 pages imported by post-skill import step)

## Known Stubs

None. The concept pages have full `severity`, `dollar_impact`, `anomaly_type`, and `vendor_slug` fields populated with real detection output.

## Threat Flags

No new threat surface beyond the plan's threat model:
- T-04-03-01 (DoS — skill timeout): Mitigated via existence guard (`exit 1` if output missing)
- T-04-03-02 (Tampering — wrong dir): Mitigated by explicit `GBRAIN_HOME="${DATA_DIR}"` in invocation + existence check

## Self-Check

**Files modified:**
- `scripts/seed.sh` — modified (smb-audit skill wired in, detect-anomalies.ts invocation removed)
- `data/maras-coffee/concepts/march-anomaly-summary.md` — modified (anomalies: YAML sidecar added by skill)
- `data/maras-coffee/concepts/recurring-charges.md` — modified (recurring-charges regenerated by skill)

**Commits:**
- `e7f0a1d` — feat(04-03): wire smb-audit skill into seed.sh, replacing detect-anomalies.ts

## Self-Check: PASSED
