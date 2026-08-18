import { describe, expect, it } from "vitest"

import { assertOperationAllowed } from "../lib/resource/completion"
import type { ResourceRecord } from "../lib/resource/resolve"

const record = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  identity: "PACS",
  project: { key: "terrafusion", name: "TerraFusion" },
  workloadOwner: { identity: "aegis", label: "AEGIS" },
  sources: [],
  runtime: [],
  derivatives: [],
  completionEvidence: [{ identity: "atlas:/forge/mssql/data", label: "738 GB restore, written 2026-08-13/14" }],
  allowedOperations: ["read", "verify", "restore"],
  ratified: false,
  ...over,
})

const conflict = { ref: "CONFLICT-0001", severity: "high", description: "declared aegis, evidence on atlas" }

describe("refusing work already done", () => {
  it("refuses the re-import this session nearly performed, and names the evidence", () => {
    const verdict = assertOperationAllowed({ record: record(), operation: "restore", openConflicts: [] })
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe("ALREADY_COMPLETE")
    expect(verdict.citedEvidence[0]).toContain("atlas:/forge/mssql/data")
    expect(verdict.remedy).toBeTruthy()
  })

  it("treats import, migrate and rebuild the same way", () => {
    for (const operation of ["import", "migrate", "rebuild", "reimport"]) {
      const verdict = assertOperationAllowed({ record: record({ allowedOperations: [] }), operation, openConflicts: [] })
      expect(verdict.refusal).toBe("ALREADY_COMPLETE")
    }
  })

  it("permits a reproducing operation when nothing is recorded as complete", () => {
    const verdict = assertOperationAllowed({
      record: record({ completionEvidence: [] }),
      operation: "restore",
      openConflicts: [],
    })
    expect(verdict.allowed).toBe(true)
  })

  it("permits reads regardless of recorded completion", () => {
    expect(assertOperationAllowed({ record: record(), operation: "read", openConflicts: [] }).allowed).toBe(true)
    expect(assertOperationAllowed({ record: record(), operation: "verify", openConflicts: [] }).allowed).toBe(true)
  })
})

describe("an open contradiction stops work", () => {
  it("refuses on a blocking conflict before anything else, and cites it", () => {
    const verdict = assertOperationAllowed({ record: record(), operation: "read", openConflicts: [conflict] })
    expect(verdict.allowed).toBe(false)
    expect(verdict.refusal).toBe("BLOCKED_BY_CONFLICT")
    expect(verdict.citedConflict).toBe("CONFLICT-0001")
  })

  it("ignores a low-severity conflict, which is not blocking", () => {
    const verdict = assertOperationAllowed({
      record: record(),
      operation: "read",
      openConflicts: [{ ...conflict, severity: "low" }],
    })
    expect(verdict.allowed).toBe(true)
  })

  it("refusing is not resolving: nothing in the verdict closes the conflict", () => {
    const verdict = assertOperationAllowed({ record: record(), operation: "restore", openConflicts: [conflict] })
    expect(verdict.refusal).toBe("BLOCKED_BY_CONFLICT")
    expect(verdict.remedy).toContain("Resolve or downgrade")
  })
})

describe("permitted operations", () => {
  it("refuses an operation the record does not permit, and lists what is permitted", () => {
    const verdict = assertOperationAllowed({
      record: record({ completionEvidence: [] }),
      operation: "delete",
      openConflicts: [],
    })
    expect(verdict.refusal).toBe("OPERATION_NOT_PERMITTED")
    expect(verdict.detail).toContain("read, verify, restore")
  })
})
