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
  "schemaVersion", "artifactType", "selectionId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "selectedLanes", "fanInLane",
  "providerExclusions", "acceptanceGates", "reservedPaths", "changedPaths", "foreignChanges",
  "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const LANE_FIELDS = new Set(["laneId", "provider", "programId", "workOrderId", "purpose", "reservation"])
const FANIN_FIELDS = new Set(["laneId", "dependsOn", "purpose", "releaseTarget"])
const EXCLUSION_FIELDS = new Set(["provider", "reasonCode", "sourceWorkOrderId", "selected"])
const GATE_FIELDS = new Set(["gateId", "required", "source"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "authorityScope", "phaseSixRollupVerified", "certificationAuthorityGranted"])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "runtimeActivationAllowed",
  "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed", "productionWritePerformed",
  "secretMaterialAllowed", "ownerOperationRequired", "authorityGranted",
]

export class CertificationPortfolioSelectionError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "CertificationPortfolioSelectionError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new CertificationPortfolioSelectionError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("CERTIFICATION_PORTFOLIO_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CERTIFICATION_PORTFOLIO_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CERTIFICATION_PORTFOLIO_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("CERTIFICATION_PORTFOLIO_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_CERTIFICATION_PORTFOLIO_SELECTION",
  selectionId: "certification-portfolio-selection-wo-mao-054-v1",
  workOrderId: "WO-MAO-054",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "37e99b733676a1ac046125500eb6ca0232af0178",
  baseTreeHash: "841f5e5566fd73c5ab80074a71f62bd6de8f314a",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-036", evidenceId: "EVIDENCE-WO-MAO-036-PROVIDER-CONFORMANCE-SUITE-V1", status: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED", recordContentHash: "9d7d89dff7aceaa12f7f6d7ee9451cfeea52815f0aff6af2da0bf546a9927c22" },
    { workOrderId: "WO-MAO-044", evidenceId: "EVIDENCE-WO-MAO-044-GITHUB-LIFECYCLE-CONFORMANCE-V1", status: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED", recordContentHash: "029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc" },
    { workOrderId: "WO-MAO-053", evidenceId: "EVIDENCE-WO-MAO-053-RESILIENCE-SAFETY-ROLLUP-V1", status: "CANONICAL_RESILIENCE_SAFETY_ROLLUP_VERIFIED", recordContentHash: "ecf035fef1569b44a3ab6e22478e78623ef8b8e416e54410f63cc92190c41f54" },
  ],
  selectedLanes: [
    {
      laneId: "codex-release-engineering-foundation",
      provider: "CODEX",
      programId: "PROGRAM-RELEASE-ENGINEERING-001",
      workOrderId: "WO-RELEASE-001",
      purpose: "Reconcile current release evidence and readiness without production mutation",
      reservation: "docs/reports/release-engineering",
    },
    {
      laneId: "codex-devex-hook-tooling-foundation",
      provider: "CODEX",
      programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
      workOrderId: "WO-DEVEX-HOOK-TOOLING-001",
      purpose: "Reconcile DevEx and hook tooling evidence for bounded repository automation",
      reservation: "docs/reports/devex-hook-tooling",
    },
  ],
  fanInLane: {
    laneId: "codex-certification-fanin-release",
    dependsOn: ["codex-release-engineering-foundation", "codex-devex-hook-tooling-foundation"],
    purpose: "Integrate independent useful-lane evidence into one dependent certification fan-in record",
    releaseTarget: "WO-MAO-058",
  },
  providerExclusions: [
    { provider: "CLAUDE_CODE", reasonCode: "PROVIDER_UNAVAILABLE_WO_MAO_032", sourceWorkOrderId: "WO-MAO-032", selected: false },
  ],
  acceptanceGates: [
    { gateId: "two-independent-codex-lanes", required: true, source: "WO-MAO-054" },
    { gateId: "dependent-fanin-lane", required: true, source: "WO-MAO-054" },
    { gateId: "claude-only-if-conformant", required: true, source: "WO-MAO-032" },
    { gateId: "zero-owner-touch-counters", required: true, source: "WO-MAO-060" },
    { gateId: "no-synthetic-evidence-only-work", required: true, source: "WO-MAO-061" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-certification-portfolio-registry.ts",
    "docs/reports/WO-MAO-054-certification-portfolio-selection.md",
    "scripts/multi-agent-operator/certification-portfolio-selection-cli.mjs",
    "scripts/multi-agent-operator/certification-portfolio-selection.mjs",
    "tests/multi-agent-certification-portfolio-selection.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-certification-portfolio-registry.ts",
    "docs/reports/WO-MAO-054-certification-portfolio-selection.md",
    "scripts/multi-agent-operator/certification-portfolio-selection-cli.mjs",
    "scripts/multi-agent-operator/certification-portfolio-selection.mjs",
    "tests/multi-agent-certification-portfolio-selection.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    authorityScope: "CERTIFICATION_PORTFOLIO_SELECTION_ONLY",
    phaseSixRollupVerified: true,
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

const PLAN_HASH = "f8703c81c3f904fdafd76e93122a895c12652a332c83ed3328bb2bceb7632e78"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("CERTIFICATION_PORTFOLIO_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("CERTIFICATION_PORTFOLIO_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("CERTIFICATION_PORTFOLIO_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 3) wall("CERTIFICATION_PORTFOLIO_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-036,WO-MAO-044,WO-MAO-053") wall("CERTIFICATION_PORTFOLIO_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validateSelectedLanes(value) {
  if (!Array.isArray(value) || value.length !== 2) wall("CERTIFICATION_PORTFOLIO_LANE_WALL", "selectedLanes")
  const ids = []
  const programs = []
  for (const [index, lane] of value.entries()) {
    exact(lane, LANE_FIELDS, `selectedLanes[${index}]`)
    ids.push(text(lane.laneId, `selectedLanes[${index}].laneId`))
    if (lane.provider !== "CODEX") wall("CERTIFICATION_PORTFOLIO_PROVIDER_WALL", `selectedLanes[${index}].provider`)
    programs.push(text(lane.programId, `selectedLanes[${index}].programId`))
    text(lane.workOrderId, `selectedLanes[${index}].workOrderId`, WO)
    text(lane.purpose, `selectedLanes[${index}].purpose`, PHRASE)
    text(lane.reservation, `selectedLanes[${index}].reservation`, PATH)
  }
  if (new Set(ids).size !== 2 || new Set(programs).size !== 2) wall("CERTIFICATION_PORTFOLIO_DUPLICATE_WALL", "selectedLanes")
  if (programs.sort().join(",") !== "PROGRAM-DEVEX-HOOK-TOOLING-001,PROGRAM-RELEASE-ENGINEERING-001") wall("CERTIFICATION_PORTFOLIO_PROGRAM_WALL", "selectedLanes")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("CERTIFICATION_PORTFOLIO_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_CERTIFICATION_PORTFOLIO_SELECTION") wall("CERTIFICATION_PORTFOLIO_SCHEMA_WALL", "plan")
  text(plan.selectionId, "plan.selectionId")
  if (text(plan.workOrderId, "plan.workOrderId", WO) !== "WO-MAO-054") wall("CERTIFICATION_PORTFOLIO_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  validateSelectedLanes(plan.selectedLanes)
  exact(plan.fanInLane, FANIN_FIELDS, "fanInLane")
  text(plan.fanInLane.laneId, "fanInLane.laneId")
  const fanInDeps = stringArray(plan.fanInLane.dependsOn, "fanInLane.dependsOn")
  if (fanInDeps.join(",") !== "codex-devex-hook-tooling-foundation,codex-release-engineering-foundation") wall("CERTIFICATION_PORTFOLIO_FANIN_WALL", "fanInLane.dependsOn")
  text(plan.fanInLane.purpose, "fanInLane.purpose", PHRASE)
  if (text(plan.fanInLane.releaseTarget, "fanInLane.releaseTarget", WO) !== "WO-MAO-058") wall("CERTIFICATION_PORTFOLIO_FANIN_WALL", "fanInLane.releaseTarget")
  if (!Array.isArray(plan.providerExclusions) || plan.providerExclusions.length !== 1) wall("CERTIFICATION_PORTFOLIO_PROVIDER_WALL", "providerExclusions")
  exact(plan.providerExclusions[0], EXCLUSION_FIELDS, "providerExclusions[0]")
  if (plan.providerExclusions[0].provider !== "CLAUDE_CODE"
    || plan.providerExclusions[0].reasonCode !== "PROVIDER_UNAVAILABLE_WO_MAO_032"
    || plan.providerExclusions[0].sourceWorkOrderId !== "WO-MAO-032"
    || plan.providerExclusions[0].selected !== false) wall("CERTIFICATION_PORTFOLIO_PROVIDER_WALL", "providerExclusions[0]")
  if (!Array.isArray(plan.acceptanceGates) || plan.acceptanceGates.length !== 5) wall("CERTIFICATION_PORTFOLIO_GATE_WALL", "acceptanceGates")
  for (const [index, gate] of plan.acceptanceGates.entries()) {
    exact(gate, GATE_FIELDS, `acceptanceGates[${index}]`)
    text(gate.gateId, `acceptanceGates[${index}].gateId`)
    if (gate.required !== true) wall("CERTIFICATION_PORTFOLIO_GATE_WALL", `acceptanceGates[${index}].required`)
    text(gate.source, `acceptanceGates[${index}].source`, WO)
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("CERTIFICATION_PORTFOLIO_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("CERTIFICATION_PORTFOLIO_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("CERTIFICATION_PORTFOLIO_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.authorityScope !== "CERTIFICATION_PORTFOLIO_SELECTION_ONLY"
    || plan.authority.phaseSixRollupVerified !== true
    || plan.authority.certificationAuthorityGranted !== false) wall("CERTIFICATION_PORTFOLIO_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("CERTIFICATION_PORTFOLIO_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    selectedLaneCount: plan.selectedLanes.length,
    fanInLaneCount: 1,
    providerExclusionCount: plan.providerExclusions.length,
    acceptanceGateCount: plan.acceptanceGates.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateCertificationPortfolioSelection() {
  wall("CERTIFICATION_PORTFOLIO_HOST_TRUST_WALL", "certificationPortfolio", "CALLER_SUPPLIED_SELECTION_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalCertificationPortfolioSelection(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "CERTIFICATION_PORTFOLIO_SELECTION_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  })
}
export function runCanonicalCertificationPortfolioSelection() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "CERTIFICATION_PORTFOLIO_SELECTION_RESULT",
    workOrderId: "WO-MAO-054",
    status: "CERTIFICATION_PORTFOLIO_SELECTED",
    selectionId: PLAN.selectionId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    selectedLaneIds: PLAN.selectedLanes.map((entry) => entry.laneId).sort(),
    selectedProgramIds: PLAN.selectedLanes.map((entry) => entry.programId).sort(),
    fanInLaneId: PLAN.fanInLane.laneId,
    excludedProviders: PLAN.providerExclusions.map((entry) => entry.provider).sort(),
    downstreamWorkOrderId: "WO-MAO-055",
    downstreamState: "READY_AFTER_CERTIFICATION_PORTFOLIO_SELECTION",
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "VERIFY_PHASE_SIX_AND_GITHUB_LIFECYCLE_DEPENDENCIES",
      "SELECT_TWO_INDEPENDENT_USEFUL_CODEX_LANES",
      "SELECT_DEPENDENT_FANIN_LANE",
      "EXCLUDE_UNAVAILABLE_CLAUDE_PROVIDER_WITH_TYPED_REASON",
      "RECORD_STATIC_CERTIFICATION_PORTFOLIO_SELECTION_ONLY",
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
export function loadCanonicalCertificationPortfolioSelection() { return deepFreeze(deepCopy(PLAN)) }
export function certificationPortfolioSelectionPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalCertificationPortfolioSelectionJson(value) { return canonicalJson(value) }
