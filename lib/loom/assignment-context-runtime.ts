import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { pool } from "@/lib/db"
import type { CodexAssignment } from "@/lib/loom/codex-assignment"
import type { CodexIsolatedWorkspace } from "@/lib/loom/codex-isolated-workspace"
import {
  createAssignmentContextManifest,
  type AssignmentContextManifest,
  type AssignmentContextSource,
} from "@/lib/loom/assignment-context-manifest"
import { resolveWorkspaceRepositorySelection } from "@/lib/projects/core-seven-repositories"
import {
  normalizeRepositoryIdentity,
  type WorkspaceProjectBinding,
} from "@/lib/projects/workspace-project-binding"

const runFile = promisify(execFile)

export type AssignmentContextWorkOrderSnapshot = Readonly<{
  id: number
  ref: string | null
  version: string
  status: string
  content: string
  allowedFiles: readonly string[]
}>

export type AssignmentContextRepositoryInspection = Readonly<{
  repositoryIdentity: string
  revisionIdentity: string
}>

export type AssignmentContextRuntimeDependencies = Readonly<{
  nodeIdentity: () => string
  loadWorkOrder: (workOrderId: number) => Promise<AssignmentContextWorkOrderSnapshot | null>
  configuredRepositoryRoot: (environmentName: string) => string | null
  inspectRepository: (root: string) => Promise<AssignmentContextRepositoryInspection>
  readRepositoryBlob: (root: string, revisionIdentity: string, sourcePath: string) => Promise<Buffer | null>
}>

export class AssignmentContextRuntimeError extends Error {
  readonly code:
    | "ASSIGNMENT_CONTEXT_BINDING_INVALID"
    | "ASSIGNMENT_CONTEXT_BINDING_MISMATCH"
    | "ASSIGNMENT_CONTEXT_CHECKOUT_MISMATCH"
    | "ASSIGNMENT_CONTEXT_INSTRUCTIONS_MISSING"
    | "ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID"
    | "ASSIGNMENT_CONTEXT_WORK_ORDER_MISSING"
    | "ASSIGNMENT_CONTEXT_SOURCE_MISSING"
    | "ASSIGNMENT_CONTEXT_REFERENCE_INVALID"
    | "ASSIGNMENT_CONTEXT_NODE_INVALID"

  constructor(code: AssignmentContextRuntimeError["code"], message: string) {
    super(message)
    this.name = "AssignmentContextRuntimeError"
    this.code = code
  }
}

function fail(code: AssignmentContextRuntimeError["code"], message: string): never {
  throw new AssignmentContextRuntimeError(code, message)
}

function comparable(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function samePath(left: string, right: string): boolean {
  return comparable(left) === comparable(right)
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
}

function applicableInstructionPaths(selectedPath: string, fileName: "AGENTS.md" | "CLAUDE.md"): string[] {
  const normalized = selectedPath.replace(/\\/g, "/")
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail("ASSIGNMENT_CONTEXT_BINDING_MISMATCH", "the assignment selected path is not exact")
  }
  const segments = normalized.split("/").slice(0, -1)
  const paths: string[] = [fileName]
  let current = ""
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment
    paths.push(`${current}/${fileName}`)
  }
  return paths
}

async function instructionSources(input: Readonly<{
  isolatedRoot: string
  selectedPath: string
  repositoryResourceId: number
  repositoryKey: string
  repositoryIdentity: string
  revisionIdentity: string
}>): Promise<AssignmentContextSource[]> {
  let realRoot: string
  try {
    realRoot = await fs.realpath(input.isolatedRoot)
  } catch {
    fail("ASSIGNMENT_CONTEXT_CHECKOUT_MISMATCH", "the isolated assignment worktree is not readable")
  }

  const sources: AssignmentContextSource[] = []
  for (const relative of [
    ...applicableInstructionPaths(input.selectedPath, "AGENTS.md"),
    ...applicableInstructionPaths(input.selectedPath, "CLAUDE.md"),
  ]) {
    const candidate = path.resolve(input.isolatedRoot, ...relative.split("/"))
    if (!isWithin(path.resolve(input.isolatedRoot), candidate)) {
      fail("ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID", "an applicable instruction path escaped the isolated worktree")
    }
    let entry
    try {
      entry = await fs.lstat(candidate)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        if (relative === "AGENTS.md") {
          fail("ASSIGNMENT_CONTEXT_INSTRUCTIONS_MISSING", "the target repository has no root AGENTS.md")
        }
        continue
      }
      fail("ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID", `the instruction source ${relative} could not be inspected`)
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      fail("ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID", `the instruction source ${relative} is not one regular file`)
    }

    let realCandidate: string
    let bytes: Buffer
    try {
      ;[realCandidate, bytes] = await Promise.all([fs.realpath(candidate), fs.readFile(candidate)])
    } catch {
      fail("ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID", `the instruction source ${relative} could not be read exactly`)
    }
    if (!isWithin(realRoot, realCandidate)) {
      fail("ASSIGNMENT_CONTEXT_INSTRUCTION_INVALID", `the instruction source ${relative} escaped the isolated worktree`)
    }
    sources.push({
      kind: "instruction",
      repositoryResourceId: input.repositoryResourceId,
      repositoryKey: input.repositoryKey,
      repositoryIdentity: input.repositoryIdentity,
      revisionIdentity: input.revisionIdentity,
      path: relative,
      blobHash: createHash("sha256").update(bytes).digest("hex"),
    })
  }
  return sources
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value ?? "")
}

function exactStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : []
}

async function loadWorkOrder(workOrderId: number): Promise<AssignmentContextWorkOrderSnapshot | null> {
  const result = await pool.query(
    `SELECT "id","ref","title","description","goal","loop","scope","nonGoals",
      "allowedFiles","forbiddenFiles","validators","stopConditions","lane","phase","status",
      "priority","assignee","authorityLevel","authorityGranted","authorityGrantId","acceptanceCriteria","agent",
      "approvedBy","approvedAt","linkedDecisionId","commitAllowed","tagAllowed","pushAllowed",
      "supersedesId","supersededById","dueAt","updatedAt"
    FROM "work_order" WHERE "id"=$1 LIMIT 2`,
    [workOrderId],
  )
  if (result.rows.length !== 1) return null
  const row = result.rows[0] as Record<string, unknown>
  const content = JSON.stringify({
    id: Number(row.id),
    ref: row.ref == null ? null : String(row.ref),
    title: String(row.title ?? ""),
    description: row.description == null ? null : String(row.description),
    goal: row.goal == null ? null : String(row.goal),
    loop: row.loop == null ? null : String(row.loop),
    scope: row.scope == null ? null : String(row.scope),
    nonGoals: exactStringArray(row.nonGoals),
    allowedFiles: exactStringArray(row.allowedFiles),
    forbiddenFiles: exactStringArray(row.forbiddenFiles),
    validators: exactStringArray(row.validators),
    stopConditions: exactStringArray(row.stopConditions),
    lane: row.lane == null ? null : String(row.lane),
    phase: row.phase == null ? null : String(row.phase),
    status: String(row.status ?? ""),
    priority: String(row.priority ?? ""),
    assignee: row.assignee == null ? null : String(row.assignee),
    authorityLevel: String(row.authorityLevel ?? ""),
    authorityGranted: row.authorityGranted == null ? null : String(row.authorityGranted),
    authorityGrantId: row.authorityGrantId == null ? null : Number(row.authorityGrantId),
    acceptanceCriteria: exactStringArray(row.acceptanceCriteria),
    agent: row.agent == null ? null : String(row.agent),
    approvedBy: row.approvedBy == null ? null : String(row.approvedBy),
    approvedAt: row.approvedAt == null ? null : iso(row.approvedAt),
    linkedDecisionId: row.linkedDecisionId == null ? null : Number(row.linkedDecisionId),
    commitAllowed: row.commitAllowed === true,
    tagAllowed: row.tagAllowed === true,
    pushAllowed: row.pushAllowed === true,
    supersedesId: row.supersedesId == null ? null : Number(row.supersedesId),
    supersededById: row.supersededById == null ? null : Number(row.supersededById),
    dueAt: row.dueAt == null ? null : iso(row.dueAt),
  })
  return {
    id: Number(row.id),
    ref: row.ref == null ? null : String(row.ref),
    version: iso(row.updatedAt),
    status: String(row.status ?? ""),
    content,
    allowedFiles: exactStringArray(row.allowedFiles),
  }
}

async function inspectRepository(root: string): Promise<AssignmentContextRepositoryInspection> {
  const [remote, revision] = await Promise.all([
    runFile("git", ["-C", root, "config", "--get", "remote.origin.url"], { encoding: "utf8", windowsHide: true }),
    runFile("git", ["-C", root, "rev-parse", "--verify", "HEAD"], { encoding: "utf8", windowsHide: true }),
  ])
  const repositoryIdentity = normalizeRepositoryIdentity(remote.stdout.trim())
  if (!repositoryIdentity) throw new Error("repository remote is not one canonical GitHub identity")
  return { repositoryIdentity, revisionIdentity: revision.stdout.trim().toLowerCase() }
}

async function readRepositoryBlob(root: string, revisionIdentity: string, sourcePath: string): Promise<Buffer | null> {
  try {
    await runFile("git", ["-C", root, "cat-file", "-e", `${revisionIdentity}:${sourcePath}`], {
      encoding: "utf8", windowsHide: true,
    })
  } catch {
    return null
  }
  try {
    const result = await runFile("git", ["-C", root, "show", `${revisionIdentity}:${sourcePath}`], {
      encoding: "buffer", windowsHide: true, maxBuffer: 4_000_000,
    })
    return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout)
  } catch {
    fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required source ${sourcePath} could not be read at ${revisionIdentity}`)
  }
}

const productionDependencies: AssignmentContextRuntimeDependencies = {
  nodeIdentity: () => os.hostname(),
  loadWorkOrder,
  configuredRepositoryRoot: (environmentName) => process.env[environmentName]?.trim() || null,
  inspectRepository,
  readRepositoryBlob,
}

export type RepositoryAssignmentContextInput = Readonly<{
  assignmentId: string
  worldId: string
  workOrderId: number
  assignmentHash: string
  createdAt: string
  selectedPath: string
  writablePaths: readonly string[]
  projectId: number
  projectKey: string
  repositoryKey: string
  repositoryIdentity: string
  repositoryMountKey: string
  observedRevision: string
  spaceIdentity: string
  projectRoot: string
  targetDigest: string
}>

function reservationCoversPath(reservation: string, selectedPath: string): boolean {
  const normalized = reservation.replace(/\\/g, "/")
  return normalized === selectedPath
    || (normalized.endsWith("/**") && (
      selectedPath === normalized.slice(0, -3)
      || selectedPath.startsWith(`${normalized.slice(0, -3)}/`)
    ))
}

function reservationCoversReservation(allowed: string, requested: string): boolean {
  const normalizedAllowed = allowed.replace(/\\/g, "/")
  const normalizedRequested = requested.replace(/\\/g, "/")
  if (normalizedAllowed === normalizedRequested) return true
  if (!normalizedAllowed.endsWith("/**")) return false
  const prefix = normalizedAllowed.slice(0, -3)
  const requestedBase = normalizedRequested.endsWith("/**") ? normalizedRequested.slice(0, -3) : normalizedRequested
  return requestedBase === prefix || requestedBase.startsWith(`${prefix}/`)
}

async function targetSource(input: Readonly<{
  isolatedRoot: string
  relative: string
  required: boolean
  kind: AssignmentContextSource["kind"]
  repositoryResourceId: number
  repositoryKey: string
  repositoryIdentity: string
  revisionIdentity: string
}>): Promise<AssignmentContextSource | null> {
  const candidate = path.resolve(input.isolatedRoot, ...input.relative.split("/"))
  if (!isWithin(path.resolve(input.isolatedRoot), candidate)) {
    fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required source ${input.relative} escaped the isolated worktree`)
  }
  let entry
  try {
    entry = await fs.lstat(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !input.required) return null
    fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required source ${input.relative} is unavailable`)
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required source ${input.relative} is not one regular file`)
  }
  let realRoot: string
  let realCandidate: string
  let bytes: Buffer
  try {
    ;[realRoot, realCandidate, bytes] = await Promise.all([
      fs.realpath(input.isolatedRoot),
      fs.realpath(candidate),
      fs.readFile(candidate),
    ])
  } catch {
    fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required source ${input.relative} could not be read exactly`)
  }
  if (!isWithin(realRoot, realCandidate)) {
    fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required source ${input.relative} escaped the isolated worktree`)
  }
  return {
    kind: input.kind,
    repositoryResourceId: input.repositoryResourceId,
    repositoryKey: input.repositoryKey,
    repositoryIdentity: input.repositoryIdentity,
    revisionIdentity: input.revisionIdentity,
    path: input.relative,
    blobHash: createHash("sha256").update(bytes).digest("hex"),
  }
}

type ReferenceSourceSpec = Readonly<{ path: string; kind: AssignmentContextSource["kind"]; required: boolean }>

function referenceSpecs(repositoryKey: string, targetSuite: string | null): readonly ReferenceSourceSpec[] {
  if (repositoryKey === "os-1") {
    return [
      { path: "AGENTS.md", kind: "instruction", required: true },
      { path: "CLAUDE.md", kind: "instruction", required: false },
      { path: "docs/architecture/TERRAFUSION_SUITE_CONSTITUTION_v1.md", kind: "project-knowledge", required: true },
      { path: "docs/architecture/specs/terrafusion/04_SUITE_BOUNDARIES_WRITE_LANES_v3.1.md", kind: "project-knowledge", required: true },
      { path: "brain/packs/README.md", kind: "project-knowledge", required: true },
      ...(targetSuite ? [{
        path: `brain/packs/${targetSuite}/README.md`,
        kind: "project-knowledge" as const,
        required: true,
      }] : []),
    ]
  }
  if (repositoryKey === "sovereign-os") {
    return [
      { path: "AGENTS.md", kind: "instruction", required: true },
      { path: "CLAUDE.md", kind: "instruction", required: false },
      { path: "canon/SOVEREIGN_PLAN.md", kind: "project-knowledge", required: true },
      { path: "canon/EXECUTION_CONSTITUTION.md", kind: "project-knowledge", required: true },
      { path: "canon/BRAIN_AUTHORITY_BOUNDARY.md", kind: "project-knowledge", required: true },
    ]
  }
  return []
}

function requiredReferenceKeys(targetRepositoryKey: string): readonly string[] {
  if (targetRepositoryKey === "williamos") return []
  if (targetRepositoryKey === "os-1") return ["sovereign-os"]
  if (targetRepositoryKey === "sovereign-os") return ["os-1"]
  return ["os-1", "sovereign-os"]
}

async function requiredContext(input: Readonly<{
  assignment: RepositoryAssignmentContextInput
  projectBinding: WorkspaceProjectBinding
  isolatedWorkspace: CodexIsolatedWorkspace
  repositoryResourceId: number
}>, dependencies: AssignmentContextRuntimeDependencies) {
  const workOrder = await dependencies.loadWorkOrder(input.assignment.workOrderId).catch(() => null)
  if (!workOrder || workOrder.id !== input.assignment.workOrderId || workOrder.status !== "active"
    || !workOrder.version || Number.isNaN(Date.parse(workOrder.version))
    || input.assignment.writablePaths.some((requested) => !workOrder.allowedFiles.some((allowed) => (
      reservationCoversReservation(allowed, requested)
    )))) {
    fail("ASSIGNMENT_CONTEXT_WORK_ORDER_MISSING", "the exact active Work Order contract could not be proven")
  }

  const targetSources = await instructionSources({
    isolatedRoot: input.isolatedWorkspace.root,
    selectedPath: input.assignment.selectedPath,
    repositoryResourceId: input.repositoryResourceId,
    repositoryKey: input.projectBinding.repositoryKey,
    repositoryIdentity: input.projectBinding.repositoryIdentity,
    revisionIdentity: input.isolatedWorkspace.baseSha,
  })
  const targetCatalog = resolveWorkspaceRepositorySelection(
    input.projectBinding.projectKey,
    input.projectBinding.repositoryKey,
  )
  if (!targetCatalog.ok) fail("ASSIGNMENT_CONTEXT_BINDING_INVALID", "the target repository context is not catalogued")
  if (targetCatalog.repository.role === "suite-source") {
    const intakeRules = await targetSource({
      isolatedRoot: input.isolatedWorkspace.root,
      relative: "canon/INTAKE_RULES.md",
      required: true,
      kind: "instruction",
      repositoryResourceId: input.repositoryResourceId,
      repositoryKey: input.projectBinding.repositoryKey,
      repositoryIdentity: input.projectBinding.repositoryIdentity,
      revisionIdentity: input.isolatedWorkspace.baseSha,
    })
    const dependencyContract = await targetSource({
      isolatedRoot: input.isolatedWorkspace.root,
      relative: "canon/CONTRACT_DEPENDENCY.md",
      required: true,
      kind: "cross-repository-contract",
      repositoryResourceId: input.repositoryResourceId,
      repositoryKey: input.projectBinding.repositoryKey,
      repositoryIdentity: input.projectBinding.repositoryIdentity,
      revisionIdentity: input.isolatedWorkspace.baseSha,
    })
    targetSources.push(intakeRules!, dependencyContract!)
  } else if (targetCatalog.repository.key === "os-1") {
    targetSources.push((await targetSource({
      isolatedRoot: input.isolatedWorkspace.root,
      relative: "brain/packs/README.md",
      required: true,
      kind: "project-knowledge",
      repositoryResourceId: input.repositoryResourceId,
      repositoryKey: input.projectBinding.repositoryKey,
      repositoryIdentity: input.projectBinding.repositoryIdentity,
      revisionIdentity: input.isolatedWorkspace.baseSha,
    }))!)
  } else if (targetCatalog.repository.key === "sovereign-os") {
    for (const relative of [
      "canon/SOVEREIGN_PLAN.md",
      "canon/EXECUTION_CONSTITUTION.md",
      "canon/BRAIN_AUTHORITY_BOUNDARY.md",
    ]) {
      targetSources.push((await targetSource({
        isolatedRoot: input.isolatedWorkspace.root,
        relative,
        required: true,
        kind: "project-knowledge",
        repositoryResourceId: input.repositoryResourceId,
        repositoryKey: input.projectBinding.repositoryKey,
        repositoryIdentity: input.projectBinding.repositoryIdentity,
        revisionIdentity: input.isolatedWorkspace.baseSha,
      }))!)
    }
  }

  const references = [] as Array<Parameters<typeof createAssignmentContextManifest>[0]["mutationPosture"]["referenceRepositories"][number]>
  const sources = [...targetSources]
  const catalog = input.projectBinding.project.repositories ?? []
  const targetSuite = targetCatalog.repository.suite
  for (const repositoryKey of requiredReferenceKeys(input.projectBinding.repositoryKey)) {
    const definition = resolveWorkspaceRepositorySelection(input.projectBinding.projectKey, repositoryKey)
    const mounted = catalog.find((candidate) => candidate.key === repositoryKey)
    if (!definition.ok || !mounted || !mounted.repositoryResourceId || !mounted.mount.verified
      || !mounted.mount.revision || mounted.identity !== definition.repository.identity
      || mounted.role !== definition.repository.role || mounted.mount.key !== definition.repository.mountKey) {
      fail("ASSIGNMENT_CONTEXT_REFERENCE_INVALID", `required reference repository ${repositoryKey} has no verified mount identity`)
    }
    const root = dependencies.configuredRepositoryRoot(definition.repository.configuredRootEnvironment)
    if (!root) fail("ASSIGNMENT_CONTEXT_REFERENCE_INVALID", `required reference repository ${repositoryKey} has no configured checkout`)
    let inspected
    try {
      inspected = await dependencies.inspectRepository(root)
    } catch {
      fail("ASSIGNMENT_CONTEXT_REFERENCE_INVALID", `required reference repository ${repositoryKey} could not be inspected`)
    }
    if (normalizeRepositoryIdentity(inspected.repositoryIdentity) !== definition.repository.identity.toLowerCase()
      || inspected.revisionIdentity !== mounted.mount.revision) {
      fail("ASSIGNMENT_CONTEXT_REFERENCE_INVALID", `required reference repository ${repositoryKey} changed after Project binding`)
    }
    references.push({
      repositoryResourceId: mounted.repositoryResourceId,
      repositoryKey: mounted.key,
      repositoryIdentity: mounted.identity,
      role: mounted.role,
      ...(mounted.suite ? { suite: mounted.suite } : {}),
      revisionIdentity: mounted.mount.revision,
      access: "read-only",
    })
    for (const spec of referenceSpecs(repositoryKey, targetSuite)) {
      const bytes = await dependencies.readRepositoryBlob(root, mounted.mount.revision, spec.path)
      if (!bytes) {
        if (spec.required) fail("ASSIGNMENT_CONTEXT_SOURCE_MISSING", `required ${repositoryKey} source ${spec.path} is unavailable`)
        continue
      }
      sources.push({
        kind: spec.kind,
        repositoryResourceId: mounted.repositoryResourceId,
        repositoryKey: mounted.key,
        repositoryIdentity: mounted.identity,
        revisionIdentity: mounted.mount.revision,
        path: spec.path,
        blobHash: createHash("sha256").update(bytes).digest("hex"),
      })
    }
  }
  return {
    workOrder: {
      id: workOrder.id,
      ref: workOrder.ref,
      version: workOrder.version,
      status: "active" as const,
      content: workOrder.content,
      contentHash: createHash("sha256").update(JSON.stringify(workOrder.content), "utf8").digest("hex"),
    },
    referenceRepositories: references,
    sources,
  }
}

/**
 * Materialize provider-neutral context evidence for one already-authorized repository-writing
 * assignment. It validates the exact server binding and detached checkout; it never creates or
 * widens mutation authority.
 */
export async function createRepositoryAssignmentContextManifest(
  input: Readonly<{
    assignment: RepositoryAssignmentContextInput
    projectBinding: WorkspaceProjectBinding
    isolatedWorkspace: CodexIsolatedWorkspace
  }>,
  dependencies: AssignmentContextRuntimeDependencies = productionDependencies,
): Promise<AssignmentContextManifest> {
  const { assignment, projectBinding, isolatedWorkspace } = input
  const repositoryResourceId = projectBinding.repositoryResourceId
  const catalog = resolveWorkspaceRepositorySelection(projectBinding.projectKey, projectBinding.repositoryKey)

  if (typeof repositoryResourceId !== "number" || !Number.isSafeInteger(repositoryResourceId) || repositoryResourceId <= 0
    || !catalog.ok || !projectBinding.observedRevision
    || !projectBinding.repositoryMountKey || !projectBinding.repositoryIdentity) {
    fail("ASSIGNMENT_CONTEXT_BINDING_INVALID", "the verified Project binding has no exact repository resource and revision")
  }
  if (catalog.repository.identity !== projectBinding.repositoryIdentity
    || catalog.repository.role !== projectBinding.repositoryRole
    || catalog.repository.mountKey !== projectBinding.repositoryMountKey) {
    fail("ASSIGNMENT_CONTEXT_BINDING_INVALID", "the verified Project binding does not match the server repository catalog")
  }
  if (assignment.projectId !== projectBinding.projectId
    || assignment.projectKey !== projectBinding.projectKey
    || assignment.repositoryKey !== projectBinding.repositoryKey
    || assignment.repositoryIdentity !== projectBinding.repositoryIdentity
    || assignment.repositoryMountKey !== projectBinding.repositoryMountKey
    || assignment.observedRevision !== projectBinding.observedRevision
    || assignment.spaceIdentity !== projectBinding.project.identity
    || assignment.writablePaths.length === 0
    || !assignment.writablePaths.some((reservation) => reservationCoversPath(reservation, assignment.selectedPath))) {
    fail("ASSIGNMENT_CONTEXT_BINDING_MISMATCH", "the assignment is not bound to the exact selected repository object")
  }
  const assignmentRootMatches = samePath(assignment.projectRoot, projectBinding.workspaceRoot)
    || samePath(assignment.projectRoot, projectBinding.configuredWorkspaceRoot)
  if (!assignmentRootMatches
    || !samePath(isolatedWorkspace.projectRoot, projectBinding.workspaceRoot)
    || isolatedWorkspace.selectedPath !== assignment.selectedPath
    || isolatedWorkspace.baseSha !== projectBinding.observedRevision
    || isolatedWorkspace.initialContentDigest !== assignment.targetDigest
    || path.basename(isolatedWorkspace.root) === ""
    || !isWithin(path.resolve(isolatedWorkspace.runtimeRoot), path.resolve(isolatedWorkspace.root))) {
    fail("ASSIGNMENT_CONTEXT_CHECKOUT_MISMATCH", "the isolated worktree is not the exact assigned repository revision and path")
  }

  const nodeIdentity = dependencies.nodeIdentity().trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(nodeIdentity)) {
    fail("ASSIGNMENT_CONTEXT_NODE_INVALID", "the execution node identity is unavailable")
  }

  const context = await requiredContext({
    assignment, projectBinding, isolatedWorkspace, repositoryResourceId,
  }, dependencies)

  return createAssignmentContextManifest({
    assignment: {
      assignmentId: assignment.assignmentId,
      worldId: assignment.worldId,
      workOrderId: assignment.workOrderId,
      assignmentHash: assignment.assignmentHash,
      createdAt: assignment.createdAt,
    },
    project: {
      id: projectBinding.projectId,
      key: projectBinding.projectKey,
      name: projectBinding.projectName,
    },
    workOrder: context.workOrder,
    targetRepository: {
      repositoryResourceId,
      repositoryKey: projectBinding.repositoryKey,
      repositoryIdentity: projectBinding.repositoryIdentity,
      role: catalog.repository.role,
      ...(catalog.repository.suite ? { suite: catalog.repository.suite } : {}),
    },
    checkout: {
      repositoryMountKey: projectBinding.repositoryMountKey,
      nodeIdentity,
      worktreeKey: path.basename(isolatedWorkspace.root),
      baseRevision: isolatedWorkspace.baseSha,
    },
    mutationPosture: {
      writablePaths: [...assignment.writablePaths],
      referenceRepositories: context.referenceRepositories,
    },
    sources: context.sources,
  })
}

/**
 * Materialize context evidence for one already-authorized Codex assignment. This function only
 * observes the verified detached checkout and explicitly grants no authority of its own.
 */
export async function createCodexAssignmentContextManifest(
  input: Readonly<{
    assignment: CodexAssignment
    assignmentId: string
    assignmentCreatedAt: string
    projectBinding: WorkspaceProjectBinding
    isolatedWorkspace: CodexIsolatedWorkspace
  }>,
  dependencies: AssignmentContextRuntimeDependencies = productionDependencies,
): Promise<AssignmentContextManifest> {
  const { assignment, projectBinding, isolatedWorkspace } = input
  const selectedFileRef = assignment.selectedFileRef
  if (!selectedFileRef
    || assignment.binding.projectId !== projectBinding.projectId
    || assignment.binding.projectKey !== projectBinding.projectKey
    || assignment.binding.repositoryResourceKey !== projectBinding.repositoryKey
    || assignment.binding.repositoryIdentity !== projectBinding.repositoryIdentity
    || assignment.binding.repositoryMountKey !== projectBinding.repositoryMountKey
    || assignment.binding.observedRevision !== projectBinding.observedRevision
    || assignment.binding.spaceIdentity !== projectBinding.project.identity
    || selectedFileRef.projectIdentity !== projectBinding.project.identity
    || selectedFileRef.repositoryResourceKey !== projectBinding.repositoryKey
    || selectedFileRef.repositoryMountKey !== projectBinding.repositoryMountKey
    || selectedFileRef.worktreeKey !== null
    || selectedFileRef.observedRevision !== projectBinding.observedRevision
    || selectedFileRef.path !== assignment.selectedPath) {
    fail("ASSIGNMENT_CONTEXT_BINDING_MISMATCH", "the Codex assignment is not bound to the exact selected repository object")
  }

  return createRepositoryAssignmentContextManifest({
    assignment: {
      assignmentId: input.assignmentId,
      worldId: assignment.worldId,
      workOrderId: assignment.workOrderId,
      assignmentHash: assignment.assignmentHash,
      createdAt: input.assignmentCreatedAt,
      selectedPath: assignment.selectedPath,
      writablePaths: assignment.allowed,
      projectId: assignment.binding.projectId,
      projectKey: assignment.binding.projectKey,
      repositoryKey: assignment.binding.repositoryResourceKey!,
      repositoryIdentity: assignment.binding.repositoryIdentity!,
      repositoryMountKey: assignment.binding.repositoryMountKey!,
      observedRevision: assignment.binding.observedRevision!,
      spaceIdentity: assignment.binding.spaceIdentity,
      projectRoot: assignment.projectRoot,
      targetDigest: assignment.target.digest,
    },
    projectBinding,
    isolatedWorkspace,
  }, dependencies)
}
