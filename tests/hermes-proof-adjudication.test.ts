import { describe, expect, it } from "vitest"

import {
  ADMISSION,
  PROOF_STATE,
  adjudicateMergeAdmission,
  classifyProofState,
  parseContract,
} from "../scripts/hermes-bridge/proof-adjudication.mjs"
import contract from "../config/hermes-bridge/required-proof-set.json"

const HEAD = "3b5dae61fbfa4c0dc5c86f000f7a0d6d1088d6d7"
const AT = "2026-08-25T00:00:00.000Z"

const REQUIRED = [
  { name: "work context receipt (#831)", workflowName: "work context" },
  { name: "vitest (deterministic suite)", workflowName: "ci" },
  { name: "production build (next build)", workflowName: "ci" },
]

// Proof identity is (kind, workflowName, name) -- never the display name alone.
const check = (
  name: string,
  conclusion: string,
  opts: { kind?: string; workflowName?: string } = {},
) => ({
  __typename: opts.kind ?? "CheckRun",
  name,
  workflowName: opts.workflowName ?? "ci",
  conclusion,
})

const required = (i: number, conclusion: string) =>
  check(REQUIRED[i].name, conclusion, { workflowName: REQUIRED[i].workflowName })

const allRequired = (conclusion: string) => REQUIRED.map((_, i) => required(i, conclusion))

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
    const checks = [required(0, "SKIPPED"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.nonExecutedProofs).toContainEqual({
      proofId: "work-context-receipt", state: PROOF_STATE.SKIPPED,
    })
  })

  it("refuses a neutral required proof", () => {
    const checks = [required(0, "NEUTRAL"), ...allRequired("SUCCESS").slice(1)]
    expect(adjudicate(checks).verdict).toBe(ADMISSION.INADMISSIBLE)
  })

  it("refuses a cancelled required proof", () => {
    const checks = [required(0, "CANCELLED"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.blockingReasons.join(" ")).toContain("DID_NOT_EXECUTE")
  })

  it("refuses a pending required proof", () => {
    const checks = [required(0, "IN_PROGRESS"), ...allRequired("SUCCESS").slice(1)]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.pendingProofs).toContain("work-context-receipt")
  })

  it("refuses a failed required proof", () => {
    const checks = [required(0, "FAILURE"), ...allRequired("SUCCESS").slice(1)]
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
      required(0, "SUCCESS"),
      required(0, "FAILURE"),
      ...allRequired("SUCCESS").slice(1),
    ]
    const receipt = adjudicate(checks)
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.ambiguousProofs).toContain("work-context-receipt")
  })

  // No proof substitution: a different signal cannot stand in for one that did not run.
  it("refuses substitution of a review or another check for an unexecuted proof", () => {
    const checks = [
      required(0, "CANCELLED"),
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
    expect(receipt.blockingReasons).toContain("CONTRACT_INVALID:CONTRACT_DECLARES_NO_REQUIRED_PROOFS")
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

// Review finding 1: the contract must fail CLOSED. Silently filtering a malformed entry would let a
// typo delete a required proof -- fail-open in the component built to fail closed.
describe("contract validation fails closed", () => {
  const withProofs = (requiredProofs: unknown[]) =>
    adjudicateMergeAdmission({
      contract: { contractId: "T", requiredProofs },
      checks: allRequired("SUCCESS"), headSha: HEAD, adjudicatedAt: AT,
    })

  it("refuses an entry missing proofId instead of dropping it", () => {
    const r = withProofs([{ kind: "CheckRun", workflowName: "ci", matchName: "x" }])
    expect(r.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(r.blockingReasons.join(" ")).toContain("ENTRY_MISSING_PROOF_ID")
  })

  it("refuses an entry missing matchName instead of dropping it", () => {
    const r = withProofs([{ proofId: "a", kind: "CheckRun", workflowName: "ci" }])
    expect(r.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(r.blockingReasons.join(" ")).toContain("ENTRY_MISSING_MATCH_NAME:a")
  })

  it("refuses an entry with an invalid kind", () => {
    const r = withProofs([{ proofId: "a", kind: "Whatever", workflowName: "ci", matchName: "x" }])
    expect(r.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(r.blockingReasons.join(" ")).toContain("ENTRY_INVALID_KIND:a")
  })

  it("refuses a CheckRun entry with no workflowName", () => {
    const r = withProofs([{ proofId: "a", kind: "CheckRun", matchName: "x" }])
    expect(r.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(r.blockingReasons.join(" ")).toContain("ENTRY_MISSING_WORKFLOW_NAME:a")
  })

  it("refuses duplicate proof ids", () => {
    const r = withProofs([
      { proofId: "a", kind: "CheckRun", workflowName: "ci", matchName: "x" },
      { proofId: "a", kind: "CheckRun", workflowName: "ci", matchName: "y" },
    ])
    expect(r.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(r.blockingReasons.join(" ")).toContain("DUPLICATE_PROOF_ID:a")
  })

  it("refuses two proof ids resolving to the same identity", () => {
    const r = withProofs([
      { proofId: "a", kind: "CheckRun", workflowName: "ci", matchName: "x" },
      { proofId: "b", kind: "CheckRun", workflowName: "CI", matchName: "X" },
    ])
    expect(r.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(r.blockingReasons.join(" ")).toContain("DUPLICATE_PROOF_IDENTITY:b")
  })

  it("reports every contract error rather than the first", () => {
    const { errors } = parseContract({ requiredProofs: [{}, {}] })
    expect(errors.length).toBeGreaterThan(2)
  })

  it("the shipped contract is valid", () => {
    expect(parseContract(contract).errors).toEqual([])
  })
})

// Review finding 2: display name is not identity. A different workflow, or a StatusContext sharing
// the name, must not be able to substitute for the real proof.
describe("required proof identity is (kind, workflowName, name)", () => {
  it("refuses a same-name CheckRun from a different workflow", () => {
    const impostor = check(REQUIRED[0].name, "SUCCESS", { workflowName: "some-other-workflow" })
    const receipt = adjudicate([impostor, ...allRequired("SUCCESS").slice(1)])
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.missingProofs).toContain("work-context-receipt")
  })

  it("refuses a same-name StatusContext standing in for a CheckRun proof", () => {
    const impostor = check(REQUIRED[0].name, "SUCCESS", { kind: "StatusContext" })
    const receipt = adjudicate([impostor, ...allRequired("SUCCESS").slice(1)])
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.missingProofs).toContain("work-context-receipt")
  })

  it("refuses a check carrying no resolvable kind", () => {
    const receipt = adjudicate([
      { name: REQUIRED[0].name, workflowName: "work context", conclusion: "SUCCESS" },
      ...allRequired("SUCCESS").slice(1),
    ])
    expect(receipt.verdict).toBe(ADMISSION.INADMISSIBLE)
    expect(receipt.missingProofs).toContain("work-context-receipt")
  })

  it("treats a same-name impostor as optional assurance, never as the required proof", () => {
    const impostor = check(REQUIRED[1].name, "SUCCESS", { workflowName: "not-ci" })
    const receipt = adjudicate([...allRequired("SUCCESS"), impostor])
    expect(receipt.verdict).toBe(ADMISSION.ADMISSIBLE)
    expect(receipt.optionalAssurance.map((o: any) => o.name)).toContain(REQUIRED[1].name)
  })
})
