import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "certificationId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "reviewCycle", "ciRepairCycle",
  "threadPolicy", "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority",
  "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const REVIEW_FIELDS = new Set(["source", "findingId", "findingStatus", "remediationStatus", "reviewer"])
const CI_FIELDS = new Set(["failureClass", "firstRunStatus", "repairAction", "finalRunStatus"])
const THREAD_FIELDS = new Set(["unresolvedReviewThreadsRequired", "unresolvedReviewThreadsObserved", "mergeBlockedUntilZero"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "concurrentLanesVerified", "certificationAuthorityGranted"])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed", "productionWritePerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class CrossReviewCiRemediationCertificationError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "CrossReviewCiRemediationCertificationError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new CrossReviewCiRemediationCertificationError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("CROSS_REVIEW_CI_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CROSS_REVIEW_CI_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CROSS_REVIEW_CI_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("CROSS_REVIEW_CI_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION",
  certificationId: "cross-review-ci-remediation-certification-wo-mao-056-v1",
  workOrderId: "WO-MAO-056",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "9ba25cf7ed3b948887fea8a37313eae4513e1804",
  baseTreeHash: "27fd22bc2ad834e0a270843e10196f17802fbd40",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-055", evidenceId: "EVIDENCE-WO-MAO-055-CONCURRENT-CERTIFICATION-LANES-V1", status: "CANONICAL_CONCURRENT_CERTIFICATION_LANES_VERIFIED", recordContentHash: "2c913d5b131da494fc31951b68ba7b0dd79fcf877ee923679833da3af90f49f3" },
  ],
  reviewCycle: {
    source: "independent-assurance-agent",
    findingId: "WO-MAO-055-RESERVATION-ACCOUNTING-P2",
    findingStatus: "REQUESTED_CHANGES",
    remediationStatus: "REMEDIATED",
    reviewer: "Volta",
  },
  ciRepairCycle: {
    failureClass: "FULL_SUITE_TIMING_FLAKE_AND_BUILD_EPHEMERAL_NEXT",
    firstRunStatus: "FAILED_THEN_CLASSIFIED",
    repairAction: "SEQUENTIAL_RERUN_AND_VERIFIED_REPO_LOCAL_NEXT_CLEANUP",
    finalRunStatus: "PASS",
  },
  threadPolicy: {
    unresolvedReviewThreadsRequired: 0,
    unresolvedReviewThreadsObserved: 0,
    mergeBlockedUntilZero: true,
  },
  reservedPaths: [
    "components/operator/multi-agent-concurrent-certification-registry.ts",
    "components/operator/multi-agent-cross-review-ci-registry.ts",
    "docs/reports/WO-MAO-055-concurrent-certification-lanes.md",
    "docs/reports/WO-MAO-056-cross-review-ci-remediation-certification.md",
    "scripts/multi-agent-operator/concurrent-certification-lanes.mjs",
    "scripts/multi-agent-operator/cross-review-ci-remediation-certification-cli.mjs",
    "scripts/multi-agent-operator/cross-review-ci-remediation-certification.mjs",
    "tests/multi-agent-concurrent-certification-lanes.test.ts",
    "tests/multi-agent-cross-review-ci-remediation-certification.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-concurrent-certification-registry.ts",
    "components/operator/multi-agent-cross-review-ci-registry.ts",
    "docs/reports/WO-MAO-055-concurrent-certification-lanes.md",
    "docs/reports/WO-MAO-056-cross-review-ci-remediation-certification.md",
    "scripts/multi-agent-operator/concurrent-certification-lanes.mjs",
    "scripts/multi-agent-operator/cross-review-ci-remediation-certification-cli.mjs",
    "scripts/multi-agent-operator/cross-review-ci-remediation-certification.mjs",
    "tests/multi-agent-concurrent-certification-lanes.test.ts",
    "tests/multi-agent-cross-review-ci-remediation-certification.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_ONLY",
    concurrentLanesVerified: true,
    certificationAuthorityGranted: false,
  },
  safety: {
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    productionWritePerformed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "4aec3517faafe914e1a89afa0c4f3e09f1ac6079070f04eb41be870dda237e4b"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("CROSS_REVIEW_CI_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("CROSS_REVIEW_CI_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("CROSS_REVIEW_CI_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("CROSS_REVIEW_CI_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION") wall("CROSS_REVIEW_CI_SCHEMA_WALL", "plan")
  text(plan.certificationId, "plan.certificationId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-056") wall("CROSS_REVIEW_CI_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  if (!Array.isArray(plan.dependencyEvidence) || plan.dependencyEvidence.length !== 1) wall("CROSS_REVIEW_CI_DEPENDENCY_WALL", "dependencyEvidence")
  exact(plan.dependencyEvidence[0], DEP_FIELDS, "dependencyEvidence[0]")
  if (plan.dependencyEvidence[0].workOrderId !== "WO-MAO-055") wall("CROSS_REVIEW_CI_DEPENDENCY_WALL", "dependencyEvidence[0].workOrderId")
  text(plan.dependencyEvidence[0].recordContentHash, "dependencyEvidence[0].recordContentHash", HASH64)
  exact(plan.reviewCycle, REVIEW_FIELDS, "reviewCycle")
  if (plan.reviewCycle.findingStatus !== "REQUESTED_CHANGES" || plan.reviewCycle.remediationStatus !== "REMEDIATED") wall("CROSS_REVIEW_CI_REVIEW_WALL", "reviewCycle")
  text(plan.reviewCycle.source, "reviewCycle.source")
  text(plan.reviewCycle.findingId, "reviewCycle.findingId")
  text(plan.reviewCycle.reviewer, "reviewCycle.reviewer")
  exact(plan.ciRepairCycle, CI_FIELDS, "ciRepairCycle")
  if (plan.ciRepairCycle.firstRunStatus !== "FAILED_THEN_CLASSIFIED" || plan.ciRepairCycle.finalRunStatus !== "PASS") wall("CROSS_REVIEW_CI_REPAIR_WALL", "ciRepairCycle")
  text(plan.ciRepairCycle.failureClass, "ciRepairCycle.failureClass")
  text(plan.ciRepairCycle.repairAction, "ciRepairCycle.repairAction")
  exact(plan.threadPolicy, THREAD_FIELDS, "threadPolicy")
  if (plan.threadPolicy.unresolvedReviewThreadsRequired !== 0
    || plan.threadPolicy.unresolvedReviewThreadsObserved !== 0
    || plan.threadPolicy.mergeBlockedUntilZero !== true) wall("CROSS_REVIEW_CI_THREAD_WALL", "threadPolicy")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("CROSS_REVIEW_CI_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("CROSS_REVIEW_CI_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("CROSS_REVIEW_CI_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_ONLY"
    || plan.authority.concurrentLanesVerified !== true
    || plan.authority.certificationAuthorityGranted !== false) wall("CROSS_REVIEW_CI_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("CROSS_REVIEW_CI_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    reviewCycleCount: 1,
    ciRepairCycleCount: 1,
    unresolvedReviewThreadsObserved: plan.threadPolicy.unresolvedReviewThreadsObserved,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateCrossReviewCiRemediationCertification() {
  wall("CROSS_REVIEW_CI_HOST_TRUST_WALL", "crossReviewCiRemediation", "CALLER_SUPPLIED_CERTIFICATION_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalCrossReviewCiRemediationCertification(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalCrossReviewCiRemediationCertification() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_RESULT",
    workOrderId: "WO-MAO-056",
    status: "CROSS_REVIEW_CI_REMEDIATION_CERTIFIED",
    certificationId: PLAN.certificationId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    requestedChangesCycle: PLAN.reviewCycle.findingId,
    remediationStatus: PLAN.reviewCycle.remediationStatus,
    ciRepairStatus: PLAN.ciRepairCycle.finalRunStatus,
    downstreamWorkOrderId: "WO-MAO-058",
    downstreamState: "WAITING_FOR_WO_MAO_057",
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "REVIEW_WO_MAO_055_EVIDENCE",
      "RECORD_REQUESTED_CHANGES_FINDING",
      "REMEDIATE_RESERVATION_ACCOUNTING",
      "RERUN_VALIDATION_AFTER_CLASSIFIED_FAILURE",
      "REQUIRE_ZERO_UNRESOLVED_REVIEW_THREADS",
      "RECORD_STATIC_CROSS_REVIEW_CI_CERTIFICATION_EVIDENCE",
    ],
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    productionWritePerformed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalCrossReviewCiRemediationCertification() { return deepFreeze(deepCopy(PLAN)) }
export function crossReviewCiRemediationCertificationPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalCrossReviewCiRemediationCertificationJson(value) { return canonicalJson(value) }
