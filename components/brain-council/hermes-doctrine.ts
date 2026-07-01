export type HermesDoctrinePrinciple = {
  label: string
  description: string
}

export type HermesDoctrineBoundary = {
  label: string
  state: "blocked" | "owner-gated" | "review-only"
  description: string
}

export type HermesDoctrine = {
  title: string
  eyebrow: string
  summary: string
  principles: HermesDoctrinePrinciple[]
  boundaries: HermesDoctrineBoundary[]
  operatingRule: string
  safety: {
    sidecarOnly: true
    workOrderRequired: true
    authorityRequired: true
    executesWork: false
    dispatchesJobs: false
    activatesMcp: false
    runsScheduler: false
    writesProduction: false
  }
}

export function getHermesDoctrine(): HermesDoctrine {
  return {
    title: "Hermes doctrine",
    eyebrow: "Worker sidecar boundary",
    summary:
      "Hermes is the governed Worker Dock sidecar for future authorized work packets. It can show readiness, missing authority, and evidence requirements. It cannot act unless a Work Order, authority gate, and activation review explicitly allow it.",
    principles: [
      {
        label: "Prepared, not active",
        description: "Hermes may display candidate work and readiness state, but no worker runtime is active.",
      },
      {
        label: "Work Orders govern work",
        description: "Every future Hermes action must begin as a bounded Work Order with validation and stop conditions.",
      },
      {
        label: "Primary authority gates execution",
        description: "The Primary must approve activation scope before any worker can receive authority.",
      },
      {
        label: "Evidence returns with work",
        description: "Any future execution model must return proof, validation, trace, and rollback evidence.",
      },
    ],
    boundaries: [
      {
        label: "Worker runtime",
        state: "blocked",
        description: "No runner, scheduler, queue processor, or dispatch path is enabled.",
      },
      {
        label: "Tool authority",
        state: "blocked",
        description: "No MCP, external tool, deployment, or production-write authority is granted.",
      },
      {
        label: "Activation",
        state: "owner-gated",
        description: "Activation requires a separate owner-approved Work Order and readiness review.",
      },
      {
        label: "Worker packet",
        state: "review-only",
        description: "Packets can be previewed as requirements; they cannot execute from the dock.",
      },
    ],
    operatingRule:
      "Hermes can prepare for authorized work. Hermes cannot perform work until Work Orders, evidence, and Primary authority explicitly permit it.",
    safety: {
      sidecarOnly: true,
      workOrderRequired: true,
      authorityRequired: true,
      executesWork: false,
      dispatchesJobs: false,
      activatesMcp: false,
      runsScheduler: false,
      writesProduction: false,
    },
  }
}
