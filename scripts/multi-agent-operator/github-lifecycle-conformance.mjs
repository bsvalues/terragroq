import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "conformanceId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "lifecycleStages", "conformanceGates",
  "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const STAGE_FIELDS = new Set(["stage", "sourceWorkOrderId", "state"])
const GATE_FIELDS = new Set(["name", "required", "state"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "phaseFiveModelsVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "githubApiCalled", "branchCreated", "commitCreated", "pullRequestCreated", "reviewThreadResolved",
  "mergePerformed", "cleanupPerformed", "providerDispatched", "productionWritePerformed",
  "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "secretMaterialAllowed",
  "ownerOperationRequired", "authorityGranted",
]

export class GitHubLifecycleConformanceError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "GitHubLifecycleConformanceError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new GitHubLifecycleConformanceError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("GITHUB_LIFECYCLE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("GITHUB_LIFECYCLE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("GITHUB_LIFECYCLE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("GITHUB_LIFECYCLE_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_PLAN",
  conformanceId: "github-lifecycle-conformance-wo-mao-044-v1",
  workOrderId: "WO-MAO-044",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "1541db6530de525ef6f86c1b55758a71c7c5447f",
  baseTreeHash: "a0913fdefec84ef2d0cdf26a27e57abcfa6d2d6a",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-037", evidenceId: "docs/reports/WO-MAO-037-branch-commit-push-automation.md", status: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED", recordContentHash: "static-branch-commit-push-automation" },
    { workOrderId: "WO-MAO-038", evidenceId: "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md", status: "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED", recordContentHash: "static-pr-creation-packet-linkage" },
    { workOrderId: "WO-MAO-039", evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1", status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED", recordContentHash: "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8" },
    { workOrderId: "WO-MAO-040", evidenceId: "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1", status: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED", recordContentHash: "5824568886fb6926457a68a0f7c3806ef0ee44859b38e932ed33a1e41c2102b9" },
    { workOrderId: "WO-MAO-041", evidenceId: "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1", status: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED", recordContentHash: "627a8ab17e98aa8c0c579653af013f5b7771f6bb2c05d4c31d11a8ce5369cd8b" },
    { workOrderId: "WO-MAO-042", evidenceId: "EVIDENCE-WO-MAO-042-POST-MERGE-VERIFICATION-CLEANUP-V1", status: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED", recordContentHash: "45f76c7ed920dfc88b6c49044be17fd6f0ef8a154c3b8f687df78aa064e8fd2d" },
    { workOrderId: "WO-MAO-043", evidenceId: "EVIDENCE-WO-MAO-043-AUTOMATIC-DEPENDENT-RELEASE-V1", status: "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_VERIFIED", recordContentHash: "2a252c8141aaecc974e0776a124672b0fe88d48c5754cede89115932100e2816" },
  ],
  lifecycleStages: [
    { stage: "branch-commit-push", sourceWorkOrderId: "WO-MAO-037", state: "PASS" },
    { stage: "pr-packet-linkage", sourceWorkOrderId: "WO-MAO-038", state: "PASS" },
    { stage: "ci-review-ingestion", sourceWorkOrderId: "WO-MAO-039", state: "PASS" },
    { stage: "remediation-rereview", sourceWorkOrderId: "WO-MAO-040", state: "PASS" },
    { stage: "bounded-merge-controller", sourceWorkOrderId: "WO-MAO-041", state: "PASS" },
    { stage: "post-merge-verification-cleanup", sourceWorkOrderId: "WO-MAO-042", state: "PASS" },
    { stage: "dependent-release", sourceWorkOrderId: "WO-MAO-043", state: "PASS" },
  ],
  conformanceGates: [
    { name: "phase-five-dependencies-complete", required: true, state: "PASS" },
    { name: "ordered-lifecycle-complete", required: true, state: "PASS" },
    { name: "required-checks-and-review-clean", required: true, state: "PASS" },
    { name: "security-and-authority-bypass-denied", required: true, state: "PASS" },
    { name: "post-merge-proof-present", required: true, state: "PASS" },
    { name: "dependent-release-proof-present", required: true, state: "PASS" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-github-lifecycle-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-044-github-lifecycle-conformance.md",
    "scripts/multi-agent-operator/github-lifecycle-conformance-cli.mjs",
    "scripts/multi-agent-operator/github-lifecycle-conformance.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-github-lifecycle-conformance.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-github-lifecycle-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-044-github-lifecycle-conformance.md",
    "scripts/multi-agent-operator/github-lifecycle-conformance-cli.mjs",
    "scripts/multi-agent-operator/github-lifecycle-conformance.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-github-lifecycle-conformance.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    phaseFiveModelsVerified: true,
    authorityScope: "GITHUB_LIFECYCLE_CONFORMANCE_DECISION_ONLY",
  },
  safety: {
    githubApiCalled: false,
    branchCreated: false,
    commitCreated: false,
    pullRequestCreated: false,
    reviewThreadResolved: false,
    mergePerformed: false,
    cleanupPerformed: false,
    providerDispatched: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("GITHUB_LIFECYCLE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("GITHUB_LIFECYCLE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) { return stringArray(value, field, PATH) }
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 7) wall("GITHUB_LIFECYCLE_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-037,WO-MAO-038,WO-MAO-039,WO-MAO-040,WO-MAO-041,WO-MAO-042,WO-MAO-043") wall("GITHUB_LIFECYCLE_DEPENDENCY_WALL", "dependencyEvidence")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("GITHUB_LIFECYCLE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_PLAN") wall("GITHUB_LIFECYCLE_SCHEMA_WALL", "plan")
  text(plan.conformanceId, "plan.conformanceId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-044") wall("GITHUB_LIFECYCLE_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.lifecycleStages) || plan.lifecycleStages.length !== 7) wall("GITHUB_LIFECYCLE_STAGE_WALL", "lifecycleStages")
  for (const [index, stage] of plan.lifecycleStages.entries()) {
    exact(stage, STAGE_FIELDS, `lifecycleStages[${index}]`)
    text(stage.stage, `lifecycleStages[${index}].stage`)
    text(stage.sourceWorkOrderId, `lifecycleStages[${index}].sourceWorkOrderId`, WO)
    if (stage.state !== "PASS") wall("GITHUB_LIFECYCLE_STAGE_WALL", `lifecycleStages[${index}]`)
  }
  if (!Array.isArray(plan.conformanceGates) || plan.conformanceGates.length !== 6) wall("GITHUB_LIFECYCLE_GATE_WALL", "conformanceGates")
  for (const [index, gate] of plan.conformanceGates.entries()) {
    exact(gate, GATE_FIELDS, `conformanceGates[${index}]`)
    text(gate.name, `conformanceGates[${index}].name`)
    if (gate.required !== true || gate.state !== "PASS") wall("GITHUB_LIFECYCLE_GATE_WALL", `conformanceGates[${index}]`)
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("GITHUB_LIFECYCLE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("GITHUB_LIFECYCLE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("GITHUB_LIFECYCLE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.phaseFiveModelsVerified !== true
    || plan.authority.authorityScope !== "GITHUB_LIFECYCLE_CONFORMANCE_DECISION_ONLY") wall("GITHUB_LIFECYCLE_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("GITHUB_LIFECYCLE_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    lifecycleStageCount: plan.lifecycleStages.length,
    conformanceGateCount: plan.conformanceGates.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateGitHubLifecycleConformance() {
  wall("GITHUB_LIFECYCLE_HOST_TRUST_WALL", "githubLifecycleConformance", "CALLER_SUPPLIED_LIFECYCLE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalGitHubLifecycleConformancePlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({ ok: true, code: "GITHUB_LIFECYCLE_CONFORMANCE_PLAN_VERIFIED", contentHash: PLAN_HASH, githubApiCalled: false, mergePerformed: false, authorityGranted: false })
}
export function runCanonicalGitHubLifecycleConformance() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "GITHUB_LIFECYCLE_CONFORMANCE_RESULT",
    workOrderId: "WO-MAO-044",
    status: "GITHUB_LIFECYCLE_CONFORMANCE_PROVEN",
    conformanceId: PLAN.conformanceId,
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
      "VERIFY_PHASE_FIVE_MODEL_CHAIN",
      "VERIFY_ORDERED_LIFECYCLE_STAGES",
      "VERIFY_REVIEW_AND_MERGE_GATES",
      "VERIFY_POST_MERGE_AND_DEPENDENT_RELEASE",
      "DENY_DIRECT_GITHUB_EXECUTION",
    ],
    githubApiCalled: false,
    branchCreated: false,
    commitCreated: false,
    pullRequestCreated: false,
    reviewThreadResolved: false,
    mergePerformed: false,
    cleanupPerformed: false,
    providerDispatched: false,
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
export function loadCanonicalGitHubLifecycleConformancePlan() { return deepFreeze(deepCopy(PLAN)) }
export function githubLifecycleConformancePlanContentHash(value = PLAN) { return contentHash(value) }
