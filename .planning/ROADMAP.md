# Roadmap: QuickBrain

## Overview

QuickBrain ships in three end-to-end demoable slices over a 7.5-hour hackathon budget. Phase 1 builds the brain spine — the `gbrain` CLI harness plus a fully-seeded synthetic Mara's Coffee brain — and is demoable as a terminal smoke test. Phase 2 puts the web onboarding theater and chat surface on top of that spine, demoable as a full browser flow ending in a working question. Phase 3 adds the dashboard insight cards, the reset path, and the rehearsed 3-minute demo narrative that makes the build land for YC judges. Each phase is a runnable slice in isolation: if Phase 2 collapses, Phase 1 still demos via CLI; if Phase 3 collapses, Phase 2 still demos via web. Granularity is coarse per `config.json` — 3 phases, no finer.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Brain Spine + Synthetic Seed** - End-to-end CLI slice — seeded gbrain answers "what was weird about last month?" naming all 3 planted anomalies
- [ ] **Phase 2: Onboarding Theater + Chat** - End-to-end web slice — operator completes 60-second onboarding and asks a P0 question through the browser
- [ ] **Phase 3: Insight Cards + Demo Readiness** - End-to-end demo slice — dashboard cards load with primitive labels, reset works, 3 back-to-back rehearsals pass

## Phase Details

### Phase 1: Brain Spine + Synthetic Seed
**Goal:** A seeded gbrain instance running locally answers the three P0 demo questions correctly from the terminal, validating the entire data path before any UI exists.
**Mode:** mvp
**Depends on:** Nothing (first phase)
**Requirements:** HARN-01, HARN-02, HARN-03, HARN-04, HARN-05, HARN-06, DATA-01, DATA-02, DATA-03, DATA-04, DATA-05, DATA-06, DATA-07, DATA-08, DATA-09, DATA-10, DATA-11
**Success Criteria** (what must be TRUE):
  1. Operator runs `scripts/demo-check.sh` and it exits 0 — `gbrain --version`, `gbrain doctor --fast`, both API keys, and write-access to `./brains/` are all confirmed.
  2. Operator runs `bun run seed` (or `scripts/seed.sh`) and a working `brains/seed/` directory is produced end-to-end (init → config → import → embed → anomaly detection) with three detectable planted anomalies (Beanstalk price hike, Square duplicate charge, ghost 7shifts SaaS).
  3. Operator runs `GBRAIN_HOME=brains/seed gbrain graph-query beanstalk-roasters --depth 2` from the terminal and sees ≥3 neighbors (invoices, the price-hike email, the anomaly concept page).
  4. Operator runs `GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"` from the terminal and gets a coherent answer naming all 3 planted anomalies in a single response.
  5. Operator runs the same `gbrain query` concurrently against the same brain through `lib/gbrain/client.ts` and the calls serialize via the in-process mutex queue with no PGLite lock errors.
**Plans:** 6 plans across 5 waves
- [ ] 01-01-PLAN.md — Bootstrap Next.js + Bun scaffolding, pre-declare all Phase 1 scripts, write scripts/demo-check.sh + README (HARN-01, HARN-02)
- [ ] 01-02-PLAN.md — lib/gbrain/ harness: spawnGBrain + mutex + slug + tenants + typed errors (HARN-03..06)
- [ ] 01-03-PLAN.md — Synthetic Mara's Coffee dataset + validate-dataset.ts (DATA-01..07)
- [ ] 01-04-PLAN.md — Hand-rolled anomaly detector (3 rules + CLI writing concept pages) (DATA-08)
- [ ] 01-05-PLAN.md — End-to-end scripts/seed.sh pipeline producing brains/seed/ (DATA-09, DATA-11)
- [ ] 01-06-PLAN.md — Smoke gate orchestrator + concurrent-smoke + anomaly assertion (DATA-10)

### Phase 2: Onboarding Theater + Chat
**Goal:** A non-technical operator can land on `/`, complete the onboarding flow, arrive on their dashboard within 60 seconds, and ask one of the three P0 questions — getting a real gbrain-backed answer with citations rendered as markdown.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** ONBD-01, ONBD-02, ONBD-03, ONBD-04, ONBD-05, ONBD-06, ONBD-07, ONBD-08, CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06
**Success Criteria** (what must be TRUE):
  1. Operator visits `/`, clicks the "Start your business brain" CTA, fills the 3-field form (business name, business type, owner name), and submits — no login, no API-key field, no payment screen appears anywhere in the flow.
  2. After submit, the browser plays a 30–45 second narrated SSE onboarding sequence with 5 honest stage labels ("Creating your brain → Reading your invoices and emails → Building the knowledge graph → Indexing for search → Ready"), with at least one real `gbrain query` warm-up call interleaved before the stream closes.
  3. Total wall-clock from form submit to interactive dashboard at `/dash/<tenantId>` is consistently between 30 and 60 seconds across 3 consecutive measurements on the demo laptop.
  4. Operator on the dashboard sees three hardcoded suggested-question chips, clicks "What was weird about last month?", and within ~30 seconds receives a markdown response with visible `[Source: ...]` citations naming all three planted anomalies.
  5. A query exceeding 30 seconds aborts cleanly and shows a graceful error message in the chat instead of hanging; the brain says "I don't have data on that" rather than guessing when asked about topics outside the synthetic dataset.
**Plans:** 6 plans across 4 waves
- [ ] 02-01-PLAN.md — Scaffold Next.js 15 + shadcn primitives + landing CTA + onboarding form skeleton (ONBD-01, ONBD-02, ONBD-08)
- [ ] 02-02-PLAN.md — POST /api/tenants Route Handler + createTenant domain (zod, cp -r seed, register, <2s) (ONBD-03)
- [ ] 02-03-PLAN.md — GET /api/tenants/[id]/onboard SSE + 5-stage orchestrator + gbrain --no-expand warm-up (ONBD-04, ONBD-05, ONBD-07)
- [ ] 02-04-PLAN.md — /onboard page full client flow: form → POST → EventSource → progress → redirect → error retry (ONBD-02, ONBD-04, ONBD-06, ONBD-07, ONBD-08)
- [ ] 02-05-PLAN.md — /dash/[id] dashboard + chat surface UI (3 hardcoded chips, message list, scroll area, input) (CHAT-01, CHAT-04)
- [ ] 02-06-PLAN.md — POST /api/tenants/[id]/chat SSE + react-markdown renderer + query() helper patched to --no-expand default (CHAT-02, CHAT-03, CHAT-05, CHAT-06)
**UI hint:** yes

### Phase 3: Insight Cards + Demo Readiness
**Goal:** The dashboard loads with three insight cards (top vendors, P&L snapshot, anomalies) each tagged with a visible gbrain-primitive label, the operator can reset state in under 10 seconds, and the full 3-minute demo runs back-to-back three times without errors or state leakage — `git tag demo-final` is committed.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** INSI-01, INSI-02, INSI-03, INSI-04, INSI-05, INSI-06, DEMO-01, DEMO-02, DEMO-03, DEMO-04, DEMO-05, DEMO-06
**Success Criteria** (what must be TRUE):
  1. Operator opens `/dash/<tenantId>` and within ~5 seconds sees three insight cards populated with real gbrain-backed data: "Top 5 vendors this quarter" (label: "from graph"), "Monthly P&L snapshot" with month-over-month delta (label: "from timeline"), and "Anomalies flagged" listing all 3 planted anomalies with dollar impacts and source links (label: "from skill: recurring-charges"). Each card visibly distinguishes loading, data, and error states.
  2. Operator presses-and-holds the dashboard Reset button for 2 seconds; in under 10 seconds the tenant brain is rebuilt from `brains/seed/`, in-flight spawns are killed, caches are cleared, and the dashboard reloads to a clean state.
  3. Operator runs `scripts/panic-reset.sh` from the terminal and the entire demo state (all tenants, caches, ports) resets in under 15 seconds without rebuilding the seed.
  4. Operator runs 3 consecutive end-to-end demos (onboarding → dashboard → 1 chat question → reset → repeat) back-to-back on the demo laptop with no errors, no state leakage between runs, and identical anomaly findings each time.
  5. `docs/DEMO-SCRIPT.md` exists with the 3-minute spoken script and names "graph", "timeline", and "skill" out loud at least 3 times each; a `git tag demo-final` is created with a panic-recovery pointer in the README.
**Plans:** TBD
**UI hint:** yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Brain Spine + Synthetic Seed | 0/6 | Not started | - |
| 2. Onboarding Theater + Chat | 0/6 | Not started | - |
| 3. Insight Cards + Demo Readiness | 0/TBD | Not started | - |

---

## MVP-Slice Discipline (Per Phase)

Every phase must deliver an end-to-end runnable slice. If a later phase fails or is abandoned, the prior phase must remain demoable on its own:

- **Phase 1 demoable surface:** Terminal. `bun run seed` produces the seed brain; `gbrain query` against it answers correctly. No UI required.
- **Phase 2 demoable surface:** Browser. Full onboarding → chat flow. The Phase 1 CLI demo continues to work in parallel.
- **Phase 3 demoable surface:** Full 3-minute demo. The Phase 2 web flow continues to work without the insight cards if Phase 3 is incomplete.

Stretch items (`SKIL-01`, `DATA-12`, `CHAT-07`/`-08`/`-09`, `INSI-07`/`-08`/`-09`) are explicitly NOT in this roadmap. They live in v2 per `REQUIREMENTS.md` and are only candidates for Phase 3 carryover if ≥2h remain after all rehearsals pass green.

---

*Roadmap created: 2026-05-16*
