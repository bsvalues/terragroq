import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  CrossProviderRoutingReviewError,
  evaluateCrossProviderRoutingReview,
} from "../scripts/multi-agent-operator/cross-provider-routing-review.mjs"
import { CLAUDE_PROVIDER_UNAVAILABLE_ASSESSMENT } from "../scripts/multi-agent-operator/provider-assessment-artifacts.mjs"

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
    dependencySettlement: {
      consumerWorkOrderId: "WO-MAO-034",
      assessmentWorkOrderId: "WO-MAO-032",
      subjectWorkOrderId: "WO-MAO-033",
      lifecycleState: "DEFERRED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      configuredTrust: {
        registryId: "williamos-provider-assessment-pins",
        registryVersion: 1,
      },
      assessment: CLAUDE_PROVIDER_UNAVAILABLE_ASSESSMENT,
    },
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
  it("proves routing only after the consumer-specific unavailable-provider settlement has an authenticated pinned trust record", () => {
    expect(evaluateCrossProviderRoutingReview(input())).toMatchObject({
      status: "CROSS_PROVIDER_ROUTING_REVIEW_PROVEN",
      dependencySettlement: {
        consumerWorkOrderId: "WO-MAO-034",
        assessmentWorkOrderId: "WO-MAO-032",
        subjectWorkOrderId: "WO-MAO-033",
        code: "PROVIDER_UNAVAILABLE_ASSESSMENT_VERIFIED",
        independentlyAuthoritative: true,
        authorityGranted: false,
        dispatchPerformed: false,
      },
      unavailableProviders: [{ providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" }],
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      authorityGranted: false,
    })
    expectWall(() => evaluateCrossProviderRoutingReview(input({
      dependencySettlement: {
        ...input().dependencySettlement,
        configuredTrust: { registryId: "unknown-provider-assessment-pins", registryVersion: 1 },
      },
    })), "CROSS_PROVIDER_SETTLEMENT_WALL")
    expectWall(() => evaluateCrossProviderRoutingReview(input({
      providers: providers({ 0: { secretIsolation: false } }),
    })), "CROSS_PROVIDER_ISOLATION_WALL")
  })

  it("exposes authenticated settlement success through the CLI and keeps bad inputs fail-closed", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cross-provider-routing-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    const historical = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs", inputPath], { encoding: "utf8" })
    expect(historical.status).toBe(0)
    expect(JSON.parse(historical.stdout)).toMatchObject({
      status: "CROSS_PROVIDER_ROUTING_REVIEW_PROVEN",
      dependencySettlement: {
        code: "PROVIDER_UNAVAILABLE_ASSESSMENT_VERIFIED",
      },
      dispatchPerformed: false,
      authorityGranted: false,
    })

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
