import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  measureBaselineFailures,
  newlyFailingTests,
  parseFailingTestFiles,
  validationFailureWall,
} from "../scripts/runtime-operator/williamos-adapters.mjs"

/**
 * A gate must fail a worker for what the worker broke. This host fails 23 tests on pristine main --
 * four files that need live lab hosts and pass on CI's Linux runner -- and gating on the absolute
 * result turned every correct patch into FAILED_TERMINAL.
 */
describe("differential test gate", () => {
  it("distinguishes a proven new test regression from a generic test harness failure", () => {
    expect(validationFailureWall("test", { provenModelRegression: true })).toBe("VALIDATION_TEST_REGRESSION_WALL")
    expect(validationFailureWall("test")).toBe("VALIDATION_TEST_WALL")
    expect(validationFailureWall("diff-check", { provenModelRegression: true })).toBe("VALIDATION_DIFF_CHECK_WALL")
  })

  it("does not let an exception mint differential proof by naming the privileged wall", () => {
    expect(validationFailureWall("test", {
      error: new Error("VALIDATION_TEST_REGRESSION_WALL"),
    })).toBe("VALIDATION_TEST_WALL")
  })

  it("reads failing test files out of vitest output, colour codes and all", () => {
    const output = "[31mFAIL[0m  tests/alpha.test.ts > case\nFAIL  tests/beta.test.tsx > other\n"
    expect(parseFailingTestFiles(output)).toEqual(["tests/alpha.test.ts", "tests/beta.test.tsx"])
  })

  it("reports each file once however many of its cases fail", () => {
    const output = "FAIL  tests/alpha.test.ts > one\nFAIL  tests/alpha.test.ts > two\n"
    expect(parseFailingTestFiles(output)).toEqual(["tests/alpha.test.ts"])
  })

  it("normalises Windows separators so a baseline matches whatever wrote it", () => {
    expect(parseFailingTestFiles("FAIL  tests\\alpha.test.ts > case")).toEqual(["tests/alpha.test.ts"])
  })

  it("passes a patch that breaks nothing the host was not already breaking", () => {
    const baseline = ["tests/hermes-app-server-client.test.ts", "tests/hermes-free-dev-agent-provider.test.ts"]
    expect(newlyFailingTests(baseline, baseline)).toEqual([])
  })

  it("still fails a patch that breaks something new, and names only what it broke", () => {
    const baseline = ["tests/hermes-app-server-client.test.ts"]
    const failing = ["tests/hermes-app-server-client.test.ts", "tests/workbench-thread-loader.test.ts"]
    expect(newlyFailingTests(failing, baseline)).toEqual(["tests/workbench-thread-loader.test.ts"])
  })

  it("treats a missing baseline as no excuse: every failure counts", () => {
    expect(newlyFailingTests(["tests/alpha.test.ts"], undefined)).toEqual(["tests/alpha.test.ts"])
  })

  it("finds nothing to report when the output carries no failures", () => {
    expect(parseFailingTestFiles("Tests  4645 passed")).toEqual([])
    expect(parseFailingTestFiles(undefined)).toEqual([])
  })
})

/**
 * The half of the gate that was never exercised: the baseline it compares against.
 *
 * Every baseline this host had cached recorded `failing: []` while the suite it was measured from
 * never reached its summary -- killed at its deadline, its output read for failure lines that a
 * killed run does not print. The comparison was then blank against blank, which is indistinguishable
 * from a clean run, so a red suite passed the gate and the first real verdict came from CI.
 * A measurement that did not happen must not be recorded as one.
 */
describe("the baseline is only believed when it was measured", () => {
  const roots: string[] = []
  afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })

  const HEAD = "87dea6af05ba0737b0f50b1a6b4992ab58291f11"
  const newRoot = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "wo-0030-baseline-"))
    roots.push(root)
    return root
  }
  const cacheFile = (root: string) => path.join(root, "state", "baselines", `${HEAD}.json`)

  /** A suite run that fails; `output` is whatever vitest managed to print before it stopped. */
  const suiteFailing = (output: string) => async (command: string, args: string[]) => {
    if (command === "cmd.exe" && args.includes("vitest")) {
      const failure: Error & { output?: string } = new Error("PROCESS_WALL:cmd.exe")
      failure.output = output
      throw failure
    }
    return { stdout: "", stderr: "" }
  }
  const suitePassing = async () => ({ stdout: "", stderr: "" })
  const never = async () => { throw new Error("the cached baseline should have answered this") }

  it("refuses to record a run that was killed before it named anything", async () => {
    const root = newRoot()
    // What a deadline-killed vitest leaves behind: progress, no summary, no FAIL lines.
    const baseline = await measureBaselineFailures({
      root, repositoryPath: root, head: HEAD, runner: suiteFailing(" ❯ tests/alpha.test.ts 12/4645\n"),
    })
    expect(baseline).toBeNull()
    expect(fs.existsSync(cacheFile(root))).toBe(false)
  })

  it("records a run that named what this host breaks, and answers from it next time", async () => {
    const root = newRoot()
    const output = "FAIL  tests/hermes-app-server-client.test.ts > case\nFAIL  tests/db-connection.test.ts > case\n"
    expect(await measureBaselineFailures({ root, repositoryPath: root, head: HEAD, runner: suiteFailing(output) }))
      .toEqual(["tests/db-connection.test.ts", "tests/hermes-app-server-client.test.ts"])
    expect(JSON.parse(fs.readFileSync(cacheFile(root), "utf8")).measured).toBe(true)
    // Cached, so the second cycle costs nothing -- the runner is never reached.
    expect(await measureBaselineFailures({ root, repositoryPath: root, head: HEAD, runner: never }))
      .toEqual(["tests/db-connection.test.ts", "tests/hermes-app-server-client.test.ts"])
  })

  it("records a suite that genuinely passed, which is a measurement like any other", async () => {
    const root = newRoot()
    expect(await measureBaselineFailures({ root, repositoryPath: root, head: HEAD, runner: suitePassing })).toEqual([])
    expect(JSON.parse(fs.readFileSync(cacheFile(root), "utf8"))).toMatchObject({ measured: true, failing: [] })
  })

  it("remeasures a cached verdict that cannot say it was measured", async () => {
    const root = newRoot()
    // Exactly the shape this host had on disk for four base commits.
    fs.mkdirSync(path.dirname(cacheFile(root)), { recursive: true })
    fs.writeFileSync(cacheFile(root), `${JSON.stringify({ head: HEAD, failing: [], measuredAt: "2026-08-20T02:17:50.323Z" })}\n`)
    expect(await measureBaselineFailures({
      root, repositoryPath: root, head: HEAD, runner: suiteFailing("FAIL  tests/alpha.test.ts > case\n"),
    })).toEqual(["tests/alpha.test.ts"])
  })
})
