import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluateRemediationRereview,
  loadCanonicalRemediationRereviewPlan,
  remediationRereviewPlanContentHash,
  RemediationRereviewError,
  runCanonicalRemediationRereview,
  verifyCanonicalRemediationRereviewPlan,
} from "../scripts/multi-agent-operator/remediation-rereview.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected remediation wall")
  } catch (error) {
    expect(error).toBeInstanceOf(RemediationRereviewError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-040 automated remediation and re-review", () => {
  it("proves bounded remediation routing without mutating branches or reviews", () => {
    const result = runCanonicalRemediationRereview()
    expect(result).toMatchObject({
      artifactType: "REMEDIATION_REREVIEW_RESULT",
      workOrderId: "WO-MAO-040",
      status: "REMEDIATION_REREVIEW_PROVEN",
      planContentHash: "2cc236487f15809ddfd89830400e2dbaa62b5ad7bfe628d11bc8bcf4eebbe1bf",
      baseCommitSha: "eacc0c3aa1dc719f17b6b96377b8c6b31c2b7be1",
      baseTreeHash: "553fa0cf94a799e57b0f573d7e336f7aa83838b4",
      dependencyWorkOrders: ["WO-MAO-026", "WO-MAO-031", "WO-MAO-039"],
      maxCycles: 1,
      originalBuilderRequired: true,
      independentReviewerRequired: true,
      zeroUnresolvedThreadsRequired: true,
      commandCount: 5,
      reservedPathCount: 15,
      changedPathCount: 15,
      githubApiCalled: false,
      branchMutated: false,
      remediationApplied: false,
      validationRerunPerformed: false,
      reviewRequested: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      authorityGranted: false,
      resultHash: "463356546e218df13dde3c2b83bef18e14856de830a470a2401ba96116ea68d8",
    })
    expect(result.orderedOperations).toContain("ROUTE_ACTIONABLE_FINDING_TO_ORIGINAL_BUILDER")
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied remediation input and pins the canonical plan", () => {
    expect(runCanonicalRemediationRereview()).toEqual(runCanonicalRemediationRereview())
    expectWall(() => evaluateRemediationRereview({ remediator: "not-original-builder" }), "REMEDIATION_HOST_TRUST_WALL")
    expect(verifyCanonicalRemediationRereviewPlan()).toMatchObject({
      ok: true,
      code: "REMEDIATION_REREVIEW_PLAN_VERIFIED",
      contentHash: "2cc236487f15809ddfd89830400e2dbaa62b5ad7bfe628d11bc8bcf4eebbe1bf",
      remediationApplied: false,
      validationRerunPerformed: false,
      reviewRequested: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, routing, validation, re-review, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[2].recordContentHash = "bad" },
      (value: any) => { value.remediationRoute.originalBuilderRequired = false },
      (value: any) => { value.remediationRoute.maxCycles = 2 },
      (value: any) => { value.validationLoop.commands = ["focused-tests"] },
      (value: any) => { value.rereview.sameReviewerMayRemediate = true },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.ciReviewIngestionVerified = false },
      (value: any) => { value.safety.remediationApplied = true },
      (value: any) => { value.safety.reviewThreadResolved = true },
      (value: any) => { value.safety.mergePerformed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalRemediationRereviewPlan())
      mutate(plan)
      expect(remediationRereviewPlanContentHash(plan)).not.toBe("2cc236487f15809ddfd89830400e2dbaa62b5ad7bfe628d11bc8bcf4eebbe1bf")
      expectWall(() => verifyCanonicalRemediationRereviewPlan(plan), "REMEDIATION_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/remediation-rereview-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "REMEDIATION_REREVIEW_PROVEN",
      resultHash: "463356546e218df13dde3c2b83bef18e14856de830a470a2401ba96116ea68d8",
      remediationApplied: false,
      validationRerunPerformed: false,
      reviewRequested: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--remediate", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/remediation-rereview-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "REMEDIATION_CLI_ARGUMENT_WALL",
        remediationApplied: false,
        validationRerunPerformed: false,
        reviewRequested: false,
        reviewThreadResolved: false,
        mergePerformed: false,
        authorityGranted: false,
      })
    }
  })
})
