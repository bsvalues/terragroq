import crypto from "node:crypto"

import {
  AuthorityAssertionError,
  validateOwnerAuthorityArtifacts,
} from "./authority-events.mjs"
import {
  CodexProviderConformanceError,
  evaluateCodexSessionCoordination,
  normalizeCodexProviderConformance,
  verifyCodexHostSessionIdentity,
} from "./codex-provider-conformance.mjs"
import {
  loadCanonicalHostedCodexNativeBridge,
  loadCanonicalHostedCodexTrustRecord,
} from "./codex-native-bridge-registry.mjs"
import {
  ProviderContractError,
  hashProviderResponse,
  validateProviderResponse,
} from "./provider-contract.mjs"
import { TeamTopologyError, compileTeamTopology } from "./team-topology.mjs"
import { normalizeWorkOrderEnvelopeV2 } from "./work-order-envelope-v2.mjs"

const INPUT_FIELDS = new Set([
  "schemaVersion", "artifactType", "adapterRunId", "topologyInput", "conformance",
  "coordinatorHostSessionProofReference", "preventiveTrustProofReferences", "hostBridgeReference",
  "authorityProofs",
  "runtimeActivationRequested", "localIssue357Requested", "durableTransportClaimed",
  "ownerTouchBudget",
])
const SESSION_REFERENCE_FIELDS = new Set(["workerId", "proofId"])
const TRUST_REFERENCE_FIELDS = new Set(["proofId"])
const BRIDGE_REFERENCE_FIELDS = new Set(["bridgeId"])
const TRUST_FIELDS = new Set([
  "schemaVersion", "artifactType", "proofId", "workOrderId", "laneId", "requestedRole", "workerId",
  "provider", "surface", "promptInjectionBoundary", "allowedPaths", "rawCredentialInspection",
  "exactPathConfinement", "outputRedaction", "cancellationSupported",
  "independentEvidenceCapture", "envelopeContentHash", "status", "issuedAt", "expiresAt",
  "evaluationTime", "authorityGranted",
])
const AUTHORITY_PROOF_FIELDS = new Set(["workOrderId", "artifacts"])
const AUTHORITY_ARTIFACT_FIELDS = new Set([
  "grant", "events", "trustedOwners", "trustedOwnerKeyFingerprint",
  "trustedOwnerBundleContentHash",
])
const OWNER_FIELDS = Object.freeze([
  "credentialTouches", "diagnosticTouches", "operationTouches", "routineContacts",
  "routineDecisions",
])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const SAFE_TEXT = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]{1,512}$/u
const MESSAGE_FIELDS = new Set([
  "assignmentHandle", "direction", "messageType", "summary", "idempotencyKey",
])
const MESSAGE_DIRECTIONS = new Set(["TO_ASSIGNMENT", "TO_COORDINATOR"])
const MESSAGE_TYPES = new Set([
  "STATUS", "RESULT", "REVIEW_REQUEST", "CHANGE_REQUEST", "CANCELLATION_NOTICE",
])
const START_FIELDS = new Set(["assignmentHandle", "idempotencyKey"])
const CANCELLATION_FIELDS = new Set(["assignmentHandle", "requestedBy", "reasonCode", "idempotencyKey"])
const OBSERVATION_FIELDS = new Set(["assignmentHandle", "observationId"])
const CANCELLATION_REASONS = new Set([
  "AUTHORITY_REVOKED", "RESERVATION_CONFLICT", "SECURITY_WALL", "SUPERSEDED",
  "WORK_ORDER_CANCELLED",
])
const PLAN_HANDLES = new WeakMap()
const ASSIGNMENT_HANDLES = new WeakMap()

export class HostedCodexCoordinatorAdapterError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "HostedCodexCoordinatorAdapterError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) {
  throw new HostedCodexCoordinatorAdapterError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("HOSTED_CODEX_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("HOSTED_CODEX_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("HOSTED_CODEX_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function text(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) {
    wall("HOSTED_CODEX_VALUE_WALL", field, "SAFE_VALUE_REQUIRED")
  }
  return value
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (plainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function hash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

function copy(value) {
  if (Array.isArray(value)) return value.map(copy)
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)]))
  return value
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function exactValue(actual, expected, code, field) {
  if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) wall(code, field, "EXACT_VALUE_REQUIRED")
}

function ownerBudget(value) {
  exactFields(value, new Set(OWNER_FIELDS), "ownerTouchBudget")
  for (const field of OWNER_FIELDS) {
    if (value[field] !== 0) wall("HOSTED_CODEX_OWNER_WALL", `ownerTouchBudget.${field}`, "ZERO_REQUIRED")
  }
  return Object.fromEntries(OWNER_FIELDS.map((field) => [field, 0]))
}

function authorityCounters() {
  return {
    OWNER_OPERATION_TOUCH_COUNT: 0,
    OWNER_CREDENTIAL_TOUCH_COUNT: 0,
    OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
    OWNER_ROUTINE_DECISION_COUNT: 0,
    OWNER_ROUTINE_CONTACT_COUNT: 0,
  }
}

function pathsFor(envelope) {
  return [...envelope.reservations.paths.map(({ path }) => path)].sort()
}

function normalizeCoordinatorSession(raw, expectedWorkerId) {
  exactFields(raw, SESSION_REFERENCE_FIELDS, "coordinatorHostSessionProofReference")
  const workerId = text(raw.workerId, "coordinatorHostSessionProofReference.workerId")
  if (workerId !== expectedWorkerId) wall("HOSTED_CODEX_SESSION_WALL", "coordinatorHostSessionProofReference.workerId", "DECLARED_COORDINATOR_REQUIRED")
  let handle
  try {
    handle = verifyCodexHostSessionIdentity({ proofId: text(raw.proofId, "coordinatorHostSessionProofReference.proofId") })
  } catch (error) {
    if (!(error instanceof CodexProviderConformanceError)) throw error
    wall("HOSTED_CODEX_SESSION_WALL", "coordinatorHostSessionProofReference", error.code)
  }
  if (handle.workerId !== workerId) wall("HOSTED_CODEX_SESSION_WALL", "coordinatorHostSessionProofReference.workerId", "HOST_IDENTITY_MISMATCH")
  if (Date.now() >= Date.parse(handle.expiresAt)) wall("HOSTED_CODEX_SESSION_WALL", "coordinatorHostSessionProofReference", "HOST_SESSION_EXPIRED")
  return handle
}

function normalizeTrustProofs(value) {
  if (!Array.isArray(value) || value.length === 0) wall("HOSTED_CODEX_TRUST_WALL", "preventiveTrustProofReferences", "NON_EMPTY_ARRAY_REQUIRED")
  const byKey = new Map()
  for (const [index, reference] of value.entries()) {
    const field = `preventiveTrustProofReferences[${index}]`
    exactFields(reference, TRUST_REFERENCE_FIELDS, field)
    const proofId = text(reference.proofId, `${field}.proofId`)
    const raw = loadCanonicalHostedCodexTrustRecord(proofId)
    if (!raw) wall("HOSTED_CODEX_TRUST_WALL", field, "HOST_ISSUED_TRUST_PROOF_REQUIRED")
    exactFields(raw, TRUST_FIELDS, field)
    for (const [name, expected] of Object.entries({
      schemaVersion: 2,
      artifactType: "HOSTED_CODEX_PREVENTIVE_TRUST_EVIDENCE",
      proofId,
      provider: "hosted-codex",
      surface: "current-hosted-session-native-team",
      promptInjectionBoundary: "trusted-work-order-envelope-v1",
      rawCredentialInspection: false,
      exactPathConfinement: true,
      outputRedaction: true,
      cancellationSupported: true,
      independentEvidenceCapture: true,
      status: "ACTIVE",
      authorityGranted: false,
    })) exactValue(raw[name], expected, "HOSTED_CODEX_TRUST_WALL", `${field}.${name}`)
    const workOrderId = text(raw.workOrderId, `${field}.workOrderId`)
    const laneId = text(raw.laneId, `${field}.laneId`)
    const requestedRole = text(raw.requestedRole, `${field}.requestedRole`)
    const workerId = text(raw.workerId, `${field}.workerId`)
    if (!Array.isArray(raw.allowedPaths) || raw.allowedPaths.length === 0) {
      wall("HOSTED_CODEX_PATH_SCOPE_WALL", `${field}.allowedPaths`, "NON_EMPTY_ARRAY_REQUIRED")
    }
    const allowedPaths = raw.allowedPaths.map((path, pathIndex) => {
      const result = text(path, `${field}.allowedPaths[${pathIndex}]`, /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/)
      if (result.split("/").includes("..")) wall("HOSTED_CODEX_PATH_SCOPE_WALL", `${field}.allowedPaths[${pathIndex}]`, "TRAVERSAL_FORBIDDEN")
      return result
    }).sort()
    if (new Set(allowedPaths).size !== allowedPaths.length) {
      wall("HOSTED_CODEX_PATH_SCOPE_WALL", `${field}.allowedPaths`, "DUPLICATE_PATH")
    }
    for (const instantField of ["issuedAt", "expiresAt", "evaluationTime"]) {
      if (!Number.isFinite(Date.parse(raw[instantField]))) wall("HOSTED_CODEX_TRUST_WALL", `${field}.${instantField}`, "VALID_INSTANT_REQUIRED")
    }
    if (Date.parse(raw.evaluationTime) < Date.parse(raw.issuedAt)
      || Date.parse(raw.evaluationTime) >= Date.parse(raw.expiresAt)
      || Date.now() >= Date.parse(raw.expiresAt)) {
      wall("HOSTED_CODEX_TRUST_WALL", field, "ACTIVE_UNEXPIRED_WINDOW_REQUIRED")
    }
    text(raw.envelopeContentHash, `${field}.envelopeContentHash`, /^[a-f0-9]{64}$/)
    const key = `${workOrderId}\u0000${laneId}\u0000${requestedRole}`
    if (byKey.has(key)) wall("HOSTED_CODEX_TRUST_WALL", field, "DUPLICATE_ROLE_PROOF")
    byKey.set(key, { ...copy(raw), workOrderId, laneId, requestedRole, workerId, allowedPaths })
  }
  return byKey
}

function normalizeHostBridge(reference) {
  exactFields(reference, BRIDGE_REFERENCE_FIELDS, "hostBridgeReference")
  const bridgeId = text(reference.bridgeId, "hostBridgeReference.bridgeId")
  const bridge = loadCanonicalHostedCodexNativeBridge(bridgeId)
  if (!bridge
    || bridge.bridgeId !== bridgeId
    || bridge.providerId !== "hosted-codex"
    || bridge.adapterId !== "hosted-codex-session-native-team-v1"
    || bridge.currentSessionOnly !== true
    || bridge.durableTransport !== false
    || bridge.hostIdempotencyEnforced !== true
    || bridge.lookupMayPerformSideEffect !== false
    || bridge.authorityGranted !== false
    || [
      bridge.spawn, bridge.lookupSpawn, bridge.send, bridge.lookupSend,
      bridge.cancel, bridge.lookupCancel, bridge.observe,
    ].some((operation) => typeof operation !== "function")) {
    wall("HOSTED_CODEX_BRIDGE_WALL", "hostBridgeReference", "CANONICAL_CURRENT_SESSION_BRIDGE_REQUIRED")
  }
  return bridge
}

function normalizeAuthorityProofs(value) {
  if (!Array.isArray(value) || value.length === 0) {
    wall("HOSTED_CODEX_AUTHORITY_WALL", "authorityProofs", "NON_EMPTY_ARRAY_REQUIRED")
  }
  const byWorkOrder = new Map()
  for (const [index, raw] of value.entries()) {
    const field = `authorityProofs[${index}]`
    exactFields(raw, AUTHORITY_PROOF_FIELDS, field)
    const workOrderId = text(raw.workOrderId, `${field}.workOrderId`)
    exactFields(raw.artifacts, AUTHORITY_ARTIFACT_FIELDS, `${field}.artifacts`)
    if (byWorkOrder.has(workOrderId)) wall("HOSTED_CODEX_AUTHORITY_WALL", field, "DUPLICATE_WORK_ORDER")
    byWorkOrder.set(workOrderId, raw.artifacts)
  }
  return byWorkOrder
}

function verifyLaneAuthority(envelope, artifacts) {
  if (!artifacts) wall("HOSTED_CODEX_AUTHORITY_WALL", envelope.workOrderId, "SIGNED_ACTIVE_GRANT_REQUIRED")
  const grantId = artifacts.grant?.grantId
  if (envelope.programActivationGrantRef !== null) {
    wall("HOSTED_CODEX_RUNTIME_WALL", "envelope.programActivationGrantRef", "NO_ACTIVATION_GRANT_ALLOWED")
  }
  exactValue(envelope.authorityGrantRefs, [grantId], "HOSTED_CODEX_AUTHORITY_WALL", "envelope.authorityGrantRefs")
  exactValue(
    envelope.grantStatusEventRefs,
    artifacts.events?.map(({ eventId }) => eventId),
    "HOSTED_CODEX_AUTHORITY_WALL",
    "envelope.grantStatusEventRefs",
  )
  let result
  for (const action of envelope.allowedActions) {
    try {
      result = validateOwnerAuthorityArtifacts({
        ...artifacts,
        counters: authorityCounters(),
        now: new Date(),
        request: {
          subjectType: artifacts.grant?.subject?.type,
          subjectId: artifacts.grant?.subject?.id,
          programId: envelope.programId,
          goalId: envelope.goalId,
          loopId: envelope.loopId,
          workOrderId: envelope.workOrderId,
          decisionId: artifacts.grant?.authorityDecisionId,
          repository: envelope.repositories[0],
          riskClass: envelope.riskClass,
          action,
          mergeMode: envelope.mergeMode,
        },
      })
    } catch (error) {
      if (!(error instanceof AuthorityAssertionError)) throw error
      wall("HOSTED_CODEX_AUTHORITY_WALL", envelope.workOrderId, error.code)
    }
  }
  return {
    grantId: result.grantId,
    authorityDecisionId: result.authorityDecisionId,
    grantStatus: result.currentGrantStatus,
    latestStatusEventHash: result.latestStatusEventHash,
    expiresAt: result.expiresAt,
    authorityGranted: false,
  }
}

function phaseFor(role) {
  return role === "coordinator" ? "COORDINATION" : role === "builder" ? "BUILD" : "REVIEW"
}

function assignmentId(runId, laneId, role) {
  return `${runId}.${laneId}.${role}`
}

function ensurePlan(plan) {
  if (!plainObject(plan) || !PLAN_HANDLES.has(plan)) {
    wall("HOSTED_CODEX_PLAN_HANDLE_WALL", "plan", "OPAQUE_COMPILED_PLAN_REQUIRED")
  }
  return PLAN_HANDLES.get(plan)
}

export function canonicalHostedCodexCoordinatorJson(value) {
  return JSON.stringify(canonical(value))
}

export function compileHostedCodexCoordinatorAdapter(input) {
  exactFields(input, INPUT_FIELDS, "input")
  if (input.schemaVersion !== 1 || input.artifactType !== "HOSTED_CODEX_COORDINATOR_ADAPTER_INPUT") {
    wall("HOSTED_CODEX_SCHEMA_WALL", "input", "V1_INPUT_REQUIRED")
  }
  const adapterRunId = text(input.adapterRunId, "adapterRunId")
  for (const [field, expected] of Object.entries({
    runtimeActivationRequested: false,
    localIssue357Requested: false,
    durableTransportClaimed: false,
  })) exactValue(input[field], expected, "HOSTED_CODEX_RUNTIME_WALL", field)
  const normalizedOwnerBudget = ownerBudget(input.ownerTouchBudget)

  let topology
  try {
    topology = compileTeamTopology(input.topologyInput)
  } catch (error) {
    if (!(error instanceof TeamTopologyError)) throw error
    wall("HOSTED_CODEX_TOPOLOGY_WALL", error.field, error.code)
  }
  if (topology.candidateFanOut.length === 0) {
    wall("HOSTED_CODEX_TOPOLOGY_WALL", "topology.candidateFanOut", "READY_LANE_REQUIRED")
  }

  let normalizedConformance
  try {
    normalizedConformance = normalizeCodexProviderConformance(input.conformance)
  } catch (error) {
    if (!(error instanceof CodexProviderConformanceError)) throw error
    wall("HOSTED_CODEX_CONFORMANCE_WALL", "conformance", error.code)
  }
  const trustProofs = normalizeTrustProofs(input.preventiveTrustProofReferences)
  const bridge = normalizeHostBridge(input.hostBridgeReference)
  const authorityProofs = normalizeAuthorityProofs(input.authorityProofs)
  const ready = new Set(topology.candidateFanOut.map(({ workOrderId }) => workOrderId))
  const readyLanes = topology.lanes.filter(({ workOrderId }) => ready.has(workOrderId))
  const assignments = []
  const seenAssignmentIds = new Set()
  const authorityByWorkOrder = new Map()
  const coordinatorSession = normalizeCoordinatorSession(
    input.coordinatorHostSessionProofReference,
    topology.coordinator,
  )

  for (const lane of readyLanes) {
    const envelope = input.topologyInput.dagInput.workOrders.find(({ workOrderId }) => workOrderId === lane.workOrderId)
    if (!envelope) wall("HOSTED_CODEX_TOPOLOGY_WALL", lane.workOrderId, "CANONICAL_V2_ENVELOPE_REQUIRED")
    const authority = verifyLaneAuthority(envelope, authorityProofs.get(lane.workOrderId))
    authorityByWorkOrder.set(lane.workOrderId, authority)
    let coordinatorCoordination
    try {
      coordinatorCoordination = evaluateCodexSessionCoordination({
        conformance: normalizedConformance,
        envelope,
        requestedRole: "coordinator",
        runtimeActivationRequested: false,
        hostSession: coordinatorSession,
      })
    } catch (error) {
      if (!(error instanceof CodexProviderConformanceError)) throw error
      wall("HOSTED_CODEX_CONFORMANCE_WALL", `${lane.workOrderId}.coordinator`, error.code)
    }
    for (const role of ["coordinator", "builder", "reviewer"]) {
      const workerId = lane.roleAssignments[role]
      const trustKey = `${lane.workOrderId}\u0000${lane.laneId}\u0000${role}`
      const trust = trustProofs.get(trustKey)
      if (!trust) wall("HOSTED_CODEX_TRUST_WALL", `${lane.workOrderId}.${role}`, "ROLE_PROOF_REQUIRED")
      if (trust.workerId !== workerId) wall("HOSTED_CODEX_TRUST_WALL", `${lane.workOrderId}.${role}`, "WORKER_MISMATCH")
      exactValue(trust.allowedPaths, pathsFor(envelope), "HOSTED_CODEX_PATH_SCOPE_WALL", `${lane.workOrderId}.${role}.allowedPaths`)
      exactValue(trust.envelopeContentHash, lane.envelopeContentHash, "HOSTED_CODEX_TRUST_WALL", `${lane.workOrderId}.${role}.envelopeContentHash`)

      const id = assignmentId(adapterRunId, lane.laneId, role)
      if (seenAssignmentIds.has(id)) wall("HOSTED_CODEX_ASSIGNMENT_WALL", "assignments", "DUPLICATE_ASSIGNMENT_ID")
      seenAssignmentIds.add(id)
      assignments.push({
        assignmentId: id,
        workOrderId: lane.workOrderId,
        laneId: lane.laneId,
        role,
        workerId,
        phase: phaseFor(role),
        taskPayload: {
          objectiveContentHash: hash({ objective: envelope.objective }),
          reservations: copy(envelope.reservations),
          allowedActions: [...envelope.allowedActions],
          forbiddenActions: [...envelope.forbiddenActions],
          requiredOutputs: [...envelope.requiredOutputs],
          requiredValidation: [...envelope.requiredValidation],
        },
        envelopeContentHash: lane.envelopeContentHash,
        hostIdentityDigest: role === "coordinator" ? hash({
          proofId: coordinatorCoordination.hostSessionProofId,
          hostIdentity: coordinatorCoordination.hostSessionId,
          workerId,
        }) : null,
        conformanceContentHash: coordinatorCoordination.conformanceContentHash,
        preventiveTrustContentHash: hash(trust),
        authorityGrantId: authority.grantId,
        cancellationSupported: true,
        messagePolicy: "COORDINATOR_ROUTED_ONLY",
        nativeAssignmentPrepared: true,
        nativeAssignmentExecuted: false,
        nativeBindingRequired: role !== "coordinator",
        nativeBindingEstablished: role === "coordinator",
        authorityGranted: false,
      })
    }
  }

  const uniqueCoordinatorCount = new Set(assignments
    .filter(({ role }) => role === "coordinator").map(({ workerId }) => workerId)).size
  const phaseWidths = {
    COORDINATION: uniqueCoordinatorCount,
    BUILD: uniqueCoordinatorCount + assignments.filter(({ role }) => role === "builder").length,
    REVIEW: uniqueCoordinatorCount + assignments.filter(({ role }) => role === "reviewer").length,
    REMEDIATION: uniqueCoordinatorCount + Math.min(1, assignments.filter(({ role }) => role === "builder").length),
  }
  const ceiling = normalizedConformance.capability.maxConcurrency
  if (!Number.isSafeInteger(ceiling) || Object.values(phaseWidths).some((width) => width > ceiling)) {
    wall("HOSTED_CODEX_CONCURRENCY_WALL", "topology", "CURRENT_SESSION_MAX_CONCURRENCY_EXCEEDED")
  }

  assignments.sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))
  const routes = assignments.flatMap((assignment) => {
    const coordinator = readyLanes.find(({ workOrderId }) => workOrderId === assignment.workOrderId).roleAssignments.coordinator
    if (assignment.workerId === coordinator) return []
    return [
      { workOrderId: assignment.workOrderId, laneId: assignment.laneId, sender: coordinator, recipient: assignment.workerId },
      { workOrderId: assignment.workOrderId, laneId: assignment.laneId, sender: assignment.workerId, recipient: coordinator },
    ]
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))

  const body = {
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_COORDINATOR_PLAN",
    adapterRunId,
    topologyId: topology.topologyId,
    topologyHash: topology.topologyHash,
    status: "CURRENT_SESSION_NATIVE_TEAM_READY",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    currentSessionOnly: true,
    assignmentCount: assignments.length,
    concurrency: { ceiling, phaseWidths },
    assignments,
    communication: {
      policy: "COORDINATOR_ROUTED_ONLY",
      routes,
      rawProviderOutputAllowed: false,
    },
    cancellation: {
      supported: true,
      requestedByCoordinatorOnly: true,
      providerCancellationClaimed: false,
    },
    evidence: {
      sanitizedOnly: true,
      independentCaptureRequired: true,
      rawProviderOutputAllowed: false,
    },
    ownerTouchBudget: normalizedOwnerBudget,
    ownerOperationEvidenceCertified: false,
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durableTransportClaimed: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    localIssue357Allowed: false,
    credentialInspectionAllowed: false,
    authorityMintingAllowed: false,
    authorityGranted: false,
  }
  const plan = deepFreeze({ ...body, planContentHash: hash(body) })
  const assignmentRuntime = new Map(plan.assignments.map((assignment) => [assignment.assignmentId, {
    state: assignment.role === "coordinator" ? "ACTIVE" : "PREPARED",
    nativeWorkerId: assignment.role === "coordinator" ? assignment.workerId : null,
    nativeBindingDigest: assignment.role === "coordinator" ? assignment.hostIdentityDigest : null,
    terminalResponseHash: null,
    ambiguousOperation: null,
  }]))
  PLAN_HANDLES.set(plan, deepFreeze({
    assignments: new Map(plan.assignments.map((assignment) => [assignment.assignmentId, assignment])),
    coordinators: new Map(readyLanes.map((lane) => [lane.workOrderId, lane.roleAssignments.coordinator])),
    authorityByWorkOrder,
    trustExpiresAt: Math.min(...[...trustProofs.values()].map(({ expiresAt }) => Date.parse(expiresAt))),
    coordinatorSession,
    bridge,
    conformance: deepFreeze(copy(normalizedConformance)),
    envelopeByWorkOrder: new Map(readyLanes.map((lane) => [
      lane.workOrderId,
      deepFreeze(copy(normalizeWorkOrderEnvelopeV2(input.topologyInput.dagInput.workOrders.find(({ workOrderId }) => workOrderId === lane.workOrderId)))),
    ])),
    assignmentRuntime,
    idempotency: new Map(),
    observations: new Map(),
  }))
  return plan
}

function revalidateCoordinator(trusted, assignment) {
  const session = trusted.coordinatorSession
  const workerId = trusted.coordinators.get(assignment.workOrderId)
  if (Date.now() >= Date.parse(session.expiresAt)) {
    wall("HOSTED_CODEX_SESSION_WALL", workerId, "HOST_SESSION_EXPIRED")
  }
  if (Date.now() >= trusted.trustExpiresAt) wall("HOSTED_CODEX_TRUST_WALL", assignment.assignmentId, "TRUST_PROOF_EXPIRED")
  if (Date.now() >= Date.parse(trusted.authorityByWorkOrder.get(assignment.workOrderId).expiresAt)) {
    wall("HOSTED_CODEX_AUTHORITY_WALL", assignment.workOrderId, "AUTHORITY_EXPIRED_WALL")
  }
  try {
    evaluateCodexSessionCoordination({
      conformance: trusted.conformance,
      envelope: trusted.envelopeByWorkOrder.get(assignment.workOrderId),
      requestedRole: "coordinator",
      runtimeActivationRequested: false,
      hostSession: session,
    })
  } catch (error) {
    if (!(error instanceof CodexProviderConformanceError)) throw error
    wall("HOSTED_CODEX_SESSION_WALL", workerId, error.code)
  }
}

function requireNativeBinding(trusted, assignment, field) {
  const runtime = trusted.assignmentRuntime.get(assignment.assignmentId)
  if (assignment.role !== "coordinator" && runtime.nativeWorkerId === null) {
    wall("HOSTED_CODEX_BRIDGE_WALL", field, "HOST_SPAWN_BINDING_REQUIRED")
  }
  return runtime
}

export function getHostedCodexNativeAssignmentHandle(plan, assignmentIdValue) {
  const trusted = ensurePlan(plan)
  const id = text(assignmentIdValue, "assignmentId")
  const assignment = trusted.assignments.get(id)
  if (!assignment) wall("HOSTED_CODEX_ASSIGNMENT_WALL", "assignmentId", "KNOWN_ASSIGNMENT_REQUIRED")
  const handle = deepFreeze({
    ok: true,
    code: "HOSTED_CODEX_ASSIGNMENT_HANDLE_ISSUED",
    adapterRunId: plan.adapterRunId,
    assignmentId: id,
    workOrderId: assignment.workOrderId,
    laneId: assignment.laneId,
    role: assignment.role,
    workerId: assignment.workerId,
    assignmentContentHash: hash(assignment),
    authorityGranted: false,
  })
  ASSIGNMENT_HANDLES.set(handle, { plan, assignmentId: id })
  return handle
}

function assignmentFromHandle(plan, trusted, handle, field) {
  if (!plainObject(handle) || !ASSIGNMENT_HANDLES.has(handle)) {
    wall("HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL", field, "OPAQUE_ASSIGNMENT_HANDLE_REQUIRED")
  }
  const binding = ASSIGNMENT_HANDLES.get(handle)
  if (binding.plan !== plan) wall("HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL", field, "CROSS_RUN_HANDLE_FORBIDDEN")
  const assignment = trusted.assignments.get(binding.assignmentId)
  if (!assignment) wall("HOSTED_CODEX_ASSIGNMENT_HANDLE_WALL", field, "KNOWN_ASSIGNMENT_REQUIRED")
  return assignment
}

function idempotent(trusted, key, digest, create) {
  text(key, "idempotencyKey")
  const prior = trusted.idempotency.get(key)
  if (prior) {
    if (prior.digest !== digest) wall("HOSTED_CODEX_REPLAY_WALL", "idempotencyKey", "CONFLICTING_REPLAY")
    return prior.result
  }
  const result = create()
  trusted.idempotency.set(key, { key, digest, operation: "LOCAL", status: "COMMITTED", result })
  return result
}

function exactBridgeResult(raw, fields, expected, field) {
  exactFields(raw, fields, field)
  for (const [name, value] of Object.entries(expected)) {
    exactValue(raw[name], value, "HOSTED_CODEX_BRIDGE_WALL", `${field}.${name}`)
  }
  return raw
}

function sideEffectAttempt({
  trusted, key, digest, operation, runtime, ambiguousState, perform, lookup, field,
}) {
  text(key, "idempotencyKey")
  const prior = trusted.idempotency.get(key)
  if (prior) {
    if (prior.digest !== digest) wall("HOSTED_CODEX_REPLAY_WALL", "idempotencyKey", "CONFLICTING_REPLAY")
    if (prior.status === "COMMITTED") return { committedResult: prior.result }
    if (prior.status !== "AMBIGUOUS" || prior.operation !== operation) {
      wall("HOSTED_CODEX_REPLAY_WALL", "idempotencyKey", "SIDE_EFFECT_TRANSACTION_INVALID")
    }
    let raw
    try {
      raw = lookup()
    } catch {
      wall("HOSTED_CODEX_BRIDGE_WALL", field, "HOST_SIDE_EFFECT_RECONCILIATION_PENDING")
    }
    return { record: prior, raw, reconciled: true }
  }

  const record = { key, digest, operation, status: "PENDING", result: null }
  trusted.idempotency.set(key, record)
  let raw
  try {
    raw = perform()
  } catch {
    record.status = "AMBIGUOUS"
    runtime.state = ambiguousState
    runtime.ambiguousOperation = { operation, idempotencyKey: key, digest }
    wall("HOSTED_CODEX_BRIDGE_WALL", field, "HOST_SIDE_EFFECT_OUTCOME_AMBIGUOUS")
  }
  return { record, raw, reconciled: false }
}

function quarantineSideEffect(transaction, runtime, ambiguousState) {
  transaction.record.status = "AMBIGUOUS"
  runtime.state = ambiguousState
  runtime.ambiguousOperation = {
    operation: transaction.record.operation,
    idempotencyKey: transaction.record.key,
    digest: transaction.record.digest,
  }
}

function commitSideEffect(transaction, runtime, result) {
  transaction.record.status = "COMMITTED"
  transaction.record.result = result
  runtime.ambiguousOperation = null
  return result
}

export function startHostedCodexNativeAssignment(plan, request) {
  const trusted = ensurePlan(plan)
  exactFields(request, START_FIELDS, "start")
  const assignment = assignmentFromHandle(plan, trusted, request.assignmentHandle, "start.assignmentHandle")
  revalidateCoordinator(trusted, assignment)
  if (assignment.role === "coordinator") wall("HOSTED_CODEX_ASSIGNMENT_WALL", "start.assignmentHandle", "CHILD_ASSIGNMENT_REQUIRED")
  const runtime = trusted.assignmentRuntime.get(assignment.assignmentId)
  const digest = hash({ operation: "SPAWN", assignmentId: assignment.assignmentId, idempotencyKey: request.idempotencyKey })
  const prior = trusted.idempotency.get(request.idempotencyKey)
  if (!prior) {
    if (runtime.state !== "PREPARED") wall("HOSTED_CODEX_ASSIGNMENT_WALL", "start", "PREPARED_ASSIGNMENT_REQUIRED")
    const occupied = [...trusted.assignmentRuntime.values()].filter(({ state }) => (
      !["PREPARED", "SUCCEEDED", "FAILED", "CANCELLED"].includes(state)
    )).length
    if (occupied >= plan.concurrency.ceiling) wall("HOSTED_CODEX_CONCURRENCY_WALL", "start", "CURRENT_SESSION_MAX_CONCURRENCY_EXCEEDED")
  }
  const envelope = trusted.envelopeByWorkOrder.get(assignment.workOrderId)
  const structuredTask = deepFreeze({
    objective: envelope.objective,
    reservations: copy(envelope.reservations),
    allowedActions: [...envelope.allowedActions],
    forbiddenActions: [...envelope.forbiddenActions],
    requiredOutputs: [...envelope.requiredOutputs],
    requiredValidation: [...envelope.requiredValidation],
  })
  const hostRequest = deepFreeze({
    adapterRunId: plan.adapterRunId,
    assignmentId: assignment.assignmentId,
    workOrderId: assignment.workOrderId,
    laneId: assignment.laneId,
    role: assignment.role,
    logicalWorkerId: assignment.workerId,
    structuredTask,
    taskContractHash: hash(structuredTask),
    idempotencyKey: request.idempotencyKey,
  })
  const transaction = sideEffectAttempt({
    trusted,
    key: request.idempotencyKey,
    digest,
    operation: "SPAWN",
    runtime,
    ambiguousState: "SPAWN_AMBIGUOUS",
    perform: () => trusted.bridge.spawn(hostRequest),
    lookup: () => trusted.bridge.lookupSpawn(hostRequest),
    field: "start",
  })
  if (transaction.committedResult) return transaction.committedResult
  try {
    const raw = transaction.raw
    const result = exactBridgeResult(raw, new Set([
      "schemaVersion", "artifactType", "bridgeId", "adapterRunId", "assignmentId", "workOrderId",
      "laneId", "role", "logicalWorkerId", "nativeWorkerId", "status", "spawnPerformed",
      "currentSessionOnly", "authorityGranted",
    ]), {
      schemaVersion: 1,
      artifactType: "HOSTED_CODEX_NATIVE_SPAWN_RESULT",
      bridgeId: trusted.bridge.bridgeId,
      adapterRunId: plan.adapterRunId,
      assignmentId: assignment.assignmentId,
      workOrderId: assignment.workOrderId,
      laneId: assignment.laneId,
      role: assignment.role,
      logicalWorkerId: assignment.workerId,
      status: "SPAWNED",
      spawnPerformed: true,
      currentSessionOnly: true,
      authorityGranted: false,
    }, "spawnResult")
    const nativeWorkerId = text(result.nativeWorkerId, "spawnResult.nativeWorkerId")
    const existingNativeIds = new Set([...trusted.assignmentRuntime.values()]
      .map(({ nativeWorkerId: existing }) => existing).filter(Boolean))
    if (nativeWorkerId === assignment.workerId || existingNativeIds.has(nativeWorkerId)) {
      wall("HOSTED_CODEX_BRIDGE_WALL", "spawnResult.nativeWorkerId", "DISTINCT_HOST_IDENTITY_REQUIRED")
    }
    runtime.nativeWorkerId = nativeWorkerId
    runtime.nativeBindingDigest = hash({ bridgeId: trusted.bridge.bridgeId, assignmentId: assignment.assignmentId, nativeWorkerId })
    runtime.state = "ACTIVE"
    const publicResult = deepFreeze({
      schemaVersion: 1,
      artifactType: "HOSTED_CODEX_NATIVE_ASSIGNMENT_STARTED",
      adapterRunId: plan.adapterRunId,
      assignmentId: assignment.assignmentId,
      workOrderId: assignment.workOrderId,
      laneId: assignment.laneId,
      role: assignment.role,
      nativeWorkerDigest: hash({ nativeWorkerId }),
      nativeAssignmentExecuted: true,
      currentSessionOnly: true,
      durableTransportClaimed: false,
      authorityGranted: false,
    })
    return commitSideEffect(transaction, runtime, publicResult)
  } catch (error) {
    quarantineSideEffect(transaction, runtime, "SPAWN_AMBIGUOUS")
    throw error
  }
}

function sanitizedMessageSummary(summary, assignment) {
  text(summary, "message.summary", SAFE_TEXT)
  try {
    return validateProviderResponse({
      schemaVersion: 1,
      artifactType: "PROVIDER_EVIDENCE",
      providerId: "hosted-codex",
      adapterId: "hosted-codex-session-native-team-v1",
      dispatchId: assignment.assignmentId,
      workOrderId: assignment.workOrderId,
      laneId: assignment.laneId,
      providerState: "RUNNING",
      reasonCode: null,
      sanitized: true,
      authorityGranted: false,
      eventId: "message-sanitization-check",
      evidenceType: "SANITIZED_MESSAGE",
      contentHash: hash({ summary }),
      summary,
      attributes: {},
      rawProviderOutputIncluded: false,
    }).summary
  } catch (error) {
    if (!(error instanceof ProviderContractError)) throw error
    wall("HOSTED_CODEX_MESSAGE_WALL", "message.summary", error.code)
  }
}

export function createHostedCodexNativeMessage(plan, request) {
  const trusted = ensurePlan(plan)
  exactFields(request, MESSAGE_FIELDS, "message")
  const assignment = assignmentFromHandle(plan, trusted, request.assignmentHandle, "message.assignmentHandle")
  revalidateCoordinator(trusted, assignment)
  const runtime = requireNativeBinding(trusted, assignment, "message.assignmentHandle")
  if (assignment.role === "coordinator") wall("HOSTED_CODEX_MESSAGE_WALL", "message.assignmentHandle", "CHILD_ASSIGNMENT_REQUIRED")
  if (!MESSAGE_DIRECTIONS.has(request.direction)) wall("HOSTED_CODEX_MESSAGE_WALL", "message.direction", "KNOWN_DIRECTION_REQUIRED")
  if (!MESSAGE_TYPES.has(request.messageType)) wall("HOSTED_CODEX_MESSAGE_WALL", "message.messageType", "KNOWN_TYPE_REQUIRED")
  const summary = sanitizedMessageSummary(request.summary, assignment)
  const coordinator = trusted.coordinators.get(assignment.workOrderId)
  const sender = request.direction === "TO_ASSIGNMENT" ? coordinator : assignment.workerId
  const recipient = request.direction === "TO_ASSIGNMENT" ? assignment.workerId : coordinator
  const messageDigest = hash({ sender, recipient, messageType: request.messageType, summary })
  const digest = hash({ operation: "SEND", assignmentId: assignment.assignmentId, messageDigest, idempotencyKey: request.idempotencyKey })
  const prior = trusted.idempotency.get(request.idempotencyKey)
  const reconciling = runtime.state === "SEND_AMBIGUOUS"
    && prior?.operation === "SEND" && prior.digest === digest && prior.status === "AMBIGUOUS"
  if (runtime.state !== "ACTIVE" && !reconciling) {
    wall("HOSTED_CODEX_MESSAGE_WALL", "message", "ACTIVE_ASSIGNMENT_REQUIRED")
  }
  const hostRequest = deepFreeze({
    assignmentId: assignment.assignmentId,
    nativeWorkerId: runtime.nativeWorkerId,
    senderWorkerId: sender,
    recipientWorkerId: recipient,
    messageType: request.messageType,
    summary,
    messageDigest,
    idempotencyKey: request.idempotencyKey,
  })
  const transaction = sideEffectAttempt({
    trusted,
    key: request.idempotencyKey,
    digest,
    operation: "SEND",
    runtime,
    ambiguousState: "SEND_AMBIGUOUS",
    perform: () => trusted.bridge.send(hostRequest),
    lookup: () => trusted.bridge.lookupSend(hostRequest),
    field: "message",
  })
  if (transaction.committedResult) return transaction.committedResult
  try {
    exactBridgeResult(transaction.raw, new Set([
      "schemaVersion", "artifactType", "bridgeId", "assignmentId", "nativeWorkerId",
      "messageDigest", "status", "deliveryPerformed", "authorityGranted",
    ]), {
      schemaVersion: 1,
      artifactType: "HOSTED_CODEX_NATIVE_SEND_RESULT",
      bridgeId: trusted.bridge.bridgeId,
      assignmentId: assignment.assignmentId,
      nativeWorkerId: runtime.nativeWorkerId,
      messageDigest,
      status: "DELIVERED",
      deliveryPerformed: true,
      authorityGranted: false,
    }, "sendResult")
    runtime.state = "ACTIVE"
    const publicResult = deepFreeze({
      schemaVersion: 1,
      artifactType: "HOSTED_CODEX_NATIVE_MESSAGE_RESULT",
      adapterRunId: plan.adapterRunId,
      assignmentId: assignment.assignmentId,
      workOrderId: assignment.workOrderId,
      laneId: assignment.laneId,
      senderWorkerId: sender,
      recipientWorkerId: recipient,
      messageType: request.messageType,
      messageDigest,
      sanitized: true,
      rawProviderOutputIncluded: false,
      deliveryPerformed: true,
      durablePersistenceClaimed: false,
      authorityGranted: false,
    })
    return commitSideEffect(transaction, runtime, publicResult)
  } catch (error) {
    quarantineSideEffect(transaction, runtime, "SEND_AMBIGUOUS")
    throw error
  }
}

export function cancelHostedCodexNativeAssignment(plan, request) {
  const trusted = ensurePlan(plan)
  exactFields(request, CANCELLATION_FIELDS, "cancellation")
  const assignment = assignmentFromHandle(plan, trusted, request.assignmentHandle, "cancellation.assignmentHandle")
  revalidateCoordinator(trusted, assignment)
  if (assignment.role === "coordinator") wall("HOSTED_CODEX_CANCELLATION_WALL", "cancellation.assignmentHandle", "CHILD_ASSIGNMENT_REQUIRED")
  const requestedBy = text(request.requestedBy, "cancellation.requestedBy")
  if (requestedBy !== trusted.coordinators.get(assignment.workOrderId)) wall("HOSTED_CODEX_CANCELLATION_WALL", "cancellation.requestedBy", "COORDINATOR_REQUIRED")
  if (!CANCELLATION_REASONS.has(request.reasonCode)) wall("HOSTED_CODEX_CANCELLATION_WALL", "cancellation.reasonCode", "KNOWN_REASON_REQUIRED")
  const runtime = trusted.assignmentRuntime.get(assignment.assignmentId)
  const digest = hash({ operation: "CANCEL", assignmentId: assignment.assignmentId, reasonCode: request.reasonCode, idempotencyKey: request.idempotencyKey })
  const prior = trusted.idempotency.get(request.idempotencyKey)
  if (prior?.digest !== undefined && prior.digest !== digest) {
    wall("HOSTED_CODEX_REPLAY_WALL", "idempotencyKey", "CONFLICTING_REPLAY")
  }
  if (prior?.status === "COMMITTED") return prior.result
  if (runtime.state === "PREPARED") {
    return idempotent(trusted, request.idempotencyKey, digest, () => {
      runtime.state = "CANCELLED"
      return deepFreeze({
        schemaVersion: 1,
        artifactType: "HOSTED_CODEX_NATIVE_CANCELLATION_RESULT",
        adapterRunId: plan.adapterRunId,
        assignmentId: assignment.assignmentId,
        workOrderId: assignment.workOrderId,
        laneId: assignment.laneId,
        requestedBy,
        reasonCode: request.reasonCode,
        preDispatchCancellation: true,
        cancellationDelivered: false,
        cancellationAcknowledged: false,
        terminalState: "CANCELLED",
        runtimeActivationAllowed: false,
        authorityGranted: false,
      })
    })
  }
  const reconciling = runtime.state === "CANCEL_AMBIGUOUS"
    && prior?.operation === "CANCEL" && prior.status === "AMBIGUOUS"
  if (runtime.state !== "ACTIVE" && !reconciling) {
    if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(runtime.state)) {
      wall("HOSTED_CODEX_CANCELLATION_WALL", "cancellation", "TERMINAL_ASSIGNMENT_IMMUTABLE")
    }
    wall("HOSTED_CODEX_CANCELLATION_WALL", "cancellation", "ACTIVE_ASSIGNMENT_REQUIRED")
  }
  const hostRequest = deepFreeze({
    assignmentId: assignment.assignmentId,
    nativeWorkerId: runtime.nativeWorkerId,
    reasonCode: request.reasonCode,
    idempotencyKey: request.idempotencyKey,
  })
  const transaction = sideEffectAttempt({
    trusted,
    key: request.idempotencyKey,
    digest,
    operation: "CANCEL",
    runtime,
    ambiguousState: "CANCEL_AMBIGUOUS",
    perform: () => trusted.bridge.cancel(hostRequest),
    lookup: () => trusted.bridge.lookupCancel(hostRequest),
    field: "cancellation",
  })
  if (transaction.committedResult) return transaction.committedResult
  try {
    exactBridgeResult(transaction.raw, new Set([
        "schemaVersion", "artifactType", "bridgeId", "assignmentId", "nativeWorkerId",
        "reasonCode", "status", "cancellationPerformed", "cancelAcknowledged", "authorityGranted",
      ]), {
        schemaVersion: 1,
        artifactType: "HOSTED_CODEX_NATIVE_CANCEL_RESULT",
        bridgeId: trusted.bridge.bridgeId,
        assignmentId: assignment.assignmentId,
        nativeWorkerId: runtime.nativeWorkerId,
        reasonCode: request.reasonCode,
        status: "CANCELLED",
        cancellationPerformed: true,
        cancelAcknowledged: true,
        authorityGranted: false,
      }, "cancelResult")
    runtime.state = "CANCELLED"
    const publicResult = deepFreeze({
      schemaVersion: 1,
      artifactType: "HOSTED_CODEX_NATIVE_CANCELLATION_RESULT",
      adapterRunId: plan.adapterRunId,
      assignmentId: assignment.assignmentId,
      workOrderId: assignment.workOrderId,
      laneId: assignment.laneId,
      requestedBy,
      reasonCode: request.reasonCode,
      preDispatchCancellation: false,
      cancellationDelivered: true,
      cancellationAcknowledged: true,
      terminalState: "CANCELLED",
      runtimeActivationAllowed: false,
      authorityGranted: false,
    })
    return commitSideEffect(transaction, runtime, publicResult)
  } catch (error) {
    quarantineSideEffect(transaction, runtime, "CANCEL_AMBIGUOUS")
    throw error
  }
}

export function captureHostedCodexNativeEvidence(plan, request) {
  const trusted = ensurePlan(plan)
  exactFields(request, OBSERVATION_FIELDS, "observation")
  const assignment = assignmentFromHandle(plan, trusted, request.assignmentHandle, "observation.assignmentHandle")
  revalidateCoordinator(trusted, assignment)
  const runtime = requireNativeBinding(trusted, assignment, "observation.assignmentHandle")
  const observationId = text(request.observationId, "observation.observationId")
  if (["SPAWN_AMBIGUOUS", "SEND_AMBIGUOUS", "CANCEL_AMBIGUOUS"].includes(runtime.state)) {
    wall("HOSTED_CODEX_EVIDENCE_WALL", "observation", "SIDE_EFFECT_RECONCILIATION_REQUIRED")
  }
  let response
  try {
    response = trusted.bridge.observe(deepFreeze({
      observationId,
      assignmentId: assignment.assignmentId,
      nativeWorkerId: runtime.nativeWorkerId,
    }))
  } catch {
    wall("HOSTED_CODEX_BRIDGE_WALL", "observation", "HOST_OBSERVATION_FAILED")
  }
  let normalized
  try {
    normalized = validateProviderResponse(response)
  } catch (error) {
    if (!(error instanceof ProviderContractError)) throw error
    wall("HOSTED_CODEX_EVIDENCE_WALL", error.field, error.code)
  }
  if (normalized.dispatchId !== assignment.assignmentId
    || normalized.providerId !== plan.providerId
    || normalized.adapterId !== plan.adapterId
    || normalized.workOrderId !== assignment.workOrderId
    || normalized.laneId !== assignment.laneId) {
    wall("HOSTED_CODEX_EVIDENCE_WALL", "response", "EXACT_ASSIGNMENT_BINDING_REQUIRED")
  }
  if (normalized.artifactType === "PROVIDER_ARTIFACT") {
    const allowed = new Set(assignment.taskPayload.reservations.paths.map(({ path }) => path))
    if (!allowed.has(normalized.relativePath)) wall("HOSTED_CODEX_PATH_SCOPE_WALL", "response.relativePath", "EXACT_RESERVED_PATH_REQUIRED")
  }
  const terminalByProviderState = { SUCCEEDED: "SUCCEEDED", FAILED: "FAILED", CANCELLED: "CANCELLED" }
  const responseHash = hashProviderResponse(normalized)
  const priorObservation = trusted.observations.get(observationId)
  if (priorObservation) {
    if (priorObservation.responseHash !== responseHash) {
      wall("HOSTED_CODEX_REPLAY_WALL", "observation.observationId", "CONFLICTING_OBSERVATION_REPLAY")
    }
    return priorObservation.result
  }
  if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(runtime.state)) {
    if (terminalByProviderState[normalized.providerState] !== runtime.state
      || runtime.terminalResponseHash === null
      || runtime.terminalResponseHash !== responseHash) {
      wall("HOSTED_CODEX_TERMINAL_RACE_WALL", "response", "EXACT_TERMINAL_RESPONSE_REQUIRED")
    }
  } else if (terminalByProviderState[normalized.providerState]) {
    runtime.state = terminalByProviderState[normalized.providerState]
    runtime.terminalResponseHash = responseHash
  } else if (["ACCEPTED", "RUNNING"].includes(normalized.providerState)) {
    runtime.state = "ACTIVE"
  }
  const publicResult = deepFreeze({
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_SANITIZED_EVIDENCE_CAPTURE",
    adapterRunId: plan.adapterRunId,
    assignmentId: assignment.assignmentId,
    observationId,
    providerId: normalized.providerId,
    adapterId: normalized.adapterId,
    workOrderId: normalized.workOrderId,
    laneId: normalized.laneId,
    providerState: normalized.providerState,
    reasonCode: normalized.reasonCode,
    providerResponseType: normalized.artifactType,
    providerResponseHash: responseHash,
    terminalState: runtime.state,
    sanitized: true,
    rawProviderOutputIncluded: false,
    independentlyCaptured: true,
    durablePersistenceClaimed: false,
    authorityGranted: false,
  })
  trusted.observations.set(observationId, { responseHash, result: publicResult })
  return publicResult
}

// Canonical WO-MAO-030 compatibility surface. Legacy callers receive the hardened contract.
export const CodexCoordinatorAdapterError = HostedCodexCoordinatorAdapterError
export const adaptCodexCoordinatorPlan = compileHostedCodexCoordinatorAdapter
export const canonicalCodexCoordinatorAdapterJson = canonicalHostedCodexCoordinatorJson
export const CODEX_COORDINATOR_ADAPTER_ID = "hosted-codex-session-native-team-v1"
