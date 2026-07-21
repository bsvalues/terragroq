import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createHermesOrchestrator } from "../scripts/hermes-bridge/orchestrator.mjs"

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
  const lifecycle = {
    refreshOriginMain: vi.fn(async () => "a".repeat(40)),
    createWorktree: vi.fn(async ({ branch }: { branch: string }) => ({
      branch, worktreePath: path.join(root, "worktrees", "goal-77"),
    })),
    resumeOwnedWorktree: vi.fn(),
    inspectPullRequest: vi.fn(async () => ({
      state: "MERGED", checksGreen: true, unresolvedThreadCount: 0,
      mergeCommit: { oid: "b".repeat(40) },
    })),
    inspectChangedPaths: vi.fn(async () => changedPaths),
    verifyOriginMainContains: vi.fn(async () => true),
  }
  const client = {
    connect: vi.fn(async () => {}),
    startThread: vi.fn(async () => "thread-77"),
    resumeThread: vi.fn(async () => "thread-77"),
    runTurn: vi.fn(async () => ({
      threadId: "thread-77", turnId: "turn-77", status: "completed",
      finalText: JSON.stringify({
        result: "COMPLETE", workOrder: "WO-HERMES-77-001", branch: "codex/hermes-goal-77-77",
        commit: "c".repeat(40), prUrl: "https://github.com/bsvalues/terragroq/pull/500",
        merged: true, mergeCommit: "b".repeat(40), validation: ["pass"], reviewThreads: 0,
        ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "OUTCOME_COMPLETE",
      }),
    })),
    close: vi.fn(),
  }
  const orchestrator = createHermesOrchestrator({
    workspace: process.cwd(), runtimeRoot: root, lifecycle, selectOutcome, markComplete,
    clientFactory: () => client,
    holderId: "test-holder",
    now: () => new Date("2026-07-21T01:00:00.000Z"),
  })
  return { root, orchestrator, selectOutcome, markComplete, lifecycle, client }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("Hermes bridge orchestrator", () => {
  it("stays silent and does not query outcomes while disabled", async () => {
    const value = fixture()
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    await expect(value.orchestrator.cycle()).resolves.toEqual({ result: "DISABLED" })
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("dispatches a standing-authorized R0/R1 outcome and independently verifies its merge", async () => {
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
    expect(value.client.runTurn).toHaveBeenCalledWith(expect.objectContaining({
      turn: expect.objectContaining({
        effort: "ultra",
        sandboxPolicy: expect.objectContaining({ type: "workspaceWrite", networkAccess: true }),
      }),
    }))
    expect(value.lifecycle.inspectPullRequest).toHaveBeenCalledWith(500)
    expect(value.markComplete).toHaveBeenCalledWith(expect.objectContaining({ outcomeId: 77 }))
  })

  it("fails closed when Codex changes a path outside the lane reservation", async () => {
    const value = fixture(["components/hermes/live-status.tsx", "lib/db/schema.ts"])
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    expect(value.markComplete).not.toHaveBeenCalled()
  })
})
