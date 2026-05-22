/**
 * Onboarding orchestrator — 5-stage narrated SSE stream.
 *
 * Drives the 30–45s "theater" that plays while the client waits for its
 * dashboard. Timeline (locked in CONTEXT.md):
 *
 *   Stage 1: creating-brain     (5s)  — brain was already copied in POST /api/tenants
 *   Stage 2: reading-invoices   (12s) — paced progress text only
 *   Stage 3: building-graph     (10s) — parallel-launches gbrain query --no-expand warm-up
 *   Stage 4: indexing           (8s)  — awaits warm-up (ceiling 8s) — never fails stream
 *   Stage 5: ready              (1s)  — emits done
 *
 * Total: ~36s (within 30–45s budget per ONBD-07).
 *
 * Satisfies: ONBD-04, ONBD-05, ONBD-07.
 *
 * This module has ZERO Next.js imports — it is testable in isolation via
 * the `emit` callback pattern.
 */

import { spawnGBrain } from "@/lib/gbrain/client";
import * as tenants from "@/lib/gbrain/tenants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OnboardingStage =
  | "creating-brain"
  | "reading-invoices"
  | "building-graph"
  | "indexing"
  | "ready";

export type OnboardingEvent =
  | {
      type: "stage";
      stage: OnboardingStage;
      label: string;
      progress: number;
    }
  | {
      type: "done";
      tenantId: string;
    }
  | {
      type: "error";
      stage: OnboardingStage | "init";
      message: string;
    };

// ---------------------------------------------------------------------------
// Stage definitions
// ---------------------------------------------------------------------------

type StageDefinition = {
  stage: OnboardingStage;
  label: string;
  /** Wall-clock duration in milliseconds (full-speed). */
  durationMs: number;
  /** Number of intermediate progress ticks to emit within this stage. */
  ticks: number;
};

const STAGE_DEFS: StageDefinition[] = [
  {
    stage: "creating-brain",
    label: "Creating your brain",
    durationMs: 5_000,
    ticks: 4,
  },
  {
    stage: "reading-invoices",
    label: "Reading your invoices and emails",
    durationMs: 12_000,
    ticks: 5,
  },
  {
    stage: "building-graph",
    label: "Building the knowledge graph",
    durationMs: 10_000,
    ticks: 4,
  },
  {
    stage: "indexing",
    label: "Indexing for search",
    durationMs: 8_000,
    ticks: 4,
  },
  {
    stage: "ready",
    label: "Ready",
    durationMs: 1_000,
    ticks: 0,
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type RunOnboardingOptions = {
  /**
   * When true, all stage durations are multiplied by 0.05 (5%) so the
   * entire flow completes in <5s. Useful for automated tests.
   */
  fastMode?: boolean;
};

/**
 * Drives the 5-stage onboarding timeline and calls `emit` for every event.
 *
 * @param tenantId  - Must already exist in the tenants registry.
 * @param emit      - Callback receiving typed OnboardingEvent objects.
 * @param options   - Pass `{ fastMode: true }` to collapse durations for tests.
 */
export async function runOnboarding(
  tenantId: string,
  emit: (event: OnboardingEvent) => void,
  options?: RunOnboardingOptions,
): Promise<void> {
  // ------------------------------------------------------------------
  // 0. Verify the tenant exists (Postgres-backed registry)
  // ------------------------------------------------------------------
  const tenant = await tenants.getBySlug(tenantId);
  if (!tenant) {
    emit({ type: "error", stage: "init", message: "tenant not found" });
    return;
  }

  const multiplier = options?.fastMode ? 0.05 : 1;

  // ------------------------------------------------------------------
  // Warm-up promise — populated during building-graph, awaited at indexing
  // ------------------------------------------------------------------
  type WarmupResult = { code: number; stdout: string; stderr: string };
  let warmupPromise: Promise<WarmupResult> | null = null;

  // ------------------------------------------------------------------
  // Stage loop
  // ------------------------------------------------------------------
  let currentStage: OnboardingStage = "creating-brain";

  try {
    for (const def of STAGE_DEFS) {
      currentStage = def.stage;
      const stageDuration = def.durationMs * multiplier;

      // Emit stage start (progress = 0)
      emit({ type: "stage", stage: def.stage, label: def.label, progress: 0 });

      // ----------------------------------------------------------------
      // Stage-specific side effects BEFORE ticking
      // ----------------------------------------------------------------
      if (def.stage === "building-graph") {
        // ONBD-05: Fire-and-do-NOT-await the warm-up query.
        // --no-expand avoids the 3-minute Anthropic expansion path (Phase 1 #4 retest).
        // spawnGBrain routes through the per-tenant mutex — no double-wrap needed.
        warmupPromise = spawnGBrain(
          ["query", "Top vendors by total spend?", "--no-expand"],
          { tenantId, timeoutMs: 25_000 },
        ).catch((err: unknown) => ({
          code: -1,
          stdout: "",
          stderr: String(err),
        }));
      }

      if (def.stage === "indexing" && warmupPromise !== null) {
        // Await warm-up with a hard 8s ceiling. Never fail the stream.
        const warmupCeiling = new Promise<WarmupResult>((resolve) =>
          setTimeout(
            () => resolve({ code: -2, stdout: "", stderr: "warmup-timed-out-after-stage" }),
            Math.max(8_000 * multiplier, 100),
          ),
        );
        const result = await Promise.race([warmupPromise, warmupCeiling]);
        console.log("[onboard.warmup]", {
          code: result.code,
          stderrSnippet: result.stderr.slice(0, 200),
        });
        // Result is intentionally discarded — warm-up purpose was cache seeding only.
      }

      // ----------------------------------------------------------------
      // Progress ticks within this stage
      // ----------------------------------------------------------------
      if (def.ticks > 0 && stageDuration > 0) {
        const tickInterval = stageDuration / (def.ticks + 1);
        for (let i = 1; i <= def.ticks; i++) {
          await sleep(tickInterval);
          const progress = i / (def.ticks + 1);
          emit({ type: "stage", stage: def.stage, label: def.label, progress });
        }
        // Wait for the remainder of the stage duration
        await sleep(tickInterval);
      } else {
        await sleep(stageDuration > 0 ? stageDuration : 1);
      }

      // Emit progress = 1 at end of stage
      emit({ type: "stage", stage: def.stage, label: def.label, progress: 1 });
    }

    // ------------------------------------------------------------------
    // All stages complete — emit done
    // ------------------------------------------------------------------
    emit({ type: "done", tenantId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emit({ type: "error", stage: currentStage, message });
  }
}
