import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { brainHome } from "./paths.ts";
import { assertTenantSlug } from "./slug.ts";
import { withTenantLock } from "./mutex.ts";

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

// Convenience for query — returns stdout text or throws on non-zero.
export async function query(
  tenantId: string,
  question: string,
  opts: Partial<SpawnGBrainOpts> = {},
): Promise<string> {
  const r = await spawnGBrain(["query", question], {
    timeoutMs: 30_000,
    ...opts,
    tenantId,
  });
  if (r.code !== 0) {
    throw new Error(
      `gbrain query exited ${r.code} (tenant=${tenantId}): ${r.stderr.trim() || "(no stderr)"}`,
    );
  }
  return r.stdout.trim();
}
