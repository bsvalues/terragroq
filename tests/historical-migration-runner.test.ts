import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"

import {
  buildHistoricalMigrationPlan,
  loadHistoricalMigrationBundle,
  runHistoricalMigrations,
  type HistoricalSchemaProbe,
} from "@/scripts/db/historical-migration-runner.mjs"

const BASE_PROBE: HistoricalSchemaProbe = {
  userTable: true,
  doctrineTable: true,
  documentTable: true,
  documentChunkTable: true,
  eventLogTable: true,
  projectTable: false,
  projectUserKeyUnique: false,
  projectUserIdUnique: false,
  workbenchThreadTable: false,
  workbenchThreadSourceTable: false,
  threadSourceConstraintCurrent: false,
  historicalPromotionReady: false,
}

describe("historical migration runner", () => {
  it("loads both runners through Node 24 TypeScript stripping without a Vite resolver", () => {
    const result = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      "await import('./scripts/db/historical-promotion-executor.mjs'); await import('./scripts/db/historical-migration-runner.mjs'); console.log('HISTORICAL_RUNNERS_IMPORT_OK')",
    ], { cwd: process.cwd(), encoding: "utf8" })

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.trim()).toBe("HISTORICAL_RUNNERS_IMPORT_OK")
  })

  it("loads only the fixed reviewed migrations at exact normalized digests", () => {
    const bundle = loadHistoricalMigrationBundle()

    expect(bundle.map(({ id, relativePath, digest }) => ({ id, relativePath, digest }))).toEqual([
      { id: "0003", relativePath: "migrations/0003-project-model.sql", digest: "37c4e94ea29e7fa9ae25852ec57c8323122a6e48d10d8eef108227af7370d622" },
      { id: "0005", relativePath: "migrations/0005-workbench-thread.sql", digest: "32470e1caededea0a04853974c25bbcfe054a80fffacad68b2c6d26bad87ee2d" },
      { id: "0010", relativePath: "migrations/0010-thread-source-kinds.sql", digest: "85ded5c36d14f5baa4d03b6e526e4bf7d88b5cfd45609350aa49e65d1dd2ddf3" },
      { id: "0014", relativePath: "migrations/0014-historical-knowledge-promotion.sql", digest: "bd7e0e083c1c7a049a8a26a9ba218507ec3650ef5b47bd518b319d35d2d260bf" },
    ])
    expect(bundle.every((entry) => entry.sql.startsWith("BEGIN;") || entry.sql.includes("\nBEGIN;"))).toBe(true)
    expect(bundle.every((entry) => entry.sql.trimEnd().endsWith("COMMIT;"))).toBe(true)
  })

  it("plans all prerequisites for an existing base schema and skips satisfied earlier migrations", () => {
    expect(buildHistoricalMigrationPlan(BASE_PROBE).map(({ id, action }) => ({ id, action }))).toEqual([
      { id: "0003", action: "apply" },
      { id: "0005", action: "apply" },
      { id: "0010", action: "apply" },
      { id: "0014", action: "apply" },
    ])

    expect(buildHistoricalMigrationPlan({
      ...BASE_PROBE,
      projectTable: true,
      projectUserKeyUnique: true,
      projectUserIdUnique: true,
      workbenchThreadTable: true,
      workbenchThreadSourceTable: true,
      threadSourceConstraintCurrent: true,
    }).map(({ id, action }) => ({ id, action }))).toEqual([
      { id: "0003", action: "skip" },
      { id: "0005", action: "skip" },
      { id: "0010", action: "skip" },
      { id: "0014", action: "apply" },
    ])
  })

  it("defaults to a zero-write dry run and applies each planned migration through one client", async () => {
    const queries: string[] = []
    const VERIFIED_PROBE = Object.fromEntries(
      Object.keys(BASE_PROBE).map((key) => [key, true]),
    ) as HistoricalSchemaProbe
    const probes = [BASE_PROBE, VERIFIED_PROBE]
    const client = {
      async query(sql: string) {
        queries.push(sql)
        if (sql.includes("HISTORICAL_SCHEMA_PROBE")) return { rows: [probes.shift()] }
        return { rows: [] }
      },
    }

    const dryRun = await runHistoricalMigrations({ client, apply: false })
    expect(dryRun.status).toBe("DRY_RUN")
    expect(queries).toHaveLength(1)

    queries.length = 0
    probes.splice(0, probes.length, BASE_PROBE, VERIFIED_PROBE)
    const applied = await runHistoricalMigrations({ client, apply: true })
    expect(applied).toMatchObject({ status: "APPLIED", applied: ["0003", "0005", "0010", "0014"] })
    expect(queries.filter((sql) => sql.includes("HISTORICAL_SCHEMA_PROBE"))).toHaveLength(2)
    expect(queries.some((sql) => sql === "ROLLBACK")).toBe(false)
  })

  it("fails closed before planning when the owner-local base tables are absent", () => {
    expect(() => buildHistoricalMigrationPlan({ ...BASE_PROBE, doctrineTable: false }))
      .toThrow("HISTORICAL_MIGRATION_BASE_SCHEMA_REQUIRED:doctrine")
  })
})
