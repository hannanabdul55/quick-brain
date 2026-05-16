import { spawnGBrain } from "./client.ts";
import { FIXTURES_ROOT } from "./paths.ts";

export type Phase = "init" | "config" | "import" | "embed" | "warmup" | "done";

export type ProgressEvent =
  | { kind: "phase"; phase: Phase; message: string }
  | { kind: "log"; phase: Phase; line: string }
  | { kind: "error"; phase: Phase; message: string };

export type OnboardOpts = {
  tenantId: string;
  fixturesDir?: string;
  onEvent?: (e: ProgressEvent) => void;
  warmupQuery?: string;
};

// Phase 1 of the brain spine: init → config → import → embed.
// Used by both scripts/seed.sh (seed tenant) and the Next.js onboarding
// SSE route (per-tenant). Each gbrain step is its own spawn so progress
// is visible and failures are scoped.
export async function onboard(opts: OnboardOpts): Promise<void> {
  const { tenantId } = opts;
  const fixtures = opts.fixturesDir ?? FIXTURES_ROOT;
  const emit = opts.onEvent ?? (() => {});

  const step = async (phase: Phase, message: string, args: string[], timeoutMs: number) => {
    emit({ kind: "phase", phase, message });
    const r = await spawnGBrain(args, {
      tenantId,
      timeoutMs,
      onStdoutLine: (line) => line && emit({ kind: "log", phase, line }),
      onStderrLine: (line) => line && emit({ kind: "log", phase, line }),
    });
    if (r.code !== 0) {
      const err = `gbrain ${args[0]} exited ${r.code}: ${r.stderr.trim() || "(no stderr)"}`;
      emit({ kind: "error", phase, message: err });
      throw new Error(err);
    }
  };

  await step("init", "Creating your brain", ["init", "--yes"], 30_000);
  await step("config", "Configuring models", ["config", "set", "models.default", "sonnet"], 10_000);
  await step("import", "Reading invoices and emails", ["import", fixtures, "--no-embed"], 120_000);
  await step("embed", "Indexing for search", ["embed", "--stale"], 180_000);

  if (opts.warmupQuery) {
    emit({ kind: "phase", phase: "warmup", message: "Warming up" });
    const r = await spawnGBrain(["query", opts.warmupQuery], { tenantId, timeoutMs: 30_000 });
    if (r.code !== 0) {
      // Don't hard-fail onboarding on warmup miss — brain is usable without it.
      emit({
        kind: "log",
        phase: "warmup",
        line: `warmup query non-zero exit ${r.code} — continuing`,
      });
    }
  }

  emit({ kind: "phase", phase: "done", message: "Ready" });
}
