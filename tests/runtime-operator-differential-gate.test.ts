import { describe, expect, it } from "vitest"

import { newlyFailingTests, parseFailingTestFiles } from "../scripts/runtime-operator/williamos-adapters.mjs"

/**
 * A gate must fail a worker for what the worker broke. This host fails 23 tests on pristine main --
 * four files that need live lab hosts and pass on CI's Linux runner -- and gating on the absolute
 * result turned every correct patch into FAILED_TERMINAL.
 */
describe("differential test gate", () => {
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
