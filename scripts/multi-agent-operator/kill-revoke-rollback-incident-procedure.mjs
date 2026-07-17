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
  "schemaVersion", "artifactType", "procedureId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "incidentClasses", "procedureSteps",
  "rollbackRules", "ownerDecisionRules", "reservedPaths", "changedPaths", "foreignChanges",
  "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const INCIDENT_FIELDS = new Set(["classId", "trigger", "classification", "terminal", "ownerDecisionRequired"])
const STEP_FIELDS = new Set(["stepId", "action", "allowed", "effect"])
const ROLLBACK_FIELDS = new Set(["ruleId", "scope", "decision"])
const OWNER_RULE_FIELDS = new Set(["ruleId", "condition", "ownerContact"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set([
  "activeProgramGrant", "secretTrustAuditVerified", "retryIdempotencyVerified",
  "workerRecoveryVerified", "providerFailoverVerified", "mergeRaceVerified",
  "defectiveWorkerDrillVerified", "statusUxVerified", "authorityScope",
])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "revokeExecuted",
  "rollbackExecuted", "cleanupExecuted", "productionWritePerformed", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed", "secretMaterialAllowed",
  "ownerOperationRequired", "authorityGranted",
]

export class IncidentProcedureError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "IncidentProcedureError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new IncidentProcedureError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("INCIDENT_PROCEDURE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("INCIDENT_PROCEDURE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("INCIDENT_PROCEDURE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("INCIDENT_PROCEDURE_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE",
  procedureId: "kill-revoke-rollback-incident-procedure-wo-mao-052-v1",
  workOrderId: "WO-MAO-052",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "8de0b73bcfd13055de7d3ffc86bc42a1a178f0a1",
  baseTreeHash: "3310d65b8bc96f57c78cd660b4f715eefddee335",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-045", evidenceId: "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1", status: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED", recordContentHash: "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d" },
    { workOrderId: "WO-MAO-046", evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1", status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED", recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
    { workOrderId: "WO-MAO-047", evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1", status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED", recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
    { workOrderId: "WO-MAO-048", evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1", status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED", recordContentHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81" },
    { workOrderId: "WO-MAO-049", evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1", status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED", recordContentHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671" },
    { workOrderId: "WO-MAO-050", evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1", status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED", recordContentHash: "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75" },
    { workOrderId: "WO-MAO-051", evidenceId: "EVIDENCE-WO-MAO-051-STATUS-EVIDENCE-OWNER-DECISION-UX-V1", status: "CANONICAL_STATUS_EVIDENCE_OWNER_DECISION_UX_VERIFIED", recordContentHash: "6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77" },
  ],
  incidentClasses: [
    { classId: "defective-worker", trigger: "scope-evidence-policy-or-prompt-defect", classification: "QUARANTINE_WORKER", terminal: true, ownerDecisionRequired: false },
    { classId: "provider-authority", trigger: "provider-auth-or-trust-boundary-failure", classification: "QUARANTINE_PROVIDER", terminal: true, ownerDecisionRequired: false },
    { classId: "secret-exposure-suspected", trigger: "secret-like-material-or-credential-request", classification: "STOP_AND_PRESERVE_EVIDENCE", terminal: true, ownerDecisionRequired: false },
    { classId: "merge-rollback", trigger: "owned-branch-or-merged-change-needs-reversal", classification: "ROLLBACK_ONLY_OWNED_CHANGES", terminal: true, ownerDecisionRequired: false },
    { classId: "unsafe-cleanup", trigger: "foreign-or-destructive-cleanup-request", classification: "DENY_CLEANUP", terminal: true, ownerDecisionRequired: false },
    { classId: "protected-authority-wall", trigger: "new-protected-authority-required", classification: "OWNER_DECISION_PACKET_ONLY", terminal: true, ownerDecisionRequired: true },
  ],
  procedureSteps: [
    { stepId: "quarantine-worker", action: "MARK_WORKER_QUARANTINED_IN_EVIDENCE", allowed: true, effect: "STATIC_RECORD_ONLY" },
    { stepId: "quarantine-provider", action: "MARK_PROVIDER_QUARANTINED_IN_EVIDENCE", allowed: true, effect: "STATIC_RECORD_ONLY" },
    { stepId: "cancel-lease", action: "MODEL_LEASE_CANCELLATION_DECISION", allowed: true, effect: "NO_RUNTIME_LEASE_MUTATION" },
    { stepId: "preserve-checkpoint", action: "REQUIRE_CHECKPOINT_AND_EVIDENCE_PRESERVATION", allowed: true, effect: "NO_FILESYSTEM_CLEANUP" },
    { stepId: "rollback-owned-only", action: "MODEL_OWNED_CHANGE_ROLLBACK_PATH", allowed: true, effect: "NO_GIT_MUTATION" },
    { stepId: "continue-healthy-lanes", action: "RELEASE_ONLY_UNAFFECTED_DEPENDENCY_CLEARED_LANES", allowed: true, effect: "STATIC_RELEASE_DECISION_ONLY" },
  ],
  rollbackRules: [
    { ruleId: "owned-paths-only", scope: "RESERVED_AND_COMMITTED_BY_AFFECTED_LANE", decision: "ROLLBACK_ELIGIBLE_AFTER_REVIEW" },
    { ruleId: "foreign-paths", scope: "OUTSIDE_RESERVATION_OR_UNATTRIBUTED", decision: "ROLLBACK_PROHIBITED" },
    { ruleId: "dirty-worktree", scope: "UNCOMMITTED_OR_UNATTRIBUTED_STATE", decision: "PRESERVE_AND_BLOCK_CLEANUP" },
    { ruleId: "production-state", scope: "PRODUCTION_OR_PROTECTED_SYSTEM", decision: "OWNER_AUTHORITY_REQUIRED" },
  ],
  ownerDecisionRules: [
    { ruleId: "routine-incident", condition: "WITHIN_EXISTING_AUTHORITY_AND_NO_SECRET_EXPOSURE", ownerContact: "PROHIBITED" },
    { ruleId: "protected-authority", condition: "NEW_AUTHORITY_OR_PRODUCTION_SCOPE_REQUIRED", ownerContact: "OWNER_DECISION_PACKET_ONLY" },
    { ruleId: "credential-or-secret", condition: "OWNER_HELD_SECRET_ACTION_REQUIRED", ownerContact: "OWNER_CREDENTIAL_GATE_ONLY" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-incident-procedure-registry.ts",
    "docs/reports/WO-MAO-052-kill-revoke-rollback-incident-procedure.md",
    "scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure-cli.mjs",
    "scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure.mjs",
    "tests/multi-agent-kill-revoke-rollback-incident-procedure.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-incident-procedure-registry.ts",
    "docs/reports/WO-MAO-052-kill-revoke-rollback-incident-procedure.md",
    "scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure-cli.mjs",
    "scripts/multi-agent-operator/kill-revoke-rollback-incident-procedure.mjs",
    "tests/multi-agent-kill-revoke-rollback-incident-procedure.test.ts",
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
    defectiveWorkerDrillVerified: true,
    statusUxVerified: true,
    authorityScope: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_MODEL_ONLY",
  },
  safety: {
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    revokeExecuted: false,
    rollbackExecuted: false,
    cleanupExecuted: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "20eb61ed04b933c8a6fed6be377130eff40eb5dc6f2a74ee27a6b4f52a926e5c"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("INCIDENT_PROCEDURE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("INCIDENT_PROCEDURE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("INCIDENT_PROCEDURE_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 7) wall("INCIDENT_PROCEDURE_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-045,WO-MAO-046,WO-MAO-047,WO-MAO-048,WO-MAO-049,WO-MAO-050,WO-MAO-051") wall("INCIDENT_PROCEDURE_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("INCIDENT_PROCEDURE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE") wall("INCIDENT_PROCEDURE_SCHEMA_WALL", "plan")
  text(plan.procedureId, "plan.procedureId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-052") wall("INCIDENT_PROCEDURE_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.incidentClasses) || plan.incidentClasses.length !== 6) wall("INCIDENT_PROCEDURE_CLASS_WALL", "incidentClasses")
  for (const [index, incident] of plan.incidentClasses.entries()) {
    exact(incident, INCIDENT_FIELDS, `incidentClasses[${index}]`)
    text(incident.classId, `incidentClasses[${index}].classId`)
    text(incident.trigger, `incidentClasses[${index}].trigger`)
    text(incident.classification, `incidentClasses[${index}].classification`)
    if (incident.terminal !== true || typeof incident.ownerDecisionRequired !== "boolean") wall("INCIDENT_PROCEDURE_CLASS_WALL", `incidentClasses[${index}]`)
  }
  if (plan.incidentClasses.filter((entry) => entry.ownerDecisionRequired).length !== 1) wall("INCIDENT_PROCEDURE_OWNER_WALL", "incidentClasses")
  if (!Array.isArray(plan.procedureSteps) || plan.procedureSteps.length !== 6) wall("INCIDENT_PROCEDURE_STEP_WALL", "procedureSteps")
  for (const [index, step] of plan.procedureSteps.entries()) {
    exact(step, STEP_FIELDS, `procedureSteps[${index}]`)
    text(step.stepId, `procedureSteps[${index}].stepId`)
    text(step.action, `procedureSteps[${index}].action`)
    if (step.allowed !== true) wall("INCIDENT_PROCEDURE_STEP_WALL", `procedureSteps[${index}].allowed`)
    text(step.effect, `procedureSteps[${index}].effect`)
  }
  if (!Array.isArray(plan.rollbackRules) || plan.rollbackRules.length !== 4) wall("INCIDENT_PROCEDURE_ROLLBACK_WALL", "rollbackRules")
  for (const [index, rule] of plan.rollbackRules.entries()) {
    exact(rule, ROLLBACK_FIELDS, `rollbackRules[${index}]`)
    text(rule.ruleId, `rollbackRules[${index}].ruleId`)
    text(rule.scope, `rollbackRules[${index}].scope`)
    text(rule.decision, `rollbackRules[${index}].decision`)
  }
  if (!Array.isArray(plan.ownerDecisionRules) || plan.ownerDecisionRules.length !== 3) wall("INCIDENT_PROCEDURE_OWNER_RULE_WALL", "ownerDecisionRules")
  for (const [index, rule] of plan.ownerDecisionRules.entries()) {
    exact(rule, OWNER_RULE_FIELDS, `ownerDecisionRules[${index}]`)
    text(rule.ruleId, `ownerDecisionRules[${index}].ruleId`)
    text(rule.condition, `ownerDecisionRules[${index}].condition`)
    text(rule.ownerContact, `ownerDecisionRules[${index}].ownerContact`)
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("INCIDENT_PROCEDURE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("INCIDENT_PROCEDURE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("INCIDENT_PROCEDURE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_MODEL_ONLY"
    || Object.entries(plan.authority).some(([key, value]) => key.endsWith("Verified") && value !== true)) wall("INCIDENT_PROCEDURE_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("INCIDENT_PROCEDURE_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    incidentClassCount: plan.incidentClasses.length,
    procedureStepCount: plan.procedureSteps.length,
    rollbackRuleCount: plan.rollbackRules.length,
    ownerDecisionRuleCount: plan.ownerDecisionRules.length,
    ownerDecisionRequiredClassCount: plan.incidentClasses.filter((entry) => entry.ownerDecisionRequired).length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateKillRevokeRollbackIncidentProcedure() {
  wall("INCIDENT_PROCEDURE_HOST_TRUST_WALL", "incidentProcedure", "CALLER_SUPPLIED_INCIDENT_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalKillRevokeRollbackIncidentProcedure(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    revokeExecuted: false,
    rollbackExecuted: false,
    cleanupExecuted: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalKillRevokeRollbackIncidentProcedure() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_RESULT",
    workOrderId: "WO-MAO-052",
    status: "KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_PROVEN",
    procedureId: PLAN.procedureId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    incidentClassifications: PLAN.incidentClasses.map((entry) => entry.classification).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_PHASE_SIX_DEPENDENCY_EVIDENCE",
      "CLASSIFY_WORKER_PROVIDER_SECRET_ROLLBACK_CLEANUP_AND_AUTHORITY_INCIDENTS",
      "MODEL_QUARANTINE_REVOKE_CHECKPOINT_AND_OWNED_ROLLBACK_DECISIONS",
      "DENY_FOREIGN_CLEANUP_PRODUCTION_MUTATION_AND_AUTHORITY_BYPASS",
      "CONTINUE_ONLY_UNAFFECTED_DEPENDENCY_CLEARED_LANES",
      "RECORD_STATIC_INCIDENT_PROCEDURE_EVIDENCE_ONLY",
    ],
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    revokeExecuted: false,
    rollbackExecuted: false,
    cleanupExecuted: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalKillRevokeRollbackIncidentProcedure() { return deepFreeze(deepCopy(PLAN)) }
export function killRevokeRollbackIncidentProcedurePlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalKillRevokeRollbackIncidentProcedureJson(value) { return canonicalJson(value) }
