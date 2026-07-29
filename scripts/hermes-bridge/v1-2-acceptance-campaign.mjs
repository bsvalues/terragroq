import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  probeJson,
  validateHostState,
  validateRuntimeAgreement,
  validateSupervisorState,
} from "./v1-acceptance-campaign.mjs"
import { produceRuntimeAgreement } from "./runtime-agreement.mjs"
import {
  canonicalOutcomeQueueCheckpointProof,
  digestOutcomeQueueCheckpointProof,
  OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL,
  OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS,
} from "./outcome-queue-source.mjs"

const SCHEMA_VERSION = 1
const CAMPAIGN = "WILLIAMOS-V1.2-TWO-OUTCOME"
const PARENT_ISSUE = 471
const AUTHORIZED_REPOSITORY = "bsvalues/terragroq"
const DEFAULT_MAX_AGE_MS = 15 * 60 * 1000
const SHA = /^[0-9a-f]{40}$/i
const SHA256 = /^[0-9a-f]{64}$/i
const OWNER_COUNTERS = Object.freeze([
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
  "OWNER_ROUTINE_CONTACT_COUNT",
])
const REQUIRED_MUTATIONS = Object.freeze([
  "DECLINE",
  "PAUSE",
  "REORDER",
  "RESUME",
  "SUPERSEDE",
])
const REQUIRED_SURFACES = Object.freeze([
  "/goal-console",
  "/work-orders",
  "/audit",
  "/trace",
])
const FORBIDDEN_KEY = /(?:password|secret|cookie|session|databaseurl|database_url|connectionstring|executionbinding|acquisitionkey|leasetoken|(?:access|auth|bearer|refresh|api|github|openai|credential)token)/i
const FORBIDDEN_VALUE = /(?:postgres(?:ql)?:\/\/|github_pat_|gh[opsu]_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})/i
const DECLARED_PRIMARY_EMAIL = "bsvalues@gmail.com"
const PRODUCT_FILE = /^(?:app|components|lib)\/(?!.*(?:test|spec)\.[^/]+$).+\.[cm]?[jt]sx?$/

const PRIMARY_SQL = `
SELECT id
FROM "user"
WHERE lower(email) = lower($1)
ORDER BY id
LIMIT 2
`

const LIVE_OUTCOMES_SQL = `
WITH latest AS (
  SELECT q.*
  FROM "outcome_queue_item" AS q
  WHERE q."userId" = $1
    AND q."lifecycleState" = 'completed'
    AND q."terminalResult" = 'COMPLETE'
    AND q."riskClass" IN ('R0', 'R1')
    AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
    AND q."terminalAt" IS NOT NULL
  ORDER BY q."terminalAt" DESC, q."queueOrder" DESC, q."outcomeKey" DESC
  LIMIT 2
)
SELECT
  q."goalId" AS "outcomeId",
  q."outcomeKey",
  q."goalRef",
  q."queueOrder",
  q."dependencyKeys",
  q."riskClass",
  q."approvalState",
  q."authorityState",
  q."authorityLevel",
  q."authoritySubject",
  q."authorityAction",
  q."authorityGrantRef",
  q."lifecycleState",
  q."activeWorkOrderId",
  q."fencingToken",
  q."terminalResult",
  q."terminalEvidenceRefs",
  q."terminalKey",
  q."terminalAt",
  approval.ref AS "approvalDecisionRef",
  approval.status AS "approvalDecisionStatus",
  approval.authority AS "approvalDecisionAuthority",
  authority.ref AS "liveAuthorityGrantRef",
  authority.status AS "authorityGrantStatus",
  authority."revokedAt" AS "authorityGrantRevokedAt",
  wo.id AS "workOrderId",
  wo.ref AS "workOrderRef",
  wo.status AS "workOrderStatus",
  wo.result AS "workOrderResult",
  wo."commitRef" AS "workOrderCommitRef",
  wo."completedAt" AT TIME ZONE 'UTC' AS "workOrderCompletedAt"
FROM latest AS q
JOIN decision AS approval
  ON approval.id = q."approvalDecisionId"
  AND approval."userId" = q."userId"
  AND approval.status = 'accepted'
  AND approval.authority = 'binding'
  AND upper(trim(approval.decision)) = 'APPROVE'
  AND approval.scope = q."outcomeKey"
JOIN authority_grant AS authority
  ON authority."userId" = q."userId"
  AND authority.ref = q."authorityGrantRef"
  AND authority.status = 'active'
  AND authority."revokedAt" IS NULL
  AND (authority."expiresAt" IS NULL OR authority."expiresAt" > $2::timestamptz)
  AND authority."authorityLevel" = q."authorityLevel"
  AND authority."grantedTo" = q."authoritySubject"
  AND authority.scope = q."outcomeKey"
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(authority."blockedActions") blocked(action)
    WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
  )
  AND (
    cardinality(authority."allowedActions") = 0
    OR EXISTS (
      SELECT 1
      FROM unnest(authority."allowedActions") allowed(action)
      WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
    )
  )
  AND (
    authority."workOrderId" IS NULL
    OR authority."workOrderId" = q."activeWorkOrderId"
  )
JOIN work_order AS wo
  ON wo.id = q."activeWorkOrderId"
  AND wo."userId" = q."userId"
ORDER BY q."terminalAt" ASC, q."queueOrder" ASC, q."outcomeKey" ASC
`

const ACQUISITION_RECEIPTS_SQL = `
SELECT
  "outcomeKey",
  min(id)::integer AS "receiptId",
  count(*)::integer AS "receiptCount",
  min("firstFencingToken")::integer AS "firstFencingToken",
  max("latestFencingToken")::integer AS "latestFencingToken",
  min("createdAt") AS "acquiredAt",
  max("updatedAt") AS "updatedAt"
FROM "outcome_queue_acquisition_receipt"
WHERE "userId" = $1
  AND "outcomeKey" = ANY($2::text[])
GROUP BY "outcomeKey"
ORDER BY min("createdAt") ASC, "outcomeKey" ASC
`

const CHECKPOINTS_SQL = `
SELECT id, "entityId" AS "workOrderId", metadata,
       "createdAt" AT TIME ZONE 'UTC' AS "createdAt"
FROM governance_event
WHERE "userId" = $1
  AND "entityType" = 'work_order'
  AND "entityId" = ANY($2::text[])
  AND "eventType" = 'HERMES_RUNTIME_CHECKPOINT'
ORDER BY id ASC
`

const TERMINAL_EVIDENCE_SQL = `
SELECT
  id,
  ref,
  "workOrderId",
  result,
  repo,
  head,
  "filesChanged",
  validators,
  "knownFailures",
  "outOfScopeChanges",
  "contentHash",
  "createdAt" AT TIME ZONE 'UTC' AS "createdAt"
FROM evidence_record
WHERE "userId" = $1
  AND "workOrderId" = ANY($2::integer[])
ORDER BY id ASC
`

const BLOCKED_CANDIDATES_SQL = `
SELECT
  q."outcomeKey",
  q."lifecycleState",
  (
    SELECT count(*)::integer
    FROM "outcome_queue_acquisition_receipt" receipt
    WHERE receipt."userId" = q."userId"
      AND receipt."outcomeKey" = q."outcomeKey"
  ) AS "acquisitionCount",
  (
    SELECT count(*)::integer
    FROM unnest(q."dependencyKeys") dependency("outcomeKey")
    LEFT JOIN "outcome_queue_item" completed
      ON completed."userId" = q."userId"
      AND completed."outcomeKey" = dependency."outcomeKey"
    WHERE completed."lifecycleState" IS DISTINCT FROM 'completed'
  ) AS "blockedDependencyCount",
  (
    q."approvalState" = 'approved'
    AND q."authorityState" = 'matched'
    AND ${OUTCOME_QUEUE_BOUNDED_AUTHORITY_SQL}
    AND EXISTS (
      SELECT 1
      FROM decision approval
      WHERE approval.id = q."approvalDecisionId"
        AND approval."userId" = q."userId"
        AND approval.status = 'accepted'
        AND approval.authority = 'binding'
        AND upper(trim(approval.decision)) = 'APPROVE'
        AND approval.scope = q."outcomeKey"
    )
    AND EXISTS (
      SELECT 1
      FROM authority_grant authority
      WHERE authority."userId" = q."userId"
        AND authority.ref = q."authorityGrantRef"
        AND authority.status = 'active'
        AND authority."revokedAt" IS NULL
        AND (authority."expiresAt" IS NULL OR authority."expiresAt" > $3::timestamptz)
        AND authority."authorityLevel" = q."authorityLevel"
        AND authority."grantedTo" = q."authoritySubject"
        AND authority.scope = q."outcomeKey"
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(authority."blockedActions") blocked(action)
          WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
        )
        AND (
          cardinality(authority."allowedActions") = 0
          OR EXISTS (
            SELECT 1
            FROM unnest(authority."allowedActions") allowed(action)
            WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
          )
        )
        AND (
          authority."workOrderId" IS NULL
          OR authority."workOrderId" = q."activeWorkOrderId"
        )
    )
  ) AS "authorityEligible"
FROM "outcome_queue_item" q
WHERE q."userId" = $1
  AND q."outcomeKey" = ANY($2::text[])
ORDER BY q."outcomeKey" ASC
`

const MUTATION_RECEIPTS_SQL = `
SELECT
  receipt.id,
  receipt."idempotencyKey",
  receipt.operation,
  receipt."outcomeKey",
  receipt."requestHash",
  receipt."requestBinding",
  receipt."resultBinding",
  receipt."createdAt",
  (
    SELECT count(*)::integer
    FROM governance_event audit
    WHERE audit."userId" = receipt."userId"
      AND audit."eventType" = 'OUTCOME_QUEUE_' || upper(receipt.operation)
      AND (audit.metadata->>'receiptId')::integer = receipt.id
  ) AS "auditCount",
  (
    SELECT count(*)::integer
    FROM event_log event
    WHERE event."userId" = receipt."userId"
      AND event.type = 'OUTCOME_QUEUE_' || upper(receipt.operation)
      AND (event.metadata->>'receiptId')::integer = receipt.id
  ) AS "eventCount"
FROM "outcome_queue_mutation_receipt" receipt
WHERE receipt."userId" = $1
  AND receipt.operation = ANY($2::text[])
  AND receipt."outcomeKey" = ANY($3::text[])
ORDER BY receipt."createdAt" ASC, receipt.id ASC
`

const ACQUISITION_ATTEMPTS_SQL = `
SELECT id, "campaignWindowId", "processIdentity", "leaseHolder",
       "acquisitionKeyDigest", "leaseIdentityDigest", "checkpointDigest",
       "checkpointOutcomeId", "checkpointSequence", "checkpointState",
       "checkpointHeadSha", "checkpointMergeSha", "checkpointPrNumber",
       "outcomeKey", "fencingToken", "leaseExpiresAt", "activeWorkOrderId",
       disposition, reason, "attemptedAt"
FROM "outcome_queue_acquisition_attempt"
WHERE "userId" = $1
  AND "campaignWindowId" = $2
  AND "attemptedAt" >= $3::timestamptz
  AND "attemptedAt" <= $4::timestamptz
ORDER BY "attemptedAt" ASC, id ASC
`

const MUTATION_ATTEMPTS_SQL = `
SELECT id, "idempotencyKey", "requestHash", "resultDigest",
       "attemptOrdinal", disposition, "attemptedAt"
FROM "outcome_queue_mutation_attempt"
WHERE "userId" = $1
  AND "idempotencyKey" = ANY($2::text[])
  AND "attemptedAt" >= $3::timestamptz
  AND "attemptedAt" <= $4::timestamptz
ORDER BY "idempotencyKey" ASC, "attemptOrdinal" ASC
`

function success(detail = null) {
  return { ok: true, code: "PASS", detail }
}

function failure(code, detail = null) {
  return { ok: false, code, detail }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactKeys(value, keys) {
  return isRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
}

function timestamp(value) {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

function fresh(value, now, maxAgeMs) {
  const milliseconds = timestamp(value)
  return milliseconds !== null
    && milliseconds <= now
    && now - milliseconds <= maxAgeMs
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0
}

function nonempty(value) {
  return typeof value === "string" && value.trim().length > 0
}

function sortedUniqueStrings(value) {
  return Array.isArray(value)
    && value.length > 0
    && value.every(nonempty)
    && new Set(value).size === value.length
}

function ownerCountersAreZero(value) {
  return exactKeys(value, OWNER_COUNTERS)
    && OWNER_COUNTERS.every((key) => value[key] === 0)
}

function containsForbiddenCapability(value, key = "") {
  if (!/digest$/i.test(key) && FORBIDDEN_KEY.test(key)) return true
  if (typeof value === "string") return FORBIDDEN_VALUE.test(value)
  if (Array.isArray(value)) return value.some((entry) => containsForbiddenCapability(entry))
  if (!isRecord(value)) return false
  return Object.entries(value).some(
    ([entryKey, entry]) => containsForbiddenCapability(entry, entryKey),
  )
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

function sha256(value) {
  return createHash("sha256").update(
    typeof value === "string" ? value : JSON.stringify(canonical(value)),
  ).digest("hex")
}

function iso(value) {
  const milliseconds = timestamp(value)
  return milliseconds === null ? null : new Date(milliseconds).toISOString()
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function isUsefulProductFile(file) {
  return typeof file === "string"
    && PRODUCT_FILE.test(file.replaceAll("\\", "/"))
    && !file.replaceAll("\\", "/").startsWith("lib/outcome-queue/")
}

function validateOutcome(outcome, expectedOrdinal) {
  const keys = [
    "acquiredAt",
    "approval",
    "authority",
    "campaignOrdinal",
    "completedAt",
    "goalRef",
    "lifecycleState",
    "merge",
    "outcomeId",
    "outcomeKey",
    "queueOrder",
    "result",
    "riskClass",
    "usefulProductWork",
    "verification",
    "workOrderRef",
  ]
  if (!exactKeys(outcome, keys)
    || !positiveInteger(outcome.outcomeId)
    || !nonempty(outcome.outcomeKey)
    || !nonempty(outcome.goalRef)
    || outcome.campaignOrdinal !== expectedOrdinal
    || !Number.isSafeInteger(outcome.queueOrder)
    || outcome.queueOrder < 0
    || !["R0", "R1"].includes(outcome.riskClass)
    || outcome.lifecycleState !== "completed"
    || outcome.result !== "COMPLETE"
    || outcome.usefulProductWork !== true
    || outcome.workOrderRef !== `WO-HERMES-OUTCOME-${outcome.outcomeId}`
    || timestamp(outcome.acquiredAt) === null
    || timestamp(outcome.completedAt) === null
    || timestamp(outcome.completedAt) < timestamp(outcome.acquiredAt)) {
    return failure("OUTCOME_CONTRACT_INVALID", `ordinal=${expectedOrdinal}`)
  }
  if (!exactKeys(outcome.approval, ["decisionRef", "state"])
    || outcome.approval.state !== "approved"
    || !nonempty(outcome.approval.decisionRef)
    || !exactKeys(outcome.authority, [
      "action",
      "grantRef",
      "level",
      "riskClass",
      "state",
      "subject",
    ])
    || outcome.authority.state !== "matched"
    || outcome.authority.riskClass !== outcome.riskClass
    || !["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"].includes(outcome.authority.level)
    || outcome.authority.subject !== "operator"
    || outcome.authority.action !== "outcome:execute"
    || !nonempty(outcome.authority.grantRef)) {
    return failure("OUTCOME_AUTHORITY_INVALID", outcome.outcomeKey)
  }
  if (!exactKeys(outcome.merge, ["headSha", "mergeSha", "prNumber", "repository"])
    || outcome.merge.repository !== AUTHORIZED_REPOSITORY
    || !positiveInteger(outcome.merge.prNumber)
    || !SHA.test(outcome.merge.headSha)
    || !SHA.test(outcome.merge.mergeSha)) {
    return failure("OUTCOME_MERGE_EVIDENCE_INVALID", outcome.outcomeKey)
  }
  if (!exactKeys(outcome.verification, ["evidenceDigest", "observedAt", "status"])
    || outcome.verification.status !== "PASS"
    || !SHA256.test(outcome.verification.evidenceDigest)
    || timestamp(outcome.verification.observedAt) === null
    || timestamp(outcome.verification.observedAt) < timestamp(outcome.completedAt)) {
    return failure("OUTCOME_VERIFICATION_INVALID", outcome.outcomeKey)
  }
  return success()
}

function validateBlockedCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) {
    return failure("BLOCKED_NONSELECTION_EVIDENCE_MISSING")
  }
  const reasons = new Set()
  for (const candidate of candidates) {
    if (!exactKeys(candidate, [
      "acquisitionCount",
      "lifecycleState",
      "outcomeKey",
      "reason",
    ])
      || !nonempty(candidate.outcomeKey)
      || !["BLOCKED_DEPENDENCY", "BLOCKED_AUTHORITY"].includes(candidate.reason)
      || !["approved", "blocked", "paused"].includes(candidate.lifecycleState)
      || candidate.acquisitionCount !== 0) {
      return failure("BLOCKED_NONSELECTION_EVIDENCE_INVALID", candidate?.outcomeKey ?? null)
    }
    reasons.add(candidate.reason)
  }
  return ["BLOCKED_DEPENDENCY", "BLOCKED_AUTHORITY"].every((reason) => reasons.has(reason))
    ? success()
    : failure("BLOCKED_NONSELECTION_CLASS_INCOMPLETE")
}

function validateRestart(proof, outcomes) {
  if (!exactKeys(proof, [
    "acquisitionKeyDigest",
    "fencingToken",
    "leaseHolder",
    "leaseIdentityDigest",
    "mutationCount",
    "outcomeId",
    "postAttemptId",
    "postCheckpointDigest",
    "postRestartSequence",
    "preAttemptId",
    "preCheckpointDigest",
    "preRestartSequence",
    "processEpochAfter",
    "processEpochBefore",
    "workOrderRef",
  ])
    || !outcomes.some((outcome) => outcome.outcomeId === proof.outcomeId)
    || proof.workOrderRef !== `WO-HERMES-OUTCOME-${proof.outcomeId}`
    || !Number.isSafeInteger(proof.preRestartSequence)
    || !Number.isSafeInteger(proof.postRestartSequence)
    || proof.postRestartSequence <= proof.preRestartSequence
    || proof.mutationCount !== 1
    || !positiveInteger(proof.preAttemptId)
    || !positiveInteger(proof.postAttemptId)
    || proof.preAttemptId === proof.postAttemptId
    || !positiveInteger(proof.fencingToken)
    || !nonempty(proof.leaseHolder)
    || !SHA256.test(proof.acquisitionKeyDigest ?? "")
    || !SHA256.test(proof.leaseIdentityDigest ?? "")
    || !SHA256.test(proof.preCheckpointDigest ?? "")
    || !SHA256.test(proof.postCheckpointDigest ?? "")
    || !nonempty(proof.processEpochBefore)
    || !nonempty(proof.processEpochAfter)
    || proof.processEpochBefore === proof.processEpochAfter) {
    return failure("RESTART_EVIDENCE_INVALID")
  }
  return success()
}

function validateContention(proof, outcomes) {
  if (!exactKeys(proof, [
    "acquisitionKeyDigest",
    "activeWriterCount",
    "checkpointSequence",
    "checkpointDigest",
    "contenderIds",
    "fencingToken",
    "leaseHolder",
    "leaseIdentityDigest",
    "loserMutationCount",
    "losingAttemptId",
    "losingLeaseHolder",
    "losingLeaseIdentityDigest",
    "losingProcessIdentity",
    "outcomeId",
    "processEpoch",
    "winnerAttemptId",
    "winnerId",
    "workOrderRef",
  ])
    || !outcomes.some((outcome) => outcome.outcomeId === proof.outcomeId)
    || proof.workOrderRef !== `WO-HERMES-OUTCOME-${proof.outcomeId}`
    || !sortedUniqueStrings(proof.contenderIds)
    || proof.contenderIds.length < 2
    || !proof.contenderIds.includes(proof.winnerId)
    || !proof.contenderIds.includes(proof.losingLeaseHolder)
    || proof.winnerId === proof.losingLeaseHolder
    || proof.activeWriterCount !== 1
    || proof.loserMutationCount !== 0
    || !positiveInteger(proof.winnerAttemptId)
    || !positiveInteger(proof.losingAttemptId)
    || proof.winnerAttemptId === proof.losingAttemptId
    || !positiveInteger(proof.fencingToken)
    || !positiveInteger(proof.checkpointSequence)
    || !nonempty(proof.leaseHolder)
    || !nonempty(proof.losingLeaseHolder)
    || !nonempty(proof.processEpoch)
    || !nonempty(proof.losingProcessIdentity)
    || !SHA256.test(proof.acquisitionKeyDigest ?? "")
    || !SHA256.test(proof.leaseIdentityDigest ?? "")
    || !SHA256.test(proof.losingLeaseIdentityDigest ?? "")
    || !SHA256.test(proof.checkpointDigest ?? "")) {
    return failure("CONTENTION_EVIDENCE_INVALID")
  }
  return success()
}

function validateMutations(mutations) {
  if (!Array.isArray(mutations) || mutations.length !== REQUIRED_MUTATIONS.length) {
    return failure("MUTATION_EVIDENCE_INCOMPLETE")
  }
  const actions = mutations.map((entry) => entry?.action).sort()
  if (JSON.stringify(actions) !== JSON.stringify([...REQUIRED_MUTATIONS].sort())) {
    return failure("MUTATION_EVIDENCE_INCOMPLETE")
  }
  for (const mutation of mutations) {
    if (!exactKeys(mutation, [
      "action",
      "firstAttemptId",
      "idempotentReplay",
      "idempotencyKeyDigest",
      "mutationCount",
      "mutationCountAfterReplay",
      "receiptId",
      "replayAttemptId",
      "requestHash",
      "result",
      "resultDigest",
      "targetOutcomeKey",
    ])
      || !nonempty(mutation.targetOutcomeKey)
      || mutation.result !== "PASS"
      || mutation.mutationCount !== 1
      || mutation.mutationCountAfterReplay !== mutation.mutationCount
      || mutation.idempotentReplay !== true
      || !positiveInteger(mutation.firstAttemptId)
      || !positiveInteger(mutation.receiptId)
      || !positiveInteger(mutation.replayAttemptId)
      || mutation.firstAttemptId === mutation.replayAttemptId
      || !SHA256.test(mutation.idempotencyKeyDigest ?? "")
      || !SHA256.test(mutation.requestHash ?? "")
      || !SHA256.test(mutation.resultDigest ?? "")) {
      return failure("MUTATION_EVIDENCE_INVALID", mutation?.action ?? null)
    }
  }
  return success()
}

function validateSurfaceAgreement(agreement, outcomes, now, maxAgeMs) {
  if (!exactKeys(agreement, ["observedAt", "outcomes", "routes"])
    || !fresh(agreement.observedAt, now, maxAgeMs)
    || !Array.isArray(agreement.outcomes)
    || agreement.outcomes.length !== 2
    || !Array.isArray(agreement.routes)
    || agreement.routes.length !== REQUIRED_SURFACES.length) {
    return failure("PRODUCT_SURFACE_AGREEMENT_INVALID")
  }
  const expectedOutcomes = outcomes.map((outcome) => ({
    outcomeId: outcome.outcomeId,
    state: "COMPLETE",
    workOrderRef: outcome.workOrderRef,
  }))
  if (JSON.stringify(agreement.outcomes) !== JSON.stringify(expectedOutcomes)) {
    return failure("PRODUCT_SURFACE_OUTCOME_MISMATCH")
  }
  if (agreement.routes.some((route) => (
    !isRecord(route)
    || typeof route.route !== "string"
  ))) {
    return failure("PRODUCT_SURFACE_ROUTE_MISMATCH")
  }
  const routes = [...agreement.routes].sort((left, right) => left.route.localeCompare(right.route))
  if (routes.some((route) => !exactKeys(route, ["evidenceDigest", "route", "status"])
      || route.status !== 200
      || !SHA256.test(route.evidenceDigest))
    || JSON.stringify(routes.map((entry) => entry.route))
      !== JSON.stringify([...REQUIRED_SURFACES].sort())) {
    return failure("PRODUCT_SURFACE_ROUTE_MISMATCH")
  }
  return success({ routes: REQUIRED_SURFACES, outcomeCount: 2 })
}

export function validateCampaignEvidence(
  document,
  {
    currentRevision,
    now = Date.now(),
    maxAgeMs = DEFAULT_MAX_AGE_MS,
  } = {},
) {
  const keys = [
    "automaticSuccessor",
    "blockedCandidates",
    "campaign",
    "campaignRunId",
    "contention",
    "observedAt",
    "outcomes",
    "ownerTouchCounters",
    "parentIssue",
    "repository",
    "restart",
    "schemaVersion",
    "sourceRevision",
    "surfaceAgreement",
    "mutations",
  ]
  if (!exactKeys(document, keys)
    || document.schemaVersion !== SCHEMA_VERSION
    || document.campaign !== CAMPAIGN
    || !/^[A-Za-z0-9][A-Za-z0-9:_-]{7,127}$/.test(document.campaignRunId ?? "")
    || document.parentIssue !== PARENT_ISSUE
    || document.repository !== AUTHORIZED_REPOSITORY
    || !SHA.test(document.sourceRevision ?? "")
    || document.sourceRevision !== currentRevision
    || !fresh(document.observedAt, now, maxAgeMs)
    || containsForbiddenCapability(document)) {
    return failure("CAMPAIGN_EVIDENCE_CONTRACT_INVALID")
  }
  if (!Array.isArray(document.outcomes) || document.outcomes.length !== 2) {
    return failure("TWO_OUTCOME_EVIDENCE_REQUIRED")
  }
  const first = validateOutcome(document.outcomes[0], 1)
  const second = validateOutcome(document.outcomes[1], 2)
  if (!first.ok) return first
  if (!second.ok) return second
  if (document.outcomes[0].outcomeId === document.outcomes[1].outcomeId
    || document.outcomes[0].outcomeKey === document.outcomes[1].outcomeKey) {
    return failure("OUTCOME_IDENTITY_COLLISION")
  }
  const successor = document.automaticSuccessor
  if (!exactKeys(successor, [
    "acquiredOutcomeId",
    "ownerContactCount",
    "predecessorOutcomeId",
    "trigger",
  ])
    || successor.predecessorOutcomeId !== document.outcomes[0].outcomeId
    || successor.acquiredOutcomeId !== document.outcomes[1].outcomeId
    || successor.trigger !== "PREDECESSOR_COMPLETED"
    || successor.ownerContactCount !== 0
    || timestamp(document.outcomes[1].acquiredAt) < timestamp(document.outcomes[0].completedAt)) {
    return failure("AUTOMATIC_SUCCESSOR_EVIDENCE_INVALID")
  }
  const checks = [
    validateBlockedCandidates(document.blockedCandidates),
    validateRestart(document.restart, document.outcomes),
    validateContention(document.contention, document.outcomes),
    validateMutations(document.mutations),
    validateSurfaceAgreement(document.surfaceAgreement, document.outcomes, now, maxAgeMs),
    ownerCountersAreZero(document.ownerTouchCounters)
      ? success()
      : failure("FAIL_OWNER_BABYSITTING"),
  ]
  const failed = checks.find((check) => !check.ok)
  return failed ?? success({
    outcomes: document.outcomes.map((outcome) => ({
      outcomeId: outcome.outcomeId,
      outcomeKey: outcome.outcomeKey,
      workOrderRef: outcome.workOrderRef,
      prNumber: outcome.merge.prNumber,
      mergeSha: outcome.merge.mergeSha,
    })),
    ownerTouchCounters: document.ownerTouchCounters,
    surfaceAgreement: document.surfaceAgreement,
  })
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    timeout: options.timeout ?? 120_000,
    windowsHide: true,
    shell: false,
  })
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    code: result.error?.code ?? null,
  }
}

function safeJson(filePath) {
  try {
    return success(JSON.parse(fs.readFileSync(filePath, "utf8")))
  } catch {
    return failure("JSON_READ_FAILED", filePath)
  }
}

async function openReadOnly({ databaseUrl, query, createPool }) {
  if (typeof query === "function") return { query, close: async () => {} }
  if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
    throw Object.assign(new Error("DATABASE_URL_REQUIRED"), { code: "DATABASE_URL_REQUIRED" })
  }
  const pool = createPool
    ? await createPool(databaseUrl)
    : new (await import("pg")).Pool({
        connectionString: databaseUrl,
        allowExitOnIdle: true,
      })
  if (!pool || typeof pool.connect !== "function" || typeof pool.end !== "function") {
    throw Object.assign(new Error("V1_2_DATABASE_POOL_WALL"), {
      code: "V1_2_DATABASE_POOL_WALL",
    })
  }
  let client
  try {
    client = await pool.connect()
  } catch (error) {
    try {
      await pool.end()
    } catch {
      // Preserve the connection failure while still attempting pool cleanup.
    }
    throw error
  }
  return {
    query: client.query.bind(client),
    close: async () => {
      client.release()
      await pool.end()
    },
  }
}

export function buildLiveOutcomeDigest({
  checkpoint,
  evidenceRecords,
  outcome,
  productFiles,
  receipt,
}) {
  return sha256({
    checkpointEventId: Number(checkpoint.id),
    checkpointSequence: Number(checkpoint.metadata.checkpointSequence),
    evidenceRecordIds: evidenceRecords.map((record) => Number(record.id)).sort((left, right) => left - right),
    headSha: checkpoint.metadata.headRefOid,
    mergeSha: checkpoint.metadata.mergeSha,
    outcomeId: Number(outcome.outcomeId),
    outcomeKey: outcome.outcomeKey,
    prNumber: Number(checkpoint.metadata.prNumber),
    productFiles: [...productFiles].sort(),
    receiptId: Number(receipt.receiptId),
    terminalEvidenceRefs: [...outcome.terminalEvidenceRefs].sort(),
    workOrderId: Number(outcome.workOrderId),
    workOrderRef: outcome.workOrderRef,
  })
}

function verifyLocalExecution(localState, claim, row, receipt, checkpoint) {
  const executions = Object.values(localState?.executions ?? {})
  const matches = executions.filter(
    (execution) => String(execution?.outcomeId) === String(claim.outcomeId),
  )
  if (matches.length !== 1) return failure("LOCAL_OUTCOME_IDENTITY_MISMATCH", claim.outcomeKey)
  const execution = matches[0]
  const binding = execution?.metadata?.outcome?.queueBinding
  if (execution?.lease?.status !== "RELEASED"
    || execution?.checkpoint?.state !== "COMPLETE"
    || !positiveInteger(Number(execution.fencingToken))
    || Number(binding?.fencingToken) !== Number(receipt.latestFencingToken)
    || Number(row.fencingToken) !== Number(receipt.latestFencingToken)
    || execution.checkpoint.sequence !== Number(checkpoint.metadata.checkpointSequence)
    || execution.metadata?.prNumber !== Number(checkpoint.metadata.prNumber)
    || execution.metadata?.headRefOid !== checkpoint.metadata.headRefOid
    || execution.metadata?.mergeSha !== checkpoint.metadata.mergeSha
    || binding?.outcomeKey !== claim.outcomeKey
    || Number(binding?.activeWorkOrderId) !== Number(row.workOrderId)
    || timestamp(execution.lease.acquiredAt) === null
    || timestamp(execution.lease.releasedAt) === null
    || timestamp(execution.lease.acquiredAt) < timestamp(claim.acquiredAt)
    || timestamp(execution.lease.acquiredAt) > timestamp(claim.completedAt)
    || timestamp(execution.lease.releasedAt) < timestamp(claim.completedAt)) {
    return failure("LOCAL_OUTCOME_STATE_MISMATCH", claim.outcomeKey)
  }
  return success({
    checkpointSequence: execution.checkpoint.sequence,
    localFencingToken: execution.fencingToken,
    outcomeId: claim.outcomeId,
    queueFencingToken: binding.fencingToken,
  })
}

function verifyLiveOutcome(claim, row, receipt, checkpoints, evidenceRecords, localState) {
  const completeCheckpoints = checkpoints.filter((event) => (
    Number(event.workOrderId) === Number(row.workOrderId)
    && event.metadata?.checkpointState === "COMPLETE"
  ))
  if (completeCheckpoints.length !== 1) {
    return failure("LIVE_TERMINAL_CHECKPOINT_CARDINALITY_WALL", claim.outcomeKey)
  }
  const checkpoint = completeCheckpoints[0]
  const terminalRecords = evidenceRecords.filter(
    (record) => Number(record.workOrderId) === Number(row.workOrderId),
  )
  const productFiles = [...new Set(
    terminalRecords.flatMap((record) => record.filesChanged ?? []).filter(isUsefulProductFile),
  )].sort()
  const runtimeEvidenceRef = checkpoint.metadata?.runtimeEvidenceRef
  const expectedTerminalRefs = [
    runtimeEvidenceRef,
    `pr:${Number(checkpoint.metadata?.prNumber)}`,
    `merge:${checkpoint.metadata?.mergeSha}`,
  ]
  if (Number(row.outcomeId) !== claim.outcomeId
    || row.outcomeKey !== claim.outcomeKey
    || row.goalRef !== claim.goalRef
    || Number(row.queueOrder) !== claim.queueOrder
    || row.riskClass !== claim.riskClass
    || row.approvalState !== "approved"
    || row.approvalDecisionRef !== claim.approval.decisionRef
    || row.approvalDecisionStatus !== "accepted"
    || row.approvalDecisionAuthority !== "binding"
    || row.authorityState !== "matched"
    || row.authorityLevel !== claim.authority.level
    || row.authoritySubject !== claim.authority.subject
    || row.authorityAction !== claim.authority.action
    || row.authorityGrantRef !== claim.authority.grantRef
    || row.liveAuthorityGrantRef !== claim.authority.grantRef
    || row.authorityGrantStatus !== "active"
    || row.authorityGrantRevokedAt !== null
    || row.lifecycleState !== "completed"
    || row.terminalResult !== "COMPLETE"
    || Number(row.activeWorkOrderId) !== Number(row.workOrderId)
    || row.workOrderRef !== claim.workOrderRef
    || row.workOrderStatus !== "closed"
    || row.workOrderResult !== "PASS"
    || row.workOrderCommitRef !== claim.merge.mergeSha
    || timestamp(row.workOrderCompletedAt) === null
    || timestamp(row.workOrderCompletedAt) < timestamp(claim.acquiredAt)
    || timestamp(row.workOrderCompletedAt) > timestamp(claim.completedAt)
    || iso(row.terminalAt) !== claim.completedAt
    || iso(receipt.acquiredAt) !== claim.acquiredAt
    || Number(receipt.receiptCount) !== 1
    || !positiveInteger(Number(receipt.receiptId))
    || !positiveInteger(Number(receipt.firstFencingToken))
    || Number(receipt.latestFencingToken) < Number(receipt.firstFencingToken)
    || checkpoint.metadata?.outcomeId !== claim.outcomeId
    || checkpoint.metadata?.workOrderRef !== claim.workOrderRef
    || Number(checkpoint.metadata?.prNumber) !== claim.merge.prNumber
    || checkpoint.metadata?.headRefOid !== claim.merge.headSha
    || checkpoint.metadata?.mergeSha !== claim.merge.mergeSha
    || timestamp(checkpoint.createdAt) === null
    || timestamp(checkpoint.createdAt) > timestamp(claim.completedAt)
    || !nonempty(runtimeEvidenceRef)
    || !sameStrings(row.terminalEvidenceRefs, expectedTerminalRefs)
    || row.terminalKey !== `hermes:${claim.outcomeKey}:${row.fencingToken}:${claim.merge.mergeSha}`
    || terminalRecords.length === 0
    || !terminalRecords.some((record) => (
      record.ref === runtimeEvidenceRef
      && record.result === "PASS"
      && record.repo === AUTHORIZED_REPOSITORY
      && record.head === claim.merge.mergeSha
      && SHA256.test(record.contentHash ?? "")
    ))
    || terminalRecords.some((record) => (
      (record.knownFailures?.length ?? 0) > 0
      || (record.outOfScopeChanges?.length ?? 0) > 0
    ))
    || productFiles.length === 0) {
    return failure("LIVE_OUTCOME_RECORD_MISMATCH", claim.outcomeKey)
  }
  const local = verifyLocalExecution(localState, claim, row, receipt, checkpoint)
  if (!local.ok) return local
  const digest = buildLiveOutcomeDigest({
    checkpoint,
    evidenceRecords: terminalRecords,
    outcome: row,
    productFiles,
    receipt,
  })
  if (claim.verification.evidenceDigest !== digest) {
    return failure("LIVE_OUTCOME_DIGEST_MISMATCH", claim.outcomeKey)
  }
  return success({
    digest,
    mergeSha: claim.merge.mergeSha,
    outcomeId: claim.outcomeId,
    outcomeKey: claim.outcomeKey,
    prNumber: claim.merge.prNumber,
    productFiles,
    workOrderId: Number(row.workOrderId),
    workOrderRef: claim.workOrderRef,
  })
}

function verifyBlockedRows(claims, rows) {
  if (rows.length !== claims.length) return failure("LIVE_BLOCKED_CANDIDATE_CARDINALITY_WALL")
  for (const claim of claims) {
    const row = rows.find((candidate) => candidate.outcomeKey === claim.outcomeKey)
    const blockedByDependency = Number(row?.blockedDependencyCount) > 0
    const blockedByAuthority = row?.authorityEligible !== true
    if (!row
      || row.lifecycleState !== claim.lifecycleState
      || Number(row.acquisitionCount) !== 0
      || claim.acquisitionCount !== 0
      || (claim.reason === "BLOCKED_DEPENDENCY" && !blockedByDependency)
      || (claim.reason === "BLOCKED_AUTHORITY" && !blockedByAuthority)) {
      return failure("LIVE_BLOCKED_NONSELECTION_MISMATCH", claim.outcomeKey)
    }
  }
  return success({ candidates: claims.map((claim) => claim.outcomeKey).sort() })
}

function checkpointProofFromAttempt(attempt) {
  return canonicalOutcomeQueueCheckpointProof({
    outcomeId: attempt.checkpointOutcomeId,
    outcomeKey: attempt.outcomeKey,
    workOrderId: attempt.activeWorkOrderId == null ? null : Number(attempt.activeWorkOrderId),
    fencingToken: Number(attempt.fencingToken),
    sequence: Number(attempt.checkpointSequence),
    state: attempt.checkpointState,
    commit: {
      headSha: attempt.checkpointHeadSha,
      mergeSha: attempt.checkpointMergeSha,
      prNumber: attempt.checkpointPrNumber == null ? null : Number(attempt.checkpointPrNumber),
    },
  })
}

export function checkpointRecordMatchesAttempt(attempt, checkpoints, localState) {
  const proof = checkpointProofFromAttempt(attempt)
  if (digestOutcomeQueueCheckpointProof(proof) !== attempt.checkpointDigest) return false
  const historical = checkpoints.some((event) => (
    Number(event.workOrderId) === proof.workOrderId
    && String(event.metadata?.outcomeId) === proof.outcomeId
    && Number(event.metadata?.checkpointSequence) === proof.sequence
    && event.metadata?.checkpointState === proof.state
    && (event.metadata?.headRefOid ?? null) === proof.commit.headSha
    && (event.metadata?.mergeSha ?? null) === proof.commit.mergeSha
    && (event.metadata?.prNumber == null ? null : Number(event.metadata.prNumber))
      === proof.commit.prNumber
  ))
  const execution = Object.values(localState.executions ?? {}).find(
    (candidate) => String(candidate?.outcomeId) === proof.outcomeId,
  )
  const binding = execution?.metadata?.outcome?.queueBinding
  const current = execution
    && binding?.outcomeKey === proof.outcomeKey
    && Number(binding?.activeWorkOrderId ?? null) === proof.workOrderId
    && Number(binding?.fencingToken) === proof.fencingToken
    && Number(execution.checkpoint?.sequence) === proof.sequence
    && execution.checkpoint?.state === proof.state
    && (execution.metadata?.headRefOid ?? null) === proof.commit.headSha
    && (execution.metadata?.mergeSha ?? null) === proof.commit.mergeSha
    && (execution.metadata?.prNumber ?? null) === proof.commit.prNumber
  return historical || Boolean(current)
}

function canonicalInitialAcquisition(attempt, row) {
  try {
    const proof = checkpointProofFromAttempt(attempt)
    return digestOutcomeQueueCheckpointProof(proof) === attempt.checkpointDigest
      && attempt.disposition === "WINNER"
      && attempt.reason == null
      && attempt.outcomeKey === row.outcomeKey
      && attempt.checkpointOutcomeId === String(row.outcomeId)
      && attempt.activeWorkOrderId == null
      && proof.workOrderId === null
      && proof.sequence === 0
      && proof.state === "LEASED"
      && proof.commit.headSha === null
      && proof.commit.mergeSha === null
      && proof.commit.prNumber === null
  } catch {
    return false
  }
}

function verifyAcquisitionAttempts(
  claims,
  rows,
  attempts,
  checkpoints,
  localState,
  supervisorState,
) {
  const windowStart = timestamp(claims.outcomes[0].acquiredAt)
  const windowEnd = timestamp(claims.outcomes[1].completedAt)
  const knownProcessIdentities = new Set([
    supervisorState?.nonce,
    claims.restart.processEpochBefore,
    claims.restart.processEpochAfter,
    claims.contention.processEpoch,
    claims.contention.losingProcessIdentity,
  ].filter((value) => typeof value === "string" && value.trim() !== ""))
  const boundDispositions = new Set(["REPLAY_WINNER", "RECLAIMED", "LOSER"])
  if (supervisorState?.campaignWindowId !== claims.campaignRunId
    || attempts.some((attempt) => {
      const row = rows.find((candidate) => candidate.outcomeKey === attempt.outcomeKey)
      const claim = Number(row?.outcomeId) === claims.restart.outcomeId
        ? claims.restart
        : Number(row?.outcomeId) === claims.contention.outcomeId
          ? claims.contention
          : null
      if (!row
        || !claim
        || attempt.campaignWindowId !== claims.campaignRunId
        || timestamp(attempt.attemptedAt) < windowStart
        || timestamp(attempt.attemptedAt) > windowEnd
        || typeof attempt.processIdentity !== "string"
        || attempt.processIdentity.trim() === ""
        || !knownProcessIdentities.has(attempt.processIdentity)
        || typeof attempt.leaseHolder !== "string"
        || attempt.leaseHolder.trim() === ""
        || !SHA256.test(attempt.acquisitionKeyDigest ?? "")
        || !SHA256.test(attempt.leaseIdentityDigest ?? "")
        || attempt.checkpointOutcomeId !== String(row.outcomeId)
        || attempt.acquisitionKeyDigest !== claim.acquisitionKeyDigest) return true
      if (canonicalInitialAcquisition(attempt, row)) return false
      if (!boundDispositions.has(attempt.disposition)
        || Number(attempt.activeWorkOrderId) !== Number(row.workOrderId)
        || (attempt.disposition === "LOSER"
          ? attempt.reason !== "ACQUISITION_KEY_CONFLICT"
            || attempt.leaseHolder !== claims.contention.losingLeaseHolder
            || attempt.processIdentity !== claims.contention.losingProcessIdentity
            || attempt.leaseIdentityDigest !== claims.contention.losingLeaseIdentityDigest
          : attempt.reason != null
            || attempt.leaseHolder !== claim.leaseHolder
            || attempt.leaseIdentityDigest !== claim.leaseIdentityDigest)) return true
      try {
        return !checkpointRecordMatchesAttempt(attempt, checkpoints, localState)
      } catch {
        return true
      }
    })) {
    return failure("LIVE_ACQUISITION_ATTEMPT_WINDOW_WALL")
  }
  for (const row of rows) {
    const initial = attempts.filter((attempt) => canonicalInitialAcquisition(attempt, row))
    const claim = Number(row.outcomeId) === claims.restart.outcomeId
      ? claims.restart
      : Number(row.outcomeId) === claims.contention.outcomeId
        ? claims.contention
        : null
    const expectedProcessIdentity = claim === claims.restart
      ? claims.restart.processEpochBefore
      : claim === claims.contention
        ? claims.contention.processEpoch
        : null
    if (initial.length !== 1
      || !claim
      || initial[0].processIdentity !== expectedProcessIdentity
      || Number(initial[0].fencingToken) !== Number(claim.fencingToken)
      || Number(initial[0].fencingToken) !== Number(row.fencingToken)
      || initial[0].acquisitionKeyDigest !== claim.acquisitionKeyDigest
      || initial[0].leaseIdentityDigest !== claim.leaseIdentityDigest
      || initial[0].leaseHolder !== claim.leaseHolder) {
      return failure("LIVE_INITIAL_ACQUISITION_PROOF_MISMATCH", row.outcomeKey)
    }
  }
  const restartClaim = claims.restart
  const restartRow = rows.find(
    (row) => Number(row.outcomeId) === restartClaim.outcomeId,
  )
  const restartExecution = Object.values(localState.executions ?? {}).find(
    (execution) => String(execution?.outcomeId) === String(restartClaim.outcomeId),
  )
  const restartBinding = restartExecution?.metadata?.outcome?.queueBinding
  const restartPre = attempts.find((attempt) => Number(attempt.id) === restartClaim.preAttemptId)
  const restartPost = attempts.find((attempt) => Number(attempt.id) === restartClaim.postAttemptId)
  if (!restartRow
    || !restartPre
    || !restartPost
    || restartPre.outcomeKey !== restartRow.outcomeKey
    || restartPost.outcomeKey !== restartRow.outcomeKey
    || restartPre.checkpointOutcomeId !== String(restartRow.outcomeId)
    || restartPost.checkpointOutcomeId !== String(restartRow.outcomeId)
    || Number(restartPre.activeWorkOrderId) !== Number(restartRow.workOrderId)
    || Number(restartPost.activeWorkOrderId) !== Number(restartRow.workOrderId)
    || Number(restartPre.fencingToken) !== restartClaim.fencingToken
    || Number(restartPost.fencingToken) !== restartClaim.fencingToken
    || restartPre.leaseHolder !== restartClaim.leaseHolder
    || restartPost.leaseHolder !== restartClaim.leaseHolder
    || restartPre.acquisitionKeyDigest !== restartClaim.acquisitionKeyDigest
    || restartPost.acquisitionKeyDigest !== restartClaim.acquisitionKeyDigest
    || restartPre.leaseIdentityDigest !== restartClaim.leaseIdentityDigest
    || restartPost.leaseIdentityDigest !== restartClaim.leaseIdentityDigest
    || restartPre.checkpointDigest !== restartClaim.preCheckpointDigest
    || restartPost.checkpointDigest !== restartClaim.postCheckpointDigest
    || restartPre.processIdentity !== restartClaim.processEpochBefore
    || restartPost.processIdentity !== restartClaim.processEpochAfter
    || restartPost.processIdentity !== supervisorState?.nonce
    || restartPre.disposition !== "REPLAY_WINNER"
    || restartPost.disposition !== "REPLAY_WINNER"
    || restartClaim.fencingToken !== Number(restartRow.fencingToken)
    || restartClaim.fencingToken !== Number(restartBinding?.fencingToken)
    || restartClaim.leaseHolder !== restartExecution?.lease?.holderId
    || restartClaim.postRestartSequence >= Number(restartExecution?.checkpoint?.sequence)
    || restartClaim.mutationCount !== 1) {
    return failure("LIVE_RESTART_PROOF_MISMATCH")
  }

  const contentionClaim = claims.contention
  const contentionRow = rows.find(
    (row) => Number(row.outcomeId) === contentionClaim.outcomeId,
  )
  const contentionExecution = Object.values(localState.executions ?? {}).find(
    (execution) => String(execution?.outcomeId) === String(contentionClaim.outcomeId),
  )
  const contentionBinding = contentionExecution?.metadata?.outcome?.queueBinding
  const winner = attempts.find(
    (attempt) => Number(attempt.id) === contentionClaim.winnerAttemptId,
  )
  const loser = attempts.find(
    (attempt) => Number(attempt.id) === contentionClaim.losingAttemptId,
  )
  if (!contentionRow
    || !winner
    || !loser
    || winner.outcomeKey !== contentionRow.outcomeKey
    || loser.outcomeKey !== contentionRow.outcomeKey
    || winner.checkpointOutcomeId !== String(contentionRow.outcomeId)
    || loser.checkpointOutcomeId !== String(contentionRow.outcomeId)
    || Number(winner.activeWorkOrderId) !== Number(contentionRow.workOrderId)
    || Number(loser.activeWorkOrderId) !== Number(contentionRow.workOrderId)
    || Number(winner.fencingToken) !== contentionClaim.fencingToken
    || Number(loser.fencingToken) !== contentionClaim.fencingToken
    || winner.leaseHolder !== contentionClaim.leaseHolder
    || loser.leaseHolder !== contentionClaim.losingLeaseHolder
    || winner.acquisitionKeyDigest !== contentionClaim.acquisitionKeyDigest
    || loser.acquisitionKeyDigest !== contentionClaim.acquisitionKeyDigest
    || winner.leaseIdentityDigest !== contentionClaim.leaseIdentityDigest
    || loser.leaseIdentityDigest !== contentionClaim.losingLeaseIdentityDigest
    || winner.checkpointDigest !== contentionClaim.checkpointDigest
    || loser.checkpointDigest !== contentionClaim.checkpointDigest
    || winner.processIdentity !== contentionClaim.processEpoch
    || winner.processIdentity !== supervisorState?.nonce
    || loser.processIdentity !== contentionClaim.losingProcessIdentity
    || !sameStrings([winner.leaseHolder, loser.leaseHolder], contentionClaim.contenderIds)
    || winner.leaseHolder !== contentionClaim.winnerId
    || winner.disposition !== "REPLAY_WINNER"
    || loser.disposition !== "LOSER"
    || loser.reason !== "ACQUISITION_KEY_CONFLICT"
    || contentionClaim.fencingToken !== Number(contentionRow.fencingToken)
    || contentionClaim.fencingToken !== Number(contentionBinding?.fencingToken)
    || contentionClaim.checkpointSequence !== Number(contentionExecution?.checkpoint?.sequence)
    || contentionClaim.leaseHolder !== contentionExecution?.lease?.holderId
    || contentionClaim.winnerId !== contentionClaim.leaseHolder) {
    return failure("LIVE_CONTENTION_PROOF_MISMATCH")
  }
  return success({
    contentionAttemptIds: [winner.id, loser.id],
    processEpoch: supervisorState.nonce,
    restartAttemptIds: [restartPre.id, restartPost.id],
  })
}

export function verifyMutationRows(claims, rows, attempts) {
  if (rows.length !== claims.length) return failure("LIVE_MUTATION_RECEIPT_CARDINALITY_WALL")
  if (attempts.length !== claims.length * 2) {
    return failure("LIVE_MUTATION_ATTEMPT_CARDINALITY_WALL")
  }
  for (const claim of claims) {
    const operation = claim.action.toLowerCase()
    const row = rows.find((receipt) => (
      Number(receipt.id) === claim.receiptId
      && receipt.operation === operation
      && receipt.outcomeKey === claim.targetOutcomeKey
    ))
    const matchingAttempts = attempts.filter(
      (attempt) => attempt.idempotencyKey === row?.idempotencyKey,
    )
    const first = matchingAttempts.find((attempt) => Number(attempt.attemptOrdinal) === 1)
    const replay = matchingAttempts.find((attempt) => Number(attempt.attemptOrdinal) === 2)
    if (!row
      || matchingAttempts.length !== 2
      || !first
      || !replay
      || row.requestHash !== claim.requestHash
      || sha256(row.idempotencyKey) !== claim.idempotencyKeyDigest
      || sha256(row.resultBinding) !== claim.resultDigest
      || Number(row.auditCount) !== 1
      || Number(row.eventCount) !== 1
      || row.requestBinding?.action !== operation
      || row.requestBinding?.outcomeKey !== claim.targetOutcomeKey
      || row.resultBinding?.outcome?.outcomeKey !== claim.targetOutcomeKey
      || Number(first.id) !== claim.firstAttemptId
      || Number(replay.id) !== claim.replayAttemptId
      || first.requestHash !== row.requestHash
      || replay.requestHash !== row.requestHash
      || first.resultDigest !== claim.resultDigest
      || replay.resultDigest !== claim.resultDigest
      || first.disposition !== OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.COMMITTED
      || replay.disposition !== OUTCOME_QUEUE_MUTATION_ATTEMPT_DISPOSITIONS.REPLAY
      || claim.mutationCount !== 1
      || claim.mutationCountAfterReplay !== claim.mutationCount) {
      return failure("LIVE_MUTATION_REPLAY_MISMATCH", claim.action)
    }
  }
  return success({
    receipts: claims.map((claim) => ({
      action: claim.action,
      firstAttemptId: claim.firstAttemptId,
      receiptId: claim.receiptId,
      replayAttemptId: claim.replayAttemptId,
      resultDigest: claim.resultDigest,
    })),
  })
}

export async function verifyLiveCampaignRecords({
  claims,
  databaseUrl = process.env.DATABASE_URL,
  query,
  createPool,
  localState,
  supervisorState,
  rereadLocalState,
  now = Date.now(),
} = {}) {
  let connection = null
  let committed = false
  try {
    connection = await openReadOnly({ databaseUrl, query, createPool })
    await connection.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    const primary = await connection.query(PRIMARY_SQL, [DECLARED_PRIMARY_EMAIL])
    if (primary?.rows?.length !== 1) {
      throw Object.assign(new Error("V1_2_PRIMARY_IDENTITY_WALL"), {
        code: "V1_2_PRIMARY_IDENTITY_WALL",
      })
    }
    const userId = primary.rows[0].id
    const outcomesResult = await connection.query(
      LIVE_OUTCOMES_SQL,
      [userId, new Date(now).toISOString()],
    )
    if (outcomesResult?.rows?.length !== 2) {
      throw Object.assign(new Error("V1_2_LIVE_OUTCOME_CARDINALITY_WALL"), {
        code: "V1_2_LIVE_OUTCOME_CARDINALITY_WALL",
      })
    }
    const outcomeKeys = outcomesResult.rows.map((row) => row.outcomeKey)
    const workOrderIds = outcomesResult.rows.map((row) => Number(row.workOrderId))
    const blockedKeys = claims.blockedCandidates.map((candidate) => candidate.outcomeKey)
    const mutationKeys = claims.mutations.map((mutation) => mutation.targetOutcomeKey)
    const [
      receiptsResult,
      checkpointsResult,
      evidenceResult,
      blockedResult,
      mutationsResult,
      acquisitionAttemptsResult,
    ] =
      await Promise.all([
        connection.query(ACQUISITION_RECEIPTS_SQL, [userId, outcomeKeys]),
        connection.query(CHECKPOINTS_SQL, [userId, workOrderIds.map(String)]),
        connection.query(TERMINAL_EVIDENCE_SQL, [userId, workOrderIds]),
        connection.query(BLOCKED_CANDIDATES_SQL, [userId, blockedKeys, new Date(now).toISOString()]),
        connection.query(MUTATION_RECEIPTS_SQL, [
          userId,
          REQUIRED_MUTATIONS.map((action) => action.toLowerCase()),
          mutationKeys,
        ]),
        connection.query(ACQUISITION_ATTEMPTS_SQL, [
          userId,
          claims.campaignRunId,
          claims.outcomes[0].acquiredAt,
          claims.outcomes[1].completedAt,
        ]),
      ])
    const mutationAttemptsResult = await connection.query(MUTATION_ATTEMPTS_SQL, [
      userId,
      (mutationsResult.rows ?? []).map((row) => row.idempotencyKey),
      claims.outcomes[0].acquiredAt,
      claims.outcomes[1].completedAt,
    ])
    if (receiptsResult?.rows?.length !== 2) {
      throw Object.assign(new Error("V1_2_ACQUISITION_RECEIPT_CARDINALITY_WALL"), {
        code: "V1_2_ACQUISITION_RECEIPT_CARDINALITY_WALL",
      })
    }
    const outcomeChecks = claims.outcomes.map((claim, index) => {
      const row = outcomesResult.rows[index]
      const receipt = receiptsResult.rows.find((entry) => entry.outcomeKey === row.outcomeKey)
      return receipt
        ? verifyLiveOutcome(
            claim,
            row,
            receipt,
            checkpointsResult.rows ?? [],
            evidenceResult.rows ?? [],
            localState,
          )
        : failure("LIVE_ACQUISITION_RECEIPT_MISSING", claim.outcomeKey)
    })
    const failedOutcome = outcomeChecks.find((check) => !check.ok)
    if (failedOutcome) return failedOutcome
    const secondReceipt = receiptsResult.rows.find(
      (receipt) => receipt.outcomeKey === claims.outcomes[1].outcomeKey,
    )
    if (timestamp(secondReceipt?.acquiredAt) < timestamp(outcomesResult.rows[0].terminalAt)) {
      return failure("LIVE_AUTOMATIC_SUCCESSOR_ORDERING_WALL")
    }
    const blocked = verifyBlockedRows(claims.blockedCandidates, blockedResult.rows ?? [])
    if (!blocked.ok) return blocked
    const acquisitionAttempts = verifyAcquisitionAttempts(
      claims,
      outcomesResult.rows,
      acquisitionAttemptsResult.rows ?? [],
      checkpointsResult.rows ?? [],
      localState,
      supervisorState,
    )
    if (!acquisitionAttempts.ok) return acquisitionAttempts
    const mutations = verifyMutationRows(
      claims.mutations,
      mutationsResult.rows ?? [],
      mutationAttemptsResult.rows ?? [],
    )
    if (!mutations.ok) return mutations
    const localAfter = typeof rereadLocalState === "function" ? rereadLocalState() : localState
    if (localAfter?.revision !== localState?.revision
      || localAfter?.updatedAt !== localState?.updatedAt) {
      return failure("LOCAL_STATE_CONCURRENT_MUTATION_WALL")
    }
    await connection.query("COMMIT")
    committed = true
    return success({
      blocked: blocked.detail,
      acquisitionAttempts: acquisitionAttempts.detail,
      mutations: mutations.detail,
      outcomes: outcomeChecks.map((check) => check.detail),
      primaryIdentity: "DECLARED_PRIMARY",
      successor: {
        acquiredAt: iso(secondReceipt.acquiredAt),
        predecessorCompletedAt: iso(outcomesResult.rows[0].terminalAt),
      },
    })
  } catch (error) {
    return failure(error?.code ?? "V1_2_LIVE_DATABASE_WALL")
  } finally {
    if (connection && !committed) {
      try {
        await connection.query("ROLLBACK")
      } catch {
        // Preserve the primary read or verification failure.
      }
    }
    await connection?.close()
  }
}

export function verifyMergedPullRequests(outcomes, runner = run, liveOutcomes = []) {
  const verified = []
  for (const outcome of outcomes) {
    const expected = outcome.merge
    const response = runner("gh", [
      "pr",
      "view",
      String(expected.prNumber),
      "--repo",
      expected.repository,
      "--json",
      "number,state,url,headRefOid,mergeCommit,files",
    ])
    if (!response.ok) return failure("GITHUB_PR_PROBE_FAILED", `#${expected.prNumber}`)
    let actual
    try {
      actual = JSON.parse(response.stdout)
    } catch {
      return failure("GITHUB_PR_RESPONSE_INVALID", `#${expected.prNumber}`)
    }
    if (actual.number !== expected.prNumber
      || actual.state !== "MERGED"
      || actual.headRefOid !== expected.headSha
      || actual.mergeCommit?.oid !== expected.mergeSha) {
      return failure("GITHUB_PR_EXACT_HEAD_MISMATCH", `#${expected.prNumber}`)
    }
    const actualFiles = (actual.files ?? []).map((entry) => entry.path).sort()
    const live = liveOutcomes.find((entry) => entry.outcomeId === outcome.outcomeId)
    if (!live
      || live.mergeSha !== expected.mergeSha
      || live.prNumber !== expected.prNumber
      || live.productFiles.length === 0
      || !live.productFiles.every((file) => actualFiles.includes(file))
      || !actualFiles.some(isUsefulProductFile)) {
      return failure("GITHUB_PRODUCT_FILE_TRACEABILITY_WALL", `#${expected.prNumber}`)
    }
    verified.push({
      filesDigest: sha256(actualFiles),
      mergeSha: expected.mergeSha,
      number: expected.prNumber,
      repository: expected.repository,
      url: actual.url,
    })
  }
  return success(verified)
}

function validOpaqueCookie(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= 8192
    && !/[\r\n]/.test(value)
}

function validateExpectedProductionSurfaces(expectedSurfaces) {
  if (!Array.isArray(expectedSurfaces)
    || expectedSurfaces.length !== REQUIRED_SURFACES.length
    || expectedSurfaces.some((entry) => (
      !exactKeys(entry, ["evidenceDigest", "route", "status"])
      || typeof entry.route !== "string"
      || entry.status !== 200
      || !SHA256.test(entry.evidenceDigest ?? "")
    ))) {
    return failure("PRODUCTION_SURFACE_EXPECTATION_INVALID")
  }
  const routes = expectedSurfaces.map((entry) => entry.route).sort()
  return JSON.stringify(routes) === JSON.stringify([...REQUIRED_SURFACES].sort())
    ? success(new Map(expectedSurfaces.map((entry) => [entry.route, entry.evidenceDigest])))
    : failure("PRODUCTION_SURFACE_EXPECTATION_INVALID")
}

async function probeRoute(url, {
  authCookie,
  expectedIdentities = [],
  fetchImpl = fetch,
} = {}) {
  if (!url) return failure("APP_URL_REQUIRED")
  if (!validOpaqueCookie(authCookie)) return failure("PRODUCTION_AUTH_PROOF_REQUIRED")
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/json",
        Cookie: authCookie,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
    const content = response.ok ? await response.text() : ""
    return response.status === 200
      && nonempty(content)
      && expectedIdentities.length === 2
      && expectedIdentities.every((identity) => content.includes(identity))
      ? success({ contentDigest: sha256(content), status: response.status, url })
      : failure("PRODUCTION_ROUTE_UNHEALTHY", `${url}:HTTP_${response.status}`)
  } catch (error) {
    return failure("PRODUCTION_ROUTE_PROBE_FAILED", `${url}:${error?.name ?? "ERROR"}`)
  }
}

export async function probeProduction(appUrl, {
  authCookie,
  clock = () => Date.now(),
  expectedOutcomes = [],
  expectedSurfaces = [],
  fetchImpl = fetch,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const normalized = appUrl?.replace(/\/+$/, "") ?? null
  const health = await probeJson(normalized ? `${normalized}/api/health` : null, {
    clock,
    fetchImpl,
    maxAgeMs,
    timestampField: "timestamp",
  })
  const readiness = await probeJson(normalized ? `${normalized}/api/auth/readiness` : null, {
    clock,
    fetchImpl,
    maxAgeMs,
  })
  const surfaces = {}
  const expectedIdentities = expectedOutcomes.map((outcome) => outcome.workOrderRef)
  for (const route of REQUIRED_SURFACES) {
    surfaces[route] = await probeRoute(
      normalized ? `${normalized}${route}` : null,
      { authCookie, expectedIdentities, fetchImpl },
    )
  }
  const expectedSurfaceSet = validateExpectedProductionSurfaces(expectedSurfaces)
  if (!expectedSurfaceSet.ok) {
    for (const route of REQUIRED_SURFACES) {
      if (surfaces[route]?.ok) {
        Object.assign(surfaces[route], failure(expectedSurfaceSet.code))
      }
    }
  } else {
    const expectedByRoute = expectedSurfaceSet.detail
    for (const route of REQUIRED_SURFACES) {
      if (surfaces[route]?.ok
        && surfaces[route].detail.contentDigest !== expectedByRoute.get(route)) {
        Object.assign(surfaces[route], failure("PRODUCTION_ROUTE_CONTENT_MISMATCH"))
      }
    }
  }
  if (health.ok && health.detail.body.status !== "ok") {
    Object.assign(health, failure("APP_HEALTH_STATUS_NOT_OK"))
  }
  if (readiness.ok && (
    readiness.detail.body.ready !== true
    || readiness.detail.body.authReady !== true
    || readiness.detail.body.signup?.mode !== "closed"
    || readiness.detail.body.signup?.open !== false
  )) {
    Object.assign(readiness, failure("AUTH_READINESS_NOT_READY_OR_SIGNUP_OPEN"))
  }
  const passed = health.ok && readiness.ok && Object.values(surfaces).every((entry) => entry.ok)
  const summary = {
    health: health.ok
      ? { status: health.detail.status, url: health.detail.url }
      : { code: health.code },
    readiness: readiness.ok
      ? {
        authReady: true,
        ready: true,
        signupClosed: true,
        status: readiness.detail.status,
        url: readiness.detail.url,
      }
      : { code: readiness.code },
    surfaces: Object.fromEntries(
      Object.entries(surfaces).map(([route, result]) => [
        route,
        result.ok
          ? { contentDigest: result.detail.contentDigest, status: result.detail.status }
          : { code: result.code },
      ]),
    ),
  }
  return passed
    ? success(summary)
    : failure("PRODUCTION_VERIFICATION_FAILED", summary)
}

function evaluate({
  evidence,
  host,
  liveRecords,
  supervisor,
  agreement,
  github,
  production,
}) {
  const checks = { evidence, host, liveRecords, supervisor, agreement, github, production }
  const passed = Object.values(checks).every((check) => check.ok)
  return {
    acceptanceCriteria: Object.entries(checks).map(([name, check]) => ({
      name,
      status: check.ok ? "PASS" : "FAIL",
      code: check.code,
      detail: check.detail,
    })),
    result: passed
      ? "WILLIAMOS_V1_2_TWO_OUTCOME_ACCEPTANCE_COMPLETE"
      : "WILLIAMOS_V1_2_TWO_OUTCOME_ACCEPTANCE_NOT_PROVEN",
    status: passed ? "PASS" : "FAIL",
  }
}

export function parseArgs(argv, env = process.env) {
  const runtimeRoot = env.WILLIAMOS_HERMES_RUNTIME_ROOT
    ?? path.join(os.homedir(), ".williamos", "hermes-bridge")
  const options = {
    agreement: path.join(runtimeRoot, "evidence", "queue-runtime-agreement.json"),
    appUrl: env.WILLIAMOS_APP_URL ?? null,
    evidence: path.join(runtimeRoot, "evidence", "v1-2-two-outcome.json"),
    maxAgeMs: DEFAULT_MAX_AGE_MS,
    output: null,
    state: path.join(runtimeRoot, "state", "state.json"),
    supervisorState: path.join(runtimeRoot, "state", "supervisor.json"),
    workspace: env.WILLIAMOS_HERMES_WORKSPACE
      ? path.resolve(env.WILLIAMOS_HERMES_WORKSPACE)
      : null,
  }
  const valued = new Set([
    "--agreement",
    "--app-url",
    "--evidence",
    "--max-age-ms",
    "--output",
    "--state",
    "--supervisor-state",
    "--workspace",
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (!valued.has(flag)) throw new Error(`UNKNOWN_ARGUMENT:${flag}`)
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`ARGUMENT_VALUE_REQUIRED:${flag}`)
    index += 1
    if (flag === "--agreement") options.agreement = path.resolve(value)
    else if (flag === "--app-url") options.appUrl = value.replace(/\/+$/, "")
    else if (flag === "--evidence") options.evidence = path.resolve(value)
    else if (flag === "--max-age-ms") options.maxAgeMs = Number(value)
    else if (flag === "--output") options.output = path.resolve(value)
    else if (flag === "--state") options.state = path.resolve(value)
    else if (flag === "--supervisor-state") options.supervisorState = path.resolve(value)
    else if (flag === "--workspace") options.workspace = path.resolve(value)
  }
  if (!Number.isSafeInteger(options.maxAgeMs) || options.maxAgeMs < 1) {
    throw new Error("INVALID_MAX_AGE_MS")
  }
  return options
}

export async function runCampaign(options, dependencies = {}) {
  const clock = dependencies.now ?? (() => Date.now())
  const now = clock()
  const databaseUrl = Object.hasOwn(dependencies, "databaseUrl")
    ? dependencies.databaseUrl
    : process.env.DATABASE_URL
  const repoRoot = dependencies.repoRoot
    ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
  const runner = dependencies.runner ?? run
  const revision = runner("git", ["rev-parse", "HEAD"], { cwd: repoRoot })
  const currentRevision = revision.ok ? revision.stdout.trim() : null
  const evidenceRead = safeJson(options.evidence)
  const evidence = evidenceRead.ok
    ? validateCampaignEvidence(evidenceRead.detail, {
      currentRevision,
      now,
      maxAgeMs: options.maxAgeMs,
    })
    : evidenceRead
  const hostRead = safeJson(options.state)
  const host = hostRead.ok
    ? validateHostState(hostRead.detail, { now, maxAgeMs: options.maxAgeMs })
    : hostRead
  const supervisorRead = safeJson(options.supervisorState)
  const supervisor = supervisorRead.ok
    ? validateSupervisorState(supervisorRead.detail, {
      now,
      maxAgeMs: options.maxAgeMs,
      expectedWorkspace: options.workspace,
      expectedSupervisorPath: options.workspace
        ? path.join(options.workspace, "scripts", "hermes-bridge", "supervisor.ps1")
        : null,
      processProbe: dependencies.processProbe,
    })
    : supervisorRead
  const liveRecords = evidence.ok && host.ok && supervisor.ok
    ? await verifyLiveCampaignRecords({
        claims: evidenceRead.detail,
        databaseUrl,
        query: dependencies.campaignQuery,
        createPool: dependencies.createCampaignPool,
        localState: hostRead.detail,
        supervisorState: supervisorRead.detail,
        rereadLocalState: () => safeJson(options.state).detail,
        now,
      })
    : failure(
        "LIVE_RECORD_VERIFICATION_BLOCKED",
        evidence.ok ? (host.ok ? supervisor.code : host.code) : evidence.code,
      )
  let agreement
  try {
    const producer = dependencies.agreementProducer ?? produceRuntimeAgreement
    const snapshot = await producer({
      statePath: options.state,
      outputPath: options.agreement,
      databaseUrl,
      query: dependencies.agreementQuery,
      createPool: dependencies.createAgreementPool,
      now: clock,
    })
    agreement = validateRuntimeAgreement(snapshot, { now, maxAgeMs: options.maxAgeMs })
  } catch (error) {
    agreement = failure(
      error?.code ?? "QUEUE_RUNTIME_AGREEMENT_PRODUCER_WALL",
      "Queue/runtime/Work Order agreement could not be established.",
    )
  }
  const github = evidence.ok && liveRecords.ok
    ? verifyMergedPullRequests(
        evidenceRead.detail.outcomes,
        runner,
        liveRecords.detail.outcomes,
      )
    : failure("GITHUB_EVIDENCE_BLOCKED", evidence.ok ? liveRecords.code : evidence.code)
  const production = await probeProduction(options.appUrl, {
    authCookie: dependencies.productionAuthCookie
      ?? process.env.WILLIAMOS_PRODUCTION_AUTH_COOKIE,
    clock,
    expectedOutcomes: evidence.ok ? evidenceRead.detail.outcomes : [],
    expectedSurfaces: evidence.ok ? evidenceRead.detail.surfaceAgreement.routes : [],
    fetchImpl: dependencies.fetchImpl,
    maxAgeMs: options.maxAgeMs,
  })
  return {
    schemaVersion: SCHEMA_VERSION,
    campaign: CAMPAIGN,
    parentIssue: PARENT_ISSUE,
    observedAt: new Date(now).toISOString(),
    ...evaluate({
      agreement,
      evidence,
      github,
      host,
      liveRecords,
      production,
      supervisor,
    }),
  }
}

function writeAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    fs.renameSync(temporary, filePath)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 2
    return
  }
  const result = await runCampaign(options)
  if (options.output) writeAtomic(options.output, result)
  process.stdout.write(`${result.status} ${result.result}\n`)
  process.exitCode = result.status === "PASS" ? 0 : 1
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main()
}
