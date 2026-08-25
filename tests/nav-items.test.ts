import { describe, expect, it } from "vitest"
import { NAV_GROUP_IDS, navGroups, navItems } from "@/components/shell/nav-items"
import { DESTINATIONS, objectActionRegistry } from "@/lib/intent/object-action-registry"
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
    // Assert the routes stay reachable, and do it by READING THE CATALOGUE rather than by grepping
    // the file that happens to hold it today. This check has now broken twice for the same reason
    // and neither time was a route unreachable: first when the router moved from a flat phrase->href
    // map to intent-keyed destinations, and again at Gate 2 when the destinations moved out of
    // `router.ts` into the one Object + Action Registry. A test that fails when code is reorganised
    // but no behaviour changed is a test that trains people to edit it, which is worse than not
    // having it. Taking the hrefs as data means the next move costs nothing here.
    const reachable = new Set<string>([
      ...Object.values(DESTINATIONS).map((destination) => destination.href),
      ...objectActionRegistry.map((action) => action.href),
      ...supportingCapabilities.map((capability) => capability.href),
    ].filter((href): href is string => typeof href === "string" && href.length > 0))
    for (const href of supporting) expect([...reachable]).toContain(href)
  })
})
