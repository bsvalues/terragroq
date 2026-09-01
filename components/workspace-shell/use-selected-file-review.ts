"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { AgentSessionDiffReview, ExperienceAgentSessionController } from "./agent-sessions"

type ReviewState = Readonly<{
  running: boolean
  path: string | null
  progress: string | null
  outcome: string | null
}>

export type SelectedDiffReviewCapture = Readonly<{
  worldId: string
  path: string
  fingerprint: string
  isCurrent: () => boolean
  beforeStart: () => Promise<void>
}>

export type CapturedFileReviewStart = Readonly<{
  path: string
  isStartCurrent: () => boolean
  isPresentationCurrent: () => boolean
}>

type ActiveReview = {
  id: number
  path: string
  stopRequested: boolean
  stopIssued: boolean
  sessionKey: string | null
  diff: SelectedDiffReviewCapture | null
  capture: CapturedFileReviewStart | null
}

const idle: ReviewState = { running: false, path: null, progress: null, outcome: null }

function stopExactReview(operation: ActiveReview, controller: ExperienceAgentSessionController) {
  if (!operation.sessionKey || operation.stopIssued) return
  operation.stopIssued = true
  controller.stop(operation.sessionKey)
}

export function useSelectedFileReview({
  path,
  sessions,
  onReport,
}: {
  path: string | null
  sessions: ExperienceAgentSessionController
  onReport: (path: string, report: string, binding?: AgentSessionDiffReview) => void
}) {
  const [state, setState] = useState<ReviewState>(idle)
  const active = useRef<ActiveReview | null>(null)
  const sequence = useRef(0)
  const report = useRef(onReport)
  const sessionController = useRef(sessions)

  useEffect(() => { report.current = onReport }, [onReport])
  useEffect(() => { sessionController.current = sessions }, [sessions])
  useEffect(() => () => {
    const operation = active.current
    if (!operation) return
    operation.stopRequested = true
    stopExactReview(operation, sessionController.current)
  }, [])

  const reset = useCallback((nextPath: string | null) => {
    if (active.current) return
    setState({ running: false, path: nextPath, progress: null, outcome: null })
  }, [])

  const stop = useCallback(() => {
    const operation = active.current
    if (!operation) return
    operation.stopRequested = true
    stopExactReview(operation, sessions)
    setState({ running: true, path: operation.path, progress: null, outcome: "Stop requested. Review outcome is unknown." })
  }, [sessions])

  const run = useCallback(async (
    operationPath: string | null,
    focus: string,
    diff: SelectedDiffReviewCapture | null,
    capture: CapturedFileReviewStart | null,
  ) => {
    if (active.current) return
    if (!operationPath) {
      setState({ running: false, path: null, progress: null, outcome: "Select a file before starting Review." })
      return
    }
    if (capture && (capture.path !== operationPath || !capture.isStartCurrent())) {
      setState({ running: false, path: operationPath, progress: null, outcome: "The selected agent work changed before Review could start." })
      return
    }
    if (diff && (diff.path !== operationPath || !diff.isCurrent())) {
      setState({ running: false, path: operationPath, progress: null, outcome: "The live change changed. Reopen Review from the current Changes surface." })
      return
    }
    const operation: ActiveReview = { id: ++sequence.current, path: operationPath, stopRequested: false, stopIssued: false, sessionKey: null, diff, capture }
    active.current = operation
    setState({ running: true, path: operation.path, progress: "Starting read-only Review…", outcome: null })
    try {
      if (operation.diff) {
        await operation.diff.beforeStart()
        if (active.current !== operation || operation.stopRequested || !operation.diff.isCurrent()) {
          throw new Error("DIFF_CONTEXT_STALE")
        }
      }
      await sessions.runClaudeTurn({
        role: "Reviewer",
        assignment: operation.diff ? `Review current changes · ${operation.path}` : `Review ${operation.path}`,
        mode: operation.diff ? "diff-review" : "review",
        path: operation.path,
        ...(operation.diff ? {
          worldId: operation.diff.worldId,
          expectedDiffFingerprint: operation.diff.fingerprint,
        } : {}),
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        onEvent: (event) => {
          if (active.current !== operation) return
          if (event.type === "session" && typeof event.sessionId === "string") {
            operation.sessionKey = `Claude:${event.sessionId}`
            if (operation.stopRequested) {
              stopExactReview(operation, sessionController.current)
              return
            }
            if (!operation.capture || operation.capture.isPresentationCurrent()) {
              setState((current) => ({ ...current, progress: `Reviewing ${operation.path}…` }))
            }
          }
        },
        onReviewComplete: (text, binding) => {
          if (active.current !== operation || operation.stopRequested || operation.diff && !operation.diff.isCurrent()
            || operation.capture && !operation.capture.isPresentationCurrent()) return
          report.current(operation.path, text, binding)
        },
      })
      if (active.current === operation && !operation.stopRequested
        && (!operation.capture || operation.capture.isPresentationCurrent())) {
        setState({ running: false, path: operation.path, progress: null, outcome: "Review completed and opened in Inspector." })
      }
    } catch (error) {
      if (active.current !== operation) return
      if (operation.capture && !operation.capture.isPresentationCurrent()) return
      const unknown = operation.stopRequested || (error instanceof DOMException && error.name === "AbortError")
      const stale = operation.diff && (error instanceof Error && /DIFF(?:_REVIEW)?_CONTEXT_STALE/.test(error.message) || !operation.diff.isCurrent())
      setState({ running: false, path: operation.path, progress: null, outcome: unknown
        ? "Stop requested. Review outcome is unknown."
        : stale ? "The live change changed. Reopen Review from the current Changes surface."
          : "Review did not return a valid successful result." })
    } finally {
      if (active.current === operation) active.current = null
    }
  }, [sessions])

  const start = useCallback((focus: string, diff: SelectedDiffReviewCapture | null = null) => (
    run(path, focus, diff, null)
  ), [path, run])

  const startCapturedPath = useCallback((capture: CapturedFileReviewStart) => (
    run(capture.path, "", null, capture)
  ), [run])

  return { ...state, canStop: state.running, reset, start, startCapturedPath, stop }
}
