export type CouncilDecisionPacketStatus =
  | "draft"
  | "ready-for-review"
  | "blocked-for-evidence"
  | "blocked-for-authority"

export type CouncilDecisionPacketFieldLabel =
  | "Packet ID"
  | "Goal ID"
  | "Work Order ID"
  | "Problem statement"
  | "Context used"
  | "Evidence used"
  | "Assumptions"
  | "Options considered"
  | "Recommendation"
  | "Confidence"
  | "Risk rating"
  | "Safety flags"
  | "Blocked actions"
  | "Authority required"
  | "Validation required"
  | "Evidence required"
  | "Recommended Work Order"
  | "Next safe gate"

export type CouncilDecisionPacketRequiredField = {
  label: CouncilDecisionPacketFieldLabel
  required: boolean
  description: string
}

export type CouncilDecisionPacketAuthorityCheck = {
  label: string
  required: boolean
  description: string
}

export type CouncilDecisionPacketSchema = {
  title: string
  summary: string
  statusFlow: CouncilDecisionPacketStatus[]
  requiredFields: CouncilDecisionPacketRequiredField[]
  authorityChecks: CouncilDecisionPacketAuthorityCheck[]
  blockedUntilApproved: string[]
  criticalRule: string
  safety: {
    schemaOnly: true
    authorizesWork: false
    createsWorkOrder: false
    executesRecommendation: false
    changesPolicy: false
    writesProduction: false
  }
}

export function getCouncilDecisionPacketSchema(): CouncilDecisionPacketSchema {
  return {
    title: "Council decision packet schema",
    summary:
      "Decision packets package Council reasoning for Primary review. They can recommend a next move, but they do not authorize work, create Work Orders, or execute anything.",
    statusFlow: [
      "draft",
      "blocked-for-evidence",
      "ready-for-review",
      "blocked-for-authority",
    ],
    requiredFields: [
      {
        label: "Packet ID",
        required: true,
        description: "Stable identifier for the advisory packet.",
      },
      {
        label: "Goal ID",
        required: true,
        description: "The governed goal this advice supports.",
      },
      {
        label: "Work Order ID",
        required: false,
        description: "The related Work Order when a scoped WO already exists.",
      },
      {
        label: "Problem statement",
        required: true,
        description: "The bounded decision or uncertainty the Council is answering.",
      },
      {
        label: "Context used",
        required: true,
        description: "Current base, prior reports, doctrine, and known lane boundaries used for the advice.",
      },
      {
        label: "Evidence used",
        required: true,
        description: "Proof, source references, validation, or production observations behind the claim.",
      },
      {
        label: "Assumptions",
        required: true,
        description: "Assumptions that remain visible and reduce confidence when unproven.",
      },
      {
        label: "Options considered",
        required: true,
        description: "Candidate next moves, including no-action or blocked recommendations.",
      },
      {
        label: "Recommendation",
        required: true,
        description: "The Council's proposed next move, framed as advice only.",
      },
      {
        label: "Confidence",
        required: true,
        description: "Confidence level with evidence basis and reducers.",
      },
      {
        label: "Risk rating",
        required: true,
        description: "Risk level with escalators and safety flags.",
      },
      {
        label: "Safety flags",
        required: true,
        description: "Explicit false/blocked runtime, execution, data, production, and secret flags.",
      },
      {
        label: "Blocked actions",
        required: true,
        description: "Actions that remain prohibited until authority and evidence gates pass.",
      },
      {
        label: "Authority required",
        required: true,
        description: "Owner authority required before this advice can become a mutation lane.",
      },
      {
        label: "Validation required",
        required: true,
        description: "Checks that must pass before a Work Order can be trusted.",
      },
      {
        label: "Evidence required",
        required: true,
        description: "Proof still required before the recommendation can be accepted.",
      },
      {
        label: "Recommended Work Order",
        required: true,
        description: "A proposed Work Order packet or next WO, not an execution request.",
      },
      {
        label: "Next safe gate",
        required: true,
        description: "The next owner, validation, or evidence gate that keeps the lane bounded.",
      },
    ],
    authorityChecks: [
      {
        label: "Work Order boundary",
        required: true,
        description: "Any mutation must be converted into governed scope before work starts.",
      },
      {
        label: "Primary approval",
        required: true,
        description: "Owner authority is required before access, policy, execution, or production changes.",
      },
      {
        label: "Evidence rollup",
        required: true,
        description: "Claims must connect to tests, checks, production observations, or documented proof.",
      },
    ],
    blockedUntilApproved: [
      "execute recommendation",
      "create production write path",
      "activate Hermes",
      "activate MCP",
      "grant access",
      "change auth policy",
    ],
    criticalRule: "Decision packets recommend. They do not execute.",
    safety: {
      schemaOnly: true,
      authorizesWork: false,
      createsWorkOrder: false,
      executesRecommendation: false,
      changesPolicy: false,
      writesProduction: false,
    },
  }
}

export function isCouncilDecisionPacketReviewable(
  fields: Partial<Record<CouncilDecisionPacketFieldLabel, string>>,
): boolean {
  return getCouncilDecisionPacketSchema().requiredFields.every((field) => {
    const value = fields[field.label]
    return !field.required || Boolean(value?.trim())
  })
}
