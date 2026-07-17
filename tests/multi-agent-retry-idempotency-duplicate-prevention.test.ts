import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  evaluateRetryIdempotencyDuplicatePrevention,
  loadCanonicalRetryIdempotencyDuplicatePreventionPlan,
  retryIdempotencyDuplicatePreventionPlanContentHash,
  RetryIdempotencyDuplicatePreventionError,
  runCanonicalRetryIdempotencyDuplicatePrevention,
  verifyCanonicalRetryIdempotencyDuplicatePreventionPlan,
} from "../scripts/multi-agent-operator/retry-idempotency-duplicate-prevention.mjs"
import {
  isVerifiedWoMao046RetryIdempotencyEvidence,
  MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE,
} from "../components/operator/multi-agent-retry-idempotency-registry"

const PLAN_HASH = "a1c34c2b835e19d6c4079e20e10109382ac26e6334933b37f1535128db37f618"
const RESULT_HASH = "807c2da8ab932dce2371b93356bb2cc83c97460c4c7196001de276b5c8f1554d"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected retry idempotency wall")
  } catch (error) {
    expect(error).toBeInstanceOf(RetryIdempotencyDuplicatePreventionError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-046 retry, idempotency, and duplicate prevention", () => {
  it("proves retry and duplicate prevention without running providers or schedulers", () => {
    const result = runCanonicalRetryIdempotencyDuplicatePrevention()
    expect(result).toMatchObject({
      schemaVersion: 1,
      artifactType: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_RESULT",
      workOrderId: "WO-MAO-046",
      status: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PROVEN",
      planId: "retry-idempotency-duplicate-prevention-wo-mao-046-v1",
      planContentHash: PLAN_HASH,
      repository: "bsvalues/terragroq",
      baseRef: "refs/heads/main",
      baseCommitSha: "e3f3b02b7bea5f062e7a4dbd63cfe918dae6edb2",
      baseTreeHash: "7387f4dc3ba56e0ffb92cf29aac7043adb0059aa",
      dependencyWorkOrders: ["WO-MAO-021", "WO-MAO-035", "WO-MAO-044"],
      maxAttempts: 3,
      replaySource: "DURABLE_CHECKPOINT_ONLY",
      checkpointMode: "COMPARE_AND_SWAP_REQUIRED",
      conflictDecision: "STOP_DUPLICATE_DO_NOT_REPLAY",
      dedupeWindow: "WORK_ORDER_LIFETIME",
      dependencyCount: 3,
      retryableClassCount: 3,
      terminalClassCount: 4,
      backoffStepCount: 3,
      idempotencyKeyCount: 4,
      duplicateFenceCount: 5,
      duplicateOutcomeCount: 3,
      reservedPathCount: 5,
      changedPathCount: 5,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      productionWritePerformed: false,
      stateMutationPerformed: false,
      authorityGranted: false,
      resultHash: RESULT_HASH,
    })
    expect(result.orderedOperations).toEqual([
      "LOAD_DURABLE_CHECKPOINT",
      "VERIFY_LEASE_AND_IDEMPOTENCY_KEYS",
      "CLASSIFY_RETRYABLE_OR_TERMINAL_FAILURE",
      "APPLY_DUPLICATE_FENCES",
      "STOP_DUPLICATE_OR_CONFLICT_REPLAY",
      "RECORD_STATIC_DECISION_EVIDENCE_ONLY",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId/i)
  })

  it("rejects caller-supplied retry input and pins the canonical plan", () => {
    expect(runCanonicalRetryIdempotencyDuplicatePrevention()).toEqual(runCanonicalRetryIdempotencyDuplicatePrevention())
    expectWall(() => evaluateRetryIdempotencyDuplicatePrevention({ retryNow: true }), "RETRY_IDEMPOTENCY_HOST_TRUST_WALL")
    expect(verifyCanonicalRetryIdempotencyDuplicatePreventionPlan()).toMatchObject({
      ok: true,
      code: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PLAN_VERIFIED",
      contentHash: PLAN_HASH,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, retry, idempotency, duplicate, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-999" },
      (value: any) => { value.retryPolicy.maxAttempts = 9 },
      (value: any) => { value.retryPolicy.replaySource = "LIVE_PROVIDER_REPLAY" },
      (value: any) => { value.retryPolicy.retryableClasses.push("provider-temporary-unavailable") },
      (value: any) => { value.idempotencyPolicy.requiredKeys.pop() },
      (value: any) => { value.idempotencyPolicy.conflictDecision = "REPLAY_ANYWAY" },
      (value: any) => { value.duplicatePrevention.fences = ["lease-token-fence"] },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.checkpointVerified = false },
      (value: any) => { value.safety.schedulerAdded = true },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalRetryIdempotencyDuplicatePreventionPlan())
      mutate(plan)
      expect(retryIdempotencyDuplicatePreventionPlanContentHash(plan)).not.toBe(PLAN_HASH)
      expectWall(() => verifyCanonicalRetryIdempotencyDuplicatePreventionPlan(plan), "RETRY_IDEMPOTENCY_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/retry-idempotency-duplicate-prevention-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_PROVEN",
      resultHash: RESULT_HASH,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      stateMutationPerformed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--retry", JSON.stringify({ token: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/retry-idempotency-duplicate-prevention-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "RETRY_IDEMPOTENCY_CLI_ARGUMENT_WALL",
        schedulerAdded: false,
        providerExecutionPerformed: false,
        githubApiCalled: false,
        stateMutationPerformed: false,
        authorityGranted: false,
      })
    }
  })

  it("publishes typed static evidence for the retry idempotency proof", () => {
    expect(MULTI_AGENT_RETRY_IDEMPOTENCY_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-046-RETRY-IDEMPOTENCY-DUPLICATE-PREVENTION-V1",
      status: "CANONICAL_RETRY_IDEMPOTENCY_DUPLICATE_PREVENTION_VERIFIED",
      workOrderId: "WO-MAO-046",
      planContentHash: PLAN_HASH,
      resultHash: RESULT_HASH,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      productionWritePerformed: false,
      stateMutationPerformed: false,
      authorityGranted: false,
    })
    expect(isVerifiedWoMao046RetryIdempotencyEvidence()).toBe(true)
  })
})
