---
phase: 01-brain-spine-synthetic-seed
plan: 00
subsystem: brain-harness
tags: [gbrain, bun, typescript, pglite, mutex, zod, synthetic-data, anomaly-detection]

requires: []
provides:
  - gbrain CLI install + version pinning documented (HARN-01)
  - scripts/demo-check.sh preflight (HARN-02, warn-only on Anthropic)
  - lib/gbrain/client.ts spawn helper + GbrainError (HARN-03)
  - lib/gbrain/mutex.ts per-tenant Promise queue, leak-free (HARN-04)
  - lib/gbrain/tenants.ts in-memory registry rebuilt from brains/* (HARN-05)
  - lib/gbrain/slug.ts strict zod regex (HARN-06)
  - 46-file Mara's Coffee synthetic dataset under gbrain whitelisted dirs (DATA-01..07)
  - scripts/detect-anomalies.ts hand-rolled TS detector with 3 rules (DATA-08)
  - scripts/seed.sh end-to-end pipeline init→config→import→extract→embed (DATA-09)
  - reproducible brains/seed/ artifact (DATA-11)
  - scripts/concurrent-smoke.ts gbrain-query smoke gate (canonical, deferred-pending-Anthropic)
  - scripts/mutex-smoke.ts LLM-free mutex invariant proof
  - lib/gbrain/onboard.ts reusable orchestrator helper (Phase 2 prep)
affects: [phase-02-onboarding, phase-03-insights]

tech-stack:
  added: [bun-1.3, gbrain-0.35, zod, @types/bun, typescript-5.9]
  patterns:
    - "Hand-rolled per-tenant Promise mutex (Map<tid, Promise>) — zero deps"
    - "spawn-and-collect (not stream) for gbrain CLI — single-response shape"
    - "Path-derived slugs (no `slug:` in frontmatter) for gbrain import"
    - "Wikilinks must be `[[dir/slug]]` per gbrain WIKILINK_RE whitelist"
    - "Hand-rolled markdown frontmatter parser (no gray-matter dep)"

key-files:
  created:
    - lib/gbrain/{client,mutex,tenants,slug,paths,onboard,index}.ts
    - scripts/{demo-check.sh,seed.sh,detect-anomalies.ts,generate-fixtures.ts,concurrent-smoke.ts,mutex-smoke.ts}
    - data/maras-coffee/{companies,people,concepts,originals}/*.md (46 files)
    - package.json, tsconfig.json, README.md, .env.example, .gitignore
  modified: []

key-decisions:
  - "HARN-02 relaxed warn-only on missing ANTHROPIC_API_KEY (CONTEXT.md spec adjustment)"
  - "PR #1 by lightspeed authored Phase 1 in parallel; rebased docs onto merge"
  - "Hand-rolled Promise mutex over p-queue lib — 20 LoC, zero deps"
  - "Single scripts/detect-anomalies.ts with 3 rule fns over per-rule modules"
  - "Anomaly concept pages wikilink BOTH source (originals/) AND vendor (companies/)"
  - "Next.js scaffold deferred to Phase 2 (Phase 1 is terminal-only)"
  - "No unit tests in lib/gbrain/__tests__/ — mutex-smoke.ts covers HARN-04; rest deferred"

patterns-established:
  - "Frontmatter `slug:` MUST be omitted — gbrain derives from path; mismatch silently kills 30% of imports"
  - "Wikilinks MUST be `[[dir/slug]]` not `[[slug]]` — gbrain whitelist: people|companies|meetings|concepts|deal|civic|project|projects|source|media|yc|tech|finance|personal|openclaw|entities"
  - "gbrain import does NOT auto-extract links — must follow with `gbrain extract all --source db`"
  - "Detector bank-statement parsing accepts optional `companies/` prefix and stores the bare vendor slug"
  - "Mutex `.finally()` chain must tail-`.catch(()=>{})` to avoid orphan rejection leaks"

requirements-completed:
  - HARN-01
  - HARN-02
  - HARN-03
  - HARN-04
  - HARN-05
  - HARN-06
  - DATA-01
  - DATA-02
  - DATA-03
  - DATA-04
  - DATA-05
  - DATA-06
  - DATA-07
  - DATA-08
  - DATA-09
  - DATA-10  # partial — graph + mutex pass; LLM-naming deferred (no Anthropic)
  - DATA-11

duration: ~3h (incl. lightspeed PR #1 + post-merge fixes + verification)
completed: 2026-05-16
---

# Phase 1: Brain Spine + Synthetic Seed Summary

**A seeded `brains/seed/` exists with 46 imported pages, real graph edges across 6 entities, 3 detected planted anomalies, and a proven per-tenant mutex — every check in the smoke gate passes except the LLM answer-naming, which is deferred until `ANTHROPIC_API_KEY` is added.**

## Performance

- **Duration:** ~3h (smart discuss + plan + lightspeed PR review/merge + 5 follow-up fixes + verification)
- **Started:** 2026-05-16 (smart discuss)
- **Completed:** 2026-05-16 (smoke gate passes minus #4)
- **Plans on disk:** 6 (`01-{01..06}-PLAN.md`) — informational; PR #1 satisfied the requirements without following the per-plan structure
- **Files added:** 64 (lib/gbrain, scripts/, data/maras-coffee/, repo config)

## Accomplishments

### gbrain Harness (HARN-01..06)
- `lib/gbrain/client.ts` — `spawnGBrain(args, opts)` with `GBRAIN_HOME` injection, env inheritance, `CI=1` non-interactive, optional timeout, typed `GbrainError`-style throws on ENOENT/timeout.
- `lib/gbrain/mutex.ts` — hand-rolled `Map<tenantId, Promise<unknown>>` queue; `.then(task, task)` ensures successor runs even after predecessor rejects; tail-`.catch` prevents orphan rejection leaks; `pendingTenants()` for diagnostics.
- `lib/gbrain/tenants.ts` — in-memory `Map<tenantId, TenantRecord>` rebuilt by `readdir(BRAINS_ROOT)` on init.
- `lib/gbrain/slug.ts` — strict zod regex `^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$`, path-traversal safe.
- `lib/gbrain/onboard.ts` — bonus reusable orchestrator wrapping init→config→import→extract→embed→warmup with progress events. Phase 2 SSE route consumes this directly.
- `scripts/demo-check.sh` — 5-check preflight (gbrain on PATH, `gbrain doctor --fast`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` warn-only, `./brains/` writable).
- `README.md` documents the clone+link gbrain install, anti-`bun -g` warning, both env vars.

### Synthetic Data (DATA-01..07)
- 46 markdown files under `data/maras-coffee/{companies,people,concepts,originals}/` — gbrain-whitelisted dirs only.
- 5 anchor vendors (Beanstalk Roasters, Square POS, 7shifts, Landlord LLC, PG&E Utility) + 1 person (Mara Okafor) + 2 hand-authored vendor emails.
- 30 invoices (2/vendor/month × 5 vendors × 3 months), 3 bank statements, 3 monthly closes.
- 3 planted anomalies wired through the data: Beanstalk +22% price hike in March, Square duplicate $79 on Mar 4 + Mar 11, ghost 7shifts subscription with stale vendor-event timeline.

### Anomaly Detector (DATA-08)
- `scripts/detect-anomalies.ts` — single TS file with 3 rule functions (`priceHike`, `duplicate`, `ghost`).
- Outputs `concepts/march-anomaly-summary.md` (LLM-targeted prose, top hit in vector retrieval at score 0.84) and `concepts/recurring-charges.md` (audit list with ⚠ GHOST flags).
- Exit code 2 if any class isn't detected for the current month → seed pipeline fails loud.

### Seed Pipeline (DATA-09, DATA-11)
- `scripts/seed.sh` — `generate-fixtures` → `detect-anomalies` → `gbrain init --yes` → `gbrain config set models.default sonnet` → `gbrain import --no-embed` → `gbrain extract all --source db` → `gbrain embed --stale`. Idempotent (wipes `brains/seed/` first), <10s wall clock.
- `brains/seed/` is the canonical artifact Phase 2 onboarding will `cp -r` from.

### Smoke Gate (DATA-10 — partial)
- ✓ Criterion 1: `bun run demo-check` → exits 0.
- ✓ Criterion 2: `bun run seed` → 46/46 imported, 0 skipped, 3 anomalies detected.
- ✓ Criterion 3: `gbrain graph-query companies/beanstalk-roasters --depth 2` → reaches 5 other companies via mara-okafor (≥3 neighbors).
- ⊘ Criterion 4: `gbrain query "what was weird about last month?"` → retrieval ranks the anomaly summary, Square receipt, and 7shifts invoices in the top 20 chunks (0.84 high score), but `gbrain think` hangs on missing `ANTHROPIC_API_KEY`. **Deferred per CONTEXT.md spec adjustment** — re-run after key is added.
- ✓ Criterion 5: `bun run mutex-smoke` → 4 mutex invariants prove same-tenant serialization (ms 0/300/600), cross-tenant parallelism (<600ms total), post-reject recovery, queue self-cleanup. `scripts/concurrent-smoke.ts` (canonical query-based gate) remains for when Anthropic arrives.

## What's Deferred

- **DATA-10 / Criterion #4:** LLM-generated answer naming all 3 anomalies. Once `ANTHROPIC_API_KEY` is exported to `~/.zshenv`, re-run `GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"` and verify the output mentions Beanstalk, Square duplicate, and 7shifts.
- **Unit tests** for `lib/gbrain/{client,tenants,slug}.ts` — `mutex-smoke.ts` is the only behavioral test that shipped. Plan called for `__tests__/` dirs; deferred to keep Phase 1 lean.
- **Next.js scaffolding** — Phase 2 will run `bunx create-next-app@latest . --use-bun` on top of this terminal-only base.

## Surprises / Gotchas Documented

1. **gbrain import silently skips pages whose `slug:` frontmatter doesn't match the path-derived slug.** Removing `slug:` from frontmatter altogether is the fix.
2. **gbrain's wikilink regex (`WIKILINK_RE`) requires `[[dir/slug]]` form** where `dir` is in a closed whitelist (people, companies, concepts, etc. — `originals` is NOT in that whitelist). Bare `[[slug]]` produces zero graph edges.
3. **`gbrain import` does NOT extract wikilinks to graph edges.** Must follow with `gbrain extract all --source db`. The PR's seed.sh missed this; added.
4. **`gbrain query` without `ANTHROPIC_API_KEY` does NOT return a placeholder string** — it hangs at 99% CPU. The placeholder behavior we read in `think/index.ts:225` only fires under specific conditions; in practice the process spins.
5. **Bun's non-interactive zsh subshells don't source `~/.zshrc`** — only `~/.zshenv`. AND `OPENAI_API_KEY="..."` in `~/.zshenv` without `export` keeps it as a shell-local var, invisible to spawned children. Fixed by adding `export`.
6. **`lib/gbrain/mutex.ts` had an orphan-rejection leak in its `.finally()` chain** — would crash Next.js production when a tenant task throws. Tail `.catch(() => {})` added.

## Implementation Path (Non-Linear)

Phase 1 was authored partly by `lightspeed` (external AI tool) as PR #1 while the orchestrator was blocked on API keys. PR #1 (commit `1621355`) implemented all 17 requirements with high code quality but didn't account for the live gbrain CLI's actual behavior (slug-frontmatter handling, wikilink whitelist, extract step). The orchestrator merged the PR, then patched 5 issues (commit `9a2d675`) to make the seed pipeline actually produce a queryable brain. This pattern — external implementation + post-merge integration testing — proved valuable for the 7.5h budget.

## Next Phase

Phase 2 picks up from `brains/seed/` and `lib/gbrain/{client, tenants, onboard}.ts`. The Phase 2 Route Handler at `/api/tenants` will `cp -r brains/seed/ brains/<tenantId>/` and stream the 5-stage SSE onboarding (init → import → graph → search → ready), then the dashboard chat surface POSTs to `/api/tenants/<id>/chat` which invokes `query()` from `lib/gbrain/index.ts`. **Phase 2's chat smoke gate depends on `ANTHROPIC_API_KEY`** — until that's set, the chat returns a graceful timeout error instead of an answer.
