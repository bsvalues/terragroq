import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { and, eq, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import {
  authorityGrant,
  outcomeQueueItem,
  project,
  projectResource,
  workingWorld,
  workbenchThread,
  workbenchThreadSource,
  workOrder,
} from "@/lib/db/schema"
import {
  grantCovers,
  isGrantActive,
  type AuthorityGrantFacts,
} from "@/lib/governance/authority"
import {
  databaseSpaceWorkingWorldStore,
  type SpaceWorkingWorldStore,
} from "@/lib/environment/space-persistence"
import {
  validateWorkingWorld,
  withBoundOutcome,
  type RetainedStartWork,
} from "@/lib/environment/working-world"

type OutcomeBinding = Readonly<{
  id: number
  userId: string
  lifecycleState: string
  approvalState: string
  authorityState: string
  authorityLevel: string
  activeWorkOrderId: number | null
  version: number
}>

type WorkOrderBinding = Readonly<{
  id: number
  userId: string
  ref: string | null
  status: string
  authorityLevel: string
  authorityGranted: string | null
  authorityGrantId: number | null
  agent: string | null
  allowedFiles: readonly string[]
  forbiddenFiles: readonly string[]
}>

type GrantBinding = Readonly<{
  id: number
  userId: string
  ref: string | null
  workOrderId: number | null
  grantedBy: string
  grantedTo: string
  status: string
  authorityLevel: string
  allowedActions: readonly string[]
  blockedActions: readonly string[]
  expiresAt: Date | null
  revokedAt: Date | null
  revokeReason: string | null
  contentHash?: string | null
}>

type ProjectResourceBinding = Readonly<{
  type: string
  canonicalIdentity: string
  relationship: string
}>

export type SpaceOutcomeAuthority = Readonly<{
  selection: RetainedStartWork
  outcome: OutcomeBinding
  workOrder: WorkOrderBinding
  grant: GrantBinding
}>

type SpaceOutcomeAuthorityCandidate =
  | Readonly<SpaceOutcomeAuthority & {
      projectResources: readonly ProjectResourceBinding[]
    }>
  | Readonly<{
      invalid: true
      projectId: number
      projectResources: readonly ProjectResourceBinding[]
    }>

type AuthorityLookup = SpaceOutcomeAuthority | Readonly<{ invalid: true }> | null

export type SpaceOutcomeAssimilationResult =
  | Readonly<{
      status: "ATTACHED" | "ALREADY_ATTACHED"
      worldId: string
      outcomeKey: string
      workOrderId: number
      authorityLevel: string
      reservedPaths: readonly string[]
    }>
  | Readonly<{ status: "MISSING_AUTHORITY"; reason: "NO_ACTIVE_OWNER_OUTCOME" | "AUTHORITY_BINDING_INVALID" }>
  | Readonly<{ status: "WORLD_NOT_FOUND" }>
  | Readonly<{ status: "SPACE_ALREADY_BOUND"; outcomeKey: string; workOrderId: number | null }>
  | Readonly<{ status: "SPACE_AUTHORITY_UNAVAILABLE" }>
  | Readonly<{ status: "SPACE_PERSISTENCE_BUSY" }>

export type SpaceOutcomeAssimilationDependencies = Readonly<{
  store: SpaceWorkingWorldStore
  findActiveAuthorities: (userId: string) => Promise<readonly SpaceOutcomeAuthorityCandidate[]>
  resolveSpaceRepositoryIdentities: (resources: readonly string[]) => Promise<readonly string[]>
  attachIfAuthorityCurrent: (input: AuthorityAttachmentInput) => Promise<AuthorityAttachmentResult>
}>

type AuthorityAttachmentInput = Readonly<{
  userId: string
  worldId: string
  expectedSnapshot: string
  nextSnapshot: string
  nextIntent: string
  authority: SpaceOutcomeAuthority
  repositoryIdentities: readonly string[]
}>

type AuthorityAttachmentResult = "ATTACHED" | "WORLD_CHANGED" | "WORLD_NOT_FOUND" | "AUTHORITY_CHANGED" | "RETRYABLE" | "UNAVAILABLE"

const WORKSPACE_ROOT_RESOURCE = "williamos-workspace-root:v1:"
const REPOSITORY_RESOURCE = "repo:"
const execFileAsync = promisify(execFile)

function normalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort()
}

function sameReservation(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}

/** Drizzle has already converted UTC-wall columns to real instants; never convert those Dates twice. */
export function authorityGrantFactsFromNormalizedRow(row: GrantBinding): AuthorityGrantFacts {
  const instant = (value: Date | null): Date | null => {
    if (value === null) return null
    if (!Number.isFinite(value.getTime())) throw new Error("AUTHORITY_TIMESTAMP_INVALID")
    return new Date(value.getTime())
  }
  return {
    id: row.id,
    ref: row.ref,
    status: row.status,
    authorityLevel: row.authorityLevel,
    allowedActions: [...row.allowedActions],
    blockedActions: [...row.blockedActions],
    expiresAt: instant(row.expiresAt),
    revokedAt: instant(row.revokedAt),
    revokeReason: row.revokeReason,
    userId: row.userId,
    grantedTo: row.grantedTo,
  }
}

function canonicalRepositoryIdentity(value: string): string | null {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/\/$/, "")
  if (!trimmed) return null
  if (trimmed.startsWith(REPOSITORY_RESOURCE)) {
    const declared = trimmed.slice(REPOSITORY_RESOURCE.length)
    return /^[^/:\s]+\/[^/\s]+$/.test(declared) ? declared.replace(/\.git$/i, "").toLowerCase() : null
  }
  const github = /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@(?:ssh\.)?github\.com(?::\d+)?\/)([^/\s]+\/[^/\s]+?)(?:\.git)?$/i.exec(trimmed)
  return github?.[1]?.replace(/\.git$/i, "").toLowerCase() ?? null
}

function normalizedDeclaredRepositoryIdentity(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\.git$/i, "").toLowerCase()
  return /^[^/:\s]+\/[^/\s]+$/.test(normalized) ? normalized : null
}

export async function resolveSpaceRepositoryIdentities(resources: readonly string[]): Promise<readonly string[]> {
  const identities = new Set<string>()
  for (const resource of resources) {
    const direct = canonicalRepositoryIdentity(resource)
    if (direct) identities.add(direct)
    if (!resource.startsWith(WORKSPACE_ROOT_RESOURCE)) continue
    const root = resource.slice(WORKSPACE_ROOT_RESOURCE.length).trim()
    if (!root) continue
    try {
      const result = await execFileAsync("git", ["-C", root, "remote", "get-url", "origin"], {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      })
      const identity = canonicalRepositoryIdentity(result.stdout)
      if (identity) identities.add(identity)
    } catch {
      // A missing/unreadable repository is not permission to infer a project from its display name.
    }
  }
  return [...identities].sort()
}

function selectSpaceAuthority(
  repositoryIdentities: readonly string[],
  candidates: readonly SpaceOutcomeAuthorityCandidate[],
): AuthorityLookup {
  if (candidates.length === 0) return null
  const identities = new Set(repositoryIdentities.map(normalizedDeclaredRepositoryIdentity).filter((value): value is string => Boolean(value)))
  if (identities.size !== 1) return { invalid: true }
  const matches = candidates.filter((candidate) => {
    const primaryRepos = candidate.projectResources.filter((resource) =>
      resource.type === "repo" && resource.relationship === "primary-repo",
    )
    return primaryRepos.length === 1
      && identities.has(primaryRepos[0].canonicalIdentity.trim().toLowerCase())
  })
  if (matches.length !== 1 || "invalid" in matches[0]) return { invalid: true }
  return matches[0]
}

function validAuthority(userId: string, candidate: SpaceOutcomeAuthority): boolean {
  const { selection, outcome, workOrder: work, grant } = candidate
  const allowed = normalized(work.allowedFiles)
  const forbidden = normalized(work.forbiddenFiles)
  const grantFacts = authorityGrantFactsFromNormalizedRow(grant)
  return outcome.userId === userId
    && outcome.lifecycleState === "active"
    && outcome.approvalState === "approved"
    && outcome.authorityState === "matched"
    && outcome.activeWorkOrderId === work.id
    && outcome.authorityLevel === work.authorityLevel
    && selection.outcomeKey.length > 0
    && selection.activeWorkOrderId === work.id
    && work.userId === userId
    && work.status === "active"
    && work.authorityGranted === work.authorityLevel
    && work.authorityGrantId === grant.id
    && allowed.length > 0
    && grant.userId === userId
    && grant.grantedBy === userId
    && grant.workOrderId === work.id
    && grant.authorityLevel === work.authorityLevel
    && Boolean(work.agent?.trim())
    && grant.grantedTo.trim().toLowerCase() === work.agent!.trim().toLowerCase()
    && sameReservation(grant.allowedActions, allowed)
    && sameReservation(grant.blockedActions, forbidden)
    && isGrantActive(grantFacts).ok
    && grantCovers(grantFacts, "A2_WRITE_OWN").ok
    && grantCovers(grantFacts, work.authorityLevel as never).ok
}

function attachedResult(
  status: "ATTACHED" | "ALREADY_ATTACHED",
  worldId: string,
  authority: SpaceOutcomeAuthority,
): SpaceOutcomeAssimilationResult {
  return {
    status,
    worldId,
    outcomeKey: authority.selection.outcomeKey,
    workOrderId: authority.workOrder.id,
    authorityLevel: authority.workOrder.authorityLevel,
    reservedPaths: normalized(authority.workOrder.allowedFiles),
  }
}

async function findActiveAuthorities(userId: string): Promise<readonly SpaceOutcomeAuthorityCandidate[]> {
  const outcomes = await db.select({
    id: outcomeQueueItem.id,
    userId: outcomeQueueItem.userId,
    outcomeKey: outcomeQueueItem.outcomeKey,
    title: outcomeQueueItem.title,
    lifecycleState: outcomeQueueItem.lifecycleState,
    approvalState: outcomeQueueItem.approvalState,
    authorityState: outcomeQueueItem.authorityState,
    authorityLevel: outcomeQueueItem.authorityLevel,
    activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
    version: outcomeQueueItem.version,
    threadId: workbenchThread.id,
    projectId: project.id,
    projectName: project.name,
  }).from(outcomeQueueItem)
    .innerJoin(workbenchThreadSource, and(
      eq(workbenchThreadSource.userId, outcomeQueueItem.userId),
      eq(workbenchThreadSource.sourceType, "outcome"),
      eq(workbenchThreadSource.sourceId, outcomeQueueItem.outcomeKey),
      eq(workbenchThreadSource.role, "root"),
    ))
    .innerJoin(workbenchThread, and(
      eq(workbenchThread.userId, workbenchThreadSource.userId),
      eq(workbenchThread.id, workbenchThreadSource.threadId),
    ))
    .innerJoin(project, and(
      eq(project.userId, workbenchThread.userId),
      eq(project.id, workbenchThread.projectId),
    ))
    .where(and(
      eq(outcomeQueueItem.userId, userId),
      eq(outcomeQueueItem.lifecycleState, "active"),
    ))
  if (outcomes.length === 0) return []

  const projectIds = [...new Set(outcomes.map((outcome) => outcome.projectId))]
  const resources = await db.select({
    projectId: projectResource.projectId,
    type: projectResource.type,
    canonicalIdentity: projectResource.canonicalIdentity,
    relationship: projectResource.relationship,
  }).from(projectResource).where(and(
    eq(projectResource.userId, userId),
    inArray(projectResource.projectId, projectIds),
  ))
  const resourcesByProject = new Map<number, ProjectResourceBinding[]>()
  for (const resource of resources) {
    const rows = resourcesByProject.get(resource.projectId) ?? []
    rows.push(resource)
    resourcesByProject.set(resource.projectId, rows)
  }

  const workOrderIds = outcomes
    .map((outcome) => Number(outcome.activeWorkOrderId))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  const works = workOrderIds.length === 0 ? [] : await db.select().from(workOrder)
    .where(and(eq(workOrder.userId, userId), inArray(workOrder.id, workOrderIds)))
  const workById = new Map(works.map((work) => [work.id, work]))
  const grantIds = works
    .map((work) => Number(work.authorityGrantId))
    .filter((id) => Number.isSafeInteger(id) && id > 0)
  const grants = grantIds.length === 0 ? [] : await db.select().from(authorityGrant)
    .where(and(eq(authorityGrant.userId, userId), inArray(authorityGrant.id, grantIds)))
  const grantById = new Map(grants.map((grant) => [grant.id, grant]))

  return outcomes.map((outcome): SpaceOutcomeAuthorityCandidate => {
    const projectResources = resourcesByProject.get(outcome.projectId) ?? []
    const activeWorkOrderId = Number(outcome.activeWorkOrderId)
    const work = workById.get(activeWorkOrderId)
    const grant = work?.authorityGrantId ? grantById.get(work.authorityGrantId) : undefined
    if (!Number.isSafeInteger(activeWorkOrderId) || activeWorkOrderId <= 0 || !work || !grant) {
      return { invalid: true, projectId: outcome.projectId, projectResources }
    }
    return {
      selection: {
        projectId: outcome.projectId,
        projectName: outcome.projectName,
        threadId: outcome.threadId,
        outcomeKey: outcome.outcomeKey,
        outcomeTitle: outcome.title,
        activeWorkOrderId,
      },
      outcome,
      workOrder: work,
      grant,
      projectResources,
    }
  })
}

function sameAuthoritySnapshot(expected: SpaceOutcomeAuthority, current: SpaceOutcomeAuthority): boolean {
  return expected.selection.projectId === current.selection.projectId
    && expected.selection.threadId === current.selection.threadId
    && expected.selection.outcomeKey === current.selection.outcomeKey
    && expected.outcome.id === current.outcome.id
    && expected.outcome.version === current.outcome.version
    && expected.outcome.activeWorkOrderId === current.outcome.activeWorkOrderId
    && expected.workOrder.id === current.workOrder.id
    && expected.workOrder.authorityGrantId === current.workOrder.authorityGrantId
    && sameReservation(expected.workOrder.allowedFiles, current.workOrder.allowedFiles)
    && sameReservation(expected.workOrder.forbiddenFiles, current.workOrder.forbiddenFiles)
    && expected.grant.id === current.grant.id
    && expected.grant.contentHash === current.grant.contentHash
    && sameReservation(expected.grant.allowedActions, current.grant.allowedActions)
    && sameReservation(expected.grant.blockedActions, current.grant.blockedActions)
}

export function authoritySnapshotRemainsCurrent(
  userId: string,
  expected: SpaceOutcomeAuthority,
  current: SpaceOutcomeAuthority,
): boolean {
  return sameAuthoritySnapshot(expected, current) && validAuthority(userId, current)
}

async function attachIfAuthorityCurrent(input: AuthorityAttachmentInput): Promise<AuthorityAttachmentResult> {
  try {
    return await db.transaction(async (transaction): Promise<AuthorityAttachmentResult> => {
      const worlds = await transaction.select({ snapshot: workingWorld.snapshot })
        .from(workingWorld)
        .where(and(eq(workingWorld.userId, input.userId), eq(workingWorld.id, input.worldId)))
        .limit(1)
        .for("update")
      if (worlds.length !== 1) return "WORLD_NOT_FOUND"
      if (worlds[0].snapshot !== input.expectedSnapshot) return "WORLD_CHANGED"

      const outcomes = await transaction.select({
        id: outcomeQueueItem.id,
        userId: outcomeQueueItem.userId,
        outcomeKey: outcomeQueueItem.outcomeKey,
        title: outcomeQueueItem.title,
        lifecycleState: outcomeQueueItem.lifecycleState,
        approvalState: outcomeQueueItem.approvalState,
        authorityState: outcomeQueueItem.authorityState,
        authorityLevel: outcomeQueueItem.authorityLevel,
        activeWorkOrderId: outcomeQueueItem.activeWorkOrderId,
        version: outcomeQueueItem.version,
        threadId: workbenchThread.id,
        projectId: project.id,
        projectName: project.name,
      }).from(outcomeQueueItem)
        .innerJoin(workbenchThreadSource, and(
          eq(workbenchThreadSource.userId, outcomeQueueItem.userId),
          eq(workbenchThreadSource.sourceType, "outcome"),
          eq(workbenchThreadSource.sourceId, outcomeQueueItem.outcomeKey),
          eq(workbenchThreadSource.role, "root"),
        ))
        .innerJoin(workbenchThread, and(
          eq(workbenchThread.userId, workbenchThreadSource.userId),
          eq(workbenchThread.id, workbenchThreadSource.threadId),
        ))
        .innerJoin(project, and(
          eq(project.userId, workbenchThread.userId),
          eq(project.id, workbenchThread.projectId),
        ))
        .where(and(
          eq(outcomeQueueItem.userId, input.userId),
          eq(outcomeQueueItem.id, input.authority.outcome.id),
        ))
        .limit(2)
        .for("update")
      if (outcomes.length !== 1) return "AUTHORITY_CHANGED"
      const outcome = outcomes[0]

      const resources = await transaction.select({
        type: projectResource.type,
        canonicalIdentity: projectResource.canonicalIdentity,
        relationship: projectResource.relationship,
      }).from(projectResource)
        .where(and(
          eq(projectResource.userId, input.userId),
          eq(projectResource.projectId, outcome.projectId),
        ))
        .for("update")
      const primaryRepos = resources.filter((resource) =>
        resource.type === "repo" && resource.relationship === "primary-repo",
      )
      if (primaryRepos.length !== 1) return "AUTHORITY_CHANGED"
      const expectedRepositories = new Set(input.repositoryIdentities
        .map(normalizedDeclaredRepositoryIdentity)
        .filter((value): value is string => Boolean(value)))
      const currentPrimaryRepository = normalizedDeclaredRepositoryIdentity(primaryRepos[0].canonicalIdentity)
      if (expectedRepositories.size !== 1
        || !currentPrimaryRepository
        || !expectedRepositories.has(currentPrimaryRepository)) {
        return "AUTHORITY_CHANGED"
      }

      const activeWorkOrderId = Number(outcome.activeWorkOrderId)
      if (!Number.isSafeInteger(activeWorkOrderId) || activeWorkOrderId <= 0) return "AUTHORITY_CHANGED"
      const works = await transaction.select().from(workOrder)
        .where(and(eq(workOrder.userId, input.userId), eq(workOrder.id, activeWorkOrderId)))
        .limit(1)
        .for("update")
      const work = works[0]
      if (!work?.authorityGrantId) return "AUTHORITY_CHANGED"
      const grants = await transaction.select().from(authorityGrant)
        .where(and(eq(authorityGrant.userId, input.userId), eq(authorityGrant.id, work.authorityGrantId)))
        .limit(1)
        .for("update")
      const grant = grants[0]
      if (!grant) return "AUTHORITY_CHANGED"

      const current: SpaceOutcomeAuthority = {
        selection: {
          projectId: outcome.projectId,
          projectName: outcome.projectName,
          threadId: outcome.threadId,
          outcomeKey: outcome.outcomeKey,
          outcomeTitle: outcome.title,
          activeWorkOrderId,
        },
        outcome,
        workOrder: work,
        grant,
      }
      if (!authoritySnapshotRemainsCurrent(input.userId, input.authority, current)) {
        return "AUTHORITY_CHANGED"
      }

      const updated = await transaction.update(workingWorld)
        .set({ snapshot: input.nextSnapshot, intent: input.nextIntent, updatedAt: new Date() })
        .where(and(
          eq(workingWorld.userId, input.userId),
          eq(workingWorld.id, input.worldId),
          eq(workingWorld.snapshot, input.expectedSnapshot),
        ))
        .returning({ id: workingWorld.id })
      return updated.length === 1 ? "ATTACHED" : "WORLD_CHANGED"
    }, { isolationLevel: "serializable" })
  } catch (error) {
    return classifyAuthorityAttachmentFailure(error)
  }
}

export function classifyAuthorityAttachmentFailure(error: unknown): "RETRYABLE" | "UNAVAILABLE" {
  const visited = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current)
    const candidate = current as { code?: unknown; cause?: unknown }
    if (candidate.code === "40001" || candidate.code === "40P01") return "RETRYABLE"
    current = candidate.cause
  }
  return "UNAVAILABLE"
}

const productionDependencies: SpaceOutcomeAssimilationDependencies = {
  store: databaseSpaceWorkingWorldStore,
  findActiveAuthorities,
  resolveSpaceRepositoryIdentities,
  attachIfAuthorityCurrent,
}

export async function assimilateOwnedSpaceOutcome(
  input: Readonly<{ userId: string; worldId: string }>,
  dependencies: SpaceOutcomeAssimilationDependencies = productionDependencies,
): Promise<SpaceOutcomeAssimilationResult> {
  let row = await dependencies.store.findOwned(input.userId, input.worldId)
  if (!row) return { status: "WORLD_NOT_FOUND" }
  let selectedProjectId: number | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const world = validateWorkingWorld(JSON.parse(row.snapshot))
    const [candidates, repositoryIdentities] = await Promise.all([
      dependencies.findActiveAuthorities(input.userId),
      dependencies.resolveSpaceRepositoryIdentities(world.resources),
    ])
    const candidate = selectSpaceAuthority(repositoryIdentities, candidates)
    if (!candidate) return { status: "MISSING_AUTHORITY", reason: "NO_ACTIVE_OWNER_OUTCOME" }
    if ("invalid" in candidate || !validAuthority(input.userId, candidate)) {
      return { status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" }
    }
    if (selectedProjectId !== null && candidate.selection.projectId !== selectedProjectId) {
      return { status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" }
    }
    selectedProjectId = candidate.selection.projectId

    if (world.spine.outcomeKey !== null) {
      if (world.spine.outcomeKey === candidate.selection.outcomeKey
        && world.spine.workOrderId === candidate.workOrder.id
        && world.spine.threadId === candidate.selection.threadId
        && world.spine.projectId === candidate.selection.projectId) {
        return attachedResult("ALREADY_ATTACHED", input.worldId, candidate)
      }
      return {
        status: "SPACE_ALREADY_BOUND",
        outcomeKey: world.spine.outcomeKey,
        workOrderId: world.spine.workOrderId,
      }
    }
    const bound = validateWorkingWorld({
      ...withBoundOutcome(world, candidate.selection),
      judgment: null,
    })
    const attachment = await dependencies.attachIfAuthorityCurrent({
      userId: input.userId,
      worldId: input.worldId,
      expectedSnapshot: row.snapshot,
      nextSnapshot: JSON.stringify(bound),
      nextIntent: bound.intent,
      authority: candidate,
      repositoryIdentities,
    })
    if (attachment === "ATTACHED") return attachedResult("ATTACHED", input.worldId, candidate)
    if (attachment === "WORLD_NOT_FOUND") return { status: "WORLD_NOT_FOUND" }
    if (attachment === "AUTHORITY_CHANGED") {
      return { status: "MISSING_AUTHORITY", reason: "AUTHORITY_BINDING_INVALID" }
    }
    if (attachment === "RETRYABLE") continue
    if (attachment === "UNAVAILABLE") return { status: "SPACE_AUTHORITY_UNAVAILABLE" }
    const current = await dependencies.store.findOwned(input.userId, input.worldId)
    if (!current) return { status: "WORLD_NOT_FOUND" }
    row = current
  }
  return { status: "SPACE_PERSISTENCE_BUSY" }
}
