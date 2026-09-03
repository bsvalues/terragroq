"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { AppWindow, Braces, Command, FlaskConical, GitCompare, GitFork, GitPullRequest, Grid2X2, Layers3, TerminalSquare, Users, X } from "lucide-react"

import { isSummonedSurface, type SummonedSurface } from "@/lib/environment/summon"
import { EMPTY_SPINE, validateWilliamJudgment, type WilliamJudgment, type WorldSpine } from "@/lib/environment/working-world"
import { isExecutionLive } from "@/lib/environment/world-execution"
import type { ProjectedWorldWorkerSession } from "@/lib/environment/world-execution"
import { EditorSurface } from "./editor-surface"
import { DeveloperToolsSurface, type LiveDiffContext } from "./developer-tools-surface"
import { removeDiffBrowserSnapshot } from "./diff-snapshot-history"
import { ExternalWorkOrderAdmission } from "./external-work-order-admission"
import { loadToolRunHistory, removeToolRunHistory, type ToolRunTranscript } from "./tool-run-history"
import { type ChangeOperationScope, type ChangeRefreshResult, useSelectedFileChange } from "./use-selected-file-change"
import { useSelectedFileReview } from "./use-selected-file-review"
import { AgentSessionStrip, AgentTurnCommittedPersistenceError, agentPresentationText, loadSavedAgentSessionProjection, projectMissionAgentSessions, selectSpaceContinueCandidate, useExperienceAgentSessions, type AgentProvider, type AgentSessionCollectionState, type AgentSessionDiffReview, type AgentSessionRepository, type AgentTurnPresentation, type DurableAgentSession, type ExperienceAgentSession, type RunAgentTurnInput } from "./agent-sessions"
import { AgentTranscriptHistory } from "./agent-transcript-history"
import { BrainCouncilSurface, CouncilHistoryBrowser, type BrainCouncilSession, type CouncilAdvisoryAction } from "./brain-council-surface"
import { changeSetSurfaceModel } from "./change-set-projection"
import { ChangeSetSurface } from "./change-set-surface"
import { diffReviewInspectorBinding, diffReviewInspectorId, diffReviewInspectorIdentity, encodeDiffReviewInspectorPayload, InspectorSurfaceView, inspectorSurfaceWindowTitle, type InspectorSurface } from "./inspector-surface"
import { encodeExecutionAssignmentInspectorPayload, EXECUTION_ASSIGNMENT_INSPECTOR_KIND, executionAssignmentInspectorIdentity, parseExecutionAssignmentInspectorPayload } from "./execution-assignment-inspector"
import { agentSessionInspectorId, agentSessionInspectorIdFromIdentity, agentSessionInspectorIdentity, AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX, AGENT_SESSION_INSPECTOR_SURFACE_KIND, encodeAgentSessionInspectorPayload, isRestorableAgentSessionInspector, parseAgentSessionInspectorPayload } from "./agent-session-inspector"
import { MissionControlSurface, type MissionControlSpaceProjection } from "./mission-control-surface"
import { PreviewComposition, type PendingSuiteChange } from "./preview-composition"
import { RepositoryMapSurface, type RepositoryRelationship } from "./repository-map-surface"
import type { RepositoryShelfRepository } from "./repository-shelf"
import { deriveMissionControlOverview } from "./mission-control-overview"
import { WilliamConversationRail, type WilliamConversationEntry } from "./william-conversation-rail"
import { WindowFrame } from "./window-frame"
import { defaultSpace, nextSpaceRevision, normalizeSpace, parsePreviewInspectorPayload, qualifyLegacyWorkspaceFiles, spaceInViewport, spaceToServer, type PreviewInspectorPayload, type SpaceEnvelope, type SpaceSummary, type WilliamConversationTurn, type WindowGeometry, type WindowId, type WorkspaceProject, type WorkspaceSpace } from "./types"
import bridge from "./experience-token-bridge.module.css"
import spatial from "./experience-spatial.module.css"
import type { CrossRepositoryChangeSetProjection } from "@/lib/environment/cross-repository-change-set"
import type { WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"

type LineReply = Readonly<{
  worldId?: string
  say?: string
  surfaces?: readonly Omit<InspectorSurface, "id">[]
  dismiss?: "all" | string
  spine?: WorldSpine
}>

type PersistJob = Readonly<{ worldId: string; revision: number; body: string; storage: SpaceStorage; browserKey: string | null; epoch: number; keepalive: boolean }>
type SpaceStorage = "server" | "browser"
type EnvironmentOverlay = "council" | "mission-control" | "repository-map" | "change-set" | "preview-composition" | null
type CouncilView = "history" | "convening"
type LineTarget = "william" | "agent"
type DurableLineSnapshot = Awaited<ReturnType<typeof durableLineSnapshot>>
type AgentSnapshotLineContext = DurableLineSnapshot & Readonly<{
  clientGuard: Readonly<{
    worldId: string
    transitionEpoch: number
    descriptorFingerprint: string
    collectionFingerprint: string
  }>
}>
type DiffChallengeLineContext = Readonly<{
  kind: "diff-challenge"
  projectKey: "terrafusion" | "williamos"
  path: string
  baseHash: string
  indexHash: string
  patchHash: string
  fingerprint: string
  clientGuard: Readonly<{ worldId: string; transitionEpoch: number }>
}>
type PreviewExplainLineContext = Readonly<{
  kind: "preview-explain"
  projectKey: "terrafusion" | "williamos"
  previewFingerprint: string
  selectedPath: string
  clientGuard: Readonly<{
    worldId: string
    transitionEpoch: number
    requestId: number
    projectIdentity: string
    runningAppUrl: string | null
    status: PreviewInspectorPayload["evidence"]["status"]
    identity: PreviewInspectorPayload["evidence"]["identity"]
    origin: string | null
  }>
}>
type FileAskLineContext = Readonly<{
  kind: "file-ask"
  projectKey: "terrafusion" | "williamos"
  path: string
  projectIdentity: string
  revision: number
  activePaneId: string
  selection: Readonly<{ anchor: number; head: number }>
  clientGuard: Readonly<{ worldId: string; transitionEpoch: number }>
}>
type ToolRunSnapshot = Readonly<Pick<ToolRunTranscript, "id" | "operationId" | "operationLabel" | "alias" | "startedAt" | "endedAt" | "outcome">>
type ToolRunSnapshotsLineContext = Readonly<{
  kind: "tool-run-snapshots"
  runs: readonly ToolRunSnapshot[]
  clientGuard: Readonly<{
    worldId: string
    transitionEpoch: number
    scope: string
    fingerprint: string
  }>
}>
type LineContext = "space-summary" | Readonly<{ kind: "execution-assignment"; workOrderId: number }> | AgentSnapshotLineContext | DiffChallengeLineContext | PreviewExplainLineContext | FileAskLineContext | ToolRunSnapshotsLineContext | null
type LineMode = "default" | "change" | "review" | "fork"
type ExecutionObservation = Readonly<{
  worldId: string
  workOrderId: number
  state: "fresh" | "stale" | "mismatch"
  observedAt: string | null
}>
type StandardDelegateContext = Readonly<{
  kind: "file" | "preview" | "diff" | "space" | "agent" | "conversation"
  label: string
  provider: AgentProvider | null
  role: string
  assignment: string
  requiredSessionKey?: string
  fileAssignmentBinding?: Readonly<{
    worldId: string
    transitionEpoch: number
    projectIdentity: string
    outcomeKey: string
    workOrderId: number
    grantId: number
    worldRevision: number
    path: string
    actor: "codex" | "claude"
    proofSource: "space" | "file"
    repository?: AgentSessionRepository
  }>
  fileAssignmentProofs?: Readonly<Partial<Record<"codex" | "claude", SpaceDelegateEligibility>>>
  fileAssignmentProofSource?: "space" | "file"
  previewDebugBinding?: Readonly<{
    worldId: string
    transitionEpoch: number
    revision: number
    runningAppUrl: string | null
    projectIdentity: string
  }>
}>

type SpaceDelegateEligibility = Readonly<{
  eligible: true
  worldId: string
  worldRevision: number
  outcomeKey: string
  workOrderId: number
  grantId: number
  actor: "codex" | "claude"
  selectedPath: string
  repository?: AgentSessionRepository
}>

function parseSpaceDelegateEligibility(value: unknown): SpaceDelegateEligibility | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const repositoryValues = [
    candidate.repositoryResourceKey,
    candidate.repositoryIdentity,
    candidate.repositoryMountKey,
    candidate.observedRevision,
  ]
  const repositoryAbsent = repositoryValues.every((entry) => entry === undefined)
  const repository = repositoryAbsent ? undefined
    : typeof candidate.repositoryResourceKey === "string"
      && typeof candidate.repositoryIdentity === "string"
      && typeof candidate.repositoryMountKey === "string"
      && typeof candidate.observedRevision === "string"
      && /^[0-9a-f]{40,64}$/.test(candidate.observedRevision)
      ? {
        resourceKey: candidate.repositoryResourceKey,
        identity: candidate.repositoryIdentity,
        mountKey: candidate.repositoryMountKey,
        observedRevision: candidate.observedRevision,
      }
      : null
  return candidate.eligible === true
    && typeof candidate.worldId === "string"
    && Number.isSafeInteger(candidate.worldRevision)
    && typeof candidate.outcomeKey === "string"
    && Number.isSafeInteger(candidate.workOrderId)
    && Number.isSafeInteger(candidate.grantId)
    && (candidate.actor === "codex" || candidate.actor === "claude")
    && typeof candidate.selectedPath === "string"
    && repository !== null
    ? {
      eligible: true,
      worldId: candidate.worldId,
      worldRevision: candidate.worldRevision as number,
      outcomeKey: candidate.outcomeKey,
      workOrderId: candidate.workOrderId as number,
      grantId: candidate.grantId as number,
      actor: candidate.actor,
      selectedPath: candidate.selectedPath,
      ...(repository ? { repository } : {}),
    }
    : null
}
type ReviewerDelegateContext = Readonly<{
  kind: "reviewer"
  label: "Reviewer · Claude"
  provider: "Claude"
  role: "Reviewer"
  assignment: string
  reviewPath: string
  fileRef: WorkspaceFileRef
  repositoryKey: string
  sessionId: string
  requiredSessionKey: string
  mode: "review" | "diff-review"
  diffReview?: AgentSessionDiffReview
}>
type ContinueDelegateContext = Readonly<{
  kind: "continue"
  label: string
  provider: AgentProvider
  role: string
  assignment: string
  sessionKey: string
  sessionId: string
  worldId: string
  transitionEpoch: number
  collectionFingerprint: string
  descriptorFingerprint: string
  objectBinding: LineObjectBinding
}>
type LineSessionDelegateContext = Readonly<{
  kind: "line-session"
  label: string
  provider: AgentProvider
  role: string
  assignment: string
  sessionKey: string
  sessionId: string
  worldId: string
  transitionEpoch: number
  collectionFingerprint: string
  descriptorFingerprint: string
  objectBinding: LineObjectBinding
  objectContext: string
  spaceContext: string
}>
type DelegateContext = StandardDelegateContext | ReviewerDelegateContext | ContinueDelegateContext | LineSessionDelegateContext
export type LineObjectBinding =
  | Readonly<{ kind: "agent-session"; sessionKey: string }>
  | Readonly<{ kind: "file"; path: string }>
  | Readonly<{ kind: "diff"; path: string; fingerprint: string }>
  | Readonly<{ kind: "preview"; worldId: string; evidenceFingerprint: string }>
  | Readonly<{ kind: "space"; worldId: string; revision: number }>
type ForkContext = Readonly<{ sourceSessionId: string; assignment: string; label: string }>
type ChangeRefresh = Readonly<{ path: string | null; key: number }>
type CapturedDiffImprove = Readonly<{ path: string; fileRef: WorkspaceFileRef; fingerprint: string; worldId: string; transitionEpoch: number }>
type CapturedDiffReview = Readonly<{ path: string; fileRef: WorkspaceFileRef; fingerprint: string; worldId: string; transitionEpoch: number }>
type ChangeRefreshWaiter = {
  path: string
  resolve: (result: ChangeRefreshResult) => void
  editor?: ChangeRefreshResult
  diff?: "refreshed" | "failed"
}

function spaceContinueUnavailableMessage(state: AgentSessionCollectionState): string {
  if (state === "corrupt") return "Saved durable sessions are corrupt, so Continue cannot verify an exact session."
  if (state === "oversized") return "Saved durable sessions exceed the safe storage limit, so Continue cannot verify an exact session."
  if (state === "partial") return "Saved durable-session collection integrity is partial, so Continue cannot verify an exact session."
  if (state === "unavailable") return "Durable-session storage is unavailable, so Continue cannot verify an exact session."
  return "No durable session exists in this Space; use Delegate."
}

const windowName: Record<WindowId, string> = {
  editor: "Source",
  "running-app": "Developer preview",
  tests: "Tests",
  diff: "Changes",
  terminal: "Terminal",
}

const browserSpaceKey = (opaque: string) => `williamos:space:${opaque}`
const PREVIEW_EVIDENCE_SUBJECT = "TerraFusion developer preview"
const PREVIEW_DEBUG_PROMPT = "Diagnose the exact current Developer Preview using only its server-derived admitted evidence. State reachability, framing, and evidence limits; do not infer DOM, console, network, or business UI state."
const SPACE_CONTINUE_PROMPT = "Continue this exact saved session from its canonical transcript. Re-establish context and report the next bounded result without changing files, runtime state, target, or authority."
const CLAUDE_REVIEW_SESSION_KEY = /^Claude:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function lineSessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`
}

function isReviewableWorkspacePath(path: string | null): path is string {
  if (!path || path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) return false
  const segments = path.split("/")
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
}

function lineSessionDescriptorFingerprint(session: unknown): string {
  return JSON.stringify(session)
}

function lineSessionCollectionFingerprint(sessions: readonly unknown[]): string {
  return JSON.stringify([...sessions]
    .map((session) => lineSessionDescriptorFingerprint(session))
    .sort())
}

function liveModifiedDiffIdentity(context: LiveDiffContext | null): Omit<DiffChallengeLineContext, "kind" | "projectKey" | "clientGuard"> | null {
  if (!context) return null
  try {
    const value = JSON.parse(context.fingerprint) as Record<string, unknown>
    if (Object.keys(value).sort().join("|") !== "baseHash|indexHash|patchHash|path|state|status"
      || value.path !== context.path || value.state !== "modified"
      || typeof value.baseHash !== "string" || !value.baseHash
      || typeof value.indexHash !== "string" || !value.indexHash
      || typeof value.patchHash !== "string" || !value.patchHash) return null
    return { path: context.path, baseHash: value.baseHash, indexHash: value.indexHash, patchHash: value.patchHash, fingerprint: context.fingerprint }
  } catch {
    return null
  }
}

// 250 code points remains below Council's 2,000-character history limit even when every
// code point needs JSON's longest six-character escape.
const COUNCIL_SNAPSHOT_RESULT_EXCERPT_CODE_POINTS = 250

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function durableCouncilSnapshot(sessionKey: string, descriptor: DurableAgentSession, snapshotAt: string) {
  const mode = descriptor.preview ? "preview" as const
    : descriptor.diffReview ? "diff-review" as const
    : descriptor.reviewPath ? "review" as const
    : descriptor.forkedFrom ? "fork" as const
    : descriptor.provider === "Local" ? "conversation" as const
    : "delegate" as const
  const target = descriptor.diffReview
    ? `diff · ${descriptor.diffReview.path} · patch ${descriptor.diffReview.patchHash}`
    : descriptor.reviewPath ? `file review · ${descriptor.reviewPath}`
    : descriptor.target ? `file · ${descriptor.target.path}`
    : descriptor.preview ? `preview · ${descriptor.preview.worldId} · ${descriptor.preview.evidenceFingerprint}`
    : descriptor.forkedFrom ? `forked from · Claude:${descriptor.forkedFrom}`
    : "no saved target"
  const lastTurn = descriptor.completedTurns?.at(-1) ?? null
  const resultCodePoints = lastTurn ? Array.from(lastTurn.finalResult) : []
  const result = lastTurn ? {
    excerpt: resultCodePoints.slice(0, COUNCIL_SNAPSHOT_RESULT_EXCERPT_CODE_POINTS).join(""),
    digest: await sha256Hex(lastTurn.finalResult),
    originalCodePoints: resultCodePoints.length,
  } : null
  return {
    kind: "agent-snapshot" as const,
    sessionKey,
    role: descriptor.role,
    provider: descriptor.provider,
    assignment: descriptor.assignment,
    mode,
    target,
    lastTurn: lastTurn ? {
      identity: `turn-${descriptor.completedTurns!.length}:${lastTurn.completedAt}`,
      completedAt: lastTurn.completedAt,
      result: result!,
    } : null,
    snapshotAt,
  }
}

async function durableLineSnapshot(sessionKey: string, descriptor: DurableAgentSession, snapshotAt: string) {
  return {
    ...await durableCouncilSnapshot(sessionKey, descriptor, snapshotAt),
    forkedFrom: descriptor.forkedFrom ? `Claude:${descriptor.forkedFrom}` : null,
    updatedAt: descriptor.updatedAt,
  }
}

export function lineObjectBindingFingerprint(binding: LineObjectBinding | null): string {
  return JSON.stringify(binding)
}

function reviewerDelegateContext(agent: ExperienceAgentSession | null | undefined): ReviewerDelegateContext | null {
  if (!agent || agent.kind !== "durable-session" || agent.mode !== "review" && agent.mode !== "diff-review"
    || agent.providerLabel !== "Claude" || agent.role !== "Reviewer" || !agent.reviewPath
    || !agent.fileRef || !agent.repository || agent.fileRef.path !== agent.reviewPath
    || agent.fileRef.repositoryResourceKey !== agent.repository.resourceKey
    || !CLAUDE_REVIEW_SESSION_KEY.test(agent.id)) return null
  return {
    kind: "reviewer",
    label: "Reviewer · Claude",
    provider: "Claude",
    role: "Reviewer",
    assignment: agent.assignment,
    reviewPath: agent.reviewPath,
    fileRef: agent.fileRef,
    repositoryKey: agent.repository.resourceKey,
    sessionId: agent.id.slice("Claude:".length),
    requiredSessionKey: agent.id,
    mode: agent.mode,
    ...(agent.diffReview ? { diffReview: agent.diffReview } : {}),
  }
}

function durableSessionDelegateContext(agent: ExperienceAgentSession | null | undefined): ReviewerDelegateContext | StandardDelegateContext | null {
  if (!agent || agent.kind !== "durable-session") return null
  // A saved Claude file-mutation transcript does not retain the server-derived authority proof
  // required for another write. Keep it inspectable/reviewable, but do not advertise a
  // continuation context that the server must refuse.
  if (agent.providerLabel === "Claude" && agent.target) return null
  if (agent.mode === "review" || agent.mode === "diff-review") return reviewerDelegateContext(agent)
  const provider = agent.providerLabel
  if (provider !== "Codex" && provider !== "Claude" && provider !== "Local") return null
  const requiredSessionKey = agent.id
  if (agent.mode === "preview") {
    if (provider !== "Claude" || agent.role !== "Preview debugger" || !agent.preview) return null
    return {
      kind: "preview",
      label: "TerraFusion developer preview",
      provider,
      role: agent.role,
      assignment: agent.assignment,
      requiredSessionKey,
    }
  }
  if (provider === "Local") {
    if (agent.role !== "Thinker" || agent.reviewPath || agent.preview) return null
    return {
      kind: "conversation",
      label: "Local model",
      provider,
      role: agent.role,
      assignment: agent.assignment,
      requiredSessionKey,
    }
  }
  if (agent.reviewPath || agent.preview) return null
  return {
    kind: "agent",
    label: `${agent.role} · ${provider}`,
    provider,
    role: agent.role,
    assignment: agent.assignment,
    requiredSessionKey,
  }
}

function resumeSessionKey(context: DelegateContext | null): string | null {
  if (context?.kind === "continue" || context?.kind === "line-session") return context.sessionKey
  if (context?.kind === "reviewer") return context.requiredSessionKey
  return context?.requiredSessionKey ?? null
}

function previewEvidenceStorageKey(worldId: string, projectIdentity: string): string {
  return `williamos:preview-evidence:v1:${inspectorId({ kind: worldId, subject: projectIdentity })}`
}

function loadPreviewEvidenceSnapshot(worldId: string, projectIdentity: string): PreviewInspectorPayload | null {
  try {
    const storage = window.localStorage
    const raw = storage.getItem(previewEvidenceStorageKey(worldId, projectIdentity))
    if (!raw || new TextEncoder().encode(raw).byteLength > 8 * 1024) return null
    const decoded = JSON.parse(raw) as unknown
    if (!decoded || typeof decoded !== "object") return null
    const record = decoded as Record<string, unknown>
    if (record.schemaVersion !== 1 || record.worldId !== worldId || record.projectIdentity !== projectIdentity) return null
    const source = record.evidence
    return parsePreviewInspectorPayload({ evidence: source, snapshot: "saved" })
  } catch {
    return null
  }
}

function savePreviewEvidenceSnapshot(worldId: string, projectIdentity: string, payload: PreviewInspectorPayload): void {
  const safe = parsePreviewInspectorPayload(payload)
  if (!safe) return
  try {
    const encoded = JSON.stringify({
      schemaVersion: 1,
      worldId,
      projectIdentity,
      evidence: safe.evidence,
    })
    if (new TextEncoder().encode(encoded).byteLength > 8 * 1024) return
    window.localStorage.setItem(previewEvidenceStorageKey(worldId, projectIdentity), encoded)
  } catch {
    // A live inspection remains useful when browser-scoped restoration is unavailable.
  }
}

function removePreviewEvidenceSnapshot(worldId: string, projectIdentity: string): void {
  try {
    window.localStorage.removeItem(previewEvidenceStorageKey(worldId, projectIdentity))
  } catch {
    // Closing the live surface must remain usable if browser storage is unavailable.
  }
}

function williamJudgmentContextKey(space: WorkspaceSpace, spine: WorldSpine): string {
  return JSON.stringify({
    project: spine.projectName,
    execution: spine.execution,
    selectedPath: space.selectedPath,
    runningAppUrl: space.runningAppUrl,
    evidence: spine.evidence.at(-1) ?? null,
  })
}

function ownerTurnText(content: string): string {
  const request = content.match(/(?:^|\n)Owner request:\s*([\s\S]+)$/i)
  return request?.[1]?.trim() || content.trim()
}

function restoredConversation(turns: readonly WilliamConversationTurn[] | undefined): readonly WilliamConversationEntry[] {
  return (turns ?? []).flatMap((turn, index) => {
    if ((turn.role !== "owner" && turn.role !== "williamos") || typeof turn.content !== "string" || !turn.content.trim()) return []
    const at = typeof turn.at === "string" ? turn.at : new Date(0).toISOString()
    return [{
      id: `server-${index}-${at}`,
      role: turn.role,
      text: turn.role === "owner" ? ownerTurnText(turn.content) : turn.content.trim(),
      at,
    } satisfies WilliamConversationEntry]
  })
}

function inspectorId(surface: Pick<InspectorSurface, "kind" | "subject" | "identity">): string {
  const source = `${surface.kind}\0${surface.subject}\0${surface.identity ?? ""}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `inspector-${(hash >>> 0).toString(36)}`
}

function restoredInspectorSurface(id: string, seed: WorkspaceSpace["inspectorSeeds"][string]): InspectorSurface[] {
  if ((seed.kind === "review" || seed.kind === EXECUTION_ASSIGNMENT_INSPECTOR_KIND) && typeof seed.payload === "string") {
    const agentSession = seed.kind === "review" && isRestorableAgentSessionInspector(id, seed.subject, seed.payload)
    const agentSnapshot = agentSession ? parseAgentSessionInspectorPayload(seed.payload) : null
    return [{
      id,
      kind: agentSession ? AGENT_SESSION_INSPECTOR_SURFACE_KIND : seed.kind,
      subject: agentSession ? seed.subject.slice(AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX.length) : seed.subject,
      payload: seed.payload,
      ...(seed.kind === EXECUTION_ASSIGNMENT_INSPECTOR_KIND
        ? { identity: parseExecutionAssignmentInspectorPayload(seed.payload)
            ? executionAssignmentInspectorIdentity(parseExecutionAssignmentInspectorPayload(seed.payload)!)
            : undefined }
        : agentSnapshot ? { identity: agentSessionInspectorIdentity(agentSnapshot) } : {}),
    }]
  }
  return seed.kind === "hermes" ? [{ id, kind: "hermes", subject: seed.subject }] : []
}

function inspectableWilliamJudgment(value: unknown): WilliamJudgment | null {
  try {
    return validateWilliamJudgment(value)
  } catch {
    return null
  }
}

function williamJudgmentInspectorSurface(value: unknown): InspectorSurface | null {
  const snapshot = inspectableWilliamJudgment(value)
  if (!snapshot) return null
  const identity = `${snapshot.generatedAt}:${snapshot.basisFingerprint}`
  return {
    id: `inspector-william-judgment:${encodeURIComponent(snapshot.generatedAt)}:${snapshot.basisFingerprint}`,
    kind: "william-judgment",
    subject: "William judgment",
    identity,
    payload: snapshot,
  }
}

function captureToolRunSnapshots(
  storage: Storage,
  scope: string,
  worldId: string,
  transitionEpoch: number,
): ToolRunSnapshotsLineContext | null {
  const history = loadToolRunHistory(storage, scope)
  if (history.error || history.runs.length === 0) return null
  const latestByOperation = new Map<string, ToolRunTranscript>()
  for (const run of history.runs) {
    const prior = latestByOperation.get(run.operationId)
    if (!prior || prior.endedAt < run.endedAt || (prior.endedAt === run.endedAt && prior.id < run.id)) {
      latestByOperation.set(run.operationId, run)
    }
  }
  const runs = [...latestByOperation.values()]
    .sort((left, right) => left.endedAt.localeCompare(right.endedAt) || left.id.localeCompare(right.id))
    .slice(-6)
    .map(({ id, operationId, operationLabel, alias, startedAt, endedAt, outcome }) => ({
      id, operationId, operationLabel, alias, startedAt, endedAt, outcome,
    }))
  if (runs.length === 0) return null
  return {
    kind: "tool-run-snapshots",
    runs,
    clientGuard: { worldId, transitionEpoch, scope, fingerprint: JSON.stringify(runs) },
  }
}

function shouldAttachToolRunSnapshots(text: string): boolean {
  return /\b(tests?|build|terminal|tool)\b/i.test(text)
    && /\b(latest|current|state|status|result|outcome|ran|run|output|pass(?:ed|ing)?|fail(?:ed|ing|ure)?|succeed(?:ed|ing)?|success(?:ful|fully)?|exit(?:ed)?|complete(?:d)?)\b/i.test(text)
}

function spaceEndpoint(projectKey: "terrafusion" | "williamos", worldId?: string): string {
  const query = [
    ...(worldId ? [`worldId=${encodeURIComponent(worldId)}`] : []),
    ...(projectKey === "williamos" ? ["projectKey=williamos"] : []),
  ]
  return `/api/environment/space${query.length > 0 ? `?${query.join("&")}` : ""}`
}

function spaceMutationBody(
  projectKey: "terrafusion" | "williamos",
  value: Record<string, unknown>,
): Record<string, unknown> {
  return projectKey === "williamos" ? { ...value, projectKey } : value
}

export function WorkspaceShell({
  initialSummon = null,
  projectKey = "terrafusion",
}: {
  initialSummon?: SummonedSurface | null
  projectKey?: "terrafusion" | "williamos"
}) {
  const [space, setSpace] = useState<WorkspaceSpace>(() => defaultSpace())
  const [worldId, setWorldId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [persistencePending, setPersistencePending] = useState(false)
  const [lineOpen, setLineOpen] = useState(Boolean(initialSummon))
  const [lineInput, setLineInput] = useState("")
  const [lineReply, setLineReply] = useState<string | null>(null)
  const [lineTerminalPresentation, setLineTerminalPresentation] = useState<{ sessionKey: string; text: string } | null>(null)
  const [lineTerminalWarning, setLineTerminalWarning] = useState<{
    presentationEpoch: number
    transitionEpoch: number
    worldId: string | null
    projectIdentity: string | null
    path: string | null
    text: string
  } | null>(null)
  const [lineBusy, setLineBusy] = useState(false)
  const [lineTarget, setLineTarget] = useState<LineTarget>("william")
  const [lineContext, setLineContext] = useState<LineContext>(null)
  const [lineMode, setLineMode] = useState<LineMode>("default")
  const [lineTargetPickerOpen, setLineTargetPickerOpen] = useState(false)
  const [resumeSessionInFlightKeys, setResumeSessionInFlightKeys] = useState<readonly string[]>([])
  const [lineSessionObservedRunningKey, setLineSessionObservedRunningKey] = useState<string | null>(null)
  const [delegateContext, setDelegateContext] = useState<DelegateContext | null>(null)
  const [spaceDelegateEligibility, setSpaceDelegateEligibility] = useState<Readonly<Partial<Record<"codex" | "claude", SpaceDelegateEligibility>>>>({})
  const [spaceDelegateEligibilityPending, setSpaceDelegateEligibilityPending] = useState(false)
  const [fileDelegateEligibility, setFileDelegateEligibility] = useState<Readonly<Partial<Record<"codex" | "claude", SpaceDelegateEligibility>>>>({})
  const [fileDelegateEligibilityPending, setFileDelegateEligibilityPending] = useState(false)
  const [forkContext, setForkContext] = useState<ForkContext | null>(null)
  const [changeTarget, setChangeTarget] = useState<string | null>(null)
  const [changeFileRef, setChangeFileRef] = useState<WorkspaceFileRef | null>(null)
  const [changeIntent, setChangeIntent] = useState<"change" | "improve-diff">("change")
  const [capturedDiffImprove, setCapturedDiffImprove] = useState<CapturedDiffImprove | null>(null)
  const [capturedDiffReview, setCapturedDiffReview] = useState<CapturedDiffReview | null>(null)
  const [agentWorkReview, setAgentWorkReview] = useState(false)
  const [automaticPreviewDebugPending, setAutomaticPreviewDebugPending] = useState(false)
  const [automaticPreviewDebugRunning, setAutomaticPreviewDebugRunning] = useState(false)
  const [automaticSpaceContinuePending, setAutomaticSpaceContinuePending] = useState(false)
  const [automaticSpaceContinueRunning, setAutomaticSpaceContinueRunning] = useState(false)
  const automaticSpaceContinueSessionKeyRef = useRef<string | null>(null)
  const automaticSpaceContinueOperationIdRef = useRef<string | null>(null)
  const automaticSpaceContinueBaselineTurnIdsRef = useRef<ReadonlySet<string>>(new Set())
  const spaceDelegateEligibilityRequestRef = useRef(0)
  const spaceDelegateEligibilityRef = useRef<Readonly<Partial<Record<"codex" | "claude", SpaceDelegateEligibility>>>>({})
  const fileDelegateEligibilityRequestRef = useRef(0)
  const fileDelegateEligibilityRef = useRef<Readonly<Partial<Record<"codex" | "claude", SpaceDelegateEligibility>>>>({})
  const fileAssignmentOperationRef = useRef<{
    binding: NonNullable<StandardDelegateContext["fileAssignmentBinding"]>
    baselineTurnIds: ReadonlySet<string>
    operationId: string | null
    acceptedKey: string | null
  } | null>(null)
  const previewDebugSessionKeyRef = useRef<string | null>(null)
  const previewDebugStopRequestedRef = useRef(false)
  const [liveDiffContext, setLiveDiffContext] = useState<(LiveDiffContext & { worldId: string }) | null>(null)
  const liveDiffContextRef = useRef<(LiveDiffContext & { worldId: string }) | null>(null)
  const [reviewTarget, setReviewTarget] = useState<string | null>(null)
  const [reviewFileRef, setReviewFileRef] = useState<WorkspaceFileRef | null>(null)
  const [dirtyPaths, setDirtyPaths] = useState<Readonly<Record<string, boolean>>>({})
  const dirtyPathsRef = useRef<Readonly<Record<string, boolean>>>({})
  const [changeRefresh, setChangeRefresh] = useState<ChangeRefresh>({ path: null, key: 0 })
  const changeRefreshKey = useRef(0)
  const changeRefreshWaiters = useRef(new Map<number, ChangeRefreshWaiter>())
  const [inspectors, setInspectors] = useState<readonly InspectorSurface[]>([])
  const [conversation, setConversation] = useState<readonly WilliamConversationEntry[]>([])
  const [williamInput, setWilliamInput] = useState("")
  const [williamRailOpen, setWilliamRailOpen] = useState(false)
  const [williamBusy, setWilliamBusy] = useState(false)
  const [williamError, setWilliamError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<EnvironmentOverlay>(null)
  const [changeSetProjection, setChangeSetProjection] = useState<CrossRepositoryChangeSetProjection | null>(null)
  const [changeSetBusy, setChangeSetBusy] = useState(false)
  const [changeSetError, setChangeSetError] = useState<string | null>(null)
  const [repositoryFocusKey, setRepositoryFocusKey] = useState<string | null>(null)
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const [councilQuestion, setCouncilQuestion] = useState<string | null>(null)
  const [councilSession, setCouncilSession] = useState<BrainCouncilSession | null>(null)
  const [councilHistory, setCouncilHistory] = useState<readonly BrainCouncilSession[]>([])
  const [councilHistorical, setCouncilHistorical] = useState(false)
  const [councilView, setCouncilView] = useState<CouncilView>("history")
  const [councilBusy, setCouncilBusy] = useState(false)
  const [councilError, setCouncilError] = useState<string | null>(null)
  const [spine, setSpine] = useState<WorldSpine>(EMPTY_SPINE)
  const [executionSession, setExecutionSession] = useState<ProjectedWorldWorkerSession | null>(null)
  const [executionObservation, setExecutionObservation] = useState<ExecutionObservation | null>(null)
  const boundExecutionSession = executionSession?.worldId === worldId
    && executionSession.workOrderId === spine.workOrderId
    ? executionSession
    : null
  const boundExecutionObservation = executionObservation?.worldId === worldId
    && executionObservation.workOrderId === spine.workOrderId
    ? executionObservation
    : null
  const [judgment, setJudgment] = useState<WilliamJudgment | null>(null)
  const [judgmentBusy, setJudgmentBusy] = useState(false)
  const [judgmentError, setJudgmentError] = useState<string | null>(null)
  const [project, setProject] = useState<WorkspaceProject | null>(null)
  const [storage, setStorage] = useState<SpaceStorage>("server")
  const [spaceSummaries, setSpaceSummaries] = useState<readonly SpaceSummary[]>([])
  const [multiSpaceAvailable, setMultiSpaceAvailable] = useState(false)
  const [spaceCollectionAvailable, setSpaceCollectionAvailable] = useState(true)
  const [spaceCollectionReason, setSpaceCollectionReason] = useState<string | null>(null)
  const [transitionMessage, setTransitionMessage] = useState<string | null>(null)
  const [switchingSpace, setSwitchingSpace] = useState(false)
  const [runningTools, setRunningTools] = useState<Readonly<Record<"tests" | "terminal", string | null>>>({ tests: null, terminal: null })
  const continuationSyncRef = useRef<NonNullable<RunAgentTurnInput["onContinuation"]>>(async () => undefined)
  const relayAutoContinuation = useCallback<NonNullable<RunAgentTurnInput["onContinuation"]>>(
    (continuation) => continuationSyncRef.current(continuation),
    [],
  )
  const agentSessions = useExperienceAgentSessions({
    ownerScope: worldId ?? "unhydrated-owner-world",
    worldScope: project?.identity ?? worldId ?? "unhydrated-project",
    worldId: storage === "server" ? worldId : null,
    projectKey,
    executionSession: boundExecutionSession,
    autoContinue: storage === "server" && hydrated && spine.outcomeKey !== null,
    onAutoContinuation: relayAutoContinuation,
  })
  const previewDebugStopRef = useRef(agentSessions.stop)
  const stateRef = useRef(space)
  const spineRef = useRef(spine)
  const worldRef = useRef(worldId)
  const projectRef = useRef(project)
  const storageRef = useRef<SpaceStorage>(storage)
  const persistenceErrorRef = useRef<string | null>(persistenceError)
  const persistencePendingRef = useRef(persistencePending)
  const browserStorageKeyRef = useRef<string | null>(null)
  const previewEvidenceRequestRef = useRef(0)
  const changeSetRequestRef = useRef(0)
  const previewExplainEvidenceRef = useRef<Readonly<{
    worldId: string
    transitionEpoch: number
    requestId: number
    projectIdentity: string
    payload: PreviewInspectorPayload
  }> | null>(null)
  const preferenceStorageKeyRef = useRef<string | null>(null)
  const transitionEpochRef = useRef(0)
  const agentPresentationEpochRef = useRef(0)
  const agentSavedSessionsRef = useRef(agentSessions.savedSessions)
  const agentSelectedSessionKeyRef = useRef(agentSessions.selectedSessionKey)
  const agentCollectionStateRef = useRef(agentSessions.collectionState)
  const agentActiveTurnsRef = useRef(agentSessions.activeTurns)
  const focusedAgentIdRef = useRef(focusedAgentId)
  const councilViewEpochRef = useRef(0)
  const councilSessionRef = useRef(councilSession)
  const initialSummonConsumedRef = useRef(false)
  const lineRef = useRef<HTMLInputElement>(null)
  const messageSequence = useRef(0)
  const hydratedRef = useRef(hydrated)
  const spaceArrival = useRef<Promise<SpaceEnvelope> | null>(null)
  const summonArrival = useRef<Readonly<{ key: string; request: Promise<LineReply> }> | null>(null)
  const restorationStarted = useRef(false)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const revisionRef = useRef(0)
  const acknowledgedRevisionRef = useRef(0)
  const pendingPersistRef = useRef<PersistJob | null>(null)
  const drainingPersistRef = useRef(false)
  const drainPromiseRef = useRef<Promise<void> | null>(null)
  const persistBarrierRef = useRef<() => Promise<void>>(async () => {})
  const judgmentRequestedRef = useRef<string | null>(null)
  const judgmentContextRef = useRef<string | null>(null)
  const inspectorReturnWindowRef = useRef(new Map<string, string | null>())
  stateRef.current = space
  spineRef.current = spine
  hydratedRef.current = hydrated
  worldRef.current = worldId
  projectRef.current = project
  councilSessionRef.current = councilSession
  storageRef.current = storage
  persistenceErrorRef.current = persistenceError
  persistencePendingRef.current = persistencePending
  agentSavedSessionsRef.current = agentSessions.savedSessions
  agentSelectedSessionKeyRef.current = agentSessions.selectedSessionKey
  agentCollectionStateRef.current = agentSessions.collectionState
  agentActiveTurnsRef.current = agentSessions.activeTurns
  spaceDelegateEligibilityRef.current = spaceDelegateEligibility
  fileDelegateEligibilityRef.current = fileDelegateEligibility
  focusedAgentIdRef.current = focusedAgentId

  function selectedRepositoryBindingIsCurrent(repository: AgentSessionRepository | undefined): boolean {
    const selectedFileRef = stateRef.current.selectedFileRef
    if (!selectedFileRef) return true
    const selectedRepository = projectRef.current?.repositories?.find(
      (candidate) => candidate.key === selectedFileRef.repositoryResourceKey,
    )
    return Boolean(repository
      && selectedRepository
      && selectedRepository.mount.verified
      && selectedRepository.mount.revision
      && selectedFileRef.path === stateRef.current.selectedPath
      && selectedFileRef.projectIdentity === projectRef.current?.identity
      && selectedFileRef.repositoryResourceKey === repository.resourceKey
      && selectedFileRef.repositoryMountKey === repository.mountKey
      && selectedFileRef.observedRevision === repository.observedRevision
      && selectedRepository.identity === repository.identity
      && selectedRepository.mount.key === repository.mountKey
      && selectedRepository.mount.revision === repository.observedRevision)
  }

  function exactFileAssignmentBindingIsCurrent(binding: NonNullable<StandardDelegateContext["fileAssignmentBinding"]>): boolean {
    const proof = binding.proofSource === "space"
      ? spaceDelegateEligibilityRef.current[binding.actor] ?? null
      : fileDelegateEligibilityRef.current[binding.actor] ?? null
    return worldRef.current === binding.worldId
      && transitionEpochRef.current === binding.transitionEpoch
      && projectRef.current?.identity === binding.projectIdentity
      && spineRef.current.outcomeKey === binding.outcomeKey
      && spineRef.current.workOrderId === binding.workOrderId
      && stateRef.current.selectedPath === binding.path
      && stateRef.current.revision === binding.worldRevision
      && acknowledgedRevisionRef.current === binding.worldRevision
      && revisionRef.current === binding.worldRevision
      && !dirtyPathsRef.current[binding.path]
      && storageRef.current === "server"
      && !persistencePendingRef.current
      && !persistenceErrorRef.current
      && proof?.worldId === binding.worldId
      && proof.worldRevision === binding.worldRevision
      && proof.outcomeKey === binding.outcomeKey
      && proof.workOrderId === binding.workOrderId
      && proof.grantId === binding.grantId
      && proof.actor === binding.actor
      && proof.selectedPath === binding.path
      && selectedRepositoryBindingIsCurrent(binding.repository)
      && selectedRepositoryBindingIsCurrent(proof.repository)
      && JSON.stringify(proof.repository) === JSON.stringify(binding.repository)
  }

  function exactFileAssignmentOperationIsCurrent(operation: NonNullable<typeof fileAssignmentOperationRef.current>): boolean {
    return exactFileAssignmentBindingIsCurrent(operation.binding)
  }

  useEffect(() => {
    const operation = fileAssignmentOperationRef.current
    if (!operation) return
    const provider = operation.binding.actor === "codex" ? "Codex" : "Claude"
    const created = agentSessions.activeTurns.filter((turn) => !operation.baselineTurnIds.has(turn.id)
      && turn.provider === provider && turn.role === "Builder")
    if (created.length === 1) {
      operation.operationId = created[0].id
      operation.acceptedKey = created[0].sessionId ? created[0].id : null
    }
    if (exactFileAssignmentOperationIsCurrent(operation)) return
    const exactOperationId = operation.acceptedKey ?? operation.operationId
    if (exactOperationId) agentSessions.stop(exactOperationId)
  }, [
    agentSessions.activeTurns, agentSessions.stop, dirtyPaths, persistenceError, persistencePending,
    project?.identity, space.revision, space.selectedPath, spaceDelegateEligibility, fileDelegateEligibility,
    spine.execution, spine.outcomeKey, spine.workOrderId, worldId,
  ])

  useEffect(() => {
    if (delegateContext?.kind !== "file") return
    const capturedPath = delegateContext.fileAssignmentBinding?.path
      ?? delegateContext.fileAssignmentProofs?.codex?.selectedPath
      ?? delegateContext.fileAssignmentProofs?.claude?.selectedPath
      ?? delegateContext.label
    const capturedRepository = delegateContext.fileAssignmentBinding?.repository
      ?? delegateContext.fileAssignmentProofs?.codex?.repository
      ?? delegateContext.fileAssignmentProofs?.claude?.repository
    if (capturedPath === space.selectedPath && selectedRepositoryBindingIsCurrent(capturedRepository)) return
    // Delegate is an object action. If the selected object changes before dispatch, discard the
    // stale client intent; the server will derive authority only from the newly persisted Space.
    setDelegateContext(null)
    setLineTarget("william")
    setLineInput("")
    setLineOpen(false)
  }, [delegateContext, project, space.selectedFileRef, space.selectedPath])

  const appendConversation = useCallback((role: WilliamConversationEntry["role"], text: string) => {
    const normalized = text.trim()
    if (!normalized) return
    messageSequence.current += 1
    const entry: WilliamConversationEntry = {
      id: `client-${messageSequence.current}`,
      role,
      text: normalized,
      at: new Date().toISOString(),
    }
    setConversation((current) => [...current, entry])
  }, [])

  const materializeSurfaces = useCallback((reply: LineReply) => {
    if (reply.dismiss) {
      setInspectors((current) => {
        const next = reply.dismiss === "all" ? [] : current.filter((surface) => surface.kind !== reply.dismiss)
        return next
      })
      setSpace((current) => {
        const removedIds = new Set(inspectors.filter((surface) => reply.dismiss === "all" || surface.kind === reply.dismiss).map((surface) => surface.id))
        return {
          ...current,
          inspectorWindows: Object.fromEntries(Object.entries(current.inspectorWindows).filter(([id]) => !removedIds.has(id))),
          inspectorSeeds: Object.fromEntries(Object.entries(current.inspectorSeeds).filter(([id]) => !removedIds.has(id))),
          activeWindowId: current.activeWindowId && removedIds.has(current.activeWindowId) ? null : current.activeWindowId,
        }
      })
    }
    const usedIds = new Map(inspectors.map((surface) => [surface.id, surface]))
    const incoming: InspectorSurface[] = []
    for (const surface of reply.surfaces ?? []) {
      const binding = surface.kind === "review" ? diffReviewInspectorBinding(surface.payload) : null
      const agentSnapshot = surface.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND
        ? parseAgentSessionInspectorPayload(surface.payload) : null
      const exactIdentity = binding ? diffReviewInspectorIdentity(binding)
        : agentSnapshot ? agentSessionInspectorIdentity(agentSnapshot) : surface.identity ?? null
      const singletonExisting = !exactIdentity && isSummonedSurface(surface.kind)
        ? [...inspectors, ...incoming].find((candidate) => candidate.kind === surface.kind && candidate.subject === surface.subject)
        : null
      const exactExisting = exactIdentity ? [...inspectors, ...incoming].find((candidate) => {
        const candidateBinding = candidate.kind === "review" ? diffReviewInspectorBinding(candidate.payload) : null
        const candidateAgentSnapshot = candidate.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND
          ? parseAgentSessionInspectorPayload(candidate.payload) : null
        const candidateIdentity = candidateBinding ? diffReviewInspectorIdentity(candidateBinding)
          : candidateAgentSnapshot ? agentSessionInspectorIdentity(candidateAgentSnapshot) : candidate.identity ?? null
        return candidate.kind === surface.kind && candidateIdentity === exactIdentity
          && (surface.kind === EXECUTION_ASSIGNMENT_INSPECTOR_KIND
            || surface.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND || candidate.subject === surface.subject)
      }) : singletonExisting
      if (exactExisting) {
        incoming.push({ ...surface, identity: exactIdentity ?? undefined, id: exactExisting.id })
      } else {
        const baseId = binding ? diffReviewInspectorId(binding)
          : agentSnapshot ? agentSessionInspectorId(agentSnapshot)
          : surface.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND
            ? agentSessionInspectorIdFromIdentity(exactIdentity) ?? inspectorId(surface)
            : inspectorId(surface)
        let id = baseId
        let collision = 1
        while (usedIds.has(id)) {
          id = `${baseId}:${collision}`
          collision += 1
        }
        const resolved = { ...surface, identity: exactIdentity ?? undefined, id }
        usedIds.set(id, resolved)
        incoming.push(resolved)
      }
    }
    if (incoming.length === 0) return
    setInspectors((current) => {
      const byId = new Map(current.map((surface) => [surface.id, surface]))
      incoming.forEach((surface) => byId.set(surface.id, surface))
      return [...byId.values()]
    })
    setSpace((current) => {
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      const inspectorWindows = { ...current.inspectorWindows }
      const inspectorSeeds = { ...current.inspectorSeeds }
      incoming.forEach((surface, index) => {
        const existing = inspectorWindows[surface.id]
        inspectorWindows[surface.id] = existing ? {
          ...existing,
          minimized: false,
          z: highest + index + 1,
        } : {
          x: 104 + index * 34,
          y: 72 + index * 30,
          width: 560,
          height: 480,
          z: highest + index + 1,
          minimized: false,
        }
        inspectorSeeds[surface.id] = {
          kind: surface.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND ? "review" : surface.kind,
          subject: surface.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND
            ? `${AGENT_SESSION_INSPECTOR_PERSISTED_SUBJECT_PREFIX}${surface.subject}` : surface.subject,
          ...((surface.kind === "review" || surface.kind === AGENT_SESSION_INSPECTOR_SURFACE_KIND
            || surface.kind === EXECUTION_ASSIGNMENT_INSPECTOR_KIND) && typeof surface.payload === "string"
            ? { payload: surface.payload }
            : {}),
        }
      })
      const active = incoming.at(-1)?.id ?? current.activeWindowId
      return { ...current, inspectorWindows, inspectorSeeds, activeWindowId: active }
    })
  }, [inspectors])

  const materializeExecutionAssignment = useCallback((sessionId: string) => {
    const session = boundExecutionSession
    if (!session || session.id !== sessionId || session.worldId !== worldId || session.workOrderId !== spine.workOrderId) {
      setTransitionMessage("That persisted assignment is no longer bound to this Space.")
      return
    }
    try {
      const payload = encodeExecutionAssignmentInspectorPayload(session, spine)
      materializeSurfaces({ surfaces: [{
        kind: EXECUTION_ASSIGNMENT_INSPECTOR_KIND,
        subject: `Work Order #${session.workOrderId}`,
        identity: executionAssignmentInspectorIdentity(session),
        payload,
      }] })
    } catch {
      setTransitionMessage("The exact persisted assignment snapshot is unavailable.")
    }
  }, [boundExecutionSession, materializeSurfaces, spine, worldId])

  const materializeDurableAgentSession = useCallback((sessionKey: string) => {
    const descriptor = agentSessions.savedSessions.find((candidate) => lineSessionKey(candidate.provider, candidate.sessionId) === sessionKey)
    const projection = agentSessions.sessions.find((candidate) => candidate.id === sessionKey && candidate.kind === "durable-session")
    if (!descriptor || !projection || agentSessions.collectionState !== "available") {
      setTransitionMessage("Durable agent session snapshot unavailable.")
      return
    }
    const payload = encodeAgentSessionInspectorPayload(sessionKey, descriptor, projection.truth, new Date().toISOString())
    materializeSurfaces({ surfaces: [{
      kind: AGENT_SESSION_INSPECTOR_SURFACE_KIND,
      subject: `${descriptor.role} · ${descriptor.provider}`,
      identity: agentSessionInspectorIdentity(sessionKey),
      payload,
    }] })
  }, [agentSessions.collectionState, agentSessions.savedSessions, agentSessions.sessions, materializeSurfaces])

  const materializeReviewReport = useCallback((path: string, report: string, binding?: AgentSessionDiffReview) => {
    materializeSurfaces({ surfaces: [{
      kind: "review",
      subject: path,
      ...(binding ? { identity: diffReviewInspectorIdentity(binding) } : {}),
      payload: binding ? encodeDiffReviewInspectorPayload(binding, report) : report,
    }] })
  }, [materializeSurfaces])

  const review = useSelectedFileReview({ path: reviewTarget, fileRef: reviewFileRef, sessions: agentSessions, onReport: materializeReviewReport })

  const acceptLineReply = useCallback((reply: LineReply) => {
    // A Line turn can change server-only judgment facts (validation marks, concerns, failures,
    // intent). Clear the active opinion until it is regenerated from the newly persisted world.
    judgmentRequestedRef.current = null
    setJudgment(null)
    if (typeof reply.worldId === "string") {
      if (reply.worldId !== worldRef.current) setExecutionSession(null)
      setWorldId(reply.worldId)
    }
    if (reply.spine) setSpine(reply.spine)
    const say = typeof reply.say === "string" ? reply.say : ""
    if (say) appendConversation("williamos", say)
    setLineReply(null)
    materializeSurfaces(reply)
  }, [appendConversation, materializeSurfaces])

  useEffect(() => {
    let cancelled = false
    const fallback = defaultSpace(window.innerWidth, window.innerHeight)
    const request = (spaceArrival.current ??= (async () => {
      const response = await fetch(spaceEndpoint(projectKey), { cache: "no-store" })
      const payload = (await response.json()) as Partial<SpaceEnvelope> & { error?: string }
      if (!response.ok || typeof payload.worldId !== "string" || !payload.space) {
        throw new Error(payload.error ?? `SPACE_${response.status}`)
      }
      let envelope: SpaceEnvelope = {
        worldId: payload.worldId,
        name: payload.name,
        space: payload.space,
        spine: payload.spine,
        judgment: payload.judgment,
        conversation: payload.conversation,
        project: payload.project,
        storage: payload.storage,
        browserStorageKey: payload.browserStorageKey,
        preferenceStorageKey: payload.preferenceStorageKey,
        multiSpaceAvailable: payload.multiSpaceAvailable,
        spaces: payload.spaces,
        collectionAvailable: payload.collectionAvailable,
        collectionReason: payload.collectionReason,
      }
      const preferenceKey = typeof envelope.preferenceStorageKey === "string"
        ? `williamos:selected-space:${envelope.preferenceStorageKey}` : null
      if (preferenceKey && envelope.multiSpaceAvailable) {
        const hinted = safeLocalStorageGet(preferenceKey)
        const hintedIsListed = envelope.spaces?.some((item) => item.worldId === hinted) === true
        if (hinted && hinted !== envelope.worldId && (hintedIsListed || envelope.collectionAvailable === false)) {
          try {
            const exactResponse = await fetch(spaceEndpoint(projectKey, hinted), { cache: "no-store" })
            const exact = await exactResponse.json() as SpaceEnvelope & { error?: string }
            if (exactResponse.ok && exact.worldId === hinted && exact.space) envelope = exact
            else if (!exactResponse.ok) safeLocalStorageRemove(preferenceKey)
          } catch {
            // Selection hints are best-effort. A failed exact lookup cannot discard the valid initial Space.
          }
        } else if (hinted && !hintedIsListed) {
          safeLocalStorageRemove(preferenceKey)
        }
      }
      return envelope
    })())
    void request
      .then((payload) => {
        if (cancelled) return
        const storageMode = payload.storage === "browser" ? "browser" : "server"
        const key = storageMode === "browser" && typeof payload.browserStorageKey === "string"
          && payload.browserStorageKey.length > 0
          ? browserSpaceKey(payload.browserStorageKey)
          : null
        if (storageMode === "browser" && !key) throw new Error("BROWSER_SPACE_KEY_UNAVAILABLE")
        let storedSpace = payload.space
        if (storageMode === "browser" && key) {
          browserStorageKeyRef.current = key
          try {
            const saved = window.localStorage.getItem(key)
            if (saved) storedSpace = (JSON.parse(saved) as { space?: unknown }).space ?? payload.space
          } catch {
            safeLocalStorageRemove(key)
          }
        }
        const identity = payload.worldId
        const name = payload.name ?? payload.project?.name ?? "Space"
        const restoredBase = qualifyLegacyWorkspaceFiles(
          normalizeSpace(storedSpace, defaultSpace(window.innerWidth, window.innerHeight, identity, name), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
          payload.project,
        )
        const savedPreview = payload.project
          ? loadPreviewEvidenceSnapshot(payload.worldId, payload.project.identity)
          : null
        const previewSurface: InspectorSurface | null = savedPreview ? {
          id: inspectorId({ kind: "preview-evidence", subject: PREVIEW_EVIDENCE_SUBJECT }),
          kind: "preview-evidence",
          subject: PREVIEW_EVIDENCE_SUBJECT,
          payload: savedPreview,
        } : null
        const restored = previewSurface ? {
          ...restoredBase,
          inspectorWindows: {
            ...restoredBase.inspectorWindows,
            [previewSurface.id]: restoredBase.inspectorWindows[previewSurface.id] ?? {
              x: 104, y: 72, width: 560, height: 480,
              z: Math.max(...Object.values(restoredBase.windows).map((window) => window.z)) + 1,
              minimized: false,
            },
          },
          inspectorSeeds: {
            ...restoredBase.inspectorSeeds,
            [previewSurface.id]: { kind: previewSurface.kind, subject: previewSurface.subject },
          },
          activeWindowId: previewSurface.id,
        } satisfies WorkspaceSpace : restoredBase
        revisionRef.current = restored.revision
        acknowledgedRevisionRef.current = restored.revision
        setPersistencePending(false)
        setWorldId(payload.worldId)
        setSpace(restored)
        setInspectors([
          ...Object.entries(restored.inspectorSeeds).flatMap(([id, seed]) => restoredInspectorSurface(id, seed)),
          ...(previewSurface ? [previewSurface] : []),
        ])
        setStorage(storageMode)
        setSpaceSummaries(payload.spaces ?? [{ worldId: payload.worldId, name, space: payload.space, updatedAt: new Date(0).toISOString() }])
        setMultiSpaceAvailable(payload.multiSpaceAvailable === true)
        setSpaceCollectionAvailable(payload.collectionAvailable !== false)
        setSpaceCollectionReason(payload.collectionAvailable === false ? payload.collectionReason ?? "SPACE_COLLECTION_UNAVAILABLE" : null)
        preferenceStorageKeyRef.current = typeof payload.preferenceStorageKey === "string"
          ? `williamos:selected-space:${payload.preferenceStorageKey}` : null
        if (preferenceStorageKeyRef.current) safeLocalStorageSet(preferenceStorageKeyRef.current, payload.worldId)
        if (payload.project) setProject(payload.project)
        if (payload.spine) setSpine(payload.spine)
        setJudgment(payload.judgment ?? null)
        setConversation(restoredConversation(payload.conversation))
      })
      .catch((error) => {
        if (!cancelled) {
          setSpace(fallback)
          setPersistenceError(error instanceof Error ? error.message : "SPACE_UNAVAILABLE")
        }
      })
      .finally(() => {
        if (!cancelled) setHydrated(true)
      })
    return () => { cancelled = true }
  }, [projectKey])

  const refreshPersistedSpaceSelection = useCallback(async (expectedSelectedPath?: string) => {
    const requestWorldId = worldRef.current
    const requestEpoch = transitionEpochRef.current
    if (!requestWorldId || storageRef.current !== "server") throw new Error("CONTINUATION_SPACE_UNAVAILABLE")
    const response = await fetch(spaceEndpoint(projectKey, requestWorldId), { cache: "no-store" })
    const payload = await response.json() as SpaceEnvelope & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `CONTINUATION_SPACE_${response.status}`)
    if (worldRef.current !== requestWorldId || transitionEpochRef.current !== requestEpoch
      || payload.worldId !== requestWorldId) throw new Error("CONTINUATION_SPACE_CHANGED")
    const restored = qualifyLegacyWorkspaceFiles(
      normalizeSpace(
        payload.space,
        defaultSpace(window.innerWidth, window.innerHeight, requestWorldId, payload.name ?? projectRef.current?.name ?? "Space"),
        { width: window.innerWidth, height: window.innerHeight },
      ),
      payload.project ?? projectRef.current,
    )
    if (expectedSelectedPath !== undefined && restored.selectedPath !== expectedSelectedPath) {
      throw new Error("CONTINUATION_SELECTION_MISMATCH")
    }
    revisionRef.current = restored.revision
    acknowledgedRevisionRef.current = restored.revision
    pendingPersistRef.current = null
    setSpace((current) => ({
      ...current,
      revision: restored.revision,
      activeWindowId: restored.activeWindowId,
      selectedPath: restored.selectedPath,
      editor: restored.editor,
    }))
    if (payload.spine) setSpine(payload.spine)
    setPersistenceError(null)
    setPersistencePending(false)
  }, [projectKey])

  const refreshWilliamJudgment = useCallback(async () => {
    const id = worldRef.current
    if (!id || storageRef.current !== "server" || judgmentBusy) return
    setJudgmentBusy(true)
    setJudgmentError(null)
    try {
      await persistBarrierRef.current()
      const requestContext = williamJudgmentContextKey(stateRef.current, spineRef.current)
      const response = await fetch("/api/environment/judgment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId: id }),
        cache: "no-store",
      })
      const payload = await response.json() as { error?: string; judgment?: WilliamJudgment }
      if (!response.ok || !payload.judgment) throw new Error(payload.error ?? `JUDGMENT_${response.status}`)
      if (worldRef.current !== id || williamJudgmentContextKey(stateRef.current, spineRef.current) !== requestContext) {
        judgmentRequestedRef.current = null
        return
      }
      setJudgment(payload.judgment)
    } catch (error) {
      setJudgmentError(error instanceof Error ? error.message : "JUDGMENT_UNAVAILABLE")
    } finally {
      setJudgmentBusy(false)
    }
  }, [judgmentBusy])

  useEffect(() => {
    if (!hydrated || !worldId || storage !== "server" || judgment || judgmentRequestedRef.current === worldId) return
    judgmentRequestedRef.current = worldId
    void refreshWilliamJudgment()
  }, [hydrated, judgment, refreshWilliamJudgment, storage, worldId])

  const judgmentContextKey = williamJudgmentContextKey(space, spine)
  useEffect(() => {
    if (!hydrated) return
    if (judgmentContextRef.current === null) {
      judgmentContextRef.current = judgmentContextKey
      return
    }
    if (judgmentContextRef.current === judgmentContextKey) return
    judgmentContextRef.current = judgmentContextKey
    judgmentRequestedRef.current = null
    setJudgment(null)
  }, [hydrated, judgmentContextKey])

  useEffect(() => {
    let frame: number | null = null
    const recontain = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = null
        setSpace((current) => spaceInViewport(current, { width: window.innerWidth, height: window.innerHeight }))
      })
    }
    window.addEventListener("resize", recontain)
    return () => {
      window.removeEventListener("resize", recontain)
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  useEffect(() => {
    if (!hydrated || !worldId || restorationStarted.current) return
    restorationStarted.current = true
    const restorationWorldId = worldId
    const restorationEpoch = transitionEpochRef.current
    for (const seed of Object.values(stateRef.current.inspectorSeeds)) {
      if (seed.kind === "review") continue
      void fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId, summon: seed.kind }),
      }).then(async (response) => {
        if (!response.ok) return
        const reply = await response.json() as LineReply
        if (worldRef.current !== restorationWorldId || transitionEpochRef.current !== restorationEpoch) return
        if (reply.spine) setSpine(reply.spine)
        materializeSurfaces(reply)
      }).catch(() => {
        // Identity remains persisted. A failed current read never becomes fabricated payload.
      })
    }
  }, [hydrated, materializeSurfaces, worldId])

  useEffect(() => {
    const outcomeKey = spine.outcomeKey
    if (!hydrated || storage !== "server" || !worldId || !outcomeKey || spine.workOrderId === null) {
      setExecutionSession(null)
      setExecutionObservation(null)
      return
    }
    let cancelled = false
    let latestRead = 0
    const executionWorldId = worldId
    const executionWorkOrderId = spine.workOrderId
    const executionEpoch = transitionEpochRef.current
    const readExecution = async () => {
      const readId = ++latestRead
      try {
        const response = await fetch(`/api/environment/execution?worldId=${encodeURIComponent(executionWorldId)}`, { cache: "no-store" })
        if (!response.ok) {
          if (!cancelled && readId === latestRead && worldRef.current === executionWorldId && transitionEpochRef.current === executionEpoch) {
            if (response.status === 409) {
              setExecutionSession(null)
              setExecutionObservation({ worldId: executionWorldId, workOrderId: executionWorkOrderId, state: "mismatch", observedAt: null })
            } else {
              setExecutionObservation((current) => ({
                worldId: executionWorldId,
                workOrderId: executionWorkOrderId,
                state: "stale",
                observedAt: current?.worldId === executionWorldId && current.workOrderId === executionWorkOrderId
                  ? current.observedAt
                  : null,
              }))
            }
          }
          return
        }
        const live = await response.json() as Pick<WorldSpine, "execution" | "worker" | "evidence" | "outcomeKey" | "workOrderId"> & { worldId?: unknown; session: ProjectedWorldWorkerSession | null }
        if (cancelled || readId !== latestRead || worldRef.current !== executionWorldId || transitionEpochRef.current !== executionEpoch
          || spineRef.current.outcomeKey !== outcomeKey || spineRef.current.workOrderId !== executionWorkOrderId) return
        if (live.worldId !== executionWorldId || live.outcomeKey !== outcomeKey || live.workOrderId !== executionWorkOrderId
          || live.session && (live.session.worldId !== executionWorldId || live.session.workOrderId !== executionWorkOrderId)) {
          setExecutionSession(null)
          setExecutionObservation({ worldId: executionWorldId, workOrderId: executionWorkOrderId, state: "mismatch", observedAt: null })
          return
        }
        setSpine((current) => current.outcomeKey === outcomeKey && current.workOrderId === executionWorkOrderId
          ? { ...current, execution: live.execution, worker: live.worker, evidence: live.evidence }
          : current)
        setExecutionSession(live.session?.worldId === executionWorldId ? live.session : null)
        setExecutionObservation({
          worldId: executionWorldId,
          workOrderId: executionWorkOrderId,
          state: "fresh",
          observedAt: live.session?.worldId === executionWorldId ? live.session.observedAt : new Date().toISOString(),
        })
      } catch {
        if (!cancelled && readId === latestRead && worldRef.current === executionWorldId && transitionEpochRef.current === executionEpoch) {
          setExecutionObservation((current) => ({
            worldId: executionWorldId,
            workOrderId: executionWorkOrderId,
            state: "stale",
            observedAt: current?.worldId === executionWorldId && current.workOrderId === executionWorkOrderId
              ? current.observedAt
              : null,
          }))
        }
      }
    }
    void readExecution()
    const timer = setInterval(() => void readExecution(), 4000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [hydrated, spine.outcomeKey, spine.workOrderId, storage, worldId])

  const sendPersist = useCallback(async (job: PersistJob) => {
    try {
      if (job.storage === "browser") {
        const key = job.browserKey
        if (!key) throw new Error("BROWSER_SPACE_KEY_UNAVAILABLE")
        window.localStorage.setItem(key, job.body)
        const acknowledgedAt = new Date().toISOString()
        if (transitionEpochRef.current !== job.epoch || worldRef.current !== job.worldId) return
        acknowledgedRevisionRef.current = job.revision
        revisionRef.current = Math.max(revisionRef.current, job.revision)
        setSpace((current) => job.revision > current.revision ? { ...current, revision: job.revision } : current)
        setSpaceSummaries((current) => current.map((summary) => summary.worldId === job.worldId
          ? { ...summary, updatedAt: acknowledgedAt }
          : summary))
        setPersistenceError(null)
        if (job.revision >= revisionRef.current) setPersistencePending(false)
        return
      }
      const response = await fetch("/api/environment/space", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: job.body,
        keepalive: job.keepalive,
      })
      const payload = await response.json().catch(() => ({})) as { error?: string; worldId?: unknown; space?: unknown; updatedAt?: unknown }
      if (!response.ok) throw new Error(payload.error ?? `SPACE_SAVE_${response.status}`)
      if (transitionEpochRef.current !== job.epoch || worldRef.current !== job.worldId) return
      const record = payload.space && typeof payload.space === "object" ? payload.space as Record<string, unknown> : null
      const acknowledged = record && Number.isSafeInteger(record.revision) ? record.revision as number : job.revision
      const exactRecencyAcknowledgement = payload.worldId === job.worldId && record?.revision === job.revision
      if (acknowledged >= acknowledgedRevisionRef.current) {
        acknowledgedRevisionRef.current = acknowledged
        revisionRef.current = Math.max(revisionRef.current, acknowledged)
        setSpace((current) => acknowledged > current.revision ? { ...current, revision: acknowledged } : current)
        if (exactRecencyAcknowledgement
          && typeof payload.updatedAt === "string"
          && Number.isFinite(Date.parse(payload.updatedAt))
          && new Date(payload.updatedAt).toISOString() === payload.updatedAt) {
          setSpaceSummaries((current) => current.map((summary) => summary.worldId === job.worldId
            ? { ...summary, updatedAt: payload.updatedAt as string }
            : summary))
        }
        setPersistenceError(null)
        if (acknowledged >= revisionRef.current) setPersistencePending(false)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "SPACE_SAVE_REFUSED"
      if (message === "SPACE_REVISION_STALE"
        && transitionEpochRef.current === job.epoch
        && worldRef.current === job.worldId
        && job.revision >= revisionRef.current) {
        try {
          await refreshPersistedSpaceSelection()
          return
        } catch {
          // Preserve the original stale-revision refusal when current truth cannot be reloaded.
        }
      }
      if (transitionEpochRef.current === job.epoch && worldRef.current === job.worldId && job.revision >= revisionRef.current) {
        setPersistenceError(message)
        setPersistencePending(false)
      }
    }
  }, [refreshPersistedSpaceSelection])

  const persist = useCallback((keepalive = false): Promise<number> => {
    const id = worldRef.current
    if (!id) return Promise.resolve(acknowledgedRevisionRef.current)
    const revision = nextSpaceRevision(revisionRef.current)
    revisionRef.current = revision
    setPersistencePending(true)
    const job: PersistJob = {
      worldId: id,
      revision,
      body: JSON.stringify(spaceMutationBody(projectKey, { worldId: id, space: spaceToServer(stateRef.current, revision) })),
      storage: storageRef.current,
      browserKey: browserStorageKeyRef.current,
      epoch: transitionEpochRef.current,
      keepalive,
    }
    // Teardown cannot wait behind an ordinary request: the document may be discarded before that
    // request settles. The server's monotonic revision gate rejects an older write that loses this
    // race, while live-page blur saves remain serialized below for the judgment barrier.
    if (keepalive) return sendPersist(job).then(() => revision)
    pendingPersistRef.current = job
    if (drainingPersistRef.current) {
      return (drainPromiseRef.current ?? Promise.resolve()).then(() => revision)
    }
    drainingPersistRef.current = true
    const drain = (async () => {
      try {
        while (pendingPersistRef.current) {
          const next = pendingPersistRef.current
          pendingPersistRef.current = null
          await sendPersist(next)
        }
      } finally {
        drainingPersistRef.current = false
      }
    })()
    drainPromiseRef.current = drain
    void drain.finally(() => {
      if (drainPromiseRef.current === drain) drainPromiseRef.current = null
    })
    return drain.then(() => revision)
  }, [projectKey, sendPersist])
  persistBarrierRef.current = async () => {
    if (persistTimer.current) clearTimeout(persistTimer.current)
    const requiredRevision = await persist()
    if (storageRef.current !== "server" || acknowledgedRevisionRef.current < requiredRevision) {
      throw new Error("The current Space must be saved before grounded reasoning can begin.")
    }
  }

  useLayoutEffect(() => {
    if (!hydrated || !worldId) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    setPersistencePending(true)
    persistTimer.current = setTimeout(() => void persist(), 420)
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current)
    }
  }, [
    space.windows, space.inspectorWindows, space.inspectorSeeds, space.activeWindowId,
    space.runningAppUrl, space.selectedPath, space.editor, worldId, hydrated, persist,
  ])

  useEffect(() => {
    const teardownFlush = () => void persist(true)
    const liveFlush = () => void persist()
    const visibility = () => { if (document.visibilityState === "hidden") teardownFlush() }
    window.addEventListener("pagehide", teardownFlush)
    window.addEventListener("blur", liveFlush)
    document.addEventListener("visibilitychange", visibility)
    return () => {
      window.removeEventListener("pagehide", teardownFlush)
      window.removeEventListener("blur", liveFlush)
      document.removeEventListener("visibilitychange", visibility)
    }
  }, [persist])

  useEffect(() => {
    if (!initialSummon || !hydrated || initialSummonConsumedRef.current) return
    initialSummonConsumedRef.current = true
    let cancelled = false
    const summonWorldId = worldId
    const summonEpoch = transitionEpochRef.current
    const key = `initial\0${initialSummon}`
    const existing = summonArrival.current
    const request = existing?.key === key
      ? existing.request
      : (async () => {
          const response = await fetch("/api/environment/line", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ worldId, summon: initialSummon }),
          })
          const payload = await response.json()
          if (!response.ok) throw new Error(payload.error ?? `LINE_${response.status}`)
          return payload as LineReply
        })()
    summonArrival.current = { key, request }
    setLineOpen(true)
    setLineBusy(true)
    void request
      .then((payload) => { if (!cancelled && worldRef.current === summonWorldId && transitionEpochRef.current === summonEpoch) acceptLineReply(payload) })
      .catch((error) => { if (!cancelled) setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE") })
      .finally(() => { if (!cancelled) setLineBusy(false) })
    return () => { cancelled = true }
  }, [acceptLineReply, hydrated, initialSummon, worldId])

  const inspectPreviewEvidence = useCallback(async () => {
    const requestWorldId = worldRef.current
    const requestProjectIdentity = projectRef.current?.identity ?? null
    const requestEpoch = transitionEpochRef.current
    const requestId = previewEvidenceRequestRef.current + 1
    previewEvidenceRequestRef.current = requestId
    previewExplainEvidenceRef.current = null
    if (!requestWorldId || !requestProjectIdentity) return
    try {
      const response = await fetch("/api/environment/preview", { cache: "no-store" })
      const body = await response.json() as unknown
      const evidence = body && typeof body === "object"
        ? (body as Record<string, unknown>).evidence
        : null
      const payload = response.ok
        ? parsePreviewInspectorPayload({ evidence, snapshot: "live" })
        : null
      if (!payload) throw new Error("PREVIEW_EVIDENCE_UNAVAILABLE")
      if (previewEvidenceRequestRef.current !== requestId
        || worldRef.current !== requestWorldId
        || projectRef.current?.identity !== requestProjectIdentity
        || transitionEpochRef.current !== requestEpoch) return
      savePreviewEvidenceSnapshot(requestWorldId, requestProjectIdentity, payload)
      setTransitionMessage(null)
      materializeSurfaces({ surfaces: [{ kind: "preview-evidence", subject: PREVIEW_EVIDENCE_SUBJECT, payload }] })
    } catch {
      if (previewEvidenceRequestRef.current === requestId
        && worldRef.current === requestWorldId
        && projectRef.current?.identity === requestProjectIdentity
        && transitionEpochRef.current === requestEpoch) {
        setTransitionMessage("Preview evidence is unavailable; no runtime facts were inferred.")
      }
    }
  }, [materializeSurfaces])

  const openRepositoryDeliverySurface = useCallback(async (target: "change-set" | "preview-composition") => {
    setOverlay(target)
    setChangeSetError(null)
    if (projectKey !== "terrafusion") {
      setChangeSetProjection(null)
      setChangeSetError("Cross-repository delivery belongs to the TerraFusion Project.")
      return
    }
    const requestWorldId = worldRef.current
    const requestEpoch = transitionEpochRef.current
    const requestId = changeSetRequestRef.current + 1
    changeSetRequestRef.current = requestId
    if (!requestWorldId || storageRef.current !== "server") {
      setChangeSetProjection(null)
      setChangeSetError("Change Set evidence needs an open persistent server Space.")
      return
    }
    setChangeSetBusy(true)
    try {
      const response = await fetch(`/api/environment/change-set?worldId=${encodeURIComponent(requestWorldId)}`, { cache: "no-store" })
      const payload = await response.json() as CrossRepositoryChangeSetProjection & Readonly<{ error?: string }>
      if (changeSetRequestRef.current !== requestId
        || worldRef.current !== requestWorldId
        || transitionEpochRef.current !== requestEpoch) return
      if (!response.ok || payload.version !== "williamos-cross-repository-change-set.v1" || payload.worldId !== requestWorldId) {
        throw new Error(payload.error ?? `CHANGE_SET_${response.status}`)
      }
      setChangeSetProjection(payload)
    } catch (error) {
      if (changeSetRequestRef.current === requestId
        && worldRef.current === requestWorldId
        && transitionEpochRef.current === requestEpoch) {
        setChangeSetProjection(null)
        setChangeSetError(error instanceof Error ? error.message : "Change Set evidence is unavailable.")
      }
    } finally {
      if (changeSetRequestRef.current === requestId
        && worldRef.current === requestWorldId
        && transitionEpochRef.current === requestEpoch) setChangeSetBusy(false)
    }
  }, [projectKey])

  const openWilliamJudgmentInspector = useCallback(() => {
    const surface = williamJudgmentInspectorSurface(judgment)
    if (!surface) return
    setInspectors((current) => current.some((entry) => entry.kind === surface.kind && entry.identity === surface.identity)
      ? current
      : [...current, surface])
    setSpace((current) => {
      if (current.activeWindowId !== surface.id) {
        inspectorReturnWindowRef.current.set(surface.id, current.activeWindowId)
      }
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      const existing = current.inspectorWindows[surface.id]
      return {
        ...current,
        activeWindowId: surface.id,
        inspectorWindows: {
          ...current.inspectorWindows,
          [surface.id]: existing
            ? { ...existing, minimized: false, z: highest + 1 }
            : { x: 104, y: 72, width: 560, height: 480, z: highest + 1, minimized: false },
        },
      }
    })
  }, [judgment])

  const dismissInspector = useCallback((id: string) => {
    const previewId = inspectorId({ kind: "preview-evidence", subject: PREVIEW_EVIDENCE_SUBJECT })
    if (id === previewId) {
      previewEvidenceRequestRef.current += 1
      previewExplainEvidenceRef.current = null
      const currentWorld = worldRef.current
      const currentProject = projectRef.current?.identity
      if (currentWorld && currentProject) removePreviewEvidenceSnapshot(currentWorld, currentProject)
    }
    setInspectors((current) => current.filter((surface) => surface.id !== id))
    setSpace((current) => {
      const inspectorWindows = { ...current.inspectorWindows }
      const inspectorSeeds = { ...current.inspectorSeeds }
      delete inspectorWindows[id]
      delete inspectorSeeds[id]
      const returnWindow = inspectorReturnWindowRef.current.get(id)
      inspectorReturnWindowRef.current.delete(id)
      const canRestore = returnWindow === null
        || returnWindow !== undefined && (returnWindow in current.windows || returnWindow in inspectorWindows)
      return {
        ...current,
        inspectorWindows,
        inspectorSeeds,
        activeWindowId: current.activeWindowId === id ? canRestore ? returnWindow ?? null : null : current.activeWindowId,
      }
    })
  }, [])

  const updateWindow = useCallback((id: WindowId, geometry: WindowGeometry) => {
    setSpace((current) => ({ ...current, windows: { ...current.windows, [id]: geometry } }))
  }, [])

  const activate = useCallback((id: WindowId) => {
    setFocusedAgentId(null)
    setSpace((current) => {
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      const chosen = current.windows[id]
      if (current.activeWindowId === id && chosen.z === highest && !chosen.minimized) return current
      return {
        ...current,
        activeWindowId: id,
        windows: { ...current.windows, [id]: { ...chosen, minimized: false, z: highest + 1 } },
      }
    })
  }, [])

  const minimize = useCallback((id: WindowId) => {
    setSpace((current) => ({
      ...current,
      activeWindowId: current.activeWindowId === id ? null : current.activeWindowId,
      windows: { ...current.windows, [id]: { ...current.windows[id], minimized: true } },
    }))
  }, [])

  const updateInspector = useCallback((id: string, geometry: WindowGeometry) => {
    setSpace((current) => ({ ...current, inspectorWindows: { ...current.inspectorWindows, [id]: geometry } }))
  }, [])

  const activateInspector = useCallback((id: string) => {
    setSpace((current) => {
      const chosen = current.inspectorWindows[id]
      if (!chosen) return current
      const highest = Math.max(
        ...Object.values(current.windows).map((window) => window.z),
        ...Object.values(current.inspectorWindows).map((window) => window.z),
      )
      return {
        ...current,
        activeWindowId: id,
        inspectorWindows: { ...current.inspectorWindows, [id]: { ...chosen, minimized: false, z: highest + 1 } },
      }
    })
  }, [])

  const openLine = useCallback((prompt = "", target: LineTarget = "william", context: LineContext = null) => {
    agentPresentationEpochRef.current += 1
    setLineTarget(target)
    setLineContext(context)
    setAgentWorkReview(false)
    setForkContext(null)
    if (target === "william") setDelegateContext(null)
    setLineMode("default")
    setLineInput(prompt)
    setLineReply(null)
    setLineTerminalPresentation(null)
    setLineTargetPickerOpen(target === "william" && !prompt && context === null)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [])

  const onSelectedFileDirtyChange = useCallback((path: string, dirty: boolean) => {
    setDirtyPaths((current) => {
      const next = current[path] === dirty ? current : { ...current, [path]: dirty }
      dirtyPathsRef.current = next
      return next
    })
  }, [])

  const settleChangeRefresh = useCallback((surface: "editor" | "diff", path: string, key: number, result: ChangeRefreshResult | "failed") => {
    const waiter = changeRefreshWaiters.current.get(key)
    if (!waiter || waiter.path !== path) return
    if (surface === "editor") waiter.editor = result as ChangeRefreshResult
    else waiter.diff = result === "refreshed" ? "refreshed" : "failed"
    if (!waiter.editor || !waiter.diff) return
    changeRefreshWaiters.current.delete(key)
    setChangeRefresh((current) => current.key === key ? { path: null, key } : current)
    waiter.resolve(waiter.editor === "dirty-conflict" ? "dirty-conflict" : waiter.editor === "refreshed" && waiter.diff === "refreshed" ? "refreshed" : "failed")
  }, [])

  const refreshVerifiedChange = useCallback((path: string) => new Promise<ChangeRefreshResult>((resolve) => {
    const key = changeRefreshKey.current + 1
    changeRefreshKey.current = key
    changeRefreshWaiters.current.set(key, { path, resolve })
    setChangeRefresh({ path, key })
    activate("editor")
    activate("diff")
  }), [activate])

  const isChangeScopeCurrent = useCallback((scope: ChangeOperationScope) => (
    worldRef.current === scope.worldId && transitionEpochRef.current === scope.transitionEpoch
  ), [])

  const change = useSelectedFileChange({
    worldId,
    projectKey,
    path: changeTarget,
    fileRef: changeFileRef,
    dirty: Boolean(changeTarget && dirtyPaths[changeTarget]),
    onVerifiedSuccess: refreshVerifiedChange,
    isOperationScopeCurrent: isChangeScopeCurrent,
  })
  const sourceMinimizeDisabledReason = change.running
    ? "Source cannot be minimized while Change is active"
    : Object.values(dirtyPaths).some(Boolean)
      ? "Source cannot be minimized while it has unsaved changes"
      : undefined

  const openChange = useCallback(() => {
    if (change.running || review.running) return
    const target = space.selectedPath
    const fileRef = space.selectedFileRef?.path === target ? space.selectedFileRef : null
    setChangeIntent("change")
    setCapturedDiffImprove(null)
    setCapturedDiffReview(null)
    setChangeTarget(target)
    setChangeFileRef(fileRef)
    change.reset(target)
    setLineTarget("william")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("change")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [change.reset, change.running, review.running, space.selectedFileRef, space.selectedPath])

  const openDiffImprove = useCallback(() => {
    if (change.running || review.running || storage !== "server" || persistencePending || persistenceError
      || !worldId || !space.selectedPath || space.activeWindowId !== "diff"
      || dirtyPaths[space.selectedPath] || !liveDiffContext || liveDiffContext.worldId !== worldId
      || liveDiffContext.path !== space.selectedPath || !space.selectedFileRef
      || space.selectedFileRef.path !== space.selectedPath) return
    const captured = {
      path: liveDiffContext.path,
      fileRef: space.selectedFileRef,
      fingerprint: liveDiffContext.fingerprint,
      worldId,
      transitionEpoch: transitionEpochRef.current,
    }
    setChangeIntent("improve-diff")
    setCapturedDiffImprove(captured)
    setChangeTarget(captured.path)
    setChangeFileRef(captured.fileRef)
    change.reset(captured.path)
    setLineTarget("william")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("change")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [change.reset, change.running, dirtyPaths, liveDiffContext, persistenceError, persistencePending, review.running, space.activeWindowId, space.selectedFileRef, space.selectedPath, storage, worldId])

  const openDiffReview = useCallback(() => {
    if (change.running || review.running || storage !== "server" || persistencePending || persistenceError
      || !worldId || !space.selectedPath || space.activeWindowId !== "diff"
      || dirtyPaths[space.selectedPath] || !liveDiffContext || liveDiffContext.worldId !== worldId
      || liveDiffContext.path !== space.selectedPath || !space.selectedFileRef
      || space.selectedFileRef.path !== space.selectedPath) return
    const captured = {
      path: liveDiffContext.path,
      fileRef: space.selectedFileRef,
      fingerprint: liveDiffContext.fingerprint,
      worldId,
      transitionEpoch: transitionEpochRef.current,
    }
    const reviewIdentityIsCurrent = () => {
      const current = stateRef.current
      const live = liveDiffContextRef.current
      return Boolean(worldRef.current === captured.worldId
        && transitionEpochRef.current === captured.transitionEpoch
        && storageRef.current === "server"
        && current.activeWindowId === "diff" && current.selectedPath === captured.path
        && JSON.stringify(current.selectedFileRef) === JSON.stringify(captured.fileRef)
        && !dirtyPathsRef.current[captured.path]
        && live?.worldId === captured.worldId && live.path === captured.path
        && live.fingerprint === captured.fingerprint
        && !persistenceErrorRef.current)
    }
    setCapturedDiffReview(captured)
    setAgentWorkReview(true)
    setCapturedDiffImprove(null)
    setReviewTarget(captured.path)
    setReviewFileRef(captured.fileRef)
    review.reset(captured.path)
    setLineTarget("agent")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("review")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    void review.startCapturedDiff({
      worldId: captured.worldId,
      path: captured.path,
      fileRef: captured.fileRef,
      fingerprint: captured.fingerprint,
      isCurrent: reviewIdentityIsCurrent,
      beforeStart: async () => {
        await persistBarrierRef.current()
        if (!reviewIdentityIsCurrent()) throw new Error("DIFF_CONTEXT_STALE")
      },
    })
  }, [change.running, dirtyPaths, liveDiffContext, persistenceError, persistencePending, review.reset, review.running, review.startCapturedDiff, space.activeWindowId, space.selectedFileRef, space.selectedPath, storage, worldId])

  const openReview = useCallback(() => {
    const target = space.selectedPath
    const fileRef = space.selectedFileRef?.path === target ? space.selectedFileRef : null
    if (change.running || review.running) {
      setTransitionMessage("Finish the active Change or Review before reviewing another file.")
      return
    }
    if (!worldId || !fileRef || !isReviewableWorkspacePath(target) || dirtyPaths[target] || persistenceError) {
      setTransitionMessage(dirtyPaths[target ?? ""]
        ? "Save the selected file before Review so Claude does not inspect stale disk content."
        : "Review needs an exact durably saved workspace-relative file in the active Space.")
      return
    }
    const capturedWorldId = worldId
    const capturedEpoch = transitionEpochRef.current
    setCapturedDiffReview(null)
    setAgentWorkReview(true)
    setReviewTarget(target)
    setReviewFileRef(fileRef)
    review.reset(target)
    setLineTarget("agent")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("review")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    void review.startCapturedPath({
      path: target,
      fileRef,
      isStartCurrent: () => worldRef.current === capturedWorldId
        && transitionEpochRef.current === capturedEpoch
        && stateRef.current.selectedPath === target
        && JSON.stringify(stateRef.current.selectedFileRef) === JSON.stringify(fileRef)
        && !dirtyPathsRef.current[target]
        && !persistenceErrorRef.current,
      isPresentationCurrent: () => worldRef.current === capturedWorldId
        && transitionEpochRef.current === capturedEpoch,
    })
  }, [change.running, dirtyPaths, persistenceError, review.reset, review.running, review.startCapturedPath, space.selectedFileRef, space.selectedPath, worldId])

  const openAgentWorkReview = useCallback((sessionKey: string, target: string) => {
    if (change.running || review.running) {
      setTransitionMessage("Finish the active Change or Review before reviewing another agent's work.")
      return
    }
    const capturedWorldId = worldId
    const capturedEpoch = transitionEpochRef.current
    const descriptor = agentSessions.savedSessions.find((candidate) => lineSessionKey(candidate.provider, candidate.sessionId) === sessionKey)
    if (!capturedWorldId || !descriptor || (descriptor.provider !== "Codex" && descriptor.provider !== "Claude")
      || !project || !descriptor.repository || descriptor.target?.path !== target || agentSessions.collectionState !== "available"
      || agentSessions.selectedSessionKey !== sessionKey || focusedAgentId !== sessionKey) {
      setTransitionMessage("That durable agent no longer has an exact reviewable file target in this Space.")
      return
    }
    const fileRef: WorkspaceFileRef = {
      projectIdentity: project.identity,
      repositoryResourceKey: descriptor.repository.resourceKey,
      repositoryMountKey: descriptor.repository.mountKey,
      worktreeKey: null,
      observedRevision: descriptor.repository.observedRevision,
      path: target,
    }
    const descriptorFingerprint = lineSessionDescriptorFingerprint(descriptor)
    const collectionFingerprint = lineSessionCollectionFingerprint(agentSessions.savedSessions)
    const isStartCurrent = () => {
      const exact = agentSavedSessionsRef.current.find((candidate) => lineSessionKey(candidate.provider, candidate.sessionId) === sessionKey)
      return worldRef.current === capturedWorldId
        && transitionEpochRef.current === capturedEpoch
        && agentCollectionStateRef.current === "available"
        && agentSelectedSessionKeyRef.current === sessionKey
        && focusedAgentIdRef.current === sessionKey
        && exact?.target?.path === target
        && exact.repository?.resourceKey === fileRef.repositoryResourceKey
        && exact.repository.mountKey === fileRef.repositoryMountKey
        && exact.repository.observedRevision === fileRef.observedRevision
        && lineSessionDescriptorFingerprint(exact) === descriptorFingerprint
        && lineSessionCollectionFingerprint(agentSavedSessionsRef.current) === collectionFingerprint
    }
    setCapturedDiffReview(null)
    setAgentWorkReview(true)
    setReviewTarget(target)
    setReviewFileRef(fileRef)
    review.reset(target)
    setLineTarget("agent")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("review")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    void review.startCapturedPath({
      path: target,
      fileRef,
      isStartCurrent,
      isPresentationCurrent: () => worldRef.current === capturedWorldId && transitionEpochRef.current === capturedEpoch,
    })
  }, [agentSessions.collectionState, agentSessions.savedSessions, agentSessions.selectedSessionKey, change.running, focusedAgentId, project, review.reset, review.running, review.startCapturedPath, worldId])

  useEffect(() => {
    const summonLine = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        if (!change.running && !review.running) {
          setLineTarget("william")
          setLineContext(null)
          setDelegateContext(null)
          setForkContext(null)
          setLineMode("default")
          setLineReply(null)
          setLineTargetPickerOpen(true)
          agentPresentationEpochRef.current += 1
          setLineBusy(false)
        }
        setLineOpen(true)
        requestAnimationFrame(() => lineRef.current?.focus())
      } else if (event.key === "Escape" && !change.running && !review.running) {
        if (lineTarget === "agent") {
          agentPresentationEpochRef.current += 1
          setLineBusy(false)
        }
        setLineOpen(false)
      }
    }
    window.addEventListener("keydown", summonLine)
    return () => window.removeEventListener("keydown", summonLine)
  }, [change.running, lineTarget, review.running])

  function invalidateCouncilView() {
    councilViewEpochRef.current += 1
  }

  function dismissCouncil() {
    invalidateCouncilView()
    setCouncilBusy(false)
    setOverlay(null)
  }

  function selectCouncilHistory(session: BrainCouncilSession) {
    invalidateCouncilView()
    councilSessionRef.current = session
    setCouncilBusy(false)
    setCouncilError(null)
    setCouncilSession(session)
    setCouncilHistorical(true)
  }

  async function summonCouncil(question: string) {
    invalidateCouncilView()
    const requestCouncilViewEpoch = councilViewEpochRef.current
    const requestWorldId = worldId
    const requestWorkOrderId = spine.workOrderId
    const requestTransitionEpoch = transitionEpochRef.current
    const requestIsCurrent = () => (
      councilViewEpochRef.current === requestCouncilViewEpoch
      && worldRef.current === requestWorldId
      && spineRef.current.workOrderId === requestWorkOrderId
      && transitionEpochRef.current === requestTransitionEpoch
    )
    setCouncilView("convening")
    setCouncilQuestion(question)
    setCouncilSession(null)
    setCouncilHistorical(false)
    setCouncilError(null)
    setCouncilBusy(true)
    setOverlay("council")
    if (!requestWorldId) {
      setCouncilError("Council needs an open persistent Space.")
      setCouncilBusy(false)
      return
    }
    const selectedDurableDescriptor = selectedAgent?.kind === "durable-session"
      ? agentSessions.savedSessions.find((descriptor) => lineSessionKey(descriptor.provider, descriptor.sessionId) === selectedAgent.id) ?? null
      : null
    const snapshotDescriptorFingerprint = selectedDurableDescriptor
      ? lineSessionDescriptorFingerprint(selectedDurableDescriptor)
      : null
    const snapshotCollectionFingerprint = selectedDurableDescriptor
      ? lineSessionCollectionFingerprint(agentSessions.savedSessions)
      : null
    const councilSelectedContext = selectedAgent?.kind === "durable-session"
      ? selectedDurableDescriptor && agentSessions.collectionState === "available"
        && agentSessions.selectedSessionKey === selectedAgent.id
        ? await durableCouncilSnapshot(selectedAgent.id, selectedDurableDescriptor, new Date().toISOString())
        : null
      : selectedAgent?.kind === "world-worker"
      ? boundExecutionSession?.id === selectedAgent.id
        ? { kind: "agent" as const, workOrderId: boundExecutionSession.workOrderId }
        : null
      : { kind: selectedKind, label: selectedLabel }
    if (!councilSelectedContext) {
      setCouncilError("That persisted assignment is no longer bound to this Space.")
      setCouncilBusy(false)
      return
    }
    try {
      await persistBarrierRef.current()
      if (!requestIsCurrent()) return
      if (councilSelectedContext.kind === "agent-snapshot") {
        const exactDescriptor = agentSavedSessionsRef.current.find(
          (descriptor) => lineSessionKey(descriptor.provider, descriptor.sessionId) === councilSelectedContext.sessionKey,
        )
        if (agentSelectedSessionKeyRef.current !== councilSelectedContext.sessionKey
          || !exactDescriptor
          || lineSessionDescriptorFingerprint(exactDescriptor) !== snapshotDescriptorFingerprint
          || lineSessionCollectionFingerprint(agentSavedSessionsRef.current) !== snapshotCollectionFingerprint) {
          setCouncilError("The selected browser-saved session changed before Council dispatch, so no advice was requested.")
          return
        }
      }
      const response = await fetch("/api/environment/council", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worldId: requestWorldId,
          question,
          selectedContext: councilSelectedContext,
        }),
        cache: "no-store",
      })
      const payload = await response.json() as { error?: string; detail?: string; session?: BrainCouncilSession }
      if (!requestIsCurrent()) return
      if (!response.ok || !payload.session) throw new Error(payload.detail ?? payload.error ?? `COUNCIL_${response.status}`)
      setCouncilSession(payload.session)
      setCouncilHistory((current) => [...current.filter((entry) => entry.id !== payload.session!.id), payload.session!].slice(-6))
    } catch (error) {
      if (requestIsCurrent()) setCouncilError(error instanceof Error ? error.message : "Council inference is unavailable.")
    } finally {
      if (requestIsCurrent()) setCouncilBusy(false)
    }
  }

  async function openCouncilHistory() {
    invalidateCouncilView()
    setCouncilView("history")
    setOverlay("council")
    setCouncilSession(null)
    setCouncilHistorical(false)
    setCouncilQuestion(null)
    setCouncilError(null)
    if (!worldId || storage !== "server") {
      setCouncilError("Saved Council history needs an open persistent server Space.")
      return
    }
    setCouncilBusy(true)
    try {
      const response = await fetch(`/api/environment/council?worldId=${encodeURIComponent(worldId)}`, { cache: "no-store" })
      const payload = await response.json() as { error?: string; history?: readonly BrainCouncilSession[] }
      if (!response.ok || !payload.history) throw new Error(payload.error ?? `COUNCIL_HISTORY_${response.status}`)
      setCouncilHistory(payload.history)
    } catch (error) {
      setCouncilError(error instanceof Error ? error.message : "Saved Council history is unavailable.")
    } finally {
      setCouncilBusy(false)
    }
  }

  continuationSyncRef.current = async (continuation) => {
    if (continuation.status === "NEXT_ASSIGNMENT" && continuation.selectedPath) {
      await refreshPersistedSpaceSelection(continuation.selectedPath)
    }
  }

  const agentSnapshotLineContextIsCurrent = useCallback((context: AgentSnapshotLineContext): boolean => {
    const exactDescriptor = agentSavedSessionsRef.current.find(
      (descriptor) => lineSessionKey(descriptor.provider, descriptor.sessionId) === context.sessionKey,
    )
    return worldRef.current === context.clientGuard.worldId
      && transitionEpochRef.current === context.clientGuard.transitionEpoch
      && agentCollectionStateRef.current === "available"
      && agentSelectedSessionKeyRef.current === context.sessionKey
      && focusedAgentIdRef.current === context.sessionKey
      && exactDescriptor !== undefined
      && lineSessionDescriptorFingerprint(exactDescriptor) === context.clientGuard.descriptorFingerprint
      && lineSessionCollectionFingerprint(agentSavedSessionsRef.current) === context.clientGuard.collectionFingerprint
  }, [])

  const diffChallengeLineContextIsCurrent = useCallback((context: DiffChallengeLineContext): boolean => {
    const current = stateRef.current
    const live = liveDiffContextRef.current
    return worldRef.current === context.clientGuard.worldId
      && transitionEpochRef.current === context.clientGuard.transitionEpoch
      && context.projectKey === projectKey
      && storageRef.current === "server"
      && !persistenceErrorRef.current
      && current.activeWindowId === "diff"
      && current.selectedPath === context.path
      && !dirtyPathsRef.current[context.path]
      && live?.worldId === context.clientGuard.worldId
      && live.path === context.path
      && live.fingerprint === context.fingerprint
  }, [projectKey])

  const previewExplainLineContextIsCurrent = useCallback((context: PreviewExplainLineContext): boolean => {
    const current = stateRef.current
    const currentProject = projectRef.current
    const capturedEvidence = previewExplainEvidenceRef.current
    return worldRef.current === context.clientGuard.worldId
      && transitionEpochRef.current === context.clientGuard.transitionEpoch
      && context.projectKey === projectKey
      && previewEvidenceRequestRef.current === context.clientGuard.requestId
      && storageRef.current === "server"
      && !persistenceErrorRef.current
      && currentProject?.identity === context.clientGuard.projectIdentity
      && current.activeWindowId === "running-app"
      && current.runningAppUrl === context.clientGuard.runningAppUrl
      && current.selectedPath === context.selectedPath
      && !dirtyPathsRef.current[context.selectedPath]
      && capturedEvidence?.worldId === context.clientGuard.worldId
      && capturedEvidence.transitionEpoch === context.clientGuard.transitionEpoch
      && capturedEvidence.requestId === context.clientGuard.requestId
      && capturedEvidence.projectIdentity === context.clientGuard.projectIdentity
      && capturedEvidence.payload.evidence.fingerprint === context.previewFingerprint
      && capturedEvidence.payload.evidence.status === context.clientGuard.status
      && capturedEvidence.payload.evidence.identity === context.clientGuard.identity
      && capturedEvidence.payload.evidence.origin === context.clientGuard.origin
  }, [projectKey])

  const fileAskLineContextIsCurrent = useCallback((context: FileAskLineContext): boolean => {
    const current = stateRef.current
    const pane = current.editor.panes.find((candidate) => candidate.id === current.editor.activePaneId) ?? null
    return worldRef.current === context.clientGuard.worldId
      && transitionEpochRef.current === context.clientGuard.transitionEpoch
      && context.projectKey === projectKey
      && storageRef.current === "server"
      && !persistenceErrorRef.current
      && projectRef.current?.identity === context.projectIdentity
      && current.revision === context.revision
      && current.activeWindowId === "editor"
      && current.selectedPath === context.path
      && !dirtyPathsRef.current[context.path]
      && current.editor.activePaneId === context.activePaneId
      && pane?.activePath === context.path
      && pane?.selection?.anchor === context.selection.anchor
      && pane?.selection?.head === context.selection.head
  }, [projectKey])

  const toolRunSnapshotsLineContextIsCurrent = useCallback((context: ToolRunSnapshotsLineContext): boolean => {
    if (worldRef.current !== context.clientGuard.worldId
      || transitionEpochRef.current !== context.clientGuard.transitionEpoch
      || storageRef.current !== "server"
      || persistenceErrorRef.current) return false
    const currentScope = `server:${context.clientGuard.worldId}`
    if (currentScope !== context.clientGuard.scope) return false
    try {
      return captureToolRunSnapshots(
        window.localStorage,
        currentScope,
        context.clientGuard.worldId,
        context.clientGuard.transitionEpoch,
      )?.clientGuard.fingerprint === context.clientGuard.fingerprint
    } catch {
      return false
    }
  }, [])

  const sendWilliamTurn = useCallback(async (
    text: string,
    context: LineContext = null,
    includeBrowserToolRuns = false,
  ): Promise<boolean> => {
    const normalized = text.trim()
    if (!normalized || lineBusy || williamBusy) return false
    if (!hydratedRef.current || !worldRef.current) {
      const unavailable = "William is waiting for the active Space to finish loading."
      setLineReply(unavailable)
      setWilliamError(unavailable)
      return false
    }
    if (context && typeof context === "object" && context.kind === "agent-snapshot"
      && !agentSnapshotLineContextIsCurrent(context)) {
      const stale = "The selected browser-saved session changed before William dispatch, so no advice was requested."
      setLineReply(stale)
      setWilliamError(stale)
      return false
    }
    if (context && typeof context === "object" && context.kind === "diff-challenge"
      && (!diffChallengeLineContextIsCurrent(context) || persistencePendingRef.current)) {
      const stale = "The exact current patch changed before William could challenge it, so no advice was requested."
      setLineReply(stale)
      setWilliamError(stale)
      return false
    }
    if (context && typeof context === "object" && context.kind === "preview-explain"
      && (!previewExplainLineContextIsCurrent(context) || persistencePendingRef.current)) {
      const stale = "The exact developer Preview context changed before William could explain it, so no advice was requested."
      setLineReply(stale)
      setWilliamError(stale)
      return false
    }
    if (context && typeof context === "object" && context.kind === "file-ask"
      && (!fileAskLineContextIsCurrent(context) || persistencePendingRef.current)) {
      const stale = "The exact saved file selection changed before William dispatch, so no advice was requested."
      setLineReply(stale)
      setWilliamError(stale)
      return false
    }
    appendConversation("owner", normalized)
    setLineBusy(true)
    setLineReply(null)
    setLineTerminalPresentation(null)
    setWilliamBusy(true)
    setWilliamError(null)
    const requestWorldId = worldRef.current
    const requestEpoch = transitionEpochRef.current
    const selectedContextFingerprint = () => {
      const current = stateRef.current
      const activePane = current.editor.panes.find((pane) => pane.id === current.editor.activePaneId) ?? null
      return JSON.stringify({
        activeWindowId: current.activeWindowId,
        selectedPath: current.selectedPath,
        activePaneId: current.editor.activePaneId,
        activePath: activePane?.activePath ?? null,
        selection: activePane?.selection ?? null,
        focusedAgentId,
      })
    }
    const requestContext = selectedContextFingerprint()
    const requestIsCurrent = () => worldRef.current === requestWorldId
      && transitionEpochRef.current === requestEpoch
      && selectedContextFingerprint() === requestContext
    try {
      await persistBarrierRef.current()
      const effectiveContext = context ?? (includeBrowserToolRuns && shouldAttachToolRunSnapshots(normalized) && requestWorldId && storageRef.current === "server"
        ? captureToolRunSnapshots(window.localStorage, `server:${requestWorldId}`, requestWorldId, requestEpoch)
        : null)
      if (context && typeof context === "object" && context.kind === "agent-snapshot"
        && !agentSnapshotLineContextIsCurrent(context)) {
        const stale = "The selected browser-saved session changed before William dispatch, so no advice was requested."
        setLineReply(stale)
        setWilliamError(stale)
        return false
      }
      if (context && typeof context === "object" && context.kind === "diff-challenge"
        && !diffChallengeLineContextIsCurrent(context)) {
        const stale = "The exact current patch changed before William could challenge it, so no advice was requested."
        setLineReply(stale)
        setWilliamError(stale)
        return false
      }
      if (context && typeof context === "object" && context.kind === "preview-explain"
        && !previewExplainLineContextIsCurrent(context)) {
        const stale = "The exact developer Preview context changed before William could explain it, so no advice was requested."
        setLineReply(stale)
        setWilliamError(stale)
        return false
      }
      if (context && typeof context === "object" && context.kind === "file-ask"
        && !fileAskLineContextIsCurrent(context)) {
        const stale = "The exact saved file selection changed before William dispatch, so no advice was requested."
        setLineReply(stale)
        setWilliamError(stale)
        return false
      }
      if (effectiveContext && typeof effectiveContext === "object" && effectiveContext.kind === "tool-run-snapshots"
        && !toolRunSnapshotsLineContextIsCurrent(effectiveContext)) {
        const stale = "The saved tool results changed before William dispatch, so no advice was requested."
        setLineReply(stale)
        setWilliamError(stale)
        return false
      }
      if (!requestIsCurrent()) throw new Error("WILLIAM_CONTEXT_CHANGED")
      const serverContext = effectiveContext && typeof effectiveContext === "object" && (effectiveContext.kind === "agent-snapshot" || effectiveContext.kind === "diff-challenge" || effectiveContext.kind === "preview-explain" || effectiveContext.kind === "file-ask" || effectiveContext.kind === "tool-run-snapshots")
        ? Object.fromEntries(Object.entries(effectiveContext).filter(([key]) => key !== "clientGuard"))
        : effectiveContext
      const response = await fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId: requestWorldId, projectKey, text: normalized, ...(serverContext ? { lineContext: serverContext } : {}) }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? `LINE_${response.status}`)
      if (context && typeof context === "object" && context.kind === "preview-explain"
        && !previewExplainLineContextIsCurrent(context)) {
        throw new Error("LINE_CONTEXT_STALE")
      }
      if (context && typeof context === "object" && context.kind === "file-ask"
        && !fileAskLineContextIsCurrent(context)) {
        throw new Error("LINE_CONTEXT_STALE")
      }
      if (effectiveContext && typeof effectiveContext === "object" && effectiveContext.kind === "tool-run-snapshots"
        && !toolRunSnapshotsLineContextIsCurrent(effectiveContext)) {
        throw new Error("LINE_CONTEXT_STALE")
      }
      if (!requestIsCurrent()) throw new Error("WILLIAM_CONTEXT_CHANGED")
      if (context && typeof context === "object" && context.kind === "diff-challenge"
        && !diffChallengeLineContextIsCurrent(context)) {
        throw new Error("LINE_CONTEXT_STALE")
      }
      acceptLineReply(payload as LineReply)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : "LINE_UNAVAILABLE"
      setLineReply(message)
      setWilliamError(message)
      return false
    } finally {
      setLineBusy(false)
      setWilliamBusy(false)
    }
  }, [acceptLineReply, agentSessions.sessions, agentSnapshotLineContextIsCurrent, appendConversation, diffChallengeLineContextIsCurrent, fileAskLineContextIsCurrent, focusedAgentId, lineBusy, previewExplainLineContextIsCurrent, projectKey, toolRunSnapshotsLineContextIsCurrent, williamBusy])

  const reviewerAgentContext = delegateContext?.kind === "reviewer" ? delegateContext : null

  useEffect(() => {
    previewDebugStopRef.current = agentSessions.stop
  }, [agentSessions.stop])

  useEffect(() => () => {
    previewDebugStopRequestedRef.current = true
    const key = previewDebugSessionKeyRef.current
    if (key) previewDebugStopRef.current(key)
    else previewDebugStopRef.current()
  }, [])

  function stopAutomaticPreviewDebug() {
    previewDebugStopRequestedRef.current = true
    setAutomaticPreviewDebugPending(false)
    setLineBusy(false)
    const acceptedKey = previewDebugSessionKeyRef.current
    if (acceptedKey) {
      agentSessions.stop(acceptedKey)
    } else {
      const pendingPreviewTurns = agentSessions.activeTurns.filter((turn) => (
        turn.provider === "Claude" && turn.role === "Preview debugger" && turn.sessionId === null
      ))
      if (pendingPreviewTurns.length === 1) agentSessions.stop(pendingPreviewTurns[0].id)
    }
    setLineReply("Stop requested. Preview Debug outcome is unknown.")
  }

  function stopAutomaticSpaceContinue() {
    setAutomaticSpaceContinuePending(false)
    const sessionKey = automaticSpaceContinueSessionKeyRef.current
    if (sessionKey && agentSessions.activeSessionIds.includes(sessionKey)) {
      agentSessions.stop(sessionKey)
    } else if (automaticSpaceContinueOperationIdRef.current) {
      agentSessions.stop(automaticSpaceContinueOperationIdRef.current)
    }
    setLineReply("Stop requested. Session continuation outcome is unknown.")
  }

  async function submitLine(event: React.FormEvent | null, suppliedText?: string) {
    event?.preventDefault()
    if (lineContext === "space-summary" || lineMode === "review" && agentWorkReview) return
    const text = (suppliedText ?? lineInput).trim()
    if (lineBusy || change.running || lineMode === "review" && review.running || lineMode !== "review" && !text
      || lineTarget === "agent" && lineMode === "default" && !delegateContext?.provider) return
    if (lineMode === "change") {
      if (changeIntent === "improve-diff") {
        const captured = capturedDiffImprove
        if (!captured) {
          change.refuse("The live change changed. Reopen Improve from the current Changes surface.")
          return
        }
        const improveIdentityIsCurrent = () => {
          const current = stateRef.current
          const live = liveDiffContextRef.current
          return Boolean(worldRef.current === captured.worldId
            && transitionEpochRef.current === captured.transitionEpoch
            && storageRef.current === "server"
            && current.activeWindowId === "diff" && current.selectedPath === captured.path
            && JSON.stringify(current.selectedFileRef) === JSON.stringify(captured.fileRef)
            && !dirtyPathsRef.current[captured.path]
            && live?.worldId === captured.worldId
            && live.path === captured.path
            && live.fingerprint === captured.fingerprint)
        }
        if (!improveIdentityIsCurrent() || persistencePendingRef.current || persistenceErrorRef.current) {
          change.refuse("The live change changed. Reopen Improve from the current Changes surface.")
          return
        }
        void change.start(text, {
          intent: "improve-diff",
          worldId: captured.worldId,
          expectedDiffFingerprint: captured.fingerprint,
        }, storageRef.current === "server" ? async () => {
          await persistBarrierRef.current()
          if (!improveIdentityIsCurrent() || persistenceErrorRef.current) throw new Error("DIFF_CONTEXT_STALE")
        } : undefined, {
          worldId: captured.worldId,
          transitionEpoch: captured.transitionEpoch,
        })
        return
      }
      void change.start(text)
      return
    }
    if (lineMode === "review") {
      const captured = capturedDiffReview
      if (!captured) {
        void review.start(text)
        return
      }
      const reviewIdentityIsCurrent = () => {
        const current = stateRef.current
        const live = liveDiffContextRef.current
        return Boolean(worldRef.current === captured.worldId
          && transitionEpochRef.current === captured.transitionEpoch
          && storageRef.current === "server"
          && current.activeWindowId === "diff" && current.selectedPath === captured.path
          && !dirtyPathsRef.current[captured.path]
          && (!live || live.worldId === captured.worldId && live.path === captured.path
            && live.fingerprint === captured.fingerprint)
          && !persistenceErrorRef.current)
      }
      if (!reviewIdentityIsCurrent()) {
        review.reset(captured.path)
        setLineReply("The live change changed. Reopen Review from the current Changes surface.")
        return
      }
      void review.start(text, {
        worldId: captured.worldId,
        path: captured.path,
        fileRef: captured.fileRef,
        fingerprint: captured.fingerprint,
        isCurrent: reviewIdentityIsCurrent,
        beforeStart: async () => {
          await persistBarrierRef.current()
          if (!reviewIdentityIsCurrent()) throw new Error("DIFF_CONTEXT_STALE")
        },
      })
      return
    }
    setLineInput("")
    const councilRequest = lineTarget === "william" ? text.match(/^\/?council\b[\s:—-]*(.*)$/i) : null
    if (councilRequest) {
      appendConversation("owner", text)
      void summonCouncil(councilRequest[1]?.trim() || `Challenge the current direction for ${selectedLabel}.`)
      setLineOpen(false)
      return
    }
    setLineBusy(true)
    setLineReply(null)
    setLineTerminalPresentation(null)
    setLineTerminalWarning(null)
    let agentPresentationIsCurrent: (() => boolean) | null = null
    let agentTerminalTruthIsCurrent: (() => boolean) | null = null
    let resumeDispatchKey: string | null = null
    try {
      const contextualText = lineTarget === "agent" && delegateContext
        ? `Owner request: ${text}`
        : `Selected ${selectedKind}: ${selectedLabel}\nOwner request: ${text}`
      if (lineTarget === "agent") {
        const previewDebugContextIsCurrent = () => {
          if (delegateContext?.kind !== "preview" || !delegateContext.previewDebugBinding) return true
          const binding = delegateContext.previewDebugBinding
          const current = stateRef.current
          return worldRef.current === binding.worldId
            && transitionEpochRef.current === binding.transitionEpoch
            && current.revision === binding.revision
            && acknowledgedRevisionRef.current === binding.revision
            && current.runningAppUrl === binding.runningAppUrl
            && projectRef.current?.identity === binding.projectIdentity
            && current.activeWindowId === "running-app"
            && !current.windows["running-app"].minimized
        }
        const fileAssignmentContextIsCurrent = () => {
          if (delegateContext?.kind !== "file" || !delegateContext.fileAssignmentBinding) return true
          return exactFileAssignmentBindingIsCurrent(delegateContext.fileAssignmentBinding)
        }
        const spaceContinueContextIsCurrent = () => {
          if (delegateContext?.kind !== "continue") return true
          const exactDescriptor = agentSavedSessionsRef.current.find((candidate) => (
            lineSessionKey(candidate.provider, candidate.sessionId) === delegateContext.sessionKey
          ))
          return worldRef.current === delegateContext.worldId
            && transitionEpochRef.current === delegateContext.transitionEpoch
            && agentCollectionStateRef.current === "available"
            && agentSelectedSessionKeyRef.current === delegateContext.sessionKey
            && Boolean(exactDescriptor)
            && lineSessionDescriptorFingerprint(exactDescriptor) === delegateContext.descriptorFingerprint
            && lineSessionCollectionFingerprint(agentSavedSessionsRef.current) === delegateContext.collectionFingerprint
            && delegateContext.objectBinding.kind === "space"
            && delegateContext.objectBinding.worldId === worldRef.current
            && delegateContext.objectBinding.revision === stateRef.current.revision
        }
        if (delegateContext?.kind === "preview" && delegateContext.previewDebugBinding && !automaticPreviewDebugRunning) {
          if (!previewDebugContextIsCurrent() || persistencePendingRef.current
            || persistenceErrorRef.current || agentActiveTurnsRef.current.length !== 0) {
            throw new Error("PREVIEW_DEBUG_CONTEXT_STALE")
          }
        }
        if (delegateContext?.kind === "file" && delegateContext.fileAssignmentBinding) {
          if (!fileAssignmentContextIsCurrent() || persistencePendingRef.current) {
            throw new Error("FILE_ASSIGNMENT_CONTEXT_STALE")
          }
        }
        if (!spaceContinueContextIsCurrent()) throw new Error("AGENT_CONTINUE_SESSION_STALE")
        appendConversation("owner", text)
        if (lineMode === "fork") {
          if (!forkContext) throw new Error("AGENT_FORK_UNAVAILABLE")
          const child = await agentSessions.forkClaudeSession({
            sourceSessionId: forkContext.sourceSessionId,
            assignment: forkContext.assignment,
            prompt: text,
          })
          setFocusedAgentId(`Claude:${child.sessionId}`)
          setDelegateContext({
            kind: "agent", label: `${child.role} · Claude`, provider: "Claude",
            role: child.role, assignment: child.assignment,
          })
          setForkContext(null)
          setLineMode("default")
          setLineReply(agentPresentationText(child.completedTurns?.at(-1)?.finalResult) ?? "Agent completed.")
          return
        }
        if (!delegateContext?.provider) throw new Error("AGENT_PROVIDER_REQUIRED")
        const presentationEpoch = agentPresentationEpochRef.current + 1
        agentPresentationEpochRef.current = presentationEpoch
        const presentationTransitionEpoch = transitionEpochRef.current
        const presentationWorldId = worldRef.current
        const presentationProjectIdentity = projectRef.current?.identity ?? null
        const presentationProvider = delegateContext.provider
        const exactResumeSessionKey = resumeSessionKey(delegateContext)
        const exactResumeDescriptor = exactResumeSessionKey
          ? agentSessions.savedSessions.find((candidate) => (
            lineSessionKey(candidate.provider, candidate.sessionId) === exactResumeSessionKey
          )) ?? null
          : null
        const resumeDescriptorFingerprintAtDispatch = exactResumeDescriptor
          ? lineSessionDescriptorFingerprint(exactResumeDescriptor)
          : null
        const resumeCollectionFingerprintAtDispatch = exactResumeSessionKey
          ? lineSessionCollectionFingerprint(agentSessions.savedSessions)
          : null
        let presentationSessionKey: string | null = exactResumeSessionKey
        agentPresentationIsCurrent = () => agentPresentationEpochRef.current === presentationEpoch
          && transitionEpochRef.current === presentationTransitionEpoch
          && worldRef.current === presentationWorldId
          && previewDebugContextIsCurrent()
          && fileAssignmentContextIsCurrent()
          && spaceContinueContextIsCurrent()
        agentTerminalTruthIsCurrent = () => agentPresentationEpochRef.current === presentationEpoch
          && transitionEpochRef.current === presentationTransitionEpoch
          && worldRef.current === presentationWorldId
          && (projectRef.current?.identity ?? null) === presentationProjectIdentity
        if (delegateContext.kind === "line-session") {
          const exactDescriptor = agentSessions.savedSessions.find((candidate) => (
            lineSessionKey(candidate.provider, candidate.sessionId) === delegateContext.sessionKey
          ))
          const exactProjection = agentSessions.sessions.find((candidate) => candidate.id === delegateContext.sessionKey)
          if (worldRef.current !== delegateContext.worldId
            || transitionEpochRef.current !== delegateContext.transitionEpoch
            || agentSessions.collectionState !== "available"
            || agentSessions.selectedSessionKey !== delegateContext.sessionKey
            || lineSessionCollectionFingerprint(agentSessions.savedSessions) !== delegateContext.collectionFingerprint
            || !exactDescriptor
            || lineSessionDescriptorFingerprint(exactDescriptor) !== delegateContext.descriptorFingerprint
            || exactDescriptor.provider !== delegateContext.provider
            || exactDescriptor.sessionId !== delegateContext.sessionId
            || exactDescriptor.role !== delegateContext.role
            || exactDescriptor.assignment !== delegateContext.assignment
            || exactProjection?.truth !== "live"
            || lineObjectBindingFingerprint(currentLineObjectBinding()) !== lineObjectBindingFingerprint(delegateContext.objectBinding)) {
            throw new Error("AGENT_LINE_SESSION_STALE")
          }
        }
        if (reviewerAgentContext) {
          const exactKey = `Claude:${reviewerAgentContext.sessionId}`
          const exactSession = agentSessions.sessions.find((candidate) => candidate.id === exactKey)
          if (focusedAgentId !== exactKey || agentSessions.selectedSessionKey !== exactKey
            || exactSession?.kind !== "durable-session" || exactSession.mode !== reviewerAgentContext.mode
            || exactSession.reviewPath !== reviewerAgentContext.reviewPath
            || reviewerAgentContext.mode === "diff-review" && (
              !reviewerAgentContext.diffReview || !exactSession.diffReview
              || lineSessionDescriptorFingerprint(exactSession.diffReview) !== lineSessionDescriptorFingerprint(reviewerAgentContext.diffReview)
            )) {
            throw new Error("AGENT_REVIEW_SESSION_MISMATCH")
          }
        }
        if (delegateContext.kind !== "reviewer" && delegateContext.kind !== "continue"
          && delegateContext.kind !== "line-session" && delegateContext.requiredSessionKey) {
          const exactKey = delegateContext.requiredSessionKey
          const exactProjection = agentSessions.sessions.find((candidate) => candidate.id === exactKey)
          const exactDescriptor = agentSessions.savedSessions.find((candidate) => (
            lineSessionKey(candidate.provider, candidate.sessionId) === exactKey
          ))
          const commonMatches = agentSessions.collectionState === "available"
            && focusedAgentId === exactKey
            && agentSessions.selectedSessionKey === exactKey
            && exactProjection?.kind === "durable-session"
            && exactProjection.providerLabel === delegateContext.provider
            && exactProjection.role === delegateContext.role
            && exactProjection.assignment === delegateContext.assignment
            && exactDescriptor?.provider === delegateContext.provider
            && exactDescriptor.role === delegateContext.role
            && exactDescriptor.assignment === delegateContext.assignment
          const modeMatches = delegateContext.kind === "preview"
            ? exactProjection?.mode === "preview" && exactDescriptor?.preview?.worldId === worldRef.current
              && exactDescriptor.preview.evidenceFingerprint === exactProjection.preview?.evidenceFingerprint
            : delegateContext.kind === "conversation"
              ? delegateContext.provider === "Local" && exactProjection?.mode === "delegate"
                && !exactDescriptor?.reviewPath && !exactDescriptor?.preview
              : delegateContext.kind === "agent"
                ? delegateContext.provider !== "Local" && exactProjection?.mode === "delegate"
                  && !exactDescriptor?.reviewPath && !exactDescriptor?.preview
                : false
          if (!commonMatches || !modeMatches) throw new Error("AGENT_RESUME_SESSION_MISMATCH")
        }
        if (exactResumeSessionKey && (agentSessions.collectionState !== "available" || !exactResumeDescriptor)) {
          throw new Error("AGENT_RESUME_SESSION_MISMATCH")
        }
        if (exactResumeSessionKey) {
          if (resumeSessionInFlightKeys.includes(exactResumeSessionKey)
            || agentSessions.activeSessionIds.includes(exactResumeSessionKey)) {
            throw new Error("AGENT_SESSION_ALREADY_RUNNING")
          }
          resumeDispatchKey = exactResumeSessionKey
          setResumeSessionInFlightKeys((current) => current.includes(exactResumeSessionKey)
            ? current
            : [...current, exactResumeSessionKey])
        }
        setLineReply(reviewerAgentContext ? "Reviewer is working." : "Agent is working.")
        const promotedPath = (delegateContext.provider === "Codex" || delegateContext.provider === "Claude") && delegateContext.kind === "file"
          ? delegateContext.fileAssignmentBinding?.path ?? delegateContext.label
          : null
        if (promotedPath && !(delegateContext.kind === "file" && delegateContext.fileAssignmentBinding)) await persistBarrierRef.current()
        const fileAssignmentOperation: NonNullable<typeof fileAssignmentOperationRef.current> | null = delegateContext.kind === "file" && delegateContext.fileAssignmentBinding
          ? {
            binding: delegateContext.fileAssignmentBinding,
            baselineTurnIds: new Set(agentSessions.activeTurns.map((turn) => turn.id)),
            operationId: null,
            acceptedKey: null,
          }
          : null
        if (fileAssignmentOperation) fileAssignmentOperationRef.current = fileAssignmentOperation
        let committedPersistenceError: AgentTurnCommittedPersistenceError | null = null
        let persistedFinalPresentation: string | null = null
        try {
          const turn = {
            prompt: delegateContext.kind === "preview" ? text : contextualText,
            onEvent: delegateContext.kind === "preview" && delegateContext.previewDebugBinding ? () => {
              if (previewDebugContextIsCurrent()) return
              const exactKey = previewDebugSessionKeyRef.current
              if (exactKey) agentSessions.stop(exactKey)
            } : delegateContext.kind === "file" && delegateContext.fileAssignmentBinding ? () => {
              if (fileAssignmentContextIsCurrent()) return
              if (presentationSessionKey) agentSessions.stop(presentationSessionKey)
            } : undefined,
            onPresentation: (presentation: AgentTurnPresentation) => {
              if (presentation.provider !== presentationProvider) return
              const presentedSessionKey = `${presentation.provider}:${presentation.sessionId}`
              if (presentationSessionKey === null) presentationSessionKey = presentedSessionKey
              if (presentationSessionKey !== presentedSessionKey) return
              if (fileAssignmentOperation
                && presentation.provider === (fileAssignmentOperation.binding.actor === "codex" ? "Codex" : "Claude")) {
                fileAssignmentOperation.operationId = presentedSessionKey
                fileAssignmentOperation.acceptedKey = presentedSessionKey
              }
              if (delegateContext.kind === "preview" && delegateContext.previewDebugBinding) {
                previewDebugSessionKeyRef.current = presentedSessionKey
                if (previewDebugStopRequestedRef.current || !previewDebugContextIsCurrent()) {
                  agentSessions.stop(presentedSessionKey)
                  return
                }
              }
              if (delegateContext.kind === "file" && delegateContext.fileAssignmentBinding
                && !fileAssignmentContextIsCurrent()) {
                agentSessions.stop(presentedSessionKey)
                return
              }
              if (!agentPresentationIsCurrent?.()) return
              if (presentation.phase === "complete" && exactResumeSessionKey) {
                setLineReply(null)
                setLineTerminalPresentation({ sessionKey: presentedSessionKey, text: presentation.text })
                return
              }
              setLineReply(presentation.text)
              if (presentation.phase === "working" && delegateContext.kind !== "preview") setLineBusy(false)
            },
          }
          const completed = delegateContext.kind === "continue" || delegateContext.kind === "line-session"
            ? await agentSessions.continueSession({
              sessionKey: delegateContext.sessionKey,
              prompt: text,
              onEvent: delegateContext.kind === "continue" ? () => {
                if (!spaceContinueContextIsCurrent()) agentSessions.stop(delegateContext.sessionKey)
              } : undefined,
              onPresentation: turn.onPresentation,
            })
            : reviewerAgentContext
            ? await agentSessions.runClaudeTurn({
              role: "Reviewer",
              assignment: reviewerAgentContext.assignment,
              mode: reviewerAgentContext.mode,
              path: reviewerAgentContext.reviewPath,
              fileRef: reviewerAgentContext.fileRef,
              repositoryKey: reviewerAgentContext.repositoryKey,
              ...(reviewerAgentContext.diffReview ? {
                worldId: reviewerAgentContext.diffReview.worldId,
                expectedDiffFingerprint: reviewerAgentContext.diffReview.fingerprint,
              } : {}),
              focus: text,
              requiredSessionKey: reviewerAgentContext.requiredSessionKey,
            })
            : delegateContext.kind === "preview"
            ? await agentSessions.runPreviewDiagnostic(turn)
            : await agentSessions.runAgentTurn({
              ...turn,
              provider: delegateContext.provider,
              role: delegateContext.role,
              assignment: delegateContext.assignment,
              onContinuation: async (continuation) => {
                if (continuation.status === "NEXT_ASSIGNMENT" && continuation.selectedPath) {
                  await refreshPersistedSpaceSelection(continuation.selectedPath)
                }
              },
              ...((delegateContext.provider === "Codex" || delegateContext.provider === "Claude")
                && delegateContext.kind === "file" && delegateContext.fileAssignmentBinding
                ? {
                  target: { kind: "file" as const, path: delegateContext.fileAssignmentBinding.path },
                  ...(delegateContext.fileAssignmentBinding.repository
                    ? { repositoryKey: delegateContext.fileAssignmentBinding.repository.resourceKey }
                    : {}),
                  ...(delegateContext.provider === "Claude" ? {
                    expectedFileAuthority: {
                      worldId: delegateContext.fileAssignmentBinding.worldId,
                      worldRevision: delegateContext.fileAssignmentBinding.worldRevision,
                      outcomeKey: delegateContext.fileAssignmentBinding.outcomeKey,
                      workOrderId: delegateContext.fileAssignmentBinding.workOrderId,
                      grantId: delegateContext.fileAssignmentBinding.grantId,
                      actor: "claude" as const,
                      selectedPath: delegateContext.fileAssignmentBinding.path,
                    },
                  } : {}),
                }
                : {}),
            })
          const completedSessionKey = `${completed.provider}:${completed.sessionId}`
          if (exactResumeSessionKey && completedSessionKey === exactResumeSessionKey
            && resumeDescriptorFingerprintAtDispatch && resumeCollectionFingerprintAtDispatch) {
            const latestCollection = agentSavedSessionsRef.current
            const reboundCollection = agentSessions.savedSessions.map((candidate) => (
              lineSessionKey(candidate.provider, candidate.sessionId) === completedSessionKey ? completed : candidate
            ))
            const reboundCollectionFingerprint = lineSessionCollectionFingerprint(reboundCollection)
            const latestCollectionFingerprint = lineSessionCollectionFingerprint(latestCollection)
            if (latestCollectionFingerprint === resumeCollectionFingerprintAtDispatch
              || latestCollectionFingerprint === reboundCollectionFingerprint) {
              setDelegateContext((current) => current?.kind === "line-session"
                && current.sessionKey === completedSessionKey
                && current.worldId === presentationWorldId
                && current.transitionEpoch === presentationTransitionEpoch
                && current.descriptorFingerprint === resumeDescriptorFingerprintAtDispatch
                && current.collectionFingerprint === resumeCollectionFingerprintAtDispatch
                ? {
                  ...current,
                  descriptorFingerprint: lineSessionDescriptorFingerprint(completed),
                  collectionFingerprint: reboundCollectionFingerprint,
                }
                : current)
            }
          }
          if (presentationSessionKey === completedSessionKey && agentPresentationIsCurrent()) {
            persistedFinalPresentation = agentPresentationText(completed.completedTurns?.at(-1)?.finalResult) ?? "Agent completed."
            if (exactResumeSessionKey) {
              setLineReply(null)
              setLineTerminalPresentation({ sessionKey: completedSessionKey, text: persistedFinalPresentation })
            } else {
              setLineReply(persistedFinalPresentation)
            }
          }
        } catch (error) {
          if (!(error instanceof AgentTurnCommittedPersistenceError)) throw error
          committedPersistenceError = error
        } finally {
          if (fileAssignmentOperationRef.current === fileAssignmentOperation) fileAssignmentOperationRef.current = null
        }
        let refreshWarning: string | null = null
        if (promotedPath) {
          const refreshed = await refreshVerifiedChange(promotedPath)
          if (refreshed === "dirty-conflict") {
            refreshWarning = `${presentationProvider} saved ${promotedPath}, but Source has newer unsaved edits. Your buffer was preserved.`
          } else if (refreshed === "failed") {
            refreshWarning = `${presentationProvider} saved ${promotedPath}, but Source or Changes could not refresh.`
          }
        }
        if (committedPersistenceError && agentTerminalTruthIsCurrent()) {
          setLineReply(null)
          setLineTerminalWarning({
            presentationEpoch,
            transitionEpoch: presentationTransitionEpoch,
            worldId: presentationWorldId,
            projectIdentity: presentationProjectIdentity,
            path: promotedPath,
            text: refreshWarning
              ? `${refreshWarning} Transcript persistence also failed (${committedPersistenceError.message}).`
              : committedPersistenceError.message,
          })
        } else if (refreshWarning && persistedFinalPresentation && agentTerminalTruthIsCurrent()) {
          setLineTerminalWarning({
            presentationEpoch,
            transitionEpoch: presentationTransitionEpoch,
            worldId: presentationWorldId,
            projectIdentity: presentationProjectIdentity,
            path: promotedPath,
            text: refreshWarning,
          })
        }
        return
      }
      await sendWilliamTurn(text, lineContext, true)
    } catch (error) {
      if (lineTarget !== "agent") {
        setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE")
      } else if (!agentPresentationIsCurrent || agentPresentationIsCurrent() || agentTerminalTruthIsCurrent?.()) {
        const message = error instanceof Error ? error.message : ""
        setLineReply(error instanceof AgentTurnCommittedPersistenceError
          ? error.message
          : error instanceof DOMException && error.name === "AbortError" ? "Agent turn stopped."
            : delegateContext?.provider === "Local" && (message === "LOCAL_INFERENCE_UNAVAILABLE" || message === "LOCAL_MODEL_UNAVAILABLE")
              ? "Local inference unavailable."
              : "Agent turn unavailable.")
      }
    } finally {
      if (resumeDispatchKey) {
        setResumeSessionInFlightKeys((current) => current.filter((key) => key !== resumeDispatchKey))
      }
      if (!agentPresentationIsCurrent || agentPresentationIsCurrent() || agentTerminalTruthIsCurrent?.()) setLineBusy(false)
    }
  }

  useEffect(() => {
    if (!automaticPreviewDebugPending || delegateContext?.kind !== "preview" || !delegateContext.previewDebugBinding) return
    setAutomaticPreviewDebugPending(false)
    void submitLine(null, PREVIEW_DEBUG_PROMPT).finally(() => setAutomaticPreviewDebugRunning(false))
  }, [automaticPreviewDebugPending, delegateContext])

  useEffect(() => {
    if (!automaticSpaceContinuePending || delegateContext?.kind !== "continue") return
    setAutomaticSpaceContinuePending(false)
    void submitLine(null, SPACE_CONTINUE_PROMPT).finally(() => setAutomaticSpaceContinueRunning(false))
  }, [automaticSpaceContinuePending, delegateContext])

  useEffect(() => {
    if (!automaticSpaceContinueRunning || delegateContext?.kind !== "continue"
      || automaticSpaceContinueOperationIdRef.current) return
    const created = agentSessions.activeTurns.filter((turn) => (
      !automaticSpaceContinueBaselineTurnIdsRef.current.has(turn.id)
      && turn.provider === delegateContext.provider
      && turn.role === delegateContext.role
      && (turn.sessionId === null || lineSessionKey(turn.provider, turn.sessionId) === delegateContext.sessionKey)
    ))
    if (created.length === 1) automaticSpaceContinueOperationIdRef.current = created[0].id
  }, [agentSessions.activeTurns, automaticSpaceContinueRunning, delegateContext])

  const savedLabel = persistenceError
    ? persistenceError
    : hydrated
      ? persistencePending ? "saving space" : storage === "browser" ? "space saved locally" : "space saved"
      : "opening space"
  const williamReady = hydrated && Boolean(worldId)
  const selectedAgent = agentSessions.sessions.find((agent) => agent.id === focusedAgentId)
  const selectedKind = selectedAgent ? "agent" as const
    : space.activeWindowId === "running-app" ? "preview" as const
    : space.activeWindowId === "diff" ? "diff" as const
    : space.activeWindowId === "editor" && space.selectedPath ? "file" as const
    : "space" as const
  const selectedFileRepositoryLabel = space.selectedFileRef
    ? project?.repositories?.find(
      (repository) => repository.key === space.selectedFileRef?.repositoryResourceKey,
    )?.label ?? null
    : null
  const selectedLabel = selectedAgent ? `${selectedAgent.role} · ${selectedAgent.providerLabel}`
    : selectedKind === "preview" ? "TerraFusion developer preview"
    : selectedKind === "diff" ? "Current changes"
    : selectedKind === "file" && selectedFileRepositoryLabel
      ? `${selectedFileRepositoryLabel} · ${space.selectedPath!}`
      : selectedKind === "file" ? space.selectedPath!
    : `${project?.name ?? space.name} Space`
  const selectedKindLabel = selectedKind === "file" ? "file"
    : selectedKind === "preview" ? "preview"
    : selectedKind === "diff" ? "changes"
    : selectedKind === "agent" ? "agent session"
    : "Space"

  useEffect(() => {
    const requestId = spaceDelegateEligibilityRequestRef.current + 1
    spaceDelegateEligibilityRequestRef.current = requestId
    setSpaceDelegateEligibility({})
    const path = space.selectedPath
    const selectedFileRef = space.selectedFileRef
    const selectedRepository = selectedFileRef && project?.repositories?.find(
      (candidate) => candidate.key === selectedFileRef.repositoryResourceKey,
    )
    const repositorySelectionReady = !selectedFileRef || Boolean(selectedRepository
      && selectedRepository.mount.verified && selectedRepository.mount.revision
      && selectedFileRef.path === path && selectedFileRef.projectIdentity === project?.identity
      && selectedFileRef.repositoryMountKey === selectedRepository.mount.key
      && selectedFileRef.observedRevision === selectedRepository.mount.revision)
    const baselineReady = selectedKind === "space" && storage === "server" && Boolean(worldId && project)
      && !persistencePending && !persistenceError && acknowledgedRevisionRef.current === space.revision
      && Boolean(path && isReviewableWorkspacePath(path) && !dirtyPaths[path])
      && Boolean(spine.outcomeKey && spine.workOrderId !== null)
      && repositorySelectionReady
      && spine.execution !== "idle" && spine.execution !== "complete" && spine.execution !== "blocked"
    if (!baselineReady || !worldId || !project || !path || !spine.outcomeKey || spine.workOrderId === null) {
      setSpaceDelegateEligibilityPending(false)
      return
    }
    const guard = {
      worldId, transitionEpoch: transitionEpochRef.current, projectIdentity: project.identity,
      revision: space.revision, path, outcomeKey: spine.outcomeKey, workOrderId: spine.workOrderId,
      repositoryKey: selectedFileRef?.repositoryResourceKey ?? null,
      repositoryIdentity: selectedRepository?.identity ?? null,
      repositoryMountKey: selectedFileRef?.repositoryMountKey ?? null,
      repositoryRevision: selectedFileRef?.observedRevision ?? null,
    }
    const controller = new AbortController()
    setSpaceDelegateEligibilityPending(true)
    void Promise.all((["codex", "claude"] as const).map(async (actor) => {
      try {
        const response = await fetch(`/api/loom/agent?${new URLSearchParams({
          worldId, actor, path, projectKey,
          ...(guard.repositoryKey ? { repositoryKey: guard.repositoryKey } : {}),
        }).toString()}`, {
          cache: "no-store", signal: controller.signal,
        })
        const payload = await response.json().catch(() => null)
        const proof = response.ok ? parseSpaceDelegateEligibility(payload) : null
        return proof?.actor === actor ? proof : null
      } catch {
        return null
      }
    })).then((proofs) => {
      if (controller.signal.aborted || spaceDelegateEligibilityRequestRef.current !== requestId
        || worldRef.current !== guard.worldId || transitionEpochRef.current !== guard.transitionEpoch
        || projectRef.current?.identity !== guard.projectIdentity
        || stateRef.current.revision !== guard.revision || stateRef.current.selectedPath !== guard.path
        || spineRef.current.outcomeKey !== guard.outcomeKey || spineRef.current.workOrderId !== guard.workOrderId
        || storageRef.current !== "server" || persistencePendingRef.current || persistenceErrorRef.current
        || acknowledgedRevisionRef.current !== guard.revision || revisionRef.current !== guard.revision) return
      const exact = Object.fromEntries(proofs.flatMap((proof) => proof
        && proof.worldId === guard.worldId && proof.worldRevision === guard.revision
        && proof.outcomeKey === guard.outcomeKey && proof.workOrderId === guard.workOrderId
        && proof.selectedPath === guard.path
        && (!guard.repositoryKey || proof.repository?.resourceKey === guard.repositoryKey
          && proof.repository.identity === guard.repositoryIdentity
          && proof.repository.mountKey === guard.repositoryMountKey
          && proof.repository.observedRevision === guard.repositoryRevision)
        ? [[proof.actor, proof]] : []))
      setSpaceDelegateEligibility(exact)
    }).catch(() => undefined).finally(() => {
      if (!controller.signal.aborted && spaceDelegateEligibilityRequestRef.current === requestId) {
        setSpaceDelegateEligibilityPending(false)
      }
    })
    return () => controller.abort()
  }, [
    dirtyPaths, persistenceError, persistencePending, project, projectKey, selectedKind, space.revision,
    space.selectedFileRef, space.selectedPath, spine.execution, spine.outcomeKey, spine.workOrderId, storage, worldId,
  ])

  useEffect(() => {
    const requestId = fileDelegateEligibilityRequestRef.current + 1
    fileDelegateEligibilityRequestRef.current = requestId
    setFileDelegateEligibility({})
    const path = space.selectedPath
    const selectedFileRef = space.selectedFileRef
    const selectedRepository = selectedFileRef && project?.repositories?.find(
      (candidate) => candidate.key === selectedFileRef.repositoryResourceKey,
    )
    const repositorySelectionReady = !selectedFileRef || Boolean(selectedRepository
      && selectedRepository.mount.verified && selectedRepository.mount.revision
      && selectedFileRef.path === path && selectedFileRef.projectIdentity === project?.identity
      && selectedFileRef.repositoryMountKey === selectedRepository.mount.key
      && selectedFileRef.observedRevision === selectedRepository.mount.revision)
    const baselineReady = selectedKind === "file" && storage === "server" && Boolean(worldId && project)
      && !persistencePending && !persistenceError && acknowledgedRevisionRef.current === space.revision
      && Boolean(path && isReviewableWorkspacePath(path) && !dirtyPaths[path])
      && Boolean(spine.outcomeKey && spine.workOrderId !== null)
      && repositorySelectionReady
      && spine.execution !== "idle" && spine.execution !== "complete" && spine.execution !== "blocked"
    if (!baselineReady || !worldId || !project || !path || !spine.outcomeKey || spine.workOrderId === null) {
      setFileDelegateEligibilityPending(false)
      return
    }
    const guard = {
      worldId, transitionEpoch: transitionEpochRef.current, projectIdentity: project.identity,
      revision: space.revision, path, outcomeKey: spine.outcomeKey, workOrderId: spine.workOrderId,
      repositoryKey: selectedFileRef?.repositoryResourceKey ?? null,
      repositoryIdentity: selectedRepository?.identity ?? null,
      repositoryMountKey: selectedFileRef?.repositoryMountKey ?? null,
      repositoryRevision: selectedFileRef?.observedRevision ?? null,
    }
    const controller = new AbortController()
    setFileDelegateEligibilityPending(true)
    void Promise.all((["codex", "claude"] as const).map(async (actor) => {
      try {
        const response = await fetch(`/api/loom/agent?${new URLSearchParams({
          worldId, actor, path, projectKey,
          ...(guard.repositoryKey ? { repositoryKey: guard.repositoryKey } : {}),
        }).toString()}`, {
          cache: "no-store", signal: controller.signal,
        })
        const payload = await response.json().catch(() => null)
        const proof = response.ok ? parseSpaceDelegateEligibility(payload) : null
        return proof?.actor === actor ? proof : null
      } catch {
        return null
      }
    })).then((proofs) => {
      if (controller.signal.aborted || fileDelegateEligibilityRequestRef.current !== requestId
        || worldRef.current !== guard.worldId || transitionEpochRef.current !== guard.transitionEpoch
        || projectRef.current?.identity !== guard.projectIdentity
        || stateRef.current.revision !== guard.revision || stateRef.current.selectedPath !== guard.path
        || spineRef.current.outcomeKey !== guard.outcomeKey || spineRef.current.workOrderId !== guard.workOrderId
        || storageRef.current !== "server" || persistencePendingRef.current || persistenceErrorRef.current
        || acknowledgedRevisionRef.current !== guard.revision || revisionRef.current !== guard.revision) return
      const exact = Object.fromEntries(proofs.flatMap((proof) => proof
        && proof.worldId === guard.worldId && proof.worldRevision === guard.revision
        && proof.outcomeKey === guard.outcomeKey && proof.workOrderId === guard.workOrderId
        && proof.selectedPath === guard.path
        && (!guard.repositoryKey || proof.repository?.resourceKey === guard.repositoryKey
          && proof.repository.identity === guard.repositoryIdentity
          && proof.repository.mountKey === guard.repositoryMountKey
          && proof.repository.observedRevision === guard.repositoryRevision)
        ? [[proof.actor, proof]] : []))
      setFileDelegateEligibility(exact)
    }).catch(() => undefined).finally(() => {
      if (!controller.signal.aborted && fileDelegateEligibilityRequestRef.current === requestId) {
        setFileDelegateEligibilityPending(false)
      }
    })
    return () => controller.abort()
  }, [
    dirtyPaths, persistenceError, persistencePending, project, projectKey, selectedKind, space.revision,
    space.selectedFileRef, space.selectedPath, spine.execution, spine.outcomeKey, spine.workOrderId, storage, worldId,
  ])

  function currentLineObjectBinding(): LineObjectBinding | null {
    if (selectedKind === "agent") return selectedAgent ? { kind: "agent-session", sessionKey: selectedAgent.id } : null
    if (selectedKind === "file") return space.selectedPath ? { kind: "file", path: space.selectedPath } : null
    if (selectedKind === "diff") {
      const live = liveDiffContextRef.current
      return live && live.worldId === worldId && live.path === space.selectedPath
        ? { kind: "diff", path: live.path, fingerprint: live.fingerprint }
        : null
    }
    if (selectedKind === "preview") {
      if (!worldId || !project) return null
      const live = inspectors.flatMap((surface) => surface.kind === "preview-evidence"
        ? [parsePreviewInspectorPayload(surface.payload)] : []).filter(Boolean).at(-1)
        ?? loadPreviewEvidenceSnapshot(worldId, project.identity)
      return live ? { kind: "preview", worldId, evidenceFingerprint: live.evidence.fingerprint } : null
    }
    return worldId ? { kind: "space", worldId, revision: space.revision } : null
  }
  const eligibleLineSessionTargets = agentSessions.collectionState === "available"
    ? agentSessions.savedSessions.flatMap((descriptor) => {
      const sessionKey = lineSessionKey(descriptor.provider, descriptor.sessionId)
      const projection = agentSessions.sessions.find((candidate) => candidate.id === sessionKey)
      if (!projection || projection.kind !== "durable-session" || projection.truth !== "live"
        || projection.providerLabel !== descriptor.provider || projection.role !== descriptor.role
        || projection.assignment !== descriptor.assignment) return []
      return [{
        descriptor,
        projection,
        sessionKey,
      }]
    })
    : []
  const verifiedLineSessionTargets = eligibleLineSessionTargets.map((target) => {
    const compactIdentity = target.descriptor.sessionId.slice(-6)
    const collides = eligibleLineSessionTargets.some((candidate) => candidate.sessionKey !== target.sessionKey
      && candidate.descriptor.role === target.descriptor.role
      && candidate.descriptor.provider === target.descriptor.provider
      && candidate.descriptor.assignment === target.descriptor.assignment
      && candidate.descriptor.sessionId.slice(-6) === compactIdentity)
    return {
      ...target,
      label: `${target.descriptor.role} · ${target.descriptor.provider} · ${target.descriptor.assignment} · ${collides ? target.descriptor.sessionId : `…${compactIdentity}`}`,
    }
  })
  const currentResumeSessionKey = resumeSessionKey(delegateContext)
  const currentResumeSessionIsActive = Boolean(lineTarget === "agent" && currentResumeSessionKey
    && (resumeSessionInFlightKeys.includes(currentResumeSessionKey)
      || agentSessions.activeSessionIds.includes(currentResumeSessionKey)))
  const lineTranscriptSession = lineTarget === "agent" && lineMode === "default" && currentResumeSessionKey
    ? (() => {
      const descriptor = agentSessions.savedSessions.find((candidate) => (
        lineSessionKey(candidate.provider, candidate.sessionId) === currentResumeSessionKey
      ))
      const projection = agentSessions.sessions.find((candidate) => candidate.id === currentResumeSessionKey)
      if (!descriptor || !projection || projection.kind !== "durable-session" || !delegateContext
        || descriptor.provider !== projection.providerLabel || descriptor.role !== projection.role
        || descriptor.assignment !== projection.assignment || descriptor.provider !== delegateContext.provider
        || descriptor.role !== delegateContext.role || descriptor.assignment !== delegateContext.assignment) return null
      return {
        sessionKey: currentResumeSessionKey,
        role: descriptor.role,
        provider: descriptor.provider,
        assignment: descriptor.assignment,
        truth: projection.truth === "persisted" ? "resume-unverified" : projection.truth,
        turns: descriptor.completedTurns ?? [],
      }
    })()
    : null
  const canonicalTranscriptFinal = agentPresentationText(lineTranscriptSession?.turns.at(-1)?.finalResult)
  const lineTerminalReply = lineTerminalPresentation?.sessionKey === currentResumeSessionKey
    && lineTerminalPresentation.text !== canonicalTranscriptFinal
    ? lineTerminalPresentation.text
    : null
  const visibleLineTerminalWarning = lineTerminalWarning
    && lineTerminalWarning.presentationEpoch === agentPresentationEpochRef.current
    && lineTerminalWarning.transitionEpoch === transitionEpochRef.current
    && lineTerminalWarning.worldId === worldId
    && lineTerminalWarning.projectIdentity === (project?.identity ?? null)
    ? lineTerminalWarning
    : null

  useEffect(() => {
    if (!lineOpen || lineTarget !== "agent") return
    const exactSessionKey = resumeSessionKey(delegateContext)
    if (!exactSessionKey || delegateContext?.kind === "line-session"
      && (worldRef.current !== delegateContext.worldId
        || transitionEpochRef.current !== delegateContext.transitionEpoch)) return
    const projection = agentSessions.sessions.find((candidate) => (
      candidate.id === exactSessionKey && candidate.truth === "live"
    ))
    if (!projection) return
    if (resumeSessionInFlightKeys.includes(exactSessionKey)
      && !agentSessions.activeSessionIds.includes(exactSessionKey)) {
      setLineReply("Agent is starting.")
      return
    }
    if (agentSessions.activeSessionIds.includes(exactSessionKey)) {
      setLineSessionObservedRunningKey(exactSessionKey)
      setLineReply(projection.presentation ?? "Agent is working.")
      return
    }
    if (projection.lastResult) {
      if (lineSessionObservedRunningKey === exactSessionKey) {
        if (delegateContext?.kind === "line-session") {
          const descriptor = agentSessions.savedSessions.find((candidate) => (
            lineSessionKey(candidate.provider, candidate.sessionId) === exactSessionKey
          ))
          if (descriptor) {
            setDelegateContext((current) => current?.kind === "line-session" && current.sessionKey === exactSessionKey
              ? {
                ...current,
                descriptorFingerprint: lineSessionDescriptorFingerprint(descriptor),
                collectionFingerprint: lineSessionCollectionFingerprint(agentSessions.savedSessions),
              }
              : current)
          }
        }
        setLineSessionObservedRunningKey(null)
      }
      const persisted = agentSessions.savedSessions.find((candidate) => (
        lineSessionKey(candidate.provider, candidate.sessionId) === exactSessionKey
      ))
      const persistedLastResult = agentPresentationText(persisted?.completedTurns?.at(-1)?.finalResult)
      const projectedLastResult = agentPresentationText(projection.lastResult)
      setLineReply(persistedLastResult === projectedLastResult ? null : projectedLastResult)
      setLineBusy(false)
    }
  }, [agentSessions.activeSessionIds, agentSessions.savedSessions, agentSessions.sessions, delegateContext, lineOpen, lineSessionObservedRunningKey, lineTarget, resumeSessionInFlightKeys])

  function selectLineSessionTarget(target: (typeof verifiedLineSessionTargets)[number]) {
    const capturedWorldId = worldRef.current
    const objectBinding = currentLineObjectBinding()
    if (!capturedWorldId || agentSessions.collectionState !== "available"
      || !objectBinding || !agentSessions.selectSession(target.sessionKey)) return
    agentPresentationEpochRef.current += 1
    setLineTarget("agent")
    setLineContext(null)
    setLineMode("default")
    setForkContext(null)
    setLineInput("")
    setLineBusy(false)
    setLineTerminalPresentation(null)
    setDelegateContext({
      kind: "line-session",
      label: target.label,
      provider: target.descriptor.provider,
      role: target.descriptor.role,
      assignment: target.descriptor.assignment,
      sessionKey: target.sessionKey,
      sessionId: target.descriptor.sessionId,
      worldId: capturedWorldId,
      transitionEpoch: transitionEpochRef.current,
      collectionFingerprint: lineSessionCollectionFingerprint(agentSessions.savedSessions),
      descriptorFingerprint: lineSessionDescriptorFingerprint(target.descriptor),
      objectBinding,
      objectContext: `${selectedKindLabel} · ${selectedLabel}`,
      spaceContext: `${project?.name ?? space.name} Space`,
    })
    const active = agentSessions.activeSessionIds.includes(target.sessionKey)
    setLineSessionObservedRunningKey(active ? target.sessionKey : null)
    setLineReply(resumeSessionInFlightKeys.includes(target.sessionKey) && !active
      ? "Agent is starting."
      : active ? target.projection.presentation ?? "Agent is working."
      : null)
  }
  const pauseAction = selectedAgent && agentSessions.pausableSessionIds.includes(selectedAgent.id) ? "Pause" : "Pause unavailable"
  const forkEligible = selectedAgent?.kind === "durable-session" && selectedAgent?.truth === "live" && selectedAgent.providerLabel === "Claude" && selectedAgent.role === "Builder" && selectedAgent.mode === "delegate"
  const forkAction = forkEligible && agentSessions.activeSessionIds.length === 0 ? "Fork" : "Fork unavailable"
  const rawSpaceContinueCandidate = selectSpaceContinueCandidate(
    agentSessions.collectionState,
    agentSessions.savedSessions,
    agentSessions.selectedSessionKey,
  )
  const readOnlySpaceContinue = rawSpaceContinueCandidate
    && (rawSpaceContinueCandidate.provider === "Local"
      && rawSpaceContinueCandidate.role === "Thinker"
      && !rawSpaceContinueCandidate.target
      && !rawSpaceContinueCandidate.reviewPath
      && !rawSpaceContinueCandidate.diffReview
      && !rawSpaceContinueCandidate.preview
      && !rawSpaceContinueCandidate.forkedFrom
      || rawSpaceContinueCandidate.provider === "Claude"
        && rawSpaceContinueCandidate.role === "Reviewer"
        && Boolean(rawSpaceContinueCandidate.reviewPath || rawSpaceContinueCandidate.diffReview)
        && !rawSpaceContinueCandidate.target
        && !rawSpaceContinueCandidate.preview
        && !rawSpaceContinueCandidate.forkedFrom
      || rawSpaceContinueCandidate.provider === "Claude"
        && rawSpaceContinueCandidate.role === "Preview debugger"
        && Boolean(rawSpaceContinueCandidate.preview)
        && !rawSpaceContinueCandidate.target
        && !rawSpaceContinueCandidate.reviewPath
        && !rawSpaceContinueCandidate.diffReview
        && !rawSpaceContinueCandidate.forkedFrom)
  const nonReadOnlySpaceContinue = Boolean(rawSpaceContinueCandidate && !readOnlySpaceContinue)
  const spaceContinueCandidate = readOnlySpaceContinue ? rawSpaceContinueCandidate : null
  const continueAction = spaceContinueCandidate ? "Continue" : "Continue unavailable"
  const continueUnavailableMessage = nonReadOnlySpaceContinue
    ? "This saved session is mutation-capable or not verifiably read-only, so Space Continue did not resume it."
    : spaceContinueUnavailableMessage(agentSessions.collectionState)
  const spaceDelegateBaselineUnavailableReason = selectedKind !== "space" ? null
    : storage !== "server" || !worldId || !project
      || persistencePending || persistenceError
      || acknowledgedRevisionRef.current !== space.revision
      || !space.selectedPath || !isReviewableWorkspacePath(space.selectedPath)
      || dirtyPaths[space.selectedPath]
      || !spine.outcomeKey || spine.workOrderId === null
      || spine.execution === "idle" || spine.execution === "complete" || spine.execution === "blocked"
      ? "Delegate needs one clean durably saved selected file in a server-bound active Work Order."
      : null
  const spaceDelegateProofMatches = (["codex", "claude"] as const).some((actor) => {
    const proof = spaceDelegateEligibility[actor]
    return Boolean(proof
      && proof.worldId === worldId
      && proof.worldRevision === space.revision
      && proof.outcomeKey === spine.outcomeKey
      && proof.workOrderId === spine.workOrderId
      && proof.actor === actor
      && proof.selectedPath === space.selectedPath)
  })
  const spaceDelegateUnavailableReason = spaceDelegateBaselineUnavailableReason
    ?? (spaceDelegateEligibilityPending
      ? "Delegate is checking exact-path authority for Codex and Claude."
      : !spaceDelegateProofMatches
        ? "Delegate requires a current server-derived exact-path authority proof for Codex or Claude."
        : null)
  const fileDelegateBaselineUnavailableReason = selectedKind !== "file" ? null
    : storage !== "server" || !worldId || !project
      || persistencePending || persistenceError
      || acknowledgedRevisionRef.current !== space.revision
      || !space.selectedPath || !isReviewableWorkspacePath(space.selectedPath)
      || dirtyPaths[space.selectedPath]
      || !spine.outcomeKey || spine.workOrderId === null
      || spine.execution === "idle" || spine.execution === "complete" || spine.execution === "blocked"
      ? "Delegate needs one clean durably saved selected file in a server-bound active Work Order."
      : null
  const fileDelegateProofAvailable = Boolean(fileDelegateEligibility.codex || fileDelegateEligibility.claude)
  const fileDelegateUnavailableReason = fileDelegateBaselineUnavailableReason
    ?? (fileDelegateEligibilityPending
      ? "Delegate is checking exact-path authority for Codex and Claude."
      : !fileDelegateProofAvailable
        ? "Delegate requires a current server-derived exact-path authority proof for Codex or Claude."
        : null)
  const diffReviewUnavailableReason = selectedKind !== "diff" ? null
    : storage !== "server" ? "Review requires a server-bound Space with durable persistence."
      : persistenceError ? `Review is unavailable because Space persistence is refusing writes (${persistenceError}).`
        : !worldId || !space.selectedPath || dirtyPaths[space.selectedPath]
            || !liveDiffContext || liveDiffContext.worldId !== worldId || liveDiffContext.path !== space.selectedPath
            ? "Review needs the exact live modified patch for the saved selected file."
            : persistencePending ? "Review waits until the current Space is durably saved."
              : null
  const diffChallengeUnavailableReason = selectedKind !== "diff" ? null
    : storage !== "server" ? "Challenge requires a server-bound Space with durable persistence."
      : persistenceError ? `Challenge is unavailable because Space persistence is refusing writes (${persistenceError}).`
        : persistencePending ? "Challenge waits until the current Space is durably saved."
          : !worldId || !space.selectedPath || dirtyPaths[space.selectedPath]
            || !liveDiffContext || liveDiffContext.worldId !== worldId || liveDiffContext.path !== space.selectedPath
            || !liveModifiedDiffIdentity(liveDiffContext)
            ? "Challenge needs the exact live modified patch for the saved selected file."
            : null
  const previewExplainUnavailableReason = selectedKind !== "preview" ? null
    : storage !== "server" ? "Explain requires a server-bound Space with durable persistence."
      : persistenceError ? `Explain is unavailable because Space persistence is refusing writes (${persistenceError}).`
        : persistencePending ? "Explain waits until the current Space is durably saved."
          : !worldId || !project || !space.selectedPath || dirtyPaths[space.selectedPath]
            ? "Explain needs an exact durably saved selected source file."
            : null
  const fileReviewUnavailableReason = selectedKind !== "file" ? null
    : change.running || review.running ? "Finish the active Change or Review before reviewing another file."
      : !worldId || !isReviewableWorkspacePath(space.selectedPath) ? "Review needs an exact workspace-relative selected file."
        : dirtyPaths[space.selectedPath] ? "Save the selected file before Review so Claude does not inspect stale disk content."
          : persistenceError ? `Review is unavailable because Space persistence is refusing writes (${persistenceError}).`
            : null
  const selectedActions = selectedKind === "file" ? ["Ask", "Change", fileDelegateUnavailableReason ? "Delegate unavailable" : "Delegate", fileReviewUnavailableReason ? "Review unavailable" : "Review"] as const
    : selectedKind === "preview" ? ["Inspect", "Debug", previewExplainUnavailableReason ? "Explain unavailable" : "Explain", "Delegate"] as const
    : selectedKind === "diff" ? [diffReviewUnavailableReason ? "Review unavailable" : "Review", "Improve", diffChallengeUnavailableReason ? "Challenge unavailable" : "Challenge", "Merge unavailable"] as const
    : selectedKind === "agent" && selectedAgent?.kind === "world-worker" ? ["Inspect", "Ask William", "Council"] as const
    : selectedKind === "agent" && selectedAgent?.providerLabel === "Local" ? ["Inspect", "Ask William", "Talk", "Council", pauseAction, forkAction] as const
    : selectedKind === "agent" && selectedAgent?.kind === "durable-session" && !durableSessionDelegateContext(selectedAgent)
      ? ["Inspect", "Ask William", "Council", pauseAction, forkAction, selectedAgent.target ? "Review work" : "Review work unavailable"] as const
    : selectedKind === "agent" ? ["Inspect", "Ask William", "Talk", "Redirect", "Council", pauseAction, forkAction, selectedAgent?.target ? "Review work" : "Review work unavailable"] as const
    : ["Summarize", continueAction, spaceDelegateUnavailableReason ? "Delegate unavailable" : "Delegate", "Council"] as const
  const improveUnavailableReason = selectedKind !== "diff" ? null
    : storage !== "server" ? "Improve requires a server-bound Space with durable persistence."
      : persistenceError ? `Improve is unavailable because Space persistence is refusing writes (${persistenceError}).`
        : persistencePending ? "Improve waits until the current Space is durably saved."
          : !worldId || !space.selectedPath || dirtyPaths[space.selectedPath]
            || !liveDiffContext || liveDiffContext.worldId !== worldId || liveDiffContext.path !== space.selectedPath
            ? "Improve needs the exact live modified patch for the saved selected file."
            : null
  const worldLine = spine.outcomeKey ? ` · ${spine.outcomeKey} · ${spine.execution}` : ""
  const workerLine = spine.worker ? ` · worker: ${spine.worker.lane} lane` : ""
  const williamSafetyFact = persistenceError
    ? `Space persistence is refusing writes (${persistenceError}).`
    : !space.runningAppUrl
      ? "The developer preview is not attached."
      : space.selectedPath
        ? `${space.selectedPath} is selected.`
        : "No source object is selected."
  const williamJudgment = judgment?.recommendation
    ?? (judgmentBusy
      ? "William is forming a grounded judgment from the current Space."
      : `System fact: ${williamSafetyFact} ${judgmentError ? `William judgment unavailable (${judgmentError}).` : "William has not formed a judgment yet."}`)
  const currentInspectableJudgment = inspectableWilliamJudgment(judgment)
  const overrideWilliamJudgment = useCallback(() => {
    const current = inspectableWilliamJudgment(judgment)
    if (!current) return
    setWilliamRailOpen(true)
    setWilliamInput(`Override William's recommendation:\n> ${current.recommendation}\n\nReason: `)
  }, [judgment])

  const applySpaceEnvelope = (payload: SpaceEnvelope) => {
    // A terminal result belongs only to the exact Space/transition that started it. Invalidate
    // before advancing the epoch so delayed provider frames cannot refresh or present in the next
    // Space, even though ordinary reset intentionally ignores an active operation.
    change.invalidate()
    inspectorReturnWindowRef.current.clear()
    const name = payload.name ?? payload.project?.name ?? "Space"
    const restoredProject = payload.project ?? projectRef.current
    const restoredBase = qualifyLegacyWorkspaceFiles(
      normalizeSpace(
        payload.space,
        defaultSpace(window.innerWidth, window.innerHeight, payload.worldId, name),
        { width: window.innerWidth, height: window.innerHeight },
      ),
      restoredProject,
    )
    const savedPreview = restoredProject
      ? loadPreviewEvidenceSnapshot(payload.worldId, restoredProject.identity)
      : null
    const previewSurface: InspectorSurface | null = savedPreview ? {
      id: inspectorId({ kind: "preview-evidence", subject: PREVIEW_EVIDENCE_SUBJECT }),
      kind: "preview-evidence",
      subject: PREVIEW_EVIDENCE_SUBJECT,
      payload: savedPreview,
    } : null
    const restored = previewSurface ? {
      ...restoredBase,
      inspectorWindows: {
        ...restoredBase.inspectorWindows,
        [previewSurface.id]: restoredBase.inspectorWindows[previewSurface.id] ?? {
          x: 104, y: 72, width: 560, height: 480,
          z: Math.max(...Object.values(restoredBase.windows).map((window) => window.z)) + 1,
          minimized: false,
        },
      },
      inspectorSeeds: {
        ...restoredBase.inspectorSeeds,
        [previewSurface.id]: { kind: previewSurface.kind, subject: previewSurface.subject },
      },
      activeWindowId: previewSurface.id,
    } satisfies WorkspaceSpace : restoredBase
    transitionEpochRef.current += 1
    changeSetRequestRef.current += 1
    invalidateCouncilView()
    councilSessionRef.current = null
    worldRef.current = payload.worldId
    storageRef.current = payload.storage === "browser" ? "browser" : "server"
    browserStorageKeyRef.current = payload.storage === "browser" && payload.browserStorageKey
      ? browserSpaceKey(payload.browserStorageKey) : null
    revisionRef.current = restored.revision
    acknowledgedRevisionRef.current = restored.revision
    pendingPersistRef.current = null
    restorationStarted.current = false
    judgmentRequestedRef.current = null
    judgmentContextRef.current = null
    setWorldId(payload.worldId)
    setExecutionSession(null)
    setSpace(restored)
    setPersistenceError(null)
    setPersistencePending(false)
    setStorage(storageRef.current)
    setSpaceSummaries((known) => payload.collectionAvailable === false
      ? mergeSpaceSummaries(known, payload)
      : payload.spaces ?? known)
    setMultiSpaceAvailable(payload.multiSpaceAvailable === true)
    setSpaceCollectionAvailable(payload.collectionAvailable !== false)
    setSpaceCollectionReason(payload.collectionAvailable === false ? payload.collectionReason ?? "SPACE_COLLECTION_UNAVAILABLE" : null)
    setProject(restoredProject)
    setSpine(payload.spine ?? EMPTY_SPINE)
    setJudgment(payload.judgment ?? null)
    setJudgmentError(null)
    setDirtyPaths({})
    dirtyPathsRef.current = {}
    changeRefreshWaiters.current.clear()
    setChangeRefresh({ path: null, key: changeRefreshKey.current })
    setInspectors([
      ...Object.entries(restored.inspectorSeeds).flatMap(([id, seed]) => restoredInspectorSurface(id, seed)),
      ...(previewSurface ? [previewSurface] : []),
    ])
    setConversation(restoredConversation(payload.conversation))
    setWilliamInput("")
    setWilliamError(null)
    setChangeSetProjection(null)
    setChangeSetBusy(false)
    setChangeSetError(null)
    setFocusedAgentId(null)
    setLineOpen(false)
    setLineInput("")
    setLineReply(null)
    setLineTarget("william")
    setLineContext(null)
    setLineMode("default")
    setDelegateContext(null)
    setChangeTarget(null)
    setChangeFileRef(null)
    setChangeIntent("change")
    setCapturedDiffImprove(null)
    setLiveDiffContext(null)
    liveDiffContextRef.current = null
    setReviewTarget(null)
    setReviewFileRef(null)
    setAgentWorkReview(false)
    change.reset(null)
    review.reset(null)
    setCouncilQuestion(null)
    setCouncilSession(null)
    setCouncilHistory([])
    setCouncilHistorical(false)
    setCouncilView("history")
    setCouncilBusy(false)
    setCouncilError(null)
    const preference = typeof payload.preferenceStorageKey === "string"
      ? `williamos:selected-space:${payload.preferenceStorageKey}` : preferenceStorageKeyRef.current
    preferenceStorageKeyRef.current = preference
    if (preference) safeLocalStorageSet(preference, payload.worldId)
  }

  const switchBlockedReason = () => {
    if (Object.values(dirtyPaths).some(Boolean)) return "Save or discard the dirty source before switching Spaces."
    if (runningTools.tests || runningTools.terminal) return "Stop the active Test or Terminal run before switching Spaces."
    if (isExecutionLive(spine.execution)) return "Finish or stop the active Space execution before switching Spaces."
    if (change.running || review.running || lineBusy || councilBusy || judgmentBusy || agentSessions.activeSessionIds.length > 0) {
      return "Finish or stop active work before switching Spaces."
    }
    return null
  }

  const flushCurrentSpace = async () => {
    if (persistTimer.current) { clearTimeout(persistTimer.current); persistTimer.current = null }
    await persist()
    if (storageRef.current === "server" && acknowledgedRevisionRef.current < revisionRef.current) {
      throw new Error("The current Space could not be saved, so WilliamOS kept you here.")
    }
  }

  const enterMissionSpace = async (targetWorldId: string) => {
    if (targetWorldId === worldId) { setOverlay(null); return }
    const blocked = switchBlockedReason()
    if (blocked) { setTransitionMessage(blocked); return }
    if (switchingSpace) return
    setSwitchingSpace(true)
    setTransitionMessage("Saving this Space before re-entry…")
    try {
      await flushCurrentSpace()
      setTransitionMessage("Restoring the selected Space…")
      const response = await fetch(spaceEndpoint(projectKey, targetWorldId), { cache: "no-store" })
      const payload = await response.json() as SpaceEnvelope & { error?: string }
      if (!response.ok || payload.worldId !== targetWorldId || !payload.space) throw new Error(payload.error ?? `SPACE_${response.status}`)
      applySpaceEnvelope(payload)
      setTransitionMessage(null)
    } catch (error) {
      setTransitionMessage(error instanceof Error ? error.message : "Space re-entry failed. Your current Space is unchanged.")
    } finally {
      setSwitchingSpace(false)
    }
  }

  const createMissionSpace = async (name: string) => {
    const blocked = switchBlockedReason()
    if (blocked) { setTransitionMessage(blocked); return false }
    if (switchingSpace) return false
    setSwitchingSpace(true)
    setTransitionMessage("Saving this Space before creating another…")
    try {
      await flushCurrentSpace()
      const response = await fetch("/api/environment/space", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(spaceMutationBody(projectKey, { name })),
      })
      const payload = await response.json() as SpaceEnvelope & { error?: string }
      if (!response.ok || !payload.worldId || !payload.space) throw new Error(payload.error ?? `SPACE_CREATE_${response.status}`)
      applySpaceEnvelope(payload)
      setTransitionMessage(null)
      return true
    } catch (error) {
      setTransitionMessage(error instanceof Error ? error.message : "Space creation failed. Your current Space is unchanged.")
      return false
    } finally {
      setSwitchingSpace(false)
    }
  }

  const removeMissionSpace = async (targetWorldId: string) => {
    if (!worldId || targetWorldId === worldId) {
      setTransitionMessage("The current Space cannot be removed. Enter another Space first.")
      return false
    }
    if (switchingSpace) return false
    setSwitchingSpace(true)
    setTransitionMessage("Removing the saved Space…")
    try {
      const response = await fetch(`/api/environment/spaces/${encodeURIComponent(targetWorldId)}${projectKey === "williamos" ? "?projectKey=williamos" : ""}`, { method: "DELETE" })
      const payload = await response.json().catch(() => ({})) as { error?: string; removedWorldId?: string; spaces?: SpaceSummary[] }
      if (!response.ok || payload.removedWorldId !== targetWorldId) throw new Error(payload.error ?? `SPACE_REMOVE_${response.status}`)
      setSpaceSummaries((current) => payload.spaces ?? current.filter((summary) => summary.worldId !== targetWorldId))
      if (project) {
        removePreviewEvidenceSnapshot(targetWorldId, project.identity)
        safeLocalStorageRemove(`williamos:agent-session:${encodeURIComponent(targetWorldId)}:${encodeURIComponent(project.identity)}`)
      }
      removeToolRunHistory(window.localStorage, `server:${targetWorldId}`)
      removeDiffBrowserSnapshot(window.localStorage, `server:${targetWorldId}`)
      setTransitionMessage(null)
      return true
    } catch (error) {
      setTransitionMessage(error instanceof Error ? error.message : "Space removal failed. Nothing was removed.")
      return false
    } finally {
      setSwitchingSpace(false)
    }
  }

  const missionWindowKind: Record<WindowId, MissionControlSpaceProjection["windows"][number]["kind"]> = {
    editor: "source", "running-app": "preview", tests: "tests", diff: "diff", terminal: "terminal",
  }
  const executionAssignmentExpected = storage === "server" && Boolean(worldId) && Boolean(spine.outcomeKey) && spine.workOrderId !== null
  const currentAgentCollectionKnown = (agentSessions.collectionState === "available" || agentSessions.collectionState === "missing")
    && (!executionAssignmentExpected || boundExecutionObservation?.state === "fresh")
  const currentMissionAgents = currentAgentCollectionKnown
    ? agentSessions.sessions
    : agentSessions.sessions.filter((agent) => agent.truth !== "resume-unverified")
  const currentMissionSpace: MissionControlSpaceProjection = {
    id: worldId ?? space.id,
    name: space.name,
    updatedAt: spaceSummaries.find((summary) => summary.worldId === worldId)?.updatedAt ?? null,
    focus: space.selectedPath ?? "Development Space",
    state: space.runningAppUrl ? "live" : "unavailable",
    truth: "live",
    windows: (Object.entries(space.windows) as [WindowId, WindowGeometry][]).map(([id, geometry]) => ({
      id, title: windowName[id], kind: missionWindowKind[id],
      frame: geometry, minimized: geometry.minimized, active: space.activeWindowId === id,
      detail: id === "running-app" ? space.runningAppUrl ? "Target runtime attached" : "Runtime unavailable" : undefined,
    })),
    agents: projectMissionAgentSessions(currentMissionAgents, true),
    agentActivityKnown: currentAgentCollectionKnown,
    selectedObject: space.selectedPath,
    changed: savedLabel,
  }
  const missionSpaces: readonly MissionControlSpaceProjection[] = spaceSummaries.map((summary) => {
    if (summary.worldId === worldId) return currentMissionSpace
    const restored = qualifyLegacyWorkspaceFiles(
      normalizeSpace(
        summary.space,
        defaultSpace(window.innerWidth, window.innerHeight, summary.worldId, summary.name),
        { width: window.innerWidth, height: window.innerHeight },
      ),
      project,
    )
    const savedAgents = project
      ? loadSavedAgentSessionProjection(summary.worldId, project.identity)
      : { state: "missing" as const, sessions: [] }
    return {
      id: summary.worldId,
      name: summary.name,
      updatedAt: summary.updatedAt,
      focus: restored.selectedPath ?? "Preserved work surface",
      state: "saved",
      truth: "live",
      windows: (Object.entries(restored.windows) as [WindowId, WindowGeometry][]).map(([id, geometry]) => ({
        id, title: windowName[id], kind: missionWindowKind[id], frame: geometry,
        minimized: geometry.minimized, active: restored.activeWindowId === id,
        detail: id === "running-app" ? restored.runningAppUrl ? "Target runtime attached" : "Runtime unavailable" : undefined,
      })),
      agents: savedAgents.state === "available" ? projectMissionAgentSessions(savedAgents.sessions, false) : [],
      agentActivityKnown: savedAgents.state === "available",
      selectedObject: restored.selectedPath,
      changed: "Saved spatial state",
    }
  })
  const missionOverview = deriveMissionControlOverview({
    spaces: missionSpaces,
    currentSpaceId: worldId,
    currentSpaceJudgment: judgment?.recommendation ?? null,
    collectionAvailable: spaceCollectionAvailable,
    collectionReason: spaceCollectionReason,
    persistence: {
      state: persistenceError ? "failed" : persistencePending ? "saving" : "saved",
      error: persistenceError,
    },
  })
  const assignmentRefreshMessage = boundExecutionObservation?.state === "stale"
    ? `Assignment refresh unavailable · last persisted observation ${boundExecutionObservation.observedAt ?? "not recorded"} · runtime liveness unverified`
    : boundExecutionObservation?.state === "mismatch"
      ? `Work Order #${boundExecutionObservation.workOrderId} assignment could not be verified for this Space`
      : null

  function openObjectAction(action: string) {
    if (action === "Delegate unavailable") return
    if (action === "Merge unavailable") return
    if (selectedAgent?.kind === "world-worker" && action === "Inspect") {
      materializeExecutionAssignment(selectedAgent.id)
      return
    }
    if (selectedAgent?.kind === "durable-session" && action === "Inspect") {
      materializeDurableAgentSession(selectedAgent.id)
      return
    }
    if (selectedAgent?.kind === "durable-session" && action === "Ask William") {
      const descriptor = agentSessions.savedSessions.find(
        (candidate) => lineSessionKey(candidate.provider, candidate.sessionId) === selectedAgent.id,
      )
      if (!worldId || !descriptor || agentSessions.collectionState !== "available"
        || agentSessions.selectedSessionKey !== selectedAgent.id) {
        setTransitionMessage("That browser-saved session is no longer selected and available.")
        return
      }
      const sessionKey = selectedAgent.id
      const capturedWorldId = worldId
      const capturedTransitionEpoch = transitionEpochRef.current
      const descriptorFingerprint = lineSessionDescriptorFingerprint(descriptor)
      const collectionFingerprint = lineSessionCollectionFingerprint(agentSessions.savedSessions)
      void durableLineSnapshot(sessionKey, descriptor, new Date().toISOString()).then((snapshot) => {
        const exactDescriptor = agentSavedSessionsRef.current.find(
          (candidate) => lineSessionKey(candidate.provider, candidate.sessionId) === sessionKey,
        )
        if (worldRef.current !== capturedWorldId
          || transitionEpochRef.current !== capturedTransitionEpoch
          || agentCollectionStateRef.current !== "available"
          || agentSelectedSessionKeyRef.current !== sessionKey
          || focusedAgentIdRef.current !== sessionKey
          || !exactDescriptor
          || lineSessionDescriptorFingerprint(exactDescriptor) !== descriptorFingerprint
          || lineSessionCollectionFingerprint(agentSavedSessionsRef.current) !== collectionFingerprint) {
          setTransitionMessage("The selected browser-saved session changed before William opened, so no advice was requested.")
          return
        }
        openLine("", "william", {
          ...snapshot,
          clientGuard: { worldId: capturedWorldId, transitionEpoch: capturedTransitionEpoch, descriptorFingerprint, collectionFingerprint },
        })
      })
      return
    }
    if (selectedAgent?.kind === "world-worker" && action === "Ask William") {
      const exact = boundExecutionSession
      if (!exact || exact.id !== selectedAgent.id) {
        setTransitionMessage("That persisted assignment is no longer bound to this Space.")
        return
      }
      openLine("", "william", { kind: "execution-assignment", workOrderId: exact.workOrderId })
      return
    }
    if (selectedKind === "space" && action === "Summarize") {
      openLine("", "william", "space-summary")
      void sendWilliamTurn("Summarize this exact current Space.", "space-summary")
      return
    }
    if (selectedKind === "space" && action === "Continue") {
      const candidate = spaceContinueCandidate
      if (!candidate || !worldId) return
      const key = `${candidate.provider}:${candidate.sessionId}`
      const projected = agentSessions.sessions.find((session) => session.id === key)
      if (!projected || !agentSessions.selectSession(key)) return
      setFocusedAgentId(key)
      const starting = resumeSessionInFlightKeys.includes(key)
      if (agentSessions.activeSessionIds.includes(key) || starting) {
        const exactContext = durableSessionDelegateContext(projected)
        if (!exactContext) return
        setDelegateContext(exactContext)
        // Reattachment observes the turn already owned by its original presentation epoch. Opening
        // a new agent intent here would invalidate that owner and strand its natural settlement.
        setLineTarget("agent")
        setLineContext(null)
        setForkContext(null)
        setLineMode("default")
        setLineInput("")
        setLineTargetPickerOpen(false)
        setLineOpen(true)
        requestAnimationFrame(() => lineRef.current?.focus())
        setLineReply(starting ? "Agent is starting." : projected.presentation ?? "Agent is working.")
        return
      }
      setDelegateContext({
        kind: "continue",
        label: `${candidate.role} · ${candidate.provider} · ${candidate.assignment}`,
        provider: candidate.provider,
        role: candidate.role,
        assignment: candidate.assignment,
        sessionKey: key,
        sessionId: candidate.sessionId,
        worldId,
        transitionEpoch: transitionEpochRef.current,
        collectionFingerprint: lineSessionCollectionFingerprint(agentSessions.savedSessions),
        descriptorFingerprint: lineSessionDescriptorFingerprint(candidate),
        objectBinding: { kind: "space", worldId, revision: space.revision },
      })
      automaticSpaceContinueSessionKeyRef.current = key
      automaticSpaceContinueOperationIdRef.current = null
      automaticSpaceContinueBaselineTurnIdsRef.current = new Set(agentSessions.activeTurns.map((turn) => turn.id))
      setAutomaticSpaceContinueRunning(true)
      setAutomaticSpaceContinuePending(true)
      openLine("", "agent")
      setLineReply("Agent is working.")
      return
    }
    if (action === "Continue unavailable") return
    if (selectedKind === "preview" && action === "Inspect") {
      void inspectPreviewEvidence()
      return
    }
    if (selectedKind === "preview" && action === "Debug") {
      // A pre-acceptance transport has no provider session id yet. Starting only while the
      // operation collection is empty makes its synthetic active-turn id an exact, non-foreign
      // cancellation target until Claude accepts a durable session key.
      if (!worldId || !project || agentActiveTurnsRef.current.length !== 0 || !agentSessions.selectSession(null)) return
      previewDebugSessionKeyRef.current = null
      previewDebugStopRequestedRef.current = false
      setAutomaticPreviewDebugRunning(true)
      setAutomaticPreviewDebugPending(true)
      setFocusedAgentId(null)
      setDelegateContext({
        kind: "preview",
        label: selectedLabel,
        provider: "Claude",
        role: "Preview debugger",
        assignment: "Developer Preview diagnosis",
        previewDebugBinding: {
          worldId,
          transitionEpoch: transitionEpochRef.current,
          revision: space.revision,
          runningAppUrl: space.runningAppUrl,
          projectIdentity: project.identity,
        },
      })
      openLine("", "agent")
      return
    }
    if (selectedKind === "preview" && action === "Explain unavailable") return
    if (selectedKind === "preview" && action === "Explain") {
      const requestWorldId = worldId
      const requestProjectIdentity = project?.identity ?? null
      const requestEpoch = transitionEpochRef.current
      const requestPath = space.selectedPath
      const requestRunningAppUrl = space.runningAppUrl
      const requestId = previewEvidenceRequestRef.current + 1
      previewEvidenceRequestRef.current = requestId
      previewExplainEvidenceRef.current = null
      if (!requestWorldId || !requestProjectIdentity || !requestPath || previewExplainUnavailableReason) return
      void (async () => {
        try {
          const response = await fetch("/api/environment/preview", { cache: "no-store" })
          const body = await response.json() as unknown
          const evidence = body && typeof body === "object" ? (body as Record<string, unknown>).evidence : null
          const payload = response.ok ? parsePreviewInspectorPayload({ evidence, snapshot: "live" }) : null
          if (!payload) throw new Error("PREVIEW_EVIDENCE_UNAVAILABLE")
          if (previewEvidenceRequestRef.current !== requestId
            || worldRef.current !== requestWorldId
            || projectRef.current?.identity !== requestProjectIdentity
            || transitionEpochRef.current !== requestEpoch
            || stateRef.current.activeWindowId !== "running-app"
            || stateRef.current.runningAppUrl !== requestRunningAppUrl
            || stateRef.current.selectedPath !== requestPath
            || dirtyPathsRef.current[requestPath]) throw new Error("LINE_CONTEXT_STALE")
          previewExplainEvidenceRef.current = {
            worldId: requestWorldId,
            transitionEpoch: requestEpoch,
            requestId,
            projectIdentity: requestProjectIdentity,
            payload,
          }
          savePreviewEvidenceSnapshot(requestWorldId, requestProjectIdentity, payload)
          const context: PreviewExplainLineContext = {
            kind: "preview-explain",
            projectKey,
            previewFingerprint: payload.evidence.fingerprint,
            selectedPath: requestPath,
            clientGuard: {
              worldId: requestWorldId,
              transitionEpoch: requestEpoch,
              requestId,
              projectIdentity: requestProjectIdentity,
              runningAppUrl: requestRunningAppUrl,
              status: payload.evidence.status,
              identity: payload.evidence.identity,
              origin: payload.evidence.origin,
            },
          }
          openLine("", "william", context)
          void sendWilliamTurn("Explain the exact current developer Preview.", context)
        } catch (error) {
          if (worldRef.current === requestWorldId && transitionEpochRef.current === requestEpoch) {
            const message = error instanceof Error ? error.message : "PREVIEW_EVIDENCE_UNAVAILABLE"
            setTransitionMessage(message)
            setWilliamError(message)
          }
        }
      })()
      return
    }
    if (action === "Pause") {
      if (selectedAgent?.kind !== "durable-session" || !agentSessions.pausableSessionIds.includes(selectedAgent.id)) return
      agentSessions.stop(selectedAgent.id)
      if (lineTarget === "agent") {
        setLineOpen(false)
        setLineInput("")
        setLineReply(null)
        setLineBusy(false)
        setDelegateContext(null)
        setLineTarget("william")
      }
      return
    }
    if (action === "Pause unavailable") return
    if (action === "Fork") {
      if (!forkEligible || agentSessions.activeSessionIds.length !== 0 || !selectedAgent?.id.startsWith("Claude:")) return
      setForkContext({
        sourceSessionId: selectedAgent.id.slice("Claude:".length),
        assignment: selectedAgent.assignment,
        label: `${selectedAgent.role} · Claude`,
      })
      setDelegateContext(null)
      setLineTarget("agent")
      setLineMode("fork")
      setLineInput("")
      setLineReply(null)
      setLineTargetPickerOpen(false)
      setLineOpen(true)
      requestAnimationFrame(() => lineRef.current?.focus())
      return
    }
    if (action === "Fork unavailable") return
    if (action === "Change" && selectedKind === "file") {
      openChange()
      return
    }
    if (action === "Review" && selectedKind === "file") {
      openReview()
      return
    }
    if (selectedKind === "diff" && action === "Improve") {
      openDiffImprove()
      return
    }
    if (selectedKind === "diff" && action === "Review") {
      openDiffReview()
      return
    }
    if (selectedKind === "diff" && action === "Review unavailable") return
    if (selectedKind === "diff" && action === "Challenge unavailable") return
    if (selectedKind === "diff" && action === "Challenge") {
      const live = liveDiffContextRef.current
      const identity = liveModifiedDiffIdentity(live)
      if (!worldId || !identity || live?.worldId !== worldId || identity.path !== space.selectedPath
        || storageRef.current !== "server" || persistencePendingRef.current || persistenceErrorRef.current
        || dirtyPathsRef.current[identity.path]) {
        setTransitionMessage("Challenge needs the exact live modified patch for the durably saved selected file.")
        return
      }
      const context: DiffChallengeLineContext = {
        kind: "diff-challenge",
        projectKey,
        ...identity,
        clientGuard: { worldId, transitionEpoch: transitionEpochRef.current },
      }
      openLine("", "william", context)
      void sendWilliamTurn("Challenge the exact current patch for the selected file.", context)
      return
    }
    if (selectedKind === "file" && action === "Ask") {
      const selectedPath = space.selectedPath
      const activePane = space.editor.panes.find((pane) => pane.id === space.editor.activePaneId) ?? null
      if (!worldId || !project || storageRef.current !== "server" || persistencePendingRef.current
        || persistenceErrorRef.current || !selectedPath || dirtyPathsRef.current[selectedPath]
        || space.activeWindowId !== "editor" || !activePane || activePane.activePath !== selectedPath
        || !activePane.selection) {
        setTransitionMessage("Ask needs the exact durably saved selected file in a server-bound Space.")
        return
      }
      const context: FileAskLineContext = {
        kind: "file-ask",
        projectKey,
        path: selectedPath,
        projectIdentity: project.identity,
        revision: space.revision,
        activePaneId: activePane.id,
        selection: { anchor: activePane.selection.anchor, head: activePane.selection.head },
        clientGuard: { worldId, transitionEpoch: transitionEpochRef.current },
      }
      openLine("", "william", context)
      return
    }
    if (action === "Council") {
      void summonCouncil(`Challenge the current direction for ${selectedLabel}.`)
      return
    }
    if (action === "Ask") {
      setWilliamInput(`About ${selectedLabel}: `)
      setWilliamRailOpen(true)
      return
    }
    if (action === "Delegate") {
      if (selectedKind === "preview") {
        if (!worldId || !project || storageRef.current !== "server"
          || persistencePendingRef.current || persistenceErrorRef.current
          || acknowledgedRevisionRef.current !== space.revision
          || agentActiveTurnsRef.current.length !== 0
          || !space.runningAppUrl || space.activeWindowId !== "running-app"
          || space.windows["running-app"].minimized) {
          setTransitionMessage("Delegate needs the exact active durably saved Developer Preview.")
          return
        }
        if (!agentSessions.selectSession(null)) return
        setFocusedAgentId(null)
        previewDebugSessionKeyRef.current = null
        previewDebugStopRequestedRef.current = false
        setDelegateContext({
          kind: "preview",
          label: selectedLabel,
          provider: null,
          role: "Preview debugger",
          assignment: "Developer Preview diagnosis",
          previewDebugBinding: {
            worldId,
            transitionEpoch: transitionEpochRef.current,
            revision: space.revision,
            runningAppUrl: space.runningAppUrl,
            projectIdentity: project.identity,
          },
        })
      } else if (selectedKind === "space") {
        const path = space.selectedPath
        const outcomeKey = spine.outcomeKey
        const workOrderId = spine.workOrderId
        const proofs = spaceDelegateEligibility
        if (spaceDelegateUnavailableReason || (!proofs.codex && !proofs.claude)
          || !worldId || !project || !path || !outcomeKey || workOrderId === null) {
          setTransitionMessage(spaceDelegateUnavailableReason
            ?? "Delegate requires a current server-derived exact-path authority proof for Codex or Claude.")
          return
        }
        if (!agentSessions.selectSession(null)) return
        setFocusedAgentId(null)
        const label = `Space assignment · exact selected file ${path}`
        setDelegateContext({
          kind: "file",
          label,
          provider: null,
          role: "Builder",
          assignment: label,
          fileAssignmentProofs: proofs,
          fileAssignmentProofSource: "space",
        })
      } else if (selectedKind === "file") {
        const path = space.selectedPath
        const outcomeKey = spine.outcomeKey
        const workOrderId = spine.workOrderId
        const proofs = fileDelegateEligibility
        if (fileDelegateUnavailableReason || !worldId || !project || !path || !outcomeKey
          || workOrderId === null || (!proofs.codex && !proofs.claude)) {
          setTransitionMessage(fileDelegateUnavailableReason
            ?? "Delegate requires a current server-derived exact-path authority proof for Codex or Claude.")
          return
        }
        if (!agentSessions.selectSession(null)) return
        setFocusedAgentId(null)
        const label = `File assignment · exact selected file ${path}`
        setDelegateContext({
          kind: "file", label, provider: null, role: "Builder", assignment: label,
          fileAssignmentProofs: proofs,
        })
      } else {
        if (!agentSessions.selectSession(null)) return
        setFocusedAgentId(null)
        setDelegateContext({ kind: selectedKind, label: selectedLabel, provider: null, role: "Builder", assignment: selectedLabel })
      }
      openLine("", "agent")
      return
    }
    if (action === "Review work" && selectedAgent?.kind === "durable-session" && selectedAgent.target) {
      openAgentWorkReview(selectedAgent.id, selectedAgent.target.path)
      return
    }
    if (selectedAgent?.kind === "durable-session" && (action === "Talk" || action === "Redirect")) {
      const exactContext = durableSessionDelegateContext(selectedAgent)
      if (!exactContext) {
        setDelegateContext(null)
        setLineOpen(false)
        return
      }
      setDelegateContext(exactContext)
      openLine(selectedAgent.providerLabel === "Local" || selectedAgent.mode === "review" || selectedAgent.mode === "diff-review" ? "" : `${action}: `, "agent")
      return
    }
    openLine(`${action} this selected ${selectedKindLabel}: `)
  }

  function chooseDelegateProvider(provider: "Codex" | "Claude") {
    setDelegateContext((current) => {
      if (!current || current.kind === "reviewer") return current
      if (current.kind !== "file") return { ...current, provider }
      const actor = provider.toLowerCase() as "codex" | "claude"
      if (current.fileAssignmentBinding) {
        return current.fileAssignmentBinding.actor === actor ? { ...current, provider } : current
      }
      const proof = current.fileAssignmentProofs?.[actor]
      const currentProject = projectRef.current
      if (!proof || !currentProject) return current
      const binding: NonNullable<StandardDelegateContext["fileAssignmentBinding"]> = {
        worldId: proof.worldId,
        transitionEpoch: transitionEpochRef.current,
        projectIdentity: currentProject.identity,
        outcomeKey: proof.outcomeKey,
        workOrderId: proof.workOrderId,
        grantId: proof.grantId,
        worldRevision: proof.worldRevision,
        path: proof.selectedPath,
        actor,
        proofSource: current.fileAssignmentProofSource ?? "file",
        ...(proof.repository ? { repository: proof.repository } : {}),
      }
      return exactFileAssignmentBindingIsCurrent(binding)
        ? { ...current, provider, fileAssignmentBinding: binding }
        : current
    })
  }

  function openLocalConversation() {
    if (!agentSessions.selectSession(null)) return
    setFocusedAgentId(null)
    setDelegateContext({ kind: "conversation", label: "Local model", provider: "Local", role: "Thinker", assignment: "Conversation" })
    openLine("", "agent")
  }

  async function handleCouncilAction(action: CouncilAdvisoryAction) {
    const session = councilSession
    if (!session) return
    if (action === "ask-dissent" || action === "run-another-pass") {
      const challenge = action === "ask-dissent"
        ? `Challenge this recommendation with the strongest credible dissent: ${session.recommendation}`
        : `Run another independent pass on this question, explicitly testing the prior recommendation: ${session.question}`
      void summonCouncil(challenge)
      return
    }
    if (!worldId || storage !== "server") {
      setCouncilError("Owner direction needs an open persistent server Space.")
      return
    }
    const requestWorldId = worldId
    const requestTransitionEpoch = transitionEpochRef.current
    const requestCouncilEpoch = councilViewEpochRef.current
    const requestIsCurrent = () => worldRef.current === requestWorldId
      && transitionEpochRef.current === requestTransitionEpoch
      && councilViewEpochRef.current === requestCouncilEpoch
      && councilSessionRef.current?.id === session.id
      && councilSessionRef.current.createdAt === session.createdAt
    setCouncilBusy(true)
    setCouncilError(null)
    try {
      const response = await fetch("/api/environment/council", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worldId: requestWorldId,
          sessionId: session.id,
          sessionCreatedAt: session.createdAt,
          direction: action,
        }),
        cache: "no-store",
      })
      const payload = await response.json() as { error?: string; session?: BrainCouncilSession }
      if (!requestIsCurrent()) return
      if (response.status === 409 && payload.error === "COUNCIL_DISPOSITION_CONFLICT" && payload.session) {
        setCouncilSession(payload.session)
        setCouncilHistory((current) => current.map((entry) => entry.id === payload.session!.id ? payload.session! : entry))
        setCouncilError(payload.error)
        return
      }
      if (!response.ok || !payload.session) throw new Error(payload.error ?? `COUNCIL_DISPOSITION_${response.status}`)
      setCouncilSession(payload.session)
      setCouncilHistory((current) => current.map((entry) => entry.id === payload.session!.id ? payload.session! : entry))
    } catch (error) {
      if (requestIsCurrent()) setCouncilError(error instanceof Error ? error.message : "Owner direction could not be recorded.")
    } finally {
      if (requestIsCurrent()) setCouncilBusy(false)
    }
  }

  const selectedRepository = project?.repositories?.find((repository) => repository.key === space.selectedFileRef?.repositoryResourceKey)
    ?? project?.repositories?.find((repository) => repository.defaultRepository)
    ?? null
  const repositoryViews: readonly RepositoryShelfRepository[] = (project?.repositories ?? []).map((repository) => ({
    repositoryKey: repository.key,
    ...(repository.repositoryResourceId ? { repositoryResourceId: repository.repositoryResourceId } : {}),
    name: repository.label,
    canonicalIdentity: repository.identity,
    role: repository.role,
    ...(repository.suite ? { suite: repository.suite } : {}),
    workingSet: repository.defaultRepository || Boolean(space.editor.openFileRefs?.some((file) => file.repositoryResourceKey === repository.key)),
    active: selectedRepository?.key === repository.key,
    readOnly: !repository.mount.verified,
    preview: repository.previewSource ? "source" : "none",
    mounts: repository.mount.configured ? [{
      id: repository.mount.key,
      node: "Current host",
      label: repository.mount.verified ? "verified checkout" : "configured mount",
      branch: repository.mount.branch ?? "branch unavailable",
      revision: repository.mount.revision ?? repository.mount.refusal ?? "revision unavailable",
      status: repository.mount.verified ? "ready" : "unavailable",
      cleanliness: "unknown",
    }] : [],
    entries: [],
    agents: agentSessions.sessions.filter((session) => session.repository?.resourceKey === repository.key).map((session) => ({
      id: session.id,
      name: session.providerLabel,
      role: session.role,
      activity: session.presentation ?? session.assignment,
      state: session.status === "working" || session.status === "thinking"
        ? session.role === "Reviewer" ? "reviewing" as const : "working" as const
        : session.status === "blocked" ? "blocked" as const : "waiting" as const,
    })),
  }))
  const repositoryRelationships: readonly RepositoryRelationship[] = repositoryViews.flatMap((repository): RepositoryRelationship[] => {
    if (repository.role === "suite-source") return [{
      id: `${repository.repositoryKey}:os-1`,
      fromRepositoryKey: repository.repositoryKey,
      toRepositoryKey: "os-1",
      label: `${repository.name} integration`,
      kind: "consumed-by" as const,
      status: "waiting" as const,
      detail: "No assimilated artifact evidence is attached to the current Space.",
    }]
    if (repository.role === "sovereign-planning-and-promotion") return [{
      id: `${repository.repositoryKey}:os-1`,
      fromRepositoryKey: repository.repositoryKey,
      toRepositoryKey: "os-1",
      label: "Sovereign planning context",
      kind: "informs" as const,
      status: "reference" as const,
      detail: "Planning and promotion context only; runtime dependency is none.",
    }]
    return []
  })
  const changeSetModel = changeSetProjection
    ? changeSetSurfaceModel(changeSetProjection, (project?.repositories ?? []).map((repository) => ({
        key: repository.key,
        label: repository.label,
        role: repository.role,
      })))
    : null
  const pendingSuiteChanges: readonly PendingSuiteChange[] = (changeSetProjection?.units ?? []).flatMap((unit) => {
    const repository = project?.repositories?.find((candidate) => candidate.key === unit.repository.key)
    if (repository?.role !== "suite-source" || !repository.suite || !unit.git.revision) return []
    return [{
      suite: repository.label,
      repositoryKey: repository.key,
      revision: unit.git.revision,
      state: unit.delivery.state === "sealed" ? "delivery-sealed" as const : "repository-changed" as const,
      detail: "No runtime-composition attestation links this exact repository delivery to the running Preview.",
    }]
  })
  const sovereignRepository = project?.repositories?.find((repository) => repository.role === "sovereign-planning-and-promotion") ?? null
  const sovereignContext = sovereignRepository?.mount.verified && sovereignRepository.mount.revision
    ? { repositoryName: sovereignRepository.label, revision: sovereignRepository.mount.revision }
    : null
  const toolRunRepositorySuffix = selectedRepository ? `:repository:${selectedRepository.key}` : ""
  const toolRunHistoryScope = storage === "server" && worldId
    ? `server:${worldId}${toolRunRepositorySuffix}`
    : storage === "browser" && browserStorageKeyRef.current
      ? `browser:${browserStorageKeyRef.current}${toolRunRepositorySuffix}`
      : null

  return (
    <main className={`${spatial.environment} ${bridge.tokens}`} aria-label={`${project?.name ?? "Workspace"} Space`}>
      <header className={spatial.topBar}>
        <div className={spatial.identity}>
          <span className={spatial.mark} aria-label="WilliamOS">W</span>
          <span className={spatial.spaceIdentity} aria-label="Workspace project" title={project?.identity ?? "Resolving configured workspace"}>
            <strong>{project?.name ?? "Opening workspace"}</strong>
            <span className={spatial.spacePath}>{project?.identity ?? ""}</span>
          </span>
        </div>
        <div className={spatial.agentPresence}>
        <AgentSessionStrip sessions={agentSessions.sessions} activeSessionId={focusedAgentId} runningTurns={agentSessions.activeTurns} onStop={agentSessions.stop} className={spatial.sessionStrip} onSelect={(agent) => {
          if (!agentSessions.selectSession(agent.kind === "durable-session" ? agent.id : null)) return
          if (agent.kind === "world-worker") {
            setFocusedAgentId(agent.id)
            setDelegateContext(null)
            setLineOpen(false)
            materializeExecutionAssignment(agent.id)
            return
          }
          const running = agentSessions.activeSessionIds.includes(agent.id)
          if (running && agent.kind === "durable-session") {
            setFocusedAgentId(agent.id)
            const exactContext = durableSessionDelegateContext(agent)
            if (!exactContext) {
              setDelegateContext(null)
              setLineOpen(false)
              return
            }
            setDelegateContext(exactContext)
            openLine("", "agent")
            setLineReply(agent.presentation ?? "Agent is working.")
            return
          }
          const reviewerContext = reviewerDelegateContext(agent)
          if (reviewerContext) {
            setFocusedAgentId(agent.id)
            setDelegateContext(reviewerContext)
            setLineOpen(false)
            return
          }
          setFocusedAgentId(agent.id)
          if (agent.kind === "durable-session") {
            const exactContext = durableSessionDelegateContext(agent)
            if (!exactContext) {
              setDelegateContext(null)
              setLineOpen(false)
              return
            }
            setDelegateContext(exactContext)
            openLine(agent.providerLabel === "Local" ? "" : "Redirect: ", "agent")
            setLineReply(null)
          }
        }} />
        {assignmentRefreshMessage ? <span className={spatial.assignmentRefresh} role="status">{assignmentRefreshMessage}</span> : null}
        </div>
        <div className={spatial.status}><span className={spatial.statusDot} aria-hidden /><span>{worldLine || "Space ready"}{workerLine}</span></div>
      </header>

      <div className={spatial.objectBar} aria-label="Selected object actions">
        <span className={spatial.objectLabel}><strong>Selected {selectedKindLabel}</strong> · {selectedLabel}</span>
        <div className={spatial.objectActions}>
          {selectedKind === "space" ? <ExternalWorkOrderAdmission
            worldId={worldId}
            persisted={storage === "server" && hydrated && !persistencePending && !persistenceError}
            bound={Boolean(spine.outcomeKey) && spine.workOrderId !== null}
            className={`${spatial.action} ${spatial.primaryAction}`}
            onAdmitted={async (admission) => {
              if (worldRef.current !== admission.worldId) return
              const response = await fetch(spaceEndpoint(projectKey, admission.worldId), { cache: "no-store" })
              const payload = await response.json() as SpaceEnvelope & { error?: string }
              if (!response.ok || payload.worldId !== admission.worldId || !payload.space) {
                throw new Error(payload.error ?? `SPACE_${response.status}`)
              }
              if (worldRef.current !== admission.worldId) return
              applySpaceEnvelope(payload)
            }}
            onFinalized={async () => {
              const activeWorldId = worldRef.current
              if (!activeWorldId) throw new Error("WORLD_NOT_FOUND")
              const response = await fetch(spaceEndpoint(projectKey, activeWorldId), { cache: "no-store" })
              const payload = await response.json() as SpaceEnvelope & { error?: string }
              if (!response.ok || payload.worldId !== activeWorldId || !payload.space) {
                throw new Error(payload.error ?? `SPACE_${response.status}`)
              }
              if (worldRef.current !== activeWorldId) return
              applySpaceEnvelope(payload)
            }}
          /> : null}
          {selectedActions.map((action) => (
            <button key={action} type="button" className={`${spatial.action} ${action === "Delegate" || action === "Council" || action === "Fork" ? spatial.primaryAction : ""}`} disabled={action === "Review work unavailable" || action === "Review unavailable" || action === "Challenge unavailable" || action === "Explain unavailable" || action === "Pause unavailable" || action === "Fork unavailable" || action === "Merge unavailable" || action === "Continue unavailable" || action === "Delegate unavailable" || action === "Improve" && Boolean(improveUnavailableReason)} aria-describedby={action === "Continue unavailable" ? "space-continue-unavailable" : action === "Delegate unavailable" && selectedKind === "space" ? "space-delegate-unavailable" : undefined} title={action === "Review work unavailable" ? "This session has no verified file target." : action === "Review unavailable" ? selectedKind === "file" ? fileReviewUnavailableReason ?? undefined : diffReviewUnavailableReason ?? undefined : action === "Challenge unavailable" ? diffChallengeUnavailableReason ?? undefined : action === "Explain unavailable" ? previewExplainUnavailableReason ?? undefined : action === "Pause unavailable" ? "Only the selected running session can be paused." : action === "Fork unavailable" ? "Only an idle verified Claude Builder session can be forked." : action === "Merge unavailable" ? "Current Changes actions are read-only; merge is unavailable here." : action === "Continue unavailable" ? continueUnavailableMessage : action === "Delegate unavailable" ? selectedKind === "file" ? fileDelegateUnavailableReason ?? undefined : spaceDelegateUnavailableReason ?? undefined : action === "Improve" ? improveUnavailableReason ?? undefined : undefined} onClick={() => openObjectAction(action)}>{action}</button>
          ))}
        </div>
        {selectedKind === "space" && !spaceContinueCandidate ? <span id="space-continue-unavailable" role="status">{continueUnavailableMessage}</span> : null}
        {selectedKind === "space" && spaceDelegateUnavailableReason ? <span id="space-delegate-unavailable" role="status">{spaceDelegateUnavailableReason}</span> : null}
      </div>

      <div className={spatial.windowLayer} aria-label="Spatial work surfaces">
        <WindowFrame id="editor" title="Source" geometry={space.windows.editor} active={space.activeWindowId === "editor"} onActivate={() => activate("editor")} onGeometry={(geometry) => updateWindow("editor", geometry)} onMinimize={() => minimize("editor")} minimizeDisabled={Boolean(sourceMinimizeDisabledReason)} minimizeDisabledReason={sourceMinimizeDisabledReason}>
          <EditorSurface key={worldId ?? "unhydrated"} project={project ?? undefined} projectName={project?.name ?? "Project"} projectKey={projectKey} requestedRepositoryKey={repositoryFocusKey} space={space} onEditorChange={(editor, selectedPath, selectedFileRef) => setSpace((current) => ({ ...current, editor, selectedPath, ...(selectedFileRef !== undefined ? { selectedFileRef } : {}) }))} onSelectedFileDirtyChange={onSelectedFileDirtyChange} reloadPath={changeRefresh.path} reloadKey={changeRefresh.key} onReloadSettled={(path, key, result) => settleChangeRefresh("editor", path, key, result)} />
        </WindowFrame>
        <WindowFrame id="running-app" title="Developer preview · TerraFusion" geometry={space.windows["running-app"]} active={space.activeWindowId === "running-app"} onActivate={() => activate("running-app")} onGeometry={(geometry) => updateWindow("running-app", geometry)} onMinimize={() => minimize("running-app")}>
          <div className={spatial.previewHost}>
            <button type="button" className={spatial.previewCompositionButton} onClick={() => void openRepositoryDeliverySurface("preview-composition")} aria-label="Inspect Preview composition" title="Inspect exact runtime composition"><Layers3 size={13} />Composition</button>
            {space.runningAppUrl ? <iframe src={space.runningAppUrl} title="Running TerraFusion application" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads" className="h-full w-full border-0" /> : (
              <div className="grid h-full place-content-center gap-3 p-8 text-center" role="status"><AppWindow className="mx-auto text-[#91a48c]" size={26} aria-hidden /><strong>Developer preview unavailable</strong><span className="max-w-md text-xs text-[#8e998b]">Attach the TerraFusion development runtime when you want the real target beside source. WilliamOS remains fully usable; no business workflow is being simulated.</span></div>
            )}
          </div>
        </WindowFrame>
        {(["tests", "diff", "terminal"] as const).map((id) => (
          <WindowFrame key={id} id={id} title={windowName[id]} geometry={space.windows[id]} active={space.activeWindowId === id} onActivate={() => activate(id)} onGeometry={(geometry) => updateWindow(id, geometry)} onMinimize={() => minimize(id)} minimizeDisabled={id === "diff" && change.running} minimizeDisabledReason={id === "diff" && change.running ? "Changes cannot be minimized while Change is active" : undefined}>
            <DeveloperToolsSurface key={`${worldId ?? "unhydrated"}:${id}`} kind={id} projectKey={projectKey} repositoryKey={selectedRepository?.key ?? null} repositoryLabel={selectedRepository?.label ?? null} worldId={worldId} selectedPath={space.selectedPath} active={space.activeWindowId === id} historyScope={toolRunHistoryScope} refreshKey={id === "diff" ? changeRefresh.key : 0} refreshPath={id === "diff" ? changeRefresh.path : null} onRefreshSettled={id === "diff" ? (path, key, result) => settleChangeRefresh("diff", path, key, result) : undefined} onLiveDiffContextChange={id === "diff" ? (context) => setLiveDiffContext((current) => {
              const next = context && worldId ? { ...context, worldId } : current?.worldId === worldId ? null : current
              liveDiffContextRef.current = next
              return next
            }) : undefined} onRunningChange={id === "diff" ? undefined : (running) => setRunningTools((current) => ({ ...current, [id]: running?.operationId ?? null }))} />
          </WindowFrame>
        ))}
        {inspectors.map((surface) => {
          const geometry = space.inspectorWindows[surface.id]
          if (!geometry) return null
          return <WindowFrame key={surface.id} id={surface.id} title={inspectorSurfaceWindowTitle(surface)} geometry={geometry} active={space.activeWindowId === surface.id} onActivate={() => activateInspector(surface.id)} onGeometry={(next) => updateInspector(surface.id, next)} onMinimize={() => updateInspector(surface.id, { ...geometry, minimized: true })} onClose={() => dismissInspector(surface.id)}><InspectorSurfaceView surface={surface} onRefresh={surface.kind === "preview-evidence" ? () => void inspectPreviewEvidence() : undefined} /></WindowFrame>
        })}
      </div>

      <nav className={spatial.dock} aria-label="Surface dock">
        {space.dock.map((id) => (
          <button key={id} type="button" className={`${spatial.dockButton} ${space.activeWindowId === id && !space.windows[id].minimized ? spatial.dockButtonActive : ""}`} onClick={() => activate(id)} aria-label={`${space.windows[id].minimized ? "Restore" : "Focus"} ${windowName[id]}`} title={windowName[id]}>
            {id === "editor" ? <Braces size={15} /> : id === "running-app" ? <AppWindow size={15} /> : id === "tests" ? <FlaskConical size={15} /> : id === "diff" ? <GitCompare size={15} /> : <TerminalSquare size={15} />}
          </button>
        ))}
        <button type="button" className={spatial.dockButton} onClick={() => setOverlay("mission-control")} aria-label="Open Mission Control" title="Mission Control"><Grid2X2 size={15} /></button>
        {repositoryViews.length > 1 ? <button type="button" className={spatial.dockButton} onClick={() => setOverlay("repository-map")} aria-label="Open Repository Map" title="Repository Map"><GitFork size={15} /></button> : null}
        {repositoryViews.length > 1 ? <button type="button" className={spatial.dockButton} onClick={() => void openRepositoryDeliverySurface("change-set")} aria-label="Open Change Set" title="Cross-repository Change Set"><GitPullRequest size={15} /></button> : null}
        <button type="button" className={spatial.dockButton} onClick={() => void openCouncilHistory()} aria-label="Open Brain Council" title="Brain Council"><Users size={15} /></button>
      </nav>

      <WilliamConversationRail
        conversation={conversation}
        judgment={williamJudgment}
        input={williamInput}
        busy={williamBusy}
        ready={williamReady}
        judgmentBusy={judgmentBusy}
        canThinkAgain={storage === "server"}
        canInspectJudgment={Boolean(currentInspectableJudgment)}
        canOverrideJudgment={Boolean(currentInspectableJudgment)}
        error={williamError}
        open={williamRailOpen}
        escapeDismissEnabled={!lineOpen && overlay === null}
        persistenceLabel={savedLabel}
        persistenceError={persistenceError}
        onInput={setWilliamInput}
        onSubmit={() => {
          const submittedDraft = williamInput
          const text = submittedDraft.trim()
          if (!text) return
          void sendWilliamTurn(text, null, true).then((sent) => {
            if (sent) setWilliamInput((current) => current === submittedDraft ? "" : current)
          })
        }}
        onOpen={() => setWilliamRailOpen(true)}
        onClose={() => setWilliamRailOpen(false)}
        onThinkAgain={() => void refreshWilliamJudgment()}
        onInspectJudgment={openWilliamJudgmentInspector}
        onOverrideJudgment={overrideWilliamJudgment}
        onCouncil={() => void summonCouncil(`Challenge William's recommendation: ${williamJudgment}`)}
        onOpenLocal={openLocalConversation}
        onOpenLine={() => openLine()}
      />

      {lineOpen ? (
        <div className={spatial.lineBackdrop} role="dialog" aria-label="The Line" aria-modal="true" onPointerDown={(event) => { if (event.target === event.currentTarget && !change.running && !review.running) { if (lineTarget === "agent") { agentPresentationEpochRef.current += 1; setLineBusy(false) } setLineOpen(false) } }}>
          <form className={spatial.line} onSubmit={submitLine} aria-label={lineMode === "change" ? changeIntent === "improve-diff" ? "Improve current change" : "Change" : lineMode === "review" ? "Review" : lineMode === "fork" ? "Fork session" : "The Line"}>
            <Command size={16} aria-hidden />
            <div>
              {lineTargetPickerOpen && lineMode === "default" ? <div role="group" aria-label="Line targets">
                <button type="button" className={spatial.lineClose} aria-pressed={lineTarget === "william"} aria-label="William" onClick={() => {
                  agentPresentationEpochRef.current += 1
                  setLineTarget("william")
                  setDelegateContext(null)
                  setLineBusy(false)
                  setLineReply(null)
                }}>William</button>
                {verifiedLineSessionTargets.map((target) => <button key={target.sessionKey} type="button" className={spatial.lineClose} aria-pressed={delegateContext?.kind === "line-session" && delegateContext.sessionKey === target.sessionKey} aria-label={`${target.label} · session ${target.descriptor.sessionId}`} title={`${target.label} · session ${target.descriptor.sessionId}`} onClick={() => selectLineSessionTarget(target)}>{target.label}</button>)}
              </div> : null}
              {lineTranscriptSession ? <AgentTranscriptHistory key={lineTranscriptSession.sessionKey} {...lineTranscriptSession} /> : null}
              <span className={spatial.lineContext}>{lineMode === "change" ? changeIntent === "improve-diff" ? `Improve current change · ${change.path ?? "no file selected"}` : `Change · ${change.path ?? "no file selected"}` : lineMode === "review" ? capturedDiffReview ? `Review current change · ${review.path ?? "no file selected"}` : `Review · ${review.path ?? "no file selected"}` : lineMode === "fork" ? `Fork · ${forkContext?.label ?? "Claude Builder"}` : lineContext === "space-summary" ? "Exact current Space · server-grounded · read-only" : lineContext && typeof lineContext === "object" && lineContext.kind === "execution-assignment" ? `Persisted assignment · Work Order #${lineContext.workOrderId} · runtime liveness unverified` : lineContext && typeof lineContext === "object" && lineContext.kind === "agent-snapshot" ? `Browser-saved session snapshot · ${lineContext.sessionKey} · runtime liveness unverified` : lineContext && typeof lineContext === "object" && lineContext.kind === "diff-challenge" ? `Challenge exact patch · ${lineContext.path} · ${lineContext.patchHash}` : lineContext && typeof lineContext === "object" && lineContext.kind === "preview-explain" ? `Preview ${lineContext.clientGuard.status} · ${lineContext.clientGuard.identity} · ${lineContext.clientGuard.origin ?? "origin unavailable"} · source ${lineContext.selectedPath} · DOM unavailable · console unavailable · network unavailable` : lineContext && typeof lineContext === "object" && lineContext.kind === "file-ask" ? `Exact saved file · ${lineContext.path} · ${lineContext.projectIdentity} · read-only` : delegateContext?.kind === "continue" ? `Continue · ${delegateContext.label} · verification pending` : delegateContext?.kind === "line-session" ? `${delegateContext.label} · ${delegateContext.objectContext} · ${delegateContext.spaceContext}` : reviewerAgentContext ? `Reviewer · Claude · ${reviewerAgentContext.reviewPath} · read-only` : delegateContext?.kind === "preview" && delegateContext.previewDebugBinding ? "Preview debugger · Claude · read-only" : delegateContext?.kind === "file" && (delegateContext.fileAssignmentBinding || delegateContext.fileAssignmentProofs) ? delegateContext.label : delegateContext?.provider === "Local" ? "Local conversation · no workspace mutation" : lineTarget === "agent" && delegateContext ? `${delegateContext.kind} · ${delegateContext.label}` : `${selectedKind} · ${selectedLabel}`}</span>{lineMode === "review" && agentWorkReview || automaticPreviewDebugRunning || automaticSpaceContinueRunning || lineBusy && delegateContext?.kind === "preview" && Boolean(delegateContext.previewDebugBinding) ? null : <input ref={lineRef} className={spatial.lineInput} value={lineInput} onChange={(event) => setLineInput(event.target.value)} disabled={lineContext === "space-summary" || lineMode === "default" && lineTarget === "william" && !williamReady || (lineMode === "change" && change.running) || (lineMode === "review" && review.running)} placeholder={lineMode === "change" ? changeIntent === "improve-diff" ? "Describe how to improve this exact patch" : "Describe the change to make" : lineMode === "review" ? "Optional review focus" : lineMode === "fork" ? "Describe how the fork should diverge" : reviewerAgentContext ? "Ask or redirect this Reviewer" : delegateContext?.kind === "preview" && delegateContext.previewDebugBinding ? "Describe the bounded diagnostic focus" : delegateContext?.provider === "Local" ? "Ask the Local model" : lineTarget === "agent" ? "Describe the bounded assignment" : "Ask, change, delegate, or review"} aria-label={lineMode === "change" ? changeIntent === "improve-diff" ? "Improve instruction" : "Change instruction" : lineMode === "review" ? "Review focus" : lineMode === "fork" ? "Fork instruction" : "The Line"} autoComplete="off" />}{lineMode === "change" ? (change.progress ? <output className={spatial.lineReply}>{change.progress}</output> : change.outcome ? <output className={spatial.lineReply}>{change.outcome}</output> : null) : lineMode === "review" ? (review.progress ? <output className={spatial.lineReply}>{review.progress}</output> : review.outcome ? <output className={spatial.lineReply}>{review.outcome}</output> : null) : lineReply ?? lineTerminalReply ? <output className={spatial.lineReply}>{lineReply ?? lineTerminalReply}</output> : conversation.at(-1) ? <span className={spatial.lineReply}>{conversation.at(-1)?.role === "williamos" ? "William" : "You"} · {conversation.at(-1)?.text}</span> : null}
              {visibleLineTerminalWarning ? <output className={spatial.lineReply} aria-label={`Delivery warning · ${visibleLineTerminalWarning.path ?? "assignment"}`}>{visibleLineTerminalWarning.text}</output> : null}
            </div>
            <div className={spatial.lineControls}>
              {lineMode === "default" && lineTarget === "agent" && delegateContext?.provider === null ? <div role="group" aria-label="Choose agent provider">{delegateContext.kind === "preview" || delegateContext.kind === "file" && !(delegateContext.fileAssignmentBinding?.actor === "codex" || delegateContext.fileAssignmentProofs?.codex) ? <button type="button" className={spatial.lineClose} disabled aria-label="Codex unavailable" title={delegateContext.kind === "preview" ? "Preview diagnostic transport is not available for Codex yet." : "No current server-derived exact-path Codex authority proof is available."}>Codex unavailable</button> : <button type="button" className={spatial.lineClose} onClick={() => chooseDelegateProvider("Codex")}>Codex</button>}{delegateContext.kind === "file" && !(delegateContext.fileAssignmentBinding?.actor === "claude" || delegateContext.fileAssignmentProofs?.claude) ? <button type="button" className={spatial.lineClose} disabled aria-label="Claude unavailable" title="No current server-derived exact-path Claude authority proof is available.">Claude unavailable</button> : <button type="button" className={spatial.lineClose} onClick={() => chooseDelegateProvider("Claude")}>Claude</button>}</div> : null}
              <span className={spatial.lineContext}>{lineMode === "change" ? "Structured edit" : lineMode === "review" ? "Read-only Claude Reviewer" : lineMode === "fork" ? "Claude fork · source remains unchanged" : reviewerAgentContext ? "Read-only Reviewer session" : delegateContext?.kind === "preview" && delegateContext.previewDebugBinding ? "Read-only Preview debugger session" : delegateContext?.provider === "Local" ? "Local conversation" : lineTarget === "agent" ? delegateContext?.provider ? `${delegateContext.provider} session` : "Choose provider" : "William"}</span>
              {lineMode === "review" && agentWorkReview || automaticPreviewDebugRunning || automaticSpaceContinueRunning || lineBusy && delegateContext?.kind === "preview" && Boolean(delegateContext.previewDebugBinding) ? null : <button type="submit" className={spatial.lineSend} disabled={lineContext === "space-summary" || lineBusy || currentResumeSessionIsActive || change.running || lineMode === "review" && review.running || lineMode !== "review" && !lineInput.trim() || lineMode === "default" && lineTarget === "william" && !williamReady || lineMode === "default" && lineTarget === "agent" && !delegateContext?.provider}>{lineMode === "change" ? change.running ? changeIntent === "improve-diff" ? "Improving" : "Changing" : changeIntent === "improve-diff" ? "Start improvement" : "Start change" : lineMode === "review" ? review.running ? "Reviewing" : "Start review" : lineMode === "fork" ? lineBusy ? "Forking" : "Fork session" : currentResumeSessionIsActive ? "Session working" : delegateContext?.kind === "continue" || delegateContext?.kind === "line-session" ? lineBusy ? "Continuing" : "Continue session" : reviewerAgentContext ? lineBusy ? "Reviewer working" : "Send to Reviewer" : delegateContext?.kind === "preview" && delegateContext.previewDebugBinding ? lineBusy ? "Preview debugger working" : "Send" : delegateContext?.provider === "Local" ? lineBusy ? "Thinking" : "Ask Local" : lineBusy ? "Working" : lineTarget === "agent" ? "Delegate" : "Send"}</button>}{automaticPreviewDebugRunning || lineBusy && delegateContext?.kind === "preview" && Boolean(delegateContext.previewDebugBinding) ? <button type="button" className={spatial.lineClose} aria-label="Stop Preview debug" onClick={stopAutomaticPreviewDebug}>Stop Preview debug</button> : null}{automaticSpaceContinueRunning ? <button type="button" className={spatial.lineClose} aria-label="Stop Space continuation" onClick={stopAutomaticSpaceContinue}>Stop Space continuation</button> : null}
              {lineMode === "change" && change.canStop ? <button type="button" className={spatial.lineClose} onClick={change.stop}>{changeIntent === "improve-diff" ? "Stop improvement" : "Stop change"}</button> : null}{lineMode === "review" && review.canStop ? <button type="button" className={spatial.lineClose} onClick={review.stop}>Stop review</button> : null}<button type="button" className={spatial.lineClose} onClick={() => { if (change.running) { if (change.canStop) change.stop(); return } if (lineMode === "review" && review.running) { if (review.canStop) review.stop(); return } if (lineTarget === "agent") { agentPresentationEpochRef.current += 1; setLineBusy(false) } setLineOpen(false) }} aria-label="Close The Line"><X size={14} /></button>
            </div>
          </form>
        </div>
      ) : null}

      {overlay === "council" ? <div className={spatial.councilHost}>{councilSession ? <BrainCouncilSurface session={councilSession} historical={councilHistorical} busy={councilBusy} error={councilError} onDismiss={dismissCouncil} onAdvisoryAction={(action) => void handleCouncilAction(action)} /> : councilView === "convening" ? <section className={spatial.utilitySurface} aria-label="Brain Council"><header className={spatial.utilityMeta}><span>Brain Council</span><button type="button" className={spatial.utilityButton} onClick={dismissCouncil}>Dismiss</button></header><div className={spatial.utilityBody}><strong>{councilBusy ? "Convening five real advisory perspectives…" : "Council unavailable"}</strong><p className={spatial.muted}>{councilError ?? councilQuestion ?? "Preparing the current question."}</p>{councilError && councilQuestion ? <button type="button" className={spatial.utilityButton} onClick={() => void summonCouncil(councilQuestion)}>Try again</button> : null}</div></section> : <CouncilHistoryBrowser history={councilHistory} loading={councilBusy} error={councilError} onDismiss={dismissCouncil} onSelect={selectCouncilHistory} onNew={() => void summonCouncil(`Challenge the current direction for ${selectedLabel}.`)} />}</div> : null}
      {overlay === "mission-control" ? <MissionControlSurface spaces={missionSpaces} currentSpaceId={worldId} onEnterSpace={(id) => void enterMissionSpace(id)} onDismiss={() => { if (!switchingSpace) setOverlay(null) }} multiSpaceAvailable={multiSpaceAvailable} onCreateSpace={createMissionSpace} onRemoveSpace={removeMissionSpace} transitionMessage={transitionMessage} transitioning={switchingSpace} collectionAvailable={spaceCollectionAvailable} collectionReason={spaceCollectionReason} williamOverview={missionOverview} /> : null}
      {overlay === "repository-map" ? <div className={spatial.councilHost}><RepositoryMapSurface repositories={repositoryViews} relationships={repositoryRelationships} onDismiss={() => setOverlay(null)} onSelectRepository={(repositoryKey) => {
        setRepositoryFocusKey(repositoryKey)
        setOverlay(null)
        activate("editor")
      }} /></div> : null}
      {overlay === "change-set" ? <div className={spatial.councilHost}>{changeSetModel ? <ChangeSetSurface {...changeSetModel} onDismiss={() => setOverlay(null)} onSelectRepository={(repositoryKey) => {
        setRepositoryFocusKey(repositoryKey)
        setOverlay(null)
        activate("editor")
      }} /> : <section className={spatial.utilitySurface} aria-label="Cross-repository Change Set"><header className={spatial.utilityMeta}><span>Change Set</span><button type="button" className={spatial.utilityButton} onClick={() => setOverlay(null)}>Dismiss</button></header><div className={spatial.utilityBody}><strong>{changeSetBusy ? "Loading persisted delivery evidence…" : "Change Set unavailable"}</strong><p className={spatial.muted}>{changeSetError ?? "No repository-qualified delivery is recorded for this Space."}</p></div></section>}</div> : null}
      {overlay === "preview-composition" ? <div className={spatial.councilHost}><PreviewComposition
        state={space.runningAppUrl ? "unverified" : "unavailable"}
        runtime={null}
        consumedArtifacts={[]}
        pendingSuiteChanges={pendingSuiteChanges}
        sovereignContext={sovereignContext}
        onDismiss={() => setOverlay(null)}
      /></div> : null}
    </main>
  )
}
function safeLocalStorageGet(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function mergeSpaceSummaries(known: readonly SpaceSummary[], payload: SpaceEnvelope): readonly SpaceSummary[] {
  const merged = new Map(known.map((summary) => [summary.worldId, summary]))
  const currentName = payload.name ?? payload.project?.name ?? "Space"
  const incoming = payload.spaces ?? [{
    worldId: payload.worldId, name: currentName, space: payload.space, updatedAt: new Date(0).toISOString(),
  }]
  for (const summary of incoming) merged.set(summary.worldId, summary)
  if (!merged.has(payload.worldId)) {
    merged.set(payload.worldId, { worldId: payload.worldId, name: currentName, space: payload.space, updatedAt: new Date(0).toISOString() })
  }
  const current = merged.get(payload.worldId)!
  return [current, ...[...merged.values()].filter((summary) => summary.worldId !== payload.worldId)].slice(0, 12)
}

function safeLocalStorageSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* selection hints are best-effort */ }
}

function safeLocalStorageRemove(key: string): void {
  try { window.localStorage.removeItem(key) } catch { /* selection hints are best-effort */ }
}
