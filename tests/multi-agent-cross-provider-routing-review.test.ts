import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CrossProviderRoutingReviewError,
  evaluateCrossProviderRoutingReview,
} from "../scripts/multi-agent-operator/cross-provider-routing-review.mjs"

function providers(overrides: Record<string, unknown> = {}) {
  const value = [
    {
      providerId: "hosted-codex",
      status: "ACTIVE",
      capabilityIds: ["hosted-codex-coordinator-adapter", "hosted-codex-role-adapters"],
      roles: ["builder", "reviewer", "coordinator"],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
      unavailableReason: null,
    },
    {
      providerId: "claude-code",
      status: "UNAVAILABLE",
      capabilityIds: [],
      roles: [],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
      unavailableReason: "PROVIDER_UNAVAILABLE",
    },
  ]
  for (const [key, child] of Object.entries(overrides)) value[Number(key)] = { ...value[Number(key)], ...(child as Record<string, unknown>) }
  return value
}

function workOrders() {
  return [
    {
      workOrderId: "WO-MAO-034",
      repository: "bsvalues/terragroq",
      requiredRoles: ["builder", "reviewer"],
      preferredProviders: ["hosted-codex"],
      fallbackProviders: ["claude-code"],
    },
  ]
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_INPUT",
    workOrderId: "WO-MAO-034",
    providers: providers(),
    workOrders: workOrders(),
    reviewRequests: [
      {
        requestId: "review-codex-independent",
        workOrderId: "WO-MAO-034",
        subjectProviderId: "hosted-codex",
        reviewerProviderId: "hosted-codex",
        reviewMode: "SAME_PROVIDER_INDEPENDENT_REVIEW",
      },
      {
        requestId: "review-claude-cross-provider",
        workOrderId: "WO-MAO-034",
        subjectProviderId: "hosted-codex",
        reviewerProviderId: "claude-code",
        reviewMode: "CROSS_PROVIDER_REVIEW",
      },
    ],
    ...overrides,
  }
}

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected cross-provider routing wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CrossProviderRoutingReviewError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-034 cross-provider routing and review", () => {
  it("routes only active providers and excludes provider-unavailable Claude", () => {
    const result = evaluateCrossProviderRoutingReview(input())

    expect(result).toMatchObject({
      artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_RESULT",
      workOrderId: "WO-MAO-034",
      status: "CROSS_PROVIDER_ROUTING_REVIEW_PROVEN",
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
    })
    expect(result.routes).toEqual([{
      workOrderId: "WO-MAO-034",
      eligibleProviders: ["hosted-codex"],
      excludedProviders: [
        { providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" },
      ],
    }])
    expect(result.reviewPlan).toEqual([
      expect.objectContaining({ requestId: "review-claude-cross-provider", permitted: false, reasonCode: "PROVIDER_UNAVAILABLE" }),
      expect.objectContaining({ requestId: "review-codex-independent", permitted: true, reasonCode: "REVIEW_ROUTE_PERMITTED" }),
    ])
    expect(result.unavailableProviders).toEqual([{ providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" }])
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(result.routes[0])).toBe(true)
  })

  it("fails closed when provider isolation or secret custody is unsafe", () => {
    expectWall(() => evaluateCrossProviderRoutingReview(input({
      providers: providers({ 0: { secretIsolation: false } }),
    })), "CROSS_PROVIDER_ISOLATION_WALL")
    expectWall(() => evaluateCrossProviderRoutingReview(input({
      providers: providers({ 0: { rawCredentialAccess: true } }),
    })), "CROSS_PROVIDER_SECRET_WALL")
  })

  it("does not permit review-mode substitution", () => {
    const result = evaluateCrossProviderRoutingReview(input({
      reviewRequests: [{
        requestId: "bad-same-provider-mode",
        workOrderId: "WO-MAO-034",
        subjectProviderId: "hosted-codex",
        reviewerProviderId: "hosted-codex",
        reviewMode: "CROSS_PROVIDER_REVIEW",
      }],
    }))

    expect(result.reviewPlan).toEqual([
      expect.objectContaining({ permitted: false, reasonCode: "REVIEW_MODE_MISMATCH" }),
    ])
  })

  it("keeps disabled providers out of route eligibility", () => {
    const result = evaluateCrossProviderRoutingReview(input({
      providers: providers({ 0: { status: "DISABLED", unavailableReason: null } }),
    }))

    expect(result.routes[0].eligibleProviders).toEqual([])
    expect(result.routes[0].excludedProviders).toEqual([
      { providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" },
      { providerId: "hosted-codex", reasonCode: "PROVIDER_DISABLED" },
    ])
  })

  it("exposes deterministic CLI success and typed failure", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cross-provider-routing-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    const output = JSON.parse(execFileSync(process.execPath,
      ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs", inputPath], { encoding: "utf8" }))
    expect(output).toMatchObject({ status: "CROSS_PROVIDER_ROUTING_REVIEW_PROVEN", dispatchPerformed: false })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      code: "CROSS_PROVIDER_INPUT_WALL",
      dispatchPerformed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
