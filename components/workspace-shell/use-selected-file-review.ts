"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { ExperienceAgentSessionController } from "./agent-sessions"

type ReviewState = Readonly<{
  running: boolean
  path: string | null
  progress: string | null
  outcome: string | null
}>

type ActiveReview = { id: number; path: string; stopRequested: boolean; sessionKey: string | null }

const idle: ReviewState = { running: false, path: null, progress: null, outcome: null }

export function useSelectedFileReview({
  path,
  sessions,
  onReport,
}: {
  path: string | null
  sessions: ExperienceAgentSessionController
  onReport: (path: string, report: string) => void
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
    const controller = sessionController.current
    const turnId = operation.sessionKey ?? controller.activeTurns.find((turn) => turn.provider === "Claude" && turn.role === "Reviewer")?.id
    controller.stop(turnId)
  }, [])

  const reset = useCallback((nextPath: string | null) => {
    if (active.current) return
    setState({ running: false, path: nextPath, progress: null, outcome: null })
  }, [])

  const stop = useCallback(() => {
    const operation = active.current
    if (!operation) return
    operation.stopRequested = true
    const turnId = operation.sessionKey ?? sessions.activeTurns.find((turn) => turn.provider === "Claude" && turn.role === "Reviewer")?.id
    sessions.stop(turnId)
    setState({ running: true, path: operation.path, progress: null, outcome: "Stop requested. Review outcome is unknown." })
  }, [sessions])

  const start = useCallback(async (focus: string) => {
    if (active.current) return
    if (!path) {
      setState({ running: false, path: null, progress: null, outcome: "Select a file before starting Review." })
      return
    }
    const operation: ActiveReview = { id: ++sequence.current, path, stopRequested: false, sessionKey: null }
    active.current = operation
    setState({ running: true, path: operation.path, progress: "Starting read-only Review…", outcome: null })
    try {
      await sessions.runClaudeTurn({
        role: "Reviewer",
        assignment: `Review ${operation.path}`,
        mode: "review",
        path: operation.path,
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        onEvent: (event) => {
          if (active.current !== operation || operation.stopRequested) return
          if (event.type === "session" && typeof event.sessionId === "string") {
            operation.sessionKey = `Claude:${event.sessionId}`
            setState((current) => ({ ...current, progress: `Reviewing ${operation.path}…` }))
          }
        },
        onReviewComplete: (text) => {
          if (active.current !== operation || operation.stopRequested) return
          report.current(operation.path, text)
        },
      })
      if (active.current === operation && !operation.stopRequested) {
        setState({ running: false, path: operation.path, progress: null, outcome: "Review completed and opened in Inspector." })
      }
    } catch (error) {
      if (active.current !== operation) return
      const unknown = operation.stopRequested || (error instanceof DOMException && error.name === "AbortError")
      setState({ running: false, path: operation.path, progress: null, outcome: unknown ? "Stop requested. Review outcome is unknown." : "Review did not return a valid successful result." })
    } finally {
      if (active.current === operation) active.current = null
    }
  }, [path, sessions])

  return { ...state, canStop: state.running, reset, start, stop }
}
