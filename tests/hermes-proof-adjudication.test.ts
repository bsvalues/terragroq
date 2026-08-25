import { describe, expect, it } from "vitest"

import {
  ADMISSION,
  PROOF_STATE,
  adjudicateMergeAdmission,
  classifyProofState,
} from "../scripts/hermes-bridge/proof-adjudication.mjs"
import contract from "../config/hermes-bridge/required-proof-set.json"

const HEAD = "3b5dae61fbfa4c0dc5c86f000f7a0d6d1088d6d7"
const AT = "2026-08-25T00:00:00.000Z"

const REQUIRED = [
  "work context receipt (#831)",
  "vitest (deterministic suite)",
  "production build (next build)",
]

const check = (name: string, conclusion: string) => ({ __typename: "CheckRun", name, conclusion })
const allRequired = (conclusion: string) => REQUIRED.map((name) => check(name, conclusion))

const adjudicate = (checks: unknown[], headSha: string = HEAD) =>
  adjudicateMergeAdmission({ contract, checks, headSha, adjudicatedAt: AT })

describe("merge admission adjudication — adversarial matrix", () => {
  // The only case in this suite that may merge.
  it("admits when every required proof executed and succeeded", () => {
    const receipt = adjudicate(allRequired("SUCCESS"))
    expect(receipt.verdict).toBe(ADMISSION.ADMISSIBLE)
    expect(receipt.blockingReasons).toEqual([])
    expect(receipt.requiredProofs.every((p: any) => p.satisfied)).toBe(true)
  })

  it("refuses when a required proof never reported", () => {
    const receipt = adjudicate(allRequired("SUCCESS").slice(1))
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.missingProofs).toContain("work-context-receipt")
    expect(receipt.blockingReasons).toContain("REQUIRED_PROOF_MISSING:work-context-receipt")
  })

  it("refuses a skipped required proof", () => {
    const checks = [check(REQUIRED[0], "SKIPPED"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.nonExecutedProofs).toContainEqual({
      proofId: "work-context-receipt", state: PROOF_STATE.SKIPPED,
    })
  })

  it("refuses a neutral required proof", () => {
    const checks = [check(REQUIRED[0], "NEUTRAL"), ...allRequired("SUCCESS").slice(1)]
    expect(adjudicate(checks).verdict).toBe(ADMISSION.INADMISSIBLE)
  })

  it("refuses a cancelled required proof", () => {
    const checks = [check(REQUIRED[0], "CANCELLED"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.blockingReasons.join(" ")).toContain("DID_NOT_EXECUTE")
  })

  it("refuses a pending required proof", () => {
    const checks = [check(REQUIRED[0], "IN_PROGRESS"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.pendingProofs).toContain("work-context-receipt")
  })

  it("refuses a failed required proof", () => {
    const checks = [check(REQUIRED[0], "FAILURE"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.failedProofs).toContain("work-context-receipt")
  })

  // The checksGreen hole this P0 exists to close: one skipped advisory check satisfied
  // the whole gate because `checks.length > 0` was the only floor.
  it("refuses when the only reported check is a skipped advisory one", () => {
    const receipt = adjudicate([check("Some Advisory Lint", "SKIPPED")])
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.missingProofs).toHaveLength(3)
  })

  it("refuses when a lone success is present but every required proof is absent", () => {
    const receipt = adjudicate([check("Some Advisory Lint", "SUCCESS")])
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.missingProofs).toHaveLength(3)
  })

  it("admits despite an unavailable optional advisory check", () => {
    const receipt = adjudicate([...allRequired("SUCCESS"), check("CodeRabbit", "SKIPPED")])
    expect(receipt.verdict).toBe(ADMISSION.ADMISSIBLE)
    expect(receipt.optionalAssurance).toContainEqual({
      name: "CodeRabbit", state: PROOF_STATE.SKIPPED,
    })
  })

  it("admits despite extra irrelevant checks in any state", () => {
    const receipt = adjudicate([
      ...allRequired("SUCCESS"),
      check("Accessibility Audit", "FAILURE"),
      check("Perf Skill Audit", "CANCELLED"),
    ])
    expect(receipt.verdict).toBe(ADMISSION.ADMISSIBLE)
  })

  it("refuses duplicate/ambiguous proof identity rather than picking one", () => {
    const checks = [
      check(REQUIRED[0], "SUCCESS"),
      check(REQUIRED[0], "FAILURE"),
      ...allRequired("SUCCESS").slice(1),
    ]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.ambiguousProofs).toContain("work-context-receipt")
  })

  // No proof substitution: a different signal cannot stand in for one that did not run.
  it("refuses substitution of a review or another check for an unexecuted proof", () => {
    const checks = [
      check(REQUIRED[0], "CANCELLED"),
      ...allRequired("SUCCESS").slice(1),
      check("CodeRabbit", "SUCCESS"),
      check("Approved by reviewer", "SUCCESS"),
    ]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.blockingReasons.join(" ")).toContain("work-context-receipt")
  })

  it("refuses when the subject head is unbound", () => {
    const receipt = adjudicate(allRequired("SUCCESS"), "not-a-sha")
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.blockingReasons).toContain("SUBJECT_HEAD_SHA_UNBOUND")
  })

  it("refuses when the contract declares no required proofs", () => {
    const receipt = adjudicateMergeAdmission({
      contract: { contractId: "EMPTY", requiredProofs: [] },
      checks: allRequired("SUCCESS"),
      headSha: HEAD,
      adjudicatedAt: AT,
    })
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.blockingReasons).toContain("CONTRACT_DECLARES_NO_REQUIRED_PROOFS")
  })
})

describe("provider state classification preserves distinctions", () => {
  it("maps each provider state to a distinct execution state", () => {
    expect(classifyProofState(check("x", "SUCCESS"))).toBe(PROOF_STATE.SUCCEEDED)
    expect(classifyProofState(check("x", "SKIPPED"))).toBe(PROOF_STATE.SKIPPED)
    expect(classifyProofState(check("x", "NEUTRAL"))).toBe(PROOF_STATE.NEUTRAL)
    expect(classifyProofState(check("x", "CANCELLED"))).toBe(PROOF_STATE.CANCELLED)
    expect(classifyProofState(check("x", "TIMED_OUT"))).toBe(PROOF_STATE.TIMED_OUT)
    expect(classifyProofState(check("x", "IN_PROGRESS"))).toBe(PROOF_STATE.PENDING)
    expect(classifyProofState(check("x", "FAILURE"))).toBe(PROOF_STATE.FAILED)
    expect(classifyProofState(null)).toBe(PROOF_STATE.NOT_REPORTED)
  })

  it("never assumes an unrecognised provider state is benign", () => {
    expect(classifyProofState(check("x", "SOME_NEW_STATE"))).toBe(PROOF_STATE.FAILED)
  })
})

describe("receipt binds the decision to its inputs", () => {
  it("carries contract identity, contract hash and subject head", () => {
    const receipt = adjudicate(allRequired("SUCCESS"))
    expect(receipt.contractId).toBe("HERMES_MERGE_ADMISSION_V1")
    expect(receipt.contractHash).toMatch(/^[0-9a-f]{64}$/)
    expect(receipt.subjectHeadSha).toBe(HEAD)
  })

  it("changes contract hash when the required set changes", () => {
    const a = adjudicate(allRequired("SUCCESS")).contractHash
    const b = adjudicateMergeAdmission({
      contract: { ...contract, requiredProofs: (contract as any).requiredProofs.slice(1) },
      checks: allRequired("SUCCESS"), headSha: HEAD, adjudicatedAt: AT,
    }).contractHash
    expect(a).not.toBe(b)
  })
})
