import crypto from "node:crypto"

import {
  HostedCodexCoordinatorAdapterError,
  attestHostedCodexRoleAssignmentHandles,
  attestHostedCodexRoleAssignmentPair,
  attestHostedCodexSemanticEvidence,
  captureHostedCodexNativeSemanticEvidence,
  cancelHostedCodexNativeAssignment,
  createHostedCodexNativeMessage,
  startHostedCodexNativeAssignment,
} from "./codex-coordinator-adapter.mjs"

const ADAPTER_ID = "hosted-codex-role-lifecycle-v2"
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const SAFE_SUMMARY = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]{1,512}$/u
const INPUT_FIELDS = new Set([
  "schemaVersion", "artifactType", "adapterId", "plan", "builderAssignmentHandle",
  "reviewerAssignmentHandle", "idempotencyNamespace", "observationIds", "messageSummaries",
])
const HANDLE_FIELDS = new Set([
  "ok", "code", "adapterRunId", "assignmentId", "workOrderId", "laneId", "role",
  "workerId", "assignmentContentHash", "authorityGranted",
])
const OBSERVATION_FIELDS = new Set(["build", "requestChanges", "remediation", "approval"])
const MESSAGE_FIELDS = new Set([
  "buildDirective", "buildResultNotice", "reviewDirective", "changeRequestNotice",
  "remediationDirective", "remediationResultNotice", "rereviewDirective",
])
const OWNER_BUDGET_FIELDS = new Set([
  "credentialTouches", "diagnosticTouches", "operationTouches", "routineContacts",
  "routineDecisions",
])
const SEMANTIC_ATTESTATION_FIELDS = new Set([
  "assignmentId", "workOrderId", "laneId", "role", "observationId",
  "semanticConstraintId", "evidenceType", "providerResponseHash", "nativeBindingDigest",
  "authorityFenceDigest", "evidenceBindingDigest", "sanitized", "rawProviderOutputIncluded",
  "authorityGranted",
])
const ROLE_PAIR_FIELDS = new Set([
  "workOrderId", "laneId", "builderAssignmentId", "reviewerAssignmentId",
  "builderNativeBindingDigest", "reviewerNativeBindingDigest", "builderNativeWorkerDigest",
  "reviewerNativeWorkerDigest", "coordinatorWorkerId", "reservationDigest",
  "remediationBudget", "retryBudget", "authorityGranted",
])
const ROLE_PREFLIGHT_FIELDS = new Set([
  "workOrderId", "laneId", "builderAssignmentId", "reviewerAssignmentId",
  "coordinatorWorkerId", "reservationDigest", "remediationBudget", "retryBudget",
  "authorityGranted",
])
const REMEDIATION_BUDGET_FIELDS = new Set(["maxCycles"])
const RETRY_BUDGET_FIELDS = new Set(["maxAttempts", "backoffSeconds"])
const LIFECYCLES = new WeakMap()

const STAGE_CONSTRAINTS = Object.freeze({
  BUILD: Object.freeze({
    expectedKind: "CODEX_ROLE_BUILD_COMPLETE",
    semanticConstraintId: "BUILD_COMPLETE",
  }),
  REQUEST_CHANGES: Object.freeze({
    expectedKind: "CODEX_ROLE_REQUEST_CHANGES",
    semanticConstraintId: "REQUEST_CHANGES_ONE",
  }),
  REMEDIATION: Object.freeze({
    expectedKind: "CODEX_ROLE_REMEDIATION_COMPLETE",
    semanticConstraintId: "REMEDIATION_COMPLETE_ONE",
  }),
  APPROVAL: Object.freeze({
    expectedKind: "CODEX_ROLE_APPROVED_ZERO_UNRESOLVED",
    semanticConstraintId: "APPROVED_ZERO_UNRESOLVED",
  }),
})

export class CodexRoleAdapterError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "CodexRoleAdapterError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) {
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

function text(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || value.trim() !== value || !pattern.test(value)) {
    wall("CODEX_ROLE_VALUE_WALL", field, "SAFE_VALUE_REQUIRED")
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

function normalizedHandle(value, expectedRole, field) {
  exactFields(value, HANDLE_FIELDS, field)
  if (value.ok !== true || value.code !== "HOSTED_CODEX_ASSIGNMENT_HANDLE_ISSUED"
    || value.authorityGranted !== false || value.role !== expectedRole) {
    wall("CODEX_ROLE_ASSIGNMENT_WALL", field, `${expectedRole.toUpperCase()}_OPAQUE_HANDLE_REQUIRED`)
  }
  for (const name of ["adapterRunId", "assignmentId", "workOrderId", "laneId", "workerId"]) {
    text(value[name], `${field}.${name}`)
  }
  if (!/^[a-f0-9]{64}$/.test(value.assignmentContentHash)) {
    wall("CODEX_ROLE_ASSIGNMENT_WALL", `${field}.assignmentContentHash`, "CONTENT_HASH_REQUIRED")
  }
  return value
}

function normalizeObservations(value) {
  exactFields(value, OBSERVATION_FIELDS, "observationIds")
  const output = Object.fromEntries([...OBSERVATION_FIELDS].map((name) => [
    name,
    text(value[name], `observationIds.${name}`),
  ]))
  if (new Set(Object.values(output)).size !== OBSERVATION_FIELDS.size) {
    wall("CODEX_ROLE_REPLAY_WALL", "observationIds", "UNIQUE_STAGE_OBSERVATIONS_REQUIRED")
  }
  return output
}

function normalizeMessages(value) {
  exactFields(value, MESSAGE_FIELDS, "messageSummaries")
  return Object.fromEntries([...MESSAGE_FIELDS].map((name) => [
    name,
    text(value[name], `messageSummaries.${name}`, SAFE_SUMMARY),
  ]))
}

function validatePlanBoundary(plan, builder, reviewer) {
  if (!plainObject(plan)) wall("CODEX_ROLE_PLAN_WALL", "plan", "PRIVATE_COORDINATOR_PLAN_REQUIRED")
  const expected = {
    schemaVersion: 1,
    artifactType: "HOSTED_CODEX_COORDINATOR_PLAN",
    status: "CURRENT_SESSION_NATIVE_TEAM_READY",
    providerId: "hosted-codex",
    adapterId: "hosted-codex-session-native-team-v1",
    currentSessionOnly: true,
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durableTransportClaimed: false,
    runtimeActivationAllowed: false,
    localIssue357Allowed: false,
    credentialInspectionAllowed: false,
    authorityMintingAllowed: false,
    authorityGranted: false,
  }
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (plan[field] !== expectedValue) wall("CODEX_ROLE_PLAN_WALL", `plan.${field}`, "EXACT_HARDENED_PLAN_REQUIRED")
  }
  exactFields(plan.ownerTouchBudget, OWNER_BUDGET_FIELDS, "plan.ownerTouchBudget")
  if (Object.values(plan.ownerTouchBudget).some((value) => value !== 0)) {
    wall("CODEX_ROLE_OWNER_TOUCH_WALL", "plan.ownerTouchBudget", "ZERO_REQUIRED")
  }
  if (builder.adapterRunId !== plan.adapterRunId || reviewer.adapterRunId !== plan.adapterRunId) {
    wall("CODEX_ROLE_ASSIGNMENT_WALL", "assignmentHandles.adapterRunId", "SAME_PRIVATE_PLAN_REQUIRED")
  }
  if (builder.workOrderId !== reviewer.workOrderId || builder.laneId !== reviewer.laneId) {
    wall("CODEX_ROLE_ASSIGNMENT_WALL", "assignmentHandles", "SAME_WORK_ORDER_LANE_REQUIRED")
  }
  if (builder.assignmentId === reviewer.assignmentId || builder.workerId === reviewer.workerId) {
    wall("CODEX_ROLE_INDEPENDENCE_WALL", "assignmentHandles", "DISTINCT_BUILDER_REVIEWER_REQUIRED")
  }
  if (!Array.isArray(plan.assignments)) wall("CODEX_ROLE_PLAN_WALL", "plan.assignments", "ARRAY_REQUIRED")
  const assignmentFor = (handle) => plan.assignments.find(({ assignmentId }) => assignmentId === handle.assignmentId)
  const builderAssignment = assignmentFor(builder)
  const reviewerAssignment = assignmentFor(reviewer)
  if (!builderAssignment || !reviewerAssignment
    || hash(builderAssignment) !== builder.assignmentContentHash
    || hash(reviewerAssignment) !== reviewer.assignmentContentHash) {
    wall("CODEX_ROLE_ASSIGNMENT_WALL", "assignmentHandles", "EXACT_PLAN_ASSIGNMENTS_REQUIRED")
  }
  exactValue(
    builderAssignment.taskPayload?.reservations,
    reviewerAssignment.taskPayload?.reservations,
    "CODEX_ROLE_RESERVATION_WALL",
    "assignmentHandles.reservations",
  )
  const paths = builderAssignment.taskPayload?.reservations?.paths
  if (!Array.isArray(paths) || paths.length === 0) {
    wall("CODEX_ROLE_RESERVATION_WALL", "assignmentHandles.reservations.paths", "NON_EMPTY_EXACT_PATHS_REQUIRED")
  }
}

function exactBudgetBindings(binding, field) {
  exactFields(binding.remediationBudget, REMEDIATION_BUDGET_FIELDS, `${field}.remediationBudget`)
  exactFields(binding.retryBudget, RETRY_BUDGET_FIELDS, `${field}.retryBudget`)
  if (!Number.isSafeInteger(binding.remediationBudget.maxCycles) || binding.remediationBudget.maxCycles < 0) {
    wall("CODEX_ROLE_REMEDIATION_BUDGET_WALL", `${field}.remediationBudget.maxCycles`, "BOUNDED_INTEGER_REQUIRED")
  }
  if (!Number.isSafeInteger(binding.retryBudget.maxAttempts) || binding.retryBudget.maxAttempts < 1
    || !Number.isSafeInteger(binding.retryBudget.backoffSeconds) || binding.retryBudget.backoffSeconds < 0) {
    wall("CODEX_ROLE_RETRY_BUDGET_WALL", `${field}.retryBudget`, "BOUNDED_RETRY_BUDGET_REQUIRED")
  }
}

function validatePairIdentity(binding, fields, builder, reviewer, field) {
  exactFields(binding, fields, field)
  const expected = {
    workOrderId: builder.workOrderId,
    laneId: builder.laneId,
    builderAssignmentId: builder.assignmentId,
    reviewerAssignmentId: reviewer.assignmentId,
    authorityGranted: false,
  }
  for (const [name, value] of Object.entries(expected)) {
    if (binding[name] !== value) wall("CODEX_ROLE_ASSIGNMENT_WALL", `${field}.${name}`, "EXACT_PAIR_BINDING_REQUIRED")
  }
  text(binding.coordinatorWorkerId, `${field}.coordinatorWorkerId`)
  text(binding.reservationDigest, `${field}.reservationDigest`, /^[a-f0-9]{64}$/)
  exactBudgetBindings(binding, field)
  return binding
}

function coordinatorCall(field, callback) {
  try {
    return callback()
  } catch (error) {
    if (error instanceof CodexRoleAdapterError) throw error
    if (error instanceof HostedCodexCoordinatorAdapterError) {
      wall(
        "CODEX_ROLE_COORDINATOR_WALL",
        field,
        `${error.code}${error.detail === null || error.detail === undefined ? "" : `:${error.detail}`}`,
      )
    }
    wall("CODEX_ROLE_COORDINATOR_WALL", field, "HOSTED_COORDINATOR_FAILURE")
  }
}

function operationKey(scope, namespace, operation, handle) {
  return `role-${operation}-${hash({
    adapterRunId: scope.adapterRunId,
    workOrderId: handle.workOrderId,
    laneId: handle.laneId,
    assignmentId: handle.assignmentId,
    namespace,
    operation,
  }).slice(0, 32)}`
}

function send(plan, handle, namespace, operation, direction, messageType, summary) {
  return coordinatorCall(`messages.${operation}`, () => createHostedCodexNativeMessage(plan, {
    assignmentHandle: handle,
    direction,
    messageType,
    summary,
    idempotencyKey: operationKey(plan, namespace, operation, handle),
  }))
}

function observe(plan, handle, observationId, constraint, stage) {
  const evidenceHandle = coordinatorCall(`stages.${stage}.capture`, () => (
    captureHostedCodexNativeSemanticEvidence(plan, {
      assignmentHandle: handle,
      observationId,
      expectedKind: constraint.expectedKind,
    })
  ))
  const attestation = coordinatorCall(`stages.${stage}.attestation`, () => (
    attestHostedCodexSemanticEvidence(plan, {
      assignmentHandle: handle,
      evidenceHandle,
      semanticConstraintId: constraint.semanticConstraintId,
    })
  ))
  return { evidenceHandle, attestation }
}

function publicStage(stage, role, handle, observationId, constraint, attestation) {
  exactFields(attestation, SEMANTIC_ATTESTATION_FIELDS, `${stage}.attestation`)
  const expected = {
    assignmentId: handle.assignmentId,
    workOrderId: handle.workOrderId,
    laneId: handle.laneId,
    role,
    observationId,
    semanticConstraintId: constraint.semanticConstraintId,
    evidenceType: constraint.expectedKind,
    sanitized: true,
    rawProviderOutputIncluded: false,
    authorityGranted: false,
  }
  for (const [field, value] of Object.entries(expected)) {
    if (attestation[field] !== value) wall("CODEX_ROLE_EVIDENCE_WALL", `${stage}.attestation.${field}`, "EXACT_BINDING_REQUIRED")
  }
  for (const field of ["providerResponseHash", "nativeBindingDigest", "authorityFenceDigest", "evidenceBindingDigest"]) {
    text(attestation[field], `${stage}.attestation.${field}`, /^[a-f0-9]{64}$/)
  }
  return {
    stage,
    role,
    observationId,
    semanticKind: constraint.expectedKind,
    evidenceBindingDigest: text(attestation.evidenceBindingDigest, `${stage}.evidenceBindingDigest`, /^[a-f0-9]{64}$/),
    authorityFenceDigest: text(attestation.authorityFenceDigest, `${stage}.authorityFenceDigest`, /^[a-f0-9]{64}$/),
  }
}

function recoverableCoordinatorFailure(error) {
  return error instanceof CodexRoleAdapterError
    && error.code === "CODEX_ROLE_COORDINATOR_WALL"
    && typeof error.detail === "string"
    && (error.detail.endsWith(":HOST_SIDE_EFFECT_OUTCOME_AMBIGUOUS")
      || error.detail.endsWith(":HOST_SIDE_EFFECT_RECONCILIATION_PENDING")
      || error.detail.endsWith(":HOST_ATOMIC_FENCE_REJECTED")
      || error.detail === "HOSTED_CODEX_OBSERVATION_PENDING_WALL:HOST_OBSERVATION_NOT_COMMITTED")
}

function cleanupAssignment(plan, handle, preflight, namespace, transaction, label) {
  try {
    cancelHostedCodexNativeAssignment(plan, {
      assignmentHandle: handle,
      requestedBy: preflight.coordinatorWorkerId,
      reasonCode: "SECURITY_WALL",
      idempotencyKey: operationKey(plan, namespace, `cleanup-${label}`, handle),
    })
    transaction.cleanup[label] = "CANCELLED"
    return true
  } catch (error) {
    if (error instanceof HostedCodexCoordinatorAdapterError
      && error.code === "HOSTED_CODEX_CANCELLATION_WALL"
      && error.detail === "TERMINAL_ASSIGNMENT_IMMUTABLE") {
      transaction.cleanup[label] = "ALREADY_TERMINAL"
      return true
    }
    transaction.cleanup[label] = "QUARANTINED"
    return false
  }
}

function quarantineStartedChildren(plan, builder, reviewer, preflight, namespace, transaction) {
  transaction.cleanupAttempts += 1
  const builderSettled = cleanupAssignment(plan, builder, preflight, namespace, transaction, "builder")
  const reviewerSettled = cleanupAssignment(plan, reviewer, preflight, namespace, transaction, "reviewer")
  if (builderSettled && reviewerSettled) {
    transaction.status = "FAILED"
    return
  }
  if (transaction.cleanupAttempts >= preflight.retryBudget.maxAttempts) {
    transaction.status = "QUARANTINED_TERMINAL"
    wall("CODEX_ROLE_QUARANTINE_WALL", "roleLifecycle", "CHILD_CLEANUP_RETRY_BUDGET_EXHAUSTED")
  }
  transaction.nextRetryAt = Date.now() + (preflight.retryBudget.backoffSeconds * 1000)
  transaction.status = "CLEANUP_PENDING"
  wall("CODEX_ROLE_QUARANTINE_WALL", "roleLifecycle", "CHILD_CLEANUP_RECONCILIATION_REQUIRED")
}

export function adaptCodexRoleLifecycle(input) {
  exactFields(input, INPUT_FIELDS, "roleLifecycle")
  if (input.schemaVersion !== 2 || input.artifactType !== "CODEX_ROLE_LIFECYCLE_REQUEST"
    || input.adapterId !== ADAPTER_ID) {
    wall("CODEX_ROLE_INPUT_WALL", "roleLifecycle", "V2_LIFECYCLE_REQUEST_REQUIRED")
  }
  const builder = normalizedHandle(input.builderAssignmentHandle, "builder", "builderAssignmentHandle")
  const reviewer = normalizedHandle(input.reviewerAssignmentHandle, "reviewer", "reviewerAssignmentHandle")
  const namespace = text(input.idempotencyNamespace, "idempotencyNamespace")
  const observations = normalizeObservations(input.observationIds)
  const messages = normalizeMessages(input.messageSummaries)
  validatePlanBoundary(input.plan, builder, reviewer)
  const preflight = validatePairIdentity(
    coordinatorCall("rolePreflight", () => attestHostedCodexRoleAssignmentHandles(input.plan, {
      builderAssignmentHandle: builder,
      reviewerAssignmentHandle: reviewer,
    })),
    ROLE_PREFLIGHT_FIELDS,
    builder,
    reviewer,
    "rolePreflight",
  )
  if (preflight.remediationBudget.maxCycles < 1) {
    wall("CODEX_ROLE_REMEDIATION_BUDGET_WALL", "rolePreflight.remediationBudget.maxCycles", "AT_LEAST_ONE_CYCLE_REQUIRED")
  }

  const lifecycleKey = `${builder.assignmentId}\u0000${reviewer.assignmentId}`
  let planLifecycles = LIFECYCLES.get(input.plan)
  if (!planLifecycles) {
    planLifecycles = new Map()
    LIFECYCLES.set(input.plan, planLifecycles)
  }
  const requestDigest = hash({
    adapterRunId: input.plan.adapterRunId,
    builderAssignmentId: builder.assignmentId,
    reviewerAssignmentId: reviewer.assignmentId,
    namespace,
    observations,
    messages,
  })
  let transaction = planLifecycles.get(lifecycleKey)
  if (transaction) {
    if (transaction.status === "CLEANUP_PENDING") {
      if (transaction.requestDigest !== requestDigest) {
        wall("CODEX_ROLE_REPLAY_WALL", "roleLifecycle", "CONFLICTING_REPLAY")
      }
      if (Date.now() < transaction.nextRetryAt) {
        wall("CODEX_ROLE_BACKOFF_WALL", "roleLifecycle", "CLEANUP_RETRY_NOT_YET_ELIGIBLE")
      }
      quarantineStartedChildren(input.plan, builder, reviewer, preflight, transaction.namespace, transaction)
      wall("CODEX_ROLE_TERMINAL_WALL", "roleLifecycle", "FAILED_LIFECYCLE_IMMUTABLE")
    }
    if (transaction.status === "QUARANTINED_TERMINAL") {
      wall("CODEX_ROLE_QUARANTINE_WALL", "roleLifecycle", "CHILD_CLEANUP_RETRY_BUDGET_EXHAUSTED")
    }
    if (transaction.status === "COMMITTED") {
      if (transaction.requestDigest === requestDigest) return transaction.result
      wall("CODEX_ROLE_TERMINAL_WALL", "roleLifecycle", "APPROVED_LIFECYCLE_IMMUTABLE")
    }
    if (transaction.status === "FAILED") {
      wall("CODEX_ROLE_TERMINAL_WALL", "roleLifecycle", "FAILED_LIFECYCLE_IMMUTABLE")
    }
    if (transaction.requestDigest !== requestDigest) {
      wall("CODEX_ROLE_REPLAY_WALL", "roleLifecycle", "CONFLICTING_REPLAY")
    }
    if (Date.now() < transaction.nextRetryAt) {
      wall("CODEX_ROLE_BACKOFF_WALL", "roleLifecycle", "RETRY_NOT_YET_ELIGIBLE")
    }
    if (transaction.attemptCount >= transaction.retryBudget.maxAttempts) {
      quarantineStartedChildren(input.plan, builder, reviewer, preflight, transaction.namespace, transaction)
      wall("CODEX_ROLE_RETRY_BUDGET_WALL", "roleLifecycle", "LIFECYCLE_RETRY_BUDGET_EXHAUSTED")
    }
    transaction.attemptCount += 1
  } else {
    transaction = {
      requestDigest,
      status: "RUNNING",
      result: null,
      namespace,
      attemptCount: 1,
      retryBudget: preflight.retryBudget,
      nextRetryAt: 0,
      cleanupAttempts: 0,
      cleanup: { builder: "NOT_STARTED", reviewer: "NOT_STARTED" },
    }
    planLifecycles.set(lifecycleKey, transaction)
  }

  try {
  const builderStart = coordinatorCall("builder.start", () => startHostedCodexNativeAssignment(input.plan, {
    assignmentHandle: builder,
    idempotencyKey: operationKey(input.plan, namespace, "start-builder", builder),
  }))
  const reviewerStart = coordinatorCall("reviewer.start", () => startHostedCodexNativeAssignment(input.plan, {
    assignmentHandle: reviewer,
    idempotencyKey: operationKey(input.plan, namespace, "start-reviewer", reviewer),
  }))
  if (builderStart.nativeWorkerDigest === reviewerStart.nativeWorkerDigest) {
    wall("CODEX_ROLE_INDEPENDENCE_WALL", "nativeAssignments", "DISTINCT_NATIVE_IDENTITIES_REQUIRED")
  }
  const roleBinding = coordinatorCall("roleBindings", () => attestHostedCodexRoleAssignmentPair(input.plan, {
    builderAssignmentHandle: builder,
    reviewerAssignmentHandle: reviewer,
  }))
  validatePairIdentity(roleBinding, ROLE_PAIR_FIELDS, builder, reviewer, "roleBindings")
  for (const field of [
    "builderNativeBindingDigest", "reviewerNativeBindingDigest", "builderNativeWorkerDigest",
    "reviewerNativeWorkerDigest", "reservationDigest",
  ]) {
    text(roleBinding[field], `roleBindings.${field}`, /^[a-f0-9]{64}$/)
  }
  if (roleBinding.builderNativeBindingDigest === roleBinding.reviewerNativeBindingDigest) {
    wall("CODEX_ROLE_INDEPENDENCE_WALL", "roleBindings", "DISTINCT_NATIVE_BINDINGS_REQUIRED")
  }
  if (roleBinding.builderNativeWorkerDigest !== builderStart.nativeWorkerDigest
    || roleBinding.reviewerNativeWorkerDigest !== reviewerStart.nativeWorkerDigest) {
    wall("CODEX_ROLE_INDEPENDENCE_WALL", "roleBindings", "START_RECEIPT_NATIVE_BINDING_REQUIRED")
  }
  for (const field of ["coordinatorWorkerId", "reservationDigest", "remediationBudget", "retryBudget"]) {
    exactValue(roleBinding[field], preflight[field], "CODEX_ROLE_ASSIGNMENT_WALL", `roleBindings.${field}`)
  }

  send(input.plan, builder, namespace, "build-directive", "TO_ASSIGNMENT", "STATUS", messages.buildDirective)
  const build = observe(input.plan, builder, observations.build, STAGE_CONSTRAINTS.BUILD, "BUILD")
  send(input.plan, builder, namespace, "build-result", "TO_COORDINATOR", "RESULT", messages.buildResultNotice)

  send(input.plan, reviewer, namespace, "review-directive", "TO_ASSIGNMENT", "REVIEW_REQUEST", messages.reviewDirective)
  const requestChanges = observe(
    input.plan, reviewer, observations.requestChanges, STAGE_CONSTRAINTS.REQUEST_CHANGES, "ASSURANCE_REVIEW",
  )
  send(input.plan, reviewer, namespace, "change-request-notice", "TO_COORDINATOR", "CHANGE_REQUEST", messages.changeRequestNotice)
  send(input.plan, builder, namespace, "remediation-directive", "TO_ASSIGNMENT", "CHANGE_REQUEST", messages.remediationDirective)
  send(input.plan, builder, namespace, "remediation-result", "TO_COORDINATOR", "RESULT", messages.remediationResultNotice)
  const remediation = observe(
    input.plan, builder, observations.remediation, STAGE_CONSTRAINTS.REMEDIATION, "REMEDIATION",
  )

  send(input.plan, reviewer, namespace, "rereview-directive", "TO_ASSIGNMENT", "REVIEW_REQUEST", messages.rereviewDirective)
  const approval = observe(input.plan, reviewer, observations.approval, STAGE_CONSTRAINTS.APPROVAL, "REREVIEW")

  const body = {
    schemaVersion: 2,
    artifactType: "CODEX_ROLE_LIFECYCLE_RESULT",
    adapterId: ADAPTER_ID,
    status: "ROLE_LIFECYCLE_PROVEN",
    workOrderId: builder.workOrderId,
    laneId: builder.laneId,
    adapterRunId: builder.adapterRunId,
    roleBindings: {
      builder: { assignmentId: builder.assignmentId, logicalWorkerDigest: hash({ workerId: builder.workerId }), nativeWorkerDigest: builderStart.nativeWorkerDigest, nativeBindingDigest: roleBinding.builderNativeBindingDigest },
      reviewer: { assignmentId: reviewer.assignmentId, logicalWorkerDigest: hash({ workerId: reviewer.workerId }), nativeWorkerDigest: reviewerStart.nativeWorkerDigest, nativeBindingDigest: roleBinding.reviewerNativeBindingDigest },
      identitiesDistinct: true,
      reservationDigest: roleBinding.reservationDigest,
    },
    stages: [
      publicStage("BUILD", "builder", builder, observations.build, STAGE_CONSTRAINTS.BUILD, build.attestation),
      publicStage("ASSURANCE_REVIEW", "reviewer", reviewer, observations.requestChanges, STAGE_CONSTRAINTS.REQUEST_CHANGES, requestChanges.attestation),
      publicStage("REMEDIATION", "builder", builder, observations.remediation, STAGE_CONSTRAINTS.REMEDIATION, remediation.attestation),
      publicStage("REREVIEW", "reviewer", reviewer, observations.approval, STAGE_CONSTRAINTS.APPROVAL, approval.attestation),
    ],
    remediation: {
      originalBuilderReused: true,
      completedCycles: 1,
      maximumCycles: roleBinding.remediationBudget.maxCycles,
      budgetExceeded: false,
    },
    retry: {
      attemptsUsed: transaction.attemptCount,
      maximumAttempts: roleBinding.retryBudget.maxAttempts,
      backoffSeconds: roleBinding.retryBudget.backoffSeconds,
      budgetExceeded: false,
    },
    review: {
      independentReviewer: true,
      initialVerdict: "REQUEST_CHANGES",
      initialUnresolvedThreads: 1,
      finalVerdict: "APPROVED",
      finalUnresolvedThreads: 0,
    },
    messageCount: MESSAGE_FIELDS.size,
    sanitizedEvidenceOnly: true,
    rawProviderOutputIncluded: false,
    ownerRelayRequired: false,
    ownerTouchCount: 0,
    providerContractDispatchAllowed: false,
    nativeAssignmentsStarted: 2,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    localIssue357Allowed: false,
    githubMutationClaimed: false,
    authorityGranted: false,
  }
  const result = deepFreeze({ ...body, resultHash: hash(body) })
  transaction.status = "COMMITTED"
  transaction.result = result
  return result
  } catch (error) {
    if (recoverableCoordinatorFailure(error)) {
      transaction.nextRetryAt = Date.now() + (transaction.retryBudget.backoffSeconds * 1000)
      throw error
    }
    if (transaction.status !== "CLEANUP_PENDING" && transaction.status !== "QUARANTINED_TERMINAL") {
      quarantineStartedChildren(input.plan, builder, reviewer, preflight, namespace, transaction)
    }
    throw error
  }
}

export function canonicalCodexRoleAdapterJson(value) {
  return JSON.stringify(canonical(value))
}

export const CODEX_ROLE_ADAPTER_ID = ADAPTER_ID
export const CODEX_ROLE_STAGE_CONSTRAINTS = STAGE_CONSTRAINTS
