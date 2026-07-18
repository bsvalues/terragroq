import { describe, expect, it } from "vitest"

import {
  MULTI_AGENT_LIVE_FAILURE_RECOVERY_EVIDENCE,
  isVerifiedWoMao057LiveFailureRecoveryEvidence,
} from "@/components/operator/multi-agent-live-failure-recovery-registry"
import {
  LiveFailureRecoveryCertificationError,
  evaluateLiveFailureRecoveryCertification,
  loadCanonicalLiveFailureRecoveryCertification,
  liveFailureRecoveryCertificationPlanContentHash,
  runCanonicalLiveFailureRecoveryCertification,
  verifyCanonicalLiveFailureRecoveryCertification,
} from "../scripts/multi-agent-operator/live-failure-recovery-certification.mjs"

describe("WO-MAO-057 live failure and recovery certification", () => {
  it("certifies the canonical live recovery run and releases WO-MAO-058", () => {
    const result = runCanonicalLiveFailureRecoveryCertification()

    expect(result).toMatchObject({
      workOrderId: "WO-MAO-057",
      status: "LIVE_FAILURE_RECOVERY_CERTIFIED",
      certificationId: "live-failure-recovery-certification-wo-mao-057-v1",
      planContentHash: "7ebf21ccdf75ee8e2726e2011f607177523eb47996e1769c7f608237cbb54b93",
      resultHash: "01d78b8775faac30dd071c3abaf125df1e3438612815d82a2943987a6eac783e",
      repository: "bsvalues/terragroq",
      baseCommitSha: "6b045f885b1a7935ad60110c3096a05bbf28d37c",
      staleBaseRecoveredCommitSha: "21f5e41bfacc5c6d76d743581f3ffb2aaaab2def",
      liveRunId: "wo-mao-057-live-20260717195951",
      staleBaseControlPr: 411,
      downstreamWorkOrderId: "WO-MAO-058",
      downstreamState: "READY_AFTER_LIVE_FAILURE_RECOVERY_CERTIFICATION",
      dependencyCount: 5,
      liveInjectionCount: 5,
      recoveryGateCount: 5,
      ownerOperationRequiredCount: 0,
      reservedPathCount: 16,
      changedPathCount: 16,
      foreignChangeCount: 0,
      secretLikeFindings: 0,
      liveInjectionPerformed: true,
      githubPrLifecycleUsed: true,
      runtimeActivationAllowed: false,
      commandRunnerAdded: false,
      backgroundWorkerAdded: false,
      productionWritePerformed: false,
      secretMaterialAllowed: false,
      ownerOperationRequired: false,
      paidOverageAllowed: false,
      rejectedRuntimeRetried: false,
      authorityGranted: false,
    })
    expect(result.certifiedInjectionClasses).toEqual([
      "COORDINATOR_RESTART",
      "PROVIDER_NETWORK_FAILURE",
      "RESERVATION_COLLISION",
      "STALE_BASE_EVENT",
      "WORKER_DEATH",
    ])
  })

  it("rejects caller-supplied certification input and verifies only the sealed plan", () => {
    expect(() => evaluateLiveFailureRecoveryCertification()).toThrow(LiveFailureRecoveryCertificationError)
    expect(verifyCanonicalLiveFailureRecoveryCertification()).toEqual({
      ok: true,
      code: "LIVE_FAILURE_RECOVERY_CERTIFICATION_PLAN_VERIFIED",
      contentHash: "7ebf21ccdf75ee8e2726e2011f607177523eb47996e1769c7f608237cbb54b93",
      liveInjectionPerformed: true,
      githubPrLifecycleUsed: true,
      ownerOperationRequired: false,
      authorityGranted: false,
    })
    expect(liveFailureRecoveryCertificationPlanContentHash()).toBe(
      "7ebf21ccdf75ee8e2726e2011f607177523eb47996e1769c7f608237cbb54b93",
    )
  })

  it("fails closed when live evidence, revalidation, safety, or dependency claims are weakened", () => {
    const plan = loadCanonicalLiveFailureRecoveryCertification()
    const cases = [
      { ...plan, dependencyEvidence: plan.dependencyEvidence.slice(1) },
      { ...plan, liveInjections: plan.liveInjections.slice(1) },
      { ...plan, liveInjections: [{ ...plan.liveInjections[0], recovered: false }, ...plan.liveInjections.slice(1)] },
      { ...plan, liveInjections: [{ ...plan.liveInjections[0], ownerOperationRequired: true }, ...plan.liveInjections.slice(1)] },
      { ...plan, staleBaseControl: { ...plan.staleBaseControl, revalidated: false } },
      { ...plan, secretScan: { ...plan.secretScan, secretLikeFindings: 1 } },
      { ...plan, safety: { ...plan.safety, authorityGranted: true } },
      { ...plan, safety: { ...plan.safety, runtimeActivationAllowed: true } },
      { ...plan, safety: { ...plan.safety, rejectedRuntimeRetried: true } },
    ]

    for (const value of cases) {
      expect(() => verifyCanonicalLiveFailureRecoveryCertification(value)).toThrow(LiveFailureRecoveryCertificationError)
    }
  })

  it("publishes a tamper-evident registry record", () => {
    expect(MULTI_AGENT_LIVE_FAILURE_RECOVERY_EVIDENCE).toMatchObject({
      workOrderId: "WO-MAO-057",
      status: "CANONICAL_LIVE_FAILURE_RECOVERY_CERTIFICATION_VERIFIED",
      liveInjectionPerformed: true,
      githubPrLifecycleUsed: true,
      ownerOperationRequired: false,
      recordContentHash: "a6ad3360b837a6cf1f16589dfd2d05ae49a8bdb4f237854763ec1a4d34391033",
    })
    expect(isVerifiedWoMao057LiveFailureRecoveryEvidence()).toBe(true)
    expect(isVerifiedWoMao057LiveFailureRecoveryEvidence({
      ...MULTI_AGENT_LIVE_FAILURE_RECOVERY_EVIDENCE,
      liveInjectionCount: 4,
    })).toBe(false)
  })
})
