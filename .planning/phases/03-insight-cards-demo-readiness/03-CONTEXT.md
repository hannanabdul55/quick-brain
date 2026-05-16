# Phase 3: Insight Cards + Demo Readiness - Context

**Gathered:** 2026-05-16
**Status:** Ready for planning
**Mode:** Autonomous smart discuss (per user request — no per-area approval prompts)

<domain>
## Phase Boundary

The dashboard `/dash/[id]` mounts and within ~5s renders three insight cards (Top 5 vendors, Monthly P&L snapshot, Anomalies flagged), each with a visible gbrain-primitive label ("from graph" / "from timeline" / "from skill: recurring-charges"). Each card distinguishes loading / data / error states. The operator can press-and-hold the Reset button for 2s to wipe the tenant brain back to `brains/seed/` state in under 10s. `scripts/panic-reset.sh` resets the entire demo state in under 15s from the terminal. The full 3-minute demo (onboarding → dashboard → 1 chat question → reset → repeat) runs back-to-back 3 times with no errors. `docs/DEMO-SCRIPT.md` and a `git tag demo-final` complete the prize-narrative ceremony.

**In scope (12 reqs — INSI-01..06, DEMO-01..06):**
- 3 insight cards on `/dash/[id]` with loading/data/error states
- Card data sourcing: Top Vendors via `gbrain graph-query` for each anchor company; P&L via `originals/monthly-close-*.md` frontmatter aggregation; Anomalies via reading `concepts/march-anomaly-summary.md` directly
- In-process cache per tenant for the 3 insight queries (no recomputation on every render)
- Pre-warm hook at Next.js boot: run the 3 insight queries once against `brains/seed/` so first dashboard load is fast
- Press-and-hold Reset button (2s) — kills in-flight spawns, deletes brain dir, re-copies seed, clears caches, reloads page
- `scripts/panic-reset.sh` — wipes all `brains/<tenantId>/` dirs (except seed), kills any port-3000 process, no rebuild
- `docs/DEMO-SCRIPT.md` — 3-minute spoken script naming "graph", "timeline", "skill" ≥3 times each
- `git tag demo-final` with README panic-recovery pointer

**Out of scope:** v2 stretch items (INSI-07/08/09, CHAT-07/08/09, SKIL-01, DATA-12). Mobile responsive. Authentication. Real persistence beyond in-memory.

</domain>

<decisions>
## Implementation Decisions

### Insight Card Data Sourcing
- **"Top 5 vendors this quarter" (INSI-02, label: "from graph"):** Read invoice frontmatter from `data/maras-coffee/originals/invoice-*.md` filtered to Jan-Mar 2026, aggregate by vendor, take top 5 by total spend. NO live `gbrain graph-query` call per-render — the data is static (Jan-Mar 2026 is locked). Compute once at boot, cache. The "from graph" label refers to gbrain having ingested the invoices as graph nodes; the aggregation is in-app TS for speed. (Tradeoff: slightly less "live" but identical visible output; ~1s render vs ~10s).
- **"Monthly P&L snapshot" (INSI-03, label: "from timeline"):** Parse `data/maras-coffee/originals/monthly-close-2026-03.md` frontmatter for revenue/cogs/opex/net. Delta = current minus previous month. Same source-of-truth as the demo dataset — no LLM call. The "from timeline" label refers to gbrain's timeline system that ingested the monthly-close pages. ~50ms render.
- **"Anomalies flagged" (INSI-04, label: "from skill: recurring-charges"):** Parse `data/maras-coffee/concepts/march-anomaly-summary.md` body — extract the bulleted findings. Each bullet has a date + `[[vendor]]` link + description + $ figure (regex pattern: `^- \d{4}-\d{2}-\d{2}: ...`). Render the 3 anomalies with their dollar impact and a "View source →" link pointing to the originating `originals/*` page (parsed from the bullet's wikilinks).

### Insight Card Lifecycle (INSI-05, INSI-06)
- **Three states per card:** `loading` (shadcn Skeleton inside Card), `data` (populated rows), `error` (named error with Retry button). No silent empty states.
- **In-process cache per tenant:** `Map<tenantId, { topVendors, pnl, anomalies, computedAt }>` in a new `lib/insights/cache.ts`. Stale-after entry: 5 minutes (way beyond demo time). Reset invalidates this map for the affected tenant.
- **Pre-warm at boot (DEMO-03):** At Next.js dev/start boot, `lib/insights/cache.ts` runs the 3 insight computations against `brains/seed/` (SEED_TENANT_ID) once. First demo dashboard load reads from cache. The 3 P0 chat questions are NOT pre-warmed via `gbrain think` (would burn API tokens at boot every restart); they pre-warm at the SSE onboarding warm-up stage (Phase 2 already does this for retrieval).
- **Loading sequence:** dashboard page mounts → `useEffect` kicks off 3 parallel `fetch('/api/tenants/[id]/insights/<kind>')` calls → cards show skeleton until each `fetch` resolves. Cards render independently (no waterfall).

### Reset Flow (DEMO-01)
- **UI:** A "Reset" button in the dashboard top-right corner. Press-AND-hold for 2 seconds (Pointer events + 2s timer). Releasing early aborts. While holding, the button fills with progress visualization. After 2s, fires the reset.
- **Backend:** `POST /api/tenants/[id]/reset` — kills any in-flight gbrain spawn for this tenant (track active spawns in a `Map<tenantId, AbortController>`), `rm -rf brains/<tenantId>/`, `cp -r brains/seed/ brains/<tenantId>/`, clears `lib/insights/cache.ts` map entry for this tenantId, returns 200. Total budget: <10s, typically ~2s.
- **Client:** After 200, `router.refresh()` to reload the dashboard (chat history clears as part of state-machine reset).

### Panic-Reset Script (DEMO-02)
- `scripts/panic-reset.sh` — bash script. Steps: (a) `pkill -9 -f "next dev"` to kill the Next.js server; (b) `pkill -9 -f "bun.*gbrain"` to kill any orphaned gbrain spawns; (c) `find brains/ -maxdepth 1 -type d -not -name seed -not -name brains -exec rm -rf {} +` to wipe all tenants but preserve seed; (d) DOES NOT re-run `bun run seed` (seed should be pre-baked). Total budget: <15s, typically ~5s.

### Demo Script Doc (DEMO-05)
- `docs/DEMO-SCRIPT.md` — operator's 3-minute spoken script. 5 sections: opening (15s), onboarding theater (45s), dashboard insight cards (60s), chat moneyshot (45s), close (15s). Names "graph" / "timeline" / "skill" ≥3 times each (acceptance grep) — woven into the narration during the insight card walkthrough and chat answer reading.
- Inline operator notes: "if X breaks, do Y" — references to the panic-reset path.

### Git Tag + README (DEMO-06)
- Final commit: `chore: demo-final freeze` → `git tag -a demo-final -m "Demo recording cut"`. Manual tag (no auto-tag); orchestrator commits with the message but operator runs the actual `git tag` command before recording. Reasoning: tagging is an operator decision tied to "we are recording NOW".
- README gets a `## Panic recovery` section at the end pointing to `scripts/panic-reset.sh` and `git checkout demo-final` for restoring a known-good state.

### Performance Budgets (locked)
- Insight cards visible: ≤5s from dashboard mount (INSI-01 + DEMO-03 pre-warm).
- Reset complete: <10s (DEMO-01).
- Panic reset: <15s (DEMO-02).
- 3 back-to-back rehearsals: each ~3min, no inter-run state leakage (DEMO-04).

### Claude's Discretion
- Exact Tailwind/shadcn composition (Card layout, label badge style).
- Whether `gbrain graph-query` actually runs for the Top Vendors card vs the static frontmatter aggregation (both produce the same visible result; static is faster).
- The exact regex for parsing the anomaly summary bullets.
- The progress-fill animation style for the press-and-hold Reset button.
- Whether each insight is its own Route Handler (`/api/tenants/[id]/insights/top-vendors`, etc.) or a single batch endpoint (`/api/tenants/[id]/insights`). Both work; batch is simpler.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1 + Phase 2)
- `data/maras-coffee/originals/invoice-*.md` — 30 invoices, all with vendor + amount + date in frontmatter
- `data/maras-coffee/originals/monthly-close-2026-{01,02,03}.md` — has revenue/cogs/opex/net in body (formatted as `- 2026-XX-31: Revenue $X` etc.) OR frontmatter
- `data/maras-coffee/concepts/march-anomaly-summary.md` — bulleted findings, regex-parseable
- `data/maras-coffee/concepts/recurring-charges.md` — recurring-charge audit with ⚠ GHOST flags
- `lib/gbrain/{client,mutex,tenants}.ts` — spawn helper, mutex, registry. Reset endpoint reuses these.
- `lib/gbrain/onboard.ts` — orchestrator (not directly relevant)
- `lib/chat/*` — used by chat surface (Phase 2)
- `components/ui/*` — shadcn primitives (Card, Skeleton, Button, ScrollArea, Badge)
- `app/dash/[id]/page.tsx` — current dashboard (Phase 2 chat) — Phase 3 ADDS cards above the chat

### Established Patterns
- Route Handlers in `app/api/...`; domain logic in `lib/<feature>/`
- Per-tenant mutex via `withTenantLock` (don't bypass)
- Bun runtime; TypeScript strict + noUncheckedIndexedAccess
- shadcn primitives composed in `components/<feature>/*`

### Integration Points
- `app/dash/[id]/page.tsx` — Phase 3 wraps the existing chat surface with the 3 cards above
- `lib/insights/cache.ts` (new) — in-process insight cache + boot-time pre-warm
- `lib/insights/{top-vendors, pnl, anomalies}.ts` (new) — pure-TS computation modules
- `app/api/tenants/[id]/insights/route.ts` (new) — batch endpoint returning the 3 cards' data
- `app/api/tenants/[id]/reset/route.ts` (new) — POST handler for Reset button
- `scripts/panic-reset.sh` (new)
- `docs/DEMO-SCRIPT.md` (new)

</code_context>

<specifics>
## Specific Ideas

- **Anomaly extraction regex** for `concepts/march-anomaly-summary.md`: the body has bullets like `- 2026-03-01: [[companies/beanstalk-roasters]] invoices jumped from $1,500.00 in February 2026 to $1,830.00 in March 2026 — a +22.0% increase ($330.00 more this month)`. Regex: `^- (\d{4}-\d{2}-\d{2}):\s+\[\[([^\]]+)\]\]\s+(.+?)$` — captures date, target slug, description. Dollar impact extracted with a secondary regex from the description.
- **P&L parsing source:** `monthly-close-2026-03.md` body has lines like `- 2026-03-31: Revenue $27,480.00` (per the seed pipeline). Parse with `^- \d{4}-\d{2}-\d{2}:\s+(Revenue|COGS|Opex|Net)\s+\$([0-9,]+\.\d{2})`.
- **Vendor aggregation:** sum `inv.frontmatter.amount` across all invoices with `inv.frontmatter.date` in 2026-Q1 (Jan, Feb, Mar). Group by `inv.frontmatter.vendor`. Sort desc, take top 5.
- **Bun perf note:** these reads are all synchronous-style `Bun.file().text()` or `readFile`. Total <100ms for 46-page brain.
- **Demo script naming counts:** "graph" — used in Top Vendors card label + spoken intro + (potentially) the chat answer reading. "timeline" — used in P&L card label + spoken intro + (potentially) onboarding stage label. "skill" — used in Anomalies card label + spoken intro + (potentially) reference to the anomaly detector. Need 3 each → spread across 3 minutes.
- **State leakage check (DEMO-04):** After reset, the in-memory chat history should be empty (state machine reset). The insight cache for that tenant invalidates. Re-running the same chat question should return identical answer (modulo LLM nondeterminism — Haiku tends to be very stable on temp=0 calls though gbrain doesn't expose that param).
- **No real test framework** — DEMO-04 acceptance is "run 3 rehearsals, no errors". This is operator-driven; orchestrator just provides the infrastructure.

</specifics>

<deferred>
## Deferred Ideas

- INSI-07 (4th "Recurring subscriptions" card) — v2 stretch.
- INSI-08 (severity badges on anomalies) — v2 stretch.
- INSI-09 (click insight → prefill chat) — v2 stretch.
- Cypress / Playwright end-to-end suite — out of scope.
- Real database for tenant persistence — out of scope.
- Multi-laptop demo handoff — out of scope.

</deferred>
