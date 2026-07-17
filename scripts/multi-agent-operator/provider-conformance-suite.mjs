import crypto from "node:crypto"

import {
  codexProviderConformanceFixture,
  validateCodexProviderConformance,
} from "./codex-provider-conformance.mjs"

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

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function contentHash(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex")
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

const READINESS_BASE_COMMIT_SHA = "ae25dddb0590c19748dc0af13aebfa60bd080728"
const READINESS_BASE_TREE_HASH = "97ab235a6f343a6de2fafbb3d406d7bf8b0695e2"
const CODEX_CONFORMANCE_CONTENT_HASH = "052c437518a59b15c3d3c5e3553765a00dcf8d94b2eba76b55f9b37f845c0d38"
const WO_MAO_035_RESULT_HASH = "678ddad3816fdbc8e9e6646906b4b1938147acc3629db9af34b65c644c5d8ca5"
const WO_MAO_035_EVIDENCE_HASH = "50e8489eb2d10c44f59fc8f9ff47141ad335118a321d53e1cd9d52aa507faf6a"

const EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY = deepFreeze({
  schemaVersion: 1,
  artifactType: "CANONICAL_PROVIDER_CONFORMANCE_SUITE_REGISTRY",
  registryId: "williamos-provider-conformance-suite",
  registryVersion: 1,
  workOrderId: "WO-MAO-036",
  repository: "bsvalues/terragroq",
  readinessBaseCommitSha: READINESS_BASE_COMMIT_SHA,
  readinessBaseTreeHash: READINESS_BASE_TREE_HASH,
  requiredContracts: REQUIRED_CONTRACTS,
  prerequisiteEvidence: {
    woMao031Complete: true,
    woMao034Complete: true,
    woMao035Complete: true,
    woMao035ResultHash: WO_MAO_035_RESULT_HASH,
    woMao035EvidenceHash: WO_MAO_035_EVIDENCE_HASH,
  },
  providers: [
    {
      providerId: "claude-code",
      status: "DEFERRED_PROVIDER_UNAVAILABLE",
      kind: "CLAUDE_CODE",
      conformance: null,
      deferredReason: "PROVIDER_UNAVAILABLE",
    },
    {
      providerId: "hosted-codex",
      status: "SESSION_ONLY",
      kind: "HOSTED_CODEX",
      conformance: codexProviderConformanceFixture(),
      deferredReason: null,
    },
    {
      providerId: "local-nested-codex",
      status: "REJECTED",
      kind: "LOCAL_NESTED_CODEX",
      conformance: null,
      deferredReason: "REJECTED_LOCAL_ADAPTER",
    },
  ],
  safety: {
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
  },
})

const EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY_CONTENT_HASH = "cdd0b0e429228567e18925dd66a40d672181fb54c0111ad0e200d6031097d733"

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
      if (conformance.contentHash !== CODEX_CONFORMANCE_CONTENT_HASH) {
        wall("PROVIDER_CONFORMANCE_CODEX_WALL", `providers[${index}].conformance`, "CANONICAL_CODEX_CONFORMANCE_REQUIRED")
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

export function evaluateProviderConformanceSuite() {
  wall(
    "PROVIDER_CONFORMANCE_HOST_TRUST_WALL",
    "providerConformanceSuite",
    "CALLER_SUPPLIED_PROVIDER_CONFORMANCE_INPUT_REJECTED_USE_CANONICAL_REGISTRY",
  )
}

function evaluateTrustedProviderConformanceSuite(registry) {
  if (contentHash(registry) !== EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY_CONTENT_HASH) {
    wall("PROVIDER_CONFORMANCE_REGISTRY_INTEGRITY_WALL", "providerConformanceRegistry", "CANONICAL_HASH_REQUIRED")
  }
  const contracts = requiredContracts(registry.requiredContracts)
  const providers = normalizeProviders(registry.providers)
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
    registryId: registry.registryId,
    registryVersion: registry.registryVersion,
    registryContentHash: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY_CONTENT_HASH,
    readinessBaseCommitSha: registry.readinessBaseCommitSha,
    readinessBaseTreeHash: registry.readinessBaseTreeHash,
    requiredContracts: contracts,
    prerequisiteEvidence: registry.prerequisiteEvidence,
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

export function loadCanonicalProviderConformanceRegistry() {
  return deepFreeze(deepCopy(EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY))
}

export function providerConformanceRegistryContentHash(value = EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY) {
  return contentHash(value)
}

export function verifyCanonicalProviderConformanceRegistry(value = EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY) {
  if (providerConformanceRegistryContentHash(value) !== EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY_CONTENT_HASH) {
    wall("PROVIDER_CONFORMANCE_REGISTRY_INTEGRITY_WALL", "providerConformanceRegistry", "CANONICAL_HASH_REQUIRED")
  }
  return deepFreeze({
    ok: true,
    code: "PROVIDER_CONFORMANCE_REGISTRY_VERIFIED",
    contentHash: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY_CONTENT_HASH,
    dispatchPerformed: false,
    providerCallPerformed: false,
    executableWorkerCertified: false,
    authorityGranted: false,
  })
}

export function runCanonicalProviderConformanceSuite() {
  verifyCanonicalProviderConformanceRegistry(EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY)
  return evaluateTrustedProviderConformanceSuite(EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY)
}

export const PROVIDER_CONFORMANCE_REGISTRY_METADATA = Object.freeze({
  registryId: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY.registryId,
  registryVersion: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY.registryVersion,
  readinessBaseCommitSha: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY.readinessBaseCommitSha,
  readinessBaseTreeHash: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY.readinessBaseTreeHash,
  contentHash: EMBEDDED_PROVIDER_CONFORMANCE_REGISTRY_CONTENT_HASH,
})

export function canonicalProviderConformanceSuiteJson(value) {
  return canonicalJson(value)
}
