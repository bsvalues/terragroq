import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_CERTIFICATION_PORTFOLIO_EVIDENCE,
  isVerifiedWoMao054CertificationPortfolioEvidence,
} from "@/components/operator/multi-agent-certification-portfolio-registry"
import {
  certificationPortfolioSelectionPlanContentHash,
  evaluateCertificationPortfolioSelection,
  loadCanonicalCertificationPortfolioSelection,
  runCanonicalCertificationPortfolioSelection,
  verifyCanonicalCertificationPortfolioSelection,
} from "../scripts/multi-agent-operator/certification-portfolio-selection.mjs"

function expectSelectionWall(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ name: "CertificationPortfolioSelectionError" })
    return
  }
  throw new Error("expected certification portfolio selection wall")
}

const mutate = (mutation: (value: any) => void) => {
  const plan = JSON.parse(JSON.stringify(loadCanonicalCertificationPortfolioSelection()))
  mutation(plan)
  return plan
}

describe("WO-MAO-054 certification portfolio selection", () => {
  it("selects useful Codex lanes, a fan-in lane, and excludes unavailable Claude", () => {
    const result = runCanonicalCertificationPortfolioSelection()

    expect(result).toMatchObject({
      status: "CERTIFICATION_PORTFOLIO_SELECTED",
      workOrderId: "WO-MAO-054",
      planContentHash: "f8703c81c3f904fdafd76e93122a895c12652a332c83ed3328bb2bceb7632e78",
      resultHash: "7a7344c51fb1f3051bd2c155a6c9110c2887975e368b55ec78103788da520396",
      selectedLaneCount: 2,
      fanInLaneCount: 1,
      providerExclusionCount: 1,
      downstreamWorkOrderId: "WO-MAO-055",
      downstreamState: "READY_AFTER_CERTIFICATION_PORTFOLIO_SELECTION",
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
    expect(result.selectedProgramIds).toEqual(["PROGRAM-DEVEX-HOOK-TOOLING-001", "PROGRAM-RELEASE-ENGINEERING-001"])
    expect(result.excludedProviders).toEqual(["CLAUDE_CODE"])
  })

  it("rejects caller supplied selection input and pins the canonical plan", () => {
    expectSelectionWall(() => evaluateCertificationPortfolioSelection())
    expect(verifyCanonicalCertificationPortfolioSelection()).toMatchObject({
      ok: true,
      code: "CERTIFICATION_PORTFOLIO_SELECTION_PLAN_VERIFIED",
      contentHash: "f8703c81c3f904fdafd76e93122a895c12652a332c83ed3328bb2bceb7632e78",
      providerExecutionPerformed: false,
      githubApiCalled: false,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(certificationPortfolioSelectionPlanContentHash()).toBe("f8703c81c3f904fdafd76e93122a895c12652a332c83ed3328bb2bceb7632e78")
  })

  it("fails closed on dependency, lane, fan-in, provider, path, secret, authority, and safety mutation", () => {
    for (const changed of [
      mutate((value) => { value.dependencyEvidence.pop() }),
      mutate((value) => { value.selectedLanes[1].programId = value.selectedLanes[0].programId }),
      mutate((value) => { value.fanInLane.releaseTarget = "WO-MAO-999" }),
      mutate((value) => { value.providerExclusions[0].selected = true }),
      mutate((value) => { value.changedPaths.push(".obsidian/private.md") }),
      mutate((value) => { value.secretScan.secretLikeFindings = 1 }),
      mutate((value) => { value.authority.certificationAuthorityGranted = true }),
      mutate((value) => { value.safety.githubApiCalled = true }),
    ]) {
      expectSelectionWall(() => verifyCanonicalCertificationPortfolioSelection(changed))
    }
  })

  it("publishes typed static evidence for the portfolio selection", () => {
    expect(isVerifiedWoMao054CertificationPortfolioEvidence()).toBe(true)
    expect(MULTI_AGENT_CERTIFICATION_PORTFOLIO_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-054-CERTIFICATION-PORTFOLIO-SELECTION-V1",
      workOrderId: "WO-MAO-054",
      selectedLaneCount: 2,
      fanInLaneCount: 1,
      claudeSelected: false,
      completionState: "COMPLETE",
      downstreamWorkOrderId: "WO-MAO-055",
      downstreamState: "READY_AFTER_CERTIFICATION_PORTFOLIO_SELECTION",
      recordContentHash: "8a49d67f9425f059bdcfbf05cead09d25bf3cde425710a6f6528af3bc0227493",
    })
  })
})
