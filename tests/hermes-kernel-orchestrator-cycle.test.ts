import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import { type GoalTimelineWorkOrderRecord } from "@/components/goal-console/goal-timeline-read-model"
import { RuntimeExecutionGovernanceEventRecord } from "@/components/runtime/runtime-execution-model"
import { createHermesKernelClient } from "../scripts/hermes-bridge/hermes-kernel-client.mjs"
import { createHermesOrchestrator } from "../scripts/hermes-bridge/orchestrator.mjs"
import {
  projectOutcomeRuntimeCheckpoint,
  projectOutcomeRuntimeLease,
} from "../scripts/hermes-bridge/outcome-source.mjs"
import { createHermesStateStore } from "../scripts/hermes-bridge/state-store.mjs"
import {
  HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST,
  HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
  HERMES_WORK_CONTRACT_VERSION,
  resolveHermesWorkContract,
} from "../scripts/hermes-bridge/work-contract.mjs"

const roots: string[] = []
const owner = "owner-461"
const outcomeId = 461
const workOrderId = 1_461
const workOrderRef = "WO-HERMES-OUTCOME-461"
const prNumber = 461
const commit = "c".repeat(40)
const mergeSha = "d".repeat(40)
// The Hermes bridge only executes outcomes that resolve to the single registered,
// reviewed work contract (deny-by-default since 4c80e9a); the persisted projectors
// additionally bind every checkpoint to a durable queue binding and a canonical
// Workbench authorization (6a3539a). This scenario therefore runs on that contract.
const registeredCommand = "Add a compact on-screen latest-evidence timestamp to selected Thread work status."
const registeredContract = resolveHermesWorkContract({
  lane: "ui", risk: "low", authority: "A2_WRITE_OWN", command: registeredCommand,
})!
const changedPaths = [registeredContract.reservations[0]]
const registeredValidators = registeredContract.validationCommands.map(
  ({ command, args }: { command: string; args: string[] }) => `${command} ${args.join(" ")}`,
)
const acquisitionKey = "acquisition-goal-461"
const queueBinding = {
  userId: owner,
  outcomeKey: "goal:GOAL-WOS-V1.1-003",
  expectedVersion: 3,
  executionBinding: "execution-goal-461",
  leaseHolder: "Hermes:hermes-outcome-queue",
  leaseToken: "lease-goal-461",
  fencingToken: 1,
  acquisitionKey,
  activeWorkOrderId: workOrderId,
}

type EvidenceRow = {
  id: number
  userId: string
  ref: string
  workOrderId: number
  result: string
  repo: string
  head: string | null
  notes: string
  contentHash: string
  createdAt: Date
}

function sqlText(value: unknown): string {
  return String(value).replace(/\s+/g, " ").trim()
}

function metadata(value: unknown): Record<string, unknown> {
  return JSON.parse(String(value)) as Record<string, unknown>
}

class PersistedRuntimeLedger {
  readonly events: RuntimeExecutionGovernanceEventRecord[] = []
  readonly evidence: EvidenceRow[] = []
  readonly workOrder: GoalTimelineWorkOrderRecord
  private nextEventId = 2_000
  private nextEvidenceId = 3_000

  constructor(
    private readonly recordedAt: () => Date,
  ) {
    const createdAt = new Date("2026-07-26T16:00:01.000Z")
    this.workOrder = {
      id: workOrderId,
      userId: owner,
      ref: workOrderRef,
      title: "Resident continuity and cross-surface recovery",
      description: "Durable runtime projection for GOAL-WOS-V1.1-003",
      goal: "GOAL-WOS-V1.1-003",
      lane: "ui",
      phase: null,
      status: "active",
      result: null,
      commitRef: null,
      evidence: [],
      assignee: "hermes-codex-bridge",
      validators: [...registeredValidators],
      stopConditions: [],
      linkedDecisionId: null,
      createdAt,
      updatedAt: createdAt,
      closedAt: null,
      completedAt: null,
    }
  }

  readonly query = async (statement: unknown, params: unknown[] = []) => {
    const sql = sqlText(statement)
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)
      || sql.startsWith("SELECT pg_advisory_xact_lock")
      || sql.startsWith("INSERT INTO work_order")) {
      return { rows: [], rowCount: 0 }
    }
    if (sql.startsWith('SELECT contract_goal.id AS "goalId"')) {
      return {
        rows: [{
          goalId: outcomeId,
          userId: owner,
          goalRef: "GOAL-WOS-V1.1-003",
          goalLane: "ui",
          outcomeKey: queueBinding.outcomeKey,
          version: queueBinding.expectedVersion,
          executionBinding: queueBinding.executionBinding,
          leaseToken: queueBinding.leaseToken,
          leaseHolder: queueBinding.leaseHolder,
          fencingToken: queueBinding.fencingToken,
          acquisitionKey,
          executionEpochStartedAt: "2026-07-26T15:59:00.000Z",
          activeWorkOrderId: workOrderId,
          workContract: {
            version: HERMES_WORK_CONTRACT_VERSION,
            repository: "bsvalues/terragroq",
            lane: "ui",
            id: HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
            digest: HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST,
            reservations: [...registeredContract.reservations],
            validationCommands: registeredContract.validationCommands.map(
              ({ command, args }: { command: string; args: string[] }) => ({ command, args: [...args] }),
            ),
          },
        }],
        rowCount: 1,
      }
    }
    if (sql.startsWith('SELECT wo.id, wo."userId" AS "userId", wo.ref')) {
      const latest = [...this.events].reverse().find((event) =>
        event.eventType === "HERMES_RUNTIME_CHECKPOINT")
      const latestMetadata = (latest?.metadata ?? null) as Record<string, unknown> | null
      const epochLatest = [...this.events].filter((event) =>
        event.eventType === "HERMES_RUNTIME_CHECKPOINT"
        && (event.metadata as Record<string, unknown>).executionEpochDigest === params[2])
        .sort((a, b) => Number((b.metadata as Record<string, unknown>).checkpointSequence)
          - Number((a.metadata as Record<string, unknown>).checkpointSequence) || b.id - a.id)[0]
      return {
        rows: [{
          id: workOrderId,
          userId: owner,
          ref: workOrderRef,
          goal: this.workOrder.goal,
          lane: this.workOrder.lane,
          status: this.workOrder.status,
          result: this.workOrder.result,
          commitRef: this.workOrder.commitRef,
          assignee: this.workOrder.assignee,
          agent: "codex",
          allowedFiles: [...registeredContract.reservations],
          validators: [...registeredValidators],
          latestCheckpointId: latest?.id ?? null,
          latestCheckpointMetadata: latestMetadata,
          latestCheckpointState: latestMetadata?.checkpointState ?? null,
          latestCheckpointKey: latestMetadata?.idempotencyKey ?? null,
          latestCheckpointDigest: latestMetadata?.payloadDigest ?? null,
          latestCheckpointSequence: latestMetadata?.checkpointSequence === undefined
            ? null : String(latestMetadata.checkpointSequence),
          latestExecutionEpochDigest: latestMetadata?.executionEpochDigest ?? null,
          latestCheckpointCreatedAt: latest?.createdAt ?? null,
          latestExecutionEpochSequence: epochLatest
            ? String((epochLatest.metadata as Record<string, unknown>).checkpointSequence) : null,
        }],
        rowCount: 1,
      }
    }
    if (sql.includes("INSERT INTO governance_event")
      && sql.includes("'HERMES_RUNTIME_CHECKPOINT'")) {
      return this.insertRuntimeEvent("HERMES_RUNTIME_CHECKPOINT", params)
    }
    if (sql.includes("INSERT INTO governance_event")
      && sql.includes("'HERMES_RUNTIME_LEASE'")) {
      return this.insertRuntimeEvent("HERMES_RUNTIME_LEASE", params)
    }
    if (sql.includes("INSERT INTO governance_event")
      && sql.includes("'HERMES_RUNTIME_FAILURE_EVAL'")) {
      const event = this.appendEvent(
        "HERMES_RUNTIME_FAILURE_EVAL",
        String(params[2]),
        metadata(params[3]),
      )
      return { rows: [{ id: event.id }], rowCount: 1 }
    }
    if (sql.startsWith("SELECT metadata->>'payloadDigest' AS")) {
      const prior = this.events.find((event) => (
        event.entityId === String(params[0])
        && (event.metadata as Record<string, unknown>).idempotencyKey === params[1]
      ))
      return {
        rows: prior
          ? [{ payloadDigest: (prior.metadata as Record<string, unknown>).payloadDigest }]
          : [],
        rowCount: prior ? 1 : 0,
      }
    }
    if (sql.startsWith("UPDATE work_order")) {
      this.workOrder.status = String(params[1])
      this.workOrder.result = params[2] === null ? null : String(params[2])
      if (params[3]) this.workOrder.commitRef = String(params[3])
      this.workOrder.evidence = [...new Set([
        ...this.workOrder.evidence,
        ...(params[4] as string[]),
      ])].sort()
      this.workOrder.updatedAt = this.recordedAt()
      if (this.workOrder.status === "closed") {
        this.workOrder.closedAt ??= this.recordedAt()
        this.workOrder.completedAt ??= this.recordedAt()
      }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith("INSERT INTO evidence_record")) {
      const ref = String(params[1])
      if (!this.evidence.some((row) => row.ref === ref)) {
        this.evidence.push({
          id: this.nextEvidenceId++,
          userId: String(params[0]),
          ref,
          workOrderId: Number(params[2]),
          result: String(params[3]),
          repo: "bsvalues/terragroq",
          head: params[4] === null ? null : String(params[4]),
          notes: String(params[5]),
          contentHash: String(params[6]),
          createdAt: this.recordedAt(),
        })
      }
      return { rows: [], rowCount: 1 }
    }
    if (sql.startsWith('SELECT result, repo, head, notes, "contentHash"')) {
      const row = this.evidence.find((candidate) => (
        candidate.userId === params[0]
        && candidate.ref === params[1]
        && candidate.workOrderId === params[2]
      ))
      return {
        rows: row ? [{
          result: row.result,
          repo: row.repo,
          head: row.head,
          notes: row.notes,
          contentHash: row.contentHash,
        }] : [],
        rowCount: row ? 1 : 0,
      }
    }
    throw new Error(`Unhandled acceptance-ledger SQL: ${sql}`)
  }

  private insertRuntimeEvent(
    eventType: "HERMES_RUNTIME_CHECKPOINT" | "HERMES_RUNTIME_LEASE",
    params: unknown[],
  ) {
    const eventMetadata = metadata(params[3])
    const duplicate = this.events.find((event) => (
      event.eventType === eventType
      && (event.metadata as Record<string, unknown>).idempotencyKey
        === eventMetadata.idempotencyKey
    ))
    if (duplicate) return { rows: [], rowCount: 0 }
    const event = this.appendEvent(eventType, String(params[2]), eventMetadata)
    return { rows: [{ id: event.id }], rowCount: 1 }
  }

  private appendEvent(
    eventType: string,
    reason: string,
    eventMetadata: Record<string, unknown>,
  ): RuntimeExecutionGovernanceEventRecord {
    const event: RuntimeExecutionGovernanceEventRecord = {
      id: this.nextEventId++,
      userId: owner,
      eventType,
      entityType: "work_order",
      entityId: String(workOrderId),
      actor: "hermes-codex-bridge",
      reason,
      metadata: eventMetadata,
      createdAt: this.recordedAt(),
    }
    this.events.push(event)
    return event
  }
}

function runtimeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-kernel-orchestrator-cycle-"))
  roots.push(root)
  fs.mkdirSync(path.join(root, "control"), { recursive: true })
  fs.writeFileSync(path.join(root, "control", "activation"), "enabled\n")
  fs.writeFileSync(
    path.join(root, "control", "authority-not-before"),
    "2026-07-26T15:00:00.000Z\n",
  )
  return root
}

function outcome() {
  return {
    id: outcomeId,
    userId: owner,
    ref: "GOAL-WOS-V1.1-003",
    command: registeredCommand,
    lane: "ui",
    mode: "implement",
    risk: "low",
    authority: "A2_WRITE_OWN",
    verdict: "requires_approval",
    requiresApproval: true,
    status: "classified",
    queueBinding: { ...queueBinding },
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

const kernelJson = JSON.stringify({
  result: "READY_FOR_VALIDATION", workOrder: "WO-WOS-V1.1-003", branch: "codex/wos-v1-1-continuity-recovery",
  commit: null, prUrl: null, merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0,
  ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
  blockedAction: null, authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null,
})

describe("Hermes orchestrator over the resident-model kernel client", () => {
  it("completes one fenced delivery when the kernel lane returns the turn JSON", async () => {
    const root = runtimeRoot()
    let clock = Date.parse("2026-08-16T20:00:00.000Z"); const now = () => new Date(clock)
    const ledger = new PersistedRuntimeLedger(now)
    const projectCheckpoint = (input: Record<string, unknown>) => (projectOutcomeRuntimeCheckpoint as any)({ ...input, query: ledger.query })
    const projectLease = (input: Record<string, unknown>) => (projectOutcomeRuntimeLease as any)({ ...input, query: ledger.query })
    // kernel lane fixture: policy v2 next to a fake invoker; workspace = the orchestrator's owned worktree
    const worktreesRoot = path.join(root, "worktrees"); const workspacePath = path.join(worktreesRoot, "wos-v1-1-continuity-recovery"); fs.mkdirSync(workspacePath, { recursive: true })
    const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
    const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
    fs.writeFileSync(policyPath, JSON.stringify({ schemaVersion: 2, packetSchemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: { id: "williamos-qwen3-4b:64k" }, placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [worktreesRoot] }, execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 }, promotion: { status: "PILOT_AUTHORIZED", requiredEvidence: ["OWNED_WORKTREE_CONFINEMENT_PROVEN"], satisfiedEvidence: { OWNED_WORKTREE_CONFINEMENT_PROVEN: "bootstrap-owned-1" } } }))
    fs.writeFileSync(path.join(root, "invoke.ps1"), "# fake")
    const invocations: string[][] = []
    const commandRunner = vi.fn(async ({ command, args }: { command: string; args: string[] }) => {
      // The client probes `git rev-parse --git-common-dir` either side of the invoker.
      if (command === "git") return { code: 0, stderr: "", stdout: `${path.join(workspacePath, ".git")}\n` }
      invocations.push(args)
      const runId = args[args.indexOf("-RunId") + 1]
      return { code: 0, stderr: "", stdout: `working\n\`\`\`json\n${kernelJson}\n\`\`\`\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=${workspacePath}\n` }
    })
    let merged = false
    // lifecycle: same as the continuity test but ensureOwnedWorktree returns the kernel workspace
    const lifecycle = {
      refreshOriginMain: vi.fn(async () => "a".repeat(40)),
      ensureOwnedWorktree: vi.fn(async ({ branch }: { branch: string }) => ({
        branch,
        worktreePath: workspacePath,
      })),
      discoverPullRequest: vi.fn(async () => null),
      inspectPullRequest: vi.fn(async () => ({
        state: merged ? "MERGED" : "OPEN",
        baseRefName: "main",
        isDraft: false,
        checksGreen: true,
        checksComplete: true,
        failedChecks: [],
        reviewed: true,
        reviewCompleted: true,
        reviewRequested: true,
        codexReviewFindings: [],
        unresolvedThreadCount: 0,
        headRefOid: commit,
        mergeCommit: merged ? { oid: mergeSha } : null,
      })),
      inspectChangedPaths: vi.fn(async () => changedPaths),
      inspectWorkingTreePaths: vi.fn(async () => changedPaths),
      inspectWorktreeHead: vi.fn(async () => commit),
      ensureValidationDependencies: vi.fn(() => ({ linked: true })),
      removeValidationDependencies: vi.fn(() => ({ removed: true })),
      runValidationCommands: vi.fn(async ({ commands }: { commands: Array<{ command: string; args: string[] }> }) =>
        commands.map(({ command, args }) => ({ command, args, code: 0 }))),
      commitChanges: vi.fn(async () => ({
        commit,
        branch: "codex/wos-v1-1-continuity-recovery",
        paths: changedPaths,
      })),
      pushBranch: vi.fn(async () => ({ pushed: true })),
      createPullRequest: vi.fn(async () => ({
        number: prNumber,
        url: `https://github.com/bsvalues/terragroq/pull/${prNumber}`,
      })),
      requestCodexReview: vi.fn(async () => ({ requested: true })),
      inspectReviewFindings: vi.fn(async () => []),
      resolveReviewThreads: vi.fn(async () => ({ resolved: 0 })),
      inspectPullRequestFiles: vi.fn(async () => changedPaths),
      mergePullRequest: vi.fn(async () => {
        merged = true
        return { merged: true }
      }),
      verifyOriginMainContains: vi.fn(async () => true),
      cleanupOwnedWorktree: vi.fn(async () => ({ cleaned: true })),
    } as any
    const markComplete = vi.fn(async () => true)
    const orchestrator = createHermesOrchestrator({
      workspace: process.cwd(), runtimeRoot: root, state: createHermesStateStore(path.join(root, "state", "state.json"), { now: () => clock }),
      lifecycle, selectOutcome: vi.fn(async () => outcome()), markComplete, markTerminal: vi.fn(async () => true), deferOutcome: vi.fn(async () => true),
      projectCheckpoint, projectLease,
      clientFactory: (worktreePath: string) => createHermesKernelClient({ workspacePath: worktreePath, runtimeRoot: root, commandRunner, policyPath, invokerPath: path.join(root, "invoke.ps1"), now, powershellCommand: "powershell" }),
      holderId: "resident-kernel", now, sleep: async () => {}, leaseRenewalIntervalMs: 60 * 60 * 1000,
    })
    await expect(orchestrator.cycle()).resolves.toEqual({ result: "COMPLETE", outcomeId: String(outcomeId), prNumber, mergeSha, changedPaths })
    expect(invocations).toHaveLength(1)
    expect(invocations[0]).toContain("-WorkspacePath")
    expect(lifecycle.createPullRequest).toHaveBeenCalledOnce()
    expect(markComplete).toHaveBeenCalledOnce()
    const completed = orchestrator && (createHermesStateStore(path.join(root, "state", "state.json"), { now: () => clock }).read().executions[String(outcomeId)])
    expect(completed).toMatchObject({ checkpoint: { state: "COMPLETE" } })
  })

  it("rejects with APP_SERVER_TURN_FAILED when the kernel lane never fences a JSON block", async () => {
    const root = runtimeRoot()
    let clock = Date.parse("2026-08-16T20:00:00.000Z"); const now = () => new Date(clock)
    const ledger = new PersistedRuntimeLedger(now)
    const projectCheckpoint = (input: Record<string, unknown>) => (projectOutcomeRuntimeCheckpoint as any)({ ...input, query: ledger.query })
    const projectLease = (input: Record<string, unknown>) => (projectOutcomeRuntimeLease as any)({ ...input, query: ledger.query })
    const worktreesRoot = path.join(root, "worktrees"); const workspacePath = path.join(worktreesRoot, "wos-v1-1-continuity-recovery"); fs.mkdirSync(workspacePath, { recursive: true })
    const policyDir = path.join(root, "policy"); fs.mkdirSync(policyDir)
    const policyPath = path.join(policyDir, "hermes-free-dev-agent-v2.policy.json")
    fs.writeFileSync(policyPath, JSON.stringify({ schemaVersion: 2, packetSchemaVersion: 2, workOrderId: "WO-HERMES-FREE-DEV-AGENT-001", model: { id: "williamos-qwen3-4b:64k" }, placement: { workspaceMode: "OWNED_WORKTREE", allowedWorkspaceRoots: [worktreesRoot] }, execution: { maximumTurns: 20, allowedToolsets: ["file", "terminal"], promptMaxChars: 60000, sessionResumeProven: false, timeoutSeconds: 1800 }, promotion: { status: "PILOT_AUTHORIZED", requiredEvidence: ["OWNED_WORKTREE_CONFINEMENT_PROVEN"], satisfiedEvidence: { OWNED_WORKTREE_CONFINEMENT_PROVEN: "bootstrap-owned-1" } } }))
    fs.writeFileSync(path.join(root, "invoke.ps1"), "# fake")
    const commandRunner = vi.fn(async ({ command, args }: { command: string; args: string[] }) => {
      if (command === "git") return { code: 0, stderr: "", stdout: `${path.join(workspacePath, ".git")}\n` }
      const runId = args[args.indexOf("-RunId") + 1]
      // No fenced ```json block at all — only the completion marker.
      return { code: 0, stderr: "", stdout: `working\nHERMES_FREE_AGENT_COMPLETE runId=${runId} workspace=${workspacePath}\n` }
    })
    let merged = false
    const lifecycle = {
      refreshOriginMain: vi.fn(async () => "a".repeat(40)),
      ensureOwnedWorktree: vi.fn(async ({ branch }: { branch: string }) => ({
        branch,
        worktreePath: workspacePath,
      })),
      discoverPullRequest: vi.fn(async () => null),
      inspectPullRequest: vi.fn(async () => ({
        state: merged ? "MERGED" : "OPEN",
        baseRefName: "main",
        isDraft: false,
        checksGreen: true,
        checksComplete: true,
        failedChecks: [],
        reviewed: true,
        reviewCompleted: true,
        reviewRequested: true,
        codexReviewFindings: [],
        unresolvedThreadCount: 0,
        headRefOid: commit,
        mergeCommit: merged ? { oid: mergeSha } : null,
      })),
      inspectChangedPaths: vi.fn(async () => changedPaths),
      inspectWorkingTreePaths: vi.fn(async () => changedPaths),
      inspectWorktreeHead: vi.fn(async () => commit),
      ensureValidationDependencies: vi.fn(() => ({ linked: true })),
      removeValidationDependencies: vi.fn(() => ({ removed: true })),
      runValidationCommands: vi.fn(async ({ commands }: { commands: Array<{ command: string; args: string[] }> }) =>
        commands.map(({ command, args }) => ({ command, args, code: 0 }))),
      commitChanges: vi.fn(async () => ({
        commit,
        branch: "codex/wos-v1-1-continuity-recovery",
        paths: changedPaths,
      })),
      pushBranch: vi.fn(async () => ({ pushed: true })),
      createPullRequest: vi.fn(async () => ({
        number: prNumber,
        url: `https://github.com/bsvalues/terragroq/pull/${prNumber}`,
      })),
      requestCodexReview: vi.fn(async () => ({ requested: true })),
      inspectReviewFindings: vi.fn(async () => []),
      resolveReviewThreads: vi.fn(async () => ({ resolved: 0 })),
      inspectPullRequestFiles: vi.fn(async () => changedPaths),
      mergePullRequest: vi.fn(async () => {
        merged = true
        return { merged: true }
      }),
      verifyOriginMainContains: vi.fn(async () => true),
      cleanupOwnedWorktree: vi.fn(async () => ({ cleaned: true })),
    } as any
    const markComplete = vi.fn(async () => true)
    const orchestrator = createHermesOrchestrator({
      workspace: process.cwd(), runtimeRoot: root, state: createHermesStateStore(path.join(root, "state", "state.json"), { now: () => clock }),
      lifecycle, selectOutcome: vi.fn(async () => outcome()), markComplete, markTerminal: vi.fn(async () => true), deferOutcome: vi.fn(async () => true),
      projectCheckpoint, projectLease,
      clientFactory: (worktreePath: string) => createHermesKernelClient({ workspacePath: worktreePath, runtimeRoot: root, commandRunner, policyPath, invokerPath: path.join(root, "invoke.ps1"), now, powershellCommand: "powershell" }),
      holderId: "resident-kernel", now, sleep: async () => {}, leaseRenewalIntervalMs: 60 * 60 * 1000,
    })
    await expect(orchestrator.cycle()).rejects.toMatchObject({ code: "APP_SERVER_TURN_FAILED" })
  })
})
