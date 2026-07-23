import fs from "node:fs"
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
        prNumber: 447, headRefOid: "b".repeat(40), mergeSha: null as string | null,
        reviewRecoveryProofDigest: null as string | null,
      },
    }
    const reopen = vi.fn(() => ({ checkpointSequence: 32 }))
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
        reopenReviewRemediationExhausted: reopen,
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

    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "7", prNumber: 447, mergeSha: "c".repeat(40),
    })
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7,
      attempt: 28,
      checkpoint: expect.objectContaining({
        sequence: 32, state: "PR_MERGED",
        metadata: expect.objectContaining({
          headRefOid: "b".repeat(40), mergeSha: "c".repeat(40),
        }),
      }),
    }))
    expect(recoverOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7, prNumber: 447,
      reviewedHeadSha: "b".repeat(40), mergeSha: "c".repeat(40),
    }))
    expect(reopen).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 28, proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(cycle).toHaveBeenCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })

    candidate.lease.status = "ABANDONED"
    candidate.checkpoint = {
      sequence: 32,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryProofDigest = reopen.mock.calls[0][0].proofDigest
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 32 })
    expect(reopen).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledTimes(2)
    expect(cycle).toHaveBeenLastCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })
    expect(projectCheckpoint).toHaveBeenCalledOnce()
    expect(recoverOutcome).toHaveBeenCalledOnce()
  })
})
