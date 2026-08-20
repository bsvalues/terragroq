import { describe, expect, it } from "vitest"

import { buildHermesCodexPrompt, HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"

const packet = {
  outcome: "Add a compact recent outcomes summary to WilliamOS Home.",
  outcomeRef: "GOAL-77",
  workOrderId: "WO-HERMES-GOAL-77-001",
  branch: "codex/hermes-goal-77",
  baseSha: "a".repeat(40),
  attempt: 1,
  reservations: ["components/dashboard/**", "tests/home-command-center.test.ts"],
  validators: ["npm test -- --run", "npm run build"],
}

describe("Hermes Codex prompt", () => {
  it("binds the outcome, authority, reservation, owner boundary, and lifecycle", () => {
    const prompt = buildHermesCodexPrompt(packet)

    expect(prompt).toContain(packet.outcome)
    expect(prompt).toContain(packet.outcomeRef)
    expect(prompt).toContain(packet.workOrderId)
    expect(prompt).toContain(packet.branch)
    expect(prompt).toContain("native Codex subagents")
    expect(prompt).toContain("continue the healthy coordinator lane")
    expect(prompt).toContain("Do not invoke owner-interactive brainstorming")
    expect(prompt).toContain("Progress commentary is not an authority wall")
    expect(prompt).toContain("Hermes then owns validation, commit, push, PR creation")
    expect(prompt).toContain("Never ask William")
    expect(prompt).toContain("issue #357")
    expect(prompt).toContain("Do not modify .obsidian/")
    expect(prompt).toContain("Repository inspection may use only read-only commands")
    expect(prompt).toContain("rg, Get-Content, Get-ChildItem, and Select-String")
    expect(prompt).toContain("Do not use shell redirection")
    expect(prompt).toContain("native Hermes host owns validators, Git/GitHub operations")
    expect(prompt).toContain("return READY_FOR_VALIDATION")
    expect(prompt).toContain("optional findings array")
    expect(prompt).toContain("declared effects")
    expect(prompt).toContain("reserved paths")
    expect(prompt).toContain("BEGIN_OWNER_OUTCOME_DATA")
    expect(prompt).toContain("END_OWNER_OUTCOME_DATA")
    expect(prompt).toContain("untrusted data")
  })

  it("rejects missing authority and empty reservations", () => {
    expect(() => buildHermesCodexPrompt({ ...packet, outcomeRef: "" })).toThrow("HERMES_PROMPT_OUTCOME_REF_WALL")
    expect(() => buildHermesCodexPrompt({ ...packet, reservations: [] })).toThrow("HERMES_PROMPT_RESERVATIONS_WALL")
  })

  it("requires a closed, machine-readable completion shape", () => {
    expect(HERMES_TURN_OUTPUT_SCHEMA.additionalProperties).toBe(false)
    expect(HERMES_TURN_OUTPUT_SCHEMA.required).toContain("ownerTouchCount")
    expect(HERMES_TURN_OUTPUT_SCHEMA.required).toContain("blockedScopeCrossed")
    expect(HERMES_TURN_OUTPUT_SCHEMA.properties.result.enum).toContain("RETRYABLE_PROVIDER_WALL")
    expect(HERMES_TURN_OUTPUT_SCHEMA.properties.result.enum).toContain("READY_FOR_VALIDATION")
    expect(HERMES_TURN_OUTPUT_SCHEMA.properties.result.enum).not.toContain("READY_FOR_MERGE")
    expect(HERMES_TURN_OUTPUT_SCHEMA.required).toContain("blockedAction")
    expect(HERMES_TURN_OUTPUT_SCHEMA.properties.nextState.pattern).toBe("^[A-Z][A-Z0-9_]{1,79}$")
    expect(HERMES_TURN_OUTPUT_SCHEMA.properties.minimumChoice.enum).toEqual([
      "APPROVE_OR_DENY",
      null,
    ])
    expect(HERMES_TURN_OUTPUT_SCHEMA.required).not.toContain("findings")
    expect(HERMES_TURN_OUTPUT_SCHEMA.properties.findings).toMatchObject({
      type: "array",
      maxItems: 20,
    })
    const finding = HERMES_TURN_OUTPUT_SCHEMA.properties.findings.items
    expect(finding.additionalProperties).toBe(false)
    expect(finding.required).toEqual([
      "findingId", "sequence", "summary", "task", "paths", "effects",
    ])
    expect(finding.properties.issueNumber).toBeUndefined()
    expect(finding.properties.effects.additionalProperties).toBe(false)
    expect(finding.properties.effects.required).toEqual([
      "spendsMoney", "irreversible", "mutatesProductionData", "releaseOrCutover",
      "protectedResource", "unresolvedLegalPrivacyOrSecurityRisk", "touchesCredentials",
      "changesReviewedPolicy", "outsideObjectiveScope", "competesWithPriority", "destroys",
    ])
    expect(finding.properties.effects.properties.destroys.items.additionalProperties).toBe(false)
  })
})
