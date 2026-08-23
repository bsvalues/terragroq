import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { NAV_GROUP_IDS, navGroups, navItems } from "@/components/shell/nav-items"
import { supportingCapabilities } from "@/components/workbench/supporting-capabilities"

describe("legacy cockpit navigation (compatibility only)", () => {
  it("exposes exactly HOME and SYSTEM in the normal shell", () => {
    expect(navItems.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/", label: "Home" },
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
    // "/chat" is absent because it no longer exists: there is no separate Chat product, and the Line
    // in the Environment is the operator's input. A route kept here "for compatibility" would go on
    // teaching that chat is a destination.
    const supporting = ["/audit", "/brain-council", "/goal-console"]
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
