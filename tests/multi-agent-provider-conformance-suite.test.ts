import { execFileSync, spawnSync } from "node:child_process"
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
  it("records session-only Codex conformance without certifying an executable provider", () => {
    const result = evaluateProviderConformanceSuite(input())

    expect(result).toMatchObject({
      artifactType: "PROVIDER_CONFORMANCE_SUITE_RESULT",
      workOrderId: "WO-MAO-036",
      status: "PROVIDER_CONFORMANCE_SUITE_PROVEN",
      enabledExecutableProviders: [],
      dispatchPerformed: false,
      providerCallPerformed: false,
      executableWorkerCertified: false,
      disabledProviderCertified: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
    })
    expect(result.suite).toEqual([
      expect.objectContaining({
        providerId: "claude-code",
        status: "DEFERRED_PROVIDER_UNAVAILABLE",
        included: false,
        executableWorkerConformant: false,
        reasonCode: "PROVIDER_UNAVAILABLE",
      }),
      expect.objectContaining({
        providerId: "hosted-codex",
        status: "SESSION_ONLY_CONFORMANT",
        included: true,
        executableWorkerConformant: false,
        conformanceCode: "CODEX_PROVIDER_SESSION_ONLY",
        contractCoverage: expect.objectContaining({
          dispatch: "DENIED_BY_CONFORMANCE",
          evidence: "SANITIZED_EVIDENCE_SUPPORTED",
          recovery: "ORIGINAL_BUILDER_REMEDIATION_AND_REVIEW",
        }),
      }),
      expect.objectContaining({
        providerId: "local-nested-codex",
        status: "REJECTED",
        included: false,
        executableWorkerConformant: false,
        reasonCode: "REJECTED_LOCAL_ADAPTER",
      }),
    ])
    expect(result.deferredProviders).toEqual([{ providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" }])
    expect(result.rejectedProviders).toEqual([{ providerId: "local-nested-codex", reasonCode: "REJECTED_LOCAL_ADAPTER" }])
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("rejects contract weakening, executable inflation, and disabled-provider certification", () => {
    expectWall(() => evaluateProviderConformanceSuite(input({
      requiredContracts: ["dispatch", "status"],
    })), "PROVIDER_CONFORMANCE_CONTRACT_WALL")
    expectWall(() => evaluateProviderConformanceSuite(input({
      providers: providers({ 0: { status: "EXECUTABLE_ENABLED" } }),
    })), "PROVIDER_CONFORMANCE_EXECUTABLE_WALL")
    expectWall(() => evaluateProviderConformanceSuite(input({
      providers: providers({ 1: { conformance: codexProviderConformanceFixture() } }),
    })), "PROVIDER_CONFORMANCE_STATUS_WALL")
  })

  it("rejects Codex conformance substitutions instead of certifying a broader surface", () => {
    const conformance = codexProviderConformanceFixture()
    conformance.providerContractDispatchAllowed = true
    expectWall(() => evaluateProviderConformanceSuite(input({
      providers: providers({ 0: { conformance } }),
    })), "PROVIDER_CONFORMANCE_CODEX_WALL")
  })

  it("exposes deterministic CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-conformance-suite-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    const output = JSON.parse(execFileSync(process.execPath,
      ["scripts/multi-agent-operator/provider-conformance-suite-cli.mjs", inputPath], { encoding: "utf8" }))
    expect(output).toMatchObject({ status: "PROVIDER_CONFORMANCE_SUITE_PROVEN", dispatchPerformed: false })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/provider-conformance-suite-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      code: "PROVIDER_CONFORMANCE_INPUT_WALL",
      dispatchPerformed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
