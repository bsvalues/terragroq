// Promotion lease: the single-writer reservation over an AUTHORITATIVE PROMOTION TARGET
// (repository + target ref, e.g. terragroq + refs/heads/main). This is the narrow successor
// to the retired one-active-outcome-per-user mutex: preparation (coding, review, remediation,
// CI, attestation) requires no lease; only the promotion critical section does — acquisition
// happens immediately before the first authoritative seal/adoption mutation (AUTHORIZE), the
// lease is held through exact-head revalidation -> seal -> integration -> FINALIZE, and it is
// released on FINALIZE, adoption-grant revocation, head-movement rejection, or expiry.
// Keying is deliberately per-target, never per-user: two outcomes in the same estate may be
// active simultaneously; two lanes may never promote to the same authoritative ref at once.
//
// Self-healing rule: every sweep releases a live lease whose protecting authority is dead
// (grant revoked, missing, or expired) or whose expiry has passed. A superseded or aborted
// chain therefore can never leave a ghost lease blocking the next promotion; the invariant
// "live lease <=> live delivery grant" is enforced at acquire, validate, and boot.

import { createHash } from "node:crypto"

const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^[0-9a-f]{64}$/

// The integrate tool pushes the authoritative branch by this literal name; the lease key
// must match the promotion target exactly, so both sides share this constant.
export const PROMOTION_TARGET_REF = "refs/heads/main"

export type PromotionLeaseRecord = Readonly<{
  id: number
  repository: string
  targetRef: string
  pullRequest: number
  boundHeadSha: string
  adoptionHash: string
  grantRef: string | null
  outcomeId: number | null
  workOrderId: number | null
  status: "live" | "released"
  reason: string | null
  expiresAt: string | null
}>

export type PromotionLeaseClaim = Readonly<{
  userId: string
  repository: string
  targetRef: string
  pullRequest: number
  boundHeadSha: string
  adoptionHash: string
  grantRef: string | null
  outcomeId: number | null
  workOrderId: number | null
  expiresAt: string | null
}>

export class PromotionLeaseError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = "PromotionLeaseError"
  }
}

export function promotionLeaseKey(repository: string, targetRef: string): string {
  return createHash("sha256").update(`${repository}\u0000${targetRef}`).digest("hex")
}

export type PromotionLeaseQueries = {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>
}

// All statements are parameterized and must run inside the caller's SERIALIZABLE transaction
// (the adoption recordAuthorization txn, the seal recordSeal txn, or the FINALIZE txn) so the
// lease state transition is atomic with the authoritative mutation it protects.
export const PROMOTION_LEASE_SQL = {
  sweepStale: `
UPDATE "promotion_lease" AS l
SET "status" = 'released',
    "reason" = CASE WHEN l."expiresAt" IS NOT NULL AND l."expiresAt" <= now() THEN 'LEASE_EXPIRED' ELSE 'LEASE_STALE_GRANT' END,
    "releasedAt" = now(), "updatedAt" = now(), "version" = l."version" + 1
WHERE l."status" = 'live' AND (
  (l."expiresAt" IS NOT NULL AND l."expiresAt" <= now())
  OR l."grantRef" IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM "authority_grant" g
    WHERE g."userId" = l."userId" AND g."ref" = l."grantRef"
      AND g."status" = 'active' AND g."revokedAt" IS NULL
  )
)
`,
  liveFor: `
SELECT "id", "repository", "targetRef", "pullRequest", "boundHeadSha", "adoptionHash", "grantRef", "outcomeId", "workOrderId", "status", "reason", "expiresAt"
FROM "promotion_lease"
WHERE "status" = 'live' AND "repository" = $1 AND "targetRef" = $2
LIMIT 2
`,
  insertLive: `
INSERT INTO "promotion_lease"
  ("userId", "repository", "targetRef", "pullRequest", "boundHeadSha", "adoptionHash", "grantRef", "outcomeId", "workOrderId", "status", "expiresAt")
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'live', $10::timestamptz)
ON CONFLICT ("repository", "targetRef") WHERE "status" = 'live' DO NOTHING
RETURNING "id", "repository", "targetRef", "pullRequest", "boundHeadSha", "adoptionHash", "grantRef", "outcomeId", "workOrderId", "status", "reason", "expiresAt"
`,
  // Same-outcome + same-work-order re-claim after the head moved: the prior bound row is
  // released as LEASE_REBOUND before the new claim exists, so a lane remediating its own
  // head re-binds instead of deadlocking, while a cross-lineage claim still HELD-refuses.
  releaseStaleForLineage: `
UPDATE "promotion_lease"
SET "status" = 'released', "reason" = 'LEASE_REBOUND', "releasedAt" = now(), "updatedAt" = now(), "version" = "version" + 1
WHERE "status" = 'live' AND "repository" = $1 AND "targetRef" = $2
  AND "adoptionHash" <> $3 AND "outcomeId" = $4 AND "workOrderId" = $5
`,
  releaseByAdoption: `
UPDATE "promotion_lease"
SET "status" = 'released', "reason" = $2, "releasedAt" = now(), "updatedAt" = now(), "version" = "version" + 1
WHERE "status" = 'live' AND "adoptionHash" = $1
RETURNING "id"
`,
  staleLiveCount: `
SELECT count(*)::integer AS "staleLiveLeaseCount"
FROM "promotion_lease" AS l
WHERE l."status" = 'live' AND (
  (l."expiresAt" IS NOT NULL AND l."expiresAt" <= now())
  OR l."grantRef" IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM "authority_grant" g
    WHERE g."userId" = l."userId" AND g."ref" = l."grantRef"
      AND g."status" = 'active' AND g."revokedAt" IS NULL
  )
)
`,
} as const

function numOrNull(value: unknown): number | null {
  return value == null ? null : Number(value)
}

function rowToLease(row: Record<string, unknown>): PromotionLeaseRecord {
  const raw = row.expiresAt == null || row.expiresAt === "null" ? null : row.expiresAt
  return {
    id: Number(row.id),
    repository: String(row.repository ?? ""),
    targetRef: String(row.targetRef ?? ""),
    pullRequest: Number(row.pullRequest),
    boundHeadSha: String(row.boundHeadSha ?? ""),
    adoptionHash: String(row.adoptionHash ?? ""),
    grantRef: row.grantRef == null ? null : String(row.grantRef),
    outcomeId: numOrNull(row.outcomeId),
    workOrderId: numOrNull(row.workOrderId),
    status: String(row.status ?? "") as "live" | "released",
    reason: row.reason == null ? null : String(row.reason),
    expiresAt: raw == null ? null : raw instanceof Date ? raw.toISOString() : String(raw),
  }
}

/**
 * Acquire (or replay) the live promotion lease for one authoritative target, inside the
 * caller's transaction. Refuses with PROMOTION_LEASE_HELD when a DIFFERENT delivery (another
 * outcome/work order) holds the target — the one-writer property this change preserves.
 * Identical adoptionHash + head is an idempotent replay of the same promotion. A same-
 * lineage claim with a different head releases the prior row as LEASE_REBOUND and takes
 * over; cross-lineage claims never do.
 */
export async function acquirePromotionLease(
  db: PromotionLeaseQueries,
  claim: PromotionLeaseClaim,
): Promise<PromotionLeaseRecord> {
  if (!DIGEST.test(claim.adoptionHash) || !SHA.test(claim.boundHeadSha)
    || claim.repository.trim() === "" || claim.targetRef.trim() === ""
    || !Number.isSafeInteger(claim.pullRequest) || claim.pullRequest <= 0
    || claim.userId.trim() === "") {
    throw new PromotionLeaseError("PROMOTION_LEASE_INVALID", "promotion lease identity is malformed")
  }
  await db.query(PROMOTION_LEASE_SQL.sweepStale)
  const existing = (await db.query(PROMOTION_LEASE_SQL.liveFor, [claim.repository, claim.targetRef])).rows
  if (existing.length > 1) {
    throw new PromotionLeaseError("PROMOTION_LEASE_AMBIGUOUS", "promotion lease state is ambiguous")
  }
  if (existing.length === 1) {
    const held = rowToLease(existing[0])
    if (held.adoptionHash === claim.adoptionHash && held.boundHeadSha === claim.boundHeadSha) return held
    const sameLineage = held.outcomeId !== null && held.outcomeId === claim.outcomeId
      && held.workOrderId !== null && held.workOrderId === claim.workOrderId
    if (!sameLineage) {
      throw new PromotionLeaseError(
        "PROMOTION_LEASE_HELD",
        `the authoritative promotion target ${claim.repository} ${claim.targetRef} already has a live delivery promotion (PR #${held.pullRequest})`,
      )
    }
    await db.query(PROMOTION_LEASE_SQL.releaseStaleForLineage, [
      claim.repository, claim.targetRef, claim.adoptionHash, claim.outcomeId, claim.workOrderId,
    ])
  }
  // Expiry rides the delivery grant the lease protects; a non-expiring Space grant is
  // legitimate estate state, so the lease lives exactly as long as its grant and the
  // grant-liveness sweep is the backstop. Only an unparseable value fails closed.
  if (claim.expiresAt != null && Number.isNaN(Date.parse(claim.expiresAt))) {
    throw new PromotionLeaseError("PROMOTION_LEASE_INVALID", "promotion lease expiry is unparseable")
  }
  const inserted = (await db.query(PROMOTION_LEASE_SQL.insertLive, [
    claim.userId, claim.repository, claim.targetRef, claim.pullRequest, claim.boundHeadSha,
    claim.adoptionHash, claim.grantRef, claim.outcomeId, claim.workOrderId, claim.expiresAt,
  ])).rows
  if (inserted.length !== 1) {
    throw new PromotionLeaseError("PROMOTION_LEASE_HELD", "the promotion target was claimed concurrently")
  }
  return rowToLease(inserted[0])
}

/** True when the live lease for this claim's target is bound to this exact adoption + head. */
export async function validatePromotionLease(
  db: PromotionLeaseQueries,
  claim: PromotionLeaseClaim,
): Promise<boolean> {
  await db.query(PROMOTION_LEASE_SQL.sweepStale)
  const rows = (await db.query(PROMOTION_LEASE_SQL.liveFor, [claim.repository, claim.targetRef])).rows
  if (rows.length !== 1) return false
  const lease = rowToLease(rows[0])
  return lease.adoptionHash === claim.adoptionHash && lease.boundHeadSha === claim.boundHeadSha
    && lease.pullRequest === claim.pullRequest
}

/** Release this adoption's live lease (FINALIZE / terminal settlement). Returns rows changed. */
export async function releasePromotionLease(
  db: PromotionLeaseQueries,
  adoptionHash: string,
  reason: string,
): Promise<number> {
  if (!DIGEST.test(adoptionHash)) return 0
  const rows = (await db.query(PROMOTION_LEASE_SQL.releaseByAdoption,
    [adoptionHash, reason.slice(0, 200)])).rows
  return rows.length
}
