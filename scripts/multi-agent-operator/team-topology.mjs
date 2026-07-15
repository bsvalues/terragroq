import crypto from "node:crypto"

import {
  DispatchEnvelopeError,
  validateDispatchEnvelope,
} from "./dispatch-envelope.mjs"
import {
  DagEligibleResolverError,
  resolveDagEligibleSet,
} from "./dag-eligible-resolver.mjs"
import { checkReservationCompatibility } from "./reservation-set.mjs"
import {
  toDispatchEnvelope,
  validateWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "topologyId",
  "dagInput",
  "lanes",
])
const LANE_FIELDS = new Set(["envelope", "roleAssignments"])
const ROLE_FIELDS = new Set([
  "coordinator",
  "builder",
  "reviewer",
  "remediator",
  "mergeController",
  "verifier",
])
const WORK_ORDER_ID = /^WO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}$/
const SAFE_IDENTIFIER = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/
const WORKER_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

export class TeamTopologyError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "TeamTopologyError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new TeamTopologyError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function assertExactFields(value, expected, field) {
  if (!plainObject(value)) wall("TEAM_TOPOLOGY_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !expected.has(key)).sort(lexicalCompare)
  if (unknown.length > 0) wall("TEAM_TOPOLOGY_UNKNOWN_FIELD_WALL", `${field}.${unknown[0]}`)
  const missing = [...expected].filter((key) => !Object.hasOwn(value, key)).sort(lexicalCompare)
  if (missing.length > 0) wall("TEAM_TOPOLOGY_MISSING_FIELD_WALL", `${field}.${missing[0]}`)
}

function normalizedString(value, field, pattern) {
  if (typeof value !== "string" || value.length === 0) {
    wall("TEAM_TOPOLOGY_TYPE_WALL", field, "NON_EMPTY_STRING_REQUIRED")
  }
  if (value.trim() !== value) wall("TEAM_TOPOLOGY_NORMALIZATION_WALL", field, "SURROUNDING_WHITESPACE")
  if (!pattern.test(value)) wall("TEAM_TOPOLOGY_FORMAT_WALL", field)
  return value
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort(lexicalCompare).map((key) => [key, canonicalize(value[key])]))
  }
  return value
}

function contentHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex")
}

function normalizeRoleAssignments(value, laneIndex) {
  const field = `lanes[${laneIndex}].roleAssignments`
  assertExactFields(value, ROLE_FIELDS, field)
  return Object.fromEntries([...ROLE_FIELDS].map((role) => [
    role,
    normalizedString(value[role], `${field}.${role}`, WORKER_ID),
  ]))
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function validateLane(rawLane, laneIndex, eligibility, canonicalById) {
  const field = `lanes[${laneIndex}]`
  assertExactFields(rawLane, LANE_FIELDS, field)

  let validated
  try {
    validated = validateDispatchEnvelope(rawLane.envelope)
  } catch (error) {
    if (!(error instanceof DispatchEnvelopeError)) throw error
    const envelopeField = error.field === "envelope"
      ? `${field}.envelope`
      : `${field}.envelope.${error.field}`
    wall("TEAM_TOPOLOGY_ENVELOPE_WALL", envelopeField, error.code)
  }

  const envelope = validated.envelope
  const canonical = canonicalById.get(envelope.workOrderId)
  if (!canonical) {
    wall("TEAM_TOPOLOGY_DAG_BINDING_WALL", `${field}.envelope.workOrderId`, "CANONICAL_WORK_ORDER_REQUIRED")
  }
  const canonicalDispatch = validateDispatchEnvelope(toDispatchEnvelope(canonical))
  if (validated.contentHash !== canonicalDispatch.contentHash) {
    wall("TEAM_TOPOLOGY_DAG_BINDING_WALL", `${field}.envelope`, "CANONICAL_ENVELOPE_MISMATCH")
  }
  const roleAssignments = normalizeRoleAssignments(rawLane.roleAssignments, laneIndex)
  for (const role of ["coordinator", "builder", "reviewer"]) {
    if (roleAssignments[role] !== envelope.teamRoles[role]) {
      wall("TEAM_TOPOLOGY_ROLE_WALL", `${field}.roleAssignments.${role}`, "ENVELOPE_ROLE_MISMATCH")
    }
  }
  if (roleAssignments.remediator !== roleAssignments.builder) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", `${field}.roleAssignments.remediator`, "REMEDIATOR_MUST_EQUAL_BUILDER")
  }
  if (roleAssignments.builder === roleAssignments.reviewer) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", `${field}.roleAssignments.reviewer`, "ROLE_INDEPENDENCE_REQUIRED")
  }
  const laneRoles = [roleAssignments.builder, roleAssignments.reviewer]
  if (laneRoles.includes(roleAssignments.coordinator)) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", `${field}.roleAssignments.coordinator`, "ROLE_INDEPENDENCE_REQUIRED")
  }
  if (laneRoles.includes(roleAssignments.mergeController)
    || roleAssignments.mergeController === roleAssignments.coordinator) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", `${field}.roleAssignments.mergeController`, "ROLE_INDEPENDENCE_REQUIRED")
  }
  if (laneRoles.includes(roleAssignments.verifier)
    || roleAssignments.verifier === roleAssignments.coordinator
    || roleAssignments.verifier === roleAssignments.mergeController) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", `${field}.roleAssignments.verifier`, "ROLE_INDEPENDENCE_REQUIRED")
  }

  const eligibleEntry = eligibility.eligibleById.get(envelope.workOrderId)
  const ineligibleEntry = eligibility.ineligibleById.get(envelope.workOrderId)
  if (!eligibleEntry && !ineligibleEntry) {
    wall("TEAM_TOPOLOGY_DAG_BINDING_WALL", `${field}.envelope.workOrderId`, "NONCOMPLETE_WORK_ORDER_REQUIRED")
  }
  const declaredDependencies = [...envelope.dependencies]
  const settledDependencies = eligibleEntry?.settledDependencies?.map(({ workOrderId }) => workOrderId) ?? []
  const satisfiedDependencies = [...new Set([
    ...(eligibleEntry?.completedDependencies ?? ineligibleEntry?.completedDependencies ?? []),
    ...settledDependencies,
  ])].sort(lexicalCompare)
  const explicitDisposition = ineligibleEntry?.reasonCode === "EXPLICITLY_BLOCKED"
    ? "EXPLICITLY_BLOCKED"
    : ineligibleEntry?.reasonCode === "EXPLICITLY_DEFERRED"
      ? "EXPLICITLY_DEFERRED"
      : null
  const pendingDependencies = explicitDisposition === null
    ? declaredDependencies.filter((dependency) => !satisfiedDependencies.includes(dependency))
    : []
  const gateSatisfied = eligibleEntry !== undefined

  return {
    workOrderId: envelope.workOrderId,
    laneId: envelope.laneId,
    envelopeContentHash: validated.contentHash,
    roleAssignments,
    reservations: envelope.reservations,
    fanIn: {
      fanInGate: envelope.fanInGate,
      declaredDependencies,
      satisfiedDependencies,
      pendingDependencies,
      projectedGateSatisfied: gateSatisfied,
      planningDisposition: gateSatisfied
        ? "FAN_OUT_CANDIDATE"
        : explicitDisposition ?? "WAITING_ON_DECLARED_DEPENDENCIES",
      reasonCode: gateSatisfied ? null : ineligibleEntry.reasonCode,
      stateReasonCode: ineligibleEntry?.stateReasonCode ?? null,
    },
  }
}

function assertUniqueLanes(lanes) {
  const workOrderIds = new Set()
  const laneIds = new Set()
  for (const lane of lanes) {
    if (workOrderIds.has(lane.workOrderId)) {
      wall("TEAM_TOPOLOGY_DUPLICATE_WORK_ORDER_WALL", "lanes")
    }
    if (laneIds.has(lane.laneId)) wall("TEAM_TOPOLOGY_DUPLICATE_LANE_WALL", "lanes")
    workOrderIds.add(lane.workOrderId)
    laneIds.add(lane.laneId)
  }
}

function assertPortfolioRoleIndependence(lanes) {
  const builders = new Set(lanes.map(({ roleAssignments }) => roleAssignments.builder))
  const reviewers = new Set(lanes.map(({ roleAssignments }) => roleAssignments.reviewer))
  if (builders.size !== lanes.length) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", "lanes", "CROSS_LANE_BUILDER_REUSE")
  }
  if (reviewers.size !== lanes.length) {
    wall("TEAM_TOPOLOGY_ROLE_WALL", "lanes", "CROSS_LANE_REVIEWER_REUSE")
  }
  const collision = [...builders].find((workerId) => reviewers.has(workerId))
  if (collision) wall("TEAM_TOPOLOGY_ROLE_WALL", "lanes", "CROSS_LANE_BUILDER_REVIEWER_COLLISION")
}

function reservationSetFor(lane) {
  return {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_RESERVATION_SET",
    reservationSetId: `topology-${lane.workOrderId}`,
    workerId: lane.roleAssignments.builder,
    workOrderId: lane.workOrderId,
    reservations: {
      paths: lane.reservations.paths,
      contracts: lane.reservations.contracts,
      environments: lane.reservations.environments,
      repositories: [],
      protectedResources: [],
    },
  }
}

function assertFanOutReservationCompatibility(lanes) {
  const ready = lanes.filter(({ fanIn }) => fanIn.projectedGateSatisfied)
  for (let leftIndex = 0; leftIndex < ready.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < ready.length; rightIndex += 1) {
      const compatibility = checkReservationCompatibility(
        reservationSetFor(ready[leftIndex]),
        reservationSetFor(ready[rightIndex]),
      )
      if (!compatibility.compatible) {
        wall(
          "TEAM_TOPOLOGY_RESERVATION_WALL",
          "lanes",
          `${ready[leftIndex].workOrderId}:${ready[rightIndex].workOrderId}`,
        )
      }
    }
  }
}

function sharedRole(lanes, role) {
  const value = lanes[0].roleAssignments[role]
  const inconsistentIndex = lanes.findIndex((lane) => lane.roleAssignments[role] !== value)
  if (inconsistentIndex !== -1) {
    wall(
      "TEAM_TOPOLOGY_ROLE_WALL",
      `lanes[${inconsistentIndex}].roleAssignments.${role}`,
      "INCONSISTENT_GLOBAL_ROLE",
    )
  }
  return value
}

export function compileTeamTopology(input) {
  assertExactFields(input, INPUT_FIELDS, "input")
  if (input.schemaVersion !== 1) {
    wall("TEAM_TOPOLOGY_INPUT_WALL", "schemaVersion", "UNSUPPORTED_SCHEMA_VERSION")
  }
  if (input.artifactType !== "MULTI_AGENT_TEAM_TOPOLOGY_INPUT") {
    wall("TEAM_TOPOLOGY_INPUT_WALL", "artifactType", "UNSUPPORTED_ARTIFACT_TYPE")
  }
  const topologyId = normalizedString(input.topologyId, "topologyId", SAFE_IDENTIFIER)
  let dagResult
  try {
    dagResult = resolveDagEligibleSet(input.dagInput)
  } catch (error) {
    if (!(error instanceof DagEligibleResolverError)) throw error
    wall("TEAM_TOPOLOGY_DAG_WALL", `dagInput.${error.field}`, error.code)
  }
  const canonicalById = new Map(input.dagInput.workOrders.map((workOrder) => {
    const validated = validateWorkOrderEnvelopeV2(workOrder)
    return [validated.envelope.workOrderId, validated.envelope]
  }))
  const eligibility = {
    eligibleById: new Map(dagResult.eligible.map((entry) => [entry.workOrderId, entry])),
    ineligibleById: new Map(dagResult.ineligible.map((entry) => [entry.workOrderId, entry])),
  }
  if (!Array.isArray(input.lanes) || input.lanes.length === 0) {
    wall("TEAM_TOPOLOGY_TYPE_WALL", "lanes", "NON_EMPTY_ARRAY_REQUIRED")
  }
  const rawWorkOrderIds = input.lanes.map((lane) => lane?.envelope?.workOrderId)
  if (new Set(rawWorkOrderIds).size !== rawWorkOrderIds.length) {
    wall("TEAM_TOPOLOGY_DUPLICATE_WORK_ORDER_WALL", "lanes")
  }
  const rawLaneIds = input.lanes.map((lane) => lane?.envelope?.laneId)
  if (new Set(rawLaneIds).size !== rawLaneIds.length) {
    wall("TEAM_TOPOLOGY_DUPLICATE_LANE_WALL", "lanes")
  }

  const lanes = input.lanes.map((lane, laneIndex) => validateLane(lane, laneIndex, eligibility, canonicalById))
  assertUniqueLanes(lanes)
  assertPortfolioRoleIndependence(lanes)
  assertFanOutReservationCompatibility(lanes)

  const coordinator = sharedRole(lanes, "coordinator")
  const mergeController = sharedRole(lanes, "mergeController")
  const verifier = sharedRole(lanes, "verifier")
  lanes.sort((left, right) => lexicalCompare(left.workOrderId, right.workOrderId)
    || lexicalCompare(left.laneId, right.laneId))
  const candidateFanOut = lanes
    .filter((lane) => lane.fanIn.projectedGateSatisfied)
    .map(({ workOrderId, laneId }) => ({ workOrderId, laneId }))
  const waiting = lanes
    .filter((lane) => lane.fanIn.planningDisposition === "WAITING_ON_DECLARED_DEPENDENCIES")
    .map(({ workOrderId, laneId, fanIn }) => ({
      workOrderId,
      laneId,
      pendingDependencies: [...fanIn.pendingDependencies],
    }))
  const explicitlyIneligible = lanes
    .filter((lane) => lane.fanIn.planningDisposition === "EXPLICITLY_BLOCKED"
      || lane.fanIn.planningDisposition === "EXPLICITLY_DEFERRED")
    .map(({ workOrderId, laneId, fanIn }) => ({
      workOrderId,
      laneId,
      disposition: fanIn.planningDisposition,
      reasonCode: fanIn.reasonCode,
      stateReasonCode: fanIn.stateReasonCode,
    }))

  const topology = {
    schemaVersion: 1,
    artifactType: "MULTI_AGENT_TEAM_TOPOLOGY",
    topologyId,
    status: candidateFanOut.length > 0
      ? "PLANNING_FAN_OUT_CANDIDATES"
      : waiting.length > 0
        ? "PLANNING_WAITING_ON_DECLARED_DEPENDENCIES"
        : "PLANNING_EXPLICITLY_INELIGIBLE",
    dagResultHash: contentHash(dagResult),
    declaredCompleteWorkOrderIds: [...dagResult.completedWorkOrderIds],
    coordinator,
    mergeController,
    verifier,
    lanes,
    candidateFanOut,
    waiting,
    explicitlyIneligible,
    planningOnly: true,
    fanOutIsAdvisory: true,
    requiresSchedulerVerification: true,
    dispatchEligible: false,
    releaseAuthorized: false,
    dispatchPerformed: false,
    authorityGranted: false,
    ownerOperationsRequired: false,
  }
  return deepFreeze({ ...topology, topologyHash: contentHash(topology) })
}
