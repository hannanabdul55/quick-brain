# Spike Conventions

Patterns and stack choices that emerged across this session's spikes. New spikes follow these unless the question demands otherwise.

## Stack

- **Spike artifacts are standalone HTML files** committed under `.planning/spikes/<NNN-name>/`. Open with `open <file>` — no build step, no dev server, no dependencies. The user sees real artifacts they can rehearse against, not stdout.
- **No code runs against live external APIs from inside a spike.** Spikes that touch outbound services (Resend, QBO/Xero/Wave/FreshBooks) document the path, render a representative mock, and explicitly defer the live call to phase-execute work. Reason: spikes should never burn quota, deliverability reputation, or unsolicited messages.
- **No new runtime dependencies inside spike artifacts.** HTML files use only the project's existing stack assumptions (vanilla HTML/CSS/JS in browser, no React inside spikes). Justification: spikes need to be cheap to throw away.

## Structure

- One dir per spike at `.planning/spikes/<NNN-kebab-name>/`.
- Comparison spikes (`002a`, `002b`, `002c`) live under a parent dir `<NNN>-<topic>-comparison/` with a parent `README.md` aggregating the head-to-head verdict and a single `comparison.html`.
- Every spike dir has a `README.md` with frontmatter (`spike`, `name`, `type`, `validates`, `verdict`, `related`, `tags`) plus sections: `What This Validates`, `Research`, `How to Run`, `What to Expect`, `Investigation Trail`, `Results`.
- Verdicts: `VALIDATED ✓` / `INVALIDATED ✗` / `PARTIAL ⚠` / `PENDING`. Use the exact glyph — the manifest table greps for it.

## Patterns

- **Each spike produces at least one experiential artifact** (HTML page, side-by-side comparison, mock UI). The bar: the user should be able to *feel* whether the spike's conclusion is right, not just trust the verdict text.
- **Compliance + legal findings get a banner in the artifact** (not buried in the README). Example: spike 001's email-preview.html has a yellow "Compliance checklist baked into this template" panel. Trust signal travels with the visual.
- **Comparison spikes settle a number-of-axes-up-front question.** Spike 002 chose 5 axes (time-to-first-fetch, data-shape fit, rate limits, sandbox, refresh tokens) before scoring. Locking the axes prevents post-hoc justification.
- **Investigation Trail is the spike's most valuable section.** Document what was *assumed* going in vs. what the docs/code revealed. Pivots are findings.
- **Re-frame failed spikes into "where would this fit instead?"** — Spike 002c (FreshBooks) failed for the Mara persona but the README captures "useful for a future freelancer SKU." Don't discard, repurpose.

## Tools & Libraries

- **HTML + inline CSS** for visual artifacts. No build tools, no Tailwind, no React.
- **gbrain SDK `commit` command** for atomic spike commits: `gsd-sdk query commit "docs(spike-NNN): [VERDICT] — <key finding>" --files .planning/spikes/<dir>/ .planning/spikes/MANIFEST.md`.
- **Research grounding:** real doc URLs cited inline in the README's Research section. WebFetch / context7 / general knowledge mixed; cite when it matters (CAN-SPAM §5.3, FTC dollar amounts, Intuit refresh-token rotation dates).

## Anti-Patterns

- Spinning up dev servers for spikes — too heavy for "throwaway exploration."
- Spikes that consume real API quota / send real outbound messages / mutate shared state. Always mock + render.
- Spike READMEs that say "VALIDATED — it works" with no investigation trail or surprises. A clean verdict almost always means the spike was too shallow.
- Re-using a spike dir for a follow-up question. Spawn a new numbered spike; cross-reference via `related: [NNN]` in frontmatter.

---

*Conventions captured: 2026-05-18 after spikes 001, 002a, 002b, 002c.*
