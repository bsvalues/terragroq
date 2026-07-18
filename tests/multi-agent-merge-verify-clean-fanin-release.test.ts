import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"

import {
  MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE,
  isVerifiedWoMao058MergeVerifyFanInEvidence,
} from "@/components/operator/multi-agent-merge-verify-fanin-registry"
import {
  MergeVerifyCleanFanInReleaseError,
  evaluateMergeVerifyCleanFanInRelease,
  loadCanonicalMergeVerifyCleanFanInRelease,
  mergeVerifyCleanFanInReleasePlanContentHash,
  runCanonicalMergeVerifyCleanFanInRelease,
  verifyCanonicalMergeVerifyCleanFanInRelease,
} from "../scripts/multi-agent-operator/merge-verify-clean-fanin-release.mjs"

describe("WO-MAO-058 merge, verify, clean, and fan-in release", () => {
  it("certifies merged useful PRs and releases WO-MAO-059 without certifying the soak", () => {
    const result = runCanonicalMergeVerifyCleanFanInRelease()

    expect(result).toMatchObject({
      workOrderId: "WO-MAO-058",
      status: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_CERTIFIED",
      releaseId: "merge-verify-clean-fanin-release-wo-mao-058-v1",
      planContentHash: "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229",
      resultHash: "4461ccc615edb0746ffdd15743caf903aaf340a858640b2bb4ef78236a112cc4",
      repository: "bsvalues/terragroq",
      mainCommitSha: "9a1fff71727c9df72d476e5df20b9ae6457631ba",
      mainTreeHash: "0c5a74698825b8b48c6a2a991277e7931acd8ffe",
      downstreamWorkOrderId: "WO-MAO-059",
      downstreamState: "READY_AFTER_WO_MAO_058_FANIN_RELEASE",
      dependencyCount: 2,
      mergedPullRequestCount: 2,
      routeCheckCount: 4,
      releasedReservationCount: 2,
      deniedCleanupActionCount: 6,
      reservedPathCount: 16,
      changedPathCount: 16,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      githubPrLifecycleUsed: true,
      mergePerformed: true,
      cleanupPerformed: true,
      unsafeCleanupPerformed: false,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      productionWritePerformed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      paidOverageAllowed: false,
      rejectedRuntimeRetried: false,
      authorityGranted: false,
      soakDurationCertified: false,
      tenConsecutiveWorkOrdersCertified: false,
    })
    expect(result.mergedPullRequests).toEqual([411, 412])
  })

  it("rejects caller-supplied release input and verifies only the sealed plan", () => {
    expect(() => evaluateMergeVerifyCleanFanInRelease()).toThrow(MergeVerifyCleanFanInReleaseError)
    expect(verifyCanonicalMergeVerifyCleanFanInRelease()).toEqual({
      ok: true,
      code: "MERGE_VERIFY_CLEAN_FANIN_RELEASE_PLAN_VERIFIED",
      contentHash: "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229",
      githubPrLifecycleUsed: true,
      mergePerformed: true,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(mergeVerifyCleanFanInReleasePlanContentHash()).toBe(
      "17e19107f70be0b75d31bc7ac88422293f89232cd60c6bea7feb9c78ddb2a229",
    )
  })

  it("fails closed when merge, route, cleanup, safety, or downstream claims are weakened", () => {
    const plan = loadCanonicalMergeVerifyCleanFanInRelease()
    const cases = [
      { ...plan, dependencyEvidence: plan.dependencyEvidence.slice(1) },
      { ...plan, mergedPullRequests: plan.mergedPullRequests.slice(1) },
      { ...plan, mergedPullRequests: [{ ...plan.mergedPullRequests[0], checksGreen: false }, ...plan.mergedPullRequests.slice(1)] },
      { ...plan, productionRouteChecks: [{ ...plan.productionRouteChecks[0], observedStatus: 500 }, ...plan.productionRouteChecks.slice(1)] },
      { ...plan, cleanupPolicy: { ...plan.cleanupPolicy, unsafeCleanupDenied: plan.cleanupPolicy.unsafeCleanupDenied.filter((item) => item !== "obsidian-touch") } },
      { ...plan, fanInRelease: { ...plan.fanInRelease, soakDurationCertified: true } },
      { ...plan, ownerCounters: { ...plan.ownerCounters, OWNER_ROUTINE_CONTACT_COUNT: 1 } },
      { ...plan, safety: { ...plan.safety, runtimeActivationAllowed: true } },
      { ...plan, safety: { ...plan.safety, rejectedRuntimeRetried: true } },
    ]

    for (const value of cases) {
      expect(() => verifyCanonicalMergeVerifyCleanFanInRelease(value)).toThrow(MergeVerifyCleanFanInReleaseError)
    }
    expect(() => verifyCanonicalMergeVerifyCleanFanInRelease(null)).toThrow(MergeVerifyCleanFanInReleaseError)
    expect(() => verifyCanonicalMergeVerifyCleanFanInRelease("input")).toThrow(MergeVerifyCleanFanInReleaseError)
  })

  it("publishes a tamper-evident registry record", () => {
    expect(MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE).toMatchObject({
      workOrderId: "WO-MAO-058",
      status: "CANONICAL_MERGE_VERIFY_CLEAN_FANIN_RELEASE_VERIFIED",
      mergedPullRequests: [411, 412],
      downstreamWorkOrderId: "WO-MAO-059",
      ownerOperationRequired: false,
      recordContentHash: "ec2418f4572b74c14cb345af18d886631a2c0e17930bf43a8f0c5649c696b8d6",
    })
    expect(isVerifiedWoMao058MergeVerifyFanInEvidence()).toBe(true)
    expect(isVerifiedWoMao058MergeVerifyFanInEvidence({
      ...MULTI_AGENT_MERGE_VERIFY_FANIN_EVIDENCE,
      mergedPullRequestCount: 1,
    })).toBe(false)
    expect(isVerifiedWoMao058MergeVerifyFanInEvidence(null)).toBe(false)
    expect(isVerifiedWoMao058MergeVerifyFanInEvidence("input")).toBe(false)
  })

  it("keeps the CLI zero-input by rejecting caller-supplied arguments", () => {
    expect(() => execFileSync(
      process.execPath,
      ["scripts/multi-agent-operator/merge-verify-clean-fanin-release-cli.mjs", "input.json"],
      { encoding: "utf8" },
    )).toThrow(/FANIN_RELEASE_CLI_ARGUMENT_WALL/)
  })
})
