import { describe, expect, it } from "vitest"

import { classifyProposedAction, ownerFacingState } from "../scripts/runtime-operator/owner-gate-policy.mjs"

/**
 * The cases are #911's actual change set, because that is the issue where the defect was caught: the
 * inventory was complete, the ordering was justified, and the system still stopped at "awaiting your
 * direction" for decisions policy already answered.
 *
 * If this policy cannot answer those five items, it has not fixed anything.
 */
describe("#911's change set, classified", () => {
  it("item 1 — reconcile compose with the running container — proceeds without the owner", () => {
    // Restoring a declared runtime invariant that has drifted. Reversible, inside the objective, and
    // urgent precisely because it fails silently: recreating ollama swaps its network and model store.
    const verdict = classifyProposedAction({
      summary: "reconcile docker-compose with the running ollama container",
      effects: { destroys: [], irreversible: false },
    })
    expect(verdict.gated).toBe(false)
    expect(ownerFacingState(verdict)).toBe("Working · proceeding automatically · no action required")
  })

  it("item 2 — investigating whether williamos-sea has another copy — proceeds without the owner", () => {
    // Looking is never gated. Hermes should establish the fact itself rather than asking.
    const verdict = classifyProposedAction({
      summary: "determine whether williamos-sea exists anywhere else",
      effects: { destroys: [] },
    })
    expect(verdict.gated).toBe(false)
  })

  it("but moving williamos-sea before a copy is confirmed does stop", () => {
    const verdict = classifyProposedAction({
      summary: "relocate williamos-sea to F:",
      effects: { destroys: [{ path: "D:/williamos-sea", verifiedCopyElsewhere: false }] },
    })
    expect(verdict.gated).toBe(true)
    expect(verdict.gate).toBe("DESTRUCTIVE")
    expect(verdict.unverified).toEqual(["D:/williamos-sea"])
  })

  it("item 3 — relocating the pinned service paths — stops, because it amends a reviewed policy", () => {
    // Not because moving files is dangerous, but because the invoker validates against the policy that
    // pins them. Moving without amending breaks the lane; amending is a policy choice.
    const verdict = classifyProposedAction({
      summary: "move HermesServices and HermesWorkspaces to F: and amend the pinned paths",
      effects: { changesReviewedPolicy: true, destroys: [] },
    })
    expect(verdict.gated).toBe(true)
    expect(verdict.gate).toBe("POLICY")
  })

  it("item 4 — retiring stale duplicates — proceeds once the copies are verified, and not before", () => {
    const unverified = classifyProposedAction({
      summary: "delete D:/HermesBackups",
      effects: { destroys: [{ path: "D:/HermesBackups", verifiedCopyElsewhere: false }] },
    })
    expect(unverified.gated).toBe(true)
    expect(unverified.gate).toBe("DESTRUCTIVE")

    // F:\lab-backups holds copies two and eight days newer. Verified, so this is cleanup.
    const verified = classifyProposedAction({
      summary: "delete D:/HermesBackups",
      effects: { destroys: [{ path: "D:/HermesBackups", verifiedCopyElsewhere: true }] },
    })
    expect(verified.gated).toBe(false)
  })

  it("item 5 — leaving pilot0 alone — is not an action and needs nothing", () => {
    expect(classifyProposedAction({ summary: "leave pilot0", effects: {} }).gated).toBe(false)
  })
})

describe("the canonical gates, and only those", () => {
  const cases = [
    ["FINANCIAL", { spendsMoney: true }],
    ["CREDENTIALS", { touchesCredentials: true }],
    ["POLICY", { changesReviewedPolicy: true }],
    ["SCOPE", { outsideObjectiveScope: true }],
    ["PRIORITY", { competesWithPriority: true }],
    ["DESTRUCTIVE", { irreversible: true }],
  ] as const

  for (const [gate, effects] of cases) {
    it(`stops for ${gate}`, () => {
      const verdict = classifyProposedAction({ summary: gate, effects })
      expect(verdict.gated).toBe(true)
      expect(verdict.gate).toBe(gate)
      expect(ownerFacingState(verdict)).toMatch(/^Blocked · owner decision required: /)
    })
  }

  it("does not invent a seventh gate for ordinary engineering", () => {
    const verdict = classifyProposedAction({
      summary: "implement, review, test, merge",
      effects: { destroys: [], irreversible: false, spendsMoney: false },
    })
    expect(verdict.gated).toBe(false)
    expect(verdict.gate).toBeNull()
  })

  it("reports every gate it hit, not only the first", () => {
    const verdict = classifyProposedAction({
      summary: "buy a disk and change the policy",
      effects: { spendsMoney: true, changesReviewedPolicy: true },
    })
    expect(verdict.gates).toEqual(["FINANCIAL", "POLICY"])
  })

  // Omitted from the first draft, which named six gates from memory. The playbook is the authority:
  // "protected, production, destructive, financial, legal, credential, or scope-expanding".
  it("honours the canonical categories an earlier draft dropped", () => {
    expect(classifyProposedAction({ effects: { mutatesProductionData: true } }).gate).toBe("PRODUCTION")
    expect(classifyProposedAction({ effects: { releaseOrCutover: true } }).gate).toBe("PRODUCTION")
    expect(classifyProposedAction({ effects: { protectedResource: true } }).gate).toBe("PROTECTED")
    expect(classifyProposedAction({ effects: { unresolvedLegalPrivacyOrSecurityRisk: true } }).gate).toBe("LEGAL")
  })

  it("treats a malformed flag as set, because a caller that cannot state a boolean has not stated it", () => {
    expect(classifyProposedAction({ effects: { spendsMoney: "maybe" } }).gated).toBe(true)
  })

  it("refuses a malformed destroys declaration instead of degrading it to nothing", () => {
    // This shape previously became [] and skipped the destruction gate entirely.
    for (const destroys of ["D:/HermesData", 7, { path: "D:/x" }]) {
      const verdict = classifyProposedAction({ effects: { destroys } })
      expect(verdict.gate).toBe("DESTRUCTIVE")
      expect(verdict.unclassifiable).toBe(true)
    }
  })

  it("refuses a destroy target that is not an object or omits the verification flag", () => {
    expect(classifyProposedAction({ effects: { destroys: ["D:/x"] } }).gate).toBe("DESTRUCTIVE")
    expect(classifyProposedAction({ effects: { destroys: [{ path: "D:/x" }] } }).gate).toBe("DESTRUCTIVE")
    expect(classifyProposedAction({ effects: { destroys: [{ path: "D:/x", verifiedCopyElsewhere: "yes" }] } }).gate).toBe("DESTRUCTIVE")
  })
})

describe("an action that cannot describe itself", () => {
  it("stops rather than defaulting to harmless", () => {
    // The dangerous default is not "gated"; it is a silent pass for something nobody characterised.
    for (const action of [undefined, {}, { summary: "do the thing" }, { effects: null }, { effects: [] }, { effects: "none" }]) {
      const verdict = classifyProposedAction(action)
      expect(verdict.gated).toBe(true)
      expect(verdict.unclassifiable).toBe(true)
    }
  })

  it("says so plainly rather than naming a gate it did not really hit", () => {
    expect(classifyProposedAction({}).reason).toContain("declared no readable effects")
  })
})
