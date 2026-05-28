# Spike Wrap-Up Summary

**Initial wrap-up:** 2026-05-19 (spikes 001 + 002)
**Appended:** 2026-05-19 (spikes 003 + 004 from frontier-mode pass)
**Appended:** 2026-05-28 (spikes 005 + 006 + 007 + 008 + 009 + 010 from v2.0 pre-execute integration + frontier pass)
**Spikes processed:** 13 (v1.x: 2 standalone + 1 parent + 3 comparison children + 1 infrastructure + 1 CPA; v2.0: 6 spikes covering Supabase migration, in-process refactor validation, importFromContent write path, pool capacity, cold-start, multi-tenant isolation)
**Feature areas:** 6 — Outbound communications · Accounting connector strategy · gbrain skill infrastructure · **v2.0 Supabase foundation · v2.0 in-process gbrain · v2.0 multi-tenant isolation**
**Skill output:** `./.claude/skills/spike-findings-quick-brain/` (extended)
**Auto-load:** wired into `CLAUDE.md`

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | vendor-report-emails | standard | PARTIAL ⚠ | Outbound vendor communications |
| 002 | accounting-api-comparison | comparison-parent | VALIDATED ✓ | Accounting connector strategy |
| 002a | accounting-api-xero | comparison | VALIDATED ✓ (add in v1.2) | Accounting connector strategy |
| 002b | accounting-api-wave | comparison | INVALIDATED ✗ | Accounting connector strategy |
| 002c | accounting-api-freshbooks | comparison | PARTIAL ⚠ (freelancer-niche) | Accounting connector strategy |
| 003 | minions-over-pglite | standard | VALIDATED ✓ (now obsoleted by Inngest pivot, but smb-audit findings still apply) | gbrain skill infrastructure |
| 004 | accountant-facing-reports | standard | VALIDATED ✓ (leads v1.2) | Outbound communications |
| 005 | gbrain-on-supabase | standard | VALIDATED ✓ | v2.0 Supabase foundation |
| 006 | gbrain-in-process | standard | VALIDATED ✓ | v2.0 in-process gbrain |
| 007 | gbrain-import-from-content | integration | VALIDATED ✓ | v2.0 in-process gbrain |
| 008 | inngest-supabase-pool | integration | VALIDATED ✓ | v2.0 Supabase foundation |
| 009 | vercel-fluid-coldstart | standard | VALIDATED ✓ | v2.0 in-process gbrain |
| 010 | per-tenant-engine-rls | standard | PARTIAL ⚠ (silent-leak architectural finding) | v2.0 multi-tenant isolation |

## Key Findings

**Spike 001 — Vendor outbound emails:**
- The content composition path is feasible — the brain already has every fact the email needs (orders, totals, dates, vendor identity, citations). No new data layer required.
- Resend (already locked for Phase 5 magic-link) handles 5-10 vendors × 4 weeks = 20-40 emails/month inside its free tier with order-of-magnitude headroom.
- **The single load-bearing UX call is the operator approval gate** — never auto-send. Converts "automated outbound" (legal + tone + trust risks) into "operator's weekly admin assist" (high value, low risk).
- Anomaly findings from the `smb-audit` skill (Phase 4) must **never** auto-inject into vendor-facing email bodies — they surface only in the operator's digest. Mara reviewing an anomaly is intelligence; Beanstalk receiving an accusation is broken relationship.
- The scheduler choice (Minions vs system cron vs GH Actions) is downstream of the Phase 4 spike on Minions-over-PGLite. First implementation should be manual-trigger; cron is a v1.2+ concern.
- **Open product question, not engineering question:** do vendors actually *want* these emails? Suppliers want POs and payments, not summary emails from their customer's "AI brain." Recommend a 3-pilot test with friendly real-world cafés before enabling beyond opt-in-per-vendor.

**Spike 002 — Accounting connector comparison:**
- **Keep QBO for v1.1 Phase 6.** Highest US SMB market share (~80%), best raw throughput (500 req/min — 8× Xero), longest refresh tokens (100 days). The "harder dev experience" axes (separate sandbox URL, community-maintained TS SDK) cost ~1-2 hours of one-time setup.
- **Add Xero as the second connector in v1.2.** Comparable persona fit in non-US markets, materially better dev velocity (Demo Company preloaded, official `xero-node` TS SDK, single base URL).
- **Skip Wave** — Wave deprecated new public-developer API access in 2024. Even if reopened, the data model is wrong (no `Bill` entity, free-text vendor names).
- **Skip FreshBooks for the Mara persona** — 12h refresh-token TTL fights every scheduled-sync use case. Time Tracking + Expense OCR matter for a freelancer SKU only.
- **Architectural call surfaced for Phase 6:** name connector-agnostic types (`ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`) in `lib/connectors/types.ts` from day one. Write Phase 6 code under `lib/connectors/qbo/` (not `lib/qbo/`). Saves a multi-file refactor when Xero arrives in v1.2.
- **Vendor email field availability is the unsung consequence of the connector choice.** QBO (`Vendor.PrimaryEmailAddr.Address`) + Xero (`Contact.EmailAddress`) both expose it as a first-class field; Wave + FreshBooks don't. This means the connector choice and the spike-001 vendor-email feasibility are structurally tied.

## Key Findings — Frontier Pass (spikes 003 + 004)

**Spike 003 — Minions over PGLite:**
- Empirically tested against installed gbrain 0.35.1 with PGLite backend. `GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow` **works inline, no daemon required.**
- Three Phase 4 design gotchas surfaced:
  1. The `smb-audit` skill (and every future custom skill) **must always exit 0**. Non-zero triggers gbrain Minions' 3-attempt retry policy with ~1s/2s/4s backoff (~7s wasted on deterministic failure). Internal errors → write `concepts/<skill>-error.md` and exit cleanly.
  2. **`scripts/seed.sh` must parse the `Result:` JSON line's `exit_code` field.** `gbrain jobs submit --follow`'s own exit code is always 0 regardless of job outcome.
  3. **`bun` must be in PATH** when invoking `gbrain` — it spawns its worker via `bun` internally. Defensive export at the top of all wrapper scripts.
- Phase 4 precondition spike embedded in 04-01-PLAN.md is empirically resolved. The skill mechanism is unblocked; the canonical shell-job pattern is the path.

**Spike 004 — Accountant-facing reports:**
- **Audience swap from "vendor" to "Mara's CPA / bookkeeper" eliminates 6 of 8 risks from spike 001.** The recipient explicitly wants the email (CPAs are paid to read monthly close packages), anomalies become the headline (not the omission), single-recipient model is materially simpler than per-vendor digest.
- **Reuses ~80% of spike-001's plumbing** — Resend, signed-token unsubscribe URLs, approval gate primitives, server-side template validator (with rule inversion).
- **PDF archival format = `@media print` stylesheet on the HTML body.** No Puppeteer / Cloud Run / PDF library. Browsers print to PDF natively; CPAs cmd+P to archive.
- **The audience-keyed template validator is the load-bearing safety check** — CPA payloads REQUIRE anomaly content; vendor payloads REJECT it. One module, two rule sets.
- Refines v1.2 "Outbound Communications": lead with **Phase A: CPA monthly close**, gate **Phase B: vendor weekly** on a 3-tenant pilot.

## Cross-Spike Themes

- **Both spikes converged on the same connectors (QBO + Xero) as the "future-proof" picks** — Wave and FreshBooks fail spike 002's data-shape test *and* spike 001's vendor-email-availability test simultaneously.
- **Compliance pressure is high but tractable.** CAN-SPAM is a hard constraint that drives template design, but the constraint is well-documented and the cost of compliance is template + audit-table boilerplate, not architecture work.
- **Manual-trigger before scheduled** is a pattern that surfaces in both spikes: the v1.2 Outbound Communications work should ship its manual button before any cron; the v1.2 Multi-Connector work should ship Xero before any auto-refresh-token-on-schedule cron.

## Roadmap Implications

Two new v1.2+ milestone candidates emerged:

1. **v1.2 "Outbound Communications"** — vendor digest UI + manual-trigger compose + CAN-SPAM template + audit table. Pairs spike 001's findings with the connector-required `vendor_email` field. ~6-10h.
2. **v1.2 "Multi-Connector"** — Xero adapter against the shared `lib/connectors/types.ts` interface introduced in v1.1 Phase 6. Connector-abstraction refactor + Xero `transformer.ts` + dashboard "Connect" dropdown. ~10-14h.

These do not block v1.1 — they extend it. Capture as `v1.2-CANDIDATES.md` after v1.1 closes, not now.

## Action Items for v1.1 Phase 6 (Before Execute)

One small change to the existing Phase 6 plan, derived from spike 002:

- **Update 04-04-PLAN.md or the Phase 6 PLAN files** so QBO code lives at `lib/connectors/qbo/` (not `lib/qbo/`). Add `lib/connectors/types.ts` with the connector-agnostic shapes. Trivial in Phase 6; saves a multi-file refactor in v1.2.

## Action Items for v1.1 Phase 4 (Before Execute) — added from spikes 003 + 004

Three small edits to the existing Phase 4 plans, derived from spike 003:

- **`04-01-PLAN.md`** — replace the "30-min spike" precondition with a 5-min "verify env" task. The actual spike (003) is empirically resolved and the canonical pattern is documented.
- **`04-03-PLAN.md`** — `scripts/seed.sh` must parse the `Result:` JSON line's `exit_code` field, not rely on `gbrain jobs submit --follow`'s own exit code (always 0 regardless of job outcome). Acceptance: a 5-line shell snippet to extract + check.
- **`04-04-PLAN.md`** — cleanup task should include updating `scripts/demo-check.sh` to verify `bun` is on PATH (`export PATH="$HOME/.bun/bin:$PATH"` defensive export).
- **`skills/smb-audit/scripts/smb-audit.mjs`** must use try/catch + write `concepts/audit-error.md` + always `process.exit(0)` to avoid Minions' 3× retry on non-zero exit.

## v1.2 Milestone Direction (post-frontier)

The wrap-up's v1.2 candidates refine:

- **v1.2 "Outbound Communications"** — **lead with Phase A: CPA-facing monthly close** (spike 004 VALIDATED). Vendor-facing weekly (spike 001 PARTIAL) becomes Phase B, gated on a 3-tenant real-world pilot. Same composition pipeline, audience-keyed template validator.
- **v1.2 "Multi-Connector"** (unchanged) — Xero adapter against the shared `lib/connectors/types.ts` interface.

---

## Wave 2 Key Findings (2026-05-28 — v2.0 pre-execute integration + frontier pass)

Six spikes ran before Phase 7 execute to de-risk the v2.0 in-process + Supabase + multi-tenant architecture. Headline outcomes:

**Spike 005 — gbrain on Supabase (VALIDATED ✓)**:
- One-time `gbrain migrate --to supabase` is lossless, self-verifying, 45s wall on 48 pages.
- Free tier sufficient (Postgres 17.6 + pgvector 0.8.0 + pg_trgm 1.6). Pro is zero-ops/backups preference, not a technical gate.
- **Gotcha:** migrate writes the password in plaintext into `<brain>/.gbrain/config.json`. Prod must use `GBRAIN_DATABASE_URL` env var + gitignore the brain dir.
- gbrain auto-enables RLS on every public table — but the role we connect as has BYPASSRLS (uncovered as critical in spike 010).

**Spike 006 — in-process gbrain (VALIDATED ✓)**:
- App can drop `spawn("gbrain", …)` entirely. `createEngine` + `connect` + `hybridSearch` runs 1.34s end-to-end on a warm engine, no child process.
- gbrain's `package.json#exports` map is rich — `./engine-factory`, `./search/hybrid`, `./search/expansion`, `./ai/gateway`, etc. all importable.
- Inserted the "in-process gbrain refactor" as Phase 3 before "Vercel Deploy" (Phase 4). All v2.0 follow-on work assumes this architecture.

**Spike 007 — `importFromContent` write path (VALIDATED ✓)**:
- The Phase 7 ingest entrypoint works in-process: 1.9s/page (incl. one OpenAI text-embedding-3-large call), idempotent on content_hash, isolated by sourceId.
- **FINDING that would have bitten Phase 7 mid-execution:** `importFromContent` enforces FK `pages_source_id_fkey` — the QBO OAuth-connect handler MUST `INSERT INTO sources` before enqueuing the first ingest job. None of the 9 Phase 7 plans had this step.
- Re-sync (D-08 "wipe-and-reingest") is one SQL: `DELETE FROM sources WHERE id = $1`. FK ON DELETE CASCADE sweeps pages + chunks + tags + links atomically in ~120ms.
- `types/gbrain.ts` shim can be safely extended with `importFromContent` via the same `_load("import-file")` pattern as existing exports.

**Spike 008 — Inngest × Supabase pool (VALIDATED ✓)**:
- gbrain's default max:10 pool absorbs N=200 concurrent queries (0 errors, 1.9s wall) and M=10 concurrent Inngest-shaped 5-step jobs (50 queries, 688ms wall, 0 errors). No pool tuning needed for v2.0.
- Latency follows a clean M/M/c queue model with c=10 — predictable, no cliff.
- **Bonus finding (lint rule worthy):** parameterless `engine.executeRaw(template)` hangs indefinitely against the Supavisor transaction-mode pooler. statement_timeout doesn't fire because the query never leaves postgres.js's client-side path. Adding any dummy $1 param fixes it.

**Spike 009 — Vercel Fluid Compute cold-start (VALIDATED ✓)**:
- Cold path: 1.75s mean / warm path: 1.17s mean / ratio 1.5×.
- **Surprise:** the actual cold infrastructure tax is only ~310ms (62ms Bun init + module load, 240ms Supabase connect, ~10ms create_engine). The other ~1.4s of "cold path" is the OpenAI embedding call — same cost on warm instances.
- **Phase 4 ships without warm-pooling.** 310ms savings doesn't justify a scheduled keep-alive cron + complexity. Default Vercel Fluid Compute instance reuse handles 95%+ of requests.
- Don't change `next.config.ts` `serverExternalPackages: ['gbrain']` — the 62ms gbrain-module-load timing assumes Bun loads raw `.ts` at runtime.

**Spike 010 — per-tenant engine RLS (PARTIAL ⚠ — architectural finding)**:
- **The big finding:** gbrain enables RLS on every table BUT the Supabase pooler role has `BYPASSRLS`. **RLS does NOT protect QuickBrain from in-app code that forgets to pass sourceId.** All tenant isolation lives in app-layer per-call sourceId scoping.
- The single-shared-engine pattern in `lib/gbrain/engine.ts` SURVIVES 20 interleaved concurrent queries from 2 tenants with 0 cross-tenant leaks (positive validation).
- **But the failure mode is silent:** `engine.getPage(slug)` / `deletePage` / `listPages` / `hybridSearch(engine, q)` without a sourceId arg silently returns / mutates / federates across all tenants. No exception, no warning, no audit trail.
- **Required prerequisite for Phase 7:** `lib/gbrain/tenant-scoped.ts` wrapper functions + ESLint rule banning bare `engine.*` outside `lib/gbrain/`. Audit existing call sites in `lib/`, `app/`, `scripts/` before Phase 7 lands.

## Action Items for Phase 7 (Before Execute) — derived from Wave 2 spikes

Phase 7 plans must add or extend before its 9-plan rollout executes:

1. **NEW plan**: build `lib/gbrain/tenant-scoped.ts` wrappers (`tenantSafeGetPage`, `tenantSafeDeletePage`, `tenantSafeListPages`, `tenantSafeHybridSearch`, `tenantSafeImportFromContent`). Each resolves `tenantId → sourceId` via `lib/auth/resolve-tenant.ts` and requires both args. (Spike 010)
2. **NEW plan**: ESLint rule banning bare `engine.getPage(` / `engine.deletePage(` / `engine.listPages(` / bare `hybridSearch(` / bare `importFromContent(` outside `lib/gbrain/`. Compile-time defense against silent leaks. (Spike 010)
3. **Audit task**: grep every existing `engine.*` and bare `hybridSearch` / `importFromContent` call in `lib/`, `app/`, `scripts/` — confirm each passes a per-request sourceId derived from `resolveTenant()`. Phase 6 shipped without this audit; any oversight is a live leak. (Spike 010)
4. **Plan 07-01 (or similar)**: extend `types/gbrain.ts` with `importFromContent` shim wrapper using the existing `_load("import-file")` pattern. (Spike 007)
5. **Plan 07-02 (QBO OAuth connect handler)**: register the source row via `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT (id) DO NOTHING` BEFORE enqueuing the first ingest job. (Spike 007)
6. **Plan 07-XX (re-sync)**: implement D-08 "wipe-and-reingest" as one `DELETE FROM sources WHERE id = $1` (FK cascade handles the rest). (Spike 007)
7. **Lint rule**: any `engine.executeRaw(template)` call where the second arg is missing or `[]` is an error. (Spike 008)

## Action Items for Phase 4 (Before Execute) — derived from Wave 2 spikes

- **None functional.** Phase 4 ships with default Vercel Fluid Compute behavior. Set realistic chat-UX expectations ("typical 1-2s") in Phase 4's UI surface.
- Do not change `next.config.ts` `serverExternalPackages: ['gbrain']`.

## Phase 9+ Optimization Opportunity

- **Query-embedding LRU cache** — currently every `hybridSearch` makes a fresh OpenAI `text-embedding-3-large` call. Common queries ("what was weird about last month?") run repeatedly. An LRU keyed by normalized query text → 3072-dim vector could halve warm-path latency (1.2s → 0.6s). Defer to Phase 9+ when there's real traffic to measure.

---

*Initial wrap-up: 2026-05-19. Frontier-spike append: 2026-05-19 (spikes 003 + 004). v2.0 pre-execute integration + frontier append: 2026-05-28 (spikes 005-010).*
