import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao057FailureRecoveryEvidence,
  MULTI_AGENT_FAILURE_RECOVERY_EVIDENCE,
} from "@/components/operator/multi-agent-failure-recovery-registry"
import {
  evaluateFailureRecoveryCertification,
  failureRecoveryCertificationPlanContentHash,
  loadCanonicalFailureRecoveryCertification,
  runCanonicalFailureRecoveryCertification,
  verifyCanonicalFailureRecoveryCertification,
} from "../scripts/multi-agent-operator/failure-recovery-certification.mjs"

function expectFailureRecoveryWall(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ name: "FailureRecoveryCertificationError" })
    return
  }
  throw new Error("expected failure recovery certification wall")
}

const mutate = (mutation: (value: any) => void) => {
  const plan = JSON.parse(JSON.stringify(loadCanonicalFailureRecoveryCertification()))
  mutation(plan)
  return plan
}

describe("WO-MAO-057 failure and recovery certification", () => {
  it("certifies five recorded failure classes without live injection or owner operation", () => {
    const result = runCanonicalFailureRecoveryCertification()

    expect(result).toMatchObject({
      status: "FAILURE_RECOVERY_CERTIFIED",
      workOrderId: "WO-MAO-057",
      planContentHash: "3506c0188d0c3f50bdb3f184fa39f1a37c341f3926c4b578f833d94969f03dd4",
      resultHash: "362ebba45121ce3be1b66ebab5179737d1d1932bc919b0d0196d28c09249f9cf",
      dependencyCount: 5,
      failureInjectionCount: 5,
      recoveryGateCount: 5,
      ownerOperationRequiredCount: 0,
      reservedPathCount: 16,
      changedPathCount: 16,
      foreignChangeCount: 0,
      downstreamWorkOrderId: "WO-MAO-058",
      downstreamState: "READY_AFTER_FAILURE_RECOVERY_CERTIFICATION",
      schedulerAdded: false,
      liveInjectionPerformed: false,
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
    expect(result.certifiedInjectionClasses).toEqual([
      "COORDINATOR_RESTART",
      "PROVIDER_NETWORK_FAILURE",
      "RESERVATION_COLLISION",
      "STALE_BASE_EVENT",
      "WORKER_DEATH",
    ])
  })

  it("rejects caller supplied certification input and pins the canonical plan", () => {
    expectFailureRecoveryWall(() => evaluateFailureRecoveryCertification())
    expect(verifyCanonicalFailureRecoveryCertification()).toMatchObject({
      ok: true,
      code: "FAILURE_RECOVERY_CERTIFICATION_PLAN_VERIFIED",
      contentHash: "3506c0188d0c3f50bdb3f184fa39f1a37c341f3926c4b578f833d94969f03dd4",
      liveInjectionPerformed: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(failureRecoveryCertificationPlanContentHash()).toBe("3506c0188d0c3f50bdb3f184fa39f1a37c341f3926c4b578f833d94969f03dd4")
  })

  it("fails closed on dependency, injection, recovery gate, reservation, secret, authority, and safety mutation", () => {
    for (const changed of [
      mutate((value) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-046" }),
      mutate((value) => { value.failureInjections.pop() }),
      mutate((value) => { value.failureInjections[0].ownerOperationRequired = true }),
      mutate((value) => { value.recoveryGates.zeroOwnerTouchRequired = false }),
      mutate((value) => { value.changedPaths.push("docs/reports/foreign.md") }),
      mutate((value) => { value.secretScan.secretLikeFindings = 1 }),
      mutate((value) => { value.authority.certificationAuthorityGranted = true }),
      mutate((value) => { value.safety.liveInjectionPerformed = true }),
    ]) {
      expectFailureRecoveryWall(() => verifyCanonicalFailureRecoveryCertification(changed))
    }
  })

  it("publishes typed static evidence for failure and recovery certification", () => {
    expect(isVerifiedWoMao057FailureRecoveryEvidence()).toBe(true)
    expect(MULTI_AGENT_FAILURE_RECOVERY_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-057-FAILURE-RECOVERY-CERTIFICATION-V1",
      workOrderId: "WO-MAO-057",
      completionState: "COMPLETE",
      downstreamWorkOrderId: "WO-MAO-058",
      downstreamState: "READY_AFTER_FAILURE_RECOVERY_CERTIFICATION",
      recordContentHash: "9e2cebd1a6b75fb0cc36151f4a58efe80a88d283a65bbe495428da4693290a36",
    })
  })
})
