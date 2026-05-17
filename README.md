# QuickBrain

**A brain for your small business.** Ask your books anything — in plain English — and get cited answers in seconds.

> *"What was weird about March?"* → in 30 seconds, your brain names the three things you missed: a quiet price hike from your top supplier, a duplicate SaaS charge, and a ghost subscription still draining your account.

**Live demo:** [http://64.181.231.190:3000](http://64.181.231.190:3000)

### Try it in 90 seconds

1. Open the [live demo](http://64.181.231.190:3000) → click **"Start your business brain"**.
2. Fill in any 3 fields (suggested: `Mara's Coffee` / `Coffee shop` / `Mara`) → **Submit**.
3. Watch the onboarding stream (~36s). You'll land on a dashboard with three insight cards.
4. In the chat, click the chip **"What was weird about last month?"** → ~30s later, a markdown answer names three planted anomalies with `[Source: ...]` citations.
5. (Optional) Press-and-hold the **Reset** button on the dashboard for 2s to wipe and restart.

> Prefer to skip onboarding? Go straight to the pre-seeded tenant at [http://64.181.231.190:3000/dash/seed](http://64.181.231.190:3000/dash/seed) — same insight cards, same chat, no waiting.

QuickBrain is the 60-second onboarding wrapper around [gbrain](https://github.com/garrytan/gbrain) that takes a non-technical SMB owner from "what's this?" to "huh, that's actually useful" without ever opening a terminal. Built as a YC hackathon entry for the gbrain **mom-and-pop SMB prize**.

## What's real vs what's mocked

The honest pitch: **only the input data is synthetic. Everything downstream is real gbrain.**

| Layer                       | Real or mocked? | Notes |
|-----------------------------|-----------------|-------|
| Input data (invoices, vendor emails, bank statements) | **Mocked** (`data/maras-coffee/` — 46 markdown files for the demo persona) | A real deploy swaps this for a one-time pull from QuickBooks / Stripe / Gmail |
| `gbrain init` / `import` / `extract` / `embed`        | **Real** | The actual gbrain CLI runs in a child process per tenant |
| Knowledge graph + entity links                        | **Real** | gbrain extracted 88 typed links from 46 pages |
| Embeddings + semantic search                          | **Real** | OpenAI `text-embedding-3-small`, computed at ingest |
| Chat synthesis with citations                         | **Real** | `gbrain think --model haiku` (Claude Haiku 4.5) against the live brain |
| Anomaly detection (concept pages)                     | **Real** (rule-based skill that writes `concepts/march-anomaly-summary.md`) | Production would replace this with `gbrain skill` invocation; the page-and-cite mechanic is identical |

**Going live on real data is plumbing, not invention.** A v1.1 connector that drops QuickBooks Online API responses through a markdown-frontmatter transformer is ~12–20h of work (OAuth 2.0 + Accounting API queries + shape mapping + token refresh). Same goes for Stripe and Gmail. The brain mechanics — graph extraction, embeddings, retrieval, synthesis, citations — already work, and they're what the prize is actually about.

## What you'll see in 60 seconds

1. Land on the page → 3-field form (no login, no API keys, no payment).
2. Submit → onboarding theater plays a real `gbrain init → import → extract → embed` pipeline (~36s).
3. Land on a dashboard with three insight cards, each labeled with the gbrain primitive that computed it:
   - **Top vendors** (from *graph*)
   - **Monthly P&L** (from *timeline*)
   - **Anomalies flagged** (from *skill: recurring-charges*)
4. Ask one of the three suggested questions in chat → ~30s later, a markdown answer with inline `[Source: dir/slug]` citations.

That's the demo.

## Run it yourself

### Prerequisites

- **bun ≥ 1.2** (`curl -fsSL https://bun.sh/install | bash`)
- **gbrain** installed via the only working path:
  ```bash
  git clone https://github.com/garrytan/gbrain.git
  cd gbrain && bun install && bun link
  gbrain --version   # expect 0.35.x or later
  ```
  > `bun install -g github:garrytan/gbrain` is **broken** — Bun skips postinstall, PGLite migrations never run, and the CLI aborts on first use (gbrain issue #218). Clone+link is the supported path.
- API keys exported in your shell:
  ```bash
  export OPENAI_API_KEY="sk-..."        # embeddings + hybrid search
  export ANTHROPIC_API_KEY="sk-ant-..." # chat synthesis (Claude Haiku 4.5)
  ```

### Build the seed brain

```bash
git clone https://github.com/hannanabdul55/quick-brain.git
cd quick-brain
bun install
bun run demo-check    # verify env, gbrain, keys, brains/ write
bun run seed          # produces brains/seed/ via gbrain init → import → extract → embed
```

### Run the app

```bash
bun run dev
# open http://localhost:3000
```

### Sanity check the brain directly (optional)

```bash
GBRAIN_HOME=brains/seed gbrain graph-query beanstalk-roasters --depth 2
GBRAIN_HOME=brains/seed gbrain think --model haiku "what was weird about last month?"
bun run mutex-smoke   # verify the per-tenant serialization invariant
```

The "what was weird" answer should name all three planted anomalies in one response: Beanstalk +22%, Square duplicate $79, 7shifts ghost $43/mo.

## Architecture (one paragraph)

A single Next.js 15 App Router app spawns the `gbrain` CLI as a child process per tenant, with `GBRAIN_HOME=brains/<tenant>/` for filesystem isolation and an in-process Promise mutex enforcing one gbrain spawn per tenant at a time (PGLite can't take a second writer). Onboarding is a 5-stage SSE choreography over a real `gbrain init → import → extract → embed` pipeline (~36s). Chat is one `gbrain think --model haiku` spawn per question, streamed back as a single SSE `answer` frame. Insight cards are parsed directly from the static markdown dataset (zero gbrain spawns, sub-200ms loads via an in-process cache pre-warmed at boot). Reset is a per-tenant abort + `rm -rf brains/<id>/` + `cp -r brains/seed/` (~3s).

No database of our own. No auth. No queue. No Docker. PGLite lives inside each `brains/<id>/` and gbrain owns it. The full stack rationale and "what NOT to use" decisions live in `CLAUDE.md`.

## Roadmap

- **v1.0** (this build, shipped) — synthetic-data demo, full gbrain integration, 60-second onboarding flow.
- **v1.1** — QuickBooks Online connector (OAuth + Accounting API → markdown ingest). Same for Stripe and Gmail. Estimated 12–20h per integration.
- **v1.2** — Custom `gbrain skill` for `smb-audit` (currently a hand-rolled TS detector; v1.2 makes it a first-class gbrain skill so the operator can publish it to the gbrain ecosystem).
- **v2** — Multi-tenant deploy, real auth, dashboard polish (severity badges, click-to-prefill from anomaly rows, 4th card slot).

## Panic recovery (operator notes)

If something breaks during a recording or rehearsal:

1. **Soft reset** — on the dashboard, press-and-hold the **Reset** button for 2 seconds. Wipes the current tenant, re-copies `brains/seed/`, kills in-flight gbrain spawns, invalidates the insight cache. ~3s.
2. **Hard reset** — `bun run panic-reset` then `bun run dev`. Kills the Next.js dev server, kills any orphan gbrain processes, wipes all non-seed tenants. Does NOT rebuild the seed brain. ~5s.
3. **Nuclear reset** — `git checkout v1.0 && bun install && bun run panic-reset && bun run dev`. `v1.0` is the milestone-frozen tag.

## Acknowledgments

Built on [gbrain](https://github.com/garrytan/gbrain) by Garry Tan — the brain engine doing all the actual work. QuickBrain is the onboarding shell that makes it accessible to people who'd never `git clone` anything.

## License

MIT.
