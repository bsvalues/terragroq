export const EXECUTION_CONTROL_SCHEMA_VERSION = 1 as const

export type Digest = `sha256:${string}`
export type TerminalClassification = "NOT_EXECUTED" | "EXECUTED" | "AMBIGUOUS" | "EXPIRED" | "FENCED"

export interface ImmutableJobIntent {
  jobId: string
  workOrderId: string
  effectDomain: string
  operationClass: string
  idempotencyKey: string
  inputDigest: Digest
  authorityDigest: Digest
  policyDigest: Digest
  baseDigest: Digest
  requestedOutputDigest: Digest
  admissionExpiresAt: string
  createdAt: string
}

export interface JobProjection {
  jobId: string
  state: "ADMITTED" | "CLAIMED" | "RUNNING" | "RECONCILING" | "TERMINAL"
  currentAttemptId: string | null
  terminalClassification: TerminalClassification | null
  terminalReceiptEvidenceId: string | null
  version: number
}

export interface AttemptIdentity {
  attemptId: string
  jobId: string
  effectDomain: string
  ordinal: number
  workerId: string
  workerInstanceId: string
  bootId: string
  claimId: string
  inputDigest: Digest
  createdAt: string
}

export interface LeaseFence {
  leaseId: string
  attemptId: string
  effectDomain: string
  holderWorkerId: string
  holderInstanceId: string
  bootId: string
  fencingToken: bigint
  renewalSequence: bigint
  expiresAt: string
}

export interface EvidenceReference {
  evidenceId: string
  evidenceType: "TERMINAL_RECEIPT" | "ATTEMPT_OUTPUT" | "EVENT_ATTACHMENT" | "RECOVERY_OBSERVATION"
  contentDigest: Digest
  durableUri: string
  mediaType: string
  sizeBytes: bigint
}
