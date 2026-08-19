import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./repo-alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`))

const { pool } = await import("@/lib/db")
const { resolveOwnerUserId } = await import("@/lib/governance/owner")
const { ownerLookup } = await import("@/lib/governance/owner-lookup")
const { appendGovernanceEvent } = await import("@/lib/governance/events")

/**
 * Turn an owner instruction into a recorded authority grant.
 *
 * "Approval is not authority" cuts both ways: a spoken grant that never becomes a row is not something
 * a machine can check, and the whole point of the gate is that permission is verifiable rather than
 * remembered. This is the owner act that makes his instruction enforceable.
 *
 * Attribution resolves from the governed owner identity, never from whoever ran the command, so a lane
 * cannot grant itself authority and then satisfy its own check.
 */
const scope = (process.argv[2] ?? "").trim()
const action = (process.argv[3] ?? "").trim()
const level = (process.argv[4] ?? "A3_WRITE_SHARED").trim()
const reason = (process.argv[5] ?? "").trim()
if (!scope || !action || !reason) {
  throw new Error("usage: record-authority-grant.mjs <scope> <allowedAction> <authorityLevel> <reason>")
}

const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
if (!ownerId) throw new Error("owner unresolved; refusing to attribute a grant to nobody")

const existing = await pool.query(
  `SELECT count(*)::int AS n FROM authority_grant WHERE "userId" = $1 AND "ref" LIKE 'GRANT-%'`,
  [ownerId],
)
const ref = `GRANT-${String(existing.rows[0].n + 1).padStart(4, "0")}`

const inserted = await pool.query(
  `INSERT INTO authority_grant
     ("userId","ref","grantedBy","grantedTo","authorityLevel","scope","allowedActions","reason","status")
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')
   RETURNING "ref"`,
  [ownerId, ref, ownerId, "williamos", level, scope, [action], reason],
)

await appendGovernanceEvent({
  userId: ownerId,
  eventType: "AUTHORITY_GRANTED",
  entityType: "authority_grant",
  entityId: inserted.rows[0].ref,
  actor: "owner",
  reason,
  after: { scope, action, level, grantedTo: "williamos" },
  metadata: { scope, action, level, note: "recorded from an explicit owner instruction" },
})

console.log(`recorded ${inserted.rows[0].ref}: ${level} for ${action} scoped to ${scope}`)
console.log(`granted by ${ownerId}`)
await pool.end()
