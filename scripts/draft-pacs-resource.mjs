import { register } from "node:module"
import { pathToFileURL } from "node:url"
register("./repo-alias-loader.mjs", pathToFileURL(`${import.meta.dirname}/`))

const fs = await import("node:fs")
const path = await import("node:path")
const { pool } = await import("@/lib/db")
const { resolveOwnerUserId } = await import("@/lib/governance/owner")
const { ownerLookup } = await import("@/lib/governance/owner-lookup")
const { RELATIONSHIP } = await import("@/lib/resource/resolve")

/**
 * Draft the PACS resource record (#876), and mark it unratified.
 *
 * Every row here comes from an artefact that was actually read, not from an agent's recollection. The
 * declared workload owner is the owner's own statement. Where the record and reality disagree -- and
 * they do, because the restore currently sits on a different node than the declared owner -- that
 * disagreement is deliberately preserved rather than smoothed over: reconciling declared against
 * observed is boundary 3, and a record edited to match whatever a filesystem showed today would destroy
 * the very contradiction the system needs to surface.
 *
 * Nothing here is ratified. Ratification is the owner's act.
 */
const ownerId = await resolveOwnerUserId(ownerLookup(), process.env.WILLIAMOS_OWNER_EMAIL)
if (!ownerId) throw new Error("owner unresolved; refusing to write a record with no attributable author")

const PROJECT = { key: "terrafusion", name: "TerraFusion" }
const RESOURCE_KEY = "pacs"

const ROWS = [
  {
    type: "node",
    canonicalIdentity: "aegis",
    label: "AEGIS — declared workload owner for PACS (owner statement, 2026-08-18)",
    relationship: RELATIONSHIP.workloadOwner,
    allowedOperations: ["read", "verify", "restore"],
  },
  {
    type: "data_source",
    canonicalIdentity: "atlas:/forge/sources/pacs/pacs_oltp_backup_2026_01_15_170502_7994110.bak",
    label: "PACS OLTP backup, 102,359,101,440 bytes; VERIFY_RESULT=PASS via verify-pacs-bak.sh 2026-08-11",
    relationship: RELATIONSHIP.source,
    allowedOperations: ["read", "verify"],
  },
  {
    type: "data_source",
    canonicalIdentity: "atlas:/forge/sources/pacs/Benton_spatial_data_backup_2026_01_15_170502_7974200.bak",
    label: "Benton spatial backup, 2,422,134,272 bytes",
    relationship: RELATIONSHIP.source,
    allowedOperations: ["read", "verify"],
  },
  {
    type: "database",
    canonicalIdentity: "atlas:/forge/mssql/data",
    label: "Restored SQL Server data files, 738 GB (pacs_oltp_data1.mdf 573 GB, pacs_benton_2015 61 GB, ascprod_config 94 GB), written 2026-08-13/14",
    relationship: RELATIONSHIP.completionEvidence,
    allowedOperations: ["read"],
  },
  {
    type: "data_source",
    canonicalIdentity: "aegis:~/verify-pacs-bak.out",
    label: "Backup verification receipt: RESTORE VERIFYONLY reports the backup set valid, VERIFY_RESULT=PASS",
    relationship: RELATIONSHIP.completionEvidence,
    allowedOperations: ["read"],
  },
  {
    type: "database",
    canonicalIdentity: "omen:terrafusion_benton_demo",
    label: "OMEN cold capture, canonical_tf + legacy_pacs_raw, ~11M rows; preserved as a verified 740 MB dump (#854)",
    relationship: RELATIONSHIP.derivative,
    allowedOperations: ["read"],
  },
]

const existingProject = await pool.query('SELECT "id" FROM project WHERE "userId" = $1 AND "key" = $2', [
  ownerId,
  PROJECT.key,
])
let projectId = existingProject.rows[0]?.id
if (!projectId) {
  const created = await pool.query(
    'INSERT INTO project ("userId","key","name","lifecycle") VALUES ($1,$2,$3,$4) RETURNING "id"',
    [ownerId, PROJECT.key, PROJECT.name, "active"],
  )
  projectId = created.rows[0].id
  console.log(`created project ${PROJECT.key} (${projectId})`)
} else {
  console.log(`project ${PROJECT.key} already exists (${projectId})`)
}

for (const row of ROWS) {
  await pool.query(
    `INSERT INTO project_resource
       ("userId","projectId","type","canonicalIdentity","label","relationship","allowedOperations","resourceKey")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT ("projectId","type","canonicalIdentity","relationship")
     DO UPDATE SET "label" = EXCLUDED."label", "allowedOperations" = EXCLUDED."allowedOperations", "resourceKey" = EXCLUDED."resourceKey", "updatedAt" = now()`,
    [ownerId, projectId, row.type, row.canonicalIdentity, row.label, row.relationship, row.allowedOperations, RESOURCE_KEY],
  )
}
console.log(`drafted ${ROWS.length} resource rows for PACS — all UNRATIFIED`)
await pool.end()
