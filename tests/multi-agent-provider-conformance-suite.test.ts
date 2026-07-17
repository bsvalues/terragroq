import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { codexProviderConformanceFixture } from "../scripts/multi-agent-operator/codex-provider-conformance.mjs"
import {
  evaluateProviderConformanceSuite,
  ProviderConformanceSuiteError,
} from "../scripts/multi-agent-operator/provider-conformance-suite.mjs"

const REQUIRED_CONTRACTS = ["dispatch", "status", "cancel", "evidence", "isolation", "retry", "recovery"]

function providers(overrides: Record<string, unknown> = {}) {
  const value = [
    {
      providerId: "hosted-codex",
      status: "SESSION_ONLY",
      kind: "HOSTED_CODEX",
      conformance: codexProviderConformanceFixture(),
      deferredReason: null,
    },
    {
      providerId: "claude-code",
      status: "DEFERRED_PROVIDER_UNAVAILABLE",
      kind: "CLAUDE_CODE",
      conformance: null,
      deferredReason: "PROVIDER_UNAVAILABLE",
    },
    {
      providerId: "local-nested-codex",
      status: "REJECTED",
      kind: "LOCAL_NESTED_CODEX",
      conformance: null,
      deferredReason: "REJECTED_LOCAL_ADAPTER",
    },
  ]
  for (const [key, child] of Object.entries(overrides)) value[Number(key)] = { ...value[Number(key)], ...(child as Record<string, unknown>) }
  return value
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_CONFORMANCE_SUITE_INPUT",
    workOrderId: "WO-MAO-036",
    providers: providers(),
    requiredContracts: REQUIRED_CONTRACTS,
    ...overrides,
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected provider conformance suite wall")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderConformanceSuiteError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-036 provider conformance suite", () => {
  it("mechanically invalidates valid and caller-invented historical conformance fixtures", () => {
    expectWall(() => evaluateProviderConformanceSuite(input()), "PROVIDER_CONFORMANCE_SUITE_INVALIDATED_PENDING_REPROOF")
    expectWall(() => evaluateProviderConformanceSuite(input({
      providers: providers({ 0: { status: "SESSION_ONLY", conformance: codexProviderConformanceFixture() } }),
      requiredContracts: ["dispatch"],
    })), "PROVIDER_CONFORMANCE_SUITE_INVALIDATED_PENDING_REPROOF")
  })

  it("exposes only the typed invalidation through the CLI", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-conformance-suite-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    for (const target of [inputPath, badPath]) {
      const result = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/provider-conformance-suite-cli.mjs", target], { encoding: "utf8" })
      expect(result.status).toBe(2)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: "PROVIDER_CONFORMANCE_SUITE_INVALIDATED_PENDING_REPROOF",
        dispatchPerformed: false,
        authorityGranted: false,
      })
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
