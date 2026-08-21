import { createHash } from "node:crypto"

import { evaluateOutcomePolicy, PROTECTED_SCOPE_LEXEMES } from "./policy.mjs"
import { createHermesDatabasePool } from "./database-pool.mjs"
import {
  canonicalOutcomeQueueCheckpointProof,
  digestOutcomeQueueCheckpointProof,
} from "./outcome-queue-source.mjs"
import { normalizeHermesFindings } from "./state-store.mjs"
import {
  HERMES_WORK_CONTRACT_VERSION,
  resolveHermesWorkContract,
} from "./work-contract.mjs"
import {
  assertPrimaryDecisionPacketSafety,
  assertPrimaryDecisionTextSafety,
  derivePrimaryDecisionRecommendation,
  isVerifiedPrimaryDecisionResponse,
  PRIMARY_DECISION_OWNER_EMAIL,
  PRIMARY_DECISION_TTL_MS,
  primaryDecisionRequestDigest,
} from "./primary-decision-provenance.mjs"
export {
  readPendingRuntimeFindingDecisionRequest,
  recordRuntimeFindingDecision,
} from "./runtime-finding-decision.mjs"

export const OUTCOME_SELECTION_SQL = `
SELECT
  id,
  "userId" AS "userId",
  ref,
  command,
  lane,
  mode,
  risk,
  authority,
  verdict,
  "requiresApproval" AS "requiresApproval",
  "matchedRules" AS "matchedRules",
  status,
  "createdAt" AS "createdAt",
  "updatedAt" AS "updatedAt"
FROM goal
WHERE status = $1
  AND verdict = ANY($2::text[])
  AND lane = ANY($3::text[])
  AND risk = ANY($4::text[])
  AND authority = ANY($5::text[])
  AND command !~* $6
  AND NOT (command ~* $7 AND command ~* $8 AND command !~* $9)
  AND "createdAt" >= $10
  AND NOT EXISTS (
    SELECT 1
    FROM governance_event provider_defer
    WHERE provider_defer."entityType" = 'goal'
      AND provider_defer."entityId"::text = goal.id::text
      AND provider_defer."eventType" = 'HERMES_OUTCOME_PROVIDER_DEFERRED'
      AND (provider_defer.metadata->>'retryAfter')::timestamptz > NOW()
  )
ORDER BY "createdAt" ASC, id ASC
`

export const OUTCOME_SELECTION_PARAMS = Object.freeze([
  "classified",
  Object.freeze(["allow", "requires_approval"]),
  Object.freeze(["docs", "ui", "read_model"]),
  Object.freeze(["low", "R0", "R1"]),
  Object.freeze(["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"]),
  "\\m(terrafusion|terrapilot|property[[:space:]]+workbench|county|pacs|parcel|taxpayer|protected[[:space:]]+data|secret|password|credential|api[ -]?key|access[ -]?token|private[ -]?key|token|cookie|session|paid[[:space:]]+overage|destructive|force[ -]?push|reset[[:space:]]+--hard|issue[[:space:]]*#?357)\\M|#357\\M|\\m(create|publish|cut|push)[[:space:]]+(a[[:space:]]+)?(github[[:space:]]+)?release\\M|\\m(create|publish|push)[[:space:]]+(a[[:space:]]+)?(git[[:space:]]+)?tag\\M|\\mtag[[:space:]]+v?[0-9]",
  "\\mproduction\\M",
  "\\m(deploy|deployment|release|cutover|mutate|mutation|write|change)\\M",
  "\\mbridge[[:space:]]+evidence\\M",
  "1970-01-01T00:00:00.000Z",
])

function normalizeQuery(query) {
  if (typeof query === "function") return query
  if (query && typeof query.query === "function") return query.query.bind(query)
  return null
}

const OWNER_DECISION_CHOICES = new Set(["APPROVE", "DENY"])

function ownerDecisionRequestKey({ outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState }) {
  return [
    "hermes-owner-decision",
    outcomeId,
    workOrderId,
    terminalEventId,
    ownerUserId,
    choice,
    expectedNextState,
  ].join(":")
}

function ownerDecisionTerminalKey({ outcomeId, workOrderId, terminalEventId }) {
  return `hermes-owner-decision-terminal:${outcomeId}:${workOrderId}:${terminalEventId}`
}

function ownerDecisionScope({ outcomeId, workOrderId, terminalEventId, expectedNextState }) {
  return `goal:${outcomeId}|work-order:${workOrderId}|terminal:${terminalEventId}|next-state:${expectedNextState}`
}

function persistedOwnerDecisionPacket(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const packet = {
    blockedAction: value.blockedAction,
    authorityBoundary: value.authorityBoundary,
    minimumChoice: value.minimumChoice,
    approveConsequence: value.approveConsequence,
    denyConsequence: value.denyConsequence,
  }
  if (Object.values(packet).some((entry) => typeof entry !== "string" || entry.trim() === "")
    || packet.minimumChoice !== "APPROVE_OR_DENY") return null
  return assertPrimaryDecisionPacketSafety(packet)
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`
  }
  return JSON.stringify(value)
}

function canonicalPersistedJson(value) {
  if (typeof value !== "string") return null
  try {
    return canonicalJson(JSON.parse(value))
  } catch {
    return null
  }
}

function persistedEvidenceHashMatches(notes, contentHash, canonicalNotes) {
  if (typeof notes !== "string" || typeof contentHash !== "string") return false
  const hashes = [
    createHash("sha256").update(notes).digest("hex"),
    createHash("sha256").update(canonicalNotes).digest("hex"),
  ]
  return hashes.includes(contentHash)
}

function ownerDecisionPacketDigest(packet) {
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex")
}

export async function readPendingPrimaryDecisionRequest({
  query,
  databaseUrl = process.env.DATABASE_URL,
  ownerEmail,
} = {}) {
  if (typeof ownerEmail !== "string" || ownerEmail.trim() === "") {
    throw Object.assign(new Error("Primary owner email is required"), {
      code: "PRIMARY_DECISION_OWNER_INVALID",
    })
  }
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  try {
    const result = await runQuery(
      `WITH candidates AS (
       SELECT g.id AS "outcomeId", g.ref AS "goalRef", g."userId" AS "ownerUserId",
         g.command AS "goalCommand", g.lane AS "goalLane", g.verdict AS "goalVerdict",
         g."requiresApproval" AS "goalRequiresApproval",
         wo.id AS "workOrderId", wo.ref AS "workOrderRef",
         terminal.id AS "terminalEventId",
         terminal."createdAt" AT TIME ZONE current_setting('TimeZone') AS "issuedAt",
          terminal.metadata AS "terminalMetadata", q.id AS "queueItemId",
          q."outcomeKey", q.version AS "queueVersion", q.title AS "queueTitle",
          q.objective AS "queueObjective", q."riskClass", q."authorityLevel",
          q."authoritySubject", q."authorityAction",
          approval.id AS "approvalDecisionId", grant_row.ref AS "authorityGrantRef"
       FROM goal g
       JOIN "user" owner ON owner.id = g."userId" AND lower(owner.email) = lower($1)
       JOIN work_order wo ON wo."userId" = g."userId"
         AND wo.ref = 'WO-HERMES-OUTCOME-' || g.id::text
         AND wo.result = 'OWNER_DECISION_REQUIRED'
       JOIN "outcome_queue_item" q ON q."userId" = g."userId"
         AND q."goalId" = g.id AND q."activeWorkOrderId" = wo.id
       JOIN decision approval ON approval.id = q."approvalDecisionId"
         AND approval."userId" = q."userId" AND approval.status = 'accepted'
         AND approval.authority = 'binding'
         AND upper(trim(approval.decision)) = 'APPROVE'
         AND approval.scope = q."outcomeKey"
       JOIN authority_grant grant_row ON grant_row."userId" = q."userId"
         AND grant_row.ref = q."authorityGrantRef"
         AND grant_row.status = 'active' AND grant_row."revokedAt" IS NULL
         AND (grant_row."expiresAt" IS NULL
           OR grant_row."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp())
         AND grant_row."authorityLevel" = q."authorityLevel"
         AND grant_row."grantedTo" = q."authoritySubject"
         AND grant_row.scope = q."outcomeKey"
         AND NOT EXISTS (
           SELECT 1 FROM unnest(grant_row."blockedActions") blocked(action)
           WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
         )
         AND (cardinality(grant_row."allowedActions") = 0 OR EXISTS (
           SELECT 1 FROM unnest(grant_row."allowedActions") allowed(action)
           WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
         ))
         AND (grant_row."workOrderId" IS NULL
           OR grant_row."workOrderId" = q."activeWorkOrderId")
       JOIN LATERAL (
         SELECT event.id, event."createdAt", event.metadata
         FROM governance_event event
         WHERE event."userId" = g."userId" AND event."entityType" = 'goal'
           AND event."entityId"::text = g.id::text
           AND event."eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY event.id DESC LIMIT 1
       ) terminal ON TRUE
       LEFT JOIN LATERAL (
         SELECT lease.metadata
         FROM governance_event lease
         WHERE lease."userId" = g."userId" AND lease."entityType" = 'work_order'
           AND lease."entityId"::text = wo.id::text
           AND lease."eventType" = 'HERMES_RUNTIME_LEASE'
         ORDER BY lease.id DESC LIMIT 1
       ) latest_lease ON TRUE
       WHERE g.status = 'dismissed' AND wo."linkedDecisionId" IS NULL
         AND terminal.metadata->>'result' = 'OWNER_DECISION_REQUIRED'
         AND q."riskClass" IN ('R0', 'R1')
         AND q."lifecycleState" = 'blocked'
         AND q."approvalState" = 'approved'
         AND q."authorityState" = 'matched'
         AND q."authoritySubject" = 'operator'
         AND q."authorityAction" = 'outcome:execute'
         AND COALESCE(latest_lease.metadata->>'leaseStatus', 'RELEASED') <> 'ACTIVE'
         AND concat_ws(' ', q."outcomeKey", q.title, COALESCE(q.objective, '')) !~*
           '\\m(terrafusion|terrapilot|property[[:space:]]+workbench|county|pacs|parcel|taxpayer|protected[[:space:]]+data|secret|password|credential|api[ -]?key|access[ -]?token|private[[:space:]]+key|paid[[:space:]]+overage|destructive|issue[[:space:]]*#?357)\\M|#357\\M'
       ORDER BY terminal.id ASC
       LIMIT 2
      ) SELECT * FROM candidates`,
      [ownerEmail.trim().toLowerCase()],
    )
    const rows = Array.isArray(result?.rows) ? result.rows : []
    if (rows.length === 0) return null
    if (rows.length !== 1) {
      throw Object.assign(new Error("Primary decision request is ambiguous"), {
        code: "PRIMARY_DECISION_AMBIGUOUS",
      })
    }
    const row = rows[0]
    const decisionPacket = persistedOwnerDecisionPacket(row.terminalMetadata)
    const expectedNextState = row.terminalMetadata?.nextState
    const ids = [row.outcomeId, row.queueItemId, row.workOrderId, row.terminalEventId].map(Number)
    const queueVersion = Number(row.queueVersion)
    const approvalDecisionId = Number(row.approvalDecisionId)
    const issuedAt = normalizedTimestamp(row.issuedAt)
    if (!decisionPacket || ids.some((value) => !Number.isSafeInteger(value) || value <= 0)
      || typeof expectedNextState !== "string"
      || !/^[A-Z][A-Z0-9_]{1,79}$/.test(expectedNextState)
      || !Number.isSafeInteger(queueVersion) || queueVersion < 0
      || !Number.isSafeInteger(approvalDecisionId) || approvalDecisionId <= 0
      || typeof row.authorityGrantRef !== "string" || row.authorityGrantRef.trim() === ""
      || !issuedAt) {
      throw Object.assign(new Error("Primary decision request is malformed"), {
        code: "PRIMARY_DECISION_REQUEST_INVALID",
      })
    }
    requirePrimaryDecisionPolicy(row, decisionPacket)
    const recommendation = derivePrimaryDecisionRecommendation({
      riskClass: row.riskClass,
      decisionPacket,
    })
    return Object.freeze({
      outcomeId: ids[0],
      queueItemId: ids[1],
      workOrderId: ids[2],
      terminalEventId: ids[3],
      ownerUserId: row.ownerUserId,
      goalRef: row.goalRef,
      workOrderRef: row.workOrderRef,
      outcomeKey: row.outcomeKey,
      queueVersion,
      riskClass: row.riskClass,
      authorityLevel: row.authorityLevel,
      authoritySubject: row.authoritySubject,
      authorityAction: row.authorityAction,
      approvalDecisionId,
      authorityGrantRef: row.authorityGrantRef,
      recommendation: recommendation.choice,
      recommendationRationale: recommendation.rationale,
      allowedChoices: Object.freeze(["APPROVE", "DENY"]),
      expectedNextState,
      issuedAt,
      decisionPacket,
      decisionPacketDigest: ownerDecisionPacketDigest(decisionPacket),
    })
  } finally {
    if (pool) await pool.end()
  }
}

function normalizedTimestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""))
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function primaryDecisionPolicyProjection(row, decisionPacket) {
  const protectedLexemes = PROTECTED_SCOPE_LEXEMES
  const protectedSplitVariants = (value) => {
    const tokens = value.trim().split(/\s+/)
    const reconstructed = []
    let changed = false
    for (let start = 0; start < tokens.length;) {
      let combined = ""
      let match = null
      for (let end = start; end < tokens.length; end += 1) {
        if (!/^[A-Za-z0-9]+$/.test(tokens[end])) break
        combined += tokens[end].toLowerCase()
        const protectedMatch = Object.keys(protectedLexemes).find((lexeme) => (
          lexeme.length === combined.length
          && [...lexeme].every((character, index) => (
            character === combined[index]
            || (/[il]/.test(character) && /[il]/.test(combined[index]))
          ))
        ))
        if (end === start || !protectedMatch) continue
        if (protectedMatch === "token" && /^to$/i.test(tokens[start]) && tokens[end] === "Ken") continue
        match = { end, value: protectedLexemes[protectedMatch] }
      }
      if (match) {
        reconstructed.push(match.value)
        start = match.end + 1
        changed = true
      } else {
        reconstructed.push(tokens[start])
        start += 1
      }
    }
    return changed ? [reconstructed.join(" ")] : []
  }
  const safeText = (value) => {
    if (typeof value !== "string") return value
    const text = assertPrimaryDecisionTextSafety(value)
    return text
  }
  const policyComparableText = (value) => {
    const safeValue = safeText(value)
    const canonicalizeAsciiConfusables = (candidate) => candidate.replace(/[A-Za-z]+/g, (word) => {
      const lower = word.toLowerCase()
      const match = Object.keys(protectedLexemes).find((lexeme) => (
        lexeme.length === lower.length
        && [...lexeme].every((character, index) => (
          character === lower[index]
          || (/[il]/.test(character) && /[il]/.test(lower[index]))
        ))
      ))
      return match ? protectedLexemes[match] : word
    })
    const fold = (candidate, one) => candidate.replace(/[01345789@$!|]/g, (character) => ({
      "0": "o", "1": one, "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g",
      "@": "a", "$": "s", "!": "i", "|": "l",
    })[character])
    const variants = new Set([safeValue])
    const pending = [safeValue]
    while (pending.length > 0) {
      const candidate = pending.shift()
      const transformed = [
        canonicalizeAsciiConfusables(candidate),
        fold(candidate, "l"),
        fold(candidate, "i"),
        candidate.replace(/[^A-Za-z\s]/g, ""),
        candidate.replace(/[^A-Za-z]+/g, " "),
        ...protectedSplitVariants(candidate),
      ]
      for (const variant of transformed) {
        if (variants.has(variant)) continue
        variants.add(variant)
        pending.push(variant)
        if (variants.size > 128) {
          throw Object.assign(new Error("Primary decision policy normalization exceeded safe bounds"), {
            code: "PRIMARY_DECISION_REQUEST_INVALID",
          })
        }
      }
    }
    return [...variants]
  }
  const commandFields = [
    row?.outcomeKey,
    row?.goalCommand,
    row?.queueTitle,
    row?.queueObjective,
    ...Object.values(decisionPacket ?? {}),
  ].filter((value) => typeof value === "string").map(safeText)
  return {
    command: [...commandFields, ...commandFields.flatMap(policyComparableText)].join("\n"),
    title: safeText(row?.queueTitle),
    description: safeText(row?.queueObjective),
    lane: safeText(row?.goalLane),
    risk: row?.riskClass,
    authority: safeText(row?.authorityLevel),
    verdict: safeText(row?.goalVerdict),
    requiresApproval: row?.goalRequiresApproval,
  }
}

function requirePrimaryDecisionPolicy(row, decisionPacket) {
  const decision = evaluateOutcomePolicy({
    outcome: primaryDecisionPolicyProjection(row, decisionPacket),
    actor: "bsvalues",
    repository: "bsvalues/terragroq",
    enabled: true,
    standingAuthority: true,
  })
  if (!decision.allowed) {
    throw Object.assign(new Error("Primary decision is outside the bounded bridge policy"), {
      code: "PRIMARY_DECISION_POLICY_WALL",
      reasonCode: decision.reasonCode,
    })
  }
}

function validateOwnerDecisionInput({ outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState }) {
  if (![outcomeId, workOrderId, terminalEventId].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw Object.assign(new Error("owner decision identity is invalid"), { code: "OWNER_DECISION_IDENTITY_INVALID" })
  }
  if (typeof ownerUserId !== "string" || ownerUserId.trim() === "") {
    throw Object.assign(new Error("owner decision user is invalid"), { code: "OWNER_DECISION_USER_INVALID" })
  }
  if (!OWNER_DECISION_CHOICES.has(choice)) {
    throw Object.assign(new Error("owner decision choice is invalid"), { code: "OWNER_DECISION_CHOICE_INVALID" })
  }
  if (typeof expectedNextState !== "string" || !/^[A-Z][A-Z0-9_]{1,79}$/.test(expectedNextState)) {
    throw Object.assign(new Error("owner decision next state is invalid"), { code: "OWNER_DECISION_NEXT_STATE_INVALID" })
  }
}

function ownerDecisionResult(row, requestKey, fallback = {}) {
  const choice = row.choice ?? row.decision ?? fallback.choice
  const status = row.status ?? (choice === "APPROVE" ? "accepted" : "rejected")
  return {
    status,
    choice,
    decisionId: Number(row.decisionId ?? row.id ?? fallback.decisionId),
    decisionRef: row.decisionRef ?? row.ref ?? fallback.decisionRef,
    requestKey: row.requestKey ?? requestKey,
    resumeReleased: status === "accepted" && choice === "APPROVE",
    replayed: fallback.replayed === true,
  }
}

export async function recordOwnerAuthorityDecision({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  queueItemId = null,
  workOrderId,
  terminalEventId,
  ownerUserId,
  choice,
  expectedNextState,
  primaryDecisionProvenance = null,
} = {}) {
  validateOwnerDecisionInput({ outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState })
  if (primaryDecisionProvenance !== null
    && !isVerifiedPrimaryDecisionResponse(primaryDecisionProvenance)) {
    throw Object.assign(new Error("primary decision provenance is invalid"), {
      code: "PRIMARY_DECISION_PROVENANCE_WALL",
    })
  }
  if (primaryDecisionProvenance !== null && primaryDecisionProvenance.choice !== choice) {
    throw Object.assign(new Error("primary decision provenance does not bind this choice"), {
      code: "PRIMARY_DECISION_PROVENANCE_WALL",
    })
  }
  if (primaryDecisionProvenance !== null
    && (!Number.isSafeInteger(queueItemId) || queueItemId <= 0)) {
    throw Object.assign(new Error("primary decision queue identity is invalid"), {
      code: "PRIMARY_DECISION_PROVENANCE_WALL",
    })
  }
  const provenance = primaryDecisionProvenance === null ? null : {
    version: primaryDecisionProvenance.version,
    identityStatus: primaryDecisionProvenance.identityStatus,
    accountEmail: primaryDecisionProvenance.accountEmail,
    choice: primaryDecisionProvenance.choice,
    requestDigest: primaryDecisionProvenance.requestDigest,
    requestSnapshot: primaryDecisionProvenance.requestSnapshot,
    responseDigest: primaryDecisionProvenance.responseDigest,
    issuedAt: primaryDecisionProvenance.issuedAt,
    expiresAt: primaryDecisionProvenance.expiresAt,
  }
  const requestKey = ownerDecisionRequestKey({ outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState })
  const terminalKey = ownerDecisionTerminalKey({ outcomeId, workOrderId, terminalEventId })
  const decisionRef = `OWNER-DECISION-${outcomeId}-${terminalEventId}`
  const scope = ownerDecisionScope({ outcomeId, workOrderId, terminalEventId, expectedNextState })
  const evidenceBase = [
    `outcome:${outcomeId}`,
    `work-order:${workOrderId}`,
    `terminal-event:${terminalEventId}`,
    `next-state:${expectedNextState}`,
    `request:${requestKey}`,
    `terminal-binding:${terminalKey}`,
    `choice:${choice}`,
    ...(provenance ? [
      `primary-request:${provenance.requestDigest}`,
      `primary-response:${provenance.responseDigest}`,
    ] : []),
  ]
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [terminalKey])
    const binding = await runQuery(
       `WITH goal_any AS (
         SELECT id, "userId" AS "goalUserId", status, ref, command,
           lane, verdict, "requiresApproval"
         FROM goal WHERE id = $1::integer
         FOR UPDATE
       ), work_order_any AS (
         SELECT id, "userId" AS "workOrderUserId", ref, status,
           "linkedDecisionId"
         FROM work_order
         WHERE id = $2::integer AND ref = 'WO-HERMES-OUTCOME-' || $1::text
         FOR UPDATE
        ), latest_terminal AS (
          SELECT id, "userId" AS "terminalUserId", metadata
          FROM governance_event
          WHERE "entityType" = 'goal' AND "entityId"::text = $1::text
            AND "userId" = $4
            AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY id DESC
         LIMIT 1
       ), requested_terminal AS (
         SELECT id, "userId" AS "requestedTerminalUserId", metadata
          FROM governance_event
          WHERE id = $3::integer AND "entityType" = 'goal'
            AND "entityId"::text = $1::text
            AND "userId" = $4
            AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
       ), latest_lease AS (
         SELECT metadata
          FROM governance_event
          WHERE "entityType" = 'work_order' AND "entityId"::text = $2::text
            AND "userId" = $4
            AND "eventType" = 'HERMES_RUNTIME_LEASE'
         ORDER BY id DESC
         LIMIT 1
       ), queue_item AS (
          SELECT id, "outcomeKey", version AS "queueVersion", title, objective, "riskClass", "approvalState",
           "approvalDecisionId", "authorityState", "authorityGrantRef",
           "authorityLevel", "authoritySubject", "authorityAction", "lifecycleState",
           "activeWorkOrderId"
         FROM outcome_queue_item
         WHERE "userId" = $4 AND "goalId" = $1::integer
           AND ($7::integer IS NULL OR id = $7::integer)
           AND "activeWorkOrderId" = $2::integer
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE
       ), live_approval AS (
         SELECT approval.id
         FROM decision approval
         JOIN queue_item q ON approval.id = q."approvalDecisionId"
         WHERE approval."userId" = $4 AND approval.status = 'accepted'
           AND approval.authority = 'binding'
           AND upper(trim(approval.decision)) = 'APPROVE'
           AND approval.scope = q."outcomeKey"
         FOR SHARE
       ), live_grant AS (
          SELECT grant_row.id, grant_row.ref
         FROM authority_grant grant_row
         JOIN queue_item q ON grant_row."ref" = q."authorityGrantRef"
         WHERE grant_row."userId" = $4 AND grant_row.status = 'active'
           AND grant_row."revokedAt" IS NULL
           AND (grant_row."expiresAt" IS NULL
             OR grant_row."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp())
           AND grant_row."authorityLevel" = q."authorityLevel"
           AND grant_row."grantedTo" = q."authoritySubject"
           AND grant_row.scope = q."outcomeKey"
           AND NOT EXISTS (
             SELECT 1 FROM unnest(grant_row."blockedActions") blocked(action)
             WHERE position(lower(blocked.action) IN lower(q."authorityAction")) > 0
           )
           AND (cardinality(grant_row."allowedActions") = 0 OR EXISTS (
             SELECT 1 FROM unnest(grant_row."allowedActions") allowed(action)
             WHERE position(lower(allowed.action) IN lower(q."authorityAction")) > 0
           ))
           AND (grant_row."workOrderId" IS NULL
             OR grant_row."workOrderId" = q."activeWorkOrderId")
         FOR SHARE
       ), prior_request AS (
         SELECT id AS "decisionId", ref AS "decisionRef", status, decision,
           authority, scope, evidence, "decidedAt"
         FROM decision
         WHERE "userId" = $4 AND evidence @> ARRAY[$5]::text[]
         ORDER BY id DESC
         LIMIT 1
        ), consumed_binding AS (
          SELECT id AS "consumedDecisionId", ref AS "consumedDecisionRef", status AS "consumedStatus",
            decision AS "consumedChoice", authority AS "consumedAuthority", evidence AS "consumedEvidence"
          FROM decision
          WHERE "userId" = $4 AND evidence @> ARRAY[$6]::text[]
          ORDER BY id DESC
          LIMIT 1
        ), linked_work_order_decision AS (
          SELECT d.id AS "linkedDecisionId", d."userId" AS "linkedDecisionUserId",
            d.evidence AS "linkedDecisionEvidence"
          FROM work_order_any wo
          JOIN decision d ON d.id = wo."linkedDecisionId"
        )
       SELECT clock_timestamp() AS "transactionNow",
         goal_any.id AS "goalId", goal_any."goalUserId", goal_any.status AS "goalStatus",
         goal_any.ref AS "goalRef", goal_any.command AS "goalCommand",
         goal_any.lane AS "goalLane", goal_any.verdict AS "goalVerdict",
         goal_any."requiresApproval" AS "goalRequiresApproval",
         work_order_any.id AS "workOrderId",
         work_order_any."workOrderUserId", work_order_any.ref AS "workOrderRef",
         work_order_any.status AS "workOrderStatus",
         work_order_any."linkedDecisionId" AS "workOrderLinkedDecisionId",
         latest_terminal.id AS "latestTerminalId",
         latest_terminal."terminalUserId", latest_terminal.metadata AS "latestTerminalMetadata",
         requested_terminal.id AS "requestedTerminalId", requested_terminal."requestedTerminalUserId",
         requested_terminal.metadata AS "requestedTerminalMetadata",
         latest_lease.metadata AS "latestLeaseMetadata",
          queue_item.id AS "queueItemId", queue_item.title AS "queueTitle",
          queue_item."outcomeKey", queue_item."queueVersion",
          queue_item.objective AS "queueObjective", queue_item."riskClass",
          queue_item."approvalState", queue_item."authorityState", queue_item."authorityLevel",
          queue_item."authoritySubject", queue_item."authorityAction",
          queue_item."approvalDecisionId", queue_item."authorityGrantRef",
          queue_item."lifecycleState", queue_item."activeWorkOrderId",
          live_approval.id AS "liveApprovalId", live_grant.id AS "liveGrantId",
          live_grant.ref AS "liveGrantRef",
         prior_request."decisionId", prior_request."decisionRef", prior_request.status AS "priorStatus",
         prior_request.decision AS "priorChoice", prior_request.authority AS "priorAuthority",
         prior_request.scope AS "priorScope", prior_request.evidence AS "priorEvidence",
         prior_request."decidedAt" AT TIME ZONE 'UTC' AS "priorDecidedAt",
         consumed_binding."consumedDecisionId", consumed_binding."consumedDecisionRef",
          consumed_binding."consumedStatus", consumed_binding."consumedChoice",
          consumed_binding."consumedAuthority",
          linked_work_order_decision."linkedDecisionUserId",
          linked_work_order_decision."linkedDecisionEvidence"
       FROM goal_any
       FULL OUTER JOIN work_order_any ON TRUE
       LEFT JOIN latest_terminal ON TRUE
       LEFT JOIN requested_terminal ON TRUE
        LEFT JOIN latest_lease ON TRUE
        LEFT JOIN queue_item ON TRUE
        LEFT JOIN live_approval ON TRUE
        LEFT JOIN live_grant ON TRUE
        LEFT JOIN prior_request ON TRUE
        LEFT JOIN consumed_binding ON TRUE
        LEFT JOIN linked_work_order_decision ON TRUE`,
      [outcomeId, workOrderId, terminalEventId, ownerUserId, requestKey, terminalKey, queueItemId],
    )
    const row = binding?.rows?.[0] ?? {}
    if (row.goalUserId != null && row.goalUserId !== ownerUserId
      || row.workOrderUserId != null && row.workOrderUserId !== ownerUserId
      || row.terminalUserId != null && row.terminalUserId !== ownerUserId
      || row.requestedTerminalUserId != null && row.requestedTerminalUserId !== ownerUserId) {
      throw Object.assign(new Error("owner decision is outside the current-user scope"), {
        code: "OWNER_DECISION_UNAUTHORIZED",
      })
    }
    if (row.decisionId == null && row.consumedDecisionId != null) {
      throw Object.assign(new Error("owner decision terminal has a conflicting binding"), {
        code: "OWNER_DECISION_CONFLICT",
      })
    }
    if (row.goalId == null || row.workOrderId == null || row.requestedTerminalId == null
      || Number(row.latestTerminalId) !== terminalEventId
      || row.latestTerminalMetadata?.result !== "OWNER_DECISION_REQUIRED"
      || row.latestTerminalMetadata?.nextState !== expectedNextState
      || row.requestedTerminalMetadata?.result !== "OWNER_DECISION_REQUIRED"
      || row.requestedTerminalMetadata?.nextState !== expectedNextState
      || (
        row.decisionId == null
          ? row.goalStatus !== "dismissed"
          : row.priorChoice === "APPROVE"
            ? row.goalStatus !== "classified"
            : row.goalStatus !== "dismissed"
      )) {
      throw Object.assign(new Error("owner decision does not match the latest terminal wall"), {
        code: "OWNER_DECISION_STALE",
      })
    }
    if (row.decisionId == null && row.latestLeaseMetadata?.leaseStatus === "ACTIVE") {
      throw Object.assign(new Error("owner decision cannot consume an active lease"), {
        code: "OWNER_DECISION_ACTIVE_LEASE",
      })
    }

    const decisionPacket = persistedOwnerDecisionPacket(row.latestTerminalMetadata)
    const requestedDecisionPacket = persistedOwnerDecisionPacket(row.requestedTerminalMetadata)
    if (!decisionPacket || canonicalJson(requestedDecisionPacket) !== canonicalJson(decisionPacket)) {
      throw Object.assign(new Error("owner decision terminal packet is missing or conflicting"), {
        code: "OWNER_DECISION_STALE",
      })
    }
    const requestSnapshot = provenance?.requestSnapshot
    const currentRecommendation = provenance ? derivePrimaryDecisionRecommendation({
      riskClass: row.riskClass,
      decisionPacket,
    }) : null
    if (provenance && (provenance.version !== 2 || !requestSnapshot
      || row.queueItemId == null
      || row.liveApprovalId == null
      || row.liveGrantId == null
      || row.outcomeKey !== requestSnapshot.outcomeKey
      || Number(row.queueVersion) !== requestSnapshot.queueVersion
      || row.riskClass !== requestSnapshot.riskClass
      || row.authorityLevel !== requestSnapshot.authorityLevel
      || row.authoritySubject !== requestSnapshot.authoritySubject
      || row.authorityAction !== requestSnapshot.authorityAction
      || Number(row.approvalDecisionId) !== requestSnapshot.approvalDecisionId
      || Number(row.liveApprovalId) !== requestSnapshot.approvalDecisionId
      || row.authorityGrantRef !== requestSnapshot.authorityGrantRef
      || row.liveGrantRef !== requestSnapshot.authorityGrantRef
      || requestSnapshot.recommendation !== currentRecommendation.choice
      || requestSnapshot.recommendationRationale !== currentRecommendation.rationale
      || JSON.stringify(requestSnapshot.allowedChoices) !== JSON.stringify(["APPROVE", "DENY"])
      || Number(row.activeWorkOrderId) !== workOrderId
      || row.lifecycleState !== "blocked"
      || row.approvalState !== "approved"
      || row.authorityState !== "matched"
      || row.authoritySubject !== "operator"
      || row.authorityAction !== "outcome:execute"
      || !["R0", "R1"].includes(row.riskClass))) {
      throw Object.assign(new Error("Primary decision queue authority changed before recording"), {
        code: "PRIMARY_DECISION_AUTHORITY_STALE",
      })
    }
    if (provenance && (!Number.isFinite(Date.parse(provenance.expiresAt))
      || !Number.isFinite(Date.parse(row.transactionNow))
      || Date.parse(row.transactionNow) > Date.parse(provenance.expiresAt))) {
      throw Object.assign(new Error("Primary decision response expired before recording"), {
        code: "PRIMARY_DECISION_EXPIRED",
      })
    }
    if (provenance) requirePrimaryDecisionPolicy(row, decisionPacket)
    const decisionPacketDigest = ownerDecisionPacketDigest(decisionPacket)
    if (provenance && provenance.requestDigest !== primaryDecisionRequestDigest({
      outcomeId,
      queueItemId,
      workOrderId,
       terminalEventId,
       expectedNextState,
       decisionPacketDigest,
       ...requestSnapshot,
     })) {
      throw Object.assign(new Error("primary decision provenance does not bind this request"), {
        code: "PRIMARY_DECISION_PROVENANCE_WALL",
      })
    }
    const evidence = [...evidenceBase, `decision-packet:${decisionPacketDigest}`]
    const status = choice === "APPROVE" ? "accepted" : "rejected"
    if (row.decisionId != null) {
      const prior = ownerDecisionResult({
        decisionId: row.decisionId, decisionRef: row.decisionRef, status: row.priorStatus,
        choice: row.priorChoice,
      }, requestKey, { choice, decisionRef })
      if (prior.choice !== choice || prior.decisionRef !== decisionRef
        || prior.status !== status || row.priorAuthority !== "binding"
        || row.priorScope !== scope
        || JSON.stringify(row.priorEvidence) !== JSON.stringify(evidence)) {
        throw Object.assign(new Error("owner decision replay conflicts with persisted binding"), {
          code: "OWNER_DECISION_CONFLICT",
        })
      }
      const priorPayload = {
        outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState,
        decisionId: prior.decisionId, decisionRef, requestKey, decisionPacket, decisionPacketDigest,
        ...(provenance ? { queueItemId } : {}),
        ...(provenance ? { primaryDecisionProvenance: provenance } : {}),
      }
      const priorNotes = canonicalJson(priorPayload)
      const priorEvidenceHash = createHash("sha256").update(priorNotes).digest("hex")
      const priorReceipt = await runQuery(
        `SELECT ev.id AS "evidenceId", ev.notes, ev."contentHash",
           receipt.metadata AS "receiptMetadata", audit.metadata AS "auditMetadata"
         FROM work_order wo
         JOIN evidence_record ev ON ev."userId" = $1
           AND ev.ref = $2 AND ev."workOrderId" = wo.id AND ev.result = $3
         JOIN governance_event receipt ON receipt."userId" = $1
           AND receipt."eventType" = 'HERMES_OWNER_AUTHORITY_DECISION'
           AND receipt."entityType" = 'goal' AND receipt."entityId"::text = $4::text
           AND receipt."evidenceId" = ev.id
         JOIN event_log audit ON audit."userId" = $1
           AND audit.type = 'owner.decision.recorded'
           AND audit.register = 'goals' AND audit."refId" = $4::integer
         WHERE wo.id = $5::integer AND wo."userId" = $1
           AND wo."linkedDecisionId" = $6::integer`,
        [
          ownerUserId,
          `EV-OWNER-DECISION-${outcomeId}-${terminalEventId}`,
          choice === "APPROVE" ? "PASS" : "FAIL",
          outcomeId,
          workOrderId,
          prior.decisionId,
        ],
      )
      const receiptRow = priorReceipt?.rows?.length === 1 ? priorReceipt.rows[0] : null
      const expectedAudit = {
        ...priorPayload, status, authority: "binding", evidenceId: receiptRow?.evidenceId ?? null,
        recordedAt: normalizedTimestamp(row.priorDecidedAt),
      }
      if (!receiptRow || canonicalPersistedJson(receiptRow.notes) !== priorNotes
        || receiptRow.contentHash !== priorEvidenceHash
        || canonicalJson(receiptRow.receiptMetadata) !== canonicalJson(expectedAudit)
        || canonicalJson(receiptRow.auditMetadata) !== canonicalJson(expectedAudit)) {
        throw Object.assign(new Error("owner decision replay receipt is incomplete or conflicting"), {
          code: "OWNER_DECISION_CONFLICT",
        })
      }
      await runQuery("COMMIT")
      return { ...prior, replayed: true }
    }
    if (row.consumedDecisionId != null) {
      throw Object.assign(new Error("owner decision terminal has a conflicting binding"), {
        code: "OWNER_DECISION_CONFLICT",
      })
    }
    if (row.workOrderLinkedDecisionId != null) {
      const linkedEvidence = Array.isArray(row.linkedDecisionEvidence)
        ? row.linkedDecisionEvidence
        : []
      const priorTerminalPrefix =
        `terminal-binding:hermes-owner-decision-terminal:${outcomeId}:${workOrderId}:`
      if (row.linkedDecisionUserId !== ownerUserId
        || !linkedEvidence.includes(`work-order:${workOrderId}`)
        || !linkedEvidence.some((entry) =>
          typeof entry === "string" && entry.startsWith(priorTerminalPrefix))
        || linkedEvidence.includes(`terminal-binding:${terminalKey}`)) {
        throw Object.assign(new Error("owner decision Work Order already has a conflicting binding"), {
          code: "OWNER_DECISION_CONFLICT",
        })
      }
    }

    const recorded = await runQuery(
      `WITH write_clock AS (
         SELECT clock_timestamp() AS recorded_at
       )
       INSERT INTO decision
         ("userId", ref, title, context, decision, rationale, status, authority, owner, scope, evidence, tags, "decidedAt")
       SELECT $1, $2, $3, $4, $5, $6, $7, 'binding', $1, $8, $9::text[], $10::text[],
         timezone('UTC', write_clock.recorded_at)
       FROM write_clock
       WHERE $11::timestamptz IS NULL OR (
         write_clock.recorded_at <= $11::timestamptz
         AND EXISTS (
           SELECT 1 FROM authority_grant grant_row
           WHERE grant_row.id = $12::integer
             AND grant_row.status = 'active' AND grant_row."revokedAt" IS NULL
             AND (grant_row."expiresAt" IS NULL
               OR grant_row."expiresAt" AT TIME ZONE 'UTC' > write_clock.recorded_at)
         )
       )
       RETURNING id, ref, status, decision,
         "decidedAt" AT TIME ZONE 'UTC' AS "decidedAt"`,
      [
        ownerUserId,
        decisionRef,
        `Owner authority decision for ${terminalKey}`,
        JSON.stringify({
          outcomeId, workOrderId, terminalEventId, expectedNextState, requestKey,
          ...(provenance ? { queueItemId } : {}),
          decisionPacket, decisionPacketDigest,
        }),
        choice,
        choice === "APPROVE" ? "Owner approved the exact persisted terminal scope." : "Owner denied the exact persisted terminal scope.",
        status,
        scope,
        evidence,
        ["HERMES_OWNER_AUTHORITY_DECISION", choice],
        provenance?.expiresAt ?? null,
        provenance ? row.liveGrantId : null,
      ],
    )
    const decisionRow = recorded?.rows?.[0]
    if (!decisionRow?.id) {
      throw Object.assign(new Error("owner decision record was not created"), { code: "OWNER_DECISION_RECORD_WALL" })
    }
    if (choice === "APPROVE") {
      const reclassified = await runQuery(
        `UPDATE goal SET status = 'classified', "updatedAt" = NOW()
         WHERE id = $1::integer AND "userId" = $2 AND status = 'dismissed'
         RETURNING id`,
        [outcomeId, ownerUserId],
      )
      if ((reclassified?.rows?.length ?? reclassified?.rowCount ?? 0) !== 1) {
        throw Object.assign(new Error("approved owner decision could not release the goal"), {
          code: "OWNER_DECISION_RESUME_WALL",
        })
      }
    }
    const evidencePayload = {
      outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState,
      decisionId: decisionRow.id, decisionRef, requestKey, decisionPacket, decisionPacketDigest,
      ...(provenance ? { queueItemId } : {}),
      ...(provenance ? { primaryDecisionProvenance: provenance } : {}),
    }
    const evidenceInserted = await runQuery(
      `INSERT INTO evidence_record
         ("userId", ref, "workOrderId", result, repo, notes, "contentHash")
       VALUES ($1, $2, $3, $4, 'bsvalues/terragroq', $5, $6)
       RETURNING id`,
      [
        ownerUserId,
        `EV-OWNER-DECISION-${outcomeId}-${terminalEventId}`,
        workOrderId,
        choice === "APPROVE" ? "PASS" : "FAIL",
        canonicalJson(evidencePayload),
        createHash("sha256").update(canonicalJson(evidencePayload)).digest("hex"),
      ],
    )
    const evidenceId = evidenceInserted?.rows?.[0]?.id ?? null
    if (!Number.isSafeInteger(Number(evidenceId))) {
      throw Object.assign(new Error("owner decision evidence record was not created"), {
        code: "OWNER_DECISION_EVIDENCE_WALL",
      })
    }
    const linked = await runQuery(
      `UPDATE work_order
       SET "linkedDecisionId" = $2, result = $5, "updatedAt" = NOW()
       WHERE id = $1::integer AND "userId" = $3
         AND "linkedDecisionId" IS NOT DISTINCT FROM $4::integer
         AND result IN ('OWNER_DECISION_REQUIRED', 'PARTIAL')
         AND EXISTS (
           SELECT 1
           FROM governance_event terminal
           WHERE terminal.id = $6::integer
             AND terminal."userId" = $3
             AND terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
             AND terminal."entityType" = 'goal'
             AND terminal."entityId"::text = $7::text
             AND terminal.metadata->>'result' = 'OWNER_DECISION_REQUIRED'
             AND terminal.metadata->>'nextState' = $8
             AND NOT EXISTS (
               SELECT 1
               FROM governance_event newer_terminal
               WHERE newer_terminal."userId" = $3
                 AND newer_terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
                 AND newer_terminal."entityType" = 'goal'
                 AND newer_terminal."entityId"::text = $7::text
                 AND newer_terminal.id > terminal.id
             )
         )
       RETURNING id`,
      [
        workOrderId,
        decisionRow.id,
        ownerUserId,
        row.workOrderLinkedDecisionId ?? null,
        choice === "APPROVE" ? "OWNER_DECISION_APPROVED" : "OWNER_DECISION_DENIED",
        terminalEventId,
        outcomeId,
        expectedNextState,
      ],
    )
    if ((linked?.rows?.length ?? linked?.rowCount ?? 0) !== 1) {
      throw Object.assign(new Error("owner decision Work Order link was not persisted"), {
        code: "OWNER_DECISION_LINK_WALL",
      })
    }
    const auditMetadata = JSON.stringify({
      ...evidencePayload, status, authority: "binding", evidenceId,
      recordedAt: normalizedTimestamp(decisionRow.decidedAt),
    })
    await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, "evidenceId", metadata)
       VALUES ($1, 'HERMES_OWNER_AUTHORITY_DECISION', 'goal', $2,
         $1, $3, $4, $5::jsonb)`,
      [ownerUserId, String(outcomeId), `Recorded ${choice} owner authority decision`, evidenceId, auditMetadata],
    )
    await runQuery(
      `INSERT INTO event_log ("userId", type, summary, register, "refId", metadata)
       VALUES ($1, 'owner.decision.recorded', $2, 'goals', $3, $4::jsonb)`,
      [ownerUserId, `${decisionRef}: ${choice} for ${terminalKey}`, outcomeId, auditMetadata],
    )
    await runQuery("COMMIT")
    return ownerDecisionResult({
      decisionId: decisionRow.id, decisionRef: decisionRow.ref ?? decisionRef,
      status: decisionRow.status ?? status, choice: decisionRow.decision ?? choice,
    }, requestKey, { choice, decisionRef })
  } catch (error) {
    try { await runQuery("ROLLBACK") } catch {}
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export async function readApprovedOwnerDecision({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  workOrderId = null,
  terminalEventId = null,
  ownerUserId,
  expectedNextState,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || (workOrderId !== null && (!Number.isSafeInteger(workOrderId) || workOrderId <= 0))
    || (terminalEventId !== null && (!Number.isSafeInteger(terminalEventId) || terminalEventId <= 0))
    || typeof ownerUserId !== "string" || ownerUserId.trim() === ""
    || typeof expectedNextState !== "string"
    || !/^[A-Z][A-Z0-9_]{1,79}$/.test(expectedNextState)) return null
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  try {
    const result = await runQuery(
      `WITH latest_terminal AS (
       SELECT id, metadata, "createdAt"
         , "userId" AS "terminalUserId"
       FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = $1::text
           AND "userId" = $4
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY id DESC
         LIMIT 1
       ), candidate_work_order AS (
         SELECT id, ref, "userId", "linkedDecisionId"
         FROM work_order
         WHERE "userId" = $4 AND ref = $6
           AND (($2::integer IS NOT NULL AND id = $2::integer)
             OR ($2::integer IS NULL))
       )
       SELECT d.id AS "decisionId", d.ref AS "decisionRef", d.status,
         d.decision AS choice, d.authority, d.scope, d.evidence,
         d."decidedAt" AT TIME ZONE 'UTC' AS "decidedAt",
         g.id AS "outcomeId", wo.id AS "workOrderId",
         terminal.id AS "terminalEventId", terminal.metadata AS "terminalMetadata",
         terminal."createdAt" AT TIME ZONE current_setting('TimeZone') AS "terminalIssuedAt",
         receipt.id AS "receiptEventId", ev.id AS "evidenceRecordId",
         ev.notes AS "evidenceNotes", ev."contentHash" AS "evidenceContentHash",
         receipt.metadata AS "receiptMetadata",
         audit.id AS "auditEventId", audit.metadata AS "auditMetadata"
       FROM decision d
       JOIN goal g ON g.id = $1::integer AND g."userId" = $4 AND g.status = 'classified'
       JOIN candidate_work_order wo ON wo."userId" = g."userId"
         AND wo."linkedDecisionId" = d.id
       JOIN latest_terminal terminal ON terminal.id = COALESCE($3::integer, terminal.id)
         AND terminal."terminalUserId" = $4
         AND terminal.metadata->>'result' = 'OWNER_DECISION_REQUIRED'
         AND terminal.metadata->>'nextState' = $5
       JOIN evidence_record ev ON ev."userId" = $4
         AND ev.ref = 'EV-OWNER-DECISION-' || $1::text || '-' || terminal.id::text
         AND ev."workOrderId" = wo.id AND ev.result = 'PASS'
         AND ev."contentHash" ~ '^[a-f0-9]{64}$'
       JOIN governance_event receipt ON receipt."userId" = $4
         AND receipt."eventType" = 'HERMES_OWNER_AUTHORITY_DECISION'
         AND receipt."entityType" = 'goal' AND receipt."entityId"::text = $1::text
         AND receipt."evidenceId" = ev.id
         AND receipt.metadata->>'decisionId' = d.id::text
         AND receipt.metadata->>'terminalEventId' = terminal.id::text
       JOIN event_log audit ON audit."userId" = $4
         AND audit.type = 'owner.decision.recorded'
         AND audit.register = 'goals' AND audit."refId" = $1::integer
         AND audit.metadata->>'decisionId' = d.id::text
         AND audit.metadata->>'evidenceId' = ev.id::text
       WHERE d."userId" = $4 AND d.status = 'accepted' AND d.authority = 'binding'
         AND d.decision = 'APPROVE'
         AND d.ref = 'OWNER-DECISION-' || $1::text || '-' || terminal.id::text
         AND d.scope = 'goal:' || $1::text || '|work-order:' || wo.id::text
           || '|terminal:' || terminal.id::text || '|next-state:' || $5
         AND d.evidence @> ARRAY[
           'outcome:' || $1::text,
           'work-order:' || wo.id::text,
           'terminal-event:' || terminal.id::text,
           'next-state:' || $5,
           'choice:APPROVE'
         ]::text[]
         AND d.evidence @> ARRAY[
           'request:hermes-owner-decision:' || $1::text || ':' || wo.id::text
             || ':' || terminal.id::text || ':' || $4 || ':APPROVE:' || $5
         ]::text[]`,
      [
        outcomeId,
        workOrderId,
        terminalEventId,
        ownerUserId,
        expectedNextState,
        `WO-HERMES-OUTCOME-${outcomeId}`,
      ],
    )
    const rows = Array.isArray(result?.rows) ? result.rows : []
    const row = rows.length === 1 ? rows[0] : null
    const resolvedWorkOrderId = Number(row?.workOrderId ?? workOrderId)
    const resolvedTerminalEventId = Number(row?.terminalEventId ?? terminalEventId)
    const decisionPacket = persistedOwnerDecisionPacket(row?.terminalMetadata)
    const decisionPacketDigest = decisionPacket ? ownerDecisionPacketDigest(decisionPacket) : null
    const requestKey = decisionPacket ? ownerDecisionRequestKey({
      outcomeId,
      workOrderId: resolvedWorkOrderId,
      terminalEventId: resolvedTerminalEventId,
      ownerUserId,
      choice: "APPROVE",
      expectedNextState,
    }) : null
    let storedPayload = null
    try {
      storedPayload = JSON.parse(row?.evidenceNotes ?? "null")
    } catch {}
    const storedProvenance = storedPayload?.primaryDecisionProvenance
    const hasStoredProvenance = storedPayload !== null
      && Object.hasOwn(storedPayload, "primaryDecisionProvenance")
    let storedRecommendation = null
    if (hasStoredProvenance) {
      try {
        storedRecommendation = derivePrimaryDecisionRecommendation({
          riskClass: storedProvenance?.requestSnapshot?.riskClass,
          decisionPacket,
        })
      } catch {}
    }
    let expectedRequestDigest = null
    if (decisionPacketDigest && hasStoredProvenance) {
      try {
        expectedRequestDigest = primaryDecisionRequestDigest({
          outcomeId,
          queueItemId: Number(storedPayload?.queueItemId),
          workOrderId: resolvedWorkOrderId,
          terminalEventId: resolvedTerminalEventId,
          expectedNextState,
          decisionPacketDigest,
          ...storedProvenance?.requestSnapshot,
        })
      } catch {}
    }
    const validStoredProvenance = hasStoredProvenance
      && Number.isSafeInteger(Number(storedPayload?.queueItemId))
      && Number(storedPayload.queueItemId) > 0
      && storedProvenance?.version === 2
      && storedRecommendation !== null
      && storedProvenance?.requestSnapshot?.recommendation === storedRecommendation.choice
      && storedProvenance?.requestSnapshot?.recommendationRationale === storedRecommendation.rationale
      && storedProvenance?.identityStatus === "VERIFIED_PRIMARY_CODEX_APP_SERVER"
      && storedProvenance?.accountEmail === PRIMARY_DECISION_OWNER_EMAIL
      && storedProvenance?.choice === row.choice
      && storedProvenance?.requestDigest === expectedRequestDigest
      && typeof storedProvenance?.responseDigest === "string"
      && /^[a-f0-9]{64}$/.test(storedProvenance.responseDigest)
      && Number.isFinite(Date.parse(storedProvenance.issuedAt))
      && Date.parse(storedProvenance.issuedAt) >= Date.parse(row?.terminalIssuedAt)
      && Date.parse(storedProvenance.issuedAt) <= Date.parse(row?.decidedAt)
      && Number.isFinite(Date.parse(storedProvenance.expiresAt))
      && Date.parse(storedProvenance.expiresAt) - Date.parse(storedProvenance.issuedAt) === PRIMARY_DECISION_TTL_MS
      && Date.parse(row?.decidedAt) <= Date.parse(storedProvenance.expiresAt)
    const provenance = validStoredProvenance ? {
      version: storedProvenance.version,
      identityStatus: storedProvenance.identityStatus,
      accountEmail: storedProvenance.accountEmail,
      choice: storedProvenance.choice,
      requestDigest: storedProvenance.requestDigest,
      requestSnapshot: storedProvenance.requestSnapshot,
      responseDigest: storedProvenance.responseDigest,
      issuedAt: storedProvenance.issuedAt,
      expiresAt: storedProvenance.expiresAt,
    } : null
    const expectedEvidence = decisionPacketDigest && (!hasStoredProvenance || provenance) ? [
      `outcome:${outcomeId}`,
      `work-order:${resolvedWorkOrderId}`,
      `terminal-event:${resolvedTerminalEventId}`,
      `next-state:${expectedNextState}`,
      `request:${requestKey}`,
      `terminal-binding:${ownerDecisionTerminalKey({
        outcomeId, workOrderId: resolvedWorkOrderId, terminalEventId: resolvedTerminalEventId,
      })}`,
      "choice:APPROVE",
      ...(provenance ? [
        `primary-request:${provenance.requestDigest}`,
        `primary-response:${provenance.responseDigest}`,
      ] : []),
      `decision-packet:${decisionPacketDigest}`,
    ] : null
    const evidencePayload = decisionPacket ? {
      outcomeId,
      workOrderId: resolvedWorkOrderId,
      terminalEventId: resolvedTerminalEventId,
      ownerUserId,
      choice: "APPROVE",
      expectedNextState,
      decisionId: Number(row?.decisionId),
      decisionRef: row?.decisionRef,
      requestKey,
      decisionPacket,
      decisionPacketDigest,
      ...(provenance ? { queueItemId: Number(storedPayload.queueItemId) } : {}),
      ...(provenance ? { primaryDecisionProvenance: provenance } : {}),
    } : null
    const evidenceNotes = evidencePayload ? canonicalJson(evidencePayload) : null
    const expectedAudit = evidencePayload ? {
      ...evidencePayload,
      status: "accepted",
      authority: "binding",
      evidenceId: Number(row?.evidenceRecordId),
      recordedAt: normalizedTimestamp(row?.decidedAt),
    } : null
    if (!row || row.status !== "accepted" || row.choice !== "APPROVE"
      || row.authority !== "binding" || row.outcomeId !== undefined && Number(row.outcomeId) !== outcomeId
      || row.workOrderId !== undefined && workOrderId !== null && Number(row.workOrderId) !== workOrderId
      || row.terminalEventId !== undefined && terminalEventId !== null && Number(row.terminalEventId) !== terminalEventId
      || row.terminalUserId !== undefined && row.terminalUserId !== ownerUserId
      || row.decisionRef !== undefined && row.decisionRef !== `OWNER-DECISION-${outcomeId}-${Number(row.terminalEventId ?? terminalEventId)}`
      || !Number.isSafeInteger(Number(row.receiptEventId))
      || !Number.isSafeInteger(Number(row.evidenceRecordId))
      || !Number.isSafeInteger(Number(row.auditEventId))
      || !decisionPacket || !requestKey || !expectedEvidence || !evidencePayload || !expectedAudit
      || JSON.stringify(row.evidence) !== JSON.stringify(expectedEvidence)
      || canonicalPersistedJson(row.evidenceNotes) !== evidenceNotes
      || !persistedEvidenceHashMatches(
        row.evidenceNotes,
        row.evidenceContentHash,
        evidenceNotes,
      )
      || canonicalJson(row.receiptMetadata) !== canonicalJson(expectedAudit)
      || canonicalJson(row.auditMetadata) !== canonicalJson(expectedAudit)
      || !Number.isSafeInteger(Number(row.decisionId))) return null
    return {
      approved: true,
      status: "accepted",
      choice: "APPROVE",
      decisionId: Number(row.decisionId),
      decisionRef: row.decisionRef,
      requestKey,
      outcomeId,
      workOrderId: resolvedWorkOrderId,
      terminalEventId: resolvedTerminalEventId,
      expectedNextState,
      decidedAt: row.decidedAt ?? null,
      decisionPacket,
      decisionPacketDigest,
    }
  } finally {
    if (pool) await pool.end()
  }
}

export async function selectNextOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  actor = "bsvalues",
  repository = "bsvalues/terragroq",
  enabled = true,
  killSwitch = false,
  standingAuthority = true,
  notBefore = "1970-01-01T00:00:00.000Z",
} = {}) {
  let runQuery = normalizeQuery(query)
  let pool

  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      const error = new Error("DATABASE_URL is required")
      error.code = "DATABASE_URL_REQUIRED"
      throw error
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }

  try {
    const params = [...OUTCOME_SELECTION_PARAMS]
    const notBeforeMs = Date.parse(notBefore)
    if (!Number.isFinite(notBeforeMs)) {
      throw Object.assign(new Error("notBefore is invalid"), { code: "NOT_BEFORE_INVALID" })
    }
    params[9] = new Date(notBeforeMs).toISOString()
    const result = await runQuery(OUTCOME_SELECTION_SQL, params)
    const rows = Array.isArray(result?.rows) ? result.rows : []
    return rows.find((row) => evaluateOutcomePolicy({
      outcome: row, actor, repository, enabled, killSwitch, standingAuthority,
    }).allowed) ?? null
  } finally {
    if (pool) await pool.end()
  }
}

export async function completeOutcome({ query, databaseUrl = process.env.DATABASE_URL, outcomeId, evidence } = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    if (client) await runQuery("BEGIN")
    const result = await runQuery(
      `UPDATE goal SET status = 'converted', "updatedAt" = NOW()
       WHERE id = $1 AND status = 'classified'
       RETURNING id, "userId" AS "userId", ref`,
      [outcomeId],
    )
    const row = result?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT EXISTS (
           SELECT 1 FROM goal g
           JOIN governance_event e ON e."entityType" = 'goal' AND e."entityId"::text = g.id::text
           WHERE g.id = $1 AND g.status = 'converted' AND e."eventType" = 'HERMES_OUTCOME_COMPLETED'
         ) AS completed`,
        [outcomeId],
      )
      if (client) await runQuery("COMMIT")
      return prior?.rows?.[0]?.completed === true
    }
    await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_COMPLETED', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(row.id), `Completed ${row.ref ?? `goal-${row.id}`} through the bounded Hermes bridge`, JSON.stringify(evidence ?? {})],
    )
    if (client) await runQuery("COMMIT")
    return true
  } catch (error) {
    if (client) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export async function terminalizeOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  result,
  nextState,
  metadata = null,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  if (!["OWNER_DECISION_REQUIRED", "FAILED_TERMINAL"].includes(result)) {
    throw Object.assign(new Error("terminal result is invalid"), { code: "OUTCOME_TERMINAL_RESULT_INVALID" })
  }
  const terminalMetadata = {
    result,
    nextState: nextState ?? null,
    ...(result === "OWNER_DECISION_REQUIRED" ? metadata ?? {} : {}),
  }
  if (result === "OWNER_DECISION_REQUIRED") {
    const fields = [
      terminalMetadata.blockedAction,
      terminalMetadata.authorityBoundary,
      terminalMetadata.minimumChoice,
      terminalMetadata.approveConsequence,
      terminalMetadata.denyConsequence,
    ]
    if (typeof terminalMetadata.nextState !== "string"
      || !/^[A-Z][A-Z0-9_]{1,79}$/.test(terminalMetadata.nextState)
      || fields.some((value) => typeof value !== "string" || value.trim() === "")
      || terminalMetadata.minimumChoice !== "APPROVE_OR_DENY") {
      throw Object.assign(new Error("owner decision terminal packet is invalid"), {
        code: "OUTCOME_TERMINAL_DECISION_PACKET_INVALID",
      })
    }
  }
  let runQuery
  let pool
  let client
  let releaseClient = false
  let begun = false
  if (query && typeof query === "object" && typeof query.connect === "function") {
    client = await query.connect()
    runQuery = client.query.bind(client)
    releaseClient = true
  } else if (query && typeof query === "object"
    && typeof query.query === "function" && typeof query.release === "function") {
    runQuery = query.query.bind(query)
  } else if (typeof query === "function" && query.transactionBound === true) {
    runQuery = query
  } else if (query !== undefined && query !== null) {
    throw Object.assign(new Error("terminalization requires a dedicated transaction client"), {
      code: "OUTCOME_TERMINAL_TRANSACTION_CLIENT_REQUIRED",
    })
  } else {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
      releaseClient = true
    }
    await runQuery("BEGIN")
    begun = true
    const identity = await runQuery(
      `SELECT "userId" AS "userId" FROM goal WHERE id = $1`,
      [outcomeId],
    )
    const userId = identity?.rows?.[0]?.userId
    if (typeof userId !== "string" || userId.length === 0) {
      await runQuery("ROLLBACK")
      begun = false
      return false
    }
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [`${userId}:outcome-queue`])
    const updated = await runQuery(
      `UPDATE goal AS g SET status = 'dismissed', "updatedAt" = NOW()
       WHERE g.id = $1 AND g."userId" = $2 AND g.status = 'classified'
         AND NOT EXISTS (
           SELECT 1 FROM "outcome_queue_item" AS q
           WHERE q."userId" = g."userId"
             AND q."goalId" = g.id
             AND q."lifecycleState" = 'active'
         )
       RETURNING id, "userId" AS "userId", ref`,
      [outcomeId, userId],
    )
    const row = updated?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT EXISTS (
           SELECT 1
           FROM goal g
            JOIN governance_event terminal
              ON terminal."entityType" = 'goal' AND terminal."entityId"::text = g.id::text
               AND terminal."userId" = g."userId"
               AND terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
               AND terminal.metadata->>'result' = $2
               AND (terminal.metadata->>'nextState') IS NOT DISTINCT FROM $3
               AND terminal.metadata = $4::jsonb
           WHERE g.id = $1 AND g.status = 'dismissed'
         ) AS terminalized`,
        [outcomeId, result, nextState ?? null, JSON.stringify(terminalMetadata)],
      )
      const alreadyTerminalized = prior?.rows?.[0]?.terminalized === true
      await runQuery(alreadyTerminalized ? "COMMIT" : "ROLLBACK")
      begun = false
      return alreadyTerminalized
    }
    await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_TERMINAL', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(row.id), `${result} for ${row.ref ?? `goal-${row.id}`}`, JSON.stringify(terminalMetadata)],
    )
    await runQuery("COMMIT")
    begun = false
    return true
  } catch (error) {
    if (begun) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    if (releaseClient) client?.release()
    if (pool) await pool.end()
  }
}

export async function deferProviderOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  retryAfter,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  const retryAt = new Date(retryAfter)
  if (!Number.isFinite(retryAt.getTime())) {
    throw Object.assign(new Error("retryAfter is invalid"), { code: "PROVIDER_RETRY_AFTER_INVALID" })
  }
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
      await runQuery("BEGIN")
    }
    const existing = await runQuery(
      `SELECT id, "userId" AS "userId", ref
       FROM goal
       WHERE id = $1 AND status = 'classified'
       FOR UPDATE`,
      [outcomeId],
    )
    const row = existing?.rows?.[0]
    if (!row) {
      if (client) await runQuery("ROLLBACK")
      return false
    }
    const inserted = await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       SELECT $1, 'HERMES_OUTCOME_PROVIDER_DEFERRED', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = $6::text
           AND "eventType" = 'HERMES_OUTCOME_PROVIDER_DEFERRED'
           AND metadata->>'retryAfter' = $5
       )
       RETURNING id`,
      [row.userId, String(row.id), `Deferred ${row.ref ?? `goal-${row.id}`} after bounded provider retries`,
        JSON.stringify({ result: "PROVIDER_UNAVAILABLE", retryAfter: retryAt.toISOString() }),
        retryAt.toISOString(), String(row.id)],
    )
    if (client) await runQuery("COMMIT")
    return (inserted?.rows?.length ?? 0) === 1 || (inserted?.rowCount ?? 0) === 0
  } catch (error) {
    if (client) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export const NATIVE_PROVIDER_RETRY_STATE = "HERMES_REDISPATCH_REQUIRED_WITH_NATIVE_NODE_EXECUTION_AND_WRITABLE_GIT_METADATA; preserve the existing owned working-tree changes"
export const VALIDATION_INFRASTRUCTURE_RETRY_STATE = "VALIDATION_REMEDIATION_EXHAUSTED"
const SHA256 = /^[0-9a-f]{64}$/

export async function readValidationInfrastructureRecovery({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  expectedNextState = VALIDATION_INFRASTRUCTURE_RETRY_STATE,
  proofDigest,
  expectedFencingToken,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (expectedNextState !== VALIDATION_INFRASTRUCTURE_RETRY_STATE
    || typeof proofDigest !== "string" || !SHA256.test(proofDigest)
    || !Number.isSafeInteger(expectedFencingToken) || expectedFencingToken <= 0) {
    throw Object.assign(new Error("validation recovery proof is invalid"), { code: "VALIDATION_RECOVERY_PROOF_INVALID" })
  }
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  try {
    const result = await runQuery(
      `WITH latest_terminal AS (
         SELECT id, metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       )
       SELECT EXISTS (
         SELECT 1
         FROM goal g
         JOIN latest_terminal terminal
           ON terminal.metadata->>'result' = 'FAILED_TERMINAL'
             AND terminal.metadata->>'nextState' = $2
         JOIN governance_event proof
           ON proof."entityType" = 'goal' AND proof."entityId"::text = g.id::text
             AND proof."eventType" = 'HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED'
             AND proof.metadata->>'retryState' = $2
             AND proof.metadata->>'proofDigest' = $3
             AND proof.metadata->>'fencingToken' = $4::text
             AND proof.id > terminal.id
         JOIN governance_event recovered
           ON recovered."entityType" = 'goal' AND recovered."entityId"::text = g.id::text
             AND recovered."eventType" = 'HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED'
             AND recovered.metadata->>'retryState' = $2
             AND recovered.metadata->>'proofDigest' = $3
             AND recovered.id > proof.id
         WHERE g.id = $1::integer AND g.status = 'classified'
       ) AS recovered`,
      [outcomeId, expectedNextState, proofDigest, expectedFencingToken],
    )
    return result?.rows?.[0]?.recovered === true
  } finally {
    if (pool) await pool.end()
  }
}

export async function resolveValidationInfrastructureRecovery({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  expectedNextState = VALIDATION_INFRASTRUCTURE_RETRY_STATE,
  proofDigest,
  expectedFencingToken = null,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (expectedNextState !== VALIDATION_INFRASTRUCTURE_RETRY_STATE
    || typeof proofDigest !== "string" || !SHA256.test(proofDigest)
    || (expectedFencingToken !== null
      && (!Number.isSafeInteger(expectedFencingToken) || expectedFencingToken <= 0))) {
    throw Object.assign(new Error("validation recovery proof is invalid"), {
      code: "VALIDATION_RECOVERY_PROOF_INVALID",
    })
  }
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  try {
    const result = await runQuery(
      `WITH latest_terminal AS (
         SELECT id, metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       )
       SELECT proof.metadata->>'fencingToken' AS "recoveryFencingToken"
       FROM goal g
       JOIN latest_terminal terminal
         ON terminal.metadata->>'result' = 'FAILED_TERMINAL'
           AND terminal.metadata->>'nextState' = $2
       JOIN governance_event proof
         ON proof."entityType" = 'goal' AND proof."entityId"::text = g.id::text
           AND proof."eventType" = 'HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED'
           AND proof.metadata->>'retryState' = $2
           AND proof.metadata->>'proofDigest' = $3
           AND proof.id > terminal.id
       JOIN governance_event recovered
         ON recovered."entityType" = 'goal' AND recovered."entityId"::text = g.id::text
           AND recovered."eventType" = 'HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED'
           AND recovered.metadata->>'retryState' = $2
           AND recovered.metadata->>'proofDigest' = $3
           AND recovered.id > proof.id
       WHERE g.id = $1::integer AND g.status = 'classified'
       ORDER BY proof.id DESC
       LIMIT 2`,
      [outcomeId, expectedNextState, proofDigest],
    )
    if ((result?.rows?.length ?? 0) !== 1) return null
    const recoveryFence = Number(result.rows[0].recoveryFencingToken)
    if (!Number.isSafeInteger(recoveryFence) || recoveryFence <= 0) return null
    if (expectedFencingToken !== null && recoveryFence !== expectedFencingToken) return null
    return { expectedNextState, proofDigest, ["recoveryFencing" + "Token"]: recoveryFence }
  } finally {
    if (pool) await pool.end()
  }
}

export async function recoverNativeProviderOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
      await runQuery("BEGIN")
    }
    const recovered = await runQuery(
      `WITH latest_terminal AS (
         SELECT metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       )
       UPDATE goal g SET status = 'classified', "updatedAt" = NOW()
       FROM latest_terminal t
       WHERE g.id = $1::integer AND g.status = 'dismissed'
         AND t.metadata->>'result' = 'FAILED_TERMINAL'
         AND t.metadata->>'nextState' = $2
       RETURNING g.id, g."userId" AS "userId", g.ref`,
      [outcomeId, NATIVE_PROVIDER_RETRY_STATE],
    )
    const row = recovered?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT EXISTS (
           SELECT 1
           FROM goal g
           JOIN governance_event terminal
             ON terminal."entityType" = 'goal' AND terminal."entityId"::text = g.id::text
               AND terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
               AND terminal.metadata->>'result' = 'FAILED_TERMINAL'
               AND terminal.metadata->>'nextState' = $2
           JOIN governance_event recovered
             ON recovered."entityType" = 'goal' AND recovered."entityId"::text = g.id::text
               AND recovered."eventType" = 'HERMES_OUTCOME_PROVIDER_RECOVERED'
               AND recovered.metadata->>'retryState' = $2
           WHERE g.id = $1::integer AND g.status = 'classified'
         ) AS recovered`,
        [outcomeId, NATIVE_PROVIDER_RETRY_STATE],
      )
      const alreadyRecovered = prior?.rows?.[0]?.recovered === true
      if (client) await runQuery(alreadyRecovered ? "COMMIT" : "ROLLBACK")
      return alreadyRecovered
    }
    await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_PROVIDER_RECOVERED', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(row.id), `Recovered transient native provider wall for ${row.ref ?? `goal-${row.id}`}`,
        JSON.stringify({ priorResult: "FAILED_TERMINAL", retryState: NATIVE_PROVIDER_RETRY_STATE })],
    )
    if (client) await runQuery("COMMIT")
    return true
  } catch (error) {
    if (client) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export async function recoverValidationInfrastructureOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  expectedNextState = VALIDATION_INFRASTRUCTURE_RETRY_STATE,
  proofDigest,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (expectedNextState !== VALIDATION_INFRASTRUCTURE_RETRY_STATE) {
    throw Object.assign(new Error("validation recovery state is invalid"), { code: "VALIDATION_RECOVERY_STATE_INVALID" })
  }
  if (typeof proofDigest !== "string" || !SHA256.test(proofDigest)) {
    throw Object.assign(new Error("validation recovery proof digest is invalid"), { code: "VALIDATION_RECOVERY_PROOF_INVALID" })
  }
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
      await runQuery("BEGIN")
    }
    const recovered = await runQuery(
      `WITH eligible_terminal AS (
         SELECT id, metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       ), eligible_proof AS (
         SELECT proof.id
         FROM governance_event proof, eligible_terminal terminal
         WHERE proof."entityType" = 'goal' AND proof."entityId"::text = ($1::integer)::text
           AND proof."eventType" = 'HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED'
           AND proof.metadata->>'retryState' = $2
           AND proof.metadata->>'proofDigest' = $3
           AND proof.id > terminal.id
         ORDER BY proof."createdAt" DESC, proof.id DESC
         LIMIT 1
       )
       UPDATE goal g SET status = 'classified', "updatedAt" = NOW()
       FROM eligible_terminal terminal, eligible_proof proof
       WHERE g.id = $1::integer AND g.status = 'dismissed'
         AND terminal.metadata->>'result' = 'FAILED_TERMINAL'
         AND terminal.metadata->>'nextState' = $2
         AND NOT EXISTS (
           SELECT 1 FROM governance_event prior
           WHERE prior."entityType" = 'goal' AND prior."entityId"::text = g.id::text
             AND prior."eventType" = 'HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED'
             AND prior.metadata->>'retryState' = $2
             AND prior.id > terminal.id
         )
       RETURNING g.id, g."userId" AS "userId", g.ref`,
      [outcomeId, expectedNextState, proofDigest],
    )
    const row = recovered?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `WITH latest_terminal AS (
           SELECT id, metadata
           FROM governance_event
           WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
             AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
           ORDER BY "createdAt" DESC, id DESC
           LIMIT 1
         )
         SELECT EXISTS (
           SELECT 1
           FROM goal g
           JOIN latest_terminal terminal
             ON terminal.metadata->>'result' = 'FAILED_TERMINAL'
               AND terminal.metadata->>'nextState' = $2
           JOIN governance_event recovered
             ON recovered."entityType" = 'goal' AND recovered."entityId"::text = g.id::text
               AND recovered."eventType" = 'HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED'
               AND recovered.metadata->>'retryState' = $2
               AND recovered.metadata->>'proofDigest' = $3
               AND recovered.id > terminal.id
           WHERE g.id = $1::integer AND g.status = 'classified'
         ) AS recovered`,
        [outcomeId, expectedNextState, proofDigest],
      )
      const alreadyRecovered = prior?.rows?.[0]?.recovered === true
      if (client) await runQuery(alreadyRecovered ? "COMMIT" : "ROLLBACK")
      return alreadyRecovered
    }
    await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_VALIDATION_INFRASTRUCTURE_RECOVERED', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(row.id), `Recovered remediated validation infrastructure for ${row.ref ?? `goal-${row.id}`}`,
        JSON.stringify({ priorResult: "FAILED_TERMINAL", retryState: expectedNextState, proofDigest })],
    )
    if (client) await runQuery("COMMIT")
    return true
  } catch (error) {
    if (client) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export async function recordValidationInfrastructureRecoveryProof({
  transactionClient,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  expectedNextState = VALIDATION_INFRASTRUCTURE_RETRY_STATE,
  proofDigest,
  fencingToken,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (expectedNextState !== VALIDATION_INFRASTRUCTURE_RETRY_STATE
    || typeof proofDigest !== "string" || !SHA256.test(proofDigest)
    || !Number.isSafeInteger(fencingToken) || fencingToken <= 0) {
    throw Object.assign(new Error("validation recovery proof is invalid"), { code: "VALIDATION_RECOVERY_PROOF_INVALID" })
  }
  if (transactionClient !== undefined
    && (typeof transactionClient?.query !== "function"
      || typeof transactionClient?.release !== "function")) {
    throw Object.assign(new Error("transactionClient must be a dedicated database client"), {
      code: "VALIDATION_RECOVERY_TRANSACTION_CLIENT_INVALID",
    })
  }
  let runQuery = transactionClient?.query?.bind(transactionClient)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    const proofIdentity = `hermes-validation-recovery-proof:${outcomeId}:${expectedNextState}:${proofDigest}`
    await runQuery("BEGIN")
    await runQuery("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [proofIdentity])
    const recorded = await runQuery(
      `WITH latest_terminal AS (
         SELECT id, metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       ), candidate AS (
         SELECT g.id, g."userId" AS "userId", g.ref, terminal.id AS "terminalId"
         FROM goal g, latest_terminal terminal
         WHERE g.id = $1::integer AND g.status = 'dismissed'
           AND terminal.metadata->>'result' = 'FAILED_TERMINAL'
           AND terminal.metadata->>'nextState' = $2
       )
       INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       SELECT candidate."userId", 'HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED', 'goal', candidate.id::text,
         'hermes-codex-bridge', 'Confirmed bounded local validation infrastructure recovery', $3::jsonb
       FROM candidate
       WHERE NOT EXISTS (
         SELECT 1 FROM governance_event prior
         WHERE prior."entityType" = 'goal' AND prior."entityId"::text = candidate.id::text
           AND prior."eventType" = 'HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED'
           AND prior.metadata->>'proofDigest' = $4
           AND prior.metadata->>'retryState' = $2
           AND prior.id > candidate."terminalId"
       )
       RETURNING id`,
      [outcomeId, expectedNextState,
        JSON.stringify({ retryState: expectedNextState, proofDigest, fencingToken }), proofDigest],
    )
    if (recorded?.rows?.length > 0) {
      await runQuery("COMMIT")
      return true
    }
    const prior = await runQuery(
      `WITH latest_terminal AS (
         SELECT id FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC LIMIT 1
       )
       SELECT EXISTS (
         SELECT 1 FROM governance_event proof, latest_terminal terminal
         WHERE proof."entityType" = 'goal' AND proof."entityId"::text = ($1::integer)::text
           AND proof."eventType" = 'HERMES_VALIDATION_INFRASTRUCTURE_RECOVERY_CONFIRMED'
           AND proof.metadata->>'proofDigest' = $2
           AND proof.metadata->>'retryState' = $3
           AND proof.metadata->>'fencingToken' = $4
           AND proof.id > terminal.id
       ) AS recorded`,
      [outcomeId, proofDigest, expectedNextState, String(fencingToken)],
    )
    const alreadyRecorded = prior?.rows?.[0]?.recorded === true
    await runQuery(alreadyRecorded ? "COMMIT" : "ROLLBACK")
    return alreadyRecorded
  } catch (error) {
    try { await runQuery?.("ROLLBACK") } catch {}
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

const COMMIT_SHA = /^[0-9a-f]{40}$/
const PROJECTION_STATE = /^[A-Z][A-Z0-9_]{1,79}$/
const REVIEW_REMEDIATION_EXHAUSTED = "REVIEW_REMEDIATION_EXHAUSTED"
const POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED = "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
const ACTIVE_CLEANUP_REGISTERED_CONTRACT = resolveHermesWorkContract({
  command: "record structured #911 reliability remediation without host mutation",
  title: "record structured #911 reliability remediation without host mutation",
  objective: "record structured #911 reliability remediation without host mutation",
  lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
})
if (!ACTIVE_CLEANUP_REGISTERED_CONTRACT) throw new Error("Registered #911 work contract is unavailable")
const SENSITIVE_RUNTIME_EVIDENCE = /(?:ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:token|password|secret)\s*[:=]\s*\S+|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s@/]*:[^@\s/]+@)/i

function normalizeRuntimeWorkContract(value) {
  const validList = (items, maxLength) => Array.isArray(items) && items.length > 0
    && items.length <= 50
    && items.every((item) => typeof item === "string" && item.length > 0
      && item.length <= maxLength && !SENSITIVE_RUNTIME_EVIDENCE.test(item))
    && new Set(items).size === items.length
  if (!value || typeof value.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,119}$/i.test(value.id)
    || typeof value.digest !== "string" || !/^[0-9a-f]{64}$/.test(value.digest)
    || !validList(value.allowedFiles, 300) || !validList(value.validators, 500)) {
    throw Object.assign(new Error("runtime work contract is invalid"), {
      code: "OUTCOME_WORK_ORDER_CONTRACT_INVALID",
    })
  }
  const projection = value.projection === undefined ? null : value.projection
  const delivery = value.delivery === undefined ? null : value.delivery
  if ((projection !== null && (!Number.isSafeInteger(projection?.issueNumber)
      || projection.issueNumber <= 0 || typeof projection.completionOwned !== "boolean"))
    || (delivery !== null && (delivery?.authorityLevel !== "A2_WRITE_OWN"
      || !Array.isArray(delivery.allowedActions) || delivery.allowedActions.length !== 1
      || delivery.allowedActions[0] !== "implement"
      || typeof delivery.commitAllowed !== "boolean" || typeof delivery.tagAllowed !== "boolean"
      || typeof delivery.pushAllowed !== "boolean"))) {
    throw Object.assign(new Error("runtime work contract is invalid"), {
      code: "OUTCOME_WORK_ORDER_CONTRACT_INVALID",
    })
  }
  return {
    id: value.id,
    digest: value.digest,
    version: value.version ?? HERMES_WORK_CONTRACT_VERSION,
    repository: value.repository ?? "bsvalues/terragroq",
    lane: value.lane ?? null,
    allowedFiles: [...value.allowedFiles],
    validators: [...value.validators],
    structuredBinding: value.version !== undefined || value.repository !== undefined
      || value.lane !== undefined || projection !== null || delivery !== null,
    ...(projection === null ? {} : { projection: { ...projection } }),
    ...(delivery === null ? {} : { delivery: { ...delivery, allowedActions: [...delivery.allowedActions] } }),
  }
}

function pathWithinRuntimeContract(candidate, allowedFiles) {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 300
    || candidate.startsWith("/") || candidate.includes("\\")
    || candidate.split("/").includes("..")) return false
  return allowedFiles.some((reservation) => {
    const prefix = reservation.endsWith("/**") ? reservation.slice(0, -3) : null
    return candidate === reservation || (prefix !== null
      && (candidate === prefix || candidate.startsWith(`${prefix}/`)))
  })
}

function normalizeCheckpointFindings(value, workContract) {
  if (value === undefined) return []
  let normalized
  try {
    normalized = normalizeHermesFindings(value)
  } catch (error) {
    throw Object.assign(new Error("runtime checkpoint finding is invalid"), {
      code: error?.code === "TURN_RESULT_FINDING_QUARANTINE_WALL"
        ? "OUTCOME_PROJECTION_FINDING_QUARANTINE_WALL"
        : "OUTCOME_PROJECTION_FINDING_INVALID",
    })
  }
  if (normalized.some((finding) => finding.paths.some((candidate) => (
    !pathWithinRuntimeContract(candidate, workContract.allowedFiles)
  )) || finding.effects.destroys.some((target) => (
    !pathWithinRuntimeContract(target.path, workContract.allowedFiles)
  )))) {
    throw Object.assign(new Error("runtime checkpoint finding escapes its reservation"), {
      code: "OUTCOME_PROJECTION_FINDING_INVALID",
    })
  }
  return normalized
}

function exactStringArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length
    && actual.every((item, index) => item === expected[index])
}

function normalizeRuntimeExecutionBinding(value) {
  const hasReviewRecovery = value?.reviewRecoveryResumeState !== undefined
    || value?.reviewRecoverySourceExpectedVersion !== undefined
    || value?.reviewRecoverySourceFencingToken !== undefined
    || value?.reviewRecoverySourceRuntimeAttempt !== undefined
    || value?.reviewRecoveryReclaimEventId !== undefined
    || value?.reviewRecoveryReclaimPayloadDigest !== undefined
    || value?.reviewRecoveryStaleReacquisition !== undefined
    || value?.reviewRecoveryStaleContinuation !== undefined
  const reclaimedReviewRecovery = value?.reviewRecoveryResumeState
    === "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
  const staleReacquisition = value?.reviewRecoveryStaleReacquisition
  const staleContinuation = value?.reviewRecoveryStaleContinuation
  const staleKeys = ["disposition", "expectedVersion", "fencingToken", "leaseExpiresAt",
    "lifecycleReason", "priorExpectedVersion", "priorFencingToken", "receiptLatestFencingToken"]
  const anchoredStaleKeys = [...staleKeys, "checkpointDigest"]
  const staleExpiry = typeof staleReacquisition?.leaseExpiresAt === "string"
    ? Date.parse(staleReacquisition.leaseExpiresAt) : Number.NaN
  const continuationKeys = [...staleKeys, "priorLeaseExpiresAt"]
  const anchoredContinuationKeys = [...continuationKeys, "checkpointDigest"]
  const continuationExpiry = typeof staleContinuation?.leaseExpiresAt === "string"
    ? Date.parse(staleContinuation.leaseExpiresAt) : Number.NaN
  const invalidStaleReacquisition = staleReacquisition !== undefined && (
    !staleReacquisition || typeof staleReacquisition !== "object" || Array.isArray(staleReacquisition)
    || ![staleKeys, anchoredStaleKeys].some((keys) => Object.keys(staleReacquisition).length === keys.length
      && keys.every((key) => Object.hasOwn(staleReacquisition, key)))
    || !reclaimedReviewRecovery
    || staleReacquisition.lifecycleReason !== "STALE_LEASE_RECOVERED"
    || !["RECLAIMED", "REPLAY_WINNER"].includes(staleReacquisition.disposition)
    || staleReacquisition.priorExpectedVersion !== value.reviewRecoverySourceExpectedVersion + 2
    || staleReacquisition.priorFencingToken !== value.reviewRecoverySourceFencingToken + 2
    || staleReacquisition.expectedVersion !== staleReacquisition.priorExpectedVersion + 1
    || staleReacquisition.fencingToken !== staleReacquisition.priorFencingToken + 1
    || (staleContinuation === undefined
      && (staleReacquisition.expectedVersion !== value.expectedVersion
        || staleReacquisition.fencingToken !== value.fencingToken))
    || staleReacquisition.receiptLatestFencingToken !== staleReacquisition.fencingToken
    || !Number.isFinite(staleExpiry)
    || new Date(staleExpiry).toISOString() !== staleReacquisition.leaseExpiresAt
    || (staleReacquisition.checkpointDigest !== undefined
      && !/^[0-9a-f]{64}$/.test(String(staleReacquisition.checkpointDigest))))
  const invalidStaleContinuation = staleContinuation !== undefined && (
    staleReacquisition === undefined || !staleContinuation
    || typeof staleContinuation !== "object" || Array.isArray(staleContinuation)
    || ![continuationKeys, anchoredContinuationKeys].some((keys) => Object.keys(staleContinuation).length === keys.length
      && keys.every((key) => Object.hasOwn(staleContinuation, key)))
    || staleContinuation.lifecycleReason !== "STALE_LEASE_RECOVERED"
    || !["RECLAIMED", "REPLAY_WINNER"].includes(staleContinuation.disposition)
    || staleContinuation.priorExpectedVersion !== staleReacquisition.expectedVersion
    || staleContinuation.priorFencingToken !== staleReacquisition.fencingToken
    || staleContinuation.priorLeaseExpiresAt !== staleReacquisition.leaseExpiresAt
    || staleContinuation.expectedVersion !== staleContinuation.priorExpectedVersion + 1
    || staleContinuation.fencingToken !== staleContinuation.priorFencingToken + 1
    || staleContinuation.expectedVersion !== value.expectedVersion
    || staleContinuation.fencingToken !== value.fencingToken
    || staleContinuation.receiptLatestFencingToken !== staleContinuation.fencingToken
    || !Number.isFinite(continuationExpiry)
    || new Date(continuationExpiry).toISOString() !== staleContinuation.leaseExpiresAt
    || (staleContinuation.checkpointDigest !== undefined
      && !/^[0-9a-f]{64}$/.test(String(staleContinuation.checkpointDigest))))
  const invalidReviewRecovery = hasReviewRecovery && (
    !["REVIEW_REMEDIATION_RECOVERED", "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"]
      .includes(value.reviewRecoveryResumeState)
    || !Number.isSafeInteger(value.reviewRecoverySourceExpectedVersion)
    || value.reviewRecoverySourceExpectedVersion < 0
    || !Number.isSafeInteger(value.reviewRecoverySourceFencingToken)
    || value.reviewRecoverySourceFencingToken <= 0
    || !Number.isSafeInteger(value.reviewRecoverySourceRuntimeAttempt)
    || value.reviewRecoverySourceRuntimeAttempt <= 0
    || value.expectedVersion !== value.reviewRecoverySourceExpectedVersion
      + (staleContinuation ? 4 : staleReacquisition ? 3 : reclaimedReviewRecovery ? 2 : 1)
    || value.fencingToken !== value.reviewRecoverySourceFencingToken
      + (staleContinuation ? 4 : staleReacquisition ? 3 : reclaimedReviewRecovery ? 2 : 1)
    || (reclaimedReviewRecovery && (!Number.isSafeInteger(value.reviewRecoveryReclaimEventId)
      || value.reviewRecoveryReclaimEventId <= 0
      || typeof value.reviewRecoveryReclaimPayloadDigest !== "string"
      || !/^[0-9a-f]{64}$/.test(value.reviewRecoveryReclaimPayloadDigest)))
    || (!reclaimedReviewRecovery && (value.reviewRecoveryReclaimEventId !== undefined
      || value.reviewRecoveryReclaimPayloadDigest !== undefined))
    || invalidStaleReacquisition
    || invalidStaleContinuation
  )
  if (!value || typeof value.userId !== "string" || value.userId.trim() === ""
    || typeof value.outcomeKey !== "string" || value.outcomeKey.trim() === ""
    || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0
    || typeof value.executionBinding !== "string" || value.executionBinding.trim() === ""
    || typeof value.leaseToken !== "string" || value.leaseToken.trim() === ""
    || typeof value.leaseHolder !== "string" || value.leaseHolder.trim() === ""
    || (value.acquisitionKey !== undefined
      && (typeof value.acquisitionKey !== "string" || value.acquisitionKey.trim() === ""))
    || !Number.isSafeInteger(value.fencingToken) || value.fencingToken <= 0
    || invalidReviewRecovery) {
    throw Object.assign(new Error("runtime execution binding is invalid"), {
      code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
    })
  }
  return {
    userId: value.userId,
    outcomeKey: value.outcomeKey,
    expectedVersion: value.expectedVersion,
    executionBinding: value.executionBinding,
    ["lease" + "Token"]: value.leaseToken,
    leaseHolder: value.leaseHolder,
    ...(value.acquisitionKey === undefined ? {} : { acquisitionKey: value.acquisitionKey }),
    ["fencing" + "Token"]: value.fencingToken,
    ...(hasReviewRecovery ? {
      reviewRecoveryResumeState: value.reviewRecoveryResumeState,
      reviewRecoverySourceExpectedVersion: value.reviewRecoverySourceExpectedVersion,
      reviewRecoverySourceFencingToken: value.reviewRecoverySourceFencingToken,
      reviewRecoverySourceRuntimeAttempt: value.reviewRecoverySourceRuntimeAttempt,
      ...(reclaimedReviewRecovery ? {
        reviewRecoveryReclaimEventId: value.reviewRecoveryReclaimEventId,
        reviewRecoveryReclaimPayloadDigest: value.reviewRecoveryReclaimPayloadDigest,
        ...(staleReacquisition === undefined ? {} : {
          reviewRecoveryStaleReacquisition: { ...staleReacquisition },
          ...(staleContinuation === undefined ? {} : {
            reviewRecoveryStaleContinuation: { ...staleContinuation },
          }),
        }),
      } : {}),
    } : {}),
  }
}

export async function authorizeHistoricalRecoveryProjection({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  recoveryKind,
  runtimeAttempt,
  executionBinding,
  prNumber,
  reviewedHeadSha,
  mergeSha,
  proofDigest,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !["review-remediation", "terminal-cleanup"].includes(recoveryKind)
    || !Number.isSafeInteger(runtimeAttempt) || runtimeAttempt <= 0
    || !Number.isSafeInteger(prNumber) || prNumber <= 0
    || typeof reviewedHeadSha !== "string" || !COMMIT_SHA.test(reviewedHeadSha)
    || typeof mergeSha !== "string" || !COMMIT_SHA.test(mergeSha)
    || typeof proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proofDigest)) {
    throw Object.assign(new Error("Historical recovery proof is invalid"), {
      code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
    })
  }
  const binding = normalizeRuntimeExecutionBinding(executionBinding)
  if (binding.acquisitionKey === undefined) {
    throw Object.assign(new Error("Historical recovery acquisition epoch is missing"), {
      code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
    })
  }
  const lifecycleReason = recoveryKind === "terminal-cleanup"
    ? POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED
    : REVIEW_REMEDIATION_EXHAUSTED
  const eventType = recoveryKind === "terminal-cleanup"
    ? "HERMES_OUTCOME_TERMINAL_CLEANUP_RECOVERY_AUTHORIZED"
    : "HERMES_OUTCOME_REVIEW_RECOVERY_AUTHORIZED"
  const workOrderRef = outcomeWorkOrderRef(outcomeId)
  const recoveryExecutionEpochDigest = executionEpochDigest(binding)
  const authorizationKey = (terminalEventId) => [
    "hermes-outcome", outcomeId, recoveryKind, "projection-authorization",
    "terminal", terminalEventId, "epoch", recoveryExecutionEpochDigest,
  ].join(":")
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let begun = false
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    begun = true
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [workOrderRef])
    const prior = await runQuery(
      `SELECT id, metadata
       FROM governance_event
       WHERE "userId" = $1
         AND "entityType" = 'goal'
         AND "entityId"::text = $2
         AND "eventType" = '${eventType}'
         AND metadata->>'recoveryKind' = $3
         AND metadata->>'executionBinding' = $4
         AND metadata->>'acquisitionKey' = $5
         AND metadata->>'fencingToken' = ($6::integer)::text
       ORDER BY id
       LIMIT 2
       FOR UPDATE`,
      [binding.userId, String(outcomeId), recoveryKind, binding.executionBinding,
        binding.acquisitionKey, binding.fencingToken],
    )
    if ((prior?.rows?.length ?? 0) > 1) {
      throw Object.assign(new Error("Historical recovery authorization replay conflicts"), {
        code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    if (prior?.rows?.length === 1) {
      const persisted = prior.rows[0].metadata
      const workOrderId = Number(persisted?.workOrderId)
      const runtimeCheckpointEventId = Number(persisted?.runtimeCheckpointEventId)
      const terminalEventId = Number(persisted?.terminalEventId)
      const expected = {
        idempotencyKey: authorizationKey(terminalEventId),
        recoveryKind,
        outcomeId,
        userId: binding.userId,
        outcomeKey: binding.outcomeKey,
        workOrderId,
        workOrderRef,
        runtimeCheckpointEventId,
        runtimeCheckpointPayloadDigest: persisted?.runtimeCheckpointPayloadDigest,
        terminalEventId,
        terminalPayloadDigest: persisted?.terminalPayloadDigest,
        runtimeAttempt,
        executionBinding: binding.executionBinding,
        acquisitionKey: binding.acquisitionKey,
        fencingToken: binding.fencingToken,
        executionEpochDigest: recoveryExecutionEpochDigest,
        prNumber,
        reviewedHeadSha,
        mergeSha,
        proofDigest,
      }
      expected.payloadDigest = projectionPayloadDigest(expected)
      if (!Number.isSafeInteger(Number(prior.rows[0].id))
        || Number(prior.rows[0].id) <= 0
        || !Number.isSafeInteger(workOrderId) || workOrderId <= 0
        || !Number.isSafeInteger(runtimeCheckpointEventId) || runtimeCheckpointEventId <= 0
        || !Number.isSafeInteger(terminalEventId) || terminalEventId <= 0
        || runtimeCheckpointEventId >= terminalEventId
        || typeof expected.runtimeCheckpointPayloadDigest !== "string"
        || !/^[0-9a-f]{64}$/.test(expected.runtimeCheckpointPayloadDigest)
        || typeof expected.terminalPayloadDigest !== "string"
        || !/^[0-9a-f]{64}$/.test(expected.terminalPayloadDigest)
        || canonicalJson(persisted) !== canonicalJson(expected)) {
        throw Object.assign(new Error("Historical recovery authorization replay conflicts"), {
          code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
        })
      }
      await runQuery("COMMIT")
      begun = false
      return { eventId: Number(prior.rows[0].id), replayed: true }
    }
    const graph = await runQuery(
      `SELECT recovery_goal.id AS "goalId", recovery_goal."userId" AS "userId",
         recovery_queue."outcomeKey" AS "outcomeKey",
         recovery_queue."lifecycleState" AS "lifecycleState",
         recovery_queue."lifecycleReason" AS "lifecycleReason",
         recovery_queue.version AS version,
         recovery_queue."executionBinding" AS "executionBinding",
         recovery_queue."leaseToken" AS "leaseToken",
         recovery_queue."leaseHolder" AS "leaseHolder",
         recovery_queue."leaseExpiresAt" AS "leaseExpiresAt",
         recovery_queue."acquisitionKey" AS "acquisitionKey",
         recovery_queue."fencingToken" AS "fencingToken",
         recovery_work_order.id AS "workOrderId", recovery_work_order.ref AS "workOrderRef",
         recovery_runtime.id AS "runtimeCheckpointEventId",
         recovery_runtime.metadata AS "runtimeCheckpointMetadata",
         recovery_terminal.id AS "terminalEventId",
         recovery_terminal.metadata AS "terminalMetadata"
       FROM goal AS recovery_goal
       JOIN outcome_queue_item AS recovery_queue
         ON recovery_queue."userId" = recovery_goal."userId"
        AND recovery_queue."goalId" = recovery_goal.id
       JOIN work_order AS recovery_work_order
         ON recovery_work_order."userId" = recovery_goal."userId"
        AND recovery_work_order.id = recovery_queue."activeWorkOrderId"
        AND recovery_work_order.ref = $9
        AND recovery_work_order.status = 'blocked'
        AND recovery_work_order.result = 'FAIL'
       JOIN outcome_queue_acquisition_receipt AS recovery_acquisition
         ON recovery_acquisition."userId" = recovery_queue."userId"
        AND recovery_acquisition."outcomeKey" = recovery_queue."outcomeKey"
        AND recovery_acquisition."acquisitionKey" = recovery_queue."acquisitionKey"
        AND recovery_acquisition."latestFencingToken" = recovery_queue."fencingToken"
       JOIN LATERAL (
         SELECT checkpoint.id, checkpoint.metadata
         FROM governance_event AS checkpoint
         WHERE checkpoint."userId" = recovery_goal."userId"
           AND checkpoint."entityType" = 'work_order'
           AND checkpoint."entityId"::text = recovery_work_order.id::text
           AND checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND checkpoint.metadata->>'checkpointState' = 'FAILED_TERMINAL'
         ORDER BY checkpoint."createdAt" DESC, checkpoint.id DESC
         LIMIT 1
       ) AS recovery_runtime ON true
       JOIN LATERAL (
         SELECT terminal.id, terminal.metadata
         FROM governance_event AS terminal
         WHERE terminal."userId" = recovery_goal."userId"
           AND terminal."entityType" = 'goal'
           AND terminal."entityId"::text = recovery_goal.id::text
           AND terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY terminal."createdAt" DESC, terminal.id DESC
         LIMIT 1
       ) AS recovery_terminal ON true
       WHERE recovery_goal.id = $1::integer
         AND recovery_goal."userId" = $2
         AND recovery_goal.status = 'dismissed'
         AND recovery_queue."outcomeKey" = $3
         AND recovery_queue."lifecycleState" = 'blocked'
         AND recovery_queue."lifecycleReason" = $8
         AND recovery_queue.version = $4::integer + 1
         AND recovery_queue."executionBinding" = $5
         AND recovery_queue."leaseToken" IS NULL
         AND recovery_queue."leaseHolder" IS NULL
         AND recovery_queue."leaseExpiresAt" IS NULL
         AND recovery_queue."acquisitionKey" = $6
         AND recovery_queue."fencingToken" = $7::integer
         AND recovery_terminal.metadata->>'result' = 'FAILED_TERMINAL'
         AND recovery_terminal.metadata->>'nextState' = $8
         AND recovery_runtime.id < recovery_terminal.id
         AND recovery_runtime.metadata->>'checkpointState' = 'FAILED_TERMINAL'
         AND recovery_runtime.metadata->>'checkpointDetail' = $8
         AND recovery_runtime.metadata->>'outcomeId' = recovery_goal.id::text
         AND recovery_runtime.metadata->>'workOrderRef' = recovery_work_order.ref
         AND recovery_runtime.metadata->>'attempt' = ($11::integer)::text
         AND recovery_runtime.metadata->>'executionBinding' = recovery_queue."executionBinding"
         AND recovery_runtime.metadata->>'acquisitionKey' = recovery_queue."acquisitionKey"
         AND recovery_runtime.metadata->>'acquisitionFencingToken' = recovery_queue."fencingToken"::text
         AND recovery_runtime.metadata->>'executionEpochDigest' = $10
         AND recovery_runtime.metadata->>'idempotencyKey' = 'hermes-outcome:' || recovery_goal.id::text
           || ':attempt:' || ($11::integer)::text
           || ':checkpoint:' || (recovery_runtime.metadata->>'checkpointSequence')
       ORDER BY recovery_goal.id
       LIMIT 2
       FOR UPDATE OF recovery_goal, recovery_queue, recovery_work_order`,
      [outcomeId, binding.userId, binding.outcomeKey, binding.expectedVersion,
        binding.executionBinding, binding.acquisitionKey, binding.fencingToken,
        lifecycleReason, workOrderRef, recoveryExecutionEpochDigest, runtimeAttempt],
    )
    if (graph?.rows?.length !== 1) {
      throw Object.assign(new Error("Historical recovery authorization graph is invalid"), {
        code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    const row = graph.rows[0]
    const exactGraph = Number(row.goalId) === outcomeId
      && row.userId === binding.userId
      && row.outcomeKey === binding.outcomeKey
      && row.lifecycleState === "blocked"
      && row.lifecycleReason === lifecycleReason
      && Number(row.version) === binding.expectedVersion + 1
      && row.executionBinding === binding.executionBinding
      && row.leaseToken == null && row.leaseHolder == null && row.leaseExpiresAt == null
      && row.acquisitionKey === binding.acquisitionKey
      && Number(row.fencingToken) === binding.fencingToken
      && Number.isSafeInteger(Number(row.workOrderId)) && Number(row.workOrderId) > 0
      && row.workOrderRef === workOrderRef
      && Number.isSafeInteger(Number(row.runtimeCheckpointEventId))
      && Number(row.runtimeCheckpointEventId) > 0
      && Number.isSafeInteger(Number(row.terminalEventId)) && Number(row.terminalEventId) > 0
      && Number(row.runtimeCheckpointEventId) < Number(row.terminalEventId)
    if (!exactGraph) {
      throw Object.assign(new Error("Historical recovery authorization graph conflicts"), {
        code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    const runtimeCheckpointMetadata = row.runtimeCheckpointMetadata
    const runtimeCheckpointPayloadDigest = runtimeCheckpointMetadata?.payloadDigest
    const expectedTerminalMetadata = { result: "FAILED_TERMINAL", nextState: lifecycleReason }
    if (typeof runtimeCheckpointPayloadDigest !== "string"
      || !/^[0-9a-f]{64}$/.test(runtimeCheckpointPayloadDigest)
      || runtimeCheckpointMetadata.checkpointState !== "FAILED_TERMINAL"
      || runtimeCheckpointMetadata.checkpointDetail !== lifecycleReason
      || Number(runtimeCheckpointMetadata.outcomeId) !== outcomeId
      || runtimeCheckpointMetadata.workOrderRef !== workOrderRef
      || Number(runtimeCheckpointMetadata.attempt) !== runtimeAttempt
      || !Number.isSafeInteger(Number(runtimeCheckpointMetadata.checkpointSequence))
      || Number(runtimeCheckpointMetadata.checkpointSequence) < 0
      || runtimeCheckpointMetadata.idempotencyKey !== `hermes-outcome:${outcomeId}:attempt:${runtimeAttempt}:checkpoint:${runtimeCheckpointMetadata.checkpointSequence}`
      || runtimeCheckpointMetadata.executionBinding !== binding.executionBinding
      || runtimeCheckpointMetadata.acquisitionKey !== binding.acquisitionKey
      || Number(runtimeCheckpointMetadata.acquisitionFencingToken) !== binding.fencingToken
      || runtimeCheckpointMetadata.executionEpochDigest !== recoveryExecutionEpochDigest
      || canonicalJson(row.terminalMetadata) !== canonicalJson(expectedTerminalMetadata)) {
      throw Object.assign(new Error("Historical recovery terminal epoch is invalid"), {
        code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    const terminalPayloadDigest = projectionPayloadDigest(expectedTerminalMetadata)
    const idempotencyKey = authorizationKey(Number(row.terminalEventId))
    const metadata = {
      idempotencyKey,
      recoveryKind,
      outcomeId,
      userId: row.userId,
      outcomeKey: row.outcomeKey,
      workOrderId: Number(row.workOrderId),
      workOrderRef: row.workOrderRef,
      runtimeCheckpointEventId: Number(row.runtimeCheckpointEventId),
      runtimeCheckpointPayloadDigest,
      terminalEventId: Number(row.terminalEventId),
      terminalPayloadDigest,
      runtimeAttempt,
      executionBinding: row.executionBinding,
      acquisitionKey: row.acquisitionKey,
      fencingToken: Number(row.fencingToken),
      executionEpochDigest: recoveryExecutionEpochDigest,
      prNumber,
      reviewedHeadSha,
      mergeSha,
      proofDigest,
    }
    metadata.payloadDigest = projectionPayloadDigest(metadata)
    const inserted = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, '${eventType}', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)
       RETURNING id`,
      [row.userId, String(outcomeId),
        `Authorized exact ${recoveryKind} projection for ${workOrderRef}`,
        JSON.stringify(metadata)],
    )
    if (inserted?.rows?.length !== 1 || !Number.isSafeInteger(Number(inserted.rows[0].id))) {
      throw Object.assign(new Error("Historical recovery authorization was not persisted"), {
        code: "OUTCOME_HISTORICAL_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    await runQuery("COMMIT")
    begun = false
    return { eventId: Number(inserted.rows[0].id), replayed: false }
  } catch (error) {
    if (begun) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

function validatorLabels(commands) {
  if (!Array.isArray(commands)) return null
  const labels = []
  for (const command of commands) {
    if (!command || typeof command.command !== "string" || !Array.isArray(command.args)
      || !command.args.every((argument) => typeof argument === "string")) return null
    labels.push(`${command.command} ${command.args.join(" ")}`)
  }
  return labels
}

function exactAuthorizationContract(
  row,
  workContract,
  executionBinding,
  outcomeId,
  historicalRecovery,
  checkpointState,
  activeReviewRecovery = false,
) {
  const receiptContract = row?.workContract
  const delivery = workContract.delivery
  const projection = workContract.projection
  const staleReacquisition = activeReviewRecovery
    ? executionBinding.reviewRecoveryStaleReacquisition : undefined
  const staleContinuation = activeReviewRecovery
    ? executionBinding.reviewRecoveryStaleContinuation : undefined
  const activeRecoveryDelta = staleContinuation ? 4 : staleReacquisition ? 3
    : executionBinding.reviewRecoveryResumeState === "REVIEW_REMEDIATION_RECOVERY_RECLAIMED" ? 2 : 1
  const rowLeaseExpiry = Date.parse(String(row?.leaseExpiresAt ?? ""))
  return Number(row?.goalId) === outcomeId
    && row?.userId === executionBinding.userId
    && row?.outcomeKey === executionBinding.outcomeKey
    && row?.executionBinding === executionBinding.executionBinding
    && Number(row?.fencingToken) === executionBinding.fencingToken
    && typeof row?.acquisitionKey === "string"
    && row.acquisitionKey.trim() !== ""
    && (historicalRecovery
      ? row.lifecycleState === "blocked"
        && row.lifecycleReason === (checkpointState === "POST_MERGE_CLEANUP_RECOVERED"
          ? "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
          : "REVIEW_REMEDIATION_EXHAUSTED")
        && Number(row?.version) === executionBinding.expectedVersion + 1
        && row.leaseToken == null
        && row.leaseHolder == null
        && row.leaseExpiresAt == null
        && row.acquisitionKey === executionBinding.acquisitionKey
      : Number(row?.version) === executionBinding.expectedVersion
        && row?.leaseToken === executionBinding.leaseToken
        && row?.leaseHolder === executionBinding.leaseHolder
        && (!activeReviewRecovery
          || (row.lifecycleState === "active"
            && row.lifecycleReason === (staleReacquisition
              ? "STALE_LEASE_RECOVERED" : executionBinding.reviewRecoveryResumeState)
            && executionBinding.expectedVersion === executionBinding.reviewRecoverySourceExpectedVersion
              + activeRecoveryDelta
            && executionBinding.fencingToken === executionBinding.reviewRecoverySourceFencingToken
              + activeRecoveryDelta
            && Number(row?.executionEpochFirstFencingToken)
              === executionBinding.reviewRecoverySourceFencingToken
            && (!staleReacquisition || (Number(row?.executionEpochLatestFencingToken)
              === (staleContinuation?.receiptLatestFencingToken
                ?? staleReacquisition.receiptLatestFencingToken)
              && Number.isFinite(rowLeaseExpiry)
              && new Date(rowLeaseExpiry).toISOString() === (staleContinuation?.leaseExpiresAt
                ?? staleReacquisition.leaseExpiresAt))))))
    && receiptContract?.id === workContract.id
    && receiptContract?.digest === workContract.digest
    && receiptContract?.version === workContract.version
    && receiptContract?.repository === workContract.repository
    && receiptContract?.lane === row?.goalLane
    && (workContract.lane === null || receiptContract.lane === workContract.lane)
    && exactStringArray(receiptContract.reservations, workContract.allowedFiles)
    && exactStringArray(validatorLabels(receiptContract.validationCommands), workContract.validators)
    && (projection === undefined || (receiptContract.projection?.issueNumber === projection.issueNumber
      && receiptContract.projection?.completionOwned === projection.completionOwned))
    && (delivery === undefined || (receiptContract.delivery?.authorityLevel === delivery.authorityLevel
      && exactStringArray(receiptContract.delivery?.allowedActions, delivery.allowedActions)
      && receiptContract.delivery?.commitAllowed === delivery.commitAllowed
      && receiptContract.delivery?.tagAllowed === delivery.tagAllowed
      && receiptContract.delivery?.pushAllowed === delivery.pushAllowed
      && row?.implementationGrantRef === row?.receiptImplementationGrantRef
      && Number(row?.implementationGrantId) === Number(row?.receiptImplementationGrantId)
      && (historicalRecovery
        ? ["active", "expired"].includes(row?.implementationGrantStatus)
        : row?.implementationGrantStatus === "active")
      && row?.implementationGrantRevokedAt == null
      && row?.implementationGrantAuthorityLevel === delivery.authorityLevel
      && row?.implementationGrantGrantedTo === "operator"
      && row?.implementationGrantScope === (row?.receiptOperation === "runtime_finding.derive"
        ? row?.derivedWorkOrderRef
        : `WO-HERMES-OUTCOME-${outcomeId}`)
      && exactStringArray(row?.implementationGrantAllowedActions, delivery.allowedActions)
      && Array.isArray(row?.implementationGrantBlockedActions)
      && !row.implementationGrantBlockedActions.includes("implement")))
}

function executionEpochDigest(row) {
  return createHash("sha256").update(JSON.stringify([
    row.userId,
    row.outcomeKey,
    row.executionBinding,
    row.acquisitionKey,
  ])).digest("hex")
}

function exactHistoricalRecoveryAuthorization(
  row,
  executionBinding,
  outcomeId,
  checkpointState,
  runtimeAttempt,
  proofDigest,
  evidence,
) {
  const recoveryKind = checkpointState === "POST_MERGE_CLEANUP_RECOVERED"
    ? "terminal-cleanup"
    : "review-remediation"
  const lifecycleReason = recoveryKind === "terminal-cleanup"
    ? POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED
    : REVIEW_REMEDIATION_EXHAUSTED
  const runtime = row?.historicalRuntimeCheckpoint
  const terminal = row?.historicalGoalTerminal
  const authorization = row?.recoveryAuthorization
  const runtimeEventId = Number(runtime?.id)
  const terminalEventId = Number(terminal?.id)
  const authorizationEventId = Number(authorization?.id)
  const runtimeMetadata = runtime?.metadata
  const runtimePayloadDigest = runtimeMetadata?.payloadDigest
  const expectedEpochDigest = executionEpochDigest(executionBinding)
  const workOrderRef = outcomeWorkOrderRef(outcomeId)
  const expectedTerminal = { result: "FAILED_TERMINAL", nextState: lifecycleReason }
  const terminalPayloadDigest = projectionPayloadDigest(expectedTerminal)
  const authorizationMetadata = authorization?.metadata
  const expectedAuthorization = {
    idempotencyKey: [
      "hermes-outcome", outcomeId, recoveryKind, "projection-authorization",
      "terminal", terminalEventId, "epoch", expectedEpochDigest,
    ].join(":"),
    recoveryKind,
    outcomeId,
    userId: executionBinding.userId,
    outcomeKey: executionBinding.outcomeKey,
    workOrderId: Number(row?.activeWorkOrderId),
    workOrderRef,
    runtimeCheckpointEventId: runtimeEventId,
    runtimeCheckpointPayloadDigest: runtimePayloadDigest,
    terminalEventId,
    terminalPayloadDigest,
    runtimeAttempt,
    executionBinding: executionBinding.executionBinding,
    acquisitionKey: executionBinding.acquisitionKey,
    fencingToken: executionBinding.fencingToken,
    executionEpochDigest: expectedEpochDigest,
    prNumber: evidence.prNumber,
    reviewedHeadSha: evidence.headRefOid,
    mergeSha: evidence.mergeSha,
    proofDigest,
  }
  expectedAuthorization.payloadDigest = projectionPayloadDigest(expectedAuthorization)
  return Number.isSafeInteger(runtimeEventId) && runtimeEventId > 0
    && Number.isSafeInteger(terminalEventId) && terminalEventId > runtimeEventId
    && Number.isSafeInteger(authorizationEventId) && authorizationEventId > terminalEventId
    && typeof runtimePayloadDigest === "string" && /^[0-9a-f]{64}$/.test(runtimePayloadDigest)
    && runtimeMetadata?.checkpointState === "FAILED_TERMINAL"
    && runtimeMetadata?.checkpointDetail === lifecycleReason
    && Number(runtimeMetadata?.outcomeId) === outcomeId
    && runtimeMetadata?.workOrderRef === workOrderRef
    && Number(runtimeMetadata?.attempt) === runtimeAttempt
    && Number.isSafeInteger(Number(runtimeMetadata?.checkpointSequence))
    && Number(runtimeMetadata.checkpointSequence) >= 0
    && runtimeMetadata?.idempotencyKey === `hermes-outcome:${outcomeId}:attempt:${runtimeAttempt}:checkpoint:${runtimeMetadata.checkpointSequence}`
    && runtimeMetadata?.executionBinding === executionBinding.executionBinding
    && runtimeMetadata?.acquisitionKey === executionBinding.acquisitionKey
    && Number(runtimeMetadata?.acquisitionFencingToken) === executionBinding.fencingToken
    && runtimeMetadata?.executionEpochDigest === expectedEpochDigest
    && canonicalJson(terminal?.metadata) === canonicalJson(expectedTerminal)
    && canonicalJson(authorizationMetadata) === canonicalJson(expectedAuthorization)
}

function exactRecoveryRuntimeCheckpoint(
  checkpoint,
  row,
  executionBinding,
  outcomeId,
  proofDigest,
  evidence,
  checkpointState,
  checkpointDetail,
) {
  const eventId = Number(checkpoint?.id)
  const metadata = checkpoint?.metadata
  if (!Number.isSafeInteger(eventId) || eventId <= 0
    || checkpoint?.actor !== "hermes-codex-bridge"
    || !metadata || typeof metadata !== "object") return false
  const expected = {
    idempotencyKey: `hermes-outcome:${outcomeId}:attempt:${executionBinding.reviewRecoverySourceRuntimeAttempt}:checkpoint:${metadata?.checkpointSequence}`,
    outcomeId,
    workOrderRef: outcomeWorkOrderRef(outcomeId),
    attempt: executionBinding.reviewRecoverySourceRuntimeAttempt,
    checkpointSequence: Number(metadata?.checkpointSequence),
    checkpointState,
    checkpointDetail,
    prNumber: evidence.prNumber,
    headRefOid: evidence.headRefOid,
    mergeSha: evidence.mergeSha,
    reviewRecoveryProofDigest: proofDigest,
    executionBinding: executionBinding.executionBinding,
    acquisitionKey: executionBinding.acquisitionKey,
    acquisitionFencingToken: executionBinding.reviewRecoverySourceFencingToken,
    executionEpochDigest: executionEpochDigest(executionBinding),
    findingsSetDigest: projectionPayloadDigest([]),
    workContractId: row?.workContract?.id,
    workContractDigest: row?.workContract?.digest,
    workContractVersion: row?.workContract?.version,
    workContractRepository: row?.workContract?.repository,
    workContractLane: row?.goalLane,
    authorizationDecisionId: Number(row?.approvalDecisionId),
    executionGrantRef: row?.executionGrantRef,
    implementationGrantId: Number(row?.implementationGrantId),
    implementationGrantRef: row?.implementationGrantRef,
    projectionIssueNumber: row?.workContract?.projection?.issueNumber,
    projectionCompletionOwned: row?.workContract?.projection?.completionOwned,
    deliveryAuthorityLevel: row?.workContract?.delivery?.authorityLevel,
    deliveryAllowedActions: row?.workContract?.delivery?.allowedActions,
    commitAllowed: row?.workContract?.delivery?.commitAllowed,
    tagAllowed: row?.workContract?.delivery?.tagAllowed,
    pushAllowed: row?.workContract?.delivery?.pushAllowed,
  }
  expected.payloadDigest = projectionPayloadDigest(expected)
  return Number.isSafeInteger(expected.checkpointSequence) && expected.checkpointSequence >= 0
    && canonicalJson(metadata) === canonicalJson(expected)
}

function exactActiveReviewRecoveryCheckpoints(row, executionBinding, outcomeId, proofDigest, evidence) {
  const mergeDetail = row?.activeMergedCheckpoint?.metadata?.checkpointDetail
  const allowedMergeDetails = new Set([
    `Recovered reviewed PR #${evidence.prNumber}`,
    `Recovered PR #${evidence.prNumber} through reviewed remediation chain`,
  ])
  return allowedMergeDetails.has(mergeDetail)
    && exactRecoveryRuntimeCheckpoint(
      row?.activeMergedCheckpoint, row, executionBinding, outcomeId, proofDigest, evidence,
      "PR_MERGED", mergeDetail,
    )
    && exactRecoveryRuntimeCheckpoint(
      row?.activeRecoveryCheckpoint, row, executionBinding, outcomeId, proofDigest, evidence,
      "REVIEW_REMEDIATION_RECOVERED", "REVIEW_REMEDIATION_EXHAUSTED",
    )
}

function exactActiveReviewRecoveryReclaim(row, executionBinding, outcomeId, proofDigest, evidence) {
  const reclaimed = executionBinding.reviewRecoveryResumeState
    === "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
  const events = Array.isArray(row?.activeRecoveryReclaims) ? row.activeRecoveryReclaims : []
  if (!reclaimed) return events.length === 0
  if (events.length !== 1) return false
  const event = events[0]
  const metadata = event?.metadata
  if (!metadata || event.actor !== "hermes-codex-bridge"
    || Number(event.id) !== executionBinding.reviewRecoveryReclaimEventId
    || metadata.payloadDigest !== executionBinding.reviewRecoveryReclaimPayloadDigest) return false
  const { payloadDigest, ...body } = metadata
  const expected = {
    acquisitionKey: executionBinding.acquisitionKey,
    campaignWindowId: metadata.campaignWindowId,
    executionBinding: executionBinding.executionBinding,
    fencingToken: executionBinding.reviewRecoverySourceFencingToken + 2,
    idempotencyKey: `hermes-outcome:${outcomeId}:review-recovery-reclaim:acquisition:${executionBinding.acquisitionKey}:fence:${executionBinding.reviewRecoverySourceFencingToken + 2}`,
    leaseExpiresAt: metadata.leaseExpiresAt,
    leaseHolder: executionBinding.leaseHolder,
    leaseToken: executionBinding.leaseToken,
    lifecycleReason: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
    mergeSha: evidence.mergeSha,
    outcomeId,
    outcomeKey: executionBinding.outcomeKey,
    prNumber: evidence.prNumber,
    priorFencingToken: executionBinding.reviewRecoverySourceFencingToken + 1,
    priorLeaseExpiresAt: metadata.priorLeaseExpiresAt,
    priorLeaseHolder: executionBinding.leaseHolder,
    priorLeaseToken: executionBinding.leaseToken,
    priorLifecycleReason: "REVIEW_REMEDIATION_RECOVERED",
    priorVersion: executionBinding.reviewRecoverySourceExpectedVersion + 1,
    processIdentity: metadata.processIdentity,
    proofDigest,
    reclaimedAt: metadata.reclaimedAt,
    recoveryKind: "review-remediation",
    reviewedHeadSha: evidence.headRefOid,
    sourceExpectedVersion: executionBinding.reviewRecoverySourceExpectedVersion,
    sourceFencingToken: executionBinding.reviewRecoverySourceFencingToken,
    sourceRuntimeAttempt: executionBinding.reviewRecoverySourceRuntimeAttempt,
    userId: executionBinding.userId,
    version: executionBinding.reviewRecoverySourceExpectedVersion + 2,
    workOrderId: Number(row.activeWorkOrderId),
    workOrderRef: `WO-HERMES-OUTCOME-${outcomeId}`,
  }
  const priorExpiry = Date.parse(String(metadata.priorLeaseExpiresAt ?? ""))
  const reclaimedAt = Date.parse(String(metadata.reclaimedAt ?? ""))
  const leaseExpiry = Date.parse(String(metadata.leaseExpiresAt ?? ""))
  return typeof metadata.campaignWindowId === "string" && metadata.campaignWindowId.trim() !== ""
    && typeof metadata.processIdentity === "string" && metadata.processIdentity.trim() !== ""
    && Number.isFinite(priorExpiry) && Number.isFinite(reclaimedAt) && Number.isFinite(leaseExpiry)
    && priorExpiry <= reclaimedAt && reclaimedAt < leaseExpiry
    && (executionBinding.reviewRecoveryStaleReacquisition !== undefined
      || new Date(row.leaseExpiresAt).toISOString() === new Date(leaseExpiry).toISOString())
    && canonicalJson(body) === canonicalJson(expected)
    && payloadDigest === createHash("sha256").update(canonicalJson(body)).digest("hex")
    && Number(event.id) > Number(row?.activeRecoveryCheckpoint?.id)
}

function exactActiveReviewRecoveryAcquisitionHops(row, executionBinding, outcomeId) {
  const base = executionBinding.reviewRecoveryStaleReacquisition
  const continuation = executionBinding.reviewRecoveryStaleContinuation
  const attempts = Array.isArray(row?.activeRecoveryAcquisitionAttempts)
    ? row.activeRecoveryAcquisitionAttempts : []
  if (base === undefined) return attempts.length === 0
  const acquisitionKeyDigest = projectionPayloadDigest({
    acquisitionKey: executionBinding.acquisitionKey,
  })
  const leaseIdentityDigest = projectionPayloadDigest({
    leaseHolder: executionBinding.leaseHolder,
    leaseToken: executionBinding.leaseToken,
  })
  const exactHop = (hop, rows, priorLeaseExpiry = null) => {
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 32
      || !/^[0-9a-f]{64}$/.test(String(hop?.checkpointDigest ?? ""))) return false
    let priorAttemptedAt = priorLeaseExpiry
    return rows.every((attempt, index) => {
      const attemptedAt = Date.parse(String(attempt?.attemptedAt ?? ""))
      const leaseExpiresAt = Date.parse(String(attempt?.leaseExpiresAt ?? ""))
      const checkpointSequence = Number(attempt?.checkpointSequence)
      const checkpointPrNumber = attempt?.checkpointPrNumber == null
        ? null : Number(attempt.checkpointPrNumber)
      let checkpointDigest
      try {
        checkpointDigest = digestOutcomeQueueCheckpointProof({
          outcomeId: String(attempt?.checkpointOutcomeId ?? ""),
          outcomeKey: attempt?.outcomeKey,
          workOrderId: Number(attempt?.activeWorkOrderId),
          fencingToken: Number(attempt?.fencingToken),
          sequence: checkpointSequence,
          state: attempt?.checkpointState,
          commit: {
            headSha: attempt?.checkpointHeadSha ?? null,
            mergeSha: attempt?.checkpointMergeSha ?? null,
            prNumber: checkpointPrNumber,
          },
        })
      } catch {
        return false
      }
      return Number.isSafeInteger(Number(attempt?.id)) && Number(attempt.id) > 0
        && typeof attempt?.campaignWindowId === "string" && attempt.campaignWindowId.trim() !== ""
        && typeof attempt?.processIdentity === "string" && attempt.processIdentity.trim() !== ""
        && attempt?.leaseHolder === executionBinding.leaseHolder
        && attempt?.acquisitionKeyDigest === acquisitionKeyDigest
        && attempt?.leaseIdentityDigest === leaseIdentityDigest
        && checkpointDigest === hop.checkpointDigest
        && attempt?.checkpointDigest === hop.checkpointDigest
        && String(attempt?.checkpointOutcomeId) === String(outcomeId)
        && Number.isSafeInteger(checkpointSequence) && checkpointSequence >= 0
        && attempt?.outcomeKey === executionBinding.outcomeKey
        && Number(attempt?.fencingToken) === hop.fencingToken
        && Number(attempt?.activeWorkOrderId) === Number(row?.activeWorkOrderId)
        && Number.isFinite(leaseExpiresAt)
        && new Date(leaseExpiresAt).toISOString() === hop.leaseExpiresAt
        && attempt?.disposition === (index === 0 ? "RECLAIMED" : "REPLAY_WINNER")
        && attempt?.reason == null
        && Number.isFinite(attemptedAt)
        && attemptedAt >= (priorAttemptedAt ?? Number.NEGATIVE_INFINITY)
        && attemptedAt < leaseExpiresAt
        && ((priorAttemptedAt = attemptedAt) >= 0)
    })
  }
  const baseRows = attempts.filter((attempt) => Number(attempt?.fencingToken) === base.fencingToken)
  const continuationRows = continuation === undefined ? []
    : attempts.filter((attempt) => Number(attempt?.fencingToken) === continuation.fencingToken)
  return exactHop(base, baseRows)
    && (continuation === undefined
      ? attempts.length === baseRows.length
      : exactHop(continuation, continuationRows, Date.parse(continuation.priorLeaseExpiresAt))
        && attempts.length === baseRows.length + continuationRows.length
        && Number(baseRows.at(-1)?.id) < Number(continuationRows[0]?.id))
}

function outcomeWorkOrderRef(outcomeId) {
  return `WO-HERMES-OUTCOME-${outcomeId}`
}

function projectionForCheckpoint(state) {
  if (state === "COMPLETE") return { status: "closed", result: "PASS" }
  if (state === "FAILED_TERMINAL") return { status: "blocked", result: "FAIL" }
  if (state === "OWNER_DECISION_REQUIRED") {
    return { status: "blocked", result: "OWNER_DECISION_REQUIRED" }
  }
  if (state === "PROVIDER_UNAVAILABLE" || state === "RETRYABLE_WALL"
    || state.startsWith("DEFERRED_")
    || state.endsWith("_RETRY")) {
    return { status: "blocked", result: "PARTIAL" }
  }
  if (state.startsWith("PR_") || state.startsWith("REVIEW_") || state.startsWith("MERGE_")) {
    return { status: "review", result: null }
  }
  return { status: "active", result: null }
}

function checkpointEvidence(metadata) {
  const prNumber = metadata?.prNumber
  if (prNumber !== undefined && (!Number.isSafeInteger(prNumber) || prNumber <= 0)) {
    throw Object.assign(new Error("checkpoint PR number is invalid"), { code: "OUTCOME_PROJECTION_EVIDENCE_INVALID" })
  }
  const hashes = {}
  for (const field of ["commit", "priorHeadRefOid", "headRefOid", "mergeSha"]) {
    const value = metadata?.[field]
    const clearsHead = field === "headRefOid" && value === null
    if (value !== undefined && !clearsHead && (typeof value !== "string" || !COMMIT_SHA.test(value))) {
      throw Object.assign(new Error(`checkpoint ${field} is invalid`), { code: "OUTCOME_PROJECTION_EVIDENCE_INVALID" })
    }
    if (value !== undefined) hashes[field] = value
  }
  const terminalCleanupRecoveryProofDigest = metadata?.terminalCleanupRecoveryProofDigest
  if (terminalCleanupRecoveryProofDigest !== undefined
    && (typeof terminalCleanupRecoveryProofDigest !== "string"
      || !/^[0-9a-f]{64}$/.test(terminalCleanupRecoveryProofDigest))) {
    throw Object.assign(new Error("checkpoint terminal cleanup proof digest is invalid"), {
      code: "OUTCOME_PROJECTION_EVIDENCE_INVALID",
    })
  }
  const reviewRecoveryProofDigest = metadata?.reviewRecoveryProofDigest
  if (reviewRecoveryProofDigest !== undefined
    && (typeof reviewRecoveryProofDigest !== "string"
      || !/^[0-9a-f]{64}$/.test(reviewRecoveryProofDigest))) {
    throw Object.assign(new Error("checkpoint review recovery proof digest is invalid"), {
      code: "OUTCOME_PROJECTION_EVIDENCE_INVALID",
    })
  }
  return {
    ...(prNumber === undefined ? {} : { prNumber }),
    ...hashes,
    ...(terminalCleanupRecoveryProofDigest === undefined ? {} : { terminalCleanupRecoveryProofDigest }),
    ...(reviewRecoveryProofDigest === undefined ? {} : { reviewRecoveryProofDigest }),
  }
}

function projectionEvidenceLabels(evidence) {
  return [
    ...(evidence.prNumber === undefined ? [] : [`pull-request:#${evidence.prNumber}`]),
    ...(evidence.commit === undefined ? [] : [`commit:${evidence.commit}`]),
    ...(evidence.priorHeadRefOid === undefined ? [] : [`prior-reviewed-head:${evidence.priorHeadRefOid}`]),
    ...(evidence.headRefOid === undefined || evidence.headRefOid === null
      ? []
      : [`reviewed-head:${evidence.headRefOid}`]),
    ...(evidence.mergeSha === undefined ? [] : [`merge:${evidence.mergeSha}`]),
  ]
}

function projectionPayloadDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function runtimeEvidenceRef(outcomeId, attempt, checkpointSequence) {
  return `EV-HERMES-${outcomeId}-${attempt}-${checkpointSequence}`
}

export async function closeProjectionResources({ client, pool, primaryError } = {}) {
  let cleanupError
  try { client?.release() } catch (error) { cleanupError = error }
  if (pool) {
    try { await pool.end() } catch (error) { cleanupError ??= error }
  }
  if (!primaryError && cleanupError) throw cleanupError
}

function failureEvalForCheckpoint(checkpoint) {
  const state = checkpoint.state
  if (state === "FAILED_TERMINAL") {
    return { failureClass: "TERMINAL_RUNTIME_FAILURE", disposition: "terminal" }
  }
  if (state === "PROVIDER_UNAVAILABLE") {
    return { failureClass: "PROVIDER_UNAVAILABLE", disposition: "deferred" }
  }
  if (state === "RETRYABLE_WALL" || state.endsWith("_RETRY")) {
    return { failureClass: "RETRYABLE_RUNTIME_FAILURE", disposition: "bounded-retry" }
  }
  if (state.includes("VALIDATION") && checkpoint.detail) {
    return { failureClass: "VALIDATION_FAILURE", disposition: "bounded-remediation" }
  }
  return null
}

/**
 * Projects one durable Hermes runtime checkpoint into the existing Work Order
 * and append-only governance event tables. The transaction advisory lock makes
 * the deterministic Work Order reference a cardinality boundary without a new
 * schema constraint.
 */
export async function projectOutcomeRuntimeCheckpoint({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  attempt,
  checkpoint,
  workContract,
  executionBinding,
  authorizationOnly = false,
  activeReviewRecoveryProvenanceOnly = false,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (!Number.isSafeInteger(attempt) || attempt <= 0
    || !Number.isSafeInteger(checkpoint?.sequence) || checkpoint.sequence < 0
    || typeof checkpoint?.state !== "string" || !PROJECTION_STATE.test(checkpoint.state)) {
    throw Object.assign(new Error("runtime checkpoint is invalid"), { code: "OUTCOME_PROJECTION_CHECKPOINT_INVALID" })
  }
  if (checkpoint.detail !== undefined && checkpoint.detail !== null
    && (typeof checkpoint.detail !== "string" || checkpoint.detail.length > 1000
      || SENSITIVE_RUNTIME_EVIDENCE.test(checkpoint.detail))) {
    throw Object.assign(new Error("runtime checkpoint detail is invalid"), { code: "OUTCOME_PROJECTION_CHECKPOINT_INVALID" })
  }

  const normalizedWorkContract = normalizeRuntimeWorkContract(workContract)
  const normalizedExecutionBinding = normalizeRuntimeExecutionBinding(executionBinding)
  const historicalRecovery = checkpoint.state === "REVIEW_REMEDIATION_RECOVERED"
    || checkpoint.state === "POST_MERGE_CLEANUP_RECOVERED"
    || (checkpoint.state === "PR_MERGED"
      && /^Recovered (?:reviewed )?PR #\d+(?: through reviewed remediation chain)?$/
        .test(checkpoint.detail ?? ""))
  const activeReviewRecovery = !historicalRecovery
    && ["REVIEW_REMEDIATION_RECOVERED", "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"]
      .includes(normalizedExecutionBinding.reviewRecoveryResumeState)
  const reclaimedActiveReviewRecovery = activeReviewRecovery
    && normalizedExecutionBinding.reviewRecoveryResumeState
      === "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
  if (activeReviewRecoveryProvenanceOnly && (!authorizationOnly || !activeReviewRecovery)) {
    throw Object.assign(new Error("Active review recovery provenance mode is invalid"), {
      code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
    })
  }
  if (historicalRecovery && normalizedExecutionBinding.acquisitionKey === undefined) {
    throw Object.assign(new Error("Historical recovery acquisition epoch is missing"), {
      code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
    })
  }
  const normalizedFindings = normalizeCheckpointFindings(checkpoint.findings, normalizedWorkContract)
  if ((checkpoint.metadata?.workContractId !== undefined
      && checkpoint.metadata.workContractId !== normalizedWorkContract.id)
    || (checkpoint.metadata?.workContractDigest !== undefined
      && checkpoint.metadata.workContractDigest !== normalizedWorkContract.digest)) {
    throw Object.assign(new Error("checkpoint work contract evidence conflicts"), {
      code: "OUTCOME_WORK_ORDER_CONTRACT_INVALID",
    })
  }
  let ref = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:attempt:${attempt}:checkpoint:${checkpoint.sequence}`
  const findingsSetDigest = projectionPayloadDigest(normalizedFindings)
  const evidence = checkpointEvidence(checkpoint.metadata)
  const historicalRecoveryProofDigest = checkpoint.state === "POST_MERGE_CLEANUP_RECOVERED"
    ? evidence.terminalCleanupRecoveryProofDigest
    : evidence.reviewRecoveryProofDigest
  if ((historicalRecovery || activeReviewRecovery) && (
    historicalRecoveryProofDigest === undefined
    || evidence.prNumber === undefined
    || evidence.headRefOid === undefined
    || evidence.mergeSha === undefined
  )) {
    throw Object.assign(new Error("Historical recovery proof is incomplete"), {
      code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
    })
  }
  const projection = projectionForCheckpoint(checkpoint.state)
  const commitRef = evidence.mergeSha ?? evidence.commit ?? evidence.headRefOid ?? null
  const clearCommitRef = evidence.headRefOid === null
    && evidence.commit === undefined
    && evidence.mergeSha === undefined
  const labels = projectionEvidenceLabels(evidence)
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let primaryError
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [ref])
    const authorizations = await runQuery(
      `SELECT contract_goal.id AS "goalId", contract_goal."userId" AS "userId",
         contract_goal.ref AS "goalRef", contract_goal.lane AS "goalLane",
         contract_queue."outcomeKey" AS "outcomeKey",
         contract_queue."lifecycleState" AS "lifecycleState",
         contract_queue."lifecycleReason" AS "lifecycleReason",
         contract_queue.version AS version,
         contract_queue."executionBinding" AS "executionBinding",
         contract_queue."leaseToken" AS "leaseToken",
         contract_queue."leaseHolder" AS "leaseHolder",
         contract_queue."leaseExpiresAt" AS "leaseExpiresAt",
         contract_queue."acquisitionKey" AS "acquisitionKey",
         contract_queue."fencingToken" AS "fencingToken",
          contract_queue."activeWorkOrderId" AS "activeWorkOrderId",
          contract_acquisition."createdAt" AS "executionEpochStartedAt",
          contract_acquisition."firstFencingToken" AS "executionEpochFirstFencingToken",
          contract_acquisition."latestFencingToken" AS "executionEpochLatestFencingToken",
         contract_receipt."resultBinding"->'workContract' AS "workContract",
         contract_receipt."resultBinding"->>'implementationGrantRef' AS "receiptImplementationGrantRef",
         contract_receipt."resultBinding"->>'implementationGrantId' AS "receiptImplementationGrantId",
         contract_receipt.operation AS "receiptOperation",
         contract_receipt."resultBinding"->>'workOrderRef' AS "derivedWorkOrderRef",
         implementation_grant.id AS "implementationGrantId",
         implementation_grant.ref AS "implementationGrantRef",
         implementation_grant.status AS "implementationGrantStatus",
         implementation_grant."revokedAt" AS "implementationGrantRevokedAt",
         implementation_grant."expiresAt" AS "implementationGrantExpiresAt",
         implementation_grant."authorityLevel" AS "implementationGrantAuthorityLevel",
         implementation_grant."grantedTo" AS "implementationGrantGrantedTo",
         implementation_grant.scope AS "implementationGrantScope",
         implementation_grant."allowedActions" AS "implementationGrantAllowedActions",
         implementation_grant."blockedActions" AS "implementationGrantBlockedActions",
         contract_queue."approvalDecisionId" AS "approvalDecisionId",
         contract_queue."authorityGrantRef" AS "executionGrantRef",
         (SELECT jsonb_build_object('id', runtime_checkpoint.id, 'metadata', runtime_checkpoint.metadata)
          FROM governance_event AS runtime_checkpoint
          WHERE runtime_checkpoint."userId" = contract_queue."userId"
            AND runtime_checkpoint."entityType" = 'work_order'
            AND runtime_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
            AND runtime_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
            AND runtime_checkpoint.metadata->>'checkpointState' = 'FAILED_TERMINAL'
          ORDER BY runtime_checkpoint."createdAt" DESC, runtime_checkpoint.id DESC
          LIMIT 1) AS "historicalRuntimeCheckpoint",
         (SELECT jsonb_build_object('id', goal_terminal.id, 'metadata', goal_terminal.metadata)
          FROM governance_event AS goal_terminal
          WHERE goal_terminal."userId" = contract_queue."userId"
            AND goal_terminal."entityType" = 'goal'
            AND goal_terminal."entityId"::text = contract_goal.id::text
            AND goal_terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
          ORDER BY goal_terminal."createdAt" DESC, goal_terminal.id DESC
          LIMIT 1) AS "historicalGoalTerminal",
         (SELECT jsonb_build_object('id', recovery_authorization.id, 'metadata', recovery_authorization.metadata)
          FROM governance_event AS recovery_authorization
          WHERE recovery_authorization."userId" = contract_queue."userId"
            AND recovery_authorization."entityType" = 'goal'
            AND recovery_authorization."entityId"::text = contract_goal.id::text
            AND recovery_authorization."eventType" = $20
            AND recovery_authorization.metadata->>'proofDigest' = $14
            AND recovery_authorization.metadata->>'prNumber' = ($15::integer)::text
            AND recovery_authorization.metadata->>'reviewedHeadSha' = $16
            AND recovery_authorization.metadata->>'mergeSha' = $17
          ORDER BY recovery_authorization.id
          LIMIT 1) AS "recoveryAuthorization"
         ,(SELECT jsonb_build_object('id', recovery_checkpoint.id, 'actor', recovery_checkpoint.actor,
            'metadata', recovery_checkpoint.metadata)
          FROM governance_event AS recovery_checkpoint
          WHERE recovery_checkpoint."userId" = contract_queue."userId"
            AND recovery_checkpoint."entityType" = 'work_order'
            AND recovery_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
            AND recovery_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
            AND recovery_checkpoint.metadata->>'checkpointState' = 'REVIEW_REMEDIATION_RECOVERED'
            AND recovery_checkpoint.metadata->>'reviewRecoveryProofDigest' = $14
          ORDER BY recovery_checkpoint.id
          LIMIT 1) AS "activeRecoveryCheckpoint"
         ,(SELECT jsonb_build_object('id', merged_checkpoint.id, 'actor', merged_checkpoint.actor,
            'metadata', merged_checkpoint.metadata)
          FROM governance_event AS merged_checkpoint
          WHERE merged_checkpoint."userId" = contract_queue."userId"
            AND merged_checkpoint."entityType" = 'work_order'
            AND merged_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
            AND merged_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
            AND merged_checkpoint.metadata->>'checkpointState' = 'PR_MERGED'
            AND merged_checkpoint.metadata->>'reviewRecoveryProofDigest' = $14
          ORDER BY merged_checkpoint.id
          LIMIT 1) AS "activeMergedCheckpoint"
	         ,COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', reclaim_event.id, 'actor', reclaim_event.actor, 'metadata', reclaim_event.metadata)
            ORDER BY reclaim_event.id)
          FROM governance_event AS reclaim_event
          WHERE reclaim_event."userId" = contract_queue."userId"
            AND reclaim_event."entityType" = 'goal'
            AND reclaim_event."entityId"::text = contract_goal.id::text
            AND reclaim_event."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERY_RECLAIMED'
            AND reclaim_event.metadata->>'prNumber' = ($15::integer)::text
            AND reclaim_event.metadata->>'reviewedHeadSha' = $16
	            AND reclaim_event.metadata->>'mergeSha' = $17), '[]'::jsonb) AS "activeRecoveryReclaims"
	         ,COALESCE((SELECT jsonb_agg(jsonb_build_object(
	            'id', acquisition_attempt.id,
	            'campaignWindowId', acquisition_attempt."campaignWindowId",
	            'processIdentity', acquisition_attempt."processIdentity",
	            'leaseHolder', acquisition_attempt."leaseHolder",
	            'acquisitionKeyDigest', acquisition_attempt."acquisitionKeyDigest",
	            'leaseIdentityDigest', acquisition_attempt."leaseIdentityDigest",
	            'checkpointDigest', acquisition_attempt."checkpointDigest",
	            'checkpointOutcomeId', acquisition_attempt."checkpointOutcomeId",
	            'checkpointSequence', acquisition_attempt."checkpointSequence",
	            'checkpointState', acquisition_attempt."checkpointState",
	            'checkpointHeadSha', acquisition_attempt."checkpointHeadSha",
	            'checkpointMergeSha', acquisition_attempt."checkpointMergeSha",
	            'checkpointPrNumber', acquisition_attempt."checkpointPrNumber",
	            'outcomeKey', acquisition_attempt."outcomeKey",
	            'fencingToken', acquisition_attempt."fencingToken",
	            'leaseExpiresAt', acquisition_attempt."leaseExpiresAt",
	            'activeWorkOrderId', acquisition_attempt."activeWorkOrderId",
	            'disposition', acquisition_attempt.disposition,
	            'reason', acquisition_attempt.reason,
	            'attemptedAt', acquisition_attempt."attemptedAt") ORDER BY acquisition_attempt.id)
	          FROM outcome_queue_acquisition_attempt AS acquisition_attempt
	          WHERE $29::boolean
	            AND acquisition_attempt."userId" = contract_queue."userId"
	            AND acquisition_attempt."outcomeKey" = contract_queue."outcomeKey"
	            AND acquisition_attempt."fencingToken" IN (
	              $24::integer + 3, $24::integer + CASE WHEN $31::boolean THEN 4 ELSE 3 END
	            )), '[]'::jsonb) AS "activeRecoveryAcquisitionAttempts"
       FROM goal AS contract_goal
       JOIN "outcome_queue_item" AS contract_queue
         ON contract_queue."userId" = contract_goal."userId"
        AND contract_queue."goalId" = contract_goal.id
       JOIN "outcome_queue_mutation_receipt" AS contract_receipt
        ON contract_receipt."userId" = contract_queue."userId"
        AND contract_receipt."outcomeKey" = contract_queue."outcomeKey"
       JOIN "outcome_queue_acquisition_receipt" AS contract_acquisition
         ON contract_acquisition."userId" = contract_queue."userId"
        AND contract_acquisition."outcomeKey" = contract_queue."outcomeKey"
        AND contract_acquisition."acquisitionKey" = contract_queue."acquisitionKey"
         AND ((NOT $23::boolean
           AND contract_acquisition."latestFencingToken" = contract_queue."fencingToken")
	          OR ($23::boolean
	           AND contract_acquisition."latestFencingToken" = CASE WHEN ($29::boolean OR $31::boolean)
	             THEN $8::integer ELSE $24::integer END))
       LEFT JOIN "workbench_thread_source" AS contract_root
         ON contract_root."userId" = contract_receipt."userId"
        AND contract_root."sourceType" = 'outcome'
        AND contract_root."sourceId" = contract_queue."outcomeKey"
        AND contract_root.role = 'root'
        AND contract_root."threadId" = contract_receipt."requestBinding"->>'threadId'
       LEFT JOIN "workbench_thread" AS contract_thread
         ON contract_thread."userId" = contract_root."userId"
        AND contract_thread.id = contract_root."threadId"
        AND contract_thread."projectId"::text = contract_receipt."requestBinding"->>'projectId'
       LEFT JOIN project AS contract_project
         ON contract_project."userId" = contract_thread."userId"
        AND contract_project.id = contract_thread."projectId"
        AND contract_project.lifecycle = 'active'
       LEFT JOIN project_resource AS contract_repo
         ON contract_repo."userId" = contract_project."userId"
        AND contract_repo."projectId" = contract_project.id
        AND contract_repo.type = 'repo'
        AND contract_repo.relationship = 'primary-repo'
        AND contract_repo."canonicalIdentity" = 'bsvalues/terragroq'
       LEFT JOIN authority_grant AS implementation_grant
         ON implementation_grant."userId" = contract_queue."userId"
        AND implementation_grant.ref = contract_receipt."resultBinding"->>'implementationGrantRef'
        AND implementation_grant.id::text = contract_receipt."resultBinding"->>'implementationGrantId'
       WHERE contract_goal.id = $1::integer
         AND contract_queue."userId" = $2
         AND contract_queue."outcomeKey" = $3
         AND contract_queue."executionBinding" = $5
         AND btrim(contract_queue."acquisitionKey") <> ''
         AND contract_queue."fencingToken" = $8::integer
         AND ((NOT $13::boolean AND NOT $23::boolean
           AND contract_queue."lifecycleState" = 'active'
           AND contract_queue.version = $4::integer
           AND contract_queue."leaseToken" = $6
           AND contract_queue."leaseHolder" = $7
           AND contract_queue."leaseExpiresAt" > clock_timestamp())
          OR ($23::boolean
           AND contract_queue."lifecycleState" = 'active'
           AND contract_queue."lifecycleReason" = CASE WHEN $29::boolean
             THEN 'STALE_LEASE_RECOVERED' WHEN $28::boolean
             THEN 'REVIEW_REMEDIATION_RECOVERY_RECLAIMED' ELSE 'REVIEW_REMEDIATION_RECOVERED' END
	           AND contract_queue.version = $25::integer + CASE WHEN $31::boolean THEN 4 WHEN $29::boolean THEN 3 WHEN $28::boolean THEN 2 ELSE 1 END
	           AND contract_queue."fencingToken" = $24::integer + CASE WHEN $31::boolean THEN 4 WHEN $29::boolean THEN 3 WHEN $28::boolean THEN 2 ELSE 1 END
           AND contract_queue."leaseToken" = $6
           AND contract_queue."leaseHolder" = $7
	           AND (NOT $29::boolean OR contract_queue."leaseExpiresAt" = CASE WHEN $31::boolean
	             THEN $32::timestamptz ELSE $30::timestamptz END)
           AND ($27::boolean OR contract_queue."leaseExpiresAt" > clock_timestamp()))
          OR ($13::boolean
           AND contract_queue."lifecycleState" = 'blocked'
           AND contract_queue."lifecycleReason" = $19
           AND contract_queue.version = $4::integer + 1
           AND contract_queue."leaseToken" IS NULL
           AND contract_queue."leaseHolder" IS NULL
           AND contract_queue."leaseExpiresAt" IS NULL
           AND contract_queue."acquisitionKey" = $12))
         AND contract_queue."approvalState" = 'approved'
         AND EXISTS (
           SELECT 1 FROM decision AS contract_approval
           WHERE contract_approval.id = contract_queue."approvalDecisionId"
             AND contract_approval."userId" = contract_queue."userId"
             AND contract_approval.status = 'accepted'
             AND contract_approval.authority = 'binding'
             AND upper(trim(contract_approval.decision)) = 'APPROVE'
             AND contract_approval.scope = contract_queue."outcomeKey"
         )
         AND contract_queue."authorityState" = 'matched'
         AND contract_queue."authorityLevel" = 'A2_WRITE_OWN'
         AND contract_queue."authoritySubject" = 'operator'
         AND contract_queue."authorityAction" = 'outcome:execute'
         AND EXISTS (
           SELECT 1 FROM authority_grant AS contract_grant
           WHERE contract_grant."userId" = contract_queue."userId"
             AND contract_grant.ref = contract_queue."authorityGrantRef"
             AND contract_grant."revokedAt" IS NULL
             AND contract_grant."expiresAt" IS NOT NULL
             AND ((NOT $13::boolean
               AND contract_grant.status = 'active'
               AND contract_grant."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp())
              OR ($13::boolean
               AND contract_grant.status IN ('active', 'expired')
               AND contract_grant."expiresAt" AT TIME ZONE 'UTC' > contract_receipt."createdAt"))
             AND contract_grant."authorityLevel" = 'A2_WRITE_OWN'
             AND contract_grant."grantedTo" = 'operator'
             AND contract_grant.scope = contract_queue."outcomeKey"
             AND cardinality(contract_grant."allowedActions") = 1
             AND contract_grant."allowedActions"[1] = 'outcome:execute'
             AND NOT EXISTS (
               SELECT 1 FROM unnest(contract_grant."blockedActions") AS blocked(action)
               WHERE position(lower(blocked.action) IN lower(contract_queue."authorityAction")) > 0
             )
             AND (contract_grant."workOrderId" IS NULL
               OR contract_grant."workOrderId" = contract_queue."activeWorkOrderId")
         )
         AND ((contract_receipt.operation = 'workbench_execution.authorize'
           AND contract_receipt."requestBinding"->>'confirmation' = 'START_WORK'
           AND contract_receipt."requestBinding"->>'outcomeKey' = contract_queue."outcomeKey"
           AND contract_root."threadId" IS NOT NULL)
          OR (contract_receipt.operation = 'runtime_finding.derive'
           AND contract_receipt."requestBinding"->>'operation' = 'runtime_finding.derive'
           AND contract_receipt."resultBinding"->>'outcomeKey' = contract_queue."outcomeKey"
           AND contract_receipt."resultBinding"->>'goalId' = contract_goal.id::text
           AND contract_receipt."resultBinding"->>'workOrderId' = contract_queue."activeWorkOrderId"::text))
         AND contract_receipt."resultBinding"->>'grantRef' = contract_queue."authorityGrantRef"
         AND contract_receipt."resultBinding"->>'decisionId' = contract_queue."approvalDecisionId"::text
         AND contract_receipt."resultBinding"->'workContract'->>'id' = $9
         AND contract_receipt."resultBinding"->'workContract'->>'digest' = $10
         AND contract_receipt."resultBinding"->'workContract'->>'version' = $11
         AND contract_receipt."resultBinding"->'workContract'->>'repository' = 'bsvalues/terragroq'
         AND contract_receipt."resultBinding"->'workContract'->>'lane' = contract_goal.lane
         AND (contract_receipt."resultBinding"->'workContract'->'delivery' IS NULL OR (
           implementation_grant."revokedAt" IS NULL
           AND implementation_grant."expiresAt" IS NOT NULL
           AND ((NOT $13::boolean
             AND implementation_grant.status = 'active'
             AND implementation_grant."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp())
            OR ($13::boolean
             AND implementation_grant.status IN ('active', 'expired')
             AND implementation_grant."expiresAt" AT TIME ZONE 'UTC' > contract_receipt."createdAt"))
           AND implementation_grant."authorityLevel" = contract_receipt."resultBinding"->'workContract'->'delivery'->>'authorityLevel'
           AND implementation_grant."grantedTo" = 'operator'
           AND implementation_grant.scope = CASE WHEN contract_receipt.operation = 'runtime_finding.derive'
             THEN contract_receipt."resultBinding"->>'workOrderRef'
             ELSE 'WO-HERMES-OUTCOME-' || contract_goal.id::text END
           AND implementation_grant."allowedActions" = ARRAY['implement']::text[]
           AND NOT ('implement' = ANY(COALESCE(implementation_grant."blockedActions", ARRAY[]::text[])))
         ))
         AND (contract_receipt.operation = 'runtime_finding.derive' OR (
           SELECT count(*) = 1
           FROM "workbench_thread_source" AS duplicate_contract_root
           WHERE duplicate_contract_root."userId" = contract_queue."userId"
             AND duplicate_contract_root."sourceType" = 'outcome'
             AND duplicate_contract_root."sourceId" = contract_queue."outcomeKey"
             AND duplicate_contract_root.role = 'root'
         ))
         AND (contract_receipt.operation = 'runtime_finding.derive' OR (
           SELECT count(*) = 1
           FROM project_resource AS duplicate_primary_repo
           WHERE duplicate_primary_repo."userId" = contract_project."userId"
             AND duplicate_primary_repo."projectId" = contract_project.id
             AND duplicate_primary_repo.type = 'repo'
             AND duplicate_primary_repo.relationship = 'primary-repo'
         ))
         AND (NOT ($13::boolean OR $23::boolean) OR EXISTS (
           SELECT 1
           FROM governance_event AS latest_terminal
           WHERE latest_terminal."userId" = contract_queue."userId"
             AND latest_terminal."entityType" = 'goal'
             AND latest_terminal."entityId"::text = contract_goal.id::text
             AND latest_terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
             AND latest_terminal.metadata->>'result' = 'FAILED_TERMINAL'
             AND latest_terminal.metadata->>'nextState' = $19
             AND latest_terminal.id = (
               SELECT terminal_candidate.id
               FROM governance_event AS terminal_candidate
               WHERE terminal_candidate."userId" = contract_queue."userId"
                 AND terminal_candidate."entityType" = 'goal'
                 AND terminal_candidate."entityId"::text = contract_goal.id::text
                 AND terminal_candidate."eventType" = 'HERMES_OUTCOME_TERMINAL'
               ORDER BY terminal_candidate."createdAt" DESC, terminal_candidate.id DESC
               LIMIT 1
             )
         ))
         AND (NOT $23::boolean OR (
           SELECT count(*) = 1
           FROM governance_event AS exact_recovery_authorization
           WHERE exact_recovery_authorization."userId" = contract_queue."userId"
             AND exact_recovery_authorization."entityType" = 'goal'
             AND exact_recovery_authorization."entityId"::text = contract_goal.id::text
             AND exact_recovery_authorization."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERY_AUTHORIZED'
             AND exact_recovery_authorization.actor = 'hermes-codex-bridge'
             AND exact_recovery_authorization.metadata->>'recoveryKind' = 'review-remediation'
             AND exact_recovery_authorization.metadata->>'executionBinding' = contract_queue."executionBinding"
             AND exact_recovery_authorization.metadata->>'acquisitionKey' = contract_queue."acquisitionKey"
             AND exact_recovery_authorization.metadata->>'fencingToken' = ($24::integer)::text
             AND exact_recovery_authorization.metadata->>'runtimeAttempt' = ($26::integer)::text
             AND exact_recovery_authorization.metadata->>'proofDigest' = $14
             AND exact_recovery_authorization.metadata->>'prNumber' = ($15::integer)::text
             AND exact_recovery_authorization.metadata->>'reviewedHeadSha' = $16
             AND exact_recovery_authorization.metadata->>'mergeSha' = $17
         ))
         AND (NOT $23::boolean OR (
           SELECT count(*) = 1
           FROM governance_event AS semantic_recovered
           WHERE semantic_recovered."userId" = contract_queue."userId"
             AND semantic_recovered."entityType" = 'goal'
             AND semantic_recovered."entityId"::text = contract_goal.id::text
             AND semantic_recovered."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERED'
             AND semantic_recovered.metadata->>'prNumber' = ($15::integer)::text
             AND semantic_recovered.metadata->>'reviewedHeadSha' = $16
             AND semantic_recovered.metadata->>'mergeSha' = $17
         ))
         AND (NOT $23::boolean OR (
           SELECT count(*) = 1
           FROM governance_event AS semantic_confirmation
           WHERE semantic_confirmation."userId" = contract_queue."userId"
             AND semantic_confirmation."entityType" = 'goal'
             AND semantic_confirmation."entityId"::text = contract_goal.id::text
             AND semantic_confirmation."eventType" = 'HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_CONFIRMED'
             AND semantic_confirmation.metadata->>'prNumber' = ($15::integer)::text
             AND semantic_confirmation.metadata->>'reviewedHeadSha' = $16
             AND semantic_confirmation.metadata->>'mergeSha' = $17
         ))
         AND (NOT $13::boolean OR (
           SELECT count(*) = 1
           FROM governance_event AS recovery_authorization
           WHERE recovery_authorization."userId" = contract_queue."userId"
             AND recovery_authorization."entityType" = 'goal'
             AND recovery_authorization."entityId"::text = contract_goal.id::text
             AND recovery_authorization."eventType" = $20
             AND recovery_authorization.actor = 'hermes-codex-bridge'
             AND recovery_authorization.metadata->>'recoveryKind' = CASE
               WHEN $18 = 'POST_MERGE_CLEANUP_RECOVERED' THEN 'terminal-cleanup'
               ELSE 'review-remediation' END
             AND recovery_authorization.metadata->>'outcomeId' = contract_goal.id::text
             AND recovery_authorization.metadata->>'userId' = contract_queue."userId"
             AND recovery_authorization.metadata->>'outcomeKey' = contract_queue."outcomeKey"
             AND recovery_authorization.metadata->>'workOrderId' = contract_queue."activeWorkOrderId"::text
             AND recovery_authorization.metadata->>'workOrderRef' = 'WO-HERMES-OUTCOME-' || contract_goal.id::text
             AND recovery_authorization.metadata->>'terminalEventId' = (
               SELECT terminal_candidate.id::text
               FROM governance_event AS terminal_candidate
               WHERE terminal_candidate."userId" = contract_queue."userId"
                 AND terminal_candidate."entityType" = 'goal'
                 AND terminal_candidate."entityId"::text = contract_goal.id::text
                 AND terminal_candidate."eventType" = 'HERMES_OUTCOME_TERMINAL'
               ORDER BY terminal_candidate."createdAt" DESC, terminal_candidate.id DESC
               LIMIT 1
             )
             AND recovery_authorization.metadata->>'executionBinding' = contract_queue."executionBinding"
             AND recovery_authorization.metadata->>'acquisitionKey' = contract_queue."acquisitionKey"
             AND recovery_authorization.metadata->>'fencingToken' = (CASE WHEN $23::boolean
               THEN $24::integer ELSE contract_queue."fencingToken" END)::text
             AND recovery_authorization.metadata->>'executionEpochDigest' = $21
             AND recovery_authorization.metadata->>'runtimeAttempt' = (CASE WHEN $23::boolean
               THEN $26::integer ELSE $22::integer END)::text
             AND recovery_authorization.metadata->>'runtimeCheckpointEventId' = (
               SELECT runtime_checkpoint.id::text
               FROM governance_event AS runtime_checkpoint
               WHERE runtime_checkpoint."userId" = contract_queue."userId"
                 AND runtime_checkpoint."entityType" = 'work_order'
                 AND runtime_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
                 AND runtime_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                 AND runtime_checkpoint.metadata->>'checkpointState' = 'FAILED_TERMINAL'
               ORDER BY runtime_checkpoint."createdAt" DESC, runtime_checkpoint.id DESC
               LIMIT 1
             )
             AND recovery_authorization.metadata->>'runtimeCheckpointPayloadDigest' = (
               SELECT runtime_checkpoint.metadata->>'payloadDigest'
               FROM governance_event AS runtime_checkpoint
               WHERE runtime_checkpoint."userId" = contract_queue."userId"
                 AND runtime_checkpoint."entityType" = 'work_order'
                 AND runtime_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
                 AND runtime_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                 AND runtime_checkpoint.metadata->>'checkpointState' = 'FAILED_TERMINAL'
               ORDER BY runtime_checkpoint."createdAt" DESC, runtime_checkpoint.id DESC
               LIMIT 1
             )
             AND recovery_authorization.metadata->>'proofDigest' = $14
             AND recovery_authorization.metadata->>'prNumber' = ($15::integer)::text
             AND recovery_authorization.metadata->>'reviewedHeadSha' = $16
             AND recovery_authorization.metadata->>'mergeSha' = $17
             AND recovery_authorization.id > (
               SELECT terminal_candidate.id
               FROM governance_event AS terminal_candidate
               WHERE terminal_candidate."userId" = contract_queue."userId"
                 AND terminal_candidate."entityType" = 'goal'
                 AND terminal_candidate."entityId"::text = contract_goal.id::text
                 AND terminal_candidate."eventType" = 'HERMES_OUTCOME_TERMINAL'
               ORDER BY terminal_candidate."createdAt" DESC, terminal_candidate.id DESC
               LIMIT 1
             )
         ))
         AND (($18 <> 'REVIEW_REMEDIATION_RECOVERED' AND NOT $23::boolean) OR (
           SELECT count(*) = 1
           FROM governance_event AS recovery_authorization
           JOIN governance_event AS recovered
             ON recovered."userId" = recovery_authorization."userId"
            AND recovered."entityType" = 'goal'
            AND recovered."entityId" = recovery_authorization."entityId"
            AND recovered."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERED'
            AND recovered.actor = 'hermes-codex-bridge'
            AND recovered.metadata->>'proofDigest' = recovery_authorization.metadata->>'proofDigest'
            AND recovered.metadata->>'prNumber' = recovery_authorization.metadata->>'prNumber'
            AND recovered.metadata->>'reviewedHeadSha' = recovery_authorization.metadata->>'reviewedHeadSha'
            AND recovered.metadata->>'mergeSha' = recovery_authorization.metadata->>'mergeSha'
            AND recovered.id > recovery_authorization.id
            AND recovered.metadata = jsonb_build_object(
              'idempotencyKey', 'hermes-outcome:' || contract_goal.id::text || ':review-recovery:pr:' || ($15::integer)::text
                || ':head:' || $16 || ':merge:' || $17,
              'workOrderRef', 'WO-HERMES-OUTCOME-' || contract_goal.id::text,
              'prNumber', $15::integer, 'reviewedHeadSha', $16, 'mergeSha', $17, 'proofDigest', $14)
           JOIN governance_event AS merged_checkpoint
             ON merged_checkpoint."userId" = recovered."userId"
            AND merged_checkpoint."entityType" = 'work_order'
            AND merged_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
            AND merged_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
            AND merged_checkpoint.actor = 'hermes-codex-bridge'
            AND merged_checkpoint.metadata->>'checkpointState' = 'PR_MERGED'
            AND merged_checkpoint.metadata->>'reviewRecoveryProofDigest' = recovered.metadata->>'proofDigest'
            AND merged_checkpoint.metadata->>'prNumber' = recovered.metadata->>'prNumber'
            AND merged_checkpoint.metadata->>'headRefOid' = recovered.metadata->>'reviewedHeadSha'
            AND merged_checkpoint.metadata->>'mergeSha' = recovered.metadata->>'mergeSha'
            AND merged_checkpoint.id > recovery_authorization.id
            AND merged_checkpoint.id < recovered.id
           JOIN governance_event AS recovery_confirmation
             ON recovery_confirmation."userId" = recovered."userId"
            AND recovery_confirmation."entityType" = 'goal'
            AND recovery_confirmation."entityId" = recovered."entityId"
            AND recovery_confirmation."eventType" = 'HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_CONFIRMED'
            AND recovery_confirmation.actor = 'hermes-codex-bridge'
            AND recovery_confirmation.metadata->>'proofDigest' = recovered.metadata->>'proofDigest'
            AND recovery_confirmation.metadata->>'prNumber' = recovered.metadata->>'prNumber'
            AND recovery_confirmation.metadata->>'reviewedHeadSha' = recovered.metadata->>'reviewedHeadSha'
            AND recovery_confirmation.metadata->>'mergeSha' = recovered.metadata->>'mergeSha'
            AND recovery_confirmation.id > recovered.id
            AND recovery_confirmation.metadata = jsonb_build_object(
              'idempotencyKey', 'hermes-outcome:' || contract_goal.id::text || ':review-recovery:pr:' || ($15::integer)::text
                || ':head:' || $16 || ':merge:' || $17 || ':queue-proof:' || $14,
              'recoveryIdempotencyKey', 'hermes-outcome:' || contract_goal.id::text || ':review-recovery:pr:' || ($15::integer)::text
                || ':head:' || $16 || ':merge:' || $17,
              'workOrderRef', 'WO-HERMES-OUTCOME-' || contract_goal.id::text,
              'prNumber', $15::integer, 'reviewedHeadSha', $16, 'mergeSha', $17, 'proofDigest', $14)
           JOIN governance_event AS persisted_recovery_checkpoint
             ON persisted_recovery_checkpoint."userId" = recovered."userId"
            AND persisted_recovery_checkpoint."entityType" = 'work_order'
            AND persisted_recovery_checkpoint."entityId"::text = contract_queue."activeWorkOrderId"::text
            AND persisted_recovery_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
            AND persisted_recovery_checkpoint.actor = 'hermes-codex-bridge'
            AND persisted_recovery_checkpoint.metadata->>'checkpointState' = 'REVIEW_REMEDIATION_RECOVERED'
            AND persisted_recovery_checkpoint.metadata->>'checkpointDetail' = 'REVIEW_REMEDIATION_EXHAUSTED'
            AND persisted_recovery_checkpoint.metadata->>'reviewRecoveryProofDigest' = recovered.metadata->>'proofDigest'
            AND persisted_recovery_checkpoint.metadata->>'prNumber' = recovered.metadata->>'prNumber'
            AND persisted_recovery_checkpoint.metadata->>'headRefOid' = recovered.metadata->>'reviewedHeadSha'
            AND persisted_recovery_checkpoint.metadata->>'mergeSha' = recovered.metadata->>'mergeSha'
            AND persisted_recovery_checkpoint.id > recovery_confirmation.id
           WHERE recovery_authorization."userId" = contract_queue."userId"
             AND recovery_authorization."entityType" = 'goal'
             AND recovery_authorization."entityId"::text = contract_goal.id::text
             AND recovery_authorization."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERY_AUTHORIZED'
             AND recovery_confirmation."entityType" = 'goal'
             AND recovery_confirmation.metadata->>'proofDigest' = $14
             AND recovery_confirmation.metadata->>'prNumber' = ($15::integer)::text
             AND recovery_confirmation.metadata->>'reviewedHeadSha' = $16
             AND recovery_confirmation.metadata->>'mergeSha' = $17
         ))
       ORDER BY contract_receipt.id
       LIMIT 2
       FOR UPDATE OF contract_goal, contract_queue`,
      [outcomeId, normalizedExecutionBinding.userId, normalizedExecutionBinding.outcomeKey,
        normalizedExecutionBinding.expectedVersion, normalizedExecutionBinding.executionBinding,
        normalizedExecutionBinding.leaseToken, normalizedExecutionBinding.leaseHolder,
        normalizedExecutionBinding.fencingToken,
        normalizedWorkContract.id,
        normalizedWorkContract.digest,
        normalizedWorkContract.version,
        normalizedExecutionBinding.acquisitionKey ?? null,
        historicalRecovery,
        historicalRecoveryProofDigest ?? null,
        evidence.prNumber ?? null,
        evidence.headRefOid ?? null,
        evidence.mergeSha ?? null,
        checkpoint.state,
        checkpoint.state === "POST_MERGE_CLEANUP_RECOVERED"
          ? "POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED"
          : "REVIEW_REMEDIATION_EXHAUSTED",
        checkpoint.state === "POST_MERGE_CLEANUP_RECOVERED"
          ? "HERMES_OUTCOME_TERMINAL_CLEANUP_RECOVERY_AUTHORIZED"
          : "HERMES_OUTCOME_REVIEW_RECOVERY_AUTHORIZED",
        executionEpochDigest(normalizedExecutionBinding), attempt,
        activeReviewRecovery,
        normalizedExecutionBinding.reviewRecoverySourceFencingToken ?? null,
        normalizedExecutionBinding.reviewRecoverySourceExpectedVersion ?? null,
        normalizedExecutionBinding.reviewRecoverySourceRuntimeAttempt ?? null,
        activeReviewRecoveryProvenanceOnly,
         reclaimedActiveReviewRecovery,
         Boolean(normalizedExecutionBinding.reviewRecoveryStaleReacquisition),
	         normalizedExecutionBinding.reviewRecoveryStaleReacquisition?.leaseExpiresAt ?? null,
	         Boolean(normalizedExecutionBinding.reviewRecoveryStaleContinuation),
	         normalizedExecutionBinding.reviewRecoveryStaleContinuation?.leaseExpiresAt ?? null],
    )
    if (authorizations?.rows?.length !== 1
      || !exactAuthorizationContract(
        authorizations.rows[0], normalizedWorkContract, normalizedExecutionBinding, outcomeId,
        historicalRecovery, checkpoint.state, activeReviewRecovery,
      )
      || (historicalRecovery && !exactHistoricalRecoveryAuthorization(
        authorizations.rows[0], normalizedExecutionBinding, outcomeId, checkpoint.state,
        attempt, historicalRecoveryProofDigest, evidence,
      ))) {
      throw Object.assign(new Error("Canonical Workbench execution authorization is invalid"), {
        code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
      })
    }
    if (activeReviewRecovery) {
      const sourceBinding = {
        ...normalizedExecutionBinding,
        expectedVersion: normalizedExecutionBinding.reviewRecoverySourceExpectedVersion,
        fencingToken: normalizedExecutionBinding.reviewRecoverySourceFencingToken,
      }
      if (!exactHistoricalRecoveryAuthorization(
        authorizations.rows[0], sourceBinding, outcomeId, "REVIEW_REMEDIATION_RECOVERED",
        normalizedExecutionBinding.reviewRecoverySourceRuntimeAttempt,
        historicalRecoveryProofDigest, evidence,
      ) || !exactActiveReviewRecoveryCheckpoints(
        authorizations.rows[0], normalizedExecutionBinding, outcomeId,
        historicalRecoveryProofDigest, evidence,
      ) || !exactActiveReviewRecoveryReclaim(
        authorizations.rows[0], normalizedExecutionBinding, outcomeId,
        historicalRecoveryProofDigest, evidence,
      ) || !exactActiveReviewRecoveryAcquisitionHops(
        authorizations.rows[0], normalizedExecutionBinding, outcomeId,
      )) {
        throw Object.assign(new Error("Active review recovery authorization is invalid"), {
          code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
        })
      }
    }
    if (authorizationOnly) {
      await runQuery("COMMIT")
      return true
    }
    const authorization = authorizations.rows[0]
    if (authorization.receiptOperation === "runtime_finding.derive") {
      if (typeof authorization.derivedWorkOrderRef !== "string"
        || authorization.derivedWorkOrderRef.trim() === "") {
        throw Object.assign(new Error("Derived Work Order identity is absent"), {
          code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
        })
      }
      ref = authorization.derivedWorkOrderRef
      await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [ref])
    }
    const currentExecutionEpochDigest = executionEpochDigest(authorization)
    const legacyEventMetadata = {
      idempotencyKey,
      outcomeId,
      workOrderRef: ref,
      attempt,
      checkpointSequence: checkpoint.sequence,
      checkpointState: checkpoint.state,
      checkpointDetail: checkpoint.detail ?? null,
      ...evidence,
    }
    const eventMetadata = {
      ...legacyEventMetadata,
      ...(normalizedWorkContract.structuredBinding ? {
        executionBinding: authorization.executionBinding,
        acquisitionKey: authorization.acquisitionKey,
        acquisitionFencingToken: Number(authorization.fencingToken),
      } : {}),
      executionEpochDigest: currentExecutionEpochDigest,
      findingsSetDigest,
      ...(normalizedWorkContract.structuredBinding ? {
        workContractId: normalizedWorkContract.id,
        workContractDigest: normalizedWorkContract.digest,
        workContractVersion: normalizedWorkContract.version,
        workContractRepository: normalizedWorkContract.repository,
        workContractLane: authorization.goalLane,
        authorizationDecisionId: authorization.approvalDecisionId,
        executionGrantRef: authorization.executionGrantRef,
      } : {}),
      ...(normalizedWorkContract.structuredBinding && authorization.implementationGrantRef != null ? {
        implementationGrantId: Number(authorization.implementationGrantId),
        implementationGrantRef: authorization.implementationGrantRef,
      } : {}),
      ...(normalizedWorkContract.projection === undefined ? {} : {
        projectionIssueNumber: normalizedWorkContract.projection.issueNumber,
        projectionCompletionOwned: normalizedWorkContract.projection.completionOwned,
      }),
      ...(normalizedWorkContract.delivery === undefined ? {} : {
        deliveryAuthorityLevel: normalizedWorkContract.delivery.authorityLevel,
        deliveryAllowedActions: normalizedWorkContract.delivery.allowedActions,
        commitAllowed: normalizedWorkContract.delivery.commitAllowed,
        tagAllowed: normalizedWorkContract.delivery.tagAllowed,
        pushAllowed: normalizedWorkContract.delivery.pushAllowed,
      }),
    }
    eventMetadata.payloadDigest = projectionPayloadDigest(eventMetadata)
    const legacyPayloadDigest = projectionPayloadDigest(legacyEventMetadata)
    let acceptedPayloadDigest = eventMetadata.payloadDigest
    await runQuery(
      `INSERT INTO work_order
         ("userId", ref, title, description, goal, lane, status, assignee, agent,
           "allowedFiles", validators, "authorityGrantId", "authorityLevel", "authorityGranted",
           "commitAllowed", "tagAllowed", "pushAllowed", "updatedAt")
       SELECT g."userId", $2, COALESCE(NULLIF(g.command, ''), 'Hermes outcome ' || g.id::text),
         'Durable runtime projection for ' || COALESCE(g.ref, 'goal-' || g.id::text)
           || CASE WHEN $5::integer IS NULL THEN '' ELSE '. Projected at GitHub issue ' || $5::text || '.' END
           || CASE WHEN $6::boolean = false THEN ' Projection completion: parent-owned.' ELSE '' END,
         g.ref, g.lane, 'active', 'hermes-codex-bridge', 'codex', $3::text[], $4::text[],
         $7::integer, $8, $8, $9::boolean, $10::boolean, $11::boolean, NOW()
       FROM goal g
       WHERE g.id = $1::integer
         AND NOT EXISTS (
           SELECT 1 FROM work_order existing
           WHERE existing."userId" = g."userId" AND existing.ref = $2
         )
       RETURNING id`,
      [outcomeId, ref, normalizedWorkContract.allowedFiles, normalizedWorkContract.validators,
        normalizedWorkContract.projection?.issueNumber ?? null,
        normalizedWorkContract.projection?.completionOwned ?? null,
        authorization.implementationGrantId == null ? null : Number(authorization.implementationGrantId),
        normalizedWorkContract.delivery?.authorityLevel ?? null,
        normalizedWorkContract.delivery?.commitAllowed ?? false,
        normalizedWorkContract.delivery?.tagAllowed ?? false,
        normalizedWorkContract.delivery?.pushAllowed ?? false],
    )
    const workOrders = await runQuery(
      `SELECT wo.id, wo."userId" AS "userId", wo.ref, wo.goal, wo.lane, wo.status,
         wo.result, wo."commitRef", wo.assignee, wo.agent, wo."allowedFiles", wo.validators,
         wo."authorityGrantId", wo."authorityLevel", wo."authorityGranted",
         wo."commitAllowed", wo."tagAllowed", wo."pushAllowed",
         latest.id AS "latestCheckpointId",
         latest.metadata AS "latestCheckpointMetadata",
         latest.metadata->>'checkpointState' AS "latestCheckpointState",
         latest.metadata->>'idempotencyKey' AS "latestCheckpointKey",
         latest.metadata->>'payloadDigest' AS "latestCheckpointDigest",
         latest.metadata->>'checkpointSequence' AS "latestCheckpointSequence",
         latest.metadata->>'executionEpochDigest' AS "latestExecutionEpochDigest",
         latest."createdAt" AS "latestCheckpointCreatedAt",
         epoch_latest.metadata->>'checkpointSequence' AS "latestExecutionEpochSequence"
       FROM work_order wo
       JOIN goal g ON g."userId" = wo."userId"
       LEFT JOIN LATERAL (
         SELECT prior.id, prior.metadata, prior."createdAt"
         FROM governance_event AS prior
         WHERE prior."userId" = wo."userId"
           AND prior."entityType" = 'work_order'
           AND prior."entityId"::text = wo.id::text
           AND prior."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
         ORDER BY prior.id DESC
         LIMIT 1
       ) AS latest ON true
       LEFT JOIN LATERAL (
         SELECT prior.metadata
         FROM governance_event AS prior
         WHERE prior."userId" = wo."userId"
           AND prior."entityType" = 'work_order'
           AND prior."entityId"::text = wo.id::text
           AND prior."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND prior.metadata->>'executionEpochDigest' = $3
         ORDER BY (prior.metadata->>'checkpointSequence')::integer DESC, prior.id DESC
         LIMIT 1
       ) AS epoch_latest ON true
       WHERE g.id = $1::integer AND wo.ref = $2
       ORDER BY wo.id
       FOR UPDATE OF wo`,
      [outcomeId, ref, currentExecutionEpochDigest],
    )
    if (workOrders?.rows?.length !== 1) {
      throw Object.assign(new Error("Hermes outcome Work Order cardinality is invalid"), {
        code: "OUTCOME_WORK_ORDER_CARDINALITY_WALL",
      })
    }
    const workOrder = workOrders.rows[0]
    const latestExecutionEpochSequence = Number(workOrder.latestExecutionEpochSequence)
    const staleSameEpochCheckpoint = Number.isSafeInteger(latestExecutionEpochSequence)
      && latestExecutionEpochSequence > checkpoint.sequence
    const expectedPersistedStatus = workOrder.latestCheckpointState == null
      ? "active"
      : projectionForCheckpoint(workOrder.latestCheckpointState).status
    const legacyCheckpointIsInCurrentEpoch = Number.isFinite(Date.parse(workOrder.latestCheckpointCreatedAt))
      && Number.isFinite(Date.parse(authorization.executionEpochStartedAt))
      && Date.parse(workOrder.latestCheckpointCreatedAt) >= Date.parse(authorization.executionEpochStartedAt)
    const exactLegacyReplay = normalizedFindings.length === 0 && legacyCheckpointIsInCurrentEpoch
      && workOrder.latestCheckpointKey === idempotencyKey
      && workOrder.latestCheckpointDigest === legacyPayloadDigest
    const exactCurrentReplay = workOrder.latestCheckpointKey === idempotencyKey
      && workOrder.latestCheckpointDigest === eventMetadata.payloadDigest
    const persistedLegacyAttempt = Number(workOrder.latestCheckpointMetadata?.attempt)
    const crossAttemptLegacyMetadata = Number.isSafeInteger(persistedLegacyAttempt)
      && persistedLegacyAttempt > 0
      && persistedLegacyAttempt !== attempt
      ? {
          idempotencyKey: `hermes-outcome:${outcomeId}:attempt:${persistedLegacyAttempt}:checkpoint:${checkpoint.sequence}`,
          outcomeId,
          workOrderRef: ref,
          attempt: persistedLegacyAttempt,
          checkpointSequence: checkpoint.sequence,
          checkpointState: checkpoint.state,
          checkpointDetail: checkpoint.detail ?? null,
          ...evidence,
        }
      : null
    const crossAttemptLegacyDigest = crossAttemptLegacyMetadata
      ? projectionPayloadDigest(crossAttemptLegacyMetadata)
      : null
    const exactCrossAttemptLegacyReplay = normalizedFindings.length === 0
      && crossAttemptLegacyMetadata !== null
      && legacyCheckpointIsInCurrentEpoch
      && Number.isSafeInteger(Number(workOrder.latestCheckpointId))
      && Number(workOrder.latestCheckpointId) > 0
      && workOrder.latestExecutionEpochDigest == null
      && workOrder.latestCheckpointKey === crossAttemptLegacyMetadata.idempotencyKey
      && workOrder.latestCheckpointDigest === crossAttemptLegacyDigest
      && Number(workOrder.latestCheckpointSequence) === checkpoint.sequence
      && canonicalJson(workOrder.latestCheckpointMetadata) === canonicalJson({
        ...crossAttemptLegacyMetadata,
        payloadDigest: crossAttemptLegacyDigest,
      })
    const repairableReplayStatusSplit = (exactLegacyReplay || exactCurrentReplay)
      && workOrder.status !== expectedPersistedStatus
    const repairableCrossAttemptStatusSplit = exactCrossAttemptLegacyReplay
      && workOrder.status !== expectedPersistedStatus
    const deliveryIdentityMatches = normalizedWorkContract.delivery === undefined || (
      Number(workOrder.authorityGrantId) === Number(authorization.implementationGrantId)
      && workOrder.authorityLevel === normalizedWorkContract.delivery.authorityLevel
      && workOrder.authorityGranted === normalizedWorkContract.delivery.authorityLevel
      && workOrder.commitAllowed === normalizedWorkContract.delivery.commitAllowed
      && workOrder.tagAllowed === normalizedWorkContract.delivery.tagAllowed
      && workOrder.pushAllowed === normalizedWorkContract.delivery.pushAllowed
    )
    const deliveryBackfillable = normalizedWorkContract.delivery !== undefined
      && workOrder.authorityGrantId == null && workOrder.authorityLevel == null
      && workOrder.authorityGranted == null
    const workOrderIdentityMatches = workOrder.userId === authorization.userId
      && workOrder.ref === ref
      && workOrder.goal === authorization.goalRef
      && workOrder.lane === authorization.goalLane
      && (workOrder.status === expectedPersistedStatus
        || (authorization.receiptOperation === "runtime_finding.derive"
          && workOrder.status === "approved" && workOrder.latestCheckpointId == null)
        || repairableReplayStatusSplit
        || repairableCrossAttemptStatusSplit)
      && workOrder.assignee === "hermes-codex-bridge"
      && workOrder.agent === "codex"
      && (deliveryIdentityMatches || deliveryBackfillable)
      && (authorization.activeWorkOrderId === null
        || Number(authorization.activeWorkOrderId) === Number(workOrder.id))
    if (!workOrderIdentityMatches) {
      throw Object.assign(new Error("Hermes outcome Work Order identity conflicts"), {
        code: "OUTCOME_WORK_ORDER_IDENTITY_WALL",
      })
    }
    const contractMatches = exactStringArray(
      workOrder.allowedFiles,
      normalizedWorkContract.allowedFiles,
    ) && exactStringArray(workOrder.validators, normalizedWorkContract.validators)
    if (!contractMatches || !deliveryIdentityMatches) {
      const contractEmpty = Array.isArray(workOrder.allowedFiles) && workOrder.allowedFiles.length === 0
        && Array.isArray(workOrder.validators) && workOrder.validators.length === 0
      if (!contractEmpty && !(contractMatches && deliveryBackfillable)) {
        throw Object.assign(new Error("Hermes outcome Work Order contract conflicts"), {
          code: "OUTCOME_WORK_ORDER_CONTRACT_WALL",
        })
      }
      const backfilled = await runQuery(
        `UPDATE work_order
         SET "allowedFiles" = $3::text[], validators = $4::text[],
             "authorityGrantId" = COALESCE("authorityGrantId", $5::integer),
             "authorityLevel" = COALESCE("authorityLevel", $6),
             "authorityGranted" = COALESCE("authorityGranted", $6),
             "commitAllowed" = $7::boolean, "tagAllowed" = $8::boolean,
             "pushAllowed" = $9::boolean, "updatedAt" = NOW()
         WHERE id = $1 AND "userId" = $2
           AND ((cardinality(COALESCE("allowedFiles", ARRAY[]::text[])) = 0
             AND cardinality(COALESCE(validators, ARRAY[]::text[])) = 0)
             OR ("allowedFiles" = $3::text[] AND validators = $4::text[]))
           AND ("authorityGrantId" IS NULL OR "authorityGrantId" = $5::integer)
           AND ("authorityLevel" IS NULL OR "authorityLevel" = $6)
           AND ("authorityGranted" IS NULL OR "authorityGranted" = $6)
         RETURNING "allowedFiles", validators, "authorityGrantId", "authorityLevel", "authorityGranted",
           "commitAllowed", "tagAllowed", "pushAllowed"`,
        [workOrder.id, workOrder.userId,
          normalizedWorkContract.allowedFiles, normalizedWorkContract.validators,
          authorization.implementationGrantId == null ? null : Number(authorization.implementationGrantId),
          normalizedWorkContract.delivery?.authorityLevel ?? null,
          normalizedWorkContract.delivery?.commitAllowed ?? false,
          normalizedWorkContract.delivery?.tagAllowed ?? false,
          normalizedWorkContract.delivery?.pushAllowed ?? false],
      )
      if (backfilled?.rows?.length !== 1
        || !exactStringArray(backfilled.rows[0].allowedFiles, normalizedWorkContract.allowedFiles)
        || !exactStringArray(backfilled.rows[0].validators, normalizedWorkContract.validators)
        || (normalizedWorkContract.delivery !== undefined && (
          Number(backfilled.rows[0].authorityGrantId) !== Number(authorization.implementationGrantId)
          || backfilled.rows[0].authorityLevel !== normalizedWorkContract.delivery.authorityLevel
          || backfilled.rows[0].authorityGranted !== normalizedWorkContract.delivery.authorityLevel
          || backfilled.rows[0].commitAllowed !== normalizedWorkContract.delivery.commitAllowed
          || backfilled.rows[0].tagAllowed !== normalizedWorkContract.delivery.tagAllowed
          || backfilled.rows[0].pushAllowed !== normalizedWorkContract.delivery.pushAllowed))) {
        throw Object.assign(new Error("Hermes outcome Work Order contract backfill conflicted"), {
          code: "OUTCOME_WORK_ORDER_CONTRACT_WALL",
        })
      }
    }
    if (exactCrossAttemptLegacyReplay) {
      if (repairableCrossAttemptStatusSplit) {
        const repaired = await runQuery(
          `UPDATE work_order
           SET status = $2,
             result = $3,
             "commitRef" = CASE WHEN $7::boolean THEN NULL ELSE COALESCE($4, "commitRef") END,
             evidence = ARRAY(
               SELECT DISTINCT item
               FROM unnest(COALESCE(evidence, ARRAY[]::text[]) || $5::text[]) item
               ORDER BY item
             ),
             "closedAt" = CASE WHEN $2 = 'closed' THEN COALESCE("closedAt", NOW()) ELSE NULL END,
             "completedAt" = CASE WHEN $2 = 'closed' THEN COALESCE("completedAt", NOW()) ELSE NULL END,
             "updatedAt" = NOW()
           WHERE id = $1
             AND status = $6
             AND EXISTS (
               SELECT 1 FROM governance_event exact
               WHERE exact.id = $8
                 AND exact."entityType" = 'work_order'
                 AND exact."entityId"::text = $1::text
                 AND exact."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                 AND exact.metadata->>'idempotencyKey' = $9
                 AND exact.metadata->>'payloadDigest' = $10
             )
             AND NOT EXISTS (
               SELECT 1 FROM governance_event newer
               WHERE newer."entityType" = 'work_order'
                 AND newer."entityId"::text = $1::text
                 AND newer."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                 AND newer.id > $8
             )
           RETURNING id`,
          [workOrder.id, projection.status, projection.result, commitRef, labels,
            workOrder.status, clearCommitRef, Number(workOrder.latestCheckpointId),
            crossAttemptLegacyMetadata.idempotencyKey, crossAttemptLegacyDigest],
        )
        if ((repaired?.rows?.length ?? repaired?.rowCount ?? 0) !== 1) {
          throw Object.assign(new Error("Legacy runtime checkpoint repair lost its latest-event fence"), {
            code: "OUTCOME_PROJECTION_CONCURRENCY_WALL",
          })
        }
      }
      await runQuery("COMMIT")
      return {
        workOrderId: workOrder.id,
        workOrderRef: ref,
        idempotencyKey,
        status: projection.status,
        result: projection.result,
        commitRef,
      }
    }
    if (staleSameEpochCheckpoint) {
      await runQuery("COMMIT")
      return {
        workOrderId: workOrder.id,
        workOrderRef: ref,
        idempotencyKey,
        status: workOrder.status,
        result: workOrder.result ?? null,
        commitRef: workOrder.commitRef ?? null,
      }
    }
    const failureEval = failureEvalForCheckpoint(checkpoint)
    const insertedEvent = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       SELECT $1, 'HERMES_RUNTIME_CHECKPOINT', 'work_order', $2, 'hermes-codex-bridge',
         $3, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM governance_event prior
         WHERE prior."entityType" = 'work_order' AND prior."entityId"::text = $2::text
           AND prior."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND prior.metadata->>'idempotencyKey' = $5
       )
       RETURNING id`,
      [workOrder.userId, String(workOrder.id),
        `Projected ${checkpoint.state} for ${ref}`, JSON.stringify(eventMetadata), idempotencyKey],
    )
    const eventInserted = (insertedEvent?.rows?.length ?? insertedEvent?.rowCount ?? 0) > 0
    if (!eventInserted) {
      const prior = await runQuery(
        `SELECT id, metadata->>'payloadDigest' AS "payloadDigest"
         FROM governance_event
         WHERE "entityType" = 'work_order' AND "entityId"::text = $1::text
           AND "eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND metadata->>'idempotencyKey' = $2`,
        [String(workOrder.id), idempotencyKey],
      )
      if (prior?.rows?.length !== 1
        || ![
          eventMetadata.payloadDigest,
          ...(normalizedFindings.length === 0 ? [legacyPayloadDigest] : []),
        ].includes(prior.rows[0].payloadDigest)) {
        throw Object.assign(new Error("Runtime checkpoint replay conflicts with persisted evidence"), {
          code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT",
        })
      }
      acceptedPayloadDigest = prior.rows[0].payloadDigest
    }
    const sourceCheckpointId = insertedEvent.rows?.[0]?.id
      ?? (eventInserted ? null : undefined)
    let persistedSourceCheckpointId = sourceCheckpointId
    if (normalizedFindings.length > 0 && !Number.isSafeInteger(Number(persistedSourceCheckpointId))) {
      const persistedCheckpoint = await runQuery(
        `SELECT id, metadata->>'payloadDigest' AS "payloadDigest"
         FROM governance_event
         WHERE "userId" = $1 AND "entityType" = 'work_order' AND "entityId"::text = $2::text
           AND "eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND metadata->>'idempotencyKey' = $3`,
        [workOrder.userId, String(workOrder.id), idempotencyKey],
      )
      if (persistedCheckpoint?.rows?.length !== 1
        || persistedCheckpoint.rows[0].payloadDigest !== acceptedPayloadDigest) {
        throw Object.assign(new Error("Finding source checkpoint is not exact"), {
          code: "OUTCOME_PROJECTION_FINDING_SOURCE_WALL",
        })
      }
      persistedSourceCheckpointId = persistedCheckpoint.rows[0].id
    }
    for (const finding of normalizedFindings) {
      const findingIdempotencyKey = `hermes-outcome:${outcomeId}:finding:${finding.findingId}`
      const findingMetadata = {
        schemaVersion: 1,
        findingId: finding.findingId,
        objectiveWorkOrderId: ref,
        sequence: finding.sequence,
        summary: finding.summary,
        task: finding.task,
        paths: finding.paths,
        effects: finding.effects,
        sourceCheckpointId: Number(persistedSourceCheckpointId),
        sourceCheckpointKey: idempotencyKey,
        sourceCheckpointSequence: checkpoint.sequence,
        sourceCheckpointState: checkpoint.state,
        sourceCheckpointDigest: acceptedPayloadDigest,
        sourceExecutionEpochDigest: currentExecutionEpochDigest,
        findingsSetDigest,
        workContractId: eventMetadata.workContractId,
        workContractDigest: eventMetadata.workContractDigest,
        workContractVersion: eventMetadata.workContractVersion,
        workContractRepository: eventMetadata.workContractRepository,
        workContractLane: eventMetadata.workContractLane,
        projectionIssueNumber: eventMetadata.projectionIssueNumber,
        projectionCompletionOwned: eventMetadata.projectionCompletionOwned,
        authorizationDecisionId: eventMetadata.authorizationDecisionId,
        executionGrantRef: eventMetadata.executionGrantRef,
        implementationGrantId: eventMetadata.implementationGrantId,
        implementationGrantRef: eventMetadata.implementationGrantRef,
        deliveryAuthorityLevel: eventMetadata.deliveryAuthorityLevel,
        deliveryAllowedActions: eventMetadata.deliveryAllowedActions,
        commitAllowed: eventMetadata.commitAllowed,
        tagAllowed: eventMetadata.tagAllowed,
        pushAllowed: eventMetadata.pushAllowed,
        idempotencyKey: findingIdempotencyKey,
      }
      findingMetadata.payloadDigest = projectionPayloadDigest(findingMetadata)
      const sequenceCollision = await runQuery(
        `SELECT metadata->>'findingId' AS "findingId"
         FROM governance_event
         WHERE "userId" = $1
           AND "entityType" = 'work_order' AND "entityId"::text = $2::text
           AND "eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
           AND metadata->>'sequence' = ($3::integer)::text
         ORDER BY id
         LIMIT 2`,
        [workOrder.userId, String(workOrder.id), finding.sequence],
      )
      if ((sequenceCollision?.rows?.length ?? 0) > 1
        || (sequenceCollision?.rows?.length === 1
          && sequenceCollision.rows[0].findingId !== finding.findingId)) {
        throw Object.assign(new Error("Runtime finding sequence conflicts with persisted evidence"), {
          code: "OUTCOME_PROJECTION_FINDING_SEQUENCE_CONFLICT",
        })
      }
      const insertedFinding = await runQuery(
        `INSERT INTO governance_event
           ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
         SELECT $1, 'RUNTIME_OBJECTIVE_FINDING_RECORDED', 'work_order', $2, 'hermes', $3, $4::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM governance_event prior
           WHERE prior."userId" = $1
             AND prior."entityType" = 'work_order' AND prior."entityId"::text = $2::text
             AND prior."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
             AND prior.metadata->>'idempotencyKey' = $5
         )
         RETURNING id`,
        [workOrder.userId, String(workOrder.id),
          `Recorded ${finding.findingId} for ${ref}`,
          JSON.stringify(findingMetadata), findingIdempotencyKey],
      )
      if ((insertedFinding?.rows?.length ?? insertedFinding?.rowCount ?? 0) === 0) {
        const priorFinding = await runQuery(
          `SELECT metadata->>'payloadDigest' AS "payloadDigest"
           FROM governance_event
           WHERE "userId" = $1
             AND "entityType" = 'work_order' AND "entityId"::text = $2::text
             AND "eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
             AND metadata->>'idempotencyKey' = $3`,
          [workOrder.userId, String(workOrder.id), findingIdempotencyKey],
        )
        if (priorFinding?.rows?.length !== 1
          || priorFinding.rows[0].payloadDigest !== findingMetadata.payloadDigest) {
          throw Object.assign(new Error("Runtime finding replay conflicts with persisted evidence"), {
            code: "OUTCOME_PROJECTION_FINDING_IDEMPOTENCY_CONFLICT",
          })
        }
      }
    }
    if (eventInserted || repairableReplayStatusSplit) {
      await runQuery(
        `UPDATE work_order
         SET status = $2,
           result = $3,
           "commitRef" = CASE WHEN $7::boolean THEN NULL ELSE COALESCE($4, "commitRef") END,
           evidence = ARRAY(
             SELECT DISTINCT item
             FROM unnest(COALESCE(evidence, ARRAY[]::text[]) || $5::text[]) item
             ORDER BY item
           ),
           "closedAt" = CASE WHEN $2 = 'closed' THEN COALESCE("closedAt", NOW()) ELSE NULL END,
           "completedAt" = CASE WHEN $2 = 'closed' THEN COALESCE("completedAt", NOW()) ELSE NULL END,
           "updatedAt" = NOW()
         WHERE id = $1
           AND NOT EXISTS (
             SELECT 1 FROM governance_event newer
             WHERE newer."entityType" = 'work_order'
               AND newer."entityId"::text = $1::text
               AND newer."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
               AND newer.metadata->>'executionEpochDigest' = $8
               AND (newer.metadata->>'checkpointSequence')::integer > $6
           )`,
        [workOrder.id, projection.status, projection.result, commitRef, labels, checkpoint.sequence,
          clearCommitRef, currentExecutionEpochDigest],
      )
      if (eventInserted && failureEval) {
        await runQuery(
          `INSERT INTO governance_event
             ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
           VALUES ($1, 'HERMES_RUNTIME_FAILURE_EVAL', 'work_order', $2,
             'hermes-codex-bridge', $3, $4::jsonb)`,
          [workOrder.userId, String(workOrder.id),
            `Recorded ${failureEval.failureClass} for ${ref}`,
            JSON.stringify({
              sourceCheckpointId: insertedEvent.rows[0]?.id ?? null,
              sourceCheckpointKey: idempotencyKey,
              outcomeId,
              workOrderRef: ref,
              attempt,
              checkpointSequence: checkpoint.sequence,
              checkpointState: checkpoint.state,
              failureClass: failureEval.failureClass,
              disposition: failureEval.disposition,
              detail: checkpoint.detail ?? null,
            })],
        )
      }
    }
    if (failureEval || ["COMPLETE", "FAILED_TERMINAL"].includes(checkpoint.state)) {
      const evidenceRef = runtimeEvidenceRef(outcomeId, attempt, checkpoint.sequence)
      const expectedEvidence = {
        result: projection.result ?? "PARTIAL",
        repo: "bsvalues/terragroq",
        head: commitRef,
        notes: `Persisted Hermes runtime evidence for ${idempotencyKey}.`,
        contentHash: acceptedPayloadDigest,
      }
      await runQuery(
        `INSERT INTO evidence_record
           ("userId", ref, "workOrderId", result, repo, head, notes, "contentHash")
         SELECT $1, $2, $3, $4, 'bsvalues/terragroq', $5, $6, $7
         WHERE NOT EXISTS (
           SELECT 1 FROM evidence_record prior
           WHERE prior."userId" = $1 AND prior.ref = $2 AND prior."workOrderId" = $3
         )`,
        [
          workOrder.userId,
          evidenceRef,
          workOrder.id,
          expectedEvidence.result,
          expectedEvidence.head,
          expectedEvidence.notes,
          expectedEvidence.contentHash,
        ],
      )
      const persistedEvidence = await runQuery(
        `SELECT result, repo, head, notes, "contentHash"
         FROM evidence_record
         WHERE "userId" = $1 AND ref = $2 AND "workOrderId" = $3
         ORDER BY id`,
        [workOrder.userId, evidenceRef, workOrder.id],
      )
      if (persistedEvidence?.rows?.length !== 1
        || JSON.stringify(persistedEvidence.rows[0]) !== JSON.stringify(expectedEvidence)) {
        throw Object.assign(new Error("Terminal evidence replay conflicts with persisted evidence"), {
          code: "OUTCOME_PROJECTION_EVIDENCE_CONFLICT",
        })
      }
    }
    await runQuery("COMMIT")
    return {
      workOrderId: workOrder.id,
      workOrderRef: ref,
      idempotencyKey,
      status: projection.status,
      result: projection.result,
      commitRef,
    }
  } catch (error) {
    primaryError = error
    if (runQuery) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    await closeProjectionResources({ client, pool, primaryError })
  }
}

export async function verifyActiveReviewRecoveryContinuation({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  executionBinding,
  workContract,
  proof,
  provenanceOnly = false,
} = {}) {
  if (!proof || proof.expectedNextState !== REVIEW_REMEDIATION_EXHAUSTED
    || typeof proof.proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proof.proofDigest)
    || !Number.isSafeInteger(proof.prNumber) || proof.prNumber <= 0
    || typeof proof.reviewedHeadSha !== "string" || !COMMIT_SHA.test(proof.reviewedHeadSha)
    || typeof proof.mergeSha !== "string" || !COMMIT_SHA.test(proof.mergeSha)) {
    throw Object.assign(new Error("Active review recovery proof is invalid"), {
      code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
    })
  }
  try {
    await projectOutcomeRuntimeCheckpoint({
      query,
      databaseUrl,
      outcomeId,
      attempt: executionBinding?.reviewRecoverySourceRuntimeAttempt + 1,
      executionBinding,
      workContract,
      authorizationOnly: true,
      activeReviewRecoveryProvenanceOnly: provenanceOnly,
      checkpoint: {
        sequence: 0,
        state: "LEASED",
        metadata: {
          prNumber: proof.prNumber,
          headRefOid: proof.reviewedHeadSha,
          mergeSha: proof.mergeSha,
          reviewRecoveryProofDigest: proof.proofDigest,
        },
      },
    })
    return true
  } catch (error) {
    if (error?.code === "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL") throw error
    throw Object.assign(new Error("Active review recovery authorization is invalid"), {
      code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      cause: error,
    })
  }
}

export async function resolveActiveReviewRecoveryProvenance({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  executionBinding,
  workContract,
  proof,
  checkpointProof,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !executionBinding || typeof executionBinding.userId !== "string"
    || typeof executionBinding.outcomeKey !== "string"
    || !Number.isSafeInteger(executionBinding.expectedVersion) || executionBinding.expectedVersion <= 0
    || typeof executionBinding.executionBinding !== "string"
    || typeof executionBinding.acquisitionKey !== "string"
    || typeof executionBinding.leaseHolder !== "string"
    || typeof executionBinding.leaseToken !== "string"
    || !Number.isSafeInteger(executionBinding.fencingToken) || executionBinding.fencingToken <= 1) {
    throw Object.assign(new Error("Active review recovery binding is invalid"), {
      code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
    })
  }
  const reclaimedRecoveryBinding = executionBinding.reviewRecoveryResumeState
      === "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
    && Number.isSafeInteger(executionBinding.reviewRecoverySourceExpectedVersion)
    && executionBinding.reviewRecoverySourceExpectedVersion >= 0
    && Number.isSafeInteger(executionBinding.reviewRecoverySourceFencingToken)
    && executionBinding.reviewRecoverySourceFencingToken > 0
    && Number.isSafeInteger(executionBinding.reviewRecoverySourceRuntimeAttempt)
    && executionBinding.reviewRecoverySourceRuntimeAttempt > 0
    && Number.isSafeInteger(executionBinding.reviewRecoveryReclaimEventId)
    && executionBinding.reviewRecoveryReclaimEventId > 0
    && /^[0-9a-f]{64}$/.test(String(executionBinding.reviewRecoveryReclaimPayloadDigest ?? ""))
  const localBaseHop = executionBinding.reviewRecoveryStaleReacquisition
  const localContinuation = executionBinding.reviewRecoveryStaleContinuation
  const localStaleDelta = executionBinding.expectedVersion
    - Number(executionBinding.reviewRecoverySourceExpectedVersion)
  const staleRecoveryBinding = reclaimedRecoveryBinding
    && executionBinding.fencingToken - executionBinding.reviewRecoverySourceFencingToken
      === localStaleDelta
    && (localStaleDelta === 3 || localStaleDelta === 4)
    && (localStaleDelta === 3
      ? localContinuation === undefined
      : localBaseHop !== undefined && localContinuation !== undefined)
  const legacyStaleReacquired = staleRecoveryBinding && localBaseHop === undefined
  let exactCheckpointProof = null
  if (staleRecoveryBinding) {
    try {
      exactCheckpointProof = canonicalOutcomeQueueCheckpointProof(checkpointProof)
    } catch {
      throw Object.assign(new Error("Legacy stale recovery checkpoint proof is invalid"), {
        code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    if (exactCheckpointProof.outcomeId !== String(outcomeId)
      || exactCheckpointProof.outcomeKey !== executionBinding.outcomeKey
      || exactCheckpointProof.fencingToken !== executionBinding.fencingToken
      || exactCheckpointProof.workOrderId !== Number(executionBinding.activeWorkOrderId)) {
      throw Object.assign(new Error("Legacy stale recovery checkpoint proof conflicts"), {
        code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      })
    }
  }
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let primaryError
  try {
    if (!runQuery) {
      if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
        throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
      }
      const { Pool } = await import("pg")
      pool = createHermesDatabasePool(Pool, databaseUrl)
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    const requestedSourceExpectedVersion = reclaimedRecoveryBinding
      ? executionBinding.reviewRecoverySourceExpectedVersion
      : executionBinding.expectedVersion - 1
    const requestedSourceFencingToken = reclaimedRecoveryBinding
      ? executionBinding.reviewRecoverySourceFencingToken
      : executionBinding.fencingToken - 1
    const resolved = await runQuery(
      `SELECT (recovery_authorization.metadata->>'runtimeAttempt')::integer AS "sourceRuntimeAttempt",
          queue.version AS "queueVersion", queue."fencingToken" AS "queueFencingToken",
          queue."lifecycleReason" AS "queueLifecycleReason",
          queue."leaseExpiresAt" AS "queueLeaseExpiresAt",
          queue."activeWorkOrderId" AS "queueActiveWorkOrderId",
          acquisition_receipt."firstFencingToken" AS "receiptFirstFencingToken",
          acquisition_receipt."latestFencingToken" AS "receiptLatestFencingToken",
          reclaim.id AS "reclaimEventId", reclaim.metadata->>'payloadDigest' AS "reclaimPayloadDigest"
       FROM outcome_queue_item AS queue
       JOIN outcome_queue_acquisition_receipt AS acquisition_receipt
         ON acquisition_receipt."userId" = queue."userId"
        AND acquisition_receipt."outcomeKey" = queue."outcomeKey"
        AND acquisition_receipt."acquisitionKey" = queue."acquisitionKey"
       JOIN governance_event AS recovery_authorization
         ON recovery_authorization."userId" = queue."userId"
        AND recovery_authorization."entityType" = 'goal'
        AND recovery_authorization."entityId"::text = queue."goalId"::text
        AND recovery_authorization."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERY_AUTHORIZED'
        AND recovery_authorization.actor = 'hermes-codex-bridge'
        AND recovery_authorization.metadata->>'recoveryKind' = 'review-remediation'
        AND recovery_authorization.metadata->>'outcomeId' = queue."goalId"::text
        AND recovery_authorization.metadata->>'userId' = queue."userId"
        AND recovery_authorization.metadata->>'outcomeKey' = queue."outcomeKey"
        AND recovery_authorization.metadata->>'workOrderId' = queue."activeWorkOrderId"::text
        AND recovery_authorization.metadata->>'workOrderRef' = 'WO-HERMES-OUTCOME-' || queue."goalId"::text
        AND recovery_authorization.metadata->>'executionBinding' = queue."executionBinding"
        AND recovery_authorization.metadata->>'acquisitionKey' = queue."acquisitionKey"
        AND recovery_authorization.metadata->>'fencingToken' = ($17::integer)::text
        AND recovery_authorization.metadata->>'proofDigest' = $10
        AND recovery_authorization.metadata->>'prNumber' = ($11::integer)::text
        AND recovery_authorization.metadata->>'reviewedHeadSha' = $12
        AND recovery_authorization.metadata->>'mergeSha' = $13
       LEFT JOIN governance_event AS reclaim
         ON reclaim."userId" = queue."userId"
        AND reclaim."entityType" = 'goal'
        AND reclaim."entityId"::text = queue."goalId"::text
        AND reclaim."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERY_RECLAIMED'
        AND reclaim.metadata->>'proofDigest' = $10
        AND reclaim.metadata->>'prNumber' = ($11::integer)::text
        AND reclaim.metadata->>'reviewedHeadSha' = $12
        AND reclaim.metadata->>'mergeSha' = $13
       WHERE queue."goalId" = $1::integer
         AND queue."userId" = $2
         AND queue."outcomeKey" = $3
         AND queue."executionBinding" = $5
         AND queue."acquisitionKey" = $6
         AND queue."leaseHolder" = $7
         AND queue."leaseToken" = $8
         AND queue."lifecycleState" = 'active'
         AND ((queue."lifecycleReason" = 'REVIEW_REMEDIATION_RECOVERED'
              AND queue.version = $4::integer
              AND queue."fencingToken" = $9::integer
              AND reclaim.id IS NULL)
            OR (queue."lifecycleReason" = 'REVIEW_REMEDIATION_RECOVERY_RECLAIMED'
               AND queue.version = $4::integer + 1
               AND queue."fencingToken" = $9::integer + 1
               AND reclaim.id IS NOT NULL)
            OR ($14::boolean
               AND queue."lifecycleReason" = 'STALE_LEASE_RECOVERED'
               AND ((queue.version = $4::integer AND queue."fencingToken" = $9::integer)
                 OR (queue.version = $4::integer + 1
                   AND queue."fencingToken" = $9::integer + 1))
               AND reclaim.id = $15::bigint
               AND reclaim.metadata->>'payloadDigest' = $16))
       ORDER BY recovery_authorization.id
       LIMIT 2`,
      [outcomeId, executionBinding.userId, executionBinding.outcomeKey,
        executionBinding.expectedVersion, executionBinding.executionBinding,
        executionBinding.acquisitionKey, executionBinding.leaseHolder,
        executionBinding.leaseToken, executionBinding.fencingToken,
        proof?.proofDigest, proof?.prNumber, proof?.reviewedHeadSha, proof?.mergeSha,
        staleRecoveryBinding, executionBinding.reviewRecoveryReclaimEventId ?? null,
        executionBinding.reviewRecoveryReclaimPayloadDigest ?? null,
        requestedSourceFencingToken],
    )
    const row = resolved?.rows?.[0]
    const sourceRuntimeAttempt = Number(row?.sourceRuntimeAttempt)
    if (resolved?.rows?.length !== 1 || !Number.isSafeInteger(sourceRuntimeAttempt)
      || sourceRuntimeAttempt <= 0) {
      throw Object.assign(new Error("Active review recovery provenance is not unique"), {
        code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    const provenance = {
      reviewRecoverySourceExpectedVersion: reclaimedRecoveryBinding
        ? executionBinding.reviewRecoverySourceExpectedVersion
        : executionBinding.expectedVersion - 1,
      reviewRecoverySourceFencingToken: reclaimedRecoveryBinding
        ? executionBinding.reviewRecoverySourceFencingToken
        : executionBinding.fencingToken - 1,
      reviewRecoverySourceRuntimeAttempt: sourceRuntimeAttempt,
    }
    const local = [executionBinding.reviewRecoverySourceExpectedVersion,
      executionBinding.reviewRecoverySourceFencingToken,
      executionBinding.reviewRecoverySourceRuntimeAttempt]
    if (local.some((value) => value !== undefined)
      && (local.some((value) => value === undefined)
        || local[0] !== provenance.reviewRecoverySourceExpectedVersion
        || local[1] !== provenance.reviewRecoverySourceFencingToken
        || local[2] !== provenance.reviewRecoverySourceRuntimeAttempt)) {
      throw Object.assign(new Error("Active review recovery provenance conflicts with local state"), {
        code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      })
    }
    let staleReacquisition = null
    let staleContinuation = null
    if (staleRecoveryBinding) {
      const acquisitionKeyDigest = createHash("sha256").update(canonicalJson({
        acquisitionKey: executionBinding.acquisitionKey,
      })).digest("hex")
      const leaseIdentityDigest = createHash("sha256").update(canonicalJson({
        leaseHolder: executionBinding.leaseHolder,
        leaseToken: executionBinding.leaseToken,
      })).digest("hex")
      const observed = await runQuery(
        `SELECT id,"campaignWindowId","processIdentity","leaseHolder","acquisitionKeyDigest",
            "leaseIdentityDigest","checkpointDigest","checkpointOutcomeId","checkpointSequence",
            "checkpointState","checkpointHeadSha","checkpointMergeSha","checkpointPrNumber",
            "fencingToken","leaseExpiresAt","activeWorkOrderId",disposition,reason,"attemptedAt"
         FROM outcome_queue_acquisition_attempt
         WHERE "userId" = $1 AND "outcomeKey" = $2
           AND "fencingToken" IN ($3::integer, $4::integer)
         ORDER BY "fencingToken",id
         LIMIT 66`,
        [executionBinding.userId, executionBinding.outcomeKey,
          provenance.reviewRecoverySourceFencingToken + 3,
          provenance.reviewRecoverySourceFencingToken + 4],
      )
      const attempts = observed?.rows ?? []
      const queueExpiry = Date.parse(String(row.queueLeaseExpiresAt ?? ""))
      const checkpointDigestForFence = (fence) => digestOutcomeQueueCheckpointProof({
        ...exactCheckpointProof, fencingToken: fence,
      })
      const exactAttempt = (attempt, disposition, fence, groupExpiry) => {
        const expectedCheckpointDigest = checkpointDigestForFence(fence)
        return Number.isSafeInteger(Number(attempt?.id))
        && Number(attempt.id) > 0
        && attempt.disposition === disposition
        && attempt.reason === null
        && typeof attempt.campaignWindowId === "string" && attempt.campaignWindowId.trim() !== ""
        && typeof attempt.processIdentity === "string" && attempt.processIdentity.trim() !== ""
        && attempt.leaseHolder === executionBinding.leaseHolder
        && attempt.acquisitionKeyDigest === acquisitionKeyDigest
        && attempt.leaseIdentityDigest === leaseIdentityDigest
        && attempt.checkpointDigest === expectedCheckpointDigest
        && attempt.checkpointOutcomeId === exactCheckpointProof.outcomeId
        && Number(attempt.checkpointSequence) === exactCheckpointProof.sequence
        && attempt.checkpointState === exactCheckpointProof.state
        && attempt.checkpointHeadSha === exactCheckpointProof.commit.headSha
        && attempt.checkpointMergeSha === exactCheckpointProof.commit.mergeSha
        && Number(attempt.checkpointPrNumber) === exactCheckpointProof.commit.prNumber
        && Number(attempt.fencingToken) === fence
        && Date.parse(String(attempt.leaseExpiresAt ?? "")) === groupExpiry
        && Number(attempt.activeWorkOrderId) === exactCheckpointProof.workOrderId
        && Number.isFinite(Date.parse(String(attempt.attemptedAt ?? "")))
      }
      const baseFence = provenance.reviewRecoverySourceFencingToken + 3
      const continuationFence = provenance.reviewRecoverySourceFencingToken + 4
      const baseAttempts = attempts.filter((attempt) => Number(attempt.fencingToken) === baseFence)
      const continuationAttempts = attempts.filter(
        (attempt) => Number(attempt.fencingToken) === continuationFence,
      )
      const baseExpiry = Date.parse(String(baseAttempts[0]?.leaseExpiresAt ?? ""))
      const continuationExpiry = Date.parse(String(continuationAttempts[0]?.leaseExpiresAt ?? ""))
      const queueFence = Number(row.queueFencingToken)
      const queueVersion = Number(row.queueVersion)
      const hasContinuation = queueFence === continuationFence
        && queueVersion === provenance.reviewRecoverySourceExpectedVersion + 4
      const evidenceChecks = {
        localDelta: localStaleDelta === 3 || localStaleDelta === 4,
        queueDelta: (queueFence === baseFence
          && queueVersion === provenance.reviewRecoverySourceExpectedVersion + 3)
          || hasContinuation,
        forwardBound: queueFence === executionBinding.fencingToken
          || (localStaleDelta === 3 && queueFence === executionBinding.fencingToken + 1),
        boundedBase: baseAttempts.length >= 1 && baseAttempts.length <= 32,
        baseTransition: exactAttempt(baseAttempts[0], "RECLAIMED", baseFence, baseExpiry),
        baseReplays: !baseAttempts.slice(1).some(
          (attempt) => !exactAttempt(attempt, "REPLAY_WINNER", baseFence, baseExpiry),
        ),
        boundedContinuation: hasContinuation
          ? continuationAttempts.length >= 1 && continuationAttempts.length <= 32
          : continuationAttempts.length === 0,
        continuationTransition: !hasContinuation
          || exactAttempt(continuationAttempts[0], "RECLAIMED", continuationFence,
            continuationExpiry),
        continuationReplays: !hasContinuation || !continuationAttempts.slice(1).some(
          (attempt) => !exactAttempt(attempt, "REPLAY_WINNER", continuationFence,
            continuationExpiry),
        ),
        attemptOrder: !hasContinuation
          || Number(baseAttempts.at(-1)?.id) < Number(continuationAttempts[0]?.id),
        expiry: Number.isFinite(queueExpiry),
        workOrder: Number(row.queueActiveWorkOrderId) === exactCheckpointProof.workOrderId,
        receiptFirst: Number(row.receiptFirstFencingToken)
          === provenance.reviewRecoverySourceFencingToken,
        receiptLatest: Number(row.receiptLatestFencingToken) === queueFence,
        currentExpiry: queueExpiry === (hasContinuation ? continuationExpiry : baseExpiry),
      }
      if (Object.values(evidenceChecks).some((valid) => !valid)) {
        const failed = Object.entries(evidenceChecks).filter(([, valid]) => !valid)
          .map(([name]) => name).join(",")
        throw Object.assign(new Error(`Legacy stale recovery acquisition evidence conflicts: ${failed}`), {
          code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
        })
      }
      staleReacquisition = {
        disposition: "RECLAIMED",
        expectedVersion: provenance.reviewRecoverySourceExpectedVersion + 3,
        fencingToken: baseFence,
        leaseExpiresAt: new Date(baseExpiry).toISOString(),
        lifecycleReason: "STALE_LEASE_RECOVERED",
        priorExpectedVersion: provenance.reviewRecoverySourceExpectedVersion + 2,
        priorFencingToken: provenance.reviewRecoverySourceFencingToken + 2,
        receiptLatestFencingToken: baseFence,
        checkpointDigest: checkpointDigestForFence(baseFence),
      }
      if (hasContinuation) {
        staleContinuation = {
          disposition: "RECLAIMED",
          expectedVersion: queueVersion,
          fencingToken: queueFence,
          leaseExpiresAt: new Date(continuationExpiry).toISOString(),
          lifecycleReason: "STALE_LEASE_RECOVERED",
          priorExpectedVersion: staleReacquisition.expectedVersion,
          priorFencingToken: staleReacquisition.fencingToken,
          priorLeaseExpiresAt: staleReacquisition.leaseExpiresAt,
          receiptLatestFencingToken: queueFence,
          checkpointDigest: checkpointDigestForFence(queueFence),
        }
      }
      const withoutCheckpointAnchor = (hop) => {
        if (!hop) return hop
        const { checkpointDigest: _checkpointDigest, ...legacy } = hop
        return legacy
      }
      if ((localBaseHop !== undefined
          && canonicalJson(localBaseHop) !== canonicalJson(staleReacquisition)
          && canonicalJson(localBaseHop) !== canonicalJson(withoutCheckpointAnchor(staleReacquisition)))
        || (localContinuation !== undefined
          && canonicalJson(localContinuation) !== canonicalJson(staleContinuation)
          && canonicalJson(localContinuation) !== canonicalJson(withoutCheckpointAnchor(staleContinuation)))) {
        throw Object.assign(new Error("Local stale recovery chain conflicts with durable evidence"), {
          code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
        })
      }
    }
    const forwardReclaimed = row.queueLifecycleReason === "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
    const verifiedExecutionBinding = forwardReclaimed ? {
      ...executionBinding,
      ...provenance,
      expectedVersion: Number(row.queueVersion),
      fencingToken: Number(row.queueFencingToken),
      reviewRecoveryResumeState: "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      reviewRecoveryReclaimEventId: Number(row.reclaimEventId),
      reviewRecoveryReclaimPayloadDigest: row.reclaimPayloadDigest,
    } : { ...executionBinding, ...provenance,
      ...(staleRecoveryBinding ? {
        expectedVersion: Number(row.queueVersion),
        fencingToken: Number(row.queueFencingToken),
      } : {}),
      ...(staleReacquisition ? { reviewRecoveryStaleReacquisition: staleReacquisition } : {}),
      ...(staleContinuation ? { reviewRecoveryStaleContinuation: staleContinuation } : {}) }
    await verifyActiveReviewRecoveryContinuation({
      query: runQuery,
      outcomeId,
      executionBinding: verifiedExecutionBinding,
      workContract,
      proof: { ...proof, runtimeAttempt: sourceRuntimeAttempt },
      provenanceOnly: !forwardReclaimed && !staleContinuation,
    })
    return { ...provenance, ...(staleReacquisition ? {
      alreadyStaleReacquired: true,
      reviewRecoveryExpectedVersion: Number(row.queueVersion),
      reviewRecoveryFencingToken: Number(row.queueFencingToken),
      reviewRecoveryStaleReacquisition: staleReacquisition,
      ...(staleContinuation ? { reviewRecoveryStaleContinuation: staleContinuation } : {}),
    } : {}) }
  } catch (error) {
    primaryError = error
    if (error?.code === "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL") throw error
    throw Object.assign(new Error("Active review recovery provenance is invalid"), {
      code: "OUTCOME_ACTIVE_REVIEW_RECOVERY_AUTHORIZATION_WALL",
      cause: error,
    })
  } finally {
    await closeProjectionResources({ client, pool, primaryError })
  }
}

export async function verifyReviewRecoveryProjectionCollision({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  attempt,
  checkpointSequence,
  checkpointDetail,
  prNumber,
  reviewedHeadSha,
  mergeSha,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !Number.isSafeInteger(attempt) || attempt <= 0
    || !Number.isSafeInteger(checkpointSequence) || checkpointSequence < 0
    || typeof checkpointDetail !== "string" || checkpointDetail.length === 0
    || !Number.isSafeInteger(prNumber) || prNumber <= 0
    || typeof reviewedHeadSha !== "string" || !COMMIT_SHA.test(reviewedHeadSha)
    || typeof mergeSha !== "string" || !COMMIT_SHA.test(mergeSha)) {
    return false
  }
  const ref = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:attempt:${attempt}:checkpoint:${checkpointSequence}`
  const expected = {
    idempotencyKey,
    outcomeId,
    workOrderRef: ref,
    attempt,
    checkpointSequence,
    checkpointState: "PR_MERGED",
    checkpointDetail,
    prNumber,
    headRefOid: reviewedHeadSha,
    mergeSha,
  }
  expected.payloadDigest = projectionPayloadDigest(expected)
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") return false
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  try {
    const result = await runQuery(
      `SELECT ge.metadata
       FROM governance_event ge
       JOIN work_order wo ON wo.id::text = ge."entityId"::text
       JOIN goal g ON g."userId" = wo."userId"
       WHERE g.id = $1::integer
         AND wo.ref = $2
         AND ge."entityType" = 'work_order'
         AND ge."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
         AND ge.metadata->>'idempotencyKey' = $3`,
      [outcomeId, ref, idempotencyKey],
    )
    if (result?.rows?.length !== 1) return false
    const actual = result.rows[0]?.metadata
    const expectedKeys = Object.keys(expected).sort()
    return actual && typeof actual === "object" && !Array.isArray(actual)
      && JSON.stringify(Object.keys(actual).sort()) === JSON.stringify(expectedKeys)
      && expectedKeys.every((key) => actual[key] === expected[key])
  } catch {
    return false
  } finally {
    if (pool) {
      try {
        await pool.end()
      } catch {}
    }
  }
}

const RUNTIME_LEASE_STATUSES = new Set([
  "ACTIVE",
  "ABANDONED",
  "DEFERRED",
  "RELEASED",
])

/**
 * Appends the durable local lease posture to the existing governance ledger.
 * Lease events are separate from checkpoints so releasing or abandoning a
 * lease cannot mutate or conflict with checkpoint evidence.
 */
export async function projectOutcomeRuntimeLease({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  attempt,
  checkpointSequence,
  lease,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (!Number.isSafeInteger(attempt) || attempt <= 0
    || !Number.isSafeInteger(checkpointSequence) || checkpointSequence < 0
    || !lease || !RUNTIME_LEASE_STATUSES.has(lease.status)
    || typeof lease.expiresAt !== "string"
    || !Number.isFinite(Date.parse(lease.expiresAt))) {
    throw Object.assign(new Error("runtime lease is invalid"), {
      code: "OUTCOME_PROJECTION_LEASE_INVALID",
    })
  }

  let ref = outcomeWorkOrderRef(outcomeId)
  const leaseExpiresAt = new Date(lease.expiresAt).toISOString()
  let idempotencyKey
  let eventMetadata
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let primaryError
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    const derived = await runQuery(
      `SELECT receipt."resultBinding"->>'workOrderRef' AS "workOrderRef"
       FROM "outcome_queue_item" AS queue
       JOIN "outcome_queue_mutation_receipt" AS receipt
         ON receipt."userId" = queue."userId"
        AND receipt."outcomeKey" = queue."outcomeKey"
       JOIN work_order AS child
         ON child."userId" = queue."userId"
        AND child.id = queue."activeWorkOrderId"
        AND child.id::text = receipt."resultBinding"->>'workOrderId'
        AND child.ref = receipt."resultBinding"->>'workOrderRef'
       WHERE queue."goalId" = $1::integer
         AND receipt.operation = 'runtime_finding.derive'
         AND receipt."requestBinding"->>'operation' = 'runtime_finding.derive'
         AND receipt."resultBinding"->>'goalId' = queue."goalId"::text
         AND receipt."resultBinding"->>'outcomeKey' = queue."outcomeKey"
       ORDER BY receipt.id
       LIMIT 2
       FOR UPDATE OF queue, child`,
      [outcomeId],
    )
    if ((derived?.rows?.length ?? 0) > 1) {
      throw Object.assign(new Error("Derived Hermes lease Work Order cardinality is invalid"), {
        code: "OUTCOME_WORK_ORDER_CARDINALITY_WALL",
      })
    }
    if (derived?.rows?.length === 1) {
      const derivedRef = derived.rows[0].workOrderRef
      if (typeof derivedRef !== "string" || derivedRef.trim() === "") {
        throw Object.assign(new Error("Derived Hermes lease Work Order identity is invalid"), {
          code: "OUTCOME_WORK_ORDER_IDENTITY_WALL",
        })
      }
      ref = derivedRef
    }
    idempotencyKey = [
      `hermes-outcome:${outcomeId}`,
      `attempt:${attempt}`,
      `lease:${lease.status}`,
      `checkpoint:${checkpointSequence}`,
      `expires:${Date.parse(leaseExpiresAt)}`,
    ].join(":")
    eventMetadata = {
      idempotencyKey,
      outcomeId,
      workOrderRef: ref,
      attempt,
      checkpointSequence,
      leaseStatus: lease.status,
      leaseExpiresAt,
    }
    eventMetadata.payloadDigest = projectionPayloadDigest(eventMetadata)
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [ref])
    const workOrders = await runQuery(
      `SELECT wo.id, wo."userId" AS "userId", wo.ref
       FROM work_order wo
       JOIN goal g ON g."userId" = wo."userId"
       WHERE g.id = $1::integer AND wo.ref = $2
       ORDER BY wo.id
       FOR UPDATE OF wo`,
      [outcomeId, ref],
    )
    if (workOrders?.rows?.length !== 1) {
      throw Object.assign(new Error("Hermes outcome Work Order cardinality is invalid"), {
        code: "OUTCOME_WORK_ORDER_CARDINALITY_WALL",
      })
    }
    const workOrder = workOrders.rows[0]
    const insertedEvent = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       SELECT $1, 'HERMES_RUNTIME_LEASE', 'work_order', $2, 'hermes-codex-bridge',
         $3, $4::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM governance_event prior
         WHERE prior."entityType" = 'work_order' AND prior."entityId"::text = $2::text
           AND prior."eventType" = 'HERMES_RUNTIME_LEASE'
           AND prior.metadata->>'idempotencyKey' = $5
       )
       RETURNING id`,
      [
        workOrder.userId,
        String(workOrder.id),
        `Projected ${lease.status} lease for ${ref}`,
        JSON.stringify(eventMetadata),
        idempotencyKey,
      ],
    )
    const eventInserted = (insertedEvent?.rows?.length ?? insertedEvent?.rowCount ?? 0) > 0
    if (!eventInserted) {
      const prior = await runQuery(
        `SELECT metadata->>'payloadDigest' AS "payloadDigest"
         FROM governance_event
         WHERE "entityType" = 'work_order' AND "entityId"::text = $1::text
           AND "eventType" = 'HERMES_RUNTIME_LEASE'
           AND metadata->>'idempotencyKey' = $2`,
        [String(workOrder.id), idempotencyKey],
      )
      if (prior?.rows?.length !== 1
        || prior.rows[0].payloadDigest !== eventMetadata.payloadDigest) {
        throw Object.assign(new Error("Runtime lease replay conflicts with persisted evidence"), {
          code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT",
        })
      }
    }
    await runQuery("COMMIT")
    return {
      workOrderId: workOrder.id,
      workOrderRef: ref,
      idempotencyKey,
      leaseStatus: lease.status,
      checkpointSequence,
    }
  } catch (error) {
    primaryError = error
    if (runQuery) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    await closeProjectionResources({ client, pool, primaryError })
  }
}

/**
 * Converts only a dismissed review-remediation terminal whose later projected
 * PR_MERGED checkpoint exactly matches the supplied reviewed head and merge.
 */
export async function recoverReviewedOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  prNumber,
  reviewedHeadSha,
  mergeSha,
  proofDigest,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0
    || typeof reviewedHeadSha !== "string" || !COMMIT_SHA.test(reviewedHeadSha)
    || typeof mergeSha !== "string" || !COMMIT_SHA.test(mergeSha)
    || typeof proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proofDigest)) {
    throw Object.assign(new Error("review recovery evidence is invalid"), { code: "OUTCOME_REVIEW_RECOVERY_EVIDENCE_INVALID" })
  }

  const ref = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:review-recovery:pr:${prNumber}:head:${reviewedHeadSha}:merge:${mergeSha}`
  const confirmationKey = `${idempotencyKey}:queue-proof:${proofDigest}`
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [ref])
    const recovered = await runQuery(
      `WITH latest_terminal AS (
         SELECT id, metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       ), candidate AS (
         SELECT g.id, g."userId" AS "userId", wo.id AS "workOrderId", terminal.id AS "terminalId"
         FROM goal g
         JOIN work_order wo ON wo."userId" = g."userId" AND wo.ref = $2
         JOIN latest_terminal terminal
           ON terminal.metadata->>'result' = 'FAILED_TERMINAL'
          AND terminal.metadata->>'nextState' = $3
         WHERE g.id = $1::integer AND g.status = 'dismissed'
       ), exact_merge AS (
         SELECT candidate.*, merged.id AS "mergeEventId"
         FROM candidate
         JOIN governance_event merged
           ON merged."entityType" = 'work_order'
          AND merged."entityId"::text = candidate."workOrderId"::text
          AND merged."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
          AND merged.metadata->>'checkpointState' = 'PR_MERGED'
          AND merged.metadata->>'prNumber' = ($4::integer)::text
          AND merged.metadata->>'headRefOid' = $5
          AND merged.metadata->>'mergeSha' = $6
          AND merged.id > candidate."terminalId"
       )
       UPDATE goal g SET status = 'classified', "updatedAt" = NOW()
       FROM exact_merge exact
       WHERE g.id = exact.id
       RETURNING g.id, exact."userId", exact."workOrderId", exact."mergeEventId"`,
      [outcomeId, ref, REVIEW_REMEDIATION_EXHAUSTED, prNumber, reviewedHeadSha, mergeSha],
    )
    let row = recovered?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT g."userId" AS "userId", wo.id AS "workOrderId",
                recovered.id AS "recoveredEventId"
         FROM goal g
         JOIN work_order wo ON wo."userId" = g."userId" AND wo.ref = $2
         JOIN governance_event recovered
           ON recovered."userId" = g."userId"
          AND recovered."entityType" = 'goal'
          AND recovered."entityId"::text = g.id::text
          AND recovered."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERED'
          AND recovered.metadata->>'idempotencyKey' = $3
          AND recovered.metadata->>'prNumber' = ($4::integer)::text
          AND recovered.metadata->>'reviewedHeadSha' = $5
          AND recovered.metadata->>'mergeSha' = $6
         JOIN governance_event merged
           ON merged."userId" = g."userId"
          AND merged."entityType" = 'work_order'
          AND merged."entityId"::text = wo.id::text
          AND merged."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
          AND merged.metadata->>'checkpointState' = 'PR_MERGED'
          AND merged.metadata->>'prNumber' = ($4::integer)::text
          AND merged.metadata->>'headRefOid' = $5
          AND merged.metadata->>'mergeSha' = $6
          AND merged.id < recovered.id
         WHERE g.id = $1::integer AND g.status = 'classified'`,
        [outcomeId, ref, idempotencyKey, prNumber, reviewedHeadSha, mergeSha],
      )
      if (prior?.rows?.length !== 1) {
        await runQuery("ROLLBACK")
        return false
      }
      row = prior.rows[0]
    } else {
      await runQuery(
        `INSERT INTO governance_event
           ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
         VALUES ($1, 'HERMES_OUTCOME_REVIEW_RECOVERED', 'goal', $2,
           'hermes-codex-bridge', $3, $4::jsonb)`,
        [row.userId, String(outcomeId), `Released exact reviewed and merged PR #${prNumber} for normal finalization`,
          JSON.stringify({ idempotencyKey, workOrderRef: ref, prNumber, reviewedHeadSha, mergeSha, proofDigest })],
      )
    }
    const confirmations = await runQuery(
      `SELECT metadata->>'proofDigest' AS "proofDigest"
       FROM governance_event
       WHERE "userId" = $1
         AND "entityType" = 'goal'
         AND "entityId"::text = $2
         AND "eventType" = 'HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_CONFIRMED'
         AND metadata->>'prNumber' = ($3::integer)::text
         AND metadata->>'reviewedHeadSha' = $4
         AND metadata->>'mergeSha' = $5
       FOR UPDATE`,
      [row.userId, String(outcomeId), prNumber, reviewedHeadSha, mergeSha],
    )
    if ((confirmations?.rows?.length ?? 0) > 1
      || (confirmations?.rows?.length === 1
        && confirmations.rows[0].proofDigest !== proofDigest)) {
      throw Object.assign(new Error("review recovery digest conflicts with durable evidence"), {
        code: "OUTCOME_REVIEW_RECOVERY_EVIDENCE_INVALID",
      })
    }
    if ((confirmations?.rows?.length ?? 0) === 0) {
      await runQuery(
        `INSERT INTO governance_event
           ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
         VALUES ($1, 'HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_CONFIRMED', 'goal', $2,
           'hermes-codex-bridge', $3, $4::jsonb)`,
        [row.userId, String(outcomeId), `Bound reviewed PR #${prNumber} to its resident recovery proof`,
          JSON.stringify({
            idempotencyKey: confirmationKey,
            recoveryIdempotencyKey: idempotencyKey,
            workOrderRef: ref,
            prNumber,
            reviewedHeadSha,
            mergeSha,
            proofDigest,
          })],
      )
    }
    await runQuery("COMMIT")
    return true
  } catch (error) {
    if (runQuery) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export async function recoverTerminalPostMergeCleanupOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  prNumber,
  reviewedHeadSha,
  mergeSha,
  proofDigest,
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0
    || typeof reviewedHeadSha !== "string" || !COMMIT_SHA.test(reviewedHeadSha)
    || typeof mergeSha !== "string" || !COMMIT_SHA.test(mergeSha)
    || typeof proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proofDigest)) {
    throw Object.assign(new Error("post-merge cleanup recovery evidence is invalid"), {
      code: "OUTCOME_POST_MERGE_CLEANUP_RECOVERY_EVIDENCE_INVALID",
    })
  }

  const ref = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:post-merge-cleanup-recovery:pr:${prNumber}:head:${reviewedHeadSha}:merge:${mergeSha}:proof:${proofDigest}`
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [ref])
    const recovered = await runQuery(
      `WITH latest_terminal AS (
         SELECT id, metadata
         FROM governance_event
         WHERE "entityType" = 'goal' AND "entityId"::text = ($1::integer)::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       ), candidate AS (
         SELECT g.id, g."userId" AS "userId", wo.id AS "workOrderId", terminal.id AS "terminalId"
         FROM goal g
         JOIN work_order wo ON wo."userId" = g."userId" AND wo.ref = $2
         JOIN latest_terminal terminal
           ON terminal.metadata->>'result' = 'FAILED_TERMINAL'
          AND terminal.metadata->>'nextState' = $3
         WHERE g.id = $1::integer AND g.status = 'dismissed'
       ), exact_cleanup AS (
         SELECT candidate.*, recovered.id AS "recoveryEventId"
         FROM candidate
         JOIN governance_event recovered
           ON recovered."entityType" = 'work_order'
          AND recovered."entityId"::text = candidate."workOrderId"::text
          AND recovered."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
          AND recovered.metadata->>'checkpointState' = 'POST_MERGE_CLEANUP_RECOVERED'
          AND recovered.metadata->>'prNumber' = ($4::integer)::text
          AND recovered.metadata->>'headRefOid' = $5
          AND recovered.metadata->>'mergeSha' = $6
          AND recovered.metadata->>'terminalCleanupRecoveryProofDigest' = $7
          AND recovered.id > candidate."terminalId"
       )
       UPDATE goal g SET status = 'classified', "updatedAt" = NOW()
       FROM exact_cleanup exact
       WHERE g.id = exact.id
       RETURNING g.id, exact."userId", exact."workOrderId", exact."recoveryEventId"`,
      [
        outcomeId,
        ref,
        POST_MERGE_CLEANUP_REMEDIATION_EXHAUSTED,
        prNumber,
        reviewedHeadSha,
        mergeSha,
        proofDigest,
      ],
    )
    const row = recovered?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT EXISTS (
           SELECT 1 FROM goal g
           JOIN governance_event recovered
             ON recovered."entityType" = 'goal' AND recovered."entityId"::text = g.id::text
            AND recovered."eventType" = 'HERMES_OUTCOME_POST_MERGE_CLEANUP_RECOVERED'
            AND recovered.metadata->>'idempotencyKey' = $2
           WHERE g.id = $1::integer AND g.status = 'classified'
         ) AS recovered`,
        [outcomeId, idempotencyKey],
      )
      const alreadyRecovered = prior?.rows?.[0]?.recovered === true
      await runQuery(alreadyRecovered ? "COMMIT" : "ROLLBACK")
      return alreadyRecovered
    }
    await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_POST_MERGE_CLEANUP_RECOVERED', 'goal', $2,
         'hermes-codex-bridge', $3, $4::jsonb)`,
      [
        row.userId,
        String(outcomeId),
        `Released exact cleaned and merged PR #${prNumber} for normal finalization`,
        JSON.stringify({ idempotencyKey, workOrderRef: ref, prNumber, reviewedHeadSha, mergeSha, proofDigest }),
      ],
    )
    await runQuery("COMMIT")
    return true
  } catch (error) {
    if (runQuery) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

function activeCleanupConfirmationMetadata(authorization, authorizationEventId) {
  const metadata = {
    idempotencyKey: `hermes-outcome:${authorization.outcomeId}:active-post-merge-cleanup:confirmation`,
    authorizationEventId,
    authorizationPayloadDigest: authorization.payloadDigest,
    outcomeId: authorization.outcomeId,
    userId: authorization.userId,
    outcomeKey: authorization.outcomeKey,
    workOrderId: authorization.workOrderId,
    workOrderRef: authorization.workOrderRef,
    cleanupProofDigest: authorization.cleanupProofDigest,
    branch: authorization.branch,
    worktreePath: authorization.worktreePath,
    prNumber: authorization.prNumber,
    reviewedHeadSha: authorization.reviewedHeadSha,
    mergeSha: authorization.mergeSha,
  }
  metadata.payloadDigest = activeCleanupPayloadDigest(metadata)
  return metadata
}

const ACTIVE_CLEANUP_AUTHORIZATION_KEYS = [
  "idempotencyKey", "recoveryKind", "outcomeId", "userId", "outcomeKey", "workOrderId",
  "workOrderRef", "workContractId", "workContractDigest", "expectedVersion",
  "executionBinding", "acquisitionKey", "leaseHolder", "leaseToken", "fencingToken", "sourceExpectedVersion",
  "sourceFencingToken", "sourceRuntimeAttempt", "reclaimEventId", "reclaimPayloadDigest",
  "baseCheckpointDigest", "continuationCheckpointDigest", "staleReacquisition",
  "staleContinuation", "reviewRecoveryProofDigest",
  "prNumber", "reviewedHeadSha", "mergeSha", "branch", "worktreePath",
  "cleanupProofDigest", "payloadDigest",
].sort()

const ACTIVE_CLEANUP_CONFIRMATION_KEYS = [
  "idempotencyKey", "authorizationEventId", "authorizationPayloadDigest", "outcomeId",
  "userId", "outcomeKey", "workOrderId", "workOrderRef", "cleanupProofDigest", "branch",
  "worktreePath", "prNumber", "reviewedHeadSha", "mergeSha", "payloadDigest",
].sort()

const ACTIVE_CLEANUP_SETTLEMENT_KEYS = [
  "idempotencyKey", "authorizationEventId", "confirmationEventId", "checkpointEventId",
  "checkpointPayloadDigest", "cleanupProofDigest", "outcomeId", "userId", "outcomeKey",
  "workOrderId", "workOrderRef", "priorQueueVersion", "completedQueueVersion",
  "fencingToken", "prNumber", "reviewedHeadSha", "mergeSha", "payloadDigest",
].sort()

const ACTIVE_CLEANUP_COMPLETION_KEYS = [
  "idempotencyKey", "settlementEventId", "settlementPayloadDigest", "checkpointEventId",
  "checkpointPayloadDigest", "cleanupProofDigest", "outcomeId", "userId", "outcomeKey",
  "workOrderId", "workOrderRef", "completedQueueVersion", "fencingToken", "terminalAt",
  "prNumber", "reviewedHeadSha", "mergeSha", "payloadDigest",
].sort()

function exactActiveCleanupAuthorization(value) {
  const metadata = exactPayloadMetadata(value)
  return metadata
    && canonicalJson(Object.keys(metadata).sort()) === canonicalJson(ACTIVE_CLEANUP_AUTHORIZATION_KEYS)
    ? metadata : null
}

function exactActiveCleanupConfirmation(value) {
  const metadata = exactPayloadMetadata(value)
  return metadata
    && canonicalJson(Object.keys(metadata).sort()) === canonicalJson(ACTIVE_CLEANUP_CONFIRMATION_KEYS)
    ? metadata : null
}

function exactActiveCleanupSettlement(value) {
  const metadata = exactPayloadMetadata(value)
  return metadata
    && canonicalJson(Object.keys(metadata).sort()) === canonicalJson(ACTIVE_CLEANUP_SETTLEMENT_KEYS)
    ? metadata : null
}

function exactActiveCleanupCompletion(value) {
  const metadata = exactPayloadMetadata(value)
  return metadata
    && canonicalJson(Object.keys(metadata).sort()) === canonicalJson(ACTIVE_CLEANUP_COMPLETION_KEYS)
    ? metadata : null
}

function exactPayloadMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const body = { ...value }
  const payloadDigest = body.payloadDigest
  delete body.payloadDigest
  return /^[0-9a-f]{64}$/.test(String(payloadDigest ?? ""))
    && activeCleanupPayloadDigest(body) === payloadDigest ? { ...body, payloadDigest } : null
}

function activeCleanupPayloadDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex")
}

export async function authorizeActivePostMergeCleanup({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  executionBinding,
  workContract,
  proof,
  cleanupProofDigest,
  branch,
  worktreePath,
  verifyContinuation = verifyActiveReviewRecoveryContinuation,
} = {}) {
  const wall = () => Object.assign(new Error("Active post-merge cleanup authorization conflicts"), {
    code: "OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZATION_WALL",
  })
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !executionBinding || !Number.isSafeInteger(executionBinding.expectedVersion)
    || !Number.isSafeInteger(executionBinding.fencingToken)
    || executionBinding.reviewRecoveryResumeState !== "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
    || !Number.isSafeInteger(executionBinding.activeWorkOrderId)
    || typeof cleanupProofDigest !== "string" || !/^[0-9a-f]{64}$/.test(cleanupProofDigest)
    || typeof branch !== "string" || branch.trim() === ""
    || typeof worktreePath !== "string" || worktreePath.trim() === "") throw wall()
  if (workContract?.id !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.id
    || workContract?.digest !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.digest
    || workContract?.version !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.version
    || workContract?.repository !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.repository
    || workContract?.lane !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.lane) throw wall()
  await verifyContinuation({
    outcomeId, executionBinding, workContract, proof, provenanceOnly: true,
  })
  const workOrderRef = outcomeWorkOrderRef(outcomeId)
  const semanticKey = ["hermes-outcome", outcomeId, "active-post-merge-cleanup",
    executionBinding.acquisitionKey, executionBinding.fencingToken].join(":")
  const metadata = {
    idempotencyKey: semanticKey,
    recoveryKind: "active-post-merge-cleanup",
    outcomeId,
    userId: executionBinding.userId,
    outcomeKey: executionBinding.outcomeKey,
    workOrderId: executionBinding.activeWorkOrderId,
    workOrderRef,
    workContractId: workContract?.id,
    workContractDigest: workContract?.digest,
    expectedVersion: executionBinding.expectedVersion,
    executionBinding: executionBinding.executionBinding,
    acquisitionKey: executionBinding.acquisitionKey,
    leaseHolder: executionBinding.leaseHolder,
    leaseToken: executionBinding.leaseToken,
    fencingToken: executionBinding.fencingToken,
    sourceExpectedVersion: executionBinding.reviewRecoverySourceExpectedVersion,
    sourceFencingToken: executionBinding.reviewRecoverySourceFencingToken,
    sourceRuntimeAttempt: executionBinding.reviewRecoverySourceRuntimeAttempt,
    reclaimEventId: executionBinding.reviewRecoveryReclaimEventId,
    reclaimPayloadDigest: executionBinding.reviewRecoveryReclaimPayloadDigest,
    baseCheckpointDigest: executionBinding.reviewRecoveryStaleReacquisition?.checkpointDigest,
    continuationCheckpointDigest: executionBinding.reviewRecoveryStaleContinuation?.checkpointDigest,
    staleReacquisition: executionBinding.reviewRecoveryStaleReacquisition,
    staleContinuation: executionBinding.reviewRecoveryStaleContinuation,
    reviewRecoveryProofDigest: proof?.proofDigest,
    prNumber: proof?.prNumber,
    reviewedHeadSha: proof?.reviewedHeadSha,
    mergeSha: proof?.mergeSha,
    branch,
    worktreePath,
    cleanupProofDigest,
  }
  metadata.payloadDigest = activeCleanupPayloadDigest(metadata)
  if (Object.values(metadata).some((value) => value === undefined)) throw wall()
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let begun = false
  try {
    if (!runQuery) {
      if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
        throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
      }
      const { Pool } = await import("pg")
      pool = createHermesDatabasePool(Pool, databaseUrl)
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN"); begun = true
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [workOrderRef])
    const prior = await runQuery(
      `SELECT id, actor, metadata FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED'
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [executionBinding.userId, String(outcomeId)],
    )
    if ((prior?.rows?.length ?? 0) > 1) throw wall()
    const later = await runQuery(
      `SELECT "eventType", id, actor, metadata FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" IN ('HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED',
           'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED')
       ORDER BY id FOR UPDATE`,
      [executionBinding.userId, String(outcomeId)],
    )
    if (prior?.rows?.length === 1) {
      if (prior.rows[0].actor !== "hermes-codex-bridge"
        || canonicalJson(prior.rows[0].metadata) !== canonicalJson(metadata)) throw wall()
      const confirmations = later.rows.filter((row) => row.eventType
        === "HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED")
      const settlements = later.rows.filter((row) => row.eventType
        === "HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED")
      if (confirmations.length > 1 || settlements.length > 1
        || (settlements.length === 1 && confirmations.length !== 1)) throw wall()
      const expectedConfirmation = activeCleanupConfirmationMetadata(metadata, Number(prior.rows[0].id))
      if (confirmations.length === 1 && (confirmations[0].actor !== "hermes-codex-bridge"
        || Number(confirmations[0].id) <= Number(prior.rows[0].id)
        || canonicalJson(confirmations[0].metadata) !== canonicalJson(expectedConfirmation))) throw wall()
      if (settlements.length === 1) {
        const settlementMetadata = exactActiveCleanupSettlement(settlements[0].metadata)
        if (settlements[0].actor !== "hermes-codex-bridge"
          || Number(settlements[0].id) <= Number(confirmations[0].id)
          || !settlementMetadata
          || Number(settlementMetadata.authorizationEventId) !== Number(prior.rows[0].id)
          || Number(settlementMetadata.confirmationEventId) !== Number(confirmations[0].id)
          || !Number.isSafeInteger(Number(settlementMetadata.checkpointEventId))
          || Number(settlementMetadata.checkpointEventId) <= 0
          || !/^[0-9a-f]{64}$/.test(String(settlementMetadata.checkpointPayloadDigest ?? ""))
          || settlementMetadata.cleanupProofDigest !== cleanupProofDigest
          || Number(settlementMetadata.outcomeId) !== outcomeId
          || settlementMetadata.userId !== executionBinding.userId
          || settlementMetadata.outcomeKey !== executionBinding.outcomeKey
          || Number(settlementMetadata.workOrderId) !== executionBinding.activeWorkOrderId
          || settlementMetadata.workOrderRef !== workOrderRef
          || Number(settlementMetadata.priorQueueVersion) !== executionBinding.expectedVersion
          || Number(settlementMetadata.completedQueueVersion) !== executionBinding.expectedVersion + 1
          || Number(settlementMetadata.fencingToken) !== executionBinding.fencingToken
          || Number(settlementMetadata.prNumber) !== Number(proof.prNumber)
          || settlementMetadata.reviewedHeadSha !== proof.reviewedHeadSha
          || settlementMetadata.mergeSha !== proof.mergeSha) throw wall()
      }
      await runQuery("COMMIT"); begun = false
      const confirmation = confirmations[0]
      return {
        eventId: Number(prior.rows[0].id), payloadDigest: metadata.payloadDigest, metadata,
        confirmed: Boolean(confirmation),
        ...(confirmation ? { confirmation: { eventId: Number(confirmation.id), metadata: confirmation.metadata,
          payloadDigest: confirmation.metadata?.payloadDigest } } : {}),
        settled: later.rows.some((row) => row.eventType
          === "HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED"),
        replayed: true,
      }
    }
    if ((later?.rows?.length ?? 0) !== 0) throw wall()
    const graph = await runQuery(
      `SELECT g.id AS "goalId", g."userId" AS "userId", wo.id AS "workOrderId",
          wo.ref AS "workOrderRef", q.version, q."fencingToken" AS "fencingToken",
          q."lifecycleState" AS "lifecycleState", q."lifecycleReason" AS "lifecycleReason",
          q."leaseExpiresAt" AS "leaseExpiresAt"
       FROM goal g
       JOIN outcome_queue_item q ON q."userId" = g."userId" AND q."goalId" = g.id
       JOIN work_order wo ON wo."userId" = q."userId" AND wo.id = q."activeWorkOrderId"
       JOIN outcome_queue_mutation_receipt receipt ON receipt."userId" = q."userId"
         AND receipt."outcomeKey" = q."outcomeKey" AND receipt.operation = 'workbench_execution.authorize'
         AND receipt."requestBinding"->>'confirmation' = 'START_WORK'
         AND receipt."requestBinding"->>'outcomeKey' = q."outcomeKey"
         AND receipt."resultBinding"->>'grantRef' = q."authorityGrantRef"
         AND receipt."resultBinding"->>'decisionId' = q."approvalDecisionId"::text
         AND receipt."resultBinding"->'workContract'->>'id' = $12
         AND receipt."resultBinding"->'workContract'->>'digest' = $13
         AND receipt."resultBinding"->'workContract' = $14::jsonb
       JOIN authority_grant implementation_grant ON implementation_grant."userId" = q."userId"
         AND implementation_grant.id::text = receipt."resultBinding"->>'implementationGrantId'
         AND implementation_grant.ref = receipt."resultBinding"->>'implementationGrantRef'
       WHERE g.id = $1 AND g."userId" = $2 AND g.status = 'classified'
         AND q."outcomeKey" = $3 AND q.version = $4 AND q."fencingToken" = $5
         AND q."executionBinding" = $6 AND q."acquisitionKey" = $7
         AND q."leaseHolder" = $8 AND q."leaseToken" = $9
         AND q."lifecycleState" = 'active' AND q."lifecycleReason" = 'STALE_LEASE_RECOVERED'
         AND q."leaseExpiresAt" <= clock_timestamp()
         AND q."activeWorkOrderId" = $10 AND wo.ref = $11
         AND q."approvalState" = 'approved' AND q."authorityState" = 'matched'
         AND q."authorityLevel" = 'A2_WRITE_OWN' AND q."authoritySubject" = 'operator'
         AND q."authorityAction" = 'outcome:execute'
         AND EXISTS (SELECT 1 FROM decision d WHERE d.id = q."approvalDecisionId"
           AND d."userId" = q."userId" AND d.owner = q."userId" AND d.status = 'accepted'
           AND d.authority = 'binding' AND d.locked = true
           AND upper(trim(d.decision)) = 'APPROVE' AND d.scope = q."outcomeKey"
           AND d.tags = ARRAY['workbench','outcome','explicit-start-work']::text[])
         AND EXISTS (SELECT 1 FROM authority_grant grant_row
           WHERE grant_row."userId" = q."userId" AND grant_row.ref = q."authorityGrantRef"
             AND grant_row.status = 'active' AND grant_row."revokedAt" IS NULL
             AND grant_row."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp()
             AND grant_row."authorityLevel" = 'A2_WRITE_OWN'
             AND grant_row."grantedTo" = 'operator' AND grant_row.scope = q."outcomeKey"
             AND (grant_row."workOrderId" IS NULL OR grant_row."workOrderId" = q."activeWorkOrderId")
             AND grant_row."allowedActions" = ARRAY['outcome:execute']::text[]
             AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(grant_row."blockedActions", ARRAY[]::text[])) blocked(action)
               WHERE position(lower(blocked.action) IN 'outcome:execute') > 0))
         AND implementation_grant.status = 'active' AND implementation_grant."revokedAt" IS NULL
         AND implementation_grant."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp()
         AND implementation_grant."authorityLevel" = 'A2_WRITE_OWN'
         AND implementation_grant."grantedTo" = 'operator' AND implementation_grant.scope = wo.ref
         AND (implementation_grant."workOrderId" IS NULL OR implementation_grant."workOrderId" = wo.id)
         AND implementation_grant."allowedActions" = ARRAY['implement']::text[]
         AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(implementation_grant."blockedActions", ARRAY[]::text[])) blocked(action)
           WHERE position(lower(blocked.action) IN 'implement') > 0)
       ORDER BY g.id LIMIT 2 FOR UPDATE OF g, q, wo`,
      [outcomeId, executionBinding.userId, executionBinding.outcomeKey,
        executionBinding.expectedVersion, executionBinding.fencingToken,
        executionBinding.executionBinding, executionBinding.acquisitionKey,
        executionBinding.leaseHolder, executionBinding.leaseToken,
        executionBinding.activeWorkOrderId, workOrderRef, workContract.id, workContract.digest,
        JSON.stringify(ACTIVE_CLEANUP_REGISTERED_CONTRACT)],
    )
    const row = graph?.rows?.[0]
    if (graph?.rows?.length !== 1 || Number(row.goalId) !== outcomeId
      || Number(row.workOrderId) !== executionBinding.activeWorkOrderId
      || row.workOrderRef !== workOrderRef || Number(row.version) !== executionBinding.expectedVersion
      || Number(row.fencingToken) !== executionBinding.fencingToken
      || row.lifecycleState !== "active" || row.lifecycleReason !== "STALE_LEASE_RECOVERED"
      || !Number.isFinite(Date.parse(String(row.leaseExpiresAt ?? "")))) throw wall()
    const inserted = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED', 'goal', $2,
         'hermes-codex-bridge', $3, $4::jsonb) RETURNING id`,
      [executionBinding.userId, String(outcomeId),
        `Authorized cleanup-only settlement for merged PR #${proof.prNumber}`, JSON.stringify(metadata)],
    )
    if (inserted?.rows?.length !== 1 || !Number.isSafeInteger(Number(inserted.rows[0].id))) throw wall()
    await runQuery("COMMIT"); begun = false
    return { eventId: Number(inserted.rows[0].id), payloadDigest: metadata.payloadDigest,
      metadata, confirmed: false, settled: false, replayed: false }
  } catch (error) {
    if (begun) { try { await runQuery("ROLLBACK") } catch {} }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}

export async function confirmActivePostMergeCleanup({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  executionBinding,
  authorizationEventId,
  cleanupProofDigest,
  branch,
  worktreePath,
  prNumber,
  reviewedHeadSha,
  mergeSha,
} = {}) {
  const wall = () => Object.assign(new Error("Active post-merge cleanup confirmation conflicts"), {
    code: "OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMATION_WALL",
  })
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !Number.isSafeInteger(authorizationEventId) || authorizationEventId <= 0
    || !executionBinding || typeof executionBinding.userId !== "string"
    || !/^[0-9a-f]{64}$/.test(String(cleanupProofDigest ?? ""))
    || typeof branch !== "string" || branch.trim() === ""
    || typeof worktreePath !== "string" || worktreePath.trim() === ""
    || !Number.isSafeInteger(prNumber) || prNumber <= 0
    || !COMMIT_SHA.test(String(reviewedHeadSha ?? ""))
    || !COMMIT_SHA.test(String(mergeSha ?? ""))) throw wall()
  const workOrderRef = outcomeWorkOrderRef(outcomeId)
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let begun = false
  try {
    if (!runQuery) {
      if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
        throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
      }
      const { Pool } = await import("pg")
      pool = createHermesDatabasePool(Pool, databaseUrl)
      client = await pool.connect(); runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN"); begun = true
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [workOrderRef])
    const authorization = await runQuery(
      `SELECT id, actor, metadata FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED'
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [executionBinding.userId, String(outcomeId)],
    )
    if (authorization?.rows?.length !== 1
      || Number(authorization.rows[0].id) !== authorizationEventId
      || authorization.rows[0].actor !== "hermes-codex-bridge") throw wall()
    const auth = authorization.rows[0].metadata
    const exactAuth = exactActiveCleanupAuthorization(auth)
    if (!exactAuth
      || auth.cleanupProofDigest !== cleanupProofDigest
      || auth.branch !== branch || auth.worktreePath !== worktreePath
      || Number(auth.prNumber) !== prNumber || auth.reviewedHeadSha !== reviewedHeadSha
      || auth.mergeSha !== mergeSha || auth.executionBinding !== executionBinding.executionBinding
      || auth.acquisitionKey !== executionBinding.acquisitionKey
      || Number(auth.fencingToken) !== executionBinding.fencingToken
      || Number(auth.expectedVersion) !== executionBinding.expectedVersion) throw wall()
    const metadata = activeCleanupConfirmationMetadata(auth, authorizationEventId)
    const idempotencyKey = metadata.idempotencyKey
    const prior = await runQuery(
      `SELECT id, actor, metadata FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED'
       ORDER BY id LIMIT 2 FOR UPDATE`,
      [executionBinding.userId, String(outcomeId)],
    )
    if ((prior?.rows?.length ?? 0) > 1) throw wall()
    const settlement = await runQuery(
      `SELECT id FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED'
       ORDER BY id LIMIT 1 FOR UPDATE`,
      [executionBinding.userId, String(outcomeId)],
    )
    if ((settlement?.rows?.length ?? 0) !== 0) throw wall()
    if (prior?.rows?.length === 1) {
      if (prior.rows[0].actor !== "hermes-codex-bridge"
        || canonicalJson(prior.rows[0].metadata) !== canonicalJson(metadata)) throw wall()
      await runQuery("COMMIT"); begun = false
      return { eventId: Number(prior.rows[0].id), payloadDigest: metadata.payloadDigest,
        metadata, replayed: true }
    }
    const inserted = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED', 'goal', $2,
         'hermes-codex-bridge', $3, $4::jsonb) RETURNING id`,
      [executionBinding.userId, String(outcomeId),
        `Confirmed guarded cleanup for merged PR #${prNumber}`, JSON.stringify(metadata)],
    )
    if (inserted?.rows?.length !== 1 || !Number.isSafeInteger(Number(inserted.rows[0].id))) throw wall()
    await runQuery("COMMIT"); begun = false
    return { eventId: Number(inserted.rows[0].id), payloadDigest: metadata.payloadDigest,
      metadata, replayed: false }
  } catch (error) {
    if (begun) { try { await runQuery("ROLLBACK") } catch {} }
    throw error
  } finally {
    client?.release(); if (pool) await pool.end()
  }
}

export async function settleActivePostMergeCleanupOutcome({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  executionBinding,
  workContract,
  authorizationEventId,
  confirmationEventId,
  cleanupProofDigest,
  expectedVersion,
  fencingToken,
  runtimeAttempt,
  checkpointSequence,
  prNumber,
  reviewedHeadSha,
  mergeSha,
  verifyOnly = false,
} = {}) {
  const wall = () => Object.assign(new Error("Active post-merge cleanup settlement conflicts"), {
    code: "OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLEMENT_WALL",
  })
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !executionBinding || executionBinding.expectedVersion !== expectedVersion
    || executionBinding.fencingToken !== fencingToken
    || !Number.isSafeInteger(runtimeAttempt) || runtimeAttempt <= 0
    || !Number.isSafeInteger(checkpointSequence) || checkpointSequence < 0
    || !Number.isSafeInteger(authorizationEventId) || authorizationEventId <= 0
    || !Number.isSafeInteger(confirmationEventId) || confirmationEventId <= authorizationEventId
    || !/^[0-9a-f]{64}$/.test(String(cleanupProofDigest ?? ""))
    || !Number.isSafeInteger(prNumber) || prNumber <= 0
    || !COMMIT_SHA.test(String(reviewedHeadSha ?? ""))
    || !COMMIT_SHA.test(String(mergeSha ?? ""))) throw wall()
  if (workContract?.id !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.id
    || workContract?.digest !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.digest
    || workContract?.version !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.version
    || workContract?.repository !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.repository
    || workContract?.lane !== ACTIVE_CLEANUP_REGISTERED_CONTRACT.lane) throw wall()
  const workOrderRef = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:active-post-merge-cleanup:settle:${cleanupProofDigest}`
  const checkpointKey = `hermes-outcome:${outcomeId}:attempt:${runtimeAttempt}:checkpoint:${checkpointSequence}`
  const terminalKey = `${idempotencyKey}:queue`
  let runQuery = normalizeQuery(query)
  let pool
  let client
  let begun = false
  try {
    if (!runQuery) {
      if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
        throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
      }
      const { Pool } = await import("pg")
      pool = createHermesDatabasePool(Pool, databaseUrl)
      client = await pool.connect(); runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN"); begun = true
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [workOrderRef])
    const prior = await runQuery(
      `SELECT e.id, e.actor, e.metadata, q.version, q."fencingToken" AS "fencingToken",
          q."lifecycleState" AS "lifecycleState", q."lifecycleReason" AS "lifecycleReason",
          q."terminalKey" AS "terminalKey", q."terminalResult" AS "terminalResult",
          q."terminalEvidenceId" AS "terminalEvidenceId", q."terminalEvidenceRefs" AS "terminalEvidenceRefs",
          q."terminalAt" AS "terminalAt",
          q."leaseHolder" AS "leaseHolder",
          q."leaseToken" AS "leaseToken", q."leaseExpiresAt" AS "leaseExpiresAt",
          g.status AS "goalStatus", wo.status AS "workOrderStatus", wo.result AS "workOrderResult",
          wo."commitRef" AS "workOrderCommitRef",
          wo."latestCheckpointId" AS "latestCheckpointId", checkpoint.actor AS "checkpointActor",
          checkpoint.metadata AS "checkpointMetadata"
       FROM governance_event e
       JOIN outcome_queue_item q ON q."userId" = e."userId" AND q."goalId" = e."entityId"::integer
       JOIN goal g ON g.id = q."goalId" AND g."userId" = q."userId"
       JOIN work_order wo ON wo.id = q."activeWorkOrderId" AND wo."userId" = q."userId"
       JOIN governance_event checkpoint ON checkpoint.id = CASE
           WHEN e.metadata->>'checkpointEventId' ~ '^[1-9][0-9]*$'
           THEN (e.metadata->>'checkpointEventId')::bigint END
         AND checkpoint."userId" = q."userId" AND checkpoint."entityType" = 'work_order'
         AND checkpoint."entityId"::text = wo.id::text
         AND checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
       WHERE e."userId" = $1 AND e."entityType" = 'goal' AND e."entityId"::text = $2
         AND e."eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED'
         AND e.actor = 'hermes-codex-bridge'
         AND e.metadata->>'idempotencyKey' = $3
       ORDER BY e.id LIMIT 2 FOR UPDATE OF q`,
      [executionBinding.userId, String(outcomeId), idempotencyKey],
    )
    if ((prior?.rows?.length ?? 0) > 1) throw wall()
    const chain = await runQuery(
      `SELECT id, "eventType", actor, metadata FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" IN ('HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED',
           'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED',
           'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED', 'HERMES_OUTCOME_COMPLETED')
       ORDER BY id FOR UPDATE`,
      [executionBinding.userId, String(outcomeId)],
    )
    const authorizationKey = ["hermes-outcome", outcomeId, "active-post-merge-cleanup",
      executionBinding.acquisitionKey, executionBinding.fencingToken].join(":")
    const authorizations = chain.rows.filter((row) => row.eventType
      === "HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED")
    const confirmations = chain.rows.filter((row) => row.eventType
      === "HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED")
    const settlements = chain.rows.filter((row) => row.eventType
      === "HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED")
    const completions = chain.rows.filter((row) => row.eventType === "HERMES_OUTCOME_COMPLETED")
    const authorization = authorizations[0]
    const exactAuthorization = exactActiveCleanupAuthorization(authorization?.metadata)
    const expectedConfirmation = exactAuthorization
      ? activeCleanupConfirmationMetadata(exactAuthorization, authorizationEventId) : null
    const confirmation = confirmations[0]
    if (authorizations.length !== 1 || confirmations.length !== 1
      || settlements.length !== (prior?.rows?.length ?? 0)
      || completions.length !== (prior?.rows?.length ?? 0)
      || Number(authorization?.id) !== authorizationEventId
      || authorization?.actor !== "hermes-codex-bridge" || !exactAuthorization
      || exactAuthorization.idempotencyKey !== authorizationKey
      || exactAuthorization.cleanupProofDigest !== cleanupProofDigest
      || exactAuthorization.outcomeId !== outcomeId
      || exactAuthorization.userId !== executionBinding.userId
      || exactAuthorization.outcomeKey !== executionBinding.outcomeKey
      || exactAuthorization.workOrderId !== executionBinding.activeWorkOrderId
      || exactAuthorization.workOrderRef !== workOrderRef
      || exactAuthorization.workContractId !== workContract.id
      || exactAuthorization.workContractDigest !== workContract.digest
      || exactAuthorization.expectedVersion !== expectedVersion
      || exactAuthorization.executionBinding !== executionBinding.executionBinding
      || exactAuthorization.acquisitionKey !== executionBinding.acquisitionKey
      || exactAuthorization.leaseHolder !== executionBinding.leaseHolder
      || exactAuthorization.leaseToken !== executionBinding.leaseToken
      || exactAuthorization.fencingToken !== fencingToken
      || exactAuthorization.sourceExpectedVersion !== executionBinding.reviewRecoverySourceExpectedVersion
      || exactAuthorization.sourceFencingToken !== executionBinding.reviewRecoverySourceFencingToken
      || exactAuthorization.sourceRuntimeAttempt !== executionBinding.reviewRecoverySourceRuntimeAttempt
      || exactAuthorization.reclaimEventId !== executionBinding.reviewRecoveryReclaimEventId
      || exactAuthorization.reclaimPayloadDigest !== executionBinding.reviewRecoveryReclaimPayloadDigest
      || canonicalJson(exactAuthorization.staleReacquisition)
        !== canonicalJson(executionBinding.reviewRecoveryStaleReacquisition)
      || canonicalJson(exactAuthorization.staleContinuation)
        !== canonicalJson(executionBinding.reviewRecoveryStaleContinuation)
      || exactAuthorization.prNumber !== prNumber
      || exactAuthorization.reviewedHeadSha !== reviewedHeadSha
      || exactAuthorization.mergeSha !== mergeSha
      || Number(confirmation?.id) !== confirmationEventId
      || confirmation?.actor !== "hermes-codex-bridge"
      || confirmationEventId <= authorizationEventId
      || canonicalJson(confirmation?.metadata) !== canonicalJson(expectedConfirmation)
      || (settlements[0] && settlements[0].metadata?.idempotencyKey !== idempotencyKey)) throw wall()
    if (prior?.rows?.length === 1) {
      const persisted = exactPayloadMetadata(prior.rows[0].metadata)
      const checkpointMetadata = exactPayloadMetadata(prior.rows[0].checkpointMetadata)
      const expectedCheckpoint = {
        idempotencyKey: checkpointKey, outcomeId, workOrderRef, attempt: runtimeAttempt,
        checkpointSequence, checkpointState: "POST_MERGE_CLEANUP_RECOVERED",
        checkpointDetail: `PR #${prNumber}`, executionBinding: executionBinding.executionBinding,
        acquisitionKey: executionBinding.acquisitionKey, acquisitionFencingToken: fencingToken,
        workContractId: workContract.id, workContractDigest: workContract.digest,
        authorizationEventId, confirmationEventId, cleanupProofDigest, prNumber,
        headRefOid: reviewedHeadSha, mergeSha,
      }
      expectedCheckpoint.payloadDigest = activeCleanupPayloadDigest(expectedCheckpoint)
      const expectedSettlement = persisted ? {
        idempotencyKey, authorizationEventId, confirmationEventId,
        checkpointEventId: Number(persisted.checkpointEventId),
        checkpointPayloadDigest: expectedCheckpoint.payloadDigest, cleanupProofDigest,
        outcomeId, userId: executionBinding.userId, outcomeKey: executionBinding.outcomeKey,
        workOrderId: executionBinding.activeWorkOrderId, workOrderRef,
        priorQueueVersion: expectedVersion, completedQueueVersion: expectedVersion + 1,
        fencingToken, prNumber, reviewedHeadSha, mergeSha,
      } : null
      if (expectedSettlement) expectedSettlement.payloadDigest = activeCleanupPayloadDigest(expectedSettlement)
      const terminalAt = prior.rows[0].terminalAt instanceof Date
        ? prior.rows[0].terminalAt.toISOString() : String(prior.rows[0].terminalAt ?? "")
      const expectedCompletion = persisted ? {
        idempotencyKey: `${idempotencyKey}:completed`,
        settlementEventId: Number(prior.rows[0].id),
        settlementPayloadDigest: persisted.payloadDigest,
        checkpointEventId: Number(persisted.checkpointEventId),
        checkpointPayloadDigest: expectedCheckpoint.payloadDigest,
        cleanupProofDigest, outcomeId, userId: executionBinding.userId,
        outcomeKey: executionBinding.outcomeKey, workOrderId: executionBinding.activeWorkOrderId,
        workOrderRef, completedQueueVersion: expectedVersion + 1, fencingToken, terminalAt,
        prNumber, reviewedHeadSha, mergeSha,
      } : null
      if (expectedCompletion) expectedCompletion.payloadDigest = activeCleanupPayloadDigest(expectedCompletion)
      const completion = completions[0]
      if (!persisted || canonicalJson(checkpointMetadata) !== canonicalJson(expectedCheckpoint)
        || canonicalJson(persisted) !== canonicalJson(expectedSettlement)
        || completion?.actor !== "hermes-codex-bridge"
        || Number(completion?.id) <= Number(prior.rows[0].id)
        || canonicalJson(exactActiveCleanupCompletion(completion?.metadata))
          !== canonicalJson(expectedCompletion)
        || prior.rows[0].actor !== "hermes-codex-bridge"
        || prior.rows[0].checkpointActor !== "hermes-codex-bridge"
        || Number(prior.rows[0].version) !== expectedVersion + 1
        || Number(prior.rows[0].fencingToken) !== fencingToken
        || prior.rows[0].lifecycleState !== "completed"
        || prior.rows[0].lifecycleReason !== "COMPLETE"
        || prior.rows[0].terminalKey !== terminalKey
        || prior.rows[0].terminalResult !== "COMPLETE"
        || !Number.isFinite(Date.parse(terminalAt))
        || Number(prior.rows[0].terminalEvidenceId) !== Number(persisted?.checkpointEventId)
        || !exactStringArray(prior.rows[0].terminalEvidenceRefs,
          [runtimeEvidenceRef(outcomeId, runtimeAttempt, checkpointSequence)])
        || prior.rows[0].leaseHolder != null || prior.rows[0].leaseToken != null
        || prior.rows[0].leaseExpiresAt != null || prior.rows[0].goalStatus !== "converted"
        || prior.rows[0].workOrderStatus !== "closed" || prior.rows[0].workOrderResult !== "PASS"
        || prior.rows[0].workOrderCommitRef !== mergeSha
        || Number(prior.rows[0].latestCheckpointId) !== Number(persisted?.checkpointEventId)) throw wall()
      if (!(confirmationEventId < Number(persisted.checkpointEventId)
        && Number(persisted.checkpointEventId) < Number(prior.rows[0].id))) throw wall()
      await runQuery("COMMIT"); begun = false
      return { checkpointEventId: Number(persisted.checkpointEventId), queueVersion: expectedVersion + 1,
        fencingToken, settlementEventId: Number(prior.rows[0].id),
        completionEventId: Number(completion.id), completionPayloadDigest: expectedCompletion.payloadDigest,
        authorizationPayloadDigest: exactAuthorization.payloadDigest,
        confirmationPayloadDigest: expectedConfirmation.payloadDigest,
        payloadDigest: persisted.payloadDigest, replayed: true }
    }
    if (verifyOnly) throw wall()
    const graph = await runQuery(
      `SELECT g.id AS "goalId", g."userId" AS "userId", g.status AS "goalStatus",
          wo.id AS "workOrderId", wo.ref AS "workOrderRef", wo.status AS "workOrderStatus",
          q.version, q."fencingToken" AS "fencingToken", q."lifecycleState" AS "lifecycleState",
          q."lifecycleReason" AS "lifecycleReason",
          auth.id AS "authorizationId", auth.metadata AS "authorizationMetadata",
          confirmed.id AS "confirmationId", confirmed.metadata AS "confirmationMetadata"
       FROM goal g
       JOIN outcome_queue_item q ON q."userId" = g."userId" AND q."goalId" = g.id
       JOIN work_order wo ON wo."userId" = q."userId" AND wo.id = q."activeWorkOrderId"
       JOIN outcome_queue_mutation_receipt receipt ON receipt."userId" = q."userId"
         AND receipt."outcomeKey" = q."outcomeKey" AND receipt.operation = 'workbench_execution.authorize'
         AND receipt."requestBinding"->>'confirmation' = 'START_WORK'
         AND receipt."requestBinding"->>'outcomeKey' = q."outcomeKey"
         AND receipt."resultBinding"->>'grantRef' = q."authorityGrantRef"
         AND receipt."resultBinding"->>'decisionId' = q."approvalDecisionId"::text
         AND receipt."resultBinding"->'workContract'->>'id' = $14
         AND receipt."resultBinding"->'workContract'->>'digest' = $15
         AND receipt."resultBinding"->'workContract' = $16::jsonb
       JOIN authority_grant implementation_grant ON implementation_grant."userId" = q."userId"
         AND implementation_grant.id::text = receipt."resultBinding"->>'implementationGrantId'
         AND implementation_grant.ref = receipt."resultBinding"->>'implementationGrantRef'
       JOIN governance_event auth ON auth.id = $12 AND auth."userId" = q."userId"
         AND auth."entityType" = 'goal' AND auth."entityId"::text = g.id::text
         AND auth."eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED'
         AND auth.actor = 'hermes-codex-bridge'
       JOIN governance_event confirmed ON confirmed.id = $13 AND confirmed."userId" = q."userId"
         AND confirmed."entityType" = 'goal' AND confirmed."entityId"::text = g.id::text
         AND confirmed."eventType" = 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED'
         AND confirmed.actor = 'hermes-codex-bridge' AND confirmed.id > auth.id
       WHERE g.id = $1 AND g."userId" = $2 AND g.status = 'classified'
         AND q."outcomeKey" = $3 AND q.version = $4 AND q."fencingToken" = $5
         AND q."executionBinding" = $6 AND q."acquisitionKey" = $7
         AND q."leaseHolder" = $8 AND q."leaseToken" = $9
         AND q."lifecycleState" = 'active' AND q."lifecycleReason" = 'STALE_LEASE_RECOVERED'
         AND q."leaseExpiresAt" <= clock_timestamp()
         AND q."activeWorkOrderId" = $10 AND wo.ref = $11
         AND q."approvalState" = 'approved' AND q."authorityState" = 'matched'
         AND q."authorityLevel" = 'A2_WRITE_OWN' AND q."authoritySubject" = 'operator'
         AND q."authorityAction" = 'outcome:execute'
         AND EXISTS (SELECT 1 FROM decision d WHERE d.id = q."approvalDecisionId"
           AND d."userId" = q."userId" AND d.owner = q."userId" AND d.status = 'accepted'
           AND d.authority = 'binding' AND d.locked = true
           AND upper(trim(d.decision)) = 'APPROVE' AND d.scope = q."outcomeKey"
           AND d.tags = ARRAY['workbench','outcome','explicit-start-work']::text[])
         AND EXISTS (SELECT 1 FROM authority_grant grant_row
           WHERE grant_row."userId" = q."userId" AND grant_row.ref = q."authorityGrantRef"
             AND grant_row.status = 'active' AND grant_row."revokedAt" IS NULL
             AND grant_row."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp()
             AND grant_row."authorityLevel" = 'A2_WRITE_OWN'
             AND grant_row."grantedTo" = 'operator' AND grant_row.scope = q."outcomeKey"
             AND (grant_row."workOrderId" IS NULL OR grant_row."workOrderId" = q."activeWorkOrderId")
             AND grant_row."allowedActions" = ARRAY['outcome:execute']::text[]
             AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(grant_row."blockedActions", ARRAY[]::text[])) blocked(action)
               WHERE position(lower(blocked.action) IN 'outcome:execute') > 0))
         AND implementation_grant.status = 'active' AND implementation_grant."revokedAt" IS NULL
         AND implementation_grant."expiresAt" AT TIME ZONE 'UTC' > clock_timestamp()
         AND implementation_grant."authorityLevel" = 'A2_WRITE_OWN'
         AND implementation_grant."grantedTo" = 'operator' AND implementation_grant.scope = wo.ref
         AND (implementation_grant."workOrderId" IS NULL OR implementation_grant."workOrderId" = wo.id)
         AND implementation_grant."allowedActions" = ARRAY['implement']::text[]
         AND NOT EXISTS (SELECT 1 FROM unnest(COALESCE(implementation_grant."blockedActions", ARRAY[]::text[])) blocked(action)
           WHERE position(lower(blocked.action) IN 'implement') > 0)
       ORDER BY g.id LIMIT 2 FOR UPDATE OF g, q, wo`,
      [outcomeId, executionBinding.userId, executionBinding.outcomeKey, expectedVersion,
        fencingToken, executionBinding.executionBinding, executionBinding.acquisitionKey,
        executionBinding.leaseHolder, executionBinding.leaseToken,
        executionBinding.activeWorkOrderId, workOrderRef, authorizationEventId, confirmationEventId,
        workContract.id, workContract.digest, JSON.stringify(ACTIVE_CLEANUP_REGISTERED_CONTRACT)],
    )
    if (graph?.rows?.length !== 1) throw wall()
    const row = graph.rows[0]
    const auth = row.authorizationMetadata
    const rowConfirmation = row.confirmationMetadata
    const exactAuth = exactActiveCleanupAuthorization(auth)
    const exactConfirmation = exactActiveCleanupConfirmation(rowConfirmation)
    const expectedRowConfirmation = exactAuth
      ? activeCleanupConfirmationMetadata(exactAuth, authorizationEventId) : null
    if (Number(row.goalId) !== outcomeId || row.userId !== executionBinding.userId
      || row.goalStatus !== "classified" || Number(row.workOrderId) !== executionBinding.activeWorkOrderId
      || row.workOrderRef !== workOrderRef || Number(row.version) !== expectedVersion
      || Number(row.fencingToken) !== fencingToken || row.lifecycleState !== "active"
      || row.lifecycleReason !== "STALE_LEASE_RECOVERED" || !exactAuth || !exactConfirmation
      || exactAuth.cleanupProofDigest !== cleanupProofDigest
      || exactAuth.recoveryKind !== "active-post-merge-cleanup"
      || Number(exactAuth.outcomeId) !== outcomeId || exactAuth.userId !== executionBinding.userId
      || exactAuth.outcomeKey !== executionBinding.outcomeKey
      || Number(exactAuth.workOrderId) !== executionBinding.activeWorkOrderId
      || exactAuth.workOrderRef !== workOrderRef
      || exactAuth.executionBinding !== executionBinding.executionBinding
      || exactAuth.acquisitionKey !== executionBinding.acquisitionKey
      || exactAuth.leaseHolder !== executionBinding.leaseHolder
      || exactAuth.leaseToken !== executionBinding.leaseToken
      || Number(exactAuth.expectedVersion) !== expectedVersion
      || Number(exactAuth.fencingToken) !== fencingToken
      || Number(exactAuth.sourceExpectedVersion) !== executionBinding.reviewRecoverySourceExpectedVersion
      || Number(exactAuth.sourceFencingToken) !== executionBinding.reviewRecoverySourceFencingToken
      || Number(exactAuth.sourceRuntimeAttempt) !== executionBinding.reviewRecoverySourceRuntimeAttempt
      || Number(exactAuth.reclaimEventId) !== executionBinding.reviewRecoveryReclaimEventId
      || exactAuth.reclaimPayloadDigest !== executionBinding.reviewRecoveryReclaimPayloadDigest
      || exactAuth.baseCheckpointDigest !== executionBinding.reviewRecoveryStaleReacquisition?.checkpointDigest
      || exactAuth.continuationCheckpointDigest !== executionBinding.reviewRecoveryStaleContinuation?.checkpointDigest
      || canonicalJson(exactAuth.staleReacquisition)
        !== canonicalJson(executionBinding.reviewRecoveryStaleReacquisition)
      || canonicalJson(exactAuth.staleContinuation)
        !== canonicalJson(executionBinding.reviewRecoveryStaleContinuation)
      || !/^[0-9a-f]{64}$/.test(String(exactAuth.reviewRecoveryProofDigest ?? ""))
      || Number(exactAuth.prNumber) !== prNumber || exactAuth.reviewedHeadSha !== reviewedHeadSha
      || exactAuth.mergeSha !== mergeSha || typeof exactAuth.branch !== "string"
      || exactAuth.branch.trim() === "" || typeof exactAuth.worktreePath !== "string"
      || exactAuth.worktreePath.trim() === ""
      || exactAuth.workContractId !== workContract?.id
      || exactAuth.workContractDigest !== workContract?.digest
      || canonicalJson(exactConfirmation) !== canonicalJson(expectedRowConfirmation)) throw wall()
    const checkpointMetadata = {
      idempotencyKey: checkpointKey,
      outcomeId,
      workOrderRef,
      attempt: runtimeAttempt,
      checkpointSequence,
      checkpointState: "POST_MERGE_CLEANUP_RECOVERED",
      checkpointDetail: `PR #${prNumber}`,
      executionBinding: executionBinding.executionBinding,
      acquisitionKey: executionBinding.acquisitionKey,
      acquisitionFencingToken: fencingToken,
      workContractId: workContract.id,
      workContractDigest: workContract.digest,
      authorizationEventId,
      confirmationEventId,
      cleanupProofDigest,
      prNumber,
      headRefOid: reviewedHeadSha,
      mergeSha,
    }
    checkpointMetadata.payloadDigest = activeCleanupPayloadDigest(checkpointMetadata)
    const checkpoint = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       SELECT $1, 'HERMES_RUNTIME_CHECKPOINT', 'work_order', $2, 'hermes-codex-bridge', $3, $4::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM governance_event prior
         WHERE prior."userId" = $1 AND prior."entityType" = 'work_order'
           AND prior."entityId"::text = $2::text AND prior."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND prior.metadata->>'idempotencyKey' = $5) RETURNING id`,
      [executionBinding.userId, String(executionBinding.activeWorkOrderId),
        `Recovered guarded cleanup for PR #${prNumber}`, JSON.stringify(checkpointMetadata), checkpointKey],
    )
    if (checkpoint?.rows?.length !== 1) throw wall()
    const checkpointEventId = Number(checkpoint.rows[0].id)
    const completedQueue = await runQuery(
      `UPDATE outcome_queue_item SET "lifecycleState" = 'completed', "lifecycleReason" = 'COMPLETE',
          version = version + 1, "terminalKey" = $10, "terminalResult" = 'COMPLETE',
          "terminalEvidenceId" = $11, "terminalEvidenceRefs" = ARRAY[$12]::text[],
          "leaseHolder" = NULL, "leaseToken" = NULL, "leaseExpiresAt" = NULL,
          "terminalAt" = clock_timestamp(), "updatedAt" = NOW()
       WHERE "userId" = $1 AND "outcomeKey" = $2 AND version = $3
         AND "executionBinding" = $4 AND "acquisitionKey" = $5 AND "fencingToken" = $6
         AND "leaseHolder" = $7 AND "leaseToken" = $8 AND "activeWorkOrderId" = $9
         AND "lifecycleState" = 'active' AND "lifecycleReason" = 'STALE_LEASE_RECOVERED'
       RETURNING id, version, "fencingToken" AS "fencingToken", "terminalAt" AS "terminalAt"`,
      [executionBinding.userId, executionBinding.outcomeKey, expectedVersion,
        executionBinding.executionBinding, executionBinding.acquisitionKey, fencingToken,
        executionBinding.leaseHolder, executionBinding.leaseToken,
        executionBinding.activeWorkOrderId, terminalKey, checkpointEventId,
        runtimeEvidenceRef(outcomeId, runtimeAttempt, checkpointSequence)],
    )
    if (completedQueue?.rows?.length !== 1
      || Number(completedQueue.rows[0].version) !== expectedVersion + 1
      || Number(completedQueue.rows[0].fencingToken) !== fencingToken) throw wall()
    const completedGoal = await runQuery(
      `UPDATE goal SET status = 'converted', "updatedAt" = NOW()
       WHERE id = $1 AND "userId" = $2 AND status = 'classified' RETURNING id`,
      [outcomeId, executionBinding.userId],
    )
    if (completedGoal?.rows?.length !== 1) throw wall()
    const completedWorkOrder = await runQuery(
      `UPDATE work_order SET status = 'closed', result = 'PASS', "commitRef" = $3,
          "latestCheckpointId" = $4, "closedAt" = NOW(), "completedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $1 AND "userId" = $2 AND ref = $5 AND status IN ('active','approved','review')
       RETURNING id`,
      [executionBinding.activeWorkOrderId, executionBinding.userId, mergeSha,
        checkpointEventId, workOrderRef],
    )
    if (completedWorkOrder?.rows?.length !== 1) throw wall()
    const settlementMetadata = {
      idempotencyKey,
      authorizationEventId,
      confirmationEventId,
      checkpointEventId,
      checkpointPayloadDigest: checkpointMetadata.payloadDigest,
      cleanupProofDigest,
      outcomeId,
      userId: executionBinding.userId,
      outcomeKey: executionBinding.outcomeKey,
      workOrderId: executionBinding.activeWorkOrderId,
      workOrderRef,
      priorQueueVersion: expectedVersion,
      completedQueueVersion: expectedVersion + 1,
      fencingToken,
      prNumber,
      reviewedHeadSha,
      mergeSha,
    }
    settlementMetadata.payloadDigest = activeCleanupPayloadDigest(settlementMetadata)
    const settlement = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED', 'goal', $2,
         'hermes-codex-bridge', $3, $4::jsonb) RETURNING id`,
      [executionBinding.userId, String(outcomeId),
        `Completed merged PR #${prNumber} after guarded cleanup`, JSON.stringify(settlementMetadata)],
    )
    if (settlement?.rows?.length !== 1) throw wall()
    const settlementEventId = Number(settlement.rows[0].id)
    const terminalAt = completedQueue.rows[0].terminalAt instanceof Date
      ? completedQueue.rows[0].terminalAt.toISOString() : String(completedQueue.rows[0].terminalAt ?? "")
    if (!Number.isFinite(Date.parse(terminalAt))) throw wall()
    const completionMetadata = {
      idempotencyKey: `${idempotencyKey}:completed`, settlementEventId,
      settlementPayloadDigest: settlementMetadata.payloadDigest, checkpointEventId,
      checkpointPayloadDigest: checkpointMetadata.payloadDigest, cleanupProofDigest,
      outcomeId, userId: executionBinding.userId, outcomeKey: executionBinding.outcomeKey,
      workOrderId: executionBinding.activeWorkOrderId, workOrderRef,
      completedQueueVersion: expectedVersion + 1, fencingToken, terminalAt,
      prNumber, reviewedHeadSha, mergeSha,
    }
    completionMetadata.payloadDigest = activeCleanupPayloadDigest(completionMetadata)
    const completion = await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_COMPLETED', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)
       RETURNING id`,
      [executionBinding.userId, String(outcomeId),
        `Completed goal-${outcomeId} through active post-merge cleanup`,
        JSON.stringify(completionMetadata)],
    )
    if (completion?.rows?.length !== 1
      || !Number.isSafeInteger(Number(completion.rows[0].id))) throw wall()
    await runQuery("COMMIT"); begun = false
    return { checkpointEventId, queueVersion: expectedVersion + 1, fencingToken,
      settlementEventId, payloadDigest: settlementMetadata.payloadDigest,
      completionEventId: Number(completion.rows[0].id),
      completionPayloadDigest: completionMetadata.payloadDigest,
      replayed: false }
  } catch (error) {
    if (begun) { try { await runQuery("ROLLBACK") } catch {} }
    throw error
  } finally {
    client?.release(); if (pool) await pool.end()
  }
}

export async function verifyActivePostMergeCleanupSettlement(options = {}) {
  const result = await settleActivePostMergeCleanupOutcome({ ...options, verifyOnly: true })
  if (result.replayed !== true) {
    throw Object.assign(new Error("Active post-merge cleanup settlement is absent"), {
      code: "OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLEMENT_WALL",
    })
  }
  return result
}

export async function resolveActivePostMergeCleanupSettlement({
  query,
  databaseUrl = process.env.DATABASE_URL,
  outcomeId,
  executionBinding,
  workContract,
  cleanupProofDigest,
  runtimeAttempt,
  checkpointSequence,
  prNumber,
  reviewedHeadSha,
  mergeSha,
} = {}) {
  const wall = () => Object.assign(new Error("Active post-merge cleanup settlement conflicts"), {
    code: "OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLEMENT_WALL",
  })
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0
    || !executionBinding || typeof executionBinding.userId !== "string") throw wall()
  let runQuery = normalizeQuery(query)
  let pool
  try {
    if (!runQuery) {
      if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
        throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
      }
      const { Pool } = await import("pg")
      pool = createHermesDatabasePool(Pool, databaseUrl)
      runQuery = pool.query.bind(pool)
    }
    const chain = await runQuery(
      `SELECT id, "eventType", actor, metadata FROM governance_event
       WHERE "userId" = $1 AND "entityType" = 'goal' AND "entityId"::text = $2
         AND "eventType" IN ('HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED',
           'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED',
           'HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED', 'HERMES_OUTCOME_COMPLETED')
       ORDER BY id`,
      [executionBinding.userId, String(outcomeId)],
    )
    const rows = Array.isArray(chain?.rows) ? chain.rows : []
    const ofType = (eventType) => rows.filter((row) => row.eventType === eventType)
    const authorizations = ofType("HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_AUTHORIZED")
    const confirmations = ofType("HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_CONFIRMED")
    const settlements = ofType("HERMES_OUTCOME_ACTIVE_POST_MERGE_CLEANUP_SETTLED")
    const completions = ofType("HERMES_OUTCOME_COMPLETED")
    if (authorizations.length === 0 && confirmations.length === 0
      && settlements.length === 0 && completions.length === 0) return null
    if (authorizations.length !== 1 || confirmations.length !== 1
      || settlements.length !== 1 || completions.length !== 1) throw wall()
    const authorization = authorizations[0]
    const auth = exactActiveCleanupAuthorization(authorization.metadata)
    if (authorization.actor !== "hermes-codex-bridge" || !auth
      || auth.outcomeId !== outcomeId || auth.userId !== executionBinding.userId
      || auth.outcomeKey !== executionBinding.outcomeKey
      || auth.workOrderId !== executionBinding.activeWorkOrderId
      || auth.executionBinding !== executionBinding.executionBinding
      || auth.acquisitionKey !== executionBinding.acquisitionKey
      || auth.leaseHolder !== executionBinding.leaseHolder
      || auth.leaseToken !== executionBinding.leaseToken
      || auth.sourceExpectedVersion !== executionBinding.reviewRecoverySourceExpectedVersion
      || auth.sourceFencingToken !== executionBinding.reviewRecoverySourceFencingToken
      || auth.sourceRuntimeAttempt !== executionBinding.reviewRecoverySourceRuntimeAttempt
      || auth.reclaimEventId !== executionBinding.reviewRecoveryReclaimEventId
      || auth.reclaimPayloadDigest !== executionBinding.reviewRecoveryReclaimPayloadDigest
      || auth.cleanupProofDigest !== cleanupProofDigest
      || auth.prNumber !== prNumber || auth.reviewedHeadSha !== reviewedHeadSha
      || auth.mergeSha !== mergeSha) throw wall()
    const markerless = executionBinding.reviewRecoveryStaleReacquisition === undefined
      && executionBinding.reviewRecoveryStaleContinuation === undefined
      && executionBinding.expectedVersion + 1 === auth.expectedVersion
      && executionBinding.fencingToken + 1 === auth.fencingToken
    const baseMarked = canonicalJson(executionBinding.reviewRecoveryStaleReacquisition)
        === canonicalJson(auth.staleReacquisition)
      && executionBinding.reviewRecoveryStaleContinuation === undefined
      && executionBinding.expectedVersion + 1 === auth.expectedVersion
      && executionBinding.fencingToken + 1 === auth.fencingToken
    const marked = executionBinding.expectedVersion === auth.expectedVersion
      && executionBinding.fencingToken === auth.fencingToken
      && canonicalJson(executionBinding.reviewRecoveryStaleReacquisition)
        === canonicalJson(auth.staleReacquisition)
      && canonicalJson(executionBinding.reviewRecoveryStaleContinuation)
        === canonicalJson(auth.staleContinuation)
    if ((!markerless && !baseMarked && !marked)
      || !auth.staleReacquisition || !auth.staleContinuation) throw wall()
    const resolvedExecutionBinding = {
      ...executionBinding,
      expectedVersion: auth.expectedVersion,
      fencingToken: auth.fencingToken,
      reviewRecoveryStaleReacquisition: auth.staleReacquisition,
      reviewRecoveryStaleContinuation: auth.staleContinuation,
    }
    try {
      normalizeRuntimeExecutionBinding(resolvedExecutionBinding)
    } catch {
      throw wall()
    }
    const result = await verifyActivePostMergeCleanupSettlement({
      query: runQuery, outcomeId, executionBinding: resolvedExecutionBinding, workContract,
      authorizationEventId: Number(authorization.id), confirmationEventId: Number(confirmations[0].id),
      cleanupProofDigest, expectedVersion: auth.expectedVersion, fencingToken: auth.fencingToken,
      runtimeAttempt, checkpointSequence, prNumber, reviewedHeadSha, mergeSha,
    })
    return { ...result, executionBinding: resolvedExecutionBinding,
      authorizationEventId: Number(authorization.id), confirmationEventId: Number(confirmations[0].id) }
  } finally {
    if (pool) await pool.end()
  }
}

export const persistOutcomeRuntimeProjection = projectOutcomeRuntimeCheckpoint
export const recoverReviewRemediationOutcome = recoverReviewedOutcome
export const fetchNextEligibleOutcome = selectNextOutcome
export const readNextOutcome = selectNextOutcome
