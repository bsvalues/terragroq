import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluateProviderConformanceSuite,
  loadCanonicalProviderConformanceRegistry,
  providerConformanceRegistryContentHash,
  ProviderConformanceSuiteError,
  runCanonicalProviderConformanceSuite,
  verifyCanonicalProviderConformanceRegistry,
} from "../scripts/multi-agent-operator/provider-conformance-suite.mjs"

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
  it("proves the sealed canonical provider conformance suite", () => {
    const result = runCanonicalProviderConformanceSuite()

    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "PROVIDER_CONFORMANCE_SUITE_RESULT",
      workOrderId: "WO-MAO-036",
      status: "PROVIDER_CONFORMANCE_SUITE_PROVEN",
      registryId: "williamos-provider-conformance-suite",
      registryVersion: 1,
      registryContentHash: "cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733",
      readinessBaseCommitSha: "ae25dddb0590c19748dc0af13aebfa60bd080728",
      readinessBaseTreeHash: "97ab235a6f343a6de2fafbb3d406d7bf8b0695e2",
      prerequisiteEvidence: {
        woMao031Complete: true,
        woMao034Complete: true,
        woMao035Complete: true,
        woMao035ResultHash: "678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5",
        woMao035EvidenceHash: "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a",
      },
      enabledExecutableProviders: [],
      deferredProviders: [{ providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" }],
      rejectedProviders: [{ providerId: "local-nested-codex", reasonCode: "REJECTED_LOCAL_ADAPTER" }],
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
      resultHash: "79117c7b2046c673e45b2b6f71f6e229ee7868f907bb7e0dd05024ad737ca1b4",
    })
    expect(result.requiredContracts).toEqual(["cancel", "dispatch", "evidence", "isolation", "recovery", "retry", "status"])
    expect(result.suite.map(({ providerId, status, included, executableWorkerConformant }) => ({
      providerId,
      status,
      included,
      executableWorkerConformant,
    }))).toEqual([
      {
        providerId: "claude-code",
        status: "DEFERRED_PROVIDER_UNAVAILABLE",
        included: false,
        executableWorkerConformant: false,
      },
      {
        providerId: "hosted-codex",
        status: "SESSION_ONLY_CONFORMANT",
        included: true,
        executableWorkerConformant: false,
      },
      {
        providerId: "local-nested-codex",
        status: "REJECTED",
        included: false,
        executableWorkerConformant: false,
      },
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("is stable under exact rerun but rejects caller-invented historical input", () => {
    expect(runCanonicalProviderConformanceSuite()).toEqual(runCanonicalProviderConformanceSuite())
    expectWall(() => evaluateProviderConformanceSuite({
      schemaVersion: 1,
      artifactType: "PROVIDER_CONFORMANCE_SUITE_INPUT",
      workOrderId: "WO-MAO-036",
      providers: [],
      requiredContracts: ["dispatch"],
    }), "PROVIDER_CONFORMANCE_HOST_TRUST_WALL")
  })

  it("pins providers, contracts, prerequisites, conformance material, and safety fields", () => {
    expect(verifyCanonicalProviderConformanceRegistry()).toMatchObject({
      ok: true,
      code: "PROVIDER_CONFORMANCE_REGISTRY_VERIFIED",
      contentHash: "cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733",
      dispatchPerformed: false,
      providerCallPerformed: false,
      executableWorkerCertified: false,
      authorityGranted: false,
    })

    for (const mutate of [
      (value: any) => { value.providers[0].status = "SESSION_ONLY" },
      (value: any) => { value.providers[1].status = "EXECUTABLE_ENABLED" },
      (value: any) => { value.providers[1].conformance.capability.serviceCompatible = true },
      (value: any) => { value.providers[2].deferredReason = "PROVIDER_DISABLED" },
      (value: any) => { value.requiredContracts = ["dispatch"] },
      (value: any) => { value.prerequisiteEvidence.woMao035Complete = false },
      (value: any) => { value.prerequisiteEvidence.woMao035ResultHash = "f".repeat(64) },
      (value: any) => { value.safety.executableWorkerCertified = true },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const registry = structuredClone(loadCanonicalProviderConformanceRegistry())
      mutate(registry)
      expect(providerConformanceRegistryContentHash(registry)).not.toBe("cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733")
      expectWall(() => verifyCanonicalProviderConformanceRegistry(registry), "PROVIDER_CONFORMANCE_REGISTRY_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects every caller argument", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/provider-conformance-suite-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "PROVIDER_CONFORMANCE_SUITE_PROVEN",
      resultHash: "79117c7b2046c673e45b2b6f71f6e229ee7868f907bb7e0dd05024ad737ca1b4",
      dispatchPerformed: false,
      providerCallPerformed: false,
      executableWorkerCertified: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--providers", JSON.stringify({ privateKey: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/provider-conformance-suite-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "PROVIDER_CONFORMANCE_CLI_ARGUMENT_WALL",
        dispatchPerformed: false,
        providerCallPerformed: false,
        executableWorkerCertified: false,
        runtimeActivationAllowed: false,
        authorityGranted: false,
      })
    }
  })
})
