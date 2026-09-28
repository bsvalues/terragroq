import type {
  AssignmentContextManifest,
  AssignmentContextReferenceRepository,
  AssignmentContextRepository,
  AssignmentContextSource,
  RepositoryRole,
} from "@/lib/loom/assignment-context-manifest"

const DIGEST = /^[0-9a-f]{64}$/
const REVISION = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const REPOSITORY = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/
const ROLES = new Set<RepositoryRole>([
  "integrated-runtime",
  "sovereign-planning-and-promotion",
  "suite-source",
  "attached-source",
])
const MAX_MANIFEST_BYTES = 96_000

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length
    && Object.keys(value).every((key) => expected.includes(key))
}

function row(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, max = 500): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function canonicalPath(value: unknown, allowTree = false): value is string {
  if (!text(value, 2_000) || value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false
  const tree = value.endsWith("/**")
  if (tree && !allowTree) return false
  const body = tree ? value.slice(0, -3) : value
  return Boolean(body) && !body.includes("//") && !/[?\[\]]/.test(body)
    && body.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && !segment.includes("*"))
}

function repository(value: unknown): AssignmentContextRepository | null {
  const candidate = row(value)
  if (!candidate) return null
  const allowed = candidate.suite === undefined
    ? ["repositoryResourceId", "repositoryKey", "repositoryIdentity", "role"]
    : ["repositoryResourceId", "repositoryKey", "repositoryIdentity", "role", "suite"]
  if (!exactKeys(candidate, allowed)
    || !Number.isSafeInteger(candidate.repositoryResourceId) || Number(candidate.repositoryResourceId) <= 0
    || typeof candidate.repositoryKey !== "string" || !KEY.test(candidate.repositoryKey)
    || typeof candidate.repositoryIdentity !== "string" || !REPOSITORY.test(candidate.repositoryIdentity)
    || !ROLES.has(candidate.role as RepositoryRole)
    || candidate.role === "suite-source" && (typeof candidate.suite !== "string" || !KEY.test(candidate.suite))
    || candidate.role !== "suite-source" && candidate.suite !== undefined) return null
  return candidate as AssignmentContextRepository
}

function reference(value: unknown): AssignmentContextReferenceRepository | null {
  const candidate = row(value)
  if (!candidate || candidate.access !== "read-only" || typeof candidate.revisionIdentity !== "string"
    || !REVISION.test(candidate.revisionIdentity)) return null
  const { revisionIdentity, access, ...repositoryFields } = candidate
  const parsed = repository(repositoryFields)
  return parsed ? { ...parsed, revisionIdentity, access } as AssignmentContextReferenceRepository : null
}

function source(value: unknown): AssignmentContextSource | null {
  const candidate = row(value)
  if (!candidate || !exactKeys(candidate, [
    "kind", "repositoryResourceId", "repositoryKey", "repositoryIdentity",
    "revisionIdentity", "path", "blobHash",
  ]) || !["instruction", "project-knowledge", "cross-repository-contract"].includes(String(candidate.kind))
    || !Number.isSafeInteger(candidate.repositoryResourceId) || Number(candidate.repositoryResourceId) <= 0
    || typeof candidate.repositoryKey !== "string" || !KEY.test(candidate.repositoryKey)
    || typeof candidate.repositoryIdentity !== "string" || !REPOSITORY.test(candidate.repositoryIdentity)
    || typeof candidate.revisionIdentity !== "string" || !REVISION.test(candidate.revisionIdentity)
    || !canonicalPath(candidate.path) || typeof candidate.blobHash !== "string" || !DIGEST.test(candidate.blobHash)) return null
  return candidate as AssignmentContextSource
}

/**
 * Strictly parse server-recorded context for presentation in the browser. This is evidence only:
 * the browser does not turn the manifest into authority and never supplies it back to a writer.
 */
export function parseAssignmentContextManifestView(value: unknown): AssignmentContextManifest | null {
  let encoded: string
  try { encoded = JSON.stringify(value) } catch { return null }
  if (new TextEncoder().encode(encoded).byteLength > MAX_MANIFEST_BYTES) return null
  const manifest = row(value)
  const expectedManifestKeys = [
    "schemaVersion", "authorityEffect", "assignment", "project", "targetRepository",
    "checkout", "mutationPosture", "sources", "manifestHash",
  ]
  if (!manifest || !(exactKeys(manifest, expectedManifestKeys)
      || exactKeys(manifest, [...expectedManifestKeys, "workOrder"]))
    || manifest.schemaVersion !== "williamos-assignment-context-manifest.v1"
    || manifest.authorityEffect !== "none" || typeof manifest.manifestHash !== "string" || !DIGEST.test(manifest.manifestHash)) return null

  const assignment = row(manifest.assignment)
  const project = row(manifest.project)
  const checkout = row(manifest.checkout)
  const workOrder = manifest.workOrder === undefined ? null : row(manifest.workOrder)
  const posture = row(manifest.mutationPosture)
  const target = row(posture?.target)
  const targetRepository = repository(manifest.targetRepository)
  if (!assignment || !exactKeys(assignment, ["assignmentId", "worldId", "workOrderId", "assignmentHash", "createdAt"])
    || !text(assignment.assignmentId, 300) || !IDENTITY.test(assignment.assignmentId)
    || !text(assignment.worldId, 300) || !IDENTITY.test(assignment.worldId)
    || !Number.isSafeInteger(assignment.workOrderId) || Number(assignment.workOrderId) <= 0
    || typeof assignment.assignmentHash !== "string" || !DIGEST.test(assignment.assignmentHash)
    || typeof assignment.createdAt !== "string" || Number.isNaN(Date.parse(assignment.createdAt))
    || new Date(assignment.createdAt).toISOString() !== assignment.createdAt
    || !project || !exactKeys(project, ["id", "key", "name"])
    || !Number.isSafeInteger(project.id) || Number(project.id) <= 0
    || typeof project.key !== "string" || !KEY.test(project.key) || !text(project.name, 300)
    || workOrder && (!exactKeys(workOrder, ["id", "ref", "version", "status", "content", "contentHash"])
      || workOrder.id !== assignment.workOrderId
      || workOrder.ref !== null && !text(workOrder.ref, 300)
      || workOrder.status !== "active"
      || typeof workOrder.version !== "string" || Number.isNaN(Date.parse(workOrder.version))
      || new Date(workOrder.version).toISOString() !== workOrder.version
      || !text(workOrder.content, 96_000)
      || typeof workOrder.contentHash !== "string" || !DIGEST.test(workOrder.contentHash))
    || !checkout || !exactKeys(checkout, ["repositoryMountKey", "nodeIdentity", "worktreeKey", "baseRevision"])
    || !text(checkout.repositoryMountKey, 300) || !IDENTITY.test(checkout.repositoryMountKey)
    || !text(checkout.nodeIdentity, 300) || !IDENTITY.test(checkout.nodeIdentity)
    || !text(checkout.worktreeKey, 300) || !IDENTITY.test(checkout.worktreeKey)
    || typeof checkout.baseRevision !== "string" || !REVISION.test(checkout.baseRevision)
    || !targetRepository || !posture || !exactKeys(posture, ["target", "references"])
    || !target || !exactKeys(target, [
      "repositoryResourceId", "repositoryKey", "repositoryIdentity", "access", "writablePaths",
    ]) || target.access !== "write-under-assignment-reservation"
    || target.repositoryResourceId !== targetRepository.repositoryResourceId
    || target.repositoryKey !== targetRepository.repositoryKey
    || target.repositoryIdentity !== targetRepository.repositoryIdentity
    || !Array.isArray(target.writablePaths) || target.writablePaths.length === 0
    || target.writablePaths.some((path) => !canonicalPath(path, true))
    || !Array.isArray(posture.references) || !Array.isArray(manifest.sources) || manifest.sources.length === 0) return null

  const references = posture.references.map(reference)
  const sources = manifest.sources.map(source)
  if (references.some((entry) => !entry) || sources.some((entry) => !entry)) return null
  const allowedRepositories = new Map<number, Readonly<{ key: string; identity: string; revision: string }>>([[
    targetRepository.repositoryResourceId,
    { key: targetRepository.repositoryKey, identity: targetRepository.repositoryIdentity, revision: checkout.baseRevision as string },
  ]])
  for (const item of references as AssignmentContextReferenceRepository[]) {
    if (allowedRepositories.has(item.repositoryResourceId)) return null
    allowedRepositories.set(item.repositoryResourceId, {
      key: item.repositoryKey, identity: item.repositoryIdentity, revision: item.revisionIdentity,
    })
  }
  for (const item of sources as AssignmentContextSource[]) {
    const expected = allowedRepositories.get(item.repositoryResourceId)
    if (!expected || expected.key !== item.repositoryKey || expected.identity !== item.repositoryIdentity
      || expected.revision !== item.revisionIdentity) return null
  }
  if (!(sources as AssignmentContextSource[]).some((item) => item.kind === "instruction"
    && item.repositoryResourceId === targetRepository.repositoryResourceId)) return null
  return value as AssignmentContextManifest
}
