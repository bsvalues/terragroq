import { describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"

import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"
import {
  acquireNextEligibleOutcome,
  OUTCOME_QUEUE_SQL,
} from "../scripts/hermes-bridge/outcome-queue-source.mjs"
import {
  checkpointRecordMatchesAttempt,
} from "../scripts/hermes-bridge/v1-2-acceptance-campaign.mjs"
import { resolveHermesWorkContract } from "../scripts/hermes-bridge/work-contract.mjs"

const canonicalJson = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  : JSON.stringify(value)

const queueItem = {
  userId: "primary-user",
  outcomeKey: "outcome:home-radar",
  goalId: 77,
  goalRef: "GOAL-0077",
  version: 4,
  executionBinding: "execution-77",
  leaseHolder: "resident-hermes",
  leaseToken: "lease-77",
  fencingToken: 3,
  acquisitionKey: "acquisition-77",
}

const goal = {
  id: 77,
  userId: "primary-user",
  ref: "GOAL-0077",
  command: "Improve the WilliamOS Home radar",
  lane: "ui",
  mode: "implementation",
  risk: "R1",
  authority: "A2_WRITE_OWN",
  verdict: "allow",
  requiresApproval: false,
  matchedRules: [],
  status: "classified",
}

function runtime(overrides: Record<string, unknown> = {}) {
  return createHermesOutcomeQueueRuntime({
    databaseUrl: "postgresql://not-used",
    holderId: "resident-hermes",
    campaignWindowId: "campaign-v1-2",
    processIdentity: "supervisor-nonce-1",
    checkpointProofProvider: vi.fn(async ({ outcome }) => ({
      outcomeId: String(outcome.goalId),
      outcomeKey: outcome.outcomeKey,
      workOrderId: outcome.activeWorkOrderId ?? null,
      fencingToken: outcome.fencingToken,
      sequence: 0,
      state: "LEASED",
      commit: { headSha: null, mergeSha: null, prNumber: null },
    })),
    now: () => new Date("2026-07-28T12:00:00.000Z"),
    resolvePrimary: vi.fn(async () => ({ id: "primary-user" })),
    resolveGoal: vi.fn(async () => goal),
    acquire: vi.fn(async () => ({
      outcome: queueItem,
      acquired: true,
      replayed: false,
      reclaimed: false,
      reason: null,
    })),
    bindQueueWorkOrder: vi.fn(async () => queueItem),
    verifyQueueWorkOrder: vi.fn(async ({ activeWorkOrderId }) => ({
      ...queueItem,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      activeWorkOrderId,
    })),
    completeGoal: vi.fn(async () => true),
    completeQueue: vi.fn(async () => ({ outcome: { lifecycleState: "completed" }, replayed: false })),
    terminalizeGoal: vi.fn(async () => true),
    transitionQueue: vi.fn(async () => ({ lifecycleState: "blocked" })),
    deferGoal: vi.fn(async () => true),
    deferQueue: vi.fn(async () => queueItem),
    readQueue: vi.fn(async () => []),
    verifyActiveReviewRecovery: vi.fn(async () => true),
    resumeQueue: vi.fn(async () => ({ ...queueItem, version: 5, fencingToken: 4 })),
    renewQueue: vi.fn(async () => queueItem),
    ...overrides,
  })
}

describe("Hermes durable outcome queue runtime", () => {
  it("loads the exact registered #911 parent contract across UTC and Los Angeles grant decodes", async () => {
    const command = "record structured #911 reliability remediation without host mutation"
    const outcomeKey = "goal:GOAL-0007"
    const workOrderRef = "WO-HERMES-OUTCOME-7"
    const contract = resolveHermesWorkContract({
      command, title: command, objective: command,
      lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
    })!
    const requestBinding = {
      projectId: 7, threadId: "thread-7", outcomeKey,
      idempotencyKey: "workbench-execution:stable-0007", confirmation: "START_WORK",
    }
    const requestHash = createHash("sha256").update(canonicalJson({
      contract: "workbench-execution-authorization.v1", ...requestBinding,
    })).digest("hex")
    const expiresAt = "2099-08-23T18:00:00.000Z"
    const priorTimezone = process.env.TZ
    let utcDecodedExpiry: Date
    let losAngelesDecodedExpiry: Date
    try {
      process.env.TZ = "UTC"
      utcDecodedExpiry = new Date("2099-08-23T18:00:00.000")
      process.env.TZ = "America/Los_Angeles"
      losAngelesDecodedExpiry = new Date("2099-08-23T18:00:00.000")
    } finally {
      if (priorTimezone === undefined) delete process.env.TZ
      else process.env.TZ = priorTimezone
    }
    expect(utcDecodedExpiry.toISOString()).toBe(expiresAt)
    expect(losAngelesDecodedExpiry.toISOString()).toBe("2099-08-24T01:00:00.000Z")
    const resultBinding = {
      decisionId: 31, decisionRef: "WB-EXEC-DEC-911", grantId: 41,
      grantRef: "WB-EXEC-GRANT-911", implementationGrantId: 42,
      implementationGrantRef: "WB-EXEC-IMPL-GRANT-911", queueVersion: 1,
      authorizedAt: "2026-08-20T18:00:00.000Z", expiresAt, workContract: contract,
    }
    const parentQueue = {
      ...queueItem, id: 7, outcomeKey, goalId: 7, goalRef: "GOAL-0007",
      approvalDecisionId: 31, authorityGrantRef: resultBinding.grantRef,
      objective: command, title: command, activeWorkOrderId: null,
    }
    const parentGoal = {
      ...goal, id: 7, ref: "GOAL-0007", command, lane: "operator-objective",
      verdict: "requires_approval", requiresApproval: true,
    }
    const parentAuthorization = {
      receiptOperation: "workbench_execution.authorize", requestHash,
      requestBinding, resultBinding,
      projectId: 7, projectUserId: "primary-user", projectLifecycle: "active",
      threadId: "thread-7", threadUserId: "primary-user", threadProjectId: 7,
      rootCount: 1, rootThreadId: "thread-7",
      primaryRepoCount: 1, primaryRepository: "bsvalues/terragroq",
      approvalId: 31, approvalRef: resultBinding.decisionRef, approvalUserId: "primary-user",
      approvalStatus: "accepted", approvalAuthority: "binding", approvalOwner: "primary-user",
      approvalScope: outcomeKey, approvalLocked: true, approvalDecision: "APPROVE",
      approvalEvidence: [
        "project:7", "thread:thread-7", "repo:bsvalues/terragroq",
        `work-contract:${contract.id}`, `work-contract-digest:${contract.digest}`,
        `work-contract-json:${JSON.stringify(contract)}`,
        ...contract.reservations.map((value) => `reservation:${value}`),
        ...contract.validationCommands.map((value) => `validator:${value.command}:${value.args.join(" ")}`),
      ],
      approvalTags: ["workbench", "outcome", "explicit-start-work"],
      queueGrantId: 41, queueGrantRef: resultBinding.grantRef, queueGrantUserId: "primary-user",
      queueGrantStatus: "active", queueGrantRevokedAt: null,
      queueGrantExpiresAt: utcDecodedExpiry,
      queueGrantExpiresAtEpoch: "4091191200",
      queueGrantGrantedBy: "primary-user", queueGrantGrantedTo: "operator", queueGrantAuthorityLevel: "A2_WRITE_OWN",
      queueGrantScope: outcomeKey, queueGrantWorkOrderId: null,
      queueGrantAllowedActions: ["outcome:execute"],
      queueGrantBlockedActions: ["production:mutate", "release:create", "secret:access", "spend:increase"],
      implementationGrantId: 42, implementationGrantRef: resultBinding.implementationGrantRef,
      implementationGrantUserId: "primary-user", implementationGrantStatus: "active",
      implementationGrantRevokedAt: null,
      implementationGrantExpiresAt: utcDecodedExpiry,
      implementationGrantExpiresAtEpoch: "4091191200",
      implementationGrantGrantedBy: "primary-user", implementationGrantGrantedTo: "operator", implementationGrantAuthorityLevel: "A2_WRITE_OWN",
      implementationGrantScope: workOrderRef, implementationGrantWorkOrderId: null,
      implementationGrantAllowedActions: ["implement"],
      implementationGrantBlockedActions: ["production:mutate", "release:create", "secret:access", "spend:increase"],
    }
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [parentGoal] })
      .mockResolvedValueOnce({ rows: [parentAuthorization] })
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "not-used", campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1", checkpointProofProvider: vi.fn(),
      createPool: vi.fn(async () => ({ query, end: vi.fn(), on: vi.fn() })),
      acquire: vi.fn(async () => ({ outcome: parentQueue, acquired: true })),
    })

    await expect(bridge.selectOutcome()).resolves.toMatchObject({
      id: 7, lane: "operator-objective", outcomeKey,
      verifiedQueueWorkContract: {
        contract,
        provenance: { operation: "workbench_execution.authorize", outcomeKey, workOrderRef },
      },
    })

    const losAngelesDecodedAuthorization = {
      ...parentAuthorization,
      queueGrantExpiresAt: losAngelesDecodedExpiry,
      implementationGrantExpiresAt: losAngelesDecodedExpiry,
    }
    const losAngelesQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [parentGoal] })
      .mockResolvedValueOnce({ rows: [losAngelesDecodedAuthorization] })
    const losAngelesBridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "not-used", campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1", checkpointProofProvider: vi.fn(),
      createPool: vi.fn(async () => ({ query: losAngelesQuery, end: vi.fn(), on: vi.fn() })),
      acquire: vi.fn(async () => ({ outcome: parentQueue, acquired: true })),
    })
    await expect(losAngelesBridge.selectOutcome()).resolves.toMatchObject({
      id: 7, lane: "operator-objective", outcomeKey,
      verifiedQueueWorkContract: {
        contract,
        provenance: { operation: "workbench_execution.authorize", outcomeKey, workOrderRef },
      },
    })

    for (const drifted of [
      { ...parentAuthorization, requestHash: "0".repeat(64) },
      { ...parentAuthorization, resultBinding: { ...resultBinding, queueVersion: 2 } },
      { ...parentAuthorization, projectLifecycle: "archived" },
      { ...parentAuthorization, threadProjectId: 8 },
      { ...parentAuthorization, rootCount: 2 },
      { ...parentAuthorization, rootThreadId: "thread-other" },
      { ...parentAuthorization, primaryRepository: "bsvalues/other" },
      { ...parentAuthorization, approvalOwner: "foreign" },
      { ...parentAuthorization, approvalEvidence: ["work-contract:forged"] },
      { ...parentAuthorization, approvalTags: ["workbench"] },
      { ...parentAuthorization, queueGrantRef: "WB-EXEC-GRANT-DRIFTED" },
      { ...parentAuthorization, queueGrantBlockedActions: ["outcome:execute"] },
      { ...parentAuthorization, implementationGrantRevokedAt: "2026-08-20T19:00:00.000Z" },
      { ...parentAuthorization, implementationGrantAllowedActions: ["outcome:execute"] },
      { ...parentAuthorization, implementationGrantScope: "WO-HERMES-OUTCOME-999" },
    ]) {
      const driftQuery = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
        .mockResolvedValueOnce({ rows: [parentGoal] })
        .mockResolvedValueOnce({ rows: [drifted] })
      const driftBridge = createHermesOutcomeQueueRuntime({
        databaseUrl: "not-used", campaignWindowId: "campaign-v1-2",
        processIdentity: "supervisor-nonce-1", checkpointProofProvider: vi.fn(),
        createPool: vi.fn(async () => ({ query: driftQuery, end: vi.fn(), on: vi.fn() })),
        acquire: vi.fn(async () => ({ outcome: parentQueue, acquired: true })),
      })
      await expect(driftBridge.selectOutcome())
        .rejects.toMatchObject({ code: "HERMES_WORKBENCH_PARENT_CONTRACT_WALL" })
    }
  })

  it("loads an arbitrary derived child contract from its exact receipt", async () => {
    const contractBody = {
      version: "hermes-work-contract.v1",
      id: "runtime-finding.101.v1",
      repository: "bsvalues/terragroq", lane: "docs",
      reservations: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      validationCommands: [{ command: "git", args: ["diff", "--check"], timeoutMs: 300_000 }],
      projection: { issueNumber: 911, completionOwned: false },
      delivery: {
        authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"],
        commitAllowed: true, tagAllowed: false, pushAllowed: true,
      },
    }
    const contract = {
      ...contractBody,
      digest: createHash("sha256").update(canonicalJson(contractBody)).digest("hex"),
    }
    const derivedQueue = {
      ...queueItem, id: 203,
      outcomeKey: "runtime-finding:101:source-digest", goalId: 202,
      goalRef: "GOAL-RUNTIME-FINDING-101", activeWorkOrderId: 201,
      authorityGrantRef: "RUNTIME-FINDING-QUEUE-GRANT-101", approvalDecisionId: 204,
      objective: "Reconcile compose drift", title: "Reconcile compose drift",
    }
    const derivedRequestBinding = {
      operation: "runtime_finding.derive", sourceFindingEventId: 101,
      sourcePayloadDigest: "a".repeat(64), sourceCheckpointId: 91,
      sourceCheckpointDigest: "b".repeat(64), parentWorkOrderId: 4,
      parentWorkOrderRef: "WO-HERMES-OUTCOME-4", parentContractId: "parent.v1",
      parentContractDigest: "c".repeat(64), parentAuthorizationDecisionId: 74,
      parentImplementationGrantId: 81,
    }
    const derivedResultBinding = {
      outcomeKey: derivedQueue.outcomeKey, goalId: 202, goalRef: derivedQueue.goalRef,
      queueId: 203,
      workOrderId: 201, workOrderRef: "WO-HERMES-OUTCOME-4-R01-F101",
      decisionId: 204, approvalDecisionId: 204,
      grantId: 207, grantRef: derivedQueue.authorityGrantRef,
      queueGrantId: 207, queueGrantRef: derivedQueue.authorityGrantRef,
      implementationGrantId: 205, implementationGrantRef: "RUNTIME-FINDING-IMPL-GRANT-101",
      workContract: contract,
    }
    const derivedGoal = {
      ...goal, id: 202, ref: derivedQueue.goalRef, lane: "docs",
      command: "Reconcile compose drift",
      derivedReceiptOperation: "runtime_finding.derive",
      derivedRequestHash: createHash("sha256").update(canonicalJson(derivedRequestBinding)).digest("hex"),
      derivedRequestBinding, derivedResultBinding,
      derivedWorkOrderId: 201, derivedWorkOrderRef: derivedResultBinding.workOrderRef,
      derivedWorkOrderUserId: "primary-user", derivedWorkOrderGoal: derivedQueue.goalRef,
      derivedWorkOrderAuthorityGrantId: 205, derivedWorkOrderStatus: "approved",
      derivedApprovalDecisionId: 204, derivedApprovalStatus: "accepted",
      derivedApprovalAuthority: "binding", derivedApprovalScope: derivedQueue.outcomeKey,
      derivedApprovalLocked: true, derivedApprovalDecision: "APPROVE",
      derivedApprovalEvidence: ["runtime-finding:101"],
      derivedQueueGrantId: 207, derivedQueueGrantRef: derivedQueue.authorityGrantRef,
      derivedQueueGrantStatus: "active", derivedQueueGrantRevokedAt: null,
      derivedQueueGrantExpiresAt: "2099-01-01T00:00:00.000Z",
      derivedQueueGrantGrantedTo: "operator", derivedQueueGrantAuthorityLevel: "A2_WRITE_OWN",
      derivedQueueGrantScope: derivedQueue.outcomeKey, derivedQueueGrantWorkOrderId: 201,
      derivedQueueGrantAllowedActions: ["outcome:execute"],
      derivedQueueGrantBlockedActions: ["host-storage-mutation"],
      derivedImplementationGrantId: 205,
      derivedImplementationGrantRef: derivedResultBinding.implementationGrantRef,
      derivedImplementationGrantStatus: "active", derivedImplementationGrantRevokedAt: null,
      derivedImplementationGrantExpiresAt: "2099-01-01T00:00:00.000Z",
      derivedImplementationGrantGrantedTo: "operator",
      derivedImplementationGrantAuthorityLevel: "A2_WRITE_OWN",
      derivedImplementationGrantScope: derivedResultBinding.workOrderRef,
      derivedImplementationGrantWorkOrderId: 201,
      derivedImplementationGrantAllowedActions: ["implement"],
      derivedImplementationGrantBlockedActions: ["host-storage-mutation"],
      derivedSourceFindingEventId: 101, derivedSourceUserId: "primary-user",
      derivedSourcePayloadDigest: derivedRequestBinding.sourcePayloadDigest,
      derivedSourceCheckpointId: 91,
      derivedSourceCheckpointDigest: derivedRequestBinding.sourceCheckpointDigest,
      derivedSourceParentWorkOrderRef: derivedRequestBinding.parentWorkOrderRef,
      derivedSourceParentContractId: derivedRequestBinding.parentContractId,
      derivedSourceParentContractDigest: derivedRequestBinding.parentContractDigest,
      derivedSourceAuthorizationDecisionId: 74,
      derivedSourceImplementationGrantId: 81,
      derivedParentWorkOrderId: 4, derivedParentWorkOrderRef: "WO-HERMES-OUTCOME-4",
      derivedParentWorkOrderUserId: "primary-user",
    }
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [derivedGoal] })
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used", campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1", checkpointProofProvider: vi.fn(),
      createPool: vi.fn(async () => ({ query, end: vi.fn(), on: vi.fn() })),
      acquire: vi.fn(async () => ({ outcome: derivedQueue, acquired: true })),
    })

    await expect(bridge.selectOutcome()).resolves.toMatchObject({
      id: 202,
      outcomeKey: derivedQueue.outcomeKey,
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "runtime_finding.derive", outcomeKey: derivedQueue.outcomeKey,
          workOrderId: 201, workOrderRef: "WO-HERMES-OUTCOME-4-R01-F101",
        },
      },
      queueBinding: { activeWorkOrderId: 201, outcomeKey: derivedQueue.outcomeKey },
    })

    for (const drifted of [
      { ...derivedGoal, derivedRequestHash: "d".repeat(64) },
      { ...derivedGoal, derivedWorkOrderRef: "WO-DRIFTED" },
      { ...derivedGoal, derivedApprovalDecisionId: 999 },
      { ...derivedGoal, derivedApprovalDecision: "DENY" },
      { ...derivedGoal, derivedApprovalEvidence: ["runtime-finding:999"] },
      { ...derivedGoal, derivedQueueGrantId: 999 },
      { ...derivedGoal, derivedQueueGrantBlockedActions: ["EXECUTE"] },
      { ...derivedGoal, derivedImplementationGrantRef: "IMPL-DRIFTED" },
      { ...derivedGoal, derivedImplementationGrantBlockedActions: ["PLEM"] },
      { ...derivedGoal, derivedSourcePayloadDigest: "e".repeat(64) },
      { ...derivedGoal, derivedParentWorkOrderRef: "WO-PARENT-DRIFTED" },
    ]) {
      const driftQuery = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
        .mockResolvedValueOnce({ rows: [drifted] })
      const driftBridge = createHermesOutcomeQueueRuntime({
        databaseUrl: "postgresql://not-used", campaignWindowId: "campaign-v1-2",
        processIdentity: "supervisor-nonce-1", checkpointProofProvider: vi.fn(),
        createPool: vi.fn(async () => ({ query: driftQuery, end: vi.fn(), on: vi.fn() })),
        acquire: vi.fn(async () => ({ outcome: derivedQueue, acquired: true })),
      })
      await expect(driftBridge.selectOutcome())
        .rejects.toMatchObject({ code: "HERMES_RUNTIME_FINDING_CONTRACT_WALL" })
    }

    const reorderedQuery = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [{
        ...derivedGoal,
        derivedRequestBinding: Object.fromEntries(Object.entries(derivedRequestBinding).reverse()),
      }] })
    const reorderedBridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used", campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1", checkpointProofProvider: vi.fn(),
      createPool: vi.fn(async () => ({ query: reorderedQuery, end: vi.fn(), on: vi.fn() })),
      acquire: vi.fn(async () => ({ outcome: derivedQueue, acquired: true })),
    })
    await expect(reorderedBridge.selectOutcome()).resolves.toMatchObject({ id: 202 })
  })

  it("allows read-only runtime construction without resident proof context", async () => {
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used",
      campaignWindowId: "",
      processIdentity: "",
      createPool: vi.fn(() => {
        throw new Error("read-only construction must not open the database")
      }),
    })

    await expect(bridge.close()).resolves.toBeUndefined()
  })

  it("rejects unscoped acquisition before schema or queue mutation", async () => {
    const ensureQueueSchema = vi.fn()
    const acquire = vi.fn()
    const missingCampaign = runtime({
      campaignWindowId: "",
      processIdentity: "",
      ensureQueueSchema,
      acquire,
    })

    await expect(missingCampaign.selectOutcome())
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    const missingProcess = runtime({
      campaignWindowId: "campaign-v1-2",
      processIdentity: "",
      ensureQueueSchema,
      acquire,
    })
    await expect(missingProcess.selectOutcome())
      .rejects.toMatchObject({ code: "HERMES_PROCESS_IDENTITY_REQUIRED" })
    expect(ensureQueueSchema).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it("rejects every unscoped execution entry point before queue mutation", async () => {
    const renewQueue = vi.fn()
    const acquire = vi.fn()
    const completeGoal = vi.fn()
    const terminalizeGoal = vi.fn()
    const deferGoal = vi.fn()
    const bindQueueWorkOrder = vi.fn()
    const resumeQueue = vi.fn()
    const bridge = runtime({
      campaignWindowId: "",
      processIdentity: "",
      renewQueue,
      acquire,
      completeGoal,
      terminalizeGoal,
      deferGoal,
      bindQueueWorkOrder,
      resumeQueue,
    })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({ outcomeId: "77", outcome: goal, evidence: {} }))
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.terminalizeOutcome({
      outcomeId: "77",
      outcome: goal,
      result: "FAILED_TERMINAL",
      nextState: "FAILED_TERMINAL",
      metadata: {},
    })).rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.deferOutcome({
      outcomeId: "77",
      outcome: goal,
      retryAfter: new Date("2026-07-28T12:05:00.000Z"),
    })).rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.renewOutcomeLease(outcome))
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.bindWorkOrder(outcome, 472))
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.refreshOutcome(outcome))
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.resumeAfterOwnerDecision(outcome, {}))
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    await expect(bridge.resumeAfterReviewRecovery(outcome, {}))
      .rejects.toMatchObject({ code: "HERMES_CAMPAIGN_WINDOW_REQUIRED" })
    expect(renewQueue).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
    expect(completeGoal).not.toHaveBeenCalled()
    expect(terminalizeGoal).not.toHaveBeenCalled()
    expect(deferGoal).not.toHaveBeenCalled()
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
    expect(resumeQueue).not.toHaveBeenCalled()
  })

  it("supplies canonical fresh and durable checkpoint context to the acquisition producer", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-queue-runtime-proof-"))
    const statePath = path.join(runtimeRoot, "state", "state.json")
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const observed: unknown[] = []
    const acquire = vi.fn(async (input) => {
      observed.push(await input.checkpointProofProvider({
        disposition: "WINNER",
        outcome: {
          activeWorkOrderId: null,
          fencingToken: 3,
          goalId: 77,
          outcomeKey: queueItem.outcomeKey,
        },
        processIdentity: input.processIdentity,
      }))
      return { outcome: queueItem, acquired: true }
    })
    const bridge = runtime({
      acquire,
      runtimeRoot,
      checkpointProofProvider: undefined,
    })
    try {
      await bridge.selectOutcome()
      expect(observed[0]).toEqual({
        outcomeId: "77",
        outcomeKey: queueItem.outcomeKey,
        workOrderId: null,
        fencingToken: 3,
        sequence: 0,
        state: "LEASED",
        commit: { headSha: null, mergeSha: null, prNumber: null },
      })

      fs.writeFileSync(statePath, JSON.stringify({
        schemaVersion: 1,
        storeId: "hermes-bridge",
        revision: 1,
        updatedAt: "2026-07-28T12:00:00.000Z",
        nextFencingToken: 4,
        killSwitch: { active: false, reason: null, updatedAt: null },
        ownerTouchCounters: {
          OWNER_OPERATION_TOUCH_COUNT: 0,
          OWNER_CREDENTIAL_TOUCH_COUNT: 0,
          OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
          OWNER_ROUTINE_DECISION_COUNT: 0,
          OWNER_ROUTINE_CONTACT_COUNT: 0,
        },
        executions: {
          77: {
            outcomeId: "77",
            fencingToken: 3,
            lease: {
              status: "ACTIVE",
              holderId: "resident-hermes",
              acquiredAt: "2026-07-28T12:00:00.000Z",
              expiresAt: "2026-07-28T12:50:00.000Z",
              releasedAt: null,
            },
            checkpoint: {
              sequence: 6,
              state: "COMMIT_CREATED",
              detail: null,
              recordedAt: "2026-07-28T12:10:00.000Z",
            },
            metadata: {
              headRefOid: "a".repeat(40),
              mergeSha: null,
              prNumber: 472,
              outcome: {
                queueBinding: {
                  outcomeKey: queueItem.outcomeKey,
                  activeWorkOrderId: 472,
                },
              },
            },
          },
        },
        idempotency: {},
      }))
      const durableProvider = acquire.mock.calls[0][0].checkpointProofProvider
      await expect(durableProvider({
        disposition: "REPLAY_WINNER",
        outcome: {
          activeWorkOrderId: 472,
          fencingToken: 3,
          goalId: 77,
          outcomeKey: queueItem.outcomeKey,
        },
      })).resolves.toEqual({
        outcomeId: "77",
        outcomeKey: queueItem.outcomeKey,
        workOrderId: 472,
        fencingToken: 3,
        sequence: 6,
        state: "COMMIT_CREATED",
        commit: { headSha: "a".repeat(40), mergeSha: null, prNumber: 472 },
      })
      await expect(durableProvider({
        disposition: "WINNER",
        outcome: {
          activeWorkOrderId: null,
          fencingToken: 4,
          goalId: 77,
          outcomeKey: "outcome:superseding-home-radar",
        },
      })).resolves.toEqual({
        outcomeId: "77",
        outcomeKey: "outcome:superseding-home-radar",
        workOrderId: null,
        fencingToken: 4,
        sequence: 0,
        state: "LEASED",
        commit: { headSha: null, mergeSha: null, prNumber: null },
      })
      await expect(durableProvider({
        disposition: "REPLAY_WINNER",
        outcome: {
          activeWorkOrderId: null,
          fencingToken: 3,
          goalId: 77,
          outcomeKey: queueItem.outcomeKey,
        },
      })).resolves.toEqual({
        outcomeId: "77",
        outcomeKey: queueItem.outcomeKey,
        workOrderId: null,
        fencingToken: 3,
        sequence: 6,
        state: "COMMIT_CREATED",
        commit: { headSha: "a".repeat(40), mergeSha: null, prNumber: 472 },
      })
      await expect(durableProvider({
        disposition: "REPLAY_WINNER",
        outcome: {
          activeWorkOrderId: 0,
          fencingToken: 3,
          goalId: 77,
          outcomeKey: queueItem.outcomeKey,
        },
      })).resolves.toMatchObject({ workOrderId: null })
    } finally {
      await bridge.close()
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it("carries resident identity through the real acquisition producer into checkpoint verification", async () => {
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-queue-runtime-integration-"))
    const statePath = path.join(runtimeRoot, "state", "state.json")
    fs.mkdirSync(path.dirname(statePath), { recursive: true })
    const active = {
      ...queueItem,
      activeWorkOrderId: 472,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const state = {
      schemaVersion: 1,
      storeId: "hermes-bridge",
      revision: 1,
      updatedAt: "2026-07-28T12:00:00.000Z",
      nextFencingToken: 31,
      killSwitch: { active: false, reason: null, updatedAt: null },
      ownerTouchCounters: {
        OWNER_OPERATION_TOUCH_COUNT: 0,
        OWNER_CREDENTIAL_TOUCH_COUNT: 0,
        OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
        OWNER_ROUTINE_DECISION_COUNT: 0,
        OWNER_ROUTINE_CONTACT_COUNT: 0,
      },
      executions: {
        77: {
          outcomeId: "77",
          fencingToken: 30,
          lease: {
            status: "ACTIVE",
            holderId: "resident-hermes",
            acquiredAt: "2026-07-28T12:00:00.000Z",
            expiresAt: "2026-07-28T12:50:00.000Z",
            releasedAt: null,
          },
          checkpoint: {
            sequence: 6,
            state: "COMMIT_CREATED",
            detail: null,
            recordedAt: "2026-07-28T12:10:00.000Z",
          },
          metadata: {
            headRefOid: "a".repeat(40),
            mergeSha: null,
            prNumber: 472,
            outcome: {
              queueBinding: {
                outcomeKey: queueItem.outcomeKey,
                activeWorkOrderId: 472,
                fencingToken: 3,
              },
            },
          },
        },
      },
      idempotency: {},
    }
    fs.writeFileSync(statePath, JSON.stringify(state))
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"
        || sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readAcquisitionReceipt
        || sql === OUTCOME_QUEUE_SQL.readAcquisition) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.blockExpiredIneligibleActiveSlot) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquire) {
        Object.assign(active, {
          acquisitionKey: values[2],
          executionBinding: values[3],
          leaseHolder: values[4],
          leaseToken: values[5],
          leaseExpiresAt: values[6],
        })
        return { rows: [active] }
      }
      if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionReceipt) return { rows: [{ id: 90 }] }
      if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt) return { rows: [{ id: 91 }] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const bridge = runtime({
      runtimeRoot,
      checkpointProofProvider: undefined,
      acquire: (input: Record<string, unknown>) => acquireNextEligibleOutcome({
        ...input,
        query: Object.assign(query, {
          connect: async () => ({ query, release: vi.fn() }),
        }),
      }),
    })
    try {
      await expect(bridge.selectOutcome()).resolves.toMatchObject({
        queueBinding: {
          outcomeKey: active.outcomeKey,
          activeWorkOrderId: 472,
          fencingToken: 3,
        },
      })
      const values = query.mock.calls.find(
        ([sql]) => sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
      )?.[1] as unknown[]
      const attempt = {
        id: 91,
        campaignWindowId: values[1],
        processIdentity: values[2],
        leaseHolder: values[3],
        acquisitionKeyDigest: values[4],
        leaseIdentityDigest: values[5],
        checkpointDigest: values[6],
        checkpointOutcomeId: values[7],
        checkpointSequence: values[8],
        checkpointState: values[9],
        checkpointHeadSha: values[10],
        checkpointMergeSha: values[11],
        checkpointPrNumber: values[12],
        outcomeKey: values[13],
        fencingToken: values[14],
        leaseExpiresAt: values[15],
        activeWorkOrderId: values[16],
        disposition: values[17],
        reason: values[18],
        attemptedAt: values[19],
      }
      expect(attempt).toMatchObject({
        campaignWindowId: "campaign-v1-2",
        processIdentity: "supervisor-nonce-1",
        disposition: "WINNER",
      })
      expect(checkpointRecordMatchesAttempt(attempt, [], state)).toBe(true)
      expect(JSON.stringify(attempt)).not.toContain(active.leaseToken)
      expect(JSON.stringify(attempt)).not.toContain(active.executionBinding)
      expect(JSON.stringify(attempt)).not.toContain(active.acquisitionKey)
    } finally {
      await bridge.close()
      fs.rmSync(runtimeRoot, { recursive: true, force: true })
    }
  })

  it("acquires the deterministic queue candidate and binds it to its governed goal", async () => {
    const acquire = vi.fn(async () => ({
      outcome: queueItem,
      acquired: true,
      replayed: false,
      reclaimed: false,
      reason: null,
    }))
    const bridge = runtime({ acquire })

    const selected = await bridge.selectOutcome()

    expect(selected).toMatchObject({
      id: 77,
      ref: "GOAL-0077",
      queueBinding: {
        userId: "primary-user",
        outcomeKey: "outcome:home-radar",
        expectedVersion: 4,
        executionBinding: "execution-77",
        leaseToken: "lease-77",
        fencingToken: 3,
        acquisitionKey: "acquisition-77",
      },
    })
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      leaseHolder: "resident-hermes",
      leaseDurationMs: 50 * 60 * 1000,
      campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: expect.any(Function),
    }))
  })

  it("dispatches the durable queue objective instead of the stale linked-goal command", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: {
          ...queueItem,
          title: "Add the Runtime outcome timeline",
          objective: "Show recent completed outcomes and merge evidence on Runtime.",
        },
        acquired: true,
      })),
    })

    await expect(bridge.selectOutcome()).resolves.toMatchObject({
      id: 77,
      title: "Add the Runtime outcome timeline",
      command: "Show recent completed outcomes and merge evidence on Runtime.",
      queueBinding: {
        outcomeKey: "outcome:home-radar",
        leaseHolder: "resident-hermes",
      },
    })
  })

  it("uses the durable queue title when its objective is absent", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: {
          ...queueItem,
          title: "Add the Runtime outcome timeline",
          objective: null,
        },
        acquired: true,
      })),
    })

    await expect(bridge.selectOutcome()).resolves.toMatchObject({
      command: "Add the Runtime outcome timeline",
    })
  })

  it("applies protected-scope policy to the effective durable queue command", async () => {
    const protectedItem = {
      ...queueItem,
      outcomeKey: "outcome:protected",
      title: "Deploy TerraFusion to production",
      objective: "Improve the operator read model.",
      version: 8,
    }
    const acquire = vi.fn()
      .mockResolvedValueOnce({ outcome: protectedItem, acquired: true })
      .mockResolvedValueOnce({ outcome: null, acquired: false })
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const bridge = runtime({ acquire, transitionQueue })

    await expect(bridge.selectOutcome()).resolves.toBeNull()
    expect(transitionQueue).toHaveBeenCalledWith(expect.objectContaining({
      outcomeKey: "outcome:protected",
      lifecycleReason: "HERMES_OUTCOME_QUEUE_POLICY_PROTECTED_SCOPE",
    }))
  })

  it("returns no work when the queue has no eligible acquisition", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: null,
        acquired: false,
        replayed: false,
        reclaimed: false,
        reason: "NO_READY_OUTCOME",
      })),
    })

    await expect(bridge.selectOutcome()).resolves.toBeNull()
  })

  it("uses the active-only source contract for an initial Work Order binding", async () => {
    const bindQueueWorkOrder = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      activeWorkOrderId: 472,
    }))
    const bridge = runtime({ bindQueueWorkOrder })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.bindWorkOrder(outcome, 472)).resolves.toMatchObject({
      queueBinding: {
        activeWorkOrderId: 472,
        expectedVersion: 4,
        fencingToken: 3,
      },
    })
    expect(bindQueueWorkOrder).toHaveBeenCalledOnce()
    expect(bindQueueWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
      leaseHolder: "resident-hermes",
    }))
  })

  it("rejects a missing or blank persisted queue lease holder before Work Order binding", async () => {
    const bindQueueWorkOrder = vi.fn()
    const bridge = runtime({ bindQueueWorkOrder })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        leaseHolder: " ",
        expectedVersion: queueItem.version,
      },
    }

    await expect(bridge.bindWorkOrder(outcome, 472)).rejects.toMatchObject({
      code: "HERMES_OUTCOME_QUEUE_BINDING_WALL",
    })
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
  })

  it("accepts only the exact existing canonical Work Order binding during recovery", async () => {
    const bindQueueWorkOrder = vi.fn()
    const verifyQueueWorkOrder = vi.fn(async ({ activeWorkOrderId }) => ({
      ...queueItem,
      lifecycleState: "active",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      activeWorkOrderId,
    }))
    const bridge = runtime({ bindQueueWorkOrder, verifyQueueWorkOrder })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: queueItem.version,
        activeWorkOrderId: 472,
      },
    }

    await expect(bridge.bindWorkOrder(outcome, 472, "review")).resolves.toMatchObject({
      queueBinding: { activeWorkOrderId: 472 },
    })
    expect(bindQueueWorkOrder).not.toHaveBeenCalled()
    expect(verifyQueueWorkOrder).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkOrderId: 472,
      expectedWorkOrderStatus: "review",
      leaseHolder: "resident-hermes",
    }))
    await expect(bridge.bindWorkOrder(outcome, 473)).rejects.toMatchObject({
      code: "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
    })
  })

  it("preserves an existing Work Order binding reconstructed by exact queue refresh", async () => {
    const acquire = vi.fn(async () => ({
      outcome: {
        ...queueItem,
        lifecycleState: "active",
        leaseHolder: "resident-hermes",
        activeWorkOrderId: 472,
      },
      acquired: true,
      replayed: true,
      reclaimed: false,
      reason: null,
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome)).resolves.toMatchObject({
      queueBinding: { activeWorkOrderId: 472 },
    })
  })

  it("blocks an invalid linked candidate and continues to the next eligible outcome", async () => {
    const invalid = { ...queueItem, outcomeKey: "outcome:invalid", goalId: null, version: 8 }
    const acquire = vi.fn()
      .mockResolvedValueOnce({ outcome: invalid, acquired: true })
      .mockResolvedValueOnce({ outcome: queueItem, acquired: true })
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const resolveGoal = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("invalid"), { code: "HERMES_OUTCOME_QUEUE_GOAL_WALL" }))
      .mockResolvedValueOnce(goal)
    const bridge = runtime({ acquire, transitionQueue, resolveGoal })

    await expect(bridge.selectOutcome()).resolves.toMatchObject({ id: 77 })
    expect(transitionQueue).toHaveBeenCalledWith(expect.objectContaining({
      outcomeKey: "outcome:invalid",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 8,
      lifecycleReason: "HERMES_OUTCOME_QUEUE_GOAL_WALL",
    }))
    expect(acquire).toHaveBeenCalledTimes(2)
  })

  it("does not quarantine an acquired outcome for a transient goal-read failure", async () => {
    const transitionQueue = vi.fn()
    const bridge = runtime({
      resolveGoal: vi.fn(async () => {
        throw Object.assign(new Error("database unavailable"), { code: "ECONNRESET" })
      }),
      transitionQueue,
    })

    await expect(bridge.selectOutcome()).rejects.toMatchObject({ code: "ECONNRESET" })
    expect(transitionQueue).not.toHaveBeenCalled()
  })

  it("settles the governed goal and exact queue fence after reviewed merge evidence", async () => {
    const completeGoal = vi.fn(async () => true)
    const completeQueue = vi.fn(async () => ({ outcome: { lifecycleState: "completed" }, replayed: false }))
    const bridge = runtime({ completeGoal, completeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome,
      evidence: {
        prNumber: 475,
        mergeSha: "a".repeat(40),
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).resolves.toBe(true)

    expect(completeGoal).toHaveBeenCalledWith(expect.objectContaining({ outcomeId: 77 }))
    expect(completeQueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      outcomeKey: "outcome:home-radar",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      acquisitionKey: "acquisition-77",
      terminalKey: `hermes:outcome:home-radar:3:${"a".repeat(40)}`,
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: ["EV-HERMES-77-3-14", "pr:475", `merge:${"a".repeat(40)}`],
    }))
    expect(completeQueue.mock.invocationCallOrder[0])
      .toBeLessThan(completeGoal.mock.invocationCallOrder[0])
  })

  it.each([
    ["missing", undefined],
    ["short", "a".repeat(39)],
    ["non-hex", `${"a".repeat(39)}g`],
    ["non-canonical uppercase", "A".repeat(40)],
  ])("rejects a %s merge SHA before any completion settlement", async (_label, mergeSha) => {
    const completeGoal = vi.fn(async () => true)
    const completeQueue = vi.fn()
    const bridge = runtime({ completeGoal, completeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome,
      evidence: {
        prNumber: 475,
        mergeSha,
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_MERGE_SHA_WALL" })
    expect(completeGoal).not.toHaveBeenCalled()
    expect(completeQueue).not.toHaveBeenCalled()
  })

  it("reconciles an exact queue-only completion after the queue write loses its response", async () => {
    const mergeSha = "a".repeat(40)
    const evidence = {
      prNumber: 475,
      mergeSha,
      runtimeEvidenceRef: "EV-HERMES-77-3-14",
    }
    const completeQueue = vi.fn(async () => {
      throw new Error("connection lost after commit")
    })
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "completed",
      lifecycleReason: null,
      version: 5,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "COMPLETE",
      terminalEvidenceId: null,
      terminalEvidenceRefs: [
        "EV-HERMES-77-3-14",
        `merge:${mergeSha}`,
        "pr:475",
      ],
      terminalKey: `hermes:${queueItem.outcomeKey}:3:${mergeSha}`,
      terminalAt: "2026-07-28T12:00:00.000Z",
    }])
    const bridge = runtime({ completeQueue, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.completeOutcome({ outcomeId: 77, outcome, evidence })).resolves.toBe(true)
  })

  it("moves a terminal Hermes result to a blocked queue state under the exact fence", async () => {
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const terminalizeGoal = vi.fn(async () => true)
    const bridge = runtime({ transitionQueue, terminalizeGoal })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.terminalizeOutcome({
      outcomeId: 77,
      outcome,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).resolves.toBe(true)

    expect(transitionQueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      outcomeKey: "outcome:home-radar",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      lifecycleReason: "VALIDATION_FAILED",
    }))
    expect(transitionQueue.mock.invocationCallOrder[0])
      .toBeLessThan(terminalizeGoal.mock.invocationCallOrder[0])
  })

  it("accepts an exact replay after terminal queue settlement completed before restart", async () => {
    const transitionQueue = vi.fn(async () => {
      throw Object.assign(new Error("stale"), { code: "OUTCOME_QUEUE_STALE_FENCE" })
    })
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      version: 5,
    }])
    const bridge = runtime({ transitionQueue, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.terminalizeOutcome({
      outcomeId: 77,
      outcome,
      result: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).resolves.toBe(true)
  })

  it("defers both the governed goal and exact queue lease to the retry boundary", async () => {
    const deferGoal = vi.fn(async () => true)
    const deferQueue = vi.fn(async () => queueItem)
    const bridge = runtime({ deferGoal, deferQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.deferOutcome({
      outcomeId: 77,
      outcome,
      retryAfter: "2026-07-28T12:15:00.000Z",
    })).resolves.toBe(true)
    expect(deferQueue).toHaveBeenCalledWith(expect.objectContaining({
      outcomeKey: "outcome:home-radar",
      retryAfter: "2026-07-28T12:15:00.000Z",
      lifecycleReason: "PROVIDER_UNAVAILABLE",
    }))
    expect(deferQueue.mock.invocationCallOrder[0])
      .toBeLessThan(deferGoal.mock.invocationCallOrder[0])
  })

  it("reconciles an exact queue-only provider deferral after the queue write loses its response", async () => {
    const retryAfter = "2026-07-28T12:15:00.000Z"
    const boundItem = {
      ...queueItem,
      activeWorkOrderId: 472,
    }
    const deferQueue = vi.fn(async () => {
      throw new Error("connection lost after commit")
    })
    const readQueue = vi.fn(async () => [{
      ...boundItem,
      lifecycleState: "active",
      lifecycleReason: "PROVIDER_UNAVAILABLE",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: retryAfter,
    }])
    const bridge = runtime({ deferQueue, readQueue })
    const outcome = {
      ...goal,
      queueBinding: { ...boundItem, expectedVersion: boundItem.version },
    }

    await expect(bridge.deferOutcome({ outcomeId: 77, outcome, retryAfter }))
      .resolves.toBe(true)
  })

  it("renews the exact persisted queue lease alongside the resident Hermes lease", async () => {
    const renewQueue = vi.fn(async () => queueItem)
    const bridge = runtime({ renewQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await bridge.renewOutcomeLease(outcome)

    expect(renewQueue).toHaveBeenCalledWith(expect.objectContaining({
      userId: "primary-user",
      outcomeKey: "outcome:home-radar",
      expectedVersion: 4,
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      fencingToken: 3,
      leaseDurationMs: 50 * 60 * 1000,
    }))
  })

  it("refreshes an expired persisted binding through its original acquisition identity", async () => {
    const checkpointProofProvider = vi.fn()
    const acquire = vi.fn(async (input) => {
      expect(input).toEqual({
        databaseUrl: "postgresql://not-used",
        userId: "primary-user",
        acquisitionKey: "acquisition-77",
        leaseHolder: "resident-hermes",
        leaseToken: "lease-77",
        executionBinding: "execution-77",
        leaseDurationMs: 50 * 60 * 1000,
        campaignWindowId: "campaign-v1-2",
        processIdentity: "supervisor-nonce-1",
        checkpointProofProvider,
        now: new Date("2026-07-28T12:00:00.000Z"),
      })
      return {
        outcome: {
          ...queueItem,
          title: "Add the Runtime outcome timeline",
          objective: "Show recent completed outcomes and merge evidence on Runtime.",
          version: 5,
          fencingToken: 4,
        },
        acquired: true,
        replayed: false,
        reclaimed: true,
      }
    })
    const bridge = runtime({ acquire, checkpointProofProvider })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome)).resolves.toMatchObject({
      title: "Add the Runtime outcome timeline",
      command: "Show recent completed outcomes and merge evidence on Runtime.",
      queueBinding: {
        expectedVersion: 5,
        fencingToken: 4,
        acquisitionKey: "acquisition-77",
        executionBinding: "execution-77",
        leaseToken: "lease-77",
      },
    })
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      acquisitionKey: "acquisition-77",
      executionBinding: "execution-77",
      leaseToken: "lease-77",
      leaseHolder: "resident-hermes",
    }))
  })

  it("reapplies protected-scope policy while reconciling a recovered queue command", async () => {
    const transitionQueue = vi.fn(async () => ({ lifecycleState: "blocked" }))
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: {
          ...queueItem,
          title: "Deploy TerraFusion to production",
          objective: "Improve the operator read model.",
          version: 5,
          fencingToken: 4,
        },
        acquired: true,
        reclaimed: true,
      })),
      transitionQueue,
    })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome)).rejects.toMatchObject({
      code: "HERMES_OUTCOME_QUEUE_POLICY_PROTECTED_SCOPE",
    })
    expect(transitionQueue).toHaveBeenCalledWith(expect.objectContaining({
      outcomeKey: "outcome:home-radar",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 5,
      fencingToken: 4,
      lifecycleReason: "HERMES_OUTCOME_QUEUE_POLICY_PROTECTED_SCOPE",
    }))
  })

  it("accepts an exact completed queue settlement for terminal checkpoint replay", async () => {
    const mergeSha = "a".repeat(40)
    const completed = {
      ...queueItem,
      lifecycleState: "completed",
      lifecycleReason: null,
      version: 5,
      leaseHolder: null,
      leaseToken: null,
      terminalResult: "COMPLETE",
      terminalEvidenceId: null,
      terminalEvidenceRefs: [
        "EV-HERMES-77-3-14",
        `merge:${mergeSha}`,
        "pr:475",
      ],
      terminalKey: `hermes:${queueItem.outcomeKey}:3:${mergeSha}`,
    }
    const acquire = vi.fn(async () => ({
      outcome: completed,
      acquired: false,
      replayed: true,
      reason: "OUTCOME_ALREADY_COMPLETED",
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "COMPLETE",
      evidence: {
        prNumber: 475,
        mergeSha,
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).resolves.toBe(outcome)
  })

  it("accepts an exact blocked queue settlement for terminal checkpoint replay", async () => {
    const acquire = vi.fn(async () => ({
      outcome: null,
      acquired: false,
      replayed: false,
      reason: "ONLY_BLOCKED_OUTCOMES",
    }))
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      version: 5,
      leaseHolder: null,
      leaseToken: null,
    }])
    const bridge = runtime({ acquire, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).resolves.toBe(outcome)
  })

  it("accepts an exact owner-decision blocked settlement for split replay", async () => {
    const acquire = vi.fn(async () => ({
      outcome: null,
      acquired: false,
      replayed: false,
      reason: "ONLY_BLOCKED_OUTCOMES",
    }))
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "NEW_AUTHORITY_REQUIRED",
      version: 5,
      leaseHolder: null,
      leaseToken: null,
    }])
    const bridge = runtime({ acquire, readQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })).resolves.toBe(outcome)
  })

  it("rejects an owner-decision split settlement with a mismatched fence", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: null,
        acquired: false,
        reason: "ONLY_BLOCKED_OUTCOMES",
      })),
      readQueue: vi.fn(async () => [{
        ...queueItem,
        lifecycleState: "blocked",
        lifecycleReason: "NEW_AUTHORITY_REQUIRED",
        version: 5,
        fencingToken: 4,
        leaseToken: null,
      }]),
    })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "OWNER_DECISION_REQUIRED",
      nextState: "NEW_AUTHORITY_REQUIRED",
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
  })

  it.each([
    ["completed version", { version: 6 }],
    ["completed fence", { fencingToken: 4 }],
    ["completed acquisition", { acquisitionKey: "other-acquisition" }],
    ["completed evidence", { terminalEvidenceRefs: ["pr:475"] }],
  ])("rejects a mismatched %s during terminal checkpoint refresh", async (_label, mismatch) => {
    const mergeSha = "a".repeat(40)
    const acquire = vi.fn(async () => ({
      outcome: {
        ...queueItem,
        lifecycleState: "completed",
        lifecycleReason: null,
        version: 5,
        leaseToken: null,
        terminalResult: "COMPLETE",
        terminalEvidenceId: null,
        terminalEvidenceRefs: [
          "EV-HERMES-77-3-14",
          `merge:${mergeSha}`,
          "pr:475",
        ],
        terminalKey: `hermes:${queueItem.outcomeKey}:3:${mergeSha}`,
        ...mismatch,
      },
      acquired: false,
      replayed: true,
      reason: "OUTCOME_ALREADY_COMPLETED",
    }))
    const bridge = runtime({ acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "COMPLETE",
      evidence: {
        prNumber: 475,
        mergeSha,
        runtimeEvidenceRef: "EV-HERMES-77-3-14",
      },
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
  })

  it("rejects a blocked settlement with a different terminal reason", async () => {
    const bridge = runtime({
      acquire: vi.fn(async () => ({
        outcome: null,
        acquired: false,
        reason: "ONLY_BLOCKED_OUTCOMES",
      })),
      readQueue: vi.fn(async () => [{
        ...queueItem,
        lifecycleState: "blocked",
        lifecycleReason: "REVIEW_FAILED",
        version: 5,
      }]),
    })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.refreshOutcome(outcome, {
      state: "FAILED_TERMINAL",
      nextState: "VALIDATION_FAILED",
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
  })

  it("reactivates an owner-blocked queue item under the accepted exact decision", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, {
      decisionId: 91,
      expectedNextState: "OWNER_DECISION_REQUIRED",
    })).resolves.toMatchObject({
        queueBinding: { expectedVersion: 6, fencingToken: 4 },
      })
    expect(resumeQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 5,
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-77",
    }))
  })

  it("reactivates only the exact validation-blocked queue item under persisted recovery proof", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeValidationRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: { expectedVersion: 6, fencingToken: 4 },
    })
    expect(resumeValidationRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 5,
      fencingToken: 3,
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
      expectedLifecycleReason: "VALIDATION_REMEDIATION_EXHAUSTED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-77",
    }))
  })

  it("reactivates only the exact review-blocked queue item under merged recovery proof", async () => {
    const resumeReviewRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeReviewRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      prNumber: 523,
      reviewedHeadSha: "a".repeat(40),
      mergeSha: "b".repeat(40),
      runtimeAttempt: 5,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 6,
        fencingToken: 4,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
        reviewRecoverySourceExpectedVersion: 5,
        reviewRecoverySourceFencingToken: 3,
        reviewRecoverySourceRuntimeAttempt: 5,
      },
    })
    expect(resumeReviewRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 5,
      fencingToken: 3,
      prNumber: 523,
      reviewedHeadSha: "a".repeat(40),
      mergeSha: "b".repeat(40),
      proofDigest: "d".repeat(64),
      expectedLifecycleReason: "REVIEW_REMEDIATION_EXHAUSTED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-77",
    }))
  })

  it("accepts an exact stale digest-bound review-recovery reclaim", async () => {
    const resumeReviewRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 7,
      fencingToken: 5,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      reviewRecoveryStaleReclaimApplied: true,
      reviewRecoveryReclaimCount: 1,
      reviewRecoveryReclaimEventId: 701,
      reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
    }))
    const bridge = runtime({ resumeReviewRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64), prNumber: 523,
      reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40), runtimeAttempt: 5,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 7,
        fencingToken: 5,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      },
    })
  })

  it.each([
    { proofDigest: "invalid", prNumber: 523, reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40) },
    { proofDigest: "d".repeat(64), prNumber: 0, reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40) },
    { proofDigest: "d".repeat(64), prNumber: 523, reviewedHeadSha: "short", mergeSha: "b".repeat(40) },
    { proofDigest: "d".repeat(64), prNumber: 523, reviewedHeadSha: "a".repeat(40), mergeSha: "short" },
  ])("rejects review recovery with altered proof identity", async (proof) => {
    const resumeReviewRecoveryQueue = vi.fn()
    const bridge = runtime({ resumeReviewRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      runtimeAttempt: 5,
      ...proof,
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_PROOF_WALL" })
    expect(resumeReviewRecoveryQueue).not.toHaveBeenCalled()
  })

  it("refreshes an exact persisted review recovery after a post-commit crash", async () => {
    const recovered = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      reviewRecoverySourceRuntimeAttempt: 5,
    }
    const resumeReviewRecoveryQueue = vi.fn(async () => recovered)
    const acquire = vi.fn(async () => ({ outcome: recovered, acquired: true, replayed: true }))
    const verifyActiveReviewRecovery = vi.fn(async () => true)
    const bridge = runtime({ resumeReviewRecoveryQueue, acquire, verifyActiveReviewRecovery })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      prNumber: 523,
      reviewedHeadSha: "a".repeat(40),
      mergeSha: "b".repeat(40),
      runtimeAttempt: 5,
    })).resolves.toMatchObject({ queueBinding: {
      expectedVersion: 6, fencingToken: 4,
      reviewRecoverySourceExpectedVersion: 5,
      reviewRecoverySourceFencingToken: 3,
      reviewRecoverySourceRuntimeAttempt: 5,
    } })
    expect(resumeReviewRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 6,
      fencingToken: 4,
      proofDigest: "d".repeat(64),
      persistedLifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
    }))
    expect(verifyActiveReviewRecovery).toHaveBeenCalledWith(expect.objectContaining({
      executionBinding: expect.objectContaining({ reviewRecoverySourceRuntimeAttempt: 5 }),
      proof: expect.objectContaining({ runtimeAttempt: 5 }),
    }))
    expect(acquire).toHaveBeenCalledOnce()
  })

  it.each([
    { userId: "other" },
    { outcomeKey: "goal:OTHER" },
    { executionBinding: "other-binding" },
    { acquisitionKey: "other-acquisition" },
    { leaseToken: "other-token" },
  ])("rejects an exact-delta persisted recovery with drifted durable identity", async (drift) => {
    const recovered = {
      ...queueItem, lifecycleState: "active", lifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
      approvalState: "approved", authorityState: "matched", version: 6, fencingToken: 4,
      leaseHolder: "resident-hermes", leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      reviewRecoverySourceRuntimeAttempt: 5, ...drift,
    }
    const resumeReviewRecoveryQueue = vi.fn(async () => recovered)
    const verifyActiveReviewRecovery = vi.fn(async () => true)
    const acquire = vi.fn()
    const bridge = runtime({ resumeReviewRecoveryQueue, verifyActiveReviewRecovery, acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: 6, fencingToken: 4,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED" } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED", proofDigest: "d".repeat(64),
      prNumber: 523, reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40), runtimeAttempt: 5,
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_PROOF_WALL" })
    expect(verifyActiveReviewRecovery).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it("reclaims an expired persisted review recovery only after immutable provenance and revalidates before refresh", async () => {
    const reclaimed = {
      ...queueItem, lifecycleState: "active", lifecycleReason: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      approvalState: "approved", authorityState: "matched", version: 7, fencingToken: 5,
      leaseHolder: "resident-hermes", leaseToken: "lease-77", leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      reviewRecoverySourceRuntimeAttempt: 5, reviewRecoveryStaleReclaimApplied: true,
      reviewRecoveryReclaimCount: 1, reviewRecoveryReclaimEventId: 701,
      reviewRecoveryReclaimPayloadDigest: "e".repeat(64),
    }
    const resumeReviewRecoveryQueue = vi.fn(async () => reclaimed)
    const verifyActiveReviewRecovery = vi.fn(async () => true)
    const acquire = vi.fn(async () => ({ outcome: reclaimed, acquired: true, replayed: true }))
    const bridge = runtime({ resumeReviewRecoveryQueue, verifyActiveReviewRecovery, acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: 6, fencingToken: 4,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
      reviewRecoverySourceExpectedVersion: 5, reviewRecoverySourceFencingToken: 3,
      reviewRecoverySourceRuntimeAttempt: 5 } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED", proofDigest: "d".repeat(64),
      prNumber: 523, reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40), runtimeAttempt: 5,
    })).resolves.toMatchObject({ queueBinding: {
      expectedVersion: 7, fencingToken: 5,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      reviewRecoverySourceExpectedVersion: 5, reviewRecoverySourceFencingToken: 3,
      reviewRecoverySourceRuntimeAttempt: 5, reviewRecoveryReclaimEventId: 701,
    } })
    expect(resumeReviewRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      sourceExpectedVersion: 5, sourceFencingToken: 3, sourceRuntimeAttempt: 5,
      campaignWindowId: "campaign-v1-2", processIdentity: "supervisor-nonce-1",
    }))
    expect(verifyActiveReviewRecovery.mock.invocationCallOrder[0])
      .toBeLessThan(acquire.mock.invocationCallOrder[0])
  })

  it.each([
    ["drifted", 6],
    ["missing", undefined],
  ])("walls a %s persisted source attempt before verification or refresh", async (_name, sourceAttempt) => {
    const recovered = {
      ...queueItem, lifecycleState: "active", lifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
      approvalState: "approved", authorityState: "matched", version: 6, fencingToken: 4,
      leaseHolder: "resident-hermes", leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      ...(sourceAttempt === undefined ? {} : { reviewRecoverySourceRuntimeAttempt: sourceAttempt }),
    }
    const resumeReviewRecoveryQueue = vi.fn(async () => recovered)
    const verifyActiveReviewRecovery = vi.fn(async () => true)
    const acquire = vi.fn()
    const bridge = runtime({ resumeReviewRecoveryQueue, verifyActiveReviewRecovery, acquire })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: 6, fencingToken: 4,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED" } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED", proofDigest: "d".repeat(64),
      prNumber: 523, reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40), runtimeAttempt: 5,
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_PROOF_WALL" })
    expect(verifyActiveReviewRecovery).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it("walls malformed persisted review recovery before refresh or provenance backfill", async () => {
    const recovered = {
      ...queueItem, lifecycleState: "active", lifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
      approvalState: "approved", authorityState: "matched", version: 6, fencingToken: 4,
      leaseHolder: "resident-hermes", leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      reviewRecoverySourceRuntimeAttempt: 5,
    }
    const resumeReviewRecoveryQueue = vi.fn(async () => recovered)
    const acquire = vi.fn()
    const verifyActiveReviewRecovery = vi.fn(async () => {
      throw Object.assign(new Error("drifted recovery chain"), {
        code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      })
    })
    const bridge = runtime({ resumeReviewRecoveryQueue, acquire, verifyActiveReviewRecovery })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: 6, fencingToken: 4,
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED" } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED", proofDigest: "d".repeat(64),
      prNumber: 523, reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40), runtimeAttempt: 5,
    })).rejects.toMatchObject({ code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL" })
    expect(acquire).not.toHaveBeenCalled()
    expect(outcome.queueBinding).not.toHaveProperty("reviewRecoverySourceExpectedVersion")
  })

  it("rejects a generic stale acquisition without dedicated review-recovery evidence", async () => {
    const recovered = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "STALE_LEASE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 7,
      fencingToken: 5,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      reviewRecoverySourceRuntimeAttempt: 5,
    }
    const resumeReviewRecoveryQueue = vi.fn(async () => recovered)
    const acquire = vi.fn(async () => ({ outcome: recovered, acquired: true, replayed: true }))
    const bridge = runtime({ resumeReviewRecoveryQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 7,
        fencingToken: 5,
        reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      prNumber: 523,
      reviewedHeadSha: "a".repeat(40),
      mergeSha: "b".repeat(40),
      runtimeAttempt: 5,
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_PROOF_WALL" })
    expect(resumeReviewRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 7,
      fencingToken: 5,
      persistedLifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
    }))
    expect(acquire).not.toHaveBeenCalled()
  })

  it.each([
    { lifecycleReason: "OTHER", version: 6, fencingToken: 4, outcomeKey: queueItem.outcomeKey },
    { lifecycleReason: "REVIEW_REMEDIATION_RECOVERED", version: 7, fencingToken: 4, outcomeKey: queueItem.outcomeKey },
    { lifecycleReason: "REVIEW_REMEDIATION_RECOVERED", version: 6, fencingToken: 5, outcomeKey: queueItem.outcomeKey },
    { lifecycleReason: "REVIEW_REMEDIATION_RECOVERED", version: 6, fencingToken: 4, outcomeKey: "other" },
  ])("rejects a review resume row with mismatched durable identity", async (mutation) => {
    const resumeReviewRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      approvalState: "approved",
      authorityState: "matched",
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      ...mutation,
    }))
    const bridge = runtime({ resumeReviewRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterReviewRecovery(outcome, {
      expectedNextState: "REVIEW_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64), prNumber: 523,
      reviewedHeadSha: "a".repeat(40), mergeSha: "b".repeat(40), runtimeAttempt: 5,
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_RESUME_WALL" })
  })

  it.each([
    { proofDigest: "invalid", recoveryFencingToken: 57 },
    { proofDigest: "d".repeat(64), recoveryFencingToken: 0 },
  ])("rejects validation recovery without its exact proof and original fence", async (proof) => {
    const resumeValidationRecoveryQueue = vi.fn()
    const bridge = runtime({ resumeValidationRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: proof.proofDigest,
      recoveryFencingToken: proof.recoveryFencingToken,
    })).rejects.toMatchObject({
      code: "HERMES_OUTCOME_QUEUE_VALIDATION_RECOVERY_PROOF_WALL",
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
  })

  it("accepts an exact stale validation-recovery reclaim after a post-commit crash", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 7,
      fencingToken: 5,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      validationRecoveryStaleReclaimApplied: true,
      validationRecoveryReclaimCount: 1,
    }))
    const bridge = runtime({ resumeValidationRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 7,
        fencingToken: 5,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
      },
    })
  })

  it("accepts a later proof-bound reclaim after another pre-persistence crash", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 8,
      fencingToken: 6,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      validationRecoveryStaleReclaimApplied: true,
      validationRecoveryReclaimCount: 2,
    }))
    const bridge = runtime({ resumeValidationRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 8,
        fencingToken: 6,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
      },
    })
  })

  it("preserves repeated authority renewals across repeated recovery reclaims", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 10,
      fencingToken: 6,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      authorityRenewalApplied: true,
      authorityRenewalCount: 2,
      validationRecoveryStaleReclaimApplied: true,
      validationRecoveryReclaimCount: 2,
    }))
    const bridge = runtime({ resumeValidationRecoveryQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: { expectedVersion: 10, fencingToken: 6 },
    })
  })

  it("does not replay a validation-recovery transition already persisted in the queue binding", async () => {
    const resumeValidationRecoveryQueue = vi.fn()
    const recovered = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [recovered])
    const acquire = vi.fn(async () => ({ outcome: recovered, acquired: true, replayed: true }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        version: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: { expectedVersion: 6, fencingToken: 4 },
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()
  })

  it("reclaims an expired persisted validation-recovery lease through acquisition refresh", async () => {
    const resumeValidationRecoveryQueue = vi.fn()
    const recovered = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T11:50:00.000Z",
    }
    const reclaimed = {
      ...recovered,
      lifecycleReason: "STALE_LEASE_RECOVERED",
      version: 7,
      fencingToken: 5,
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [recovered])
    const acquire = vi.fn(async () => ({ outcome: reclaimed, acquired: true, reclaimed: true }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 7,
        fencingToken: 5,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()
  })

  it.each([0, 1, 2])(
    "preserves recovery replay after %i crash-window stale acquisition reclaim(s)",
    async (reclaimCount) => {
    const resumeValidationRecoveryQueue = vi.fn()
    const reclaimed = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "STALE_LEASE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6 + reclaimCount,
      fencingToken: 4 + reclaimCount,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [reclaimed])
    const acquire = vi.fn(async () => ({ outcome: reclaimed, acquired: true, replayed: true }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 6 + reclaimCount,
        fencingToken: 4 + reclaimCount,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()
    },
  )

  it("rejects persisted validation recovery when acquisition revalidation revokes authority", async () => {
    const resumeValidationRecoveryQueue = vi.fn()
    const recovered = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [recovered])
    const acquire = vi.fn(async () => ({
      outcome: { ...recovered, authorityState: "revoked" },
      acquired: false,
      reason: "AUTHORITY_INELIGIBLE",
    }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_REFRESH_WALL" })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
  })

  it("delegates stale validation-recovery holder failover to acquisition refresh", async () => {
    const resumeValidationRecoveryQueue = vi.fn()
    const stale = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "STALE_LEASE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 7,
      fencingToken: 5,
      leaseHolder: "prior-hermes-host",
      leaseExpiresAt: "2026-07-28T11:50:00.000Z",
    }
    const reclaimed = {
      ...stale,
      version: 8,
      fencingToken: 6,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [stale])
    const acquire = vi.fn(async () => ({ outcome: reclaimed, acquired: true, reclaimed: true }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: { expectedVersion: 8, fencingToken: 6 },
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledWith(expect.objectContaining({
      leaseHolder: "resident-hermes",
    }))
  })

  it("replays a persisted V1.2 authority renewal from the older recovery binding", async () => {
    const resumeValidationRecoveryQueue = vi.fn()
    const renewed = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      authorityGrantRef: "AUTH-GRANT-NEW",
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [renewed])
    const acquire = vi.fn(async () => ({ outcome: renewed, acquired: true, replayed: true }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      authorityGrantRef: "AUTH-GRANT-OLD",
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        authorityGrantRef: "AUTH-GRANT-OLD",
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 7,
        fencingToken: 4,
        authorityGrantRef: "AUTH-GRANT-NEW",
      },
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
    expect(acquire).toHaveBeenCalledOnce()
  })

  it("replays a pre-upgrade recovery binding from exact durable authority-renewal proof", async () => {
    const resumeValidationRecoveryQueue = vi.fn()
    const renewed = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      authorityGrantRef: "AUTH-GRANT-NEW",
      previousAuthorityGrantRef: "AUTH-GRANT-OLD",
      authorityRenewalProofCount: 1,
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const readQueue = vi.fn(async () => [renewed])
    const acquire = vi.fn(async () => ({ outcome: renewed, acquired: true, replayed: true }))
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue, acquire })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 7,
        fencingToken: 4,
        authorityGrantRef: "AUTH-GRANT-NEW",
      },
    })
    expect(resumeValidationRecoveryQueue).not.toHaveBeenCalled()
  })

  it("rejects ambiguous pre-upgrade authority-renewal proof", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => {
      throw Object.assign(new Error("wall"), {
        code: "OUTCOME_QUEUE_VALIDATION_RECOVERY_RESUME_WALL",
      })
    })
    const ambiguous = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      authorityGrantRef: "AUTH-GRANT-NEW",
      previousAuthorityGrantRef: null,
      authorityRenewalProofCount: 2,
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const bridge = runtime({
      resumeValidationRecoveryQueue,
      readQueue: vi.fn(async () => [ambiguous]),
    })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_VALIDATION_RECOVERY_RESUME_WALL" })
    expect(resumeValidationRecoveryQueue).toHaveBeenCalledOnce()
  })

  it("rejects a version-only recovery mutation without an authority grant change", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => {
      throw Object.assign(new Error("wall"), {
        code: "OUTCOME_QUEUE_VALIDATION_RECOVERY_RESUME_WALL",
      })
    })
    const mutated = {
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      authorityGrantRef: "AUTH-GRANT-OLD",
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }
    const bridge = runtime({
      resumeValidationRecoveryQueue,
      readQueue: vi.fn(async () => [mutated]),
    })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        fencingToken: 4,
        authorityGrantRef: "AUTH-GRANT-OLD",
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "d".repeat(64),
      recoveryFencingToken: 57,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_VALIDATION_RECOVERY_RESUME_WALL" })
    expect(resumeValidationRecoveryQueue).toHaveBeenCalledOnce()
  })

  it("resumes a later validation recovery when the prior recovered binding is now blocked", async () => {
    const resumeValidationRecoveryQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      approvalState: "approved",
      authorityState: "matched",
      version: 8,
      fencingToken: 5,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const readQueue = vi.fn(async () => [{
      ...queueItem,
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_REMEDIATION_EXHAUSTED",
      version: 7,
      fencingToken: 4,
      leaseHolder: null,
      leaseExpiresAt: null,
    }])
    const bridge = runtime({ resumeValidationRecoveryQueue, readQueue })
    const outcome = {
      ...goal,
      queueBinding: {
        ...queueItem,
        expectedVersion: 6,
        version: 6,
        fencingToken: 4,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    }

    await expect(bridge.resumeAfterValidationRecovery(outcome, {
      expectedNextState: "VALIDATION_REMEDIATION_EXHAUSTED",
      proofDigest: "e".repeat(64),
      recoveryFencingToken: 71,
    })).resolves.toMatchObject({
      queueBinding: {
        expectedVersion: 8,
        fencingToken: 5,
        validationRecoveryResumeState: "VALIDATION_INFRASTRUCTURE_RECOVERED",
      },
    })
    expect(resumeValidationRecoveryQueue).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 7,
      fencingToken: 4,
      proofDigest: "e".repeat(64),
      recoveryFencingToken: 71,
    }))
  })

  it("rejects an owner-decision resume proof without its authenticated next state", async () => {
    const resumeQueue = vi.fn()
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, { decisionId: 91 }))
      .rejects.toMatchObject({
        code: "HERMES_OUTCOME_QUEUE_OWNER_DECISION_STATE_WALL",
      })
    expect(resumeQueue).not.toHaveBeenCalled()
  })

  it("reconstructs the fresh queue fence from an exact committed resume replay", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, {
      decisionId: 91,
      expectedNextState: "OWNER_DECISION_REQUIRED",
    })).resolves.toMatchObject({
        queueBinding: {
          expectedVersion: 6,
          fencingToken: 4,
          executionBinding: "execution-77",
          acquisitionKey: "acquisition-77",
          leaseToken: "lease-77",
        },
      })
  })

  it("accepts the extra exact version increment only for a marked authority renewal", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      authorityRenewalApplied: true,
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, {
      decisionId: 91,
      expectedNextState: "OWNER_DECISION_REQUIRED",
    })).resolves.toMatchObject({
        queueBinding: { expectedVersion: 7, fencingToken: 4 },
      })
  })

  it("rejects an unmarked extra resume version increment", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, {
      decisionId: 91,
      expectedNextState: "OWNER_DECISION_REQUIRED",
    })).rejects.toMatchObject({
        code: "HERMES_OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL",
      })
  })

  it("rejects a reconstructed owner-decision resume with a mismatched fresh fence", async () => {
    const resumeQueue = vi.fn(async () => ({
      ...queueItem,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      approvalState: "approved",
      authorityState: "matched",
      version: 6,
      fencingToken: 5,
      leaseHolder: "resident-hermes",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    }))
    const bridge = runtime({ resumeQueue })
    const outcome = { ...goal, queueBinding: { ...queueItem, expectedVersion: queueItem.version } }

    await expect(bridge.resumeAfterOwnerDecision(outcome, {
      decisionId: 91,
      expectedNextState: "OWNER_DECISION_REQUIRED",
    })).rejects.toMatchObject({
        code: "HERMES_OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL",
      })
  })

  it("preserves legacy goal settlement while rejecting a malformed queue binding", async () => {
    const completeGoal = vi.fn(async () => true)
    const bridge = runtime({ completeGoal })
    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome: goal,
      evidence: { prNumber: 475, mergeSha: "a".repeat(40) },
    })).resolves.toBe(true)
    expect(completeGoal).toHaveBeenCalledOnce()

    await expect(bridge.completeOutcome({
      outcomeId: 77,
      outcome: { ...goal, queueBinding: {} },
      evidence: { prNumber: 475, mergeSha: "a".repeat(40) },
    })).rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_BINDING_WALL" })
  })

  it("lazily reuses one database pool and closes it exactly once", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [goal] })
      .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
      .mockResolvedValueOnce({ rows: [goal] })
    const end = vi.fn(async () => {})
    const on = vi.fn()
    const createPool = vi.fn(async () => ({ query, end, on }))
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used",
      holderId: "resident-hermes",
      campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: vi.fn(),
      createPool,
      acquire: vi.fn(async () => ({
        outcome: queueItem,
        acquired: true,
        replayed: false,
        reclaimed: false,
        reason: null,
      })),
    })

    expect(createPool).not.toHaveBeenCalled()
    await bridge.selectOutcome()
    await bridge.selectOutcome()
    expect(createPool).toHaveBeenCalledOnce()
    expect(query).toHaveBeenCalledTimes(4)
    expect(end).not.toHaveBeenCalled()

    await bridge.close()
    await bridge.close()
    expect(end).toHaveBeenCalledOnce()
    await expect(bridge.selectOutcome())
      .rejects.toMatchObject({ code: "HERMES_OUTCOME_QUEUE_RUNTIME_CLOSED" })
  })

  it("evicts and closes an errored pool before lazily replacing it", async () => {
    const handlers: Array<(error: Error) => void> = []
    const firstEnd = vi.fn(async () => {})
    const secondEnd = vi.fn(async () => {})
    const firstPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
        .mockResolvedValueOnce({ rows: [goal] }),
      end: firstEnd,
      on: vi.fn((event: string, handler: (error: Error) => void) => {
        if (event === "error") handlers.push(handler)
      }),
    }
    const secondPool = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: "primary-user", email: "bsvalues@gmail.com" }] })
        .mockResolvedValueOnce({ rows: [goal] }),
      end: secondEnd,
      on: vi.fn(),
    }
    const createPool = vi.fn()
      .mockResolvedValueOnce(firstPool)
      .mockResolvedValueOnce(secondPool)
    const bridge = createHermesOutcomeQueueRuntime({
      databaseUrl: "postgresql://not-used",
      campaignWindowId: "campaign-v1-2",
      processIdentity: "supervisor-nonce-1",
      checkpointProofProvider: vi.fn(),
      createPool,
      acquire: vi.fn(async () => ({ outcome: queueItem, acquired: true })),
    })

    await bridge.selectOutcome()
    handlers[0](new Error("idle client failed"))
    await vi.waitFor(() => expect(firstEnd).toHaveBeenCalledOnce())
    await bridge.selectOutcome()
    expect(createPool).toHaveBeenCalledTimes(2)

    await bridge.close()
    expect(secondEnd).toHaveBeenCalledOnce()
  })
})
