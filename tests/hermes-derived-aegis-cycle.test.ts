import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AegisExecutionBackend } from "../scripts/hermes-bridge/execution-backend.mjs"
import { createHermesOrchestrator } from "../scripts/hermes-bridge/orchestrator.mjs"
import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"
import {
  acquireNextEligibleOutcome,
  OUTCOME_QUEUE_SQL,
} from "../scripts/hermes-bridge/outcome-queue-source.mjs"
import { createHermesStateStore } from "../scripts/hermes-bridge/state-store.mjs"

const roots: string[] = []
const now = new Date("2026-08-20T18:00:00.000Z")
const ownerTouchCounters = {
  OWNER_OPERATION_TOUCH_COUNT: 0,
  OWNER_CREDENTIAL_TOUCH_COUNT: 0,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
  OWNER_ROUTINE_DECISION_COUNT: 0,
  OWNER_ROUTINE_CONTACT_COUNT: 0,
}

const canonicalJson = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  : JSON.stringify(value)

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("derived finding through the governed AEGIS cycle", { timeout: 30_000 }, () => {
  it("preserves the exact receipt-bound child graph through reviewed completion", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-derived-aegis-"))
    roots.push(runtimeRoot)
    fs.mkdirSync(path.join(runtimeRoot, "control"), { recursive: true })
    fs.writeFileSync(path.join(runtimeRoot, "control", "activation"), "enabled\n")
    fs.writeFileSync(path.join(runtimeRoot, "control", "authority-not-before"), "2026-08-20T00:00:00.000Z\n")

    const sourceEventId = 101
    const childWorkOrderId = 201
    const childGoalId = 202
    const queueId = 203
    const decisionId = 204
    const implementationGrantId = 205
    const receiptId = 206
    const queueGrantId = 207
    const childWorkOrderRef = "WO-HERMES-OUTCOME-4-R01-F101"
    const childGoalRef = "GOAL-RUNTIME-FINDING-101"
    const outcomeKey = `runtime-finding:${sourceEventId}:${"a".repeat(64)}`
    const queueGrantRef = "RUNTIME-FINDING-QUEUE-GRANT-101"
    const implementationGrantRef = "RUNTIME-FINDING-IMPL-GRANT-101"
    const changedPaths = ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"]
    const contractBody = {
      version: "hermes-work-contract.v1",
      id: "runtime-finding.101.v1",
      repository: "bsvalues/terragroq",
      lane: "docs",
      reservations: changedPaths,
      validationCommands: [{ command: "git", args: ["diff", "--check"], timeoutMs: 300_000 }],
      projection: { issueNumber: 911, completionOwned: false },
      delivery: {
        authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
        commitAllowed: true, tagAllowed: false, pushAllowed: true,
      },
    }
    const contract = {
      ...contractBody,
      digest: createHash("sha256").update(JSON.stringify(contractBody)).digest("hex"),
    }
    const requestBinding = {
      operation: "runtime_finding.derive", sourceFindingEventId: sourceEventId,
      sourcePayloadDigest: "a".repeat(64), sourceCheckpointId: 91,
      sourceCheckpointDigest: "b".repeat(64), parentWorkOrderId: 4,
      parentWorkOrderRef: "WO-HERMES-OUTCOME-4", parentContractId: "parent.v1",
      parentContractDigest: "c".repeat(64), parentAuthorizationDecisionId: 74,
      parentImplementationGrantId: 81,
    }
    const resultBinding = {
      outcomeKey, goalId: childGoalId, goalRef: childGoalRef, queueId,
      workOrderId: childWorkOrderId, workOrderRef: childWorkOrderRef,
      decisionId, approvalDecisionId: decisionId,
      grantId: queueGrantId, grantRef: queueGrantRef,
      queueGrantId, queueGrantRef, implementationGrantId, implementationGrantRef,
      workContract: contract,
    }
    const queue = {
      id: queueId, userId: "primary-user", outcomeKey, goalId: childGoalId,
      goalRef: childGoalRef, title: "Reconcile compose drift", objective: "Reconcile compose drift",
      riskClass: "R1", priority: 100, orderKey: 100, dependencies: [],
      approvalState: "approved", authorityState: "matched", lifecycleState: "approved",
      authorityLevel: "A2_WRITE_OWN", authoritySubject: "operator",
      authorityAction: "outcome:execute", approvalDecisionId: decisionId,
      authorityGrantRef: queueGrantRef, activeWorkOrderId: childWorkOrderId,
      version: 0, fencingToken: 0,
    } as any
    const goalRow = {
      id: childGoalId, userId: "primary-user", ref: childGoalRef,
      command: "Reconcile compose drift", lane: "docs", mode: "implementation", risk: "R1",
      authority: "A2_WRITE_OWN", verdict: "allow", requiresApproval: false,
      matchedRules: ["runtime_finding.derive"], status: "classified",
      derivedReceiptOperation: "runtime_finding.derive",
      derivedRequestHash: createHash("sha256").update(canonicalJson(requestBinding)).digest("hex"),
      derivedRequestBinding: Object.fromEntries(Object.entries(requestBinding).reverse()),
      derivedResultBinding: resultBinding,
      derivedWorkOrderId: childWorkOrderId, derivedWorkOrderRef: childWorkOrderRef,
      derivedWorkOrderUserId: "primary-user", derivedWorkOrderGoal: childGoalRef,
      derivedWorkOrderAuthorityGrantId: implementationGrantId, derivedWorkOrderStatus: "approved",
      derivedApprovalDecisionId: decisionId, derivedApprovalStatus: "accepted",
      derivedApprovalAuthority: "binding", derivedApprovalScope: outcomeKey,
      derivedApprovalLocked: true, derivedApprovalDecision: "APPROVE",
      derivedApprovalEvidence: [`runtime-finding:${sourceEventId}`],
      derivedQueueGrantId: queueGrantId, derivedQueueGrantRef: queueGrantRef,
      derivedQueueGrantStatus: "active", derivedQueueGrantRevokedAt: null,
      derivedQueueGrantExpiresAt: "2099-01-01T00:00:00.000Z",
      derivedQueueGrantGrantedTo: "operator", derivedQueueGrantAuthorityLevel: "A2_WRITE_OWN",
      derivedQueueGrantScope: outcomeKey, derivedQueueGrantWorkOrderId: childWorkOrderId,
      derivedQueueGrantAllowedActions: ["outcome:execute"],
      derivedQueueGrantBlockedActions: ["host-storage-mutation"],
      derivedImplementationGrantId: implementationGrantId,
      derivedImplementationGrantRef: implementationGrantRef,
      derivedImplementationGrantStatus: "active", derivedImplementationGrantRevokedAt: null,
      derivedImplementationGrantExpiresAt: "2099-01-01T00:00:00.000Z",
      derivedImplementationGrantGrantedTo: "operator",
      derivedImplementationGrantAuthorityLevel: "A2_WRITE_OWN",
      derivedImplementationGrantScope: childWorkOrderRef,
      derivedImplementationGrantWorkOrderId: childWorkOrderId,
      derivedImplementationGrantAllowedActions: ["implement"],
      derivedImplementationGrantBlockedActions: ["host-storage-mutation"],
      derivedSourceFindingEventId: sourceEventId, derivedSourceUserId: "primary-user",
      derivedSourcePayloadDigest: requestBinding.sourcePayloadDigest,
      derivedSourceCheckpointId: requestBinding.sourceCheckpointId,
      derivedSourceCheckpointDigest: requestBinding.sourceCheckpointDigest,
      derivedSourceParentWorkOrderRef: requestBinding.parentWorkOrderRef,
      derivedSourceParentContractId: requestBinding.parentContractId,
      derivedSourceParentContractDigest: requestBinding.parentContractDigest,
      derivedSourceAuthorizationDecisionId: requestBinding.parentAuthorizationDecisionId,
      derivedSourceImplementationGrantId: requestBinding.parentImplementationGrantId,
      derivedParentWorkOrderId: requestBinding.parentWorkOrderId,
      derivedParentWorkOrderRef: requestBinding.parentWorkOrderRef,
      derivedParentWorkOrderUserId: "primary-user",
    }

    const acquisitionQuery = vi.fn(async (sql: string, values: any[] = []) => {
      if (["BEGIN", "COMMIT", "ROLLBACK", OUTCOME_QUEUE_SQL.acquireLock].includes(sql)) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readAcquisitionReceipt || sql === OUTCOME_QUEUE_SQL.readAcquisition) {
        return { rows: [] }
      }
      if (sql === OUTCOME_QUEUE_SQL.acquire) {
        Object.assign(queue, {
          lifecycleState: "active", version: 1, fencingToken: 1,
          acquisitionKey: values[2], executionBinding: values[3], leaseHolder: values[4],
          leaseToken: values[5], leaseExpiresAt: values[6],
        })
        return { rows: [{ ...queue }] }
      }
      if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionReceipt) return { rows: [{ id: 301 }] }
      if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt) return { rows: [{ id: 302 }] }
      throw new Error(`unexpected acquisition query: ${sql.slice(0, 80)}`)
    })
    const acquisitionClient = { query: acquisitionQuery, release: vi.fn() }
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes("FROM goal")) return { rows: [goalRow] }
      throw new Error(`unexpected pool query: ${sql.slice(0, 80)}`)
    })
    const completeQueue = vi.fn(async (input: any) => {
      expect(input).toMatchObject({
        userId: "primary-user", outcomeKey, activeWorkOrderId: childWorkOrderId,
        authorityGrantRef: queueGrantRef,
      })
      Object.assign(queue, { lifecycleState: "completed", leaseHolder: null, leaseToken: null, leaseExpiresAt: null })
      return { outcome: { ...queue }, replayed: false }
    })
    const completeGoal = vi.fn(async (input: any) => {
      expect(input).toMatchObject({ outcomeId: childGoalId })
      return true
    })
    const queueRuntime = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://fixture", holderId: "resident-hermes",
      campaignWindowId: "campaign-v1-2", processIdentity: "supervisor-nonce-1",
      now: () => now, resolvePrimary: vi.fn(async () => ({ id: "primary-user" })),
      createPool: vi.fn(async () => ({ query: poolQuery, end: vi.fn(), on: vi.fn() })),
      acquire: (input: Record<string, unknown>) => acquireNextEligibleOutcome({
        ...input, query: Object.assign(acquisitionQuery, { connect: async () => acquisitionClient }),
      }),
      checkpointProofProvider: vi.fn(async ({ outcome }: any) => ({
        outcomeId: String(outcome.goalId), outcomeKey: outcome.outcomeKey,
        workOrderId: outcome.activeWorkOrderId, fencingToken: outcome.fencingToken,
        sequence: 0, state: "LEASED",
        commit: { headSha: null, mergeSha: null, prNumber: null },
      })),
      ensureQueueSchema: vi.fn(async () => true),
      verifyQueueWorkOrder: vi.fn(async () => ({ ...queue })),
      completeQueue, completeGoal,
      consumeRuntimeFindings: vi.fn(async () => ({ queuedChildren: 0 })),
    })

    const sshCalls: any[] = []
    const turnPrompts: string[] = []
    const client = {
      connect: vi.fn(async () => {}),
      startThread: vi.fn(async () => "thread-derived-101"),
      resumeThread: vi.fn(async () => "thread-derived-101"),
      runTurn: vi.fn(async ({ prompt }: { prompt: string }) => {
        turnPrompts.push(prompt)
        const branch = prompt.match(/codex\/[a-z0-9-]+/)?.[0] ?? "codex/hermes-goal-runtime-finding-101-202"
        return {
          threadId: "thread-derived-101", turnId: "turn-derived-101", status: "completed",
          finalText: JSON.stringify({
            result: "READY_FOR_VALIDATION", workOrder: childWorkOrderRef, branch,
            commit: null, prUrl: null, merged: false, mergeCommit: null,
            validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0,
            blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE",
            blockedAction: null, authorityBoundary: null, minimumChoice: null,
            approveConsequence: null, denyConsequence: null,
          }),
        }
      }),
      close: vi.fn(async () => {}),
    }
    const backend = new AegisExecutionBackend({
      host: "aegis-worker", runtimeRoot: "/worker/runtime", repositoryRoot: "/worker/repo",
      clientFactory: vi.fn(async () => client),
      commandRunner: vi.fn(async (call: any) => {
        sshCalls.push(call)
        return { code: 0, stdout: "", stderr: "" }
      }),
    })
    const runAppServer = vi.spyOn(backend, "runCodexClient")
    let merged = false
    const commit = "d".repeat(40)
    const mergeSha = "e".repeat(40)
    const prNumber = 991
    const validationSeen: any[] = []
    const lifecycle = {
      refreshOriginMain: vi.fn(async () => "f".repeat(40)),
      ensureOwnedWorktree: vi.fn(async ({ branch, baseSha }: any) => {
        const prepared = await backend.prepareWorkspace({ branch, baseSha, repository: "bsvalues/terragroq" })
        expect(prepared.workspacePath).toMatch(/^\/worker\/runtime\/worktrees\//)
        return { branch, worktreePath: prepared.workspacePath }
      }),
      resumeOwnedWorktree: vi.fn(), discoverPullRequest: vi.fn(async () => null),
      inspectPullRequest: vi.fn(async () => ({
        state: merged ? "MERGED" : "OPEN", baseRefName: "main", isDraft: false,
        checksGreen: true, checksComplete: true, failedChecks: [], reviewed: true,
        reviewCompleted: true, reviewRequested: true, codexReviewFindings: [],
        unresolvedThreadCount: 0, headRefOid: commit,
        mergeCommit: merged ? { oid: mergeSha } : null,
      })),
      inspectChangedPaths: vi.fn(async () => changedPaths),
      inspectWorkingTreePaths: vi.fn(async () => changedPaths),
      inspectWorktreeHead: vi.fn(async () => commit),
      ensureValidationDependencies: vi.fn(async () => ({ linked: false })),
      removeValidationDependencies: vi.fn(async () => ({ removed: false })),
      runValidationCommands: vi.fn(async ({ worktreePath, commands }: any) => {
        validationSeen.push(...commands)
        const results = await backend.validate({ workspacePath: worktreePath, commands })
        return results.map((result: any, index: number) => ({
          command: commands[index].command, args: commands[index].args, code: result.exitCode,
        }))
      }),
      commitChanges: vi.fn(async ({ worktreePath, branch }: any) => {
        await backend.git({ workspacePath: worktreePath, args: ["status", "--short"] })
        return { commit, branch, paths: changedPaths }
      }),
      pushBranch: vi.fn(async ({ worktreePath, branch }: any) => {
        await backend.git({ workspacePath: worktreePath, args: ["push", "origin", branch] })
        return { pushed: true }
      }),
      createPullRequest: vi.fn(async () => ({
        number: prNumber, url: `https://github.com/bsvalues/terragroq/pull/${prNumber}`,
      })),
      requestCodexReview: vi.fn(async () => ({ requested: true })),
      inspectReviewFindings: vi.fn(async () => []),
      resolveReviewThreads: vi.fn(async () => ({ resolved: 0 })),
      inspectPullRequestFiles: vi.fn(async () => changedPaths),
      mergePullRequest: vi.fn(async () => { merged = true; return { merged: true } }),
      verifyOriginMainContains: vi.fn(async () => true),
      cleanupOwnedWorktree: vi.fn(async ({ worktreePath }: any) => {
        await backend.cleanup({ workspacePath: worktreePath })
        return { cleaned: true }
      }),
    }
    const projected: any[] = []
    const state = createHermesStateStore(path.join(runtimeRoot, "state", "state.json"), { now: () => now.getTime() })
    const orchestrator = createHermesOrchestrator({
      workspace: process.cwd(), runtimeRoot,
      state,
      lifecycle, executionBackend: backend, selectOutcome: queueRuntime.selectOutcome,
      markComplete: queueRuntime.completeOutcome, markTerminal: queueRuntime.terminalizeOutcome,
      deferOutcome: queueRuntime.deferOutcome, bindQueueWorkOrder: queueRuntime.bindWorkOrder,
      refreshQueueOutcome: vi.fn(async (outcome: any) => outcome),
      projectCheckpoint: vi.fn(async (input: any) => {
        projected.push(input)
        expect(input).toMatchObject({
          outcomeId: childGoalId, workContract: { id: contract.id, digest: contract.digest },
          executionBinding: { outcomeKey },
        })
        return { workOrderId: childWorkOrderId, workOrderRef: childWorkOrderRef, status: "approved" }
      }),
      projectLease: vi.fn(async () => ({ workOrderId: childWorkOrderId })),
      holderId: "resident-hermes", now: () => now, sleep: async () => {},
      leaseRenewalIntervalMs: 60 * 60 * 1000,
    })

    await expect(orchestrator.cycle()).resolves.toEqual({
      result: "COMPLETE", outcomeId: String(childGoalId), prNumber, mergeSha, changedPaths,
    })
    expect(runAppServer).toHaveBeenCalledOnce()
    expect(turnPrompts).toHaveLength(1)
    expect(turnPrompts[0]).toContain(childWorkOrderRef)
    expect(validationSeen).toEqual(contract.validationCommands)
    expect(projected.length).toBeGreaterThan(0)
    expect(completeQueue).toHaveBeenCalledOnce()
    expect(completeGoal).toHaveBeenCalledOnce()
    expect(queue.lifecycleState).toBe("completed")
    expect(state.read().ownerTouchCounters).toEqual(ownerTouchCounters)
    const trace = JSON.stringify({ sshCalls, validationSeen }).toLowerCase()
    expect(trace).not.toMatch(/codex exec|runtime-operator|hermes-kernel|issue\s*#?357|\b#357\b/)
    expect(sshCalls.every((call) => call.command === "ssh")).toBe(true)
    expect({ childWorkOrderId, childGoalId, queueId, decisionId, implementationGrantId, receiptId, queueGrantId })
      .toEqual({ childWorkOrderId: 201, childGoalId: 202, queueId: 203, decisionId: 204,
        implementationGrantId: 205, receiptId: 206, queueGrantId: 207 })
    await queueRuntime.close()
  })
})
