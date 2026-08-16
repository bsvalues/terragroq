import { describe, expect, it } from "vitest"

import { harvestTurnOutput, HERMES_FREE_AGENT_COMPLETE_PATTERN } from "../scripts/hermes-bridge/hermes-kernel-output.mjs"

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
