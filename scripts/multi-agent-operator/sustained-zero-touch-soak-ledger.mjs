import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const LEDGER_PATH = "docs/reports/WO-MAO-059-sustained-zero-touch-soak/soak-ledger.json"
const REQUIRED_WORK_ORDERS = [
  "WO-RELEASE-002",
  "WO-RELEASE-003",
  "WO-RELEASE-004",
  "WO-RELEASE-005",
  "WO-RELEASE-006",
  "WO-DEVEX-HOOK-TOOLING-001",
  "WO-DEVEX-HOOK-TOOLING-002",
  "WO-DEVEX-HOOK-TOOLING-003",
  "WO-BACKEND-OE-001",
  "WO-BACKEND-OE-002",
]
const REQUIRED_OWNER_COUNTER_KEYS = [
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT",
]
const REQUIRED_BLOCKED_SCOPE_KEYS = [
  "runtimeActivationAllowed",
  "commandRunnerAllowed",
  "backgroundWorkerAllowed",
  "durableProviderDispatchAllowed",
  "productionMutationAllowed",
  "paidOverageAllowed",
  "secretInspectionAllowed",
  "pacsCountyProtectedDataAllowed",
  "rejectedRuntimeRetryAllowed",
  "destructiveCleanupAllowed",
]
const REQUIRED_COMPLETED_WORK_ORDERS = [
  {
    workOrderId: "WO-RELEASE-002",
    programId: "PROGRAM-RELEASE-ENGINEERING-001",
    evidencePath: "docs/reports/release-engineering/WO-RELEASE-002-artifact-provenance-contract.md",
    result: "PASS / STATIC_ARTIFACT_PROVENANCE_CONTRACT_MODELED",
  },
  {
    workOrderId: "WO-RELEASE-003",
    programId: "PROGRAM-RELEASE-ENGINEERING-001",
    evidencePath: "docs/reports/release-engineering/WO-RELEASE-003-readiness-gate-model.md",
    result: "PASS / STATIC_READINESS_GATE_MODELED",
  },
  {
    workOrderId: "WO-RELEASE-004",
    programId: "PROGRAM-RELEASE-ENGINEERING-001",
    evidencePath: "docs/reports/release-engineering/WO-RELEASE-004-rollback-evidence-contract.md",
    result: "PASS / STATIC_ROLLBACK_EVIDENCE_CONTRACT_MODELED",
  },
  {
    workOrderId: "WO-RELEASE-005",
    programId: "PROGRAM-RELEASE-ENGINEERING-001",
    evidencePath: "docs/reports/release-engineering/WO-RELEASE-005-read-only-surface-model.md",
    result: "PASS / STATIC_READ_ONLY_SURFACE_MODELED",
  },
  {
    workOrderId: "WO-RELEASE-006",
    programId: "PROGRAM-RELEASE-ENGINEERING-001",
    evidencePath: "docs/reports/release-engineering/WO-RELEASE-006-safety-rollup.md",
    result: "PASS / STATIC_RELEASE_ENGINEERING_FOUNDATION_COMPLETE",
  },
  {
    workOrderId: "WO-DEVEX-HOOK-TOOLING-001",
    programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
    evidencePath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-001-evidence-reconciliation.md",
    result: "PASS / STATIC_READ_ONLY_EVIDENCE_RECONCILED",
  },
  {
    workOrderId: "WO-DEVEX-HOOK-TOOLING-002",
    programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
    evidencePath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-002-policy-inventory.md",
    result: "PASS / STATIC_POLICY_INVENTORY_RECORDED",
  },
  {
    workOrderId: "WO-DEVEX-HOOK-TOOLING-003",
    programId: "PROGRAM-DEVEX-HOOK-TOOLING-001",
    evidencePath: "docs/reports/devex-hook-tooling/WO-DEVEX-HOOK-TOOLING-003-safety-rollup.md",
    result: "PASS / STATIC_SAFETY_ROLLUP_RECORDED",
  },
  {
    workOrderId: "WO-BACKEND-OE-001",
    programId: "PROGRAM-BACKEND-OE-001",
    evidencePath: "docs/reports/backend-oe/WO-BACKEND-OE-001-evidence-reconciliation.md",
    result: "PASS / STATIC_READ_ONLY_EVIDENCE_RECONCILED",
  },
  {
    workOrderId: "WO-BACKEND-OE-002",
    programId: "PROGRAM-BACKEND-OE-001",
    evidencePath: "docs/reports/backend-oe/WO-BACKEND-OE-002-readiness-failure-boundary.md",
    result: "PASS / STATIC_READINESS_FAILURE_BOUNDARY_MODELED",
  },
]

export class SustainedZeroTouchSoakLedgerError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "SustainedZeroTouchSoakLedgerError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) { throw new SustainedZeroTouchSoakLedgerError(code, field, detail) }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value) }
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  return value
}
function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}
function safeRelativePath(value) {
  return typeof value === "string"
    && !path.isAbsolute(value)
    && !value.includes("\\")
    && !value.split("/").includes("..")
}
function loadLedger(filePath = LEDGER_PATH) {
  return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8"))
}

export function verifyOpenSustainedZeroTouchSoakLedger(ledger = loadLedger()) {
  if (!object(ledger)) wall("SOAK_LEDGER_TYPE_WALL", "ledger")
  if (ledger.artifactType !== "WO_MAO_059_CONTINUOUS_SOAK_LEDGER") wall("SOAK_LEDGER_SCHEMA_WALL", "artifactType")
  if (ledger.programId !== "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001") wall("SOAK_LEDGER_PROGRAM_WALL", "programId")
  if (ledger.workOrderId !== "WO-MAO-059") wall("SOAK_LEDGER_WORK_ORDER_WALL", "workOrderId")
  if (ledger.status !== "IN_PROGRESS") wall("SOAK_LEDGER_STATUS_WALL", "status")
  if (ledger.startCommit !== "14eabc3a044e7464a7515f285b18a4438d7eb59e") wall("SOAK_LEDGER_BASE_WALL", "startCommit")
  if (ledger.minimumElapsedHours !== 24) wall("SOAK_LEDGER_DURATION_WALL", "minimumElapsedHours")
  if (ledger.minimumConsecutiveUsefulWorkOrders !== 10) wall("SOAK_LEDGER_WORK_COUNT_WALL", "minimumConsecutiveUsefulWorkOrders")
  if (JSON.stringify(ledger.selectedUsefulWorkOrderQueue) !== JSON.stringify(REQUIRED_WORK_ORDERS)) wall("SOAK_LEDGER_QUEUE_WALL", "selectedUsefulWorkOrderQueue")
  if (ledger.soakDurationCertified !== false) wall("SOAK_LEDGER_CERTIFICATION_WALL", "soakDurationCertified")
  if (![false, true].includes(ledger.tenConsecutiveWorkOrdersCertified)) wall("SOAK_LEDGER_CERTIFICATION_WALL", "tenConsecutiveWorkOrdersCertified")
  const completedIds = Array.isArray(ledger.completedUsefulWorkOrders)
    ? ledger.completedUsefulWorkOrders.map((entry) => entry?.workOrderId)
    : []
  if (ledger.usefulWorkOrderCount !== completedIds.length) wall("SOAK_LEDGER_PROGRESS_WALL", "usefulWorkOrderCount")
  if (JSON.stringify(completedIds) !== JSON.stringify(REQUIRED_WORK_ORDERS.slice(0, completedIds.length))) wall("SOAK_LEDGER_PROGRESS_WALL", "completedUsefulWorkOrders")
  for (const [index, entry] of (ledger.completedUsefulWorkOrders ?? []).entries()) {
    const expected = REQUIRED_COMPLETED_WORK_ORDERS[index]
    if (!object(entry)) wall("SOAK_LEDGER_PROGRESS_WALL", `completedUsefulWorkOrders[${index}]`)
    for (const field of ["workOrderId", "programId", "evidencePath", "result"]) {
      if (entry[field] !== expected[field]) wall("SOAK_LEDGER_PROGRESS_WALL", `completedUsefulWorkOrders[${index}].${field}`)
    }
    if (!safeRelativePath(entry.evidencePath)) wall("SOAK_LEDGER_PATH_WALL", `completedUsefulWorkOrders[${index}].evidencePath`)
    if (!fs.existsSync(path.resolve(process.cwd(), entry.evidencePath))) wall("SOAK_LEDGER_EVIDENCE_WALL", `completedUsefulWorkOrders[${index}].evidencePath`)
    if (typeof entry.completedAt !== "string" || Number.isNaN(Date.parse(entry.completedAt))) wall("SOAK_LEDGER_TIME_WALL", `completedUsefulWorkOrders[${index}].completedAt`)
  }
  if (ledger.tenConsecutiveWorkOrdersCertified !== (ledger.usefulWorkOrderCount >= 10)) wall("SOAK_LEDGER_PROGRESS_WALL", "tenConsecutiveWorkOrdersCertified")
  if (!["NOT_CERTIFIED", "WORK_ORDER_GATE_LOCALLY_VALIDATED_DURATION_PENDING"].includes(ledger.certificationState)) wall("SOAK_LEDGER_CERTIFICATION_WALL", "certificationState")
  if (ledger.certificationState === "WORK_ORDER_GATE_LOCALLY_VALIDATED_DURATION_PENDING" && ledger.tenConsecutiveWorkOrdersCertified !== true) wall("SOAK_LEDGER_PROGRESS_WALL", "certificationState")
  if (!object(ledger.ownerCounters)) wall("SOAK_LEDGER_OWNER_TOUCH_WALL", "ownerCounters")
  for (const key of REQUIRED_OWNER_COUNTER_KEYS) {
    if (ledger.ownerCounters[key] !== 0) wall("SOAK_LEDGER_OWNER_TOUCH_WALL", key)
  }
  if (!object(ledger.blockedScope)) wall("SOAK_LEDGER_SAFETY_WALL", "blockedScope")
  for (const key of REQUIRED_BLOCKED_SCOPE_KEYS) {
    if (ledger.blockedScope[key] !== false) wall("SOAK_LEDGER_SAFETY_WALL", key)
  }
  return Object.freeze({
    ok: true,
    workOrderId: ledger.workOrderId,
    status: ledger.status,
    usefulWorkOrderCount: ledger.usefulWorkOrderCount,
    soakDurationCertified: false,
    tenConsecutiveWorkOrdersCertified: ledger.tenConsecutiveWorkOrdersCertified,
    certificationState: ledger.certificationState,
    selectedUsefulWorkOrderCount: ledger.selectedUsefulWorkOrderQueue.length,
    completedUsefulWorkOrderCount: completedIds.length,
    ledgerHash: contentHash(ledger),
  })
}

export function loadSustainedZeroTouchSoakLedger() {
  return Object.freeze(loadLedger())
}
