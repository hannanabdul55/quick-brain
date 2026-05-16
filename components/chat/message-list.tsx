"use client"

import * as React from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system-error"
  content: string
  createdAt: number
}

export interface MessageListProps {
  messages: ChatMessage[]
  pending: boolean
  renderAssistant: (markdown: string) => React.JSX.Element
}

export function MessageList({ messages, pending, renderAssistant }: MessageListProps) {
  const bottomRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, pending])

  return (
    <ScrollArea className="h-[60vh] w-full">
      <div className="flex flex-col gap-3 p-4">
        {messages.map((message) => {
          if (message.role === "user") {
            return (
              <div key={message.id} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-neutral-900 px-4 py-2 text-sm text-white">
                  {message.content}
                </div>
              </div>
            )
          }

          if (message.role === "assistant") {
            return (
              <div key={message.id} className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-2 text-sm">
                  {renderAssistant(message.content)}
                </div>
              </div>
            )
          }

          // system-error
          return (
            <div
              key={message.id}
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-900"
            >
              {message.content}
            </div>
          )
        })}

        {pending && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm border border-border bg-card px-4 py-3">
              <p className="mb-2 text-sm text-muted-foreground">
                {"Mara's brain is thinking"}
                <ThinkingDots />
              </p>
              <Skeleton className="h-4 w-40" />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-0.5">
      <span className="animate-bounce [animation-delay:0ms]">.</span>
      <span className="animate-bounce [animation-delay:150ms]">.</span>
      <span className="animate-bounce [animation-delay:300ms]">.</span>
    </span>
  )
}
