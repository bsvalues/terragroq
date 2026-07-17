import { spawnSync } from "node:child_process"
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
  it("mechanically invalidates valid and caller-invented historical health fixtures", () => {
    expectWall(() => evaluateProviderHealthReroute(input()), "PROVIDER_HEALTH_REROUTE_INVALIDATED_PENDING_REPROOF")
    expectWall(() => evaluateProviderHealthReroute(input({
      providers: providers({ 0: { status: "ACTIVE", secretIsolation: false } }),
      observations: observations({ 0: { observedAt: "2000-01-01T00:00:00.000Z" } }),
    })), "PROVIDER_HEALTH_REROUTE_INVALIDATED_PENDING_REPROOF")
  })

  it("exposes only the typed invalidation through the CLI", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "provider-health-reroute-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    for (const target of [inputPath, badPath]) {
      const result = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/provider-health-reroute-cli.mjs", target], { encoding: "utf8" })
      expect(result.status).toBe(2)
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: "PROVIDER_HEALTH_REROUTE_INVALIDATED_PENDING_REPROOF",
        dispatchPerformed: false,
        authorityGranted: false,
      })
    }
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
