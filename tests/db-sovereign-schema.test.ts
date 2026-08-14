import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { applySchema } from "../scripts/db/apply-schema.mjs"

const ddlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "0000_williamos_init.sql",
)
const ddl = readFileSync(ddlPath, "utf8")

describe("sovereign schema bootstrap DDL", () => {
  it("installs the full WilliamOS table set", () => {
    expect((ddl.match(/CREATE TABLE/g) ?? []).length).toBe(32)
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
})

// A fake pg pool that hands out a single recording client. Lets us prove the
// transaction control and the DDL run on the SAME acquired connection.
function makePool({ ddlFails = false, existing = 0 } = {}) {
  const client = {
    queries: [] as string[],
    released: false,
    async query(sql: string) {
      this.queries.push(sql)
      if (ddlFails && /create table/i.test(sql)) throw new Error("injected DDL failure")
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
