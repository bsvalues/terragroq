import { pool } from "@/lib/db"
import {
  verifyAssignmentContextManifest,
  type AssignmentContextManifest,
} from "@/lib/loom/assignment-context-manifest"
import {
  assessRepositoryReservations,
  type ContractReservation,
  type EnvironmentReservation,
  type AssignmentReservationSet,
  type ReservationCollision,
  type ReservationDependency,
} from "@/lib/loom/repository-reservations"

export type RepositoryAssignmentEventRow = Readonly<{
  id: number
  userId: string
  eventType: string
  entityType: string | null
  entityId: string | null
  metadata: unknown
  projectId: number | null
  createdAt: Date | string
}>

export type ScopedAssignmentReservationSet = AssignmentReservationSet & Readonly<{
  worldId: string
  projectId: number
}>

export type RepositoryAssignmentReservationClaims = Readonly<{
  contracts: readonly ContractReservation[]
  environments: readonly EnvironmentReservation[]
}>

export type RepositoryAssignmentAuthorityRow = Readonly<{
  workOrderId: number
  workOrderUserId: string
  authorityGrantId: number | null
  grantId: number
  grantUserId: string
  grantWorkOrderId: number | null
  grantScope: unknown
}>

export type ActiveRepositoryAssignmentLimitation = Readonly<{
  assignmentId: string
  worldId: string
  projectId: number
  code: "CLAUDE_EXACT_RESERVATION_UNAVAILABLE" | "LEGACY_CODEX_EXACT_RESERVATION_UNAVAILABLE"
  detail: string
}>

export type ActiveRepositoryAssignmentProjection = Readonly<{
  status: "READY" | "LIMITED"
  assignmentsById: Readonly<Record<string, ScopedAssignmentReservationSet>>
  limitations: readonly ActiveRepositoryAssignmentLimitation[]
}>

export type ActiveRepositoryAssignmentAssessment =
  | Readonly<{
      status: "COMPATIBLE"
      activeAssignments: readonly ScopedAssignmentReservationSet[]
      dependencies: readonly ReservationDependency[]
    }>
  | Readonly<{
      status: "BLOCKED"
      activeAssignments: readonly ScopedAssignmentReservationSet[]
      collisions: readonly ReservationCollision[]
      dependencies: readonly ReservationDependency[]
    }>
  | Readonly<{
      status: "LIMITED"
      activeAssignments: readonly ScopedAssignmentReservationSet[]
      limitations: readonly ActiveRepositoryAssignmentLimitation[]
    }>

export type RepositoryAssignmentRuntimeDependencies = Readonly<{
  loadEvents: (userId: string, projectId: number) => Promise<readonly RepositoryAssignmentEventRow[]>
}>

export type RepositoryAssignmentClaimsDependencies = Readonly<{
  loadAuthority: (
    userId: string,
    workOrderId: number,
    grantId: number,
  ) => Promise<RepositoryAssignmentAuthorityRow | null>
}>

export class ActiveRepositoryAssignmentError extends Error {
  readonly code:
    | "MALFORMED_PERSISTED_ASSIGNMENT"
    | "ASSIGNMENT_IDENTITY_REUSED"
    | "ASSIGNMENT_RESERVATION_CLAIMS_UNAVAILABLE"

  constructor(code: ActiveRepositoryAssignmentError["code"], message: string) {
    super(message)
    this.name = "ActiveRepositoryAssignmentError"
    this.code = code
  }
}

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonRecord
  if (typeof value !== "string") return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : null
  } catch {
    return null
  }
}

function exactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() === value && value.length > 0 ? value : null
}

function exactInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null
}

function exactArray(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null
}

function malformed(assignmentId: string): never {
  throw new ActiveRepositoryAssignmentError(
    "MALFORMED_PERSISTED_ASSIGNMENT",
    `assignment ${assignmentId} has a partial or inconsistent repository reservation`,
  )
}

function claimsUnavailable(detail: string): never {
  throw new ActiveRepositoryAssignmentError(
    "ASSIGNMENT_RESERVATION_CLAIMS_UNAVAILABLE",
    detail,
  )
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index])
}

function parseContracts(value: unknown, assignmentId: string): AssignmentReservationSet["contracts"] {
  const values = exactArray(value)
  if (!values) malformed(assignmentId)
  return values.map((entry) => {
    const item = record(entry)
    const contractIdentity = exactString(item?.contractIdentity)
    const revisionIdentity = exactString(item?.revisionIdentity)
    const role = item?.role
    if (!item || Object.keys(item).some((key) => !["contractIdentity", "revisionIdentity", "role"].includes(key))
      || !contractIdentity || !revisionIdentity || (role !== "producer" && role !== "consumer")) {
      malformed(assignmentId)
    }
    return { contractIdentity, revisionIdentity, role }
  })
}

function parseEnvironments(value: unknown, assignmentId: string): AssignmentReservationSet["environments"] {
  const values = exactArray(value)
  if (!values) malformed(assignmentId)
  return values.map((entry) => {
    const item = record(entry)
    const environmentIdentity = exactString(item?.environmentIdentity)
    const access = item?.access
    if (!item || Object.keys(item).some((key) => !["environmentIdentity", "access"].includes(key))
      || !environmentIdentity || (access !== "exclusive" && access !== "shared-read")) {
      malformed(assignmentId)
    }
    return { environmentIdentity, access }
  })
}

function parseCodexAssignment(
  event: RepositoryAssignmentEventRow,
  metadata: JsonRecord,
  userId: string,
  projectId: number,
): ScopedAssignmentReservationSet | ActiveRepositoryAssignmentLimitation {
  const assignmentId = exactString(event.entityId)
  if (!assignmentId) malformed("<missing>")
  const assignmentWorldId = exactString(metadata.worldId)
  if (!assignmentWorldId) malformed(assignmentId)
  const repositoryFields = [
    metadata.repositoryResourceKey,
    metadata.repositoryIdentity,
    metadata.repositoryMountKey,
    metadata.observedRevision,
    metadata.contextManifest,
  ]
  if (repositoryFields.every((value) => value === undefined || value === null)) {
    return {
      assignmentId,
      worldId: assignmentWorldId,
      projectId,
      code: "LEGACY_CODEX_EXACT_RESERVATION_UNAVAILABLE",
      detail: "active legacy Codex mutation does not persist an exact repository checkout and reservation set",
    }
  }
  if (repositoryFields.some((value) => value === undefined || value === null)) malformed(assignmentId)

  const manifest = metadata.contextManifest as AssignmentContextManifest
  const reservation = record(metadata.reservation)
  const workOrder = record(metadata.workOrder)
  const repositoryResourceId = exactInteger(manifest?.targetRepository?.repositoryResourceId)
  const repositoryKey = exactString(metadata.repositoryResourceKey)
  const repositoryIdentity = exactString(metadata.repositoryIdentity)
  const repositoryMountKey = exactString(metadata.repositoryMountKey)
  const baseRevision = exactString(metadata.observedRevision)
  const isolatedBaseSha = exactString(metadata.isolatedBaseSha)
  const threadId = exactString(metadata.threadId)
  const assignmentOwner = exactString(metadata.owner)
  const workOrderId = exactInteger(workOrder?.id)
  const assignmentHash = exactString(metadata.assignmentHash)
  const pathsValue = exactArray(reservation?.allowed)
  const paths = pathsValue?.map(exactString)
  if (metadata.assignmentVersion !== "loom-codex-assignment.v1"
    || assignmentOwner !== userId || threadId !== assignmentId || !assignmentWorldId
    || !repositoryResourceId || !repositoryKey || !repositoryIdentity || !repositoryMountKey
    || !baseRevision || !isolatedBaseSha || baseRevision !== isolatedBaseSha
    || !workOrderId || !assignmentHash || !paths || paths.some((path) => path === null)
    || !reservation || !exactString(reservation.version)
    || verifyAssignmentContextManifest(manifest).ok !== true
    || manifest.assignment.assignmentId !== assignmentId
    || manifest.assignment.worldId !== assignmentWorldId
    || manifest.project.id !== projectId
    || manifest.assignment.workOrderId !== workOrderId
    || manifest.assignment.assignmentHash !== assignmentHash
    || manifest.targetRepository.repositoryResourceId !== repositoryResourceId
    || manifest.targetRepository.repositoryKey !== repositoryKey
    || manifest.targetRepository.repositoryIdentity !== repositoryIdentity
    || manifest.checkout.repositoryMountKey !== repositoryMountKey
    || manifest.checkout.baseRevision !== baseRevision
    || manifest.mutationPosture.target.repositoryResourceId !== repositoryResourceId
    || manifest.mutationPosture.target.repositoryKey !== repositoryKey
    || manifest.mutationPosture.target.repositoryIdentity !== repositoryIdentity
    || !sameStrings(manifest.mutationPosture.target.writablePaths, paths as string[])) {
    malformed(assignmentId)
  }

  return {
    assignmentId,
    worldId: assignmentWorldId,
    projectId,
    repository: {
      repositoryResourceId,
      repositoryKey,
      repositoryIdentity,
      repositoryMountKey,
      worktreeKey: manifest.checkout.worktreeKey,
      baseRevision,
    },
    paths: paths as string[],
    contracts: parseContracts(reservation.contracts, assignmentId),
    environments: parseEnvironments(reservation.environments, assignmentId),
  }
}

function eventWorldId(metadata: JsonRecord | null): string | null {
  return exactString(metadata?.worldId)
}

function isClaudeMutation(metadata: JsonRecord): boolean {
  const provider = exactString(metadata.provider)?.toLowerCase()
  const mode = exactString(metadata.mode)?.toLowerCase()
  return (provider === "claude" || provider === "cloud") && (mode === "agent" || mode === "delegate")
    && exactString(metadata.path ?? metadata.selectedPath) !== null
}

function parseClaudeAssignment(
  event: RepositoryAssignmentEventRow,
  metadata: JsonRecord,
  projectId: number,
): ScopedAssignmentReservationSet | ActiveRepositoryAssignmentLimitation {
  const eventId = exactString(event.entityId)
  const assignmentId = exactString(metadata.assignmentId) ?? eventId
  if (!assignmentId) malformed("<missing>")
  const assignmentWorldId = exactString(metadata.worldId)
  if (!assignmentWorldId) malformed(assignmentId)
  if (metadata.assignmentVersion !== "loom-claude-assignment.v1") {
    if (metadata.assignmentVersion !== undefined && metadata.assignmentVersion !== null) malformed(assignmentId)
    return {
      assignmentId,
      worldId: assignmentWorldId,
      projectId,
      code: "CLAUDE_EXACT_RESERVATION_UNAVAILABLE",
      detail: "active Claude mutation does not persist an exact resource id, worktree, and reservation set",
    }
  }
  const exactFields = [
    metadata.assignmentId,
    metadata.assignmentHash,
    metadata.repositoryResourceId,
    metadata.repositoryResourceKey,
    metadata.repositoryIdentity,
    metadata.repositoryMountKey,
    metadata.observedRevision,
    metadata.isolatedBaseSha,
    metadata.reservation,
    metadata.contextManifest,
  ]
  if (exactFields.some((value) => value === undefined || value === null)) malformed(assignmentId)

  const manifest = metadata.contextManifest as AssignmentContextManifest
  const reservation = record(metadata.reservation)
  const repositoryResourceId = exactInteger(metadata.repositoryResourceId)
  const repositoryKey = exactString(metadata.repositoryResourceKey)
  const repositoryIdentity = exactString(metadata.repositoryIdentity)
  const repositoryMountKey = exactString(metadata.repositoryMountKey)
  const baseRevision = exactString(metadata.observedRevision)
  const isolatedBaseSha = exactString(metadata.isolatedBaseSha)
  const workOrderId = exactInteger(metadata.workOrderId)
  const assignmentHash = exactString(metadata.assignmentHash)
  const selectedPath = exactString(metadata.path)
  const pathsValue = exactArray(reservation?.allowed)
  const paths = pathsValue?.map(exactString)
  if (metadata.assignmentVersion !== "loom-claude-assignment.v1"
    || !assignmentWorldId || !repositoryResourceId || !repositoryKey || !repositoryIdentity
    || !repositoryMountKey || !baseRevision || !isolatedBaseSha || baseRevision !== isolatedBaseSha
    || !workOrderId || !assignmentHash || !selectedPath || !paths || paths.some((path) => path === null)
    || !reservation || !exactString(reservation.version)
    || verifyAssignmentContextManifest(manifest).ok !== true
    || manifest.assignment.assignmentId !== assignmentId
    || manifest.assignment.worldId !== assignmentWorldId
    || manifest.project.id !== projectId
    || manifest.assignment.workOrderId !== workOrderId
    || manifest.assignment.assignmentHash !== assignmentHash
    || manifest.targetRepository.repositoryResourceId !== repositoryResourceId
    || manifest.targetRepository.repositoryKey !== repositoryKey
    || manifest.targetRepository.repositoryIdentity !== repositoryIdentity
    || manifest.checkout.repositoryMountKey !== repositoryMountKey
    || manifest.checkout.baseRevision !== baseRevision
    || manifest.mutationPosture.target.repositoryResourceId !== repositoryResourceId
    || manifest.mutationPosture.target.repositoryKey !== repositoryKey
    || manifest.mutationPosture.target.repositoryIdentity !== repositoryIdentity
    || !sameStrings(manifest.mutationPosture.target.writablePaths, paths as string[])
    || !manifest.mutationPosture.target.writablePaths.includes(selectedPath)) {
    malformed(assignmentId)
  }

  return {
    assignmentId,
    worldId: assignmentWorldId,
    projectId,
    repository: {
      repositoryResourceId,
      repositoryKey,
      repositoryIdentity,
      repositoryMountKey,
      worktreeKey: manifest.checkout.worktreeKey,
      baseRevision,
    },
    paths: paths as string[],
    contracts: parseContracts(reservation.contracts, assignmentId),
    environments: parseEnvironments(reservation.environments, assignmentId),
  }
}

function sortedEvents(events: readonly RepositoryAssignmentEventRow[]): RepositoryAssignmentEventRow[] {
  return [...events].sort((left, right) => left.id - right.id)
}

/**
 * Reduce the durable assignment and terminal facts for exactly one owner-owned Space. No authority
 * is inferred here: this is only the collision state that a route must check before it executes.
 */
export function projectActiveRepositoryAssignments(input: Readonly<{
  userId: string
  projectId: number
  events: readonly RepositoryAssignmentEventRow[]
}>): ActiveRepositoryAssignmentProjection {
  const active = new Map<string, ScopedAssignmentReservationSet>()
  const limitations = new Map<string, ActiveRepositoryAssignmentLimitation>()

  for (const event of sortedEvents(input.events)) {
    if (event.userId !== input.userId) continue
    const metadata = record(event.metadata)
    const worldId = eventWorldId(metadata)
    if (!worldId) continue
    const eventAssignmentId = exactString(event.entityId)
    if (!eventAssignmentId || !metadata) continue

    if (event.entityType === "loom_codex_assignment" && event.eventType === "EVIDENCE_RECORDED") {
      if (event.projectId !== input.projectId) continue
      const parsed = parseCodexAssignment(event, metadata, input.userId, input.projectId)
      const assignmentId = parsed.assignmentId
      if ("code" in parsed) {
        const priorLimitation = limitations.get(assignmentId)
        if (priorLimitation && priorLimitation.worldId !== parsed.worldId) {
          throw new ActiveRepositoryAssignmentError(
            "ASSIGNMENT_IDENTITY_REUSED",
            `assignment ${assignmentId} was reused by multiple Spaces`,
          )
        }
        active.delete(assignmentId)
        limitations.set(assignmentId, parsed)
      } else {
        const prior = active.get(assignmentId)
        if (prior && (prior.worldId !== parsed.worldId || !sameReservation(prior, parsed))) {
          throw new ActiveRepositoryAssignmentError(
            "ASSIGNMENT_IDENTITY_REUSED",
            `assignment ${assignmentId} was reused with changed repository reservation facts`,
          )
        }
        limitations.delete(assignmentId)
        active.set(assignmentId, parsed)
      }
      continue
    }

    if (event.entityType === "loom_codex_ready" && metadata.committed === true) {
      if (active.get(eventAssignmentId)?.worldId === worldId) active.delete(eventAssignmentId)
      if (limitations.get(eventAssignmentId)?.worldId === worldId) limitations.delete(eventAssignmentId)
      continue
    }

    if (event.entityType === "loom_agent" && event.eventType === "LOOP_STOPPED") {
      const assignmentId = exactString(metadata.assignmentId) ?? eventAssignmentId
      if (active.get(assignmentId)?.worldId === worldId) active.delete(assignmentId)
      if (limitations.get(assignmentId)?.worldId === worldId) limitations.delete(assignmentId)
      continue
    }

    if (event.entityType === "loom_agent" && event.eventType === "LOOP_STARTED" && isClaudeMutation(metadata)) {
      if (event.projectId !== input.projectId) continue
      const parsed = parseClaudeAssignment(event, metadata, input.projectId)
      const assignmentId = parsed.assignmentId
      if ("code" in parsed) {
        const priorLimitation = limitations.get(assignmentId)
        if (priorLimitation && priorLimitation.worldId !== parsed.worldId) {
          throw new ActiveRepositoryAssignmentError(
            "ASSIGNMENT_IDENTITY_REUSED",
            `assignment ${assignmentId} was reused by multiple Spaces`,
          )
        }
        active.delete(assignmentId)
        limitations.set(assignmentId, parsed)
      } else {
        const prior = active.get(assignmentId)
        if (prior && (prior.worldId !== parsed.worldId || !sameReservation(prior, parsed))) {
          throw new ActiveRepositoryAssignmentError(
            "ASSIGNMENT_IDENTITY_REUSED",
            `assignment ${assignmentId} was reused with changed repository reservation facts`,
          )
        }
        limitations.delete(assignmentId)
        active.set(assignmentId, parsed)
      }
    }
  }

  const assignmentsById = Object.freeze(Object.fromEntries([...active.entries()].sort(([left], [right]) => left.localeCompare(right))))
  const exactLimitations = Object.freeze([...limitations.values()].sort((left, right) => left.assignmentId.localeCompare(right.assignmentId)))
  return Object.freeze({
    status: exactLimitations.length === 0 ? "READY" as const : "LIMITED" as const,
    assignmentsById,
    limitations: exactLimitations,
  })
}

function canonicalReservation(value: AssignmentReservationSet): string {
  return JSON.stringify({
    assignmentId: value.assignmentId,
    repository: value.repository,
    paths: [...value.paths].sort(),
    contracts: [...value.contracts].sort((left, right) =>
      `${left.contractIdentity}\0${left.revisionIdentity}\0${left.role}`.localeCompare(
        `${right.contractIdentity}\0${right.revisionIdentity}\0${right.role}`,
      )),
    environments: [...value.environments].sort((left, right) =>
      `${left.environmentIdentity}\0${left.access}`.localeCompare(`${right.environmentIdentity}\0${right.access}`)),
  })
}

function sameScopedReservation(
  left: ScopedAssignmentReservationSet,
  right: Readonly<{ worldId: string; reservation: AssignmentReservationSet }>,
): boolean {
  return left.worldId === right.worldId && sameReservation(left, right.reservation)
}

function sameReservation(left: AssignmentReservationSet, right: AssignmentReservationSet): boolean {
  return canonicalReservation(left) === canonicalReservation(right)
}

async function loadEvents(userId: string, projectId: number): Promise<readonly RepositoryAssignmentEventRow[]> {
  const result = await pool.query(
    `SELECT event."id",event."userId",event."eventType",event."entityType",event."entityId",
        event."metadata",event."createdAt",
        COALESCE(
          NULLIF(event."metadata"::jsonb #>> '{contextManifest,project,id}', '')::integer,
          NULLIF(world."snapshot"::jsonb #>> '{spine,projectId}', '')::integer
        ) AS "projectId"
      FROM "governance_event" event
      LEFT JOIN "working_world" world
        ON world."userId"=event."userId"
        AND world."id"=event."metadata"::jsonb->>'worldId'
      WHERE event."userId"=$1
        AND (
          (
            (
              (event."entityType"='loom_codex_assignment' AND event."eventType"='EVIDENCE_RECORDED')
              OR (event."entityType"='loom_agent' AND event."eventType"='LOOP_STARTED')
            )
            AND COALESCE(
              NULLIF(event."metadata"::jsonb #>> '{contextManifest,project,id}', '')::integer,
              NULLIF(world."snapshot"::jsonb #>> '{spine,projectId}', '')::integer
            )=$2
          )
          OR (event."entityType"='loom_codex_ready')
          OR (event."entityType"='loom_agent' AND event."eventType"='LOOP_STOPPED')
        )
      ORDER BY event."id" ASC`,
    [userId, projectId],
  )
  return result.rows as RepositoryAssignmentEventRow[]
}

async function loadAuthority(
  userId: string,
  workOrderId: number,
  grantId: number,
): Promise<RepositoryAssignmentAuthorityRow | null> {
  const result = await pool.query(
    `SELECT work."id" AS "workOrderId",work."userId" AS "workOrderUserId",
        work."authorityGrantId",
        authority_row."id" AS "grantId",authority_row."userId" AS "grantUserId",
        authority_row."workOrderId" AS "grantWorkOrderId",authority_row."scope" AS "grantScope"
      FROM "work_order" work
      JOIN "authority_grant" authority_row
        ON authority_row."userId"=work."userId" AND authority_row."id"=work."authorityGrantId"
      WHERE work."userId"=$1 AND work."id"=$2 AND authority_row."id"=$3`,
    [userId, workOrderId, grantId],
  )
  return result.rows.length === 1 ? result.rows[0] as RepositoryAssignmentAuthorityRow : null
}

const productionClaimsDependencies: RepositoryAssignmentClaimsDependencies = { loadAuthority }

/**
 * Read the semantic and environment reservation dimensions from the linked, server-owned grant.
 * The browser cannot provide these claims. A versioned scope with explicit arrays (including
 * explicit empty arrays) is required so omission can never be mistaken for "no collision".
 */
export async function deriveRepositoryAssignmentReservationClaims(
  input: Readonly<{ userId: string; workOrderId: number; grantId: number }>,
  dependencies: RepositoryAssignmentClaimsDependencies = productionClaimsDependencies,
): Promise<RepositoryAssignmentReservationClaims> {
  const authority = await dependencies.loadAuthority(input.userId, input.workOrderId, input.grantId)
  if (!authority
    || authority.workOrderId !== input.workOrderId
    || authority.workOrderUserId !== input.userId
    || authority.authorityGrantId !== input.grantId
    || authority.grantId !== input.grantId
    || authority.grantUserId !== input.userId
    || authority.grantWorkOrderId !== input.workOrderId) {
    claimsUnavailable("the active Work Order and authority grant do not provide one exact reservation scope")
  }
  const scope = record(authority.grantScope)
  if (!scope
    || Object.keys(scope).sort().join("\0") !== "contracts\0environments\0version"
    || scope.version !== "williamos-repository-reservation-scope.v1") {
    claimsUnavailable("the active authority grant lacks a versioned repository reservation scope")
  }
  try {
    const contracts = parseContracts(scope.contracts, `work-order:${input.workOrderId}`)
    const environments = parseEnvironments(scope.environments, `work-order:${input.workOrderId}`)
    return Object.freeze({
      contracts: Object.freeze(contracts.map((claim) => Object.freeze(claim))),
      environments: Object.freeze(environments.map((claim) => Object.freeze(claim))),
    })
  } catch {
    claimsUnavailable("the active authority grant repository reservation scope is malformed")
  }
}

/**
 * Dependency-injectable fail-closed guard for spawn and promotion routes. A matching active
 * assignment id is revalidated in place; it never collides with itself during promotion.
 */
export async function assessActiveRepositoryAssignment(
  input: Readonly<{ userId: string; worldId: string; projectId: number; candidate: AssignmentReservationSet }>,
  dependencies: RepositoryAssignmentRuntimeDependencies = { loadEvents },
): Promise<ActiveRepositoryAssignmentAssessment> {
  // Validate the candidate even when there are no active assignments.
  assessRepositoryReservations([input.candidate])
  const projection = projectActiveRepositoryAssignments({
    userId: input.userId,
    projectId: input.projectId,
    events: await dependencies.loadEvents(input.userId, input.projectId),
  })
  const current = projection.assignmentsById[input.candidate.assignmentId]
  if (current && !sameScopedReservation(current, { worldId: input.worldId, reservation: input.candidate })) {
    throw new ActiveRepositoryAssignmentError(
      "ASSIGNMENT_IDENTITY_REUSED",
      `assignment ${input.candidate.assignmentId} was reused with changed repository reservation facts`,
    )
  }
  const activeAssignments = Object.values(projection.assignmentsById)
    .filter((assignment) => assignment.assignmentId !== input.candidate.assignmentId)
  if (projection.status === "LIMITED") {
    return Object.freeze({
      status: "LIMITED",
      activeAssignments: Object.freeze(activeAssignments),
      limitations: projection.limitations,
    })
  }
  const assessment = assessRepositoryReservations([...activeAssignments, input.candidate])
  if (assessment.status === "blocked") {
    return Object.freeze({
      status: "BLOCKED",
      activeAssignments: Object.freeze(activeAssignments),
      collisions: assessment.collisions,
      dependencies: assessment.dependencies,
    })
  }
  return Object.freeze({
    status: "COMPATIBLE",
    activeAssignments: Object.freeze(activeAssignments),
    dependencies: assessment.dependencies,
  })
}
