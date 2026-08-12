#!/usr/bin/env node
// Read-only state verification for the Neon -> ATLAS decision. The operator runs this
// LOCALLY, with the secret only in the environment:
//   DATABASE_URL="postgres://…" node scripts/db/neon-state-probe.mjs > neon-state-<ts>.json
//
// It emits NON-SECRET evidence only — observed_at, database identity (name + version),
// table list, per-table row counts, selected canonical IDs/counts, a classification
// candidate, and a manifest SHA256. The connection string is NEVER printed. It performs
// NO writes.
import { createHash } from "node:crypto"
import { pathToFileURL } from "node:url"
import path from "node:path"

// Canonical WilliamOS state tables: any non-scaffold row here means real operational state.
export const CANONICAL_TABLES = [
  "goal", "work_order", "outcome_queue_item", "decision", "authority_grant",
  "governance_event", "memory_fact", "document", "document_chunk", "truth_claim",
  "loop_run", "parked_idea", "lock_record", "conflict_record", "agent_claim",
  "evidence_record", "doctrine",
]

// Known non-canonical scaffold/seed/test identities (mirrors lib/primary-identity.ts).
const SCAFFOLD_EMAILS = new Set(["operator@command.io", "test+wo@example.com"])
const SCAFFOLD_EMAIL_PATTERNS = [/^diag\+\d+@example\.com$/i]

export function isScaffoldEmail(email) {
  const e = String(email ?? "").trim().toLowerCase()
  return SCAFFOLD_EMAILS.has(e) || SCAFFOLD_EMAIL_PATTERNS.some((p) => p.test(e))
}

// Strict classification. NO_CANONICAL_STATE only when every canonical table is empty AND
// the auth users are all provable scaffold; otherwise MIGRATION_REQUIRED.
export function classify({ tables, userAnalysis }) {
  const canonicalRowsPresent = CANONICAL_TABLES.some((t) => (tables[t] ?? 0) > 0)
  const nonScaffoldUsers = userAnalysis ? userAnalysis.nonScaffold > 0 : false
  return !canonicalRowsPresent && !nonScaffoldUsers ? "NO_CANONICAL_STATE" : "MIGRATION_REQUIRED"
}

function q(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

async function probe(databaseUrl) {
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const observedAt = (await pool.query("select now() as t")).rows[0].t
    const idRow = (await pool.query(
      "select current_database() as db, current_setting('server_version') as ver",
    )).rows[0]
    const { rows: tbls } = await pool.query(
      "select table_name from information_schema.tables " +
        "where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
    )
    const tables = {}
    for (const { table_name: t } of tbls) {
      tables[t] = Number((await pool.query(`select count(*)::bigint as n from ${q(t)}`)).rows[0].n)
    }
    const canonical = {}
    for (const t of CANONICAL_TABLES) {
      if (!(t in tables)) continue
      const hasId = (await pool.query(
        "select 1 from information_schema.columns " +
          "where table_schema='public' and table_name=$1 and column_name='id' limit 1",
        [t],
      )).rowCount > 0
      let minId = null
      let maxId = null
      if (hasId) {
        const mm = (await pool.query(`select min(id)::text as lo, max(id)::text as hi from ${q(t)}`)).rows[0]
        minId = mm.lo
        maxId = mm.hi
      }
      canonical[t] = { rows: tables[t], minId, maxId }
    }
    let userAnalysis = null
    if ("user" in tables) {
      const { rows: urows } = await pool.query('select email from "user"')
      const nonScaffold = urows.filter((r) => !isScaffoldEmail(r.email)).length
      userAnalysis = { total: urows.length, scaffold: urows.length - nonScaffold, nonScaffold }
    }
    const manifest = {
      observed_at: new Date(observedAt).toISOString(),
      identity: { database: idRow.db, server_version: idRow.ver },
      table_count: tbls.length,
      total_rows: Object.values(tables).reduce((a, b) => a + b, 0),
      tables,
      canonical,
      user_analysis: userAnalysis,
      classification_candidate: classify({ tables, userAnalysis }),
    }
    const manifest_sha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex")
    return { ...manifest, manifest_sha256 }
  } finally {
    await pool.end()
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || databaseUrl.trim() === "") {
    console.error("DATABASE_URL is required")
    process.exit(1)
  }
  probe(databaseUrl.trim())
    .then((m) => console.log(JSON.stringify(m, null, 2)))
    .catch((e) => {
      console.error(`PROBE_FAILED: ${e.message}`)
      process.exitCode = 1
    })
}
