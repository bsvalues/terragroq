import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  branchCommitPushPlanContentHash,
  BranchCommitPushAutomationError,
  evaluateBranchCommitPushAutomation,
  loadCanonicalBranchCommitPushPlan,
  runCanonicalBranchCommitPushAutomation,
  verifyCanonicalBranchCommitPushPlan,
} from "../scripts/multi-agent-operator/branch-commit-push-automation.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected branch lifecycle wall")
  } catch (error) {
    expect(error).toBeInstanceOf(BranchCommitPushAutomationError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-037 branch, commit, and push automation", () => {
  it("proves a sealed branch, commit, and push lifecycle plan without executing git", () => {
    const result = runCanonicalBranchCommitPushAutomation()

    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "BRANCH_COMMIT_PUSH_AUTOMATION_RESULT",
      workOrderId: "WO-MAO-037",
      status: "BRANCH_COMMIT_PUSH_AUTOMATION_PROVEN",
      planId: "plan-wo-mao-037-branch-commit-push-v1",
      planContentHash: "9ad3e845c4dec0ad9c152393aa2b7a8bd720ecfe14b91129056e8dfa32da1c77",
      repository: "bsvalues/terragroq",
      branch: "codex/wo-mao-037-governed-delivery",
      baseRef: "refs/heads/main",
      baseCommitSha: "a553abf39299a1aecd7d97368bd212699483da61",
      baseTreeHash: "fca0bb39bac595e42abfd95f41aedfcf5f7fac4b",
      reservedPathCount: 15,
      changedPathCount: 15,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      gitCommandPerformed: false,
      branchCreated: false,
      commitCreated: false,
      pushed: false,
      destructiveOperationAllowed: false,
      forcePushAllowed: false,
      tagAllowed: false,
      releaseAllowed: false,
      productionWriteAllowed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      authorityGranted: false,
      resultHash: "917e7eb0c6d97b6b1c0f177de230f6fdd607df1d7495bb830da323d7b1f59479",
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_ACTIVE_PROGRAM_GRANT",
      "VERIFY_PREVENTIVE_TRUST_GATE",
      "VERIFY_RESERVATION_AND_LEASE_FENCE",
      "CREATE_BRANCH",
      "STAGE_RESERVED_PATHS_ONLY",
      "COMMIT_WITH_ATTRIBUTION",
      "PUSH_BRANCH",
      "RECORD_ROLLBACK_EVIDENCE",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied lifecycle input and pins the canonical plan", () => {
    expect(runCanonicalBranchCommitPushAutomation()).toEqual(runCanonicalBranchCommitPushAutomation())
    expectWall(() => evaluateBranchCommitPushAutomation({
      workOrderId: "WO-MAO-037",
      branch: "codex/made-up",
    }), "GIT_LIFECYCLE_HOST_TRUST_WALL")
    expect(verifyCanonicalBranchCommitPushPlan()).toMatchObject({
      ok: true,
      code: "GIT_LIFECYCLE_PLAN_VERIFIED",
      contentHash: "9ad3e845c4dec0ad9c152393aa2b7a8bd720ecfe14b91129056e8dfa32da1c77",
      gitCommandPerformed: false,
      branchCreated: false,
      commitCreated: false,
      pushed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on scope, reservation, secret, authority, attribution, rollback, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.repository = "attacker/repository" },
      (value: any) => { value.branch = "main" },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.foreignChanges.push("components/unreserved.ts") },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.preventiveTrustGatePassed = false },
      (value: any) => { value.authority.authorityScope = "ALL_REPOSITORY_PATHS" },
      (value: any) => { value.attribution.actor = "unknown" },
      (value: any) => { value.rollback.remoteBranchDeleteAllowed = false },
      (value: any) => { value.safety.forcePushAllowed = true },
      (value: any) => { value.safety.productionWriteAllowed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalBranchCommitPushPlan())
      mutate(plan)
      expect(branchCommitPushPlanContentHash(plan)).not.toBe("9ad3e845c4dec0ad9c152393aa2b7a8bd720ecfe14b91129056e8dfa32da1c77")
      expectWall(() => verifyCanonicalBranchCommitPushPlan(plan), "GIT_LIFECYCLE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "BRANCH_COMMIT_PUSH_AUTOMATION_PROVEN",
      resultHash: "917e7eb0c6d97b6b1c0f177de230f6fdd607df1d7495bb830da323d7b1f59479",
      gitCommandPerformed: false,
      branchCreated: false,
      commitCreated: false,
      pushed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--branch", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/branch-commit-push-automation-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "GIT_LIFECYCLE_CLI_ARGUMENT_WALL",
        gitCommandPerformed: false,
        branchCreated: false,
        commitCreated: false,
        pushed: false,
        authorityGranted: false,
      })
    }
  })
})
