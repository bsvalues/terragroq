export type DashboardStats = {
  memory: number
  decisions: number
  openDecisions: number
  doctrines: number
  work: number
  openWork: number
  docs: number
}

export type OperatorStartStep = {
  title: string
  description: string
  href: string
  action: string
  signal: string
}

export function getOperatorStartSteps(stats: DashboardStats): OperatorStartStep[] {
  const steps: OperatorStartStep[] = []

  if (stats.doctrines === 0) {
    steps.push({
      title: "Define operating doctrine",
      description: "Ratify the rules the system should enforce before serious work starts.",
      href: "/doctrine",
      action: "Ratify doctrine",
      signal: "Doctrine register is empty.",
    })
  }

  if (stats.decisions === 0) {
    steps.push({
      title: "Record the first decision",
      description: "Capture the current operating posture so future work has provenance.",
      href: "/decisions",
      action: "Log decision",
      signal: "Decision register is empty.",
    })
  }

  if (stats.work === 0) {
    steps.push({
      title: "Draft a governed work order",
      description: "Convert the next objective into scoped work with validators and gates.",
      href: "/work-orders",
      action: "Draft work order",
      signal: "No work orders exist yet.",
    })
  } else if (stats.openWork > 0) {
    steps.push({
      title: "Review active work",
      description: "Inspect open work orders before drafting another lane.",
      href: "/work-orders",
      action: "Review work orders",
      signal: `${stats.openWork} work order${stats.openWork === 1 ? "" : "s"} still open.`,
    })
  }

  if (stats.docs === 0) {
    steps.push({
      title: "Ingest reference material",
      description: "Add source documents so answers can cite real project context.",
      href: "/corpus",
      action: "Ingest document",
      signal: "Corpus has no documents.",
    })
  }

  if (steps.length === 0) {
    steps.push({
      title: "Classify the next goal",
      description: "Use the Goal Console to route the next operator objective safely.",
      href: "/goal-console",
      action: "Open Goal Console",
      signal: "Core registers are initialized.",
    })
  }

  return steps.slice(0, 4)
}
