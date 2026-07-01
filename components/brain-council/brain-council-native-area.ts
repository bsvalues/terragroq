export type BrainCouncilNativeLink = {
  label: string
  href: string
  description: string
}

export type BrainCouncilNativePosture = {
  label: string
  value: string
  description: string
}

export type BrainCouncilAdvisoryStep = {
  label: string
  description: string
}

export type BrainCouncilAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type BrainCouncilNativeArea = {
  title: string
  eyebrow: string
  description: string
  postureSummary: BrainCouncilNativePosture[]
  advisoryLoop: BrainCouncilAdvisoryStep[]
  authorityBoundaries: BrainCouncilAuthorityBoundary[]
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
      "Brain Council is the native WilliamOS advisory area for reasoning, governance review, evidence synthesis, and decision preparation. It prepares decisions for the Primary Operator; it does not execute work.",
    postureSummary: [
      {
        label: "Native",
        value: "WilliamOS area",
        description:
          "Brain Council belongs inside the Command Center as an advisory room, not a separate application.",
      },
      {
        label: "Evidence-bound",
        value: "claims need proof",
        description:
          "Recommendations stay attached to evidence, validation, and production verification before trust.",
      },
      {
        label: "Authority-gated",
        value: "Primary decides",
        description:
          "Decisions can move toward Work Orders only after explicit owner authority and boundaries are clear.",
      },
    ],
    advisoryLoop: [
      {
        label: "Question",
        description: "Frame what the Primary Operator needs to understand before action.",
      },
      {
        label: "Evidence",
        description: "Collect proof, unknowns, and constraints from WilliamOS surfaces.",
      },
      {
        label: "Recommendation",
        description: "Rank hypotheses and prepare a decision packet without executing it.",
      },
      {
        label: "Work Order",
        description: "Convert approved direction into governed scope, validation, and evidence.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Execution",
        state: "Blocked",
        description: "Brain Council cannot run agents, workers, schedulers, or loops.",
      },
      {
        label: "Production",
        state: "Observed only",
        description: "Production facts may be referenced as evidence; no deploy or write occurs here.",
      },
      {
        label: "Authority",
        state: "Owner-gated",
        description: "Approval, access grants, and policy changes remain outside Brain Council authority.",
      },
    ],
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
