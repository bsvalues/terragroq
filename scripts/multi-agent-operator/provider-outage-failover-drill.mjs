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
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "outageCases", "failoverDecisions",
  "quarantineRules", "budgets", "reservedPaths", "changedPaths", "foreignChanges", "secretScan",
  "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const OUTAGE_FIELDS = new Set(["caseId", "failureKind", "signal", "classification", "retryable", "ownerDiagnosticsRequired"])
const FAILOVER_FIELDS = new Set(["classification", "decision", "fallbackProvider", "terminalIfNoFallback"])
const QUARANTINE_FIELDS = new Set(["classification", "providerState", "resumeCondition"])
const BUDGET_FIELDS = new Set(["maxAttempts", "maxReroutes", "maxBackoffMs", "ownerDiagnosticBudget"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set([
  "activeProgramGrant", "providerHealthVerified", "providerConformanceVerified",
  "retryIdempotencyVerified", "workerRecoveryVerified", "authorityScope",
])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "networkInjectionPerformed", "githubApiCalled",
  "productionWritePerformed", "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded",
  "stateMutationPerformed", "secretMaterialAllowed", "ownerDiagnosticsRequired", "authorityGranted",
]

export class ProviderOutageFailoverDrillError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "ProviderOutageFailoverDrillError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new ProviderOutageFailoverDrillError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("PROVIDER_OUTAGE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("PROVIDER_OUTAGE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("PROVIDER_OUTAGE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("PROVIDER_OUTAGE_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL",
  drillId: "provider-outage-failover-drill-wo-mao-048-v1",
  workOrderId: "WO-MAO-048",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "1379318899672e059959da09b9b1d886243167f4",
  baseTreeHash: "c1a278e9a1183829501ae0c07be2610828526b5a",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-035", evidenceId: "EVIDENCE-WO-MAO-035-PROVIDER-HEALTH-REROUTE-V1", status: "CANONICAL_PROVIDER_HEALTH_REROUTE_VERIFIED", recordContentHash: "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a" },
    { workOrderId: "WO-MAO-036", evidenceId: "EVIDENCE-WO-MAO-036-PROVIDER-CONFORMANCE-SUITE-V1", status: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED", recordContentHash: "3283799cc653436b8a0d35575b08fc344611e3ec289afe8ca90e5de1db295f80" },
    { workOrderId: "WO-MAO-046", evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1", status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED", recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
    { workOrderId: "WO-MAO-047", evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1", status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED", recordContentHash: "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667" },
  ],
  outageCases: [
    { caseId: "network-wall", failureKind: "NETWORK", signal: "transport-unreachable", classification: "TRANSIENT_REROUTABLE", retryable: true, ownerDiagnosticsRequired: false },
    { caseId: "auth-401", failureKind: "HTTP_401", signal: "unauthorized", classification: "AUTHORITY_QUARANTINE", retryable: false, ownerDiagnosticsRequired: false },
    { caseId: "auth-403", failureKind: "HTTP_403", signal: "forbidden", classification: "AUTHORITY_QUARANTINE", retryable: false, ownerDiagnosticsRequired: false },
    { caseId: "rate-limit-429", failureKind: "HTTP_429", signal: "rate-limited", classification: "BOUNDED_RETRY_REROUTABLE", retryable: true, ownerDiagnosticsRequired: false },
    { caseId: "provider-5xx", failureKind: "HTTP_5XX", signal: "server-error", classification: "TRANSIENT_REROUTABLE", retryable: true, ownerDiagnosticsRequired: false },
    { caseId: "timeout", failureKind: "TIMEOUT", signal: "deadline-exceeded", classification: "BOUNDED_RETRY_REROUTABLE", retryable: true, ownerDiagnosticsRequired: false },
    { caseId: "stream-failure", failureKind: "STREAM_FAILURE", signal: "partial-or-malformed-stream", classification: "QUARANTINE_AND_REPLAY_FROM_CHECKPOINT", retryable: true, ownerDiagnosticsRequired: false },
  ],
  failoverDecisions: [
    { classification: "TRANSIENT_REROUTABLE", decision: "RETRY_THEN_REROUTE", fallbackProvider: "hosted-codex-secondary", terminalIfNoFallback: "BLOCKED_PROVIDER_OUTAGE" },
    { classification: "BOUNDED_RETRY_REROUTABLE", decision: "BOUNDED_RETRY_THEN_REROUTE", fallbackProvider: "hosted-codex-secondary", terminalIfNoFallback: "BLOCKED_PROVIDER_BACKOFF" },
    { classification: "AUTHORITY_QUARANTINE", decision: "QUARANTINE_PROVIDER_AND_STOP", fallbackProvider: "none", terminalIfNoFallback: "BLOCKED_PROVIDER_AUTHORITY" },
    { classification: "QUARANTINE_AND_REPLAY_FROM_CHECKPOINT", decision: "QUARANTINE_STREAM_AND_REPLAY_ON_HEALTHY_PROVIDER", fallbackProvider: "hosted-codex-secondary", terminalIfNoFallback: "BLOCKED_STREAM_AMBIGUITY" },
  ],
  quarantineRules: [
    { classification: "AUTHORITY_QUARANTINE", providerState: "QUARANTINED", resumeCondition: "EXPLICIT_PROVIDER_HEALTH_REPROOF" },
    { classification: "QUARANTINE_AND_REPLAY_FROM_CHECKPOINT", providerState: "QUARANTINED", resumeCondition: "CHECKPOINT_REPLAY_AND_PROVIDER_HEALTH_REPROOF" },
  ],
  budgets: {
    maxAttempts: 3,
    maxReroutes: 1,
    maxBackoffMs: 60000,
    ownerDiagnosticBudget: 0,
  },
  reservedPaths: [
    "components/operator/multi-agent-provider-failover-registry.ts",
    "docs/reports/WO-MAO-048-provider-outage-failover-drill.md",
    "scripts/multi-agent-operator/provider-outage-failover-drill-cli.mjs",
    "scripts/multi-agent-operator/provider-outage-failover-drill.mjs",
    "tests/multi-agent-provider-outage-failover-drill.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-provider-failover-registry.ts",
    "docs/reports/WO-MAO-048-provider-outage-failover-drill.md",
    "scripts/multi-agent-operator/provider-outage-failover-drill-cli.mjs",
    "scripts/multi-agent-operator/provider-outage-failover-drill.mjs",
    "tests/multi-agent-provider-outage-failover-drill.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    providerHealthVerified: true,
    providerConformanceVerified: true,
    retryIdempotencyVerified: true,
    workerRecoveryVerified: true,
    authorityScope: "PROVIDER_OUTAGE_FAILOVER_DRILL_MODEL_ONLY",
  },
  safety: {
    schedulerAdded: false,
    providerExecutionPerformed: false,
    networkInjectionPerformed: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    ownerDiagnosticsRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "54533fcda642c669d7a60663d5f12a67036623e43a3c6d66e4ec5313350a4a76"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("PROVIDER_OUTAGE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("PROVIDER_OUTAGE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("PROVIDER_OUTAGE_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 4) wall("PROVIDER_OUTAGE_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-035,WO-MAO-036,WO-MAO-046,WO-MAO-047") wall("PROVIDER_OUTAGE_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("PROVIDER_OUTAGE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_PROVIDER_OUTAGE_FAILOVER_DRILL") wall("PROVIDER_OUTAGE_SCHEMA_WALL", "plan")
  text(plan.drillId, "plan.drillId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-048") wall("PROVIDER_OUTAGE_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.outageCases) || plan.outageCases.length !== 7) wall("PROVIDER_OUTAGE_CASE_WALL", "outageCases")
  const failureKinds = []
  for (const [index, outage] of plan.outageCases.entries()) {
    exact(outage, OUTAGE_FIELDS, `outageCases[${index}]`)
    text(outage.caseId, `outageCases[${index}].caseId`)
    failureKinds.push(text(outage.failureKind, `outageCases[${index}].failureKind`))
    text(outage.signal, `outageCases[${index}].signal`)
    text(outage.classification, `outageCases[${index}].classification`)
    if (typeof outage.retryable !== "boolean" || outage.ownerDiagnosticsRequired !== false) wall("PROVIDER_OUTAGE_CASE_WALL", `outageCases[${index}]`)
  }
  for (const required of ["NETWORK", "HTTP_401", "HTTP_403", "HTTP_429", "HTTP_5XX", "TIMEOUT", "STREAM_FAILURE"]) {
    if (!failureKinds.includes(required)) wall("PROVIDER_OUTAGE_CASE_WALL", "outageCases", `${required}_REQUIRED`)
  }
  if (!Array.isArray(plan.failoverDecisions) || plan.failoverDecisions.length !== 4) wall("PROVIDER_OUTAGE_FAILOVER_WALL", "failoverDecisions")
  for (const [index, decision] of plan.failoverDecisions.entries()) {
    exact(decision, FAILOVER_FIELDS, `failoverDecisions[${index}]`)
    text(decision.classification, `failoverDecisions[${index}].classification`)
    text(decision.decision, `failoverDecisions[${index}].decision`)
    text(decision.fallbackProvider, `failoverDecisions[${index}].fallbackProvider`)
    text(decision.terminalIfNoFallback, `failoverDecisions[${index}].terminalIfNoFallback`)
  }
  if (!Array.isArray(plan.quarantineRules) || plan.quarantineRules.length !== 2) wall("PROVIDER_OUTAGE_QUARANTINE_WALL", "quarantineRules")
  for (const [index, rule] of plan.quarantineRules.entries()) {
    exact(rule, QUARANTINE_FIELDS, `quarantineRules[${index}]`)
    text(rule.classification, `quarantineRules[${index}].classification`)
    if (rule.providerState !== "QUARANTINED") wall("PROVIDER_OUTAGE_QUARANTINE_WALL", `quarantineRules[${index}].providerState`)
    text(rule.resumeCondition, `quarantineRules[${index}].resumeCondition`)
  }
  exact(plan.budgets, BUDGET_FIELDS, "budgets")
  if (plan.budgets.maxAttempts !== 3 || plan.budgets.maxReroutes !== 1 || plan.budgets.maxBackoffMs !== 60000 || plan.budgets.ownerDiagnosticBudget !== 0) wall("PROVIDER_OUTAGE_BUDGET_WALL", "budgets")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("PROVIDER_OUTAGE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("PROVIDER_OUTAGE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("PROVIDER_OUTAGE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.providerHealthVerified !== true
    || plan.authority.providerConformanceVerified !== true
    || plan.authority.retryIdempotencyVerified !== true
    || plan.authority.workerRecoveryVerified !== true
    || plan.authority.authorityScope !== "PROVIDER_OUTAGE_FAILOVER_DRILL_MODEL_ONLY") wall("PROVIDER_OUTAGE_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("PROVIDER_OUTAGE_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    outageCaseCount: plan.outageCases.length,
    failoverDecisionCount: plan.failoverDecisions.length,
    quarantineRuleCount: plan.quarantineRules.length,
    retryableOutageCount: plan.outageCases.filter((entry) => entry.retryable).length,
    maxAttempts: plan.budgets.maxAttempts,
    maxReroutes: plan.budgets.maxReroutes,
    maxBackoffMs: plan.budgets.maxBackoffMs,
    ownerDiagnosticBudget: plan.budgets.ownerDiagnosticBudget,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateProviderOutageFailoverDrill() {
  wall("PROVIDER_OUTAGE_HOST_TRUST_WALL", "providerOutageFailoverDrill", "CALLER_SUPPLIED_OUTAGE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalProviderOutageFailoverDrillPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "PROVIDER_OUTAGE_FAILOVER_DRILL_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    networkInjectionPerformed: false,
    githubApiCalled: false,
    stateMutationPerformed: false,
    ownerDiagnosticsRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalProviderOutageFailoverDrill() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "PROVIDER_OUTAGE_FAILOVER_DRILL_RESULT",
    workOrderId: "WO-MAO-048",
    status: "PROVIDER_OUTAGE_FAILOVER_DRILL_PROVEN",
    drillId: PLAN.drillId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    failureKinds: PLAN.outageCases.map((entry) => entry.failureKind).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_PROVIDER_HEALTH_CONFORMANCE_RETRY_AND_RECOVERY_EVIDENCE",
      "CLASSIFY_NETWORK_AUTH_RATE_LIMIT_5XX_TIMEOUT_AND_STREAM_FAILURES",
      "APPLY_BOUNDED_RETRY_AND_SINGLE_REROUTE_BUDGET",
      "QUARANTINE_AUTHORITY_AND_STREAM_AMBIGUITY",
      "FAIL_CLOSED_WITHOUT_OWNER_DIAGNOSTICS",
      "RECORD_STATIC_PROVIDER_OUTAGE_EVIDENCE_ONLY",
    ],
    schedulerAdded: false,
    providerExecutionPerformed: false,
    networkInjectionPerformed: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    ownerDiagnosticsRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalProviderOutageFailoverDrillPlan() { return deepFreeze(deepCopy(PLAN)) }
export function providerOutageFailoverDrillPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalProviderOutageFailoverDrillJson(value) { return canonicalJson(value) }
