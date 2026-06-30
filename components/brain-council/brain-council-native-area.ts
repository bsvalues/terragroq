export type BrainCouncilNativeLink = {
  label: string
  href: string
  description: string
}

export type BrainCouncilNativeArea = {
  title: string
  eyebrow: string
  description: string
  posture: {
    nativeToWilliamOS: true
    advisoryOnly: true
    readOnly: true
    executes: false
    deploys: false
    grantsAuthority: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
  links: BrainCouncilNativeLink[]
  blockedActions: string[]
}

export function getBrainCouncilNativeArea(): BrainCouncilNativeArea {
  return {
    title: "Brain Council",
    eyebrow: "WilliamOS Advisory Layer",
    description:
      "Brain Council is a native WilliamOS area for reasoning, governance review, evidence synthesis, and decision preparation. It advises the Primary Operator; it does not execute work.",
    posture: {
      nativeToWilliamOS: true,
      advisoryOnly: true,
      readOnly: true,
      executes: false,
      deploys: false,
      grantsAuthority: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
    links: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description:
          "Translate recommendations into governed work before any mutation is allowed.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description:
          "Attach proof, validation, and production verification to claims before trusting them.",
      },
      {
        label: "Systems",
        href: "/runtime",
        description:
          "Check runtime, auth, deployment, and system posture before accepting operational claims.",
      },
      {
        label: "Governance",
        href: "/governance",
        description:
          "Review gates, authority locks, and boundaries that Brain Council cannot bypass.",
      },
    ],
    blockedActions: [
      "execute recommendations",
      "deploy changes",
      "grant authority",
      "activate Hermes",
      "activate MCP",
      "enable autonomy",
      "write production data",
    ],
  }
}
