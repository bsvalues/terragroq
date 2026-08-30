#!/usr/bin/env node
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

const FIXED_MIGRATIONS = Object.freeze([
  ["0003", "migrations/0003-project-model.sql", "37c4e94ea29e7fa9ae25852ec57c8323122a6e48d10d8eef108227af7370d622"],
  ["0005", "migrations/0005-workbench-thread.sql", "32470e1caededea0a04853974c25bbcfe054a80fffacad68b2c6d26bad87ee2d"],
  ["0010", "migrations/0010-thread-source-kinds.sql", "85ded5c36d14f5baa4d03b6e526e4bf7d88b5cfd45609350aa49e65d1dd2ddf3"],
  ["0014", "migrations/0014-historical-knowledge-promotion.sql", "bd7e0e083c1c7a049a8a26a9ba218507ec3650ef5b47bd518b319d35d2d260bf"],
])

/** @typedef {{
 * userTable:boolean, doctrineTable:boolean, documentTable:boolean,
 * documentChunkTable:boolean, eventLogTable:boolean, projectTable:boolean,
 * projectUserKeyUnique:boolean, projectUserIdUnique:boolean,
 * workbenchThreadTable:boolean, workbenchThreadSourceTable:boolean,
 * threadSourceConstraintCurrent:boolean, historicalPromotionReady:boolean
 * }} HistoricalSchemaProbe */

function digestSql(sql) {
  return createHash("sha256").update(sql.replaceAll("\r\n", "\n")).digest("hex")
}

export function loadHistoricalMigrationBundle() {
  return FIXED_MIGRATIONS.map(([id, relativePath, digest]) => {
    const sql = readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8").replaceAll("\r\n", "\n")
    if (digestSql(sql) !== digest || !/(?:^|\n)BEGIN;/.test(sql) || !/COMMIT;\s*$/.test(sql)) {
      throw new Error(`HISTORICAL_MIGRATION_INPUT_WALL:${id}`)
    }
    return { id, relativePath, digest, sql }
  })
}

const PROBE_SQL = `
/* HISTORICAL_SCHEMA_PROBE */
SELECT
  to_regclass('"user"') IS NOT NULL AS "userTable",
  to_regclass('doctrine') IS NOT NULL AS "doctrineTable",
  to_regclass('document') IS NOT NULL AS "documentTable",
  to_regclass('document_chunk') IS NOT NULL AS "documentChunkTable",
  to_regclass('event_log') IS NOT NULL AS "eventLogTable",
  to_regclass('project') IS NOT NULL AS "projectTable",
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_user_key_unique' AND conrelid = to_regclass('project')) AS "projectUserKeyUnique",
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_user_id_unique' AND conrelid = to_regclass('project')) AS "projectUserIdUnique",
  to_regclass('workbench_thread') IS NOT NULL AS "workbenchThreadTable",
  to_regclass('workbench_thread_source') IS NOT NULL AS "workbenchThreadSourceTable",
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'workbench_thread_source_type_check'
      AND conrelid = to_regclass('workbench_thread_source')
      AND pg_get_constraintdef(oid) LIKE '%artifact%'
      AND pg_get_constraintdef(oid) LIKE '%reconciliation%'
  ) AS "threadSourceConstraintCurrent",
  (
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'doctrine'
        AND column_name IN ('historicalCandidateId','historicalClaimId','historicalProvenance')) = 3
    AND (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'document'
        AND column_name IN ('projectId','threadId','historicalCandidateId','historicalClaimId','historicalProvenance','privacy','authority','executionMode','archivedAt')) = 9
    AND (SELECT count(*) FROM pg_constraint
      WHERE conrelid = to_regclass('doctrine')
        AND conname IN ('doctrine_historical_identity_check','doctrine_historical_safety_check')) = 2
    AND (SELECT count(*) FROM pg_constraint
      WHERE conrelid = to_regclass('document')
        AND conname IN ('document_historical_user_project_fk','document_historical_user_project_thread_fk','document_historical_identity_check','document_historical_safety_check')) = 4
    AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass('workbench_thread') AND conname = 'workbench_thread_user_project_id_unique')
    AND to_regclass('doctrine_historical_candidate_user_idx') IS NOT NULL
    AND to_regclass('document_historical_candidate_user_idx') IS NOT NULL
  ) AS "historicalPromotionReady"
`

export async function probeHistoricalSchema(client) {
  const result = await client.query(PROBE_SQL)
  if (result.rows.length !== 1) throw new Error("HISTORICAL_MIGRATION_PROBE_FAILED")
  return result.rows[0]
}

/** @param {HistoricalSchemaProbe} probe */
export function buildHistoricalMigrationPlan(probe) {
  for (const [property, table] of [
    ["userTable", "user"],
    ["doctrineTable", "doctrine"],
    ["documentTable", "document"],
    ["documentChunkTable", "document_chunk"],
    ["eventLogTable", "event_log"],
  ]) {
    if (!probe[property]) throw new Error(`HISTORICAL_MIGRATION_BASE_SCHEMA_REQUIRED:${table}`)
  }
  const apply0003 = !probe.projectTable
  const apply0005 = apply0003
    || !probe.projectUserIdUnique
    || !probe.workbenchThreadTable
    || !probe.workbenchThreadSourceTable
  const apply0010 = apply0005 || !probe.threadSourceConstraintCurrent
  return [
    { id: "0003", action: apply0003 ? "apply" : "skip" },
    { id: "0005", action: apply0005 ? "apply" : "skip" },
    { id: "0010", action: apply0010 ? "apply" : "skip" },
    { id: "0014", action: probe.historicalPromotionReady ? "skip" : "apply" },
  ]
}

export async function runHistoricalMigrations({ client, apply = false }) {
  const bundle = loadHistoricalMigrationBundle()
  const before = await probeHistoricalSchema(client)
  const plan = buildHistoricalMigrationPlan(before)
  if (!apply) return { status: "DRY_RUN", plan }

  const byId = new Map(bundle.map((entry) => [entry.id, entry]))
  const applied = []
  for (const step of plan) {
    if (step.action === "skip") continue
    const migration = byId.get(step.id)
    if (!migration) throw new Error(`HISTORICAL_MIGRATION_UNRESOLVED:${step.id}`)
    try {
      await client.query(migration.sql)
      applied.push(step.id)
    } catch (error) {
      try { await client.query("ROLLBACK") } catch {}
      throw error
    }
  }

  const after = await probeHistoricalSchema(client)
  if (!after.projectTable || !after.projectUserKeyUnique || !after.projectUserIdUnique
    || !after.workbenchThreadTable || !after.workbenchThreadSourceTable
    || !after.threadSourceConstraintCurrent || !after.historicalPromotionReady) {
    throw new Error("HISTORICAL_MIGRATION_SCHEMA_VERIFICATION_FAILED")
  }
  return { status: "APPLIED", applied, plan }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== "--apply")) {
    throw new Error("HISTORICAL_MIGRATION_ARGUMENT_WALL")
  }
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim()
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED")
  const { Client } = await import("pg")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    console.log(JSON.stringify(await runHistoricalMigrations({ client, apply: args[0] === "--apply" })))
  } finally {
    await client.end()
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
