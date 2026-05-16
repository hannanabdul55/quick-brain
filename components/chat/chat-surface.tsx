"use client"

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageList, type ChatMessage } from "./message-list"
import { MessageInput } from "./message-input"
import { SuggestedChips } from "./suggested-chips"
import { MarkdownRenderer } from "./markdown-renderer"

export interface ChatSurfaceProps {
  tenantId: string
  businessName?: string
}

export function ChatSurface({ tenantId, businessName }: ChatSurfaceProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([])
  const [pending, setPending] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")

  function appendMessage(msg: ChatMessage) {
    setMessages((prev) => [...prev, msg])
  }

  async function send(question: string) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      createdAt: Date.now(),
    }
    appendMessage(userMessage)
    setPending(true)

    try {
      const response = await fetch(`/api/tenants/${tenantId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      })

      if (!response.body) {
        throw new Error("No response body from /api/tenants/" + tenantId + "/chat")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        done = readerDone
        if (value) {
          buffer += decoder.decode(value, { stream: !readerDone })
        }

        // Parse SSE frames: split on double-newline
        const frames = buffer.split("\n\n")
        // Keep the last (potentially incomplete) chunk in the buffer
        buffer = frames.pop() ?? ""

        for (const frame of frames) {
          const lines = frame.split("\n")
          let eventName = ""
          let dataLine = ""

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventName = line.slice("event: ".length).trim()
            } else if (line.startsWith("data: ")) {
              dataLine = line.slice("data: ".length).trim()
            }
          }

          if (!eventName || !dataLine) continue

          if (eventName === "answer") {
            try {
              const parsed = JSON.parse(dataLine) as { markdown: string }
              appendMessage({
                id: crypto.randomUUID(),
                role: "assistant",
                content: parsed.markdown,
                createdAt: Date.now(),
              })
              setPending(false)
              reader.cancel()
              return
            } catch {
              // malformed JSON — treat as error
              appendMessage({
                id: crypto.randomUUID(),
                role: "system-error",
                content: "Received an unexpected response. Please try again.",
                createdAt: Date.now(),
              })
              setPending(false)
              reader.cancel()
              return
            }
          }

          if (eventName === "error") {
            try {
              const parsed = JSON.parse(dataLine) as { message: string }
              appendMessage({
                id: crypto.randomUUID(),
                role: "system-error",
                content: parsed.message,
                createdAt: Date.now(),
              })
            } catch {
              appendMessage({
                id: crypto.randomUUID(),
                role: "system-error",
                content: "An error occurred. Please try again.",
                createdAt: Date.now(),
              })
            }
            setPending(false)
            reader.cancel()
            return
          }
        }
      }

      // Stream ended without an answer or error frame
      setPending(false)
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      appendMessage({
        id: crypto.randomUUID(),
        role: "system-error",
        content: "Request failed: " + errorText,
        createdAt: Date.now(),
      })
      setPending(false)
    }
  }

  function renderAssistant(markdown: string): React.JSX.Element {
    return <MarkdownRenderer markdown={markdown} />
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4">
      <Card className="flex flex-col gap-0 overflow-hidden">
        <CardHeader className="border-b border-border">
          <CardTitle>{businessName ?? "Your business brain"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0 flex flex-col">
          <MessageList
            messages={messages}
            pending={pending}
            renderAssistant={renderAssistant}
          />
          {messages.length === 0 && !pending && (
            <div className="px-4 pt-2">
              <SuggestedChips
                onPick={(q) => {
                  setInputValue(q)
                  send(q)
                }}
                disabled={pending}
              />
            </div>
          )}
          <MessageInput
            value={inputValue}
            onChange={setInputValue}
            onSubmit={send}
            disabled={pending}
          />
        </CardContent>
      </Card>
    </div>
  )
}
