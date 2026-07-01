export type HermesWorkerDockLink = {
  label: string
  href: string
  description: string
}

export type HermesWorkerDockPosture = {
  label: string
  value: string
  description: string
}

export type HermesWorkPacketState = {
  label: string
  state: string
  description: string
}

export type HermesWorkerDockBoundary = {
  label: string
  state: string
  description: string
}

export type HermesWorkerDockPreview = {
  title: string
  eyebrow: string
  posture: "PREVIEW_ONLY"
  description: string
  postureSummary: HermesWorkerDockPosture[]
  workPacketStates: HermesWorkPacketState[]
  authorityBoundaries: HermesWorkerDockBoundary[]
  capabilities: string[]
  links: HermesWorkerDockLink[]
  safety: {
    readOnly: true
    executesCommands: false
    startsWorkers: false
    dispatchesJobs: false
    deploys: false
    grantsAuthority: false
    activatesMcp: false
    enablesAutonomy: false
    writesProduction: false
  }
}

export function getHermesWorkerDockPreview(): HermesWorkerDockPreview {
  return {
    title: "Hermes Worker Dock",
    eyebrow: "WilliamOS Worker Dock",
    posture: "PREVIEW_ONLY",
    description:
      "Hermes is represented in WilliamOS as the Worker Dock: a governed surface for prepared work packets, evidence requirements, and activation review. It is available for inspection, not active for execution.",
    postureSummary: [
      {
        label: "Prepared",
        value: "not active",
        description:
          "Hermes can be framed, inspected, and reviewed, but no worker runtime is running.",
      },
      {
        label: "Authority",
        value: "Primary required",
        description:
          "Work packets cannot move beyond preview until the Primary grants explicit authority.",
      },
      {
        label: "Evidence",
        value: "required",
        description:
          "Every future Hermes output must return validation, trace, and proof before trust.",
      },
    ],
    workPacketStates: [
      {
        label: "Candidate",
        state: "Inspectable",
        description: "A possible worker packet can be reviewed without dispatch.",
      },
      {
        label: "Scoped",
        state: "Work Order required",
        description: "Any action request must become a governed Work Order first.",
      },
      {
        label: "Held",
        state: "Awaiting Primary authority",
        description: "Execution stays blocked until authority, evidence, and safety gates pass.",
      },
    ],
    authorityBoundaries: [
      {
        label: "Runtime",
        state: "Disabled",
        description: "No Hermes runner, scheduler, background worker, or dispatch path exists here.",
      },
      {
        label: "MCP",
        state: "Disabled",
        description: "No MCP activation or external tool authority is granted from the Worker Dock.",
      },
      {
        label: "Production",
        state: "No write",
        description: "The Worker Dock can describe required evidence; it cannot deploy or mutate production.",
      },
    ],
    capabilities: [
      "Inspect candidate procedures",
      "Draft worker packets for future review",
      "Return evidence requirements",
      "Expose missing authority gates",
      "Stay inactive until a separate runtime Work Order exists",
    ],
    links: [
      {
        label: "Work Orders",
        href: "/work-orders",
        description:
          "Every Hermes proposal must become a governed Work Order before it can request action.",
      },
      {
        label: "Evidence",
        href: "/audit",
        description:
          "Hermes output must return proof, validation, and traceable evidence before trust.",
      },
      {
        label: "Systems",
        href: "/runtime",
        description:
          "Runtime, deployment, auth, and infrastructure posture remain visible before any execution path is considered.",
      },
      {
        label: "Brain Council",
        href: "/brain-council",
        description:
          "Brain Council reviews Hermes candidates and risks; it does not activate the worker dock.",
      },
    ],
    safety: {
      readOnly: true,
      executesCommands: false,
      startsWorkers: false,
      dispatchesJobs: false,
      deploys: false,
      grantsAuthority: false,
      activatesMcp: false,
      enablesAutonomy: false,
      writesProduction: false,
    },
  }
}
