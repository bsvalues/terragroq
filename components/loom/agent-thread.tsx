"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { DEFAULT_PROVIDER, LOOM_PROVIDERS, type LoomProviderId } from "@/lib/loom/providers"

type Entry =
  | { kind: "you"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; name: string; detail: string }
  | { kind: "note"; text: string }

type LocalCompletedTurn = Readonly<{
  ownerPrompt: string
  finalResult: string
  completedAt: string
}>

const LOCAL_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_LOCAL_COMPLETED_TURNS = 20
const MAX_LOCAL_REPLAY_BYTES = 262_144

function boundedLocalText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= max && new TextEncoder().encode(text).byteLength <= max && !text.includes("\0") ? text : null
}

function boundedLocalFragment(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max
    && new TextEncoder().encode(value).byteLength <= max && !value.includes("\0")
}

function appendBoundedLocalTurn(turns: readonly LocalCompletedTurn[], turn: LocalCompletedTurn): readonly LocalCompletedTurn[] {
  const bounded = [...turns, turn].slice(-MAX_LOCAL_COMPLETED_TURNS)
  while (bounded.length > 0 && new TextEncoder().encode(JSON.stringify(bounded)).byteLength > MAX_LOCAL_REPLAY_BYTES) {
    bounded.shift()
  }
  return bounded
}

/**
 * The thread: say what you want, watch the agent do it against the real checkout.
 *
 * Everything here arrives while the work is happening -- the agent's reasoning, each file it opens
 * or edits, each command it runs. That is the difference between this and every other page in the
 * cockpit, which can only show rows written after the fact by something the operator could not see.
 */
export function AgentThread({ projectKey = "terrafusion" }: { projectKey?: "terrafusion" | "williamos" }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [prompt, setPrompt] = useState("")
  const [busy, setBusy] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [provider, setProvider] = useState<LoomProviderId>(DEFAULT_PROVIDER)
  const [models, setModels] = useState<Array<{ name: string; parameters: string | null; gigabytes: number | null }>>([])
  const [model, setModel] = useState<string>("")
  const controller = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const localCompletedTurns = useRef<readonly LocalCompletedTurn[]>([])

  useEffect(() => {
    controller.current?.abort()
    controller.current = null
    localCompletedTurns.current = []
    setEntries([])
    setPrompt("")
    setBusy(false)
    setSessionId(null)
  }, [projectKey])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" })
  }, [entries])

  useEffect(() => () => controller.current?.abort(), [])

  // Installed models are read from the running local runtime, so one that finishes downloading
  // appears here without a rebuild.
  useEffect(() => {
    fetch("/api/loom/models", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { models: [] }))
      .then((payload) => {
        setModels(payload.models ?? [])
        setModel((current) => current || payload.default || payload.models?.[0]?.name || "")
      })
      .catch(() => setModels([]))
  }, [])

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
    const selectedProvider = provider
    const requestedSessionId = sessionId
    const replayTurns = localCompletedTurns.current
    try {
      const response = await fetch("/api/loom/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Continuing an existing thread keeps the agent's memory of what it already did here.
        body: JSON.stringify({
          prompt: text,
          sessionId: requestedSessionId,
          resume: requestedSessionId !== null,
          provider: selectedProvider,
          model,
          ...(projectKey === "williamos" ? { projectKey } : {}),
          ...(selectedProvider === "local" && requestedSessionId !== null ? { completedTurns: replayTurns } : {}),
        }),
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
      let localMalformed = false
      let localSessionSeen = false
      let localResult: string | null = null
      let localTerminal: { code: number | null; reason: string | null } | null = null
      const acceptLine = (line: string) => {
        if (!line.trim()) return
        let payload: Record<string, unknown>
        try { payload = JSON.parse(line) } catch {
          if (selectedProvider === "local") localMalformed = true
          return
        }
        if (selectedProvider === "local") {
          if (payload.type === "session") {
            if (localSessionSeen || typeof payload.sessionId !== "string" || !LOCAL_SESSION_ID.test(payload.sessionId)
              || payload.provider !== "Local" || typeof payload.resumed !== "boolean"
              || payload.resumed !== (requestedSessionId !== null)) {
              localMalformed = true
              return
            }
            localSessionSeen = true
            setSessionId(payload.sessionId)
            return
          }
          if (!localSessionSeen) {
            localMalformed = true
            return
          }
          if (payload.type === "delta") {
            if (!boundedLocalFragment(payload.text, 20_000) || localResult !== null || localTerminal !== null) {
              localMalformed = true
              return
            }
            const piece = payload.text
            setEntries((current) => {
              const last = current[current.length - 1]
              if (last?.kind === "agent") return [...current.slice(0, -1), { kind: "agent", text: last.text + piece }]
              return [...current, { kind: "agent", text: piece }]
            })
            return
          }
          if (payload.type === "result") {
            const result = boundedLocalText(payload.text, 200_000)
            if (!result || localResult !== null || localTerminal !== null) localMalformed = true
            else localResult = result
            return
          }
          if (payload.type === "done") {
            const reason = payload.reason === null ? null : boundedLocalText(payload.reason, 500)
            const code = payload.code === null || typeof payload.code === "number" && Number.isInteger(payload.code)
              ? payload.code : undefined
            if (localTerminal !== null || code === undefined || payload.reason !== null && !reason) localMalformed = true
            else localTerminal = { code, reason }
            return
          }
          localMalformed = true
          return
        }
        if (payload.type === "session" && typeof payload.sessionId === "string") setSessionId(payload.sessionId)
        else if (payload.type === "delta" && typeof payload.text === "string") {
          const piece = payload.text
          setEntries((current) => {
            const last = current[current.length - 1]
            if (last?.kind === "agent") return [...current.slice(0, -1), { kind: "agent", text: last.text + piece }]
            return [...current, { kind: "agent", text: piece }]
          })
        }
        else if (payload.type === "event") absorb(payload.event as Record<string, unknown>)
        else if (payload.type === "stderr" && typeof payload.text === "string") push({ kind: "note", text: payload.text })
        else if (payload.type === "done" && payload.reason) push({ kind: "note", text: `— ${String(payload.reason)} —` })
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        lines.forEach(acceptLine)
      }
      buffer += decoder.decode()
      acceptLine(buffer)
      if (selectedProvider === "local") {
        const settled = localTerminal as { code: number | null; reason: string | null } | null
        if (settled?.reason) push({ kind: "note", text: `— ${settled.reason} —` })
        const ownerPrompt = boundedLocalText(text, 20_000)
        if (!abort.signal.aborted && !localMalformed && localSessionSeen && ownerPrompt && localResult
          && settled?.code === 0 && settled.reason === null) {
          const priorTime = replayTurns.length > 0 ? Date.parse(replayTurns[replayTurns.length - 1].completedAt) : Number.NEGATIVE_INFINITY
          const completedAt = new Date(Math.max(Date.now(), priorTime + 1)).toISOString()
          localCompletedTurns.current = appendBoundedLocalTurn(replayTurns, { ownerPrompt, finalResult: localResult, completedAt })
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") push({ kind: "note", text: String(error) })
    } finally {
      setBusy(false)
      controller.current = null
    }
  }, [prompt, busy, sessionId, provider, model, push, absorb, projectKey])

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

      <div className="flex flex-wrap items-center gap-2">
        {LOOM_PROVIDERS.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={busy}
            onClick={() => setProvider(option.id)}
            title={option.note}
            className={`rounded-md border px-2 py-1 text-xs disabled:opacity-40 ${
              provider === option.id ? "border-primary bg-primary/10 font-medium" : "border-border"
            }`}
          >
            {option.label}
            {option.metered ? <span className="ml-1 text-amber-600">·  uses your plan</span> : null}
          </button>
        ))}
        {provider === "local" && models.length > 0 ? (
          <select
            value={model}
            disabled={busy}
            onChange={(event) => setModel(event.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            aria-label="Local model"
          >
            {models.map((option) => (
              <option key={option.name} value={option.name}>
                {option.name}
                {option.parameters ? ` (${option.parameters})` : ""}
              </option>
            ))}
          </select>
        ) : null}
        <span className="text-[11px] text-muted-foreground">
          {LOOM_PROVIDERS.find((option) => option.id === provider)?.note}
        </span>
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
