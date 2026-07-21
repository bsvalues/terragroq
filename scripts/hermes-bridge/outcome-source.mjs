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
           JOIN governance_event e ON e."entityType" = 'goal' AND e."entityId" = g.id::text
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
  if (!["OWNER_DECISION_REQUIRED", "FAILED_TERMINAL", "PROVIDER_UNAVAILABLE"].includes(result)) {
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
             ON terminal."entityType" = 'goal' AND terminal."entityId" = g.id::text
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

export const NATIVE_PROVIDER_RETRY_STATE = "HERMES_REDISPATCH_REQUIRED_WITH_NATIVE_NODE_EXECUTION_AND_WRITABLE_GIT_METADATA; preserve the existing owned working-tree changes"

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
         WHERE "entityType" = 'goal' AND "entityId" = $1::text
           AND "eventType" = 'HERMES_OUTCOME_TERMINAL'
         ORDER BY "createdAt" DESC, id DESC
         LIMIT 1
       )
       UPDATE goal g SET status = 'classified', "updatedAt" = NOW()
       FROM latest_terminal t
       WHERE g.id = $1 AND g.status = 'dismissed'
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
             ON terminal."entityType" = 'goal' AND terminal."entityId" = g.id::text
               AND terminal."eventType" = 'HERMES_OUTCOME_TERMINAL'
               AND terminal.metadata->>'result' = 'FAILED_TERMINAL'
               AND terminal.metadata->>'nextState' = $2
           JOIN governance_event recovered
             ON recovered."entityType" = 'goal' AND recovered."entityId" = g.id::text
               AND recovered."eventType" = 'HERMES_OUTCOME_PROVIDER_RECOVERED'
               AND recovered.metadata->>'retryState' = $2
           WHERE g.id = $1 AND g.status = 'classified'
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

export const fetchNextEligibleOutcome = selectNextOutcome
export const readNextOutcome = selectNextOutcome
