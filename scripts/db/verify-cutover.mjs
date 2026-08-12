#!/usr/bin/env node
// Cutover verification for Neon -> ATLAS. Parameterized by connection strings in the
// environment (never printed). Subcommands:
//
//   ATLAS_URL=… node scripts/db/verify-cutover.mjs validate
//       read-only: prove the ATLAS target is reachable, report identity + per-table counts.
//   ATLAS_URL=… node scripts/db/verify-cutover.mjs canary
//       write+read a canary row on ATLAS -> proves live writes land on ATLAS.
//   node scripts/db/verify-cutover.mjs quiescence NEON_BEFORE.json NEON_AFTER.json
//       prove Neon received NO new writes across the cutover window (pure JSON diff).
//
// Use with neon-state-probe.mjs (Neon side) and db-state-manifest.mjs (row-by-row compare).
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import path from "node:path"

async function validate(atlasUrl) {
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: atlasUrl })
  try {
    const id = (await pool.query(
      "select current_database() as db, current_setting('server_version') as ver",
    )).rows[0]
    const { rows } = await pool.query(
      "select table_name from information_schema.tables " +
        "where table_schema='public' and table_type='BASE TABLE' order by table_name",
    )
    const tables = {}
    for (const { table_name: t } of rows) {
      const qi = `"${t.replace(/"/g, '""')}"`
      tables[t] = Number((await pool.query(`select count(*)::bigint as n from ${qi}`)).rows[0].n)
    }
    return { status: "ATLAS_REACHABLE", mode: "validation", identity: id, table_count: rows.length, tables }
  } finally {
    await pool.end()
  }
}

async function canary(atlasUrl) {
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: atlasUrl })
  const client = await pool.connect()
  try {
    await client.query(
      "create table if not exists _cutover_canary " +
        "(id serial primary key, note text not null, at timestamptz not null default now())",
    )
    const note = "neon-to-atlas-cutover-canary"
    const ins = await client.query(
      "insert into _cutover_canary (note) values ($1) returning id, at", [note],
    )
    const { id, at } = ins.rows[0]
    const back = await client.query("select id, note from _cutover_canary where id = $1", [id])
    const confirmed = back.rowCount === 1 && back.rows[0].note === note
    const total = Number((await client.query("select count(*)::int as n from _cutover_canary")).rows[0].n)
    return {
      status: confirmed ? "ATLAS_WRITE_CONFIRMED" : "ATLAS_WRITE_FAILED",
      canary_id: id,
      at: new Date(at).toISOString(),
      total_canaries: total,
    }
  } finally {
    client.release()
    await pool.end()
  }
}

// Pure: prove Neon is quiescent (no new writes) between two neon-state-probe manifests.
export function quiescence(before, after) {
  const diffs = []
  const tablesA = before.tables ?? {}
  const tablesB = after.tables ?? {}
  const names = [...new Set([...Object.keys(tablesA), ...Object.keys(tablesB)])].sort()
  for (const t of names) {
    const a = tablesA[t] ?? null
    const b = tablesB[t] ?? null
    if (a !== b) diffs.push(`${t}: ${a} -> ${b}`)
  }
  return { quiescent: diffs.length === 0, diffs }
}

async function main(argv) {
  const cmd = argv[0]
  if (cmd === "validate" || cmd === "canary") {
    const atlasUrl = process.env.ATLAS_URL
    if (!atlasUrl || atlasUrl.trim() === "") {
      console.error("ATLAS_URL is required")
      process.exitCode = 1
      return
    }
    const result = cmd === "validate" ? await validate(atlasUrl.trim()) : await canary(atlasUrl.trim())
    console.log(JSON.stringify(result, null, 2))
    if (result.status === "ATLAS_WRITE_FAILED") process.exitCode = 1
    return
  }
  if (cmd === "quiescence") {
    if (argv.length !== 3) {
      console.error("usage: verify-cutover.mjs quiescence NEON_BEFORE.json NEON_AFTER.json")
      process.exitCode = 2
      return
    }
    const before = JSON.parse(readFileSync(argv[1], "utf8"))
    const after = JSON.parse(readFileSync(argv[2], "utf8"))
    const r = quiescence(before, after)
    console.log(JSON.stringify({ status: r.quiescent ? "NEON_QUIESCENT" : "NEON_WROTE", ...r }, null, 2))
    if (!r.quiescent) process.exitCode = 1
    return
  }
  console.error("usage: verify-cutover.mjs <validate|canary|quiescence ...>")
  process.exitCode = 2
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(`VERIFY_CUTOVER_FAILED: ${e.message}`)
    process.exitCode = 1
  })
}
