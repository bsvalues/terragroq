import crypto from "node:crypto"

import {
  DispatchEnvelopeError,
  validateDispatchEnvelope,
} from "./dispatch-envelope.mjs"

const ARTIFACT_TYPE = "WORK_ORDER_ENVELOPE_V2"
const COMMUNICATION_POLICY = "FINAL_ONLY"
const OPTIONAL_TOP_LEVEL_FIELDS = new Set([
  "dependencyPolicies",
  "providerBinding",
])
const DEPENDENCY_POLICY_FIELDS = new Set([
  "dependencyWorkOrderId",
  "satisfaction",
  "providerId",
  "assessmentWorkOrderId",
])
const PROVIDER_BINDING_FIELDS = new Set([
  "providerId",
  "assessmentWorkOrderId",
  "subjectWorkOrderId",
  "role",
])
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const OWNER_COUNTER_FIELDS = Object.freeze([
  "credentialTouches",
  "diagnosticTouches",
  "operationTouches",
  "routineContacts",
  "routineDecisions",
])
const TOP_LEVEL_FIELDS = new Set([
  "artifactType",
  "schemaVersion",
  "programId",
  "goalId",
  "loopId",
  "workOrderId",
  "objective",
  "riskClass",
  "repositories",
  "baseRefs",
  "dependencies",
  "fanInGate",
  "laneId",
  "teamRoles",
  "providerRequirements",
  "preferredProviders",
  "fallbackProviders",
  "reservations",
  "allowedActions",
  "forbiddenActions",
  "authorityGrantRefs",
  "programActivationGrantRef",
  "grantStatusEventRefs",
  "requiredOutputs",
  "requiredValidation",
  "reviewRequirements",
  "mergeMode",
  "retryBudget",
  "remediationBudget",
  "reroutePolicy",
  "stopConditions",
  "evidenceTargets",
  "ownerDecisionConditions",
  "ownerOperationsAllowed",
  "ownerTouchBudget",
  "communicationPolicy",
  ...OPTIONAL_TOP_LEVEL_FIELDS,
])

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

export class WorkOrderEnvelopeV2Error extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "WorkOrderEnvelopeV2Error"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new WorkOrderEnvelopeV2Error(code, field, detail)
}

function assertExactTopLevelFields(value) {
  if (!plainObject(value)) wall("WORK_ORDER_ENVELOPE_TYPE_WALL", "envelope", "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !TOP_LEVEL_FIELDS.has(key)).sort()
  if (unknown.length > 0) wall("WORK_ORDER_ENVELOPE_UNKNOWN_FIELD_WALL", `envelope.${unknown[0]}`)
  const missing = [...TOP_LEVEL_FIELDS]
    .filter((key) => !OPTIONAL_TOP_LEVEL_FIELDS.has(key) && !Object.hasOwn(value, key))
    .sort()
  if (missing.length > 0) wall("WORK_ORDER_ENVELOPE_MISSING_FIELD_WALL", `envelope.${missing[0]}`)
}

function assertExactFields(value, fields, field) {
  if (!plainObject(value)) wall("WORK_ORDER_ENVELOPE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("WORK_ORDER_ENVELOPE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("WORK_ORDER_ENVELOPE_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function identifier(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || !pattern.test(value)) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", field, "VALID_IDENTIFIER_REQUIRED")
  }
  return value
}

function normalizeProviderBinding(value, workOrderId) {
  if (value === undefined || value === null) return null
  assertExactFields(value, PROVIDER_BINDING_FIELDS, "providerBinding")
  const normalized = {
    providerId: identifier(value.providerId, "providerBinding.providerId"),
    assessmentWorkOrderId: identifier(value.assessmentWorkOrderId, "providerBinding.assessmentWorkOrderId", WORK_ORDER_ID),
    subjectWorkOrderId: identifier(value.subjectWorkOrderId, "providerBinding.subjectWorkOrderId", WORK_ORDER_ID),
    role: value.role,
  }
  if (!new Set(["ASSESSMENT", "SUBJECT"]).has(normalized.role)) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "providerBinding.role", "ASSESSMENT_OR_SUBJECT_REQUIRED")
  }
  if (normalized.assessmentWorkOrderId === normalized.subjectWorkOrderId) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "providerBinding", "DISTINCT_WORK_ORDERS_REQUIRED")
  }
  const boundWorkOrderId = normalized.role === "ASSESSMENT"
    ? normalized.assessmentWorkOrderId
    : normalized.subjectWorkOrderId
  if (boundWorkOrderId !== workOrderId) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "providerBinding", "ROLE_WORK_ORDER_MISMATCH")
  }
  return Object.freeze(normalized)
}

function normalizeDependencyPolicies(value, dependencies, fanInGate) {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value)) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "dependencyPolicies", "ARRAY_REQUIRED")
  }
  if (value.length > 0 && fanInGate !== "ALL") {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "dependencyPolicies", "ALL_GATE_REQUIRED")
  }
  const normalized = value.map((entry, index) => {
    const field = `dependencyPolicies[${index}]`
    assertExactFields(entry, DEPENDENCY_POLICY_FIELDS, field)
    const policy = {
      dependencyWorkOrderId: identifier(entry.dependencyWorkOrderId, `${field}.dependencyWorkOrderId`, WORK_ORDER_ID),
      satisfaction: entry.satisfaction,
      providerId: identifier(entry.providerId, `${field}.providerId`),
      assessmentWorkOrderId: identifier(entry.assessmentWorkOrderId, `${field}.assessmentWorkOrderId`, WORK_ORDER_ID),
    }
    if (policy.satisfaction !== "COMPLETE_OR_PROVIDER_UNAVAILABLE_DEFERRED") {
      wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", `${field}.satisfaction`, "KNOWN_POLICY_REQUIRED")
    }
    if (!dependencies.includes(policy.dependencyWorkOrderId)) {
      wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", `${field}.dependencyWorkOrderId`, "DECLARED_DEPENDENCY_REQUIRED")
    }
    if (policy.assessmentWorkOrderId === policy.dependencyWorkOrderId) {
      wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", field, "INDEPENDENT_ASSESSMENT_WORK_ORDER_REQUIRED")
    }
    return Object.freeze(policy)
  }).sort((left, right) => left.dependencyWorkOrderId.localeCompare(right.dependencyWorkOrderId))
  if (new Set(normalized.map(({ dependencyWorkOrderId }) => dependencyWorkOrderId)).size !== normalized.length) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "dependencyPolicies", "DUPLICATE_DEPENDENCY_POLICY")
  }
  return Object.freeze(normalized)
}

function normalizeOwnerTouchBudget(value) {
  if (!plainObject(value)) wall("WORK_ORDER_ENVELOPE_OWNER_WALL", "ownerTouchBudget", "OBJECT_REQUIRED")
  const keys = Object.keys(value).sort()
  const expected = [...OWNER_COUNTER_FIELDS].sort()
  const unknown = keys.filter((key) => !OWNER_COUNTER_FIELDS.includes(key))
  const missing = expected.filter((key) => !Object.hasOwn(value, key))
  if (unknown.length > 0) wall("WORK_ORDER_ENVELOPE_UNKNOWN_FIELD_WALL", `ownerTouchBudget.${unknown[0]}`)
  if (missing.length > 0) wall("WORK_ORDER_ENVELOPE_MISSING_FIELD_WALL", `ownerTouchBudget.${missing[0]}`)
  for (const key of OWNER_COUNTER_FIELDS) {
    if (value[key] !== 0) wall("WORK_ORDER_ENVELOPE_OWNER_WALL", `ownerTouchBudget.${key}`, "ZERO_REQUIRED")
  }
  return Object.freeze(Object.fromEntries(OWNER_COUNTER_FIELDS.map((key) => [key, 0])))
}

function dispatchFields(input) {
  const copy = { ...input }
  delete copy.artifactType
  delete copy.ownerTouchBudget
  delete copy.communicationPolicy
  delete copy.dependencyPolicies
  delete copy.providerBinding
  return copy
}

export function canonicalWorkOrderEnvelopeV2Json(value) {
  return JSON.stringify(canonicalize(value))
}

export function normalizeWorkOrderEnvelopeV2(input) {
  assertExactTopLevelFields(input)
  if (input.schemaVersion !== 2) wall("WORK_ORDER_ENVELOPE_VERSION_WALL", "schemaVersion", "2_REQUIRED")
  if (input.artifactType !== ARTIFACT_TYPE) {
    wall("WORK_ORDER_ENVELOPE_ARTIFACT_WALL", "artifactType", `${ARTIFACT_TYPE}_REQUIRED`)
  }
  if (input.communicationPolicy !== COMMUNICATION_POLICY) {
    wall("WORK_ORDER_ENVELOPE_OWNER_WALL", "communicationPolicy", `${COMMUNICATION_POLICY}_REQUIRED`)
  }

  const ownerTouchBudget = normalizeOwnerTouchBudget(input.ownerTouchBudget)
  let validated
  try {
    validated = validateDispatchEnvelope(dispatchFields(input))
  } catch (error) {
    if (!(error instanceof DispatchEnvelopeError)) throw error
    wall("WORK_ORDER_ENVELOPE_DISPATCH_WALL", error.field, error.code)
  }

  const envelope = Object.freeze({
    artifactType: ARTIFACT_TYPE,
    ...validated.envelope,
    dependencyPolicies: normalizeDependencyPolicies(
      input.dependencyPolicies,
      validated.envelope.dependencies,
      validated.envelope.fanInGate,
    ),
    providerBinding: normalizeProviderBinding(input.providerBinding, validated.envelope.workOrderId),
    ownerTouchBudget,
    communicationPolicy: COMMUNICATION_POLICY,
  })

  if (envelope.fanInGate === "ANY" && envelope.dependencies.length === 0) {
    wall("WORK_ORDER_ENVELOPE_DEPENDENCY_WALL", "fanInGate", "ANY_REQUIRES_DEPENDENCY")
  }
  if (envelope.authorityGrantRefs.length === 0
    && envelope.programActivationGrantRef === null
    && envelope.grantStatusEventRefs.length === 0) {
    wall("WORK_ORDER_ENVELOPE_AUTHORITY_WALL", "authorityGrantRefs", "RECORDED_AUTHORITY_REFERENCE_REQUIRED")
  }
  if (!envelope.evidenceTargets.includes("owner-operation-counters")) {
    wall("WORK_ORDER_ENVELOPE_EVIDENCE_WALL", "evidenceTargets", "OWNER_COUNTER_EVIDENCE_REQUIRED")
  }

  return envelope
}

export function validateWorkOrderEnvelopeV2(input) {
  const envelope = normalizeWorkOrderEnvelopeV2(input)
  const hashEnvelope = { ...envelope }
  for (const field of OPTIONAL_TOP_LEVEL_FIELDS) {
    if (!Object.hasOwn(input, field)) delete hashEnvelope[field]
  }
  const canonicalJson = canonicalWorkOrderEnvelopeV2Json(hashEnvelope)
  return Object.freeze({
    ok: true,
    code: "WORK_ORDER_ENVELOPE_V2_VALID",
    envelope,
    contentHash: crypto.createHash("sha256").update(canonicalJson).digest("hex"),
    validationOnly: true,
    dispatchPerformed: false,
    authorityGranted: false,
  })
}

export function toDispatchEnvelope(envelopeV2) {
  const normalized = normalizeWorkOrderEnvelopeV2(envelopeV2)
  return Object.freeze(dispatchFields(normalized))
}

export const WORK_ORDER_ENVELOPE_V2_OWNER_COUNTER_FIELDS = OWNER_COUNTER_FIELDS
