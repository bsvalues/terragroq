import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluateGitHubLifecycleConformance,
  GitHubLifecycleConformanceError,
  githubLifecycleConformancePlanContentHash,
  loadCanonicalGitHubLifecycleConformancePlan,
  runCanonicalGitHubLifecycleConformance,
  verifyCanonicalGitHubLifecycleConformancePlan,
} from "../scripts/multi-agent-operator/github-lifecycle-conformance.mjs"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected github lifecycle wall")
  } catch (error) {
    expect(error).toBeInstanceOf(GitHubLifecycleConformanceError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-044 GitHub lifecycle conformance", () => {
  it("proves ordered lifecycle conformance without executing GitHub operations", () => {
    const result = runCanonicalGitHubLifecycleConformance()
    expect(result).toMatchObject({
      artifactType: "GITHUB_LIFECYCLE_CONFORMANCE_RESULT",
      workOrderId: "WO-MAO-044",
      status: "GITHUB_LIFECYCLE_CONFORMANCE_PROVEN",
      planContentHash: "029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc",
      baseCommitSha: "1541db6530de525ef6f86c1b55758a71c7c5447f",
      baseTreeHash: "a0913fdefec84ef2d0cdf26a27e57abcfa6d2d6a",
      dependencyCount: 7,
      lifecycleStageCount: 7,
      conformanceGateCount: 6,
      reservedPathCount: 15,
      changedPathCount: 15,
      githubApiCalled: false,
      mergePerformed: false,
      authorityGranted: false,
      resultHash: "810fb1b18cb6b64a6497899588d17e975ce2b51575bb278bea0379d4e5a2f48e",
    })
    expect(result.dependencyWorkOrders).toEqual(["WO-MAO-037", "WO-MAO-038", "WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-042", "WO-MAO-043"])
    expect(result.orderedOperations).toContain("DENY_DIRECT_GITHUB_EXECUTION")
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied lifecycle input and pins the canonical plan", () => {
    expect(runCanonicalGitHubLifecycleConformance()).toEqual(runCanonicalGitHubLifecycleConformance())
    expectWall(() => evaluateGitHubLifecycleConformance({ merge: true }), "GITHUB_LIFECYCLE_HOST_TRUST_WALL")
    expect(verifyCanonicalGitHubLifecycleConformancePlan()).toMatchObject({
      ok: true,
      code: "GITHUB_LIFECYCLE_CONFORMANCE_PLAN_VERIFIED",
      contentHash: "029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc",
      githubApiCalled: false,
      mergePerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, stage, gate, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence.pop() },
      (value: any) => { value.lifecycleStages[0].state = "FAIL" },
      (value: any) => { value.conformanceGates[0].required = false },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.phaseFiveModelsVerified = false },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.mergePerformed = true },
      (value: any) => { value.safety.authorityGranted = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalGitHubLifecycleConformancePlan())
      mutate(plan)
      expect(githubLifecycleConformancePlanContentHash(plan)).not.toBe("029298e8dc683e74613e5d2dc1a56e0149c713ec0fcaf1e05341280f8cfbbacc")
      expectWall(() => verifyCanonicalGitHubLifecycleConformancePlan(plan), "GITHUB_LIFECYCLE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/github-lifecycle-conformance-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "GITHUB_LIFECYCLE_CONFORMANCE_PROVEN",
      resultHash: "810fb1b18cb6b64a6497899588d17e975ce2b51575bb278bea0379d4e5a2f48e",
      githubApiCalled: false,
      mergePerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--merge", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/github-lifecycle-conformance-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "GITHUB_LIFECYCLE_CLI_ARGUMENT_WALL",
        githubApiCalled: false,
        mergePerformed: false,
        authorityGranted: false,
      })
    }
  })
})
