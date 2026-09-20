import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"

import { afterEach, expect, it } from "vitest"

import { applyGovernedMarkerChange } from "@/scripts/hello-application/apply-governed-marker-change.mjs"

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })))

it("recognizes the committed governed marker baseline as idempotent", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-marker-baseline-"))
  roots.push(root)
  fs.cpSync(path.join(process.cwd(), "examples", "hello-application"), path.join(root, "examples", "hello-application"), { recursive: true })

  expect(applyGovernedMarkerChange({ repositoryRoot: root }).changedPaths).toEqual([])
})

function unmarkedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hello-codemod-regression-"))
  roots.push(root)
  fs.cpSync(path.join(process.cwd(), "examples", "hello-application"), path.join(root, "examples", "hello-application"), { recursive: true })
  const source = path.join(root, "examples", "hello-application", "src")
  const html = path.join(source, "index.html")
  const app = path.join(source, "app.js")
  const styles = path.join(source, "styles.css")
  fs.writeFileSync(html, fs.readFileSync(html, "utf8").replace(/^.*id="governance-marker".*\r?\n/m, ""))
  fs.writeFileSync(app, fs.readFileSync(app, "utf8")
    .replace(/^.*const governanceMarker.*\r?\n/m, "")
    .replace(/^.*if \(governanceMarker\).*\r?\n/m, "")
    .replace(/    const pulseNumber = String\(snapshot.count\).padStart\(3, "0"\)\r?\n    countOutput.textContent = pulseNumber/, '    countOutput.textContent = String(snapshot.count).padStart(3, "0")'))
  fs.writeFileSync(styles, fs.readFileSync(styles, "utf8").replace(/\.governance-marker \{[^}]+\}\r?\n\r?\n/, ""))
  return { root, app, html, styles }
}

it("restores the three-file codemod and validates it through the CLI", () => {
  const { root } = unmarkedFixture()
  const result = JSON.parse(execFileSync(process.execPath, [path.join(process.cwd(), "scripts/hello-application/apply-governed-marker-change.mjs")], { cwd: root, encoding: "utf8", windowsHide: true }))
  expect(result).toEqual({ changedPaths: ["examples/hello-application/src/app.js", "examples/hello-application/src/index.html", "examples/hello-application/src/styles.css"], validation: { command: "node --test examples/hello-application/test/hello.test.mjs", status: "passed" } })
  expect(applyGovernedMarkerChange({ repositoryRoot: root }).changedPaths).toEqual([])
})

it("detects codemod drift before any target is written", () => {
  const { root, app, html, styles } = unmarkedFixture()
  fs.writeFileSync(styles, fs.readFileSync(styles, "utf8").replace(".status-board dl {", ".status-board dl.drifted {"))
  const originals = [app, html, styles].map((file) => fs.readFileSync(file))
  expect(() => applyGovernedMarkerChange({ repositoryRoot: root })).toThrow("HELLO_GOVERNED_CHANGE_STYLES_ANCHOR")
  expect([app, html, styles].map((file) => fs.readFileSync(file))).toEqual(originals)
})

it.each(["drift", "validation"])("does not emit a success receipt on CLI %s failure", (mode) => {
  const { root, styles } = unmarkedFixture()
  if (mode === "drift") fs.writeFileSync(styles, fs.readFileSync(styles, "utf8").replace(".status-board dl {", ".status-board dl.drifted {"))
  else fs.appendFileSync(path.join(root, "examples/hello-application/test/hello.test.mjs"), '\ntest("injected failure", () => assert.fail("injected"))\n')
  let failure: any
  try { execFileSync(process.execPath, [path.join(process.cwd(), "scripts/hello-application/apply-governed-marker-change.mjs")], { cwd: root, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }) } catch (error) { failure = error }
  expect(failure).toBeTruthy()
  expect(failure.stdout).toBe("")
  expect(failure.stderr).toBe(mode === "drift" ? "HELLO_GOVERNED_CHANGE_STYLES_ANCHOR\n" : "HELLO_GOVERNED_CHANGE_VALIDATION_FAILED\n")
})
