import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { pool } from "@/lib/db"
import { validateWorkingWorld, type WorkingWorldSnapshot } from "@/lib/environment/working-world"
import { authorityGrantFactsFromRow, grantCovers, isGrantActive } from "@/lib/governance/authority"
import { hashRecord } from "@/lib/governance/hash"
import { reservationCoversRequestedPath } from "@/lib/governance/work-context-gate"
import { providedAuthorityRank, requiredAuthorityRank } from "@/lib/goal/taxonomy"
import { looksBinary, resolveRealWorkspacePath, resolveWorkspacePath } from "@/lib/loom/workspace"

export const CODEX_ASSIGNMENT_VERSION = "loom-codex-assignment.v1" as const
const MAX_TARGET_BYTES = 2_000_000
const runFile = promisify(execFile)

export type CodexAssignmentRecord = Readonly<{
  world: WorkingWorldSnapshot
  outcome: Readonly<{
    id: number
    outcomeKey: string
    lifecycleState: string
    activeWorkOrderId: number | null
    version: number
  }>
  workOrder: Readonly<{
    id: number
    ref: string | null
    status: string
    authorityLevel: string
    authorityGrantId: number | null
    agent: string | null
    allowedFiles: readonly string[]
    forbiddenFiles: readonly string[]
    updatedAt: string
  }>
  grant: Readonly<{
    id: number
    ref: string | null
    userId: string
    workOrderId: number | null
    grantedTo: string
    status: string
    authorityLevel: string
    scope: string | null
    allowedActions: readonly string[]
    blockedActions: readonly string[]
    expiresAt: string | Date | null
    revokedAt: string | Date | null
    contentHash: string | null
    createdAt: string
  }>
}>

export type CodexAssignmentTarget = Readonly<{
  content: string
  modifiedAt: string
  digest: string
}>

export type CodexAssignment = Readonly<{
  owner: string
  worldId: string
  projectRoot: string
  outcomeKey: string
  workOrderId: number
  grantId: number
  selectedPath: string
  allowed: readonly string[]
  forbidden: readonly string[]
  binding: Readonly<{
    spaceRevision: number
    outcomeId: number
    outcomeVersion: number
    workOrderRef: string | null
    workOrderVersion: string
    grantRef: string | null
    grantVersion: string
    reservationVersion: string
  }>
  assignmentHash: string
  target: CodexAssignmentTarget
}>

export type CodexAssignmentDependencies = Readonly<{
  loadRecord: (userId: string, worldId: string) => Promise<CodexAssignmentRecord | null>
  inspectTarget: (projectRoot: string, selectedPath: string) => Promise<CodexAssignmentTarget>
}>

export class CodexAssignmentError extends Error {
  readonly code: "CODEX_ASSIGNMENT_REFUSED" | "CODEX_ASSIGNMENT_STALE"

  constructor(code: CodexAssignmentError["code"], message: string) {
    super(message)
    this.name = "CodexAssignmentError"
    this.code = code
  }
}

function refuse(detail: string): never {
  throw new CodexAssignmentError("CODEX_ASSIGNMENT_REFUSED", detail)
}

function normalizedReservation(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort()
}

function selectedSpacePath(world: WorkingWorldSnapshot): string {
  if (!world.space || world.space.activePaneId === null) refuse("the owned Space has no active source pane")
  const pane = world.space.panes.find((candidate) => candidate.id === world.space?.activePaneId)
  if (!pane?.filePath) refuse("the owned Space has no persisted selected file")
  return pane.filePath
}

function assignmentSnapshot(input: {
  owner: string
  worldId: string
  projectRoot: string
  selectedPath: string
  record: CodexAssignmentRecord
  allowed: readonly string[]
  forbidden: readonly string[]
}) {
  const { record } = input
  return {
    version: CODEX_ASSIGNMENT_VERSION,
    owner: input.owner,
    worldId: input.worldId,
    projectRoot: input.projectRoot,
    spaceRevision: record.world.space?.revision ?? null,
    selectedPath: input.selectedPath,
    outcome: record.outcome,
    workOrder: {
      id: record.workOrder.id,
      ref: record.workOrder.ref,
      status: record.workOrder.status,
      authorityLevel: record.workOrder.authorityLevel,
      authorityGrantId: record.workOrder.authorityGrantId,
      agent: record.workOrder.agent,
      updatedAt: record.workOrder.updatedAt,
    },
    grant: {
      id: record.grant.id,
      ref: record.grant.ref,
      userId: record.grant.userId,
      workOrderId: record.grant.workOrderId,
      grantedTo: record.grant.grantedTo,
      status: record.grant.status,
      authorityLevel: record.grant.authorityLevel,
      scope: record.grant.scope,
      expiresAt: record.grant.expiresAt instanceof Date
        ? record.grant.expiresAt.toISOString()
        : record.grant.expiresAt,
      revokedAt: record.grant.revokedAt instanceof Date
        ? record.grant.revokedAt.toISOString()
        : record.grant.revokedAt,
      contentHash: record.grant.contentHash,
      createdAt: record.grant.createdAt,
      allowedActions: normalizedReservation(record.grant.allowedActions),
      blockedActions: normalizedReservation(record.grant.blockedActions),
    },
    reservation: { allowed: input.allowed, forbidden: input.forbidden },
  }
}

async function assertNoPathLinks(root: string, absolute: string): Promise<void> {
  const relative = path.relative(path.resolve(root), absolute)
  let cursor = path.resolve(root)
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const entry = await fs.lstat(cursor)
    if (entry.isSymbolicLink()) refuse("the selected target traverses a symbolic link")
  }
}

export async function inspectCodexAssignmentTarget(
  projectRoot: string,
  selectedPath: string,
): Promise<CodexAssignmentTarget> {
  const lexical = resolveWorkspacePath(projectRoot, selectedPath)
  if (!lexical.ok || !lexical.absolute || lexical.relative !== selectedPath.replace(/\\/g, "/").replace(/^\.\//, "")) {
    refuse("the persisted selected path is not one canonical workspace-relative path")
  }
  let resolved
  try {
    resolved = await resolveRealWorkspacePath(projectRoot, selectedPath, fs.realpath)
    await assertNoPathLinks(projectRoot, lexical.absolute)
  } catch {
    refuse("the selected target is missing or traverses a link")
  }
  if (!resolved.ok || resolved.absolute !== lexical.absolute || resolved.relative !== lexical.relative) {
    refuse("the selected target does not resolve to its exact workspace path")
  }
  let current
  try {
    current = await fs.lstat(lexical.absolute)
  } catch {
    refuse("the selected target does not exist")
  }
  if (!current.isFile()) refuse("the selected target is not a regular file")
  if (current.nlink !== 1) refuse("the selected target is hard-linked")
  if (current.size > MAX_TARGET_BYTES) refuse("the selected target exceeds the V1 size limit")

  let tracked = ""
  try {
    const result = await runFile("git", ["-C", projectRoot, "ls-files", "--stage", "-z", "--", selectedPath], {
      encoding: "utf8",
      maxBuffer: 1_000_000,
      windowsHide: true,
    })
    tracked = result.stdout
  } catch {
    refuse("the selected target could not be verified against Git")
  }
  const entries = tracked.split("\0").filter(Boolean)
  const match = entries.length === 1 ? /^(100644|100755) [0-9a-f]+ 0\t([\s\S]+)$/.exec(entries[0]) : null
  if (!match || match[2].replace(/\\/g, "/") !== lexical.relative) {
    refuse("the selected target is not one tracked regular file")
  }

  const bytes = await fs.readFile(lexical.absolute)
  if (bytes.byteLength > MAX_TARGET_BYTES) refuse("the selected target exceeds the V1 size limit")
  if (looksBinary(bytes)) refuse("the selected target is binary")
  let content: string
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    refuse("the selected target is not valid UTF-8 text")
  }
  return {
    content,
    modifiedAt: current.mtime.toISOString(),
    digest: createHash("sha256").update(bytes).digest("hex"),
  }
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value ?? "")
}

function sameNormalizedReservation(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(normalizedReservation(left)) === JSON.stringify(normalizedReservation(right))
}

async function loadRecord(userId: string, worldId: string): Promise<CodexAssignmentRecord | null> {
  const result = await pool.query(
    `SELECT world."snapshot" AS "worldSnapshot",
      outcome."id" AS "outcomeId", outcome."outcomeKey", outcome."lifecycleState",
      outcome."activeWorkOrderId", outcome."version" AS "outcomeVersion",
      work."id" AS "workOrderId", work."ref" AS "workOrderRef", work."status" AS "workOrderStatus",
      work."authorityLevel" AS "workOrderAuthorityLevel", work."authorityGrantId",
      work."agent" AS "workOrderAgent", work."allowedFiles", work."forbiddenFiles",
      work."updatedAt" AS "workOrderUpdatedAt",
      authority_row."id" AS "grantId", authority_row."ref" AS "grantRef",
      authority_row."userId" AS "grantUserId", authority_row."workOrderId" AS "grantWorkOrderId",
      authority_row."grantedTo", authority_row."status" AS "grantStatus",
      authority_row."authorityLevel" AS "grantAuthorityLevel", authority_row."scope" AS "grantScope",
      authority_row."allowedActions", authority_row."blockedActions",
      authority_row."expiresAt", authority_row."revokedAt", authority_row."contentHash",
      authority_row."createdAt" AS "grantCreatedAt"
    FROM "working_world" world
    LEFT JOIN "outcome_queue_item" outcome
      ON outcome."userId" = world."userId"
      AND outcome."outcomeKey" = (world."snapshot"::jsonb #>> '{spine,outcomeKey}')
    LEFT JOIN "work_order" work
      ON work."userId" = world."userId" AND work."id" = outcome."activeWorkOrderId"
    LEFT JOIN "authority_grant" authority_row
      ON authority_row."userId" = world."userId" AND authority_row."id" = work."authorityGrantId"
    WHERE world."userId" = $1 AND world."id" = $2
    LIMIT 1`,
    [userId, worldId],
  )
  const row = result.rows[0] as Record<string, unknown> | undefined
  if (!row) return null
  if (!row.worldSnapshot || row.outcomeId == null || row.workOrderId == null || row.grantId == null) {
    refuse("the owned Space is not bound to one active outcome, work order, and grant")
  }
  const parsedWorld = typeof row.worldSnapshot === "string" ? JSON.parse(row.worldSnapshot) : row.worldSnapshot
  return {
    world: validateWorkingWorld(parsedWorld),
    outcome: {
      id: Number(row.outcomeId),
      outcomeKey: String(row.outcomeKey),
      lifecycleState: String(row.lifecycleState),
      activeWorkOrderId: row.activeWorkOrderId == null ? null : Number(row.activeWorkOrderId),
      version: Number(row.outcomeVersion),
    },
    workOrder: {
      id: Number(row.workOrderId),
      ref: row.workOrderRef == null ? null : String(row.workOrderRef),
      status: String(row.workOrderStatus),
      authorityLevel: String(row.workOrderAuthorityLevel),
      authorityGrantId: row.authorityGrantId == null ? null : Number(row.authorityGrantId),
      agent: row.workOrderAgent == null ? null : String(row.workOrderAgent),
      allowedFiles: Array.isArray(row.allowedFiles) ? row.allowedFiles as string[] : [],
      forbiddenFiles: Array.isArray(row.forbiddenFiles) ? row.forbiddenFiles as string[] : [],
      updatedAt: iso(row.workOrderUpdatedAt),
    },
    grant: {
      id: Number(row.grantId),
      ref: row.grantRef == null ? null : String(row.grantRef),
      userId: String(row.grantUserId),
      workOrderId: row.grantWorkOrderId == null ? null : Number(row.grantWorkOrderId),
      grantedTo: String(row.grantedTo),
      status: String(row.grantStatus),
      authorityLevel: String(row.grantAuthorityLevel),
      scope: row.grantScope == null ? null : String(row.grantScope),
      allowedActions: Array.isArray(row.allowedActions) ? row.allowedActions as string[] : [],
      blockedActions: Array.isArray(row.blockedActions) ? row.blockedActions as string[] : [],
      expiresAt: row.expiresAt as string | Date | null,
      revokedAt: row.revokedAt as string | Date | null,
      contentHash: row.contentHash == null ? null : String(row.contentHash),
      createdAt: iso(row.grantCreatedAt),
    },
  }
}

const productionDependencies: CodexAssignmentDependencies = {
  loadRecord,
  inspectTarget: inspectCodexAssignmentTarget,
}

async function deriveCodexAssignmentFromRootIdentity(
  input: Readonly<{
    userId: string
    worldId: string
    projectRoot: string
    targetProjectRoot: string
  }>,
  dependencies: CodexAssignmentDependencies = productionDependencies,
): Promise<CodexAssignment> {
  const record = await dependencies.loadRecord(input.userId, input.worldId)
  if (!record) refuse("the requested owned Space does not exist")
  const selectedPath = selectedSpacePath(record.world)
  if (record.world.spine.outcomeKey !== record.outcome.outcomeKey
    || record.world.spine.workOrderId !== record.outcome.activeWorkOrderId
    || record.outcome.activeWorkOrderId !== record.workOrder.id
    || record.outcome.lifecycleState !== "active"
    || record.workOrder.status !== "active") {
    refuse("the owned Space is not bound to the active outcome and work order")
  }
  const allowed = normalizedReservation(record.workOrder.allowedFiles)
  const forbidden = normalizedReservation(record.workOrder.forbiddenFiles)
  if (record.workOrder.authorityGrantId !== record.grant.id
    || record.grant.workOrderId !== record.workOrder.id
    || record.grant.userId !== input.userId
    || record.workOrder.agent?.toLowerCase() !== "codex"
    || record.grant.grantedTo.trim().toLowerCase() !== "codex") {
    refuse("the active grant is not the exact Codex implementation authority for this work order")
  }
  if (!sameNormalizedReservation(record.grant.allowedActions, allowed)
    || !sameNormalizedReservation(record.grant.blockedActions, forbidden)) {
    refuse("the active grant reservation does not match the active work order")
  }
  const grantFacts = authorityGrantFactsFromRow(record.grant as unknown as Record<string, unknown>)
  if (!isGrantActive(grantFacts).ok
    || providedAuthorityRank(record.workOrder.authorityLevel) < requiredAuthorityRank("A2_WRITE_OWN")
    || !grantCovers(grantFacts, "A2_WRITE_OWN").ok
    || !grantCovers(grantFacts, record.workOrder.authorityLevel as never).ok) {
    refuse("the active grant does not cover A2 implementation authority for the work order")
  }
  if (allowed.length === 0 || !reservationCoversRequestedPath(selectedPath, allowed).ok) {
    refuse("the selected file is outside the work order reservation")
  }
  if (forbidden.length > 0 && reservationCoversRequestedPath(selectedPath, forbidden).ok) {
    refuse("the selected file is inside the forbidden reservation")
  }
  const target = await dependencies.inspectTarget(input.targetProjectRoot, selectedPath)
  const assignmentHash = hashRecord(assignmentSnapshot({
    owner: input.userId,
    worldId: input.worldId,
    projectRoot: input.projectRoot,
    selectedPath,
    record,
    allowed,
    forbidden,
  }))
  const reservationVersion = hashRecord({ allowed, forbidden })
  return {
    owner: input.userId,
    worldId: input.worldId,
    projectRoot: input.projectRoot,
    outcomeKey: record.outcome.outcomeKey,
    workOrderId: record.workOrder.id,
    grantId: record.grant.id,
    selectedPath,
    allowed,
    forbidden,
    binding: {
      spaceRevision: record.world.space?.revision ?? 0,
      outcomeId: record.outcome.id,
      outcomeVersion: record.outcome.version,
      workOrderRef: record.workOrder.ref,
      workOrderVersion: record.workOrder.updatedAt,
      grantRef: record.grant.ref,
      grantVersion: record.grant.contentHash ?? record.grant.createdAt,
      reservationVersion,
    },
    assignmentHash,
    target,
  }
}

export async function deriveCodexAssignment(
  input: Readonly<{ userId: string; worldId: string; projectRoot: string }>,
  dependencies: CodexAssignmentDependencies = productionDependencies,
): Promise<CodexAssignment> {
  return deriveCodexAssignmentFromRootIdentity({
    ...input,
    targetProjectRoot: input.projectRoot,
  }, dependencies)
}

/**
 * Reconstruct the immutable assignment identity used before a configured checkout alias was
 * resolved to its physical root. The caller must first prove both roots through the authenticated
 * Project binding. Target inspection remains on that verified physical root, so this does not
 * relax the workspace link boundary or grant execution through the alias.
 */
export async function deriveCodexAssignmentForVerifiedRootAlias(
  input: Readonly<{
    userId: string
    worldId: string
    configuredProjectRoot: string
    verifiedProjectRoot: string
  }>,
  dependencies: CodexAssignmentDependencies = productionDependencies,
): Promise<CodexAssignment> {
  return deriveCodexAssignmentFromRootIdentity({
    userId: input.userId,
    worldId: input.worldId,
    projectRoot: input.configuredProjectRoot,
    targetProjectRoot: input.verifiedProjectRoot,
  }, dependencies)
}

export async function revalidateCodexAssignment(
  assignment: CodexAssignment,
  dependencies: CodexAssignmentDependencies = productionDependencies,
): Promise<void> {
  let current: CodexAssignment
  try {
    current = await deriveCodexAssignment({
      userId: assignment.owner,
      worldId: assignment.worldId,
      projectRoot: assignment.projectRoot,
    }, dependencies)
  } catch (error) {
    if (error instanceof CodexAssignmentError) {
      throw new CodexAssignmentError("CODEX_ASSIGNMENT_STALE", error.message)
    }
    throw error
  }
  if (current.assignmentHash !== assignment.assignmentHash
    || current.selectedPath !== assignment.selectedPath
    || current.target.digest !== assignment.target.digest
    || current.target.modifiedAt !== assignment.target.modifiedAt) {
    throw new CodexAssignmentError("CODEX_ASSIGNMENT_STALE", "the assignment authority or selected target changed")
  }
}
