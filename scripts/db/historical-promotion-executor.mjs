#!/usr/bin/env node
import path from "node:path"
import { pathToFileURL } from "node:url"

import {
  W24_REJECTION,
  buildHistoricalPromotionPlan,
  validateHistoricalPromotionStatus,
} from "../../lib/history/historical-promotion.ts"
import {
  assertHistoricalDoctrineReplay,
  buildHistoricalDoctrineArchiveUpdate,
  buildHistoricalDoctrineInsert,
} from "../../lib/history/historical-doctrine.ts"
import {
  assertHistoricalProjectContextReplay,
  buildHistoricalProjectContextArchiveUpdate,
  buildHistoricalProjectContextInsert,
} from "../../lib/history/historical-project-context.ts"

const KNOWLEDGE_TABLES_SQL = `
  SELECT
    to_regclass('memory_fact') IS NOT NULL AS "memoryFact",
    to_regclass('decision') IS NOT NULL AS "decision",
    to_regclass('doctrine') IS NOT NULL AS "doctrine",
    to_regclass('document') IS NOT NULL AS "document",
    to_regclass('event_log') IS NOT NULL AS "eventLog"
`

const W24_COUNT_QUERIES = Object.freeze({
  memoryFact: `SELECT count(*)::int AS count FROM memory_fact WHERE "userId" = $1 AND (content IN ($2,$3) OR source IN ($2,$3))`,
  decision: `SELECT count(*)::int AS count FROM decision WHERE "userId" = $1 AND (ref IN ($2,$3) OR title IN ($2,$3) OR context IN ($2,$3) OR decision IN ($2,$3) OR rationale IN ($2,$3) OR consequences IN ($2,$3))`,
  doctrine: `SELECT count(*)::int AS count FROM doctrine WHERE "userId" = $1 AND ("historicalCandidateId" = $2 OR "historicalProvenance"->>'rawSha256' = $3 OR ref IN ($2,$3) OR title IN ($2,$3) OR statement IN ($2,$3))`,
  document: `SELECT count(*)::int AS count FROM document WHERE "userId" = $1 AND ("historicalCandidateId" = $2 OR "historicalProvenance"->>'rawSha256' = $3 OR title IN ($2,$3) OR source IN ($2,$3) OR content IN ($2,$3))`,
  eventLog: `SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1 AND (metadata->>'candidateId' = $2 OR metadata->>'rawSha256' = $3 OR summary IN ($2,$3))`,
})

function tenant(value) {
  const userId = String(value ?? "").trim()
  if (!userId) throw new Error("WILLIAMOS_HISTORICAL_PROMOTION_USER_ID_REQUIRED")
  return userId
}

export async function countW24Hits(client, userId) {
  const tables = (await client.query(KNOWLEDGE_TABLES_SQL)).rows[0]
  if (!tables.doctrine || !tables.document || !tables.eventLog) {
    throw new Error("HISTORICAL_PROMOTION_SCHEMA_REQUIRED")
  }
  let canonicalHits = 0
  let eventHits = 0
  for (const key of ["memoryFact", "decision", "doctrine", "document", "eventLog"]) {
    if (!tables[key]) continue
    const result = await client.query(W24_COUNT_QUERIES[key], [
      userId,
      W24_REJECTION.candidateId,
      W24_REJECTION.rawSha256,
    ])
    if (key === "eventLog") eventHits += Number(result.rows[0].count)
    else canonicalHits += Number(result.rows[0].count)
  }
  return { canonicalHits, eventHits }
}

async function requireTenantAndProjects(client, userId) {
  const user = await client.query('SELECT 1 FROM "user" WHERE id = $1', [userId])
  if (user.rowCount !== 1) throw new Error("HISTORICAL_PROMOTION_USER_NOT_FOUND")
  const projects = await client.query(
    'SELECT id, key FROM project WHERE "userId" = $1 AND key = ANY($2::text[]) ORDER BY key',
    [userId, ["terrafusion", "williamos"]],
  )
  if (projects.rowCount !== 2) throw new Error("HISTORICAL_PROMOTION_PROJECTS_REQUIRED")
  const byKey = new Map(projects.rows.map((row) => [row.key, row.id]))
  if (!byKey.has("terrafusion") || !byKey.has("williamos")) {
    throw new Error("HISTORICAL_PROMOTION_PROJECTS_REQUIRED")
  }
  return byKey
}

async function insertEvent(client, event) {
  await client.query(
    'INSERT INTO event_log ("userId", type, summary, register, "refId", metadata) VALUES ($1,$2,$3,$4,$5,$6::jsonb)',
    [event.userId, event.type, event.summary, event.register, event.refId, JSON.stringify(event.metadata)],
  )
}

async function insertDoctrine(client, row) {
  return (await client.query(`
    INSERT INTO doctrine (
      "userId", ref, title, statement, category, scope, status, priority, active,
      allowed, forbidden, "requiresApproval", evidence, owner, locked,
      "supersedesId", "supersededById", "historicalCandidateId", "historicalClaimId", "historicalProvenance"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb)
    RETURNING *
  `, [
    row.userId, row.ref, row.title, row.statement, row.category, row.scope, row.status,
    row.priority, row.active, row.allowed, row.forbidden, row.requiresApproval, row.evidence,
    row.owner, row.locked, row.supersedesId, row.supersededById, row.historicalCandidateId,
    row.historicalClaimId, JSON.stringify(row.historicalProvenance),
  ])).rows[0]
}

async function insertProjectContext(client, row) {
  return (await client.query(`
    INSERT INTO document (
      "userId", "projectId", "threadId", title, source, "mimeType", content, "chunkCount", status,
      "historicalCandidateId", "historicalClaimId", "historicalProvenance", privacy, authority,
      "executionMode", "archivedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
    RETURNING *
  `, [
    row.userId, row.projectId, row.threadId, row.title, row.source, row.mimeType, row.content,
    row.chunkCount, row.status, row.historicalCandidateId, row.historicalClaimId,
    JSON.stringify(row.historicalProvenance), row.privacy, row.authority, row.executionMode, row.archivedAt,
  ])).rows[0]
}

function publicRecord(owner, candidate, status) {
  return {
    candidateId: candidate.candidateId,
    claimId: candidate.claimId,
    owner,
    status,
    ...(owner === "private_project_context" ? { projectKey: candidate.targetProjectKey } : {}),
  }
}

async function loadExistingPromotionRows(client, userId, plan) {
  const expectedByCandidateId = new Map(plan.records.map((record) => [record.candidate.candidateId, record]))
  const expectedByClaimId = new Map(plan.records.map((record) => [record.candidate.claimId, record]))
  const candidateIds = [...expectedByCandidateId.keys()]
  const claimIds = [...expectedByClaimId.keys()]
  const doctrineExisting = await client.query(
    'SELECT * FROM doctrine WHERE "userId" = $1 AND ("historicalCandidateId" = ANY($2::text[]) OR "historicalClaimId" = ANY($3::text[]))',
    [userId, candidateIds, claimIds],
  )
  const documentsExisting = await client.query(
    'SELECT * FROM document WHERE "userId" = $1 AND ("historicalCandidateId" = ANY($2::text[]) OR "historicalClaimId" = ANY($3::text[]))',
    [userId, candidateIds, claimIds],
  )
  for (const row of doctrineExisting.rows) {
    const candidateRecord = expectedByCandidateId.get(row.historicalCandidateId)
    const claimRecord = expectedByClaimId.get(row.historicalClaimId)
    if (candidateRecord?.owner === "private_project_context" || claimRecord?.owner === "private_project_context") {
      throw new Error(`HISTORICAL_PROMOTION_OWNER_COLLISION:${row.historicalCandidateId ?? row.historicalClaimId}`)
    }
    if (claimRecord && row.historicalCandidateId !== claimRecord.candidate.candidateId) {
      throw new Error(`HISTORICAL_DOCTRINE_CLAIM_COLLISION:${row.historicalClaimId}`)
    }
  }
  for (const row of documentsExisting.rows) {
    const candidateRecord = expectedByCandidateId.get(row.historicalCandidateId)
    const claimRecord = expectedByClaimId.get(row.historicalClaimId)
    if (candidateRecord?.owner === "doctrine" || claimRecord?.owner === "doctrine") {
      throw new Error(`HISTORICAL_PROMOTION_OWNER_COLLISION:${row.historicalCandidateId ?? row.historicalClaimId}`)
    }
    if (claimRecord && row.historicalCandidateId !== claimRecord.candidate.candidateId) {
      throw new Error(`HISTORICAL_PROJECT_CONTEXT_CLAIM_COLLISION:${row.historicalClaimId}`)
    }
  }
  const doctrineById = new Map(doctrineExisting.rows.map((row) => [row.historicalCandidateId, row]))
  const documentsById = new Map(documentsExisting.rows.map((row) => [row.historicalCandidateId, row]))
  return { doctrineById, documentsById }
}

async function inspectPromotionState(client, userId, projects, plan) {
  const { doctrineById, documentsById } = await loadExistingPromotionRows(client, userId, plan)
  const records = []
  let existing = 0
  for (const candidate of plan.doctrine) {
    const row = doctrineById.get(candidate.candidateId)
    if (row) {
      assertHistoricalDoctrineReplay(row, candidate)
      if (row.status !== "historical_input") {
        throw new Error(`HISTORICAL_PROMOTION_ACTIVE_STATE_REQUIRED:${candidate.candidateId}`)
      }
      existing += 1
    }
    records.push(publicRecord("doctrine", candidate, row?.status ?? "planned"))
  }
  for (const candidate of plan.projectContext) {
    const row = documentsById.get(candidate.candidateId)
    if (row) {
      assertHistoricalProjectContextReplay(row, candidate, {
        userId,
        projectId: projects.get(candidate.targetProjectKey),
        threadId: null,
      })
      if (row.status !== "private_project_context") {
        throw new Error(`HISTORICAL_PROMOTION_ACTIVE_STATE_REQUIRED:${candidate.candidateId}`)
      }
      existing += 1
    }
    records.push(publicRecord("private_project_context", candidate, row?.status ?? "planned"))
  }
  return { records, existing }
}

async function applyNine(client, userId, projects, plan) {
  const { doctrineById, documentsById } = await loadExistingPromotionRows(client, userId, plan)
  const records = []
  let created = 0
  let replayed = 0
  let events = 0

  for (const candidate of plan.doctrine) {
    let row = doctrineById.get(candidate.candidateId)
    if (row) {
      assertHistoricalDoctrineReplay(row, candidate)
      if (row.status !== "historical_input") {
        throw new Error(`HISTORICAL_PROMOTION_ACTIVE_STATE_REQUIRED:${candidate.candidateId}`)
      }
      replayed += 1
    } else {
      row = await insertDoctrine(client, buildHistoricalDoctrineInsert(userId, candidate))
      await insertEvent(client, {
        userId,
        type: "doctrine.historical_input_created",
        summary: `Recorded non-authoritative historical Doctrine input ${candidate.claimId}`,
        register: "doctrine",
        refId: row.id,
        metadata: { candidateId: candidate.candidateId },
      })
      created += 1
      events += 1
    }
    records.push(publicRecord("doctrine", candidate, row.status))
  }

  for (const candidate of plan.projectContext) {
    const projectId = projects.get(candidate.targetProjectKey)
    let row = documentsById.get(candidate.candidateId)
    if (row) {
      assertHistoricalProjectContextReplay(row, candidate, { userId, projectId, threadId: null })
      if (row.status !== "private_project_context") {
        throw new Error(`HISTORICAL_PROMOTION_ACTIVE_STATE_REQUIRED:${candidate.candidateId}`)
      }
      replayed += 1
    } else {
      row = await insertProjectContext(
        client,
        buildHistoricalProjectContextInsert(userId, projectId, candidate, null),
      )
      await insertEvent(client, {
        userId,
        type: "document.historical_project_context_created",
        summary: `Recorded non-authoritative private Project context ${candidate.claimId}`,
        register: "corpus",
        refId: row.id,
        metadata: { candidateId: candidate.candidateId, projectKey: candidate.targetProjectKey, threadId: null },
      })
      created += 1
      events += 1
    }
    records.push(publicRecord("private_project_context", candidate, row.status))
  }
  return { records, counts: { created, replayed, events, total: 9 } }
}

async function archiveNine(client, userId, projects, plan) {
  const records = []
  let archived = 0
  let replayed = 0
  let events = 0
  for (const candidate of plan.doctrine) {
    const result = await client.query(
      'SELECT * FROM doctrine WHERE "userId" = $1 AND "historicalCandidateId" = $2',
      [userId, candidate.candidateId],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`HISTORICAL_DOCTRINE_NOT_FOUND:${candidate.candidateId}`)
    assertHistoricalDoctrineReplay(row, candidate)
    const update = buildHistoricalDoctrineArchiveUpdate(row)
    if (!update) {
      replayed += 1
    } else {
      await client.query(
        'UPDATE doctrine SET status = $1, active = false, "updatedAt" = now() WHERE id = $2',
        [update.status, row.id],
      )
      await insertEvent(client, {
        userId,
        type: "doctrine.historical_input_archived",
        summary: `Archived non-authoritative historical Doctrine input ${candidate.claimId}`,
        register: "doctrine",
        refId: row.id,
        metadata: { candidateId: candidate.candidateId },
      })
      row.status = update.status
      row.active = false
      archived += 1
      events += 1
    }
    records.push(publicRecord("doctrine", candidate, row.status))
  }

  for (const candidate of plan.projectContext) {
    const result = await client.query(
      'SELECT * FROM document WHERE "userId" = $1 AND "historicalCandidateId" = $2',
      [userId, candidate.candidateId],
    )
    const row = result.rows[0]
    if (!row) throw new Error(`HISTORICAL_PROJECT_CONTEXT_NOT_FOUND:${candidate.candidateId}`)
    assertHistoricalProjectContextReplay(row, candidate, {
      userId,
      projectId: projects.get(candidate.targetProjectKey),
      threadId: null,
    })
    const update = buildHistoricalProjectContextArchiveUpdate(row)
    if (!update) {
      replayed += 1
    } else {
      await client.query(
        'UPDATE document SET status = $1, "archivedAt" = $2, "updatedAt" = now() WHERE id = $3',
        [update.status, update.archivedAt, row.id],
      )
      await insertEvent(client, {
        userId,
        type: "document.historical_project_context_archived",
        summary: `Archived non-authoritative private Project context ${candidate.claimId}`,
        register: "corpus",
        refId: row.id,
        metadata: { candidateId: candidate.candidateId },
      })
      row.status = update.status
      row.archivedAt = update.archivedAt
      archived += 1
      events += 1
    }
    records.push(publicRecord("private_project_context", candidate, row.status))
  }
  return { records, counts: { archived, replayed, events, total: 9 } }
}

export async function executeHistoricalPromotion({ client, userId: rawUserId, mode = "plan" }) {
  if (!["plan", "apply", "archive"].includes(mode)) {
    throw new Error(`HISTORICAL_PROMOTION_MODE_INVALID:${mode}`)
  }
  const userId = tenant(rawUserId)
  const plan = buildHistoricalPromotionPlan()
  if (mode === "plan") {
    const projects = await requireTenantAndProjects(client, userId)
    const w24 = await countW24Hits(client, userId)
    if (w24.canonicalHits !== 0 || w24.eventHits !== 0) {
      throw new Error(`HISTORICAL_PROMOTION_W24_PRESENT:${w24.canonicalHits}:${w24.eventHits}`)
    }
    const inspected = await inspectPromotionState(client, userId, projects, plan)
    return {
      status: "DRY_RUN",
      records: inspected.records,
      counts: { created: 0, existing: inspected.existing, planned: 9 - inspected.existing, events: 0, total: 9 },
      w24,
      rejection: W24_REJECTION,
    }
  }

  await client.query("BEGIN")
  try {
    const projects = await requireTenantAndProjects(client, userId)
    const w24 = await countW24Hits(client, userId)
    if (w24.canonicalHits !== 0 || w24.eventHits !== 0) {
      throw new Error(`HISTORICAL_PROMOTION_W24_PRESENT:${w24.canonicalHits}:${w24.eventHits}`)
    }
    const result = mode === "apply"
      ? await applyNine(client, userId, projects, plan)
      : await archiveNine(client, userId, projects, plan)
    if (mode === "apply") {
      validateHistoricalPromotionStatus({
        rows: result.records,
        w24CanonicalHits: w24.canonicalHits,
        w24EventHits: w24.eventHits,
      })
    }
    await client.query("COMMIT")
    return {
      status: mode === "apply" ? "APPLIED" : "ARCHIVED",
      ...result,
      w24,
      rejection: W24_REJECTION,
    }
  } catch (error) {
    try { await client.query("ROLLBACK") } catch {}
    throw error
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && !["--apply", "--archive"].includes(args[0]))) {
    throw new Error("HISTORICAL_PROMOTION_ARGUMENT_WALL")
  }
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim()
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
  const userId = tenant(process.env.WILLIAMOS_HISTORICAL_PROMOTION_USER_ID)
  const mode = args[0] === "--apply" ? "apply" : args[0] === "--archive" ? "archive" : "plan"
  const { Client } = await import("pg")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    console.log(JSON.stringify(await executeHistoricalPromotion({ client, userId, mode })))
  } finally {
    await client.end()
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
