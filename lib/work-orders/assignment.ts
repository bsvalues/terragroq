/**
 * Work-order assignment: who may actually act on owner-owned work.
 *
 * Two defects are repaired here, and they are different defects.
 *
 * P1 — WORK_ORDER_DELEGATED_SUBJECT_UNRESOLVED. `getWorkOrders()` filtered on
 * `workOrder.userId` and every mutation went through `requireOwn(id, userId)`. `workOrder.agent`
 * was read at create, at approval, and as a grant label, but never in a WHERE clause. The server
 * could therefore hold a perfectly valid approved work order for an agent and truthfully return
 * none of it. Ownership was being used as if it were execution rights; they are not the same
 * question. `resolveAccess` below asks them separately.
 *
 * P2 — authority is not dispatch. An authorised, correctly-routed outcome still does nothing until
 * some qualified executor accepts it and produces work. An executor may decline; that is routine,
 * it carries a typed reason, and it ends the ASSIGNMENT, never the work order. Accepted work
 * carries a lease so that accepting and then going silent cannot park an outcome indefinitely.
 *
 * Everything in this module is pure so the boundary can be tested without a database.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

export const ASSIGNMENT_STATUSES = [
  "offered",
  "accepted",
  "active",
  "declined",
  "released",
  "revoked",
] as const
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number]

/** Statuses in which the assignment still connects a principal to the work. */
export const LIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  "offered",
  "accepted",
  "active",
]

/** Statuses that are over. A work order holding only these is unassigned and re-offerable. */
export const CLOSED_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  "declined",
  "released",
  "revoked",
]

export const ASSIGNMENT_ROLES = [
  "implementer",
  "reviewer",
  "collaborator",
  "subagent",
] as const
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number]

/**
 * Why an executor said no. A decline is information for the router, not a failure: it tells HERMES
 * whether to re-offer elsewhere, raise a routed dependency, or stop offering this contract at all.
 */
export const DECLINE_REASONS = [
  "authority_insufficient",
  "capability_unavailable",
  "resource_unreachable",
  "conflict_of_interest",
  "capacity",
  "premise_invalid",
  "policy_refusal",
] as const
export type DeclineReason = (typeof DECLINE_REASONS)[number]

/**
 * Declines that indicate a real gap in the estate rather than a scheduling fact. These should also
 * raise a routed dependency, or the router happily routes around the same missing capability
 * forever and nobody ever fixes it.
 */
export const DEPENDENCY_RAISING_DECLINES: readonly DeclineReason[] = [
  "capability_unavailable",
  "resource_unreachable",
]

/** Declines that say something is wrong with the CONTRACT, so re-offering it unchanged is futile. */
export const CONTRACT_FAULT_DECLINES: readonly DeclineReason[] = [
  "authority_insufficient",
  "premise_invalid",
]

export function isDeclineReason(v: unknown): v is DeclineReason {
  return typeof v === "string" && (DECLINE_REASONS as readonly string[]).includes(v)
}

/* ------------------------------------------------------------------ */
/* Assignment lifecycle                                                */
/* ------------------------------------------------------------------ */

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, readonly AssignmentStatus[]> = {
  offered: ["accepted", "declined", "revoked"],
  accepted: ["active", "released", "revoked"],
  active: ["released", "revoked"],
  declined: [],
  released: [],
  revoked: [],
}

export function canTransitionAssignment(
  from: AssignmentStatus,
  to: AssignmentStatus,
): boolean {
  return ASSIGNMENT_TRANSITIONS[from]?.includes(to) ?? false
}

export function isLiveAssignment(status: AssignmentStatus): boolean {
  return LIVE_ASSIGNMENT_STATUSES.includes(status)
}

/* ------------------------------------------------------------------ */
/* Access resolution — the actual repair                               */
/* ------------------------------------------------------------------ */

/** The minimum an assignment must expose for access to be resolved. */
export interface AssignmentLike {
  workOrderId: number
  principal: string
  role: AssignmentRole
  status: AssignmentStatus
}

export type AccessBasis = "owner" | "assignment" | "none"

export interface WorkOrderAccess {
  /** May this principal see the work order at all? */
  visible: boolean
  /** May this principal do the work — evidence, results, active→review? */
  canExecute: boolean
  /**
   * May this principal make governance decisions — approve, open release gates, delete?
   * Assignment never confers this. Delegating execution is not delegating authority.
   */
  canGovern: boolean
  basis: AccessBasis
  /** The live assignment access was resolved through, when the basis is an assignment. */
  via?: AssignmentLike
}

const EXECUTING_ROLES: readonly AssignmentRole[] = ["implementer", "subagent"]

/**
 * Resolve what `principal` may do with a work order owned by `ownerId`.
 *
 * The owner keeps everything — this is strictly additive to today's behaviour, so no existing
 * caller loses access. What is new is that an assigned principal is no longer invisible to the
 * server that is holding their work.
 */
export function resolveAccess(
  ownerId: string,
  principal: string,
  assignments: readonly AssignmentLike[] = [],
): WorkOrderAccess {
  if (principal && principal === ownerId) {
    return { visible: true, canExecute: true, canGovern: true, basis: "owner" }
  }

  const live = assignments.filter(
    (a) => a.principal === principal && isLiveAssignment(a.status),
  )
  if (live.length === 0) {
    return { visible: false, canExecute: false, canGovern: false, basis: "none" }
  }

  // An offer is visible — you cannot accept work you cannot see — but it is not yet execution.
  const executing = live.find(
    (a) => EXECUTING_ROLES.includes(a.role) && (a.status === "accepted" || a.status === "active"),
  )

  return {
    visible: true,
    canExecute: Boolean(executing),
    canGovern: false,
    basis: "assignment",
    via: executing ?? live[0],
  }
}

/** Work-order ids this principal can see, given every assignment row that names them. */
export function visibleWorkOrderIds(
  principal: string,
  assignments: readonly AssignmentLike[],
): number[] {
  const ids = new Set<number>()
  for (const a of assignments) {
    if (a.principal === principal && isLiveAssignment(a.status)) ids.add(a.workOrderId)
  }
  return [...ids]
}

/* ------------------------------------------------------------------ */
/* Lease                                                               */
/* ------------------------------------------------------------------ */

export interface LeasedAssignmentLike {
  status: AssignmentStatus
  leaseExpiresAt: Date | null
}

/** Default lease for accepted work. Short enough that a silent executor is noticed the same day. */
export const DEFAULT_LEASE_MS = 60 * 60 * 1000

export function nextLeaseExpiry(now: Date, ms: number = DEFAULT_LEASE_MS): Date {
  return new Date(now.getTime() + ms)
}

/**
 * Whether HERMES should reclaim this assignment and re-offer the outcome.
 *
 * Reclaim is not a sanction. It is the same routing edge as a decline, arrived at later: the
 * outcome goes back on offer instead of sitting parked behind an executor that stopped.
 */
export function isReclaimable(a: LeasedAssignmentLike, now: Date): boolean {
  if (a.status !== "accepted" && a.status !== "active") return false
  if (!a.leaseExpiresAt) return false
  return a.leaseExpiresAt.getTime() <= now.getTime()
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

export interface RerouteDecision {
  /** Should the outcome be offered to another executor? */
  reoffer: boolean
  /** Should a routed dependency be raised for the underlying gap? */
  raiseDependency: boolean
  /** Should the contract itself be revisited before any further offer? */
  contractFault: boolean
}

/**
 * What the router does with a decline. Deliberately mechanical: a decline must never become a
 * conversation, and it must never touch the work order's own lifecycle.
 */
export function decideReroute(reason: DeclineReason): RerouteDecision {
  const contractFault = CONTRACT_FAULT_DECLINES.includes(reason)
  return {
    reoffer: !contractFault,
    raiseDependency: DEPENDENCY_RAISING_DECLINES.includes(reason),
    contractFault,
  }
}
