import { describe, expect, it } from "vitest"
import { NAV_GROUP_IDS, navGroups, navItems } from "@/components/shell/nav-items"

describe("operator navigation information architecture", () => {
  it("orders the shell around the operator journey", () => {
    expect(navGroups.map((group) => group.id)).toEqual([...NAV_GROUP_IDS])

    expect(navItems.map((item) => item.href)).toEqual([
      "/",
      "/work-orders",
      "/audit",
      "/projects",
      "/runtime",
      "/governance",
      "/decisions",
      "/doctrine",
      "/memory",
      "/brain-council",
      "/agent-forge",
      "/hermes",
      "/goal-console",
      "/trace",
      "/academy",
      "/corpus",
      "/chat",
    ])
  })

  it("uses Primary Operator navigation language without moving routes", () => {
    const labels = new Map(navItems.map((item) => [item.href, item.label]))

    expect(labels.get("/")).toBe("Home")
    expect(labels.get("/governance")).toBe("Authority")
    expect(labels.get("/brain-council")).toBe("Council")
    expect(labels.get("/goal-console")).toBe("Next Objective")
    expect(labels.get("/audit")).toBe("Evidence")
    expect(labels.get("/trace")).toBe("Trace")
    expect(labels.get("/academy")).toBe("Academy")
    expect(labels.get("/projects")).toBe("Projects")
    expect(labels.get("/agent-forge")).toBe("Forge")
    expect(labels.get("/hermes")).toBe("Hermes")
    expect(labels.get("/runtime")).toBe("Systems")
  })

  it("uses Primary Operator descriptions for key routes", () => {
    const descriptions = new Map(navItems.map((item) => [item.href, item.description]))

    expect(descriptions.get("/")).toBe("Primary Operator briefing.")
    expect(descriptions.get("/chat")).toBe("Command conversation.")
    expect(descriptions.get("/work-orders")).toBe("Control scoped work.")
    expect(descriptions.get("/audit")).toBe("Verify proof records.")
    expect(descriptions.get("/trace")).toBe("Review reasoning records.")
    expect(descriptions.get("/academy")).toBe("Learn WilliamOS operation.")
    expect(descriptions.get("/projects")).toBe("Review project posture.")
    expect(descriptions.get("/agent-forge")).toBe("Inspect capability prep.")
    expect(descriptions.get("/hermes")).toBe("Inspect worker boundaries.")
    expect(descriptions.get("/memory")).toBe("Place governed context.")
    expect(descriptions.get("/runtime")).toBe("Check status boundaries.")
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
        "Trace",
        "Academy",
        "Systems",
        "Council",
        "Forge",
        "Hermes",
        "Projects",
        "Memory",
        "Authority",
      ]),
    )
    expect(text).not.toMatch(/\b(groq|xai|ai-powered|terragroq)\b/i)
    expect(text).not.toMatch(/dashboard|workspace|admin portal|team status|productivity|users|organization|sign up|create account|request access/i)
    expect(text).not.toMatch(/\b(execute|run|commit|ingest|deploy|approve|approval|grant|saas|admin)\b/i)
  })

  it("separates primary command areas from supporting references", () => {
    const groupTiers = new Map(navGroups.map((group) => [group.id, group.tier]))
    const primaryGroups = navGroups
      .filter((group) => group.tier === "Primary")
      .map((group) => group.id)

    expect(primaryGroups).toEqual(["Home", "Work", "Authority"])
    expect(groupTiers.get("Council")).toBe("Supporting")
    expect(groupTiers.get("Systems")).toBe("Supporting")

    const primaryLabels = navItems
      .filter((item) => groupTiers.get(item.group) === "Primary")
      .map((item) => item.label)

    expect(primaryLabels).toEqual([
      "Home",
      "Work Orders",
      "Evidence",
      "Projects",
      "Systems",
      "Authority",
      "Decisions",
      "Doctrine",
    ])
  })
})
