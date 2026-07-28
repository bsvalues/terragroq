import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildLiveOutcomeDigest,
  parseArgs,
  probeProduction,
  runCampaign,
  validateCampaignEvidence,
  verifyLiveCampaignRecords,
  verifyMergedPullRequests,
} from "../scripts/hermes-bridge/v1-2-acceptance-campaign.mjs"
import {
  digestOutcomeQueueCheckpointProof,
  OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS,
} from "../scripts/hermes-bridge/outcome-queue-source.mjs"

const revision = "a".repeat(40)
const now = Date.parse("2026-07-28T19:00:00.000Z")
const fresh = "2026-07-28T18:59:00.000Z"
const productionAuthCookie = "better-auth.session_token=opaque-test-value"
const roots: string[] = []

function digest(value: unknown) {
  const canonical = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonical)
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.keys(entry).sort().map((key) => [
          key,
          canonical((entry as Record<string, unknown>)[key]),
        ]),
      )
    }
    return entry
  }
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(canonical(value)))
    .digest("hex")
}

function counters() {
  return {
    OWNER_OPERATION_TOUCH_COUNT: 0,
    OWNER_CREDENTIAL_TOUCH_COUNT: 0,
    OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
    OWNER_ROUTINE_DECISION_COUNT: 0,
    OWNER_ROUTINE_CONTACT_COUNT: 0,
  }
}

function outcome(id: number, ordinal: number, acquiredAt: string, completedAt: string) {
  return {
    acquiredAt,
    approval: { decisionRef: `DECISION-${id}`, state: "approved" },
    authority: { grantRef: `GRANT-${id}`, riskClass: ordinal === 1 ? "R0" : "R1", state: "matched" },
    campaignOrdinal: ordinal,
    completedAt,
    goalRef: `GOAL-${id}`,
    lifecycleState: "completed",
    merge: {
      headSha: String(ordinal).repeat(40),
      mergeSha: String(ordinal + 2).repeat(40),
      prNumber: 480 + ordinal,
      repository: "bsvalues/terragroq",
    },
    outcomeId: id,
    outcomeKey: `outcome-${id}`,
    queueOrder: ordinal - 1,
    result: "COMPLETE",
    riskClass: ordinal === 1 ? "R0" : "R1",
    usefulProductWork: true,
    verification: {
      evidenceDigest: digest(`placeholder-${id}`),
      observedAt: fresh,
      status: "PASS",
    },
    workOrderRef: `WO-HERMES-OUTCOME-${id}`,
  }
}

function claims() {
  const outcomes = [
    outcome(81, 1, "2026-07-28T18:00:00.000Z", "2026-07-28T18:20:00.000Z"),
    outcome(82, 2, "2026-07-28T18:20:00.000Z", "2026-07-28T18:50:00.000Z"),
  ]
  const mutationResult = (action: string) => ({
    affectedOutcomes: [{ outcomeKey: `mutation-${action.toLowerCase()}`, version: 2 }],
    outcome: { outcomeKey: `mutation-${action.toLowerCase()}`, version: 2 },
    successor: null,
  })
  return {
    automaticSuccessor: {
      acquiredOutcomeId: 82,
      ownerContactCount: 0,
      predecessorOutcomeId: 81,
      trigger: "PREDECESSOR_COMPLETED",
    },
    blockedCandidates: [
      {
        acquisitionCount: 0,
        lifecycleState: "blocked",
        outcomeKey: "blocked-dependency",
        reason: "BLOCKED_DEPENDENCY",
      },
      {
        acquisitionCount: 0,
        lifecycleState: "approved",
        outcomeKey: "blocked-authority",
        reason: "BLOCKED_AUTHORITY",
      },
    ],
    campaign: "WILLIAMOS-V1.2-TWO-OUTCOME",
    campaignRunId: "v1-2-campaign-run-001",
    contention: {
      acquisitionKeyDigest: digest({ acquisitionKey: "acquire-82" }),
      activeWriterCount: 1,
      checkpointSequence: 11,
      checkpointDigest: digest({ executionBinding: "binding-82" }),
      contenderIds: ["resident-a", "resident-b"],
      fencingToken: 2,
      leaseHolder: "resident-a",
      leaseIdentityDigest: digest({ leaseHolder: "resident-a", leaseToken: "winner-82" }),
      loserMutationCount: 0,
      losingAttemptId: 704,
      losingLeaseHolder: "resident-b",
      losingLeaseIdentityDigest: digest({ leaseHolder: "resident-b", leaseToken: "loser-82" }),
      losingProcessIdentity: "attempt-b",
      outcomeId: 82,
      processEpoch: "epoch-after",
      winnerAttemptId: 703,
      winnerId: "resident-a",
      workOrderRef: "WO-HERMES-OUTCOME-82",
    },
    mutations: ["DECLINE", "PAUSE", "REORDER", "RESUME", "SUPERSEDE"].map(
      (action, index) => ({
        action,
        firstAttemptId: 801 + (index * 2),
        idempotentReplay: true,
        idempotencyKeyDigest: digest(`idempotency-${action}`),
        mutationCount: 1,
        mutationCountAfterReplay: 1,
        receiptId: 301 + index,
        replayAttemptId: 802 + (index * 2),
        requestHash: digest(`request-${action}`),
        result: "PASS",
        resultDigest: digest(mutationResult(action)),
        targetOutcomeKey: `mutation-${action.toLowerCase()}`,
      }),
    ),
    observedAt: fresh,
    outcomes,
    ownerTouchCounters: counters(),
    parentIssue: 471,
    repository: "bsvalues/terragroq",
    restart: {
      acquisitionKeyDigest: digest({ acquisitionKey: "acquire-81" }),
      fencingToken: 1,
      leaseHolder: "resident-a",
      leaseIdentityDigest: digest({ leaseHolder: "resident-a", leaseToken: "winner-81" }),
      mutationCount: 1,
      outcomeId: 81,
      postAttemptId: 702,
      postCheckpointDigest: digest("pending-post-checkpoint"),
      postRestartSequence: 9,
      preAttemptId: 701,
      preCheckpointDigest: digest("pending-pre-checkpoint"),
      preRestartSequence: 8,
      processEpochAfter: "epoch-after",
      processEpochBefore: "epoch-before",
      workOrderRef: "WO-HERMES-OUTCOME-81",
    },
    schemaVersion: 1,
    sourceRevision: revision,
    surfaceAgreement: {
      observedAt: fresh,
      outcomes: outcomes.map((entry) => ({
        outcomeId: entry.outcomeId,
        state: "COMPLETE",
        workOrderRef: entry.workOrderRef,
      })),
      routes: ["/goal-console", "/work-orders", "/audit", "/trace"].map((route) => ({
        evidenceDigest: digest(
          `content:${route} WO-HERMES-OUTCOME-81 WO-HERMES-OUTCOME-82`,
        ),
        route,
        status: 200,
      })),
    },
  }
}

type CampaignClaims = ReturnType<typeof claims> & { leaseToken?: string }

function liveBundle() {
  const document = claims()
  const rows = document.outcomes.map((entry, index) => {
    const runtimeRef = `EV-HERMES-${entry.outcomeId}-1-${10 + index}`
    return {
      outcomeId: entry.outcomeId,
      outcomeKey: entry.outcomeKey,
      goalRef: entry.goalRef,
      queueOrder: entry.queueOrder,
      dependencyKeys: index === 1 ? [document.outcomes[0].outcomeKey] : [],
      riskClass: entry.riskClass,
      approvalState: "approved",
      authorityState: "matched",
      authorityGrantRef: entry.authority.grantRef,
      lifecycleState: "completed",
      activeWorkOrderId: 181 + index,
      fencingToken: index + 1,
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: [
        runtimeRef,
        `pr:${entry.merge.prNumber}`,
        `merge:${entry.merge.mergeSha}`,
      ],
      terminalKey: `hermes:${entry.outcomeKey}:${index + 1}:${entry.merge.mergeSha}`,
      terminalAt: entry.completedAt,
      approvalDecisionRef: entry.approval.decisionRef,
      approvalDecisionStatus: "accepted",
      approvalDecisionAuthority: "binding",
      liveAuthorityGrantRef: entry.authority.grantRef,
      authorityGrantStatus: "active",
      authorityGrantRevokedAt: null,
      workOrderId: 181 + index,
      workOrderRef: entry.workOrderRef,
      workOrderStatus: "closed",
      workOrderResult: "PASS",
      workOrderCommitRef: entry.merge.mergeSha,
      workOrderCompletedAt: entry.completedAt,
    }
  })
  const receipts = document.outcomes.map((entry, index) => ({
    outcomeKey: entry.outcomeKey,
    receiptId: 201 + index,
    receiptCount: 1,
    firstFencingToken: index + 1,
    latestFencingToken: index + 1,
    acquiredAt: entry.acquiredAt,
    updatedAt: entry.completedAt,
  }))
  const checkpoints = document.outcomes.map((entry, index) => ({
    id: 401 + index,
    workOrderId: String(181 + index),
    createdAt: entry.completedAt,
    metadata: {
      checkpointSequence: 10 + index,
      checkpointState: "COMPLETE",
      headRefOid: entry.merge.headSha,
      mergeSha: entry.merge.mergeSha,
      outcomeId: entry.outcomeId,
      prNumber: entry.merge.prNumber,
      runtimeEvidenceRef: `EV-HERMES-${entry.outcomeId}-1-${10 + index}`,
      workOrderRef: entry.workOrderRef,
    },
  }))
  const evidenceRecords = document.outcomes.map((entry, index) => ({
    id: 501 + index,
    ref: checkpoints[index].metadata.runtimeEvidenceRef,
    workOrderId: 181 + index,
    result: "PASS",
    repo: "bsvalues/terragroq",
    head: entry.merge.mergeSha,
    filesChanged: [`components/v1-2/product-${entry.outcomeId}.tsx`],
    validators: ["focused", "full", "build"],
    knownFailures: [],
    outOfScopeChanges: [],
    contentHash: digest(`record-${entry.outcomeId}`),
    createdAt: entry.completedAt,
  }))
  const blockedRows = [
    {
      outcomeKey: "blocked-authority",
      lifecycleState: "approved",
      acquisitionCount: 0,
      blockedDependencyCount: 0,
      authorityEligible: false,
    },
    {
      outcomeKey: "blocked-dependency",
      lifecycleState: "blocked",
      acquisitionCount: 0,
      blockedDependencyCount: 1,
      authorityEligible: true,
    },
  ]
  const mutationRows = document.mutations.map((mutation) => {
    const resultBinding = {
      affectedOutcomes: [{ outcomeKey: mutation.targetOutcomeKey, version: 2 }],
      outcome: { outcomeKey: mutation.targetOutcomeKey, version: 2 },
      successor: null,
    }
    return {
      id: mutation.receiptId,
      idempotencyKey: `idempotency-${mutation.action}`,
      operation: mutation.action.toLowerCase(),
      outcomeKey: mutation.targetOutcomeKey,
      requestHash: mutation.requestHash,
      requestBinding: {
        action: mutation.action.toLowerCase(),
        outcomeKey: mutation.targetOutcomeKey,
      },
      resultBinding,
      createdAt: fresh,
      auditCount: 1,
      eventCount: 1,
    }
  })
  const checkpointFields = (
    outcomeIndex: number,
    sequence: number,
    state: string,
  ) => {
    const entry = rows[outcomeIndex]
    const proof = {
      outcomeId: String(entry.outcomeId),
      outcomeKey: entry.outcomeKey,
      workOrderId: entry.workOrderId,
      fencingToken: entry.fencingToken,
      sequence,
      state,
      commit: state === "COMPLETE"
        ? {
            headSha: checkpoints[outcomeIndex].metadata.headRefOid,
            mergeSha: checkpoints[outcomeIndex].metadata.mergeSha,
            prNumber: checkpoints[outcomeIndex].metadata.prNumber,
          }
        : { headSha: null, mergeSha: null, prNumber: null },
    }
    return {
      checkpointDigest: digestOutcomeQueueCheckpointProof(proof),
      checkpointOutcomeId: proof.outcomeId,
      checkpointSequence: proof.sequence,
      checkpointState: proof.state,
      checkpointHeadSha: proof.commit.headSha,
      checkpointMergeSha: proof.commit.mergeSha,
      checkpointPrNumber: proof.commit.prNumber,
    }
  }
  const initialCheckpointFields = (outcomeIndex: number) => {
    const entry = rows[outcomeIndex]
    const proof = {
      outcomeId: String(entry.outcomeId),
      outcomeKey: entry.outcomeKey,
      workOrderId: null,
      fencingToken: entry.fencingToken,
      sequence: 0,
      state: "LEASED",
      commit: { headSha: null, mergeSha: null, prNumber: null },
    }
    return {
      checkpointDigest: digestOutcomeQueueCheckpointProof(proof),
      checkpointOutcomeId: proof.outcomeId,
      checkpointSequence: proof.sequence,
      checkpointState: proof.state,
      checkpointHeadSha: proof.commit.headSha,
      checkpointMergeSha: proof.commit.mergeSha,
      checkpointPrNumber: proof.commit.prNumber,
    }
  }
  const acquisitionAttempts = [
    {
      id: 601,
      campaignWindowId: document.campaignRunId,
      processIdentity: document.restart.processEpochBefore,
      leaseHolder: document.restart.leaseHolder,
      acquisitionKeyDigest: document.restart.acquisitionKeyDigest,
      leaseIdentityDigest: document.restart.leaseIdentityDigest,
      ...initialCheckpointFields(0),
      outcomeKey: rows[0].outcomeKey,
      fencingToken: rows[0].fencingToken,
      leaseExpiresAt: rows[0].terminalAt,
      activeWorkOrderId: null,
      disposition: "WINNER",
      reason: null,
      attemptedAt: document.outcomes[0].acquiredAt,
    },
    {
      id: document.restart.preAttemptId,
      campaignWindowId: document.campaignRunId,
      processIdentity: document.restart.processEpochBefore,
      leaseHolder: document.restart.leaseHolder,
      acquisitionKeyDigest: document.restart.acquisitionKeyDigest,
      leaseIdentityDigest: document.restart.leaseIdentityDigest,
      ...checkpointFields(0, document.restart.preRestartSequence, "HOST_VALIDATION_STARTED"),
      outcomeKey: rows[0].outcomeKey,
      fencingToken: rows[0].fencingToken,
      leaseExpiresAt: rows[0].terminalAt,
      activeWorkOrderId: rows[0].workOrderId,
      disposition: "REPLAY_WINNER",
      reason: null,
      attemptedAt: "2026-07-28T18:05:00.000Z",
    },
    {
      id: 602,
      campaignWindowId: document.campaignRunId,
      processIdentity: document.contention.processEpoch,
      leaseHolder: document.contention.leaseHolder,
      acquisitionKeyDigest: document.contention.acquisitionKeyDigest,
      leaseIdentityDigest: document.contention.leaseIdentityDigest,
      ...initialCheckpointFields(1),
      outcomeKey: rows[1].outcomeKey,
      fencingToken: rows[1].fencingToken,
      leaseExpiresAt: rows[1].terminalAt,
      activeWorkOrderId: null,
      disposition: "WINNER",
      reason: null,
      attemptedAt: document.outcomes[1].acquiredAt,
    },
    {
      id: document.restart.postAttemptId,
      campaignWindowId: document.campaignRunId,
      processIdentity: document.restart.processEpochAfter,
      leaseHolder: document.restart.leaseHolder,
      acquisitionKeyDigest: document.restart.acquisitionKeyDigest,
      leaseIdentityDigest: document.restart.leaseIdentityDigest,
      ...checkpointFields(0, document.restart.postRestartSequence, "HOST_VALIDATION_PASSED"),
      outcomeKey: rows[0].outcomeKey,
      fencingToken: rows[0].fencingToken,
      leaseExpiresAt: rows[0].terminalAt,
      activeWorkOrderId: rows[0].workOrderId,
      disposition: "REPLAY_WINNER",
      reason: null,
      attemptedAt: "2026-07-28T18:10:00.000Z",
    },
    {
      id: document.contention.winnerAttemptId,
      campaignWindowId: document.campaignRunId,
      processIdentity: document.contention.processEpoch,
      leaseHolder: document.contention.leaseHolder,
      acquisitionKeyDigest: document.contention.acquisitionKeyDigest,
      leaseIdentityDigest: document.contention.leaseIdentityDigest,
      ...checkpointFields(1, document.contention.checkpointSequence, "COMPLETE"),
      outcomeKey: rows[1].outcomeKey,
      fencingToken: rows[1].fencingToken,
      leaseExpiresAt: rows[1].terminalAt,
      activeWorkOrderId: rows[1].workOrderId,
      disposition: "REPLAY_WINNER",
      reason: null,
      attemptedAt: "2026-07-28T18:25:00.000Z",
    },
    {
      id: document.contention.losingAttemptId,
      campaignWindowId: document.campaignRunId,
      processIdentity: document.contention.losingProcessIdentity,
      leaseHolder: document.contention.losingLeaseHolder,
      acquisitionKeyDigest: document.contention.acquisitionKeyDigest,
      leaseIdentityDigest: document.contention.losingLeaseIdentityDigest,
      ...checkpointFields(1, document.contention.checkpointSequence, "COMPLETE"),
      outcomeKey: rows[1].outcomeKey,
      fencingToken: rows[1].fencingToken,
      leaseExpiresAt: rows[1].terminalAt,
      activeWorkOrderId: rows[1].workOrderId,
      disposition: "LOSER",
      reason: "ACQUISITION_KEY_CONFLICT",
      attemptedAt: "2026-07-28T18:26:00.000Z",
    },
  ]
  document.restart.preCheckpointDigest = acquisitionAttempts.find(
    (attempt) => attempt.id === document.restart.preAttemptId,
  )!.checkpointDigest
  document.restart.postCheckpointDigest = acquisitionAttempts.find(
    (attempt) => attempt.id === document.restart.postAttemptId,
  )!.checkpointDigest
  document.contention.checkpointDigest = acquisitionAttempts.find(
    (attempt) => attempt.id === document.contention.winnerAttemptId,
  )!.checkpointDigest
  checkpoints.push(
    {
      id: 390,
      workOrderId: String(rows[0].workOrderId),
      createdAt: "2026-07-28T18:05:00.000Z",
      metadata: {
        checkpointSequence: document.restart.preRestartSequence,
        checkpointState: "HOST_VALIDATION_STARTED",
        fencingToken: rows[0].fencingToken,
        headRefOid: null,
        mergeSha: null,
        outcomeId: rows[0].outcomeId,
        prNumber: null,
      },
    },
    {
      id: 391,
      workOrderId: String(rows[0].workOrderId),
      createdAt: "2026-07-28T18:10:00.000Z",
      metadata: {
        checkpointSequence: document.restart.postRestartSequence,
        checkpointState: "HOST_VALIDATION_PASSED",
        fencingToken: rows[0].fencingToken,
        headRefOid: null,
        mergeSha: null,
        outcomeId: rows[0].outcomeId,
        prNumber: null,
      },
    },
  )
  const mutationAttempts = document.mutations.flatMap((mutation, index) => [
    {
      id: mutation.firstAttemptId,
      idempotencyKey: `idempotency-${mutation.action}`,
      requestHash: mutation.requestHash,
      resultDigest: mutation.resultDigest,
      attemptOrdinal: 1,
      disposition: OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.COMMITTED,
      attemptedAt: `2026-07-28T18:3${index}:00.000Z`,
    },
    {
      id: mutation.replayAttemptId,
      idempotencyKey: `idempotency-${mutation.action}`,
      requestHash: mutation.requestHash,
      resultDigest: mutation.resultDigest,
      attemptOrdinal: 2,
      disposition: OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.REPLAY,
      attemptedAt: `2026-07-28T18:4${index}:00.000Z`,
    },
  ])
  const state = hostState(document, rows, checkpoints)
  document.outcomes.forEach((entry, index) => {
    entry.verification.evidenceDigest = buildLiveOutcomeDigest({
      checkpoint: checkpoints[index],
      evidenceRecords: [evidenceRecords[index]],
      outcome: rows[index],
      productFiles: evidenceRecords[index].filesChanged,
      receipt: receipts[index],
    })
  })
  return {
    blockedRows,
    acquisitionAttempts,
    checkpoints,
    document,
    evidenceRecords,
    mutationRows,
    mutationAttempts,
    receipts,
    rows,
    state,
  }
}

function hostState(
  document = claims(),
  rows: ReturnType<typeof liveBundle>["rows"] | null = null,
  checkpoints: ReturnType<typeof liveBundle>["checkpoints"] | null = null,
) {
  return {
    schemaVersion: 1,
    storeId: "hermes-bridge",
    revision: 4,
    updatedAt: fresh,
    nextFencingToken: 3,
    killSwitch: { active: false, reason: null, updatedAt: null },
    ownerTouchCounters: counters(),
    executions: Object.fromEntries(document.outcomes.map((entry, index) => [
      String(entry.outcomeId),
      {
        outcomeId: String(entry.outcomeId),
        fencingToken: index + 1,
        lease: {
          status: "RELEASED",
          holderId: "resident-a",
          acquiredAt: entry.acquiredAt,
          expiresAt: entry.completedAt,
          releasedAt: entry.completedAt,
        },
        checkpoint: {
          sequence: checkpoints?.[index].metadata.checkpointSequence ?? 10 + index,
          state: "COMPLETE",
          recordedAt: entry.completedAt,
          detail: null,
        },
        metadata: {
          prNumber: entry.merge.prNumber,
          headRefOid: entry.merge.headSha,
          mergeSha: entry.merge.mergeSha,
          outcome: {
            queueBinding: {
              outcomeKey: entry.outcomeKey,
              activeWorkOrderId: rows?.[index].workOrderId ?? 181 + index,
            },
          },
        },
      },
    ])),
    idempotency: {},
  }
}

function supervisorState(workspace: string) {
  return {
    schemaVersion: 2,
    processId: 1234,
    nonce: "epoch-after",
    campaignWindowId: "v1-2-campaign-run-001",
    workspace,
    supervisorPath: path.join(workspace, "scripts", "hermes-bridge", "supervisor.ps1"),
    hostMode: "INTERACTIVE_USER_RESIDENT",
    startedAt: "2026-07-28T17:00:00.000Z",
    heartbeatAt: fresh,
    cycleBudgetMs: 3_600_000,
    cycle: {
      sequence: 12,
      status: "IDLE",
      startedAt: "2026-07-28T18:58:00.000Z",
      completedAt: "2026-07-28T18:58:30.000Z",
      result: "QUEUE_DRAINED",
      stopReason: null,
      exitCode: 0,
      consecutiveFailures: 0,
    },
  }
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  }
}

function campaignQuery(bundle: ReturnType<typeof liveBundle>) {
  return vi.fn(async (sql: string) => {
    if (/^BEGIN/.test(sql) || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    if (/FROM "user"/.test(sql)) return { rows: [{ id: "primary-1" }] }
    if (/WITH latest/.test(sql)) return { rows: bundle.rows }
    if (/FROM "outcome_queue_acquisition_receipt"/.test(sql)
      && /GROUP BY "outcomeKey"/.test(sql)) return { rows: bundle.receipts }
    if (/FROM governance_event/.test(sql)
      && /HERMES_RUNTIME_CHECKPOINT/.test(sql)) return { rows: bundle.checkpoints }
    if (/FROM "outcome_queue_acquisition_attempt"/.test(sql)) {
      return { rows: bundle.acquisitionAttempts }
    }
    if (/FROM "outcome_queue_mutation_attempt"/.test(sql)) {
      return { rows: bundle.mutationAttempts }
    }
    if (/FROM evidence_record/.test(sql)) return { rows: bundle.evidenceRecords }
    if (/FROM "outcome_queue_item" q/.test(sql)) return { rows: bundle.blockedRows }
    if (/FROM "outcome_queue_mutation_receipt"/.test(sql)) return { rows: bundle.mutationRows }
    throw new Error(`unexpected SQL: ${sql}`)
  })
}

function productionFetch() {
  return vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
    if (url.endsWith("/api/health")) return response({ status: "ok", timestamp: fresh })
    if (url.endsWith("/api/auth/readiness")) {
      return response({ ready: true, authReady: true, signup: { mode: "closed", open: false } })
    }
    if (init?.headers?.Cookie !== productionAuthCookie) return response("", 302)
    const route = new URL(url).pathname
    return response(`content:${route} WO-HERMES-OUTCOME-81 WO-HERMES-OUTCOME-82`)
  })
}

function githubRunner(bundle: ReturnType<typeof liveBundle>) {
  return vi.fn((command: string, args: string[]) => {
    if (command === "git") return { ok: true, status: 0, stdout: `${revision}\n` }
    const number = Number(args[2])
    const index = bundle.document.outcomes.findIndex((entry) => entry.merge.prNumber === number)
    const expected = bundle.document.outcomes[index].merge
    return {
      ok: true,
      status: 0,
      stdout: JSON.stringify({
        number,
        state: "MERGED",
        url: `https://github.com/bsvalues/terragroq/pull/${number}`,
        headRefOid: expected.headSha,
        mergeCommit: { oid: expected.mergeSha },
        files: bundle.evidenceRecords[index].filesChanged.map((file) => ({ path: file })),
      }),
    }
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe("WilliamOS V1.2 two-outcome acceptance", () => {
  it("validates the bounded claim schema before consulting live sources", () => {
    const bundle = liveBundle()
    expect(validateCampaignEvidence(bundle.document, {
      currentRevision: revision,
      now,
      maxAgeMs: 5 * 60 * 1000,
    })).toMatchObject({ ok: true })
  })

  it.each([
    ["one outcome", (value: CampaignClaims) => value.outcomes.pop(), "TWO_OUTCOME_EVIDENCE_REQUIRED"],
    ["owner contact", (value: CampaignClaims) => { value.ownerTouchCounters.OWNER_ROUTINE_CONTACT_COUNT = 1 }, "FAIL_OWNER_BABYSITTING"],
    ["manual successor", (value: CampaignClaims) => { value.automaticSuccessor.ownerContactCount = 1 }, "AUTOMATIC_SUCCESSOR_EVIDENCE_INVALID"],
    ["duplicate writers", (value: CampaignClaims) => { value.contention.activeWriterCount = 2 }, "CONTENTION_EVIDENCE_INVALID"],
    ["missing mutation", (value: CampaignClaims) => value.mutations.pop(), "MUTATION_EVIDENCE_INCOMPLETE"],
    ["capability key", (value: CampaignClaims) => { value.leaseToken = "not-allowed" }, "CAMPAIGN_EVIDENCE_CONTRACT_INVALID"],
  ])("rejects invalid caller claims: %s", (_name, mutate, code) => {
    const value = liveBundle().document
    mutate(value)
    expect(validateCampaignEvidence(value, {
      currentRevision: revision,
      now,
      maxAgeMs: 5 * 60 * 1000,
    }).code).toBe(code)
  })

  it("derives the two qualifying outcomes from a repeatable-read Primary-user snapshot", async () => {
    const bundle = liveBundle()
    const query = campaignQuery(bundle)
    const result = await verifyLiveCampaignRecords({
      claims: bundle.document,
      localState: bundle.state,
      supervisorState: supervisorState(path.resolve("workspace")),
      rereadLocalState: () => structuredClone(bundle.state),
      now,
      query,
    })
    expect(result).toMatchObject({
      ok: true,
      detail: {
        primaryIdentity: "DECLARED_PRIMARY",
        outcomes: [
          {
            outcomeId: 81,
            productFiles: ["components/v1-2/product-81.tsx"],
            workOrderRef: "WO-HERMES-OUTCOME-81",
          },
          {
            outcomeId: 82,
            productFiles: ["components/v1-2/product-82.tsx"],
            workOrderRef: "WO-HERMES-OUTCOME-82",
          },
        ],
      },
    })
    expect(query.mock.calls[0][0]).toContain("REPEATABLE READ READ ONLY")
    const authoritySql = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => /WITH latest/.test(sql))
    expect(authoritySql).toEqual(expect.stringContaining(
      `approval.scope IN (q."outcomeKey", q."goalRef")`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `grant."expiresAt" IS NULL OR grant."expiresAt" > $2::timestamptz`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `grant."authorityLevel" = q."authorityLevel"`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `grant."grantedTo" = q."authoritySubject"`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `position(lower(blocked.action) IN lower(q."authorityAction")) > 0`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `position(lower(allowed.action) IN lower(q."authorityAction")) > 0`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `grant."workOrderId" IS NULL`,
    ))
    expect(authoritySql).toEqual(expect.stringContaining(
      `OR grant."workOrderId" = q."activeWorkOrderId"`,
    ))
    expect(query).toHaveBeenCalledWith("COMMIT")
  })

  it.each([
    ["claimed identity", (bundle: ReturnType<typeof liveBundle>) => { bundle.rows[0].outcomeKey = "other" }, "LIVE_ACQUISITION_RECEIPT_MISSING"],
    ["automatic successor ordering", (bundle: ReturnType<typeof liveBundle>) => { bundle.receipts[1].acquiredAt = "2026-07-28T18:19:59.000Z" }, "LIVE_OUTCOME_RECORD_MISMATCH"],
    ["useful product files", (bundle: ReturnType<typeof liveBundle>) => { bundle.evidenceRecords[0].filesChanged = ["docs/governance/claim.md"] }, "LIVE_OUTCOME_RECORD_MISMATCH"],
    ["terminal refs", (bundle: ReturnType<typeof liveBundle>) => { bundle.rows[0].terminalEvidenceRefs.pop() }, "LIVE_OUTCOME_RECORD_MISMATCH"],
    ["checkpoint PR identity", (bundle: ReturnType<typeof liveBundle>) => { bundle.checkpoints[0].metadata.prNumber = 999 }, "LIVE_OUTCOME_RECORD_MISMATCH"],
    ["blocked nonselection", (bundle: ReturnType<typeof liveBundle>) => { bundle.blockedRows[0].acquisitionCount = 1 }, "LIVE_BLOCKED_NONSELECTION_MISMATCH"],
    ["mutation receipt", (bundle: ReturnType<typeof liveBundle>) => { bundle.mutationRows[0].auditCount = 0 }, "LIVE_MUTATION_REPLAY_MISMATCH"],
    ["restart fence", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[0].fencingToken = 99 }, "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL"],
    ["restart checkpoint identity", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[0].checkpointOutcomeId = "82" }, "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL"],
    ["restart process epoch", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[1].processIdentity = "epoch-after" }, "LIVE_RESTART_PROOF_MISMATCH"],
    ["contention checkpoint binding", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[4].checkpointDigest = digest("other-checkpoint") }, "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL"],
    ["unexplained resident holder", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[4].leaseHolder = "unknown-holder" }, "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL"],
    ["contention losing attempt", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[5].processIdentity = "epoch-before" }, "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL"],
    ["missing initial acquisition", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts.shift() }, "LIVE_INITIAL_ACQUISITION_PROOF_MISMATCH"],
    ["missing persisted recovery attempt", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts.splice(1, 1) }, "LIVE_RESTART_PROOF_MISMATCH"],
    ["campaign attempt outside window", (bundle: ReturnType<typeof liveBundle>) => { bundle.acquisitionAttempts[0].attemptedAt = "2026-07-28T17:59:59.999Z" }, "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL"],
    ["initial acquisition fence lineage", (bundle: ReturnType<typeof liveBundle>) => {
      const attempt = bundle.acquisitionAttempts[0]
      attempt.fencingToken = 99
      attempt.checkpointDigest = digestOutcomeQueueCheckpointProof({
        outcomeId: attempt.checkpointOutcomeId,
        outcomeKey: attempt.outcomeKey,
        workOrderId: null,
        fencingToken: 99,
        sequence: attempt.checkpointSequence,
        state: attempt.checkpointState,
        commit: { headSha: null, mergeSha: null, prNumber: null },
      })
    }, "LIVE_INITIAL_ACQUISITION_PROOF_MISMATCH"],
    ["initial acquisition process lineage", (bundle: ReturnType<typeof liveBundle>) => {
      bundle.acquisitionAttempts[0].processIdentity = bundle.document.contention.processEpoch
    }, "LIVE_INITIAL_ACQUISITION_PROOF_MISMATCH"],
    ["replay attempt absent", (bundle: ReturnType<typeof liveBundle>) => { bundle.mutationAttempts.pop() }, "LIVE_MUTATION_ATTEMPT_CARDINALITY_WALL"],
    ["replay attempt was applied again", (bundle: ReturnType<typeof liveBundle>) => { bundle.mutationAttempts[1].disposition = "APPLIED" }, "LIVE_MUTATION_REPLAY_MISMATCH"],
    ["replay request changed", (bundle: ReturnType<typeof liveBundle>) => { bundle.mutationAttempts[1].requestHash = digest("different-request") }, "LIVE_MUTATION_REPLAY_MISMATCH"],
    ["replay result changed", (bundle: ReturnType<typeof liveBundle>) => { bundle.mutationAttempts[1].resultDigest = digest("different-result") }, "LIVE_MUTATION_REPLAY_MISMATCH"],
    ["local checkpoint", (bundle: ReturnType<typeof liveBundle>) => { bundle.state.executions["81"].checkpoint.sequence = 99 }, "LOCAL_OUTCOME_STATE_MISMATCH"],
  ])("fails closed on live mismatch: %s", async (_name, mutate, code) => {
    const bundle = liveBundle()
    mutate(bundle)
    const result = await verifyLiveCampaignRecords({
      claims: bundle.document,
      localState: bundle.state,
      supervisorState: supervisorState(path.resolve("workspace")),
      rereadLocalState: () => structuredClone(bundle.state),
      now,
      query: campaignQuery(bundle),
    })
    expect(result.code).toBe(code)
  })

  it("permits additional canonical bound resident refresh attempts", async () => {
    const bundle = liveBundle()
    bundle.acquisitionAttempts.push({
      ...structuredClone(bundle.acquisitionAttempts[3]),
      id: 699,
      attemptedAt: "2026-07-28T18:15:00.000Z",
    })
    const result = await verifyLiveCampaignRecords({
      claims: bundle.document,
      localState: bundle.state,
      supervisorState: supervisorState(path.resolve("workspace")),
      rereadLocalState: () => structuredClone(bundle.state),
      now,
      query: campaignQuery(bundle),
    })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
  })

  it("fails when the supervisor campaign identity is not the persisted campaign window", async () => {
    const bundle = liveBundle()
    const supervisor = supervisorState(path.resolve("workspace"))
    supervisor.campaignWindowId = "other-campaign"
    await expect(verifyLiveCampaignRecords({
      claims: bundle.document,
      localState: bundle.state,
      supervisorState: supervisor,
      rereadLocalState: () => structuredClone(bundle.state),
      now,
      query: campaignQuery(bundle),
    })).resolves.toMatchObject({ code: "LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL" })
  })

  it("fails closed when live acquisition authority filtering returns no qualifying outcomes", async () => {
    const bundle = liveBundle()
    const query = campaignQuery(bundle)
    query.mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({ rows: [{ id: "primary-1" }] }))
      .mockImplementationOnce(async () => ({ rows: [] }))
    const result = await verifyLiveCampaignRecords({
      claims: bundle.document,
      localState: bundle.state,
      supervisorState: supervisorState(path.resolve("workspace")),
      rereadLocalState: () => structuredClone(bundle.state),
      now,
      query,
    })
    expect(result.code).toBe("V1_2_LIVE_OUTCOME_CARDINALITY_WALL")
  })

  it("does not accept caller-authored JSON when live database verification is absent", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-2-json-only-"))
    roots.push(root)
    const bundle = liveBundle()
    const runtimeRoot = path.join(root, "runtime")
    fs.mkdirSync(path.join(runtimeRoot, "state"), { recursive: true })
    fs.mkdirSync(path.join(runtimeRoot, "evidence"), { recursive: true })
    fs.writeFileSync(
      path.join(runtimeRoot, "evidence", "v1-2-two-outcome.json"),
      JSON.stringify(bundle.document),
    )
    fs.writeFileSync(path.join(runtimeRoot, "state", "state.json"), JSON.stringify(bundle.state))
    fs.writeFileSync(
      path.join(runtimeRoot, "state", "supervisor.json"),
      JSON.stringify(supervisorState(root)),
    )
    const result = await runCampaign(
      parseArgs([], {
        WILLIAMOS_HERMES_RUNTIME_ROOT: runtimeRoot,
        WILLIAMOS_HERMES_WORKSPACE: root,
        WILLIAMOS_APP_URL: "https://william.example",
      }),
      {
        agreementProducer: async () => ({
          schemaVersion: 1,
          observedAt: fresh,
          mode: "HEALTHY_IDLE",
          queue: null,
          local: null,
          workOrder: null,
        }),
        fetchImpl: productionFetch(),
        now: () => now,
        processProbe: () => true,
        productionAuthCookie,
        repoRoot: root,
        runner: githubRunner(bundle),
      },
    )
    expect(result.status).toBe("FAIL")
    expect(result.acceptanceCriteria).toContainEqual(expect.objectContaining({
      name: "liveRecords",
      status: "FAIL",
    }))
  })

  it("derives and pins product route digests from live response bodies", async () => {
    const document = liveBundle().document
    const fetchImpl = productionFetch()
    const verified = await probeProduction("https://william.example", {
      authCookie: productionAuthCookie,
      clock: () => now,
      expectedOutcomes: document.outcomes,
      expectedSurfaces: document.surfaceAgreement.routes,
      fetchImpl,
      maxAgeMs: 5 * 60 * 1000,
    })
    expect(verified).toMatchObject({
      ok: true,
      detail: {
        surfaces: {
          "/goal-console": {
            contentDigest: digest(
              "content:/goal-console WO-HERMES-OUTCOME-81 WO-HERMES-OUTCOME-82",
            ),
          },
        },
      },
    })
    const publicCalls = fetchImpl.mock.calls.filter(([url]) => (
      url.endsWith("/api/health") || url.endsWith("/api/auth/readiness")
    ))
    const protectedCalls = fetchImpl.mock.calls.filter(([url]) => (
      !url.endsWith("/api/health") && !url.endsWith("/api/auth/readiness")
    ))
    expect(publicCalls).toHaveLength(2)
    expect(publicCalls.every(([, init]) => init?.headers?.Cookie === undefined)).toBe(true)
    expect(protectedCalls).toHaveLength(4)
    expect(protectedCalls.every(([, init]) => (
      init?.headers?.Cookie === productionAuthCookie
      && init?.redirect === "manual"
    ))).toBe(true)
    expect(JSON.stringify(verified)).not.toContain(productionAuthCookie)

    document.surfaceAgreement.routes[0].evidenceDigest = digest("caller-authored")
    expect((await probeProduction("https://william.example", {
      authCookie: productionAuthCookie,
      clock: () => now,
      expectedOutcomes: document.outcomes,
      expectedSurfaces: document.surfaceAgreement.routes,
      fetchImpl: productionFetch(),
      maxAgeMs: 5 * 60 * 1000,
    })).code).toBe("PRODUCTION_VERIFICATION_FAILED")
  })

  it("fails closed when authenticated proof is absent or redirected without reporting it", async () => {
    const document = liveBundle().document
    const absent = await probeProduction("https://william.example", {
      clock: () => now,
      expectedOutcomes: document.outcomes,
      expectedSurfaces: document.surfaceAgreement.routes,
      fetchImpl: productionFetch(),
      maxAgeMs: 5 * 60 * 1000,
    })
    expect(absent).toMatchObject({
      code: "PRODUCTION_VERIFICATION_FAILED",
      detail: {
        surfaces: {
          "/goal-console": { code: "PRODUCTION_AUTH_PROOF_REQUIRED" },
          "/work-orders": { code: "PRODUCTION_AUTH_PROOF_REQUIRED" },
          "/audit": { code: "PRODUCTION_AUTH_PROOF_REQUIRED" },
          "/trace": { code: "PRODUCTION_AUTH_PROOF_REQUIRED" },
        },
      },
    })

    const rejectedCookie = "better-auth.session_token=rejected-opaque-value"
    const fetchImpl = productionFetch()
    const redirected = await probeProduction("https://william.example", {
      authCookie: rejectedCookie,
      clock: () => now,
      expectedOutcomes: document.outcomes,
      expectedSurfaces: document.surfaceAgreement.routes,
      fetchImpl,
      maxAgeMs: 5 * 60 * 1000,
    })
    expect(redirected).toMatchObject({
      code: "PRODUCTION_VERIFICATION_FAILED",
      detail: {
        surfaces: {
          "/goal-console": { code: "PRODUCTION_ROUTE_UNHEALTHY" },
          "/work-orders": { code: "PRODUCTION_ROUTE_UNHEALTHY" },
          "/audit": { code: "PRODUCTION_ROUTE_UNHEALTHY" },
          "/trace": { code: "PRODUCTION_ROUTE_UNHEALTHY" },
        },
      },
    })
    const protectedCalls = fetchImpl.mock.calls.filter(([url]) => (
      !url.endsWith("/api/health") && !url.endsWith("/api/auth/readiness")
    ))
    expect(protectedCalls).toHaveLength(4)
    expect(protectedCalls.every(([, init]) => (
      init?.headers?.Cookie === rejectedCookie
      && init?.redirect === "manual"
    ))).toBe(true)
    const serialized = JSON.stringify(redirected)
    expect(serialized).not.toContain(rejectedCookie)
    expect(serialized).not.toContain(productionAuthCookie)
    expect(serialized).not.toContain("session_token")
  })

  it("consumes CLI authentication only from the environment and sanitizes redirect failure", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-2-cli-auth-"))
    roots.push(root)
    const rejectedCookie = "better-auth.session_token=cli-rejected-opaque-value"
    const fetchImpl = productionFetch()
    const previous = process.env.WILLIAMOS_PRODUCTION_AUTH_COOKIE
    process.env.WILLIAMOS_PRODUCTION_AUTH_COOKIE = rejectedCookie
    try {
      const result = await runCampaign(
        parseArgs([], {
          WILLIAMOS_HERMES_RUNTIME_ROOT: path.join(root, "runtime"),
          WILLIAMOS_HERMES_WORKSPACE: root,
          WILLIAMOS_APP_URL: "https://william.example",
        }),
        {
          agreementProducer: async () => ({
            schemaVersion: 1,
            observedAt: fresh,
            mode: "HEALTHY_IDLE",
            queue: null,
            local: null,
            workOrder: null,
          }),
          fetchImpl,
          now: () => now,
          processProbe: () => true,
          repoRoot: root,
          runner: vi.fn(() => ({ ok: true, status: 0, stdout: `${revision}\n` })),
        },
      )
      expect(result.acceptanceCriteria).toContainEqual(expect.objectContaining({
        name: "production",
        status: "FAIL",
        code: "PRODUCTION_VERIFICATION_FAILED",
      }))
      const protectedCalls = fetchImpl.mock.calls.filter(([url]) => (
        !url.endsWith("/api/health") && !url.endsWith("/api/auth/readiness")
      ))
      expect(protectedCalls).toHaveLength(4)
      expect(protectedCalls.every(([, init]) => init?.headers?.Cookie === rejectedCookie)).toBe(true)
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain(rejectedCookie)
      expect(serialized).not.toContain("session_token")
    } finally {
      if (previous === undefined) delete process.env.WILLIAMOS_PRODUCTION_AUTH_COOKIE
      else process.env.WILLIAMOS_PRODUCTION_AUTH_COOKIE = previous
    }
  })

  it("pins GitHub PR identity and useful files to the live database result", () => {
    const bundle = liveBundle()
    const live = bundle.document.outcomes.map((entry, index) => ({
      mergeSha: entry.merge.mergeSha,
      outcomeId: entry.outcomeId,
      prNumber: entry.merge.prNumber,
      productFiles: bundle.evidenceRecords[index].filesChanged,
    }))
    expect(verifyMergedPullRequests(
      bundle.document.outcomes,
      githubRunner(bundle),
      live,
    )).toMatchObject({
      ok: true,
      detail: [{ number: 481 }, { number: 482 }],
    })
    live[0].productFiles = ["components/not-in-pr.tsx"]
    expect(verifyMergedPullRequests(
      bundle.document.outcomes,
      githubRunner(bundle),
      live,
    ).code).toBe("GITHUB_PRODUCT_FILE_TRACEABILITY_WALL")
  })

  it("passes the complete live campaign and leaves local state unchanged", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v1-2-live-"))
    roots.push(root)
    const bundle = liveBundle()
    const workspace = path.join(root, "workspace")
    const runtimeRoot = path.join(root, "runtime")
    fs.mkdirSync(workspace, { recursive: true })
    fs.mkdirSync(path.join(runtimeRoot, "state"), { recursive: true })
    fs.mkdirSync(path.join(runtimeRoot, "evidence"), { recursive: true })
    const statePath = path.join(runtimeRoot, "state", "state.json")
    fs.writeFileSync(
      path.join(runtimeRoot, "evidence", "v1-2-two-outcome.json"),
      JSON.stringify(bundle.document),
    )
    fs.writeFileSync(statePath, JSON.stringify(bundle.state))
    fs.writeFileSync(
      path.join(runtimeRoot, "state", "supervisor.json"),
      JSON.stringify(supervisorState(workspace)),
    )
    const before = fs.readFileSync(statePath, "utf8")
    const result = await runCampaign(
      parseArgs([], {
        WILLIAMOS_HERMES_RUNTIME_ROOT: runtimeRoot,
        WILLIAMOS_HERMES_WORKSPACE: workspace,
        WILLIAMOS_APP_URL: "https://william.example",
      }),
      {
        agreementProducer: async () => ({
          schemaVersion: 1,
          observedAt: fresh,
          mode: "HEALTHY_IDLE",
          queue: null,
          local: null,
          workOrder: null,
        }),
        campaignQuery: campaignQuery(bundle),
        fetchImpl: productionFetch(),
        now: () => now,
        processProbe: () => true,
        productionAuthCookie,
        repoRoot: workspace,
        runner: githubRunner(bundle),
      },
    )
    expect(result).toMatchObject({
      status: "PASS",
      result: "WILLIAMOS_V1_2_TWO_OUTCOME_ACCEPTANCE_COMPLETE",
      acceptanceCriteria: [
        { name: "evidence", status: "PASS" },
        { name: "host", status: "PASS" },
        { name: "liveRecords", status: "PASS" },
        { name: "supervisor", status: "PASS" },
        { name: "agreement", status: "PASS" },
        { name: "github", status: "PASS" },
        { name: "production", status: "PASS" },
      ],
    })
    expect(fs.readFileSync(statePath, "utf8")).toBe(before)
  })

  it("parses only bounded read/evidence paths and timing controls", () => {
    const options = parseArgs([
      "--evidence", "campaign.json",
      "--state", "state.json",
      "--supervisor-state", "supervisor.json",
      "--agreement", "agreement.json",
      "--workspace", ".",
      "--app-url", "https://william.example/",
      "--output", "result.json",
      "--max-age-ms", "60000",
    ], {})
    expect(options).toMatchObject({
      evidence: path.resolve("campaign.json"),
      state: path.resolve("state.json"),
      supervisorState: path.resolve("supervisor.json"),
      agreement: path.resolve("agreement.json"),
      workspace: path.resolve("."),
      appUrl: "https://william.example",
      output: path.resolve("result.json"),
      maxAgeMs: 60000,
    })
    expect(() => parseArgs(["--repo", "other/repository"], {}))
      .toThrow("UNKNOWN_ARGUMENT:--repo")
    expect(() => parseArgs(["--auth-cookie", productionAuthCookie], {}))
      .toThrow("UNKNOWN_ARGUMENT:--auth-cookie")
  })
})
