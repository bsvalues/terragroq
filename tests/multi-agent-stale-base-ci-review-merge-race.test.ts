import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluateStaleBaseCiReviewMergeRace,
  loadCanonicalStaleBaseCiReviewMergeRacePlan,
  runCanonicalStaleBaseCiReviewMergeRace,
  staleBaseCiReviewMergeRacePlanContentHash,
  StaleBaseCiReviewMergeRaceError,
  verifyCanonicalStaleBaseCiReviewMergeRacePlan,
} from "../scripts/multi-agent-operator/stale-base-ci-review-merge-race.mjs"
import {
  isVerifiedWoMao049MergeRaceEvidence,
  MULTI_AGENT_MERGE_RACE_EVIDENCE,
} from "../components/operator/multi-agent-merge-race-registry"

const PLAN_HASH = "c4fac68042a360532806aeb94248e52a58fa10c76d388fe217c15827b4c294bf"
const RESULT_HASH = "1ca6498b80222b9134a2e3fb70be03d01fa0f0c38a816fa3c6daedb59843d838"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected stale-base merge-race wall")
  } catch (error) {
    expect(error).toBeInstanceOf(StaleBaseCiReviewMergeRaceError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-049 stale-base, CI, review, and merge-race drill", () => {
  it("proves the static merge-race drill without GitHub writes or runtime activation", () => {
    const result = runCanonicalStaleBaseCiReviewMergeRace()
    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "STALE_BASE_CI_REVIEW_MERGE_RACE_RESULT",
      workOrderId: "WO-MAO-049",
      status: "STALE_BASE_CI_REVIEW_MERGE_RACE_PROVEN",
      drillId: "stale-base-ci-review-merge-race-wo-mao-049-v1",
      planContentHash: PLAN_HASH,
      repository: "bsvalues/terragroq",
      baseRef: "refs/heads/main",
      baseCommitSha: "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc",
      baseTreeHash: "a4240f8508f3c95671250e6fb677efa3dff6baea",
      dependencyWorkOrders: ["WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-046"],
      dependencyCount: 4,
      staleBaseControlCount: 3,
      ciReviewOutcomeCount: 4,
      mergeRaceGuardCount: 4,
      flakyRetryBudget: 1,
      maxBaseRefreshes: 2,
      reservedPathCount: 5,
      changedPathCount: 5,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      rebasePerformed: false,
      ciRerunPerformed: false,
      reviewThreadResolved: false,
      mergePerformed: false,
      productionWritePerformed: false,
      stateMutationPerformed: false,
      authorityGranted: false,
      resultHash: RESULT_HASH,
    })
    expect(result.orderedOperations).toEqual([
      "VERIFY_CI_REVIEW_REMEDIATION_MERGE_AND_RETRY_EVIDENCE",
      "CLASSIFY_STALE_BASE_OR_CONCURRENT_CHANGE",
      "REFRESH_AND_FULLY_REVALIDATE_WHEN_ALLOWED",
      "ROUTE_DETERMINISTIC_FAILURE_TO_ORIGINAL_BUILDER",
      "ALLOW_ONE_CLASSIFIED_FLAKY_RERUN_ONLY",
      "DENY_STALE_OR_CONCURRENTLY_CHANGED_MERGE_CANDIDATE",
      "RECORD_STATIC_DRILL_EVIDENCE_ONLY",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied drill input and pins the canonical plan", () => {
    expect(runCanonicalStaleBaseCiReviewMergeRace()).toEqual(runCanonicalStaleBaseCiReviewMergeRace())
    expectWall(() => evaluateStaleBaseCiReviewMergeRace({ mergeNow: true }), "MERGE_RACE_HOST_TRUST_WALL")
    expect(verifyCanonicalStaleBaseCiReviewMergeRacePlan()).toMatchObject({
      ok: true,
      code: "STALE_BASE_CI_REVIEW_MERGE_RACE_PLAN_VERIFIED",
      contentHash: PLAN_HASH,
      githubApiCalled: false,
      rebasePerformed: false,
      ciRerunPerformed: false,
      mergePerformed: false,
      stateMutationPerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, stale-base, CI retry, race guard, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-999" },
      (value: any) => { value.dependencyEvidence.pop() },
      (value: any) => { value.staleBaseControls[0].revalidationRequired = false },
      (value: any) => { value.staleBaseControls[0].maxRefreshes = 9 },
      (value: any) => { value.ciReviewOutcomes.find((entry: any) => entry.failureClass === "FLAKY_INFRASTRUCTURE").retryBudget = 2 },
      (value: any) => { value.ciReviewOutcomes[0].failureClass = "UNKNOWN_FAILURE" },
      (value: any) => { value.mergeRaceGuards[0].required = false },
      (value: any) => { value.mergeRaceGuards[0].staleCandidateDecision = "MERGE_ANYWAY" },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.retryIdempotencyVerified = false },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.mergePerformed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalStaleBaseCiReviewMergeRacePlan())
      mutate(plan)
      expect(staleBaseCiReviewMergeRacePlanContentHash(plan)).not.toBe(PLAN_HASH)
      expectWall(() => verifyCanonicalStaleBaseCiReviewMergeRacePlan(plan), "MERGE_RACE_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/stale-base-ci-review-merge-race-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "STALE_BASE_CI_REVIEW_MERGE_RACE_PROVEN",
      resultHash: RESULT_HASH,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      rebasePerformed: false,
      ciRerunPerformed: false,
      mergePerformed: false,
      stateMutationPerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--merge", JSON.stringify({ marker: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/stale-base-ci-review-merge-race-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "MERGE_RACE_CLI_ARGUMENT_WALL",
        schedulerAdded: false,
        providerExecutionPerformed: false,
        githubApiCalled: false,
        rebasePerformed: false,
        ciRerunPerformed: false,
        mergePerformed: false,
        stateMutationPerformed: false,
        authorityGranted: false,
      })
    }
  })

  it("publishes typed static evidence for the merge-race drill", () => {
    expect(MULTI_AGENT_MERGE_RACE_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-049-STALE-BASE-CI-REVIEW-MERGE-RACE-V1",
      status: "CANONICAL_STALE_BASE_CI_REVIEW_MERGE_RACE_VERIFIED",
      workOrderId: "WO-MAO-049",
      planContentHash: PLAN_HASH,
      resultHash: RESULT_HASH,
      dependencyWorkOrders: ["WO-MAO-039", "WO-MAO-040", "WO-MAO-041", "WO-MAO-046"],
      staleBaseControlCount: 3,
      ciReviewOutcomeCount: 4,
      mergeRaceGuardCount: 4,
      flakyRetryBudget: 1,
      maxBaseRefreshes: 2,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      rebasePerformed: false,
      ciRerunPerformed: false,
      mergePerformed: false,
      productionWritePerformed: false,
      stateMutationPerformed: false,
      authorityGranted: false,
    })
    expect(isVerifiedWoMao049MergeRaceEvidence()).toBe(true)
  })
})
