"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/onboard/error-banner";
import { useJobStatus } from "@/lib/jobs/use-job-status";
import { cn } from "@/lib/utils";
import type { StageItem } from "@/components/onboard/onboarding-progress";

// ---------------------------------------------------------------------------
// Re-export StageItem so consumers don't need to import from onboard
// ---------------------------------------------------------------------------
export type { StageItem };

// ---------------------------------------------------------------------------
// Locked stage list for onboarding/import — matches OnboardingProgress
// ---------------------------------------------------------------------------
const DEFAULT_STAGES: StageItem[] = [
  { id: "creating-brain", label: "Creating your brain" },
  { id: "reading-invoices", label: "Reading your invoices and emails" },
  { id: "building-graph", label: "Building the knowledge graph" },
  { id: "indexing", label: "Indexing for search" },
  { id: "ready", label: "Ready" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface JobProgressProps {
  jobId: string;
  /** Stage list for the stage-checklist — defaults to the onboarding/import five */
  allStages?: StageItem[];
  /** Called when the user clicks "View results" in the done state */
  onViewResults?: () => void;
  /** Optional: override the card title shown in the running/queued state */
  title?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
/**
 * JobProgress — polled job-progress client component.
 *
 * Renders the full lifecycle of a background job (queued, running,
 * slow-but-healthy, done, error, poll give-up) via the useJobStatus hook.
 *
 * Visually identical to OnboardingProgress (same 8px bar, same stage-checklist
 * tri-state, same color contract) so polling progress and SSE progress are
 * indistinguishable to the user (UI-SPEC coexistence rule / D-02).
 *
 * Security: no raw job IDs, stack traces, or "Inngest"/"serverless"/"timeout"
 * in the happy path (T-05-14). Error state shows only the sanitized server
 * error string as a secondary muted line.
 */
export function JobProgress({
  jobId,
  allStages = DEFAULT_STAGES,
  onViewResults,
  title,
}: JobProgressProps) {
  const { status, progress, stage, error, pollState, isSlow, restart } =
    useJobStatus(jobId);

  // ---------------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------------
  const percent =
    status === "done" ? 100 : typeof progress === "number" ? progress : 0;

  // Find the current stage index for the checklist tri-state
  const currentStageIndex = (() => {
    if (status === "done") return allStages.length; // all done
    if (!stage) return 0;
    const idx = allStages.findIndex((s) => s.id === stage);
    return idx === -1 ? 0 : idx;
  })();

  // The card title shown during active states
  const activeTitle =
    title ??
    (stage
      ? (allStages.find((s) => s.id === stage)?.label ?? "Working on it…")
      : status === "done"
        ? "Ready"
        : "Getting things ready…");

  // ---------------------------------------------------------------------------
  // Render: error state
  // ---------------------------------------------------------------------------
  if (status === "error") {
    return (
      <div role="status" aria-live="polite">
        <ErrorBanner
          message="Something went wrong while we were setting things up."
          onRetry={restart}
        />
        {error && (
          <p className="mt-2 text-xs text-muted-foreground">{error}</p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: poll give-up (timed-out) state
  // ---------------------------------------------------------------------------
  if (pollState === "timed-out") {
    return (
      <Card role="status" aria-live="polite">
        <CardContent className="space-y-4 pt-6">
          <p className="text-sm font-medium text-foreground">
            This is taking longer than expected.
          </p>
          <p className="text-sm text-muted-foreground">
            It may still be finishing in the background.
          </p>
          <Button variant="outline" onClick={restart}>
            Check again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: done state
  // ---------------------------------------------------------------------------
  if (status === "done") {
    return (
      <Card role="status" aria-live="polite">
        <CardHeader>
          <CardTitle className="text-green-600">Ready</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 100% progress bar */}
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
            role="progressbar"
            aria-valuenow={100}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-neutral-900 transition-all duration-500"
              style={{ width: "100%" }}
            />
          </div>

          {/* All-green stage checklist */}
          <ul className="space-y-2">
            {allStages.map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-sm text-foreground">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <span className="text-green-600 font-bold">&#10003;</span>
                </span>
                {s.label}
              </li>
            ))}
          </ul>

          {onViewResults && (
            <Button onClick={onViewResults} className="w-full">
              View results
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  // ---------------------------------------------------------------------------
  // Render: queued / running / slow-but-healthy states
  // ---------------------------------------------------------------------------
  const isQueued = status === "queued" || status === null;
  const isRunning = status === "running";

  const badgeLabel = isSlow ? "Still working" : isQueued ? "Queued" : "Running";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{activeTitle}</CardTitle>
          <Badge variant="secondary">{badgeLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar — 8px track, matches OnboardingProgress verbatim */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-neutral-900 transition-all duration-500"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Percentage caption — tabular-nums, only when progress is available */}
        {typeof progress === "number" && isRunning && (
          <p className="text-sm font-medium tabular-nums text-foreground">
            {progress}% complete
          </p>
        )}

        {/* Queued helper line */}
        {isQueued && (
          <p className="text-sm text-muted-foreground">
            Getting things ready…
          </p>
        )}

        {/* Slow-but-healthy reassurance — neutral, never red */}
        {isSlow && (
          <p className="text-sm text-muted-foreground">
            This is taking a little longer than usual — your data is safe and
            we&apos;re still on it.
          </p>
        )}

        {/* Stage checklist — tri-state: isDone / isCurrent / isPending */}
        <ul className="space-y-2">
          {allStages.map((s, index) => {
            const isDone = index < currentStageIndex;
            const isCurrent = index === currentStageIndex && isRunning;
            const isPending = !isDone && !isCurrent;

            return (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  isDone && "text-foreground",
                  isCurrent && "font-medium text-foreground",
                  isPending && "text-muted-foreground",
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isDone && (
                    <span className="text-green-600 font-bold">&#10003;</span>
                  )}
                  {isCurrent && (
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-900" aria-hidden="true" />
                  )}
                  {isPending && (
                    <span className="h-2 w-2 rounded-full bg-neutral-300 block" />
                  )}
                </span>
                {s.label}
              </li>
            );
          })}
        </ul>

        {/* aria-live region: announces stage transitions and terminal states */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {isQueued && "Getting things ready…"}
          {isRunning && stage && `${allStages.find((s) => s.id === stage)?.label ?? stage}${typeof progress === "number" ? `, ${progress}% complete` : ""}`}
          {isSlow && "This is taking a little longer than usual — your data is safe and we're still on it."}
        </div>
      </CardContent>
    </Card>
  );
}
