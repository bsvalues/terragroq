/**
 * What a resource is, answered from a governed record rather than from a filesystem.
 *
 * #871 boundary 2. The question "who owns PACS, and has this already been done" had no answerer, so it
 * was answered by an agent running `du -sh` across four machines -- wrongly, twice, ending one command
 * short of re-importing a 102 GB backup whose restore already existed. Discovery by inference is the
 * defect; this is the record it should have been read from.
 *
 * Resolution is a READ. It returns what is declared, never what is observed -- reconciling the two is
 * boundary 3 -- and it grants nothing. `allowedOperations` says what may be done, which is not the same
 * as permission to do it; that still requires a recorded authority grant.
 */

/** The relationships a resource record is built from. Free text in the table; named here so it is one vocabulary. */
export const RELATIONSHIP = {
  workloadOwner: "workload-owner",
  source: "source",
  runtime: "runtime",
  derivative: "derivative",
  completionEvidence: "completion-evidence",
  /**
   * Retained, but no longer the workload's. An artefact that has been superseded is not deleted and
   * not pretended away: it stays visible with its provenance, and stops driving reconciliation, because
   * a copy left behind on the old node is not evidence that the workload still lives there.
   */
  archive: "archive",
} as const

export interface ResourceRow {
  type: string
  canonicalIdentity: string
  label: string
  relationship: string
  allowedOperations?: string[] | null
  ratifiedAt?: Date | string | null
  ratifiedBy?: string | null
  projectKey?: string | null
  projectName?: string | null
}

export interface ResourceRecord {
  identity: string
  project: { key: string | null; name: string | null }
  workloadOwner: { identity: string; label: string } | null
  sources: Array<{ identity: string; label: string; type: string }>
  runtime: Array<{ identity: string; label: string; type: string }>
  derivatives: Array<{ identity: string; label: string; type: string }>
  completionEvidence: Array<{ identity: string; label: string }>
  archive: Array<{ identity: string; label: string; type: string }>
  allowedOperations: string[]
  ratified: boolean
  /** Present when unratified, so no caller can mistake a draft for settled truth. */
  caveat?: string
}

const member = (row: ResourceRow) => ({ identity: row.canonicalIdentity, label: row.label, type: row.type })

/**
 * Shape rows into the record.
 *
 * A resource with no rows is NOT an empty record -- it is an unknown resource, and the caller must be
 * able to tell those apart. Returning a hollow record would reproduce the original failure: an agent
 * reading "no owner declared" as "no owner exists" and deciding one for itself.
 */
export function shapeResourceRecord(identity: string, rows: ResourceRow[]): ResourceRecord | null {
  if (rows.length === 0) return null

  const owner = rows.find((row) => row.relationship === RELATIONSHIP.workloadOwner)
  const ratified = rows.every((row) => Boolean(row.ratifiedAt))
  const allowedOperations = [...new Set(rows.flatMap((row) => row.allowedOperations ?? []))].sort()

  return {
    identity,
    project: { key: rows[0].projectKey ?? null, name: rows[0].projectName ?? null },
    workloadOwner: owner ? { identity: owner.canonicalIdentity, label: owner.label } : null,
    sources: rows.filter((row) => row.relationship === RELATIONSHIP.source).map(member),
    runtime: rows.filter((row) => row.relationship === RELATIONSHIP.runtime).map(member),
    derivatives: rows.filter((row) => row.relationship === RELATIONSHIP.derivative).map(member),
    completionEvidence: rows
      .filter((row) => row.relationship === RELATIONSHIP.completionEvidence)
      .map((row) => ({ identity: row.canonicalIdentity, label: row.label })),
    archive: rows.filter((row) => row.relationship === RELATIONSHIP.archive).map(member),
    allowedOperations,
    ratified,
    ...(ratified
      ? {}
      : {
          caveat:
            "This record was drafted from existing artefacts and has not been ratified by the owner. Treat it as evidence, not as settled truth.",
        }),
  }
}
