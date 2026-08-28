"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LOOM_OPERATIONS, resolveProjectTerminalAlias } from "@/lib/loom/operations"
import styles from "./experience-spatial.module.css"
import { loadToolRunHistory, persistToolRunTranscript, type ToolOutputLine, type ToolRunTranscript } from "./tool-run-history"

type DeveloperToolKind = "tests" | "diff" | "terminal"
type Operation = Readonly<{ id: string; label: string; intent: string; scope: "project" | "runtime"; mutating: boolean }>
type ActiveRun = { id: string; operationId: string; operationLabel: string; alias: string; startedAt: string; lines: ToolOutputLine[] }

function terminalAlias(id: string): string | null {
  return LOOM_OPERATIONS.find((operation) => operation.id === id)?.terminalAlias ?? null
}

function boundedLines(lines: readonly ToolOutputLine[]): readonly ToolOutputLine[] {
  return lines.slice(-256).map((line) => ({ ...line, text: line.text.slice(0, 16_384) }))
}

function historyForSurface(runs: readonly ToolRunTranscript[], kind: DeveloperToolKind): readonly ToolRunTranscript[] {
  if (kind === "tests") return runs.filter((run) => run.operationId === "tests.run")
  if (kind === "terminal") return runs.filter((run) => run.operationId !== "tests.run")
  return []
}

export function DeveloperToolsSurface({ kind, selectedPath, historyScope = null, historyStorage = null, refreshKey = 0, refreshPath = null, onRefreshSettled }: {
  kind: DeveloperToolKind
  selectedPath: string | null
  historyScope?: string | null
  historyStorage?: Pick<Storage, "getItem" | "setItem"> | null
  refreshKey?: number
  refreshPath?: string | null
  onRefreshSettled?: (path: string, key: number, result: "refreshed" | "failed") => void
}) {
  const [diff, setDiff] = useState("")
  const [status, setStatus] = useState("")
  const [operations, setOperations] = useState<readonly Operation[]>([])
  const [lines, setLines] = useState<readonly ToolOutputLine[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [command, setCommand] = useState("")
  const [commandVerdict, setCommandVerdict] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly ToolRunTranscript[]>([])
  const [historyVerdict, setHistoryVerdict] = useState<string | null>(null)
  const [selectedTranscriptId, setSelectedTranscriptId] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const activeRun = useRef<ActiveRun | null>(null)
  const runSequence = useRef(0)
  const historyScopeRef = useRef(historyScope)
  const historyStorageRef = useRef(historyStorage)
  const diffController = useRef<AbortController | null>(null)
  const completedRefresh = useRef<Readonly<{ key: number; path: string | null }>>({ key: refreshKey, path: null })
  const governedRefresh = useRef<Readonly<{ key: number; path: string }> | null>(null)
  const refreshSettled = useRef(onRefreshSettled)
  const output = useRef<HTMLPreElement>(null)

  useEffect(() => { refreshSettled.current = onRefreshSettled }, [onRefreshSettled])
  useEffect(() => { historyScopeRef.current = historyScope }, [historyScope])
  useEffect(() => { historyStorageRef.current = historyStorage }, [historyStorage])

  const loadDiff = useCallback(async (path = selectedPath): Promise<"refreshed" | "failed" | "aborted"> => {
    diffController.current?.abort()
    const abort = new AbortController()
    diffController.current = abort
    setDiff("")
    setStatus("")
    setError(null)
    const query = path ? `?path=${encodeURIComponent(path)}` : ""
    try {
      const response = await fetch(`/api/loom/diff${query}`, { cache: "no-store", signal: abort.signal })
      const payload = await response.json() as { error?: string; diff?: string; status?: string; note?: string; untracked?: boolean }
      if (!response.ok) throw new Error(payload.error ?? `DIFF_${response.status}`)
      setDiff(payload.untracked ? payload.note ?? "This file is new." : payload.diff ?? "")
      setStatus(payload.status ?? "")
      return "refreshed"
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return "aborted"
      setError(caught instanceof Error ? caught.message : "DIFF_UNAVAILABLE")
      return "failed"
    } finally {
      if (diffController.current === abort) diffController.current = null
    }
  }, [selectedPath])

  useEffect(() => { if (kind === "diff") void loadDiff() }, [kind, loadDiff])

  useEffect(() => {
    if (kind !== "diff" || (refreshKey === completedRefresh.current.key && refreshPath === completedRefresh.current.path)) return
    if (refreshKey === completedRefresh.current.key && !refreshPath) return
    if (!refreshPath) { void loadDiff(); return }
    if (governedRefresh.current?.key === refreshKey && governedRefresh.current.path === refreshPath) return
    governedRefresh.current = { key: refreshKey, path: refreshPath }
    void loadDiff(refreshPath).then((result) => {
      if (result === "aborted" || governedRefresh.current?.key !== refreshKey || governedRefresh.current.path !== refreshPath) return
      governedRefresh.current = null
      completedRefresh.current = { key: refreshKey, path: refreshPath }
      refreshSettled.current?.(refreshPath, refreshKey, result)
    })
    return () => { if (governedRefresh.current?.key === refreshKey && governedRefresh.current.path === refreshPath) governedRefresh.current = null }
  }, [kind, loadDiff, refreshKey, refreshPath])

  const refreshDiff = useCallback(() => {
    const replacement = governedRefresh.current
    void loadDiff(replacement?.path).then((result) => {
      if (!replacement || result === "aborted" || governedRefresh.current?.key !== replacement.key || governedRefresh.current.path !== replacement.path) return
      governedRefresh.current = null
      completedRefresh.current = replacement
      refreshSettled.current?.(replacement.path, replacement.key, result)
    })
  }, [loadDiff])

  useEffect(() => {
    if (kind !== "terminal") return
    void fetch("/api/loom/run", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : { operations: [] })
      .then((payload: { operations?: Operation[] }) => setOperations((payload.operations ?? []).filter((operation) => operation.scope === "project" && !operation.mutating && operation.id !== "tests.run" && terminalAlias(operation.id))))
      .catch(() => setOperations([]))
  }, [kind])

  useEffect(() => {
    setSelectedTranscriptId(null)
    setHistoryVerdict(null)
    if (!historyScope || (kind !== "terminal" && kind !== "tests")) { setHistory([]); return }
    try {
      const restored = loadToolRunHistory(historyStorage ?? window.localStorage, historyScope)
      setHistory(historyForSurface(restored.runs, kind))
      if (restored.error) setHistoryVerdict("Saved browser transcript history was corrupt and was not loaded.")
    } catch {
      setHistory([])
      setHistoryVerdict("Saved browser transcript history is unavailable.")
    }
  }, [historyScope, historyStorage, kind])

  useEffect(() => {
    const node = output.current
    if (node && typeof node.scrollTo === "function") node.scrollTo({ top: node.scrollHeight })
  }, [lines])

  const settleRun = useCallback((run: ActiveRun, outcome: ToolRunTranscript["outcome"], nextLines: readonly ToolOutputLine[]) => {
    if (activeRun.current?.id !== run.id) return
    activeRun.current = null
    setRunning(null)
    const transcript: ToolRunTranscript = {
      schemaVersion: 1, id: run.id, operationId: run.operationId, operationLabel: run.operationLabel,
      alias: run.alias, startedAt: run.startedAt, endedAt: new Date().toISOString(), outcome, lines: boundedLines(nextLines),
    }
    const scope = historyScopeRef.current
    if (!scope) { setHistoryVerdict("Browser transcript not saved: this Space has no durable history scope."); return }
    try {
      const verdict = persistToolRunTranscript(historyStorageRef.current ?? window.localStorage, scope, transcript)
      if (!verdict.ok) { setHistoryVerdict("Browser transcript not saved."); return }
      setHistory(historyForSurface(verdict.runs, kind))
      setHistoryVerdict(outcome.status === "cancelled" ? "cancelled · saved browser transcript"
        : outcome.status === "interrupted" ? "interrupted · saved browser transcript" : "Transcript saved in this browser.")
    } catch {
      setHistoryVerdict("Browser transcript not saved.")
    }
  }, [kind])

  const stop = useCallback(() => {
    const active = activeRun.current
    if (active) {
      const next = [...active.lines, { channel: "meta", text: "CANCELLED" } satisfies ToolOutputLine]
      active.lines = next
      setLines(next)
      settleRun(active, { status: "cancelled", code: null, reason: "CANCELLED" }, next)
    }
    controller.current?.abort()
    controller.current = null
    setRunning(null)
  }, [settleRun])

  useEffect(() => () => {
    const active = activeRun.current
    if (active) settleRun(active, { status: "interrupted", code: null, reason: "INTERRUPTED" }, [...active.lines, { channel: "meta", text: "INTERRUPTED" }])
    controller.current?.abort()
    diffController.current?.abort()
  }, [settleRun])

  const run = useCallback(async (operation: string, alias = terminalAlias(operation) ?? operation) => {
    stop()
    setSelectedTranscriptId(null)
    setLines([])
    setError(null)
    setCommandVerdict(null)
    setHistoryVerdict(null)
    const catalogued = LOOM_OPERATIONS.find((candidate) => candidate.id === operation)
    const startedAt = new Date().toISOString()
    const current: ActiveRun = {
      id: `${startedAt}:${++runSequence.current}`, operationId: operation,
      operationLabel: catalogued?.label ?? operations.find((candidate) => candidate.id === operation)?.label ?? operation,
      alias, startedAt, lines: [],
    }
    activeRun.current = current
    setRunning(operation)
    const abort = new AbortController()
    controller.current = abort
    let receivedExit = false
    try {
      const response = await fetch("/api/loom/run", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation }),
        signal: abort.signal, cache: "no-store",
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
            current.lines.push({ channel: event.type, text: event.text ?? "" })
            setLines([...current.lines])
          } else if (event.type === "exit") {
            receivedExit = true
            current.lines.push({ channel: "meta", text: event.reason ?? `exit ${event.code}` })
            setLines([...current.lines])
            settleRun(current, { status: "completed", code: event.code ?? null, reason: event.reason ?? null }, current.lines)
          }
        }
      }
      if (!receivedExit && activeRun.current?.id === current.id) {
        const next = [...current.lines, { channel: "meta", text: "INTERRUPTED" } satisfies ToolOutputLine]
        current.lines = next
        setLines(next)
        settleRun(current, { status: "interrupted", code: null, reason: "INTERRUPTED" }, next)
      }
    } catch (caught) {
      if ((caught as Error)?.name !== "AbortError" && activeRun.current?.id === current.id) {
        setError(caught instanceof Error ? caught.message : "RUN_UNAVAILABLE")
        const next = [...current.lines, { channel: "meta", text: "INTERRUPTED" } satisfies ToolOutputLine]
        current.lines = next
        setLines(next)
        settleRun(current, { status: "interrupted", code: null, reason: "INTERRUPTED" }, next)
      }
    } finally {
      if (activeRun.current?.id === current.id) { activeRun.current = null; setRunning(null) }
      if (controller.current === abort) controller.current = null
    }
  }, [operations, settleRun, stop])

  const executeCommand = useCallback(() => {
    const operation = resolveProjectTerminalAlias(command)
    if (!operation || !operations.some((available) => available.id === operation.id)) {
      setCommandVerdict(`Not run: “${command}” is not a fixed project alias.`)
      return
    }
    void run(operation.id, operation.terminalAlias)
  }, [command, operations, run])

  const completeCommand = useCallback(() => {
    const candidate = command.trim()
    const matches = operations.map((operation) => terminalAlias(operation.id)).filter((alias): alias is string => Boolean(alias?.startsWith(candidate)))
    if (matches.length !== 1) return false
    setCommand(matches[0])
    return true
  }, [command, operations])

  const selectedTranscript = useMemo(() => history.find((item) => item.id === selectedTranscriptId) ?? null, [history, selectedTranscriptId])
  const visibleLines = selectedTranscript?.lines ?? lines
  const transcriptTruth = selectedTranscript?.outcome.status === "completed" ? "Saved browser transcript · not live evidence"
    : selectedTranscript?.outcome.status === "cancelled" ? "Cancelled · not completed or live evidence"
      : selectedTranscript ? "Interrupted · not completed or live evidence" : null
  const title = kind === "tests" ? "Focused validation" : kind === "diff" ? "Current change" : "Project terminal"

  return (
    <section className={styles.utilitySurface} aria-label={title}>
      <header className={styles.utilityMeta}><span>{title}</span><span>{running ? `Running ${running}` : error ? error : "Live workspace state"}</span></header>
      <div className={styles.utilityBody}>
        {kind === "diff" ? <>
          <div className={styles.utilityControls}>
            <span className={styles.muted}>{selectedPath ? `HEAD · ${selectedPath}` : "HEAD · working tree"}</span>
            <button type="button" className={styles.utilityButton} onClick={refreshDiff}>Refresh</button>
          </div>
          {status ? <pre className={styles.utilityOutput}>{status}</pre> : null}
          {error ? <output className={styles.utilityOutput}>Unable to refresh current change: {error}</output> : null}
          <pre className={styles.utilityOutput}>{diff || (error ? "" : "No changes against HEAD.")}</pre>
        </> : <>
          {kind === "terminal" ? <form className={styles.utilityControls} onSubmit={(event) => { event.preventDefault(); executeCommand() }}>
            <span aria-hidden="true">$</span>
            <input aria-label="Project terminal command" autoComplete="off" disabled={running !== null}
              style={{ flex: "1 1 180px", minWidth: 0, border: "1px solid #3b4939", borderRadius: 5, padding: "5px 8px", background: "#090d09", color: "#c8d2c4", font: "inherit" }}
              placeholder="git status" value={command} onChange={(event) => { setCommand(event.target.value); setCommandVerdict(null) }}
              onKeyDown={(event) => {
                if (event.key === "Tab" && completeCommand()) event.preventDefault()
                if (event.key === "Enter") { event.preventDefault(); executeCommand() }
              }} />
            <button type="submit" className={styles.utilityButton} disabled={running !== null}>Run</button>
          </form> : null}
          <div className={styles.utilityControls}>
            {kind === "tests" ? <button type="button" className={styles.utilityButton} disabled={running !== null} onClick={() => void run("tests.run", "test")}>Run full test suite</button>
              : operations.map((operation) => <button key={operation.id} type="button" aria-label={operation.label} className={styles.utilityButton}
                disabled={running !== null} title={operation.intent} onClick={() => { const alias = terminalAlias(operation.id); if (alias) { setCommand(alias); void run(operation.id, alias) } }}>{operation.label}</button>)}
            {running ? <button type="button" className={styles.utilityStop} onClick={stop}>Stop</button> : null}
          </div>
          {commandVerdict ? <output className={styles.muted}>{commandVerdict}</output> : null}
          {history.length ? <nav className={styles.utilityControls} aria-label="Saved browser transcripts" style={{ flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
            <button type="button" className={styles.utilityButton} aria-pressed={selectedTranscriptId === null} onClick={() => setSelectedTranscriptId(null)}>Live output</button>
            {history.slice().reverse().map((transcript) => <button type="button" className={styles.utilityButton} key={transcript.id}
              aria-pressed={selectedTranscriptId === transcript.id} aria-label={`${transcript.alias} · ${transcript.outcome.status} · saved browser transcript`}
              onClick={() => setSelectedTranscriptId(transcript.id)}>{transcript.alias} · {transcript.outcome.status}</button>)}
          </nav> : null}
          {transcriptTruth ? <p className={styles.muted}>{transcriptTruth}</p> : null}
          {!selectedTranscript && historyVerdict ? <output className={styles.muted}>{historyVerdict}</output> : null}
          <pre ref={output} className={styles.utilityOutput} aria-live="polite">{visibleLines.length === 0
            ? kind === "tests" ? "Tests have not run in this Space yet." : "Type one fixed alias. Tab completes; Enter runs. No shell text is accepted."
            : visibleLines.map((line, index) => <span key={index} data-channel={line.channel}>{line.text}</span>)}</pre>
        </>}
      </div>
    </section>
  )
}
