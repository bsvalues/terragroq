import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createHermesOrchestrator } from "../scripts/hermes-bridge/orchestrator.mjs"
import { createHermesStateStore } from "../scripts/hermes-bridge/state-store.mjs"

const roots: string[] = []

function runtime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-orchestrator-"))
  roots.push(root)
  fs.mkdirSync(path.join(root, "control"), { recursive: true })
  fs.writeFileSync(path.join(root, "control", "activation"), "enabled\n")
  fs.writeFileSync(path.join(root, "control", "authority-not-before"), "2026-07-21T00:00:00.000Z\n")
  return root
}

function fixture(changedPaths = ["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"]) {
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
        result: "READY_FOR_MERGE", workOrder: "WO-HERMES-77-001", branch: "codex/hermes-goal-77-77",
        commit: "c".repeat(40), prUrl: "https://github.com/bsvalues/terragroq/pull/500",
        merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
        ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
      }),
    })),
    close: vi.fn(),
  }
  const orchestrator = createHermesOrchestrator({
    workspace: process.cwd(), runtimeRoot: root, state, lifecycle, selectOutcome, markComplete, markTerminal,
    clientFactory: () => client,
    holderId: "test-holder",
    now: () => new Date(currentTime),
  })
  return {
    root, state, orchestrator, selectOutcome, markComplete, markTerminal, lifecycle, client,
    advance: (milliseconds: number) => { currentTime += milliseconds },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Hermes bridge orchestrator", { timeout: 30_000 }, () => {
  it("stays silent and does not query outcomes while disabled", async () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    await expect(value.orchestrator.cycle()).resolves.toEqual({ result: "DISABLED" })
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
    expect(value.lifecycle.inspectChangedPaths.mock.invocationCallOrder[0])
      .toBeLessThan(value.lifecycle.mergePullRequest.mock.invocationCallOrder[0])
    expect(value.lifecycle.inspectPullRequestFiles.mock.invocationCallOrder[0])
      .toBeLessThan(value.lifecycle.mergePullRequest.mock.invocationCallOrder[0])
    expect(value.lifecycle.cleanupOwnedWorktree).toHaveBeenCalledWith(expect.objectContaining({
      mergeCommitSha: "b".repeat(40),
    }))
    expect(value.markComplete).toHaveBeenCalledWith(expect.objectContaining({ outcomeId: 77 }))
  })

  it("fails closed when Codex changes a path outside the lane reservation", async () => {
    const value = fixture(["components/hermes/live-status.tsx", "lib/db/schema.ts"])
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
    expect(value.markComplete).not.toHaveBeenCalled()
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
    expect(Date.parse(interrupted.lease.expiresAt)).toBe(Date.parse(interrupted.checkpoint.recordedAt))
    expect(value.markTerminal).not.toHaveBeenCalled()

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(value.state.read().executions["77"].fencingToken).toBeGreaterThan(interrupted.fencingToken)
    expect(value.client.resumeThread).toHaveBeenCalledWith("thread-77", expect.any(Object))
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
      result: "PROVIDER_UNAVAILABLE", nextState: "BOUNDED_PROVIDER_REDISPATCH_EXHAUSTED",
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77, result: "PROVIDER_UNAVAILABLE", nextState: "BOUNDED_PROVIDER_REDISPATCH_EXHAUSTED",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: { state: "PROVIDER_UNAVAILABLE", detail: "BOUNDED_PROVIDER_REDISPATCH_EXHAUSTED" },
      metadata: { providerRetryCount: 3 },
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
    value.markTerminal.mockRejectedValueOnce(new Error("database interruption"))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "RETRYABLE_PROVIDER_WALL" })
    await expect(value.orchestrator.cycle()).rejects.toThrow("database interruption")
    const interrupted = value.state.read().executions["77"]
    expect(interrupted.checkpoint.state).toBe("PROVIDER_UNAVAILABLE")
    const turnCount = value.client.runTurn.mock.calls.length
    value.advance(50 * 60 * 1000 + 1)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "PROVIDER_UNAVAILABLE" })
    expect(value.client.runTurn).toHaveBeenCalledTimes(turnCount)
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
  })

  it("fails closed when a durable owner-touch counter changes during execution", async () => {
    const value = fixture()
    const original = value.client.runTurn.getMockImplementation()
    value.client.runTurn.mockImplementationOnce(async (...args: unknown[]) => {
      const store = createHermesStateStore(value.orchestrator.statePath)
      store.recordOwnerTouch({ idempotencyKey: "owner-touch-during-run", counter: "ownerOperationTouchCount" })
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

  it("declassifies a terminal owner wall so it cannot starve later outcomes", async () => {
    const value = fixture()
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-77", turnId: "turn-wall", status: "completed",
      finalText: JSON.stringify({
        result: "OWNER_DECISION_REQUIRED", workOrder: "WO-HERMES-77-001",
        branch: "codex/hermes-goal-77-77", commit: null, prUrl: null, merged: false,
        mergeCommit: null, validation: [], reviewThreads: 0, ownerTouchCount: 0,
        blockedScopeCrossed: false, nextState: "NEW_AUTHORITY_REQUIRED",
      }),
    })
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "OWNER_DECISION_REQUIRED", outcomeId: "77",
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77, result: "OWNER_DECISION_REQUIRED", nextState: "NEW_AUTHORITY_REQUIRED",
    })
    expect(value.markComplete).not.toHaveBeenCalled()
  })
})
