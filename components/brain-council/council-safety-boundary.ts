import { getBrainCouncilDoctrine } from "@/components/brain-council/brain-council-doctrine"
import { getCouncilAdvisorySurface } from "@/components/brain-council/council-advisory-surface"
import { getCouncilDecisionPacketSchema } from "@/components/brain-council/council-decision-packet-schema"
import { getCouncilStateMachine } from "@/components/brain-council/council-state-machine"
import { getCouncilTraceEvidenceModel } from "@/components/brain-council/council-trace-evidence-link-model"

export type CouncilSafetyBoundaryCheck = {
  label: string
  passed: boolean
  description: string
}

export type CouncilSafetyBoundaryReport = {
  title: string
  checks: CouncilSafetyBoundaryCheck[]
  blockedCapabilities: string[]
  pass: boolean
}

export function getCouncilSafetyBoundaryReport(): CouncilSafetyBoundaryReport {
  const doctrine = getBrainCouncilDoctrine()
  const advisory = getCouncilAdvisorySurface()
  const decisionPacket = getCouncilDecisionPacketSchema()
  const stateMachine = getCouncilStateMachine()
  const traceModel = getCouncilTraceEvidenceModel()

  const checks: CouncilSafetyBoundaryCheck[] = [
    {
      label: "Doctrine is advisory",
      passed: doctrine.safety.advisoryOnly && !doctrine.safety.executesWork,
      description: "Doctrine describes Council law but grants no execution authority.",
    },
    {
      label: "State machine is descriptive",
      passed:
        stateMachine.safety.readOnlySchema &&
        !stateMachine.safety.executesTransitions &&
        !stateMachine.safety.startsLoops,
      description: "Council state transitions are modeled but never executed.",
    },
    {
      label: "Decision packet is review-only",
      passed:
        decisionPacket.safety.schemaOnly &&
        !decisionPacket.safety.authorizesWork &&
        !decisionPacket.safety.executesRecommendation,
      description: "Decision packets prepare review material but authorize no work.",
    },
    {
      label: "Advisory overview has no powers",
      passed:
        advisory.safety.overviewOnly &&
        !advisory.safety.createsWorkOrder &&
        !advisory.safety.activatesTools,
      description: "The overview summarizes Council posture without creating actions.",
    },
    {
      label: "Trace model does not write",
      passed:
        traceModel.safety.modelOnly &&
        !traceModel.safety.writesTraceLedger &&
        !traceModel.safety.writesProduction,
      description: "Trace links are references, not evidence or production mutations.",
    },
  ]

  return {
    title: "Council safety boundary report",
    checks,
    blockedCapabilities: [
      "runtime orchestration",
      "autonomous execution",
      "MCP activation",
      "Hermes activation",
      "worker dispatch",
      "production write",
      "authority grant",
      "access grant activation",
      "auth policy change",
    ],
    pass: checks.every((check) => check.passed),
  }
}
