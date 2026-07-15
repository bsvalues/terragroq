import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"

const INPUT_FIELDS = new Set(["schemaVersion", "artifactType", "planId", "workspaceRoot", "lanes"])
const LANE_FIELDS = new Set([
  "laneId", "workOrderId", "repository", "repositoryRoot", "workspacePath", "branch",
  "baseRef", "baseCommitSha", "lifecycleState", "reservedPaths", "observedWorkspace",
  "reservationSetId", "leaseId", "leaseFence", "evidenceEventId",
])
const OBSERVED_FIELDS = new Set([
  "repository", "repositoryRoot", "workspacePath", "branch", "baseRef", "baseCommitSha",
  "headCommitSha", "ownerLaneId", "ownerWorkOrderId", "trackedChanges", "untrackedChanges",
  "ignoredChanges", "worktreeLaneIds", "branchLaneIds",
])
const TERMINAL_STATES = new Set(["COMPLETE", "VERIFIED", "FAILED_TERMINAL", "QUARANTINED_TERMINAL"])
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const IDENTIFIER = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const BRANCH = /^[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/
const BASE_REF = /^refs\/(?:heads|tags)\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/
const AUTHORITY_FIELDS = new Set([
  "authorityGranted", "executionAuthorized", "dispatchAuthorized", "mutationAuthorized",
  "cleanupAuthorized", "gitCommandPerformed", "filesystemMutationPerformed", "executionPerformed",
])
const OWNERSHIP_FIELDS = new Set([
  "laneId", "workOrderId", "repository", "repositoryRoot", "workspacePath", "branch",
  "baseRef", "baseCommitSha", "reservationSetId", "leaseId", "leaseFence",
  "evidenceEventId", "headCommitSha",
])

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export class IsolatedWorkspaceManagerError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "IsolatedWorkspaceManagerError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new IsolatedWorkspaceManagerError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertExactFields(value, expected, field) {
  if (!plainObject(value)) wall("ISOLATED_WORKSPACE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !expected.has(key)).sort(lexicalCompare)
  if (unknown.length > 0) wall("ISOLATED_WORKSPACE_UNKNOWN_FIELD_WALL", `${field}.${unknown[0]}`)
  const missing = [...expected].filter((key) => !Object.hasOwn(value, key)).sort(lexicalCompare)
  if (missing.length > 0) wall("ISOLATED_WORKSPACE_MISSING_FIELD_WALL", `${field}.${missing[0]}`)
}

function stringValue(value, field, pattern = undefined) {
  if (typeof value !== "string" || value.length === 0) {
    wall("ISOLATED_WORKSPACE_TYPE_WALL", field, "NON_EMPTY_STRING_REQUIRED")
  }
  if (value.trim() !== value) wall("ISOLATED_WORKSPACE_NORMALIZATION_WALL", field, "SURROUNDING_WHITESPACE")
  if (CONTROL_CHARACTER.test(value) || (pattern && !pattern.test(value))) {
    wall("ISOLATED_WORKSPACE_FORMAT_WALL", field)
  }
  return value
}

function safeRef(value, field, pattern) {
  stringValue(value, field, pattern)
  if (value.includes("..") || value.includes("//") || value.includes("@{")
    || value.split("/").some((segment) => segment.startsWith(".") || segment.endsWith(".") || segment.endsWith(".lock"))) {
    wall("ISOLATED_WORKSPACE_FORMAT_WALL", field, "SAFE_GIT_REF_REQUIRED")
  }
  if (field.endsWith(".branch") && (value === "HEAD" || value.startsWith("refs/"))) {
    wall("ISOLATED_WORKSPACE_FORMAT_WALL", field, "SAFE_GIT_BRANCH_REQUIRED")
  }
  return value
}

function pathApi(value) {
  return /^[A-Za-z]:[\\/]/.test(value) || value.includes("\\") ? path.win32 : path.posix
}

function absolutePath(value, field) {
  stringValue(value, field)
  if (!pathApi(value).isAbsolute(value)) wall("ISOLATED_WORKSPACE_PATH_WALL", field, "ABSOLUTE_PATH_REQUIRED")
  return value
}

function pathKey(value) {
  const api = pathApi(value)
  const normalized = api.resolve(value).replaceAll("\\", "/").replace(/\/$/, "")
  return api === path.win32 ? normalized.toLowerCase() : normalized
}

function normalizedPath(value) {
  return pathKey(value)
}

function samePath(left, right) {
  return pathKey(left) === pathKey(right)
}

function assertInsideWorkspaceRoot(root, candidate, field) {
  const rootKey = pathKey(root)
  const candidateKey = pathKey(candidate)
  if (pathApi(root) !== pathApi(candidate) || candidateKey === rootKey || !candidateKey.startsWith(`${rootKey}/`)) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", field, "OUTSIDE_WORKSPACE_ROOT")
  }
}

function safeRelativePath(value, field) {
  stringValue(value, field)
  const segments = value.split("/")
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z]:/.test(value)
    || segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", field, "SAFE_RELATIVE_POSIX_PATH_REQUIRED")
  }
  return value.toLowerCase()
}

function uniqueStrings(value, field, normalizer) {
  if (!Array.isArray(value)) wall("ISOLATED_WORKSPACE_TYPE_WALL", field, "ARRAY_REQUIRED")
  const result = value.map((entry, index) => normalizer(entry, `${field}[${index}]`)).sort(lexicalCompare)
  if (new Set(result).size !== result.length) wall("ISOLATED_WORKSPACE_DUPLICATE_WALL", field)
  return result
}

function normalizeObserved(value, laneIndex) {
  const field = `lanes[${laneIndex}].observedWorkspace`
  if (value === null) return null
  assertExactFields(value, OBSERVED_FIELDS, field)
  return {
    repository: stringValue(value.repository, `${field}.repository`, REPOSITORY),
    repositoryRoot: absolutePath(value.repositoryRoot, `${field}.repositoryRoot`),
    workspacePath: absolutePath(value.workspacePath, `${field}.workspacePath`),
    branch: safeRef(value.branch, `${field}.branch`, BRANCH),
    baseRef: safeRef(value.baseRef, `${field}.baseRef`, BASE_REF),
    baseCommitSha: stringValue(value.baseCommitSha, `${field}.baseCommitSha`, COMMIT_SHA),
    headCommitSha: stringValue(value.headCommitSha, `${field}.headCommitSha`, COMMIT_SHA),
    ownerLaneId: stringValue(value.ownerLaneId, `${field}.ownerLaneId`, IDENTIFIER),
    ownerWorkOrderId: stringValue(value.ownerWorkOrderId, `${field}.ownerWorkOrderId`, WORK_ORDER_ID),
    trackedChanges: uniqueStrings(value.trackedChanges, `${field}.trackedChanges`, safeRelativePath),
    untrackedChanges: uniqueStrings(value.untrackedChanges, `${field}.untrackedChanges`, safeRelativePath),
    ignoredChanges: uniqueStrings(value.ignoredChanges, `${field}.ignoredChanges`, safeRelativePath),
    worktreeLaneIds: uniqueStrings(value.worktreeLaneIds, `${field}.worktreeLaneIds`, (entry, itemField) => stringValue(entry, itemField, IDENTIFIER)),
    branchLaneIds: uniqueStrings(value.branchLaneIds, `${field}.branchLaneIds`, (entry, itemField) => stringValue(entry, itemField, IDENTIFIER)),
  }
}

function normalizeLane(value, laneIndex, workspaceRoot) {
  const field = `lanes[${laneIndex}]`
  assertExactFields(value, LANE_FIELDS, field)
  const lane = {
    inputIndex: laneIndex,
    laneId: stringValue(value.laneId, `${field}.laneId`, IDENTIFIER),
    workOrderId: stringValue(value.workOrderId, `${field}.workOrderId`, WORK_ORDER_ID),
    repository: stringValue(value.repository, `${field}.repository`, REPOSITORY),
    repositoryRoot: absolutePath(value.repositoryRoot, `${field}.repositoryRoot`),
    workspacePath: absolutePath(value.workspacePath, `${field}.workspacePath`),
    branch: safeRef(value.branch, `${field}.branch`, BRANCH),
    baseRef: safeRef(value.baseRef, `${field}.baseRef`, BASE_REF),
    baseCommitSha: stringValue(value.baseCommitSha, `${field}.baseCommitSha`, COMMIT_SHA),
    lifecycleState: stringValue(value.lifecycleState, `${field}.lifecycleState`, /^[A-Z][A-Z0-9_]*$/),
    reservationSetId: stringValue(value.reservationSetId, `${field}.reservationSetId`, IDENTIFIER),
    leaseId: stringValue(value.leaseId, `${field}.leaseId`, IDENTIFIER),
    leaseFence: Number.isSafeInteger(value.leaseFence) && value.leaseFence > 0
      ? value.leaseFence
      : wall("ISOLATED_WORKSPACE_TYPE_WALL", `${field}.leaseFence`, "POSITIVE_SAFE_INTEGER_REQUIRED"),
    evidenceEventId: stringValue(value.evidenceEventId, `${field}.evidenceEventId`, IDENTIFIER),
    reservedPaths: uniqueStrings(value.reservedPaths, `${field}.reservedPaths`, safeRelativePath),
    observedWorkspace: normalizeObserved(value.observedWorkspace, laneIndex),
  }
  if (lane.reservedPaths.length === 0) wall("ISOLATED_WORKSPACE_TYPE_WALL", `${field}.reservedPaths`, "NON_EMPTY_ARRAY_REQUIRED")
  assertInsideWorkspaceRoot(workspaceRoot, lane.workspacePath, `${field}.workspacePath`)
  lane.repositoryRoot = normalizedPath(lane.repositoryRoot)
  lane.workspacePath = normalizedPath(lane.workspacePath)
  return lane
}

function assertExclusiveLaneIdentities(lanes) {
  const laneIds = new Set()
  const workOrderIds = new Set()
  const workspacePaths = new Set()
  const branches = new Set()
  for (const lane of lanes) {
    if (laneIds.has(lane.laneId)) wall("ISOLATED_WORKSPACE_DUPLICATE_LANE_WALL", "lanes")
    if (workOrderIds.has(lane.workOrderId)) wall("ISOLATED_WORKSPACE_DUPLICATE_WORK_ORDER_WALL", "lanes")
    const workspacePath = pathKey(lane.workspacePath)
    if ([...workspacePaths].some((other) => workspacePath === other
      || workspacePath.startsWith(`${other}/`) || other.startsWith(`${workspacePath}/`))) {
      wall("ISOLATED_WORKSPACE_SHARED_PATH_WALL", "lanes")
    }
    const branchKey = lane.branch.toLowerCase()
    if ([...branches].some((other) => branchKey === other
      || branchKey.startsWith(`${other}/`) || other.startsWith(`${branchKey}/`))) {
      wall("ISOLATED_WORKSPACE_SHARED_BRANCH_WALL", "lanes")
    }
    laneIds.add(lane.laneId)
    workOrderIds.add(lane.workOrderId)
    workspacePaths.add(workspacePath)
    branches.add(branchKey)
  }
  for (let leftIndex = 0; leftIndex < lanes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < lanes.length; rightIndex += 1) {
      if (lanes[leftIndex].reservedPaths.some((reservation) =>
        lanes[rightIndex].reservedPaths.some((candidate) => reservation === candidate
          || reservation.startsWith(`${candidate}/`) || candidate.startsWith(`${reservation}/`)))) {
        wall("ISOLATED_WORKSPACE_RESERVATION_WALL", "lanes")
      }
    }
  }
}

function assertExactObservedIdentity(lane) {
  const observed = lane.observedWorkspace
  const field = `lanes[${lane.inputIndex}].observedWorkspace`
  const checks = [
    ["repository", "ISOLATED_WORKSPACE_FOREIGN_REPOSITORY_WALL"],
    ["repositoryRoot", "ISOLATED_WORKSPACE_FOREIGN_REPOSITORY_WALL"],
    ["workspacePath", "ISOLATED_WORKSPACE_FOREIGN_WORKSPACE_WALL"],
    ["branch", "ISOLATED_WORKSPACE_FOREIGN_BRANCH_WALL"],
    ["baseRef", "ISOLATED_WORKSPACE_FOREIGN_BASE_WALL"],
    ["baseCommitSha", "ISOLATED_WORKSPACE_FOREIGN_BASE_WALL"],
  ]
  for (const [key, code] of checks) {
    const matches = key.endsWith("Path") || key.endsWith("Root") ? samePath(observed[key], lane[key]) : observed[key] === lane[key]
    if (!matches) wall(code, `${field}.${key}`)
  }
  if (observed.ownerLaneId !== lane.laneId) wall("ISOLATED_WORKSPACE_FOREIGN_OWNER_WALL", `${field}.ownerLaneId`)
  if (observed.ownerWorkOrderId !== lane.workOrderId) wall("ISOLATED_WORKSPACE_FOREIGN_OWNER_WALL", `${field}.ownerWorkOrderId`)
  if (observed.worktreeLaneIds.length !== 1 || observed.worktreeLaneIds[0] !== lane.laneId) {
    wall("ISOLATED_WORKSPACE_SHARED_WORKTREE_WALL", `${field}.worktreeLaneIds`)
  }
  if (observed.branchLaneIds.length !== 1 || observed.branchLaneIds[0] !== lane.laneId) {
    wall("ISOLATED_WORKSPACE_SHARED_BRANCH_WALL", `${field}.branchLaneIds`)
  }
}

function assertNoObservedChanges(lane) {
  const observed = lane.observedWorkspace
  for (const collection of ["trackedChanges", "untrackedChanges", "ignoredChanges"]) {
    if (observed[collection].length > 0) {
      wall("ISOLATED_WORKSPACE_FOREIGN_CHANGE_WALL", `lanes[${lane.inputIndex}].observedWorkspace.${collection}`)
    }
  }
}

function actionFor(lane) {
  const base = {
    laneId: lane.laneId,
    workOrderId: lane.workOrderId,
    repository: lane.repository,
    repositoryRoot: lane.repositoryRoot,
    workspacePath: lane.workspacePath,
    branch: lane.branch,
    baseRef: lane.baseRef,
    baseCommitSha: lane.baseCommitSha,
  }
  const terminal = TERMINAL_STATES.has(lane.lifecycleState)
  if (lane.observedWorkspace === null) {
    return { action: terminal ? "CLEANUP" : "CREATE", ...base, reasonCodes: [terminal ? "ALREADY_ABSENT" : "WORKSPACE_ABSENT"] }
  }
  assertExactObservedIdentity(lane)
  assertNoObservedChanges(lane)
  const observed = lane.observedWorkspace
  const changes = [...observed.trackedChanges, ...observed.untrackedChanges, ...observed.ignoredChanges]
  if (terminal) {
    if (changes.length > 0 || observed.headCommitSha !== lane.baseCommitSha) {
      wall("ISOLATED_WORKSPACE_UNSAFE_CLEANUP_WALL", `lanes[${lane.inputIndex}].observedWorkspace`)
    }
    return { action: "CLEANUP", ...base, reasonCodes: ["TERMINAL_CLEAN_EXACT_OWNERSHIP"] }
  }
  const hasDrift = changes.length > 0 || observed.headCommitSha !== lane.baseCommitSha
  return { action: hasDrift ? "RECONCILE" : "REUSE", ...base, reasonCodes: [hasDrift ? "OWNED_SAFE_DRIFT" : "EXACT_CLEAN_IDENTITY"] }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) return Object.fromEntries(Object.keys(value).sort(lexicalCompare).map((key) => [key, canonicalize(value[key])]))
  return value
}

export function canonicalIsolatedWorkspaceJson(value) {
  return JSON.stringify(canonicalize(value))
}

function contentHash(value) {
  return crypto.createHash("sha256").update(canonicalIsolatedWorkspaceJson(value)).digest("hex")
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

export function planIsolatedWorkspaces(input) {
  if (plainObject(input)) {
    const authorityField = Object.keys(input).find((key) => AUTHORITY_FIELDS.has(key))
    if (authorityField) {
      wall("ISOLATED_WORKSPACE_AUTHORITY_MINT_WALL", authorityField, "FALSE_OR_OMITTED_REQUIRED")
    }
  }
  assertExactFields(input, INPUT_FIELDS, "input")
  if (input.schemaVersion !== 1) wall("ISOLATED_WORKSPACE_INPUT_WALL", "schemaVersion", "UNSUPPORTED_SCHEMA_VERSION")
  if (input.artifactType !== "MULTI_AGENT_ISOLATED_WORKSPACE_INPUT") {
    wall("ISOLATED_WORKSPACE_INPUT_WALL", "artifactType", "UNSUPPORTED_ARTIFACT_TYPE")
  }
  const planId = stringValue(input.planId, "planId", IDENTIFIER)
  const workspaceRoot = normalizedPath(absolutePath(input.workspaceRoot, "workspaceRoot"))
  if (!Array.isArray(input.lanes) || input.lanes.length === 0) wall("ISOLATED_WORKSPACE_TYPE_WALL", "lanes", "NON_EMPTY_ARRAY_REQUIRED")
  const lanes = input.lanes.map((lane, laneIndex) => normalizeLane(lane, laneIndex, workspaceRoot))
  assertExclusiveLaneIdentities(lanes)
  lanes.sort((left, right) => lexicalCompare(left.laneId, right.laneId) || lexicalCompare(left.workOrderId, right.workOrderId))
  const actions = lanes.map(actionFor)
  const plan = {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_ISOLATED_WORKSPACE_PLAN",
    planId,
    status: "PLANNED",
    workspaceRoot,
    actions,
    planningOnly: true,
    localContractOnly: true,
    gitCommandPerformed: false,
    filesystemMutationPerformed: false,
    executionPerformed: false,
    cleanupPerformed: false,
    executionAuthorized: false,
    mutationPerformed: false,
    authorityGranted: false,
    ownerOperationsRequired: false,
  }
  return deepFreeze({ ...plan, planHash: contentHash(plan) })
}

function runGit(repositoryRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.error || (!allowFailure && result.status !== 0)) {
    wall("ISOLATED_WORKSPACE_GIT_WALL", "git", args[0])
  }
  return result
}

function ownershipRecord(lane) {
  return {
    laneId: lane.laneId,
    workOrderId: lane.workOrderId,
    repository: lane.repository,
    repositoryRoot: lane.repositoryRoot,
    workspacePath: lane.workspacePath,
    branch: lane.branch,
    baseRef: lane.baseRef,
    baseCommitSha: lane.baseCommitSha,
    reservationSetId: lane.reservationSetId,
    leaseId: lane.leaseId,
    leaseFence: lane.leaseFence,
    evidenceEventId: lane.evidenceEventId,
    headCommitSha: lane.baseCommitSha,
  }
}

function trustedBindingRecord(lane) {
  return {
    laneId: lane.laneId,
    workOrderId: lane.workOrderId,
    repository: lane.repository,
    repositoryRoot: lane.repositoryRoot,
    workspacePath: lane.workspacePath,
    branch: lane.branch,
    baseRef: lane.baseRef,
    baseCommitSha: lane.baseCommitSha,
    lifecycleState: lane.lifecycleState,
    reservedPaths: lane.reservedPaths,
    reservationSetId: lane.reservationSetId,
    leaseId: lane.leaseId,
    leaseFence: lane.leaseFence,
    evidenceEventId: lane.evidenceEventId,
  }
}

function ownershipFile(workspaceRoot) {
  return path.join(workspaceRoot, ".williamos-workspace-ownership.json")
}

function readOwnership(workspaceRoot) {
  const file = ownershipFile(workspaceRoot)
  if (!fs.existsSync(file)) return { schemaVersion: 1, entries: [] }
  let value
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "READABLE_JSON_REQUIRED")
  }
  if (!plainObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.entries)) {
    wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "SUPPORTED_REGISTRY_REQUIRED")
  }
  for (const entry of value.entries) {
    if (!plainObject(entry)
      || Object.keys(entry).length !== OWNERSHIP_FIELDS.size
      || [...OWNERSHIP_FIELDS].some((field) => !Object.hasOwn(entry, field))) {
      wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "SUPPORTED_REGISTRY_REQUIRED")
    }
  }
  return value
}

function writeOwnership(workspaceRoot, value) {
  const file = ownershipFile(workspaceRoot)
  const temporary = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, `${canonicalIsolatedWorkspaceJson(value)}\n`, { flag: "wx" })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

function exactOwnership(entry, lane) {
  if (!entry) return false
  const expected = ownershipRecord(lane)
  expected.headCommitSha = entry.headCommitSha
  return contentHash(entry) === contentHash(expected)
}

function parseWorktrees(repositoryRoot) {
  const output = runGit(repositoryRoot, ["worktree", "list", "--porcelain"]).stdout.trim()
  if (!output) return []
  return output.split(/\r?\n\r?\n/).map((block) => {
    const fields = Object.fromEntries(block.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(" ")
      return separator === -1 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)]
    }))
    return {
      path: fields.worktree,
      branch: typeof fields.branch === "string" ? fields.branch.replace(/^refs\/heads\//, "") : null,
    }
  })
}

function assertLiveRoots(workspaceRoot, lane) {
  if (!fs.existsSync(workspaceRoot) || !fs.statSync(workspaceRoot).isDirectory()) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", "workspaceRoot", "EXISTING_DIRECTORY_REQUIRED")
  }
  if (fs.lstatSync(workspaceRoot).isSymbolicLink()) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", "workspaceRoot", "SYMLINK_ROOT_FORBIDDEN")
  }
  const actualRoot = normalizedPath(fs.realpathSync(workspaceRoot))
  if (actualRoot !== normalizedPath(workspaceRoot)) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", "workspaceRoot", "CANONICAL_ROOT_REQUIRED")
  }
  const repositoryTop = normalizedPath(runGit(lane.repositoryRoot, ["rev-parse", "--show-toplevel"]).stdout.trim())
  if (repositoryTop !== lane.repositoryRoot) {
    wall("ISOLATED_WORKSPACE_FOREIGN_REPOSITORY_WALL", "repositoryRoot")
  }
  const refCheck = spawnSync("git", ["check-ref-format", "--branch", lane.branch], {
    encoding: "utf8",
    windowsHide: true,
    cwd: lane.repositoryRoot,
  })
  if (refCheck.status !== 0) wall("ISOLATED_WORKSPACE_FORMAT_WALL", "branch", "GIT_BRANCH_REQUIRED")
  const baseCommitExists = runGit(lane.repositoryRoot, ["cat-file", "-e", `${lane.baseCommitSha}^{commit}`], {
    allowFailure: true,
  }).status === 0
  const baseDescendsFromCheckpoint = baseCommitExists && runGit(lane.repositoryRoot, [
    "merge-base", "--is-ancestor", lane.baseCommitSha, lane.baseRef,
  ], { allowFailure: true }).status === 0
  if (!baseDescendsFromCheckpoint) wall("ISOLATED_WORKSPACE_FOREIGN_BASE_WALL", "baseCommitSha")
  const parent = path.dirname(lane.workspacePath)
  if (!fs.existsSync(parent) || normalizedPath(fs.realpathSync(parent)) !== normalizedPath(workspaceRoot)) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", "workspacePath", "DIRECT_CANONICAL_CHILD_REQUIRED")
  }
  if (fs.existsSync(lane.workspacePath) && fs.lstatSync(lane.workspacePath).isSymbolicLink()) {
    wall("ISOLATED_WORKSPACE_PATH_WALL", "workspacePath", "SYMLINK_WORKSPACE_FORBIDDEN")
  }
}

function workspaceStatus(lane, worktrees) {
  const matching = worktrees.filter((entry) => samePath(entry.path, lane.workspacePath))
  const branchAttachments = worktrees.filter((entry) => entry.branch?.toLowerCase() === lane.branch.toLowerCase())
  if (matching.length > 1 || branchAttachments.length > 1) {
    wall("ISOLATED_WORKSPACE_SHARED_WORKTREE_WALL", "worktree")
  }
  if (matching.length === 1 && matching[0].branch !== lane.branch) {
    wall("ISOLATED_WORKSPACE_FOREIGN_BRANCH_WALL", "worktree.branch")
  }
  if (branchAttachments.length === 1 && !samePath(branchAttachments[0].path, lane.workspacePath)) {
    wall("ISOLATED_WORKSPACE_SHARED_BRANCH_WALL", "worktree.branch")
  }
  const exists = matching.length === 1
  const branchExists = runGit(lane.repositoryRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${lane.branch}`], {
    allowFailure: true,
  }).status === 0
  const dirty = exists
    ? runGit(lane.workspacePath, ["status", "--porcelain=v1", "--untracked-files=all", "--ignored"]).stdout.trim()
    : ""
  const headCommitSha = branchExists
    ? runGit(lane.repositoryRoot, ["rev-parse", `refs/heads/${lane.branch}^{commit}`]).stdout.trim()
    : null
  return { exists, branchExists, dirty, headCommitSha }
}

function attachOwnedWorktree(lane, expectedHeadCommitSha) {
  runGit(lane.repositoryRoot, [
    "worktree", "add", "--detach", lane.workspacePath, `refs/heads/${lane.branch}`,
  ])
  try {
    runGit(lane.workspacePath, ["symbolic-ref", "HEAD", `refs/heads/${lane.branch}`])
    const attached = workspaceStatus(lane, parseWorktrees(lane.repositoryRoot))
    if (!attached.exists || !attached.branchExists || attached.headCommitSha !== expectedHeadCommitSha) {
      wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "worktree", "EXACT_REATTACH_VERIFICATION_REQUIRED")
    }
  } catch (error) {
    const attached = parseWorktrees(lane.repositoryRoot).some((entry) => samePath(entry.path, lane.workspacePath))
    if (attached) runGit(lane.repositoryRoot, ["worktree", "remove", "--", lane.workspacePath])
    throw error
  }
}

function verifyTrustedBinding(lane, trustedContext) {
  if (!trustedContext || typeof trustedContext.verifyLaneBinding !== "function") {
    wall("ISOLATED_WORKSPACE_TRUST_WALL", "trustedContext", "HOST_VERIFIER_REQUIRED")
  }
  const verified = trustedContext.verifyLaneBinding(trustedBindingRecord(lane))
  if (!plainObject(verified) || !COMMIT_SHA.test(verified.headCommitSha ?? "")) {
    wall("ISOLATED_WORKSPACE_TRUST_WALL", "trustedContext", "CHECKPOINT_HEAD_REQUIRED")
  }
  const expected = {
    verified: true,
    ...trustedBindingRecord(lane),
    headCommitSha: verified.headCommitSha,
  }
  if (contentHash(verified) !== contentHash(expected)) {
    wall("ISOLATED_WORKSPACE_TRUST_WALL", "trustedContext", "EXACT_STORE_BINDING_REQUIRED")
  }
  return verified
}

export function executeIsolatedWorkspaceLifecycle(input, trustedContext = undefined) {
  const planned = planIsolatedWorkspaces(input)
  if (input.lanes.length !== 1) {
    wall("ISOLATED_WORKSPACE_EXECUTION_WALL", "lanes", "SINGLE_LANE_ATOMIC_APPLY_REQUIRED")
  }
  const workspaceRoot = normalizedPath(input.workspaceRoot)
  const lock = path.join(workspaceRoot, ".williamos-workspace-manager.lock")
  try {
    fs.mkdirSync(lock)
  } catch {
    wall("ISOLATED_WORKSPACE_LOCK_WALL", "workspaceRoot", "MANAGER_ALREADY_ACTIVE")
  }
  const results = []
  let mutated = false
  try {
    let registry = readOwnership(workspaceRoot)
    for (const rawLane of input.lanes) {
      const lane = normalizeLane(rawLane, input.lanes.indexOf(rawLane), workspaceRoot)
      const trustedBinding = verifyTrustedBinding(lane, trustedContext)
      const executionBinding = {
        checkpointHeadCommitSha: trustedBinding.headCommitSha,
        trustedBindingHash: contentHash(trustedBinding),
      }
      assertLiveRoots(workspaceRoot, lane)
      const entries = registry.entries.filter((entry) => entry.laneId === lane.laneId
        || entry.workOrderId === lane.workOrderId
        || samePath(entry.workspacePath, lane.workspacePath)
        || entry.branch?.toLowerCase() === lane.branch.toLowerCase())
      if (entries.length > 1 || (entries.length === 1 && !exactOwnership(entries[0], lane))) {
        wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "EXACT_LEASE_EVIDENCE_BINDING_REQUIRED")
      }
      const owned = entries[0]
      const state = workspaceStatus(lane, parseWorktrees(lane.repositoryRoot))
      if (state.dirty) wall("ISOLATED_WORKSPACE_FOREIGN_CHANGE_WALL", "worktree.status")
      if (state.branchExists && trustedBinding.headCommitSha !== state.headCommitSha) {
        wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "branch", "CHECKPOINT_HEAD_MISMATCH")
      }
      if (!state.branchExists && trustedBinding.headCommitSha !== lane.baseCommitSha) {
        wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "branch", "CHECKPOINT_BRANCH_MISSING")
      }
      const terminal = TERMINAL_STATES.has(lane.lifecycleState)
      if (terminal) {
        if (!owned && !state.exists && !state.branchExists) {
          results.push({ laneId: lane.laneId, action: "CLEANUP", changed: false,
            reasonCode: "ALREADY_ABSENT", ...executionBinding })
          continue
        }
        if (!owned || !state.exists || !state.branchExists) {
          wall("ISOLATED_WORKSPACE_UNSAFE_CLEANUP_WALL", "worktree", "EXACT_OWNED_STATE_REQUIRED")
        }
        const merged = runGit(lane.repositoryRoot, [
          "merge-base", "--is-ancestor", `refs/heads/${lane.branch}`, lane.baseRef,
        ], {
          allowFailure: true,
        }).status === 0
        if (!merged) wall("ISOLATED_WORKSPACE_UNSAFE_CLEANUP_WALL", "branch", "MERGED_BRANCH_REQUIRED")
        const nextRegistry = { ...registry, entries: registry.entries.filter((entry) => entry !== owned) }
        try {
          runGit(lane.repositoryRoot, ["worktree", "remove", "--", lane.workspacePath])
          runGit(lane.repositoryRoot, ["branch", "-d", "--", lane.branch])
          writeOwnership(workspaceRoot, nextRegistry)
        } catch (error) {
          const rollback = workspaceStatus(lane, parseWorktrees(lane.repositoryRoot))
          if (!rollback.branchExists) {
            runGit(lane.repositoryRoot, ["branch", lane.branch, trustedBinding.headCommitSha])
          }
          if (!rollback.exists) {
            attachOwnedWorktree(lane, trustedBinding.headCommitSha)
          }
          throw error
        }
        registry = nextRegistry
        mutated = true
        results.push({ laneId: lane.laneId, action: "CLEANUP", changed: true,
          reasonCode: "CLEAN_OWNED_MERGED_WORKSPACE", ...executionBinding })
        continue
      }
      if (state.exists) {
        if (!owned) wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "OWNERSHIP_RECORD_REQUIRED")
        results.push({ laneId: lane.laneId, action: "REUSE", changed: false,
          reasonCode: "EXACT_CLEAN_OWNED_WORKSPACE", ...executionBinding })
        continue
      }
      if (state.branchExists) {
        if (!owned) wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "OWNERSHIP_RECORD_REQUIRED")
        attachOwnedWorktree(lane, trustedBinding.headCommitSha)
        mutated = true
        results.push({ laneId: lane.laneId, action: "RECONCILE", changed: true,
          reasonCode: "REATTACHED_OWNED_BRANCH", ...executionBinding })
        continue
      }
      if (owned) wall("ISOLATED_WORKSPACE_OWNERSHIP_WALL", "ownership", "OWNED_BRANCH_MISSING")
      const nextRegistry = { ...registry, entries: [...registry.entries, ownershipRecord(lane)]
        .sort((left, right) => lexicalCompare(left.laneId, right.laneId)) }
      try {
        runGit(lane.repositoryRoot, ["worktree", "add", "-b", lane.branch, lane.workspacePath, lane.baseCommitSha])
        writeOwnership(workspaceRoot, nextRegistry)
      } catch (error) {
        const rollback = workspaceStatus(lane, parseWorktrees(lane.repositoryRoot))
        if (rollback.exists) runGit(lane.repositoryRoot, ["worktree", "remove", "--", lane.workspacePath])
        if (rollback.branchExists) runGit(lane.repositoryRoot, ["branch", "-d", "--", lane.branch])
        throw error
      }
      registry = nextRegistry
      mutated = true
      results.push({ laneId: lane.laneId, action: "CREATE", changed: true,
        reasonCode: "CREATED_OWNED_BRANCH_WORKTREE", ...executionBinding })
    }
    return deepFreeze({
      schemaVersion: 1,
      artifactType: "MULTI_AGENT_ISOLATED_WORKSPACE_EXECUTION_RESULT",
      requestedPlanHash: planned.planHash,
      results,
      executionHash: contentHash({ requestedPlanHash: planned.planHash, results }),
      executionPerformed: true,
      mutationPerformed: mutated,
      authorityGranted: false,
      ownerOperationsRequired: false,
    })
  } finally {
    fs.rmSync(lock, { recursive: true, force: true })
  }
}

export const planIsolatedWorkspace = planIsolatedWorkspaces
export const planIsolatedWorkspaceLifecycle = planIsolatedWorkspaces
export const reconcileIsolatedWorkspace = planIsolatedWorkspaces
