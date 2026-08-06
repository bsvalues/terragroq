import { describe, expect, it, vi } from "vitest"

import {
  createHermesDatabasePool,
  HERMES_DATABASE_CONNECTION_TIMEOUT_MS,
  HERMES_DATABASE_IDLE_TIMEOUT_MS,
  HERMES_DATABASE_QUERY_TIMEOUT_MS,
  HERMES_DATABASE_SCHEMA_TIMEOUT_MS,
} from "../scripts/hermes-bridge/database-pool.mjs"

describe("Hermes database pool", () => {
  it("bounds connection, query, statement, and idle waits", () => {
    const Pool = vi.fn(function Pool(this: { options: unknown }, options: unknown) {
      this.options = options
    })

    const pool = createHermesDatabasePool(Pool, "postgresql://example.invalid/williamos")

    expect(Pool).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/williamos",
      connectionTimeoutMillis: HERMES_DATABASE_CONNECTION_TIMEOUT_MS,
      query_timeout: HERMES_DATABASE_QUERY_TIMEOUT_MS,
      statement_timeout: HERMES_DATABASE_QUERY_TIMEOUT_MS,
      idleTimeoutMillis: HERMES_DATABASE_IDLE_TIMEOUT_MS,
    })
    expect(pool).toMatchObject({
      options: {
        connectionTimeoutMillis: 10_000,
        query_timeout: 30_000,
        statement_timeout: 30_000,
        idleTimeoutMillis: 10_000,
      },
    })
  })

  it("supports a separate bounded schema budget and resident idle exit", () => {
    const Pool = vi.fn(function Pool(this: { options: unknown }, options: unknown) {
      this.options = options
    })

    const pool = createHermesDatabasePool(Pool, "postgresql://example.invalid/williamos", {
      queryTimeoutMs: HERMES_DATABASE_SCHEMA_TIMEOUT_MS,
      allowExitOnIdle: true,
    })

    expect(pool).toMatchObject({
      options: {
        connectionTimeoutMillis: 10_000,
        query_timeout: 120_000,
        statement_timeout: 120_000,
        idleTimeoutMillis: 10_000,
        allowExitOnIdle: true,
      },
    })
  })
})
