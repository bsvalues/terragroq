import type {
  OperatorProgramRecord,
  OperatorRiskClass,
} from "@/components/operator/codex-operator-registry"

export type NextWorkOrderResolution =
  | { decision: "NEXT_WORK_ORDER"; workOrderId: string; blockers: [] }
  | { decision: "BLOCKED_DEPENDENCY"; workOrderId: string; blockers: string[] }
  | { decision: "GOAL_COMPLETE"; workOrderId: null; blockers: [] }

export function resolveNextOperatorWorkOrder(
  program: OperatorProgramRecord,
): NextWorkOrderResolution {
  const next = program.workOrders.find((workOrder) => workOrder.status !== "COMPLETE")
  if (!next) return { decision: "GOAL_COMPLETE", workOrderId: null, blockers: [] }

  const completeIds = new Set(
    program.workOrders
      .filter((workOrder) => workOrder.status === "COMPLETE")
      .map((workOrder) => workOrder.workOrderId),
  )
  const blockers = next.dependsOn.filter((dependency) => !completeIds.has(dependency))

  if (blockers.length > 0) {
    return {
      decision: "BLOCKED_DEPENDENCY",
      workOrderId: next.workOrderId,
      blockers,
    }
  }

  return { decision: "NEXT_WORK_ORDER", workOrderId: next.workOrderId, blockers: [] }
}

export type ContinuationReasonCode =
  | "NEXT_WO_ELIGIBLE"
  | "IN_SCOPE_REPAIR"
  | "GOAL_PROVEN"
  | "GOAL_NOT_PROVEN"
  | "RISK_CEILING_WALL"
  | "OUT_OF_SCOPE_REPAIR_WALL"
  | "AUTH_ACCESS_WALL"
  | "DB_SCHEMA_WALL"
  | "SECRET_WALL"
  | "TERRAFUSION_PACS_WALL"
  | "RUNTIME_ACTIVATION_WALL"
  | "DESTRUCTIVE_OPERATION_WALL"

export type ContinuationDecision = {
  decision: "CONTINUE" | "REMEDIATE" | "COMPLETE" | "AUTHORITY_WALL"
  reasonCode: ContinuationReasonCode
  explanation: string
}

export type ContinuationInput = {
  previousWorkOrderResult: "PASS" | "FAILED_VALIDATION"
  nextRiskClass: OperatorRiskClass | null
  riskCeiling: OperatorRiskClass
  repairInsideScope?: boolean
  goalCriteriaProven?: boolean
  requestedCapability?: string
}

const RISK_RANK: Record<OperatorRiskClass, number> = {
  R0: 0,
  R1: 1,
  R2: 2,
  R3: 3,
  R4: 4,
}

const CAPABILITY_WALLS: { pattern: RegExp; reasonCode: ContinuationReasonCode }[] = [
  { pattern: /auth|access policy|signup|credential/i, reasonCode: "AUTH_ACCESS_WALL" },
  { pattern: /database|schema|migration|data mutation/i, reasonCode: "DB_SCHEMA_WALL" },
  { pattern: /secret|token|password|cookie|private key/i, reasonCode: "SECRET_WALL" },
  { pattern: /TerraFusion|PACS|county.*mutation/i, reasonCode: "TERRAFUSION_PACS_WALL" },
  { pattern: /Hermes|MCP|worker|scheduler|command runner|runtime activation/i, reasonCode: "RUNTIME_ACTIVATION_WALL" },
  { pattern: /destructive|reset --hard|force.*worktree|history rewrite/i, reasonCode: "DESTRUCTIVE_OPERATION_WALL" },
]

export function evaluateOperatorContinuation(input: ContinuationInput): ContinuationDecision {
  if (input.requestedCapability) {
    const wall = CAPABILITY_WALLS.find(({ pattern }) => pattern.test(input.requestedCapability!))
    if (wall) {
      return {
        decision: "AUTHORITY_WALL",
        reasonCode: wall.reasonCode,
        explanation: `The requested capability crosses ${wall.reasonCode}.`,
      }
    }
  }

  if (input.previousWorkOrderResult === "FAILED_VALIDATION") {
    if (input.repairInsideScope) {
      return {
        decision: "REMEDIATE",
        reasonCode: "IN_SCOPE_REPAIR",
        explanation: "Repair the validation failure inside the active Work Order and rerun its gates.",
      }
    }
    return {
      decision: "AUTHORITY_WALL",
      reasonCode: "OUT_OF_SCOPE_REPAIR_WALL",
      explanation: "The repair requires scope beyond the active Work Order.",
    }
  }

  if (input.nextRiskClass === null) {
    return input.goalCriteriaProven
      ? {
          decision: "COMPLETE",
          reasonCode: "GOAL_PROVEN",
          explanation: "No registered work remains and all success criteria are evidenced.",
        }
      : {
          decision: "AUTHORITY_WALL",
          reasonCode: "GOAL_NOT_PROVEN",
          explanation: "No Work Order remains, but goal completion evidence is incomplete.",
        }
  }

  if (RISK_RANK[input.nextRiskClass] > RISK_RANK[input.riskCeiling]) {
    return {
      decision: "AUTHORITY_WALL",
      reasonCode: "RISK_CEILING_WALL",
      explanation: `${input.nextRiskClass} exceeds the active ${input.riskCeiling} ceiling.`,
    }
  }

  return {
    decision: "CONTINUE",
    reasonCode: "NEXT_WO_ELIGIBLE",
    explanation: "The next registered Work Order is dependency-ready and inside the active risk ceiling.",
  }
}

export type OperatorStopPacketInput = {
  decisionId: string
  blockedWorkOrderId: string
  wallType: ContinuationReasonCode
  decisionRequired: string
  options: string[]
  recommendedOption: string
  risk: OperatorRiskClass
  safeDefault: string
  resumeAction: string
}

export function buildOperatorStopPacket(input: OperatorStopPacketInput) {
  return {
    ...input,
    ownerDecisionRequired: true as const,
    doNotProvide: [
      "passwords",
      "tokens",
      "cookies",
      "session values",
      "private keys",
      "database URLs",
      "secrets",
    ],
  }
}
