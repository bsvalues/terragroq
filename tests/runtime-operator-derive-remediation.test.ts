import { describe, expect, it } from "vitest"

import {
  deriveRemediationPlan,
  deriveRemediationWorkOrder,
  withinReservation,
} from "../scripts/runtime-operator/derive-remediation.mjs"

/**
 * #911 caught the loop equating "I found the next work" with "ask the owner whether to do it". These
 * cases are that issue: a finding, an authorised objective, and the question of whether the system may
 * act on its own.
 */
const OBJECTIVE = {
  workOrderId: "WO-0031",
  grantRef: "GRANT-0018",
  authority: "APPROVED",
  grantStatus: "active",
  adapterId: "williamos-resident-v1",
  allowedPaths: ["scripts/runtime-operator/**", "config/execution-fabric/**"],
  requiredValidation: ["test", "build"],
  agent: "codex",
}

const at = () => "2026-08-20T06:00:00.000Z"

describe("a finding that needs no owner", () => {
  it("becomes a dispatchable work order under the objective's own grant", () => {
    const { dispatch, gate } = deriveRemediationWorkOrder({
      objective: OBJECTIVE,
      finding: {
        sequence: 1,
        summary: "reconcile compose with the running ollama container",
        paths: ["scripts/runtime-operator/williamos-adapters.mjs"],
        effects: { destroys: [], irreversible: false },
      },
      now: at,
    })
    expect(gate).toBeNull()
    expect(dispatch).toMatchObject({
      workOrderId: "WO-0031-R01",
      derivedFrom: "WO-0031",
      grantRef: "GRANT-0018",
      ownerGateRequired: false,
    })
  })

  it("inherits authority rather than minting it", () => {
    const { dispatch } = deriveRemediationWorkOrder({
      objective: OBJECTIVE,
      finding: { summary: "fix drift", paths: ["scripts/runtime-operator/x.mjs"], effects: {} },
      now: at,
    })
    // The grant is the objective's. A derived order that invented its own would be self-issued authority.
    expect(dispatch?.grantRef).toBe(OBJECTIVE.grantRef)
    expect(dispatch?.authority).toBe("APPROVED")
  })
})

describe("discovery cannot widen its own scope", () => {
  it("refuses a finding that names a path outside the reservation", () => {
    const { dispatch, gate } = deriveRemediationWorkOrder({
      objective: OBJECTIVE,
      finding: {
        summary: "also fix the workbench",
        paths: ["scripts/runtime-operator/ok.mjs", "app/actions/workbench-threads.ts"],
        effects: {},
      },
      now: at,
    })
    expect(dispatch).toBeNull()
    expect(gate?.gate).toBe("SCOPE")
    expect(gate?.escapingPaths).toEqual(["app/actions/workbench-threads.ts"])
  })

  it("does not believe a finding that declares itself in scope while escaping it", () => {
    const { gate } = deriveRemediationWorkOrder({
      objective: OBJECTIVE,
      finding: {
        summary: "trust me",
        paths: ["lib/db.ts"],
        effects: { outsideObjectiveScope: false },
      },
      now: at,
    })
    expect(gate?.gated).toBe(true)
  })

  it("refuses when there is no authorised objective to inherit from", () => {
    const { dispatch, gate } = deriveRemediationWorkOrder({
      objective: { workOrderId: "WO-X", allowedPaths: [] },
      finding: { summary: "anything", paths: [], effects: {} },
      now: at,
    })
    expect(dispatch).toBeNull()
    expect(gate?.reason).toContain("no authorised objective")
  })

  // The first draft checked only that a grantRef existed. A revoked or unapproved parent could
  // therefore mint an APPROVED child, which is authority laundering by inheritance.
  it("refuses to descend from a revoked, expired, or unapproved parent", () => {
    const finding = { summary: "fix", paths: ["scripts/runtime-operator/a.mjs"], effects: {} }
    for (const [override, fragment] of [
      [{ grantStatus: "revoked" }, "revoked"],
      [{ grantStatus: undefined }, "unstated status"],
      [{ authority: "PENDING" }, "not APPROVED"],
      [{ authority: undefined }, "unstated"],
      [{ grantExpiresAt: "2020-01-01T00:00:00.000Z" }, "expired"],
    ] as const) {
      const { dispatch, gate } = deriveRemediationWorkOrder({
        objective: { ...OBJECTIVE, ...override }, finding, now: at,
      })
      expect(dispatch).toBeNull()
      expect(gate?.reason).toContain(fragment)
    }
  })

  it("fails closed when the finding declares no effects, instead of normalising them away", () => {
    // The first draft spread `finding.effects ?? {}`, which turned the classifier's fail-closed
    // behaviour into a silent pass. A gate you build and then normalise around is not a gate.
    for (const finding of [
      { summary: "no effects", paths: ["scripts/runtime-operator/a.mjs"] },
      { summary: "null effects", paths: ["scripts/runtime-operator/a.mjs"], effects: null },
      { summary: "array effects", paths: ["scripts/runtime-operator/a.mjs"], effects: [] },
    ]) {
      const { dispatch, gate } = deriveRemediationWorkOrder({ objective: OBJECTIVE, finding, now: at })
      expect(dispatch).toBeNull()
      expect(gate?.unclassifiable).toBe(true)
    }
  })
})

describe("the canonical gates still stop it dead", () => {
  it("refuses to derive work that destroys an unverified copy", () => {
    const { dispatch, gate } = deriveRemediationWorkOrder({
      objective: OBJECTIVE,
      finding: {
        summary: "delete the stale store",
        paths: ["scripts/runtime-operator/cleanup.mjs"],
        effects: { destroys: [{ path: "D:/HermesData", verifiedCopyElsewhere: false }] },
      },
      now: at,
    })
    expect(dispatch).toBeNull()
    expect(gate?.gate).toBe("DESTRUCTIVE")
  })

  it("refuses to derive work that amends a reviewed policy", () => {
    const { gate } = deriveRemediationWorkOrder({
      objective: OBJECTIVE,
      finding: {
        summary: "repin the service paths",
        paths: ["config/execution-fabric/hermes-free-dev-agent-v2.policy.json"],
        effects: { changesReviewedPolicy: true },
      },
      now: at,
    })
    expect(gate?.gate).toBe("POLICY")
  })
})

describe("reservation containment", () => {
  it("accepts a file inside a reserved subtree and rejects a near-miss", () => {
    expect(withinReservation("scripts/runtime-operator/a.mjs", ["scripts/runtime-operator/**"])).toBe(true)
    expect(withinReservation("scripts/runtime-operator-extra/a.mjs", ["scripts/runtime-operator/**"])).toBe(false)
  })

  it("treats a reserved file as exactly that file", () => {
    expect(withinReservation("lib/a.ts", ["lib/a.ts"])).toBe(true)
    expect(withinReservation("lib/ab.ts", ["lib/a.ts"])).toBe(false)
  })

  it("normalises separators so a Windows-shaped path is not a false escape", () => {
    expect(withinReservation("scripts\\runtime-operator\\a.mjs", ["scripts/runtime-operator/**"])).toBe(true)
  })
})

describe("a gated finding does not stall the ones beside it", () => {
  it("dispatches every ungated finding and reports each gate separately", () => {
    // #911 exactly: relocating pinned paths is the owner's call and must not hold up the compose
    // reconciliation sitting next to it, which needs nobody. Stopping at the first gate would
    // reintroduce the defect one layer down.
    const plan = deriveRemediationPlan({
      objective: OBJECTIVE,
      findings: [
        { sequence: 1, summary: "reconcile compose", paths: ["scripts/runtime-operator/a.mjs"], effects: {} },
        { sequence: 2, summary: "repin service paths", paths: ["config/execution-fabric/p.json"], effects: { changesReviewedPolicy: true } },
        { sequence: 3, summary: "investigate williamos-sea", paths: ["scripts/runtime-operator/b.mjs"], effects: {} },
      ],
      now: at,
    })
    expect(plan.dispatch.map((order) => order.workOrderId)).toEqual(["WO-0031-R01", "WO-0031-R03"])
    expect(plan.gated).toHaveLength(1)
    expect(plan.gated[0]).toMatchObject({ finding: "repin service paths", gate: "POLICY" })
  })

  it("returns nothing to do rather than throwing when there are no findings", () => {
    expect(deriveRemediationPlan({ objective: OBJECTIVE, findings: undefined, now: at }))
      .toEqual({ dispatch: [], gated: [] })
  })
})
