import { describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"
import { getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"

import {
  goalOutcomeIntakeReceipt,
  outcomeQueueAcquisitionAttempt,
  outcomeQueueAcquisitionReceipt,
  outcomeQueueMutationAttempt,
  outcomeQueueMutationReceipt,
} from "@/lib/db/schema"
import {
  acquireNextEligibleOutcome,
  acquireOutcome as acquireOutcomeCompatibility,
  approveOutcomeQueueItem,
  approveOutcome as approveOutcomeCompatibility,
  bindOutcomeQueueWorkOrder,
  completeQueuedOutcome,
  completeOutcomeQueueItem,
  canonicalOutcomeQueueCheckpointProof,
  digestOutcomeQueueCheckpointProof,
  deferOutcomeLease as deferOutcomeLeaseCompatibility,
  deferOutcomeQueueLease,
  enqueueOutcome,
  ensureOutcomeQueueHardeningSchema,
  listOutcomeQueue,
  matchOutcomeAuthorityGrant,
  matchOutcomeAuthority as matchOutcomeAuthorityCompatibility,
  mutateOutcomeQueueItem,
  OUTCOME_QUEUE_LEGAL_TRANSITIONS,
  OUTCOME_QUEUE_LEGACY_GOAL_REFS,
  OUTCOME_QUEUE_NO_SELECTION_REASONS,
  OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS,
  OUTCOME_QUEUE_SQL,
  persistOutcomeQueueItem,
  readLegacyOutcomeHistory,
  readOutcomeQueue,
  renewOutcomeLease as renewOutcomeLeaseCompatibility,
  renewOutcomeQueueLease,
  resumeOutcomeQueueAfterDecision,
  transitionOutcome as transitionOutcomeCompatibility,
  transitionOutcomeQueueItem,
  verifyOutcomeQueueWorkOrderBinding,
} from "@/scripts/hermes-bridge/outcome-queue-source.mjs"
import { verifyMutationRows } from "@/scripts/hermes-bridge/v1-2-acceptance-campaign.mjs"
import {
  acceptanceCampaignIdempotencyKey,
  acceptanceCampaignOutcomeKey,
} from "@/scripts/hermes-bridge/v1-2-acceptance-exercise.mjs"
import {
  v12CampaignDecision,
  v12CampaignGrant,
} from "@/lib/outcome-queue/v1-2-campaign-authority"

const now = "2026-07-28T12:00:00.000Z"
const userId = "owner"

function successorKey(idempotencyKey: string) {
  return `outcome:successor:${createHash("sha256")
    .update(`${userId}:${idempotencyKey.trim()}`)
    .digest("hex")
    .slice(0, 24)}`
}

function queueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId,
    outcomeKey: "goal:GOAL-1000",
    goalId: 1000,
    goalRef: "GOAL-1000",
    title: "Deliver a bounded outcome",
    objective: "Deliver a bounded outcome",
    queueOrder: 10,
    dependencyKeys: [],
    riskClass: "R1",
    approvalState: "approved",
    approvedBy: "owner",
    approvedAt: now,
    approvalDecisionId: 100,
    authorityState: "matched",
    authorityLevel: "A2_WRITE_OWN",
    authorityGrantRef: "GRANT-WOS-V1.2",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: "active",
    lifecycleReason: null,
    activeWorkOrderId: 472,
    executionBinding: "execution-a",
    leaseHolder: "supervisor-a",
    leaseToken: "lease-a",
    leaseExpiresAt: "2026-07-28T12:01:00.000Z",
    fencingToken: 1,
    version: 1,
    acquisitionKey: "acquire-a",
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    suggestedAt: now,
    activatedAt: now,
    terminalAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function expiredCampaignAuthorityRow(
  overrides: Record<string, unknown> = {},
) {
  const outcomeKey = "campaign:v1-2:queue-evidence-drilldown"
  const issuedAt = new Date("2026-07-26T12:00:00.000Z")
  const grant = v12CampaignGrant(outcomeKey, userId, issuedAt)
  return queueRow({
    outcomeKey,
    goalId: 2001,
    goalRef: "GOAL-2001",
    title: "Add supporting evidence drill-down links to each Goal Console outcome queue row.",
    objective: "Show the linked Goal, Work Order, Evidence, Trace, and Audit records when those durable references exist.",
    dependencyKeys: [],
    approvedBy: userId,
    approvalDecisionId: 201,
    authorityGrantRef: grant.ref,
    lifecycleState: "approved",
    activeWorkOrderId: null,
    executionBinding: null,
    leaseHolder: null,
    leaseToken: null,
    leaseExpiresAt: null,
    fencingToken: 0,
    version: 1,
    acquisitionKey: null,
    activatedAt: null,
    approval: {
      id: 201,
      userId,
      ...v12CampaignDecision(outcomeKey),
    },
    expiredGrant: {
      id: 202,
      ...grant,
    },
    ...overrides,
  })
}

function safeMutationRow(row: Record<string, unknown>) {
  const safe = { ...row }
  delete safe.executionBinding
  delete safe.leaseToken
  delete safe.fencingToken
  delete safe.acquisitionKey
  delete safe.terminalKey
  return safe
}

function dedicatedQuery(run: ReturnType<typeof vi.fn>) {
  return Object.assign(run, {
    connect: async () => ({ query: run, release: vi.fn() }),
  })
}

const receiptColumnRows = [
  ["goal_outcome_intake_receipt", "id", "integer", true, "nextval('goal_outcome_intake_receipt_id_seq'::regclass)"],
  ["goal_outcome_intake_receipt", "userId", "text", true, null],
  ["goal_outcome_intake_receipt", "idempotencyKey", "text", true, null],
  ["goal_outcome_intake_receipt", "requestHash", "text", true, null],
  ["goal_outcome_intake_receipt", "goalId", "integer", true, null],
  ["goal_outcome_intake_receipt", "outcomeKey", "text", true, null],
  ["goal_outcome_intake_receipt", "resultDigest", "text", true, null],
  ["goal_outcome_intake_receipt", "replayCount", "integer", true, "0"],
  ["goal_outcome_intake_receipt", "firstSubmittedAt", "timestamp with time zone", true, "now()"],
  ["goal_outcome_intake_receipt", "lastReplayedAt", "timestamp with time zone", false, null],
  ["outcome_queue_acquisition_attempt", "id", "integer", true, "nextval('outcome_queue_acquisition_attempt_id_seq'::regclass)"],
  ["outcome_queue_acquisition_attempt", "userId", "text", true, null],
  ["outcome_queue_acquisition_attempt", "campaignWindowId", "text", true, null],
  ["outcome_queue_acquisition_attempt", "processIdentity", "text", true, null],
  ["outcome_queue_acquisition_attempt", "leaseHolder", "text", true, null],
  ["outcome_queue_acquisition_attempt", "acquisitionKeyDigest", "text", true, null],
  ["outcome_queue_acquisition_attempt", "leaseIdentityDigest", "text", true, null],
  ["outcome_queue_acquisition_attempt", "checkpointDigest", "text", true, null],
  ["outcome_queue_acquisition_attempt", "checkpointOutcomeId", "text", true, null],
  ["outcome_queue_acquisition_attempt", "checkpointSequence", "integer", true, null],
  ["outcome_queue_acquisition_attempt", "checkpointState", "text", true, null],
  ["outcome_queue_acquisition_attempt", "checkpointHeadSha", "text", false, null],
  ["outcome_queue_acquisition_attempt", "checkpointMergeSha", "text", false, null],
  ["outcome_queue_acquisition_attempt", "checkpointPrNumber", "integer", false, null],
  ["outcome_queue_acquisition_attempt", "outcomeKey", "text", false, null],
  ["outcome_queue_acquisition_attempt", "fencingToken", "integer", false, null],
  ["outcome_queue_acquisition_attempt", "leaseExpiresAt", "timestamp with time zone", false, null],
  ["outcome_queue_acquisition_attempt", "activeWorkOrderId", "integer", false, null],
  ["outcome_queue_acquisition_attempt", "disposition", "text", true, null],
  ["outcome_queue_acquisition_attempt", "reason", "text", false, null],
  ["outcome_queue_acquisition_attempt", "attemptedAt", "timestamp with time zone", true, "now()"],
  ["outcome_queue_acquisition_receipt", "id", "integer", true, "nextval('outcome_queue_acquisition_receipt_id_seq'::regclass)"],
  ["outcome_queue_acquisition_receipt", "userId", "text", true, null],
  ["outcome_queue_acquisition_receipt", "acquisitionKey", "text", true, null],
  ["outcome_queue_acquisition_receipt", "outcomeKey", "text", true, null],
  ["outcome_queue_acquisition_receipt", "firstFencingToken", "integer", true, null],
  ["outcome_queue_acquisition_receipt", "latestFencingToken", "integer", true, null],
  ["outcome_queue_acquisition_receipt", "createdAt", "timestamp with time zone", true, "now()"],
  ["outcome_queue_acquisition_receipt", "updatedAt", "timestamp with time zone", true, "now()"],
  ["outcome_queue_mutation_receipt", "id", "integer", true, "nextval('outcome_queue_mutation_receipt_id_seq'::regclass)"],
  ["outcome_queue_mutation_receipt", "userId", "text", true, null],
  ["outcome_queue_mutation_receipt", "idempotencyKey", "text", true, null],
  ["outcome_queue_mutation_receipt", "operation", "text", true, null],
  ["outcome_queue_mutation_receipt", "outcomeKey", "text", false, null],
  ["outcome_queue_mutation_receipt", "requestHash", "text", true, null],
  ["outcome_queue_mutation_receipt", "requestBinding", "jsonb", true, null],
  ["outcome_queue_mutation_receipt", "resultBinding", "jsonb", true, null],
  ["outcome_queue_mutation_receipt", "createdAt", "timestamp with time zone", true, "now()"],
  ["outcome_queue_mutation_attempt", "id", "integer", true, "nextval('outcome_queue_mutation_attempt_id_seq'::regclass)"],
  ["outcome_queue_mutation_attempt", "userId", "text", true, null],
  ["outcome_queue_mutation_attempt", "idempotencyKey", "text", true, null],
  ["outcome_queue_mutation_attempt", "requestHash", "text", true, null],
  ["outcome_queue_mutation_attempt", "resultDigest", "text", true, null],
  ["outcome_queue_mutation_attempt", "attemptOrdinal", "integer", true, null],
  ["outcome_queue_mutation_attempt", "disposition", "text", true, null],
  ["outcome_queue_mutation_attempt", "attemptedAt", "timestamp with time zone", true, "now()"],
].map(([tableName, columnName, dataType, notNull, defaultExpression]) => ({
  tableName,
  columnName,
  dataType,
  notNull,
  defaultExpression,
}))

const receiptConstraintRows = [
  ["goal_outcome_intake_receipt", "goal_outcome_intake_receipt_pkey", "p", "PRIMARY KEY (id)"],
  ["goal_outcome_intake_receipt", "goal_outcome_intake_receipt_goalId_fkey", "f", `FOREIGN KEY ("goalId") REFERENCES goal(id) ON DELETE RESTRICT`],
  ["goal_outcome_intake_receipt", "goal_outcome_intake_receipt_user_key_unique", "u", `UNIQUE ("userId", "idempotencyKey")`],
  ["goal_outcome_intake_receipt", "goal_outcome_intake_receipt_user_goal_unique", "u", `UNIQUE ("userId", "goalId")`],
  ["goal_outcome_intake_receipt", "goal_outcome_intake_receipt_user_outcome_unique", "u", `UNIQUE ("userId", "outcomeKey")`],
  ["goal_outcome_intake_receipt", "goal_outcome_intake_receipt_replay_count_check", "c", `CHECK ("replayCount" >= 0)`],
  ["outcome_queue_acquisition_attempt", "outcome_queue_acquisition_attempt_pkey", "p", "PRIMARY KEY (id)"],
  ["outcome_queue_acquisition_attempt", "outcome_queue_acquisition_attempt_fence_check", "c", `CHECK ("fencingToken" IS NULL OR "fencingToken" > 0)`],
  ["outcome_queue_acquisition_attempt", "outcome_queue_acquisition_attempt_checkpoint_check", "c", `CHECK ("checkpointSequence" >= 0 AND ("checkpointPrNumber" IS NULL OR "checkpointPrNumber" > 0))`],
  ["outcome_queue_acquisition_receipt", "outcome_queue_acquisition_receipt_pkey", "p", "PRIMARY KEY (id)"],
  ["outcome_queue_acquisition_receipt", "outcome_queue_acquisition_receipt_user_key_unique", "u", `UNIQUE ("userId", "acquisitionKey")`],
  ["outcome_queue_acquisition_receipt", "outcome_queue_acquisition_receipt_fence_check", "c", `CHECK ("firstFencingToken" > 0 AND "latestFencingToken" >= "firstFencingToken")`],
  ["outcome_queue_mutation_receipt", "outcome_queue_mutation_receipt_pkey", "p", "PRIMARY KEY (id)"],
  ["outcome_queue_mutation_receipt", "outcome_queue_mutation_receipt_user_key_unique", "u", `UNIQUE ("userId", "idempotencyKey")`],
  ["outcome_queue_mutation_attempt", "outcome_queue_mutation_attempt_pkey", "p", "PRIMARY KEY (id)"],
  ["outcome_queue_mutation_attempt", "outcome_queue_mutation_attempt_user_ordinal_unique", "u", `UNIQUE ("userId", "idempotencyKey", "attemptOrdinal")`],
  ["outcome_queue_mutation_attempt", "outcome_queue_mutation_attempt_ordinal_check", "c", `CHECK ("attemptOrdinal" > 0)`],
  [
    "outcome_queue_mutation_attempt",
    "outcome_queue_mutation_attempt_disposition_check",
    "c",
    `CHECK (disposition = ANY (ARRAY['COMMITTED'::text, 'REPLAY'::text]))`,
  ],
].map(([tableName, constraintName, constraintType, definition]) => ({
  tableName,
  constraintName,
  constraintType,
  validated: true,
  definition,
}))

const legacyReceiptConstraintRows = receiptConstraintRows.flatMap((row) => {
  if (row.constraintName === "outcome_queue_mutation_receipt_user_key_unique") {
    return []
  }
  if (row.constraintName === "outcome_queue_acquisition_receipt_fence_check") {
    return [
      {
        ...row,
        constraintName:
          "outcome_queue_acquisition_receipt_firstFencingToken_check",
        definition: `CHECK ("firstFencingToken" > 0)`,
      },
      {
        ...row,
        constraintName:
          "outcome_queue_acquisition_receipt_latestFencingToken_check",
        definition:
          `CHECK ("latestFencingToken" >= "firstFencingToken")`,
      },
    ]
  }
  return [row]
})

const legacyMutationReceiptUniqueIndexRows = [{
  tableName: "outcome_queue_mutation_receipt",
  indexName: "outcome_queue_mutation_receipt_user_key_idx",
  unique: true,
  valid: true,
  ready: true,
  primary: false,
  exclusion: false,
  immediate: true,
  noIncludedColumns: true,
  noExpressions: true,
  accessMethod: "btree",
  keyColumns: [`"userId"`, `"idempotencyKey"`],
  predicate: null,
  constraintBacked: false,
}]

const receiptIndexRows = [
  {
    tableName: "outcome_queue_acquisition_attempt",
    indexName: "outcome_queue_acquisition_attempt_campaign_idx",
    unique: false,
    valid: true,
    ready: true,
    keyColumns: [`"userId"`, `"campaignWindowId"`, `"attemptedAt"`],
    predicate: null,
  },
  {
    tableName: "outcome_queue_acquisition_attempt",
    indexName: "outcome_queue_acquisition_attempt_identity_idx",
    unique: false,
    valid: true,
    ready: true,
    keyColumns: [`"userId"`, `"acquisitionKeyDigest"`, `"attemptedAt"`],
    predicate: null,
  },
  {
    tableName: "outcome_queue_acquisition_receipt",
    indexName: "outcome_queue_acquisition_receipt_user_outcome_idx",
    unique: false,
    valid: true,
    ready: true,
    keyColumns: [`"userId"`, `"outcomeKey"`],
    predicate: null,
  },
  {
    tableName: "outcome_queue_mutation_receipt",
    indexName: "outcome_queue_mutation_receipt_user_outcome_idx",
    unique: false,
    valid: true,
    ready: true,
    keyColumns: [`"userId"`, `"outcomeKey"`, `"createdAt"`],
    predicate: null,
  },
  {
    tableName: "outcome_queue_mutation_attempt",
    indexName: "outcome_queue_mutation_attempt_request_idx",
    unique: false,
    valid: true,
    ready: true,
    keyColumns: [`"userId"`, `"requestHash"`, `"attemptedAt"`],
    predicate: null,
  },
]

function receiptCatalogResult(sql: string) {
  if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) return { rows: receiptColumnRows }
  if (sql === OUTCOME_QUEUE_SQL.readReceiptConstraints) {
    return { rows: receiptConstraintRows }
  }
  if (sql === OUTCOME_QUEUE_SQL.readReceiptIndexes) return { rows: receiptIndexRows }
  return null
}

function acquisitionQuery({
  receipt = [],
  receiptOutcome,
  prior = [],
  replayEligibility = [{ approvalLive: true, authorityLive: true }],
  reclaimed = [],
  selected = [],
  selectedAfterRenewal,
  counts = [],
  renewable = [],
  rebound = [],
  resumeAfterRenewal,
  replayResume = [],
}: {
  receipt?: unknown[]
  receiptOutcome?: unknown[]
  prior?: unknown[]
  replayEligibility?: unknown[]
  reclaimed?: unknown[]
  selected?: unknown[]
  selectedAfterRenewal?: unknown[]
  counts?: unknown[]
  renewable?: unknown[]
  rebound?: unknown[]
  resumeAfterRenewal?: unknown[]
  replayResume?: unknown[]
}) {
  let acquireCalls = 0
  let resumeCalls = 0
  const run = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.readAcquisitionReceipt) return { rows: receipt }
    if (sql === OUTCOME_QUEUE_SQL.readReceiptOutcome) {
      return { rows: receiptOutcome ?? prior }
    }
    if (sql === OUTCOME_QUEUE_SQL.readAcquisition) return { rows: prior }
    if (sql === OUTCOME_QUEUE_SQL.revalidateAcquisition) return { rows: replayEligibility }
    if (sql === OUTCOME_QUEUE_SQL.reclaimAcquisition) return { rows: reclaimed }
    if (sql === OUTCOME_QUEUE_SQL.acquire) {
      const rows = acquireCalls > 0 && selectedAfterRenewal !== undefined
        ? selectedAfterRenewal
        : selected
      acquireCalls += 1
      return { rows }
    }
    if (sql === OUTCOME_QUEUE_SQL.readRenewableV12CampaignAuthorities) {
      return { rows: renewable }
    }
    if (sql === OUTCOME_QUEUE_SQL.readV12CampaignGrantCollision) return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant) {
      return {
        rows: [{
          id: 81,
          userId: values[0],
          ref: values[1],
          workOrderId: null,
          grantedBy: values[0],
          grantedTo: "operator",
          authorityLevel: "A2_WRITE_OWN",
          scope: values[2],
          allowedActions: values[3],
          blockedActions: values[4],
          reason: values[5],
          status: "active",
          expiresAt: values[6],
          revokedAt: null,
          revokedBy: null,
          revokeReason: null,
          contentHash: values[7],
          createdAt: values[8],
        }],
      }
    }
    if (sql === OUTCOME_QUEUE_SQL.rebindRenewedV12CampaignGrant) {
      return { rows: rebound }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertV12CampaignAuthorityRenewalAudit) {
      return { rows: [{ id: 82 }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertV12CampaignAuthorityRenewalEvent) {
      return { rows: [{ id: 83 }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.resumeAfterDecision) {
      const rows = resumeCalls > 0 && resumeAfterRenewal !== undefined
        ? resumeAfterRenewal
        : []
      resumeCalls += 1
      return { rows }
    }
    if (sql === OUTCOME_QUEUE_SQL.replayResumeAfterDecision) {
      return { rows: replayResume }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionReceipt) {
      return {
        rows: [{
          id: 51,
          outcomeKey: values?.[2],
          firstFencingToken: values?.[3],
          latestFencingToken: values?.[3],
        }],
      }
    }
    if (sql === OUTCOME_QUEUE_SQL.advanceAcquisitionReceipt) {
      return {
        rows: [{
          id: 51,
          outcomeKey: values?.[4],
          firstFencingToken: 1,
          latestFencingToken: values?.[2],
        }],
      }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt) {
      return { rows: [{ id: 61 }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.noSelectionReason) return { rows: counts }
    if (sql === OUTCOME_QUEUE_SQL.readActiveAcquisitionProof) {
      return {
        rows: [queueRow({
          outcomeKey: "goal:CONTENDED",
          fencingToken: 7,
          activeWorkOrderId: 478,
        })],
      }
    }
    throw new Error(`unexpected query: ${sql}`)
  })
  return Object.assign(run, {
    connect: async () => ({ query: run, release: vi.fn() }),
  })
}

const acquireInput = {
  userId,
  acquisitionKey: "acquire-a",
  leaseHolder: "supervisor-a",
  leaseToken: "lease-a",
  executionBinding: "execution-a",
  leaseDurationMs: 60_000,
  activeWorkOrderId: 472,
  campaignWindowId: "campaign-v1-2",
  processIdentity: "supervisor-nonce-1",
  checkpointProofProvider: vi.fn(async ({ outcome }) => ({
    outcomeId: String(outcome.goalId),
    outcomeKey: outcome.outcomeKey,
    workOrderId: outcome.activeWorkOrderId,
    fencingToken: outcome.fencingToken,
    sequence: 4,
    state: "HOST_VALIDATION_PASSED",
    commit: { headSha: "a".repeat(40), mergeSha: null, prNumber: null },
  })),
  now,
}

function mutationQuery({
  current = queueRow(),
  mutated = queueRow({ version: 2 }),
  snapshot = [],
  rebound = [],
  governed = true,
  dependencySnapshot = [],
  boundGrant = {
    status: "active",
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
}: {
  current?: Record<string, unknown>
  mutated?: Record<string, unknown>
  snapshot?: Record<string, unknown>[]
  rebound?: Record<string, unknown>[]
  governed?: boolean
  dependencySnapshot?: Record<string, unknown>[]
  boundGrant?: Record<string, unknown> | null
} = {}) {
  const receipts = new Map<string, Record<string, unknown>>()
  const attemptCounts = new Map<string, number>()
  const run = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
    if (sql === OUTCOME_QUEUE_SQL.readMutationReceipt) {
      const receipt = receipts.get(String(values[1]))
      return { rows: receipt ? [receipt] : [] }
    }
    if (sql === OUTCOME_QUEUE_SQL.readMutationItem) return { rows: [current] }
    if (sql === OUTCOME_QUEUE_SQL.readMutationAuthorityGrant) {
      return { rows: boundGrant ? [boundGrant] : [] }
    }
    if (sql === OUTCOME_QUEUE_SQL.readMutationSnapshot) return { rows: snapshot }
    if (sql === OUTCOME_QUEUE_SQL.readDependencyMutationSnapshot) {
      return { rows: dependencySnapshot }
    }
    if (sql === OUTCOME_QUEUE_SQL.governedApprovalMutation) {
      return { rows: governed ? [mutated] : [] }
    }
    if ([
      OUTCOME_QUEUE_SQL.pauseMutation,
      OUTCOME_QUEUE_SQL.declineMutation,
      OUTCOME_QUEUE_SQL.supersedeMutation,
      OUTCOME_QUEUE_SQL.dependencyMutation,
    ].includes(sql)) {
      return { rows: [mutated] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertSupersedingOutcome) {
      return { rows: [queueRow({
        id: 2,
        outcomeKey: values[1],
        lifecycleState: "suggested",
        approvalState: "unapproved",
        authorityState: "unverified",
        version: 0,
      })] }
    }
    if (sql === OUTCOME_QUEUE_SQL.rebindSupersededDependents) return { rows: rebound }
    if (sql === OUTCOME_QUEUE_SQL.reorderMutation) {
      return { rows: [{
        ...snapshot.find((row) => row.outcomeKey === values[1]),
        queueOrder: values[3],
        version: Number(values[2]) + 1,
      }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationReceipt) {
      receipts.set(String(values[1]), {
        id: 41,
        userId: values[0],
        idempotencyKey: values[1],
        operation: values[2],
        outcomeKey: values[3],
        requestHash: values[4],
        requestBinding: JSON.parse(String(values[5])),
        resultBinding: JSON.parse(String(values[6])),
        createdAt: values[7],
      })
      return { rows: [{ id: 41 }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.nextMutationAttemptOrdinal) {
      const key = String(values[1])
      return { rows: [{ attemptOrdinal: (attemptCounts.get(key) ?? 0) + 1 }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationAttempt) {
      const key = String(values[1])
      attemptCounts.set(key, Number(values[4]))
      return { rows: [{ id: 43 + Number(values[4]) }] }
    }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationAudit) return { rows: [{ id: 42 }] }
    if (sql === OUTCOME_QUEUE_SQL.insertMutationEvent) return { rows: [{ id: 43 }] }
    throw new Error(`unexpected query: ${sql}`)
  })
  return Object.assign(run, {
    connect: async () => ({ query: run, release: vi.fn() }),
  })
}

describe("transactional durable outcome queue source", () => {
  it("bootstraps and verifies every additive queue invariant under one transaction lock", async () => {
    const constraintNames = [
      "outcome_queue_item_active_binding_check",
      "outcome_queue_item_approval_state_check",
      "outcome_queue_item_authority_state_check",
      "outcome_queue_item_lifecycle_state_check",
      "outcome_queue_item_nonnegative_fence_check",
    ]
    const constraintDefinitions: Record<string, string> = {
      outcome_queue_item_active_binding_check:
        `CHECK ("lifecycleState" <> 'active' OR ("executionBinding" IS NOT NULL AND "leaseHolder" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "acquisitionKey" IS NOT NULL AND "fencingToken" > 0))`,
      outcome_queue_item_approval_state_check:
        `CHECK ("approvalState" IN ('unapproved', 'approved', 'revoked'))`,
      outcome_queue_item_authority_state_check:
        `CHECK ("authorityState" IN ('unverified', 'matched', 'denied', 'expired', 'revoked'))`,
      outcome_queue_item_lifecycle_state_check:
        `CHECK ("lifecycleState" IN ('suggested', 'approved', 'blocked', 'active', 'completed', 'declined', 'superseded'))`,
      outcome_queue_item_nonnegative_fence_check:
        `CHECK ("fencingToken" >= 0 AND "version" >= 0)`,
    }
    const run = vi.fn(async (sql: string) => {
      const receiptCatalog = receiptCatalogResult(sql)
      if (receiptCatalog) return receiptCatalog
      if (sql === OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations) {
        return {
          rows: [{
            lifecycleViolationCount: 0,
            approvalViolationCount: 0,
            authorityViolationCount: 0,
            nonnegativeViolationCount: 0,
            activeBindingViolationCount: 0,
            multipleActiveUserCount: 0,
          }],
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints) {
        return {
          rows: constraintNames.map((constraintName) => ({
            constraintName,
            validated: true,
            definition: constraintDefinitions[constraintName],
          })),
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readOneActiveOutcomeIndex) {
        return {
          rows: [{
            unique: true,
            valid: true,
            ready: true,
            keyColumn: '"userId"',
            predicate: `("lifecycleState" = 'active'::text)`,
          }],
        }
      }
      return { rows: [] }
    })
    const release = vi.fn()
    const query = Object.assign(run, {
      connect: vi.fn(async () => ({ query: run, release })),
    })

    await expect(ensureOutcomeQueueHardeningSchema({ query })).resolves.toBe(true)
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemTable,
      OUTCOME_QUEUE_SQL.ensureMutationReceiptTable,
      OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable,
      OUTCOME_QUEUE_SQL.ensureGoalOutcomeIntakeReceiptTable,
      OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptTable,
      OUTCOME_QUEUE_SQL.ensureMutationAttemptTable,
      OUTCOME_QUEUE_SQL.readReceiptColumns,
      OUTCOME_QUEUE_SQL.readReceiptConstraints,
      OUTCOME_QUEUE_SQL.ensureMutationReceiptOutcomeIndex,
      OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptOutcomeIndex,
      OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptIndexes,
      OUTCOME_QUEUE_SQL.ensureMutationAttemptRequestIndex,
      OUTCOME_QUEUE_SQL.readReceiptIndexes,
      OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations,
      OUTCOME_QUEUE_SQL.ensureOneActiveOutcomeIndex,
      OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemCheckConstraints,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueLifecycleConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueApprovalConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueAuthorityConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueNonnegativeFenceConstraint,
      OUTCOME_QUEUE_SQL.validateOutcomeQueueActiveBindingConstraint,
      OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints,
      OUTCOME_QUEUE_SQL.readOneActiveOutcomeIndex,
      "COMMIT",
    ])
    expect(run.mock.calls[1][1]).toEqual(["williamos:outcome-queue:hardening-schema"])
    expect(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemTable)
      .toContain(`CREATE TABLE IF NOT EXISTS "outcome_queue_item"`)
    expect(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemTable)
      .toContain(`REFERENCES "goal"("id") ON DELETE SET NULL`)
    expect(OUTCOME_QUEUE_SQL.ensureMutationReceiptTable)
      .toContain(`CREATE TABLE IF NOT EXISTS "outcome_queue_mutation_receipt"`)
    expect(OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable)
      .toContain(`CONSTRAINT "outcome_queue_acquisition_receipt_fence_check"`)
    expect(run).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints,
      [constraintNames],
    )
    for (const constraintName of constraintNames) {
      expect(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemCheckConstraints)
        .toContain(`ADD CONSTRAINT "${constraintName}"`)
      expect(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemCheckConstraints)
        .toContain(`DROP CONSTRAINT IF EXISTS "${constraintName}"`)
    }
    expect(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemCheckConstraints)
      .toContain(`CHECK ("fencingToken" >= 0 AND "version" >= 0) NOT VALID`)
    expect(OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemCheckConstraints)
      .toContain(`AND "acquisitionKey" IS NOT NULL`)
    expect([
      OUTCOME_QUEUE_SQL.validateOutcomeQueueLifecycleConstraint.trim(),
      OUTCOME_QUEUE_SQL.validateOutcomeQueueApprovalConstraint.trim(),
      OUTCOME_QUEUE_SQL.validateOutcomeQueueAuthorityConstraint.trim(),
      OUTCOME_QUEUE_SQL.validateOutcomeQueueNonnegativeFenceConstraint.trim(),
      OUTCOME_QUEUE_SQL.validateOutcomeQueueActiveBindingConstraint.trim(),
    ]).toEqual([
      `ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_lifecycle_state_check"`,
      `ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_approval_state_check"`,
      `ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_authority_state_check"`,
      `ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_nonnegative_fence_check"`,
      `ALTER TABLE "outcome_queue_item"
  VALIDATE CONSTRAINT "outcome_queue_item_active_binding_check"`,
    ])
    expect(OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints)
      .toContain(`pg_get_constraintdef(oid, true) AS "definition"`)
    expect(release).toHaveBeenCalledOnce()
  })

  it("uses a PostgreSQL-safe alias for governed authority approval", () => {
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation)
      .toContain(`"authority_grant" AS auth_grant`)
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation)
      .not.toMatch(/\bAS grant\b/)
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation)
      .toContain(`auth_grant."ref" = $5`)
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation)
      .not.toMatch(/\bgrant\./)
    expect(OUTCOME_QUEUE_SQL.matchAuthority)
      .toContain(`"authority_grant" AS auth_grant`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority)
      .not.toMatch(/\b(?:AS grant|grant\.)/)
  })

  it("fails closed under the advisory transaction when a receipt table is partial", async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) {
        return {
          rows: receiptColumnRows.filter((row) => !(
            row.tableName === "outcome_queue_mutation_receipt"
            && row.columnName === "requestHash"
          )),
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_RECEIPT_COLUMN_WALL",
    })
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemTable,
      OUTCOME_QUEUE_SQL.ensureMutationReceiptTable,
      OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable,
      OUTCOME_QUEUE_SQL.ensureGoalOutcomeIntakeReceiptTable,
      OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptTable,
      OUTCOME_QUEUE_SQL.ensureMutationAttemptTable,
      OUTCOME_QUEUE_SQL.readReceiptColumns,
      "ROLLBACK",
    ])
  })

  it("transactionally upgrades the exact parent receipt schema before strict verification", async () => {
    let constraintReadCount = 0
    const constraintNames = [
      "outcome_queue_item_active_binding_check",
      "outcome_queue_item_approval_state_check",
      "outcome_queue_item_authority_state_check",
      "outcome_queue_item_lifecycle_state_check",
      "outcome_queue_item_nonnegative_fence_check",
    ]
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) {
        return { rows: receiptColumnRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readReceiptConstraints) {
        constraintReadCount += 1
        return {
          rows: constraintReadCount === 1
            ? legacyReceiptConstraintRows
            : receiptConstraintRows,
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readLegacyMutationReceiptUniqueIndex) {
        return { rows: legacyMutationReceiptUniqueIndexRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readReceiptIndexes) {
        return { rows: receiptIndexRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations) {
        return {
          rows: [{
            lifecycleViolationCount: 0,
            approvalViolationCount: 0,
            authorityViolationCount: 0,
            nonnegativeViolationCount: 0,
            activeBindingViolationCount: 0,
            multipleActiveUserCount: 0,
          }],
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints) {
        return {
          rows: constraintNames.map((constraintName) => ({
            constraintName,
            validated: true,
            definition: "CHECK (true)",
          })),
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readOneActiveOutcomeIndex) {
        return {
          rows: [{
            unique: true,
            valid: true,
            ready: true,
            keyColumn: `"userId"`,
            predicate: `"lifecycleState" = 'active'`,
          }],
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).resolves.toBe(true)
    expect(run.mock.calls.map(([sql]) => sql)).toEqual(expect.arrayContaining([
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readLegacyMutationReceiptUniqueIndex,
      OUTCOME_QUEUE_SQL.migrateLegacyMutationReceiptUniqueIndex,
      OUTCOME_QUEUE_SQL.migrateLegacyAcquisitionReceiptFenceChecks,
      OUTCOME_QUEUE_SQL.validateAcquisitionReceiptFenceConstraint,
      "COMMIT",
    ]))
    expect(constraintReadCount).toBe(2)
    expect(run.mock.calls.map(([sql]) => sql).indexOf(
      OUTCOME_QUEUE_SQL.acquireLock,
    )).toBeLessThan(run.mock.calls.map(([sql]) => sql).indexOf(
      OUTCOME_QUEUE_SQL.migrateLegacyMutationReceiptUniqueIndex,
    ))
  })

  it("rolls back before alteration when the parent receipt index shape is unknown", async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) {
        return { rows: receiptColumnRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readReceiptConstraints) {
        return { rows: legacyReceiptConstraintRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readLegacyMutationReceiptUniqueIndex) {
        return {
          rows: legacyMutationReceiptUniqueIndexRows.map((row) => ({
            ...row,
            keyColumns: [`"userId"`, `"outcomeKey"`],
          })),
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_RECEIPT_MIGRATION_WALL",
    })
    expect(run.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(run).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.migrateLegacyMutationReceiptUniqueIndex,
    )
    expect(run).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.migrateLegacyAcquisitionReceiptFenceChecks,
    )
  })

  it.each([
    {
      drift: "type",
      columnName: "requestBinding",
      replacement: { dataType: "text" },
    },
    {
      drift: "nullability",
      columnName: "requestHash",
      replacement: { notNull: false },
    },
    {
      drift: "default",
      columnName: "createdAt",
      replacement: { defaultExpression: null },
    },
  ])("fails closed when receipt column $drift drifts", async ({
    columnName,
    replacement,
  }) => {
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) {
        return {
          rows: receiptColumnRows.map((row) => (
            row.tableName === "outcome_queue_mutation_receipt"
              && row.columnName === columnName
              ? { ...row, ...replacement }
              : row
          )),
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_RECEIPT_COLUMN_WALL",
    })
    expect(run.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it.each([
    {
      drift: "unique key",
      constraintName: "outcome_queue_mutation_receipt_user_key_unique",
      definition: `UNIQUE ("userId", "outcomeKey")`,
    },
    {
      drift: "fence check",
      constraintName: "outcome_queue_acquisition_receipt_fence_check",
      definition: `CHECK ("latestFencingToken" > 0)`,
    },
  ])("fails closed when a receipt $drift drifts", async ({
    constraintName,
    definition,
  }) => {
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) {
        return { rows: receiptColumnRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readReceiptConstraints) {
        return {
          rows: receiptConstraintRows.map((row) => (
            row.constraintName === constraintName
              ? { ...row, definition }
              : row
          )),
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_RECEIPT_CONSTRAINT_WALL",
    })
    expect(run.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
    expect(run).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.migrateLegacyMutationReceiptUniqueIndex,
    )
    expect(run).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.migrateLegacyAcquisitionReceiptFenceChecks,
    )
  })

  it("fails closed when a receipt supporting index has the wrong shape", async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.readReceiptColumns) {
        return { rows: receiptColumnRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readReceiptConstraints) {
        return { rows: receiptConstraintRows }
      }
      if (sql === OUTCOME_QUEUE_SQL.readReceiptIndexes) {
        return {
          rows: receiptIndexRows.map((row) => (
            row.indexName === "outcome_queue_mutation_receipt_user_outcome_idx"
              ? { ...row, keyColumns: [`"userId"`, `"createdAt"`] }
              : row
          )),
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_RECEIPT_INDEX_WALL",
    })
    expect(run.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("rolls back with a typed wall when the one-active catalog index is not canonical", async () => {
    const run = vi.fn(async (sql: string) => {
      const receiptCatalog = receiptCatalogResult(sql)
      if (receiptCatalog) return receiptCatalog
      if (sql === OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations) {
        return {
          rows: [{
            lifecycleViolationCount: 0,
            approvalViolationCount: 0,
            authorityViolationCount: 0,
            nonnegativeViolationCount: 0,
            activeBindingViolationCount: 0,
            multipleActiveUserCount: 0,
          }],
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readOutcomeQueueHardeningConstraints) {
        return {
          rows: [
            "outcome_queue_item_active_binding_check",
            "outcome_queue_item_approval_state_check",
            "outcome_queue_item_authority_state_check",
            "outcome_queue_item_lifecycle_state_check",
            "outcome_queue_item_nonnegative_fence_check",
          ].map((constraintName) => ({
            constraintName,
            validated: true,
          })),
        }
      }
      if (sql === OUTCOME_QUEUE_SQL.readOneActiveOutcomeIndex) {
        return {
          rows: [{
            unique: false,
            valid: true,
            ready: true,
            keyColumn: '"userId"',
            predicate: `("lifecycleState" = 'active'::text)`,
          }],
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_INDEX_WALL",
    })
    expect(run.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("rolls back with a typed wall when existing rows violate declared invariants", async () => {
    const run = vi.fn(async (sql: string) => {
      const receiptCatalog = receiptCatalogResult(sql)
      if (receiptCatalog) return receiptCatalog
      if (sql === OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations) {
        return {
          rows: [{
            lifecycleViolationCount: 0,
            approvalViolationCount: 0,
            authorityViolationCount: 0,
            nonnegativeViolationCount: 0,
            activeBindingViolationCount: 1,
            multipleActiveUserCount: 0,
          }],
        }
      }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(ensureOutcomeQueueHardeningSchema({ query })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_HARDENING_EXISTING_ROWS_INVALID",
      details: {
        activeBindingViolationCount: 1,
      },
    })
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.ensureOutcomeQueueItemTable,
      OUTCOME_QUEUE_SQL.ensureMutationReceiptTable,
      OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable,
      OUTCOME_QUEUE_SQL.ensureGoalOutcomeIntakeReceiptTable,
      OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptTable,
      OUTCOME_QUEUE_SQL.ensureMutationAttemptTable,
      OUTCOME_QUEUE_SQL.readReceiptColumns,
      OUTCOME_QUEUE_SQL.readReceiptConstraints,
      OUTCOME_QUEUE_SQL.ensureMutationReceiptOutcomeIndex,
      OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptOutcomeIndex,
      OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptIndexes,
      OUTCOME_QUEUE_SQL.ensureMutationAttemptRequestIndex,
      OUTCOME_QUEUE_SQL.readReceiptIndexes,
      OUTCOME_QUEUE_SQL.inspectHardeningInvariantViolations,
      "ROLLBACK",
    ])
  })

  it("uses the exact quoted schema contract and deterministic ordering", () => {
    expect(Object.isFrozen(OUTCOME_QUEUE_SQL)).toBe(true)
    for (const sql of Object.values(OUTCOME_QUEUE_SQL)) {
      expect(sql).not.toMatch(/\b(outcome_id|queue_order|dependency_outcome_ids|approval_state|authority_state|lifecycle_state|active_goal_id|active_work_order_id|lease_holder_id|lease_expires_at|fencing_token|terminal_result_id)\b/)
    }
    expect(OUTCOME_QUEUE_SQL.read).toMatch(
      /q\."queueOrder" ASC,\s*q\."createdAt" ASC,\s*q\."outcomeKey" ASC/,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toMatch(/FOR UPDATE OF q SKIP LOCKED/)
    expect(OUTCOME_QUEUE_SQL.readAcquisition).toMatch(/FOR UPDATE OF q\s*$/)
    expect(OUTCOME_QUEUE_SQL.readAcquisition).not.toContain("SKIP LOCKED")
    expect(OUTCOME_QUEUE_LEGAL_TRANSITIONS.active).toEqual(["blocked"])
    expect(OUTCOME_QUEUE_NO_SELECTION_REASONS).toContain("NO_ELIGIBLE_OUTCOME")
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."approvalState" = 'approved'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`FROM "decision" AS live_approval`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `live_approval."scope" = q."outcomeKey"`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `upper(trim(live_approval."decision")) = 'APPROVE'`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."authorityState" = 'matched'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`FROM "authority_grant" AS live_grant`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `COALESCE($8, q."activeWorkOrderId") = live_grant."workOrderId"`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."revokedAt" IS NULL`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `live_grant."grantedTo" = q."authoritySubject"`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `live_grant."scope" = q."outcomeKey"`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      `q."authorityLevel" IN ('A0_READ_ONLY', 'A1_DRAFT', 'A2_WRITE_OWN')`,
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."authoritySubject" = 'operator'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."authorityAction" = 'outcome:execute'`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(
      "(deploy|release|cutover|mutat|writ|chang|updat|configur)",
    )
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."blockedActions"`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live_grant."allowedActions"`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."riskClass" IN ('R0', 'R1')`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`q."version" + 1`)
    expect(OUTCOME_QUEUE_SQL.acquire).toContain(`live."leaseExpiresAt" > $1::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`live_grant."expiresAt" > $12::timestamptz`)
    expect(enqueueOutcome).toBe(persistOutcomeQueueItem)
    expect(listOutcomeQueue).toBe(readOutcomeQueue)
    expect(acquireOutcomeCompatibility).toBe(acquireNextEligibleOutcome)
    expect(approveOutcomeCompatibility).toBe(approveOutcomeQueueItem)
    expect(transitionOutcomeCompatibility).toBe(transitionOutcomeQueueItem)
    expect(matchOutcomeAuthorityCompatibility).toBe(matchOutcomeAuthorityGrant)
    expect(completeQueuedOutcome).toBe(completeOutcomeQueueItem)
  })

  it("persists and reads all data in one user scope", async () => {
    const suggested = queueRow({
      lifecycleState: "suggested",
      approvalState: "unapproved",
      approvedBy: null,
      approvedAt: null,
      authorityState: "unverified",
      activeWorkOrderId: null,
    })
    const run = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.persist) return { rows: [suggested] }
      if (sql === OUTCOME_QUEUE_SQL.read) return { rows: [suggested] }
      throw new Error(`unexpected query: ${sql}`)
    })
    const query = Object.assign(run, {
      connect: async () => ({ query: run, release: vi.fn() }),
    })

    await expect(persistOutcomeQueueItem({
      query,
      userId,
      now,
      item: {
        outcomeKey: "goal:GOAL-1000",
        goalId: 1000,
        goalRef: "GOAL-1000",
        title: "Deliver a bounded outcome",
        objective: "Deliver a bounded outcome",
        queueOrder: 10,
        dependencyKeys: [],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "suggested",
      },
    })).resolves.toEqual(suggested)
    await expect(readOutcomeQueue({ query, userId })).resolves.toEqual([suggested])

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.persist,
      "COMMIT",
      OUTCOME_QUEUE_SQL.read,
    ])
    expect(query.mock.calls[2][1]).toEqual([
      userId, "goal:GOAL-1000", 1000, "GOAL-1000", "Deliver a bounded outcome",
      "Deliver a bounded outcome", 10, [], "R1", "unapproved", null, null,
      "unverified", "A2_WRITE_OWN", null, "operator", "outcome:execute",
      "suggested", null, null, null, null,
      [], null, now, null, now,
    ])
    expect(query.mock.calls[4]).toEqual([OUTCOME_QUEUE_SQL.read, [userId]])
    expect(OUTCOME_QUEUE_SQL.persist).toContain(
      `WHERE "outcome_queue_item"."lifecycleState" = 'suggested'`,
    )
    expect(OUTCOME_QUEUE_SQL.persist).toContain(
      `AND "outcome_queue_item"."authorityState" = 'unverified'`,
    )
    expect(OUTCOME_QUEUE_SQL.persist).not.toMatch(
      /"approvalState" = EXCLUDED\."approvalState"/,
    )
    await expect(persistOutcomeQueueItem({
      query,
      userId,
      item: {
        outcomeKey: "goal:GOAL-SELF-GRANT",
        title: "Attempt self grant",
        queueOrder: 11,
        dependencyKeys: [],
        riskClass: "R1",
        approvalState: "approved",
        approvedBy: "caller",
        approvedAt: now,
        authorityState: "matched",
        authorityGrantRef: "GRANT-FAKE",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "approved",
      },
    })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_INTAKE_MUST_BE_UNAUTHORIZED_SUGGESTION",
    })
    await expect(persistOutcomeQueueItem({
      query,
      userId,
      item: {
        outcomeKey: "goal:GOAL-TERMINAL-INJECTION",
        title: "Attempt terminal evidence injection",
        queueOrder: 12,
        dependencyKeys: [],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A0_READ_ONLY",
        lifecycleState: "suggested",
        terminalResult: "PASS",
        terminalEvidenceRefs: ["EV-FORGED"],
      },
    })).rejects.toMatchObject({
      code: "OUTCOME_QUEUE_INTAKE_MUST_NOT_BE_TERMINAL",
    })
  })

  it("matches authority only through an active, unexpired grant", async () => {
    const matched = queueRow({
      lifecycleState: "suggested",
      approvalState: "unapproved",
      authorityState: "matched",
      version: 1,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
    })
    const query = vi.fn(async () => ({ rows: [matched] }))

    await expect(matchOutcomeAuthorityGrant({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 0,
      authorityGrantRef: "GRANT-1000",
      now,
    })).resolves.toEqual(matched)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.matchAuthority, [
      userId,
      "goal:GOAL-1000",
      0,
      "GRANT-1000",
      now,
    ])
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(`grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(`grant."revokedAt" IS NULL`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(`grant."expiresAt" > $5::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.matchAuthority).toContain(
      `grant."authorityLevel" = q."authorityLevel"`,
    )
  })

  it("approves only through an accepted binding decision", async () => {
    const approved = queueRow({
      lifecycleState: "approved",
      version: 2,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
    })
    const query = vi.fn(async () => ({ rows: [approved] }))

    await expect(approveOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      approvalDecisionId: 100,
      now,
    })).resolves.toEqual(approved)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.approve, [
      userId,
      "goal:GOAL-1000",
      1,
      100,
      now,
    ])
    expect(OUTCOME_QUEUE_SQL.approve).toContain(`approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.approve).toContain(`approval."authority" = 'binding'`)
    expect(OUTCOME_QUEUE_SQL.approve).toContain(
      `approval."scope" = q."outcomeKey"`,
    )
    expect(OUTCOME_QUEUE_SQL.approve).toContain(
      `upper(trim(approval."decision")) = 'APPROVE'`,
    )
  })

  it("requires a client obtained through connect for injected transactions", async () => {
    const query = vi.fn()
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEDICATED_CLIENT_REQUIRED" })
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    [{ totalCount: 0 }, "EMPTY_QUEUE"],
    [{ totalCount: 3, candidateStateCount: 0 }, "NO_ELIGIBLE_OUTCOME"],
    [{ totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 0 }, "AWAITING_APPROVAL"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2, authorityEligibleCount: 0,
    }, "AUTHORITY_INELIGIBLE"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 0,
    }, "RISK_INELIGIBLE"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 2, dependencyEligibleCount: 0,
    }, "DEPENDENCIES_UNSATISFIED"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 2,
      dependencyEligibleCount: 2, activeLeaseCount: 1,
    }, "ACTIVE_LEASE_HELD"],
    [{
      totalCount: 3, candidateStateCount: 2, approvalEligibleCount: 2,
      authorityEligibleCount: 2, riskEligibleCount: 2,
      dependencyEligibleCount: 2, activeLeaseCount: 0,
    }, "NO_ELIGIBLE_OUTCOME"],
  ])("returns typed no-selection reason %#", async (counts, reason) => {
    const query = acquisitionQuery({ counts: [counts] })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
      acquisitionKey: "acquire-none",
    })).resolves.toMatchObject({ acquired: false, outcome: null, reason })
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readAcquisitionReceipt,
      OUTCOME_QUEUE_SQL.readAcquisition,
      OUTCOME_QUEUE_SQL.acquire,
      OUTCOME_QUEUE_SQL.readRenewableV12CampaignAuthorities,
      OUTCOME_QUEUE_SQL.noSelectionReason,
      ...(reason === "ACTIVE_LEASE_HELD"
        ? [OUTCOME_QUEUE_SQL.readActiveAcquisitionProof]
        : []),
      ...(reason === "ACTIVE_LEASE_HELD"
        ? [OUTCOME_QUEUE_SQL.insertAcquisitionAttempt]
        : []),
      "COMMIT",
    ])
    expect(query.mock.calls[1][1]).toEqual([`${userId}:outcome-queue`])
    expect(query.mock.calls[2][1]).toEqual([userId, "acquire-none"])
    expect(query.mock.calls[3][1]).toEqual([userId, "acquire-none"])
    expect(query.mock.calls[6][1]).toEqual([now, userId])
    const proofCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
    )
    expect(proofCall?.[1]?.[17] ?? null).toBe(
      reason === "ACTIVE_LEASE_HELD" ? "LOSER" : null,
    )
    if (reason === "ACTIVE_LEASE_HELD") {
      expect(proofCall?.[1]?.slice(1, 4)).toEqual([
        "campaign-v1-2",
        "supervisor-nonce-1",
        "supervisor-a",
      ])
      expect(proofCall?.[1]?.slice(13, 17)).toEqual([
        "goal:CONTENDED",
        7,
        queueRow().leaseExpiresAt,
        478,
      ])
    }
  })

  it("renews an exact prerequisite without relying on aggregate no-selection counts", async () => {
    const expired = expiredCampaignAuthorityRow()
    const renewedDraft = v12CampaignGrant(
      expired.outcomeKey as "campaign:v1-2:queue-evidence-drilldown",
      userId,
      new Date(now),
    )
    const rebound = {
      ...expired,
      authorityGrantRef: renewedDraft.ref,
      lifecycleReason: "HERMES_V1_2_CAMPAIGN_AUTHORITY_AUTO_RENEWAL",
      version: 2,
    }
    const acquired = queueRow({
      ...rebound,
      lifecycleState: "active",
      activeWorkOrderId: 472,
      executionBinding: "execution-a",
      leaseHolder: "supervisor-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:01:00.000Z",
      fencingToken: 1,
      version: 3,
      acquisitionKey: "acquire-a",
      activatedAt: now,
    })
    const query = acquisitionQuery({
      counts: [{
        totalCount: 2,
        candidateStateCount: 2,
        approvalEligibleCount: 2,
        authorityEligibleCount: 1,
        riskEligibleCount: 1,
        dependencyEligibleCount: 0,
      }],
      renewable: [expired],
      rebound: [rebound],
      selectedAfterRenewal: [acquired],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: true,
      outcome: expect.objectContaining({
        outcomeKey: expired.outcomeKey,
        authorityGrantRef: renewedDraft.ref,
      }),
    })

    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.readV12CampaignGrantCollision,
      [userId, renewedDraft.ref],
    )
    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.rebindRenewedV12CampaignGrant,
      [
        expired.id,
        userId,
        expired.outcomeKey,
        1,
        renewedDraft.ref,
        now,
        expired.authorityGrantRef,
      ],
    )
    const auditCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertV12CampaignAuthorityRenewalAudit,
    )
    expect(auditCall?.[1]?.[2]).toContain("unchanged, accepted V1.2 campaign scope")
    expect(String(auditCall?.[1]?.[5])).toContain('"automated":true')
    expect(String(auditCall?.[1]?.[5])).not.toContain("lease-a")
    expect(OUTCOME_QUEUE_SQL.readRenewableV12CampaignAuthorities)
      .toContain(`expired_grant."revokedAt" IS NULL`)
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.noSelectionReason,
      expect.anything(),
    )
  })

  it("renews a manually paused campaign without reacquiring it", async () => {
    const expired = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "Primary Operator paused this outcome.",
      activeWorkOrderId: 472,
      fencingToken: 3,
      version: 5,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const renewedDraft = v12CampaignGrant(
      expired.outcomeKey as "campaign:v1-2:queue-evidence-drilldown",
      userId,
      new Date(now),
    )
    const rebound = {
      ...expired,
      authorityGrantRef: renewedDraft.ref,
      lifecycleReason: "Primary Operator paused this outcome.",
      version: 6,
    }
    const query = acquisitionQuery({
      renewable: [expired],
      rebound: [rebound],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      outcome: null,
      reason: "EMPTY_QUEUE",
    })
    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.rebindRenewedV12CampaignGrant,
      [
        expired.id,
        userId,
        expired.outcomeKey,
        5,
        renewedDraft.ref,
        now,
        expired.authorityGrantRef,
      ],
    )
    expect(OUTCOME_QUEUE_SQL.rebindRenewedV12CampaignGrant)
      .toContain(`WHEN q."lifecycleState" = 'blocked' THEN q."lifecycleReason"`)
  })

  it("fails closed instead of renewing a tampered campaign grant", async () => {
    const expired = expiredCampaignAuthorityRow()
    const tampered = {
      ...expired,
      expiredGrant: {
        ...(expired.expiredGrant as Record<string, unknown>),
        blockedActions: ["production mutation"],
      },
    }
    const query = acquisitionQuery({
      counts: [{
        totalCount: 1,
        candidateStateCount: 1,
        approvalEligibleCount: 1,
        authorityEligibleCount: 0,
      }],
      renewable: [tampered],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).rejects.toMatchObject({
      code: "V1_2_CAMPAIGN_AUTHORITY_AUTO_RENEWAL_WALL",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("fails closed instead of renewing an inconsistent approved queue row", async () => {
    const inconsistent = expiredCampaignAuthorityRow({
      activeWorkOrderId: 999,
      fencingToken: 4,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const query = acquisitionQuery({ renewable: [inconsistent] })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).rejects.toMatchObject({
      code: "V1_2_CAMPAIGN_AUTHORITY_AUTO_RENEWAL_WALL",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
  })

  it("acquires transactionally and replays the same live binding", async () => {
    const acquired = queueRow()
    const firstQuery = acquisitionQuery({ selected: [acquired] })
    await expect(acquireNextEligibleOutcome({
      query: firstQuery,
      ...acquireInput,
    })).resolves.toEqual({
      outcome: acquired,
      acquired: true,
      replayed: false,
      reclaimed: false,
      reason: null,
    })
    expect(firstQuery.mock.calls[4]).toEqual([
      OUTCOME_QUEUE_SQL.acquire,
      [
        now, userId, "acquire-a", "execution-a", "supervisor-a", "lease-a",
        "2026-07-28T12:01:00.000Z", 472,
      ],
    ])
    expect(firstQuery).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertAcquisitionReceipt,
      [userId, "acquire-a", acquired.outcomeKey, acquired.fencingToken, now],
    )
    const freshProof = firstQuery.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
    )
    expect(freshProof?.[1]?.slice(1, 4)).toEqual([
      "campaign-v1-2",
      "supervisor-nonce-1",
      "supervisor-a",
    ])

    const replayQuery = acquisitionQuery({
      receipt: [{ outcomeKey: acquired.outcomeKey }],
      receiptOutcome: [acquired],
    })
    await expect(acquireNextEligibleOutcome({
      query: replayQuery,
      ...acquireInput,
    })).resolves.toMatchObject({ outcome: acquired, acquired: true, replayed: true })
    expect(replayQuery.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readAcquisitionReceipt,
      OUTCOME_QUEUE_SQL.readReceiptOutcome,
      OUTCOME_QUEUE_SQL.revalidateAcquisition,
      OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
      "COMMIT",
    ])
    const proofCall = replayQuery.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
    )
    expect(proofCall?.[1]?.slice(13, 19)).toEqual([
      acquired.outcomeKey,
      acquired.fencingToken,
      acquired.leaseExpiresAt,
      acquired.activeWorkOrderId,
      "REPLAY_WINNER",
      null,
    ])
    const checkpointProof = canonicalOutcomeQueueCheckpointProof({
      outcomeId: String(acquired.goalId),
      outcomeKey: acquired.outcomeKey,
      workOrderId: acquired.activeWorkOrderId,
      fencingToken: acquired.fencingToken,
      sequence: 4,
      state: "HOST_VALIDATION_PASSED",
      commit: { headSha: "a".repeat(40), mergeSha: null, prNumber: null },
    })
    expect(proofCall?.[1]?.[6]).toBe(digestOutcomeQueueCheckpointProof(checkpointProof))
    expect(proofCall?.[1]?.slice(7, 13)).toEqual([
      String(acquired.goalId),
      4,
      "HOST_VALIDATION_PASSED",
      "a".repeat(40),
      null,
      null,
    ])
    const serializedProof = JSON.stringify(proofCall?.[1])
    expect(serializedProof).not.toContain(String(acquireInput.acquisitionKey))
    expect(serializedProof).not.toContain(String(acquireInput.leaseToken))
    expect(serializedProof).not.toContain(String(acquireInput.executionBinding))
  })

  it("rejects acquisition evidence without trusted resident scope and checkpoint context", async () => {
    const query = acquisitionQuery({ selected: [queueRow()] })
    for (const [override, code] of [
      [{ campaignWindowId: "" }, "OUTCOME_QUEUE_CAMPAIGN_WINDOW_INVALID"],
      [{ processIdentity: "" }, "OUTCOME_QUEUE_PROCESS_IDENTITY_INVALID"],
      [{ checkpointProofProvider: undefined }, "OUTCOME_QUEUE_CHECKPOINT_PROVIDER_REQUIRED"],
    ] as const) {
      await expect(acquireNextEligibleOutcome({
        query,
        ...acquireInput,
        ...override,
      })).rejects.toMatchObject({ code })
    }
    expect(query).not.toHaveBeenCalled()
  })

  it.each([
    [{ approvalLive: false, authorityLive: true }, "AWAITING_APPROVAL"],
    [{ approvalLive: true, authorityLive: false }, "AUTHORITY_INELIGIBLE"],
  ])("rejects same-key replay when live authority changes %#", async (live, reason) => {
    const query = acquisitionQuery({
      receipt: [{ outcomeKey: "goal:GOAL-1000" }],
      receiptOutcome: [queueRow()],
      replayEligibility: [live],
    })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      replayed: false,
      reason,
    })
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
  })

  it("returns not-acquired for live same-key contention", async () => {
    const query = acquisitionQuery({
      receipt: [{ outcomeKey: "goal:GOAL-1000" }],
      receiptOutcome: [
        queueRow({ leaseToken: "other-token", executionBinding: "other-execution" }),
      ],
    })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      replayed: false,
      reason: "ACQUISITION_KEY_CONFLICT",
    })
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
  })

  it("replays a completed acquisition key without selecting another outcome", async () => {
    const completed = queueRow({
      lifecycleState: "completed",
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "PASS",
      terminalEvidenceRefs: ["EV-1"],
      terminalKey: "complete-a",
    })
    const query = acquisitionQuery({
      receipt: [{ outcomeKey: completed.outcomeKey }],
      receiptOutcome: [completed],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toEqual({
      outcome: completed,
      acquired: false,
      replayed: true,
      reclaimed: false,
      reason: "OUTCOME_ALREADY_COMPLETED",
    })
    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readAcquisitionReceipt,
      OUTCOME_QUEUE_SQL.readReceiptOutcome,
      OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
      "COMMIT",
    ])
  })

  it("keeps a retired acquisition key bound to its original outcome", async () => {
    const paused = queueRow({
      lifecycleState: "blocked",
      acquisitionKey: null,
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      fencingToken: 2,
      version: 2,
    })
    const query = acquisitionQuery({
      receipt: [{ outcomeKey: paused.outcomeKey }],
      receiptOutcome: [paused],
      selected: [queueRow({ outcomeKey: "goal:GOAL-OTHER" })],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toEqual({
      outcome: paused,
      acquired: false,
      replayed: true,
      reclaimed: false,
      reason: "ACQUISITION_KEY_RETIRED",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.acquire,
      expect.anything(),
    )
  })

  it("reclaims a stale same-key lease with a higher fence and version", async () => {
    const stale = queueRow({
      leaseExpiresAt: "2026-07-28T11:59:59.000Z",
      fencingToken: 3,
      version: 8,
    })
    const reclaimed = queueRow({
      leaseHolder: "supervisor-after-restart",
      leaseToken: "lease-after-restart",
      executionBinding: "execution-after-restart",
      leaseExpiresAt: "2026-07-28T12:01:00.000Z",
      fencingToken: 4,
      version: 9,
      lifecycleReason: "STALE_LEASE_RECOVERED",
    })
    const query = acquisitionQuery({
      receipt: [{ outcomeKey: stale.outcomeKey }],
      receiptOutcome: [stale],
      reclaimed: [reclaimed],
    })
    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
      leaseHolder: "supervisor-after-restart",
      leaseToken: "lease-after-restart",
      executionBinding: "execution-after-restart",
      processIdentity: "supervisor-nonce-2",
    })).resolves.toEqual({
      outcome: reclaimed,
      acquired: true,
      replayed: false,
      reclaimed: true,
      reason: null,
    })
    expect(query.mock.calls[4]).toEqual([
      OUTCOME_QUEUE_SQL.reclaimAcquisition,
      [
        now, userId, "goal:GOAL-1000", "execution-after-restart",
        "supervisor-after-restart", "lease-after-restart",
        "2026-07-28T12:01:00.000Z", 472, 8,
      ],
    ])
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(`q."version" + 1`)
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(
      `live."id" <> q."id"`,
    )
    expect(OUTCOME_QUEUE_SQL.reclaimAcquisition).toContain(
      `COALESCE($8, q."activeWorkOrderId") = live_grant."workOrderId"`,
    )
    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.advanceAcquisitionReceipt,
      [userId, "acquire-a", reclaimed.fencingToken, now, reclaimed.outcomeKey],
    )
    const reclaimProof = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertAcquisitionAttempt,
    )
    expect(reclaimProof?.[1]?.[2]).toBe("supervisor-nonce-2")
    expect(reclaimProof?.[1]?.[14]).toBe(4)
    expect(reclaimProof?.[1]?.[17]).toBe("RECLAIMED")
  })

  it("guards transitions by user, version, and live fence", async () => {
    const blocked = queueRow({ lifecycleState: "blocked", version: 2 })
    const query = vi.fn(async () => ({ rows: [blocked] }))
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "active",
      toState: "blocked",
      expectedVersion: 1,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      lifecycleReason: "VALIDATION_RETRY_SCHEDULED",
      now,
    })).resolves.toEqual(blocked)
    expect(query.mock.calls[0][1]).toEqual([
      userId, "goal:GOAL-1000", "active", "blocked", 1, "execution-a",
      "lease-a", 1, now, "VALIDATION_RETRY_SCHEDULED",
    ])
    expect(OUTCOME_QUEUE_SQL.transition).toContain(`q."userId" = $1`)
    expect(OUTCOME_QUEUE_SQL.transition).toContain(`q."version" = $5`)
    expect(OUTCOME_QUEUE_SQL.transition).toContain(`q."leaseExpiresAt" > $9::timestamptz`)
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "blocked",
      toState: "approved",
      expectedVersion: 2,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_APPROVAL_DECISION_REQUIRED" })
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "approved",
      toState: "active",
      expectedVersion: 2,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ACTIVE_REQUIRES_ACQUISITION" })
    await expect(transitionOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      fromState: "approved",
      toState: "superseded",
      expectedVersion: 2,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_SUPERSEDE_REQUIRES_MUTATION" })
  })

  it("guards completion and makes only an exact terminal replay idempotent", async () => {
    const completed = queueRow({
      lifecycleState: "completed",
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      terminalResult: "PASS",
      terminalEvidenceRefs: ["EV-1", "EV-2"],
      terminalKey: "complete-a",
      terminalAt: now,
      version: 2,
    })
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [completed] })
    await expect(completeOutcomeQueueItem({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      acquisitionKey: "acquire-a",
      terminalKey: "complete-a",
      terminalResult: "PASS",
      terminalEvidenceRefs: ["EV-2", "EV-1", "EV-1"],
      now,
    })).resolves.toEqual({ outcome: completed, replayed: true })
    expect(query.mock.calls[0][1]).toEqual([
      userId, "goal:GOAL-1000", 1, "execution-a", "lease-a", 1,
      "acquire-a", "complete-a", "PASS", null, ["EV-1", "EV-2"], now,
    ])
    expect(query.mock.calls[1]).toEqual([
      OUTCOME_QUEUE_SQL.readOne,
      [userId, "goal:GOAL-1000"],
    ])
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`q."version" = $3`)
    expect(OUTCOME_QUEUE_SQL.complete).toContain(`q."leaseExpiresAt" > $12::timestamptz`)
  })

  it("renews only the exact live queue fence without changing its version", async () => {
    const renewed = queueRow({
      lifecycleState: "active",
      version: 4,
      fencingToken: 3,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    })
    const query = vi.fn(async () => ({ rows: [renewed] }))

    await expect(renewOutcomeQueueLease({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 3,
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual(renewed)

    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.renewLease, [
      userId,
      "goal:GOAL-1000",
      4,
      "execution-a",
      "lease-a",
      3,
      now,
      "2026-07-28T12:50:00.000Z",
    ])
    expect(renewOutcomeLeaseCompatibility).toBe(renewOutcomeQueueLease)
    expect(OUTCOME_QUEUE_SQL.renewLease).not.toContain(`"version" = q."version" + 1`)
    expect(OUTCOME_QUEUE_SQL.renewLease).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.renewLease).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.renewLease)
      .toContain(`live_grant."expiresAt" > $7::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.renewLease).not.toContain("$1::timestamptz")
  })

  it("defers the exact live queue fence until the provider retry time", async () => {
    const deferred = queueRow({
      lifecycleState: "active",
      version: 4,
      fencingToken: 3,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:15:00.000Z",
      lifecycleReason: "PROVIDER_UNAVAILABLE",
    })
    const query = vi.fn(async () => ({ rows: [deferred] }))

    await expect(deferOutcomeQueueLease({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 3,
      retryAfter: "2026-07-28T12:15:00.000Z",
      now,
    })).resolves.toEqual(deferred)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.deferLease, [
      userId,
      "goal:GOAL-1000",
      4,
      "execution-a",
      "lease-a",
      3,
      "2026-07-28T12:15:00.000Z",
      "PROVIDER_UNAVAILABLE",
      now,
    ])
    expect(deferOutcomeLeaseCompatibility).toBe(deferOutcomeQueueLease)
    expect(OUTCOME_QUEUE_SQL.deferLease)
      .toContain(`live_grant."expiresAt" > $9::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.deferLease).not.toContain("$1::timestamptz")
  })

  it("binds the exact active queue fence to its projected Hermes Work Order", async () => {
    const bound = queueRow({ lifecycleState: "active", activeWorkOrderId: 472, version: 4 })
    const query = vi.fn(async () => ({ rows: [bound] }))

    await expect(bindOutcomeQueueWorkOrder({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 4,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      activeWorkOrderId: 472,
      now,
    })).resolves.toEqual(bound)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.bindWorkOrder, [
      userId, "goal:GOAL-1000", 4, "execution-a", "lease-a", 1, 472, now,
    ])
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`q."leaseExpiresAt" > $8::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`projected_work."userId" = q."userId"`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder)
      .toContain(`projected_work.ref = 'WO-HERMES-OUTCOME-' || q."goalId"::text`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`projected_work.goal = q."goalRef"`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).toContain(
      `$7 = live_grant."workOrderId"`,
    )
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder)
      .toContain(`live_grant."expiresAt" > $8::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.bindWorkOrder).not.toContain("$1::timestamptz")
  })

  it("resumes a blocked queue item only through its exact accepted owner decision", async () => {
    const resumed = queueRow({
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    })
    const run = vi.fn(async (sql: string) => ({
      rows: sql === OUTCOME_QUEUE_SQL.resumeAfterDecision ? [resumed] : [],
    }))
    const query = dedicatedQuery(run)

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual(resumed)
    expect(run).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.resumeAfterDecision, [
      userId,
      "goal:GOAL-1000",
      5,
      "execution-a",
      "acquire-a",
      3,
      91,
      "resident-hermes",
      "lease-a",
      "2026-07-28T12:50:00.000Z",
      now,
      "OWNER_DECISION_REQUIRED",
    ])
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`(approval.context::jsonb)->>'outcomeId' = q."goalId"::text`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`approval.scope = 'goal:' || q."goalId"::text`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`decision_work."linkedDecisionId" = approval.id`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`approval.owner = q."userId"`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`'terminal-binding:hermes-owner-decision-terminal:'`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`terminal.metadata->>'nextState' = $12`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`q."lifecycleReason" = $12`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live_grant."expiresAt" > $11::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`q."riskClass" IN ('R0', 'R1')`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`completed_dependency."lifecycleState" IS DISTINCT FROM 'completed'`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`live."id" <> q."id"`)
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision).not.toContain("$1::timestamptz")
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.resumeAfterDecision,
      "COMMIT",
    ])
  })

  it("verifies an existing canonical Work Order binding at the exact projected status", async () => {
    const verified = queueRow({
      lifecycleState: "active",
      activeWorkOrderId: 472,
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    })
    const query = vi.fn(async () => ({ rows: [verified] }))

    await expect(verifyOutcomeQueueWorkOrderBinding({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      executionBinding: "execution-a",
      leaseToken: "lease-a",
      fencingToken: 1,
      activeWorkOrderId: 472,
      expectedWorkOrderStatus: "review",
      now,
    })).resolves.toEqual(verified)
    expect(query).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.verifyBoundWorkOrder, [
      userId,
      "goal:GOAL-1000",
      1,
      "execution-a",
      "lease-a",
      1,
      472,
      "review",
      now,
    ])
    expect(OUTCOME_QUEUE_SQL.verifyBoundWorkOrder)
      .toContain(`projected_work.status = $8`)
    expect(OUTCOME_QUEUE_SQL.verifyBoundWorkOrder)
      .toContain(`q."leaseExpiresAt" > $9::timestamptz`)
  })

  it("exact-replays a committed owner-decision resume with live authority and its fresh fence", async () => {
    const resumed = queueRow({
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      version: 6,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
    })
    const run = vi.fn(async (sql: string) => {
      if (sql === OUTCOME_QUEUE_SQL.replayResumeAfterDecision) return { rows: [resumed] }
      return { rows: [] }
    })
    const query = dedicatedQuery(run)

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual(resumed)
    expect(run).toHaveBeenCalledWith(OUTCOME_QUEUE_SQL.replayResumeAfterDecision, [
      userId,
      "goal:GOAL-1000",
      5,
      "execution-a",
      "acquire-a",
      3,
      91,
      "resident-hermes",
      "lease-a",
      "2026-07-28T12:50:00.000Z",
      now,
      "OWNER_DECISION_REQUIRED",
    ])
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`q."version" = $3::integer + 1`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`q."fencingToken" = $6::integer + 1`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`approval.id = $7`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`q."leaseExpiresAt" > $11::timestamptz`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`live_approval."status" = 'accepted'`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`live_grant."status" = 'active'`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`terminal.metadata->>'nextState' = $12`)
  })

  it("exact-replays a lost renewed resume response at source version plus two", async () => {
    const resumed = queueRow({
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      authorityRenewalApplied: true,
    })
    const query = acquisitionQuery({ replayResume: [resumed] })

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual(resumed)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`q."version" = $3::integer + 2`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`renewal_event."eventType" = 'AUTHORITY_RENEWED'`)
    expect(OUTCOME_QUEUE_SQL.replayResumeAfterDecision)
      .toContain(`renewal_event.metadata->>'grantRef' = q."authorityGrantRef"`)
  })

  it("rejects unmarked source-version-plus-two resume drift", async () => {
    const foreign = queueRow({
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      version: 7,
      fencingToken: 4,
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      authorityRenewalApplied: false,
    })
    const query = acquisitionQuery({ replayResume: [foreign] })

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL" })
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("does not resume a live grant from a different blocked lifecycle reason", async () => {
    const run = vi.fn(async () => ({ rows: [] }))
    const query = dedicatedQuery(run)

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL" })
    expect(OUTCOME_QUEUE_SQL.resumeAfterDecision)
      .toContain(`q."lifecycleReason" = $12`)
    expect(run).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.resumeAfterDecision,
      expect.arrayContaining(["OWNER_DECISION_REQUIRED"]),
    )
  })

  it("rejects a mismatched owner-decision resume replay", async () => {
    const run = vi.fn(async () => ({ rows: [] }))
    const query = dedicatedQuery(run)

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-a",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL" })
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.resumeAfterDecision,
      OUTCOME_QUEUE_SQL.readRenewableV12CampaignAuthorities,
      OUTCOME_QUEUE_SQL.replayResumeAfterDecision,
      "ROLLBACK",
    ])
  })

  it("renews an exact paused campaign grant before decision resume", async () => {
    const expired = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "OWNER_DECISION_REQUIRED",
      activeWorkOrderId: 472,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      version: 5,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const renewedDraft = v12CampaignGrant(
      expired.outcomeKey as "campaign:v1-2:queue-evidence-drilldown",
      userId,
      new Date(now),
    )
    const rebound = {
      ...expired,
      authorityGrantRef: renewedDraft.ref,
      version: 6,
    }
    const resumed = queueRow({
      ...rebound,
      lifecycleState: "active",
      lifecycleReason: "OWNER_DECISION_RESUMED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-after-renewal",
      leaseExpiresAt: "2026-07-28T12:50:00.000Z",
      fencingToken: 4,
      version: 7,
    })
    const query = acquisitionQuery({
      renewable: [expired],
      rebound: [rebound],
      resumeAfterRenewal: [resumed],
    })

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: expired.outcomeKey as string,
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-after-renewal",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).resolves.toEqual({
      ...resumed,
      authorityRenewalApplied: true,
    })

    const resumeCalls = query.mock.calls.filter(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.resumeAfterDecision,
    )
    expect(resumeCalls).toHaveLength(2)
    expect(resumeCalls[1][1]?.[2]).toBe(6)
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT")
  })

  it("does not let renewal bypass a stale resume version", async () => {
    const expired = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "OWNER_DECISION_REQUIRED",
      activeWorkOrderId: 472,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      version: 6,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const query = acquisitionQuery({ renewable: [expired] })

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: expired.outcomeKey as string,
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-after-renewal",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).rejects.toMatchObject({
      code: "V1_2_CAMPAIGN_AUTHORITY_RENEWAL_VERSION_WALL",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("does not auto-renew a retained blocked campaign row outside exact decision resume", async () => {
    const failed = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      activeWorkOrderId: 472,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      version: 5,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const query = acquisitionQuery({
      counts: [{
        totalCount: 1,
        candidateStateCount: 0,
        approvalEligibleCount: 0,
        authorityEligibleCount: 0,
        riskEligibleCount: 0,
        dependencyEligibleCount: 0,
        activeLeaseCount: 0,
      }],
      renewable: [failed],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      outcome: null,
      reason: "NO_ELIGIBLE_OUTCOME",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
  })

  it("does not auto-renew a blocked terminal reason after execution fields are cleared", async () => {
    const failed = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      version: 5,
    })
    const query = acquisitionQuery({
      counts: [{
        totalCount: 1,
        candidateStateCount: 0,
        approvalEligibleCount: 0,
        authorityEligibleCount: 0,
        riskEligibleCount: 0,
        dependencyEligibleCount: 0,
        activeLeaseCount: 0,
      }],
      renewable: [failed],
    })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      outcome: null,
      reason: "NO_ELIGIBLE_OUTCOME",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
  })

  it("does not auto-renew a cleared owner-decision campaign row", async () => {
    const ownerDecision = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "OWNER_DECISION_REQUIRED",
      activeWorkOrderId: 472,
      fencingToken: 3,
      version: 5,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const query = acquisitionQuery({ renewable: [ownerDecision] })

    await expect(acquireNextEligibleOutcome({
      query,
      ...acquireInput,
    })).resolves.toMatchObject({
      acquired: false,
      outcome: null,
      reason: "EMPTY_QUEUE",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
  })

  it("rejects campaign renewal when the accepted decision state does not match the row", async () => {
    const failed = expiredCampaignAuthorityRow({
      lifecycleState: "blocked",
      lifecycleReason: "VALIDATION_FAILED",
      activeWorkOrderId: 472,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      version: 5,
      activatedAt: "2026-07-27T12:00:00.000Z",
    })
    const query = acquisitionQuery({ renewable: [failed] })

    await expect(resumeOutcomeQueueAfterDecision({
      query,
      userId,
      outcomeKey: failed.outcomeKey as string,
      expectedVersion: 5,
      executionBinding: "execution-a",
      acquisitionKey: "acquire-a",
      fencingToken: 3,
      ownerDecisionId: 91,
      expectedLifecycleReason: "OWNER_DECISION_REQUIRED",
      leaseHolder: "resident-hermes",
      leaseToken: "lease-after-renewal",
      leaseDurationMs: 50 * 60 * 1000,
      now,
    })).rejects.toMatchObject({
      code: "V1_2_CAMPAIGN_AUTHORITY_AUTO_RENEWAL_WALL",
    })
    expect(query).not.toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.insertRenewedV12CampaignGrant,
      expect.anything(),
    )
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("keeps GOAL-0001 through GOAL-0005 user-scoped and history-only", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        legacyGoalId: 1,
        userId,
        ref: "GOAL-0001",
        command: "Historical bootstrap",
        status: "converted",
        linkedWorkOrderId: 451,
        workOrderStatus: "closed",
        workOrderResult: "PASS",
        workOrderCompletedAt: "2026-01-02T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      }],
    }))
    const history = await readLegacyOutcomeHistory({ query, userId })
    expect(query).toHaveBeenCalledWith(
      OUTCOME_QUEUE_SQL.legacyHistory,
      [userId, OUTCOME_QUEUE_LEGACY_GOAL_REFS],
    )
    expect(OUTCOME_QUEUE_SQL.legacyHistory).toContain(`g."userId" = $1`)
    expect(history).toEqual([expect.objectContaining({
      userId,
      outcomeKey: "goal:GOAL-0001",
      goalRef: "GOAL-0001",
      lifecycleState: "completed",
      compatibility: "LEGACY_GOAL_HISTORY",
      historyOnly: true,
      selectable: false,
      approvalState: "unapproved",
      authorityState: "unverified",
      executionAuthority: false,
    })])
    expect(OUTCOME_QUEUE_SQL.acquire).not.toMatch(/FROM "goal"/)
  })

  it("keeps a converted legacy draft nonterminal and nonselectable", async () => {
    const query = vi.fn(async () => ({
      rows: [{
        legacyGoalId: 5,
        userId,
        ref: "GOAL-0005",
        command: "Historical draft conversion",
        status: "converted",
        linkedWorkOrderId: 455,
        workOrderStatus: "draft",
        workOrderResult: null,
        workOrderCompletedAt: null,
        createdAt: now,
        updatedAt: now,
      }],
    }))

    await expect(readLegacyOutcomeHistory({ query, userId })).resolves.toEqual([
      expect.objectContaining({
        lifecycleState: "blocked",
        lifecycleReason: "LEGACY_CONVERSION_REQUIRES_TERMINAL_WORK_ORDER",
        historyOnly: true,
        selectable: false,
      }),
    ])
  })

  it("serializes persistence and rejects a dependency on a superseded outcome", async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readSupersededDependencies) {
        return {
          rows: [{
            outcomeKey: "goal:GOAL-OLD",
            supersededByOutcomeKey: "goal:GOAL-NEW",
          }],
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const query = Object.assign(run, {
      connect: async () => ({ query: run, release: vi.fn() }),
    })

    await expect(persistOutcomeQueueItem({
      query,
      userId,
      now,
      item: {
        outcomeKey: "goal:GOAL-DEPENDENT",
        title: "Dependent outcome",
        queueOrder: 20,
        dependencyKeys: ["goal:GOAL-OLD"],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "suggested",
      },
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEPENDENCY_SUPERSEDED" })
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readSupersededDependencies,
      "ROLLBACK",
    ])
    expect(OUTCOME_QUEUE_SQL.readSupersededDependencies).toContain(
      `q."lifecycleState" = 'superseded'`,
    )
  })

  it("rejects a dependency cycle under the same serialized intake lock", async () => {
    const run = vi.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.acquireLock) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readSupersededDependencies) return { rows: [] }
      if (sql === OUTCOME_QUEUE_SQL.readDependencyGraph) {
        return {
          rows: [{
            outcomeKey: "goal:GOAL-B",
            dependencyKeys: ["goal:GOAL-A"],
          }],
        }
      }
      throw new Error(`unexpected query: ${sql}`)
    })
    const query = dedicatedQuery(run)

    await expect(persistOutcomeQueueItem({
      query,
      userId,
      now,
      item: {
        outcomeKey: "goal:GOAL-A",
        title: "Cycle A",
        dependencyKeys: ["goal:GOAL-B"],
        riskClass: "R1",
        approvalState: "unapproved",
        authorityState: "unverified",
        authorityLevel: "A2_WRITE_OWN",
        lifecycleState: "suggested",
      },
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEPENDENCY_DEADLOCK" })
    expect(run.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readSupersededDependencies,
      OUTCOME_QUEUE_SQL.readDependencyGraph,
      "ROLLBACK",
    ])
  })
})

describe("governed outcome queue mutations", () => {
  it("defines a permanent user-scoped acquisition-key receipt", () => {
    const config = getTableConfig(outcomeQueueAcquisitionReceipt)
    expect(getTableName(outcomeQueueAcquisitionReceipt))
      .toBe("outcome_queue_acquisition_receipt")
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "userId",
      "acquisitionKey",
      "outcomeKey",
      "firstFencingToken",
      "latestFencingToken",
    ]))
    expect(config.uniqueConstraints.some((constraint) => (
      constraint.name === "outcome_queue_acquisition_receipt_user_key_unique"
    ))).toBe(true)
  })

  it("defines an additive user-scoped exactly-once receipt register", () => {
    const config = getTableConfig(outcomeQueueMutationReceipt)
    expect(getTableName(outcomeQueueMutationReceipt)).toBe("outcome_queue_mutation_receipt")
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "userId",
      "idempotencyKey",
      "operation",
      "requestHash",
      "requestBinding",
      "resultBinding",
    ]))
    expect(config.uniqueConstraints.some((constraint) => (
      constraint.name === "outcome_queue_mutation_receipt_user_key_unique"
    ))).toBe(true)
  })

  it("defines durable sanitized intake, mutation, and acquisition proof registers", () => {
    const intake = getTableConfig(goalOutcomeIntakeReceipt)
    expect(intake.uniqueConstraints).toHaveLength(3)
    expect(intake.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "idempotencyKey",
      "requestHash",
      "goalId",
      "outcomeKey",
      "resultDigest",
      "replayCount",
      "lastReplayedAt",
    ]))

    const mutations = getTableConfig(outcomeQueueMutationAttempt)
    expect(mutations.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "idempotencyKey",
      "requestHash",
      "resultDigest",
      "attemptOrdinal",
      "disposition",
      "attemptedAt",
    ]))

    const acquisitions = getTableConfig(outcomeQueueAcquisitionAttempt)
    const acquisitionColumns = acquisitions.columns.map((column) => column.name)
    expect(acquisitionColumns).toEqual(expect.arrayContaining([
      "campaignWindowId",
      "processIdentity",
      "leaseHolder",
      "acquisitionKeyDigest",
      "leaseIdentityDigest",
      "checkpointDigest",
      "checkpointOutcomeId",
      "checkpointSequence",
      "checkpointState",
      "checkpointHeadSha",
      "checkpointMergeSha",
      "checkpointPrNumber",
      "outcomeKey",
      "fencingToken",
      "leaseExpiresAt",
      "activeWorkOrderId",
      "disposition",
    ]))
    expect(acquisitionColumns).not.toEqual(expect.arrayContaining([
      "acquisitionKey",
      "leaseToken",
      "executionBinding",
    ]))
    expect(OUTCOME_QUEUE_SQL.readAcquisitionAttemptEvidence).not.toMatch(
      /"acquisitionKey"|"leaseToken"|"executionBinding"/,
    )
    expect(OUTCOME_QUEUE_SQL.readMutationAttemptEvidence).toContain(
      `"requestHash", "resultDigest"`,
    )
  })

  it("pauses under a user lock, clears the active lease, and records receipt/audit/event atomically", async () => {
    const paused = queueRow({
      lifecycleState: "blocked",
      lifecycleReason: "Operator pause",
      executionBinding: null,
      leaseHolder: null,
      leaseToken: null,
      leaseExpiresAt: null,
      acquisitionKey: null,
      fencingToken: 2,
      version: 2,
    })
    const query = mutationQuery({ mutated: paused })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "pause",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      idempotencyKey: "pause-1",
      reason: "Operator pause",
      now,
    })).resolves.toEqual({
      outcome: safeMutationRow(paused),
      affectedOutcomes: [safeMutationRow(paused)],
      successor: null,
      replayed: false,
    })

    expect(query.mock.calls.map(([sql]) => sql)).toEqual([
      "BEGIN",
      OUTCOME_QUEUE_SQL.acquireLock,
      OUTCOME_QUEUE_SQL.readMutationReceipt,
      OUTCOME_QUEUE_SQL.readMutationItem,
      OUTCOME_QUEUE_SQL.pauseMutation,
      OUTCOME_QUEUE_SQL.insertMutationReceipt,
      OUTCOME_QUEUE_SQL.nextMutationAttemptOrdinal,
      OUTCOME_QUEUE_SQL.insertMutationAttempt,
      OUTCOME_QUEUE_SQL.insertMutationAudit,
      OUTCOME_QUEUE_SQL.insertMutationEvent,
      "COMMIT",
    ])
    expect(query.mock.calls[1][1]).toEqual([`${userId}:outcome-queue`])
    expect(OUTCOME_QUEUE_SQL.pauseMutation).toContain(`q."fencingToken" + 1`)
    expect(OUTCOME_QUEUE_SQL.pauseMutation).toContain(`"leaseToken" = NULL`)
    expect(OUTCOME_QUEUE_SQL.pauseMutation).toContain(`q."version" = $3`)
  })

  it("requires a binding decision and live action-compatible grant for approve and resume", async () => {
    const approved = queueRow({
      lifecycleState: "approved",
      version: 1,
    })
    const query = mutationQuery({
      current: queueRow({
        lifecycleState: "suggested",
        approvalState: "unapproved",
        authorityState: "unverified",
        version: 0,
      }),
      mutated: approved,
    })
    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "approve",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 0,
      idempotencyKey: "approve-1",
      approvalDecisionId: 100,
      authorityGrantRef: "GRANT-WOS-V1.2",
      now,
    })).resolves.toEqual({
      outcome: safeMutationRow(approved),
      affectedOutcomes: [safeMutationRow(approved)],
      successor: null,
      replayed: false,
    })
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `approval."status" = 'accepted'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `approval."authority" = 'binding'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `upper(trim(approval."decision")) = 'APPROVE'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `approval."scope" = q."outcomeKey"`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `grant."status" = 'active'`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `grant."scope" = q."outcomeKey"`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `q."authorityLevel" IN ('A0_READ_ONLY', 'A1_DRAFT', 'A2_WRITE_OWN')`,
    )
    expect(OUTCOME_QUEUE_SQL.governedApprovalMutation).toContain(
      `grant."allowedActions"`,
    )

    const unauthorized = mutationQuery({
      current: queueRow({ lifecycleState: "blocked", version: 2 }),
      governed: false,
    })
    await expect(mutateOutcomeQueueItem({
      query: unauthorized,
      userId,
      action: "resume",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 2,
      idempotencyKey: "resume-1",
      approvalDecisionId: 100,
      authorityGrantRef: "expired-grant",
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_APPROVAL_AUTHORITY_INVALID" })
    expect(unauthorized.mock.calls.at(-1)?.[0]).toBe("ROLLBACK")
  })

  it("requires a complete version-bound reorder snapshot", async () => {
    expect(OUTCOME_QUEUE_SQL.readMutationSnapshot).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    expect(OUTCOME_QUEUE_SQL.readMutationSnapshot).toContain(
      `q."lifecycleState" = 'active'`,
    )
    expect(OUTCOME_QUEUE_SQL.readMutationSnapshot).toContain(
      `'campaign:v1-2:queue-evidence-drilldown'`,
    )
    expect(OUTCOME_QUEUE_SQL.reorderMutation).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    const target = queueRow({ lifecycleState: "approved", queueOrder: 10, version: 3 })
    const other = queueRow({
      id: 2,
      outcomeKey: "goal:GOAL-1001",
      lifecycleState: "approved",
      queueOrder: 20,
      version: 7,
    })
    const query = mutationQuery({ snapshot: [target, other] })
    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "reorder",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-1",
      orderedOutcomes: [
        { outcomeKey: other.outcomeKey, expectedVersion: 7 },
        { outcomeKey: target.outcomeKey, expectedVersion: 3 },
      ],
      now,
    })).resolves.toEqual({
      outcome: expect.objectContaining({
        outcomeKey: target.outcomeKey,
        queueOrder: 1,
        version: 4,
      }),
      affectedOutcomes: [
        expect.objectContaining({
          outcomeKey: other.outcomeKey,
          queueOrder: 0,
          version: 8,
        }),
        expect.objectContaining({
          outcomeKey: target.outcomeKey,
          queueOrder: 1,
          version: 4,
        }),
      ],
      successor: null,
      replayed: false,
    })
    expect(query.mock.calls.filter(([sql]) => sql === OUTCOME_QUEUE_SQL.reorderMutation))
      .toHaveLength(2)

    await expect(mutateOutcomeQueueItem({
      query: mutationQuery({ snapshot: [target, other] }),
      userId,
      action: "reorder",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-target-only",
      queueOrder: 30,
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ORDERED_SNAPSHOT_REQUIRED" })

    const incomplete = mutationQuery({ snapshot: [target, other] })
    await expect(mutateOutcomeQueueItem({
      query: incomplete,
      userId,
      action: "reorder",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-2",
      orderedOutcomes: [{ outcomeKey: target.outcomeKey, expectedVersion: 3 }],
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ORDERED_SNAPSHOT_INCOMPLETE" })
  })

  it("preserves protected V1.2 order slots while ordinary outcomes reorder", async () => {
    const first = queueRow({
      outcomeKey: "goal:GOAL-1100",
      lifecycleState: "approved",
      queueOrder: 10,
      version: 3,
    })
    const protectedRow = queueRow({
      id: 2,
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "suggested",
      queueOrder: 20,
      version: 0,
    })
    const second = queueRow({
      id: 3,
      outcomeKey: "goal:GOAL-1101",
      lifecycleState: "approved",
      queueOrder: 30,
      version: 7,
    })
    const query = mutationQuery({ snapshot: [first, protectedRow, second] })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "reorder",
      outcomeKey: first.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-around-protected",
      orderedOutcomes: [
        { outcomeKey: second.outcomeKey, expectedVersion: 7 },
        { outcomeKey: protectedRow.outcomeKey, expectedVersion: 0 },
        { outcomeKey: first.outcomeKey, expectedVersion: 3 },
      ],
      now,
    })).resolves.toMatchObject({
      outcome: { outcomeKey: first.outcomeKey, queueOrder: 21, version: 4 },
      affectedOutcomes: [
        { outcomeKey: second.outcomeKey, queueOrder: 19, version: 8 },
        { outcomeKey: first.outcomeKey, queueOrder: 21, version: 4 },
      ],
    })
    expect(query.mock.calls.filter(([sql]) => sql === OUTCOME_QUEUE_SQL.reorderMutation))
      .toHaveLength(2)

    await expect(mutateOutcomeQueueItem({
      query: mutationQuery({ snapshot: [first, protectedRow, second] }),
      userId,
      action: "reorder",
      outcomeKey: first.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "move-protected",
      orderedOutcomes: [
        { outcomeKey: protectedRow.outcomeKey, expectedVersion: 0 },
        { outcomeKey: first.outcomeKey, expectedVersion: 3 },
        { outcomeKey: second.outcomeKey, expectedVersion: 7 },
      ],
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_PROTECTED_REORDER_ILLEGAL" })
  })

  it("persists ordinary reorder intent when protected slots contain tied queue orders", async () => {
    const first = queueRow({
      outcomeKey: "goal:GOAL-1200",
      lifecycleState: "approved",
      queueOrder: 10,
      version: 3,
    })
    const second = queueRow({
      id: 2,
      outcomeKey: "goal:GOAL-1201",
      lifecycleState: "approved",
      queueOrder: 10,
      version: 7,
    })
    const protectedRow = queueRow({
      id: 3,
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "suggested",
      queueOrder: 20,
      version: 0,
    })
    const query = mutationQuery({ snapshot: [first, second, protectedRow] })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "reorder",
      outcomeKey: first.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-tied-around-protected",
      orderedOutcomes: [
        { outcomeKey: second.outcomeKey, expectedVersion: 7 },
        { outcomeKey: first.outcomeKey, expectedVersion: 3 },
        { outcomeKey: protectedRow.outcomeKey, expectedVersion: 0 },
      ],
      now,
    })).resolves.toMatchObject({
      outcome: { outcomeKey: first.outcomeKey, queueOrder: 19, version: 4 },
      affectedOutcomes: [
        { outcomeKey: second.outcomeKey, queueOrder: 18, version: 8 },
        { outcomeKey: first.outcomeKey, queueOrder: 19, version: 4 },
      ],
    })
  })

  it("preserves an unchanged tied segment while unrelated rows reorder", async () => {
    const first = queueRow({
      outcomeKey: "goal:GOAL-1300",
      lifecycleState: "approved",
      queueOrder: 0,
      version: 3,
    })
    const firstProtected = queueRow({
      id: 2,
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "suggested",
      queueOrder: 10,
      version: 0,
    })
    const tied = queueRow({
      id: 3,
      outcomeKey: "goal:GOAL-1301",
      lifecycleState: "approved",
      queueOrder: 10,
      version: 5,
    })
    const secondProtected = queueRow({
      id: 4,
      outcomeKey: "campaign:v1-2:runtime-continuity-status",
      lifecycleState: "suggested",
      queueOrder: 11,
      version: 0,
    })
    const last = queueRow({
      id: 5,
      outcomeKey: "goal:GOAL-1302",
      lifecycleState: "approved",
      queueOrder: 20,
      version: 7,
    })
    const query = mutationQuery({
      snapshot: [first, firstProtected, tied, secondProtected, last],
    })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "reorder",
      outcomeKey: first.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-around-unchanged-tied-segment",
      orderedOutcomes: [
        { outcomeKey: last.outcomeKey, expectedVersion: 7 },
        { outcomeKey: firstProtected.outcomeKey, expectedVersion: 0 },
        { outcomeKey: tied.outcomeKey, expectedVersion: 5 },
        { outcomeKey: secondProtected.outcomeKey, expectedVersion: 0 },
        { outcomeKey: first.outcomeKey, expectedVersion: 3 },
      ],
      now,
    })).resolves.toMatchObject({
      outcome: { outcomeKey: first.outcomeKey, queueOrder: 12, version: 4 },
      affectedOutcomes: [
        { outcomeKey: last.outcomeKey, queueOrder: 9, version: 8 },
        { outcomeKey: first.outcomeKey, queueOrder: 12, version: 4 },
      ],
    })
    expect(query.mock.calls.filter(([sql]) => sql === OUTCOME_QUEUE_SQL.reorderMutation))
      .toHaveLength(2)
  })

  it("rejects a leading protected segment that cannot remain nonnegative", async () => {
    const first = queueRow({
      outcomeKey: "goal:GOAL-1400",
      lifecycleState: "approved",
      queueOrder: 0,
      version: 3,
    })
    const second = queueRow({
      id: 2,
      outcomeKey: "goal:GOAL-1401",
      lifecycleState: "approved",
      queueOrder: 0,
      version: 5,
    })
    const third = queueRow({
      id: 3,
      outcomeKey: "goal:GOAL-1402",
      lifecycleState: "approved",
      queueOrder: 0,
      version: 7,
    })
    const protectedRow = queueRow({
      id: 4,
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "suggested",
      queueOrder: 1,
      version: 0,
    })
    const query = mutationQuery({ snapshot: [first, second, third, protectedRow] })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "reorder",
      outcomeKey: first.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "reorder-leading-capacity-wall",
      orderedOutcomes: [
        { outcomeKey: third.outcomeKey, expectedVersion: 7 },
        { outcomeKey: second.outcomeKey, expectedVersion: 5 },
        { outcomeKey: first.outcomeKey, expectedVersion: 3 },
        { outcomeKey: protectedRow.outcomeKey, expectedVersion: 0 },
      ],
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_PROTECTED_REORDER_CAPACITY_WALL" })
    expect(query.mock.calls.some(([sql]) => sql === OUTCOME_QUEUE_SQL.reorderMutation))
      .toBe(false)
  })

  it("rejects generic supersession of a protected campaign outcome", async () => {
    const protectedRow = queueRow({
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "suggested",
      version: 0,
    })
    const query = mutationQuery({ current: protectedRow })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "supersede",
      outcomeKey: protectedRow.outcomeKey,
      expectedVersion: 0,
      idempotencyKey: "supersede-protected-campaign",
      reason: "Attempt to replace the fixed campaign contract.",
      replacement: {
        title: "Replacement campaign outcome",
      },
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_PROTECTED_SUPERSESSION_ILLEGAL" })
    expect(query.mock.calls.some(([sql]) => sql === OUTCOME_QUEUE_SQL.supersedeMutation))
      .toBe(false)
  })

  it("rejects decline of a protected campaign outcome while authority is live", async () => {
    const protectedRow = queueRow({
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "approved",
      authorityState: "matched",
      authorityGrantRef: "GRANT-V12-CAMPAIGN",
      version: 1,
    })
    const query = mutationQuery({ current: protectedRow })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "decline",
      outcomeKey: protectedRow.outcomeKey,
      expectedVersion: 1,
      idempotencyKey: "decline-protected-live-authority",
      reason: "Attempt to decline before revocation.",
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_PROTECTED_DECLINE_AUTHORITY_ACTIVE" })
    expect(query.mock.calls.some(([sql]) => sql === OUTCOME_QUEUE_SQL.declineMutation))
      .toBe(false)
  })

  it("allows decline when the protected campaign grant is expired by time", async () => {
    const protectedRow = queueRow({
      outcomeKey: "campaign:v1-2:queue-evidence-drilldown",
      lifecycleState: "approved",
      authorityState: "matched",
      authorityGrantRef: "GRANT-V12-CAMPAIGN",
      version: 1,
    })
    const declined = {
      ...protectedRow,
      lifecycleState: "declined",
      terminalResult: "DECLINED",
      version: 2,
    }
    const query = mutationQuery({
      current: protectedRow,
      mutated: declined,
      boundGrant: {
        status: "active",
        expiresAt: "2026-07-28T11:59:59.000Z",
      },
    })

    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "decline",
      outcomeKey: protectedRow.outcomeKey,
      expectedVersion: 1,
      idempotencyKey: "decline-protected-expired-authority",
      reason: "Decline after authority expiry.",
      now,
    })).resolves.toMatchObject({
      outcome: { outcomeKey: protectedRow.outcomeKey, lifecycleState: "declined" },
    })
    expect(query.mock.calls.some(([sql]) => sql === OUTCOME_QUEUE_SQL.declineMutation))
      .toBe(true)
  })

  it("updates dependencies under the queue lock and rejects missing references and cycles", async () => {
    const target = queueRow({
      lifecycleState: "suggested",
      version: 3,
      dependencyKeys: [],
    })
    const predecessor = queueRow({
      id: 2,
      outcomeKey: "goal:GOAL-0999",
      lifecycleState: "approved",
      version: 4,
      dependencyKeys: [],
    })
    const updated = {
      ...target,
      dependencyKeys: [predecessor.outcomeKey],
      version: 4,
    }
    const query = mutationQuery({
      current: target,
      mutated: updated,
      dependencySnapshot: [target, predecessor],
    })
    await expect(mutateOutcomeQueueItem({
      query,
      userId,
      action: "dependencies",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "dependencies-1",
      dependencyKeys: [predecessor.outcomeKey],
      now,
    })).resolves.toMatchObject({
      outcome: {
        outcomeKey: target.outcomeKey,
        dependencyKeys: [predecessor.outcomeKey],
        version: 4,
      },
      replayed: false,
    })
    expect(OUTCOME_QUEUE_SQL.dependencyMutation).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    expect(query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.dependencyMutation,
    )?.[1]).toEqual([
      userId,
      target.outcomeKey,
      3,
      [predecessor.outcomeKey],
      now,
    ])

    await expect(mutateOutcomeQueueItem({
      query: mutationQuery({ dependencySnapshot: [target] }),
      userId,
      action: "dependencies",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "dependencies-missing",
      dependencyKeys: ["goal:missing"],
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEPENDENCY_INVALID" })

    await expect(mutateOutcomeQueueItem({
      query: mutationQuery({
        dependencySnapshot: [
          target,
          { ...predecessor, dependencyKeys: [target.outcomeKey] },
        ],
      }),
      userId,
      action: "dependencies",
      outcomeKey: target.outcomeKey,
      expectedVersion: 3,
      idempotencyKey: "dependencies-cycle",
      dependencyKeys: [predecessor.outcomeKey],
      now,
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_DEPENDENCY_CYCLE" })
  })

  it("does not let decline or supersede directly terminate an active outcome", async () => {
    for (const action of ["decline", "supersede"] as const) {
      const query = mutationQuery()
      await expect(mutateOutcomeQueueItem({
        query,
        userId,
        action,
        outcomeKey: "goal:GOAL-1000",
        expectedVersion: 1,
        idempotencyKey: `${action}-active`,
        replacement: action === "supersede" ? {
          title: "Replacement",
        } : undefined,
        now,
      })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_ACTIVE_TERMINATION_ILLEGAL" })
      expect(query.mock.calls.some(([sql]) => (
        sql === OUTCOME_QUEUE_SQL.declineMutation
        || sql === OUTCOME_QUEUE_SQL.supersedeMutation
      ))).toBe(false)
    }
  })

  it("supersedes with inherited governance, complete receipt effects, and durable lineage", async () => {
    const replacementKey = successorKey("supersede-1")
    const superseded = queueRow({
      lifecycleState: "superseded",
      supersededByOutcomeKey: replacementKey,
      terminalResult: "SUPERSEDED",
      version: 2,
    })
    const current = queueRow({
      lifecycleState: "approved",
      queueOrder: 17,
      dependencyKeys: ["goal:GOAL-0999"],
      riskClass: "R0",
      authorityLevel: "A1_READ",
      authoritySubject: "primary-operator",
      authorityAction: "outcome:inspect",
    })
    const dependent = queueRow({
      id: 3,
      outcomeKey: "goal:GOAL-1002",
      dependencyKeys: [replacementKey],
      lifecycleState: "approved",
      version: 5,
    })
    const query = mutationQuery({
      current,
      mutated: superseded,
      rebound: [dependent],
    })
    const result = await mutateOutcomeQueueItem({
      query,
      userId,
      action: "supersede",
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      idempotencyKey: "supersede-1",
      replacement: {
        title: "Replacement",
        objective: "Revised outcome",
        queueOrder: 999,
        dependencyKeys: ["attacker-controlled"],
        riskClass: "R1",
        authorityLevel: "A9_UNBOUNDED",
        authoritySubject: "attacker",
        authorityAction: "outcome:destroy",
      },
      now,
    })
    expect(result).toMatchObject({
      outcome: safeMutationRow(superseded),
      affectedOutcomes: [
        safeMutationRow(superseded),
        expect.objectContaining({
          outcomeKey: replacementKey,
          lifecycleState: "suggested",
          approvalState: "unapproved",
          authorityState: "unverified",
        }),
        safeMutationRow(dependent),
      ],
      successor: expect.objectContaining({ outcomeKey: replacementKey }),
      replayed: false,
    })
    expect(OUTCOME_QUEUE_SQL.insertSupersedingOutcome).toContain(`'unapproved'`)
    expect(OUTCOME_QUEUE_SQL.insertSupersedingOutcome).toContain(`'unverified'`)
    expect(OUTCOME_QUEUE_SQL.insertSupersedingOutcome).toContain(`"supersedesOutcomeKey"`)
    expect(OUTCOME_QUEUE_SQL.supersedeMutation).toContain(`"supersededByOutcomeKey" = $5`)
    expect(OUTCOME_QUEUE_SQL.rebindSupersededDependents).toContain(
      `$2 = ANY(q."dependencyKeys")`,
    )
    expect(OUTCOME_QUEUE_SQL.rebindSupersededDependents).toContain(
      `q."lifecycleState" IN ('suggested', 'approved', 'blocked')`,
    )
    const insertCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertSupersedingOutcome,
    )
    expect(insertCall?.[1]).toEqual([
      userId,
      replacementKey,
      current.goalId,
      current.goalRef,
      "Replacement",
      "Revised outcome",
      current.queueOrder,
      current.dependencyKeys,
      current.riskClass,
      current.authorityLevel,
      current.authoritySubject,
      current.authorityAction,
      current.outcomeKey,
      now,
    ])
    const receiptCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertMutationReceipt,
    )
    const receiptBinding = JSON.parse(String(receiptCall?.[1]?.[6]))
    expect(receiptBinding.affectedOutcomes).toHaveLength(3)
    expect(receiptBinding.successor.outcomeKey).toBe(replacementKey)
    for (const item of receiptBinding.affectedOutcomes) {
      expect(item).not.toHaveProperty("executionBinding")
      expect(item).not.toHaveProperty("leaseToken")
      expect(item).not.toHaveProperty("fencingToken")
      expect(item).not.toHaveProperty("acquisitionKey")
      expect(item).not.toHaveProperty("terminalKey")
    }
    const rebindCall = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.rebindSupersededDependents,
    )
    expect(rebindCall?.[1]?.slice(0, 3)).toEqual([
      userId,
      "goal:GOAL-1000",
      replacementKey,
    ])
  })

  it("derives the successor after idempotency normalization so equivalent replay keys match", async () => {
    const replacementKey = successorKey("supersede-normalized")
    const superseded = queueRow({
      lifecycleState: "superseded",
      supersededByOutcomeKey: replacementKey,
      terminalResult: "SUPERSEDED",
      version: 2,
    })
    const query = mutationQuery({
      current: queueRow({ lifecycleState: "approved" }),
      mutated: superseded,
    })
    const base = {
      query,
      userId,
      action: "supersede" as const,
      outcomeKey: "goal:GOAL-1000",
      expectedVersion: 1,
      replacement: { title: "Replacement" },
      now,
    }
    await expect(mutateOutcomeQueueItem({
      ...base,
      idempotencyKey: " supersede-normalized ",
    })).resolves.toMatchObject({ replayed: false })
    await expect(mutateOutcomeQueueItem({
      ...base,
      idempotencyKey: "supersede-normalized",
    })).resolves.toMatchObject({
      replayed: true,
      successor: { outcomeKey: replacementKey },
    })
  })

  it("returns the recorded result for exact replay and rejects conflicting key reuse", async () => {
    const campaignRunId = "campaign:mutation-verifier"
    const outcomeKey = acceptanceCampaignOutcomeKey("decline", campaignRunId)
    const idempotencyKey = acceptanceCampaignIdempotencyKey(
      "decline",
      campaignRunId,
    )
    const declined = queueRow({
      lifecycleState: "declined",
      outcomeKey,
      terminalResult: "DECLINED",
      version: 2,
    })
    const query = mutationQuery({
      current: queueRow({ lifecycleState: "approved", outcomeKey }),
      mutated: declined,
    })
    const input = {
      query,
      userId,
      action: "decline" as const,
      outcomeKey,
      expectedVersion: 1,
      idempotencyKey,
      reason: "No longer wanted",
      now,
    }
    await expect(mutateOutcomeQueueItem(input)).resolves.toEqual({
      outcome: safeMutationRow(declined),
      affectedOutcomes: [safeMutationRow(declined)],
      successor: null,
      replayed: false,
    })
    await expect(mutateOutcomeQueueItem(input)).resolves.toEqual({
      outcome: safeMutationRow(declined),
      affectedOutcomes: [safeMutationRow(declined)],
      successor: null,
      replayed: true,
    })
    expect(query.mock.calls.filter(([sql]) => sql === OUTCOME_QUEUE_SQL.declineMutation))
      .toHaveLength(1)
    const proofCalls = query.mock.calls.filter(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertMutationAttempt,
    )
    expect(proofCalls).toHaveLength(2)
    expect(proofCalls.map(([, values]) => values?.slice(1, 6))).toEqual([
      [
        idempotencyKey,
        expect.any(String),
        expect.any(String),
        1,
        OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.COMMITTED,
      ],
      [
        idempotencyKey,
        expect.any(String),
        expect.any(String),
        2,
        OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.REPLAY,
      ],
    ])
    expect(proofCalls[0]?.[1]?.[2]).toBe(proofCalls[1]?.[1]?.[2])
    expect(proofCalls[0]?.[1]?.[3]).toBe(proofCalls[1]?.[1]?.[3])

    const receiptValues = query.mock.calls.find(
      ([sql]) => sql === OUTCOME_QUEUE_SQL.insertMutationReceipt,
    )?.[1] as unknown[]
    const receipt = {
      id: 41,
      idempotencyKey: receiptValues[1],
      operation: receiptValues[2],
      outcomeKey: receiptValues[3],
      requestHash: receiptValues[4],
      requestBinding: JSON.parse(String(receiptValues[5])),
      resultBinding: JSON.parse(String(receiptValues[6])),
      auditCount: 1,
      eventCount: 1,
    }
    const attempts = proofCalls.map(([, values], index) => ({
      id: 44 + index,
      idempotencyKey: values?.[1],
      requestHash: values?.[2],
      resultDigest: values?.[3],
      attemptOrdinal: values?.[4],
      disposition: values?.[5],
      attemptedAt: values?.[6],
    }))
    const digest = (value: unknown) => createHash("sha256")
      .update(typeof value === "string" ? value : JSON.stringify(value))
      .digest("hex")
    expect(verifyMutationRows([{
      action: "DECLINE",
      targetOutcomeKey: receipt.outcomeKey,
      receiptId: receipt.id,
      requestHash: receipt.requestHash,
      idempotencyKeyDigest: digest(String(receipt.idempotencyKey)),
      resultDigest: digest(receipt.resultBinding),
      firstAttemptId: 44,
      replayAttemptId: 45,
      mutationCount: 1,
      mutationCountAfterReplay: 1,
    }], [receipt], attempts, campaignRunId, userId)).toMatchObject({ ok: true })

    await expect(mutateOutcomeQueueItem({
      ...input,
      reason: "Different intent",
    })).rejects.toMatchObject({ code: "OUTCOME_QUEUE_IDEMPOTENCY_CONFLICT" })
  })
})
