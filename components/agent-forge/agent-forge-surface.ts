export type AgentForgeArea = {
  label: string
  status: "ready" | "quarantined" | "proposal-only"
  description: string
}

export type AgentForgeSurface = {
  title: string
  eyebrow: string
  description: string
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
    eyebrow: "Capability Preparation Layer",
    description:
      "Agent Forge is the WilliamOS area for preparing skill definitions, worker packets, evidence contracts, and execution proposals before any authority is requested.",
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
