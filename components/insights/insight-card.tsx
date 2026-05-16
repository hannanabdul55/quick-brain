"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export type InsightCardState =
  | { kind: "loading" }
  | { kind: "data"; node: React.ReactNode }
  | { kind: "error"; message: string; onRetry: () => void }

export interface InsightCardProps {
  title: string
  label: string
  state: InsightCardState
}

export function InsightCard({ title, label, state }: InsightCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1">
          <CardTitle>{title}</CardTitle>
          <Badge variant="secondary">{label}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {state.kind === "loading" && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        )}
        {state.kind === "data" && state.node}
        {state.kind === "error" && (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-destructive">{state.message}</p>
            <Button variant="outline" size="sm" onClick={state.onRetry}>
              Retry
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
