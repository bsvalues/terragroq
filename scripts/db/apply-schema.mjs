#!/usr/bin/env node
// Bootstrap the WilliamOS schema onto a fresh, self-hosted ("sovereign") Postgres.
// Reads the committed DDL (drizzle/0000_williamos_init.sql) and applies it atomically.
// Fresh-DB use only: refuses when the target already has public tables unless
// WILLIAMOS_DB_APPLY_FORCE=1. Reads DATABASE_URL from the environment; prints no secrets.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { Pool } from "pg"

const here = path.dirname(fileURLToPath(import.meta.url))
const sqlPath = path.resolve(here, "..", "..", "drizzle", "0000_williamos_init.sql")

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl || databaseUrl.trim() === "") {
  console.error("DATABASE_URL is required")
  process.exit(1)
}

const ddl = readFileSync(sqlPath, "utf8")
const pool = new Pool({ connectionString: databaseUrl.trim() })

const countPublicTables = async () => {
  const { rows } = await pool.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
  )
  return rows[0].n
}

try {
  const before = await countPublicTables()
  if (before > 0 && process.env.WILLIAMOS_DB_APPLY_FORCE !== "1") {
    console.error(
      `Refusing to apply: target already has ${before} public table(s). This bootstrap is for a ` +
        "fresh sovereign database. Set WILLIAMOS_DB_APPLY_FORCE=1 to override.",
    )
    process.exit(2)
  }
  await pool.query("BEGIN")
  await pool.query(ddl)
  await pool.query("COMMIT")
  console.log(JSON.stringify({ status: "APPLIED", tables: await countPublicTables() }))
} catch (error) {
  try {
    await pool.query("ROLLBACK")
  } catch {}
  console.error(`APPLY_FAILED: ${error.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
