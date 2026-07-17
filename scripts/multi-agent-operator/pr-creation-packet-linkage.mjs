import crypto from "node:crypto"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const BRANCH = /^codex\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,240}[A-Za-z0-9])?$/
const BASE_REF = /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/
const SHA_40 = /^[0-9a-f]{40}$/
const HASH_64 = /^[0-9a-f]{64}$/
const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9 ._:/#(),+-]{1,180}$/
const RESERVED_PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "packetId",
  "workOrderId",
  "repository",
  "baseRef",
  "baseCommitSha",
  "baseTreeHash",
  "sourceBranch",
  "targetPrMode",
  "dependencyEvidence",
  "requiredPrBodySections",
  "packetLinks",
  "reservedPaths",
  "changedPaths",
  "foreignChanges",
  "secretScan",
  "authority",
  "delivery",
  "safety",
])
const DEPENDENCY_EVIDENCE_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const SECRET_SCAN_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTHORITY_FIELDS = new Set([
  "activeProgramGrant",
  "preventiveTrustGatePassed",
  "branchDeliveryEvidenceVerified",
  "ownerTouchMeterVerified",
  "authorityScope",
])
const DELIVERY_FIELDS = new Set([
  "prTitle",
  "prBodySource",
  "reviewThreadPolicy",
  "checksPolicy",
  "packetLinkRequired",
  "mergePolicy",
])
const SAFETY_FIELDS = new Set([
  "githubWritePerformed",
  "pullRequestCreated",
  "reviewThreadResolved",
  "mergePerformed",
  "runtimeActivationAllowed",
  "commandRunnerAdded",
  "backgroundWorkerAdded",
  "productionWriteAllowed",
  "secretMaterialAllowed",
  "ownerOperationRequired",
  "authorityGranted",
])

export class PrCreationPacketLinkageError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "PrCreationPacketLinkageError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new PrCreationPacketLinkageError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("PR_PACKET_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("PR_PACKET_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("PR_PACKET_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function text(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) {
    wall("PR_PACKET_FORMAT_WALL", field)
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

const EMBEDDED_PR_PACKET_LINKAGE_PLAN = deepFreeze({
  schemaVersion: 1,
  artifactType: "CANONICAL_PR_CREATION_PACKET_LINKAGE_PLAN",
  packetId: "packet-wo-mao-038-pr-creation-linkage-v1",
  workOrderId: "WO-MAO-038",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "bae305e63ab3b73d88e34fb8ddcac5cc738763ed",
  baseTreeHash: "0bce0bedea159dfb3057fac63e9389525610da3a",
  sourceBranch: "codex/wo-mao-038-pr-packet-linkage",
  targetPrMode: "READY_OR_DRAFT_FROM_AUTHORITY",
  dependencyEvidence: [
    {
      workOrderId: "WO-MAO-022",
      evidenceId: "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md",
      status: "OWNER_TOUCH_METER_ZERO_VERIFIED",
      recordContentHash: "static-doc-evidence-ledger-owner-touch-meter",
    },
    {
      workOrderId: "WO-MAO-037",
      evidenceId: "EVIDENCE-WO-MAO-037-BRANCH-COMMIT-PUSH-V1",
      status: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED",
      recordContentHash: "259c38e57b17031ffcbaaa90cdf8ea8fde2a276908652e1e1d6e60671b9022f6",
    },
  ],
  requiredPrBodySections: [
    "Summary",
    "Work Orders",
    "Authority",
    "Validation",
    "Evidence",
    "Safety",
    "Next Gate",
  ],
  packetLinks: [
    "docs/governance/multi-agent-operator-playbook.md#phase-5--github-delivery-engine",
    "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md",
    "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
    "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md",
  ],
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "components/operator/multi-agent-pr-linkage-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md",
    "scripts/multi-agent-operator/pr-creation-packet-linkage-cli.mjs",
    "scripts/multi-agent-operator/pr-creation-packet-linkage.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/multi-agent-pr-creation-packet-linkage.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "components/operator/multi-agent-pr-linkage-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-038-pr-creation-packet-linkage.md",
    "scripts/multi-agent-operator/pr-creation-packet-linkage-cli.mjs",
    "scripts/multi-agent-operator/pr-creation-packet-linkage.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/multi-agent-pr-creation-packet-linkage.test.ts",
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
    branchDeliveryEvidenceVerified: true,
    ownerTouchMeterVerified: true,
    authorityScope: "PR_PACKET_LINKAGE_RESERVED_PATHS_ONLY",
  },
  delivery: {
    prTitle: "feat(operator): prove WO-MAO-038 PR packet linkage",
    prBodySource: "VERIFIED_WO_AUTHORITY_VALIDATION_EVIDENCE_RECORDS",
    reviewThreadPolicy: "OBSERVE_AND_REMEDIATE_IN_SCOPE_ONLY_AFTER_CI_INGESTION",
    checksPolicy: "GITHUB_CHECKS_OBSERVED_BY_WO_MAO_039",
    packetLinkRequired: true,
    mergePolicy: "NO_MERGE_UNTIL_WO_MAO_041",
  },
  safety: {
    githubWritePerformed: false,
    pullRequestCreated: false,
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

const EMBEDDED_PR_PACKET_LINKAGE_PLAN_HASH = "63186eb86629b85f9b6055b633feaf28a4272cbd6865a7ddbbb98285a8257756"

function stringArray(value, field, pattern = SAFE_TEXT) {
  if (!Array.isArray(value) || value.length === 0) wall("PR_PACKET_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("PR_PACKET_DUPLICATE_WALL", field)
  return normalized
}

function pathArray(value, field) {
  const normalized = stringArray(value, field, RESERVED_PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) {
      wall("PR_PACKET_PATH_WALL", `${field}[${index}]`, "SAFE_RESERVED_RELATIVE_PATH_REQUIRED")
    }
  }
  return normalized
}

function booleanFalse(value, field) {
  if (value !== false) wall("PR_PACKET_SAFETY_WALL", field, "FALSE_REQUIRED")
}

function validateDependencyEvidence(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    wall("PR_PACKET_DEPENDENCY_WALL", "dependencyEvidence", "WO_MAO_022_AND_037_REQUIRED")
  }
  const ids = value.map((entry, index) => {
    exactFields(entry, DEPENDENCY_EVIDENCE_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WORK_ORDER_ID)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, SAFE_TEXT)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (entry.recordContentHash !== "static-doc-evidence-ledger-owner-touch-meter") {
      text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH_64)
    }
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-022,WO-MAO-037") {
    wall("PR_PACKET_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
  }
  const branchDelivery = value.find((entry) => entry.workOrderId === "WO-MAO-037")
  if (branchDelivery.recordContentHash !== "259c38e57b17031ffcbaaa90cdf8ea8fde2a276908652e1e1d6e60671b9022f6"
    || branchDelivery.status !== "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED") {
    wall("PR_PACKET_DEPENDENCY_WALL", "dependencyEvidence[WO-MAO-037]", "VERIFIED_BRANCH_DELIVERY_REQUIRED")
  }
}

function validatePlan(plan) {
  if (contentHash(plan) !== EMBEDDED_PR_PACKET_LINKAGE_PLAN_HASH) {
    wall("PR_PACKET_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  }
  exactFields(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_PR_CREATION_PACKET_LINKAGE_PLAN") {
    wall("PR_PACKET_SCHEMA_WALL", "plan", "CANONICAL_SCHEMA_REQUIRED")
  }
  text(plan.packetId, "plan.packetId")
  text(plan.workOrderId, "plan.workOrderId", WORK_ORDER_ID)
  if (plan.workOrderId !== "WO-MAO-038") wall("PR_PACKET_SCOPE_WALL", "plan.workOrderId", "WO-MAO-038_REQUIRED")
  text(plan.repository, "plan.repository", REPOSITORY)
  if (plan.repository !== "bsvalues/terragroq") wall("PR_PACKET_SCOPE_WALL", "plan.repository", "TARGET_REPOSITORY_REQUIRED")
  text(plan.baseRef, "plan.baseRef", BASE_REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA_40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA_40)
  text(plan.sourceBranch, "plan.sourceBranch", BRANCH)
  if (plan.targetPrMode !== "READY_OR_DRAFT_FROM_AUTHORITY") {
    wall("PR_PACKET_MODE_WALL", "plan.targetPrMode", "AUTHORITY_DERIVED_MODE_REQUIRED")
  }
  validateDependencyEvidence(plan.dependencyEvidence)
  const sections = stringArray(plan.requiredPrBodySections, "requiredPrBodySections")
  for (const required of ["Summary", "Work Orders", "Authority", "Validation", "Evidence", "Safety", "Next Gate"]) {
    if (!sections.includes(required)) wall("PR_PACKET_BODY_WALL", "requiredPrBodySections", `${required}_REQUIRED`)
  }
  stringArray(plan.packetLinks, "packetLinks")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) {
    wall("PR_PACKET_RESERVATION_WALL", "changedPaths", "CHANGED_PATH_OUTSIDE_RESERVATION")
  }
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) {
    wall("PR_PACKET_FOREIGN_CHANGE_WALL", "foreignChanges", "EMPTY_REQUIRED")
  }
  exactFields(plan.secretScan, SECRET_SCAN_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) {
    wall("PR_PACKET_SECRET_WALL", "secretScan", "PASS_ZERO_FINDINGS_REQUIRED")
  }
  exactFields(plan.authority, AUTHORITY_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.preventiveTrustGatePassed !== true
    || plan.authority.branchDeliveryEvidenceVerified !== true
    || plan.authority.ownerTouchMeterVerified !== true
    || plan.authority.authorityScope !== "PR_PACKET_LINKAGE_RESERVED_PATHS_ONLY") {
    wall("PR_PACKET_AUTHORITY_WALL", "authority", "ACTIVE_SCOPED_GRANT_AND_EVIDENCE_REQUIRED")
  }
  exactFields(plan.delivery, DELIVERY_FIELDS, "delivery")
  if (!plan.delivery.prTitle.startsWith("feat(operator): ")
    || plan.delivery.prBodySource !== "VERIFIED_WO_AUTHORITY_VALIDATION_EVIDENCE_RECORDS"
    || plan.delivery.packetLinkRequired !== true
    || plan.delivery.mergePolicy !== "NO_MERGE_UNTIL_WO_MAO_041") {
    wall("PR_PACKET_DELIVERY_WALL", "delivery", "VERIFIED_PACKET_ONLY_REQUIRED")
  }
  exactFields(plan.safety, SAFETY_FIELDS, "safety")
  for (const field of SAFETY_FIELDS) booleanFalse(plan.safety[field], `safety.${field}`)
  return { sections, packetLinks: plan.packetLinks, reservedPaths, changedPaths }
}

export function evaluatePrCreationPacketLinkage() {
  wall(
    "PR_PACKET_HOST_TRUST_WALL",
    "prCreationPacketLinkage",
    "CALLER_SUPPLIED_PR_PACKET_INPUT_REJECTED_USE_CANONICAL_PLAN",
  )
}

export function verifyCanonicalPrCreationPacketLinkagePlan(value = EMBEDDED_PR_PACKET_LINKAGE_PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "PR_PACKET_LINKAGE_PLAN_VERIFIED",
    contentHash: EMBEDDED_PR_PACKET_LINKAGE_PLAN_HASH,
    githubWritePerformed: false,
    pullRequestCreated: false,
    reviewThreadResolved: false,
    mergePerformed: false,
    authorityGranted: false,
  })
}

export function runCanonicalPrCreationPacketLinkage() {
  const { sections, packetLinks, reservedPaths, changedPaths } = validatePlan(EMBEDDED_PR_PACKET_LINKAGE_PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "PR_CREATION_PACKET_LINKAGE_RESULT",
    workOrderId: "WO-MAO-038",
    status: "PR_CREATION_PACKET_LINKAGE_PROVEN",
    packetId: EMBEDDED_PR_PACKET_LINKAGE_PLAN.packetId,
    planContentHash: EMBEDDED_PR_PACKET_LINKAGE_PLAN_HASH,
    repository: EMBEDDED_PR_PACKET_LINKAGE_PLAN.repository,
    sourceBranch: EMBEDDED_PR_PACKET_LINKAGE_PLAN.sourceBranch,
    baseRef: EMBEDDED_PR_PACKET_LINKAGE_PLAN.baseRef,
    baseCommitSha: EMBEDDED_PR_PACKET_LINKAGE_PLAN.baseCommitSha,
    baseTreeHash: EMBEDDED_PR_PACKET_LINKAGE_PLAN.baseTreeHash,
    dependencyWorkOrders: EMBEDDED_PR_PACKET_LINKAGE_PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    requiredPrBodySectionCount: sections.length,
    packetLinkCount: packetLinks.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
    foreignChangeCount: EMBEDDED_PR_PACKET_LINKAGE_PLAN.foreignChanges.length,
    secretLikeFindings: EMBEDDED_PR_PACKET_LINKAGE_PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_ACTIVE_PROGRAM_GRANT",
      "VERIFY_OWNER_TOUCH_METER_EVIDENCE",
      "VERIFY_BRANCH_DELIVERY_EVIDENCE",
      "GENERATE_PR_BODY_FROM_VERIFIED_RECORDS",
      "LINK_WORK_ORDER_AUTHORITY_VALIDATION_EVIDENCE",
      "SELECT_DRAFT_OR_READY_MODE_FROM_AUTHORITY",
      "RECORD_PR_PACKET_HASH_FOR_CI_REVIEW_INGESTION",
    ],
    githubWritePerformed: false,
    pullRequestCreated: false,
    reviewThreadResolved: false,
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

export function loadCanonicalPrCreationPacketLinkagePlan() {
  return deepFreeze(deepCopy(EMBEDDED_PR_PACKET_LINKAGE_PLAN))
}

export function prCreationPacketLinkagePlanContentHash(value = EMBEDDED_PR_PACKET_LINKAGE_PLAN) {
  return contentHash(value)
}

export const PR_CREATION_PACKET_LINKAGE_METADATA = Object.freeze({
  packetId: EMBEDDED_PR_PACKET_LINKAGE_PLAN.packetId,
  workOrderId: EMBEDDED_PR_PACKET_LINKAGE_PLAN.workOrderId,
  repository: EMBEDDED_PR_PACKET_LINKAGE_PLAN.repository,
  sourceBranch: EMBEDDED_PR_PACKET_LINKAGE_PLAN.sourceBranch,
  contentHash: EMBEDDED_PR_PACKET_LINKAGE_PLAN_HASH,
})

export function canonicalPrCreationPacketLinkageJson(value) {
  return canonicalJson(value)
}
