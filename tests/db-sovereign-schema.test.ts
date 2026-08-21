import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  applyIssue911LiveAcceptanceMigration,
  applySchema,
} from "../scripts/db/apply-schema.mjs"

const ddlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "0000_williamos_init.sql",
)
const ddl = readFileSync(ddlPath, "utf8")
const migrationDdl = readFileSync(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "migrations",
  "0013-issue-911-live-nonempty-acceptance.sql",
), "utf8")
const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function schemaDatabaseUrl(url: string, schema: string) {
  const parsed = new URL(directDatabaseUrl(url))
  parsed.searchParams.set("options", `-csearch_path=${schema}`)
  return parsed.toString()
}

describe("sovereign schema bootstrap DDL", () => {
  it("installs the full WilliamOS table set", () => {
    expect((ddl.match(/CREATE TABLE/g) ?? []).length).toBe(38)
  })

  it("bootstraps device authentication separately from access grants", () => {
    for (const table of [
      "device_credential",
      "device_challenge",
      "device_session",
      "device_auth_event",
    ]) {
      expect(ddl).toContain(`CREATE TABLE "${table}"`)
    }
    expect(ddl).toContain('"publicKeySpki" text NOT NULL')
    expect(ddl).toContain('"tokenHash" text NOT NULL')
    expect(ddl).toContain('"expiresAt" timestamp with time zone NOT NULL')
    expect(ddl).not.toMatch(/device_(?:credential|challenge|session|auth_event)[^;]*access_grant/)
  })

  it("enables pgvector before the first vector column", () => {
    const extensionAt = ddl.search(/CREATE EXTENSION IF NOT EXISTS "?vector"?/i)
    const firstVectorAt = ddl.search(/vector\(\d+\)/)
    expect(extensionAt).toBeGreaterThanOrEqual(0)
    expect(firstVectorAt).toBeGreaterThanOrEqual(0)
    expect(extensionAt).toBeLessThan(firstVectorAt)
  })

  it("pins the sovereign 1024-d vector contract (no 1536 drift)", () => {
    expect(ddl.includes("vector(1536)")).toBe(false)
    expect((ddl.match(/vector\(1024\)/g) ?? []).length).toBe(2)
  })

  it("freshly bootstraps the exact singleton #911 live-acceptance selector", () => {
    for (const table of ["goal", "goal_outcome_intake_receipt", "outcome_queue_item"]) {
      const tableSql = ddl.slice(ddl.indexOf(`CREATE TABLE "${table}"`), ddl.indexOf(";", ddl.indexOf(`CREATE TABLE "${table}"`)))
      expect(tableSql).toContain('"acceptedContractIds" text[] DEFAULT \'{}\' NOT NULL')
      const indexName = table === "goal_outcome_intake_receipt"
        ? "goal_intake_issue_911_live_acceptance_singleton_idx"
        : `${table}_issue_911_live_acceptance_singleton_idx`
      expect(ddl).toContain(`CREATE UNIQUE INDEX "${indexName}"`)
      expect(ddl).toContain(`WHERE "${table}"."acceptedContractIds" = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[]`)
    }
  })
})

// A fake pg pool that hands out a single recording client. Lets us prove the
// transaction control and the DDL run on the SAME acquired connection.
function makePool({ ddlFails = false, existing = 0, failPattern = /create table/i } = {}) {
  const client = {
    queries: [] as string[],
    released: false,
    async query(sql: string) {
      this.queries.push(sql)
      if (ddlFails && failPattern.test(sql)) throw new Error("injected DDL failure")
      if (/count\(\*\)/i.test(sql)) return { rows: [{ n: existing }] }
      return { rows: [] }
    },
    release() {
      this.released = true
    },
  }
  let connects = 0
  return {
    client,
    connects: () => connects,
    async connect() {
      connects += 1
      return client
    },
  }
}

describe("applySchema atomicity", () => {
  it("runs BEGIN → DDL → COMMIT on ONE acquired client, then releases it", async () => {
    const pool = makePool()
    const res = await applySchema({ pool, ddl: "CREATE TABLE x (id int);" })
    expect(res).toEqual({ status: "APPLIED", tables: 0 })
    expect(pool.connects()).toBe(1)
    const q = pool.client.queries
    const begin = q.findIndex((s) => /^\s*BEGIN/i.test(s))
    const dml = q.findIndex((s) => /CREATE TABLE/i.test(s))
    const commit = q.findIndex((s) => /^\s*COMMIT/i.test(s))
    expect(begin).toBeGreaterThanOrEqual(0)
    expect(begin).toBeLessThan(dml)
    expect(dml).toBeLessThan(commit)
    expect(q.some((s) => /ROLLBACK/i.test(s))).toBe(false)
    expect(pool.client.released).toBe(true)
  })

  it("rolls back (no COMMIT) on injected DDL failure, on the same client, and releases", async () => {
    const pool = makePool({ ddlFails: true })
    await expect(
      applySchema({ pool, ddl: "CREATE TABLE x (id int);", force: true }),
    ).rejects.toThrow(/injected DDL failure/)
    expect(pool.connects()).toBe(1)
    const q = pool.client.queries
    expect(q.some((s) => /^\s*ROLLBACK/i.test(s))).toBe(true)
    expect(q.some((s) => /^\s*COMMIT/i.test(s))).toBe(false)
    expect(pool.client.released).toBe(true)
  })

  it("refuses a non-empty target unless forced, without opening a transaction", async () => {
    const pool = makePool({ existing: 5 })
    const res = await applySchema({ pool, ddl: "CREATE TABLE x (id int);" })
    expect(res).toEqual({ status: "REFUSED", existing: 5 })
    expect(pool.client.queries.some((s) => /^\s*BEGIN/i.test(s))).toBe(false)
    expect(pool.client.released).toBe(true)
  })
})

describe("existing-database migration runner", () => {
  it("runs only the reviewed self-transactional migration on one populated connection", async () => {
    const pool = makePool({ existing: 38 })
    await expect(applyIssue911LiveAcceptanceMigration({ pool, ddl: migrationDdl }))
      .resolves.toEqual({ status: "APPLIED", tables: 38 })
    expect(pool.connects()).toBe(1)
    expect(pool.client.queries).toContain(migrationDdl)
    expect(pool.client.queries.filter((sql) => /^\s*BEGIN/i.test(sql))).toHaveLength(0)
    expect(pool.client.released).toBe(true)
  })

  it("refuses a fresh target and an unreviewed migration without executing DDL", async () => {
    const fresh = makePool()
    await expect(applyIssue911LiveAcceptanceMigration({ pool: fresh, ddl: migrationDdl }))
      .resolves.toEqual({ status: "REFUSED", reason: "FRESH_DATABASE" })
    expect(fresh.client.queries).toHaveLength(1)

    const unreviewed = makePool({ existing: 38 })
    await expect(applyIssue911LiveAcceptanceMigration({
      pool: unreviewed, ddl: migrationDdl.replace("COMMIT;", "COMMIT;\nSELECT 1;"),
    })).rejects.toThrow("ISSUE_911_LIVE_ACCEPTANCE_MIGRATION_INPUT_WALL")
    await expect(applyIssue911LiveAcceptanceMigration({
      pool: unreviewed, ddl: migrationDdl.replace("COMMIT;", "DELETE FROM goal;\nCOMMIT;"),
    })).rejects.toThrow("ISSUE_911_LIVE_ACCEPTANCE_MIGRATION_INPUT_WALL")
    expect(unreviewed.connects()).toBe(0)
  })

  it("rolls back the same connection when the reviewed migration fails", async () => {
    const pool = makePool({ existing: 38, ddlFails: true, failPattern: /WILLIAMOS_MIGRATION/ })
    await expect(applyIssue911LiveAcceptanceMigration({ pool, ddl: migrationDdl }))
      .rejects.toThrow("injected DDL failure")
    expect(pool.client.queries.at(-1)).toBe("ROLLBACK")
    expect(pool.client.released).toBe(true)
  })
})

runDatabase("existing-database migration PostgreSQL contract", { timeout: 30_000 }, () => {
  it("applies in the selected schema, walls wrong prior shape, and leaves no residue", async () => {
    const { Pool } = await import("pg")
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const good = `issue_911_migration_${randomUUID().replaceAll("-", "")}`
    const bad = `issue_911_migration_bad_${randomUUID().replaceAll("-", "")}`
    try {
      for (const schema of [good, bad]) {
        await admin.query(`CREATE SCHEMA "${schema}"`)
        for (const table of ["goal", "outcome_queue_item", "goal_outcome_intake_receipt"]) {
          await admin.query(`CREATE TABLE "${schema}"."${table}" (id serial PRIMARY KEY, "userId" text NOT NULL)`)
        }
      }
      await admin.query(`ALTER TABLE "${bad}"."goal" ADD COLUMN "acceptedContractIds" integer[] NOT NULL DEFAULT '{}'::integer[]`)

      const goodPool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, good) })
      try {
        await expect(applyIssue911LiveAcceptanceMigration({ pool: goodPool, ddl: migrationDdl }))
          .resolves.toMatchObject({ status: "APPLIED" })
        await expect(applyIssue911LiveAcceptanceMigration({ pool: goodPool, ddl: migrationDdl }))
          .resolves.toMatchObject({ status: "APPLIED" })
      } finally { await goodPool.end() }
      const columns = (await admin.query(`SELECT table_name,column_name,data_type,udt_name,is_nullable,column_default
        FROM information_schema.columns WHERE table_schema=$1 AND column_name='acceptedContractIds'
        ORDER BY table_name`, [good])).rows
      expect(columns).toHaveLength(3)
      expect(columns.every((row) => row.data_type === "ARRAY" && row.udt_name === "_text"
        && row.is_nullable === "NO" && row.column_default === "'{}'::text[]")).toBe(true)
      const indexes = (await admin.query(`SELECT indexname,indexdef FROM pg_indexes
        WHERE schemaname=$1 AND indexname LIKE '%issue_911_live_acceptance_singleton_idx'
        ORDER BY indexname`, [good])).rows
      expect(indexes).toHaveLength(3)
      expect(indexes.every((row) => row.indexdef.includes("UNIQUE")
        && row.indexdef.includes("issue-911-live-nonempty-acceptance.v1"))).toBe(true)
      await admin.query("BEGIN")
      try {
        await admin.query(`INSERT INTO "${good}"."goal" ("userId","acceptedContractIds")
          VALUES ('singleton-owner',ARRAY['issue-911-live-nonempty-acceptance.v1'])`)
        await expect(admin.query(`INSERT INTO "${good}"."goal" ("userId","acceptedContractIds")
          VALUES ('singleton-owner',ARRAY['issue-911-live-nonempty-acceptance.v1'])`))
          .rejects.toMatchObject({ code: "23505" })
      } finally { await admin.query("ROLLBACK") }

      const badPool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, bad) })
      try {
        await expect(applyIssue911LiveAcceptanceMigration({ pool: badPool, ddl: migrationDdl }))
          .rejects.toThrow(/ISSUE_911_LIVE_ACCEPTANCE_COLUMN_SHAPE_WALL:goal/)
      } finally { await badPool.end() }
      const badColumns = (await admin.query(`SELECT table_name,column_name FROM information_schema.columns
        WHERE table_schema=$1 AND column_name='acceptedContractIds' ORDER BY table_name`, [bad])).rows
      expect(badColumns).toEqual([{ table_name: "goal", column_name: "acceptedContractIds" }])
      expect((await admin.query(`SELECT count(*)::integer AS count FROM pg_indexes
        WHERE schemaname=$1 AND indexname LIKE '%issue_911_live_acceptance_singleton_idx'`, [bad])).rows)
        .toEqual([{ count: 0 }])
    } finally {
      await admin.query(`DROP SCHEMA IF EXISTS "${good}" CASCADE`)
      await admin.query(`DROP SCHEMA IF EXISTS "${bad}" CASCADE`)
      await admin.end()
    }
  })
})
