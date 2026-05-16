---
phase: 03-insight-cards-demo-readiness
plan: "05"
subsystem: demo-collateral
tags: [docs, demo, operator-notes, prize-narrative]
dependency_graph:
  requires: []
  provides:
    - docs/DEMO-SCRIPT.md
    - README.md#panic-recovery
  affects: []
tech_stack:
  added: []
  patterns: [operator-runbook, spoken-script]
key_files:
  created:
    - docs/DEMO-SCRIPT.md
  modified:
    - README.md
decisions:
  - "DEMO-04 (3 rehearsal runs) is operator-driven acceptance; this plan provides the playbook, not automation"
  - "DEMO-06 (git tag demo-final) is an operator-run tagging ceremony; documented in both DEMO-SCRIPT.md and README"
  - "keyword density woven across all 5 sections rather than concentrated in one section for natural delivery"
metrics:
  duration: "~2 minutes"
  completed: "2026-05-16"
  tasks_completed: 2
  files_changed: 2
---

# Phase 3 Plan 5: Demo Collateral (Script + Panic Recovery) Summary

3-minute spoken script with prize-narrative keyword density and README panic-recovery pointer for the YC hackathon demo.

## What Was Built

### Task 1: docs/DEMO-SCRIPT.md (3-minute spoken script)

Created the operator-facing demo script structured into 5 timed sections:

| Section | Title | Target Time |
|---------|-------|-------------|
| 1 | Opening | 15 seconds |
| 2 | Onboarding theater | 45 seconds |
| 3 | Dashboard insight cards | 60 seconds |
| 4 | Chat moneyshot | 45 seconds |
| 5 | Close | 15 seconds |
| **Total** | | **180 seconds** |

**Keyword density achieved (DEMO-05 acceptance):**

| Keyword | Count | Required |
|---------|-------|----------|
| `graph` | 5 | ≥ 3 |
| `timeline` | 4 | ≥ 3 |
| `skill` | 6 | ≥ 3 |

All keywords verified via `grep -ow` whole-word match. They appear organically across Sections 2 (onboarding narration), 3 (card walkthrough), 4 (chat answer reading), and 5 (close).

**Additional content in DEMO-SCRIPT.md:**
- Pre-demo checklist (30s before stage): dev server ready, browser open, API keys confirmed, seed brain confirmed, safety-net terminal tab ready
- "If anything goes wrong" operator notes — inline fallback instructions pointing to `bun run panic-reset`
- Rehearsal playbook (DEMO-04): 3 back-to-back runs with acceptance criterion (Beanstalk $330 + Square $79 + 7shifts $43, no errors, no state leakage)
- Demo-final freeze ceremony: `git commit` + `git tag -a demo-final` instructions (operator-run)

### Task 2: README.md "Panic recovery" section

Appended a three-tier recovery section at the end of README.md without modifying any Phase 1 content:

1. **Quick recover** — press-and-hold Reset button for 2 seconds (cache invalidation only, <10s)
2. **Hard recover** — `bun run panic-reset` + `bun run dev` (<15s, preserves seed brain)
3. **Nuclear recover** — `git checkout demo-final && bun install && bun run panic-reset && bun run dev` (restores to operator-blessed tag)

References `docs/DEMO-SCRIPT.md` for the full pre-demo checklist.

## Operator-Driven Acceptance Gates (not automated)

**DEMO-04 — 3 back-to-back rehearsals:**
The plan provides the rehearsal playbook in `docs/DEMO-SCRIPT.md#rehearsal-playbook`. Actual execution is operator-driven: run, reset, run, reset, run — confirm identical anomaly findings each time, no terminal/UI errors, no state leakage. Only after all 3 pass does the operator run `git tag demo-final`.

**DEMO-06 — git tag demo-final:**
The `demo-final` tag is an operator decision tied to "we are recording NOW." Both `docs/DEMO-SCRIPT.md` and `README.md` document the exact commands (`git tag -a demo-final -m "Demo recording cut"`). No auto-tag was created.

## Deviations from Plan

None — plan executed exactly as written. The script structure, keyword distribution, and README section content all match the plan's specified outline verbatim.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `ac4c988` | `docs(03-05): add 3-minute demo spoken script` |
| 2 | `f172f10` | `docs(03-05): add Panic recovery section to README` |

## Known Stubs

None. This plan is doc-only; no UI or code stubs.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

- `docs/DEMO-SCRIPT.md` exists: CONFIRMED
- `graph` ≥ 3 (actual: 5): CONFIRMED
- `timeline` ≥ 3 (actual: 4): CONFIRMED
- `skill` ≥ 3 (actual: 6): CONFIRMED
- `README.md` has exactly one `## Panic recovery` section: CONFIRMED
- `README.md` references `panic-reset`: CONFIRMED
- `README.md` references `git checkout demo-final`: CONFIRMED
- Phase 1 README sections unchanged: CONFIRMED
- Commit `ac4c988` exists: CONFIRMED
- Commit `f172f10` exists: CONFIRMED
