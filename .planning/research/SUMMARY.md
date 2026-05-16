# Project Research Summary — QuickBrain

**Project:** QuickBrain
**Domain:** YC-hackathon demo: 60-second SMB-onboarding shell wrapping the real gbrain CLI in a Next.js web app, with synthetic coffee-shop data, chat, and insight cards.
**Researched:** 2026-05-16
**Confidence:** HIGH on gbrain mechanics, stack, and pitfalls (sources verified against the actual gbrain repo + DEPLOY.md). MEDIUM on exact wall-clock estimates and which "wow" questions land hardest with judges.

---

## 1. TL;DR

QuickBrain is a one-laptop, one-operator, single-tenant demo. Next.js 15 (App Router, Bun) is the web shell. The "brain" layer is the **real** `gbrain` CLI shelled out via `child_process.spawn` with `GBRAIN_HOME=./brains/maras-coffee/` per invocation — **not** `gbrain serve --http` (which requires an OAuth 2.1 bootstrap + admin-dashboard client registration that is unaffordable at 7.5h, and is Postgres-only for the legacy-bearer escape hatch — we run PGLite). Synthetic data lives under gbrain's whitelisted directory names (`companies/`, `originals/`, `media/`, `concepts/`, `people/`) — using semantic names like `invoices/` silently kills ~70% of knowledge-graph cross-refs (the single biggest finding of the research round). Onboarding is theatrical: a pre-baked seed brain is `cp -r`'d into place under a 30–45s narrated progress UI, so the "60 seconds" promise is *deterministic* rather than network-dependent. Three insight cards (top vendors, P&L snapshot, anomalies) and three planted anomalies (Beanstalk price hike, duplicate Square charge, ghost 7shifts SaaS) carry the demo narrative. Hand-rolled rule detection writes anomaly findings into the brain as markdown pages — a custom `smb-audit` skill stays as a stretch goal only.

**Five load-bearing decisions:**

1. **Brain integration = `child_process.spawn` per request + an in-process Promise queue** (single-flight mutex per tenant) to serialize PGLite-locked operations. No `gbrain serve --http`, no MCP client, no OAuth dance.
2. **Synthetic data layout MUST sit under gbrain's whitelisted dirs** — `companies/`, `originals/`, `media/`, `concepts/`, `people/`. Invent any other directory name and the graph extractor silently skips wikilinks.
3. **Pre-bake the seed brain** at repo bootstrap time. Onboarding is `cp -r brains/seed/ brains/maras-coffee/` (sub-second), with a scripted 30–45s narrated SSE progress UI showing the real gbrain pipeline stages. Honest *and* deterministic.
4. **Streaming = hand-rolled SSE via `ReadableStream`. No Vercel AI SDK.** `gbrain query` returns a single response block, not a token stream — the SDK is the wrong shape and costs more than it saves.
5. **3 phases (coarse granularity), with a Phase-1 critical-path spike as gate zero.** Phase 1 must prove `gbrain init/import/query` shells out cleanly and the graph populates against canonical dir names *before* any UI is written.

---

## 2. Stack — Locked Picks

| Layer | Pick | Rationale (1 line) |
|---|---|---|
| Runtime | **Bun 1.2+** | gbrain is bun-native; avoids node↔bun ABI surprises in child spawns |
| Web framework | **Next.js 15 App Router** | Operator knows it; Route Handlers stream SSE natively; single `bun dev` |
| React | **19.x** | Comes with Next 15. No decision. |
| TypeScript | **5.5+** | Matches gbrain ecosystem |
| Styling | **Tailwind v4** via shadcn CLI | One-command init, zero design budget |
| UI primitives | **shadcn/ui** (button, card, input, textarea, scroll-area, badge, separator) | Copy-into-repo; pre-styled, accessible |
| gbrain integration | **`child_process.spawn` (or `Bun.spawn`) per request**, `GBRAIN_HOME=./brains/maras-coffee/` | OAuth 2.1 disqualifies `serve --http` at 7.5h |
| Streaming | **Hand-rolled SSE via `ReadableStream` in Route Handlers** | gbrain returns single response, not tokens — AI SDK is wrong shape |
| Validation | **zod** | One schema prevents `GBRAIN_HOME` injection from form input |
| Markdown render | **react-markdown + remark-gfm** | gbrain returns markdown with `[Source: …]` citations |
| Icons | **lucide-react** | Free with shadcn |
| gbrain install | **`git clone + bun install && bun link`** from pinned SHA | `bun install -g` blocks postinstall (PGLite migration fails); npm has a squatter |
| LLM keys | **`OPENAI_API_KEY` + `ANTHROPIC_API_KEY`** in shell env | See section 4 |
| Brain engine model | **Sonnet** (`gbrain config set models.default sonnet` post-init) | Opus is 3–5× cost for marginal demo-quality gain |
| Persistence | **PGLite, owned by gbrain** under `./brains/maras-coffee/` | We run no DB; the brain dir IS the state |
| Tenant registry | **In-memory `Map`** rebuilt by scanning `./brains/*` on boot | Single demo, no durability needed |
| Reset | **`rm -rf brains/maras-coffee && cp -r brains/seed brains/maras-coffee`** (<10s) | Pre-baked seed eliminates re-init/re-import/re-embed latency |
| Synthetic data | **Markdown + YAML frontmatter** under whitelisted dirs (see §5) | gbrain's native ingest format |

**Banned (do not install):** Vercel AI SDK (`ai`, `useChat`), NextAuth/Clerk, Prisma/Drizzle, custom MCP client, BullMQ/Inngest, Mantine/Chakra/MUI, Docker, Sentry, charts library, Tailwind v3.

---

## 3. Architecture — Load-Bearing Decisions (Conflict Resolutions)

### Decision A — Brain process model: `spawn` per request + in-process mutex queue
*Resolves conflict #1 (Stack/Architecture say `spawn`; Pitfalls says `serve --http`).*

**Position:** Stack + Architecture win. Use `child_process.spawn` per request. Add a single-flight mutex queue in `lib/gbrain/client.ts` so concurrent requests serialize at the application layer.

**Reasoning:**
- `gbrain serve --http` is confirmed (DEPLOY.md, gbrain v0.26+) to require an OAuth 2.1 bootstrap-token flow: start server → token printed to stderr → log into `/admin` dashboard → register an OAuth client (`client_credentials` or `authorization_code` + PKCE) → copy credentials → wire client credentials into Next.js. The legacy bearer-token fallback is **Postgres-only** (the `access_tokens` table doesn't exist on PGLite; the server fails fast on PGLite + HTTP). We are running PGLite. There is no localhost-bypass path.
- Pitfalls is correct that PGLite holds an exclusive file lock and concurrent CLI invocations serialize at the OS level. The right response is *not* to spin up an OAuth-gated HTTP daemon — it's to serialize at the **Next.js** layer with an in-process `Promise` queue. For a single-operator demo with one tenant, there is essentially never more than one in-flight gbrain operation anyway (onboarding blocks chat; the parallel insight queries at dashboard mount go through the same queue).
- Spawn latency per query (~hundreds of ms cold, faster warm) is acceptable for a demo. Pre-warm the brain in Phase 3 by running each scripted demo question once before judges arrive — that primes the OS page cache and PGLite buffer pool.
- The Pitfalls "credibility" argument for HTTP ("MCP-over-HTTP for prize narrative") is overruled by the time math — the prize narrative is carried by the data and the onboarding flow, not by an MCP transport choice. If a judge asks about MCP, the verbal answer is "the same gbrain binary speaks MCP — here's `gbrain serve` running it, and here's why our demo doesn't need it."

**Implementation note for the roadmapper:** Phase 1's harness must include the mutex queue, not just the spawn helper. Wrap every `spawnGBrain(...)` call in `enqueue(tenantId, () => spawnGBrain(...))`. ~15 lines of code; saves a class of intermittent demo flakes.

### Decision B — `gbrain init` behavior: skip the question entirely with a pre-baked seed
*Resolves conflict #2 (Architecture says non-TTY-safe; Pitfalls says hangs interactively).*

**Position:** Both are partially right, and the operator's recipe makes it moot: **don't run `gbrain init` during onboarding at all in v1.** Pre-bake the seed brain once at repo bootstrap time and `cp -r` it on demand.

**Reasoning:**
- gbrain's TODOS.md confirms non-TTY mode falls through to defaults (Architecture is right). But Pitfalls is right that this varies by version, by stdio config, and by whether any prompt was added to `init` since the last release. **It's a brittle thing to depend on at hour 0 of demo prep.**
- The pre-bake approach eliminates the entire risk surface:
  1. `scripts/seed.sh` runs once during repo bootstrap (or by the operator the night before): `GBRAIN_HOME=brains/seed gbrain init && gbrain config set models.default sonnet && gbrain import data/maras-coffee/ && gbrain embed --stale`.
  2. Commit (or tar) `brains/seed/` to the repo. It's the canonical onboarding artifact.
  3. The "onboarding" Route Handler does: `cp -r brains/seed/ brains/maras-coffee/` (sub-second), then plays a 30–45s narrated SSE progress sequence ("Creating your brain… Reading invoices and emails… Building the knowledge graph… Indexing for search… Ready"). The progress steps are honest descriptions of what *was* done in the seed; the engine and data are real; only the timing is choreographed.
- This also nails the 60-second promise deterministically (Pitfall #9). No OpenAI embedding round-trips during the demo flow.
- During Phase 1's integration spike, the operator *does* run real `gbrain init` (once, to verify it works and to build the seed). After Phase 1 ships the synthetic data, the seed is rebuilt and frozen.

**For roadmapper:** the seed-rebuild script is a Phase 1 deliverable (after synthetic data lands). The "onboarding flow" Route Handler in Phase 2 reads from the seed; it never re-inits.

### Decision C — Chat streaming: hand-rolled SSE via `ReadableStream`. No Vercel AI SDK.
*Resolves conflict #3 (Stack/Architecture say skip AI SDK; Pitfalls recommends it with a 45-min time-box).*

**Position:** Stack + Architecture win decisively.

**Reasoning:**
- `gbrain query` writes a single complete response block to stdout (markdown + `[Source: …]` citations). It is not a token stream. Vercel AI SDK's `useChat`/`streamText` assume LLM-shaped streams (incremental tokens, tool calls, finish reasons, data-stream protocol headers). Forcing a single-block response through that protocol requires writing an adapter — net negative time.
- Hand-rolled SSE = ~30 lines of `ReadableStream` + native `EventSource` on the client + 0 deps. The same Route Handler pattern is used for **both** the onboarding-progress stream (multi-event) and the chat stream (one event + close). One mental model, two consumers.
- If we want a typewriter visual for chat polish, it's pure client-side: receive the full response, splice it into UI state at 20-char intervals. Zero backend change.
- The Pitfalls "45-min time-box" framing is sound risk management for chat-from-scratch — but the actual chat-from-scratch surface in this design is the message list, send button, and SSE subscription. shadcn's `card`/`scroll-area`/`textarea` cover the visual. The hand-rolled bit is ~80 lines total, well under 45 min.

**For roadmapper:** keep the 45-min hard cap on chat-UI implementation. If you blow through it, fall back to non-streaming `fetch` and accept worse UX — never reach for the AI SDK as the rescue.

---

## 4. Required Environment

### Install (exact commands, in order)

```bash
# 1. Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 2. gbrain — clone + link, NEVER global install
git clone https://github.com/garrytan/gbrain.git ~/gbrain
cd ~/gbrain && git checkout <PIN_A_KNOWN_GOOD_SHA> && bun install && bun link

# 3. Verify
gbrain --version
gbrain doctor --fast   # must pass before any other work
```

### Environment variables (server-side, never in UI)

```bash
# .env.local (loaded into the bun dev shell BEFORE Next.js boots,
# so spawned children inherit them via the spawn env option)
OPENAI_API_KEY=sk-...        # REQUIRED — embeddings; without it, hybrid search collapses to keyword-only and demo answers degrade noticeably
ANTHROPIC_API_KEY=sk-ant-... # REQUIRED for best demo quality — gbrain skips query expansion without it (answers feel shallow).
                             # Technically optional (gbrain runs without it), so the clean call is:
                             # REQUIRED for demo, OPTIONAL only for someone running QuickBrain outside the demo.
```

**Resolves conflict #4 (Stack says non-negotiable; Architecture says optional):** The clean call is **"required for demo, technically optional."** Both keys go in `.env.local`. Boot-time health check (`gbrain doctor --fast --json` invoked once at Next.js startup) must pass before serving any traffic. **There is no API-key field in the user-facing UI** — the operator's keys live server-side. Resolves Pitfall #12 by construction.

### Dev start

```bash
# scripts/dev.sh
set -a; source .env.local; set +a
bun dev
```

This ensures `process.env.OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are present in the parent process that calls `spawn(...)`, so children inherit them.

### Demo-day pre-flight (Phase 3 deliverable)

- `gbrain doctor --fast` passes on the demo laptop.
- `gbrain --version` reports the pinned SHA.
- Phone hotspot ready as primary network.
- Seed brain rebuilt and committed within last 24h.
- Reset cycle exercised 5× back-to-back; each <10s.

---

## 5. Synthetic Data — Prescribed Layout

**Resolves conflict #6 — the single biggest finding of this research round.** gbrain's link extractor uses a hardcoded `DIR_PATTERN` whitelist: wikilinks pointing into non-whitelisted directories are silently dropped (~70% loss of cross-references, per gbrain issue #424). Naming a directory `invoices/` or `vendors/` will pass `gbrain import` cleanly while breaking the entire knowledge-graph layer of the demo. The Features research did not address this; the Pitfalls research did. **The Pitfalls finding is binding.**

### Canonical layout (use these directory names exactly)

```
data/maras-coffee/
├── companies/
│   ├── beanstalk-roasters.md           # coffee roaster — anchors price-hike anomaly
│   ├── strauss-dairy.md                # dairy supplier
│   ├── sysco-foodservice.md            # foodservice distributor
│   ├── square-pos.md                   # POS / payment processor — anchors duplicate-charge anomaly
│   ├── landlord-llc.md                 # rent payee
│   ├── gusto-payroll.md
│   ├── pg-and-e.md                     # utility
│   ├── comcast-business.md             # internet
│   ├── quickbooks-online.md            # accounting SaaS
│   ├── seven-shifts.md                 # scheduling SaaS — anchors ghost-SaaS anomaly
│   ├── soundtrack-your-brand.md        # music licensing
│   ├── cintas-uniform.md               # linen/uniform service
│   ├── meta-ads.md                     # marketing
│   └── workers-comp-insurance.md
├── people/
│   └── mara-owner.md                   # the persona herself; minimal — used for "my" pronoun resolution
├── originals/                          # monthly close snapshots, bank statements, invoices, vendor emails
│   ├── 2026-01-close.md                # January monthly close: revenue, COGS, opex, net
│   ├── 2026-02-close.md
│   ├── 2026-03-close.md                # contains the planted-anomaly NARRATIVE page
│   ├── bank-statement-2026-01.md
│   ├── bank-statement-2026-02.md
│   ├── bank-statement-2026-03.md       # contains duplicate Square charge ($79 Mar 4, $79 Mar 11)
│   ├── invoice-beanstalk-2026-01-15.md # $520
│   ├── invoice-beanstalk-2026-02-12.md # $520
│   ├── invoice-beanstalk-2026-03-04.md # $620 — the price hike (+22% triggers anomaly rule)
│   ├── invoice-strauss-2026-{01,02,03}.md
│   ├── invoice-sysco-2026-{01,02,03}.md
│   ├── email-beanstalk-price-hike-2026-02-28.md  # the narrative email announcing the price increase
│   ├── email-strauss-late-delivery.md
│   └── email-square-receipt-2026-03-11.md        # the duplicate-charge receipt
├── media/                              # POS daily summaries (high-volume, low-narrative)
│   ├── pos-daily-2026-01.md            # 30 daily totals
│   ├── pos-daily-2026-02.md
│   └── pos-daily-2026-03.md
└── concepts/
    ├── march-anomaly-summary.md        # written by the anomaly-detection step at end of import; ties price-hike + duplicate + ghost-SaaS into one queryable page
    └── recurring-charges.md            # written by anomaly-detection; lists subscriptions detected as monthly recurrence
```

**Where each "missing" SMB doc type goes:**
- **Invoices** → `originals/` (with `type: invoice` frontmatter and a wikilink to the vendor's `companies/` page).
- **Vendor emails** → `originals/` (with `type: vendor-email` frontmatter and a wikilink to the vendor + a wikilink to any referenced invoice).
- **Bank statements** → `originals/` (with `type: bank-statement`; line items reference vendors as wikilinks).
- **POS daily summaries** → `media/` (low-narrative, high-volume).
- **Vendors** → `companies/` (always; the canonical entity directory).
- **Monthly close snapshots / P&L** → `originals/` as a "compiled truth" page with wikilinks to every vendor that month.
- **Anomaly-detection outputs** → `concepts/` (written by our detection step, queryable by the chat surface).

### Page format (every file follows this shape)

````markdown
---
type: invoice           # or: vendor-email | bank-statement | company | concept
title: Invoice 2026-03-04 — Beanstalk Roasters
tags: [vendor:beanstalk, month:2026-03, category:cogs]
source: synthetic
---

Compiled truth: Beanstalk Roasters invoice for 50 lb of espresso blend, dated 2026-03-04, total $620. This is the first delivery after Beanstalk's announced 12% price increase (see [[email-beanstalk-price-hike-2026-02-28]]). Vendor: [[beanstalk-roasters]].

---

- 2026-03-04: Invoice #4521 received from [[beanstalk-roasters]] for $620 (+22% vs Feb invoice #4498 at $520)
- 2026-03-04: Auto-imported by QuickBrain
````

**Three non-negotiable elements per page:**
1. **Frontmatter `type:`** — gbrain routes ingest based on this.
2. **A "Compiled truth:" paragraph above the `---`** — gbrain's compiled-truth/append-only-timeline divider. Honor it on every page.
3. **Wikilinks to canonical slugs** (`[[beanstalk-roasters]]`, `[[email-beanstalk-price-hike-2026-02-28]]`) — these are what trigger graph extraction. A page can only be linked-to if it exists at the canonical slug under a whitelisted dir.

### Planted anomalies (3 P0 — must be in the seed; must surface in the anomaly card)

| Anomaly | Where it lives | Detection rule | Demo narration |
|---|---|---|---|
| **Beanstalk price hike (+22%, March)** | 3 invoice pages + 1 vendor-email page; cross-linked via wikilinks | Same vendor, line-item or invoice-total MoM delta >10% | "Notice we never told it Beanstalk raised prices — it spotted the jump and the email announcing it on its own." |
| **Square duplicate charge ($79 on Mar 4 *and* Mar 11)** | 2 bank-statement lines + 1 receipt-email page | Same vendor, same amount, within 7 days | "Square double-billed the monthly POS subscription. That's $79 the owner would have missed." |
| **Ghost 7shifts SaaS ($29/mo, no usage)** | 6+ months of bank statements with $29 to `seven-shifts.md`; no recent event in the company page | Recurring monthly amount AND vendor company page has no event in last 90 days | "She's been paying $29 a month for a scheduling tool she stopped using last summer — $174 over six months." |

P1 stretch: missing-invoice anomaly ($340 to "ABCD Plumbing" with no invoice page). Plant only if Phase 1 has time.

### Smoke-test gate (must pass before declaring Phase 1 done)

```bash
GBRAIN_HOME=brains/seed gbrain graph-query beanstalk-roasters --depth 2
# expect ≥3 neighbors (invoices, the price-hike email, the march-anomaly-summary concept)

GBRAIN_HOME=brains/seed gbrain orphans
# expect a short list — most pages should NOT be orphaned

GBRAIN_HOME=brains/seed gbrain query "what was weird about last month?"
# expect a coherent answer naming Beanstalk price hike + Square duplicate + 7shifts SaaS
```

If any of these fail, the dataset layout is wrong and no UI work proceeds.

---

## 6. Demo Questions to Nail

### P0 — Three questions the demo must answer flawlessly

1. **"What was weird about last month?"** — surfaces all three planted anomalies in one synthesis. *Narration: "Notice we never told it Beanstalk is a vendor or that $79 twice is a duplicate — it figured all of that out from the graph and the timeline."*
2. **"Who are my top 5 vendors and how much did I pay each?"** — uses `enrich`-built vendor aggregation. *Narration: "Each of these is a real entity in the graph. We didn't define a vendor schema — gbrain extracted them from the invoices and bank statements."*
3. **"What am I paying for every month that I shouldn't be?"** — surfaces 7shifts ghost SaaS + flags QuickBooks/Soundtrack as legitimate-but-review-worthy. *Narration: "Subscription audit in 3 seconds. Industry data says SMBs cut 20–30% of SaaS spend in a one-time audit — most of them never get around to it."*

### P0 — Three planted anomalies the cards must show on load

See section 5 for placement. Each anomaly card must:
- Render plain English ("Your roaster's prices increased 22% in March")
- Link to its source pages (invoice + email)
- Carry a tiny visible label tying it to a gbrain primitive ("timeline + graph" / "recurring-charge detector" / etc.) — see Pitfall #7 resolution

### P1 — Backup questions if P0 lands fast

4. **"How much did I spend on coffee beans in March vs February?"** — arithmetic-over-filtered-events stress test.
5. **"Show me all my invoices from Beanstalk Roasters"** — citation/retrieval showcase.

---

## 7. Phase Structure Recommendation

**Resolves conflict #7.** Granularity = coarse per PROJECT.md. **3 phases**, with Phase 1 acting as both bootstrap *and* critical-path spike.

### Phase 1 — Spine + Seed *(target: ~2.5h)*

**Rationale:** Every downstream feature is "this, but with a UI on top." Validate the entire data path end-to-end before any UI is written. Bake the seed brain so the rest of the build can `cp -r` it.

**Deliverables:**
- gbrain installed via `git clone + bun link` (pinned SHA documented).
- `lib/gbrain/client.ts` — `spawn` wrapper, in-process mutex queue per tenant, env injection, stdout line iterator, 30s timeout.
- `lib/gbrain/paths.ts`, `lib/gbrain/tenants.ts` (in-memory Map, rescan on boot).
- `scripts/demo-check.sh` — verifies `gbrain --version`, `gbrain doctor --fast`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and that `./brains/` is writable.
- **Synthetic data corpus** (~50–75 markdown files) under canonical dirs (§5) with 3 planted anomalies.
- **Hand-rolled anomaly detection** (~3 rules in TS) that runs after import and writes findings to `concepts/march-anomaly-summary.md` + `concepts/recurring-charges.md`.
- **`scripts/seed.sh`** — `GBRAIN_HOME=brains/seed gbrain init && gbrain config set models.default sonnet && gbrain import data/maras-coffee/ && gbrain embed --stale && bun run scripts/run-anomaly-detection.ts`. Commit `brains/seed/` (or tar it).
- **Smoke gate** (§5): `graph-query`, `orphans`, and the "what was weird" query must all pass before Phase 1 is done.

**Avoids pitfalls:** #1 (whitelisted dirs), #2 (`init` only ever runs in seed script, never live), #3 (mutex queue), #4 (correct install), #5 (boot-time doctor check), #8 (data validation gate), #14 (HTTP/MCP decision logged).

### Phase 2 — Onboarding Theater + Chat *(target: ~3h)*

**Rationale:** These two ship together because they share infrastructure (SSE Route Handler pattern, `cp -r` seed, the dashboard route). Building them serially wastes the shared work; building them together gives the operator a runnable demo at the end of this phase.

**Deliverables:**
- `app/page.tsx` — landing, "Start your business brain" CTA.
- `app/onboard/page.tsx` + client component with `EventSource` for SSE.
- `app/api/tenants/route.ts` — POST: validate form (zod), `cp -r brains/seed brains/<tenantId>`, register in Map, return tenantId.
- `app/api/tenants/[id]/onboard/route.ts` — GET (SSE): plays the 30–45s narrated progress sequence. **Honest scripted phases** ("Creating your brain… Reading invoices and emails… Building the knowledge graph… Indexing for search… Ready"). A short live `gbrain query` warm-up call can be interleaved at the end to make the stream feel live.
- `app/dash/[tenantId]/page.tsx` + `ChatClient.tsx`.
- `app/api/tenants/[id]/chat/route.ts` — POST SSE: spawn `gbrain query`, mutex-queued, single SSE event with full response, close.
- Chat UI: shadcn input + send button + message list + scroll-area + markdown rendering + source citations. **Hard cap: 45 min on chat polish.**
- Suggested-question chips (3 hardcoded P0 questions).
- System prompt explicitly forbids guessing ("If the brain has no data on the question, say so").

**Avoids pitfalls:** #6 (45-min cap), #9 (theater, not live `init`), #12 (no key field), #19 (system prompt).

### Phase 3 — Insight Cards + Reset + Polish + Demo Prep *(target: ~2h)*

**Rationale:** Cards are the polish layer that proves correctness without the user typing. Reset is the demo-safety net. Demo prep (rehearsals, narration, panic-restart, network test) is non-negotiable and goes here.

**Deliverables:**
- `lib/gbrain/insights.ts` — 3 canned queries, run in parallel through the mutex queue, in-memory cache per tenant.
- `app/api/tenants/[id]/insights/route.ts` — GET JSON.
- Three insight cards on `/dash/[tenantId]/`:
  - **Top 5 vendors** (with $ + label "from graph")
  - **Monthly P&L snapshot** (revenue/COGS/opex/net + delta vs prior month, label "from timeline")
  - **Anomalies flagged** (3 items, each with "View invoice →" link, label "from skill: recurring-charges")
- Cards must distinguish loading / data / error states (no silent empty).
- `app/api/tenants/[id]/reset/route.ts` — POST: kill any spawn for this tenant, `rm -rf brains/<id>`, `cp -r brains/seed brains/<id>`, clear caches.
- Reset button in dashboard (2-second hold-to-confirm).
- `scripts/reset-all.sh`, `scripts/panic-reset.sh`.
- Pre-warm: run each P0 question once at server boot so the OS page cache + PGLite buffer pool are hot.
- **Rehearsal:** 3 full demo runs back-to-back with stopwatch (each onboarding 45–60s; each reset <10s).
- **3-minute spoken demo script** that names "graph", "timeline", and "skill" out loud at least three times across the talk (Pitfall #7 resolution).
- Code freeze at T-60min before demo: `git tag demo-final`.

**Avoids pitfalls:** #7 (visible primitives, demo script), #10 (reset discipline), #11 (phone hotspot + rehearsed), #13 (panic restart), #18 (card error states), #20 (code freeze tag).

### Phase order rationale (why this and not 4–6 phases)

- PROJECT.md sets granularity = coarse (3–5 phases). 3 phases keeps decision overhead down.
- Phase 1 doubles as the integration spike — the highest-risk surface goes first so it can't ambush the build at hour 5.
- Onboarding + chat in Phase 2 share infrastructure (SSE handler, dashboard route, tenant lifecycle) — splitting them adds context-switching cost.
- Cards + reset + demo prep cluster naturally as the "polish + safety" phase; they're independent of each other but all depend on chat working.
- No separate "stretch goals" phase — stretch items go in the cut list (§8), not the roadmap.

### Research flags (which phases need `/gsd-research-phase`)

- **Phase 1: light spike research only if `gbrain graph-query` doesn't behave as documented.** Most pitfalls research has been done; the residual unknown is the exact behavior of `enrich` on our specific markdown shape. Time-box to 20 min if needed.
- **Phase 2: NO — standard Next.js App Router + SSE patterns, all documented in Architecture research.**
- **Phase 3: NO — pure polish on top of working primitives.**

---

## 8. Drop-Order Priority (Cut List If Behind Schedule)

**Resolves conflict #8.** Features research estimates ~13h of work compressed into 7.5h, requiring 30–40% cuts. The operator needs a defensible drop order *before* the build starts, not at hour 6 under panic.

Cut in this order, top-first:

1. **`smb-audit` custom gbrain skill** — already stretch per PROJECT.md, Features, and Pitfalls. Drop on sight if Phase 3 is at risk.
2. **P1 anomaly: missing-invoice ($340 ABCD Plumbing)** — 4th anomaly. Drop if Phase 1 synthetic data runs long.
3. **Inline drill-downs (click vendor in answer → vendor page)** — chat differentiator. Drop in Phase 2 if chat overshoots its 45-min UI budget.
4. **Recurring-subscriptions 4th insight card** — Features lists this as a differentiator; drop if Phase 3 runs hot. The 3 P0 cards carry the demo.
5. **POS daily sales summaries (60–90 days)** — needed for true P&L card revenue line. If cut, P&L card shows expense-only view; pivot narration to "we're focused on the expense audit; sales side comes from QuickBooks integration in v1.1."
6. **Click-through-cards-prefill-chat UX** — pure polish, drop in Phase 3.
7. **Severity ranking on anomaly cards (red/yellow/grey)** — pure polish.
8. **6th–12th vendor pages** (`comcast-business`, `cintas-uniform`, `workers-comp-insurance`, `meta-ads`, `soundtrack-your-brand`, `pg-and-e`) — Phase 1 synthetic data. Cut to 5–7 core vendors if running long; keep the 4 that anchor the anomalies (`beanstalk-roasters`, `square-pos`, `seven-shifts`, `landlord-llc`).
9. **Typewriter visual on chat response** — UI polish, drop in Phase 3.
10. **Multi-month timeline (>3 months of data)** — drop to 2 months if Phase 1 synthetic data runs hot. Anomaly detection still works on a Jan/Mar comparison.

**Never cut:**
- The seed-brain pre-bake (Decision B).
- The synthetic-data canonical directory layout (§5).
- The 3 planted anomalies (their narration is the demo's emotional climax).
- The reset script.
- The 3 P0 demo questions answering correctly.
- The 3-minute demo script + 2 rehearsal runs.

**Restated firmly (resolves conflict #5):** Custom `smb-audit` skill is a STRETCH GOAL ONLY. Per PROJECT.md, Features research, and Pitfalls research — all three agree. The hand-rolled JS rules produce identical UI output in 25–30% less time. Do not let the roadmapper reintroduce this into v1. If Phase 3 finishes with ≥2h remaining and all rehearsals are green, *then* it can be considered as a Phase 3 stretch refactor (port the existing hand-rolled rules into a skill — same logic, different file).

---

## 9. Critical-Path Risks (Must-Not-Fail Moments)

Ordered by demo-day impact, with mitigations all already wired into the phase plan:

1. **Synthetic data filed under non-whitelisted dirs.** Mitigation: §5 layout is binding; Phase 1 smoke gate runs `gbrain graph-query` and `gbrain orphans` before declaring Phase 1 done. Severity: Critical.
2. **Wrong gbrain install path on demo laptop.** Mitigation: `scripts/demo-check.sh` runs `gbrain --version && gbrain doctor --fast`; pin a SHA, document the clone+link recipe in README. Severity: Critical.
3. **PGLite lock contention causing intermittent chat hangs.** Mitigation: in-process mutex queue per tenant in `lib/gbrain/client.ts` (Phase 1 deliverable). Severity: Critical.
4. **Onboarding stopwatch >60s on demo laptop / network.** Mitigation: pre-baked seed + `cp -r` (sub-second); onboarding becomes choreographed 30–45s narration. Severity: Critical.
5. **Reset doesn't fully clean state between demo runs.** Mitigation: reset = kill spawn + `rm -rf brains/<id>` + `cp -r brains/seed` + clear in-memory caches; rehearse 5× consecutively in Phase 3. Severity: High.

A sixth runner-up: **conference Wi-Fi failing the Anthropic synthesis call mid-chat.** Mitigation: phone hotspot as primary network (Phase 3 deliverable). Optional last-resort cached fallback gated by `DEMO_NETWORK_FALLBACK=1` env flag.

---

## 10. Prize-Narrative Checklist

These specific phrases and visible labels MUST appear in the demo. They are how a judge (or future self watching back the video) can tell QuickBrain isn't just "ChatGPT for SMB books." Pitfall #7 is the most-cited risk to the prize outcome; this checklist is the explicit countermeasure.

**Visible in the UI:**
- [ ] Each insight card carries a tiny primitive label: "from graph" / "from timeline" / "from skill: recurring-charges".
- [ ] Anomaly card items each link to ≥1 source page ("View invoice →", "View email →").
- [ ] Chat response messages render `[Source: companies/beanstalk-roasters.md]`-style citations.
- [ ] Optional "Behind the scenes" expandable on the chat answer showing the gbrain query payload and which pages were cited.
- [ ] No "API key" field anywhere user-facing.
- [ ] No "Sign in" / "Sign up" button anywhere.

**Spoken in the 3-minute demo script (each name said at least 3× across the talk):**
- [ ] **"graph"** — "the knowledge graph", "we never told it Beanstalk is a vendor — the graph extracted it", "graph traversal", etc.
- [ ] **"timeline"** — "month-over-month timeline", "timeline-aware retrieval", "the timeline noticed the price jump".
- [ ] **"skill"** — "a custom recurring-charges skill", "gbrain's skill system", "we could ship a vertical SMB-audit skill in 90 minutes".

**Pitch beats (in order, ~30s each):**
1. The setup: "Mara runs a coffee shop. She lives in QuickBooks but never interrogates it. Watch."
2. The 60-second onboarding (cards swap in live as the narration plays).
3. The "wow" anomaly card on dashboard load.
4. One chat question — "what was weird about last month?" — and the cross-linked answer (Beanstalk price hike → email → graph edge).
5. The point: "We built this on top of gbrain. The graph, the timeline, the skills — that's not us. We just put 60 seconds of onboarding around it for an SMB owner who's never touched a terminal."

---

## Confidence Assessment

| Area | Confidence | Notes |
|---|---|---|
| gbrain CLI surface (init/import/query, env vars, GBRAIN_HOME) | **HIGH** | Verified against gbrain README + INSTALL_FOR_AGENTS + DEPLOY.md |
| `serve --http` OAuth 2.1 requirement (no PGLite localhost bypass) | **HIGH** | DEPLOY.md explicit: legacy bearer mode is Postgres-only; HTTP server fails fast on PGLite |
| Whitelisted DIR_PATTERN for graph extraction | **HIGH** | Confirmed via gbrain issue #424 + DeepWiki ingestion docs |
| Stack picks (Bun, Next 15, shadcn, Tailwind v4) | **HIGH** | Mainstream 2026 path; verified via Next.js + shadcn docs |
| Pre-baked seed brain strategy | **HIGH** | Standard demo pattern; sub-second `cp -r` is OS-level reliable |
| In-process mutex resolves PGLite contention for single-tenant demo | **HIGH** | Mathematically only one in-flight gbrain op at a time |
| 60-second onboarding wall-clock with pre-bake | **HIGH** | Bound by `cp -r` + scripted narration; no network in critical path |
| Hand-rolled SSE vs Vercel AI SDK | **HIGH** | `gbrain query` confirmed single-response (not token-stream) |
| 7.5h fits the proposed 3-phase scope with stated cut list | **MEDIUM** | Features research estimates ~13h of work; cut list is defensible |
| Which 3 P0 questions land hardest with YC judges | **MEDIUM** | Best read on resonance, but a different judge panel might prefer different phrasing |
| Whether `enrich` skill auto-wires vendor entities from our markdown invoice format | **MEDIUM** | Will be verified by Phase 1 smoke gate; hand-rolled aggregation is the fallback (~1h to swap in) |
| Whether `signal-detector` skill can be coerced into financial anomalies | **LOW** | Assume "no"; hand-rolled rules carry the demo |
| 150-tx dataset size is the right balance for anomaly contrast | **MEDIUM** | Tunable in Phase 1; smoke gate catches "too thin" or "too noisy" |

### Gaps to address during planning

- **Phase 1 spike**: confirm `enrich` populates vendor pages from wikilink mentions in our exact markdown shape. If not, hand-roll vendor aggregation (~1h, adds to Phase 1).
- **Demo laptop run**: at least one full rehearsal on the actual demo laptop on the actual demo network at least 2 hours before the demo slot.
- **Anthropic key cost**: Sonnet on a 3-card-load + 3-query demo run is ~$0.05; verify the key has quota before demo day.

---

## Sources (aggregated from research)

### gbrain platform (HIGH confidence — verified against repo)
- [gbrain repository (master)](https://github.com/garrytan/gbrain)
- [gbrain INSTALL_FOR_AGENTS.md](https://github.com/garrytan/gbrain/blob/master/INSTALL_FOR_AGENTS.md)
- [gbrain README](https://github.com/garrytan/gbrain/blob/master/README.md)
- [gbrain docs/mcp/DEPLOY.md](https://github.com/garrytan/gbrain/blob/master/docs/mcp/DEPLOY.md) — OAuth 2.1, PGLite-vs-Postgres HTTP server requirement, bootstrap-token flow
- [gbrain TODOS.md](https://github.com/garrytan/gbrain/blob/master/TODOS.md) — `init` TTY behavior
- [gbrain issues #218 (bun -g postinstall), #424 (DIR_PATTERN whitelist), #658 (npm squatter), #1061, #1065](https://github.com/garrytan/gbrain/issues)
- [DeepWiki gbrain ingestion docs](https://deepwiki.com/garrytan/gbrain/4-search-and-retrieval)

### Web stack (HIGH confidence)
- [Next.js Streaming guide](https://nextjs.org/docs/app/guides/streaming) — `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`
- [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next) + [Tailwind v4 guide](https://ui.shadcn.com/docs/tailwind-v4)
- [Bun child_process docs](https://bun.com/docs/runtime/child-process) — node-API compat under Bun
- [Vercel AI SDK Stream Protocols](https://ai-sdk.dev/docs/ai-sdk-ui/stream-protocol) — used to confirm we are deliberately skipping it
- [Pedro Alonso — SSE in Next.js Route Handlers](https://www.pedroalonso.net/blog/sse-nextjs-real-time-notifications/)

### SMB ops / coffee-shop reality (HIGH confidence)
- [Bellwether Coffee Shop Startup Costs](https://bellwethercoffee.com/blog/coffee-shop-startup-costs)
- [Beancount Coffee Shop Bookkeeping Guide](https://beancount.io/blog/2026/01/25/coffee-shop-bookkeeping-complete-financial-guide)
- [Toast Restaurant Accounting Guide](https://pos.toasttab.com/blog/on-the-line/restaurant-accounting-guide)
- [Restaurant CFO Month-End Checklist](https://therestaurantcfo.com/restaurant-month-end-close-accounting-checklist/)
- [Hello Alice — Financial questions every SMB owner should ask](https://helloalice.com/financial-questions-small-business/)
- [Fyle — 14 accounting questions for SMB](https://www.fylehq.com/blog/accounting-questions-for-small-business)

### Anomaly detection / SaaS creep (HIGH confidence)
- [uSafe — Common Audit Red Flags](https://usafe-ca.com/2025/05/15/common-audit-red-flags-and-how-to-avoid-them-in-your-business/)
- [Beancount — SaaS Subscription Management](https://beancount.io/blog/2026/03/11/saas-subscription-management-small-business-guide)
- [Renewal Scout — Hidden Cost of Forgotten Subscriptions](https://renewalscout.com/blog/the-hidden-cost-of-forgotten-subscriptions/)

### Competitive landscape (HIGH confidence)
- [Truewind SMB solutions](https://www.truewind.ai/solutions/smb), [Pilot SMB](https://pilot.com/solutions/smb), [Ramp AI expense management](https://ramp.com/blog/ai-expense-management)

### Hackathon-demo wisdom (MEDIUM confidence)
- [Top 5 Live Demo Fails — Autodemo](https://autodemo.com/top-5-live-demo-fails/)
- [Hackathon Survival Guide — DEV](https://dev.to/momen_hq/hackathon-survival-guide-what-actually-matters-3hme)
- [MIT Sloan — Avoid These Five Pitfalls at Your Next Hackathon](https://sloanreview.mit.edu/article/avoid-these-five-pitfalls-at-your-next-hackathon/)
- [Devpost — How to win a hackathon](https://info.devpost.com/blog/hackathon-judging-tips)

---

*Project research synthesized for: QuickBrain (60-second SMB-onboarding shell around real gbrain, YC hackathon, 7.5h budget)*
*Synthesized: 2026-05-16*
