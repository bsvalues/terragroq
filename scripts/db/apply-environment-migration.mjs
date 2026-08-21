#!/usr/bin/env node
// Explicit existing-database activation path for #921. This script applies only the idempotent
// Environment migration; it never force-applies the fresh bootstrap over a live database.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

export async function applyEnvironmentMigration({ pool, ddl }) {
  const client = await pool.connect()
  try {
    await client.query(ddl)
    const result = await client.query(
      `select to_regclass('public.environment_world') as world,
              to_regclass('public.working_world') as legacy_world,
              to_regclass('public.workbench_thread_message') as messages`,
    )
    const row = result.rows[0]
    if (!row?.world || !row?.legacy_world || !row?.messages) throw new Error("ENVIRONMENT_MIGRATION_INCOMPLETE")
    return { status: "APPLIED", tables: row }
  } finally {
    client.release()
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
  const here = path.dirname(fileURLToPath(import.meta.url))
  const ddl = readFileSync(path.resolve(here, "..", "..", "migrations", "0013-environment-world.sql"), "utf8")
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl, max: 1 })
  try {
    console.log(JSON.stringify(await applyEnvironmentMigration({ pool, ddl })))
  } finally {
    await pool.end()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "ENVIRONMENT_MIGRATION_FAILED")
    process.exitCode = 1
  })
}
