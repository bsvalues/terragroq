import crypto from "node:crypto"

import { validateCodexProviderConformance } from "./codex-provider-conformance.mjs"

const INPUT_FIELDS = new Set([
  "schemaVersion",
  "artifactType",
  "workOrderId",
  "providers",
  "requiredContracts",
])
const PROVIDER_FIELDS = new Set([
  "providerId",
  "status",
  "kind",
  "conformance",
  "deferredReason",
])
const REQUIRED_CONTRACTS = Object.freeze([
  "dispatch",
  "status",
  "cancel",
  "evidence",
  "isolation",
  "retry",
  "recovery",
])
const PROVIDER_STATUS = new Set(["SESSION_ONLY", "EXECUTABLE_ENABLED", "DEFERRED_PROVIDER_UNAVAILABLE", "REJECTED", "DISABLED"])
const PROVIDER_KIND = new Set(["HOSTED_CODEX", "CLAUDE_CODE", "LOCAL_NESTED_CODEX", "HERMES", "OTHER"])
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/

export class ProviderConformanceSuiteError extends Error {
  constructor(code, field, detail = undefined) {
    super(detail ? `${code}:${field}:${detail}` : `${code}:${field}`)
    this.name = "ProviderConformanceSuiteError"
    this.code = code
    this.field = field
    this.detail = detail
  }
}

function wall(code, field, detail) {
  throw new ProviderConformanceSuiteError(code, field, detail)
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function exactFields(value, fields, field) {
  if (!plainObject(value)) wall("PROVIDER_CONFORMANCE_TYPE_WALL", field, "OBJECT_REQUIRED")
  const unknown = Object.keys(value).filter((key) => !fields.has(key)).sort()[0]
  if (unknown) wall("PROVIDER_CONFORMANCE_UNKNOWN_FIELD_WALL", `${field}.${unknown}`)
  const missing = [...fields].filter((key) => !Object.hasOwn(value, key)).sort()[0]
  if (missing) wall("PROVIDER_CONFORMANCE_MISSING_FIELD_WALL", `${field}.${missing}`)
}

function safeIdentifier(value, field) {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    wall("PROVIDER_CONFORMANCE_FORMAT_WALL", field, "SAFE_IDENTIFIER_REQUIRED")
  }
  return value
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

function requiredContracts(value) {
  if (!Array.isArray(value)) wall("PROVIDER_CONFORMANCE_TYPE_WALL", "requiredContracts", "ARRAY_REQUIRED")
  const normalized = value.map((entry, index) => safeIdentifier(entry, `requiredContracts[${index}]`)).sort()
  if (JSON.stringify(normalized) !== JSON.stringify([...REQUIRED_CONTRACTS].sort())) {
    wall("PROVIDER_CONFORMANCE_CONTRACT_WALL", "requiredContracts", "EXACT_PROVIDER_CONTRACT_SET_REQUIRED")
  }
  return normalized
}

function normalizeProviders(value) {
  if (!Array.isArray(value) || value.length === 0) wall("PROVIDER_CONFORMANCE_TYPE_WALL", "providers", "NON_EMPTY_ARRAY_REQUIRED")
  const providers = value.map((raw, index) => {
    exactFields(raw, PROVIDER_FIELDS, `providers[${index}]`)
    const providerId = safeIdentifier(raw.providerId, `providers[${index}].providerId`)
    if (!PROVIDER_STATUS.has(raw.status)) wall("PROVIDER_CONFORMANCE_STATUS_WALL", `providers[${index}].status`, "KNOWN_STATUS_REQUIRED")
    if (!PROVIDER_KIND.has(raw.kind)) wall("PROVIDER_CONFORMANCE_KIND_WALL", `providers[${index}].kind`, "KNOWN_KIND_REQUIRED")
    if (raw.status === "SESSION_ONLY") {
      if (raw.kind !== "HOSTED_CODEX") wall("PROVIDER_CONFORMANCE_STATUS_WALL", `providers[${index}].kind`, "HOSTED_CODEX_REQUIRED")
      if (raw.deferredReason !== null) wall("PROVIDER_CONFORMANCE_STATUS_WALL", `providers[${index}].deferredReason`, "NULL_REQUIRED")
      let conformance
      try {
        conformance = validateCodexProviderConformance(raw.conformance)
      } catch (error) {
        wall("PROVIDER_CONFORMANCE_CODEX_WALL", `providers[${index}].conformance`, error.code ?? "INVALID_CODEX_CONFORMANCE")
      }
      return { providerId, status: raw.status, kind: raw.kind, conformance }
    }
    if (raw.status === "EXECUTABLE_ENABLED") {
      wall("PROVIDER_CONFORMANCE_EXECUTABLE_WALL", `providers[${index}].status`, "NO_EXECUTABLE_PROVIDER_SUPPORTED_IN_THIS_SUITE")
    }
    if (raw.conformance !== null) {
      wall("PROVIDER_CONFORMANCE_STATUS_WALL", `providers[${index}].conformance`, "NULL_REQUIRED_FOR_EXCLUDED_PROVIDER")
    }
    if (!["PROVIDER_UNAVAILABLE", "REJECTED_LOCAL_ADAPTER", "PROVIDER_DISABLED"].includes(raw.deferredReason)) {
      wall("PROVIDER_CONFORMANCE_STATUS_WALL", `providers[${index}].deferredReason`, "KNOWN_EXCLUSION_REASON_REQUIRED")
    }
    return { providerId, status: raw.status, kind: raw.kind, deferredReason: raw.deferredReason }
  }).sort((left, right) => left.providerId.localeCompare(right.providerId))
  if (new Set(providers.map(({ providerId }) => providerId)).size !== providers.length) {
    wall("PROVIDER_CONFORMANCE_DUPLICATE_WALL", "providers")
  }
  return providers
}

export function evaluateProviderConformanceSuite(input) {
  wall(
    "PROVIDER_CONFORMANCE_SUITE_INVALIDATED_PENDING_REPROOF",
    "providerConformanceSuite",
    "WO_MAO_031_THROUGH_WO_MAO_036_ORDERED_REPROOF_REQUIRED",
  )
  exactFields(input, INPUT_FIELDS, "providerConformanceSuite")
  if (input.schemaVersion !== 1) wall("PROVIDER_CONFORMANCE_INPUT_WALL", "schemaVersion", "1_REQUIRED")
  if (input.artifactType !== "PROVIDER_CONFORMANCE_SUITE_INPUT") {
    wall("PROVIDER_CONFORMANCE_INPUT_WALL", "artifactType", "PROVIDER_CONFORMANCE_SUITE_INPUT_REQUIRED")
  }
  if (input.workOrderId !== "WO-MAO-036") wall("PROVIDER_CONFORMANCE_INPUT_WALL", "workOrderId", "WO-MAO-036_REQUIRED")
  const contracts = requiredContracts(input.requiredContracts)
  const providers = normalizeProviders(input.providers)
  const suite = providers.map((provider) => {
    if (provider.status === "SESSION_ONLY") {
      return {
        providerId: provider.providerId,
        status: "SESSION_ONLY_CONFORMANT",
        included: true,
        executableWorkerConformant: false,
        contractCoverage: {
          dispatch: "DENIED_BY_CONFORMANCE",
          status: "STATIC_CONFORMANCE_RECORD",
          cancel: "CURRENT_SESSION_SUPPORTED",
          evidence: "SANITIZED_EVIDENCE_SUPPORTED",
          isolation: "OWNER_TOUCH_AND_SECRET_BOUNDARIES_ENFORCED",
          retry: "CURRENT_SESSION_BOUNDED",
          recovery: "ORIGINAL_BUILDER_REMEDIATION_AND_REVIEW",
        },
        conformanceCode: provider.conformance.code,
        conformanceContentHash: provider.conformance.contentHash,
      }
    }
    return {
      providerId: provider.providerId,
      status: provider.status,
      included: false,
      executableWorkerConformant: false,
      reasonCode: provider.deferredReason,
    }
  })
  const output = {
    schemaVersion: 1,
    artifactType: "PROVIDER_CONFORMANCE_SUITE_RESULT",
    workOrderId: "WO-MAO-036",
    status: "PROVIDER_CONFORMANCE_SUITE_PROVEN",
    requiredContracts: contracts,
    suite,
    enabledExecutableProviders: [],
    deferredProviders: suite.filter(({ status }) => status === "DEFERRED_PROVIDER_UNAVAILABLE")
      .map(({ providerId, reasonCode }) => ({ providerId, reasonCode })),
    rejectedProviders: suite.filter(({ status }) => status === "REJECTED")
      .map(({ providerId, reasonCode }) => ({ providerId, reasonCode })),
    dispatchPerformed: false,
    providerCallPerformed: false,
    executableWorkerCertified: false,
    disabledProviderCertified: false,
    durablePersistenceClaimed: false,
    serviceWorkerClaimed: false,
    runtimeActivationAllowed: false,
    authorityGranted: false,
    secretsExposed: false,
    ownerRelayRequired: false,
  }
  return deepFreeze({ ...output, resultHash: contentHash(output) })
}

export function canonicalProviderConformanceSuiteJson(value) {
  return JSON.stringify(canonicalize(value))
}
