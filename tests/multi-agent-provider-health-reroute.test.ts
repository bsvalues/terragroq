import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  evaluateProviderHealthReroute,
  ProviderHealthRerouteError,
} from "../scripts/multi-agent-operator/provider-health-reroute.mjs"

function providers(overrides: Record<string, unknown> = {}) {
  const value = [
    {
      providerId: "hosted-codex",
      status: "ACTIVE",
      roles: ["builder", "reviewer", "coordinator"],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
    },
    {
      providerId: "hosted-codex-secondary",
      status: "ACTIVE",
      roles: ["builder", "reviewer"],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
    },
    {
      providerId: "claude-code",
      status: "UNAVAILABLE",
      roles: [],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
    },
  ]
  for (const [key, child] of Object.entries(overrides)) value[Number(key)] = { ...value[Number(key)], ...(child as Record<string, unknown>) }
  return value
}

function observations(overrides: Record<string, unknown> = {}) {
  const value = [
    {
      observationId: "obs-rate-limit",
      providerId: "hosted-codex",
      kind: "HTTP",
      httpStatus: 429,
      reasonCode: "RATE_LIMITED",
      observedAt: "2026-07-16T22:00:00.000Z",
      retryAfterMs: 120000,
      deterministic: false,
    },
  ]
  for (const [key, child] of Object.entries(overrides)) value[Number(key)] = { ...value[Number(key)], ...(child as Record<string, unknown>) }
  return value
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "PROVIDER_HEALTH_REROUTE_INPUT",
    workOrderId: "WO-MAO-035",
    providers: providers(),
    observations: observations(),
    rerouteRequests: [
      {
        requestId: "reroute-hosted-codex",
        workOrderId: "WO-MAO-035",
        repository: "bsvalues/terragroq",
        requiredRoles: ["builder", "reviewer"],
        fromProviderId: "hosted-codex",
        fallbackProviders: ["hosted-codex-secondary", "claude-code"],
      },
    ],
    budgets: {
      maxRetryDelayMs: 60000,
      maxReroutesPerWorkOrder: 1,
    },
    ...overrides,
  }
}

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
  it("classifies rate limits, opens bounded backoff, and reroutes to a healthy fallback", () => {
    const result = evaluateProviderHealthReroute(input())

    expect(result).toMatchObject({
      artifactType: "PROVIDER_HEALTH_REROUTE_RESULT",
      workOrderId: "WO-MAO-035",
      status: "PROVIDER_HEALTH_REROUTE_PROVEN",
      dispatchPerformed: false,
      providerCallPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
    })
    expect(result.health).toEqual([
      expect.objectContaining({ providerId: "claude-code", state: "UNAVAILABLE", reasonCode: "PROVIDER_UNAVAILABLE" }),
      expect.objectContaining({ providerId: "hosted-codex", state: "BACKOFF", reasonCode: "RATE_LIMITED", retryAfterMs: 60000 }),
      expect.objectContaining({ providerId: "hosted-codex-secondary", state: "ACTIVE", reasonCode: "HEALTHY" }),
    ])
    expect(result.reroutes).toEqual([{
      requestId: "reroute-hosted-codex",
      workOrderId: "WO-MAO-035",
      fromProviderId: "hosted-codex",
      selectedFallbackProviders: ["hosted-codex-secondary"],
      permitted: true,
      reasonCode: "REROUTE_PERMITTED",
    }])
    expect(result.deferredProviders).toEqual([{ providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" }])
    expect(result.circuitBreakers).toEqual([{
      providerId: "hosted-codex",
      state: "BACKOFF",
      reasonCode: "RATE_LIMITED",
      retryAfterMs: 60000,
    }])
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it("quarantines authorization, malformed output, and deterministic failures", () => {
    expect(evaluateProviderHealthReroute(input({
      observations: observations({ 0: { httpStatus: 403, reasonCode: "AUTHORIZATION_WALL", retryAfterMs: null } }),
    }))).toMatchObject({
      health: expect.arrayContaining([expect.objectContaining({ providerId: "hosted-codex", state: "QUARANTINED", reasonCode: "AUTHORIZATION_WALL" })]),
    })
    expect(evaluateProviderHealthReroute(input({
      observations: observations({ 0: { kind: "MALFORMED_OUTPUT", httpStatus: null, reasonCode: "MALFORMED_OUTPUT", retryAfterMs: null } }),
    }))).toMatchObject({
      health: expect.arrayContaining([expect.objectContaining({ providerId: "hosted-codex", state: "QUARANTINED", reasonCode: "MALFORMED_OUTPUT" })]),
    })
    expect(evaluateProviderHealthReroute(input({
      observations: observations({ 0: { kind: "DETERMINISTIC_FAILURE", httpStatus: null, reasonCode: "DETERMINISTIC_FAILURE", retryAfterMs: null, deterministic: true } }),
    }))).toMatchObject({
      health: expect.arrayContaining([expect.objectContaining({ providerId: "hosted-codex", state: "QUARANTINED", reasonCode: "DETERMINISTIC_FAILURE", rerouteAllowed: false })]),
      reroutes: [expect.objectContaining({ permitted: false, reasonCode: "DETERMINISTIC_FAILURE" })],
    })
  })

  it("fails closed on unsafe isolation, raw credential custody, and unknown observation providers", () => {
    expectWall(() => evaluateProviderHealthReroute(input({
      providers: providers({ 0: { workspaceIsolation: false } }),
    })), "PROVIDER_HEALTH_ISOLATION_WALL")
    expectWall(() => evaluateProviderHealthReroute(input({
      providers: providers({ 0: { rawCredentialAccess: true } }),
    })), "PROVIDER_HEALTH_SECRET_WALL")
    expectWall(() => evaluateProviderHealthReroute(input({
      observations: observations({ 0: { providerId: "missing-provider" } }),
    })), "PROVIDER_HEALTH_OBSERVATION_WALL")
  })

  it("refuses to use unavailable or disabled providers as reroute fallback", () => {
    const result = evaluateProviderHealthReroute(input({
      providers: providers({ 1: { status: "DISABLED" } }),
    }))

    expect(result.reroutes).toEqual([expect.objectContaining({
      selectedFallbackProviders: [],
      permitted: false,
      reasonCode: "NO_HEALTHY_FALLBACK_PROVIDER",
    })])
  })

  it("exposes deterministic CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-health-reroute-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    const output = JSON.parse(execFileSync(process.execPath,
      ["scripts/multi-agent-operator/provider-health-reroute-cli.mjs", inputPath], { encoding: "utf8" }))
    expect(output).toMatchObject({ status: "PROVIDER_HEALTH_REROUTE_PROVEN", dispatchPerformed: false })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/provider-health-reroute-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      code: "PROVIDER_HEALTH_INPUT_WALL",
      dispatchPerformed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
