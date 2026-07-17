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
      planContentHash: "d2f44190ca117bfc9ec34fbbac0fbe73ae656fcd17f835f4f07c0a22906c5e51",
      resultHash: "baf46e6cd6073255fc5a33ac5955a36924cfe708c6e12c87e292a552f810da49",
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
      contentHash: "d2f44190ca117bfc9ec34fbbac0fbe73ae656fcd17f835f4f07c0a22906c5e51",
      providerExecutionPerformed: false,
      githubApiCalled: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(concurrentCertificationLanesPlanContentHash()).toBe("d2f44190ca117bfc9ec34fbbac0fbe73ae656fcd17f835f4f07c0a22906c5e51")
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
      recordContentHash: "2c913d5b131da494fc31951b68ba7b0dd79fcf877ee923679833da3af90f49f3",
    })
    expect(MULTI_AGENT_CONCURRENT_CERTIFICATION_EVIDENCE).toMatchObject({
      reservedPathCount: 18,
      changedPathCount: 18,
      foreignChangeCount: 0,
    })
  })
})
