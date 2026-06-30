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

  it("surfaces the unified WilliamOS command areas", () => {
    const home = getHomeCommandCenter(initializedStats)
    const labels = home.statusCards.map((card) => card.label)

    expect(labels).toEqual([
      "Active Work",
      "Ready Next",
      "Blocked Decisions",
      "Evidence Required",
      "Systems",
      "Council",
      "Worker Dock",
      "Agent Forge",
      "Active Project",
    ])
    expect(home.statusCards.find((card) => card.label === "Council")).toMatchObject({
      value: "Advisory",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Worker Dock")).toMatchObject({
      value: "Inactive",
      href: "/brain-council",
    })
    expect(home.statusCards.find((card) => card.label === "Agent Forge")).toMatchObject({
      value: "Proposal-only",
      href: "/agent-forge",
    })
    expect(home.statusCards.find((card) => card.label === "Active Project")).toMatchObject({
      value: "TerraFusion OS",
      href: "/projects",
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
    expect(home.statusCards.find((card) => card.label === "Active Work")).toMatchObject({
      value: "2 active",
      href: "/work-orders",
    })
  })

  it("routes zero active work to goal classification", () => {
    const home = getHomeCommandCenter({
      ...initializedStats,
      openWork: 0,
    })

    expect(home.nextMove).toMatchObject({
      label: "Classify the next objective",
      href: "/goal-console",
      reason: "No active work is blocking the Primary Operator briefing.",
    })
    expect(home.statusCards.find((card) => card.label === "Active Work")).toMatchObject({
      value: "none",
      href: "/goal-console",
    })
  })

  it("does not grant execution, autonomy, authority, or production-write behavior", () => {
    const home = getHomeCommandCenter(initializedStats)

    expect(home.safety).toEqual({
      readOnly: true,
      startsHermes: false,
      activatesBrainCouncil: false,
      executesWorkOrders: false,
      deploys: false,
      writesProduction: false,
      changesAuthority: false,
    })
  })
})
