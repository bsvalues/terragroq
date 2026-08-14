import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8")

describe("Primary Home workbench contract", () => {
  it("is owned by the persistent shell instead of a special Home dashboard", () => {
    expect(source("app/(shell)/page.tsx")).toContain("AppShell owns the persistent Home work surface")
    const frame = source("components/shell/app-shell-frame.tsx")
    expect(frame).toContain("WorkbenchShell")
    expect(frame).not.toContain("compactHome")
  })

  it("projects real operator state into threads without inventing project membership", () => {
    const model = source("lib/workbench/workbench-model.ts")
    expect(model).toContain("state.work.value.map")
    expect(model).toContain("projectKey: null")
    expect(source("components/workbench/workbench-shell.tsx")).toContain("Unassigned work")
  })

  it("keeps infrastructure truth compact and qualified", () => {
    const shell = source("components/workbench/workbench-shell.tsx")
    expect(shell).toContain("model.systems.value.map")
    expect(shell).toContain('system.detail.startsWith("live")')
    expect(shell).not.toContain("HealthStatusStrip")
  })
})
