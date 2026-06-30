export type HermesWorkerDockLink = {
  label: string
  href: string
  description: string
}

export type HermesWorkerDockPreview = {
  title: string
  eyebrow: string
  posture: "PREVIEW_ONLY"
  description: string
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
    eyebrow: "Governed Worker Preview",
    posture: "PREVIEW_ONLY",
    description:
      "Hermes is represented in WilliamOS as a governed worker dock preview: a place to inspect candidate work, evidence expectations, and activation boundaries before any worker can exist.",
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
