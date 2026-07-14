export const OWNER_OPERATION_COUNTER_NAMES = [
  "OWNER_OPERATION_TOUCH_COUNT",
  "OWNER_CREDENTIAL_TOUCH_COUNT",
  "OWNER_DIAGNOSTIC_TOUCH_COUNT",
  "OWNER_ROUTINE_DECISION_COUNT",
] as const

export type OwnerOperationCounterName = (typeof OWNER_OPERATION_COUNTER_NAMES)[number]

export type OwnerOperationCounters = Readonly<Record<OwnerOperationCounterName, number>>
export type OwnerOperationDisplayCounters = Readonly<Record<OwnerOperationCounterName, number | null>>

export type OwnerOperationLifecycleState =
  | "NO_OWNER_OPERATION_EVIDENCE"
  | "UNVERIFIED_ZERO_OWNER_OPERATIONS"
  | "FAILED_OWNER_BABYSITTING"

export type OwnerOperationEvidenceScope = Readonly<{
  programId: string
  goalId: string
  loopId: string
  workOrderId: string
  decisionId: string | null
  action: string
}>

export type OwnerOperationBindingContext = Readonly<{
  surface: "goal" | "loop" | "work-order" | "stop-packet" | "completion-report" | "evidence" | "authority"
  programId: string | null
  goalId: string | null
  loopId: string | null
  workOrderId: string | null
  decisionId: string | null
  action: string | null
}>

export type ProposedIndependentOwnerOperationEvidence = Readonly<{
  schemaVersion: 1
  artifactType: "OWNER_OPERATION_EVIDENCE"
  canonicalization: "WILLIAMOS-CANONICAL-JSON-V1"
  hashAlgorithm: "SHA-256"
  evidenceId: string
  runId: string
  runManifestHash: string
  scope: OwnerOperationEvidenceScope
  observation: Readonly<{
    sourceLogId: string
    startSequence: number
    startEventHash: string
    endSequence: number
    endEventHash: string
    observedEventCount: number
    classificationPolicyHash: string
    complete: true
  }>
  runState: "COMPLETED"
  startedAt: string
  completedAt: string
  recordedAt: string
  counters: OwnerOperationCounters
  issuer: Readonly<{ role: "ASSURANCE"; recorderId: string }>
  contentHash: string
  signature: Readonly<{ algorithm: "Ed25519"; keyId: string; value: string }>
}>

export type ProposedOwnerOperationEvidenceCheckpoint = Readonly<{
  schemaVersion: 1
  artifactType: "OWNER_OPERATION_EVIDENCE_CHECKPOINT"
  checkpointId: string
  logId: string
  sequence: number
  previousCheckpointHash: string | null
  commitment: Readonly<{ runId: string; evidenceContentHash: string }>
  issuedAt: string
  issuer: Readonly<{ role: "ASSURANCE_LOG"; logId: string }>
  contentHash: string
  signature: Readonly<{ algorithm: "Ed25519"; keyId: string; value: string }>
}>

export type OwnerOperationEvidenceModel = Readonly<{
  posture: "static/read-only"
  binding: OwnerOperationBindingContext
  counters: OwnerOperationDisplayCounters
  lifecycleState: OwnerOperationLifecycleState
  reasonCode:
    | "OWNER_OPERATION_EVIDENCE_MISSING"
    | "OWNER_OPERATION_EVIDENCE_UNVERIFIED"
    | "FAIL_OWNER_BABYSITTING"
  certification: Readonly<{
    independentEvidenceRequired: true
    independentlyVerified: false
    evidenceHeadHash: null
    runId: null
  }>
  ownerAuthorityDecisions: Readonly<{
    label: string
    description: string
    examples: readonly string[]
    countsAsRoutineOwnerOperation: false
  }>
  routineOwnerOperations: Readonly<{
    label: string
    description: string
    examples: readonly string[]
    countsAsRoutineOwnerOperation: true
  }>
}>

const NO_COUNTERS: OwnerOperationDisplayCounters = Object.freeze({
  OWNER_OPERATION_TOUCH_COUNT: null,
  OWNER_CREDENTIAL_TOUCH_COUNT: null,
  OWNER_DIAGNOSTIC_TOUCH_COUNT: null,
  OWNER_ROUTINE_DECISION_COUNT: null,
})

const OWNER_AUTHORITY_DECISIONS = Object.freeze({
  label: "Genuine owner authority decisions",
  description: "New authority is reserved for consequential decisions that cannot be resolved inside the active grant.",
  examples: Object.freeze([
    "Material product scope or policy",
    "New spending, provider, release, destructive action, or risk acceptance",
  ]),
  countsAsRoutineOwnerOperation: false as const,
})

const ROUTINE_OWNER_OPERATIONS = Object.freeze({
  label: "Routine owner operations",
  description: "Execution, credentials, diagnostics, status carriage, and in-envelope implementation choices belong to non-owner operators.",
  examples: Object.freeze([
    "Run commands, tests, diagnostics, Git, CI, or application operations",
    "Carry credentials or choose routine implementation details",
  ]),
  countsAsRoutineOwnerOperation: true as const,
})

const OWNER_OPERATION_SURFACES = new Set<OwnerOperationBindingContext["surface"]>([
  "goal",
  "loop",
  "work-order",
  "stop-packet",
  "completion-report",
  "evidence",
  "authority",
])

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function normalizeCounters(counters: OwnerOperationCounters): OwnerOperationCounters {
  if (!record(counters)) {
    throw new TypeError("Owner-operation counters must be an object")
  }
  const keys = Object.keys(counters).sort()
  const expectedKeys = [...OWNER_OPERATION_COUNTER_NAMES].sort()
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new TypeError("Owner-operation counters must contain exactly the canonical four keys")
  }
  const normalized = {} as Record<OwnerOperationCounterName, number>

  for (const name of OWNER_OPERATION_COUNTER_NAMES) {
    const value = counters[name]
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative safe integer`)
    }
    normalized[name] = value
  }

  return Object.freeze(normalized)
}

function normalizeBinding(binding: OwnerOperationBindingContext): OwnerOperationBindingContext {
  if (!record(binding) || !OWNER_OPERATION_SURFACES.has(binding.surface as OwnerOperationBindingContext["surface"])) {
    throw new TypeError("Owner-operation binding must name a supported surface")
  }

  for (const field of ["programId", "goalId", "loopId", "workOrderId", "decisionId", "action"] as const) {
    const value = binding[field]
    if (value !== null && (typeof value !== "string" || value.trim() === "")) {
      throw new TypeError(`${field} must be a non-empty string or null`)
    }
  }

  return Object.freeze({ ...binding }) as OwnerOperationBindingContext
}

export function evaluateOwnerOperationEvidence(
  counters: OwnerOperationCounters,
  binding: OwnerOperationBindingContext,
): OwnerOperationEvidenceModel {
  const normalizedCounters = normalizeCounters(counters)
  const normalizedBinding = normalizeBinding(binding)
  const hasOwnerOperation = OWNER_OPERATION_COUNTER_NAMES.some((name) => normalizedCounters[name] > 0)

  return Object.freeze({
    posture: "static/read-only",
    binding: normalizedBinding,
    counters: normalizedCounters,
    lifecycleState: hasOwnerOperation ? "FAILED_OWNER_BABYSITTING" : "UNVERIFIED_ZERO_OWNER_OPERATIONS",
    reasonCode: hasOwnerOperation ? "FAIL_OWNER_BABYSITTING" : "OWNER_OPERATION_EVIDENCE_UNVERIFIED",
    certification: Object.freeze({
      independentEvidenceRequired: true,
      independentlyVerified: false,
      evidenceHeadHash: null,
      runId: null,
    }),
    ownerAuthorityDecisions: OWNER_AUTHORITY_DECISIONS,
    routineOwnerOperations: ROUTINE_OWNER_OPERATIONS,
  })
}

export function createOwnerOperationEvidencePlaceholder(
  binding: OwnerOperationBindingContext,
): OwnerOperationEvidenceModel {
  const normalizedBinding = normalizeBinding(binding)
  return Object.freeze({
    posture: "static/read-only",
    binding: normalizedBinding,
    counters: NO_COUNTERS,
    lifecycleState: "NO_OWNER_OPERATION_EVIDENCE",
    reasonCode: "OWNER_OPERATION_EVIDENCE_MISSING",
    certification: Object.freeze({
      independentEvidenceRequired: true,
      independentlyVerified: false,
      evidenceHeadHash: null,
      runId: null,
    }),
    ownerAuthorityDecisions: OWNER_AUTHORITY_DECISIONS,
    routineOwnerOperations: ROUTINE_OWNER_OPERATIONS,
  })
}

export function formatOwnerOperationCounter(value: number | null) {
  return value === null ? "not recorded" : String(value)
}
