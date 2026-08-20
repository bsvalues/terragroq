import { createHash } from "node:crypto"

import { createHermesDatabasePool } from "./database-pool.mjs"
import {
  isVerifiedPrimaryDecisionResponse,
  primaryDecisionRequestDigest,
} from "./primary-decision-provenance.mjs"

export const RUNTIME_FINDING_DECISION_SOURCE_KIND = "RUNTIME_FINDING"
export const RUNTIME_FINDING_ACTIONABILITY_PROJECTION_ID = "RUNTIME_FINDING_ACTIONABILITY_V1"
export const RUNTIME_FINDING_ACTIONABILITY_VERSION = 1
export const RUNTIME_FINDING_DECISION_PROTECTED_TAG = "RUNTIME_FINDING_OWNER_DECISION"

export function runtimeFindingDecisionScope(gateSettlementEventId) {
  if (!Number.isSafeInteger(gateSettlementEventId) || gateSettlementEventId <= 0) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  return `runtime-finding:${gateSettlementEventId}`
}

export function isProtectedRuntimeFindingDecision(row) {
  const match = /^RUNTIME-FINDING-DECISION-([1-9][0-9]*)$/.exec(String(row?.ref ?? ""))
  if (!match) return false
  const gateSettlementEventId = Number(match[1])
  return Number.isSafeInteger(gateSettlementEventId)
    && row?.locked === true
    && row?.scope === runtimeFindingDecisionScope(gateSettlementEventId)
    && JSON.stringify(row?.tags) === JSON.stringify([
      RUNTIME_FINDING_DECISION_PROTECTED_TAG,
      row?.decision,
    ])
    && ["APPROVE", "DENY"].includes(row?.decision)
}

function wall(code) {
  throw Object.assign(new Error(code), { code })
}

function normalizeQuery(query) {
  if (typeof query === "function") return query
  if (query && typeof query.query === "function") return query.query.bind(query)
  return null
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sourceDigest(metadata) {
  return sha256(JSON.stringify(metadata))
}

function timestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""))
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function decisionPacket() {
  return Object.freeze({
    blockedAction: "Authorize materialization of the gated runtime finding.",
    authorityBoundary: "This finding requires owner authority before bounded work may be materialized.",
    minimumChoice: "APPROVE_OR_DENY",
    approveConsequence: "Record authority materialization as required without executing gated work.",
    denyConsequence: "Resolve the gated finding as denied without executing gated work.",
  })
}

function normalizedGates(value) {
  if (!Array.isArray(value) || value.length === 0) wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  const gates = [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))].sort()
  if (gates.length === 0 || gates.some((entry) => !/^[A-Z][A-Z0-9_]{1,79}$/.test(entry))) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  return gates
}

export function projectRuntimeFindingActionability(row, gates = normalizedGates(row?.gates)) {
  const projection = {
    id: RUNTIME_FINDING_ACTIONABILITY_PROJECTION_ID,
    version: RUNTIME_FINDING_ACTIONABILITY_VERSION,
    parentWorkOrderRowId: Number(row.parentWorkOrderRowId),
    parentWorkOrderRef: row.parentWorkOrderRef,
    authorityGrantId: Number(row.authorityGrantId),
    authorityGrantRef: row.authorityGrantRef,
    authorityGrantLevel: row.authorityGrantLevel,
    sourceFindingEventId: Number(row.sourceFindingEventId),
    gateSettlementEventId: Number(row.gateSettlementEventId),
    findingId: row.findingId,
    sequence: Number(row.sequence),
    gates,
    routineSiblingState: "SETTLED",
  }
  return Object.freeze({ ...projection, digest: sha256(canonicalJson(projection)) })
}

function validateCandidate(row) {
  const ids = [row.parentWorkOrderRowId, row.sourceFindingEventId, row.gateSettlementEventId,
    row.authorityGrantId]
    .map(Number)
  const sequence = Number(row.sequence)
  const issuedAt = timestamp(row.issuedAt)
  const gates = normalizedGates(row.gates)
  if (ids.some((value) => !Number.isSafeInteger(value) || value <= 0)
    || !Number.isSafeInteger(sequence) || sequence <= 0
    || typeof row.ownerUserId !== "string" || row.ownerUserId.trim() === ""
    || typeof row.parentWorkOrderRef !== "string" || row.parentWorkOrderRef.trim() === ""
    || typeof row.authorityGrantRef !== "string" || row.authorityGrantRef.trim() === ""
    || typeof row.authorityGrantLevel !== "string" || row.authorityGrantLevel.trim() === ""
    || typeof row.findingId !== "string" || row.findingId.trim() === ""
    || typeof row.gate !== "string" || !gates.includes(row.gate)
    || typeof row.gatePayloadDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.gatePayloadDigest)
    || !row.gateMetadata || typeof row.gateMetadata !== "object" || Array.isArray(row.gateMetadata)
    || !row.sourceMetadata || typeof row.sourceMetadata !== "object" || Array.isArray(row.sourceMetadata)
    || row.sourceMetadata.findingId !== row.findingId
    || row.sourceMetadata.objectiveWorkOrderId !== row.parentWorkOrderRef
    || Number(row.sourceMetadata.sequence) !== sequence
    || !issuedAt) wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  const canonicalGate = {
    sourceFindingEventId: ids[1],
    sourceUserId: row.ownerUserId,
    findingId: row.findingId,
    objectiveWorkOrderId: row.parentWorkOrderRef,
    issueNumber: row.gateMetadata.issueNumber,
    gate: row.gate,
    gates,
    reason: row.gateMetadata.reason,
  }
  if (sourceDigest(canonicalGate) !== row.gatePayloadDigest) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  const calculatedSourceDigest = sourceDigest(row.sourceMetadata)
  if (typeof row.sourcePayloadDigest === "string" && row.sourcePayloadDigest !== calculatedSourceDigest) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  return { ids, sequence, issuedAt, gates, sourcePayloadDigest: calculatedSourceDigest }
}

export async function readPendingRuntimeFindingDecisionRequest({
  query,
  databaseUrl = process.env.DATABASE_URL,
  ownerEmail,
  includeDecided = false,
  exactGateSettlementEventId = null,
} = {}) {
  if (typeof ownerEmail !== "string" || ownerEmail.trim() === "") wall("PRIMARY_DECISION_OWNER_INVALID")
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") wall("DATABASE_URL_REQUIRED")
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  if (exactGateSettlementEventId !== null
    && (!Number.isSafeInteger(exactGateSettlementEventId) || exactGateSettlementEventId <= 0)) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  try {
    const result = await runQuery(
      `SELECT gate.id AS "gateSettlementEventId", gate."createdAt" AS "issuedAt",
         gate."userId" AS "ownerUserId", gate.metadata AS "gateMetadata",
         gate.metadata->>'payloadDigest' AS "gatePayloadDigest",
         gate.metadata->>'findingId' AS "findingId", gate.metadata->>'gate' AS gate,
         gate.metadata->'gates' AS gates,
         (gate.metadata->>'sourceFindingEventId')::integer AS "sourceFindingEventId",
         source.metadata AS "sourceMetadata", parent.id AS "parentWorkOrderRowId",
         parent.ref AS "parentWorkOrderRef", grant_row.id AS "authorityGrantId",
         grant_row.ref AS "authorityGrantRef", grant_row."authorityLevel" AS "authorityGrantLevel",
         (source.metadata->>'sequence')::integer AS sequence
       FROM governance_event gate
       JOIN "user" owner ON owner.id = gate."userId" AND lower(owner.email) = lower($1)
       JOIN governance_event source ON source.id = (gate.metadata->>'sourceFindingEventId')::integer
         AND source."userId" = gate."userId"
         AND source.actor IN ('hermes', 'williamos-runtime-operator')
         AND source."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
         AND source."entityType" = 'work_order'
         AND source.metadata->>'findingId' = gate.metadata->>'findingId'
         AND source.metadata->>'objectiveWorkOrderId' = gate.metadata->>'objectiveWorkOrderId'
       JOIN work_order parent ON parent.id::text = source."entityId"
         AND parent."userId" = source."userId"
         AND parent.ref = source.metadata->>'objectiveWorkOrderId'
       JOIN authority_grant grant_row ON grant_row.id = parent."authorityGrantId"
         AND grant_row."userId" = parent."userId"
         AND grant_row."authorityLevel" = parent."authorityLevel"
         AND grant_row.scope = parent.ref
         AND grant_row.status = 'active'
         AND grant_row."revokedAt" IS NULL
         AND (grant_row."expiresAt" IS NULL OR grant_row."expiresAt" > clock_timestamp())
         AND (cardinality(grant_row."allowedActions") = 0 OR 'implement' = ANY(grant_row."allowedActions"))
         AND NOT ('implement' = ANY(grant_row."blockedActions"))
       WHERE gate."eventType" = 'RUNTIME_FINDING_OWNER_GATED'
         AND gate."entityType" = 'work_order'
         AND gate.actor = 'williamos-runtime-operator'
         AND gate."entityId"::text = parent.id::text
         AND gate.metadata->>'sourceUserId' = gate."userId"::text
         AND parent.status IN ('active', 'approved')
         AND parent."authorityGranted" IN ('A2_WRITE_OWN', 'A3_INTEGRATE')
         AND parent."authorityGranted" = parent."authorityLevel"
         AND ($3::integer IS NULL OR gate.id = $3::integer)
         AND ($2::boolean OR NOT EXISTS (
           SELECT 1 FROM governance_event receipt
           WHERE receipt."userId" = gate."userId"
             AND receipt."eventType" = 'RUNTIME_FINDING_OWNER_DECIDED'
             AND (receipt.metadata->>'gateSettlementEventId')::integer = gate.id
         ))
         AND NOT EXISTS (
           SELECT 1 FROM governance_event sibling
           WHERE sibling."userId" = gate."userId"
             AND sibling."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
             AND sibling.metadata->>'objectiveWorkOrderId' = parent.ref
             AND sibling.id <> source.id
             AND NOT EXISTS (
               SELECT 1 FROM governance_event sibling_settlement
               WHERE sibling_settlement."userId" = sibling."userId"
                 AND sibling_settlement."eventType" IN ('RUNTIME_FINDING_DERIVED', 'RUNTIME_FINDING_OWNER_GATED')
                 AND (sibling_settlement.metadata->>'sourceFindingEventId')::integer = sibling.id
             )
         )
         AND NOT EXISTS (
           SELECT 1 FROM governance_event derived
           JOIN work_order child ON child.id = (derived.metadata->>'childWorkOrderId')::integer
             AND child."userId" = derived."userId"
           WHERE derived."userId" = gate."userId"
             AND derived."eventType" = 'RUNTIME_FINDING_DERIVED'
             AND derived.metadata->>'objectiveWorkOrderId' = parent.ref
             AND child.status <> 'completed'
         )
       ORDER BY gate.id ASC LIMIT 1
       FOR UPDATE OF gate, source, parent, grant_row`,
      [ownerEmail.trim().toLowerCase(), includeDecided, exactGateSettlementEventId],
    )
    const row = result?.rows?.[0]
    if (!row) return null
    const { ids, sequence, issuedAt, gates, sourcePayloadDigest } = validateCandidate(row)
    const projection = projectRuntimeFindingActionability(row, gates)
    const packet = decisionPacket()
    return Object.freeze({
      sourceKind: RUNTIME_FINDING_DECISION_SOURCE_KIND,
      ownerUserId: row.ownerUserId,
      parentWorkOrderRowId: ids[0],
      parentWorkOrderRef: row.parentWorkOrderRef,
      authorityGrantId: ids[3],
      authorityGrantRef: row.authorityGrantRef,
      authorityGrantLevel: row.authorityGrantLevel,
      sourceFindingEventId: ids[1],
      sourcePayloadDigest,
      gateSettlementEventId: ids[2],
      gatePayloadDigest: row.gatePayloadDigest,
      actionableProjectionId: projection.id,
      actionableProjectionVersion: projection.version,
      actionableProjectionDigest: projection.digest,
      findingId: row.findingId,
      sequence,
      gate: row.gate,
      gates: Object.freeze(gates),
      allowedChoices: Object.freeze(["APPROVE", "DENY"]),
      recommendation: "DENY",
      recommendationRationale: "Default-deny: WilliamOS cannot infer authority for gated runtime work.",
      issuedAt,
      decisionPacket: packet,
      decisionPacketDigest: sha256(JSON.stringify(packet)),
    })
  } finally {
    if (pool) await pool.end()
  }
}

function exactRequestBinding(request) {
  return {
    sourceKind: request.sourceKind,
    ownerUserId: request.ownerUserId,
    parentWorkOrderRowId: request.parentWorkOrderRowId,
    parentWorkOrderRef: request.parentWorkOrderRef,
    authorityGrantId: request.authorityGrantId,
    authorityGrantRef: request.authorityGrantRef,
    authorityGrantLevel: request.authorityGrantLevel,
    sourceFindingEventId: request.sourceFindingEventId,
    sourcePayloadDigest: request.sourcePayloadDigest,
    gateSettlementEventId: request.gateSettlementEventId,
    gatePayloadDigest: request.gatePayloadDigest,
    actionableProjectionId: request.actionableProjectionId,
    actionableProjectionVersion: request.actionableProjectionVersion,
    actionableProjectionDigest: request.actionableProjectionDigest,
    findingId: request.findingId,
    sequence: request.sequence,
    gate: request.gate,
    gates: request.gates,
    decisionPacketDigest: request.decisionPacketDigest,
  }
}

export async function recordRuntimeFindingDecision({
  query,
  databaseUrl = process.env.DATABASE_URL,
  request,
  primaryDecisionProvenance,
} = {}) {
  if (request?.sourceKind !== RUNTIME_FINDING_DECISION_SOURCE_KIND
    || !isVerifiedPrimaryDecisionResponse(primaryDecisionProvenance)
    || primaryDecisionProvenance.requestDigest !== primaryDecisionRequestDigest(request)) {
    wall("RUNTIME_FINDING_DECISION_PROVENANCE_WALL")
  }
  const choice = primaryDecisionProvenance.choice
  if (!new Set(["APPROVE", "DENY"]).has(choice)) wall("RUNTIME_FINDING_DECISION_CHOICE_WALL")
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") wall("DATABASE_URL_REQUIRED")
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    client = await pool.connect()
    runQuery = client.query.bind(client)
  }
  const binding = exactRequestBinding(request)
  const decisionRef = `RUNTIME-FINDING-DECISION-${request.gateSettlementEventId}`
  try {
    await runQuery("BEGIN")
    await runQuery("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [`runtime-finding-decision:${request.gateSettlementEventId}`])
    const live = await readPendingRuntimeFindingDecisionRequest({
      query: runQuery,
      ownerEmail: primaryDecisionProvenance.accountEmail,
      includeDecided: true,
      exactGateSettlementEventId: request.gateSettlementEventId,
    })
    if (!live || canonicalJson(exactRequestBinding(live)) !== canonicalJson(binding)) {
      wall("RUNTIME_FINDING_DECISION_REVALIDATION_WALL")
    }
    const priorResult = await runQuery(
      `SELECT id, "evidenceId", metadata FROM governance_event
       WHERE "userId" = $1 AND "eventType" = 'RUNTIME_FINDING_OWNER_DECIDED'
         AND (metadata->>'gateSettlementEventId')::integer = $2
       ORDER BY id ASC`,
      [request.ownerUserId, request.gateSettlementEventId],
    )
    const prior = priorResult?.rows ?? []
    const receiptPayload = {
      ...binding,
      choice,
      requestDigest: primaryDecisionProvenance.requestDigest,
      responseDigest: primaryDecisionProvenance.responseDigest,
      accountEmail: primaryDecisionProvenance.accountEmail,
      disposition: choice === "APPROVE" ? "AUTHORITY_MATERIALIZATION_REQUIRED" : "DENIED_RESOLVED",
      resumeReleased: false,
    }
    const receiptDigest = sha256(canonicalJson(receiptPayload))
    const decisionRows = (await runQuery(
      `SELECT id, title, rationale, status, authority, owner, decision, locked, scope, context,
         evidence, tags
       FROM decision WHERE "userId" = $1 AND ref = $2 ORDER BY id FOR UPDATE`,
      [request.ownerUserId, decisionRef],
    ))?.rows ?? []
    const evidenceRows = (await runQuery(
      `SELECT id, "workOrderId", result, repo, notes, "contentHash"
       FROM evidence_record WHERE "userId" = $1 AND ref = $2 ORDER BY id FOR UPDATE`,
      [request.ownerUserId, `EV-${decisionRef}`],
    ))?.rows ?? []
    const auditRows = (await runQuery(
      `SELECT id, metadata FROM event_log
       WHERE "userId" = $1 AND type = 'runtime.finding.owner_decided'
         AND register = 'work_orders' AND "refId" = $2
         AND metadata->>'gateSettlementEventId' = $3
       ORDER BY id FOR UPDATE`,
      [request.ownerUserId, request.parentWorkOrderRowId, String(request.gateSettlementEventId)],
    ))?.rows ?? []
    if (prior.length > 0) {
      const decisionRow = decisionRows[0]
      const evidenceRow = evidenceRows[0]
      const expectedMetadata = {
        ...receiptPayload,
        receiptDigest,
        decisionId: Number(decisionRow?.id),
        evidenceId: Number(evidenceRow?.id),
      }
      if (prior.length !== 1 || decisionRows.length !== 1 || evidenceRows.length !== 1
        || auditRows.length !== 1
        || canonicalJson(prior[0].metadata) !== canonicalJson(expectedMetadata)
        || Number(prior[0].evidenceId) !== Number(evidenceRow?.id)
        || decisionRow?.title !== `Runtime finding ${request.findingId}`
        || decisionRow?.rationale !== (choice === "APPROVE"
          ? "Owner authorized later materialization only."
          : "Owner denied the gated finding.")
        || decisionRow?.status !== (choice === "APPROVE" ? "accepted" : "rejected")
        || decisionRow?.authority !== "binding"
        || decisionRow?.owner !== request.ownerUserId
        || decisionRow?.decision !== choice || decisionRow?.locked !== true
        || decisionRow?.scope !== runtimeFindingDecisionScope(request.gateSettlementEventId)
        || decisionRow?.context !== canonicalJson(binding)
        || canonicalJson(decisionRow?.evidence) !== canonicalJson([
          `gate-settlement:${request.gateSettlementEventId}`,
          `source-finding:${request.sourceFindingEventId}`,
          `choice:${choice}`,
        ])
        || canonicalJson(decisionRow?.tags) !== canonicalJson([RUNTIME_FINDING_DECISION_PROTECTED_TAG, choice])
        || Number(evidenceRow?.workOrderId) !== request.parentWorkOrderRowId
        || evidenceRow?.result !== (choice === "APPROVE" ? "PASS" : "FAIL")
        || evidenceRow?.repo !== "bsvalues/terragroq"
        || evidenceRow?.notes !== canonicalJson(receiptPayload)
        || evidenceRow?.contentHash !== receiptDigest
        || canonicalJson(auditRows[0].metadata) !== canonicalJson(expectedMetadata)) {
        wall("RUNTIME_FINDING_DECISION_CONFLICT")
      }
      await runQuery("COMMIT")
      return { status: receiptPayload.disposition, choice, decisionRef, receiptDigest, resumeReleased: false, replayed: true }
    }
    if (decisionRows.length !== 0 || evidenceRows.length !== 0 || auditRows.length !== 0) {
      wall("RUNTIME_FINDING_DECISION_CONFLICT")
    }
    const oldestLive = await readPendingRuntimeFindingDecisionRequest({
      query: runQuery,
      ownerEmail: primaryDecisionProvenance.accountEmail,
    })
    if (!oldestLive || oldestLive.gateSettlementEventId !== request.gateSettlementEventId) {
      wall("RUNTIME_FINDING_DECISION_ORDER_WALL")
    }
    const decisionResult = await runQuery(
      `INSERT INTO decision
         ("userId", ref, title, context, decision, rationale, status, authority, owner, scope,
          evidence, tags, locked, "decidedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'binding', $1, $8, $9::text[], $10::text[], true, NOW())
       RETURNING id`,
      [
        request.ownerUserId,
        decisionRef,
        `Runtime finding ${request.findingId}`,
        canonicalJson(binding),
        choice,
        choice === "APPROVE" ? "Owner authorized later materialization only." : "Owner denied the gated finding.",
        choice === "APPROVE" ? "accepted" : "rejected",
        runtimeFindingDecisionScope(request.gateSettlementEventId),
        [`gate-settlement:${request.gateSettlementEventId}`, `source-finding:${request.sourceFindingEventId}`, `choice:${choice}`],
        [RUNTIME_FINDING_DECISION_PROTECTED_TAG, choice],
      ],
    )
    const decisionId = Number(decisionResult?.rows?.[0]?.id)
    if (!Number.isSafeInteger(decisionId) || decisionId <= 0) wall("RUNTIME_FINDING_DECISION_RECORD_WALL")
    const evidenceResult = await runQuery(
      `INSERT INTO evidence_record ("userId", ref, "workOrderId", result, repo, notes, "contentHash")
       VALUES ($1, $2, $3, $4, 'bsvalues/terragroq', $5, $6) RETURNING id`,
      [request.ownerUserId, `EV-${decisionRef}`, request.parentWorkOrderRowId,
        choice === "APPROVE" ? "PASS" : "FAIL", canonicalJson(receiptPayload), receiptDigest],
    )
    const evidenceId = Number(evidenceResult?.rows?.[0]?.id)
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) wall("RUNTIME_FINDING_DECISION_EVIDENCE_WALL")
    const metadata = { ...receiptPayload, receiptDigest, decisionId, evidenceId }
    await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, "evidenceId", metadata)
       VALUES ($1, 'RUNTIME_FINDING_OWNER_DECIDED', 'work_order', $2, $1, $3, $4, $5::jsonb)`,
      [request.ownerUserId, String(request.parentWorkOrderRowId), receiptPayload.disposition, evidenceId, JSON.stringify(metadata)],
    )
    await runQuery(
      `INSERT INTO event_log ("userId", type, summary, register, "refId", metadata)
       VALUES ($1, 'runtime.finding.owner_decided', $2, 'work_orders', $3, $4::jsonb)`,
      [request.ownerUserId, `${decisionRef}: ${choice}`, request.parentWorkOrderRowId, JSON.stringify({ ...metadata, decisionId, evidenceId })],
    )
    await runQuery("COMMIT")
    return { status: receiptPayload.disposition, choice, decisionRef, receiptDigest, resumeReleased: false, replayed: false }
  } catch (error) {
    try { await runQuery("ROLLBACK") } catch {}
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}
