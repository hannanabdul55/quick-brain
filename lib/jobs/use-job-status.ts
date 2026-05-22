"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobStatus } from "@/lib/jobs/types";

// ---------------------------------------------------------------------------
// Poll configuration
// ---------------------------------------------------------------------------
/** Interval between poll ticks in milliseconds */
const POLL_INTERVAL_MS = 2000;
/** Maximum poll attempts before giving up (~5 minutes) */
const MAX_POLL_ATTEMPTS = 150;
/** After this many ms without a stage change, surface "slow-but-healthy" state */
const SLOW_THRESHOLD_MS = 20_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type PollState = "idle" | "polling" | "stopped" | "timed-out";

export interface JobStatusResponse {
  status: JobStatus;
  /** 0..100 integer */
  progress: number | null;
  stage: string | null;
  result?: unknown;
  error?: string;
}

export interface UseJobStatusResult {
  status: JobStatus | null;
  /** 0..100 integer or null */
  progress: number | null;
  stage: string | null;
  result: unknown;
  error: string | null;
  pollState: PollState;
  /** True when the job has been running for >SLOW_THRESHOLD_MS with no stage change */
  isSlow: boolean;
  /** Re-arm the poll loop — drives the "Check again" action after timed-out */
  restart: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
/**
 * useJobStatus — bounded poll hook against GET /api/jobs/[id].
 *
 * - Starts polling when jobId is non-null.
 * - Stops on: status==="done", status==="error", max-attempts cap.
 * - Hitting the cap with the job still running surfaces pollState==="timed-out"
 *   (neutral give-up — the job may still be running server-side).
 * - Clears the interval on unmount and on every terminal state.
 * - Exposes restart() to re-arm the loop (drives the "Check again" CTA).
 */
export function useJobStatus(jobId: string | null): UseJobStatusResult {
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pollState, setPollState] = useState<PollState>("idle");
  const [isSlow, setIsSlow] = useState(false);

  // Refs for the interval handle and attempt counter — not state because
  // mutations must not trigger re-renders
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const lastStageRef = useRef<string | null>(null);
  const lastStageTimeRef = useRef<number>(Date.now());

  const clearPollInterval = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (id: string) => {
      attemptsRef.current = 0;
      lastStageRef.current = null;
      lastStageTimeRef.current = Date.now();
      setIsSlow(false);
      setPollState("polling");

      intervalRef.current = setInterval(() => {
        attemptsRef.current += 1;

        // Max-attempts cap — soft timeout, NOT an error
        if (attemptsRef.current > MAX_POLL_ATTEMPTS) {
          clearPollInterval();
          setPollState("timed-out");
          return;
        }

        fetch(`/api/jobs/${id}`)
          .then((res) => {
            if (!res.ok) {
              // 404 means the job ID is unknown — treat as terminal error
              if (res.status === 404) {
                clearPollInterval();
                setError("Job not found.");
                setStatus("error");
                setPollState("stopped");
              }
              // Other non-ok responses: keep polling (transient network blip)
              return null;
            }
            return res.json() as Promise<JobStatusResponse>;
          })
          .then((data) => {
            if (!data) return;

            setStatus(data.status);
            setProgress(data.progress ?? null);
            setStage(data.stage ?? null);

            // Track stage change for slow-but-healthy detection
            if (data.stage !== lastStageRef.current) {
              lastStageRef.current = data.stage;
              lastStageTimeRef.current = Date.now();
              setIsSlow(false);
            } else {
              const elapsed = Date.now() - lastStageTimeRef.current;
              if (
                elapsed >= SLOW_THRESHOLD_MS &&
                data.status === "running"
              ) {
                setIsSlow(true);
              }
            }

            if (data.status === "done") {
              setResult(data.result ?? null);
              clearPollInterval();
              setPollState("stopped");
            } else if (data.status === "error") {
              setError(data.error ?? null);
              clearPollInterval();
              setPollState("stopped");
            }
          })
          .catch(() => {
            // Network error — keep polling until cap
          });
      }, POLL_INTERVAL_MS);
    },
    [clearPollInterval],
  );

  // Arm / re-arm on jobId change
  useEffect(() => {
    if (!jobId) {
      clearPollInterval();
      setPollState("idle");
      return;
    }

    // Reset state for the new job
    setStatus(null);
    setProgress(null);
    setStage(null);
    setResult(undefined);
    setError(null);
    setIsSlow(false);
    clearPollInterval();
    startPolling(jobId);

    return () => {
      clearPollInterval();
    };
  }, [jobId, clearPollInterval, startPolling]);

  // restart() — re-arms the loop (used after timed-out "Check again" action)
  const restart = useCallback(() => {
    if (!jobId) return;
    clearPollInterval();
    setError(null);
    setIsSlow(false);
    startPolling(jobId);
  }, [jobId, clearPollInterval, startPolling]);

  return {
    status,
    progress,
    stage,
    result,
    error,
    pollState,
    isSlow,
    restart,
  };
}
