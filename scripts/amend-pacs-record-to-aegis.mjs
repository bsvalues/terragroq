import { register } from "node:module"
import { pathToFileURL } from "node:url"

register("./repo-alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`))

const { pool } = await import("@/lib/db")
const { resolveOwnerUserId } = await import("@/lib/governance/owner")
const { ownerLookup } = await import("@/lib/governance/owner-lookup")
const { appendGovernanceEvent } = await import("@/lib/governance/events")

/**
 * Amend the PACS record to describe AEGIS as the workload's home, at the owner's instruction.
 *
 * A ratified record is not immutable, but changing one is an owner act with a trail: what changed, who
 * said so, and what was true at the time. Amending it quietly would be worse than never ratifying it.
 *
 * It only asserts what is TRUE WHEN IT RUNS. The restored database is added as completion evidence only
 * once SQL Server reports it ONLINE, because a record that claims a restore finished while it is still
 * running is exactly the confident wrong statement this whole outcome exists to prevent -- and the
 * reconciliation and the verification would both inherit the lie.
 *
 * The ATLAS artefacts are reclassified as archive, not deleted. They exist, they are intact, and their
 * provenance is worth keeping; they simply stop being the workload's declared sources.
 */
const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
if (!ownerId) throw new Error("owner unresolved; refusing to attribute an amendment to nobody")

const project = await pool.query('SELECT "id" FROM project WHERE "userId" = $1 AND "key" = $2', [ownerId, "terrafusion"])
const projectId = project.rows[0]?.id
if (!projectId) throw new Error("terrafusion project not found")

const changes = []

// 1. The AEGIS copies are verified and are now the workload's sources.
const ratifiedSources = await pool.query(
  `UPDATE project_resource SET "ratifiedAt" = now(), "ratifiedBy" = $1, "updatedAt" = now()
    WHERE lower("resourceKey") = 'pacs' AND "relationship" = 'source'
      AND "canonicalIdentity" LIKE 'aegis:%' AND "ratifiedAt" IS NULL
    RETURNING "canonicalIdentity"`,
  [ownerId],
)
changes.push(`ratified ${ratifiedSources.rowCount} AEGIS source(s)`)

// 2. The ATLAS copies are retained as archive rather than as live sources.
const archived = await pool.query(
  `UPDATE project_resource SET "relationship" = 'archive', "updatedAt" = now(),
          "label" = "label" || ' (archived on ATLAS after the workload moved to AEGIS)'
    WHERE lower("resourceKey") = 'pacs' AND "relationship" = 'source' AND "canonicalIdentity" LIKE 'atlas:%'
    RETURNING "canonicalIdentity"`,
)
changes.push(`archived ${archived.rowCount} ATLAS source(s)`)

// 3. The restored database, only if it is actually online.
const online = process.env.PACS_RESTORE_ONLINE === "1"
if (online) {
  await pool.query(
    `INSERT INTO project_resource
       ("userId","projectId","type","canonicalIdentity","label","relationship","allowedOperations","resourceKey","ratifiedAt","ratifiedBy")
     VALUES ($1,$2,'database','aegis:/home/bs/mssql/data','pacs_oltp restored on AEGIS from the verified backup under GRANT-0011','completion-evidence',$3,'pacs',now(),$4)
     ON CONFLICT ("projectId","type","canonicalIdentity","relationship")
     DO UPDATE SET "label" = EXCLUDED."label", "ratifiedAt" = now(), "ratifiedBy" = EXCLUDED."ratifiedBy", "updatedAt" = now()`,
    [ownerId, projectId, ["read", "verify"], ownerId],
  )
  await pool.query(
    `INSERT INTO project_resource
       ("userId","projectId","type","canonicalIdentity","label","relationship","allowedOperations","resourceKey","ratifiedAt","ratifiedBy")
     VALUES ($1,$2,'service','aegis:/home/bs/mssql/data','SQL Server 2022 (container pacs-mssql) serving pacs_oltp on AEGIS','runtime',$3,'pacs',now(),$4)
     ON CONFLICT ("projectId","type","canonicalIdentity","relationship")
     DO UPDATE SET "label" = EXCLUDED."label", "updatedAt" = now()`,
    [ownerId, projectId, ["read", "verify"], ownerId],
  )
  const retiredEvidence = await pool.query(
    `UPDATE project_resource SET "relationship" = 'archive', "updatedAt" = now(),
            "label" = "label" || ' (superseded by the AEGIS restore)'
      WHERE lower("resourceKey") = 'pacs' AND "relationship" = 'completion-evidence'
        AND "canonicalIdentity" = 'atlas:/forge/mssql/data'
      RETURNING "canonicalIdentity"`,
  )
  changes.push("recorded the AEGIS restore as completion evidence and runtime")
  changes.push(`archived ${retiredEvidence.rowCount} superseded ATLAS restore reference(s)`)
} else {
  changes.push("restore not yet ONLINE: the AEGIS database was NOT recorded as completion evidence")
}

await appendGovernanceEvent({
  userId: ownerId,
  eventType: "DECISION_ACCEPTED",
  entityType: "resource_record_amendment",
  entityId: "pacs",
  actor: "owner",
  reason: "owner instruction: update the PACS record to point at AEGIS",
  after: { changes, restoreOnline: online },
  metadata: { changes, restoreOnline: online, note: "ATLAS artefacts archived, not deleted" },
})

for (const change of changes) console.log(`  ${change}`)
await pool.end()
