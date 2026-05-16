"use client"

import * as React from "react"
import type { TopVendorRow } from "@/lib/insights/types"
import { InsightCard, type InsightCardState } from "./insight-card"

export interface TopVendorsCardProps {
  state:
    | { kind: "loading" }
    | { kind: "data"; rows: TopVendorRow[] }
    | { kind: "error"; message: string; onRetry: () => void }
}

export function TopVendorsCard({ state }: TopVendorsCardProps) {
  let cardState: InsightCardState

  if (state.kind === "loading") {
    cardState = { kind: "loading" }
  } else if (state.kind === "error") {
    cardState = { kind: "error", message: state.message, onRetry: state.onRetry }
  } else {
    const node = (
      <ul className="space-y-1 text-sm">
        {state.rows.map((row) => (
          <li key={row.vendor}>
            <span className="font-medium">{row.vendor}</span>{" "}
            <span className="text-muted-foreground">
              {`($${row.total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, ${row.invoiceCount} invoices)`}
            </span>
          </li>
        ))}
      </ul>
    )
    cardState = { kind: "data", node }
  }

  return (
    <InsightCard
      title="Top 5 vendors this quarter"
      label="from graph"
      state={cardState}
    />
  )
}
