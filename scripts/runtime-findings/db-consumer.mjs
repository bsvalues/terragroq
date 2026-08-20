import { createHash } from "node:crypto"

import { classifyProposedAction, deriveRemediationWorkOrder } from "./policy.mjs"

export const RUNTIME_FINDING_CONSUMER_WALL = "HERMES_RUNTIME_FINDING_CONSUMER_WALL"
const REPOSITORY = "bsvalues/terragroq"
const CONTRACT_VERSION = "hermes-work-contract.v1"
const FINDING_EFFECT_KEYS = Object.freeze([
  "changesReviewedPolicy", "competesWithPriority", "destroys", "irreversible",
  "mutatesProductionData", "outsideObjectiveScope", "protectedResource", "releaseOrCutover",
  "spendsMoney", "touchesCredentials", "unresolvedLegalPrivacyOrSecurityRisk",
])

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function exactArray(actual, expected) {
  return Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length
    && actual.every((entry, index) => canonicalJson(entry) === canonicalJson(expected[index]))
}

function count(result) {
  return result?.rows?.length ?? result?.rowCount ?? 0
}

function fail(reasonCode, message = reasonCode) {
  throw Object.assign(new Error(message), { code: RUNTIME_FINDING_CONSUMER_WALL, reasonCode })
}

function safeText(value) {
  return typeof value === "string" && value.trim() !== ""
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) fail("FINDING_TIME_WALL")
  return date
}

function validatorLabels(commands) {
  if (!Array.isArray(commands) || commands.length === 0) return null
  const labels = []
  for (const command of commands) {
    if (!command || typeof command.command !== "string" || !Array.isArray(command.args)
      || !command.args.every((argument) => typeof argument === "string")) return null
    labels.push(`${command.command} ${command.args.join(" ")}`)
  }
  return labels
}

function sourceFinding(row, nowMs) {
  const metadata = row?.findingMetadata
  const checkpoint = row?.checkpointMetadata
  const contract = row?.workContract
  if (!Number.isSafeInteger(Number(row?.sourceFindingEventId))
    || !safeText(row?.userId) || !Number.isSafeInteger(Number(row?.parentWorkOrderId))
    || !safeText(row?.parentWorkOrderRef) || row?.parentAssignee !== "hermes-codex-bridge"
    || !metadata || metadata.schemaVersion !== 1
    || !/^FINDING-[A-Z0-9][A-Z0-9-]{0,119}$/.test(metadata.findingId ?? "")
    || metadata.objectiveWorkOrderId !== row.parentWorkOrderRef
    || !Number.isSafeInteger(metadata.sequence) || metadata.sequence <= 0
    || !safeText(metadata.summary) || !safeText(metadata.task)
    || !Array.isArray(metadata.paths) || metadata.paths.length === 0 || metadata.paths.length > 50
    || new Set(metadata.paths).size !== metadata.paths.length
    || metadata.paths.some((entry) => typeof entry !== "string" || entry.length > 300
      || entry.startsWith("/") || entry.includes("\\") || entry.split("/").includes(".."))
    || !metadata.effects || typeof metadata.effects !== "object" || Array.isArray(metadata.effects)
    || canonicalJson(Object.keys(metadata.effects).sort()) !== canonicalJson(FINDING_EFFECT_KEYS)
    || FINDING_EFFECT_KEYS.some((key) => key !== "destroys" && typeof metadata.effects[key] !== "boolean")
    || !Array.isArray(metadata.effects.destroys) || metadata.effects.destroys.length > 50
    || metadata.effects.destroys.some((target) => !target || typeof target !== "object" || Array.isArray(target)
      || canonicalJson(Object.keys(target).sort()) !== canonicalJson(["path", "verifiedCopyElsewhere"])
      || typeof target.path !== "string" || typeof target.verifiedCopyElsewhere !== "boolean")
    || Number(metadata.sourceCheckpointId) !== Number(row.checkpointId)
    || !checkpoint || checkpoint.payloadDigest !== metadata.sourceCheckpointDigest
    || checkpoint.workOrderRef !== row.parentWorkOrderRef
    || checkpoint.workContractId !== metadata.workContractId
    || checkpoint.workContractDigest !== metadata.workContractDigest
    || checkpoint.workContractVersion !== metadata.workContractVersion
    || checkpoint.workContractRepository !== metadata.workContractRepository
    || checkpoint.workContractLane !== metadata.workContractLane
    || Number(checkpoint.authorizationDecisionId) !== Number(metadata.authorizationDecisionId)
    || Number(checkpoint.implementationGrantId) !== Number(metadata.implementationGrantId)
    || checkpoint.implementationGrantRef !== metadata.implementationGrantRef
    || checkpoint.deliveryAuthorityLevel !== metadata.deliveryAuthorityLevel
    || !exactArray(checkpoint.deliveryAllowedActions, metadata.deliveryAllowedActions)
    || checkpoint.commitAllowed !== metadata.commitAllowed
    || checkpoint.tagAllowed !== metadata.tagAllowed
    || checkpoint.pushAllowed !== metadata.pushAllowed
    || checkpoint.findingsSetDigest !== metadata.findingsSetDigest
    || checkpoint.executionEpochDigest !== metadata.sourceExecutionEpochDigest
    || metadata.sourceCheckpointState !== "CODEX_TURN_COMPLETED"
    || !/^[0-9a-f]{64}$/.test(metadata.payloadDigest ?? "")
    || !contract || contract.id !== metadata.workContractId
    || contract.digest !== metadata.workContractDigest
    || contract.version !== CONTRACT_VERSION || contract.repository !== REPOSITORY
    || contract.lane !== metadata.workContractLane
    || !exactArray(contract.reservations, row.parentAllowedFiles)
    || !exactArray(validatorLabels(contract.validationCommands), row.parentValidators)
    || contract.delivery?.authorityLevel !== metadata.deliveryAuthorityLevel
    || !exactArray(contract.delivery?.allowedActions, metadata.deliveryAllowedActions)
    || contract.delivery?.commitAllowed !== metadata.commitAllowed
    || contract.delivery?.tagAllowed !== metadata.tagAllowed
    || contract.delivery?.pushAllowed !== metadata.pushAllowed
    || Number(row.parentApprovalDecisionId) !== Number(metadata.authorizationDecisionId)
    || row.parentApprovalStatus !== "accepted" || row.parentApprovalAuthority !== "binding"
    || String(row.parentApprovalDecision ?? "").trim().toUpperCase() !== "APPROVE"
    || Number(row.implementationGrantId) !== Number(metadata.implementationGrantId)
    || row.implementationGrantRef !== metadata.implementationGrantRef
    || row.implementationGrantStatus !== "active" || row.implementationGrantRevokedAt != null
    || row.implementationGrantAuthorityLevel !== metadata.deliveryAuthorityLevel
    || row.implementationGrantGrantedTo !== "operator"
    || row.implementationGrantScope !== row.parentWorkOrderRef
    || !exactArray(row.implementationGrantAllowedActions, metadata.deliveryAllowedActions)
    || !Array.isArray(row.implementationGrantBlockedActions)
    || row.implementationGrantBlockedActions.includes("implement")
    || row.parentStatus === "aborted" || row.parentAuthorityGranted !== metadata.deliveryAuthorityLevel
    || row.parentAuthorityLevel !== metadata.deliveryAuthorityLevel
    || Number(row.parentAuthorityGrantId) !== Number(row.implementationGrantId)
    || row.parentCommitAllowed !== metadata.commitAllowed
    || row.parentTagAllowed !== metadata.tagAllowed
    || row.parentPushAllowed !== metadata.pushAllowed) {
    fail("FINDING_SOURCE_LINEAGE_WALL")
  }
  const expiresAt = row.implementationGrantExpiresAt == null ? null : normalizeDate(row.implementationGrantExpiresAt)
  if (expiresAt && expiresAt.getTime() <= nowMs) fail("FINDING_AUTHORITY_EXPIRED")
  return {
    sourceFindingEventId: Number(row.sourceFindingEventId),
    sourceUserId: row.userId,
    sourceWorkOrderRowId: String(row.parentWorkOrderId),
    sourcePayloadDigest: digest(metadata),
    findingId: metadata.findingId,
    objectiveWorkOrderId: row.parentWorkOrderRef,
    sequence: metadata.sequence,
    issueNumber: metadata.projectionIssueNumber,
    summary: metadata.summary,
    task: metadata.task,
    paths: metadata.paths,
    effects: metadata.effects,
    sourceCheckpointId: Number(row.checkpointId),
    sourceCheckpointDigest: metadata.sourceCheckpointDigest,
    contractId: contract.id,
    contractDigest: contract.digest,
    contractVersion: contract.version,
    contractRepository: contract.repository,
    contractLane: contract.lane,
    authorizationDecisionId: Number(metadata.authorizationDecisionId),
    implementationGrantId: Number(metadata.implementationGrantId),
    projectionCompletionOwned: metadata.projectionCompletionOwned,
    deliveryAuthorityLevel: metadata.deliveryAuthorityLevel,
    deliveryAllowedActions: metadata.deliveryAllowedActions,
    commitAllowed: metadata.commitAllowed,
    tagAllowed: metadata.tagAllowed,
    pushAllowed: metadata.pushAllowed,
  }
}

function parentObjective(row, finding) {
  return {
    workOrderId: row.parentWorkOrderRef,
    grantRef: row.implementationGrantRef,
    authority: "APPROVED",
    grantStatus: row.implementationGrantStatus,
    grantExpiresAt: row.implementationGrantExpiresAt,
    allowedPaths: row.parentAllowedFiles,
    forbiddenPaths: row.parentForbiddenFiles,
    requiredValidation: row.parentValidators,
    riskClass: row.parentRiskClass ?? "R1",
    agent: "codex",
    commitAllowed: finding.commitAllowed,
    tagAllowed: finding.tagAllowed,
    pushAllowed: finding.pushAllowed,
  }
}

function childIdentity(row, order) {
  const eventId = order.sourceFindingEventId
  const outcomeKey = `runtime-finding:${eventId}:${order.sourcePayloadDigest}`
  const contractBody = {
    version: CONTRACT_VERSION,
    id: `${order.contractId}:finding:${order.findingId}`,
    repository: order.contractRepository,
    lane: order.contractLane,
    reservations: [...order.allowedPaths],
    validationCommands: row.workContract.validationCommands.map((entry) => ({
      ...entry,
      args: [...entry.args],
      ...(entry.env ? { env: { ...entry.env } } : {}),
    })),
    delivery: {
      authorityLevel: order.deliveryAuthorityLevel,
      allowedActions: [...order.deliveryAllowedActions],
      commitAllowed: order.commitAllowed,
      tagAllowed: order.tagAllowed,
      pushAllowed: order.pushAllowed,
    },
  }
  return {
    workOrderRef: order.workOrderId,
    goalRef: `GOAL-RUNTIME-FINDING-${eventId}`,
    outcomeKey,
    decisionRef: `DEC-RUNTIME-FINDING-${eventId}`,
    grantRef: `RUNTIME-FINDING-IMPL-GRANT-${eventId}`,
    receiptKey: `runtime-finding.derive:${eventId}`,
    workContract: { ...contractBody, digest: digest(contractBody) },
  }
}

function settlementMetadata({ finding, classification, identity, artifacts = {} }) {
  const canonical = identity ? {
    sourceFindingEventId: finding.sourceFindingEventId,
    sourceUserId: finding.sourceUserId,
    findingId: finding.findingId,
    objectiveWorkOrderId: finding.objectiveWorkOrderId,
    childWorkOrderRef: identity.workOrderRef,
    issueNumber: finding.issueNumber,
    allowedPaths: identity.workContract.reservations,
    requiredValidation: validatorLabels(identity.workContract.validationCommands),
    task: artifacts.task,
    grantRef: artifacts.parentGrantRef,
    contractId: finding.contractId,
    contractDigest: finding.contractDigest,
    authorizationDecisionId: finding.authorizationDecisionId,
    implementationGrantId: finding.implementationGrantId,
    projectionCompletionOwned: finding.projectionCompletionOwned,
    sourceCheckpointId: finding.sourceCheckpointId,
    sourceCheckpointDigest: finding.sourceCheckpointDigest,
    contractVersion: finding.contractVersion,
    contractRepository: finding.contractRepository,
    contractLane: finding.contractLane,
    deliveryAuthorityLevel: finding.deliveryAuthorityLevel,
    deliveryAllowedActions: finding.deliveryAllowedActions,
    commitAllowed: finding.commitAllowed,
    tagAllowed: finding.tagAllowed,
    pushAllowed: finding.pushAllowed,
  } : {
    sourceFindingEventId: finding.sourceFindingEventId,
    sourceUserId: finding.sourceUserId,
    findingId: finding.findingId,
    objectiveWorkOrderId: finding.objectiveWorkOrderId,
    issueNumber: finding.issueNumber,
    gate: classification.gate,
    gates: classification.gates,
    reason: classification.reason,
    contractId: finding.contractId,
    contractDigest: finding.contractDigest,
    authorizationDecisionId: finding.authorizationDecisionId,
    implementationGrantId: finding.implementationGrantId,
    grantRef: artifacts.parentGrantRef,
    projectionCompletionOwned: finding.projectionCompletionOwned,
    sourceCheckpointId: finding.sourceCheckpointId,
    sourceCheckpointDigest: finding.sourceCheckpointDigest,
    contractVersion: finding.contractVersion,
    contractRepository: finding.contractRepository,
    contractLane: finding.contractLane,
    deliveryAuthorityLevel: finding.deliveryAuthorityLevel,
    deliveryAllowedActions: finding.deliveryAllowedActions,
    commitAllowed: finding.commitAllowed,
    tagAllowed: finding.tagAllowed,
    pushAllowed: finding.pushAllowed,
  }
  return {
    ...canonical,
    ...(identity ? {
      childWorkOrderRef: identity.workOrderRef,
      childGoalRef: identity.goalRef,
      childOutcomeKey: identity.outcomeKey,
      childDecisionRef: identity.decisionRef,
      childImplementationGrantRef: identity.grantRef,
      childWorkContract: identity.workContract,
      authorizationReceiptKey: identity.receiptKey,
    } : {}),
    ...artifacts,
    payloadDigest: digest(canonical),
  }
}

function exactSettlement(row, expectedType, expectedMetadata) {
  if (!row.settlementId) return false
  if (row.settlementCount !== undefined && Number(row.settlementCount) !== 1) return false
  if (row.settlementEventType !== expectedType
    || canonicalJson(row.settlementMetadata) !== canonicalJson(expectedMetadata)) {
    fail("FINDING_SETTLEMENT_REPLAY_WALL")
  }
  return true
}

async function insertOrdinary(client, row, finding, order, classification, at) {
  const identity = childIdentity(row, order)
  const existing = await client.query(
    `SELECT child.id AS "workOrderId", goal.id AS "goalId", queue.id AS "queueId",
            approval.id AS "decisionId", grant.id AS "grantId", receipt.id AS "receiptId",
            child.ref AS "workOrderRef", goal.ref AS "goalRef", queue."outcomeKey",
            approval.ref AS "decisionRef", grant.ref AS "grantRef",
            child."allowedFiles", child.validators, child."authorityGrantId",
            receipt."requestBinding", receipt."resultBinding"
       FROM work_order child
       JOIN goal ON goal."userId" = child."userId" AND goal."linkedWorkOrderId" = child.id
       JOIN outcome_queue_item queue ON queue."userId" = child."userId" AND queue."goalId" = goal.id
       JOIN decision approval ON approval.id = queue."approvalDecisionId" AND approval."userId" = child."userId"
       JOIN authority_grant grant ON grant.id = child."authorityGrantId" AND grant."userId" = child."userId"
       JOIN outcome_queue_mutation_receipt receipt
         ON receipt."userId" = child."userId" AND receipt."outcomeKey" = queue."outcomeKey"
        AND receipt."idempotencyKey" = $3 AND receipt.operation = 'runtime_finding.derive'
      WHERE child."userId" = $1 AND child.ref = $2
      FOR UPDATE OF child, goal, queue, approval, grant, receipt`,
    [finding.sourceUserId, identity.workOrderRef, identity.receiptKey],
  )
  if (existing.rows.length > 0) fail("FINDING_CHILD_REPLAY_CARDINALITY_WALL")

  const approval = await client.query(
    `INSERT INTO decision
      ("userId", ref, title, context, decision, rationale, consequences, status, authority,
       owner, scope, evidence, tags, locked, "decidedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'APPROVE', $5, $6, 'accepted', 'binding', 'WilliamOS', $7,
       $8::text[], $9::text[], true, $10, $10, $10) RETURNING id`,
    [finding.sourceUserId, identity.decisionRef, `Authorize ${identity.workOrderRef}`,
      `Mechanically narrowed from ${finding.objectiveWorkOrderId} finding ${finding.findingId}.`,
      "Inherited bounded implementation authority; no new owner choice was created.",
      "Only the exact child outcome and registered validation contract are authorized.",
      identity.outcomeKey, [`runtime-finding:${finding.sourceFindingEventId}`],
      ["RUNTIME_FINDING_DERIVED_AUTHORIZATION"], at],
  )
  if (count(approval) !== 1) fail("FINDING_CHILD_DECISION_WALL")
  const decisionId = Number(approval.rows[0].id)

  const child = await client.query(
    `INSERT INTO work_order
      ("userId", ref, title, description, goal, loop, scope, "nonGoals", "allowedFiles",
       "forbiddenFiles", validators, "stopConditions", lane, status, priority, assignee,
       "authorityLevel", "authorityGranted", agent, "approvedBy", "approvedAt",
       "linkedDecisionId", "commitAllowed", "tagAllowed", "pushAllowed", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10::text[],$11::text[],$12::text[],
       $13,'approved',$14,'hermes-codex-bridge',$15,$15,'codex','williamos-runtime-policy',$16,
       $17,$18,$19,$20,$16,$16) RETURNING id`,
    [finding.sourceUserId, identity.workOrderRef, order.task,
      `Derived from ${finding.objectiveWorkOrderId} finding ${finding.findingId}.`,
      row.parentGoal, row.parentLoop, row.parentScope, row.parentNonGoals ?? [], order.allowedPaths,
      row.parentForbiddenFiles ?? [], row.parentValidators, row.parentStopConditions ?? [],
      finding.contractLane, row.parentPriority ?? "medium", finding.deliveryAuthorityLevel,
      at, decisionId, finding.commitAllowed, finding.tagAllowed, finding.pushAllowed],
  )
  if (count(child) !== 1) fail("FINDING_CHILD_WORK_ORDER_WALL")
  const workOrderId = Number(child.rows[0].id)

  const grant = await client.query(
    `INSERT INTO authority_grant
      ("userId", ref, "workOrderId", "grantedBy", "grantedTo", "authorityLevel", scope,
       "allowedActions", "blockedActions", reason, status, "expiresAt", "createdAt")
     VALUES ($1,$2,$3,'williamos-runtime-policy','operator',$4,$5,$6::text[],$7::text[],
       $8,'active',$9,$10) RETURNING id`,
    [finding.sourceUserId, identity.grantRef, workOrderId, finding.deliveryAuthorityLevel,
      identity.workOrderRef, finding.deliveryAllowedActions, row.implementationGrantBlockedActions,
      `Narrowed from ${row.implementationGrantRef}; finding ${finding.findingId}.`,
      row.implementationGrantExpiresAt, at],
  )
  if (count(grant) !== 1) fail("FINDING_CHILD_GRANT_WALL")
  const grantId = Number(grant.rows[0].id)
  const bound = await client.query(
    `UPDATE work_order SET "authorityGrantId" = $2, "updatedAt" = $3
      WHERE id = $1 AND "authorityGrantId" IS NULL RETURNING id`, [workOrderId, grantId, at],
  )
  if (count(bound) !== 1) fail("FINDING_CHILD_GRANT_BINDING_WALL")

  const goal = await client.query(
    `INSERT INTO goal
      ("userId", ref, command, lane, mode, risk, authority, verdict, rationale, "matchedRules",
       "recommendedMove", "requiresApproval", "linkedWorkOrderId", status, "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,'implementation',$5,$6,'allow',$7,$8::text[],$9,false,$10,'classified',$11,$11)
     RETURNING id`,
    [finding.sourceUserId, identity.goalRef, order.task, finding.contractLane, order.riskClass,
      finding.deliveryAuthorityLevel, "Mechanically derived ordinary finding.",
      ["runtime_finding.derive"], "Execute through the normal HERMES/AEGIS queue.", workOrderId, at],
  )
  if (count(goal) !== 1) fail("FINDING_CHILD_GOAL_WALL")
  const goalId = Number(goal.rows[0].id)
  const queue = await client.query(
    `INSERT INTO outcome_queue_item
      ("userId", "outcomeKey", "goalId", "goalRef", title, objective, "queueOrder",
       "dependencyKeys", "riskClass", "approvalState", "approvedBy", "approvedAt",
       "approvalDecisionId", "authorityState", "authorityLevel", "authorityGrantRef",
       "authoritySubject", "authorityAction", "lifecycleState", "activeWorkOrderId",
       version, "suggestedAt", "activatedAt", "createdAt", "updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,ARRAY[]::text[],$8,'approved','williamos-runtime-policy',$9,
       $10,'matched',$11,$12,'operator','outcome:execute','approved',$13,0,$9,$9,$9,$9) RETURNING id`,
    [finding.sourceUserId, identity.outcomeKey, goalId, identity.goalRef, order.task, order.task,
      finding.sourceFindingEventId, order.riskClass, at, decisionId, finding.deliveryAuthorityLevel,
      identity.grantRef, workOrderId],
  )
  if (count(queue) !== 1) fail("FINDING_CHILD_QUEUE_WALL")
  const queueId = Number(queue.rows[0].id)
  const requestBinding = {
    sourceFindingEventId: finding.sourceFindingEventId,
    sourcePayloadDigest: finding.sourcePayloadDigest,
    sourceCheckpointId: finding.sourceCheckpointId,
    sourceCheckpointDigest: finding.sourceCheckpointDigest,
    parentWorkOrderId: Number(row.parentWorkOrderId),
    parentWorkOrderRef: finding.objectiveWorkOrderId,
    parentContractId: finding.contractId,
    parentContractDigest: finding.contractDigest,
    parentAuthorizationDecisionId: finding.authorizationDecisionId,
    parentImplementationGrantId: finding.implementationGrantId,
  }
  const resultBinding = {
    workOrderId, workOrderRef: identity.workOrderRef, goalId, goalRef: identity.goalRef,
    queueId, outcomeKey: identity.outcomeKey, approvalDecisionId: decisionId,
    implementationGrantId: grantId, implementationGrantRef: identity.grantRef,
    workContract: identity.workContract,
  }
  const requestHash = digest(requestBinding)
  const receipt = await client.query(
    `INSERT INTO outcome_queue_mutation_receipt
      ("userId", "idempotencyKey", operation, "outcomeKey", "requestHash", "requestBinding",
       "resultBinding", "createdAt") VALUES ($1,$2,'runtime_finding.derive',$3,$4,$5::jsonb,$6::jsonb,$7)
     RETURNING id`,
    [finding.sourceUserId, identity.receiptKey, identity.outcomeKey, requestHash,
      JSON.stringify(requestBinding), JSON.stringify(resultBinding), at],
  )
  if (count(receipt) !== 1) fail("FINDING_CHILD_RECEIPT_WALL")
  const artifacts = { workOrderId, goalId, queueId, decisionId, grantId, receiptId: Number(receipt.rows[0].id) }
  const metadata = settlementMetadata({ finding, classification, identity, artifacts: {
    ...artifacts, task: order.task, parentGrantRef: row.implementationGrantRef,
  } })
  const settled = await client.query(
    `INSERT INTO governance_event
      ("userId", "eventType", "entityType", "entityId", actor, reason, metadata, "createdAt")
     VALUES ($1,'RUNTIME_FINDING_DERIVED','work_order',$2,'hermes-runtime-finding-consumer',$3,$4::jsonb,$5)
     RETURNING id`, [finding.sourceUserId, String(workOrderId), order.task, JSON.stringify(metadata), at],
  )
  if (count(settled) !== 1) fail("FINDING_SETTLEMENT_WALL")
  return { disposition: "DERIVED", findingId: finding.findingId, ...artifacts, ...identity }
}

async function replayOrdinary(client, row, finding, order, classification) {
  const identity = childIdentity(row, order)
  const existing = await client.query(
    `SELECT child.id AS "workOrderId", goal.id AS "goalId", queue.id AS "queueId",
            approval.id AS "decisionId", grant.id AS "grantId", receipt.id AS "receiptId",
            child.ref AS "workOrderRef", child.status AS "workOrderStatus",
            child."allowedFiles", child.validators, child."authorityGrantId",
            goal.ref AS "goalRef", goal.status AS "goalStatus", goal."linkedWorkOrderId",
            queue."outcomeKey", queue."approvalState", queue."authorityState",
            queue."lifecycleState", queue."activeWorkOrderId", queue."approvalDecisionId",
            queue."authorityGrantRef", approval.ref AS "decisionRef",
            approval.status AS "decisionStatus", approval.authority AS "decisionAuthority",
            approval.decision AS "decisionChoice", approval.scope AS "decisionScope",
            grant.ref AS "grantRef", grant.status AS "grantStatus", grant."revokedAt" AS "grantRevokedAt",
            grant."authorityLevel" AS "grantAuthorityLevel", grant.scope AS "grantScope",
            grant."allowedActions" AS "grantAllowedActions", grant."blockedActions" AS "grantBlockedActions",
            receipt."requestHash", receipt."requestBinding", receipt."resultBinding"
       FROM work_order child
       JOIN goal ON goal."userId" = child."userId" AND goal."linkedWorkOrderId" = child.id
       JOIN outcome_queue_item queue ON queue."userId" = child."userId" AND queue."goalId" = goal.id
       JOIN decision approval ON approval.id = queue."approvalDecisionId" AND approval."userId" = child."userId"
       JOIN authority_grant grant ON grant.id = child."authorityGrantId" AND grant."userId" = child."userId"
       JOIN outcome_queue_mutation_receipt receipt
         ON receipt."userId" = child."userId" AND receipt."outcomeKey" = queue."outcomeKey"
        AND receipt."idempotencyKey" = $3 AND receipt.operation = 'runtime_finding.derive'
      WHERE child."userId" = $1 AND child.ref = $2
      FOR UPDATE OF child, goal, queue, approval, grant, receipt`,
    [finding.sourceUserId, identity.workOrderRef, identity.receiptKey],
  )
  if (existing.rows.length !== 1) fail("FINDING_CHILD_REPLAY_CARDINALITY_WALL")
  const artifact = existing.rows[0]
  const ids = ["workOrderId", "goalId", "queueId", "decisionId", "grantId", "receiptId"]
  if (ids.some((field) => !Number.isSafeInteger(Number(artifact[field])) || Number(artifact[field]) <= 0)
    || artifact.workOrderRef !== identity.workOrderRef || artifact.goalRef !== identity.goalRef
    || artifact.outcomeKey !== identity.outcomeKey || artifact.decisionRef !== identity.decisionRef
    || artifact.grantRef !== identity.grantRef || artifact.workOrderStatus !== "approved"
    || artifact.goalStatus !== "classified" || artifact.approvalState !== "approved"
    || artifact.authorityState !== "matched" || artifact.lifecycleState !== "approved"
    || artifact.decisionStatus !== "accepted" || artifact.decisionAuthority !== "binding"
    || String(artifact.decisionChoice ?? "").trim().toUpperCase() !== "APPROVE"
    || artifact.decisionScope !== identity.outcomeKey || artifact.grantStatus !== "active"
    || artifact.grantRevokedAt != null || artifact.grantAuthorityLevel !== finding.deliveryAuthorityLevel
    || artifact.grantScope !== identity.workOrderRef
    || !exactArray(artifact.allowedFiles, order.allowedPaths)
    || !exactArray(artifact.validators, row.parentValidators)
    || !exactArray(artifact.grantAllowedActions, finding.deliveryAllowedActions)
    || !exactArray(artifact.grantBlockedActions, row.implementationGrantBlockedActions)
    || Number(artifact.authorityGrantId) !== Number(artifact.grantId)
    || Number(artifact.linkedWorkOrderId) !== Number(artifact.workOrderId)
    || Number(artifact.activeWorkOrderId) !== Number(artifact.workOrderId)
    || Number(artifact.approvalDecisionId) !== Number(artifact.decisionId)
    || artifact.authorityGrantRef !== identity.grantRef) {
    fail("FINDING_CHILD_REPLAY_ARTIFACT_WALL")
  }
  const requestBinding = {
    sourceFindingEventId: finding.sourceFindingEventId,
    sourcePayloadDigest: finding.sourcePayloadDigest,
    sourceCheckpointId: finding.sourceCheckpointId,
    sourceCheckpointDigest: finding.sourceCheckpointDigest,
    parentWorkOrderId: Number(row.parentWorkOrderId),
    parentWorkOrderRef: finding.objectiveWorkOrderId,
    parentContractId: finding.contractId,
    parentContractDigest: finding.contractDigest,
    parentAuthorizationDecisionId: finding.authorizationDecisionId,
    parentImplementationGrantId: finding.implementationGrantId,
  }
  const resultBinding = {
    workOrderId: Number(artifact.workOrderId), workOrderRef: identity.workOrderRef,
    goalId: Number(artifact.goalId), goalRef: identity.goalRef,
    queueId: Number(artifact.queueId), outcomeKey: identity.outcomeKey,
    approvalDecisionId: Number(artifact.decisionId), implementationGrantId: Number(artifact.grantId),
    implementationGrantRef: identity.grantRef, workContract: identity.workContract,
  }
  if (artifact.requestHash !== digest(requestBinding)
    || canonicalJson(artifact.requestBinding) !== canonicalJson(requestBinding)
    || canonicalJson(artifact.resultBinding) !== canonicalJson(resultBinding)) {
    fail("FINDING_CHILD_REPLAY_RECEIPT_WALL")
  }
  const artifacts = {
    workOrderId: Number(artifact.workOrderId), goalId: Number(artifact.goalId),
    queueId: Number(artifact.queueId), decisionId: Number(artifact.decisionId),
    grantId: Number(artifact.grantId), receiptId: Number(artifact.receiptId),
  }
  const metadata = settlementMetadata({ finding, classification, identity, artifacts: {
    ...artifacts, task: order.task, parentGrantRef: row.implementationGrantRef,
  } })
  exactSettlement(row, "RUNTIME_FINDING_DERIVED", metadata)
  return { disposition: "DERIVED", findingId: finding.findingId, replayed: true, ...artifacts, ...identity }
}

async function insertGate(client, row, finding, classification, at) {
  const metadata = settlementMetadata({ finding, classification, artifacts: {
    parentGrantRef: row.implementationGrantRef,
  } })
  if (exactSettlement(row, "RUNTIME_FINDING_OWNER_GATED", metadata)) {
    return { disposition: "OWNER_GATED", findingId: finding.findingId, replayed: true }
  }
  const settled = await client.query(
    `INSERT INTO governance_event
      ("userId", "eventType", "entityType", "entityId", actor, reason, metadata, "createdAt")
     VALUES ($1,'RUNTIME_FINDING_OWNER_GATED','work_order',$2,'hermes-runtime-finding-consumer',$3,$4::jsonb,$5)
     RETURNING id`, [finding.sourceUserId, String(row.parentWorkOrderId), classification.reason,
      JSON.stringify(metadata), at],
  )
  if (count(settled) !== 1) fail("FINDING_SETTLEMENT_WALL")
  return { disposition: "OWNER_GATED", findingId: finding.findingId, replayed: false }
}

/**
 * @param {{
 *   withPool: (action: (pool: any) => Promise<any>) => Promise<any>,
 *   now?: () => Date,
 *   maxFindings?: number,
 * }} options
 */
export function createRuntimeFindingDbConsumer({ withPool, now = () => new Date(), maxFindings = 20 } = /** @type {any} */ ({})) {
  if (typeof withPool !== "function" || typeof now !== "function"
    || !Number.isSafeInteger(maxFindings) || maxFindings <= 0 || maxFindings > 100) {
    fail("FINDING_CONSUMER_INPUT_WALL")
  }
  return async function consumeRuntimeFindings() {
    try {
      return await withPool(async (pool) => {
        const client = typeof pool.connect === "function" ? await pool.connect() : pool
        if (!client || typeof client.query !== "function") fail("FINDING_CONSUMER_POOL_WALL")
        try {
          await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE")
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["hermes-runtime-finding-consumer:v1"])
          const sources = await client.query(
            `SELECT finding.id AS "sourceFindingEventId", finding."userId", finding.metadata AS "findingMetadata",
                    parent.id AS "parentWorkOrderId", parent.ref AS "parentWorkOrderRef",
                    parent.assignee AS "parentAssignee", parent.status AS "parentStatus",
                    parent.goal AS "parentGoal", parent.loop AS "parentLoop", parent.scope AS "parentScope",
                    parent."nonGoals" AS "parentNonGoals", parent."allowedFiles" AS "parentAllowedFiles",
                    parent."forbiddenFiles" AS "parentForbiddenFiles", parent.validators AS "parentValidators",
                    parent."stopConditions" AS "parentStopConditions", parent.priority AS "parentPriority",
                    parent."authorityLevel" AS "parentAuthorityLevel",
                    parent."authorityGranted" AS "parentAuthorityGranted",
                    parent."authorityGrantId" AS "parentAuthorityGrantId",
                    parent."commitAllowed" AS "parentCommitAllowed", parent."tagAllowed" AS "parentTagAllowed",
                    parent."pushAllowed" AS "parentPushAllowed", checkpoint.id AS "checkpointId",
                    checkpoint.metadata AS "checkpointMetadata", receipt."resultBinding"->'workContract' AS "workContract",
                    approval.id AS "parentApprovalDecisionId", approval.status AS "parentApprovalStatus",
                    approval.authority AS "parentApprovalAuthority", approval.decision AS "parentApprovalDecision",
                    grant.id AS "implementationGrantId", grant.ref AS "implementationGrantRef",
                    grant.status AS "implementationGrantStatus", grant."revokedAt" AS "implementationGrantRevokedAt",
                    grant."expiresAt" AS "implementationGrantExpiresAt",
                    grant."authorityLevel" AS "implementationGrantAuthorityLevel",
                    grant."grantedTo" AS "implementationGrantGrantedTo", grant.scope AS "implementationGrantScope",
                    grant."allowedActions" AS "implementationGrantAllowedActions",
                    grant."blockedActions" AS "implementationGrantBlockedActions",
                    settlement.id AS "settlementId", settlement."eventType" AS "settlementEventType",
                    settlement.metadata AS "settlementMetadata", settlement."settlementCount"
               FROM governance_event finding
               JOIN work_order parent ON parent."userId" = finding."userId"
                 AND parent.id::text = finding."entityId"::text
               JOIN governance_event checkpoint ON checkpoint."userId" = finding."userId"
                 AND checkpoint.id::text = finding.metadata->>'sourceCheckpointId'
                 AND checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                 AND checkpoint.actor = 'hermes-codex-bridge'
               JOIN outcome_queue_item parent_queue ON parent_queue."userId" = parent."userId"
                 AND parent_queue."activeWorkOrderId" = parent.id
               JOIN outcome_queue_mutation_receipt receipt ON receipt."userId" = parent_queue."userId"
                 AND receipt."outcomeKey" = parent_queue."outcomeKey"
                 AND receipt."resultBinding"->'workContract'->>'id' = finding.metadata->>'workContractId'
                 AND receipt."resultBinding"->'workContract'->>'digest' = finding.metadata->>'workContractDigest'
               JOIN decision approval ON approval."userId" = parent."userId"
                 AND approval.id::text = finding.metadata->>'authorizationDecisionId'
               JOIN authority_grant grant ON grant."userId" = parent."userId"
                 AND grant.id::text = finding.metadata->>'implementationGrantId'
                 AND grant.ref = finding.metadata->>'implementationGrantRef'
               LEFT JOIN LATERAL (
                 SELECT settled.id, settled."eventType", settled.metadata,
                        count(*) OVER ()::integer AS "settlementCount"
                   FROM governance_event settled
                  WHERE settled."userId" = finding."userId"
                    AND settled."eventType" IN ('RUNTIME_FINDING_DERIVED','RUNTIME_FINDING_OWNER_GATED')
                    AND settled.metadata->>'sourceFindingEventId' = finding.id::text
                  ORDER BY settled.id LIMIT 2
               ) settlement ON true
              WHERE finding."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
                AND finding."entityType" = 'work_order' AND finding.actor = 'hermes'
              ORDER BY (settlement.id IS NULL) DESC, finding.id ASC
              LIMIT $1 FOR UPDATE OF finding, parent, checkpoint, parent_queue, approval, grant`,
            [maxFindings],
          )
          const results = []
          for (const row of sources.rows) {
            const finding = sourceFinding(row, normalizeDate(now()).getTime())
            const result = deriveRemediationWorkOrder({ objective: parentObjective(row, finding), finding,
              now: () => normalizeDate(now()).toISOString() })
            const at = normalizeDate(now())
            const classification = classifyProposedAction({ effects: finding.effects })
            if (result.gate) {
              results.push(await insertGate(client, row, finding, result.gate, at))
            } else if (row.settlementId) {
              results.push(await replayOrdinary(client, row, finding, result.dispatch, classification))
            } else {
              results.push(await insertOrdinary(client, row, finding, result.dispatch, classification, at))
            }
          }
          await client.query("COMMIT")
          return {
            status: "RUNTIME_FINDINGS_CONSUMED",
            considered: sources.rows.length,
            derived: results.filter((entry) => entry.disposition === "DERIVED").length,
            gated: results.filter((entry) => entry.disposition === "OWNER_GATED").length,
            queuedChildren: results.filter((entry) => entry.disposition === "DERIVED" && !entry.replayed).length,
            results,
          }
        } catch (error) {
          try { await client.query("ROLLBACK") } catch { /* preserve the primary consumer wall */ }
          if (error?.code === RUNTIME_FINDING_CONSUMER_WALL) throw error
          throw Object.assign(new Error("Runtime finding consumer transaction failed"), {
            code: RUNTIME_FINDING_CONSUMER_WALL,
            reasonCode: error?.code ?? "FINDING_CONSUMER_TRANSACTION_WALL",
            cause: error,
          })
        } finally {
          if (client !== pool) client.release?.()
        }
      })
    } catch (error) {
      if (error?.code === RUNTIME_FINDING_CONSUMER_WALL) throw error
      throw Object.assign(new Error("Runtime finding consumer failed closed"), {
        code: RUNTIME_FINDING_CONSUMER_WALL,
        reasonCode: error?.code ?? "FINDING_CONSUMER_POOL_WALL",
        cause: error,
      })
    }
  }
}
