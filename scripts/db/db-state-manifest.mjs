#!/usr/bin/env node
// Deterministic state manifest for a Postgres database — the verification core of the
// Neon -> ATLAS migration. It proves a restore preserved every row of every table.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/db/db-state-manifest.mjs            # print manifest JSON
//   node scripts/db/db-state-manifest.mjs --compare SRC.json DST.json           # diff two manifests
//
// Per public base table it records: primary key, row count, min/max pk, and a
// contentHash = md5 over per-row md5(row::text) ordered by primary key. Two databases
// with identical manifests hold byte-identical content for every table. No secrets are
// printed (the connection string is read from the environment and never emitted).
import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import path from "node:path"

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`
}

export async function buildManifest(databaseUrl) {
  const { Pool } = await import("pg")
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const { rows: tables } = await pool.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
       order by table_name`,
    )
    const manifest = { tableCount: tables.length, totalRows: 0, tables: {} }
    for (const { table_name: table } of tables) {
      const t = quoteIdent(table)
      const { rows: pkRows } = await pool.query(
        `select kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
         where tc.constraint_type = 'PRIMARY KEY'
           and tc.table_schema = 'public' and tc.table_name = $1
         order by kcu.ordinal_position`,
        [table],
      )
      const pkCols = pkRows.map((r) => r.column_name)
      const orderExpr = pkCols.length ? pkCols.map(quoteIdent).join(", ") : "md5(x::text)"

      const { rows: cntRows } = await pool.query(`select count(*)::bigint as n from ${t}`)
      const rows = Number(cntRows[0].n)

      const { rows: hashRows } = await pool.query(
        `select md5(coalesce(string_agg(md5(x::text), '' order by ${orderExpr}), '')) as h from ${t} x`,
      )
      const contentHash = hashRows[0].h

      let minPk = null
      let maxPk = null
      if (pkCols.length === 1) {
        const c = quoteIdent(pkCols[0])
        const { rows: mm } = await pool.query(
          `select min(${c})::text as lo, max(${c})::text as hi from ${t}`,
        )
        minPk = mm[0].lo
        maxPk = mm[0].hi
      }

      manifest.tables[table] = { pk: pkCols, rows, minPk, maxPk, contentHash }
      manifest.totalRows += rows
    }
    return manifest
  } finally {
    await pool.end()
  }
}

// Pure diff of two manifest objects. Returns an array of human-readable differences
// (empty === the two databases are byte-identical across every table).
export function compareManifests(a, b) {
  const diffs = []
  const aTables = Object.keys(a.tables).sort()
  const bTables = Object.keys(b.tables).sort()
  const onlyA = aTables.filter((x) => !b.tables[x])
  const onlyB = bTables.filter((x) => !a.tables[x])
  if (onlyA.length || onlyB.length) {
    diffs.push(`table set differs (only in SRC: [${onlyA}]; only in DST: [${onlyB}])`)
  }
  for (const table of aTables) {
    if (!b.tables[table]) continue
    const x = a.tables[table]
    const y = b.tables[table]
    if (x.rows !== y.rows) diffs.push(`${table}: row count ${x.rows} -> ${y.rows}`)
    if (x.contentHash !== y.contentHash) diffs.push(`${table}: content hash mismatch`)
    if (x.minPk !== y.minPk || x.maxPk !== y.maxPk) {
      diffs.push(`${table}: pk range [${x.minPk}, ${x.maxPk}] -> [${y.minPk}, ${y.maxPk}]`)
    }
  }
  return diffs
}

async function main(argv) {
  if (argv[0] === "--compare") {
    if (argv.length !== 3) {
      console.error("usage: db-state-manifest.mjs --compare SRC.json DST.json")
      process.exit(2)
    }
    const a = JSON.parse(readFileSync(argv[1], "utf8"))
    const b = JSON.parse(readFileSync(argv[2], "utf8"))
    const diffs = compareManifests(a, b)
    if (diffs.length === 0) {
      console.log(JSON.stringify({ status: "IDENTICAL" }))
    } else {
      console.error(JSON.stringify({ status: "DIFFERENCES", diffs }, null, 2))
      process.exitCode = 1
    }
    return
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl || databaseUrl.trim() === "") {
    console.error("DATABASE_URL is required")
    process.exit(1)
  }
  console.log(JSON.stringify(await buildManifest(databaseUrl.trim()), null, 2))
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`MANIFEST_FAILED: ${error.message}`)
    process.exitCode = 1
  })
}
