import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const HASH_PART = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/
const EVIDENCE_REF = /^[A-Za-z0-9][A-Za-z0-9._+\/:-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "certificationId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "staleBaseRecoveredCommitSha", "liveRunId", "dependencyEvidence",
  "liveInjections", "staleBaseControl", "recoveryGates", "reservedPaths", "changedPaths",
  "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const INJECTION_FIELDS = new Set(["injectionClass", "method", "evidenceFile", "evidenceHash", "recovered", "ownerOperationRequired"])
const STALE_FIELDS = new Set(["controlPr", "baseAtBranchStart", "mainAdvancedTo", "refreshMethod", "revalidated"])
const GATE_FIELDS = new Set(["durableCheckpointRequired", "reservationFenceRequired", "quarantineRequired", "revalidationRequired", "zeroOwnerTouchRequired"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "liveFailureRecoveryAuthorized", "certificationAuthorityGranted"])
const SAFETY_FIELDS = new Set([
  "liveInjectionPerformed", "githubPrLifecycleUsed", "runtimeActivationAllowed", "commandRunnerAdded",
  "backgroundWorkerAdded", "productionWritePerformed", "secretMaterialAllowed", "ownerOperationRequired",
  "paidOverageAllowed", "rejectedRuntimeRetried", "authorityGranted",
])

export class LiveFailureRecoveryCertificationError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "LiveFailureRecoveryCertificationError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new LiveFailureRecoveryCertificationError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("LIVE_FAILURE_RECOVERY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("LIVE_FAILURE_RECOVERY_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("LIVE_FAILURE_RECOVERY_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("LIVE_FAILURE_RECOVERY_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION",
  certificationId: "live-failure-recovery-certification-wo-mao-057-v1",
  workOrderId: "WO-MAO-057",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "6b045f885b1a7935ad60110c3096a05bbf28d37c",
  staleBaseRecoveredCommitSha: "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def",
  liveRunId: "wo-mao-057-live-20260717195951",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-047", evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1", status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED", recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
    { workOrderId: "WO-MAO-048", evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1", status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED", recordContentHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81" },
    { workOrderId: "WO-MAO-049", evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1", status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED", recordContentHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671" },
    { workOrderId: "WO-MAO-050", evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1", status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED", recordContentHash: "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75" },
    { workOrderId: "WO-MAO-056", evidenceId: "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1", status: "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_VERIFIED", recordContentHash: "e8414ecf935ef6e14bf135c253cc9c62196a84bfd526d9e05fc15f9ed18fc727" },
  ],
  liveInjections: [
    { injectionClass: "WORKER_DEATH", method: "TERMINATED_LOCAL_BUILDER_AFTER_SAFE_CHECKPOINT", evidenceFile: "worker-checkpoint.json+worker-resume.json", evidenceHash: "e2eac6ced43e3364549e2c77a01118a38109a78dad1ae27d991f577dd9ed0560:5462ed2e9cbfd3663c4e695463bcfdaa3b29ef26a9c991789577deb787534730", recovered: true, ownerOperationRequired: false },
    { injectionClass: "COORDINATOR_RESTART", method: "TERMINATED_LOCAL_COORDINATOR_AFTER_DURABLE_STATE", evidenceFile: "coordinator-checkpoint.json+coordinator-recovery.json", evidenceHash: "f0c495fa77ac7f52aafda56d001accd268dac4b8f893ef3c9f344f8b17deb3ce:92a7dc58c3e828c0bb56940a5f72f3594b6e8f93ac985d86f2fdbd71c40c4289", recovered: true, ownerOperationRequired: false },
    { injectionClass: "PROVIDER_NETWORK_FAILURE", method: "INVALID_LOCAL_PROXY_THEN_NORMAL_GITHUB_RECOVERY", evidenceFile: "network-recovery.json", evidenceHash: "942a6f4f7f3e5a3039afe9fc33a5ad4b4b1356293003f53e0e267345be23cfbf", recovered: true, ownerOperationRequired: false },
    { injectionClass: "RESERVATION_COLLISION", method: "EXCLUSIVE_RESERVATION_LOCK_REJECTED_SECOND_WRITER", evidenceFile: "reservation-collision.json", evidenceHash: "184351ef0b49ac570857df13a7512755e60cf218f108b308113d5ba5831ab84c", recovered: true, ownerOperationRequired: false },
    { injectionClass: "STALE_BASE_EVENT", method: "PR_411_ADVANCED_MAIN_THEN_CERTIFICATION_BRANCH_REBASED", evidenceFile: "WO-MAO-057-stale-base-control-change.md", evidenceHash: "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def", recovered: true, ownerOperationRequired: false },
  ],
  staleBaseControl: {
    controlPr: 411,
    baseAtBranchStart: "6b045f885b1a7935ad60110c3096a05bbf28d37c",
    mainAdvancedTo: "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def",
    refreshMethod: "git rebase origin/main",
    revalidated: true,
  },
  recoveryGates: {
    durableCheckpointRequired: true,
    reservationFenceRequired: true,
    quarantineRequired: true,
    revalidationRequired: true,
    zeroOwnerTouchRequired: true,
  },
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-live-failure-recovery-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-057-live-failure-recovery-certification.md",
    "scripts/multi-agent-operator/live-failure-recovery-certification-cli.mjs",
    "scripts/multi-agent-operator/live-failure-recovery-certification.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-live-failure-recovery-certification.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-live-failure-recovery-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-057-live-failure-recovery-certification.md",
    "scripts/multi-agent-operator/live-failure-recovery-certification-cli.mjs",
    "scripts/multi-agent-operator/live-failure-recovery-certification.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-live-failure-recovery-certification.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "LIVE_FAILURE_RECOVERY_CERTIFICATION_ONLY",
    liveFailureRecoveryAuthorized: true,
    certificationAuthorityGranted: false,
  },
  safety: {
    liveInjectionPerformed: true,
    githubPrLifecycleUsed: true,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    productionWritePerformed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    paidOverageAllowed: false,
    rejectedRuntimeRetried: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "7ebf21ccdf75ee8e2726e2011f607177523eb47996e1769c7f608237cbb54b93"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("LIVE_FAILURE_RECOVERY_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("LIVE_FAILURE_RECOVERY_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("LIVE_FAILURE_RECOVERY_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("LIVE_FAILURE_RECOVERY_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION") wall("LIVE_FAILURE_RECOVERY_SCHEMA_WALL", "plan")
  text(plan.certificationId, "plan.certificationId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-057") wall("LIVE_FAILURE_RECOVERY_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.staleBaseRecoveredCommitSha, "plan.staleBaseRecoveredCommitSha", SHA40)
  text(plan.liveRunId, "plan.liveRunId")
  if (!Array.isArray(plan.dependencyEvidence) || plan.dependencyEvidence.length !== 5) wall("LIVE_FAILURE_RECOVERY_DEPENDENCY_WALL", "dependencyEvidence")
  const expectedDeps = ["WO-MAO-047", "WO-MAO-048", "WO-MAO-049", "WO-MAO-050", "WO-MAO-056"]
  for (const [index, dependency] of plan.dependencyEvidence.entries()) {
    exact(dependency, DEP_FIELDS, `dependencyEvidence[${index}]`)
    if (dependency.workOrderId !== expectedDeps[index]) wall("LIVE_FAILURE_RECOVERY_DEPENDENCY_WALL", `dependencyEvidence[${index}].workOrderId`)
    text(dependency.evidenceId, `dependencyEvidence[${index}].evidenceId`)
    text(dependency.status, `dependencyEvidence[${index}].status`)
    text(dependency.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
  }
  if (!Array.isArray(plan.liveInjections) || plan.liveInjections.length !== 5) wall("LIVE_FAILURE_RECOVERY_INJECTION_WALL", "liveInjections")
  const injectionClasses = stringArray(plan.liveInjections.map((injection) => injection.injectionClass), "liveInjections.injectionClass")
  for (const [index, injection] of plan.liveInjections.entries()) {
    exact(injection, INJECTION_FIELDS, `liveInjections[${index}]`)
    text(injection.injectionClass, `liveInjections[${index}].injectionClass`)
    text(injection.method, `liveInjections[${index}].method`)
    text(injection.evidenceFile, `liveInjections[${index}].evidenceFile`, EVIDENCE_REF)
    for (const hash of text(injection.evidenceHash, `liveInjections[${index}].evidenceHash`, /^[a-f0-9:]{40,160}$/).split(":")) text(hash, `liveInjections[${index}].evidenceHash.part`, HASH_PART)
    if (injection.recovered !== true || injection.ownerOperationRequired !== false) wall("LIVE_FAILURE_RECOVERY_INJECTION_RESULT_WALL", `liveInjections[${index}]`)
  }
  for (const required of ["WORKER_DEATH", "COORDINATOR_RESTART", "PROVIDER_NETWORK_FAILURE", "RESERVATION_COLLISION", "STALE_BASE_EVENT"]) {
    if (!injectionClasses.includes(required)) wall("LIVE_FAILURE_RECOVERY_INJECTION_WALL", required)
  }
  exact(plan.staleBaseControl, STALE_FIELDS, "staleBaseControl")
  if (plan.staleBaseControl.controlPr !== 411
    || plan.staleBaseControl.baseAtBranchStart !== plan.baseCommitSha
    || plan.staleBaseControl.mainAdvancedTo !== plan.staleBaseRecoveredCommitSha
    || plan.staleBaseControl.revalidated !== true) wall("LIVE_FAILURE_RECOVERY_STALE_BASE_WALL", "staleBaseControl")
  text(plan.staleBaseControl.refreshMethod, "staleBaseControl.refreshMethod", /^[A-Za-z0-9 ._\/:-]{1,127}$/)
  exact(plan.recoveryGates, GATE_FIELDS, "recoveryGates")
  for (const field of GATE_FIELDS) if (plan.recoveryGates[field] !== true) wall("LIVE_FAILURE_RECOVERY_GATE_WALL", `recoveryGates.${field}`)
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("LIVE_FAILURE_RECOVERY_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("LIVE_FAILURE_RECOVERY_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("LIVE_FAILURE_RECOVERY_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "LIVE_FAILURE_RECOVERY_CERTIFICATION_ONLY"
    || plan.authority.liveFailureRecoveryAuthorized !== true
    || plan.authority.certificationAuthorityGranted !== false) wall("LIVE_FAILURE_RECOVERY_AUTHORITY_WALL", "authority")
  exact(plan.safety, SAFETY_FIELDS, "safety")
  if (plan.safety.liveInjectionPerformed !== true || plan.safety.githubPrLifecycleUsed !== true) wall("LIVE_FAILURE_RECOVERY_SAFETY_WALL", "safety.liveEvidence")
  for (const field of ["runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "productionWritePerformed", "secretMaterialAllowed", "ownerOperationRequired", "paidOverageAllowed", "rejectedRuntimeRetried", "authorityGranted"]) {
    if (plan.safety[field] !== false) wall("LIVE_FAILURE_RECOVERY_SAFETY_WALL", `safety.${field}`)
  }
  return {
    dependencyCount: plan.dependencyEvidence.length,
    liveInjectionCount: plan.liveInjections.length,
    recoveryGateCount: Object.keys(plan.recoveryGates).length,
    ownerOperationRequiredCount: plan.liveInjections.filter((injection) => injection.ownerOperationRequired).length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateLiveFailureRecoveryCertification() {
  wall("LIVE_FAILURE_RECOVERY_HOST_TRUST_WALL", "liveFailureRecovery", "CALLER_SUPPLIED_CERTIFICATION_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalLiveFailureRecoveryCertification(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "LIVE_FAILURE_RECOVERY_CERTIFICATION_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    liveInjectionPerformed: true,
    githubPrLifecycleUsed: true,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalLiveFailureRecoveryCertification() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "LIVE_FAILURE_RECOVERY_CERTIFICATION_RESULT",
    workOrderId: "WO-MAO-057",
    status: "LIVE_FAILURE_RECOVERY_CERTIFIED",
    certificationId: PLAN.certificationId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    staleBaseRecoveredCommitSha: PLAN.staleBaseRecoveredCommitSha,
    liveRunId: PLAN.liveRunId,
    certifiedInjectionClasses: PLAN.liveInjections.map((injection) => injection.injectionClass).sort(),
    staleBaseControlPr: PLAN.staleBaseControl.controlPr,
    downstreamWorkOrderId: "WO-MAO-058",
    downstreamState: "READY_AFTER_LIVE_FAILURE_RECOVERY_CERTIFICATION",
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    liveInjectionPerformed: true,
    githubPrLifecycleUsed: true,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    productionWritePerformed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    paidOverageAllowed: false,
    rejectedRuntimeRetried: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalLiveFailureRecoveryCertification() { return deepFreeze(deepCopy(PLAN)) }
export function liveFailureRecoveryCertificationPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalLiveFailureRecoveryCertificationJson(value) { return canonicalJson(value) }
