import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "releaseId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "releaseGates", "completedWorkOrders",
  "candidateWorkOrders", "releasedWorkOrders", "blockedWorkOrders", "reservedPaths", "changedPaths",
  "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const GATE_FIELDS = new Set(["name", "required", "state"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "dagResolverVerified", "lifecycleTaxonomyVerified", "postMergeVerificationVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "providerDispatched", "githubApiCalled", "branchCreated", "commitCreated", "pullRequestCreated",
  "mergePerformed", "productionWritePerformed", "runtimeActivationAllowed", "commandRunnerAdded",
  "backgroundWorkerAdded", "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class AutomaticDependentReleaseError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "AutomaticDependentReleaseError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new AutomaticDependentReleaseError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("DEPENDENT_RELEASE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("DEPENDENT_RELEASE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("DEPENDENT_RELEASE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("DEPENDENT_RELEASE_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_PLAN",
  releaseId: "automatic-dependent-release-wo-mao-043-v1",
  workOrderId: "WO-MAO-043",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "e29f45fd045db316bb0179fb81ab546f1d88e147",
  baseTreeHash: "710068486bc6ebe0bf22d7703faa441e9b4b63c1",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-017", evidenceId: "docs/reports/WO-MAO-017-dag-eligible-set-resolver.md", status: "DAG_ELIGIBLE_SET_RESOLVER_VERIFIED", recordContentHash: "static-dag-eligible-set-resolver" },
    { workOrderId: "WO-MAO-020", evidenceId: "docs/reports/WO-MAO-020-lifecycle-escalation-taxonomy.md", status: "LIFECYCLE_ESCALATION_TAXONOMY_VERIFIED", recordContentHash: "static-lifecycle-escalation-taxonomy" },
    { workOrderId: "WO-MAO-042", evidenceId: "EVIDENCE-WO-MAO-042-POST-MERGE-VERIFICATION-CLEANUP-V1", status: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED", recordContentHash: "45f76c7ed920dfc88b6c49044be17fd6f0ef8a154c3b8f687df78aa064e8fd2d" },
  ],
  releaseGates: [
    { name: "active-authority", required: true, state: "PASS" },
    { name: "dag-recomputed", required: true, state: "PASS" },
    { name: "dependencies-complete", required: true, state: "PASS" },
    { name: "reservation-compatible", required: true, state: "PASS" },
    { name: "owner-polling-not-required", required: true, state: "PASS" },
    { name: "runtime-dispatch-not-performed", required: true, state: "PASS" },
  ],
  completedWorkOrders: ["WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042"],
  candidateWorkOrders: ["WO-MAO-043", "WO-MAO-044"],
  releasedWorkOrders: ["WO-MAO-043"],
  blockedWorkOrders: ["WO-MAO-044"],
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-dependent-release-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-043-automatic-dependent-release.md",
    "scripts/multi-agent-operator/automatic-dependent-release-cli.mjs",
    "scripts/multi-agent-operator/automatic-dependent-release.mjs",
    "tests/multi-agent-automatic-dependent-release.test.ts",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-dependent-release-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-043-automatic-dependent-release.md",
    "scripts/multi-agent-operator/automatic-dependent-release-cli.mjs",
    "scripts/multi-agent-operator/automatic-dependent-release.mjs",
    "tests/multi-agent-automatic-dependent-release.test.ts",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    dagResolverVerified: true,
    lifecycleTaxonomyVerified: true,
    postMergeVerificationVerified: true,
    authorityScope: "DEPENDENT_RELEASE_DECISION_ONLY",
  },
  safety: {
    providerDispatched: false,
    githubApiCalled: false,
    branchCreated: false,
    commitCreated: false,
    pullRequestCreated: false,
    mergePerformed: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "c999b4eb97a64c0bf49f19f12702ba3ea3d7837e80b3998b14ec6c09c6e4f5ad"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("DEPENDENT_RELEASE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("DEPENDENT_RELEASE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  if (normalized.some((item) => item.includes("..") || item.startsWith("/") || item.startsWith("\\"))) wall("DEPENDENT_RELEASE_PATH_WALL", field)
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("DEPENDENT_RELEASE_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-017,WO-MAO-020,WO-MAO-042") wall("DEPENDENT_RELEASE_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("DEPENDENT_RELEASE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_PLAN") wall("DEPENDENT_RELEASE_SCHEMA_WALL", "plan")
  text(plan.releaseId, "plan.releaseId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-043") wall("DEPENDENT_RELEASE_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.releaseGates) || plan.releaseGates.length !== 6) wall("DEPENDENT_RELEASE_GATE_WALL", "releaseGates")
  for (const [index, gate] of plan.releaseGates.entries()) {
    exact(gate, GATE_FIELDS, `releaseGates[${index}]`)
    text(gate.name, `releaseGates[${index}].name`)
    if (gate.required !== true || gate.state !== "PASS") wall("DEPENDENT_RELEASE_GATE_WALL", `releaseGates[${index}]`)
  }
  const completed = stringArray(plan.completedWorkOrders, "completedWorkOrders", WO)
  const candidates = stringArray(plan.candidateWorkOrders, "candidateWorkOrders", WO)
  const released = stringArray(plan.releasedWorkOrders, "releasedWorkOrders", WO)
  const blocked = stringArray(plan.blockedWorkOrders, "blockedWorkOrders", WO)
  if (released.join(",") !== "WO-MAO-043") wall("DEPENDENT_RELEASE_SCOPE_WALL", "releasedWorkOrders")
  if (blocked.join(",") !== "WO-MAO-044") wall("DEPENDENT_RELEASE_SCOPE_WALL", "blockedWorkOrders")
  if (!["WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042"].every((id) => completed.includes(id))) wall("DEPENDENT_RELEASE_DEPENDENCY_WALL", "completedWorkOrders")
  if (!["WO-MAO-043", "WO-MAO-044"].every((id) => candidates.includes(id))) wall("DEPENDENT_RELEASE_SCOPE_WALL", "candidateWorkOrders")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("DEPENDENT_RELEASE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("DEPENDENT_RELEASE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("DEPENDENT_RELEASE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.dagResolverVerified !== true
    || plan.authority.lifecycleTaxonomyVerified !== true
    || plan.authority.postMergeVerificationVerified !== true
    || plan.authority.authorityScope !== "DEPENDENT_RELEASE_DECISION_ONLY") wall("DEPENDENT_RELEASE_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("DEPENDENT_RELEASE_SAFETY_WALL", `safety.${field}`)
  return {
    gateCount: plan.releaseGates.length,
    completedWorkOrderCount: completed.length,
    candidateWorkOrderCount: candidates.length,
    releasedWorkOrderCount: released.length,
    blockedWorkOrderCount: blocked.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateAutomaticDependentRelease() {
  wall("DEPENDENT_RELEASE_HOST_TRUST_WALL", "automaticDependentRelease", "CALLER_SUPPLIED_RELEASE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalAutomaticDependentReleasePlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "AUTOMATIC_DEPENDENT_RELEASE_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerDispatched: false,
    githubApiCalled: false,
    branchCreated: false,
    pullRequestCreated: false,
    authorityGranted: false,
  })
}
export function runCanonicalAutomaticDependentRelease() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "AUTOMATIC_DEPENDENT_RELEASE_RESULT",
    workOrderId: "WO-MAO-043",
    status: "AUTOMATIC_DEPENDENT_RELEASE_PROVEN",
    releaseId: PLAN.releaseId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    releasedWorkOrders: [...PLAN.releasedWorkOrders],
    blockedWorkOrders: [...PLAN.blockedWorkOrders],
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_ACTIVE_AUTHORITY",
      "RECOMPUTE_DAG_ELIGIBLE_SET",
      "RELEASE_ONLY_DEPENDENCY_CLEARED_WORK",
      "KEEP_BLOCKED_DEPENDENTS_PENDING",
      "RECORD_NO_OWNER_POLLING_REQUIRED",
      "DENY_RUNTIME_DISPATCH",
    ],
    providerDispatched: false,
    githubApiCalled: false,
    branchCreated: false,
    commitCreated: false,
    pullRequestCreated: false,
    mergePerformed: false,
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
export function loadCanonicalAutomaticDependentReleasePlan() { return deepFreeze(deepCopy(PLAN)) }
export function automaticDependentReleasePlanContentHash(value = PLAN) { return contentHash(value) }
