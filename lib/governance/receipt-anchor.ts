import { DOCTRINE_FILES } from "./work-context-live.ts"

import type { WorkContextFacts } from "./work-context-receipt.ts"

/**
 * When a receipt may keep its proof although main has moved.
 *
 * Binding staleness to the main SHA alone makes every receipt die the moment anyone merges anything,
 * which does not make the gate stricter -- it makes it unusable, and an unusable gate gets removed or
 * routed around. #831 says it directly: unrelated main churn must not force full re-receipting, and
 * the verifier may advance the observed-main anchor while retaining the proven dependency closure.
 *
 * So the question is not "did main move" but "did anything this receipt actually proved something
 * about move". If the answer is no, the anchor advances and the proof stands. If the answer is yes,
 * the lane must prove context again, because what it proved is no longer what is there.
 *
 * The closure derived here is deliberately the part that can be computed from the receipt itself:
 * the paths the lane reserved, plus the controlling instruction chain. #831 also names caller and
 * provider files, the Work Order body, the topology registry and active collisions. Those are real
 * and not covered here; they need sources this function does not have. Stating that is better than
 * implying a completeness this does not have.
 */

/** The paths whose movement invalidates a receipt. */
export function dependencyClosure(facts: Pick<WorkContextFacts, "reservedPaths">): string[] {
  const reserved = (facts.reservedPaths ?? []).map((entry) => entry.trim()).filter(Boolean)
  return [...new Set([...reserved, ...DOCTRINE_FILES])].sort()
}

/**
 * Does a changed file fall inside the closure?
 *
 * A closure entry ending in "/" is a directory reservation and covers everything beneath it; anything
 * else must match exactly. Treating every entry as a prefix would make a reservation of "lib/goal"
 * silently capture "lib/goals-v2/", which is a different subsystem.
 */
export function pathIntersectsClosure(changedPath: string, closure: string[]): boolean {
  const path = changedPath.trim().replace(/\\/g, "/")
  return closure.some((entry) => {
    const normalized = entry.trim().replace(/\\/g, "/")
    if (!normalized) return false
    return normalized.endsWith("/") ? path.startsWith(normalized) : path === normalized
  })
}

export interface AnchorAdvance {
  /** True when the receipt keeps its proof and the anchor may move to current main. */
  ok: boolean
  /** The closure members that actually changed, so a refusal says what to look at. */
  intersecting: string[]
}

/**
 * Decide whether the anchor may advance, given what changed between it and current main.
 *
 * Pure on purpose: the caller runs `git diff --name-only <anchor>..<main>`, which is the part that
 * needs a repository. The rule is the part that needs testing.
 */
export function mayAdvanceAnchor(closure: string[], changedPaths: string[]): AnchorAdvance {
  const intersecting = changedPaths.filter((changed) => pathIntersectsClosure(changed, closure)).sort()
  return { ok: intersecting.length === 0, intersecting }
}
