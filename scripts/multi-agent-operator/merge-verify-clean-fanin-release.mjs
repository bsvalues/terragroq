import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/
const URL = /^https:\/\/[A-Za-z0-9._\/:-]+$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "releaseId", "workOrderId", "repository", "baseRef",
  "mainCommitSha", "mainTreeHash", "dependencyEvidence", "mergedPullRequests",
  "mainVerification", "productionRouteChecks", "cleanupPolicy", "fanInRelease",
  "ownerCounters", "reservedPaths", "changedPaths", "foreignChanges", "secretScan",
  "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const PR_FIELDS = new Set(["number", "url", "headRefName", "mergeCommitSha", "merged", "checksGreen", "reviewThreadsResolved", "authorizedUsefulWork"])
const MAIN_FIELDS = new Set(["localHeadMatchesOriginMain", "originMainCommitSha", "treeHash", "mainContainsMergedResults"])
const ROUTE_FIELDS = new Set(["route", "expectedStatus", "observedStatus", "state"])
const CLEANUP_FIELDS = new Set(["ownedRemoteBranchesGone", "ownedLocalBranchesRemoved", "unsafeCleanupDenied", "preservedEvidence", "releasedReservations"])
const FANIN_FIELDS = new Set(["releasedWorkOrderId", "releasedState", "soakDurationCertified", "tenConsecutiveWorkOrdersCertified", "dependentExecutionClaim"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "repositoryScopedAuthority", "certificationAuthorityGranted"])
const SAFETY_FIELDS = new Set([
  "githubPrLifecycleUsed", "mergePerformed", "cleanupPerformed", "unsafeCleanupPerformed",
  "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "productionWritePerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "paidOverageAllowed", "rejectedRuntimeRetried",
  "authorityGranted",
])
const OWNER_COUNTER_FIELDS = new Set([
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT",
])

export class MergeVerifyCleanFanInReleaseError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "MergeVerifyCleanFanInReleaseError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new MergeVerifyCleanFanInReleaseError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("FANIN_RELEASE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("FANIN_RELEASE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("FANIN_RELEASE_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("FANIN_RELEASE_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE",
  releaseId: "merge-verify-clean-fanin-release-wo-mao-058-v1",
  workOrderId: "WO-MAO-058",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  mainCommitSha: "9a1fff71727c9df72d476e5df20b9ae6457631ba",
  mainTreeHash: "0c5a74698825b8b48c6a2a991277e7931acd8ffe",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-056", evidenceId: "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1", status: "CANONICAL_CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_VERIFIED", recordContentHash: "e8414ecf935ef6e14bf135c253cc9c62196a84bfd526d9e05fc15f9ed18fc727" },
    { workOrderId: "WO-MAO-057", evidenceId: "EVIDENCE-WO-MAO-057-LIVE-FAILURE-RECOVERY-CERTIFICATION-V1", status: "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION_VERIFIED", recordContentHash: "3c9382bf0173e744923366d8f60673919b8b52ce9e87c7b2bfca21e5b67f7ca7" },
  ],
  mergedPullRequests: [
    { number: 411, url: "https://github.com/bsvalues/terragroq/pull/411", headRefName: "codex/mao-057-stale-base-control", mergeCommitSha: "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def", merged: true, checksGreen: true, reviewThreadsResolved: true, authorizedUsefulWork: true },
    { number: 412, url: "https://github.com/bsvalues/terragroq/pull/412", headRefName: "codex/mao-057-live-failure-recovery", mergeCommitSha: "9a1fff71727c9df72d476e5df20b9ae6457631ba", merged: true, checksGreen: true, reviewThreadsResolved: true, authorizedUsefulWork: true },
  ],
  mainVerification: {
    localHeadMatchesOriginMain: true,
    originMainCommitSha: "9a1fff71727c9df72d476e5df20b9ae6457631ba",
    treeHash: "0c5a74698825b8b48c6a2a991277e7931acd8ffe",
    mainContainsMergedResults: true,
  },
  productionRouteChecks: [
    { route: "https://terragroq.vercel.app/api/health", expectedStatus: 200, observedStatus: 200, state: "PASS" },
    { route: "https://terragroq.vercel.app/api/auth/readiness", expectedStatus: 200, observedStatus: 200, state: "PASS" },
    { route: "https://terragroq.vercel.app/operator", expectedStatus: 200, observedStatus: 200, state: "PASS" },
    { route: "https://terragroq.vercel.app/goal-console", expectedStatus: 200, observedStatus: 200, state: "PASS" },
  ],
  cleanupPolicy: {
    ownedRemoteBranchesGone: ["codex/mao-057-stale-base-control", "codex/mao-057-live-failure-recovery"],
    ownedLocalBranchesRemoved: [],
    unsafeCleanupDenied: [
      "obsidian-touch",
      "shared-worktree-cleanup",
      "foreign-branch-cleanup",
      "unmerged-branch-deletion",
      "evidence-artifact-deletion",
      "runtime-state-cleanup",
    ],
    preservedEvidence: [
      "docs/reports/WO-MAO-056-cross-review-ci-remediation-certification.md",
      "docs/reports/WO-MAO-057-live-failure-recovery-certification.md",
      "docs/reports/WO-MAO-057-live-failure-recovery-artifacts/summary.json",
    ],
    releasedReservations: ["WO-MAO-056-certification-lane", "WO-MAO-057-live-recovery-lane"],
  },
  fanInRelease: {
    releasedWorkOrderId: "WO-MAO-059",
    releasedState: "READY_AFTER_WO_MAO_058_FANIN_RELEASE",
    soakDurationCertified: false,
    tenConsecutiveWorkOrdersCertified: false,
    dependentExecutionClaim: "RELEASED_TO_SOAK_QUEUE_ONLY",
  },
  ownerCounters: {
    OWNER_OPERATION_TOUCH_COUNT: 0,
    OWNER_CREDENTIAL_TOUCH_COUNT: 0,
    OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
    OWNER_ROUTINE_DECISION_COUNT: 0,
    OWNER_ROUTINE_CONTACT_COUNT: 0,
  },
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-merge-verify-fanin-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-058-merge-verify-clean-fanin-release.md",
    "scripts/multi-agent-operator/merge-verify-clean-fanin-release-cli.mjs",
    "scripts/multi-agent-operator/merge-verify-clean-fanin-release.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-merge-verify-clean-fanin-release.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-merge-verify-fanin-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-058-merge-verify-clean-fanin-release.md",
    "scripts/multi-agent-operator/merge-verify-clean-fanin-release-cli.mjs",
    "scripts/multi-agent-operator/merge-verify-clean-fanin-release.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-merge-verify-clean-fanin-release.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_ONLY",
    repositoryScopedAuthority: true,
    certificationAuthorityGranted: false,
  },
  safety: {
    githubPrLifecycleUsed: true,
    mergePerformed: true,
    cleanupPerformed: true,
    unsafeCleanupPerformed: false,
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

const PLAN_HASH = "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("FANIN_RELEASE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("FANIN_RELEASE_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("FANIN_RELEASE_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validatePlan(plan) {
  exact(plan, PLAN_FIELDS, "plan")
  let planHash
  try {
    planHash = contentHash(plan)
  } catch {
    wall("FANIN_RELEASE_PLAN_INTEGRITY_WALL", "plan", "JSON_COMPATIBLE_CANONICAL_PLAN_REQUIRED")
  }
  if (planHash !== PLAN_HASH) wall("FANIN_RELEASE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE") wall("FANIN_RELEASE_SCHEMA_WALL", "plan")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-058") wall("FANIN_RELEASE_SCOPE_WALL", "plan.workOrderId")
  text(plan.releaseId, "plan.releaseId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.mainCommitSha, "plan.mainCommitSha", SHA40)
  text(plan.mainTreeHash, "plan.mainTreeHash", SHA40)
  if (!Array.isArray(plan.dependencyEvidence) || plan.dependencyEvidence.length !== 2) wall("FANIN_RELEASE_DEPENDENCY_WALL", "dependencyEvidence")
  for (const [index, dependency] of plan.dependencyEvidence.entries()) {
    exact(dependency, DEP_FIELDS, `dependencyEvidence[${index}]`)
    if (dependency.workOrderId !== ["WO-MAO-056", "WO-MAO-057"][index]) wall("FANIN_RELEASE_DEPENDENCY_WALL", `dependencyEvidence[${index}].workOrderId`)
    text(dependency.evidenceId, `dependencyEvidence[${index}].evidenceId`)
    text(dependency.status, `dependencyEvidence[${index}].status`)
    text(dependency.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
  }
  if (!Array.isArray(plan.mergedPullRequests) || plan.mergedPullRequests.length !== 2) wall("FANIN_RELEASE_PR_WALL", "mergedPullRequests")
  for (const [index, pr] of plan.mergedPullRequests.entries()) {
    exact(pr, PR_FIELDS, `mergedPullRequests[${index}]`)
    if (![411, 412].includes(pr.number)) wall("FANIN_RELEASE_PR_WALL", `mergedPullRequests[${index}].number`)
    text(pr.url, `mergedPullRequests[${index}].url`, URL)
    text(pr.headRefName, `mergedPullRequests[${index}].headRefName`, /^[A-Za-z0-9._\/-]{1,127}$/)
    text(pr.mergeCommitSha, `mergedPullRequests[${index}].mergeCommitSha`, SHA40)
    if (pr.merged !== true || pr.checksGreen !== true || pr.reviewThreadsResolved !== true || pr.authorizedUsefulWork !== true) wall("FANIN_RELEASE_PR_GATE_WALL", `mergedPullRequests[${index}]`)
  }
  exact(plan.mainVerification, MAIN_FIELDS, "mainVerification")
  if (plan.mainVerification.localHeadMatchesOriginMain !== true
    || plan.mainVerification.originMainCommitSha !== plan.mainCommitSha
    || plan.mainVerification.treeHash !== plan.mainTreeHash
    || plan.mainVerification.mainContainsMergedResults !== true) wall("FANIN_RELEASE_MAIN_WALL", "mainVerification")
  if (!Array.isArray(plan.productionRouteChecks) || plan.productionRouteChecks.length !== 4) wall("FANIN_RELEASE_ROUTE_WALL", "productionRouteChecks")
  for (const [index, route] of plan.productionRouteChecks.entries()) {
    exact(route, ROUTE_FIELDS, `productionRouteChecks[${index}]`)
    text(route.route, `productionRouteChecks[${index}].route`, URL)
    if (route.expectedStatus !== 200 || route.observedStatus !== 200 || route.state !== "PASS") wall("FANIN_RELEASE_ROUTE_WALL", `productionRouteChecks[${index}]`)
  }
  exact(plan.cleanupPolicy, CLEANUP_FIELDS, "cleanupPolicy")
  stringArray(plan.cleanupPolicy.ownedRemoteBranchesGone, "cleanupPolicy.ownedRemoteBranchesGone", /^[A-Za-z0-9._\/-]{1,127}$/)
  if (!Array.isArray(plan.cleanupPolicy.ownedLocalBranchesRemoved)) wall("FANIN_RELEASE_CLEANUP_WALL", "cleanupPolicy.ownedLocalBranchesRemoved")
  const denied = stringArray(plan.cleanupPolicy.unsafeCleanupDenied, "cleanupPolicy.unsafeCleanupDenied")
  for (const required of ["obsidian-touch", "shared-worktree-cleanup", "foreign-branch-cleanup", "unmerged-branch-deletion", "evidence-artifact-deletion"]) {
    if (!denied.includes(required)) wall("FANIN_RELEASE_CLEANUP_WALL", "cleanupPolicy.unsafeCleanupDenied")
  }
  pathArray(plan.cleanupPolicy.preservedEvidence, "cleanupPolicy.preservedEvidence")
  stringArray(plan.cleanupPolicy.releasedReservations, "cleanupPolicy.releasedReservations")
  exact(plan.fanInRelease, FANIN_FIELDS, "fanInRelease")
  if (plan.fanInRelease.releasedWorkOrderId !== "WO-MAO-059"
    || plan.fanInRelease.releasedState !== "READY_AFTER_WO_MAO_058_FANIN_RELEASE"
    || plan.fanInRelease.soakDurationCertified !== false
    || plan.fanInRelease.tenConsecutiveWorkOrdersCertified !== false
    || plan.fanInRelease.dependentExecutionClaim !== "RELEASED_TO_SOAK_QUEUE_ONLY") wall("FANIN_RELEASE_DOWNSTREAM_WALL", "fanInRelease")
  exact(plan.ownerCounters, OWNER_COUNTER_FIELDS, "ownerCounters")
  for (const field of OWNER_COUNTER_FIELDS) if (plan.ownerCounters[field] !== 0) wall("FANIN_RELEASE_OWNER_TOUCH_WALL", `ownerCounters.${field}`)
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("FANIN_RELEASE_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("FANIN_RELEASE_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("FANIN_RELEASE_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "MERGE_VERIFY_CLEAN_FANIN_RELEASE_ONLY"
    || plan.authority.repositoryScopedAuthority !== true
    || plan.authority.certificationAuthorityGranted !== false) wall("FANIN_RELEASE_AUTHORITY_WALL", "authority")
  exact(plan.safety, SAFETY_FIELDS, "safety")
  if (plan.safety.githubPrLifecycleUsed !== true || plan.safety.mergePerformed !== true || plan.safety.cleanupPerformed !== true) wall("FANIN_RELEASE_SAFETY_WALL", "safety.lifecycle")
  for (const field of ["unsafeCleanupPerformed", "runtimeActivationAllowed", "commandRunnerAdded", "backgroundWorkerAdded", "productionWritePerformed", "secretMaterialAllowed", "ownerOperationRequired", "paidOverageAllowed", "rejectedRuntimeRetried", "authorityGranted"]) {
    if (plan.safety[field] !== false) wall("FANIN_RELEASE_SAFETY_WALL", `safety.${field}`)
  }
  return {
    dependencyCount: plan.dependencyEvidence.length,
    mergedPullRequestCount: plan.mergedPullRequests.length,
    routeCheckCount: plan.productionRouteChecks.length,
    releasedReservationCount: plan.cleanupPolicy.releasedReservations.length,
    deniedCleanupActionCount: plan.cleanupPolicy.unsafeCleanupDenied.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateMergeVerifyCleanFanInRelease() {
  wall("FANIN_RELEASE_HOST_TRUST_WALL", "mergeVerifyCleanFanInRelease", "CALLER_SUPPLIED_RELEASE_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalMergeVerifyCleanFanInRelease(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    githubPrLifecycleUsed: true,
    mergePerformed: true,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalMergeVerifyCleanFanInRelease() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_RESULT",
    workOrderId: "WO-MAO-058",
    status: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_CERTIFIED",
    releaseId: PLAN.releaseId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    mainCommitSha: PLAN.mainCommitSha,
    mainTreeHash: PLAN.mainTreeHash,
    mergedPullRequests: PLAN.mergedPullRequests.map((pr) => pr.number).sort((a, b) => a - b),
    downstreamWorkOrderId: PLAN.fanInRelease.releasedWorkOrderId,
    downstreamState: PLAN.fanInRelease.releasedState,
    soakDurationCertified: false,
    tenConsecutiveWorkOrdersCertified: false,
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    githubPrLifecycleUsed: true,
    mergePerformed: true,
    cleanupPerformed: true,
    unsafeCleanupPerformed: false,
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
export function loadCanonicalMergeVerifyCleanFanInRelease() { return deepFreeze(deepCopy(PLAN)) }
export function mergeVerifyCleanFanInReleasePlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalMergeVerifyCleanFanInReleaseJson(value) { return canonicalJson(value) }
