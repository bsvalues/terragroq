import { hashRecord } from "./hash"

export type WorkContextReconciliation = Readonly<{
  workOrderRef: string
  existingSubsystem: "none-found" | "integrating" | "superseding"
  topologySource: "canonical-registry" | "live-probe"
  collisions: readonly string[]
  remainingParentAcceptance: string
}>

export type WorkContextWorkOrderRow = Readonly<{
  id: number
  userId: string
  ref: string | null
  status: string
  goal: string | null
  authorityLevel: string
  authorityGrantId: number | null
  agent: string | null
  allowedFiles: readonly string[]
  forbiddenFiles: readonly string[]
  updatedAt: string | Date
}>

export type WorkContextAuthorityGrantRow = Readonly<{
  id: number
  userId: string
  ref: string | null
  workOrderId: number | null
  grantedBy: string
  grantedTo: string
  authorityLevel: string
  scope: string | null
  allowedActions: readonly string[]
  blockedActions: readonly string[]
  reason: string | null
  status: string
  expiresAt: string | Date | null
  revokedAt: string | Date | null
  revokedBy: string | null
  revokeReason: string | null
  contentHash: string | null
  createdAt: string | Date
}>

export type DerivedWorkContextAuthority = Readonly<{
  parentOutcome: string
  authorityLevel: string
  reservedPaths: readonly string[]
  forbiddenPaths: readonly string[]
  workOrderVersion: string
  grantVersion: string
  reservationVersion: string
}>

export type WorkContextAuthorityVerdict = Readonly<{
  ok: boolean
  detail?: string
  authority?: DerivedWorkContextAuthority
}>

const CLIENT_DERIVED_KEYS = [
  "authorityLevel", "reservedPaths", "forbiddenPaths", "parentOutcome", "mainSha", "doctrineDigest",
  "workOrderVersion", "grantVersion", "reservationVersion",
] as const

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0

export function normalizeReservation(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim().replace(/\\/g, "/")).filter(Boolean))].sort()
}

function sameReservation(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(normalizeReservation(left)) === JSON.stringify(normalizeReservation(right))
}

function instant(value: string | Date | null): number | null {
  if (value === null) return null
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value)
  return Number.isFinite(milliseconds) ? milliseconds : Number.NaN
}

export function validateWorkContextRequest(value: unknown): { ok: true; request: WorkContextReconciliation } | { ok: false; detail: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, detail: "request body must be an object" }
  const row = value as Record<string, unknown>
  const forbidden = CLIENT_DERIVED_KEYS.find((key) => Object.prototype.hasOwnProperty.call(row, key))
  if (forbidden) return { ok: false, detail: `${forbidden} is server-derived and must not be supplied by the client` }
  const allowedKeys = new Set(["workOrderRef", "existingSubsystem", "topologySource", "collisions", "remainingParentAcceptance"])
  const unknown = Object.keys(row).find((key) => !allowedKeys.has(key))
  if (unknown) return { ok: false, detail: `unknown client field ${unknown}` }
  if (!nonEmpty(row.workOrderRef) || !nonEmpty(row.remainingParentAcceptance)) return { ok: false, detail: "workOrderRef and remainingParentAcceptance are required" }
  if (!(["none-found", "integrating", "superseding"] as unknown[]).includes(row.existingSubsystem)) return { ok: false, detail: "existingSubsystem is invalid" }
  if (!(["canonical-registry", "live-probe"] as unknown[]).includes(row.topologySource)) return { ok: false, detail: "topologySource is invalid" }
  if (!Array.isArray(row.collisions) || !row.collisions.every((entry) => typeof entry === "string")) return { ok: false, detail: "collisions must be a string array" }
  return { ok: true, request: row as unknown as WorkContextReconciliation }
}

export function deriveWorkContextAuthority(input: Readonly<{
  ownerUserId: string
  workOrder: WorkContextWorkOrderRow
  grant: WorkContextAuthorityGrantRow
  now?: Date
}>): WorkContextAuthorityVerdict {
  const { ownerUserId, workOrder, grant } = input
  const now = input.now ?? new Date()
  const reject = (detail: string): WorkContextAuthorityVerdict => ({ ok: false, detail })
  if (workOrder.userId !== ownerUserId || !nonEmpty(workOrder.ref) || workOrder.status !== "active") return reject("the exact owner-owned active work order was not found")
  if (!nonEmpty(workOrder.goal) || !nonEmpty(workOrder.authorityLevel) || workOrder.authorityGrantId !== grant.id) return reject("the work order is not bound to one exact authority grant")
  if (workOrder.agent?.trim().toLowerCase() !== "codex") return reject("the work order is not assigned to codex")
  if (grant.userId !== ownerUserId || grant.grantedBy !== ownerUserId || grant.workOrderId !== workOrder.id || grant.grantedTo.trim().toLowerCase() !== "codex") return reject("the bound grant is not exact owner-to-codex authority for this work order")
  if (grant.authorityLevel !== workOrder.authorityLevel || grant.status !== "active") return reject("the bound grant is inactive or has a different authority level")
  if (grant.revokedAt !== null || grant.revokedBy !== null || grant.revokeReason !== null) return reject("the bound grant was revoked")
  const expiry = instant(grant.expiresAt)
  if (Number.isNaN(expiry) || (expiry !== null && expiry <= now.getTime())) return reject("the bound grant is expired or unreadable")
  if (!nonEmpty(grant.contentHash)) return reject("the bound grant has no immutable content hash")
  const reservedPaths = normalizeReservation(workOrder.allowedFiles)
  const forbiddenPaths = normalizeReservation(workOrder.forbiddenFiles)
  if (reservedPaths.length === 0) return reject("the work order has no writable-path reservation")
  if (!sameReservation(grant.allowedActions, reservedPaths) || !sameReservation(grant.blockedActions, forbiddenPaths)) return reject("the grant reservation does not exactly match the work order")
  const workOrderVersion = hashRecord({
    ...workOrder,
    updatedAt: workOrder.updatedAt instanceof Date ? workOrder.updatedAt.toISOString() : workOrder.updatedAt,
    allowedFiles: reservedPaths,
    forbiddenFiles: forbiddenPaths,
  })
  const reservationVersion = hashRecord({ allowed: reservedPaths, forbidden: forbiddenPaths })
  return {
    ok: true,
    authority: {
      parentOutcome: workOrder.goal.trim(),
      authorityLevel: workOrder.authorityLevel.trim(),
      reservedPaths,
      forbiddenPaths,
      workOrderVersion,
      grantVersion: grant.contentHash.trim(),
      reservationVersion,
    },
  }
}
