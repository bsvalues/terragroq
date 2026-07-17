import crypto from "node:crypto"

import {
  ProviderUnavailableSettlementError,
  verifyPinnedProviderAssessmentTrustBundle,
  verifyProviderUnavailableAssessment,
} from "./provider-unavailable-settlement.mjs"

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
  "reviewerProviderId",
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
      reviewerProviderId: safeIdentifier(raw.reviewerProviderId, `reviewRequests[${index}].reviewerProviderId`),
      reviewMode: raw.reviewMode,
    }
  }).sort((left, right) => left.requestId.localeCompare(right.requestId))
  if (new Set(requests.map(({ requestId }) => requestId)).size !== requests.length) {
    wall("CROSS_PROVIDER_DUPLICATE_WALL", "reviewRequests")
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
  if (verifiedDependencySettlement.ok === true) {
    wall(
      "CROSS_PROVIDER_REPROOF_REQUIRED_WALL",
      "routingReview",
      "WO_MAO_034_EXECUTION_AND_INDEPENDENT_REVIEW_REQUIRED",
    )
  }
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
    return {
      requestId: request.requestId,
      workOrderId: request.workOrderId,
      subjectProviderId: request.subjectProviderId,
      reviewerProviderId: request.reviewerProviderId,
      reviewMode: request.reviewMode,
      permitted: subjectEligible && reviewerEligible && modeAllowed,
      reasonCode: subjectEligible && reviewerEligible && modeAllowed
        ? "REVIEW_ROUTE_PERMITTED"
        : subject.status !== "ACTIVE" || reviewer.status !== "ACTIVE"
          ? "PROVIDER_UNAVAILABLE"
          : modeAllowed ? "CAPABILITY_OR_SCOPE_MISMATCH" : "REVIEW_MODE_MISMATCH",
    }
  })

  const output = {
    schemaVersion: 1,
    artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_RESULT",
    workOrderId: "WO-MAO-034",
    status: "CROSS_PROVIDER_ROUTING_REVIEW_PROVEN",
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
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function canonicalCrossProviderRoutingReviewJson(value) {
  return JSON.stringify(canonicalize(value))
}
