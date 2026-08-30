import { randomUUID } from "node:crypto"
import { Pool } from "pg"
import { describe, expect, it } from "vitest"

import { buildHistoricalProjectContextInsert, getHistoricalProjectContextCatalog } from "@/lib/history/historical-project-context"
import { runHistoricalMigrations } from "@/scripts/db/historical-migration-runner.mjs"
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

runDatabase("historical nine-record executor on isolated PostgreSQL", { timeout: 90_000 }, () => {
  it("migrates, applies, replays, rolls back collisions, archives, rejects W24, and cleans up", async () => {
    const schema = `historical_promotion_${randomUUID().replaceAll("-", "")}`
    const admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!), max: 1 })
    let pool: Pool | null = null

    try {
      await admin.query(`CREATE SCHEMA "${schema}"`)
      pool = new Pool({ connectionString: schemaDatabaseUrl(databaseUrl!, schema), max: 1 })
      await pool.query(BASE_SCHEMA_DDL)

      const beforePlan = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema()")
      const migrationPlan = await runHistoricalMigrations({ client: pool, apply: false })
      const afterPlan = await pool.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = current_schema()")
      expect(migrationPlan).toMatchObject({ status: "DRY_RUN" })
      expect(afterPlan.rows[0].count).toBe(beforePlan.rows[0].count)

      await expect(runHistoricalMigrations({ client: pool, apply: true })).resolves.toMatchObject({
        status: "APPLIED",
        applied: ["0003", "0005", "0010", "0014"],
      })
      await expect(runHistoricalMigrations({ client: pool, apply: true })).resolves.toMatchObject({
        status: "APPLIED",
        applied: [],
      })

      await seedTenant(pool, "tenant-main")
      const plan = await executeHistoricalPromotion({ client: pool, userId: "tenant-main", mode: "plan" })
      expect(plan).toMatchObject({ status: "DRY_RUN", counts: { created: 0, events: 0, total: 9 } })
      await expect(pool.query('SELECT count(*)::int AS count FROM doctrine WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM document WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })

      const firstApply = await executeHistoricalPromotion({ client: pool, userId: "tenant-main", mode: "apply" })
      expect(firstApply).toMatchObject({
        status: "APPLIED",
        counts: { created: 9, replayed: 0, events: 9, total: 9 },
        w24: { canonicalHits: 0, eventHits: 0 },
      })
      expect(firstApply.records).toHaveLength(9)
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 9 }] })

      const replay = await executeHistoricalPromotion({ client: pool, userId: "tenant-main", mode: "apply" })
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
      await expect(executeHistoricalPromotion({ client: pool, userId: "tenant-collision", mode: "plan" }))
        .rejects.toThrow(`HISTORICAL_PROJECT_CONTEXT_CLAIM_COLLISION:${collisionCandidate.claimId}`)
      await expect(executeHistoricalPromotion({ client: pool, userId: "tenant-collision", mode: "apply" }))
        .rejects.toThrow(`HISTORICAL_PROJECT_CONTEXT_CLAIM_COLLISION:${collisionCandidate.claimId}`)
      await expect(pool.query('SELECT count(*)::int AS count FROM doctrine WHERE "userId" = $1', ["tenant-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM document WHERE "userId" = $1', ["tenant-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 1 }] })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-collision"]))
        .resolves.toMatchObject({ rows: [{ count: 0 }] })

      const archived = await executeHistoricalPromotion({ client: pool, userId: "tenant-main", mode: "archive" })
      expect(archived).toMatchObject({ status: "ARCHIVED", counts: { archived: 9, replayed: 0, events: 9, total: 9 } })
      const archiveReplay = await executeHistoricalPromotion({ client: pool, userId: "tenant-main", mode: "archive" })
      expect(archiveReplay).toMatchObject({ status: "ARCHIVED", counts: { archived: 0, replayed: 9, events: 0, total: 9 } })
      await expect(pool.query('SELECT count(*)::int AS count FROM event_log WHERE "userId" = $1', ["tenant-main"]))
        .resolves.toMatchObject({ rows: [{ count: 18 }] })

      await seedTenant(pool, "tenant-w24")
      await pool.query('INSERT INTO memory_fact ("userId", content, authority) VALUES ($1, $2, $3)', [
        "tenant-w24", "HKR-ae7e0a5220b153cf", "canon",
      ])
      await expect(countW24Hits(pool, "tenant-w24")).resolves.toMatchObject({ canonicalHits: 1, eventHits: 0 })
      await expect(executeHistoricalPromotion({ client: pool, userId: "tenant-w24", mode: "apply" }))
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
})
