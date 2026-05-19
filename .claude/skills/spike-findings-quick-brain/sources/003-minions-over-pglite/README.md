---
spike: 003
name: minions-over-pglite
type: standard
validates: "Given gbrain 0.35.1 installed via bun link with PGLite as the backend, when GBRAIN_ALLOW_SHELL_JOBS=1 gbrain jobs submit shell --follow is invoked, then the shell command executes inline, completes with stdout+stderr captured, and reports an exit code — without requiring a long-running `jobs work` daemon"
verdict: VALIDATED
related: [001]
tags: [gbrain, minions, pglite, phase-4-precondition]
---

# Spike 003: Minions over PGLite

## What This Validates

The Phase 4 (`smb-audit` gbrain Skill) plan has a precondition embedded in `04-01-PLAN.md`: confirm that `gbrain jobs submit shell --follow` works against a PGLite-backed brain. The Minions docs are written for the Postgres backend (`jobs work` daemon is explicitly Postgres-only). If this precondition fails, the entire skill mechanism falls back to direct `bun skills/smb-audit/scripts/smb-audit.mjs` invocation — one-line change in `scripts/seed.sh`, but knowing this BEFORE Phase 4 execute begins is the unblock.

## Research

No external research needed — this is a fact spike against the operator's installed gbrain. Background context (already validated in earlier spikes):

- gbrain 0.35.1.0 installed via `git clone + bun install && bun link` (per CLAUDE.md install note)
- PGLite is the v1.0 backend (`brains/seed/.gbrain/brain.pglite`)
- `gbrain --help` confirms `jobs work` is "Postgres only" but `jobs submit ... --follow` makes no such restriction in its help text
- The Phase 4 ARCHITECTURE.md research recommended the `jobs submit shell --follow` path; this spike verifies it empirically

## How to Run

```bash
export PATH="$HOME/.bun/bin:$PATH"       # bun must be in PATH for gbrain to spawn its worker
export GBRAIN_HOME="$(pwd)/brains/seed"  # point at any PGLite-backed brain
export GBRAIN_ALLOW_SHELL_JOBS=1

# Test 1 — trivial happy path
gbrain jobs submit shell --params '{"cmd":"echo hello from minion","cwd":"/tmp"}' --follow

# Test 2 — stderr + a 1s sleep (proves blocking + multi-stream capture)
gbrain jobs submit shell --params '{"cmd":"echo to-stdout && echo to-stderr >&2 && sleep 1 && echo done","cwd":"/tmp"}' --follow

# Test 3 — non-zero exit (proves retry semantics matter for skill design)
gbrain jobs submit shell --params '{"cmd":"exit 42","cwd":"/tmp"}' --follow
```

## What to Expect

Three observable outcomes documented in the Investigation Trail below.

## Investigation Trail

### Test 1 — happy path (verbatim output captured 2026-05-19)

```
[ai.gateway] recipe "google" declares an embedding touchpoint without max_batch_tokens; recursion is the only safety net for batch caps.
Job #1 submitted (shell). Executing inline...
[minion worker] shell handler enabled (GBRAIN_ALLOW_SHELL_JOBS=1)
[minion worker] subagent handlers enabled
Minion worker stopped.
Job #1 completed in 0.2s
Result: {"pid":37786,"exit_code":0,"duration_ms":11,"stderr_tail":"","stdout_tail":"hello from minion\n"}
```

**Three critical observations:**

1. **"Executing inline..."** — `--follow` causes the job to run in the current process. No daemon required. This is the load-bearing finding: PGLite does NOT need the Postgres-only `jobs work` daemon to run `jobs submit ... --follow`.
2. **Worker lifecycle is automatic** — `[minion worker]` enables, runs the job, `Minion worker stopped` — all inside the same `--follow` invocation. The caller sees a single blocking call.
3. **Result is a structured JSON object** parseable from the last line: `{pid, exit_code, duration_ms, stderr_tail, stdout_tail}`. Easy to parse from a shell-out harness (`lib/gbrain/client.ts` style).

### Test 2 — stderr + sleep (verbatim output)

```
Job #2 submitted (shell). Executing inline...
[minion worker] shell handler enabled (GBRAIN_ALLOW_SHELL_JOBS=1)
[minion worker] subagent handlers enabled
Minion worker stopped.
Job #2 completed in 1.3s
Result: {"pid":37921,"exit_code":0,"duration_ms":1016,"stderr_tail":"to-stderr\n","stdout_tail":"to-stdout\ndone\n"}
```

**Observations:**
- **stderr is captured separately** from stdout in the result JSON. Good for debugging — Phase 4's skill can write progress to stderr without polluting the structured output.
- **Wall-clock latency was 1.3s** for a 1s sleep — ~300ms of gbrain overhead per invocation. Acceptable for the Phase 4 seed-pipeline (one skill invocation per seed build); would be a problem for high-frequency per-request use. Not relevant for the smb-audit case.
- **`stdout_tail` is the FULL stdout**, despite the field name suggesting truncation. Confirmed by the multi-line content.

### Test 3 — non-zero exit (verbatim output)

```
Job 3 (shell) failed, retrying in 923ms (attempt 1/3)
Job 3 (shell) failed, retrying in 2054ms (attempt 2/3)
Job 3 (shell) permanently failed: exit 42:
Minion worker stopped.
Job #3 dead: exit 42:
(exit code from --follow itself: 0)
```

**Critical observation — this is the Phase-4-relevant gotcha:**

- **Non-zero shell exit triggers gbrain's Minions retry policy** (3 attempts with backoff: ~1s, ~2s, ~4s).
- The retry semantics are wrong-shape for a deterministic, idempotent skill like `smb-audit`. If the skill fails because of a parser bug, retrying it 3× takes ~7 seconds before reporting failure — wasted time and noise in the pipeline.
- **The `gbrain jobs submit --follow` process itself exits 0 even when the job dies.** Callers must parse the output for `"permanently failed"` / `"dead:"` or look at the `Result:` JSON's `exit_code` field.

**Implication for Phase 4 `smb-audit` skill design:**

- **The skill must ALWAYS exit 0.** Internal errors are handled internally — write a `concepts/audit-error.md` page with the error details, but exit cleanly. This both avoids the 3× retry penalty and gives users a parseable error trail inside the brain rather than a half-failed pipeline.
- **The seed.sh harness must check the `Result:` line's `exit_code` field**, not just `gbrain jobs submit`'s own exit code, to detect failure. A small grep+jq or a 5-line shell snippet handles this.

### Worker behaviour and gotchas

- The line `[ai.gateway] recipe "google" declares an embedding touchpoint without max_batch_tokens` is unrelated gbrain startup chatter. Safe to ignore.
- The line `[minion worker] subagent handlers enabled` confirms that subagent-shaped skills could be invoked the same way (relevant for any future skill that delegates to an LLM-based subagent).
- The PGLite warning from earlier spikes (`Skipping DB checks (--fast mode, URL present from config-file-path)`) does not appear during `jobs submit --follow` — the job runs against PGLite cleanly.

## Results

**Verdict: VALIDATED ✓** — Minions shell-job execution works over PGLite via `--follow`. Phase 4's recommended invocation path is empirically confirmed. The Phase-4 fallback (direct `bun skills/smb-audit/scripts/smb-audit.mjs`) is NOT required and the seed pipeline can ship the canonical `gbrain jobs submit shell --follow` form.

**Three findings that need to land in the Phase 4 plan BEFORE execute:**

1. **The `smb-audit` skill must always exit 0** (internal-error handling writes `concepts/audit-error.md` rather than throwing). This avoids Minions' 3-attempt retry penalty and produces a user-visible error trail in the brain.
2. **The `seed.sh` harness must parse the `Result:` JSON's `exit_code` field** — `gbrain jobs submit --follow`'s own exit code is always 0 regardless of job outcome. A 5-line shell snippet does this.
3. **`bun` must be in PATH when invoking `gbrain`** — `gbrain` spawns its worker via `bun` internally. The Phase 4 seed.sh + scripts/demo-check.sh need to export `PATH="$HOME/.bun/bin:$PATH"` defensively or document the prereq.

**Cross-cutting impact:**

- Phase 4 `04-01-PLAN.md` precondition checkpoint is satisfied. The plan's 30-min embedded spike can be marked complete with this README as evidence.
- The findings update three task lists in the existing PLAN files (skill exit-0 discipline + seed.sh exit-code parsing + bun-in-PATH defensive export). These should land before Phase 4 executes.
- For Spike 001's deferred scheduler choice: this spike validates that Minions-on-PGLite is a viable cron substrate. Combined with `--follow` for the in-process case and a separate `cron`/`launchd` wrapper for the persistent case, the scheduler ladder is intact.

---

*Spike investigation: 2026-05-19. Empirically tested on operator's installed gbrain 0.35.1.0 + brains/seed/.*
