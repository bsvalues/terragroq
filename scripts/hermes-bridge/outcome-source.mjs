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
} = {}) {
  if (!Number.isSafeInteger(outcomeId) || outcomeId <= 0) throw Object.assign(new Error("outcomeId is required"), { code: "OUTCOME_ID_REQUIRED" })
  if (!["OWNER_DECISION_REQUIRED", "FAILED_TERMINAL"].includes(result)) {
    throw Object.assign(new Error("terminal result is invalid"), { code: "OUTCOME_TERMINAL_RESULT_INVALID" })
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
           WHERE g.id = $1 AND g.status = 'dismissed'
         ) AS terminalized`,
        [outcomeId, result, nextState ?? null],
      )
      const alreadyTerminalized = prior?.rows?.[0]?.terminalized === true
      if (client) await runQuery(alreadyTerminalized ? "COMMIT" : "ROLLBACK")
      return alreadyTerminalized
    }
    await runQuery(
      `INSERT INTO governance_event ("userId", "eventType", "entityType", "entityId", actor, reason, metadata)
       VALUES ($1, 'HERMES_OUTCOME_TERMINAL', 'goal', $2, 'hermes-codex-bridge', $3, $4::jsonb)`,
      [row.userId, String(row.id), `${result} for ${row.ref ?? `goal-${row.id}`}`, JSON.stringify({ result, nextState: nextState ?? null })],
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
  if (state === "OWNER_DECISION_REQUIRED" || state === "PROVIDER_UNAVAILABLE"
    || state === "RETRYABLE_WALL" || state.startsWith("DEFERRED_")) {
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
      const failureEval = failureEvalForCheckpoint(checkpoint)
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
