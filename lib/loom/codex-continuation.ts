import {
  validateWorkingWorld,
  type WorkingWorldSnapshot,
} from "@/lib/environment/working-world"
import { canonicalWorkspaceObjectKey, type WorkspaceFileRef } from "@/lib/projects/workspace-object-ref"

export type CodexContinuationInput = Readonly<{
  worldId: string
  outcomeKey: string
  workOrderId: number
  grantId: number
  title: string
  objective: string
  acceptanceCriteria: readonly string[]
  validators: readonly string[]
  allowedPaths: readonly string[]
  completedPaths: readonly string[]
  assignedPaths: readonly string[]
}>

export type CodexContinuationPlan =
  | Readonly<{ status: "NEXT_ASSIGNMENT"; selectedPath: string; task: string; repositoryKey?: string }>
  | Readonly<{ status: "ASSIGNMENT_IN_FLIGHT"; selectedPath: string }>
  | Readonly<{ status: "PATH_RESERVATION_NOT_EXACT"; reservation: string }>
  | Readonly<{ status: "PATH_RESERVATION_UNAVAILABLE"; selectedPath: string }>
  | Readonly<{ status: "WAITING_FOR_FIRST_ASSIGNMENT" }>
  | Readonly<{ status: "WORK_ORDER_PATHS_COMPLETE" }>

export type CodexContinuationRecord = Readonly<{
  snapshot: string
  authorityVersion: string
  world: WorkingWorldSnapshot
  outcomeKey: string
  workOrderId: number
  grantId: number
  title: string
  objective: string
  acceptanceCriteria: readonly string[]
  validators: readonly string[]
  allowedPaths: readonly string[]
  completedPaths: readonly string[]
  assignedPaths: readonly string[]
  repository?: CodexContinuationRepositoryIdentity
}>

export type CodexContinuationRepositoryIdentity = Readonly<{
  projectIdentity: string
  repositoryResourceKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  observedRevision: string
}>

export type CodexContinuationDependencies = Readonly<{
  load: (userId: string, worldId: string) => Promise<CodexContinuationRecord | null>
  inspectTarget: (
    selectedPath: string,
    repository: CodexContinuationRepositoryIdentity,
  ) => Promise<boolean>
  persist: (input: Readonly<{
    userId: string
    worldId: string
    expectedSnapshot: string
    nextSnapshot: string
    outcomeKey: string
    workOrderId: number
    grantId: number
    authorityVersion: string
  }>) => Promise<"PERSISTED" | "STALE">
}>

export type CodexContinuationEvidenceEvent = Readonly<{
  entityType: "loom_codex_assignment" | "loom_codex_ready" | "loom_agent"
  entityId: string
  selectedPath?: string
  committed?: boolean
  terminal?: boolean
  recordedAt?: string
  repository?: Omit<CodexContinuationRepositoryIdentity, "projectIdentity">
}>

export const CODEX_CONTINUATION_ASSIGNMENT_LEASE_MS = 65 * 60_000

function eventMetadata(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== "string") return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function eventRepository(
  facts: Record<string, unknown> | null,
): Omit<CodexContinuationRepositoryIdentity, "projectIdentity"> | undefined {
  const values = [
    facts?.repositoryResourceKey,
    facts?.repositoryIdentity,
    facts?.repositoryMountKey,
    facts?.observedRevision,
  ]
  if (values.every((value) => value === undefined || value === null)) return undefined
  if (typeof facts?.repositoryResourceKey !== "string" || !facts.repositoryResourceKey
    || typeof facts.repositoryIdentity !== "string" || !facts.repositoryIdentity
    || typeof facts.repositoryMountKey !== "string" || !facts.repositoryMountKey
    || typeof facts.observedRevision !== "string" || !/^[a-f0-9]{40,64}$/.test(facts.observedRevision)) {
    throw new Error("CODEX_CONTINUATION_REPOSITORY_INVALID")
  }
  return {
    repositoryResourceKey: facts.repositoryResourceKey,
    repositoryIdentity: facts.repositoryIdentity,
    repositoryMountKey: facts.repositoryMountKey,
    observedRevision: facts.observedRevision,
  }
}

/** Normalize the two canonical receipt shapes plus the existing terminal agent event. */
export function codexContinuationEvidenceEvent(row: Readonly<Record<string, unknown>>): CodexContinuationEvidenceEvent {
  const facts = eventMetadata(row.metadata)
  const repository = eventRepository(facts)
  const entityType = String(row.entityType) as CodexContinuationEvidenceEvent["entityType"]
  const selectedPath = entityType === "loom_codex_assignment"
    ? (typeof facts?.promotionPath === "string" ? facts.promotionPath : undefined)
    : (typeof facts?.selectedPath === "string" ? facts.selectedPath : undefined)
  return {
    entityType,
    entityId: String(row.entityId ?? ""),
    selectedPath,
    committed: facts?.committed === true,
    terminal: row.eventType === "LOOP_STOPPED",
    recordedAt: row.createdAt instanceof Date ? row.createdAt.toISOString()
      : typeof row.createdAt === "string" ? row.createdAt : undefined,
    ...(repository ? { repository } : {}),
  }
}

/** Reduce existing durable assignment, completion, and terminal facts into live path state. */
export function deriveCodexPathEvidence(
  events: readonly CodexContinuationEvidenceEvent[],
  nowMs = Date.now(),
): Readonly<{
  assignedPaths: string[]
  completedPaths: string[]
  repository?: Omit<CodexContinuationRepositoryIdentity, "projectIdentity">
}> {
  const terminalThreads = new Set(events
    .filter((event) => event.entityType === "loom_agent" && event.terminal)
    .map((event) => event.entityId))
  const completedEvents = events
    .filter((event) => event.entityType === "loom_codex_ready" && event.committed && event.selectedPath)
  const completedPaths = completedEvents.map((event) => event.selectedPath!)
  const repositoryFacts = completedEvents.map((event) => event.repository)
  const repositoryKeys = new Set(repositoryFacts
    .filter((value): value is NonNullable<typeof value> => value !== undefined)
    .map((value) => JSON.stringify(value)))
  if (repositoryKeys.size > 1) throw new Error("CODEX_CONTINUATION_REPOSITORY_DRIFT")
  const repository = completedEvents.length > 0 && repositoryFacts.every((value) => value !== undefined)
    ? repositoryFacts[0] ?? null
    : null
  const assignedPaths = events
    .filter((event) => event.entityType === "loom_codex_assignment"
      && event.selectedPath
      && (!event.recordedAt
        || nowMs - Date.parse(event.recordedAt) <= CODEX_CONTINUATION_ASSIGNMENT_LEASE_MS)
      && !terminalThreads.has(event.entityId))
    .map((event) => event.selectedPath!)
  return {
    assignedPaths: normalizedPaths(assignedPaths),
    completedPaths: normalizedPaths(completedPaths),
    ...(repository ? { repository } : {}),
  }
}

function normalizedPaths(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))]
}

function isExactFileReservation(value: string): boolean {
  return value !== "."
    && !value.endsWith("/")
    && !/[?*\[\]{}]/.test(value)
}

function continuationTask(input: CodexContinuationInput, selectedPath: string): string {
  return [
    `Continue Work Order ${input.workOrderId}: ${input.title}.`,
    `Work only in ${selectedPath}.`,
    `Objective: ${input.objective}`,
    "Acceptance criteria:",
    ...input.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "Validators:",
    ...input.validators.map((validator) => `- ${validator}`),
    "Implement the part of this already-authorized Work Order that belongs in the selected file. Do not widen scope.",
  ].join("\n")
}

/**
 * Choose the next exact-path Codex assignment from authority that already exists.
 *
 * Work Order reservation order is execution order. Durable ready evidence marks completed paths;
 * a durable assignment without matching ready evidence is still in flight and must never be
 * duplicated. This planner creates no Work Order, grant, path, or authority of its own.
 */
export function planCodexContinuation(input: CodexContinuationInput): CodexContinuationPlan {
  const allowed = normalizedPaths(input.allowedPaths)
  const completed = new Set(normalizedPaths(input.completedPaths))
  const assigned = new Set(normalizedPaths(input.assignedPaths).filter((path) => !completed.has(path)))
  if (completed.size === 0 && assigned.size === 0) return { status: "WAITING_FOR_FIRST_ASSIGNMENT" }

  for (const selectedPath of allowed) {
    if (completed.has(selectedPath)) continue
    if (assigned.has(selectedPath)) return { status: "ASSIGNMENT_IN_FLIGHT", selectedPath }
    if (!isExactFileReservation(selectedPath)) {
      return { status: "PATH_RESERVATION_NOT_EXACT", reservation: selectedPath }
    }
    return {
      status: "NEXT_ASSIGNMENT",
      selectedPath,
      task: continuationTask(input, selectedPath),
    }
  }
  return { status: "WORK_ORDER_PATHS_COMPLETE" }
}

/** Persist meaning only: make the already-authorized file the selected object in existing chrome. */
export function selectContinuationPath(
  world: WorkingWorldSnapshot,
  selectedPath: string,
  repository?: CodexContinuationRepositoryIdentity,
): WorkingWorldSnapshot {
  const canonicalPath = normalizedPaths([selectedPath])[0]
  const space = world.space
  if (!canonicalPath || !space || !space.activePaneId) throw new Error("CONTINUATION_SPACE_UNAVAILABLE")
  const activePane = space.panes.find((pane) => pane.id === space.activePaneId)
  if (!activePane) throw new Error("CONTINUATION_SPACE_UNAVAILABLE")
  const currentFileRef = space.selection?.fileRef
    ?? activePane.fileRef
    ?? (() => {
      const matching = space.fileRefs?.filter((ref) => ref.path === activePane.filePath) ?? []
      return matching.length === 1 ? matching[0] : undefined
    })()
  const selectedFileRef: WorkspaceFileRef | undefined = repository
    ? {
        projectIdentity: repository.projectIdentity,
        repositoryResourceKey: repository.repositoryResourceKey,
        repositoryMountKey: repository.repositoryMountKey,
        worktreeKey: null,
        observedRevision: repository.observedRevision,
        path: canonicalPath,
      }
    : currentFileRef ? { ...currentFileRef, path: canonicalPath } : undefined
  const exactSelectionMatches = !selectedFileRef || (
    activePane.fileRef != null
    && space.selection?.fileRef !== undefined
    && canonicalWorkspaceObjectKey(activePane.fileRef) === canonicalWorkspaceObjectKey(selectedFileRef)
    && canonicalWorkspaceObjectKey(space.selection.fileRef) === canonicalWorkspaceObjectKey(selectedFileRef)
  )
  if (activePane.filePath === canonicalPath && space.selection?.filePath === canonicalPath && exactSelectionMatches) return world

  if (space.fileRefs !== undefined && !selectedFileRef) {
    throw new Error("CONTINUATION_REPOSITORY_IDENTITY_UNAVAILABLE")
  }
  if (repository && space.fileRefs === undefined && space.openFiles.length > 0) {
    throw new Error("CONTINUATION_REPOSITORY_IDENTITY_UNAVAILABLE")
  }
  const selectedObjectKey = selectedFileRef ? canonicalWorkspaceObjectKey(selectedFileRef) : null
  const existingFileRefs = space.fileRefs ?? (repository ? [] : undefined)
  const alreadyOpen = selectedObjectKey
    ? existingFileRefs?.some((ref) => canonicalWorkspaceObjectKey(ref) === selectedObjectKey) === true
    : space.openFiles.includes(canonicalPath)
  const openFiles = alreadyOpen ? [...space.openFiles] : [...space.openFiles, canonicalPath]
  const fileRefs = existingFileRefs === undefined
    ? undefined
    : alreadyOpen
      ? [...existingFileRefs]
      : [...existingFileRefs, selectedFileRef!]
  if (openFiles.length > 64) throw new Error("CONTINUATION_SPACE_FILE_CAPACITY")
  const selection = {
    filePath: canonicalPath,
    ...(selectedFileRef ? { fileRef: selectedFileRef } : {}),
    anchor: 0,
    head: 0,
  }
  return validateWorkingWorld({
    ...world,
    space: {
      ...space,
      revision: space.revision + 1,
      openFiles,
      ...(fileRefs !== undefined ? { fileRefs } : {}),
      panes: space.panes.map((pane) => pane.id === space.activePaneId
        ? {
            ...pane,
            filePath: canonicalPath,
            ...(selectedFileRef ? { fileRef: selectedFileRef } : {}),
            selection: { anchor: 0, head: 0 },
          }
        : pane),
      selection,
      activeWindowId: space.windows.some((window) => window.id === "workspace-editor")
        ? "workspace-editor"
        : space.activeWindowId,
    },
  })
}

export async function prepareCodexContinuation(
  input: Readonly<{
    userId: string
    worldId: string
    outcomeKey: string
    workOrderId: number
    grantId: number
    completedPath: string
  }>,
  dependencies: CodexContinuationDependencies,
): Promise<CodexContinuationPlan | Readonly<{ status: "SPACE_PERSISTENCE_BUSY" }>> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const record = await dependencies.load(input.userId, input.worldId)
    if (!record
      || record.outcomeKey !== input.outcomeKey
      || record.workOrderId !== input.workOrderId
      || record.grantId !== input.grantId
      || !normalizedPaths(record.completedPaths).includes(normalizedPaths([input.completedPath])[0] ?? "")) {
      throw new Error("CODEX_CONTINUATION_AUTHORITY_CHANGED")
    }
    const plan = planCodexContinuation({
      worldId: input.worldId,
      outcomeKey: record.outcomeKey,
      workOrderId: record.workOrderId,
      grantId: record.grantId,
      title: record.title,
      objective: record.objective,
      acceptanceCriteria: record.acceptanceCriteria,
      validators: record.validators,
      allowedPaths: record.allowedPaths,
      completedPaths: record.completedPaths,
      assignedPaths: record.assignedPaths,
    })
    if (plan.status !== "NEXT_ASSIGNMENT") return plan
    if (!record.repository) throw new Error("CODEX_CONTINUATION_REPOSITORY_UNAVAILABLE")
    if (!await dependencies.inspectTarget(plan.selectedPath, record.repository)) {
      return { status: "PATH_RESERVATION_UNAVAILABLE", selectedPath: plan.selectedPath }
    }
    const nextWorld = selectContinuationPath(record.world, plan.selectedPath, record.repository)
    const exactPlan = { ...plan, repositoryKey: record.repository.repositoryResourceKey }
    if (nextWorld === record.world) return exactPlan
    const persisted = await dependencies.persist({
      userId: input.userId,
      worldId: input.worldId,
      expectedSnapshot: record.snapshot,
      nextSnapshot: JSON.stringify(nextWorld),
      outcomeKey: record.outcomeKey,
      workOrderId: record.workOrderId,
      grantId: record.grantId,
      authorityVersion: record.authorityVersion,
    })
    if (persisted === "PERSISTED") return exactPlan
  }
  return { status: "SPACE_PERSISTENCE_BUSY" }
}

export async function readCodexContinuation(
  userId: string,
  worldId: string,
  dependencies: CodexContinuationDependencies,
): Promise<CodexContinuationPlan | Readonly<{ status: "NO_ACTIVE_ASSIGNMENT" }>> {
  const record = await dependencies.load(userId, worldId)
  if (!record) return { status: "NO_ACTIVE_ASSIGNMENT" }
  const plan = planCodexContinuation({
    worldId,
    outcomeKey: record.outcomeKey,
    workOrderId: record.workOrderId,
    grantId: record.grantId,
    title: record.title,
    objective: record.objective,
    acceptanceCriteria: record.acceptanceCriteria,
    validators: record.validators,
    allowedPaths: record.allowedPaths,
    completedPaths: record.completedPaths,
    assignedPaths: record.assignedPaths,
  })
  if (plan.status === "NEXT_ASSIGNMENT") {
    if (!record.repository) throw new Error("CODEX_CONTINUATION_REPOSITORY_UNAVAILABLE")
    if (!await dependencies.inspectTarget(plan.selectedPath, record.repository)) {
      return { status: "PATH_RESERVATION_UNAVAILABLE", selectedPath: plan.selectedPath }
    }
    return { ...plan, repositoryKey: record.repository.repositoryResourceKey }
  }
  return plan
}
