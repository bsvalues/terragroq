import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ddlPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "drizzle",
  "0000_williamos_init.sql",
)
const ddl = readFileSync(ddlPath, "utf8")

describe("sovereign schema bootstrap DDL", () => {
  it("installs the full WilliamOS table set", () => {
    expect((ddl.match(/CREATE TABLE/g) ?? []).length).toBe(30)
  })

  it("enables pgvector before the first vector column", () => {
    const extensionAt = ddl.search(/CREATE EXTENSION IF NOT EXISTS "?vector"?/i)
    const firstVectorAt = ddl.search(/vector\(\d+\)/)
    expect(extensionAt).toBeGreaterThanOrEqual(0)
    expect(firstVectorAt).toBeGreaterThanOrEqual(0)
    expect(extensionAt).toBeLessThan(firstVectorAt)
  })
})
