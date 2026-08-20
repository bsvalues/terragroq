import { createHash, randomUUID } from "node:crypto"
import os from "node:os"
import path from "node:path"

import {
  acquireNextEligibleOutcome,
  bindOutcomeQueueWorkOrder,
  completeOutcomeQueueItem,
  deferOutcomeQueueLease,
  ensureOutcomeQueueHardeningSchema,
  readOutcomeQueue,
  renewOutcomeQueueLease,
  resumeOutcomeQueueAfterDecision,
  resumeOutcomeQueueAfterReviewRecovery,
  resumeOutcomeQueueAfterValidationRecovery,
  transitionOutcomeQueueItem,
  verifyOutcomeQueueWorkOrderBinding,
} from "./outcome-queue-source.mjs"
import { readHermesState } from "./state-store.mjs"
import { createHermesDatabasePool } from "./database-pool.mjs"
import {
  completeOutcome as completeGoalOutcome,
  deferProviderOutcome as deferGoalOutcome,
  terminalizeOutcome as terminalizeGoalOutcome,
} from "./outcome-source.mjs"
import { blocksAction } from "../runtime-findings/policy.mjs"
import { resolveHermesWorkContract } from "./work-contract.mjs"

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}
import { evaluateOutcomePolicy } from "./policy.mjs"
import { createRuntimeFindingDbConsumer } from "../runtime-findings/db-consumer.mjs"

const DECLARED_PRIMARY_EMAIL = "bsvalues@gmail.com"
const QUEUE_LEASE_DURATION_MS = 50 * 60 * 1000

function wall(message, code) {
  throw Object.assign(new Error(message), { code })
}

function effectiveQueueCommand(item, goal) {
  for (const candidate of [item?.objective, item?.title, goal?.command]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim()
    }
  }
  wall("Durable queue outcome is missing an executable command", "HERMES_OUTCOME_QUEUE_COMMAND_WALL")
}

function governedQueueOutcome(item, goal) {
  return {
    ...goal,
    ...(typeof item?.authorityGrantRef === "string" && item.authorityGrantRef !== ""
      ? { authorityGrantRef: item.authorityGrantRef }
      : {}),
    ...(typeof item?.title === "string" && item.title.trim() !== ""
      ? { title: item.title.trim() }
      : {}),
    command: effectiveQueueCommand(item, goal),
  }
}

function residentCheckpointProvider({ runtimeRoot, readState = readHermesState }) {
  const statePath = path.join(runtimeRoot, "state", "state.json")
  return async ({ outcome }) => {
    const state = readState(statePath)
    const outcomeId = String(outcome.goalId)
    const candidate = state.executions?.[outcomeId] ?? null
    const execution = candidate?.metadata?.outcome?.queueBinding?.outcomeKey === outcome.outcomeKey
      ? candidate
      : null
    const activeWorkOrderId = Number(outcome.activeWorkOrderId)
    return {
      outcomeId,
      outcomeKey: outcome.outcomeKey,
      workOrderId: Number.isSafeInteger(activeWorkOrderId) && activeWorkOrderId > 0
        ? activeWorkOrderId
        : null,
      fencingToken: Number(outcome.fencingToken),
      sequence: execution?.checkpoint?.sequence ?? 0,
      state: execution?.checkpoint?.state ?? "LEASED",
      commit: {
        headSha: execution?.metadata?.headRefOid ?? null,
        mergeSha: execution?.metadata?.mergeSha ?? null,
        prNumber: execution?.metadata?.prNumber ?? null,
      },
    }
  }
}

function queueBinding(outcome) {
  const binding = outcome?.queueBinding
  if (!binding || typeof binding !== "object"
    || typeof binding.userId !== "string" || binding.userId.trim() === ""
    || typeof binding.outcomeKey !== "string" || binding.outcomeKey.trim() === ""
    || !Number.isSafeInteger(binding.expectedVersion) || binding.expectedVersion < 0
    || typeof binding.executionBinding !== "string" || binding.executionBinding.trim() === ""
    || typeof binding.leaseHolder !== "string" || binding.leaseHolder.trim() === ""
    || typeof binding.leaseToken !== "string" || binding.leaseToken.trim() === ""
    || !Number.isSafeInteger(binding.fencingToken) || binding.fencingToken <= 0
    || typeof binding.acquisitionKey !== "string" || binding.acquisitionKey.trim() === ""
    || (binding.authorityGrantRef !== undefined
      && (typeof binding.authorityGrantRef !== "string" || binding.authorityGrantRef.trim() === ""))
    || (binding.validationRecoveryResumeState !== undefined
      && ![
        "VALIDATION_INFRASTRUCTURE_RECOVERED",
        "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
      ].includes(binding.validationRecoveryResumeState))
    || (binding.reviewRecoveryResumeState !== undefined
      && ![
        "REVIEW_REMEDIATION_RECOVERED",
        "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
      ].includes(binding.reviewRecoveryResumeState))
    || (binding.activeWorkOrderId !== undefined
      && (!Number.isSafeInteger(binding.activeWorkOrderId) || binding.activeWorkOrderId <= 0))) {
    wall("Hermes outcome is missing its durable queue binding", "HERMES_OUTCOME_QUEUE_BINDING_WALL")
  }
  return binding
}

function createLazyPool(databaseUrl, createPool) {
  let poolPromise = null
  let closed = false

  async function pool() {
    if (closed) {
      wall("Hermes outcome queue runtime is closed", "HERMES_OUTCOME_QUEUE_RUNTIME_CLOSED")
    }
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") {
      wall("DATABASE_URL is required", "DATABASE_URL_REQUIRED")
    }
    if (!poolPromise) {
      const pending = Promise.resolve()
        .then(async () => createPool
          ? createPool(databaseUrl)
          : createHermesDatabasePool((await import("pg")).Pool, databaseUrl, {
              allowExitOnIdle: true,
            }))
        .then((candidate) => {
          if (!candidate || typeof candidate.query !== "function" || typeof candidate.end !== "function") {
            wall("Hermes outcome queue database pool is invalid", "HERMES_OUTCOME_QUEUE_POOL_WALL")
          }
          candidate.on?.("error", () => {
            if (poolPromise === pending) {
              poolPromise = null
              void candidate.end().catch(() => {})
            }
          })
          return candidate
        })
        .catch((error) => {
          if (poolPromise === pending) poolPromise = null
          throw error
        })
      poolPromise = pending
    }
    return poolPromise
  }

  return {
    async withPool(action) {
      return action(await pool())
    },
    async close() {
      if (closed) return
      closed = true
      const pending = poolPromise
      poolPromise = null
      if (pending) await (await pending).end()
    },
  }
}

async function loadDeclaredPrimary(withPool) {
  return withPool(async (pool) => {
    const result = await pool.query(
      `SELECT id, email
       FROM "user"
       WHERE lower(email) = lower($1)
       ORDER BY id
       LIMIT 2`,
      [DECLARED_PRIMARY_EMAIL],
    )
    if (result.rows.length !== 1) {
      wall("Declared Primary identity is not uniquely available", "HERMES_PRIMARY_IDENTITY_WALL")
    }
    return result.rows[0]
  })
}

const WORKBENCH_BLOCKED_ACTIONS = Object.freeze([
  "production:mutate", "release:create", "secret:access", "spend:increase",
])

async function loadWorkbenchParentContract(pool, queueItem, goal) {
  const result = await pool.query(
    `SELECT receipt.operation AS "receiptOperation", receipt."requestHash" AS "requestHash",
            receipt."requestBinding" AS "requestBinding", receipt."resultBinding" AS "resultBinding",
            project.id AS "projectId", project."userId" AS "projectUserId",
            project.lifecycle AS "projectLifecycle",
            thread.id AS "threadId", thread."userId" AS "threadUserId",
            thread."projectId" AS "threadProjectId",
            (SELECT count(*)::integer FROM workbench_thread_source root
              WHERE root."userId" = receipt."userId" AND root."sourceType" = 'outcome'
                AND root."sourceId" = receipt."outcomeKey" AND root.role = 'root') AS "rootCount",
            (SELECT min(root."threadId") FROM workbench_thread_source root
              WHERE root."userId" = receipt."userId" AND root."sourceType" = 'outcome'
                AND root."sourceId" = receipt."outcomeKey" AND root.role = 'root') AS "rootThreadId",
            (SELECT count(*)::integer FROM project_resource repo
              WHERE repo."userId" = project."userId" AND repo."projectId" = project.id
                AND repo.type = 'repo' AND repo.relationship = 'primary-repo') AS "primaryRepoCount",
            (SELECT min(repo."canonicalIdentity") FROM project_resource repo
              WHERE repo."userId" = project."userId" AND repo."projectId" = project.id
                AND repo.type = 'repo' AND repo.relationship = 'primary-repo') AS "primaryRepository",
            approval.id AS "approvalId", approval.ref AS "approvalRef",
            approval."userId" AS "approvalUserId", approval.status AS "approvalStatus",
            approval.authority AS "approvalAuthority", approval.owner AS "approvalOwner",
            approval.scope AS "approvalScope", approval.locked AS "approvalLocked",
            approval.decision AS "approvalDecision", approval.evidence AS "approvalEvidence",
            approval.tags AS "approvalTags",
            queue_grant.id AS "queueGrantId", queue_grant.ref AS "queueGrantRef",
            queue_grant."userId" AS "queueGrantUserId", queue_grant.status AS "queueGrantStatus",
            queue_grant."revokedAt" AS "queueGrantRevokedAt",
            queue_grant."expiresAt" AS "queueGrantExpiresAt",
            queue_grant."grantedBy" AS "queueGrantGrantedBy",
            queue_grant."grantedTo" AS "queueGrantGrantedTo",
            queue_grant."authorityLevel" AS "queueGrantAuthorityLevel",
            queue_grant.scope AS "queueGrantScope", queue_grant."workOrderId" AS "queueGrantWorkOrderId",
            queue_grant."allowedActions" AS "queueGrantAllowedActions",
            queue_grant."blockedActions" AS "queueGrantBlockedActions",
            implementation_grant.id AS "implementationGrantId",
            implementation_grant.ref AS "implementationGrantRef",
            implementation_grant."userId" AS "implementationGrantUserId",
            implementation_grant.status AS "implementationGrantStatus",
            implementation_grant."revokedAt" AS "implementationGrantRevokedAt",
            implementation_grant."expiresAt" AS "implementationGrantExpiresAt",
            implementation_grant."grantedBy" AS "implementationGrantGrantedBy",
            implementation_grant."grantedTo" AS "implementationGrantGrantedTo",
            implementation_grant."authorityLevel" AS "implementationGrantAuthorityLevel",
            implementation_grant.scope AS "implementationGrantScope",
            implementation_grant."workOrderId" AS "implementationGrantWorkOrderId",
            implementation_grant."allowedActions" AS "implementationGrantAllowedActions",
            implementation_grant."blockedActions" AS "implementationGrantBlockedActions"
       FROM outcome_queue_mutation_receipt receipt
       JOIN project ON project."userId" = receipt."userId"
         AND project.id::text = receipt."requestBinding"->>'projectId'
       JOIN workbench_thread thread ON thread."userId" = receipt."userId"
         AND thread.id = receipt."requestBinding"->>'threadId'
       JOIN decision approval ON approval."userId" = receipt."userId"
         AND approval.id::text = receipt."resultBinding"->>'decisionId'
       JOIN authority_grant queue_grant ON queue_grant."userId" = receipt."userId"
         AND queue_grant.id::text = receipt."resultBinding"->>'grantId'
         AND queue_grant.ref = receipt."resultBinding"->>'grantRef'
       JOIN authority_grant implementation_grant ON implementation_grant."userId" = receipt."userId"
         AND implementation_grant.id::text = receipt."resultBinding"->>'implementationGrantId'
         AND implementation_grant.ref = receipt."resultBinding"->>'implementationGrantRef'
      WHERE receipt."userId" = $1 AND receipt."outcomeKey" = $2
        AND receipt.operation = 'workbench_execution.authorize'
      ORDER BY receipt.id LIMIT 2`,
    [queueItem.userId, queueItem.outcomeKey],
  )
  if (result.rows.length !== 1) {
    wall("Workbench parent authorization graph is not unique", "HERMES_WORKBENCH_PARENT_CONTRACT_WALL")
  }
  const row = result.rows[0]
  const request = row.requestBinding
  const binding = row.resultBinding
  const contract = binding?.workContract
  const registered = resolveHermesWorkContract({
    command: goal.command, title: queueItem.title, objective: queueItem.objective,
    lane: goal.lane, risk: goal.risk, authority: goal.authority,
  })
  const expectedWorkOrderRef = `WO-HERMES-OUTCOME-${Number(goal.id)}`
  const expectedEvidence = registered && [
    `project:${request?.projectId}`, `thread:${request?.threadId}`, "repo:bsvalues/terragroq",
    `work-contract:${registered.id}`, `work-contract-digest:${registered.digest}`,
    `work-contract-json:${JSON.stringify(registered)}`,
    ...registered.reservations.map((reservation) => `reservation:${reservation}`),
    ...registered.validationCommands.map((validator) => `validator:${validator.command}:${validator.args.join(" ")}`),
  ]
  const expectedRequestHash = request && createHash("sha256").update(canonicalJson({
    contract: "workbench-execution-authorization.v1", ...request,
  })).digest("hex")
  const expiresAt = Date.parse(binding?.expiresAt ?? "")
  const exactRequestKeys = "confirmation,idempotencyKey,outcomeKey,projectId,threadId"
  const exactResultKeys = [
    "authorizedAt", "decisionId", "decisionRef", "expiresAt", "grantId", "grantRef",
    "implementationGrantId", "implementationGrantRef", "queueVersion", "workContract",
  ].sort().join(",")
  if (row.receiptOperation !== "workbench_execution.authorize"
    || Object.keys(request ?? {}).sort().join(",") !== exactRequestKeys
    || Object.keys(binding ?? {}).sort().join(",") !== exactResultKeys
    || row.requestHash !== expectedRequestHash
    || request?.confirmation !== "START_WORK" || request?.outcomeKey !== queueItem.outcomeKey
    || request?.idempotencyKey == null || request.idempotencyKey.trim() === ""
    || Number(request?.projectId) !== Number(row.projectId) || request?.threadId !== row.threadId
    || row.projectUserId !== queueItem.userId || row.projectLifecycle !== "active"
    || row.threadUserId !== queueItem.userId || Number(row.threadProjectId) !== Number(row.projectId)
    || Number(row.rootCount) !== 1 || row.rootThreadId !== request?.threadId
    || Number(row.primaryRepoCount) !== 1
    || row.primaryRepository !== "bsvalues/terragroq"
    || !registered || canonicalJson(contract) !== canonicalJson(registered)
    || Number(binding?.decisionId) !== Number(queueItem.approvalDecisionId)
    || Number(binding?.decisionId) !== Number(row.approvalId)
    || binding?.decisionRef !== row.approvalRef || row.approvalUserId !== queueItem.userId
    || row.approvalStatus !== "accepted" || row.approvalAuthority !== "binding"
    || row.approvalOwner !== queueItem.userId || row.approvalScope !== queueItem.outcomeKey
    || row.approvalLocked !== true || String(row.approvalDecision).trim().toUpperCase() !== "APPROVE"
    || JSON.stringify(row.approvalEvidence) !== JSON.stringify(expectedEvidence)
    || JSON.stringify(row.approvalTags) !== JSON.stringify(["workbench", "outcome", "explicit-start-work"])
    || Number(binding?.grantId) !== Number(row.queueGrantId)
    || binding?.grantRef !== queueItem.authorityGrantRef || binding?.grantRef !== row.queueGrantRef
    || row.queueGrantUserId !== queueItem.userId || row.queueGrantStatus !== "active"
    || row.queueGrantRevokedAt != null || row.queueGrantGrantedBy !== queueItem.userId
    || row.queueGrantGrantedTo !== "operator" || row.queueGrantAuthorityLevel !== "A2_WRITE_OWN"
    || row.queueGrantScope !== queueItem.outcomeKey || row.queueGrantWorkOrderId != null
    || JSON.stringify(row.queueGrantAllowedActions) !== JSON.stringify(["outcome:execute"])
    || JSON.stringify(row.queueGrantBlockedActions) !== JSON.stringify(WORKBENCH_BLOCKED_ACTIONS)
    || blocksAction(row.queueGrantBlockedActions, "outcome:execute")
    || Number(binding?.implementationGrantId) !== Number(row.implementationGrantId)
    || binding?.implementationGrantRef !== row.implementationGrantRef
    || row.implementationGrantUserId !== queueItem.userId || row.implementationGrantStatus !== "active"
    || row.implementationGrantRevokedAt != null || row.implementationGrantGrantedBy !== queueItem.userId
    || row.implementationGrantGrantedTo !== "operator"
    || row.implementationGrantAuthorityLevel !== "A2_WRITE_OWN"
    || row.implementationGrantScope !== expectedWorkOrderRef || row.implementationGrantWorkOrderId != null
    || JSON.stringify(row.implementationGrantAllowedActions) !== JSON.stringify(["implement"])
    || JSON.stringify(row.implementationGrantBlockedActions) !== JSON.stringify(WORKBENCH_BLOCKED_ACTIONS)
    || blocksAction(row.implementationGrantBlockedActions, "implement")
    || Number(binding?.queueVersion) !== 1 || !Number.isFinite(Date.parse(binding?.authorizedAt ?? ""))
    || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
    || Date.parse(row.queueGrantExpiresAt) !== expiresAt
    || Date.parse(row.implementationGrantExpiresAt) !== expiresAt) {
    wall("Workbench parent authorization graph conflicts", "HERMES_WORKBENCH_PARENT_CONTRACT_WALL")
  }
  return {
    ...goal,
    outcomeKey: queueItem.outcomeKey,
    verifiedQueueWorkContract: Object.freeze({
      contract: Object.freeze(contract),
      provenance: Object.freeze({
        operation: row.receiptOperation,
        outcomeKey: queueItem.outcomeKey,
        workOrderRef: expectedWorkOrderRef,
      }),
    }),
  }
}

async function loadLinkedGoal(withPool, queueItem) {
  if (!Number.isSafeInteger(Number(queueItem?.goalId)) || Number(queueItem.goalId) <= 0) {
    wall("Acquired queue item is not linked to a governed goal", "HERMES_OUTCOME_QUEUE_GOAL_WALL")
  }
  return withPool(async (pool) => {
    const result = await pool.query(
      `SELECT goal.id, goal."userId" AS "userId", goal.ref, goal.command, goal.lane, goal.mode, goal.risk,
              authority, verdict, "requiresApproval" AS "requiresApproval",
              "matchedRules" AS "matchedRules", status,
              goal."createdAt" AS "createdAt", goal."updatedAt" AS "updatedAt",
              derived.operation AS "derivedReceiptOperation",
              derived."requestHash" AS "derivedRequestHash",
              derived."requestBinding" AS "derivedRequestBinding",
              derived."resultBinding" AS "derivedResultBinding",
              derived.*
       FROM goal
       LEFT JOIN LATERAL (
         SELECT receipt.operation, receipt."requestHash", receipt."requestBinding", receipt."resultBinding",
                child.id AS "derivedWorkOrderId", child.ref AS "derivedWorkOrderRef",
                child."userId" AS "derivedWorkOrderUserId", child.goal AS "derivedWorkOrderGoal",
                child."authorityGrantId" AS "derivedWorkOrderAuthorityGrantId",
                child.status AS "derivedWorkOrderStatus",
                approval.id AS "derivedApprovalDecisionId", approval.status AS "derivedApprovalStatus",
                approval.authority AS "derivedApprovalAuthority", approval.scope AS "derivedApprovalScope",
                approval.locked AS "derivedApprovalLocked", approval.decision AS "derivedApprovalDecision",
                approval.evidence AS "derivedApprovalEvidence",
                queue_grant.id AS "derivedQueueGrantId", queue_grant.ref AS "derivedQueueGrantRef",
                queue_grant.status AS "derivedQueueGrantStatus",
                queue_grant."revokedAt" AS "derivedQueueGrantRevokedAt",
                queue_grant."expiresAt" AS "derivedQueueGrantExpiresAt",
                queue_grant."grantedTo" AS "derivedQueueGrantGrantedTo",
                queue_grant."authorityLevel" AS "derivedQueueGrantAuthorityLevel",
                queue_grant.scope AS "derivedQueueGrantScope",
                queue_grant."workOrderId" AS "derivedQueueGrantWorkOrderId",
                queue_grant."allowedActions" AS "derivedQueueGrantAllowedActions",
                queue_grant."blockedActions" AS "derivedQueueGrantBlockedActions",
                implementation_grant.id AS "derivedImplementationGrantId",
                implementation_grant.ref AS "derivedImplementationGrantRef",
                implementation_grant.status AS "derivedImplementationGrantStatus",
                implementation_grant."revokedAt" AS "derivedImplementationGrantRevokedAt",
                implementation_grant."expiresAt" AS "derivedImplementationGrantExpiresAt",
                implementation_grant."grantedTo" AS "derivedImplementationGrantGrantedTo",
                implementation_grant."authorityLevel" AS "derivedImplementationGrantAuthorityLevel",
                implementation_grant.scope AS "derivedImplementationGrantScope",
                implementation_grant."workOrderId" AS "derivedImplementationGrantWorkOrderId",
                implementation_grant."allowedActions" AS "derivedImplementationGrantAllowedActions",
                implementation_grant."blockedActions" AS "derivedImplementationGrantBlockedActions",
                source.id AS "derivedSourceFindingEventId", source."userId" AS "derivedSourceUserId",
                source.metadata->>'payloadDigest' AS "derivedSourcePayloadDigest",
                source.metadata->>'sourceCheckpointId' AS "derivedSourceCheckpointId",
                source.metadata->>'sourceCheckpointDigest' AS "derivedSourceCheckpointDigest",
                source.metadata->>'objectiveWorkOrderId' AS "derivedSourceParentWorkOrderRef",
                source.metadata->>'workContractId' AS "derivedSourceParentContractId",
                source.metadata->>'workContractDigest' AS "derivedSourceParentContractDigest",
                source.metadata->>'authorizationDecisionId' AS "derivedSourceAuthorizationDecisionId",
                source.metadata->>'implementationGrantId' AS "derivedSourceImplementationGrantId",
                parent.id AS "derivedParentWorkOrderId", parent.ref AS "derivedParentWorkOrderRef",
                parent."userId" AS "derivedParentWorkOrderUserId"
           FROM outcome_queue_mutation_receipt receipt
           JOIN work_order child ON child."userId" = receipt."userId"
             AND child.id::text = receipt."resultBinding"->>'workOrderId'
             AND child.ref = receipt."resultBinding"->>'workOrderRef'
           JOIN decision approval ON approval."userId" = receipt."userId"
             AND approval.id::text = receipt."resultBinding"->>'approvalDecisionId'
           JOIN authority_grant queue_grant ON queue_grant."userId" = receipt."userId"
             AND queue_grant.id::text = receipt."resultBinding"->>'queueGrantId'
             AND queue_grant.ref = receipt."resultBinding"->>'queueGrantRef'
           JOIN authority_grant implementation_grant ON implementation_grant."userId" = receipt."userId"
             AND implementation_grant.id::text = receipt."resultBinding"->>'implementationGrantId'
             AND implementation_grant.ref = receipt."resultBinding"->>'implementationGrantRef'
           JOIN governance_event source ON source."userId" = receipt."userId"
             AND source.id::text = receipt."requestBinding"->>'sourceFindingEventId'
             AND source."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
           JOIN work_order parent ON parent."userId" = receipt."userId"
             AND parent.id::text = receipt."requestBinding"->>'parentWorkOrderId'
             AND parent.ref = receipt."requestBinding"->>'parentWorkOrderRef'
          WHERE receipt."userId" = goal."userId" AND receipt."outcomeKey" = $4
            AND receipt.operation = 'runtime_finding.derive'
          ORDER BY receipt.id LIMIT 2
       ) derived ON true
       WHERE goal.id = $1 AND goal."userId" = $2 AND goal.ref = $3 AND goal.status = 'classified'
       LIMIT 2`,
      [Number(queueItem.goalId), queueItem.userId, queueItem.goalRef, queueItem.outcomeKey],
    )
    if (result.rows.length > 1) {
      wall("Derived queue contract receipt is not unique", "HERMES_RUNTIME_FINDING_CONTRACT_WALL")
    }
    if (result.rows.length !== 1) {
      wall("Acquired queue item does not match an executable governed goal", "HERMES_OUTCOME_QUEUE_GOAL_WALL")
    }
    const goal = result.rows[0]
    const derivedFields = Object.fromEntries(Object.entries(goal).filter(([key]) => key.startsWith("derived")))
    const publicGoal = Object.fromEntries(Object.entries(goal).filter(([key]) =>
      !key.startsWith("derived") && !["operation", "requestHash", "requestBinding", "resultBinding"].includes(key)))
    const { derivedReceiptOperation, derivedRequestHash, derivedRequestBinding, derivedResultBinding } = derivedFields
    if (derivedReceiptOperation == null) {
      if (String(queueItem.outcomeKey).startsWith("runtime-finding:")) {
        wall("Derived queue contract receipt is unavailable", "HERMES_RUNTIME_FINDING_CONTRACT_WALL")
      }
      if (publicGoal.lane === "operator-objective") {
        return loadWorkbenchParentContract(pool, queueItem, publicGoal)
      }
      return publicGoal
    }
    const receipt = {
      operation: derivedReceiptOperation,
      requestBinding: derivedRequestBinding,
      resultBinding: derivedResultBinding,
    }
    const contract = receipt.resultBinding?.workContract
    const contractBody = contract && {
      version: contract.version, id: contract.id, repository: contract.repository, lane: contract.lane,
      reservations: contract.reservations, validationCommands: contract.validationCommands,
      ...(Object.hasOwn(contract, "projection") ? { projection: contract.projection } : {}),
      delivery: contract.delivery,
    }
    const contractDigest = contractBody
      ? createHash("sha256").update(canonicalJson(contractBody)).digest("hex")
      : null
    const exactRequestKeys = [
      "operation", "parentAuthorizationDecisionId", "parentContractDigest", "parentContractId",
      "parentImplementationGrantId", "parentWorkOrderId", "parentWorkOrderRef",
      "sourceCheckpointDigest", "sourceCheckpointId", "sourceFindingEventId", "sourcePayloadDigest",
    ]
    const exactResultKeys = [
      "approvalDecisionId", "decisionId", "goalId", "goalRef", "grantId", "grantRef",
      "implementationGrantId", "implementationGrantRef", "outcomeKey", "queueGrantId",
      "queueGrantRef", "queueId", "workContract", "workOrderId", "workOrderRef",
    ]
    const validationsExact = Array.isArray(contract?.validationCommands)
      && contract.validationCommands.length > 0
      && contract.validationCommands.every((command) => {
        const keys = ["args", "command", "timeoutMs", ...(Object.hasOwn(command ?? {}, "env") ? ["env"] : [])]
        return command && Object.keys(command).sort().join(",") === keys.sort().join(",")
          && typeof command.command === "string" && command.command !== ""
          && Array.isArray(command.args) && command.args.every((argument) => typeof argument === "string")
          && Number.isSafeInteger(command.timeoutMs) && command.timeoutMs > 0
          && (command.env === undefined || (command.env && typeof command.env === "object"
            && !Array.isArray(command.env)
            && Object.values(command.env).every((value) => typeof value === "string")))
      })
    const deliveryExact = contract?.delivery
      && Object.keys(contract.delivery).sort().join(",")
        === "allowedActions,authorityLevel,commitAllowed,pushAllowed,tagAllowed"
      && contract.delivery.authorityLevel === "A2_WRITE_OWN"
      && JSON.stringify(contract.delivery.allowedActions) === JSON.stringify(["implement"])
      && [contract.delivery.commitAllowed, contract.delivery.tagAllowed, contract.delivery.pushAllowed]
        .every((value) => typeof value === "boolean")
    const projectionExact = contract?.projection === undefined || (
      Object.keys(contract.projection).sort().join(",") === "completionOwned,issueNumber"
      && Number.isSafeInteger(contract.projection.issueNumber) && contract.projection.issueNumber > 0
      && typeof contract.projection.completionOwned === "boolean"
    )
    if (receipt.operation !== "runtime_finding.derive"
      || derivedRequestHash !== createHash("sha256").update(canonicalJson(receipt.requestBinding)).digest("hex")
      || Object.keys(receipt.requestBinding ?? {}).sort().join(",") !== exactRequestKeys.sort().join(",")
      || Object.keys(receipt.resultBinding ?? {}).sort().join(",") !== exactResultKeys.sort().join(",")
      || receipt.requestBinding?.operation !== "runtime_finding.derive"
      || receipt.resultBinding?.outcomeKey !== queueItem.outcomeKey
      || Number(receipt.resultBinding?.goalId) !== Number(queueItem.goalId)
      || receipt.resultBinding?.goalRef !== queueItem.goalRef
      || Number(receipt.resultBinding?.queueId) !== Number(queueItem.id)
      || Number(receipt.resultBinding?.workOrderId) !== Number(queueItem.activeWorkOrderId)
      || receipt.resultBinding?.workOrderRef !== derivedFields.derivedWorkOrderRef
      || Number(derivedFields.derivedWorkOrderId) !== Number(queueItem.activeWorkOrderId)
      || derivedFields.derivedWorkOrderUserId !== queueItem.userId
      || derivedFields.derivedWorkOrderGoal !== queueItem.goalRef
      || Number(derivedFields.derivedWorkOrderAuthorityGrantId) !== Number(receipt.resultBinding?.implementationGrantId)
      || !["approved", "active"].includes(derivedFields.derivedWorkOrderStatus)
      || receipt.resultBinding?.grantRef !== queueItem.authorityGrantRef
      || Number(receipt.resultBinding?.decisionId) !== Number(queueItem.approvalDecisionId)
      || Number(receipt.resultBinding?.approvalDecisionId) !== Number(queueItem.approvalDecisionId)
      || Number(derivedFields.derivedApprovalDecisionId) !== Number(queueItem.approvalDecisionId)
      || derivedFields.derivedApprovalStatus !== "accepted"
      || derivedFields.derivedApprovalAuthority !== "binding"
      || derivedFields.derivedApprovalScope !== queueItem.outcomeKey
      || derivedFields.derivedApprovalLocked !== true
      || String(derivedFields.derivedApprovalDecision ?? "").trim().toUpperCase() !== "APPROVE"
      || JSON.stringify(derivedFields.derivedApprovalEvidence)
        !== JSON.stringify([`runtime-finding:${receipt.requestBinding?.sourceFindingEventId}`])
      || Number(receipt.resultBinding?.queueGrantId) !== Number(derivedFields.derivedQueueGrantId)
      || receipt.resultBinding?.queueGrantRef !== derivedFields.derivedQueueGrantRef
      || Number(receipt.resultBinding?.grantId) !== Number(derivedFields.derivedQueueGrantId)
      || receipt.resultBinding?.grantRef !== derivedFields.derivedQueueGrantRef
      || derivedFields.derivedQueueGrantStatus !== "active" || derivedFields.derivedQueueGrantRevokedAt != null
      || derivedFields.derivedQueueGrantGrantedTo !== "operator"
      || derivedFields.derivedQueueGrantAuthorityLevel !== "A2_WRITE_OWN"
      || derivedFields.derivedQueueGrantScope !== queueItem.outcomeKey
      || Number(derivedFields.derivedQueueGrantWorkOrderId) !== Number(queueItem.activeWorkOrderId)
      || JSON.stringify(derivedFields.derivedQueueGrantAllowedActions) !== JSON.stringify(["outcome:execute"])
      || !Array.isArray(derivedFields.derivedQueueGrantBlockedActions)
      || blocksAction(derivedFields.derivedQueueGrantBlockedActions, "outcome:execute")
      || Number(receipt.resultBinding?.implementationGrantId) !== Number(derivedFields.derivedImplementationGrantId)
      || receipt.resultBinding?.implementationGrantRef !== derivedFields.derivedImplementationGrantRef
      || derivedFields.derivedImplementationGrantStatus !== "active"
      || derivedFields.derivedImplementationGrantRevokedAt != null
      || derivedFields.derivedImplementationGrantGrantedTo !== "operator"
      || derivedFields.derivedImplementationGrantAuthorityLevel !== "A2_WRITE_OWN"
      || derivedFields.derivedImplementationGrantScope !== receipt.resultBinding?.workOrderRef
      || Number(derivedFields.derivedImplementationGrantWorkOrderId) !== Number(queueItem.activeWorkOrderId)
      || JSON.stringify(derivedFields.derivedImplementationGrantAllowedActions) !== JSON.stringify(["implement"])
      || !Array.isArray(derivedFields.derivedImplementationGrantBlockedActions)
      || blocksAction(derivedFields.derivedImplementationGrantBlockedActions, "implement")
      || Number(derivedFields.derivedSourceFindingEventId) !== Number(receipt.requestBinding?.sourceFindingEventId)
      || derivedFields.derivedSourceUserId !== queueItem.userId
      || derivedFields.derivedSourcePayloadDigest !== receipt.requestBinding?.sourcePayloadDigest
      || Number(derivedFields.derivedSourceCheckpointId) !== Number(receipt.requestBinding?.sourceCheckpointId)
      || derivedFields.derivedSourceCheckpointDigest !== receipt.requestBinding?.sourceCheckpointDigest
      || derivedFields.derivedSourceParentWorkOrderRef !== receipt.requestBinding?.parentWorkOrderRef
      || derivedFields.derivedSourceParentContractId !== receipt.requestBinding?.parentContractId
      || derivedFields.derivedSourceParentContractDigest !== receipt.requestBinding?.parentContractDigest
      || Number(derivedFields.derivedSourceAuthorizationDecisionId)
        !== Number(receipt.requestBinding?.parentAuthorizationDecisionId)
      || Number(derivedFields.derivedSourceImplementationGrantId)
        !== Number(receipt.requestBinding?.parentImplementationGrantId)
      || Number(derivedFields.derivedParentWorkOrderId) !== Number(receipt.requestBinding?.parentWorkOrderId)
      || derivedFields.derivedParentWorkOrderRef !== receipt.requestBinding?.parentWorkOrderRef
      || derivedFields.derivedParentWorkOrderUserId !== queueItem.userId
      || new Date(derivedFields.derivedQueueGrantExpiresAt).getTime() <= Date.now()
      || new Date(derivedFields.derivedImplementationGrantExpiresAt).getTime() <= Date.now()
      || !contract || Object.keys(contract).sort().join(",") !== [
        "delivery", "digest", "id", "lane", "repository", "reservations", "validationCommands", "version",
        ...(Object.hasOwn(contract ?? {}, "projection") ? ["projection"] : []),
      ].sort().join(",")
      || contract.digest !== contractDigest
      || contract.version !== "hermes-work-contract.v1"
      || contract.repository !== "bsvalues/terragroq"
      || !/^[A-Za-z0-9._-]{1,120}$/.test(contract.id ?? "")
      || typeof contract.lane !== "string" || contract.lane.trim() === ""
      || !Array.isArray(contract.reservations) || contract.reservations.length === 0
      || contract.reservations.some((reservation) => typeof reservation !== "string" || reservation === "")
      || !validationsExact || !deliveryExact || !projectionExact) {
      wall("Derived queue contract receipt conflicts", "HERMES_RUNTIME_FINDING_CONTRACT_WALL")
    }
    return {
      ...publicGoal,
      outcomeKey: queueItem.outcomeKey,
      verifiedQueueWorkContract: Object.freeze({
        contract: Object.freeze(contract),
        provenance: Object.freeze({
          operation: receipt.operation,
          outcomeKey: queueItem.outcomeKey,
          workOrderId: Number(queueItem.activeWorkOrderId),
          workOrderRef: receipt.resultBinding.workOrderRef,
        }),
      }),
    }
  })
}

function completionEvidence(evidence) {
  const refs = []
  if (/^EV-HERMES-\d+-\d+-\d+$/.test(String(evidence?.runtimeEvidenceRef ?? ""))) {
    refs.push(evidence.runtimeEvidenceRef)
  }
  if (Number.isSafeInteger(Number(evidence?.prNumber)) && Number(evidence.prNumber) > 0) {
    refs.push(`pr:${Number(evidence.prNumber)}`)
  }
  if (/^[0-9a-f]{40}$/.test(String(evidence?.mergeSha ?? ""))) {
    refs.push(`merge:${evidence.mergeSha}`)
  }
  return refs
}

function requiredMergeSha(evidence) {
  const mergeSha = evidence?.mergeSha
  if (typeof mergeSha !== "string" || !/^[0-9a-f]{40}$/.test(mergeSha)) {
    wall(
      "Queue completion requires an exact 40-hex merge SHA",
      "HERMES_OUTCOME_QUEUE_MERGE_SHA_WALL",
    )
  }
  return mergeSha
}

function persistedBinding(item) {
  const activeWorkOrderId = Number(item.activeWorkOrderId)
  const validationRecoveryResumeState = [
    "VALIDATION_INFRASTRUCTURE_RECOVERED",
    "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED",
  ].includes(item.lifecycleReason)
    ? item.lifecycleReason
    : null
  const reviewRecoveryResumeState = [
    "REVIEW_REMEDIATION_RECOVERED",
    "REVIEW_REMEDIATION_RECOVERY_RECLAIMED",
  ].includes(item.lifecycleReason)
    ? item.lifecycleReason
    : null
  return {
    userId: item.userId,
    outcomeKey: item.outcomeKey,
    expectedVersion: Number(item.version),
    executionBinding: item.executionBinding,
    leaseHolder: item.leaseHolder,
    leaseToken: item.leaseToken,
    fencingToken: Number(item.fencingToken),
    acquisitionKey: item.acquisitionKey,
    ...(typeof item.authorityGrantRef === "string" && item.authorityGrantRef !== ""
      ? { authorityGrantRef: item.authorityGrantRef }
      : {}),
    ...(validationRecoveryResumeState ? { validationRecoveryResumeState } : {}),
    ...(reviewRecoveryResumeState ? { reviewRecoveryResumeState } : {}),
    ...(Number.isSafeInteger(activeWorkOrderId) && activeWorkOrderId > 0
      ? { activeWorkOrderId }
      : {}),
  }
}

function withPersistedBinding(outcome, item) {
  const binding = persistedBinding(item)
  const priorRecoveryState = outcome?.queueBinding?.validationRecoveryResumeState
  if (priorRecoveryState && item.lifecycleReason === "STALE_LEASE_RECOVERED") {
    binding.validationRecoveryResumeState = priorRecoveryState
  }
  const priorReviewRecoveryState = outcome?.queueBinding?.reviewRecoveryResumeState
  if (priorReviewRecoveryState && item.lifecycleReason === "STALE_LEASE_RECOVERED") {
    binding.reviewRecoveryResumeState = priorReviewRecoveryState
  }
  return { ...outcome, queueBinding: binding }
}

function sameStrings(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
}

function isExactTerminalSettlement(item, binding, terminalReplay) {
  if (!item
    || item.userId !== binding.userId
    || item.outcomeKey !== binding.outcomeKey
    || Number(item.version) !== binding.expectedVersion + 1
    || item.executionBinding !== binding.executionBinding
    || Number(item.fencingToken) !== binding.fencingToken
    || item.acquisitionKey !== binding.acquisitionKey
    || item.leaseHolder != null
    || item.leaseToken != null
    || item.leaseExpiresAt != null) return false

  if (terminalReplay?.state === "COMPLETE") {
    if (!/^[0-9a-f]{40}$/.test(String(terminalReplay.evidence?.mergeSha ?? ""))) return false
    const refs = completionEvidence(terminalReplay.evidence)
    return refs.length > 0
      && item.lifecycleState === "completed"
      && item.lifecycleReason == null
      && item.terminalResult === "COMPLETE"
      && item.terminalEvidenceId == null
      && item.terminalKey === `hermes:${binding.outcomeKey}:${binding.fencingToken}:${terminalReplay.evidence?.mergeSha}`
      && sameStrings(item.terminalEvidenceRefs, refs)
  }
  if (["FAILED_TERMINAL", "OWNER_DECISION_REQUIRED"].includes(terminalReplay?.state)) {
    return typeof terminalReplay.nextState === "string"
      && terminalReplay.nextState.length > 0
      && item.lifecycleState === "blocked"
      && item.lifecycleReason === terminalReplay.nextState
      && item.terminalResult == null
      && item.terminalEvidenceId == null
      && sameStrings(item.terminalEvidenceRefs ?? [], [])
      && item.terminalKey == null
      && item.terminalAt == null
  }
  return false
}

function isExactLiveBinding(item, binding, activeWorkOrderId) {
  return item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && Number(item.version) === binding.expectedVersion
    && item.executionBinding === binding.executionBinding
    && item.leaseHolder === binding.leaseHolder
    && item.leaseToken === binding.leaseToken
    && Number(item.fencingToken) === binding.fencingToken
    && item.acquisitionKey === binding.acquisitionKey
    && Number(item.activeWorkOrderId) === activeWorkOrderId
}

function isExactProviderDeferral(item, binding, retryAfter, holderId) {
  return isExactLiveBinding(item, binding, Number(binding.activeWorkOrderId))
    && item.leaseHolder === holderId
    && item.lifecycleReason === "PROVIDER_UNAVAILABLE"
    && new Date(item.leaseExpiresAt).toISOString() === new Date(retryAfter).toISOString()
}

function isExactOwnerDecisionResume(item, binding, holderId, at) {
  const renewalIncrement = item?.authorityRenewalApplied === true ? 1 : 0
  return item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && item.lifecycleReason === "OWNER_DECISION_RESUMED"
    && item.approvalState === "approved"
    && item.authorityState === "matched"
    && Number(item.version) === binding.expectedVersion + 2 + renewalIncrement
    && item.executionBinding === binding.executionBinding
    && item.acquisitionKey === binding.acquisitionKey
    && Number(item.fencingToken) === binding.fencingToken + 1
    && item.leaseHolder === holderId
    && item.leaseToken === binding.leaseToken
    && Date.parse(String(item.leaseExpiresAt)) > at.getTime()
}

function isExactValidationRecoveryResume(item, binding, holderId, at) {
  const renewalCount = Number(item?.authorityRenewalCount
    ?? (item?.authorityRenewalApplied === true ? 1 : 0))
  const reclaimCount = Number(item?.validationRecoveryReclaimCount ?? 0)
  if (!Number.isSafeInteger(renewalCount) || renewalCount < 0
    || !Number.isSafeInteger(reclaimCount) || reclaimCount < 0) return false
  return item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && item.lifecycleReason === (reclaimCount > 0
      ? "VALIDATION_INFRASTRUCTURE_RECOVERY_RECLAIMED"
      : "VALIDATION_INFRASTRUCTURE_RECOVERED")
    && item.approvalState === "approved"
    && item.authorityState === "matched"
    && Number(item.version) === binding.expectedVersion + 2
      + renewalCount + reclaimCount
    && item.executionBinding === binding.executionBinding
    && item.acquisitionKey === binding.acquisitionKey
    && Number(item.fencingToken) === binding.fencingToken + 1 + reclaimCount
    && item.leaseHolder === holderId
    && item.leaseToken === binding.leaseToken
    && Date.parse(String(item.leaseExpiresAt)) > at.getTime()
}

function isExactReviewRecoveryResume(item, binding, holderId, at) {
  const renewalCount = Number(item?.authorityRenewalCount
    ?? (item?.authorityRenewalApplied === true ? 1 : 0))
  const reclaimCount = Number(item?.reviewRecoveryReclaimCount ?? 0)
  if (!Number.isSafeInteger(renewalCount) || renewalCount < 0
    || !Number.isSafeInteger(reclaimCount) || reclaimCount < 0) return false
  return item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && item.lifecycleReason === (reclaimCount > 0
      ? "REVIEW_REMEDIATION_RECOVERY_RECLAIMED"
      : "REVIEW_REMEDIATION_RECOVERED")
    && item.approvalState === "approved"
    && item.authorityState === "matched"
    && Number(item.version) === binding.expectedVersion + 2 + renewalCount + reclaimCount
    && item.executionBinding === binding.executionBinding
    && item.acquisitionKey === binding.acquisitionKey
    && Number(item.fencingToken) === binding.fencingToken + 1 + reclaimCount
    && item.leaseHolder === holderId
    && item.leaseToken === binding.leaseToken
    && Date.parse(String(item.leaseExpiresAt)) > at.getTime()
}

function isExactPersistedReviewRecovery(item, binding, outcome) {
  const versionDelta = Number(item?.version) - binding.expectedVersion
  const fenceDelta = Number(item?.fencingToken) - binding.fencingToken
  const priorAuthorityGrantRef = binding.authorityGrantRef ?? outcome?.authorityGrantRef
  const authorityRenewalDelta = typeof priorAuthorityGrantRef === "string"
    && priorAuthorityGrantRef !== ""
    && typeof item?.authorityGrantRef === "string"
    && item.authorityGrantRef !== priorAuthorityGrantRef
    ? 1
    : 0
  const exactRecovery = fenceDelta === 0
    && versionDelta === authorityRenewalDelta
    && item?.lifecycleReason === binding.reviewRecoveryResumeState
  const recoveredAcquisitionReclaim = Number.isSafeInteger(versionDelta)
    && Number.isSafeInteger(fenceDelta)
    && fenceDelta >= 0
    && versionDelta === fenceDelta + authorityRenewalDelta
    && item?.lifecycleReason === "STALE_LEASE_RECOVERED"
  return (exactRecovery || recoveredAcquisitionReclaim)
    && item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && item.executionBinding === binding.executionBinding
    && item.acquisitionKey === binding.acquisitionKey
    && item.leaseToken === binding.leaseToken
}

function isExactPersistedValidationRecovery(item, binding, outcome) {
  const versionDelta = Number(item?.version) - binding.expectedVersion
  const fenceDelta = Number(item?.fencingToken) - binding.fencingToken
  const provenPreviousAuthorityGrantRef = Number(item?.authorityRenewalProofCount) === 1
    && typeof item?.previousAuthorityGrantRef === "string"
    && item.previousAuthorityGrantRef !== ""
    ? item.previousAuthorityGrantRef
    : null
  const priorAuthorityGrantRef = binding.authorityGrantRef
    ?? outcome?.authorityGrantRef
    ?? provenPreviousAuthorityGrantRef
  const authorityRenewalDelta = typeof priorAuthorityGrantRef === "string"
    && priorAuthorityGrantRef !== ""
    && typeof item?.authorityGrantRef === "string"
    && item.authorityGrantRef !== priorAuthorityGrantRef
    ? 1
    : 0
  const exactRecovery = fenceDelta === 0
    && versionDelta === authorityRenewalDelta
    && item?.lifecycleReason === binding.validationRecoveryResumeState
  const recoveredAcquisitionReclaim = Number.isSafeInteger(versionDelta)
    && Number.isSafeInteger(fenceDelta)
    && fenceDelta >= 0
    && versionDelta === fenceDelta + authorityRenewalDelta
    && item?.lifecycleReason === "STALE_LEASE_RECOVERED"
  return (exactRecovery || recoveredAcquisitionReclaim)
    && item?.userId === binding.userId
    && item.outcomeKey === binding.outcomeKey
    && item.lifecycleState === "active"
    && item.executionBinding === binding.executionBinding
    && item.acquisitionKey === binding.acquisitionKey
    && item.leaseToken === binding.leaseToken
}

export function createHermesOutcomeQueueRuntime(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  const database = createLazyPool(databaseUrl, options.createPool)
  const acquire = options.acquire ?? acquireNextEligibleOutcome
  const bindQueueWorkOrder = options.bindQueueWorkOrder ?? bindOutcomeQueueWorkOrder
  const verifyQueueWorkOrder = options.verifyQueueWorkOrder
    ?? verifyOutcomeQueueWorkOrderBinding
  const ensureQueueSchema = options.ensureQueueSchema
    ?? (options.acquire ? async () => true : ensureOutcomeQueueHardeningSchema)
  const completeQueue = options.completeQueue ?? completeOutcomeQueueItem
  const renewQueue = options.renewQueue ?? renewOutcomeQueueLease
  const deferQueue = options.deferQueue ?? deferOutcomeQueueLease
  const resumeQueue = options.resumeQueue ?? resumeOutcomeQueueAfterDecision
  const resumeValidationRecoveryQueue = options.resumeValidationRecoveryQueue
    ?? resumeOutcomeQueueAfterValidationRecovery
  const resumeReviewRecoveryQueue = options.resumeReviewRecoveryQueue
    ?? resumeOutcomeQueueAfterReviewRecovery
  const readQueue = options.readQueue ?? readOutcomeQueue
  const transitionQueue = options.transitionQueue ?? transitionOutcomeQueueItem
  const completeGoal = options.completeGoal ?? completeGoalOutcome
  const terminalizeGoal = options.terminalizeGoal ?? terminalizeGoalOutcome
  const deferGoal = options.deferGoal ?? deferGoalOutcome
  const resolvePrimary = options.resolvePrimary ?? (() => loadDeclaredPrimary(database.withPool))
  const resolveGoal = options.resolveGoal ?? ((item) => loadLinkedGoal(database.withPool, item))
  const now = options.now ?? (() => new Date())
  const createFindingConsumer = options.createRuntimeFindingConsumer ?? createRuntimeFindingDbConsumer
  const consumeRuntimeFindings = options.consumeRuntimeFindings ?? createFindingConsumer({
    withPool: database.withPool,
    now,
    ...(options.maxRuntimeFindings === undefined ? {} : { maxFindings: options.maxRuntimeFindings }),
  })
  const holderId = options.holderId ?? `${os.hostname()}:hermes-outcome-queue`
  const runtimeRoot = path.resolve(
    options.runtimeRoot
      ?? process.env.WILLIAMOS_HERMES_RUNTIME_ROOT
      ?? path.join(os.homedir(), ".williamos", "hermes-bridge"),
  )
  const campaignWindowId = options.campaignWindowId ?? process.env.HERMES_CAMPAIGN_WINDOW_ID
  const processIdentity = options.processIdentity ?? process.env.HERMES_PROCESS_IDENTITY
  const checkpointProofProvider = options.checkpointProofProvider
    ?? residentCheckpointProvider({ runtimeRoot, readState: options.readHermesState })
  let schemaReady = null

  function requireExecutionProofContext() {
    if (typeof campaignWindowId !== "string" || campaignWindowId.trim() === "") {
      wall("Trusted resident campaign window is required", "HERMES_CAMPAIGN_WINDOW_REQUIRED")
    }
    if (typeof processIdentity !== "string" || processIdentity.trim() === "") {
      wall("Trusted resident process identity is required", "HERMES_PROCESS_IDENTITY_REQUIRED")
    }
  }

  async function ensureReady() {
    if (!schemaReady) {
      schemaReady = Promise.resolve(ensureQueueSchema({ databaseUrl }))
        .catch((error) => {
          schemaReady = null
          throw error
        })
    }
    await schemaReady
  }

  async function selectOutcome() {
    requireExecutionProofContext()
    await ensureReady()
    const primary = await resolvePrimary()
    for (let rejected = 0; rejected < 100; rejected += 1) {
      const acquired = await acquire({
        databaseUrl,
        userId: primary.id,
        acquisitionKey: randomUUID(),
        leaseHolder: holderId,
        leaseToken: randomUUID(),
        executionBinding: randomUUID(),
        leaseDurationMs: QUEUE_LEASE_DURATION_MS,
        campaignWindowId,
        processIdentity,
        checkpointProofProvider,
        now: now(),
      })
      if (!acquired?.outcome || !acquired.acquired) return null
      const item = acquired.outcome
      try {
        const goal = await resolveGoal(item)
        const governedOutcome = {
          ...governedQueueOutcome(item, goal),
          queueBinding: persistedBinding(item),
        }
        const decision = evaluateOutcomePolicy({
          outcome: governedOutcome,
          actor: "bsvalues",
          repository: "bsvalues/terragroq",
          enabled: true,
          standingAuthority: true,
        })
        if (!decision.allowed) {
          wall(decision.reasonCode, `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`)
        }
        return governedOutcome
      } catch (error) {
        if (error?.code !== "HERMES_OUTCOME_QUEUE_GOAL_WALL"
          && !String(error?.code ?? "").startsWith("HERMES_OUTCOME_QUEUE_POLICY_")) {
          throw error
        }
        await transitionQueue({
          databaseUrl,
          userId: item.userId,
          outcomeKey: item.outcomeKey,
          fromState: "active",
          toState: "blocked",
          expectedVersion: Number(item.version),
          executionBinding: item.executionBinding,
          leaseToken: item.leaseToken,
          fencingToken: Number(item.fencingToken),
          lifecycleReason: error?.code ?? "HERMES_OUTCOME_QUEUE_GOAL_WALL",
          now: now(),
        })
      }
    }
    wall("Queue contains too many invalid executable bindings", "HERMES_OUTCOME_QUEUE_REJECTION_BUDGET_WALL")
  }

  async function completeOutcome({ outcomeId, outcome, evidence }) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) {
      return completeGoal({ databaseUrl, outcomeId, evidence })
    }
    const binding = queueBinding(outcome)
    const mergeSha = requiredMergeSha(evidence)
    const refs = completionEvidence(evidence)
    if (refs.length === 0) {
      wall("Queue completion requires reviewed delivery evidence", "HERMES_OUTCOME_QUEUE_EVIDENCE_WALL")
    }
    try {
      await completeQueue({
        databaseUrl,
        ...binding,
        terminalKey: `hermes:${binding.outcomeKey}:${binding.fencingToken}:${mergeSha}`,
        terminalResult: "COMPLETE",
        terminalEvidenceRefs: refs,
        now: now(),
      })
    } catch (error) {
      const current = (await readQueue({
        databaseUrl,
        userId: binding.userId,
      })).find((item) => item.outcomeKey === binding.outcomeKey)
      if (!isExactTerminalSettlement(current, binding, {
        state: "COMPLETE",
        evidence,
      })) throw error
    }
    return completeGoal({ databaseUrl, outcomeId, evidence })
  }

  async function terminalizeOutcome({ outcomeId, outcome, result, nextState, metadata }) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) {
      return terminalizeGoal({ databaseUrl, outcomeId, result, nextState, metadata })
    }
    const binding = queueBinding(outcome)
    const lifecycleReason = nextState ?? result
    try {
      await transitionQueue({
        databaseUrl,
        userId: binding.userId,
        outcomeKey: binding.outcomeKey,
        fromState: "active",
        toState: "blocked",
        expectedVersion: binding.expectedVersion,
        executionBinding: binding.executionBinding,
        leaseToken: binding.leaseToken,
        fencingToken: binding.fencingToken,
        lifecycleReason,
        now: now(),
      })
    } catch (error) {
      const current = (await readQueue({
        databaseUrl,
        userId: binding.userId,
      })).find((item) => item.outcomeKey === binding.outcomeKey)
      if (current?.lifecycleState !== "blocked"
        || current.lifecycleReason !== lifecycleReason
        || Number(current.version) !== binding.expectedVersion + 1
        || current.executionBinding !== binding.executionBinding
        || Number(current.fencingToken) !== binding.fencingToken
        || current.acquisitionKey !== binding.acquisitionKey) throw error
    }
    return terminalizeGoal({ databaseUrl, outcomeId, result, nextState, metadata })
  }

  async function deferOutcome({ outcomeId, outcome, retryAfter }) {
    requireExecutionProofContext()
    if (outcome?.queueBinding) {
      const binding = queueBinding(outcome)
      try {
        await deferQueue({
          databaseUrl,
          ...binding,
          retryAfter,
          lifecycleReason: "PROVIDER_UNAVAILABLE",
          now: now(),
        })
      } catch (error) {
        const current = (await readQueue({
          databaseUrl,
          userId: binding.userId,
        })).find((item) => item.outcomeKey === binding.outcomeKey)
        if (!isExactProviderDeferral(current, binding, retryAfter, holderId)) throw error
      }
    }
    return deferGoal({ databaseUrl, outcomeId, retryAfter })
  }

  async function renewOutcomeLease(outcome) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return null
    return renewQueue({
      databaseUrl,
      ...queueBinding(outcome),
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      campaignWindowId,
      processIdentity,
      checkpointProofProvider,
      now: now(),
    })
  }

  async function bindWorkOrder(outcome, activeWorkOrderId, expectedWorkOrderStatus = "active") {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    if (!Number.isSafeInteger(activeWorkOrderId) || activeWorkOrderId <= 0) {
      wall("Projected Work Order identity is invalid", "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL")
    }
    if (binding.activeWorkOrderId !== undefined) {
      if (binding.activeWorkOrderId !== activeWorkOrderId) {
        wall(
          "Persisted queue Work Order binding does not match the canonical projection",
          "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
        )
      }
      const verified = await verifyQueueWorkOrder({
        databaseUrl,
        ...binding,
        activeWorkOrderId,
        expectedWorkOrderStatus,
        now: now(),
      })
      if (!isExactLiveBinding(verified, binding, activeWorkOrderId)) {
        wall(
          "Persisted queue Work Order binding did not match the live queue fence",
          "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
        )
      }
      return withPersistedBinding(outcome, verified)
    }
    const bound = await bindQueueWorkOrder({
      databaseUrl,
      ...binding,
      activeWorkOrderId,
      now: now(),
    })
    if (!isExactLiveBinding(bound, binding, activeWorkOrderId)) {
      wall(
        "Initial queue Work Order binding did not return its exact live fence",
        "HERMES_OUTCOME_QUEUE_WORK_ORDER_WALL",
      )
    }
    return withPersistedBinding(outcome, bound)
  }

  async function refreshOutcome(outcome, terminalReplay = null) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    const refreshed = await acquire({
      databaseUrl,
      userId: binding.userId,
      acquisitionKey: binding.acquisitionKey,
      leaseHolder: holderId,
      leaseToken: binding.leaseToken,
      executionBinding: binding.executionBinding,
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      campaignWindowId,
      processIdentity,
      checkpointProofProvider,
      now: now(),
    })
    if (refreshed?.outcome && refreshed.acquired) {
      const governedOutcome = governedQueueOutcome(refreshed.outcome, outcome)
      const decision = evaluateOutcomePolicy({
        outcome: governedOutcome,
        actor: "bsvalues",
        repository: "bsvalues/terragroq",
        enabled: true,
        standingAuthority: true,
      })
      if (!decision.allowed) {
        await transitionQueue({
          databaseUrl,
          userId: refreshed.outcome.userId,
          outcomeKey: refreshed.outcome.outcomeKey,
          fromState: "active",
          toState: "blocked",
          expectedVersion: Number(refreshed.outcome.version),
          executionBinding: refreshed.outcome.executionBinding,
          leaseToken: refreshed.outcome.leaseToken,
          fencingToken: Number(refreshed.outcome.fencingToken),
          lifecycleReason: `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`,
          now: now(),
        })
        wall(decision.reasonCode, `HERMES_OUTCOME_QUEUE_POLICY_${decision.reasonCode}`)
      }
      return withPersistedBinding(governedOutcome, refreshed.outcome)
    }
    const current = refreshed?.outcome ?? (await readQueue({
      databaseUrl,
      userId: binding.userId,
    })).find((item) => item.outcomeKey === binding.outcomeKey)
    if (isExactTerminalSettlement(current, binding, terminalReplay)) {
      // Preserve the pre-settlement capability so the settlement API can verify its idempotent replay.
      return outcome
    }
    wall(
      refreshed?.reason ?? "Queue binding could not be refreshed",
      "HERMES_OUTCOME_QUEUE_REFRESH_WALL",
    )
  }

  async function resumeAfterOwnerDecision(outcome, proof) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    const expectedLifecycleReason = proof?.expectedNextState
    if (typeof expectedLifecycleReason !== "string"
      || !/^[A-Z][A-Z0-9_]{1,79}$/.test(expectedLifecycleReason)) {
      wall(
        "Owner-decision proof did not preserve its exact next state",
        "HERMES_OUTCOME_QUEUE_OWNER_DECISION_STATE_WALL",
      )
    }
    const resumeAt = now()
    const resumed = await resumeQueue({
      databaseUrl,
      userId: binding.userId,
      outcomeKey: binding.outcomeKey,
      expectedVersion: binding.expectedVersion + 1,
      executionBinding: binding.executionBinding,
      acquisitionKey: binding.acquisitionKey,
      fencingToken: binding.fencingToken,
      ownerDecisionId: proof?.decisionId,
      expectedLifecycleReason,
      leaseHolder: holderId,
      leaseToken: binding.leaseToken,
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      now: resumeAt,
    })
    if (!isExactOwnerDecisionResume(resumed, binding, holderId, resumeAt)) {
      wall(
        "Owner-decision resume did not return its exact fresh queue fence",
        "HERMES_OUTCOME_QUEUE_OWNER_DECISION_RESUME_WALL",
      )
    }
    return withPersistedBinding(outcome, resumed)
  }

  async function resumeAfterValidationRecovery(outcome, proof) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    if (proof?.expectedNextState !== "VALIDATION_REMEDIATION_EXHAUSTED"
      || typeof proof?.proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proof.proofDigest)
      || !Number.isSafeInteger(proof?.recoveryFencingToken)
      || proof.recoveryFencingToken <= 0) {
      wall(
        "Validation recovery proof did not preserve its exact boundary",
        "HERMES_OUTCOME_QUEUE_VALIDATION_RECOVERY_PROOF_WALL",
      )
    }
    const resumeAt = now()
    if (binding.validationRecoveryResumeState) {
      const current = (await readQueue({
        databaseUrl,
        userId: binding.userId,
      })).find((item) => item.outcomeKey === binding.outcomeKey)
      if (isExactPersistedValidationRecovery(current, binding, outcome)) {
        return refreshOutcome(outcome)
      }
    }
    const resumed = await resumeValidationRecoveryQueue({
      databaseUrl,
      userId: binding.userId,
      outcomeKey: binding.outcomeKey,
      expectedVersion: binding.expectedVersion + 1,
      executionBinding: binding.executionBinding,
      acquisitionKey: binding.acquisitionKey,
      fencingToken: binding.fencingToken,
      proofDigest: proof.proofDigest,
      recoveryFencingToken: proof.recoveryFencingToken,
      expectedLifecycleReason: proof.expectedNextState,
      leaseHolder: holderId,
      leaseToken: binding.leaseToken,
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      now: resumeAt,
    })
    if (!isExactValidationRecoveryResume(resumed, binding, holderId, resumeAt)) {
      wall(
        "Validation recovery resume did not return its exact fresh queue fence",
        "HERMES_OUTCOME_QUEUE_VALIDATION_RECOVERY_RESUME_WALL",
      )
    }
    return withPersistedBinding(outcome, resumed)
  }

  async function resumeAfterReviewRecovery(outcome, proof) {
    requireExecutionProofContext()
    if (!outcome?.queueBinding) return outcome
    const binding = queueBinding(outcome)
    if (proof?.expectedNextState !== "REVIEW_REMEDIATION_EXHAUSTED"
      || typeof proof?.proofDigest !== "string" || !/^[0-9a-f]{64}$/.test(proof.proofDigest)
      || !Number.isSafeInteger(proof?.prNumber) || proof.prNumber <= 0
      || typeof proof?.reviewedHeadSha !== "string" || !/^[0-9a-f]{40}$/.test(proof.reviewedHeadSha)
      || typeof proof?.mergeSha !== "string" || !/^[0-9a-f]{40}$/.test(proof.mergeSha)) {
      wall(
        "Review recovery proof did not preserve its exact merged boundary",
        "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_PROOF_WALL",
      )
    }
    const resumeAt = now()
    if (binding.reviewRecoveryResumeState) {
      const verified = await resumeReviewRecoveryQueue({
        databaseUrl,
        userId: binding.userId,
        outcomeKey: binding.outcomeKey,
        expectedVersion: binding.expectedVersion,
        executionBinding: binding.executionBinding,
        acquisitionKey: binding.acquisitionKey,
        fencingToken: binding.fencingToken,
        prNumber: proof.prNumber,
        reviewedHeadSha: proof.reviewedHeadSha,
        mergeSha: proof.mergeSha,
        proofDigest: proof.proofDigest,
        expectedLifecycleReason: proof.expectedNextState,
        leaseHolder: holderId,
        leaseToken: binding.leaseToken,
        leaseDurationMs: QUEUE_LEASE_DURATION_MS,
        persistedLifecycleReason: binding.reviewRecoveryResumeState,
        now: resumeAt,
      })
      if (!isExactPersistedReviewRecovery(verified, binding, outcome)) {
        wall(
          "Persisted review recovery did not match its exact durable proof",
          "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_PROOF_WALL",
        )
      }
      return refreshOutcome(outcome)
    }
    const resumed = await resumeReviewRecoveryQueue({
      databaseUrl,
      userId: binding.userId,
      outcomeKey: binding.outcomeKey,
      expectedVersion: binding.expectedVersion + 1,
      executionBinding: binding.executionBinding,
      acquisitionKey: binding.acquisitionKey,
      fencingToken: binding.fencingToken,
      prNumber: proof.prNumber,
      reviewedHeadSha: proof.reviewedHeadSha,
      mergeSha: proof.mergeSha,
      proofDigest: proof.proofDigest,
      expectedLifecycleReason: proof.expectedNextState,
      leaseHolder: holderId,
      leaseToken: binding.leaseToken,
      leaseDurationMs: QUEUE_LEASE_DURATION_MS,
      now: resumeAt,
    })
    if (!isExactReviewRecoveryResume(resumed, binding, holderId, resumeAt)) {
      wall(
        "Review recovery resume did not return its exact fresh queue fence",
        "HERMES_OUTCOME_QUEUE_REVIEW_RECOVERY_RESUME_WALL",
      )
    }
    return withPersistedBinding(outcome, resumed)
  }

  return {
    selectOutcome,
    completeOutcome,
    terminalizeOutcome,
    deferOutcome,
    renewOutcomeLease,
    bindWorkOrder,
    refreshOutcome,
    resumeAfterOwnerDecision,
    resumeAfterReviewRecovery,
    resumeAfterValidationRecovery,
    consumeRuntimeFindings,
    close: database.close,
  }
}
