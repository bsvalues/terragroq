import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  automaticDependentReleasePlanContentHash,
  AutomaticDependentReleaseError,
  evaluateAutomaticDependentRelease,
  loadCanonicalAutomaticDependentReleasePlan,
  runCanonicalAutomaticDependentRelease,
  verifyCanonicalAutomaticDependentReleasePlan,
} from "../scripts/multi-agent-operator/automatic-dependent-release.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected dependent release wall")
  } catch (error) {
    expect(error).toBeInstanceOf(AutomaticDependentReleaseError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-043 automatic dependent release", () => {
  it("proves dependent release without dispatching a provider or creating GitHub state", () => {
    const result = runCanonicalAutomaticDependentRelease()
    expect(result).toMatchObject({
      artifactType: "AUTOMATIC_DEPENDENT_RELEASE_RESULT",
      workOrderId: "WO-MAO-043",
      status: "AUTOMATIC_DEPENDENT_RELEASE_PROVEN",
      planContentHash: "c999b4eb97a64c0bf49f19f12702ba3ea3d7837e80b3998b14ec6c09c6e4f5ad",
      baseCommitSha: "e29f45fd045db316bb0179fb81ab546f1d88e147",
      baseTreeHash: "710068486bc6ebe0bf22d7703faa441e9b4b63c1",
      dependencyWorkOrders: ["WO-MAO-017", "WO-MAO-020", "WO-MAO-042"],
      releasedWorkOrders: ["WO-MAO-043"],
      blockedWorkOrders: ["WO-MAO-044"],
      gateCount: 6,
      candidateWorkOrderCount: 2,
      releasedWorkOrderCount: 1,
      blockedWorkOrderCount: 1,
      reservedPathCount: 15,
      changedPathCount: 15,
      providerDispatched: false,
      githubApiCalled: false,
      branchCreated: false,
      pullRequestCreated: false,
      authorityGranted: false,
      resultHash: "344eaedb9cb2b29ad525ea3011862ba4b510a5ad62660f99f9af2a9dffa0d159",
    })
    expect(result.orderedOperations).toContain("DENY_RUNTIME_DISPATCH")
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied release input and pins the canonical plan", () => {
    expect(runCanonicalAutomaticDependentRelease()).toEqual(runCanonicalAutomaticDependentRelease())
    expectWall(() => evaluateAutomaticDependentRelease({ dispatch: true }), "DEPENDENT_RELEASE_HOST_TRUST_WALL")
    expect(verifyCanonicalAutomaticDependentReleasePlan()).toMatchObject({
      ok: true,
      code: "AUTOMATIC_DEPENDENT_RELEASE_PLAN_VERIFIED",
      contentHash: "c999b4eb97a64c0bf49f19f12702ba3ea3d7837e80b3998b14ec6c09c6e4f5ad",
      providerDispatched: false,
      githubApiCalled: false,
      branchCreated: false,
      pullRequestCreated: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, release, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.releaseGates[0].state = "FAIL" },
      (value: any) => { value.dependencyEvidence[2].recordContentHash = "bad" },
      (value: any) => { value.releasedWorkOrders = ["WO-MAO-044"] },
      (value: any) => { value.blockedWorkOrders = ["WO-MAO-043"] },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.postMergeVerificationVerified = false },
      (value: any) => { value.safety.providerDispatched = true },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.branchCreated = true },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalAutomaticDependentReleasePlan())
      mutate(plan)
      expect(automaticDependentReleasePlanContentHash(plan)).not.toBe("c999b4eb97a64c0bf49f19f12702ba3ea3d7837e80b3998b14ec6c09c6e4f5ad")
      expectWall(() => verifyCanonicalAutomaticDependentReleasePlan(plan), "DEPENDENT_RELEASE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/automatic-dependent-release-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "AUTOMATIC_DEPENDENT_RELEASE_PROVEN",
      resultHash: "344eaedb9cb2b29ad525ea3011862ba4b510a5ad62660f99f9af2a9dffa0d159",
      providerDispatched: false,
      githubApiCalled: false,
      branchCreated: false,
      pullRequestCreated: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--dispatch", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/automatic-dependent-release-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "DEPENDENT_RELEASE_CLI_ARGUMENT_WALL",
        providerDispatched: false,
        githubApiCalled: false,
        branchCreated: false,
        pullRequestCreated: false,
        authorityGranted: false,
      })
    }
  })
})
