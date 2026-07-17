import crypto from "node:crypto"

const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "workOrderId",
  "programGrant",
  "preventiveTrustGate",
  "lane",
  "commit",
  "push",
  "secretScan",
])
const GRANT_FIELDS = new Set(["grantId", "status", "programId", "riskClass", "authorityGrantRefs"])
const TRUST_FIELDS = new Set(["gateRef", "passed", "identityAttributed", "pathConfined", "outputRedacted"])
const LANE_FIELDS = new Set([
  "repository",
  "branch",
  "baseRef",
  "baseCommitSha",
  "headCommitSha",
  "reservedPaths",
  "changedFiles",
  "foreignChanges",
])
const COMMIT_FIELDS = new Set(["message", "authorName", "authorEmail"])
const PUSH_FIELDS = new Set(["remote", "remoteBranch", "rollbackRef"])
const SECRET_SCAN_FIELDS = new Set(["passed", "scannedFiles"])
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9._:/#-]{1,191}$/
const BRANCH = /^codex\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,120}[A-Za-z0-9])?$/
const BASE_REF = /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,120}[A-Za-z0-9])?$/
const COMMIT_SHA = /^[0-9a-f]{40}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MESSAGE = /^[A-Za-z0-9][A-Za-z0-9():._, /-]{4,119}$/
const PREVENTIVE_TRUST_GATE_V2_REF = "control-center/backend/workers.py#validate_preventive_trust_gate_v2"

export class BranchCommitPushAutomationError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "BranchCommitPushAutomationError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new BranchCommitPushAutomationError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("BRANCH_PUSH_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("BRANCH_PUSH_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("BRANCH_PUSH_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function safeText(value, field, pattern) {
  if (typeof value !== "string" || !pattern.test(value) || /[\u0000-\u001f\u007f]/u.test(value)) {
    wall("BRANCH_PUSH_FORMAT_WALL", field, "SAFE_TEXT_REQUIRED")
  }
  return value
}

function safePath(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.startsWith("/")
    || /^[A-Za-z]:/.test(value) || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    wall("BRANCH_PUSH_PATH_WALL", field, "SAFE_RELATIVE_POSIX_PATH_REQUIRED")
  }
  return value.toLowerCase()
}

function pathSet(value, field, nonempty = true) {
  if (!Array.isArray(value) || (nonempty && value.length === 0)) wall("BRANCH_PUSH_TYPE_WALL", field, "ARRAY_REQUIRED")
  const output = value.map((entry, index) => safePath(entry, `${field}[${index}]`)).sort()
  if (new Set(output).size !== output.length) wall("BRANCH_PUSH_DUPLICATE_WALL", field)
  return output
}

function textSet(value, field, pattern = IDENTIFIER) {
  if (!Array.isArray(value) || value.length === 0) wall("BRANCH_PUSH_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const output = value.map((entry, index) => safeText(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(output).size !== output.length) wall("BRANCH_PUSH_DUPLICATE_WALL", field)
  return output
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function pathCoveredByReservation(file, reservations) {
  return reservations.some((reservation) => file === reservation || file.startsWith(`${reservation}/`))
}

function normalizeGrant(value) {
  exactFields(value, GRANT_FIELDS, "programGrant")
  const grant = {
    grantId: safeText(value.grantId, "programGrant.grantId", IDENTIFIER),
    status: value.status,
    programId: value.programId,
    riskClass: value.riskClass,
    authorityGrantRefs: textSet(value.authorityGrantRefs, "programGrant.authorityGrantRefs", EVIDENCE_REF),
  }
  if (grant.status !== "ACTIVE") wall("BRANCH_PUSH_GRANT_WALL", "programGrant.status", "ACTIVE_REQUIRED")
  if (grant.programId !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001") {
    wall("BRANCH_PUSH_GRANT_WALL", "programGrant.programId", "MAO_PROGRAM_REQUIRED")
  }
  if (!["R0", "R1", "R2", "R3"].includes(grant.riskClass)) wall("BRANCH_PUSH_GRANT_WALL", "programGrant.riskClass", "KNOWN_RISK_REQUIRED")
  return grant
}

function normalizeTrust(value) {
  exactFields(value, TRUST_FIELDS, "preventiveTrustGate")
  if (value.gateRef !== PREVENTIVE_TRUST_GATE_V2_REF) wall("BRANCH_PUSH_TRUST_WALL", "preventiveTrustGate.gateRef", "V2_GATE_REQUIRED")
  for (const field of ["passed", "identityAttributed", "pathConfined", "outputRedacted"]) {
    if (value[field] !== true) wall("BRANCH_PUSH_TRUST_WALL", `preventiveTrustGate.${field}`, "TRUE_REQUIRED")
  }
  return {
    gateRef: value.gateRef,
    passed: true,
    identityAttributed: true,
    pathConfined: true,
    outputRedacted: true,
  }
}

function normalizeLane(value) {
  exactFields(value, LANE_FIELDS, "lane")
  const lane = {
    repository: safeText(value.repository, "lane.repository", REPOSITORY),
    branch: safeText(value.branch, "lane.branch", BRANCH),
    baseRef: safeText(value.baseRef, "lane.baseRef", BASE_REF),
    baseCommitSha: safeText(value.baseCommitSha, "lane.baseCommitSha", COMMIT_SHA),
    headCommitSha: safeText(value.headCommitSha, "lane.headCommitSha", COMMIT_SHA),
    reservedPaths: pathSet(value.reservedPaths, "lane.reservedPaths"),
    changedFiles: pathSet(value.changedFiles, "lane.changedFiles"),
    foreignChanges: pathSet(value.foreignChanges, "lane.foreignChanges", false),
  }
  if (lane.branch === "codex/main" || lane.branch === "codex/master") wall("BRANCH_PUSH_BRANCH_WALL", "lane.branch", "FEATURE_BRANCH_REQUIRED")
  if (lane.foreignChanges.length > 0) wall("BRANCH_PUSH_FOREIGN_CHANGE_WALL", "lane.foreignChanges", "EMPTY_REQUIRED")
  for (const file of lane.changedFiles) {
    if (!pathCoveredByReservation(file, lane.reservedPaths)) wall("BRANCH_PUSH_RESERVATION_WALL", `lane.changedFiles.${file}`, "RESERVED_PATH_REQUIRED")
  }
  return lane
}

function normalizeCommit(value) {
  exactFields(value, COMMIT_FIELDS, "commit")
  return {
    message: safeText(value.message, "commit.message", MESSAGE),
    authorName: safeText(value.authorName, "commit.authorName", /^[A-Za-z0-9][A-Za-z0-9 ._-]{1,79}$/),
    authorEmail: safeText(value.authorEmail, "commit.authorEmail", EMAIL),
  }
}

function normalizePush(value, lane) {
  exactFields(value, PUSH_FIELDS, "push")
  const push = {
    remote: value.remote,
    remoteBranch: safeText(value.remoteBranch, "push.remoteBranch", BRANCH),
    rollbackRef: safeText(value.rollbackRef, "push.rollbackRef", COMMIT_SHA),
  }
  if (push.remote !== "origin") wall("BRANCH_PUSH_REMOTE_WALL", "push.remote", "ORIGIN_REQUIRED")
  if (push.remoteBranch !== lane.branch) wall("BRANCH_PUSH_REMOTE_WALL", "push.remoteBranch", "LANE_BRANCH_REQUIRED")
  if (push.rollbackRef !== lane.baseCommitSha) wall("BRANCH_PUSH_ROLLBACK_WALL", "push.rollbackRef", "BASE_COMMIT_REQUIRED")
  return push
}

function normalizeSecretScan(value, lane) {
  exactFields(value, SECRET_SCAN_FIELDS, "secretScan")
  if (value.passed !== true) wall("BRANCH_PUSH_SECRET_WALL", "secretScan.passed", "TRUE_REQUIRED")
  const scannedFiles = pathSet(value.scannedFiles, "secretScan.scannedFiles")
  if (JSON.stringify(scannedFiles) !== JSON.stringify(lane.changedFiles)) {
    wall("BRANCH_PUSH_SECRET_WALL", "secretScan.scannedFiles", "EXACT_CHANGED_FILES_REQUIRED")
  }
  return { passed: true, scannedFiles }
}

export function evaluateBranchCommitPushAutomation(input) {
  exactFields(input, INPUT_FIELDS, "branchCommitPush")
  if (input.schemaVersion !== 1) wall("BRANCH_PUSH_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "BRANCH_COMMIT_PUSH_AUTOMATION_INPUT") {
    wall("BRANCH_PUSH_INPUT_WALL", "artifactType", "BRANCH_COMMIT_PUSH_AUTOMATION_INPUT_REQUIRED")
  }
  if (input.workOrderId !== "WO-MAO-037") wall("BRANCH_PUSH_INPUT_WALL", "workOrderId", "WO-MAO-037_REQUIRED")
  const grant = normalizeGrant(input.programGrant)
  const preventiveTrustGate = normalizeTrust(input.preventiveTrustGate)
  const lane = normalizeLane(input.lane)
  const commit = normalizeCommit(input.commit)
  const push = normalizePush(input.push, lane)
  const secretScan = normalizeSecretScan(input.secretScan, lane)
  const plan = {
    schemaVersion: 1,
    artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_RESULT",
    workOrderId: "WO-MAO-037",
    status: "BRANCH_COMMIT_PUSH_AUTOMATION_PROVEN",
    repository: lane.repository,
    branch: lane.branch,
    baseRef: lane.baseRef,
    baseCommitSha: lane.baseCommitSha,
    headCommitSha: lane.headCommitSha,
    reservedPaths: lane.reservedPaths,
    stagedFiles: lane.changedFiles,
    commitMessage: commit.message,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    remote: push.remote,
    remoteBranch: push.remoteBranch,
    rollbackRef: push.rollbackRef,
    authorityGrantRefs: grant.authorityGrantRefs,
    preventiveTrustGateRef: preventiveTrustGate.gateRef,
    branchCreationAllowed: true,
    commitAllowed: true,
    pushAllowed: true,
    foreignChangesExcluded: true,
    secretScanPassed: secretScan.passed,
    rollbackPreserved: true,
    gitCommandPerformed: false,
    pushPerformed: false,
    prCreated: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
  return deepFreeze({ ...plan, planHash: contentHash(plan) })
}

export function canonicalBranchCommitPushAutomationJson(value) {
  return JSON.stringify(canonicalize(value))
}
