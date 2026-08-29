import { describe, expect, it } from "vitest"

import { parseDeclaredReceipt, reviewPullRequestReceipt } from "@/lib/governance/pr-receipt"
import { receiptToken } from "@/lib/governance/work-context-receipt"

/**
 * Two seams between the local tool and the reviewer, each of which made the documented recovery path
 * unusable. The gate was right to refuse in both cases; it was refusing for the wrong reason, and the
 * lane following the printed instructions could not pass.
 */
const FACTS = {
  workOrderRef: "WO-0028",
  parentOutcome: "OUTCOME-762",
  authorityLevel: "A2_WRITE_OWN",
  mainSha: "eb171b26c3632f5dde51c9ef1c6fdcd14be63531",
  doctrineDigest: "4bb8831ee13e094bb823b3f5f6feb3c6f37bf629edea40d1f5cdb7e672ebbd6a",
  existingSubsystem: "integrating",
  topologySource: "canonical-registry",
  collisions: [],
  remainingParentAcceptance: "the parent still needs this",
  reservedPaths: ["scripts/runtime-operator/"],
  workOrderVersion: "w".repeat(64),
  grantVersion: "g".repeat(64),
  reservationVersion: "r".repeat(64),
} as const

function block(payload: unknown) {
  return ["```WORK_CONTEXT_RECEIPT", JSON.stringify(payload, null, 2), "```"].join("\n")
}

describe("the receipt a lane can actually produce", () => {
  it("accepts the field name establish-work-context.mjs actually writes", () => {
    // The tool writes { receipt, provenance, cockpit, facts } and prints "paste this file".
    const declared = parseDeclaredReceipt(block({ receipt: "abc123", facts: FACTS }))
    expect(declared?.token).toBe("abc123")
  })

  it("still accepts the token spelling", () => {
    expect(parseDeclaredReceipt(block({ token: "abc123", facts: FACTS }))?.token).toBe("abc123")
  })

  it("refuses a block carrying neither spelling", () => {
    expect(parseDeclaredReceipt(block({ facts: FACTS }))).toBeNull()
  })

  it("refuses a block with a token and no facts", () => {
    expect(parseDeclaredReceipt(block({ token: "abc123" }))).toBeNull()
  })
})

describe("a reservation that names a directory contains that directory", () => {
  // A real token over the same facts, so the scope rule is what is being tested rather than a
  // mismatch failing first and hiding it.
  const review = (reservedPaths: string[], changedFiles: string[]) => {
    const facts = { ...FACTS, reservedPaths }
    return reviewPullRequestReceipt({
      body: block({ token: receiptToken(facts), facts }),
      changedFiles,
      mainMovedFiles: [],
      liveDoctrineDigest: FACTS.doctrineDigest,
    })
  }

  it("does not call a file inside the reserved directory an escape", () => {
    const verdict = review(["scripts/runtime-operator"], ["scripts/runtime-operator/worker-lanes.mjs"])
    expect(verdict.failure).not.toBe("FAILED_SCOPE_ESCAPE")
  })

  it("treats the trailing-slash and /** spellings the same way", () => {
    for (const reserved of ["scripts/runtime-operator/", "scripts/runtime-operator/**"]) {
      const verdict = review([reserved], ["scripts/runtime-operator/worker-lanes.mjs"])
      expect(verdict.failure).not.toBe("FAILED_SCOPE_ESCAPE")
    }
  })

  it("still catches a genuine escape", () => {
    const verdict = review(["scripts/runtime-operator/"], ["app/actions/workbench-threads.ts"])
    expect(verdict.failure).toBe("FAILED_SCOPE_ESCAPE")
    expect(verdict.detail).toContain("app/actions/workbench-threads.ts")
  })

  it("keeps a single reserved file meaning exactly that file", () => {
    const verdict = review(["lib/workbench/load-threads.ts"], ["lib/workbench/load-threads-extra.ts"])
    expect(verdict.failure).toBe("FAILED_SCOPE_ESCAPE")
  })
})
