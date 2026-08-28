"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import styles from "./experience-spatial.module.css"

type DeveloperToolKind = "tests" | "diff" | "terminal"
type OutputLine = Readonly<{ channel: "stdout" | "stderr" | "meta"; text: string }>
type Operation = Readonly<{ id: string; label: string; intent: string; scope: "project" | "runtime"; mutating: boolean }>

export function DeveloperToolsSurface({ kind, selectedPath }: { kind: DeveloperToolKind; selectedPath: string | null }) {
  const [diff, setDiff] = useState("")
  const [status, setStatus] = useState("")
  const [operations, setOperations] = useState<readonly Operation[]>([])
  const [lines, setLines] = useState<readonly OutputLine[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const diffController = useRef<AbortController | null>(null)
  const output = useRef<HTMLPreElement>(null)

  const loadDiff = useCallback(async () => {
    diffController.current?.abort()
    const abort = new AbortController()
    diffController.current = abort
    setError(null)
    const query = selectedPath ? `?path=${encodeURIComponent(selectedPath)}` : ""
    try {
      const response = await fetch(`/api/loom/diff${query}`, { cache: "no-store", signal: abort.signal })
      const payload = await response.json() as { error?: string; diff?: string; status?: string; note?: string; untracked?: boolean }
      if (!response.ok) throw new Error(payload.error ?? `DIFF_${response.status}`)
      setDiff(payload.untracked ? payload.note ?? "This file is new." : payload.diff ?? "")
      setStatus(payload.status ?? "")
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return
      setError(caught instanceof Error ? caught.message : "DIFF_UNAVAILABLE")
    } finally {
      if (diffController.current === abort) diffController.current = null
    }
  }, [selectedPath])

  useEffect(() => {
    if (kind === "diff") void loadDiff()
  }, [kind, loadDiff])

  useEffect(() => {
    if (kind !== "terminal") return
    void fetch("/api/loom/run", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { operations: [] })
      .then((payload: { operations?: Operation[] }) => setOperations((payload.operations ?? []).filter((operation) => operation.scope === "project" && !operation.mutating && operation.id !== "tests.run")))
      .catch(() => setOperations([]))
  }, [kind])

  useEffect(() => {
    const node = output.current
    if (node && typeof node.scrollTo === "function") node.scrollTo({ top: node.scrollHeight })
  }, [lines])

  const stop = useCallback(() => {
    controller.current?.abort()
    controller.current = null
    setRunning(null)
  }, [])

  useEffect(() => () => {
    controller.current?.abort()
    diffController.current?.abort()
  }, [])

  const run = useCallback(async (operation: string) => {
    stop()
    setLines([])
    setError(null)
    setRunning(operation)
    const abort = new AbortController()
    controller.current = abort
    try {
      const response = await fetch("/api/loom/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation }),
        signal: abort.signal,
        cache: "no-store",
      })
      if (!response.ok || !response.body) throw new Error(`RUN_${response.status}`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const complete = buffer.split("\n")
        buffer = complete.pop() ?? ""
        for (const entry of complete) {
          if (!entry.trim()) continue
          let event: { type?: string; text?: string; code?: number | null; reason?: string | null }
          try { event = JSON.parse(entry) } catch { continue }
          if (event.type === "stdout" || event.type === "stderr") {
            const channel: OutputLine["channel"] = event.type
            setLines((current) => [...current, { channel, text: event.text ?? "" }])
          } else if (event.type === "exit") {
            setLines((current) => [...current, { channel: "meta", text: event.reason ?? `exit ${event.code}` }])
          }
        }
      }
    } catch (caught) {
      if ((caught as Error)?.name !== "AbortError") setError(caught instanceof Error ? caught.message : "RUN_UNAVAILABLE")
    } finally {
      setRunning(null)
      controller.current = null
    }
  }, [stop])

  const title = kind === "tests" ? "Focused validation" : kind === "diff" ? "Current change" : "Project terminal"

  return (
    <section className={styles.utilitySurface} aria-label={title}>
      <header className={styles.utilityMeta}>
        <span>{title}</span>
        <span>{running ? `Running ${running}` : error ? error : "Live workspace state"}</span>
      </header>
      <div className={styles.utilityBody}>
        {kind === "diff" ? (
          <>
            <div className={styles.utilityControls}>
              <span className={styles.muted}>{selectedPath ? `HEAD · ${selectedPath}` : "HEAD · working tree"}</span>
              <button type="button" className={styles.utilityButton} onClick={() => void loadDiff()}>Refresh</button>
            </div>
            {status ? <pre className={styles.utilityOutput}>{status}</pre> : null}
            <pre className={styles.utilityOutput}>{diff || (error ? "" : "No changes against HEAD.")}</pre>
          </>
        ) : (
          <>
            <div className={styles.utilityControls}>
              {kind === "tests" ? (
                <button type="button" className={styles.utilityButton} disabled={running !== null} onClick={() => void run("tests.run")}>Run full test suite</button>
              ) : operations.map((operation) => (
                <button key={operation.id} type="button" className={styles.utilityButton} disabled={running !== null} title={operation.intent} onClick={() => void run(operation.id)}>{operation.label}</button>
              ))}
              {running ? <button type="button" className={styles.utilityStop} onClick={stop}>Stop</button> : null}
            </div>
            <pre ref={output} className={styles.utilityOutput} aria-live="polite">{lines.length === 0
              ? kind === "tests" ? "Tests have not run in this Space yet." : "Choose a bounded project operation. Output streams here live."
              : lines.map((line, index) => <span key={index} data-channel={line.channel}>{line.text}</span>)}</pre>
          </>
        )}
      </div>
    </section>
  )
}
