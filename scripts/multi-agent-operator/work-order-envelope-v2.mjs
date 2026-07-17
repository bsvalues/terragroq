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

const WO_MAO_034_SETTLEMENT_BASE_SHA = "42a63e3e11e5bb1a9c1e9419db3e0f2651b1789c"

function settlementEnvelope(workOrderId, specification = {}) {
  return {
    artifactType: ARTIFACT_TYPE,
    schemaVersion: 2,
    programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
    goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
    loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
    workOrderId,
    objective: specification.objective ?? `Verify completed prerequisite evidence for ${workOrderId}.`,
    riskClass: "R3",
    repositories: ["bsvalues/terragroq"],
    baseRefs: [{
      repository: "bsvalues/terragroq",
      ref: "refs/heads/main",
      commitSha: WO_MAO_034_SETTLEMENT_BASE_SHA,
    }],
    dependencies: specification.dependencies ?? [],
    fanInGate: "ALL",
    laneId: `LANE-${workOrderId}`,
    teamRoles: {
      coordinator: "codex-coordinator",
      builder: `builder-${workOrderId.toLowerCase()}`,
      reviewer: `reviewer-${workOrderId.toLowerCase()}`,
    },
    providerRequirements: ["isolated-worktree"],
    preferredProviders: ["hosted-codex"],
    fallbackProviders: [],
    reservations: {
      paths: (specification.paths ?? [`docs/reports/${workOrderId}-evidence.md`])
        .map((reservedPath) => ({ repository: "bsvalues/terragroq", path: reservedPath })),
      contracts: specification.contracts ?? [`contract-${workOrderId.toLowerCase()}`],
      environments: [],
    },
    allowedActions: specification.allowedActions ?? ["READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION"],
    forbiddenActions: ["OWNER_CONTACT", "CREDENTIAL_ACCESS", "RUNTIME_ACTIVATION"],
    authorityGrantRefs: ["docs/reports/WO-MAO-003-owner-only-authority-contract.md"],
    programActivationGrantRef: null,
    grantStatusEventRefs: [],
    requiredOutputs: specification.requiredOutputs ?? ["artifact"],
    requiredValidation: specification.requiredValidation ?? ["tests"],
    reviewRequirements: { independentReviewer: true, minimumApprovals: 1, maximumUnresolvedThreads: 0 },
    mergeMode: specification.mergeMode ?? "NO_MERGE",
    retryBudget: { maxAttempts: 1, backoffSeconds: 0 },
    remediationBudget: { maxCycles: 1 },
    reroutePolicy: "NONE",
    stopConditions: ["authority-wall"],
    evidenceTargets: ["owner-operation-counters"],
    ownerDecisionConditions: [],
    ownerOperationsAllowed: false,
    ownerTouchBudget: {
      operationTouches: 0,
      credentialTouches: 0,
      diagnosticTouches: 0,
      routineDecisions: 0,
      routineContacts: 0,
    },
    communicationPolicy: COMMUNICATION_POLICY,
    dependencyPolicies: [],
    providerBinding: null,
  }
}

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

export function createWoMao034ProviderSettlementEnvelopes() {
  const binding = Object.freeze({
    providerId: "claude-code",
    assessmentWorkOrderId: "WO-MAO-032",
    subjectWorkOrderId: "WO-MAO-033",
  })
  const governedDeliveryActions = [
    "READ_REPOSITORY", "WRITE_RESERVED_PATHS", "RUN_VALIDATION", "COMMIT_OWN_CHANGES",
    "PUSH_OWN_BRANCH", "OPEN_DRAFT_PR", "READ_CI_AND_REVIEW", "REMEDIATE_OWN_CHANGES",
    "MERGE_ELIGIBLE_PR", "VERIFY_POST_MERGE",
  ]
  const assessment = settlementEnvelope("WO-MAO-032", {
    objective: "Assess Claude only from static repository evidence; record provider unavailable without invoking Claude or contacting the owner.",
    dependencies: ["WO-MAO-007", "WO-MAO-019", "WO-MAO-022"],
    paths: [
      "scripts/multi-agent-operator/claude-provider-assessment.mjs",
      "docs/reports/WO-MAO-032-claude-capability-transport-proof.md",
      "tests/multi-agent-provider-unavailable-settlement.test.ts",
    ],
    contracts: ["claude-static-provider-assessment", "provider-unavailable-settlement-source"],
    allowedActions: governedDeliveryActions,
    requiredOutputs: ["static-provider-assessment", "provider-unavailable-source-hash"],
    requiredValidation: ["static-assessment-tests", "zero-owner-touch-proof"],
    mergeMode: "ASSURANCE_GATED",
  })
  assessment.providerBinding = { ...binding, role: "ASSESSMENT" }
  const subject = settlementEnvelope("WO-MAO-033", {
    objective: "Keep the Claude separate-repository adapter deferred and resumable while provider transport is unavailable.",
    dependencies: ["WO-MAO-025", "WO-MAO-028", "WO-MAO-032"],
    paths: [
      "docs/governance/active-program-queue.md",
      "docs/governance/loop-registry.md",
    ],
    contracts: ["claude-provider-unavailable-defer", "separate-workspace-adapter"],
    requiredOutputs: ["deferred-provider-lane-state"],
    requiredValidation: ["provider-unavailable-defer-proof", "zero-provider-invocation-proof"],
  })
  subject.providerBinding = { ...binding, role: "SUBJECT" }
  const consumer = settlementEnvelope("WO-MAO-034", {
    objective: "Prove consumer-specific cross-provider routing and review while excluding the unavailable Claude provider from capability and execution.",
    dependencies: ["WO-MAO-024", "WO-MAO-031", "WO-MAO-033"],
    paths: [
      "scripts/multi-agent-operator/work-order-envelope-v2.mjs",
      "scripts/multi-agent-operator/provider-unavailable-settlement.mjs",
      "scripts/multi-agent-operator/provider-assessment-trust-registry.mjs",
      "scripts/multi-agent-operator/dag-eligible-resolver.mjs",
      "scripts/multi-agent-operator/cross-provider-routing-review.mjs",
      "docs/reports/WO-MAO-034-cross-provider-routing-review.md",
      "tests/multi-agent-provider-unavailable-settlement.test.ts",
      "tests/multi-agent-cross-provider-routing-review.test.ts",
    ],
    contracts: ["consumer-specific-provider-settlement-v2", "cross-provider-routing-review"],
    allowedActions: governedDeliveryActions,
    requiredOutputs: ["authenticated-consumer-settlement", "cross-provider-routing-review-result"],
    requiredValidation: ["consumer-replay-tests", "provider-trust-tests", "routing-review-tests"],
    mergeMode: "ASSURANCE_GATED",
  })
  consumer.dependencyPolicies = [{
    dependencyWorkOrderId: "WO-MAO-033",
    satisfaction: "COMPLETE_OR_PROVIDER_UNAVAILABLE_DEFERRED",
    providerId: "claude-code",
    assessmentWorkOrderId: "WO-MAO-032",
  }]
  const assessmentResult = validateWorkOrderEnvelopeV2(assessment)
  const subjectResult = validateWorkOrderEnvelopeV2(subject)
  const consumerResult = validateWorkOrderEnvelopeV2(consumer)
  const prerequisiteReports = {
    "WO-MAO-007": "docs/reports/WO-MAO-007-worker-authority-trust-gate-v2.md",
    "WO-MAO-019": "docs/reports/WO-MAO-019-provider-capability-dispatch-contract.md",
    "WO-MAO-022": "docs/reports/WO-MAO-022-evidence-ledger-owner-touch-meter.md",
    "WO-MAO-024": "docs/reports/WO-MAO-024-team-topology-fan-out-fan-in.md",
    "WO-MAO-025": "docs/reports/WO-MAO-025-isolated-workspace-manager.md",
    "WO-MAO-028": "docs/reports/WO-MAO-028-scheduler-simulation-model-checking.md",
    "WO-MAO-031": "docs/reports/WO-MAO-031-codex-builder-assurance-remediation-adapters.md",
  }
  const prerequisiteEnvelopes = Object.freeze(Object.entries(prerequisiteReports).map(([workOrderId, reportPath]) => (
    validateWorkOrderEnvelopeV2(settlementEnvelope(workOrderId, {
      objective: `Bind completed ${workOrderId} prerequisite evidence into the WO-MAO-034 settlement DAG.`,
      paths: [reportPath],
      contracts: [`completed-prerequisite-${workOrderId.toLowerCase()}`],
      requiredOutputs: ["completed-prerequisite-evidence"],
      requiredValidation: ["completed-state-reference"],
    })).envelope
  )))
  return Object.freeze({
    assessmentEnvelope: assessmentResult.envelope,
    assessmentEnvelopeHash: assessmentResult.contentHash,
    subjectEnvelope: subjectResult.envelope,
    subjectEnvelopeHash: subjectResult.contentHash,
    consumerEnvelope: consumerResult.envelope,
    consumerEnvelopeHash: consumerResult.contentHash,
    prerequisiteEnvelopes,
    sourceAssessmentContentHash: "60917d122e314844e175c9d4e6e60e197a5e4f06bc2b6f2ea73b0fc1e09ed523",
  })
}

export const WORK_ORDER_ENVELOPE_V2_OWNER_COUNTER_FIELDS = OWNER_COUNTER_FIELDS
