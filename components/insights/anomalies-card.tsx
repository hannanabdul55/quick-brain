"use client"

import * as React from "react"
import type { AnomalyRow } from "@/lib/insights/types"
import { InsightCard, type InsightCardState } from "./insight-card"

export interface AnomaliesCardProps {
  state:
    | { kind: "loading" }
    | { kind: "data"; rows: AnomalyRow[] }
    | { kind: "error"; message: string; onRetry: () => void }
}

export function AnomaliesCard({ state }: AnomaliesCardProps) {
  let cardState: InsightCardState

  if (state.kind === "loading") {
    cardState = { kind: "loading" }
  } else if (state.kind === "error") {
    cardState = { kind: "error", message: state.message, onRetry: state.onRetry }
  } else {
    const node = (
      <ul className="space-y-3 text-sm">
        {state.rows.map((row, i) => (
          <li key={`${row.vendorSlug}-${i}`}>
            <div className="font-medium">
              {row.vendorSlug} — ${row.dollarImpact.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className="text-muted-foreground text-xs">{row.description}</div>
            <a
              className="text-xs underline"
              href={`/source?path=${encodeURIComponent(row.sourcePath)}`}
            >
              View source →
            </a>
          </li>
        ))}
      </ul>
    )
    cardState = { kind: "data", node }
  }

  return (
    <InsightCard
      title="Anomalies flagged"
      label="from skill: recurring-charges"
      state={cardState}
    />
  )
}
