import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

const shell = () => read("components/workspace-shell/workspace-shell.tsx")
const spatialCss = () => read("components/workspace-shell/experience-spatial.module.css")

describe("WilliamOS Experience V2 shell", () => {
  it("preserves a spatial workspace with independently durable work windows", () => {
    const source = shell()
    expect(source).toContain("WindowFrame")
    expect(source).toContain('id="editor"')
    expect(source).toContain('id="running-app"')
    expect(source).toContain('(["tests", "diff", "terminal"] as const)')
    expect(source).toContain("windowLayer")
    expect(source).toContain("dockButton")
    expect(source).not.toContain("experience.sourceRegion")
    expect(source).not.toContain("experience.previewRegion")
  })

  it("keeps The Line transient and grounds object actions in the selected source", () => {
    const source = shell()
    expect(source.match(/<input\b/g)).toHaveLength(1)
    expect(source).not.toContain("<textarea")
    expect(source).toContain("lineOpen ? (")
    expect(source).toContain('aria-label="The Line"')
    expect(source).toContain('["Ask", "Change", "Delegate", "Review"] as const')
    expect(source).toContain('["Inspect", "Debug", "Explain", "Delegate"] as const')
    expect(source).toContain('["Review", "Improve", "Challenge", "Merge"] as const')
    expect(source).toContain('["Talk", "Redirect", "Pause", "Fork", "Review work"] as const')
    expect(source).toContain('["Summarize", "Continue", "Delegate", "Council"] as const')
    expect(source).toContain("Selected ${selectedKind}: ${selectedLabel}")
    expect(source).toContain('space.activeWindowId === "running-app" ? "preview"')
    expect(source).toContain('space.activeWindowId === "diff" ? "diff"')
    expect(source).toContain("const councilRequest = text.match")
    expect(source).toContain("question: councilQuestion")
  })

  it("makes durable agent roles and William's judgment visible without pretending fixtures are live", () => {
    const source = shell()
    expect(source).toContain("reference session")
    expect(source).toContain("williamJudgment")
    expect(source).toContain('aria-label="William intelligence presence"')
    expect(source).toContain("Inspect")
    expect(source).toContain("Override")
    expect(source).toContain("Ask Council")
  })

  it("keeps Council advisory and Mission Control spatial", () => {
    const source = shell()
    expect(source).toContain("BrainCouncilSurface")
    expect(source).toContain("MissionControlSurface")
    expect(source).toContain('truth: "live"')
    expect(source).toContain('truth: "fixture"')
    expect(source).toContain("Illustrative Space · not live runtime state")
  })

  it("uses the restrained matte charcoal and sage product language", () => {
    const css = spatialCss().toLowerCase()
    expect(css).toContain("#090c09")
    expect(css).toContain("#8eb181")
    expect(css).toContain(".williamrail")
    expect(css).not.toContain("#b8794e")
    expect(css).not.toContain("#cc8d61")
  })

  it("keeps TerraFusion inside a neutral developer preview, never WilliamOS business UI", () => {
    const source = shell().toLowerCase()
    expect(source).toContain("developer preview")
    expect(source).toContain("running terrafusion application")
    expect(source).toContain("developer preview unavailable")
    expect(source).not.toContain("parcel")
    expect(source).not.toContain("appeal")
    expect(source).not.toContain("taxpayer")
    expect(source).not.toContain("pacs")
  })
})
