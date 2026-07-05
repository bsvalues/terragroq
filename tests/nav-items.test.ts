import { describe, expect, it } from "vitest"
import { NAV_GROUP_IDS, navGroups, navItems } from "@/components/shell/nav-items"

describe("operator navigation information architecture", () => {
  it("orders the shell around the operator journey", () => {
    expect(navGroups.map((group) => group.id)).toEqual([...NAV_GROUP_IDS])

    expect(navItems.map((item) => item.href)).toEqual([
      "/",
      "/chat",
      "/goal-console",
      "/work-orders",
      "/audit",
      "/trace",
      "/projects",
      "/agent-forge",
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
    expect(labels.get("/chat")).toBe("Operator Chat")
    expect(labels.get("/goal-console")).toBe("Next Objective")
    expect(labels.get("/audit")).toBe("Evidence")
    expect(labels.get("/trace")).toBe("Trace Ledger")
    expect(labels.get("/projects")).toBe("Projects")
    expect(labels.get("/agent-forge")).toBe("Agent Forge")
    expect(labels.get("/runtime")).toBe("Systems")
  })

  it("uses Primary Operator descriptions for key routes", () => {
    const descriptions = new Map(navItems.map((item) => [item.href, item.description]))

    expect(descriptions.get("/")).toBe("Primary Operator briefing.")
    expect(descriptions.get("/chat")).toBe("Command conversation.")
    expect(descriptions.get("/audit")).toBe("Inspect proof records.")
    expect(descriptions.get("/trace")).toBe("Review reasoning records.")
    expect(descriptions.get("/projects")).toBe("Review systems under command.")
    expect(descriptions.get("/agent-forge")).toBe("Prepare capabilities.")
    expect(descriptions.get("/runtime")).toBe("Check readiness and health.")
  })

  it("keeps every nav item described and assigned to a declared group", () => {
    const groups = new Set(navGroups.map((group) => group.id))

    expect(navItems.every((item) => groups.has(item.group))).toBe(true)
    expect(navItems.every((item) => item.description.trim().length > 0)).toBe(true)
    expect(navGroups.every((group) => group.description.trim().length > 0)).toBe(true)
  })

  it("keeps major surfaces unique and avoids legacy vendor claims", () => {
    const labels = navItems.map((item) => item.label)
    const text = [
      ...labels,
      ...navItems.map((item) => item.description),
      ...navGroups.map((group) => group.description),
    ].join(" ")

    expect(new Set(labels).size).toBe(labels.length)
    expect(labels).toEqual(
      expect.arrayContaining([
        "Home",
        "Operator Chat",
        "Work Orders",
        "Evidence",
        "Trace Ledger",
        "Systems",
        "Brain Council",
        "Agent Forge",
        "Projects",
        "Memory",
        "Governance",
      ]),
    )
    expect(text).not.toMatch(/\b(groq|xai|ai-powered|terragroq)\b/i)
    expect(text).not.toMatch(/dashboard|workspace|admin portal|team status|productivity/i)
  })
})
