import fs from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createHermesOrchestrator } from "../scripts/hermes-bridge/orchestrator.mjs"
import { createHermesStateStore } from "../scripts/hermes-bridge/state-store.mjs"

const roots: string[] = []
const ownerDecisionPacket = {
  blockedAction: "Resume the exact blocked validation.",
  authorityBoundary: "Primary authority is required.",
  minimumChoice: "APPROVE_OR_DENY",
  approveConsequence: "Resume only the blocked validation.",
  denyConsequence: "Keep the Work Order blocked.",
}
const ownerDecisionPacketDigest = createHash("sha256")
  .update(JSON.stringify(ownerDecisionPacket))
  .digest("hex")

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-orchestrator-"))
  roots.push(root)
  fs.mkdirSync(path.join(root, "control"), { recursive: true })
  fs.writeFileSync(path.join(root, "control", "activation"), "enabled\n")
  fs.writeFileSync(path.join(root, "control", "authority-not-before"), "2026-07-21T00:00:00.000Z\n")
  return root
}

function fixture(
  changedPaths = ["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"],
  orchestratorOptions: Record<string, unknown> = {},
) {
  const root = runtime()
  let currentTime = Date.parse("2026-07-21T01:00:00.000Z")
  const state = createHermesStateStore(path.join(root, "state", "state.json"), { now: () => currentTime })
  const selectOutcome = vi.fn(async () => ({
    id: 77,
    userId: "owner-id",
    ref: null,
    command: "Improve the Hermes page with bounded live bridge status.",
    lane: "ui",
    mode: "implement",
    risk: "low",
    authority: "A2_WRITE_OWN",
    verdict: "requires_approval",
    requiresApproval: true,
    status: "classified",
  }))
  const markComplete = vi.fn(async () => true)
  const markTerminal = vi.fn(async () => true)
  const deferOutcome = vi.fn(async () => true)
  const projectCheckpoint = vi.fn(async () => ({ workOrderId: 77 }))
  const projectLease = vi.fn(async () => ({ workOrderId: 77 }))
  const readApprovedOwnerDecision = vi.fn(async () => null)
  let merged = false
  const lifecycle = {
    refreshOriginMain: vi.fn(async () => "a".repeat(40)),
    ensureOwnedWorktree: vi.fn(async ({ branch }: { branch: string }) => ({
      branch, worktreePath: path.join(root, "worktrees", "goal-77"),
    })),
    resumeOwnedWorktree: vi.fn(),
    discoverPullRequest: vi.fn(async () => null),
    inspectPullRequest: vi.fn(async () => ({
      state: merged ? "MERGED" : "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
      unresolvedThreadCount: 0, headRefOid: "c".repeat(40),
      mergeCommit: merged ? { oid: "b".repeat(40) } : null,
    })),
    inspectChangedPaths: vi.fn(async () => changedPaths),
    inspectWorkingTreePaths: vi.fn(async () => changedPaths),
    inspectWorktreeHead: vi.fn(async () => "c".repeat(40)),
    ensureValidationDependencies: vi.fn(() => ({ linked: true })),
    removeValidationDependencies: vi.fn(() => ({ removed: true })),
    runValidationCommands: vi.fn(async () => [{ command: "npm", args: ["test"], code: 0 }]),
    commitChanges: vi.fn(async () => ({ commit: "c".repeat(40), branch: "codex/hermes-goal-77-77", paths: changedPaths })),
    pushBranch: vi.fn(async () => ({ pushed: true })),
    createPullRequest: vi.fn(async () => ({ number: 500, url: "https://github.com/bsvalues/terragroq/pull/500" })),
    requestCodexReview: vi.fn(async () => ({ requested: true })),
    inspectReviewFindings: vi.fn(async () => []),
    resolveReviewThreads: vi.fn(async () => ({ resolved: 0 })),
    inspectPullRequestFiles: vi.fn(async () => changedPaths),
    mergePullRequest: vi.fn(async () => { merged = true; return { merged: true } }),
    verifyOriginMainContains: vi.fn(async () => true),
    cleanupOwnedWorktree: vi.fn(async () => ({ cleaned: true })),
  }
  const client = {
    connect: vi.fn(async () => {}),
    startThread: vi.fn(async () => "thread-77"),
    resumeThread: vi.fn(async () => "thread-77"),
    runTurn: vi.fn(async () => ({
      threadId: "thread-77", turnId: "turn-77", status: "completed",
      finalText: JSON.stringify({
        result: "READY_FOR_VALIDATION", workOrder: "WO-HERMES-77-001", branch: "codex/hermes-goal-77-77",
        commit: null, prUrl: null,
        merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
        ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
      }),
    })),
    close: vi.fn(),
  }
  const orchestrator = createHermesOrchestrator({
    workspace: process.cwd(), runtimeRoot: root, state, lifecycle, selectOutcome, markComplete, markTerminal, deferOutcome,
    projectCheckpoint, projectLease, readApprovedOwnerDecision,
    clientFactory: () => client,
    holderId: "test-holder",
    now: () => new Date(currentTime),
    sleep: async () => {},
    ...orchestratorOptions,
  })
  return {
    root, state, orchestrator, selectOutcome, markComplete, markTerminal, deferOutcome,
    projectCheckpoint, projectLease, readApprovedOwnerDecision, lifecycle, client,
    resetMerged: () => { merged = false },
    advance: (milliseconds: number) => { currentTime += milliseconds },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Hermes bridge orchestrator", { timeout: 30_000 }, () => {
  it("rejects review polling budgets that can outlive the lease", () => {
    expect(() => createHermesOrchestrator({
      reviewPollIntervalMs: 10 * 60 * 1000,
      reviewPollAttempts: 5,
    })).toThrow(expect.objectContaining({ code: "HERMES_REVIEW_POLL_BUDGET_WALL" }))
  })

  it("stays silent and does not query outcomes while disabled", async () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    await expect(value.orchestrator.cycle()).resolves.toEqual({ result: "DISABLED" })
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("targets an explicitly recovered outcome without selecting from the queue", async () => {
    const value = fixture()
    const recoveredOutcome = {
      id: 77,
      userId: "owner-id",
      ref: "GOAL-0077",
      command: "Complete the exact recovered WilliamOS outcome.",
      lane: "ui",
      mode: "implement",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "requires_approval",
      requiresApproval: true,
      status: "classified",
    }

    await expect(value.orchestrator.cycle({ outcome: recoveredOutcome })).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77", prNumber: 500,
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("adopts a durable reviewed-merge recovery before queue selection after restart", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "review-recovery-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "hermes-goal-77-77"),
        baseSha: "a".repeat(40),
        headRefOid: "c".repeat(40),
        prNumber: 500,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "review-recovery-terminal",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "REVIEW_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "review-recovery-release",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
    })
    value.state.beginReviewRemediationRecovery({
      idempotencyKey: "review-recovery-begin",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      prNumber: 500,
      expectedPriorHeadRefOid: "c".repeat(40),
      headRefOid: "c".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "d".repeat(64),
    })
    value.state.recordReviewRemediationMerge({
      idempotencyKey: "review-recovery-merged",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      prNumber: 500,
      headRefOid: "c".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "d".repeat(64),
      mergeDetail: "Recovered reviewed PR #500",
    })
    value.state.finalizeReviewRemediationRecovery({
      idempotencyKey: "review-recovery-finalize",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      prNumber: 500,
      headRefOid: "c".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "d".repeat(64),
      mergeDetail: "Recovered reviewed PR #500",
    })
    value.lifecycle.inspectPullRequest.mockResolvedValue({
      state: "MERGED",
      baseRefName: "main",
      isDraft: false,
      checksGreen: true,
      reviewed: true,
      unresolvedThreadCount: 0,
      headRefOid: "c".repeat(40),
      mergeCommit: { oid: "b".repeat(40) },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77", prNumber: 500,
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: lease.fencingToken + 1,
      lease: { status: "RELEASED" },
      checkpoint: { state: "COMPLETE" },
    })
  })

  it("immediately reclaims an abandoned execution after a host clock rollback", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "rollback-abandon-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 10_000,
      metadata: { outcome },
    })
    value.advance(5000)
    value.state.setKillSwitch({
      active: false,
      reason: "advance mutation clock",
      idempotencyKey: "rollback-abandon-clock-advance",
    })
    value.advance(-4500)
    value.state.abandonLease({
      idempotencyKey: "rollback-abandon",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "APP_SERVER_TURN_INTERRUPTED",
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: lease.fencingToken + 1,
      lease: { status: "RELEASED" },
      checkpoint: { state: "COMPLETE" },
    })
  })

  it("fails closed when an active execution has no exact outcome snapshot", async () => {
    const value = fixture()
    value.state.initialize()
    value.state.acquireLease({
      idempotencyKey: "missing-outcome-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { branch: "codex/hermes-goal-77-77" },
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_EXECUTION_STATE_WALL",
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("rejects a requested outcome that conflicts with a durable active execution", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    value.state.acquireLease({
      idempotencyKey: "conflicting-outcome-acquire",
      outcomeId: "77",
      holderId: "active-holder",
      leaseDurationMs: 1000,
      metadata: { outcome },
    })

    await expect(value.orchestrator.cycle({
      outcome: { ...outcome, id: 88, ref: "GOAL-0088" },
    })).rejects.toMatchObject({ code: "HERMES_EXECUTION_CONCURRENCY_WALL" })
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("fails closed before projecting corrupt multi-active execution state", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    value.state.acquireLease({
      idempotencyKey: "first-active-acquire",
      outcomeId: "77",
      holderId: "first-holder",
      leaseDurationMs: 1000,
      metadata: { outcome },
    })
    value.state.acquireLease({
      idempotencyKey: "second-active-acquire",
      outcomeId: "88",
      holderId: "second-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: { ...outcome, id: 88, ref: "GOAL-0088" } },
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_EXECUTION_CONCURRENCY_WALL",
    })
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("dispatches a standing-authorized R0/R1 outcome and merges only after independent scope verification", async () => {
    const value = fixture()
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77", prNumber: 500, mergeSha: "b".repeat(40),
    })
    expect(value.selectOutcome).toHaveBeenCalledWith(expect.objectContaining({
      standingAuthority: true, notBefore: "2026-07-21T00:00:00.000Z",
    }))
    expect(value.projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      attempt: 1,
      checkpoint: expect.objectContaining({ sequence: 0, state: "LEASED" }),
    }))
    expect(value.projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      checkpoint: expect.objectContaining({ state: "COMPLETE" }),
    }))
    expect(value.projectLease).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      attempt: 1,
      lease: expect.objectContaining({ status: "ACTIVE" }),
    }))
    expect(value.projectLease).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      attempt: 1,
      lease: expect.objectContaining({ status: "RELEASED" }),
    }))
    expect(value.client.startThread).toHaveBeenCalledWith(expect.objectContaining({
      approvalPolicy: "never", sandbox: "workspace-write", ephemeral: false,
    }))
    const threadParams = value.client.startThread.mock.calls[0][0]
    expect(threadParams).not.toHaveProperty("environments")
    expect(threadParams).not.toHaveProperty("selectedCapabilityRoots")
    expect(threadParams).not.toHaveProperty("dynamicTools")
    expect(value.client.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      turn: expect.objectContaining({
        effort: "ultra",
        sandboxPolicy: expect.objectContaining({ type: "workspaceWrite", networkAccess: true }),
      }),
    }))
    expect(value.lifecycle.inspectPullRequest).toHaveBeenCalledWith(500)
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalled()
    expect(value.lifecycle.commitChanges).toHaveBeenCalled()
    expect(value.lifecycle.pushBranch).toHaveBeenCalled()
    expect(value.lifecycle.createPullRequest).toHaveBeenCalled()
    expect(value.lifecycle.inspectChangedPaths.mock.invocationCallOrder[0])
      .toBeLessThan(value.lifecycle.mergePullRequest.mock.invocationCallOrder[0])
    expect(value.lifecycle.inspectPullRequestFiles.mock.invocationCallOrder[0])
      .toBeLessThan(value.lifecycle.mergePullRequest.mock.invocationCallOrder[0])
    expect(value.lifecycle.cleanupOwnedWorktree).toHaveBeenCalledWith(expect.objectContaining({
      mergeCommitSha: "b".repeat(40),
    }))
    expect(value.markComplete).toHaveBeenCalledWith(expect.objectContaining({ outcomeId: 77 }))
  })

  it("keeps a projected execution recoverable when persisted projection fails", async () => {
    const value = fixture()
    value.projectCheckpoint.mockRejectedValueOnce(
      Object.assign(new Error("projection unavailable"), { code: "HERMES_RUNTIME_PROJECTION_WALL" }),
    )

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE", abandonReason: "HERMES_RUNTIME_PROJECTION_WALL" },
      checkpoint: { sequence: 0, state: "LEASED" },
    })
    expect(value.client.connect).not.toHaveBeenCalled()
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77",
    })
    expect(value.projectLease).toHaveBeenCalledWith(expect.objectContaining({
      lease: expect.objectContaining({ status: "ABANDONED" }),
    }))
  })

  it("fails the active cycle when a renewed lease cannot be projected", async () => {
    const value = fixture(undefined, { leaseRenewalIntervalMs: 5 })
    const finalText = JSON.stringify({
      result: "READY_FOR_VALIDATION", workOrder: "WO-HERMES-77-001",
      branch: "codex/hermes-goal-77-77", commit: null, prUrl: null,
      merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
      ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
    })
    value.client.runTurn.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return { threadId: "thread-77", turnId: "turn-77", status: "completed", finalText }
    })
    value.projectLease
      .mockResolvedValueOnce({ workOrderId: 77 })
      .mockRejectedValue(Object.assign(new Error("database unavailable"), {
        code: "DATABASE_UNAVAILABLE",
      }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    expect(value.lifecycle.runValidationCommands).not.toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
  })

  it("retains an earlier failed projection when a later renewal projects first", async () => {
    const value = fixture(undefined, { leaseRenewalIntervalMs: 5 })
    value.projectLease
      .mockResolvedValueOnce({ workOrderId: 77 })
      .mockImplementationOnce(() => new Promise((_, reject) => {
        setTimeout(() => reject(
          Object.assign(new Error("earlier projection failed"), {
            code: "DATABASE_UNAVAILABLE",
          }),
        ), 20)
      }))
      .mockResolvedValue({ workOrderId: 77 })
    value.client.runTurn.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30))
      return {
        threadId: "thread-77", turnId: "turn-77", status: "completed",
        finalText: JSON.stringify({
          result: "READY_FOR_VALIDATION", workOrder: "WO-HERMES-77-001",
          branch: "codex/hermes-goal-77-77", commit: null, prUrl: null,
          merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
          ownerTouchCount: 0, blockedScopeCrossed: false,
          nextState: "READY_FOR_HERMES_MERGE",
        }),
      }
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    expect(value.lifecycle.runValidationCommands).not.toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
  })

  it("quiesces and projects a final lease renewal before merge", async () => {
    const value = fixture(undefined, { leaseRenewalIntervalMs: 100 })
    value.lifecycle.mergePullRequest.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150))
      value.lifecycle.inspectPullRequest.mockResolvedValue({
        state: "MERGED", baseRefName: "main", isDraft: false,
        checksGreen: true, reviewed: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })
      return { merged: true }
    })
    value.projectLease
      .mockResolvedValueOnce({ workOrderId: 77 })
      .mockResolvedValueOnce({ workOrderId: 77 })
      .mockResolvedValueOnce({ workOrderId: 77 })
      .mockRejectedValue(Object.assign(new Error("late projection"), {
        code: "DATABASE_UNAVAILABLE",
      }))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77",
    })
    expect(value.projectLease).toHaveBeenCalledTimes(3)
    expect(value.projectLease).toHaveBeenLastCalledWith(expect.objectContaining({
      lease: expect.objectContaining({ status: "RELEASED" }),
    }))
  })

  it("abandons a post-merge cleanup failure for immediate fenced recovery", async () => {
    const value = fixture()
    value.lifecycle.cleanupOwnedWorktree.mockRejectedValueOnce(Object.assign(new Error("git exited 255"), {
      code: "HERMES_REPOSITORY_COMMAND_FAILED",
    })).mockRejectedValueOnce(Object.assign(new Error("git exited 255 again"), {
      code: "HERMES_REPOSITORY_COMMAND_FAILED",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_POST_MERGE_CLEANUP_WALL" })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE", abandonReason: "HERMES_POST_MERGE_CLEANUP_WALL" },
      checkpoint: { state: "POST_MERGE_CLEANUP_RETRY", detail: "HERMES_POST_MERGE_CLEANUP_WALL" },
      metadata: { prNumber: 500, mergeSha: "b".repeat(40), postMergeCleanupRetryCount: 1 },
    })
    const firstFence = value.state.read().executions["77"].fencingToken
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_POST_MERGE_CLEANUP_WALL" })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE", abandonReason: "HERMES_POST_MERGE_CLEANUP_WALL" },
      checkpoint: { state: "POST_MERGE_CLEANUP_RETRY", detail: "HERMES_POST_MERGE_CLEANUP_WALL" },
      metadata: { postMergeCleanupRetryCount: 2 },
    })
    expect(value.state.read().executions["77"].fencingToken).toBeGreaterThan(firstFence)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
  })

  it("terminalizes post-merge cleanup after the bounded retry budget", async () => {
    const value = fixture()
    value.lifecycle.cleanupOwnedWorktree.mockRejectedValue(Object.assign(new Error("deterministic cleanup wall"), {
      code: "HERMES_REPOSITORY_CLEANUP_WALL",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_POST_MERGE_CLEANUP_WALL" })
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_POST_MERGE_CLEANUP_WALL" })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "FAILED_TERMINAL", nextState: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: { state: "FAILED_TERMINAL", detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED" },
      metadata: { postMergeCleanupRetryCount: 3 },
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77, result: "FAILED_TERMINAL",
      nextState: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
    })
  })

  it("does not charge outcome-completion settlement failures to the cleanup budget", async () => {
    const value = fixture()
    value.markComplete.mockResolvedValueOnce(false)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_OUTCOME_COMPLETION_WALL" })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE" },
      checkpoint: { state: "PR_MERGED", detail: "PR #500 merged" },
      metadata: { postMergeCleanupRetryCount: 0 },
    })
    expect(value.state.read().executions["77"].lease).not.toHaveProperty("abandonReason")
  })

  it("dispatches actionable review findings back to Codex and revalidates before merge", async () => {
    const value = fixture()
    value.lifecycle.commitChanges
      .mockResolvedValueOnce({ commit: "c".repeat(40), branch: "codex/hermes-goal-77-77" })
      .mockResolvedValueOnce({ commit: "d".repeat(40), branch: "codex/hermes-goal-77-77" })
    value.lifecycle.inspectWorktreeHead
      .mockResolvedValueOnce("c".repeat(40))
      .mockResolvedValueOnce("d".repeat(40))
    value.lifecycle.inspectPullRequest
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        unresolvedThreadCount: 1, headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        unresolvedThreadCount: 0, headRefOid: "d".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "MERGED", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        unresolvedThreadCount: 0, headRefOid: "d".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })
    value.lifecycle.inspectReviewFindings.mockResolvedValueOnce([{
      threadId: "PRRT_review_1", path: "components/hermes/live-status.tsx", line: 12,
      body: "Handle the empty state explicitly.",
    }])

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("Handle the empty state explicitly")
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalledTimes(2)
    expect(value.lifecycle.resolveReviewThreads).not.toHaveBeenCalled()
    expect(createHermesStateStore(value.orchestrator.statePath).read().executions["77"].metadata.remediationRound)
      .toBe(1)
  })

  it("routes native validation failures back to the same Codex thread before committing", async () => {
    const value = fixture()
    const validationError = Object.assign(new Error("validation failed"), {
      code: "HERMES_VALIDATION_FAILED",
      validation: {
        command: "npm", args: ["test", "--", "--run"], code: 1,
        output: "tests/home.test.ts: expected active work",
      },
    })
    value.lifecycle.runValidationCommands
      .mockRejectedValueOnce(validationError)
      .mockResolvedValueOnce([{ command: "npm", args: ["test"], code: 0 }])

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("expected active work")
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain(
      "do not invoke subagents, MCP, dynamic tools, web search, or external connectors",
    )
    expect(value.lifecycle.removeValidationDependencies).toHaveBeenCalledTimes(2)
    expect(value.lifecycle.removeValidationDependencies.mock.invocationCallOrder[0])
      .toBeLessThan(value.client.runTurn.mock.invocationCallOrder[1])
    expect(value.lifecycle.commitChanges).toHaveBeenCalledOnce()
    expect(createHermesStateStore(value.orchestrator.statePath).read().executions["77"].metadata.validationFailure)
      .toBe("")
  })

  it("terminalizes deterministic validation failures after the bounded remediation budget", async () => {
    const value = fixture()
    const validationError = Object.assign(new Error("validation failed"), {
      code: "HERMES_VALIDATION_FAILED",
      validation: { command: "npm", args: ["test"], code: 1, output: "deterministic failure" },
    })
    value.lifecycle.runValidationCommands.mockRejectedValue(validationError)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "FAILED_TERMINAL", nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(value.client.runTurn).toHaveBeenCalledTimes(4)
    expect(value.lifecycle.commitChanges).not.toHaveBeenCalled()
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77, result: "FAILED_TERMINAL", nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(createHermesStateStore(value.orchestrator.statePath).read().executions["77"].lease.status)
      .toBe("RELEASED")
  })

  it("requests exact-head review when the committed PR has no review evidence", async () => {
    const value = fixture()
    value.lifecycle.inspectPullRequest
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: false, reviewed: false,
        reviewRequested: false, unresolvedThreadCount: 0, headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: false, reviewed: true,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        reviewRequested: true, unresolvedThreadCount: 0, headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "MERGED", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        unresolvedThreadCount: 0, headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.lifecycle.requestCodexReview).toHaveBeenCalledWith({
      number: 500, headRefOid: "c".repeat(40),
    })
  })

  it("does not resolve outdated review findings before remediation and clean re-review", async () => {
    const value = fixture()
    value.lifecycle.inspectPullRequest
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: false, reviewed: false,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 1,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: false, reviewed: true,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "MERGED", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        unresolvedThreadCount: 0, headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })
    value.lifecycle.inspectReviewFindings.mockResolvedValueOnce([{
      threadId: "PRRT_old", isOutdated: true, path: "components/hermes/live-status.tsx", line: 12,
      body: "Prior-head finding.",
    }])

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("Prior-head finding")
    expect(value.lifecycle.resolveReviewThreads).not.toHaveBeenCalled()
  })

  it("resolves remediated outdated threads only after clean exact-head re-review", async () => {
    const value = fixture()
    value.lifecycle.inspectPullRequest
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: false, reviewed: false,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 1,
        cleanReviewEvidence: false, headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: false,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 1,
        cleanReviewEvidence: true, codexReviewFindings: [],
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 0,
        cleanReviewEvidence: true, codexReviewFindings: [],
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "MERGED", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
        unresolvedThreadCount: 0, headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })
    value.lifecycle.inspectReviewFindings
      .mockResolvedValueOnce([{
        threadId: "PRRT_old", isOutdated: true, path: "components/hermes/live-status.tsx",
        line: 12, body: "Prior-head finding.",
      }])
      .mockResolvedValueOnce([{
        threadId: "PRRT_old", isOutdated: true, path: "components/hermes/live-status.tsx",
        line: 12, body: "Prior-head finding.",
      }])

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.lifecycle.resolveReviewThreads).toHaveBeenCalledWith(["PRRT_old"])
  })

  it("routes completed red PR checks through bounded Codex remediation", async () => {
    const value = fixture()
    value.lifecycle.inspectPullRequest
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: false,
        checksComplete: true, failedChecks: [{ name: "Vercel", state: "FAILURE" }],
        reviewed: false, reviewCompleted: false, reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true,
        checksComplete: true, failedChecks: [], reviewed: true, reviewCompleted: true,
        reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "MERGED", baseRefName: "main", isDraft: false, checksGreen: true,
        checksComplete: true, failedChecks: [], reviewed: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("Vercel concluded FAILURE")
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("Improve the Hermes page")
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("- components/**")
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("rejected issue #357 adapter")
  })

  it("routes substantive Codex review summaries through bounded remediation", async () => {
    const value = fixture()
    value.lifecycle.inspectPullRequest
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true,
        checksComplete: true, failedChecks: [], reviewed: false, reviewCompleted: true,
        codexReviewFindings: ["Preserve the authority predicate before merge."],
        reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true,
        checksComplete: true, failedChecks: [], reviewed: true, reviewCompleted: true,
        codexReviewFindings: [], reviewRequested: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: null,
      })
      .mockResolvedValueOnce({
        state: "MERGED", baseRefName: "main", isDraft: false, checksGreen: true,
        checksComplete: true, failedChecks: [], reviewed: true, unresolvedThreadCount: 0,
        headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
      })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn.mock.calls[1][0].prompt)
      .toContain("Preserve the authority predicate before merge.")
  })

  it("fails closed when Codex changes a path outside the lane reservation", async () => {
    const value = fixture(["components/hermes/live-status.tsx", "lib/db/schema.ts"])
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
    expect(value.markComplete).not.toHaveBeenCalled()
  })

  it("allows only the bounded Goal Timeline action in the read-model reservation", async () => {
    const readModelOutcome = {
      id: 77,
      userId: "owner-id",
      ref: "GOAL-0077",
      command: "Show the bounded Goal Timeline read model.",
      lane: "read_model",
      mode: "implement",
      risk: "low",
      authority: "A0_READ_ONLY",
      verdict: "allow",
      requiresApproval: false,
      status: "classified",
    }
    const allowed = fixture(["app/actions/goal-timeline.ts"], {
      selectOutcome: vi.fn(async () => readModelOutcome),
    })
    await expect(allowed.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })

    const blocked = fixture([
      "app/actions/goal-timeline.ts.backup",
      "app/actions/goal-authority-decision.ts",
    ], {
      selectOutcome: vi.fn(async () => readModelOutcome),
    })
    await expect(blocked.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_CHANGED_PATH_WALL",
      blocked: [
        "app/actions/goal-timeline.ts.backup",
        "app/actions/goal-authority-decision.ts",
      ],
    })
    expect(blocked.lifecycle.mergePullRequest).not.toHaveBeenCalled()
    expect(blocked.markComplete).not.toHaveBeenCalled()
  })

  it("does not pass deleted test paths to focused validation", async () => {
    const value = fixture([
      "components/hermes/live-status.tsx", "tests/deleted-hermes-status.test.tsx",
    ])

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    const commands = value.lifecycle.runValidationCommands.mock.calls[0][0].commands
    expect(commands).not.toContainEqual(expect.objectContaining({ command: "npx" }))
  })

  it("resumes an unfinished Codex thread without disabling its native environment", async () => {
    const value = fixture(["lib/db/schema.ts"])
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    value.advance(50 * 60 * 1000 + 1)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    expect(value.client.resumeThread).toHaveBeenCalledWith("thread-77", expect.objectContaining({
      approvalPolicy: "never", sandbox: "workspace-write",
    }))
    const resumeParams = value.client.resumeThread.mock.calls[0][1]
    expect(resumeParams).not.toHaveProperty("environments")
    expect(resumeParams).not.toHaveProperty("selectedCapabilityRoots")
    expect(resumeParams).not.toHaveProperty("dynamicTools")
  })

  it("abandons an interrupted App Server turn for immediate fenced redispatch", async () => {
    const value = fixture()
    value.client.runTurn.mockRejectedValueOnce(Object.assign(new Error("interrupted"), {
      code: "APP_SERVER_TURN_INTERRUPTED",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_TURN_INTERRUPTED" })
    const interrupted = value.state.read().executions["77"]
    expect(interrupted.checkpoint).toMatchObject({ state: "RETRYABLE_WALL", detail: "APP_SERVER_TURN_INTERRUPTED" })
    expect(Date.parse(interrupted.lease.expiresAt)).toBe(Date.parse("2026-07-21T01:00:00.000Z"))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(value.state.read().nextFencingToken).toBeGreaterThan(2)
    expect(value.client.resumeThread).toHaveBeenCalledWith("thread-77", expect.any(Object))
  })

  it("abandons an App Server timeout for immediate fenced redispatch", async () => {
    const value = fixture()
    value.client.runTurn.mockRejectedValueOnce(Object.assign(new Error("timeout"), {
      code: "APP_SERVER_TIMEOUT",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_TIMEOUT" })
    const timedOut = value.state.read().executions["77"]
    expect(timedOut.checkpoint).toMatchObject({ state: "RETRYABLE_WALL", detail: "APP_SERVER_TIMEOUT" })
    expect(Date.parse(timedOut.lease.expiresAt)).toBe(Date.parse(timedOut.checkpoint.recordedAt))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    const redispatched = value.state.read().executions["77"]
    expect(redispatched.fencingToken).toBeGreaterThan(timedOut.fencingToken)
    expect(value.client.resumeThread).toHaveBeenCalledWith("thread-77", expect.any(Object))
  })

  it("abandons a blocked external tool and clears its App Server identity", async () => {
    const value = fixture()
    value.client.runTurn.mockRejectedValueOnce(Object.assign(new Error("mcpToolCall"), {
      code: "APP_SERVER_EXTERNAL_TOOL_WALL",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_EXTERNAL_TOOL_WALL" })
    const interrupted = value.state.read().executions["77"]
    expect(interrupted).toMatchObject({
      lease: { status: "ACTIVE", abandonReason: "APP_SERVER_EXTERNAL_TOOL_WALL" },
      checkpoint: { state: "RETRYABLE_WALL", detail: "APP_SERVER_EXTERNAL_TOOL_WALL" },
      metadata: { threadId: null, turnId: null },
    })
    expect(Date.parse(interrupted.lease.expiresAt)).toBe(Date.parse(interrupted.checkpoint.recordedAt))
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(value.client.startThread).toHaveBeenCalledTimes(2)
  })

  it("defers an outcome after the bounded external-tool redispatch budget", async () => {
    const value = fixture()
    value.client.runTurn.mockRejectedValue(Object.assign(new Error("mcpToolCall"), {
      code: "APP_SERVER_EXTERNAL_TOOL_WALL",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_EXTERNAL_TOOL_WALL" })
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_EXTERNAL_TOOL_WALL" })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE", nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
    })
    expect(value.deferOutcome).toHaveBeenCalledOnce()
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "DEFERRED" },
      checkpoint: { state: "DEFERRED_PROVIDER_UNAVAILABLE" },
      metadata: { externalToolRetryCount: 0, threadId: null, turnId: null },
    })
    expect(value.client.startThread).toHaveBeenCalledTimes(3)
  })

  it("redispatches a transient native provider wall without terminalizing the outcome", async () => {
    const value = fixture()
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-77", turnId: "turn-provider-wall", status: "completed",
      finalText: JSON.stringify({
        result: "RETRYABLE_PROVIDER_WALL", workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77", commit: null, prUrl: null, merged: false,
        mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0,
        blockedScopeCrossed: false, nextState: "TRANSIENT_NATIVE_PROCESS_LAUNCH_WALL",
      }),
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "RETRYABLE_PROVIDER_WALL", outcomeId: "77",
    })
    const interrupted = value.state.read().executions["77"]
    expect(interrupted.checkpoint).toMatchObject({
      state: "RETRYABLE_PROVIDER_WALL", detail: "TRANSIENT_NATIVE_PROCESS_LAUNCH_WALL",
    })
    expect(interrupted.metadata.providerRetryCount).toBe(1)
    expect(interrupted.metadata.threadId).toBeNull()
    expect(interrupted.metadata.turnId).toBeNull()
    expect(interrupted.metadata.remediationRound).toBeNull()
    expect(Date.parse(interrupted.lease.expiresAt)).toBe(Date.parse(interrupted.checkpoint.recordedAt))
    expect(value.markTerminal).not.toHaveBeenCalled()

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(value.state.read().executions["77"].fencingToken).toBeGreaterThan(interrupted.fencingToken)
    expect(value.client.startThread).toHaveBeenCalledTimes(2)
  })

  it("settles an outcome as provider-unavailable after the bounded redispatch budget", async () => {
    const value = fixture()
    value.client.runTurn.mockResolvedValue({
      threadId: "thread-77", turnId: "turn-provider-wall", status: "completed",
      finalText: JSON.stringify({
        result: "RETRYABLE_PROVIDER_WALL", workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77", commit: null, prUrl: null, merged: false,
        mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0,
        blockedScopeCrossed: false, nextState: "TRANSIENT_NATIVE_PROCESS_LAUNCH_WALL",
      }),
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE", nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
    })
    expect(value.deferOutcome).toHaveBeenCalledWith({
      outcomeId: 77, retryAfter: "2026-07-21T01:15:00.000Z",
    })
    expect(value.markTerminal).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "DEFERRED", expiresAt: "2026-07-21T01:15:00.000Z" },
      checkpoint: { state: "DEFERRED_PROVIDER_UNAVAILABLE", detail: "2026-07-21T01:15:00.000Z" },
      metadata: { providerRetryCount: 0 },
    })
    expect(value.state.read().executions["77"].metadata.threadId).toBeNull()
    expect(value.state.read().executions["77"].metadata.turnId).toBeNull()

    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-fresh", turnId: "turn-fresh", status: "completed",
      finalText: JSON.stringify({
        result: "READY_FOR_VALIDATION", workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77", commit: null, prUrl: null,
        merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
        ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
      }),
    })
    value.advance(15 * 60 * 1000 + 1)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(value.client.startThread).toHaveBeenCalledTimes(4)
    expect(value.client.resumeThread).not.toHaveBeenCalled()
  })

  it("uses wall-clock time for provider deadlines while preserving monotonic mutation timestamps", async () => {
    const value = fixture()
    let turn = 0
    value.client.runTurn.mockImplementation(async () => {
      turn += 1
      if (turn === 3) value.advance(-30 * 60 * 1000)
      return {
        threadId: "thread-77", turnId: "turn-provider-wall", status: "completed",
        finalText: JSON.stringify({
          result: "RETRYABLE_PROVIDER_WALL", workOrder: "WO-HERMES-77-001",
          branch: "codex/hermes-goal-77-77", commit: null, prUrl: null, merged: false,
          mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0,
          blockedScopeCrossed: false, nextState: "TRANSIENT_NATIVE_PROCESS_LAUNCH_WALL",
        }),
      }
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    value.advance(20 * 60 * 1000)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    const priorUpdatedAt = value.state.read().updatedAt

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
      retryAfter: "2026-07-21T01:05:00.000Z",
    })

    const settled = value.state.read()
    expect(settled.updatedAt).toBe(priorUpdatedAt)
    expect(settled.executions["77"]).toMatchObject({
      lease: { status: "DEFERRED", expiresAt: "2026-07-21T01:05:00.000Z" },
      checkpoint: {
        state: "DEFERRED_PROVIDER_UNAVAILABLE",
        detail: "2026-07-21T01:05:00.000Z",
        recordedAt: priorUpdatedAt,
      },
    })
    expect(value.deferOutcome).toHaveBeenCalledWith({
      outcomeId: 77,
      retryAfter: "2026-07-21T01:05:00.000Z",
    })
  })

  it("resumes cross-store provider-unavailable settlement without another Codex turn", async () => {
    const value = fixture()
    value.client.runTurn.mockResolvedValue({
      threadId: "thread-77", turnId: "turn-provider-wall", status: "completed",
      finalText: JSON.stringify({
        result: "RETRYABLE_PROVIDER_WALL", workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77", commit: null, prUrl: null, merged: false,
        mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0,
        blockedScopeCrossed: false, nextState: "TRANSIENT_NATIVE_PROCESS_LAUNCH_WALL",
      }),
    })
    value.deferOutcome.mockRejectedValueOnce(new Error("database interruption"))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    await expect(value.orchestrator.cycle()).rejects.toThrow("database interruption")
    const interrupted = value.state.read().executions["77"]
    expect(interrupted.checkpoint.state).toBe("PROVIDER_UNAVAILABLE")
    const turnCount = value.client.runTurn.mock.calls.length

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "PROVIDER_UNAVAILABLE" })
    expect(value.client.runTurn).toHaveBeenCalledTimes(turnCount)
    expect(value.state.read().executions["77"].lease.status).toBe("DEFERRED")
  })

  it("fails closed when a durable owner-touch counter changes during execution", async () => {
    const value = fixture()
    const original = value.client.runTurn.getMockImplementation()
    value.client.runTurn.mockImplementationOnce(async (...args: unknown[]) => {
      value.state.recordOwnerTouch({
        idempotencyKey: "owner-touch-during-run",
        counter: "ownerOperationTouchCount",
      })
      return original!(...args)
    })
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_OWNER_TOUCH_WALL" })
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
    expect(value.markComplete).not.toHaveBeenCalled()
  })

  it("does not certify completion when the persisted outcome cannot be closed", async () => {
    const value = fixture()
    value.markComplete.mockResolvedValueOnce(false)
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_OUTCOME_COMPLETION_WALL" })
    expect(value.lifecycle.mergePullRequest).toHaveBeenCalledOnce()
    expect(createHermesStateStore(value.orchestrator.statePath).read().executions["77"].lease.status).toBe("ACTIVE")
  })

  it("retains the lease when persisted terminal settlement fails", async () => {
    const value = fixture()
    const validationError = Object.assign(new Error("validation failed"), {
      code: "HERMES_VALIDATION_FAILED",
      validation: { command: "npm", args: ["test"], code: 1, output: "deterministic failure" },
    })
    value.lifecycle.runValidationCommands.mockRejectedValue(validationError)
    value.markTerminal.mockResolvedValueOnce(false)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_OUTCOME_TERMINAL_WALL" })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE" },
      checkpoint: { state: "FAILED_TERMINAL", detail: "VALIDATION_REMEDIATION_EXHAUSTED" },
    })
    const turnCount = value.client.runTurn.mock.calls.length
    value.advance(50 * 60 * 1000 + 1)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "FAILED_TERMINAL", nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(value.client.runTurn).toHaveBeenCalledTimes(turnCount)
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
  })

  it("resumes merged-PR finalization from durable state without redispatching Codex", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "recover-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: {
        outcome, branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "hermes-goal-77-77"),
        baseSha: "a".repeat(40), prNumber: 500, mergeSha: "b".repeat(40), headRefOid: "c".repeat(40),
      },
    })
    value.state.checkpoint({
      idempotencyKey: "recover-merged", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: 0, state: "PR_MERGED",
    })
    value.advance(1001)
    value.lifecycle.inspectPullRequest.mockResolvedValue({
      state: "MERGED", baseRefName: "main", unresolvedThreadCount: 0,
      headRefOid: "c".repeat(40), mergeCommit: { oid: "b".repeat(40) },
    })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.markComplete).toHaveBeenCalledOnce()
  })

  it("resumes the native delivery lifecycle from a durable committed head without redispatching Codex", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "recover-commit-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: {
        outcome, branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "hermes-goal-77-77"),
        baseSha: "a".repeat(40), headRefOid: "c".repeat(40),
      },
    })
    value.state.checkpoint({
      idempotencyKey: "recover-commit", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: 0, state: "COMMIT_CREATED",
      metadata: { headRefOid: "c".repeat(40) },
    })
    value.lifecycle.inspectWorkingTreePaths.mockResolvedValueOnce([])
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.lifecycle.inspectWorktreeHead).toHaveBeenCalled()
    expect(value.lifecycle.pushBranch).toHaveBeenCalled()
    expect(value.lifecycle.createPullRequest).toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).toHaveBeenCalledOnce()
  })

  it("recovers a clean commit created after validation but before its durable checkpoint", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "recover-uncheckpointed-commit-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: {
        outcome, branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "hermes-goal-77-77"),
        baseSha: "a".repeat(40), headRefOid: "c".repeat(40), prNumber: 500,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "recover-uncheckpointed-commit", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: 0, state: "HOST_VALIDATION_PASSED",
      metadata: { headRefOid: null },
    })
    value.lifecycle.inspectWorkingTreePaths.mockResolvedValue([])
    value.lifecycle.inspectChangedPaths.mockResolvedValue([
      "components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx",
    ])
    value.lifecycle.inspectWorktreeHead.mockResolvedValue("d".repeat(40))
    let recoveredMerged = false
    value.lifecycle.inspectPullRequest.mockImplementation(async () => ({
      state: recoveredMerged ? "MERGED" : "OPEN", baseRefName: "main", isDraft: false,
      checksGreen: true, reviewed: true, unresolvedThreadCount: 0, headRefOid: "d".repeat(40),
      mergeCommit: recoveredMerged ? { oid: "b".repeat(40) } : null,
    }))
    value.lifecycle.mergePullRequest.mockImplementation(async () => {
      recoveredMerged = true
      return { merged: true }
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.lifecycle.commitChanges).not.toHaveBeenCalled()
    expect(value.lifecycle.inspectWorktreeHead).toHaveBeenCalled()
    expect(value.lifecycle.pushBranch).toHaveBeenCalledWith(expect.objectContaining({
      branch: "codex/hermes-goal-77-77",
    }))
    expect(value.state.read().executions["77"].metadata.headRefOid).toBe("d".repeat(40))
    expect(value.lifecycle.mergePullRequest).toHaveBeenCalledOnce()
  })

  it("recovers validated dirty work without redispatching Codex after a checkpoint crash", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "recover-validated-dirty-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: {
        outcome, branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "hermes-goal-77-77"),
        baseSha: "a".repeat(40), headRefOid: null,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "recover-validated-dirty", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: 0, state: "HOST_VALIDATION_PASSED",
      metadata: { headRefOid: null },
    })
    value.lifecycle.inspectWorkingTreePaths
      .mockResolvedValueOnce([
        "components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx",
      ])
      .mockResolvedValueOnce([])
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.lifecycle.commitChanges).toHaveBeenCalledOnce()
    expect(value.lifecycle.pushBranch).toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).toHaveBeenCalledOnce()
  })

  it("terminalizes persisted review findings when the remediation budget is exhausted", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "review-exhausted-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: {
        outcome, branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "hermes-goal-77-77"),
        baseSha: "a".repeat(40), headRefOid: "c".repeat(40), prNumber: 500,
        remediationRound: 3,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "review-exhausted", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: 0,
      state: "REVIEW_REMEDIATION_REQUIRED", metadata: { remediationRound: 3 },
    })
    value.lifecycle.inspectWorkingTreePaths.mockResolvedValueOnce([])
    value.lifecycle.inspectPullRequest.mockResolvedValueOnce({
      state: "OPEN", baseRefName: "main", isDraft: false, checksGreen: true, reviewed: true,
      reviewCompleted: true, reviewRequested: true, unresolvedThreadCount: 1,
      headRefOid: "c".repeat(40), mergeCommit: null,
    })
    value.lifecycle.inspectReviewFindings.mockResolvedValueOnce([{
      threadId: "PRRT_current", isOutdated: false, path: "app/page.tsx", line: 10,
      body: "Current-head authority finding.",
    }])
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "FAILED_TERMINAL", nextState: "REVIEW_REMEDIATION_EXHAUSTED",
    })
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77, result: "FAILED_TERMINAL", nextState: "REVIEW_REMEDIATION_EXHAUSTED",
    })
  })

  it("reconciles one approved owner proof, reopens once, and reclaims one fenced lease", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-resume-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-resume-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
      metadata: { threadId: "thread-owner-wall", ownerDecisionPacket },
    })
    value.state.releaseLease({
      idempotencyKey: "owner-resume-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.readApprovedOwnerDecision.mockResolvedValue({
      approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-77-500", requestKey: "owner-request",
      workOrderId: 77, terminalEventId: 500,
      decisionPacket: ownerDecisionPacket, decisionPacketDigest: ownerDecisionPacketDigest,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", outcomeId: "77" })
    expect(value.readApprovedOwnerDecision).toHaveBeenCalledTimes(2)
    expect(value.readApprovedOwnerDecision.mock.calls[1][0]).toMatchObject({
      workOrderId: 77,
      terminalEventId: 500,
    })
    expect(value.selectOutcome).toHaveBeenCalledOnce()
    expect(value.client.runTurn).toHaveBeenCalledOnce()
    expect(value.client.resumeThread).toHaveBeenCalledWith(
      "thread-owner-wall",
      expect.any(Object),
    )
    expect(value.client.runTurn.mock.calls[0][0].prompt).toContain(
      "Resume only the previously blocked action",
    )
    expect(value.client.runTurn.mock.calls[0][0].prompt).toContain(
      "Governed next state: NEW_AUTHORITY_REQUIRED",
    )
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: first.fencingToken + 1,
      lease: { status: "RELEASED" }, checkpoint: { state: "COMPLETE" },
      metadata: { ownerDecisionResumePhase: "CONSUMED" },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "ALREADY_FINALIZED", outcomeId: "77" })
    expect(value.readApprovedOwnerDecision).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn).toHaveBeenCalledOnce()
  })

  it("abandons a reclaimed owner wall whose persisted packet is malformed", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-packet-wall-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, threadId: "thread-owner-packet-wall" },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-packet-wall-checkpoint",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED",
      detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.abandonLease({
      idempotencyKey: "owner-packet-wall-crash",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      reason: "PROCESS_CRASH",
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_OWNER_DECISION_PACKET_WALL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { abandonReason: "HERMES_OWNER_DECISION_PACKET_WALL" },
    })
    expect(value.client.connect).not.toHaveBeenCalled()
  })

  it("revalidates canonical authority immediately before an approved resume dispatch", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-revoked-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-revoked-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
      metadata: { threadId: "thread-owner-revoked", ownerDecisionPacket },
    })
    value.state.releaseLease({
      idempotencyKey: "owner-revoked-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.readApprovedOwnerDecision
      .mockResolvedValueOnce({
        approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
        decisionRef: "OWNER-DECISION-77-500", requestKey: "owner-request",
        workOrderId: 77, terminalEventId: 500,
        decisionPacket: ownerDecisionPacket, decisionPacketDigest: ownerDecisionPacketDigest,
      })
      .mockResolvedValueOnce(null)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_OWNER_DECISION_AUTHORITY_WALL",
    })
    expect(value.readApprovedOwnerDecision).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn).not.toHaveBeenCalled()
  })

  it("serializes multiple approved owner resumes by their persisted decision order", async () => {
    const value = fixture()
    const firstOutcome = await value.selectOutcome()
    const secondOutcome = { ...firstOutcome, id: 78, ref: "OUTCOME-78" }
    for (const [outcome, decisionId] of [[firstOutcome, 19], [secondOutcome, 18]] as const) {
      const outcomeId = String(outcome.id)
      const lease = value.state.acquireLease({
        idempotencyKey: `owner-queue-acquire-${outcomeId}`,
        outcomeId,
        holderId: `crashed-${outcomeId}`,
        leaseDurationMs: 1000,
        metadata: { outcome },
      })
      value.state.checkpoint({
        idempotencyKey: `owner-queue-wall-${outcomeId}`,
        outcomeId,
        holderId: `crashed-${outcomeId}`,
        fencingToken: lease.fencingToken,
        expectedCheckpointSequence: 0,
        state: "OWNER_DECISION_REQUIRED",
        detail: "NEW_AUTHORITY_REQUIRED",
        metadata: { threadId: `thread-${outcomeId}`, ownerDecisionPacket },
      })
      value.state.releaseLease({
        idempotencyKey: `owner-queue-release-${outcomeId}`,
        outcomeId,
        holderId: `crashed-${outcomeId}`,
        fencingToken: lease.fencingToken,
      })
      expect(decisionId).toBeGreaterThan(0)
    }
    value.readApprovedOwnerDecision.mockImplementation(async ({ outcomeId }) => {
      const decisionId = Number(outcomeId) === 78 ? 18 : 19
      return {
        approved: true,
        status: "accepted",
        choice: "APPROVE",
        decisionId,
        decisionRef: `OWNER-DECISION-${outcomeId}-500`,
        requestKey: `owner-request-${outcomeId}`,
        workOrderId: Number(outcomeId),
        terminalEventId: 500,
        decisionPacket: ownerDecisionPacket,
        decisionPacketDigest: ownerDecisionPacketDigest,
      }
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "78",
    })
    expect(value.state.read().executions["78"].lease.status).toBe("RELEASED")
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: { state: "OWNER_DECISION_REQUIRED" },
    })
    value.resetMerged()
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
  })

  it("does not repeat the approved action after its resume turn was durably consumed", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-consumed-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, threadId: "thread-owner-consumed", ownerDecisionPacket },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-consumed-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.releaseLease({
      idempotencyKey: "owner-consumed-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.state.reopenOwnerDecisionWall({
      idempotencyKey: "owner-consumed-reopen", outcomeId: "77",
      expectedFencingToken: first.fencingToken,
      expectedNextState: "NEW_AUTHORITY_REQUIRED",
      ownerDecisionId: 19,
      ownerDecisionRef: "OWNER-DECISION-77-500",
      requestKey: "owner-request",
      workOrderId: 77,
      terminalEventId: 500,
      decisionPacket: ownerDecisionPacket,
      decisionPacketDigest: ownerDecisionPacketDigest,
    })
    const resumed = value.state.reclaimLease({
      idempotencyKey: "owner-consumed-reclaim", outcomeId: "77",
      expectedFencingToken: first.fencingToken,
      holderId: "test-holder", leaseDurationMs: 1000,
    })
    value.state.checkpoint({
      idempotencyKey: "owner-consumed-turn", outcomeId: "77", holderId: "test-holder",
      fencingToken: resumed.fencingToken,
      expectedCheckpointSequence: resumed.checkpointSequence,
      state: "CODEX_TURN_COMPLETED",
      detail: "completed",
      metadata: { ownerDecisionResumePhase: "CONSUMED" },
    })
    value.state.abandonLease({
      idempotencyKey: "owner-consumed-crash", outcomeId: "77", holderId: "test-holder",
      fencingToken: resumed.fencingToken, reason: "PROCESS_CRASH",
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77",
    })
    const prompt = value.client.runTurn.mock.calls[0][0].prompt
    expect(prompt).toContain("already dispatched and completed")
    expect(prompt).not.toContain("Resume only the previously blocked action")
  })

  it.each([
    ["malformed", "not-json", "HERMES_RESULT_FORMAT_WALL"],
    ["empty", "", "HERMES_EMPTY_RESULT_WALL"],
  ])("consumes an approved resume before parsing %s Codex output", async (
    _label,
    finalText,
    errorCode,
  ) => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-malformed-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-malformed-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
      metadata: { threadId: "thread-owner-malformed", ownerDecisionPacket },
    })
    value.state.releaseLease({
      idempotencyKey: "owner-malformed-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.readApprovedOwnerDecision.mockResolvedValue({
      approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-77-500", requestKey: "owner-request",
      workOrderId: 77, terminalEventId: 500,
      decisionPacket: ownerDecisionPacket, decisionPacketDigest: ownerDecisionPacketDigest,
    })
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-owner-malformed",
      turnId: "turn-owner-malformed",
      status: "completed",
      finalText,
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: errorCode,
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      metadata: { ownerDecisionResumePhase: "CONSUMED" },
      lease: { abandonReason: errorCode },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77",
    })
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain(
      "already dispatched and completed",
    )
    expect(value.client.runTurn.mock.calls[1][0].prompt).not.toContain(
      "Resume only the previously blocked action",
    )
  })

  it("durably consumes an approved resume before a failed runtime projection check", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-projection-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-projection-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
      metadata: { threadId: "thread-owner-projection", ownerDecisionPacket },
    })
    value.state.releaseLease({
      idempotencyKey: "owner-projection-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.readApprovedOwnerDecision.mockResolvedValue({
      approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-77-500", requestKey: "owner-request",
      workOrderId: 77, terminalEventId: 500,
      decisionPacket: ownerDecisionPacket, decisionPacketDigest: ownerDecisionPacketDigest,
    })
    let failedProjection = false
    value.projectCheckpoint.mockImplementation(async ({ checkpoint }) => {
      if (checkpoint.state === "CODEX_TURN_COMPLETED" && !failedProjection) {
        failedProjection = true
        throw Object.assign(new Error("projection unavailable"), {
          code: "DATABASE_UNAVAILABLE",
        })
      }
      return { workOrderId: 77 }
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      checkpoint: { state: "CODEX_TURN_COMPLETED" },
      metadata: { ownerDecisionResumePhase: "CONSUMED" },
      lease: {
        status: "ACTIVE",
        abandonReason: "HERMES_RUNTIME_PROJECTION_WALL",
        abandonedAt: expect.any(String),
      },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77",
    })
    expect(value.client.runTurn).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain(
      "already dispatched and completed",
    )
    expect(value.client.runTurn.mock.calls[1][0].prompt).not.toContain(
      "Resume only the previously blocked action",
    )
  })

  it("settles a recovered owner-wall checkpoint before any Codex redispatch", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-settlement-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome, threadId: "thread-owner-wall", ownerDecisionPacket },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-settlement-checkpoint", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "OWNER_DECISION_REQUIRED",
      outcomeId: "77",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
      metadata: ownerDecisionPacket,
    })
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
  })

  it("fails closed and retries the original thread when owner-resume restoration fails", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-thread-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome, threadId: "thread-owner-wall", ownerDecisionPacket },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-thread-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.releaseLease({
      idempotencyKey: "owner-thread-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.readApprovedOwnerDecision.mockResolvedValue({
      approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-77-500", requestKey: "owner-request",
      workOrderId: 77, terminalEventId: 500,
      decisionPacket: ownerDecisionPacket, decisionPacketDigest: ownerDecisionPacketDigest,
    })
    value.client.resumeThread.mockRejectedValueOnce(new Error("thread transport unavailable"))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_OWNER_DECISION_THREAD_RECOVERY_WALL",
    })
    expect(value.client.startThread).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE", abandonedAt: expect.any(String) },
      checkpoint: { state: "OWNER_DECISION_THREAD_RECOVERY_WALL" },
      metadata: { threadId: "thread-owner-wall", ownerDecisionPacket },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.client.resumeThread).toHaveBeenLastCalledWith(
      "thread-owner-wall",
      expect.any(Object),
    )
    expect(value.client.startThread).not.toHaveBeenCalled()
  })

  it("recovers an approved owner decision after a crash before lease reclaim", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-crash-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome, threadId: "thread-owner-crash", ownerDecisionPacket },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-crash-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.releaseLease({
      idempotencyKey: "owner-crash-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.state.reopenOwnerDecisionWall({
      idempotencyKey: "owner-crash-reopen", outcomeId: "77",
      expectedFencingToken: first.fencingToken,
      expectedNextState: "NEW_AUTHORITY_REQUIRED",
      ownerDecisionId: 19,
      ownerDecisionRef: "OWNER-DECISION-77-500",
      requestKey: "owner-request",
      workOrderId: 77,
      terminalEventId: 500,
      decisionPacket: ownerDecisionPacket,
      decisionPacketDigest: ownerDecisionPacketDigest,
    })
    value.readApprovedOwnerDecision.mockResolvedValue({
      approved: true, status: "accepted", choice: "APPROVE", decisionId: 19,
      decisionRef: "OWNER-DECISION-77-500", requestKey: "owner-request",
      workOrderId: 77, terminalEventId: 500,
      decisionPacket: ownerDecisionPacket, decisionPacketDigest: ownerDecisionPacketDigest,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.selectOutcome).toHaveBeenCalledOnce()
    expect(value.readApprovedOwnerDecision).toHaveBeenCalledOnce()
    expect(value.client.resumeThread).toHaveBeenCalledWith(
      "thread-owner-crash",
      expect.any(Object),
    )
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: first.fencingToken + 1,
      lease: { status: "RELEASED" },
      checkpoint: { state: "COMPLETE" },
    })
  })

  it("does not resume a denied or missing owner proof", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-deny-acquire", outcomeId: "77", holderId: "crashed-holder",
      leaseDurationMs: 1000, metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-deny-wall", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken, expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED", detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.releaseLease({
      idempotencyKey: "owner-deny-release", outcomeId: "77", holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "ALREADY_FINALIZED", outcomeId: "77" })
    expect(value.readApprovedOwnerDecision).toHaveBeenCalledOnce()
    expect(value.client.runTurn).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: first.fencingToken,
      lease: { status: "RELEASED" }, checkpoint: { state: "OWNER_DECISION_REQUIRED" },
    })
  })

  it("declassifies a terminal owner wall so it cannot starve later outcomes", async () => {
    const value = fixture()
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-77", turnId: "turn-wall", status: "completed",
      finalText: JSON.stringify({
        result: "OWNER_DECISION_REQUIRED", workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77", commit: null, prUrl: null, merged: false,
        mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0,
        blockedScopeCrossed: false, nextState: "NEW_AUTHORITY_REQUIRED",
        ...ownerDecisionPacket,
      }),
    })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "OWNER_DECISION_REQUIRED", outcomeId: "77",
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77, result: "OWNER_DECISION_REQUIRED", nextState: "NEW_AUTHORITY_REQUIRED",
      metadata: ownerDecisionPacket,
    })
    expect(value.markComplete).not.toHaveBeenCalled()
  })

  it("abandons a completed turn that returns a malformed owner decision packet", async () => {
    const value = fixture()
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-77",
      turnId: "turn-malformed-owner-wall",
      status: "completed",
      finalText: JSON.stringify({
        result: "OWNER_DECISION_REQUIRED",
        workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77",
        commit: null,
        prUrl: null,
        merged: false,
        mergeCommit: null,
        validation: [],
        reviewThreads: 0,
        ownerTouchCount: 0,
        blockedScopeCrossed: false,
        nextState: "NEW_AUTHORITY_REQUIRED",
        blockedAction: ownerDecisionPacket.blockedAction,
        authorityBoundary: ownerDecisionPacket.authorityBoundary,
        minimumChoice: ownerDecisionPacket.minimumChoice,
        approveConsequence: ownerDecisionPacket.approveConsequence,
      }),
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_OWNER_DECISION_PACKET_WALL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { abandonReason: "HERMES_OWNER_DECISION_PACKET_WALL" },
    })
    expect(value.markTerminal).not.toHaveBeenCalled()
  })

  it("clears prior authority binding metadata when an approved resume reaches a successor wall", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const first = value.state.acquireLease({
      idempotencyKey: "owner-successor-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-successor-wall",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED",
      detail: "NEW_AUTHORITY_REQUIRED",
      metadata: { threadId: "thread-owner-successor", ownerDecisionPacket },
    })
    value.state.releaseLease({
      idempotencyKey: "owner-successor-release",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    value.readApprovedOwnerDecision.mockResolvedValue({
      approved: true,
      status: "accepted",
      choice: "APPROVE",
      decisionId: 19,
      decisionRef: "OWNER-DECISION-77-500",
      requestKey: "owner-request",
      workOrderId: 77,
      terminalEventId: 500,
      decisionPacket: ownerDecisionPacket,
      decisionPacketDigest: ownerDecisionPacketDigest,
    })
    const successorPacket = {
      ...ownerDecisionPacket,
      blockedAction: "Perform the newly blocked action.",
      approveConsequence: "Perform only the newly blocked action.",
    }
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-owner-successor",
      turnId: "turn-owner-successor",
      status: "completed",
      finalText: JSON.stringify({
        result: "OWNER_DECISION_REQUIRED",
        workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77",
        commit: null,
        prUrl: null,
        merged: false,
        mergeCommit: null,
        validation: [],
        reviewThreads: 0,
        ownerTouchCount: 0,
        blockedScopeCrossed: false,
        nextState: "SECOND_AUTHORITY_REQUIRED",
        ...successorPacket,
      }),
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "OWNER_DECISION_REQUIRED",
      nextState: "SECOND_AUTHORITY_REQUIRED",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: { state: "OWNER_DECISION_REQUIRED", detail: "SECOND_AUTHORITY_REQUIRED" },
      metadata: {
        ownerDecisionPacket: successorPacket,
        ownerDecisionId: null,
        ownerDecisionRef: null,
        ownerDecisionRequestKey: null,
        ownerDecisionNextState: null,
        ownerDecisionResumePhase: null,
        ownerDecisionWorkOrderId: null,
        ownerDecisionTerminalEventId: null,
        ownerDecisionPacketDigest: null,
      },
    })
  })
})
