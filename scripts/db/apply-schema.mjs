#!/usr/bin/env node
// Bootstrap the WilliamOS schema onto a fresh, self-hosted ("sovereign") Postgres.
// Applies the committed DDL ATOMICALLY on a SINGLE acquired pg client
// (BEGIN / DDL / COMMIT, or ROLLBACK on failure), so a partial schema can never
// persist. Fresh-DB use only: refuses when the target already has public tables
// unless WILLIAMOS_DB_APPLY_FORCE=1. Reads DATABASE_URL from the environment;
// prints no secrets.
import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
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

export const ISSUE_911_LIVE_ACCEPTANCE_MIGRATION = "issue-911-live-nonempty-acceptance.v1"
const ISSUE_911_LIVE_ACCEPTANCE_MIGRATION_DIGEST =
  "af6e49ae2e0a8aeb9afc0c675d84323c92499d320ba36578cc3e4b98d86ca3bc"

function exactIssue911Migration(ddl) {
  const normalized = typeof ddl === "string" ? ddl.replaceAll("\r\n", "\n") : ""
  return createHash("sha256").update(normalized).digest("hex")
      === ISSUE_911_LIVE_ACCEPTANCE_MIGRATION_DIGEST
    && normalized.startsWith(`-- WILLIAMOS_MIGRATION:${ISSUE_911_LIVE_ACCEPTANCE_MIGRATION}\nBEGIN;`)
    && /ALTER TABLE "goal"[\s\S]*ADD COLUMN IF NOT EXISTS "acceptedContractIds" text\[\] NOT NULL DEFAULT '\{\}'::text\[\]/.test(ddl)
    && /ALTER TABLE "outcome_queue_item"[\s\S]*ADD COLUMN IF NOT EXISTS "acceptedContractIds" text\[\] NOT NULL DEFAULT '\{\}'::text\[\]/.test(ddl)
    && /ALTER TABLE "goal_outcome_intake_receipt"[\s\S]*ADD COLUMN IF NOT EXISTS "acceptedContractIds" text\[\] NOT NULL DEFAULT '\{\}'::text\[\]/.test(ddl)
    && (ddl.match(/CREATE UNIQUE INDEX IF NOT EXISTS/g) ?? []).length === 3
    && /COMMIT;\s*$/.test(ddl)
}

// Apply the one reviewed existing-database migration through its own committed
// BEGIN/COMMIT envelope on one acquired client. This intentionally does not use
// applySchema's fresh-database force path or nest another transaction.
export async function applyIssue911LiveAcceptanceMigration({ pool, ddl }) {
  if (!exactIssue911Migration(ddl)) {
    throw new Error("ISSUE_911_LIVE_ACCEPTANCE_MIGRATION_INPUT_WALL")
  }
  const client = await pool.connect()
  try {
    const before = Number((await client.query(COUNT_TABLES_SQL)).rows[0].n)
    if (before === 0) return { status: "REFUSED", reason: "FRESH_DATABASE" }
    try {
      await client.query(ddl)
    } catch (error) {
      try { await client.query("ROLLBACK") } catch {}
      throw error
    }
    return { status: "APPLIED", tables: before }
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
  const args = process.argv.slice(2)
  const migrationMode = args[0] === "--migration-0013"
  if ((migrationMode && args.length !== 1) || (!migrationMode && args.length > 1)) {
    console.error("APPLY_INPUT_WALL")
    process.exitCode = 2
    return
  }
  const sqlPath = migrationMode
    ? path.resolve(here, "..", "..", "migrations", "0013-issue-911-live-nonempty-acceptance.sql")
    : args[0]
      ? path.resolve(args[0])
      : path.resolve(here, "..", "..", "drizzle", "0000_williamos_init.sql")
  const ddl = readFileSync(sqlPath, "utf8")

  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl.trim() })
  try {
    const result = migrationMode
      ? await applyIssue911LiveAcceptanceMigration({ pool, ddl })
      : await applySchema({
        pool,
        ddl,
        force: process.env.WILLIAMOS_DB_APPLY_FORCE === "1",
      })
    if (result.status === "REFUSED") {
      console.error(result.reason === "FRESH_DATABASE"
        ? "Refusing migration: target is fresh; use the sovereign bootstrap."
        : `Refusing to apply: target already has ${result.existing} public table(s). ` +
          "This bootstrap is for a fresh sovereign database. Set WILLIAMOS_DB_APPLY_FORCE=1 to override.")
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
