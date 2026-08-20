import { describe, expect, it } from "vitest"

import { deriveRemediationWorkOrder, withinReservation } from "../scripts/runtime-operator/derive-remediation.mjs"

/**
 * #911 caught the loop equating "I found the next work" with "ask the owner whether to do it". These
 * cases are that issue: a finding, an authorised objective, and the question of whether the system may
 * act on its own.
 */
const OBJECTIVE = {
  workOrderId: "WO-0031",
  grantRef: "GRANT-0018",
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
})

describe("the six gates still stop it dead", () => {
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
