import { describe, expect, it } from "vitest"
import { getHomeCommandCenter } from "@/components/dashboard/home-command-center"
import type { DashboardStats } from "@/components/dashboard/operator-start"

const initializedStats: DashboardStats = {
  memory: 3,
  decisions: 2,
  openDecisions: 0,
  doctrines: 2,
  work: 4,
  openWork: 0,
  docs: 5,
}

describe("WilliamOS Home Command Center", () => {
  it("frames Home as the Primary Operator command center", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.title).toBe("WilliamOS Home")
    expect(home.eyebrow).toBe("Primary Operator Command Center")
    expect(home.description).toContain("private command environment")
    expect(home.primaryAction).toEqual({
      label: "Review next move",
      href: "/work-orders",
    })
  })

  it("surfaces systems, attention, council, and worker dock status", () => {
    const home = getHomeCommandCenter(initializedStats)
    const labels = home.statusCards.map((card) => card.label)

    expect(labels).toEqual(["Systems", "Attention", "Council", "Worker Dock"])
    expect(home.statusCards.find((card) => card.label === "Council")).toMatchObject({
      value: "Advisory",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Worker Dock")).toMatchObject({
      value: "Inactive",
      href: "/brain-council",
    })
  })

  it("routes active work to work order review", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 2,
    })

    expect(home.nextMove).toMatchObject({
      label: "Review active work orders",
      href: "/work-orders",
    })
    expect(home.statusCards.find((card) => card.label === "Attention")).toMatchObject({
      value: "2 active",
      href: "/work-orders",
    })
  })

  it("does not grant execution, autonomy, authority, or production-write behavior", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.safety).toEqual({
      readOnly: true,
      startsHermes: false,
      activatesBrainCouncil: false,
      writesProduction: false,
      changesAuthority: false,
    })
  })
})
