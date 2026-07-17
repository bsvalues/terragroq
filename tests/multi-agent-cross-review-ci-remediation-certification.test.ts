import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao056CrossReviewCiEvidence,
  MULTI_AGENT_CROSS_REVIEW_CI_EVIDENCE,
} from "@/components/operator/multi-agent-cross-review-ci-registry"
import {
  crossReviewCiRemediationCertificationPlanContentHash,
  evaluateCrossReviewCiRemediationCertification,
  loadCanonicalCrossReviewCiRemediationCertification,
  runCanonicalCrossReviewCiRemediationCertification,
  verifyCanonicalCrossReviewCiRemediationCertification,
} from "../scripts/multi-agent-operator/cross-review-ci-remediation-certification.mjs"

function expectCrossReviewCiWall(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ name: "CrossReviewCiRemediationCertificationError" })
    return
  }
  throw new Error("expected cross-review CI remediation certification wall")
}

const mutate = (mutation: (value: any) => void) => {
  const plan = JSON.parse(JSON.stringify(loadCanonicalCrossReviewCiRemediationCertification()))
  mutation(plan)
  return plan
}

describe("WO-MAO-056 cross-review and CI remediation certification", () => {
  it("records one requested-changes cycle, one CI repair cycle, and zero unresolved review threads", () => {
    const result = runCanonicalCrossReviewCiRemediationCertification()

    expect(result).toMatchObject({
      status: "CROSS_REVIEW_CI_REMEDIATION_CERTIFIED",
      workOrderId: "WO-MAO-056",
      planContentHash: "4aec3517faafe914e1a89afa0c4f3e09f1ac6079070f04eb41be870dda237e4b",
      resultHash: "f2789b1c6d46270c8c0576735bbe1126c5ca0f05379806f3c6d0578890e73f8c",
      requestedChangesCycle: "WO-MAO-055-RESERVATION-ACCOUNTING-P2",
      remediationStatus: "REMEDIATED",
      ciRepairStatus: "PASS",
      reviewCycleCount: 1,
      ciRepairCycleCount: 1,
      unresolvedReviewThreadsObserved: 0,
      reservedPathCount: 9,
      changedPathCount: 9,
      foreignChangeCount: 0,
      downstreamWorkOrderId: "WO-MAO-058",
      downstreamState: "WAITING_FOR_WO_MAO_057",
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

  it("rejects caller supplied certification input and pins the canonical plan", () => {
    expectCrossReviewCiWall(() => evaluateCrossReviewCiRemediationCertification())
    expect(verifyCanonicalCrossReviewCiRemediationCertification()).toMatchObject({
      ok: true,
      code: "CROSS_REVIEW_CI_REMEDIATION_CERTIFICATION_PLAN_VERIFIED",
      contentHash: "4aec3517faafe914e1a89afa0c4f3e09f1ac6079070f04eb41be870dda237e4b",
      providerExecutionPerformed: false,
      githubApiCalled: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(crossReviewCiRemediationCertificationPlanContentHash()).toBe("4aec3517faafe914e1a89afa0c4f3e09f1ac6079070f04eb41be870dda237e4b")
  })

  it("fails closed on dependency, review, CI, thread, reservation, secret, authority, and safety mutation", () => {
    for (const changed of [
      mutate((value) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-054" }),
      mutate((value) => { value.reviewCycle.remediationStatus = "OPEN" }),
      mutate((value) => { value.ciRepairCycle.finalRunStatus = "FAILED" }),
      mutate((value) => { value.threadPolicy.unresolvedReviewThreadsObserved = 1 }),
      mutate((value) => { value.changedPaths.push("docs/reports/foreign.md") }),
      mutate((value) => { value.secretScan.secretLikeFindings = 1 }),
      mutate((value) => { value.authority.certificationAuthorityGranted = true }),
      mutate((value) => { value.safety.githubApiCalled = true }),
    ]) {
      expectCrossReviewCiWall(() => verifyCanonicalCrossReviewCiRemediationCertification(changed))
    }
  })

  it("publishes typed static evidence for cross-review and CI remediation certification", () => {
    expect(isVerifiedWoMao056CrossReviewCiEvidence()).toBe(true)
    expect(MULTI_AGENT_CROSS_REVIEW_CI_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-056-CROSS-REVIEW-CI-REMEDIATION-CERTIFICATION-V1",
      workOrderId: "WO-MAO-056",
      completionState: "COMPLETE",
      downstreamWorkOrderId: "WO-MAO-058",
      downstreamState: "WAITING_FOR_WO_MAO_057",
      recordContentHash: "e8414ecf935ef6e14bf135c253cc9c62196a84bfd526d9e05fc15f9ed18fc727",
    })
  })
})
