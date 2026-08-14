import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OUTCOME_QUEUE_SQL } from "@/scripts/hermes-bridge/outcome-queue-source.mjs"
import {
  HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST,
  HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
} from "@/scripts/hermes-bridge/work-contract.mjs"

const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const run = databaseUrl ? describe : describe.skip

run("Hermes Project execution PostgreSQL predicates", () => {
  let client: import("pg").PoolClient
  let pool: import("pg").Pool
  const userId = "project-execution-owner"
  const outcomeKey = "goal:GOAL-PG-EXECUTION"
  const projectId = 7
  const threadId = "thread-pg-execution"
  const grantRef = "GRANT-PG-EXECUTION"
  const decisionId = 31
  const now = "2026-08-14T20:00:00.000Z"

  beforeAll(async () => {
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: databaseUrl })
    client = await pool.connect()
    const schema = `hermes_project_execution_${randomUUID().replaceAll("-", "")}`
    await client.query(`CREATE SCHEMA ${schema}`)
    await client.query(`SET search_path TO ${schema}`)
    await client.query(`
      CREATE TABLE "outcome_queue_item" (
        "userId" text NOT NULL,
        "outcomeKey" text NOT NULL,
        "title" text NOT NULL,
        "objective" text,
        "riskClass" text NOT NULL,
        "approvalState" text NOT NULL,
        "approvalDecisionId" integer,
        "authorityState" text NOT NULL,
        "authorityLevel" text NOT NULL,
        "authorityGrantRef" text,
        "authoritySubject" text NOT NULL,
        "authorityAction" text NOT NULL,
        "activeWorkOrderId" integer
      );
      CREATE TABLE "decision" (
        id integer PRIMARY KEY,
        "userId" text NOT NULL,
        status text NOT NULL,
        authority text NOT NULL,
        decision text NOT NULL,
        scope text NOT NULL
      );
      CREATE TABLE "authority_grant" (
        "userId" text NOT NULL,
        ref text NOT NULL,
        status text NOT NULL,
        "revokedAt" timestamp,
        "expiresAt" timestamp,
        "authorityLevel" text NOT NULL,
        "grantedTo" text NOT NULL,
        scope text NOT NULL,
        "workOrderId" integer,
        "allowedActions" text[] NOT NULL,
        "blockedActions" text[] NOT NULL
      );
      CREATE TABLE "workbench_thread_source" (
        "userId" text NOT NULL,
        "threadId" text NOT NULL,
        "sourceType" text NOT NULL,
        "sourceId" text NOT NULL,
        role text NOT NULL
      );
      CREATE TABLE "workbench_thread" (
        id text NOT NULL,
        "userId" text NOT NULL,
        "projectId" integer NOT NULL
      );
      CREATE TABLE "project" (
        id integer NOT NULL,
        "userId" text NOT NULL,
        lifecycle text NOT NULL
      );
      CREATE TABLE "project_resource" (
        "userId" text NOT NULL,
        "projectId" integer NOT NULL,
        type text NOT NULL,
        relationship text NOT NULL,
        "canonicalIdentity" text NOT NULL
      );
      CREATE TABLE "outcome_queue_mutation_receipt" (
        "userId" text NOT NULL,
        "outcomeKey" text,
        operation text NOT NULL,
        "requestBinding" jsonb NOT NULL,
        "resultBinding" jsonb NOT NULL
      );
    `)
  })

  afterAll(async () => {
    client?.release()
    await pool?.end()
  })

  async function resetValidGraph() {
    await client.query(`
      TRUNCATE "outcome_queue_item", "decision", "authority_grant",
        "workbench_thread_source", "workbench_thread", "project",
        "project_resource", "outcome_queue_mutation_receipt";
    `)
    await client.query(`
      INSERT INTO "outcome_queue_item" VALUES
        ($1,$2,'Bounded Workbench change','Bounded Workbench change','R1',
         'approved',$3,'matched','A2_WRITE_OWN',$4,'operator','outcome:execute',NULL)
    `, [userId, outcomeKey, decisionId, grantRef])
    await client.query(
      `INSERT INTO "decision" VALUES ($3,$1,'accepted','binding','APPROVE',$2)`,
      [userId, outcomeKey, decisionId],
    )
    await client.query(`
      INSERT INTO "authority_grant" VALUES
        ($1,$3,'active',NULL,'2026-08-15 20:00:00','A2_WRITE_OWN','operator',$2,NULL,
         ARRAY['outcome:execute'],ARRAY['production:mutate'])
    `, [userId, outcomeKey, grantRef])
    await client.query(`INSERT INTO "project" VALUES ($2,$1,'active')`, [userId, projectId])
    await client.query(`INSERT INTO "workbench_thread" VALUES ($2,$1,$3)`, [userId, threadId, projectId])
    await client.query(
      `INSERT INTO "workbench_thread_source" VALUES ($1,$2,'outcome',$3,'root')`,
      [userId, threadId, outcomeKey],
    )
    await client.query(`
      INSERT INTO "project_resource" VALUES
        ($1,$2,'repo','primary-repo','bsvalues/terragroq')
    `, [userId, projectId])
    await client.query(`
      INSERT INTO "outcome_queue_mutation_receipt" VALUES
        ($1,$2,'workbench_execution.authorize',
         jsonb_build_object('confirmation','START_WORK','outcomeKey',$2::text,
           'threadId',$6::text,'projectId',$5::integer::text),
         jsonb_build_object('grantRef',$4::text,'decisionId',$3::integer::text,'workContract',
           jsonb_build_object('id',$7::text,'digest',$8::text)))
    `, [
      userId,
      outcomeKey,
      decisionId,
      grantRef,
      projectId,
      threadId,
      HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_ID,
      HERMES_SELECTED_THREAD_LATEST_EVIDENCE_CONTRACT_DIGEST,
    ])
  }

  async function readTruth() {
    const result = await client.query(OUTCOME_QUEUE_SQL.revalidateAcquisition, [
      now,
      userId,
      outcomeKey,
    ])
    expect(result.rows).toHaveLength(1)
    return result.rows[0] as { approvalLive: boolean; authorityLive: boolean }
  }

  it("accepts only the exact authorized Project Thread repository graph", async () => {
    await resetValidGraph()
    await expect(readTruth()).resolves.toEqual({ approvalLive: true, authorityLive: true })
  })

  it("rejects globally duplicated roots even when each Thread has one WilliamOS repo", async () => {
    await resetValidGraph()
    await client.query(`INSERT INTO "project" VALUES (8,$1,'active')`, [userId])
    await client.query(
      `INSERT INTO "workbench_thread" VALUES ('thread-pg-duplicate',$1,8)`,
      [userId],
    )
    await client.query(`
      INSERT INTO "workbench_thread_source" VALUES
        ($1,'thread-pg-duplicate','outcome',$2,'root')
    `, [userId, outcomeKey])
    await client.query(`
      INSERT INTO "project_resource" VALUES
        ($1,8,'repo','primary-repo','bsvalues/terragroq')
    `, [userId])
    await expect(readTruth()).resolves.toEqual({ approvalLive: true, authorityLive: false })
  })

  it("rejects a root moved away from the immutable authorization Thread", async () => {
    await resetValidGraph()
    await client.query(`INSERT INTO "project" VALUES (8,$1,'active')`, [userId])
    await client.query(
      `INSERT INTO "workbench_thread" VALUES ('thread-pg-moved',$1,8)`,
      [userId],
    )
    await client.query(`
      INSERT INTO "project_resource" VALUES
        ($1,8,'repo','primary-repo','bsvalues/terragroq')
    `, [userId])
    await client.query(
      `UPDATE "workbench_thread_source" SET "threadId"='thread-pg-moved'`,
    )
    await expect(readTruth()).resolves.toEqual({ approvalLive: true, authorityLive: false })
  })

  it("rejects receipt Project or reviewed work-contract drift", async () => {
    await resetValidGraph()
    await client.query(`
      UPDATE "outcome_queue_mutation_receipt"
      SET "requestBinding" = jsonb_set("requestBinding", '{projectId}', '"999"');
    `)
    await expect(readTruth()).resolves.toEqual({ approvalLive: true, authorityLive: false })

    await resetValidGraph()
    await client.query(`
      UPDATE "outcome_queue_mutation_receipt"
      SET "resultBinding" = jsonb_set("resultBinding", '{workContract,digest}', '"drifted"');
    `)
    await expect(readTruth()).resolves.toEqual({ approvalLive: true, authorityLive: false })
  })
})
