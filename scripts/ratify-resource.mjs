import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./repo-alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`))

const { pool } = await import("@/lib/db")
const { resolveOwnerUserId } = await import("@/lib/governance/owner")
const { ownerLookup } = await import("@/lib/governance/owner-lookup")
const { appendGovernanceEvent } = await import("@/lib/governance/events")

/**
 * Record the owner's ratification of a resource record.
 *
 * A record drafted by an agent is evidence, not truth: every answer derived from it says so, and #877
 * made that visible rather than optional. Ratification is the moment a human says the record is right,
 * and it is deliberately an owner act performed on purpose -- not something a lane can do for itself
 * while assembling the record it wants believed.
 *
 * Ratifying is NOT resolving. An open conflict about the resource stays open: the owner is confirming
 * that the record says what he means it to say, which is a different claim from "reality currently
 * matches it". Those two being conflated is how a contradiction disappears without anyone deciding it.
 */
const resourceKey = (process.argv[2] ?? "").trim().toLowerCase()
if (!resourceKey) throw new Error("a resource key is required, e.g. pacs")

const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
if (!ownerId) throw new Error("owner unresolved; refusing to attribute a ratification to nobody")

const before = await pool.query(
  `SELECT "canonicalIdentity", "relationship" FROM project_resource WHERE lower("resourceKey") = $1`,
  [resourceKey],
)
if (before.rowCount === 0) throw new Error(`no record exists for ${resourceKey}`)

const updated = await pool.query(
  `UPDATE project_resource
      SET "ratifiedAt" = now(), "ratifiedBy" = $2, "updatedAt" = now()
    WHERE lower("resourceKey") = $1 AND "ratifiedAt" IS NULL
    RETURNING "canonicalIdentity"`,
  [resourceKey, ownerId],
)

await appendGovernanceEvent({
  userId: ownerId,
  eventType: "DECISION_ACCEPTED",
  entityType: "resource_record_ratification",
  entityId: resourceKey,
  actor: "owner",
  reason: `owner ratified the ${resourceKey} resource record`,
  after: { resourceKey, rows: before.rowCount, ratifiedRows: updated.rowCount },
  metadata: {
    ratifiedBy: ownerId,
    identities: before.rows.map((row) => `${row.relationship}:${row.canonicalIdentity}`),
    note: "ratification confirms the record, not that reality currently matches it; open conflicts remain open",
  },
})

const conflicts = await pool.query(
  `SELECT "ref", "severity", "status" FROM conflict_record
    WHERE "status" = 'open' AND "detectedBetween" LIKE $1`,
  [`resource:${resourceKey.toUpperCase()}%`],
)

console.log(`ratified ${updated.rowCount} of ${before.rowCount} row(s) for ${resourceKey}`)
console.log(`attributed to ${ownerId}`)
for (const conflict of conflicts.rows) {
  console.log(`still open: ${conflict.ref} (${conflict.severity}) — ratifying did not resolve it`)
}
await pool.end()
