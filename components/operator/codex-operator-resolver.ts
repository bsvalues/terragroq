import type {
  OperatorProgramRecord,
  OperatorRiskClass,
} from "@/components/operator/codex-operator-registry"

export type NextWorkOrderResolution =
  | { decision: "NEXT_WORK_ORDER"; workOrderId: string; blockers: [] }
  | { decision: "BLOCKED_WORK_ORDER"; workOrderId: string; blockers: string[] }
  | { decision: "BLOCKED_DEPENDENCY"; workOrderId: string; blockers: string[] }
  | { decision: "GOAL_COMPLETE"; workOrderId: null; blockers: [] }

export function resolveNextOperatorWorkOrder(
  program: OperatorProgramRecord,
): NextWorkOrderResolution {
  const next = program.workOrders.find((workOrder) => workOrder.status !== "COMPLETE")
  if (!next) return { decision: "GOAL_COMPLETE", workOrderId: null, blockers: [] }

  if (next.status === "BLOCKED") {
    return {
      decision: "BLOCKED_WORK_ORDER",
      workOrderId: next.workOrderId,
      blockers: ["The Work Order is blocked by its recorded authority or validation gate."],
    }
  }

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

export const AUTHORITY_WALL_REASON_CODES = [
  "GOAL_NOT_PROVEN",
  "RISK_CEILING_WALL",
  "OUT_OF_SCOPE_REPAIR_WALL",
  "AUTH_ACCESS_WALL",
  "DB_SCHEMA_WALL",
  "SECRET_WALL",
  "TERRAFUSION_PACS_WALL",
  "RUNTIME_ACTIVATION_WALL",
  "PRODUCTION_RELEASE_WALL",
  "ENV_PACKAGE_VERCEL_WALL",
  "MEMORY_RUNTIME_WALL",
  "SCOPE_EXPANSION_WALL",
  "DESTRUCTIVE_OPERATION_WALL",
] as const

export type AuthorityWallReasonCode = (typeof AUTHORITY_WALL_REASON_CODES)[number]

export type ContinuationReasonCode =
  | "NEXT_WO_ELIGIBLE"
  | "IN_SCOPE_REPAIR"
  | "GOAL_PROVEN"
  | AuthorityWallReasonCode

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

const CAPABILITY_WALLS: { pattern: RegExp; reasonCode: AuthorityWallReasonCode }[] = [
  { pattern: /auth|access policy|signup|credential/i, reasonCode: "AUTH_ACCESS_WALL" },
  { pattern: /database|schema|migration|data mutation/i, reasonCode: "DB_SCHEMA_WALL" },
  { pattern: /secret|token|password|cookie|private key|connection string/i, reasonCode: "SECRET_WALL" },
  { pattern: /TerraFusion|PACS|county.*mutation/i, reasonCode: "TERRAFUSION_PACS_WALL" },
  { pattern: /production (?:deploy|write|promotion)|deploy|release|tag|rollback|cutover/i, reasonCode: "PRODUCTION_RELEASE_WALL" },
  { pattern: /\benv(?:ironment)?\b|package|dependency|Vercel|DNS|cloud|external service/i, reasonCode: "ENV_PACKAGE_VERCEL_WALL" },
  { pattern: /memory (?:write|read|retrieval)|runtime retrieval|dynamic retrieval|vector|embedding|RAG|dynamic ingestion|filesystem scan/i, reasonCode: "MEMORY_RUNTIME_WALL" },
  { pattern: /Hermes|MCP|worker|scheduler|command runner|runtime activation|Agent Forge skill|Brain Council runtime|autonomous|autonomy|background service/i, reasonCode: "RUNTIME_ACTIVATION_WALL" },
  { pattern: /scope expansion|broaden(?:ed|ing)? scope|risk expansion/i, reasonCode: "SCOPE_EXPANSION_WALL" },
  { pattern: /destructive|reset --hard|force.*worktree|history rewrite/i, reasonCode: "DESTRUCTIVE_OPERATION_WALL" },
]

export function evaluateOperatorContinuation(input: ContinuationInput): ContinuationDecision {
  if (input.requestedCapability) {
    const normalizedCapability = input.requestedCapability.replace(/[-_]+/g, " ")
    const wall = CAPABILITY_WALLS.find(({ pattern }) => pattern.test(normalizedCapability))
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
  wallType: AuthorityWallReasonCode
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
