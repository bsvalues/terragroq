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
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "staleBaseControls",
  "ciReviewOutcomes", "mergeRaceGuards", "reservedPaths", "changedPaths", "foreignChanges",
  "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const STALE_BASE_FIELDS = new Set(["trigger", "action", "revalidationRequired", "maxRefreshes"])
const CI_REVIEW_FIELDS = new Set(["failureClass", "action", "retryBudget", "terminalDecision"])
const MERGE_RACE_FIELDS = new Set(["guard", "required", "staleCandidateDecision", "concurrentChangeDecision"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set([
  "activeProgramGrant", "ciReviewIngestionVerified", "remediationRereviewVerified",
  "boundedMergeControllerVerified", "retryIdempotencyVerified", "authorityScope",
])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "rebasePerformed",
  "ciRerunPerformed", "reviewThreadResolved", "mergePerformed", "productionWritePerformed",
  "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class StaleBaseCiReviewMergeRaceError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "StaleBaseCiReviewMergeRaceError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new StaleBaseCiReviewMergeRaceError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("MERGE_RACE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("MERGE_RACE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("MERGE_RACE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("MERGE_RACE_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_DRILL",
  drillId: "stale-base-ci-review-merge-race-wo-mao-049-v1",
  workOrderId: "WO-MAO-049",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc",
  baseTreeHash: "a4240f8508f3c95671250e6fb677efa3dff6baea",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-039", evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1", status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED", recordContentHash: "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8" },
    { workOrderId: "WO-MAO-040", evidenceId: "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1", status: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED", recordContentHash: "5824568886fb6926457a68a0f7c3806ef0ee44859b38e932ed33a1e41c2102b9" },
    { workOrderId: "WO-MAO-041", evidenceId: "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1", status: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED", recordContentHash: "627a8ab17e98aa8c0c579653af013f5b7771f6bb2c05d4c31d11a8ce5369cd8b" },
    { workOrderId: "WO-MAO-046", evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1", status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED", recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
  ],
  staleBaseControls: [
    { trigger: "base-ref-moved", action: "refresh-branch-and-revalidate", revalidationRequired: true, maxRefreshes: 2 },
    { trigger: "merge-head-mismatch", action: "stop-stale-candidate", revalidationRequired: true, maxRefreshes: 0 },
    { trigger: "branch-protection-changed", action: "stop-policy-changed", revalidationRequired: true, maxRefreshes: 0 },
  ],
  ciReviewOutcomes: [
    { failureClass: "DETERMINISTIC_PRODUCT", action: "return-to-original-builder", retryBudget: 0, terminalDecision: "REPAIR_AND_REREVIEW_REQUIRED" },
    { failureClass: "FLAKY_INFRASTRUCTURE", action: "allow-one-classified-rerun", retryBudget: 1, terminalDecision: "RERUN_ONCE_THEN_RECLASSIFY" },
    { failureClass: "POLICY_OR_AUTHORITY", action: "stop-without-dismissal", retryBudget: 0, terminalDecision: "OWNER_DECISION_PACKET_ONLY" },
    { failureClass: "STALE_BASE", action: "refresh-and-full-revalidation", retryBudget: 2, terminalDecision: "MERGE_BLOCKED_UNTIL_FRESH" },
  ],
  mergeRaceGuards: [
    { guard: "expected-head-sha", required: true, staleCandidateDecision: "DENY_MERGE", concurrentChangeDecision: "REFRESH_REQUIRED" },
    { guard: "required-checks-after-refresh", required: true, staleCandidateDecision: "DENY_MERGE", concurrentChangeDecision: "REVALIDATE_REQUIRED" },
    { guard: "zero-unresolved-review-threads", required: true, staleCandidateDecision: "DENY_MERGE", concurrentChangeDecision: "REREVIEW_REQUIRED" },
    { guard: "idempotency-merge-fence", required: true, staleCandidateDecision: "DENY_DUPLICATE", concurrentChangeDecision: "COMPARE_AND_SWAP_STOP" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-merge-race-registry.ts",
    "docs/reports/WO-MAO-049-stale-base-ci-review-merge-race.md",
    "scripts/multi-agent-operator/stale-base-ci-review-merge-race-cli.mjs",
    "scripts/multi-agent-operator/stale-base-ci-review-merge-race.mjs",
    "tests/multi-agent-stale-base-ci-review-merge-race.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-merge-race-registry.ts",
    "docs/reports/WO-MAO-049-stale-base-ci-review-merge-race.md",
    "scripts/multi-agent-operator/stale-base-ci-review-merge-race-cli.mjs",
    "scripts/multi-agent-operator/stale-base-ci-review-merge-race.mjs",
    "tests/multi-agent-stale-base-ci-review-merge-race.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    ciReviewIngestionVerified: true,
    remediationRereviewVerified: true,
    boundedMergeControllerVerified: true,
    retryIdempotencyVerified: true,
    authorityScope: "STALE_BASE_CI_REVIEW_MERGE_RACE_MODEL_ONLY",
  },
  safety: {
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    rebasePerformed: false,
    ciRerunPerformed: false,
    reviewThreadResolved: false,
    mergePerformed: false,
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

const PLAN_HASH = "c4fac68042a360532806aeb94248e52a58fa10c76d388fe217c15827b4c294bf"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("MERGE_RACE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("MERGE_RACE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("MERGE_RACE_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 4) wall("MERGE_RACE_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-039,WO-MAO-040,WO-MAO-041,WO-MAO-046") wall("MERGE_RACE_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validateStaleBaseControls(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("MERGE_RACE_STALE_BASE_WALL", "staleBaseControls")
  for (const [index, control] of value.entries()) {
    exact(control, STALE_BASE_FIELDS, `staleBaseControls[${index}]`)
    text(control.trigger, `staleBaseControls[${index}].trigger`)
    text(control.action, `staleBaseControls[${index}].action`)
    if (control.revalidationRequired !== true || !Number.isInteger(control.maxRefreshes) || control.maxRefreshes < 0 || control.maxRefreshes > 2) {
      wall("MERGE_RACE_STALE_BASE_WALL", `staleBaseControls[${index}]`)
    }
  }
}
function validateCiReviewOutcomes(value) {
  if (!Array.isArray(value) || value.length !== 4) wall("MERGE_RACE_CI_REVIEW_WALL", "ciReviewOutcomes")
  const classes = []
  for (const [index, outcome] of value.entries()) {
    exact(outcome, CI_REVIEW_FIELDS, `ciReviewOutcomes[${index}]`)
    text(outcome.failureClass, `ciReviewOutcomes[${index}].failureClass`)
    text(outcome.action, `ciReviewOutcomes[${index}].action`)
    text(outcome.terminalDecision, `ciReviewOutcomes[${index}].terminalDecision`)
    if (!Number.isInteger(outcome.retryBudget) || outcome.retryBudget < 0 || outcome.retryBudget > 2) wall("MERGE_RACE_CI_REVIEW_WALL", `ciReviewOutcomes[${index}].retryBudget`)
    classes.push(outcome.failureClass)
  }
  for (const required of ["DETERMINISTIC_PRODUCT", "FLAKY_INFRASTRUCTURE", "POLICY_OR_AUTHORITY", "STALE_BASE"]) {
    if (!classes.includes(required)) wall("MERGE_RACE_CI_REVIEW_WALL", "ciReviewOutcomes", `${required}_REQUIRED`)
  }
  const flaky = value.find((outcome) => outcome.failureClass === "FLAKY_INFRASTRUCTURE")
  if (flaky.retryBudget !== 1 || flaky.action !== "allow-one-classified-rerun") wall("MERGE_RACE_CI_REVIEW_WALL", "ciReviewOutcomes.flaky")
}
function validateMergeRaceGuards(value) {
  if (!Array.isArray(value) || value.length !== 4) wall("MERGE_RACE_GUARD_WALL", "mergeRaceGuards")
  const guards = []
  for (const [index, guard] of value.entries()) {
    exact(guard, MERGE_RACE_FIELDS, `mergeRaceGuards[${index}]`)
    text(guard.guard, `mergeRaceGuards[${index}].guard`)
    text(guard.staleCandidateDecision, `mergeRaceGuards[${index}].staleCandidateDecision`)
    text(guard.concurrentChangeDecision, `mergeRaceGuards[${index}].concurrentChangeDecision`)
    if (guard.required !== true || !guard.staleCandidateDecision.startsWith("DENY")) wall("MERGE_RACE_GUARD_WALL", `mergeRaceGuards[${index}]`)
    guards.push(guard.guard)
  }
  for (const required of ["expected-head-sha", "required-checks-after-refresh", "zero-unresolved-review-threads", "idempotency-merge-fence"]) {
    if (!guards.includes(required)) wall("MERGE_RACE_GUARD_WALL", "mergeRaceGuards", `${required}_REQUIRED`)
  }
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("MERGE_RACE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_DRILL") wall("MERGE_RACE_SCHEMA_WALL", "plan")
  text(plan.drillId, "plan.drillId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-049") wall("MERGE_RACE_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  validateStaleBaseControls(plan.staleBaseControls)
  validateCiReviewOutcomes(plan.ciReviewOutcomes)
  validateMergeRaceGuards(plan.mergeRaceGuards)
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("MERGE_RACE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("MERGE_RACE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("MERGE_RACE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.ciReviewIngestionVerified !== true
    || plan.authority.remediationRereviewVerified !== true
    || plan.authority.boundedMergeControllerVerified !== true
    || plan.authority.retryIdempotencyVerified !== true
    || plan.authority.authorityScope !== "STALE_BASE_CI_REVIEW_MERGE_RACE_MODEL_ONLY") wall("MERGE_RACE_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("MERGE_RACE_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    staleBaseControlCount: plan.staleBaseControls.length,
    ciReviewOutcomeCount: plan.ciReviewOutcomes.length,
    mergeRaceGuardCount: plan.mergeRaceGuards.length,
    flakyRetryBudget: plan.ciReviewOutcomes.find((outcome) => outcome.failureClass === "FLAKY_INFRASTRUCTURE").retryBudget,
    maxBaseRefreshes: Math.max(...plan.staleBaseControls.map((control) => control.maxRefreshes)),
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateStaleBaseCiReviewMergeRace() {
  wall("MERGE_RACE_HOST_TRUST_WALL", "staleBaseCiReviewMergeRace", "CALLER_SUPPLIED_MERGE_RACE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalStaleBaseCiReviewMergeRacePlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "STALE_BASE_CI_REVIEW_MERGE_RACE_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    githubApiCalled: false,
    rebasePerformed: false,
    ciRerunPerformed: false,
    mergePerformed: false,
    stateMutationPerformed: false,
    authorityGranted: false,
  })
}
export function runCanonicalStaleBaseCiReviewMergeRace() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "STALE_BASE_CI_REVIEW_MERGE_RACE_RESULT",
    workOrderId: "WO-MAO-049",
    status: "STALE_BASE_CI_REVIEW_MERGE_RACE_PROVEN",
    drillId: PLAN.drillId,
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
      "VERIFY_CI_REVIEW_REMEDIATION_MERGE_AND_RETRY_EVIDENCE",
      "CLASSIFY_STALE_BASE_OR_CONCURRENT_CHANGE",
      "REFRESH_AND_FULLY_REVALIDATE_WHEN_ALLOWED",
      "ROUTE_DETERMINISTIC_FAILURE_TO_ORIGINAL_BUILDER",
      "ALLOW_ONE_CLASSIFIED_FLAKY_RERUN_ONLY",
      "DENY_STALE_OR_CONCURRENTLY_CHANGED_MERGE_CANDIDATE",
      "RECORD_STATIC_DRILL_EVIDENCE_ONLY",
    ],
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    rebasePerformed: false,
    ciRerunPerformed: false,
    reviewThreadResolved: false,
    mergePerformed: false,
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
export function loadCanonicalStaleBaseCiReviewMergeRacePlan() { return deepFreeze(deepCopy(PLAN)) }
export function staleBaseCiReviewMergeRacePlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalStaleBaseCiReviewMergeRaceJson(value) { return canonicalJson(value) }
