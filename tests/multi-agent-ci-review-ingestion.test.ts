import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  ciReviewIngestionPlanContentHash,
  CiReviewIngestionError,
  evaluateCiReviewIngestion,
  loadCanonicalCiReviewIngestionPlan,
  runCanonicalCiReviewIngestion,
  verifyCanonicalCiReviewIngestionPlan,
} from "../scripts/multi-agent-operator/ci-review-ingestion.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected CI review wall")
  } catch (error) {
    expect(error).toBeInstanceOf(CiReviewIngestionError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-039 CI and review ingestion", () => {
  it("proves sealed CI/review ingestion without calling GitHub or remediating", () => {
    const result = runCanonicalCiReviewIngestion()

    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "CI_REVIEW_INGESTION_RESULT",
      workOrderId: "WO-MAO-039",
      status: "CI_REVIEW_INGESTION_PROVEN",
      ingestionId: "ingestion-wo-mao-039-ci-review-v1",
      planContentHash: "9eaac8aec1c65ec262b9d13227971a1a44a8705892906e2159f5d811814b067e",
      repository: "bsvalues/terragroq",
      baseRef: "refs/heads/main",
      baseCommitSha: "365c42a4d64b3d374f6a4417624ce2df54460c0a",
      baseTreeHash: "41a7444b50bb2cd4f707d523cd5837c03e109221",
      dependencyWorkOrders: ["WO-MAO-020", "WO-MAO-022", "WO-MAO-038"],
      requiredCheckCount: 3,
      optionalCheckCount: 1,
      reviewThreadClassCount: 3,
      failureClassCount: 5,
      reservedPathCount: 15,
      changedPathCount: 15,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      githubApiCalled: false,
      checkRerunPerformed: false,
      reviewThreadResolved: false,
      reviewCommentPosted: false,
      remediationPerformed: false,
      mergePerformed: false,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      productionWriteAllowed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
      resultHash: "b8975bca7ecb9ea4ffcd730d03f6a26915e8da0ec08dfd58137c1bfdaef3da7d",
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_LIFECYCLE_ESCALATION_TAXONOMY",
      "VERIFY_OWNER_TOUCH_METER_EVIDENCE",
      "VERIFY_PR_PACKET_LINKAGE_EVIDENCE",
      "OBSERVE_REQUIRED_CHECK_TERMINAL_STATES",
      "CLASSIFY_REVIEW_THREADS",
      "CLASSIFY_FAILURE_SOURCE",
      "RECORD_TERMINAL_INGESTION_FOR_REMEDIATION_GATE",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied CI/review input and pins the canonical plan", () => {
    expect(runCanonicalCiReviewIngestion()).toEqual(runCanonicalCiReviewIngestion())
    expectWall(() => evaluateCiReviewIngestion({
      workOrderId: "WO-MAO-039",
      checkContexts: [],
    }), "CI_REVIEW_HOST_TRUST_WALL")
    expect(verifyCanonicalCiReviewIngestionPlan()).toMatchObject({
      ok: true,
      code: "CI_REVIEW_INGESTION_PLAN_VERIFIED",
      contentHash: "9eaac8aec1c65ec262b9d13227971a1a44a8705892906e2159f5d811814b067e",
      githubApiCalled: false,
      checkRerunPerformed: false,
      reviewThreadResolved: false,
      remediationPerformed: false,
      mergePerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, check, thread, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.repository = "attacker/repository" },
      (value: any) => { value.dependencyEvidence[2].recordContentHash = "bad" },
      (value: any) => { value.checkContexts[0].terminalState = "FAILURE" },
      (value: any) => { value.checkContexts = value.checkContexts.filter((entry: any) => entry.name !== "CodeRabbit") },
      (value: any) => { value.reviewThreadClasses = [] },
      (value: any) => { value.failureClasses = ["PRODUCT"] },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.foreignChanges.push("components/unreserved.ts") },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.prPacketLinkageVerified = false },
      (value: any) => { value.authority.authorityScope = "ALL_REPOSITORY_PATHS" },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.remediationPerformed = true },
      (value: any) => { value.safety.mergePerformed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalCiReviewIngestionPlan())
      mutate(plan)
      expect(ciReviewIngestionPlanContentHash(plan)).not.toBe("9eaac8aec1c65ec262b9d13227971a1a44a8705892906e2159f5d811814b067e")
      expectWall(() => verifyCanonicalCiReviewIngestionPlan(plan), "CI_REVIEW_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/ci-review-ingestion-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "CI_REVIEW_INGESTION_PROVEN",
      resultHash: "b8975bca7ecb9ea4ffcd730d03f6a26915e8da0ec08dfd58137c1bfdaef3da7d",
      githubApiCalled: false,
      checkRerunPerformed: false,
      reviewThreadResolved: false,
      remediationPerformed: false,
      mergePerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--checks", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/ci-review-ingestion-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "CI_REVIEW_CLI_ARGUMENT_WALL",
        githubApiCalled: false,
        checkRerunPerformed: false,
        reviewThreadResolved: false,
        remediationPerformed: false,
        mergePerformed: false,
        authorityGranted: false,
      })
    }
  })
})
