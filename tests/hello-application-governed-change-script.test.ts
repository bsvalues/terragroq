import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { applyGovernedMarkerChange } from "@/scripts/hello-application/apply-governed-marker-change.mjs"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Hello Application governed marker codemod", () => {
  it("makes exactly the three reserved edits and leaves the Hello tests green", () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-governed-change-"))
    roots.push(repositoryRoot)
    fs.cpSync(
      path.join(process.cwd(), "examples", "hello-application"),
      path.join(repositoryRoot, "examples", "hello-application"),
      { recursive: true },
    )

    const result = applyGovernedMarkerChange({ repositoryRoot })

    expect(result.changedPaths).toEqual([
      "examples/hello-application/src/app.js",
      "examples/hello-application/src/index.html",
      "examples/hello-application/src/styles.css",
    ])
    expect(fs.readFileSync(path.join(repositoryRoot, "examples/hello-application/src/index.html"), "utf8"))
      .toContain('id="governance-marker" class="governance-marker">Governed by HERMES · build ready</p>')
    expect(fs.readFileSync(path.join(repositoryRoot, "examples/hello-application/src/styles.css"), "utf8"))
      .toContain(".governance-marker {")
    expect(fs.readFileSync(path.join(repositoryRoot, "examples/hello-application/src/app.js"), "utf8"))
      .toContain("Governed by HERMES · pulse ${pulseNumber}")

    expect(applyGovernedMarkerChange({ repositoryRoot }).changedPaths).toEqual([])
    expect(() => execFileSync(process.execPath, [
      "--test",
      path.join(repositoryRoot, "examples/hello-application/test/hello.test.mjs"),
    ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })).not.toThrow()
  })

  it("leaves every target untouched when any target has drifted", () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-governed-change-drift-"))
    roots.push(repositoryRoot)
    fs.cpSync(
      path.join(process.cwd(), "examples", "hello-application"),
      path.join(repositoryRoot, "examples", "hello-application"),
      { recursive: true },
    )
    const htmlPath = path.join(repositoryRoot, "examples/hello-application/src/index.html")
    const appPath = path.join(repositoryRoot, "examples/hello-application/src/app.js")
    const stylesPath = path.join(repositoryRoot, "examples/hello-application/src/styles.css")
    const htmlBefore = fs.readFileSync(htmlPath, "utf8")
    const appBefore = fs.readFileSync(appPath, "utf8")
    fs.writeFileSync(stylesPath, fs.readFileSync(stylesPath, "utf8").replace(".status-board dl {", ".status-board dl.drifted {"))
    const stylesBefore = fs.readFileSync(stylesPath, "utf8")

    expect(() => applyGovernedMarkerChange({ repositoryRoot })).toThrow("HELLO_GOVERNED_CHANGE_STYLES_ANCHOR")
    expect(fs.readFileSync(htmlPath, "utf8")).toBe(htmlBefore)
    expect(fs.readFileSync(appPath, "utf8")).toBe(appBefore)
    expect(fs.readFileSync(stylesPath, "utf8")).toBe(stylesBefore)
  })
})
