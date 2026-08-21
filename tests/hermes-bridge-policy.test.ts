import { describe, expect, it } from "vitest"

import { evaluateOutcomePolicy } from "@/scripts/hermes-bridge/policy.mjs"
import { resolveHermesWorkContract } from "@/scripts/hermes-bridge/work-contract.mjs"

const outcome = { command: "Build a WilliamOS status UI", lane: "ui", risk: "low", authority: "A2_WRITE_OWN", verdict: "allow", requiresApproval: false, status: "classified" }
const evaluate = (value = outcome, override = {}) => evaluateOutcomePolicy({ outcome: value, actor: "bsvalues", repository: "bsvalues/terragroq", ...override })

describe("Hermes bridge outcome policy", () => {
  it.each(["docs", "ui", "read_model"])("allows bounded low-risk %s goals", (lane) => {
    expect(evaluate({ ...outcome, lane })).toMatchObject({ allowed: true, reasonCode: "POLICY_ALLOWED" })
  })

  it.each([
    "Change TerraFusion docs", "Launch TerraPilot", "Update Property Workbench", "Read county PACS parcel data",
    "Deploy to production", "Inspect a secret credential", "Inspect the session cookie handling in the UI",
    "Read a generic token", "Approve paid overage", "Delete all records",
    "Retry issue #357", "Retry #357",
    "Create a GitHub release and tag v1", "Push git tag v2.0.0",
  ])("blocks protected scope: %s", (command) => {
    expect(evaluate({ ...outcome, command })).toMatchObject({ allowed: false, reasonCode: "PROTECTED_SCOPE" })
  })

  it("fails closed on identity, kill switch, risk, lane, and authority", () => {
    expect(evaluate(outcome, { actor: "other" }).reasonCode).toBe("ACTOR_NOT_ALLOWED")
    expect(evaluate(outcome, { repository: "other/repo" }).reasonCode).toBe("REPOSITORY_NOT_ALLOWED")
    expect(evaluate(outcome, { killSwitch: true }).reasonCode).toBe("KILL_SWITCH_ACTIVE")
    expect(evaluate({ ...outcome, risk: "medium" }).reasonCode).toBe("RISK_NOT_ALLOWED")
    expect(evaluate({ ...outcome, lane: "write_model" }).reasonCode).toBe("LANE_NOT_ALLOWED")
    expect(evaluate({ ...outcome, authority: "A3_WRITE_SHARED" }).reasonCode).toBe("AUTHORITY_NOT_ALLOWED")
  })

  it("accepts an A2 approval classification only under the explicit standing grant", () => {
    const classified = { ...outcome, verdict: "requires_approval", requiresApproval: true }
    expect(evaluate(classified).reasonCode).toBe("VERDICT_NOT_ALLOWED")
    expect(evaluate(classified, { standingAuthority: true })).toMatchObject({
      allowed: true, reasonCode: "POLICY_ALLOWED",
    })
  })

  it("allows operator-objective only through the exact verified #911 Workbench contract", () => {
    const command = "record structured #911 reliability remediation without host mutation"
    const contract = resolveHermesWorkContract({
      command, title: command, objective: command,
      lane: "operator-objective", risk: "R1", authority: "A2_WRITE_OWN",
    })
    const parent = {
      ...outcome, id: 7, outcomeKey: "goal:GOAL-0007", command, title: command,
      objective: command, lane: "operator-objective", risk: "R1",
      queueBinding: { outcomeKey: "goal:GOAL-0007" },
      verifiedQueueWorkContract: {
        contract,
        provenance: {
          operation: "workbench_execution.authorize", outcomeKey: "goal:GOAL-0007",
          workOrderRef: "WO-HERMES-OUTCOME-7",
        },
      },
    }
    expect(evaluate(parent, { standingAuthority: true })).toMatchObject({
      allowed: true, reasonCode: "POLICY_ALLOWED",
    })
    expect(evaluate({ ...parent, verifiedQueueWorkContract: undefined }, { standingAuthority: true }))
      .toMatchObject({ allowed: false, reasonCode: "LANE_NOT_ALLOWED" })
    expect(evaluate({
      ...parent,
      verifiedQueueWorkContract: {
        ...parent.verifiedQueueWorkContract,
        contract: { ...contract!, digest: "0".repeat(64) },
      },
    }, { standingAuthority: true })).toMatchObject({ allowed: false, reasonCode: "LANE_NOT_ALLOWED" })
  })
})
