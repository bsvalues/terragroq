import crypto from "node:crypto"

import {
  CodexProviderConformanceError,
  canonicalCodexProviderConformanceJson,
  evaluateCodexSessionCoordination,
  validateCodexProviderConformance,
  verifyCodexHostSessionIdentity,
} from "./codex-provider-conformance.mjs"
import { planHostedTeamWave } from "./hosted-team-plan.mjs"
import {
  WorkOrderEnvelopeV2Error,
  toDispatchEnvelope,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

const ADAPTER_ID = "hosted-codex-coordinator-adapter-v1"
const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "adapterId",
  "conformance",
  "completedWorkOrderIds",
  "envelopes",
  "roleProofs",
  "cancellationRequests",
])
const ROLE_PROOF_FIELDS = new Set([
  "workOrderId",
  "laneId",
  "role",
  "hostSessionProofReference",
])
const CANCELLATION_FIELDS = new Set([
  "workOrderId",
  "laneId",
  "requestedBy",
  "reasonCode",
])
const HOST_SESSION_PROOF_FIELDS = new Set(["proofId"])
const REQUIRED_ROLES = Object.freeze(["builder", "coordinator", "reviewer"])
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/
const CANCELLATION_REASONS = new Set([
  "AUTHORITY_REVOKED",
  "RESERVATION_REPLANNED",
  "VALIDATION_TERMINAL",
])

export class CodexCoordinatorAdapterError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "CodexCoordinatorAdapterError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new CodexCoordinatorAdapterError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("CODEX_COORDINATOR_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CODEX_COORDINATOR_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CODEX_COORDINATOR_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function safeIdentifier(value, field, pattern = SAFE_IDENTIFIER) {
  if (typeof value !== "string" || !pattern.test(value)) {
    wall("CODEX_COORDINATOR_FORMAT_WALL", field, "SAFE_IDENTIFIER_REQUIRED")
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

function normalizeCompletedWorkOrderIds(value) {
  if (!Array.isArray(value)) wall("CODEX_COORDINATOR_TYPE_WALL", "completedWorkOrderIds", "ARRAY_REQUIRED")
  const normalized = value
    .map((entry, index) => safeIdentifier(entry, `completedWorkOrderIds[${index}]`, WORK_ORDER_ID))
    .sort()
  if (new Set(normalized).size !== normalized.length) {
    wall("CODEX_COORDINATOR_DUPLICATE_WALL", "completedWorkOrderIds")
  }
  return normalized
}

function normalizeEnvelopes(value) {
  if (!Array.isArray(value) || value.length === 0) {
    wall("CODEX_COORDINATOR_TYPE_WALL", "envelopes", "NON_EMPTY_ARRAY_REQUIRED")
  }
  const records = value.map((raw, index) => {
    try {
      const validated = validateWorkOrderEnvelopeV2(raw)
      return {
        envelope: validated.envelope,
        contentHash: validated.contentHash,
        dispatchEnvelope: toDispatchEnvelope(validated.envelope),
      }
    } catch (error) {
      if (error instanceof WorkOrderEnvelopeV2Error) {
        wall("CODEX_COORDINATOR_ENVELOPE_WALL", `envelopes[${index}].${error.field}`, error.code)
      }
      throw error
    }
  }).sort((left, right) => left.envelope.workOrderId.localeCompare(right.envelope.workOrderId)
    || left.envelope.laneId.localeCompare(right.envelope.laneId))
  const keys = records.map(({ envelope }) => `${envelope.workOrderId}:${envelope.laneId}`)
  if (new Set(keys).size !== keys.length) wall("CODEX_COORDINATOR_DUPLICATE_WALL", "envelopes")
  return records
}

function normalizeRoleProofs(value) {
  if (!Array.isArray(value)) wall("CODEX_COORDINATOR_TYPE_WALL", "roleProofs", "ARRAY_REQUIRED")
  const proofs = value.map((raw, index) => {
    exactFields(raw, ROLE_PROOF_FIELDS, `roleProofs[${index}]`)
    exactFields(raw.hostSessionProofReference, HOST_SESSION_PROOF_FIELDS, `roleProofs[${index}].hostSessionProofReference`)
    const role = safeIdentifier(raw.role, `roleProofs[${index}].role`)
    if (!REQUIRED_ROLES.includes(role)) {
      wall("CODEX_COORDINATOR_ROLE_WALL", `roleProofs[${index}].role`, "COORDINATOR_BUILDER_REVIEWER_REQUIRED")
    }
    return {
      workOrderId: safeIdentifier(raw.workOrderId, `roleProofs[${index}].workOrderId`, WORK_ORDER_ID),
      laneId: safeIdentifier(raw.laneId, `roleProofs[${index}].laneId`),
      role,
      hostSessionProofReference: {
        proofId: safeIdentifier(raw.hostSessionProofReference.proofId, `roleProofs[${index}].hostSessionProofReference.proofId`),
      },
    }
  })
  const keys = proofs.map(({ workOrderId, laneId, role }) => `${workOrderId}:${laneId}:${role}`)
  if (new Set(keys).size !== keys.length) wall("CODEX_COORDINATOR_DUPLICATE_WALL", "roleProofs")
  return proofs
}

function normalizeCancellationRequests(value) {
  if (!Array.isArray(value)) wall("CODEX_COORDINATOR_TYPE_WALL", "cancellationRequests", "ARRAY_REQUIRED")
  const requests = value.map((raw, index) => {
    exactFields(raw, CANCELLATION_FIELDS, `cancellationRequests[${index}]`)
    const reasonCode = safeIdentifier(raw.reasonCode, `cancellationRequests[${index}].reasonCode`)
    if (!CANCELLATION_REASONS.has(reasonCode)) {
      wall("CODEX_COORDINATOR_CANCELLATION_WALL", `cancellationRequests[${index}].reasonCode`, "KNOWN_REASON_REQUIRED")
    }
    return {
      workOrderId: safeIdentifier(raw.workOrderId, `cancellationRequests[${index}].workOrderId`, WORK_ORDER_ID),
      laneId: safeIdentifier(raw.laneId, `cancellationRequests[${index}].laneId`),
      requestedBy: safeIdentifier(raw.requestedBy, `cancellationRequests[${index}].requestedBy`),
      reasonCode,
    }
  }).sort((left, right) => `${left.workOrderId}:${left.laneId}`.localeCompare(`${right.workOrderId}:${right.laneId}`))
  const keys = requests.map(({ workOrderId, laneId }) => `${workOrderId}:${laneId}`)
  if (new Set(keys).size !== keys.length) wall("CODEX_COORDINATOR_DUPLICATE_WALL", "cancellationRequests")
  return requests
}

function selectedEnvelope(records, workOrderId, laneId) {
  const record = records.find(({ envelope }) => envelope.workOrderId === workOrderId && envelope.laneId === laneId)
  if (!record) wall("CODEX_COORDINATOR_PLAN_WALL", `${workOrderId}:${laneId}`, "SELECTED_ENVELOPE_REQUIRED")
  return record
}

function assertSelectedBinding(plan, roleProofs, cancellationRequests) {
  const selected = new Set(plan.selected.map(({ workOrderId, laneId }) => `${workOrderId}:${laneId}`))
  for (const proof of roleProofs) {
    if (!selected.has(`${proof.workOrderId}:${proof.laneId}`)) {
      wall("CODEX_COORDINATOR_PLAN_WALL", `${proof.workOrderId}:${proof.laneId}:${proof.role}`, "SELECTED_LANE_PROOF_REQUIRED")
    }
  }
  for (const request of cancellationRequests) {
    if (!selected.has(`${request.workOrderId}:${request.laneId}`)) {
      wall("CODEX_COORDINATOR_CANCELLATION_WALL", `${request.workOrderId}:${request.laneId}`, "SELECTED_LANE_REQUIRED")
    }
  }
}

function roleProofFor(proofs, workOrderId, laneId, role) {
  const proof = proofs.find((entry) => entry.workOrderId === workOrderId && entry.laneId === laneId && entry.role === role)
  if (!proof) wall("CODEX_COORDINATOR_ROLE_WALL", `${workOrderId}:${laneId}:${role}`, "HOST_SESSION_PROOF_REQUIRED")
  return proof
}

function assignmentMessage(envelope, role, workerId, assignmentId) {
  return {
    messageId: `${assignmentId}:message`,
    from: envelope.teamRoles.coordinator,
    to: workerId,
    role,
    workOrderId: envelope.workOrderId,
    laneId: envelope.laneId,
    delivery: "NATIVE_AGENT_MESSAGE_READY",
    payload: {
      objective: envelope.objective,
      reservations: envelope.reservations,
      requiredValidation: envelope.requiredValidation,
      evidenceTargets: envelope.evidenceTargets,
    },
    secretFree: true,
    ownerRelayRequired: false,
  }
}

export function adaptCodexCoordinatorPlan(input) {
  exactFields(input, INPUT_FIELDS, "coordinatorAdapter")
  if (input.schemaVersion !== 1) wall("CODEX_COORDINATOR_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "CODEX_COORDINATOR_ADAPTER_INPUT") {
    wall("CODEX_COORDINATOR_INPUT_WALL", "artifactType", "CODEX_COORDINATOR_ADAPTER_INPUT_REQUIRED")
  }
  if (input.adapterId !== ADAPTER_ID) wall("CODEX_COORDINATOR_INPUT_WALL", "adapterId", `${ADAPTER_ID}_REQUIRED`)

  const completedWorkOrderIds = normalizeCompletedWorkOrderIds(input.completedWorkOrderIds)
  let validatedConformance
  try {
    validatedConformance = validateCodexProviderConformance(input.conformance)
  } catch (error) {
    if (error instanceof CodexProviderConformanceError) {
      wall("CODEX_COORDINATOR_CONFORMANCE_WALL", "conformance", error.code)
    }
    throw error
  }
  const envelopeRecords = normalizeEnvelopes(input.envelopes)
  const roleProofs = normalizeRoleProofs(input.roleProofs)
  const cancellationRequests = normalizeCancellationRequests(input.cancellationRequests)
  const plan = planHostedTeamWave({
    schemaVersion: 1,
    artifactType: "HOSTED_TEAM_PLAN_INPUT",
    completedWorkOrderIds,
    candidates: envelopeRecords.map(({ dispatchEnvelope }) => dispatchEnvelope),
  })
  assertSelectedBinding(plan, roleProofs, cancellationRequests)

  const assignments = []
  const messages = []
  const cancellations = []
  for (const selected of plan.selected) {
    const record = selectedEnvelope(envelopeRecords, selected.workOrderId, selected.laneId)
    const cancel = cancellationRequests.find(({ workOrderId, laneId }) =>
      workOrderId === selected.workOrderId && laneId === selected.laneId)
    if (cancel && cancel.requestedBy !== record.envelope.teamRoles.coordinator) {
      wall("CODEX_COORDINATOR_CANCELLATION_WALL", `${cancel.workOrderId}:${cancel.laneId}.requestedBy`, "COORDINATOR_REQUIRED")
    }
    for (const role of REQUIRED_ROLES) {
      const proof = roleProofFor(roleProofs, selected.workOrderId, selected.laneId, role)
      let coordination
      try {
        coordination = evaluateCodexSessionCoordination({
          conformance: validatedConformance.conformance,
          envelope: record.envelope,
          requestedRole: role,
          runtimeActivationRequested: false,
          hostSession: verifyCodexHostSessionIdentity(proof.hostSessionProofReference),
        })
      } catch (error) {
        if (error instanceof CodexProviderConformanceError) {
          wall("CODEX_COORDINATOR_CONFORMANCE_WALL", `${selected.workOrderId}:${selected.laneId}:${role}`, error.code)
        }
        throw error
      }
      const assignmentId = `${selected.workOrderId}:${selected.laneId}:${role}`
      assignments.push({
        assignmentId,
        workOrderId: selected.workOrderId,
        laneId: selected.laneId,
        laneOrdinal: selected.laneOrdinal,
        role,
        workerId: coordination.workerId,
        hostSessionProofId: coordination.hostSessionProofId,
        envelopeContentHash: record.contentHash,
        dispatchContentHash: selected.contentHash,
        state: cancel ? "CANCELLATION_READY" : "ASSIGNMENT_READY",
        cancellationSupported: true,
        dispatchPerformed: false,
      })
      messages.push(assignmentMessage(record.envelope, role, coordination.workerId, assignmentId))
    }
    if (cancel) {
      cancellations.push({
        workOrderId: cancel.workOrderId,
        laneId: cancel.laneId,
        requestedBy: cancel.requestedBy,
        reasonCode: cancel.reasonCode,
        state: "CANCELLATION_READY",
        dispatchPerformed: false,
      })
    }
  }

  const output = {
    schemaVersion: 1,
    artifactType: "CODEX_COORDINATOR_ADAPTER_RESULT",
    adapterId: ADAPTER_ID,
    status: plan.selected.length > 0 ? "COORDINATOR_ASSIGNMENTS_READY" : "NO_ELIGIBLE_ASSIGNMENTS",
    planStatus: plan.status,
    selected: plan.selected,
    blocked: plan.blocked,
    assignments,
    messages,
    cancellations,
    evidence: {
      sanitized: true,
      planHash: contentHash(plan),
      assignmentHash: contentHash(assignments),
      messageHash: contentHash(messages),
      conformanceHash: contentHash(input.conformance),
      conformanceContentHash: validatedConformance.contentHash,
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

export function codexCoordinatorAdapterFixture() {
  return {
    schemaVersion: 1,
    artifactType: "CODEX_COORDINATOR_ADAPTER_INPUT",
    adapterId: ADAPTER_ID,
    conformance: null,
    completedWorkOrderIds: [],
    envelopes: [],
    roleProofs: [],
    cancellationRequests: [],
  }
}

export function canonicalCodexCoordinatorAdapterJson(value) {
  return canonicalCodexProviderConformanceJson(value)
}

export const CODEX_COORDINATOR_ADAPTER_ID = ADAPTER_ID
