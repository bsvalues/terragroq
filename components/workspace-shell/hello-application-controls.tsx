"use client"

import { useEffect, useRef, useState } from "react"
import { Play, RotateCw, Square } from "lucide-react"

import type { ApplicationVisibleWorkspaceProject } from "@/lib/projects/workspace-project-key"
import { HELLO_APPLICATION_WORKSPACE_PROJECT } from "@/lib/projects/workspace-project-key"
import { ApplicationAssistant, HelloApplicationAssistant } from "./hello-application-assistant"
import {
  adaptApplicationRuntimePayload,
  type ApplicationActivationResult,
  type ApplicationRuntimeState,
  type ApplicationRuntimeView,
} from "./application-ui-contract"
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

const RUNTIME_DETAIL_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  APPLICATION_RUNTIME_POLICY_MISMATCH: "The runtime policy no longer matches this contained application. Repair the runtime policy, then start it again.",
  APPLICATION_DOCKER_UNAVAILABLE: "The contained runtime engine is unavailable. Restore it, then retry the runtime action.",
  APPLICATION_DOCKER_TIMEOUT: "The contained runtime engine timed out. Retry the runtime action after it recovers.",
  APPLICATION_RUNTIME_HEALTH_FAILED: "The rebuilt application did not pass its runtime health check. Review the application, then retry Start.",
  APPLICATION_RUNTIME_NOT_RUNNING: "The contained application did not remain running. Retry Start after checking the runtime engine.",
  APPLICATION_RUNTIME_OUTPUT_LIMIT: "The contained runtime returned more output than WilliamOS can safely accept.",
  APPLICATION_RUNTIME_SOURCE_HEAD_MISMATCH: "The running artifact was built from an older source commit. Use Start application to rebuild the current project HEAD.",
  APPLICATION_RUNTIME_TRANSITION_PENDING: "A prior runtime generation is still retiring. Retry after that transition finishes.",
})

function runtimeDetailMessage(runtime: ApplicationRuntimeView): string | null {
  if (!runtime.detail) return null
  return RUNTIME_DETAIL_MESSAGES[runtime.detail]
    ?? (runtime.state === "mismatch"
      ? "The contained runtime no longer matches its verified policy. Repair it before starting again."
      : runtime.state === "unavailable"
        ? "The contained runtime is unavailable. Restore the runtime engine, then retry."
        : "The contained runtime reported a verified failure. Review the application and retry the runtime action.")
}

const RUNTIME_REBUILD_FAILURE = "The source change is applied, but the contained runtime could not be rebuilt. Use Start application to retry."

export function ApplicationControls({
  project,
  onPreviewRefresh,
  onRuntimeStateChange,
}: Readonly<{
  project: ApplicationVisibleWorkspaceProject
  onPreviewRefresh: () => void
  onRuntimeStateChange?: (state: ApplicationRuntimeState) => void
}>) {
  const isLegacy = project.application.contract === "legacy-v1-v3"
  const [runtime, setRuntime] = useState<ApplicationRuntimeView | null>(null)
  const [runtimeState, setRuntimeState] = useState<ApplicationRuntimeState | null>(null)
  const [runtimeBusy, setRuntimeBusy] = useState(true)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const runtimeOperationInFlight = useRef(false)
  const queuedRuntimeRead = useRef(false)
  const queuedPreviewRefresh = useRef(false)
  const runtimeTruth = useRef<ApplicationRuntimeView | null>(null)
  const mounted = useRef(false)
  const runtimeLifecycle = useRef(0)

  useEffect(() => {
    const lifecycle = ++runtimeLifecycle.current
    mounted.current = true
    runtimeTruth.current = null
    setRuntime(null)
    setRuntimeState(null)
    setRuntimeError(null)
    setRuntimeBusy(true)
    requestRuntimeRead(false, lifecycle)
    return () => {
      if (runtimeLifecycle.current !== lifecycle) return
      runtimeLifecycle.current += 1
      mounted.current = false
      runtimeTruth.current = null
      runtimeOperationInFlight.current = false
      queuedRuntimeRead.current = false
      queuedPreviewRefresh.current = false
    }
  }, [project.key])

  function activeRuntimeLifecycle(lifecycle: number) {
    return mounted.current && runtimeLifecycle.current === lifecycle
  }

  function publishRuntimeTruth(payload: ApplicationRuntimeView) {
    runtimeTruth.current = payload
    setRuntime(payload)
    setRuntimeState(payload.state)
    onRuntimeStateChange?.(payload.state)
  }

  function clearRuntimeTruth(state: ApplicationRuntimeState) {
    runtimeTruth.current = null
    setRuntime(null)
    setRuntimeState(state)
    onRuntimeStateChange?.(state)
  }

  function finishRuntimeOperation(lifecycle: number) {
    if (!activeRuntimeLifecycle(lifecycle)) return
    if (queuedRuntimeRead.current) {
      const refreshPreview = queuedPreviewRefresh.current
      queuedRuntimeRead.current = false
      queuedPreviewRefresh.current = false
      void performRuntimeRead(lifecycle, refreshPreview)
      return
    }
    runtimeOperationInFlight.current = false
    setRuntimeBusy(false)
  }

  async function performRuntimeRead(lifecycle: number, refreshPreview = false) {
    try {
      const payload = await readRuntimeStatus(project)
      if (activeRuntimeLifecycle(lifecycle) && !queuedRuntimeRead.current) {
        publishRuntimeTruth(payload)
        if (refreshPreview && payload.previewAvailable) onPreviewRefresh()
      }
    } catch (cause) {
      if (activeRuntimeLifecycle(lifecycle) && !queuedRuntimeRead.current) {
        if (isLegacy) {
          clearRuntimeTruth("unavailable")
          setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_STATUS_UNAVAILABLE")}`)
        } else {
          clearRuntimeTruth("unavailable")
          setRuntimeError("Runtime status is unavailable. Retry Refresh to restore verified runtime truth.")
        }
      }
    } finally {
      finishRuntimeOperation(lifecycle)
    }
  }

  function requestRuntimeRead(
    clearTruth = true,
    lifecycle = runtimeLifecycle.current,
    refreshPreview = false,
  ) {
    if (!activeRuntimeLifecycle(lifecycle)) return
    if (clearTruth) {
      setRuntimeError(null)
      clearRuntimeTruth("unavailable")
    }
    if (runtimeOperationInFlight.current) {
      queuedRuntimeRead.current = true
      queuedPreviewRefresh.current ||= refreshPreview
      return
    }
    runtimeOperationInFlight.current = true
    setRuntimeBusy(true)
    void performRuntimeRead(lifecycle, refreshPreview)
  }

  function refreshPreviewAndTruth() {
    if (isLegacy) {
      onPreviewRefresh()
      requestRuntimeRead()
    } else {
      requestRuntimeRead(true, runtimeLifecycle.current, true)
    }
  }

  async function changeRuntime(method: "POST" | "DELETE") {
    const lifecycle = runtimeLifecycle.current
    if (!activeRuntimeLifecycle(lifecycle) || runtimeOperationInFlight.current) return
    runtimeOperationInFlight.current = true
    setRuntimeBusy(true)
    setRuntimeError(null)
    clearRuntimeTruth("starting")
    let mutationSucceeded = false
    try {
      const response = await fetch(project.application.runtimeUrl, {
        method,
        headers: { "content-type": "application/json" },
      })
      await responseJson<unknown>(response)
      mutationSucceeded = true
      if (isLegacy && activeRuntimeLifecycle(lifecycle)) onPreviewRefresh()
    } catch (cause) {
      if (activeRuntimeLifecycle(lifecycle)) {
        if (isLegacy) {
          clearRuntimeTruth("unavailable")
          setRuntimeError(`Runtime error: ${message(cause, "HELLO_APPLICATION_RUNTIME_FAILED")}`)
        } else {
          clearRuntimeTruth("unavailable")
          setRuntimeError(`The contained runtime ${method === "POST" ? "start" : "stop"} outcome is unavailable. Retry the action or Refresh.`)
        }
      }
    } finally {
      if (activeRuntimeLifecycle(lifecycle) && mutationSucceeded) {
        queuedRuntimeRead.current = true
        queuedPreviewRefresh.current = !isLegacy && method === "POST"
      }
      finishRuntimeOperation(lifecycle)
    }
  }

  async function activateAppliedRuntime(appliedCommit: string): Promise<ApplicationActivationResult> {
    const lifecycle = runtimeLifecycle.current
    if (!activeRuntimeLifecycle(lifecycle)) return { outcome: "failed", message: RUNTIME_REBUILD_FAILURE }
    const wasRunning = runtimeTruth.current?.state === "running" && runtimeTruth.current.previewAvailable
    if (!wasRunning) {
      requestRuntimeRead()
      return { outcome: "start-required" }
    }
    if (runtimeOperationInFlight.current) return { outcome: "failed", message: RUNTIME_REBUILD_FAILURE }
    runtimeOperationInFlight.current = true
    setRuntimeBusy(true)
    setRuntimeError(null)
    clearRuntimeTruth("starting")
    try {
      const response = await fetch(project.application.runtimeUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
      })
      const payload = adaptApplicationRuntimePayload(project, await responseJson<unknown>(response))
      if (!activeRuntimeLifecycle(lifecycle)) return { outcome: "failed", message: RUNTIME_REBUILD_FAILURE }
      if (!payload.previewAvailable || payload.state !== "running"
        || payload.activeSourceHead !== appliedCommit || payload.activeProjectHead !== appliedCommit) {
        throw new Error("APPLICATION_RUNTIME_APPLIED_HEAD_MISMATCH")
      }
      publishRuntimeTruth(payload)
      onPreviewRefresh()
      return { outcome: "activated" }
    } catch {
      if (activeRuntimeLifecycle(lifecycle)) {
        clearRuntimeTruth("unavailable")
      }
      return { outcome: "failed", message: RUNTIME_REBUILD_FAILURE }
    } finally {
      if (activeRuntimeLifecycle(lifecycle)) {
        runtimeOperationInFlight.current = false
        setRuntimeBusy(false)
      }
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

      {runtime && runtimeDetailMessage(runtime) ? (
        <p className={styles.runtimeError} role="status">{runtimeDetailMessage(runtime)}</p>
      ) : null}
      {runtimeError ? <p className={styles.runtimeError} role="alert">{runtimeError}</p> : null}
      {project.application.contract === "legacy-v1-v3" ? (
        <HelloApplicationAssistant project={project} onPreviewRefresh={() => { void refreshPreviewAndTruth() }} />
      ) : (
        <ApplicationAssistant
          project={project}
          onPreviewRefresh={() => { void refreshPreviewAndTruth() }}
          onApplied={activateAppliedRuntime}
        />
      )}
    </section>
  )
}

export function HelloApplicationControls({
  onPreviewRefresh,
}: Readonly<{ onPreviewRefresh: () => void }>) {
  return <ApplicationControls project={HELLO_APPLICATION_WORKSPACE_PROJECT} onPreviewRefresh={onPreviewRefresh} />
}
