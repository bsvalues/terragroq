export type SystemStatusTone = "ready" | "read-only" | "preview-only" | "needs-authority"

export type SystemStatusCategory = {
  label: string
  status: string
  tone: SystemStatusTone
  description: string
  href: string
}

export type SystemsStatusSurface = {
  title: string
  eyebrow: string
  description: string
  categories: SystemStatusCategory[]
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
    activatesHermes: false
    activatesMcp: false
    enablesAutonomy: false
  }
}

export function getSystemsStatusSurface(): SystemsStatusSurface {
  return {
    title: "Systems Status",
    eyebrow: "WilliamOS Operational Posture",
    description:
      "A read-only view of the unified WilliamOS control plane: shell, auth, Work Orders, Evidence, Brain Council, Hermes preview, Agent Forge, deployment, and project systems.",
    categories: [
      {
        label: "WilliamOS Shell",
        status: "Ready",
        tone: "ready",
        description:
          "Home, navigation, Work Orders, Evidence, and Systems are presented as one Primary Operator environment.",
        href: "/",
      },
      {
        label: "Auth / Readiness",
        status: "Ready",
        tone: "ready",
        description:
          "Operator access is checked through readiness diagnostics; signup remains governed by existing policy.",
        href: "/operator",
      },
      {
        label: "Work Orders",
        status: "Read-only",
        tone: "read-only",
        description:
          "Governed work is visible, but this surface does not start loops, execute work, or grant authority.",
        href: "/work-orders",
      },
      {
        label: "Evidence",
        status: "Read-only",
        tone: "read-only",
        description:
          "Validation, production checks, and safety posture are inspectable as proof, not as execution controls.",
        href: "/audit",
      },
      {
        label: "Brain Council",
        status: "Read-only",
        tone: "read-only",
        description:
          "Brain Council remains an advisory reasoning layer. It is visible without autonomous authority.",
        href: "/brain-council",
      },
      {
        label: "Hermes Preview / Worker Dock",
        status: "Preview-only",
        tone: "preview-only",
        description:
          "Hermes concepts may be reviewed, but no runtime, scheduler, worker dispatch, or MCP activation is enabled.",
        href: "/brain-council",
      },
      {
        label: "Agent Forge / Skills",
        status: "Needs authority",
        tone: "needs-authority",
        description:
          "Agent and skill posture remains governed. Capabilities require explicit Work Orders and authority gates.",
        href: "/governance",
      },
      {
        label: "Deployment / Production Health",
        status: "Ready",
        tone: "ready",
        description:
          "Runtime health, model provenance, and verification evidence remain inspectable from this Systems area.",
        href: "/runtime",
      },
      {
        label: "TerraFusion OS Project",
        status: "Governed project",
        tone: "needs-authority",
        description:
          "TerraFusion OS is treated as a project system under WilliamOS, not as a separate command environment.",
        href: "/work-orders",
      },
    ],
    nextRecommendedWo: {
      label: "WO-SHELL-008 - Brain Council Native Area Reframe",
      reason:
        "With Work Orders, Evidence, and Systems visible, the next shell slice should make Brain Council feel native to WilliamOS while preserving advisory-only boundaries.",
    },
    safety: {
      readOnly: true,
      executesWork: false,
      deploys: false,
      grantsAuthority: false,
      writesProduction: false,
      activatesHermes: false,
      activatesMcp: false,
      enablesAutonomy: false,
    },
  }
}
