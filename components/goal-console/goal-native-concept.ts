import {
  createOwnerOperationEvidencePlaceholder,
  type OwnerOperationEvidenceModel,
} from "@/lib/governance/owner-operation-evidence"

export type GoalNativeConceptCard = {
  title: string
  description: string
  posture: "read-only" | "authority-gated" | "handoff"
}

export type GoalNativeConceptSurface = {
  eyebrow: string
  title: string
  description: string
  cards: GoalNativeConceptCard[]
  boundaries: string[]
  ownerOperationEvidence: OwnerOperationEvidenceModel
  nextStep: {
    label: string
    href: string
  }
}

export function getGoalNativeConceptSurface(): GoalNativeConceptSurface {
  return {
    eyebrow: "WilliamOS Work Order Engine",
    title: "/goal defines governed intent",
    description:
      "A goal is the Primary Operator's stated outcome. WilliamOS classifies it, checks doctrine, names blocked decisions, and prepares the next governed move before any work can begin.",
    cards: [
      {
        title: "Intent layer",
        description: "Capture the desired outcome, risk, lane, and authority level before implementation starts.",
        posture: "read-only",
      },
      {
        title: "Authority checkpoint",
        description: "Expose approval gates, stop conditions, and unsafe requests before the system can prepare work.",
        posture: "authority-gated",
      },
      {
        title: "Work Order handoff",
        description: "Convert safe intent into a scoped draft with validators, evidence requirements, and blocked actions.",
        posture: "handoff",
      },
    ],
    boundaries: [
      "A goal does not execute work.",
      "A goal does not grant authority.",
      "A goal does not create background loops.",
      "A goal must hand off to a Work Order before mutation.",
    ],
    ownerOperationEvidence: createOwnerOperationEvidencePlaceholder({
      surface: "goal",
      programId: null,
      goalId: null,
      loopId: null,
      workOrderId: null,
      decisionId: null,
      action: null,
    }),
    nextStep: {
      label: "Review Work Orders",
      href: "/work-orders",
    },
  }
}
