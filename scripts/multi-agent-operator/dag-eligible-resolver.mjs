import {
  WorkOrderEnvelopeV2Error,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

const ARTIFACT_TYPE = "DAG_ELIGIBILITY_INPUT"
const INPUT_FIELDS = new Set(["schemaVersion", "artifactType", "workOrders", "workOrderStates"])
const STATE_FIELDS = new Set(["workOrderId", "state", "reasonCode"])
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

function assertExactFields(value, fields, field) {
  if (!plainObject(value)) wall("DAG_ELIGIBILITY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()
  if (unknown.length > 0) wall("DAG_ELIGIBILITY_UNKNOWN_FIELD_WALL", `${field}.${unknown[0]}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()
  if (missing.length > 0) wall("DAG_ELIGIBILITY_MISSING_FIELD_WALL", `${field}.${missing[0]}`)
}

function normalizeState(entry, index) {
  assertExactFields(entry, STATE_FIELDS, `workOrderStates[${index}]`)
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
  return Object.freeze({
    workOrderId: entry.workOrderId,
    state: entry.state,
    reasonCode: entry.reasonCode,
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

export function resolveDagEligibleSet(input) {
  assertExactFields(input, INPUT_FIELDS, "input")
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

  const envelopes = input.workOrders.map((workOrder, index) => {
    try {
      return validateWorkOrderEnvelopeV2(workOrder).envelope
    } catch (error) {
      if (!(error instanceof WorkOrderEnvelopeV2Error)) throw error
      wall("DAG_ELIGIBILITY_ENVELOPE_WALL", `workOrders[${index}]`, `${error.code}:${error.field}`)
    }
  })
  const envelopeIds = envelopes.map(({ workOrderId }) => workOrderId)
  const duplicateEnvelope = envelopeIds.find((id, index) => envelopeIds.indexOf(id) !== index)
  if (duplicateEnvelope) wall("DAG_ELIGIBILITY_DUPLICATE_WALL", "workOrders", duplicateEnvelope)
  const envelopesById = new Map(envelopes.map((envelope) => [envelope.workOrderId, envelope]))

  const states = input.workOrderStates.map(normalizeState)
  const stateIds = states.map(({ workOrderId }) => workOrderId)
  const duplicateState = stateIds.find((id, index) => stateIds.indexOf(id) !== index)
  if (duplicateState) wall("DAG_ELIGIBILITY_DUPLICATE_WALL", "workOrderStates", duplicateState)
  const unknownState = stateIds.find((id) => !envelopesById.has(id))
  if (unknownState) wall("DAG_ELIGIBILITY_STATE_WALL", "workOrderStates", `UNKNOWN_WORK_ORDER:${unknownState}`)
  const missingState = envelopeIds.find((id) => !stateIds.includes(id))
  if (missingState) wall("DAG_ELIGIBILITY_STATE_WALL", "workOrderStates", `MISSING_WORK_ORDER:${missingState}`)
  const stateById = new Map(states.map((state) => [state.workOrderId, state]))

  for (const envelope of envelopes) {
    const missingDependency = envelope.dependencies.find((dependency) => !envelopesById.has(dependency))
    if (missingDependency) {
      wall("DAG_ELIGIBILITY_MISSING_DEPENDENCY_WALL", envelope.workOrderId, missingDependency)
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
    const gateSatisfied = envelope.fanInGate === "ALL"
      ? completedDependencies.length === envelope.dependencies.length
      : completedDependencies.length > 0

    if (gateSatisfied) {
      eligible.push(Object.freeze({
        workOrderId: envelope.workOrderId,
        fanInGate: envelope.fanInGate,
        completedDependencies,
      }))
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
