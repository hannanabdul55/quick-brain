---
phase: 04-smb-audit-gbrain-skill
plan: "04"
subsystem: cleanup
tags: [cleanup, lint, typecheck, documentation, conventions, deprecation]
dependency_graph:
  requires:
    - 04-01: skills/smb-audit scaffold + lib/audit/anomaly-detector.ts
    - 04-02: per-tenant sourceDir routing
    - 04-03: smb-audit skill wired into seed pipeline
  provides:
    - scripts/detect-anomalies.ts — deprecation header marking legacy status
    - CLAUDE.md — Conventions section with skill invocation pattern + brain-schema contract
    - lib/audit/anomaly-detector.ts — prefer-const lint fix
  affects:
    - Phase 5 cleanup (scheduled deletion of detect-anomalies.ts)
    - Any future Phase 4+ contributor reading CLAUDE.md for conventions
tech_stack:
  added: []
  patterns:
    - "gbrain skill invocation: direct-bun fallback (GBRAIN_HOME=<brain-dir> bun skills/smb-audit/scripts/smb-audit.mjs)"
    - "brain schema contract: canonical frontmatter fields in docs/brain-schema.md"
    - "insight sourceDir: FIXTURES_ROOT for seed tenant, brainHome for real tenants"
key_files:
  created: []
  modified:
    - scripts/detect-anomalies.ts
    - CLAUDE.md
    - lib/audit/anomaly-detector.ts

key-decisions:
  - "detect-anomalies.ts deprecated-in-place (not deleted) — Phase 5/6 cleanup per CONTEXT.md deferred items"
  - "CLAUDE.md Conventions updated with 3 sections: skill invocation, brain schema contract, insight sourceDir"
  - "prefer-const lint error auto-fixed in lib/audit/anomaly-detector.ts (Rule 1)"

patterns-established:
  - "Phase cleanup plans confirm typecheck+lint on correct base (with Phase 4 files present) not pre-merge base"

requirements-completed: []

duration: 20min
completed: "2026-05-19"
---

# Phase 4 Plan 04: Cleanup Pass Summary

**Lint fixed (prefer-const in anomaly-detector.ts), deprecation header added to detect-anomalies.ts, CLAUDE.md Conventions section populated with skill invocation pattern + brain-schema contract, seed regression confirmed with all 4 anomaly types in 7s**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-19T16:00:00Z
- **Completed:** 2026-05-19T16:20:00Z
- **Tasks:** 2 (+ checkpoint automated pre-flight)
- **Files modified:** 3

## Accomplishments

- Lint exits 0: fixed `prefer-const` error in `lib/audit/anomaly-detector.ts:77` (`let value` → `const value`)
- `scripts/detect-anomalies.ts` carries 4-line deprecation header marking it as superseded by smb-audit skill
- `CLAUDE.md` Conventions section now documents gbrain Skill Invocation, Brain Schema Contract (cross-ref to `docs/brain-schema.md`), and Insight Source Dir guidance
- Fresh seed regression confirmed: exits 0 in 7s, 5 bullet points (>= 4 required), all 4 anomaly_type values present in frontmatter (price-hike, duplicate, ghost-saas, missing-invoice), idempotency verified

## Task Commits

Each task was committed atomically:

1. **Task 1: Typecheck + lint pass — fix prefer-const error** - `6882ee7` (fix)
2. **Task 2: Deprecation header + CLAUDE.md conventions** - `4453868` (chore)

## Files Created/Modified

- `lib/audit/anomaly-detector.ts` — prefer-const lint fix on line 77 (let → const)
- `scripts/detect-anomalies.ts` — 4-line DEPRECATED header inserted after shebang (lines 2-5)
- `CLAUDE.md` — Conventions section replaced placeholder with 3 Phase 4 conventions

## Decisions Made

- Kept `detect-anomalies.ts` in place with deprecation header rather than deleting — deletion deferred to Phase 5/6 per CONTEXT.md
- CLAUDE.md conventions written in freeform prose + code blocks (not a table) to match the natural structure of the three distinct conventions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] prefer-const lint error in lib/audit/anomaly-detector.ts**
- **Found during:** Task 1 (typecheck + lint pass)
- **Issue:** `bunx next lint` exited 1 with error: `lib/audit/anomaly-detector.ts:77:9 Error: 'value' is never reassigned. Use 'const' instead. prefer-const`
- **Fix:** Changed `let value = m[2]!.trim()` to `const value = m[2]!.trim()` — value was never mutated
- **Files modified:** `lib/audit/anomaly-detector.ts`
- **Verification:** `bunx next lint` exits 0 after fix; only pre-existing v1.0 warnings remain
- **Committed in:** `6882ee7` (Task 1 commit)

**2. [Rule 3 - Blocking] Worktree was on wrong base (missing Phase 4 files)**
- **Found during:** Task 1 — `skills/smb-audit/`, `lib/audit/` directories were absent; seed.sh still called `detect-anomalies.ts`
- **Issue:** Worktree was initialized from `0dcd351` (main branch at worktree-creation time) instead of `ff0a79e0` (Phase 4 merge target). The `<worktree_branch_check>` reset step in the prompt was not fully executed — only branch name validation ran, not the `git reset --hard ff0a79e0` command.
- **Fix:** Saved CLAUDE.md and detect-anomalies.ts file content, then ran `git reset --hard ff0a79e0ab817f143d64e797387df59fba5e7579` to correctly base the worktree on the Phase 4 merge. Re-applied all file changes after reset.
- **Verification:** `skills/smb-audit/scripts/smb-audit.mjs` present; `lib/audit/anomaly-detector.ts` present; seed.sh uses smb-audit; seed runs with all 4 anomaly types
- **Note:** This is an executor environment setup issue — not a code bug. Documented as deviation for awareness.

---

**Total deviations:** 2 auto-fixed (1 Rule 1 lint fix, 1 Rule 3 blocking environment setup)
**Impact on plan:** Both required for correct execution. No scope creep.

## Issues Encountered

- `companies/quick-clean.md` skipped during `gbrain import` with slug mismatch warning (`slug: quick-clean` in frontmatter but path-derived slug is `companies/quick-clean`). This is a pre-existing issue from 04-01 where the missing-invoice fixture was planted with a bare `slug:` field. Out of scope for 04-04 — deferred.

## v1.0 Demo Regression: Automated Pre-Flight Results

All automated checks PASSED:

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `bunx tsc --noEmit` | EXIT 0 (zero errors) |
| Lint | `bunx next lint` | EXIT 0 after prefer-const fix |
| Seed pipeline | `bun run seed` | EXIT 0, wall clock 7s (SKIL-07 met) |
| Bullet count | grep `^- [[companies/` | 5 bullets (>= 4 required) |
| All 4 anomaly types | grep `anomaly_type:` | price-hike, duplicate, ghost-saas, missing-invoice |
| Idempotency | md5sum across 2 runs | PASS: identical |
| Deprecation header | grep DEPRECATED | PASS: present on line 2 |
| brain-schema ref | grep brain-schema CLAUDE.md | PASS: 2 occurrences |

**Visual dashboard check (operator follow-up required):** The plan's full v1.0 demo regression checkpoint (onboard → dashboard → chat → reset via browser) requires a running dev server and browser. Per autonomous protocol, this is documented here as an operator follow-up:

1. `bun dev` (start Next.js at http://localhost:3000)
2. Open browser: onboard as Mara, confirm dashboard shows >= 4 anomaly rows including "missing invoice"
3. Chat: "What was weird about last month?" — verify names Beanstalk Roasters, Square POS, 7shifts, Quick Clean
4. Reset: press-hold Reset button, confirm < 10s clean state

## Known Stubs

None — no stub patterns found in modified files.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes introduced.

## Next Phase Readiness

- Phase 4 code is clean: tsc exits 0, lint exits 0, seed pipeline produces all 4 anomaly types
- CLAUDE.md Conventions section populated — Phase 5 contributors have the skill invocation pattern and brain-schema contract documented
- `detect-anomalies.ts` is deprecated-in-place — Phase 5 cleanup can safely delete it
- One deferred item: `companies/quick-clean.md` slug frontmatter fix (add `slug: companies/quick-clean` or remove the `slug:` line) to prevent the gbrain import skip warning

## Self-Check: PASSED

All files verified to exist:
- `FOUND: .planning/phases/04-smb-audit-gbrain-skill/04-04-SUMMARY.md`
- `FOUND: scripts/detect-anomalies.ts`
- `FOUND: CLAUDE.md`
- `FOUND: lib/audit/anomaly-detector.ts`

All commits verified:
- `FOUND: 6882ee7` (Task 1 — prefer-const fix)
- `FOUND: 4453868` (Task 2 — deprecation header + CLAUDE.md)
- `FOUND: fad569f` (SUMMARY.md)

---
*Phase: 04-smb-audit-gbrain-skill*
*Completed: 2026-05-19*
