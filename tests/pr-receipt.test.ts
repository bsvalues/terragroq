import { describe, expect, it } from "vitest"

import { parseDeclaredReceipt, reviewPullRequestReceipt } from "../lib/governance/pr-receipt"
import { receiptToken, type WorkContextFacts } from "../lib/governance/work-context-receipt"

const DOCTRINE = "d".repeat(64)

const facts: WorkContextFacts = {
  mainSha: "6f0e1022aa11bb22cc33dd44ee55ff6677889900",
  workOrderRef: "WO-831-REVIEWER",
  parentOutcome: "OUTCOME-762",
  reservedPaths: ["lib/governance/"],
  authorityLevel: "A2_WRITE_OWN",
  doctrineDigest: DOCTRINE,
  existingSubsystem: "integrating",
  topologySource: "canonical-registry",
  collisions: [],
  remainingParentAcceptance: "usable cockpit still requires the four-node baseline",
  workOrderVersion: "w".repeat(64),
  grantVersion: "g".repeat(64),
  reservationVersion: "r".repeat(64),
}

function body(token: string, declared: WorkContextFacts = facts) {
  return [
    "Some ordinary pull request prose.",
    "",
    "```WORK_CONTEXT_RECEIPT",
    JSON.stringify({ token, facts: declared }, null, 2),
    "```",
  ].join("\n")
}

const valid = () => body(receiptToken(facts))

const green = {
  changedFiles: ["lib/governance/owner.ts"],
  mainMovedFiles: ["components/Chart.tsx"],
  liveDoctrineDigest: DOCTRINE,
}

describe("finding the receipt", () => {
  it("reads a fenced block", () => {
    expect(parseDeclaredReceipt(valid())?.facts.workOrderRef).toBe("WO-831-REVIEWER")
  })

  it("is not satisfied by prose that merely mentions one", () => {
    // "Mentions the word receipt" must never be enough; the body is written by humans and agents both.
    expect(parseDeclaredReceipt("I established a WORK_CONTEXT_RECEIPT before starting, honest.")).toBeNull()
  })

  it("rejects a malformed block rather than guessing at it", () => {
    expect(parseDeclaredReceipt("```WORK_CONTEXT_RECEIPT" + String.fromCharCode(10) + "{not json" + String.fromCharCode(10) + "```")).toBeNull()
  })
})

describe("reviewing a pull request", () => {
  it("admits a valid receipt whose reservation covers the diff", () => {
    expect(reviewPullRequestReceipt({ body: valid(), ...green })).toEqual({ ok: true })
  })

  it("admits an exact reserved markdown file without treating the extension as doctrine", () => {
    const markdownFacts = {
      ...facts,
      reservedPaths: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
    }
    expect(reviewPullRequestReceipt({
      body: body(receiptToken(markdownFacts), markdownFacts),
      changedFiles: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
      mainMovedFiles: [],
      liveDoctrineDigest: DOCTRINE,
    })).toEqual({ ok: true })
  })

  it.each([
    "docs/reports/WO-OUTCOME-762-911-runtime-reliability-notes.md",
    "docs/reports/WO-OUTCOME-762-911-runtime-reliability.md.bak",
    "docs/governance/multi-agent-operator-playbook.md",
  ])("does not widen an exact markdown reservation to %s", (changedFile) => {
    const markdownFacts = {
      ...facts,
      reservedPaths: ["docs/reports/WO-OUTCOME-762-911-runtime-reliability.md"],
    }
    const verdict = reviewPullRequestReceipt({
      body: body(receiptToken(markdownFacts), markdownFacts),
      changedFiles: [changedFile],
      mainMovedFiles: [],
      liveDoctrineDigest: DOCTRINE,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_SCOPE_ESCAPE")
    expect(verdict.detail).toContain(changedFile)
  })

  it("rejects a pull request with no receipt, however green it is", () => {
    // This is acceptance criterion 8 of #831, and the entire point: tests passing is not a premise.
    const verdict = reviewPullRequestReceipt({ body: "Looks good, all tests pass.", ...green })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_CONTEXT_NOT_PROVEN")
    expect(verdict.recovery).toBeTruthy()
  })

  it("rejects a token that was never issued for the declared claims", () => {
    const verdict = reviewPullRequestReceipt({ body: body("0".repeat(64)), ...green })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_RECEIPT_MISMATCH")
  })

  it("fails a legacy v1 declaration closed instead of crashing the validator", () => {
    const { workOrderVersion: _work, grantVersion: _grant, reservationVersion: _reservation, ...legacy } = facts
    const verdict = reviewPullRequestReceipt({ body: body("0".repeat(64), legacy as WorkContextFacts), ...green })
    expect(verdict).toMatchObject({ ok: false, failure: "FAILED_RECEIPT_MISMATCH" })
  })

  it("catches claims edited after issuance", () => {
    // A lane widening its own reservation after the fact is exactly the tamper this must see.
    const widened = { ...facts, reservedPaths: ["lib/", "app/"] }
    const verdict = reviewPullRequestReceipt({ body: body(receiptToken(facts), widened), ...green })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_RECEIPT_MISMATCH")
  })

  it("survives unrelated churn on main", () => {
    const verdict = reviewPullRequestReceipt({
      body: valid(),
      changedFiles: ["lib/governance/owner.ts"],
      mainMovedFiles: ["components/Chart.tsx", "README.md", "app/page.tsx"],
      liveDoctrineDigest: DOCTRINE,
    })
    expect(verdict.ok).toBe(true)
  })

  it("goes stale when main moved inside the reservation, and names the file", () => {
    const verdict = reviewPullRequestReceipt({
      body: valid(),
      changedFiles: ["lib/governance/owner.ts"],
      mainMovedFiles: ["lib/governance/authority.ts"],
      liveDoctrineDigest: DOCTRINE,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_STALE_MAIN")
    expect(verdict.detail).toContain("lib/governance/authority.ts")
  })

  it("goes stale when the doctrine moved, and says so rather than blaming the token", () => {
    const verdict = reviewPullRequestReceipt({ ...green, body: valid(), liveDoctrineDigest: "e".repeat(64) })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_STALE_MAIN")
    expect(verdict.detail).toContain("doctrine")
  })

  it("rejects a diff that escapes the declared reservation", () => {
    const verdict = reviewPullRequestReceipt({
      body: valid(),
      changedFiles: ["lib/governance/owner.ts", "scripts/deploy-hermes-runtime.ps1"],
      mainMovedFiles: [],
      liveDoctrineDigest: DOCTRINE,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_SCOPE_ESCAPE")
    expect(verdict.detail).toContain("scripts/deploy-hermes-runtime.ps1")
  })

  it("carries a recovery route on every refusal, so no failure becomes an owner question", () => {
    const refusals = [
      reviewPullRequestReceipt({ body: null, ...green }),
      reviewPullRequestReceipt({ body: body("0".repeat(64)), ...green }),
      reviewPullRequestReceipt({ ...green, body: valid(), liveDoctrineDigest: "e".repeat(64) }),
    ]
    for (const refusal of refusals) {
      expect(refusal.ok).toBe(false)
      expect(refusal.recovery).toBeTruthy()
    }
  })
})

describe("scope check accepts the readonly reservation type it is actually given (#930 build break)", () => {
  // work-context-receipt types reservedPaths as `readonly string[]`, and #930 began passing it
  // straight into the scope check. The parameter was `string[]`, so `next build` stopped compiling
  // while vitest stayed green -- CI has no build step. This locks the runtime contract; the build
  // gate added in ci.yml locks the type. A frozen array is the strongest readonly witness.
  const readonlyFacts: WorkContextFacts = { ...facts, reservedPaths: Object.freeze(["lib/governance/"]) as readonly string[] }
  it("permits a changed file inside a frozen reservation", () => {
    const verdict = reviewPullRequestReceipt({
      body: body(receiptToken(readonlyFacts), readonlyFacts),
      changedFiles: ["lib/governance/owner.ts"],
      mainMovedFiles: ["components/Chart.tsx"],
      liveDoctrineDigest: DOCTRINE,
    })
    expect(verdict.ok).toBe(true)
  })
  it("still catches a file outside the frozen reservation", () => {
    const verdict = reviewPullRequestReceipt({
      body: body(receiptToken(readonlyFacts), readonlyFacts),
      changedFiles: ["app/secret.ts"],
      mainMovedFiles: ["components/Chart.tsx"],
      liveDoctrineDigest: DOCTRINE,
    })
    expect(verdict.ok).toBe(false)
    expect(verdict.failure).toBe("FAILED_SCOPE_ESCAPE")
  })
})
