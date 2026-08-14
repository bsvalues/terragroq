import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

function source(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8")
}

describe("Primary Home product contract", () => {
  it("uses the persistent Thread surface instead of the retired dashboard composition", () => {
    const page = source("app/(shell)/page.tsx")
    const workbench = source("components/workbench/workbench-shell.tsx")

    expect(page).toContain("return null")
    expect(workbench).toContain("<EmptyThread")
    expect(workbench).toContain("<ThreadTimeline")
    expect(workbench).toContain("getWorkbenchThreads")
    expect(workbench).not.toContain("OperatorHome")
    expect(workbench).not.toContain("OutcomeFieldBackground")
  })

  it("records decisions only through the exact-bound authority action", () => {
    const decision = source("components/primary-home/primary-home-decision.tsx")

    expect(decision).toContain("recordGoalAuthorityDecision")
    expect(decision).toContain("Confirm this authority decision")
    expect(decision).toContain("Cancel")
    expect(decision).toContain("Technical evidence basis")
    expect(decision).not.toContain("Approve recommendation")
  })

  it("uses one persistent Workbench with the stable spatial regions", () => {
    const shell = source("components/shell/app-shell.tsx")
    const frame = source("components/shell/app-shell-frame.tsx")
    const workbench = source("components/workbench/workbench-shell.tsx")

    expect(shell).toContain("AppShellFrame")
    expect(frame).toContain("<WorkbenchShell")
    expect(workbench).toContain('aria-label="Project and Thread Explorer"')
    expect(workbench).toContain('aria-label="Inspector"')
    expect(workbench).toContain('id="workbench-execution"')
    expect(workbench).toContain('aria-label="System status"')
    expect(workbench).not.toContain("compactHome")
  })
})
