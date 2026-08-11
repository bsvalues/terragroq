export const HERMES_DATABASE_CONNECTION_TIMEOUT_MS = 30_000
export const HERMES_DATABASE_QUERY_TIMEOUT_MS = 30_000
export const HERMES_DATABASE_SCHEMA_TIMEOUT_MS = 120_000
export const HERMES_DATABASE_IDLE_TIMEOUT_MS = 10_000

export function createHermesDatabasePool(Pool, databaseUrl, options = {}) {
  const queryTimeoutMs = options.queryTimeoutMs ?? HERMES_DATABASE_QUERY_TIMEOUT_MS
  const connectionTimeoutMs = Math.min(HERMES_DATABASE_CONNECTION_TIMEOUT_MS, queryTimeoutMs)
  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: connectionTimeoutMs,
    query_timeout: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
    idleTimeoutMillis: HERMES_DATABASE_IDLE_TIMEOUT_MS,
    ...(options.allowExitOnIdle === true ? { allowExitOnIdle: true } : {}),
  })
}
