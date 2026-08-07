import fs from "node:fs"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  captureRuntimeAgreement,
  createResidentHermesOrchestrator,
  recoverExternalToolWall,
  recoverOrphanedValidationCycle,
  recoverPostMergeCleanupWall,
  recoverReviewedMerge,
  recoverTerminalPostMergeCleanupWall,
  recoverValidationInfrastructureWall,
  redactHermesStatus,
  printHermesCycleResult,
  runHermesQueueDrain,
  runCliEntrypoint,
  sanitizeBridgeMessage,
} from "../scripts/hermes-bridge/cli.mjs"
import { initializeHermesState } from "../scripts/hermes-bridge/state-store.mjs"

describe("Hermes bridge CLI", () => {
  it("wires durable review recovery through the resident queue runtime", async () => {
    const resumeAfterReviewRecovery = vi.fn()
    const close = vi.fn(async () => {})
    const queueRuntime = {
      selectOutcome: vi.fn(), completeOutcome: vi.fn(), terminalizeOutcome: vi.fn(),
      deferOutcome: vi.fn(), renewOutcomeLease: vi.fn(), bindWorkOrder: vi.fn(),
      refreshOutcome: vi.fn(), resumeAfterOwnerDecision: vi.fn(),
      resumeAfterValidationRecovery: vi.fn(), resumeAfterReviewRecovery, close,
    }
    const createOrchestrator = vi.fn(() => ({ cycle: vi.fn() }))

    const resident = createResidentHermesOrchestrator({ queueRuntime, createOrchestrator })

    expect(createOrchestrator).toHaveBeenCalledWith(expect.objectContaining({
      resumeQueueAfterReviewRecovery: resumeAfterReviewRecovery,
    }))
    await resident.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it("delegates orphaned validation recovery to the guarded orchestrator operation", async () => {
    const recoverOrphanedValidationCycleLease = vi.fn(async () => ({
      result: "RECOVERED", outcomeId: "12", fencingToken: 78, replayed: false,
    }))

    await expect(recoverOrphanedValidationCycle({
      orchestrator: { recoverOrphanedValidationCycleLease },
    })).resolves.toEqual({ result: "RECOVERED", outcomeId: "12", fencingToken: 78, replayed: false })
    expect(recoverOrphanedValidationCycleLease).toHaveBeenCalledOnce()
  })

  it("runs the real read-only status command without supervisor proof context", () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cli-status-"))
    const statePath = path.join(runtimeRoot, "state", "state.json")
    initializeHermesState(statePath, { now: () => new Date("2026-07-28T12:00:00.000Z") })

    try {
      const result = spawnSync(
        process.execPath,
        ["scripts/hermes-bridge/cli.mjs", "status"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...process.env,
            WILLIAMOS_HERMES_RUNTIME_ROOT: runtimeRoot,
            HERMES_CAMPAIGN_WINDOW_ID: "",
            HERMES_PROCESS_IDENTITY: "",
          },
        },
      )

      expect(result.status).toBe(0)
      expect(result.stderr).toBe("")
      expect(JSON.parse(result.stdout.trim())).toMatchObject({
        schemaVersion: 1,
        storeId: "hermes-bridge",
        revision: 0,
      })
    } finally {
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it("captures the production agreement through sanitized runtime-owned paths", async () => {
    const producer = vi.fn(async () => ({
      schemaVersion: 1,
      observedAt: "2026-07-28T18:00:00.000Z",
      mode: "HEALTHY_IDLE",
      queue: null,
      local: null,
      workOrder: null,
    }))
    const root = "C:\\runtime-agreement"

    await expect(captureRuntimeAgreement({
      runtimeRoot: root,
      databaseUrl: "configured-outside-output",
      producer,
      now: () => 1,
    })).resolves.toMatchObject({ mode: "HEALTHY_IDLE" })
    expect(producer).toHaveBeenCalledWith({
      statePath: path.join(root, "state", "state.json"),
      outputPath: path.join(root, "evidence", "queue-runtime-agreement.json"),
      databaseUrl: "configured-outside-output",
      query: undefined,
      createPool: undefined,
      now: expect.any(Function),
    })
    expect(JSON.stringify(await producer.mock.results[0].value)).not.toMatch(
      /leaseToken|executionBinding|acquisitionKey/,
    )
  })

  it("redacts durable queue capabilities from status projections at every depth", () => {
    const status = redactHermesStatus({
      executions: {
        "77": {
          metadata: {
            outcome: {
              queueBinding: {
                outcomeKey: "outcome:77",
                leaseToken: "lease-secret",
                executionBinding: "execution-secret",
                acquisitionKey: "acquisition-secret",
                fencingToken: 3,
              },
            },
          },
        },
      },
      idempotency: {
        acquire: {
          result: {
            metadata: {
              outcome: {
                queueBinding: {
                  leaseToken: "receipt-lease",
                  acquisitionKey: "receipt-acquisition",
                },
              },
            },
          },
        },
      },
    })

    expect(JSON.stringify(status)).not.toMatch(/lease-secret|execution-secret|acquisition-secret|receipt-lease|receipt-acquisition/)
    expect(status.executions["77"].metadata.outcome.queueBinding).toEqual({
      outcomeKey: "outcome:77",
      fencingToken: 3,
    })
  })

  it("continues immediately through settled queue outcomes until the queue is drained", async () => {
    const cycle = vi.fn()
      .mockResolvedValueOnce({ result: "COMPLETE", outcomeId: "77", prNumber: 475, mergeSha: "a".repeat(40) })
      .mockResolvedValueOnce({ result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" })
      .mockResolvedValueOnce({ result: "NO_ELIGIBLE_OUTCOME" })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, maxOutcomes: 3 }))
      .resolves.toEqual({
        result: "QUEUE_DRAINED",
        settled: [
          { result: "COMPLETE", outcomeId: "77", prNumber: 475, mergeSha: "a".repeat(40) },
          { result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" },
        ],
        stopReason: "NO_ELIGIBLE_OUTCOME",
      })
    expect(cycle).toHaveBeenCalledTimes(3)
  })

  it("consumes a Primary decision exactly once before the first queue cycle", async () => {
    const calls: string[] = []
    const consumeDecision = vi.fn(async () => {
      calls.push("decision")
      return { status: "NO_PENDING_PRIMARY_DECISION" }
    })
    const cycle = vi.fn(async () => {
      calls.push("cycle")
      return { result: "NO_ELIGIBLE_OUTCOME" }
    })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual({ result: "NO_ELIGIBLE_OUTCOME" })
    expect(consumeDecision).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledOnce()
    expect(calls).toEqual(["decision", "cycle"])
  })

  it("returns an exact pending Primary request without starting a queue cycle", async () => {
    const pending = {
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
      requestDigest: "a".repeat(64),
      prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact",
    }
    const consumeDecision = vi.fn(async () => pending)
    const cycle = vi.fn()

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual(pending)
    expect(consumeDecision).toHaveBeenCalledOnce()
    expect(cycle).not.toHaveBeenCalled()
  })

  it("prints only the canonical prompt for a pending Primary decision", () => {
    const writes: string[] = []
    printHermesCycleResult({
      status: "PENDING_PRIMARY_DECISION",
      outcomeId: 77,
      requestDigest: "a".repeat(64),
      prompt: "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact\nReply only Approve or Deny",
    }, (value) => writes.push(String(value)))

    expect(writes).toEqual([
      "WILLIAMOS_PRIMARY_DECISION_REQUEST:exact\nReply only Approve or Deny\n",
    ])
  })

  it("surfaces a recorded Primary decision with the resulting queue state", async () => {
    const decision = {
      status: "PRIMARY_DECISION_RECORDED",
      outcomeId: 77,
      choice: "APPROVE",
      resumeReleased: true,
      decisionRef: "OWNER-DECISION-77-120",
    }
    const consumeDecision = vi.fn(async () => decision)
    const cycle = vi.fn(async () => ({ result: "NO_ELIGIBLE_OUTCOME" }))

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .resolves.toEqual({ result: "NO_ELIGIBLE_OUTCOME", decision })
  })

  it("does not start a queue cycle when Primary decision intake fails", async () => {
    const wall = Object.assign(new Error("decision provenance unavailable"), {
      code: "PRIMARY_DECISION_PROVENANCE_WALL",
    })
    const consumeDecision = vi.fn().mockRejectedValue(wall)
    const cycle = vi.fn()

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, consumeDecision }))
      .rejects.toBe(wall)
    expect(consumeDecision).toHaveBeenCalledOnce()
    expect(cycle).not.toHaveBeenCalled()
  })

  it("preserves settled outcomes when the bounded drain budget is exhausted", async () => {
    const cycle = vi.fn()
      .mockResolvedValueOnce({ result: "COMPLETE", outcomeId: "77", mergeSha: "a".repeat(40) })
      .mockResolvedValueOnce({ result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" })

    await expect(runHermesQueueDrain({ orchestrator: { cycle }, maxOutcomes: 2 }))
      .rejects.toMatchObject({
        code: "HERMES_QUEUE_DRAIN_BUDGET_WALL",
        settled: [
          { result: "COMPLETE", outcomeId: "77", mergeSha: "a".repeat(40) },
          { result: "FAILED_TERMINAL", outcomeId: "78", nextState: "VALIDATION_FAILED" },
        ],
      })
  })

  it("abandons any exact cycle-owned lease when queue draining exits", async () => {
    const abandonOwnedCycleLease = vi.fn(() => ({ abandoned: true, outcomeId: "77" }))
    const cycle = vi.fn().mockRejectedValue(
      Object.assign(new Error("projection unavailable"), { code: "HERMES_RUNTIME_PROJECTION_WALL" }),
    )

    await expect(runHermesQueueDrain({ orchestrator: { cycle, abandonOwnedCycleLease } }))
      .rejects.toMatchObject({ code: "HERMES_RUNTIME_PROJECTION_WALL" })
    expect(abandonOwnedCycleLease).toHaveBeenCalledOnce()
  })

  it("preserves the primary cycle wall when exit cleanup also fails", async () => {
    const cycleWall = Object.assign(new Error("projection unavailable"), {
      code: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    const cleanupWall = Object.assign(new Error("cleanup projection unavailable"), {
      code: "HERMES_EXECUTION_CONCURRENCY_WALL",
    })
    const abandonOwnedCycleLease = vi.fn().mockRejectedValue(cleanupWall)
    const cycle = vi.fn().mockRejectedValue(cycleWall)

    await expect(runHermesQueueDrain({ orchestrator: { cycle, abandonOwnedCycleLease } }))
      .rejects.toBe(cycleWall)
    expect(abandonOwnedCycleLease).toHaveBeenCalledOnce()
  })

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
        reopenValidationInfrastructureWall: vi.fn(() => { calls.push("state"); return { fencingToken: 15 } }),
      },
    }
    const recordProof = vi.fn(async () => { calls.push("proof"); return true })
    const recoverOutcome = vi.fn(async () => { calls.push("database"); return true })

    await expect(recoverValidationInfrastructureWall({ orchestrator, recordProof, recoverOutcome }))
      .resolves.toMatchObject({ result: "RECOVERED", outcomeId: "5", proofRecorded: true })
    expect(calls).toEqual(["proof", "state", "database"])
    expect(recordProof.mock.calls[0][0]).toMatchObject({ outcomeId: 5, fencingToken: 14 })
    expect(recoverOutcome.mock.calls[0][0].proofDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it("leaves local validation state untouched when durable terminal proof is absent", async () => {
    const reopenValidationInfrastructureWall = vi.fn()
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": {
            outcomeId: "12", fencingToken: 72,
            lease: { status: "RELEASED" },
            checkpoint: {
              sequence: 86, state: "FAILED_TERMINAL",
              detail: "VALIDATION_REMEDIATION_EXHAUSTED",
            },
            metadata: { validationFailure: "Error: spawn EPERM" },
          } },
        }),
        reopenValidationInfrastructureWall,
      },
    }
    const recoverOutcome = vi.fn()

    await expect(recoverValidationInfrastructureWall({
      orchestrator,
      recordProof: vi.fn(async () => false),
      recoverOutcome,
    })).rejects.toMatchObject({ code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL" })
    expect(reopenValidationInfrastructureWall).not.toHaveBeenCalled()
    expect(recoverOutcome).not.toHaveBeenCalled()
  })

  it("classifies a missing isolated-worktree Vitest executable as recoverable infrastructure", async () => {
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const candidate = {
      outcomeId: "12", fencingToken: 54,
      lease: { status: "RELEASED" },
      checkpoint: { sequence: 25, state: "FAILED_TERMINAL", detail: "VALIDATION_REMEDIATION_EXHAUSTED" },
      metadata: { validationFailure },
    }
    const reopenValidationInfrastructureWall = vi.fn(() => ({ checkpointSequence: 26, fencingToken: 55 }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": candidate },
        }),
        reopenValidationInfrastructureWall,
      },
    }
    const recordProof = vi.fn(async () => true)
    const recoverOutcome = vi.fn(async () => true)

    await expect(recoverValidationInfrastructureWall({ orchestrator, recordProof, recoverOutcome }))
      .resolves.toMatchObject({ result: "RECOVERED", outcomeId: "12", proofRecorded: true })
    expect(reopenValidationInfrastructureWall).toHaveBeenCalledOnce()
  })

  it("reopens validation infrastructure after an exact cycle-exit abandonment", async () => {
    const validationFailure = "npm run lint exited 1\nFailed to load plugin 'react-hooks' declared in eslint-config-next: Cannot find module 'eslint-plugin-react-hooks'"
    const abandonedAt = "2026-08-06T07:27:19.027Z"
    const candidate = {
      outcomeId: "12", fencingToken: 72,
      lease: {
        status: "ACTIVE", abandonedAt, expiresAt: abandonedAt,
        abandonReason: "HERMES_CYCLE_PROCESS_EXIT",
      },
      checkpoint: {
        sequence: 86, state: "FAILED_TERMINAL",
        detail: "VALIDATION_REMEDIATION_EXHAUSTED",
      },
      metadata: { validationFailure },
    }
    const reopenValidationInfrastructureWall = vi.fn(() => ({ checkpointSequence: 87, fencingToken: 73 }))
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": candidate },
        }),
        reopenValidationInfrastructureWall,
      },
    }

    await expect(recoverValidationInfrastructureWall({
      orchestrator,
      recordProof: vi.fn(async ({ fencingToken }) => fencingToken === 72),
      recoverOutcome: vi.fn(async () => true),
    })).resolves.toMatchObject({ result: "RECOVERED", outcomeId: "12" })
    expect(reopenValidationInfrastructureWall).toHaveBeenCalledOnce()
  })

  it.each([
    [{ status: "ACTIVE", expiresAt: "2026-08-06T07:27:19.027Z" }, "missing abandonment"],
    [{
      status: "ACTIVE",
      abandonedAt: "2026-08-06T07:27:18.000Z",
      expiresAt: "2026-08-06T07:27:19.027Z",
      abandonReason: "HERMES_CYCLE_PROCESS_EXIT",
    }, "mismatched abandonment"],
    [{
      status: "ACTIVE",
      abandonedAt: "2026-08-06T07:27:19.027Z",
      expiresAt: "2026-08-06T07:27:19.027Z",
      abandonReason: "MANUAL",
    }, "non-cycle-exit abandonment"],
  ])("rejects an ACTIVE validation terminal with %s", async (lease) => {
    const validationFailure = "npm run lint exited 1\nFailed to load plugin 'react-hooks' declared in eslint-config-next: Cannot find module 'eslint-plugin-react-hooks'"
    const orchestrator = {
      state: {
        read: () => ({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "12": {
            outcomeId: "12", fencingToken: 72, lease,
            checkpoint: {
              sequence: 86, state: "FAILED_TERMINAL",
              detail: "VALIDATION_REMEDIATION_EXHAUSTED",
            },
            metadata: { validationFailure },
          } },
        }),
        reopenValidationInfrastructureWall: vi.fn(),
      },
    }

    await expect(recoverValidationInfrastructureWall({ orchestrator }))
      .rejects.toMatchObject({ code: "HERMES_VALIDATION_RECOVERY_CANDIDATE_WALL" })
    expect(orchestrator.state.reopenValidationInfrastructureWall).not.toHaveBeenCalled()
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

  it("verifies cleanup before reopening one exhausted terminal post-merge wall", async () => {
    const candidate = {
      outcomeId: "5",
      fencingToken: 22,
      lease: { status: "RELEASED" },
      checkpoint: {
        sequence: 12,
        state: "FAILED_TERMINAL",
        detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        outcome: {
          id: 5,
          ref: "GOAL-0005",
          command: "Deliver the bounded WilliamOS feature.",
          lane: "read_model",
          mode: "implement",
          risk: "low",
          authority: "A0_READ_ONLY",
          status: "classified",
        },
        branch: "codex/hermes-goal-0005-5",
        worktreePath: "C:\\owned\\hermes-goal-0005-5",
        prNumber: 440,
        headRefOid: "a".repeat(40),
        mergeSha: "b".repeat(40),
        postMergeCleanupRetryCount: 3,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 13 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 14 }))
    const orchestrator = {
      runtimeRoot: process.cwd(),
      state: {
        read: vi.fn().mockReturnValue({
          ownerTouchCounters: {
            OWNER_OPERATION_TOUCH_COUNT: 0,
            OWNER_CREDENTIAL_TOUCH_COUNT: 0,
            OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
            OWNER_ROUTINE_DECISION_COUNT: 0,
            OWNER_ROUTINE_CONTACT_COUNT: 0,
          },
          executions: { "5": candidate },
        }),
        beginTerminalPostMergeCleanupRecovery: beginRecovery,
        finalizeTerminalPostMergeCleanupRecovery: finalizeRecovery,
      },
    }
    const lifecycle = {
      inspectPullRequest: vi.fn(async () => ({
        state: "MERGED",
        baseRefName: "main",
        headRefName: candidate.metadata.branch,
        headRefOid: candidate.metadata.headRefOid,
        mergeCommit: { oid: candidate.metadata.mergeSha },
        unresolvedThreadCount: 0,
      })),
      verifyOriginMainContains: vi.fn(async () => true),
      resumeOwnedWorktree: vi.fn(async () => ({ resumed: true })),
      removeTerminalRecoveryDependencies: vi.fn(async () => ({
        removed: true,
        headRefOid: candidate.metadata.headRefOid,
      })),
      cleanupOwnedWorktree: vi.fn(async () => ({ cleaned: true })),
    }
    const projectCheckpoint = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("temporary dns"), { code: "ENOTFOUND" }))
      .mockResolvedValue(true)
    const recoverOutcome = vi.fn(async () => true)
    const read = vi.spyOn(fs, "existsSync").mockImplementation((target) =>
      target === candidate.metadata.worktreePath)

    try {
      await expect(recoverTerminalPostMergeCleanupWall({
        orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
        projectionSleep: async () => {},
      })).resolves.toMatchObject({
        result: "RECOVERED",
        outcomeId: "5",
        prNumber: 440,
        mergeSha: "b".repeat(40),
        checkpointSequence: 14,
      })
      expect(lifecycle.cleanupOwnedWorktree).toHaveBeenCalledWith({
        branch: candidate.metadata.branch,
        worktreePath: candidate.metadata.worktreePath,
        mergeCommitSha: candidate.metadata.mergeSha,
        expectedHeadSha: candidate.metadata.headRefOid,
      })
      expect(beginRecovery).toHaveBeenCalledBefore(lifecycle.cleanupOwnedWorktree)
      expect(finalizeRecovery).toHaveBeenCalledAfter(lifecycle.cleanupOwnedWorktree)
      expect(projectCheckpoint).toHaveBeenCalledWith({
        outcomeId: 5,
        attempt: 22,
        checkpoint: {
          sequence: 14,
          state: "POST_MERGE_CLEANUP_RECOVERED",
          detail: "PR #440",
          metadata: {
            prNumber: 440,
            headRefOid: candidate.metadata.headRefOid,
            mergeSha: candidate.metadata.mergeSha,
            terminalCleanupRecoveryProofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        },
      })
      expect(projectCheckpoint).toHaveBeenCalledTimes(2)
      expect(recoverOutcome).toHaveBeenCalledWith({
        outcomeId: 5,
        prNumber: 440,
        reviewedHeadSha: candidate.metadata.headRefOid,
        mergeSha: candidate.metadata.mergeSha,
        proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
    } finally {
      read.mockRestore()
    }
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
        reviewProjectionReconciledFromSequence: null as number | null,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 32 }))
    const recordMerge = vi.fn(() => ({ checkpointSequence: 33 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 34 }))
    const reconcileRecoveryProjection = vi.fn(() => ({ checkpointSequence: 35 }))
    const verifyProjectionCollision = vi.fn(async () => true)
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
        recordReviewRemediationMerge: recordMerge,
        finalizeReviewRemediationRecovery: finalizeRecovery,
        reconcileReviewRemediationProjection: reconcileRecoveryProjection,
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
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).rejects.toMatchObject({ code: "FENCING_TOKEN_CONFLICT" })
    expect(projectCheckpoint).not.toHaveBeenCalled()
    expect(recoverOutcome).not.toHaveBeenCalled()
    expect(cycle).not.toHaveBeenCalled()

    projectCheckpoint.mockRejectedValueOnce(new Error("simulated projection crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).rejects.toThrow("simulated projection crash")
    expect(recoverOutcome).not.toHaveBeenCalled()
    expect(finalizeRecovery).not.toHaveBeenCalled()
    candidate.checkpoint = {
      sequence: 33,
      state: "PR_MERGED",
      detail: "Recovered reviewed PR #447",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewRecoveryProofDigest = beginRecovery.mock.calls[1][0].proofDigest

    cycle.mockRejectedValueOnce(new Error("simulated cycle crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).rejects.toThrow("simulated cycle crash")
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
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 34,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))

    candidate.lease.status = "ABANDONED"
    candidate.checkpoint = {
      sequence: 34,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewProjectionReconciledFromSequence = null
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "7", prNumber: 447,
      mergeSha: "c".repeat(40), checkpointSequence: 34,
    })
    expect(projectCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 34,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))

    projectCheckpoint.mockRejectedValueOnce(Object.assign(
      new Error("non-legacy sequence collision"),
      { code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" },
    ))
    verifyProjectionCollision.mockResolvedValueOnce(false)
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).rejects.toMatchObject({ code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" })
    expect(reconcileRecoveryProjection).not.toHaveBeenCalled()

    projectCheckpoint.mockRejectedValueOnce(Object.assign(
      new Error("verified legacy sequence collision"),
      { code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT" },
    ))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 35 })
    expect(beginRecovery).toHaveBeenCalledTimes(2)
    expect(recordMerge).toHaveBeenCalledOnce()
    expect(finalizeRecovery).toHaveBeenCalledOnce()
    expect(reconcileRecoveryProjection).toHaveBeenCalledWith(expect.objectContaining({
      expectedCheckpointSequence: 34,
      expectedFencingToken: 28,
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(verifyProjectionCollision).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 7,
      attempt: 28,
      checkpointSequence: 34,
      checkpointDetail: "Recovered reviewed PR #447",
    }))
    expect(cycle).toHaveBeenCalledTimes(3)
    expect(cycle).toHaveBeenLastCalledWith({
      outcome: expect.objectContaining({ id: 7, ref: "GOAL-0007" }),
    })

    candidate.checkpoint.sequence = 35
    candidate.metadata.reviewProjectionReconciledFromSequence = 34
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome, verifyProjectionCollision,
    })).resolves.toMatchObject({ result: "COMPLETE", checkpointSequence: 35 })
    expect(reconcileRecoveryProjection).toHaveBeenCalledOnce()
    expect(cycle).toHaveBeenCalledTimes(4)
    expect(projectCheckpoint).toHaveBeenCalledTimes(8)
    expect(recoverOutcome).toHaveBeenCalledTimes(5)
    expect(recoverOutcome).toHaveBeenLastCalledWith(expect.objectContaining({
      proofDigest: beginRecovery.mock.calls[0][0].proofDigest,
    }))
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
        reviewRecoveryPriorHeadRefOid: null as string | null,
      },
    }
    const beginRecovery = vi.fn(() => ({ checkpointSequence: 29 }))
    const recordMerge = vi.fn(() => ({ checkpointSequence: 30 }))
    const finalizeRecovery = vi.fn(() => ({ checkpointSequence: 31 }))
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
        recordReviewRemediationMerge: recordMerge,
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
      inspectReviewRemediationClaims: vi.fn(async (number: number) => number === 464 ? [{
        threadIds: ["PRRT_review"], prNumber: 466,
        headRefOid: remediationHead, mergeSha: remediationMerge, filesDigest,
      }] : []),
      inspectRemediationPullRequest: vi.fn(async () => ({
        state: "MERGED", baseRefName: "main", unresolvedThreadCount: 0,
        checksGreen: true, reviewed: true, headRefOid: remediationHead,
        mergeCommit: { oid: remediationMerge },
      })),
      inspectPullRequestFiles: remediationFiles,
      verifyCommitAncestor: vi.fn(async () => true),
      verifyOriginMainContains: vi.fn(async () => true),
    }
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 99 }))
    const recoverOutcome = vi.fn(async () => true)

    remediationFiles.mockResolvedValueOnce(["package.json"])
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).rejects.toMatchObject({ code: "HERMES_REVIEW_RECOVERY_PROOF_WALL" })
    expect(beginRecovery).not.toHaveBeenCalled()

    cycle.mockRejectedValueOnce(new Error("simulated chained cycle crash"))
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).rejects.toThrow("simulated chained cycle crash")
    expect(beginRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      expectedPriorHeadRefOid: "a".repeat(40),
      headRefOid: "b".repeat(40),
      mergeSha: "c".repeat(40),
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(recordMerge).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      headRefOid: "b".repeat(40),
      mergeSha: "c".repeat(40),
      mergeDetail: "Recovered PR #464 through reviewed remediation chain",
      proofDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(finalizeRecovery).toHaveBeenCalledWith(expect.objectContaining({
      expectedFencingToken: 37,
      mergeDetail: "Recovered PR #464 through reviewed remediation chain",
    }))
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 30,
        state: "PR_MERGED",
        metadata: expect.objectContaining({ remediationPullRequests: [466] }),
      }),
    }))
    expect(projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 31,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))
    candidate.lease.status = "ABANDONED"
    candidate.checkpoint = {
      sequence: 31,
      state: "REVIEW_REMEDIATION_RECOVERED",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    }
    candidate.metadata.headRefOid = "b".repeat(40)
    candidate.metadata.mergeSha = "c".repeat(40)
    candidate.metadata.reviewRecoveryPriorHeadRefOid = "a".repeat(40)
    candidate.metadata.reviewRecoveryProofDigest = beginRecovery.mock.calls[0][0].proofDigest
    await expect(recoverReviewedMerge({
      orchestrator, lifecycle, projectCheckpoint, recoverOutcome,
    })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "9", prNumber: 464,
      mergeSha: "c".repeat(40), checkpointSequence: 31,
    })
    expect(projectCheckpoint).toHaveBeenLastCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        sequence: 31,
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      }),
    }))
    expect(cycle).toHaveBeenCalledTimes(2)
    expect(recoverOutcome).toHaveBeenCalledTimes(2)
    expect(recoverOutcome).toHaveBeenLastCalledWith(expect.objectContaining({
      proofDigest: beginRecovery.mock.calls[0][0].proofDigest,
    }))
    expect(lifecycle.verifyOriginMainContains).toHaveBeenCalledWith("c".repeat(40))
    expect(lifecycle.verifyOriginMainContains).toHaveBeenCalledWith(remediationMerge)
    expect(lifecycle.verifyCommitAncestor).toHaveBeenCalledWith("c".repeat(40), remediationMerge)
  })
})
