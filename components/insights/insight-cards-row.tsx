"use client"

import * as React from "react"
import type { InsightBundle } from "@/lib/insights/types"
import { TopVendorsCard } from "./top-vendors-card"
import { PnlCard } from "./pnl-card"
import { AnomaliesCard } from "./anomalies-card"
import { ResetButton } from "./reset-button"

type RowState =
  | { kind: "loading" }
  | { kind: "data"; data: InsightBundle }
  | { kind: "error"; message: string }

export interface InsightCardsRowProps {
  tenantId: string
}

export function InsightCardsRow({ tenantId }: InsightCardsRowProps) {
  const [rowState, setRowState] = React.useState<RowState>({ kind: "loading" })
  const [reloadKey, setReloadKey] = React.useState(0)

  React.useEffect(() => {
    setRowState({ kind: "loading" })

    const controller = new AbortController()

    fetch("/api/tenants/" + tenantId + "/insights", {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text()
          console.error("Insights API error:", res.status, text)
          setRowState({ kind: "error", message: "Could not load insights" })
          return
        }
        const bundle = (await res.json()) as InsightBundle
        setRowState({ kind: "data", data: bundle })
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return
        console.error("Insights fetch failed:", err)
        setRowState({ kind: "error", message: "Network error" })
      })

    return () => {
      controller.abort()
    }
  }, [tenantId, reloadKey])

  function handleRetry() {
    setReloadKey((k) => k + 1)
  }

  const topVendorsState =
    rowState.kind === "loading"
      ? { kind: "loading" as const }
      : rowState.kind === "data"
        ? { kind: "data" as const, rows: rowState.data.topVendors }
        : { kind: "error" as const, message: rowState.message, onRetry: handleRetry }

  const pnlState =
    rowState.kind === "loading"
      ? { kind: "loading" as const }
      : rowState.kind === "data"
        ? { kind: "data" as const, snapshot: rowState.data.pnl }
        : { kind: "error" as const, message: rowState.message, onRetry: handleRetry }

  const anomaliesState =
    rowState.kind === "loading"
      ? { kind: "loading" as const }
      : rowState.kind === "data"
        ? { kind: "data" as const, rows: rowState.data.anomalies }
        : { kind: "error" as const, message: rowState.message, onRetry: handleRetry }

  return (
    <div className="max-w-3xl mx-auto py-4 px-4">
      <div className="flex justify-end mb-2">
        <ResetButton
          tenantId={tenantId}
          onResetComplete={() => setReloadKey((k) => k + 1)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <TopVendorsCard state={topVendorsState} />
        <PnlCard state={pnlState} />
        <AnomaliesCard state={anomaliesState} />
      </div>
    </div>
  )
}
