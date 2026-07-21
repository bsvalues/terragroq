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
  AND risk = $4
  AND authority = ANY($5::text[])
  AND command !~* $6
  AND NOT (command ~* $7 AND command ~* $8 AND command !~* $9)
  AND "createdAt" >= $10
ORDER BY "createdAt" ASC, id ASC
LIMIT 1`

export const OUTCOME_SELECTION_PARAMS = Object.freeze([
  "classified",
  Object.freeze(["allow", "requires_approval"]),
  Object.freeze(["docs", "ui", "read_model"]),
  "low",
  Object.freeze(["A0_READ_ONLY", "A1_DRAFT", "A2_WRITE_OWN"]),
  "\\m(terrafusion|terrapilot|property[[:space:]]+workbench|county|pacs|parcel|taxpayer|protected[[:space:]]+data|secret|password|credential|api[ -]?key|access[ -]?token|private[ -]?key|paid[[:space:]]+overage|destructive|force[ -]?push|reset[[:space:]]+--hard|issue[[:space:]]*#?357)\\M|#357\\M",
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
    params[9] = new Date(notBefore).toISOString()
    const result = await runQuery(OUTCOME_SELECTION_SQL, params)
    const row = result?.rows?.[0] ?? null
    if (!row) return null
    const decision = evaluateOutcomePolicy({ outcome: row, actor, repository, enabled, killSwitch, standingAuthority })
    return decision.allowed ? row : null
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
    client = await pool.connect()
    runQuery = client.query.bind(client)
  }
  try {
    if (client) await runQuery("BEGIN")
    const result = await runQuery(
      `UPDATE goal SET status = 'converted', "updatedAt" = NOW()
       WHERE id = $1 AND status = 'classified'
       RETURNING id, "userId" AS "userId", ref`,
      [outcomeId],
    )
    const row = result?.rows?.[0]
    if (!row) {
      if (client) await runQuery("ROLLBACK")
      return false
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

export const fetchNextEligibleOutcome = selectNextOutcome
export const readNextOutcome = selectNextOutcome
