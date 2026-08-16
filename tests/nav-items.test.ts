import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { NAV_GROUP_IDS, navGroups, navItems } from "@/components/shell/nav-items"
import { supportingCapabilities } from "@/components/workbench/supporting-capabilities"

describe("four-primary cockpit navigation", () => {
  it("exposes exactly HOME, PROJECTS, ACTIVITY, and SYSTEM in the normal shell", () => {
    expect(navItems.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/", label: "Home" },
      { href: "/projects", label: "Projects" },
      { href: "/activity", label: "Activity" },
      { href: "/system", label: "System" },
    ])
  })

  it("keeps a single primary cockpit group", () => {
    expect(NAV_GROUP_IDS).toEqual(["Cockpit"])
    expect(navGroups).toEqual([{ id: "Cockpit", tier: "Primary", description: "Home, durable projects, recorded activity, and system truth." }])
    expect(navItems.every((item) => item.group === "Cockpit")).toBe(true)
  })

  it("keeps raw Runtime available as contextual technical detail", () => {
    expect(supportingCapabilities).toContainEqual({
      label: "Raw Runtime",
      href: "/runtime?detail=technical",
      lens: "technical",
    })
  })

  it("keeps supporting routes out of primary navigation without deleting them", () => {
    const supporting = ["/work-orders", "/audit", "/brain-council", "/goal-console", "/chat"]
    expect(navItems.map((item) => item.href)).not.toEqual(expect.arrayContaining(supporting))
    // Assert the routes stay reachable, not the literal syntax that expresses them: the intent
    // router moved from a flat phrase->href map to intent-keyed destinations, which silently
    // broke this check while every route remained reachable.
    const hrefs = (source: string) => Array.from(source.matchAll(/href: "(\/[a-z-]+)"/g), (match) => match[1])
    const reachable = new Set([
      ...hrefs(readFileSync("lib/intent/router.ts", "utf8")),
      ...hrefs(readFileSync("components/workbench/supporting-capabilities.ts", "utf8")),
    ])
    for (const href of supporting) expect([...reachable]).toContain(href)
  })
})
