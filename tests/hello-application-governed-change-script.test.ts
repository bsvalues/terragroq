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

  it("runs the governed edit and validation as one resident command", () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-governed-command-"))
    roots.push(repositoryRoot)
    fs.cpSync(
      path.join(process.cwd(), "examples", "hello-application"),
      path.join(repositoryRoot, "examples", "hello-application"),
      { recursive: true },
    )

    const output = execFileSync(process.execPath, [
      path.join(process.cwd(), "scripts", "hello-application", "apply-governed-marker-change.mjs"),
    ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })

    expect(JSON.parse(output)).toEqual({
      changedPaths: [
        "examples/hello-application/src/app.js",
        "examples/hello-application/src/index.html",
        "examples/hello-application/src/styles.css",
      ],
      validation: {
        command: "node --test examples/hello-application/test/hello.test.mjs",
        status: "passed",
      },
    })
  })

  it("fails closed without a success receipt when resident validation fails", () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-governed-command-failure-"))
    roots.push(repositoryRoot)
    fs.cpSync(
      path.join(process.cwd(), "examples", "hello-application"),
      path.join(repositoryRoot, "examples", "hello-application"),
      { recursive: true },
    )
    fs.appendFileSync(
      path.join(repositoryRoot, "examples", "hello-application", "test", "hello.test.mjs"),
      '\ntest("injected resident validation failure", () => assert.fail("injected"))\n',
    )

    let failure: unknown
    try {
      execFileSync(process.execPath, [
        path.join(process.cwd(), "scripts", "hello-application", "apply-governed-marker-change.mjs"),
      ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeTruthy()
    expect(String((failure as { stdout?: string })?.stdout ?? "")).toBe("")
    expect(String((failure as { stderr?: string })?.stderr ?? "")).toBe("HELLO_GOVERNED_CHANGE_VALIDATION_FAILED\n")
  })

  it("reports a safe exact drift code without emitting a success receipt", () => {
    const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hello-governed-command-drift-"))
    roots.push(repositoryRoot)
    fs.cpSync(
      path.join(process.cwd(), "examples", "hello-application"),
      path.join(repositoryRoot, "examples", "hello-application"),
      { recursive: true },
    )
    const stylesPath = path.join(repositoryRoot, "examples", "hello-application", "src", "styles.css")
    fs.writeFileSync(stylesPath, fs.readFileSync(stylesPath, "utf8").replace(".status-board dl {", ".status-board dl.drifted {"))

    let failure: unknown
    try {
      execFileSync(process.execPath, [
        path.join(process.cwd(), "scripts", "hello-application", "apply-governed-marker-change.mjs"),
      ], { cwd: repositoryRoot, encoding: "utf8", windowsHide: true })
    } catch (error) {
      failure = error
    }

    expect(failure).toBeTruthy()
    expect(String((failure as { stdout?: string })?.stdout ?? "")).toBe("")
    expect(String((failure as { stderr?: string })?.stderr ?? "")).toBe("HELLO_GOVERNED_CHANGE_STYLES_ANCHOR\n")
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
