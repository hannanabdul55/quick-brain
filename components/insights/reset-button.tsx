"use client"

import * as React from "react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

export interface ResetButtonProps {
  tenantId: string
  onResetComplete?: () => void
}

/**
 * Press-and-hold Reset button (2-second sustained hold required to fire).
 *
 * UX:
 * - Pointer-down starts a requestAnimationFrame loop that fills progress 0→1 over 2000ms.
 * - Releasing early (pointer-up / pointer-leave / pointer-cancel) aborts with no API call.
 * - When progress reaches 1 the reset endpoint is called automatically.
 * - During the hold, a translucent white overlay fills left-to-right as visual feedback.
 * - After a successful reset, router.refresh() reloads the dashboard server component.
 *
 * Uses pointer capture so a drag off the button while holding does NOT cancel the hold
 * (pointer-leave fires but we check whether the hold already completed before aborting).
 */
export function ResetButton({ tenantId, onResetComplete }: ResetButtonProps) {
  const router = useRouter()

  const [holding, setHolding] = React.useState(false)
  const [progress, setProgress] = React.useState(0)
  const [resetting, setResetting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Refs to avoid stale closures in the RAF loop.
  const pointerDownAt = React.useRef<number | null>(null)
  const rafRef = React.useRef<number | null>(null)
  // Track whether we've already fired reset for this hold cycle.
  const firedRef = React.useRef(false)

  // Cancel any running RAF tick.
  function cancelRaf() {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }

  // Reset all hold-state back to idle.
  function resetHoldState() {
    cancelRaf()
    setHolding(false)
    setProgress(0)
    pointerDownAt.current = null
    firedRef.current = false
  }

  async function fireReset() {
    setResetting(true)
    setError(null)
    try {
      const res = await fetch(`/api/tenants/${tenantId}/reset`, { method: "POST" })
      if (!res.ok) {
        let msg = "Reset failed"
        try {
          const body = (await res.json()) as Record<string, unknown>
          if (typeof body.error === "string") msg = `Reset failed: ${body.error}`
        } catch {
          // ignore JSON parse failure — use default msg
        }
        console.error("[ResetButton] reset endpoint error", res.status, res.statusText)
        setError(msg)
        resetHoldState()
        setResetting(false)
        return
      }
      // Success path
      onResetComplete?.()
      router.refresh()
    } catch (err: unknown) {
      console.error("[ResetButton] fetch failed", err)
      setError("Reset failed: network error")
      resetHoldState()
    } finally {
      setResetting(false)
    }
  }

  // RAF tick — runs on every animation frame while holding.
  function tick() {
    if (pointerDownAt.current === null) return
    const elapsed = Date.now() - pointerDownAt.current
    const p = Math.min(1, elapsed / 2000)
    setProgress(p)
    if (p >= 1) {
      cancelRaf()
      if (!firedRef.current) {
        firedRef.current = true
        setHolding(false)
        void fireReset()
      }
      return
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLButtonElement>) {
    if (resetting) return
    // Capture pointer so drag-off does not lose tracking.
    e.currentTarget.setPointerCapture(e.pointerId)
    pointerDownAt.current = Date.now()
    firedRef.current = false
    setHolding(true)
    setError(null)
    setProgress(0)
    rafRef.current = requestAnimationFrame(tick)
  }

  function handlePointerUp() {
    // If progress < 1, the user released early — abort without firing.
    if (!firedRef.current) {
      resetHoldState()
    }
  }

  function handlePointerLeave() {
    // Pointer leave fires even with capture when the button is disabled or
    // when some browsers release capture early. Treat same as pointer-up.
    if (!firedRef.current) {
      resetHoldState()
    }
  }

  function handlePointerCancel() {
    if (!firedRef.current) {
      resetHoldState()
    }
  }

  // Clean up RAF on unmount.
  React.useEffect(() => {
    return () => cancelRaf()
  }, [])

  const label = resetting ? "Resetting…" : holding ? "Hold to reset…" : "Reset"

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="destructive"
        size="sm"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        disabled={resetting}
        style={{ position: "relative", overflow: "hidden", userSelect: "none" }}
      >
        {/* Progress fill overlay — grows left-to-right over the 2s hold */}
        <span
          style={{
            position: "absolute",
            inset: 0,
            width: `${progress * 100}%`,
            background: "rgba(255,255,255,0.25)",
            transition: "width 16ms linear",
            pointerEvents: "none",
          }}
        />
        {/* Button label above the overlay */}
        <span style={{ position: "relative" }}>{label}</span>
      </Button>
      {error && (
        <div className="text-xs text-destructive mt-0.5">{error}</div>
      )}
    </div>
  )
}
