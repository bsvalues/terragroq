export type CouncilDecisionPacketStatus =
  | "draft"
  | "ready-for-review"
  | "blocked-for-evidence"
  | "blocked-for-authority"

export type CouncilDecisionPacketField = {
  label: string
  required: boolean
  description: string
}

export type CouncilDecisionPacketSchema = {
  title: string
  summary: string
  statusFlow: CouncilDecisionPacketStatus[]
  requiredFields: CouncilDecisionPacketField[]
  authorityChecks: CouncilDecisionPacketField[]
  blockedUntilApproved: string[]
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
        label: "Question",
        required: true,
        description: "The bounded decision or uncertainty the Council is answering.",
      },
      {
        label: "Evidence",
        required: true,
        description: "Proof, source references, validation, or production observations behind the claim.",
      },
      {
        label: "Unknowns",
        required: true,
        description: "Open facts, risks, and assumptions that prevent false certainty.",
      },
      {
        label: "Recommendation",
        required: true,
        description: "The Council's proposed next move, framed as advice only.",
      },
      {
        label: "Required verification",
        required: true,
        description: "Checks that must pass before a Work Order can be trusted.",
      },
      {
        label: "Blocked actions",
        required: true,
        description: "Actions that remain prohibited until authority and evidence gates pass.",
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
  fields: Partial<Record<CouncilDecisionPacketField["label"], string>>,
): boolean {
  return getCouncilDecisionPacketSchema().requiredFields.every((field) => {
    const value = fields[field.label]
    return !field.required || Boolean(value?.trim())
  })
}
