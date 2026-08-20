"use client"

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import { DefaultChatTransport } from "ai"

import { getThreadConversation, type ThreadConversationEntry } from "@/app/actions/workbench-thread-messages"
import { cn } from "@/lib/utils"

/**
 * The conversation surface of a Thread (#762 CONVERSATION-FIRST).
 *
 * "Work does not replace chat. Work happens inside chat." This input accepts anything -- rambling,
 * questions, direction changes, half-thoughts -- and answers in the same place. It never classifies
 * the owner's words into workflow objects, and Enter always visibly does something: the owner's
 * message appears in the conversation the moment it is sent, which is the feedback whose absence
 * once turned one press into five identical goals.
 */
export function ThreadConversation({ threadId, className }: { threadId: string; className?: string }) {
  const [persisted, setPersisted] = useState<ThreadConversationEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [input, setInput] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/thread-chat", body: { threadId } }),
  })
  const busy = status === "streaming" || status === "submitted"
  const [silentTurn, setSilentTurn] = useState(false)
  const wasBusyRef = useRef(false)

  useEffect(() => {
    // A turn that ends with no assistant text and no error is the worst outcome this surface can
    // produce: the owner watched "thinking…" resolve into nothing. It happened live -- a proxy killed
    // the stream mid-thought and the client returned to idle in silence. Silence is never an answer.
    if (busy) {
      wasBusyRef.current = true
      setSilentTurn(false)
      return
    }
    if (!wasBusyRef.current) return
    wasBusyRef.current = false
    const last = messages[messages.length - 1]
    const lastText = (last?.parts ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("")
    setSilentTurn(!error && (last?.role !== "assistant" || lastText.trim() === ""))
  }, [busy, messages, error])

  useEffect(() => {
    let active = true
    setLoaded(false)
    getThreadConversation(threadId)
      .then((entries) => {
        if (!active) return
        setPersisted(entries)
        setLoaded(true)
      })
      // A failed history load is an empty conversation, never an unhandled rejection.
      .catch(() => {
        if (!active) return
        setPersisted([])
        setLoaded(true)
      })
    return () => {
      active = false
    }
  }, [threadId])

  useEffect(() => {
    // Optional-call: jsdom (the shell contract tests) renders this tree without scrollIntoView.
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" })
  }, [messages, persisted, busy])

  function submit() {
    const text = input.trim()
    if (!text || busy) return
    sendMessage({ text })
    setInput("")
    inputRef.current?.focus()
  }

  const live = messages.map((message) => ({
    id: message.id,
    role: message.role === "user" ? ("owner" as const) : ("williamos" as const),
    content: (message.parts ?? [])
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join(""),
  }))

  const entries = [...persisted, ...live].filter((entry) => entry.content.trim() !== "")

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
        {loaded && entries.length === 0 ? (
          <p className="px-2 py-6 text-sm leading-6 text-[var(--workbench-muted)]">
            This Thread is yours. Ask a question, think out loud, paste something that bothers you, or
            describe what you want built — the conversation is the work surface.
          </p>
        ) : null}
        <ol className="flex flex-col gap-4">
          {entries.map((entry) => (
            <li key={entry.id} className={cn("flex", entry.role === "owner" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-sm border px-4 py-3 text-sm leading-6 whitespace-pre-wrap",
                  entry.role === "owner"
                    ? "border-[var(--workbench-copper)]/50 bg-[var(--workbench-copper)]/10 text-[var(--workbench-text)]"
                    : "border-[var(--workbench-hairline)] bg-[var(--workbench-panel)] text-[var(--workbench-text)]",
                )}
              >
                <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.15em] text-[var(--workbench-muted)]">
                  {entry.role === "owner" ? "You" : "WilliamOS"}
                </span>
                {entry.content}
              </div>
            </li>
          ))}
        </ol>
        {busy ? (
          <p className="mt-3 px-2 font-mono text-[11px] text-[var(--workbench-muted)]" role="status">
            WilliamOS is thinking…
          </p>
        ) : null}
        {error || silentTurn ? (
          <p className="mt-3 px-2 text-sm text-red-400" role="alert">
            That reply failed to arrive. Your message is kept — say &ldquo;try again&rdquo; or rephrase.
          </p>
        ) : null}
        <div ref={bottomRef} />
      </div>
      <form
        className="border-t border-[var(--workbench-hairline)] pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="Ask or tell WilliamOS anything… (Enter sends, Shift+Enter for a new line)"
          className="workbench-focus w-full resize-none rounded-sm border border-[var(--workbench-hairline)] bg-[var(--workbench-panel)] px-4 py-3 text-sm leading-6 text-[var(--workbench-text)] placeholder:text-[var(--workbench-muted)]"
          aria-label="Message WilliamOS in this Thread"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="font-mono text-[10px] text-[var(--workbench-muted)]">
            {busy ? "Streaming reply…" : "Conversation persists in this Thread."}
          </p>
          <button
            type="submit"
            disabled={busy || input.trim() === ""}
            className="workbench-focus rounded-sm border border-[var(--workbench-copper)]/60 px-4 py-1.5 text-sm text-[var(--workbench-text)] disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  )
}
