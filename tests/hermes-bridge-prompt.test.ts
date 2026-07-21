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
    expect(prompt).toContain("pull request")
    expect(prompt).toContain("Never ask William")
    expect(prompt).toContain("issue #357")
    expect(prompt).toContain("Do not modify or stage .obsidian/")
  })

  it("rejects missing authority and empty reservations", () => {
    expect(() => buildHermesCodexPrompt({ ...packet, outcomeRef: "" })).toThrow("HERMES_PROMPT_OUTCOME_REF_WALL")
    expect(() => buildHermesCodexPrompt({ ...packet, reservations: [] })).toThrow("HERMES_PROMPT_RESERVATIONS_WALL")
  })

  it("requires a closed, machine-readable completion shape", () => {
    expect(HERMES_TURN_OUTPUT_SCHEMA.additionalProperties).toBe(false)
    expect(HERMES_TURN_OUTPUT_SCHEMA.required).toContain("ownerTouchCount")
    expect(HERMES_TURN_OUTPUT_SCHEMA.required).toContain("blockedScopeCrossed")
  })
})
