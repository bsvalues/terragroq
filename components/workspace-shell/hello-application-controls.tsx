"use client"

import { useEffect, useRef, useState } from "react"
import { Play, RotateCw, Square } from "lucide-react"

import type { ApplicationVisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"
import { HELLO_APPLICATION_WORKSPACE_PROJECT } from "@/lib/projects/workspace-project-key"
import { ApplicationAssistant, HelloApplicationAssistant } from "./hello-application-assistant"
import { adaptApplicationRuntimePayload, type ApplicationRuntimeState, type ApplicationRuntimeView } from "./application-ui-contract"
import styles from "./hello-application-controls.module.css"

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? `HELLO_APPLICATION_${response.status}`)
  return payload
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback
}

async function readRuntimeStatus(project: ApplicationVisibleWorkspaceProject): Promise<ApplicationRuntimeView> {
  const response = await fetch(project.application.runtimeUrl, { cache: "no-store" })
  return adaptApplicationRuntimePayload(project, await responseJson<unknown>(response))
}

export function ApplicationControls({
  project,
  onPreviewRefresh,
  onRuntimeStateChange,
}: Readonly<{
  project: ApplicationVisibleWorkspaceProject
  onPreviewRefresh: () => void
  onRuntimeStateChange?: (state: ApplicationRuntimeState) => void
}>) {
  const [runtime, setRuntime] = useState<ApplicationRuntimeView | null>(null)
  const [runtimeState, setRuntimeState] = useState<ApplicationRuntimeState | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(true)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const runtimeOperationInFlight = useRef(false)
  const queuedRuntimeRead = useRef(false)
  const mounted = useRef(false)
  const runtimeLifecycle = useRef(0)

  useEffect(() => {
    const lifecycle = ++runtimeLifecycle.current
    mounted.current = true
    setRuntime(null)
    setRuntimeState(null)
    setRuntimeError(null)
    setRuntimeBusy(true)
    requestRuntimeRead(false, lifecycle)
    return () => {
      if (runtimeLifecycle.current !== lifecycle) return
      runtimeLifecycle.current += 1
      mounted.current = false
      runtimeOperationInFlight.current = false
      queuedRuntimeRead.current = false
    }
  }, [project.key])

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
      const payload = await readRuntimeStatus(project)
      if (activeRuntimeLifecycle(lifecycle) && !queuedRuntimeRead.current) {
        setRuntime(payload)
        setRuntimeState(payload.state)
        onRuntimeStateChange?.(payload.state)
      }
    } catch (cause) {
      if (activeRuntimeLifecycle(lifecycle) && !queuedRuntimeRead.current) {
        setRuntime(null)
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
      setRuntime(null)
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
    setRuntime(null)
    try {
      const response = await fetch(project.application.runtimeUrl, {
        method,
        headers: { "content-type": "application/json" },
      })
      await responseJson<unknown>(response)
      if (activeRuntimeLifecycle(lifecycle)) {
        onPreviewRefresh()
      }
    } catch (cause) {
      if (activeRuntimeLifecycle(lifecycle)) {
        setRuntime(null)
        setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_RUNTIME_FAILED")}`)
      }
    } finally {
      if (activeRuntimeLifecycle(lifecycle)) queuedRuntimeRead.current = true
      finishRuntimeOperation(lifecycle)
    }
  }

  return (
    <section className={styles.controls} aria-label={`${project.name} runtime and HERMES change controls`}>
      <div className={styles.runtimeStrip}>
        <span className={styles.identity}><span aria-hidden className={styles.signal} />{project.name}</span>
        <span className={styles.runtimeState} data-state={runtimeState ?? "loading"}>
          Runtime {runtimeState ?? "checking"}
        </span>
        <span className={styles.actions}>
          {runtimeState === "running" ? (
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

      {runtime ? (
        <div className={styles.runtimeTruth} aria-label={`${project.name} runtime truth`}>
          <span>Runtime build <code>{runtime.runtimeBuildSha}</code></span>
          <span>Active project HEAD <code>{runtime.activeProjectHead}</code></span>
        </div>
      ) : null}

      {runtimeError ? <p className={styles.runtimeError} role="alert">{runtimeError}</p> : null}
      {project.application.contract === "legacy-v1-v3" ? (
        <HelloApplicationAssistant project={project} onPreviewRefresh={() => { void refreshPreviewAndTruth() }} />
      ) : (
        <ApplicationAssistant project={project} onPreviewRefresh={() => { void refreshPreviewAndTruth() }} />
      )}
    </section>
  )
}

export function HelloApplicationControls({
  onPreviewRefresh,
}: Readonly<{ onPreviewRefresh: () => void }>) {
  return <ApplicationControls project={HELLO_APPLICATION_WORKSPACE_PROJECT} onPreviewRefresh={onPreviewRefresh} />
}
