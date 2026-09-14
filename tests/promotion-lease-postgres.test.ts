import { randomUUID } from "node:crypto"

import { Pool } from "pg"
import { drizzle } from "drizzle-orm/node-postgres"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createWorkingWorld } from "@/lib/environment/working-world"
import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"

// The promotion-lease contract under real PostgreSQL: the retired one-active-outcome-per-user
// mutex must actually be gone at the DB layer (two ACTIVE outcomes coexist and are admitted
// concurrently), while single-writer protection lives on at the narrow promotion boundary
// (one live promotion lease per authoritative repository+target-ref, never per user).
const databaseUrl = process.env.PROMOTION_LEASE_TEST_DATABASE_URL
  ?? process.env.EXTERNAL_WORK_ORDER_TEST_DATABASE_URL
  ?? process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip

const roots: string[] = []

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function schemaDatabaseUrl(url: string, schema: string) {
  const parsed = new URL(directDatabaseUrl(url))
  parsed.searchParams.set("options", `-csearch_path=${schema},public`)
  return parsed.toString()
}

async function installSchema(pool: Pool, schema: string) {
  const bootstrap = (await fs.readFile(path.join(process.cwd(), "drizzle", "0000_williamos_init.sql"), "utf8"))
    .replaceAll('"public".', `"${schema}".`)
  for (const statement of bootstrap.split("--> statement-breakpoint").map((part) => part.trim()).filter(Boolean)) {
    await pool.query(statement)
  }
  for (const migration of ["0008-resource-record.sql", "0009-resource-key.sql", "0012-working-world.sql"]) {
    await pool.query(await fs.readFile(path.join(process.cwd(), "migrations", migration), "utf8"))
  }
}

function world(intent: string) {
  return {
    ...createWorkingWorld({ intent, resources: ["repo:owner/repo"] }),
    space: {
      schemaVersion: 1 as const, revision: 1,
      windows: [{
        id: "editor", kind: "editor" as const, title: "Selected",
        frame: { x: 0, y: 0, width: 800, height: 600 }, z: 1, minimized: false,
      }],
      openFiles: ["src/selected.ts"],
      panes: [{ id: "pane", filePath: "src/selected.ts", selection: null }],
      selection: null, activeWindowId: "editor", activePaneId: "pane", runningAppUrl: null,
    },
  }
}

function packet(ref: string, number: number, title = "Promotion lease lane") {
  return {
    source: "github", externalRef: `github:owner/repo#${number}`, title,
    objective: `Deliver ${ref} through the exact governed reservation.`,
    repository: "owner/repo", authorityEvidence: [`owner-confirmation:${number}`],
    reservedPaths: ["src/selected.ts"], forbiddenPaths: ["src/forbidden.ts"],
    contractReservations: [], environmentReservations: [],
    validators: ["pnpm test"], acceptanceCriteria: ["The exact assignment remains governed"],
    pullRequest: { number, headSha: "a".repeat(40) },
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  vi.resetModules()
})

runDatabase("promotion lease PostgreSQL contract", { timeout: 120_000 }, () => {
  it("retires the one-active-per-user mutex at the database layer", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `promotion_lease_${randomUUID().replaceAll("-", "")}`
    const priorDatabaseUrl = process.env.DATABASE_URL
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 8 })
      await installSchema(fixture, schema)

      // The legacy unique index must be gone from the installed bootstrap schema.
      const indexPresent = await fixture.query(`
        SELECT 1 FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE c.relname = 'outcome_queue_item_one_active_per_user_idx' AND t.relnamespace = $1::regnamespace
      `, [schema])
      expect(indexPresent.rows).toEqual([])

      // The narrow lease table with its one-live-per-target index is present.
      const leaseIndex = await fixture.query(`
        SELECT i.indisunique AS "unique" FROM pg_class c
        JOIN pg_index i ON i.indexrelid = c.oid
        JOIN pg_class t ON t.oid = i.indrelid
        WHERE c.relname = 'promotion_lease_one_live_per_target_idx' AND t.relnamespace = $1::regnamespace
      `, [schema])
      expect(leaseIndex.rows).toEqual([{ unique: true }])

      // Two ACTIVE outcomes in the same user coexist — the state the mutex made impossible.
      await fixture.query(`INSERT INTO "user" (id,name,email) VALUES ('owner','Owner','lease@example.test')`)
      await fixture.query(`INSERT INTO goal (id,"userId",ref,command,lane,mode,risk,authority,verdict,rationale,"requiresApproval","status")
        VALUES (1,'owner','GOAL-A','A','external-work-order','implement','R1','A2_WRITE_OWN','requires_approval','x',false,'converted'),
        (2,'owner','GOAL-B','B','external-work-order','implement','R1','A2_WRITE_OWN','requires_approval','x',false,'converted')`)
      await fixture.query(`INSERT INTO outcome_queue_item ("userId","outcomeKey","queueOrder","lifecycleState","title","goalId",
          "executionBinding","leaseHolder","leaseToken","leaseExpiresAt","acquisitionKey","fencingToken")
        VALUES ('owner','external:a#1',1,'active','Lane A',1,'exec-a','holder-a','token-a','2099-01-01T00:00:00Z','acq-a',1),
               ('owner','external:b#1',2,'active','Lane B',2,'exec-b','holder-b','token-b','2099-01-01T00:00:00Z','acq-b',1)`)
      const activeCount = await fixture.query(
        `SELECT count(*)::int AS n FROM outcome_queue_item WHERE "userId"='owner' AND "lifecycleState"='active'`,
      )
      expect(activeCount.rows).toEqual([{ n: 2 }])
    } finally {
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
      await admin.end()
      await fixture?.end()
    }
  })

  it("admits two independent outcomes concurrently where the old mutex refused the second", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `promotion_admit_${randomUUID().replaceAll("-", "")}`
    const priorDatabaseUrl = process.env.DATABASE_URL
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 8 })
      await installSchema(fixture, schema)
      await fixture.query(`INSERT INTO project (id,"userId",key,name,lifecycle) VALUES (1,'owner','repo','Owner Repo','active')`)
      await fixture.query(`INSERT INTO project_resource
        ("userId","projectId",type,relationship,"canonicalIdentity",label)
        VALUES ('owner',1,'repo','primary-repo','owner/repo','WilliamOS')`)
      for (const id of ["world-a", "world-b"]) {
        const snapshot = world(id)
        await fixture.query(`INSERT INTO working_world (id,"userId",intent,snapshot) VALUES ($1,'owner',$1,$2)`, [id, JSON.stringify(snapshot)])
      }
      process.env.DATABASE_URL = scopedUrl
      vi.doMock("@/lib/db", () => ({ db: drizzle(fixture), pool: fixture }))
      const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promotion-lease-artifacts-"))
      roots.push(artifactRoot)
      vi.doMock("@/lib/governance/artifacts", () => ({
        writeArtifact: vi.fn(async (input: { id: string; category: string }) => {
          const markdownPath = path.join(artifactRoot, `${input.id}.md`)
          const jsonPath = path.join(artifactRoot, `${input.id}.json`)
          await Promise.all([fs.writeFile(markdownPath, input.id), fs.writeFile(jsonPath, input.id)])
          return { id: input.id, category: input.category, markdownPath, jsonPath, sha256: input.id, wrote: true }
        }),
      }))
      const { admitExternalWorkOrder, previewExternalWorkOrderAdmission } =
        await import("@/lib/environment/external-work-order-admission")
      const admission = (worldId: string, key: string, externalWorkOrder: ReturnType<typeof packet>) => {
        const preview = previewExternalWorkOrderAdmission({ mode: "PREVIEW", worldId, externalWorkOrder })
        return {
          mode: "ADMIT" as const, worldId, idempotencyKey: key,
          confirmation: "ADMIT_EXTERNAL_WORK_ORDER" as const,
          confirmedProvenanceDigest: preview.provenanceDigest, externalWorkOrder,
        }
      }
      const first = admission("world-a", "external:a:1", packet("a", 1111, "Lane A"))
      const second = admission("world-b", "external:b:1", packet("b", 2222, "Lane B"))
      const [a, b] = await Promise.all([
        admitExternalWorkOrder("owner", first),
        admitExternalWorkOrder("owner", second),
      ])
      expect([a.status, b.status].sort()).toEqual(["ADMITTED", "ADMITTED"])
      const active = await fixture.query(
        `SELECT count(*)::int AS n FROM outcome_queue_item WHERE "userId"='owner' AND "lifecycleState"='active'`,
      )
      expect(active.rows).toEqual([{ n: 2 }])
    } finally {
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
      await admin.end()
      await fixture?.end()
    }
  })

  it("serializes live promotion leases per authoritative target, never per user", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    const schema = `promotion_claim_${randomUUID().replaceAll("-", "")}`
    const priorDatabaseUrl = process.env.DATABASE_URL
    let fixture: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const scopedUrl = schemaDatabaseUrl(databaseUrl!, schema)
      fixture = new Pool({ connectionString: scopedUrl, max: 8 })
      await installSchema(fixture, schema)
      const { acquirePromotionLease, validatePromotionLease, releasePromotionLease,
        PROMOTION_TARGET_REF, PromotionLeaseError } = await import("@/lib/governance/promotion-lease")
      await fixture.query(`INSERT INTO "user" (id,name,email) VALUES ('owner','Owner','lease@example.test')`)
      const claim = (overrides: Partial<{ adoptionHash: string, boundHeadSha: string, grantRef: string | null, outcomeId: number | null, workOrderId: number | null }>) => ({
        userId: "owner",
        repository: "owner/repo",
        targetRef: PROMOTION_TARGET_REF,
        pullRequest: 1111,
        boundHeadSha: "a".repeat(40),
        adoptionHash: "b".repeat(64),
        grantRef: "GRANT-ADOPT-AAA",
        outcomeId: 11,
        workOrderId: 22,
        expiresAt: "2099-01-01T00:00:00.000Z",
        ...overrides,
      })
      const db = { query: async (sql: string, params?: readonly unknown[]) => await fixture!.query(sql, [...(params ?? [])]) }
      // Seed a grant so the self-healing sweep keeps live leases live.
      await fixture.query(`INSERT INTO goal (id,"userId",ref,command,lane,mode,risk,authority,verdict,rationale,"requiresApproval","status")
        VALUES (1,'owner','GOAL-L','L','external-work-order','implement','R1','A2_WRITE_OWN','requires_approval','x',false,'converted')`)
      await fixture.query(`INSERT INTO work_order (id,"userId",ref,title,description,goal,scope,lane,status,assignee,agent,"authorityLevel")
        VALUES (22,'owner','WO-22','t','d','GOAL-L','s','external-work-order','approved','a','codex','A2_WRITE_OWN')`)
      await fixture.query(`INSERT INTO authority_grant ("userId",ref,"workOrderId","grantedBy","grantedTo","authorityLevel",scope,"status","expiresAt")
        VALUES ('owner','GRANT-ADOPT-AAA',22,'owner','williamos','A8_PUSH','{}','active','2099-01-01T00:00:00.000Z')`)

      const acquired = await acquirePromotionLease(db, claim({}))
      expect(acquired.status).toBe("live")
      // Replay of the identical claim is idempotent.
      const replay = await acquirePromotionLease(db, claim({}))
      expect(replay.id).toBe(acquired.id)
      // A DIFFERENT lineage (other outcome/work order) may not claim the same target.
      await expect(acquirePromotionLease(db, claim({
        adoptionHash: "d".repeat(64), outcomeId: 33, workOrderId: 44, pullRequest: 2222, grantRef: null,
      }))).rejects.toMatchObject({ code: "PROMOTION_LEASE_HELD" })
      // Same lineage after a head move re-binds instead of deadlocking.
      const rebound = await acquirePromotionLease(db, claim({ adoptionHash: "e".repeat(64) }))
      expect(rebound.adoptionHash).toBe("e".repeat(64))
      const oldHead = await fixture.query(
        `SELECT "status","reason" FROM promotion_lease WHERE "adoptionHash"=$1`, ["b".repeat(64)],
      )
      expect(oldHead.rows).toEqual([{ status: "released", reason: "LEASE_REBOUND" }])
      // Validation is exact-adoption+exact-head.
      expect(await validatePromotionLease(db, claim({ adoptionHash: "e".repeat(64) }))).toBe(true)
      expect(await validatePromotionLease(db, claim({ adoptionHash: "b".repeat(64) }))).toBe(false)
      // Finalize release frees the target for the next delivery.
      expect(await releasePromotionLease(db, "e".repeat(64), "LEASE_FINALIZED")).toBe(1)
      const next = await acquirePromotionLease(db, claim({
        adoptionHash: "f".repeat(64), outcomeId: 55, workOrderId: 66, grantRef: null,
      }))
      expect(next.adoptionHash).toBe("f".repeat(64))
    } finally {
      if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = priorDatabaseUrl
      await admin.end()
      await fixture?.end()
    }
  })
})
