"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { WorldWorker } from "@/lib/environment/working-world"

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORAGE_PREFIX = "williamos:agent-session:"

export type DurableClaudeSession = Readonly<{
  schemaVersion: 1
  sessionId: string
  role: string
  provider: "Claude"
  assignment: string
  reviewPath?: string
  updatedAt: string
}>

export type ExperienceAgentSession = Readonly<{
  id: string
  role: string
  providerLabel: string
  assignment: string
  status: string
  evidence: string
  truth: "live"
  kind: "durable-session" | "world-worker"
}>

export type RunClaudeTurnInput = Readonly<{
  role: string
  assignment: string
  prompt?: string
  mode?: "delegate" | "review"
  path?: string
  focus?: string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onReviewComplete?: (report: string) => void
}>

export type ExperienceAgentSessionController = Readonly<{
  sessions: readonly ExperienceAgentSession[]
  durableSession: DurableClaudeSession | null
  savedDescriptor: DurableClaudeSession | null
  descriptorState: "none" | "unverified" | "verified"
  activeSessionId: string | null
  error: string | null
  runClaudeTurn: (input: RunClaudeTurnInput) => Promise<DurableClaudeSession>
  stop: () => void
}>

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= max && !text.includes("\0") ? text : null
}

function parseDescriptor(value: string | null): DurableClaudeSession | null {
  if (!value) return null
  let raw: unknown
  try { raw = JSON.parse(value) } catch { return null }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  const role = boundedText(candidate.role, 80)
  const assignment = boundedText(candidate.assignment, 500)
  const updatedAt = typeof candidate.updatedAt === "string" && Number.isFinite(Date.parse(candidate.updatedAt))
    ? candidate.updatedAt : null
  const reviewPath = candidate.reviewPath === undefined ? undefined : boundedText(candidate.reviewPath, 1_000)
  if (candidate.schemaVersion !== 1 || candidate.provider !== "Claude"
    || typeof candidate.sessionId !== "string" || !SESSION_ID.test(candidate.sessionId)
    || !role || !assignment || !updatedAt || (candidate.reviewPath !== undefined && !reviewPath)) return null
  return {
    schemaVersion: 1,
    sessionId: candidate.sessionId,
    role,
    provider: "Claude",
    assignment,
    ...(reviewPath ? { reviewPath } : {}),
    updatedAt,
  }
}

function storageKey(ownerScope: string, worldScope: string): string {
  const owner = boundedText(ownerScope, 500)
  const world = boundedText(worldScope, 500)
  if (!owner) throw new Error("AGENT_OWNER_SCOPE_REQUIRED")
  if (!world) throw new Error("AGENT_WORLD_SCOPE_REQUIRED")
  return `${STORAGE_PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(world)}`
}

function projectSessions(
  worker: WorldWorker | null,
  durable: DurableClaudeSession | null,
  activeSessionId: string | null,
): readonly ExperienceAgentSession[] {
  const sessions: ExperienceAgentSession[] = []
  if (worker) {
    sessions.push({
      id: `world-worker:${worker.lane}:${worker.since}`,
      role: "Worker",
      providerLabel: `${worker.lane} lane`,
      assignment: "Current Space execution",
      status: worker.state,
      evidence: "live world state",
      truth: "live",
      kind: "world-worker",
    })
  }
  if (durable) {
    sessions.push({
      id: durable.sessionId,
      role: durable.role,
      providerLabel: durable.provider,
      assignment: durable.assignment,
      status: activeSessionId === durable.sessionId ? "working" : "ready",
      evidence: activeSessionId === durable.sessionId ? "live agent stream" : "resumable session",
      truth: "live",
      kind: "durable-session",
    })
  }
  return sessions
}

export function useExperienceAgentSessions({
  ownerScope,
  worldScope,
  worker,
}: {
  ownerScope: string
  worldScope: string
  worker: WorldWorker | null
}): ExperienceAgentSessionController {
  const [savedDescriptor, setSavedDescriptor] = useState<DurableClaudeSession | null>(null)
  const [durableSession, setDurableSession] = useState<DurableClaudeSession | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const descriptorRef = useRef<DurableClaudeSession | null>(null)

  useEffect(() => {
    const key = storageKey(ownerScope, worldScope)
    const stored = window.localStorage.getItem(key)
    const descriptor = parseDescriptor(stored)
    if (stored && !descriptor) window.localStorage.removeItem(key)
    // Browser storage is only a resume hint. The server authenticates ownership and existence when
    // a turn actually resumes; until that turn succeeds, this must not enter the live projection.
    setSavedDescriptor(descriptor)
    descriptorRef.current = descriptor
    setDurableSession(null)
  }, [ownerScope, worldScope])

  useEffect(() => () => controller.current?.abort(), [])

  const stop = useCallback(() => {
    void readerRef.current?.cancel()
    readerRef.current = null
    controller.current?.abort()
    controller.current = null
    setActiveSessionId(null)
  }, [])

  const runClaudeTurn = useCallback(async (input: RunClaudeTurnInput) => {
    const role = boundedText(input.role, 80)
    const assignment = boundedText(input.assignment, 500)
    const prompt = boundedText(input.prompt, 20_000)
    const mode = input.mode ?? "delegate"
    const reviewPath = boundedText(input.path, 1_000)
    const focus = input.focus === undefined || input.focus === "" ? null : boundedText(input.focus, 2_000)
    if (!role) throw new Error("AGENT_ROLE_REQUIRED")
    if (!assignment) throw new Error("AGENT_ASSIGNMENT_REQUIRED")
    if (mode === "delegate" && !prompt) throw new Error("AGENT_PROMPT_REQUIRED")
    if (mode === "review" && (!reviewPath || input.focus !== undefined && input.focus !== "" && !focus)) throw new Error("AGENT_REVIEW_INPUT_INVALID")
    if (controller.current) throw new Error("AGENT_TURN_ALREADY_RUNNING")

    const storedPrior = descriptorRef.current
    const prior = mode === "review"
      ? storedPrior?.role === "Reviewer" && storedPrior.reviewPath === reviewPath ? storedPrior : null
      : storedPrior?.reviewPath ? null : storedPrior
    if (storedPrior) {
      // While resume is being verified, the saved descriptor is not usable truth. Remove it up
      // front so any terminal refusal naturally recovers to a fresh session on the next turn.
      window.localStorage.removeItem(storageKey(ownerScope, worldScope))
      descriptorRef.current = null
      setSavedDescriptor(null)
    }
    const abort = new AbortController()
    controller.current = abort
    setActiveSessionId(prior?.sessionId ?? "starting-claude-session")
    // A running or failed turn is not a ready session. Re-earn the live projection at successful
    // completion, including when a previously verified descriptor is being resumed.
    setDurableSession(null)
    setError(null)
    let accepted: DurableClaudeSession | null = null
    const finalOutcome: { seen: boolean; code: unknown; reason: unknown } = {
      seen: false,
      code: undefined,
      reason: undefined,
    }

    try {
      const response = await fetch("/api/loom/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "review" ? {
          mode: "review",
          path: reviewPath,
          ...(focus ? { focus } : {}),
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : {
          prompt,
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        }),
        signal: abort.signal,
        cache: "no-store",
      })
      if (!response.ok || !response.body) throw new Error(`AGENT_START_REFUSED:${response.status}`)

      const reader = response.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buffer = ""
      let malformedReview = false
      let sessionSeen = false
      let terminalSeen = false
      const reviewText: string[] = []
      const acceptLine = (line: string) => {
        if (!line.trim()) return
        let event: Record<string, unknown>
        try { event = JSON.parse(line) as Record<string, unknown> } catch { if (mode === "review") malformedReview = true; return }
        if (mode === "review" && terminalSeen) { malformedReview = true; return }
        input.onEvent?.(event)
        if (event.type === "session" && typeof event.sessionId === "string" && SESSION_ID.test(event.sessionId)) {
          if (mode === "review" && sessionSeen) { malformedReview = true; return }
          sessionSeen = true
          accepted = {
            schemaVersion: 1,
            sessionId: event.sessionId,
            role,
            provider: "Claude",
            assignment,
            ...(mode === "review" ? { reviewPath: reviewPath! } : {}),
            updatedAt: new Date().toISOString(),
          }
          setActiveSessionId(event.sessionId)
        }
        if (mode === "review" && event.type === "event") {
          if (!sessionSeen || !event.event || typeof event.event !== "object" || Array.isArray(event.event)) { malformedReview = true; return }
          const payload = event.event as Record<string, unknown>
          if (payload.type === "result" && typeof payload.result === "string") reviewText.push(payload.result)
          const message = payload.message as { content?: unknown } | undefined
          if (payload.type === "assistant" && Array.isArray(message?.content)) {
            for (const block of message.content) {
              if (block && typeof block === "object" && (block as Record<string, unknown>).type === "text" && typeof (block as Record<string, unknown>).text === "string") reviewText.push((block as Record<string, unknown>).text as string)
            }
          }
          return
        }
        if (event.type === "done") {
          if (mode === "review" && (!sessionSeen || terminalSeen)) { malformedReview = true; return }
          terminalSeen = true
          finalOutcome.seen = true
          finalOutcome.code = event.code
          finalOutcome.reason = event.reason
          return
        }
        if (mode === "review" && event.type !== "session") malformedReview = true
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        lines.forEach(acceptLine)
      }
      buffer += decoder.decode()
      acceptLine(buffer)
      if (abort.signal.aborted) throw new DOMException("Aborted", "AbortError")
      if (mode === "review" && (malformedReview || !sessionSeen || !terminalSeen || reviewText.join("\n").trim() === "")) throw new Error("AGENT_REVIEW_STREAM_INVALID")
      if (!accepted) throw new Error("AGENT_SESSION_ID_MISSING")
      if (!finalOutcome.seen) throw new Error("AGENT_TURN_FAILED:DONE_MISSING")
      const reason = typeof finalOutcome.reason === "string" && finalOutcome.reason.trim()
        ? finalOutcome.reason.trim() : null
      if (reason || finalOutcome.code !== 0) {
        throw new Error(`AGENT_TURN_FAILED:${reason ?? `EXIT_${String(finalOutcome.code)}`}`)
      }
      window.localStorage.setItem(storageKey(ownerScope, worldScope), JSON.stringify(accepted))
      descriptorRef.current = accepted
      setSavedDescriptor(accepted)
      setDurableSession(accepted)
      if (mode === "review") input.onReviewComplete?.(reviewText.join("\n").trim())
      return accepted
    } catch (cause) {
      // A failed resume is no longer evidence that the saved descriptor exists or belongs to this
      // authenticated owner. Clear it so the next Delegate can start a fresh truthful session.
      // A user cancellation is different: it does not disprove an already verified descriptor.
      const error = cause as Error
      const terminalResumeRefusal = prior !== null && /^AGENT_START_REFUSED:(401|403|404)$/.test(error?.message ?? "")
      if (error?.name !== "AbortError" && (!prior || terminalResumeRefusal)) {
        window.localStorage.removeItem(storageKey(ownerScope, worldScope))
        descriptorRef.current = null
        setSavedDescriptor(null)
      } else if (prior) {
        window.localStorage.setItem(storageKey(ownerScope, worldScope), JSON.stringify(prior))
        descriptorRef.current = prior
        setSavedDescriptor(prior)
      } else {
        window.localStorage.removeItem(storageKey(ownerScope, worldScope))
      }
      if (error?.name !== "AbortError") setError(cause instanceof Error ? cause.message : "AGENT_UNAVAILABLE")
      throw cause
    } finally {
      readerRef.current = null
      controller.current = null
      setActiveSessionId(null)
    }
  }, [ownerScope, worldScope])

  const sessions = useMemo(
    () => projectSessions(worker, durableSession, activeSessionId),
    [worker, durableSession, activeSessionId],
  )
  const descriptorState = durableSession ? "verified" : savedDescriptor ? "unverified" : "none"
  return {
    sessions,
    durableSession,
    savedDescriptor,
    descriptorState,
    activeSessionId,
    error,
    runClaudeTurn,
    stop,
  }
}

export function AgentSessionStrip({
  sessions,
  activeSessionId = null,
  runningSessionId = null,
  onStop,
  onSelect,
  className,
}: {
  sessions: readonly ExperienceAgentSession[]
  activeSessionId?: string | null
  runningSessionId?: string | null
  onStop?: () => void
  onSelect?: (session: ExperienceAgentSession) => void
  className?: string
}) {
  if (sessions.length === 0 && !runningSessionId) return null
  return (
    <nav className={className ?? "flex items-center justify-center gap-2"} aria-label="Durable agent sessions">
      {runningSessionId ? (
        <button
          type="button"
          aria-label="Stop Claude turn"
          onClick={onStop}
          className="rounded border border-[#8c4943] bg-[#261413] px-2 py-1 text-[10.5px] font-semibold text-[#f0c4bf]"
        >
          Stop
        </button>
      ) : null}
      {sessions.map((session) => (
        <button
          key={session.id}
          type="button"
          aria-pressed={activeSessionId === session.id}
          aria-label={`${session.role} · ${session.providerLabel} · ${session.assignment}`}
          onClick={() => onSelect?.(session)}
          className="flex min-w-36 items-center gap-2 rounded border border-[#303a2f] bg-[#121712] px-2 py-1 text-left text-[#dce3d9]"
        >
          <span aria-hidden className="grid size-5 place-items-center rounded-full border border-[#566653] text-[9px]">
            {session.role.slice(0, 1).toUpperCase()}
          </span>
          <span className="grid gap-px">
            <strong className="text-[10.5px]">{session.role} · {session.providerLabel}</strong>
            <small className="text-[9.5px] text-[#8f9a8c]">{session.status} · {session.evidence}</small>
          </span>
        </button>
      ))}
    </nav>
  )
}
