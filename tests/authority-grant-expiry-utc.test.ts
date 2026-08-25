/**
 * CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW.
 *
 * `authority_grant.expiresAt` is `timestamp without time zone` holding a UTC WALL CLOCK (the column
 * defaults to `timezone('UTC', now())`). node-pg parses that text by building a Date from its
 * components in the *reading process's* local zone, so the instant it hands back is wrong by exactly
 * the local offset. `lib/db/schema.ts` has always undone this for reads through drizzle; the two
 * governed routes that read the same column through the raw `pg` pool did not, and could not, because
 * the conversion lived inside a `customType` closure.
 *
 * Measured on HERMES (UTC-7) against the live `GRANT-0019` row: a grant written to live two hours was
 * honoured by `app/api/system/node/stamp-identity/route.ts` for nine. West of UTC a grant outlives its
 * bound; east of UTC it dies early. Either way the number in the authority record is not the number
 * being enforced.
 *
 * These tests run under a fixed non-UTC zone on purpose. A suite that proved this on a UTC machine
 * would prove nothing at all, so the offset is asserted before anything else is.
 */
import { describe, expect, it, afterAll, vi } from "vitest"

import { fromUtcWallDriver, toUtcWallDriver } from "@/lib/db/utc-wall-timestamp"
import { authorityGrantFactsFromRow, grantCovers, isGrantActive } from "@/lib/governance/authority"

// UTC-7 in August, which is the zone the defect was measured in.
//
// Set at MODULE scope, not in `beforeAll`. A `describe` callback body runs during collection, which
// is BEFORE any `beforeAll`, so a Date built there would be built in the runner's own zone and then
// read back in this one -- and the two tests below would measure a skew nobody configured. That is
// how the first version of this file passed on a UTC-7 laptop and failed on a UTC runner: the
// arrangement was environment-order-dependent in exactly the way the code under test is.
//
// Every driver value is ALSO constructed inside its test rather than beside it, so the ordering
// cannot bite again if this line is ever moved.
const SKEWED_ZONE = "America/Los_Angeles"
const originalTz = process.env.TZ
process.env.TZ = SKEWED_ZONE

afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
  vi.useRealTimers()
})

/**
 * How node-pg hands back a `timestamp without time zone`: a Date built from the stored components
 * interpreted in the local zone. Building it this way rather than hard-coding an instant is what makes
 * the test measure the offset the runtime actually has instead of one it was told about.
 */
function asNodePgWouldParse(y: number, m: number, d: number, hh: number, mm: number, ss: number, ms = 0) {
  return new Date(y, m - 1, d, hh, mm, ss, ms)
}

describe("the harness is actually in a skewed zone", () => {
  it("reads a non-zero local offset, or the rest of this file proves nothing", () => {
    const offsetMinutes = asNodePgWouldParse(2026, 8, 25, 12, 0, 0).getTimezoneOffset()
    expect(offsetMinutes).not.toBe(0)
    expect(offsetMinutes).toBe(420)
  })
})

describe("fromUtcWallDriver recovers the stored instant", () => {
  it("undoes node-pg's local-time interpretation of a Date", () => {
    // The exact row OR-09 measured: stored wall clock 2026-08-25 12:05:06.566, meant as UTC.
    const driverValue = asNodePgWouldParse(2026, 8, 25, 12, 5, 6, 566)

    // What the raw route did before this fix, reproduced rather than described.
    expect(new Date(driverValue).toISOString()).toBe("2026-08-25T19:05:06.566Z")

    expect(fromUtcWallDriver(driverValue).toISOString()).toBe("2026-08-25T12:05:06.566Z")
  })

  it("treats a zoneless string as UTC rather than as local", () => {
    expect(fromUtcWallDriver("2026-08-25 12:05:06.566").toISOString()).toBe("2026-08-25T12:05:06.566Z")
  })

  it("respects an explicit zone when the driver supplies one", () => {
    expect(fromUtcWallDriver("2026-08-25T12:05:06.566Z").toISOString()).toBe("2026-08-25T12:05:06.566Z")
    expect(fromUtcWallDriver("2026-08-25T05:05:06.566-07:00").toISOString()).toBe("2026-08-25T12:05:06.566Z")
  })

  it("round-trips through the writer without drifting", () => {
    const instant = new Date("2026-08-25T12:05:06.566Z")
    expect(fromUtcWallDriver(toUtcWallDriver(instant)).toISOString()).toBe(instant.toISOString())
  })

  it("refuses a value it cannot read instead of returning an invalid Date", () => {
    expect(() => fromUtcWallDriver("not a timestamp")).toThrow("AUTHORITY_TIMESTAMP_INVALID")
    expect(() => fromUtcWallDriver(new Date(Number.NaN))).toThrow("AUTHORITY_TIMESTAMP_INVALID")
    expect(() => toUtcWallDriver(new Date(Number.NaN))).toThrow("AUTHORITY_TIMESTAMP_INVALID")
  })
})

describe("a bounded grant expires when the record says it does", () => {
  // Granted 2026-08-25T12:05:06Z to live two hours: dead from 14:05:06Z. Built inside the callers,
  // never at collection time -- see the note on the zone above.
  const grantedAt = () => asNodePgWouldParse(2026, 8, 25, 12, 5, 6, 566)
  const expiresAtRow = () => asNodePgWouldParse(2026, 8, 25, 14, 5, 6, 566)

  const row = () => ({
    id: 32,
    ref: "GRANT-0019",
    status: "active",
    authorityLevel: "A3_WRITE_SHARED",
    allowedActions: ["node.stamp-identity"],
    blockedActions: [],
    expiresAt: expiresAtRow(),
    revokedAt: null,
    revokeReason: null,
  })

  it("still covers the operation inside the bound", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-08-25T13:00:00.000Z"))
    const verdict = grantCovers(authorityGrantFactsFromRow(row()), "A3_WRITE_SHARED", "node.stamp-identity")
    expect(verdict.ok).toBe(true)
    vi.useRealTimers()
  })

  it("refuses the operation once the bound has passed", () => {
    vi.useFakeTimers()
    // 15:00Z: 55 minutes past a two-hour grant. Under the raw read this instant is 22:00 by the
    // route's arithmetic and the grant looks live for four more hours.
    vi.setSystemTime(new Date("2026-08-25T15:00:00.000Z"))

    const verdict = grantCovers(authorityGrantFactsFromRow(row()), "A3_WRITE_SHARED", "node.stamp-identity")
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain("expired")

    // The defect itself, pinned: the shape the routes used before this fix accepts the same grant at
    // the same instant. If this assertion ever starts failing, the raw read has become correct and
    // this whole test file can be reconsidered -- but silently is not how that should happen.
    const asRawRoutesRead = {
      ...row(),
      expiresAt: new Date(row().expiresAt),
    }
    expect(grantCovers(asRawRoutesRead, "A3_WRITE_SHARED", "node.stamp-identity").ok).toBe(true)

    vi.useRealTimers()
  })

  it("agrees with the schema's own reading of the same column", () => {
    // What a drizzle read of the identical row produces, which is the semantics the record is written
    // in. The two readers must not disagree about when a grant dies.
    expect(authorityGrantFactsFromRow(row()).expiresAt?.toISOString()).toBe(
      fromUtcWallDriver(expiresAtRow()).toISOString(),
    )
    expect(fromUtcWallDriver(expiresAtRow()).getTime() - fromUtcWallDriver(grantedAt()).getTime())
      .toBe(2 * 60 * 60 * 1000)
  })
})

describe("authorityGrantFactsFromRow normalises what a raw row can be missing", () => {
  const base = {
    id: 7,
    ref: null,
    status: "active",
    authorityLevel: "A3_WRITE_SHARED",
    allowedActions: null,
    blockedActions: null,
    expiresAt: null,
    revokedAt: null,
  }

  it("defaults null action arrays to empty rather than throwing in grantCovers", () => {
    const facts = authorityGrantFactsFromRow(base)
    expect(facts.allowedActions).toEqual([])
    expect(facts.blockedActions).toEqual([])
    // An empty allow-list means "not narrowed by action", which is grantCovers' existing contract.
    expect(grantCovers(facts, "A3_WRITE_SHARED", "node.stamp-identity").ok).toBe(true)
  })

  it("carries a null expiry through as never-expiring", () => {
    expect(authorityGrantFactsFromRow(base).expiresAt).toBeNull()
    expect(isGrantActive(authorityGrantFactsFromRow(base)).ok).toBe(true)
  })

  it("converts revokedAt through the same clock as expiresAt", () => {
    const revokedAt = asNodePgWouldParse(2026, 8, 25, 12, 30, 0, 0)
    const facts = authorityGrantFactsFromRow({ ...base, revokedAt, status: "revoked", revokeReason: "single use spent" })
    expect(facts.revokedAt?.toISOString()).toBe("2026-08-25T12:30:00.000Z")
    const verdict = isGrantActive(facts)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain("single use spent")
  })

  it("refuses a row whose expiry cannot be read, rather than treating it as no expiry", () => {
    // Silently dropping an unreadable bound is how "bounded" becomes "forever".
    expect(() => authorityGrantFactsFromRow({ ...base, expiresAt: "whenever" })).toThrow(
      "AUTHORITY_TIMESTAMP_INVALID",
    )
  })
})
