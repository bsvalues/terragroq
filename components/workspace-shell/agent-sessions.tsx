"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { WorldWorker } from "@/lib/environment/working-world"

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODEX_SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/
const STORAGE_PREFIX = "williamos:agent-session:"
const MAX_DURABLE_SESSIONS = 12
const MAX_COMPLETED_TURNS = 20
const MAX_COLLECTION_BYTES = 262_144

export type AgentProvider = "Codex" | "Claude"

export type CompletedAgentTurn = Readonly<{
  ownerPrompt: string
  finalResult: string
  completedAt: string
}>

export type DurableAgentSession = Readonly<{
  schemaVersion: 1
  sessionId: string
  role: string
  provider: AgentProvider
  assignment: string
  reviewPath?: string
  updatedAt: string
  completedTurns?: readonly CompletedAgentTurn[]
}>

type DurableAgentSessionCollection = Readonly<{
  schemaVersion: 3
  selectedSessionKey: string | null
  sessions: readonly DurableAgentSession[]
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
  truth: "live" | "resume-unverified"
  kind: "durable-session" | "world-worker"
  mode: "delegate" | "review"
  reviewPath?: string
  lastResult?: string
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
  savedSessions: readonly DurableAgentSession[]
  selectedSessionKey: string | null
  descriptorState: "none" | "unverified" | "verified"
  activeSessionId: string | null
  error: string | null
  runClaudeTurn: (input: RunClaudeTurnInput) => Promise<DurableClaudeSession>
  selectSession: (sessionId: string | null) => boolean
  stop: () => void
}>

export type ProviderNeutralAgentSessionController = ExperienceAgentSessionController & Readonly<{
  activeProvider: AgentProvider | null
  runAgentTurn: (input: RunAgentTurnInput) => Promise<DurableAgentSession>
}>

type ActiveAgentOperation = {
  epoch: number
  abort: AbortController
  reader: ReadableStreamDefaultReader<Uint8Array> | null
  storageKey: string
  prior: DurableAgentSession | null
  priorVerified: boolean
  priorCollection: readonly DurableAgentSession[]
  priorSelectedSessionKey: string | null
}

class AgentStartRefusal extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "AgentStartRefusal"
    this.status = status
  }
}

export class AgentTurnCommittedPersistenceError extends Error {
  readonly committed = true

  constructor(message: string) {
    super(message)
    this.name = "AgentTurnCommittedPersistenceError"
  }
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  return text && text.length <= max && !text.includes("\0") ? text : null
}

function validSessionId(provider: AgentProvider, value: unknown): value is string {
  return typeof value === "string" && (provider === "Claude" ? CLAUDE_SESSION_ID : CODEX_SESSION_ID).test(value)
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
  const completedTurns = candidate.completedTurns === undefined ? [] : parseCompletedTurns(candidate.completedTurns)
  if (candidate.schemaVersion !== 1 || candidate.provider !== "Claude" && candidate.provider !== "Codex"
    || !validSessionId(candidate.provider, candidate.sessionId)
    || !role || !assignment || !updatedAt || (candidate.reviewPath !== undefined && !reviewPath) || !completedTurns) return null
  return {
    schemaVersion: 1,
    sessionId: candidate.sessionId,
    role,
    provider: candidate.provider,
    assignment,
    ...(reviewPath ? { reviewPath } : {}),
    updatedAt,
    completedTurns,
  }
}

function sessionKey(provider: AgentProvider, sessionId: string): string {
  return `${provider}:${sessionId}`
}

function parseCompletedTurns(value: unknown): readonly CompletedAgentTurn[] | null {
  if (!Array.isArray(value) || value.length > MAX_COMPLETED_TURNS) return null
  const turns: CompletedAgentTurn[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
    const candidate = raw as Record<string, unknown>
    const ownerPrompt = boundedText(candidate.ownerPrompt, 20_000)
    const finalResult = boundedText(candidate.finalResult, 200_000)
    const completedAt = typeof candidate.completedAt === "string" && Number.isFinite(Date.parse(candidate.completedAt))
      ? candidate.completedAt : null
    if (!ownerPrompt || !finalResult || !completedAt) return null
    turns.push({ ownerPrompt, finalResult, completedAt })
  }
  return turns
}

function parseCollection(value: string | null): DurableAgentSessionCollection | null {
  if (!value) return { schemaVersion: 3, selectedSessionKey: null, sessions: [] }
  let raw: unknown
  try { raw = JSON.parse(value) } catch { return null }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.schemaVersion === 1) {
    const legacy = parseDescriptor(value)
    return legacy ? { schemaVersion: 3, selectedSessionKey: sessionKey(legacy.provider, legacy.sessionId), sessions: [legacy] } : null
  }
  if (candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 || !Array.isArray(candidate.sessions)
    || candidate.sessions.length > MAX_DURABLE_SESSIONS
    || candidate.schemaVersion === 2 && candidate.selectedSessionId !== null && typeof candidate.selectedSessionId !== "string"
    || candidate.schemaVersion === 3 && candidate.selectedSessionKey !== null && typeof candidate.selectedSessionKey !== "string") return null
  const sessions: DurableAgentSession[] = []
  for (const rawSession of candidate.sessions) {
    const descriptor = parseDescriptor(JSON.stringify(rawSession))
    if (!descriptor || sessions.some((session) => sessionKey(session.provider, session.sessionId) === sessionKey(descriptor.provider, descriptor.sessionId))) return null
    sessions.push(descriptor)
  }
  let selectedSessionKey: string | null
  if (candidate.schemaVersion === 2) {
    const selectedSessionId = candidate.selectedSessionId as string | null
    const matches = selectedSessionId === null ? [] : sessions.filter((session) => session.sessionId === selectedSessionId)
    if (selectedSessionId !== null && matches.length !== 1) return null
    selectedSessionKey = matches[0] ? sessionKey(matches[0].provider, matches[0].sessionId) : null
  } else {
    selectedSessionKey = candidate.selectedSessionKey as string | null
    if (selectedSessionKey !== null && !sessions.some((session) => sessionKey(session.provider, session.sessionId) === selectedSessionKey)) return null
  }
  return { schemaVersion: 3, selectedSessionKey, sessions }
}

function boundedCollection(
  sessions: readonly DurableAgentSession[],
  selectedSessionKey: string | null,
  protectedTurn: Readonly<{ sessionKey: string; completedAt: string }> | null = null,
): DurableAgentSessionCollection {
  const mutable = sessions.map((session) => ({ ...session, completedTurns: [...(session.completedTurns ?? [])] }))
  const collection = (): DurableAgentSessionCollection => ({ schemaVersion: 3, selectedSessionKey, sessions: mutable })
  while (new TextEncoder().encode(JSON.stringify(collection())).byteLength > MAX_COLLECTION_BYTES) {
    const oldest = mutable.flatMap((session, sessionIndex) => session.completedTurns.map((turn, turnIndex) => ({
      completedAt: turn.completedAt, key: sessionKey(session.provider, session.sessionId), sessionIndex, turnIndex,
    }))).filter((turn) => !protectedTurn || turn.key !== protectedTurn.sessionKey || turn.completedAt !== protectedTurn.completedAt)
      .sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.key.localeCompare(right.key) || left.turnIndex - right.turnIndex)[0]
    if (!oldest) throw new Error("AGENT_SESSION_COLLECTION_TOO_LARGE")
    mutable[oldest.sessionIndex].completedTurns.splice(oldest.turnIndex, 1)
  }
  return collection()
}

function persistCollection(
  key: string,
  sessions: readonly DurableAgentSession[],
  selectedSessionKey: string | null,
  protectedTurn: Readonly<{ sessionKey: string; completedAt: string }> | null = null,
): DurableAgentSessionCollection {
  const collection = boundedCollection(sessions, selectedSessionKey, protectedTurn)
  try {
    if (collection.sessions.length === 0 && collection.selectedSessionKey === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(collection))
  } catch {
    throw new Error("AGENT_SESSION_PERSISTENCE_FAILED")
  }
  return collection
}

function upsertSession(sessions: readonly DurableAgentSession[], next: DurableAgentSession): readonly DurableAgentSession[] {
  const nextKey = sessionKey(next.provider, next.sessionId)
  const without = sessions.filter((session) => sessionKey(session.provider, session.sessionId) !== nextKey)
  return [...without, next].slice(-MAX_DURABLE_SESSIONS)
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
  durable: readonly DurableAgentSession[],
  verified: readonly DurableAgentSession[],
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
  durable.forEach((descriptor) => {
    const descriptorKey = sessionKey(descriptor.provider, descriptor.sessionId)
    const isVerified = verified.some((session) => sessionKey(session.provider, session.sessionId) === descriptorKey)
    const isWorking = activeSessionId === descriptorKey && isVerified
    sessions.push({
      id: descriptorKey,
      role: descriptor.role,
      providerLabel: descriptor.provider,
      assignment: descriptor.assignment,
      status: isWorking ? "working" : isVerified ? "ready" : "resume unverified",
      evidence: isWorking ? "live agent stream" : isVerified ? "resumable session" : "saved transcript · server verification required",
      truth: isVerified ? "live" : "resume-unverified",
      kind: "durable-session",
      mode: descriptor.reviewPath ? "review" : "delegate",
      ...(descriptor.reviewPath ? { reviewPath: descriptor.reviewPath } : {}),
      ...(descriptor.completedTurns?.at(-1)?.finalResult ? { lastResult: descriptor.completedTurns.at(-1)!.finalResult } : {}),
    })
  })
  return sessions
}

export function useExperienceAgentSessions({
  ownerScope,
  worldScope,
  worldId,
  worker,
}: {
  ownerScope: string
  worldScope: string
  worldId: string | null
  worker: WorldWorker | null
}): ProviderNeutralAgentSessionController {
  const [savedSessions, setSavedSessions] = useState<readonly DurableAgentSession[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [verifiedSessions, setVerifiedSessions] = useState<readonly DurableAgentSession[]>([])
  const [durableSession, setDurableSession] = useState<DurableAgentSession | null>(null)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeProvider, setActiveProvider] = useState<AgentProvider | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionsRef = useRef<readonly DurableAgentSession[]>([])
  const selectedSessionKeyRef = useRef<string | null>(null)
  const verifiedSessionsRef = useRef<readonly DurableAgentSession[]>([])
  const operationEpoch = useRef(0)
  const operationRef = useRef<ActiveAgentOperation | null>(null)

  const invalidateOperation = useCallback((restoreVisibleHint: boolean) => {
    const operation = operationRef.current
    if (!operation) return
    // Invalidation is deliberately first. A cancel/read/finally continuation from this operation
    // can no longer mutate the state or persistence owned by the next turn.
    operationRef.current = null
    // The collection is committed only after a successful terminal frame, so cancellation restores
    // the in-memory snapshot without another storage write that could itself fail or widen truth.
    sessionsRef.current = operation.priorCollection
    selectedSessionKeyRef.current = operation.priorSelectedSessionKey
    if (restoreVisibleHint) {
      setSavedSessions(operation.priorCollection)
      setSelectedSessionKey(operation.priorSelectedSessionKey)
      const verified = operation.prior && operation.priorVerified
        ? upsertSession(verifiedSessionsRef.current, operation.prior)
        : verifiedSessionsRef.current
      verifiedSessionsRef.current = verified
      setVerifiedSessions(verified)
      setDurableSession(operation.priorVerified ? operation.prior : null)
    }
    void operation.reader?.cancel()
    operation.abort.abort()
    setActiveSessionId(null)
    setActiveProvider(null)
  }, [])

  useEffect(() => {
    // A turn is owned by the exact authenticated owner/workspace scope in which it began. Never let
    // a late frame from that scope materialize a ready session after the shell has moved elsewhere.
    invalidateOperation(false)
    const key = storageKey(ownerScope, worldScope)
    const stored = window.localStorage.getItem(key)
    const collection = parseCollection(stored)
    if (!collection) {
      window.localStorage.removeItem(key)
      sessionsRef.current = []
      selectedSessionKeyRef.current = null
      setSavedSessions([])
      setSelectedSessionKey(null)
    } else {
      try {
        const persisted = persistCollection(key, collection.sessions, collection.selectedSessionKey)
        sessionsRef.current = persisted.sessions
        selectedSessionKeyRef.current = persisted.selectedSessionKey
        setSavedSessions(persisted.sessions)
        setSelectedSessionKey(persisted.selectedSessionKey)
      } catch (cause) {
        sessionsRef.current = []
        selectedSessionKeyRef.current = null
        setSavedSessions([])
        setSelectedSessionKey(null)
        setError(cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED")
      }
    }
    // Browser storage is only a resume hint. The server authenticates ownership and existence when
    // a turn actually resumes; until that turn succeeds, this must not enter the live projection.
    verifiedSessionsRef.current = []
    setVerifiedSessions([])
    setDurableSession(null)
  }, [invalidateOperation, ownerScope, worldScope])

  useEffect(() => () => {
    const operation = operationRef.current
    operationRef.current = null
    void operation?.reader?.cancel()
    operation?.abort.abort()
  }, [])

  const stop = useCallback(() => {
    invalidateOperation(true)
  }, [invalidateOperation])

  const selectSession = useCallback((selectedKey: string | null) => {
    if (operationRef.current) return false
    const sessions = sessionsRef.current
    const selected = selectedKey === null ? null : sessions.find((session) => sessionKey(session.provider, session.sessionId) === selectedKey)
    if (selectedKey !== null && !selected) return false
    const key = storageKey(ownerScope, worldScope)
    const nextKey = selected ? sessionKey(selected.provider, selected.sessionId) : null
    let persisted: DurableAgentSessionCollection
    try {
      persisted = persistCollection(key, sessions, nextKey)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED")
      return false
    }
    sessionsRef.current = persisted.sessions
    selectedSessionKeyRef.current = persisted.selectedSessionKey
    setSavedSessions(persisted.sessions)
    setSelectedSessionKey(persisted.selectedSessionKey)
    setDurableSession(selected && verifiedSessionsRef.current.some((session) => sessionKey(session.provider, session.sessionId) === nextKey) ? selected : null)
    return true
  }, [ownerScope, worldScope])

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
    if (operationRef.current) throw new Error("AGENT_TURN_ALREADY_RUNNING")

    const storedPrior = sessionsRef.current.find((session) => sessionKey(session.provider, session.sessionId) === selectedSessionKeyRef.current) ?? null
    const prior = mode === "review"
      ? storedPrior?.provider === "Claude" && storedPrior.role === "Reviewer" && storedPrior.reviewPath === reviewPath ? storedPrior : null
      : storedPrior?.provider === input.provider && !storedPrior.reviewPath
        && storedPrior.role === role && storedPrior.assignment === assignment ? storedPrior : null
    const operationStorageKey = storageKey(ownerScope, worldScope)
    const operation: ActiveAgentOperation = {
      epoch: operationEpoch.current + 1,
      abort: new AbortController(),
      reader: null,
      storageKey: operationStorageKey,
      prior,
      priorVerified: Boolean(prior && verifiedSessionsRef.current.some((session) => sessionKey(session.provider, session.sessionId) === sessionKey(prior.provider, prior.sessionId))),
      priorCollection: sessionsRef.current,
      priorSelectedSessionKey: selectedSessionKeyRef.current,
    }
    operationEpoch.current = operation.epoch
    operationRef.current = operation
    const isCurrent = () => operationRef.current === operation
    // A restored descriptor remains a non-live resume hint while the server verifies it. Unrelated
    // sessions are never removed merely because another turn starts.
    setActiveSessionId(prior ? sessionKey(prior.provider, prior.sessionId) : `starting-${input.provider.toLowerCase()}-session`)
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
      if (input.provider === "Codex" && !boundedText(worldId, 200)) throw new Error("AGENT_SPACE_REQUIRED")
      const response = await fetch(input.provider === "Codex" ? "/api/loom/codex" : "/api/loom/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "review" ? {
          mode: "review",
          path: reviewPath,
          ...(focus ? { focus } : {}),
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : input.provider === "Codex" ? {
          worldId,
          prompt,
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : {
          prompt,
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        }),
        signal: operation.abort.signal,
        cache: "no-store",
      })
      if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
      if (!response.ok || !response.body) {
        let refusal: { error?: unknown; detail?: unknown } = {}
        try { refusal = await response.json() as { error?: unknown; detail?: unknown } } catch { /* typed fallback below */ }
        const detail = boundedText(refusal.detail, 1_000)
        const code = boundedText(refusal.error, 200)
        throw new AgentStartRefusal(response.status, detail ?? code ?? `AGENT_START_REFUSED:${response.status}`)
      }

      const reader = response.body.getReader()
      if (!isCurrent()) {
        void reader.cancel()
        throw new DOMException("Aborted", "AbortError")
      }
      operation.reader = reader
      const decoder = new TextDecoder()
      let buffer = ""
      let malformed = false
      let sessionSeen = false
      let terminalSeen = false
      let canonicalResultSeen = false
      let resultText: string | null = null
      const acceptLine = (line: string) => {
        if (!isCurrent()) return
        if (!line.trim()) return
        let event: Record<string, unknown>
        try { event = JSON.parse(line) as Record<string, unknown> } catch { malformed = true; return }
        if (terminalSeen) { malformed = true; return }
        if (event.type === "session") {
          const sessionIdValid = validSessionId(input.provider, event.sessionId)
          const expectedResumed = prior !== null
          const matchesResumeId = !prior || event.sessionId === prior.sessionId
          const codexTruth = input.provider !== "Codex" || event.provider === "Codex" && event.mode === "delegate"
          const claudeTruth = input.provider !== "Claude"
            || (event.provider === undefined || event.provider === "Claude") && (event.mode === undefined || event.mode === mode)
          const unexpectedReuse = !prior && typeof event.sessionId === "string"
            && sessionsRef.current.some((session) => session.provider === input.provider && session.sessionId === event.sessionId)
          if (!sessionIdValid || typeof event.resumed !== "boolean" || event.resumed !== expectedResumed
            || !matchesResumeId || unexpectedReuse || sessionSeen || canonicalResultSeen || !codexTruth || !claudeTruth) {
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
          if (isCurrent()) {
            setActiveSessionId(sessionKey(input.provider, event.sessionId as string))
            input.onEvent?.(event)
          }
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
          if (isCurrent()) input.onEvent?.(event)
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
          if (isCurrent()) input.onEvent?.(event)
          return
        }
        if (input.provider === "Claude" && event.type === "stderr") {
          if (!boundedText(event.text, 200_000)) malformed = true
          else if (isCurrent()) input.onEvent?.(event)
          return
        }
        if (input.provider === "Codex" && event.type === "delta") {
          if (!boundedText(event.text, 20_000) || canonicalResultSeen) malformed = true
          else if (isCurrent()) input.onEvent?.(event)
          return
        }
        if (input.provider === "Codex" && event.type === "result") {
          const result = boundedText(event.text, 200_000)
          if (canonicalResultSeen || !result) { malformed = true; return }
          canonicalResultSeen = true
          resultText = result
          if (isCurrent()) input.onEvent?.(event)
          return
        }
        malformed = true
      }
      for (;;) {
        const { done, value } = await reader.read()
        if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        lines.forEach(acceptLine)
      }
      buffer += decoder.decode()
      acceptLine(buffer)
      if (!isCurrent() || operation.abort.signal.aborted) throw new DOMException("Aborted", "AbortError")
      const invalid = malformed || !terminalSeen
      if (invalid) throw new Error(mode === "review" ? "AGENT_REVIEW_STREAM_INVALID" : "AGENT_STREAM_INVALID")
      const reason = typeof finalOutcome.reason === "string" && finalOutcome.reason.trim()
        ? finalOutcome.reason.trim() : null
      if (reason || finalOutcome.code !== 0) {
        throw new Error(`AGENT_TURN_FAILED:${reason ?? `EXIT_${String(finalOutcome.code)}`}`)
      }
      const acceptedSession = accepted as DurableAgentSession | null
      if (!sessionSeen || !acceptedSession || !canonicalResultSeen || !resultText) throw new Error(mode === "review" ? "AGENT_REVIEW_STREAM_INVALID" : "AGENT_STREAM_INVALID")
      if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
      const completedAt = new Date().toISOString()
      const settledSession: DurableAgentSession = {
        ...acceptedSession,
        updatedAt: completedAt,
        completedTurns: [...(prior?.completedTurns ?? []), {
          ownerPrompt: mode === "review" ? focus ?? `Review ${reviewPath}` : prompt!,
          finalResult: resultText,
          completedAt,
        }].slice(-MAX_COMPLETED_TURNS),
      }
      const nextSessions = upsertSession(sessionsRef.current, settledSession)
      const settledKey = sessionKey(settledSession.provider, settledSession.sessionId)
      let persisted: DurableAgentSessionCollection
      try {
        persisted = persistCollection(operationStorageKey, nextSessions, settledKey, { sessionKey: settledKey, completedAt })
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED"
        throw new AgentTurnCommittedPersistenceError(message)
      }
      sessionsRef.current = persisted.sessions
      selectedSessionKeyRef.current = persisted.selectedSessionKey
      setSavedSessions(persisted.sessions)
      setSelectedSessionKey(persisted.selectedSessionKey)
      const persistedSession = persisted.sessions.find((session) => sessionKey(session.provider, session.sessionId) === settledKey)!
      const nextVerified = upsertSession(verifiedSessionsRef.current, persistedSession)
      verifiedSessionsRef.current = nextVerified
      setVerifiedSessions(nextVerified)
      setDurableSession(persistedSession)
      if (mode === "review" && isCurrent()) input.onReviewComplete?.(resultText)
      return persistedSession
    } catch (cause) {
      // A failed resume is no longer evidence that the saved descriptor exists or belongs to this
      // authenticated owner. Clear it so the next Delegate can start a fresh truthful session.
      // A user cancellation is different: it does not disprove an already verified descriptor.
      const error = cause as Error
      if (!isCurrent()) throw cause
      if (error instanceof AgentTurnCommittedPersistenceError) {
        sessionsRef.current = operation.priorCollection
        selectedSessionKeyRef.current = operation.priorSelectedSessionKey
        setSavedSessions(operation.priorCollection)
        setSelectedSessionKey(operation.priorSelectedSessionKey)
        setDurableSession(operation.priorVerified ? operation.prior : null)
        setError(error.message)
        throw cause
      }
      const terminalResumeRefusal = prior !== null && error instanceof AgentStartRefusal
        && (error.status === 401 || error.status === 403 || error.status === 404)
      if (error?.name !== "AbortError" && terminalResumeRefusal && prior) {
        const priorKey = sessionKey(prior.provider, prior.sessionId)
        const remaining = sessionsRef.current.filter((session) => sessionKey(session.provider, session.sessionId) !== priorKey)
        const remainingSelected = selectedSessionKeyRef.current === priorKey ? null : selectedSessionKeyRef.current
        const persisted = persistCollection(operationStorageKey, remaining, remainingSelected)
        sessionsRef.current = persisted.sessions
        selectedSessionKeyRef.current = persisted.selectedSessionKey
        setSavedSessions(persisted.sessions)
        setSelectedSessionKey(persisted.selectedSessionKey)
        const remainingVerified = verifiedSessionsRef.current.filter((session) => sessionKey(session.provider, session.sessionId) !== priorKey)
        verifiedSessionsRef.current = remainingVerified
        setVerifiedSessions(remainingVerified)
        setDurableSession(null)
      } else if (prior) {
        persistCollection(operationStorageKey, sessionsRef.current, selectedSessionKeyRef.current)
      } else {
        persistCollection(operationStorageKey, sessionsRef.current, selectedSessionKeyRef.current)
      }
      if (error?.name !== "AbortError") setError(cause instanceof Error ? cause.message : "AGENT_UNAVAILABLE")
      throw cause
    } finally {
      if (isCurrent()) {
        operation.reader = null
        operationRef.current = null
        setActiveSessionId(null)
        setActiveProvider(null)
      }
    }
  }, [ownerScope, worldId, worldScope])

  const runAgentTurn = useCallback((input: RunAgentTurnInput) => executeTurn({ ...input, mode: "delegate" }), [executeTurn])
  const runClaudeTurn = useCallback((input: RunClaudeTurnInput) => executeTurn({ ...input, provider: "Claude" }), [executeTurn])

  const sessions = useMemo(
    () => projectSessions(worker, savedSessions, verifiedSessions, activeSessionId),
    [worker, savedSessions, verifiedSessions, activeSessionId],
  )
  const savedDescriptor = savedSessions.find((session) => sessionKey(session.provider, session.sessionId) === selectedSessionKey) ?? null
  const descriptorState = durableSession ? "verified" : savedDescriptor ? "unverified" : "none"
  return {
    sessions,
    durableSession,
    savedDescriptor,
    savedSessions,
    selectedSessionKey,
    descriptorState,
    activeSessionId,
    activeProvider,
    error,
    runAgentTurn,
    runClaudeTurn,
    selectSession,
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
