"use client"

import { useEffect, useRef, useState } from "react"
import { Play, RotateCw, Square } from "lucide-react"

import { HelloApplicationAssistant } from "./hello-application-assistant"
import styles from "./hello-application-controls.module.css"

type RuntimeSnapshot = Readonly<{
  state: "stopped" | "starting" | "running" | "failed"
  pid: number | null
  url: string | null
  error?: string | null
}>

type RuntimeTruth = Readonly<{
  runtimeBuild: Readonly<{ sha: string; builtAt: string | null }>
  activeProjectHead: string
}>

type RuntimeStatusPayload = Readonly<{
  runtime: RuntimeSnapshot
  truth: RuntimeTruth
}>

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `HELLO_APPLICATION_${response.status}`)
  return payload
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function readRuntimeStatus(): Promise<RuntimeStatusPayload> {
  const response = await fetch("/api/projects/hello-application/runtime", { cache: "no-store" })
  return responseJson<RuntimeStatusPayload>(response)
}

export function HelloApplicationControls({
  onPreviewRefresh,
}: Readonly<{ onPreviewRefresh: () => void }>) {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [runtimeTruth, setRuntimeTruth] = useState<RuntimeTruth | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(true)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const runtimeOperationInFlight = useRef(false)
  const queuedRuntimeRead = useRef(false)
  const mounted = useRef(false)
  const runtimeLifecycle = useRef(0)

  useEffect(() => {
    const lifecycle = ++runtimeLifecycle.current
    mounted.current = true
    requestRuntimeRead(false, lifecycle)
    return () => {
      if (runtimeLifecycle.current !== lifecycle) return
      runtimeLifecycle.current += 1
      mounted.current = false
      runtimeOperationInFlight.current = false
      queuedRuntimeRead.current = false
    }
  }, [])

  function activeRuntimeLifecycle(lifecycle: number) {
    return mounted.current && runtimeLifecycle.current === lifecycle
  }

  function finishRuntimeOperation(lifecycle: number) {
    if (!activeRuntimeLifecycle(lifecycle)) return
    if (queuedRuntimeRead.current) {
      queuedRuntimeRead.current = false
      void performRuntimeRead(lifecycle)
      return
    }
    runtimeOperationInFlight.current = false
    setRuntimeBusy(false)
  }

  async function performRuntimeRead(lifecycle: number) {
    try {
      const payload = await readRuntimeStatus()
      if (activeRuntimeLifecycle(lifecycle) && !queuedRuntimeRead.current) {
        setRuntime(payload.runtime)
        setRuntimeTruth(payload.truth)
      }
    } catch (cause) {
      if (activeRuntimeLifecycle(lifecycle) && !queuedRuntimeRead.current) {
        setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_STATUS_UNAVAILABLE")}`)
      }
    } finally {
      finishRuntimeOperation(lifecycle)
    }
  }

  function requestRuntimeRead(clearTruth = true, lifecycle = runtimeLifecycle.current) {
    if (!activeRuntimeLifecycle(lifecycle)) return
    if (clearTruth) {
      setRuntimeError(null)
      setRuntimeTruth(null)
    }
    if (runtimeOperationInFlight.current) {
      queuedRuntimeRead.current = true
      return
    }
    runtimeOperationInFlight.current = true
    setRuntimeBusy(true)
    void performRuntimeRead(lifecycle)
  }

  function refreshPreviewAndTruth() {
    onPreviewRefresh()
    requestRuntimeRead()
  }

  async function changeRuntime(method: "POST" | "DELETE") {
    const lifecycle = runtimeLifecycle.current
    if (!activeRuntimeLifecycle(lifecycle) || runtimeOperationInFlight.current) return
    runtimeOperationInFlight.current = true
    setRuntimeBusy(true)
    setRuntimeError(null)
    setRuntimeTruth(null)
    try {
      const response = await fetch("/api/projects/hello-application/runtime", {
        method,
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson<{ runtime: RuntimeSnapshot }>(response)
      if (activeRuntimeLifecycle(lifecycle)) {
        setRuntime(payload.runtime)
        onPreviewRefresh()
      }
    } catch (cause) {
      if (activeRuntimeLifecycle(lifecycle)) {
        setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_RUNTIME_FAILED")}`)
      }
    } finally {
      if (activeRuntimeLifecycle(lifecycle)) queuedRuntimeRead.current = true
      finishRuntimeOperation(lifecycle)
    }
  }

  return (
    <section className={styles.controls} aria-label="Hello Application runtime and HERMES change controls">
      <div className={styles.runtimeStrip}>
        <span className={styles.identity}><span aria-hidden className={styles.signal} />Hello Application</span>
        <span className={styles.runtimeState} data-state={runtime?.state ?? "loading"}>
          Runtime {runtime?.state ?? "checking"}
          {runtime?.pid ? <span> · PID {runtime.pid}</span> : null}
        </span>
        <span className={styles.actions}>
          {runtime?.state === "running" ? (
            <button type="button" onClick={() => void changeRuntime("DELETE")} disabled={runtimeBusy} aria-label="Stop application">
              <Square size={13} aria-hidden /> Stop
            </button>
          ) : (
            <button type="button" onClick={() => void changeRuntime("POST")} disabled={runtimeBusy} aria-label="Start application">
              <Play size={13} aria-hidden /> Start
            </button>
          )}
          <button type="button" onClick={() => void refreshPreviewAndTruth()} disabled={runtimeBusy} aria-label="Refresh preview">
            <RotateCw size={13} aria-hidden /> Refresh
          </button>
        </span>
      </div>

      {runtimeTruth ? (
        <div className={styles.runtimeTruth} aria-label="Hello Application runtime truth">
          <span>Runtime build <code>{runtimeTruth.runtimeBuild.sha}</code></span>
          <span>Active project HEAD <code>{runtimeTruth.activeProjectHead}</code></span>
        </div>
      ) : null}

      {runtimeError ? <p className={styles.runtimeError} role="alert">{runtimeError}</p> : null}
      <HelloApplicationAssistant onPreviewRefresh={() => { void refreshPreviewAndTruth() }} />
    </section>
  )
}
