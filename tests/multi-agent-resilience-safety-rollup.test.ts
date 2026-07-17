import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE,
  isVerifiedWoMao053ResilienceSafetyRollupEvidence,
} from "@/components/operator/multi-agent-resilience-safety-rollup-registry"
import {
  evaluateResilienceSafetyRollup,
  loadCanonicalResilienceSafetyRollup,
  resilienceSafetyRollupPlanContentHash,
  runCanonicalResilienceSafetyRollup,
  verifyCanonicalResilienceSafetyRollup,
} from "../scripts/multi-agent-operator/resilience-safety-rollup.mjs"

function expectRollupWall(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ name: "ResilienceSafetyRollupError" })
    return
  }
  throw new Error("expected resilience safety rollup wall")
}

const mutate = (mutation: (value: any) => void) => {
  const plan = JSON.parse(JSON.stringify(loadCanonicalResilienceSafetyRollup()))
  mutation(plan)
  return plan
}

describe("WO-MAO-053 resilience and safety rollup", () => {
  it("proves the static Phase 6 rollup without runtime operation", () => {
    const result = runCanonicalResilienceSafetyRollup()

    expect(result).toMatchObject({
      status: "RESILIENCE_SAFETY_ROLLUP_PROVEN",
      workOrderId: "WO-MAO-053",
      planContentHash: "8b2747a827fd13b29051704e430150e9bd2c0883ff460a4d23da9fb3748bfa7f",
      resultHash: "5175604d5d2af4a81eea4006757aa0f7b211b8d17f75acc5ef3899ec5b006cf8",
      dependencyCount: 8,
      resilienceClaimCount: 6,
      safetyClaimCount: 2,
      downstreamWorkOrderId: "WO-MAO-054",
      downstreamState: "READY_AFTER_RESILIENCE_SAFETY_ROLLUP",
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
  })

  it("rejects caller supplied rollup input and pins the canonical plan", () => {
    expectRollupWall(() => evaluateResilienceSafetyRollup())
    expect(verifyCanonicalResilienceSafetyRollup()).toMatchObject({
      ok: true,
      code: "RESILIENCE_SAFETY_ROLLUP_PLAN_VERIFIED",
      contentHash: "8b2747a827fd13b29051704e430150e9bd2c0883ff460a4d23da9fb3748bfa7f",
      providerExecutionPerformed: false,
      githubApiCalled: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(resilienceSafetyRollupPlanContentHash()).toBe("8b2747a827fd13b29051704e430150e9bd2c0883ff460a4d23da9fb3748bfa7f")
  })

  it("fails closed on dependency, claim, downstream, path, secret, authority, and safety mutation", () => {
    for (const changed of [
      mutate((value) => { value.dependencyEvidence.pop() }),
      mutate((value) => { value.resilienceClaims[0].status = "PENDING" }),
      mutate((value) => { value.safetyClaims.push(value.safetyClaims[0]) }),
      mutate((value) => { value.certificationReadiness.downstreamWorkOrderId = "WO-MAO-999" }),
      mutate((value) => { value.changedPaths.push(".obsidian/private.md") }),
      mutate((value) => { value.secretScan.secretLikeFindings = 1 }),
      mutate((value) => { value.authority.certificationAuthorityGranted = true }),
      mutate((value) => { value.safety.githubApiCalled = true }),
    ]) {
      expectRollupWall(() => verifyCanonicalResilienceSafetyRollup(changed))
    }
  })

  it("publishes typed static evidence for the rollup", () => {
    expect(isVerifiedWoMao053ResilienceSafetyRollupEvidence()).toBe(true)
    expect(MULTI_AGENT_RESILIENCE_SAFETY_ROLLUP_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-053-RESILIENCE-SAFETY-ROLLUP-V1",
      workOrderId: "WO-MAO-053",
      completionState: "COMPLETE",
      downstreamWorkOrderId: "WO-MAO-054",
      downstreamState: "READY_AFTER_RESILIENCE_SAFETY_ROLLUP",
      recordContentHash: "ecf035fef1569b44a3ab6e22478e78623ef8b8e416e54410f63cc92190c41f54",
    })
  })
})
