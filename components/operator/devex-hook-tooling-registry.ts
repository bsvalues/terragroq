import { hashRecord } from "@/lib/governance/hash"

export type DevexHookToolingWorkOrderId =
  | "WO-DEVEX-HOOK-TOOLING-001"
  | "WO-DEVEX-HOOK-TOOLING-002"
  | "WO-DEVEX-HOOK-TOOLING-003"

export type DevexHookToolingWorkOrderEvidence = {
  workOrderId: DevexHookToolingWorkOrderId
  title: string
  result: string
  evidencePath: string
  staticReadOnly: true
}

export type DevexHookToolingSafetyEvidence = {
  staticReadOnlyReport: true
  runtimeExecutionAdded: false
  gitHookInstalled: false
  githubCallPerformed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  authOrSecretTouched: false
  dbOrEnvOrPackageChanged: false
  productionWritePerformed: false
  ownerOperationRequired: false
  authorityGranted: false
}

export type DevexHookToolingProgramEvidence = {
  evidenceId: "EVIDENCE-DEVEX-HOOK-TOOLING-PROGRAM-V1"
  status: "STATIC_DEVEX_HOOK_TOOLING_PROGRAM_VERIFIED"
  programId: "PROGRAM-DEVEX-HOOK-TOOLING-001"
  laneId: "codex-devex-hook-tooling-foundation"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  authorityScope: "STATIC_READ_ONLY_DEVEX_HOOK_TOOLING"
  workOrders: readonly DevexHookToolingWorkOrderEvidence[]
  allowedPathPrefixes: readonly string[]
  blockedSurfaces: readonly string[]
  safety: DevexHookToolingSafetyEvidence
  completedWorkOrderCount: 3
  foreignChangeCount: 0
  secretLikeFindings: 0
  ownerTouchCount: 0
  completionState: "COMPLETE"
  certificationUse: "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

export const DEVEX_HOOK_TOOLING_WORK_ORDERS = Object.freeze([
  {
    workOrderId: "WO-DEVEX-HOOK-TOOLING-001",
    title: "Current evidence reconciliation",
    result: "PASS / STATIC_READ_ONLY_EVIDENCE_RECONCILED",
    evidencePath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-001-evidence-reconciliation.md",
    staticReadOnly: true,
  },
  {
    workOrderId: "WO-DEVEX-HOOK-TOOLING-002",
    title: "Bounded hook/tooling policy inventory slice",
    result: "PASS / STATIC_POLICY_INVENTORY_RECORDED",
    evidencePath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-002-policy-inventory.md",
    staticReadOnly: true,
  },
  {
    workOrderId: "WO-DEVEX-HOOK-TOOLING-003",
    title: "Safety and rollup",
    result: "PASS / STATIC_SAFETY_ROLLUP_RECORDED",
    evidencePath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-003-safety-rollup.md",
    staticReadOnly: true,
  },
] as const satisfies readonly DevexHookToolingWorkOrderEvidence[])

const DEVEX_HOOK_TOOLING_RECORD_CLAIMS = {
  evidenceId: "EVIDENCE-DEVEX-HOOK-TOOLING-PROGRAM-V1",
  status: "STATIC_DEVEX_HOOK_TOOLING_PROGRAM_VERIFIED",
  programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
  laneId: "codex-devex-hook-tooling-foundation",
  repository: "bsvalues/terragroq",
  baseCommitSha: "14eabc3a044e7464a7515f285b18a4438d7eb59e",
  baseTreeHash: "f7a3cc603ad13df8c15702d64fe1ebfeff7750ac",
  authorityScope: "STATIC_READ_ONLY_DEVEX_HOOK_TOOLING",
  workOrders: DEVEX_HOOK_TOOLING_WORK_ORDERS,
  allowedPathPrefixes: Object.freeze([
    "docs/governance/devex-hook-tooling-program.md",
    "docs/reports/devex-hook-tooling/",
    "components/operator/devex-",
    "tests/devex-",
  ] as const),
  blockedSurfaces: Object.freeze([
    "git-hook-installation",
    "package-or-env-mutation",
    "github-api-call",
    "runtime-activation",
    "command-runner",
    "background-worker",
    "auth-or-secret-access",
    "production-write",
    "owner-operation",
  ] as const),
  safety: {
    staticReadOnlyReport: true,
    runtimeExecutionAdded: false,
    gitHookInstalled: false,
    githubCallPerformed: false,
    commandRunnerAdded: false,
    backgroundWorkerAdded: false,
    authOrSecretTouched: false,
    dbOrEnvOrPackageChanged: false,
    productionWritePerformed: false,
    ownerOperationRequired: false,
    authorityGranted: false,
  },
  completedWorkOrderCount: 3,
  foreignChangeCount: 0,
  secretLikeFindings: 0,
  ownerTouchCount: 0,
  completionState: "COMPLETE",
  certificationUse: "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE",
} as const

export const DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE = Object.freeze({
  ...DEVEX_HOOK_TOOLING_RECORD_CLAIMS,
  recordContentHash: hashRecord(DEVEX_HOOK_TOOLING_RECORD_CLAIMS),
} satisfies DevexHookToolingProgramEvidence)

export function isDevexHookToolingPathAllowed(path: string) {
  return DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE.allowedPathPrefixes.some((prefix) => {
    if (prefix.endsWith("/") || prefix.endsWith("-")) return path.startsWith(prefix)
    return path === prefix
  })
}

export function isVerifiedDevexHookToolingProgramEvidence(
  record: DevexHookToolingProgramEvidence = DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record
  const expectedKeys = Object.keys(DEVEX_HOOK_TOOLING_PROGRAM_EVIDENCE).sort()

  return JSON.stringify(Object.keys(record).sort()) === JSON.stringify(expectedKeys)
    && hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-DEVEX-HOOK-TOOLING-PROGRAM-V1"
    && record.status === "STATIC_DEVEX_HOOK_TOOLING_PROGRAM_VERIFIED"
    && record.programId === "PROGRAM-DEVEX-HOOK-TOOLING-001"
    && record.laneId === "codex-devex-hook-tooling-foundation"
    && record.repository === "bsvalues/terragroq"
    && record.authorityScope === "STATIC_READ_ONLY_DEVEX_HOOK_TOOLING"
    && record.workOrders.length === record.completedWorkOrderCount
    && record.workOrders.every((workOrder) => workOrder.staticReadOnly && workOrder.evidencePath.startsWith("docs/reports/devex-hook-tooling/"))
    && record.workOrders.map((workOrder) => workOrder.workOrderId).join(",") === "WO-DEVEX-HOOK-TOOLING-001,WO-DEVEX-HOOK-TOOLING-002,WO-DEVEX-HOOK-TOOLING-003"
    && record.allowedPathPrefixes.every((path) => isDevexHookToolingPathAllowed(path))
    && record.blockedSurfaces.length === 9
    && record.safety.staticReadOnlyReport === true
    && record.safety.runtimeExecutionAdded === false
    && record.safety.gitHookInstalled === false
    && record.safety.githubCallPerformed === false
    && record.safety.commandRunnerAdded === false
    && record.safety.backgroundWorkerAdded === false
    && record.safety.authOrSecretTouched === false
    && record.safety.dbOrEnvOrPackageChanged === false
    && record.safety.productionWritePerformed === false
    && record.safety.ownerOperationRequired === false
    && record.safety.authorityGranted === false
    && record.foreignChangeCount === 0
    && record.secretLikeFindings === 0
    && record.ownerTouchCount === 0
    && record.completionState === "COMPLETE"
    && record.certificationUse === "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && HASH_64.test(record.recordContentHash)
}
