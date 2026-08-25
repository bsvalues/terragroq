/**
 * The one conversion for `timestamp without time zone` columns that store a UTC WALL CLOCK.
 *
 * Postgres `timestamp` carries no offset. node-pg parses one by building a Date from its components
 * in the *reading process's* local zone, so for a column whose stored wall clock is UTC by
 * construction (`timezone('UTC', now())`) the instant it returns is wrong by exactly that offset.
 *
 * This logic has always existed -- inside the `utcWallTimestamp` `customType` closure in
 * `lib/db/schema.ts`, which is why every read through drizzle was correct. It was unreachable from
 * anywhere else, so the two governed routes that read `authority_grant` through the raw `pg` pool got
 * the local-time reading instead. On HERMES (UTC-7) that made a two-hour authority grant one the
 * stamp-identity route honoured for nine: `CONT-EXPV2-GRANT-EXPIRY-TZ-SKEW`, measured against the live
 * `GRANT-0019` row.
 *
 * The fix is extraction, not restatement. A second copy of this arithmetic living beside each raw
 * reader is the same defect one step later: correct on the day it is written, quietly divergent the
 * day one copy is amended. `schema.ts` now calls these functions, so there is exactly one.
 */

/** Read a driver value from a UTC-wall-clock column as the instant it actually denotes. */
export function fromUtcWallDriver(value: string | Date): Date {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error("AUTHORITY_TIMESTAMP_INVALID")
    // node-pg already split the stored text into components using the local zone. Re-assembling those
    // same components as UTC is what undoes it -- and it is offset-agnostic, so it stays correct
    // across a DST boundary where subtracting a fixed offset would not.
    return new Date(Date.UTC(
      value.getFullYear(),
      value.getMonth(),
      value.getDate(),
      value.getHours(),
      value.getMinutes(),
      value.getSeconds(),
      value.getMilliseconds(),
    ))
  }
  const normalized = value.trim().replace(" ", "T")
  // A driver configured to hand back text gets the same reading: an explicit zone is honoured, and a
  // zoneless string is UTC rather than local, which is what the column means.
  const instant = new Date(/[zZ]$|[+-]\d\d(?::?\d\d)?$/.test(normalized)
    ? normalized
    : `${normalized}Z`)
  if (!Number.isFinite(instant.getTime())) throw new Error("AUTHORITY_TIMESTAMP_INVALID")
  return instant
}

/** Render an instant as the UTC wall clock this column stores. */
export function toUtcWallDriver(value: Date): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("AUTHORITY_TIMESTAMP_INVALID")
  }
  return value.toISOString().slice(0, -1).replace("T", " ")
}
