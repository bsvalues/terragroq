import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[0-9a-f]{64}$/
const SAFE = /^[A-Za-z0-9][A-Za-z0-9 ._:/#(),+-]{1,180}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "remediationId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "remediationRoute", "validationLoop",
  "rereview", "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const ROUTE_FIELDS = new Set(["findingClass", "originalBuilderRequired", "maxCycles", "scope", "failureMode"])
const VALIDATION_FIELDS = new Set(["commands", "rerunRequired", "staleBaseRecheckRequired"])
const REREVIEW_FIELDS = new Set(["independentReviewerRequired", "sameReviewerMayRemediate", "zeroUnresolvedThreadsRequired"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "preventiveTrustGatePassed", "handoffVerified", "roleAdaptersVerified", "ciReviewIngestionVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "githubApiCalled", "branchMutated", "remediationApplied", "validationRerunPerformed",
  "reviewRequested", "reviewThreadResolved", "mergePerformed", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "productionWriteAllowed", "secretMaterialAllowed",
  "ownerOperationRequired", "authorityGranted",
]

export class RemediationRereviewError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "RemediationRereviewError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new RemediationRereviewError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("REMEDIATION_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("REMEDIATION_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("REMEDIATION_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("REMEDIATION_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_REMEDIATION_REREVIEW_PLAN",
  remediationId: "remediation-wo-mao-040-v1",
  workOrderId: "WO-MAO-040",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "eacc0c3aa1dc719f17b6b96377b8c6b31c2b7be1",
  baseTreeHash: "553fa0cf94a799e57b0f573d7e336f7aa83838b4",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-026", evidenceId: "docs/reports/WO-MAO-026-reservation-aware-handoff.md", status: "RESERVATION_AWARE_HANDOFF_VERIFIED", recordContentHash: "static-reservation-aware-handoff" },
    { workOrderId: "WO-MAO-031", evidenceId: "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md", status: "CODEX_ROLE_ADAPTERS_VERIFIED", recordContentHash: "static-codex-role-adapters" },
    { workOrderId: "WO-MAO-039", evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1", status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED", recordContentHash: "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8" },
  ],
  remediationRoute: {
    findingClass: "ACTIONABLE_PRODUCT",
    originalBuilderRequired: true,
    maxCycles: 1,
    scope: "RESERVED_PATHS_ONLY",
    failureMode: "OWNER_DECISION_PACKET_FOR_SCOPE_OR_POLICY",
  },
  validationLoop: {
    commands: ["focused-tests", "git-diff-check", "lint", "full-tests", "build"],
    rerunRequired: true,
    staleBaseRecheckRequired: true,
  },
  rereview: {
    independentReviewerRequired: true,
    sameReviewerMayRemediate: false,
    zeroUnresolvedThreadsRequired: true,
  },
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "components/operator/multi-agent-remediation-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-040-remediation-rereview.md",
    "scripts/multi-agent-operator/remediation-rereview-cli.mjs",
    "scripts/multi-agent-operator/remediation-rereview.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/multi-agent-remediation-rereview.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "components/operator/multi-agent-remediation-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-040-remediation-rereview.md",
    "scripts/multi-agent-operator/remediation-rereview-cli.mjs",
    "scripts/multi-agent-operator/remediation-rereview.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/multi-agent-remediation-rereview.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    preventiveTrustGatePassed: true,
    handoffVerified: true,
    roleAdaptersVerified: true,
    ciReviewIngestionVerified: true,
    authorityScope: "REMEDIATION_REREVIEW_CLASSIFICATION_ONLY",
  },
  safety: {
    githubApiCalled: false,
    branchMutated: false,
    remediationApplied: false,
    validationRerunPerformed: false,
    reviewRequested: false,
    reviewThreadResolved: false,
    mergePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    productionWriteAllowed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "2cc236487f15809ddfd89830400e2dbaa62b5ad7bfe628d11bc8bcf4eebbe1bf"

function stringArray(value, field, pattern = SAFE) {
  if (!Array.isArray(value) || value.length === 0) wall("REMEDIATION_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("REMEDIATION_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  normalized.forEach((item, index) => {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("REMEDIATION_PATH_WALL", `${field}[${index}]`)
  })
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("REMEDIATION_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, SAFE)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-026,WO-MAO-031,WO-MAO-039") wall("REMEDIATION_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
  const ci = value.find((entry) => entry.workOrderId === "WO-MAO-039")
  if (ci.recordContentHash !== "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8") wall("REMEDIATION_DEPENDENCY_WALL", "dependencyEvidence[WO-MAO-039]")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("REMEDIATION_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_REMEDIATION_REREVIEW_PLAN") wall("REMEDIATION_SCHEMA_WALL", "plan")
  text(plan.remediationId, "plan.remediationId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-040") wall("REMEDIATION_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  exact(plan.remediationRoute, ROUTE_FIELDS, "remediationRoute")
  if (plan.remediationRoute.findingClass !== "ACTIONABLE_PRODUCT" || plan.remediationRoute.originalBuilderRequired !== true
    || plan.remediationRoute.maxCycles !== 1 || plan.remediationRoute.scope !== "RESERVED_PATHS_ONLY") wall("REMEDIATION_ROUTE_WALL", "remediationRoute")
  exact(plan.validationLoop, VALIDATION_FIELDS, "validationLoop")
  if (plan.validationLoop.rerunRequired !== true || plan.validationLoop.staleBaseRecheckRequired !== true) wall("REMEDIATION_VALIDATION_WALL", "validationLoop")
  const commands = stringArray(plan.validationLoop.commands, "validationLoop.commands")
  for (const required of ["focused-tests", "git-diff-check", "lint", "full-tests", "build"]) if (!commands.includes(required)) wall("REMEDIATION_VALIDATION_WALL", "validationLoop.commands")
  exact(plan.rereview, REREVIEW_FIELDS, "rereview")
  if (plan.rereview.independentReviewerRequired !== true || plan.rereview.sameReviewerMayRemediate !== false || plan.rereview.zeroUnresolvedThreadsRequired !== true) wall("REMEDIATION_REREVIEW_WALL", "rereview")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("REMEDIATION_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("REMEDIATION_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("REMEDIATION_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.preventiveTrustGatePassed !== true || plan.authority.handoffVerified !== true
    || plan.authority.roleAdaptersVerified !== true || plan.authority.ciReviewIngestionVerified !== true
    || plan.authority.authorityScope !== "REMEDIATION_REREVIEW_CLASSIFICATION_ONLY") wall("REMEDIATION_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("REMEDIATION_SAFETY_WALL", `safety.${field}`)
  return { commandCount: commands.length, reservedPathCount: reservedPaths.length, changedPathCount: changedPaths.length }
}

export function evaluateRemediationRereview() {
  wall("REMEDIATION_HOST_TRUST_WALL", "remediationRereview", "CALLER_SUPPLIED_REMEDIATION_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalRemediationRereviewPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true, code: "REMEDIATION_REREVIEW_PLAN_VERIFIED", contentHash: PLAN_HASH,
    githubApiCalled: false, remediationApplied: false, validationRerunPerformed: false,
    reviewRequested: false, reviewThreadResolved: false, mergePerformed: false, authorityGranted: false,
  })
}
export function runCanonicalRemediationRereview() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "REMEDIATION_REREVIEW_RESULT",
    workOrderId: "WO-MAO-040",
    status: "REMEDIATION_REREVIEW_PROVEN",
    remediationId: PLAN.remediationId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    maxCycles: PLAN.remediationRoute.maxCycles,
    originalBuilderRequired: PLAN.remediationRoute.originalBuilderRequired,
    independentReviewerRequired: PLAN.rereview.independentReviewerRequired,
    zeroUnresolvedThreadsRequired: PLAN.rereview.zeroUnresolvedThreadsRequired,
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_RESERVATION_AWARE_HANDOFF",
      "VERIFY_ROLE_ADAPTER_REMEDIATION_CONTRACT",
      "VERIFY_CI_REVIEW_INGESTION_EVIDENCE",
      "ROUTE_ACTIONABLE_FINDING_TO_ORIGINAL_BUILDER",
      "REQUIRE_BOUNDED_VALIDATION_RERUN",
      "REQUIRE_INDEPENDENT_REREVIEW",
      "RECORD_REMEDIATION_GATE_FOR_MERGE_CONTROLLER",
    ],
    githubApiCalled: false, branchMutated: false, remediationApplied: false, validationRerunPerformed: false,
    reviewRequested: false, reviewThreadResolved: false, mergePerformed: false, runtimeActivationAllowed: false,
    commandRunnerAdded: false, backgroundWorkerAdded: false, productionWriteAllowed: false,
    secretMaterialAllowed: false, ownerOperationRequired: false, authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalRemediationRereviewPlan() { return deepFreeze(deepCopy(PLAN)) }
export function remediationRereviewPlanContentHash(value = PLAN) { return contentHash(value) }
export const REMEDIATION_REREVIEW_METADATA = Object.freeze({ remediationId: PLAN.remediationId, workOrderId: PLAN.workOrderId, repository: PLAN.repository, contentHash: PLAN_HASH })
export function canonicalRemediationRereviewJson(value) { return canonicalJson(value) }
