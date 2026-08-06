export const HERMES_DATABASE_CONNECTION_TIMEOUT_MS = 10_000
export const HERMES_DATABASE_QUERY_TIMEOUT_MS = 30_000
export const HERMES_DATABASE_IDLE_TIMEOUT_MS = 10_000

export function createHermesDatabasePool(Pool, databaseUrl) {
  return new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: HERMES_DATABASE_CONNECTION_TIMEOUT_MS,
    query_timeout: HERMES_DATABASE_QUERY_TIMEOUT_MS,
    statement_timeout: HERMES_DATABASE_QUERY_TIMEOUT_MS,
    idleTimeoutMillis: HERMES_DATABASE_IDLE_TIMEOUT_MS,
  })
}
