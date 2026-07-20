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
  matchedRules?: string[]
  status: string
}

export type OwnerOutcomeDeliveryState =
  | "AWAITING_OUTCOME"
  | "ACTIVE"
  | "OWNER_DECISION_REQUIRED"
  | "REFUSED"
  | "DISMISSED"
  | "HANDED_OFF"

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

  const scopeBlockedReasons = BLOCKED_SCOPE
    .filter((boundary) => boundary.pattern.test(source.command))
    .map((boundary) => boundary.code)
  const refused = source.verdict === "refuse"
  const dismissed = source.status === "dismissed"
  const handedOff = source.status === "converted"
  const doctrineApprovalRequired = source.verdict === "requires_approval"
    && (source.matchedRules?.length ?? 0) > 0
  const blockedReasons = doctrineApprovalRequired
    ? [...scopeBlockedReasons, "DOCTRINE_APPROVAL_REQUIRED"]
    : scopeBlockedReasons
  const standingVerdict = source.verdict === "allow"
    || (source.verdict === "requires_approval" && !doctrineApprovalRequired)
  const standingEligible = !refused
    && !dismissed
    && !handedOff
    && !doctrineApprovalRequired
    && standingVerdict
    && blockedReasons.length === 0
    && STANDING_LANES.has(source.lane)
    && source.risk === "low"
    && ["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"].includes(source.authority)
  const state: OwnerOutcomeDeliveryState = refused
    ? "REFUSED"
    : dismissed
      ? "DISMISSED"
      : handedOff
        ? "HANDED_OFF"
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
      : dismissed
        ? "OUTCOME_DISMISSED" as const
        : handedOff
          ? "DRAFT_ALREADY_HANDED_OFF" as const
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
  ["WO-OWNER-OUTCOME-001", "Program Activation and Authority Record", "COMPLETE", "docs/governance/owner-outcome-delivery-program.md"],
  ["WO-OWNER-OUTCOME-002", "Owner Outcome Contract", "COMPLETE", "docs/governance/owner-outcome-delivery-program.md"],
  ["WO-OWNER-OUTCOME-003", "Primary Outcome Intake Integration", "COMPLETE", "components/goal-console/goal-console-view.tsx"],
  ["WO-OWNER-OUTCOME-004", "Generated Program, Goal, Loop, and Work Order Model", "COMPLETE", "components/operator/owner-outcome-delivery.ts"],
  ["WO-OWNER-OUTCOME-005", "Rolling Queue and No-Dead-End Invariant", "COMPLETE", "tests/portfolio-operator.test.ts"],
  ["WO-OWNER-OUTCOME-006", "Durable Session Handoff Evidence", "COMPLETE", "components/goal-console/owner-outcome-delivery-panel.tsx"],
  ["WO-OWNER-OUTCOME-007", "Real WilliamOS Feature Delivery Proof", "READY", "tests/owner-outcome-delivery.test.ts"],
  ["WO-OWNER-OUTCOME-008", "Safety, Validation, and Program Rollup", "PENDING", "docs/reports/WO-OWNER-OUTCOME-001-owner-outcome-delivery-rollup.md"],
  ["WO-OWNER-OUTCOME-009", "Rolling Owner Outcome Intake", "PENDING", "docs/reports/WO-OWNER-OUTCOME-009.md"],
] as const satisfies ReadonlyArray<readonly [string, string, "COMPLETE" | "READY" | "PENDING", string]>
