import crypto from "node:crypto"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const BRANCH = /^codex\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,240}[A-Za-z0-9])?$/
const BASE_REF = /^refs\/heads\/[A-Za-z0-9](?:[A-Za-z0-9._\/-]{0,254}[A-Za-z0-9])?$/
const SHA_40 = /^[0-9a-f]{40}$/
const RESERVED_PATH = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "planId",
  "workOrderId",
  "repository",
  "baseRef",
  "baseCommitSha",
  "baseTreeHash",
  "branch",
  "commitMessage",
  "reservedPaths",
  "changedPaths",
  "foreignChanges",
  "secretScan",
  "authority",
  "attribution",
  "rollback",
  "safety",
])
const AUTHORITY_FIELDS = new Set([
  "activeProgramGrant",
  "preventiveTrustGatePassed",
  "reservationVerified",
  "leaseFenceVerified",
  "authorityScope",
])
const ATTRIBUTION_FIELDS = new Set(["actor", "email", "providerId", "workerId"])
const SECRET_SCAN_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const ROLLBACK_FIELDS = new Set(["remoteBranchDeleteAllowed", "rollbackCommitMode", "rollbackEvidenceRequired"])
const SAFETY_FIELDS = new Set([
  "destructiveOperationAllowed",
  "forcePushAllowed",
  "tagAllowed",
  "releaseAllowed",
  "productionWriteAllowed",
  "secretMaterialAllowed",
  "ownerOperationRequired",
])

export class BranchCommitPushAutomationError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "BranchCommitPushAutomationError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new BranchCommitPushAutomationError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("GIT_LIFECYCLE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("GIT_LIFECYCLE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("GIT_LIFECYCLE_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function text(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) {
    wall("GIT_LIFECYCLE_FORMAT_WALL", field)
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

const EMBEDDED_GIT_LIFECYCLE_PLAN = deepFreeze({
  schemaVersion: 1,
  artifactType: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_PLAN",
  planId: "plan-wo-mao-037-branch-commit-push-v1",
  workOrderId: "WO-MAO-037",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "a553abf39299a1aecd7d97368bd212699483da61",
  baseTreeHash: "fca0bb39bac595e42abfd95f41aedfcf5f7fac4b",
  branch: "codex/wo-mao-037-governed-delivery",
  commitMessage: "feat(operator): prove governed branch commit push automation",
  reservedPaths: [
    "components/operator/multi-agent-branch-delivery-registry.ts",
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
    "scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs",
    "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
    "tests/multi-agent-branch-commit-push-automation.test.ts",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-branch-delivery-registry.ts",
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-037-branch-commit-push-automation.md",
    "scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs",
    "scripts/multi-agent-operator/branch-commit-push-automation.mjs",
    "tests/multi-agent-branch-commit-push-automation.test.ts",
    "tests/multi-agent-capability-registry.test.ts",
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
    reservationVerified: true,
    leaseFenceVerified: true,
    authorityScope: "BRANCH_COMMIT_PUSH_RESERVED_PATHS_ONLY",
  },
  attribution: {
    actor: "bsvalues",
    email: "bsvalues@gmail.com",
    providerId: "hosted-codex",
    workerId: "hosted-codex-current-session",
  },
  rollback: {
    remoteBranchDeleteAllowed: true,
    rollbackCommitMode: "REVERT_OR_CLOSE_PR_ONLY",
    rollbackEvidenceRequired: true,
  },
  safety: {
    destructiveOperationAllowed: false,
    forcePushAllowed: false,
    tagAllowed: false,
    releaseAllowed: false,
    productionWriteAllowed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
  },
})

const EMBEDDED_GIT_LIFECYCLE_PLAN_HASH = "9ad3e845c4dec0ad9c152393aa2b7a8bd720ecfe14b91129056e8dfa32da1c77"

function stringArray(value, field, pattern = RESERVED_PATH) {
  if (!Array.isArray(value) || value.length === 0) wall("GIT_LIFECYCLE_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => {
    const item = text(entry, `${field}[${index}]`, pattern)
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) {
      wall("GIT_LIFECYCLE_PATH_WALL", `${field}[${index}]`, "SAFE_RESERVED_RELATIVE_PATH_REQUIRED")
    }
    return item
  }).sort()
  if (new Set(normalized).size !== normalized.length) wall("GIT_LIFECYCLE_DUPLICATE_WALL", field)
  return normalized
}

function booleanFalse(value, field) {
  if (value !== false) wall("GIT_LIFECYCLE_SAFETY_WALL", field, "FALSE_REQUIRED")
}

function validatePlan(plan) {
  if (contentHash(plan) !== EMBEDDED_GIT_LIFECYCLE_PLAN_HASH) {
    wall("GIT_LIFECYCLE_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  }
  exactFields(plan, PLAN_FIELDS, "plan")
  text(plan.planId, "plan.planId")
  text(plan.workOrderId, "plan.workOrderId", WORK_ORDER_ID)
  if (plan.workOrderId !== "WO-MAO-037") wall("GIT_LIFECYCLE_SCOPE_WALL", "plan.workOrderId", "WO-MAO-037_REQUIRED")
  text(plan.repository, "plan.repository", REPOSITORY)
  if (plan.repository !== "bsvalues/terragroq") wall("GIT_LIFECYCLE_SCOPE_WALL", "plan.repository", "TARGET_REPOSITORY_REQUIRED")
  text(plan.baseRef, "plan.baseRef", BASE_REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA_40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA_40)
  text(plan.branch, "plan.branch", BRANCH)
  if (typeof plan.commitMessage !== "string" || !plan.commitMessage.startsWith("feat(operator): ")) {
    wall("GIT_LIFECYCLE_COMMIT_WALL", "plan.commitMessage", "OPERATOR_CONVENTIONAL_COMMIT_REQUIRED")
  }
  const reservedPaths = stringArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = stringArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) {
    wall("GIT_LIFECYCLE_RESERVATION_WALL", "changedPaths", "CHANGED_PATH_OUTSIDE_RESERVATION")
  }
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) {
    wall("GIT_LIFECYCLE_FOREIGN_CHANGE_WALL", "foreignChanges", "EMPTY_REQUIRED")
  }
  exactFields(plan.secretScan, SECRET_SCAN_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) {
    wall("GIT_LIFECYCLE_SECRET_WALL", "secretScan", "PASS_ZERO_FINDINGS_REQUIRED")
  }
  exactFields(plan.authority, AUTHORITY_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.preventiveTrustGatePassed !== true
    || plan.authority.reservationVerified !== true
    || plan.authority.leaseFenceVerified !== true
    || plan.authority.authorityScope !== "BRANCH_COMMIT_PUSH_RESERVED_PATHS_ONLY") {
    wall("GIT_LIFECYCLE_AUTHORITY_WALL", "authority", "ACTIVE_SCOPED_GRANT_AND_TRUST_GATE_REQUIRED")
  }
  exactFields(plan.attribution, ATTRIBUTION_FIELDS, "attribution")
  if (plan.attribution.actor !== "bsvalues" || plan.attribution.providerId !== "hosted-codex") {
    wall("GIT_LIFECYCLE_ATTRIBUTION_WALL", "attribution", "ATTRIBUTABLE_HOSTED_CODEX_REQUIRED")
  }
  exactFields(plan.rollback, ROLLBACK_FIELDS, "rollback")
  if (plan.rollback.remoteBranchDeleteAllowed !== true || plan.rollback.rollbackEvidenceRequired !== true
    || plan.rollback.rollbackCommitMode !== "REVERT_OR_CLOSE_PR_ONLY") {
    wall("GIT_LIFECYCLE_ROLLBACK_WALL", "rollback", "REVERSIBLE_BRANCH_PLAN_REQUIRED")
  }
  exactFields(plan.safety, SAFETY_FIELDS, "safety")
  for (const field of SAFETY_FIELDS) booleanFalse(plan.safety[field], `safety.${field}`)
  return { reservedPaths, changedPaths }
}

export function evaluateBranchCommitPushAutomation() {
  wall(
    "GIT_LIFECYCLE_HOST_TRUST_WALL",
    "branchCommitPushAutomation",
    "CALLER_SUPPLIED_GIT_LIFECYCLE_INPUT_REJECTED_USE_CANONICAL_PLAN",
  )
}

export function verifyCanonicalBranchCommitPushPlan(value = EMBEDDED_GIT_LIFECYCLE_PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "GIT_LIFECYCLE_PLAN_VERIFIED",
    contentHash: EMBEDDED_GIT_LIFECYCLE_PLAN_HASH,
    gitCommandPerformed: false,
    branchCreated: false,
    commitCreated: false,
    pushed: false,
    authorityGranted: false,
  })
}

export function runCanonicalBranchCommitPushAutomation() {
  const { reservedPaths, changedPaths } = validatePlan(EMBEDDED_GIT_LIFECYCLE_PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_RESULT",
    workOrderId: "WO-MAO-037",
    status: "BRANCH_COMMIT_PUSH_AUTOMATION_PROVEN",
    planId: EMBEDDED_GIT_LIFECYCLE_PLAN.planId,
    planContentHash: EMBEDDED_GIT_LIFECYCLE_PLAN_HASH,
    repository: EMBEDDED_GIT_LIFECYCLE_PLAN.repository,
    branch: EMBEDDED_GIT_LIFECYCLE_PLAN.branch,
    baseRef: EMBEDDED_GIT_LIFECYCLE_PLAN.baseRef,
    baseCommitSha: EMBEDDED_GIT_LIFECYCLE_PLAN.baseCommitSha,
    baseTreeHash: EMBEDDED_GIT_LIFECYCLE_PLAN.baseTreeHash,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
    foreignChangeCount: EMBEDDED_GIT_LIFECYCLE_PLAN.foreignChanges.length,
    secretLikeFindings: EMBEDDED_GIT_LIFECYCLE_PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_ACTIVE_PROGRAM_GRANT",
      "VERIFY_PREVENTIVE_TRUST_GATE",
      "VERIFY_RESERVATION_AND_LEASE_FENCE",
      "CREATE_BRANCH",
      "STAGE_RESERVED_PATHS_ONLY",
      "COMMIT_WITH_ATTRIBUTION",
      "PUSH_BRANCH",
      "RECORD_ROLLBACK_EVIDENCE",
    ],
    gitCommandPerformed: false,
    branchCreated: false,
    commitCreated: false,
    pushed: false,
    destructiveOperationAllowed: false,
    forcePushAllowed: false,
    tagAllowed: false,
    releaseAllowed: false,
    productionWriteAllowed: false,
    secretMaterialAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function loadCanonicalBranchCommitPushPlan() {
  return deepFreeze(deepCopy(EMBEDDED_GIT_LIFECYCLE_PLAN))
}

export function branchCommitPushPlanContentHash(value = EMBEDDED_GIT_LIFECYCLE_PLAN) {
  return contentHash(value)
}

export const BRANCH_COMMIT_PUSH_AUTOMATION_METADATA = Object.freeze({
  planId: EMBEDDED_GIT_LIFECYCLE_PLAN.planId,
  workOrderId: EMBEDDED_GIT_LIFECYCLE_PLAN.workOrderId,
  repository: EMBEDDED_GIT_LIFECYCLE_PLAN.repository,
  branch: EMBEDDED_GIT_LIFECYCLE_PLAN.branch,
  contentHash: EMBEDDED_GIT_LIFECYCLE_PLAN_HASH,
})

export function canonicalBranchCommitPushAutomationJson(value) {
  return canonicalJson(value)
}
