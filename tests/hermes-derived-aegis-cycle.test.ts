import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { AegisExecutionBackend } from "../scripts/hermes-bridge/execution-backend.mjs"
import { createHermesOrchestrator } from "../scripts/hermes-bridge/orchestrator.mjs"
import { createHermesOutcomeQueueRuntime } from "../scripts/hermes-bridge/outcome-queue-runtime.mjs"
import { OUTCOME_QUEUE_SQL } from "../scripts/hermes-bridge/outcome-queue-source.mjs"
import { projectOutcomeRuntimeCheckpoint, projectOutcomeRuntimeLease } from "../scripts/hermes-bridge/outcome-source.mjs"
import { createRepositoryLifecycle } from "../scripts/hermes-bridge/repository-lifecycle.mjs"
import { createHermesStateStore } from "../scripts/hermes-bridge/state-store.mjs"

const databaseUrl = process.env.HERMES_PROJECT_EXECUTION_TEST_DATABASE_URL
const runDatabase = databaseUrl ? describe : describe.skip
const roots: string[] = []
const reportPath = "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"
const now = new Date()
const baseSha = "f".repeat(40)
const headSha = "d".repeat(40)
const mergeSha = "e".repeat(40)
const childRef = "WO-HERMES-OUTCOME-4-R01-F101"
const goalRef = "GOAL-RUNTIME-FINDING-101"
const outcomeKey = `runtime-finding:101:${"a".repeat(64)}`

const canonicalJson = (value: any): string => value && typeof value === "object"
  ? Array.isArray(value) ? `[${value.map(canonicalJson).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  : JSON.stringify(value)

const contractBody = {
  version: "hermes-work-contract.v1", id: "runtime-finding.101.v1",
  repository: "bsvalues/terragroq", lane: "docs", reservations: [reportPath],
  validationCommands: [{ command: "git", args: ["diff", "--check"], timeoutMs: 300_000 }],
  projection: { issueNumber: 911, completionOwned: false },
  delivery: { authorityLevel: "A2_WRITE_OWN", allowedActions: ["implement"], commitAllowed: true, tagAllowed: false, pushAllowed: true },
}
const contract = { ...contractBody, digest: createHash("sha256").update(canonicalJson(contractBody)).digest("hex") }
const requestBinding = {
  operation: "runtime_finding.derive", sourceFindingEventId: 101,
  sourcePayloadDigest: "a".repeat(64), sourceCheckpointId: 91,
  sourceCheckpointDigest: "b".repeat(64), parentWorkOrderId: 4,
  parentWorkOrderRef: "WO-HERMES-OUTCOME-4", parentContractId: "parent.v1",
  parentContractDigest: "c".repeat(64), parentAuthorizationDecisionId: 74,
  parentImplementationGrantId: 81,
}
const resultBinding = {
  outcomeKey, goalId: 202, goalRef, queueId: 203, workOrderId: 201, workOrderRef: childRef,
  decisionId: 204, approvalDecisionId: 204, grantId: 207,
  grantRef: "RUNTIME-FINDING-QUEUE-GRANT-101", queueGrantId: 207,
  queueGrantRef: "RUNTIME-FINDING-QUEUE-GRANT-101", implementationGrantId: 205,
  implementationGrantRef: "RUNTIME-FINDING-IMPL-GRANT-101", workContract: contract,
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

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
    "governance_event", "outcome_queue_item", "project", "project_resource", "user", "work_order",
    "workbench_thread", "workbench_thread_source",
  ])
  const source = fs.readFileSync(path.join(process.cwd(), "drizzle", "0000_williamos_init.sql"), "utf8")
  for (const sql of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    const created = sql.match(/^CREATE TABLE "([^"]+)"/)?.[1]
    const altered = sql.match(/^ALTER TABLE "([^"]+)"/)?.[1]
    const indexed = sql.match(/^CREATE (?:UNIQUE )?INDEX "[^"]+" ON "([^"]+)"/)?.[1]
    const refs = [...sql.matchAll(/REFERENCES "public"\."([^"]+)"/g)].map((match) => match[1])
    if (!(created && tables.has(created)) && !(altered && tables.has(altered) && refs.every((ref) => tables.has(ref)))
      && !(indexed && tables.has(indexed))) continue
    await client.query(sql.replaceAll('"public".', `"${schema}".`))
  }
  for (const sql of [
    OUTCOME_QUEUE_SQL.ensureMutationReceiptTable,
    OUTCOME_QUEUE_SQL.ensureMutationReceiptOutcomeIndex,
    OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptTable,
    OUTCOME_QUEUE_SQL.ensureAcquisitionReceiptOutcomeIndex,
    OUTCOME_QUEUE_SQL.ensureGoalOutcomeIntakeReceiptTable,
    OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptTable,
    OUTCOME_QUEUE_SQL.ensureMutationAttemptTable,
    OUTCOME_QUEUE_SQL.ensureAcquisitionAttemptIndexes,
    OUTCOME_QUEUE_SQL.ensureMutationAttemptRequestIndex,
  ]) await client.query(sql)
}

async function seed(client: import("pg").PoolClient) {
  await client.query("BEGIN")
  try {
    await client.query(`INSERT INTO "user" (id,name,email) VALUES ('primary-user','Primary','bsvalues@gmail.com')`)
    await client.query(`INSERT INTO decision (id,"userId",ref,title,decision,status,authority,owner,scope,evidence,tags,locked) VALUES
      (74,'primary-user','DEC-PARENT','Parent','APPROVE','accepted','binding','primary-user','parent',ARRAY['parent'],ARRAY['workbench'],true),
      (204,'primary-user','DEC-CHILD','Child','APPROVE','accepted','binding','WilliamOS',$1,ARRAY['runtime-finding:101'],ARRAY['RUNTIME_FINDING_DERIVED_AUTHORIZATION'],true)`, [outcomeKey])
    await client.query(`INSERT INTO authority_grant
      (id,"userId",ref,"workOrderId","grantedBy","grantedTo","authorityLevel",scope,"allowedActions","blockedActions",status,"expiresAt") VALUES
      (81,'primary-user','PARENT-IMPL',4,'primary-user','operator','A2_WRITE_OWN','WO-HERMES-OUTCOME-4',ARRAY['implement'],ARRAY['host-storage-mutation'],'active','2099-01-01'),
      (205,'primary-user','RUNTIME-FINDING-IMPL-GRANT-101',201,'hermes','operator','A2_WRITE_OWN',$1,ARRAY['implement'],ARRAY['host-storage-mutation'],'active','2099-01-01'),
      (207,'primary-user','RUNTIME-FINDING-QUEUE-GRANT-101',201,'hermes','operator','A2_WRITE_OWN',$2,ARRAY['outcome:execute'],ARRAY['host-storage-mutation'],'active','2099-01-01')`, [childRef, outcomeKey])
    await client.query(`INSERT INTO work_order
      (id,"userId",ref,title,goal,scope,"allowedFiles",validators,lane,status,priority,assignee,"authorityLevel","authorityGranted","authorityGrantId","acceptanceCriteria",agent,"approvedBy","linkedDecisionId","commitAllowed","tagAllowed","pushAllowed") VALUES
      (4,'primary-user','WO-HERMES-OUTCOME-4','Parent','Parent','parent',ARRAY['docs/reports'],ARRAY['git diff --check'],'operator-objective','active','high','hermes-codex-bridge','A2_WRITE_OWN','parent',81,ARRAY['parent'],'hermes','primary-user',74,true,false,true),
      (201,'primary-user',$1,'Derived docs',$2,$2,ARRAY[$3],ARRAY['git diff --check'],'docs','approved','high','hermes-codex-bridge','A2_WRITE_OWN','A2_WRITE_OWN',205,ARRAY['docs-only'],'codex','williamos-runtime-policy',204,true,false,true)`, [childRef, goalRef, reportPath])
    await client.query(`INSERT INTO goal (id,"userId",ref,command,lane,mode,risk,authority,verdict,"matchedRules","requiresApproval","linkedWorkOrderId",status)
      VALUES (202,'primary-user',$1,'Reconcile compose drift','docs','implementation','R1','A2_WRITE_OWN','allow',ARRAY['runtime_finding.derive'],false,201,'classified')`, [goalRef])
    await client.query(`INSERT INTO governance_event (id,"userId",ref,"eventType","entityType","entityId",actor,reason,metadata) VALUES
      (101,'primary-user','FINDING-101','RUNTIME_OBJECTIVE_FINDING_RECORDED','work_order','4','hermes','finding',$1::jsonb),
      (102,'primary-user','DERIVED-101','RUNTIME_FINDING_DERIVED','work_order','201','williamos-runtime-operator','derived',$2::jsonb)`, [
      JSON.stringify({ payloadDigest: requestBinding.sourcePayloadDigest, sourceCheckpointId: 91,
        sourceCheckpointDigest: requestBinding.sourceCheckpointDigest, objectiveWorkOrderId: "WO-HERMES-OUTCOME-4",
        workContractId: "parent.v1", workContractDigest: requestBinding.parentContractDigest,
        authorizationDecisionId: 74, implementationGrantId: 81 }),
      JSON.stringify({ sourceFindingEventId: 101, outcomeKey, workOrderRef: childRef }),
    ])
    await client.query(`INSERT INTO outcome_queue_item
      (id,"userId","outcomeKey","goalId","goalRef",title,objective,"queueOrder","dependencyKeys","riskClass","approvalState","approvedBy","approvedAt","approvalDecisionId","authorityState","authorityLevel","authorityGrantRef","authoritySubject","authorityAction","lifecycleState","activeWorkOrderId",version,"fencingToken")
      VALUES (203,'primary-user',$1,202,$2,'Reconcile compose drift','Reconcile compose drift',100,ARRAY[]::text[],'R1','approved','hermes',$3,204,'matched','A2_WRITE_OWN','RUNTIME-FINDING-QUEUE-GRANT-101','operator','outcome:execute','approved',201,0,0)`, [outcomeKey, goalRef, now.toISOString()])
    await client.query(`INSERT INTO outcome_queue_mutation_receipt
      (id,"userId","idempotencyKey",operation,"outcomeKey","requestHash","requestBinding","resultBinding")
      VALUES (206,'primary-user','derive-101','runtime_finding.derive',$1,$2,$3::jsonb,$4::jsonb)`, [outcomeKey,
      createHash("sha256").update(canonicalJson(requestBinding)).digest("hex"), JSON.stringify(requestBinding), JSON.stringify(resultBinding)])
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  }
}

function deliveryHarness() {
  const state = { committed: false, created: false, requested: false, merged: false, cleaned: false }
  let validationTree = false
  const calls: any[] = []
  const validations: string[] = []
  const runner = vi.fn(async (call: any) => {
    calls.push(call)
    const remote = String(call.args?.at(-1) ?? "").replaceAll("'", "")
    const ok = (stdout = "") => ({ code: 0, stdout, stderr: "" })
    if (remote.includes("exec pwd -P")) return ok("/worker/repo\n")
    if (remote.includes("exec sha256sum -- package.json pnpm-lock.yaml")) {
      return ok(`${"1".repeat(64)}  package.json\n${"2".repeat(64)}  pnpm-lock.yaml\n`)
    }
    if (remote.includes("exec stat -Lc %d:%i")) return ok("2049:777\n")
    if (remote.includes("exec readlink -f -- /worker/repo/node_modules")) return ok("/worker/repo/node_modules\n")
    if (remote.includes("exec test -L")) return { code: 1, stdout: "", stderr: "" }
    if (remote.includes("exec test -d /worker/repo/node_modules")) return ok()
    if (remote.includes("exec test -d") && remote.includes("/worker/runtime/worktrees/")) {
      return validationTree ? ok() : { code: 1, stdout: "", stderr: "" }
    }
    if (remote.includes("exec test -f") && remote.includes(".williamos-validation-dependencies")) {
      return validationTree ? ok() : { code: 1, stdout: "", stderr: "" }
    }
    if (remote.includes("exec test -e") && remote.includes("/worker/repo/node_modules/")) {
      return { code: 1, stdout: "", stderr: "" }
    }
    if (remote.includes("exec test -e") && remote.includes("/worker/runtime/worktrees/")) {
      return validationTree ? ok() : { code: 1, stdout: "", stderr: "" }
    }
    if (remote.includes("exec node -e")) { validationTree = true; return ok() }
    if (remote.includes("exec cp -a --reflink=auto")) return ok()
    if (remote.includes("exec rm -rf --") && remote.includes("node_modules")) { validationTree = false; return ok() }
    if (remote.includes("check-ignore -q -- node_modules/")) return ok()
    if (remote.includes("ls-files -z -- node_modules")) return ok()
    if (remote.includes("status --porcelain=v1 -z --untracked-files=all -- node_modules")) return ok()
    if (remote.includes("remote get-url origin")) return ok("https://github.com/bsvalues/terragroq.git\n")
    if (remote.includes("rev-parse refs/remotes/origin/main")) return ok(`${state.merged ? mergeSha : baseSha}\n`)
    if (remote.includes("show-ref --verify --quiet")) return { code: 1, stdout: "", stderr: "" }
    if (remote.includes("worktree list --porcelain")) return ok("")
    if (remote.includes("status --porcelain=v1 -z --untracked-files=all")) return ok(state.committed ? "" : `?? ${reportPath}\0`)
    if (remote.includes("diff --name-status -z --find-renames")) return ok(`A\0${reportPath}\0`)
    if (remote.includes("diff --cached --quiet")) return { code: 1, stdout: "", stderr: "" }
    if (remote.includes("rev-parse HEAD")) return ok(`${state.committed ? headSha : baseSha}\n`)
    if (remote.includes("exec git commit -m")) { state.committed = true; return ok("commit\n") }
    if (remote.includes("exec git diff --check")) { validations.push("git diff --check"); return ok() }
    if (remote.includes("exec gh pr list")) return ok(JSON.stringify(state.created ? [{ number: 991, headRefName: "codex/hermes-goal-runtime-finding-101-202", state: state.merged ? "MERGED" : "OPEN", url: "https://github.com/bsvalues/terragroq/pull/991", mergeCommit: state.merged ? { oid: mergeSha } : null }] : []))
    if (remote.includes("exec gh pr create")) { state.created = true; return ok("https://github.com/bsvalues/terragroq/pull/991\n") }
    if (remote.includes("exec gh pr comment")) { state.requested = true; return ok() }
    if (remote.includes("exec gh pr view")) return ok(JSON.stringify({ number: 991, headRefName: "codex/hermes-goal-runtime-finding-101-202", headRefOid: headSha, baseRefName: "main", state: state.merged ? "MERGED" : "OPEN", isDraft: false, reviewDecision: "APPROVED", statusCheckRollup: [{ name: "unit", conclusion: "SUCCESS" }], reviews: [{ author: { login: "independent-reviewer" }, state: "APPROVED", commit: { oid: headSha } }], mergeCommit: state.merged ? { oid: mergeSha } : null, url: "https://github.com/bsvalues/terragroq/pull/991" }))
    if (remote.includes("exec gh api graphql")) return ok(JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } }, comments: { nodes: state.requested ? [{ author: { login: "bsvalues" }, body: `@codex review Exact-head review requested for ${headSha}.`, createdAt: "2026-08-20T18:01:00.000Z", updatedAt: "2026-08-20T18:01:00.000Z" }] : [], pageInfo: { hasPreviousPage: false, hasNextPage: false } } } } } }))
    if (remote.includes("pulls/991/files?per_page=100")) return ok(JSON.stringify([[{ filename: reportPath }]]))
    if (remote.includes("exec gh pr merge")) { state.merged = true; return ok() }
    if (remote.includes("merge-base --is-ancestor")) return ok()
    if (remote.includes("worktree remove")) { state.cleaned = true; return ok() }
    return ok()
  })
  const prompts: string[] = []
  const client = { connect: vi.fn(async () => {}), startThread: vi.fn(async () => "thread-101"), resumeThread: vi.fn(async () => "thread-101"), runTurn: vi.fn(async ({ prompt }: any) => {
    prompts.push(prompt)
    return { threadId: "thread-101", turnId: "turn-101", status: "completed", finalText: JSON.stringify({ result: "READY_FOR_VALIDATION", workOrder: childRef, branch: "codex/hermes-goal-runtime-finding-101-202", commit: null, prUrl: null, merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0, blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE", blockedAction: null, authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null }) }
  }), close: vi.fn(async () => {}) }
  const backend = new AegisExecutionBackend({ host: "aegis-worker", runtimeRoot: "/worker/runtime", repositoryRoot: "/worker/repo", commandRunner: runner, clientFactory: vi.fn(async () => client) })
  const lifecycle = createRepositoryLifecycle({ repository: "bsvalues/terragroq", workspaceRoot: path.resolve("C:/workspace/terragroq"), repositoryRoot: path.resolve("C:/workspace/terragroq"), ownedWorktreeRoot: path.resolve("C:/workspace-owned/hermes"), validationCommands: contract.validationCommands, executionBackend: backend })
  return { state, calls, validations, prompts, backend, lifecycle }
}

describe("derived AEGIS repository seam without database claims", () => {
  it("runs the registered validator through the real repository lifecycle and AEGIS boundary", async () => {
    const harness = deliveryHarness()
    const record = await harness.lifecycle.createWorktree({ branch: "codex/hermes-goal-runtime-finding-101-202", baseSha })
    await expect(harness.lifecycle.runValidationCommands(record, contract.validationCommands)).resolves.toEqual([{ command: "git", args: ["diff", "--check"], code: 0 }])
    expect(harness.validations).toEqual(["git diff --check"])
    expect(harness.calls.every((call) => call.command === "ssh")).toBe(true)
  })
})

runDatabase("derived finding durable AEGIS cycle", { timeout: 60_000 }, () => {
  let pool: import("pg").Pool
  let client: import("pg").PoolClient
  let schema = ""
  let scopedUrl = ""

  beforeAll(async () => {
    const { Pool } = await import("pg")
    pool = new Pool({ connectionString: directDatabaseUrl(databaseUrl!) })
    client = await pool.connect()
    schema = `hermes_derived_aegis_${randomUUID().replaceAll("-", "")}`
    await bootstrap(client, schema)
    scopedUrl = scopedDatabaseUrl(databaseUrl!, schema)
    await seed(client)
  })
  afterAll(async () => {
    if (client && schema) { await client.query("SET search_path TO public"); await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`) }
    client?.release()
    await pool?.end()
  })

  it("persists exact child authority and terminal rows through real queue SQL", async () => {
    const storedContract = (await client.query(
      `SELECT "resultBinding"->'workContract' AS contract FROM outcome_queue_mutation_receipt WHERE id=206`,
    )).rows[0].contract
    const storedBody = {
      version: storedContract.version, id: storedContract.id, repository: storedContract.repository,
      lane: storedContract.lane, reservations: storedContract.reservations,
      validationCommands: storedContract.validationCommands, projection: storedContract.projection,
      delivery: storedContract.delivery,
    }
    expect(createHash("sha256").update(canonicalJson(storedBody)).digest("hex")).toBe(storedContract.digest)
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-derived-aegis-")); roots.push(runtimeRoot)
    fs.mkdirSync(path.join(runtimeRoot, "control"), { recursive: true })
    fs.writeFileSync(path.join(runtimeRoot, "control", "activation"), "enabled\n")
    fs.writeFileSync(path.join(runtimeRoot, "control", "authority-not-before"), "2026-08-20T00:00:00.000Z\n")
    const harness = deliveryHarness()
    const queue = createHermesOutcomeQueueRuntime({
      databaseUrl: scopedUrl, holderId: "resident-hermes", runtimeRoot,
      campaignWindowId: "campaign-v1-2", processIdentity: "supervisor-nonce-1", now: () => now,
      // The isolated schema is built directly from the production DDL above.
      ensureQueueSchema: async () => true,
    })
    const state = createHermesStateStore(path.join(runtimeRoot, "state", "state.json"), { now: () => now.getTime() })
    const orchestrator = createHermesOrchestrator({ workspace: process.cwd(), runtimeRoot, state, lifecycle: harness.lifecycle, executionBackend: harness.backend,
      selectOutcome: queue.selectOutcome, markComplete: queue.completeOutcome, markTerminal: queue.terminalizeOutcome, deferOutcome: queue.deferOutcome,
      renewQueueLease: queue.renewOutcomeLease, bindQueueWorkOrder: queue.bindWorkOrder, refreshQueueOutcome: queue.refreshOutcome,
      resumeQueueAfterDecision: queue.resumeAfterOwnerDecision, resumeQueueAfterValidationRecovery: queue.resumeAfterValidationRecovery,
      resumeQueueAfterReviewRecovery: queue.resumeAfterReviewRecovery,
      projectCheckpoint: (input: any) => projectOutcomeRuntimeCheckpoint({ ...input, databaseUrl: scopedUrl }),
      projectLease: (input: any) => projectOutcomeRuntimeLease({ ...input, databaseUrl: scopedUrl }),
      holderId: "resident-hermes", now: () => now, sleep: async () => {}, leaseRenewalIntervalMs: 3_600_000 })
    try {
      await expect(orchestrator.cycle()).resolves.toEqual({ result: "COMPLETE", outcomeId: "202", prNumber: 991, mergeSha, changedPaths: [reportPath] })
    } finally { await queue.close() }

    const durableQueue = (await client.query(`SELECT * FROM outcome_queue_item WHERE id=203`)).rows[0]
    expect(durableQueue).toMatchObject({ outcomeKey, goalId: 202, activeWorkOrderId: 201, authorityGrantRef: "RUNTIME-FINDING-QUEUE-GRANT-101", lifecycleState: "completed", terminalResult: "COMPLETE", leaseHolder: null, leaseToken: null, leaseExpiresAt: null })
    expect(durableQueue.terminalEvidenceRefs).toEqual([
      "EV-HERMES-202-1-9", `merge:${mergeSha}`, "pr:991",
    ])
    expect((await client.query(`SELECT id,ref,status,"linkedWorkOrderId" FROM goal WHERE id=202`)).rows).toEqual([{ id: 202, ref: goalRef, status: "converted", linkedWorkOrderId: 201 }])
    expect((await client.query(`SELECT id,ref,lane,status,"allowedFiles",validators,"authorityGrantId" FROM work_order WHERE id=201`)).rows).toEqual([{ id: 201, ref: childRef, lane: "docs", status: "closed", allowedFiles: [reportPath], validators: ["git diff --check"], authorityGrantId: 205 }])
    expect((await client.query(`SELECT id,ref,"workOrderId",scope,"allowedActions",status FROM authority_grant WHERE id IN (205,207) ORDER BY id`)).rows).toEqual([
      { id: 205, ref: "RUNTIME-FINDING-IMPL-GRANT-101", workOrderId: 201, scope: childRef, allowedActions: ["implement"], status: "active" },
      { id: 207, ref: "RUNTIME-FINDING-QUEUE-GRANT-101", workOrderId: 201, scope: outcomeKey, allowedActions: ["outcome:execute"], status: "active" },
    ])
    const receipt = (await client.query(`SELECT id,operation,"outcomeKey","resultBinding" FROM outcome_queue_mutation_receipt WHERE id=206`)).rows[0]
    expect(receipt).toMatchObject({ id: 206, operation: "runtime_finding.derive", outcomeKey, resultBinding: { goalId: 202, queueId: 203, workOrderId: 201, workOrderRef: childRef, decisionId: 204, queueGrantId: 207, implementationGrantId: 205, workContract: { id: contract.id, digest: contract.digest, reservations: [reportPath] } } })
    expect((await client.query(`SELECT "outcomeKey","firstFencingToken","latestFencingToken" FROM outcome_queue_acquisition_receipt`)).rows).toEqual([{ outcomeKey, firstFencingToken: 1, latestFencingToken: 1 }])
    const events = (await client.query(`SELECT "eventType",metadata FROM governance_event WHERE "entityId" IN ('201','202') ORDER BY id`)).rows
    expect(events.filter((row) => row.eventType === "HERMES_OUTCOME_COMPLETED")).toHaveLength(1)
    expect(events.filter((row) => row.eventType === "HERMES_RUNTIME_CHECKPOINT"
      && row.metadata.workOrderRef === childRef && row.metadata.checkpointState === "COMPLETE")).toHaveLength(1)
    const evidence = (await client.query(`SELECT "filesChanged",validators FROM evidence_record WHERE "workOrderId"=201`)).rows
    expect(evidence).toHaveLength(1)
    expect(evidence.every((row) => row.filesChanged.every((entry: string) => entry === reportPath))).toBe(true)
    await client.query("BEGIN")
    try {
      await client.query(`INSERT INTO governance_event
        (id,"userId",ref,"eventType","entityType","entityId",actor,reason,metadata) VALUES
        (999,'primary-user','DERIVED-101-DUPLICATE','RUNTIME_FINDING_DERIVED','work_order','201',
          'williamos-runtime-operator','negative-control',$1::jsonb)`, [
        JSON.stringify({ sourceFindingEventId: 101, outcomeKey, workOrderRef: childRef }),
      ])
      expect((await client.query(`SELECT count(*)::integer AS count FROM governance_event
        WHERE "userId"='primary-user' AND "eventType"='RUNTIME_FINDING_DERIVED'
          AND metadata->>'sourceFindingEventId'='101'`)).rows).toEqual([{ count: 2 }])
    } finally {
      await client.query("ROLLBACK")
    }
    const cardinality = (await client.query(`SELECT
      (SELECT count(*)::integer FROM work_order WHERE "userId"='primary-user' AND ref=$1
        AND "authorityGrantId"=205) AS "childWorkOrders",
      (SELECT count(*)::integer FROM goal WHERE "userId"='primary-user' AND ref=$2
        AND "linkedWorkOrderId"=201) AS goals,
      (SELECT count(*)::integer FROM outcome_queue_item WHERE "userId"='primary-user'
        AND "outcomeKey"=$3) AS queues,
      (SELECT count(*)::integer FROM decision WHERE "userId"='primary-user' AND ref='DEC-CHILD'
        AND owner='WilliamOS' AND scope=$3) AS decisions,
      (SELECT count(*)::integer FROM authority_grant WHERE "userId"='primary-user'
        AND ref='RUNTIME-FINDING-IMPL-GRANT-101' AND "workOrderId"=201 AND scope=$1) AS "implementationGrants",
      (SELECT count(*)::integer FROM authority_grant WHERE "userId"='primary-user'
        AND ref='RUNTIME-FINDING-QUEUE-GRANT-101' AND "workOrderId"=201 AND scope=$3) AS "queueGrants",
      (SELECT count(*)::integer FROM outcome_queue_mutation_receipt WHERE "userId"='primary-user'
        AND operation='runtime_finding.derive' AND "outcomeKey"=$3
        AND "idempotencyKey"='derive-101') AS receipts,
      (SELECT count(*)::integer FROM governance_event WHERE "userId"='primary-user'
        AND "eventType"='RUNTIME_FINDING_DERIVED'
        AND metadata->>'sourceFindingEventId'='101') AS settlements`, [childRef, goalRef, outcomeKey])).rows
    expect(cardinality).toEqual([{ childWorkOrders: 1, goals: 1, queues: 1, decisions: 1,
      implementationGrants: 1, queueGrants: 1, receipts: 1, settlements: 1 }])
    expect(harness.validations).toEqual(["git diff --check"])
    expect(harness.prompts[0]).toContain(childRef)
    expect(harness.state.cleaned).toBe(true)
    expect(state.read().ownerTouchCounters).toEqual({ OWNER_OPERATION_TOUCH_COUNT: 0, OWNER_CREDENTIAL_TOUCH_COUNT: 0, OWNER_DIAGNOSTIC_TOUCH_COUNT: 0, OWNER_ROUTINE_DECISION_COUNT: 0, OWNER_ROUTINE_CONTACT_COUNT: 0 })
    expect(JSON.stringify(harness.calls).toLowerCase()).not.toMatch(/codex exec|runtime-operator|hermes-kernel|issue\s*#?357|\b#357\b/)
  })
})
