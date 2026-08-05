import { createHash } from "node:crypto"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import {
  mutateOutcomeQueueItem,
  OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL,
  persistOutcomeQueueItem,
  readOutcomeQueue,
} from "./outcome-queue-source.mjs"

const PRIMARY_EMAIL = "bsvalues@gmail.com"
const CAMPAIGN = "WILLIAMOS-V1.2-TWO-OUTCOME"
const IDEMPOTENCY_PREFIX = "v1-2-acceptance"

export const ACCEPTANCE_OUTCOME_KEYS = Object.freeze({
  authorityBlocked: "acceptance:v1-2:authority-blocked",
  dependencyBlocked: "acceptance:v1-2:dependency-blocked",
  decline: "acceptance:v1-2:decline",
  reorder: "acceptance:v1-2:reorder",
  riskBlocked: "acceptance:v1-2:risk-blocked",
  safetyBlocker: "acceptance:v1-2:safety-blocker",
  supersede: "acceptance:v1-2:supersede",
})

const STANDING_CANDIDATES = Object.freeze([
  {
    name: "safetyBlocker",
    key: ACCEPTANCE_OUTCOME_KEYS.safetyBlocker,
    title: "V1.2 acceptance acquisition safety sentinel",
    objective: "Remain unfinished so acceptance-only candidates cannot be acquired.",
    queueOrder: 99,
    dependencyKeys: [],
  },
  {
    name: "authorityBlocked",
    key: ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
    title: "V1.2 revoked-authority nonselection proof",
    objective: "Remain unselected after an exact-scope authority grant is revoked.",
    queueOrder: 100,
    dependencyKeys: [ACCEPTANCE_OUTCOME_KEYS.safetyBlocker],
  },
  {
    name: "dependencyBlocked",
    key: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
    title: "V1.2 dependency and pause/resume proof",
    objective: "Exercise pause/resume exactly once while an unfinished dependency prevents selection.",
    queueOrder: 101,
    dependencyKeys: [ACCEPTANCE_OUTCOME_KEYS.safetyBlocker],
  },
  {
    name: "riskBlocked",
    key: ACCEPTANCE_OUTCOME_KEYS.riskBlocked,
    title: "V1.2 non-R0/R1 nonselection proof",
    objective: "Remain unselected because the bounded resident queue excludes R2 work.",
    queueOrder: 103,
    dependencyKeys: [],
    riskClass: "R2",
  },
])

const MUTATION_CANDIDATE_TEMPLATES = Object.freeze([
  {
    name: "decline",
    keyPrefix: ACCEPTANCE_OUTCOME_KEYS.decline,
    title: "V1.2 decline idempotency proof",
    objective: "Exercise one durable decline and one exact replay.",
    queueOrder: 102,
    dependencyKeys: [],
  },
  {
    name: "reorder",
    keyPrefix: ACCEPTANCE_OUTCOME_KEYS.reorder,
    title: "V1.2 reorder idempotency proof",
    objective: "Exercise one durable queue reorder and one exact replay.",
    queueOrder: 104,
    dependencyKeys: [],
  },
  {
    name: "supersede",
    keyPrefix: ACCEPTANCE_OUTCOME_KEYS.supersede,
    title: "V1.2 supersede idempotency proof",
    objective: "Exercise one durable supersede and one exact replay.",
    queueOrder: 105,
    dependencyKeys: [ACCEPTANCE_OUTCOME_KEYS.safetyBlocker],
  },
])

export function acceptanceCampaignOutcomeKey(name, campaignWindowId) {
  const template = MUTATION_CANDIDATE_TEMPLATES.find(
    (candidate) => candidate.name === name,
  )
  if (!template) throw new Error("V1_2_CAMPAIGN_CANDIDATE_NAME_WALL")
  return `${template.keyPrefix}:${digest(campaignWindowId).slice(0, 24)}`
}

function candidatesForCampaign(campaignWindowId) {
  return [
    ...STANDING_CANDIDATES,
    ...MUTATION_CANDIDATE_TEMPLATES.map((candidate) => ({
      ...candidate,
      key: acceptanceCampaignOutcomeKey(candidate.name, campaignWindowId),
    })),
  ]
}

function digest(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(value),
  ).digest("hex")
}

function suggestion(candidate, now) {
  return {
    outcomeKey: candidate.key,
    goalId: null,
    goalRef: "GOAL-WOS-V1.2-001",
    title: candidate.title,
    objective: candidate.objective,
    queueOrder: candidate.queueOrder,
    dependencyKeys: [...candidate.dependencyKeys],
    riskClass: candidate.riskClass ?? "R0",
    approvalState: "unapproved",
    authorityState: "unverified",
    authorityLevel: "A0_READ_ONLY",
    authoritySubject: "operator",
    authorityAction: "outcome:execute",
    lifecycleState: candidate.lifecycleState ?? "suggested",
    lifecycleReason: "V1_2_ACCEPTANCE_EXERCISE",
    activeWorkOrderId: null,
    terminalResult: null,
    terminalEvidenceId: null,
    terminalEvidenceRefs: [],
    terminalKey: null,
    suggestedAt: now,
    terminalAt: null,
  }
}

export function acceptanceCampaignIdempotencyKey(action, campaignWindowId) {
  return `${IDEMPOTENCY_PREFIX}:${digest(campaignWindowId).slice(0, 24)}:${action}`
}

export function acceptanceCampaignSuccessorKey(userId, campaignWindowId) {
  const idempotency = acceptanceCampaignIdempotencyKey(
    "supersede",
    campaignWindowId,
  )
  return `outcome:successor:${digest(`${userId}:${idempotency}`).slice(0, 24)}`
}

function mutationSummary(action, evidence) {
  const receipt = evidence.receipt
  const attempts = evidence.attempts
  return {
    action: action.toUpperCase(),
    firstAttemptId: Number(attempts[0].id),
    idempotentReplay: true,
    idempotencyKeyDigest: digest(receipt.idempotencyKey),
    mutationCount: 1,
    mutationCountAfterReplay: 1,
    receiptId: Number(receipt.id),
    replayAttemptId: Number(attempts[1].id),
    requestHash: receipt.requestHash,
    result: "PASS",
    resultDigest: attempts[0].resultDigest,
    targetOutcomeKey: receipt.outcomeKey,
  }
}

async function applyExactlyOnceMutation({
  action,
  buildRequest,
  campaignWindow,
  guard,
  mutate,
  outcomeKey,
  readEvidence,
}) {
  await guard()
  const key = acceptanceCampaignIdempotencyKey(
    action,
    campaignWindow.campaignWindowId,
  )
  let evidence = await readEvidence(key)
  if (evidence && (
    evidence.receipt?.operation !== action
    || evidence.receipt?.outcomeKey !== outcomeKey
    || evidence.receipt?.requestBinding?.action !== action
    || evidence.receipt?.requestBinding?.outcomeKey !== outcomeKey
    || evidence.receipt?.resultBinding?.outcome?.outcomeKey !== outcomeKey
  )) {
    throw new Error(`V1_2_${action.toUpperCase()}_RECEIPT_BINDING_WALL`)
  }
  let request = evidence?.receipt?.requestBinding ?? await buildRequest()
  if (!evidence) {
    await mutate({ ...request, idempotencyKey: key })
    evidence = await readEvidence(key)
  }
  if (!evidence?.receipt || !Array.isArray(evidence.attempts)) {
    throw new Error(`V1_2_${action.toUpperCase()}_RECEIPT_WALL`)
  }
  if (evidence.attempts.length === 1) {
    await mutate({ ...evidence.receipt.requestBinding, idempotencyKey: key })
    evidence = await readEvidence(key)
  }
  if (evidence.attempts.length !== 2
    || evidence.attempts[0].disposition !== "COMMITTED"
    || evidence.attempts[1].disposition !== "REPLAY"
    || evidence.attempts[0].requestHash !== evidence.receipt.requestHash
    || evidence.attempts[1].requestHash !== evidence.receipt.requestHash
    || evidence.attempts[0].resultDigest !== evidence.attempts[1].resultDigest) {
    throw new Error(`V1_2_${action.toUpperCase()}_REPLAY_WALL`)
  }
  const startedAt = Date.parse(campaignWindow.acquiredAt)
  if (!Number.isFinite(startedAt)
    || evidence.attempts.some((attempt) => (
      !Number.isFinite(Date.parse(attempt.attemptedAt))
      || Date.parse(attempt.attemptedAt) < startedAt
    ))) {
    throw new Error(`V1_2_${action.toUpperCase()}_CAMPAIGN_BINDING_WALL`)
  }
  await guard()
  return mutationSummary(action, evidence)
}

function byKey(rows, key) {
  return rows.find((row) => row.outcomeKey === key) ?? null
}

function authorityReady(row) {
  return row?.approvalState === "approved"
    && row?.authorityState === "matched"
    && Number.isSafeInteger(Number(row.approvalDecisionId))
    && typeof row.authorityGrantRef === "string"
    && row.authorityGrantRef.length > 0
}

function canonical(value) {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function sameValue(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function mutationOutcomeProjection(row) {
  return {
    activeWorkOrderId: row?.activeWorkOrderId ?? null,
    approvalDecisionId: row?.approvalDecisionId ?? null,
    approvalState: row?.approvalState ?? null,
    authorityGrantRef: row?.authorityGrantRef ?? null,
    authorityState: row?.authorityState ?? null,
    dependencyKeys: [...(row?.dependencyKeys ?? [])].sort(),
    lifecycleState: row?.lifecycleState ?? null,
    outcomeKey: row?.outcomeKey ?? null,
    queueOrder: Number(row?.queueOrder),
    supersededByOutcomeKey: row?.supersededByOutcomeKey ?? null,
    supersedesOutcomeKey: row?.supersedesOutcomeKey ?? null,
    terminalAt: row?.terminalAt ?? null,
    terminalEvidenceId: row?.terminalEvidenceId ?? null,
    terminalEvidenceRefs: [...(row?.terminalEvidenceRefs ?? [])].sort(),
    terminalKey: row?.terminalKey ?? null,
    terminalResult: row?.terminalResult ?? null,
    version: Number(row?.version),
  }
}

function receiptMatchesCandidate(
  receipt,
  candidate,
  campaignWindowId,
  userId,
) {
  if (!receipt || !campaignWindowId
    || !MUTATION_CANDIDATE_TEMPLATES.some(
      (template) => template.name === candidate.name,
    )) return false
  const result = receipt.resultBinding
  if (receipt.idempotencyKey !== acceptanceCampaignIdempotencyKey(
    candidate.name,
    campaignWindowId,
  )
    || receipt.operation !== candidate.name
    || receipt.outcomeKey !== candidate.key
    || receipt.requestBinding?.action !== candidate.name
    || receipt.requestBinding?.outcomeKey !== candidate.key
    || result?.outcome?.outcomeKey !== candidate.key) return false

  if (candidate.name === "decline") {
    return result.successor === null
      && Array.isArray(result.affectedOutcomes)
      && result.affectedOutcomes.length === 1
      && sameValue(
        mutationOutcomeProjection(result.affectedOutcomes[0]),
        mutationOutcomeProjection(result.outcome),
      )
  }
  if (candidate.name !== "supersede") return true

  const successorKey = acceptanceCampaignSuccessorKey(
    userId,
    campaignWindowId,
  )
  const successor = mutationOutcomeProjection(result.successor)
  return result.outcome?.supersededByOutcomeKey === successorKey
    && successor.outcomeKey === successorKey
    && successor.supersedesOutcomeKey === candidate.key
    && successor.lifecycleState === "suggested"
    && successor.approvalDecisionId === null
    && successor.approvalState === "unapproved"
    && successor.authorityGrantRef === null
    && successor.authorityState === "unverified"
    && successor.activeWorkOrderId === null
    && successor.terminalAt === null
    && successor.terminalResult === null
    && successor.terminalEvidenceId === null
    && successor.terminalEvidenceRefs.length === 0
    && successor.terminalKey === null
    && successor.supersededByOutcomeKey === null
    && successor.version === 0
    && sameValue(successor.dependencyKeys, [...candidate.dependencyKeys].sort())
    && Array.isArray(result.affectedOutcomes)
    && result.affectedOutcomes.length === 2
    && sameValue(
      result.affectedOutcomes.map(mutationOutcomeProjection),
      [result.outcome, result.successor].map(mutationOutcomeProjection),
    )
}

function topologyMatches(
  row,
  candidate,
  receipt = null,
  campaignWindowId = null,
  userId = null,
) {
  if (row === null
    || JSON.stringify([...(row.dependencyKeys ?? [])].sort())
      !== JSON.stringify([...candidate.dependencyKeys].sort())
    || row.riskClass !== (candidate.riskClass ?? "R0")
    || row.authorityLevel !== "A0_READ_ONLY"
    || row.authoritySubject !== "operator"
    || row.authorityAction !== "outcome:execute") return false
  if (row.activeWorkOrderId !== null) return false
  if (candidate.key === ACCEPTANCE_OUTCOME_KEYS.safetyBlocker) {
    return row.lifecycleState === "suggested"
      && row.approvalState === "unapproved"
      && row.authorityState === "unverified"
      && row.terminalAt === null
  }
  if (candidate.key === ACCEPTANCE_OUTCOME_KEYS.riskBlocked) {
    return row.lifecycleState === "suggested"
      && row.approvalState === "unapproved"
      && row.authorityState === "unverified"
      && row.terminalAt === null
  }
  if ([
    ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
    ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
  ].includes(candidate.key)) {
    return ["suggested", "approved", "blocked"].includes(row.lifecycleState)
      && row.terminalAt === null
  }
  const canonicalSuggestion = row.lifecycleState === "suggested"
    && row.approvalState === "unapproved"
    && row.authorityState === "unverified"
    && row.approvalDecisionId == null
    && row.authorityGrantRef == null
    && row.activeWorkOrderId == null
    && row.terminalAt === null
    && row.terminalResult == null
    && row.terminalEvidenceId == null
    && (row.terminalEvidenceRefs?.length ?? 0) === 0
    && row.terminalKey == null
    && row.supersedesOutcomeKey == null
    && row.supersededByOutcomeKey == null
  if (canonicalSuggestion) return true
  if (!receiptMatchesCandidate(
    receipt,
    candidate,
    campaignWindowId,
    userId,
  )) return false
  if (!sameValue(
    mutationOutcomeProjection(row),
    mutationOutcomeProjection(receipt.resultBinding.outcome),
  )) return false
  if (candidate.name === "decline") {
    return row.lifecycleState === "declined"
      && row.terminalResult === "DECLINED"
      && row.terminalAt !== null
  }
  if (candidate.name === "supersede") {
    return row.lifecycleState === "superseded"
      && row.terminalResult === "SUPERSEDED"
      && row.terminalAt !== null
  }
  return false
}

export async function runAcceptanceExercise({
  userId,
  now = new Date().toISOString(),
  list = (input) => readOutcomeQueue(input),
  persist = (input) => persistOutcomeQueueItem(input),
  mutate = (input) => mutateOutcomeQueueItem(input),
  readAcquisitionCounts,
  readEvidence,
  readAuthorityStatus,
  readCampaignWindow,
  acquireExerciseLock,
} = {}) {
  if (typeof userId !== "string" || userId.trim() === "") {
    throw new Error("V1_2_PRIMARY_IDENTITY_WALL")
  }
  if (typeof readEvidence !== "function") {
    throw new Error("V1_2_MUTATION_EVIDENCE_READER_WALL")
  }
  if (typeof readAcquisitionCounts !== "function") {
    throw new Error("V1_2_ACQUISITION_COUNT_READER_WALL")
  }
  if (typeof readAuthorityStatus !== "function") {
    throw new Error("V1_2_AUTHORITY_STATUS_READER_WALL")
  }
  if (typeof readCampaignWindow !== "function") {
    throw new Error("V1_2_CAMPAIGN_WINDOW_READER_WALL")
  }
  if (typeof acquireExerciseLock !== "function") {
    throw new Error("V1_2_EXERCISE_LOCK_WALL")
  }

  let queue = await list({ userId })
  for (const candidate of STANDING_CANDIDATES) {
    if (!byKey(queue, candidate.key)) {
      await persist({ userId, item: suggestion(candidate, now), now })
      queue = await list({ userId })
    }
    if (!topologyMatches(byKey(queue, candidate.key), candidate)) {
      throw new Error(`V1_2_ACCEPTANCE_TOPOLOGY_WALL:${candidate.key}`)
    }
  }
  const assertAcceptanceSafety = async (
    candidates,
    query,
    campaignWindowId = null,
  ) => {
    const current = await list({ userId, query })
    const counts = await readAcquisitionCounts(
      candidates.map((candidate) => candidate.key),
      query,
    )
    for (const candidate of candidates) {
      const evidence = campaignWindowId
        && MUTATION_CANDIDATE_TEMPLATES.some(
          (template) => template.name === candidate.name,
        )
        ? await readEvidence(
            acceptanceCampaignIdempotencyKey(candidate.name, campaignWindowId),
            query,
          )
        : null
      if (!topologyMatches(
        byKey(current, candidate.key),
        candidate,
        evidence?.receipt ?? null,
        campaignWindowId,
        userId,
      )
        || Number(counts[candidate.key] ?? 0) !== 0) {
        throw new Error(`V1_2_ACCEPTANCE_SAFETY_WALL:${candidate.key}`)
      }
    }
  }
  await assertAcceptanceSafety(STANDING_CANDIDATES)

  const dependency = byKey(queue, ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked)
  const authority = byKey(queue, ACCEPTANCE_OUTCOME_KEYS.authorityBlocked)
  const [dependencyStatus, authorityStatus] = await Promise.all([
    dependency?.authorityGrantRef
      ? readAuthorityStatus(dependency.authorityGrantRef)
      : null,
    authority?.authorityGrantRef
      ? readAuthorityStatus(authority.authorityGrantRef)
      : null,
  ])
  if (!authorityReady(dependency)
    || dependencyStatus !== "active"
    || authority?.approvalState !== "approved"
    || authorityStatus !== "revoked") {
    return {
      campaign: CAMPAIGN,
      status: "OWNER_AUTHORITY_REQUIRED",
      mutations: [],
      requiredAuthority: {
        decision: "APPROVE_OR_DENY",
        dependencyCandidate: {
          action: "outcome:execute",
          consequence: "APPROVE permits only the bounded pause/resume acceptance exercise; DENY rejects WO #480 certification.",
          level: "A0_READ_ONLY",
          scope: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
        },
        revokedAuthorityCandidate: {
          action: "outcome:execute",
          consequence: "APPROVE then REVOKE proves authority loss prevents acquisition; DENY rejects WO #480 certification.",
          level: "A0_READ_ONLY",
          scope: ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
        },
      },
    }
  }

  const campaignWindow = await readCampaignWindow()
  if (!campaignWindow
    || typeof campaignWindow.campaignWindowId !== "string"
    || typeof campaignWindow.activeOutcomeKey !== "string"
    || typeof campaignWindow.activeGrantRef !== "string"
    || !Number.isFinite(Date.parse(campaignWindow.acquiredAt))) {
    return {
      campaign: CAMPAIGN,
      status: "NEW_CONTINUOUS_CAMPAIGN_REQUIRED",
      mutations: [],
    }
  }

  const candidates = candidatesForCampaign(campaignWindow.campaignWindowId)
  for (const candidate of candidates) {
    if (!byKey(queue, candidate.key)) {
      await persist({ userId, item: suggestion(candidate, now), now })
      queue = await list({ userId })
    }
    const evidence = MUTATION_CANDIDATE_TEMPLATES.some(
      (template) => template.name === candidate.name,
    )
      ? await readEvidence(acceptanceCampaignIdempotencyKey(
          candidate.name,
          campaignWindow.campaignWindowId,
        ))
      : null
    if (!topologyMatches(
      byKey(queue, candidate.key),
      candidate,
      evidence?.receipt ?? null,
      campaignWindow.campaignWindowId,
      userId,
    )) {
      throw new Error(`V1_2_ACCEPTANCE_TOPOLOGY_WALL:${candidate.key}`)
    }
  }
  await assertAcceptanceSafety(
    candidates,
    undefined,
    campaignWindow.campaignWindowId,
  )
  const candidateKey = (name) => {
    const candidate = candidates.find((entry) => entry.name === name)
    if (!candidate) throw new Error("V1_2_CAMPAIGN_CANDIDATE_NAME_WALL")
    return candidate.key
  }

  const locked = await acquireExerciseLock(userId, {
    activeGrantRef: campaignWindow.activeGrantRef,
    activeOutcomeKey: campaignWindow.activeOutcomeKey,
    authorityGrantRef: authority.authorityGrantRef,
    campaignWindowId: campaignWindow.campaignWindowId,
    dependencyGrantRef: dependency.authorityGrantRef,
    outcomeKeys: candidates.map((candidate) => candidate.key),
  })
  let complete = false
  try {
    const guard = () => assertAcceptanceSafety(
      candidates,
      locked.query,
      campaignWindow.campaignWindowId,
    )
    const lockedList = () => list({ userId, query: locked.query })
    const lockedMutate = (request) => mutate({
      userId,
      now,
      query: locked.query,
      ...request,
    })
    const lockedReadEvidence = (key) => readEvidence(key, locked.query)
    const mutations = []
    mutations.push(await applyExactlyOnceMutation({
      action: "pause",
      campaignWindow,
      guard,
      outcomeKey: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
      readEvidence: lockedReadEvidence,
      mutate: lockedMutate,
      buildRequest: async () => {
        const row = byKey(await lockedList(), ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked)
        return {
          action: "pause",
          outcomeKey: row.outcomeKey,
          expectedVersion: row.version,
          reason: "V1.2 acceptance pause exercise",
        }
      },
    }))
    mutations.push(await applyExactlyOnceMutation({
      action: "resume",
      campaignWindow,
      guard,
      outcomeKey: ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
      readEvidence: lockedReadEvidence,
      mutate: lockedMutate,
      buildRequest: async () => {
        const row = byKey(await lockedList(), ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked)
        return {
          action: "resume",
          outcomeKey: row.outcomeKey,
          expectedVersion: row.version,
          approvalDecisionId: row.approvalDecisionId,
          authorityGrantRef: row.authorityGrantRef,
          reason: "V1.2 acceptance resume exercise",
        }
      },
    }))
    mutations.push(await applyExactlyOnceMutation({
      action: "reorder",
      campaignWindow,
      guard,
      outcomeKey: candidateKey("reorder"),
      readEvidence: lockedReadEvidence,
      mutate: lockedMutate,
      buildRequest: async () => {
        const rows = (await lockedList())
          .filter((row) => ["suggested", "approved", "blocked"].includes(row.lifecycleState))
          .sort((left, right) => left.queueOrder - right.queueOrder
            || left.outcomeKey.localeCompare(right.outcomeKey))
        const target = byKey(rows, candidateKey("reorder"))
        if (!target) throw new Error("V1_2_REORDER_TARGET_WALL")
        const acceptanceOwned = (row) => (
          row.outcomeKey.startsWith("acceptance:v1-2:")
          || row.supersedesOutcomeKey?.startsWith("acceptance:v1-2:")
        )
        if (rows.some((row, index) => (
          !acceptanceOwned(row)
          && row.queueOrder !== index
        ))) {
          throw new Error("V1_2_REORDER_ISOLATION_WALL")
        }
        const partnerIndex = rows.findIndex((row) => (
          row.outcomeKey !== target.outcomeKey
          && acceptanceOwned(row)
        ))
        const targetIndex = rows.findIndex((row) => row.outcomeKey === target.outcomeKey)
        if (partnerIndex < 0 || targetIndex < 0) {
          throw new Error("V1_2_REORDER_PARTNER_WALL")
        }
        const ordered = [...rows]
        ;[ordered[targetIndex], ordered[partnerIndex]] = [
          ordered[partnerIndex],
          ordered[targetIndex],
        ]
        return {
          action: "reorder",
          outcomeKey: target.outcomeKey,
          expectedVersion: target.version,
          orderedOutcomes: ordered.map((row) => ({
            outcomeKey: row.outcomeKey,
            expectedVersion: row.version,
          })),
          reason: "V1.2 acceptance reorder exercise",
        }
      },
    }))

    for (const action of ["decline", "supersede"]) {
      const outcomeKey = candidateKey(action)
      mutations.push(await applyExactlyOnceMutation({
        action,
        campaignWindow,
        guard,
        outcomeKey,
        readEvidence: lockedReadEvidence,
        mutate: lockedMutate,
        buildRequest: async () => {
          const rows = await lockedList()
          const row = byKey(rows, outcomeKey)
          if (!row) throw new Error(`V1_2_${action.toUpperCase()}_TARGET_WALL`)
          if (action === "supersede" && rows.some((candidate) => (
            ["suggested", "approved", "blocked"].includes(candidate.lifecycleState)
            && !candidate.outcomeKey.startsWith("acceptance:v1-2:")
            && !candidate.supersedesOutcomeKey?.startsWith("acceptance:v1-2:")
            && candidate.dependencyKeys?.includes(outcomeKey)
          ))) {
            throw new Error("V1_2_SUPERSEDE_REVERSE_DEPENDENCY_WALL")
          }
          return {
            action,
            outcomeKey,
            expectedVersion: row.version,
            reason: `V1.2 acceptance ${action} exercise`,
            ...(action === "supersede"
              ? {
                  replacement: {
                    title: "V1.2 supersede replacement proof",
                    objective: "Retain deterministic replacement identity without acquisition.",
                  },
                }
              : {}),
          }
        },
      }))
    }
    complete = true
    return { campaign: CAMPAIGN, status: "PASS", mutations }
  } finally {
    await (complete ? locked.commit() : locked.rollback())
  }
}

async function main() {
  const { Pool } = await import("pg")
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    allowExitOnIdle: true,
  })
  try {
    const primary = await pool.query(
      `SELECT id FROM "user" WHERE lower(email) = lower($1) ORDER BY id LIMIT 2`,
      [PRIMARY_EMAIL],
    )
    if (primary.rows.length !== 1) throw new Error("V1_2_PRIMARY_IDENTITY_WALL")
    const userId = primary.rows[0].id
    const queryRunner = (query) => {
      if (typeof query === "function") return query
      if (query && typeof query.query === "function") return query.query.bind(query)
      return pool.query.bind(pool)
    }
    const readEvidence = async (key, query) => {
      const runQuery = queryRunner(query)
      const receipt = await runQuery(
        `SELECT id, "idempotencyKey", operation, "outcomeKey", "requestHash",
                "requestBinding", "resultBinding"
         FROM outcome_queue_mutation_receipt
         WHERE "userId" = $1 AND "idempotencyKey" = $2`,
        [userId, key],
      )
      if (receipt.rows.length === 0) return null
      if (receipt.rows.length !== 1) throw new Error("V1_2_MUTATION_RECEIPT_CARDINALITY_WALL")
      const attempts = await runQuery(
        `SELECT id, "requestHash", "resultDigest", "attemptOrdinal", disposition, "attemptedAt"
         FROM outcome_queue_mutation_attempt
         WHERE "userId" = $1 AND "idempotencyKey" = $2
         ORDER BY "attemptOrdinal" ASC`,
        [userId, key],
      )
      return { receipt: receipt.rows[0], attempts: attempts.rows }
    }
    const readAuthorityStatus = async (grantRef) => {
      const result = await pool.query(
        `SELECT status, "revokedAt"
         FROM authority_grant
         WHERE "userId" = $1 AND ref = $2`,
        [userId, grantRef],
      )
      if (result.rows.length === 0) return null
      if (result.rows.length !== 1) {
        throw new Error("V1_2_AUTHORITY_GRANT_CARDINALITY_WALL")
      }
      return result.rows[0].revokedAt !== null
        ? "revoked"
        : result.rows[0].status ?? null
    }
    const readAcquisitionCounts = async (outcomeKeys, query) => {
      const result = await queryRunner(query)(
        `SELECT "outcomeKey", count(*)::integer AS count
         FROM outcome_queue_acquisition_receipt
         WHERE "userId" = $1 AND "outcomeKey" = ANY($2::text[])
         GROUP BY "outcomeKey"`,
        [userId, outcomeKeys],
      )
      return Object.fromEntries(
        result.rows.map((row) => [row.outcomeKey, Number(row.count)]),
      )
    }
    const readCampaignWindow = async () => {
      const result = await pool.query(
        `SELECT q."outcomeKey" AS "activeOutcomeKey",
                q."authorityGrantRef" AS "activeGrantRef",
                attempt."campaignWindowId",
                receipt."createdAt" AS "acquiredAt"
         FROM outcome_queue_item q
         JOIN decision approval
           ON approval.id = q."approvalDecisionId"
          AND approval."userId" = q."userId"
          AND approval.status = 'accepted'
          AND approval.authority = 'binding'
          AND upper(trim(approval.decision)) = 'APPROVE'
          AND approval.scope = q."outcomeKey"
         JOIN authority_grant live_grant
           ON live_grant."userId" = q."userId"
          AND live_grant.ref = q."authorityGrantRef"
          AND live_grant.status = 'active'
          AND live_grant."revokedAt" IS NULL
          AND (
            live_grant."expiresAt" IS NULL
            OR live_grant."expiresAt" AT TIME ZONE 'UTC' > NOW()
          )
          AND live_grant."authorityLevel" = q."authorityLevel"
          AND live_grant."grantedTo" = q."authoritySubject"
          AND live_grant.scope = q."outcomeKey"
          AND NOT EXISTS (
            SELECT 1
            FROM unnest(live_grant."blockedActions") blocked(action)
            WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
          )
          AND (
            cardinality(live_grant."allowedActions") = 0
            OR EXISTS (
              SELECT 1
              FROM unnest(live_grant."allowedActions") allowed(action)
              WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
            )
          )
          AND (
            live_grant."workOrderId" IS NULL
            OR live_grant."workOrderId" = q."activeWorkOrderId"
          )
         JOIN goal g
           ON g.id = q."goalId"
          AND g."userId" = q."userId"
          AND g.ref = q."goalRef"
         JOIN work_order wo
           ON wo.id = q."activeWorkOrderId"
          AND wo."userId" = q."userId"
          AND wo.goal = q."goalRef"
         JOIN LATERAL (
           SELECT r."createdAt"
           FROM outcome_queue_acquisition_receipt r
           WHERE r."userId" = q."userId"
             AND r."outcomeKey" = q."outcomeKey"
             AND r."latestFencingToken" = q."fencingToken"
           ORDER BY r."updatedAt" DESC, r.id DESC
           LIMIT 1
         ) receipt ON true
         JOIN LATERAL (
           SELECT a."campaignWindowId"
           FROM outcome_queue_acquisition_attempt a
           WHERE a."userId" = q."userId"
             AND a."outcomeKey" = q."outcomeKey"
             AND a."fencingToken" = q."fencingToken"
             AND a.disposition IN ('WINNER', 'RECLAIMED', 'REPLAY_WINNER')
           ORDER BY a."attemptedAt" DESC, a.id DESC
           LIMIT 1
         ) attempt ON true
         WHERE q."userId" = $1
           AND q."lifecycleState" = 'active'
           AND q."approvalState" = 'approved'
           AND q."authorityState" = 'matched'
           AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
           AND q."goalId" IS NOT NULL
           AND q."activeWorkOrderId" IS NOT NULL
           AND q."outcomeKey" NOT LIKE 'acceptance:v1-2:%'
         ORDER BY q."updatedAt" DESC
         LIMIT 2`,
        [userId],
      )
      return result.rows.length === 1 ? result.rows[0] : null
    }
    const lockClient = await pool.connect()
    const acquireExerciseLock = async (_userId, binding) => {
      await lockClient.query("BEGIN")
      try {
        await lockClient.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`${userId}:outcome-queue`],
        )
        const active = await lockClient.query(
          `SELECT q.id
           FROM outcome_queue_item q
           JOIN decision approval
             ON approval.id = q."approvalDecisionId"
            AND approval."userId" = q."userId"
            AND approval.status = 'accepted'
            AND approval.authority = 'binding'
            AND upper(trim(approval.decision)) = 'APPROVE'
            AND approval.scope = q."outcomeKey"
           JOIN authority_grant active_grant
             ON active_grant."userId" = q."userId"
            AND active_grant.ref = q."authorityGrantRef"
            AND active_grant.ref = $4
            AND active_grant.status = 'active'
            AND active_grant."revokedAt" IS NULL
            AND (
              active_grant."expiresAt" IS NULL
              OR active_grant."expiresAt" AT TIME ZONE 'UTC' > NOW()
            )
            AND active_grant."authorityLevel" = q."authorityLevel"
            AND active_grant."grantedTo" = q."authoritySubject"
            AND active_grant.scope = q."outcomeKey"
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(active_grant."blockedActions") blocked(action)
              WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
            )
            AND (
              cardinality(active_grant."allowedActions") = 0
              OR EXISTS (
                SELECT 1
                FROM unnest(active_grant."allowedActions") allowed(action)
                WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
              )
            )
            AND (
              active_grant."workOrderId" IS NULL
              OR active_grant."workOrderId" = q."activeWorkOrderId"
            )
           JOIN goal g
             ON g.id = q."goalId"
            AND g."userId" = q."userId"
            AND g.ref = q."goalRef"
           JOIN work_order wo
             ON wo.id = q."activeWorkOrderId"
            AND wo."userId" = q."userId"
            AND wo.goal = q."goalRef"
           WHERE q."userId" = $1
             AND q."outcomeKey" = $2
             AND q."lifecycleState" = 'active'
             AND q."approvalState" = 'approved'
             AND q."authorityState" = 'matched'
             AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
             AND EXISTS (
               SELECT 1
               FROM outcome_queue_acquisition_attempt attempt
               WHERE attempt."userId" = q."userId"
                 AND attempt."outcomeKey" = q."outcomeKey"
                 AND attempt."campaignWindowId" = $3
                 AND attempt."fencingToken" = q."fencingToken"
                 AND attempt.disposition IN ('WINNER', 'RECLAIMED', 'REPLAY_WINNER')
             )
           ORDER BY q."updatedAt" DESC
           LIMIT 2
           FOR SHARE OF q, approval, active_grant, g, wo`,
          [
            userId,
            binding.activeOutcomeKey,
            binding.campaignWindowId,
            binding.activeGrantRef,
          ],
        )
        if (active.rows.length !== 1) {
          throw new Error("V1_2_ACTIVE_CAMPAIGN_FENCE_WALL")
        }

        const acceptanceRows = await lockClient.query(
          `SELECT "outcomeKey", "approvalState", "authorityState",
                  "approvalDecisionId", "authorityGrantRef", "lifecycleState"
           FROM outcome_queue_item
           WHERE "userId" = $1
             AND "outcomeKey" = ANY($2::text[])
           ORDER BY "outcomeKey" ASC
           FOR UPDATE`,
          [userId, binding.outcomeKeys],
        )
        if (acceptanceRows.rows.length !== binding.outcomeKeys.length
          || acceptanceRows.rows.some(
            (row, index) => row.outcomeKey !== [...binding.outcomeKeys].sort()[index],
          )) {
          throw new Error("V1_2_ACCEPTANCE_ROW_FENCE_WALL")
        }
        const acceptanceByKey = new Map(
          acceptanceRows.rows.map((row) => [row.outcomeKey, row]),
        )
        const dependencyRow = acceptanceByKey.get(
          ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
        )
        const authorityRow = acceptanceByKey.get(
          ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
        )
        if (dependencyRow?.approvalState !== "approved"
          || dependencyRow?.authorityState !== "matched"
          || dependencyRow?.authorityGrantRef !== binding.dependencyGrantRef
          || !["approved", "blocked"].includes(dependencyRow?.lifecycleState)
          || authorityRow?.approvalState !== "approved"
          || !["matched", "revoked"].includes(authorityRow?.authorityState)
          || authorityRow?.authorityGrantRef !== binding.authorityGrantRef
          || !["approved", "blocked"].includes(authorityRow?.lifecycleState)) {
          throw new Error("V1_2_ACCEPTANCE_AUTHORITY_BINDING_WALL")
        }
        const decisions = await lockClient.query(
          `SELECT id, status, authority, decision, scope
           FROM decision
           WHERE "userId" = $1
             AND id = ANY($2::integer[])
           ORDER BY id ASC
           FOR SHARE`,
          [userId, [
            dependencyRow.approvalDecisionId,
            authorityRow.approvalDecisionId,
          ]],
        )
        const decisionById = new Map(
          decisions.rows.map((decision) => [Number(decision.id), decision]),
        )
        const decisionMatches = (row, scope) => {
          const decision = decisionById.get(Number(row.approvalDecisionId))
          return decision?.status === "accepted"
            && decision?.authority === "binding"
            && decision?.decision.trim().toUpperCase() === "APPROVE"
            && decision?.scope === scope
        }
        if (decisions.rows.length !== 2
          || !decisionMatches(
            dependencyRow,
            ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked,
          )
          || !decisionMatches(
            authorityRow,
            ACCEPTANCE_OUTCOME_KEYS.authorityBlocked,
          )) {
          throw new Error("V1_2_ACCEPTANCE_DECISION_FENCE_WALL")
        }

        const grants = await lockClient.query(
          `SELECT ref, status, "revokedAt", "expiresAt", "authorityLevel",
                  "grantedTo", scope, "allowedActions", "blockedActions",
                  "workOrderId"
           FROM authority_grant
           WHERE "userId" = $1
             AND ref = ANY($2::text[])
           ORDER BY ref ASC
           FOR SHARE`,
          [userId, [
            binding.dependencyGrantRef,
            binding.authorityGrantRef,
            binding.activeGrantRef,
          ]],
        )
        if (grants.rows.length !== 3) {
          throw new Error("V1_2_ACCEPTANCE_GRANT_CARDINALITY_WALL")
        }
        const grantByRef = new Map(grants.rows.map((grant) => [grant.ref, grant]))
        const dependencyGrant = grantByRef.get(binding.dependencyGrantRef)
        const authorityGrant = grantByRef.get(binding.authorityGrantRef)
        const activeGrant = grantByRef.get(binding.activeGrantRef)
        const permits = (grant, scope) => grant
          && grant.authorityLevel === "A0_READ_ONLY"
          && grant.grantedTo === "operator"
          && grant.scope === scope
          && grant.workOrderId === null
          && !grant.blockedActions.some(
            (action) => "outcome:execute".includes(action.toLowerCase()),
          )
          && (grant.allowedActions.length === 0 || grant.allowedActions.some(
            (action) => "outcome:execute".includes(action.toLowerCase()),
          ))
        if (!permits(dependencyGrant, ACCEPTANCE_OUTCOME_KEYS.dependencyBlocked)
          || dependencyGrant.status !== "active"
          || dependencyGrant.revokedAt !== null
          || (dependencyGrant.expiresAt !== null
            && Date.parse(dependencyGrant.expiresAt) <= Date.now())) {
          throw new Error("V1_2_DEPENDENCY_GRANT_FENCE_WALL")
        }
        if (!permits(authorityGrant, ACCEPTANCE_OUTCOME_KEYS.authorityBlocked)
          || authorityGrant.status !== "revoked"
          || authorityGrant.revokedAt === null
          || (authorityGrant.expiresAt !== null
            && Date.parse(authorityGrant.expiresAt) <= Date.now())) {
          throw new Error("V1_2_REVOKED_GRANT_FENCE_WALL")
        }
        if (!activeGrant
          || activeGrant.status !== "active"
          || activeGrant.revokedAt !== null) {
          throw new Error("V1_2_ACTIVE_GRANT_FENCE_WALL")
        }

        const counts = await readAcquisitionCounts(binding.outcomeKeys, lockClient)
        if (binding.outcomeKeys.some((key) => Number(counts[key] ?? 0) !== 0)) {
          throw new Error("V1_2_ACCEPTANCE_ACQUISITION_FENCE_WALL")
        }
      } catch (error) {
        await lockClient.query("ROLLBACK")
        throw error
      }

      let savepoint = null
      let savepointOrdinal = 0
      let finished = false
      const nestedClient = {
        query: async (statement, values) => {
          if (statement === "BEGIN") {
            if (savepoint !== null) throw new Error("V1_2_NESTED_TRANSACTION_WALL")
            savepoint = `v1_2_acceptance_${++savepointOrdinal}`
            return lockClient.query(`SAVEPOINT ${savepoint}`)
          }
          if (statement === "COMMIT") {
            if (savepoint === null) throw new Error("V1_2_NESTED_COMMIT_WALL")
            const current = savepoint
            savepoint = null
            return lockClient.query(`RELEASE SAVEPOINT ${current}`)
          }
          if (statement === "ROLLBACK") {
            if (savepoint === null) return { rows: [] }
            const current = savepoint
            savepoint = null
            await lockClient.query(`ROLLBACK TO SAVEPOINT ${current}`)
            return lockClient.query(`RELEASE SAVEPOINT ${current}`)
          }
          return lockClient.query(statement, values)
        },
        release: () => {},
      }
      const query = {
        connect: async () => nestedClient,
        query: nestedClient.query,
      }
      const finish = async (action) => {
        if (finished) return
        if (action === "COMMIT" && savepoint !== null) {
          finished = true
          await lockClient.query("ROLLBACK")
          throw new Error("V1_2_OPEN_SAVEPOINT_WALL")
        }
        savepoint = null
        finished = true
        await lockClient.query(action)
      }
      return {
        query,
        commit: () => finish("COMMIT"),
        rollback: () => finish("ROLLBACK"),
      }
    }
    let result
    try {
      result = await runAcceptanceExercise({
        userId,
        acquireExerciseLock,
        readAcquisitionCounts,
        readAuthorityStatus,
        readCampaignWindow,
        readEvidence,
      })
    } finally {
      lockClient.release()
    }
    process.stdout.write(`${JSON.stringify(result)}\n`)
    process.exitCode = result.status === "PASS" ? 0 : 3
  } finally {
    await pool.end()
  }
}

if (process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? "V1_2_ACCEPTANCE_EXERCISE_WALL"}\n`)
    process.exitCode = 1
  })
}
