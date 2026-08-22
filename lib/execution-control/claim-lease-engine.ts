export type ClaimLeaseErrorCode =
  | "CLAIM_NOT_ELIGIBLE"
  | "CLAIM_WORKER_IDENTITY_INVALID"
  | "CLAIM_TTL_INVALID"
  | "LEASE_STALE_OR_FORGED"
  | "LEASE_WRONG_HOLDER"
  | "LEASE_WRONG_BOOT"
  | "LEASE_ALREADY_RELEASED"
  | "LEASE_EXPIRED"
  | "FENCE_NOT_CURRENT"
  | "OPERATION_IDEMPOTENCY_CONFLICT"
  | "AMBIGUOUS_RECONCILIATION_REQUIRED"
  | "AUTHORITY_NOT_CURRENT"
  | "CAPABILITY_NOT_FRESH"
  | "RETRY_NOT_PROVEN_SAFE"
  | "RECONCILIATION_INPUT_INVALID"
  | "RECONCILIATION_EVIDENCE_INVALID"

export class ClaimLeaseError extends Error {
  constructor(readonly code: ClaimLeaseErrorCode, message = code) {
    super(message)
    this.name = "ClaimLeaseError"
  }
}

export interface QueryExecutor {
  query<T>(sql: string, parameters: readonly unknown[]): Promise<{ rows: T[] }>
}

export interface ClaimRequest {
  jobId: string
  workerId: string
  workerInstanceId: string
  bootId: string
  claimId: string
  leaseId: string
  operationId: string
  ttlSeconds: number
}

export interface ClaimReceipt {
  attempt_id: string
  lease_id: string
  fencing_token: string
  expires_at: string
}

export interface LeaseIdentity {
  leaseId: string
  attemptId: string
  workerId: string
  workerInstanceId: string
  bootId: string
  fencingToken: bigint
  renewalSequence: bigint
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const ERROR_CODES = new Set<ClaimLeaseErrorCode>([
  "CLAIM_NOT_ELIGIBLE", "CLAIM_WORKER_IDENTITY_INVALID", "CLAIM_TTL_INVALID",
  "LEASE_STALE_OR_FORGED", "LEASE_WRONG_HOLDER", "LEASE_WRONG_BOOT", "LEASE_ALREADY_RELEASED",
  "LEASE_EXPIRED", "FENCE_NOT_CURRENT", "OPERATION_IDEMPOTENCY_CONFLICT", "AMBIGUOUS_RECONCILIATION_REQUIRED",
  "AUTHORITY_NOT_CURRENT", "CAPABILITY_NOT_FRESH", "RETRY_NOT_PROVEN_SAFE",
  "RECONCILIATION_INPUT_INVALID", "RECONCILIATION_EVIDENCE_INVALID",
])

function uuid(value: string, field: string) {
  if (!UUID.test(value)) throw new ClaimLeaseError("CLAIM_WORKER_IDENTITY_INVALID", `invalid ${field}`)
}

function translate(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error)
  const code = [...ERROR_CODES].find((candidate) => message.includes(candidate))
  throw code ? new ClaimLeaseError(code, message) : error
}

export async function claimJob(executor: QueryExecutor, request: ClaimRequest): Promise<ClaimReceipt> {
  for (const field of ["jobId", "workerId", "workerInstanceId", "bootId", "claimId", "leaseId", "operationId"] as const) uuid(request[field], field)
  if (!Number.isSafeInteger(request.ttlSeconds) || request.ttlSeconds < 5 || request.ttlSeconds > 3600) throw new ClaimLeaseError("CLAIM_TTL_INVALID")
  try {
    const result = await executor.query<ClaimReceipt>(
      "SELECT * FROM ai_evalops.claim_job($1,$2,$3,$4,$5,$6,$7,make_interval(secs => $8))",
      [request.jobId, request.workerId, request.workerInstanceId, request.bootId, request.claimId, request.leaseId, request.operationId, request.ttlSeconds],
    )
    if (result.rows.length !== 1) throw new ClaimLeaseError("CLAIM_NOT_ELIGIBLE", "claim returned no receipt")
    return Object.freeze(result.rows[0])
  } catch (error) { return translate(error) }
}

export async function renewLease(executor: QueryExecutor, identity: LeaseIdentity, operationId: string, ttlSeconds: number) {
  uuid(operationId, "operationId")
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 5 || ttlSeconds > 3600) throw new ClaimLeaseError("CLAIM_TTL_INVALID")
  try {
    return (await executor.query<{ renewal_sequence: string; expires_at: string }>(
      "SELECT * FROM ai_evalops.renew_lease($1,$2,$3,$4,$5,$6,$7,$8,make_interval(secs => $9))",
      [identity.leaseId, identity.attemptId, identity.workerId, identity.workerInstanceId, identity.bootId, identity.fencingToken.toString(), identity.renewalSequence.toString(), operationId, ttlSeconds],
    )).rows[0]
  } catch (error) { return translate(error) }
}

export async function releaseLease(executor: QueryExecutor, identity: LeaseIdentity, operationId: string, reason: string) {
  uuid(operationId, "operationId")
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(reason)) throw new ClaimLeaseError("LEASE_STALE_OR_FORGED", "invalid release reason")
  try {
    await executor.query("SELECT * FROM ai_evalops.release_lease($1,$2,$3,$4,$5,$6,$7,$8,$9)",
      [identity.leaseId, identity.attemptId, identity.workerId, identity.workerInstanceId, identity.bootId, identity.fencingToken.toString(), identity.renewalSequence.toString(), operationId, reason])
  } catch (error) { return translate(error) }
}

export async function pullEligibleJob(executor: QueryExecutor, request: Omit<ClaimRequest, "jobId">, maxAttempts = 3): Promise<ClaimReceipt> {
  for (const field of ["workerId", "workerInstanceId", "bootId", "claimId", "leaseId", "operationId"] as const) uuid(request[field], field)
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) throw new ClaimLeaseError("AMBIGUOUS_RECONCILIATION_REQUIRED")
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await executor.query<ClaimReceipt>("SELECT * FROM ai_evalops.pull_next_job($1,$2,$3,$4,$5,$6,make_interval(secs => $7))",
        [request.workerId, request.workerInstanceId, request.bootId, request.claimId, request.leaseId, request.operationId, request.ttlSeconds])
      if (result.rows.length === 1) return Object.freeze(result.rows[0])
    } catch (error) {
      lastError = error
      const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""
      if (code !== "40001" && code !== "40P01" && !code.startsWith("08")) return translate(error)
      if (code.startsWith("08")) lastError = new ClaimLeaseError("AMBIGUOUS_RECONCILIATION_REQUIRED", "connection outcome requires receipt replay")
    }
  }
  throw new ClaimLeaseError("AMBIGUOUS_RECONCILIATION_REQUIRED", `receipt replay required after bounded retries: ${String(lastError)}`)
}

export async function expireLease(executor: QueryExecutor, leaseId: string, operationId: string) {
  uuid(leaseId, "leaseId"); uuid(operationId, "operationId")
  try { return (await executor.query<{ job_id: string; expired_attempt_id: string }>("SELECT * FROM ai_evalops.expire_lease($1,$2)", [leaseId, operationId])).rows[0] }
  catch (error) { return translate(error) }
}

export interface ExpiryReconciliationRequest {
  jobId: string; attemptId: string; operationId: string; actorId: string
  authorityDigest: `sha256:${string}`; observationEvidenceId: string; observationEvidenceDigest: `sha256:${string}`
  adapterResult: "NOT_EXECUTED" | "EXECUTED" | "AMBIGUOUS"; expectedProjectionVersion: bigint
}

export async function reconcileExpiry(executor: QueryExecutor, request: ExpiryReconciliationRequest) {
  for (const field of ["jobId", "attemptId", "operationId", "observationEvidenceId"] as const) uuid(request[field], field)
  if (!/^[A-Za-z0-9:_-]{3,128}$/.test(request.actorId)) throw new ClaimLeaseError("RECONCILIATION_INPUT_INVALID")
  try { return (await executor.query<{ reconcile_expiry: string }>("SELECT ai_evalops.reconcile_expiry($1,$2,$3,$4,$5,$6,$7,$8,$9)", [request.jobId, request.attemptId, request.operationId, request.actorId, request.authorityDigest, request.observationEvidenceId, request.observationEvidenceDigest, request.adapterResult, request.expectedProjectionVersion.toString()])).rows[0] }
  catch (error) { return translate(error) }
}

export async function validateCurrentFence(executor: QueryExecutor, identity: LeaseIdentity, authorityDigest: `sha256:${string}`, capabilityDigest: `sha256:${string}`) {
  try { return (await executor.query<{ validate_current_fence: boolean }>("SELECT ai_evalops.validate_current_fence($1,$2,$3,$4,$5,$6,$7,$8)", [identity.leaseId, identity.attemptId, identity.workerId, identity.workerInstanceId, identity.bootId, identity.fencingToken.toString(), authorityDigest, capabilityDigest])).rows[0] }
  catch (error) { return translate(error) }
}
