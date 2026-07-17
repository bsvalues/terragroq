import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluateProviderHealthReroute,
  loadCanonicalProviderHealthRerouteRegistry,
  providerHealthRerouteRegistryContentHash,
  ProviderHealthRerouteError,
  runCanonicalProviderHealthReroute,
  verifyCanonicalProviderHealthRerouteRegistry,
} from "../scripts/multi-agent-operator/provider-health-reroute.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected provider health wall")
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderHealthRerouteError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-035 provider health, circuit breakers, and reroute", () => {
  it("proves the sealed canonical provider health and reroute registry", () => {
    const result = runCanonicalProviderHealthReroute()

    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "PROVIDER_HEALTH_REROUTE_RESULT",
      workOrderId: "WO-MAO-035",
      status: "PROVIDER_HEALTH_REROUTE_PROVEN",
      registryId: "williamos-provider-health-reroute",
      registryVersion: 1,
      registryContentHash: "50033dc24bc289342f6c7dfd447a2a8c62bd7fb4436e18b18127543590956cc3",
      readinessBaseCommitSha: "726fb9a3d396c1500aed6c60092d9ea4756c6ad5",
      readinessBaseTreeHash: "616ee350063efcedfa7ac7ddf01a6c8df24e8391",
      reroutes: [
        {
          requestId: "reroute-wo-mao-035-hosted-codex-to-secondary-v1",
          workOrderId: "WO-MAO-035",
          fromProviderId: "hosted-codex",
          selectedFallbackProviders: ["hosted-codex-secondary"],
          permitted: true,
          reasonCode: "REROUTE_PERMITTED",
        },
      ],
      circuitBreakers: [
        {
          transitionId: "breaker-wo-mao-035-hosted-codex-backoff-v1",
          providerId: "hosted-codex",
          fromState: "ACTIVE",
          toState: "BACKOFF",
          observationId: "obs-wo-mao-035-hosted-codex-rate-limit-v1",
          reasonCode: "RATE_LIMITED",
        },
      ],
      deferredProviders: [
        {
          providerId: "claude-code",
          reasonCode: "PROVIDER_UNAVAILABLE",
        },
      ],
      dispatchPerformed: false,
      providerCallPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
      resultHash: "678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5",
    })
    expect(result.health.map(({ providerId, state, reasonCode }) => ({ providerId, state, reasonCode }))).toEqual([
      { providerId: "claude-code", state: "UNAVAILABLE", reasonCode: "PROVIDER_UNAVAILABLE" },
      { providerId: "hosted-codex", state: "BACKOFF", reasonCode: "RATE_LIMITED" },
      { providerId: "hosted-codex-secondary", state: "ACTIVE", reasonCode: "HEALTHY" },
    ])
    expect(Object.isFrozen(result)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|session/i)
  })

  it("is stable under exact rerun but rejects caller-invented historical input", () => {
    expect(runCanonicalProviderHealthReroute()).toEqual(runCanonicalProviderHealthReroute())
    expectWall(() => evaluateProviderHealthReroute({
      schemaVersion: 1,
      artifactType: "PROVIDER_HEALTH_REROUTE_INPUT",
      workOrderId: "WO-MAO-035",
      providers: [],
      observations: [],
      rerouteRequests: [],
      budgets: { maxRetryDelayMs: 0, maxReroutesPerWorkOrder: 0 },
    }), "PROVIDER_HEALTH_HOST_TRUST_WALL")
  })

  it("pins provider, observation, breaker, reroute, budget, and safety fields", () => {
    expect(verifyCanonicalProviderHealthRerouteRegistry()).toMatchObject({
      ok: true,
      code: "PROVIDER_HEALTH_REGISTRY_VERIFIED",
      contentHash: "50033dc24bc289342f6c7dfd447a2a8c62bd7fb4436e18b18127543590956cc3",
      dispatchPerformed: false,
      providerCallPerformed: false,
      authorityGranted: false,
    })

    for (const mutate of [
      (value: any) => { value.providers[0].status = "ACTIVE" },
      (value: any) => { value.providers[1].repositories = ["attacker/repository"] },
      (value: any) => { value.providers[1].rawCredentialAccess = true },
      (value: any) => { value.trustedObservations[0].observedAt = "2000-01-01T00:00:00.000Z" },
      (value: any) => { value.trustedObservations[0].providerId = "hosted-codex-secondary" },
      (value: any) => { value.circuitBreakerLedger[0].statefulTransition = false },
      (value: any) => { value.circuitBreakerLedger[0].toState = "QUARANTINED" },
      (value: any) => { value.rerouteRequests[0].fallbackProviders = ["claude-code"] },
      (value: any) => { value.budgets.maxReroutesPerWorkOrder = 2 },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const registry = structuredClone(loadCanonicalProviderHealthRerouteRegistry())
      mutate(registry)
      expect(providerHealthRerouteRegistryContentHash(registry)).not.toBe("50033dc24bc289342f6c7dfd447a2a8c62bd7fb4436e18b18127543590956cc3")
      expectWall(() => verifyCanonicalProviderHealthRerouteRegistry(registry), "PROVIDER_HEALTH_REGISTRY_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects every caller argument", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/provider-health-reroute-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "PROVIDER_HEALTH_REROUTE_PROVEN",
      resultHash: "678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5",
      dispatchPerformed: false,
      providerCallPerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--providers", JSON.stringify({ privateKey: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/provider-health-reroute-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "PROVIDER_HEALTH_CLI_ARGUMENT_WALL",
        dispatchPerformed: false,
        providerCallPerformed: false,
        runtimeActivationAllowed: false,
        authorityGranted: false,
      })
    }
  })
})
