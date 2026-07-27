import fs from "node:fs"
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"

import {
  recoverExternalToolWall,
  recoverPostMergeCleanupWall,
  recoverReviewedMerge,
  recoverValidationInfrastructureWall,
  runCliEntrypoint,
  sanitizeBridgeMessage,
} from "../scripts/hermes-bridge/cli.mjs"

describe("Hermes bridge CLI", () => {
  it("redacts credential-bearing database URLs from structured wall output", () => {
    expect(sanitizeBridgeMessage("connect failed for postgresql://owner:opaque-password@db.example.test/app"))
      .toBe("connect failed for postgresql://[REDACTED]@db.example.test/app")
  })

  it("flushes output and exits after a completed one-shot command", async () => {
    const events: string[] = []

    await runCliEntrypoint("cycle", {
      run: async (command: string) => {
        events.push(`run:${command}`)
        return 0
      },
      flush: async () => { events.push("flush") },
      exit: (code: number) => { events.push(`exit:${code}`) },
    })

    expect(events).toEqual(["run:cycle", "flush", "exit:0"])
  })

  it("propagates a failed command exit code after flushing output", async () => {
    const events: string[] = []

    await runCliEntrypoint("cycle", {
      run: async () => 1,
      flush: async () => { events.push("flush") },
      exit: (code: number) => { events.push(`exit:${code}`) },
    })

    expect(events).toEqual(["flush", "exit:1"])
  })

  it("reopens local validation state before persisting proof and recovering the outcome", async () => {
    const calls: string[] = []
    const validationFailure = "Error: spawn EPERM"
    const candidate = {
      outcomeId: "5", fencingToken: 14,
      lease: { status: "RELEASED" },
      checkpoint: { sequence: 9, state: "FAILED_TERMINAL", detail: "VALIDATION_REMEDIATION_EXHAUSTED" },
      metadata: { validationFailure },
    }
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "5": candidate },
        }),
        reopenValidationInfrastructureWall: vi.fn(() => { calls.push("state"); return {} }),
      },
    }
    const recordProof = vi.fn(async () => { calls.push("proof"); return true })
    const recoverOutcome = vi.fn(async () => { calls.push("database"); return true })

    await expect(recoverValidationInfrastructureWall({ orchestrator, recordProof, recoverOutcome }))
      .resolves.toMatchObject({ result: "RECOVERED", outcomeId: "5", proofRecorded: true })
    expect(calls).toEqual(["state", "proof", "database"])
    expect(recordProof.mock.calls[0][0]).toMatchObject({ outcomeId: 5, fencingToken: 14 })
    expect(recoverOutcome.mock.calls[0][0].proofDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("recovers one contained external-tool wall through the supported CLI path", () => {
    const recover = vi.fn(() => ({ checkpointSequence: 8 }))
    const root = process.cwd()
    const orchestrator = {
      runtimeRoot: root,
      state: {
        read: () => ({ executions: { "5": {
          outcomeId: "5", fencingToken: 20,
          lease: { status: "ACTIVE", holderId: "stopped-holder" },
          checkpoint: { state: "RETRYABLE_WALL", detail: "APP_SERVER_EXTERNAL_TOOL_WALL" },
        } } }),
        recoverExternalToolWall: recover,
      },
    }
    const read = vi.spyOn(fs, "existsSync")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(false)
    expect(recoverExternalToolWall({ orchestrator })).toMatchObject({
      result: "RECOVERED", outcomeId: "5", checkpointSequence: 8,
    })
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 20, expectedHolderId: "stopped-holder", activationDisabled: true,
    }))
    read.mockRestore()
  })

  it("recovers one exact post-merge cleanup wall through the supported CLI path", () => {
    const recover = vi.fn(() => ({ checkpointSequence: 9 }))
    const root = process.cwd()
    const orchestrator = {
      runtimeRoot: root,
      state: {
        read: () => ({ executions: { "5": {
          outcomeId: "5", fencingToken: 21,
          lease: { status: "ACTIVE", holderId: "stopped-holder" },
          checkpoint: { state: "PR_MERGED", detail: "PR #440 merged" },
          metadata: { prNumber: 440, headRefOid: "a".repeat(40), mergeSha: "b".repeat(40) },
        } } }),
        recoverPostMergeCleanupWall: recover,
      },
    }
    const read = vi.spyOn(fs, "existsSync").mockReturnValue(false)
    expect(recoverPostMergeCleanupWall({ orchestrator })).toMatchObject({
      result: "RECOVERED", outcomeId: "5", checkpointSequence: 9,
    })
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 21, expectedHolderId: "stopped-holder", activationDisabled: true,
    }))
    read.mockRestore()
  })

  it("verifies and finalizes one exact reviewed merge after remediation exhaustion", async () => {
    const candidate = {
      outcomeId: "7",
      fencingToken: 28,
      lease: { status: "RELEASED" },
      checkpoint: {
        sequence: 31,
        state: "FAILED_TERMINAL",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        outcome: {
          id: 7,
          ref: "GOAL-0007",
          command: "Finish the exact recovered WilliamOS outcome.",
          lane: "ui",
          mode: "implement",
          risk: "low",
          authority: "A2_WRITE_OWN",
          status: "classified",
        },
        branch: "codex/hermes-goal-0003-7",
        prNumber: 447, headRefOid: "a".repeat(40), mergeSha: null as string | null,
        reviewRecoveryProofDigest: null as string | null,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 32 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 33 }))
    const cycle = vi.fn(async () => ({ result: "COMPLETE" }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "7": candidate },
        }),
        beginReviewRemediationRecovery: beginRecovery,
        finalizeReviewRemediationRecovery: finalizeRecovery,
      },
      cycle,
    }
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main",
        headRefName: "codex/hermes-goal-0003-7", unresolvedThreadCount: 0,
        checksGreen: true, reviewed: true, headRefOid: "b".repeat(40),
        mergeCommit: { oid: "c".repeat(40) },
      })),
      verifyOriginMainContains: vi.fn(async () => true),
    }
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 77 }))
    const recoverOutcome = vi.fn(async () => true)

    beginRecovery.mockImplementationOnce(() => {
      throw Object.assign(new Error("stale fence"), { code: "FENCING_TOKEN_CONFLICT" })
    })
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).rejects.toMatchObject({ code: "FENCING_TOKEN_CONFLICT" })
    expect(projectCheckpoint).not.toHaveBeenCalled()
    expect(recoverOutcome).not.toHaveBeenCalled()
    expect(cycle).not.toHaveBeenCalled()

    projectCheckpoint.mockRejectedValueOnce(new Error("simulated projection crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).rejects.toThrow("simulated projection crash")
    expect(recoverOutcome).not.toHaveBeenCalled()
    expect(finalizeRecovery).not.toHaveBeenCalled()
    candidate.checkpoint = {
      sequence: 32,
      state: "REVIEW_REMEDIATION_RECOVERY_PENDING",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewRecoveryProofDigest = beginRecovery.mock.calls[1][0].proofDigest

    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "7", prNumber: 447, mergeSha: "c".repeat(40),
    })
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7,
      attempt: 28,
      checkpoint: expect.objectContaining({
        sequence: 33, state: "PR_MERGED",
        metadata: expect.objectContaining({
          headRefOid: "b".repeat(40), mergeSha: "c".repeat(40),
        }),
      }),
    }))
    expect(recoverOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7, prNumber: 447,
      reviewedHeadSha: "b".repeat(40), mergeSha: "c".repeat(40),
    }))
    expect(beginRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 28,
      expectedPriorHeadRefOid: "a".repeat(40),
      headRefOid: "b".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(finalizeRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 28,
      headRefOid: "b".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(cycle).toHaveBeenCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })

    candidate.lease.status = "ABANDONED"
    candidate.checkpoint = {
      sequence: 33,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 33 })
    expect(beginRecovery).toHaveBeenCalledTimes(2)
    expect(finalizeRecovery).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledTimes(2)
    expect(cycle).toHaveBeenLastCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })
    expect(projectCheckpoint).toHaveBeenCalledTimes(2)
    expect(recoverOutcome).toHaveBeenCalledOnce()
  })

  it("accepts a bounded exact-head-reviewed remediation chain for a rate-limited original review", async () => {
    const candidate = {
      outcomeId: "9",
      fencingToken: 37,
      lease: { status: "RELEASED" },
      checkpoint: {
        sequence: 28,
        state: "FAILED_TERMINAL",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        outcome: {
          id: 9,
          ref: "GOAL-0005",
          command: "Add a bounded decision surface.",
          lane: "read_model",
          mode: "implement",
          risk: "low",
          authority: "A0_READ_ONLY",
          status: "classified",
        },
        branch: "codex/hermes-goal-0005-9",
        prNumber: 464,
        headRefOid: "a".repeat(40),
        mergeSha: null,
        reviewRecoveryProofDigest: null,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 29 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 30 }))
    const cycle = vi.fn(async () => ({ result: "COMPLETE" }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "9": candidate },
        }),
        beginReviewRemediationRecovery: beginRecovery,
        finalizeReviewRemediationRecovery: finalizeRecovery,
      },
      cycle,
    }
    const remediationHead = "d".repeat(40)
    const remediationMerge = "e".repeat(40)
    const remediationPath = "scripts/hermes-bridge/outcome-source.mjs"
    const filesDigest = createHash("sha256").update(JSON.stringify([remediationPath])).digest("hex")
    const remediationFiles = vi.fn(async () => ["scripts/hermes-bridge/outcome-source.mjs"])
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main",
        headRefName: "codex/hermes-goal-0005-9", unresolvedThreadCount: 0,
        checksGreen: false, reviewed: false, codeRabbitRateLimited: true,
        failedChecks: [], pendingChecks: [{ name: "CodeRabbit", state: "PENDING" }],
        headRefOid: "b".repeat(40), mergeCommit: { oid: "c".repeat(40) },
      })),
      inspectReviewRemediationClaims: vi.fn(async () => [{
        threadIds: ["PRRT_review"], prNumber: 466,
        headRefOid: remediationHead, mergeSha: remediationMerge, filesDigest,
      }]),
      inspectRemediationPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main", unresolvedThreadCount: 0,
        checksGreen: true, reviewed: true, headRefOid: remediationHead,
        mergeCommit: { oid: remediationMerge },
      })),
      inspectPullRequestFiles: remediationFiles,
      verifyOriginMainContains: vi.fn(async () => true),
    }
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 99 }))
    const recoverOutcome = vi.fn(async () => true)

    remediationFiles.mockResolvedValueOnce(["package.json"])
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).rejects.toMatchObject({ code: "HERMES_REVIEW_RECOVERY_PROOF_WALL" })
    expect(beginRecovery).not.toHaveBeenCalled()

    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "9", prNumber: 464, mergeSha: "c".repeat(40),
    })
    expect(beginRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      expectedPriorHeadRefOid: "a".repeat(40),
      headRefOid: "b".repeat(40),
      mergeSha: "c".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        state: "PR_MERGED",
        metadata: expect.objectContaining({ remediationPullRequests: [466] }),
      }),
    }))
    expect(lifecycle.verifyOriginMainContains).toHaveBeenCalledWith("c".repeat(40))
    expect(lifecycle.verifyOriginMainContains).toHaveBeenCalledWith(remediationMerge)
  })
})
