"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { AppWindow, Braces, Command, FlaskConical, GitCompare, Grid2X2, TerminalSquare, Users, X } from "lucide-react"

import type { SummonedSurface } from "@/lib/environment/summon"
import { EMPTY_SPINE, validateWilliamJudgment, type WilliamJudgment, type WorldSpine } from "@/lib/environment/working-world"
import { isExecutionLive } from "@/lib/environment/world-execution"
import { EditorSurface } from "./editor-surface"
import { DeveloperToolsSurface, type LiveDiffContext } from "./developer-tools-surface"
import { type ChangeOperationScope, type ChangeRefreshResult, useSelectedFileChange } from "./use-selected-file-change"
import { useSelectedFileReview } from "./use-selected-file-review"
import { AgentSessionStrip, AgentTurnCommittedPersistenceError, agentPresentationText, loadSavedAgentSessionProjection, projectMissionAgentSessions, selectSpaceContinueCandidate, useExperienceAgentSessions, type AgentProvider, type AgentSessionCollectionState, type AgentSessionDiffReview, type AgentTurnPresentation, type ExperienceAgentSession } from "./agent-sessions"
import { BrainCouncilSurface, CouncilHistoryBrowser, type BrainCouncilSession, type CouncilAdvisoryAction } from "./brain-council-surface"
import { diffReviewInspectorBinding, diffReviewInspectorId, diffReviewInspectorIdentity, encodeDiffReviewInspectorPayload, InspectorSurfaceView, inspectorSurfaceWindowTitle, type InspectorSurface } from "./inspector-surface"
import { MissionControlSurface, type MissionControlSpaceProjection } from "./mission-control-surface"
import { deriveMissionControlOverview } from "./mission-control-overview"
import { WilliamConversationRail, type WilliamConversationEntry } from "./william-conversation-rail"
import { WindowFrame } from "./window-frame"
import { defaultSpace, nextSpaceRevision, normalizeSpace, parsePreviewInspectorPayload, spaceInViewport, spaceToServer, type PreviewInspectorPayload, type SpaceEnvelope, type SpaceSummary, type WilliamConversationTurn, type WindowGeometry, type WindowId, type WorkspaceProject, type WorkspaceSpace } from "./types"
import bridge from "./experience-token-bridge.module.css"
import spatial from "./experience-spatial.module.css"

type LineReply = Readonly<{
  worldId?: string
  say?: string
  surfaces?: readonly Omit<InspectorSurface, "id">[]
  dismiss?: "all" | string
  spine?: WorldSpine
}>

type PersistJob = Readonly<{ worldId: string; revision: number; body: string; storage: SpaceStorage; browserKey: string | null; epoch: number; keepalive: boolean }>
type SpaceStorage = "server" | "browser"
type EnvironmentOverlay = "council" | "mission-control" | null
type CouncilView = "history" | "convening"
type LineTarget = "william" | "agent"
type LineContext = "space-summary" | null
type LineMode = "default" | "change" | "review" | "fork"
type StandardDelegateContext = Readonly<{
  kind: "file" | "preview" | "diff" | "space" | "agent" | "conversation"
  label: string
  provider: AgentProvider | null
  role: string
  assignment: string
  requiredSessionKey?: string
}>
type ReviewerDelegateContext = Readonly<{
  kind: "reviewer"
  label: "Reviewer · Claude"
  provider: "Claude"
  role: "Reviewer"
  assignment: string
  reviewPath: string
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
type CapturedDiffImprove = Readonly<{ path: string; fingerprint: string; worldId: string; transitionEpoch: number }>
type CapturedDiffReview = Readonly<{ path: string; fingerprint: string; worldId: string; transitionEpoch: number }>
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
const CLAUDE_REVIEW_SESSION_KEY = /^Claude:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function lineSessionKey(provider: string, sessionId: string): string {
  return `${provider}:${sessionId}`
}

function lineSessionDescriptorFingerprint(session: unknown): string {
  return JSON.stringify(session)
}

function lineSessionCollectionFingerprint(sessions: readonly unknown[]): string {
  return JSON.stringify([...sessions]
    .map((session) => lineSessionDescriptorFingerprint(session))
    .sort())
}

export function lineObjectBindingFingerprint(binding: LineObjectBinding | null): string {
  return JSON.stringify(binding)
}

function reviewerDelegateContext(agent: ExperienceAgentSession | null | undefined): ReviewerDelegateContext | null {
  if (!agent || agent.kind !== "durable-session" || agent.mode !== "review" && agent.mode !== "diff-review"
    || agent.providerLabel !== "Claude" || agent.role !== "Reviewer" || !agent.reviewPath
    || !CLAUDE_REVIEW_SESSION_KEY.test(agent.id)) return null
  return {
    kind: "reviewer",
    label: "Reviewer · Claude",
    provider: "Claude",
    role: "Reviewer",
    assignment: agent.assignment,
    reviewPath: agent.reviewPath,
    sessionId: agent.id.slice("Claude:".length),
    requiredSessionKey: agent.id,
    mode: agent.mode,
    ...(agent.diffReview ? { diffReview: agent.diffReview } : {}),
  }
}

function durableSessionDelegateContext(agent: ExperienceAgentSession | null | undefined): ReviewerDelegateContext | StandardDelegateContext | null {
  if (!agent || agent.kind !== "durable-session") return null
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

export function WorkspaceShell({ initialSummon = null }: { initialSummon?: SummonedSurface | null }) {
  const [space, setSpace] = useState<WorkspaceSpace>(() => defaultSpace())
  const [worldId, setWorldId] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const [persistencePending, setPersistencePending] = useState(false)
  const [lineOpen, setLineOpen] = useState(Boolean(initialSummon))
  const [lineInput, setLineInput] = useState("")
  const [lineReply, setLineReply] = useState<string | null>(null)
  const [lineBusy, setLineBusy] = useState(false)
  const [lineTarget, setLineTarget] = useState<LineTarget>("william")
  const [lineContext, setLineContext] = useState<LineContext>(null)
  const [lineMode, setLineMode] = useState<LineMode>("default")
  const [lineTargetPickerOpen, setLineTargetPickerOpen] = useState(false)
  const [resumeSessionInFlightKeys, setResumeSessionInFlightKeys] = useState<readonly string[]>([])
  const [lineSessionObservedRunningKey, setLineSessionObservedRunningKey] = useState<string | null>(null)
  const [delegateContext, setDelegateContext] = useState<DelegateContext | null>(null)
  const [forkContext, setForkContext] = useState<ForkContext | null>(null)
  const [changeTarget, setChangeTarget] = useState<string | null>(null)
  const [changeIntent, setChangeIntent] = useState<"change" | "improve-diff">("change")
  const [capturedDiffImprove, setCapturedDiffImprove] = useState<CapturedDiffImprove | null>(null)
  const [capturedDiffReview, setCapturedDiffReview] = useState<CapturedDiffReview | null>(null)
  const [liveDiffContext, setLiveDiffContext] = useState<(LiveDiffContext & { worldId: string }) | null>(null)
  const liveDiffContextRef = useRef<(LiveDiffContext & { worldId: string }) | null>(null)
  const [reviewTarget, setReviewTarget] = useState<string | null>(null)
  const [dirtyPaths, setDirtyPaths] = useState<Readonly<Record<string, boolean>>>({})
  const dirtyPathsRef = useRef<Readonly<Record<string, boolean>>>({})
  const [changeRefresh, setChangeRefresh] = useState<ChangeRefresh>({ path: null, key: 0 })
  const changeRefreshKey = useRef(0)
  const changeRefreshWaiters = useRef(new Map<number, ChangeRefreshWaiter>())
  const [inspectors, setInspectors] = useState<readonly InspectorSurface[]>([])
  const [conversation, setConversation] = useState<readonly WilliamConversationEntry[]>([])
  const [williamInput, setWilliamInput] = useState("")
  const [williamRailOpen, setWilliamRailOpen] = useState(false)
  const [williamRailNarrow, setWilliamRailNarrow] = useState(false)
  const [williamBusy, setWilliamBusy] = useState(false)
  const [williamError, setWilliamError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<EnvironmentOverlay>(null)
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const [councilQuestion, setCouncilQuestion] = useState<string | null>(null)
  const [councilSession, setCouncilSession] = useState<BrainCouncilSession | null>(null)
  const [councilHistory, setCouncilHistory] = useState<readonly BrainCouncilSession[]>([])
  const [councilHistorical, setCouncilHistorical] = useState(false)
  const [councilView, setCouncilView] = useState<CouncilView>("history")
  const [councilBusy, setCouncilBusy] = useState(false)
  const [councilError, setCouncilError] = useState<string | null>(null)
  const [spine, setSpine] = useState<WorldSpine>(EMPTY_SPINE)
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
  const agentSessions = useExperienceAgentSessions({
    ownerScope: worldId ?? "unhydrated-owner-world",
    worldScope: project?.identity ?? worldId ?? "unhydrated-project",
    worldId: storage === "server" ? worldId : null,
    worker: spine.worker ?? null,
  })
  const stateRef = useRef(space)
  const spineRef = useRef(spine)
  const worldRef = useRef(worldId)
  const projectRef = useRef(project)
  const storageRef = useRef<SpaceStorage>(storage)
  const persistenceErrorRef = useRef<string | null>(persistenceError)
  const persistencePendingRef = useRef(persistencePending)
  const browserStorageKeyRef = useRef<string | null>(null)
  const previewEvidenceRequestRef = useRef(0)
  const preferenceStorageKeyRef = useRef<string | null>(null)
  const transitionEpochRef = useRef(0)
  const agentPresentationEpochRef = useRef(0)
  const agentSavedSessionsRef = useRef(agentSessions.savedSessions)
  const councilViewEpochRef = useRef(0)
  const councilSessionRef = useRef(councilSession)
  const initialSummonConsumedRef = useRef(false)
  const lineRef = useRef<HTMLInputElement>(null)
  const messageSequence = useRef(0)
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
  const outcomeAssimilationRequestedRef = useRef(new Set<string>())
  const inspectorReturnWindowRef = useRef(new Map<string, string | null>())
  stateRef.current = space
  spineRef.current = spine
  worldRef.current = worldId
  projectRef.current = project
  councilSessionRef.current = councilSession
  storageRef.current = storage
  persistenceErrorRef.current = persistenceError
  persistencePendingRef.current = persistencePending
  agentSavedSessionsRef.current = agentSessions.savedSessions

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return
    const query = window.matchMedia("(max-width: 1040px)")
    const updateWilliamRailViewport = () => setWilliamRailNarrow(query.matches)
    updateWilliamRailViewport()
    query.addEventListener("change", updateWilliamRailViewport)
    return () => query.removeEventListener("change", updateWilliamRailViewport)
  }, [])

  useEffect(() => {
    if (delegateContext?.kind !== "file" || delegateContext.label === space.selectedPath) return
    // Delegate is an object action. If the selected object changes before dispatch, discard the
    // stale client intent; the server will derive authority only from the newly persisted Space.
    setDelegateContext(null)
    setLineTarget("william")
    setLineInput("")
    setLineOpen(false)
  }, [delegateContext, space.selectedPath])

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
      const exactIdentity = binding ? diffReviewInspectorIdentity(binding) : surface.identity ?? null
      const exactExisting = exactIdentity ? [...inspectors, ...incoming].find((candidate) => {
        const candidateBinding = candidate.kind === "review" ? diffReviewInspectorBinding(candidate.payload) : null
        const candidateIdentity = candidateBinding ? diffReviewInspectorIdentity(candidateBinding) : candidate.identity ?? null
        return candidate.kind === surface.kind && candidate.subject === surface.subject && candidateIdentity === exactIdentity
      }) : null
      if (exactExisting) {
        incoming.push({ ...surface, identity: exactIdentity ?? undefined, id: exactExisting.id })
      } else {
        const baseId = binding ? diffReviewInspectorId(binding) : inspectorId(surface)
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
          kind: surface.kind,
          subject: surface.subject,
          ...(surface.kind === "review" && typeof surface.payload === "string"
            ? { payload: surface.payload }
            : {}),
        }
      })
      const active = incoming.at(-1)?.id ?? current.activeWindowId
      return { ...current, inspectorWindows, inspectorSeeds, activeWindowId: active }
    })
  }, [inspectors])

  const materializeReviewReport = useCallback((path: string, report: string, binding?: AgentSessionDiffReview) => {
    materializeSurfaces({ surfaces: [{
      kind: "review",
      subject: path,
      ...(binding ? { identity: diffReviewInspectorIdentity(binding) } : {}),
      payload: binding ? encodeDiffReviewInspectorPayload(binding, report) : report,
    }] })
  }, [materializeSurfaces])

  const review = useSelectedFileReview({ path: reviewTarget, sessions: agentSessions, onReport: materializeReviewReport })

  const acceptLineReply = useCallback((reply: LineReply) => {
    // A Line turn can change server-only judgment facts (validation marks, concerns, failures,
    // intent). Clear the active opinion until it is regenerated from the newly persisted world.
    judgmentRequestedRef.current = null
    setJudgment(null)
    if (typeof reply.worldId === "string") setWorldId(reply.worldId)
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
      const response = await fetch("/api/environment/space", { cache: "no-store" })
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
            const exactResponse = await fetch(`/api/environment/space?worldId=${encodeURIComponent(hinted)}`, { cache: "no-store" })
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
        const restoredBase = normalizeSpace(storedSpace, defaultSpace(window.innerWidth, window.innerHeight, identity, name), {
          width: window.innerWidth,
          height: window.innerHeight,
        })
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
          ...Object.entries(restored.inspectorSeeds).flatMap(([id, seed]) =>
            seed.kind === "review" && typeof seed.payload === "string"
              ? [{ id, kind: "review", subject: seed.subject, payload: seed.payload }]
              : [],
          ),
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
  }, [])

  useEffect(() => {
    if (!hydrated || !worldId || storage !== "server" || outcomeAssimilationRequestedRef.current.has(worldId)) return
    outcomeAssimilationRequestedRef.current.add(worldId)
    // Assimilation is a silent prerequisite check, not a new authority workflow. The server may
    // attach authority it already owns for this exact Space, but missing authority cannot make the
    // rest of WilliamOS unusable or send the owner into Work Order/receipt administration.
    void Promise.resolve()
      .then(() => fetch("/api/environment/space/outcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId }),
        cache: "no-store",
      }))
      .catch(() => undefined)
  }, [hydrated, storage, worldId])

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
    if (!outcomeKey || !isExecutionLive(spine.execution)) return
    let cancelled = false
    const executionWorldId = worldId
    const executionEpoch = transitionEpochRef.current
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/environment/execution?outcomeKey=${encodeURIComponent(outcomeKey)}`, { cache: "no-store" })
        if (!response.ok) return
        const live = await response.json() as Pick<WorldSpine, "execution" | "worker" | "evidence">
        if (cancelled || worldRef.current !== executionWorldId || transitionEpochRef.current !== executionEpoch) return
        setSpine((current) => current.outcomeKey === outcomeKey
          ? { ...current, execution: live.execution, worker: live.worker, evidence: live.evidence }
          : current)
      } catch {
        // Preserve the last canonical observation until the next successful read.
      }
    }, 4000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [spine.execution, spine.outcomeKey, worldId])

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
      if (transitionEpochRef.current === job.epoch && worldRef.current === job.worldId && job.revision >= revisionRef.current) {
        setPersistenceError(error instanceof Error ? error.message : "SPACE_SAVE_REFUSED")
        setPersistencePending(false)
      }
    }
  }, [])

  const persist = useCallback((keepalive = false): Promise<number> => {
    const id = worldRef.current
    if (!id) return Promise.resolve(acknowledgedRevisionRef.current)
    const revision = nextSpaceRevision(revisionRef.current)
    revisionRef.current = revision
    setPersistencePending(true)
    const job: PersistJob = {
      worldId: id,
      revision,
      body: JSON.stringify({ worldId: id, space: spaceToServer(stateRef.current, revision) }),
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
  }, [sendPersist])
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
    setForkContext(null)
    if (target === "william") setDelegateContext(null)
    setLineMode("default")
    setLineInput(prompt)
    setLineReply(null)
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
    path: changeTarget,
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
    setChangeIntent("change")
    setCapturedDiffImprove(null)
    setCapturedDiffReview(null)
    setChangeTarget(target)
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
  }, [change.reset, change.running, review.running, space.selectedPath])

  const openDiffImprove = useCallback(() => {
    if (change.running || review.running || storage !== "server" || persistencePending || persistenceError
      || !worldId || !space.selectedPath || space.activeWindowId !== "diff"
      || dirtyPaths[space.selectedPath] || !liveDiffContext || liveDiffContext.worldId !== worldId
      || liveDiffContext.path !== space.selectedPath) return
    const captured = {
      path: liveDiffContext.path,
      fingerprint: liveDiffContext.fingerprint,
      worldId,
      transitionEpoch: transitionEpochRef.current,
    }
    setChangeIntent("improve-diff")
    setCapturedDiffImprove(captured)
    setChangeTarget(captured.path)
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
  }, [change.reset, change.running, dirtyPaths, liveDiffContext, persistenceError, persistencePending, review.running, space.activeWindowId, space.selectedPath, storage, worldId])

  const openDiffReview = useCallback(() => {
    if (change.running || review.running || storage !== "server" || persistencePending || persistenceError
      || !worldId || !space.selectedPath || space.activeWindowId !== "diff"
      || dirtyPaths[space.selectedPath] || !liveDiffContext || liveDiffContext.worldId !== worldId
      || liveDiffContext.path !== space.selectedPath) return
    const captured = {
      path: liveDiffContext.path,
      fingerprint: liveDiffContext.fingerprint,
      worldId,
      transitionEpoch: transitionEpochRef.current,
    }
    setCapturedDiffReview(captured)
    setCapturedDiffImprove(null)
    setReviewTarget(captured.path)
    review.reset(captured.path)
    setLineTarget("agent")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("review")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [change.running, dirtyPaths, liveDiffContext, persistenceError, persistencePending, review.reset, review.running, space.activeWindowId, space.selectedPath, storage, worldId])

  const openReview = useCallback(() => {
    if (change.running || review.running) return
    const target = space.selectedPath
    setCapturedDiffReview(null)
    setReviewTarget(target)
    review.reset(target)
    setLineTarget("agent")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("review")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [change.running, review.reset, review.running, space.selectedPath])

  const openReviewPath = useCallback((target: string) => {
    if (change.running || review.running) return
    setFocusedAgentId(null)
    setCapturedDiffReview(null)
    setReviewTarget(target)
    review.reset(target)
    setLineTarget("agent")
    setDelegateContext(null)
    setForkContext(null)
    setLineMode("review")
    setLineInput("")
    setLineReply(null)
    setLineTargetPickerOpen(false)
    setLineOpen(true)
    requestAnimationFrame(() => lineRef.current?.focus())
  }, [change.running, review.reset, review.running])

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
    setCouncilView("convening")
    setCouncilQuestion(question)
    setCouncilSession(null)
    setCouncilHistorical(false)
    setCouncilError(null)
    setCouncilBusy(true)
    setOverlay("council")
    if (!worldId) {
      setCouncilError("Council needs an open persistent Space.")
      setCouncilBusy(false)
      return
    }
    if (selectedAgent?.kind === "durable-session") {
      setCouncilError("Council cannot ground this browser-saved agent session yet. Select a persisted Space object or live world worker.")
      setCouncilBusy(false)
      return
    }
    try {
      await persistBarrierRef.current()
      const response = await fetch("/api/environment/council", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          worldId,
          question,
          selectedContext: { kind: selectedKind, label: selectedLabel },
        }),
        cache: "no-store",
      })
      const payload = await response.json() as { error?: string; detail?: string; session?: BrainCouncilSession }
      if (!response.ok || !payload.session) throw new Error(payload.detail ?? payload.error ?? `COUNCIL_${response.status}`)
      setCouncilSession(payload.session)
      setCouncilHistory((current) => [...current.filter((entry) => entry.id !== payload.session!.id), payload.session!].slice(-6))
    } catch (error) {
      setCouncilError(error instanceof Error ? error.message : "Council inference is unavailable.")
    } finally {
      setCouncilBusy(false)
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

  const sendWilliamTurn = useCallback(async (text: string, context: LineContext = null): Promise<boolean> => {
    const normalized = text.trim()
    if (!normalized || lineBusy || williamBusy) return false
    appendConversation("owner", normalized)
    setLineBusy(true)
    setLineReply(null)
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
      if (!requestIsCurrent()) throw new Error("WILLIAM_CONTEXT_CHANGED")
      const response = await fetch("/api/environment/line", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ worldId: requestWorldId, text: normalized, ...(context ? { lineContext: context } : {}) }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? `LINE_${response.status}`)
      if (!requestIsCurrent()) throw new Error("WILLIAM_CONTEXT_CHANGED")
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
  }, [acceptLineReply, agentSessions.sessions, appendConversation, focusedAgentId, lineBusy, williamBusy])

  const reviewerAgentContext = delegateContext?.kind === "reviewer" ? delegateContext : null

  async function submitLine(event: React.FormEvent) {
    event.preventDefault()
    const text = lineInput.trim()
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
    let agentPresentationIsCurrent: (() => boolean) | null = null
    let resumeDispatchKey: string | null = null
    try {
      const contextualText = lineTarget === "agent" && delegateContext
        ? `Owner request: ${text}`
        : `Selected ${selectedKind}: ${selectedLabel}\nOwner request: ${text}`
      if (lineTarget === "agent") {
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
        const promotedPath = delegateContext.provider === "Codex" && delegateContext.kind === "file" ? delegateContext.label : null
        if (promotedPath) await persistBarrierRef.current()
        let committedPersistenceError: AgentTurnCommittedPersistenceError | null = null
        let persistedFinalPresentation: string | null = null
        try {
          const turn = {
            prompt: delegateContext.kind === "preview" ? text : contextualText,
            onPresentation: (presentation: AgentTurnPresentation) => {
              if (presentation.provider !== presentationProvider) return
              const presentedSessionKey = `${presentation.provider}:${presentation.sessionId}`
              if (presentationSessionKey === null) presentationSessionKey = presentedSessionKey
              if (presentationSessionKey !== presentedSessionKey || !agentPresentationIsCurrent?.()) return
              setLineReply(presentation.text)
              if (presentation.phase === "working") setLineBusy(false)
            },
          }
          const completed = delegateContext.kind === "continue" || delegateContext.kind === "line-session"
            ? await agentSessions.continueSession({
              sessionKey: delegateContext.sessionKey,
              prompt: text,
              onPresentation: turn.onPresentation,
            })
            : reviewerAgentContext
            ? await agentSessions.runClaudeTurn({
              role: "Reviewer",
              assignment: reviewerAgentContext.assignment,
              mode: reviewerAgentContext.mode,
              path: reviewerAgentContext.reviewPath,
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
              ...(delegateContext.provider === "Codex" && delegateContext.kind === "file"
                ? { target: { kind: "file" as const, path: delegateContext.label } }
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
            setLineReply(persistedFinalPresentation)
          }
        } catch (error) {
          if (!(error instanceof AgentTurnCommittedPersistenceError)) throw error
          committedPersistenceError = error
        }
        let refreshWarning: string | null = null
        if (promotedPath) {
          const refreshed = await refreshVerifiedChange(promotedPath)
          if (refreshed === "dirty-conflict") {
            refreshWarning = `Codex saved ${promotedPath}, but Source has newer unsaved edits. Your buffer was preserved.`
          } else if (refreshed === "failed") {
            refreshWarning = `Codex saved ${promotedPath}, but Source or Changes could not refresh.`
          }
        }
        if (committedPersistenceError && agentPresentationIsCurrent()) {
          setLineReply(refreshWarning
            ? `${refreshWarning} Transcript persistence also failed (${committedPersistenceError.message}).`
            : committedPersistenceError.message)
        } else if (refreshWarning && persistedFinalPresentation && agentPresentationIsCurrent()) {
          setLineReply(`${persistedFinalPresentation}\n\nWarning: ${refreshWarning}`)
        }
        return
      }
      await sendWilliamTurn(text, lineContext)
    } catch (error) {
      if (lineTarget !== "agent") {
        setLineReply(error instanceof Error ? error.message : "LINE_UNAVAILABLE")
      } else if (!agentPresentationIsCurrent || agentPresentationIsCurrent()) {
        setLineReply(error instanceof AgentTurnCommittedPersistenceError
          ? error.message
          : error instanceof DOMException && error.name === "AbortError" ? "Agent turn stopped." : "Agent turn unavailable.")
      }
    } finally {
      if (resumeDispatchKey) {
        setResumeSessionInFlightKeys((current) => current.filter((key) => key !== resumeDispatchKey))
      }
      if (!agentPresentationIsCurrent || agentPresentationIsCurrent()) setLineBusy(false)
    }
  }

  const savedLabel = persistenceError
    ? persistenceError
    : hydrated
      ? persistencePending ? "saving space" : storage === "browser" ? "space saved locally" : "space saved"
      : "opening space"
  const selectedAgent = agentSessions.sessions.find((agent) => agent.id === focusedAgentId)
  const selectedKind = selectedAgent ? "agent" as const
    : space.activeWindowId === "running-app" ? "preview" as const
    : space.activeWindowId === "diff" ? "diff" as const
    : space.activeWindowId === "editor" && space.selectedPath ? "file" as const
    : "space" as const
  const selectedLabel = selectedAgent ? `${selectedAgent.role} · ${selectedAgent.providerLabel}`
    : selectedKind === "preview" ? "TerraFusion developer preview"
    : selectedKind === "diff" ? "Current changes"
    : selectedKind === "file" ? space.selectedPath!
    : `${project?.name ?? space.name} Space`
  const selectedKindLabel = selectedKind === "file" ? "file"
    : selectedKind === "preview" ? "preview"
    : selectedKind === "diff" ? "changes"
    : selectedKind === "agent" ? "agent session"
    : "Space"

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
      setLineReply(projection.lastResult)
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
      : target.projection.lastResult ?? "Verified durable session selected.")
  }
  const pauseAction = selectedAgent && agentSessions.pausableSessionIds.includes(selectedAgent.id) ? "Pause" : "Pause unavailable"
  const forkEligible = selectedAgent?.kind === "durable-session" && selectedAgent?.truth === "live" && selectedAgent.providerLabel === "Claude" && selectedAgent.role === "Builder" && selectedAgent.mode === "delegate"
  const forkAction = forkEligible && agentSessions.activeSessionIds.length === 0 ? "Fork" : "Fork unavailable"
  const spaceContinueCandidate = selectSpaceContinueCandidate(
    agentSessions.collectionState,
    agentSessions.savedSessions,
    agentSessions.selectedSessionKey,
  )
  const continueAction = spaceContinueCandidate ? "Continue" : "Continue unavailable"
  const continueUnavailableMessage = spaceContinueUnavailableMessage(agentSessions.collectionState)
  const diffReviewUnavailableReason = selectedKind !== "diff" ? null
    : storage !== "server" ? "Review requires a server-bound Space with durable persistence."
      : persistenceError ? `Review is unavailable because Space persistence is refusing writes (${persistenceError}).`
        : !worldId || !space.selectedPath || dirtyPaths[space.selectedPath]
            || !liveDiffContext || liveDiffContext.worldId !== worldId || liveDiffContext.path !== space.selectedPath
            ? "Review needs the exact live modified patch for the saved selected file."
            : persistencePending ? "Review waits until the current Space is durably saved."
              : null
  const selectedActions = selectedKind === "file" ? ["Ask", "Change", "Delegate", "Review"] as const
    : selectedKind === "preview" ? ["Inspect", "Debug", "Explain", "Delegate"] as const
    : selectedKind === "diff" ? [diffReviewUnavailableReason ? "Review unavailable" : "Review", "Improve", "Challenge", "Merge unavailable"] as const
    : selectedKind === "agent" && selectedAgent?.providerLabel === "Local" ? ["Talk", pauseAction, forkAction] as const
    : selectedKind === "agent" ? ["Talk", "Redirect", pauseAction, forkAction, selectedAgent?.target ? "Review work" : "Review work unavailable"] as const
    : ["Summarize", continueAction, "Delegate", "Council"] as const
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

  const applySpaceEnvelope = (payload: SpaceEnvelope) => {
    // A terminal result belongs only to the exact Space/transition that started it. Invalidate
    // before advancing the epoch so delayed provider frames cannot refresh or present in the next
    // Space, even though ordinary reset intentionally ignores an active operation.
    change.invalidate()
    inspectorReturnWindowRef.current.clear()
    const name = payload.name ?? payload.project?.name ?? "Space"
    const restoredBase = normalizeSpace(
      payload.space,
      defaultSpace(window.innerWidth, window.innerHeight, payload.worldId, name),
      { width: window.innerWidth, height: window.innerHeight },
    )
    const restoredProject = payload.project ?? projectRef.current
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
      ...Object.entries(restored.inspectorSeeds).flatMap(([id, seed]) =>
        seed.kind === "review" && typeof seed.payload === "string"
          ? [{ id, kind: "review", subject: seed.subject, payload: seed.payload }]
          : [],
      ),
      ...(previewSurface ? [previewSurface] : []),
    ])
    setConversation(restoredConversation(payload.conversation))
    setWilliamInput("")
    setWilliamError(null)
    setFocusedAgentId(null)
    setLineOpen(false)
    setLineInput("")
    setLineReply(null)
    setLineTarget("william")
    setLineContext(null)
    setLineMode("default")
    setDelegateContext(null)
    setChangeTarget(null)
    setChangeIntent("change")
    setCapturedDiffImprove(null)
    setLiveDiffContext(null)
    liveDiffContextRef.current = null
    setReviewTarget(null)
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
      const response = await fetch(`/api/environment/space?worldId=${encodeURIComponent(targetWorldId)}`, { cache: "no-store" })
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
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }),
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

  const missionWindowKind: Record<WindowId, MissionControlSpaceProjection["windows"][number]["kind"]> = {
    editor: "source", "running-app": "preview", tests: "tests", diff: "diff", terminal: "terminal",
  }
  const currentAgentCollectionKnown = agentSessions.collectionState === "available" || agentSessions.collectionState === "missing"
  const currentMissionAgents = currentAgentCollectionKnown
    ? agentSessions.sessions
    : agentSessions.sessions.filter((agent) => agent.truth === "live")
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
    const restored = normalizeSpace(
      summary.space,
      defaultSpace(window.innerWidth, window.innerHeight, summary.worldId, summary.name),
      { width: window.innerWidth, height: window.innerHeight },
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

  function openObjectAction(action: string) {
    if (action === "Merge unavailable") return
    if (selectedKind === "space" && action === "Summarize") {
      openLine("Summarize this exact current Space: ", "william", "space-summary")
      return
    }
    if (selectedKind === "space" && action === "Continue") {
      const candidate = spaceContinueCandidate
      if (!candidate) return
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
      })
      openLine("", "agent")
      setLineReply("Saved session · verification pending")
      return
    }
    if (action === "Continue unavailable") return
    if (selectedKind === "preview" && action === "Inspect") {
      void inspectPreviewEvidence()
      return
    }
    if (selectedKind === "preview" && (action === "Debug" || action === "Explain")) {
      openLine(`${action} the exact current developer Preview evidence: `)
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
    if (selectedKind === "diff" && action === "Challenge") {
      openLine(`${action} the exact current patch for the selected file.`)
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
      if (!agentSessions.selectSession(null)) return
      setFocusedAgentId(null)
      setDelegateContext(selectedKind === "preview"
        ? { kind: "preview", label: selectedLabel, provider: null, role: "Preview debugger", assignment: "Developer Preview diagnosis" }
        : { kind: selectedKind, label: selectedLabel, provider: null, role: "Builder", assignment: selectedLabel })
      openLine("", "agent")
      return
    }
    if (action === "Review work" && selectedAgent?.kind === "durable-session" && selectedAgent.target) {
      openReviewPath(selectedAgent.target.path)
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

  const toolRunHistoryScope = storage === "server" && worldId
    ? `server:${worldId}`
    : storage === "browser" && browserStorageKeyRef.current
      ? `browser:${browserStorageKeyRef.current}`
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
        <AgentSessionStrip sessions={agentSessions.sessions} activeSessionId={focusedAgentId} runningTurns={agentSessions.activeTurns} onStop={agentSessions.stop} className={spatial.sessionStrip} onSelect={(agent) => {
          if (!agentSessions.selectSession(agent.kind === "durable-session" ? agent.id : null)) return
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
            setLineReply(agent.lastResult ? agentPresentationText(agent.lastResult) ?? "Saved agent result is hidden from presentation." : null)
          }
        }} />
        <div className={spatial.status}><span className={spatial.statusDot} aria-hidden /><span>{worldLine || "Space ready"}{workerLine}</span></div>
      </header>

      <div className={spatial.objectBar} aria-label="Selected object actions">
        <span className={spatial.objectLabel}><strong>Selected {selectedKindLabel}</strong> · {selectedLabel}</span>
        <div className={spatial.objectActions}>
          {selectedActions.map((action) => (
            <button key={action} type="button" className={`${spatial.action} ${action === "Delegate" || action === "Council" || action === "Fork" ? spatial.primaryAction : ""}`} disabled={action === "Review work unavailable" || action === "Review unavailable" || action === "Pause unavailable" || action === "Fork unavailable" || action === "Merge unavailable" || action === "Continue unavailable" || action === "Improve" && Boolean(improveUnavailableReason)} title={action === "Review work unavailable" ? "This session has no verified file target." : action === "Review unavailable" ? diffReviewUnavailableReason ?? undefined : action === "Pause unavailable" ? "Only the selected running session can be paused." : action === "Fork unavailable" ? "Only an idle verified Claude Builder session can be forked." : action === "Merge unavailable" ? "Current Changes actions are read-only; merge is unavailable here." : action === "Continue unavailable" ? continueUnavailableMessage : action === "Improve" ? improveUnavailableReason ?? undefined : undefined} onClick={() => openObjectAction(action)}>{action}</button>
          ))}
        </div>
        {selectedKind === "space" && !spaceContinueCandidate ? <span role="status">{continueUnavailableMessage}</span> : null}
      </div>

      <div className={spatial.windowLayer} aria-label="Spatial work surfaces">
        <WindowFrame id="editor" title="Source" geometry={space.windows.editor} active={space.activeWindowId === "editor"} onActivate={() => activate("editor")} onGeometry={(geometry) => updateWindow("editor", geometry)} onMinimize={() => minimize("editor")} minimizeDisabled={Boolean(sourceMinimizeDisabledReason)} minimizeDisabledReason={sourceMinimizeDisabledReason}>
          <EditorSurface key={worldId ?? "unhydrated"} space={space} onEditorChange={(editor, selectedPath) => setSpace((current) => ({ ...current, editor, selectedPath }))} onSelectedFileDirtyChange={onSelectedFileDirtyChange} reloadPath={changeRefresh.path} reloadKey={changeRefresh.key} onReloadSettled={(path, key, result) => settleChangeRefresh("editor", path, key, result)} />
        </WindowFrame>
        <WindowFrame id="running-app" title="Developer preview · TerraFusion" geometry={space.windows["running-app"]} active={space.activeWindowId === "running-app"} onActivate={() => activate("running-app")} onGeometry={(geometry) => updateWindow("running-app", geometry)} onMinimize={() => minimize("running-app")}>
          {space.runningAppUrl ? <iframe src={space.runningAppUrl} title="Running TerraFusion application" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-downloads" className="h-full w-full border-0" /> : (
            <div className="grid h-full place-content-center gap-3 p-8 text-center" role="status"><AppWindow className="mx-auto text-[#91a48c]" size={26} aria-hidden /><strong>Developer preview unavailable</strong><span className="max-w-md text-xs text-[#8e998b]">Attach the TerraFusion development runtime when you want the real target beside source. WilliamOS remains fully usable; no business workflow is being simulated.</span></div>
          )}
        </WindowFrame>
        {(["tests", "diff", "terminal"] as const).map((id) => (
          <WindowFrame key={id} id={id} title={windowName[id]} geometry={space.windows[id]} active={space.activeWindowId === id} onActivate={() => activate(id)} onGeometry={(geometry) => updateWindow(id, geometry)} onMinimize={() => minimize(id)} minimizeDisabled={id === "diff" && change.running} minimizeDisabledReason={id === "diff" && change.running ? "Changes cannot be minimized while Change is active" : undefined}>
            <DeveloperToolsSurface key={`${worldId ?? "unhydrated"}:${id}`} kind={id} selectedPath={space.selectedPath} active={space.activeWindowId === id} historyScope={toolRunHistoryScope} refreshKey={id === "diff" ? changeRefresh.key : 0} refreshPath={id === "diff" ? changeRefresh.path : null} onRefreshSettled={id === "diff" ? (path, key, result) => settleChangeRefresh("diff", path, key, result) : undefined} onLiveDiffContextChange={id === "diff" ? (context) => setLiveDiffContext((current) => {
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
        <button type="button" className={spatial.dockButton} onClick={() => void openCouncilHistory()} aria-label="Open Brain Council" title="Brain Council"><Users size={15} /></button>
      </nav>

      <WilliamConversationRail
        conversation={conversation}
        judgment={williamJudgment}
        input={williamInput}
        busy={williamBusy}
        judgmentBusy={judgmentBusy}
        canThinkAgain={storage === "server"}
        canInspectJudgment={Boolean(currentInspectableJudgment)}
        error={williamError}
        open={williamRailOpen}
        narrow={williamRailNarrow}
        persistenceLabel={savedLabel}
        persistenceError={persistenceError}
        onInput={setWilliamInput}
        onSubmit={() => { const text = williamInput.trim(); if (!text) return; void sendWilliamTurn(text).then((sent) => { if (sent) setWilliamInput("") }) }}
        onOpen={() => setWilliamRailOpen(true)}
        onClose={() => setWilliamRailOpen(false)}
        onThinkAgain={() => void refreshWilliamJudgment()}
        onInspectJudgment={openWilliamJudgmentInspector}
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
              <span className={spatial.lineContext}>{lineMode === "change" ? changeIntent === "improve-diff" ? `Improve current change · ${change.path ?? "no file selected"}` : `Change · ${change.path ?? "no file selected"}` : lineMode === "review" ? capturedDiffReview ? `Review current change · ${review.path ?? "no file selected"}` : `Review · ${review.path ?? "no file selected"}` : lineMode === "fork" ? `Fork · ${forkContext?.label ?? "Claude Builder"}` : delegateContext?.kind === "continue" ? `Continue · ${delegateContext.label} · verification pending` : delegateContext?.kind === "line-session" ? `${delegateContext.label} · ${delegateContext.objectContext} · ${delegateContext.spaceContext}` : reviewerAgentContext ? `Reviewer · Claude · ${reviewerAgentContext.reviewPath} · read-only` : delegateContext?.provider === "Local" ? "Local conversation · no workspace mutation" : lineTarget === "agent" && delegateContext ? `${delegateContext.kind} · ${delegateContext.label}` : `${selectedKind} · ${selectedLabel}`}</span><input ref={lineRef} className={spatial.lineInput} value={lineInput} onChange={(event) => setLineInput(event.target.value)} disabled={(lineMode === "change" && change.running) || (lineMode === "review" && review.running)} placeholder={lineMode === "change" ? changeIntent === "improve-diff" ? "Describe how to improve this exact patch" : "Describe the change to make" : lineMode === "review" ? "Optional review focus" : lineMode === "fork" ? "Describe how the fork should diverge" : reviewerAgentContext ? "Ask or redirect this Reviewer" : delegateContext?.provider === "Local" ? "Ask the Local model" : lineTarget === "agent" ? "Describe the bounded assignment" : "Ask, change, delegate, or review"} aria-label={lineMode === "change" ? changeIntent === "improve-diff" ? "Improve instruction" : "Change instruction" : lineMode === "review" ? "Review focus" : lineMode === "fork" ? "Fork instruction" : "The Line"} autoComplete="off" />{lineMode === "change" ? (change.progress ? <output className={spatial.lineReply}>{change.progress}</output> : change.outcome ? <output className={spatial.lineReply}>{change.outcome}</output> : null) : lineMode === "review" ? (review.progress ? <output className={spatial.lineReply}>{review.progress}</output> : review.outcome ? <output className={spatial.lineReply}>{review.outcome}</output> : null) : lineReply ? <output className={spatial.lineReply}>{lineReply}</output> : conversation.at(-1) ? <span className={spatial.lineReply}>{conversation.at(-1)?.role === "williamos" ? "William" : "You"} · {conversation.at(-1)?.text}</span> : null}
            </div>
            <div className={spatial.lineControls}>
              {lineMode === "default" && lineTarget === "agent" && delegateContext?.provider === null ? <div role="group" aria-label="Choose agent provider">{delegateContext.kind === "preview" ? <button type="button" className={spatial.lineClose} disabled aria-label="Codex unavailable" title="Preview diagnostic transport is not available for Codex yet.">Codex unavailable</button> : <button type="button" className={spatial.lineClose} onClick={() => setDelegateContext((current) => current && current.kind !== "reviewer" ? { ...current, provider: "Codex" } : current)}>Codex</button>}<button type="button" className={spatial.lineClose} onClick={() => setDelegateContext((current) => current && current.kind !== "reviewer" ? { ...current, provider: "Claude" } : current)}>Claude</button></div> : null}
              <span className={spatial.lineContext}>{lineMode === "change" ? "Structured edit" : lineMode === "review" ? "Read-only Claude Reviewer" : lineMode === "fork" ? "Claude fork · source remains unchanged" : reviewerAgentContext ? "Read-only Reviewer session" : delegateContext?.provider === "Local" ? "Local conversation" : lineTarget === "agent" ? delegateContext?.provider ? `${delegateContext.provider} session` : "Choose provider" : "William"}</span>
              <button type="submit" className={spatial.lineSend} disabled={lineBusy || currentResumeSessionIsActive || change.running || lineMode === "review" && review.running || lineMode !== "review" && !lineInput.trim() || lineMode === "default" && lineTarget === "agent" && !delegateContext?.provider}>{lineMode === "change" ? change.running ? changeIntent === "improve-diff" ? "Improving" : "Changing" : changeIntent === "improve-diff" ? "Start improvement" : "Start change" : lineMode === "review" ? review.running ? "Reviewing" : "Start review" : lineMode === "fork" ? lineBusy ? "Forking" : "Fork session" : currentResumeSessionIsActive ? "Session working" : delegateContext?.kind === "continue" || delegateContext?.kind === "line-session" ? lineBusy ? "Continuing" : "Continue session" : reviewerAgentContext ? lineBusy ? "Reviewer working" : "Send to Reviewer" : delegateContext?.provider === "Local" ? lineBusy ? "Thinking" : "Ask Local" : lineBusy ? "Working" : lineTarget === "agent" ? "Delegate" : "Send"}</button>
              {lineMode === "change" && change.canStop ? <button type="button" className={spatial.lineClose} onClick={change.stop}>{changeIntent === "improve-diff" ? "Stop improvement" : "Stop change"}</button> : null}{lineMode === "review" && review.canStop ? <button type="button" className={spatial.lineClose} onClick={review.stop}>Stop review</button> : null}<button type="button" className={spatial.lineClose} onClick={() => { if (change.running) { if (change.canStop) change.stop(); return } if (lineMode === "review" && review.running) { if (review.canStop) review.stop(); return } if (lineTarget === "agent") { agentPresentationEpochRef.current += 1; setLineBusy(false) } setLineOpen(false) }} aria-label="Close The Line"><X size={14} /></button>
            </div>
          </form>
        </div>
      ) : null}

      {overlay === "council" ? <div className={spatial.councilHost}>{councilSession ? <BrainCouncilSurface session={councilSession} historical={councilHistorical} busy={councilBusy} error={councilError} onDismiss={dismissCouncil} onAdvisoryAction={(action) => void handleCouncilAction(action)} /> : councilView === "convening" ? <section className={spatial.utilitySurface} aria-label="Brain Council"><header className={spatial.utilityMeta}><span>Brain Council</span><button type="button" className={spatial.utilityButton} onClick={dismissCouncil}>Dismiss</button></header><div className={spatial.utilityBody}><strong>{councilBusy ? "Convening five real advisory perspectives…" : "Council unavailable"}</strong><p className={spatial.muted}>{councilError ?? councilQuestion ?? "Preparing the current question."}</p>{councilError && councilQuestion ? <button type="button" className={spatial.utilityButton} onClick={() => void summonCouncil(councilQuestion)}>Try again</button> : null}</div></section> : <CouncilHistoryBrowser history={councilHistory} loading={councilBusy} error={councilError} onDismiss={dismissCouncil} onSelect={selectCouncilHistory} onNew={() => void summonCouncil(`Challenge the current direction for ${selectedLabel}.`)} />}</div> : null}
      {overlay === "mission-control" ? <MissionControlSurface spaces={missionSpaces} currentSpaceId={worldId} onEnterSpace={(id) => void enterMissionSpace(id)} onDismiss={() => { if (!switchingSpace) setOverlay(null) }} multiSpaceAvailable={multiSpaceAvailable} onCreateSpace={createMissionSpace} transitionMessage={transitionMessage} transitioning={switchingSpace} collectionAvailable={spaceCollectionAvailable} collectionReason={spaceCollectionReason} williamOverview={missionOverview} /> : null}
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
