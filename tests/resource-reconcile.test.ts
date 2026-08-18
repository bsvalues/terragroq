import { describe, expect, it } from "vitest"

import { locationOf, reconcileResource } from "../lib/resource/reconcile"
import type { ResourceRecord } from "../lib/resource/resolve"

const record = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  identity: "PACS",
  project: { key: "terrafusion", name: "TerraFusion" },
  workloadOwner: { identity: "aegis", label: "AEGIS" },
  sources: [],
  runtime: [],
  derivatives: [],
  completionEvidence: [],
  allowedOperations: [],
  ratified: false,
  ...over,
})

describe("reading a location from an identity", () => {
  it("takes the node from node:path", () => {
    expect(locationOf("atlas:/forge/mssql/data")).toBe("atlas")
  })

  it("returns null for a bare path rather than guessing", () => {
    // Inventing a location from a bare path is the inference this boundary exists to replace.
    expect(locationOf("/forge/mssql/data")).toBeNull()
    expect(locationOf("pacs")).toBeNull()
  })
})

describe("reconciling declared against recorded", () => {
  it("registers the real PACS contradiction as blocking", () => {
    const verdict = reconcileResource(
      record({
        completionEvidence: [{ identity: "atlas:/forge/mssql/data", label: "738 GB restore" }],
        sources: [{ identity: "atlas:/forge/sources/pacs/pacs_oltp.bak", label: "102 GB backup", type: "data_source" }],
      }),
    )
    expect(verdict.classification).toBe("CONFLICTING")
    expect(verdict.severity).toBe("high")
    expect(verdict.disagreements).toHaveLength(2)
    expect(verdict.summary).toContain("declared to aegis")
    expect(verdict.summary).toContain("atlas")
  })

  it("confirms agreement when the evidence sits on the declared owner", () => {
    const verdict = reconcileResource(
      record({ completionEvidence: [{ identity: "aegis:/backup-primary/pacs", label: "restore" }] }),
    )
    expect(verdict.classification).toBe("EVIDENCE_BACKED")
    expect(verdict.severity).toBe("low")
  })

  it("says unsupported when nothing recorded names a location", () => {
    const verdict = reconcileResource(
      record({ completionEvidence: [{ identity: "some-artifact", label: "unplaced" }] }),
    )
    expect(verdict.classification).toBe("UNSUPPORTED")
  })

  it("says unsupported when no owner is declared, rather than inventing one", () => {
    const verdict = reconcileResource(record({ workloadOwner: null }))
    expect(verdict.classification).toBe("UNSUPPORTED")
    expect(verdict.summary).toContain("No workload owner is declared")
  })

  it("marks every verdict provisional while the record is unratified", () => {
    expect(reconcileResource(record()).provisional).toBe(true)
    expect(reconcileResource(record({ ratified: true })).provisional).toBe(false)
  })

  it("does not smooth a disagreement by preferring the newer evidence", () => {
    // Both locations survive in the verdict; nothing picks a winner. Choosing one would destroy the
    // signal this boundary exists to raise.
    const verdict = reconcileResource(
      record({
        completionEvidence: [
          { identity: "atlas:/forge/mssql/data", label: "restore" },
          { identity: "omen:terrafusion_benton_demo", label: "capture" },
        ],
      }),
    )
    expect(verdict.disagreements.map((d) => d.recorded).sort()).toEqual(["atlas", "omen"])
  })
})
