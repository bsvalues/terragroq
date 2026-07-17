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
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "failureInjections", "recoveryGates",
  "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const INJECTION_FIELDS = new Set(["injectionClass", "sourceWorkOrderId", "observedOutcome", "ownerOperationRequired"])
const GATE_FIELDS = new Set(["durableCheckpointRequired", "reservationFenceRequired", "quarantineRequired", "revalidationRequired", "zeroOwnerTouchRequired"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "failureRecoveryCertified", "certificationAuthorityGranted"])
const SAFETY_FIELDS = [
  "schedulerAdded", "liveInjectionPerformed", "providerExecutionPerformed", "githubApiCalled",
  "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed",
  "productionWritePerformed", "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class FailureRecoveryCertificationError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "FailureRecoveryCertificationError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new FailureRecoveryCertificationError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("FAILURE_RECOVERY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("FAILURE_RECOVERY_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("FAILURE_RECOVERY_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("FAILURE_RECOVERY_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_FAILURE_RECOVERY_CERTIFICATION",
  certificationId: "failure-recovery-certification-wo-mao-057-v1",
  workOrderId: "WO-MAO-057",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "6b045f885b1a7935ad60110c3096a05bbf28d37c",
  baseTreeHash: "0e034aed17d15644f44f99018cd6f8eaccb4d1d0",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-047", evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1", status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED", recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
    { workOrderId: "WO-MAO-048", evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1", status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED", recordContentHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81" },
    { workOrderId: "WO-MAO-049", evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1", status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED", recordContentHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671" },
    { workOrderId: "WO-MAO-050", evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1", status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED", recordContentHash: "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75" },
    { workOrderId: "WO-MAO-056", evidenceId: "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1", status: "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_VERIFIED", recordContentHash: "e8414ecf935ef6e14bf135c253cc9c62196a84bfd526d9e05fc15f9ed18fc727" },
  ],
  failureInjections: [
    { injectionClass: "WORKER_DEATH", sourceWorkOrderId: "WO-MAO-047", observedOutcome: "RECOVERED_FROM_DURABLE_STATE", ownerOperationRequired: false },
    { injectionClass: "COORDINATOR_RESTART", sourceWorkOrderId: "WO-MAO-047", observedOutcome: "RECOVERED_WITHOUT_CONCURRENT_WRITER", ownerOperationRequired: false },
    { injectionClass: "PROVIDER_NETWORK_FAILURE", sourceWorkOrderId: "WO-MAO-048", observedOutcome: "RETRY_QUARANTINE_OR_REROUTE_BOUNDED", ownerOperationRequired: false },
    { injectionClass: "RESERVATION_COLLISION", sourceWorkOrderId: "WO-MAO-050", observedOutcome: "BLOCKED_BEFORE_WRITE", ownerOperationRequired: false },
    { injectionClass: "STALE_BASE_EVENT", sourceWorkOrderId: "WO-MAO-049", observedOutcome: "REFRESH_REVALIDATE_OR_BLOCK", ownerOperationRequired: false },
  ],
  recoveryGates: {
    durableCheckpointRequired: true,
    reservationFenceRequired: true,
    quarantineRequired: true,
    revalidationRequired: true,
    zeroOwnerTouchRequired: true,
  },
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-failure-recovery-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-057-failure-recovery-certification.md",
    "scripts/multi-agent-operator/failure-recovery-certification-cli.mjs",
    "scripts/multi-agent-operator/failure-recovery-certification.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-failure-recovery-certification.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-failure-recovery-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-057-failure-recovery-certification.md",
    "scripts/multi-agent-operator/failure-recovery-certification-cli.mjs",
    "scripts/multi-agent-operator/failure-recovery-certification.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-failure-recovery-certification.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "FAILURE_RECOVERY_CERTIFICATION_ONLY",
    failureRecoveryCertified: true,
    certificationAuthorityGranted: false,
  },
  safety: {
    schedulerAdded: false,
    liveInjectionPerformed: false,
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

const PLAN_HASH = "3506c0188d0c3f50bdb3f184fa39f1a37c341f3926c4b578f833d94969f03dd4"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("FAILURE_RECOVERY_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("FAILURE_RECOVERY_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("FAILURE_RECOVERY_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("FAILURE_RECOVERY_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_FAILURE_RECOVERY_CERTIFICATION") wall("FAILURE_RECOVERY_SCHEMA_WALL", "plan")
  text(plan.certificationId, "plan.certificationId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-057") wall("FAILURE_RECOVERY_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  if (!Array.isArray(plan.dependencyEvidence) || plan.dependencyEvidence.length !== 5) wall("FAILURE_RECOVERY_DEPENDENCY_WALL", "dependencyEvidence")
  const expectedDeps = ["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"]
  for (const [index, dependency] of plan.dependencyEvidence.entries()) {
    exact(dependency, DEP_FIELDS, `dependencyEvidence[${index}]`)
    if (dependency.workOrderId !== expectedDeps[index]) wall("FAILURE_RECOVERY_DEPENDENCY_WALL", `dependencyEvidence[${index}].workOrderId`)
    text(dependency.evidenceId, `dependencyEvidence[${index}].evidenceId`)
    text(dependency.status, `dependencyEvidence[${index}].status`)
    text(dependency.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
  }
  if (!Array.isArray(plan.failureInjections) || plan.failureInjections.length !== 5) wall("FAILURE_RECOVERY_INJECTION_WALL", "failureInjections")
  const injectionClasses = stringArray(plan.failureInjections.map((injection) => injection.injectionClass), "failureInjections.injectionClass")
  for (const [index, injection] of plan.failureInjections.entries()) {
    exact(injection, INJECTION_FIELDS, `failureInjections[${index}]`)
    text(injection.injectionClass, `failureInjections[${index}].injectionClass`)
    text(injection.sourceWorkOrderId, `failureInjections[${index}].sourceWorkOrderId`, WO)
    text(injection.observedOutcome, `failureInjections[${index}].observedOutcome`)
    if (injection.ownerOperationRequired !== false) wall("FAILURE_RECOVERY_OWNER_WALL", `failureInjections[${index}].ownerOperationRequired`)
  }
  for (const required of ["WORKER_DEATH", "COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT"]) {
    if (!injectionClasses.includes(required)) wall("FAILURE_RECOVERY_INJECTION_WALL", required)
  }
  exact(plan.recoveryGates, GATE_FIELDS, "recoveryGates")
  for (const field of GATE_FIELDS) if (plan.recoveryGates[field] !== true) wall("FAILURE_RECOVERY_GATE_WALL", `recoveryGates.${field}`)
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("FAILURE_RECOVERY_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("FAILURE_RECOVERY_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("FAILURE_RECOVERY_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "FAILURE_RECOVERY_CERTIFICATION_ONLY"
    || plan.authority.failureRecoveryCertified !== true
    || plan.authority.certificationAuthorityGranted !== false) wall("FAILURE_RECOVERY_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("FAILURE_RECOVERY_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    failureInjectionCount: plan.failureInjections.length,
    recoveryGateCount: Object.keys(plan.recoveryGates).length,
    ownerOperationRequiredCount: plan.failureInjections.filter((injection) => injection.ownerOperationRequired).length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateFailureRecoveryCertification() {
  wall("FAILURE_RECOVERY_HOST_TRUST_WALL", "failureRecovery", "CALLER_SUPPLIED_CERTIFICATION_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalFailureRecoveryCertification(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "FAILURE_RECOVERY_CERTIFICATION_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    liveInjectionPerformed: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalFailureRecoveryCertification() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "FAILURE_RECOVERY_CERTIFICATION_RESULT",
    workOrderId: "WO-MAO-057",
    status: "FAILURE_RECOVERY_CERTIFIED",
    certificationId: PLAN.certificationId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    certifiedInjectionClasses: PLAN.failureInjections.map((injection) => injection.injectionClass).sort(),
    downstreamWorkOrderId: "WO-MAO-058",
    downstreamState: "READY_AFTER_FAILURE_RECOVERY_CERTIFICATION",
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_WORKER_DEATH_RECOVERY_EVIDENCE",
      "VERIFY_COORDINATOR_RESTART_RECOVERY_EVIDENCE",
      "VERIFY_PROVIDER_NETWORK_FAILURE_BOUNDARY",
      "VERIFY_RESERVATION_COLLISION_BLOCKS_BEFORE_WRITE",
      "VERIFY_STALE_BASE_REFRESH_REVALIDATE_OR_BLOCK",
      "RECORD_STATIC_FAILURE_RECOVERY_CERTIFICATION_EVIDENCE",
    ],
    schedulerAdded: false,
    liveInjectionPerformed: false,
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
export function loadCanonicalFailureRecoveryCertification() { return deepFreeze(deepCopy(PLAN)) }
export function failureRecoveryCertificationPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalFailureRecoveryCertificationJson(value) { return canonicalJson(value) }
