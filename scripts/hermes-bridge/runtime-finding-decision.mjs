import { createHash } from "node:crypto"

import { createHermesDatabasePool } from "./database-pool.mjs"
import {
  isVerifiedPrimaryDecisionResponse,
  primaryDecisionRequestDigest,
} from "./primary-decision-provenance.mjs"
import {
  HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID,
  isExactIssue911LiveAcceptanceContract,
} from "./work-contract.mjs"

export const RUNTIME_FINDING_DECISION_SOURCE_KIND = "RUNTIME_FINDING"
export const RUNTIME_FINDING_ACTIONABILITY_PROJECTION_ID = "RUNTIME_FINDING_ACTIONABILITY_V1"
export const RUNTIME_FINDING_ACTIONABILITY_VERSION = 1
export const RUNTIME_FINDING_DECISION_PROTECTED_TAG = "RUNTIME_FINDING_OWNER_DECISION"

export function runtimeFindingDecisionScope(gateSettlementEventId) {
  if (!Number.isSafeInteger(gateSettlementEventId) || gateSettlementEventId <= 0) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  return `runtime-finding:${gateSettlementEventId}`
}

export function isProtectedRuntimeFindingDecision(row) {
  const match = /^RUNTIME-FINDING-DECISION-([1-9][0-9]*)$/.exec(String(row?.ref ?? ""))
  if (!match) return false
  const gateSettlementEventId = Number(match[1])
  return Number.isSafeInteger(gateSettlementEventId)
    && row?.locked === true
    && row?.scope === runtimeFindingDecisionScope(gateSettlementEventId)
    && JSON.stringify(row?.tags) === JSON.stringify([
      RUNTIME_FINDING_DECISION_PROTECTED_TAG,
      row?.decision,
    ])
    && ["APPROVE", "DENY"].includes(row?.decision)
}

function wall(code) {
  throw Object.assign(new Error(code), { code })
}

function normalizeQuery(query) {
  if (typeof query === "function") return query
  if (query && typeof query.query === "function") return query.query.bind(query)
  return null
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function sourceDigest(metadata) {
  return sha256(JSON.stringify(metadata))
}

const FINDING_PAYLOAD_KEYS = Object.freeze([
  "schemaVersion", "findingId", "objectiveWorkOrderId", "sequence", "summary", "task", "paths",
  "effects", "sourceCheckpointId", "sourceCheckpointKey", "sourceCheckpointSequence",
  "sourceCheckpointState", "sourceCheckpointDigest", "sourceExecutionEpochDigest", "findingsSetDigest",
  "workContractId", "workContractDigest", "workContractVersion", "workContractRepository",
  "workContractLane", "projectionIssueNumber", "projectionCompletionOwned", "authorizationDecisionId",
  "executionGrantRef", "implementationGrantId", "implementationGrantRef", "deliveryAuthorityLevel",
  "deliveryAllowedActions", "commitAllowed", "tagAllowed", "pushAllowed", "idempotencyKey",
])

function normalizedFindingEffects(effects) {
  if (!effects || typeof effects !== "object" || Array.isArray(effects)
    || !Array.isArray(effects.destroys)) return effects
  return {
    changesReviewedPolicy: effects.changesReviewedPolicy,
    competesWithPriority: effects.competesWithPriority,
    destroys: effects.destroys.map((target) => (
      target && typeof target === "object" && !Array.isArray(target)
        ? { path: target.path, verifiedCopyElsewhere: target.verifiedCopyElsewhere }
        : target
    )),
    irreversible: effects.irreversible,
    mutatesProductionData: effects.mutatesProductionData,
    outsideObjectiveScope: effects.outsideObjectiveScope,
    protectedResource: effects.protectedResource,
    releaseOrCutover: effects.releaseOrCutover,
    spendsMoney: effects.spendsMoney,
    touchesCredentials: effects.touchesCredentials,
    unresolvedLegalPrivacyOrSecurityRisk: effects.unresolvedLegalPrivacyOrSecurityRisk,
  }
}

function exactFindingPayloadDigest(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
    || typeof metadata.payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(metadata.payloadDigest)
    || Object.keys(metadata).length !== FINDING_PAYLOAD_KEYS.length + 1
    || !FINDING_PAYLOAD_KEYS.every((key) => Object.hasOwn(metadata, key))) return null
  const payload = {}
  for (const key of FINDING_PAYLOAD_KEYS) {
    payload[key] = key === "effects" ? normalizedFindingEffects(metadata[key]) : metadata[key]
  }
  return sourceDigest(payload) === metadata.payloadDigest ? metadata.payloadDigest : null
}

const RUNTIME_CHECKPOINT_PAYLOAD_KEYS = Object.freeze([
  "idempotencyKey", "outcomeId", "workOrderRef", "attempt", "checkpointSequence",
  "checkpointState", "checkpointDetail", "prNumber", "commit", "priorHeadRefOid", "headRefOid",
  "mergeSha", "terminalCleanupRecoveryProofDigest", "executionBinding", "acquisitionKey",
  "acquisitionFencingToken", "executionEpochDigest", "findingsSetDigest",
  "workContractId", "workContractDigest", "workContractVersion", "workContractRepository",
  "workContractLane", "authorizationDecisionId", "executionGrantRef", "implementationGrantId",
  "implementationGrantRef", "projectionIssueNumber", "projectionCompletionOwned",
  "deliveryAuthorityLevel", "deliveryAllowedActions", "commitAllowed", "tagAllowed", "pushAllowed",
])

function exactRuntimeCheckpointMetadata(metadata, expectedState) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)
    || metadata.checkpointState !== expectedState
    || typeof metadata.payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(metadata.payloadDigest)) return false
  const payload = {}
  for (const key of RUNTIME_CHECKPOINT_PAYLOAD_KEYS) {
    if (Object.hasOwn(metadata, key)) payload[key] = metadata[key]
  }
  return Object.keys(metadata).length === Object.keys(payload).length + 1
    && sha256(JSON.stringify(payload)) === metadata.payloadDigest
}

const DERIVED_CANONICAL_KEYS = Object.freeze([
  "sourceFindingEventId", "sourceUserId", "findingId", "objectiveWorkOrderId",
  "childWorkOrderRef", "issueNumber", "allowedPaths", "requiredValidation", "task", "grantRef",
  "contractId", "contractDigest", "authorizationDecisionId", "implementationGrantId",
  "projectionCompletionOwned", "sourceCheckpointId", "sourceCheckpointDigest", "contractVersion",
  "contractRepository", "contractLane", "deliveryAuthorityLevel", "deliveryAllowedActions",
  "commitAllowed", "tagAllowed", "pushAllowed",
])
const DERIVED_ARTIFACT_KEYS = Object.freeze([
  "childGoalRef", "childOutcomeKey", "childDecisionRef", "childImplementationGrantRef",
  "childWorkContract", "authorizationReceiptKey", "workOrderId", "goalId", "queueId", "decisionId",
  "grantId", "queueGrantId", "receiptId", "parentGrantRef", "payloadDigest",
])

export function exactDerivedWorkContract(contract) {
  const hasProjection = Boolean(contract && Object.hasOwn(contract, "projection"))
  if (!contract || typeof contract !== "object" || Array.isArray(contract)
    || canonicalJson(Object.keys(contract).sort()) !== canonicalJson([
      "delivery", "digest", "id", "lane", "repository", "reservations",
      "validationCommands", "version", ...(hasProjection ? ["projection"] : []),
    ].sort())) return false
  const validationCommands = Array.isArray(contract.validationCommands)
    ? contract.validationCommands.map((command) => ({
      args: command?.args,
      command: command?.command,
      ...(command && Object.hasOwn(command, "env") && command.env
        && typeof command.env === "object" && !Array.isArray(command.env) ? {
        env: Object.fromEntries(Object.keys(command.env).sort().map((key) => [key, command.env[key]])),
      } : {}),
      timeoutMs: command?.timeoutMs,
    })) : null
  const body = {
    version: contract.version,
    id: contract.id,
    repository: contract.repository,
    lane: contract.lane,
    reservations: contract.reservations,
    validationCommands,
    ...(hasProjection ? { projection: {
      issueNumber: contract.projection?.issueNumber,
      completionOwned: contract.projection?.completionOwned,
    } } : {}),
    delivery: {
      authorityLevel: contract.delivery?.authorityLevel,
      allowedActions: contract.delivery?.allowedActions,
      commitAllowed: contract.delivery?.commitAllowed,
      tagAllowed: contract.delivery?.tagAllowed,
      pushAllowed: contract.delivery?.pushAllowed,
    },
  }
  const computed = sourceDigest(body)
  return typeof contract.digest === "string" && /^[0-9a-f]{64}$/.test(contract.digest)
    && computed === contract.digest
}

function exactDerivedFindingProof(proof, row) {
  const metadata = proof?.metadata
  const sourceMetadata = proof?.sourceMetadata
  const parentSourceMetadata = row.sourceMetadata
  if (!metadata || !sourceMetadata || exactFindingPayloadDigest(sourceMetadata) == null
    || !DERIVED_CANONICAL_KEYS.every((key) => Object.hasOwn(metadata, key))
    || !DERIVED_ARTIFACT_KEYS.every((key) => Object.hasOwn(metadata, key))
    || Object.keys(metadata).length !== DERIVED_CANONICAL_KEYS.length + DERIVED_ARTIFACT_KEYS.length
    || !exactDerivedWorkContract(metadata.childWorkContract)
    || !Number.isSafeInteger(Number(proof.receiptId)) || Number(proof.receiptId) <= 0
    || Number(proof.receiptCount) !== 1 || Number(metadata.receiptId) !== Number(proof.receiptId)) return false
  const canonical = {}
  for (const key of DERIVED_CANONICAL_KEYS) canonical[key] = metadata[key]
  if (sourceDigest(canonical) !== metadata.payloadDigest
    || Number(metadata.sourceFindingEventId) <= 0
    || metadata.sourceUserId !== row.ownerUserId
    || metadata.findingId !== sourceMetadata.findingId
    || metadata.objectiveWorkOrderId !== sourceMetadata.objectiveWorkOrderId
    || Number(metadata.sourceCheckpointId) !== Number(parentSourceMetadata.sourceCheckpointId)
    || metadata.sourceCheckpointDigest !== parentSourceMetadata.sourceCheckpointDigest
    || metadata.contractId !== parentSourceMetadata.workContractId
    || metadata.contractDigest !== parentSourceMetadata.workContractDigest
    || Number(metadata.authorizationDecisionId) !== Number(parentSourceMetadata.authorizationDecisionId)
    || Number(metadata.implementationGrantId) !== Number(parentSourceMetadata.implementationGrantId)
    || metadata.grantRef !== row.authorityGrantRef || metadata.parentGrantRef !== row.authorityGrantRef
    || metadata.contractVersion !== parentSourceMetadata.workContractVersion
    || metadata.contractRepository !== parentSourceMetadata.workContractRepository
    || metadata.contractLane !== parentSourceMetadata.workContractLane
    || metadata.issueNumber !== parentSourceMetadata.projectionIssueNumber
    || metadata.projectionCompletionOwned !== parentSourceMetadata.projectionCompletionOwned
    || metadata.deliveryAuthorityLevel !== parentSourceMetadata.deliveryAuthorityLevel
    || canonicalJson(metadata.deliveryAllowedActions)
      !== canonicalJson(parentSourceMetadata.deliveryAllowedActions)
    || metadata.commitAllowed !== parentSourceMetadata.commitAllowed
    || metadata.tagAllowed !== parentSourceMetadata.tagAllowed
    || metadata.pushAllowed !== parentSourceMetadata.pushAllowed
    || metadata.task !== sourceMetadata.task
    || canonicalJson(metadata.allowedPaths) !== canonicalJson(metadata.childWorkContract.reservations)
    || canonicalJson(metadata.requiredValidation) !== canonicalJson(
      metadata.childWorkContract.validationCommands.map((command) => (
        `${command.command} ${command.args.join(" ")}`
      )))
  ) return false
  const sourceEventId = Number(metadata.sourceFindingEventId)
  const sourceHasProjection = parentSourceMetadata.projectionIssueNumber != null
    || parentSourceMetadata.projectionCompletionOwned != null
  const childHasProjection = Object.hasOwn(metadata.childWorkContract, "projection")
  const reportOnly = canonicalJson(metadata.allowedPaths) === canonicalJson([
      "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
    ])
  const exactIssue911Parent = metadata.contractId === "issue-911-runtime-reliability-evidence.v1"
    || (metadata.contractId === HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID
      && isExactIssue911LiveAcceptanceContract(row.parentWorkContract))
  const expectedChildLane = exactIssue911Parent && reportOnly ? "docs" : metadata.contractLane
  if (!Number.isSafeInteger(sourceEventId) || sourceEventId <= 0
    || metadata.childWorkContract.version !== "hermes-work-contract.v1"
    || metadata.childWorkContract.id !== `runtime-finding.${sourceEventId}.v1`
    || metadata.childWorkContract.repository !== "bsvalues/terragroq"
    || metadata.childWorkContract.lane !== expectedChildLane
    || sourceHasProjection !== childHasProjection
    || (sourceHasProjection && (
      Number(metadata.childWorkContract.projection?.issueNumber) !== Number(parentSourceMetadata.projectionIssueNumber)
      || metadata.childWorkContract.projection?.completionOwned !== parentSourceMetadata.projectionCompletionOwned
    ))
    || metadata.childWorkContract.delivery?.authorityLevel !== parentSourceMetadata.deliveryAuthorityLevel
    || canonicalJson(metadata.childWorkContract.delivery?.allowedActions)
      !== canonicalJson(parentSourceMetadata.deliveryAllowedActions)
    || metadata.childWorkContract.delivery?.commitAllowed !== parentSourceMetadata.commitAllowed
    || metadata.childWorkContract.delivery?.tagAllowed !== parentSourceMetadata.tagAllowed
    || metadata.childWorkContract.delivery?.pushAllowed !== parentSourceMetadata.pushAllowed
    || ["workOrderId", "goalId", "queueId", "decisionId", "grantId", "queueGrantId"]
      .some((key) => !Number.isSafeInteger(Number(metadata[key])) || Number(metadata[key]) <= 0)) return false
  const expectedWorkOrderRef = `${metadata.objectiveWorkOrderId}-R${String(sourceMetadata.sequence).padStart(2, "0")}-F${sourceEventId}`
  const expectedGoalRef = `GOAL-RUNTIME-FINDING-${sourceEventId}`
  const expectedOutcomeKey = `runtime-finding:${sourceEventId}:${sourceMetadata.payloadDigest}`
  const expectedDecisionRef = `DEC-RUNTIME-FINDING-${sourceEventId}`
  const expectedImplementationGrantRef = `RUNTIME-FINDING-IMPL-GRANT-${sourceEventId}`
  const expectedQueueGrantRef = `RUNTIME-FINDING-QUEUE-GRANT-${sourceEventId}`
  const expectedReceiptKey = `runtime-finding.derive:${sourceEventId}`
  if (metadata.childWorkOrderRef !== expectedWorkOrderRef
    || metadata.childGoalRef !== expectedGoalRef
    || metadata.childOutcomeKey !== expectedOutcomeKey
    || metadata.childDecisionRef !== expectedDecisionRef
    || metadata.childImplementationGrantRef !== expectedImplementationGrantRef
    || metadata.authorizationReceiptKey !== expectedReceiptKey) return false
  const requestBinding = {
    sourceFindingEventId: Number(metadata.sourceFindingEventId),
    sourcePayloadDigest: sourceMetadata.payloadDigest,
    sourceCheckpointId: Number(metadata.sourceCheckpointId),
    sourceCheckpointDigest: metadata.sourceCheckpointDigest,
    parentWorkOrderId: Number(row.parentWorkOrderRowId),
    parentWorkOrderRef: metadata.objectiveWorkOrderId,
    parentContractId: metadata.contractId,
    parentContractDigest: metadata.contractDigest,
    parentAuthorizationDecisionId: Number(metadata.authorizationDecisionId),
    parentImplementationGrantId: Number(metadata.implementationGrantId),
    operation: "runtime_finding.derive",
  }
  const resultBinding = {
    workOrderId: Number(metadata.workOrderId), workOrderRef: metadata.childWorkOrderRef,
    goalId: Number(metadata.goalId), goalRef: metadata.childGoalRef,
    queueId: Number(metadata.queueId), outcomeKey: metadata.childOutcomeKey,
    decisionId: Number(metadata.decisionId), approvalDecisionId: Number(metadata.decisionId),
    grantId: Number(metadata.queueGrantId), grantRef: expectedQueueGrantRef,
    queueGrantId: Number(metadata.queueGrantId), queueGrantRef: expectedQueueGrantRef,
    implementationGrantId: Number(metadata.grantId),
    implementationGrantRef: metadata.childImplementationGrantRef,
    workContract: metadata.childWorkContract,
  }
  return canonicalJson(proof.requestBinding) === canonicalJson(requestBinding)
    && canonicalJson(proof.resultBinding) === canonicalJson(resultBinding)
    && proof.requestHash === sha256(canonicalJson(requestBinding))
}

function timestamp(value) {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""))
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null
}

function decisionPacket() {
  return Object.freeze({
    blockedAction: "Authorize materialization of the gated runtime finding.",
    authorityBoundary: "This finding requires owner authority before bounded work may be materialized.",
    minimumChoice: "APPROVE_OR_DENY",
    approveConsequence: "Record authority materialization as required without executing gated work.",
    denyConsequence: "Resolve the gated finding as denied without executing gated work.",
  })
}

function normalizedGates(value) {
  if (!Array.isArray(value) || value.length === 0) wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  const gates = [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))].sort()
  if (gates.length === 0 || gates.some((entry) => !/^[A-Z][A-Z0-9_]{1,79}$/.test(entry))) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  return gates
}

export function projectRuntimeFindingActionability(row, gates = normalizedGates(row?.gates)) {
  const projection = {
    id: RUNTIME_FINDING_ACTIONABILITY_PROJECTION_ID,
    version: RUNTIME_FINDING_ACTIONABILITY_VERSION,
    parentWorkOrderRowId: Number(row.parentWorkOrderRowId),
    parentWorkOrderRef: row.parentWorkOrderRef,
    authorityGrantId: Number(row.authorityGrantId),
    authorityGrantRef: row.authorityGrantRef,
    authorityGrantLevel: row.authorityGrantLevel,
    sourceFindingEventId: Number(row.sourceFindingEventId),
    gateSettlementEventId: Number(row.gateSettlementEventId),
    findingId: row.findingId,
    sequence: Number(row.sequence),
    gates,
    routineSiblingState: "SETTLED",
  }
  return Object.freeze({ ...projection, digest: sha256(canonicalJson(projection)) })
}

function validateCandidate(row) {
  const ids = [row.parentWorkOrderRowId, row.sourceFindingEventId, row.gateSettlementEventId,
    row.authorityGrantId]
    .map(Number)
  const sequence = Number(row.sequence)
  const issuedAt = timestamp(row.issuedAt)
  const gates = normalizedGates(row.gates)
  if (ids.some((value) => !Number.isSafeInteger(value) || value <= 0)
    || !Number.isSafeInteger(sequence) || sequence <= 0
    || typeof row.ownerUserId !== "string" || row.ownerUserId.trim() === ""
    || typeof row.parentWorkOrderRef !== "string" || row.parentWorkOrderRef.trim() === ""
    || typeof row.authorityGrantRef !== "string" || row.authorityGrantRef.trim() === ""
    || typeof row.authorityGrantLevel !== "string" || row.authorityGrantLevel.trim() === ""
    || typeof row.findingId !== "string" || row.findingId.trim() === ""
    || typeof row.gate !== "string" || !gates.includes(row.gate)
    || typeof row.gatePayloadDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.gatePayloadDigest)
    || !row.gateMetadata || typeof row.gateMetadata !== "object" || Array.isArray(row.gateMetadata)
    || !row.sourceMetadata || typeof row.sourceMetadata !== "object" || Array.isArray(row.sourceMetadata)
    || row.sourceMetadata.findingId !== row.findingId
    || row.sourceMetadata.objectiveWorkOrderId !== row.parentWorkOrderRef
    || Number(row.sourceMetadata.sequence) !== sequence
    || !issuedAt) wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  const canonicalGate = {
    sourceFindingEventId: ids[1],
    sourceUserId: row.ownerUserId,
    findingId: row.findingId,
    objectiveWorkOrderId: row.parentWorkOrderRef,
    issueNumber: row.gateMetadata.issueNumber,
    gate: row.gate,
    gates,
    reason: row.gateMetadata.reason,
    contractId: row.gateMetadata.contractId,
    contractDigest: row.gateMetadata.contractDigest,
    authorizationDecisionId: row.gateMetadata.authorizationDecisionId,
    implementationGrantId: row.gateMetadata.implementationGrantId,
    grantRef: row.gateMetadata.grantRef,
    projectionCompletionOwned: row.gateMetadata.projectionCompletionOwned,
    sourceCheckpointId: row.gateMetadata.sourceCheckpointId,
    sourceCheckpointDigest: row.gateMetadata.sourceCheckpointDigest,
    contractVersion: row.gateMetadata.contractVersion,
    contractRepository: row.gateMetadata.contractRepository,
    contractLane: row.gateMetadata.contractLane,
    deliveryAuthorityLevel: row.gateMetadata.deliveryAuthorityLevel,
    deliveryAllowedActions: row.gateMetadata.deliveryAllowedActions,
    commitAllowed: row.gateMetadata.commitAllowed,
    tagAllowed: row.gateMetadata.tagAllowed,
    pushAllowed: row.gateMetadata.pushAllowed,
  }
  if (sourceDigest(canonicalGate) !== row.gatePayloadDigest) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  const calculatedSourceDigest = exactFindingPayloadDigest(row.sourceMetadata)
  const liveAcceptanceSource = row.sourceMetadata.workContractId
    === HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID
  const parentRequest = row.parentAuthorizationRequestBinding
  const parentResult = row.parentAuthorizationResultBinding
  const acceptanceIds = [HERMES_ISSUE_911_LIVE_ACCEPTANCE_CONTRACT_ID]
  const expectedIntakeRequestHash = liveAcceptanceSource ? sha256(canonicalJson({
    contractVersion: 1, projectId: 1, intent: row.parentGoalCommand,
    idempotencyKey: row.parentIntakeIdempotencyKey,
  })) : null
  const expectedIntakeResultDigest = liveAcceptanceSource ? sha256(canonicalJson({
    contractVersion: 1, requestHash: expectedIntakeRequestHash,
    goalId: Number(row.parentGoalId), outcomeKey: row.parentOutcomeKey,
    threadId: parentRequest?.threadId,
    root: { sourceType: "outcome", sourceId: row.parentOutcomeKey },
    acceptedContractIds: acceptanceIds,
  })) : null
  const expectedAcceptanceProof = liveAcceptanceSource ? {
    receiptId: Number(row.parentIntakeReceiptId),
    requestHash: row.parentIntakeRequestHash,
    resultDigest: row.parentIntakeResultDigest,
    idempotencyKeyDigest: sha256(canonicalJson({ idempotencyKey: row.parentIntakeIdempotencyKey })),
  } : null
  const expectedAcceptanceCriteria = liveAcceptanceSource && row.parentWorkContract?.acceptance
    ? [JSON.stringify({
    contractId: row.parentWorkContract.id, contractDigest: row.parentWorkContract.digest,
    evidencePath: row.parentWorkContract.acceptance.evidencePath,
    requestedFindingClasses: row.parentWorkContract.acceptance.requestedFindingClasses,
    emptyOrPartialAllowed: row.parentWorkContract.acceptance.emptyOrPartialAllowed,
    hostMutationAllowed: row.parentWorkContract.acceptance.hostMutationAllowed,
    noFabrication: row.parentWorkContract.acceptance.noFabrication,
    gatedDispatchAllowed: row.parentWorkContract.acceptance.gatedDispatchAllowed,
    })] : null
  if (liveAcceptanceSource && (
    Number(row.parentAuthorizationReceiptCount) !== 1
    || !isExactIssue911LiveAcceptanceContract(row.parentWorkContract)
    || canonicalJson(parentResult?.workContract)
      !== canonicalJson(row.parentWorkContract)
    || row.parentWorkContract.digest !== row.sourceMetadata.workContractDigest
    || canonicalJson(Object.keys(parentRequest ?? {}).sort()) !== canonicalJson([
      "confirmation", "idempotencyKey", "outcomeKey", "projectId", "threadId",
    ])
    || parentRequest.confirmation !== "START_WORK" || Number(parentRequest.projectId) !== 1
    || parentRequest.outcomeKey !== row.parentOutcomeKey || parentRequest.threadId == null
    || row.parentAuthorizationRequestHash !== sha256(canonicalJson({
      contract: "workbench-execution-authorization.v1", ...parentRequest,
    }))
    || canonicalJson(Object.keys(parentResult ?? {}).sort()) !== canonicalJson([
      "acceptanceIntakeProof", "acceptedContractIds", "authorizedAt", "decisionId",
      "decisionRef", "expiresAt", "grantId", "grantRef", "implementationGrantId",
      "implementationGrantRef", "queueVersion", "workContract",
    ])
    || canonicalJson(parentResult.acceptedContractIds) !== canonicalJson(acceptanceIds)
    || canonicalJson(parentResult.acceptanceIntakeProof) !== canonicalJson(expectedAcceptanceProof)
    || canonicalJson(row.parentGoalAcceptedContractIds) !== canonicalJson(acceptanceIds)
    || canonicalJson(row.parentQueueAcceptedContractIds) !== canonicalJson(acceptanceIds)
    || canonicalJson(row.parentIntakeAcceptedContractIds) !== canonicalJson(acceptanceIds)
    || Number(row.parentIntakeReceiptCount) !== 1
    || !/^workbench-outcome:issue-911-live-nonempty-acceptance\.v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.parentIntakeIdempotencyKey ?? "")
    || row.parentIntakeRequestHash !== expectedIntakeRequestHash
    || row.parentIntakeResultDigest !== expectedIntakeResultDigest
    || Number(row.parentProjectCount) !== 1 || Number(row.parentRootThreadCount) !== 1
    || Number(row.parentPrimaryRepoCount) !== 1 || Number(row.parentPrimaryRepoTotal) !== 1
    || canonicalJson(row.parentAcceptanceCriteria ?? []) !== canonicalJson(expectedAcceptanceCriteria)
    || canonicalJson(row.sourceMetadata.paths) !== canonicalJson([
      "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md",
    ])
  )) wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  const exactGateMetadata = {
    ...canonicalGate,
    parentGrantRef: canonicalGate.grantRef,
    payloadDigest: row.gatePayloadDigest,
  }
  if (!calculatedSourceDigest
    || canonicalJson(row.gateMetadata) !== canonicalJson(exactGateMetadata)
    || row.gateMetadata.parentGrantRef !== row.authorityGrantRef
    || row.gateMetadata.grantRef !== row.authorityGrantRef
    || Number(row.gateMetadata.implementationGrantId) !== Number(row.authorityGrantId)
    || row.gateMetadata.sourceCheckpointId !== row.sourceMetadata.sourceCheckpointId
    || row.gateMetadata.sourceCheckpointDigest !== row.sourceMetadata.sourceCheckpointDigest
    || row.gateMetadata.contractId !== row.sourceMetadata.workContractId
    || row.gateMetadata.contractDigest !== row.sourceMetadata.workContractDigest
    || row.gateMetadata.contractVersion !== row.sourceMetadata.workContractVersion
    || row.gateMetadata.contractRepository !== row.sourceMetadata.workContractRepository
    || row.gateMetadata.contractLane !== row.sourceMetadata.workContractLane
    || row.gateMetadata.authorizationDecisionId !== row.sourceMetadata.authorizationDecisionId
    || row.gateMetadata.deliveryAuthorityLevel !== row.sourceMetadata.deliveryAuthorityLevel
    || canonicalJson(row.gateMetadata.deliveryAllowedActions)
      !== canonicalJson(row.sourceMetadata.deliveryAllowedActions)
    || row.gateMetadata.commitAllowed !== row.sourceMetadata.commitAllowed
    || row.gateMetadata.tagAllowed !== row.sourceMetadata.tagAllowed
    || row.gateMetadata.pushAllowed !== row.sourceMetadata.pushAllowed
    || (typeof row.sourcePayloadDigest === "string" && row.sourcePayloadDigest !== calculatedSourceDigest)) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  if (!exactRuntimeCheckpointMetadata(row.sourceCheckpointMetadata, "CODEX_TURN_COMPLETED")
    || Number(row.sourceCheckpointId) !== Number(row.sourceMetadata.sourceCheckpointId)
    || row.sourceCheckpointDigest !== row.sourceMetadata.sourceCheckpointDigest
    || row.sourceCheckpointMetadata.payloadDigest !== row.sourceCheckpointDigest
    || (row.parentStatus === "closed" && (
      !exactRuntimeCheckpointMetadata(row.parentCompleteMetadata, "COMPLETE")
      || !Number.isSafeInteger(Number(row.parentCompletionCheckpointId))
      || Number(row.parentCompletionCheckpointId) <= Number(row.sourceCheckpointId)
      || row.parentCompletionCheckpointDigest !== row.parentCompleteMetadata.payloadDigest
      || !Array.isArray(row.childCompleteMetadata)
      || row.childCompleteMetadata.some((metadata) => !exactRuntimeCheckpointMetadata(metadata, "COMPLETE"))
      || !Array.isArray(row.childDerivationProofs)
      || row.childDerivationProofs.length !== row.childCompleteMetadata.length
      || row.childDerivationProofs.some((proof) => !exactDerivedFindingProof(proof, row))
    ))) wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  return { ids, sequence, issuedAt, gates, sourcePayloadDigest: calculatedSourceDigest }
}

export async function readPendingRuntimeFindingDecisionRequest({
  query,
  databaseUrl = process.env.DATABASE_URL,
  ownerEmail,
  includeDecided = false,
  exactGateSettlementEventId = null,
} = {}) {
  if (typeof ownerEmail !== "string" || ownerEmail.trim() === "") wall("PRIMARY_DECISION_OWNER_INVALID")
  let runQuery = normalizeQuery(query)
  let pool
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") wall("DATABASE_URL_REQUIRED")
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    runQuery = pool.query.bind(pool)
  }
  if (exactGateSettlementEventId !== null
    && (!Number.isSafeInteger(exactGateSettlementEventId) || exactGateSettlementEventId <= 0)) {
    wall("RUNTIME_FINDING_DECISION_SOURCE_WALL")
  }
  try {
    const result = await runQuery(
      `SELECT gate.id AS "gateSettlementEventId", gate."createdAt" AS "issuedAt",
         gate."userId" AS "ownerUserId", gate.metadata AS "gateMetadata",
         gate.metadata->>'payloadDigest' AS "gatePayloadDigest",
         gate.metadata->>'findingId' AS "findingId", gate.metadata->>'gate' AS gate,
         gate.metadata->'gates' AS gates,
         (gate.metadata->>'sourceFindingEventId')::integer AS "sourceFindingEventId",
         source.metadata AS "sourceMetadata",
         source_checkpoint.id AS "sourceCheckpointId",
         source_checkpoint.metadata AS "sourceCheckpointMetadata",
         source_checkpoint.metadata->>'payloadDigest' AS "sourceCheckpointDigest",
         parent.status AS "parentStatus",
         parent."acceptanceCriteria" AS "parentAcceptanceCriteria",
         parent_receipt."resultBinding"->'workContract' AS "parentWorkContract",
         parent_receipt."resultBinding" AS "parentAuthorizationResultBinding",
         parent_receipt."requestBinding" AS "parentAuthorizationRequestBinding",
         parent_receipt."requestHash" AS "parentAuthorizationRequestHash",
         parent_queue."acceptedContractIds" AS "parentQueueAcceptedContractIds",
         parent_queue."outcomeKey" AS "parentOutcomeKey",
         parent_goal."acceptedContractIds" AS "parentGoalAcceptedContractIds",
         parent_goal.id AS "parentGoalId",
         parent_goal.command AS "parentGoalCommand",
         parent_intake.id AS "parentIntakeReceiptId",
         parent_intake."idempotencyKey" AS "parentIntakeIdempotencyKey",
         parent_intake."requestHash" AS "parentIntakeRequestHash",
         parent_intake."resultDigest" AS "parentIntakeResultDigest",
         parent_intake."acceptedContractIds" AS "parentIntakeAcceptedContractIds",
         (SELECT count(*) FROM goal_outcome_intake_receipt singleton_intake
           WHERE singleton_intake."userId" = parent."userId"
             AND singleton_intake."acceptedContractIds"
               = ARRAY['issue-911-live-nonempty-acceptance.v1']::text[]) AS "parentIntakeReceiptCount",
         (SELECT count(*) FROM project exact_project
           WHERE exact_project."userId" = parent."userId"
             AND exact_project.id = 1 AND exact_project.lifecycle = 'active') AS "parentProjectCount",
         (SELECT count(*) FROM workbench_thread_source exact_root
           JOIN workbench_thread exact_thread
             ON exact_thread."userId" = exact_root."userId"
            AND exact_thread.id = exact_root."threadId"
            AND exact_thread."projectId" = 1
           WHERE exact_root."userId" = parent."userId"
             AND exact_root."sourceType" = 'outcome'
             AND exact_root."sourceId" = parent_queue."outcomeKey"
             AND exact_root.role = 'root'
             AND exact_root."threadId" = parent_receipt."requestBinding"->>'threadId') AS "parentRootThreadCount",
         (SELECT count(*) FROM project_resource primary_repo
           WHERE primary_repo."userId" = parent."userId"
             AND primary_repo."projectId" = 1 AND primary_repo.type = 'repo'
             AND primary_repo.relationship = 'primary-repo') AS "parentPrimaryRepoTotal",
         (SELECT count(*) FROM project_resource exact_repo
           WHERE exact_repo."userId" = parent."userId"
             AND exact_repo."projectId" = 1 AND exact_repo.type = 'repo'
             AND exact_repo.relationship = 'primary-repo'
             AND exact_repo."canonicalIdentity" = 'bsvalues/terragroq') AS "parentPrimaryRepoCount",
         (SELECT count(*) FROM outcome_queue_mutation_receipt exact_parent_receipt
           WHERE exact_parent_receipt."userId" = parent_queue."userId"
             AND exact_parent_receipt."outcomeKey" = parent_queue."outcomeKey"
             AND exact_parent_receipt.operation = 'workbench_execution.authorize') AS "parentAuthorizationReceiptCount",
         parent.id AS "parentWorkOrderRowId",
         parent.ref AS "parentWorkOrderRef", grant_row.id AS "authorityGrantId",
         grant_row.ref AS "authorityGrantRef", grant_row."authorityLevel" AS "authorityGrantLevel",
         (source.metadata->>'sequence')::integer AS sequence,
         (SELECT parent_complete.id FROM governance_event parent_complete
           WHERE parent_complete."userId" = parent."userId"
             AND parent_complete."entityType" = 'work_order'
             AND parent_complete."entityId"::text = parent.id::text
             AND parent_complete."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
             AND parent_complete.metadata->>'checkpointState' = 'COMPLETE'
           ORDER BY parent_complete."createdAt" DESC, parent_complete.id DESC LIMIT 1)
           AS "parentCompletionCheckpointId",
         (SELECT parent_complete.metadata FROM governance_event parent_complete
           WHERE parent_complete."userId" = parent."userId"
             AND parent_complete."entityType" = 'work_order'
             AND parent_complete."entityId"::text = parent.id::text
             AND parent_complete."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
             AND parent_complete.metadata->>'checkpointState' = 'COMPLETE'
           ORDER BY parent_complete."createdAt" DESC, parent_complete.id DESC LIMIT 1)
           AS "parentCompleteMetadata",
         (SELECT parent_complete.metadata->>'payloadDigest' FROM governance_event parent_complete
           WHERE parent_complete."userId" = parent."userId"
             AND parent_complete."entityType" = 'work_order'
             AND parent_complete."entityId"::text = parent.id::text
             AND parent_complete."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
             AND parent_complete.metadata->>'checkpointState' = 'COMPLETE'
           ORDER BY parent_complete."createdAt" DESC, parent_complete.id DESC LIMIT 1)
           AS "parentCompletionCheckpointDigest",
         COALESCE((SELECT jsonb_agg(child_complete.metadata ORDER BY derived.id)
           FROM governance_event derived
           LEFT JOIN work_order child ON child.id = CASE
             WHEN derived.metadata->>'workOrderId' ~ '^[1-9][0-9]*$'
             THEN (derived.metadata->>'workOrderId')::integer END
            AND child."userId" = derived."userId"
           JOIN governance_event child_complete
             ON child_complete.id = (SELECT latest_child.id
               FROM governance_event latest_child
               WHERE latest_child."userId" = child."userId"
                 AND latest_child."entityType" = 'work_order'
                 AND latest_child."entityId"::text = child.id::text
                 AND latest_child."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
               ORDER BY latest_child."createdAt" DESC, latest_child.id DESC LIMIT 1)
            AND child_complete.metadata->>'checkpointState' = 'COMPLETE'
           WHERE derived."userId" = source."userId"
             AND derived."eventType" = 'RUNTIME_FINDING_DERIVED'
             AND derived.metadata->>'sourceCheckpointId' = source.metadata->>'sourceCheckpointId'
             AND derived.metadata->>'sourceCheckpointDigest' = source.metadata->>'sourceCheckpointDigest'),
           '[]'::jsonb) AS "childCompleteMetadata",
         COALESCE((SELECT jsonb_agg(jsonb_build_object(
             'sourceMetadata', sibling_source.metadata,
             'metadata', derived.metadata,
             'receiptId', child_receipt.id,
             'requestHash', child_receipt."requestHash",
             'requestBinding', child_receipt."requestBinding",
             'resultBinding', child_receipt."resultBinding",
             'receiptCount', (SELECT count(*) FROM outcome_queue_mutation_receipt semantic_receipt
               WHERE semantic_receipt."userId" = derived."userId"
                 AND semantic_receipt.operation = 'runtime_finding.derive'
                 AND semantic_receipt."idempotencyKey" = derived.metadata->>'authorizationReceiptKey'))
             ORDER BY derived.id)
           FROM governance_event sibling_source
           JOIN governance_event derived
             ON derived."userId" = sibling_source."userId"
            AND derived."eventType" = 'RUNTIME_FINDING_DERIVED'
            AND derived.metadata->>'sourceFindingEventId' = sibling_source.id::text
           LEFT JOIN outcome_queue_mutation_receipt child_receipt
             ON child_receipt."userId" = derived."userId"
            AND child_receipt.operation = 'runtime_finding.derive'
            AND child_receipt."idempotencyKey" = derived.metadata->>'authorizationReceiptKey'
           WHERE sibling_source."userId" = source."userId"
             AND sibling_source."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
             AND sibling_source.metadata->>'sourceCheckpointId' = source.metadata->>'sourceCheckpointId'
             AND sibling_source.metadata->>'sourceCheckpointDigest' = source.metadata->>'sourceCheckpointDigest'),
           '[]'::jsonb) AS "childDerivationProofs"
       FROM governance_event gate
       JOIN "user" owner ON owner.id = gate."userId" AND lower(owner.email) = lower($1)
       JOIN governance_event source ON source.id = (gate.metadata->>'sourceFindingEventId')::integer
         AND source."userId" = gate."userId"
         AND source.actor IN ('hermes', 'williamos-runtime-operator')
         AND source."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
         AND source."entityType" = 'work_order'
         AND source.metadata->>'findingId' = gate.metadata->>'findingId'
         AND source.metadata->>'objectiveWorkOrderId' = gate.metadata->>'objectiveWorkOrderId'
       JOIN work_order parent ON parent.id::text = source."entityId"
         AND parent."userId" = source."userId"
         AND parent.ref = source.metadata->>'objectiveWorkOrderId'
       JOIN outcome_queue_item parent_queue ON parent_queue."userId" = parent."userId"
         AND parent_queue."activeWorkOrderId" = parent.id
       JOIN outcome_queue_mutation_receipt parent_receipt
         ON parent_receipt."userId" = parent_queue."userId"
        AND parent_receipt."outcomeKey" = parent_queue."outcomeKey"
        AND parent_receipt.operation = 'workbench_execution.authorize'
        AND parent_receipt."resultBinding"->'workContract'->>'id' = source.metadata->>'workContractId'
        AND parent_receipt."resultBinding"->'workContract'->>'digest' = source.metadata->>'workContractDigest'
       JOIN goal parent_goal ON parent_goal."userId" = parent_queue."userId"
         AND parent_goal.id = parent_queue."goalId"
       LEFT JOIN goal_outcome_intake_receipt parent_intake
         ON parent_intake."userId" = parent_queue."userId"
        AND parent_intake."goalId" = parent_queue."goalId"
        AND parent_intake."outcomeKey" = parent_queue."outcomeKey"
       JOIN governance_event source_checkpoint
         ON source_checkpoint.id = CASE
           WHEN source.metadata->>'sourceCheckpointId' ~ '^[1-9][0-9]*$'
           THEN (source.metadata->>'sourceCheckpointId')::bigint END
        AND source_checkpoint."userId" = source."userId"
        AND source_checkpoint."entityType" = 'work_order'
        AND source_checkpoint."entityId"::text = parent.id::text
        AND source_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
        AND source_checkpoint.actor = 'hermes-codex-bridge'
        AND source_checkpoint.metadata->>'checkpointState' = 'CODEX_TURN_COMPLETED'
        AND source_checkpoint.metadata->>'payloadDigest' = source.metadata->>'sourceCheckpointDigest'
        AND source_checkpoint.metadata->>'executionEpochDigest' = source.metadata->>'sourceExecutionEpochDigest'
        AND source_checkpoint.metadata->>'idempotencyKey' = source.metadata->>'sourceCheckpointKey'
        AND source_checkpoint.metadata->>'checkpointSequence' = source.metadata->>'sourceCheckpointSequence'
        AND source_checkpoint.metadata->>'workOrderRef' = parent.ref
        AND source_checkpoint.metadata->>'workContractId' = source.metadata->>'workContractId'
        AND source_checkpoint.metadata->>'workContractDigest' = source.metadata->>'workContractDigest'
        AND source_checkpoint.metadata->>'workContractVersion' = source.metadata->>'workContractVersion'
        AND source_checkpoint.metadata->>'authorizationDecisionId' = source.metadata->>'authorizationDecisionId'
        AND source_checkpoint.metadata->>'executionGrantRef' = source.metadata->>'executionGrantRef'
        AND source_checkpoint.metadata->>'implementationGrantId' = source.metadata->>'implementationGrantId'
        AND source_checkpoint.metadata->>'implementationGrantRef' = source.metadata->>'implementationGrantRef'
       JOIN authority_grant grant_row ON grant_row.id = parent."authorityGrantId"
         AND grant_row."userId" = parent."userId"
         AND grant_row."authorityLevel" = parent."authorityLevel"
         AND grant_row.scope = parent.ref
         AND grant_row.status = 'active'
         AND grant_row."revokedAt" IS NULL
         AND (grant_row."expiresAt" IS NULL OR grant_row."expiresAt" > clock_timestamp())
         AND (cardinality(grant_row."allowedActions") = 0 OR 'implement' = ANY(grant_row."allowedActions"))
         AND NOT ('implement' = ANY(grant_row."blockedActions"))
       WHERE gate."eventType" = 'RUNTIME_FINDING_OWNER_GATED'
         AND gate."entityType" = 'work_order'
         AND gate.actor = 'williamos-runtime-operator'
         AND gate."entityId"::text = parent.id::text
         AND gate.metadata->>'sourceUserId' = gate."userId"::text
         AND (parent.status IN ('active', 'approved') OR (
           parent.status = 'closed' AND parent.result = 'PASS'
           AND EXISTS (
             SELECT 1
             FROM governance_event parent_complete
             JOIN goal parent_goal
               ON parent_goal."userId" = parent."userId"
              AND parent_goal."linkedWorkOrderId" = parent.id
              AND parent_goal.status = 'converted'
             JOIN evidence_record parent_evidence
               ON parent_evidence."userId" = parent_complete."userId"
              AND parent_evidence."workOrderId" = parent.id
              AND parent_evidence.ref = 'EV-HERMES-' || parent_goal.id::text || '-'
                || (parent_complete.metadata->>'attempt') || '-'
                || (parent_complete.metadata->>'checkpointSequence')
              AND parent_evidence.result = 'PASS'
              AND parent_evidence.repo = 'bsvalues/terragroq'
              AND parent_evidence.head = parent_complete.metadata->>'mergeSha'
              AND parent_evidence.notes = 'Persisted Hermes runtime evidence for '
                || (parent_complete.metadata->>'idempotencyKey') || '.'
              AND parent_evidence."contentHash" = parent_complete.metadata->>'payloadDigest'
             JOIN outcome_queue_item parent_queue
               ON parent_queue."userId" = parent."userId"
              AND parent_queue."goalId" = parent_goal.id
              AND parent_queue."activeWorkOrderId" = parent.id
              AND parent_queue."lifecycleState" = 'completed'
              AND parent_queue."lifecycleReason" IS NULL
              AND parent_queue."terminalResult" = 'COMPLETE'
              AND parent_queue."terminalAt" IS NOT NULL
              AND parent_queue."leaseHolder" IS NULL
              AND parent_queue."leaseToken" IS NULL
              AND parent_queue."leaseExpiresAt" IS NULL
              AND parent_queue."executionBinding" = parent_complete.metadata->>'executionBinding'
              AND parent_queue."acquisitionKey" = parent_complete.metadata->>'acquisitionKey'
              AND parent_queue."fencingToken"::text = parent_complete.metadata->>'acquisitionFencingToken'
              AND parent_queue."terminalKey" = 'hermes:' || parent_queue."outcomeKey" || ':'
                || parent_queue."fencingToken"::text || ':' || (parent_complete.metadata->>'mergeSha')
              AND parent_queue."terminalEvidenceId" IS NULL
              AND parent_queue."terminalEvidenceRefs" = ARRAY[
                'EV-HERMES-' || parent_goal.id::text || '-'
                  || (parent_complete.metadata->>'attempt') || '-'
                  || (parent_complete.metadata->>'checkpointSequence'),
                'merge:' || (parent_complete.metadata->>'mergeSha'),
                'pr:' || (parent_complete.metadata->>'prNumber')]::text[]
             JOIN governance_event parent_completion
               ON parent_completion."userId" = parent."userId"
              AND parent_completion."entityType" = 'goal'
              AND parent_completion."entityId"::text = parent_goal.id::text
              AND parent_completion."eventType" = 'HERMES_OUTCOME_COMPLETED'
              AND parent_completion.actor = 'hermes-codex-bridge'
              AND parent_completion.id > parent_complete.id
              AND parent_completion.id < gate.id
              AND parent_completion.metadata = jsonb_build_object(
                'prNumber', CASE WHEN parent_complete.metadata->>'prNumber' ~ '^[1-9][0-9]*$'
                  THEN (parent_complete.metadata->>'prNumber')::integer END,
                'mergeSha', parent_complete.metadata->>'mergeSha',
                'branch', parent_completion.metadata->>'branch',
                'runtimeEvidenceRef', 'EV-HERMES-' || parent_goal.id::text || '-'
                  || (parent_complete.metadata->>'attempt') || '-'
                  || (parent_complete.metadata->>'checkpointSequence'),
                'ownerTouchCount', 0,
                'blockedScopeCrossed', false)
             WHERE parent_complete."userId" = parent."userId"
               AND parent_complete."entityType" = 'work_order'
               AND parent_complete."entityId"::text = parent.id::text
               AND parent_complete."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
               AND parent_complete.actor = 'hermes-codex-bridge'
               AND parent_complete.metadata->>'checkpointState' = 'COMPLETE'
               AND parent_complete.metadata->>'executionEpochDigest'
                 = source.metadata->>'sourceExecutionEpochDigest'
               AND parent_complete.metadata->>'workContractId' = source.metadata->>'workContractId'
               AND parent_complete.metadata->>'workContractDigest' = source.metadata->>'workContractDigest'
               AND parent_complete.metadata->>'workContractVersion' = source.metadata->>'workContractVersion'
               AND parent_complete.metadata->>'authorizationDecisionId' = source.metadata->>'authorizationDecisionId'
               AND parent_complete.metadata->>'executionGrantRef' = source.metadata->>'executionGrantRef'
               AND parent_complete.metadata->>'implementationGrantId' = source.metadata->>'implementationGrantId'
               AND parent_complete.metadata->>'implementationGrantRef' = source.metadata->>'implementationGrantRef'
               AND parent_complete.metadata->>'prNumber' ~ '^[1-9][0-9]*$'
               AND parent_complete.metadata->>'mergeSha' ~ '^[0-9a-f]{40}$'
               AND parent_complete.metadata->>'attempt' ~ '^[1-9][0-9]*$'
               AND parent_complete.metadata->>'checkpointSequence' ~ '^[0-9]+$'
               AND btrim(parent_completion.metadata->>'branch') <> ''
               AND parent_complete.id > source_checkpoint.id
               AND parent_complete.id = (
                 SELECT latest_parent_checkpoint.id
                 FROM governance_event latest_parent_checkpoint
                 WHERE latest_parent_checkpoint."userId" = parent."userId"
                   AND latest_parent_checkpoint."entityType" = 'work_order'
                   AND latest_parent_checkpoint."entityId"::text = parent.id::text
                   AND latest_parent_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                 ORDER BY latest_parent_checkpoint."createdAt" DESC, latest_parent_checkpoint.id DESC
                 LIMIT 1)
               AND (SELECT count(*) FROM governance_event semantic_parent_checkpoint
                 WHERE semantic_parent_checkpoint."userId" = parent."userId"
                   AND semantic_parent_checkpoint."entityType" = 'work_order'
                   AND semantic_parent_checkpoint."entityId"::text = parent.id::text
                   AND semantic_parent_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                   AND semantic_parent_checkpoint.metadata->>'checkpointState' = 'COMPLETE') = 1
               AND (SELECT count(*) FROM evidence_record semantic_parent_evidence
                 WHERE semantic_parent_evidence."userId" = parent."userId"
                   AND semantic_parent_evidence."workOrderId" = parent.id
                   AND semantic_parent_evidence.ref = parent_evidence.ref) = 1
               AND (SELECT count(*) FROM governance_event semantic_parent_completion
                 WHERE semantic_parent_completion."userId" = parent."userId"
                   AND semantic_parent_completion."entityType" = 'goal'
                   AND semantic_parent_completion."entityId"::text = parent_goal.id::text
                   AND semantic_parent_completion."eventType" = 'HERMES_OUTCOME_COMPLETED') = 1
           )
         ))
         AND parent."authorityGranted" IN ('A2_WRITE_OWN', 'A3_INTEGRATE')
         AND parent."authorityGranted" = parent."authorityLevel"
         AND ($3::integer IS NULL OR gate.id = $3::integer)
         AND ($2::boolean OR NOT EXISTS (
           SELECT 1 FROM governance_event receipt
           WHERE receipt."userId" = gate."userId"
             AND receipt."eventType" = 'RUNTIME_FINDING_OWNER_DECIDED'
             AND (receipt.metadata->>'gateSettlementEventId')::integer = gate.id
         ))
         AND NOT EXISTS (
           SELECT 1 FROM governance_event sibling
           WHERE sibling."userId" = gate."userId"
             AND sibling."eventType" = 'RUNTIME_OBJECTIVE_FINDING_RECORDED'
             AND sibling.metadata->>'objectiveWorkOrderId' = parent.ref
             AND sibling.metadata->>'sourceCheckpointId' = source.metadata->>'sourceCheckpointId'
             AND sibling.metadata->>'sourceCheckpointDigest' = source.metadata->>'sourceCheckpointDigest'
             AND sibling.id <> source.id
             AND (SELECT count(*) FROM governance_event sibling_settlement
               WHERE sibling_settlement."userId" = sibling."userId"
                 AND sibling_settlement."eventType" IN ('RUNTIME_FINDING_DERIVED', 'RUNTIME_FINDING_OWNER_GATED')
                 AND sibling_settlement.metadata->>'sourceFindingEventId' = sibling.id::text) <> 1
         )
         AND (SELECT count(*) FROM governance_event source_settlement
           WHERE source_settlement."userId" = source."userId"
             AND source_settlement."eventType" IN ('RUNTIME_FINDING_DERIVED', 'RUNTIME_FINDING_OWNER_GATED')
             AND source_settlement.metadata->>'sourceFindingEventId' = source.id::text) = 1
         AND NOT EXISTS (
           SELECT 1 FROM governance_event source_derived
           WHERE source_derived."userId" = source."userId"
             AND source_derived."eventType" = 'RUNTIME_FINDING_DERIVED'
             AND source_derived.metadata->>'sourceFindingEventId' = source.id::text
         )
         AND NOT EXISTS (
           SELECT 1 FROM outcome_queue_mutation_receipt gated_dispatch
           WHERE gated_dispatch."userId" = source."userId"
             AND gated_dispatch.operation = 'runtime_finding.derive'
             AND gated_dispatch."requestBinding"->>'sourceFindingEventId' = source.id::text
         )
         AND NOT EXISTS (
           SELECT 1 FROM governance_event derived
           JOIN work_order child ON child.id = CASE
             WHEN derived.metadata->>'workOrderId' ~ '^[1-9][0-9]*$'
             THEN (derived.metadata->>'workOrderId')::integer END
             AND child."userId" = derived."userId"
           WHERE derived."userId" = gate."userId"
             AND derived."eventType" = 'RUNTIME_FINDING_DERIVED'
             AND derived.metadata->>'objectiveWorkOrderId' = parent.ref
             AND derived.metadata->>'sourceCheckpointId' = source.metadata->>'sourceCheckpointId'
             AND derived.metadata->>'sourceCheckpointDigest' = source.metadata->>'sourceCheckpointDigest'
             AND (child.id IS NULL OR NOT (child.status = 'closed' AND child.result = 'PASS' AND EXISTS (
               SELECT 1
               FROM goal child_goal
               JOIN outcome_queue_item child_queue
                 ON child_queue."userId" = child."userId"
                AND child_queue."goalId" = child_goal.id
                AND child_queue."activeWorkOrderId" = child.id
                AND child_queue.id::text = derived.metadata->>'queueId'
                AND child_queue."approvalDecisionId"::text = derived.metadata->>'decisionId'
                AND child_queue."outcomeKey" = derived.metadata->>'childOutcomeKey'
                AND child_queue."lifecycleState" = 'completed'
                AND child_queue."lifecycleReason" IS NULL
                AND child_queue."terminalResult" = 'COMPLETE'
                AND child_queue."terminalAt" IS NOT NULL
                AND child_queue."leaseHolder" IS NULL
                AND child_queue."leaseToken" IS NULL
                AND child_queue."leaseExpiresAt" IS NULL
               JOIN governance_event child_complete
                 ON child_complete."userId" = child."userId"
                AND child_complete."entityType" = 'work_order'
                AND child_complete."entityId"::text = child.id::text
                AND child_complete."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                AND child_complete.actor = 'hermes-codex-bridge'
                AND child_complete.metadata->>'checkpointState' = 'COMPLETE'
                AND child_complete.metadata->>'prNumber' ~ '^[1-9][0-9]*$'
                AND child_complete.metadata->>'mergeSha' ~ '^[0-9a-f]{40}$'
                AND child_complete.metadata->>'attempt' ~ '^[1-9][0-9]*$'
                AND child_complete.metadata->>'checkpointSequence' ~ '^[0-9]+$'
                AND child_complete.metadata->>'workContractId' = derived.metadata->'childWorkContract'->>'id'
                AND child_complete.metadata->>'workContractDigest' = derived.metadata->'childWorkContract'->>'digest'
                AND child_complete.metadata->>'workContractVersion' = derived.metadata->'childWorkContract'->>'version'
                AND child_complete.metadata->>'authorizationDecisionId' = derived.metadata->>'decisionId'
                AND child_complete.metadata->>'executionGrantRef' = child_queue."authorityGrantRef"
                AND child_complete.metadata->>'implementationGrantId' = derived.metadata->>'grantId'
                AND child_complete.metadata->>'implementationGrantRef' = derived.metadata->>'childImplementationGrantRef'
                AND child_complete.metadata->>'executionBinding' = child_queue."executionBinding"
                AND child_complete.metadata->>'acquisitionKey' = child_queue."acquisitionKey"
                AND child_complete.metadata->>'acquisitionFencingToken' = child_queue."fencingToken"::text
                AND child_queue."terminalKey" = 'hermes:' || child_queue."outcomeKey" || ':'
                  || child_queue."fencingToken"::text || ':' || (child_complete.metadata->>'mergeSha')
                AND child_queue."terminalEvidenceId" IS NULL
                AND child_queue."terminalEvidenceRefs" = ARRAY[
                  'EV-HERMES-' || child_goal.id::text || '-'
                    || (child_complete.metadata->>'attempt') || '-'
                    || (child_complete.metadata->>'checkpointSequence'),
                  'merge:' || (child_complete.metadata->>'mergeSha'),
                  'pr:' || (child_complete.metadata->>'prNumber')]::text[]
                AND child_complete.id = (
                  SELECT latest_child_checkpoint.id
                  FROM governance_event latest_child_checkpoint
                  WHERE latest_child_checkpoint."userId" = child."userId"
                    AND latest_child_checkpoint."entityType" = 'work_order'
                    AND latest_child_checkpoint."entityId"::text = child.id::text
                    AND latest_child_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                  ORDER BY latest_child_checkpoint."createdAt" DESC, latest_child_checkpoint.id DESC
                  LIMIT 1)
               JOIN outcome_queue_mutation_receipt child_receipt
                 ON child_receipt."userId" = child."userId"
                AND child_receipt.operation = 'runtime_finding.derive'
                AND child_receipt."idempotencyKey" = derived.metadata->>'authorizationReceiptKey'
                AND child_receipt."outcomeKey" = child_queue."outcomeKey"
                AND child_receipt."requestBinding"->>'sourceFindingEventId'
                  = derived.metadata->>'sourceFindingEventId'
                AND child_receipt."requestBinding"->>'sourceCheckpointId'
                  = derived.metadata->>'sourceCheckpointId'
                AND child_receipt."requestBinding"->>'sourceCheckpointDigest'
                  = derived.metadata->>'sourceCheckpointDigest'
                AND child_receipt."resultBinding"->>'workOrderId' = child.id::text
                AND child_receipt."resultBinding"->>'goalId' = child_goal.id::text
                AND child_receipt."resultBinding"->>'outcomeKey' = child_queue."outcomeKey"
                AND child_receipt."resultBinding"->>'decisionId' = derived.metadata->>'decisionId'
                AND child_receipt."resultBinding"->>'grantRef' = child_queue."authorityGrantRef"
                AND child_receipt."resultBinding"->>'implementationGrantId' = derived.metadata->>'grantId'
                AND child_receipt."resultBinding"->>'implementationGrantRef'
                  = derived.metadata->>'childImplementationGrantRef'
                AND child_receipt."resultBinding"->'workContract' = derived.metadata->'childWorkContract'
               JOIN evidence_record child_evidence
                 ON child_evidence."userId" = child."userId"
                AND child_evidence."workOrderId" = child.id
                AND child_evidence.ref = 'EV-HERMES-' || child_goal.id::text || '-'
                  || (child_complete.metadata->>'attempt') || '-'
                  || (child_complete.metadata->>'checkpointSequence')
                AND child_evidence.result = 'PASS'
                AND child_evidence.repo = 'bsvalues/terragroq'
                AND child_evidence.head = child_complete.metadata->>'mergeSha'
                AND child_evidence.notes = 'Persisted Hermes runtime evidence for '
                  || (child_complete.metadata->>'idempotencyKey') || '.'
                AND child_evidence."contentHash" = child_complete.metadata->>'payloadDigest'
               JOIN governance_event child_completion
                 ON child_completion."userId" = child."userId"
                AND child_completion."entityType" = 'goal'
                AND child_completion."entityId"::text = child_goal.id::text
                AND child_completion."eventType" = 'HERMES_OUTCOME_COMPLETED'
                AND child_completion.actor = 'hermes-codex-bridge'
                AND child_complete.id > derived.id
                AND child_completion.id > child_complete.id
                AND child_completion.metadata = jsonb_build_object(
                  'prNumber', CASE WHEN child_complete.metadata->>'prNumber' ~ '^[1-9][0-9]*$'
                    THEN (child_complete.metadata->>'prNumber')::integer END,
                  'mergeSha', child_complete.metadata->>'mergeSha',
                  'branch', child_completion.metadata->>'branch',
                  'runtimeEvidenceRef', 'EV-HERMES-' || child_goal.id::text || '-'
                    || (child_complete.metadata->>'attempt') || '-'
                    || (child_complete.metadata->>'checkpointSequence'),
                  'ownerTouchCount', 0,
                  'blockedScopeCrossed', false)
               WHERE child_goal."userId" = child."userId"
                 AND child_goal."linkedWorkOrderId" = child.id
                 AND child_goal.id::text = derived.metadata->>'goalId'
                 AND child_goal.status = 'converted'
                 AND btrim(child_completion.metadata->>'branch') <> ''
                 AND (SELECT count(*) FROM governance_event semantic_child_checkpoint
                   WHERE semantic_child_checkpoint."userId" = child."userId"
                     AND semantic_child_checkpoint."entityType" = 'work_order'
                     AND semantic_child_checkpoint."entityId"::text = child.id::text
                     AND semantic_child_checkpoint."eventType" = 'HERMES_RUNTIME_CHECKPOINT'
                     AND semantic_child_checkpoint.metadata->>'checkpointState' = 'COMPLETE') = 1
                 AND (SELECT count(*) FROM evidence_record semantic_child_evidence
                   WHERE semantic_child_evidence."userId" = child."userId"
                     AND semantic_child_evidence."workOrderId" = child.id
                     AND semantic_child_evidence.ref = child_evidence.ref) = 1
                 AND (SELECT count(*) FROM governance_event semantic_child_completion
                   WHERE semantic_child_completion."userId" = child."userId"
                     AND semantic_child_completion."entityType" = 'goal'
                     AND semantic_child_completion."entityId"::text = child_goal.id::text
                     AND semantic_child_completion."eventType" = 'HERMES_OUTCOME_COMPLETED') = 1
             )))
         )
       ORDER BY gate.id ASC LIMIT 1
       FOR UPDATE OF gate, source, parent, grant_row`,
      [ownerEmail.trim().toLowerCase(), includeDecided, exactGateSettlementEventId],
    )
    const row = result?.rows?.[0]
    if (!row) return null
    const { ids, sequence, issuedAt, gates, sourcePayloadDigest } = validateCandidate(row)
    const projection = projectRuntimeFindingActionability(row, gates)
    const packet = decisionPacket()
    return Object.freeze({
      sourceKind: RUNTIME_FINDING_DECISION_SOURCE_KIND,
      ownerUserId: row.ownerUserId,
      parentWorkOrderRowId: ids[0],
      parentWorkOrderRef: row.parentWorkOrderRef,
      authorityGrantId: ids[3],
      authorityGrantRef: row.authorityGrantRef,
      authorityGrantLevel: row.authorityGrantLevel,
      sourceFindingEventId: ids[1],
      sourcePayloadDigest,
      gateSettlementEventId: ids[2],
      gatePayloadDigest: row.gatePayloadDigest,
      actionableProjectionId: projection.id,
      actionableProjectionVersion: projection.version,
      actionableProjectionDigest: projection.digest,
      findingId: row.findingId,
      sequence,
      gate: row.gate,
      gates: Object.freeze(gates),
      allowedChoices: Object.freeze(["APPROVE", "DENY"]),
      recommendation: "DENY",
      recommendationRationale: "Default-deny: WilliamOS cannot infer authority for gated runtime work.",
      issuedAt,
      decisionPacket: packet,
      decisionPacketDigest: sha256(JSON.stringify(packet)),
    })
  } finally {
    if (pool) await pool.end()
  }
}

function exactRequestBinding(request) {
  return {
    sourceKind: request.sourceKind,
    ownerUserId: request.ownerUserId,
    parentWorkOrderRowId: request.parentWorkOrderRowId,
    parentWorkOrderRef: request.parentWorkOrderRef,
    authorityGrantId: request.authorityGrantId,
    authorityGrantRef: request.authorityGrantRef,
    authorityGrantLevel: request.authorityGrantLevel,
    sourceFindingEventId: request.sourceFindingEventId,
    sourcePayloadDigest: request.sourcePayloadDigest,
    gateSettlementEventId: request.gateSettlementEventId,
    gatePayloadDigest: request.gatePayloadDigest,
    actionableProjectionId: request.actionableProjectionId,
    actionableProjectionVersion: request.actionableProjectionVersion,
    actionableProjectionDigest: request.actionableProjectionDigest,
    findingId: request.findingId,
    sequence: request.sequence,
    gate: request.gate,
    gates: request.gates,
    decisionPacketDigest: request.decisionPacketDigest,
  }
}

export async function recordRuntimeFindingDecision({
  query,
  databaseUrl = process.env.DATABASE_URL,
  request,
  primaryDecisionProvenance,
} = {}) {
  if (request?.sourceKind !== RUNTIME_FINDING_DECISION_SOURCE_KIND
    || !isVerifiedPrimaryDecisionResponse(primaryDecisionProvenance)
    || primaryDecisionProvenance.requestDigest !== primaryDecisionRequestDigest(request)) {
    wall("RUNTIME_FINDING_DECISION_PROVENANCE_WALL")
  }
  const choice = primaryDecisionProvenance.choice
  if (!new Set(["APPROVE", "DENY"]).has(choice)) wall("RUNTIME_FINDING_DECISION_CHOICE_WALL")
  let runQuery = normalizeQuery(query)
  let pool
  let client
  if (!runQuery) {
    if (typeof databaseUrl !== "string" || databaseUrl.trim() === "") wall("DATABASE_URL_REQUIRED")
    const { Pool } = await import("pg")
    pool = createHermesDatabasePool(Pool, databaseUrl)
    client = await pool.connect()
    runQuery = client.query.bind(client)
  }
  const binding = exactRequestBinding(request)
  const decisionRef = `RUNTIME-FINDING-DECISION-${request.gateSettlementEventId}`
  try {
    await runQuery("BEGIN")
    await runQuery("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE")
    await runQuery("SELECT pg_advisory_xact_lock(hashtext($1))", [`runtime-finding-decision:${request.gateSettlementEventId}`])
    const live = await readPendingRuntimeFindingDecisionRequest({
      query: runQuery,
      ownerEmail: primaryDecisionProvenance.accountEmail,
      includeDecided: true,
      exactGateSettlementEventId: request.gateSettlementEventId,
    })
    if (!live || canonicalJson(exactRequestBinding(live)) !== canonicalJson(binding)) {
      wall("RUNTIME_FINDING_DECISION_REVALIDATION_WALL")
    }
    const priorResult = await runQuery(
      `SELECT id, "evidenceId", metadata FROM governance_event
       WHERE "userId" = $1 AND "eventType" = 'RUNTIME_FINDING_OWNER_DECIDED'
         AND (metadata->>'gateSettlementEventId')::integer = $2
       ORDER BY id ASC`,
      [request.ownerUserId, request.gateSettlementEventId],
    )
    const prior = priorResult?.rows ?? []
    const receiptPayload = {
      ...binding,
      choice,
      requestDigest: primaryDecisionProvenance.requestDigest,
      responseDigest: primaryDecisionProvenance.responseDigest,
      accountEmail: primaryDecisionProvenance.accountEmail,
      disposition: choice === "APPROVE" ? "AUTHORITY_MATERIALIZATION_REQUIRED" : "DENIED_RESOLVED",
      resumeReleased: false,
    }
    const receiptDigest = sha256(canonicalJson(receiptPayload))
    const decisionRows = (await runQuery(
      `SELECT id, title, rationale, status, authority, owner, decision, locked, scope, context,
         evidence, tags
       FROM decision WHERE "userId" = $1 AND ref = $2 ORDER BY id FOR UPDATE`,
      [request.ownerUserId, decisionRef],
    ))?.rows ?? []
    const evidenceRows = (await runQuery(
      `SELECT id, "workOrderId", result, repo, notes, "contentHash"
       FROM evidence_record WHERE "userId" = $1 AND ref = $2 ORDER BY id FOR UPDATE`,
      [request.ownerUserId, `EV-${decisionRef}`],
    ))?.rows ?? []
    const auditRows = (await runQuery(
      `SELECT id, metadata FROM event_log
       WHERE "userId" = $1 AND type = 'runtime.finding.owner_decided'
         AND register = 'work_orders' AND "refId" = $2
         AND metadata->>'gateSettlementEventId' = $3
       ORDER BY id FOR UPDATE`,
      [request.ownerUserId, request.parentWorkOrderRowId, String(request.gateSettlementEventId)],
    ))?.rows ?? []
    if (prior.length > 0) {
      const decisionRow = decisionRows[0]
      const evidenceRow = evidenceRows[0]
      const expectedMetadata = {
        ...receiptPayload,
        receiptDigest,
        decisionId: Number(decisionRow?.id),
        evidenceId: Number(evidenceRow?.id),
      }
      if (prior.length !== 1 || decisionRows.length !== 1 || evidenceRows.length !== 1
        || auditRows.length !== 1
        || canonicalJson(prior[0].metadata) !== canonicalJson(expectedMetadata)
        || Number(prior[0].evidenceId) !== Number(evidenceRow?.id)
        || decisionRow?.title !== `Runtime finding ${request.findingId}`
        || decisionRow?.rationale !== (choice === "APPROVE"
          ? "Owner authorized later materialization only."
          : "Owner denied the gated finding.")
        || decisionRow?.status !== (choice === "APPROVE" ? "accepted" : "rejected")
        || decisionRow?.authority !== "binding"
        || decisionRow?.owner !== request.ownerUserId
        || decisionRow?.decision !== choice || decisionRow?.locked !== true
        || decisionRow?.scope !== runtimeFindingDecisionScope(request.gateSettlementEventId)
        || decisionRow?.context !== canonicalJson(binding)
        || canonicalJson(decisionRow?.evidence) !== canonicalJson([
          `gate-settlement:${request.gateSettlementEventId}`,
          `source-finding:${request.sourceFindingEventId}`,
          `choice:${choice}`,
        ])
        || canonicalJson(decisionRow?.tags) !== canonicalJson([RUNTIME_FINDING_DECISION_PROTECTED_TAG, choice])
        || Number(evidenceRow?.workOrderId) !== request.parentWorkOrderRowId
        || evidenceRow?.result !== (choice === "APPROVE" ? "PASS" : "FAIL")
        || evidenceRow?.repo !== "bsvalues/terragroq"
        || evidenceRow?.notes !== canonicalJson(receiptPayload)
        || evidenceRow?.contentHash !== receiptDigest
        || canonicalJson(auditRows[0].metadata) !== canonicalJson(expectedMetadata)) {
        wall("RUNTIME_FINDING_DECISION_CONFLICT")
      }
      await runQuery("COMMIT")
      return { status: receiptPayload.disposition, choice, decisionRef, receiptDigest, resumeReleased: false, replayed: true }
    }
    if (decisionRows.length !== 0 || evidenceRows.length !== 0 || auditRows.length !== 0) {
      wall("RUNTIME_FINDING_DECISION_CONFLICT")
    }
    const oldestLive = await readPendingRuntimeFindingDecisionRequest({
      query: runQuery,
      ownerEmail: primaryDecisionProvenance.accountEmail,
    })
    if (!oldestLive || oldestLive.gateSettlementEventId !== request.gateSettlementEventId) {
      wall("RUNTIME_FINDING_DECISION_ORDER_WALL")
    }
    const decisionResult = await runQuery(
      `INSERT INTO decision
         ("userId", ref, title, context, decision, rationale, status, authority, owner, scope,
          evidence, tags, locked, "decidedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'binding', $1, $8, $9::text[], $10::text[], true, NOW())
       RETURNING id`,
      [
        request.ownerUserId,
        decisionRef,
        `Runtime finding ${request.findingId}`,
        canonicalJson(binding),
        choice,
        choice === "APPROVE" ? "Owner authorized later materialization only." : "Owner denied the gated finding.",
        choice === "APPROVE" ? "accepted" : "rejected",
        runtimeFindingDecisionScope(request.gateSettlementEventId),
        [`gate-settlement:${request.gateSettlementEventId}`, `source-finding:${request.sourceFindingEventId}`, `choice:${choice}`],
        [RUNTIME_FINDING_DECISION_PROTECTED_TAG, choice],
      ],
    )
    const decisionId = Number(decisionResult?.rows?.[0]?.id)
    if (!Number.isSafeInteger(decisionId) || decisionId <= 0) wall("RUNTIME_FINDING_DECISION_RECORD_WALL")
    const evidenceResult = await runQuery(
      `INSERT INTO evidence_record ("userId", ref, "workOrderId", result, repo, notes, "contentHash")
       VALUES ($1, $2, $3, $4, 'bsvalues/terragroq', $5, $6) RETURNING id`,
      [request.ownerUserId, `EV-${decisionRef}`, request.parentWorkOrderRowId,
        choice === "APPROVE" ? "PASS" : "FAIL", canonicalJson(receiptPayload), receiptDigest],
    )
    const evidenceId = Number(evidenceResult?.rows?.[0]?.id)
    if (!Number.isSafeInteger(evidenceId) || evidenceId <= 0) wall("RUNTIME_FINDING_DECISION_EVIDENCE_WALL")
    const metadata = { ...receiptPayload, receiptDigest, decisionId, evidenceId }
    await runQuery(
      `INSERT INTO governance_event
         ("userId", "eventType", "entityType", "entityId", actor, reason, "evidenceId", metadata)
       VALUES ($1, 'RUNTIME_FINDING_OWNER_DECIDED', 'work_order', $2, $1, $3, $4, $5::jsonb)`,
      [request.ownerUserId, String(request.parentWorkOrderRowId), receiptPayload.disposition, evidenceId, JSON.stringify(metadata)],
    )
    await runQuery(
      `INSERT INTO event_log ("userId", type, summary, register, "refId", metadata)
       VALUES ($1, 'runtime.finding.owner_decided', $2, 'work_orders', $3, $4::jsonb)`,
      [request.ownerUserId, `${decisionRef}: ${choice}`, request.parentWorkOrderRowId, JSON.stringify({ ...metadata, decisionId, evidenceId })],
    )
    await runQuery("COMMIT")
    return { status: receiptPayload.disposition, choice, decisionRef, receiptDigest, resumeReleased: false, replayed: false }
  } catch (error) {
    try { await runQuery("ROLLBACK") } catch {}
    throw error
  } finally {
    client?.release()
    if (pool) await pool.end()
  }
}
