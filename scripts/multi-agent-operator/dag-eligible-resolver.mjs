import {
  WorkOrderEnvelopeV2Error,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"
import {
  ProviderUnavailableSettlementError,
  verifyProviderUnavailableAssessment,
} from "./provider-unavailable-settlement.mjs"

const ARTIFACT_TYPE = "DAG_ELIGIBILITY_INPUT"
const INPUT_FIELDS = new Set(["schemaVersion", "artifactType", "workOrders", "workOrderStates", "providerAssessments"])
const OPTIONAL_INPUT_FIELDS = new Set(["providerAssessments"])
const STATE_FIELDS = new Set(["workOrderId", "state", "reasonCode", "providerUnavailableAssessmentRef"])
const OPTIONAL_STATE_FIELDS = new Set(["providerUnavailableAssessmentRef"])
const ASSESSMENT_REF_FIELDS = new Set(["artifactId", "contentHash"])
const STATES = new Set(["PLANNED", "COMPLETE", "DEFERRED", "BLOCKED"])
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/
const REASON_CODE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export class DagEligibleResolverError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "DagEligibleResolverError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new DagEligibleResolverError(code, field, detail)
}

function assertExactFields(value, fields, field, optionalFields = new Set()) {
  if (!plainObject(value)) wall("DAG_ELIGIBILITY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()
  if (unknown.length > 0) wall("DAG_ELIGIBILITY_UNKNOWN_FIELD_WALL", `${field}.${unknown[0]}`)
  const missing = [...fields]
    .filter((key) => !optionalFields.has(key) && !Object.hasOwn(value, key))
    .sort()
  if (missing.length > 0) wall("DAG_ELIGIBILITY_MISSING_FIELD_WALL", `${field}.${missing[0]}`)
}

function normalizeAssessmentRef(value, field) {
  if (value === undefined || value === null) return null
  assertExactFields(value, ASSESSMENT_REF_FIELDS, field)
  if (typeof value.artifactId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(value.artifactId)) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", `${field}.artifactId`, "VALID_IDENTIFIER_REQUIRED")
  }
  if (typeof value.contentHash !== "string" || !/^[a-f0-9]{64}$/.test(value.contentHash)) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", `${field}.contentHash`, "VALID_HASH_REQUIRED")
  }
  return Object.freeze({ artifactId: value.artifactId, contentHash: value.contentHash })
}

function normalizeState(entry, index) {
  assertExactFields(entry, STATE_FIELDS, `workOrderStates[${index}]`, OPTIONAL_STATE_FIELDS)
  if (typeof entry.workOrderId !== "string" || !WORK_ORDER_ID.test(entry.workOrderId)) {
    wall("DAG_ELIGIBILITY_STATE_WALL", `workOrderStates[${index}].workOrderId`, "VALID_ID_REQUIRED")
  }
  if (!STATES.has(entry.state)) {
    wall("DAG_ELIGIBILITY_STATE_WALL", `workOrderStates[${index}].state`, "KNOWN_STATE_REQUIRED")
  }
  const needsReason = entry.state === "DEFERRED" || entry.state === "BLOCKED"
  if (needsReason && (typeof entry.reasonCode !== "string" || !REASON_CODE.test(entry.reasonCode))) {
    wall("DAG_ELIGIBILITY_STATE_WALL", `workOrderStates[${index}].reasonCode`, "TYPED_REASON_REQUIRED")
  }
  if (!needsReason && entry.reasonCode !== null) {
    wall("DAG_ELIGIBILITY_STATE_WALL", `workOrderStates[${index}].reasonCode`, "NULL_REQUIRED")
  }
  const providerUnavailableAssessmentRef = normalizeAssessmentRef(
    entry.providerUnavailableAssessmentRef,
    `workOrderStates[${index}].providerUnavailableAssessmentRef`,
  )
  const providerUnavailableDefer = entry.state === "DEFERRED" && entry.reasonCode === "PROVIDER_UNAVAILABLE"
  if (providerUnavailableAssessmentRef !== null && !providerUnavailableDefer) {
    wall(
      "DAG_ELIGIBILITY_SETTLEMENT_WALL",
      `workOrderStates[${index}].providerUnavailableAssessmentRef`,
      "PROVIDER_UNAVAILABLE_DEFER_REQUIRED",
    )
  }
  return Object.freeze({
    workOrderId: entry.workOrderId,
    state: entry.state,
    reasonCode: entry.reasonCode,
    providerUnavailableAssessmentRef,
  })
}

function sameBinding(binding, expectedRole, policy, subjectWorkOrderId) {
  return binding !== null
    && binding.role === expectedRole
    && binding.providerId === policy.providerId
    && binding.assessmentWorkOrderId === policy.assessmentWorkOrderId
    && binding.subjectWorkOrderId === subjectWorkOrderId
}

function verifySettledDependency({
  consumerEnvelope,
  dependencyWorkOrderId,
  policy,
  stateById,
  envelopeResultsById,
  assessmentsById,
  trustOptions,
  referencedAssessments,
}) {
  if (consumerEnvelope.fanInGate !== "ALL") {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", consumerEnvelope.workOrderId, "ALL_GATE_REQUIRED")
  }
  const subjectState = stateById.get(dependencyWorkOrderId)
  if (subjectState.state !== "DEFERRED" || subjectState.reasonCode !== "PROVIDER_UNAVAILABLE") {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", dependencyWorkOrderId, "EXACT_PROVIDER_UNAVAILABLE_DEFER_REQUIRED")
  }
  if (subjectState.providerUnavailableAssessmentRef === null) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", dependencyWorkOrderId, "ASSESSMENT_REFERENCE_REQUIRED")
  }
  const assessmentArtifact = assessmentsById.get(subjectState.providerUnavailableAssessmentRef.artifactId)
  if (!assessmentArtifact || assessmentArtifact.contentHash !== subjectState.providerUnavailableAssessmentRef.contentHash) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", dependencyWorkOrderId, "ASSESSMENT_REFERENCE_MISMATCH")
  }
  const assessmentEnvelopeResult = envelopeResultsById.get(policy.assessmentWorkOrderId)
  if (!assessmentEnvelopeResult) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", policy.assessmentWorkOrderId, "KNOWN_ASSESSMENT_WORK_ORDER_REQUIRED")
  }
  const assessmentState = stateById.get(policy.assessmentWorkOrderId)
  if (assessmentState.state !== "COMPLETE" || assessmentState.reasonCode !== null) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", policy.assessmentWorkOrderId, "COMPLETE_ASSESSMENT_WORK_ORDER_REQUIRED")
  }
  const subjectEnvelopeResult = envelopeResultsById.get(dependencyWorkOrderId)
  if (!sameBinding(subjectEnvelopeResult.envelope.providerBinding, "SUBJECT", policy, dependencyWorkOrderId)
    || !sameBinding(assessmentEnvelopeResult.envelope.providerBinding, "ASSESSMENT", policy, dependencyWorkOrderId)) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", dependencyWorkOrderId, "ENVELOPE_PROVIDER_BINDING_MISMATCH")
  }
  let verified
  try {
    verified = verifyProviderUnavailableAssessment(assessmentArtifact, trustOptions)
  } catch (error) {
    if (!(error instanceof ProviderUnavailableSettlementError)) throw error
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", dependencyWorkOrderId, `${error.code}:${error.field}`)
  }
  const assessment = verified.assessment
  const bindingsMatch = assessment.providerId === policy.providerId
    && assessment.assessmentWorkOrderId === policy.assessmentWorkOrderId
    && assessment.subjectWorkOrderId === dependencyWorkOrderId
    && assessment.assessmentEnvelopeHash === assessmentEnvelopeResult.contentHash
    && assessment.subjectEnvelopeHash === subjectEnvelopeResult.contentHash
  if (!bindingsMatch) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", dependencyWorkOrderId, "ASSESSMENT_IDENTITY_OR_ENVELOPE_HASH_MISMATCH")
  }
  referencedAssessments.add(assessment.artifactId)
  return Object.freeze({
    workOrderId: dependencyWorkOrderId,
    satisfaction: policy.satisfaction,
    providerId: policy.providerId,
    assessmentWorkOrderId: policy.assessmentWorkOrderId,
    assessmentArtifactId: assessment.artifactId,
    assessmentContentHash: assessment.contentHash,
  })
}

function detectCycle(envelopesById) {
  const visiting = new Set()
  const visited = new Set()
  const stack = []

  function visit(workOrderId) {
    if (visiting.has(workOrderId)) {
      const cycleStart = stack.indexOf(workOrderId)
      return [...stack.slice(cycleStart), workOrderId]
    }
    if (visited.has(workOrderId)) return null
    visiting.add(workOrderId)
    stack.push(workOrderId)
    for (const dependency of envelopesById.get(workOrderId).dependencies) {
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    stack.pop()
    visiting.delete(workOrderId)
    visited.add(workOrderId)
    return null
  }

  for (const workOrderId of [...envelopesById.keys()].sort(stableCompare)) {
    const cycle = visit(workOrderId)
    if (cycle) return cycle
  }
  return null
}

export function resolveDagEligibleSet(input, trustOptions = {}) {
  assertExactFields(input, INPUT_FIELDS, "input", OPTIONAL_INPUT_FIELDS)
  if (input.schemaVersion !== 1) wall("DAG_ELIGIBILITY_VERSION_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== ARTIFACT_TYPE) {
    wall("DAG_ELIGIBILITY_ARTIFACT_WALL", "artifactType", `${ARTIFACT_TYPE}_REQUIRED`)
  }
  if (!Array.isArray(input.workOrders) || input.workOrders.length === 0) {
    wall("DAG_ELIGIBILITY_TYPE_WALL", "workOrders", "NON_EMPTY_ARRAY_REQUIRED")
  }
  if (!Array.isArray(input.workOrderStates)) {
    wall("DAG_ELIGIBILITY_TYPE_WALL", "workOrderStates", "ARRAY_REQUIRED")
  }

  const envelopeResults = input.workOrders.map((workOrder, index) => {
    try {
      return validateWorkOrderEnvelopeV2(workOrder)
    } catch (error) {
      if (!(error instanceof WorkOrderEnvelopeV2Error)) throw error
      wall("DAG_ELIGIBILITY_ENVELOPE_WALL", `workOrders[${index}]`, `${error.code}:${error.field}`)
    }
  })
  const envelopes = envelopeResults.map(({ envelope }) => envelope)
  const envelopeIds = envelopes.map(({ workOrderId }) => workOrderId)
  const duplicateEnvelope = envelopeIds.find((id, index) => envelopeIds.indexOf(id) !== index)
  if (duplicateEnvelope) wall("DAG_ELIGIBILITY_DUPLICATE_WALL", "workOrders", duplicateEnvelope)
  const envelopesById = new Map(envelopes.map((envelope) => [envelope.workOrderId, envelope]))
  const envelopeResultsById = new Map(envelopeResults.map((result) => [result.envelope.workOrderId, result]))

  const states = input.workOrderStates.map(normalizeState)
  const stateIds = states.map(({ workOrderId }) => workOrderId)
  const duplicateState = stateIds.find((id, index) => stateIds.indexOf(id) !== index)
  if (duplicateState) wall("DAG_ELIGIBILITY_DUPLICATE_WALL", "workOrderStates", duplicateState)
  const unknownState = stateIds.find((id) => !envelopesById.has(id))
  if (unknownState) wall("DAG_ELIGIBILITY_STATE_WALL", "workOrderStates", `UNKNOWN_WORK_ORDER:${unknownState}`)
  const missingState = envelopeIds.find((id) => !stateIds.includes(id))
  if (missingState) wall("DAG_ELIGIBILITY_STATE_WALL", "workOrderStates", `MISSING_WORK_ORDER:${missingState}`)
  const stateById = new Map(states.map((state) => [state.workOrderId, state]))

  const providerAssessments = input.providerAssessments === undefined ? [] : input.providerAssessments
  if (!Array.isArray(providerAssessments)) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", "providerAssessments", "ARRAY_REQUIRED")
  }
  providerAssessments.forEach((entry, index) => {
    if (!plainObject(entry)) {
      wall("DAG_ELIGIBILITY_TYPE_WALL", `providerAssessments[${index}]`, "OBJECT_REQUIRED")
    }
    if (typeof entry.artifactId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/.test(entry.artifactId)) {
      wall(
        "DAG_ELIGIBILITY_SETTLEMENT_WALL",
        `providerAssessments[${index}].artifactId`,
        "VALID_IDENTIFIER_REQUIRED",
      )
    }
  })
  const assessmentIds = providerAssessments.map((entry) => entry?.artifactId)
  const duplicateAssessment = assessmentIds.find((id, index) => assessmentIds.indexOf(id) !== index)
  if (duplicateAssessment !== undefined) {
    wall("DAG_ELIGIBILITY_DUPLICATE_WALL", "providerAssessments", String(duplicateAssessment))
  }
  const assessmentsById = new Map(providerAssessments.map((entry) => [entry?.artifactId, entry]))
  const referencedAssessments = new Set()

  for (const envelope of envelopes) {
    const missingDependency = envelope.dependencies.find((dependency) => !envelopesById.has(dependency))
    if (missingDependency) {
      wall("DAG_ELIGIBILITY_MISSING_DEPENDENCY_WALL", envelope.workOrderId, missingDependency)
    }
    const unknownAssessmentWorkOrder = envelope.dependencyPolicies
      .find(({ assessmentWorkOrderId }) => !envelopesById.has(assessmentWorkOrderId))
    if (unknownAssessmentWorkOrder) {
      wall(
        "DAG_ELIGIBILITY_SETTLEMENT_WALL",
        envelope.workOrderId,
        `UNKNOWN_ASSESSMENT_WORK_ORDER:${unknownAssessmentWorkOrder.assessmentWorkOrderId}`,
      )
    }
  }
  const cycle = detectCycle(envelopesById)
  if (cycle) wall("DAG_ELIGIBILITY_CYCLE_WALL", "workOrders", cycle.join("->"))

  const eligible = []
  const ineligible = []
  const completedWorkOrderIds = states
    .filter(({ state }) => state === "COMPLETE")
    .map(({ workOrderId }) => workOrderId)
    .sort(stableCompare)

  for (const envelope of [...envelopes].sort((left, right) => stableCompare(left.workOrderId, right.workOrderId))) {
    const current = stateById.get(envelope.workOrderId)
    if (current.state === "COMPLETE") continue
    if (current.state === "DEFERRED" || current.state === "BLOCKED") {
      ineligible.push(Object.freeze({
        workOrderId: envelope.workOrderId,
        reasonCode: current.state === "DEFERRED" ? "EXPLICITLY_DEFERRED" : "EXPLICITLY_BLOCKED",
        stateReasonCode: current.reasonCode,
      }))
      continue
    }

    const dependencyStates = envelope.dependencies.map((dependency) => stateById.get(dependency))
    const completedDependencies = dependencyStates
      .filter(({ state }) => state === "COMPLETE")
      .map(({ workOrderId }) => workOrderId)
      .sort(stableCompare)
    const deferredDependencies = dependencyStates
      .filter(({ state }) => state === "DEFERRED")
      .map(({ workOrderId }) => workOrderId)
      .sort(stableCompare)
    const blockedDependencies = dependencyStates
      .filter(({ state }) => state === "BLOCKED")
      .map(({ workOrderId }) => workOrderId)
      .sort(stableCompare)
    const pendingDependencies = dependencyStates
      .filter(({ state }) => state === "PLANNED")
      .map(({ workOrderId }) => workOrderId)
      .sort(stableCompare)
    const policiesByDependency = new Map(envelope.dependencyPolicies.map((policy) => [policy.dependencyWorkOrderId, policy]))
    const settledDependencies = []
    for (const dependency of envelope.dependencies) {
      if (stateById.get(dependency).state === "COMPLETE") continue
      const policy = policiesByDependency.get(dependency)
      if (!policy) continue
      settledDependencies.push(verifySettledDependency({
        consumerEnvelope: envelope,
        dependencyWorkOrderId: dependency,
        policy,
        stateById,
        envelopeResultsById,
        assessmentsById,
        trustOptions,
        referencedAssessments,
      }))
    }
    const satisfiedDependencyIds = new Set([
      ...completedDependencies,
      ...settledDependencies.map(({ workOrderId }) => workOrderId),
    ])
    const gateSatisfied = envelope.fanInGate === "ALL"
      ? satisfiedDependencyIds.size === envelope.dependencies.length
      : completedDependencies.length > 0

    if (gateSatisfied) {
      const eligibleEntry = {
        workOrderId: envelope.workOrderId,
        fanInGate: envelope.fanInGate,
        completedDependencies,
      }
      if (settledDependencies.length > 0) eligibleEntry.settledDependencies = Object.freeze(settledDependencies)
      eligible.push(Object.freeze(eligibleEntry))
    } else {
      ineligible.push(Object.freeze({
        workOrderId: envelope.workOrderId,
        reasonCode: "DEPENDENCY_INCOMPLETE",
        fanInGate: envelope.fanInGate,
        completedDependencies,
        pendingDependencies,
        deferredDependencies,
        blockedDependencies,
      }))
    }
  }

  const unreferencedAssessment = providerAssessments.find((entry) => !referencedAssessments.has(entry.artifactId))
  if (unreferencedAssessment) {
    wall("DAG_ELIGIBILITY_SETTLEMENT_WALL", "providerAssessments", `UNREFERENCED_ASSESSMENT:${unreferencedAssessment.artifactId}`)
  }

  return Object.freeze({
    schemaVersion: 1,
    artifactType: "DAG_ELIGIBILITY_RESULT",
    status: eligible.length > 0 ? "ELIGIBLE_SET_READY" : "NO_ELIGIBLE_WORK",
    completedWorkOrderIds: Object.freeze(completedWorkOrderIds),
    eligible: Object.freeze(eligible),
    ineligible: Object.freeze(ineligible),
    planningOnly: true,
    dispatchPerformed: false,
    authorityGranted: false,
  })
}
