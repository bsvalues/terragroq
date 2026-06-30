import { describe, expect, it } from "vitest"
import { navGroups, navItems } from "@/components/shell/nav-items"

describe("operator navigation information architecture", () => {
  it("orders the shell around the operator journey", () => {
    expect(navGroups.map((group) => group.id)).toEqual([
      "Home",
      "Work",
      "Council",
      "Authority",
      "Systems",
    ])

    expect(navItems.map((item) => item.href)).toEqual([
      "/",
      "/chat",
      "/goal-console",
      "/work-orders",
      "/audit",
      "/brain-council",
      "/memory",
      "/corpus",
      "/decisions",
      "/doctrine",
      "/governance",
      "/runtime",
    ])
  })

  it("uses Primary Operator navigation language without moving routes", () => {
    const labels = new Map(navItems.map((item) => [item.href, item.label]))

    expect(labels.get("/")).toBe("Home")
    expect(labels.get("/chat")).toBe("Ask WilliamOS")
    expect(labels.get("/goal-console")).toBe("Next Objective")
    expect(labels.get("/audit")).toBe("Evidence / Audit")
    expect(labels.get("/runtime")).toBe("Systems")
  })

  it("keeps every nav item described and assigned to a declared group", () => {
    const groups = new Set(navGroups.map((group) => group.id))

    expect(navItems.every((item) => groups.has(item.group))).toBe(true)
    expect(navItems.every((item) => item.description.trim().length > 0)).toBe(true)
    expect(navGroups.every((group) => group.description.trim().length > 0)).toBe(true)
  })
})
