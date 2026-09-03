"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { ProjectedWorldWorkerSession } from "@/lib/environment/world-execution"
import type { AssignmentContextManifest } from "@/lib/loom/assignment-context-manifest"
import type { CanonicalWorkspaceProjectKey } from "@/lib/projects/workspace-project-binding"
import { resolveWorkspaceRepositorySelection } from "@/lib/projects/core-seven-repositories"
import { parseWorkspaceFileRef, type WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"
import { parseAssignmentContextManifestView } from "./assignment-context-view"

const CLAUDE_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CODEX_SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/
const ACTIVE_WORLD_EXECUTION_STATES = new Set(["authorized", "acquired", "implementing", "validating", "reviewing", "remediating"])
const ASSIGNMENT_HASH = /^[0-9a-f]{64}$/
const GIT_OBJECT_HASH = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const STORAGE_PREFIX = "williamos:agent-session:"
const MAX_DURABLE_SESSIONS = 12
const MAX_COMPLETED_TURNS = 20
const MAX_COLLECTION_BYTES = 262_144
const MAX_PRESENTATION_CHARACTERS = 2_000
const MAX_PRESENTATION_BYTES = 4_096

export type AgentProvider = "Codex" | "Claude" | "Local"

export type AgentTurnPresentation = Readonly<{
  phase: "working" | "complete"
  text: string
  provider: AgentProvider
  sessionId: string
}>

export type CompletedAgentTurn = Readonly<{
  ownerPrompt: string
  finalResult: string
  completedAt: string
}>

export type AgentSessionFileTarget = Readonly<{
  kind: "file"
  path: string
}>

export type AgentSessionRepository = Readonly<{
  resourceKey: string
  identity: string
  mountKey: string
  observedRevision: string
}>

export type AgentSessionFileAuthorityProof = Readonly<{
  worldId: string
  worldRevision: number
  outcomeKey: string
  workOrderId: number
  grantId: number
  actor: "codex" | "claude"
  selectedPath: string
}>

export type AgentSessionPreview = Readonly<{
  worldId: string
  evidenceFingerprint: string
}>

export type AgentSessionDiffReview = Readonly<{
  worldId: string
  path: string
  fingerprint: string
  baseHash: string
  indexHash: string
  patchHash: string
  completedAt: string
}>

export type DurableAgentSession = Readonly<{
  schemaVersion: 1
  sessionId: string
  assignmentId?: string
  role: string
  provider: AgentProvider
  assignment: string
  repository?: AgentSessionRepository
  contextManifest?: AssignmentContextManifest
  target?: AgentSessionFileTarget
  fileRef?: WorkspaceFileRef
  reviewPath?: string
  diffReview?: AgentSessionDiffReview
  forkedFrom?: string
  preview?: AgentSessionPreview
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
  assignmentId?: string
  role: string
  providerLabel: string
  assignment: string
  status: string
  evidence: string
  truth: "live" | "persisted" | "resume-unverified"
  kind: "durable-session" | "world-worker"
  mode: "delegate" | "review" | "diff-review" | "preview"
  repository?: AgentSessionRepository
  contextManifest?: AssignmentContextManifest
  target?: AgentSessionFileTarget
  fileRef?: WorkspaceFileRef
  reviewPath?: string
  diffReview?: AgentSessionDiffReview
  forkedFrom?: string
  preview?: AgentSessionPreview
  updatedAt?: string
  lastResult?: string
  presentation?: string
}>

export type MissionAgentSessionProjection = Readonly<{
  id: string
  name: string
  role: string
  activity: string
  state: "working" | "waiting" | "blocked" | "idle"
  truth?: "live" | "persisted" | "resume-unverified"
}>

export type SavedAgentSessionProjection = Readonly<{
  state: AgentSessionCollectionState
  sessions: readonly ExperienceAgentSession[]
}>

export type AgentSessionCollectionState = "available" | "missing" | "corrupt" | "oversized" | "unavailable" | "partial"

export type ActiveAgentTurn = Readonly<{
  id: string
  provider: AgentProvider
  role: string
  sessionId: string | null
  presentation: string
  descriptor: DurableAgentSession | null
}>

export type RunClaudeTurnInput = Readonly<{
  role: string
  assignment: string
  prompt?: string
  mode?: "delegate" | "review" | "diff-review"
  path?: string
  worldId?: string
  expectedDiffFingerprint?: string
  focus?: string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onPresentation?: (presentation: AgentTurnPresentation) => void
  onReviewComplete?: (report: string, binding?: AgentSessionDiffReview) => void
  target?: AgentSessionFileTarget
  fileRef?: WorkspaceFileRef
  repositoryKey?: string
  expectedFileAuthority?: AgentSessionFileAuthorityProof
  requiredSessionKey?: string
}>

export type RunAgentTurnInput = Readonly<{
  provider: AgentProvider
  role: string
  assignment: string
  prompt: string
  target?: AgentSessionFileTarget
  repositoryKey?: string
  expectedFileAuthority?: AgentSessionFileAuthorityProof
  automatic?: boolean
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onPresentation?: (presentation: AgentTurnPresentation) => void
  onContinuation?: (continuation: Readonly<{ status: string; selectedPath?: string; task?: string; repositoryKey?: string }>) => void | Promise<void>
}>

export type RunPreviewDiagnosticInput = Readonly<{
  prompt: string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onPresentation?: (presentation: AgentTurnPresentation) => void
}>

export type ForkClaudeSessionInput = Readonly<{
  sourceSessionId: string
  assignment: string
  prompt: string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onPresentation?: (presentation: AgentTurnPresentation) => void
}>

export type ContinueAgentSessionInput = Readonly<{
  sessionKey: string
  prompt: string
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
  onPresentation?: (presentation: AgentTurnPresentation) => void
}>

export function agentPresentationText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const text = value.trim()
  if (!text || text.length > MAX_PRESENTATION_CHARACTERS
    || new TextEncoder().encode(text).byteLength > MAX_PRESENTATION_BYTES
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)
    || /<\/?(?:thinking|analysis|reasoning)\b|chain[- ]of[- ]thought|system prompt/i.test(text)
    || /authorization\s*:|bearer\s+[a-z0-9._~+\/-]{6,}|(?:sk|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|(?:api[_ -]?key|password|secret|token)\s*[:=]/i.test(text)) return null
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === "object") return null
    } catch { /* ordinary prose may begin with punctuation */ }
  }
  return text
}

export type ExperienceAgentSessionController = Readonly<{
  sessions: readonly ExperienceAgentSession[]
  durableSession: DurableAgentSession | null
  savedDescriptor: DurableAgentSession | null
  savedSessions: readonly DurableAgentSession[]
  collectionState: AgentSessionCollectionState
  selectedSessionKey: string | null
  descriptorState: "none" | "unverified" | "verified"
  activeSessionId: string | null
  pausableSessionId: string | null
  activeSessionIds: readonly string[]
  pausableSessionIds: readonly string[]
  activeTurns: readonly ActiveAgentTurn[]
  error: string | null
  runClaudeTurn: (input: RunClaudeTurnInput) => Promise<DurableClaudeSession>
  runPreviewDiagnostic: (input: RunPreviewDiagnosticInput) => Promise<DurableClaudeSession>
  selectSession: (sessionId: string | null) => boolean
  stop: (sessionId?: string) => void
}>

export type ProviderNeutralAgentSessionController = ExperienceAgentSessionController & Readonly<{
  activeProvider: AgentProvider | null
  runAgentTurn: (input: RunAgentTurnInput) => Promise<DurableAgentSession>
  forkClaudeSession: (input: ForkClaudeSessionInput) => Promise<DurableAgentSession>
  continueSession: (input: ContinueAgentSessionInput) => Promise<DurableAgentSession>
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
  provider: AgentProvider
  role: string
  mode: "delegate" | "review" | "diff-review" | "fork" | "preview"
  lane: string | null
  accepted: DurableAgentSession | null
  acceptedKey: string | null
  presentation: string
  selectionGeneration: number
  selectionFallbackKey: string | null
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

function boundedFragment(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max
    && new TextEncoder().encode(value).byteLength <= max && !value.includes("\0")
}

function validSessionId(provider: AgentProvider, value: unknown): value is string {
  return typeof value === "string" && (provider === "Codex" ? CODEX_SESSION_ID : CLAUDE_SESSION_ID).test(value)
}

class AgentTargetBindingError extends Error {
  constructor() {
    super("AGENT_STREAM_INVALID")
    this.name = "AgentTargetBindingError"
  }
}

function canonicalWorkspaceFilePath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_000 || value !== value.trim()) return null
  if (/[\\\u0000-\u001f\u007f]/.test(value) || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return null
  const segments = value.split("/")
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) return null
  return value
}

function parseFileTarget(value: unknown): AgentSessionFileTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).length !== 2 || candidate.kind !== "file") return null
  const path = canonicalWorkspaceFilePath(candidate.path)
  return path ? { kind: "file", path } : null
}

function parseFileAuthorityProof(value: unknown): AgentSessionFileAuthorityProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate).sort().join("\0")
  const worldId = boundedText(candidate.worldId, 200)
  const outcomeKey = boundedText(candidate.outcomeKey, 200)
  const selectedPath = canonicalWorkspaceFilePath(candidate.selectedPath)
  return keys === "actor\0grantId\0outcomeKey\0selectedPath\0workOrderId\0worldId\0worldRevision"
    && worldId && outcomeKey && selectedPath
    && Number.isSafeInteger(candidate.worldRevision) && Number(candidate.worldRevision) >= 0
    && Number.isSafeInteger(candidate.workOrderId) && Number(candidate.workOrderId) > 0
    && Number.isSafeInteger(candidate.grantId) && Number(candidate.grantId) > 0
    && (candidate.actor === "codex" || candidate.actor === "claude")
    ? {
      worldId, worldRevision: candidate.worldRevision as number, outcomeKey,
      workOrderId: candidate.workOrderId as number, grantId: candidate.grantId as number,
      actor: candidate.actor, selectedPath,
    }
    : null
}

function parsePreview(value: unknown): AgentSessionPreview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const worldId = boundedText(candidate.worldId, 200)
  const evidenceFingerprint = typeof candidate.evidenceFingerprint === "string" && ASSIGNMENT_HASH.test(candidate.evidenceFingerprint)
    ? candidate.evidenceFingerprint : null
  return Object.keys(candidate).length === 2 && worldId && evidenceFingerprint ? { worldId, evidenceFingerprint } : null
}

function parseDiffReview(value: unknown): AgentSessionDiffReview | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const worldId = boundedText(candidate.worldId, 200)
  const path = canonicalWorkspaceFilePath(candidate.path)
  const candidateFingerprint = boundedText(candidate.fingerprint, 16_384)
  const fingerprint = candidateFingerprint && new TextEncoder().encode(candidateFingerprint).byteLength <= 16_384
    ? candidateFingerprint : null
  const baseHash = typeof candidate.baseHash === "string" && GIT_OBJECT_HASH.test(candidate.baseHash) ? candidate.baseHash : null
  const indexHash = typeof candidate.indexHash === "string" && ASSIGNMENT_HASH.test(candidate.indexHash) ? candidate.indexHash : null
  const patchHash = typeof candidate.patchHash === "string" && ASSIGNMENT_HASH.test(candidate.patchHash) ? candidate.patchHash : null
  const candidateCompletedAt = boundedText(candidate.completedAt, 40)
  const completedAt = candidateCompletedAt && Number.isFinite(Date.parse(candidateCompletedAt))
    && new Date(candidateCompletedAt).toISOString() === candidateCompletedAt ? candidateCompletedAt : null
  return Object.keys(candidate).length === 7 && worldId && path && fingerprint && baseHash && indexHash && patchHash && completedAt
    ? { worldId, path, fingerprint, baseHash, indexHash, patchHash, completedAt }
    : null
}

function parseSessionRepository(value: unknown): AgentSessionRepository | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (Object.keys(candidate).sort().join("|") !== "identity|mountKey|observedRevision|resourceKey"
    || typeof candidate.resourceKey !== "string"
    || typeof candidate.identity !== "string"
    || typeof candidate.mountKey !== "string"
    || typeof candidate.observedRevision !== "string"
    || !GIT_OBJECT_HASH.test(candidate.observedRevision)) return null
  const selection = resolveWorkspaceRepositorySelection(
    candidate.resourceKey === "williamos" ? "williamos" : "terrafusion",
    candidate.resourceKey,
  )
  if (!selection.ok || selection.repository.identity !== candidate.identity
    || selection.repository.mountKey !== candidate.mountKey) return null
  return {
    resourceKey: candidate.resourceKey,
    identity: candidate.identity,
    mountKey: candidate.mountKey,
    observedRevision: candidate.observedRevision,
  }
}

function optionalMetadataSessionIdentity(value: unknown): Readonly<{ key: string; sessionId: string }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!("target" in candidate) && !("forkedFrom" in candidate) && !("preview" in candidate) && !("diffReview" in candidate)
    && !("reviewPath" in candidate) && candidate.role !== "Reviewer"
    || candidate.provider !== "Claude" && candidate.provider !== "Codex" && candidate.provider !== "Local"
    || !validSessionId(candidate.provider, candidate.sessionId)) return null
  return { key: sessionKey(candidate.provider, candidate.sessionId), sessionId: candidate.sessionId }
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
  const target = candidate.target === undefined ? undefined : parseFileTarget(candidate.target)
  let fileRef: WorkspaceFileRef | undefined
  try { fileRef = candidate.fileRef === undefined ? undefined : parseWorkspaceFileRef(candidate.fileRef) } catch { return null }
  const reviewPath = candidate.reviewPath === undefined ? undefined : boundedText(candidate.reviewPath, 1_000)
  const forkedFrom = candidate.forkedFrom === undefined ? undefined
    : typeof candidate.forkedFrom === "string" && CLAUDE_SESSION_ID.test(candidate.forkedFrom) && candidate.forkedFrom !== candidate.sessionId
      ? candidate.forkedFrom : null
  const completedTurns = candidate.completedTurns === undefined ? [] : parseCompletedTurns(candidate.completedTurns)
  const preview = candidate.preview === undefined ? undefined : parsePreview(candidate.preview)
  const diffReview = candidate.diffReview === undefined ? undefined : parseDiffReview(candidate.diffReview)
  const repository = candidate.repository === undefined ? undefined : parseSessionRepository(candidate.repository)
  const contextManifest = candidate.contextManifest === undefined ? undefined
    : parseAssignmentContextManifestView(candidate.contextManifest)
  const assignmentId = candidate.assignmentId === undefined ? undefined : boundedText(candidate.assignmentId, 300)
  const isClaudeReviewer = candidate.provider === "Claude" && role === "Reviewer"
  if (candidate.schemaVersion !== 1 || candidate.provider !== "Claude" && candidate.provider !== "Codex" && candidate.provider !== "Local"
    || !validSessionId(candidate.provider, candidate.sessionId)
    || !role || !assignment || !updatedAt || (candidate.target !== undefined && !target)
    || (candidate.repository !== undefined && !repository)
    || (candidate.contextManifest !== undefined && !contextManifest)
    || (candidate.assignmentId !== undefined && !assignmentId)
    || (candidate.reviewPath !== undefined && !reviewPath) || (candidate.forkedFrom !== undefined && !forkedFrom) || !completedTurns
    || (candidate.fileRef !== undefined && !fileRef)
    || target !== undefined && (role !== "Builder"
      || candidate.provider !== "Codex" && candidate.provider !== "Claude" || reviewPath !== undefined)
    || isClaudeReviewer !== (reviewPath !== undefined)
    || fileRef !== undefined && (!isClaudeReviewer || fileRef.path !== reviewPath
      || !repository || fileRef.repositoryResourceKey !== repository.resourceKey
      || fileRef.repositoryMountKey !== repository.mountKey || fileRef.observedRevision !== repository.observedRevision)
    || (candidate.diffReview !== undefined && !diffReview)
    || diffReview != null && (candidate.provider !== "Claude" || role !== "Reviewer" || reviewPath !== diffReview.path
      || target !== undefined || preview !== undefined || forkedFrom !== undefined)
    || (candidate.preview !== undefined && !preview)
    || forkedFrom !== undefined && (candidate.provider !== "Claude" || role !== "Builder" || reviewPath !== undefined || target !== undefined || preview !== undefined)
    || preview !== undefined && (candidate.provider !== "Claude" || role !== "Preview debugger" || target !== undefined || reviewPath !== undefined || forkedFrom !== undefined)
    || contextManifest && (!repository || !target
      || contextManifest.assignment.assignmentId !== (assignmentId ?? candidate.sessionId)
      || contextManifest.targetRepository.repositoryKey !== repository.resourceKey
      || contextManifest.targetRepository.repositoryIdentity !== repository.identity
      || contextManifest.checkout.repositoryMountKey !== repository.mountKey
      || contextManifest.checkout.baseRevision !== repository.observedRevision
      || !contextManifest.mutationPosture.target.writablePaths.includes(target.path))
    || candidate.provider === "Local" && (role !== "Thinker" || assignment !== "Conversation" || target !== undefined || reviewPath !== undefined || preview !== undefined)) return null
  return {
    schemaVersion: 1,
    sessionId: candidate.sessionId,
    ...(assignmentId ? { assignmentId } : {}),
    role,
    provider: candidate.provider,
    assignment,
    ...(repository ? { repository } : {}),
    ...(contextManifest ? { contextManifest } : {}),
    ...(target ? { target } : {}),
    ...(fileRef ? { fileRef } : {}),
    ...(reviewPath ? { reviewPath } : {}),
    ...(diffReview ? { diffReview } : {}),
    ...(forkedFrom ? { forkedFrom } : {}),
    ...(preview ? { preview } : {}),
    updatedAt,
    completedTurns,
  }
}

function sessionKey(provider: AgentProvider, sessionId: string): string {
  return `${provider}:${sessionId}`
}

export function selectSpaceContinueCandidate(
  collectionState: AgentSessionCollectionState,
  sessions: readonly DurableAgentSession[],
  selectedKey: string | null,
): DurableAgentSession | null {
  if (collectionState !== "available") return null
  const selected = selectedKey
    ? sessions.find((session) => sessionKey(session.provider, session.sessionId) === selectedKey) ?? null
    : null
  if (selected) return selected
  return [...sessions].sort((left, right) => {
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    return updated || sessionKey(left.provider, left.sessionId).localeCompare(sessionKey(right.provider, right.sessionId))
  })[0] ?? null
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

type ParsedAgentSessionCollection = Readonly<{
  collection: DurableAgentSessionCollection
  partial: boolean
}>

function parseCollection(value: string | null): ParsedAgentSessionCollection | null {
  if (!value) return { collection: { schemaVersion: 3, selectedSessionKey: null, sessions: [] }, partial: false }
  let raw: unknown
  try { raw = JSON.parse(value) } catch { return null }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const candidate = raw as Record<string, unknown>
  if (candidate.schemaVersion === 1) {
    const legacy = parseDescriptor(value)
    return legacy ? { collection: { schemaVersion: 3, selectedSessionKey: sessionKey(legacy.provider, legacy.sessionId), sessions: [legacy] }, partial: false } : null
  }
  if (candidate.schemaVersion !== 2 && candidate.schemaVersion !== 3 || !Array.isArray(candidate.sessions)
    || candidate.sessions.length > MAX_DURABLE_SESSIONS
    || candidate.schemaVersion === 2 && candidate.selectedSessionId !== null && typeof candidate.selectedSessionId !== "string"
    || candidate.schemaVersion === 3 && candidate.selectedSessionKey !== null && typeof candidate.selectedSessionKey !== "string") return null
  const sessions: DurableAgentSession[] = []
  const skippedTargetKeys = new Set<string>()
  const skippedTargetIds = new Set<string>()
  let partial = false
  for (const rawSession of candidate.sessions) {
    const descriptor = parseDescriptor(JSON.stringify(rawSession))
    if (!descriptor) {
      const skipped = optionalMetadataSessionIdentity(rawSession)
      if (!skipped) return null
      skippedTargetKeys.add(skipped.key)
      skippedTargetIds.add(skipped.sessionId)
      partial = true
      continue
    }
    if (sessions.some((session) => sessionKey(session.provider, session.sessionId) === sessionKey(descriptor.provider, descriptor.sessionId))) return null
    sessions.push(descriptor)
  }
  let selectedSessionKey: string | null
  if (candidate.schemaVersion === 2) {
    const selectedSessionId = candidate.selectedSessionId as string | null
    const matches = selectedSessionId === null ? [] : sessions.filter((session) => session.sessionId === selectedSessionId)
    if (selectedSessionId !== null && matches.length !== 1 && !skippedTargetIds.has(selectedSessionId)) return null
    selectedSessionKey = matches[0] ? sessionKey(matches[0].provider, matches[0].sessionId) : null
  } else {
    selectedSessionKey = candidate.selectedSessionKey as string | null
    if (selectedSessionKey !== null && !sessions.some((session) => sessionKey(session.provider, session.sessionId) === selectedSessionKey)) {
      if (!skippedTargetKeys.has(selectedSessionKey)) return null
      selectedSessionKey = null
    }
  }
  return { collection: { schemaVersion: 3, selectedSessionKey, sessions }, partial }
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

function persistForkCollection(
  key: string,
  sessions: readonly DurableAgentSession[],
  sourceKey: string,
  child: DurableAgentSession,
  selectedSessionKey: string | null,
): DurableAgentSessionCollection {
  const childKey = sessionKey(child.provider, child.sessionId)
  let retained = sessions.filter((session) => sessionKey(session.provider, session.sessionId) !== childKey)
  if (retained.length >= MAX_DURABLE_SESSIONS) {
    const removable = retained.findIndex((session) => sessionKey(session.provider, session.sessionId) !== sourceKey)
    if (removable < 0) throw new Error("AGENT_SESSION_COLLECTION_TOO_LARGE")
    retained = retained.filter((_, index) => index !== removable)
  }
  const nextSessions = [...retained, child]
  const collection: DurableAgentSessionCollection = {
    schemaVersion: 3,
    selectedSessionKey: nextSessions.some((session) => sessionKey(session.provider, session.sessionId) === selectedSessionKey)
      ? selectedSessionKey
      : null,
    sessions: nextSessions,
  }
  if (new TextEncoder().encode(JSON.stringify(collection)).byteLength > MAX_COLLECTION_BYTES) {
    throw new Error("AGENT_SESSION_COLLECTION_TOO_LARGE")
  }
  try { window.localStorage.setItem(key, JSON.stringify(collection)) } catch { throw new Error("AGENT_SESSION_PERSISTENCE_FAILED") }
  return collection
}

function storageKey(ownerScope: string, worldScope: string): string {
  const owner = boundedText(ownerScope, 500)
  const world = boundedText(worldScope, 500)
  if (!owner) throw new Error("AGENT_OWNER_SCOPE_REQUIRED")
  if (!world) throw new Error("AGENT_WORLD_SCOPE_REQUIRED")
  return `${STORAGE_PREFIX}${encodeURIComponent(owner)}:${encodeURIComponent(world)}`
}

function projectSessions(
  executionSession: ProjectedWorldWorkerSession | null,
  durable: readonly DurableAgentSession[],
  verified: readonly DurableAgentSession[],
  activeTurns: readonly ActiveAgentTurn[],
): readonly ExperienceAgentSession[] {
  const sessions: ExperienceAgentSession[] = []
  if (executionSession) {
    sessions.push({
      id: executionSession.id,
      role: executionSession.role,
      providerLabel: executionSession.providerLabel,
      assignment: executionSession.assignment,
      status: executionSession.status,
      evidence: executionSession.evidence,
      truth: "persisted",
      kind: "world-worker",
      mode: "delegate",
    })
  }
  durable.forEach((descriptor) => {
    const descriptorKey = sessionKey(descriptor.provider, descriptor.sessionId)
    const isLocal = descriptor.provider === "Local"
    const isVerified = !(descriptor.provider === "Claude" && descriptor.target)
      && verified.some((session) => sessionKey(session.provider, session.sessionId) === descriptorKey)
    const active = activeTurns.find((turn) => turn.id === descriptorKey)
    const isWorking = Boolean(active)
    sessions.push({
      id: descriptorKey,
      ...(descriptor.assignmentId ? { assignmentId: descriptor.assignmentId } : {}),
      role: descriptor.role,
      providerLabel: descriptor.provider,
      assignment: descriptor.assignment,
      status: isWorking ? isLocal ? "thinking" : "working" : isVerified ? "ready" : "resume unverified",
      evidence: isWorking ? isLocal ? "live model response" : "live agent stream"
        : isVerified ? isLocal ? "resumable conversation" : "resumable session"
          : isLocal ? "saved conversation · replay verification required" : "saved transcript · server verification required",
      truth: isVerified || active ? "live" : "resume-unverified",
      kind: "durable-session",
      mode: descriptor.preview ? "preview" : descriptor.diffReview ? "diff-review" : descriptor.reviewPath ? "review" : "delegate",
      ...(descriptor.repository ? { repository: descriptor.repository } : {}),
      ...(descriptor.contextManifest ? { contextManifest: descriptor.contextManifest } : {}),
      ...(descriptor.target ? { target: descriptor.target } : {}),
      ...(descriptor.fileRef ? { fileRef: descriptor.fileRef } : {}),
      ...(descriptor.reviewPath ? { reviewPath: descriptor.reviewPath } : {}),
      ...(descriptor.diffReview ? { diffReview: descriptor.diffReview } : {}),
      ...(descriptor.forkedFrom ? { forkedFrom: descriptor.forkedFrom } : {}),
      ...(descriptor.preview ? { preview: descriptor.preview } : {}),
      updatedAt: descriptor.updatedAt,
      ...(descriptor.completedTurns?.at(-1)?.finalResult ? { lastResult: descriptor.completedTurns.at(-1)!.finalResult } : {}),
      ...(active ? { presentation: active.presentation } : {}),
    })
  })
  activeTurns.forEach((turn) => {
    if (!turn.sessionId || sessions.some((session) => session.id === turn.id)) return
    const descriptor = turn.descriptor
    if (!descriptor) return
    sessions.push({
      id: turn.id,
      ...(descriptor.assignmentId ? { assignmentId: descriptor.assignmentId } : {}),
      role: descriptor.role,
      providerLabel: descriptor.provider,
      assignment: descriptor.assignment,
      status: descriptor.provider === "Local" ? "thinking" : "working",
      evidence: descriptor.provider === "Local" ? "live model response" : "live agent stream",
      truth: "live",
      kind: "durable-session",
      mode: descriptor.preview ? "preview" : descriptor.diffReview ? "diff-review" : descriptor.reviewPath ? "review" : "delegate",
      ...(descriptor.repository ? { repository: descriptor.repository } : {}),
      ...(descriptor.contextManifest ? { contextManifest: descriptor.contextManifest } : {}),
      ...(descriptor.target ? { target: descriptor.target } : {}),
      ...(descriptor.fileRef ? { fileRef: descriptor.fileRef } : {}),
      ...(descriptor.reviewPath ? { reviewPath: descriptor.reviewPath } : {}),
      ...(descriptor.diffReview ? { diffReview: descriptor.diffReview } : {}),
      ...(descriptor.forkedFrom ? { forkedFrom: descriptor.forkedFrom } : {}),
      ...(descriptor.preview ? { preview: descriptor.preview } : {}),
      updatedAt: descriptor.updatedAt,
      presentation: turn.presentation,
    })
  })
  return sessions
}

type AgentSessionStorage = Pick<Storage, "getItem"> & Partial<Pick<Storage, "removeItem">>

type LoadedAgentSessionCollection = Readonly<{
  state: AgentSessionCollectionState
  collection: DurableAgentSessionCollection | null
  key: string | null
}>

/** The single guarded, bounded read seam used for both current restore and inactive projection. */
function loadAgentSessionCollection(
  ownerScope: string,
  worldScope: string,
  options: Readonly<{ storage?: AgentSessionStorage; removeCorrupt?: boolean }> = {},
): LoadedAgentSessionCollection {
  let key: string
  let storage: AgentSessionStorage
  try {
    key = storageKey(ownerScope, worldScope)
    storage = options.storage ?? window.localStorage
  } catch {
    return { state: "unavailable", collection: null, key: null }
  }
  let stored: string | null
  try { stored = storage.getItem(key) } catch { return { state: "unavailable", collection: null, key } }
  if (stored === null) return { state: "missing", collection: { schemaVersion: 3, selectedSessionKey: null, sessions: [] }, key }
  const corrupt = (): LoadedAgentSessionCollection => {
    if (options.removeCorrupt) {
      try { storage.removeItem?.(key) } catch { /* cleanup failure cannot escape the guarded read seam */ }
    }
    return { state: "corrupt", collection: null, key }
  }
  if (stored.length === 0) return corrupt()
  if (stored.length > MAX_COLLECTION_BYTES
    || new TextEncoder().encode(stored).byteLength > MAX_COLLECTION_BYTES) {
    return { state: "oversized", collection: null, key }
  }
  const parsed = parseCollection(stored)
  if (!parsed) return corrupt()
  return { state: parsed.partial ? "partial" : "available", collection: parsed.collection, key }
}

/** Read a different owned Space's browser-scoped resume hints without mutating or verifying them. */
export function loadSavedAgentSessionProjection(
  ownerScope: string,
  worldScope: string,
  storage?: AgentSessionStorage,
): SavedAgentSessionProjection {
  const loaded = loadAgentSessionCollection(ownerScope, worldScope, { storage })
  return {
    state: loaded.state,
    sessions: loaded.collection ? projectSessions(null, loaded.collection.sessions, [], []) : [],
  }
}

/** Produce bounded Mission Control copy. Current live truth wins any duplicate saved hint. */
export function projectMissionAgentSessions(
  sessions: readonly ExperienceAgentSession[],
  current: boolean,
): readonly MissionAgentSessionProjection[] {
  const projected = new Map<string, MissionAgentSessionProjection>()
  for (const session of sessions) {
    const truth = current ? session.truth : "resume-unverified"
    const candidate: MissionAgentSessionProjection = {
      id: session.id,
      name: session.providerLabel,
      role: session.role,
      activity: agentPresentationText(current ? session.presentation : null)
        ?? agentPresentationText(session.assignment)
        ?? "Bounded assignment",
      state: truth === "resume-unverified" ? "waiting" : missionAgentState(session.status),
      truth,
    }
    const existing = projected.get(session.id)
    const rank = (value: MissionAgentSessionProjection["truth"]) => value === "live" ? 2 : value === "persisted" ? 1 : 0
    if (!existing || rank(candidate.truth) > rank(existing.truth)) projected.set(session.id, candidate)
  }
  return [...projected.values()]
}

function missionAgentState(status: string): MissionAgentSessionProjection["state"] {
  if (status === "blocked") return "blocked"
  if (status === "working" || status === "thinking" || ACTIVE_WORLD_EXECUTION_STATES.has(status)) {
    return "working"
  }
  return "idle"
}

export function useExperienceAgentSessions({
  ownerScope,
  worldScope,
  worldId,
  projectKey,
  executionSession,
  autoContinue = false,
  onAutoContinuation,
}: {
  ownerScope: string
  worldScope: string
  worldId: string | null
  projectKey: CanonicalWorkspaceProjectKey | null
  executionSession: ProjectedWorldWorkerSession | null
  autoContinue?: boolean
  onAutoContinuation?: RunAgentTurnInput["onContinuation"]
}): ProviderNeutralAgentSessionController {
  const [savedSessions, setSavedSessions] = useState<readonly DurableAgentSession[]>([])
  const [collectionState, setCollectionState] = useState<AgentSessionCollectionState>("missing")
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [verifiedSessions, setVerifiedSessions] = useState<readonly DurableAgentSession[]>([])
  const [durableSession, setDurableSession] = useState<DurableAgentSession | null>(null)
  const [activeTurns, setActiveTurns] = useState<readonly ActiveAgentTurn[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loadedStorageKey, setLoadedStorageKey] = useState<string | null>(null)
  const sessionsRef = useRef<readonly DurableAgentSession[]>([])
  const selectedSessionKeyRef = useRef<string | null>(null)
  const verifiedSessionsRef = useRef<readonly DurableAgentSession[]>([])
  const operationEpoch = useRef(0)
  const selectionGenerationRef = useRef(0)
  const operationsRef = useRef(new Map<number, ActiveAgentOperation>())
  const autoContinuationAttemptRef = useRef<string | null>(null)

  const persistCanonicalCollection = useCallback((write: () => DurableAgentSessionCollection) => {
    try {
      const persisted = write()
      setCollectionState("available")
      return persisted
    } catch (cause) {
      setCollectionState((current) => current === "partial" ? "partial" : "unavailable")
      throw cause
    }
  }, [])

  const syncActiveTurns = useCallback(() => {
    setActiveTurns([...operationsRef.current.values()].map((operation) => ({
      id: operation.acceptedKey ?? `starting-${operation.provider.toLowerCase()}-${operation.epoch}`,
      provider: operation.provider,
      role: operation.role,
      sessionId: operation.accepted?.sessionId ?? null,
      presentation: operation.presentation,
      descriptor: operation.accepted,
    })))
  }, [])

  const repairInvalidatedSelection = useCallback((operation: ActiveAgentOperation) => {
    const invalidatedKey = operation.acceptedKey
    if (!invalidatedKey || selectedSessionKeyRef.current !== invalidatedKey) return
    const exactDurable = sessionsRef.current.find((session) => sessionKey(session.provider, session.sessionId) === invalidatedKey) ?? null
    const fallbackKey = exactDurable ? invalidatedKey : operation.selectionFallbackKey
    const fallback = fallbackKey
      ? sessionsRef.current.find((session) => sessionKey(session.provider, session.sessionId) === fallbackKey) ?? null
      : null
    const nextSelectedKey = fallback ? sessionKey(fallback.provider, fallback.sessionId) : null
    try {
      const persisted = persistCanonicalCollection(() => persistCollection(operation.storageKey, sessionsRef.current, nextSelectedKey))
      sessionsRef.current = persisted.sessions
      setSavedSessions(persisted.sessions)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED")
    }
    selectionGenerationRef.current += 1
    selectedSessionKeyRef.current = nextSelectedKey
    setSelectedSessionKey(nextSelectedKey)
    const verifiedFallback = fallback && verifiedSessionsRef.current.some((session) => sessionKey(session.provider, session.sessionId) === nextSelectedKey)
      ? fallback
      : null
    setDurableSession(verifiedFallback)
  }, [persistCanonicalCollection])

  const invalidateOperation = useCallback((operation: ActiveAgentOperation) => {
    if (operationsRef.current.get(operation.epoch) !== operation) return
    // Invalidation is deliberately first. A cancel/read/finally continuation from this operation
    // can no longer mutate the state or persistence owned by the next turn.
    operationsRef.current.delete(operation.epoch)
    repairInvalidatedSelection(operation)
    void operation.reader?.cancel()
    operation.abort.abort()
    syncActiveTurns()
  }, [repairInvalidatedSelection, syncActiveTurns])

  const invalidateAllOperations = useCallback(() => {
    const operations = [...operationsRef.current.values()]
    operationsRef.current.clear()
    operations.forEach((operation) => {
      void operation.reader?.cancel()
      operation.abort.abort()
    })
    syncActiveTurns()
  }, [syncActiveTurns])

  useEffect(() => {
    // A turn is owned by the exact authenticated owner/workspace scope in which it began. Never let
    // a late frame from that scope materialize a ready session after the shell has moved elsewhere.
    invalidateAllOperations()
    const loaded = loadAgentSessionCollection(ownerScope, worldScope, { removeCorrupt: true })
    const key = loaded.key ?? storageKey(ownerScope, worldScope)
    const collection = loaded.collection
    setCollectionState(loaded.state)
    if (!collection) {
      sessionsRef.current = []
      selectedSessionKeyRef.current = null
      setSavedSessions([])
      setSelectedSessionKey(null)
    } else if (loaded.state === "partial") {
      sessionsRef.current = collection.sessions
      selectedSessionKeyRef.current = collection.selectedSessionKey
      setSavedSessions(collection.sessions)
      setSelectedSessionKey(collection.selectedSessionKey)
    } else if (loaded.state === "missing") {
      sessionsRef.current = []
      selectedSessionKeyRef.current = null
      setSavedSessions([])
      setSelectedSessionKey(null)
    } else {
      try {
        const persisted = persistCanonicalCollection(() => persistCollection(key, collection.sessions, collection.selectedSessionKey))
        sessionsRef.current = persisted.sessions
        selectedSessionKeyRef.current = persisted.selectedSessionKey
        setSavedSessions(persisted.sessions)
        setSelectedSessionKey(persisted.selectedSessionKey)
      } catch (cause) {
        sessionsRef.current = []
        selectedSessionKeyRef.current = null
        setSavedSessions([])
        setSelectedSessionKey(null)
        setCollectionState("unavailable")
        setError(cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED")
      }
    }
    // Browser storage is only a resume hint. The server authenticates ownership and existence when
    // a turn actually resumes; until that turn succeeds, this must not enter the live projection.
    verifiedSessionsRef.current = []
    setVerifiedSessions([])
    setDurableSession(null)
    setLoadedStorageKey(key)
  }, [invalidateAllOperations, ownerScope, persistCanonicalCollection, projectKey, worldScope])

  useEffect(() => () => {
    const operations = [...operationsRef.current.values()]
    operationsRef.current.clear()
    operations.forEach((operation) => {
      void operation.reader?.cancel()
      operation.abort.abort()
    })
  }, [])

  const stop = useCallback((sessionId?: string) => {
    const operations = [...operationsRef.current.values()]
    const operation = sessionId
      ? operations.find((candidate) => candidate.acceptedKey === sessionId
        || `starting-${candidate.provider.toLowerCase()}-${candidate.epoch}` === sessionId)
      : operations.length === 1 ? operations[0] : null
    if (operation) invalidateOperation(operation)
  }, [invalidateOperation])

  const selectSession = useCallback((selectedKey: string | null) => {
    const sessions = sessionsRef.current
    const selected = selectedKey === null ? null : sessions.find((session) => sessionKey(session.provider, session.sessionId) === selectedKey)
    if (selectedKey !== null && !selected) {
      const active = [...operationsRef.current.values()].find((operation) => operation.acceptedKey === selectedKey)
      if (!active?.accepted) return false
      active.selectionFallbackKey = selectedSessionKeyRef.current
      selectionGenerationRef.current += 1
      selectedSessionKeyRef.current = selectedKey
      setSelectedSessionKey(selectedKey)
      setDurableSession(active.accepted)
      return true
    }
    const key = storageKey(ownerScope, worldScope)
    const nextKey = selected ? sessionKey(selected.provider, selected.sessionId) : null
    let persisted: DurableAgentSessionCollection
    try {
      persisted = persistCanonicalCollection(() => persistCollection(key, sessions, nextKey))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED")
      return false
    }
    sessionsRef.current = persisted.sessions
    selectionGenerationRef.current += 1
    selectedSessionKeyRef.current = persisted.selectedSessionKey
    setSavedSessions(persisted.sessions)
    setSelectedSessionKey(persisted.selectedSessionKey)
    setDurableSession(selected && verifiedSessionsRef.current.some((session) => sessionKey(session.provider, session.sessionId) === nextKey) ? selected : null)
    return true
  }, [ownerScope, persistCanonicalCollection, worldScope])

  const executeTurn = useCallback(async (input: Omit<RunClaudeTurnInput, "mode"> & {
    provider: AgentProvider
    mode?: "delegate" | "review" | "diff-review" | "fork" | "preview"
    sourceSessionId?: string
    exactContinuation?: boolean
    automatic?: boolean
    onContinuation?: (continuation: Readonly<{ status: string; selectedPath?: string; task?: string; repositoryKey?: string }>) => void | Promise<void>
  }) => {
    if (projectKey !== "williamos" && projectKey !== "terrafusion") {
      throw new Error("AGENT_PROJECT_REQUIRED")
    }
    if (input.provider !== "Codex" && input.provider !== "Claude" && input.provider !== "Local") {
      throw new Error("AGENT_PROVIDER_INVALID")
    }
    const role = input.provider === "Local" ? "Thinker" : boundedText(input.role, 80)
    const assignment = input.provider === "Local" ? "Conversation" : boundedText(input.assignment, 500)
    const prompt = boundedText(input.prompt, 20_000)
    const mode = input.mode ?? "delegate"
    const forkMode = mode === "fork"
    const previewMode = mode === "preview"
    const diffReviewMode = mode === "diff-review"
    const reviewPath = boundedText(input.path, 1_000)
    const reviewWorldId = boundedText(input.worldId, 200)
    const candidateDiffFingerprint = boundedText(input.expectedDiffFingerprint, 16_384)
    const expectedDiffFingerprint = candidateDiffFingerprint && new TextEncoder().encode(candidateDiffFingerprint).byteLength <= 16_384
      ? candidateDiffFingerprint : null
    const requestedTarget = input.target === undefined ? null : parseFileTarget(input.target)
    let requestedFileRef: WorkspaceFileRef | null = null
    try { requestedFileRef = input.fileRef === undefined ? null : parseWorkspaceFileRef(input.fileRef) } catch {
      throw new Error("AGENT_REVIEW_INPUT_INVALID")
    }
    const requestedRepository = input.repositoryKey === undefined
      ? null
      : resolveWorkspaceRepositorySelection(projectKey, input.repositoryKey)
    if (requestedRepository && !requestedRepository.ok) throw new Error("AGENT_REPOSITORY_SCOPE_INVALID")
    const requestedRepositoryKey = requestedRepository?.ok ? requestedRepository.repository.key : null
    const expectedFileAuthority = input.expectedFileAuthority === undefined
      ? null : parseFileAuthorityProof(input.expectedFileAuthority)
    const focus = input.focus === undefined || input.focus === "" ? null : boundedText(input.focus, 2_000)
    const requiredSessionKey = input.requiredSessionKey === undefined ? null : boundedText(input.requiredSessionKey, 200)
    if (!role) throw new Error("AGENT_ROLE_REQUIRED")
    if (!assignment) throw new Error("AGENT_ASSIGNMENT_REQUIRED")
    if ((mode === "delegate" || forkMode) && !prompt) throw new Error("AGENT_PROMPT_REQUIRED")
    if (input.target !== undefined && (!requestedTarget || mode !== "delegate" || role !== "Builder"
      || input.provider !== "Codex" && input.provider !== "Claude")) throw new Error("AGENT_TARGET_INVALID")
    if (input.expectedFileAuthority !== undefined && (!expectedFileAuthority || !requestedTarget
      || expectedFileAuthority.worldId !== worldId || expectedFileAuthority.selectedPath !== requestedTarget.path
      || expectedFileAuthority.actor !== input.provider.toLowerCase())) throw new Error("AGENT_TARGET_INVALID")
    if (input.provider === "Claude" && requestedTarget && !expectedFileAuthority) throw new Error("AGENT_TARGET_INVALID")
    if (input.provider !== "Claude" && input.expectedFileAuthority !== undefined) throw new Error("AGENT_TARGET_INVALID")
    if ((mode === "review" || diffReviewMode) && (!reviewPath || !requestedFileRef
      || requestedFileRef.path !== reviewPath || !requestedRepositoryKey
      || requestedFileRef.repositoryResourceKey !== requestedRepositoryKey
      || input.focus !== undefined && input.focus !== "" && !focus)) throw new Error("AGENT_REVIEW_INPUT_INVALID")
    if (mode !== "review" && !diffReviewMode && input.fileRef !== undefined) throw new Error("AGENT_REVIEW_INPUT_INVALID")
    if (diffReviewMode && (!reviewWorldId || reviewWorldId !== worldId || !expectedDiffFingerprint)) throw new Error("AGENT_DIFF_REVIEW_INPUT_INVALID")
    if ((mode === "review" || diffReviewMode) && input.provider !== "Claude") throw new Error("AGENT_REVIEW_PROVIDER_INVALID")
    if ((mode === "review" || diffReviewMode) && role !== "Reviewer") throw new Error("AGENT_REVIEW_ROLE_INVALID")
    const requiredId = requiredSessionKey?.slice(`${input.provider}:`.length) ?? null
    const requiredKeyValid = Boolean(requiredSessionKey?.startsWith(`${input.provider}:`)
      && validSessionId(input.provider, requiredId))
    if (input.requiredSessionKey !== undefined && (!requiredSessionKey || !requiredKeyValid)) {
      throw new Error(input.exactContinuation ? "AGENT_CONTINUE_SESSION_UNAVAILABLE" : "AGENT_REVIEW_SESSION_MISMATCH")
    }
    if (input.exactContinuation && !requiredSessionKey) throw new Error("AGENT_CONTINUE_SESSION_UNAVAILABLE")
    if (requiredSessionKey && !input.exactContinuation && mode !== "review" && !diffReviewMode) throw new Error("AGENT_REVIEW_SESSION_MISMATCH")
    if (previewMode && (input.provider !== "Claude" || role !== "Preview debugger")) throw new Error("AGENT_PREVIEW_PROVIDER_INVALID")

    const operationStorageKey = storageKey(ownerScope, worldScope)
    const storedPrior = sessionsRef.current.find((session) => sessionKey(session.provider, session.sessionId) === selectedSessionKeyRef.current) ?? null
    const requiredPrior = requiredSessionKey
      ? sessionsRef.current.find((session) => sessionKey(session.provider, session.sessionId) === requiredSessionKey) ?? null
      : null
    if (requiredSessionKey && (!requiredPrior || loadedStorageKey !== operationStorageKey)) {
      throw new Error(input.exactContinuation ? "AGENT_CONTINUE_SESSION_UNAVAILABLE" : "AGENT_REVIEW_PRIOR_REQUIRED")
    }
    const continuationMetadataMismatch = input.exactContinuation && requiredPrior && (
      requiredPrior.provider !== input.provider
      || requiredPrior.role !== role
      || requiredPrior.assignment !== assignment
      || (mode === "review" || diffReviewMode ? requiredPrior.reviewPath !== reviewPath : Boolean(requiredPrior.reviewPath))
      || (diffReviewMode ? requiredPrior.diffReview?.worldId !== reviewWorldId
        || requiredPrior.diffReview?.fingerprint !== expectedDiffFingerprint : Boolean(requiredPrior.diffReview))
      || (previewMode ? requiredPrior.preview?.worldId !== worldId : Boolean(requiredPrior.preview))
      || (requestedTarget ? requiredPrior.target?.path !== requestedTarget.path : Boolean(requiredPrior.target))
      || (requestedFileRef ? JSON.stringify(requiredPrior.fileRef) !== JSON.stringify(requestedFileRef) : Boolean(requiredPrior.fileRef))
    )
    if (requiredSessionKey && (selectedSessionKeyRef.current !== requiredSessionKey
      || continuationMetadataMismatch
      || !input.exactContinuation && (
        requiredPrior?.provider !== "Claude"
        || requiredPrior.role !== "Reviewer"
        || requiredPrior.reviewPath !== reviewPath
        || requiredPrior.assignment !== assignment))) {
      throw new Error(input.exactContinuation ? "AGENT_CONTINUE_SESSION_UNAVAILABLE" : "AGENT_REVIEW_SESSION_MISMATCH")
    }
    if (previewMode && storedPrior?.preview && storedPrior.preview.worldId !== worldId) {
      throw new Error("AGENT_PREVIEW_SESSION_SCOPE_MISMATCH")
    }
    const forkSource = forkMode && input.provider === "Claude" && role === "Builder" && validSessionId("Claude", input.sourceSessionId)
      && storedPrior?.provider === "Claude" && storedPrior.role === "Builder" && !storedPrior.reviewPath
      && storedPrior.sessionId === input.sourceSessionId
      && verifiedSessionsRef.current.some((session) => sessionKey(session.provider, session.sessionId) === sessionKey(storedPrior.provider, storedPrior.sessionId))
      ? storedPrior : null
    if (forkMode && !forkSource) throw new Error("AGENT_FORK_UNAVAILABLE")
    const prior = input.automatic ? null : input.exactContinuation ? requiredPrior : forkMode ? null : mode === "review"
      ? requiredPrior ?? (storedPrior?.provider === "Claude" && storedPrior.role === "Reviewer" && storedPrior.reviewPath === reviewPath ? storedPrior : null)
      : diffReviewMode
        ? requiredPrior ?? (storedPrior?.provider === "Claude" && storedPrior.role === "Reviewer"
          && storedPrior.reviewPath === reviewPath && storedPrior.diffReview?.worldId === reviewWorldId
          && storedPrior.diffReview?.fingerprint === expectedDiffFingerprint ? storedPrior : null)
      : previewMode
        ? storedPrior?.provider === "Claude" && storedPrior.role === "Preview debugger" && storedPrior.preview?.worldId === worldId ? storedPrior : null
      : storedPrior?.provider === input.provider && !storedPrior.reviewPath
        && !storedPrior.preview
        && storedPrior.role === role && storedPrior.assignment === assignment ? storedPrior : null
    const repositoryBoundPrior = prior ?? forkSource
    if (repositoryBoundPrior && input.repositoryKey !== undefined
      && repositoryBoundPrior.repository?.resourceKey !== requestedRepositoryKey) {
      throw new Error("AGENT_REPOSITORY_SCOPE_MISMATCH")
    }
    const effectiveRepositoryKey = repositoryBoundPrior?.repository?.resourceKey ?? requestedRepositoryKey
    if ((mode === "review" || diffReviewMode) && effectiveRepositoryKey !== requestedFileRef!.repositoryResourceKey) {
      throw new Error("AGENT_REPOSITORY_SCOPE_MISMATCH")
    }
    const writerTarget = requestedTarget?.path ?? repositoryBoundPrior?.target?.path ?? "server-selected"
    const lane: ActiveAgentOperation["lane"] = (input.provider === "Codex" || input.provider === "Claude")
      && role === "Builder" && (mode === "delegate" || forkMode)
      ? `writer:${effectiveRepositoryKey ?? "primary"}:${writerTarget}`
      : input.provider === "Claude" && role === "Reviewer" && (mode === "review" || diffReviewMode) ? "reviewer"
        : previewMode ? "reviewer"
        : input.provider === "Local" && mode === "delegate" ? "thinker" : null
    const running = [...operationsRef.current.values()]
    const priorKey = prior ? sessionKey(prior.provider, prior.sessionId) : null
    if (priorKey && running.some((candidate) => candidate.acceptedKey === priorKey
      || candidate.prior && sessionKey(candidate.prior.provider, candidate.prior.sessionId) === priorKey)) {
      throw new Error("AGENT_SESSION_ALREADY_RUNNING")
    }
    if (running.length > 0 && (!lane || running.some((candidate) => !candidate.lane || candidate.lane === lane))) {
      throw new Error("AGENT_TURN_ALREADY_RUNNING")
    }
    const operation: ActiveAgentOperation = {
      epoch: operationEpoch.current + 1,
      abort: new AbortController(),
      reader: null,
      storageKey: operationStorageKey,
      prior,
      priorVerified: Boolean(prior && verifiedSessionsRef.current.some((session) => sessionKey(session.provider, session.sessionId) === sessionKey(prior.provider, prior.sessionId))),
      priorCollection: sessionsRef.current,
      priorSelectedSessionKey: selectedSessionKeyRef.current,
      provider: input.provider,
      role,
      mode,
      lane,
      accepted: null,
      acceptedKey: null,
      presentation: "Agent is starting.",
      selectionGeneration: selectionGenerationRef.current,
      selectionFallbackKey: selectedSessionKeyRef.current,
    }
    operationEpoch.current = operation.epoch
    operationsRef.current.set(operation.epoch, operation)
    syncActiveTurns()
    const isCurrent = () => operationsRef.current.get(operation.epoch) === operation
    if (running.length === 0) setError(null)
    let accepted: DurableAgentSession | null = null
    const finalOutcome: { seen: boolean; code: unknown; reason: unknown } = {
      seen: false,
      code: undefined,
      reason: undefined,
    }
    const present = (phase: AgentTurnPresentation["phase"], text: string, sessionId: string) => {
      if (mode !== "delegate" && mode !== "preview" || !isCurrent()) return
      const safeText = phase === "working" ? "Agent is working." : agentPresentationText(text)
      if (!safeText && phase !== "complete") return
      operation.presentation = safeText ?? "Agent completed."
      syncActiveTurns()
      try {
        input.onPresentation?.({
          phase,
          text: safeText ?? "Agent completed.",
          provider: input.provider,
          sessionId,
        })
      } catch { /* presentation cannot affect transport or persistence truth */ }
    }

    try {
      if ((input.provider === "Codex" || input.provider === "Claude" && mode !== "review")
        && !boundedText(worldId, 200)) throw new Error("AGENT_SPACE_REQUIRED")
      const response = await fetch(input.provider === "Codex" ? "/api/loom/codex" : "/api/loom/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(diffReviewMode ? {
          mode: "diff-review",
          projectKey,
          worldId: reviewWorldId,
          path: reviewPath,
          fileRef: requestedFileRef,
          expectedDiffFingerprint,
          ...(focus ? { focus } : {}),
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : mode === "review" ? {
          mode: "review",
          projectKey,
          path: reviewPath,
          fileRef: requestedFileRef,
          ...(focus ? { focus } : {}),
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : previewMode ? {
          mode: "preview",
          projectKey,
          worldId,
          prompt,
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : forkMode ? {
          mode: "fork",
          projectKey,
          worldId,
          provider: "cloud",
          sourceSessionId: forkSource!.sessionId,
          prompt,
        } : input.provider === "Codex" ? input.automatic ? {
          worldId,
          projectKey,
          automatic: true,
          sessionId: null,
          resume: false,
        } : {
          worldId,
          projectKey,
          prompt,
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        } : input.provider === "Local" ? {
          worldId,
          projectKey,
          prompt,
          provider: "local",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
          completedTurns: prior?.completedTurns ?? [],
        } : {
          worldId,
          projectKey,
          prompt,
          provider: "cloud",
          sessionId: prior?.sessionId ?? null,
          resume: prior !== null,
        }), ...(effectiveRepositoryKey ? { repositoryKey: effectiveRepositoryKey } : {}) }),
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
      let targetBindingInvalid = false
      let continuationSeen = false
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
          const localTruth = input.provider !== "Local"
            || event.provider === "Local" && (event.mode === undefined || event.mode === "delegate")
              && event.continuity === (prior ? "browser-replayed" : "new")
          const unexpectedReuse = !prior && typeof event.sessionId === "string"
            && sessionsRef.current.some((session) => session.provider === input.provider && session.sessionId === event.sessionId)
          const forkTruth = !forkMode || event.forkedFrom === forkSource?.sessionId
          const resumeForkedFrom = !forkMode && input.provider === "Claude" && prior && event.forkedFrom !== undefined
            && event.provider === "Claude" && event.mode === "delegate"
            && typeof event.forkedFrom === "string" && CLAUDE_SESSION_ID.test(event.forkedFrom)
            && event.forkedFrom !== event.sessionId ? event.forkedFrom : null
          const invalidResumeForkLineage = !forkMode && event.forkedFrom !== undefined && !resumeForkedFrom
          const capturedTarget = requestedTarget ?? prior?.target ?? null
          const serverSelectedPath = capturedTarget
            ? canonicalWorkspaceFilePath(event.selectedPath)
            : null
          const serverAssignmentHash = input.provider === "Codex" && capturedTarget && typeof event.assignmentHash === "string"
            && ASSIGNMENT_HASH.test(event.assignmentHash) ? event.assignmentHash : null
          const claudeAuthorityBindingMatches = input.provider !== "Claude" || !capturedTarget
            || Boolean(expectedFileAuthority
              && event.provider === "Claude" && event.mode === "delegate"
              && event.worldId === expectedFileAuthority.worldId
              && event.worldRevision === expectedFileAuthority.worldRevision
              && event.outcomeKey === expectedFileAuthority.outcomeKey
              && event.workOrderId === expectedFileAuthority.workOrderId
              && event.grantId === expectedFileAuthority.grantId
              && event.actor === expectedFileAuthority.actor
              && serverSelectedPath === expectedFileAuthority.selectedPath)
          const invalidTargetBinding = Boolean(capturedTarget && (
            serverSelectedPath !== capturedTarget.path
            || input.provider === "Codex" && !serverAssignmentHash
            || input.provider === "Claude" && !claudeAuthorityBindingMatches
          ))
          const repositoryValues = [
            event.repositoryResourceKey,
            event.repositoryIdentity,
            event.repositoryMountKey,
            event.observedRevision,
          ]
          const repositoryFramePresent = repositoryValues.some((value) => value !== undefined && value !== null)
          const repository = repositoryFramePresent ? parseSessionRepository({
            resourceKey: event.repositoryResourceKey,
            identity: event.repositoryIdentity,
            mountKey: event.repositoryMountKey,
            observedRevision: event.observedRevision,
          }) : null
          const repositoryBindingInvalid = repositoryFramePresent && !repository
            || Boolean(prior?.repository && JSON.stringify(prior.repository) !== JSON.stringify(repository))
            || Boolean(effectiveRepositoryKey && repository?.resourceKey !== effectiveRepositoryKey)
          const contextManifest = event.contextManifest === undefined ? undefined
            : parseAssignmentContextManifestView(event.contextManifest)
          const serverAssignmentId = event.assignmentId === undefined
            ? event.sessionId as string
            : boundedText(event.assignmentId, 300)
          const contextManifestInvalid = event.contextManifest !== undefined && !contextManifest
            || event.assignmentId !== undefined && !serverAssignmentId
            || Boolean(contextManifest && (!repository || !capturedTarget
              || contextManifest.assignment.assignmentId !== serverAssignmentId
              || contextManifest.assignment.worldId !== worldId
              || contextManifest.targetRepository.repositoryKey !== repository.resourceKey
              || contextManifest.targetRepository.repositoryIdentity !== repository.identity
              || contextManifest.checkout.repositoryMountKey !== repository.mountKey
              || contextManifest.checkout.baseRevision !== repository.observedRevision
              || !contextManifest.mutationPosture.target.writablePaths.includes(capturedTarget.path)))
          const previewWorldId = previewMode ? boundedText(event.worldId, 200) : null
          const previewFingerprint = previewMode && typeof event.evidenceFingerprint === "string" && ASSIGNMENT_HASH.test(event.evidenceFingerprint)
            ? event.evidenceFingerprint : null
          const invalidPreviewBinding = previewMode && (event.provider !== "Claude" || event.mode !== "preview"
            || previewWorldId !== worldId || !previewFingerprint
            || input.exactContinuation && previewFingerprint !== prior?.preview?.evidenceFingerprint)
          const diffReviewBinding = diffReviewMode ? parseDiffReview({
            worldId: event.worldId,
            path: event.path,
            fingerprint: event.fingerprint,
            baseHash: event.baseHash,
            indexHash: event.indexHash,
            patchHash: event.patchHash,
            completedAt: event.completedAt,
          }) : null
          const invalidDiffReviewBinding = diffReviewMode && (!diffReviewBinding
            || event.provider !== "Claude" || event.mode !== "diff-review"
            || diffReviewBinding.worldId !== reviewWorldId || diffReviewBinding.path !== reviewPath
            || diffReviewBinding.fingerprint !== expectedDiffFingerprint
            || input.exactContinuation && (
              diffReviewBinding.baseHash !== prior?.diffReview?.baseHash
              || diffReviewBinding.indexHash !== prior?.diffReview?.indexHash
              || diffReviewBinding.patchHash !== prior?.diffReview?.patchHash
            ))
          if (!sessionIdValid || typeof event.resumed !== "boolean" || event.resumed !== expectedResumed
            || !matchesResumeId || unexpectedReuse || sessionSeen || canonicalResultSeen || !codexTruth || !claudeTruth || !localTruth
            || !forkTruth || invalidResumeForkLineage || invalidTargetBinding || repositoryBindingInvalid || contextManifestInvalid || invalidPreviewBinding || invalidDiffReviewBinding) {
            if (invalidTargetBinding) targetBindingInvalid = true
            malformed = true
            return
          }
          sessionSeen = true
          accepted = {
            schemaVersion: 1,
            sessionId: event.sessionId as string,
            ...(contextManifest ? { assignmentId: serverAssignmentId! } : {}),
            role,
            provider: input.provider,
            assignment,
            ...(repository ? { repository } : {}),
            ...(contextManifest ? { contextManifest } : {}),
            ...(capturedTarget ? { target: { kind: "file" as const, path: serverSelectedPath! } } : {}),
            ...(requestedFileRef ? { fileRef: requestedFileRef } : {}),
            ...(mode === "review" || diffReviewMode ? { reviewPath: reviewPath! } : {}),
            ...(diffReviewBinding ? { diffReview: diffReviewBinding } : {}),
            ...(forkMode ? { forkedFrom: forkSource!.sessionId } : {}),
            ...(resumeForkedFrom ? { forkedFrom: resumeForkedFrom } : {}),
            ...(previewMode ? { preview: { worldId: previewWorldId!, evidenceFingerprint: previewFingerprint! } } : {}),
            updatedAt: new Date().toISOString(),
          }
          if (isCurrent()) {
            const acceptedSessionKey = sessionKey(input.provider, event.sessionId as string)
            operation.accepted = accepted
            operation.acceptedKey = acceptedSessionKey
            operation.presentation = "Agent is working."
            syncActiveTurns()
            present("working", "Agent is working.", event.sessionId as string)
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
        if (input.provider === "Codex" && event.type === "continuation") {
          const status = boundedText(event.status, 100)
          if (!status || continuationSeen || canonicalResultSeen) { malformed = true; return }
          continuationSeen = true
          if (status === "NEXT_ASSIGNMENT") {
            const selectedPath = canonicalWorkspaceFilePath(event.selectedPath)
            const task = boundedText(event.task, 20_000)
            const repository = resolveWorkspaceRepositorySelection(projectKey, event.repositoryKey)
            if (!selectedPath || !task || !repository.ok) { malformed = true; return }
            input.onContinuation?.({ status, selectedPath, task, repositoryKey: repository.repository.key })
          } else if (["ASSIGNMENT_IN_FLIGHT", "WORK_ORDER_PATHS_COMPLETE", "SPACE_PERSISTENCE_BUSY", "CONTINUATION_BLOCKED"].includes(status)) {
            input.onContinuation?.({ status })
          } else {
            malformed = true
            return
          }
          if (isCurrent()) input.onEvent?.(event)
          return
        }
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
        if ((input.provider === "Codex" || input.provider === "Local") && event.type === "delta") {
          const validDelta = input.provider === "Local"
            ? boundedFragment(event.text, 20_000)
            : Boolean(boundedText(event.text, 20_000))
          if (!validDelta || canonicalResultSeen) malformed = true
          else if (isCurrent()) input.onEvent?.(event)
          return
        }
        if ((input.provider === "Codex" || input.provider === "Local") && event.type === "result") {
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
      if (invalid) throw targetBindingInvalid
        ? new AgentTargetBindingError()
        : new Error(mode === "review" || diffReviewMode ? "AGENT_REVIEW_STREAM_INVALID" : "AGENT_STREAM_INVALID")
      const reason = typeof finalOutcome.reason === "string" && finalOutcome.reason.trim()
        ? finalOutcome.reason.trim() : null
      if (reason || finalOutcome.code !== 0) {
        throw new Error(`AGENT_TURN_FAILED:${reason ?? `EXIT_${String(finalOutcome.code)}`}`)
      }
      const acceptedSession = accepted as DurableAgentSession | null
      if (!sessionSeen || !acceptedSession || !canonicalResultSeen || !resultText) throw new Error(mode === "review" || diffReviewMode ? "AGENT_REVIEW_STREAM_INVALID" : "AGENT_STREAM_INVALID")
      if (!isCurrent()) throw new DOMException("Aborted", "AbortError")
      const completedAt = new Date().toISOString()
      const settledSession: DurableAgentSession = {
        ...acceptedSession,
        updatedAt: completedAt,
        completedTurns: [...(prior?.completedTurns ?? []), {
          ownerPrompt: mode === "review" || diffReviewMode ? focus ?? `Review ${reviewPath}` : prompt!,
          finalResult: resultText,
          completedAt,
        }].slice(-MAX_COMPLETED_TURNS),
      }
      const settledKey = sessionKey(settledSession.provider, settledSession.sessionId)
      const sessionsWithSettlement = upsertSession(sessionsRef.current, settledSession)
      const runtimeSelectedKey = selectedSessionKeyRef.current
      const shouldSelectSettlement = selectionGenerationRef.current === operation.selectionGeneration
        || runtimeSelectedKey === settledKey
      const nextSelectedKey = shouldSelectSettlement ? settledKey : runtimeSelectedKey
      const persistedSelectedKey = sessionsWithSettlement.some((session) => sessionKey(session.provider, session.sessionId) === nextSelectedKey)
        ? nextSelectedKey
        : null
      let persisted: DurableAgentSessionCollection
      try {
        persisted = persistCanonicalCollection(() => forkMode
          ? persistForkCollection(operationStorageKey, sessionsRef.current, sessionKey(forkSource!.provider, forkSource!.sessionId), settledSession, persistedSelectedKey)
          : persistCollection(operationStorageKey, sessionsWithSettlement, persistedSelectedKey, { sessionKey: settledKey, completedAt }))
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "AGENT_SESSION_PERSISTENCE_FAILED"
        throw new AgentTurnCommittedPersistenceError(message)
      }
      sessionsRef.current = persisted.sessions
      selectedSessionKeyRef.current = nextSelectedKey
      setSavedSessions(persisted.sessions)
      setSelectedSessionKey(nextSelectedKey)
      const persistedSession = persisted.sessions.find((session) => sessionKey(session.provider, session.sessionId) === settledKey)!
      const nextVerified = upsertSession(verifiedSessionsRef.current, persistedSession)
      verifiedSessionsRef.current = nextVerified
      setVerifiedSessions(nextVerified)
      const selectedActive = [...operationsRef.current.values()].find((candidate) => candidate.acceptedKey === nextSelectedKey)?.accepted ?? null
      const selectedPersisted = persisted.sessions.find((session) => sessionKey(session.provider, session.sessionId) === nextSelectedKey) ?? null
      const selectedPersistedVerified = selectedPersisted && nextVerified.some((session) => sessionKey(session.provider, session.sessionId) === nextSelectedKey)
        ? selectedPersisted
        : null
      setDurableSession(selectedPersistedVerified ?? selectedActive)
      present("complete", persistedSession.completedTurns?.at(-1)?.finalResult ?? resultText, persistedSession.sessionId)
      if ((mode === "review" || diffReviewMode) && isCurrent()) input.onReviewComplete?.(resultText, persistedSession.diffReview)
      return persistedSession
    } catch (cause) {
      // A failed mutation-capable resume is no longer evidence that the saved descriptor exists or
      // belongs to this owner, so Delegate clears it. Read-only Review keeps its historical transcript
      // as an unverified resume hint; a refusal must not erase already-settled owner-visible review work.
      // A user cancellation is different: it does not disprove any already verified descriptor.
      const error = cause as Error
      if (!isCurrent()) throw cause
      if (error instanceof AgentTurnCommittedPersistenceError) {
        repairInvalidatedSelection(operation)
        setError(error.message)
        throw cause
      }
      const terminalResumeRefusal = prior !== null && (error instanceof AgentTargetBindingError || error instanceof AgentStartRefusal
        && (error.status === 401 || error.status === 403 || error.status === 404)
      )
      if (error?.name !== "AbortError" && terminalResumeRefusal && prior && mode !== "review" && !diffReviewMode && !input.exactContinuation) {
        const priorKey = sessionKey(prior.provider, prior.sessionId)
        const remaining = sessionsRef.current.filter((session) => sessionKey(session.provider, session.sessionId) !== priorKey)
        const remainingSelected = selectedSessionKeyRef.current === priorKey ? null : selectedSessionKeyRef.current
        const persisted = persistCanonicalCollection(() => persistCollection(operationStorageKey, remaining, remainingSelected))
        sessionsRef.current = persisted.sessions
        selectedSessionKeyRef.current = persisted.selectedSessionKey
        setSavedSessions(persisted.sessions)
        setSelectedSessionKey(persisted.selectedSessionKey)
        const remainingVerified = verifiedSessionsRef.current.filter((session) => sessionKey(session.provider, session.sessionId) !== priorKey)
        verifiedSessionsRef.current = remainingVerified
        setVerifiedSessions(remainingVerified)
        setDurableSession(null)
      } else if (prior) {
        if (error?.name !== "AbortError") {
          const priorKey = sessionKey(prior.provider, prior.sessionId)
          const remainingVerified = verifiedSessionsRef.current.filter((session) => sessionKey(session.provider, session.sessionId) !== priorKey)
          verifiedSessionsRef.current = remainingVerified
          setVerifiedSessions((current) => current.filter((session) => sessionKey(session.provider, session.sessionId) !== priorKey))
          setDurableSession(null)
        }
      }
      repairInvalidatedSelection(operation)
      if (error?.name !== "AbortError") setError(cause instanceof Error ? cause.message : "AGENT_UNAVAILABLE")
      throw cause
    } finally {
      if (isCurrent()) {
        operation.reader = null
        operationsRef.current.delete(operation.epoch)
        syncActiveTurns()
      }
    }
  }, [loadedStorageKey, ownerScope, persistCanonicalCollection, projectKey, repairInvalidatedSelection, syncActiveTurns, worldId, worldScope])

  const runAgentTurn = useCallback(async (input: RunAgentTurnInput) => {
    let current = input
    let completed: DurableAgentSession | null = null
    for (let transition = 0; transition < 64; transition += 1) {
      const transitionResult: { current: Readonly<{ status: string; selectedPath?: string; task?: string; repositoryKey?: string }> | null } = { current: null }
      completed = await executeTurn({
        ...current,
        mode: "delegate",
        onContinuation: (continuation) => { transitionResult.current = continuation },
      })
      const next = transitionResult.current
      if (next) {
        try {
          await input.onContinuation?.(next)
        } catch {
          setError("CODEX_CONTINUATION_UI_SYNC_FAILED")
          return completed
        }
      }
      if (!next || next.status !== "NEXT_ASSIGNMENT" || !next.selectedPath || !next.task || !next.repositoryKey) return completed
      current = {
        provider: "Codex",
        role: "Builder",
        assignment: next.selectedPath,
        prompt: next.task,
        target: { kind: "file", path: next.selectedPath },
        repositoryKey: next.repositoryKey,
        automatic: true,
        onEvent: input.onEvent,
        onPresentation: input.onPresentation,
        onContinuation: input.onContinuation,
      }
    }
    throw new Error("CODEX_CONTINUATION_LIMIT")
  }, [executeTurn])

  useEffect(() => {
    const exactStorageKey = storageKey(ownerScope, worldScope)
    if (!autoContinue || !worldId || projectKey !== "williamos" && projectKey !== "terrafusion" || loadedStorageKey !== exactStorageKey
      || operationsRef.current.size > 0) return
    const exactWorldId = worldId
    const attemptKey = `${exactStorageKey}:${exactWorldId}`
    if (autoContinuationAttemptRef.current === attemptKey) return
    autoContinuationAttemptRef.current = attemptKey
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    function retry(attempt: number) {
      retryTimer = setTimeout(() => { void read(attempt + 1) }, attempt * 250)
    }
    const settleReadFailure = (cause?: unknown) => {
      if (autoContinuationAttemptRef.current === attemptKey) autoContinuationAttemptRef.current = null
      setError(cause instanceof Error ? cause.message : "CODEX_CONTINUATION_UNAVAILABLE")
    }
    async function read(attempt: number): Promise<void> {
      let response: Response
      try {
        response = await fetch(`/api/loom/codex/continuation?worldId=${encodeURIComponent(exactWorldId)}&projectKey=${encodeURIComponent(projectKey ?? "")}`, { cache: "no-store" })
      } catch (cause) {
        if (cancelled) return
        if (attempt < 3) return retry(attempt)
        return settleReadFailure(cause)
      }
      if (cancelled) return
      if (!response.ok) {
        if (attempt < 3) return retry(attempt)
        return settleReadFailure()
      }
      let continuation: Record<string, unknown>
      try {
        continuation = await response.json() as Record<string, unknown>
      } catch (cause) {
        return settleReadFailure(cause)
      }
      if (cancelled || continuation.status !== "NEXT_ASSIGNMENT") return
      const selectedPath = canonicalWorkspaceFilePath(continuation.selectedPath)
      const task = boundedText(continuation.task, 20_000)
      const repository = resolveWorkspaceRepositorySelection(projectKey, continuation.repositoryKey)
      if (!selectedPath || !task || !repository.ok) return settleReadFailure()
      try {
        await runAgentTurn({
          provider: "Codex",
          role: "Builder",
          assignment: selectedPath,
          prompt: task,
          target: { kind: "file", path: selectedPath },
          repositoryKey: repository.repository.key,
          automatic: true,
          onContinuation: onAutoContinuation,
        })
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "CODEX_CONTINUATION_UNAVAILABLE")
      }
    }
    void read(1)
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      if (autoContinuationAttemptRef.current === attemptKey) autoContinuationAttemptRef.current = null
    }
  }, [autoContinue, loadedStorageKey, onAutoContinuation, ownerScope, projectKey, runAgentTurn, worldId, worldScope])
  const runClaudeTurn = useCallback((input: RunClaudeTurnInput) => executeTurn({ ...input, provider: "Claude" }), [executeTurn])
  const runPreviewDiagnostic = useCallback((input: RunPreviewDiagnosticInput) => executeTurn({
    ...input, provider: "Claude", role: "Preview debugger", assignment: "Developer Preview diagnosis", mode: "preview",
  }), [executeTurn])
  const forkClaudeSession = useCallback((input: ForkClaudeSessionInput) => executeTurn({
    ...input, provider: "Claude", role: "Builder", mode: "fork",
  }), [executeTurn])
  const continueSession = useCallback((input: ContinueAgentSessionInput) => {
    const exactKey = boundedText(input.sessionKey, 200)
    const operationStorageKey = storageKey(ownerScope, worldScope)
    const prior = exactKey && loadedStorageKey === operationStorageKey && selectedSessionKeyRef.current === exactKey
      ? sessionsRef.current.find((session) => sessionKey(session.provider, session.sessionId) === exactKey) ?? null
      : null
    if (!prior || !exactKey || prior.provider === "Claude" && prior.target) {
      return Promise.reject(new Error("AGENT_CONTINUE_SESSION_UNAVAILABLE"))
    }
    const mode = prior.preview ? "preview" as const : prior.diffReview ? "diff-review" as const : prior.reviewPath ? "review" as const : "delegate" as const
    return executeTurn({
      provider: prior.provider,
      role: prior.role,
      assignment: prior.assignment,
      prompt: mode === "review" || mode === "diff-review" ? undefined : input.prompt,
      focus: mode === "review" || mode === "diff-review" ? input.prompt : undefined,
      ...(mode === "diff-review" ? {
        worldId: prior.diffReview!.worldId,
        expectedDiffFingerprint: prior.diffReview!.fingerprint,
      } : {}),
      path: prior.reviewPath,
      fileRef: prior.fileRef,
      target: prior.target,
      repositoryKey: prior.repository?.resourceKey,
      mode,
      requiredSessionKey: exactKey,
      exactContinuation: true,
      onEvent: input.onEvent,
      onPresentation: input.onPresentation,
    })
  }, [executeTurn, loadedStorageKey, ownerScope, worldScope])

  const currentStorageKey = storageKey(ownerScope, worldScope)
  const scopeLoaded = loadedStorageKey === currentStorageKey
  const presentedCollectionState = scopeLoaded ? collectionState : "unavailable"
  const presentedSavedSessions = scopeLoaded ? savedSessions : []
  const presentedVerifiedSessions = scopeLoaded ? verifiedSessions : []
  const presentedActiveTurns = scopeLoaded ? activeTurns : []
  const presentedActiveSessionIds = presentedActiveTurns.map((turn) => turn.id)
  const presentedPausableSessionIds = presentedActiveTurns.filter((turn) => turn.sessionId !== null).map((turn) => turn.id)
  const sessions = useMemo(
    () => scopeLoaded ? projectSessions(executionSession, presentedSavedSessions, presentedVerifiedSessions, presentedActiveTurns) : [],
    [scopeLoaded, executionSession, presentedSavedSessions, presentedVerifiedSessions, presentedActiveTurns],
  )
  const presentedSelectedSessionKey = scopeLoaded ? selectedSessionKey : null
  const presentedDurableSession = scopeLoaded ? durableSession : null
  const savedDescriptor = presentedSavedSessions.find((session) => sessionKey(session.provider, session.sessionId) === presentedSelectedSessionKey) ?? null
  const descriptorState = presentedDurableSession ? "verified" : savedDescriptor ? "unverified" : "none"
  return {
    sessions,
    durableSession: presentedDurableSession,
    savedDescriptor,
    savedSessions: presentedSavedSessions,
    collectionState: presentedCollectionState,
    selectedSessionKey: presentedSelectedSessionKey,
    descriptorState,
    activeSessionId: presentedActiveSessionIds[0] ?? null,
    pausableSessionId: presentedPausableSessionIds[0] ?? null,
    activeSessionIds: presentedActiveSessionIds,
    pausableSessionIds: presentedPausableSessionIds,
    activeTurns: presentedActiveTurns,
    activeProvider: presentedActiveTurns[0]?.provider ?? null,
    error,
    runAgentTurn,
    runPreviewDiagnostic,
    runClaudeTurn,
    forkClaudeSession,
    continueSession,
    selectSession,
    stop,
  }
}

export function AgentSessionStrip({
  sessions,
  activeSessionId = null,
  runningSessionId = null,
  runningProvider = null,
  runningTurns = [],
  onStop,
  onSelect,
  className,
}: {
  sessions: readonly ExperienceAgentSession[]
  activeSessionId?: string | null
  runningSessionId?: string | null
  runningProvider?: AgentProvider | null
  runningTurns?: readonly ActiveAgentTurn[]
  onStop?: (sessionId?: string) => void
  onSelect?: (session: ExperienceAgentSession) => void
  className?: string
}) {
  if (sessions.length === 0 && !runningSessionId && runningTurns.length === 0) return null
  const identityGroups = new Map<string, ExperienceAgentSession[]>()
  for (const session of sessions) {
    const key = `${session.kind}\u0000${session.role}\u0000${session.providerLabel}\u0000${session.assignment}`
    identityGroups.set(key, [...(identityGroups.get(key) ?? []), session])
  }
  const duplicateLabels = new Map<ExperienceAgentSession, string>()
  for (const group of identityGroups.values()) {
    if (group.length < 2) continue
    const ordered = [...group].sort((left, right) => {
      const leftIdentity = `${left.updatedAt ?? ""}\u0000${left.id}`
      const rightIdentity = `${right.updatedAt ?? ""}\u0000${right.id}`
      return leftIdentity.localeCompare(rightIdentity)
    })
    ordered.forEach((session, index) => duplicateLabels.set(session, `${index + 1} of ${ordered.length}`))
  }
  const disambiguator = (session: ExperienceAgentSession): string | null => {
    const ordinal = duplicateLabels.get(session)
    if (!ordinal) return null
    if (session.updatedAt) {
      const parsed = new Date(session.updatedAt)
      if (!Number.isNaN(parsed.getTime())) {
        return `${parsed.toISOString().replace("T", " ").slice(0, 16)}Z · ${ordinal}`
      }
    }
    return `session ${ordinal}`
  }
  return (
    <nav
      className={className ?? "flex items-center justify-center gap-2"}
      aria-label="Durable agent sessions"
      tabIndex={0}
      style={{ display: "flex", maxWidth: "60vw", minWidth: 0, overflowX: "auto", flexWrap: "nowrap", justifyContent: "flex-start", scrollbarGutter: "stable" }}
    >
      {runningTurns.map((turn) => (
        <button
          key={`stop:${turn.id}`}
          type="button"
          aria-label={`Stop ${turn.provider} ${turn.role} turn`}
          onClick={() => onStop?.(turn.id)}
          className="rounded border border-[#8c4943] bg-[#261413] px-2 py-1 text-[10.5px] font-semibold text-[#f0c4bf]"
        >
          Stop
        </button>
      ))}
      {runningTurns.length === 0 && runningSessionId ? (
        <button
          type="button"
          aria-label={`Stop ${runningProvider ?? "agent"} turn`}
          onClick={() => onStop?.()}
          className="rounded border border-[#8c4943] bg-[#261413] px-2 py-1 text-[10.5px] font-semibold text-[#f0c4bf]"
        >
          Stop
        </button>
      ) : null}
      {sessions.map((session) => {
        const identityDisambiguator = disambiguator(session)
        const assignmentLabel = identityDisambiguator
          ? `${session.assignment} · ${identityDisambiguator}`
          : session.assignment
        return <button
          key={session.id}
          type="button"
          aria-pressed={activeSessionId === session.id}
          aria-label={session.kind === "durable-session"
            ? `${session.role} · ${session.providerLabel} · ${assignmentLabel}`
            : `${session.role} · ${session.providerLabel} · ${session.assignment} · ${session.status} · ${session.evidence}`}
          onClick={() => onSelect?.(session)}
          className="flex w-48 max-w-48 items-center gap-2 rounded border border-[#303a2f] bg-[#121712] px-2 py-1 text-left text-[#dce3d9]"
          style={{ flex: "0 0 auto" }}
        >
          <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border border-[#566653] text-[9px]">
            {session.role.slice(0, 1).toUpperCase()}
          </span>
          <span className="grid min-w-0 flex-1 gap-px">
            <strong data-agent-session-level="identity" className="truncate text-[10.5px]">
              {session.role} · {session.providerLabel}
            </strong>
            {session.assignment ? (
              <span
                data-agent-session-level="assignment"
                title={assignmentLabel}
                className="block truncate text-[9.5px] text-[#c7d0c3]"
              >
                {assignmentLabel}
              </span>
            ) : null}
            <small
              data-agent-session-level="truth"
              title={`${session.status} · ${session.evidence}`}
              className="truncate text-[9.5px] text-[#8f9a8c]"
            >
              {session.status} · {session.evidence}
            </small>
          </span>
        </button>
      })}
    </nav>
  )
}
