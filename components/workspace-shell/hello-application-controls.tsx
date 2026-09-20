"use client"

import { useEffect, useState } from "react"
import { Play, RotateCw, Square } from "lucide-react"

import { HelloApplicationAssistant } from "./hello-application-assistant"
import styles from "./hello-application-controls.module.css"

type RuntimeSnapshot = Readonly<{
  state: "stopped" | "starting" | "running" | "failed"
  pid: number | null
  url: string | null
  error?: string | null
}>

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `HELLO_APPLICATION_${response.status}`)
  return payload
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

export function HelloApplicationControls({
  onPreviewRefresh,
}: Readonly<{ onPreviewRefresh: () => void }>) {
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(false)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    void fetch("/api/projects/hello-application/runtime", { cache: "no-store" })
      .then((response) => responseJson<{ runtime: RuntimeSnapshot }>(response))
      .then(({ runtime: snapshot }) => {
        if (current) setRuntime(snapshot)
      })
      .catch((cause) => {
        if (current) setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_STATUS_UNAVAILABLE")}`)
      })
    return () => { current = false }
  }, [])

  async function changeRuntime(method: "POST" | "DELETE") {
    if (runtimeBusy) return
    setRuntimeBusy(true)
    setRuntimeError(null)
    try {
      const response = await fetch("/api/projects/hello-application/runtime", {
        method,
        headers: { "content-type": "application/json" },
      })
      const payload = await responseJson<{ runtime: RuntimeSnapshot }>(response)
      setRuntime(payload.runtime)
      onPreviewRefresh()
    } catch (cause) {
      setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_RUNTIME_FAILED")}`)
    } finally {
      setRuntimeBusy(false)
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
          <button type="button" onClick={onPreviewRefresh} disabled={runtimeBusy} aria-label="Refresh preview">
            <RotateCw size={13} aria-hidden /> Refresh
          </button>
        </span>
      </div>

      {runtimeError ? <p className={styles.runtimeError} role="alert">{runtimeError}</p> : null}
      <HelloApplicationAssistant onPreviewRefresh={onPreviewRefresh} />
    </section>
  )
}
