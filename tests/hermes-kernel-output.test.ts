import { describe, expect, it } from "vitest"

import { harvestTurnOutput, HERMES_FREE_AGENT_COMPLETE_PATTERN, validateAgainstTurnSchema } from "../scripts/hermes-bridge/hermes-kernel-output.mjs"
import { HERMES_TURN_OUTPUT_SCHEMA } from "../scripts/hermes-bridge/prompt.mjs"

const block = (body: string) => "```json\n" + body + "\n```"

describe("Hermes kernel output harvester", () => {
  it("returns the last fenced json object block as finalText", () => {
    const stdout = ["chatter", block('{"result":"A"}'), "more", block('{"result":"B","n":1}'), "HERMES_FREE_AGENT_COMPLETE runId=abc"].join("\n")
    expect(harvestTurnOutput(stdout)).toEqual({ ok: true, finalText: '{"result":"B","n":1}' })
  })
  it("accepts a bare final JSON object line when no fenced block exists", () => {
    expect(harvestTurnOutput('working...\n{"result":"READY_FOR_VALIDATION"}\n')).toEqual({ ok: true, finalText: '{"result":"READY_FOR_VALIDATION"}' })
  })
  it("fails closed on missing, invalid, or non-object output", () => {
    expect(harvestTurnOutput("nothing here")).toEqual({ ok: false, reason: "NO_JSON_BLOCK" })
    expect(harvestTurnOutput(block("{not json"))).toEqual({ ok: false, reason: "INVALID_JSON" })
    expect(harvestTurnOutput(block("[1,2]"))).toEqual({ ok: false, reason: "NOT_AN_OBJECT" })
    expect(harvestTurnOutput("")).toEqual({ ok: false, reason: "NO_JSON_BLOCK" })
  })
  it("tolerates CRLF and a language tag with trailing spaces", () => {
    expect(harvestTurnOutput("```json  \r\n{\"a\":1}\r\n```\r\n")).toEqual({ ok: true, finalText: '{"a":1}' })
  })
  it("recognises the invoker completion line", () => {
    expect(HERMES_FREE_AGENT_COMPLETE_PATTERN.test("HERMES_FREE_AGENT_COMPLETE runId=0123abcd workspace=D:\\x")).toBe(true)
    expect(HERMES_FREE_AGENT_COMPLETE_PATTERN.test("HERMES_FREE_AGENT_QUARANTINED")).toBe(false)
  })
})

const complete = (overrides: Record<string, unknown> = {}) => ({
  result: "READY_FOR_VALIDATION", workOrder: "WO-1", branch: "codex/x", commit: null, prUrl: null,
  merged: false, mergeCommit: null, validation: ["pass"], reviewThreads: 0, ownerTouchCount: 0,
  blockedScopeCrossed: false, nextState: "READY_FOR_HERMES_MERGE", blockedAction: null,
  authorityBoundary: null, minimumChoice: null, approveConsequence: null, denyConsequence: null,
  ...overrides,
})

describe("Hermes turn output schema check", () => {
  it("accepts a schema-complete turn object, including its nullable and enum members", () => {
    expect(validateAgainstTurnSchema(complete(), HERMES_TURN_OUTPUT_SCHEMA)).toEqual({ ok: true })
    expect(validateAgainstTurnSchema(complete({ commit: "a".repeat(40), minimumChoice: "APPROVE_OR_DENY", result: "OWNER_DECISION_REQUIRED" }), HERMES_TURN_OUTPUT_SCHEMA)).toEqual({ ok: true })
  })
  it("names the first structural failure it finds", () => {
    const cases: Array<[unknown, string]> = [
      [(() => { const value = complete() as any; delete value.nextState; return value })(), "SCHEMA:MISSING:nextState"],
      [complete({ extra: 1 }), "SCHEMA:ADDITIONAL:extra"],
      [complete({ result: "NOPE" }), "SCHEMA:result:ENUM"],
      [complete({ nextState: "lower" }), "SCHEMA:nextState:PATTERN"],
      [complete({ merged: "false" }), "SCHEMA:merged:TYPE"],
      [complete({ reviewThreads: 1.5 }), "SCHEMA:reviewThreads:TYPE"],
      [complete({ reviewThreads: -1 }), "SCHEMA:reviewThreads:MINIMUM"],
      [complete({ validation: "pass" }), "SCHEMA:validation:TYPE"],
      [complete({ validation: [1] }), "SCHEMA:validation[0]:TYPE"],
      [complete({ commit: 7 }), "SCHEMA:commit:TYPE"],
      [[], "SCHEMA:NOT_AN_OBJECT"],
      [null, "SCHEMA:NOT_AN_OBJECT"],
    ]
    for (const [value, reason] of cases) {
      expect(validateAgainstTurnSchema(value, HERMES_TURN_OUTPUT_SCHEMA), reason).toEqual({ ok: false, reason })
    }
    expect(validateAgainstTurnSchema(complete(), null)).toEqual({ ok: false, reason: "SCHEMA:NO_SCHEMA" })
  })
})
