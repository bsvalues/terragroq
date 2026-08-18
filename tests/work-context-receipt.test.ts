import { describe, expect, it } from "vitest"

import {
  assertAuthorityGranted,
  issueWorkContextReceipt,
  receiptToken,
  requiresWorkContext,
  verifyWorkContextReceipt,
  type WorkContextFacts,
} from "@/lib/governance/work-context-receipt"

/** A different, VALID 40-hex sha, for the case where main has advanced under the lane. */
const MOVED_MAIN = "ab".repeat(20)

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
    // MOVED_MAIN must be a VALID 40-hex sha. The literal here was 41 characters, so this case was
    // rejected by the sha shape check and never reached the comparison -- it passed because an
    // unparseable sha reports FAILED_STALE_MAIN too, which is the same verdict for a different reason.
    const issued = issueWorkContextReceipt(proven)
    const afterMerge = { ...proven, mainSha: MOVED_MAIN }
    expect(issueWorkContextReceipt(afterMerge).ok).toBe(true)
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

  it("tells a stale receipt apart from a doctored one, because the remedies differ", () => {
    // Both used to report FAILED_STALE_MAIN, which sent a tampered claim at the wrong fix.
    const issued = issueWorkContextReceipt(proven)

    // Facts intact, measured truth moved -> genuinely stale.
    const stale = verifyWorkContextReceipt(
      issued.receipt,
      { ...proven, mainSha: MOVED_MAIN },
      { mainSha: proven.mainSha, doctrineDigest: proven.doctrineDigest },
    )
    expect(stale).toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
    expect(stale.detail).toContain("main moved")

    // A widened reservation, token unchanged -> never issued for these facts.
    const doctored = verifyWorkContextReceipt(
      issued.receipt,
      { ...proven, reservedPaths: [...proven.reservedPaths, "app/"] },
      { mainSha: proven.mainSha, doctrineDigest: proven.doctrineDigest },
    )
    expect(doctored).toMatchObject({ ok: false, failure: "FAILED_RECEIPT_MISMATCH" })
    expect(doctored.detail).toContain("not issued for these facts")
  })

  it("names doctrine drift as doctrine drift rather than as a moved main", () => {
    const issued = issueWorkContextReceipt(proven)
    const verdict = verifyWorkContextReceipt(
      issued.receipt,
      { ...proven, doctrineDigest: "e".repeat(64) },
      { mainSha: proven.mainSha, doctrineDigest: proven.doctrineDigest },
    )
    expect(verdict).toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
    expect(verdict.detail).toContain("doctrine")
    expect(verdict.detail).not.toContain("main moved")
  })

  it("keeps the ledger path's meaning when no issuance context is supplied", () => {
    // requireWorkContext() looks the facts up by token, so a mismatch there IS drift by construction.
    const issued = issueWorkContextReceipt(proven)
    expect(verifyWorkContextReceipt(issued.receipt, { ...proven, mainSha: "b".repeat(40) }))
      .toMatchObject({ ok: false, failure: "FAILED_STALE_MAIN" })
  })

  it("still accepts a valid receipt when issuance context is supplied", () => {
    const issued = issueWorkContextReceipt(proven)
    expect(verifyWorkContextReceipt(issued.receipt, proven, {
      mainSha: proven.mainSha,
      doctrineDigest: proven.doctrineDigest,
    }).ok).toBe(true)
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

describe("receipt authority binding", () => {
  // grantCovers is the real implementation's checker; these tests supply a stand-in so the binding
  // logic is tested without a database, and so a change in rank rules is caught by ITS tests, not
  // duplicated here.
  const covers = (grant: { authorityLevel: string; status: string }, required: string) =>
    grant.status !== "active"
      ? { ok: false, reason: `grant status is ${grant.status}` }
      : grant.authorityLevel === required
        ? { ok: true, reason: "covered" }
        : { ok: false, reason: `grant provides ${grant.authorityLevel} but ${required} is required` }

  const scopeKeys = ["WO-831-GATE", "OUTCOME-762"]

  it("refuses a lane with no grant at all", () => {
    expect(assertAuthorityGranted("A2_WRITE_OWN", scopeKeys, [], covers))
      .toMatchObject({ ok: false, failure: "FAILED_AUTHORITY_NOT_GRANTED" })
  })

  it("refuses authority the lane simply asserted about itself", () => {
    // The grant exists but only reaches A2; claiming A4 must not pass because the lane said so.
    const verdict = assertAuthorityGranted("A4_RELEASE", scopeKeys,
      [{ scope: null, authorityLevel: "A2_WRITE_OWN", status: "active" }], covers)
    expect(verdict.ok).toBe(false)
    expect(verdict.detail).toContain("A4_RELEASE is required")
  })

  it("refuses a revoked or expired grant", () => {
    for (const status of ["revoked", "expired"]) {
      expect(assertAuthorityGranted("A2_WRITE_OWN", scopeKeys,
        [{ scope: null, authorityLevel: "A2_WRITE_OWN", status }], covers).ok).toBe(false)
    }
  })

  it("refuses a grant issued for different work", () => {
    // This is the quiet failure worth catching: a narrow permission becoming a general one.
    const verdict = assertAuthorityGranted("A2_WRITE_OWN", scopeKeys,
      [{ scope: "goal:GOAL-0011", authorityLevel: "A2_WRITE_OWN", status: "active" }], covers)
    expect(verdict).toMatchObject({ ok: false, failure: "FAILED_AUTHORITY_NOT_GRANTED" })
    expect(verdict.detail).toContain("does not cover")
  })

  it("accepts a grant scoped to this work order", () => {
    expect(assertAuthorityGranted("A2_WRITE_OWN", scopeKeys,
      [{ scope: "wo:WO-831-GATE", authorityLevel: "A2_WRITE_OWN", status: "active" }], covers).ok).toBe(true)
  })

  it("accepts a grant scoped to the parent outcome", () => {
    expect(assertAuthorityGranted("A2_WRITE_OWN", scopeKeys,
      [{ scope: "OUTCOME-762", authorityLevel: "A2_WRITE_OWN", status: "active" }], covers).ok).toBe(true)
  })

  it("accepts an unscoped grant, which is general by construction", () => {
    expect(assertAuthorityGranted("A2_WRITE_OWN", scopeKeys,
      [{ scope: "", authorityLevel: "A2_WRITE_OWN", status: "active" }], covers).ok).toBe(true)
  })

  it("finds a covering grant among several that do not cover", () => {
    const verdict = assertAuthorityGranted("A2_WRITE_OWN", scopeKeys, [
      { scope: "goal:GOAL-0011", authorityLevel: "A2_WRITE_OWN", status: "active" },
      { scope: null, authorityLevel: "A2_WRITE_OWN", status: "revoked" },
      { scope: "wo:WO-831-GATE", authorityLevel: "A2_WRITE_OWN", status: "active" },
    ], covers)
    expect(verdict.ok).toBe(true)
  })

  it("reports why each candidate failed, since the fixes differ", () => {
    const verdict = assertAuthorityGranted("A2_WRITE_OWN", scopeKeys, [
      { scope: null, authorityLevel: "A2_WRITE_OWN", status: "revoked" },
      { scope: "goal:GOAL-0011", authorityLevel: "A2_WRITE_OWN", status: "active" },
    ], covers)
    expect(verdict.detail).toContain("revoked")
    expect(verdict.detail).toContain("does not cover")
  })
})
