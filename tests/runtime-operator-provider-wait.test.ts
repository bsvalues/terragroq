import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { parseCodexRetryAfter } from "../scripts/runtime-operator/williamos-adapters.mjs"
import { runOperationalKernelCycle } from "../scripts/runtime-operator/operational-kernel.mjs"

const REGISTRY = {
  schemaVersion: 1,
  repository: "bsvalues/terragroq",
  workOrders: [
    {
      workOrderId: "WO-TEST",
      adapterId: "williamos-resident-v1",
      authority: "APPROVED",
      riskClass: "R1",
      ownerGateRequired: false,
      protectedScope: false,
      baseBranch: "main",
      mergeMode: "AUTO_ELIGIBLE",
      allowedPaths: ["lib/**"],
      requiredValidation: ["test"],
      dependencies: [],
      task: "test task",
    },
  ],
}

function fakeAdapters(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  return {
    calls,
    adapters: {
      adapterId: "williamos-resident-v1",
      assertRuntime: async () => {},
      listQueue: async () => [{ issueNumber: 890, workOrderId: "WO-TEST", state: "READY", createdAt: "2026-08-19T00:00:00Z" }],
      resolveBaseSha: async () => "a".repeat(40),
      lease: async () => { calls.push("lease") },
      prepareWorkspace: async () => { calls.push("workspace"); return path.join(os.tmpdir(), "wo-test-fake") },
      invokeCodex: async () => { calls.push("dispatch"); throw new Error("CODEX_RATE_LIMIT_WALL:retry-9999999999") },
      ...overrides,
    },
  }
}

let root: string | null = null
afterEach(() => {
  if (root) fs.rmSync(root, { recursive: true, force: true })
  root = null
})

describe("parsing the worker's own retry time", () => {
  it("reads the real codex message, ordinal and all", () => {
    // Written first with the literal message from the night it was observed, which made the test a time
    // bomb: the parser deliberately rejects a refill time that has already passed, so the assertion
    // inverted the moment the wall clock went by. The behaviour under test is the parse, not the date.
    const epoch = parseCodexRetryAfter("ERROR: You've hit your usage limit. Visit x or try again at Dec 31st, 2099 8:33 PM.")
    expect(epoch).not.toBeNull()
    expect(new Date((epoch as number) * 1000).getFullYear()).toBe(2099)
  })

  it("rejects a refill time that has already passed rather than scheduling a wait into the past", () => {
    expect(parseCodexRetryAfter("try again at Aug 19th, 2020 8:33 PM.")).toBeNull()
  })

  it("returns null rather than guessing when there is no time", () => {
    expect(parseCodexRetryAfter("You've hit your usage limit.")).toBeNull()
    expect(parseCodexRetryAfter("try again at half past never.")).toBeNull()
  })
})

describe("a provider wait is not a failure", () => {
  it("parks as WAITING_PROVIDER with the worker's own retry time, attempts untouched", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-wait-"))
    const { adapters } = fakeAdapters()
    const result = await runOperationalKernelCycle({ root, registry: REGISTRY, adapters })
    expect(result.state).toBe("WAITING_PROVIDER")
    expect(result.failureCode).toBe("CODEX_RATE_LIMIT_WALL")
    expect(Date.parse(result.retryAfter)).toBe(9999999999 * 1000)
    expect(result.resumeState).toBe("LEASED")
    expect(result.attempt).toBe(1)
    expect(result.ownerDecisionRequired).toBe(false)
  })

  it("waits quietly while the meter is empty: no redispatch, no attempt burn", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-wait-"))
    const first = fakeAdapters()
    await runOperationalKernelCycle({ root, registry: REGISTRY, adapters: first.adapters })
    const second = fakeAdapters()
    const result = await runOperationalKernelCycle({ root, registry: REGISTRY, adapters: second.adapters })
    expect(result.state).toBe("WAITING_PROVIDER")
    expect(second.calls).toEqual([]) // nothing dispatched, nothing leased, nothing hammered
  })

  it("wakes itself when the retry time passes and redispatches", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-wait-"))
    const first = fakeAdapters({
      invokeCodex: async () => { throw new Error("CODEX_RATE_LIMIT_WALL:retry-1") }, // 1970: already past
    })
    await runOperationalKernelCycle({ root, registry: REGISTRY, adapters: first.adapters })
    const second = fakeAdapters() // parks again with a future time, proving dispatch was re-entered
    const result = await runOperationalKernelCycle({ root, registry: REGISTRY, adapters: second.adapters })
    expect(second.calls).toContain("dispatch")
    expect(result.state).toBe("WAITING_PROVIDER")
    expect(Date.parse(result.retryAfter)).toBe(9999999999 * 1000)
  })

  it("an unparsed limit waits an hour and asks again, rather than guessing or dying", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kernel-wait-"))
    const { adapters } = fakeAdapters({
      invokeCodex: async () => { throw new Error("CODEX_RATE_LIMIT_WALL") },
    })
    const result = await runOperationalKernelCycle({ root, registry: REGISTRY, adapters })
    expect(result.state).toBe("WAITING_PROVIDER")
    const waitMs = Date.parse(result.retryAfter) - Date.now()
    expect(waitMs).toBeGreaterThan(50 * 60 * 1000)
    expect(waitMs).toBeLessThan(70 * 60 * 1000)
  })
})
