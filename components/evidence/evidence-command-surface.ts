import type { VerificationFlowStep } from "@/components/shell/verification-flow-grid"

export type EvidenceCategory = {
  label: string
  status: string
  description: string
  href: string
}

export type EvidenceCommandSurface = {
  title: string
  eyebrow: string
  description: string
  verificationFlow: VerificationFlowStep[]
  categories: EvidenceCategory[]
  nextRecommendedWo: {
    label: string
    reason: string
  }
  safety: {
    readOnly: true
    mutatesEvidence: false
    autoIngests: false
    activatesExternalConnectors: false
    executesWork: false
    deploys: false
    grantsAuthority: false
    changesSchema: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getEvidenceCommandSurface(): EvidenceCommandSurface {
  return {
    title: "Evidence",
    eyebrow: "WilliamOS Record of Reality",
    description:
      "Evidence is the native WilliamOS proof layer and record of reality: validation, PR outcomes, production verification, safety posture, timestamps, sources, blockers, and confirmed reality. It records what is known; it does not execute.",
    verificationFlow: [
      {
        label: "Decision",
        value: "Authority source",
        description: "The reason work was allowed, blocked, redirected, or held for review.",
        href: "/decisions",
      },
      {
        label: "Work Order",
        value: "Scope record",
        description: "The bounded contract that defines what changed and what stayed blocked.",
        href: "/work-orders",
      },
      {
        label: "Evidence",
        value: "Proof layer",
        description: "The test, build, PR, production, source, timestamp, and safety proof for the claim.",
        href: "/audit",
      },
      {
        label: "Verified Result",
        value: "Reality confirmed",
        description: "A completed lane can return to Home only after proof is inspectable.",
        href: "/",
      },
    ],
    categories: [
      {
        label: "Latest Production Verification",
        status: "Confirmed",
        description:
          "Health, readiness, deployment, and security-header checks belong here before production claims are treated as true.",
        href: "/runtime",
      },
      {
        label: "PR / Check / Build / Test Evidence",
        status: "Required",
        description:
          "Pull request checks, focused tests, full-suite results, and build output form the validation proof chain.",
        href: "/audit",
      },
      {
        label: "Work Order Completion Evidence",
        status: "Linked",
        description:
          "Completed work should point back to validation, merged PRs, production verification, and safety posture.",
        href: "/work-orders",
      },
      {
        label: "Blocked Decision Evidence",
        status: "Gated",
        description:
          "Blocked choices stay visible with the failed check, blocker, or missing proof required before authority can move forward.",
        href: "/governance",
      },
      {
        label: "Safety Posture Evidence",
        status: "Read-only",
        description:
          "Brain Council and Hermes surfaces remain visible as governed context, not execution authority.",
        href: "/brain-council",
      },
    ],
    nextRecommendedWo: {
      label: "WO-SHELL-018 - Systems Native Area Reframe",
      reason:
        "After Evidence is framed as the proof layer, Systems should present runtime, auth, infrastructure, deployment, and readiness posture as one native WilliamOS area.",
    },
    safety: {
      readOnly: true,
      mutatesEvidence: false,
      autoIngests: false,
      activatesExternalConnectors: false,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      changesSchema: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
