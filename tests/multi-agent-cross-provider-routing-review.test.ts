import { spawnSync } from "node:child_process"
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
  it("mechanically invalidates valid and adversarial historical fixtures pending ordered re-proof", () => {
    expectWall(() => evaluateCrossProviderRoutingReview(input()), "CROSS_PROVIDER_ROUTING_INVALIDATED_PENDING_REPROOF")
    expectWall(() => evaluateCrossProviderRoutingReview(input({
      providers: providers({ 0: { secretIsolation: false } }),
    })), "CROSS_PROVIDER_ROUTING_INVALIDATED_PENDING_REPROOF")
  })

  it("exposes only the typed invalidation through the CLI", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cross-provider-routing-"))
    const inputPath = path.join(directory, "input.json")
    const badPath = path.join(directory, "bad.json")
    fs.writeFileSync(inputPath, JSON.stringify(input()))
    fs.writeFileSync(badPath, JSON.stringify({ ...input(), workOrderId: "WO-MAO-999" }))

    const historical = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs", inputPath], { encoding: "utf8" })
    expect(historical.status).toBe(2)
    expect(JSON.parse(historical.stdout)).toMatchObject({
      ok: false,
      code: "CROSS_PROVIDER_ROUTING_INVALIDATED_PENDING_REPROOF",
      dispatchPerformed: false,
      authorityGranted: false,
    })

    const failed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs", badPath], { encoding: "utf8" })
    expect(failed.status).toBe(2)
    expect(JSON.parse(failed.stdout)).toMatchObject({
      ok: false,
      code: "CROSS_PROVIDER_ROUTING_INVALIDATED_PENDING_REPROOF",
      dispatchPerformed: false,
      authorityGranted: false,
    })
    fs.rmSync(directory, { recursive: true, force: true })
  })
})
