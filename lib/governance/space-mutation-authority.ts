import { pool } from "@/lib/db"
import { validateWorkingWorld } from "@/lib/environment/working-world"
import { authorityGrantFactsFromRow, grantCovers, isGrantActive } from "@/lib/governance/authority"
import { reservationCoversRequestedPath } from "@/lib/governance/work-context-gate"
import { providedAuthorityRank, requiredAuthorityRank } from "@/lib/goal/taxonomy"

export type SpaceMutationAuthorityRecord = Readonly<{
  world: Readonly<{
    revision: number
    projectId: number | null
    outcomeKey: string | null
    workOrderId: number | null
    resources: readonly string[]
    selectedPath: string | null
  }>
  project: Readonly<{ id: number; key: string; repositoryIdentity: string }>
  outcome: Readonly<{ outcomeKey: string; lifecycleState: string; activeWorkOrderId: number | null }>
  workOrder: Readonly<{
    id: number
    status: string
    authorityLevel: string
    authorityGrantId: number | null
    agent: string | null
    allowed: readonly string[]
    forbidden: readonly string[]
  }>
  grant: Readonly<{
    id: number
    userId: string
    workOrderId: number | null
    grantedTo: string
    status: string
    authorityLevel: string
    allowed: readonly string[]
    blocked: readonly string[]
    expiresAt: string | Date | null
    revokedAt: string | Date | null
  }>
}>

export type SpaceMutationProjectBinding = Readonly<{
  projectId: number
  projectKey: string
  repositoryIdentity: string
  spaceIdentity: string
}>

export type SpaceMutationAuthority = Readonly<{
  owner: string
  worldId: string
  worldRevision: number
  projectId: number
  projectKey: string
  repositoryIdentity: string
  outcomeKey: string
  workOrderId: number
  grantId: number
  actor: string
  selectedPath?: string
  operation?: string
}>

export type SpaceMutationAuthorityDependencies = Readonly<{
  loadRecord: (userId: string, worldId: string) => Promise<SpaceMutationAuthorityRecord | null>
  now: () => Date
}>

export class SpaceMutationAuthorityError extends Error {
  readonly code = "SPACE_MUTATION_AUTHORITY_REFUSED"
  constructor(message: string) {
    super(message)
    this.name = "SpaceMutationAuthorityError"
  }
}

function refuse(detail: string): never {
  throw new SpaceMutationAuthorityError(detail)
}

function normalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort()
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right))
}

async function loadRecord(userId: string, worldId: string): Promise<SpaceMutationAuthorityRecord | null> {
  const result = await pool.query(
    `SELECT world."snapshot" AS "worldSnapshot",
      project_row."id" AS "projectId", project_row."key" AS "projectKey",
      project_resource."canonicalIdentity" AS "repositoryIdentity",
      outcome."outcomeKey", outcome."lifecycleState", outcome."activeWorkOrderId",
      work."id" AS "workOrderId", work."status" AS "workOrderStatus",
      work."authorityLevel" AS "workOrderAuthorityLevel", work."authorityGrantId",
      work."agent" AS "workOrderAgent", work."allowedFiles", work."forbiddenFiles",
      authority_row."id" AS "grantId", authority_row."userId" AS "grantUserId",
      authority_row."workOrderId" AS "grantWorkOrderId", authority_row."grantedTo",
      authority_row."status" AS "grantStatus", authority_row."authorityLevel" AS "grantAuthorityLevel",
      authority_row."allowedActions", authority_row."blockedActions",
      authority_row."expiresAt", authority_row."revokedAt"
    FROM "working_world" world
    LEFT JOIN "project" project_row
      ON project_row."userId" = world."userId"
      AND project_row."id" = (world."snapshot"::jsonb #>> '{spine,projectId}')::integer
    LEFT JOIN "project_resource" project_resource
      ON project_resource."userId" = project_row."userId"
      AND project_resource."projectId" = project_row."id"
      AND project_resource."type" = 'repo'
      AND project_resource."relationship" = 'primary-repo'
    LEFT JOIN "outcome_queue_item" outcome
      ON outcome."userId" = world."userId"
      AND outcome."outcomeKey" = (world."snapshot"::jsonb #>> '{spine,outcomeKey}')
    LEFT JOIN "work_order" work
      ON work."userId" = world."userId" AND work."id" = outcome."activeWorkOrderId"
    LEFT JOIN "authority_grant" authority_row
      ON authority_row."userId" = world."userId" AND authority_row."id" = work."authorityGrantId"
    WHERE world."userId" = $1 AND world."id" = $2`,
    [userId, worldId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (!row) return null
  if (result.rows.length !== 1 || row.projectId == null || row.repositoryIdentity == null
    || row.outcomeKey == null || row.workOrderId == null || row.grantId == null) {
    refuse("the owned Space is not bound to one Project, active outcome, Work Order, and grant")
  }
  let snapshot
  try {
    snapshot = validateWorkingWorld(typeof row.worldSnapshot === "string" ? JSON.parse(row.worldSnapshot) : row.worldSnapshot)
  } catch {
    refuse("the persisted Space snapshot is invalid")
  }
  const activePane = snapshot.space?.panes.find((pane) => pane.id === snapshot.space?.activePaneId) ?? null
  const selectedPath = snapshot.space?.selection?.filePath ?? activePane?.filePath ?? null
  return {
    world: {
      revision: snapshot.space?.revision ?? 0,
      projectId: snapshot.spine.projectId,
      outcomeKey: snapshot.spine.outcomeKey,
      workOrderId: snapshot.spine.workOrderId,
      resources: snapshot.resources,
      selectedPath,
    },
    project: { id: Number(row.projectId), key: String(row.projectKey), repositoryIdentity: String(row.repositoryIdentity) },
    outcome: {
      outcomeKey: String(row.outcomeKey), lifecycleState: String(row.lifecycleState),
      activeWorkOrderId: row.activeWorkOrderId == null ? null : Number(row.activeWorkOrderId),
    },
    workOrder: {
      id: Number(row.workOrderId), status: String(row.workOrderStatus),
      authorityLevel: String(row.workOrderAuthorityLevel),
      authorityGrantId: row.authorityGrantId == null ? null : Number(row.authorityGrantId),
      agent: row.workOrderAgent == null ? null : String(row.workOrderAgent),
      allowed: Array.isArray(row.allowedFiles) ? row.allowedFiles as string[] : [],
      forbidden: Array.isArray(row.forbiddenFiles) ? row.forbiddenFiles as string[] : [],
    },
    grant: {
      id: Number(row.grantId), userId: String(row.grantUserId),
      workOrderId: row.grantWorkOrderId == null ? null : Number(row.grantWorkOrderId),
      grantedTo: String(row.grantedTo), status: String(row.grantStatus),
      authorityLevel: String(row.grantAuthorityLevel),
      allowed: Array.isArray(row.allowedActions) ? row.allowedActions as string[] : [],
      blocked: Array.isArray(row.blockedActions) ? row.blockedActions as string[] : [],
      expiresAt: row.expiresAt as string | Date | null,
      revokedAt: row.revokedAt as string | Date | null,
    },
  }
}

const productionDependencies: SpaceMutationAuthorityDependencies = { loadRecord, now: () => new Date() }

export async function deriveSpaceMutationAuthority(
  input: Readonly<{
    userId: string
    worldId: string
    binding: SpaceMutationProjectBinding
    expected: Readonly<{ actor: string; capability: string }>
    target: Readonly<{ kind: "selected-file"; requestedPath?: string | null }> | Readonly<{ kind: "operation"; operation: string }>
  }>,
  dependencies: SpaceMutationAuthorityDependencies = productionDependencies,
): Promise<SpaceMutationAuthority> {
  if (!input.worldId || input.worldId !== input.worldId.trim() || input.worldId.length > 200
    || /[\u0000-\u001f\u007f]/.test(input.worldId)) refuse("one exact persisted Space is required")
  const record = await dependencies.loadRecord(input.userId, input.worldId)
  if (!record) refuse("the requested owned Space does not exist")
  const expectedResource = `williamos-workspace-root:v1:${input.binding.spaceIdentity}`
  if (record.world.projectId !== record.project.id || record.project.id !== input.binding.projectId
    || record.project.key !== input.binding.projectKey
    || record.project.repositoryIdentity !== input.binding.repositoryIdentity
    || !record.world.resources.includes(expectedResource)) {
    refuse("the Space is not bound to the verified Project and repository")
  }
  if (record.world.outcomeKey !== record.outcome.outcomeKey
    || record.world.workOrderId !== record.outcome.activeWorkOrderId
    || record.outcome.activeWorkOrderId !== record.workOrder.id
    || record.outcome.lifecycleState !== "active" || record.workOrder.status !== "active") {
    refuse("the Space is not bound to one active outcome and Work Order")
  }
  const actor = record.workOrder.agent?.trim().toLowerCase() ?? ""
  if (!actor || input.expected.actor.trim().toLowerCase() !== actor
    || record.workOrder.authorityGrantId !== record.grant.id
    || record.grant.workOrderId !== record.workOrder.id || record.grant.userId !== input.userId
    || record.grant.grantedTo.trim().toLowerCase() !== actor) {
    refuse("the Work Order and grant are not bound to the same exact actor")
  }
  const allowed = normalized(record.workOrder.allowed)
  const forbidden = normalized(record.workOrder.forbidden)
  if (!same(allowed, record.grant.allowed) || !same(forbidden, record.grant.blocked)) {
    refuse("the live grant reservation does not match the active Work Order")
  }
  const grantFacts = authorityGrantFactsFromRow({
    id: record.grant.id, ref: null, status: record.grant.status,
    authorityLevel: record.grant.authorityLevel, allowedActions: record.grant.allowed,
    blockedActions: record.grant.blocked, expiresAt: record.grant.expiresAt,
    revokedAt: record.grant.revokedAt, userId: record.grant.userId, grantedTo: record.grant.grantedTo,
  })
  if (!isGrantActive(grantFacts, dependencies.now()).ok
    || providedAuthorityRank(record.workOrder.authorityLevel) < requiredAuthorityRank("A2_WRITE_OWN")
    || !grantCovers(grantFacts, "A2_WRITE_OWN").ok
    || !grantCovers(grantFacts, record.workOrder.authorityLevel as never).ok) {
    refuse("the active grant does not cover mutation authority for the Work Order")
  }
  const base = {
    owner: input.userId, worldId: input.worldId, worldRevision: record.world.revision,
    projectId: record.project.id, projectKey: record.project.key,
    repositoryIdentity: record.project.repositoryIdentity, outcomeKey: record.outcome.outcomeKey,
    workOrderId: record.workOrder.id, grantId: record.grant.id, actor,
  }
  if (input.target.kind === "selected-file") {
    if (input.expected.capability !== "selected-file-change") {
      refuse("the requested capability does not match selected-file mutation authority")
    }
    const selectedPath = record.world.selectedPath
    if (!selectedPath || (input.target.requestedPath != null && selectedPath !== input.target.requestedPath)
      || allowed.length === 0 || !reservationCoversRequestedPath(selectedPath, allowed).ok
      || forbidden.some((reservation) => reservationCoversRequestedPath(selectedPath, [reservation]).ok)) {
      refuse("the requested path is not the exact persisted, permitted Space selection")
    }
    return { ...base, selectedPath }
  }
  const operation = input.target.operation
  if (input.expected.capability !== operation) {
    refuse("the requested capability does not match the reserved runtime operation")
  }
  const reservation = `operation:${operation}`
  if (!operation || allowed.length !== 1 || allowed[0] !== reservation || forbidden.length !== 0) {
    refuse("the runtime operation is not exactly and exclusively reserved")
  }
  return { ...base, operation }
}
