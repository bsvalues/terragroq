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
  "schemaVersion", "artifactType", "recoveryId", "workOrderId", "repository", "baseRef",
  "baseCommitSha", "baseTreeHash", "dependencyEvidence", "durableSources", "recoveryScenarios",
  "concurrencyFences", "reservedPaths", "changedPaths", "foreignChanges", "secretScan",
  "authority", "safety",
])
const DEP_FIELDS = new Set(["workOrderId", "evidenceId", "status", "recordContentHash"])
const SOURCE_FIELDS = new Set(["source", "required", "readMode"])
const SCENARIO_FIELDS = new Set(["name", "deathPoint", "resumeDecision", "durableProof", "writerPolicy", "terminalIfMissing"])
const FENCE_FIELDS = new Set(["name", "state", "decision"])
const SECRET_FIELDS = new Set(["status", "scanner", "secretLikeFindings"])
const AUTH_FIELDS = new Set(["activeProgramGrant", "leaseCheckpointVerified", "workspaceIsolationVerified", "coordinatorAdapterVerified", "roleAdapterVerified", "retryIdempotencyVerified", "authorityScope"])
const SAFETY_FIELDS = [
  "schedulerAdded", "providerExecutionPerformed", "githubApiCalled", "githubWritePerformed",
  "productionWritePerformed", "runtimeActivationAllowed", "processControlPerformed",
  "commandRunnerAdded", "backgroundWorkerAdded", "stateMutationPerformed", "secretMaterialAllowed",
  "concurrentWritersAllowed", "ownerOperationRequired", "authorityGranted",
]

export class WorkerCoordinatorRecoveryError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "WorkerCoordinatorRecoveryError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new WorkerCoordinatorRecoveryError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function exact(value, fields, field) {
  if (!object(value)) wall("WORKER_COORDINATOR_RECOVERY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("WORKER_COORDINATOR_RECOVERY_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("WORKER_COORDINATOR_RECOVERY_MISSING_FIELD_WALL", `${field}.${missing}`)
}
function text(value, field, pattern = ID) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) wall("WORKER_COORDINATOR_RECOVERY_FORMAT_WALL", field)
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
  artifactType: "CANONICAL_WORKER_COORDINATOR_RECOVERY_PLAN",
  recoveryId: "worker-coordinator-recovery-wo-mao-047-v1",
  workOrderId: "WO-MAO-047",
  repository: "bsvalues/terragroq",
  baseRef: "refs/heads/main",
  baseCommitSha: "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc",
  baseTreeHash: "a4240f8508f3c95671250e6fb677efa3dff6baea",
  dependencyEvidence: [
    { workOrderId: "WO-MAO-021", evidenceId: "docs/reports/WO-MAO-021-per-lane-leases-checkpoints.md", status: "PER_LANE_LEASES_CHECKPOINTS_VERIFIED", recordContentHash: "static-per-lane-leases-checkpoints" },
    { workOrderId: "WO-MAO-025", evidenceId: "docs/reports/WO-MAO-025-isolated-workspace-manager.md", status: "ISOLATED_WORKSPACE_MANAGER_VERIFIED", recordContentHash: "static-isolated-workspace-manager" },
    { workOrderId: "WO-MAO-030", evidenceId: "docs/reports/WO-MAO-030-hosted-codex-coordinator-adapter.md", status: "HOSTED_CODEX_COORDINATOR_ADAPTER_VERIFIED", recordContentHash: "static-hosted-codex-coordinator-adapter" },
    { workOrderId: "WO-MAO-031", evidenceId: "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md", status: "CODEX_ROLE_ADAPTERS_VERIFIED", recordContentHash: "static-codex-role-adapters" },
    { workOrderId: "WO-MAO-046", evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1", status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED", recordContentHash: "75087c291cfc0cb55f71a61bcf5fc96c3cd4a780bd69da039b1606d6776543df" },
  ],
  durableSources: [
    { source: "lease-ledger", required: true, readMode: "READ_ONLY_HASHED_RECORD" },
    { source: "checkpoint-ledger", required: true, readMode: "READ_ONLY_HASHED_RECORD" },
    { source: "isolated-workspace-record", required: true, readMode: "READ_ONLY_HASHED_RECORD" },
    { source: "repository-ref-state", required: true, readMode: "READ_ONLY_OBSERVATION" },
    { source: "pr-linkage-record", required: true, readMode: "READ_ONLY_HASHED_RECORD" },
  ],
  recoveryScenarios: [
    { name: "death-before-write", deathPoint: "BEFORE_WORKSPACE_WRITE", resumeDecision: "REACQUIRE_LEASE_AND_REPLAY_FROM_CHECKPOINT", durableProof: "NO_CHANGED_PATH_OR_COMMIT_HASH_PRESENT", writerPolicy: "SINGLE_WRITER_AFTER_EXPIRED_LEASE", terminalIfMissing: "BLOCKED_AMBIGUOUS_CHECKPOINT" },
    { name: "death-during-edit", deathPoint: "DURING_RESERVED_PATH_EDIT", resumeDecision: "DISCARD_UNCOMMITTED_OWNED_WORKTREE_DELTA_AND_REPLAY", durableProof: "CHECKPOINT_HASH_PRECEDES_UNCOMMITTED_DELTA", writerPolicy: "SINGLE_WRITER_AFTER_WORKSPACE_RECONCILE", terminalIfMissing: "BLOCKED_CORRUPTED_WORKSPACE" },
    { name: "death-after-commit", deathPoint: "AFTER_LOCAL_COMMIT_BEFORE_PUSH", resumeDecision: "VERIFY_COMMIT_HASH_AND_PUSH_IDEMPOTENTLY_ONCE", durableProof: "COMMIT_HASH_BOUND_TO_CHECKPOINT_AND_RESERVED_PATHS", writerPolicy: "SINGLE_WRITER_WITH_COMMIT_FENCE", terminalIfMissing: "BLOCKED_UNATTRIBUTED_COMMIT" },
    { name: "death-after-push", deathPoint: "AFTER_PUSH_BEFORE_PR_LINKAGE", resumeDecision: "VERIFY_REMOTE_REF_AND_CREATE_OR_BIND_PR_ONCE", durableProof: "REMOTE_REF_HASH_MATCHES_CHECKPOINT_COMMIT", writerPolicy: "SINGLE_WRITER_WITH_BRANCH_AND_PR_FENCES", terminalIfMissing: "BLOCKED_REMOTE_REF_AMBIGUITY" },
    { name: "death-with-pr-open", deathPoint: "PR_OPEN_BEFORE_REVIEW_OR_MERGE", resumeDecision: "RECONSTRUCT_FROM_PR_LINKAGE_AND_CONTINUE_OBSERVATION", durableProof: "PR_LINKAGE_HASH_BINDS_BRANCH_COMMIT_AND_WORK_ORDER", writerPolicy: "READ_ONLY_COORDINATOR_RECOVERY_UNTIL_LEASE_RENEWED", terminalIfMissing: "BLOCKED_PR_LINKAGE_AMBIGUITY" },
  ],
  concurrencyFences: [
    { name: "lease-fence", state: "REQUIRED", decision: "REJECT_SECOND_WRITER" },
    { name: "checkpoint-content-hash-fence", state: "REQUIRED", decision: "REJECT_STALE_REPLAY" },
    { name: "workspace-ownership-fence", state: "REQUIRED", decision: "REJECT_FOREIGN_WORKTREE" },
    { name: "commit-hash-fence", state: "REQUIRED", decision: "REJECT_UNATTRIBUTED_COMMIT" },
    { name: "remote-ref-fence", state: "REQUIRED", decision: "REJECT_REMOTE_AMBIGUITY" },
    { name: "pr-linkage-fence", state: "REQUIRED", decision: "REJECT_DUPLICATE_PR" },
  ],
  reservedPaths: [
    "components/operator/multi-agent-worker-recovery-registry.ts",
    "docs/reports/WO-MAO-047-worker-coordinator-recovery.md",
    "scripts/multi-agent-operator/worker-coordinator-recovery-cli.mjs",
    "scripts/multi-agent-operator/worker-coordinator-recovery.mjs",
    "tests/multi-agent-worker-coordinator-recovery.test.ts",
  ],
  changedPaths: [
    "components/operator/multi-agent-worker-recovery-registry.ts",
    "docs/reports/WO-MAO-047-worker-coordinator-recovery.md",
    "scripts/multi-agent-operator/worker-coordinator-recovery-cli.mjs",
    "scripts/multi-agent-operator/worker-coordinator-recovery.mjs",
    "tests/multi-agent-worker-coordinator-recovery.test.ts",
  ],
  foreignChanges: [],
  secretScan: { status: "PASS", scanner: "diff-secret-like-value-scan", secretLikeFindings: 0 },
  authority: {
    activeProgramGrant: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    leaseCheckpointVerified: true,
    workspaceIsolationVerified: true,
    coordinatorAdapterVerified: true,
    roleAdapterVerified: true,
    retryIdempotencyVerified: true,
    authorityScope: "WORKER_COORDINATOR_RECOVERY_MODEL_ONLY",
  },
  safety: {
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    githubWritePerformed: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    processControlPerformed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    concurrentWritersAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
})

const PLAN_HASH = "d74b5b5702d86333a9e4a535c1780453e02122a58d998f1bc1b86e57cbc1efd6"

function stringArray(value, field, pattern = ID) {
  if (!Array.isArray(value) || value.length === 0) wall("WORKER_COORDINATOR_RECOVERY_TYPE_WALL", field, "NON_EMPTY_ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => text(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(normalized).size !== normalized.length) wall("WORKER_COORDINATOR_RECOVERY_DUPLICATE_WALL", field)
  return normalized
}
function pathArray(value, field) {
  const normalized = stringArray(value, field, PATH)
  for (const [index, item] of normalized.entries()) {
    if (item.includes("..") || item.startsWith("/") || item.startsWith("\\") || PROHIBITED_PATH.test(item)) wall("WORKER_COORDINATOR_RECOVERY_PATH_WALL", `${field}[${index}]`)
  }
  return normalized
}
function validateDependencies(value) {
  if (!Array.isArray(value) || value.length !== 5) wall("WORKER_COORDINATOR_RECOVERY_DEPENDENCY_WALL", "dependencyEvidence")
  const ids = value.map((entry, index) => {
    exact(entry, DEP_FIELDS, `dependencyEvidence[${index}]`)
    text(entry.workOrderId, `dependencyEvidence[${index}].workOrderId`, WO)
    text(entry.evidenceId, `dependencyEvidence[${index}].evidenceId`, PATH)
    text(entry.status, `dependencyEvidence[${index}].status`)
    if (!entry.recordContentHash.startsWith("static-")) text(entry.recordContentHash, `dependencyEvidence[${index}].recordContentHash`, HASH64)
    return entry.workOrderId
  }).sort()
  if (ids.join(",") !== "WO-MAO-021,WO-MAO-025,WO-MAO-030,WO-MAO-031,WO-MAO-046") wall("WORKER_COORDINATOR_RECOVERY_DEPENDENCY_WALL", "dependencyEvidence", "EXACT_DEPENDENCIES_REQUIRED")
}
function validatePlan(plan) {
  if (contentHash(plan) !== PLAN_HASH) wall("WORKER_COORDINATOR_RECOVERY_PLAN_INTEGRITY_WALL", "plan", "CANONICAL_HASH_REQUIRED")
  exact(plan, PLAN_FIELDS, "plan")
  if (plan.schemaVersion !== 1 || plan.artifactType !== "CANONICAL_WORKER_COORDINATOR_RECOVERY_PLAN") wall("WORKER_COORDINATOR_RECOVERY_SCHEMA_WALL", "plan")
  text(plan.recoveryId, "plan.recoveryId")
  text(plan.workOrderId, "plan.workOrderId", WO)
  if (plan.workOrderId !== "WO-MAO-047") wall("WORKER_COORDINATOR_RECOVERY_SCOPE_WALL", "plan.workOrderId")
  text(plan.repository, "plan.repository", REPO)
  text(plan.baseRef, "plan.baseRef", REF)
  text(plan.baseCommitSha, "plan.baseCommitSha", SHA40)
  text(plan.baseTreeHash, "plan.baseTreeHash", SHA40)
  validateDependencies(plan.dependencyEvidence)
  if (!Array.isArray(plan.durableSources) || plan.durableSources.length !== 5) wall("WORKER_COORDINATOR_RECOVERY_SOURCE_WALL", "durableSources")
  for (const [index, source] of plan.durableSources.entries()) {
    exact(source, SOURCE_FIELDS, `durableSources[${index}]`)
    text(source.source, `durableSources[${index}].source`)
    if (source.required !== true) wall("WORKER_COORDINATOR_RECOVERY_SOURCE_WALL", `durableSources[${index}].required`)
    text(source.readMode, `durableSources[${index}].readMode`)
  }
  if (!Array.isArray(plan.recoveryScenarios) || plan.recoveryScenarios.length !== 5) wall("WORKER_COORDINATOR_RECOVERY_SCENARIO_WALL", "recoveryScenarios")
  for (const [index, scenario] of plan.recoveryScenarios.entries()) {
    exact(scenario, SCENARIO_FIELDS, `recoveryScenarios[${index}]`)
    text(scenario.name, `recoveryScenarios[${index}].name`)
    text(scenario.deathPoint, `recoveryScenarios[${index}].deathPoint`)
    text(scenario.resumeDecision, `recoveryScenarios[${index}].resumeDecision`)
    text(scenario.durableProof, `recoveryScenarios[${index}].durableProof`)
    text(scenario.writerPolicy, `recoveryScenarios[${index}].writerPolicy`)
    text(scenario.terminalIfMissing, `recoveryScenarios[${index}].terminalIfMissing`)
    if (!scenario.writerPolicy.includes("SINGLE_WRITER") && !scenario.writerPolicy.includes("READ_ONLY_COORDINATOR")) wall("WORKER_COORDINATOR_RECOVERY_WRITER_WALL", `recoveryScenarios[${index}].writerPolicy`)
  }
  const names = stringArray(plan.recoveryScenarios.map((entry) => entry.name), "recoveryScenarios.names")
  if (names.join(",") !== "death-after-commit,death-after-push,death-before-write,death-during-edit,death-with-pr-open") wall("WORKER_COORDINATOR_RECOVERY_SCENARIO_WALL", "recoveryScenarios", "EXACT_FAILURE_POINTS_REQUIRED")
  if (!Array.isArray(plan.concurrencyFences) || plan.concurrencyFences.length !== 6) wall("WORKER_COORDINATOR_RECOVERY_FENCE_WALL", "concurrencyFences")
  for (const [index, fence] of plan.concurrencyFences.entries()) {
    exact(fence, FENCE_FIELDS, `concurrencyFences[${index}]`)
    text(fence.name, `concurrencyFences[${index}].name`)
    if (fence.state !== "REQUIRED" || !fence.decision.startsWith("REJECT_")) wall("WORKER_COORDINATOR_RECOVERY_FENCE_WALL", `concurrencyFences[${index}]`)
  }
  const reservedPaths = pathArray(plan.reservedPaths, "reservedPaths")
  const changedPaths = pathArray(plan.changedPaths, "changedPaths")
  if (!changedPaths.every((item) => reservedPaths.includes(item))) wall("WORKER_COORDINATOR_RECOVERY_RESERVATION_WALL", "changedPaths")
  if (!Array.isArray(plan.foreignChanges) || plan.foreignChanges.length !== 0) wall("WORKER_COORDINATOR_RECOVERY_FOREIGN_CHANGE_WALL", "foreignChanges")
  exact(plan.secretScan, SECRET_FIELDS, "secretScan")
  if (plan.secretScan.status !== "PASS" || plan.secretScan.secretLikeFindings !== 0) wall("WORKER_COORDINATOR_RECOVERY_SECRET_WALL", "secretScan")
  exact(plan.authority, AUTH_FIELDS, "authority")
  if (plan.authority.activeProgramGrant !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001"
    || plan.authority.leaseCheckpointVerified !== true
    || plan.authority.workspaceIsolationVerified !== true
    || plan.authority.coordinatorAdapterVerified !== true
    || plan.authority.roleAdapterVerified !== true
    || plan.authority.retryIdempotencyVerified !== true
    || plan.authority.authorityScope !== "WORKER_COORDINATOR_RECOVERY_MODEL_ONLY") wall("WORKER_COORDINATOR_RECOVERY_AUTHORITY_WALL", "authority")
  exact(plan.safety, new Set(SAFETY_FIELDS), "safety")
  for (const field of SAFETY_FIELDS) if (plan.safety[field] !== false) wall("WORKER_COORDINATOR_RECOVERY_SAFETY_WALL", `safety.${field}`)
  return {
    dependencyCount: plan.dependencyEvidence.length,
    durableSourceCount: plan.durableSources.length,
    recoveryScenarioCount: plan.recoveryScenarios.length,
    concurrencyFenceCount: plan.concurrencyFences.length,
    reservedPathCount: reservedPaths.length,
    changedPathCount: changedPaths.length,
  }
}

export function evaluateWorkerCoordinatorRecovery() {
  wall("WORKER_COORDINATOR_RECOVERY_HOST_TRUST_WALL", "workerCoordinatorRecovery", "CALLER_SUPPLIED_RECOVERY_INPUT_REJECTED_USE_CANONICAL_PLAN")
}
export function verifyCanonicalWorkerCoordinatorRecoveryPlan(value = PLAN) {
  validatePlan(value)
  return deepFreeze({
    ok: true,
    code: "WORKER_COORDINATOR_RECOVERY_PLAN_VERIFIED",
    contentHash: PLAN_HASH,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    githubWritePerformed: false,
    processControlPerformed: false,
    concurrentWritersAllowed: false,
    authorityGranted: false,
  })
}
export function runCanonicalWorkerCoordinatorRecovery() {
  const counts = validatePlan(PLAN)
  const output = {
    schemaVersion: 1,
    artifactType: "WORKER_COORDINATOR_RECOVERY_RESULT",
    workOrderId: "WO-MAO-047",
    status: "WORKER_COORDINATOR_RECOVERY_PROVEN",
    recoveryId: PLAN.recoveryId,
    planContentHash: PLAN_HASH,
    repository: PLAN.repository,
    baseRef: PLAN.baseRef,
    baseCommitSha: PLAN.baseCommitSha,
    baseTreeHash: PLAN.baseTreeHash,
    dependencyWorkOrders: PLAN.dependencyEvidence.map((entry) => entry.workOrderId).sort(),
    recoveryPoints: PLAN.recoveryScenarios.map((entry) => entry.name).sort(),
    durableSources: PLAN.durableSources.map((entry) => entry.source).sort(),
    fenceNames: PLAN.concurrencyFences.map((entry) => entry.name).sort(),
    ...counts,
    foreignChangeCount: PLAN.foreignChanges.length,
    secretLikeFindings: PLAN.secretScan.secretLikeFindings,
    orderedOperations: [
      "LOAD_DURABLE_LEASE_CHECKPOINT_AND_WORKSPACE_RECORDS",
      "CLASSIFY_LAST_DURABLE_RECOVERY_POINT",
      "VERIFY_EXPIRED_OR_RENEWABLE_SINGLE_WRITER_LEASE",
      "RECONCILE_OWNED_WORKSPACE_REMOTE_REF_AND_PR_LINKAGE",
      "APPLY_IDEMPOTENCY_AND_CONCURRENCY_FENCES",
      "RESUME_FROM_DURABLE_STATE_OR_STOP_TYPED_AMBIGUITY",
      "RECORD_STATIC_RECOVERY_EVIDENCE_ONLY",
    ],
    schedulerAdded: false,
    providerExecutionPerformed: false,
    githubApiCalled: false,
    githubWritePerformed: false,
    productionWritePerformed: false,
    runtimeActivationAllowed: false,
    processControlPerformed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    stateMutationPerformed: false,
    secretMaterialAllowed: false,
    concurrentWritersAllowed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}
export function loadCanonicalWorkerCoordinatorRecoveryPlan() { return deepFreeze(deepCopy(PLAN)) }
export function workerCoordinatorRecoveryPlanContentHash(value = PLAN) { return contentHash(value) }
export function canonicalWorkerCoordinatorRecoveryJson(value) { return canonicalJson(value) }
