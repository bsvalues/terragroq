import { spawnSync } from "node:child_process"

import { describe, expect, it } from "vitest"

import {
  isVerifiedWoMao047WorkerRecoveryEvidence,
  MULTI_AGENT_WORKER_RECOVERY_EVIDENCE,
} from "@/components/operator/multi-agent-worker-recovery-registry"
import {
  evaluateWorkerCoordinatorRecovery,
  loadCanonicalWorkerCoordinatorRecoveryPlan,
  runCanonicalWorkerCoordinatorRecovery,
  verifyCanonicalWorkerCoordinatorRecoveryPlan,
  workerCoordinatorRecoveryPlanContentHash,
  WorkerCoordinatorRecoveryError,
} from "../scripts/multi-agent-operator/worker-coordinator-recovery.mjs"

const PLAN_HASH = "d74b5b5702d86333a9e4a535c1780453e02122a58d998f1bc1b86e57cbc1efd6"
const RESULT_HASH = "677aa418c40a7a5429a1d703b460a01599aef9fbbd135e54eb521f2a1d7ac8cd"
const EVIDENCE_HASH = "a3196e4a46dfe4fd64e45ab316bb1216ea37b022d0b999ec18842a0ca7683667"

function expectWall(callback: () => unknown, code: string) {
  try {
    callback()
    throw new Error("expected worker coordinator recovery wall")
  } catch (error) {
    expect(error).toBeInstanceOf(WorkerCoordinatorRecoveryError)
    expect(error).toMatchObject({ code })
  }
}

describe("WO-MAO-047 worker and coordinator recovery", () => {
  it("proves recovery from durable state without providers, process control, or concurrent writers", () => {
    const result = runCanonicalWorkerCoordinatorRecovery()
    expect(result).toMatchObject({
      artifactType: "WORKER_COORDINATOR_RECOVERY_RESULT",
      workOrderId: "WO-MAO-047",
      status: "WORKER_COORDINATOR_RECOVERY_PROVEN",
      recoveryId: "worker-coordinator-recovery-wo-mao-047-v1",
      planContentHash: PLAN_HASH,
      baseCommitSha: "8d875ab97ddd8159da37bff80ca41dfa2fe3d9dc",
      baseTreeHash: "a4240f8508f3c95671250e6fb677efa3dff6baea",
      dependencyWorkOrders: ["WO-MAO-021", "WO-MAO-025", "WO-MAO-030", "WO-MAO-031", "WO-MAO-046"],
      dependencyCount: 5,
      durableSourceCount: 5,
      recoveryScenarioCount: 5,
      concurrencyFenceCount: 6,
      reservedPathCount: 5,
      changedPathCount: 5,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      schedulerAdded: false,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      githubWritePerformed: false,
      processControlPerformed: false,
      concurrentWritersAllowed: false,
      authorityGranted: false,
      resultHash: RESULT_HASH,
    })
    expect(result.recoveryPoints).toEqual([
      "death-after-commit",
      "death-after-push",
      "death-before-write",
      "death-during-edit",
      "death-with-pr-open",
    ])
    expect(result.orderedOperations).toEqual([
      "LOAD_DURABLE_LEASE_CHECKPOINT_AND_WORKSPACE_RECORDS",
      "CLASSIFY_LAST_DURABLE_RECOVERY_POINT",
      "VERIFY_EXPIRED_OR_RENEWABLE_SINGLE_WRITER_LEASE",
      "RECONCILE_OWNED_WORKSPACE_REMOTE_REF_AND_PR_LINKAGE",
      "APPLY_IDEMPOTENCY_AND_CONCURRENCY_FENCES",
      "RESUME_FROM_DURABLE_STATE_OR_STOP_TYPED_AMBIGUITY",
      "RECORD_STATIC_RECOVERY_EVIDENCE_ONLY",
    ])
    expect(JSON.stringify(result)).not.toMatch(/password|privateKey|accessToken|rawCredential|cookie|sessionId|token/i)
  })

  it("rejects caller-supplied recovery input and pins the canonical plan", () => {
    expect(runCanonicalWorkerCoordinatorRecovery()).toEqual(runCanonicalWorkerCoordinatorRecovery())
    expectWall(() => evaluateWorkerCoordinatorRecovery({ restartWorker: true }), "WORKER_COORDINATOR_RECOVERY_HOST_TRUST_WALL")
    expect(verifyCanonicalWorkerCoordinatorRecoveryPlan()).toMatchObject({
      ok: true,
      code: "WORKER_COORDINATOR_RECOVERY_PLAN_VERIFIED",
      contentHash: PLAN_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      githubWritePerformed: false,
      processControlPerformed: false,
      concurrentWritersAllowed: false,
      authorityGranted: false,
    })
  })

  it("fails closed on dependency, durable source, scenario, fence, path, secret, authority, and safety mutation", () => {
    for (const mutate of [
      (value: any) => { value.dependencyEvidence[0].workOrderId = "WO-MAO-999" },
      (value: any) => { value.durableSources.pop() },
      (value: any) => { value.recoveryScenarios[0].name = "unsupported-failure" },
      (value: any) => { value.recoveryScenarios[1].writerPolicy = "ALLOW_CONCURRENT_WRITERS" },
      (value: any) => { value.concurrencyFences[0].decision = "ALLOW_SECOND_WRITER" },
      (value: any) => { value.changedPaths.push("README.md") },
      (value: any) => { value.changedPaths[0] = ".env.local" },
      (value: any) => { value.secretScan.secretLikeFindings = 1 },
      (value: any) => { value.authority.retryIdempotencyVerified = false },
      (value: any) => { value.safety.githubApiCalled = true },
      (value: any) => { value.safety.processControlPerformed = true },
      (value: any) => { value.safety.concurrentWritersAllowed = true },
      (value: any) => { value.unexpected = true },
    ]) {
      const plan = structuredClone(loadCanonicalWorkerCoordinatorRecoveryPlan())
      mutate(plan)
      expect(workerCoordinatorRecoveryPlanContentHash(plan)).not.toBe(PLAN_HASH)
      expectWall(() => verifyCanonicalWorkerCoordinatorRecoveryPlan(plan), "WORKER_COORDINATOR_RECOVERY_PLAN_INTEGRITY_WALL")
    }
  })

  it("exposes only the zero-input CLI and rejects caller arguments", () => {
    const passed = spawnSync(process.execPath,
      ["scripts/multi-agent-operator/worker-coordinator-recovery-cli.mjs"], { encoding: "utf8" })
    expect(passed.status).toBe(0)
    expect(JSON.parse(passed.stdout)).toMatchObject({
      ok: true,
      status: "WORKER_COORDINATOR_RECOVERY_PROVEN",
      resultHash: RESULT_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      githubWritePerformed: false,
      processControlPerformed: false,
      concurrentWritersAllowed: false,
      authorityGranted: false,
    })

    for (const argument of ["input.json", "--restart-worker", JSON.stringify({ marker: "x" })]) {
      const rejected = spawnSync(process.execPath,
        ["scripts/multi-agent-operator/worker-coordinator-recovery-cli.mjs", argument], { encoding: "utf8" })
      expect(rejected.status).toBe(2)
      expect(JSON.parse(rejected.stdout)).toMatchObject({
        ok: false,
        code: "WORKER_COORDINATOR_RECOVERY_CLI_ARGUMENT_WALL",
        providerExecutionPerformed: false,
        githubApiCalled: false,
        githubWritePerformed: false,
        processControlPerformed: false,
        concurrentWritersAllowed: false,
        authorityGranted: false,
      })
    }
  })

  it("publishes tamper-evident typed evidence for the recovery proof", () => {
    expect(isVerifiedWoMao047WorkerRecoveryEvidence()).toBe(true)
    expect(MULTI_AGENT_WORKER_RECOVERY_EVIDENCE).toMatchObject({
      evidenceId: "EVIDENCE-WO-MAO-047-WORKER-COORDINATOR-RECOVERY-V1",
      status: "CANONICAL_WORKER_COORDINATOR_RECOVERY_VERIFIED",
      planContentHash: PLAN_HASH,
      resultHash: RESULT_HASH,
      recordContentHash: EVIDENCE_HASH,
      providerExecutionPerformed: false,
      githubApiCalled: false,
      githubWritePerformed: false,
      processControlPerformed: false,
      concurrentWritersAllowed: false,
      authorityGranted: false,
    })
  })
})
