"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

export interface MessageInputProps {
  onSubmit: (question: string) => void
  disabled: boolean
  value: string
  onChange: (v: string) => void
}

export function MessageInput({ onSubmit, disabled, value, onChange }: MessageInputProps) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSubmit(trimmed)
    onChange("")
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 border-t border-border px-4 py-3">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Ask Mara's brain anything…"
        disabled={disabled}
        className="flex-1"
      />
      <Button type="submit" disabled={disabled || !value.trim()}>
        Send
      </Button>
    </form>
  )
}
