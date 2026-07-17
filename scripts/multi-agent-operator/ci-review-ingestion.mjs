import crypto from "node:crypto"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const BASE_REF = /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/
const SHA_40 = /^[0-9a-f]{40}$/
const HASH_64 = /^[0-9a-f]{64}$/
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9 ._:/#(),+-]{1,180}$/
const RESERVED_PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "ingestionId",
  "workOrderId",
  "repository",
  "baseRef",
  "baseCommitSha",
  "baseTreeHash",
  "dependencyEvidence",
  "checkContexts",
  "reviewThreadClasses",
  "failureClasses",
  "terminalStates",
  "reservedPaths",
  "changedPaths",
  "foreignChanges",
  "secretScan",
  "authority",
  "safety",
])
const DEPENDENCY_EVIDENCE_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const CHECK_CONTEXT_FIELDS = new Set(["name", "required", "terminalState", "failureClass"])
const REVIEW_THREAD_CLASS_FIELDS = new Set(["class", "actionable", "downstreamOwner"])
const SECRET_SCAN_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTHORITY_FIELDS = new Set([
  "activeProgramGrant",
  "preventiveTrustGatePassed",
  "lifecycleTaxonomyVerified",
  "ownerTouchMeterVerified",
  "prPacketLinkageVerified",
  "authorityScope",
])
const SAFETY_FIELDS = new Set([
  "githubApiCalled",
  "checkRerunPerformed",
  "reviewThreadResolved",
  "reviewCommentPosted",
  "remediationPerformed",
  "mergePerformed",
  "runtimeActivationAllowed",
  "commandRunnerAdded",
  "backgroundWorkerAdded",
  "productionWriteAllowed",
  "secretMaterialAllowed",
  "ownerOperationRequired",
  "authorityGranted",
])

export class CiReviewIngestionError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "CiReviewIngestionError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new CiReviewIngestionError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("CI_REVIEW_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CI_REVIEW_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CI_REVIEW_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function text(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) {
    wall("CI_REVIEW_FORMAT_WALL", field)
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function contentHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy)
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepCopy(child)]))
  return value
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const EMBEDDED_CI_REVIEW_INGESTION_PLAN = deepFreeze({
  schemaVersion: 1,
  artifactType: "CANONICAL_CI_REVIEW_INGESTION_PLAN",
  ingestionId: "ingestion-wo-mao-039-ci-review-v1",
  workOrderId: "WO-MAO-039",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "365c42a4d64b3d374f6a4417624ce2df54460c0a",
  baseTreeHash: "41a7444b50bb2cd4f707d523cd5837c03e109221",
  dependencyEvidence: [
    {
      workOrderId: "WO-MAO-020",
      evidenceId: "docs/reports/WO-MAO-020-lifecycle-escalation-taxonomy.md",
      status: "LIFECYCLE_ESCALATION_TAXONOMY_VERIFIED",
      recordContentHash: "static-lifecycle-escalation-taxonomy",
    },
    {
      workOrderId: "WO-MAO-022",
      evidenceId: "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md",
      status: "OWNER_TOUCH_METER_ZERO_VERIFIED",
      recordContentHash: "static-doc-evidence-ledger-owner-touch-meter",
    },
    {
      workOrderId: "WO-MAO-038",
      evidenceId: "EVIDENCE-WO-MAO-038-PR-CREATION-PACKET-LINKAGE-V1",
      status: "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED",
      recordContentHash: "fa24625e6880da53255e0337ac49a03eb4cc4831f75001873f4426ae6ef0544f",
    },
  ],
  checkContexts: [
    { name: "CodeRabbit", required: true, terminalState: "SUCCESS", failureClass: "NONE" },
    { name: "Vercel", required: true, terminalState: "SUCCESS", failureClass: "NONE" },
    { name: "Vercel Preview Comments", required: true, terminalState: "SUCCESS", failureClass: "NONE" },
    { name: "Sourcery review", required: false, terminalState: "SKIPPED", failureClass: "PROVIDER" },
  ],
  reviewThreadClasses: [
    { class: "ACTIONABLE_PRODUCT", actionable: true, downstreamOwner: "WO-MAO-040" },
    { class: "POLICY_OR_AUTHORITY", actionable: false, downstreamOwner: "OWNER_DECISION_PACKET" },
    { class: "STALE_OR_OUTDATED", actionable: false, downstreamOwner: "WO-MAO-039" },
  ],
  failureClasses: [
    "PRODUCT",
    "FLAKY_INFRASTRUCTURE",
    "PROVIDER",
    "POLICY",
    "STALE_BASE",
  ],
  terminalStates: [
    "SUCCESS",
    "FAILURE",
    "CANCELLED",
    "SKIPPED",
    "TIMED_OUT",
  ],
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-ci-review-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-039-ci-review-ingestion.md",
    "scripts/multi-agent-operator/ci-review-ingestion-cli.mjs",
    "scripts/multi-agent-operator/ci-review-ingestion.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-ci-review-ingestion.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-ci-review-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-039-ci-review-ingestion.md",
    "scripts/multi-agent-operator/ci-review-ingestion-cli.mjs",
    "scripts/multi-agent-operator/ci-review-ingestion.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-ci-review-ingestion.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: {
    status: "PASS",
    scanner: "diff-secret-like-value-scan",
    secretLikeFindings: 0,
  },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    preventiveTrustGatePassed: true,
    lifecycleTaxonomyVerified: true,
    ownerTouchMeterVerified: true,
    prPacketLinkageVerified: true,
    authorityScope: "CI_REVIEW_INGESTION_CLASSIFICATION_ONLY",
  },
  safety: {
    githubApiCalled: false,
    checkRerunPerformed: false,
    reviewThreadResolved: false,
    reviewCommentPosted: false,
    remediationPerformed: false,
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

const EMBEDDED_CI_REVIEW_INGESTION_PLAN_HASH = "9eaac8aec1c65ec262b9d13227971a1a44a8705892906e2159f5d811814b067e"

function stringArray(value, field, pattern = SAFE_TEXT) {
  if (!Array.isArray(value) || value.length === 0) wall("CI_REVIEW_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("CI_REVIEW_DUPLICATE_WALL", field)
  return normalized
}

function pathArray(value, field) {
  const normalized = stringArray(value, field, RESERVED_PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) {
      wall("CI_REVIEW_PATH_WALL", `${field}[${index}]`, "SAFE_RESERVED_RELATIVE_PATH_REQUIRED")
    }
  }
  return normalized
}

function booleanFalse(value, field) {
  if (value !== false) wall("CI_REVIEW_SAFETY_WALL", field, "FALSE_REQUIRED")
}

function validateDependencyEvidence(value) {
  if (!Array.isArray(value) || value.length !== 3) {
    wall("CI_REVIEW_DEPENDENCY_WALL", "dependencyEvidence", "WO_MAO_020_022_038_REQUIRED")
  }
  const ids = value.map((entry, index) => {
    exactFields(entry, DEPENDENCY_EVIDENCE_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WORK_ORDER_ID)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, SAFE_TEXT)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) {
      text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH_64)
    }
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-020,WO-MAO-022,WO-MAO-038") {
    wall("CI_REVIEW_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
  }
  const linkage = value.find((entry) => entry.workOrderId === "WO-MAO-038")
  if (linkage.recordContentHash !== "fa24625e6880da53255e0337ac49a03eb4cc4831f75001873f4426ae6ef0544f"
    || linkage.status !== "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED") {
    wall("CI_REVIEW_DEPENDENCY_WALL", "dependencyEvidence[WO-MAO-038]", "VERIFIED_PR_LINKAGE_REQUIRED")
  }
}

function validateChecks(value) {
  if (!Array.isArray(value) || value.length < 3) wall("CI_REVIEW_CHECK_WALL", "checkContexts", "REQUIRED_CHECKS_MISSING")
  const required = new Set(["CodeRabbit", "Vercel", "Vercel Preview Comments"])
  for (const [index, context] of value.entries()) {
    exactFields(context, CHECK_CONTEXT_FIELDS, `checkContexts[${index}]`)
    text(context.name, `checkContexts[${index}].name`, SAFE_TEXT)
    if (typeof context.required !== "boolean") wall("CI_REVIEW_CHECK_WALL", `checkContexts[${index}].required`)
    text(context.terminalState, `checkContexts[${index}].terminalState`)
    text(context.failureClass, `checkContexts[${index}].failureClass`)
    if (context.required && context.terminalState !== "SUCCESS") {
      wall("CI_REVIEW_CHECK_WALL", `checkContexts[${index}].terminalState`, "REQUIRED_CHECK_NOT_GREEN")
    }
    required.delete(context.name)
  }
  if (required.size > 0) wall("CI_REVIEW_CHECK_WALL", "checkContexts", "REQUIRED_CHECKS_MISSING")
}

function validateReviewThreadClasses(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("CI_REVIEW_THREAD_WALL", "reviewThreadClasses", "CANONICAL_THREAD_CLASSES_REQUIRED")
  const classes = []
  for (const [index, entry] of value.entries()) {
    exactFields(entry, REVIEW_THREAD_CLASS_FIELDS, `reviewThreadClasses[${index}]`)
    text(entry.class, `reviewThreadClasses[${index}].class`)
    if (typeof entry.actionable !== "boolean") wall("CI_REVIEW_THREAD_WALL", `reviewThreadClasses[${index}].actionable`)
    text(entry.downstreamOwner, `reviewThreadClasses[${index}].downstreamOwner`, SAFE_TEXT)
    classes.push(entry.class)
  }
  for (const required of ["ACTIONABLE_PRODUCT", "POLICY_OR_AUTHORITY", "STALE_OR_OUTDATED"]) {
    if (!classes.includes(required)) wall("CI_REVIEW_THREAD_WALL", "reviewThreadClasses", `${required}_REQUIRED`)
  }
}

function validatePlan(plan) {
  if (contentHash(plan) !== EMBEDDED_CI_REVIEW_INGESTION_PLAN_HASH) {
    wall("CI_REVIEW_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  }
  exactFields(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_CI_REVIEW_INGESTION_PLAN") {
    wall("CI_REVIEW_SCHEMA_WALL", "plan", "CANONICAL_SCHEMA_REQUIRED")
  }
  text(plan.ingestionId, "plan.ingestionId")
  text(plan.workOrderId, "plan.workOrderId", WORK_ORDER_ID)
  if (plan.workOrderId !== "WO-MAO-039") wall("CI_REVIEW_SCOPE_WALL", "plan.workOrderId", "WO-MAO-039_REQUIRED")
  text(plan.repository, "plan.repository", REPOSITORY)
  if (plan.repository !== "bsvalues/terragroq") wall("CI_REVIEW_SCOPE_WALL", "plan.repository", "TARGET_REPOSITORY_REQUIRED")
  text(plan.baseRef, "plan.baseRef", BASE_REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA_40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA_40)
  validateDependencyEvidence(plan.dependencyEvidence)
  validateChecks(plan.checkContexts)
  validateReviewThreadClasses(plan.reviewThreadClasses)
  const failureClasses = stringArray(plan.failureClasses, "failureClasses")
  for (const required of ["PRODUCT", "FLAKY_INFRASTRUCTURE", "PROVIDER", "POLICY", "STALE_BASE"]) {
    if (!failureClasses.includes(required)) wall("CI_REVIEW_FAILURE_CLASS_WALL", "failureClasses", `${required}_REQUIRED`)
  }
  stringArray(plan.terminalStates, "terminalStates")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) {
    wall("CI_REVIEW_RESERVATION_WALL", "changedPaths", "CHANGED_PATH_OUTSIDE_RESERVATION")
  }
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) {
    wall("CI_REVIEW_FOREIGN_CHANGE_WALL", "foreignChanges", "EMPTY_REQUIRED")
  }
  exactFields(plan.secretScan, SECRET_SCAN_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) {
    wall("CI_REVIEW_SECRET_WALL", "secretScan", "PASS_ZERO_FINDINGS_REQUIRED")
  }
  exactFields(plan.authority, AUTHORITY_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.preventiveTrustGatePassed !== true
    || plan.authority.lifecycleTaxonomyVerified !== true
    || plan.authority.ownerTouchMeterVerified !== true
    || plan.authority.prPacketLinkageVerified !== true
    || plan.authority.authorityScope !== "CI_REVIEW_INGESTION_CLASSIFICATION_ONLY") {
    wall("CI_REVIEW_AUTHORITY_WALL", "authority", "ACTIVE_SCOPED_GRANT_AND_EVIDENCE_REQUIRED")
  }
  exactFields(plan.safety, SAFETY_FIELDS, "safety")
  for (const field of SAFETY_FIELDS) booleanFalse(plan.safety[field], `safety.${field}`)
  return {
    requiredCheckCount: plan.checkContexts.filter((context) => context.required).length,
    optionalCheckCount: plan.checkContexts.filter((context) => !context.required).length,
    reviewThreadClassCount: plan.reviewThreadClasses.length,
    failureClassCount: failureClasses.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateCiReviewIngestion() {
  wall(
    "CI_REVIEW_HOST_TRUST_WALL",
    "ciReviewIngestion",
    "CALLER_SUPPLIED_CI_REVIEW_INPUT_REJECTED_USE_CANONICAL_PLAN",
  )
}

export function verifyCanonicalCiReviewIngestionPlan(value = EMBEDDED_CI_REVIEW_INGESTION_PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "CI_REVIEW_INGESTION_PLAN_VERIFIED",
    contentHash: EMBEDDED_CI_REVIEW_INGESTION_PLAN_HASH,
    githubApiCalled: false,
    checkRerunPerformed: false,
    reviewThreadResolved: false,
    remediationPerformed: false,
    mergePerformed: false,
    authorityGranted: false,
  })
}

export function runCanonicalCiReviewIngestion() {
  const counts = validatePlan(EMBEDDED_CI_REVIEW_INGESTION_PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "CI_REVIEW_INGESTION_RESULT",
    workOrderId: "WO-MAO-039",
    status: "CI_REVIEW_INGESTION_PROVEN",
    ingestionId: EMBEDDED_CI_REVIEW_INGESTION_PLAN.ingestionId,
    planContentHash: EMBEDDED_CI_REVIEW_INGESTION_PLAN_HASH,
    repository: EMBEDDED_CI_REVIEW_INGESTION_PLAN.repository,
    baseRef: EMBEDDED_CI_REVIEW_INGESTION_PLAN.baseRef,
    baseCommitSha: EMBEDDED_CI_REVIEW_INGESTION_PLAN.baseCommitSha,
    baseTreeHash: EMBEDDED_CI_REVIEW_INGESTION_PLAN.baseTreeHash,
    dependencyWorkOrders: EMBEDDED_CI_REVIEW_INGESTION_PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    ...counts,
    foreignChangeCount: EMBEDDED_CI_REVIEW_INGESTION_PLAN.foreignChanges.length,
    secretLikeFindings: EMBEDDED_CI_REVIEW_INGESTION_PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_LIFECYCLE_ESCALATION_TAXONOMY",
      "VERIFY_OWNER_TOUCH_METER_EVIDENCE",
      "VERIFY_PR_PACKET_LINKAGE_EVIDENCE",
      "OBSERVE_REQUIRED_CHECK_TERMINAL_STATES",
      "CLASSIFY_REVIEW_THREADS",
      "CLASSIFY_FAILURE_SOURCE",
      "RECORD_TERMINAL_INGESTION_FOR_REMEDIATION_GATE",
    ],
    githubApiCalled: false,
    checkRerunPerformed: false,
    reviewThreadResolved: false,
    reviewCommentPosted: false,
    remediationPerformed: false,
    mergePerformed: false,
    runtimeActivationAllowed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    productionWriteAllowed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function loadCanonicalCiReviewIngestionPlan() {
  return deepFreeze(deepCopy(EMBEDDED_CI_REVIEW_INGESTION_PLAN))
}

export function ciReviewIngestionPlanContentHash(value = EMBEDDED_CI_REVIEW_INGESTION_PLAN) {
  return contentHash(value)
}

export const CI_REVIEW_INGESTION_METADATA = Object.freeze({
  ingestionId: EMBEDDED_CI_REVIEW_INGESTION_PLAN.ingestionId,
  workOrderId: EMBEDDED_CI_REVIEW_INGESTION_PLAN.workOrderId,
  repository: EMBEDDED_CI_REVIEW_INGESTION_PLAN.repository,
  contentHash: EMBEDDED_CI_REVIEW_INGESTION_PLAN_HASH,
})

export function canonicalCiReviewIngestionJson(value) {
  return canonicalJson(value)
}
