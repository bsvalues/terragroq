import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { describe, expect, it } from "vitest"

import { buildHistoricalProjectContextInsert, getHistoricalProjectContextCatalog } from "@/lib/history/historical-project-context"
import { loadHistoricalMigrationBundle, runHistoricalMigrations } from "@/scripts/db/historical-migration-runner.mjs"
import {
  countW24Hits,
  executeHistoricalPromotion,
} from "@/scripts/db/historical-promotion-executor.mjs"

const databaseUrl = process.env.HISTORICAL_PROMOTION_TEST_DATABASE_URL ?? process.env.DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip

const BASE_SCHEMA_DDL = `
  CREATE TABLE "user" (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL);
  CREATE TABLE memory_fact (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    content text NOT NULL,
    source text,
    authority text NOT NULL DEFAULT 'canon'
  );
  CREATE TABLE decision (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    ref text,
    title text NOT NULL,
    context text,
    decision text NOT NULL,
    rationale text,
    consequences text
  );
  CREATE TABLE doctrine (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    ref text,
    title text NOT NULL,
    statement text NOT NULL,
    category text NOT NULL DEFAULT 'principle',
    scope text,
    status text NOT NULL DEFAULT 'active',
    priority integer NOT NULL DEFAULT 0,
    active boolean NOT NULL DEFAULT true,
    allowed text[] NOT NULL DEFAULT '{}',
    forbidden text[] NOT NULL DEFAULT '{}',
    "requiresApproval" text[] NOT NULL DEFAULT '{}',
    evidence text[] NOT NULL DEFAULT '{}',
    owner text NOT NULL DEFAULT 'Bill',
    locked boolean NOT NULL DEFAULT false,
    "supersedesId" integer,
    "supersededById" integer,
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE document (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    title text NOT NULL,
    source text,
    "mimeType" text NOT NULL DEFAULT 'text/plain',
    content text NOT NULL,
    "chunkCount" integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'indexed',
    "createdAt" timestamp NOT NULL DEFAULT now(),
    "updatedAt" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE document_chunk (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    "documentId" integer NOT NULL,
    "chunkIndex" integer NOT NULL,
    content text NOT NULL,
    embedding text,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );
  CREATE TABLE event_log (
    id serial PRIMARY KEY,
    "userId" text NOT NULL,
    type text NOT NULL,
    summary text NOT NULL,
    register text,
    "refId" integer,
    metadata jsonb,
    "createdAt" timestamp NOT NULL DEFAULT now()
  );
`

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

async function seedTenant(pool: Pool, userId: string) {
  await pool.query('INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)', [userId, userId, `${userId}@example.invalid`])
  await pool.query(`
    INSERT INTO project ("userId", key, name, lifecycle) VALUES
      ($1, 'williamos', 'WilliamOS', 'active'),
      ($1, 'terrafusion', 'TerraFusion OS', 'standby')
  `, [userId])
}

async function insertProjectContextFixture(
  pool: Pool,
  userId: string,
  candidate: ReturnType<typeof getHistoricalProjectContextCatalog>[number],
  overrides: { candidateId?: string; claimId?: string; content?: string } = {},
) {
  const target = await pool.query('SELECT id FROM project WHERE "userId" = $1 AND key = $2', [userId, candidate.targetProjectKey])
  const row = buildHistoricalProjectContextInsert(userId, target.rows[0].id, candidate, null)
  await pool.query(`
    INSERT INTO document (
      "userId", title, source, "mimeType", content, "chunkCount", status, "projectId", "threadId",
      "historicalCandidateId", "historicalClaimId", "historicalProvenance", privacy, authority, "executionMode", "archivedAt"
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
  `, [
    row.userId, row.title, row.source, row.mimeType, overrides.content ?? row.content,
    row.chunkCount, row.status, row.projectId, row.threadId,
    overrides.candidateId ?? row.historicalCandidateId,
    overrides.claimId ?? row.historicalClaimId,
    JSON.stringify(row.historicalProvenance), row.privacy, row.authority, row.executionMode, row.archivedAt,
  ])
}

runDatabase("historical nine-record executor on isolated PostgreSQL", { timeout: 90_000 }, () => {
  it("walls semantic partial schemas before committing any migration repair", async () => {
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!), max: 2 })
    const schemas: string[] = []
    const pools: Pool[] = []
    const migrations = new Map(loadHistoricalMigrationBundle().map((migration) => [migration.id, migration.sql]))
    async function fixture(prefix: string) {
      const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`
      schemas.push(schema)
      await admin.query(`CREATE SCHEMA "${schema}"`)
      const pool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema), max: 2 })
      pools.push(pool)
      await pool.query(BASE_SCHEMA_DDL)
      return pool
    }
    async function applyRaw(pool: Pool, ids: string[]) {
      for (const id of ids) await pool.query(migrations.get(id)!)
    }

    try {
      const wrongBase = await fixture("historical_wrong_base")
      await wrongBase.query('ALTER TABLE document ALTER COLUMN status DROP DEFAULT; ALTER TABLE document ALTER COLUMN status TYPE integer USING 0')
      await expect(runHistoricalMigrations({ pool: wrongBase, apply: true }))
        .rejects.toThrow("HISTORICAL_MIGRATION_BASE_SCHEMA_INVALID")
      await expect(wrongBase.query("SELECT to_regclass('project') AS value"))
        .resolves.toMatchObject({ rows: [{ value: null }] })

      const partialProject = await fixture("historical_partial_project")
      await applyRaw(partialProject, ["0003"])
      await partialProject.query('ALTER TABLE project DROP CONSTRAINT project_user_key_unique')
      await expect(runHistoricalMigrations({ pool: partialProject, apply: true }))
        .rejects.toThrow("HISTORICAL_MIGRATION_PARTIAL_SCHEMA:project")
      await expect(partialProject.query(`SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'doctrine' AND column_name = 'historicalCandidateId'`))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })

      const wrongThread = await fixture("historical_wrong_thread")
      await applyRaw(wrongThread, ["0003", "0005", "0010"])
      await wrongThread.query(`ALTER TABLE workbench_thread_source DROP CONSTRAINT workbench_thread_source_type_check;
        ALTER TABLE workbench_thread_source ADD CONSTRAINT workbench_thread_source_type_check CHECK ("sourceType" IN ('goal','wrong_named_constraint'))`)
      await expect(runHistoricalMigrations({ pool: wrongThread, apply: true }))
        .rejects.toThrow("HISTORICAL_MIGRATION_PARTIAL_SCHEMA:thread")
      await expect(wrongThread.query(`SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'document' AND column_name = 'historicalCandidateId'`))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })

      const partial0014 = await fixture("historical_partial_0014")
      await applyRaw(partial0014, ["0003", "0005", "0010", "0014"])
      await partial0014.query(`DROP TRIGGER document_reject_historical_with_chunks ON document;
        DROP INDEX doctrine_historical_candidate_user_idx;
        CREATE INDEX doctrine_historical_candidate_user_idx ON doctrine ("userId", "historicalCandidateId")`)
      await expect(runHistoricalMigrations({ pool: partial0014, apply: true }))
        .rejects.toThrow("HISTORICAL_MIGRATION_PARTIAL_SCHEMA:0014")
      await expect(partial0014.query(`SELECT indexdef ILIKE 'CREATE UNIQUE INDEX%' AS unique
        FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'doctrine_historical_candidate_user_idx'`))
        .resolves.toMatchObject({ rows: [{ unique: false }] })
    } finally {
      await Promise.all(pools.map((pool) => pool.end()))
      for (const schema of schemas) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })

  it("migrates, applies, replays, rolls back collisions, archives, rejects W24, and cleans up", async () => {
    const schema = `historical_promotion_${randomUUID().replaceAll("-", "")}`
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!), max: 2 })
    let pool: Pool | null = null

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      pool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema), max: 4 })
      await pool.query(BASE_SCHEMA_DDL)

      const beforePlan = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema()")
      const migrationPlan = await runHistoricalMigrations({ pool, apply: false })
      const afterPlan = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema()")
      expect(migrationPlan).toMatchObject({ status: "DRY_RUN" })
      expect(afterPlan.rows[0].count).toBe(beforePlan.rows[0].count)

      await expect(runHistoricalMigrations({ pool, apply: true })).resolves.toMatchObject({
        status: "APPLIED",
        applied: ["0003", "0005", "0010", "0014"],
      })
      await expect(runHistoricalMigrations({ pool, apply: true })).resolves.toMatchObject({
        status: "APPLIED",
        applied: [],
      })

      await seedTenant(pool, "tenant-main")
      const plan = await executeHistoricalPromotion({ pool, userId: "tenant-main", mode: "plan" })
      expect(plan).toMatchObject({ status: "DRY_RUN", counts: { created: 0, events: 0, total: 9 } })
      await expect(pool.query('SELECT count(*)::int AS count FROM doctrine WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM document WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })

      const firstApply = await executeHistoricalPromotion({ pool, userId: "tenant-main", mode: "apply" })
      expect(firstApply).toMatchObject({
        status: "APPLIED",
        counts: { created: 9, replayed: 0, events: 9, total: 9 },
        w24: { canonicalHits: 0, eventHits: 0 },
      })
      expect(firstApply.records).toHaveLength(9)
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 9 }] })

      const replay = await executeHistoricalPromotion({ pool, userId: "tenant-main", mode: "apply" })
      expect(replay).toMatchObject({ status: "APPLIED", counts: { created: 0, replayed: 9, events: 0, total: 9 } })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 9 }] })

      await seedTenant(pool, "tenant-collision")
      const collisionCandidate = getHistoricalProjectContextCatalog().at(-1)!
      const collisionProject = await pool.query('SELECT id FROM project WHERE "userId" = $1 AND key = $2', ["tenant-collision", collisionCandidate.targetProjectKey])
      const collision = buildHistoricalProjectContextInsert("tenant-collision", collisionProject.rows[0].id, collisionCandidate, null)
      await pool.query(`
        INSERT INTO document (
          "userId", title, source, "mimeType", content, "chunkCount", status, "projectId", "threadId",
          "historicalCandidateId", "historicalClaimId", "historicalProvenance", privacy, authority, "executionMode", "archivedAt"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
      `, [
        collision.userId, collision.title, collision.source, collision.mimeType, "forced collision",
        collision.chunkCount, collision.status, collision.projectId, collision.threadId,
        "HKR-forced-claim-collision", collision.historicalClaimId, JSON.stringify(collision.historicalProvenance),
        collision.privacy, collision.authority, collision.executionMode, collision.archivedAt,
      ])
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-collision", mode: "plan" }))
        .rejects.toThrow(`HISTORICAL_PROJECT_CONTEXT_CLAIM_COLLISION:${collisionCandidate.claimId}`)
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-collision", mode: "apply" }))
        .rejects.toThrow(`HISTORICAL_PROJECT_CONTEXT_CLAIM_COLLISION:${collisionCandidate.claimId}`)
      await expect(pool.query('SELECT count(*)::int AS count FROM doctrine WHERE "userId" = $1', ["tenant-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM document WHERE "userId" = $1', ["tenant-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 1 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })

      const archived = await executeHistoricalPromotion({ pool, userId: "tenant-main", mode: "archive" })
      expect(archived).toMatchObject({ status: "ARCHIVED", counts: { archived: 9, replayed: 0, events: 9, total: 9 } })
      const archiveReplay = await executeHistoricalPromotion({ pool, userId: "tenant-main", mode: "archive" })
      expect(archiveReplay).toMatchObject({ status: "ARCHIVED", counts: { archived: 0, replayed: 9, events: 0, total: 9 } })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 18 }] })

      await seedTenant(pool, "tenant-w24")
      await pool.query('INSERT INTO memory_fact ("userId", content, authority) VALUES ($1, $2, $3)', [
        "tenant-w24", "HKR-ae7e0a5220b153cf", "canon",
      ])
      await expect(countW24Hits(pool, "tenant-w24")).resolves.toMatchObject({ canonicalHits: 1, eventHits: 0 })
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-w24", mode: "apply" }))
        .rejects.toThrow("HISTORICAL_PROMOTION_W24_PRESENT:1:0")
      await expect(pool.query('SELECT count(*)::int AS count FROM doctrine WHERE "userId" = $1', ["tenant-w24"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-w24"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })
    } finally {
      await pool?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      const residue = await admin.query("SELECT to_regnamespace($1) AS schema", [schema])
      expect(residue.rows[0].schema).toBeNull()
      await admin.end()
    }
  })

  it("fails closed on event drift and archive collisions while serializing concurrent archive replay", async () => {
    const schema = `historical_promotion_events_${randomUUID().replaceAll("-", "")}`
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!), max: 2 })
    let pool: Pool | null = null
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      pool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema), max: 6 })
      await pool.query(BASE_SCHEMA_DDL)
      await runHistoricalMigrations({ pool, apply: true })

      await seedTenant(pool, "tenant-event-missing")
      await executeHistoricalPromotion({ pool, userId: "tenant-event-missing", mode: "apply" })
      await pool.query(`DELETE FROM event_log WHERE id = (
        SELECT id FROM event_log WHERE "userId" = $1 AND metadata->>'candidateId' = $2 LIMIT 1
      )`, ["tenant-event-missing", "HKR-32a0add1327ffadd"])
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-event-missing", mode: "apply" }))
        .rejects.toThrow("HISTORICAL_PROMOTION_EVENT_COUNT_INVALID:HKR-32a0add1327ffadd:created:0")

      await seedTenant(pool, "tenant-event-duplicate")
      await executeHistoricalPromotion({ pool, userId: "tenant-event-duplicate", mode: "apply" })
      await pool.query(`INSERT INTO event_log ("userId", type, summary, register, "refId", metadata)
        SELECT "userId", type, summary, register, "refId", metadata FROM event_log
        WHERE "userId" = $1 AND metadata->>'candidateId' = $2 LIMIT 1`, [
        "tenant-event-duplicate", "HKR-ada454f7cb889228",
      ])
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-event-duplicate", mode: "apply" }))
        .rejects.toThrow("HISTORICAL_PROMOTION_EVENT_COUNT_INVALID:HKR-ada454f7cb889228:created:2")

      await seedTenant(pool, "tenant-event-mismatch")
      await executeHistoricalPromotion({ pool, userId: "tenant-event-mismatch", mode: "apply" })
      await pool.query(`UPDATE event_log SET "refId" = 999999
        WHERE "userId" = $1 AND metadata->>'candidateId' = $2`, [
        "tenant-event-mismatch", "HKR-d200030578f50efe",
      ])
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-event-mismatch", mode: "apply" }))
        .rejects.toThrow("HISTORICAL_PROMOTION_EVENT_MISMATCH:HKR-d200030578f50efe:created")

      await seedTenant(pool, "tenant-archive-claim-collision")
      await executeHistoricalPromotion({ pool, userId: "tenant-archive-claim-collision", mode: "apply" })
      const lastProjectCandidate = getHistoricalProjectContextCatalog().at(-1)!
      await insertProjectContextFixture(pool, "tenant-archive-claim-collision", lastProjectCandidate, {
        candidateId: "HKR-archive-claim-collision",
        claimId: lastProjectCandidate.claimId,
      })
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-archive-claim-collision", mode: "archive" }))
        .rejects.toThrow(`HISTORICAL_PROJECT_CONTEXT_CLAIM_COLLISION:${lastProjectCandidate.claimId}`)
      await expect(pool.query(`SELECT
        (SELECT count(*)::int FROM doctrine WHERE "userId" = $1 AND status = 'historical_input')
        + (SELECT count(*)::int FROM document WHERE "userId" = $1 AND status = 'private_project_context') AS count`, ["tenant-archive-claim-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 10 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-archive-claim-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 9 }] })

      await seedTenant(pool, "tenant-archive-owner-collision")
      await executeHistoricalPromotion({ pool, userId: "tenant-archive-owner-collision", mode: "apply" })
      await insertProjectContextFixture(pool, "tenant-archive-owner-collision", getHistoricalProjectContextCatalog()[0], {
        candidateId: "HKR-32a0add1327ffadd",
        claimId: "HKR-rogue-wrong-owner",
      })
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-archive-owner-collision", mode: "archive" }))
        .rejects.toThrow("HISTORICAL_PROMOTION_OWNER_COLLISION:HKR-32a0add1327ffadd")
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-archive-owner-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 9 }] })

      await seedTenant(pool, "tenant-concurrent-archive")
      await executeHistoricalPromotion({ pool, userId: "tenant-concurrent-archive", mode: "apply" })
      const concurrent = await Promise.all([
        executeHistoricalPromotion({ pool, userId: "tenant-concurrent-archive", mode: "archive" }),
        executeHistoricalPromotion({ pool, userId: "tenant-concurrent-archive", mode: "archive" }),
      ])
      expect(concurrent.map((result) => result.counts.archived).sort()).toEqual([0, 9])
      await expect(pool.query(`SELECT count(*)::int AS count FROM event_log
        WHERE "userId" = $1 AND type IN ('doctrine.historical_input_archived','document.historical_project_context_archived')`, ["tenant-concurrent-archive"]))
        .resolves.toMatchObject({ rows: [{ count: 9 }] })
      await pool.query(`DELETE FROM event_log WHERE id = (
        SELECT id FROM event_log WHERE "userId" = $1 AND type = 'doctrine.historical_input_archived' LIMIT 1
      )`, ["tenant-concurrent-archive"])
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-concurrent-archive", mode: "archive" }))
        .rejects.toThrow(/HISTORICAL_PROMOTION_EVENT_COUNT_INVALID:.*:archived:0/)

      await seedTenant(pool, "tenant-archive-event-duplicate")
      await executeHistoricalPromotion({ pool, userId: "tenant-archive-event-duplicate", mode: "apply" })
      await executeHistoricalPromotion({ pool, userId: "tenant-archive-event-duplicate", mode: "archive" })
      await pool.query(`INSERT INTO event_log ("userId", type, summary, register, "refId", metadata)
        SELECT "userId", type, summary, register, "refId", metadata FROM event_log
        WHERE "userId" = $1 AND type = 'document.historical_project_context_archived' LIMIT 1`, ["tenant-archive-event-duplicate"])
      await expect(executeHistoricalPromotion({ pool, userId: "tenant-archive-event-duplicate", mode: "archive" }))
        .rejects.toThrow(/HISTORICAL_PROMOTION_EVENT_COUNT_INVALID:.*:archived:2/)
    } finally {
      await pool?.end()
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await admin.end()
    }
  })
})
