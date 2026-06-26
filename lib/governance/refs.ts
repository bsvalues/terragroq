// Shared human-reference generator (PREFIX-0001) scoped per operator.
// Mirrors the existing nextRef pattern used by the decision/work-order registers.

import type { PgTable } from "drizzle-orm/pg-core"
import { eq } from "drizzle-orm"
import { db } from "@/lib/db"

// Compute the next "PREFIX-NNNN" reference for a register, per user.
export async function nextRef(
  // The drizzle table — must expose `ref` and `userId` text columns.
  table: PgTable & { ref: any; userId: any },
  prefix: string,
  userId: string,
): Promise<string> {
  const rows = await db.select({ ref: table.ref }).from(table).where(eq(table.userId, userId))
  const re = new RegExp(`${prefix}-(\\d+)`)
  let max = 0
  for (const r of rows as { ref: string | null }[]) {
    const m = r.ref?.match(re)
    if (m) max = Math.max(max, Number.parseInt(m[1], 10))
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`
}
