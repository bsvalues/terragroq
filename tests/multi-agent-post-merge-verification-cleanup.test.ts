import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluatePostMergeVerificationCleanup,
  loadCanonicalPostMergeVerificationCleanupPlan,
  postMergeVerificationCleanupPlanContentHash,
  PostMergeVerificationCleanupError,
  runCanonicalPostMergeVerificationCleanup,
  verifyCanonicalPostMergeVerificationCleanupPlan,
} from "../scripts/multi-agent-operator/post-merge-verification-cleanup.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected post-merge verification cleanup wall")
  } catch (error) {
    expect(error).toBeInstanceOf(PostMergeVerificationCleanupError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-042 post-merge verification and cleanup", () => {
  it("proves post-merge route and cleanup gates without performing cleanup", () => {
    const result = runCanonicalPostMergeVerificationCleanup()
    expect(result).toMatchObject({
      artifactType: "POST_MERGE_VERIFICATION_CLEANUP_RESULT",
      workOrderId: "WO-MAO-042",
      status: "POST_MERGE_VERIFICATION_CLEANUP_PROVEN",
      planContentHash: "f55dbaff41391096d37ac08a8534e2337fc242281903150459c070341299b0d5",
      mainCommitSha: "2fafb13ef4f4d2c0b62a63cdf24f4fdd4c7d438c",
      mainTreeHash: "21a6fb6fb2374e6055b00ed4cf762391db6a63cd",
      dependencyWorkOrders: ["WO-MAO-022", "WO-MAO-025", "WO-MAO-041"],
      gateCount: 7,
      routeCheckCount: 4,
      deniedCleanupActionCount: 6,
      releasedReservationCount: 2,
      reservedPathCount: 15,
      changedPathCount: 15,
      githubApiCalled: false,
      cleanupPerformed: false,
      unsafeCleanupPerformed: false,
      productionWritePerformed: false,
      authorityGranted: false,
      resultHash: "d17bd146ec600253da4f07687a0c07816a7fb35845fe979489a4a38a6748443e",
    })
    expect(result.orderedOperations).toContain("DENY_UNSAFE_CLEANUP")
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied post-merge input and pins the canonical plan", () => {
    expect(runCanonicalPostMergeVerificationCleanup()).toEqual(runCanonicalPostMergeVerificationCleanup())
    expectWall(() => evaluatePostMergeVerificationCleanup({ cleanupNow: true }), "POST_MERGE_HOST_TRUST_WALL")
    expect(verifyCanonicalPostMergeVerificationCleanupPlan()).toMatchObject({
      ok: true,
      code: "POST_MERGE_VERIFICATION_CLEANUP_PLAN_VERIFIED",
      contentHash: "f55dbaff41391096d37ac08a8534e2337fc242281903150459c070341299b0d5",
      cleanupPerformed: false,
      unsafeCleanupPerformed: false,
      productionWritePerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on route, cleanup, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.productionRouteChecks[0].observedStatus = 500 },
      (value: any) => { value.postMergeGates[0].state = "FAIL" },
      (value: any) => { value.cleanupPolicy.eligibleCleanupCandidates.push("unsafe-worktree") },
      (value: any) => { value.cleanupPolicy.deniedCleanupActions = ["obsidian-touch"] },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".obsidian/private.md" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.mergeControllerVerified = false },
      (value: any) => { value.safety.cleanupPerformed = true },
      (value: any) => { value.safety.productionWritePerformed = true },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalPostMergeVerificationCleanupPlan())
      mutate(plan)
      expect(postMergeVerificationCleanupPlanContentHash(plan)).not.toBe("f55dbaff41391096d37ac08a8534e2337fc242281903150459c070341299b0d5")
      expectWall(() => verifyCanonicalPostMergeVerificationCleanupPlan(plan), "POST_MERGE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/post-merge-verification-cleanup-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "POST_MERGE_VERIFICATION_CLEANUP_PROVEN",
      resultHash: "d17bd146ec600253da4f07687a0c07816a7fb35845fe979489a4a38a6748443e",
      cleanupPerformed: false,
      unsafeCleanupPerformed: false,
      productionWritePerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--cleanup", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/post-merge-verification-cleanup-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "POST_MERGE_CLI_ARGUMENT_WALL",
        cleanupPerformed: false,
        unsafeCleanupPerformed: false,
        productionWritePerformed: false,
        authorityGranted: false,
      })
    }
  })
})
