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
  started: boolean
  terminal: Receipt | null
  malformed: boolean
  stopRequested: boolean
  reader: ReadableStreamDefaultReader<Uint8Array> | null
}

const idle: ChangeState = { phase: "settled", running: false, path: null, progress: null, outcome: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function useSelectedFileChange({
  path,
  dirty,
  onVerifiedSuccess,
}: {
  path: string | null
  dirty: boolean
  onVerifiedSuccess: (path: string) => Promise<ChangeRefreshResult> | ChangeRefreshResult
}) {
  const active = useRef<ActiveChange | null>(null)
  const verifiedSuccess = useRef(onVerifiedSuccess)
  const [state, setState] = useState<ChangeState>(idle)

  useEffect(() => { verifiedSuccess.current = onVerifiedSuccess }, [onVerifiedSuccess])
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

  const start = useCallback(async (task: string) => {
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
      started: false,
      terminal: null,
      malformed: false,
      stopRequested: false,
      reader: null,
    }
    active.current = operation
    setState({ phase: "streaming", running: true, path, progress: "Starting Change…", outcome: null })

    const rejectProtocol = () => { operation.malformed = true }
    const accept = (value: unknown) => {
      if (!isRecord(value) || operation.terminal) return rejectProtocol()
      if (value.type === "started") {
        if (operation.started || value.file !== operation.path) return rejectProtocol()
        operation.started = true
        setState((current) => ({ ...current, progress: `Working on ${operation.path}.` }))
        return
      }
      if (value.type === "progress") {
        if (!operation.started || typeof value.text !== "string") return rejectProtocol()
        const progress = value.text
        setState((current) => ({ ...current, progress }))
        return
      }
      if (value.type === "done") {
        if (!operation.started || !isRecord(value.receipt) || typeof value.receipt.success !== "boolean") return rejectProtocol()
        operation.terminal = { success: value.receipt.success }
        setState((current) => ({ ...current, progress: "Governed receipt received; waiting for stream completion." }))
        return
      }
      rejectProtocol()
    }

    const settle = async () => {
      if (operation.stopRequested) {
        setState({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Stop requested. Change outcome is unknown." })
      } else if (operation.malformed || !operation.terminal) {
        setState({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Change did not return a valid completion receipt." })
      } else if (!operation.terminal.success) {
        setState({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Change was not verified." })
      } else {
        setState({ phase: "refreshing", running: true, path: operation.path, progress: "Refreshing source and diff…", outcome: null })
        const refresh = await verifiedSuccess.current(operation.path)
        if (active.current !== operation) return
        const outcome = refresh === "refreshed"
          ? "Change applied; source and diff refreshed."
          : refresh === "dirty-conflict"
            ? `Change was verified, but ${operation.path} has unsaved editor changes; source was not refreshed.`
            : "Change was verified, but source or diff refresh failed."
        setState({ phase: "settled", running: false, path: operation.path, progress: null, outcome })
      }
    }

    try {
      const response = await fetch("/api/loom/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: operation.path, task }),
        signal: operation.controller.signal,
        cache: "no-store",
      })
      if (!response.ok || !response.body) throw new Error(`CHANGE_${response.status}`)
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
      if (operation.stopRequested || operation.controller.signal.aborted) {
        setState({ phase: "settled", running: false, path: operation.path, progress: null, outcome: "Stop requested. Change outcome is unknown." })
      } else {
        setState({ phase: "settled", running: false, path: operation.path, progress: null, outcome: error instanceof Error ? `Change failed: ${error.message}` : "Change failed." })
      }
    } finally {
      if (active.current === operation) active.current = null
    }
  }, [dirty, path])

  return { ...state, canStop: state.phase === "streaming", start, stop, reset }
}
