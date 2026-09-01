import { randomUUID } from "node:crypto"

import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  buildFocusedValidationCommand,
  createDeterministicValidatorCircuit,
  createDeterministicValidatorReplacement,
  createDeterministicValidatorWallEvidence,
} from "../scripts/hermes-bridge/deterministic-validator-recovery.mjs"
import {
  recoverDeterministicValidatorQueue,
} from "../scripts/hermes-bridge/deterministic-validator-queue-recovery.mjs"

const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const run = databaseUrl ? describe : describe.skip

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function recoveryExecution() {
  const contractBody = {
    id: "outcome-44-recovery",
    lane: "operator-objective",
    reservations: ["app/page.tsx", "tests/app.test.tsx"],
    validationCommands: [{ command: "npx", args: ["vitest", "run", "tests/app.test.tsx"], timeoutMs: 60_000 }],
  }
  const contract = { ...contractBody, digest: "a".repeat(64) }
  const focusedValidationCommand = buildFocusedValidationCommand({
    testPaths: ["packages/ui/src/__tests__/county.spec.ts"],
  })
  const evidence = createDeterministicValidatorWallEvidence({
    outcomeId: "44",
    outcomeKey: "goal:GOAL-0040",
    contract,
    worktreeSnapshotHash: "b".repeat(64),
    missingTestPaths: ["packages/ui/src/__tests__/county.spec.ts"],
    focusedValidationCommand,
  })
  const replacement = createDeterministicValidatorReplacement({ contract, evidence })
  const circuit = createDeterministicValidatorCircuit({
    evidence,
    replacement,
    sourceFencingToken: 225,
    sourceCheckpointSequence: 17,
    observedAt: "2026-08-31T12:00:00.000Z",
  })
  return {
    outcomeId: "44",
    fencingToken: 225,
    lease: { status: "ABANDONED" },
    metadata: {
      deterministicValidatorCircuit: circuit,
      outcome: {
        id: 44,
        goalId: 40,
        ref: "GOAL-0040",
        userId: "owner-id",
        outcomeKey: "goal:GOAL-0040",
        queueBinding: {
          userId: "owner-id",
          outcomeKey: "goal:GOAL-0040",
          expectedVersion: 12,
          executionBinding: "execution-44",
          leaseHolder: "Hermes:hermes-outcome-queue",
          leaseToken: "lease-44",
          acquisitionKey: "acquisition-44",
          fencingToken: 34,
          authorityGrantRef: "grant-44",
          activeWorkOrderId: 144,
        },
      },
    },
  }
}

run("production deterministic validator recovery on PostgreSQL", { timeout: 90_000 }, () => {
  let admin: import("pg").Pool
  let pool: import("pg").Pool
  let schema: string

  beforeAll(async () => {
    const { Pool } = await import("pg")
    admin = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    await admin.query("CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public")
    schema = `hermes_validator_recovery_${randomUUID().replaceAll("-", "")}`
    await admin.query(`CREATE SCHEMA "${schema}"`)
    const scoped = new URL(directDatabaseUrl(databaseUrl!))
    scoped.searchParams.set("options", `-csearch_path=${schema},public`)
    pool = new Pool({ connectionString: scoped.toString(), max: 4 })
    await pool.query(`
      CREATE TABLE "decision" (
        id integer PRIMARY KEY, "userId" text NOT NULL, status text NOT NULL,
        authority text NOT NULL, decision text NOT NULL, scope text NOT NULL,
        ref text, owner text, locked boolean DEFAULT false,
        evidence text[] NOT NULL DEFAULT ARRAY[]::text[],
        tags text[] NOT NULL DEFAULT ARRAY[]::text[]
      );
      CREATE TABLE "authority_grant" (
        id integer PRIMARY KEY, "userId" text NOT NULL, ref text NOT NULL,
        status text NOT NULL, "revokedAt" timestamptz, "expiresAt" timestamptz,
        "authorityLevel" text, "grantedBy" text, "grantedTo" text NOT NULL, scope text NOT NULL,
        "workOrderId" integer, "allowedActions" text[] NOT NULL,
        "blockedActions" text[] NOT NULL DEFAULT ARRAY[]::text[]
      );
      CREATE TABLE "work_order" (
        id integer PRIMARY KEY, "userId" text NOT NULL, ref text NOT NULL,
        goal text NOT NULL, status text NOT NULL, "allowedFiles" text[] NOT NULL,
        validators text[] NOT NULL, lane text NOT NULL, assignee text NOT NULL,
        agent text NOT NULL, "authorityGrantId" integer NOT NULL,
        "updatedAt" timestamptz NOT NULL
      );
      CREATE TABLE "workbench_thread_source" (
        "userId" text NOT NULL, "sourceType" text NOT NULL, "sourceId" text NOT NULL,
        role text NOT NULL, "threadId" text NOT NULL
      );
      CREATE TABLE "workbench_thread" (
        id text PRIMARY KEY, "userId" text NOT NULL, "projectId" integer NOT NULL
      );
      CREATE TABLE "project" (
        id integer PRIMARY KEY, "userId" text NOT NULL, lifecycle text NOT NULL
      );
      CREATE TABLE "project_resource" (
        "userId" text NOT NULL, "projectId" integer NOT NULL, type text NOT NULL,
        relationship text NOT NULL, "canonicalIdentity" text NOT NULL
      );
      CREATE TABLE "goal" (
        id integer PRIMARY KEY, "userId" text NOT NULL, command text NOT NULL,
        "acceptedContractIds" text[] NOT NULL DEFAULT ARRAY[]::text[]
      );
      CREATE TABLE "goal_outcome_intake_receipt" (
        id integer PRIMARY KEY, "userId" text NOT NULL, "goalId" integer NOT NULL,
        "outcomeKey" text NOT NULL, "acceptedContractIds" text[] NOT NULL,
        "idempotencyKey" text NOT NULL, "requestHash" text NOT NULL,
        "resultDigest" text NOT NULL
      );
      CREATE TABLE "outcome_queue_item" (
        id integer PRIMARY KEY, "userId" text NOT NULL, "goalId" integer NOT NULL,
        "goalRef" text NOT NULL, "outcomeKey" text NOT NULL, title text NOT NULL,
        objective text, "acceptedContractIds" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "riskClass" text NOT NULL, "approvalState" text NOT NULL,
        "approvalDecisionId" integer NOT NULL, "approvedAt" timestamptz,
        "authorityState" text NOT NULL,
        "authorityLevel" text NOT NULL, "authorityGrantRef" text NOT NULL,
        "authoritySubject" text NOT NULL, "authorityAction" text NOT NULL,
        "lifecycleState" text NOT NULL, "lifecycleReason" text,
        "activeWorkOrderId" integer NOT NULL, "executionBinding" text NOT NULL,
        "leaseHolder" text NOT NULL, "leaseToken" text NOT NULL,
        "leaseExpiresAt" timestamptz NOT NULL, "fencingToken" integer NOT NULL,
        version integer NOT NULL, "acquisitionKey" text NOT NULL,
        "updatedAt" timestamptz NOT NULL
      );
      CREATE TABLE "outcome_queue_mutation_receipt" (
        id bigserial PRIMARY KEY, "userId" text NOT NULL, "idempotencyKey" text NOT NULL,
        operation text NOT NULL, "outcomeKey" text NOT NULL, "requestHash" text NOT NULL,
        "requestBinding" jsonb NOT NULL, "resultBinding" jsonb NOT NULL,
        "createdAt" timestamptz NOT NULL,
        UNIQUE ("userId", "idempotencyKey")
      );
      CREATE TABLE "outcome_queue_acquisition_receipt" (
        id integer PRIMARY KEY, "userId" text NOT NULL, "acquisitionKey" text NOT NULL,
        "outcomeKey" text NOT NULL, "latestFencingToken" integer NOT NULL,
        "updatedAt" timestamptz NOT NULL
      );
      CREATE TABLE "governance_event" (
        id bigserial PRIMARY KEY, "userId" text NOT NULL, "eventType" text NOT NULL,
        "entityType" text NOT NULL, "entityId" text NOT NULL, actor text NOT NULL,
        reason text, metadata jsonb NOT NULL, "createdAt" timestamptz NOT NULL
      );
    `)
  })

  afterAll(async () => {
    await pool?.end()
    if (admin && schema) await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin?.end()
  })

  it("executes the production SQL, serializes contenders, and continues an expired post-COMMIT replay", async () => {
    const execution = recoveryExecution()
    const recovery = execution.metadata.deterministicValidatorCircuit.recovery
    const oldValidators = recovery.oldContract.validationCommands.map(
      ({ command, args }: any) => `${command} ${args.join(" ")}`,
    )
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const requestBinding = {
      operation: "runtime_finding.derive",
      sourceFindingEventId: "501",
      sourcePayloadDigest: "c".repeat(64),
      sourceCheckpointId: "checkpoint-44",
      sourceCheckpointDigest: "d".repeat(64),
    }
    const resultBinding = {
      outcomeKey: "goal:GOAL-0040", goalId: "40", goalRef: "GOAL-0040",
      workOrderId: "144", workOrderRef: "WO-HERMES-OUTCOME-40",
      decisionId: "41", approvalDecisionId: "41",
      grantId: "42", grantRef: "grant-44", queueGrantId: "42", queueGrantRef: "grant-44",
      implementationGrantId: "43", implementationGrantRef: "grant-44-implementation",
      workContract: recovery.oldContract,
    }
    await pool.query(`INSERT INTO "decision" (id,"userId",status,authority,decision,scope) VALUES
      (41,'owner-id','accepted','binding','APPROVE','goal:GOAL-0040')`)
    await pool.query(`
      INSERT INTO "authority_grant"
        (id,"userId",ref,status,"revokedAt","expiresAt","authorityLevel","grantedBy","grantedTo",scope,"workOrderId","allowedActions","blockedActions") VALUES
        (42,'owner-id','grant-44','active',NULL,$1,'A2_WRITE_OWN','owner-id','operator','goal:GOAL-0040',144,ARRAY['outcome:execute'],ARRAY[]::text[]),
        (43,'owner-id','grant-44-implementation','active',NULL,$1,'A2_WRITE_OWN','owner-id','operator','WO-HERMES-OUTCOME-40',144,ARRAY['implement'],ARRAY[]::text[])
    `, [expiresAt])
    await pool.query(`INSERT INTO "work_order" VALUES
      (144,'owner-id','WO-HERMES-OUTCOME-40','GOAL-0040','active',$1,$2,'operator-objective','hermes-codex-bridge','codex',43,clock_timestamp())`,
    [recovery.oldContract.reservations, oldValidators])
    await pool.query(`
      INSERT INTO "outcome_queue_item"
        (id,"userId","goalId","goalRef","outcomeKey",title,objective,"acceptedContractIds",
         "riskClass","approvalState","approvalDecisionId","approvedAt","authorityState","authorityLevel","authorityGrantRef",
         "authoritySubject","authorityAction","lifecycleState","lifecycleReason","activeWorkOrderId",
         "executionBinding","leaseHolder","leaseToken","leaseExpiresAt","fencingToken",version,"acquisitionKey","updatedAt") VALUES
        (44,'owner-id',40,'GOAL-0040','goal:GOAL-0040','Repair deterministic recovery','bounded supervisor recovery',ARRAY[]::text[],
         'R1','approved',41,clock_timestamp(),'matched','A2_WRITE_OWN','grant-44','operator','outcome:execute','active','RUNNING',144,
         'execution-44','Hermes:hermes-outcome-queue','lease-44',clock_timestamp() + interval '5 minutes',34,12,'acquisition-44',clock_timestamp())
    `)
    await pool.query(`
      INSERT INTO "governance_event" (id,"userId","eventType","entityType","entityId",actor,reason,metadata,"createdAt") VALUES
        (501,'owner-id','RUNTIME_OBJECTIVE_FINDING_RECORDED','goal','40','hermes','finding',
         jsonb_build_object('payloadDigest',$1::text,'sourceCheckpointId','checkpoint-44','sourceCheckpointDigest',$2::text),clock_timestamp()),
        (502,'owner-id','RUNTIME_FINDING_DERIVED','goal','40','williamos-runtime-operator','derived',
         jsonb_build_object('sourceFindingEventId','501'),clock_timestamp())
    `, ["c".repeat(64), "d".repeat(64)])
    await pool.query(`
      INSERT INTO "outcome_queue_mutation_receipt"
        (id,"userId","idempotencyKey",operation,"outcomeKey","requestHash","requestBinding","resultBinding","createdAt")
        VALUES (601,'owner-id','runtime-finding-44','runtime_finding.derive','goal:GOAL-0040','e',$1::jsonb,$2::jsonb,clock_timestamp())
    `, [JSON.stringify(requestBinding), JSON.stringify(resultBinding)])
    await pool.query("SELECT setval(pg_get_serial_sequence('outcome_queue_mutation_receipt','id'),601,true)")
    await pool.query(`INSERT INTO "outcome_queue_acquisition_receipt" VALUES
      (701,'owner-id','acquisition-44','goal:GOAL-0040',34,clock_timestamp())`)

    const [first, concurrentReplay] = await Promise.all([
      recoverDeterministicValidatorQueue({ execution, pool }),
      recoverDeterministicValidatorQueue({ execution, pool }),
    ])
    expect(concurrentReplay).toEqual(first)
    expect(first).toMatchObject({ recoveredExpectedVersion: 13, recoveredFencingToken: 35, continuationCount: 0 })

    const expiredAt = new Date(Date.now() - 1_000).toISOString()
    await pool.query(`UPDATE "outcome_queue_item" SET "leaseExpiresAt" = $1::timestamptz`, [expiredAt])
    await pool.query(`UPDATE "outcome_queue_mutation_receipt"
         SET "resultBinding" = jsonb_set("resultBinding",'{queueRecovery,recoveredLeaseExpiresAt}',
           to_jsonb($1::text))
       WHERE operation = 'deterministic_validator.recover'
    `, [expiredAt])
    const continued = await recoverDeterministicValidatorQueue({ execution, pool })
    const postCrashReplay = await recoverDeterministicValidatorQueue({ execution, pool })
    expect(postCrashReplay).toEqual(continued)
    expect(continued).toMatchObject({
      sourceExpectedVersion: 12, recoveredExpectedVersion: 14,
      sourceFencingToken: 34, recoveredFencingToken: 36,
      continuationCount: 1,
    })
    const durable = await pool.query(`
      SELECT q.version, q."fencingToken", q."leaseExpiresAt", a."latestFencingToken",
        w.validators, count(r.id)::int AS continuation_receipts
      FROM "outcome_queue_item" q
      JOIN "outcome_queue_acquisition_receipt" a ON a."outcomeKey"=q."outcomeKey"
      JOIN "work_order" w ON w.id=q."activeWorkOrderId"
      LEFT JOIN "outcome_queue_mutation_receipt" r
        ON r."outcomeKey"=q."outcomeKey" AND r.operation='deterministic_validator.continue'
      GROUP BY q.version,q."fencingToken",q."leaseExpiresAt",a."latestFencingToken",w.validators
    `)
    expect(durable.rows[0]).toMatchObject({
      version: 14, fencingToken: 36, latestFencingToken: 36,
      validators: recovery.replacementContract.validationCommands.map(
        ({ command, args }: any) => `${command} ${args.join(" ")}`,
      ),
      continuation_receipts: 1,
    })
    expect(Date.parse(durable.rows[0].leaseExpiresAt)).toBeGreaterThan(Date.now())
  })
})
