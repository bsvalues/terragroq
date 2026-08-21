import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The canonical entry point (real-operator acceptance, criteria 1-2). Review caught the first cut
 * editing components/shell/nav-items.ts, which only feeds the UNMOUNTED MobileNav — so the doorway
 * would never render. This asserts the doorway lives in the nav the signed-in shell ACTUALLY renders:
 * the modes nav in components/workbench/workbench-shell.tsx. It links OUT to /environment (its own
 * full-screen layout), so the shell is never embedded in the Desk.
 */
describe("Environment doorway is in the rendered shell navigation", () => {
  const shell = readFileSync(path.join(process.cwd(), "components/workbench/workbench-shell.tsx"), "utf8")

  it("links to /environment with an Environment label", () => {
    expect(shell).toContain('href="/environment"')
    expect(shell).toContain("Environment")
  })

  it("is a plain doorway link, not a WorkbenchViewMode (leaving the shell, not an internal view)", () => {
    const modesBlock = shell.slice(shell.indexOf("const modes:"), shell.indexOf("const inspectorTabs"))
    expect(modesBlock).not.toContain("/environment")
    expect(modesBlock).toContain('mode: "home"')
    expect(modesBlock).toContain('mode: "system"')
  })
})
