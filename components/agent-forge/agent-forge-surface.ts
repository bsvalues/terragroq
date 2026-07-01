export type AgentForgeArea = {
  label: string
  status: "ready" | "quarantined" | "proposal-only"
  description: string
}

export type AgentForgePosture = {
  label: string
  value: string
  description: string
}

export type AgentForgeCapabilityState = {
  label: string
  state: string
  description: string
}

export type AgentForgeAuthorityBoundary = {
  label: string
  state: string
  description: string
}

export type AgentForgeSurface = {
  title: string
  eyebrow: string
  description: string
  postureSummary: AgentForgePosture[]
  capabilityStates: AgentForgeCapabilityState[]
  authorityBoundaries: AgentForgeAuthorityBoundary[]
  areas: AgentForgeArea[]
  links: {
    label: string
    href: string
    description: string
  }[]
  safety: {
    readOnly: true
    executesSkills: false
    grantsAuthority: false
    selfActivates: false
    writesProduction: false
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
  }
}

export function getAgentForgeSurface(): AgentForgeSurface {
  return {
    title: "Agent Forge",
    eyebrow: "WilliamOS Capability Forge",
    description:
      "Agent Forge is the native WilliamOS area for preparing, reviewing, and quarantining proposed capabilities before they can ever become authorized worker skills.",
    postureSummary: [
      {
        label: "Prepared",
        value: "not active",
        description:
          "Capabilities can be shaped into proposals, but no skill runtime is present or invoked.",
      },
      {
        label: "Quarantined",
        value: "review required",
        description:
          "Skill-like outputs remain held until evidence, scope, and authority boundaries are proven.",
      },
      {
        label: "Authority",
        value: "Primary required",
        description:
          "Promotion from proposal to worker skill requires explicit owner approval and a Work Order.",
      },
    ],
    capabilityStates: [
      {
        label: "Proposal",
        state: "Draftable",
        description: "A capability can be described as scope, risk, and expected evidence.",
      },
      {
        label: "Quarantine",
        state: "Held",
        description: "Skill definitions remain provenance-only until review and ratification.",
      },
      {
        label: "Activation review",
        state: "Blocked",
        description: "No capability can run until authority, evidence, and runtime gates pass.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Skill execution",
        state: "Disabled",
        description: "Agent Forge cannot invoke skills, add tools, or start worker behavior.",
      },
      {
        label: "Hermes",
        state: "Not activated",
        description: "Prepared capabilities do not activate Hermes or dispatch Worker Dock packets.",
      },
      {
        label: "Production",
        state: "No write",
        description: "Capability review cannot mutate data, deploy, or change production posture.",
      },
    ],
    areas: [
      {
        label: "Skill Registry",
        status: "quarantined",
        description:
          "Skills remain definitions and provenance records until a separate Work Order ratifies them.",
      },
      {
        label: "Work Order Packet Builder",
        status: "proposal-only",
        description:
          "Packets may describe scope, validators, evidence, and denied actions; they do not dispatch workers.",
      },
      {
        label: "Evidence Contract Surface",
        status: "ready",
        description:
          "Every proposed capability must state how success, safety, and production posture will be proven.",
      },
      {
        label: "Execution Proposal Area",
        status: "proposal-only",
        description:
          "Execution can be proposed for future review, but Agent Forge cannot perform it or grant itself authority.",
      },
    ],
    links: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description: "Convert proposed capability work into scoped governance.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description: "Attach validation and proof requirements to capability proposals.",
      },
      {
        label: "Brain Council",
        href: "/brain-council",
        description: "Review capability fit, risks, and reasoning before promotion.",
      },
      {
        label: "Hermes Worker Dock",
        href: "/brain-council",
        description: "Keep runtime candidate work preview-only until authority exists.",
      },
    ],
    safety: {
      readOnly: true,
      executesSkills: false,
      grantsAuthority: false,
      selfActivates: false,
      writesProduction: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    },
  }
}
