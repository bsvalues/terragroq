export type HermesReadinessCard = {
  label: string
  state: "ready-for-review" | "blocked" | "disabled" | "preview-only"
  description: string
}

export type HermesWorkerDockReadiness = {
  title: string
  summary: string
  cards: HermesReadinessCard[]
  nextReview: string
  safety: {
    readOnlySurface: true
    readsLiveWorkers: false
    dispatchButton: false
    jobQueue: false
    backgroundPolling: false
    activatesMcp: false
    writesProduction: false
  }
}

export function getHermesWorkerDockReadiness(): HermesWorkerDockReadiness {
  return {
    title: "Worker Dock readiness",
    summary:
      "A read-only readiness surface for Hermes posture, packet requirements, authority gates, and blocked execution state.",
    cards: [
      {
        label: "Runtime posture",
        state: "disabled",
        description: "No Hermes runner, queue processor, scheduler, or background worker is active.",
      },
      {
        label: "Packet model",
        state: "ready-for-review",
        description: "Worker packet requirements are defined for future review, not execution.",
      },
      {
        label: "Authority gate",
        state: "blocked",
        description: "Primary approval and a separate activation Work Order are required before runtime work.",
      },
      {
        label: "Evidence path",
        state: "preview-only",
        description: "Evidence expectations are visible; no verification is started from the dock.",
      },
    ],
    nextReview:
      "Review blocked and denied states before any future activation design is considered.",
    safety: {
      readOnlySurface: true,
      readsLiveWorkers: false,
      dispatchButton: false,
      jobQueue: false,
      backgroundPolling: false,
      activatesMcp: false,
      writesProduction: false,
    },
  }
}
