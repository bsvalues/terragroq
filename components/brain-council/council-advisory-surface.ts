import { getBrainCouncilDoctrine } from "@/components/brain-council/brain-council-doctrine"
import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"
import { getCouncilDecisionPacketSchema } from "@/components/brain-council/council-decision-packet-schema"
import { getCouncilStateMachine } from "@/components/brain-council/council-state-machine"

export type CouncilAdvisorySurfaceItem = {
  label: string
  value: string
  description: string
}

export type CouncilEvidenceRequirement = {
  type: string
  requiredFor: "low confidence" | "medium confidence" | "high confidence" | "blocker"
  missingBehavior: string
}

export type CouncilConfidenceRiskRule = {
  label: string
  level: "low" | "medium" | "high" | "blocked" | "denied"
  description: string
}

export type CouncilWoeRecommendationModel = {
  label: string
  requiredFields: string[]
  rule: string
  blockedActions: string[]
}

export type CouncilAdvisorySurface = {
  title: string
  summary: string
  currentQuestion: string
  operatingLoop: CouncilAdvisorySurfaceItem[]
  reviewReadiness: CouncilAdvisorySurfaceItem[]
  evidenceRequirements: CouncilEvidenceRequirement[]
  confidenceRiskModel: CouncilConfidenceRiskRule[]
  recommendationModel: CouncilWoeRecommendationModel
  blockedDeniedDoctrine: CouncilConfidenceRiskRule[]
  registryCoverage: CouncilAdvisorySurfaceItem[]
  blockedPowers: string[]
  nextSafeMove: string
  safety: {
    overviewOnly: true
    executes: false
    createsWorkOrder: false
    grantsAuthority: false
    activatesTools: false
    activatesHermes: false
    activatesMcp: false
    writesMemory: false
    dynamicIngestion: false
    writesProduction: false
  }
}

export function getCouncilAdvisorySurface(): CouncilAdvisorySurface {
  const doctrine = getBrainCouncilDoctrine()
  const stateMachine = getCouncilStateMachine()
  const packetSchema = getCouncilDecisionPacketSchema()
  const reasoning = getBrainCouncilReasoningPacket()

  return {
    title: "Council advisory surface",
    summary:
      "A consolidated view of how Brain Council frames questions, gathers evidence, ranks hypotheses, and prepares decision packets for Primary review.",
    currentQuestion: reasoning.question,
    operatingLoop: [
      {
        label: "Doctrine",
        value: doctrine.eyebrow,
        description: "Defines the advisory law and authority boundaries for Council reasoning.",
      },
      {
        label: "State",
        value: stateMachine.initialState,
        description: "Starts with a framed question and stops at the authority boundary.",
      },
      {
        label: "Packet",
        value: packetSchema.statusFlow.join(" -> "),
        description: "Packages evidence and recommendation for review without approving action.",
      },
    ],
    reviewReadiness: [
      {
        label: "Evidence records",
        value: String(reasoning.evidence.length),
        description: "Evidence items attached to the current reasoning packet.",
      },
      {
        label: "Unknowns",
        value: String(reasoning.unknowns.length),
        description: "Known gaps that must remain visible before action.",
      },
      {
        label: "Hypotheses",
        value: String(reasoning.hypotheses.length),
        description: "Candidate explanations ranked by confidence and verification needs.",
      },
      {
        label: "Confidence",
        value: `${Math.round(reasoning.confidence * 100)}%`,
        description: "Advisory confidence, not authority to execute.",
      },
    ],
    evidenceRequirements: [
      {
        type: "current origin/main",
        requiredFor: "low confidence",
        missingBehavior: "mark base stale and request current repo evidence",
      },
      {
        type: "GOAL/WO reports",
        requiredFor: "medium confidence",
        missingBehavior: "lower confidence and list missing reports",
      },
      {
        type: "PR/check status",
        requiredFor: "medium confidence",
        missingBehavior: "block completion recommendation until checks are known",
      },
      {
        type: "production verification",
        requiredFor: "high confidence",
        missingBehavior: "require route proof before production claims",
      },
      {
        type: "safety posture",
        requiredFor: "blocker",
        missingBehavior: "block if runtime, execution, auth, DB, memory, or secret flags are unclear",
      },
      {
        type: "Academy/Wiki, Hermes, WOE, and Trace/Eval doctrine",
        requiredFor: "medium confidence",
        missingBehavior: "treat recommendation as doctrine-incomplete",
      },
    ],
    confidenceRiskModel: [
      {
        label: "Low confidence",
        level: "low",
        description: "Enough context to ask for evidence, not enough to recommend action.",
      },
      {
        label: "Medium confidence",
        level: "medium",
        description: "Relevant reports and safety posture exist; production or review proof may still be pending.",
      },
      {
        label: "High confidence",
        level: "high",
        description: "Current base, reports, checks, production verification, and safety flags are all cited.",
      },
      {
        label: "Risk escalated",
        level: "blocked",
        description:
          "Auth, DB/schema, env/package/Vercel, production-write, autonomy, Hermes/MCP/worker, memory write, TerraFusion/PACS, or secret risk blocks the recommendation.",
      },
    ],
    recommendationModel: {
      label: "Council-to-WOE recommendation",
      requiredFields: [
        "goal",
        "scope",
        "authority required",
        "stop conditions",
        "evidence required",
        "validators",
        "blocked actions",
        "next safe gate",
      ],
      rule:
        "Council may recommend a Work Order packet. Codex may operate only when the Owner provides an authorized packet. Council does not execute Codex.",
      blockedActions: ["auto-WO creation", "Codex invocation", "background dispatch", "command runner", "queue worker"],
    },
    blockedDeniedDoctrine: [
      {
        label: "Evidence missing",
        level: "blocked",
        description: "Block when proof is absent, stale, or contradicted.",
      },
      {
        label: "Owner authority required",
        level: "blocked",
        description: "Block when the recommendation needs Primary authority before action.",
      },
      {
        label: "Execution implied",
        level: "blocked",
        description: "Block when advice implies commands, tools, workers, schedulers, Hermes, MCP, or autonomy.",
      },
      {
        label: "Policy boundary crossed",
        level: "denied",
        description: "Deny when secrets, production writes, auth/DB changes, or TerraFusion/PACS touch are implied without authority.",
      },
    ],
    registryCoverage: [
      { label: "Council doctrine", value: "/brain-council", description: "Advisory identity and boundaries." },
      { label: "Work Orders", value: "/work-orders", description: "Recommendations become WOE packets, not direct actions." },
      { label: "Evidence", value: "/audit", description: "Proof drives confidence and blocks weak advice." },
      { label: "Academy/Wiki", value: "/academy", description: "Static lessons and glossary cross-links." },
      { label: "Trace/Eval", value: "/trace", description: "Static proof history, evidence gaps, and eval candidates." },
      { label: "Hermes", value: "/hermes", description: "Council cannot activate Hermes or MCP." },
      { label: "Authority", value: "/governance", description: "Owner gates remain outside Council control." },
    ],
    blockedPowers: [
      ...new Set([
        ...doctrine.boundaries.flatMap((boundary) =>
          boundary.state === "blocked" ? [boundary.label] : [],
        ),
        ...packetSchema.blockedUntilApproved,
      ]),
    ],
    nextSafeMove:
      "Prepare or refine a Work Order only after evidence, blocked actions, and Primary authority are explicit.",
    safety: {
      overviewOnly: true,
      executes: false,
      createsWorkOrder: false,
      grantsAuthority: false,
      activatesTools: false,
      activatesHermes: false,
      activatesMcp: false,
      writesMemory: false,
      dynamicIngestion: false,
      writesProduction: false,
    },
  }
}
