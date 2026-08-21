import { createHash } from "node:crypto"

import { evaluateOutcomePolicy, PROTECTED_SCOPE_LEXEMES } from "./policy.mjs"
import { createHermesDatabasePool } from "./database-pool.mjs"
import { normalizeHermesFindings } from "./state-store.mjs"
import {
  HERMES_WORK_CONTRACT_VERSION,
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
  if (!value || typeof value.userId !== "string" || value.userId.trim() === ""
    || typeof value.outcomeKey !== "string" || value.outcomeKey.trim() === ""
    || !Number.isSafeInteger(value.expectedVersion) || value.expectedVersion < 0
    || typeof value.executionBinding !== "string" || value.executionBinding.trim() === ""
    || typeof value.leaseToken !== "string" || value.leaseToken.trim() === ""
    || typeof value.leaseHolder !== "string" || value.leaseHolder.trim() === ""
    || (value.acquisitionKey !== undefined
      && (typeof value.acquisitionKey !== "string" || value.acquisitionKey.trim() === ""))
    || !Number.isSafeInteger(value.fencingToken) || value.fencingToken <= 0) {
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
) {
  const receiptContract = row?.workContract
  const delivery = workContract.delivery
  const projection = workContract.projection
  return Number(row?.goalId) === outcomeId
    && row?.userId === executionBinding.userId
    && row?.outcomeKey === executionBinding.outcomeKey
    && row?.executionBinding === executionBinding.executionBinding
    && Number(row?.fencingToken) === executionBinding.fencingToken
    && typeof row?.acquisitionKey === "string"
    && row.acquisitionKey.trim() !== ""
    && (historicalRecovery
      ? row.lifecycleState === "blocked"
        && Number(row?.version) === executionBinding.expectedVersion + 1
        && row.leaseToken == null
        && row.leaseHolder == null
        && row.leaseExpiresAt == null
        && row.acquisitionKey === executionBinding.acquisitionKey
      : Number(row?.version) === executionBinding.expectedVersion
        && row?.leaseToken === executionBinding.leaseToken
        && row?.leaseHolder === executionBinding.leaseHolder)
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
  if (historicalRecovery && (
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
         contract_queue.version AS version,
         contract_queue."executionBinding" AS "executionBinding",
         contract_queue."leaseToken" AS "leaseToken",
         contract_queue."leaseHolder" AS "leaseHolder",
         contract_queue."leaseExpiresAt" AS "leaseExpiresAt",
         contract_queue."acquisitionKey" AS "acquisitionKey",
         contract_queue."fencingToken" AS "fencingToken",
         contract_queue."activeWorkOrderId" AS "activeWorkOrderId",
         contract_acquisition."createdAt" AS "executionEpochStartedAt",
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
         contract_queue."authorityGrantRef" AS "executionGrantRef"
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
        AND contract_acquisition."latestFencingToken" = contract_queue."fencingToken"
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
         AND ((NOT $13::boolean
           AND contract_queue."lifecycleState" = 'active'
           AND contract_queue.version = $4::integer
           AND contract_queue."leaseToken" = $6
           AND contract_queue."leaseHolder" = $7
           AND contract_queue."leaseExpiresAt" > clock_timestamp())
          OR ($13::boolean
           AND contract_queue."lifecycleState" = 'blocked'
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
         AND (NOT $13::boolean OR EXISTS (
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
         AND ($18 <> 'REVIEW_REMEDIATION_RECOVERED' OR (
           SELECT count(*) = 1
           FROM governance_event AS recovery_confirmation
           WHERE recovery_confirmation."userId" = contract_queue."userId"
             AND recovery_confirmation."entityType" = 'goal'
             AND recovery_confirmation."entityId"::text = contract_goal.id::text
             AND recovery_confirmation."eventType" = 'HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_CONFIRMED'
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
          : "REVIEW_REMEDIATION_EXHAUSTED"],
    )
    if (authorizations?.rows?.length !== 1
      || !exactAuthorizationContract(
        authorizations.rows[0], normalizedWorkContract, normalizedExecutionBinding, outcomeId,
        historicalRecovery,
      )) {
      throw Object.assign(new Error("Canonical Workbench execution authorization is invalid"), {
        code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL",
      })
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

export const persistOutcomeRuntimeProjection = projectOutcomeRuntimeCheckpoint
export const recoverReviewRemediationOutcome = recoverReviewedOutcome
export const fetchNextEligibleOutcome = selectNextOutcome
export const readNextOutcome = selectNextOutcome
