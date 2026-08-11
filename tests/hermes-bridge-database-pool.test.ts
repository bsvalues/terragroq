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
        connectionTimeoutMillis: HERMES_DATABASE_CONNECTION_TIMEOUT_MS,
        query_timeout: HERMES_DATABASE_QUERY_TIMEOUT_MS,
        statement_timeout: HERMES_DATABASE_QUERY_TIMEOUT_MS,
        idleTimeoutMillis: HERMES_DATABASE_IDLE_TIMEOUT_MS,
      },
    })
    expect(HERMES_DATABASE_CONNECTION_TIMEOUT_MS).toBeGreaterThan(10_000)
    expect(HERMES_DATABASE_CONNECTION_TIMEOUT_MS).toBeLessThanOrEqual(
      HERMES_DATABASE_QUERY_TIMEOUT_MS,
    )
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
        connectionTimeoutMillis: HERMES_DATABASE_CONNECTION_TIMEOUT_MS,
        query_timeout: HERMES_DATABASE_SCHEMA_TIMEOUT_MS,
        statement_timeout: HERMES_DATABASE_SCHEMA_TIMEOUT_MS,
        idleTimeoutMillis: HERMES_DATABASE_IDLE_TIMEOUT_MS,
        allowExitOnIdle: true,
      },
    })
  })

  it("does not let a connection wait outlive an explicitly narrower query budget", () => {
    const Pool = vi.fn(function Pool(this: { options: unknown }, options: unknown) {
      this.options = options
    })

    const pool = createHermesDatabasePool(Pool, "postgresql://example.invalid/williamos", {
      queryTimeoutMs: 5_000,
    })

    expect(pool).toMatchObject({
      options: {
        connectionTimeoutMillis: 5_000,
        query_timeout: 5_000,
        statement_timeout: 5_000,
        idleTimeoutMillis: HERMES_DATABASE_IDLE_TIMEOUT_MS,
      },
    })
  })

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["not a number", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
    ["fractional", 1.5],
    ["string", "5000"],
    ["above the approved schema ceiling", HERMES_DATABASE_SCHEMA_TIMEOUT_MS + 1],
  ])("fails closed for a %s query budget", (_label, queryTimeoutMs) => {
    const Pool = vi.fn()

    expect(() =>
      createHermesDatabasePool(Pool, "postgresql://example.invalid/williamos", {
        queryTimeoutMs,
      }),
    ).toThrow("HERMES_DATABASE_QUERY_TIMEOUT_CONFIGURATION_WALL")
    expect(Pool).not.toHaveBeenCalled()
  })
})
