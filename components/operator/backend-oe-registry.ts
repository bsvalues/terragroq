import { hashRecord } from "@/lib/governance/hash"

export type BackendOeWorkOrderId = "WO-BACKEND-OE-001" | "WO-BACKEND-OE-002"

export type BackendOeWorkOrderEvidence = {
  workOrderId: BackendOeWorkOrderId
  title: string
  result: string
  riskClass: "R0" | "R1"
  evidencePath: string
}

export type BackendReadinessClass =
  | "READY"
  | "DEGRADED"
  | "BLOCKED_AUTHORITY"
  | "BLOCKED_SAFETY"
  | "UNKNOWN"

export type BackendOeProgramEvidence = {
  evidenceId: "EVIDENCE-BACKEND-OE-PROGRAM-V1"
  status: "STATIC_BACKEND_OPERATIONAL_EXCELLENCE_VERIFIED"
  programId: "PROGRAM-BACKEND-OE-001"
  repository: "bsvalues/terragroq"
  baseCommitSha: string
  baseTreeHash: string
  authorityScope: "STATIC_READ_ONLY_BACKEND_OPERATIONAL_EXCELLENCE"
  workOrders: readonly BackendOeWorkOrderEvidence[]
  readinessClasses: readonly BackendReadinessClass[]
  observedRoutes: readonly string[]
  blockedSurfaces: readonly string[]
  completedWorkOrderCount: 2
  routeBehaviorChanged: false
  authPolicyChanged: false
  dbSchemaDataChanged: false
  envPackageVercelChanged: false
  productionWritePerformed: false
  commandRunnerAdded: false
  backgroundWorkerAdded: false
  secretOrCredentialAccessed: false
  ownerOperationRequired: false
  ownerTouchCount: 0
  completionState: "COMPLETE"
  certificationUse: "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE"
  recordContentHash: string
}

const HASH_64 = /^[a-f0-9]{64}$/
const SHA_40 = /^[a-f0-9]{40}$/

const WORK_ORDERS = Object.freeze([
  {
    workOrderId: "WO-BACKEND-OE-001",
    title: "Backend Operational Excellence Evidence Reconciliation",
    result: "PASS / STATIC_READ_ONLY_EVIDENCE_RECONCILED",
    riskClass: "R0",
    evidencePath: "docs/reports/backend-oe/WO-BACKEND-OE-001-evidence-reconciliation.md",
  },
  {
    workOrderId: "WO-BACKEND-OE-002",
    title: "Backend Readiness and Failure Boundary Contract",
    result: "PASS / STATIC_READINESS_FAILURE_BOUNDARY_MODELED",
    riskClass: "R1",
    evidencePath: "docs/reports/backend-oe/WO-BACKEND-OE-002-readiness-failure-boundary.md",
  },
] as const satisfies readonly BackendOeWorkOrderEvidence[])

const RECORD_CLAIMS = {
  evidenceId: "EVIDENCE-BACKEND-OE-PROGRAM-V1",
  status: "STATIC_BACKEND_OPERATIONAL_EXCELLENCE_VERIFIED",
  programId: "PROGRAM-BACKEND-OE-001",
  repository: "bsvalues/terragroq",
  baseCommitSha: "14eabc3a044e7464a7515f285b18a4438d7eb59e",
  baseTreeHash: "f7a3cc603ad13df8c15702d64fe1ebfeff7750ac",
  authorityScope: "STATIC_READ_ONLY_BACKEND_OPERATIONAL_EXCELLENCE",
  workOrders: WORK_ORDERS,
  readinessClasses: Object.freeze(["READY", "DEGRADED", "BLOCKED_AUTHORITY", "BLOCKED_SAFETY", "UNKNOWN"] as const),
  observedRoutes: Object.freeze([
    "/api/health",
    "/api/auth/readiness",
    "/api/local/runtime/status",
    "/api/setup/local-status",
    "/api/setup/local-config",
    "/operator",
    "/goal-console",
    "/work-orders",
  ] as const),
  blockedSurfaces: Object.freeze([
    "runtime-service-change",
    "production-write",
    "auth-policy-change",
    "database-schema-data-mutation",
    "environment-package-vercel-change",
    "command-runner",
    "background-worker",
    "scheduler",
    "secret-or-credential-access",
    "pacs-county-protected-data",
  ] as const),
  completedWorkOrderCount: 2,
  routeBehaviorChanged: false,
  authPolicyChanged: false,
  dbSchemaDataChanged: false,
  envPackageVercelChanged: false,
  productionWritePerformed: false,
  commandRunnerAdded: false,
  backgroundWorkerAdded: false,
  secretOrCredentialAccessed: false,
  ownerOperationRequired: false,
  ownerTouchCount: 0,
  completionState: "COMPLETE",
  certificationUse: "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE",
} as const

export const BACKEND_OE_PROGRAM_EVIDENCE = Object.freeze({
  ...RECORD_CLAIMS,
  recordContentHash: hashRecord(RECORD_CLAIMS),
} satisfies BackendOeProgramEvidence)

export function classifyBackendReadiness(input: {
  routeReachable: boolean
  semanticCurrent: boolean
  missingEvidence?: boolean
  authorityRequired?: boolean
  safetyIssue?: boolean
}): BackendReadinessClass {
  if (input.safetyIssue) return "BLOCKED_SAFETY"
  if (input.authorityRequired) return "BLOCKED_AUTHORITY"
  if (input.missingEvidence) return "UNKNOWN"
  if (input.routeReachable && input.semanticCurrent) return "READY"
  return "DEGRADED"
}

export function isVerifiedBackendOeProgramEvidence(
  record: BackendOeProgramEvidence = BACKEND_OE_PROGRAM_EVIDENCE,
) {
  const { recordContentHash, ...recordClaims } = record

  return hashRecord(recordClaims) === recordContentHash
    && record.evidenceId === "EVIDENCE-BACKEND-OE-PROGRAM-V1"
    && record.status === "STATIC_BACKEND_OPERATIONAL_EXCELLENCE_VERIFIED"
    && record.programId === "PROGRAM-BACKEND-OE-001"
    && record.repository === "bsvalues/terragroq"
    && record.authorityScope === "STATIC_READ_ONLY_BACKEND_OPERATIONAL_EXCELLENCE"
    && record.workOrders.map((workOrder) => workOrder.workOrderId).join(",") === "WO-BACKEND-OE-001,WO-BACKEND-OE-002"
    && record.workOrders.length === record.completedWorkOrderCount
    && record.workOrders.every((workOrder) => workOrder.evidencePath.startsWith("docs/reports/backend-oe/"))
    && record.readinessClasses.join(",") === "READY,DEGRADED,BLOCKED_AUTHORITY,BLOCKED_SAFETY,UNKNOWN"
    && record.observedRoutes.includes("/api/health")
    && record.observedRoutes.includes("/api/auth/readiness")
    && record.blockedSurfaces.includes("production-write")
    && record.blockedSurfaces.includes("secret-or-credential-access")
    && record.routeBehaviorChanged === false
    && record.authPolicyChanged === false
    && record.dbSchemaDataChanged === false
    && record.envPackageVercelChanged === false
    && record.productionWritePerformed === false
    && record.commandRunnerAdded === false
    && record.backgroundWorkerAdded === false
    && record.secretOrCredentialAccessed === false
    && record.ownerOperationRequired === false
    && record.ownerTouchCount === 0
    && record.completionState === "COMPLETE"
    && record.certificationUse === "WO-MAO-059_SOAK_STATIC_WORK_ORDER_SEQUENCE"
    && [record.baseCommitSha, record.baseTreeHash].every((value) => SHA_40.test(value))
    && HASH_64.test(record.recordContentHash)
}
