import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_CONCURRENT_CERTIFICATION_EVIDENCE,
  isVerifiedWoMao055ConcurrentCertificationEvidence,
} from "@/components/operator/multi-agent-concurrent-certification-registry"
import {
  concurrentCertificationLanesPlanContentHash,
  evaluateConcurrentCertificationLanes,
  loadCanonicalConcurrentCertificationLanes,
  runCanonicalConcurrentCertificationLanes,
  verifyCanonicalConcurrentCertificationLanes,
} from "../scripts/multi-agent-operator/concurrent-certification-lanes.mjs"

function expectConcurrentWall(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ name: "ConcurrentCertificationLanesError" })
    return
  }
  throw new Error("expected concurrent certification wall")
}

const mutate = (mutation: (value: any) => void) => {
  const plan = JSON.parse(JSON.stringify(loadCanonicalConcurrentCertificationLanes()))
  mutation(plan)
  return plan
}

describe("WO-MAO-055 concurrent certification lanes", () => {
  it("records two independent static useful lanes and a fan-in projection", () => {
    const result = runCanonicalConcurrentCertificationLanes()

    expect(result).toMatchObject({
      status: "CONCURRENT_CERTIFICATION_LANES_EXECUTED",
      workOrderId: "WO-MAO-055",
      planContentHash: "c19174545641b5c7e5381990a83639b40dffadf941e78073e27ba572c36f9cf5",
      resultHash: "f5a7384ad6ed27b57d5d83339528a02289e88f1b3037f49ede9a586c39ac5b5f",
      builderLaneCount: 2,
      fanInProjectionCount: 1,
      providerExclusionCount: 1,
      downstreamState: "READY_AFTER_CONCURRENT_CERTIFICATION_LANES",
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      stateMutationPerformed: false,
      productionWritePerformed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(result.builderLaneIds).toEqual(["codex-devex-hook-tooling-foundation", "codex-release-engineering-foundation"])
    expect(result.downstreamWorkOrders).toEqual(["WO-MAO-056", "WO-MAO-057"])
  })

  it("rejects caller supplied execution input and pins the canonical plan", () => {
    expectConcurrentWall(() => evaluateConcurrentCertificationLanes())
    expect(verifyCanonicalConcurrentCertificationLanes()).toMatchObject({
      ok: true,
      code: "CONCURRENT_CERTIFICATION_LANES_PLAN_VERIFIED",
      contentHash: "c19174545641b5c7e5381990a83639b40dffadf941e78073e27ba572c36f9cf5",
      providerExecutionPerformed: false,
      githubApiCalled: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(concurrentCertificationLanesPlanContentHash()).toBe("c19174545641b5c7e5381990a83639b40dffadf941e78073e27ba572c36f9cf5")
  })

  it("fails closed on dependency, lane, reservation, fan-in, provider, secret, authority, and safety mutation", () => {
    for (const changed of [
      mutate((value) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-053" }),
      mutate((value) => { value.builderLanes.pop() }),
      mutate((value) => { value.builderLanes[1].reservation = value.builderLanes[0].reservation }),
      mutate((value) => { value.fanInProjection.dependsOn = ["codex-release-engineering-foundation"] }),
      mutate((value) => { value.providerExclusions[0].selected = true }),
      mutate((value) => { value.secretScan.secretLikeFindings = 1 }),
      mutate((value) => { value.authority.certificationAuthorityGranted = true }),
      mutate((value) => { value.safety.githubApiCalled = true }),
    ]) {
      expectConcurrentWall(() => verifyCanonicalConcurrentCertificationLanes(changed))
    }
  })

  it("publishes typed static evidence for concurrent certification execution", () => {
    expect(isVerifiedWoMao055ConcurrentCertificationEvidence()).toBe(true)
    expect(MULTI_AGENT_CONCURRENT_CERTIFICATION_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-055-CONCURRENT-CERTIFICATION-LANES-V1",
      workOrderId: "WO-MAO-055",
      builderLaneCount: 2,
      fanInProjectionCount: 1,
      completionState: "COMPLETE",
      downstreamWorkOrders: ["WO-MAO-056", "WO-MAO-057"],
      downstreamState: "READY_AFTER_CONCURRENT_CERTIFICATION_LANES",
      recordContentHash: "6ea76942424ac149536ec81f299477b133d07a7af151cd1fa694ba0ea393350e",
    })
  })
})
