import { hashRecord } from "@/lib/governance/hash"

export type ReleaseEngineeringWorkOrderId =
  | "WO-RELEASE-002"
  | "WO-RELEASE-003"
  | "WO-RELEASE-004"
  | "WO-RELEASE-005"
  | "WO-RELEASE-006"

export type ReleaseEngineeringStatus =
  | "STATIC_CONTRACT_MODELED"
  | "READINESS_GATE_MODELED"
  | "ROLLBACK_EVIDENCE_MODELED"
  | "READ_ONLY_SURFACE_MODELED"
  | "SAFETY_ROLLUP_COMPLETE"

export type ReleaseEngineeringWorkOrder = {
  workOrderId: ReleaseEngineeringWorkOrderId
  title: string
  status: ReleaseEngineeringStatus
  purpose: string
  reportPath: string
  requiredInputs: readonly string[]
  acceptanceGates: readonly string[]
  forbiddenActions: readonly string[]
  downstreamState: string
}

export type ReleaseEngineeringProgramModel = {
  programId: "PROGRAM-RELEASE-ENGINEERING-001"
  goalId: "GOAL-RELEASE-ENGINEERING-001"
  loopId: "LOOP-RELEASE-ENGINEERING-001"
  laneId: "codex-release-engineering-foundation"
  authorityMode: "CODEX_ELIGIBLE"
  riskCeiling: "R1"
  modelKind: "STATIC_READ_ONLY_RELEASE_ENGINEERING_MODEL"
  workOrders: readonly ReleaseEngineeringWorkOrder[]
  safety: {
    releaseOrDeploymentExecuted: false
    tagOrRollbackExecuted: false
    productionWriteAdded: false
    githubCallPerformed: false
    authDbEnvPackageVercelChanged: false
    secretOrCredentialAccessed: false
    commandRunnerOrWorkerAdded: false
    runtimeOrAutonomyActivated: false
    ownerTaskCreated: false
  }
  recordContentHash: string
}

const FORBIDDEN_RELEASE_ACTIONS = Object.freeze([
  "release execution",
  "deployment",
  "tag creation",
  "rollback execution",
  "production write",
  "GitHub API mutation",
  "secret or credential access",
  "environment, package, Vercel, auth, database, schema, or data change",
  "command runner, worker, scheduler, runtime, or autonomy activation",
] as const)

const workOrders = Object.freeze([
  {
    workOrderId: "WO-RELEASE-002",
    title: "Release Artifact and Provenance Contract",
    status: "STATIC_CONTRACT_MODELED",
    purpose: "Define the minimum release artifact manifest before any release action can be trusted.",
    reportPath: "docs/reports/release-engineering/WO-RELEASE-002-artifact-provenance-contract.md",
    requiredInputs: Object.freeze([
      "source commit and tree identity",
      "changed-path inventory",
      "validation commands and outcomes",
      "artifact names, hashes, and storage location when artifacts exist",
      "authority, reviewer, and evidence references",
    ] as const),
    acceptanceGates: Object.freeze([
      "every artifact has source, hash, and validation provenance",
      "missing artifact proof blocks release readiness",
      "provenance does not contain secrets or raw credentials",
    ] as const),
    forbiddenActions: FORBIDDEN_RELEASE_ACTIONS,
    downstreamState: "READY_FOR_WO_RELEASE_003",
  },
  {
    workOrderId: "WO-RELEASE-003",
    title: "Release Readiness Gate Model",
    status: "READINESS_GATE_MODELED",
    purpose: "Model a fail-closed release readiness decision from evidence, not operator memory.",
    reportPath: "docs/reports/release-engineering/WO-RELEASE-003-readiness-gate-model.md",
    requiredInputs: Object.freeze([
      "artifact provenance contract result",
      "required validation result set",
      "review and unresolved-thread posture",
      "authority and protected-action boundary",
      "known rollback evidence posture",
    ] as const),
    acceptanceGates: Object.freeze([
      "all required gates are PASS before release eligibility",
      "UNKNOWN, STALE, or MISSING evidence is blocking",
      "readiness never grants release, deploy, tag, or rollback authority",
    ] as const),
    forbiddenActions: FORBIDDEN_RELEASE_ACTIONS,
    downstreamState: "READY_FOR_WO_RELEASE_004",
  },
  {
    workOrderId: "WO-RELEASE-004",
    title: "Rollback Evidence Contract",
    status: "ROLLBACK_EVIDENCE_MODELED",
    purpose: "Define rollback proof that must exist before any future rollback operation is considered.",
    reportPath: "docs/reports/release-engineering/WO-RELEASE-004-rollback-evidence-contract.md",
    requiredInputs: Object.freeze([
      "rollback target identity",
      "owned-change boundary",
      "restore or revert evidence",
      "post-rollback verification plan",
      "incident and owner-decision classification",
    ] as const),
    acceptanceGates: Object.freeze([
      "rollback target is known before release execution",
      "rollback evidence separates owned changes from foreign state",
      "rollback execution remains blocked without separate authority",
    ] as const),
    forbiddenActions: FORBIDDEN_RELEASE_ACTIONS,
    downstreamState: "READY_FOR_WO_RELEASE_005",
  },
  {
    workOrderId: "WO-RELEASE-005",
    title: "Release Operator Read-Only Surface",
    status: "READ_ONLY_SURFACE_MODELED",
    purpose: "Define a read-only release surface model that can display evidence without acting on it.",
    reportPath: "docs/reports/release-engineering/WO-RELEASE-005-read-only-surface-model.md",
    requiredInputs: Object.freeze([
      "program and work-order status",
      "artifact provenance summary",
      "readiness gate summary",
      "rollback evidence summary",
      "safety and authority boundary summary",
    ] as const),
    acceptanceGates: Object.freeze([
      "surface exposes no release, deploy, tag, rollback, or mutation command",
      "unknown evidence is displayed as blocking",
      "owner-only authority boundaries stay visible and non-actionable",
    ] as const),
    forbiddenActions: FORBIDDEN_RELEASE_ACTIONS,
    downstreamState: "READY_FOR_WO_RELEASE_006",
  },
  {
    workOrderId: "WO-RELEASE-006",
    title: "Safety Validation and Program Rollup",
    status: "SAFETY_ROLLUP_COMPLETE",
    purpose: "Roll up the static release-engineering contracts and confirm no protected operation was introduced.",
    reportPath: "docs/reports/release-engineering/WO-RELEASE-006-safety-rollup.md",
    requiredInputs: Object.freeze([
      "WO-RELEASE-002 artifact and provenance contract",
      "WO-RELEASE-003 readiness gate model",
      "WO-RELEASE-004 rollback evidence contract",
      "WO-RELEASE-005 read-only surface model",
      "focused release-engineering tests",
    ] as const),
    acceptanceGates: Object.freeze([
      "all release engineering work orders remain static/read-only",
      "protected release operations remain false in the typed model",
      "focused tests pass",
    ] as const),
    forbiddenActions: FORBIDDEN_RELEASE_ACTIONS,
    downstreamState: "STATIC_RELEASE_ENGINEERING_FOUNDATION_COMPLETE",
  },
] satisfies readonly ReleaseEngineeringWorkOrder[])

const modelClaims = {
  programId: "PROGRAM-RELEASE-ENGINEERING-001",
  goalId: "GOAL-RELEASE-ENGINEERING-001",
  loopId: "LOOP-RELEASE-ENGINEERING-001",
  laneId: "codex-release-engineering-foundation",
  authorityMode: "CODEX_ELIGIBLE",
  riskCeiling: "R1",
  modelKind: "STATIC_READ_ONLY_RELEASE_ENGINEERING_MODEL",
  workOrders,
  safety: {
    releaseOrDeploymentExecuted: false,
    tagOrRollbackExecuted: false,
    productionWriteAdded: false,
    githubCallPerformed: false,
    authDbEnvPackageVercelChanged: false,
    secretOrCredentialAccessed: false,
    commandRunnerOrWorkerAdded: false,
    runtimeOrAutonomyActivated: false,
    ownerTaskCreated: false,
  },
} as const

export const RELEASE_ENGINEERING_PROGRAM_MODEL = Object.freeze({
  ...modelClaims,
  recordContentHash: hashRecord(modelClaims),
} satisfies ReleaseEngineeringProgramModel)

export function getReleaseEngineeringWorkOrder(id: ReleaseEngineeringWorkOrderId) {
  return RELEASE_ENGINEERING_PROGRAM_MODEL.workOrders.find((workOrder) => workOrder.workOrderId === id)
}

function matchesCanonicalReleaseWorkOrder(workOrder: ReleaseEngineeringWorkOrder, index: number) {
  const expected = workOrders[index]

  return expected !== undefined
    && workOrder.workOrderId === expected.workOrderId
    && workOrder.title === expected.title
    && workOrder.status === expected.status
    && workOrder.purpose === expected.purpose
    && workOrder.reportPath === expected.reportPath
    && JSON.stringify(workOrder.requiredInputs) === JSON.stringify(expected.requiredInputs)
    && JSON.stringify(workOrder.acceptanceGates) === JSON.stringify(expected.acceptanceGates)
    && JSON.stringify(workOrder.forbiddenActions) === JSON.stringify(expected.forbiddenActions)
    && workOrder.downstreamState === expected.downstreamState
}

export function isVerifiedReleaseEngineeringProgramModel(
  model: ReleaseEngineeringProgramModel = RELEASE_ENGINEERING_PROGRAM_MODEL,
) {
  const { recordContentHash, ...claims } = model
  const expectedIds: ReleaseEngineeringWorkOrderId[] = [
    "WO-RELEASE-002",
    "WO-RELEASE-003",
    "WO-RELEASE-004",
    "WO-RELEASE-005",
    "WO-RELEASE-006",
  ]

  return hashRecord(claims) === recordContentHash
    && model.programId === "PROGRAM-RELEASE-ENGINEERING-001"
    && model.goalId === "GOAL-RELEASE-ENGINEERING-001"
    && model.loopId === "LOOP-RELEASE-ENGINEERING-001"
    && model.laneId === "codex-release-engineering-foundation"
    && model.authorityMode === "CODEX_ELIGIBLE"
    && model.riskCeiling === "R1"
    && model.modelKind === "STATIC_READ_ONLY_RELEASE_ENGINEERING_MODEL"
    && JSON.stringify(model.workOrders.map((workOrder) => workOrder.workOrderId)) === JSON.stringify(expectedIds)
    && model.workOrders.every(matchesCanonicalReleaseWorkOrder)
    && Object.values(model.safety).every((value) => value === false)
}
