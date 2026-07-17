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
  "schemaVersion", "artifactType", "drillId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "defectCases", "containmentDecisions",
  "evidenceRequirements", "reservedPaths", "changedPaths", "foreignChanges", "secretScan",
  "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const DEFECT_FIELDS = new Set(["caseId", "defectKind", "signal", "decision", "terminal", "ownerOperationRequired"])
const CONTAINMENT_FIELDS = new Set(["defectKind", "containment", "recoveryAction", "certificationImpact"])
const EVIDENCE_REQ_FIELDS = new Set(["requirement", "mode", "failureDecision"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set([
  "activeProgramGrant", "secretTrustAuditVerified", "retryIdempotencyVerified",
  "workerRecoveryVerified", "providerFailoverVerified", "mergeRaceVerified", "authorityScope",
])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "productionWritePerformed",
  "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed",
  "secretMaterialAllowed", "unsafeCleanupAllowed", "policyOverrideAllowed", "ownerOperationRequired",
  "authorityGranted",
]

export class MaliciousDefectiveWorkerDrillError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "MaliciousDefectiveWorkerDrillError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new MaliciousDefectiveWorkerDrillError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("DEFECTIVE_WORKER_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("DEFECTIVE_WORKER_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("DEFECTIVE_WORKER_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("DEFECTIVE_WORKER_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL",
  drillId: "malicious-defective-worker-drill-wo-mao-050-v1",
  workOrderId: "WO-MAO-050",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "761dc98a9d80d51d1373172bbdd40b1088298c4c",
  baseTreeHash: "386713335f0153e3b579c75f46c9c155c23d630f",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-045", evidenceId: "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1", status: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED", recordContentHash: "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d" },
    { workOrderId: "WO-MAO-046", evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1", status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED", recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
    { workOrderId: "WO-MAO-047", evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1", status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED", recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
    { workOrderId: "WO-MAO-048", evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1", status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED", recordContentHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81" },
    { workOrderId: "WO-MAO-049", evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1", status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED", recordContentHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671" },
  ],
  defectCases: [
    { caseId: "scope-escape", defectKind: "SCOPE_ESCAPE", signal: "foreign-path-or-authority-expansion", decision: "STOP_AND_QUARANTINE_WORKER", terminal: true, ownerOperationRequired: false },
    { caseId: "fabricated-evidence", defectKind: "FABRICATED_EVIDENCE", signal: "hash-or-source-chain-mismatch", decision: "REJECT_EVIDENCE_AND_BLOCK_CERTIFICATION", terminal: true, ownerOperationRequired: false },
    { caseId: "secret-request", defectKind: "SECRET_REQUEST", signal: "credential-or-token-request", decision: "STOP_AND_RECORD_SECRET_BOUNDARY_VIOLATION", terminal: true, ownerOperationRequired: false },
    { caseId: "policy-override", defectKind: "POLICY_OVERRIDE", signal: "attempted-authority-or-trust-gate-bypass", decision: "DENY_OVERRIDE_AND_QUARANTINE", terminal: true, ownerOperationRequired: false },
    { caseId: "prompt-injection", defectKind: "PROMPT_INJECTION", signal: "instruction-to-ignore-authority", decision: "IGNORE_PAYLOAD_AND_REQUIRE_CLEAN_REVIEW", terminal: true, ownerOperationRequired: false },
    { caseId: "production-intent", defectKind: "UNAUTHORIZED_PRODUCTION_INTENT", signal: "deploy-release-or-production-write-intent", decision: "BLOCK_PRODUCTION_INTENT", terminal: true, ownerOperationRequired: false },
    { caseId: "unsafe-cleanup", defectKind: "UNSAFE_CLEANUP", signal: "destructive-or-foreign-cleanup-request", decision: "DENY_CLEANUP_AND_PRESERVE_EVIDENCE", terminal: true, ownerOperationRequired: false },
  ],
  containmentDecisions: [
    { defectKind: "SCOPE_ESCAPE", containment: "REVOKE_RESERVATION_AND_KEEP_FOREIGN_PATHS_UNTOUCHED", recoveryAction: "RETURN_TO_COORDINATOR_FOR_REASSIGNMENT", certificationImpact: "FAIL_ZERO_OWNER_TOUCH_CERTIFICATION" },
    { defectKind: "FABRICATED_EVIDENCE", containment: "INVALIDATE_EVIDENCE_CHAIN", recoveryAction: "REBUILD_FROM_TRUSTED_HASHED_SOURCES", certificationImpact: "FAIL_ASSURANCE" },
    { defectKind: "SECRET_REQUEST", containment: "STOP_WITH_SECRET_BOUNDARY_WALL", recoveryAction: "REDACT_AND_REVIEW_CHANGED_FILES", certificationImpact: "FAIL_SECURITY" },
    { defectKind: "POLICY_OVERRIDE", containment: "DENY_AUTHORITY_MUTATION", recoveryAction: "REQUIRE_INDEPENDENT_ASSURANCE", certificationImpact: "FAIL_POLICY" },
    { defectKind: "PROMPT_INJECTION", containment: "DISCARD_INJECTED_PAYLOAD", recoveryAction: "REPLAY_FROM_CANONICAL_WORK_ORDER", certificationImpact: "FAIL_REVIEW" },
    { defectKind: "UNAUTHORIZED_PRODUCTION_INTENT", containment: "BLOCK_PRODUCTION_PATH", recoveryAction: "RETURN_TO_STATIC_SCOPE", certificationImpact: "FAIL_AUTHORITY" },
    { defectKind: "UNSAFE_CLEANUP", containment: "PRESERVE_WORKTREE_AND_EVIDENCE", recoveryAction: "MANUAL_COORDINATOR_RECONCILIATION_WITHOUT_OWNER_WORK", certificationImpact: "FAIL_CLEANUP" },
  ],
  evidenceRequirements: [
    { requirement: "exact-reservation-match", mode: "HASHED_PATH_SET", failureDecision: "BLOCK_SCOPE_ESCAPE" },
    { requirement: "tamper-evident-evidence-chain", mode: "CONTENT_HASH_VERIFICATION", failureDecision: "BLOCK_FABRICATION" },
    { requirement: "secret-boundary-scan", mode: "NO_SECRET_MATERIAL", failureDecision: "BLOCK_SECRET_REQUEST" },
    { requirement: "policy-authority-match", mode: "TRUST_GATE_VERIFICATION", failureDecision: "BLOCK_POLICY_OVERRIDE" },
    { requirement: "production-intent-denial", mode: "STATIC_SCOPE_ONLY", failureDecision: "BLOCK_PRODUCTION_INTENT" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-defective-worker-registry.ts",
    "docs/reports/WO-MAO-050-malicious-defective-worker-drill.md",
    "scripts/multi-agent-operator/malicious-defective-worker-drill-cli.mjs",
    "scripts/multi-agent-operator/malicious-defective-worker-drill.mjs",
    "tests/multi-agent-malicious-defective-worker-drill.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-defective-worker-registry.ts",
    "docs/reports/WO-MAO-050-malicious-defective-worker-drill.md",
    "scripts/multi-agent-operator/malicious-defective-worker-drill-cli.mjs",
    "scripts/multi-agent-operator/malicious-defective-worker-drill.mjs",
    "tests/multi-agent-malicious-defective-worker-drill.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    secretTrustAuditVerified: true,
    retryIdempotencyVerified: true,
    workerRecoveryVerified: true,
    providerFailoverVerified: true,
    mergeRaceVerified: true,
    authorityScope: "MALICIOUS_DEFECTIVE_WORKER_DRILL_MODEL_ONLY",
  },
  safety: {
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    unsafeCleanupAllowed: false,
    policyOverrideAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "49d29bf5a5c03fb3172021ac61006e3b85aae963372eb08a8893181a8ac9ba17"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("DEFECTIVE_WORKER_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("DEFECTIVE_WORKER_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("DEFECTIVE_WORKER_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 5) wall("DEFECTIVE_WORKER_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-045,WO-MAO-046,WO-MAO-047,WO-MAO-048,WO-MAO-049") wall("DEFECTIVE_WORKER_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("DEFECTIVE_WORKER_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL") wall("DEFECTIVE_WORKER_SCHEMA_WALL", "plan")
  text(plan.drillId, "plan.drillId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-050") wall("DEFECTIVE_WORKER_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.defectCases) || plan.defectCases.length !== 7) wall("DEFECTIVE_WORKER_CASE_WALL", "defectCases")
  const defectKinds = []
  for (const [index, defect] of plan.defectCases.entries()) {
    exact(defect, DEFECT_FIELDS, `defectCases[${index}]`)
    text(defect.caseId, `defectCases[${index}].caseId`)
    defectKinds.push(text(defect.defectKind, `defectCases[${index}].defectKind`))
    text(defect.signal, `defectCases[${index}].signal`)
    text(defect.decision, `defectCases[${index}].decision`)
    if (defect.terminal !== true || defect.ownerOperationRequired !== false) wall("DEFECTIVE_WORKER_CASE_WALL", `defectCases[${index}]`)
  }
  for (const required of ["SCOPE_ESCAPE", "FABRICATED_EVIDENCE", "SECRET_REQUEST", "POLICY_OVERRIDE", "PROMPT_INJECTION", "UNAUTHORIZED_PRODUCTION_INTENT", "UNSAFE_CLEANUP"]) {
    if (!defectKinds.includes(required)) wall("DEFECTIVE_WORKER_CASE_WALL", "defectCases", `${required}_REQUIRED`)
  }
  if (!Array.isArray(plan.containmentDecisions) || plan.containmentDecisions.length !== 7) wall("DEFECTIVE_WORKER_CONTAINMENT_WALL", "containmentDecisions")
  for (const [index, decision] of plan.containmentDecisions.entries()) {
    exact(decision, CONTAINMENT_FIELDS, `containmentDecisions[${index}]`)
    text(decision.defectKind, `containmentDecisions[${index}].defectKind`)
    text(decision.containment, `containmentDecisions[${index}].containment`)
    text(decision.recoveryAction, `containmentDecisions[${index}].recoveryAction`)
    text(decision.certificationImpact, `containmentDecisions[${index}].certificationImpact`)
  }
  if (!Array.isArray(plan.evidenceRequirements) || plan.evidenceRequirements.length !== 5) wall("DEFECTIVE_WORKER_EVIDENCE_WALL", "evidenceRequirements")
  for (const [index, requirement] of plan.evidenceRequirements.entries()) {
    exact(requirement, EVIDENCE_REQ_FIELDS, `evidenceRequirements[${index}]`)
    text(requirement.requirement, `evidenceRequirements[${index}].requirement`)
    text(requirement.mode, `evidenceRequirements[${index}].mode`)
    text(requirement.failureDecision, `evidenceRequirements[${index}].failureDecision`)
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("DEFECTIVE_WORKER_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("DEFECTIVE_WORKER_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("DEFECTIVE_WORKER_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.secretTrustAuditVerified !== true
    || plan.authority.retryIdempotencyVerified !== true
    || plan.authority.workerRecoveryVerified !== true
    || plan.authority.providerFailoverVerified !== true
    || plan.authority.mergeRaceVerified !== true
    || plan.authority.authorityScope !== "MALICIOUS_DEFECTIVE_WORKER_DRILL_MODEL_ONLY") wall("DEFECTIVE_WORKER_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("DEFECTIVE_WORKER_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    defectCaseCount: plan.defectCases.length,
    containmentDecisionCount: plan.containmentDecisions.length,
    evidenceRequirementCount: plan.evidenceRequirements.length,
    terminalDefectCount: plan.defectCases.filter((entry) => entry.terminal).length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateMaliciousDefectiveWorkerDrill() {
  wall("DEFECTIVE_WORKER_HOST_TRUST_WALL", "maliciousDefectiveWorkerDrill", "CALLER_SUPPLIED_DEFECT_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalMaliciousDefectiveWorkerDrillPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "MALICIOUS_DEFECTIVE_WORKER_DRILL_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    unsafeCleanupAllowed: false,
    policyOverrideAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalMaliciousDefectiveWorkerDrill() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "MALICIOUS_DEFECTIVE_WORKER_DRILL_RESULT",
    workOrderId: "WO-MAO-050",
    status: "MALICIOUS_DEFECTIVE_WORKER_DRILL_PROVEN",
    drillId: PLAN.drillId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    defectKinds: PLAN.defectCases.map((entry) => entry.defectKind).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_SECRET_RETRY_RECOVERY_FAILOVER_AND_MERGE_RACE_EVIDENCE",
      "CLASSIFY_SCOPE_EVIDENCE_SECRET_POLICY_PROMPT_PRODUCTION_AND_CLEANUP_DEFECTS",
      "STOP_AND_QUARANTINE_DEFECTIVE_WORKER",
      "REJECT_FABRICATED_OR_UNTRUSTED_EVIDENCE",
      "DENY_SECRET_POLICY_PRODUCTION_AND_UNSAFE_CLEANUP_REQUESTS",
      "RECORD_STATIC_DEFECTIVE_WORKER_EVIDENCE_ONLY",
    ],
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    unsafeCleanupAllowed: false,
    policyOverrideAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalMaliciousDefectiveWorkerDrillPlan() { return deepFreeze(deepCopy(PLAN)) }
export function maliciousDefectiveWorkerDrillPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalMaliciousDefectiveWorkerDrillJson(value) { return canonicalJson(value) }
