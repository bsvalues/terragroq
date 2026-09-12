import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import { describeUnavailableNodeOperation } from "../lib/loom/node-operation-preflight"

/**
 * The live defect: "Run repository tests" spawns `node node_modules/vitest/vitest.mjs` in whatever
 * checkout the Space is bound to. Six of the seven bindable repositories are not Node projects at all,
 * so the child died inside Node's module loader and the operator was shown a stack trace instead of a
 * cause. These tests hold the refusal to the reason, and hold the absence of a refusal to the truth.
 */

const ROOT = mkdtempSync(path.join(tmpdir(), "preflight-"))

afterAll(() => { rmSync(ROOT, { recursive: true, force: true }) })

describe("node operation preflight", () => {
  it("refuses a test run in a repository with no runner installed, and names the repository", () => {
    const verdict = describeUnavailableNodeOperation(ROOT, ["node_modules/vitest/vitest.mjs", "run"])
    expect(verdict?.code).toBe("OPERATION_NOT_RUNNABLE_IN_REPOSITORY")
    expect(verdict?.detail).toMatch(/does not exist/)
    expect(verdict?.detail).toContain(ROOT)
  })

  it("names the missing tool, not the whole path, so the reason is readable", () => {
    const verdict = describeUnavailableNodeOperation(ROOT, ["node_modules/vitest/vitest.mjs", "run"])
    expect(verdict?.detail).toMatch(/no vitest installed/)
  })

  it("allows the run when the runner really is installed", () => {
    const installed = path.join(ROOT, "installed")
    mkdirSync(path.join(installed, "node_modules", "vitest"), { recursive: true })
    writeFileSync(path.join(installed, "node_modules", "vitest", "vitest.mjs"), "// stub")
    expect(describeUnavailableNodeOperation(installed, ["node_modules/vitest/vitest.mjs", "run"])).toBeNull()
  })

  it("allows a checkout with package.json but no node_modules to be refused, not crashed", () => {
    // os-1 on the live machine is exactly this shape: a real Node project whose dependencies were never
    // installed. It must produce a reason, not a loader stack trace.
    const declared = path.join(ROOT, "declared")
    mkdirSync(declared, { recursive: true })
    writeFileSync(path.join(declared, "package.json"), JSON.stringify({ name: "os-1" }))
    const verdict = describeUnavailableNodeOperation(declared, ["node_modules/vitest/vitest.mjs", "run"])
    expect(verdict?.code).toBe("OPERATION_NOT_RUNNABLE_IN_REPOSITORY")
  })

  it("refuses a script path that escapes the checkout rather than resolving it", () => {
    const verdict = describeUnavailableNodeOperation(ROOT, ["../../../etc/evil.mjs"])
    expect(verdict?.code).toBe("OPERATION_NOT_RUNNABLE_IN_REPOSITORY")
    expect(verdict?.detail).toMatch(/outside the selected repository/)
  })

  it("says nothing about an operation that runs no script", () => {
    expect(describeUnavailableNodeOperation(ROOT, ["run", "--reporter=dot"])).toBeNull()
  })
})
