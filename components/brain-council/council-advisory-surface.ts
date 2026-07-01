import { getBrainCouncilDoctrine } from "@/components/brain-council/brain-council-doctrine"
import { getBrainCouncilReasoningPacket } from "@/components/brain-council/brain-council-reasoning"
import { getCouncilDecisionPacketSchema } from "@/components/brain-council/council-decision-packet-schema"
import { getCouncilStateMachine } from "@/components/brain-council/council-state-machine"

export type CouncilAdvisorySurfaceItem = {
  label: string
  value: string
  description: string
}

export type CouncilAdvisorySurface = {
  title: string
  summary: string
  currentQuestion: string
  operatingLoop: CouncilAdvisorySurfaceItem[]
  reviewReadiness: CouncilAdvisorySurfaceItem[]
  blockedPowers: string[]
  nextSafeMove: string
  safety: {
    overviewOnly: true
    executes: false
    createsWorkOrder: false
    grantsAuthority: false
    activatesTools: false
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
      writesProduction: false,
    },
  }
}
