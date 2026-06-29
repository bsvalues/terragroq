import { describe, expect, it } from "vitest"
import { navGroups, navItems } from "@/components/shell/nav-items"

describe("operator navigation information architecture", () => {
  it("orders the shell around the operator journey", () => {
    expect(navGroups.map((group) => group.id)).toEqual([
      "Command",
      "Governance",
      "Knowledge",
      "Operations",
    ])

    expect(navItems.map((item) => item.href)).toEqual([
      "/",
      "/goal-console",
      "/work-orders",
      "/chat",
      "/decisions",
      "/doctrine",
      "/governance",
      "/brain-council",
      "/memory",
      "/corpus",
      "/audit",
      "/runtime",
    ])
  })

  it("keeps every nav item described and assigned to a declared group", () => {
    const groups = new Set(navGroups.map((group) => group.id))

    expect(navItems.every((item) => groups.has(item.group))).toBe(true)
    expect(navItems.every((item) => item.description.trim().length > 0)).toBe(true)
    expect(navGroups.every((group) => group.description.trim().length > 0)).toBe(true)
  })
})
