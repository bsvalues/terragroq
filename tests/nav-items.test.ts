import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { NAV_GROUP_IDS, navGroups, navItems } from "@/components/shell/nav-items"

describe("four-primary cockpit navigation", () => {
  it("exposes exactly HOME, PROJECTS, ACTIVITY, and SYSTEM in the normal shell", () => {
    expect(navItems.map(({ href, label }) => ({ href, label }))).toEqual([
      { href: "/", label: "Home" },
      { href: "/projects", label: "Projects" },
      { href: "/activity", label: "Activity" },
      { href: "/runtime", label: "System" },
    ])
  })

  it("keeps a single primary cockpit group", () => {
    expect(NAV_GROUP_IDS).toEqual(["Cockpit"])
    expect(navGroups).toEqual([{ id: "Cockpit", tier: "Primary", description: "Home, durable projects, recorded activity, and system truth." }])
    expect(navItems.every((item) => item.group === "Cockpit")).toBe(true)
  })

  it("uses the same four destinations in the compact Home rail", () => {
    const frame = readFileSync("components/shell/app-shell-frame.tsx", "utf8")
    const rail = frame.slice(frame.indexOf("const HOME_RAIL_DESTINATIONS"), frame.indexOf("]\n\nexport function AppShellFrame"))
    for (const href of ['"/"', '"/projects"', '"/activity"', '"/runtime"']) expect(rail).toContain(href)
    expect(rail).not.toContain('"/work-orders"')
    expect(rail).not.toContain('"/audit"')
  })

  it("keeps supporting routes out of primary navigation without deleting them", () => {
    expect(navItems.map((item) => item.href)).not.toEqual(expect.arrayContaining(["/work-orders", "/audit", "/brain-council", "/goal-console", "/chat"]))
    const intent = readFileSync("lib/intent/router.ts", "utf8")
    expect(intent).toContain('"work orders": "/work-orders"')
    expect(intent).toContain('"brain council": "/brain-council"')
    expect(intent).toContain('"goal console": "/goal-console"')
    expect(intent).toContain('chat: "/chat"')
  })
})
