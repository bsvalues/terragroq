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
  const deferOutcome = vi.fn(async () => true)
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
    clientFactory: () => client,
    holderId: "test-holder",
    now: () => new Date(currentTime),
    sleep: async () => {},
  })
  return {
    root, state, orchestrator, selectOutcome, markComplete, markTerminal, deferOutcome, lifecycle, client,
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
    expect(interrupted.metadata.remediationRound).toBeNull()
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
