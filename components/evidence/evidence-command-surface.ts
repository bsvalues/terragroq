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
    executesWork: false
    deploys: false
    grantsAuthority: false
    writesProduction: false
  }
}

export function getEvidenceCommandSurface(): EvidenceCommandSurface {
  return {
    title: "Evidence",
    eyebrow: "Primary Operator Proof Layer",
    description:
      "Evidence keeps Work Orders, production checks, reviews, and safety posture tied to verifiable records. It observes and explains; it does not execute.",
    verificationFlow: [
      {
        label: "Decision",
        value: "Authority source",
        description: "The reason work was allowed, blocked, or redirected.",
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
        value: "Verification layer",
        description: "The test, build, PR, production, and safety proof for the claim.",
        href: "/audit",
      },
      {
        label: "Verified Result",
        value: "Next move ready",
        description: "A completed lane can return to Home only after evidence is inspectable.",
        href: "/",
      },
    ],
    categories: [
      {
        label: "Latest Production Verification",
        status: "Observed",
        description:
          "Health, readiness, and security-header checks belong here before any claim is treated as true.",
        href: "/runtime",
      },
      {
        label: "PR / Check / Build / Test Evidence",
        status: "Required",
        description:
          "Pull request checks, focused tests, full-suite results, and build output form the release proof chain.",
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
          "Blocked choices stay visible with the evidence required before authority can move forward.",
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
      label: "WO-SHELL-007 - Systems Status Surface",
      reason:
        "After Work Orders and Evidence, the shell should make runtime, auth, infrastructure, and deployment posture easier to inspect from one Systems area.",
    },
    safety: {
      readOnly: true,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      writesProduction: false,
    },
  }
}
