"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { useWorkbenchContext } from "@/components/workbench/workbench-context"

type Operation = {
  id: string
  label: string
  intent: string
  scope: "project" | "runtime"
  mutating: boolean
}

type Line = { channel: "stdout" | "stderr" | "meta"; text: string }

/**
 * A terminal that lives inside the cockpit.
 *
 * The point is not the buttons -- it is that output arrives while the work is happening. Every other
 * surface in this application shows rows written earlier by something the operator could not see or
 * stop. Here the machine's own bytes arrive as they are produced, the operator can stop the process,
 * and leaving the page kills it rather than orphaning it.
 */
export function LiveConsole() {
  const workbench = useWorkbenchContext()
  const projectKey = workbench?.selectedProject?.key === "williamos" ? "williamos" : "terrafusion"
  const [operations, setOperations] = useState<Operation[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<Operation | null>(null)
  const controller = useRef<AbortController | null>(null)
  const output = useRef<HTMLPreElement>(null)

  useEffect(() => {
    controller.current?.abort()
    controller.current = null
    setLines([])
    setRunning(null)
    setConfirming(null)
  }, [projectKey])

  useEffect(() => {
    fetch("/api/loom/run", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { operations: [] }))
      .then((payload) => setOperations(payload.operations ?? []))
      .catch(() => setOperations([]))
  }, [])

  // Follow the tail the way a terminal does, so long output does not have to be chased.
  useEffect(() => {
    output.current?.scrollTo({ top: output.current.scrollHeight })
  }, [lines])

  const stop = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setRunning(null)
  }, [])

  // Kill whatever is running if the operator navigates away.
  useEffect(() => () => controller.current?.abort(), [])

  const run = useCallback(async (operation: Operation, confirmed: boolean) => {
    stop()
    setLines([])
    setRunning(operation.id)
    const abort = new AbortController()
    controller.current = abort

    try {
      const response = await fetch("/api/loom/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: operation.id, confirmed, ...(projectKey === "williamos" ? { projectKey } : {}) }),
        signal: abort.signal,
        cache: "no-store",
      })
      if (!response.ok || !response.body) {
        setLines([{ channel: "meta", text: `could not start: ${response.status}` }])
        setRunning(null)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // NDJSON: a chunk can split a line, so only complete lines are consumed.
        const complete = buffer.split("\n")
        buffer = complete.pop() ?? ""
        for (const entry of complete) {
          if (!entry.trim()) continue
          let event: { type: string; text?: string; code?: number | null; reason?: string | null }
          try { event = JSON.parse(entry) } catch { continue }
          if (event.type === "stdout" || event.type === "stderr") {
            setLines((current) => [...current, { channel: event.type as "stdout" | "stderr", text: event.text ?? "" }])
          } else if (event.type === "exit") {
            const detail = event.reason ? event.reason : `exit ${event.code}`
            setLines((current) => [...current, { channel: "meta", text: `— ${detail} —` }])
            setRunning(null)
          }
        }
      }
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") {
        setLines((current) => [...current, { channel: "meta", text: `stream failed: ${String(error)}` }])
      }
    } finally {
      setRunning(null)
      controller.current = null
    }
  }, [projectKey, stop])

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {operations.map((operation) => (
          <button
            key={operation.id}
            type="button"
            disabled={running !== null}
            onClick={() => (operation.mutating ? setConfirming(operation) : run(operation, false))}
            title={operation.intent}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-40"
          >
            {operation.label}
            {operation.mutating ? <span className="ml-2 text-xs text-amber-600">changes things</span> : null}
          </button>
        ))}
        {running ? (
          <button type="button" onClick={stop} className="rounded-md bg-destructive px-3 py-2 text-sm text-white">
            Stop
          </button>
        ) : null}
      </div>

      {confirming ? (
        <div role="alertdialog" className="flex flex-col gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
          <p className="text-sm font-medium">{confirming.label}</p>
          {/* The operator is told what will happen, not which command will run. */}
          <p className="text-sm text-muted-foreground">{confirming.intent}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={() => { const operation = confirming; setConfirming(null); void run(operation, true) }}
            >
              Do it
            </button>
            <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <pre
        ref={output}
        aria-live="polite"
        aria-label="Live output"
        className="h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-black/90 p-4 font-mono text-xs leading-5 text-green-200"
      >
        {lines.length === 0 && running === null
          ? "Nothing running. Pick something above and the output appears here as it happens."
          : lines.map((line, index) => (
              <span key={index} className={line.channel === "stderr" ? "text-red-300" : line.channel === "meta" ? "text-zinc-400" : undefined}>
                {line.text}
              </span>
            ))}
        {running ? <span className="animate-pulse text-zinc-400">▌</span> : null}
      </pre>
    </section>
  )
}
