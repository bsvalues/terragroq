import crypto from "node:crypto"

import { normalizeProviderCapability } from "./provider-contract.mjs"
import {
  WorkOrderEnvelopeV2Error,
  normalizeWorkOrderEnvelopeV2,
} from "./work-order-envelope-v2.mjs"

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/
const CONFORMANCE_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "workOrderId",
  "controlPlaneRiskClass",
  "outcome",
  "sessionScope",
  "enabledForCurrentHostedSession",
  "capability",
  "providerContractDispatchAllowed",
  "durableTransport",
  "durablePersistence",
  "executableServiceWorker",
  "authorityMintingAllowed",
  "runtimeActivationAllowed",
  "localIssue357ExecutionAllowed",
  "localIssue357RetryAllowed",
  "phaseOneEvidence",
  "ownerTouchBudget",
])
const OWNER_FIELDS = Object.freeze([
  "credentialTouches",
  "diagnosticTouches",
  "operationTouches",
  "routineContacts",
  "routineDecisions",
])
const PHASE_ONE_EVIDENCE = Object.freeze([
  Object.freeze({ pullRequest: 364, mergeCommitSha: "8ec632aaacef731da2bc3e02958679b6c6273be6" }),
  Object.freeze({ pullRequest: 365, mergeCommitSha: "94795d37d4a844045f1461936c5744b89d2e28c0" }),
  Object.freeze({ pullRequest: 366, mergeCommitSha: "99cd0f20e4a214e8503784ff1226a9919d4b3889" }),
])
const EXACT_CAPABILITY = Object.freeze({
  schemaVersion: 1,
  artifactType: "PROVIDER_CAPABILITY_SNAPSHOT",
  providerId: "hosted-codex",
  adapterId: "hosted-codex-session-native-team-v1",
  availability: "UNAVAILABLE",
  riskClasses: Object.freeze(["R0", "R1"]),
  requirements: Object.freeze([
    "current-hosted-session",
    "native-team-coordination",
    "sanitized-evidence",
  ]),
  actions: Object.freeze([
    "READ_REPOSITORY",
    "RUN_VALIDATION",
    "WRITE_RESERVED_PATHS",
  ]),
  roles: Object.freeze(["builder", "coordinator", "remediator", "reviewer", "verifier"]),
  repositories: Object.freeze(["bsvalues/terragroq"]),
  maxConcurrency: 3,
  supportsCancellation: true,
  supportsArtifacts: true,
  supportsSanitizedEvidence: true,
  serviceCompatible: false,
  authorityMintingAllowed: false,
})
const SESSION_ENVELOPE_FIELDS = Object.freeze({
  programId: "PROGRAM-WILLIAMOS-MULTI-AGENT-OPERATOR-001",
  goalId: "GOAL-WOS-MULTI-AGENT-OPERATOR-001",
  loopId: "LOOP-WOS-MULTI-AGENT-OPERATOR-001",
  repositories: Object.freeze(["bsvalues/terragroq"]),
  providerRequirements: EXACT_CAPABILITY.requirements,
  preferredProviders: Object.freeze(["hosted-codex"]),
  fallbackProviders: Object.freeze([]),
  allowedActions: EXACT_CAPABILITY.actions,
})

export class CodexProviderConformanceError extends Error {
  constructor(code, field, detail = null) {
    super(`${code}:${field}${detail === null ? "" : `:${detail}`}`)
    this.name = "CodexProviderConformanceError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail = null) {
  throw new CodexProviderConformanceError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("CODEX_CONFORMANCE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("CODEX_CONFORMANCE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("CODEX_CONFORMANCE_MISSING_FIELD_WALL", `${field}.${missing}`)
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

function copy(value) {
  if (Array.isArray(value)) return value.map(copy)
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, copy(child)]))
  return value
}

function exactValue(actual, expected, field) {
  if (JSON.stringify(canonicalize(actual)) !== JSON.stringify(canonicalize(expected))) {
    wall("CODEX_CONFORMANCE_VALUE_WALL", field, "EXACT_VALUE_REQUIRED")
  }
}

function exactBoolean(input, field, expected) {
  if (input[field] !== expected) wall("CODEX_CONFORMANCE_VALUE_WALL", field, `${expected.toString().toUpperCase()}_REQUIRED`)
}

function ownerBudget(value) {
  exactFields(value, new Set(OWNER_FIELDS), "ownerTouchBudget")
  for (const field of OWNER_FIELDS) {
    if (value[field] !== 0) wall("CODEX_CONFORMANCE_OWNER_WALL", `ownerTouchBudget.${field}`, "ZERO_REQUIRED")
  }
  return Object.fromEntries(OWNER_FIELDS.map((field) => [field, 0]))
}

function phaseOneEvidence(value) {
  exactValue(value, PHASE_ONE_EVIDENCE, "phaseOneEvidence")
  return copy(PHASE_ONE_EVIDENCE)
}

function exactCapability(value) {
  let normalized
  try {
    normalized = normalizeProviderCapability(value)
  } catch (error) {
    wall("CODEX_CONFORMANCE_CAPABILITY_WALL", "capability", error.code ?? "INVALID_COMMON_CAPABILITY")
  }
  for (const [field, expected] of Object.entries(EXACT_CAPABILITY)) {
    if (JSON.stringify(canonicalize(normalized[field])) !== JSON.stringify(canonicalize(expected))) {
      wall("CODEX_CONFORMANCE_CAPABILITY_WALL", `capability.${field}`, "EXACT_VALUE_REQUIRED")
    }
  }
  return copy(normalized)
}

export function canonicalCodexProviderConformanceJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function codexProviderConformanceFixture() {
  return copy({
    schemaVersion: 1,
    artifactType: "CODEX_PROVIDER_CONFORMANCE",
    workOrderId: "WO-MAO-029",
    controlPlaneRiskClass: "R3",
    outcome: "SESSION_ONLY",
    sessionScope: "CURRENT_HOSTED_SESSION_NATIVE_TEAM_ONLY",
    enabledForCurrentHostedSession: true,
    capability: EXACT_CAPABILITY,
    providerContractDispatchAllowed: false,
    durableTransport: false,
    durablePersistence: false,
    executableServiceWorker: false,
    authorityMintingAllowed: false,
    runtimeActivationAllowed: false,
    localIssue357ExecutionAllowed: false,
    localIssue357RetryAllowed: false,
    phaseOneEvidence: PHASE_ONE_EVIDENCE,
    ownerTouchBudget: Object.fromEntries(OWNER_FIELDS.map((field) => [field, 0])),
  })
}

export function normalizeCodexProviderConformance(input) {
  exactFields(input, CONFORMANCE_FIELDS, "conformance")
  for (const [field, expected] of Object.entries({
    schemaVersion: 1,
    artifactType: "CODEX_PROVIDER_CONFORMANCE",
    workOrderId: "WO-MAO-029",
    controlPlaneRiskClass: "R3",
    outcome: "SESSION_ONLY",
    sessionScope: "CURRENT_HOSTED_SESSION_NATIVE_TEAM_ONLY",
  })) exactValue(input[field], expected, field)
  exactBoolean(input, "enabledForCurrentHostedSession", true)
  for (const field of [
    "providerContractDispatchAllowed",
    "durableTransport",
    "durablePersistence",
    "executableServiceWorker",
    "authorityMintingAllowed",
    "runtimeActivationAllowed",
    "localIssue357ExecutionAllowed",
    "localIssue357RetryAllowed",
  ]) exactBoolean(input, field, false)

  return deepFreeze({
    schemaVersion: 1,
    artifactType: "CODEX_PROVIDER_CONFORMANCE",
    workOrderId: "WO-MAO-029",
    controlPlaneRiskClass: "R3",
    outcome: "SESSION_ONLY",
    sessionScope: "CURRENT_HOSTED_SESSION_NATIVE_TEAM_ONLY",
    enabledForCurrentHostedSession: true,
    capability: exactCapability(input.capability),
    providerContractDispatchAllowed: false,
    durableTransport: false,
    durablePersistence: false,
    executableServiceWorker: false,
    authorityMintingAllowed: false,
    runtimeActivationAllowed: false,
    localIssue357ExecutionAllowed: false,
    localIssue357RetryAllowed: false,
    phaseOneEvidence: phaseOneEvidence(input.phaseOneEvidence),
    ownerTouchBudget: ownerBudget(input.ownerTouchBudget),
  })
}

export function validateCodexProviderConformance(input) {
  const conformance = normalizeCodexProviderConformance(input)
  const contentHash = crypto.createHash("sha256")
    .update(canonicalCodexProviderConformanceJson(conformance))
    .digest("hex")
  return deepFreeze({
    ok: true,
    code: "CODEX_PROVIDER_SESSION_ONLY",
    conformance,
    contentHash,
    currentSessionCoordinationAllowed: true,
    providerContractDispatchAllowed: false,
    authorityGranted: false,
  })
}

function exactSet(actual, expected, field) {
  exactValue(actual, expected, field)
}

export function evaluateCodexSessionCoordination(input) {
  exactFields(input, new Set(["conformance", "envelope", "requestedRole", "runtimeActivationRequested"]), "coordination")
  const validated = validateCodexProviderConformance(input.conformance)
  if (input.runtimeActivationRequested !== false) {
    wall("CODEX_CONFORMANCE_RUNTIME_WALL", "runtimeActivationRequested", "FALSE_REQUIRED")
  }
  if (typeof input.requestedRole !== "string" || !IDENTIFIER.test(input.requestedRole)) {
    wall("CODEX_CONFORMANCE_ROLE_WALL", "requestedRole", "SAFE_ROLE_REQUIRED")
  }
  if (!EXACT_CAPABILITY.roles.includes(input.requestedRole)) {
    wall("CODEX_CONFORMANCE_ROLE_WALL", "requestedRole", "SUPPORTED_NATIVE_ROLE_REQUIRED")
  }

  let envelope
  try {
    envelope = normalizeWorkOrderEnvelopeV2(input.envelope)
  } catch (error) {
    const detail = error instanceof WorkOrderEnvelopeV2Error ? error.code : "INVALID_V2_ENVELOPE"
    wall("CODEX_CONFORMANCE_ENVELOPE_WALL", error.field ?? "envelope", detail)
  }
  for (const field of ["programId", "goalId", "loopId"]) {
    exactValue(envelope[field], SESSION_ENVELOPE_FIELDS[field], `envelope.${field}`)
  }
  if (!EXACT_CAPABILITY.riskClasses.includes(envelope.riskClass)) {
    wall("CODEX_CONFORMANCE_RISK_WALL", "envelope.riskClass", "R0_OR_R1_REQUIRED")
  }
  for (const field of ["repositories", "providerRequirements", "preferredProviders", "fallbackProviders", "allowedActions"]) {
    exactSet(envelope[field], SESSION_ENVELOPE_FIELDS[field], `envelope.${field}`)
  }
  if (envelope.forbiddenActions.includes("RUNTIME_ACTIVATION") === false) {
    wall("CODEX_CONFORMANCE_RUNTIME_WALL", "envelope.forbiddenActions", "RUNTIME_ACTIVATION_REQUIRED")
  }
  const selectedIdentities = Object.values(envelope.teamRoles)
  if (new Set(selectedIdentities).size !== selectedIdentities.length) {
    wall("CODEX_CONFORMANCE_ROLE_WALL", "envelope.teamRoles", "DISTINCT_IDENTITIES_REQUIRED")
  }

  return deepFreeze({
    ok: true,
    code: "CODEX_CURRENT_SESSION_COORDINATION_ELIGIBLE",
    workOrderId: envelope.workOrderId,
    laneId: envelope.laneId,
    requestedRole: input.requestedRole,
    providerId: validated.conformance.capability.providerId,
    adapterId: validated.conformance.capability.adapterId,
    conformanceContentHash: validated.contentHash,
    coordinationAllowed: true,
    providerContractDispatchAllowed: false,
    dispatchPerformed: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
  })
}

export const CODEX_PROVIDER_CONFORMANCE_OWNER_COUNTER_FIELDS = OWNER_FIELDS
