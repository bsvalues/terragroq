import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { Pool } from "pg"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createWorkingWorld } from "@/lib/environment/working-world"

const runFile = promisify(execFile)
const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip
const roots: string[] = []

function directDatabaseUrl(url: string): string {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function schemaDatabaseUrl(url: string, schema: string): string {
  const parsed = new URL(directDatabaseUrl(url))
  parsed.searchParams.set("options", `-csearch_path=${schema}`)
  return parsed.toString()
}

async function repositoryFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-assignment-pg-"))
  roots.push(root)
  await runFile("git", ["init", "--quiet", root])
  await runFile("git", ["-C", root, "config", "user.email", "test@example.test"])
  await runFile("git", ["-C", root, "config", "user.name", "Test"])
  await fs.mkdir(path.join(root, "src"), { recursive: true })
  await fs.writeFile(path.join(root, "src", "selected.ts"), "export const selected = true\n", "utf8")
  await runFile("git", ["-C", root, "add", "--", "src/selected.ts"])
  await runFile("git", ["-C", root, "commit", "--quiet", "-m", "fixture"])
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  vi.resetModules()
})

runDatabase("Codex assignment PostgreSQL production query", { timeout: 30_000 }, () => {
  it("loads the server-derived assignment through PostgreSQL without a reserved alias", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `codex_assignment_${randomUUID().replaceAll("-", "")}`
    const priorDatabaseUrl = process.env.DATABASE_URL
    let productionPool: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const fixturePool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema) })
      try {
        await fixturePool.query(`
          CREATE TABLE "working_world" (
            id text PRIMARY KEY, "userId" text NOT NULL, snapshot jsonb NOT NULL
          );
          CREATE TABLE "project" (
            id integer PRIMARY KEY, "userId" text NOT NULL, "key" text NOT NULL
          );
          CREATE TABLE "project_resource" (
            "userId" text NOT NULL, "projectId" integer NOT NULL, type text NOT NULL,
            relationship text NOT NULL, "canonicalIdentity" text NOT NULL
          );
          CREATE TABLE "outcome_queue_item" (
            id integer PRIMARY KEY, "userId" text NOT NULL, "outcomeKey" text NOT NULL,
            "lifecycleState" text NOT NULL, "activeWorkOrderId" integer, version integer NOT NULL
          );
          CREATE TABLE "work_order" (
            id integer PRIMARY KEY, "userId" text NOT NULL, ref text, status text NOT NULL,
            "authorityLevel" text NOT NULL, "authorityGrantId" integer, agent text,
            "allowedFiles" text[] NOT NULL, "forbiddenFiles" text[] NOT NULL,
            "updatedAt" timestamptz NOT NULL
          );
          CREATE TABLE "authority_grant" (
            id integer PRIMARY KEY, ref text, "userId" text NOT NULL, "workOrderId" integer,
            "grantedTo" text NOT NULL, status text NOT NULL, "authorityLevel" text NOT NULL,
            scope text, "allowedActions" text[] NOT NULL, "blockedActions" text[] NOT NULL,
            "expiresAt" timestamptz, "revokedAt" timestamptz, "contentHash" text,
            "createdAt" timestamptz NOT NULL
          );
        `)
        const world = {
          ...createWorkingWorld({
            intent: "Implement the active outcome",
            resources: ["williamos-workspace-root:v1:c:/work/terrafusion_os_1.0"],
          }),
          spine: {
            projectId: 1, projectName: "WilliamOS", threadId: "thread-pg",
            outcomeKey: "OUTCOME-PG", outcomeTitle: "Selected-file change", workOrderId: 41,
            execution: "implementing" as const, worker: null, evidence: [],
          },
          space: {
            schemaVersion: 1 as const,
            revision: 7,
            windows: [{
              id: "workspace-editor", kind: "editor" as const, title: "Source",
              frame: { x: 0, y: 0, width: 800, height: 600 }, z: 1, minimized: false,
            }],
            openFiles: ["src/selected.ts"],
            panes: [{ id: "workspace-pane", filePath: "src/selected.ts", selection: null }],
            selection: null,
            activeWindowId: "workspace-editor",
            activePaneId: "workspace-pane",
            runningAppUrl: null,
          },
        }
        await fixturePool.query(
          `INSERT INTO "working_world" (id,"userId",snapshot) VALUES ($1,$2,$3::jsonb)`,
          ["world-pg", "owner-pg", JSON.stringify(world)],
        )
        await fixturePool.query(
          `INSERT INTO "project" (id,"userId","key") VALUES (1,'owner-pg','terrafusion')`,
        )
        await fixturePool.query(
          `INSERT INTO "project_resource"
            ("userId","projectId",type,relationship,"canonicalIdentity")
           VALUES ('owner-pg',1,'repo','primary-repo','bsvalues/terrafusion_os_1.0')`,
        )
        await fixturePool.query(
          `INSERT INTO "outcome_queue_item"
            (id,"userId","outcomeKey","lifecycleState","activeWorkOrderId",version)
           VALUES (5,'owner-pg','OUTCOME-PG','active',41,3)`,
        )
        await fixturePool.query(
          `INSERT INTO "work_order"
            (id,"userId",ref,status,"authorityLevel","authorityGrantId",agent,
             "allowedFiles","forbiddenFiles","updatedAt")
           VALUES (41,'owner-pg','WO-0041','active','A2_WRITE_OWN',9,'codex',
             ARRAY['src/selected.ts'],ARRAY['src/forbidden.ts'],now())`,
        )
        await fixturePool.query(
          `INSERT INTO "authority_grant"
            (id,ref,"userId","workOrderId","grantedTo",status,"authorityLevel",scope,
             "allowedActions","blockedActions","contentHash","createdAt")
           VALUES (9,'GRANT-0009','owner-pg',41,'codex','active','A2_WRITE_OWN','source change',
             ARRAY['src/selected.ts'],ARRAY['src/forbidden.ts'],'grant-hash',now())`,
        )
      } finally {
        await fixturePool.end()
      }

      const projectRoot = await repositoryFixture()
      process.env.DATABASE_URL = schemaDatabaseUrl(databaseUrl!, schema)
      vi.resetModules()
      const [{ deriveCodexAssignment }, database] = await Promise.all([
        import("@/lib/loom/codex-assignment"),
        import("@/lib/db"),
      ])
      productionPool = database.pool

      const assignment = await deriveCodexAssignment({
        userId: "owner-pg", worldId: "world-pg", projectRoot,
        projectBinding: {
          projectId: 1,
          projectKey: "terrafusion",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          spaceIdentity: "c:/work/terrafusion_os_1.0",
        },
      })

      expect(assignment).toMatchObject({
        owner: "owner-pg",
        worldId: "world-pg",
        outcomeKey: "OUTCOME-PG",
        workOrderId: 41,
        grantId: 9,
        selectedPath: "src/selected.ts",
        binding: {
          projectId: 1,
          projectKey: "terrafusion",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          spaceIdentity: "c:/work/terrafusion_os_1.0",
        },
      })
    } finally {
      await productionPool?.end()
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
