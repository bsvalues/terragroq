export type SystemStatusTone =
  | "ready"
  | "read-only"
  | "preview-only"
  | "disabled"
  | "needs-authority"

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
  postureSummary: {
    label: string
    value: string
    description: string
    tone: SystemStatusTone
  }[]
  boundaryRail: {
    label: string
    state: string
    description: string
  }[]
  categories: SystemStatusCategory[]
  nextRecommendedWo: {
    label: string
    reason: string
  }
  safety: {
    readOnly: true
    changesHealthEndpoints: false
    startsBackgroundPolling: false
    activatesExternalMonitoring: false
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
    eyebrow: "WilliamOS Systems Under Command",
    description:
      "Systems is the Primary's native view of WilliamOS systems under command: readiness, stable areas, disabled-by-design capabilities, blocked states, advisory layers, verified production health, and safe-state boundaries.",
    postureSummary: [
      {
        label: "Ready",
        value: "3 systems",
        description: "Shell, auth/readiness, and production health are stable and verified.",
        tone: "ready",
      },
      {
        label: "Read-only",
        value: "4 surfaces",
        description:
          "Work Orders, Evidence, Brain Council, and Memory are visible without execution.",
        tone: "read-only",
      },
      {
        label: "Preview-only",
        value: "1 dock",
        description: "Hermes can be reviewed, but no worker runtime or automation is active.",
        tone: "preview-only",
      },
      {
        label: "Disabled",
        value: "access grants",
        description: "Issue and accept routes exist but remain fail-closed.",
        tone: "disabled",
      },
    ],
    boundaryRail: [
      {
        label: "Authority",
        state: "Owner-gated",
        description: "Approvals, access grants, and production authority stay explicit and blocked until granted.",
      },
      {
        label: "Execution",
        state: "Not active",
        description: "No Hermes, MCP, scheduler, worker dispatch, or loop execution is enabled.",
      },
      {
        label: "Production",
        state: "Observed only",
        description: "Systems can show production health and headers, but cannot deploy from this view.",
      },
    ],
    categories: [
      {
        label: "WilliamOS Shell",
        status: "Ready",
        tone: "ready",
        description:
          "Home, navigation, Work Orders, Evidence, and Systems are presented as one Primary environment under command.",
        href: "/",
      },
      {
        label: "Auth / Readiness",
        status: "Ready",
        tone: "ready",
        description:
          "Operator access is checked through readiness diagnostics; owner provisioning remains governed by existing policy and safe state.",
        href: "/operator",
      },
      {
        label: "Work Orders",
        status: "Read-only",
        tone: "read-only",
        description:
          "Governed work is visible, but Systems does not start loops, execute work, or grant authority.",
        href: "/work-orders",
      },
      {
        label: "Evidence",
        status: "Read-only",
        tone: "read-only",
        description:
          "Validation, production verification, and safety posture are inspectable as proof, not as execution controls.",
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
        status: "Proposal-only",
        tone: "needs-authority",
        description:
          "Agent and skill posture remains governed. Capability activation requires explicit Work Orders and authority gates.",
        href: "/governance",
      },
      {
        label: "Access Grants",
        status: "Disabled",
        tone: "disabled",
        description:
          "Issue and accept routes fail closed until owner approval enables live access behavior.",
        href: "/operator",
      },
      {
        label: "Memory / Knowledge",
        status: "Read-only",
        tone: "read-only",
        description:
          "Durable knowledge remains inspectable as context; this Systems surface does not write memory.",
        href: "/memory",
      },
      {
        label: "Governance / Authority",
        status: "Needs authority",
        tone: "needs-authority",
        description:
          "Doctrine, decisions, and gates define the rules before any higher-risk action proceeds.",
        href: "/governance",
      },
      {
        label: "Deployment / Production Health",
        status: "Ready",
        tone: "ready",
        description:
          "Runtime health, model provenance, security headers, and verification evidence remain inspectable from Systems.",
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
      label: "WO-SHELL-019 - Access Grants Native Area Reframe",
      reason:
        "After Systems shows disabled-by-design capabilities, Access Grants should be reframed so the disabled authority gate is unmistakable.",
    },
    safety: {
      readOnly: true,
      changesHealthEndpoints: false,
      startsBackgroundPolling: false,
      activatesExternalMonitoring: false,
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
