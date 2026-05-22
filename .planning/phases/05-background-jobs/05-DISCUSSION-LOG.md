# Phase 5: Background Jobs - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-21
**Phase:** 5-Background Jobs
**Areas discussed:** Job runner, Progress delivery, Latency measurement, Job-path scope
**Mode:** `--auto` — all gray areas auto-selected; each question auto-answered with the recommended option.

---

## Job Runner

| Option | Description | Selected |
|--------|-------------|----------|
| Inngest | ROADMAP names it explicitly; mature free tier, first-class Next.js/Vercel integration, built-in step functions + retries + dev dashboard | ✓ |
| Vercel Queues | Platform-native, built on Fluid Compute — but still public beta | |
| gbrain Minions | gbrain's own durable job queue — but engine-coupled, designed for gbrain-internal skill jobs, only spike-validated on PGLite | |

**User's choice:** Inngest (auto-selected, recommended).
**Notes:** Inngest is a second vendor, but the ROADMAP already names it and it ships a Vercel Marketplace integration, so it is platform-aligned. Vercel Queues was rejected for beta risk in a foundation phase; gbrain Minions was rejected because it is not an app-orchestration tool and was never validated on Postgres.

---

## Progress Delivery

| Option | Description | Selected |
|--------|-------------|----------|
| Poll a status endpoint | Job writes progress to a durable store; browser polls `GET .../jobs/<id>` | ✓ |
| Long-lived SSE bridge | An SSE endpoint tails the job's progress store and streams to the browser | |

**User's choice:** Poll a status endpoint (auto-selected, recommended).
**Notes:** A background job runs in a separate invocation from the request that started it, so it cannot hold the browser's SSE connection. Polling avoids keeping a function alive across the timeout. Job state persists in a Supabase Postgres table (existing datastore — no new vendor). Existing `lib/onboarding/sse.ts` helpers remain valid for inline operations.

---

## Latency Measurement

| Option | Description | Selected |
|--------|-------------|----------|
| Repeatable benchmark script | A committed `scripts/` script runs query/think/import N times against the seed brain, reports p50/p95 | ✓ |
| Production instrumentation | Instrument live routes and collect p95 from real traffic | |

**User's choice:** Repeatable benchmark script (auto-selected, recommended).
**Notes:** There is no real traffic yet (pre-auth, pre-QBO), so production instrumentation is premature. The script plus a documented threshold satisfies success criterion 1.

---

## Job-Path Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Generic path, route import now | Build one generic job path; route onboarding/import through it; keep query + think inline pending measurement | ✓ |
| Move all gbrain ops to jobs | Route query, think, and import all behind the job path | |

**User's choice:** Generic path, route import now (auto-selected, recommended).
**Notes:** Query retrieval is ~1.3s (spike 006) and chat think is likely under the timeout — both stay inline pending the D-04 measurement. The generic job path is built so Phase 7's QBO ingest plugs in without rework. Resolves the existing "Phase 5 will add" marker comment in the chat route.

## Claude's Discretion

- Exact Inngest function/step decomposition.
- Job-table column names and schema.
- Polling interval for the status endpoint.

## Deferred Ideas

- `tenant-registry-deploy-persistent.md` todo — tenant registry is filesystem-based and breaks on serverless. Matched Phase 5 weakly (0.4) but is explicitly tagged `resolves_phase: 6`. Reviewed, not folded — belongs to Phase 6.
- Postgres per-tenant provisioning flow (`onboard()` rewrite) from `docs/phase-5-onboarding-handoff.md` — Phase 6 territory under the renumbered roadmap.

## Process Note

The repo's LSP-first Read hook expects the `cclsp` MCP server (`mcp__cclsp__get_diagnostics`), which was not connected this session — code-file Reads and symbol greps were blocked. Codebase scout fell back to plain-text grep + line-count inspection, which was sufficient for context capture. Flag for the operator: connect cclsp or relax the hook.
