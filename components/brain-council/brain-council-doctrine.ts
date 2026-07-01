export type BrainCouncilDoctrinePrinciple = {
  label: string
  description: string
}

export type BrainCouncilDoctrineBoundary = {
  label: string
  state: "blocked" | "owner-gated" | "read-only"
  description: string
}

export type BrainCouncilDoctrine = {
  title: string
  eyebrow: string
  summary: string
  principles: BrainCouncilDoctrinePrinciple[]
  boundaries: BrainCouncilDoctrineBoundary[]
  operatingRule: string
  safety: {
    advisoryOnly: true
    evidenceRequired: true
    confidenceAware: true
    executesWork: false
    activatesHermes: false
    activatesMcp: false
    writesProduction: false
    grantsAuthority: false
  }
}

export function getBrainCouncilDoctrine(): BrainCouncilDoctrine {
  return {
    title: "Brain Council doctrine",
    eyebrow: "Advisory operating law",
    summary:
      "Brain Council exists to help the Primary Operator reason. It can frame questions, compare evidence, expose unknowns, rank hypotheses, and prepare decision packets. It cannot execute, grant authority, or bypass Work Orders.",
    principles: [
      {
        label: "Question first",
        description:
          "Every Council review starts with the decision or uncertainty the Primary Operator needs resolved.",
      },
      {
        label: "Evidence before confidence",
        description:
          "Claims stay provisional until they are tied to evidence, verification, and known limits.",
      },
      {
        label: "Recommendations are not authority",
        description:
          "Council output may become a Work Order only after the Primary accepts the boundary and intent.",
      },
      {
        label: "Unknowns stay visible",
        description:
          "The Council must preserve uncertainty instead of converting weak evidence into false certainty.",
      },
    ],
    boundaries: [
      {
        label: "Runtime orchestration",
        state: "blocked",
        description: "The Council does not launch agents, workers, schedulers, MCP tools, or loops.",
      },
      {
        label: "Production mutation",
        state: "blocked",
        description: "The Council may cite production evidence but cannot deploy or write production data.",
      },
      {
        label: "Authority transfer",
        state: "owner-gated",
        description: "The Primary remains the authority for access, activation, policy, and execution.",
      },
      {
        label: "Decision packet",
        state: "read-only",
        description: "Decision packets are prepared for review; they do not trigger action by themselves.",
      },
    ],
    operatingRule:
      "Brain Council advises. Work Orders govern action. Evidence proves reality. Hermes works only when authorized. The Primary remains the authority.",
    safety: {
      advisoryOnly: true,
      evidenceRequired: true,
      confidenceAware: true,
      executesWork: false,
      activatesHermes: false,
      activatesMcp: false,
      writesProduction: false,
      grantsAuthority: false,
    },
  }
}
