import { createHash } from "node:crypto"

import { evaluateOutcomePolicy } from "./policy.mjs"

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
  return packet
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

function normalizedTimestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""))
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
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
  workOrderId,
  terminalEventId,
  ownerUserId,
  choice,
  expectedNextState,
} = {}) {
  validateOwnerDecisionInput({ outcomeId, workOrderId, terminalEventId, ownerUserId, choice, expectedNextState })
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
  ]
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
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
         SELECT id, "userId" AS "goalUserId", status, ref
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
       SELECT goal_any.id AS "goalId", goal_any."goalUserId", goal_any.status AS "goalStatus",
         goal_any.ref AS "goalRef", work_order_any.id AS "workOrderId",
         work_order_any."workOrderUserId", work_order_any.ref AS "workOrderRef",
         work_order_any.status AS "workOrderStatus",
         work_order_any."linkedDecisionId" AS "workOrderLinkedDecisionId",
         latest_terminal.id AS "latestTerminalId",
         latest_terminal."terminalUserId", latest_terminal.metadata AS "latestTerminalMetadata",
         requested_terminal.id AS "requestedTerminalId", requested_terminal."requestedTerminalUserId",
         requested_terminal.metadata AS "requestedTerminalMetadata",
         latest_lease.metadata AS "latestLeaseMetadata",
         prior_request."decisionId", prior_request."decisionRef", prior_request.status AS "priorStatus",
         prior_request.decision AS "priorChoice", prior_request.authority AS "priorAuthority",
         prior_request.scope AS "priorScope", prior_request.evidence AS "priorEvidence",
         prior_request."decidedAt" AS "priorDecidedAt",
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
        LEFT JOIN prior_request ON TRUE
        LEFT JOIN consumed_binding ON TRUE
        LEFT JOIN linked_work_order_decision ON TRUE`,
      [outcomeId, workOrderId, terminalEventId, ownerUserId, requestKey, terminalKey],
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
    const decisionPacketDigest = ownerDecisionPacketDigest(decisionPacket)
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
      `INSERT INTO decision
         ("userId", ref, title, context, decision, rationale, status, authority, owner, scope, evidence, tags, "decidedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'binding', $1, $8, $9::text[], $10::text[], NOW())
       RETURNING id, ref, status, decision, "decidedAt"`,
      [
        ownerUserId,
        decisionRef,
        `Owner authority decision for ${terminalKey}`,
        JSON.stringify({
          outcomeId, workOrderId, terminalEventId, expectedNextState, requestKey,
          decisionPacket, decisionPacketDigest,
        }),
        choice,
        choice === "APPROVE" ? "Owner approved the exact persisted terminal scope." : "Owner denied the exact persisted terminal scope.",
        status,
        scope,
        evidence,
        ["HERMES_OWNER_AUTHORITY_DECISION", choice],
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
    pool = new Pool({ connectionString: databaseUrl })
    runQuery = pool.query.bind(pool)
  }
  try {
    const result = await runQuery(
      `WITH latest_terminal AS (
       SELECT id, metadata
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
         d."decidedAt", g.id AS "outcomeId", wo.id AS "workOrderId",
         terminal.id AS "terminalEventId", terminal.metadata AS "terminalMetadata",
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
    const expectedEvidence = decisionPacketDigest ? [
      `outcome:${outcomeId}`,
      `work-order:${resolvedWorkOrderId}`,
      `terminal-event:${resolvedTerminalEventId}`,
      `next-state:${expectedNextState}`,
      `request:${requestKey}`,
      `terminal-binding:${ownerDecisionTerminalKey({
        outcomeId, workOrderId: resolvedWorkOrderId, terminalEventId: resolvedTerminalEventId,
      })}`,
      "choice:APPROVE",
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
    pool = new Pool({ connectionString: databaseUrl })
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
    pool = new Pool({ connectionString: databaseUrl })
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
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
  }
  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
      await runQuery("BEGIN")
    }
    const updated = await runQuery(
      `UPDATE goal SET status = 'dismissed', "updatedAt" = NOW()
       WHERE id = $1 AND status = 'classified'
       RETURNING id, "userId" AS "userId", ref`,
      [outcomeId],
    )
    const row = updated?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT EXISTS (
           SELECT 1
           FROM goal g
           JOIN governance_event terminal
             ON terminal."entityType" = 'goal' AND terminal."entityId"::text = g.id::text
               AND terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
               AND terminal.metadata->>'result' = $2
               AND (terminal.metadata->>'nextState') IS NOT DISTINCT FROM $3
               AND terminal.metadata = $4::jsonb
           WHERE g.id = $1 AND g.status = 'dismissed'
         ) AS terminalized`,
        [outcomeId, result, nextState ?? null, JSON.stringify(terminalMetadata)],
      )
      const alreadyTerminalized = prior?.rows?.[0]?.terminalized === true
      if (client) await runQuery(alreadyTerminalized ? "COMMIT" : "ROLLBACK")
      return alreadyTerminalized
    }
    await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_TERMINAL', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(row.id), `${result} for ${row.ref ?? `goal-${row.id}`}`, JSON.stringify(terminalMetadata)],
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
    pool = new Pool({ connectionString: databaseUrl })
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
    pool = new Pool({ connectionString: databaseUrl })
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
    pool = new Pool({ connectionString: databaseUrl })
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
  query,
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
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
    runQuery = pool.query.bind(pool)
  }
  try {
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
           AND prior.id > candidate."terminalId"
       )
       RETURNING id`,
      [outcomeId, expectedNextState,
        JSON.stringify({ retryState: expectedNextState, proofDigest, fencingToken }), proofDigest],
    )
    if (recorded?.rows?.length > 0) return true
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
           AND proof.metadata->>'proofDigest' = $2 AND proof.id > terminal.id
       ) AS recorded`,
      [outcomeId, proofDigest],
    )
    return prior?.rows?.[0]?.recorded === true
  } finally {
    if (pool) await pool.end()
  }
}

const COMMIT_SHA = /^[0-9a-f]{40}$/
const PROJECTION_STATE = /^[A-Z][A-Z0-9_]{1,79}$/
const REVIEW_REMEDIATION_EXHAUSTED = "REVIEW_REMEDIATION_EXHAUSTED"
const SENSITIVE_RUNTIME_EVIDENCE = /(?:ghp_|github_pat_|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:token|password|secret)\s*[:=]\s*\S+|\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s@/]*:[^@\s/]+@)/i

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
    if (value !== undefined && (typeof value !== "string" || !COMMIT_SHA.test(value))) {
      throw Object.assign(new Error(`checkpoint ${field} is invalid`), { code: "OUTCOME_PROJECTION_EVIDENCE_INVALID" })
    }
    if (value !== undefined) hashes[field] = value
  }
  return { ...(prNumber === undefined ? {} : { prNumber }), ...hashes }
}

function projectionEvidenceLabels(evidence) {
  return [
    ...(evidence.prNumber === undefined ? [] : [`pull-request:#${evidence.prNumber}`]),
    ...(evidence.commit === undefined ? [] : [`commit:${evidence.commit}`]),
    ...(evidence.priorHeadRefOid === undefined ? [] : [`prior-reviewed-head:${evidence.priorHeadRefOid}`]),
    ...(evidence.headRefOid === undefined ? [] : [`reviewed-head:${evidence.headRefOid}`]),
    ...(evidence.mergeSha === undefined ? [] : [`merge:${evidence.mergeSha}`]),
  ]
}

function projectionPayloadDigest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function runtimeEvidenceRef(outcomeId, attempt, checkpointSequence) {
  return `EV-HERMES-${outcomeId}-${attempt}-${checkpointSequence}`
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

  const ref = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:attempt:${attempt}:checkpoint:${checkpoint.sequence}`
  const evidence = checkpointEvidence(checkpoint.metadata)
  const projection = projectionForCheckpoint(checkpoint.state)
  const commitRef = evidence.mergeSha ?? evidence.commit ?? evidence.headRefOid ?? null
  const labels = projectionEvidenceLabels(evidence)
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [ref])
    await runQuery(
      `INSERT INTO work_order
         ("userId", ref, title, description, goal, lane, status, assignee, agent, "updatedAt")
       SELECT g."userId", $2, COALESCE(NULLIF(g.command, ''), 'Hermes outcome ' || g.id::text),
         'Durable runtime projection for ' || COALESCE(g.ref, 'goal-' || g.id::text),
         g.ref, g.lane, 'active', 'hermes-codex-bridge', 'codex', NOW()
       FROM goal g
       WHERE g.id = $1::integer
         AND NOT EXISTS (
           SELECT 1 FROM work_order existing
           WHERE existing."userId" = g."userId" AND existing.ref = $2
         )
       RETURNING id`,
      [outcomeId, ref],
    )
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
    const eventMetadata = {
      idempotencyKey,
      outcomeId,
      workOrderRef: ref,
      attempt,
      checkpointSequence: checkpoint.sequence,
      checkpointState: checkpoint.state,
      checkpointDetail: checkpoint.detail ?? null,
      ...evidence,
    }
    eventMetadata.payloadDigest = projectionPayloadDigest(eventMetadata)
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
        `SELECT metadata->>'payloadDigest' AS "payloadDigest"
         FROM governance_event
         WHERE "entityType" = 'work_order' AND "entityId"::text = $1::text
           AND "eventType" = 'HERMES_RUNTIME_CHECKPOINT'
           AND metadata->>'idempotencyKey' = $2`,
        [String(workOrder.id), idempotencyKey],
      )
      if (prior?.rows?.length !== 1
        || prior.rows[0].payloadDigest !== eventMetadata.payloadDigest) {
        throw Object.assign(new Error("Runtime checkpoint replay conflicts with persisted evidence"), {
          code: "OUTCOME_PROJECTION_IDEMPOTENCY_CONFLICT",
        })
      }
    }
    if (eventInserted) {
      await runQuery(
        `UPDATE work_order
         SET status = $2,
           result = $3,
           "commitRef" = COALESCE($4, "commitRef"),
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
               AND (
                 (newer.metadata->>'attempt')::integer > $6
                 OR (
                   (newer.metadata->>'attempt')::integer = $6
                   AND (newer.metadata->>'checkpointSequence')::integer > $7
                 )
               )
           )`,
        [workOrder.id, projection.status, projection.result, commitRef, labels, attempt, checkpoint.sequence],
      )
      if (failureEval) {
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
        contentHash: eventMetadata.payloadDigest,
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
    if (runQuery) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
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

  const ref = outcomeWorkOrderRef(outcomeId)
  const leaseExpiresAt = new Date(lease.expiresAt).toISOString()
  const idempotencyKey = [
    `hermes-outcome:${outcomeId}`,
    `attempt:${attempt}`,
    `lease:${lease.status}`,
    `checkpoint:${checkpointSequence}`,
    `expires:${Date.parse(leaseExpiresAt)}`,
  ].join(":")
  const eventMetadata = {
    idempotencyKey,
    outcomeId,
    workOrderRef: ref,
    attempt,
    checkpointSequence,
    leaseStatus: lease.status,
    leaseExpiresAt,
  }
  eventMetadata.payloadDigest = projectionPayloadDigest(eventMetadata)
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
  }

  try {
    if (pool) {
      client = await pool.connect()
      runQuery = client.query.bind(client)
    }
    await runQuery("BEGIN")
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
    if (runQuery) {
      try { await runQuery("ROLLBACK") } catch {}
    }
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
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
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) {
    throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  }
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0
    || typeof reviewedHeadSha !== "string" || !COMMIT_SHA.test(reviewedHeadSha)
    || typeof mergeSha !== "string" || !COMMIT_SHA.test(mergeSha)) {
    throw Object.assign(new Error("review recovery evidence is invalid"), { code: "OUTCOME_REVIEW_RECOVERY_EVIDENCE_INVALID" })
  }

  const ref = outcomeWorkOrderRef(outcomeId)
  const idempotencyKey = `hermes-outcome:${outcomeId}:review-recovery:pr:${prNumber}:head:${reviewedHeadSha}:merge:${mergeSha}`
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      throw Object.assign(new Error("DATABASE_URL is required"), { code: "DATABASE_URL_REQUIRED" })
    }
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
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
    const row = recovered?.rows?.[0]
    if (!row) {
      const prior = await runQuery(
        `SELECT EXISTS (
           SELECT 1 FROM goal g
           JOIN governance_event recovered
             ON recovered."entityType" = 'goal' AND recovered."entityId"::text = g.id::text
            AND recovered."eventType" = 'HERMES_OUTCOME_REVIEW_RECOVERED'
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
       VALUES ($1, 'HERMES_OUTCOME_REVIEW_RECOVERED', 'goal', $2,
         'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(outcomeId), `Released exact reviewed and merged PR #${prNumber} for normal finalization`,
        JSON.stringify({ idempotencyKey, workOrderRef: ref, prNumber, reviewedHeadSha, mergeSha })],
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
