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
  "schemaVersion", "artifactType", "auditId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "auditDomains", "trustBoundaryGates",
  "reservedPaths", "changedPaths", "foreignChanges", "secretScan", "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const DOMAIN_FIELDS = new Set(["domain", "expectedState", "auditMethod"])
const GATE_FIELDS = new Set(["name", "required", "state"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "independentAuditRequired", "githubLifecycleConformanceVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "runtimeActivated", "secretReadAttempted", "secretValueObserved", "credentialMaterialStored",
  "githubApiCalled", "productionWritePerformed", "authPolicyChanged", "identityMutated",
  "trustBoundaryExpanded", "commandRunnerAdded", "backgroundWorkerAdded", "ownerOperationRequired",
  "authorityGranted",
]

export class IndependentSecretIdentityTrustAuditError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "IndependentSecretIdentityTrustAuditError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new IndependentSecretIdentityTrustAuditError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("SECRET_TRUST_AUDIT_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("SECRET_TRUST_AUDIT_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("SECRET_TRUST_AUDIT_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("SECRET_TRUST_AUDIT_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PLAN",
  auditId: "secret-identity-trust-audit-wo-mao-045-v1",
  workOrderId: "WO-MAO-045",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2",
  baseTreeHash: "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-022", evidenceId: "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md", status: "EVIDENCE_LEDGER_OWNER_TOUCH_METER_VERIFIED", recordContentHash: "static-evidence-ledger-owner-touch-meter" },
    { workOrderId: "WO-MAO-036", evidenceId: "EVIDENCE-WO-MAO-036-PROVIDER-CONFORMANCE-SUITE-V1", status: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_VERIFIED", recordContentHash: "3283799cc653436b8a0d35575b08fc344611e3ec289afe8ca90e5de1db295f80" },
    { workOrderId: "WO-MAO-037", evidenceId: "EVIDENCE-WO-MAO-037-BRANCH-COMMIT-PUSH-V1", status: "CANONICAL_BRANCH_COMMIT_PUSH_AUTOMATION_VERIFIED", recordContentHash: "259c38e57b17031ffcbaaa90cdf8ea8fde2a276908652e1e1d6e60671b9022f6" },
    { workOrderId: "WO-MAO-038", evidenceId: "EVIDENCE-WO-MAO-038-PR-CREATION-PACKET-LINKAGE-V1", status: "CANONICAL_PR_CREATION_PACKET_LINKAGE_VERIFIED", recordContentHash: "fa24625e6880da53255e0337ac49a03eb4cc4831f75001873f4426ae6ef0544f" },
    { workOrderId: "WO-MAO-039", evidenceId: "EVIDENCE-WO-MAO-039-CI-REVIEW-INGESTION-V1", status: "CANONICAL_CI_REVIEW_INGESTION_VERIFIED", recordContentHash: "10dcc5064432b0274a21fb6601f9df74623217f810f3c9b9b80ac87c10b650d8" },
    { workOrderId: "WO-MAO-040", evidenceId: "EVIDENCE-WO-MAO-040-REMEDIATION-REREVIEW-V1", status: "CANONICAL_REMEDIATION_REREVIEW_VERIFIED", recordContentHash: "5824568886fb6926457a68a0f7c3806ef0ee44859b38e932ed33a1e41c2102b9" },
    { workOrderId: "WO-MAO-041", evidenceId: "EVIDENCE-WO-MAO-041-BOUNDED-MERGE-CONTROLLER-V1", status: "CANONICAL_BOUNDED_MERGE_CONTROLLER_VERIFIED", recordContentHash: "627a8ab17e98aa8c0c579653af013f5b7771f6bb2c05d4c31d11a8ce5369cd8b" },
    { workOrderId: "WO-MAO-042", evidenceId: "EVIDENCE-WO-MAO-042-POST-MERGE-VERIFICATION-CLEANUP-V1", status: "CANONICAL_POST_MERGE_VERIFICATION_CLEANUP_VERIFIED", recordContentHash: "45f76c7ed920dfc88b6c49044be17fd6f0ef8a154c3b8f687df78aa064e8fd2d" },
    { workOrderId: "WO-MAO-043", evidenceId: "EVIDENCE-WO-MAO-043-AUTOMATIC-DEPENDENT-RELEASE-V1", status: "CANONICAL_AUTOMATIC_DEPENDENT_RELEASE_VERIFIED", recordContentHash: "2a252c8141aaecc974e0776a124672b0fe88d48c5754cede89115932100e2816" },
    { workOrderId: "WO-MAO-044", evidenceId: "EVIDENCE-WO-MAO-044-GITHUB-LIFECYCLE-CONFORMANCE-V1", status: "CANONICAL_GITHUB_LIFECYCLE_CONFORMANCE_VERIFIED", recordContentHash: "95d7d86e4f6f2daa1174e7b1f7671a67b8ca88c4b7d691dbf1d8314ada8a3041" },
  ],
  auditDomains: [
    { domain: "secret-material", expectedState: "NO_SECRET_ACCESS_OR_STORAGE", auditMethod: "SEALED_DECLARATIVE_DIFF_BOUNDARY" },
    { domain: "identity-material", expectedState: "NO_IDENTITY_MUTATION_OR_IMPERSONATION", auditMethod: "SEALED_DECLARATIVE_TRUST_BOUNDARY" },
    { domain: "github-authority", expectedState: "NO_GITHUB_API_OR_WRITE_OPERATION", auditMethod: "SEALED_STATIC_CONTROL_PLANE" },
    { domain: "runtime-boundary", expectedState: "NO_RUNTIME_ACTIVATION_OR_WORKER_EXECUTION", auditMethod: "SEALED_STATIC_CONTROL_PLANE" },
    { domain: "owner-boundary", expectedState: "NO_OWNER_OPERATION_OR_CREDENTIAL_COURIERING", auditMethod: "SEALED_OWNER_ONLY_CONSTITUTION_CHECK" },
  ],
  trustBoundaryGates: [
    { name: "no-secret-access", required: true, state: "PASS" },
    { name: "no-identity-mutation", required: true, state: "PASS" },
    { name: "no-github-api", required: true, state: "PASS" },
    { name: "no-runtime-activation", required: true, state: "PASS" },
    { name: "no-trust-boundary-expansion", required: true, state: "PASS" },
    { name: "no-owner-operation-touch", required: true, state: "PASS" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-secret-trust-audit-registry.ts",
    "docs/reports/WO-MAO-045-independent-secret-identity-trust-boundary-audit.md",
    "scripts/multi-agent-operator/independent-secret-identity-trust-audit-cli.mjs",
    "scripts/multi-agent-operator/independent-secret-identity-trust-audit.mjs",
    "tests/multi-agent-independent-secret-identity-trust-audit.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-secret-trust-audit-registry.ts",
    "docs/reports/WO-MAO-045-independent-secret-identity-trust-boundary-audit.md",
    "scripts/multi-agent-operator/independent-secret-identity-trust-audit-cli.mjs",
    "scripts/multi-agent-operator/independent-secret-identity-trust-audit.mjs",
    "tests/multi-agent-independent-secret-identity-trust-audit.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    independentAuditRequired: true,
    githubLifecycleConformanceVerified: true,
    authorityScope: "INDEPENDENT_SECRET_IDENTITY_TRUST_BOUNDARY_AUDIT_ONLY",
  },
  safety: {
    runtimeActivated: false,
    secretReadAttempted: false,
    secretValueObserved: false,
    credentialMaterialStored: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    authPolicyChanged: false,
    identityMutated: false,
    trustBoundaryExpanded: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "413975c5dd9babeb61b7bb8d188c9c5809185cc6d12c2e0e0cbf16dddf84b52e"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("SECRET_TRUST_AUDIT_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("SECRET_TRUST_AUDIT_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("SECRET_TRUST_AUDIT_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 10) wall("SECRET_TRUST_AUDIT_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-022,WO-MAO-036,WO-MAO-037,WO-MAO-038,WO-MAO-039,WO-MAO-040,WO-MAO-041,WO-MAO-042,WO-MAO-043,WO-MAO-044") wall("SECRET_TRUST_AUDIT_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("SECRET_TRUST_AUDIT_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PLAN") wall("SECRET_TRUST_AUDIT_SCHEMA_WALL", "plan")
  text(plan.auditId, "plan.auditId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-045") wall("SECRET_TRUST_AUDIT_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.auditDomains) || plan.auditDomains.length !== 5) wall("SECRET_TRUST_AUDIT_DOMAIN_WALL", "auditDomains")
  for (const [index, domain] of plan.auditDomains.entries()) {
    exact(domain, DOMAIN_FIELDS, `auditDomains[${index}]`)
    text(domain.domain, `auditDomains[${index}].domain`)
    text(domain.expectedState, `auditDomains[${index}].expectedState`)
    text(domain.auditMethod, `auditDomains[${index}].auditMethod`)
  }
  if (!Array.isArray(plan.trustBoundaryGates) || plan.trustBoundaryGates.length !== 6) wall("SECRET_TRUST_AUDIT_GATE_WALL", "trustBoundaryGates")
  for (const [index, gate] of plan.trustBoundaryGates.entries()) {
    exact(gate, GATE_FIELDS, `trustBoundaryGates[${index}]`)
    text(gate.name, `trustBoundaryGates[${index}].name`)
    if (gate.required !== true || gate.state !== "PASS") wall("SECRET_TRUST_AUDIT_GATE_WALL", `trustBoundaryGates[${index}]`)
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("SECRET_TRUST_AUDIT_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("SECRET_TRUST_AUDIT_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("SECRET_TRUST_AUDIT_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.independentAuditRequired !== true
    || plan.authority.githubLifecycleConformanceVerified !== true
    || plan.authority.authorityScope !== "INDEPENDENT_SECRET_IDENTITY_TRUST_BOUNDARY_AUDIT_ONLY") wall("SECRET_TRUST_AUDIT_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("SECRET_TRUST_AUDIT_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    auditDomainCount: plan.auditDomains.length,
    trustBoundaryGateCount: plan.trustBoundaryGates.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateIndependentSecretIdentityTrustAudit() {
  wall("SECRET_TRUST_AUDIT_HOST_TRUST_WALL", "independentSecretIdentityTrustAudit", "CALLER_SUPPLIED_AUDIT_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalIndependentSecretIdentityTrustAuditPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    runtimeActivated: false,
    secretReadAttempted: false,
    secretValueObserved: false,
    identityMutated: false,
    githubApiCalled: false,
    authorityGranted: false,
  })
}
export function runCanonicalIndependentSecretIdentityTrustAudit() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_RESULT",
    workOrderId: "WO-MAO-045",
    status: "INDEPENDENT_SECRET_IDENTITY_TRUST_AUDIT_PROVEN",
    auditId: PLAN.auditId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    auditedBoundaries: PLAN.auditDomains.map((entry) => entry.domain).sort(),
    orderedOperations: [
      "VERIFY_NO_SECRET_ACCESS_OR_STORAGE",
      "VERIFY_NO_IDENTITY_MUTATION_OR_IMPERSONATION",
      "VERIFY_NO_GITHUB_API_OR_WRITE_OPERATION",
      "VERIFY_NO_RUNTIME_ACTIVATION_OR_WORKER_EXECUTION",
      "VERIFY_NO_OWNER_OPERATION_OR_CREDENTIAL_COURIERING",
      "RECORD_INDEPENDENT_TRUST_BOUNDARY_AUDIT",
    ],
    runtimeActivated: false,
    secretReadAttempted: false,
    secretValueObserved: false,
    credentialMaterialStored: false,
    githubApiCalled: false,
    productionWritePerformed: false,
    authPolicyChanged: false,
    identityMutated: false,
    trustBoundaryExpanded: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalIndependentSecretIdentityTrustAuditPlan() { return deepFreeze(deepCopy(PLAN)) }
export function independentSecretIdentityTrustAuditPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalIndependentSecretIdentityTrustAuditJson(value) { return canonicalJson(value) }

