# Pitfalls Research — QuickBrain

**Domain:** YC hackathon SMB demo wrapping gbrain (real CLI, not mocked) inside a Next.js shell — 7.5h hard budget including demo prep.
**Researched:** 2026-05-16
**Confidence:** HIGH on gbrain-specific gotchas (verified against the actual repo, README, and recent issue tracker). MEDIUM on hackathon-demo wisdom (multiple credible secondary sources).

> The single dominant constraint is **time × demo determinism**. Every pitfall below is filtered through: "does this cost hours we don't have, or does this kill the live demo in front of judges?" Pitfalls that don't threaten one of those two are out of scope.

---

## Critical Pitfalls

### Pitfall 1 (CRITICAL): Synthetic data filed in non-whitelisted directories — graph stays empty

**What goes wrong:**
We name our synthetic-data folders semantically (`invoices/`, `vendors/`, `bank-statements/`, `emails/`) and import them. `gbrain import` runs without error, pages exist, search works — but the knowledge graph has **no edges**. Insight cards that depend on graph traversal ("top vendors", "who is this person", relationship queries) return nothing. The "graph" half of gbrain's pitch is silently dead.

**Why it happens:**
gbrain's link extractor uses a hardcoded directory whitelist (`DIR_PATTERN`) covering `people/`, `companies/`, `meetings/`, `concepts/`, `deals/`, `originals/`, `media/`, etc. Bare slugs and wikilinks pointing into directories **not** on that whitelist are silently skipped (Issue #424 confirms this — custom schema dirs lose ~70% of cross-references). The typed-inference cascade (`works_at`, `founded`, `invested_in`, `advises`) also only fires on entities under the canonical directory names.

**How to avoid:**
Map the SMB schema **onto gbrain's existing whitelist**, do not invent new directory names:
- Vendors → `companies/blue-bottle-roasters.md`, `companies/pg-and-e.md`, `companies/square.md`
- Recurring expenses / SaaS → `companies/quickbooks.md`, `companies/toast-pos.md`
- Customers / regulars → `people/jamie-from-3rd-st.md` (if used at all)
- Invoices / statements → `meetings/` directory analog, OR `originals/` for "monthly close" snapshots, with wikilinks to `[[blue-bottle-roasters]]`
- Anomalies / observations → `originals/` with timeline entries and refs to `[[company]]`

Each markdown file MUST follow gbrain's compiled-truth + timeline pattern: frontmatter (`type`, `title`, `tags`), a "Compiled truth:" paragraph, then a `---`, then dated bullets (`- 2026-03-12: Invoice #4421 from [[blue-bottle-roasters]] for $1,840 (+22% vs Feb)`). Wikilinks to the canonical slugs are what trigger graph extraction.

**Warning signs:**
- After `gbrain import`, `gbrain graph-query blue-bottle-roasters --depth 2` returns no neighbors.
- `gbrain orphans` reports most pages as orphaned.
- Insight card queries return empty arrays despite chat-style queries finding the data via hybrid search.

**Phase to address:** Phase 2 (Synthetic dataset design). Verify with a `gbrain graph-query` smoke check before declaring the dataset done. Do NOT proceed to chat UI until the graph has at least one non-trivial path.

**Severity:** Critical — this silently amputates the "gbrain showcase" prize narrative.

---

### Pitfall 2 (CRITICAL): `gbrain init` hangs the Next.js subprocess on interactive prompts

**What goes wrong:**
The web app shells out to `gbrain init` (or runs it via a Node `child_process.spawn`). On the operator's laptop, `gbrain init` is interactive — it prompts for search mode, database backend, and embedding provider. With no TTY attached, behavior is undefined in older versions; with a TTY attached but no stdin piping, the process blocks waiting for input. The onboarding spinner spins forever; judges see a frozen page.

**Why it happens:**
- `gbrain init` prompts interactively in TTY mode (search mode, database, embedding provider).
- Non-TTY behavior auto-picks `balanced` mode but may still pause on other prompts depending on version.
- Node `child_process.spawn` without `stdio: ['ignore', ...]` and without explicit env can inherit a TTY in dev but not in built mode, producing different behavior locally vs. on the demo laptop.

**How to avoid:**
- Spawn with `stdio: ['ignore', 'pipe', 'pipe']`, explicitly non-TTY (no `inherit`).
- Pass every decision via env vars and/or flags rather than relying on auto-pick: prefer PGLite (default), set `OPENAI_API_KEY` in env, pre-create the `gbrain.yml` config in the brain repo dir before calling `init` if possible, or use a wrapper script.
- Before wiring it into the Next.js route, run the exact spawn invocation from a plain `node script.js` with `stdio: 'ignore'` to confirm it terminates without input.
- Add a hard 30-second timeout around `gbrain init`; on timeout, surface a clear error and fall back to a **pre-baked brain** (see Pitfall 13).
- Capture stderr to a log file so silent failures aren't invisible.

**Warning signs:**
- The onboarding step takes >5 seconds and there's no progress output.
- Local `bun run dev` works but `bun run build && bun start` hangs (TTY vs non-TTY divergence).
- `gbrain init` process is alive in `ps` but consuming 0% CPU.

**Phase to address:** Phase 1 (gbrain integration spike). The very first hour must include a "can we drive `gbrain init` from a Node subprocess deterministically?" check.

**Severity:** Critical — this is the first 60 seconds of the demo; if it stalls, nothing else matters.

---

### Pitfall 3 (CRITICAL): PGLite exclusive file lock — concurrent brain access deadlocks

**What goes wrong:**
The web app calls `gbrain query` from an API route while a background `gbrain jobs work` or a leftover `gbrain import` is still running on the same `~/.gbrain/brain.pglite`. PGLite holds an exclusive file lock. The second invocation blocks waiting for the lock, the API route times out, the chat UI shows a spinner that never resolves.

**Why it happens:**
PGLite is an embedded Postgres in a single file; it serializes writers via an OS-level file lock. The README explicitly notes: "Concurrent gbrain CLI invocations serialize (expected behavior)." For multi-process access you need the Supabase/Postgres backend — which is out of scope at 7.5h.

**How to avoid:**
- Serialize all gbrain CLI invocations in the Next.js layer with an in-process mutex (a single `Promise` queue) around the subprocess spawn.
- **Strongly prefer** `gbrain serve --http --port 3131` as the single long-lived gbrain process; have Next.js hit its HTTP endpoints instead of spawning fresh `gbrain query` subprocesses per request. One process = one lock holder = no contention.
- During the import step, **block** all chat queries (show a "preparing your brain…" state) instead of allowing parallel reads.
- Never run `gbrain jobs work` during the demo — minions are out of scope for v1.

**Warning signs:**
- A second query hangs for >5s while the first one's still running.
- Spurious `Aborted()` or "database is locked" errors in stderr.
- Reset script fails to re-init because a zombie subprocess still holds the lock.

**Phase to address:** Phase 1 (integration spike) — decide HTTP-server-vs-subprocess-per-call early. This is an architecture choice, not a polish item.

**Severity:** Critical — flakes intermittently, which is the worst possible failure mode for a live demo.

---

### Pitfall 4 (CRITICAL): Wrong install path — `bun install -g github:garrytan/gbrain` is broken

**What goes wrong:**
Operator (or a teammate, or future-you setting up on the demo laptop) installs gbrain the "obvious" way: `bun install -g github:garrytan/gbrain` or `npm install -g gbrain`. The CLI aborts on first PGLite open with `Aborted()` (Bun blocks postinstall hooks globally; schema migrations never run) or silently installs a squatter package (`gbrain@1.3.x` on npm registry is not the real one).

**Why it happens:**
- Bun's `-g` install path skips postinstall, so migrations don't fire (Issue #218).
- npm has a squatting `gbrain` package overwriting the canonical binary (Issue #658).

**How to avoid:**
Document the ONLY supported install path in the project README and in a setup script:
```bash
git clone https://github.com/garrytan/gbrain.git
cd gbrain && bun install && bun link
```
Pin a known-good commit SHA (don't track `master`). Add a `quick-brain setup` doctor script that runs `gbrain --version` AND `gbrain doctor --fast` and aborts loudly if either fails. Run this script on the demo laptop the night before, not 5 minutes before.

**Warning signs:**
- `gbrain --version` works but `gbrain init` errors with `Aborted()`.
- `gbrain` binary is on PATH but `gbrain doctor` complains about missing schema.

**Phase to address:** Phase 0 (Environment bootstrap, first 30 minutes).

**Severity:** Critical — un-debuggable on demo day if you hit it cold.

---

## High Pitfalls

### Pitfall 5 (HIGH): Missing or mis-scoped API keys break the demo mid-flow

**What goes wrong:**
`gbrain init` succeeds because PGLite needs no key. `gbrain import` partially succeeds because the text index works without embeddings. But the first chat query fails because hybrid search needs vectors which need `OPENAI_API_KEY`. The judge sees "error" mid-demo.

**Why it happens:**
gbrain requires `OPENAI_API_KEY` (default embedding provider) and `ANTHROPIC_API_KEY` (synthesis/routing in some skills). These are not validated up front; they fail lazily at query time. If you `.env.example` is missing keys, or the demo laptop doesn't have them sourced into the shell that spawns Next.js, the failure is invisible until query time.

**How to avoid:**
- On Next.js boot, run a startup health check: `gbrain doctor --fast --json` and refuse to serve traffic if it fails.
- `.env.local` template MUST list `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` with comments explaining what fails without each.
- Use `gbrain import` with `--no-embed` flag for the synthetic-data pre-bake step (fast), then run embedding as a second deterministic step you can pre-run before the demo. **Never embed live during the 60s onboarding.**
- Pre-warm: run `gbrain query "test"` once at server boot to catch missing-key failures before any judge sees the UI.

**Warning signs:**
- `gbrain import` is suspiciously fast (under 2s for 50 docs probably means no embedding happened).
- `gbrain doctor` reports an embedding provider warning.
- First query in a fresh session returns instantly but with garbage results.

**Phase to address:** Phase 1 (integration spike) — startup health check is part of the wiring. Phase 4 (demo prep) — re-verify on demo laptop.

**Severity:** High — recoverable if caught early; demo-killing if it surfaces in the chat panel.

---

### Pitfall 6 (HIGH): Building a chat UI from scratch instead of using Vercel AI SDK

**What goes wrong:**
We spend 90+ minutes implementing message streaming, message state management, scroll behavior, markdown rendering, code-block formatting, error states, and retry logic. The result is a janky chat that flickers and looks worse than ChatGPT, and we have no time left for insight cards.

**Why it happens:**
Chat UIs look trivial. They aren't — streaming + cancellation + error recovery + autoscroll edge cases burn hours. The 2025 default in the Next.js ecosystem is Vercel AI SDK (`useChat`, `streamText`) for exactly this reason.

**How to avoid:**
Use **Vercel AI SDK** (`ai` + `@ai-sdk/react`) and `shadcn/ui` chat components. Wire the chat's `api` endpoint to a Next.js route handler that proxies to `gbrain serve --http` (or shells out to `gbrain query`). Stream the response. **Budget: 45 minutes for chat surface, hard stop.**

If a kit like `assistant-ui` or `chat-sdk` (Vercel's official chat starter) fits, use it as the starting template and rip out what you don't need.

**Warning signs:**
- Hour 4 and chat still doesn't stream.
- You're writing CSS for message bubbles.
- You're implementing retry logic.

**Phase to address:** Phase 3 (Chat surface). Add a hard time-box; if blown, drop to non-streaming `fetch` and accept the worse UX.

**Severity:** High — eats hours with low marginal demo payoff.

---

### Pitfall 7 (HIGH): Showcasing your UI instead of gbrain's primitives — losing the prize narrative

**What goes wrong:**
Judges watch a polished chat panel and think "nice chat app." They never realize there's a **knowledge graph**, **timeline**, **hybrid search**, **skills**, or **minions** underneath. The prize is the SMB-gbrain prize; if the demo doesn't make gbrain visible, the prize goes to whoever did.

**Why it happens:**
Chat UIs hide the engine. Without explicit narration and UI affordances, the brain is invisible — it looks like any other GPT wrapper.

**How to avoid:**
- **Insight cards must visibly use gbrain primitives:** "Top vendors (from graph)", "Last month's anomalies (from timeline)", "Recurring charges (from skills)". Each card has a tiny label citing the primitive used.
- A small "Behind the scenes" expandable panel on the chat shows the actual `gbrain query` payload and what it retrieved (graph edges traversed, pages cited). Judges love seeing the engine.
- The 3-min demo script names the primitives **out loud**: "Notice we never told it Blue Bottle is a vendor — it figured that out from the graph extraction."
- One scripted "wow" question uses a graph traversal that a vector-only RAG could not answer: e.g., "Which of my vendors had a price hike in March?" — answer requires timeline + graph join.

**Warning signs:**
- Your demo script never says the words "graph", "timeline", "skill", or "minion".
- Insight cards could be implemented by any GPT wrapper.
- A judge could plausibly think "I could build this in an afternoon with the OpenAI API."

**Phase to address:** Phase 4 (Insight cards) and Phase 5 (Demo script). The narration is a phase deliverable, not an afterthought.

**Severity:** High — directly affects the prize outcome.

---

### Pitfall 8 (HIGH): Over-engineering synthetic data — fixtures all look the same, no contrast

**What goes wrong:**
You generate 500 perfectly uniform monthly invoices from a script that varies only the amount by ±5%. The anomaly detection has nothing to grip — every month looks like every other month. Or worse, you over-anomalize: every invoice has a weirdness, so nothing stands out. The "what was weird about March?" wow-query returns "nothing notable" or, equally bad, returns 30 things.

**Why it happens:**
Generating data with code feels productive. Hand-curating 50 believable invoices feels slow. So you write a generator with too few knobs.

**How to avoid:**
- **50 fixtures, not 500.** Quality over quantity.
- Use real-sounding vendor names: *Blue Bottle Roasters*, *Sysco*, *Square*, *Toast POS*, *PG&E*, *Yelp Ads*, *Spotify for Business*. Not "AcmeCorp" or "Vendor1".
- Plant **3–5 specific anomalies** that the graph + timeline naturally surface, NOT ones that need LLM judgment:
  1. **Bean price hike (March):** Blue Bottle invoices jump from $1,500/mo to $1,840 (+22%) — surfaces via timeline + graph aggregation.
  2. **Double-charge:** Two identical rent payments on March 3 and March 5 — surfaces via timeline diff.
  3. **Zombie SaaS:** Monthly $79 charge from a service ("PrintShark Pro") that has no activity for 4 months — surfaces via skills/recurring-charges + last-touch.
  4. **New vendor surprise:** A vendor that appeared in March and never before — graph traversal trivially highlights it.
  5. **Recurring rounding error:** Subtle, only if time allows.
- Use dates in the last 90 days from "today" so it feels current. Anchor to a fixed `DEMO_TODAY` constant so the data doesn't go stale.
- Validate by running `gbrain query "what was weird about March"` against the dataset BEFORE wiring it into the UI. If the answer is bad, fix the data, not the prompt.

**Warning signs:**
- You can't, in one sentence, describe what each anomaly is and how the graph+timeline surfaces it.
- All vendor names sound like placeholder text.
- "Show me top vendors" returns a tie or near-tie across all of them.

**Phase to address:** Phase 2 (Synthetic dataset). End-of-phase gate: a manual `gbrain query` smoke test against each scripted demo question.

**Severity:** High — bad data means bad answers means demo flops.

---

### Pitfall 9 (HIGH): Onboarding silently takes 3 minutes, not 60 seconds

**What goes wrong:**
The 60-second claim is the entire pitch. But `gbrain init` + `gbrain import` of 50 markdown files with embeddings can easily blow past 60s on a fresh brain, especially with cold OpenAI API calls. Judges check their watches.

**Why it happens:**
- Embedding 50 chunks via OpenAI is ~1–3s per batch over a few batches.
- `gbrain init` is ~2s for PGLite (per README), but pre-checks add up.
- A cold Next.js dev server adds ~5s for first request.
- Network jitter on conference Wi-Fi adds variance.

**How to avoid:**
- **Pre-bake everything.** Ship a `seed-brain.sh` script that runs at repo bootstrap time, creating `~/.gbrain.bak/` with the brain already initialized + imported + embedded.
- The "onboarding" UI is **theatrical**: the user submits the form, and we `cp -r ~/.gbrain.bak ~/.gbrain` (sub-second) while the UI plays a 30–45s narrated progress sequence: "Starting brain… Importing your books… Building the knowledge graph… Indexing… Ready."
- The progress sequence is honest about what's happening (these are real gbrain steps) but the actual compute is pre-done. This is **not cheating**: the operator is showing a non-technical person how onboarding *would* feel; the engine is real, the data is real, only the timing is choreographed.
- For a stretch: run `gbrain import --no-embed` live during the visible flow (fast), and embed in the background after the UI says "Ready" — graceful degradation.
- Budget the demo flow to land at 55–58 seconds with margin. Time it 5 times with a stopwatch.

**Warning signs:**
- Live timing varies by >10 seconds between runs.
- The "ready" state depends on a network round-trip.
- You're optimistic about Wi-Fi.

**Phase to address:** Phase 1 (integration spike) — decide pre-bake-vs-live early. Phase 4 (Demo prep) — stopwatch test.

**Severity:** High — the 60-second promise is the headline; missing it kills the pitch.

---

### Pitfall 10 (HIGH): Reset button doesn't actually reset — state leaks between demo runs

**What goes wrong:**
After the first demo run, the brain has cached state (embeddings, jobs, page versions). The second demo run shows different answers, or the chat panel pre-populates with the last run's messages. Judges sit through the same demo twice with mysterious differences.

**Why it happens:**
- PGLite file is sticky; partial deletes leave broken state.
- Next.js client state (React state, sessionStorage, localStorage, cookies) persists across navigations.
- gbrain's HTTP server (if used) has in-memory caches.
- Browser keeps the previous chat history.

**How to avoid:**
- Reset is a **scripted nuke**: kill any `gbrain serve` process → `rm -rf ~/.gbrain` → `cp -r ~/.gbrain.bak ~/.gbrain` → restart `gbrain serve` → clear Next.js session/localStorage → reload page. One button, one bash script behind it, sub-10s end-to-end.
- The reset endpoint is a single Next.js API route that runs the script via `execa` with a timeout and returns success or a loud error.
- Test the reset cycle 5+ times in a row before the demo. If any cycle takes >10s or fails, fix it before anything else.
- Add a visible "Ready for next demo" indicator that appears only after the reset is verified-clean (e.g., a healthcheck that asserts the brain has exactly the expected page count and zero chat messages).

**Warning signs:**
- Second demo run shows residual chat messages.
- After a "reset", running the wow query returns slightly different text.
- The reset script "succeeds" but the chat history is still there.

**Phase to address:** Phase 4 (Demo readiness). This is not a polish item; it's the difference between "we can demo 10 times back-to-back" and "we have one shot."

**Severity:** High — kills judge confidence if it flakes in front of them.

---

### Pitfall 11 (HIGH): Live demo on hotel/conference Wi-Fi without offline fallback

**What goes wrong:**
On demo day, the conference Wi-Fi is saturated. OpenAI embedding calls time out mid-demo. The chat panel shows "error" or stalls. The 60-second onboarding turns into "let me try again."

**Why it happens:**
Embedding calls and LLM synthesis calls cross the public internet. Conference Wi-Fi is always bad.

**How to avoid:**
- **Use a phone hotspot** as the primary network, not conference Wi-Fi. Bring a charged phone and an unlimited tethering plan.
- Pre-embed everything (see Pitfall 9). The actual demo should require **zero embedding calls** — only LLM synthesis for query responses, which is one short call per chat turn.
- Cache the wow-query response: pre-run the curated demo questions through gbrain in a clean state, save the responses to disk, and if a live query fails (timeout, error), fall back to the cached response with a 200ms artificial delay so it doesn't feel obviously cached. **Tradeoff:** this is light-cheating; only enable it via an env flag `DEMO_NETWORK_FALLBACK=1` that you flip if the live network is collapsing.
- Have a recorded screencast of the full demo on the operator's laptop as the absolute last-ditch fallback. Don't intend to use it. Have it ready.

**Warning signs:**
- You're planning to demo on conference Wi-Fi.
- The first query in a fresh session takes >5s.
- You haven't tested the demo on a flaky network.

**Phase to address:** Phase 4 (Demo readiness) — explicit network-degradation test.

**Severity:** High — the most likely external failure on demo day.

---

### Pitfall 12 (HIGH): Asking for an API key live during onboarding

**What goes wrong:**
The form has a field for "OpenAI API Key" and a tooltip linking to platform.openai.com. The judge experiences the friction the SMB owner would experience. Pitch dead.

**Why it happens:**
"Bring your own key" feels honest and is technically simpler.

**How to avoid:**
- The operator's keys live in `.env.local` server-side. The user (judge persona) **never sees a key field**.
- The demo narrative is: "In production, Mara doesn't deal with keys — we provision a brain with managed embeddings." We're showing the experience, not the billing model.
- If the prize panel asks about the economics, you have a clean answer ready, but it's not in the user-facing flow.

**Warning signs:**
- Your onboarding form has more than 2 fields.
- The word "API" appears anywhere in the user-facing UI.

**Phase to address:** Phase 1 (Onboarding flow). Hard rule from the start.

**Severity:** High — this is a positioning failure that's trivial to avoid.

---

## Medium Pitfalls

### Pitfall 13 (MEDIUM): No "panic restart" macro — operator fumbles on stage

**What goes wrong:**
Something glitches mid-demo. The operator alt-tabs, opens a terminal, tries to remember the right commands, types the wrong path. 90 seconds of dead air. Judges check phones.

**How to avoid:**
- A **single hotkey or single-click button** runs `./scripts/panic-reset.sh`: kill all gbrain/Next processes → reset brain → restart server → open localhost in the demo browser tab. Bound to something like `Cmd+Shift+R` via a global hotkey tool, or a literal button on the desktop.
- Practice the panic flow 3 times during demo prep. The operator should be able to execute it in <10s, eyes-closed.
- Display a small "system: ready" indicator in the corner of the screen that goes green when the brain is fully alive — so the operator can glance and know the reset finished.

**Warning signs:**
- Recovery requires typing more than one command.
- The operator hasn't actually rehearsed a recovery.

**Phase to address:** Phase 4 (Demo readiness).

**Severity:** Medium — only matters if something else has already failed, but compounds the damage.

---

### Pitfall 14 (MEDIUM): MCP integration when HTTP is simpler

**What goes wrong:**
We try to wire the Next.js app to gbrain via MCP because "MCP is the gbrain story." MCP is stdio-oriented (for Claude Desktop, Cursor, etc.) and not the natural fit for a web app talking to a local engine. We burn 90 minutes debugging stdio framing, JSON-RPC, and stream parsing. The HTTP server (`gbrain serve --http`) does the same thing with `fetch`.

**How to avoid:**
- **Default to `gbrain serve --http --port 3131`.** Next.js API routes proxy to it with `fetch`.
- Only touch MCP if the prize narrative explicitly demands it. The HTTP server is itself an MCP HTTP server (OAuth 2.1) — you get the "MCP" credibility without the stdio pain.
- If you must shell out to the CLI per request (no long-lived server), use `execa` with strict timeouts and capture stderr.

**Warning signs:**
- You're reading MCP stdio framing specs.
- You're writing a JSON-RPC client.

**Phase to address:** Phase 1 (integration spike).

**Severity:** Medium — easy to recover from if caught early; expensive if discovered at hour 5.

---

### Pitfall 15 (MEDIUM): Auth / sessions / multi-tenancy creeping in "just in case"

**What goes wrong:**
"What if a judge wants to log in and try it themselves?" → we add NextAuth → 2 hours gone, zero demo payoff, and now there's a login wall in front of the wow moment.

**How to avoid:**
- **No auth. No sessions. No accounts.** The whole demo is one anonymous session per browser. Hard rule.
- "Multi-tenancy" is simulated by isolating brain dirs by a generated `tenant_id` cookie (UUID set on first visit), pointing at `~/.gbrain-tenants/<id>/`. Optional, only if time allows after Phase 5.
- If a judge wants to try their own data, the answer is "not in the demo, but here's the architecture diagram for how it would work in production." That's a stronger answer than "let me create your account."

**Warning signs:**
- You're searching for `next-auth` docs.
- The UI has a "Sign in" button.
- The word "user" appears in the schema.

**Phase to address:** Phase 0 (Scope lock) — re-affirm at every phase transition.

**Severity:** Medium — scope discipline issue, but it's a classic time sink.

---

### Pitfall 16 (MEDIUM): Polishing the landing page before the brain works

**What goes wrong:**
At hour 1, you have a beautiful landing page with hero copy, gradient, and a logo. At hour 6, the brain still can't answer the wow query.

**How to avoid:**
- **Build the system end-to-end in the ugliest possible form first.** Landing page is one `<h1>` and a form. Chat is a textarea and an unstyled list. Insight cards are `<pre>` tags. Get the data flowing through every layer before any CSS happens.
- Polish in Phase 5, after all functional phases are green. Set a 60-minute polish budget; not a minute more.

**Warning signs:**
- You've picked a font.
- You're tweaking shadow opacity.
- The brain doesn't answer queries yet but the landing page has hover animations.

**Phase to address:** Phase 0 (Phase ordering) — functional vertical slice before any horizontal polish.

**Severity:** Medium — won't kill the demo, but is a top-3 time sink.

---

### Pitfall 17 (MEDIUM): Custom `smb-audit` skill before the core path works

**What goes wrong:**
The PROJECT.md mentions `smb-audit` as a stretch goal. It's narratively powerful (a custom skill = strongest possible gbrain showcase). At hour 3, feeling good, you start authoring it. At hour 7, the skill half-works and the core demo is broken.

**How to avoid:**
- **Hard gate:** no skill authoring until the entire core flow (onboarding → import → chat → insight cards → reset) is green AND demo-rehearsed once.
- The skill authoring loop is non-trivial: `gbrain skillify scaffold` → edit TS hook → edit SKILL.md → register in RESOLVER.md → `gbrain check-resolvable --strict` → test. Easily 90 minutes for a real one.
- If skill ships: it must be a thin, **deterministic** skill (recurring-charge detection, no LLM judgment) that surfaces one of the planted anomalies. Demo narration explicitly names the skill: "We wrote a custom gbrain skill that detects zombie subscriptions — it's a 40-line markdown file."

**Warning signs:**
- It's hour 4 and the core chat doesn't work yet, but you're editing `RESOLVER.md`.
- You're reading the skill authoring docs before the import step is verified.

**Phase to address:** Phase 5 (Stretch goals) — and only if Phase 4 is fully green.

**Severity:** Medium — high upside if it lands, but only with strict gating.

---

### Pitfall 18 (MEDIUM): Insight cards silently empty because of a caught exception

**What goes wrong:**
An insight card's data-loader catches an error and renders "No data available." The judge thinks the brain has no data, when in fact it's a code bug.

**How to avoid:**
- Insight cards **must** distinguish three states: loading / data / error. The error state shows the error message, not "no data." If a card has zero items in non-error state, it says "No anomalies this month" — explicit, not a fallback.
- Each card's data path runs once in a smoke test before the demo: `curl http://localhost:3000/api/insights/top-vendors | jq` should return non-empty.
- Log every gbrain CLI invocation to stderr with the full args and exit code; tail the log during demo prep.

**Warning signs:**
- A `try { } catch { return [] }` exists anywhere in the insights pipeline.
- "No data" appears anywhere on the dashboard during demo dry-runs.

**Phase to address:** Phase 3 (Insight cards) — explicit error-state requirement in the phase's success criteria.

**Severity:** Medium — silent failures look indistinguishable from "the engine doesn't work."

---

### Pitfall 19 (MEDIUM): Off-script chat questions hallucinate

**What goes wrong:**
A judge takes the keyboard and asks something the demo wasn't tuned for: "How many lattes did I sell in Q3?" The brain has no sales data; gbrain happily synthesizes a confident wrong answer from the embedded vendor invoices.

**How to avoid:**
- The chat system prompt explicitly constrains gbrain to its retrieved context, and explicitly says "If the brain has no data on the question, say so — do not guess. SMB owners trust precision, not confidence."
- The dataset itself is bounded: you know exactly what's in it. If a judge asks something outside the scope, the right answer is "I don't have sales data wired up yet — that's the next integration. But I can tell you everything about your vendor spend." That's a **good** answer; it's honest and points to the roadmap.
- For the curated demo questions (the ones you scripted), test them 5+ times to ensure they return consistent, correct answers.

**Warning signs:**
- The chat answers any question with confidence regardless of whether the brain has data.
- The system prompt says "be helpful" without saying "don't guess."

**Phase to address:** Phase 3 (Chat surface) — system prompt is a phase deliverable.

**Severity:** Medium — directly affects judge perception of trustworthiness, which is the SMB story.

---

### Pitfall 20 (MEDIUM): Code freeze / pre-merge state not deterministic

**What goes wrong:**
30 minutes before the demo, you push a "small fix." It breaks something subtle. Reset doesn't recover because the brain seed was built before the bug.

**How to avoid:**
- **Hard code freeze 60 minutes before demo.** No changes after the freeze except critical bug fixes, each tested via the full reset → demo loop before keeping.
- Tag the freeze commit (`git tag demo-final`). The demo laptop runs that exact tag.
- The seed brain (`~/.gbrain.bak`) is rebuilt from scratch after the freeze and committed (or tarballed) to the repo.

**Warning signs:**
- You're touching `git` in the last 30 minutes.
- The seed brain's contents don't match the current synthetic-data files.

**Phase to address:** Phase 5 (Demo readiness).

**Severity:** Medium — preventable with discipline, expensive if violated.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems — though for a 7.5h demo build, "long-term" means "the next 4 hours."

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded `tenant_id` = `"mara"` | Skip multi-tenancy entirely | None — this is the demo, single tenant is correct | **Always** for this build |
| Pre-baked brain seed | Sub-second onboarding | If data drifts you must re-bake | **Always** for demo; document the rebuild script |
| Spawning `gbrain query` per-request via execa | No HTTP server to manage | PGLite serialization + spawn latency | Only acceptable if you can show <500ms warm latency in dry-runs |
| Catch-all error toast "Something went wrong" | Saves UI design time | Hides real bugs | Never for the brain-data path; OK for purely cosmetic actions |
| Skip TypeScript strict on demo code | Faster typing | Subtle bugs at hour 6 | **Never** — strict mode is faster overall under stress |
| Bypass `gbrain doctor` on boot | One less startup call | Surfaces config issues live | Never for the demo laptop run |
| Cached wow-query response as fallback | Network-proof demo | Slight dishonesty if it triggers without disclosure | Env-gated, last-resort only |
| No tests | Save hours | First regression takes more hours than the tests would have | **Always acceptable at 7.5h** — replace with one full manual demo-run smoke test per phase |

---

## Integration Gotchas

Common mistakes when wiring the components together. **All gbrain entries verified against the actual repo and recent issues (HIGH confidence).**

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `gbrain init` | Spawning interactively from Node | `stdio: ['ignore', 'pipe', 'pipe']`, env-driven config, 30s timeout, fallback to pre-baked brain |
| `gbrain import` | Importing custom directory names (`invoices/`, `vendors/`) | File under canonical names: `companies/`, `people/`, `meetings/`, `originals/` (whitelist in DIR_PATTERN — Issue #424) |
| `gbrain import --no-embed` | Forgetting that embeddings are needed for hybrid search | Always run embedding step after `--no-embed` import; gate UI on completion |
| `gbrain query` | Calling per-request via subprocess | Run `gbrain serve --http --port 3131` once at boot; Next.js routes `fetch` it |
| `gbrain serve --http` | Binding to `0.0.0.0` | Default is `127.0.0.1` — keep it; demo laptop only |
| PGLite | Concurrent CLI invocations | Serialize via in-process mutex; prefer single long-lived `gbrain serve` |
| Install | `bun install -g github:garrytan/gbrain` | `git clone && bun install && bun link` from a pinned SHA (Issues #218, #658) |
| Env vars | Missing `OPENAI_API_KEY` and/or `ANTHROPIC_API_KEY` | Boot-time `gbrain doctor --fast --json` health gate |
| MCP | Implementing MCP stdio client in Next.js | Use `gbrain serve --http` instead; it's MCP-over-HTTP under the hood |
| Vercel AI SDK | Writing streaming from scratch | Use `streamText` + `useChat`; route handler proxies to `gbrain serve --http` |
| Wikilinks | Pointing `[[blue-bottle]]` at a non-existent page | All wikilink targets must have a corresponding `companies/blue-bottle.md` file in the seed |
| Skill authoring | Skipping `gbrain check-resolvable --strict` | Always run before declaring a skill done; catches SKILLIFY_STUB sentinels and dead resolver entries |
| Frontmatter | Skipping `type:` field | gbrain uses `type` to route into the right ingestion path; missing `type` = degraded extraction |

---

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces. Verify each before declaring a phase done.

- [ ] **`gbrain init` from Next.js:** Often missing — verify by running it in a fresh terminal with `stdio: 'ignore'` (no inherited TTY) and confirming it terminates in <5s.
- [ ] **Synthetic data graph:** Often missing — verify with `gbrain graph-query blue-bottle-roasters --depth 2 --type both` returning at least 3 neighbors.
- [ ] **Embedding completion:** Often missing — verify the wow query returns consistent, sensible results 3 times in a row.
- [ ] **Insight cards:** Often missing error vs. empty distinction — verify by killing the brain mid-query: cards should show "error", not "no data."
- [ ] **Reset:** Often missing full cleanup — verify by running the wow query → reset → wow query, and confirming both responses are byte-identical (or close to it).
- [ ] **Demo flow timing:** Often missing — stopwatch from form-submit to ready: must be 45–60s on the demo laptop, not the dev machine.
- [ ] **Chat error path:** Often missing — verify by yanking the network mid-query; chat should show a clear error, not spin forever.
- [ ] **Panic restart:** Often missing — verify the script works with all of `gbrain serve`, Next.js, and the browser tab fully crashed.
- [ ] **Demo narration:** Often missing — verify the script names the gbrain primitives ("graph", "timeline", "skill") at least three times in three minutes.
- [ ] **Off-script chat:** Often missing — verify by asking "how much did I make in Q3?" and confirming the answer admits the brain has no sales data.
- [ ] **Re-runnability:** Often missing — verify by running the full demo 3 times back-to-back. If any run differs visibly, fix it.
- [ ] **Demo-laptop run:** Often missing — verify the build works on the actual demo laptop with the actual demo network ≥2h before the demo slot.

---

## Recovery Strategies

When pitfalls occur despite prevention. **All recoveries assume the pre-baked seed and reset script exist** — if those aren't built, recovery cost goes to HIGH for everything.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Empty graph (Pitfall 1) | MEDIUM | Move data files into whitelisted dirs, re-run `gbrain import`, rebuild seed. ~30 min if caught at Phase 2; ~2h if caught at Phase 4. |
| `gbrain init` hang (Pitfall 2) | LOW if caught early | Switch to pre-baked brain + `cp -r` "init"; ~20 min. |
| PGLite lock (Pitfall 3) | LOW | Kill stray processes, restart `gbrain serve`. ~2 min. |
| Wrong install (Pitfall 4) | LOW | Reinstall via `git clone` path. ~5 min if you have network. |
| Missing API key (Pitfall 5) | LOW | Source env var, restart server. ~1 min. |
| Chat-from-scratch overrun (Pitfall 6) | MEDIUM | Drop streaming, use plain `fetch`, accept worse UX. ~15 min to retrofit. |
| Reset leak (Pitfall 10) | LOW | Re-run reset script, hard-refresh browser. ~10s. |
| Network failure live (Pitfall 11) | LOW if cached fallback exists | Toggle `DEMO_NETWORK_FALLBACK=1` env, reload. ~30s. |
| Off-script hallucination (Pitfall 19) | MEDIUM if caught pre-demo | Update system prompt, re-test. Mid-demo: operator says "great question, that's our next integration" and pivots. |
| Code freeze violation (Pitfall 20) | HIGH | Rollback to `demo-final` tag, rebuild seed, re-rehearse. ~20 min in the worst case. |

---

## Pitfall-to-Phase Mapping

How roadmap phases should address each pitfall. The roadmapper should bake the **Verification** column into each phase's success criteria.

| Pitfall | Severity | Prevention Phase | Verification |
|---------|----------|------------------|--------------|
| 1. Non-whitelist dirs → empty graph | Critical | Phase 2 (Synthetic dataset) | `gbrain graph-query` returns ≥3 neighbors for each canonical vendor |
| 2. `gbrain init` hangs in subprocess | Critical | Phase 1 (Integration spike) | Spawn from `node` with `stdio: 'ignore'` completes in <5s |
| 3. PGLite lock contention | Critical | Phase 1 (Integration spike) | Architecture decision: single `gbrain serve --http`, in-process mutex |
| 4. Wrong install path | Critical | Phase 0 (Bootstrap) | `gbrain doctor --fast` passes on demo laptop |
| 5. Missing API keys | High | Phase 1 (Integration spike) | Boot-time `gbrain doctor` gates server startup |
| 6. Chat from scratch | High | Phase 3 (Chat surface) | Vercel AI SDK in use; 45-min hard time-box |
| 7. UI hides gbrain primitives | High | Phase 4 (Insight cards) + Phase 5 (Demo script) | Demo script names "graph"/"timeline"/"skill" ≥3 times |
| 8. Synthetic data quality | High | Phase 2 (Synthetic dataset) | All 5 scripted demo questions return correct answers consistently |
| 9. Onboarding >60s | High | Phase 1 + Phase 5 (Demo prep) | Stopwatch: 5 consecutive runs in 45–60s |
| 10. Reset leaks state | High | Phase 4 (Demo readiness) | Reset → wow-query produces ≈identical output across 5 runs |
| 11. Wi-Fi failure | High | Phase 5 (Demo readiness) | Phone hotspot tested + cached fallback env-flag wired |
| 12. API-key field in UI | High | Phase 1 (Onboarding flow) | UI screenshot review: no "key" string anywhere user-facing |
| 13. No panic restart | Medium | Phase 4 (Demo readiness) | Panic script executes in <10s, rehearsed 3× |
| 14. MCP vs HTTP confusion | Medium | Phase 1 (Integration spike) | Decision logged in `docs/decisions/`, HTTP path chosen by default |
| 15. Auth creep | Medium | Phase 0 + every transition | Out-of-scope list in PROJECT.md re-affirmed |
| 16. Landing-page polish too early | Medium | Phase 0 (Phase ordering) | Ugliest-end-to-end before any CSS work |
| 17. Skill authoring too early | Medium | Phase 5 (Stretch only) | Core demo green + rehearsed before skill work starts |
| 18. Empty insight cards | Medium | Phase 3 (Insight cards) | Loading / data / error states all implemented and tested |
| 19. Off-script hallucinations | Medium | Phase 3 (Chat surface) | System prompt explicitly forbids guessing; tested with off-script question |
| 20. Code freeze violations | Medium | Phase 5 (Demo readiness) | `demo-final` git tag in place 60min before demo |

---

## Live-Demo Failure Mode Summary

A condensed list for the operator to scan 30 minutes before going on stage:

1. **Network dies** → toggle `DEMO_NETWORK_FALLBACK=1`, switch to phone hotspot.
2. **Brain crashes** → panic-reset hotkey; <10s recovery.
3. **Reset leaks** → reload browser tab; re-run reset; verify zero chat messages before pitch resumes.
4. **Judge asks off-script** → "great question — the brain doesn't have that wired up yet; here's what it does have…" + pivot to a scripted card.
5. **Onboarding stalls** → operator's verbal cover: "and as the brain spins up, let me explain what's happening under the hood…" (buys 30s).
6. **Insight card empty** → ignore it, lead with chat; mention the card later.
7. **Total system failure** → screencast fallback as a last resort; never apologize, narrate over it.

---

## Sources

- [garrytan/gbrain README + docs](https://github.com/garrytan/gbrain) — CLI surface, init prompts, env vars, directory layout, install gotchas (HIGH confidence; verified against the actual repo).
- [garrytan/gbrain Issues](https://github.com/garrytan/gbrain/issues) — install path gotchas (#218, #658), embedding hangs (#1065), MCP transport issues (#1061), link extractor whitelist limitation (#424). (HIGH confidence.)
- [gbrain ingestion + entity extraction docs](https://deepwiki.com/garrytan/gbrain/4-search-and-retrieval) — DIR_PATTERN whitelist, compiled-truth + timeline format, code-fence stripping. (HIGH confidence.)
- [Top 5 Live Demo Fails — Autodemo](https://autodemo.com/top-5-live-demo-fails/) — Wi-Fi failure prevalence, backup-presenter / video-cued-up wisdom. (MEDIUM confidence.)
- [Hackathon Survival Guide — DEV Community](https://dev.to/momen_hq/hackathon-survival-guide-what-actually-matters-3hme) — overscoping, backend-vs-frontend time mismatch, last-30min panics. (MEDIUM confidence.)
- [Avoid These Five Pitfalls at Your Next Hackathon — MIT Sloan](https://sloanreview.mit.edu/article/avoid-these-five-pitfalls-at-your-next-hackathon/) — scope discipline, judge attention. (MEDIUM confidence.)
- [Top 5 Mistakes Developers Make at Hackathons — BizThon](https://medium.com/@BizthonOfficial/top-5-mistakes-developers-make-at-hackathons-and-how-to-avoid-them-d7e870746da1) — pitch + demo prep starvation. (MEDIUM confidence.)
- [Understanding hackathon judging criteria — Devpost](https://info.devpost.com/blog/understanding-hackathon-submission-and-judging-criteria) — judges reward functional MVP + clear problem framing + technical execution. (MEDIUM confidence.)
- [How to win a hackathon — Devpost judges](https://info.devpost.com/blog/hackathon-judging-tips) — innovation, technical execution, presentation balance. (MEDIUM confidence.)
- Vercel AI SDK + shadcn/ui ecosystem norms (Next.js 15 / 2025) — default streaming chat path. (MEDIUM confidence; widely adopted convention.)

---
*Pitfalls research for: QuickBrain — YC hackathon SMB demo wrapping gbrain.*
*Researched: 2026-05-16*
