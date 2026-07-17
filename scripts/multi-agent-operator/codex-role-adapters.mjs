import crypto from "node:crypto"

import {
  canonicalCodexProviderConformanceJson,
} from "./codex-provider-conformance.mjs"
import {
  HostedCodexCoordinatorAdapterError,
  captureHostedCodexNativeEvidence,
  createHostedCodexNativeMessage,
  getHostedCodexNativeAssignmentHandle,
  startHostedCodexNativeAssignment,
} from "./codex-coordinator-adapter.mjs"
import {
  WorkOrderEnvelopeV2Error,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

const ADAPTER_ID = "hosted-codex-role-adapters-v1"
const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "adapterId",
  "envelope",
  "coordinatorPlan",
  "stages",
])
const COORDINATOR_RESULT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "adapterRunId",
  "topologyId",
  "topologyHash",
  "adapterId",
  "status",
  "providerId",
  "currentSessionOnly",
  "assignmentCount",
  "concurrency",
  "assignments",
  "communication",
  "cancellation",
  "evidence",
  "ownerTouchBudget",
  "ownerOperationEvidenceCertified",
  "dispatchPerformed",
  "durableTransportClaimed",
  "durablePersistenceClaimed",
  "serviceWorkerClaimed",
  "localIssue357Allowed",
  "credentialInspectionAllowed",
  "authorityMintingAllowed",
  "providerContractDispatchAllowed",
  "runtimeActivationAllowed",
  "authorityGranted",
  "planContentHash",
])
const ASSIGNMENT_FIELDS = new Set([
  "assignmentId",
  "workOrderId",
  "laneId",
  "role",
  "workerId",
  "phase",
  "taskPayload",
  "envelopeContentHash",
  "hostIdentityDigest",
  "conformanceContentHash",
  "preventiveTrustContentHash",
  "authorityGrantId",
  "cancellationSupported",
  "messagePolicy",
  "nativeAssignmentPrepared",
  "nativeAssignmentExecuted",
  "nativeBindingRequired",
  "nativeBindingEstablished",
  "authorityGranted",
])
const STAGE_FIELDS = new Set([
  "stageId",
  "stage",
  "role",
  "workerId",
  "startIdempotencyKey",
  "messageType",
  "messageSummary",
  "messageIdempotencyKey",
  "observationId",
  "review",
  "remediationCycle",
])
const REVIEW_FIELDS = new Set(["verdict", "unresolvedThreads"])
const CAPTURED_EVIDENCE_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "adapterRunId",
  "assignmentId",
  "observationId",
  "providerId",
  "adapterId",
  "workOrderId",
  "laneId",
  "providerState",
  "reasonCode",
  "providerResponseType",
  "providerResponseHash",
  "terminalState",
  "sanitized",
  "rawProviderOutputIncluded",
  "independentlyCaptured",
  "durablePersistenceClaimed",
  "authorityGranted",
])
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const REQUIRED_STAGES = Object.freeze([
  "BUILD",
  "ASSURANCE_REVIEW",
  "REMEDIATION",
  "REREVIEW",
])

export class CodexRoleAdapterError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "CodexRoleAdapterError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new CodexRoleAdapterError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("CODEX_ROLE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CODEX_ROLE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CODEX_ROLE_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function safeIdentifier(value, field) {
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
    wall("CODEX_ROLE_FORMAT_WALL", field, "SAFE_IDENTIFIER_REQUIRED")
  }
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}

function normalizeCoordinatorResult(value, envelope) {
  exactFields(value, COORDINATOR_RESULT_FIELDS, "coordinatorResult")
  if (value.schemaVersion !== 1 || value.artifactType !== "HOSTED_CODEX_COORDINATOR_PLAN") {
    wall("CODEX_ROLE_COORDINATOR_WALL", "coordinatorResult.artifactType", "HOSTED_COORDINATOR_PLAN_REQUIRED")
  }
  if (value.providerId !== "hosted-codex" || value.adapterId !== "hosted-codex-session-native-team-v1") {
    wall("CODEX_ROLE_COORDINATOR_WALL", "coordinatorResult.adapterId", "CURRENT_SESSION_NATIVE_TEAM_REQUIRED")
  }
  if (value.status !== "CURRENT_SESSION_NATIVE_TEAM_READY" || value.currentSessionOnly !== true) {
    wall("CODEX_ROLE_COORDINATOR_WALL", "coordinatorResult.status", "CURRENT_SESSION_READY_REQUIRED")
  }
  for (const field of [
    "dispatchPerformed",
    "providerContractDispatchAllowed",
    "runtimeActivationAllowed",
    "authorityGranted",
    "durableTransportClaimed",
    "durablePersistenceClaimed",
    "serviceWorkerClaimed",
    "localIssue357Allowed",
    "credentialInspectionAllowed",
    "authorityMintingAllowed",
    "ownerOperationEvidenceCertified",
  ]) {
    if (value[field] !== false) wall("CODEX_ROLE_AUTHORITY_WALL", `coordinatorResult.${field}`, "FALSE_REQUIRED")
  }
  if (!Array.isArray(value.assignments)) wall("CODEX_ROLE_TYPE_WALL", "coordinatorResult.assignments", "ARRAY_REQUIRED")
  if (value.assignmentCount !== value.assignments.length) {
    wall("CODEX_ROLE_COORDINATOR_WALL", "coordinatorResult.assignmentCount", "ASSIGNMENT_COUNT_MATCH_REQUIRED")
  }
  const assignments = value.assignments.map((raw, index) => {
    exactFields(raw, ASSIGNMENT_FIELDS, `coordinatorResult.assignments[${index}]`)
    const assignment = {
      assignmentId: safeIdentifier(raw.assignmentId, `coordinatorResult.assignments[${index}].assignmentId`),
      workOrderId: safeIdentifier(raw.workOrderId, `coordinatorResult.assignments[${index}].workOrderId`),
      laneId: safeIdentifier(raw.laneId, `coordinatorResult.assignments[${index}].laneId`),
      role: safeIdentifier(raw.role, `coordinatorResult.assignments[${index}].role`),
      workerId: safeIdentifier(raw.workerId, `coordinatorResult.assignments[${index}].workerId`),
      phase: safeIdentifier(raw.phase, `coordinatorResult.assignments[${index}].phase`),
      nativeAssignmentPrepared: raw.nativeAssignmentPrepared,
      nativeAssignmentExecuted: raw.nativeAssignmentExecuted,
      nativeBindingRequired: raw.nativeBindingRequired,
      nativeBindingEstablished: raw.nativeBindingEstablished,
      authorityGranted: raw.authorityGranted,
    }
    if (assignment.workOrderId !== envelope.workOrderId || assignment.laneId !== envelope.laneId) {
      wall("CODEX_ROLE_COORDINATOR_WALL", `coordinatorResult.assignments[${index}]`, "ENVELOPE_LANE_REQUIRED")
    }
    if (assignment.nativeAssignmentPrepared !== true || assignment.nativeAssignmentExecuted !== false
      || assignment.authorityGranted !== false) {
      wall("CODEX_ROLE_COORDINATOR_WALL", `coordinatorResult.assignments[${index}]`, "PREPARED_WITHOUT_EXECUTION_REQUIRED")
    }
    const coordinator = assignment.role === "coordinator"
    if (assignment.nativeBindingRequired !== !coordinator || assignment.nativeBindingEstablished !== coordinator) {
      wall("CODEX_ROLE_COORDINATOR_WALL", `coordinatorResult.assignments[${index}]`, "OPAQUE_NATIVE_BINDING_STATE_REQUIRED")
    }
    return assignment
  })
  return assignments
}

function assignmentFor(assignments, role) {
  const assignment = assignments.find((entry) => entry.role === role)
  if (!assignment) wall("CODEX_ROLE_COORDINATOR_WALL", `coordinatorResult.assignments.${role}`, "ASSIGNMENT_REQUIRED")
  return assignment
}

function normalizeReview(value, field, finalReview = false) {
  exactFields(value, REVIEW_FIELDS, field)
  if (!["APPROVED", "REQUESTED_CHANGES"].includes(value.verdict)) {
    wall("CODEX_ROLE_REVIEW_WALL", `${field}.verdict`, "KNOWN_VERDICT_REQUIRED")
  }
  if (!Number.isSafeInteger(value.unresolvedThreads) || value.unresolvedThreads < 0 || value.unresolvedThreads > 100) {
    wall("CODEX_ROLE_REVIEW_WALL", `${field}.unresolvedThreads`, "BOUNDED_INTEGER_REQUIRED")
  }
  if (finalReview && (value.verdict !== "APPROVED" || value.unresolvedThreads !== 0)) {
    wall("CODEX_ROLE_REVIEW_WALL", field, "FINAL_REREVIEW_APPROVAL_REQUIRED")
  }
  return { verdict: value.verdict, unresolvedThreads: value.unresolvedThreads }
}

function getAssignmentHandle(plan, assignmentId, field) {
  try {
    return getHostedCodexNativeAssignmentHandle(plan, assignmentId)
  } catch (error) {
    if (error instanceof HostedCodexCoordinatorAdapterError) {
      wall("CODEX_ROLE_COORDINATOR_WALL", field, error.code)
    }
    throw error
  }
}

function runNativeStage(plan, assignment, raw, index, envelope) {
  const handle = getAssignmentHandle(plan, assignment.assignmentId, `stages[${index}].assignmentHandle`)
  if (raw.startIdempotencyKey !== null) {
    try {
      startHostedCodexNativeAssignment(plan, {
        assignmentHandle: handle,
        idempotencyKey: safeIdentifier(raw.startIdempotencyKey, `stages[${index}].startIdempotencyKey`),
      })
    } catch (error) {
      if (error instanceof HostedCodexCoordinatorAdapterError) {
        wall("CODEX_ROLE_NATIVE_STAGE_WALL", `stages[${index}].start`, error.code)
      }
      throw error
    }
  }
  try {
    createHostedCodexNativeMessage(plan, {
      assignmentHandle: handle,
      direction: "TO_ASSIGNMENT",
      messageType: safeIdentifier(raw.messageType, `stages[${index}].messageType`),
      summary: raw.messageSummary,
      idempotencyKey: safeIdentifier(raw.messageIdempotencyKey, `stages[${index}].messageIdempotencyKey`),
    })
  } catch (error) {
    if (error instanceof HostedCodexCoordinatorAdapterError) {
      wall("CODEX_ROLE_NATIVE_STAGE_WALL", `stages[${index}].message`, error.code)
    }
    throw error
  }
  let response
  try {
    response = captureHostedCodexNativeEvidence(plan, {
      assignmentHandle: handle,
      observationId: safeIdentifier(raw.observationId, `stages[${index}].observationId`),
    })
  } catch (error) {
    if (error instanceof HostedCodexCoordinatorAdapterError) {
      if (error.code === "HOSTED_CODEX_REPLAY_WALL") {
        wall("CODEX_ROLE_REPLAY_WALL", `stages[${index}].observation`, error.detail ?? error.code)
      }
      wall("CODEX_ROLE_NATIVE_STAGE_WALL", `stages[${index}].observation`, error.code)
    }
    throw error
  }
  try {
    exactFields(response, CAPTURED_EVIDENCE_FIELDS, `stages[${index}].capturedEvidence`)
  } catch (error) {
    if (error instanceof CodexRoleAdapterError) throw error
    wall("CODEX_ROLE_PROVIDER_RESPONSE_WALL", `stages[${index}].providerResponse`, "CAPTURED_EVIDENCE_REQUIRED")
  }
  if (response.workOrderId !== envelope.workOrderId || response.laneId !== envelope.laneId
    || response.assignmentId !== assignment.assignmentId || !["RUNNING", "SUCCEEDED"].includes(response.providerState)) {
    wall("CODEX_ROLE_STAGE_WALL", `stages[${index}].providerResponse`, "BOUND_ACTIVE_OR_SUCCEEDED_EVIDENCE_REQUIRED")
  }
  if (response.sanitized !== true || response.rawProviderOutputIncluded !== false
    || response.independentlyCaptured !== true || response.durablePersistenceClaimed !== false
    || response.authorityGranted !== false) {
    wall("CODEX_ROLE_STAGE_WALL", `stages[${index}].providerResponse`, "SANITIZED_INDEPENDENT_EVIDENCE_REQUIRED")
  }
  return response
}

function normalizeStages(value, envelope, plan, assignments) {
  if (!Array.isArray(value) || value.length !== REQUIRED_STAGES.length) {
    wall("CODEX_ROLE_STAGE_WALL", "stages", "FOUR_STAGE_CHAIN_REQUIRED")
  }
  return value.map((raw, index) => {
    exactFields(raw, STAGE_FIELDS, `stages[${index}]`)
    const expectedStage = REQUIRED_STAGES[index]
    if (raw.stage !== expectedStage) wall("CODEX_ROLE_STAGE_WALL", `stages[${index}].stage`, `${expectedStage}_REQUIRED`)
    const role = safeIdentifier(raw.role, `stages[${index}].role`)
    const assignment = assignmentFor(assignments, role === "remediator" ? "builder" : role)
    const response = runNativeStage(plan, assignment, raw, index, envelope)
    return {
      stageId: safeIdentifier(raw.stageId, `stages[${index}].stageId`),
      stage: expectedStage,
      role,
      workerId: safeIdentifier(raw.workerId, `stages[${index}].workerId`),
      providerResponse: response,
      review: raw.review === null ? null : normalizeReview(raw.review, `stages[${index}].review`, expectedStage === "REREVIEW"),
      remediationCycle: raw.remediationCycle,
    }
  })
}

function assertStageSemantics(stages, envelope) {
  const [build, review, remediation, rereview] = stages
  const expectations = [
    [build, "builder", null],
    [review, "reviewer", "REQUESTED_CHANGES"],
    [remediation, "remediator", null],
    [rereview, "reviewer", "APPROVED"],
  ]
  for (const [stage, role, verdict] of expectations) {
    if (stage.role !== role) wall("CODEX_ROLE_STAGE_WALL", `${stage.stage}.role`, `${role.toUpperCase()}_REQUIRED`)
    const expectedWorker = role === "remediator" ? envelope.teamRoles.builder : envelope.teamRoles[role]
    if (stage.workerId !== expectedWorker) {
      wall(role === "remediator" ? "CODEX_ROLE_REMEDIATION_WALL" : "CODEX_ROLE_STAGE_WALL", `${stage.stage}.workerId`, "ENVELOPE_ROLE_IDENTITY_REQUIRED")
    }
    if (verdict !== null && stage.review?.verdict !== verdict) {
      wall("CODEX_ROLE_REVIEW_WALL", `${stage.stage}.review.verdict`, `${verdict}_REQUIRED`)
    }
  }
  if (review.review === null || rereview.review === null) {
    wall("CODEX_ROLE_REVIEW_WALL", "stages.review", "REVIEW_REQUIRED")
  }
  if (remediation.workerId !== build.workerId) {
    wall("CODEX_ROLE_REMEDIATION_WALL", "stages.REMEDIATION.workerId", "ORIGINAL_BUILDER_REQUIRED")
  }
  if (!Number.isSafeInteger(remediation.remediationCycle) || remediation.remediationCycle < 1
    || remediation.remediationCycle > envelope.remediationBudget.maxCycles) {
    wall("CODEX_ROLE_REMEDIATION_WALL", "stages.REMEDIATION.remediationCycle", "WITHIN_REMEDIATION_BUDGET_REQUIRED")
  }
  for (const stage of [build, review, rereview]) {
    if (stage.remediationCycle !== null) {
      wall("CODEX_ROLE_REMEDIATION_WALL", `${stage.stage}.remediationCycle`, "NULL_REQUIRED")
    }
  }
}

export function adaptCodexRoleLifecycle(input) {
  exactFields(input, INPUT_FIELDS, "roleAdapter")
  if (input.schemaVersion !== 1) wall("CODEX_ROLE_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "CODEX_ROLE_ADAPTER_INPUT") {
    wall("CODEX_ROLE_INPUT_WALL", "artifactType", "CODEX_ROLE_ADAPTER_INPUT_REQUIRED")
  }
  if (input.adapterId !== ADAPTER_ID) wall("CODEX_ROLE_INPUT_WALL", "adapterId", `${ADAPTER_ID}_REQUIRED`)

  let envelopeResult
  try {
    envelopeResult = validateWorkOrderEnvelopeV2(input.envelope)
  } catch (error) {
    if (error instanceof WorkOrderEnvelopeV2Error) {
      wall("CODEX_ROLE_ENVELOPE_WALL", `envelope.${error.field}`, error.code)
    }
    throw error
  }
  const envelope = envelopeResult.envelope
  for (const role of ["builder", "reviewer"]) {
    if (!Object.hasOwn(envelope.teamRoles, role)) {
      wall("CODEX_ROLE_ENVELOPE_WALL", `envelope.teamRoles.${role}`, "ROLE_REQUIRED")
    }
  }

  const assignments = normalizeCoordinatorResult(input.coordinatorPlan, envelope)
  const stages = normalizeStages(input.stages, envelope, input.coordinatorPlan, assignments)
  assertStageSemantics(stages, envelope)

  const roleAdapters = []
  for (const role of ["builder", "reviewer", "remediator"]) {
    const assignment = assignmentFor(assignments, role === "remediator" ? "builder" : role)
    roleAdapters.push({
      role,
      workerId: assignment.workerId,
      hostSessionProofId: null,
      state: "ROLE_ADAPTER_READY",
      providerContractDispatchAllowed: false,
      dispatchPerformed: false,
      durablePersistenceClaimed: false,
      serviceWorkerClaimed: false,
      runtimeActivationAllowed: false,
      authorityGranted: false,
    })
  }

  const output = {
    schemaVersion: 1,
    artifactType: "CODEX_ROLE_ADAPTER_RESULT",
    adapterId: ADAPTER_ID,
    status: "ROLE_LIFECYCLE_PROVEN",
    workOrderId: envelope.workOrderId,
    laneId: envelope.laneId,
    roleAdapters,
    stages,
    evidence: {
      sanitized: true,
      envelopeContentHash: envelopeResult.contentHash,
      coordinatorPlanContentHash: input.coordinatorPlan.planContentHash,
      coordinatorAssignmentHash: contentHash(assignments),
      stageHash: contentHash(stages),
      responseHashes: stages.map(({ providerResponse }) => contentHash(providerResponse)),
    },
    ownerRelayRequired: false,
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function canonicalCodexRoleAdapterJson(value) {
  return canonicalCodexProviderConformanceJson(value)
}

export const CODEX_ROLE_ADAPTER_ID = ADAPTER_ID
