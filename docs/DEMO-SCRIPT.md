# QuickBrain — 3-Minute Demo Script

> Spoken script for the YC hackathon demo. Total target: 180 seconds.
> Sections are timed; keep moving. If anything breaks, run `bun run panic-reset`
> then `bun run dev` and pick up at the closest safe point.

## Pre-demo checklist (~30s before going on stage)

1. Open a terminal: `cd quick-brain && bun run dev` — wait for "ready on :3000".
2. Open the browser to `http://localhost:3000/`.
3. Confirm `~/.zshenv` exports `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`.
4. Confirm `brains/seed/` exists (`ls brains/seed/companies/ | wc -l` ≥ 5).
5. Have a second terminal tab ready, pre-cd'd to the repo, with `bun run panic-reset` typed but not yet entered. This is the safety net.

## Section 1 — Opening (15s)

> "This is QuickBrain. It's a 60-second onboarding shell around gbrain — the
> YC-backed brain engine — built for non-technical small-business owners.
> The judges asked: how does a mom-and-pop shop actually *get* a gbrain?
> Watch."

## Section 2 — Onboarding theater (45s)

> Click "Start your business brain". Show the 3-field form.
> "Three fields. No login. No API keys. No payment screen."
>
> Fill in: Business name = "Mara's Coffee", Type = "Coffee shop", Owner = "Mara".
> Click Submit. The narrated SSE stream plays.
>
> While the stream plays, narrate over it:
> "Behind the scenes, we're spawning the real gbrain CLI — `gbrain init`,
> `gbrain import`, `gbrain extract`, `gbrain embed`. The knowledge **graph**
> is being built right now from synthetic invoices, vendor emails, and bank
> statements committed to the repo."
>
> After ~36 seconds, the dashboard loads.

## Section 3 — Dashboard insight cards (60s)

> "Three insight cards. Each one says what gbrain primitive computed it.
>
> Top 5 vendors — 'from **graph**'. The brain has cross-linked every
> invoice to its anchor company page, and we're aggregating against that
> graph. Beanstalk Roasters tops the list; we'll come back to them.
>
> Monthly P&L — 'from **timeline**'. gbrain's timeline system has indexed
> the monthly-close pages. Revenue $27,480 in March; net $18,792. Up from
> February — the **timeline** lets us compute month-over-month deltas
> without writing a single SQL query.
>
> Anomalies flagged — 'from **skill**: recurring-charges'. A custom-shaped
> rule **skill** ran against the brain at import time and wrote a concept
> page summarizing three weird things in March:
>   1. Beanstalk price hike, +22%, $330 of new spend.
>   2. Square POS billed the $79 subscription twice — duplicate charge.
>   3. 7shifts SaaS, $43 a month, no activity in 126 days. A ghost.
>
> Each anomaly has a 'View source' link back to the originating invoice
> or bank statement. The **skill** wrote a citable concept page; we're not
> inventing this — it's in the brain."

## Section 4 — Chat moneyshot (45s)

> "Now the chat surface. I'm going to ask Mara's brain a question she'd
> actually ask, in plain English."
>
> Click the chip: "What was weird about last month?"
> Wait ~30 seconds for the answer to stream in.
>
> As it streams, narrate:
> "It's running `gbrain think` with Claude Haiku in the background. The
> brain retrieves from its knowledge **graph**, ranks by relevance, and
> synthesizes a markdown answer with citations — see those `[Source: ...]`
> tags inline."
>
> When the answer renders: read the headline finding (Beanstalk + Square +
> 7shifts) and one citation. "All three anomalies, named, with sources."
>
> "The anomaly-detector **skill** gbrain ingested wrote the concept page
> that anchors every one of these citations. That's gbrain's skill system
> making the answer auditable."

## Section 5 — Close (15s)

> "Mara just went from zero to a working business brain in 60 seconds,
> without touching a terminal. The **graph**, the **timeline**, and the
> recurring-charges **skill** are all real gbrain primitives — every label
> on the dashboard tells you where the answer came from. That's the prize
> narrative: gbrain, accessible to mom-and-pop shops."
>
> Click the Reset button. Hold for 2 seconds. The dashboard resets.
> "And we can do it again."
>
> "Thank you."

## If anything goes wrong (operator-only notes)

- **Browser tab froze:** Hard refresh (Cmd-Shift-R). The dashboard re-fetches insights.
- **`bun run dev` died or chat hangs:**
  1. Open the safety-net terminal tab.
  2. Run `bun run panic-reset`.
  3. Run `bun run dev`.
  4. Reload the browser. Skip back to Section 2 (re-do the onboarding form).
- **Insight cards stuck on loading:** Hold Reset for 2s — invalidates the insight cache and re-fetches.
- **`gbrain` CLI not found:** out-of-budget — bail to slides. See README "Panic recovery".

## Rehearsal playbook (operator runs before recording)

Run this 3 times back-to-back on the demo laptop. Each run must complete
cleanly. State must not leak between runs. Anomaly findings must be
identical across runs.

```bash
# Reset state cold.
bun run panic-reset

# Start the server. Run the demo.
bun run dev &
# ... perform the 5 sections above ...

# Reset and repeat.
pkill -f "next dev"
bun run panic-reset
bun run dev &
# ... again ...
```

Acceptance: 3 consecutive completions with no terminal errors, no UI errors,
identical anomaly findings (Beanstalk $330 + Square $79 + 7shifts $43).

## Demo-final freeze (operator-only)

When all 3 rehearsals pass green, freeze the build:

```bash
git add -A
git commit -m "chore: demo-final freeze"
git tag -a demo-final -m "Demo recording cut"
```

See README "Panic recovery" for the `git checkout demo-final` rollback.
