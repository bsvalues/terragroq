import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  acquireNextEligibleOutcome,
  completeOutcomeQueueItem,
  OUTCOME_QUEUE_SQL,
} from "../scripts/hermes-bridge/outcome-queue-source.mjs"
import {
  completeOutcome,
  projectOutcomeRuntimeCheckpoint,
} from "../scripts/hermes-bridge/outcome-source.mjs"
import { readPendingRuntimeFindingDecisionRequest } from "../scripts/hermes-bridge/runtime-finding-decision.mjs"
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
const acceptanceContractId = "issue-911-live-nonempty-acceptance.v1"
const intakeKey = `workbench-outcome:${acceptanceContractId}:11111111-1111-4111-8111-111111111111`

const canonicalJson = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  : JSON.stringify(value)

const canonicalDigest = (value: unknown) => createHash("sha256")
  .update(canonicalJson(value)).digest("hex")

const runtimeCheckpointPayloadKeys = [
  "idempotencyKey", "outcomeId", "workOrderRef", "attempt", "checkpointSequence",
  "checkpointState", "checkpointDetail", "prNumber", "commit", "priorHeadRefOid", "headRefOid",
  "mergeSha", "terminalCleanupRecoveryProofDigest", "executionBinding", "acquisitionKey",
  "acquisitionFencingToken", "executionEpochDigest", "findingsSetDigest",
  "workContractId", "workContractDigest", "workContractVersion", "workContractRepository",
  "workContractLane", "authorizationDecisionId", "executionGrantRef", "implementationGrantId",
  "implementationGrantRef", "projectionIssueNumber", "projectionCompletionOwned",
  "deliveryAuthorityLevel", "deliveryAllowedActions", "commitAllowed", "tagAllowed", "pushAllowed",
]

function checkpointPayload(metadata: Record<string, unknown>) {
  return Object.fromEntries(runtimeCheckpointPayloadKeys
    .filter((key) => Object.hasOwn(metadata, key)).map((key) => [key, metadata[key]]))
}

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
    "governance_event", "goal_outcome_intake_receipt", "outcome_queue_item", "project", "project_resource", "user",
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
  acceptedContractIds: [acceptanceContractId],
})!
const runtimeWorkContract = {
  version: workContract.version, id: workContract.id, digest: workContract.digest,
  repository: workContract.repository, lane: workContract.lane,
  allowedFiles: [...workContract.reservations],
  validators: workContract.validationCommands.map((validator) => (
    `${validator.command} ${validator.args.join(" ")}`
  )),
  projection: workContract.projection, delivery: workContract.delivery,
  acceptance: workContract.acceptance,
}

async function seedAuthorizedParent(client: import("pg").PoolClient) {
  const requestBinding = {
    projectId: 1, threadId: "thread-911-e2e", outcomeKey,
    idempotencyKey: "workbench-execution:911-e2e", confirmation: "START_WORK",
  }
  const intakeRequestHash = canonicalDigest({
    contractVersion: 1, projectId: 1, intent, idempotencyKey: intakeKey,
  })
  const intakeResultDigest = canonicalDigest({
    contractVersion: 1, requestHash: intakeRequestHash, goalId: 4, outcomeKey,
    threadId: "thread-911-e2e", root: { sourceType: "outcome", sourceId: outcomeKey },
    acceptedContractIds: [acceptanceContractId],
  })
  const acceptanceCriteria = [JSON.stringify({
    contractId: workContract.id, contractDigest: workContract.digest,
    ...workContract.acceptance,
  })]

  await client.query("BEGIN")
  try {
    await client.query(`INSERT INTO "user" (id,name,email) VALUES ($1,'Owner','runtime-finding-e2e@example.test')`, [userId])
    await client.query(`INSERT INTO project (id,"userId",key,name,lifecycle)
      VALUES (1,$1,'runtime-finding-e2e','Runtime finding E2E','active')`, [userId])
    await client.query(`INSERT INTO project_resource
      ("userId","projectId",type,relationship,"canonicalIdentity",label)
      VALUES ($1,1,'repo','primary-repo','bsvalues/terragroq','WilliamOS')`, [userId])
    await client.query(`INSERT INTO workbench_thread (id,"userId","projectId",title)
      VALUES ('thread-911-e2e',$1,1,'#911 runtime reliability')`, [userId])
    await client.query(`INSERT INTO workbench_thread_source ("userId","threadId","sourceType","sourceId",role)
      VALUES ($1,'thread-911-e2e','outcome',$2,'root')`, [userId, outcomeKey])
    await client.query(`INSERT INTO goal
      (id,"userId",ref,command,lane,mode,risk,authority,verdict,"matchedRules","acceptedContractIds","requiresApproval",status,"linkedWorkOrderId")
      VALUES (4,$1,'GOAL-911-E2E',$2,'operator-objective','implementation','R1','A2_WRITE_OWN','allow',
        ARRAY[$3],ARRAY[$3],false,'classified',4)`, [userId, intent, acceptanceContractId])
    const intakeReceipt = (await client.query(`INSERT INTO goal_outcome_intake_receipt
      ("userId","idempotencyKey","requestHash","goalId","outcomeKey","acceptedContractIds","resultDigest")
      VALUES ($1,$2,$3,4,$4,ARRAY[$5],$6) RETURNING id`,
    [userId, intakeKey, intakeRequestHash, outcomeKey, acceptanceContractId, intakeResultDigest])).rows[0]
    const acceptanceIntakeProof = {
      receiptId: Number(intakeReceipt.id), requestHash: intakeRequestHash,
      resultDigest: intakeResultDigest, idempotencyKeyDigest: canonicalDigest({ idempotencyKey: intakeKey }),
    }
    const resultBinding = {
      decisionId: 74, decisionRef: "WB-EXEC-DECISION-911-E2E",
      grantId: 80, grantRef: "WB-EXEC-GRANT-911-E2E",
      implementationGrantId: 81, implementationGrantRef: "WB-EXEC-IMPL-GRANT-911-E2E",
      queueVersion: 1, authorizedAt: now.toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z", workContract,
      acceptedContractIds: [acceptanceContractId], acceptanceIntakeProof,
    }
    const approvalEvidence = [
      "project:1", "thread:thread-911-e2e", `repo:${workContract.repository}`,
      `work-contract:${workContract.id}`, `work-contract-digest:${workContract.digest}`,
      `work-contract-json:${JSON.stringify(workContract)}`,
      `acceptance-intake-receipt:${acceptanceIntakeProof.receiptId}`,
      `acceptance-intake-request:${acceptanceIntakeProof.requestHash}`,
      `acceptance-intake-result:${acceptanceIntakeProof.resultDigest}`,
      `acceptance-intake-key-digest:${acceptanceIntakeProof.idempotencyKeyDigest}`,
      ...workContract.reservations.map((reservation) => `reservation:${reservation}`),
      ...workContract.validationCommands.map((validator) => (
        `validator:${validator.command}:${validator.args.join(" ")}`
      )),
    ]
    await client.query(`INSERT INTO decision
      (id,"userId",ref,title,decision,status,authority,owner,scope,evidence,tags,locked)
      VALUES (74,$1,'WB-EXEC-DECISION-911-E2E','Start #911 work','APPROVE','accepted','binding',$1,$2,$3,
        ARRAY['workbench','outcome','explicit-start-work'],true)`, [userId, outcomeKey, approvalEvidence])
    await client.query(`INSERT INTO authority_grant
      (id,"userId",ref,"workOrderId","grantedBy","grantedTo","authorityLevel",scope,"allowedActions","blockedActions",status,"expiresAt") VALUES
      (80,$1,'WB-EXEC-GRANT-911-E2E',NULL,$1,'operator','A2_WRITE_OWN',$2,ARRAY['outcome:execute'],
        ARRAY['production:mutate','release:create','secret:access','spend:increase'],'active','2099-01-01'),
      (81,$1,'WB-EXEC-IMPL-GRANT-911-E2E',NULL,$1,'operator','A2_WRITE_OWN','WO-HERMES-OUTCOME-4',ARRAY['implement'],
        ARRAY['production:mutate','release:create','secret:access','spend:increase'],'active','2099-01-01')`, [userId, outcomeKey])
    await client.query(`INSERT INTO work_order
      (id,"userId",ref,title,goal,scope,"allowedFiles",validators,lane,status,priority,assignee,
       "authorityLevel","authorityGranted","authorityGrantId","acceptanceCriteria",agent,"approvedBy",
       "linkedDecisionId","commitAllowed","tagAllowed","pushAllowed") VALUES
      (4,$1,'WO-HERMES-OUTCOME-4',$2,'GOAL-911-E2E','#911',ARRAY[$3],
       ARRAY['git diff --check','npx vitest run tests/hermes-work-contract.test.ts'],'operator-objective','active','high',
        'hermes-codex-bridge','A2_WRITE_OWN','A2_WRITE_OWN',81,$4::text[],'codex',$1,74,true,false,true)`,
    [userId, intent, reportPath, acceptanceCriteria])
    await client.query(`INSERT INTO outcome_queue_item
      (id,"userId","outcomeKey","goalId","goalRef",title,objective,"queueOrder","dependencyKeys",
       "riskClass","approvalState","approvedBy","approvedAt","approvalDecisionId","authorityState",
       "authorityLevel","authorityGrantRef","authoritySubject","authorityAction","lifecycleState",
       "activeWorkOrderId","executionBinding","leaseHolder","leaseToken","leaseExpiresAt","fencingToken",version,"acquisitionKey","acceptedContractIds") VALUES
      (5,$1,$2,4,'GOAL-911-E2E',$3,$3,10,ARRAY[]::text[],'R1','approved',$1,$4,74,'matched','A2_WRITE_OWN',
       'WB-EXEC-GRANT-911-E2E','operator','outcome:execute','approved',4,NULL,NULL,NULL,NULL,0,1,NULL,ARRAY[$5])`,
    [userId, outcomeKey, intent, now.toISOString(), acceptanceContractId])
    await client.query(`INSERT INTO outcome_queue_mutation_receipt
      ("userId","idempotencyKey",operation,"outcomeKey","requestHash","requestBinding","resultBinding","createdAt")
      VALUES ($1,'workbench-execution:911-e2e','workbench_execution.authorize',$2,$3,$4::jsonb,$5::jsonb,$6)`,
    [userId, outcomeKey, canonicalDigest({ contract: "workbench-execution-authorization.v1", ...requestBinding }),
      JSON.stringify(requestBinding), JSON.stringify(resultBinding), now])
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
      try { await client.query("ROLLBACK") } catch {}
      await client.query("SET search_path TO public")
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    }
    client?.release()
    await pool?.end()
  })

  it("keeps a completed parent's gated finding actionable only after its ordinary sibling durably completes", async () => {
    const parentAcquisitionNow = new Date()
    await client.query(`UPDATE outcome_queue_item SET "acceptedContractIds"=ARRAY[]::text[] WHERE id=5`)
    const markerDrift = await acquireNextEligibleOutcome({
      databaseUrl: scopedUrl, userId, acquisitionKey: "acquisition-key-marker-drift",
      leaseHolder: "resident-hermes", leaseToken: "lease-token-marker-drift",
      executionBinding: "execution-binding-marker-drift", leaseDurationMs: 60_000,
      activeWorkOrderId: 4, campaignWindowId: "campaign-marker-drift",
      processIdentity: "process-marker-drift", now: parentAcquisitionNow,
      checkpointProofProvider: async () => { throw new Error("MARKER_DRIFT_MUST_NOT_SELECT") },
    })
    expect(markerDrift).toMatchObject({ acquired: false })
    await client.query(`UPDATE outcome_queue_item SET "acceptedContractIds"=ARRAY[$1] WHERE id=5`,
      [acceptanceContractId])
    const acquiredParent = await acquireNextEligibleOutcome({
      databaseUrl: scopedUrl, userId, acquisitionKey,
      leaseHolder: "resident-hermes", leaseToken, executionBinding,
      leaseDurationMs: 60_000, activeWorkOrderId: 4,
      campaignWindowId: "campaign-911-parent", processIdentity: "process-911-parent",
      now: parentAcquisitionNow,
      checkpointProofProvider: async ({ outcome }) => ({
        outcomeId: String(outcome.goalId), outcomeKey: outcome.outcomeKey,
        workOrderId: outcome.activeWorkOrderId, fencingToken: outcome.fencingToken,
        sequence: 0, state: "LEASED",
        commit: { headSha: null, mergeSha: null, prNumber: null },
      }),
    })
    expect(acquiredParent).toMatchObject({ acquired: true, replayed: false })
    expect(acquiredParent.outcome).toMatchObject({
      outcomeKey, acceptedContractIds: [acceptanceContractId],
      executionBinding, acquisitionKey, activeWorkOrderId: 4,
    })
    const parentVersion = Number(acquiredParent.outcome.version)
    const parentFence = Number(acquiredParent.outcome.fencingToken)
    await client.query(`UPDATE goal_outcome_intake_receipt SET "requestHash"=$1 WHERE "goalId"=4`,
      ["0".repeat(64)])
    await expect(projectOutcomeRuntimeCheckpoint({
      databaseUrl: scopedUrl, outcomeId: 4, attempt: 1, workContract: runtimeWorkContract,
      executionBinding: {
        userId, outcomeKey, expectedVersion: parentVersion, executionBinding,
        leaseToken, leaseHolder: "resident-hermes", fencingToken: parentFence, acquisitionKey,
      },
      checkpoint: { sequence: 6, state: "CODEX_TURN_COMPLETED", detail: "empty truthful audit", findings: [] },
    })).rejects.toMatchObject({ code: "OUTCOME_WORK_ORDER_AUTHORIZATION_WALL" })
    await client.query(`UPDATE goal_outcome_intake_receipt SET "requestHash"=$1 WHERE "goalId"=4`,
      [canonicalDigest({ contractVersion: 1, projectId: 1, intent, idempotencyKey: intakeKey })])

    const emptyCheckpoint = await projectOutcomeRuntimeCheckpoint({
      databaseUrl: scopedUrl, outcomeId: 4, attempt: 1, workContract: runtimeWorkContract,
      executionBinding: {
        userId, outcomeKey, expectedVersion: parentVersion, executionBinding,
        leaseToken, leaseHolder: "resident-hermes", fencingToken: parentFence, acquisitionKey,
      },
      checkpoint: { sequence: 6, state: "CODEX_TURN_COMPLETED", detail: "empty truthful audit", findings: [] },
    })
    expect(emptyCheckpoint).toMatchObject({ workOrderId: 4 })
    expect((await client.query(`SELECT count(*)::integer AS count FROM governance_event
      WHERE "eventType"='RUNTIME_OBJECTIVE_FINDING_RECORDED'`)).rows).toEqual([{ count: 0 }])
    const exactAcceptanceCriteria = (await client.query(`SELECT "acceptanceCriteria" FROM work_order WHERE id=4`))
      .rows[0].acceptanceCriteria
    await client.query(`UPDATE work_order SET "acceptanceCriteria"=ARRAY[]::text[] WHERE id=4`)
    await expect(projectOutcomeRuntimeCheckpoint({
      databaseUrl: scopedUrl, outcomeId: 4, attempt: 1, workContract: runtimeWorkContract,
      executionBinding: {
        userId, outcomeKey, expectedVersion: parentVersion, executionBinding,
        leaseToken, leaseHolder: "resident-hermes", fencingToken: parentFence, acquisitionKey,
      },
      checkpoint: { sequence: 7, state: "CODEX_TURN_COMPLETED", detail: "drift must wall", findings: [] },
    })).rejects.toMatchObject({ code: "OUTCOME_WORK_ORDER_CONTRACT_WALL" })
    await client.query(`UPDATE work_order SET "acceptanceCriteria"=$1::text[] WHERE id=4`,
      [exactAcceptanceCriteria])
    const checkpoint = await projectOutcomeRuntimeCheckpoint({
      query: async (sql: string, values?: unknown[]) => {
        const result = await client.query(sql, values)
        if (sql.includes("FROM goal AS contract_goal") && result.rows.length !== 1) {
          throw new Error(`TEST_AUTHORIZATION_ROWS:${result.rows.length}`)
        }
        return result
      }, outcomeId: 4, attempt: 1, workContract: runtimeWorkContract,
      executionBinding: {
        userId, outcomeKey, expectedVersion: parentVersion, executionBinding,
        leaseToken, leaseHolder: "resident-hermes", fencingToken: parentFence,
        acquisitionKey,
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

    const parentMergeSha = "9".repeat(40)
    const parentEvidenceRef = "EV-HERMES-4-1-8"
    await projectOutcomeRuntimeCheckpoint({
      databaseUrl: scopedUrl, outcomeId: 4, attempt: 1, workContract: runtimeWorkContract,
      executionBinding: {
        userId, outcomeKey, expectedVersion: parentVersion, executionBinding,
        leaseToken, leaseHolder: "resident-hermes", fencingToken: parentFence,
        acquisitionKey,
      },
      checkpoint: {
        sequence: 8, state: "COMPLETE", detail: "PR #929 merged and verified",
        metadata: {
          prNumber: 929, branch: "codex/runtime-finding-parent", mergeSha: parentMergeSha,
          headRefOid: "8".repeat(40), runtimeEvidenceRef: parentEvidenceRef,
        },
      },
    })
    const parentQueueBeforeComplete = (await client.query(`SELECT * FROM outcome_queue_item WHERE id=5`)).rows[0]
    if (Number(parentQueueBeforeComplete.version) !== parentVersion
      || Number(parentQueueBeforeComplete.fencingToken) !== parentFence) {
      throw new Error(`TEST_PARENT_QUEUE_DRIFT:${JSON.stringify(parentQueueBeforeComplete)}`)
    }
    await completeOutcomeQueueItem({
      databaseUrl: scopedUrl, userId, outcomeKey, expectedVersion: parentVersion, executionBinding,
      leaseToken, fencingToken: parentFence, acquisitionKey,
      terminalKey: `hermes:${outcomeKey}:${parentFence}:${parentMergeSha}`,
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: [parentEvidenceRef, "pr:929", `merge:${parentMergeSha}`], now,
    })
    await completeOutcome({
      databaseUrl: scopedUrl, outcomeId: 4,
      evidence: {
        prNumber: 929, mergeSha: parentMergeSha, branch: "codex/runtime-finding-parent",
        runtimeEvidenceRef: parentEvidenceRef, ownerTouchCount: 0, blockedScopeCrossed: false,
      },
    })

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

    await expect(readPendingRuntimeFindingDecisionRequest({
      databaseUrl: scopedUrl, ownerEmail: "runtime-finding-e2e@example.test",
    })).resolves.toBeNull()

    const child = (await client.query(`SELECT wo.id AS "workOrderId", g.id AS "goalId",
        q."outcomeKey", receipt."resultBinding"->'workContract' AS "workContract"
      FROM work_order wo
      JOIN goal g ON g."linkedWorkOrderId"=wo.id
      JOIN outcome_queue_item q ON q."activeWorkOrderId"=wo.id
      JOIN outcome_queue_mutation_receipt receipt ON receipt."outcomeKey"=q."outcomeKey"
        AND receipt.operation='runtime_finding.derive'
      WHERE wo.id <> 4`)).rows[0]
    const childExecutionBinding = "execution-binding-911-child"
    const childLeaseToken = "lease-token-911-child"
    const childAcquisitionKey = "acquisition-key-911-child"
    const childNow = new Date()
    const acquiredChild = await acquireNextEligibleOutcome({
      databaseUrl: scopedUrl, userId, acquisitionKey: childAcquisitionKey,
      leaseHolder: "resident-hermes", leaseToken: childLeaseToken,
      executionBinding: childExecutionBinding, leaseDurationMs: 60_000,
      activeWorkOrderId: Number(child.workOrderId), campaignWindowId: "campaign-911-child",
      processIdentity: "process-911-child", now: childNow,
      checkpointProofProvider: async ({ outcome }) => ({
        outcomeId: String(outcome.goalId), outcomeKey: outcome.outcomeKey,
        workOrderId: outcome.activeWorkOrderId, fencingToken: outcome.fencingToken,
        sequence: 0, state: "LEASED",
        commit: { headSha: null, mergeSha: null, prNumber: null },
      }),
    })
    expect(acquiredChild).toMatchObject({ acquired: true, replayed: false })
    const childQueue = acquiredChild.outcome
    const childRuntimeContract = {
      version: child.workContract.version, id: child.workContract.id, digest: child.workContract.digest,
      repository: child.workContract.repository, lane: child.workContract.lane,
      allowedFiles: child.workContract.reservations,
      validators: child.workContract.validationCommands.map((validator: { command: string; args: string[] }) => (
        `${validator.command} ${validator.args.join(" ")}`
      )),
      projection: child.workContract.projection, delivery: child.workContract.delivery,
    }
    const childMergeSha = "7".repeat(40)
    const childEvidenceRef = `EV-HERMES-${child.goalId}-1-1`
    await projectOutcomeRuntimeCheckpoint({
      databaseUrl: scopedUrl, outcomeId: Number(child.goalId), attempt: 1,
      workContract: childRuntimeContract,
      executionBinding: {
        userId, outcomeKey: child.outcomeKey, expectedVersion: Number(childQueue.version),
        executionBinding: childExecutionBinding, leaseToken: childLeaseToken,
        leaseHolder: "resident-hermes", fencingToken: Number(childQueue.fencingToken),
        acquisitionKey: childAcquisitionKey,
      },
      checkpoint: {
        sequence: 1, state: "COMPLETE", detail: "PR #930 merged and verified",
        metadata: {
          prNumber: 930, branch: "codex/runtime-finding-child", mergeSha: childMergeSha,
          headRefOid: "6".repeat(40), runtimeEvidenceRef: childEvidenceRef,
        },
      },
    })
    await completeOutcomeQueueItem({
      databaseUrl: scopedUrl, userId, outcomeKey: child.outcomeKey,
      expectedVersion: Number(childQueue.version), executionBinding: childExecutionBinding,
      leaseToken: childLeaseToken, fencingToken: Number(childQueue.fencingToken),
      acquisitionKey: childAcquisitionKey,
      terminalKey: `hermes:${child.outcomeKey}:${childQueue.fencingToken}:${childMergeSha}`,
      terminalResult: "COMPLETE",
      terminalEvidenceRefs: [childEvidenceRef, "pr:930", `merge:${childMergeSha}`], now: childNow,
    })
    await completeOutcome({
      databaseUrl: scopedUrl, outcomeId: Number(child.goalId),
      evidence: {
        prNumber: 930, mergeSha: childMergeSha, branch: "codex/runtime-finding-child",
        runtimeEvidenceRef: childEvidenceRef, ownerTouchCount: 0, blockedScopeCrossed: false,
      },
    })

    const actionable = await readPendingRuntimeFindingDecisionRequest({
      databaseUrl: scopedUrl, ownerEmail: "runtime-finding-e2e@example.test",
    })
    expect(actionable).toMatchObject({
      sourceKind: "RUNTIME_FINDING",
      findingId: "FINDING-911-POLICY-GATE",
      parentWorkOrderRowId: 4,
      gateSettlementEventId: expect.any(Number),
    })

    const terminalEvents = (await client.query(`SELECT id,"eventType","entityType","entityId"
      FROM governance_event WHERE "eventType" IN ('HERMES_RUNTIME_CHECKPOINT','HERMES_OUTCOME_COMPLETED',
        'RUNTIME_FINDING_OWNER_GATED') ORDER BY id`)).rows
    const parentComplete = terminalEvents.filter((event) => event.eventType === "HERMES_RUNTIME_CHECKPOINT"
      && event.entityType === "work_order" && event.entityId === "4").at(-1)
    const parentCompletion = terminalEvents.filter((event) => event.eventType === "HERMES_OUTCOME_COMPLETED"
      && event.entityType === "goal" && event.entityId === "4")
    const gateEvent = terminalEvents.find((event) => event.eventType === "RUNTIME_FINDING_OWNER_GATED")
    const childComplete = terminalEvents.find((event) => event.eventType === "HERMES_RUNTIME_CHECKPOINT"
      && event.entityType === "work_order" && event.entityId === String(child.workOrderId))
    const childCompletion = terminalEvents.filter((event) => event.eventType === "HERMES_OUTCOME_COMPLETED"
      && event.entityType === "goal" && event.entityId === String(child.goalId))
    expect(parentCompletion).toHaveLength(1)
    expect(childCompletion).toHaveLength(1)
    expect(Number(parentComplete.id)).toBeLessThan(Number(parentCompletion[0].id))
    expect(Number(parentCompletion[0].id)).toBeLessThan(Number(gateEvent.id))
    expect(Number(gateEvent.id)).toBeLessThan(Number(childComplete.id))
    expect(Number(childComplete.id)).toBeLessThan(Number(childCompletion[0].id))

    const readInTransaction = () => readPendingRuntimeFindingDecisionRequest({
      query: client.query.bind(client), ownerEmail: "runtime-finding-e2e@example.test",
    })
    await client.query("BEGIN")
    await client.query(`UPDATE authority_grant SET "revokedAt"=NOW() WHERE id=81`)
    await expect(readInTransaction()).resolves.toBeNull()
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`UPDATE outcome_queue_item SET "terminalEvidenceRefs"=ARRAY[]::text[] WHERE "goalId"=4`)
    await expect(readInTransaction()).resolves.toBeNull()
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`INSERT INTO outcome_queue_mutation_receipt
      ("userId","idempotencyKey",operation,"outcomeKey","requestHash","requestBinding","resultBinding","createdAt")
      SELECT "userId",'runtime-finding.derive:gated-adversarial',operation,'runtime-finding:gated-adversarial',
        "requestHash",jsonb_set("requestBinding",'{sourceFindingEventId}',to_jsonb($1::text)),"resultBinding","createdAt"
      FROM outcome_queue_mutation_receipt WHERE operation='runtime_finding.derive'`,
    [String(recorded[1].id)])
    await expect(readInTransaction()).resolves.toBeNull()
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`UPDATE governance_event SET metadata=metadata-'workOrderId'
      WHERE "eventType"='RUNTIME_FINDING_DERIVED'`)
    await expect(readInTransaction()).rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`INSERT INTO governance_event
      ("userId","eventType","entityType","entityId",actor,reason,metadata)
      SELECT "userId","eventType","entityType","entityId",actor,reason,
        jsonb_set(metadata,'{idempotencyKey}',to_jsonb('duplicate-complete'::text))
      FROM governance_event WHERE id=$1`, [Number(parentComplete.id)])
    await expect(readInTransaction()).resolves.toBeNull()
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`INSERT INTO evidence_record
      ("userId",ref,"workOrderId",result,repo,head,notes,"contentHash")
      SELECT "userId",ref,"workOrderId",result,repo,head,notes,"contentHash"
      FROM evidence_record WHERE "workOrderId"=4`)
    await expect(readInTransaction()).resolves.toBeNull()
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`UPDATE outcome_queue_mutation_receipt SET "requestHash"=$1
      WHERE operation='runtime_finding.derive'`, ["0".repeat(64)])
    await expect(readInTransaction()).rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    const derivedRow = (await client.query(`SELECT id,metadata FROM governance_event
      WHERE "eventType"='RUNTIME_FINDING_DERIVED'`)).rows[0]
    const childCheckpointRow = (await client.query(`SELECT id,metadata FROM governance_event
      WHERE "eventType"='HERMES_RUNTIME_CHECKPOINT' AND "entityId"=$1`,
    [String(child.workOrderId)])).rows[0]
    const originalContract = derivedRow.metadata.childWorkContract
    const driftedContractBody = {
      version: originalContract.version,
      id: originalContract.id,
      repository: "bsvalues/another-repository",
      lane: originalContract.lane,
      reservations: originalContract.reservations,
      validationCommands: originalContract.validationCommands.map((command: any) => ({
        args: command.args,
        command: command.command,
        ...(command.env ? { env: Object.fromEntries(Object.keys(command.env).sort()
          .map((key) => [key, command.env[key]])) } : {}),
        timeoutMs: command.timeoutMs,
      })),
      ...(Object.hasOwn(originalContract, "projection") ? {
        projection: {
          issueNumber: originalContract.projection.issueNumber,
          completionOwned: originalContract.projection.completionOwned,
        },
      } : {}),
      delivery: {
        authorityLevel: originalContract.delivery.authorityLevel,
        allowedActions: originalContract.delivery.allowedActions,
        commitAllowed: originalContract.delivery.commitAllowed,
        tagAllowed: originalContract.delivery.tagAllowed,
        pushAllowed: originalContract.delivery.pushAllowed,
      },
    }
    const driftedContract = { ...driftedContractBody, digest: createHash("sha256")
      .update(JSON.stringify(driftedContractBody)).digest("hex") }
    const driftedCheckpoint = {
      ...childCheckpointRow.metadata,
      workContractDigest: driftedContract.digest,
      workContractRepository: driftedContract.repository,
    }
    driftedCheckpoint.payloadDigest = createHash("sha256")
      .update(JSON.stringify(checkpointPayload(driftedCheckpoint))).digest("hex")
    await client.query(`UPDATE governance_event SET metadata=jsonb_set(metadata,
      '{childWorkContract}',$1::jsonb) WHERE id=$2`, [JSON.stringify(driftedContract), derivedRow.id])
    await client.query(`UPDATE outcome_queue_mutation_receipt SET "resultBinding"=jsonb_set(
      "resultBinding",'{workContract}',$1::jsonb) WHERE operation='runtime_finding.derive'`,
    [JSON.stringify(driftedContract)])
    await client.query(`UPDATE governance_event SET metadata=$1::jsonb WHERE id=$2`,
    [JSON.stringify(driftedCheckpoint), childCheckpointRow.id])
    await client.query(`UPDATE evidence_record SET "contentHash"=$1 WHERE "workOrderId"=$2`,
    [driftedCheckpoint.payloadDigest, Number(child.workOrderId)])
    await expect(readInTransaction()).rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`INSERT INTO governance_event
      ("userId","eventType","entityType","entityId",actor,reason,metadata)
      SELECT "userId","eventType","entityType","entityId",actor,reason,metadata
      FROM governance_event WHERE "eventType"='HERMES_OUTCOME_COMPLETED' AND "entityId"=$1`,
    [String(child.goalId)])
    await expect(readInTransaction()).resolves.toBeNull()
    await client.query("ROLLBACK")

    await client.query("BEGIN")
    await client.query(`UPDATE governance_event SET metadata=jsonb_set(metadata,'{payloadDigest}',to_jsonb($1::text))
      WHERE id=$2`, ["d".repeat(64), Number(parentComplete.id)])
    await client.query(`UPDATE evidence_record SET "contentHash"=$1 WHERE "workOrderId"=4`, ["d".repeat(64)])
    await expect(readInTransaction()).rejects.toMatchObject({ code: "RUNTIME_FINDING_DECISION_SOURCE_WALL" })
    await client.query("ROLLBACK")
  })
})
