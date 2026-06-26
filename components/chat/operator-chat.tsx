"use client"

import { useState, useRef, useEffect } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Send, Sparkles, FileText, BrainCircuit, ChevronDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

type Source = {
  ref: number
  kind: "document" | "memory"
  title: string
  source: string | null
  snippet: string
  similarity: number
}

const SUGGESTIONS = [
  "What decisions have I made recently?",
  "Summarize what you know about my operating principles.",
  "What does my corpus say about strategy?",
]

export function OperatorChat() {
  const [input, setInput] = useState("")
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  })
  const bottomRef = useRef<HTMLDivElement>(null)
  const busy = status === "streaming" || status === "submitted"

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  function submit(text: string) {
    if (!text.trim() || busy) return
    sendMessage({ text })
    setInput("")
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-6 py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Sparkles className="h-6 w-6" />
              </div>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold">Ask your governed second brain</h2>
                <p className="max-w-md text-sm text-muted-foreground leading-relaxed">
                  Answers are grounded in your memory and corpus, governed by your doctrine, and cited with sources.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-md">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="rounded-lg border border-border bg-card px-4 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => {
            const text = message.parts
              .filter((p): p is { type: "text"; text: string } => p.type === "text")
              .map((p) => p.text)
              .join("")
            const sources =
              (message.metadata as { sources?: Source[] } | undefined)?.sources ?? []

            if (message.role === "user") {
              return (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                    {text}
                  </div>
                </div>
              )
            }

            return (
              <div key={message.id} className="flex flex-col gap-3">
                <div className="flex gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 font-mono text-xs font-bold text-primary">
                    W
                  </div>
                  <div className="flex-1 whitespace-pre-wrap text-sm leading-relaxed pt-0.5">
                    {text || (busy && <span className="text-muted-foreground">Thinking…</span>)}
                  </div>
                </div>
                {sources.length > 0 && <SourceList sources={sources} />}
              </div>
            )
          })}

          {status === "submitted" && (
            <div className="flex items-center gap-2 pl-10 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Retrieving context…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-border bg-background p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit(input)
          }}
          className="mx-auto flex w-full max-w-3xl items-center gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything grounded in your second brain…"
            disabled={busy}
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Send">
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}

function SourceList({ sources }: { sources: Source[] }) {
  return (
    <div className="ml-10">
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground">
          {sources.length} source{sources.length > 1 ? "s" : ""}
          <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 flex flex-col gap-2">
          {sources.map((s) => (
            <div key={s.ref} className="rounded-lg border border-border bg-card p-3">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded bg-primary/15 font-mono text-[10px] font-bold text-primary">
                  {s.ref}
                </span>
                {s.kind === "document" ? (
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <BrainCircuit className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span className="text-xs font-medium">{s.title}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                  {(s.similarity * 100).toFixed(0)}%
                </span>
              </div>
              <p className={cn("text-xs text-muted-foreground leading-relaxed line-clamp-3")}>
                {s.snippet}
              </p>
              {s.source && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">src: {s.source}</p>
              )}
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
