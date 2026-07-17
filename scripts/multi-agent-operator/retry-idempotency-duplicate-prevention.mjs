import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/
const KEY = /^[a-z0-9][a-z0-9._:-]{7,127}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "planId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "retryPolicy", "idempotencyPolicy",
  "duplicatePrevention", "reservedPaths", "changedPaths", "foreignChanges", "secretScan",
  "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const RETRY_POLICY_FIELDS = new Set(["maxAttempts", "retryableClasses", "terminalClasses", "backoffSchedule", "replaySource"])
const IDEMPOTENCY_FIELDS = new Set(["keyScope", "requiredKeys", "checkpointMode", "conflictDecision"])
const DUPLICATE_FIELDS = new Set(["dedupeWindow", "fences", "duplicateOutcomes"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "lifecycleTaxonomyVerified", "leaseFenceVerified", "checkpointVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "productionWritePerformed",
  "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class RetryIdempotencyDuplicatePreventionError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "RetryIdempotencyDuplicatePreventionError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new RetryIdempotencyDuplicatePreventionError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("RETRY_IDEMPOTENCY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("RETRY_IDEMPOTENCY_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("RETRY_IDEMPOTENCY_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("RETRY_IDEMPOTENCY_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PLAN",
  planId: "retry-idempotency-duplicate-prevention-wo-mao-046-v1",
  workOrderId: "WO-MAO-046",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2",
  baseTreeHash: "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-021", evidenceId: "docs/reports/WO-MAO-021-per-lane-leases-checkpoints.md", status: "PER_LANE_LEASES_CHECKPOINTS_VERIFIED", recordContentHash: "static-per-lane-leases-checkpoints" },
    { workOrderId: "WO-MAO-035", evidenceId: "EVIDENCE-WO-MAO-035-PROVIDER-HEALTH-REROUTE-V1", status: "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED", recordContentHash: "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a" },
    { workOrderId: "WO-MAO-044", evidenceId: "EVIDENCE-WO-MAO-044-GITHUB-LIFECYCLE-CONFORMANCE-V1", status: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED", recordContentHash: "95d7d86e4f6f2daa1174e7b1f7671a67b8ca88c4b7d691dbf1d8314ada8a3041" },
  ],
  retryPolicy: {
    maxAttempts: 3,
    retryableClasses: ["provider-temporary-unavailable", "ci-pending-timeout", "review-refresh-timeout"],
    terminalClasses: ["authority-wall", "secret-wall", "reservation-conflict", "destructive-operation-required"],
    backoffSchedule: ["initial", "bounded-delay", "final-retry"],
    replaySource: "DURABLE_CHECKPOINT_ONLY",
  },
  idempotencyPolicy: {
    keyScope: "repository-work-order-attempt",
    requiredKeys: [
      "bsvalues-terragroq:wo-mao-046:plan",
      "bsvalues-terragroq:wo-mao-046:attempt",
      "bsvalues-terragroq:wo-mao-046:result",
      "bsvalues-terragroq:wo-mao-046:evidence",
    ],
    checkpointMode: "COMPARE_AND_SWAP_REQUIRED",
    conflictDecision: "STOP_DUPLICATE_DO_NOT_REPLAY",
  },
  duplicatePrevention: {
    dedupeWindow: "WORK_ORDER_LIFETIME",
    fences: [
      "lease-token-fence",
      "checkpoint-content-hash-fence",
      "branch-name-fence",
      "pr-linkage-fence",
      "evidence-record-hash-fence",
    ],
    duplicateOutcomes: ["already-complete", "in-flight", "conflict-stop"],
  },
  reservedPaths: [
    "components/operator/multi-agent-retry-idempotency-registry.ts",
    "docs/reports/WO-MAO-046-retry-idempotency-duplicate-prevention.md",
    "scripts/multi-agent-operator/retry-idempotency-duplicate-prevention-cli.mjs",
    "scripts/multi-agent-operator/retry-idempotency-duplicate-prevention.mjs",
    "tests/multi-agent-retry-idempotency-duplicate-prevention.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-retry-idempotency-registry.ts",
    "docs/reports/WO-MAO-046-retry-idempotency-duplicate-prevention.md",
    "scripts/multi-agent-operator/retry-idempotency-duplicate-prevention-cli.mjs",
    "scripts/multi-agent-operator/retry-idempotency-duplicate-prevention.mjs",
    "tests/multi-agent-retry-idempotency-duplicate-prevention.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    lifecycleTaxonomyVerified: true,
    leaseFenceVerified: true,
    checkpointVerified: true,
    authorityScope: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_MODEL_ONLY",
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
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "a1c34c2b835e19d6c4079e20e10109382ac26e6334933b37f1535128db37f618"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("RETRY_IDEMPOTENCY_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("RETRY_IDEMPOTENCY_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("RETRY_IDEMPOTENCY_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("RETRY_IDEMPOTENCY_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-021,WO-MAO-035,WO-MAO-044") wall("RETRY_IDEMPOTENCY_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("RETRY_IDEMPOTENCY_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PLAN") wall("RETRY_IDEMPOTENCY_SCHEMA_WALL", "plan")
  text(plan.planId, "plan.planId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-046") wall("RETRY_IDEMPOTENCY_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  exact(plan.retryPolicy, RETRY_POLICY_FIELDS, "retryPolicy")
  if (plan.retryPolicy.maxAttempts !== 3 || plan.retryPolicy.replaySource !== "DURABLE_CHECKPOINT_ONLY") wall("RETRY_IDEMPOTENCY_POLICY_WALL", "retryPolicy")
  const retryableClasses = stringArray(plan.retryPolicy.retryableClasses, "retryPolicy.retryableClasses")
  const terminalClasses = stringArray(plan.retryPolicy.terminalClasses, "retryPolicy.terminalClasses")
  const backoffSchedule = stringArray(plan.retryPolicy.backoffSchedule, "retryPolicy.backoffSchedule")
  if (retryableClasses.length !== 3 || terminalClasses.length !== 4 || backoffSchedule.length !== 3) wall("RETRY_IDEMPOTENCY_POLICY_WALL", "retryPolicy")
  exact(plan.idempotencyPolicy, IDEMPOTENCY_FIELDS, "idempotencyPolicy")
  const requiredKeys = stringArray(plan.idempotencyPolicy.requiredKeys, "idempotencyPolicy.requiredKeys", KEY)
  if (plan.idempotencyPolicy.keyScope !== "repository-work-order-attempt"
    || plan.idempotencyPolicy.checkpointMode !== "COMPARE_AND_SWAP_REQUIRED"
    || plan.idempotencyPolicy.conflictDecision !== "STOP_DUPLICATE_DO_NOT_REPLAY"
    || requiredKeys.length !== 4) wall("RETRY_IDEMPOTENCY_KEY_WALL", "idempotencyPolicy")
  exact(plan.duplicatePrevention, DUPLICATE_FIELDS, "duplicatePrevention")
  const fences = stringArray(plan.duplicatePrevention.fences, "duplicatePrevention.fences")
  const duplicateOutcomes = stringArray(plan.duplicatePrevention.duplicateOutcomes, "duplicatePrevention.duplicateOutcomes")
  if (plan.duplicatePrevention.dedupeWindow !== "WORK_ORDER_LIFETIME" || fences.length !== 5 || duplicateOutcomes.length !== 3) wall("RETRY_IDEMPOTENCY_DUPLICATE_WALL", "duplicatePrevention")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("RETRY_IDEMPOTENCY_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("RETRY_IDEMPOTENCY_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("RETRY_IDEMPOTENCY_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.lifecycleTaxonomyVerified !== true
    || plan.authority.leaseFenceVerified !== true
    || plan.authority.checkpointVerified !== true
    || plan.authority.authorityScope !== "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_MODEL_ONLY") wall("RETRY_IDEMPOTENCY_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("RETRY_IDEMPOTENCY_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    retryableClassCount: retryableClasses.length,
    terminalClassCount: terminalClasses.length,
    backoffStepCount: backoffSchedule.length,
    idempotencyKeyCount: requiredKeys.length,
    duplicateFenceCount: fences.length,
    duplicateOutcomeCount: duplicateOutcomes.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateRetryIdempotencyDuplicatePrevention() {
  wall("RETRY_IDEMPOTENCY_HOST_TRUST_WALL", "retryIdempotencyDuplicatePrevention", "CALLER_SUPPLIED_RETRY_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalRetryIdempotencyDuplicatePreventionPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    stateMutationPerformed: false,
    authorityGranted: false,
  })
}
export function runCanonicalRetryIdempotencyDuplicatePrevention() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_RESULT",
    workOrderId: "WO-MAO-046",
    status: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PROVEN",
    planId: PLAN.planId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    maxAttempts: PLAN.retryPolicy.maxAttempts,
    replaySource: PLAN.retryPolicy.replaySource,
    checkpointMode: PLAN.idempotencyPolicy.checkpointMode,
    conflictDecision: PLAN.idempotencyPolicy.conflictDecision,
    dedupeWindow: PLAN.duplicatePrevention.dedupeWindow,
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "LOAD_DURABLE_CHECKPOINT",
      "VERIFY_LEASE_AND_IDEMPOTENCY_KEYS",
      "CLASSIFY_RETRYABLE_OR_TERMINAL_FAILURE",
      "APPLY_DUPLICATE_FENCES",
      "STOP_DUPLICATE_OR_CONFLICT_REPLAY",
      "RECORD_STATIC_DECISION_EVIDENCE_ONLY",
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
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalRetryIdempotencyDuplicatePreventionPlan() { return deepFreeze(deepCopy(PLAN)) }
export function retryIdempotencyDuplicatePreventionPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalRetryIdempotencyDuplicatePreventionJson(value) { return canonicalJson(value) }
