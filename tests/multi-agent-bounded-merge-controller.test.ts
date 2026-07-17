import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  boundedMergeControllerPlanContentHash,
  BoundedMergeControllerError,
  evaluateBoundedMergeController,
  loadCanonicalBoundedMergeControllerPlan,
  runCanonicalBoundedMergeController,
  verifyCanonicalBoundedMergeControllerPlan,
} from "../scripts/multi-agent-operator/bounded-merge-controller.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected merge controller wall")
  } catch (error) {
    expect(error).toBeInstanceOf(BoundedMergeControllerError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-041 bounded merge controller", () => {
  it("proves merge eligibility gates without performing a merge", () => {
    const result = runCanonicalBoundedMergeController()
    expect(result).toMatchObject({
      artifactType: "BOUNDED_MERGE_CONTROLLER_RESULT",
      workOrderId: "WO-MAO-041",
      status: "BOUNDED_MERGE_CONTROLLER_PROVEN",
      planContentHash: "f74c983d01c8757783c6d9277b8fb18b9af3191138576b12e4c58bb8fdf82f08",
      baseCommitSha: "ceccfb9b2496865f1b60bb54de24a7d6c8af79e5",
      baseTreeHash: "8dc455883469ee550e6d8d95eacf5ae986a31a2d",
      dependencyWorkOrders: ["WO-MAO-007", "WO-MAO-020", "WO-MAO-039", "WO-MAO-040"],
      gateCount: 6,
      deniedBypassCount: 5,
      reservedPathCount: 15,
      changedPathCount: 15,
      githubApiCalled: false,
      mergePerformed: false,
      branchProtectionBypassed: false,
      securityThreadDismissed: false,
      authorityThreadDismissed: false,
      authorityGranted: false,
      resultHash: "6c47aade2d779b27be7b72227196ec7e9d0740b8674b25084256740eb7ce6fa2",
    })
    expect(result.orderedOperations).toContain("DENY_BRANCH_PROTECTION_BYPASS")
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied merge input and pins the canonical plan", () => {
    expect(runCanonicalBoundedMergeController()).toEqual(runCanonicalBoundedMergeController())
    expectWall(() => evaluateBoundedMergeController({ mergeNow: true }), "MERGE_CONTROLLER_HOST_TRUST_WALL")
    expect(verifyCanonicalBoundedMergeControllerPlan()).toMatchObject({
      ok: true,
      code: "BOUNDED_MERGE_CONTROLLER_PLAN_VERIFIED",
      contentHash: "f74c983d01c8757783c6d9277b8fb18b9af3191138576b12e4c58bb8fdf82f08",
      mergePerformed: false,
      branchProtectionBypassed: false,
      securityThreadDismissed: false,
      authorityThreadDismissed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, gate, bypass, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[3].recordContentHash = "bad" },
      (value: any) => { value.mergeGates[0].state = "FAIL" },
      (value: any) => { value.mergeGates[0].required = false },
      (value: any) => { value.deniedBypasses = ["stale-head-merge"] },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.remediationRereviewVerified = false },
      (value: any) => { value.safety.mergePerformed = true },
      (value: any) => { value.safety.branchProtectionBypassed = true },
      (value: any) => { value.safety.securityThreadDismissed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalBoundedMergeControllerPlan())
      mutate(plan)
      expect(boundedMergeControllerPlanContentHash(plan)).not.toBe("f74c983d01c8757783c6d9277b8fb18b9af3191138576b12e4c58bb8fdf82f08")
      expectWall(() => verifyCanonicalBoundedMergeControllerPlan(plan), "MERGE_CONTROLLER_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/bounded-merge-controller-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "BOUNDED_MERGE_CONTROLLER_PROVEN",
      resultHash: "6c47aade2d779b27be7b72227196ec7e9d0740b8674b25084256740eb7ce6fa2",
      mergePerformed: false,
      branchProtectionBypassed: false,
      securityThreadDismissed: false,
      authorityThreadDismissed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--merge", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/bounded-merge-controller-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "MERGE_CONTROLLER_CLI_ARGUMENT_WALL",
        mergePerformed: false,
        branchProtectionBypassed: false,
        securityThreadDismissed: false,
        authorityThreadDismissed: false,
        authorityGranted: false,
      })
    }
  })
})
