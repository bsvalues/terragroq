import crypto from "node:crypto"

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

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function contentHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")
}

function sealed(claims) {
  return Object.freeze({ ...claims, contentHash: contentHash(claims) })
}

function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy)
  if (plainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepCopy(child)]))
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

const READINESS_BASE_COMMIT_SHA = "6cf94e9dcd1c482fdf5f0df74747c69b85ec7898"
const READINESS_BASE_TREE_HASH = "3fa0578ac7a0819a4fa8ab89398b63682d466e64"
const CONSUMER_ENVELOPE_HASH = "c03f2339666105cbe08b51ef32a50000d3b2441103f4420721f216c75667cb03"
const SETTLEMENT_RESULT_HASH = "a1a3ee8742c14dcd458ce28d12d1a392d25d605018f074dc0ebe4855f62b11f9"

const candidate = sealed({
  schemaVersion: 1,
  artifactType: "CANONICAL_ROUTING_READINESS_ARTIFACT",
  candidateId: "candidate-wo-mao-034-routing-readiness-v1",
  workOrderId: "WO-MAO-034",
  planId: "plan-wo-mao-034-routing-review-v1",
  laneId: "LANE-WO-MAO-034",
  repository: "bsvalues/terragroq",
  reservationPath: "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
  readinessBaseCommitSha: READINESS_BASE_COMMIT_SHA,
  readinessBaseTreeHash: READINESS_BASE_TREE_HASH,
  consumerEnvelopeHash: CONSUMER_ENVELOPE_HASH,
  settlementResultHash: SETTLEMENT_RESULT_HASH,
  implementationCandidateClaimed: false,
})

const builderRole = sealed({
  schemaVersion: 1,
  artifactType: "LOGICAL_ROUTING_ROLE_BINDING",
  assignmentId: "assignment-wo-mao-034-builder",
  logicalWorkerId: "worker-wo-mao-034-builder",
  providerId: "hosted-codex",
  role: "builder",
  workOrderId: "WO-MAO-034",
  planId: candidate.planId,
  laneId: candidate.laneId,
  candidateId: candidate.candidateId,
  readOnly: false,
  writesReservedPathOnly: true,
  hostNativeBindingClaimed: false,
  providerDispatchPerformed: false,
})

const reviewerRole = sealed({
  schemaVersion: 1,
  artifactType: "LOGICAL_ROUTING_ROLE_BINDING",
  assignmentId: "assignment-wo-mao-034-reviewer",
  logicalWorkerId: "worker-wo-mao-034-reviewer",
  providerId: "hosted-codex",
  role: "reviewer",
  workOrderId: "WO-MAO-034",
  planId: candidate.planId,
  laneId: candidate.laneId,
  candidateId: candidate.candidateId,
  readOnly: true,
  writesReservedPathOnly: false,
  hostNativeBindingClaimed: false,
  providerDispatchPerformed: false,
})

const EMBEDDED_REGISTRY = deepFreeze({
  schemaVersion: 1,
  artifactType: "CROSS_PROVIDER_ROUTING_REVIEW_REGISTRY",
  registryId: "williamos-cross-provider-routing-review",
  registryVersion: 1,
  readinessBaseCommitSha: READINESS_BASE_COMMIT_SHA,
  readinessBaseTreeHash: READINESS_BASE_TREE_HASH,
  capabilityProvenance: {
    providerId: "hosted-codex",
    capabilityIds: ["hosted-codex-coordinator-adapter", "hosted-codex-role-adapters"],
    evidenceRefs: [
      "components/operator/multi-agent-capability-registry.ts#hosted-codex-session",
      "components/operator/multi-agent-capability-registry.ts#hosted-codex-role-adapters",
      "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md",
    ],
    routingReviewOnly: true,
    providerContractDispatchAllowed: false,
  },
  providers: [
    {
      providerId: "claude-code",
      status: "UNAVAILABLE",
      capabilityIds: [],
      roles: [],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
      unavailableReason: "PROVIDER_UNAVAILABLE",
    },
    {
      providerId: "hosted-codex",
      status: "ACTIVE",
      capabilityIds: ["hosted-codex-coordinator-adapter", "hosted-codex-role-adapters"],
      roles: ["builder", "coordinator", "reviewer"],
      repositories: ["bsvalues/terragroq"],
      secretIsolation: true,
      workspaceIsolation: true,
      rawCredentialAccess: false,
      unavailableReason: null,
    },
  ],
  workOrders: [
    {
      workOrderId: "WO-MAO-034",
      repository: "bsvalues/terragroq",
      requiredRoles: ["builder", "reviewer"],
      preferredProviders: ["hosted-codex"],
      fallbackProviders: ["claude-code"],
    },
  ],
  reviewRequests: [
    {
      requestId: "review-claude-cross-provider",
      workOrderId: "WO-MAO-034",
      subjectProviderId: "hosted-codex",
      subjectAssignmentId: builderRole.assignmentId,
      subjectRole: "builder",
      reviewerProviderId: "claude-code",
      reviewerAssignmentId: "assignment-wo-mao-034-claude-reviewer",
      reviewerRole: "reviewer",
      reviewMode: "CROSS_PROVIDER_REVIEW",
    },
    {
      requestId: "review-codex-independent",
      workOrderId: "WO-MAO-034",
      subjectProviderId: "hosted-codex",
      subjectAssignmentId: builderRole.assignmentId,
      subjectRole: "builder",
      reviewerProviderId: "hosted-codex",
      reviewerAssignmentId: reviewerRole.assignmentId,
      reviewerRole: "reviewer",
      reviewMode: "SAME_PROVIDER_INDEPENDENT_REVIEW",
    },
  ],
  routingEvidence: {
    candidate,
    builderRole,
    reviewerRole,
    hostNativeBindingClaimed: false,
    externalImplementationAssuranceRequired: true,
    providerDispatchPerformed: false,
    githubAutomationPerformed: false,
    runtimeActivationPerformed: false,
    authorityGranted: false,
  },
})

const EMBEDDED_REGISTRY_CONTENT_HASH = "d83af5f3792225d5127e6dc024eb606b66961360967a9ab0c7069054af2dfb65"

export function canonicalCrossProviderRoutingReviewRegistryJson(value) {
  return canonicalJson(value)
}

export function crossProviderRoutingReviewRegistryContentHash(value = EMBEDDED_REGISTRY) {
  return contentHash(value)
}

export function verifyCanonicalCrossProviderRoutingReviewRegistry(value) {
  if (crossProviderRoutingReviewRegistryContentHash(value) !== EMBEDDED_REGISTRY_CONTENT_HASH) {
    const error = new Error("CROSS_PROVIDER_ROUTING_REGISTRY_INTEGRITY_WALL")
    error.code = "CROSS_PROVIDER_ROUTING_REGISTRY_INTEGRITY_WALL"
    throw error
  }
  return Object.freeze({
    ok: true,
    code: "CROSS_PROVIDER_ROUTING_REGISTRY_VERIFIED",
    contentHash: EMBEDDED_REGISTRY_CONTENT_HASH,
    authorityGranted: false,
    providerDispatchAllowed: false,
  })
}

export function loadCanonicalCrossProviderRoutingReviewRegistry() {
  verifyCanonicalCrossProviderRoutingReviewRegistry(EMBEDDED_REGISTRY)
  return deepFreeze(deepCopy(EMBEDDED_REGISTRY))
}

export const CROSS_PROVIDER_ROUTING_REVIEW_REGISTRY_METADATA = Object.freeze({
  registryId: EMBEDDED_REGISTRY.registryId,
  registryVersion: EMBEDDED_REGISTRY.registryVersion,
  readinessBaseCommitSha: EMBEDDED_REGISTRY.readinessBaseCommitSha,
  readinessBaseTreeHash: EMBEDDED_REGISTRY.readinessBaseTreeHash,
  contentHash: EMBEDDED_REGISTRY_CONTENT_HASH,
  mutableRegistrationAllowed: false,
  providerDispatchAllowed: false,
  hostNativeBindingClaimed: false,
  authorityGranted: false,
})
