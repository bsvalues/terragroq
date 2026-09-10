import { createHash } from "node:crypto"

export const ASSIGNMENT_CONTEXT_MANIFEST_VERSION = "williamos-assignment-context-manifest.v1" as const

export type RepositoryRole =
  | "integrated-runtime"
  | "sovereign-planning-and-promotion"
  | "suite-source"
  | "attached-source"

export type AssignmentContextRepository = {
  repositoryResourceId: number
  repositoryKey: string
  repositoryIdentity: string
  role: RepositoryRole
  suite?: string
}

export type AssignmentContextReferenceRepository = AssignmentContextRepository & {
  revisionIdentity: string
  access: "read-only"
}

export type AssignmentContextSource = {
  kind: "instruction" | "project-knowledge" | "cross-repository-contract"
  repositoryResourceId: number
  repositoryKey: string
  repositoryIdentity: string
  revisionIdentity: string
  path: string
  blobHash: string
}

export type AssignmentContextWorkOrder = {
  id: number
  ref: string | null
  version: string
  status: "active"
  /** Canonical JSON for the exact persisted Work Order contract used at assignment time. */
  content: string
  contentHash: string
}

export type AssignmentContextManifestInput = {
  assignment: {
    assignmentId: string
    worldId: string
    workOrderId: number
    assignmentHash: string
    createdAt: string
  }
  project: {
    id: number
    key: string
    name: string
  }
  workOrder?: AssignmentContextWorkOrder
  targetRepository: AssignmentContextRepository
  checkout: {
    repositoryMountKey: string
    nodeIdentity: string
    worktreeKey: string
    baseRevision: string
  }
  mutationPosture: {
    writablePaths: string[]
    referenceRepositories: AssignmentContextReferenceRepository[]
  }
  sources: AssignmentContextSource[]
}

export type AssignmentContextManifest = Readonly<{
  schemaVersion: typeof ASSIGNMENT_CONTEXT_MANIFEST_VERSION
  authorityEffect: "none"
  assignment: Readonly<AssignmentContextManifestInput["assignment"]>
  project: Readonly<AssignmentContextManifestInput["project"]>
  workOrder?: Readonly<AssignmentContextWorkOrder>
  targetRepository: Readonly<AssignmentContextRepository>
  checkout: Readonly<AssignmentContextManifestInput["checkout"]>
  mutationPosture: Readonly<{
    target: Readonly<{
      repositoryResourceId: number
      repositoryKey: string
      repositoryIdentity: string
      access: "write-under-assignment-reservation"
      writablePaths: readonly string[]
    }>
    references: readonly Readonly<AssignmentContextReferenceRepository>[]
  }>
  sources: readonly Readonly<AssignmentContextSource>[]
  manifestHash: string
}>

export class AssignmentContextManifestError extends Error {
  readonly code:
    | "INVALID_ASSIGNMENT_IDENTITY"
    | "INVALID_PROJECT_IDENTITY"
    | "INVALID_REPOSITORY_IDENTITY"
    | "INVALID_REPOSITORY_ROLE"
    | "INVALID_CHECKOUT_IDENTITY"
    | "INVALID_MUTATION_POSTURE"
    | "INVALID_CONTEXT_SOURCE"
    | "UNKNOWN_CONTEXT_SOURCE_REPOSITORY"
    | "REQUIRED_CONTEXT_MISSING"

  constructor(code: AssignmentContextManifestError["code"], message: string) {
    super(message)
    this.name = "AssignmentContextManifestError"
    this.code = code
  }
}

const DIGEST = /^[0-9a-f]{64}$/
const REVISION = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/
const ROLES = new Set<RepositoryRole>([
  "integrated-runtime",
  "sovereign-planning-and-promotion",
  "suite-source",
  "attached-source",
])

function fail(code: AssignmentContextManifestError["code"], message: string): never {
  throw new AssignmentContextManifestError(code, message)
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function opaqueIdentity(value: unknown): string {
  const candidate = text(value)
  return IDENTITY.test(candidate) ? candidate : ""
}

function repository(input: AssignmentContextRepository, label: string): AssignmentContextRepository {
  const repositoryResourceId = input?.repositoryResourceId
  const repositoryKey = text(input?.repositoryKey)
  const repositoryIdentity = text(input?.repositoryIdentity)
  const role = input?.role
  const suite = input?.suite === undefined ? undefined : text(input.suite)
  if (!Number.isSafeInteger(repositoryResourceId) || repositoryResourceId <= 0
    || !KEY.test(repositoryKey) || !REPOSITORY.test(repositoryIdentity)) {
    fail("INVALID_REPOSITORY_IDENTITY", `${label} does not identify one repository resource`)
  }
  if (!ROLES.has(role)
    || (role === "suite-source" && (!suite || !KEY.test(suite)))
    || (role !== "suite-source" && suite !== undefined)) {
    fail("INVALID_REPOSITORY_ROLE", `${label} has an invalid repository role`)
  }
  return {
    repositoryResourceId,
    repositoryKey,
    repositoryIdentity,
    role,
    ...(suite ? { suite } : {}),
  }
}

function canonicalPath(value: unknown, allowTree: boolean): string {
  const candidate = text(value)
  const tree = candidate.endsWith("/**")
  const body = tree ? candidate.slice(0, -3) : candidate
  if (!candidate || (!allowTree && tree)
    || candidate.includes("\\") || candidate.startsWith("/") || /^[A-Za-z]:/.test(candidate)
    || candidate.includes("//") || body.endsWith("/")
    || body.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[*?\[\]]/.test(body)) {
    return ""
  }
  return candidate
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  const row = value as Record<string, unknown>
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(",")}}`
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex")
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  }
  return value
}

function normalizeInput(input: AssignmentContextManifestInput) {
  const assignmentId = opaqueIdentity(input.assignment?.assignmentId)
  const worldId = opaqueIdentity(input.assignment?.worldId)
  const workOrderId = input.assignment?.workOrderId
  const assignmentHash = text(input.assignment?.assignmentHash)
  const createdAt = text(input.assignment?.createdAt)
  if (!assignmentId || !worldId || !Number.isSafeInteger(workOrderId) || workOrderId <= 0
    || !DIGEST.test(assignmentHash)
    || Number.isNaN(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) {
    fail("INVALID_ASSIGNMENT_IDENTITY", "assignment context is incomplete or not immutable")
  }
  const projectId = input.project?.id
  const projectKey = text(input.project?.key)
  const projectName = text(input.project?.name)
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !KEY.test(projectKey) || !projectName) {
    fail("INVALID_PROJECT_IDENTITY", "assignment context does not identify one Project")
  }

  const workOrder = input.workOrder === undefined ? undefined : (() => {
    const id = input.workOrder?.id
    const ref = input.workOrder?.ref === null ? null : text(input.workOrder?.ref)
    const version = text(input.workOrder?.version)
    const content = typeof input.workOrder?.content === "string" ? input.workOrder.content : ""
    const contentHash = text(input.workOrder?.contentHash)
    if (!Number.isSafeInteger(id) || id !== workOrderId
      || input.workOrder?.ref !== null && !ref
      || input.workOrder?.status !== "active"
      || Number.isNaN(Date.parse(version)) || new Date(version).toISOString() !== version
      || !content || Buffer.byteLength(content, "utf8") > 96_000
      || !DIGEST.test(contentHash)
      || hash(content) !== contentHash) {
      fail("INVALID_ASSIGNMENT_IDENTITY", "assignment context Work Order content is missing or does not match the assignment")
    }
    return { id, ref, version, status: "active" as const, content, contentHash }
  })()

  const targetRepository = repository(input.targetRepository, "target repository")
  const repositoryMountKey = opaqueIdentity(input.checkout?.repositoryMountKey)
  const nodeIdentity = opaqueIdentity(input.checkout?.nodeIdentity)
  const worktreeKey = opaqueIdentity(input.checkout?.worktreeKey)
  const baseRevision = text(input.checkout?.baseRevision)
  if (!repositoryMountKey || !nodeIdentity || !worktreeKey || !REVISION.test(baseRevision)) {
    fail("INVALID_CHECKOUT_IDENTITY", "assignment context does not identify one verified mount, worktree, and base revision")
  }

  if (!Array.isArray(input.mutationPosture?.writablePaths) || input.mutationPosture.writablePaths.length === 0) {
    fail("INVALID_MUTATION_POSTURE", "assignment context has no exact writable path posture")
  }
  const writablePaths = [...new Set(input.mutationPosture.writablePaths.map((value) => canonicalPath(value, true)))]
  if (writablePaths.includes("")) fail("INVALID_MUTATION_POSTURE", "assignment context has a non-canonical writable path")
  writablePaths.sort()

  const references = input.mutationPosture.referenceRepositories.map((value) => {
    const normalized = repository(value, "reference repository")
    if (value.access !== "read-only" || !REVISION.test(text(value.revisionIdentity))) {
      fail("INVALID_MUTATION_POSTURE", "reference repository is not bound read-only to one revision")
    }
    if (normalized.repositoryResourceId === targetRepository.repositoryResourceId
      || normalized.repositoryKey === targetRepository.repositoryKey
      || normalized.repositoryIdentity === targetRepository.repositoryIdentity) {
      fail("INVALID_MUTATION_POSTURE", "target repository cannot also be declared as a read-only reference")
    }
    return { ...normalized, revisionIdentity: text(value.revisionIdentity), access: "read-only" as const }
  }).sort((left, right) => left.repositoryKey.localeCompare(right.repositoryKey))

  const resourceById = new Map<number, { repository: AssignmentContextRepository; revisionIdentity: string }>([
    [targetRepository.repositoryResourceId, { repository: targetRepository, revisionIdentity: baseRevision }],
  ])
  const identityToId = new Map<string, number>([[targetRepository.repositoryIdentity, targetRepository.repositoryResourceId]])
  const keyToId = new Map<string, number>([[targetRepository.repositoryKey, targetRepository.repositoryResourceId]])
  for (const reference of references) {
    if (resourceById.has(reference.repositoryResourceId)
      || identityToId.has(reference.repositoryIdentity)
      || keyToId.has(reference.repositoryKey)) {
      fail("INVALID_MUTATION_POSTURE", "reference repository identities are ambiguous")
    }
    resourceById.set(reference.repositoryResourceId, {
      repository: reference,
      revisionIdentity: reference.revisionIdentity,
    })
    identityToId.set(reference.repositoryIdentity, reference.repositoryResourceId)
    keyToId.set(reference.repositoryKey, reference.repositoryResourceId)
  }

  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    fail("REQUIRED_CONTEXT_MISSING", "assignment context has no loaded instruction sources")
  }
  const sourceBlobs = new Map<string, string>()
  const sources = input.sources.map((source) => {
    const declared = resourceById.get(source.repositoryResourceId)
    if (!declared) {
      fail(
        "UNKNOWN_CONTEXT_SOURCE_REPOSITORY",
        `context source ${source.repositoryResourceId} is not the target or a declared read-only reference`,
      )
    }
    const path = canonicalPath(source.path, false)
    const blobHash = text(source.blobHash)
    const revisionIdentity = text(source.revisionIdentity)
    if (source.repositoryKey !== declared.repository.repositoryKey
      || source.repositoryIdentity !== declared.repository.repositoryIdentity
      || revisionIdentity !== declared.revisionIdentity
      || !path || !DIGEST.test(blobHash)
      || !["instruction", "project-knowledge", "cross-repository-contract"].includes(source.kind)) {
      fail("INVALID_CONTEXT_SOURCE", `context source ${source.repositoryResourceId}:${text(source.path)} is not exact`)
    }
    const documentIdentity = `${source.repositoryResourceId}\0${revisionIdentity}\0${path}`
    const priorBlob = sourceBlobs.get(documentIdentity)
    if (priorBlob && priorBlob !== blobHash) {
      fail("INVALID_CONTEXT_SOURCE", `context source ${source.repositoryResourceId}:${path} has conflicting blob identities`)
    }
    sourceBlobs.set(documentIdentity, blobHash)
    return {
      kind: source.kind,
      repositoryResourceId: source.repositoryResourceId,
      repositoryKey: source.repositoryKey,
      repositoryIdentity: source.repositoryIdentity,
      revisionIdentity,
      path,
      blobHash,
    }
  })
  const distinctSources = [...new Map(sources.map((source) => [
    `${source.repositoryResourceId}\0${source.revisionIdentity}\0${source.path}\0${source.kind}\0${source.blobHash}`,
    source,
  ])).values()].sort((left, right) =>
    `${left.repositoryKey}\0${left.kind}\0${left.path}`.localeCompare(
      `${right.repositoryKey}\0${right.kind}\0${right.path}`,
    ))
  if (!distinctSources.some((source) => source.kind === "instruction"
    && source.repositoryResourceId === targetRepository.repositoryResourceId)) {
    fail("REQUIRED_CONTEXT_MISSING", "target repository instructions were not supplied to the assignment")
  }

  return {
    assignment: { assignmentId, worldId, workOrderId, assignmentHash, createdAt },
    project: { id: projectId, key: projectKey, name: projectName },
    ...(workOrder ? { workOrder } : {}),
    targetRepository,
    checkout: { repositoryMountKey, nodeIdentity, worktreeKey, baseRevision },
    mutationPosture: {
      target: {
        repositoryResourceId: targetRepository.repositoryResourceId,
        repositoryKey: targetRepository.repositoryKey,
        repositoryIdentity: targetRepository.repositoryIdentity,
        access: "write-under-assignment-reservation" as const,
        writablePaths,
      },
      references,
    },
    sources: distinctSources,
  }
}

export function createAssignmentContextManifest(
  input: AssignmentContextManifestInput,
): AssignmentContextManifest {
  const normalized = normalizeInput(input)
  const payload = {
    schemaVersion: ASSIGNMENT_CONTEXT_MANIFEST_VERSION,
    authorityEffect: "none" as const,
    ...normalized,
  }
  return deepFreeze({ ...payload, manifestHash: hash(payload) })
}

function payloadOf(manifest: AssignmentContextManifest): Omit<AssignmentContextManifest, "manifestHash"> {
  const { manifestHash, ...payload } = manifest
  void manifestHash
  return payload
}

export function canonicalAssignmentContextManifestBytes(manifest: AssignmentContextManifest): Buffer {
  return Buffer.from(canonical(payloadOf(manifest)), "utf8")
}

export function verifyAssignmentContextManifest(
  manifest: AssignmentContextManifest,
): Readonly<{ ok: true } | { ok: false; reason: "INVALID_MANIFEST" | "MANIFEST_HASH_MISMATCH" }> {
  if (!manifest || manifest.schemaVersion !== ASSIGNMENT_CONTEXT_MANIFEST_VERSION
    || manifest.authorityEffect !== "none" || !DIGEST.test(text(manifest.manifestHash))) {
    return { ok: false, reason: "INVALID_MANIFEST" }
  }
  try {
    const target = manifest.mutationPosture.target
    if (target.access !== "write-under-assignment-reservation"
      || target.repositoryResourceId !== manifest.targetRepository.repositoryResourceId
      || target.repositoryKey !== manifest.targetRepository.repositoryKey
      || target.repositoryIdentity !== manifest.targetRepository.repositoryIdentity) {
      return { ok: false, reason: "INVALID_MANIFEST" }
    }
    const recreated = createAssignmentContextManifest({
      assignment: { ...manifest.assignment },
      project: { ...manifest.project },
      ...(manifest.workOrder ? { workOrder: { ...manifest.workOrder } } : {}),
      targetRepository: { ...manifest.targetRepository },
      checkout: { ...manifest.checkout },
      mutationPosture: {
        writablePaths: [...target.writablePaths],
        referenceRepositories: manifest.mutationPosture.references.map((reference) => ({ ...reference })),
      },
      sources: manifest.sources.map((source) => ({ ...source })),
    })
    if (canonical(payloadOf(recreated)) !== canonical(payloadOf(manifest))) {
      return { ok: false, reason: "INVALID_MANIFEST" }
    }
  } catch {
    return { ok: false, reason: "INVALID_MANIFEST" }
  }
  return hash(payloadOf(manifest)) === manifest.manifestHash
    ? { ok: true }
    : { ok: false, reason: "MANIFEST_HASH_MISMATCH" }
}
