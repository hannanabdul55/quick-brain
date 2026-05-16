"use client"

// Stub renderer — Plan 06 (react-markdown wiring) will replace the body of this file.
// For now, renders markdown as plain preformatted text.
// When Plan 06 lands, it will install react-markdown + remark-gfm and update this component.

import * as React from "react"

export interface MarkdownRendererProps {
  markdown: string
}

export function MarkdownRenderer({ markdown }: MarkdownRendererProps) {
  // Fallback: plain preformatted text until Plan 06 wires up react-markdown
  return (
    <pre className="whitespace-pre-wrap break-words font-sans text-sm">
      {markdown}
    </pre>
  )
}
