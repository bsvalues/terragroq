import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8")

const shell = () => read("components/workspace-shell/workspace-shell.tsx")
const experienceCss = () => read("components/workspace-shell/experience-shell.module.css")

describe("WilliamOS Experience V2 shell", () => {
  it("keeps the project world as one continuous work surface, not floating mini-windows", () => {
    const source = shell()
    expect(source).not.toContain("WindowFrame")
    expect(source).not.toContain("windowLayer")
    expect(source).not.toContain("dockItem")
    expect(source).toContain('className={experience.sourceRegion}')
    expect(source).toContain('className={experience.previewRegion}')
    expect(source).toContain('className={experience.contextRail}')
  })

  it("keeps one summoned Line instead of mounting a permanent chat composer", () => {
    const source = shell()
    expect(source.match(/<input\b/g)).toHaveLength(1)
    expect(source).not.toContain("<textarea")
    expect(source).toContain("lineOpen ? (")
    expect(source).toContain('aria-label="The Line"')
  })

  it("makes context recede when it is not active", () => {
    const source = shell()
    const css = experienceCss()
    expect(source).toContain("environmentContextClosed")
    expect(source).toContain("environmentContextOpen")
    expect(css).toContain(".environmentContextClosed")
    expect(css).toContain("54px")
    expect(css).toContain("348px")
  })

  it("does not restore generic AI-gradient visual language", () => {
    const css = experienceCss()
    expect(css.toLowerCase()).not.toContain("gradient(")
    expect(css).not.toContain("--copper")
    expect(css).not.toContain("--obsidian")
  })

  it("keeps the target application as a developer preview, never WilliamOS business UI", () => {
    const source = shell()
    expect(source).toContain("Developer preview")
    expect(source).toContain("Running TerraFusion application")
    expect(source).toContain("Preview is not attached")
    expect(source).not.toContain("parcel")
    expect(source).not.toContain("appeal")
    expect(source).not.toContain("taxpayer")
  })
})
