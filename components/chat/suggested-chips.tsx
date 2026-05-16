"use client"

import { Button } from "@/components/ui/button"

export const SUGGESTED_QUESTIONS = [
  "What was weird about last month?",
  "Who are my top 5 vendors and how much did I pay each?",
  "What am I paying for every month that I shouldn't be?",
] as const satisfies readonly [string, string, string]

export interface SuggestedChipsProps {
  onPick: (question: string) => void
  disabled: boolean
}

export function SuggestedChips({ onPick, disabled }: SuggestedChipsProps) {
  return (
    <div className="flex flex-wrap gap-2 px-1 pb-2">
      {SUGGESTED_QUESTIONS.map((question) => (
        <button
          key={question}
          type="button"
          disabled={disabled}
          onClick={() => onPick(question)}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          {question}
        </button>
      ))}
    </div>
  )
}
