export const OWNER_OUTCOME_PROGRAM_ID = "PROGRAM-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"
export const OWNER_OUTCOME_GOAL_ID = "GOAL-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"
export const OWNER_OUTCOME_LOOP_ID = "LOOP-WILLIAMOS-OWNER-OUTCOME-DELIVERY-001"

export type OwnerOutcomeSource = {
  id?: number
  ref: string | null
  command: string
  lane: string
  mode: string
  risk: string
  authority: string
  verdict: string
  requiresApproval: boolean
  status: string
}

export type OwnerOutcomeDeliveryState = "AWAITING_OUTCOME" | "ACTIVE" | "OWNER_DECISION_REQUIRED" | "REFUSED"

const STANDING_LANES = new Set(["docs", "ui", "read_model"])
const BLOCKED_SCOPE = [
  { code: "TERRAFUSION_SCOPE", pattern: /\b(terrafusion|terrapilot|property workbench)\b/i },
  { code: "COUNTY_PROTECTED_SCOPE", pattern: /\b(county|pacs|parcel|taxpayer|protected data)\b/i },
  { code: "PRODUCTION_SCOPE", pattern: /\b(production|deploy|release|vercel|azure)\b/i },
  { code: "RUNTIME_SCOPE", pattern: /\b(runtime activation|background worker|scheduler|command runner|issue\s*#?357)\b/i },
  { code: "SECRET_SCOPE", pattern: /\b(secret|password|token|credential|api key)\b/i },
] as const

const WORK_ORDER_TITLES = [
  "Outcome and Authority Reconciliation",
  "Current Truth and Dependency Scan",
  "Bounded WilliamOS Feature Delivery",
  "Focused and Full Validation",
  "Reviewed GitHub Delivery",
  "Merged-Main Proof and Successor Release",
] as const

function deliveryRef(source: OwnerOutcomeSource) {
  return (source.ref ?? `GOAL-${source.id ?? "UNRECORDED"}`).replace(/[^A-Z0-9-]/gi, "-").toUpperCase()
}

export function buildOwnerOutcomeDelivery(source: OwnerOutcomeSource | null) {
  const base = {
    programId: OWNER_OUTCOME_PROGRAM_ID,
    goalId: OWNER_OUTCOME_GOAL_ID,
    loopId: OWNER_OUTCOME_LOOP_ID,
    ownerOperationsAllowed: false,
    runtimeMode: "HOSTED_CODEX_SESSION" as const,
    durableRuntimeActive: false,
  }

  if (!source) {
    return {
      ...base,
      state: "AWAITING_OUTCOME" as const,
      authorityDecision: "AWAITING_PRIMARY_OUTCOME" as const,
      source: null,
      workOrders: [],
      ownerDecisionRequired: false,
      blockedReasons: [],
      handoff: null,
    }
  }

  const blockedReasons = BLOCKED_SCOPE
    .filter((boundary) => boundary.pattern.test(source.command))
    .map((boundary) => boundary.code)
  const refused = source.verdict === "refuse"
  const standingEligible = !refused
    && blockedReasons.length === 0
    && STANDING_LANES.has(source.lane)
    && source.risk === "low"
    && ["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"].includes(source.authority)
  const state: OwnerOutcomeDeliveryState = refused
    ? "REFUSED"
    : standingEligible
      ? "ACTIVE"
      : "OWNER_DECISION_REQUIRED"
  const ref = deliveryRef(source)
  const workOrders = state === "ACTIVE"
    ? WORK_ORDER_TITLES.map((title, index) => ({
        workOrderId: `WO-OWNER-OUTCOME-${ref}-${String(index + 1).padStart(3, "0")}`,
        title,
        status: index === 0 ? "READY" as const : "PENDING" as const,
        riskClass: index < 2 ? "R0" as const : "R1" as const,
        ownerOperationsAllowed: false,
      }))
    : []

  return {
    ...base,
    state,
    authorityDecision: refused
      ? "DOCTRINE_REFUSED" as const
      : standingEligible
        ? "STANDING_R0_R1" as const
        : "NEW_OWNER_AUTHORITY_REQUIRED" as const,
    source: {
      ref: source.ref,
      outcome: source.command,
      lane: source.lane,
      mode: source.mode,
      risk: source.risk,
      authority: source.authority,
    },
    workOrders,
    ownerDecisionRequired: state === "OWNER_DECISION_REQUIRED",
    blockedReasons,
    handoff: state === "ACTIVE"
      ? {
          evidenceAnchor: `goal-register:${source.ref ?? source.id ?? "unrecorded"}`,
          nextWorkOrderId: workOrders[0]?.workOrderId ?? null,
          continuationRule: "Resume from the first incomplete Work Order and keep the same outcome evidence chain.",
          lifecycleOwner: "Codex owns implementation, validation, PR, review remediation, eligible merge, verification, and successor release.",
        }
      : null,
  }
}

export const OWNER_OUTCOME_PROGRAM_WORK_ORDERS = [
  "Program Activation and Authority Record",
  "Owner Outcome Contract",
  "Primary Outcome Intake Integration",
  "Generated Program, Goal, Loop, and Work Order Model",
  "Rolling Queue and No-Dead-End Invariant",
  "Durable Session Handoff Evidence",
  "Real WilliamOS Feature Delivery Proof",
  "Safety, Validation, and Program Rollup",
  "Rolling Owner Outcome Intake",
] as const
