import { describe, expect, it } from "vitest"
import { getHermesDoctrine } from "@/components/brain-council/hermes-doctrine"

describe("Hermes doctrine", () => {
  it("defines Hermes as a governed worker sidecar", () => {
    const doctrine = getHermesDoctrine()

    expect(doctrine.eyebrow).toBe("Worker sidecar boundary")
    expect(doctrine.summary).toContain("governed Worker Dock sidecar")
    expect(doctrine.summary).toContain("cannot act")
    expect(doctrine.principles.map((principle) => principle.label)).toEqual([
      "Prepared, not active",
      "Work Orders govern work",
      "Primary authority gates execution",
      "Evidence returns with work",
    ])
  })

  it("keeps runtime, tool authority, activation, and packet boundaries explicit", () => {
    const doctrine = getHermesDoctrine()

    expect(doctrine.boundaries).toEqual([
      expect.objectContaining({ label: "Worker runtime", state: "blocked" }),
      expect.objectContaining({ label: "Tool authority", state: "blocked" }),
      expect.objectContaining({ label: "Activation", state: "owner-gated" }),
      expect.objectContaining({ label: "Worker packet", state: "review-only" }),
    ])
  })

  it("does not execute, dispatch, activate MCP, run schedulers, or write production", () => {
    const doctrine = getHermesDoctrine()

    expect(doctrine.safety).toEqual({
      sidecarOnly: true,
      workOrderRequired: true,
      authorityRequired: true,
      executesWork: false,
      dispatchesJobs: false,
      activatesMcp: false,
      runsScheduler: false,
      writesProduction: false,
    })
    expect(doctrine.operatingRule).toContain("Primary authority")
  })
})
