export type LoopNativeConceptStep = {
  label: string
  description: string
  status: "read" | "verify" | "report" | "stop"
}

export type LoopNativeConceptSurface = {
  eyebrow: string
  title: string
  description: string
  steps: LoopNativeConceptStep[]
  guarantees: string[]
}

export function getLoopNativeConceptSurface(): LoopNativeConceptSurface {
  return {
    eyebrow: "Controlled progress cycle",
    title: "/loop governs progress",
    description:
      "A loop advances an active goal through inspection, verification, repair recommendations, and evidence. It may prepare the next move, but it cannot bypass authority or run hidden work.",
    steps: [
      {
        label: "Read current truth",
        description: "Inspect work state, blockers, authority, readiness, and recent evidence before proposing movement.",
        status: "read",
      },
      {
        label: "Verify constraints",
        description: "Check doctrine, stop conditions, validation evidence, and approval gates for the active Work Order.",
        status: "verify",
      },
      {
        label: "Report transition",
        description: "Name the next safe transition: continue, repair, review, merge, verify, or stop.",
        status: "report",
      },
      {
        label: "Stop for authority",
        description: "Hold when a real gate appears: security, data mutation, auth policy, deploy, or scope expansion.",
        status: "stop",
      },
    ],
    guarantees: [
      "No hidden continuation beyond the active playbook.",
      "No mutation buttons or repo-writing action from the UI.",
      "No scheduler, background worker, Hermes, MCP, or autonomy activation.",
      "No production write without a separate authorized Work Order.",
    ],
  }
}
