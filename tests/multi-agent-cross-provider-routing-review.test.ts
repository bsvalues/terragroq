import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  CrossProviderRoutingReviewError,
  evaluateCrossProviderRoutingReview,
  runCanonicalCrossProviderRoutingReview,
} from "../scripts/multi-agent-operator/cross-provider-routing-review.mjs"
import {
  loadCanonicalCrossProviderRoutingReviewRegistry,
  verifyCanonicalCrossProviderRoutingReviewRegistry,
} from "../scripts/multi-agent-operator/cross-provider-routing-review-registry.mjs"
import {
  loadCanonicalWoMao034ProviderUnavailableAssessment,
} from "../scripts/multi-agent-operator/provider-unavailable-settlement.mjs"

function canonicalRawInput() {
  const registry = loadCanonicalCrossProviderRoutingReviewRegistry()
  return {
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_INPUT",
    workOrderId: "WO-MAO-034",
    providers: structuredClone(registry.providers),
    workOrders: structuredClone(registry.workOrders),
    reviewRequests: structuredClone(registry.reviewRequests),
    dependencySettlement: {
      consumerWorkOrderId: "WO-MAO-034",
      assessmentWorkOrderId: "WO-MAO-032",
      subjectWorkOrderId: "WO-MAO-033",
      lifecycleState: "DEFERRED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      configuredTrust: {
        registryId: "williamos-provider-assessment-pins",
        registryVersion: 2,
      },
      assessment: structuredClone(loadCanonicalWoMao034ProviderUnavailableAssessment()),
    },
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

function expectRegistryWall(mutate: (value: any) => void) {
  const value = structuredClone(loadCanonicalCrossProviderRoutingReviewRegistry())
  mutate(value)
  expect(() => verifyCanonicalCrossProviderRoutingReviewRegistry(value))
    .toThrow("CROSS_PROVIDER_ROUTING_REGISTRY_INTEGRITY_WALL")
}

describe("WO-MAO-034 canonical cross-provider routing and review", () => {
  it("proves hosted Codex routing and a distinct logical same-provider review route", () => {
    const result = runCanonicalCrossProviderRoutingReview()
    expect(result).toMatchObject({
      status: "CANONICAL_ROUTING_ROUTE_PROVEN_PENDING_EXTERNAL_ASSURANCE",
      workOrderId: "WO-MAO-034",
      routes: [{
        workOrderId: "WO-MAO-034",
        eligibleProviders: ["hosted-codex"],
        excludedProviders: [{ providerId: "claude-code", reasonCode: "PROVIDER_UNAVAILABLE" }],
      }],
      reviewPlan: [
        {
          requestId: "review-claude-cross-provider",
          reviewerProviderId: "claude-code",
          permitted: false,
          reasonCode: "PROVIDER_UNAVAILABLE",
        },
        {
          requestId: "review-codex-independent",
          subjectProviderId: "hosted-codex",
          subjectAssignmentId: "assignment-wo-mao-034-builder",
          subjectRole: "builder",
          reviewerProviderId: "hosted-codex",
          reviewerAssignmentId: "assignment-wo-mao-034-reviewer",
          reviewerRole: "reviewer",
          reviewMode: "SAME_PROVIDER_INDEPENDENT_REVIEW",
          permitted: true,
          reasonCode: "REVIEW_ROUTE_PERMITTED",
        },
      ],
      dependencySettlement: {
        consumerWorkOrderId: "WO-MAO-034",
        assessmentWorkOrderId: "WO-MAO-032",
        subjectWorkOrderId: "WO-MAO-033",
        code: "PROVIDER_UNAVAILABLE_ASSESSMENT_VERIFIED",
        independentlyAuthoritative: true,
      },
      registryProvenance: {
        registryContentHash: "d83af5f3792225d5127e6dc024eb606b66961360967a9ab0c7069054af2dfb65",
        readinessBaseCommitSha: "6cf94e9dcd1c482fdf5f0df74747c69b85ec7898",
        readinessBaseTreeHash: "3fa0578ac7a0819a4fa8ab89398b63682d466e64",
        settlementResultHash: "a1a3ee8742c14dcd458ce28d12d1a392d25d605018f074dc0ebe4855f62b11f9",
      },
      routingEvidence: {
        logicalRouteRoleSeparationProven: true,
        hostNativeBindingClaimed: false,
        externalImplementationAssuranceRequired: true,
        routingEvaluationProven: true,
        sameProviderIndependentReviewRouteProven: true,
      },
      workOrderProjection: {
        workOrderId: "WO-MAO-034",
        state: "READY_PENDING_EXTERNAL_IMPLEMENTATION_ASSURANCE",
        dependencyWorkOrderId: "WO-MAO-033",
        dependencyState: "DEFERRED_PROVIDER_UNAVAILABLE",
        downstreamWorkOrderId: "WO-MAO-035",
        downstreamState: "PENDING",
        downstreamDependencyWaived: false,
      },
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
      secretsExposed: false,
      ownerRelayRequired: false,
      hostNativeBindingClaimed: false,
      implementationAssuranceClaimed: false,
    })
    expect(result.resultHash).toBe("e91e943a989403d93a9aaf52ff99bf63cab73dc9a7b3c855ef7a7a5211a33da3")
    expect(Object.values(result.ownerOperationCounters)).toEqual([0, 0, 0, 0, 0])
    expect(JSON.stringify(result)).not.toMatch(/privateKey|accessToken|rawCredential|publicKeyPem|signature|nativeWorkerId|sessionId/i)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.reviewPlan)).toBe(true)
  })

  it("is stable under exact rerun but rejects serialized or caller-manufactured replay", () => {
    const first = runCanonicalCrossProviderRoutingReview()
    const second = runCanonicalCrossProviderRoutingReview()
    expect(second).toEqual(first)
    expectWall(() => evaluateCrossProviderRoutingReview(canonicalRawInput()), "CROSS_PROVIDER_HOST_TRUST_WALL")
    expectWall(() => evaluateCrossProviderRoutingReview(JSON.parse(JSON.stringify(canonicalRawInput()))), "CROSS_PROVIDER_HOST_TRUST_WALL")
  })

  it("rejects provider, work-order, review, isolation, secret, and settlement substitution", () => {
    const provider = canonicalRawInput()
    provider.providers.push({
      ...provider.providers[1],
      providerId: "evil-provider",
    })
    expectWall(() => evaluateCrossProviderRoutingReview(provider), "CROSS_PROVIDER_HOST_TRUST_WALL")

    const workOrder = canonicalRawInput()
    workOrder.workOrders[0].repository = "attacker/repository"
    expectWall(() => evaluateCrossProviderRoutingReview(workOrder), "CROSS_PROVIDER_HOST_TRUST_WALL")

    const review = canonicalRawInput()
    review.reviewRequests[1].reviewerAssignmentId = review.reviewRequests[1].subjectAssignmentId
    expectWall(() => evaluateCrossProviderRoutingReview(review), "CROSS_PROVIDER_REVIEW_WALL")

    const isolation = canonicalRawInput()
    isolation.providers[1].workspaceIsolation = false
    expectWall(() => evaluateCrossProviderRoutingReview(isolation), "CROSS_PROVIDER_ISOLATION_WALL")

    const secret = canonicalRawInput()
    secret.providers[1].rawCredentialAccess = true
    expectWall(() => evaluateCrossProviderRoutingReview(secret), "CROSS_PROVIDER_SECRET_WALL")

    for (const mutation of [
      { consumerWorkOrderId: "WO-MAO-035" },
      { lifecycleState: "COMPLETE" },
      { reasonCode: "OTHER_DEFER" },
    ]) {
      const settlement = canonicalRawInput()
      Object.assign(settlement.dependencySettlement, mutation)
      expectWall(() => evaluateCrossProviderRoutingReview(settlement), "CROSS_PROVIDER_SETTLEMENT_WALL")
    }
  })

  it("pins every registry-controlled route, role, candidate, and nonclaim", () => {
    for (const mutate of [
      (value: any) => { value.providers[0].status = "DISABLED" },
      (value: any) => { value.providers[1].repositories = ["attacker/repository"] },
      (value: any) => { value.providers[1].rawCredentialAccess = true },
      (value: any) => { value.workOrders[0].workOrderId = "WO-MAO-035" },
      (value: any) => { value.reviewRequests[1].reviewerAssignmentId = value.reviewRequests[1].subjectAssignmentId },
      (value: any) => { value.routingEvidence.reviewerRole.logicalWorkerId = value.routingEvidence.builderRole.logicalWorkerId },
      (value: any) => { value.routingEvidence.reviewerRole.readOnly = false },
      (value: any) => { value.routingEvidence.candidate.consumerEnvelopeHash = "f".repeat(64) },
      (value: any) => { value.routingEvidence.candidate.settlementResultHash = "f".repeat(64) },
      (value: any) => { value.routingEvidence.candidate.readinessBaseCommitSha = "f".repeat(40) },
      (value: any) => { value.routingEvidence.hostNativeBindingClaimed = true },
      (value: any) => { value.routingEvidence.providerDispatchPerformed = true },
      (value: any) => { value.routingEvidence.githubAutomationPerformed = true },
      (value: any) => { delete value.providers[0].unavailableReason },
      (value: any) => { value.providers[0].unexpected = true },
      (value: any) => { value.providers.push(structuredClone(value.providers[0])) },
      (value: any) => { value.reviewRequests.push(structuredClone(value.reviewRequests[0])) },
      (value: any) => { value.unexpected = true },
    ]) expectRegistryWall(mutate)
  })

  it("exposes only the zero-input CLI and rejects every caller argument", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "CANONICAL_ROUTING_ROUTE_PROVEN_PENDING_EXTERNAL_ASSURANCE",
      resultHash: "e91e943a989403d93a9aaf52ff99bf63cab73dc9a7b3c855ef7a7a5211a33da3",
      dispatchPerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--providers", JSON.stringify({ privateKey: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/cross-provider-routing-review-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "CROSS_PROVIDER_CLI_ARGUMENT_WALL",
        dispatchPerformed: false,
        runtimeActivationAllowed: false,
        authorityGranted: false,
      })
    }
  })
})
