import { EventEmitter } from "node:events"
import fs from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createHermesOrchestrator,
  deriveHermesRuntimeProjectionBindings,
  isExactReviewRecoveryCleanupRetryAbandonedLease,
  isExactReviewRecoveredAbandonedLease,
  isRetryableProjectionTransportError,
  requireHermesWorkContract,
  retryRuntimeProjection,
} from "../scripts/hermes-bridge/orchestrator.mjs"
import {
  createHermesStateStore,
  hermesTurnResultDigest,
  normalizeHermesTurnResult,
} from "../scripts/hermes-bridge/state-store.mjs"
import { AppServerTurnEndedError, parseAppServerUsageLimitRetryAfter } from "../scripts/hermes-bridge/app-server-client.mjs"
import { ClaudeLaneClient } from "../scripts/hermes-bridge/claude-lane-client.mjs"
import { HERMES_BLOCKED_SCOPE } from "../scripts/hermes-bridge/prompt.mjs"
import { deriveHermesWorkContract, resolveHermesWorkContract } from "../scripts/hermes-bridge/work-contract.mjs"
import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"

const roots: string[] = []

describe("exact review-recovered abandoned lease", () => {
  const checkpoint = { state: "REVIEW_REMEDIATION_RECOVERED", detail: "REVIEW_REMEDIATION_EXHAUSTED" }
  const now = Date.parse("2026-08-21T05:00:00.000Z")
  it.each([
    ["durable abandoned status", { status: "ABANDONED" }, checkpoint, true],
    ["exact expired active marker", { status: "ACTIVE", abandonedAt: "2026-08-21T04:00:00.000Z",
      expiresAt: "2026-08-21T04:00:00.000Z" }, checkpoint, true],
    ["empty marker", { status: "ACTIVE", abandonedAt: "", expiresAt: "" }, checkpoint, false],
    ["invalid marker", { status: "ACTIVE", abandonedAt: "invalid", expiresAt: "invalid" }, checkpoint, false],
    ["mismatched marker", { status: "ACTIVE", abandonedAt: "2026-08-21T03:59:00.000Z",
      expiresAt: "2026-08-21T04:00:00.000Z" }, checkpoint, false],
    ["live expiry stale marker", { status: "ACTIVE", abandonedAt: "2026-08-21T06:00:00.000Z",
      expiresAt: "2026-08-21T06:00:00.000Z" }, checkpoint, false],
    ["wrong checkpoint", { status: "ACTIVE", abandonedAt: "2026-08-21T04:00:00.000Z",
      expiresAt: "2026-08-21T04:00:00.000Z" }, { ...checkpoint, state: "LEASED" }, false],
  ])("classifies %s", (_name, lease, persistedCheckpoint, expected) => {
    expect(isExactReviewRecoveredAbandonedLease({ lease, checkpoint: persistedCheckpoint }, now))
      .toBe(expected)
  })
})

describe("exact review-recovery cleanup-retry abandoned lease", () => {
  const now = Date.parse("2026-08-21T09:00:00.000Z")
  const binding = {
    userId: "owner-id", outcomeKey: "goal:GOAL-0023", expectedVersion: 7,
    executionBinding: "execution-binding", acquisitionKey: "acquisition-key",
    leaseHolder: "resident-hermes", leaseToken: "lease-token", fencingToken: 5,
    activeWorkOrderId: 51,
    reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
    reviewRecoverySourceExpectedVersion: 4,
    reviewRecoverySourceFencingToken: 2,
    reviewRecoverySourceRuntimeAttempt: 5,
    reviewRecoveryReclaimEventId: 961,
    reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
  }
  const exact = {
    outcomeId: "27",
    lease: { status: "ACTIVE", abandonedAt: "2026-08-21T06:43:06.064Z",
      expiresAt: "2026-08-21T06:43:06.064Z", acquiredAt: "2026-08-21T06:43:06.038Z",
      abandonReason: "HERMES_RUNTIME_PROJECTION_WALL" },
    checkpoint: { sequence: 46, state: "POST_MERGE_CLEANUP_RETRY",
      detail: "HERMES_POST_MERGE_CLEANUP_WALL", recordedAt: "2026-08-21T05:52:01.251Z" },
    metadata: { reviewRecoveryProofDigest: "d".repeat(64), prNumber: 929,
      headRefOid: "a".repeat(40), mergeSha: "b".repeat(40), postMergeCleanupRetryCount: 1,
      postMergeCleanupCauseCode: null, outcome: { id: 27, queueBinding: binding } },
  }
  it("admits only the exact retained seq46 recovery cleanup retry", () => {
    expect(isExactReviewRecoveryCleanupRetryAbandonedLease(exact, now)).toBe(true)
    expect(isExactReviewRecoveryCleanupRetryAbandonedLease(exact, Number.NaN)).toBe(false)
  })
  it.each([
    ["checkpoint state", { checkpoint: { ...exact.checkpoint, state: "RETRYABLE_WALL" } }],
    ["checkpoint sequence", { checkpoint: { ...exact.checkpoint, sequence: 45 } }],
    ["checkpoint sequence 47", { checkpoint: { ...exact.checkpoint, sequence: 47 } }],
    ["checkpoint chronology", { checkpoint: { ...exact.checkpoint,
      recordedAt: "2026-08-21T06:43:07.000Z" } }],
    ["checkpoint time", { checkpoint: { ...exact.checkpoint, recordedAt: "invalid" } }],
    ["checkpoint noncanonical time", { checkpoint: { ...exact.checkpoint,
      recordedAt: "2026-08-21T05:52:01.251+00:00" } }],
    ["checkpoint detail", { checkpoint: { ...exact.checkpoint, detail: "OTHER" } }],
    ["lease status", { lease: { ...exact.lease, status: "ABANDONED" } }],
    ["lease reason", { lease: { ...exact.lease, abandonReason: "PROCESS_CRASH" } }],
    ["lease missing marker", { lease: { ...exact.lease, abandonedAt: undefined } }],
    ["lease marker", { lease: { ...exact.lease, abandonedAt: "2026-08-21T06:43:05.000Z" } }],
    ["lease not expired", { lease: { ...exact.lease,
      abandonedAt: "2026-08-21T10:00:00.000Z", expiresAt: "2026-08-21T10:00:00.000Z" } }],
    ["lease noncanonical marker", { lease: { ...exact.lease,
      abandonedAt: "2026-08-21T06:43:06.064+00:00",
      expiresAt: "2026-08-21T06:43:06.064+00:00" } }],
    ["lease chronology", { lease: { ...exact.lease, acquiredAt: "2026-08-21T06:43:07.000Z" } }],
    ["lease noncanonical acquisition", { lease: { ...exact.lease,
      acquiredAt: "2026-08-21T06:43:06.038+00:00" } }],
    ["renewal chronology", { lease: { ...exact.lease, renewedAt: "2026-08-21T06:43:07.000Z" } }],
    ["renewal noncanonical time", { lease: { ...exact.lease,
      renewedAt: "2026-08-21T06:43:06.040+00:00" } }],
    ["lease time", { lease: { ...exact.lease, acquiredAt: "invalid" } }],
    ["retry count", { metadata: { ...exact.metadata, postMergeCleanupRetryCount: 0 } }],
    ["retry count 2", { metadata: { ...exact.metadata, postMergeCleanupRetryCount: 2 } }],
    ["retry fractional", { metadata: { ...exact.metadata, postMergeCleanupRetryCount: 1.5 } }],
    ["retry oversized", { metadata: { ...exact.metadata, postMergeCleanupRetryCount: 99 } }],
    ["cause code", { metadata: { ...exact.metadata, postMergeCleanupCauseCode: "bad" } }],
    ["typed cause code", { metadata: { ...exact.metadata,
      postMergeCleanupCauseCode: "HERMES_REPOSITORY_COMMAND_FAILED" } }],
    ["proof digest", { metadata: { ...exact.metadata, reviewRecoveryProofDigest: null } }],
    ["PR", { metadata: { ...exact.metadata, prNumber: 0 } }],
    ["head", { metadata: { ...exact.metadata, headRefOid: "bad" } }],
    ["merge", { metadata: { ...exact.metadata, mergeSha: "bad" } }],
    ["outcome identity", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, id: 28,
    } } }],
    ["outcome missing", { metadata: { ...exact.metadata, outcome: undefined } }],
    ["resume state", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, queueBinding: { ...binding,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED" },
    } } }],
    ["version delta", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, queueBinding: { ...binding, expectedVersion: 8 },
    } } }],
    ["version delta plus 2", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, queueBinding: { ...binding, expectedVersion: 6 },
    } } }],
    ["fence delta", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, queueBinding: { ...binding, fencingToken: 6 },
    } } }],
    ["unexpected base marker", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, queueBinding: { ...binding,
        reviewRecoveryStaleReacquisition: { disposition: "RECLAIMED" } },
    } } }],
    ["source chain", { metadata: { ...exact.metadata, outcome: { queueBinding: {
      ...binding, reviewRecoverySourceRuntimeAttempt: undefined,
    } } } }],
    ["event chain", { metadata: { ...exact.metadata, outcome: { queueBinding: {
      ...binding, reviewRecoveryReclaimEventId: undefined,
    } } } }],
    ["event digest", { metadata: { ...exact.metadata, outcome: { queueBinding: {
      ...binding, reviewRecoveryReclaimPayloadDigest: "bad",
    } } } }],
    ["work order", { metadata: { ...exact.metadata, outcome: { queueBinding: {
      ...binding, activeWorkOrderId: 0,
    } } } }],
    ["unexpected continuation marker", { metadata: { ...exact.metadata, outcome: {
      ...exact.metadata.outcome, queueBinding: { ...binding,
        reviewRecoveryStaleContinuation: { disposition: "REPLAY_WINNER" } },
    } } }],
  ])("rejects %s drift", (_name, drift) => {
    expect(isExactReviewRecoveryCleanupRetryAbandonedLease({ ...exact, ...drift }, now)).toBe(false)
  })
})
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
const readyTurnResult = {
  result: "READY_FOR_VALIDATION",
  workOrder: "WO-HERMES-77-001",
  branch: "codex/hermes-goal-77-77",
  commit: null,
  prUrl: null,
  merged: false,
  mergeCommit: null,
  validation: ["pass"],
  reviewThreads: 0,
  ownerTouchCount: 0,
  blockedScopeCrossed: false,
  nextState: "READY_FOR_HERMES_MERGE",
  blockedAction: null,
  authorityBoundary: null,
  minimumChoice: null,
  approveConsequence: null,
  denyConsequence: null,
}
const closedFinding = {
  findingId: "FINDING-911-CALLER",
  sequence: 1,
  summary: "Persist the bounded caller finding",
  task: "Project the finding through the runtime checkpoint",
  paths: ["components/hermes/live-status.tsx"],
  effects: {
    spendsMoney: false,
    irreversible: false,
    mutatesProductionData: false,
    releaseOrCutover: false,
    protectedResource: false,
    unresolvedLegalPrivacyOrSecurityRisk: false,
    touchesCredentials: false,
    changesReviewedPolicy: false,
    outsideObjectiveScope: false,
    competesWithPriority: false,
    destroys: [],
  },
}

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
    runTurn: vi.fn(async ({ prompt }: { prompt: string }) => {
      const workOrder = prompt.match(/\bWO-HERMES-\d+-001\b/)?.[0] ?? "WO-HERMES-77-001"
      const branch = prompt.match(/\bcodex\/[a-z0-9-]+\b/)?.[0] ?? "codex/hermes-goal-77-77"
      return {
        threadId: "thread-77", turnId: "turn-77", status: "completed",
        finalText: JSON.stringify({
        result: "READY_FOR_VALIDATION", workOrder, branch,
        commit: null, prUrl: null,
        merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
        ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
        blockedAction: null, authorityBoundary: null, minimumChoice: null,
        approveConsequence: null, denyConsequence: null,
      }),
      }
    }),
    close: vi.fn(),
  }
  const orchestrator = createHermesOrchestrator({
    workspace: process.cwd(), runtimeRoot: root, state, lifecycle, selectOutcome, markComplete, markTerminal, deferOutcome,
    projectCheckpoint, projectLease, readApprovedOwnerDecision,
    clientFactory: () => client,
    // Lane availability is HOST state, and the default path derives from runtimeRoot/.. — i.e. the
    // shared temp directory every fixture sits in. One test recording a usage-limit exhaustion there
    // would otherwise be visible to every later test (and every later RUN), which is a genuine
    // cross-test leak now that dispatch reads this file. Each fixture gets its own; anything in
    // orchestratorOptions still overrides it, since that spread comes last.
    providerStatusPath: path.join(root, "provider-status.json"),
    holderId: "test-holder",
    now: () => new Date(currentTime),
    sleep: async () => {},
    workContractResolver: (outcome: { lane?: string }) => ({
      version: "test.v1",
      id: "orchestrator-fixture",
      digest: "f".repeat(64),
      repository: "bsvalues/terragroq",
      lane: "test",
      reservations: outcome.lane === "read_model"
        ? ["app/actions/goal-timeline.ts"]
        : [
            "components/hermes/live-status.tsx",
            "tests/hermes-live-status.test.tsx",
            "tests/deleted-hermes-status.test.tsx",
          ],
      validationCommands: [
        { command: "npx", args: ["vitest", "run", "tests/outcome-execution-control-rendered.test.tsx"], timeoutMs: 900_000 },
        { command: "npm", args: ["run", "lint"], timeoutMs: 600_000 },
        { command: "npm", args: ["run", "build"], timeoutMs: 900_000 },
      ],
    }),
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

describe("deterministic validator circuit breaking", () => {
  const queueRecovery = vi.fn(async ({ execution }: any) => {
    const circuit = execution.metadata.deterministicValidatorCircuit
    const queue = execution.metadata.outcome.queueBinding
    return {
      version: "hermes-deterministic-validator-queue-recovery.v1",
      recoveryId: circuit.recovery.recoveryId,
      fingerprint: circuit.fingerprint,
      sourceExpectedVersion: queue.expectedVersion,
      sourceFencingToken: queue.fencingToken,
      recoveredExpectedVersion: queue.expectedVersion + 1,
      recoveredFencingToken: queue.fencingToken + 1,
      recoveredLeaseExpiresAt: "2026-07-21T01:50:01.000Z",
      recordedAt: "2026-07-21T01:00:01.000Z",
      receiptId: 911,
      replacementContract: circuit.recovery.replacementContract,
    }
  })

  it("fences the first literal-coverage wall, resumes once with the immutable overlay, and does not select a successor", async () => {
    const executionBackend = {
      stat: vi.fn(async () => ({ exists: true, isFile: true })),
    }
    const selectOutcome = vi.fn(async () => queueBoundOutcome())
    const packageLocalTest = "packages/ui/src/__tests__/county.spec.ts"
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(["components/hermes/live-status.tsx", packageLocalTest], {
      executionBackend, selectOutcome,
      refreshQueueOutcome,
      recoverDeterministicValidatorQueue: queueRecovery,
      workContractResolver: () => ({
        version: "test.v1", id: "orchestrator-package-fixture", digest: "e".repeat(64),
        repository: "bsvalues/terragroq", lane: "test",
        reservations: ["components/hermes/live-status.tsx", packageLocalTest],
        validationCommands: [{
          command: "npx", args: ["vitest", "run", "tests/outcome-execution-control-rendered.test.tsx"],
          timeoutMs: 900_000,
        }],
      }),
    })
    Object.assign(value.lifecycle, {
      inspectWorktreeSnapshot: vi.fn(async () => ({
        snapshotHash: "a".repeat(64),
        manifest: { version: "hermes-worktree-snapshot.v1" },
      })),
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_WORK_CONTRACT_VALIDATOR_WALL",
    })
    const tripped = value.state.read().executions["77"]
    expect(tripped.lease.status).toBe("ABANDONED")
    expect(tripped.metadata.deterministicValidatorCircuit).toMatchObject({
      status: "DETERMINISTIC_CONTRACT_RECOVERY",
      recoveryAttemptOrdinal: 1,
    })
    const sourceFence = tripped.fencingToken

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", outcomeId: "77" })
    const recovered = value.state.read().executions["77"]
    expect(recovered.fencingToken).toBeGreaterThan(sourceFence)
    expect(recovered.metadata.deterministicValidatorCircuit.status).toBe("RECOVERED")
    expect(selectOutcome).toHaveBeenCalledTimes(1)
    expect(queueRecovery).toHaveBeenCalledOnce()
    expect(queueRecovery.mock.invocationCallOrder[0])
      .toBeLessThan(refreshQueueOutcome.mock.invocationCallOrder.at(-1)!)
    expect(recovered.metadata.outcome.queueBinding).toMatchObject({ expectedVersion: 4, fencingToken: 3 })
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalledWith(expect.objectContaining({
      commands: expect.arrayContaining([expect.objectContaining({
        command: "npx",
        args: expect.arrayContaining([packageLocalTest]),
      })]),
    }))
  })

  it("fails closed when the worktree changes after the deterministic wall and before activation", async () => {
    const executionBackend = { stat: vi.fn(async () => ({ exists: true, isFile: true })) }
    const value = fixture(["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"], {
      executionBackend,
      selectOutcome: vi.fn(async () => queueBoundOutcome()),
      recoverDeterministicValidatorQueue: queueRecovery,
    })
    const inspectWorktreeSnapshot = vi.fn(async () => ({
      snapshotHash: "a".repeat(64), manifest: { version: "hermes-worktree-snapshot.v1" },
    }))
    Object.assign(value.lifecycle, { inspectWorktreeSnapshot })
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_WORK_CONTRACT_VALIDATOR_WALL",
    })
    inspectWorktreeSnapshot.mockResolvedValue({
      snapshotHash: "b".repeat(64), manifest: { version: "hermes-worktree-snapshot.v1" },
    })
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_DETERMINISTIC_RECOVERY_SNAPSHOT_WALL",
    })
    expect(value.lifecycle.runValidationCommands).not.toHaveBeenCalled()
  })

  it("opens permanently on a second wall and never advances to a successor", async () => {
    const executionBackend = {
      stat: vi.fn(async () => ({ exists: true, isFile: true })),
    }
    const selectOutcome = vi.fn(async () => queueBoundOutcome())
    const value = fixture(undefined, {
      executionBackend, selectOutcome,
      recoverDeterministicValidatorQueue: queueRecovery,
    })
    Object.assign(value.lifecycle, {
      inspectWorktreeSnapshot: vi.fn(async () => ({
        snapshotHash: "a".repeat(64),
        manifest: { version: "hermes-worktree-snapshot.v1" },
      })),
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_WORK_CONTRACT_VALIDATOR_WALL",
    })
    const secondWallPaths = [
      "components/hermes/live-status.tsx",
      "tests/hermes-live-status.test.tsx",
      "tests/deleted-hermes-status.test.tsx",
    ]
    value.lifecycle.inspectWorkingTreePaths.mockResolvedValue(secondWallPaths)
    value.lifecycle.inspectChangedPaths.mockResolvedValue(secondWallPaths)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_DETERMINISTIC_RECOVERY_REQUIRED",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ABANDONED", abandonReason: "DETERMINISTIC_RECOVERY_REQUIRED" },
      checkpoint: { state: "RECOVERY_REQUIRED" },
      metadata: { deterministicValidatorCircuit: { status: "RECOVERY_REQUIRED" } },
    })
    await expect(value.orchestrator.cycle()).resolves.toEqual({
      result: "RECOVERY_REQUIRED", outcomeId: "77", nextState: "DETERMINISTIC_RECOVERY_REQUIRED",
    })
    expect(selectOutcome).toHaveBeenCalledTimes(1)
    expect(value.markComplete).not.toHaveBeenCalled()
  })
})

describe("retired durable queue acquisition reconciliation", () => {
  it("reconciles one explicit retired acquisition while disabled and replays without another event", async () => {
    const resolveRetiredAcquisition = vi.fn()
    const value = fixture(undefined, { resolveRetiredAcquisition })
    const outcome = queueBoundOutcome()
    const acquired = prepareRetiredExecution(value, outcome, "dedicated")
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    resolveRetiredAcquisition.mockResolvedValue(retiredAcquisitionProof(outcome, acquired.fencingToken))

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).resolves.toMatchObject({
      result: "DURABLE_QUEUE_ACQUISITION_RETIRED",
      outcomeId: "77",
      checkpointSequence: 5,
      replayed: false,
    })
    const afterFirst = value.state.read()
    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).resolves.toMatchObject({
      result: "DURABLE_QUEUE_ACQUISITION_RETIRED",
      outcomeId: "77",
      checkpointSequence: 5,
      replayed: true,
    })

    expect(resolveRetiredAcquisition).toHaveBeenCalledOnce()
    expect(value.state.read()).toEqual(afterFirst)
    expect(value.state.read().executions["77"].metadata.durableQueueAcquisitionRetirementEvents)
      .toHaveLength(1)
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.lifecycle.refreshOriginMain).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
  })

  it("constructs the dedicated recovery surface without backend or lifecycle construction", () => {
    const root = runtime()
    fs.writeFileSync(path.join(root, "control", "activation"), "disabled\n")
    const selectBackend = vi.fn(() => { throw new Error("backend must not be constructed") })
    const createLifecycle = vi.fn(() => { throw new Error("lifecycle must not be constructed") })

    const orchestrator = createHermesOrchestrator({
      runtimeRoot: root,
      reconciliationOnly: true,
      selectExecutionBackend: selectBackend,
      createLifecycle,
    })

    expect(orchestrator.reconcileRetiredAcquisition).toBeTypeOf("function")
    expect(orchestrator).not.toHaveProperty("cycle")
    expect(orchestrator).not.toHaveProperty("abandonOwnedCycleLease")
    expect(orchestrator).not.toHaveProperty("state")
    expect(selectBackend).not.toHaveBeenCalled()
    expect(createLifecycle).not.toHaveBeenCalled()
  })

  it("walls an active kill switch before durable proof resolution", async () => {
    const resolveRetiredAcquisition = vi.fn()
    const value = fixture(undefined, { resolveRetiredAcquisition })
    prepareRetiredExecution(value, queueBoundOutcome(), "kill-switch")
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    value.state.setKillSwitch({ idempotencyKey: "retired-kill-switch", active: true, reason: "contained" })
    const before = value.state.read()

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "KILL_SWITCH_ACTIVE" })
    expect(resolveRetiredAcquisition).not.toHaveBeenCalled()
    expect(value.state.read()).toEqual(before)
  })

  it("rechecks containment after durable proof resolution and before local CAS", async () => {
    const value = fixture()
    const outcome = queueBoundOutcome()
    const acquired = prepareRetiredExecution(value, outcome, "containment-race")
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    const resolveRetiredAcquisition = vi.fn(async () => {
      fs.writeFileSync(path.join(value.root, "control", "activation"), "enabled\n")
      return retiredAcquisitionProof(outcome, acquired.fencingToken)
    })
    const dedicated = createHermesOrchestrator({
      runtimeRoot: value.root,
      state: value.state,
      lifecycle: value.lifecycle,
      resolveRetiredAcquisition,
      now: () => new Date("2026-07-21T01:00:01.001Z"),
    })
    const before = value.state.read()

    await expect(dedicated.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "HERMES_RETIRED_ACQUISITION_RECOVERY_CONTAINMENT_WALL" })
    expect(resolveRetiredAcquisition).toHaveBeenCalledOnce()
    expect(value.state.read()).toEqual(before)
  })

  it("walls a missing durable retirement proof without local mutation", async () => {
    const resolveRetiredAcquisition = vi.fn(async () => null)
    const value = fixture(undefined, { resolveRetiredAcquisition })
    prepareRetiredExecution(value, queueBoundOutcome(), "missing-proof")
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    const before = value.state.read()

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "HERMES_RETIRED_ACQUISITION_RECOVERY_PROOF_WALL" })
    expect(value.state.read()).toEqual(before)
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
    expect(value.selectOutcome).not.toHaveBeenCalled()
  })

  it("walls a second active execution before durable proof resolution", async () => {
    const resolveRetiredAcquisition = vi.fn()
    const value = fixture(undefined, { resolveRetiredAcquisition })
    prepareRetiredExecution(value, queueBoundOutcome(), "multiple")
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    value.state.acquireLease({
      idempotencyKey: "retired-second-active",
      outcomeId: "78",
      holderId: "other-holder",
      leaseDurationMs: 60_000,
      metadata: { outcome: { id: 78 } },
    })
    const before = value.state.read()

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "HERMES_RETIRED_ACQUISITION_RECOVERY_CANDIDATE_WALL" })
    expect(resolveRetiredAcquisition).not.toHaveBeenCalled()
    expect(value.state.read()).toEqual(before)
  })

  it("walls duplicate local replay settlement evidence", async () => {
    const resolveRetiredAcquisition = vi.fn()
    const value = fixture(undefined, { resolveRetiredAcquisition })
    const outcome = queueBoundOutcome()
    const acquired = prepareRetiredExecution(value, outcome, "duplicate-replay")
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    resolveRetiredAcquisition.mockResolvedValue(retiredAcquisitionProof(outcome, acquired.fencingToken))
    await value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })
    const statePath = path.join(value.root, "state", "state.json")
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
    const [retirementKey, retirementEntry] = Object.entries(persisted.idempotency)
      .find(([key]) => key.startsWith("77:retire-durable-acquisition:"))!
    persisted.idempotency[`${retirementKey}:duplicate`] = retirementEntry
    fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`)

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "HERMES_RETIRED_ACQUISITION_RECOVERY_CANDIDATE_WALL" })
    expect(resolveRetiredAcquisition).toHaveBeenCalledOnce()
  })

  it.each([
    ["idempotency key", (persisted: any) => {
      const key = Object.keys(persisted.idempotency)
        .find((candidate) => candidate.startsWith("77:retire-durable-acquisition:"))!
      persisted.idempotency[`${key}:drift`] = persisted.idempotency[key]
      delete persisted.idempotency[key]
    }],
    ["idempotency result", (persisted: any) => {
      const key = Object.keys(persisted.idempotency)
        .find((candidate) => candidate.startsWith("77:retire-durable-acquisition:"))!
      persisted.idempotency[key].result.checkpointSequence = 6
    }],
    ["prior lease chronology", (persisted: any) => {
      const event = persisted.executions["77"].metadata.durableQueueAcquisitionRetirementEvents[0]
      event.priorLease.expiresAt = new Date(Date.parse(event.recordedAt) + 1).toISOString()
    }],
  ])("walls coherent replay drift in %s", async (_name, mutatePersisted) => {
    const resolveRetiredAcquisition = vi.fn()
    const value = fixture(undefined, { resolveRetiredAcquisition })
    const outcome = queueBoundOutcome()
    const acquired = prepareRetiredExecution(value, outcome, `replay-${_name}`)
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    resolveRetiredAcquisition.mockResolvedValue(retiredAcquisitionProof(outcome, acquired.fencingToken))
    await value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })
    const statePath = path.join(value.root, "state", "state.json")
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
    mutatePersisted(persisted)
    fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`)

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "HERMES_RETIRED_ACQUISITION_RECOVERY_CANDIDATE_WALL" })
    expect(resolveRetiredAcquisition).toHaveBeenCalledOnce()
  })

  it.each([
    ["enabled activation", ({ root }) => fs.writeFileSync(path.join(root, "control", "activation"), "enabled\n")],
    ["missing activation", ({ root }) => fs.rmSync(path.join(root, "control", "activation"))],
    ["supervisor evidence", ({ root }) => fs.writeFileSync(path.join(root, "state", "supervisor.json"), "{}\n")],
  ])("walls %s before resolving or mutating local state", async (_name, arrange) => {
    const resolveRetiredAcquisition = vi.fn()
    const value = fixture(undefined, { resolveRetiredAcquisition })
    prepareRetiredExecution(value, queueBoundOutcome(), `wall-${_name}`)
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    arrange(value)
    const before = value.state.read()

    await expect(value.orchestrator.reconcileRetiredAcquisition({
      expectedOutcomeId: "77",
      expectedOutcomeKey: "goal:GOAL-0011",
    })).rejects.toMatchObject({ code: "HERMES_RETIRED_ACQUISITION_RECOVERY_CONTAINMENT_WALL" })
    expect(resolveRetiredAcquisition).not.toHaveBeenCalled()
    expect(value.state.read()).toEqual(before)
  })

  it("retires the exact expired local execution before projection, refresh, selection, or host effects", async () => {
    const resolveRetiredAcquisition = vi.fn()
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, { resolveRetiredAcquisition, refreshQueueOutcome })
    const outcome = queueBoundOutcome()
    const acquired = prepareRetiredExecution(value, outcome, "success")
    const binding = outcome.queueBinding
    const proofBody = {
      schemaVersion: 1,
      kind: "DURABLE_QUEUE_ACQUISITION_RETIRED",
      outcomeId: 77,
      userId: binding.userId,
      outcomeKey: binding.outcomeKey,
      activeWorkOrderId: binding.activeWorkOrderId,
      runtimeAttempt: acquired.fencingToken,
      priorVersion: binding.expectedVersion,
      recoveredVersion: binding.expectedVersion + 1,
      priorFencingToken: binding.fencingToken,
      recoveredFencingToken: binding.fencingToken + 1,
      receiptId: 7,
      blockedAttemptId: 207,
      replayAttemptIds: [224],
      acquisitionKeyDigest: createHash("sha256")
        .update(JSON.stringify({ acquisitionKey: binding.acquisitionKey })).digest("hex"),
      leaseIdentityDigest: createHash("sha256").update(JSON.stringify({
        leaseHolder: binding.leaseHolder,
        leaseToken: binding.leaseToken,
      })).digest("hex"),
      executionEpochDigest: createHash("sha256").update(JSON.stringify([
        binding.userId, binding.outcomeKey, binding.executionBinding, binding.acquisitionKey,
      ])).digest("hex"),
      blockedAt: "2026-07-21T01:00:00.500Z",
    }
    resolveRetiredAcquisition.mockResolvedValue({
      ...proofBody,
      proofDigest: createHash("sha256").update(JSON.stringify(proofBody)).digest("hex"),
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "DURABLE_QUEUE_ACQUISITION_RETIRED",
      outcomeId: "77",
      checkpointSequence: 5,
    })
    expect(resolveRetiredAcquisition).toHaveBeenCalledOnce()
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(refreshQueueOutcome).not.toHaveBeenCalled()
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.lifecycle.refreshOriginMain).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED", releaseReason: "DURABLE_QUEUE_ACQUISITION_RETIRED" },
      checkpoint: { sequence: 5, state: "DURABLE_QUEUE_ACQUISITION_RETIRED" },
    })
  })

  it("walls a drifted durable proof before local state, projection, queue, or host effects", async () => {
    const proofWall = Object.assign(new Error("drift"), {
      code: "OUTCOME_RETIRED_ACQUISITION_PROOF_WALL",
    })
    const resolveRetiredAcquisition = vi.fn(async () => { throw proofWall })
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, { resolveRetiredAcquisition, refreshQueueOutcome })
    prepareRetiredExecution(value, queueBoundOutcome(), "wall")
    const before = value.state.read()

    await expect(value.orchestrator.cycle()).rejects.toBe(proofWall)
    expect(value.state.read()).toEqual(before)
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(refreshQueueOutcome).not.toHaveBeenCalled()
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.lifecycle.refreshOriginMain).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
  })

  it("keeps an expired ordinary same-key acquisition on the existing recovery path", async () => {
    const resolveRetiredAcquisition = vi.fn(async () => null)
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, { resolveRetiredAcquisition, refreshQueueOutcome })
    prepareRetiredExecution(value, queueBoundOutcome(), "ordinary")

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(resolveRetiredAcquisition).toHaveBeenCalledOnce()
    expect(value.projectCheckpoint).toHaveBeenCalled()
    expect(refreshQueueOutcome).toHaveBeenCalled()
    expect(value.state.read().executions["77"]).not.toMatchObject({
      checkpoint: { state: "DURABLE_QUEUE_ACQUISITION_RETIRED" },
    })
  })
})

function prepareRetiredExecution(value: ReturnType<typeof fixture>, outcome: any, suffix: string) {
  value.state.initialize()
  const acquired = value.state.acquireLease({ idempotencyKey: `retired-orchestrator-acquire-${suffix}`,
    outcomeId: "77", holderId: "crashed-holder", leaseDurationMs: 1_000,
    metadata: { outcome } })
  for (const [state, sequence] of [["QUEUE_WORK_ORDER_BOUND", 1], ["WORKTREE_INTENT", 2],
    ["WORKTREE_READY", 3], ["CODEX_THREAD_READY", 4]] as const) {
    value.state.checkpoint({ idempotencyKey: `retired-orchestrator-${suffix}-cp${sequence}`,
      outcomeId: "77", holderId: "crashed-holder", fencingToken: acquired.fencingToken,
      expectedCheckpointSequence: value.state.read().executions["77"].checkpoint.sequence,
      state })
  }
  value.advance(1_001)
  return acquired
}

function queueBoundOutcome() {
  return {
    id: 77,
    userId: "owner-id",
    ref: "GOAL-0011",
    command: "Add a compact on-screen latest-evidence timestamp to selected Thread work status.",
    lane: "ui",
    mode: "implement",
    risk: "low",
    authority: "A2_WRITE_OWN",
    verdict: "requires_approval",
    requiresApproval: true,
    status: "classified",
    queueBinding: {
      userId: "owner-id",
      outcomeKey: "goal:GOAL-0011",
      expectedVersion: 3,
      executionBinding: "execution-goal-0011",
      leaseHolder: "Hermes:hermes-outcome-queue",
      leaseToken: "lease-goal-0011",
      fencingToken: 2,
      acquisitionKey: "acquisition-goal-0011",
      activeWorkOrderId: 77,
    },
  }
}

function retiredAcquisitionProof(outcome: ReturnType<typeof queueBoundOutcome>, runtimeAttempt: number) {
  const binding = outcome.queueBinding
  const body = {
    schemaVersion: 1,
    kind: "DURABLE_QUEUE_ACQUISITION_RETIRED",
    outcomeId: outcome.id,
    userId: binding.userId,
    outcomeKey: binding.outcomeKey,
    activeWorkOrderId: binding.activeWorkOrderId,
    runtimeAttempt,
    priorVersion: binding.expectedVersion,
    recoveredVersion: binding.expectedVersion + 1,
    priorFencingToken: binding.fencingToken,
    recoveredFencingToken: binding.fencingToken + 1,
    receiptId: 7,
    blockedAttemptId: 207,
    replayAttemptIds: [224],
    acquisitionKeyDigest: createHash("sha256")
      .update(JSON.stringify({ acquisitionKey: binding.acquisitionKey })).digest("hex"),
    leaseIdentityDigest: createHash("sha256").update(JSON.stringify({
      leaseHolder: binding.leaseHolder,
      leaseToken: binding.leaseToken,
    })).digest("hex"),
    executionEpochDigest: createHash("sha256").update(JSON.stringify([
      binding.userId, binding.outcomeKey, binding.executionBinding, binding.acquisitionKey,
    ])).digest("hex"),
    blockedAt: "2026-07-21T01:00:00.500Z",
  }
  return {
    ...body,
    proofDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  }
}

function seedGoalStyleRetryableExecution(
  value: ReturnType<typeof fixture>,
  outcome = queueBoundOutcome(),
  leaseDurationMs = 1_000,
) {
  const lease = value.state.acquireLease({
    idempotencyKey: "goal-0011-acquire",
    outcomeId: "77",
    holderId: "crashed-holder",
    leaseDurationMs,
    metadata: {
      outcome,
      branch: "codex/hermes-goal-0011-15",
      worktreePath: "/home/bs/.williamos/hermes-bridge/worktrees/hermes-goal-0011-15",
      baseSha: "a".repeat(40),
      threadId: "thread-goal-0011",
    },
  })
  let sequence = lease.checkpointSequence
  for (const [state, metadata] of [
    ["WORKTREE_INTENT", {}],
    ["WORKTREE_READY", {}],
    ["CODEX_THREAD_READY", { threadId: "thread-goal-0011" }],
    ["RETRYABLE_WALL", { threadId: "thread-goal-0011" }],
  ] as const) {
    const checkpoint = value.state.checkpoint({
      idempotencyKey: `goal-0011-${state.toLowerCase()}`,
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: sequence,
      state,
      detail: state === "RETRYABLE_WALL" ? "HERMES_CYCLE_FAILED" : null,
      metadata,
    })
    sequence = checkpoint.checkpointSequence
  }
  return lease
}

describe("Hermes bridge orchestrator", { timeout: 30_000 }, () => {
  it("carries the immutable acquisition key into runtime projection authorization", () => {
    const contract = {
      version: "hermes-work-contract.v1", id: "issue-911-runtime-reliability-evidence.v1",
      digest: "a".repeat(64), repository: "bsvalues/terragroq", lane: "operator-objective",
      reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validationCommands: [{ command: "git", args: ["diff", "--check"] }],
    }
    expect(deriveHermesRuntimeProjectionBindings({
      queueBinding: {
        userId: "owner", outcomeKey: "goal:GOAL-0023", expectedVersion: 3,
        executionBinding: "execution-27", leaseToken: "lease-27", leaseHolder: "hermes-27",
        fencingToken: 2, acquisitionKey: "acquisition-27",
      },
    }, { resolver: () => contract })).toMatchObject({
      executionBinding: { acquisitionKey: "acquisition-27" },
    })
  })

  it("carries only a closed stale review-reacquisition projection marker", () => {
    const command = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({ command, title: command, objective: command,
      lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN" })!
    const marker = {
      disposition: "REPLAY_WINNER", expectedVersion: 7, fencingToken: 5,
      leaseExpiresAt: "2098-01-02T12:50:00.000Z", lifecycleReason: "STALE_LEASE_RECOVERED",
      priorExpectedVersion: 6, priorFencingToken: 4, receiptLatestFencingToken: 5,
      checkpointDigest: "e".repeat(64),
    }
    const continuation = {
      disposition: "RECLAIMED", expectedVersion: 8, fencingToken: 6,
      leaseExpiresAt: "2098-01-02T13:50:00.000Z", lifecycleReason: "STALE_LEASE_RECOVERED",
      priorExpectedVersion: 7, priorFencingToken: 5,
      priorLeaseExpiresAt: marker.leaseExpiresAt, receiptLatestFencingToken: 6,
      checkpointDigest: "f".repeat(64),
    }
    const outcome = {
      id: 23,
      outcomeKey: "goal:GOAL-0023",
      verifiedQueueWorkContract: { contract, provenance: { operation: "workbench_execution.authorize",
        outcomeKey: "goal:GOAL-0023", workOrderRef: "WO-HERMES-OUTCOME-23" } },
      queueBinding: {
        userId: "owner", outcomeKey: "goal:GOAL-0023", expectedVersion: 7,
        executionBinding: "execution-27", leaseToken: "lease-27", leaseHolder: "hermes-27",
        fencingToken: 5, acquisitionKey: "acquisition-27",
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
        reviewRecoverySourceExpectedVersion: 4, reviewRecoverySourceFencingToken: 2,
        reviewRecoverySourceRuntimeAttempt: 5, reviewRecoveryReclaimEventId: 961,
        reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
        reviewRecoveryStaleReacquisition: marker,
      },
    }
    const legacyResumeOnly = { ...outcome.queueBinding, expectedVersion: 5, fencingToken: 3,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
      reviewRecoverySourceExpectedVersion: undefined, reviewRecoverySourceFencingToken: undefined,
      reviewRecoverySourceRuntimeAttempt: undefined, reviewRecoveryReclaimEventId: undefined,
      reviewRecoveryReclaimPayloadDigest: undefined, reviewRecoveryStaleReacquisition: undefined }
    const validBindings = [
      legacyResumeOnly,
      { ...outcome.queueBinding, expectedVersion: 5, fencingToken: 3,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
        reviewRecoveryReclaimEventId: undefined, reviewRecoveryReclaimPayloadDigest: undefined,
        reviewRecoveryStaleReacquisition: undefined },
      { ...outcome.queueBinding, expectedVersion: 6, fencingToken: 4,
        reviewRecoveryStaleReacquisition: undefined },
      outcome.queueBinding,
      { ...outcome.queueBinding, expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleContinuation: continuation },
    ]
    for (const queueBinding of validBindings) {
      for (const options of [{ requireVerified: true }, { requireVerified: false }]) {
        expect(() => deriveHermesRuntimeProjectionBindings({ ...outcome, queueBinding }, options))
          .not.toThrow()
      }
    }
    expect(deriveHermesRuntimeProjectionBindings(outcome)).toMatchObject({
      executionBinding: { reviewRecoveryStaleReacquisition: marker },
    })
    expect(deriveHermesRuntimeProjectionBindings({ ...outcome, queueBinding: {
      ...outcome.queueBinding, expectedVersion: 8, fencingToken: 6,
      reviewRecoveryStaleContinuation: continuation,
    } })).toMatchObject({ executionBinding: {
      reviewRecoveryStaleReacquisition: marker,
      reviewRecoveryStaleContinuation: continuation,
    } })
    expect(() => deriveHermesRuntimeProjectionBindings({ ...outcome, queueBinding: {
      ...outcome.queueBinding, reviewRecoveryStaleReacquisition: { ...marker, extra: true },
    } }, { requireVerified: true })).toThrow(expect.objectContaining({
      code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
    }))
    for (const queueBinding of [
      { ...legacyResumeOnly, reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED" },
      { ...legacyResumeOnly, reviewRecoveryResumeState: "UNKNOWN_RECOVERY_STATE" },
      { ...outcome.queueBinding, expectedVersion: 5, fencingToken: 3,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
        reviewRecoveryStaleReacquisition: undefined },
      { ...outcome.queueBinding, expectedVersion: 6, fencingToken: 4,
        reviewRecoveryReclaimEventId: undefined, reviewRecoveryStaleReacquisition: undefined },
      { ...outcome.queueBinding, expectedVersion: 6, fencingToken: 4,
        reviewRecoveryReclaimPayloadDigest: undefined, reviewRecoveryStaleReacquisition: undefined },
      { ...outcome.queueBinding, reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED" },
      { ...outcome.queueBinding, expectedVersion: 8 },
      { ...outcome.queueBinding, reviewRecoveryStaleReacquisition: undefined },
      { ...outcome.queueBinding, expectedVersion: 6, fencingToken: 4,
        reviewRecoveryStaleReacquisition: { ...marker, expectedVersion: 6, fencingToken: 4,
          priorExpectedVersion: 5, priorFencingToken: 3, receiptLatestFencingToken: 4 } },
      { ...outcome.queueBinding, reviewRecoveryStaleReacquisition: {
        ...marker, priorFencingToken: 5, fencingToken: 6, receiptLatestFencingToken: 6,
      } },
      { ...outcome.queueBinding, expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleContinuation: undefined },
      { ...outcome.queueBinding, expectedVersion: 7, fencingToken: 5,
        reviewRecoveryStaleContinuation: continuation },
      { ...outcome.queueBinding, expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleContinuation: { ...continuation, priorLeaseExpiresAt: undefined } },
      { ...outcome.queueBinding, expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleContinuation: { ...continuation, extra: true } },
    ]) for (const options of [{ requireVerified: true }, { requireVerified: false }]) {
      expect(() => deriveHermesRuntimeProjectionBindings({ ...outcome, queueBinding }, options))
        .toThrow(expect.objectContaining({ code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL" }))
    }
  })

  it("resolves the exact verified derived queue contract without static task inference", () => {
    const contract = {
      version: "hermes-work-contract.v1", id: "runtime-finding.101.v1",
      digest: "a".repeat(64), repository: "bsvalues/terragroq", lane: "docs",
      reservations: ["docs/reports/child.md"],
      validationCommands: [{ command: "git", args: ["diff", "--check"] }],
    }
    const resolver = vi.fn(() => null)
    expect(requireHermesWorkContract({
      outcomeKey: "runtime-finding:101:digest",
      queueBinding: { outcomeKey: "runtime-finding:101:digest", activeWorkOrderId: 201 },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "runtime_finding.derive", outcomeKey: "runtime-finding:101:digest", workOrderId: 201,
          workOrderRef: "WO-HERMES-OUTCOME-4-R01-F101",
        },
      },
    }, resolver)).toBe(contract)
    expect(resolver).not.toHaveBeenCalled()
    expect(() => requireHermesWorkContract({
      outcomeKey: "runtime-finding:101:digest",
      queueBinding: { outcomeKey: "runtime-finding:101:digest", activeWorkOrderId: 201 },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "runtime_finding.derive", outcomeKey: "runtime-finding:101:digest", workOrderId: 201,
        },
      },
    }, resolver)).toThrow(expect.objectContaining({ code: "HERMES_WORK_CONTRACT_WALL" }))
  })

  it("accepts the exact verified Workbench parent contract provenance", () => {
    const command = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command, title: command, objective: command,
      lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
    })!
    const resolver = vi.fn(() => null)
    expect(requireHermesWorkContract({
      id: 7, command, outcomeKey: "goal:GOAL-0007",
      queueBinding: { outcomeKey: "goal:GOAL-0007" },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-0007",
          workOrderRef: "WO-HERMES-OUTCOME-7",
        },
      },
    }, resolver)).toBe(contract)
    expect(resolver).not.toHaveBeenCalled()
    expect(() => requireHermesWorkContract({
      id: 7, command, outcomeKey: "goal:GOAL-0007",
      queueBinding: { outcomeKey: "goal:GOAL-0007" },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-OTHER",
          workOrderRef: "WO-HERMES-OUTCOME-7",
        },
      },
    }, resolver)).toThrow(expect.objectContaining({ code: "HERMES_WORK_CONTRACT_WALL" }))
  })

  it("accepts a Workbench-parent DERIVED contract only when an independent re-derivation matches (owner invariant 2026-08-21)", () => {
    const command = "Make the sign-in page speak to the owner with neutral copy"
    const goalFields = { command, title: command, objective: command, lane: "ui", risk: "low", authority: "A2_WRITE_OWN" }
    const contract = deriveHermesWorkContract(goalFields)!
    const resolver = vi.fn(() => null)
    // The verified contract equals what THIS process re-derives from the governed goal fields.
    expect(requireHermesWorkContract({
      id: 18, ...goalFields, outcomeKey: "goal:GOAL-0018",
      queueBinding: { outcomeKey: "goal:GOAL-0018" },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-0018",
          workOrderRef: "WO-HERMES-OUTCOME-18",
        },
      },
    }, resolver)).toBe(contract)
    // A tampered digest cannot pass: nothing is trusted from storage that does not re-derive.
    expect(() => requireHermesWorkContract({
      id: 18, ...goalFields, outcomeKey: "goal:GOAL-0018",
      queueBinding: { outcomeKey: "goal:GOAL-0018" },
      verifiedQueueWorkContract: {
        contract: { ...contract, digest: "f".repeat(64) },
        provenance: {
          operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-0018",
          workOrderRef: "WO-HERMES-OUTCOME-18",
        },
      },
    }, resolver)).toThrow(expect.objectContaining({ code: "HERMES_WORK_CONTRACT_WALL" }))
    // And a goal whose lane cannot derive (no policy) still walls even with a plausible-looking contract.
    expect(() => requireHermesWorkContract({
      id: 18, ...goalFields, lane: "read_model", outcomeKey: "goal:GOAL-0018",
      queueBinding: { outcomeKey: "goal:GOAL-0018" },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-0018",
          workOrderRef: "WO-HERMES-OUTCOME-18",
        },
      },
    }, resolver)).toThrow(expect.objectContaining({ code: "HERMES_WORK_CONTRACT_WALL" }))
  })

  it("keeps the exact verified Workbench parent Work Order identity through prompt and result", async () => {
    const command = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command, title: command, objective: command,
      lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
    })!
    const parent = {
      ...queueBoundOutcome(),
      id: 7, userId: "owner-id", ref: "GOAL-0007", command, title: command, objective: command,
      lane: "operator-objective", mode: "implement", risk: "R1", authority: "A2_WRITE_OWN",
      verdict: "requires_approval", requiresApproval: true, status: "classified",
      outcomeKey: "goal:GOAL-0007",
      queueBinding: { ...queueBoundOutcome().queueBinding, outcomeKey: "goal:GOAL-0007", activeWorkOrderId: 7 },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "workbench_execution.authorize",
          outcomeKey: "goal:GOAL-0007",
          workOrderRef: "WO-HERMES-OUTCOME-7",
        },
      },
    }
    const value = fixture(contract.reservations as string[], {
      selectOutcome: vi.fn(async () => parent),
    })
    value.client.runTurn.mockImplementationOnce(async ({ prompt }: { prompt: string }) => ({
      threadId: "thread-7", turnId: "turn-7", status: "completed",
      finalText: JSON.stringify({
        ...readyTurnResult,
        workOrder: "WO-HERMES-OUTCOME-7",
        branch: "codex/hermes-goal-0007-7",
      }),
    }))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })

    expect(value.projectCheckpoint.mock.calls[0][0].workContract).toEqual({
      version: "hermes-work-contract.v1",
      id: "issue-911-runtime-reliability-evidence.v1",
      digest: "fcd932412d48652f2762b218c7881a84ab1ffbac6795f4dccc90c8a8886334ba",
      repository: "bsvalues/terragroq",
      lane: "operator-objective",
      allowedFiles: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validators: [
        "git diff --check",
        "npx vitest run tests/hermes-work-contract.test.ts",
      ],
      projection: { issueNumber: 911, completionOwned: false },
      delivery: {
        authorityLevel: "A2_WRITE_OWN",
        allowedActions: ["implement"],
        commitAllowed: true,
        tagAllowed: false,
        pushAllowed: true,
      },
    })
    expect(value.client.runTurn).toHaveBeenCalledOnce()
    expect(value.client.runTurn.mock.calls[0][0].prompt).toContain("WO-HERMES-OUTCOME-7")
    expect(value.client.runTurn.mock.calls[0][0].prompt).not.toContain("WO-HERMES-7-001")
  })

  it("propagates the exact verified live-acceptance contract into the production turn prompt", async () => {
    const command = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command, title: command, objective: command,
      lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
      acceptedContractIds: ["issue-911-live-nonempty-acceptance.v1"],
    })!
    const parent = {
      ...queueBoundOutcome(), id: 29, userId: "owner-id", ref: "GOAL-0025",
      command, title: command, objective: command, lane: "operator-objective",
      mode: "implement", risk: "R1", authority: "A2_WRITE_OWN",
      verdict: "requires_approval", requiresApproval: true, status: "classified",
      acceptedContractIds: ["issue-911-live-nonempty-acceptance.v1"],
      outcomeKey: "goal:GOAL-0025",
      queueBinding: { ...queueBoundOutcome().queueBinding,
        outcomeKey: "goal:GOAL-0025", activeWorkOrderId: 29 },
      verifiedQueueWorkContract: {
        contract,
        provenance: { operation: "workbench_execution.authorize",
          outcomeKey: "goal:GOAL-0025", workOrderRef: "WO-HERMES-OUTCOME-29" },
      },
    }
    const value = fixture(contract.reservations as string[], {
      selectOutcome: vi.fn(async () => parent),
    })
    value.client.runTurn.mockImplementationOnce(async () => ({
      threadId: "thread-25", turnId: "turn-25", status: "completed",
      finalText: JSON.stringify({ ...readyTurnResult,
        workOrder: "WO-HERMES-OUTCOME-29", branch: "codex/hermes-goal-0025-29" }),
    }))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    const prompt = value.client.runTurn.mock.calls[0][0].prompt
    expect(prompt).toContain("ISSUE_911_LIVE_NONEMPTY_ACCEPTANCE")
    expect(prompt).toContain("Never fabricate either finding")
    expect(value.projectCheckpoint.mock.calls[0][0].workContract.acceptance)
      .toEqual(contract.acceptance)
  })

  it("does not reproject a released historical execution without a registered contract", async () => {
    const value = fixture(undefined, { workContractResolver: () => null })
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const lease = value.state.acquireLease({
      idempotencyKey: "historical-acquire", outcomeId: "77", holderId: "test-holder",
      leaseDurationMs: 1000, metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "historical-complete", outcomeId: "77", holderId: "test-holder",
      fencingToken: lease.fencingToken, expectedCheckpointSequence: 0,
      state: "COMPLETE", detail: "historical",
    })
    value.state.releaseLease({
      idempotencyKey: "historical-release", outcomeId: "77", holderId: "test-holder",
      fencingToken: lease.fencingToken,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "ALREADY_FINALIZED", outcomeId: "77",
    })
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
  })

  it("reacquires an expired queue-bound GOAL checkpoint before its first restart projection", async () => {
    const priorOutcome = queueBoundOutcome()
    const refreshedOutcome = {
      ...priorOutcome,
      queueBinding: {
        ...priorOutcome.queueBinding,
        expectedVersion: 4,
        fencingToken: 3,
      },
    }
    const refreshQueueOutcome = vi.fn(async () => refreshedOutcome)
    const value = fixture(undefined, { refreshQueueOutcome })
    const runTurn = value.client.runTurn.getMockImplementation()!
    value.client.runTurn.mockImplementation(async (input: any) => ({
      ...await runTurn(input),
      threadId: "thread-goal-0011",
    }))
    seedGoalStyleRetryableExecution(value, priorOutcome)
    value.advance(1_001)
    value.projectCheckpoint.mockImplementation(async () => {
      expect(refreshQueueOutcome).toHaveBeenCalledOnce()
      return { workOrderId: 77, status: "blocked" }
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })

    expect(refreshQueueOutcome).toHaveBeenCalledWith(priorOutcome)
    expect(refreshQueueOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(value.projectCheckpoint.mock.invocationCallOrder[0])
    expect(refreshQueueOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(value.lifecycle.ensureOwnedWorktree.mock.invocationCallOrder[0])
    expect(refreshQueueOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(value.client.connect.mock.invocationCallOrder[0])
    expect(value.client.resumeThread).toHaveBeenCalledWith("thread-goal-0011", expect.any(Object))
    expect((value.projectCheckpoint.mock.calls as any)[0][0]).toMatchObject({
      attempt: 2,
      checkpoint: {
        sequence: 4,
        state: "RETRYABLE_WALL",
        detail: "HERMES_CYCLE_FAILED",
      },
      executionBinding: {
        expectedVersion: 4,
        fencingToken: 3,
      },
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: 2,
      metadata: {
        threadId: "thread-goal-0011",
        outcome: { queueBinding: refreshedOutcome.queueBinding },
      },
    })
  })

  it("preserves fail-closed preprojection while a queue-bound local lease is fresh", async () => {
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, { refreshQueueOutcome })
    seedGoalStyleRetryableExecution(value, queueBoundOutcome(), 60_000)
    value.projectCheckpoint.mockRejectedValue(Object.assign(new Error("fresh projection wall"), {
      code: "FRESH_PROJECTION_WALL",
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_RUNTIME_PROJECTION_WALL",
      cause: { code: "FRESH_PROJECTION_WALL" },
    })

    expect(value.projectCheckpoint).toHaveBeenCalledOnce()
    expect(refreshQueueOutcome).not.toHaveBeenCalled()
    expect(value.lifecycle.ensureOwnedWorktree).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
  })

  it.each([undefined, " "])(
    "does not bypass preprojection for an expired binding with leaseHolder %p",
    async (leaseHolder) => {
      const outcome = queueBoundOutcome()
      if (leaseHolder === undefined) delete (outcome.queueBinding as any).leaseHolder
      else outcome.queueBinding.leaseHolder = leaseHolder
      const refreshQueueOutcome = vi.fn(async (selected) => selected)
      const value = fixture(undefined, { refreshQueueOutcome })
      seedGoalStyleRetryableExecution(value, outcome)
      value.advance(1_001)
      value.projectCheckpoint.mockRejectedValue(Object.assign(new Error("binding projection wall"), {
        code: "BINDING_PROJECTION_WALL",
      }))

      await expect(value.orchestrator.cycle()).rejects.toMatchObject({
        code: "HERMES_RUNTIME_PROJECTION_WALL",
        cause: { code: "BINDING_PROJECTION_WALL" },
      })

      expect(value.projectCheckpoint).toHaveBeenCalledOnce()
      expect(refreshQueueOutcome).not.toHaveBeenCalled()
      expect(value.lifecycle.ensureOwnedWorktree).not.toHaveBeenCalled()
      expect(value.client.connect).not.toHaveBeenCalled()
      expect(value.state.read().executions["77"].fencingToken).toBe(1)
    },
  )

  it.each([undefined, "not-a-time"])(
    "fails closed before effects when persisted local lease expiry is %p",
    async (expiresAt) => {
      const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
      const value = fixture(undefined, { refreshQueueOutcome })
      seedGoalStyleRetryableExecution(value)
      const statePath = path.join(value.root, "state", "state.json")
      const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
      if (expiresAt === undefined) delete persisted.executions["77"].lease.expiresAt
      else persisted.executions["77"].lease.expiresAt = expiresAt
      fs.writeFileSync(statePath, `${JSON.stringify(persisted)}\n`)

      await expect(value.orchestrator.cycle()).rejects.toBeTruthy()

      expect(refreshQueueOutcome).not.toHaveBeenCalled()
      expect(value.projectCheckpoint).not.toHaveBeenCalled()
      expect(value.projectLease).not.toHaveBeenCalled()
      expect(value.lifecycle.ensureOwnedWorktree).not.toHaveBeenCalled()
      expect(value.client.connect).not.toHaveBeenCalled()
    },
  )

  it("leaves expired durable state unchanged when canonical queue refresh walls", async () => {
    const refreshError = Object.assign(new Error("queue binding changed"), {
      code: "OUTCOME_QUEUE_BINDING_WALL",
    })
    const refreshQueueOutcome = vi.fn(async () => { throw refreshError })
    const value = fixture(undefined, { refreshQueueOutcome })
    seedGoalStyleRetryableExecution(value)
    value.advance(1_001)
    const before = value.state.read()

    await expect(value.orchestrator.cycle()).rejects.toBe(refreshError)

    expect(value.state.read()).toEqual(before)
    expect(value.projectCheckpoint).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.lifecycle.ensureOwnedWorktree).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
  })

  it("projects the reviewed contract before the first checkpoint and prompts with its exact validators", async () => {
    const value = fixture()

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })

    expect((value.projectCheckpoint.mock.calls as any)[0]?.[0]).toMatchObject({
      workContract: {
        id: "orchestrator-fixture",
        digest: "f".repeat(64),
        allowedFiles: [
          "components/hermes/live-status.tsx",
          "tests/hermes-live-status.test.tsx",
          "tests/deleted-hermes-status.test.tsx",
        ],
        validators: [
          "npx vitest run tests/outcome-execution-control-rendered.test.tsx",
          "npm run lint",
          "npm run build",
        ],
      },
      checkpoint: { metadata: {
        workContractId: "orchestrator-fixture",
        workContractDigest: "f".repeat(64),
      } },
    })
    const prompt = (value.client.runTurn.mock.calls as any)[0]?.[0].prompt
    expect(prompt).toContain("npx vitest run tests/outcome-execution-control-rendered.test.tsx")
    expect(prompt).not.toContain("npx vitest run focused changed tests")
  })

  it("retries only bounded transient projection transport failures", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("dns"), { code: "ENOTFOUND" }))
      .mockRejectedValueOnce(Object.assign(new Error("reset"), { code: "ECONNRESET" }))
      .mockResolvedValue({ projected: true })
    const sleep = vi.fn(async () => {})

    await expect(retryRuntimeProjection(operation, { sleep })).resolves.toEqual({ projected: true })
    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[1_000], [4_000]])
  })

  it("fails closed without retrying projection integrity or mixed aggregate errors", async () => {
    const integrity = Object.assign(new Error("cardinality"), {
      code: "OUTCOME_WORK_ORDER_CARDINALITY_WALL",
      cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }),
    })
    const mixed = new AggregateError([
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
      integrity,
    ])
    Object.assign(mixed, { code: "ETIMEDOUT" })
    expect(isRetryableProjectionTransportError(integrity)).toBe(false)
    expect(isRetryableProjectionTransportError(mixed)).toBe(false)

    const operation = vi.fn(async () => { throw integrity })
    const sleep = vi.fn(async () => {})
    await expect(retryRuntimeProjection(operation, { sleep })).rejects.toBe(integrity)
    expect(operation).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it("exhausts exactly three transient projection attempts without widening the retry budget", async () => {
    const transport = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })
    const operation = vi.fn(async () => { throw transport })
    const sleep = vi.fn(async () => {})

    await expect(retryRuntimeProjection(operation, { sleep })).rejects.toBe(transport)
    expect(operation).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls).toEqual([[1_000], [4_000]])
  })

  it("classifies temporary DNS lookup failures as retryable", () => {
    expect(isRetryableProjectionTransportError(
      Object.assign(new Error("temporary dns"), { code: "EAI_AGAIN" }),
    )).toBe(true)
  })

  it("retries only the exact message-only PostgreSQL connection timeout", async () => {
    const timeout = new Error("Connection terminated due to connection timeout")
    const unrelated = new Error("Connection terminated unexpectedly")
    expect(isRetryableProjectionTransportError(timeout)).toBe(true)
    expect(isRetryableProjectionTransportError(unrelated)).toBe(false)

    const operation = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValue({ projected: true })
    const sleep = vi.fn(async () => {})
    await expect(retryRuntimeProjection(operation, { sleep })).resolves.toEqual({ projected: true })
    expect(operation).toHaveBeenCalledTimes(2)
    expect(sleep.mock.calls).toEqual([[1_000]])
  })

  it("uses the bounded retry when projecting an orchestration checkpoint", async () => {
    const projectCheckpoint = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("dns"), { code: "ENOTFOUND" }))
      .mockRejectedValueOnce(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))
      .mockResolvedValue({ workOrderId: 77 })
    const value = fixture(undefined, { projectCheckpoint })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(projectCheckpoint.mock.calls.length).toBeGreaterThan(2)
    expect(new Set(projectCheckpoint.mock.calls.slice(0, 3).map(([request]) => JSON.stringify(request))).size).toBe(1)
  })

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

  it("abandons and projects only the current cycle holder during orderly process exit", async () => {
    const value = fixture()
    const outcome = {
      id: 77, userId: "owner-id", command: "bounded work", lane: "ui", risk: "low",
      authority: "A2_WRITE_OWN", verdict: "requires_approval", requiresApproval: true,
    }
    value.state.acquireLease({
      idempotencyKey: "owned-exit-acquire",
      outcomeId: "77",
      holderId: "test-holder",
      leaseDurationMs: 60_000,
      metadata: { outcome },
    })

    await expect(value.orchestrator.abandonOwnedCycleLease()).resolves.toEqual({
      abandoned: true, outcomeId: "77",
    })
    expect(value.state.read().executions["77"].lease).toMatchObject({
      holderId: "test-holder",
      abandonReason: "HERMES_CYCLE_PROCESS_EXIT",
      abandonedAt: expect.any(String),
    })
    expect(value.projectLease).toHaveBeenLastCalledWith(expect.objectContaining({
      outcomeId: 77,
      lease: expect.objectContaining({ status: "ABANDONED" }),
    }))
    await expect(value.orchestrator.abandonOwnedCycleLease()).resolves.toEqual({ abandoned: false })

    const foreign = value.state.reclaimLease({
      idempotencyKey: "foreign-exit-reclaim",
      outcomeId: "77",
      expectedFencingToken: value.state.read().executions["77"].fencingToken,
      holderId: "foreign-holder",
      leaseDurationMs: 60_000,
    })
    await expect(value.orchestrator.abandonOwnedCycleLease()).resolves.toEqual({ abandoned: false })
    const foreignExecution = value.state.read().executions["77"]
    expect(foreignExecution).toMatchObject({
      fencingToken: foreign.fencingToken,
      lease: { holderId: "foreign-holder" },
    })
    expect(foreignExecution.lease.abandonedAt).toBeUndefined()
  })

  it.each([
    ["host validation", {
      state: "HOST_VALIDATION_STARTED",
      detail: "Recovered validation infrastructure",
      metadata: (sourceFence: number, validationFailure: string) => ({
        validationFailure,
        validationRemediationRound: 0,
        validationRecoveryPhase: "PENDING_HOST_VALIDATION",
        validationRecoveryFencingToken: sourceFence,
      }),
    }],
    ["validation remediation", {
      state: "VALIDATION_REMEDIATION_REQUIRED",
      detail: null,
      metadata: (_sourceFence: number, validationFailure: string) => ({
        validationFailure,
        validationRemediationRound: 1,
        validationRecoveryPhase: null,
        validationRecoveryFencingToken: null,
      }),
    }],
  ])("recovers only a dead local proof-bound %s holder while the supervisor is stopped", async (
    label,
    recoveryCheckpoint,
  ) => {
    const orphanHolder = `${os.hostname()}:99999:11111111-1111-4111-8111-111111111111`
    const isProcessAlive = vi.fn(() => false)
    const value = fixture(undefined, { isProcessAlive })
    const outcome = await value.selectOutcome()
    const validationFailure = "Error: spawn EPERM while starting host validation"
    const failed = value.state.acquireLease({
      idempotencyKey: "orphan-validation-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, validationFailure, validationRemediationRound: 3 },
    })
    value.state.checkpoint({
      idempotencyKey: "orphan-validation-terminal",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: failed.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "orphan-validation-release",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: failed.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: `77:recover-validation-infrastructure:${failed.fencingToken}`,
      outcomeId: "77",
      expectedFencingToken: failed.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })
    const orphaned = value.state.reclaimLease({
      idempotencyKey: "orphan-validation-reclaim",
      outcomeId: "77",
      expectedFencingToken: reopened.fencingToken,
      holderId: orphanHolder,
      leaseDurationMs: 60_000,
    })
    value.state.checkpoint({
      idempotencyKey: `orphan-validation-${label}`,
      outcomeId: "77",
      holderId: orphanHolder,
      fencingToken: orphaned.fencingToken,
      expectedCheckpointSequence: value.state.read().executions["77"].checkpoint.sequence,
      state: recoveryCheckpoint.state,
      detail: recoveryCheckpoint.detail,
      metadata: recoveryCheckpoint.metadata(failed.fencingToken, validationFailure),
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      checkpoint: { state: recoveryCheckpoint.state, detail: recoveryCheckpoint.detail },
      metadata: recoveryCheckpoint.metadata(failed.fencingToken, validationFailure),
    })
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")
    const supervisorPath = path.join(value.root, "state", "supervisor.json")
    fs.writeFileSync(supervisorPath, "{}\n")
    await expect(value.orchestrator.recoverOrphanedValidationCycleLease()).rejects.toMatchObject({
      code: "HERMES_ORPHAN_RECOVERY_SUPERVISOR_WALL",
    })
    fs.unlinkSync(supervisorPath)

    await expect(value.orchestrator.recoverOrphanedValidationCycleLease()).resolves.toEqual({
      result: "RECOVERED",
      outcomeId: "77",
      fencingToken: orphaned.fencingToken,
      replayed: false,
    })
    expect(isProcessAlive).toHaveBeenCalledWith(99999)
    expect(value.state.read().executions["77"].lease).toMatchObject({
      holderId: orphanHolder,
      abandonReason: "HERMES_CYCLE_PROCESS_EXIT",
      abandonedAt: expect.any(String),
    })
    expect(value.projectLease).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      lease: expect.objectContaining({ status: "ABANDONED" }),
    }))
    await expect(value.orchestrator.recoverOrphanedValidationCycleLease()).resolves.toEqual({
      result: "RECOVERED",
      outcomeId: "77",
      fencingToken: orphaned.fencingToken,
      replayed: true,
    })
    expect(value.projectLease).toHaveBeenCalledTimes(2)
    value.projectLease.mockImplementationOnce(async () => {
      const current = value.state.read().executions["77"]
      value.state.reclaimLease({
        idempotencyKey: "orphan-validation-concurrent-reclaim",
        outcomeId: "77",
        expectedFencingToken: current.fencingToken,
        holderId: `${os.hostname()}:99998:22222222-2222-4222-8222-222222222222`,
        leaseDurationMs: 60_000,
      })
      return { workOrderId: 77 }
    })
    await expect(value.orchestrator.recoverOrphanedValidationCycleLease()).rejects.toMatchObject({
      code: "HERMES_ORPHAN_RECOVERY_FENCE_WALL",
    })
  })

  it("refuses orphan recovery while the recorded local holder is alive", async () => {
    const orphanHolder = `${os.hostname()}:99999:11111111-1111-4111-8111-111111111111`
    const value = fixture(undefined, { isProcessAlive: vi.fn(() => true) })
    const outcome = await value.selectOutcome()
    const validationFailure = "Error: spawn EPERM while starting host validation"
    const failed = value.state.acquireLease({
      idempotencyKey: "live-validation-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, validationFailure, validationRemediationRound: 3 },
    })
    value.state.checkpoint({
      idempotencyKey: "live-validation-terminal",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: failed.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "live-validation-release",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: failed.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "live-validation-reopen",
      outcomeId: "77",
      expectedFencingToken: failed.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })
    value.state.reclaimLease({
      idempotencyKey: "live-validation-reclaim",
      outcomeId: "77",
      expectedFencingToken: reopened.fencingToken,
      holderId: orphanHolder,
      leaseDurationMs: 60_000,
    })
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")

    await expect(value.orchestrator.recoverOrphanedValidationCycleLease()).rejects.toMatchObject({
      code: "HERMES_ORPHAN_RECOVERY_HOLDER_WALL",
    })
    expect(value.state.read().executions["77"].lease.abandonedAt).toBeUndefined()
    expect(value.projectLease).not.toHaveBeenCalled()
  })

  it("refuses a later validation checkpoint without its exact recovery metadata", async () => {
    const orphanHolder = `${os.hostname()}:99999:11111111-1111-4111-8111-111111111111`
    const value = fixture(undefined, { isProcessAlive: vi.fn(() => false) })
    const outcome = await value.selectOutcome()
    const validationFailure = "Error: spawn EPERM while starting host validation"
    const failed = value.state.acquireLease({
      idempotencyKey: "malformed-later-validation-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, validationFailure, validationRemediationRound: 3 },
    })
    value.state.checkpoint({
      idempotencyKey: "malformed-later-validation-terminal",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: failed.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "malformed-later-validation-release",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: failed.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "malformed-later-validation-reopen",
      outcomeId: "77",
      expectedFencingToken: failed.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })
    const orphaned = value.state.reclaimLease({
      idempotencyKey: "malformed-later-validation-reclaim",
      outcomeId: "77",
      expectedFencingToken: reopened.fencingToken,
      holderId: orphanHolder,
      leaseDurationMs: 60_000,
    })
    value.state.checkpoint({
      idempotencyKey: "malformed-later-validation-checkpoint",
      outcomeId: "77",
      holderId: orphanHolder,
      fencingToken: orphaned.fencingToken,
      expectedCheckpointSequence: value.state.read().executions["77"].checkpoint.sequence,
      state: "VALIDATION_REMEDIATION_REQUIRED",
      detail: null,
      metadata: {
        validationFailure: "",
        validationRecoveryPhase: null,
        validationRecoveryFencingToken: null,
      },
    })
    fs.writeFileSync(path.join(value.root, "control", "activation"), "disabled\n")

    await expect(value.orchestrator.recoverOrphanedValidationCycleLease()).rejects.toMatchObject({
      code: "HERMES_ORPHAN_RECOVERY_CANDIDATE_WALL",
    })
    expect(value.projectLease).not.toHaveBeenCalled()
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

  it("reacquires a validation-infrastructure recovery without selecting a new outcome", async () => {
    const verifyValidationInfrastructureRecovery = vi.fn(async () => true)
    const resumeQueueAfterValidationRecovery = vi.fn(async (outcome) => outcome)
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, {
      verifyValidationInfrastructureRecovery,
      resumeQueueAfterValidationRecovery,
      refreshQueueOutcome,
    })
    value.lifecycle.inspectWorkingTreePaths
      .mockResolvedValueOnce(["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"])
      .mockResolvedValue([])
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const lease = value.state.acquireLease({
      idempotencyKey: "validation-infrastructure-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
        headRefOid: "c".repeat(40),
        validationFailure,
        validationRemediationRound: 3,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "validation-infrastructure-failed",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "validation-infrastructure-released",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "validation-infrastructure-recovered",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })
    const crashedRecovery = value.state.reclaimLease({
      idempotencyKey: "validation-infrastructure-crash-reclaim",
      outcomeId: "77",
      expectedFencingToken: reopened.fencingToken,
      holderId: "crashed-recovery-holder",
      leaseDurationMs: 1000,
    })
    const intent = value.state.checkpoint({
      idempotencyKey: "validation-infrastructure-crash-intent",
      outcomeId: "77",
      holderId: "crashed-recovery-holder",
      fencingToken: crashedRecovery.fencingToken,
      expectedCheckpointSequence: crashedRecovery.checkpointSequence,
      state: "WORKTREE_INTENT",
      detail: null,
    })
    value.state.checkpoint({
      idempotencyKey: "validation-infrastructure-crash-ready",
      outcomeId: "77",
      holderId: "crashed-recovery-holder",
      fencingToken: crashedRecovery.fencingToken,
      expectedCheckpointSequence: intent.checkpointSequence,
      state: "WORKTREE_READY",
      detail: null,
    })
    value.state.abandonLease({
      idempotencyKey: "validation-infrastructure-crash-abandon",
      outcomeId: "77",
      holderId: "crashed-recovery-holder",
      fencingToken: crashedRecovery.fencingToken,
      reason: "PROCESS_CRASH",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      checkpoint: { state: "WORKTREE_READY" },
      metadata: {
        headRefOid: null,
        validationRecoveryPhase: "PENDING_HOST_VALIDATION",
        validationRecoveryFencingToken: lease.fencingToken,
      },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
      prNumber: 500,
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(verifyValidationInfrastructureRecovery).toHaveBeenCalledWith({
      outcomeId: 77,
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      expectedFencingToken: lease.fencingToken,
    })
    expect(resumeQueueAfterValidationRecovery).toHaveBeenCalledWith(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: lease.fencingToken,
    })
    expect(resumeQueueAfterValidationRecovery.mock.invocationCallOrder[0])
      .toBeLessThan(refreshQueueOutcome.mock.invocationCallOrder[0])
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalled()
    expect(value.client.runTurn).not.toHaveBeenCalled()
    expect(value.projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      checkpoint: expect.objectContaining({
        metadata: expect.objectContaining({ headRefOid: null }),
      }),
    }))
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: { state: "COMPLETE" },
    })
  })

  it("reacquires proof-bound validation remediation after an orphan recovery projection wall", async () => {
    const resolveValidationInfrastructureRecovery = vi.fn(async () => ({
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 1,
    }))
    const resumeQueueAfterValidationRecovery = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, {
      resolveValidationInfrastructureRecovery,
      resumeQueueAfterValidationRecovery,
    })
    value.lifecycle.inspectWorkingTreePaths
      .mockResolvedValueOnce(["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"])
      .mockResolvedValue([])
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const lease = value.state.acquireLease({
      idempotencyKey: "validation-projection-wall-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
        validationFailure,
        validationRemediationRound: 3,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "validation-projection-wall-failed",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "validation-projection-wall-released",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "validation-projection-wall-recovered",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })
    const reclaimed = value.state.reclaimLease({
      idempotencyKey: "validation-projection-wall-reclaim",
      outcomeId: "77",
      expectedFencingToken: reopened.fencingToken,
      holderId: "projection-wall-holder",
      leaseDurationMs: 1000,
    })
    value.state.checkpoint({
      idempotencyKey: "validation-projection-wall-remediation-required",
      outcomeId: "77",
      holderId: "projection-wall-holder",
      fencingToken: reclaimed.fencingToken,
      expectedCheckpointSequence: value.state.read().executions["77"].checkpoint.sequence,
      state: "VALIDATION_REMEDIATION_REQUIRED",
      detail: null,
      metadata: {
        validationFailure,
        validationRemediationRound: 1,
        validationRecoveryPhase: null,
        validationRecoveryFencingToken: null,
      },
    })
    value.state.abandonLease({
      idempotencyKey: "validation-projection-wall-abandon",
      outcomeId: "77",
      holderId: "projection-wall-holder",
      fencingToken: reclaimed.fencingToken,
      reason: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE", abandonReason: "HERMES_RUNTIME_PROJECTION_WALL" },
      checkpoint: { state: "VALIDATION_REMEDIATION_REQUIRED" },
      metadata: {
        validationRecoveryPhase: null,
        validationRecoveryFencingToken: null,
      },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
      prNumber: 500,
    })
    expect(resolveValidationInfrastructureRecovery).toHaveBeenCalledWith({
      outcomeId: 77,
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      expectedFencingToken: null,
    })
    expect(resumeQueueAfterValidationRecovery).toHaveBeenCalledOnce()
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalled()
    expect(value.client.runTurn).toHaveBeenCalled()
  })

  it.each([
    ["missing", null],
    ["empty", ""],
  ])("refuses a proof-bound active recovery with a %s abandonment marker", async (_label, abandonedAt) => {
    const verifyValidationInfrastructureRecovery = vi.fn(async () => true)
    const value = fixture(undefined, { verifyValidationInfrastructureRecovery })
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const lease = value.state.acquireLease({
      idempotencyKey: "validation-unmarked-active-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, validationFailure, validationRemediationRound: 3 },
    })
    value.state.checkpoint({
      idempotencyKey: "validation-unmarked-active-failed",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "validation-unmarked-active-released",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "validation-unmarked-active-recovered",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })
    value.state.reclaimLease({
      idempotencyKey: "validation-unmarked-active-reclaim",
      outcomeId: "77",
      expectedFencingToken: reopened.fencingToken,
      holderId: "live-holder",
      leaseDurationMs: 1000,
    })
    if (abandonedAt !== null) {
      const statePath = path.join(value.root, "state", "state.json")
      const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
      persisted.executions["77"].lease.abandonedAt = abandonedAt
      persisted.executions["77"].lease.expiresAt = abandonedAt
      fs.writeFileSync(statePath, `${JSON.stringify(persisted)}\n`)
    }

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL",
    })
    expect(verifyValidationInfrastructureRecovery).not.toHaveBeenCalled()
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.client.runTurn).not.toHaveBeenCalled()
  })

  it("refuses a locally reopened validation recovery without persisted proof", async () => {
    const value = fixture(undefined, {
      verifyValidationInfrastructureRecovery: vi.fn(async () => false),
    })
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const lease = value.state.acquireLease({
      idempotencyKey: "unconfirmed-validation-acquire",
      outcomeId: "77",
      holderId: "failed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome, validationFailure, validationRemediationRound: 3 },
    })
    value.state.checkpoint({
      idempotencyKey: "unconfirmed-validation-failed",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "unconfirmed-validation-released",
      outcomeId: "77",
      holderId: "failed-holder",
      fencingToken: lease.fencingToken,
    })
    value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "unconfirmed-validation-reopened",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "e".repeat(64),
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL",
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ABANDONED" },
      checkpoint: { state: "VALIDATION_INFRASTRUCTURE_RECOVERED" },
    })
  })

  it.each([
    ["checkpoint detail", (execution: any) => { execution.checkpoint.detail = "OTHER_STATE" }],
    ["recovery reason", (execution: any) => { execution.lease.recoverReason = "OTHER_REASON" }],
    ["proof digest", (execution: any) => { execution.metadata.validationRecoveryProofDigest = "invalid" }],
  ])("fails closed for malformed validation recovery %s before queue selection", async (_label, corrupt) => {
    const verifyValidationInfrastructureRecovery = vi.fn(async () => true)
    const value = fixture(undefined, { verifyValidationInfrastructureRecovery })
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const lease = value.state.acquireLease({
      idempotencyKey: `malformed-validation-acquire-${_label}`,
      outcomeId: "77", holderId: "failed-holder", leaseDurationMs: 1000,
      metadata: { outcome, validationFailure, validationRemediationRound: 3 },
    })
    value.state.checkpoint({
      idempotencyKey: `malformed-validation-failed-${_label}`,
      outcomeId: "77", holderId: "failed-holder", fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0, state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: `malformed-validation-released-${_label}`,
      outcomeId: "77", holderId: "failed-holder", fencingToken: lease.fencingToken,
    })
    value.state.reopenValidationInfrastructureWall({
      idempotencyKey: `malformed-validation-reopened-${_label}`,
      outcomeId: "77", expectedFencingToken: lease.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "f".repeat(64),
    })
    const statePath = path.join(value.root, "state", "state.json")
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
    corrupt(persisted.executions["77"])
    fs.writeFileSync(statePath, `${JSON.stringify(persisted)}\n`)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_VALIDATION_RECOVERY_PROOF_WALL",
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(verifyValidationInfrastructureRecovery).not.toHaveBeenCalled()
    expect(value.client.runTurn).not.toHaveBeenCalled()
  })

  it("replays a durable validated Codex result after a crash without redispatch", async () => {
    const value = fixture()
    const outcome = await value.selectOutcome()
    const result = normalizeHermesTurnResult(readyTurnResult)
    const lease = value.state.acquireLease({
      idempotencyKey: "turn-replay-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
      },
    })
    value.state.checkpoint({
      idempotencyKey: "turn-replay-completed",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "CODEX_TURN_COMPLETED",
      detail: "completed",
      metadata: {
        threadId: "thread-77",
        turnId: "turn-77",
        turnResult: result,
        turnResultDigest: hermesTurnResultDigest(result),
      },
    })
    value.state.abandonLease({
      idempotencyKey: "turn-replay-crash",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "PROCESS_CRASH",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.client.runTurn).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"].metadata.turnResult).toBeNull()
  })

  it("reruns interrupted host validation deterministically before any Codex redispatch", async () => {
    const value = fixture()
    value.lifecycle.inspectWorkingTreePaths
      .mockResolvedValueOnce(["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"])
      .mockResolvedValue([])
    const outcome = await value.selectOutcome()
    const lease = value.state.acquireLease({
      idempotencyKey: "validation-replay-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
      },
    })
    value.state.checkpoint({
      idempotencyKey: "validation-replay-started",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "HOST_VALIDATION_STARTED",
    })
    value.state.abandonLease({
      idempotencyKey: "validation-replay-crash",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "PROCESS_CRASH",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalledOnce()
    expect(value.client.runTurn).not.toHaveBeenCalled()
  })

  it("terminalizes a failed recovered host validation at the final remediation round", async () => {
    const verifyValidationInfrastructureRecovery = vi.fn(async () => true)
    const value = fixture(undefined, { verifyValidationInfrastructureRecovery })
    const validationError = Object.assign(new Error("validation failed"), {
      code: "HERMES_VALIDATION_FAILED",
      validation: { command: "npm", args: ["test"], code: 1, output: "deterministic failure" },
    })
    value.lifecycle.runValidationCommands.mockRejectedValueOnce(validationError)
    const outcome = await value.selectOutcome()
    const lease = value.state.acquireLease({
      idempotencyKey: "validation-final-round-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
        validationRemediationRound: 3,
        validationRecoveryProofDigest: "d".repeat(64),
        validationRecoveryPhase: "PENDING_HOST_VALIDATION",
        validationRecoveryFencingToken: 1,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "validation-final-round-started",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "HOST_VALIDATION_STARTED",
      detail: "Recovered validation infrastructure",
    })
    value.state.abandonLease({
      idempotencyKey: "validation-final-round-crash",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "PROCESS_CRASH",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "FAILED_TERMINAL",
      outcomeId: "77",
      nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: {
        state: "FAILED_TERMINAL",
        detail: "VALIDATION_REMEDIATION_EXHAUSTED",
      },
      metadata: {
        validationRecoveryPhase: null,
        validationRecoveryFencingToken: null,
      },
    })
    expect(verifyValidationInfrastructureRecovery).toHaveBeenCalledWith({
      outcomeId: 77,
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      expectedFencingToken: 1,
    })
    expect(value.client.runTurn).not.toHaveBeenCalled()
    expect(value.lifecycle.inspectPullRequest).not.toHaveBeenCalled()
  })

  it("continues remediation after a failed recovered host validation below the final round", async () => {
    const value = fixture()
    const validationError = Object.assign(new Error("validation failed"), {
      code: "HERMES_VALIDATION_FAILED",
      validation: { command: "npm", args: ["test"], code: 1, output: "deterministic failure" },
    })
    value.lifecycle.runValidationCommands
      .mockRejectedValueOnce(validationError)
      .mockResolvedValueOnce([{ command: "npm", args: ["test"], code: 0 }])
    const outcome = await value.selectOutcome()
    const lease = value.state.acquireLease({
      idempotencyKey: "validation-lower-round-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
        validationRemediationRound: 2,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "validation-lower-round-started",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "HOST_VALIDATION_STARTED",
    })
    value.state.abandonLease({
      idempotencyKey: "validation-lower-round-crash",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "PROCESS_CRASH",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalledTimes(2)
    expect(value.client.runTurn).toHaveBeenCalledOnce()
    expect(value.client.runTurn.mock.calls[0][0].prompt).toContain("deterministic failure")
    expect(value.markTerminal).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
  })

  it.each([
    "PR_REVIEW_REQUESTED",
    "RETRYABLE_WALL",
    "PR_MERGED",
    "POST_MERGE_CLEANUP_RETRY",
  ])("continues %s under its exact existing Work Order binding", async (checkpointState) => {
    const base = fixture()
    const outcome = {
      ...(await base.selectOutcome()),
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
        activeWorkOrderId: 77,
      },
    }
    const refreshQueueOutcome = vi.fn(async () => outcome)
    const bindQueueWorkOrder = vi.fn(async (candidate, workOrderId) => {
      if (candidate.queueBinding.activeWorkOrderId !== workOrderId) {
        throw new Error("mismatched recovery binding")
      }
      return candidate
    })
    const value = fixture(undefined, { refreshQueueOutcome, bindQueueWorkOrder })
    const lease = value.state.acquireLease({
      idempotencyKey: `binding-${checkpointState}-acquire`,
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
      },
    })
    value.state.checkpoint({
      idempotencyKey: `binding-${checkpointState}-checkpoint`,
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: checkpointState,
      detail: "RECOVERABLE_WALL",
    })
    value.state.abandonLease({
      idempotencyKey: `binding-${checkpointState}-crash`,
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "PROCESS_CRASH",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(bindQueueWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        queueBinding: expect.objectContaining({ activeWorkOrderId: 77 }),
      }),
      77,
    )
  })

  it("settles a blocked provider checkpoint under its exact existing Work Order binding", async () => {
    const baseOutcome = await fixture().selectOutcome()
    const outcome = {
      ...baseOutcome,
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
        activeWorkOrderId: 77,
      },
    }
    const refreshQueueOutcome = vi.fn(async () => outcome)
    const bindQueueWorkOrder = vi.fn(async (candidate) => candidate)
    const value = fixture(undefined, { refreshQueueOutcome, bindQueueWorkOrder })
    const lease = value.state.acquireLease({
      idempotencyKey: "provider-binding-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome },
    })
    value.state.checkpoint({
      idempotencyKey: "provider-binding-checkpoint",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "PROVIDER_UNAVAILABLE",
      detail: "2026-07-21T01:15:00.000Z",
    })
    value.state.abandonLease({
      idempotencyKey: "provider-binding-crash",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "PROCESS_CRASH",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
    })
    expect(bindQueueWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        queueBinding: expect.objectContaining({ activeWorkOrderId: 77 }),
      }),
      77,
    )
    expect(value.client.runTurn).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"].lease.status).toBe("DEFERRED")
  })

  it("defers both queue and local leases for a recoverable GitHub continuity wall", async () => {
    const baseOutcome = await fixture().selectOutcome()
    const queuedOutcome = {
      ...baseOutcome,
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    }
    const boundOutcome = {
      ...queuedOutcome,
      queueBinding: { ...queuedOutcome.queueBinding, activeWorkOrderId: 77 },
    }
    const deferOutcome = vi.fn(async () => true)
    const value = fixture(undefined, {
      selectOutcome: vi.fn(async () => queuedOutcome),
      refreshQueueOutcome: vi.fn(async (outcome) => outcome),
      bindQueueWorkOrder: vi.fn(async () => boundOutcome),
      deferOutcome,
    })
    value.lifecycle.inspectWorkingTreePaths
      .mockResolvedValueOnce(["components/hermes/live-status.tsx", "tests/hermes-live-status.test.tsx"])
      .mockResolvedValue([])
    value.lifecycle.inspectPullRequest.mockRejectedValueOnce(Object.assign(
      new Error("GitHub response unavailable"),
      { code: "HERMES_REPOSITORY_GITHUB_WALL" },
    ))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
      reasonCode: "HERMES_REPOSITORY_GITHUB_WALL",
    })
    expect(deferOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      outcome: expect.objectContaining({
        queueBinding: expect.objectContaining({ activeWorkOrderId: 77 }),
      }),
    }))
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "DEFERRED" },
      checkpoint: { state: "DEFERRED_PROVIDER_UNAVAILABLE" },
    })
    const turnCount = value.client.runTurn.mock.calls.length
    value.advance(15 * 60 * 1000 + 1)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.client.runTurn).toHaveBeenCalledTimes(turnCount)
  })

  it("adopts a durable reviewed-merge recovery before queue selection after restart", async () => {
    const resumeQueueAfterReviewRecovery = vi.fn(async (outcome) => ({
      ...outcome,
      queueBinding: {
        ...outcome.queueBinding,
        expectedVersion: 6,
        fencingToken: 4,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
        reviewRecoveryReclaimEventId: 701,
        reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
      },
    }))
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const resolveActiveReviewRecoveryProvenance = vi.fn(async () => ({
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
    }))
    const verifyActiveReviewRecoveryContinuation = vi.fn(async () => true)
    const value = fixture(undefined, {
      resumeQueueAfterReviewRecovery,
      refreshQueueOutcome,
      resolveActiveReviewRecoveryProvenance,
      verifyActiveReviewRecoveryContinuation,
    })
    const outcome = await value.selectOutcome()
    const recoveryCommand = "record structured #911 reliability remediation without host mutation"
    Object.assign(outcome, { command: recoveryCommand, title: recoveryCommand,
      objective: recoveryCommand, lane: "operator-objective", risk: "R1",
      authority: "A2_WRITE_OWN", outcomeKey: "goal:GOAL-0077" })
    const recoveryContract = resolveHermesWorkContract({ command: recoveryCommand,
      title: recoveryCommand, objective: recoveryCommand, lane: "operator-objective",
      risk: "R1", authority: "A2_WRITE_OWN" })!
    outcome.verifiedQueueWorkContract = { contract: recoveryContract, provenance: {
      operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-0077",
      workOrderRef: "WO-HERMES-OUTCOME-77",
    } }
    outcome.queueBinding = {
      userId: "owner-id", outcomeKey: "goal:GOAL-0077", expectedVersion: 5,
      executionBinding: "execution-binding-77", acquisitionKey: "acquisition-key-77",
      leaseHolder: "resident-hermes", leaseToken: "lease-token-77", fencingToken: 3,
      activeWorkOrderId: 77,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
    }
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
    for (let fencingToken = lease.fencingToken; fencingToken < 6; fencingToken += 1) {
      const reclaimed = value.state.reclaimLease({
        idempotencyKey: `review-recovery-local-reclaim-${fencingToken + 1}`,
        outcomeId: "77",
        expectedFencingToken: fencingToken,
        holderId: "crashed-holder",
        leaseDurationMs: 1000,
      })
      value.state.abandonLease({
        idempotencyKey: `review-recovery-local-abandon-${fencingToken + 1}`,
        outcomeId: "77",
        holderId: "crashed-holder",
        fencingToken: reclaimed.fencingToken,
        reason: "TEST_CRASH_WINDOW",
      })
    }
    const statePath = path.join(value.root, "state", "state.json")
    const exactAbandonedState = JSON.parse(fs.readFileSync(statePath, "utf8"))
    for (const marker of [
      { abandonedAt: "", expiresAt: "" },
      { abandonedAt: "invalid", expiresAt: "invalid" },
      { abandonedAt: "2026-07-21T00:59:59.000Z", expiresAt: "2026-07-21T01:00:00.000Z" },
      { abandonedAt: "2026-07-21T02:00:00.000Z", expiresAt: "2026-07-21T02:00:00.000Z" },
    ]) {
      const malformed = structuredClone(exactAbandonedState)
      Object.assign(malformed.executions["77"].lease, marker)
      fs.writeFileSync(statePath, `${JSON.stringify(malformed, null, 2)}\n`)
      await expect(value.orchestrator.cycle()).rejects.toMatchObject({
        code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
      })
      expect(resolveActiveReviewRecoveryProvenance).not.toHaveBeenCalled()
      expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()
      expect(value.projectLease).not.toHaveBeenCalled()
    }
    fs.writeFileSync(statePath, `${JSON.stringify(exactAbandonedState, null, 2)}\n`)
    const legacyStaleState = structuredClone(exactAbandonedState)
    Object.assign(legacyStaleState.executions["77"].metadata.outcome.queueBinding, {
      expectedVersion: 7,
      fencingToken: 5,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
      reviewRecoveryReclaimEventId: 701,
      reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
    })
    fs.writeFileSync(statePath, `${JSON.stringify(legacyStaleState, null, 2)}\n`)
    resolveActiveReviewRecoveryProvenance.mockRejectedValueOnce(Object.assign(
      new Error("legacy stale resolver reached before strict projection"),
      { code: "LEGACY_STALE_RESOLVER_SENTINEL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "LEGACY_STALE_RESOLVER_SENTINEL",
    })
    expect(resolveActiveReviewRecoveryProvenance).toHaveBeenCalledWith(expect.objectContaining({
      executionBinding: expect.objectContaining({ expectedVersion: 7, fencingToken: 5 }),
      checkpointProof: expect.objectContaining({ sequence: expect.any(Number) }),
    }))
    fs.writeFileSync(statePath, `${JSON.stringify(legacyStaleState, null, 2)}\n`)
    resumeQueueAfterReviewRecovery.mockClear()
    resolveActiveReviewRecoveryProvenance.mockResolvedValueOnce({
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
      alreadyStaleReacquired: true,
      reviewRecoveryExpectedVersion: 8,
      reviewRecoveryFencingToken: 6,
      reviewRecoveryStaleReacquisition: {
        lifecycleReason: "STALE_LEASE_RECOVERED",
        disposition: "RECLAIMED",
        priorExpectedVersion: 6,
        priorFencingToken: 4,
        expectedVersion: 7,
        fencingToken: 5,
        receiptLatestFencingToken: 5,
        leaseExpiresAt: "2026-07-21T00:00:00.000Z",
        checkpointDigest: "e".repeat(64),
      },
      reviewRecoveryStaleContinuation: {
        disposition: "RECLAIMED",
        priorExpectedVersion: 7,
        priorFencingToken: 5,
        priorLeaseExpiresAt: "2026-07-21T00:00:00.000Z",
        expectedVersion: 8,
        fencingToken: 6,
        receiptLatestFencingToken: 6,
        leaseExpiresAt: "2026-07-21T03:00:00.000Z",
        lifecycleReason: "STALE_LEASE_RECOVERED",
        checkpointDigest: "f".repeat(64),
      },
    })
    const boundedAcquire = vi.fn(async () => ({
      outcome: {
        userId: "owner-id", outcomeKey: "goal:GOAL-0077", goalId: 77,
        lifecycleState: "active", lifecycleReason: "STALE_LEASE_RECOVERED",
        approvalState: "approved", authorityState: "matched",
        version: 8, fencingToken: 6, executionBinding: "execution-binding-77",
        acquisitionKey: "acquisition-key-77", leaseHolder: "resident-hermes",
        leaseToken: "lease-token-77", activeWorkOrderId: 77,
        leaseExpiresAt: "2026-07-21T03:00:00.000Z",
      },
      acquired: true, replayed: true, reclaimed: false, reason: null,
      reviewRecoveryContinuationDisposition: "REPLAY_WINNER",
      reviewRecoveryContinuationCheckpointDigest: "f".repeat(64),
      reviewRecoveryContinuationEvidence: {
        disposition: "REPLAY_WINNER", sourceExpectedVersion: 4, sourceFencingToken: 2,
        sourceRuntimeAttempt: 5, reclaimEventId: 701,
        reclaimPayloadDigest: "e".repeat(64), expectedVersion: 8, fencingToken: 6,
        checkpointDigest: "f".repeat(64),
      },
    }))
    const composedRuntime = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used", holderId: "resident-hermes",
      campaignWindowId: "campaign-v1-2", processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: vi.fn(async () => ({ state: "REVIEW_REMEDIATION_RECOVERED" })),
      now: () => new Date("2026-07-21T01:00:00.000Z"), acquire: boundedAcquire,
    })
    refreshQueueOutcome.mockImplementationOnce((candidate) => composedRuntime.refreshOutcome(candidate))
    verifyActiveReviewRecoveryContinuation.mockRejectedValueOnce(Object.assign(
      new Error("bounded stale continuation verified before local effects"),
      { code: "BOUNDED_STALE_CONTINUATION_VERIFIER_SENTINEL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "BOUNDED_STALE_CONTINUATION_VERIFIER_SENTINEL",
    })
    expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()
    expect(boundedAcquire).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkOrderId: 77,
      reviewRecoveryContinuationEnvelope: expect.objectContaining({
        mode: "REPLAY_ONLY",
        sourceExpectedVersion: 4,
        sourceFencingToken: 2,
        sourceRuntimeAttempt: 5,
        baseHop: expect.objectContaining({ expectedVersion: 7, fencingToken: 5 }),
      }),
    }))
    expect(verifyActiveReviewRecoveryContinuation).toHaveBeenCalledWith(expect.objectContaining({
      executionBinding: expect.objectContaining({
        expectedVersion: 8,
        fencingToken: 6,
        reviewRecoveryStaleContinuation: expect.objectContaining({
          priorExpectedVersion: 7,
          expectedVersion: 8,
        }),
      }),
    }))
    const durableBaseHop = {
      disposition: "RECLAIMED", expectedVersion: 7, fencingToken: 5,
      leaseExpiresAt: "2026-07-21T00:00:00.000Z", lifecycleReason: "STALE_LEASE_RECOVERED",
      priorExpectedVersion: 6, priorFencingToken: 4, receiptLatestFencingToken: 5,
      checkpointDigest: "e".repeat(64),
    }
    const durableContinuation = {
      disposition: "RECLAIMED", priorExpectedVersion: 7, priorFencingToken: 5,
      priorLeaseExpiresAt: durableBaseHop.leaseExpiresAt, expectedVersion: 8, fencingToken: 6,
      receiptLatestFencingToken: 6, leaseExpiresAt: "2026-07-21T03:00:00.000Z",
      lifecycleReason: "STALE_LEASE_RECOVERED",
      checkpointDigest: "f".repeat(64),
    }
    const resolvedForward = {
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
      alreadyStaleReacquired: true,
      reviewRecoveryExpectedVersion: 8,
      reviewRecoveryFencingToken: 6,
      reviewRecoveryStaleReacquisition: durableBaseHop,
      reviewRecoveryStaleContinuation: durableContinuation,
    }
    const cleanupRetryState = structuredClone(legacyStaleState)
    const cleanupRetryExecution = cleanupRetryState.executions["77"]
    cleanupRetryExecution.checkpoint = {
      sequence: 46,
      state: "POST_MERGE_CLEANUP_RETRY",
      detail: "HERMES_POST_MERGE_CLEANUP_WALL",
      recordedAt: "2026-07-21T00:30:00.000Z",
    }
    Object.assign(cleanupRetryExecution.lease, {
      status: "ACTIVE",
      acquiredAt: "2026-07-21T00:00:00.000Z",
      expiresAt: "2026-07-21T00:45:00.000Z",
      abandonedAt: "2026-07-21T00:45:00.000Z",
      abandonReason: "HERMES_RUNTIME_PROJECTION_WALL",
    })
    Object.assign(cleanupRetryExecution.metadata, {
      postMergeCleanupRetryCount: 1,
      postMergeCleanupCauseCode: null,
    })
    fs.writeFileSync(statePath, `${JSON.stringify(cleanupRetryState, null, 2)}\n`)
    resumeQueueAfterReviewRecovery.mockClear()
    refreshQueueOutcome.mockClear()
    resolveActiveReviewRecoveryProvenance.mockClear()
    verifyActiveReviewRecoveryContinuation.mockClear()
    boundedAcquire.mockClear()
    value.projectLease.mockClear()
    value.lifecycle.cleanupOwnedWorktree.mockClear()
    const cleanupRetryRevision = cleanupRetryState.revision
    resolveActiveReviewRecoveryProvenance.mockResolvedValueOnce(resolvedForward)
    refreshQueueOutcome.mockImplementationOnce((candidate) => composedRuntime.refreshOutcome(candidate))
    verifyActiveReviewRecoveryContinuation.mockRejectedValueOnce(Object.assign(
      new Error("seq46 recovery cleanup retry verified before effects"),
      { code: "SEQ46_CLEANUP_RETRY_VERIFIER_SENTINEL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "SEQ46_CLEANUP_RETRY_VERIFIER_SENTINEL",
    })
    expect(resolveActiveReviewRecoveryProvenance).toHaveBeenCalledWith(expect.objectContaining({
      executionBinding: expect.objectContaining({ expectedVersion: 7, fencingToken: 5 }),
      checkpointProof: expect.objectContaining({
        sequence: 46,
        state: "POST_MERGE_CLEANUP_RETRY",
        workOrderId: 77,
      }),
      proof: expect.objectContaining({
        proofDigest: "d".repeat(64), prNumber: 500,
        reviewedHeadSha: "c".repeat(40), mergeSha: "b".repeat(40),
      }),
    }))
    expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()
    expect(boundedAcquire).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkOrderId: 77,
      reviewRecoveryContinuationEnvelope: expect.objectContaining({
        mode: "REPLAY_ONLY", sourceExpectedVersion: 4,
        sourceFencingToken: 2, sourceRuntimeAttempt: 5,
      }),
    }))
    expect(resolveActiveReviewRecoveryProvenance.mock.invocationCallOrder[0])
      .toBeLessThan(refreshQueueOutcome.mock.invocationCallOrder[0])
    expect(refreshQueueOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(verifyActiveReviewRecoveryContinuation.mock.invocationCallOrder[0])
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
    expect(value.state.read().revision).toBe(cleanupRetryRevision)

    const markedCleanupRetryState = structuredClone(cleanupRetryState)
    markedCleanupRetryState.executions["77"].metadata.outcome.queueBinding
      .reviewRecoveryStaleReacquisition = durableBaseHop
    fs.writeFileSync(statePath, `${JSON.stringify(markedCleanupRetryState, null, 2)}\n`)
    resumeQueueAfterReviewRecovery.mockClear()
    refreshQueueOutcome.mockClear()
    resolveActiveReviewRecoveryProvenance.mockClear()
    verifyActiveReviewRecoveryContinuation.mockClear()
    boundedAcquire.mockClear()
    value.projectLease.mockClear()
    value.lifecycle.cleanupOwnedWorktree.mockClear()
    resolveActiveReviewRecoveryProvenance.mockResolvedValueOnce(resolvedForward)
    refreshQueueOutcome.mockImplementationOnce((candidate) => composedRuntime.refreshOutcome(candidate))
    verifyActiveReviewRecoveryContinuation.mockRejectedValueOnce(Object.assign(
      new Error("marked seq46 recovery cleanup retry verified before effects"),
      { code: "MARKED_SEQ46_CLEANUP_RETRY_VERIFIER_SENTINEL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "MARKED_SEQ46_CLEANUP_RETRY_VERIFIER_SENTINEL",
    })
    expect(resolveActiveReviewRecoveryProvenance).toHaveBeenCalledWith(expect.objectContaining({
      executionBinding: expect.objectContaining({
        expectedVersion: 7, fencingToken: 5,
        reviewRecoveryStaleReacquisition: durableBaseHop,
      }),
      checkpointProof: expect.objectContaining({ sequence: 46, workOrderId: 77 }),
    }))
    expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()
    expect(boundedAcquire).toHaveBeenCalledWith(expect.objectContaining({
      reviewRecoveryContinuationEnvelope: expect.objectContaining({ mode: "REPLAY_ONLY" }),
    }))
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
    expect(value.state.read().revision).toBe(cleanupRetryRevision)

    const closedContinuationCleanupRetryState = structuredClone(markedCleanupRetryState)
    Object.assign(
      closedContinuationCleanupRetryState.executions["77"].metadata.outcome.queueBinding,
      { expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleContinuation: durableContinuation },
    )
    fs.writeFileSync(statePath, `${JSON.stringify(closedContinuationCleanupRetryState, null, 2)}\n`)
    resumeQueueAfterReviewRecovery.mockClear()
    refreshQueueOutcome.mockClear()
    resolveActiveReviewRecoveryProvenance.mockClear()
    verifyActiveReviewRecoveryContinuation.mockClear()
    boundedAcquire.mockClear()
    value.projectLease.mockClear()
    value.lifecycle.cleanupOwnedWorktree.mockClear()
    resolveActiveReviewRecoveryProvenance.mockResolvedValueOnce(resolvedForward)
    refreshQueueOutcome.mockImplementationOnce((candidate) => composedRuntime.refreshOutcome(candidate))
    verifyActiveReviewRecoveryContinuation.mockRejectedValueOnce(Object.assign(
      new Error("closed seq46 continuation verified before effects"),
      { code: "CLOSED_SEQ46_CONTINUATION_VERIFIER_SENTINEL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "CLOSED_SEQ46_CONTINUATION_VERIFIER_SENTINEL",
    })
    expect(resolveActiveReviewRecoveryProvenance).toHaveBeenCalledWith(expect.objectContaining({
      executionBinding: expect.objectContaining({
        expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleReacquisition: durableBaseHop,
        reviewRecoveryStaleContinuation: durableContinuation,
      }),
      checkpointProof: expect.objectContaining({ sequence: 46, fencingToken: 6 }),
    }))
    expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()
    expect(boundedAcquire).toHaveBeenCalledWith(expect.objectContaining({
      reviewRecoveryContinuationEnvelope: expect.objectContaining({
        mode: "REPLAY_ONLY",
        baseHop: expect.objectContaining({ expectedVersion: 7, fencingToken: 5 }),
        continuation: expect.objectContaining({ expectedVersion: 8, fencingToken: 6 }),
      }),
    }))
    expect(boundedAcquire).not.toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 9, fencingToken: 7,
    }))
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
    expect(value.state.read().revision).toBe(cleanupRetryRevision)

    const malformedMarkedCleanupRetryState = structuredClone(cleanupRetryState)
    malformedMarkedCleanupRetryState.executions["77"].metadata.outcome.queueBinding
      .reviewRecoveryStaleReacquisition = {}
    fs.writeFileSync(statePath, `${JSON.stringify(malformedMarkedCleanupRetryState, null, 2)}\n`)
    resolveActiveReviewRecoveryProvenance.mockClear()
    refreshQueueOutcome.mockClear()
    value.projectLease.mockClear()
    value.lifecycle.cleanupOwnedWorktree.mockClear()
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
    })
    expect(resolveActiveReviewRecoveryProvenance).not.toHaveBeenCalled()
    expect(refreshQueueOutcome).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
    expect(value.state.read().revision).toBe(cleanupRetryRevision)

    for (const [name, expectedFence, queuePatch] of [
      ["base-marked", 5, { reviewRecoveryStaleReacquisition: durableBaseHop }],
      ["closed-continuation", 6, { expectedVersion: 8, fencingToken: 6,
        reviewRecoveryStaleReacquisition: durableBaseHop,
        reviewRecoveryStaleContinuation: durableContinuation }],
    ] as const) {
      const persisted = structuredClone(legacyStaleState)
      Object.assign(persisted.executions["77"].metadata.outcome.queueBinding, queuePatch)
      fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`)
      resumeQueueAfterReviewRecovery.mockClear()
      resolveActiveReviewRecoveryProvenance.mockImplementationOnce(async (input) => {
        if (input.executionBinding.activeWorkOrderId !== 77
          || input.checkpointProof.workOrderId !== input.executionBinding.activeWorkOrderId) {
          throw Object.assign(new Error("composed Work Order identity conflicts"), {
            code: "COMPOSED_WORK_ORDER_IDENTITY_WALL",
          })
        }
        return resolvedForward
      })
      refreshQueueOutcome.mockImplementationOnce((candidate) => composedRuntime.refreshOutcome(candidate))
      verifyActiveReviewRecoveryContinuation.mockRejectedValueOnce(Object.assign(
        new Error(`${name} replay-only verification reached`),
        { code: `PERSISTED_${name.toUpperCase().replaceAll("-", "_")}_SENTINEL` },
      ))
      await expect(value.orchestrator.cycle()).rejects.toMatchObject({
        code: `PERSISTED_${name.toUpperCase().replaceAll("-", "_")}_SENTINEL`,
      })
      expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()
      expect(resolveActiveReviewRecoveryProvenance).toHaveBeenLastCalledWith(
        expect.objectContaining({
          executionBinding: expect.objectContaining({ activeWorkOrderId: 77 }),
          checkpointProof: expect.objectContaining({ fencingToken: expectedFence, workOrderId: 77 }),
        }),
      )
      expect(boundedAcquire).toHaveBeenLastCalledWith(expect.objectContaining({
        activeWorkOrderId: 77,
        reviewRecoveryContinuationEnvelope: expect.objectContaining({ mode: "REPLAY_ONLY" }),
      }))
    }
    refreshQueueOutcome.mockClear()
    fs.writeFileSync(statePath, `${JSON.stringify(exactAbandonedState, null, 2)}\n`)
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

    resolveActiveReviewRecoveryProvenance.mockRejectedValueOnce(Object.assign(
      new Error("active recovery authorization drifted"),
      { code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: 6,
      lease: { status: "ACTIVE", abandonedAt: expect.any(String) },
      checkpoint: {
        state: "REVIEW_REMEDIATION_RECOVERED",
        detail: "REVIEW_REMEDIATION_EXHAUSTED",
      },
    })
    expect(value.lifecycle.runValidationCommands).not.toHaveBeenCalled()
    expect(value.lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()
    expect(value.client.runTurn).not.toHaveBeenCalled()
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(resumeQueueAfterReviewRecovery).not.toHaveBeenCalled()

    verifyActiveReviewRecoveryContinuation.mockRejectedValueOnce(Object.assign(
      new Error("continued recovery chain drifted"),
      { code: "ACTIVE_REVIEW_CONTINUATION_SENTINEL" },
    ))
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "ACTIVE_REVIEW_CONTINUATION_SENTINEL",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: 6,
      lease: { status: "ACTIVE", abandonedAt: expect.any(String) },
      checkpoint: { state: "REVIEW_REMEDIATION_RECOVERED" },
    })
    expect(value.projectLease).not.toHaveBeenCalled()
    expect(value.lifecycle.cleanupOwnedWorktree).not.toHaveBeenCalled()

    value.projectCheckpoint.mockClear()
    value.lifecycle.inspectWorkingTreePaths.mockResolvedValue([
      "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
    ])
    value.lifecycle.inspectPullRequestFiles.mockResolvedValue([
      "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
    ])
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77", prNumber: 500,
    })
    expect(value.projectCheckpoint.mock.calls.some(([request]) => (
      request.checkpoint.state === "REVIEW_REMEDIATION_RECOVERED"
    ))).toBe(false)
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(resumeQueueAfterReviewRecovery).toHaveBeenCalledWith(expect.objectContaining({
      queueBinding: expect.objectContaining({
        reviewRecoverySourceExpectedVersion: 4,
        reviewRecoverySourceFencingToken: 2,
        reviewRecoverySourceRuntimeAttempt: 5,
      }),
    }), {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      prNumber: 500,
      reviewedHeadSha: "c".repeat(40),
      mergeSha: "b".repeat(40),
      runtimeAttempt: 5,
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
    })
    expect(resumeQueueAfterReviewRecovery.mock.invocationCallOrder[0])
      .toBeLessThan(refreshQueueOutcome.mock.invocationCallOrder[0])
    expect(refreshQueueOutcome).toHaveBeenCalledWith(expect.objectContaining({
      queueBinding: expect.objectContaining({
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
        reviewRecoveryReclaimEventId: 701,
        reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
      }),
    }))
    expect(resolveActiveReviewRecoveryProvenance.mock.invocationCallOrder.at(-1))
      .toBeLessThan(resumeQueueAfterReviewRecovery.mock.invocationCallOrder.at(-1))
    expect(refreshQueueOutcome.mock.invocationCallOrder.at(-1))
      .toBeLessThan(verifyActiveReviewRecoveryContinuation.mock.invocationCallOrder.at(-1))
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: 7,
      lease: { status: "RELEASED" },
      checkpoint: { state: "COMPLETE" },
    })
    const releasedRecoveryState = value.state.read()
    releasedRecoveryState.executions["77"].metadata.postMergeCleanupRetryCount = 1
    releasedRecoveryState.executions["77"].metadata.postMergeCleanupCauseCode = null
    fs.writeFileSync(statePath, `${JSON.stringify(releasedRecoveryState, null, 2)}\n`)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "ALREADY_FINALIZED", outcomeId: "77",
    })
  })

  it("adopts a durable terminal cleanup recovery before queue selection after restart", async () => {
    const resolveActiveReviewRecoveryProvenance = vi.fn(async () => null)
    const refreshQueueOutcome = vi.fn(async (selected) => selected)
    const value = fixture(undefined, {
      resolveActiveReviewRecoveryProvenance,
      refreshQueueOutcome,
    })
    const outcome = await value.selectOutcome()
    outcome.queueBinding = {
      userId: "owner-id", outcomeKey: "goal:GOAL-0077", expectedVersion: 6,
      executionBinding: "execution-binding-77", acquisitionKey: "acquisition-key-77",
      leaseHolder: "resident-hermes", leaseToken: "lease-token-77", fencingToken: 4,
      activeWorkOrderId: 77,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      reviewRecoverySourceExpectedVersion: 4,
      reviewRecoverySourceFencingToken: 2,
      reviewRecoverySourceRuntimeAttempt: 5,
      reviewRecoveryReclaimEventId: 961,
      reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
    }
    value.selectOutcome.mockClear()
    value.state.initialize()
    const branch = "codex/hermes-goal-77-77"
    const worktreePath = path.join(value.root, "worktrees", "hermes-goal-77-77")
    const lease = value.state.acquireLease({
      idempotencyKey: "cleanup-recovery-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch,
        worktreePath,
        baseSha: "a".repeat(40),
        headRefOid: "c".repeat(40),
        mergeSha: "b".repeat(40),
        prNumber: 500,
        postMergeCleanupRetryCount: 3,
        reviewRecoveryProofDigest: "d".repeat(64),
      },
    })
    value.state.checkpoint({
      idempotencyKey: "cleanup-recovery-terminal",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED",
    })
    value.state.releaseLease({
      idempotencyKey: "cleanup-recovery-release",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
    })
    const pending = value.state.beginTerminalPostMergeCleanupRecovery({
      idempotencyKey: "cleanup-recovery-begin",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      expectedCheckpointSequence: 1,
      activationDisabled: true,
      prNumber: 500,
      branch,
      worktreePath,
      headRefOid: "c".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "d".repeat(64),
    })
    value.state.finalizeTerminalPostMergeCleanupRecovery({
      idempotencyKey: "cleanup-recovery-finalize",
      outcomeId: "77",
      expectedFencingToken: lease.fencingToken,
      expectedCheckpointSequence: pending.checkpointSequence,
      activationDisabled: true,
      prNumber: 500,
      branch,
      worktreePath,
      headRefOid: "c".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "d".repeat(64),
    })
    const retainedRecoveredState = value.state.read()
    retainedRecoveredState.executions["77"].metadata.postMergeCleanupRetryCount = 0
    retainedRecoveredState.executions["77"].metadata.postMergeCleanupCauseCode =
      "HERMES_REPOSITORY_COMMAND_FAILED"
    retainedRecoveredState.executions["77"].metadata.reviewRecoveryProofDigest = "d".repeat(64)
    fs.writeFileSync(path.join(value.root, "state", "state.json"),
      `${JSON.stringify(retainedRecoveredState, null, 2)}\n`)
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
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(resolveActiveReviewRecoveryProvenance).not.toHaveBeenCalled()
    expect(value.projectCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      attempt: lease.fencingToken + 1,
      executionBinding: expect.objectContaining({
        expectedVersion: 6,
        fencingToken: 4,
        reviewRecoverySourceExpectedVersion: 4,
        reviewRecoverySourceFencingToken: 2,
        reviewRecoverySourceRuntimeAttempt: 5,
      }),
      workContract: {
        version: "test.v1",
        id: "orchestrator-fixture",
        digest: "f".repeat(64),
        repository: "bsvalues/terragroq",
        lane: "test",
        allowedFiles: [
          "components/hermes/live-status.tsx",
          "tests/hermes-live-status.test.tsx",
          "tests/deleted-hermes-status.test.tsx",
        ],
        validators: [
          "npx vitest run tests/outcome-execution-control-rendered.test.tsx",
          "npm run lint",
          "npm run build",
        ],
      },
      checkpoint: expect.objectContaining({
        sequence: 3,
        state: "POST_MERGE_CLEANUP_RECOVERED",
        detail: "PR #500",
        metadata: expect.objectContaining({
          prNumber: 500,
          headRefOid: "c".repeat(40),
          mergeSha: "b".repeat(40),
          terminalCleanupRecoveryProofDigest: "d".repeat(64),
          workContractId: "orchestrator-fixture",
          workContractDigest: "f".repeat(64),
        }),
      }),
    }))
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

  it("reclaims the stale null-Work-Order crash window and binds the existing Work Order before AEGIS", async () => {
    const seed = fixture()
    const priorOutcome = {
      ...(await seed.selectOutcome()),
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "goal:GOAL-0025",
        expectedVersion: 2,
        executionBinding: "execution-22",
        acquisitionKey: "acquisition-22",
        leaseHolder: "resident-hermes",
        leaseToken: "lease-22",
        fencingToken: 1,
      },
    }
    const reclaimedOutcome = {
      ...priorOutcome,
      queueBinding: {
        ...priorOutcome.queueBinding,
        expectedVersion: 3,
        fencingToken: 2,
        lifecycleReason: "STALE_LEASE_RECOVERED",
      },
    }
    const refreshQueueOutcome = vi.fn(async () => reclaimedOutcome)
    const bindQueueWorkOrder = vi.fn(async (candidate, workOrderId) => ({
      ...candidate,
      queueBinding: { ...candidate.queueBinding, activeWorkOrderId: workOrderId },
    }))
    const projectCheckpoint = vi.fn(async () => ({ workOrderId: 54, status: "active" }))
    const value = fixture(undefined, {
      refreshQueueOutcome,
      bindQueueWorkOrder,
      projectCheckpoint,
    })
    value.selectOutcome.mockClear()
    value.state.initialize()
    const lease = value.state.acquireLease({
      idempotencyKey: "acceptance-crash-window-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: priorOutcome },
    })
    value.state.abandonLease({
      idempotencyKey: "acceptance-crash-window-abandon",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      reason: "42601",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(value.selectOutcome).not.toHaveBeenCalled()
    expect(refreshQueueOutcome).toHaveBeenCalledOnce()
    expect(refreshQueueOutcome).toHaveBeenCalledWith(priorOutcome)
    expect(bindQueueWorkOrder).toHaveBeenCalledOnce()
    expect(bindQueueWorkOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        queueBinding: expect.objectContaining({
          expectedVersion: 3,
          fencingToken: 2,
        }),
      }),
      54,
      "active",
    )
    expect(Object.hasOwn(bindQueueWorkOrder.mock.calls[0][0].queueBinding, "activeWorkOrderId")).toBe(false)
    expect(refreshQueueOutcome.mock.invocationCallOrder[0])
      .toBeLessThan(bindQueueWorkOrder.mock.invocationCallOrder[0])
    expect(bindQueueWorkOrder.mock.invocationCallOrder[0])
      .toBeLessThan(value.client.connect.mock.invocationCallOrder[0])
    expect(projectCheckpoint).toHaveBeenCalled()
    expect(value.state.read().executions["77"]).toMatchObject({
      fencingToken: lease.fencingToken + 1,
      lease: { status: "RELEASED" },
      checkpoint: { state: "COMPLETE" },
      metadata: { outcome: { queueBinding: { activeWorkOrderId: 54 } } },
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
      blockedAction: null, authorityBoundary: null, minimumChoice: null,
      approveConsequence: null, denyConsequence: null,
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

  it("renews a queue-bound outcome alongside the resident Hermes lease", async () => {
    const renewQueueLease = vi.fn(async () => ({ leaseExpiresAt: "2026-07-21T01:50:00.000Z" }))
    const queuedOutcome = {
      id: 77,
      userId: "owner-id",
      ref: "GOAL-0077",
      command: "Improve the Hermes page with bounded live bridge status.",
      lane: "ui",
      mode: "implement",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "requires_approval",
      requiresApproval: true,
      status: "classified",
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 2,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 1,
        acquisitionKey: "acquisition-77",
      },
    }
    const value = fixture(undefined, {
      leaseRenewalIntervalMs: 5,
      renewQueueLease,
      selectOutcome: vi.fn(async () => queuedOutcome),
    })
    value.client.runTurn.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return {
        threadId: "thread-77",
        turnId: "turn-77",
        status: "completed",
        finalText: JSON.stringify({
          result: "READY_FOR_VALIDATION",
          workOrder: "WO-HERMES-77-001",
          branch: "codex/hermes-goal-0077-77",
          commit: null,
          prUrl: null,
          merged: false,
          mergeCommit: null,
          validation: ["pass"],
          reviewThreads: 0,
          ownerTouchCount: 0,
          blockedScopeCrossed: false,
          nextState: "READY_FOR_HERMES_MERGE",
          blockedAction: null, authorityBoundary: null, minimumChoice: null,
          approveConsequence: null, denyConsequence: null,
        }),
      }
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(renewQueueLease).toHaveBeenCalledWith(queuedOutcome)
  })

  it("preserves a queue lease when the runtime projection has no Work Order id", async () => {
    const queuedOutcome = {
      id: 77,
      userId: "owner-id",
      ref: "GOAL-0077",
      command: "Improve the Hermes page with bounded live bridge status.",
      lane: "ui",
      mode: "implement",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "requires_approval",
      requiresApproval: true,
      status: "classified",
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 2,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 1,
        acquisitionKey: "acquisition-77",
      },
    }
    const bindQueueWorkOrder = vi.fn(async () => true)
    const value = fixture(undefined, {
      selectOutcome: vi.fn(async () => queuedOutcome),
      bindQueueWorkOrder,
      projectCheckpoint: vi.fn(async () => ({})),
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
  })

  it("replays queue settlement from a persisted COMPLETE checkpoint after a crash", async () => {
    const queuedOutcome = {
      id: 77,
      userId: "owner-id",
      ref: "GOAL-0077",
      command: "Improve the Hermes page with bounded live bridge status.",
      lane: "ui",
      mode: "implement",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "requires_approval",
      requiresApproval: true,
      status: "classified",
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 2,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 1,
        acquisitionKey: "acquisition-77",
      },
    }
    const refreshedOutcome = {
      ...queuedOutcome,
      queueBinding: {
        ...queuedOutcome.queueBinding,
        expectedVersion: 3,
        fencingToken: 2,
      },
    }
    const refreshQueueOutcome = vi.fn(async () => refreshedOutcome)
    const bindQueueWorkOrder = vi.fn(async () => {
      throw new Error("terminal replay must not bind an active Work Order")
    })
    const value = fixture(undefined, { refreshQueueOutcome, bindQueueWorkOrder })
    const lease = value.state.acquireLease({
      idempotencyKey: "77:acquire:split-settlement",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: queuedOutcome },
    })
    value.state.checkpoint({
      idempotencyKey: "77:checkpoint:complete",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "COMPLETE",
      detail: "PR #500 merged and verified",
      metadata: {
        prNumber: 500,
        branch: "codex/hermes-goal-77-77",
        mergeSha: "b".repeat(40),
        runtimeEvidenceRef: `EV-HERMES-77-${lease.fencingToken}-1`,
      },
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
      recovered: true,
    })
    expect(value.markComplete).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      outcome: refreshedOutcome,
      evidence: expect.objectContaining({
        runtimeEvidenceRef: `EV-HERMES-77-${lease.fencingToken}-1`,
      }),
    }))
    expect(refreshQueueOutcome).toHaveBeenCalledWith(queuedOutcome, {
      state: "COMPLETE",
      evidence: {
        prNumber: 500,
        mergeSha: "b".repeat(40),
        runtimeEvidenceRef: `EV-HERMES-77-${lease.fencingToken}-1`,
      },
    })
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
    expect(value.client.connect).not.toHaveBeenCalled()
  })

  it("replays a persisted terminal failure without rebinding its closed Work Order", async () => {
    const queuedOutcome = {
      id: 77,
      userId: "owner-id",
      ref: "GOAL-0077",
      command: "Improve the Hermes page with bounded live bridge status.",
      lane: "ui",
      mode: "implement",
      risk: "low",
      authority: "A2_WRITE_OWN",
      verdict: "requires_approval",
      requiresApproval: true,
      status: "classified",
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 2,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 1,
        acquisitionKey: "acquisition-77",
      },
    }
    const refreshQueueOutcome = vi.fn(async () => queuedOutcome)
    const bindQueueWorkOrder = vi.fn(async () => {
      throw new Error("terminal replay must not bind an active Work Order")
    })
    const value = fixture(undefined, { refreshQueueOutcome, bindQueueWorkOrder })
    const lease = value.state.acquireLease({
      idempotencyKey: "77:acquire:terminal-split",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: queuedOutcome },
    })
    value.state.checkpoint({
      idempotencyKey: "77:checkpoint:terminal-split",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: lease.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toEqual({
      result: "FAILED_TERMINAL",
      outcomeId: "77",
      nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(refreshQueueOutcome).toHaveBeenCalledWith(queuedOutcome, {
      state: "FAILED_TERMINAL",
      nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    expect(value.markTerminal).toHaveBeenCalledWith(expect.objectContaining({
      outcomeId: 77,
      outcome: queuedOutcome,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    }))
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
    expect(value.client.connect).not.toHaveBeenCalled()
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
          blockedAction: null, authorityBoundary: null, minimumChoice: null,
          approveConsequence: null, denyConsequence: null,
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
      metadata: {
        prNumber: 500,
        mergeSha: "b".repeat(40),
        postMergeCleanupRetryCount: 1,
        postMergeCleanupCauseCode: "HERMES_REPOSITORY_COMMAND_FAILED",
      },
    })
    const firstFence = value.state.read().executions["77"].fencingToken
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_POST_MERGE_CLEANUP_WALL" })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "ACTIVE", abandonReason: "HERMES_POST_MERGE_CLEANUP_WALL" },
      checkpoint: { state: "POST_MERGE_CLEANUP_RETRY", detail: "HERMES_POST_MERGE_CLEANUP_WALL" },
      metadata: {
        postMergeCleanupRetryCount: 2,
        postMergeCleanupCauseCode: "HERMES_REPOSITORY_COMMAND_FAILED",
      },
    })
    expect(value.state.read().executions["77"].fencingToken).toBeGreaterThan(firstFence)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
  })

  it("keeps an ordinary zero-signal cleanup retry on the generic recovery path", async () => {
    const value = fixture()
    value.lifecycle.cleanupOwnedWorktree.mockRejectedValueOnce(Object.assign(
      new Error("ordinary cleanup retry"),
      { code: "HERMES_REPOSITORY_COMMAND_FAILED" },
    ))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_POST_MERGE_CLEANUP_WALL",
    })
    const statePath = path.join(value.root, "state", "state.json")
    const persisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
    const execution = persisted.executions["77"]
    execution.lease.abandonReason = "HERMES_RUNTIME_PROJECTION_WALL"
    execution.lease.abandonedAt = execution.lease.expiresAt
    fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", prNumber: 500,
    })
  })

  it("walls a retained review-recovery cleanup retry before generic effects when its lease marker is missing", async () => {
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const resolveActiveReviewRecoveryProvenance = vi.fn(async () => null)
    const value = fixture(undefined, {
      refreshQueueOutcome,
      resolveActiveReviewRecoveryProvenance,
    })
    value.lifecycle.cleanupOwnedWorktree.mockRejectedValueOnce(Object.assign(
      new Error("cleanup retry with retained recovery signal"),
      { code: "HERMES_REPOSITORY_COMMAND_FAILED" },
    ))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_POST_MERGE_CLEANUP_WALL",
    })
    const statePath = path.join(value.root, "state", "state.json")
    const basePersisted = JSON.parse(fs.readFileSync(statePath, "utf8"))
    const stateRevision = basePersisted.revision
    for (const [name, patch] of [
      ["missing lease marker", (execution) => { delete execution.lease.abandonedAt }],
      ["checkpoint state drift", (execution) => {
        execution.checkpoint.state = "RETRYABLE_WALL"
      }],
      ["checkpoint detail drift", (execution) => {
        execution.checkpoint.detail = "OTHER"
      }],
      ["present-null queue recovery signal", (execution) => {
        execution.metadata.reviewRecoveryProofDigest = null
        execution.metadata.outcome.queueBinding = { reviewRecoverySourceRuntimeAttempt: null }
      }],
    ] as const) {
      const persisted = structuredClone(basePersisted)
      const execution = persisted.executions["77"]
      execution.metadata.reviewRecoveryProofDigest = "d".repeat(64)
      execution.lease.abandonReason = "HERMES_RUNTIME_PROJECTION_WALL"
      execution.lease.abandonedAt = execution.lease.expiresAt
      patch(execution)
      fs.writeFileSync(statePath, `${JSON.stringify(persisted, null, 2)}\n`)
      value.selectOutcome.mockClear()
      refreshQueueOutcome.mockClear()
      resolveActiveReviewRecoveryProvenance.mockClear()
      value.lifecycle.cleanupOwnedWorktree.mockClear()
      value.projectLease.mockClear()

      await expect(value.orchestrator.cycle(), name).rejects.toMatchObject({
        code: "HERMES_REVIEW_RECOVERY_PROOF_WALL",
      })
      expect(value.state.read().revision, name).toBe(stateRevision)
      expect(value.selectOutcome, name).not.toHaveBeenCalled()
      expect(resolveActiveReviewRecoveryProvenance, name).not.toHaveBeenCalled()
      expect(refreshQueueOutcome, name).not.toHaveBeenCalled()
      expect(value.projectLease, name).not.toHaveBeenCalled()
      expect(value.lifecycle.cleanupOwnedWorktree, name).not.toHaveBeenCalled()
    }
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
      checkpoint: { state: "COMPLETE", detail: "PR #500 merged and verified" },
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

  it("awaits validation dependency provisioning and removal around each validator run", async () => {
    const value = fixture()
    let resolveEnsure!: (value: { linked: boolean }) => void
    let resolveRemove!: (value: { removed: boolean }) => void
    const ensure = new Promise<{ linked: boolean }>((resolve) => { resolveEnsure = resolve })
    const remove = new Promise<{ removed: boolean }>((resolve) => { resolveRemove = resolve })
    value.lifecycle.ensureValidationDependencies.mockReturnValueOnce(ensure)
    value.lifecycle.removeValidationDependencies.mockReturnValueOnce(remove)

    const cycle = value.orchestrator.cycle()
    await vi.waitFor(() => expect(value.lifecycle.ensureValidationDependencies).toHaveBeenCalledOnce())
    expect(value.lifecycle.runValidationCommands).not.toHaveBeenCalled()

    resolveEnsure({ linked: true })
    await vi.waitFor(() => expect(value.lifecycle.removeValidationDependencies).toHaveBeenCalledOnce())
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalledOnce()
    expect(value.lifecycle.removeValidationDependencies.mock.invocationCallOrder[0])
      .toBeGreaterThan(value.lifecycle.runValidationCommands.mock.invocationCallOrder[0])

    let settled = false
    void cycle.finally(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    resolveRemove({ removed: true })
    await expect(cycle).resolves.toMatchObject({ result: "COMPLETE" })
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
    const terminalExecution = createHermesStateStore(value.orchestrator.statePath).read().executions["77"]
    expect(createHermesStateStore(value.orchestrator.statePath).read().idempotency)
      .toHaveProperty(
        `77:release:FAILED_TERMINAL:VALIDATION_REMEDIATION_EXHAUSTED:${terminalExecution.fencingToken}`,
      )
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
    expect(value.client.runTurn.mock.calls[1][0].prompt).toContain("- components/hermes/live-status.tsx")
    expect(value.client.runTurn.mock.calls[1][0].prompt).not.toContain("components/**")
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
    const commands = (value.lifecycle.runValidationCommands.mock.calls as any)[0][0].commands
    expect(commands.flatMap(({ args }: { args: string[] }) => args)).not.toContain(
      "tests/deleted-hermes-status.test.tsx",
    )
  })

  it("replays an unfinished handoff failure without redispatching its Codex thread", async () => {
    const value = fixture(["lib/db/schema.ts"])
    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    value.advance(50 * 60 * 1000 + 1)

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "HERMES_CHANGED_PATH_WALL" })
    expect(value.client.runTurn).toHaveBeenCalledOnce()
    expect(value.client.resumeThread).not.toHaveBeenCalled()
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

  it("persists bounded sanitized App Server failure detail for governed recovery", async () => {
    const value = fixture()
    value.client.runTurn.mockRejectedValueOnce(Object.assign(new Error("failed"), {
      code: "APP_SERVER_TURN_FAILED",
      detail: `Invalid schema postgresql://dbuser:dbpassword@db.example/app\n-----BEGIN PRIVATE KEY-----\nprivate-key-body\n-----END PRIVATE KEY----- ${"x".repeat(1_100)}`,
    }))

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_TURN_FAILED" })
    const failed = value.state.read().executions["77"]
    expect(failed.checkpoint.state).toBe("RETRYABLE_WALL")
    expect(failed.checkpoint.detail).toMatch(/^APP_SERVER_TURN_FAILED: Invalid schema postgresql:\/\/\[REDACTED\]@db\.example\/app/)
    expect(failed.checkpoint.detail.length).toBeLessThanOrEqual(1_000)
    expect(failed.checkpoint.detail).not.toMatch(/dbpassword|private-key-body/)
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

  it("defers a usage-limit turn failure until the stated resume time instead of burning redispatches", async () => {
    // Diagnosed live 2026-08-22: Codex ended every turn in ~3s with "You've hit your usage limit …
    // try again at <date>" (credit balance 0). As a generic APP_SERVER_TURN_FAILED it became a
    // RETRYABLE_WALL, so each cycle abandoned the lease and re-dispatched into the identical wall —
    // one outcome reached attempt 15 against a limit five days out while holding the queue's only
    // active slot. A usage limit is a WAIT, and the provider says exactly when it lifts.
    const value = fixture()
    // The exact message shape Codex emits (far-future year so the parser's "must be ahead" rule
    // cannot expire this test). The expected instant comes from the parser itself — timezone
    // semantics are covered in tests/hermes-app-server-usage-limit-wait.test.ts; what this test
    // proves is that the orchestrator DEFERS to that instant instead of re-dispatching.
    const message = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 27th, 2099 4:36 AM."
    const resumeAt = parseAppServerUsageLimitRetryAfter(message)
    expect(resumeAt).not.toBeNull()
    value.client.runTurn.mockRejectedValueOnce(new AppServerTurnEndedError("failed", message))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
      // Waits until the provider's own stated instant, not a blind cooldown that would re-dispatch
      // straight back into the same wall.
      retryAfter: resumeAt as string,
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "DEFERRED" },
      checkpoint: { state: "DEFERRED_PROVIDER_UNAVAILABLE" },
    })
    // The turn is not re-attempted: no second dispatch burned against a wall that cannot lift yet.
    expect(value.client.runTurn).toHaveBeenCalledOnce()
  })

  it("publishes the usage limit as a lane fact and names the lane that could have served", async () => {
    // Deferring says THIS work waits; it says nothing about the lane, so the next dispatch walks
    // into the same empty meter. worker-lanes.mjs already states the policy — "provider exhaustion
    // reroutes when another approved lane can satisfy the work order" — and selectLane implements
    // it, but only for a lane somebody recorded as unavailable. This is that missing write, plus the
    // seam that makes "parked while a capable lane sat idle" visible instead of invisible.
    const statusPath = path.join(runtime(), "runtime-operator", "state", "provider-status.json")
    fs.mkdirSync(path.dirname(statusPath), { recursive: true })
    fs.writeFileSync(statusPath, JSON.stringify({
      lastDispatch: { workOrderId: "WO-0028", lane: "codex" },
    }), "utf8")
    const value = fixture(undefined, { providerStatusPath: statusPath })
    const message = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 27th, 2099 4:36 AM."
    const resumeAt = parseAppServerUsageLimitRetryAfter(message)
    value.client.runTurn.mockRejectedValueOnce(new AppServerTurnEndedError("failed", message))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
      retryAfter: resumeAt as string,
      // claude is the other approved implementation lane and nothing says it is exhausted, so the
      // park is a choice this result now has to admit to.
      reroutableLane: "claude",
    })
    expect(JSON.parse(fs.readFileSync(statusPath, "utf8"))).toEqual({
      // Merged, not clobbered: this writer knows about one lane and must not speak for the rest.
      lastDispatch: { workOrderId: "WO-0028", lane: "codex" },
      codex: { unavailableUntil: resumeAt, reason: "USAGE_LIMIT_EXCEEDED" },
    })
  })

  it("reports no reroutable lane when every capable lane is already exhausted", async () => {
    const statusPath = path.join(runtime(), "runtime-operator", "state", "provider-status.json")
    fs.mkdirSync(path.dirname(statusPath), { recursive: true })
    fs.writeFileSync(statusPath, JSON.stringify({
      claude: { unavailableUntil: "2099-12-31T00:00:00.000Z", reason: "RATE_LIMITED" },
    }), "utf8")
    const value = fixture(undefined, { providerStatusPath: statusPath })
    value.client.runTurn.mockRejectedValueOnce(new AppServerTurnEndedError(
      "failed",
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 27th, 2099 4:36 AM.",
    ))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      // Null, not absent: "nothing could serve" is a finding, and the seam has to be able to say it.
      reroutableLane: null,
    })
  })

  it("keeps deferring when the lane status cannot be written — the report is optional, the defer is not", async () => {
    const value = fixture(undefined, {
      recordLaneExhaustion: () => { throw new Error("EROFS") },
    })
    value.client.runTurn.mockRejectedValueOnce(new AppServerTurnEndedError(
      "failed",
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 27th, 2099 4:36 AM.",
    ))

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "PROVIDER_UNAVAILABLE",
      nextState: "DEFERRED_PROVIDER_UNAVAILABLE",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "DEFERRED" },
      checkpoint: { state: "DEFERRED_PROVIDER_UNAVAILABLE" },
    })
  })

  it("does not mark a lane exhausted for a delivery wall, which says nothing about the provider", async () => {
    const recordLaneExhaustion = vi.fn(() => ({ persisted: true, status: {} }))
    const value = fixture(undefined, { recordLaneExhaustion })
    value.client.runTurn.mockRejectedValueOnce(Object.assign(
      new Error("push rejected"),
      { code: "HERMES_REPOSITORY_GITHUB_WALL" },
    ))

    const result = await value.orchestrator.cycle()
    expect(result).toMatchObject({ result: "PROVIDER_UNAVAILABLE" })
    expect(result).not.toHaveProperty("reroutableLane")
    expect(recordLaneExhaustion).not.toHaveBeenCalled()
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
        blockedAction: null, authorityBoundary: null, minimumChoice: null,
        approveConsequence: null, denyConsequence: null,
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
        blockedAction: null, authorityBoundary: null, minimumChoice: null,
        approveConsequence: null, denyConsequence: null,
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
        blockedAction: null, authorityBoundary: null, minimumChoice: null,
        approveConsequence: null, denyConsequence: null,
      }),
    })
    value.advance(15 * 60 * 1000 + 1)
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(value.client.startThread).toHaveBeenCalledTimes(4)
    expect(value.client.resumeThread).not.toHaveBeenCalled()
  })

  it("persists the fresh queue fence when a deferred outcome resumes after restart", async () => {
    const baseOutcome = await fixture().selectOutcome()
    const queuedOutcome = {
      ...baseOutcome,
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    }
    const refreshedOutcome = {
      ...queuedOutcome,
      queueBinding: {
        ...queuedOutcome.queueBinding,
        expectedVersion: 5,
        fencingToken: 4,
      },
    }
    const refreshQueueOutcome = vi.fn(async () => refreshedOutcome)
    const value = fixture(undefined, { refreshQueueOutcome })
    const first = value.state.acquireLease({
      idempotencyKey: "queue-deferred-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: queuedOutcome },
    })
    const provider = value.state.checkpoint({
      idempotencyKey: "queue-deferred-provider",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "PROVIDER_UNAVAILABLE",
      detail: "2026-07-21T01:15:00.000Z",
    })
    value.state.deferProviderWall({
      idempotencyKey: "queue-deferred-settle",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: provider.checkpointSequence,
      retryAfter: "2026-07-21T01:15:00.000Z",
    })
    value.advance(15 * 60 * 1000 + 1)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(refreshQueueOutcome).toHaveBeenCalledWith(queuedOutcome)
    expect(value.state.read().executions["77"].metadata.outcome.queueBinding)
      .toEqual(refreshedOutcome.queueBinding)
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
          blockedAction: null, authorityBoundary: null, minimumChoice: null,
          approveConsequence: null, denyConsequence: null,
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
        blockedAction: null, authorityBoundary: null, minimumChoice: null,
        approveConsequence: null, denyConsequence: null,
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

  it("releases a recovered terminal under a new fence without colliding with its historical key", async () => {
    const verifyValidationInfrastructureRecovery = vi.fn(async () => true)
    const value = fixture(undefined, { verifyValidationInfrastructureRecovery })
    const validationFailure = "npx vitest run tests/focused.test.ts exited 1\n'vitest' is not recognized as an internal or external command"
    const validationError = Object.assign(new Error("validation failed"), {
      code: "HERMES_VALIDATION_FAILED",
      validation: { command: "npm", args: ["test"], code: 1, output: "deterministic failure" },
    })
    value.lifecycle.runValidationCommands.mockRejectedValue(validationError)
    const outcome = await value.selectOutcome()
    value.selectOutcome.mockClear()
    const first = value.state.acquireLease({
      idempotencyKey: "historical-terminal-acquire",
      outcomeId: "77",
      holderId: "historical-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome,
        branch: "codex/hermes-goal-77-77",
        worktreePath: path.join(value.root, "worktrees", "goal-77"),
        baseSha: "a".repeat(40),
        validationFailure,
        validationRemediationRound: 3,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "historical-terminal-checkpoint",
      outcomeId: "77",
      holderId: "historical-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "FAILED_TERMINAL",
      detail: "VALIDATION_REMEDIATION_EXHAUSTED",
    })
    const historicalReleaseKey = "77:release:FAILED_TERMINAL:VALIDATION_REMEDIATION_EXHAUSTED"
    value.state.releaseLease({
      idempotencyKey: historicalReleaseKey,
      outcomeId: "77",
      holderId: "historical-holder",
      fencingToken: first.fencingToken,
    })
    const reopened = value.state.reopenValidationInfrastructureWall({
      idempotencyKey: "historical-terminal-recovery",
      outcomeId: "77",
      expectedFencingToken: first.fencingToken,
      expectedDetail: "VALIDATION_REMEDIATION_EXHAUSTED",
      expectedValidationFailureDigest: createHash("sha256").update(validationFailure).digest("hex"),
      proofDigest: "d".repeat(64),
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "FAILED_TERMINAL",
      outcomeId: "77",
      nextState: "VALIDATION_REMEDIATION_EXHAUSTED",
    })

    const state = value.state.read()
    const recovered = state.executions["77"]
    expect(recovered.fencingToken).toBeGreaterThan(first.fencingToken)
    expect(recovered.lease.status).toBe("RELEASED")
    expect(state.idempotency).toHaveProperty(historicalReleaseKey)
    expect(state.idempotency).toHaveProperty(
      `77:release:FAILED_TERMINAL:VALIDATION_REMEDIATION_EXHAUSTED:${recovered.fencingToken}`,
    )
    expect(verifyValidationInfrastructureRecovery).toHaveBeenCalledWith({
      outcomeId: 77,
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      expectedFencingToken: first.fencingToken,
    })
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

  it("replays durable turn findings after projection failure without attaching them to later checkpoints", async () => {
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
    value.client.runTurn.mockResolvedValueOnce({
      threadId: "thread-owner-projection",
      turnId: "turn-owner-projection",
      status: "completed",
      finalText: JSON.stringify({ ...readyTurnResult, findings: [closedFinding] }),
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
      metadata: {
        ownerDecisionResumePhase: "CONSUMED",
        turnResult: { findings: [closedFinding] },
      },
      lease: {
        status: "ACTIVE",
        abandonReason: "HERMES_RUNTIME_PROJECTION_WALL",
        abandonedAt: expect.any(String),
      },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE", outcomeId: "77",
    })
    expect(value.client.runTurn).toHaveBeenCalledOnce()
    expect(value.client.connect).toHaveBeenCalledOnce()
    const projectedCheckpoints = value.projectCheckpoint.mock.calls.map(([request]) => request.checkpoint)
    const turnProjections = projectedCheckpoints.filter((checkpoint) => checkpoint.state === "CODEX_TURN_COMPLETED")
    expect(turnProjections.length).toBeGreaterThan(1)
    for (const checkpoint of turnProjections) expect(checkpoint.findings).toEqual([closedFinding])
    expect(projectedCheckpoints
      .filter((checkpoint) => checkpoint.state !== "CODEX_TURN_COMPLETED")
      .every((checkpoint) => checkpoint.findings === undefined)).toBe(true)
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

  it("reacquires and persists a fresh queue fence before owner-decision resume", async () => {
    const baseOutcome = await fixture().selectOutcome()
    const queuedOutcome = {
      ...baseOutcome,
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    }
    const resumedOutcome = {
      ...queuedOutcome,
      queueBinding: {
        ...queuedOutcome.queueBinding,
        expectedVersion: 6,
        fencingToken: 4,
      },
    }
    const resumeQueueAfterDecision = vi.fn(async () => resumedOutcome)
    const refreshQueueOutcome = vi.fn(async (outcome) => outcome)
    const value = fixture(undefined, { resumeQueueAfterDecision, refreshQueueOutcome })
    const first = value.state.acquireLease({
      idempotencyKey: "queue-owner-resume-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: {
        outcome: queuedOutcome,
        threadId: "thread-owner-wall",
        ownerDecisionPacket,
      },
    })
    value.state.checkpoint({
      idempotencyKey: "queue-owner-resume-wall",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED",
      detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.releaseLease({
      idempotencyKey: "queue-owner-resume-release",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
    })
    const proof = {
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
    }
    value.readApprovedOwnerDecision.mockResolvedValue(proof)

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(resumeQueueAfterDecision).toHaveBeenCalledWith(queuedOutcome, proof)
    expect(refreshQueueOutcome).toHaveBeenCalledWith(resumedOutcome)
    expect(value.state.read().executions["77"].metadata.outcome.queueBinding)
      .toEqual(resumedOutcome.queueBinding)
    expect(resumeQueueAfterDecision.mock.invocationCallOrder[0])
      .toBeLessThan(value.client.runTurn.mock.invocationCallOrder[0])
  })

  it("replays a committed queue resume after a crash before local owner-wall reopen", async () => {
    const baseOutcome = await fixture().selectOutcome()
    const queuedOutcome = {
      ...baseOutcome,
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    }
    const resumedOutcome = {
      ...queuedOutcome,
      queueBinding: {
        ...queuedOutcome.queueBinding,
        expectedVersion: 6,
        fencingToken: 4,
      },
    }
    const committedCrash = Object.assign(new Error("process exited after queue commit"), {
      code: "SIMULATED_POST_COMMIT_CRASH",
    })
    const resumeQueueAfterDecision = vi.fn()
      .mockRejectedValueOnce(committedCrash)
      .mockResolvedValueOnce(resumedOutcome)
    const value = fixture(undefined, {
      resumeQueueAfterDecision,
      refreshQueueOutcome: vi.fn(async (outcome) => outcome),
    })
    const first = value.state.acquireLease({
      idempotencyKey: "queue-resume-crash-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: queuedOutcome, threadId: "thread-owner-wall", ownerDecisionPacket },
    })
    value.state.checkpoint({
      idempotencyKey: "queue-resume-crash-wall",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED",
      detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.state.releaseLease({
      idempotencyKey: "queue-resume-crash-release",
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

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "SIMULATED_POST_COMMIT_CRASH",
    })
    expect(value.state.read().executions["77"]).toMatchObject({
      lease: { status: "RELEASED" },
      checkpoint: { state: "OWNER_DECISION_REQUIRED" },
      metadata: { outcome: queuedOutcome },
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({
      result: "COMPLETE",
      outcomeId: "77",
    })
    expect(resumeQueueAfterDecision).toHaveBeenCalledTimes(2)
    expect(value.state.read().executions["77"].metadata.outcome.queueBinding)
      .toEqual(resumedOutcome.queueBinding)
  })

  it("replays a committed owner-wall transition after a crash before local release", async () => {
    const baseOutcome = await fixture().selectOutcome()
    const queuedOutcome = {
      ...baseOutcome,
      queueBinding: {
        userId: "owner-id",
        outcomeKey: "outcome:77",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    }
    const refreshQueueOutcome = vi.fn(async () => queuedOutcome)
    const bindQueueWorkOrder = vi.fn(async () => {
      throw new Error("settled owner wall must not bind an active Work Order")
    })
    const value = fixture(undefined, { refreshQueueOutcome, bindQueueWorkOrder })
    const first = value.state.acquireLease({
      idempotencyKey: "owner-transition-crash-acquire",
      outcomeId: "77",
      holderId: "crashed-holder",
      leaseDurationMs: 1000,
      metadata: { outcome: queuedOutcome, threadId: "thread-owner-wall", ownerDecisionPacket },
    })
    value.state.checkpoint({
      idempotencyKey: "owner-transition-crash-wall",
      outcomeId: "77",
      holderId: "crashed-holder",
      fencingToken: first.fencingToken,
      expectedCheckpointSequence: 0,
      state: "OWNER_DECISION_REQUIRED",
      detail: "NEW_AUTHORITY_REQUIRED",
    })
    value.advance(1001)

    await expect(value.orchestrator.cycle()).resolves.toEqual({
      result: "OWNER_DECISION_REQUIRED",
      outcomeId: "77",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })
    expect(refreshQueueOutcome).toHaveBeenCalledWith(queuedOutcome, {
      state: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })
    expect(value.markTerminal).toHaveBeenCalledWith({
      outcomeId: 77,
      outcome: queuedOutcome,
      result: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
      metadata: ownerDecisionPacket,
    })
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
    expect(value.state.read().executions["77"].lease.status).toBe("RELEASED")
    expect(value.client.connect).not.toHaveBeenCalled()
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
        denyConsequence: null,
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

  it("blocks commit and push when the execution is fenced during host validation", async () => {
    const value = fixture()
    value.lifecycle.runValidationCommands.mockImplementationOnce(async () => {
      const active = value.state.read().executions["77"]
      value.state.abandonLease({
        idempotencyKey: `77:test-stale-worker:${active.fencingToken}`,
        outcomeId: "77",
        holderId: "test-holder",
        fencingToken: active.fencingToken,
        reason: "TEST_CONCURRENT_FENCE",
      })
      return [{ command: "npx", args: ["vitest", "run"], code: 0 }]
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_FENCING_TOKEN_CONFLICT",
    })
    expect(value.lifecycle.commitChanges).not.toHaveBeenCalled()
    expect(value.lifecycle.pushBranch).not.toHaveBeenCalled()
    expect(value.lifecycle.createPullRequest).not.toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
  })
})

/**
 * Lane selection and executor binding, proved at the orchestrator — not at the adapter.
 *
 * An adapter unit test can only show that a ClaudeLaneClient works. What matters is that HERMES
 * actually routes through it when policy says to, that everything downstream of the turn is
 * unchanged, and that a claude-lane turn is held to exactly the same walls a Codex turn is.
 */
describe("claude lane dispatch", () => {
  const laneReadyResult = {
    result: "READY_FOR_VALIDATION",
    workOrder: "WO-HERMES-77-001",
    branch: "codex/hermes-goal-77-77",
    commit: null,
    prUrl: null,
    merged: false,
    mergeCommit: null,
    validation: ["pass"],
    reviewThreads: 0,
    ownerTouchCount: 0,
    blockedScopeCrossed: false,
    nextState: "READY_FOR_HERMES_MERGE",
    blockedAction: null,
    authorityBoundary: null,
    minimumChoice: null,
    approveConsequence: null,
    denyConsequence: null,
    // The claude lane validates against the canonical contract the worker was actually handed, which
    // requires `findings` — stricter than the orchestrator's own normalizer, deliberately so.
    findings: [],
  }

  function laneStatus(lanes: Record<string, unknown>) {
    const statusPath = path.join(runtime(), "runtime-operator", "state", "provider-status.json")
    fs.mkdirSync(path.dirname(statusPath), { recursive: true })
    fs.writeFileSync(statusPath, JSON.stringify(lanes), "utf8")
    return statusPath
  }

  const codexExhausted = { codex: { unavailableUntil: "2099-12-31T00:00:00.000Z", reason: "USAGE_LIMIT_EXCEEDED" } }

  function fakeCliChild() {
    return Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: () => {} }),
      stdin: { end: () => {} },
      kill: vi.fn(),
    }) as any
  }

  /** A real ClaudeLaneClient over a scripted CLI, so the orchestrator drives the actual adapter. */
  function claudeLane(turnResult: Record<string, unknown> = laneReadyResult) {
    const prompts: string[] = []
    const spawn = vi.fn((_command: string, args: string[]) => {
      const child = fakeCliChild()
      const prompt = args[args.indexOf("-p") + 1]
      prompts.push(prompt)
      const runId = /runId=([A-Za-z0-9-]+)/.exec(prompt)?.[1] ?? ""
      const sessionId = args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1]
      queueMicrotask(() => {
        child.stdout.emit("data", JSON.stringify({
          type: "result", subtype: "success", is_error: false, session_id: sessionId,
          result: [
            "Implemented the change and reviewed it.",
            "HERMES_TURN_OUTPUT runId=" + runId,
            JSON.stringify(turnResult),
            "HERMES_TURN_OUTPUT_END",
          ].join("\n"),
        }))
        child.emit("close", 0, null)
      })
      return child
    })
    const created: any[] = []
    const factory = (worktreePath: string, workOrderId: string) => {
      fs.mkdirSync(worktreePath, { recursive: true })
      const lane = new ClaudeLaneClient({
        cwd: worktreePath, workOrderId, command: "/fake/claude", spawn,
        env: { PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-live-must-not-travel" },
      })
      created.push(lane)
      return lane
    }
    return { factory, spawn, prompts, created }
  }

  it("dispatches through the claude executor when codex is exhausted and never touches the codex client", async () => {
    const lane = claudeLane()
    const value = fixture(undefined, {
      providerStatusPath: laneStatus(codexExhausted),
      claudeLaneClientFactory: lane.factory,
      isClaudeLaneAvailable: () => true,
    })

    // Delivery runs to completion through the ordinary machinery: validation, commit, PR, review,
    // merge, merged-main verification, cleanup. Nothing downstream of the turn is lane-specific.
    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })

    expect(lane.created).toHaveLength(1)
    expect(lane.spawn).toHaveBeenCalledOnce()
    // The Codex client is never constructed and never invoked: lane selection and executor selection
    // are one decision, so they cannot disagree.
    expect(value.client.connect).not.toHaveBeenCalled()
    expect(value.client.runTurn).not.toHaveBeenCalled()

    // The owned worktree HERMES prepared, not a tree the lane chose for itself.
    const owned = await value.lifecycle.ensureOwnedWorktree.mock.results[0].value
    expect(lane.created[0].cwd).toBe(owned.worktreePath)
    expect(lane.spawn.mock.calls[0][2].cwd).toBe(owned.worktreePath)

    // The same governed prompt: identical reservations, identical blocked scope.
    const prompt = lane.prompts[0]
    expect(prompt).toContain("- components/hermes/live-status.tsx")
    expect(prompt).toContain("- tests/hermes-live-status.test.tsx")
    for (const blocked of HERMES_BLOCKED_SCOPE) expect(prompt).toContain("- " + blocked)
    // And the terminal-result channel contract the executor reads back.
    expect(prompt).toContain("HERMES_TURN_OUTPUT_END")

    // Native validation ran, and delivery reached verified merged main.
    expect(value.lifecycle.runValidationCommands).toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).toHaveBeenCalled()
    expect(value.lifecycle.verifyOriginMainContains).toHaveBeenCalled()
    expect(value.markComplete).toHaveBeenCalled()
    // The completion gate held on the accepted turn.
    expect(value.state.read().ownerTouchCount ?? 0).toBe(0)
    // The credential never reached the child.
    expect(JSON.stringify(lane.spawn.mock.calls[0][2].env)).not.toContain("must-not-travel")
  })

  it("walls a claude turn that crosses the owner boundary, with no commit and no fabricated completion", async () => {
    const lane = claudeLane({ ...laneReadyResult, ownerTouchCount: 1 })
    const value = fixture(undefined, {
      providerStatusPath: laneStatus(codexExhausted),
      claudeLaneClientFactory: lane.factory,
      isClaudeLaneAvailable: () => true,
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      code: "HERMES_COMPLETION_GATE_WALL",
    })
    expect(lane.spawn).toHaveBeenCalledOnce()
    expect(value.lifecycle.commitChanges).not.toHaveBeenCalled()
    expect(value.lifecycle.createPullRequest).not.toHaveBeenCalled()
    expect(value.lifecycle.mergePullRequest).not.toHaveBeenCalled()
    expect(value.markComplete).not.toHaveBeenCalled()
  })

  it("walls a claude turn answering in prose instead of the delimited result channel", async () => {
    const spawn = vi.fn((_command: string, args: string[]) => {
      const child = fakeCliChild()
      const sessionId = args[args.indexOf(args.includes("--resume") ? "--resume" : "--session-id") + 1]
      queueMicrotask(() => {
        // Prose a permissive first-brace/last-brace scan could have mined for a "result".
        child.stdout.emit("data", JSON.stringify({
          type: "result", subtype: "success", is_error: false, session_id: sessionId,
          result: 'All done. The shape is { "result": "READY_FOR_VALIDATION", "merged": true }.',
        }))
        child.emit("close", 0, null)
      })
      return child
    })
    const value = fixture(undefined, {
      providerStatusPath: laneStatus(codexExhausted),
      isClaudeLaneAvailable: () => true,
      claudeLaneClientFactory: (worktreePath: string, workOrderId: string) => {
        fs.mkdirSync(worktreePath, { recursive: true })
        return new ClaudeLaneClient({ cwd: worktreePath, workOrderId, command: "/fake/claude", spawn })
      },
    })

    await expect(value.orchestrator.cycle()).rejects.toMatchObject({
      laneCode: "CLAUDE_LANE_RESULT_CHANNEL_MISSING",
    })
    expect(value.lifecycle.commitChanges).not.toHaveBeenCalled()
    expect(value.markComplete).not.toHaveBeenCalled()
  })

  it("keeps the codex path unchanged when the assigned lane is available", async () => {
    const claudeLaneClientFactory = vi.fn()
    const value = fixture(undefined, {
      providerStatusPath: laneStatus({ claude: { unavailableUntil: "2099-12-31T00:00:00.000Z" } }),
      claudeLaneClientFactory,
      isClaudeLaneAvailable: () => true,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE", prNumber: 500 })
    expect(value.client.runTurn).toHaveBeenCalled()
    expect(claudeLaneClientFactory).not.toHaveBeenCalled()
  })

  it("stays on codex when policy names the claude lane but the host cannot run it", async () => {
    const claudeLaneClientFactory = vi.fn()
    const value = fixture(undefined, {
      providerStatusPath: laneStatus(codexExhausted),
      claudeLaneClientFactory,
      // A roster entry is a claim; an absent binary is the truth. Binding an executor to it would
      // trade a typed park for a failed turn.
      isClaudeLaneAvailable: () => false,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(claudeLaneClientFactory).not.toHaveBeenCalled()
    expect(value.client.runTurn).toHaveBeenCalled()
  })

  it("keeps dispatching on codex when lane selection itself fails", async () => {
    const claudeLaneClientFactory = vi.fn()
    const value = fixture(undefined, {
      selectLane: () => { throw new Error("roster unreadable") },
      claudeLaneClientFactory,
      isClaudeLaneAvailable: () => true,
    })

    await expect(value.orchestrator.cycle()).resolves.toMatchObject({ result: "COMPLETE" })
    expect(claudeLaneClientFactory).not.toHaveBeenCalled()
    expect(value.client.runTurn).toHaveBeenCalled()
  })
})
