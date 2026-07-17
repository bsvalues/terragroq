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
  "schemaVersion", "artifactType", "rollupId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "phase", "dependencyEvidence", "resilienceClaims",
  "safetyClaims", "certificationReadiness", "reservedPaths", "changedPaths",
  "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const CLAIM_FIELDS = new Set(["claimId", "sourceWorkOrderId", "status", "evidenceHash"])
const READINESS_FIELDS = new Set(["downstreamWorkOrderId", "downstreamState", "phase", "reason"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "verifiedDependencyCount", "certificationAuthorityGranted"])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed", "productionWritePerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class ResilienceSafetyRollupError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "ResilienceSafetyRollupError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new ResilienceSafetyRollupError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("RESILIENCE_SAFETY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("RESILIENCE_SAFETY_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("RESILIENCE_SAFETY_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("RESILIENCE_SAFETY_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_RESILIENCE_SAFETY_ROLLUP",
  rollupId: "resilience-safety-rollup-wo-mao-053-v1",
  workOrderId: "WO-MAO-053",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "2d85063c0fc36ff270af7bd5da85009e7050b995",
  baseTreeHash: "1d81231f9a148d277f4c972e8b315ee60296bf96",
  phase: 6,
  dependencyEvidence: [
    { workOrderId: "WO-MAO-045", evidenceId: "EVIDENCE-WO-MAO-045-INDEPENDENT-SECRET-IDENTITY-TRUST-AUDIT-V1", status: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_VERIFIED", recordContentHash: "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d" },
    { workOrderId: "WO-MAO-046", evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1", status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED", recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
    { workOrderId: "WO-MAO-047", evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1", status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED", recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
    { workOrderId: "WO-MAO-048", evidenceId: "EVIDENCE-WO-MAO-048-PROVIDER-OUTAGE-FAILOVER-DRILL-V1", status: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL_VERIFIED", recordContentHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81" },
    { workOrderId: "WO-MAO-049", evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1", status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED", recordContentHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671" },
    { workOrderId: "WO-MAO-050", evidenceId: "EVIDENCE-WO-MAO-050-MALICIOUS-DEFECTIVE-WORKER-DRILL-V1", status: "CANONICAL_MALICIOUS_DEFECTIVE_WORKER_DRILL_VERIFIED", recordContentHash: "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75" },
    { workOrderId: "WO-MAO-051", evidenceId: "EVIDENCE-WO-MAO-051-STATUS-EVIDENCE-OWNER-DECISION-UX-V1", status: "CANONICAL_STATUS_EVIDENCE_OWNER_DECISION_UX_VERIFIED", recordContentHash: "6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77" },
    { workOrderId: "WO-MAO-052", evidenceId: "EVIDENCE-WO-MAO-052-KILL-REVOKE-ROLLBACK-INCIDENT-PROCEDURE-V1", status: "CANONICAL_KILL_REVOKE_ROLLBACK_INCIDENT_PROCEDURE_VERIFIED", recordContentHash: "e3a60ca23bafaff20d33304fdc965600e000f0245822416cb560b46829075b45" },
  ],
  resilienceClaims: [
    { claimId: "secret-identity-boundary", sourceWorkOrderId: "WO-MAO-045", status: "VERIFIED", evidenceHash: "2850c0c9690a32c2a8454c389473f94d63ba30be3bbea6f90108fa067d34828d" },
    { claimId: "retry-idempotency-duplicate-prevention", sourceWorkOrderId: "WO-MAO-046", status: "VERIFIED", evidenceHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
    { claimId: "worker-coordinator-recovery", sourceWorkOrderId: "WO-MAO-047", status: "VERIFIED", evidenceHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
    { claimId: "provider-outage-failover", sourceWorkOrderId: "WO-MAO-048", status: "VERIFIED", evidenceHash: "b643e368e34839a37001a383783f61a39f749500bd3f6b717f9eace530276f81" },
    { claimId: "merge-race-stale-base-handling", sourceWorkOrderId: "WO-MAO-049", status: "VERIFIED", evidenceHash: "bd60b180b454fef0288e61e9452a81bcc63dbda0c5e826c30162adad8e672671" },
    { claimId: "defective-worker-containment", sourceWorkOrderId: "WO-MAO-050", status: "VERIFIED", evidenceHash: "7d4074079923473efe6f89aab7c7ea76a09a0013c44c9652ee35e2dde521da75" },
  ],
  safetyClaims: [
    { claimId: "owner-decision-ux", sourceWorkOrderId: "WO-MAO-051", status: "VERIFIED", evidenceHash: "6d3e2279b02f2a50bde868c2494ea20acfef06485c01b6f52dff24c0fff97d77" },
    { claimId: "incident-procedure", sourceWorkOrderId: "WO-MAO-052", status: "VERIFIED", evidenceHash: "e3a60ca23bafaff20d33304fdc965600e000f0245822416cb560b46829075b45" },
  ],
  certificationReadiness: {
    downstreamWorkOrderId: "WO-MAO-054",
    downstreamState: "READY_AFTER_RESILIENCE_SAFETY_ROLLUP",
    phase: 7,
    reason: "PHASE_SIX_RESILIENCE_AND_SAFETY_EVIDENCE_COMPLETE",
  },
  reservedPaths: [
    "components/operator/multi-agent-resilience-safety-rollup-registry.ts",
    "docs/reports/WO-MAO-053-resilience-safety-rollup.md",
    "scripts/multi-agent-operator/resilience-safety-rollup-cli.mjs",
    "scripts/multi-agent-operator/resilience-safety-rollup.mjs",
    "tests/multi-agent-resilience-safety-rollup.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-resilience-safety-rollup-registry.ts",
    "docs/reports/WO-MAO-053-resilience-safety-rollup.md",
    "scripts/multi-agent-operator/resilience-safety-rollup-cli.mjs",
    "scripts/multi-agent-operator/resilience-safety-rollup.mjs",
    "tests/multi-agent-resilience-safety-rollup.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "RESILIENCE_SAFETY_ROLLUP_MODEL_ONLY",
    verifiedDependencyCount: 8,
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

const PLAN_HASH = "8b2747a827fd13b29051704e430150e9bd2c0883ff460a4d23da9fb3748bfa7f"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("RESILIENCE_SAFETY_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("RESILIENCE_SAFETY_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("RESILIENCE_SAFETY_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 8) wall("RESILIENCE_SAFETY_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-045,WO-MAO-046,WO-MAO-047,WO-MAO-048,WO-MAO-049,WO-MAO-050,WO-MAO-051,WO-MAO-052") wall("RESILIENCE_SAFETY_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validateClaims(value, field, count) {
  if (!Array.isArray(value) || value.length !== count) wall("RESILIENCE_SAFETY_CLAIM_WALL", field)
  const ids = value.map((claim, index) => {
    exact(claim, CLAIM_FIELDS, `${field}[${index}]`)
    text(claim.claimId, `${field}[${index}].claimId`)
    text(claim.sourceWorkOrderId, `${field}[${index}].sourceWorkOrderId`, WO)
    if (claim.status !== "VERIFIED") wall("RESILIENCE_SAFETY_CLAIM_WALL", `${field}[${index}].status`)
    text(claim.evidenceHash, `${field}[${index}].evidenceHash`, HASH64)
    return claim.claimId
  })
  if (new Set(ids).size !== ids.length) wall("RESILIENCE_SAFETY_DUPLICATE_WALL", field)
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("RESILIENCE_SAFETY_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_RESILIENCE_SAFETY_ROLLUP") wall("RESILIENCE_SAFETY_SCHEMA_WALL", "plan")
  text(plan.rollupId, "plan.rollupId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-053") wall("RESILIENCE_SAFETY_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  if (plan.phase !== 6) wall("RESILIENCE_SAFETY_PHASE_WALL", "plan.phase")
  validateDependencies(plan.dependencyEvidence)
  validateClaims(plan.resilienceClaims, "resilienceClaims", 6)
  validateClaims(plan.safetyClaims, "safetyClaims", 2)
  exact(plan.certificationReadiness, READINESS_FIELDS, "certificationReadiness")
  if (plan.certificationReadiness.downstreamWorkOrderId !== "WO-MAO-054"
    || plan.certificationReadiness.downstreamState !== "READY_AFTER_RESILIENCE_SAFETY_ROLLUP"
    || plan.certificationReadiness.phase !== 7) wall("RESILIENCE_SAFETY_DOWNSTREAM_WALL", "certificationReadiness")
  text(plan.certificationReadiness.reason, "certificationReadiness.reason")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("RESILIENCE_SAFETY_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("RESILIENCE_SAFETY_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("RESILIENCE_SAFETY_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "RESILIENCE_SAFETY_ROLLUP_MODEL_ONLY"
    || plan.authority.verifiedDependencyCount !== 8
    || plan.authority.certificationAuthorityGranted !== false) wall("RESILIENCE_SAFETY_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("RESILIENCE_SAFETY_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    resilienceClaimCount: plan.resilienceClaims.length,
    safetyClaimCount: plan.safetyClaims.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateResilienceSafetyRollup() {
  wall("RESILIENCE_SAFETY_HOST_TRUST_WALL", "resilienceSafetyRollup", "CALLER_SUPPLIED_ROLLUP_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalResilienceSafetyRollup(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "RESILIENCE_SAFETY_ROLLUP_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalResilienceSafetyRollup() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "RESILIENCE_SAFETY_ROLLUP_RESULT",
    workOrderId: "WO-MAO-053",
    status: "RESILIENCE_SAFETY_ROLLUP_PROVEN",
    rollupId: PLAN.rollupId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    downstreamWorkOrderId: PLAN.certificationReadiness.downstreamWorkOrderId,
    downstreamState: PLAN.certificationReadiness.downstreamState,
    orderedOperations: [
      "VERIFY_PHASE_SIX_DEPENDENCY_EVIDENCE",
      "ROLL_UP_SECRET_IDENTITY_RETRY_RECOVERY_FAILOVER_RACE_DEFECT_AND_INCIDENT_PROOFS",
      "ASSERT_ZERO_OWNER_TOUCH_AND_ZERO_RUNTIME_MUTATION",
      "RELEASE_PHASE_SEVEN_CERTIFICATION_PORTFOLIO_SELECTION",
      "RECORD_STATIC_RESILIENCE_SAFETY_EVIDENCE_ONLY",
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
export function loadCanonicalResilienceSafetyRollup() { return deepFreeze(deepCopy(PLAN)) }
export function resilienceSafetyRollupPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalResilienceSafetyRollupJson(value) { return canonicalJson(value) }
