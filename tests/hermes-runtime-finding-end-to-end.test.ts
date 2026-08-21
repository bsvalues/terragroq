import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { OUTCOME_QUEUE_SQL } from "../scripts/hermes-bridge/outcome-queue-source.mjs"
import { projectOutcomeRuntimeCheckpoint } from "../scripts/hermes-bridge/outcome-source.mjs"
import { resolveHermesWorkContract } from "../scripts/hermes-bridge/work-contract.mjs"
import { createRuntimeFindingDbConsumer } from "../scripts/runtime-findings/db-consumer.mjs"

const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip
const intent = "record structured #911 reliability remediation without host mutation"
const now = new Date("2026-08-20T19:00:00.000Z")
const outcomeKey = "goal:GOAL-911-E2E"
const executionBinding = "execution-binding-911-e2e"
const acquisitionKey = "acquisition-key-911-e2e"
const leaseToken = "lease-token-911-e2e"
const userId = "runtime-finding-e2e-owner"
const reportPath = "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"

const canonicalJson = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  : JSON.stringify(value)

const canonicalDigest = (value: unknown) => createHash("sha256")
  .update(canonicalJson(value)).digest("hex")

function directDatabaseUrl(url: string) {
  const parsed = new URL(url)
  parsed.hostname = parsed.hostname.replace("-pooler.", ".")
  return parsed.toString()
}

function scopedDatabaseUrl(url: string, schema: string) {
  const parsed = new URL(directDatabaseUrl(url))
  parsed.searchParams.set("options", `-csearch_path=${schema}`)
  return parsed.toString()
}

async function bootstrap(client: import("pg").PoolClient, schema: string) {
  await client.query(`CREATE SCHEMA "${schema}"`)
  await client.query(`SET search_path TO "${schema}"`)
  const tables = new Set([
    "authority_grant", "decision", "event_log", "evidence_record", "goal",
    "governance_event", "outcome_queue_item", "project", "project_resource", "user",
    "work_order", "workbench_thread", "workbench_thread_source",
  ])
  const migration = fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_williamos_init.sql"), "utf8")
  for (const statement of migration.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    const created = statement.match(/^CREATE TABLE "([^"]+)"/)?.[1]
    const altered = statement.match(/^ALTER TABLE "([^"]+)"/)?.[1]
    const indexed = statement.match(/^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/)?.[1]
    const refs = [...statement.matchAll(/REFERENCES "public"\."([^"]+)"/g)].map((match) => match[1])
    if (!(created && tables.has(created))
      && !(altered && tables.has(altered) && refs.every((ref) => tables.has(ref)))
      && !(indexed && tables.has(indexed))) continue
    await client.query(statement.replaceAll('"public".', `"${schema}".`))
  }
  for (const statement of [
    OUTCOME_QUEUE_SQL.ensureMutationReceiptTable,
    OUTCOME_QUEUE_SQL.ensureMutationReceiptOutcomeIndex,
    OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable,
    OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptOutcomeIndex,
    OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptTable,
    OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptIndexes,
  ]) await client.query(statement)
}

const workContract = resolveHermesWorkContract({
  command: intent, title: intent, objective: intent,
  lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
})!
const runtimeWorkContract = {
  version: workContract.version, id: workContract.id, digest: workContract.digest,
  repository: workContract.repository, lane: workContract.lane,
  allowedFiles: [...workContract.reservations],
  validators: workContract.validationCommands.map((validator) => (
    `${validator.command} ${validator.args.join(" ")}`
  )),
  projection: workContract.projection, delivery: workContract.delivery,
}

async function seedAuthorizedParent(client: import("pg").PoolClient) {
  const requestBinding = {
    projectId: 7, threadId: "thread-911-e2e", outcomeKey,
    idempotencyKey: "workbench-execution:911-e2e", confirmation: "START_WORK",
  }
  const resultBinding = {
    decisionId: 74, decisionRef: "WB-EXEC-DECISION-911-E2E",
    grantId: 80, grantRef: "WB-EXEC-GRANT-911-E2E",
    implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911-E2E",
    queueVersion: 1, authorizedAt: "2026-08-20T18:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z", workContract,
  }
  const approvalEvidence = [
    "project:7", "thread:thread-911-e2e", `repo:${workContract.repository}`,
    `work-contract:${workContract.id}`, `work-contract-digest:${workContract.digest}`,
    `work-contract-json:${JSON.stringify(workContract)}`,
    ...workContract.reservations.map((reservation) => `reservation:${reservation}`),
    ...workContract.validationCommands.map((validator) => (
      `validator:${validator.command}:${validator.args.join(" ")}`
    )),
  ]

  await client.query("BEGIN")
  try {
    await client.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Owner','runtime-finding-e2e@example.test')`, [userId])
    await client.query(`INSERT INTO project (id,"userId",key,name,lifecycle)
      VALUES (7,$1,'runtime-finding-e2e','Runtime finding E2E','active')`, [userId])
    await client.query(`INSERT INTO project_resource
      ("userId","projectId",type,relationship,"canonicalIdentity",label)
      VALUES ($1,7,'repo','primary-repo','bsvalues/terragroq','WilliamOS')`, [userId])
    await client.query(`INSERT INTO workbench_thread (id,"userId","projectId",title)
      VALUES ('thread-911-e2e',$1,7,'#911 runtime reliability')`, [userId])
    await client.query(`INSERT INTO workbench_thread_source ("userId","threadId","sourceType","sourceId",role)
      VALUES ($1,'thread-911-e2e','outcome',$2,'root')`, [userId, outcomeKey])
    await client.query(`INSERT INTO goal
      (id,"userId",ref,command,lane,mode,risk,authority,verdict,"matchedRules","requiresApproval",status)
      VALUES (4,$1,'GOAL-911-E2E',$2,'operator-objective','implementation','R1','A2_WRITE_OWN','allow',
        ARRAY['issue-911-runtime-reliability-evidence.v1'],false,'converted')`, [userId, intent])
    await client.query(`INSERT INTO decision
      (id,"userId",ref,title,decision,status,authority,owner,scope,evidence,tags,locked)
      VALUES (74,$1,'WB-EXEC-DECISION-911-E2E','Start #911 work','APPROVE','accepted','binding',$1,$2,$3,
        ARRAY['workbench','outcome','explicit-start-work'],true)`, [userId, outcomeKey, approvalEvidence])
    await client.query(`INSERT INTO authority_grant
      (id,"userId",ref,"workOrderId","grantedBy","grantedTo","authorityLevel",scope,"allowedActions","blockedActions",status,"expiresAt") VALUES
      (80,$1,'WB-EXEC-GRANT-911-E2E',NULL,$1,'operator','A2_WRITE_OWN',$2,ARRAY['outcome:execute'],ARRAY['host-storage-mutation'],'active','2099-01-01'),
      (81,$1,'WB-EXEC-IMPL-GRANT-911-E2E',4,$1,'operator','A2_WRITE_OWN','WO-HERMES-OUTCOME-4',ARRAY['implement'],ARRAY['host-storage-mutation'],'active','2099-01-01')`, [userId, outcomeKey])
    await client.query(`INSERT INTO work_order
      (id,"userId",ref,title,goal,scope,"allowedFiles",validators,lane,status,priority,assignee,
       "authorityLevel","authorityGranted","authorityGrantId","acceptanceCriteria",agent,"approvedBy",
       "linkedDecisionId","commitAllowed","tagAllowed","pushAllowed") VALUES
      (4,$1,'WO-HERMES-OUTCOME-4',$2,'GOAL-911-E2E','#911',ARRAY[$3],
       ARRAY['git diff --check','npx vitest run tests/hermes-work-contract.test.ts'],'operator-objective','active','high',
       'hermes-codex-bridge','A2_WRITE_OWN','A2_WRITE_OWN',81,ARRAY['structured findings'],'codex',$1,74,true,false,true)`,
    [userId, intent, reportPath])
    await client.query(`INSERT INTO outcome_queue_item
      (id,"userId","outcomeKey","goalId","goalRef",title,objective,"queueOrder","dependencyKeys",
       "riskClass","approvalState","approvedBy","approvedAt","approvalDecisionId","authorityState",
       "authorityLevel","authorityGrantRef","authoritySubject","authorityAction","lifecycleState",
       "activeWorkOrderId","executionBinding","leaseHolder","leaseToken","leaseExpiresAt","fencingToken",version,"acquisitionKey") VALUES
      (5,$1,$2,4,'GOAL-911-E2E',$3,$3,10,ARRAY[]::text[],'R1','approved',$1,$4,74,'matched','A2_WRITE_OWN',
       'WB-EXEC-GRANT-911-E2E','operator','outcome:execute','active',4,$5,'resident-hermes',$6,'2099-01-01',2,1,$7)`,
    [userId, outcomeKey, intent, now.toISOString(), executionBinding, leaseToken, acquisitionKey])
    await client.query(`INSERT INTO outcome_queue_mutation_receipt
      ("userId","idempotencyKey",operation,"outcomeKey","requestHash","requestBinding","resultBinding")
      VALUES ($1,'workbench-execution:911-e2e','workbench_execution.authorize',$2,$3,$4::jsonb,$5::jsonb)`,
    [userId, outcomeKey, canonicalDigest({ contract: "workbench-execution-authorization.v1", ...requestBinding }),
      JSON.stringify(requestBinding), JSON.stringify(resultBinding)])
    await client.query(`INSERT INTO outcome_queue_acquisition_receipt
      ("userId","acquisitionKey","outcomeKey","firstFencingToken","latestFencingToken")
      VALUES ($1,$2,$3,2,2)`, [userId, acquisitionKey, outcomeKey])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

const ordinaryEffects = {
  spendsMoney: false, irreversible: false, mutatesProductionData: false,
  releaseOrCutover: false, protectedResource: false,
  unresolvedLegalPrivacyOrSecurityRisk: false, touchesCredentials: false,
  changesReviewedPolicy: false, outsideObjectiveScope: false, competesWithPriority: false,
  destroys: [],
}

runDatabase("Hermes runtime finding producer-to-consumer regression", { timeout: 60_000 }, () => {
  let pool: import("pg").Pool
  let client: import("pg").PoolClient
  let schema = ""
  let scopedUrl = ""

  beforeAll(async () => {
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    client = await pool.connect()
    schema = `hermes_finding_e2e_${randomUUID().replaceAll("-", "")}`
    await bootstrap(client, schema)
    scopedUrl = scopedDatabaseUrl(databaseUrl!, schema)
    await seedAuthorizedParent(client)
  })

  afterAll(async () => {
    if (client && schema) {
      await client.query("SET search_path TO public")
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    }
    client?.release()
    await pool?.end()
  })

  it("persists a completed turn's ordinary and gated siblings before independently settling both", async () => {
    const checkpoint = await projectOutcomeRuntimeCheckpoint({
      databaseUrl: scopedUrl, outcomeId: 4, attempt: 1, workContract: runtimeWorkContract,
      executionBinding: {
        userId, outcomeKey, expectedVersion: 1, executionBinding,
        leaseToken, leaseHolder: "resident-hermes", fencingToken: 2,
      },
      checkpoint: {
        sequence: 7, state: "CODEX_TURN_COMPLETED", detail: "structured #911 findings",
        findings: [
          {
            findingId: "FINDING-911-ORDINARY", sequence: 1,
            summary: "Record bounded runtime evidence", task: "Record bounded runtime evidence",
            paths: [reportPath], effects: ordinaryEffects,
          },
          {
            findingId: "FINDING-911-POLICY-GATE", sequence: 2,
            summary: "Change reviewed runtime policy", task: "Change reviewed runtime policy",
            paths: [reportPath], effects: { ...ordinaryEffects, changesReviewedPolicy: true },
          },
        ],
      },
    })
    expect(checkpoint).toMatchObject({ workOrderId: 4, workOrderRef: "WO-HERMES-OUTCOME-4" })

    const recorded = (await client.query(`SELECT id,metadata FROM governance_event
      WHERE "eventType"='RUNTIME_OBJECTIVE_FINDING_RECORDED' ORDER BY (metadata->>'sequence')::integer`)).rows
    expect(recorded).toHaveLength(2)
    expect(recorded.map((row) => row.metadata.findingId)).toEqual([
      "FINDING-911-ORDINARY", "FINDING-911-POLICY-GATE",
    ])
    expect(recorded.every((row) => Number(row.metadata.sourceCheckpointId) > 0)).toBe(true)
    expect(recorded.every((row) => /^[0-9a-f]{64}$/.test(row.metadata.payloadDigest))).toBe(true)
    expect(new Set(recorded.map((row) => row.metadata.sourceCheckpointDigest)).size).toBe(1)
    const consumer = createRuntimeFindingDbConsumer({
      withPool: async (action) => {
        const { Pool } = await import("pg")
        const consumerPool = new Pool({ connectionString: scopedUrl })
        try { return await action(consumerPool) } finally { await consumerPool.end() }
      },
      now: () => now,
    })
    const consumed = await consumer()
    expect(consumed).toMatchObject({
      status: "RUNTIME_FINDINGS_CONSUMED", considered: 2, derived: 1, gated: 1, queuedChildren: 1,
    })

    const settlements = (await client.query(`SELECT "eventType",metadata FROM governance_event
      WHERE "eventType" IN ('RUNTIME_FINDING_DERIVED','RUNTIME_FINDING_OWNER_GATED')
      ORDER BY metadata->>'sourceFindingEventId'`)).rows
    expect(settlements).toHaveLength(2)
    const ordinary = settlements.find((row) => row.eventType === "RUNTIME_FINDING_DERIVED")
    const gated = settlements.find((row) => row.eventType === "RUNTIME_FINDING_OWNER_GATED")
    expect(ordinary?.metadata).toMatchObject({
      sourceFindingEventId: recorded[0].id,
      sourceCheckpointDigest: recorded[0].metadata.sourceCheckpointDigest,
      findingId: "FINDING-911-ORDINARY",
    })
    expect(gated?.metadata).toMatchObject({
      sourceFindingEventId: recorded[1].id,
      sourceCheckpointDigest: recorded[1].metadata.sourceCheckpointDigest,
      findingId: "FINDING-911-POLICY-GATE", gate: "POLICY",
    })

    const childRows = (await client.query(`SELECT wo.ref,q."outcomeKey",q."lifecycleState"
      FROM work_order wo JOIN outcome_queue_item q ON q."activeWorkOrderId"=wo.id
      WHERE wo.id <> 4 ORDER BY wo.id`)).rows
    expect(childRows).toHaveLength(1)
    expect(childRows[0]).toMatchObject({ lifecycleState: "approved" })
    expect(childRows[0].ref).toContain(`-F${recorded[0].id}`)
    expect(childRows[0].outcomeKey).toBe(`runtime-finding:${recorded[0].id}:${recorded[0].metadata.payloadDigest}`)
    expect((await client.query(`SELECT "requestBinding"->>'sourcePayloadDigest' AS digest
      FROM outcome_queue_mutation_receipt WHERE operation='runtime_finding.derive'`)).rows)
      .toEqual([{ digest: recorded[0].metadata.payloadDigest }])
    expect((await client.query(`SELECT count(*)::integer AS count FROM work_order wo
      WHERE wo.ref LIKE $1`, [`%-F${recorded[1].id}`])).rows).toEqual([{ count: 0 }])
  })
})
