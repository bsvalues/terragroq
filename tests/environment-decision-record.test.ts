import { describe, expect, it } from "vitest"

import {
  classifyDecisionRecord,
  classifySupersedingDecision,
  composeDecisionRecorded,
  composeDecisionSuperseded,
} from "@/lib/environment/decision-intent"

/**
 * Recording a decision from the Line — the capability that had to exist before /decisions could be
 * deleted. Migrating a capability means the capability survives; deleting the ADR form without this
 * would have left the governance register read-only, which is capability loss wearing a burn-down
 * costume.
 *
 * This is a WRITE reached by typing a sentence, so accidental firing is the entire risk surface.
 */
describe("it records only an explicit, committal decision", () => {
  it.each([
    "record a decision: we standardise on Postgres for the queue",
    "log a decision: the claude lane is the default fallback",
    "capture a decision — evidence lives with the work order",
    "decision: the Environment owns the root route",
    "decide: retire the work-order form",
  ])("records: %j", (text) => {
    expect(classifyDecisionRecord(text)).not.toBeNull()
  })

  it("keeps the owner's whole sentence as the decision, and lifts the rationale", () => {
    const recorded = classifyDecisionRecord(
      "record a decision: we standardise on Postgres for the queue because pglite drifts under concurrency",
    )
    expect(recorded?.title).toBe("we standardise on Postgres for the queue")
    expect(recorded?.rationale).toBe("pglite drifts under concurrency")
    // The register should read the way the owner said it, not the way the parser chopped it.
    expect(recorded?.decision).toContain("because pglite drifts under concurrency")
  })

  it("truncates an overlong title without losing the decision text", () => {
    const long = `record a decision: ${"x".repeat(300)}`
    const recorded = classifyDecisionRecord(long)
    expect(recorded?.title.length).toBeLessThanOrEqual(120)
    expect(recorded?.decision.length).toBeGreaterThan(120)
  })
})

describe("it refuses anything that was only wondering aloud", () => {
  it.each([
    "should we record a decision about Postgres?",
    "should we record a decision about Postgres",
    "would you log a decision for this",
    "can I record a decision here",
    "what if we record a decision about the lane",
    "don't record a decision about this",
    "do we record decisions here",
    "how do I record a decision",
  ])("does not record: %j", (text) => {
    // A governance record must never be created by a sentence that was asking a question.
    expect(classifyDecisionRecord(text)).toBeNull()
  })

  it("does not record when the trigger is buried mid-sentence", () => {
    // Discussion ABOUT recording is not an instruction to record.
    expect(classifyDecisionRecord("the report says we should record a decision on this")).toBeNull()
    expect(classifyDecisionRecord("earlier I said record a decision but never did")).toBeNull()
  })

  it("does not record an empty or stub decision", () => {
    expect(classifyDecisionRecord("record a decision:")).toBeNull()
    expect(classifyDecisionRecord("decision: yes")).toBeNull()
    expect(classifyDecisionRecord("decide: ok")).toBeNull()
  })

  it("leaves ordinary sentences alone, including ones that mention decisions", () => {
    for (const text of [
      "show me the decisions",
      "continue the highest-priority work",
      "the decision register is empty",
      "what are we doing right now?",
      "",
    ]) expect(classifyDecisionRecord(text)).toBeNull()
  })
})

describe("it never claims authority it did not have", () => {
  it("states plainly that the record is proposed and advisory", () => {
    const recorded = classifyDecisionRecord("record a decision: the Line records decisions")!
    const say = composeDecisionRecorded("DECISION-0007", recorded)
    expect(say).toContain("DECISION-0007")
    expect(say).toMatch(/proposed and advisory/i)
    // Binding authority is minted by the governed path with evidence. A sentence typed into a
    // conversational input is not that, and the reply must not imply otherwise.
    expect(say).toMatch(/binding authority comes from the governed authorization path/i)
    expect(say).not.toMatch(/\bbinding\b(?!\s+authority comes)/i)
  })

  it("still reads honestly when no ref came back", () => {
    const recorded = classifyDecisionRecord("record a decision: something happened")!
    expect(composeDecisionRecorded(null, recorded)).toContain("the decision")
  })
})

/**
 * Supersession is what makes the register a register rather than a pile of notes: a replaced decision
 * must point at what replaced it. The retired ADR form was the only place this existed.
 */
describe("superseding an existing decision", () => {
  it("records the replacement and the decision it replaces", () => {
    const recorded = classifySupersedingDecision(
      "record a decision superseding DECISION-0007: the claude lane is the default fallback because codex exhausts",
    )
    expect(recorded?.supersedes).toBe("DECISION-0007")
    expect(recorded?.title).toBe("the claude lane is the default fallback")
    expect(recorded?.rationale).toBe("codex exhausts")
  })

  it.each([
    "decision superseding DECISION-0012: evidence lives with the work order",
    "log a decision that supersedes DECISION-0003: retire the form",
  ])("accepts the natural phrasings: %j", (text) => {
    expect(classifySupersedingDecision(text)).not.toBeNull()
  })

  it("requires an explicit reference and never guesses which decision was meant", () => {
    // Replacing the wrong decision is worse than replacing none.
    expect(classifySupersedingDecision("record a decision superseding the old one: use Postgres")).toBeNull()
    expect(classifySupersedingDecision("record a decision superseding DECISION-: use Postgres")).toBeNull()
  })

  it("refuses questions about superseding", () => {
    expect(classifySupersedingDecision("should we supersede DECISION-0007?")).toBeNull()
    expect(classifySupersedingDecision("can I supersede DECISION-0007")).toBeNull()
  })

  it("says the superseded decision is kept, not deleted", () => {
    const recorded = classifySupersedingDecision("decision superseding DECISION-0007: the lane is default")!
    const say = composeDecisionSuperseded("DECISION-0021", recorded)
    expect(say).toContain("DECISION-0021")
    expect(say).toContain("DECISION-0007")
    expect(say).toMatch(/stays in the register marked superseded rather than being deleted/i)
    expect(say).toMatch(/proposed and advisory/i)
  })
})
