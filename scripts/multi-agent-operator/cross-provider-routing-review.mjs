import crypto from "node:crypto"

import {
  CROSS_PROVIDER_ROUTING_REVIEW_REGISTRY_METADATA,
  loadCanonicalCrossProviderRoutingReviewRegistry,
} from "./cross-provider-routing-review-registry.mjs"
import {
  loadCanonicalWoMao034ProviderUnavailableAssessment,
  ProviderUnavailableSettlementError,
  verifyPinnedProviderAssessmentTrustBundle,
  verifyProviderUnavailableAssessment,
} from "./provider-unavailable-settlement.mjs"
import { runWoMao034ProviderSettlement } from "./wo-mao-034-provider-settlement.mjs"

const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "workOrderId",
  "providers",
  "workOrders",
  "reviewRequests",
  "dependencySettlement",
])
const PROVIDER_FIELDS = new Set([
  "providerId",
  "status",
  "capabilityIds",
  "roles",
  "repositories",
  "secretIsolation",
  "workspaceIsolation",
  "rawCredentialAccess",
  "unavailableReason",
])
const WORK_ORDER_FIELDS = new Set([
  "workOrderId",
  "repository",
  "requiredRoles",
  "preferredProviders",
  "fallbackProviders",
])
const REVIEW_REQUEST_FIELDS = new Set([
  "requestId",
  "workOrderId",
  "subjectProviderId",
  "subjectAssignmentId",
  "subjectRole",
  "reviewerProviderId",
  "reviewerAssignmentId",
  "reviewerRole",
  "reviewMode",
])
const SETTLEMENT_FIELDS = new Set([
  "consumerWorkOrderId",
  "assessmentWorkOrderId",
  "subjectWorkOrderId",
  "lifecycleState",
  "reasonCode",
  "configuredTrust",
  "assessment",
])
const PROVIDER_STATUS = new Set(["ACTIVE", "UNAVAILABLE", "DISABLED"])
const REVIEW_MODES = new Set(["SAME_PROVIDER_INDEPENDENT_REVIEW", "CROSS_PROVIDER_REVIEW"])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,99})$/
const HOST_TRUSTED_INPUTS = new WeakMap()

export class CrossProviderRoutingReviewError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "CrossProviderRoutingReviewError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new CrossProviderRoutingReviewError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("CROSS_PROVIDER_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CROSS_PROVIDER_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CROSS_PROVIDER_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function safeIdentifier(value, field, pattern = IDENTIFIER) {
  if (typeof value !== "string" || !pattern.test(value)) {
    wall("CROSS_PROVIDER_FORMAT_WALL", field, "SAFE_IDENTIFIER_REQUIRED")
  }
  return value
}

function stringSet(value, field, pattern = IDENTIFIER) {
  if (!Array.isArray(value)) wall("CROSS_PROVIDER_TYPE_WALL", field, "ARRAY_REQUIRED")
  const output = value.map((entry, index) => safeIdentifier(entry, `${field}[${index}]`, pattern)).sort()
  if (new Set(output).size !== output.length) wall("CROSS_PROVIDER_DUPLICATE_WALL", field)
  return output
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

function exactValue(actual, expected, field, code = "CROSS_PROVIDER_CANONICAL_PROVENANCE_WALL") {
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    wall(code, field, "EXACT_CANONICAL_VALUE_REQUIRED")
  }
}

function verifySealedEvidence(value, field) {
  if (!plainObject(value) || typeof value.contentHash !== "string") {
    wall("CROSS_PROVIDER_EXECUTION_EVIDENCE_WALL", field, "SEALED_EVIDENCE_REQUIRED")
  }
  const claims = { ...value }
  delete claims.contentHash
  if (contentHash(claims) !== value.contentHash) {
    wall("CROSS_PROVIDER_EXECUTION_EVIDENCE_WALL", `${field}.contentHash`, "COMPUTED_HASH_MISMATCH")
  }
}

function verifyCanonicalRoutingEvidence(registry, settlement) {
  const evidence = registry.routingEvidence
  const { candidate, builderRole, reviewerRole } = evidence
  for (const [field, value] of Object.entries({
    candidate,
    builderRole,
    reviewerRole,
  })) verifySealedEvidence(value, `routingEvidence.${field}`)

  if (candidate.workOrderId !== "WO-MAO-034"
    || candidate.planId !== "plan-wo-mao-034-routing-review-v1"
    || candidate.laneId !== "LANE-WO-MAO-034"
    || candidate.repository !== "bsvalues/terragroq"
    || candidate.reservationPath !== "scripts/multi-agent-operator/cross-provider-routing-review.mjs"
    || candidate.readinessBaseCommitSha !== registry.readinessBaseCommitSha
    || candidate.readinessBaseTreeHash !== registry.readinessBaseTreeHash
    || candidate.consumerEnvelopeHash !== settlement.binding.consumerEnvelopeHash
    || candidate.settlementResultHash !== settlement.resultHash
    || candidate.implementationCandidateClaimed !== false) {
    wall("CROSS_PROVIDER_ROUTING_EVIDENCE_WALL", "routingEvidence.candidate", "CANONICAL_READINESS_ARTIFACT_REQUIRED")
  }

  if (builderRole.providerId !== "hosted-codex" || builderRole.role !== "builder"
    || reviewerRole.providerId !== "hosted-codex" || reviewerRole.role !== "reviewer"
    || builderRole.assignmentId === reviewerRole.assignmentId
    || builderRole.logicalWorkerId === reviewerRole.logicalWorkerId
    || builderRole.workOrderId !== candidate.workOrderId || reviewerRole.workOrderId !== candidate.workOrderId
    || builderRole.planId !== candidate.planId || reviewerRole.planId !== candidate.planId
    || builderRole.laneId !== candidate.laneId || reviewerRole.laneId !== candidate.laneId
    || builderRole.candidateId !== candidate.candidateId || reviewerRole.candidateId !== candidate.candidateId
    || builderRole.readOnly !== false || builderRole.writesReservedPathOnly !== true
    || reviewerRole.readOnly !== true || reviewerRole.writesReservedPathOnly !== false
    || builderRole.hostNativeBindingClaimed !== false || reviewerRole.hostNativeBindingClaimed !== false
    || builderRole.providerDispatchPerformed !== false || reviewerRole.providerDispatchPerformed !== false) {
    wall("CROSS_PROVIDER_INDEPENDENCE_WALL", "routingEvidence.roles", "DISTINCT_LOGICAL_BUILDER_REVIEWER_REQUIRED")
  }

  if (evidence.hostNativeBindingClaimed !== false || evidence.externalImplementationAssuranceRequired !== true
    || evidence.providerDispatchPerformed !== false || evidence.githubAutomationPerformed !== false
    || evidence.runtimeActivationPerformed !== false || evidence.authorityGranted !== false) {
    wall("CROSS_PROVIDER_ROUTING_EVIDENCE_WALL", "routingEvidence", "BOUNDED_NONCLAIMS_REQUIRED")
  }
  return evidence
}

function normalizeProviders(value) {
  if (!Array.isArray(value) || value.length === 0) wall("CROSS_PROVIDER_TYPE_WALL", "providers", "NON_EMPTY_ARRAY_REQUIRED")
  const providers = value.map((raw, index) => {
    exactFields(raw, PROVIDER_FIELDS, `providers[${index}]`)
    if (!PROVIDER_STATUS.has(raw.status)) wall("CROSS_PROVIDER_STATUS_WALL", `providers[${index}].status`, "KNOWN_STATUS_REQUIRED")
    for (const field of ["secretIsolation", "workspaceIsolation"]) {
      if (raw[field] !== true) wall("CROSS_PROVIDER_ISOLATION_WALL", `providers[${index}].${field}`, "TRUE_REQUIRED")
    }
    if (raw.rawCredentialAccess !== false) {
      wall("CROSS_PROVIDER_SECRET_WALL", `providers[${index}].rawCredentialAccess`, "FALSE_REQUIRED")
    }
    if (raw.status === "UNAVAILABLE" && raw.unavailableReason !== "PROVIDER_UNAVAILABLE") {
      wall("CROSS_PROVIDER_STATUS_WALL", `providers[${index}].unavailableReason`, "PROVIDER_UNAVAILABLE_REQUIRED")
    }
    if (raw.status !== "UNAVAILABLE" && raw.unavailableReason !== null) {
      wall("CROSS_PROVIDER_STATUS_WALL", `providers[${index}].unavailableReason`, "NULL_REQUIRED")
    }
    return {
      providerId: safeIdentifier(raw.providerId, `providers[${index}].providerId`),
      status: raw.status,
      capabilityIds: stringSet(raw.capabilityIds, `providers[${index}].capabilityIds`),
      roles: stringSet(raw.roles, `providers[${index}].roles`),
      repositories: stringSet(raw.repositories, `providers[${index}].repositories`, REPOSITORY),
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
      unavailableReason: raw.unavailableReason,
    }
  }).sort((left, right) => left.providerId.localeCompare(right.providerId))
  if (new Set(providers.map(({ providerId }) => providerId)).size !== providers.length) {
    wall("CROSS_PROVIDER_DUPLICATE_WALL", "providers")
  }
  return providers
}

function normalizeWorkOrders(value) {
  if (!Array.isArray(value) || value.length === 0) wall("CROSS_PROVIDER_TYPE_WALL", "workOrders", "NON_EMPTY_ARRAY_REQUIRED")
  const workOrders = value.map((raw, index) => {
    exactFields(raw, WORK_ORDER_FIELDS, `workOrders[${index}]`)
    return {
      workOrderId: safeIdentifier(raw.workOrderId, `workOrders[${index}].workOrderId`),
      repository: safeIdentifier(raw.repository, `workOrders[${index}].repository`, REPOSITORY),
      requiredRoles: stringSet(raw.requiredRoles, `workOrders[${index}].requiredRoles`),
      preferredProviders: stringSet(raw.preferredProviders, `workOrders[${index}].preferredProviders`),
      fallbackProviders: stringSet(raw.fallbackProviders, `workOrders[${index}].fallbackProviders`),
    }
  }).sort((left, right) => left.workOrderId.localeCompare(right.workOrderId))
  if (new Set(workOrders.map(({ workOrderId }) => workOrderId)).size !== workOrders.length) {
    wall("CROSS_PROVIDER_DUPLICATE_WALL", "workOrders")
  }
  return workOrders
}

function normalizeReviewRequests(value) {
  if (!Array.isArray(value)) wall("CROSS_PROVIDER_TYPE_WALL", "reviewRequests", "ARRAY_REQUIRED")
  const requests = value.map((raw, index) => {
    exactFields(raw, REVIEW_REQUEST_FIELDS, `reviewRequests[${index}]`)
    if (!REVIEW_MODES.has(raw.reviewMode)) wall("CROSS_PROVIDER_REVIEW_WALL", `reviewRequests[${index}].reviewMode`, "KNOWN_MODE_REQUIRED")
    return {
      requestId: safeIdentifier(raw.requestId, `reviewRequests[${index}].requestId`),
      workOrderId: safeIdentifier(raw.workOrderId, `reviewRequests[${index}].workOrderId`),
      subjectProviderId: safeIdentifier(raw.subjectProviderId, `reviewRequests[${index}].subjectProviderId`),
      subjectAssignmentId: safeIdentifier(raw.subjectAssignmentId, `reviewRequests[${index}].subjectAssignmentId`),
      subjectRole: safeIdentifier(raw.subjectRole, `reviewRequests[${index}].subjectRole`),
      reviewerProviderId: safeIdentifier(raw.reviewerProviderId, `reviewRequests[${index}].reviewerProviderId`),
      reviewerAssignmentId: safeIdentifier(raw.reviewerAssignmentId, `reviewRequests[${index}].reviewerAssignmentId`),
      reviewerRole: safeIdentifier(raw.reviewerRole, `reviewRequests[${index}].reviewerRole`),
      reviewMode: raw.reviewMode,
    }
  }).sort((left, right) => left.requestId.localeCompare(right.requestId))
  if (new Set(requests.map(({ requestId }) => requestId)).size !== requests.length) {
    wall("CROSS_PROVIDER_DUPLICATE_WALL", "reviewRequests")
  }
  for (const request of requests) {
    if (request.subjectRole !== "builder" || request.reviewerRole !== "reviewer"
      || request.subjectAssignmentId === request.reviewerAssignmentId) {
      wall("CROSS_PROVIDER_REVIEW_WALL", request.requestId, "DISTINCT_BUILDER_REVIEWER_ASSIGNMENTS_REQUIRED")
    }
  }
  return requests
}

function supportsWorkOrder(provider, workOrder) {
  return provider.status === "ACTIVE"
    && provider.repositories.includes(workOrder.repository)
    && workOrder.requiredRoles.every((role) => provider.roles.includes(role))
    && [...workOrder.preferredProviders, ...workOrder.fallbackProviders].includes(provider.providerId)
}

function verifyDependencySettlement(value) {
  exactFields(value, SETTLEMENT_FIELDS, "dependencySettlement")
  if (value.consumerWorkOrderId !== "WO-MAO-034") {
    wall("CROSS_PROVIDER_SETTLEMENT_WALL", "dependencySettlement.consumerWorkOrderId", "WO_MAO_034_REQUIRED")
  }
  if (value.assessmentWorkOrderId !== "WO-MAO-032") {
    wall("CROSS_PROVIDER_SETTLEMENT_WALL", "dependencySettlement.assessmentWorkOrderId", "WO_MAO_032_REQUIRED")
  }
  if (value.subjectWorkOrderId !== "WO-MAO-033") {
    wall("CROSS_PROVIDER_SETTLEMENT_WALL", "dependencySettlement.subjectWorkOrderId", "WO_MAO_033_REQUIRED")
  }
  if (value.lifecycleState !== "DEFERRED" || value.reasonCode !== "PROVIDER_UNAVAILABLE") {
    wall("CROSS_PROVIDER_SETTLEMENT_WALL", "dependencySettlement", "DEFERRED_PROVIDER_UNAVAILABLE_REQUIRED")
  }

  try {
    const configuredTrust = verifyPinnedProviderAssessmentTrustBundle(value.configuredTrust)
    const verifiedAssessment = verifyProviderUnavailableAssessment(value.assessment, configuredTrust)
    const assessment = verifiedAssessment.assessment
    if (assessment.assessmentWorkOrderId !== "WO-MAO-032"
      || assessment.subjectWorkOrderId !== "WO-MAO-033"
      || assessment.reasonCode !== "PROVIDER_UNAVAILABLE"
      || assessment.lifecycleState !== "DEFERRED") {
      wall("CROSS_PROVIDER_SETTLEMENT_WALL", "dependencySettlement.assessment", "BOUND_PROVIDER_UNAVAILABLE_ASSESSMENT_REQUIRED")
    }
    return verifiedAssessment
  } catch (error) {
    if (error instanceof CrossProviderRoutingReviewError) throw error
    if (error instanceof ProviderUnavailableSettlementError) {
      wall("CROSS_PROVIDER_SETTLEMENT_WALL", "dependencySettlement", error.message)
    }
    throw error
  }
}

function createHostTrustedCanonicalInput() {
  const registry = loadCanonicalCrossProviderRoutingReviewRegistry()
  const settlement = runWoMao034ProviderSettlement()
  if (settlement.status !== "CANONICAL_PROVIDER_UNAVAILABLE_SETTLEMENT_VERIFIED"
    || settlement.readiness.assessmentWorkOrderId !== "WO-MAO-032"
    || settlement.readiness.assessmentState !== "COMPLETE"
    || settlement.readiness.dependencyWorkOrderId !== "WO-MAO-033"
    || settlement.readiness.dependencyState !== "DEFERRED_PROVIDER_UNAVAILABLE"
    || settlement.readiness.workOrderId !== "WO-MAO-034"
    || settlement.readiness.state !== "READY" || settlement.readiness.completed !== false
    || settlement.provider.providerId !== "claude-code"
    || settlement.provider.status !== "UNAVAILABLE" || settlement.provider.enabled !== false
    || settlement.binding.consumerEnvelopeHash
      !== "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03"
    || settlement.resultHash !== "a1a3ee8742c14dcd458ce28d12d1a392d25d605018f074dc0ebe4855f62b11f9"
    || settlement.dispatchPerformed !== false || settlement.providerContractDispatchAllowed !== false
    || settlement.runtimeActivationAllowed !== false || settlement.authorityGranted !== false
    || settlement.secretsExposed !== false || settlement.ownerRelayRequired !== false
    || Object.values(settlement.ownerOperationCounters).some((value) => value !== 0)) {
    wall("CROSS_PROVIDER_CANONICAL_PROVENANCE_WALL", "settlement", "EXACT_VERIFIED_SETTLEMENT_REQUIRED")
  }
  const routingEvidence = verifyCanonicalRoutingEvidence(registry, settlement)
  const input = deepFreeze({
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_INPUT",
    workOrderId: "WO-MAO-034",
    providers: registry.providers,
    workOrders: registry.workOrders,
    reviewRequests: registry.reviewRequests,
    dependencySettlement: {
      consumerWorkOrderId: "WO-MAO-034",
      assessmentWorkOrderId: "WO-MAO-032",
      subjectWorkOrderId: "WO-MAO-033",
      lifecycleState: "DEFERRED",
      reasonCode: "PROVIDER_UNAVAILABLE",
      configuredTrust: {
        registryId: "williamos-provider-assessment-pins",
        registryVersion: 2,
      },
      assessment: loadCanonicalWoMao034ProviderUnavailableAssessment(),
    },
  })
  HOST_TRUSTED_INPUTS.set(input, Object.freeze({ registry, settlement, routingEvidence }))
  return input
}

export function runCanonicalCrossProviderRoutingReview() {
  return evaluateCrossProviderRoutingReview(createHostTrustedCanonicalInput())
}

export function evaluateCrossProviderRoutingReview(input) {
  exactFields(input, INPUT_FIELDS, "routingReview")
  if (input.schemaVersion !== 1) wall("CROSS_PROVIDER_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "CROSS_PROVIDER_ROUTING_REVIEW_INPUT") {
    wall("CROSS_PROVIDER_INPUT_WALL", "artifactType", "CROSS_PROVIDER_ROUTING_REVIEW_INPUT_REQUIRED")
  }
  if (input.workOrderId !== "WO-MAO-034") wall("CROSS_PROVIDER_INPUT_WALL", "workOrderId", "WO-MAO-034_REQUIRED")
  const providers = normalizeProviders(input.providers)
  const workOrders = normalizeWorkOrders(input.workOrders)
  const reviewRequests = normalizeReviewRequests(input.reviewRequests)
  const verifiedDependencySettlement = verifyDependencySettlement(input.dependencySettlement)
  const hostContext = plainObject(input) ? HOST_TRUSTED_INPUTS.get(input) : null
  if (!hostContext) wall("CROSS_PROVIDER_HOST_TRUST_WALL", "routingReview", "ZERO_INPUT_CANONICAL_EXECUTION_REQUIRED")
  HOST_TRUSTED_INPUTS.delete(input)
  exactValue(providers, hostContext.registry.providers, "providers")
  exactValue(workOrders, hostContext.registry.workOrders, "workOrders")
  exactValue(reviewRequests, hostContext.registry.reviewRequests, "reviewRequests")
  const providerById = new Map(providers.map((provider) => [provider.providerId, provider]))
  const workOrderById = new Map(workOrders.map((workOrder) => [workOrder.workOrderId, workOrder]))

  const routes = workOrders.map((workOrder) => {
    const eligibleProviders = providers
      .filter((provider) => supportsWorkOrder(provider, workOrder))
      .map((provider) => provider.providerId)
    const excludedProviders = providers
      .filter((provider) => !eligibleProviders.includes(provider.providerId))
      .map((provider) => ({
        providerId: provider.providerId,
        reasonCode: provider.status === "ACTIVE" ? "CAPABILITY_OR_SCOPE_MISMATCH" : provider.unavailableReason ?? "PROVIDER_DISABLED",
      }))
    return { workOrderId: workOrder.workOrderId, eligibleProviders, excludedProviders }
  })

  const reviewPlan = reviewRequests.map((request) => {
    const workOrder = workOrderById.get(request.workOrderId)
    if (!workOrder) wall("CROSS_PROVIDER_REVIEW_WALL", request.requestId, "KNOWN_WORK_ORDER_REQUIRED")
    const subject = providerById.get(request.subjectProviderId)
    const reviewer = providerById.get(request.reviewerProviderId)
    if (!subject || !reviewer) wall("CROSS_PROVIDER_REVIEW_WALL", request.requestId, "KNOWN_PROVIDER_REQUIRED")
    const subjectEligible = supportsWorkOrder(subject, workOrder)
    const reviewerEligible = reviewer.status === "ACTIVE"
      && reviewer.repositories.includes(workOrder.repository)
      && reviewer.roles.includes("reviewer")
    const sameProvider = request.subjectProviderId === request.reviewerProviderId
    const modeAllowed = request.reviewMode === "SAME_PROVIDER_INDEPENDENT_REVIEW" ? sameProvider : !sameProvider
    const independentAssignments = request.subjectAssignmentId !== request.reviewerAssignmentId
      && request.subjectRole === "builder" && request.reviewerRole === "reviewer"
    return {
      requestId: request.requestId,
      workOrderId: request.workOrderId,
      subjectProviderId: request.subjectProviderId,
      subjectAssignmentId: request.subjectAssignmentId,
      subjectRole: request.subjectRole,
      reviewerProviderId: request.reviewerProviderId,
      reviewerAssignmentId: request.reviewerAssignmentId,
      reviewerRole: request.reviewerRole,
      reviewMode: request.reviewMode,
      permitted: subjectEligible && reviewerEligible && modeAllowed && independentAssignments,
      reasonCode: subjectEligible && reviewerEligible && modeAllowed && independentAssignments
        ? "REVIEW_ROUTE_PERMITTED"
        : subject.status !== "ACTIVE" || reviewer.status !== "ACTIVE"
          ? "PROVIDER_UNAVAILABLE"
          : !modeAllowed ? "REVIEW_MODE_MISMATCH"
            : independentAssignments ? "CAPABILITY_OR_SCOPE_MISMATCH" : "REVIEW_INDEPENDENCE_MISMATCH",
    }
  })

  const output = {
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_RESULT",
    workOrderId: "WO-MAO-034",
    status: "CANONICAL_ROUTING_ROUTE_PROVEN_PENDING_EXTERNAL_ASSURANCE",
    routes,
    reviewPlan,
    unavailableProviders: providers
      .filter(({ status }) => status === "UNAVAILABLE")
      .map(({ providerId, unavailableReason }) => ({ providerId, reasonCode: unavailableReason })),
    dependencySettlement: {
      consumerWorkOrderId: "WO-MAO-034",
      assessmentWorkOrderId: "WO-MAO-032",
      subjectWorkOrderId: "WO-MAO-033",
      code: verifiedDependencySettlement.code,
      independentlyAuthoritative: verifiedDependencySettlement.independentlyAuthoritative,
      authorityGranted: verifiedDependencySettlement.authorityGranted,
      dispatchPerformed: verifiedDependencySettlement.dispatchPerformed,
    },
    registryProvenance: {
      registryId: hostContext.registry.registryId,
      registryVersion: hostContext.registry.registryVersion,
      registryContentHash: CROSS_PROVIDER_ROUTING_REVIEW_REGISTRY_METADATA.contentHash,
      readinessBaseCommitSha: hostContext.registry.readinessBaseCommitSha,
      readinessBaseTreeHash: hostContext.registry.readinessBaseTreeHash,
      settlementResultHash: hostContext.settlement.resultHash,
    },
    routingEvidence: {
      candidateId: hostContext.routingEvidence.candidate.candidateId,
      candidateContentHash: hostContext.routingEvidence.candidate.contentHash,
      readinessBaseCommitSha: hostContext.routingEvidence.candidate.readinessBaseCommitSha,
      readinessBaseTreeHash: hostContext.routingEvidence.candidate.readinessBaseTreeHash,
      laneId: hostContext.routingEvidence.candidate.laneId,
      reservationPath: hostContext.routingEvidence.candidate.reservationPath,
      builderAssignmentId: hostContext.routingEvidence.builderRole.assignmentId,
      builderLogicalWorkerId: hostContext.routingEvidence.builderRole.logicalWorkerId,
      reviewerAssignmentId: hostContext.routingEvidence.reviewerRole.assignmentId,
      reviewerLogicalWorkerId: hostContext.routingEvidence.reviewerRole.logicalWorkerId,
      logicalRouteRoleSeparationProven: true,
      hostNativeBindingClaimed: false,
      externalImplementationAssuranceRequired: true,
      routingEvaluationProven: true,
      sameProviderIndependentReviewRouteProven: true,
    },
    workOrderProjection: {
      workOrderId: "WO-MAO-034",
      state: "READY_PENDING_EXTERNAL_IMPLEMENTATION_ASSURANCE",
      dependencyWorkOrderId: "WO-MAO-033",
      dependencyState: "DEFERRED_PROVIDER_UNAVAILABLE",
      downstreamWorkOrderId: "WO-MAO-035",
      downstreamState: "PENDING",
      downstreamDependencyWaived: false,
    },
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
    hostNativeBindingClaimed: false,
    implementationAssuranceClaimed: false,
    ownerOperationCounters: {
      OWNER_OPERATION_TOUCH_COUNT: 0,
      OWNER_CREDENTIAL_TOUCH_COUNT: 0,
      OWNER_DIAGNOSTIC_TOUCH_COUNT: 0,
      OWNER_ROUTINE_DECISION_COUNT: 0,
      OWNER_ROUTINE_CONTACT_COUNT: 0,
    },
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function canonicalCrossProviderRoutingReviewJson(value) {
  return JSON.stringify(canonicalize(value))
}
