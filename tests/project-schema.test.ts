import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import * as schema from "../lib/db/schema"

describe("project schema", () => {
  it("exports only the minimal project registers", () => {
    expect(schema).toHaveProperty("project")
    expect(schema).toHaveProperty("projectResource")
  })

  it("keeps the upgrade and fresh-install DDL on the same bounded contract", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
    const bootstrap = readFileSync(path.join(root, "drizzle", "0000_williamos_init.sql"), "utf8")
    const migrationPath = path.join(root, "migrations", "0003-project-model.sql")
    const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : ""

    expect(migration.trimStart()).toMatch(/^BEGIN;/)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)

    for (const ddl of [bootstrap, migration]) {
      const projectTables = ["project", "project_resource"]
        .map((table) => ddl.match(
          new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? "${table}" \\([\\s\\S]*?\\n\\);`),
        )?.[0] ?? "")
        .join("\n")

      expect(ddl).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "project"/)
      expect(ddl).toMatch(/"lifecycle" text DEFAULT 'standby' NOT NULL/)
      expect(ddl).toMatch(/CHECK \([^)]*"lifecycle" IN \('active', 'standby', 'archived'\)\)/)
      expect(ddl).toMatch(/UNIQUE\("userId","key"\)/)
      expect(ddl).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "project_resource"/)
      expect(ddl).toMatch(/CHECK \([^)]*"type" IN \('repo', 'database', 'node', 'service', 'data_source'\)\)/)
      expect(ddl).toMatch(/UNIQUE\("projectId","type","canonicalIdentity","relationship"\)/)
      expect(ddl).toMatch(/FOREIGN KEY \("projectId"\).*ON DELETE restrict/)
      expect(projectTables.match(/timestamp with time zone DEFAULT now\(\) NOT NULL/g)).toHaveLength(4)
      expect(ddl).toMatch(/CREATE INDEX(?: IF NOT EXISTS)? "project_resource_user_project_idx"/)
      expect(ddl).toMatch(/CREATE INDEX(?: IF NOT EXISTS)? "project_resource_user_identity_idx"/)
    }
  })
})
