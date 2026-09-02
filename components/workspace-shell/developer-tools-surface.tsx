"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LOOM_OPERATIONS, resolveProjectTerminalCommand } from "@/lib/loom/operations"
import styles from "./experience-spatial.module.css"
import { loadDiffBrowserSnapshot, persistDiffBrowserSnapshot } from "./diff-snapshot-history"
import { loadToolRunHistory, persistToolRunTranscript, type ToolOutputLine, type ToolRunTranscript } from "./tool-run-history"

type DeveloperToolKind = "tests" | "diff" | "terminal"
export type LiveDiffContext = Readonly<{ path: string; fingerprint: string }>
type Operation = Readonly<{ id: string; label: string; intent: string; scope: "project" | "runtime"; mutating: boolean }>
type ActiveRun = {
  id: string
  kind: DeveloperToolKind
  operationId: string
  operationLabel: string
  alias: string
  startedAt: string
  lines: ToolOutputLine[]
  historyScope: string | null
  historyStorage: Pick<Storage, "getItem" | "setItem"> | null
}

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

function presentationMatches(run: ActiveRun, scope: string | null, storage: Pick<Storage, "getItem" | "setItem"> | null, kind: DeveloperToolKind): boolean {
  return run.kind === kind && run.historyScope === scope && run.historyStorage === storage
}

export function DeveloperToolsSurface({ kind, projectKey = "terrafusion", worldId = null, selectedPath, active = true, historyScope = null, historyStorage = null, refreshKey = 0, refreshPath = null, onRefreshSettled, onRunningChange, onLiveDiffContextChange }: {
  kind: DeveloperToolKind
  projectKey?: "terrafusion" | "williamos"
  worldId?: string | null
  selectedPath: string | null
  active?: boolean
  historyScope?: string | null
  historyStorage?: Pick<Storage, "getItem" | "setItem"> | null
  refreshKey?: number
  refreshPath?: string | null
  onRefreshSettled?: (path: string, key: number, result: "refreshed" | "failed") => void
  onRunningChange?: (running: Readonly<{ kind: "tests" | "terminal"; operationId: string }> | null) => void
  onLiveDiffContextChange?: (context: LiveDiffContext | null) => void
}) {
  const [diff, setDiff] = useState("")
  const [status, setStatus] = useState("")
  const [diffSnapshot, setDiffSnapshot] = useState(false)
  const [diffHistoryVerdict, setDiffHistoryVerdict] = useState<string | null>(null)
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
  const surfaceKindRef = useRef(kind)
  surfaceKindRef.current = kind
  const diffController = useRef<AbortController | null>(null)
  const diffRequestEpoch = useRef(0)
  const completedRefresh = useRef<Readonly<{ key: number; path: string | null }>>({ key: refreshKey, path: null })
  const governedRefresh = useRef<Readonly<{ key: number; path: string }> | null>(null)
  const refreshSettled = useRef(onRefreshSettled)
  const runningChanged = useRef(onRunningChange)
  const liveDiffContextChanged = useRef(onLiveDiffContextChange)
  const output = useRef<HTMLPreElement>(null)

  useEffect(() => { refreshSettled.current = onRefreshSettled }, [onRefreshSettled])
  useEffect(() => { runningChanged.current = onRunningChange }, [onRunningChange])
  useEffect(() => { liveDiffContextChanged.current = onLiveDiffContextChange }, [onLiveDiffContextChange])
  useEffect(() => {
    if (kind !== "tests" && kind !== "terminal") return
    runningChanged.current?.(running && activeRun.current?.kind === kind ? { kind, operationId: running } : null)
  }, [kind, running])
  useEffect(() => { historyScopeRef.current = historyScope }, [historyScope])
  useEffect(() => { historyStorageRef.current = historyStorage }, [historyStorage])

  const loadDiff = useCallback(async (path = selectedPath, preserveSavedSnapshot = false): Promise<"refreshed" | "failed" | "aborted"> => {
    const epoch = diffRequestEpoch.current + 1
    diffRequestEpoch.current = epoch
    diffController.current?.abort()
    const abort = new AbortController()
    diffController.current = abort
    if (!preserveSavedSnapshot) {
      setDiff("")
      setStatus("")
      setDiffSnapshot(false)
    }
    liveDiffContextChanged.current?.(null)
    setError(null)
    const query = path ? `?path=${encodeURIComponent(path)}${projectKey === "williamos" ? "&projectKey=williamos" : ""}` : projectKey === "williamos" ? "?projectKey=williamos" : ""
    const scope = historyScopeRef.current
    const snapshotStorage = historyStorageRef.current
    try {
      const response = await fetch(`/api/loom/diff${query}`, { cache: "no-store", signal: abort.signal })
      const payload = await response.json() as { error?: string; path?: string; state?: string; fingerprint?: string; diff?: string; status?: string; note?: string; untracked?: boolean }
      if (!response.ok) throw new Error(payload.error ?? `DIFF_${response.status}`)
      if (diffRequestEpoch.current !== epoch || abort.signal.aborted) return "aborted"
      const nextDiff = payload.untracked ? payload.note ?? "This file is new." : payload.diff ?? ""
      const nextStatus = payload.status ?? ""
      setDiff(nextDiff)
      setStatus(nextStatus)
      setDiffSnapshot(false)
      const exactPath = path ?? null
      liveDiffContextChanged.current?.(
        exactPath !== null
          && payload.path === exactPath
          && payload.state === "modified"
          && typeof payload.fingerprint === "string"
          && payload.fingerprint.length > 0
          && payload.fingerprint.length <= 16_384
          ? { path: exactPath, fingerprint: payload.fingerprint }
          : null,
      )
      if (scope) {
        const saved = persistDiffBrowserSnapshot(snapshotStorage ?? window.localStorage, scope, {
          schemaVersion: 1,
          path: path ?? null,
          diff: nextDiff,
          status: nextStatus,
          capturedAt: new Date().toISOString(),
        })
        if (historyScopeRef.current === scope && historyStorageRef.current === snapshotStorage) {
          setDiffHistoryVerdict(saved ? null : "Changes snapshot not saved in this browser.")
        }
      }
      return "refreshed"
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return "aborted"
      if (diffRequestEpoch.current !== epoch || abort.signal.aborted) return "aborted"
      liveDiffContextChanged.current?.(null)
      setError(caught instanceof Error ? caught.message : "DIFF_UNAVAILABLE")
      return "failed"
    } finally {
      if (diffController.current === abort) diffController.current = null
    }
  }, [projectKey, selectedPath])

  useEffect(() => {
    if (kind !== "diff") return
    liveDiffContextChanged.current?.(null)
    setDiff("")
    setStatus("")
    setDiffSnapshot(false)
    setDiffHistoryVerdict(null)
    setError(null)
    if (!historyScope) return
    try {
      const restored = loadDiffBrowserSnapshot(historyStorage ?? window.localStorage, historyScope)
      if (restored.error) {
        setDiffHistoryVerdict(restored.error === "DIFF_SNAPSHOT_UNAVAILABLE"
          ? "Saved Changes snapshot history is unavailable."
          : "Saved Changes snapshot was corrupt and was not loaded.")
        return
      }
      const snapshot = restored.snapshot
      if (!snapshot || snapshot.path !== selectedPath) return
      setDiff(snapshot.diff)
      setStatus(snapshot.status)
      setDiffSnapshot(true)
    } catch {
      // Browser persistence is optional; current workspace truth can still load.
    }
  }, [historyScope, historyStorage, kind, selectedPath])

  useEffect(() => { if (kind === "diff") void loadDiff(undefined, true) }, [historyScope, historyStorage, kind, loadDiff])

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
    setLines([])
    setError(null)
    setCommand("")
    setCommandVerdict(null)
    if (!historyScope || (kind !== "terminal" && kind !== "tests")) { setHistory([]); return }
    try {
      const restored = loadToolRunHistory(historyStorage ?? window.localStorage, historyScope)
      const relevantHistory = historyForSurface(restored.runs, kind)
      setHistory(relevantHistory)
      setSelectedTranscriptId(relevantHistory.at(-1)?.id ?? null)
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
    const scope = run.historyScope
    if (!scope) {
      if (presentationMatches(run, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) setHistoryVerdict("Browser transcript not saved: this Space has no durable history scope.")
      return
    }
    try {
      const verdict = persistToolRunTranscript(run.historyStorage ?? window.localStorage, scope, transcript)
      if (!presentationMatches(run, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) return
      if (!verdict.ok) { setHistoryVerdict("Browser transcript not saved."); return }
      setHistory(historyForSurface(verdict.runs, run.kind))
      setHistoryVerdict(outcome.status === "cancelled" ? "cancelled · saved browser transcript"
        : outcome.status === "interrupted" ? "interrupted · saved browser transcript" : "Transcript saved in this browser.")
    } catch {
      if (presentationMatches(run, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) setHistoryVerdict("Browser transcript not saved.")
    }
  }, [])

  const stop = useCallback(() => {
    const active = activeRun.current
    if (active) {
      const next = [...active.lines, { channel: "meta", text: "CANCELLED" } satisfies ToolOutputLine]
      active.lines = next
      if (presentationMatches(active, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) setLines(next)
      settleRun(active, { status: "cancelled", code: null, reason: "CANCELLED" }, next)
    }
    controller.current?.abort()
    controller.current = null
    setRunning(null)
  }, [settleRun])

  useEffect(() => {
    const active = activeRun.current
    if (!active || active.kind === kind) return
    const next = [...active.lines, { channel: "meta", text: "INTERRUPTED" } satisfies ToolOutputLine]
    active.lines = next
    settleRun(active, { status: "interrupted", code: null, reason: "INTERRUPTED" }, next)
    controller.current?.abort()
    controller.current = null
  }, [kind, settleRun])

  useEffect(() => () => {
    const active = activeRun.current
    if (active) settleRun(active, { status: "interrupted", code: null, reason: "INTERRUPTED" }, [...active.lines, { channel: "meta", text: "INTERRUPTED" }])
    controller.current?.abort()
    diffController.current?.abort()
    liveDiffContextChanged.current?.(null)
  }, [settleRun])

  const run = useCallback(async (operation: string, alias = terminalAlias(operation) ?? operation, terminalCommand?: string) => {
    stop()
    setSelectedTranscriptId(null)
    setLines([])
    setError(null)
    setCommandVerdict(null)
    setHistoryVerdict(null)
    const catalogued = LOOM_OPERATIONS.find((candidate) => candidate.id === operation)
    const startedAt = new Date().toISOString()
    const current: ActiveRun = {
      id: `${startedAt}:${++runSequence.current}`, kind, operationId: operation,
      operationLabel: catalogued?.label ?? operations.find((candidate) => candidate.id === operation)?.label ?? operation,
      alias, startedAt, lines: [], historyScope: historyScopeRef.current, historyStorage: historyStorageRef.current,
    }
    activeRun.current = current
    setRunning(operation)
    const abort = new AbortController()
    controller.current = abort
    let receivedExit = false
    try {
      const response = await fetch("/api/loom/run", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(terminalCommand
          ? { ...(worldId ? { worldId } : {}), ...(projectKey === "williamos" ? { projectKey } : {}), operation, terminalCommand }
          : { ...(worldId ? { worldId } : {}), ...(projectKey === "williamos" ? { projectKey } : {}), operation }),
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
            if (presentationMatches(current, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) setLines([...current.lines])
          } else if (event.type === "exit") {
            receivedExit = true
            current.lines.push({ channel: "meta", text: event.reason ?? `exit ${event.code}` })
            if (presentationMatches(current, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) setLines([...current.lines])
            const outcome: ToolRunTranscript["outcome"] = event.reason === "CANCELLED"
              ? { status: "cancelled", code: null, reason: event.reason }
              : typeof event.code === "number" && event.reason == null
                ? { status: "completed", code: event.code, reason: null }
                : { status: "interrupted", code: typeof event.code === "number" ? event.code : null, reason: event.reason ?? null }
            settleRun(current, outcome, current.lines)
          }
        }
      }
      if (!receivedExit && activeRun.current?.id === current.id) {
        const next = [...current.lines, { channel: "meta", text: "INTERRUPTED" } satisfies ToolOutputLine]
        current.lines = next
        if (presentationMatches(current, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)) setLines(next)
        settleRun(current, { status: "interrupted", code: null, reason: "INTERRUPTED" }, next)
      }
    } catch (caught) {
      if ((caught as Error)?.name !== "AbortError" && activeRun.current?.id === current.id) {
        const present = presentationMatches(current, historyScopeRef.current, historyStorageRef.current, surfaceKindRef.current)
        if (present) setError(caught instanceof Error ? caught.message : "RUN_UNAVAILABLE")
        const next = [...current.lines, { channel: "meta", text: "INTERRUPTED" } satisfies ToolOutputLine]
        current.lines = next
        if (present) setLines(next)
        settleRun(current, { status: "interrupted", code: null, reason: "INTERRUPTED" }, next)
      }
    } finally {
      if (activeRun.current?.id === current.id) { activeRun.current = null; setRunning(null) }
      if (controller.current === abort) controller.current = null
    }
  }, [kind, operations, projectKey, settleRun, stop, worldId])

  const executeCommand = useCallback(() => {
    const operation = resolveProjectTerminalCommand(command)
    if (!operation || !operations.some((available) => available.id === operation.id)) {
      setCommandVerdict(`Not run: “${command}” is outside the safe project-command grammar.`)
      return
    }
    setCommand(operation.terminalAlias ?? command.trim())
    void run(operation.id, operation.terminalAlias, operation.terminalAlias)
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
  const surfaceRunning = activeRun.current?.kind === kind ? running : null

  return (
    <section className={styles.utilitySurface} aria-label={title}>
      <header className={styles.utilityMeta}><span>{title}</span><span>{transcriptTruth ?? (surfaceRunning ? `Running ${surfaceRunning}` : error ? error : kind === "diff" && diffSnapshot ? "Saved browser snapshot · not live evidence" : "Live workspace state")}</span></header>
      <div className={styles.utilityBody}>
        {kind === "diff" ? <>
          <div className={styles.utilityControls}>
            <span className={styles.muted}>{selectedPath ? `HEAD · ${selectedPath}` : "HEAD · working tree"}</span>
            <button type="button" className={styles.utilityButton} onClick={refreshDiff}>Refresh</button>
          </div>
          {status ? <pre className={styles.utilityOutput}>{status}</pre> : null}
          {error ? <output className={styles.utilityOutput}>Unable to refresh current change: {error}</output> : null}
          {diffHistoryVerdict ? <output className={styles.muted}>{diffHistoryVerdict}</output> : null}
          <pre className={styles.utilityOutput}>{diff || (error ? "" : "No changes against HEAD.")}</pre>
        </> : <>
          {kind === "terminal" ? <form className={styles.utilityControls} onSubmit={(event) => { event.preventDefault(); executeCommand() }}>
            <span aria-hidden="true">$</span>
            <input aria-label="Project terminal command" aria-describedby="project-terminal-guide" autoComplete="off" disabled={surfaceRunning !== null}
              style={{ flex: "1 1 180px", minWidth: 0, border: "1px solid #3b4939", borderRadius: 5, padding: "5px 8px", background: "#090d09", color: "#c8d2c4", font: "inherit" }}
              placeholder="git status --short" value={command} onChange={(event) => { setCommand(event.target.value); setCommandVerdict(null) }}
              onKeyDown={(event) => {
                if (event.key === "Tab" && completeCommand()) event.preventDefault()
                if (event.key === "Enter") { event.preventDefault(); executeCommand() }
              }} />
            <button type="submit" className={styles.utilityButton} disabled={surfaceRunning !== null}>Run</button>
          </form> : null}
          {kind === "terminal" ? <p id="project-terminal-guide" className={styles.terminalGuide}>
            Read-only project shell · git status, diff, and log accept common inspection flags. Build and test remain bounded actions.
          </p> : null}
          <div className={styles.utilityControls}>
            {kind === "tests" ? <button type="button" className={styles.utilityButton} disabled={surfaceRunning !== null || !active} onClick={() => void run("tests.run", "test")}>{projectKey === "williamos" ? "Run deterministic suite" : "Run full test suite"}</button>
              : operations.map((operation) => <button key={operation.id} type="button" aria-label={operation.label} className={styles.utilityButton}
                disabled={surfaceRunning !== null} title={operation.intent} onClick={() => { const alias = terminalAlias(operation.id); if (alias) { setCommand(alias); void run(operation.id, alias) } }}>{operation.label}</button>)}
            {surfaceRunning ? <button type="button" className={styles.utilityStop} onClick={stop}>Stop</button> : null}
          </div>
          {commandVerdict ? <output className={styles.muted}>{commandVerdict}</output> : null}
          {history.length ? <nav className={styles.utilityControls} aria-label="Saved browser transcripts" style={{ flexWrap: "nowrap", overflowX: "auto", paddingBottom: 4 }}>
            <button type="button" className={styles.utilityButton} aria-pressed={selectedTranscriptId === null} onClick={() => setSelectedTranscriptId(null)}>Live output</button>
            {history.slice().reverse().map((transcript) => <button type="button" className={styles.utilityButton} key={transcript.id}
              aria-pressed={selectedTranscriptId === transcript.id} aria-label={`${transcript.alias} · ${transcript.outcome.status} · saved browser transcript`}
              onClick={() => setSelectedTranscriptId(transcript.id)}>{transcript.alias} · {transcript.outcome.status}</button>)}
          </nav> : null}
          {!selectedTranscript && historyVerdict ? <output className={styles.muted}>{historyVerdict}</output> : null}
          <pre ref={output} className={styles.utilityOutput} aria-live="polite">{visibleLines.length === 0
            ? kind === "tests" ? active ? "Tests have not run in this Space yet." : "Focus Tests before running validation." : "Type a safe project command. Tab completes known actions; Enter runs. Mutating or shell-interpreted text is refused."
            : visibleLines.map((line, index) => <span key={index} data-channel={line.channel}>{line.text}</span>)}</pre>
        </>}
      </div>
    </section>
  )
}
