import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

function source(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8")
}

function exists(relativePath: string) {
  return fs.existsSync(path.join(ROOT, relativePath))
}

/**
 * Source with comments removed. The negative assertions below are about what the code MOUNTS, and a
 * file that explains why the legacy frame is gone must be free to name it — otherwise the contract
 * punishes the documentation that makes it survivable.
 */
function code(relativePath: string) {
  return source(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
}

/**
 * THE PRIMARY EXPERIENCE CONTRACT — the repository rule, enforced.
 *
 * Owner diagnosis, 2026-08-22, and it is the correct one: "the repository still embodies the old
 * product more strongly than our instructions embody the new one." Prose said workspace; the component
 * tree said dashboard; code wins. Every agent that opened this repo met WorkbenchShell,
 * WorkbenchViewMode, ProjectExplorer, Inspector and routes for /projects, /activity, /system, and
 * reasonably concluded WilliamOS was a web app with sections plus an AI feature — so every new
 * capability got built through those seams, and a month of correcting the words changed nothing.
 *
 * The file this replaces (`primary-home-contract.test.ts`) was part of the problem: it PINNED the old
 * shape — `return null` at the root, the shell as the persistent frame — so CI actively defended the
 * architecture the owner ordered removed.
 *
 * This contract exists so the wrong implementation is hard to write, not merely discouraged. It is
 * deliberately structural: it does not check styling, and it cannot be satisfied by renaming things.
 */
describe("`/` is the working environment, not a dashboard home", () => {
  it("serves the root from the environment, and no Home page owns it", () => {
    // The empty `return null` Home that existed only to hang shell chrome on is gone. If it comes
    // back, `/` silently belongs to the legacy frame again — which is exactly how this regressed
    // before, invisibly, while everyone agreed about the words.
    expect(exists("app/(shell)/page.tsx")).toBe(false)
    const root = code("app/page.tsx")
    expect(root).toContain("Desk")
    expect(root).not.toContain("WorkbenchShell")
  })

  it("mounts no legacy shell frame in the primary journey", () => {
    const root = code("app/page.tsx")
    for (const legacy of ["AppShell", "AppShellFrame", "ProjectExplorer", "Inspector", "ThreadTimeline"]) {
      expect(root).not.toContain(legacy)
    }
  })
})

describe("the freeze: no new code may extend the old product shape", () => {
  /**
   * The owner's rule, verbatim: "No new code may extend WorkbenchShell or introduce another primary
   * route/mode." A frozen file can still be read and still works; it just stops growing, so the old
   * architecture can no longer absorb new capability the way it has been.
   */
  const FROZEN_SHELL = "components/workbench/workbench-shell.tsx"

  it("keeps the legacy shell reachable but marked compatibility-only", () => {
    // Not deleted yet — deletion is the last phase, after its capabilities exist as surfaces. Until
    // then it must SAY what it is, in the file, where the next agent will actually read it.
    const shell = source(FROZEN_SHELL)
    expect(shell).toMatch(/COMPATIBILITY ONLY|MARKED FOR DELETION/i)
  })

  it("does not grow new primary product modes", () => {
    // WorkbenchViewMode is the abstraction that made "add another mode" the obvious way to add a
    // capability. The set is frozen at what already exists; a new one fails here, which is the point.
    const shell = source(FROZEN_SHELL)
    const modes = [...shell.matchAll(/mode:\s*"([a-z-]+)"/gi)].map((match) => match[1])
    expect(new Set(modes).size).toBeLessThanOrEqual(2)
  })

  it("adds no new top-level product route", () => {
    // Every directory under app/(shell) is a legacy page. New capability belongs in the environment
    // as a SURFACE, summoned by context — never as another destination the owner must navigate to.
    const shellDir = path.join(ROOT, "app/(shell)")
    const routes = fs.existsSync(shellDir)
      ? fs.readdirSync(shellDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
      : 0
    expect(routes).toBeLessThanOrEqual(17)
  })
})

describe("the environment owns one world, and one input", () => {
  it("has exactly one conversational input, not a chat product beside the work", () => {
    // A separate Chat concept is what made the Line feel like a bolt-on tab: two states, two
    // surfaces, neither authoritative. The Line is an input device for the environment.
    const desk = source("components/desk/desk.tsx")
    expect(desk).toMatch(/exactly one conversational input/i)
  })

  it("renders surfaces the environment summons rather than fixed panels", () => {
    const desk = code("components/desk/desk.tsx")
    expect(desk).toContain("surfaces")
    // No permanently-nailed explorer or inspector inside the primary environment.
    expect(desk).not.toContain("ProjectExplorer")
    expect(desk).not.toContain("Inspector")
  })
})
