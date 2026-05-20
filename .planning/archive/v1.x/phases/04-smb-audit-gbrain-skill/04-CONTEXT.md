# Phase 4: smb-audit gbrain Skill — Context

**Gathered:** 2026-05-17
**Status:** Ready for planning
**Mode:** Smart-discuss (autonomous) — grey areas auto-accepted from `.planning/research/SUMMARY.md` and `PITFALLS.md`. Operator can override before plan-phase runs.

<domain>

## Phase Boundary

A user (or operator) runs `gbrain jobs submit smb-audit --follow` against any brain dir and the dashboard "Anomalies flagged" card renders all 4 anomaly types with severity badges populated from skill output, end-to-end.

The skill replaces the v1.0 `scripts/detect-anomalies.ts` hand-rolled detector. The reading side (`lib/insights/parsers/anomalies.ts`) stays unchanged — the skill writes concept pages in the exact same format the parser already consumes. The detection rules port 1:1.

This phase opens with a mandatory 30-min spike (see `<deferred>` below) before plan code begins.

**In scope:**
- `skills/smb-audit/` skill package at repo root (SKILL.md + scripts/smb-audit.mjs)
- Detector logic extracted to a shared `lib/audit/anomaly-detector.ts` module
- 4th anomaly type — bank-debit-without-invoice (folds in v1.0 DATA-12)
- Structured frontmatter on concept pages (severity, dollar_impact, anomaly_type, vendor_slug)
- `lib/insights/cache.ts::computeAndCache` refactored to accept a `sourceDir` parameter (drops the `FIXTURES_ROOT` hardcoding — every tenant gets its own anomaly numbers)
- `docs/brain-schema.md` canonical invoice/vendor/bank-statement frontmatter contract (this contract binds Phase 6)
- `scripts/seed.sh` switches from `bun scripts/detect-anomalies.ts` to `gbrain jobs submit smb-audit --follow`
- Phase 4 smoke gate: `gbrain jobs submit smb-audit --follow` against `brains/seed/` writes concept pages → dashboard "Anomalies flagged" renders 4 anomalies with severity badges and dollar impacts

**Out of scope (deferred):**
- Email magic-link auth (Phase 5)
- QBO ingest (Phase 6)
- ML-based detection (v2 stretch)
- Per-line-item POS itemization (v2 stretch)
- INSI-08 severity-badge UI polish — Phase 4 emits the underlying `severity` field; the badge visual is a UI follow-on already booked to v2 stretch

</domain>

<decisions>

## Implementation Decisions

> All design calls auto-accepted from research SUMMARY.md per autonomous protocol. Operator can override before plan-phase runs.

### Skill location and invocation
- **Path:** `skills/smb-audit/` at repo root (NOT under `brains/seed/.gbrain/skills/`). Reason: the skill should be repo-owned + version-controlled, not part of the per-tenant brain payload.
- **Manifest:** `skills/smb-audit/SKILL.md` declares scope (reads `originals/` + `companies/`, writes `concepts/`) plus a RESOLVER.md entry.
- **Entry:** `skills/smb-audit/scripts/smb-audit.mjs` — pure ESM, no TS build step needed inside the skill itself.
- **Invocation:** `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow` wraps `bun skills/smb-audit/scripts/smb-audit.mjs` so the skill runs as a real gbrain Minions job streamed back to the parent process.
- **Fallback (if spike fails):** Direct `bun skills/smb-audit/scripts/smb-audit.mjs` invocation with `GBRAIN_HOME=…` in env. Same observable outcome, simpler harness. Decided at spike time, not at plan time.

### Detector logic placement
- Extract the existing `scripts/detect-anomalies.ts` logic into `lib/audit/anomaly-detector.ts` (pure functions, no I/O). Both the skill (`smb-audit.mjs`) and any future legacy fallback can call into this module. **Keep the v1.0 detector script around as a legacy entry point during Phase 4** — delete only after the skill is verified end-to-end.

### Anomaly types
1. **Price hike** — vendor MoM delta > 20% (v1.0 threshold preserved)
2. **Duplicate charge** — same vendor + amount, 2 hits within 7 days
3. **Ghost SaaS** — recurring monthly debit + no vendor event in >90 days
4. **Missing invoice** (NEW — DATA-12) — a `bank-statement` debit line item for a vendor with no matching `invoice` page in the same month

Thresholds match v1.0 constants (no behaviour drift on the demo seed).

### Concept page output format
- `concepts/march-anomaly-summary.md` — natural-language summary plus bullet lines:
  `- 2026-03-04: [[companies/<slug>]] <description> ($<dollar_impact>)`
- `concepts/recurring-charges.md` — table of recurring monthly charges with `last-event-age-days` and a ghost flag
- Both pages have YAML frontmatter sidecar: `severity: high|medium|low`, `dollar_impact: 79`, `anomaly_type: price-hike|duplicate|ghost-saas|missing-invoice`, `vendor_slug: companies/<slug>` per anomaly entry — but the body still matches the existing `bulletRegex` in `lib/insights/parsers/anomalies.ts` byte-for-byte.
- **Severity tiers:**
  - `high`: dollar_impact > $100 OR ghost-saas (recurring) OR missing-invoice
  - `medium`: dollar_impact $30–$100
  - `low`: anything below

### Idempotency
- The skill **overwrites** both concept pages each run (the v1.0 detector already does this). No append, no dedupe needed. Re-running produces byte-identical output for the same brain state.

### FIXTURES_ROOT refactor (prerequisite sub-task)
- Current state: `lib/insights/cache.ts::computeAndCache` is called with `FIXTURES_ROOT = data/maras-coffee/` for ALL tenants. v1.0 audit flagged this as a known decision; v1.1 must fix it.
- **Refactor:** `computeAndCache(tenantId: BrainSlug, sourceDir: string)` — caller passes the active tenant's `brains/<tenantId>/brain-repo/` directory; the synthetic seed/demo tenant continues to pass `FIXTURES_ROOT` explicitly.
- **Callers updated:** `app/api/tenants/[id]/insights/route.ts`, `lib/insights/prewarm.ts`. Both already have `tenantId` in scope.
- **Acceptance:** integration test — two different tenant brains yield different anomaly counts after the skill runs against each. The demo seed flow continues to return the same numbers it does today.

### Schema contract
- Write `docs/brain-schema.md` documenting the canonical frontmatter the skill consumes:
  - `type: invoice | bill | bank-statement | monthly-close | vendor-email`
  - `vendor: <human-readable vendor name>`
  - `vendor_slug: <kebab-case vendor name matching companies/<slug>>`
  - `date: <YYYY-MM-DD>`
  - `amount: <number, USD by default>`
  - `currency: <ISO 4217, default USD>`
- Wikilinks: vendor refs in body MUST be `[[companies/<vendor_slug>]]` (matches v1.0 WIKILINK_RE).
- This document is the contract Phase 6 QBO transformer must honour.

### Seed pipeline integration
- `scripts/seed.sh` switches the `bun scripts/detect-anomalies.ts` step (line 47) to `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow ...` running the skill. The full pipeline still completes in <10s on the demo laptop. If spike resolves to the fallback path, that line becomes `bun skills/smb-audit/scripts/smb-audit.mjs`.

### What v1.0 code we are NOT touching
- `lib/insights/parsers/anomalies.ts` regex — the skill writes output that matches the existing regex. No parser change.
- `lib/insights/types.ts` shape — the skill output reaches insight cards through the existing `AnomalyRow` shape.
- `lib/gbrain/mutex.ts`, `lib/gbrain/client.ts`, `lib/gbrain/tenants.ts` — Phase 4 stays clear of the harness; mutex key migration is a Phase 5 concern.
- Insight card components themselves — visual treatment of severity badges lands in v2 stretch (INSI-08).

</decisions>

<code_context>

## Existing Code Insights

Read via LSP workspaceSymbol + targeted file reads.

| File | Role | Phase 4 touch |
|---|---|---|
| `scripts/detect-anomalies.ts` | v1.0 hand-rolled detector (lines 21-29: REPO_ROOT/DATA_ROOT/ORIGINALS/COMPANIES/CONCEPTS path constants; DEMO_TODAY pinned to 2026-04-05; thresholds GHOST=90d, PRICE_HIKE=20%, DUPLICATE_WINDOW=7d) | Logic moves to `lib/audit/anomaly-detector.ts`; this script kept as legacy entry point until skill verified |
| `lib/insights/cache.ts` | computeAndCache(tenantId) — currently hardcodes `FIXTURES_ROOT` for all tenants | Add `sourceDir` param; demo tenant keeps FIXTURES_ROOT, real tenants pass their `brains/<id>/brain-repo/` |
| `lib/insights/parsers/anomalies.ts` | bulletRegex + computeAnomalies + extractDollarImpact (line 28) — reads concept pages, parses bullets | UNCHANGED — skill writes in the exact same format |
| `lib/insights/types.ts` | AnomalyRow shape (vendor/date/description/dollarImpact/sourcePath/vendorSlug) | UNCHANGED |
| `lib/gbrain/paths.ts` | FIXTURES_ROOT constant (line 14) | UNCHANGED — still used by seed/demo tenant |
| `scripts/seed.sh` | Seed-build pipeline; line 47 runs the v1.0 detector | Replaces the `bun … detect-anomalies.ts` line with the skill invocation |
| `lib/insights/prewarm.ts` | Pre-warm at boot — calls computeAndCache for the seed tenant | Update call site to pass FIXTURES_ROOT explicitly |
| `app/api/tenants/[id]/insights/route.ts` | GET endpoint serving insights bundle | Update call site to pass `brains/<id>/brain-repo/` as sourceDir |
| `lib/gbrain/client.ts::spawnGBrain` | Per-tenant CLI shell-out through the mutex | NOT TOUCHED in Phase 4 |

</code_context>

<specifics>

## Specific Ideas

### Plan-phase breakdown (target 4 plans)

1. **04-01-PLAN.md — Skill scaffold + detector port + frontmatter sidecar (SKIL-01..06, SKIL-08)**
   - Create `skills/smb-audit/SKILL.md` + `skills/smb-audit/scripts/smb-audit.mjs`
   - Extract detector logic to `lib/audit/anomaly-detector.ts` (pure functions)
   - Implement 4 anomaly rules (3 ported + missing-invoice)
   - Emit concept pages with severity/dollar_impact/anomaly_type/vendor_slug sidecar frontmatter
   - Write `docs/brain-schema.md`
   - Idempotent overwrite (no append)

2. **04-02-PLAN.md — FIXTURES_ROOT → sourceDir refactor (SKIL-09)**
   - Change `computeAndCache(tenantId, sourceDir)` signature
   - Update callers (`prewarm.ts`, `insights/route.ts`)
   - Update existing `BrainSlug` thinking — note that branded type lands in Phase 5; Phase 4 still uses plain `string` but functions accept `sourceDir: string`
   - Integration test: two tenants → two different anomaly counts

3. **04-03-PLAN.md — seed.sh integration + smoke gate (SKIL-07, SKIL-10)**
   - Modify `scripts/seed.sh` to invoke the skill instead of the v1.0 detector script
   - Verify <10s seed-pipeline wall-clock preserved
   - Smoke: skill writes concept pages → dashboard insight card renders 4 anomalies with severity badges populated from frontmatter sidecar
   - Run on a fresh `brains/seed/` end-to-end

4. **04-04-PLAN.md — Code review + cleanup**
   - Delete `scripts/detect-anomalies.ts` (or leave for one milestone as a deprecation marker — decide at the end of Phase 4)
   - Lint + typecheck pass
   - Documentation: update CLAUDE.md with the skill invocation pattern + `docs/brain-schema.md` cross-reference
   - Tag the smoke gate as the Phase 4 verification artifact

### Phase 4 mandatory spike (run BEFORE plan-phase commits code)

```bash
GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell \
  --params '{"cmd":"echo hello","cwd":"<repo>"}' \
  --follow
```

- Confirm execution, blocking behavior, exit code surfacing
- Confirm `import { search, get_page } from '@gbrain/api'` resolves under Bun (or that we DON'T need it because we read filesystem directly — likely the case for this skill since the input is already `originals/` + `companies/` markdown files in `GBRAIN_HOME`)
- **If shell-job path fails or PGLite blocks Minions queue:** fall back to `bun skills/smb-audit/scripts/smb-audit.mjs` direct invocation. The skill body is identical; only `scripts/seed.sh` invocation line changes.

### Acceptance bar

- All 5 Phase 4 success criteria from ROADMAP.md pass
- 10 SKIL requirements (SKIL-01..10) substantively delivered
- `bunx tsc --noEmit` clean
- No regression in v1.0 demo flow (seed → onboard → dashboard → chat → reset all still work end-to-end)

</specifics>

<deferred>

## Deferred Ideas

Captured here so they're not lost; explicitly NOT in Phase 4.

- **INSI-08 severity-badge UI** — Phase 4 emits the `severity` field; visual treatment in the dashboard is a v2 stretch UI follow-on.
- **`@gbrain/api` JS skill API exploration** — only if the simple "skill reads filesystem markdown" approach proves insufficient (unlikely; the v1.0 detector already does exactly this with `node:fs`).
- **gbrain MinionWorker daemon path** — out per ARCHITECTURE.md research; shell-job `--follow` is the simpler integration.
- **Insight-card cache invalidation API** — when QBO sync writes new files (Phase 6), we'll need to bust the cache. Phase 4 keeps the existing in-process cache as-is; cache busting lands with QBO sync in Phase 6.
- **Move `scripts/detect-anomalies.ts` deletion to Phase 5 or later** — keep it as a deprecation marker through one full milestone; delete during Phase 6 cleanup or Phase 7 (v1.2).

</deferred>
