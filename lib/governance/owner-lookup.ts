import { pool } from "@/lib/db"

import type { OwnerLookup } from "@/lib/governance/owner"

/**
 * The database half of owner resolution.
 *
 * Kept apart from the rule itself so the rule stays testable without a database, and shared so the
 * two callers cannot drift. They had drifted: the device-certificate route and the authority route
 * each carried their own copy of these queries, which is how "the owner" came to mean three slightly
 * different things across sign-in, device management and governance.
 */
export function ownerLookup(): OwnerLookup {
  return {
    byEmail: async (email) => {
      const rows = await pool.query('SELECT "id" FROM "user" WHERE lower("email") = $1 LIMIT 1', [email])
      return (rows.rows[0]?.id as string | undefined) ?? null
    },
    // The only account that can actually sign in. More than one and this returns nothing, because
    // guessing which of several accounts is the owner is the failure being avoided.
    soleCredentialed: async () => {
      const rows = await pool.query(
        `SELECT u."id" FROM "user" u
           JOIN "account" a ON a."userId" = u."id" AND a."providerId" = 'credential' AND a."password" IS NOT NULL`,
      )
      return rows.rowCount === 1 ? (rows.rows[0].id as string) : null
    },
  }
}
