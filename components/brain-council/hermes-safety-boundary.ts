import { getBrainCouncilNativeArea } from "@/components/brain-council/brain-council-native-area"
import { getHermesAuthorityStateModel } from "@/components/brain-council/hermes-authority-state-model"
import { getHermesBlockedDeniedState } from "@/components/brain-council/hermes-blocked-denied-state"
import { getHermesDoctrine } from "@/components/brain-council/hermes-doctrine"
import { getHermesWorkerDockPreview } from "@/components/brain-council/hermes-worker-dock"
import { getHermesWorkerDockReadiness } from "@/components/brain-council/hermes-worker-dock-readiness"
import { getHermesWorkerPacketSchema } from "@/components/brain-council/hermes-worker-packet-schema"

export type HermesSafetyBoundaryCheck = {
  label: string
  passed: boolean
  description: string
}

export type HermesSafetyBoundaryReport = {
  title: string
  checks: HermesSafetyBoundaryCheck[]
  requiredControls: string[]
  pass: boolean
}

export function getHermesSafetyBoundaryReport(): HermesSafetyBoundaryReport {
  const doctrine = getHermesDoctrine()
  const authority = getHermesAuthorityStateModel()
  const packet = getHermesWorkerPacketSchema()
  const readiness = getHermesWorkerDockReadiness()
  const blocked = getHermesBlockedDeniedState()
  const dock = getHermesWorkerDockPreview()
  const council = getBrainCouncilNativeArea()

  const checks: HermesSafetyBoundaryCheck[] = [
    {
      label: "Hermes remains non-executing",
      passed:
        !doctrine.safety.executesWork &&
        !dock.safety.executesCommands &&
        !packet.safety.executesPacket,
      description: "Doctrine, dock preview, and packet schema all deny execution.",
    },
    {
      label: "No dispatch affordance exists",
      passed:
        !doctrine.safety.dispatchesJobs &&
        !authority.safety.dispatchesJobs &&
        !readiness.safety.dispatchButton &&
        !blocked.safety.dispatchAffordance,
      description: "Dispatch is blocked in schema, readiness, and denied-state UX.",
    },
    {
      label: "Work Orders remain required",
      passed: doctrine.safety.workOrderRequired && packet.requiredFields.some((field) => field.label === "Work Order"),
      description: "Future worker packets must reference a governed Work Order.",
    },
    {
      label: "Authority remains required",
      passed:
        doctrine.safety.authorityRequired &&
        !authority.safety.grantsAuthority &&
        !dock.safety.grantsAuthority,
      description: "The Primary remains the authority for any future activation.",
    },
    {
      label: "Evidence remains required",
      passed:
        packet.requiredFields.some((field) => field.label === "Evidence required") &&
        readiness.cards.some((card) => card.label === "Evidence path"),
      description: "Evidence requirements are visible before trust or activation review.",
    },
    {
      label: "Brain Council remains advisory",
      passed: council.posture.advisoryOnly && !council.posture.activatesHermes,
      description: "Brain Council can review Hermes candidates but cannot activate Hermes.",
    },
  ]

  return {
    title: "Hermes safety boundary report",
    checks,
    requiredControls: [
      "Work Order",
      "Primary authority",
      "evidence required",
      "blocked actions",
      "rollback or stop condition",
      "execution not active",
    ],
    pass: checks.every((check) => check.passed),
  }
}
