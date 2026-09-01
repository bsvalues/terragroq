"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type ChangeRefreshResult = "refreshed" | "dirty-conflict" | "failed"
type ChangePhase = "streaming" | "refreshing" | "settled"

type ChangeState = Readonly<{
  phase: ChangePhase
  running: boolean
  path: string | null
  progress: string | null
  outcome: string | null
}>

type Receipt = Readonly<{ success: boolean }>
type ActiveChange = {
  controller: AbortController
  path: string
  scope: ChangeOperationScope | null
  started: boolean
  terminal: Receipt | null
  malformed: boolean
  stopRequested: boolean
  reader: ReadableStreamDefaultReader<Uint8Array> | null
}

export type DiffImproveRequest = Readonly<{
  intent: "improve-diff"
  worldId: string
  expectedDiffFingerprint: string
}>

export type ChangeOperationScope = Readonly<{
  worldId: string
  transitionEpoch: number
}>

const idle: ChangeState = { phase: "settled", running: false, path: null, progress: null, outcome: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function useSelectedFileChange({
  worldId,
  path,
  dirty,
  onVerifiedSuccess,
  isOperationScopeCurrent,
}: {
  worldId: string | null
  path: string | null
  dirty: boolean
  onVerifiedSuccess: (path: string) => Promise<ChangeRefreshResult> | ChangeRefreshResult
  isOperationScopeCurrent?: (scope: ChangeOperationScope) => boolean
}) {
  const active = useRef<ActiveChange | null>(null)
  const verifiedSuccess = useRef(onVerifiedSuccess)
  const scopeIsCurrent = useRef(isOperationScopeCurrent)
  const [state, setState] = useState<ChangeState>(idle)

  useEffect(() => { verifiedSuccess.current = onVerifiedSuccess }, [onVerifiedSuccess])
  useEffect(() => { scopeIsCurrent.current = isOperationScopeCurrent }, [isOperationScopeCurrent])
  useEffect(() => () => active.current?.controller.abort(), [])

  const stop = useCallback(() => {
    const operation = active.current
    if (!operation) return
    operation.stopRequested = true
    void operation.reader?.cancel()
    operation.controller.abort()
    setState({ phase: "streaming", running: true, path: operation.path, progress: null, outcome: "Stop requested. Change outcome is unknown." })
  }, [])

  const reset = useCallback((nextPath: string | null) => {
    if (active.current) return
    setState({ phase: "settled", running: false, path: nextPath, progress: null, outcome: null })
  }, [])

  const invalidate = useCallback(() => {
    const operation = active.current
    if (operation) {
      active.current = null
      void operation.reader?.cancel()
      operation.controller.abort()
    }
    setState(idle)
  }, [])

  const refuse = useCallback((message: string) => {
    if (active.current) return
    setState({ phase: "settled", running: false, path, progress: null, outcome: message })
  }, [path])

  const start = useCallback(async (
    task: string,
    improve?: DiffImproveRequest,
    beforeRequest?: () => Promise<void>,
    scope: ChangeOperationScope | null = null,
  ) => {
    if (active.current) return
    if (!path) {
      setState({ phase: "settled", running: false, path: null, progress: null, outcome: "Select a file before starting Change." })
      return
    }
    if (dirty) {
      setState({ phase: "settled", running: false, path, progress: null, outcome: `Save ${path} before starting Change.` })
      return
    }

    const operation: ActiveChange = {
      controller: new AbortController(),
      path,
      scope,
      started: false,
      terminal: null,
      malformed: false,
      stopRequested: false,
      reader: null,
    }
    active.current = operation
    const operationIsCurrent = () => active.current === operation
      && (!operation.scope || scopeIsCurrent.current?.(operation.scope) === true)
    const present = (next: ChangeState | ((current: ChangeState) => ChangeState)) => {
      if (!operationIsCurrent()) return
      setState(next)
    }
    present({ phase: "streaming", running: true, path, progress: "Starting Change…", outcome: null })

    const rejectProtocol = () => { operation.malformed = true }
    const accept = (value: unknown) => {
      if (!operationIsCurrent()) return
      if (!isRecord(value) || operation.terminal) return rejectProtocol()
      if (value.type === "started") {
        if (operation.started || value.file !== operation.path) return rejectProtocol()
        operation.started = true
        present((current) => ({ ...current, progress: `Working on ${operation.path}.` }))
        return
      }
      if (value.type === "progress") {
        if (!operation.started || typeof value.text !== "string") return rejectProtocol()
        const progress = value.text
        present((current) => ({ ...current, progress }))
        return
      }
      if (value.type === "done") {
        if (!operation.started || !isRecord(value.receipt) || typeof value.receipt.success !== "boolean") return rejectProtocol()
        operation.terminal = { success: value.receipt.success }
        present((current) => ({ ...current, progress: "Governed receipt received; waiting for stream completion." }))
        return
      }
      rejectProtocol()
    }

    const settle = async () => {
      if (!operationIsCurrent()) return
      if (operation.stopRequested) {
        present({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Stop requested. Change outcome is unknown." })
      } else if (operation.malformed || !operation.terminal) {
        present({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Change did not return a valid completion receipt." })
      } else if (!operation.terminal.success) {
        present({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Change was not verified." })
      } else {
        present({ phase: "refreshing", running: true, path: operation.path, progress: "Refreshing source and diff…", outcome: null })
        if (!operationIsCurrent()) return
        const refresh = await verifiedSuccess.current(operation.path)
        if (!operationIsCurrent()) return
        const outcome = refresh === "refreshed"
          ? "Change applied; source and diff refreshed."
          : refresh === "dirty-conflict"
            ? `Change was verified, but ${operation.path} has unsaved editor changes; source was not refreshed.`
            : "Change was verified, but source or diff refresh failed."
        present({ phase: "settled", running: false, path: operation.path, progress: null, outcome })
      }
    }

    try {
      if (beforeRequest) {
        present((current) => ({ ...current, progress: "Saving current Changes context…" }))
        await beforeRequest()
        if (operation.controller.signal.aborted || !operationIsCurrent()) throw new DOMException("aborted", "AbortError")
      }
      const response = await fetch("/api/loom/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId, path: operation.path, task, ...(improve ?? {}) }),
        signal: operation.controller.signal,
        cache: "no-store",
      })
      if (!operationIsCurrent()) {
        await response.body?.cancel()
        return
      }
      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null) as { error?: unknown } | null
        throw new Error(typeof payload?.error === "string" ? payload.error : `CHANGE_${response.status}`)
      }
      const reader = response.body.getReader()
      operation.reader = reader
      if (operation.stopRequested) {
        await reader.cancel()
        await settle()
        return
      }
      const decoder = new TextDecoder()
      let buffered = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffered += decoder.decode(value, { stream: true })
        const lines = buffered.split("\n")
        buffered = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try { accept(JSON.parse(line)) } catch { rejectProtocol() }
        }
      }
      buffered += decoder.decode()
      if (buffered.trim()) {
        try { accept(JSON.parse(buffered)) } catch { rejectProtocol() }
      }
      await settle()
    } catch (error) {
      if (!operationIsCurrent()) return
      if (operation.stopRequested || operation.controller.signal.aborted) {
        present({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Stop requested. Change outcome is unknown." })
      } else {
        present({ phase: "settled", running: false, path: operation.path, progress: null, outcome: error instanceof Error ? `Change failed: ${error.message}` : "Change failed." })
      }
    } finally {
      if (active.current === operation) active.current = null
    }
  }, [dirty, path, worldId])

  return { ...state, canStop: state.phase === "streaming", start, stop, reset, refuse, invalidate }
}
