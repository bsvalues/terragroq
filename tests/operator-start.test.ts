import { describe, expect, it } from "vitest"
import { getOperatorStartSteps, type DashboardStats } from "@/components/dashboard/operator-start"

const emptyStats: DashboardStats = {
  memory: 0,
  decisions: 0,
  openDecisions: 0,
  doctrines: 0,
  work: 0,
  openWork: 0,
  docs: 0,
}

describe("operator start path", () => {
  it("prioritizes governance setup for a new operator workspace", () => {
    const steps = getOperatorStartSteps(emptyStats)

    expect(steps.map((step) => step.href)).toEqual([
      "/doctrine",
      "/decisions",
      "/work-orders",
      "/corpus",
    ])
  })

  it("recommends corpus ingestion when documents are the only missing primitive", () => {
    const steps = getOperatorStartSteps({
      ...emptyStats,
      decisions: 1,
      doctrines: 1,
      work: 1,
    })

    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      href: "/corpus",
      action: "Ingest document",
    })
  })

  it("routes established workspaces to the goal console", () => {
    const steps = getOperatorStartSteps({
      ...emptyStats,
      decisions: 2,
      doctrines: 3,
      work: 1,
      docs: 4,
    })

    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      href: "/goal-console",
      action: "Open Goal Console",
    })
  })
})
