import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  withDeterministicValidatorRecoveryTransaction,
} from "../scripts/hermes-bridge/deterministic-validator-queue-recovery.mjs"

const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const run = databaseUrl ? describe : describe.skip

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

run("deterministic validator recovery PostgreSQL transaction seam", { timeout: 90_000 }, () => {
  let admin: import("pg").Pool
  let pool: import("pg").Pool
  let schema: string

  beforeAll(async () => {
    const { Pool } = await import("pg")
    admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    schema = `hermes_validator_recovery_${randomUUID().replaceAll("-", "")}`
    await admin.query(`CREATE SCHEMA "${schema}"`)
    const scoped = new URL(directDatabaseUrl(databaseUrl!))
    scoped.searchParams.set("options", `-csearch_path=${schema},public`)
    pool = new Pool({ connectionString: scoped.toString(), max: 4 })
    await pool.query(`CREATE TABLE recovery_receipt (
      key text PRIMARY KEY,
      value text NOT NULL
    )`)
  })

  afterAll(async () => {
    await pool?.end()
    if (admin && schema) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin?.end()
  })

  it("serializes two connections, commits once, and replays after commit-before-bind", async () => {
    const runRecovery = async (value: string) => {
      const client = await pool.connect()
      try {
        return await withDeterministicValidatorRecoveryTransaction({
          client,
          userId: "owner",
          operation: async (transaction) => {
            const inserted = await transaction.query(
              `INSERT INTO recovery_receipt (key, value) VALUES ('outcome-44', $1)
               ON CONFLICT (key) DO NOTHING RETURNING value`,
              [value],
            )
            if (inserted.rows.length === 1) await transaction.query("SELECT pg_sleep(0.1)")
            const durable = await transaction.query(
              "SELECT value FROM recovery_receipt WHERE key='outcome-44'",
            )
            return { inserted: inserted.rows.length === 1, value: durable.rows[0].value }
          },
        })
      } finally {
        client.release()
      }
    }

    const concurrent = await Promise.all([runRecovery("first"), runRecovery("second")])
    expect(concurrent.filter((result) => result.inserted)).toHaveLength(1)
    const committed = concurrent.find((result) => result.inserted)!.value
    expect(new Set(concurrent.map((result) => result.value))).toEqual(new Set([committed]))

    // The first process is now treated as crashed after COMMIT but before local binding.
    // A new connection replays the durable receipt instead of creating a second fence.
    await expect(runRecovery("after-crash")).resolves.toEqual({ inserted: false, value: committed })
  })

  it("rolls back a failed recovery operation without leaking a partial receipt", async () => {
    const client = await pool.connect()
    try {
      await expect(withDeterministicValidatorRecoveryTransaction({
        client,
        userId: "rollback-owner",
        operation: async (transaction) => {
          await transaction.query("INSERT INTO recovery_receipt (key, value) VALUES ('rollback', 'partial')")
          throw new Error("simulated crash before commit")
        },
      })).rejects.toThrow("simulated crash")
    } finally {
      client.release()
    }
    const rows = await pool.query("SELECT value FROM recovery_receipt WHERE key='rollback'")
    expect(rows.rows).toEqual([])
  })
})
