import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { WORKBENCH_TOOLS } from "@/lib/workbench/workbench-model"

const root = process.cwd()
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

describe("WilliamOS workbench shell contract", () => {
  it("uses one persistent shell on every authenticated route", () => {
    const shell = source("components/shell/app-shell-frame.tsx")
    expect(shell).toContain("<WorkbenchShell")
    expect(shell).not.toContain("compactHome")
    expect(shell).not.toContain("HealthStatusStrip")
    expect(shell).not.toContain("SidebarNav")
  })

  it("implements the persistent workbench regions and restores spatial state", () => {
    const shell = source("components/workbench/workbench-shell.tsx")
    for (const region of ["Explorer", "Inspector", "ExecutionPanel", "UniversalIntent", "WorkbenchHome"]) expect(shell).toContain(region)
    for (const key of ["williamos:workbench:thread", "williamos:workbench:project", "williamos:workbench:inspector-tab", "williamos:workbench:execution"]) expect(shell).toContain(key)
    expect(shell).toContain("window.localStorage")
  })

  it("keeps every existing capability reachable through contextual tools", () => {
    expect(WORKBENCH_TOOLS.map((tool) => tool.href)).toEqual(expect.arrayContaining([
      "/chat", "/goal-console", "/work-orders", "/audit", "/trace", "/memory", "/corpus",
      "/brain-council", "/decisions", "/doctrine", "/governance", "/hermes", "/runtime", "/agent-forge", "/academy",
    ]))
  })

  it("makes Home a thread work surface rather than a dashboard composition", () => {
    const home = source("components/workbench/workbench-home.tsx")
    expect(home).toContain("Thread timeline")
    expect(home).toContain("IntentComposer")
    expect(home).toContain("This is the work surface—not a dashboard")
    expect(home).not.toContain("<Card")
    expect(home).not.toContain("grid-cols-4")
  })

  it("binds Ctrl+K to universal intent", () => {
    const intent = source("components/intent/universal-intent.tsx")
    expect(intent).toContain('event.key.toLowerCase() === "k"')
    expect(intent).toContain("event.ctrlKey || event.metaKey")
  })
})
