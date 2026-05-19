---
phase: 04-smb-audit-gbrain-skill
plan: "01"
subsystem: smb-audit-skill
tags: [anomaly-detection, gbrain-skill, porting, schema]
dependency_graph:
  requires: []
  provides:
    - skills/smb-audit — gbrain skill manifest + shell-job invocation
    - lib/audit/anomaly-detector.ts — 4 anomaly rules (pure functions)
    - lib/audit/index.ts — stable re-export surface
    - docs/brain-schema.md — canonical schema contract (binding Phase 6)
  affects:
    - brains/seed/concepts/march-anomaly-summary.md (written by skill)
    - brains/seed/concepts/recurring-charges.md (written by skill)
tech_stack:
  added: []
  patterns:
    - Pure-function anomaly detector (no I/O except in runDetection entry point)
    - ESM skill entry point (.mjs, top-level await) dynamically imports TS module via bun
    - YAML frontmatter sidecar on concept pages (anomalies: list for dashboard)
    - bulletRegex-compatible output for existing lib/insights/anomalies.ts parser
key_files:
  created:
    - skills/smb-audit/SKILL.md
    - skills/smb-audit/scripts/smb-audit.mjs
    - lib/audit/anomaly-detector.ts
    - lib/audit/index.ts
    - docs/brain-schema.md
    - data/maras-coffee/companies/quick-clean.md
  modified:
    - data/maras-coffee/originals/bank-statement-2026-03.md
    - scripts/generate-fixtures.ts
decisions:
  - "smb-audit.mjs uses dynamic import of lib/audit/index.ts via bun (no TS build step needed)"
  - "anomaly-detector.ts reads filesystem directly under GBRAIN_HOME (no @gbrain/api import)"
  - "Planted anomaly #4 (missing-invoice) by adding quick-clean company + bank debit fixture"
  - "Detection-method footer bullet uses [[companies/detection-method]] wikilink to satisfy bulletRegex filter"
metrics:
  duration: "8 minutes"
  completed: "2026-05-19T15:19:10Z"
  tasks: 3
  files: 8
---

# Phase 4 Plan 01: smb-audit Skill Scaffold + Detector Port Summary

Scaffolded the smb-audit gbrain skill, ported all anomaly detection logic into a shared pure-function library, added the 4th anomaly type (missing-invoice), emitted structured YAML frontmatter sidecars on concept pages, and wrote the canonical brain schema document.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Skill scaffold — SKILL.md + smb-audit.mjs + lib/audit/index.ts | e37e78d | 4 files |
| 2 | Port detector to anomaly-detector.ts + 4th anomaly rule | b1abf4c | 4 files |
| 3 | docs/brain-schema.md canonical schema contract | c710210 | 1 file |

## Verification Results

All 4 verification gates passed:

1. **Skill end-to-end:** `GBRAIN_HOME=brains/seed bun skills/smb-audit/scripts/smb-audit.mjs` exits 0, prints "[smb-audit] Detection complete"
2. **bulletRegex compatibility:** `computeAnomalies('./brains/seed')` returns 4 AnomalyRow[] without modifying anomalies.ts
3. **Idempotency:** md5sum of march-anomaly-summary.md identical across two consecutive runs
4. **TypeScript:** `bunx tsc --noEmit` exits 0 (no type errors)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added missing-invoice fixture data**

- **Found during:** Task 2 — when implementing the missing-invoice detection rule
- **Issue:** The existing `data/maras-coffee/` seed data had no vendor with bank debits but no matching invoice. All 5 vendors (beanstalk-roasters, square-pos, seven-shifts, landlord-llc, pge-utility) had invoices for every month they appeared in bank statements. Without a genuine missing-invoice case, the 4th anomaly rule could not fire against the seed brain.
- **Fix:** Added `data/maras-coffee/companies/quick-clean.md` (a cleaning-service company) and a `$150.00` debit entry for `quick-clean` in `bank-statement-2026-03.md`. No invoice document exists for quick-clean — this is the planted missing-invoice anomaly. Also updated `generate-fixtures.ts` to document and generate this planted anomaly #4 in the March bank statement.
- **Files modified:** `data/maras-coffee/companies/quick-clean.md` (new), `data/maras-coffee/originals/bank-statement-2026-03.md` (updated), `scripts/generate-fixtures.ts` (updated)
- **Commit:** b1abf4c

**2. [Rule 2 - Missing critical functionality] T-04-01 path-traversal validation**

- **Found during:** Task 2 — reading the threat model
- **Issue:** T-04-01 required validation that sourceDir does not contain ".." before any filesystem reads
- **Fix:** Added `if (sourceDir.includes(".."))` guard at the top of `runDetection()` before any `resolve()` calls
- **Files modified:** `lib/audit/anomaly-detector.ts`
- **Commit:** b1abf4c

### Verify Block Behavior Note

The Task 1 verify command:
```
node -e "import('./skills/smb-audit/scripts/smb-audit.mjs').catch(e => { ... })"
```
returns exit code 1 rather than 0 because `smb-audit.mjs` calls `process.exit(1)` directly (not a thrown error), so the `.catch()` handler never fires. The done criteria "exits 1 when GBRAIN_HOME unset" is satisfied — this is correct behavior. The verify block was written expecting a thrown error but `process.exit()` terminates the process before the catch can run.

## brains/seed Setup Note

`brains/seed` does not exist after a fresh clone (only `brains/.gitkeep`). The skill verification required a populated `brains/seed/originals/` and `brains/seed/companies/` directory. Since `gbrain` CLI and API keys are not available in the execution environment, `brains/seed` was populated by copying `data/maras-coffee/` content. The `seed.sh` script handles this for production use. The copied `brains/seed` is NOT committed (gitignore).

## Known Stubs

None — all 4 anomaly rules are fully implemented with real detection logic.

## Threat Flags

No new threat surface beyond the plan's threat model (T-04-01 through T-04-SC). Implemented mitigations:
- T-04-01: path-traversal validation in runDetection()
- T-04-03: explicit GBRAIN_HOME presence check in smb-audit.mjs before calling runDetection()

## Self-Check

Verifying committed files exist:

- FOUND: skills/smb-audit/SKILL.md
- FOUND: skills/smb-audit/scripts/smb-audit.mjs
- FOUND: lib/audit/anomaly-detector.ts
- FOUND: lib/audit/index.ts
- FOUND: docs/brain-schema.md
- FOUND: data/maras-coffee/companies/quick-clean.md

Verifying commits:
- FOUND: e37e78d (Task 1)
- FOUND: b1abf4c (Task 2)
- FOUND: c710210 (Task 3)

## Self-Check: PASSED
