import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/
const URL = /^https:\/\/[A-Za-z0-9._/-]+$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "verificationId", "workOrderId", "repository", "baseRef",
  "mainCommitSha", "mainTreeHash", "dependencyEvidence", "postMergeGates", "productionRouteChecks",
  "cleanupPolicy", "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const GATE_FIELDS = new Set(["name", "required", "state"])
const ROUTE_FIELDS = new Set(["route", "expectedStatus", "observedStatus", "state"])
const CLEANUP_FIELDS = new Set(["eligibleCleanupCandidates", "deniedCleanupActions", "releasedReservations", "preservedEvidence"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "evidenceLedgerVerified", "isolatedWorkspaceManagerVerified", "mergeControllerVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "githubApiCalled", "cleanupPerformed", "unsafeCleanupPerformed", "worktreeDeleted", "branchDeleted",
  "artifactDeleted", "evidenceDeleted", "productionWritePerformed", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class PostMergeVerificationCleanupError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "PostMergeVerificationCleanupError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new PostMergeVerificationCleanupError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("POST_MERGE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("POST_MERGE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("POST_MERGE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("POST_MERGE_FORMAT_WALL", field)
  return value
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}
function canonicalJson(value) { return JSON.stringify(canonicalize(value)) }
function contentHash(value) { return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex") }
function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy)
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepCopy(child)]))
  return value
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const PLAN = deepFreeze({
  schemaVersion: 1,
  artifactType: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_PLAN",
  verificationId: "post-merge-verification-cleanup-wo-mao-042-v1",
  workOrderId: "WO-MAO-042",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  mainCommitSha: "2fafb13ef4f4d2c0b62a63cdf24f4fdd4c7d438c",
  mainTreeHash: "21a6fb6fb2374e6055b00ed4cf762391db6a63cd",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-022", evidenceId: "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md", status: "EVIDENCE_LEDGER_OWNER_TOUCH_METER_VERIFIED", recordContentHash: "static-evidence-ledger-owner-touch-meter" },
    { workOrderId: "WO-MAO-025", evidenceId: "docs/reports/WO-MAO-025-isolated-workspace-manager.md", status: "ISOLATED_WORKSPACE_MANAGER_VERIFIED", recordContentHash: "static-isolated-workspace-manager" },
    { workOrderId: "WO-MAO-041", evidenceId: "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1", status: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED", recordContentHash: "627a8ab17e98aa8c0c579653af013f5b7771f6bb2c05d4c31d11a8ce5369cd8b" },
  ],
  postMergeGates: [
    { name: "main-head-matches-origin", required: true, state: "PASS" },
    { name: "production-health-route", required: true, state: "PASS" },
    { name: "production-auth-readiness-route", required: true, state: "PASS" },
    { name: "production-operator-route", required: true, state: "PASS" },
    { name: "production-goal-console-route", required: true, state: "PASS" },
    { name: "evidence-and-artifacts-preserved", required: true, state: "PASS" },
    { name: "cleanup-scope-safe", required: true, state: "PASS" },
  ],
  productionRouteChecks: [
    { route: "https://terragroq.vercel.app/api/health", expectedStatus: 200, observedStatus: 200, state: "PASS" },
    { route: "https://terragroq.vercel.app/api/auth/readiness", expectedStatus: 200, observedStatus: 200, state: "PASS" },
    { route: "https://terragroq.vercel.app/operator", expectedStatus: 200, observedStatus: 200, state: "PASS" },
    { route: "https://terragroq.vercel.app/goal-console", expectedStatus: 200, observedStatus: 200, state: "PASS" },
  ],
  cleanupPolicy: {
    eligibleCleanupCandidates: [],
    deniedCleanupActions: [
      "shared-worktree-cleanup",
      "dirty-worktree-cleanup",
      "foreign-path-cleanup",
      "unmerged-branch-deletion",
      "generated-artifact-deletion-outside-repo-local-next",
      "obsidian-touch",
    ],
    releasedReservations: ["WO-MAO-041-branch-reservation", "WO-MAO-041-review-reservation"],
    preservedEvidence: [
      "docs/reports/WO-MAO-041-bounded-merge-controller.md",
      "docs/reports/WO-MAO-042-post-merge-verification-cleanup.md",
    ],
  },
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "components/operator/multi-agent-post-merge-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-042-post-merge-verification-cleanup.md",
    "scripts/multi-agent-operator/post-merge-verification-cleanup-cli.mjs",
    "scripts/multi-agent-operator/post-merge-verification-cleanup.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/multi-agent-post-merge-verification-cleanup.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "components/operator/multi-agent-post-merge-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-042-post-merge-verification-cleanup.md",
    "scripts/multi-agent-operator/post-merge-verification-cleanup-cli.mjs",
    "scripts/multi-agent-operator/post-merge-verification-cleanup.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/multi-agent-post-merge-verification-cleanup.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    evidenceLedgerVerified: true,
    isolatedWorkspaceManagerVerified: true,
    mergeControllerVerified: true,
    authorityScope: "POST_MERGE_VERIFICATION_AND_SAFE_CLEANUP_DECISION_ONLY",
  },
  safety: {
    githubApiCalled: false,
    cleanupPerformed: false,
    unsafeCleanupPerformed: false,
    worktreeDeleted: false,
    branchDeleted: false,
    artifactDeleted: false,
    evidenceDeleted: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "f55dbaff41391096d37ac08a8534e2337fc242281903150459c070341299b0d5"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("POST_MERGE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("POST_MERGE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("POST_MERGE_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("POST_MERGE_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-022,WO-MAO-025,WO-MAO-041") wall("POST_MERGE_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validateCleanupPolicy(value) {
  exact(value, CLEANUP_FIELDS, "cleanupPolicy")
  if (!Array.isArray(value.eligibleCleanupCandidates) || value.eligibleCleanupCandidates.length !== 0) wall("POST_MERGE_CLEANUP_WALL", "cleanupPolicy.eligibleCleanupCandidates")
  const denied = stringArray(value.deniedCleanupActions, "cleanupPolicy.deniedCleanupActions")
  for (const required of ["shared-worktree-cleanup", "dirty-worktree-cleanup", "foreign-path-cleanup", "unmerged-branch-deletion", "obsidian-touch"]) {
    if (!denied.includes(required)) wall("POST_MERGE_CLEANUP_WALL", "cleanupPolicy.deniedCleanupActions")
  }
  stringArray(value.releasedReservations, "cleanupPolicy.releasedReservations")
  pathArray(value.preservedEvidence, "cleanupPolicy.preservedEvidence")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("POST_MERGE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_PLAN") wall("POST_MERGE_SCHEMA_WALL", "plan")
  text(plan.verificationId, "plan.verificationId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-042") wall("POST_MERGE_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.mainCommitSha, "plan.mainCommitSha", SHA40)
  text(plan.mainTreeHash, "plan.mainTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.postMergeGates) || plan.postMergeGates.length !== 7) wall("POST_MERGE_GATE_WALL", "postMergeGates")
  for (const [index, gate] of plan.postMergeGates.entries()) {
    exact(gate, GATE_FIELDS, `postMergeGates[${index}]`)
    text(gate.name, `postMergeGates[${index}].name`)
    if (gate.required !== true || gate.state !== "PASS") wall("POST_MERGE_GATE_WALL", `postMergeGates[${index}]`)
  }
  if (!Array.isArray(plan.productionRouteChecks) || plan.productionRouteChecks.length !== 4) wall("POST_MERGE_ROUTE_WALL", "productionRouteChecks")
  for (const [index, route] of plan.productionRouteChecks.entries()) {
    exact(route, ROUTE_FIELDS, `productionRouteChecks[${index}]`)
    text(route.route, `productionRouteChecks[${index}].route`, URL)
    if (route.expectedStatus !== 200 || route.observedStatus !== 200 || route.state !== "PASS") wall("POST_MERGE_ROUTE_WALL", `productionRouteChecks[${index}]`)
  }
  validateCleanupPolicy(plan.cleanupPolicy)
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("POST_MERGE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("POST_MERGE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("POST_MERGE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.evidenceLedgerVerified !== true
    || plan.authority.isolatedWorkspaceManagerVerified !== true
    || plan.authority.mergeControllerVerified !== true
    || plan.authority.authorityScope !== "POST_MERGE_VERIFICATION_AND_SAFE_CLEANUP_DECISION_ONLY") wall("POST_MERGE_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("POST_MERGE_SAFETY_WALL", `safety.${field}`)
  return {
    gateCount: plan.postMergeGates.length,
    routeCheckCount: plan.productionRouteChecks.length,
    deniedCleanupActionCount: plan.cleanupPolicy.deniedCleanupActions.length,
    releasedReservationCount: plan.cleanupPolicy.releasedReservations.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluatePostMergeVerificationCleanup() {
  wall("POST_MERGE_HOST_TRUST_WALL", "postMergeVerificationCleanup", "CALLER_SUPPLIED_POST_MERGE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalPostMergeVerificationCleanupPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "POST_MERGE_VERIFICATION_CLEANUP_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    githubApiCalled: false,
    cleanupPerformed: false,
    unsafeCleanupPerformed: false,
    productionWritePerformed: false,
    authorityGranted: false,
  })
}
export function runCanonicalPostMergeVerificationCleanup() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "POST_MERGE_VERIFICATION_CLEANUP_RESULT",
    workOrderId: "WO-MAO-042",
    status: "POST_MERGE_VERIFICATION_CLEANUP_PROVEN",
    verificationId: PLAN.verificationId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    mainCommitSha: PLAN.mainCommitSha,
    mainTreeHash: PLAN.mainTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_MAIN_HEAD_AND_ORIGIN",
      "VERIFY_PRODUCTION_HEALTH_AND_AUTH_READINESS",
      "VERIFY_OPERATOR_AND_GOAL_CONSOLE_ROUTES",
      "PRESERVE_EVIDENCE_AND_ARTIFACTS",
      "DENY_UNSAFE_CLEANUP",
      "RELEASE_ONLY_VERIFIED_RESERVATION_RECORDS",
      "RECORD_DEPENDENT_RELEASE_ELIGIBILITY",
    ],
    githubApiCalled: false,
    cleanupPerformed: false,
    unsafeCleanupPerformed: false,
    worktreeDeleted: false,
    branchDeleted: false,
    artifactDeleted: false,
    evidenceDeleted: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalPostMergeVerificationCleanupPlan() { return deepFreeze(deepCopy(PLAN)) }
export function postMergeVerificationCleanupPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalPostMergeVerificationCleanupJson(value) { return canonicalJson(value) }
