import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { brainHome } from "./paths.ts";
import { assertTenantSlug } from "./slug.ts";
import { withTenantLock } from "./mutex.ts";
import { createGBrainEngine, queryInProcess } from "./engine.ts";
import { runThink } from "@/types/gbrain";

export type SpawnGBrainOpts = {
  tenantId: string;
  cwd?: string;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
};

export type GBrainResult = {
  code: number;
  stdout: string;
  stderr: string;
};

// SCOPE NOTE: spawnGBrain is retained for the
// onboarding provisioning path (init/import/embed/config). The query and think
// paths are in-process as of Phase 3. Phase 6 will remove this spawn surface
// when per-tenant Postgres provisioning replaces gbrain init.
//
// HARN-03: spawn helper. Always sets GBRAIN_HOME to ./brains/<tenantId>/,
// inherits OPENAI_API_KEY + ANTHROPIC_API_KEY from process.env, runs
// non-interactively (stdin ignored, CI=1).
//
// All invocations route through the per-tenant mutex (HARN-04) so PGLite
// never sees concurrent writers.
export function spawnGBrain(args: string[], opts: SpawnGBrainOpts): Promise<GBrainResult> {
  const tenantId = assertTenantSlug(opts.tenantId);
  return withTenantLock(tenantId, () => runOnce(args, { ...opts, tenantId }));
}

async function runOnce(args: string[], opts: SpawnGBrainOpts): Promise<GBrainResult> {
  const home = brainHome(opts.tenantId);
  await mkdir(home, { recursive: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GBRAIN_HOME: home,
    CI: "1",
    // INFRA-02: route runtime gbrain queries through the Supavisor pooler
    // (port 6543). gbrain's db.ts auto-detects port 6543 → prepare:false.
    // GBRAIN_DATABASE_URL from process.env is inherited via ...process.env
    // above — but we make it explicit here so it is always set even if
    // process.env is missing it (defensive coding). If SUPABASE_DB_URL_POOLER
    // is unset, fall back to whatever process.env.GBRAIN_DATABASE_URL provides.
    ...(process.env.SUPABASE_DB_URL_POOLER
      ? { GBRAIN_DATABASE_URL: process.env.SUPABASE_DB_URL_POOLER }
      : {}),
  };

  const child = spawn("gbrain", args, {
    cwd: opts.cwd ?? home,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const stdoutBuf: string[] = [];
  const stderrBuf: string[] = [];

  const handleLines = (
    chunk: Buffer,
    buf: string[],
    sink: (s: string) => void,
    cb?: (line: string) => void,
  ) => {
    const text = chunk.toString("utf8");
    sink(text);
    if (!cb) return;
    buf.push(text);
    let joined = buf.join("");
    let idx: number;
    while ((idx = joined.indexOf("\n")) >= 0) {
      const line = joined.slice(0, idx);
      cb(line);
      joined = joined.slice(idx + 1);
    }
    buf.length = 0;
    if (joined) buf.push(joined);
  };

  child.stdout.on("data", (c) =>
    handleLines(c, stdoutBuf, (t) => (stdout += t), opts.onStdoutLine),
  );
  child.stderr.on("data", (c) =>
    handleLines(c, stderrBuf, (t) => (stderr += t), opts.onStderrLine),
  );

  return await new Promise<GBrainResult>((resolveResult, rejectResult) => {
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        settle(() =>
          rejectResult(
            new Error(
              `gbrain ${args[0] ?? ""} timed out after ${opts.timeoutMs}ms (tenant=${opts.tenantId})`,
            ),
          ),
        );
      }, opts.timeoutMs);
    }

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? " — is the `gbrain` CLI on PATH? See README install steps."
          : "";
      settle(() => rejectResult(new Error(`Failed to spawn gbrain: ${err.message}${hint}`)));
    });

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      // Flush any trailing partial lines so callers see them.
      if (opts.onStdoutLine && stdoutBuf.length) opts.onStdoutLine(stdoutBuf.join(""));
      if (opts.onStderrLine && stderrBuf.length) opts.onStderrLine(stderrBuf.join(""));
      settle(() => resolveResult({ code: code ?? -1, stdout, stderr }));
    });
  });
}

/**
 * query — in-process hybrid search via the engine pool (INPROC-02).
 *
 * Replaces the old spawn("gbrain", ["query", ...]) path. Delegates to
 * queryInProcess which runs the full multi-query expansion + RRF fusion
 * pipeline without a child process.
 *
 * The opts.noExpand flag mirrors the CLI's --no-expand (used by the onboarding
 * warm-up path in orchestrator.ts, ONBD-05).
 *
 * NOTE: timeoutMs from SpawnGBrainOpts is NOT forwarded — there is no subprocess
 * to kill. If a request timeout is needed, wire it via AbortController in the
 * Route Handler (Phase 5 concern).
 */
export async function query(
  tenantId: string,
  question: string,
  opts?: Partial<SpawnGBrainOpts> & { noExpand?: boolean },
): Promise<string> {
  return withTenantLock(tenantId, async () => {
    const results = await queryInProcess(tenantId, question, {
      noExpand: opts?.noExpand ?? false,
    });
    if (results.length === 0) return "No results.\n";
    return (
      results
        .map(
          (r) =>
            `[${(r.score ?? 0).toFixed(4)}] ${r.slug} -- ${(r.chunk_text ?? "").slice(0, 100)}`,
        )
        .join("\n") + "\n"
    );
  });
}

/**
 * think — in-process LLM synthesis via gbrain/core/think (INPROC-04).
 *
 * Replaces the old spawn("gbrain", ["think", "--model", model]) path.
 * Uses createGBrainEngine to ensure the AI gateway is initialized (configureGateway
 * was called) before runThink attempts Anthropic API calls.
 *
 * Returns GBrainResult so the chat route works unchanged:
 *   code: 0  — success, stdout = answer text, stderr = warnings (if any)
 *   code: 1  — error, stdout = "", stderr = error message
 *
 * Why --model haiku?
 *   gbrain think defaults to Opus (tier: 'deep') which hangs minute-scale on
 *   demo-class queries. haiku produces a clean answer in ~30s. (CHAT-06 / CONTEXT.md)
 *
 * SYSTEM PROMPT NOTE (Phase 3 gap):
 *   The CLI's think path previously accepted --system-prompt via buildThinkArgs.
 *   RunThinkOpts in v0.28 has no systemPrompt field, so the system-prompt is not
 *   forwarded in-process. The QB_GBRAIN_SUPPORTS_SYSTEM_PROMPT env-var gate in
 *   system-prompt.ts means this was already best-effort. buildThinkArgs is retained
 *   in system-prompt.ts for compatibility; Phase 6 cleanup will resolve this.
 *
 * Default model: "haiku". Pass a different value only for research/evaluation.
 */
export async function think(
  tenantId: string,
  question: string,
  opts?: { model?: string; timeoutMs?: number },
): Promise<GBrainResult> {
  const model = opts?.model ?? "haiku";
  // createGBrainEngine ensures configureGateway ran (gateway singleton init).
  // Must happen before withTenantLock because createGBrainEngine itself is
  // safe to call concurrently (pool deduplication via Promise<BrainEngine>).
  const engine = await createGBrainEngine(tenantId);
  return withTenantLock(tenantId, async () => {
    try {
      const result = await runThink(engine, {
        question,
        model,
      });
      return {
        code: 0,
        stdout: result.answer,
        stderr: result.warnings.join("\n"),
      };
    } catch (err: unknown) {
      return {
        code: 1,
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
