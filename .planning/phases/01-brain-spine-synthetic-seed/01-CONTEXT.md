# Phase 1: Brain Spine + Synthetic Seed - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning

<domain>
## Phase Boundary

A seeded `gbrain` instance running locally answers the three P0 demo questions correctly from the terminal — validating the entire data path (install → env → seed → import → embed → anomaly detection → graph-query → query) before any UI exists.

In scope: gbrain CLI install harness, `scripts/demo-check.sh`, `lib/gbrain/client.ts` (spawn + per-tenant mutex + typed errors), `lib/gbrain/tenants.ts` (in-memory Map rebuilt from `./brains/*`), zod slug validation, the full Mara's Coffee synthetic dataset under gbrain-whitelisted dirs, hand-rolled TypeScript anomaly detector, `scripts/seed.sh` end-to-end producing `brains/seed/`, smoke gate (`gbrain graph-query`, `gbrain orphans`, `gbrain query "what was weird about last month?"`).

Out of scope: any web UI (`/`, `/onboard`, `/dash` — Phase 2), SSE streaming (Phase 2), insight cards (Phase 3), reset button (Phase 3), demo script doc (Phase 3), `smb-audit` custom skill (v2 stretch), 4th anomaly DATA-12 (v2 stretch).

</domain>

<decisions>
## Implementation Decisions

### Synthetic Dataset Texture
- `originals/` pages use a realistic 2–3 sentence narrative under the `Compiled truth:` section above the `---` divider — enough texture for the LLM to quote believably in the demo.
- 5th supplier (beyond Beanstalk, Square, 7shifts, Landlord) is **`pge-utility`** (PG&E electricity) — small monthly bill, well-known brand, makes the "top vendors" card credible.
- 2 invoices per anchor vendor per month (matches DATA-04 minimum) — saves authoring time; demo doesn't need denser data.
- Frontmatter dates in **ISO 8601** (`date: 2026-03-04`) so gbrain's timeline parser handles them cleanly.

### Anomaly Detector Architecture
- Single `scripts/detect-anomalies.ts` with 3 rule functions (`detectPriceHike`, `detectDuplicateCharges`, `detectGhostSaaS`) — faster to ship in 7.5h budget; trivial to grow if needed.
- Output style for `concepts/march-anomaly-summary.md` + `concepts/recurring-charges.md`: structured markdown — H2 per anomaly, plain-English description, `**Impact:** $N`, wikilinks to source pages.
- Detector runs as a step inside `scripts/seed.sh` after `gbrain import` — keeps the seed pipeline a single-script flow.
- Each anomaly entry wikilinks BOTH the originating `originals/` page AND the `companies/` vendor — feeds gbrain's graph back into itself, surfaces in `graph-query` neighbors.

### gbrain Client Plumbing (`lib/gbrain/client.ts`)
- Mutex queue: hand-rolled Promise-chain map keyed by tenantId (`Map<string, Promise<void>>`). New calls `await` the prior promise and chain on. Zero deps, ~20 LoC, surgical fit for HARN-04.
- `gbrain query` stdout: collect full stdout into a string, return `{stdout, stderr, code}` — gbrain query is single-response per CHAT-02; Phase 2 SSE wraps this layer, not replaces it.
- No timeout enforced in `spawnGBrain` — Phase 2 (CHAT-06) layers the 30s timeout at the Route Handler boundary so the demo-check and seed import can run longer than 30s without hitting a spawn-layer cap.
- Errors: throw a typed `GbrainError` extending `Error` with `{stderr, code, args}` — lets callers `try/catch` naturally; matches Next.js Route Handler error idioms.

### Claude's Discretion
- Exact prose of synthetic invoice/email/bank-statement bodies (themes locked: anchor vendors, anomaly construction, dates, prices).
- Internal structure of `lib/gbrain/tenants.ts` rebuild routine (just needs to satisfy HARN-05).
- Layout of `scripts/seed.sh` shell vs `bun run seed` invocation (must satisfy DATA-09).
- TypeScript anomaly rule thresholds (price hike % gate, recurring-charge "ghost" window) provided the planted anomalies are detected.
- Exact wording / format of `scripts/demo-check.sh` error messages (just needs to exit non-zero per HARN-02).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield repo. Only `.planning/` docs and `CLAUDE.md` exist.

### Established Patterns
- None — first phase establishes the baselines: `bun` + TypeScript + `node:child_process.spawn`, zod for input validation, shell scripts under `scripts/`, library code under `lib/`.

### Integration Points
- `lib/gbrain/client.ts` exports `spawnGBrain` and the `GbrainError` class — Phase 2 Route Handlers will import this directly; do not couple to Next.js types here.
- `lib/gbrain/tenants.ts` exports a TenantRegistry surface — Phase 2 `/api/tenants` POST handler depends on it.
- `brains/seed/` is the artifact Phase 2 onboarding copies from via `cp -r brains/seed/ brains/<tenantId>/`.

</code_context>

<specifics>
## Specific Ideas

- **Operational prerequisites surfaced by the user before Phase 1 starts:**
  1. `gbrain` is NOT yet installed on this machine — the plan must include `git clone https://github.com/garrytan/gbrain` (sibling dir), `bun install && bun link` per gbrain's `INSTALL_FOR_AGENTS.md`. NOT `bun install -g github:garrytan/gbrain` (postinstall is blocked).
  2. `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are NOT yet exported in the demo shell — the plan must include an explicit checkpoint/instruction for the operator to export them before running `gbrain init` or any seed step.

- Persona/brand: Mara's Coffee — neighborhood coffee shop in Oakland. 3 months of data (Jan–Feb–Mar 2026). Anomalies all land in March so "what was weird about last month?" is the canonical demo query (current date in the demo is 2026-04-XX).

- Planted anomalies (locked in REQUIREMENTS.md, restating for plan):
  1. Beanstalk Roasters price hike: invoices Jan/Feb hover around base price; March invoices jump +22%. A vendor email in `originals/email-beanstalk-2026-03-01.md` announces the hike.
  2. Square POS duplicate charge: $79 on Mar 4 AND Mar 11 (same dollar amount), both visible on `originals/bank-statement-2026-03.md`. A receipt email `originals/email-square-receipt-2026-03-11.md` confirms the duplicate.
  3. Ghost 7shifts SaaS: $29/mo recurring charge present in all 6 bank statements (we only ship 3 — extend the recurring window via 3 more older `bank-statement-YYYY-MM.md` files OR adjust the threshold). `companies/seven-shifts.md` has no vendor events newer than 2025-09-XX so the "no recent event" rule fires.

- gbrain config: `gbrain config set models.default sonnet` is set during seed (specified in Phase 1 success criterion #2).

- Smoke gate (DATA-10): three commands must all succeed before phase declared done:
  - `GBRAIN_HOME=brains/seed gbrain graph-query beanstalk-roasters --depth 2` returns ≥3 neighbors
  - `GBRAIN_HOME=brains/seed gbrain orphans` returns a short list (sanity check that link coverage is reasonable)
  - `GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"` names all 3 planted anomalies in one response

- Concurrency proof (success criterion #5): a tiny harness in `scripts/concurrent-smoke.ts` that fires 3 `gbrain query` calls in parallel through `lib/gbrain/client.ts` and asserts no PGLite lock errors — proves HARN-04.

</specifics>

<deferred>
## Deferred Ideas

- 4th planted anomaly (DATA-12: missing-invoice for "ABCD Plumbing $340") — explicitly v2 stretch.
- Custom `smb-audit` gbrain skill (SKIL-01) — explicitly v2 stretch; hand-rolled TS detector ships in v1.
- Charts/visx for any data display — Out of Scope in REQUIREMENTS.md.
- Live data integration (Gmail/QuickBooks/Stripe) — Out of Scope.
- Multi-persona dataset variants — Out of Scope (single persona per demo constraint).
- Any UI work — Phases 2 and 3.

</deferred>
