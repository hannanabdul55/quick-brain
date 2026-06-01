---
name: spike-findings-quick-brain
description: Implementation blueprint from spike experiments for QuickBrain. Requirements, proven patterns, and verified knowledge for building outbound communications (CPA + vendor), accounting connectors, gbrain skill infrastructure, the v2.0 Supabase + in-process-gbrain stack, and multi-tenant isolation. Auto-loaded during implementation work.
---

<context>
## Project: quick-brain

QuickBrain is a 60-second onboarding shell around gbrain that lets a non-technical small-business owner spin up a working business brain. v1.0 shipped a hackathon demo with synthetic Mara's Coffee data. v2.0 ("Real-World Foundation", post-hackathon pivot 2026-05-19) extends it for real SMB owners with: Supabase Postgres + asset storage (Phase 2), in-process gbrain refactor (Phase 3), Vercel deploy (Phase 4), Inngest background jobs (Phase 5), auth + multi-tenant isolation (Phase 6, complete), and QuickBooks Online ingest (Phase 7, planned). Ten feasibility questions have been spiked across two waves: wave 1 (v1.x) — outbound emails, accounting connectors, gbrain skill infrastructure, CPA reports; wave 2 (v2.0 pre-execute) — gbrain on Supabase, in-process refactor, write-path validation, pool capacity, cold-start, multi-tenant isolation.

Spike sessions wrapped: 2026-05-18 (spikes 001 + 002), 2026-05-19 (spikes 003 + 004 + wrap-up), 2026-05-28 (spikes 005-010 + wrap-up).
</context>

<requirements>
## Requirements

Non-negotiable design decisions that emerged from spike sessions. Every feature area reference honors these.

### Outbound communications (from spikes 001 + 004)

- **No auto-send to any audience.** Every outbound email passes through an operator approval gate. CPA path: simpler single-recipient preview. Vendor path: per-vendor digest with checkboxes.
- **Audience-keyed template validator** is the load-bearing safety check. CPA payloads REQUIRE anomaly content; vendor payloads REJECT it. Server-side, runs on every send.
- **v1.2 leads with CPA-facing monthly close emails** (spike 004 — recipient explicitly wants them; anomalies are the headline; single-recipient model is materially simpler).
- **Vendor-facing weekly emails are gated on a 3-tenant pilot** before general availability (spike 001 — recipient-desirability question is unresolved).
- **Reuse Resend** (already locked for v1.1 Phase 5 magic-link auth). One provider, one verified domain.
- **PDF archival format is `@media print` CSS** on the HTML body. No Puppeteer / Cloud Run / PDF library — browsers print to PDF natively.
- **Email is sent FROM the operator's identity**, not from QuickBrain. Footer credits QuickBrain as the composing tool.
- **Physical postal address + unsubscribe link** required in every email footer (CAN-SPAM §5.3 + §5.4). Validator must reject any payload missing either.
- **Unsubscribe link token shape matches Phase 5's magic-link token shape** — same signing key, reuse `lib/auth/jwt.ts` helpers.

### Accounting connectors (from spike 002)

- **v1.1 Phase 6 stays QBO-only.** Highest US SMB market share + best raw throughput (500 req/min) + longest refresh tokens (100 days). No multi-connector work in v1.1.
- **Name connector-agnostic types from day one** in `lib/connectors/types.ts` — `ConnectorBill`, `ConnectorVendor`, `ConnectorBankLine`. The transformer is per-connector; the markdown writer is connector-blind.
- **Use `lib/connectors/qbo/` path in v1.1** (not `lib/qbo/`). Trivial diff in Phase 6, saves a multi-file refactor when Xero arrives in v1.2.
- **Slug prefixing**: every connector emits prefixed slugs (`qbo-`, `xero-`) on vendor pages. Prevents collision when a tenant carries both synthetic seed and live data.
- **Vendor email is a required transformer output** when the source connector exposes it (QBO + Xero). Wave + FreshBooks don't expose it.
- **Refresh-token rotation discipline is uniform across connectors**: persist newest `refresh_token` immediately after every exchange.
- **No connector without a `Bill` / `Invoice` / `Vendor` first-class entity.** Wave and FreshBooks both fail (free-text vendor names) and are explicitly skipped.
- **Skip Wave** (no new dev applications since 2024; wrong data model anyway).
- **Skip FreshBooks for SMB persona** (12h refresh-token TTL kills scheduled syncs).

### gbrain skill infrastructure (from spike 003)

- **PGLite backend supports `gbrain jobs submit shell --follow` inline** — no `jobs work` daemon required. Empirically confirmed against gbrain 0.35.1. (NOTE: v2.0 has pivoted to Inngest for background jobs — spike 003's findings still apply for dev-mode CLI workflows and the smb-audit skill, but are NOT the v2.0 production job runner.)
- **Every custom skill (including `smb-audit`) MUST always exit 0.** Non-zero shell exits trigger Minions' 3-attempt retry policy. Internal errors → write `concepts/<skill>-error.md` and exit cleanly.
- **`scripts/seed.sh` MUST parse the `Result:` JSON line's `exit_code` field** to detect job failure — `gbrain jobs submit --follow`'s own exit code is always 0 regardless of job outcome.
- **`bun` must be in PATH** when invoking `gbrain`. `export PATH="$HOME/.bun/bin:$PATH"` defensively in `scripts/seed.sh` + `scripts/demo-check.sh` + any cron wrapper.
- **gbrain overhead per `jobs submit shell --follow` invocation is ~300ms.** Acceptable for Phase 4 (one skill invocation per seed); not appropriate for high-frequency per-request use.

### v2.0 Supabase foundation (from spikes 005 + 008)

- **gbrain runs on Supabase Postgres in v2.0.** PGLite is dev fast path only. Engine config: `{ engine: "postgres", database_url: SUPABASE_DB_URL_POOLER }`.
- **Use Supavisor transaction pooler (port 6543) for app runtime; direct 5432 only for one-time migration DDL.** gbrain auto-detects port 6543 → `prepare: false`.
- **`gbrain migrate --to supabase` writes the password in plaintext to `<brain>/.gbrain/config.json`.** Use `GBRAIN_DATABASE_URL` env var instead; keep config.json password-free; gitignore the brain dir.
- **gbrain default `max: 10` connection pool is sufficient.** Sustains 200 concurrent queries (1.9s wall, 0 errors) and 10 concurrent Inngest-shaped 5-step jobs (688ms wall, 0 errors). No `GBRAIN_POOL_SIZE` tuning required at v2.0 concurrency.
- **Every `engine.executeRaw` call MUST pass at least one $N parameter.** Parameterless calls hang indefinitely against Supavisor (statement_timeout doesn't fire). Add a sentinel `$1` if needed.

### v2.0 in-process gbrain (from spikes 006 + 007 + 009)

- **No CLI shell-out from production code.** App imports gbrain as a library via the `types/gbrain.ts` shim's `_load("subpath")` dynamic-import pattern.
- **`configureGateway({env: process.env})` MUST be called before `createEngine`.** AI gateway singleton; without it expansion + chat silently degrade.
- **Single shared engine in `lib/gbrain/engine.ts` serves every tenant.** Survives concurrent multi-tenant load (validated in spike 010). No per-tenant engine pools.
- **`importFromContent` requires the `sourceId` to ALREADY exist as a row in `sources`** (FK `pages_source_id_fkey`). Connect-time provisioning step: `INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING`.
- **Re-sync (wipe-and-reingest) is one SQL: `DELETE FROM sources WHERE id = $1`.** FK `ON DELETE CASCADE` sweeps pages + chunks + tags + links atomically (~120ms).
- **`types/gbrain.ts` shim must expose `importFromContent` for Phase 7** — same dynamic-import pattern as existing exports.
- **`next.config.ts` `serverExternalPackages: ['gbrain']` MUST stay** — keeps gbrain loaded as raw `.ts` under Bun. Without it cold-start blows up.
- **Bun runtime required** (`bun node_modules/.bin/next start`). Node refuses gbrain's raw `.ts`.
- **Chat UX expectation: ~1.2s warm / 1.7s cold mean.** Show typing indicator within 200ms via SSE while OpenAI is roundtripping.
- **Phase 4 ships without warm-pooling.** Cold tax is only ~310ms; OpenAI embedding dominates. Vercel Fluid Compute default behavior is sufficient.

### v2.0 multi-tenant isolation (from spike 010)

- **All tenant isolation lives in app-layer per-call `sourceId` scoping.** RLS does NOT protect us — gbrain auto-enables RLS on every public table BUT the pooler role we connect as has `BYPASSRLS`. RLS is defense-in-depth against the Supabase `anon` role only.
- **gbrain has NO fail-safe default for `sourceId`.** Bare `engine.getPage(slug)` / `deletePage` / `listPages` / `hybridSearch(engine, q)` without sourceId silently returns / mutates / federates across all sources. Silent leak class — no exception, no warning.
- **`lib/gbrain/tenant-scoped.ts` wrapper layer + ESLint rule banning bare `engine.*` outside `lib/gbrain/` is REQUIRED before Phase 7 lands.** Wrappers `tenantSafeGetPage(tenantId, slug)` / `tenantSafeHybridSearch(tenantId, q)` / `tenantSafeImportFromContent(tenantId, slug, content)` resolve tenantId → sourceId via `lib/auth/resolve-tenant.ts` AND require both args.
- **Tenant→sourceId resolution goes through `lib/auth/resolve-tenant.ts`.** Never trust `params.id` directly. Phase 6 chokepoint.
- **The single-shared-engine pattern is fully validated under concurrency** — 20 interleaved queries from 2 tenants, 0 leaks. Combined with spike 008's pool capacity findings, the cheap one-engine architecture is correct for v2.0.
- **The one-brain-many-sources pattern is a deliberate deviation from gbrain's documented preference.** gbrain's architecture doc (`brains-and-sources.md`) says different data owners = different brains. QuickBrain collapses tenants into sources inside one brain to keep Supabase cost flat. The wrapper layer + lint rule above is the engineered mitigation for the silent-leak class that deviation introduces — gbrain provides no native multi-tenant primitive (confirmed 2026-05-31). If isolation pressure ever forces a migration, the target is schema-per-tenant or brain-per-tenant; see reference for tradeoffs.
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Outbound communications | [references/outbound-communications.md](references/outbound-communications.md) | v1.2 leads with CPA-facing monthly close (recipient explicitly wants it; anomalies are the headline; print-CSS for PDF). Vendor-facing weekly is gated on a 3-tenant pilot. Audience-keyed template validator is the load-bearing safety check. |
| Accounting connector strategy | [references/accounting-connectors.md](references/accounting-connectors.md) | Keep QBO for v1.1, add Xero in v1.2, skip Wave + FreshBooks. Structure code as `lib/connectors/<source>/` from day one with shared `lib/connectors/types.ts`. |
| gbrain skill infrastructure | [references/gbrain-skill-infrastructure.md](references/gbrain-skill-infrastructure.md) | `gbrain jobs submit shell --follow` works on PGLite. Skill must always exit 0; seed.sh parses `Result:` JSON `exit_code`; `bun` must be in PATH. (v2.0 has since pivoted to Inngest; smb-audit still relies on these findings.) |
| **v2.0 Supabase foundation** | **[references/v20-supabase-foundation.md](references/v20-supabase-foundation.md)** | gbrain on Supabase free tier (Postgres 17 + pgvector) is production-viable. Default max:10 pool sustains N=200 / M=10 Inngest-shape with 0 errors. Parameterless executeRaw hangs against Supavisor. |
| **v2.0 in-process gbrain** | **[references/v20-in-process-gbrain.md](references/v20-in-process-gbrain.md)** | Read + write + cold-start patterns for the in-process architecture. importFromContent works in-process at 1.9s/page; idempotency via content_hash; Vercel cold tax is only ~310ms (OpenAI embedding dominates). |
| **v2.0 multi-tenant isolation** | **[references/v20-multi-tenant-isolation.md](references/v20-multi-tenant-isolation.md)** | RLS does NOT protect tenants (BYPASSRLS role). All isolation via app-layer per-call sourceId. Single shared engine survives 20 interleaved concurrent queries with 0 leaks. tenant-scoped.ts wrapper layer + ESLint rule required before Phase 7. One-brain-many-sources is a deliberate deviation from gbrain's documented data-owner=brain rule; gbrain has no native multi-tenant primitive. |

## Source Files

Original spike source files preserved in `sources/` for complete reference:

- `sources/001-vendor-report-emails/` — README + email-preview.html (vendor inbox + operator digest UI) + scheduler-comparison.html
- `sources/002a-xero/README.md` — Xero scoring (VALIDATED, add in v1.2)
- `sources/002b-wave/README.md` — Wave scoring (INVALIDATED, access deprecated 2024)
- `sources/002c-freshbooks/README.md` — FreshBooks scoring (PARTIAL, freelancer SKU only)
- `sources/comparison.html` — 4-way head-to-head matrix
- `sources/README.md` — accounting-comparison parent verdict
- `sources/003-minions-over-pglite/README.md` — empirical test output from gbrain 0.35.1 (Phase 4 hackathon-era unblock; v2.0 now uses Inngest)
- `sources/004-accountant-facing-reports/` — README + cpa-email-preview.html (with print CSS for PDF archival)
- `sources/005-gbrain-on-supabase/README.md` — one-time PGLite → Supabase migration (lossless, 45s, free-tier viable)
- `sources/006-gbrain-in-process/README.md` — in-process retrieval baseline (1.34s warm hybridSearch, no child_process)
- `sources/007-gbrain-import-from-content/` — README + spike.ts + result.html + spike-events.json (importFromContent write path; 1.9s/page; FK pre-registration gap finding)
- `sources/008-inngest-supabase-pool/` — README + spike.ts + result.html + spike-events.json (N=200 / M=10 Inngest shape; parameterless executeRaw hangs)
- `sources/009-vercel-fluid-coldstart/` — README + spike.ts + cold-probe.ts + result.html + spike-events.json (5 cold-process runs; 310ms infra tax; OpenAI dominates)
- `sources/010-per-tenant-engine-rls/` — README + spike.ts + result.html + spike-events.json (single-engine survives 20 interleaved concurrent queries; silent-leak finding when sourceId omitted)
</findings_index>

<metadata>
## Processed Spikes

Wave 1 (2026-05-18 / 2026-05-19 — v1.x feasibility):

- 001-vendor-report-emails (PARTIAL ⚠)
- 002-accounting-api-comparison (VALIDATED ✓, parent)
- 002a-xero (VALIDATED ✓)
- 002b-wave (INVALIDATED ✗)
- 002c-freshbooks (PARTIAL ⚠)
- 003-minions-over-pglite (VALIDATED ✓ — now obsoleted by Inngest pivot but smb-audit findings still apply)
- 004-accountant-facing-reports (VALIDATED ✓)

Wave 2 (2026-05-28 — v2.0 pre-execute integration + frontier):

- 005-gbrain-on-supabase (VALIDATED ✓)
- 006-gbrain-in-process (VALIDATED ✓)
- 007-gbrain-import-from-content (VALIDATED ✓)
- 008-inngest-supabase-pool (VALIDATED ✓)
- 009-vercel-fluid-coldstart (VALIDATED ✓)
- 010-per-tenant-engine-rls (PARTIAL ⚠ — silent-leak architectural finding, see reference)
</metadata>
