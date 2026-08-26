/**
 * Routed dependencies, and what `blocked` actually means.
 *
 * An executor that cannot perform one operation is not unemployed. The dependency is recorded, the
 * router takes it elsewhere, and the original contract keeps working every independent path. The
 * failure this replaces is small and expensive: "Claude cannot modify this config file" becoming
 * "frontend development stops."
 *
 * So a dependency sits BESIDE an active work order and does not consume its lifecycle. `blocked`
 * is not deleted — it is narrowed to a genuinely rare state:
 *
 *   The outcome has no remaining executable path, because every path required for acceptance is
 *   blocked.
 *
 * That is a computed condition, not a free transition, which is the whole point: a single forbidden
 * mutation must never be able to reach it.
 */

import type { SurfaceClass } from "@/lib/work-orders/authority-surface"

/* ------------------------------------------------------------------ */
/* Routing states                                                      */
/* ------------------------------------------------------------------ */

export const ROUTING_STATES = ["raised", "routed", "accepted", "resolved", "refused"] as const
export type RoutingState = (typeof ROUTING_STATES)[number]

export const ROUTING_TRANSITIONS: Record<RoutingState, readonly RoutingState[]> = {
  raised: ["routed", "refused"],
  routed: ["accepted", "refused", "raised"],
  accepted: ["resolved", "refused"],
  resolved: [],
  refused: [],
}

/** States in which the dependency is still outstanding. */
export const OPEN_ROUTING_STATES: readonly RoutingState[] = ["raised", "routed", "accepted"]

/**
 * A refused dependency is CLOSED but not satisfied. It still stops an acceptance path that needs
 * it — refusing to do something does not make the outcome reachable.
 */
export const SATISFIED_ROUTING_STATES: readonly RoutingState[] = ["resolved"]

export function canTransitionRouting(from: RoutingState, to: RoutingState): boolean {
  return ROUTING_TRANSITIONS[from]?.includes(to) ?? false
}

export function isOpenDependency(state: RoutingState): boolean {
  return OPEN_ROUTING_STATES.includes(state)
}

/** Whether this dependency still stands in the way — open, or closed without being satisfied. */
export function isUnsatisfied(state: RoutingState): boolean {
  return !SATISFIED_ROUTING_STATES.includes(state)
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

export interface RoutedDependencyLike {
  id?: number
  /** The concrete operation that could not be performed. */
  operation: string
  requiredResource?: string | null
  requiredClass?: SurfaceClass | null
  requiredCapability?: string | null
  /** Non-authority blockers: an unreachable node, an absent credential, a service that is down. */
  requiredCapabilityNonAuth?: string | null
  routingState: RoutingState
  /** Does final acceptance actually depend on this, or is it merely inconvenient? */
  blocksAcceptance: boolean
}

/* ------------------------------------------------------------------ */
/* The `blocked` guard                                                 */
/* ------------------------------------------------------------------ */

export interface BlockedEvaluation {
  /** May the work order move active → blocked? */
  blocked: boolean
  /** Why not, when it may not. */
  reason: string
  /** Unsatisfied dependencies that acceptance genuinely depends on. */
  blockingDependencies: RoutedDependencyLike[]
  /** Dependencies that are open but do not stand between the contract and acceptance. */
  nonBlockingOpen: RoutedDependencyLike[]
}

export interface BlockedInput {
  dependencies: readonly RoutedDependencyLike[]
  /**
   * Whether ANY acceptance path is still executable under the current envelope. Supplied by the
   * caller because only the contract knows its own acceptance paths.
   *
   * Defaults to `true` — the safe default is "keep working", not "stop".
   */
  anyAcceptancePathExecutable?: boolean
}

/**
 * Decide whether a work order may become `blocked`.
 *
 * Deliberately hard to satisfy. Every condition must hold at once: there is at least one
 * unsatisfied dependency that acceptance actually depends on, and no acceptance path remains
 * executable. Anything less means the contract keeps going.
 */
export function evaluateBlocked(input: BlockedInput): BlockedEvaluation {
  const unsatisfied = input.dependencies.filter((d) => isUnsatisfied(d.routingState))
  const blockingDependencies = unsatisfied.filter((d) => d.blocksAcceptance)
  const nonBlockingOpen = unsatisfied.filter((d) => !d.blocksAcceptance)
  const anyPath = input.anyAcceptancePathExecutable ?? true

  if (blockingDependencies.length === 0) {
    return {
      blocked: false,
      reason:
        unsatisfied.length > 0
          ? "Open dependencies exist, but none of them gate acceptance — continue the independent paths"
          : "No unsatisfied dependencies",
      blockingDependencies,
      nonBlockingOpen,
    }
  }

  if (anyPath) {
    return {
      blocked: false,
      reason: "An acceptance path is still executable — route the dependency and keep working",
      blockingDependencies,
      nonBlockingOpen,
    }
  }

  return {
    blocked: true,
    reason: `No executable acceptance path remains: ${blockingDependencies
      .map((d) => d.operation)
      .join("; ")}`,
    blockingDependencies,
    nonBlockingOpen,
  }
}

/**
 * Whether raising this dependency should stop the contract from being worked at all.
 *
 * Almost always no. Exists so the answer is a function with one obvious result rather than a
 * judgement call made freshly, and differently, every time.
 */
export function shouldStopWork(evaluation: BlockedEvaluation): boolean {
  return evaluation.blocked
}

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

/**
 * When a blocked contract's dependencies are satisfied it returns to `active` on its own. Being
 * blocked is a description of the current routing state, not a punishment to be lifted by hand.
 */
export function canUnblock(dependencies: readonly RoutedDependencyLike[]): boolean {
  return !dependencies.some((d) => d.blocksAcceptance && isUnsatisfied(d.routingState))
}
