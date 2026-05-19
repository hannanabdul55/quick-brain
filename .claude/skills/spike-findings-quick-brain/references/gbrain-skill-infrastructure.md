# gbrain Skill Infrastructure

## Requirements

Non-negotiable for any work that runs a gbrain skill or shells out via gbrain Minions. Validated empirically against installed gbrain 0.35.1 + PGLite backend.

- **PGLite backend supports `gbrain jobs submit shell --follow`.** The Minions docs are written for Postgres but the `--follow` path runs jobs inline in the current process — no daemon required. Empirically confirmed; this is the canonical Phase 4 invocation pattern.
- **The `smb-audit` skill — and every future custom skill — MUST always exit 0.** Non-zero shell exits trigger gbrain Minions' built-in retry policy: 3 attempts with ~1s/2s/4s backoff, ~7s wasted on a deterministic skill failure. Internal errors → write a `concepts/<skill-name>-error.md` page describing the failure, then exit cleanly.
- **The `scripts/seed.sh` harness MUST parse the `Result:` JSON line's `exit_code` field** to detect job failure. `gbrain jobs submit --follow`'s own exit code is always 0 regardless of job outcome — relying on it silently hides skill failures from the seed pipeline.
- **`bun` must be in PATH** when invoking `gbrain`. The `gbrain` CLI spawns its worker via `bun` internally. Defensive: `export PATH="$HOME/.bun/bin:$PATH"` at the top of `scripts/seed.sh` + `scripts/demo-check.sh` + any cron / CI wrapper.
- **gbrain Minions retries are wrong-shape for deterministic skills.** Don't fight the retry — work with it by holding the always-exit-0 discipline above.

## How to Build It

### Canonical Phase 4 skill invocation pattern

```bash
# scripts/seed.sh (and any future cron wrapper)
export PATH="$HOME/.bun/bin:$PATH"
export GBRAIN_HOME="<absolute brain dir>"
export GBRAIN_ALLOW_SHELL_JOBS=1

# Submit the skill via shell-job, --follow blocks until completion
result=$(gbrain jobs submit shell \
  --params "{\"cmd\":\"bun skills/smb-audit/scripts/smb-audit.mjs\",\"cwd\":\"$REPO_ROOT\"}" \
  --follow 2>&1)

# Parse the Result: JSON line to detect actual skill outcome
# (gbrain's own exit code is always 0 regardless of job outcome)
exit_code=$(echo "$result" | grep -oE '"exit_code":[0-9]+' | head -1 | grep -oE '[0-9]+')

if [ "$exit_code" != "0" ]; then
  echo "[seed] smb-audit skill failed (exit $exit_code)" >&2
  echo "$result" | tail -5 >&2
  exit 1
fi

echo "[seed] smb-audit skill completed cleanly"
```

### Skill source layout (`skills/smb-audit/scripts/smb-audit.mjs`)

```javascript
#!/usr/bin/env bun
// smb-audit gbrain skill — replaces v1.0 scripts/detect-anomalies.ts.
// CRITICAL: always exit 0. Internal errors → concepts/audit-error.md.

import { writeFile } from "node:fs/promises";

async function main() {
  try {
    const findings = await runDetectionRules();
    await writeConceptPages(findings);
    process.exit(0);
  } catch (err) {
    // Don't throw — gbrain Minions will retry the skill 3× on non-zero exit.
    // Write the error trail into the brain instead.
    await writeFile(
      `${process.env.GBRAIN_HOME}/concepts/audit-error.md`,
      `---\ntype: error\nskill: smb-audit\ntimestamp: ${new Date().toISOString()}\n---\n\nSkill failed: ${err.message}\n\n\`\`\`\n${err.stack}\n\`\`\``
    );
    console.error(`[smb-audit] ${err.message}`);
    process.exit(0);  // Yes, exit 0 even on error. Read the requirement above.
  }
}

await main();
```

### The `gbrain jobs submit shell` result shape (verbatim, captured 2026-05-19)

```
[ai.gateway] recipe "google" declares an embedding touchpoint without max_batch_tokens; recursion is the only safety net for batch caps.
Job #1 submitted (shell). Executing inline...
[minion worker] shell handler enabled (GBRAIN_ALLOW_SHELL_JOBS=1)
[minion worker] subagent handlers enabled
Minion worker stopped.
Job #1 completed in 0.2s
Result: {"pid":37786,"exit_code":0,"duration_ms":11,"stderr_tail":"","stdout_tail":"hello from minion\n"}
```

The last `Result: {...}` line is the JSON payload your harness must parse for actual outcome. Fields:
- `pid` — the spawned subprocess PID
- `exit_code` — what your skill actually returned (this is what your harness checks)
- `duration_ms` — wall-clock of the job, not of the gbrain wrapper
- `stderr_tail` — captured stderr (entire stream despite "tail" naming, at least for short outputs)
- `stdout_tail` — captured stdout (same caveat)

### Verbatim retry behavior on non-zero exit

```
Job 3 (shell) failed, retrying in 923ms (attempt 1/3)
Job 3 (shell) failed, retrying in 2054ms (attempt 2/3)
Job 3 (shell) permanently failed: exit 42:
```

That's why the always-exit-0 rule exists. Don't make your harness fight this.

### Latency budget for Phase 4

- gbrain overhead per invocation: ~300ms (worker boot + teardown)
- Skill execution wall-clock: dominates total time
- For Phase 4 smb-audit running once per `scripts/seed.sh`: trivial overhead
- For a hypothetical high-frequency per-request use: the 300ms baseline would matter; not applicable here

## What to Avoid

- **Do NOT throw exceptions out of the skill's top-level handler.** Wrap everything in try/catch and write `concepts/<skill>-error.md` on failure. Exception → exit 1 → 3-attempt retry → 7s wasted → confusing partial state.
- **Do NOT rely on `gbrain jobs submit --follow`'s own exit code.** It's 0 even when the job died. Parse the `Result:` JSON.
- **Do NOT invoke `gbrain` without `bun` in PATH.** It will fail with a cryptic `env: bun: No such file or directory` deep in gbrain's internals.
- **Do NOT use `gbrain jobs work`** (the daemon variant) for v1.x. It's documented as Postgres-only and we're on PGLite. `--follow` is the supported path.
- **Do NOT expect MinionWorker daemon behavior** for skills — the `--follow` path runs the worker inline, starts and stops it for each job. Per-job worker spawn is part of the latency baseline.
- **Do NOT log non-essential chatter to stderr** thinking it'll be invisible. The `Result:` JSON's `stderr_tail` field captures *everything* — your "debug" stderr will appear in the seed-pipeline log. Keep stderr for actual errors; use stdout for status.

## Constraints

| Axis | Value |
|---|---|
| gbrain version tested | 0.35.1.0 (installed via `git clone + bun install && bun link`) |
| Backend | PGLite (`<GBRAIN_HOME>/.gbrain/brain.pglite`) |
| Worker model | Inline via `--follow`; no separate `jobs work` daemon |
| Retry policy | 3 attempts on non-zero exit; ~1s/2s/4s backoff. Not configurable via CLI flag. |
| Latency overhead | ~300ms per invocation (worker boot+teardown) |
| Output capture | Both stdout and stderr captured into `Result:` JSON; appears to be full streams for short outputs |
| Required env vars | `GBRAIN_ALLOW_SHELL_JOBS=1` to enable shell-job handler |
| Required PATH entries | `$HOME/.bun/bin` (bun is the worker's runtime) |
| Skill registration | `skills/<name>/SKILL.md` manifest + invocation via `gbrain jobs submit shell --follow` running the skill script directly |

## Phase 4 Impact

The Phase 4 precondition spike documented in `04-01-PLAN.md` is now empirically resolved. Before executing Phase 4, three small edits should land:

1. **`04-01-PLAN.md`** — replace the "30-min spike" precondition task with a 5-min "verify env" task (run `scripts/demo-check.sh` after the new PATH export, confirm `gbrain --version` works). The actual spike work is done.
2. **`04-03-PLAN.md`** — `scripts/seed.sh` integration must parse the `Result:` JSON exit_code, not rely on `gbrain jobs submit`'s own exit code. Update the verification command + acceptance criteria.
3. **`04-04-PLAN.md`** — cleanup task should include updating `scripts/demo-check.sh` to verify `bun` is on PATH.

The smb-audit skill source itself should include the try/catch + write-error-page + exit-0 pattern from the code snippet above.

## Origin

Synthesized from spike: **003-minions-over-pglite** (verdict: VALIDATED ✓)
Source files available in: `sources/003-minions-over-pglite/README.md` — includes verbatim CLI output from three test runs (happy path, stderr+sleep, non-zero exit).
