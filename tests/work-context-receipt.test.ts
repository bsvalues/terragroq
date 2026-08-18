import { describe, expect, it } from "vitest"

import {
  issueWorkContextReceipt,
  receiptToken,
  requiresWorkContext,
  verifyWorkContextReceipt,
  type WorkContextFacts,
} from "@/lib/governance/work-context-receipt"

/** A lane that has actually done the work the gate asks for. */
const proven: WorkContextFacts = {
  mainSha: "6f0e1022aa11bb22cc33dd44ee55ff6677889900",
  workOrderRef: "WO-EXAMPLE-1",
  parentOutcome: "OUTCOME-762",
  reservedPaths: ["lib/governance/", "app/api/loom/"],
  authorityLevel: "A2_WRITE_OWN",
  doctrineDigest: "d".repeat(64),
  existingSubsystem: "integrating",
  topologySource: "canonical-registry",
  collisions: [],
  remainingParentAcceptance: "usable cockpit still requires the four-node baseline",
}

describe("work context receipt", () => {
  it("issues a receipt when every premise is proven", () => {
    const verdict = issueWorkContextReceipt(proven)
    expect(verdict.ok).toBe(true)
    expect(verdict.receipt).toMatch(/^[0-9a-f]{16,}$/)
  })

  it("refuses a lane that cannot name current main", () => {
    expect(issueWorkContextReceipt({ ...proven, mainSha: "" })).toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
    // A branch name is not a SHA; accepting one would let "main" stand in for whatever it points at.
    expect(issueWorkContextReceipt({ ...proven, mainSha: "main" })).toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
  })

  it("refuses a lane that never read the work order", () => {
    for (const missing of ["workOrderRef", "parentOutcome", "authorityLevel"] as const) {
      expect(issueWorkContextReceipt({ ...proven, [missing]: "" })).toMatchObject({
        ok: false, failure: "FAILED_WORK_ORDER_NOT_READ",
      })
    }
  })

  it("refuses a lane that did not reconcile existing subsystems", () => {
    expect(issueWorkContextReceipt({ ...proven, existingSubsystem: "skipped" as never }))
      .toMatchObject({ ok: false, failure: "FAILED_EXISTING_SUBSYSTEM_NOT_RECONCILED" })
  })

  it("refuses topology taken from memory", () => {
    // This is the failure that had the plane aiming at an address no machine had.
    expect(issueWorkContextReceipt({ ...proven, topologySource: "memory" as never }))
      .toMatchObject({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" })
  })

  it("refuses when another lane already reserved the scope", () => {
    expect(issueWorkContextReceipt({ ...proven, collisions: ["PR #750 owns lib/governance/"] }))
      .toMatchObject({ ok: false, failure: "FAILED_SCOPE_COLLISION" })
  })

  it("refuses a child that does not know what the parent still needs", () => {
    expect(issueWorkContextReceipt({ ...proven, remainingParentAcceptance: "" }))
      .toMatchObject({ ok: false, failure: "FAILED_PREMATURE_HANDOFF" })
  })

  it("refuses a receipt-free mutation", () => {
    expect(verifyWorkContextReceipt(null, proven)).toMatchObject({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" })
    expect(verifyWorkContextReceipt("   ", proven)).toMatchObject({ ok: false, failure: "FAILED_CONTEXT_NOT_PROVEN" })
  })

  it("accepts its own receipt while the premise holds", () => {
    const issued = issueWorkContextReceipt(proven)
    expect(verifyWorkContextReceipt(issued.receipt, proven).ok).toBe(true)
  })

  it("goes stale the moment main moves", () => {
    const issued = issueWorkContextReceipt(proven)
    const afterMerge = { ...proven, mainSha: "aaaaaaa1111222233334444555566667777888899" }
    expect(verifyWorkContextReceipt(issued.receipt, afterMerge))
      .toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
  })

  it("goes stale when the controlling doctrine changes", () => {
    const issued = issueWorkContextReceipt(proven)
    expect(verifyWorkContextReceipt(issued.receipt, { ...proven, doctrineDigest: "e".repeat(64) }).ok).toBe(false)
  })

  it("goes stale when the work order changes underneath the lane", () => {
    const issued = issueWorkContextReceipt(proven)
    expect(verifyWorkContextReceipt(issued.receipt, { ...proven, authorityLevel: "A4_RELEASE" }).ok).toBe(false)
  })

  it("treats a reservation as a set, so ordering does not mint a different receipt", () => {
    expect(receiptToken(proven)).toBe(receiptToken({ ...proven, reservedPaths: ["app/api/loom/", "lib/governance/"] }))
  })

  it("gates mutations only", () => {
    expect(requiresWorkContext(true)).toBe(true)
    // Reads stay open: gating them pushes a lane toward working blind instead of proving context.
    expect(requiresWorkContext(false)).toBe(false)
  })
})
