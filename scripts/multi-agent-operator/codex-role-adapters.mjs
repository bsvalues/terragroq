import crypto from "node:crypto"

import {
  CodexProviderConformanceError,
  canonicalCodexProviderConformanceJson,
  evaluateCodexSessionCoordination,
  validateCodexProviderConformance,
  verifyCodexHostSessionIdentity,
} from "./codex-provider-conformance.mjs"
import { ProviderContractError, validateProviderResponse } from "./provider-contract.mjs"
import {
  WorkOrderEnvelopeV2Error,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

const ADAPTER_ID = "hosted-codex-role-adapters-v1"
const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "adapterId",
  "conformance",
  "envelope",
  "coordinatorResult",
  "roleProofs",
  "stages",
])
const COORDINATOR_RESULT_FIELDS = new Set([
  "adapterId",
  "status",
  "assignments",
  "dispatchPerformed",
  "providerContractDispatchAllowed",
  "runtimeActivationAllowed",
  "authorityGranted",
])
const ASSIGNMENT_FIELDS = new Set([
  "assignmentId",
  "workOrderId",
  "laneId",
  "role",
  "workerId",
  "state",
  "dispatchPerformed",
])
const ROLE_PROOF_FIELDS = new Set([
  "role",
  "workerId",
  "hostSessionProofReference",
])
const HOST_SESSION_PROOF_FIELDS = new Set(["proofId"])
const STAGE_FIELDS = new Set([
  "stageId",
  "stage",
  "role",
  "workerId",
  "providerResponse",
  "review",
  "remediationCycle",
])
const REVIEW_FIELDS = new Set(["verdict", "unresolvedThreads"])
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
  if (value.adapterId !== "hosted-codex-coordinator-adapter-v1") {
    wall("CODEX_ROLE_COORDINATOR_WALL", "coordinatorResult.adapterId", "HOSTED_COORDINATOR_ADAPTER_REQUIRED")
  }
  if (value.status !== "COORDINATOR_ASSIGNMENTS_READY") {
    wall("CODEX_ROLE_COORDINATOR_WALL", "coordinatorResult.status", "ASSIGNMENTS_READY_REQUIRED")
  }
  for (const field of ["dispatchPerformed", "providerContractDispatchAllowed", "runtimeActivationAllowed", "authorityGranted"]) {
    if (value[field] !== false) wall("CODEX_ROLE_AUTHORITY_WALL", `coordinatorResult.${field}`, "FALSE_REQUIRED")
  }
  if (!Array.isArray(value.assignments)) wall("CODEX_ROLE_TYPE_WALL", "coordinatorResult.assignments", "ARRAY_REQUIRED")
  const assignments = value.assignments.map((raw, index) => {
    exactFields(raw, ASSIGNMENT_FIELDS, `coordinatorResult.assignments[${index}]`)
    const assignment = {
      assignmentId: safeIdentifier(raw.assignmentId, `coordinatorResult.assignments[${index}].assignmentId`),
      workOrderId: safeIdentifier(raw.workOrderId, `coordinatorResult.assignments[${index}].workOrderId`),
      laneId: safeIdentifier(raw.laneId, `coordinatorResult.assignments[${index}].laneId`),
      role: safeIdentifier(raw.role, `coordinatorResult.assignments[${index}].role`),
      workerId: safeIdentifier(raw.workerId, `coordinatorResult.assignments[${index}].workerId`),
      state: raw.state,
      dispatchPerformed: raw.dispatchPerformed,
    }
    if (assignment.workOrderId !== envelope.workOrderId || assignment.laneId !== envelope.laneId) {
      wall("CODEX_ROLE_COORDINATOR_WALL", `coordinatorResult.assignments[${index}]`, "ENVELOPE_LANE_REQUIRED")
    }
    if (assignment.state !== "ASSIGNMENT_READY" || assignment.dispatchPerformed !== false) {
      wall("CODEX_ROLE_COORDINATOR_WALL", `coordinatorResult.assignments[${index}].state`, "READY_WITHOUT_DISPATCH_REQUIRED")
    }
    return assignment
  })
  return assignments
}

function normalizeRoleProofs(value) {
  if (!Array.isArray(value)) wall("CODEX_ROLE_TYPE_WALL", "roleProofs", "ARRAY_REQUIRED")
  const proofs = value.map((raw, index) => {
    exactFields(raw, ROLE_PROOF_FIELDS, `roleProofs[${index}]`)
    exactFields(raw.hostSessionProofReference, HOST_SESSION_PROOF_FIELDS, `roleProofs[${index}].hostSessionProofReference`)
    return {
      role: safeIdentifier(raw.role, `roleProofs[${index}].role`),
      workerId: safeIdentifier(raw.workerId, `roleProofs[${index}].workerId`),
      hostSessionProofReference: {
        proofId: safeIdentifier(raw.hostSessionProofReference.proofId, `roleProofs[${index}].hostSessionProofReference.proofId`),
      },
    }
  })
  const keys = proofs.map(({ role }) => role)
  if (new Set(keys).size !== keys.length) wall("CODEX_ROLE_DUPLICATE_WALL", "roleProofs")
  return proofs
}

function proofFor(roleProofs, role) {
  const proof = roleProofs.find((entry) => entry.role === role)
  if (!proof) wall("CODEX_ROLE_PROOF_WALL", `roleProofs.${role}`, "HOST_SESSION_PROOF_REQUIRED")
  return proof
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

function normalizeStages(value, envelope) {
  if (!Array.isArray(value) || value.length !== REQUIRED_STAGES.length) {
    wall("CODEX_ROLE_STAGE_WALL", "stages", "FOUR_STAGE_CHAIN_REQUIRED")
  }
  return value.map((raw, index) => {
    exactFields(raw, STAGE_FIELDS, `stages[${index}]`)
    const expectedStage = REQUIRED_STAGES[index]
    if (raw.stage !== expectedStage) wall("CODEX_ROLE_STAGE_WALL", `stages[${index}].stage`, `${expectedStage}_REQUIRED`)
    let response
    try {
      response = validateProviderResponse(raw.providerResponse)
    } catch (error) {
      if (error instanceof ProviderContractError) {
        wall("CODEX_ROLE_PROVIDER_RESPONSE_WALL", `stages[${index}].providerResponse`, error.code)
      }
      throw error
    }
    if (response.workOrderId !== envelope.workOrderId || response.laneId !== envelope.laneId) {
      wall("CODEX_ROLE_STAGE_WALL", `stages[${index}].providerResponse`, "ENVELOPE_LANE_REQUIRED")
    }
    if (response.providerState !== "SUCCEEDED") {
      wall("CODEX_ROLE_STAGE_WALL", `stages[${index}].providerResponse.providerState`, "SUCCEEDED_REQUIRED")
    }
    return {
      stageId: safeIdentifier(raw.stageId, `stages[${index}].stageId`),
      stage: expectedStage,
      role: safeIdentifier(raw.role, `stages[${index}].role`),
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
  wall(
    "CODEX_ROLE_ADAPTER_INVALIDATED_PENDING_REPROOF",
    "roleAdapter",
    "WO_MAO_031_REDESIGN_AND_INDEPENDENT_REPROOF_REQUIRED",
  )
  exactFields(input, INPUT_FIELDS, "roleAdapter")
  if (input.schemaVersion !== 1) wall("CODEX_ROLE_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "CODEX_ROLE_ADAPTER_INPUT") {
    wall("CODEX_ROLE_INPUT_WALL", "artifactType", "CODEX_ROLE_ADAPTER_INPUT_REQUIRED")
  }
  if (input.adapterId !== ADAPTER_ID) wall("CODEX_ROLE_INPUT_WALL", "adapterId", `${ADAPTER_ID}_REQUIRED`)

  let validatedConformance
  try {
    validatedConformance = validateCodexProviderConformance(input.conformance)
  } catch (error) {
    if (error instanceof CodexProviderConformanceError) {
      wall("CODEX_ROLE_CONFORMANCE_WALL", "conformance", error.code)
    }
    throw error
  }

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

  const assignments = normalizeCoordinatorResult(input.coordinatorResult, envelope)
  const roleProofs = normalizeRoleProofs(input.roleProofs)
  const stages = normalizeStages(input.stages, envelope)
  assertStageSemantics(stages, envelope)

  const roleAdapters = []
  for (const role of ["builder", "reviewer", "remediator"]) {
    const proof = proofFor(roleProofs, role)
    const assignment = assignmentFor(assignments, role === "remediator" ? "builder" : role)
    const requestedRole = role === "remediator" ? "builder" : role
    let coordination
    try {
      coordination = evaluateCodexSessionCoordination({
        conformance: validatedConformance.conformance,
        envelope,
        requestedRole,
        runtimeActivationRequested: false,
        hostSession: verifyCodexHostSessionIdentity(proof.hostSessionProofReference),
      })
    } catch (error) {
      if (error instanceof CodexProviderConformanceError) {
        wall("CODEX_ROLE_CONFORMANCE_WALL", `roleProofs.${role}`, error.code)
      }
      throw error
    }
    if (proof.workerId !== coordination.workerId || (role !== "remediator" && assignment.workerId !== coordination.workerId)) {
      wall("CODEX_ROLE_PROOF_WALL", `roleProofs.${role}.workerId`, "HOST_SESSION_WORKER_MATCH_REQUIRED")
    }
    roleAdapters.push({
      role,
      workerId: coordination.workerId,
      hostSessionProofId: coordination.hostSessionProofId,
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
      conformanceContentHash: validatedConformance.contentHash,
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
