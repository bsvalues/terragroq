import { describe, expect, it } from "vitest"

import { OUTCOME_QUEUE_SQL } from "@/scripts/hermes-bridge/outcome-queue-source.mjs"

/**
 * Owner decision 2026-08-22: "release the slot on provider deferral."
 *
 * `deferLease` parks an outcome by keeping `lifecycleState='active'` and setting
 * `leaseExpiresAt = retryAfter`. The acquisition predicate has two serialization guards, and a parked
 * outcome tripped BOTH — the `occupied_slot` check (any active row blocks an approved candidate) and
 * the `live` check (any active row with a lease in the future counts as running). So a single outcome
 * waiting five days on an exhausted provider parked the ENTIRE queue: GOAL-0018 was fully eligible —
 * grants, binding, derived contract, authority all live — and still could not be acquired.
 *
 * A provider wait is not work in flight. These lock the exemption on both guards, and — just as
 * importantly — lock that anything ACTUALLY running still blocks, so at most one outcome is ever
 * really in flight.
 */
const ELIGIBILITY_QUERIES = ["acquire", "recoverStaleLease"] as const

function eligibilityBearingQueries() {
  return ELIGIBILITY_QUERIES
    .map((name) => [name, OUTCOME_QUEUE_SQL[name] as string | undefined] as const)
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === "string")
}

describe("a provider-deferred outcome does not occupy the acquisition slot", () => {
  it("exempts a provider-deferred row from the occupied-slot guard", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    // The exemption is scoped to BOTH conditions together: the parked reason AND a future retry time.
    // Reason alone would also exempt an outcome whose wait has already elapsed, which must instead
    // resume as an ordinary stale-lease candidate.
    expect(sql).toMatch(
      /occupied_slot\."lifecycleReason" = 'PROVIDER_UNAVAILABLE'\s*\n\s*AND occupied_slot\."leaseExpiresAt" > \$1::timestamptz/,
    )
    expect(sql).toMatch(/AND NOT \(\s*\n\s*occupied_slot\."lifecycleReason" = 'PROVIDER_UNAVAILABLE'/)
  })

  it("exempts a provider-deferred lease from the live-lease guard", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    expect(sql).toMatch(/live\."lifecycleReason" IS DISTINCT FROM 'PROVIDER_UNAVAILABLE'/)
    // IS DISTINCT FROM, not <>: a NULL lifecycleReason is an ordinary running outcome and must still
    // block (`<>` would evaluate NULL and silently stop blocking).
    expect(sql).not.toMatch(/live\."lifecycleReason" <> 'PROVIDER_UNAVAILABLE'/)
  })

  it.each(eligibilityBearingQueries())("%s still blocks on genuinely running work", (_name, sql) => {
    // The guards themselves must survive: an active row with a live lease that is NOT parked still
    // makes the queue exclusive. Deleting either guard would make this pass vacuously, so assert the
    // guard bodies are present alongside the exemption.
    expect(sql).toContain(`live."lifecycleState" = 'active'`)
    expect(sql).toContain(`live."leaseExpiresAt" > $1::timestamptz`)
  })

  it("keeps a parked outcome resumable once its retry time passes", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    // The candidate branch for an active row with an elapsed lease is untouched — that is how the
    // parked outcome comes back — so releasing the slot never abandons the deferred work.
    expect(sql).toMatch(/q\."lifecycleState" = 'active'\s*\n\s*AND q\."leaseExpiresAt" <= \$1::timestamptz/)
  })

  it("does not weaken approval, authority, or execution-origin gating", () => {
    const sql = OUTCOME_QUEUE_SQL.acquire as string
    // The slot rule is about serialization only. Everything that decides whether an outcome may run
    // at all must remain in the same predicate.
    expect(sql).toContain(`q."approvalState" = 'approved'`)
    expect(sql).toContain(`q."authorityState" = 'matched'`)
    expect(sql).toContain(`q."riskClass" IN ('R0', 'R1')`)
  })
})
