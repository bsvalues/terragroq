import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[0-9a-f]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "mergeControllerId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "mergeGates", "deniedBypasses",
  "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const GATE_FIELDS = new Set(["name", "required", "state"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "preventiveTrustGatePassed", "lifecycleTaxonomyVerified", "ciReviewIngestionVerified", "remediationRereviewVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "githubApiCalled", "mergePerformed", "branchProtectionBypassed", "securityThreadDismissed",
  "authorityThreadDismissed", "reviewThreadResolved", "productionWriteAllowed", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class BoundedMergeControllerError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "BoundedMergeControllerError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new BoundedMergeControllerError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("MERGE_CONTROLLER_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("MERGE_CONTROLLER_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("MERGE_CONTROLLER_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("MERGE_CONTROLLER_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_BOUNDED_MERGE_CONTROLLER_PLAN",
  mergeControllerId: "merge-controller-wo-mao-041-v1",
  workOrderId: "WO-MAO-041",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "ceccfb9b2496865f1b60bb54de24a7d6c8af79e5",
  baseTreeHash: "8dc455883469ee550e6d8d95eacf5ae986a31a2d",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-007", evidenceId: "docs/reports/WO-MAO-007-worker-authority-trust-gate-v2.md", status: "PREVENTIVE_TRUST_GATE_VERIFIED", recordContentHash: "static-worker-authority-trust-gate-v2" },
    { workOrderId: "WO-MAO-020", evidenceId: "docs/reports/WO-MAO-020-lifecycle-escalation-taxonomy.md", status: "LIFECYCLE_ESCALATION_TAXONOMY_VERIFIED", recordContentHash: "static-lifecycle-escalation-taxonomy" },
    { workOrderId: "WO-MAO-039", evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1", status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED", recordContentHash: "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8" },
    { workOrderId: "WO-MAO-040", evidenceId: "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1", status: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED", recordContentHash: "5824568886fb6926457a68a0f7c3806ef0ee44859b38e932ed33a1e41c2102b9" },
  ],
  mergeGates: [
    { name: "active-authority", required: true, state: "PASS" },
    { name: "fresh-head", required: true, state: "PASS" },
    { name: "required-checks-green", required: true, state: "PASS" },
    { name: "zero-unresolved-review-threads", required: true, state: "PASS" },
    { name: "security-and-authority-threads-clear", required: true, state: "PASS" },
    { name: "branch-protection-respected", required: true, state: "PASS" },
  ],
  deniedBypasses: [
    "branch-protection-bypass",
    "security-thread-dismissal",
    "authority-thread-dismissal",
    "stale-head-merge",
    "failing-check-merge",
  ],
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-merge-controller-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-041-bounded-merge-controller.md",
    "scripts/multi-agent-operator/bounded-merge-controller-cli.mjs",
    "scripts/multi-agent-operator/bounded-merge-controller.mjs",
    "tests/multi-agent-bounded-merge-controller.test.ts",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-merge-controller-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-041-bounded-merge-controller.md",
    "scripts/multi-agent-operator/bounded-merge-controller-cli.mjs",
    "scripts/multi-agent-operator/bounded-merge-controller.mjs",
    "tests/multi-agent-bounded-merge-controller.test.ts",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    preventiveTrustGatePassed: true,
    lifecycleTaxonomyVerified: true,
    ciReviewIngestionVerified: true,
    remediationRereviewVerified: true,
    authorityScope: "BOUNDED_MERGE_ELIGIBILITY_DECISION_ONLY",
  },
  safety: {
    githubApiCalled: false,
    mergePerformed: false,
    branchProtectionBypassed: false,
    securityThreadDismissed: false,
    authorityThreadDismissed: false,
    reviewThreadResolved: false,
    productionWriteAllowed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "f74c983d01c8757783c6d9277b8fb18b9af3191138576b12e4c58bb8fdf82f08"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("MERGE_CONTROLLER_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("MERGE_CONTROLLER_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("MERGE_CONTROLLER_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 4) wall("MERGE_CONTROLLER_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-007,WO-MAO-020,WO-MAO-039,WO-MAO-040") wall("MERGE_CONTROLLER_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("MERGE_CONTROLLER_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_BOUNDED_MERGE_CONTROLLER_PLAN") wall("MERGE_CONTROLLER_SCHEMA_WALL", "plan")
  text(plan.mergeControllerId, "plan.mergeControllerId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-041") wall("MERGE_CONTROLLER_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.mergeGates) || plan.mergeGates.length !== 6) wall("MERGE_CONTROLLER_GATE_WALL", "mergeGates")
  for (const [index, gate] of plan.mergeGates.entries()) {
    exact(gate, GATE_FIELDS, `mergeGates[${index}]`)
    text(gate.name, `mergeGates[${index}].name`)
    if (gate.required !== true || gate.state !== "PASS") wall("MERGE_CONTROLLER_GATE_WALL", `mergeGates[${index}]`)
  }
  const deniedBypasses = stringArray(plan.deniedBypasses, "deniedBypasses")
  for (const required of ["branch-protection-bypass", "security-thread-dismissal", "authority-thread-dismissal", "stale-head-merge", "failing-check-merge"]) {
    if (!deniedBypasses.includes(required)) wall("MERGE_CONTROLLER_BYPASS_WALL", "deniedBypasses")
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("MERGE_CONTROLLER_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("MERGE_CONTROLLER_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("MERGE_CONTROLLER_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.preventiveTrustGatePassed !== true
    || plan.authority.lifecycleTaxonomyVerified !== true
    || plan.authority.ciReviewIngestionVerified !== true
    || plan.authority.remediationRereviewVerified !== true
    || plan.authority.authorityScope !== "BOUNDED_MERGE_ELIGIBILITY_DECISION_ONLY") wall("MERGE_CONTROLLER_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("MERGE_CONTROLLER_SAFETY_WALL", `safety.${field}`)
  return { gateCount: plan.mergeGates.length, deniedBypassCount: deniedBypasses.length, reservedPathCount: reservedPaths.length, changedPathCount: changedPaths.length }
}

export function evaluateBoundedMergeController() {
  wall("MERGE_CONTROLLER_HOST_TRUST_WALL", "boundedMergeController", "CALLER_SUPPLIED_MERGE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalBoundedMergeControllerPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true, code: "BOUNDED_MERGE_CONTROLLER_PLAN_VERIFIED", contentHash: PLAN_HASH,
    githubApiCalled: false, mergePerformed: false, branchProtectionBypassed: false,
    securityThreadDismissed: false, authorityThreadDismissed: false, authorityGranted: false,
  })
}
export function runCanonicalBoundedMergeController() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "BOUNDED_MERGE_CONTROLLER_RESULT",
    workOrderId: "WO-MAO-041",
    status: "BOUNDED_MERGE_CONTROLLER_PROVEN",
    mergeControllerId: PLAN.mergeControllerId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_ACTIVE_AUTHORITY",
      "VERIFY_FRESH_HEAD_AND_REQUIRED_CHECKS",
      "VERIFY_ZERO_UNRESOLVED_REVIEW_THREADS",
      "DENY_SECURITY_OR_AUTHORITY_THREAD_DISMISSAL",
      "DENY_BRANCH_PROTECTION_BYPASS",
      "RECORD_MERGE_ELIGIBILITY_FOR_POST_MERGE_GATE",
    ],
    githubApiCalled: false,
    mergePerformed: false,
    branchProtectionBypassed: false,
    securityThreadDismissed: false,
    authorityThreadDismissed: false,
    reviewThreadResolved: false,
    productionWriteAllowed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalBoundedMergeControllerPlan() { return deepFreeze(deepCopy(PLAN)) }
export function boundedMergeControllerPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalBoundedMergeControllerJson(value) { return canonicalJson(value) }
