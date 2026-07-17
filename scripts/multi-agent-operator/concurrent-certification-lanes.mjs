import crypto from "node:crypto"

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WO = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*$/
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const REF = /^refs\/heads\/[A-Za-z0-9._\/-]+$/
const SHA40 = /^[0-9a-f]{40}$/
const HASH64 = /^[a-f0-9]{64}$/
const PATH = /^[A-Za-z0-9][A-Za-z0-9._\/:-]{0,220}$/
const PHRASE = /^[A-Za-z0-9][A-Za-z0-9 ._\/:-]{0,220}$/
const PROHIBITED_PATH = /(^|\/)(\.git|\.env|\.next|node_modules|\.obsidian|secrets?)(\/|$)|(^|\/).*\.(key|pem|p12|pfx)$/i

const PLAN_FIELDS = new Set([
  "schemaVersion", "artifactType", "executionId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "builderLanes", "fanInProjection",
  "assurance", "providerExclusions", "reservedPaths", "changedPaths", "foreignChanges",
  "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const LANE_FIELDS = new Set(["laneId", "provider", "programId", "workOrderId", "reservation", "artifactPath", "status"])
const FANIN_FIELDS = new Set(["laneId", "dependsOn", "status", "releaseTarget"])
const ASSURANCE_FIELDS = new Set(["agentRole", "mode", "required", "status"])
const EXCLUSION_FIELDS = new Set(["provider", "reasonCode", "sourceWorkOrderId", "selected"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "certificationPortfolioVerified", "certificationAuthorityGranted"])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed", "productionWritePerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class ConcurrentCertificationLanesError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "ConcurrentCertificationLanesError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new ConcurrentCertificationLanesError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("CONCURRENT_CERTIFICATION_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CONCURRENT_CERTIFICATION_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CONCURRENT_CERTIFICATION_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("CONCURRENT_CERTIFICATION_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_CONCURRENT_CERTIFICATION_LANES",
  executionId: "concurrent-certification-lanes-wo-mao-055-v1",
  workOrderId: "WO-MAO-055",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "af656d442b6ca47fc7f12bd1ac46a7b7ccdd4a13",
  baseTreeHash: "1f12d7e2d8ed87d148f3f68272775f0768b299fb",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-054", evidenceId: "EVIDENCE-WO-MAO-054-CERTIFICATION-PORTFOLIO-SELECTION-V1", status: "CANONICAL_CERTIFICATION_PORTFOLIO_SELECTION_VERIFIED", recordContentHash: "8a49d67f9425f059bdcfbf05cead09d25bf3cde425710a6f6528af3bc0227493" },
  ],
  builderLanes: [
    {
      laneId: "codex-release-engineering-foundation",
      provider: "CODEX",
      programId: "PROGRAM-RELEASE-ENGINEERING-001",
      workOrderId: "WO-RELEASE-001",
      reservation: "docs/reports/release-engineering",
      artifactPath: "docs/reports/release-engineering/WO-RELEASE-001-current-release-evidence-reconciliation.md",
      status: "EXECUTED_STATIC_USEFUL_LANE",
    },
    {
      laneId: "codex-devex-hook-tooling-foundation",
      provider: "CODEX",
      programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
      workOrderId: "WO-DEVEX-HOOK-TOOLING-001",
      reservation: "docs/reports/devex-hook-tooling",
      artifactPath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-001-evidence-reconciliation.md",
      status: "EXECUTED_STATIC_USEFUL_LANE",
    },
  ],
  fanInProjection: {
    laneId: "codex-certification-fanin-release",
    dependsOn: ["codex-release-engineering-foundation", "codex-devex-hook-tooling-foundation"],
    status: "READY_AFTER_BUILDER_LANES",
    releaseTarget: "WO-MAO-058",
  },
  assurance: {
    agentRole: "independent-assurance",
    mode: "EVIDENCE_AND_RESERVATION_REVIEW",
    required: true,
    status: "RECORDED_FOR_WO_MAO_056",
  },
  providerExclusions: [
    { provider: "CLAUDE_CODE", reasonCode: "PROVIDER_UNAVAILABLE_WO_MAO_032", sourceWorkOrderId: "WO-MAO-032", selected: false },
  ],
  reservedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-concurrent-certification-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-055-concurrent-certification-lanes.md",
    "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-001-evidence-reconciliation.md",
    "docs/reports/release-engineering/WO-RELEASE-001-current-release-evidence-reconciliation.md",
    "scripts/multi-agent-operator/concurrent-certification-lanes-cli.mjs",
    "scripts/multi-agent-operator/concurrent-certification-lanes.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-concurrent-certification-lanes.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-capability-registry.ts",
    "components/operator/multi-agent-concurrent-certification-registry.ts",
    "components/operator/multi-agent-operator-registry.ts",
    "docs/governance/active-program-queue.md",
    "docs/governance/goal-registry.md",
    "docs/governance/loop-registry.md",
    "docs/governance/multi-agent-operator-playbook.md",
    "docs/reports/WO-MAO-000-multi-agent-operator-rollup.md",
    "docs/reports/WO-MAO-055-concurrent-certification-lanes.md",
    "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-001-evidence-reconciliation.md",
    "docs/reports/release-engineering/WO-RELEASE-001-current-release-evidence-reconciliation.md",
    "scripts/multi-agent-operator/concurrent-certification-lanes-cli.mjs",
    "scripts/multi-agent-operator/concurrent-certification-lanes.mjs",
    "tests/multi-agent-capability-registry.test.ts",
    "tests/multi-agent-concurrent-certification-lanes.test.ts",
    "tests/multi-agent-operator-registry.test.ts",
    "tests/portfolio-operator-surface.test.ts",
    "tests/portfolio-operator.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "CONCURRENT_CERTIFICATION_LANE_EXECUTION_STATIC_USEFUL_WORK",
    certificationPortfolioVerified: true,
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

const PLAN_HASH = "d2f44190ca117bfc9ec34fbbac0fbe73ae656fcd17f835f4f07c0a22906c5e51"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("CONCURRENT_CERTIFICATION_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("CONCURRENT_CERTIFICATION_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("CONCURRENT_CERTIFICATION_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("CONCURRENT_CERTIFICATION_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_CONCURRENT_CERTIFICATION_LANES") wall("CONCURRENT_CERTIFICATION_SCHEMA_WALL", "plan")
  text(plan.executionId, "plan.executionId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-055") wall("CONCURRENT_CERTIFICATION_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  if (!Array.isArray(plan.dependencyEvidence) || plan.dependencyEvidence.length !== 1) wall("CONCURRENT_CERTIFICATION_DEPENDENCY_WALL", "dependencyEvidence")
  exact(plan.dependencyEvidence[0], DEP_FIELDS, "dependencyEvidence[0]")
  if (plan.dependencyEvidence[0].workOrderId !== "WO-MAO-054") wall("CONCURRENT_CERTIFICATION_DEPENDENCY_WALL", "dependencyEvidence[0].workOrderId")
  text(plan.dependencyEvidence[0].recordContentHash, "dependencyEvidence[0].recordContentHash", HASH64)
  if (!Array.isArray(plan.builderLanes) || plan.builderLanes.length !== 2) wall("CONCURRENT_CERTIFICATION_LANE_WALL", "builderLanes")
  const laneIds = []
  const reservations = []
  for (const [index, lane] of plan.builderLanes.entries()) {
    exact(lane, LANE_FIELDS, `builderLanes[${index}]`)
    laneIds.push(text(lane.laneId, `builderLanes[${index}].laneId`))
    if (lane.provider !== "CODEX") wall("CONCURRENT_CERTIFICATION_PROVIDER_WALL", `builderLanes[${index}].provider`)
    text(lane.programId, `builderLanes[${index}].programId`)
    text(lane.workOrderId, `builderLanes[${index}].workOrderId`, WO)
    reservations.push(text(lane.reservation, `builderLanes[${index}].reservation`, PATH))
    text(lane.artifactPath, `builderLanes[${index}].artifactPath`, PATH)
    if (lane.status !== "EXECUTED_STATIC_USEFUL_LANE") wall("CONCURRENT_CERTIFICATION_LANE_WALL", `builderLanes[${index}].status`)
  }
  if (new Set(laneIds).size !== 2 || new Set(reservations).size !== 2) wall("CONCURRENT_CERTIFICATION_DUPLICATE_WALL", "builderLanes")
  exact(plan.fanInProjection, FANIN_FIELDS, "fanInProjection")
  const fanInDeps = stringArray(plan.fanInProjection.dependsOn, "fanInProjection.dependsOn")
  if (fanInDeps.join(",") !== "codex-devex-hook-tooling-foundation,codex-release-engineering-foundation") wall("CONCURRENT_CERTIFICATION_FANIN_WALL", "fanInProjection.dependsOn")
  if (plan.fanInProjection.status !== "READY_AFTER_BUILDER_LANES" || plan.fanInProjection.releaseTarget !== "WO-MAO-058") wall("CONCURRENT_CERTIFICATION_FANIN_WALL", "fanInProjection")
  exact(plan.assurance, ASSURANCE_FIELDS, "assurance")
  if (plan.assurance.required !== true || plan.assurance.status !== "RECORDED_FOR_WO_MAO_056") wall("CONCURRENT_CERTIFICATION_ASSURANCE_WALL", "assurance")
  text(plan.assurance.agentRole, "assurance.agentRole")
  text(plan.assurance.mode, "assurance.mode")
  if (!Array.isArray(plan.providerExclusions) || plan.providerExclusions.length !== 1) wall("CONCURRENT_CERTIFICATION_PROVIDER_WALL", "providerExclusions")
  exact(plan.providerExclusions[0], EXCLUSION_FIELDS, "providerExclusions[0]")
  if (plan.providerExclusions[0].provider !== "CLAUDE_CODE" || plan.providerExclusions[0].selected !== false) wall("CONCURRENT_CERTIFICATION_PROVIDER_WALL", "providerExclusions[0]")
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("CONCURRENT_CERTIFICATION_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("CONCURRENT_CERTIFICATION_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("CONCURRENT_CERTIFICATION_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "CONCURRENT_CERTIFICATION_LANE_EXECUTION_STATIC_USEFUL_WORK"
    || plan.authority.certificationPortfolioVerified !== true
    || plan.authority.certificationAuthorityGranted !== false) wall("CONCURRENT_CERTIFICATION_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("CONCURRENT_CERTIFICATION_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    builderLaneCount: plan.builderLanes.length,
    fanInProjectionCount: 1,
    providerExclusionCount: plan.providerExclusions.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateConcurrentCertificationLanes() {
  wall("CONCURRENT_CERTIFICATION_HOST_TRUST_WALL", "concurrentCertification", "CALLER_SUPPLIED_EXECUTION_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalConcurrentCertificationLanes(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "CONCURRENT_CERTIFICATION_LANES_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalConcurrentCertificationLanes() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "CONCURRENT_CERTIFICATION_LANES_RESULT",
    workOrderId: "WO-MAO-055",
    status: "CONCURRENT_CERTIFICATION_LANES_EXECUTED",
    executionId: PLAN.executionId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    builderLaneIds: PLAN.builderLanes.map((entry) => entry.laneId).sort(),
    selectedProgramIds: PLAN.builderLanes.map((entry) => entry.programId).sort(),
    fanInLaneId: PLAN.fanInProjection.laneId,
    downstreamWorkOrders: ["WO-MAO-056", "WO-MAO-057"],
    downstreamState: "READY_AFTER_CONCURRENT_CERTIFICATION_LANES",
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_CERTIFICATION_PORTFOLIO_SELECTION",
      "EXECUTE_TWO_INDEPENDENT_STATIC_USEFUL_CODEX_LANES",
      "PRESERVE_DISJOINT_RESERVATIONS",
      "PROJECT_DEPENDENT_FANIN_RELEASE",
      "RECORD_ASSURANCE_REQUIREMENT_FOR_WO_MAO_056",
      "RECORD_STATIC_CONCURRENT_CERTIFICATION_EVIDENCE_ONLY",
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
export function loadCanonicalConcurrentCertificationLanes() { return deepFreeze(deepCopy(PLAN)) }
export function concurrentCertificationLanesPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalConcurrentCertificationLanesJson(value) { return canonicalJson(value) }
