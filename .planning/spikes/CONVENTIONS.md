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
- **Bun + TypeScript scripts** for integration/infra spikes that need to actually run code against the live stack. Pattern: one `spike.ts` (orchestrator), optional `cold-probe.ts` (per-process worker for cold-start measurements), `spike-events.json` (forensic log JSON), `result.html` (visualization), `README.md` (frontmatter + sections). Run via `bun .planning/spikes/<NNN>/spike.ts`.
- **Dynamic-import gbrain** in spike scripts via `import("gbrain/" + subpath)` (matches the production `types/gbrain.ts` shim pattern). Lets spikes call `_load("import-file")`, `_load("ai/gateway")`, etc. without modifying the shim until the spike validates the call.
- **Throwaway source pattern for write spikes.** Pre-register a unique source row via `engine.executeRaw('INSERT INTO sources (id, name, config) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING', [...])`, write the test pages with that sourceId, then `DELETE FROM sources WHERE id = $1` at end — FK ON DELETE CASCADE sweeps pages + chunks atomically. Spike-008 pattern; documented in spike-007 README. Avoids polluting any tenant's real data.

## Forensic-log layer for infra spikes

Integration/infra spikes that call external systems (Supabase, gbrain, OpenAI) build a per-event log array structured as:

```ts
interface SpikeEvent {
  t: string;       // ISO timestamp
  ms: number;      // ms since t0
  category: "setup" | "config" | "engine" | "ingest" | "search" | "concurrent" | "leak-probe" | "cleanup" | "error" | "summary";
  message: string;
  data?: unknown;
}
```

Each `log(category, message, data)` call appends to `events[]` AND prints to stdout. At end, `writeFileSync(__dirname + "/spike-events.json", JSON.stringify({spike, verdicts, events}, null, 2))`. The HTML page reads from the JSON for visualization; the README links to it for forensic review. Pattern proven across spikes 007, 008, 009, 010.

## Anti-Patterns

- Spinning up dev servers for spikes — too heavy for "throwaway exploration."
- Spikes that consume real API quota / send real outbound messages / mutate shared state. Always mock + render.
- Spike READMEs that say "VALIDATED — it works" with no investigation trail or surprises. A clean verdict almost always means the spike was too shallow.
- Re-using a spike dir for a follow-up question. Spawn a new numbered spike; cross-reference via `related: [NNN]` in frontmatter.

---

*Conventions captured: 2026-05-18 after spikes 001, 002a, 002b, 002c.*
*Updated: 2026-05-28 after spikes 007, 008, 009, 010 (Phase 7 pre-execute integration + frontier set). Added: Bun script pattern for live-stack infra spikes, dynamic-import gbrain pattern, throwaway source pattern, forensic-log layer convention.*
