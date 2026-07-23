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
  operatorPosture: string
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
  statusSequence: {
    label: string
    value: string
    description: string
  }[]
  blockedExpansion: {
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
    eyebrow: "Primary Systems Status",
    description:
      "Systems is the Primary Operator's native status view for WilliamOS systems under command: readiness, stable areas, disabled-by-design capabilities, blocked states, advisory layers, local runtime posture, verified production health, and safe-state boundaries.",
    operatorPosture:
      "This production web page reads persisted status and explains boundaries. It does not host the resident Hermes worker, poll in the background, start repairs, change endpoints, deploy, grant authority, or activate runtime workers.",
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
        label: "Bounded worker",
        value: "1 proven",
        description:
          "The native non-elevated Windows Hermes supervisor has retained end-to-end proof with Codex App Server transport; current host state is verified separately.",
        tone: "ready",
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
        state: "Runtime-proven",
        description:
          "Hermes has proven one fenced WilliamOS-native R0/R1 delivery at a time with persisted execution projection; current host liveness is not inferred here.",
      },
      {
        label: "Production",
        state: "Observed only",
        description: "Systems can show production health and headers, but cannot deploy from this view.",
      },
    ],
    statusSequence: [
      {
        label: "1. Readiness",
        value: "Pre-action",
        description: "Health, auth readiness, and disabled-by-design states are checked before claims move forward.",
      },
      {
        label: "2. Resident worker",
        value: "Proven / liveness separate",
        description:
          "A native non-elevated Windows supervisor has delegated bounded file work through Codex App Server. The localhost host-live probe reports whether it is currently enabled and healthy.",
      },
      {
        label: "3. Local status",
        value: "Read-only",
        description: "Local OMEN status remains localhost-only and separated from Hermes runtime control.",
      },
      {
        label: "4. Production health",
        value: "Observed",
        description: "Production health and readiness are verification evidence, not deploy authority.",
      },
      {
        label: "5. Authority boundary",
        value: "Owner-gated",
        description: "Higher-risk actions stay blocked until a specific owner-authorized Work Order opens them.",
      },
    ],
    blockedExpansion: [
      {
        label: "No background polling",
        state: "Blocked",
        description: "Systems does not add timers, workers, sockets, webhooks, or monitoring integrations.",
      },
      {
        label: "No repair controls",
        state: "Blocked",
        description: "No start, stop, restart, repair, command runner, or remediation button is added.",
      },
      {
        label: "No metadata expansion",
        state: "Blocked",
        description: "Docker metadata, backup metadata, port checks, and LAN exposure remain closed gates.",
      },
      {
        label: "No unrestricted runtime",
        state: "Blocked",
        description:
          "Only the fenced resident Hermes bridge is live. MCP, arbitrary workers, autonomous loops, and issue #357 remain inactive and terminally excluded.",
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
        label: "Hermes Resident Worker",
        status: "Runtime-proven",
        tone: "ready",
        description:
          "The native Windows supervisor has retained Codex App Server and durable lease/checkpoint proof. The production web app reads persisted execution state but does not claim current host liveness or host the worker.",
        href: "/runtime",
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
        status: "Excluded from worker",
        tone: "disabled",
        description:
          "Hermes cannot select or execute TerraFusion, TerraPilot, Property Workbench, county, PACS, or protected-data work.",
        href: "/work-orders",
      },
    ],
    nextRecommendedWo: {
      label: "WO-SHELL-008 - Authority / Governance Surface",
      reason:
        "After Systems status is centered in the Primary shell, the next safe lane is Authority / Governance so status boundaries map to owner gates.",
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
