"use client"

import { useCallback, useEffect, useRef, useState } from "react"

type Entry =
  | { kind: "you"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "note"; text: string }

/**
 * The thread: say what you want, watch the agent do it against the real checkout.
 *
 * Everything here arrives while the work is happening -- the agent's reasoning, each file it opens
 * or edits, each command it runs. That is the difference between this and every other page in the
 * cockpit, which can only show rows written after the fact by something the operator could not see.
 */
export function AgentThread() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })
  }, [entries])

  useEffect(() => () => controller.current?.abort(), [])

  const push = useCallback((entry: Entry) => setEntries((current) => [...current, entry]), [])

  const stop = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
  }, [])

  /** Render one CLI event as something a person can follow, not as JSON. */
  const absorb = useCallback((event: Record<string, unknown>) => {
    const message = event.message as { content?: unknown[] } | undefined
    if (event.type === "assistant" && Array.isArray(message?.content)) {
      for (const block of message.content as Array<Record<string, unknown>>) {
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          push({ kind: "agent", text: block.text })
        }
        if (block.type === "tool_use") {
          const input = (block.input ?? {}) as Record<string, unknown>
          const detail =
            (typeof input.file_path === "string" && input.file_path) ||
            (typeof input.command === "string" && input.command) ||
            (typeof input.pattern === "string" && input.pattern) ||
            (typeof input.prompt === "string" && input.prompt.slice(0, 120)) ||
            ""
          push({ kind: "tool", name: String(block.name ?? "tool"), detail: String(detail) })
        }
      }
    }
    if (event.type === "result") {
      const text = typeof event.result === "string" ? event.result : ""
      if (text.trim()) push({ kind: "agent", text })
    }
  }, [push])

  const send = useCallback(async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setPrompt("")
    push({ kind: "you", text })
    setBusy(true)

    const abort = new AbortController()
    controller.current = abort
    try {
      const response = await fetch("/api/loom/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Continuing an existing thread keeps the agent's memory of what it already did here.
        body: JSON.stringify({ prompt: text, sessionId, resume: sessionId !== null }),
        signal: abort.signal,
        cache: "no-store",
      })
      if (!response.ok || !response.body) {
        push({ kind: "note", text: `could not start the agent (${response.status})` })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          let payload: Record<string, unknown>
          try { payload = JSON.parse(line) } catch { continue }
          if (payload.type === "session" && typeof payload.sessionId === "string") setSessionId(payload.sessionId)
          else if (payload.type === "event") absorb(payload.event as Record<string, unknown>)
          else if (payload.type === "stderr" && typeof payload.text === "string") push({ kind: "note", text: payload.text })
          else if (payload.type === "done") {
            if (payload.reason) push({ kind: "note", text: `— ${String(payload.reason)} —` })
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") push({ kind: "note", text: String(error) })
    } finally {
      setBusy(false)
      controller.current = null
    }
  }, [prompt, busy, sessionId, push, absorb])

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto rounded-lg border border-border p-4">
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tell Hermes what you want done. It works in this checkout — you will see every file it
            opens and every command it runs, as it happens.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {entries.map((entry, index) => {
              if (entry.kind === "you") {
                return <p key={index} className="self-end rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">{entry.text}</p>
              }
              if (entry.kind === "agent") {
                return <p key={index} className="whitespace-pre-wrap text-sm leading-6">{entry.text}</p>
              }
              if (entry.kind === "tool") {
                return (
                  <p key={index} className="font-mono text-xs text-muted-foreground">
                    <span className="text-foreground">{entry.name}</span>
                    {entry.detail ? ` ${entry.detail}` : ""}
                  </p>
                )
              }
              return <p key={index} className="font-mono text-xs text-amber-600">{entry.text}</p>
            })}
            {busy ? <p className="animate-pulse text-xs text-muted-foreground">working…</p> : null}
          </div>
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() }
          }}
          rows={2}
          placeholder="What do you want done?"
          className="min-h-[3rem] flex-1 resize-y rounded-lg border border-border bg-background p-3 text-sm"
        />
        {busy ? (
          <button type="button" onClick={stop} className="rounded-lg bg-destructive px-4 py-3 text-sm text-white">Stop</button>
        ) : (
          <button type="button" onClick={() => void send()} className="rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground">Send</button>
        )}
      </div>
      {sessionId ? <p className="text-[11px] text-muted-foreground">thread {sessionId.slice(0, 8)} — reopening continues where you left off</p> : null}
    </section>
  )
}
