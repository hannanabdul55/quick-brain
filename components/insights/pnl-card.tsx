"use client"

import * as React from "react"
import type { PnlSnapshot } from "@/lib/insights/types"
import { InsightCard, type InsightCardState } from "./insight-card"

export interface PnlCardProps {
  state:
    | { kind: "loading" }
    | { kind: "data"; snapshot: PnlSnapshot }
    | { kind: "error"; message: string; onRetry: () => void }
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function formatDelta(n: number): string {
  if (n >= 0) {
    return `+${fmt.format(n)}`
  }
  return `-${fmt.format(Math.abs(n))}`
}

export function PnlCard({ state }: PnlCardProps) {
  let cardState: InsightCardState

  if (state.kind === "loading") {
    cardState = { kind: "loading" }
  } else if (state.kind === "error") {
    cardState = { kind: "error", message: state.message, onRetry: state.onRetry }
  } else {
    const { snapshot } = state
    const node = (
      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Revenue</span>
          <span className="font-medium">{fmt.format(snapshot.revenue)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">COGS</span>
          <span className="font-medium">{fmt.format(snapshot.cogs)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Opex</span>
          <span className="font-medium">{fmt.format(snapshot.opex)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Net</span>
          <span className="font-medium">{fmt.format(snapshot.net)}</span>
        </div>
        {snapshot.prevMonth && (
          <div className="text-xs text-muted-foreground pt-1">
            {`vs ${snapshot.prevMonth.month}: revenue ${formatDelta(snapshot.revenue - snapshot.prevMonth.revenue)}, net ${formatDelta(snapshot.net - snapshot.prevMonth.net)}`}
          </div>
        )}
      </div>
    )
    cardState = { kind: "data", node }
  }

  return (
    <InsightCard
      title="Monthly P&L snapshot"
      label="from timeline"
      state={cardState}
    />
  )
}
