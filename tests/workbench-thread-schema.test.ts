import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { getTableName } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import * as schema from "@/lib/db/schema"

const root = path.resolve(import.meta.dirname, "..")
const bootstrap = readFileSync(path.join(root, "drizzle", "0000_williamos_init.sql"), "utf8")
const migrationPath = path.join(root, "migrations", "0005-workbench-thread.sql")
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : ""

describe("workbench Thread schema", () => {
  it("defines only a context registry and its explicit durable source bindings", () => {
    expect(schema).toMatchObject({
      workbenchThread: expect.anything(),
      workbenchThreadSource: expect.anything(),
    })
    expect([
      getTableName(schema.workbenchThread),
      getTableName(schema.workbenchThreadSource),
    ]).toEqual(["workbench_thread", "workbench_thread_source"])

    expect(getTableConfig(schema.workbenchThread).columns.map((column) => column.name)).toEqual([
      "id",
      "userId",
      "projectId",
      "title",
      "createdAt",
      "updatedAt",
    ])
    expect(getTableConfig(schema.workbenchThreadSource).columns.map((column) => column.name)).toEqual([
      "id",
      "userId",
      "threadId",
      "sourceType",
      "sourceId",
      "role",
      "createdAt",
    ])
  })

  it("enforces tenant-safe Project and Thread references in the Drizzle model", () => {
    const project = getTableConfig(schema.project)
    const thread = getTableConfig(schema.workbenchThread)
    const source = getTableConfig(schema.workbenchThreadSource)

    expect(project.uniqueConstraints.map((entry) => entry.name)).toContain("project_user_id_unique")
    expect(thread.uniqueConstraints.map((entry) => entry.name)).toContain(
      "workbench_thread_user_id_unique",
    )

    expect(thread.foreignKeys).toHaveLength(1)
    expect(thread.foreignKeys[0].reference().columns.map((column) => column.name)).toEqual([
      "userId",
      "projectId",
    ])
    expect(thread.foreignKeys[0].reference().foreignColumns.map((column) => column.name)).toEqual([
      "userId",
      "id",
    ])
    expect(thread.foreignKeys[0].onDelete).toBe("restrict")

    expect(source.foreignKeys).toHaveLength(1)
    expect(source.foreignKeys[0].reference().columns.map((column) => column.name)).toEqual([
      "userId",
      "threadId",
    ])
    expect(source.foreignKeys[0].reference().foreignColumns.map((column) => column.name)).toEqual([
      "userId",
      "id",
    ])
    expect(source.foreignKeys[0].onDelete).toBe("cascade")
  })

  it("closes source kinds and roles while preventing duplicate and multiply-rooted sources", () => {
    const source = getTableConfig(schema.workbenchThreadSource)
    expect(source.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "workbench_thread_source_type_check",
      "workbench_thread_source_role_check",
    ]))
    expect(source.uniqueConstraints.map((entry) => entry.name)).toContain(
      "workbench_thread_source_binding_unique",
    )

    const rootIndex = source.indexes.find(
      (entry) => entry.config.name === "workbench_thread_source_root_unique_idx",
    )
    expect(rootIndex?.config.unique).toBe(true)
    expect(rootIndex?.config.where).toBeDefined()

    const threadRootIndex = source.indexes.find(
      (entry) => entry.config.name === "workbench_thread_source_thread_root_unique_idx",
    )
    expect(threadRootIndex?.config.unique).toBe(true)
    expect(threadRootIndex?.config.columns.map((column) => "name" in column ? column.name : null)).toEqual([
      "userId",
      "threadId",
    ])
    expect(threadRootIndex?.config.where).toBeDefined()
  })

  it("uses timezone-aware clocks and deterministic Thread-list indexing", () => {
    const thread = getTableConfig(schema.workbenchThread)
    const source = getTableConfig(schema.workbenchThreadSource)

    for (const table of [thread, source]) {
      const clocks = table.columns.filter((column) => column.name.endsWith("At"))
      expect(clocks.length).toBeGreaterThan(0)
      expect(clocks.every((column) => column.getSQLType() === "timestamp with time zone")).toBe(true)
    }

    const listIndex = thread.indexes.find(
      (entry) => entry.config.name === "workbench_thread_user_project_updated_idx",
    )
    expect(listIndex).toBeDefined()
  })

  it("keeps additive and fresh-install DDL on the same tenant-safe contract", () => {
    expect(migration.trimStart()).toMatch(/^BEGIN;/)
    expect(migration.trimEnd()).toMatch(/COMMIT;$/)

    for (const ddl of [bootstrap, migration]) {
      expect(ddl).toMatch(/UNIQUE\("userId","id"\)/)
      expect(ddl).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "workbench_thread"/)
      expect(ddl).toMatch(/CREATE TABLE(?: IF NOT EXISTS)? "workbench_thread_source"/)
      expect(ddl).toMatch(
        /FOREIGN KEY \("userId","projectId"\) REFERENCES (?:"public"\.)?"project"\("userId","id"\) ON DELETE restrict/,
      )
      expect(ddl).toMatch(
        /FOREIGN KEY \("userId","threadId"\) REFERENCES (?:"public"\.)?"workbench_thread"\("userId","id"\) ON DELETE cascade/,
      )
      expect(ddl).toMatch(/CHECK \([^)]*"sourceType" IN \('goal', 'outcome'\)\)/)
      expect(ddl).toMatch(/CHECK \([^)]*"role" IN \('root', 'member'\)\)/)
      expect(ddl).toMatch(/UNIQUE\("userId","threadId","sourceType","sourceId"\)/)
      expect(ddl).toMatch(
        /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? "workbench_thread_source_root_unique_idx"[\s\S]*WHERE [^;]*"role" = 'root'/,
      )
      expect(ddl).toMatch(
        /CREATE UNIQUE INDEX(?: IF NOT EXISTS)? "workbench_thread_source_thread_root_unique_idx"[\s\S]*\("userId","threadId"\)[\s\S]*WHERE [^;]*"role" = 'root'/,
      )
      expect(ddl).toMatch(
        /CREATE INDEX(?: IF NOT EXISTS)? "workbench_thread_user_project_updated_idx"[\s\S]*\("userId","projectId","updatedAt","id"\)/,
      )
    }
  })

  it("guards the additive Project tenant key so migration replay is safe", () => {
    expect(migration).toMatch(
      /DO \$\$[\s\S]*pg_constraint[\s\S]*project_user_id_unique[\s\S]*ADD CONSTRAINT "project_user_id_unique" UNIQUE\("userId","id"\)[\s\S]*END \$\$;/,
    )
  })
})
