#!/usr/bin/env node
// Bootstrap the WilliamOS schema onto a fresh, self-hosted ("sovereign") Postgres.
// Applies the committed DDL ATOMICALLY on a SINGLE acquired pg client
// (BEGIN / DDL / COMMIT, or ROLLBACK on failure), so a partial schema can never
// persist. Fresh-DB use only: refuses when the target already has public tables
// unless WILLIAMOS_DB_APPLY_FORCE=1. Reads DATABASE_URL from the environment;
// prints no secrets.
import { readFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const COUNT_TABLES_SQL =
  "select count(*)::int as n from information_schema.tables " +
  "where table_schema = 'public' and table_type = 'BASE TABLE'"

// Apply `ddl` atomically using ONE client acquired from `pool`. BEGIN / DDL / COMMIT
// (and ROLLBACK on error) all run on that same client, so the DDL is never split
// across pooled connections. Returns { status: "APPLIED", tables } or
// { status: "REFUSED", existing }; throws (after rolling back) on DDL failure.
export async function applySchema({ pool, ddl, force = false }) {
  const client = await pool.connect()
  try {
    const before = Number((await client.query(COUNT_TABLES_SQL)).rows[0].n)
    if (before > 0 && !force) {
      return { status: "REFUSED", existing: before }
    }
    try {
      await client.query("BEGIN")
      await client.query(ddl)
      await client.query("COMMIT")
    } catch (txError) {
      try {
        await client.query("ROLLBACK")
      } catch {
        // keep the original DDL failure as the surfaced error
      }
      throw txError
    }
    const after = Number((await client.query(COUNT_TABLES_SQL)).rows[0].n)
    return { status: "APPLIED", tables: after }
  } finally {
    client.release()
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || databaseUrl.trim() === "") {
    console.error("DATABASE_URL is required")
    process.exitCode = 1
    return
  }
  const here = path.dirname(fileURLToPath(import.meta.url))
  const sqlPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(here, "..", "..", "drizzle", "0000_williamos_init.sql")
  const ddl = readFileSync(sqlPath, "utf8")

  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl.trim() })
  try {
    const result = await applySchema({
      pool,
      ddl,
      force: process.env.WILLIAMOS_DB_APPLY_FORCE === "1",
    })
    if (result.status === "REFUSED") {
      console.error(
        `Refusing to apply: target already has ${result.existing} public table(s). ` +
          "This bootstrap is for a fresh sovereign database. Set WILLIAMOS_DB_APPLY_FORCE=1 to override.",
      )
      process.exitCode = 2
      return
    }
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(`APPLY_FAILED: ${error.message}`)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main()
}
