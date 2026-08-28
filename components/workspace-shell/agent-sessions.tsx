"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { WorldWorker } from "@/lib/environment/working-world"

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORAGE_PREFIX = "williamos:agent-session:"

export type AgentProvider = "Codex" | "Claude"

export type DurableAgentSession = Readonly<{
  schemaVersion: 1
  sessionId: string
  role: string
  provider: AgentProvider
  assignment: string
  reviewPath?: string
  updatedAt: string
}>

// Kept as a source-compatible alias for the already-shipped read-only Review hook.
export type DurableClaudeSession = DurableAgentSession

export type ExperienceAgentSession = Readonly<{
  id: string
  role: string
  providerLabel: string
  assignment: string
  status: string
  evidence: string
  truth: "live"
  kind: "durable-session" | "world-worker"
  mode: "delegate" | "review"
  reviewPath?: string
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

export type RunAgentTurnInput = Readonly<{
  provider: AgentProvider
  role: string
  assignment: string
  prompt: string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
}>

export type ExperienceAgentSessionController = Readonly<{
  sessions: readonly ExperienceAgentSession[]
  durableSession: DurableAgentSession | null
  savedDescriptor: DurableAgentSession | null
  descriptorState: "none" | "unverified" | "verified"
  activeSessionId: string | null
  error: string | null
  runClaudeTurn: (input: RunClaudeTurnInput) => Promise<DurableClaudeSession>
  stop: () => void
}>

export type ProviderNeutralAgentSessionController = ExperienceAgentSessionController & Readonly<{
  activeProvider: AgentProvider | null
  runAgentTurn: (input: RunAgentTurnInput) => Promise<DurableAgentSession>
}>

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= max && !text.includes("\0") ? text : null
}

function parseDescriptor(value: string | null): DurableAgentSession | null {
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
  if (candidate.schemaVersion !== 1 || candidate.provider !== "Claude" && candidate.provider !== "Codex"
    || typeof candidate.sessionId !== "string" || !SESSION_ID.test(candidate.sessionId)
    || !role || !assignment || !updatedAt || (candidate.reviewPath !== undefined && !reviewPath)) return null
  return {
    schemaVersion: 1,
    sessionId: candidate.sessionId,
    role,
    provider: candidate.provider,
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
  durable: DurableAgentSession | null,
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
      mode: "delegate",
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
      mode: durable.reviewPath ? "review" : "delegate",
      ...(durable.reviewPath ? { reviewPath: durable.reviewPath } : {}),
    })
  }
  return sessions
}

export function useExperienceAgentSessions({
  ownerScope,
  worldScope,
  worker,
  workContextReceipt = null,
}: {
  ownerScope: string
  worldScope: string
  worker: WorldWorker | null
  workContextReceipt?: string | null
}): ProviderNeutralAgentSessionController {
  const [savedDescriptor, setSavedDescriptor] = useState<DurableAgentSession | null>(null)
  const [durableSession, setDurableSession] = useState<DurableAgentSession | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState<AgentProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const descriptorRef = useRef<DurableAgentSession | null>(null)

  useEffect(() => {
    // A turn is owned by the exact authenticated owner/workspace scope in which it began. Never let
    // a late frame from that scope materialize a ready session after the shell has moved elsewhere.
    void readerRef.current?.cancel()
    readerRef.current = null
    controller.current?.abort()
    controller.current = null
    setActiveSessionId(null)
    setActiveProvider(null)
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
    setActiveProvider(null)
  }, [])

  const executeTurn = useCallback(async (input: RunClaudeTurnInput & { provider: AgentProvider }) => {
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
    if (mode === "review" && input.provider !== "Claude") throw new Error("AGENT_REVIEW_PROVIDER_INVALID")
    if (controller.current) throw new Error("AGENT_TURN_ALREADY_RUNNING")

    const storedPrior = descriptorRef.current
    const prior = mode === "review"
      ? storedPrior?.provider === "Claude" && storedPrior.role === "Reviewer" && storedPrior.reviewPath === reviewPath ? storedPrior : null
      : storedPrior?.provider === input.provider && !storedPrior.reviewPath ? storedPrior : null
    if (storedPrior) {
      // While resume is being verified, the saved descriptor is not usable truth. Remove it up
      // front so any terminal refusal naturally recovers to a fresh session on the next turn.
      window.localStorage.removeItem(storageKey(ownerScope, worldScope))
      descriptorRef.current = null
      setSavedDescriptor(null)
    }
    const abort = new AbortController()
    controller.current = abort
    setActiveSessionId(prior?.sessionId ?? `starting-${input.provider.toLowerCase()}-session`)
    setActiveProvider(input.provider)
    // A running or failed turn is not a ready session. Re-earn the live projection at successful
    // completion, including when a previously verified descriptor is being resumed.
    setDurableSession(null)
    setError(null)
    let accepted: DurableAgentSession | null = null
    const finalOutcome: { seen: boolean; code: unknown; reason: unknown } = {
      seen: false,
      code: undefined,
      reason: undefined,
    }

    try {
      const receipt = workContextReceipt === null ? null : boundedText(workContextReceipt, 500)
      if (workContextReceipt !== null && !receipt) throw new Error("AGENT_WORK_CONTEXT_INVALID")
      const response = await fetch(input.provider === "Codex" ? "/api/loom/codex" : "/api/loom/agent", {
        method: "POST",
        headers: { "content-type": "application/json", ...(receipt ? { "x-williamos-work-context": receipt } : {}) },
        body: JSON.stringify(mode === "review" ? {
          mode: "review",
          path: reviewPath,
          ...(focus ? { focus } : {}),
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : input.provider === "Codex" ? {
          prompt,
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
      let malformed = false
      let sessionSeen = false
      let terminalSeen = false
      let canonicalResultSeen = false
      let resultText: string | null = null
      const acceptLine = (line: string) => {
        if (!line.trim()) return
        let event: Record<string, unknown>
        try { event = JSON.parse(line) as Record<string, unknown> } catch { malformed = true; return }
        if (terminalSeen) { malformed = true; return }
        if (event.type === "session") {
          const validSessionId = typeof event.sessionId === "string" && SESSION_ID.test(event.sessionId)
          const expectedResumed = prior !== null
          const matchesResumeId = !prior || event.sessionId === prior.sessionId
          const codexTruth = input.provider !== "Codex" || event.provider === "Codex" && event.mode === "delegate"
          const claudeTruth = input.provider !== "Claude"
            || (event.provider === undefined || event.provider === "Claude") && (event.mode === undefined || event.mode === mode)
          if (!validSessionId || typeof event.resumed !== "boolean" || event.resumed !== expectedResumed
            || !matchesResumeId || sessionSeen || canonicalResultSeen || !codexTruth || !claudeTruth) {
            malformed = true
            return
          }
          sessionSeen = true
          accepted = {
            schemaVersion: 1,
            sessionId: event.sessionId as string,
            role,
            provider: input.provider,
            assignment,
            ...(mode === "review" ? { reviewPath: reviewPath! } : {}),
            updatedAt: new Date().toISOString(),
          }
          setActiveSessionId(event.sessionId as string)
          input.onEvent?.(event)
          return
        }
        if (event.type === "done") {
          const preSessionFailure = !sessionSeen && event.code === null && Boolean(boundedText(event.reason, 200))
          if (event.reason !== null && typeof event.reason !== "string"
            || event.code !== null && typeof event.code !== "number" || !sessionSeen && !preSessionFailure) { malformed = true; return }
          terminalSeen = true
          finalOutcome.seen = true
          finalOutcome.code = event.code
          finalOutcome.reason = event.reason
          input.onEvent?.(event)
          return
        }
        if (!sessionSeen) { malformed = true; return }
        if (input.provider === "Claude" && event.type === "event") {
          if (!event.event || typeof event.event !== "object" || Array.isArray(event.event) || canonicalResultSeen) { malformed = true; return }
          const payload = event.event as Record<string, unknown>
          if (payload.type === "result") {
            const result = boundedText(payload.result, 200_000)
            if (canonicalResultSeen || payload.subtype !== "success" || payload.is_error === true
              || payload.session_id !== accepted?.sessionId || !result) {
              malformed = true
              return
            }
            canonicalResultSeen = true
            resultText = result
          }
          input.onEvent?.(event)
          return
        }
        if (input.provider === "Claude" && event.type === "stderr") {
          if (!boundedText(event.text, 200_000) || canonicalResultSeen) malformed = true
          else input.onEvent?.(event)
          return
        }
        if (input.provider === "Codex" && event.type === "delta") {
          if (!boundedText(event.text, 20_000) || canonicalResultSeen) malformed = true
          else input.onEvent?.(event)
          return
        }
        if (input.provider === "Codex" && event.type === "result") {
          const result = boundedText(event.text, 200_000)
          if (canonicalResultSeen || !result) { malformed = true; return }
          canonicalResultSeen = true
          resultText = result
          input.onEvent?.(event)
          return
        }
        malformed = true
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
      const invalid = malformed || !terminalSeen
      if (invalid) throw new Error(mode === "review" ? "AGENT_REVIEW_STREAM_INVALID" : "AGENT_STREAM_INVALID")
      const reason = typeof finalOutcome.reason === "string" && finalOutcome.reason.trim()
        ? finalOutcome.reason.trim() : null
      if (reason || finalOutcome.code !== 0) {
        throw new Error(`AGENT_TURN_FAILED:${reason ?? `EXIT_${String(finalOutcome.code)}`}`)
      }
      if (!sessionSeen || !accepted || !canonicalResultSeen || !resultText) throw new Error(mode === "review" ? "AGENT_REVIEW_STREAM_INVALID" : "AGENT_STREAM_INVALID")
      window.localStorage.setItem(storageKey(ownerScope, worldScope), JSON.stringify(accepted))
      descriptorRef.current = accepted
      setSavedDescriptor(accepted)
      setDurableSession(accepted)
      if (mode === "review") input.onReviewComplete?.(resultText)
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
      setActiveProvider(null)
    }
  }, [ownerScope, workContextReceipt, worldScope])

  const runAgentTurn = useCallback((input: RunAgentTurnInput) => executeTurn({ ...input, mode: "delegate" }), [executeTurn])
  const runClaudeTurn = useCallback((input: RunClaudeTurnInput) => executeTurn({ ...input, provider: "Claude" }), [executeTurn])

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
    activeProvider,
    error,
    runAgentTurn,
    runClaudeTurn,
    stop,
  }
}

export function AgentSessionStrip({
  sessions,
  activeSessionId = null,
  runningSessionId = null,
  runningProvider = null,
  onStop,
  onSelect,
  className,
}: {
  sessions: readonly ExperienceAgentSession[]
  activeSessionId?: string | null
  runningSessionId?: string | null
  runningProvider?: AgentProvider | null
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
          aria-label={`Stop ${runningProvider ?? "agent"} turn`}
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
