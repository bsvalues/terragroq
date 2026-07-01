import { describe, expect, it } from "vitest"
import { getHermesWorkerDockReadiness } from "@/components/brain-council/hermes-worker-dock-readiness"

describe("Hermes Worker Dock readiness", () => {
  it("shows readiness, blocked, disabled, and preview-only states", () => {
    const readiness = getHermesWorkerDockReadiness()

    expect(readiness.cards.map((card) => card.state)).toEqual([
      "disabled",
      "ready-for-review",
      "blocked",
      "preview-only",
    ])
    expect(readiness.cards.map((card) => card.label)).toEqual([
      "Runtime posture",
      "Packet model",
      "Authority gate",
      "Evidence path",
    ])
  })

  it("keeps the next step as review, not activation", () => {
    const readiness = getHermesWorkerDockReadiness()

    expect(readiness.nextReview).toContain("Review blocked and denied states")
    expect(readiness.nextReview).not.toMatch(/activate now|dispatch|run/i)
  })

  it("does not read live workers, dispatch jobs, poll queues, activate MCP, or write production", () => {
    const readiness = getHermesWorkerDockReadiness()

    expect(readiness.safety).toEqual({
      readOnlySurface: true,
      readsLiveWorkers: false,
      dispatchButton: false,
      jobQueue: false,
      backgroundPolling: false,
      activatesMcp: false,
      writesProduction: false,
    })
  })
})
