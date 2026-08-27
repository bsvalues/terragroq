import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  classifyDecisionRecord,
  classifySupersedingDecision,
  mentionsSupersession,
  normalizeDecisionRef,
} from "@/lib/environment/decision-intent"

/**
 * Supersession from the Line, against the reference format the register ACTUALLY issues.
 *
 * The capability shipped addressed to `DECISION-0007`. Nothing has ever minted a `DECISION-` ref:
 * `nextRef()` mints `ADR-0001`, and the Desk's decision surface prints exactly that. So the owner
 * read `ADR-0007` off their own screen, typed it back, and the classifier saw no supersession at
 * all — the sentence fell through to plain recording, filed an unrelated decision titled
 * "superseding ADR-0007: …", and reported success. The register kept both records and no lineage.
 *
 * The original tests did not catch it because they were written against the same invented format,
 * which is why these assert against `app/actions/decisions.ts` rather than against a literal.
 */

const ROOT = process.cwd()
const ACTIONS = fs.readFileSync(path.join(ROOT, "app/actions/decisions.ts"), "utf8")
const LINE_ROUTE = fs.readFileSync(path.join(ROOT, "app/api/environment/line/route.ts"), "utf8")

describe("it addresses decisions by the reference the register mints", () => {
  it("mints ADR-#### and nothing else, which is what the classifier must accept", () => {
    // Read from the action, not asserted as a literal: if the register ever changes its reference
    // format again, this fails here rather than silently in front of the owner.
    expect(ACTIONS).toContain('return `ADR-${String(max + 1).padStart(4, "0")}`')
  })

  it("supersedes a decision named the way the register names it", () => {
    const recorded = classifySupersedingDecision(
      "record a decision superseding ADR-0007: the claude lane is the default fallback because codex exhausts",
    )
    expect(recorded?.supersedes).toBe("ADR-0007")
    expect(recorded?.title).toBe("the claude lane is the default fallback")
    expect(recorded?.rationale).toBe("codex exhausts")
  })

  it("refuses the reference format that never existed", () => {
    // Accepting DECISION-0007 would only restore the dead end: the lookup is an exact ref match, so
    // it would always miss and always answer "no decision with that reference is in the register".
    expect(classifySupersedingDecision("record a decision superseding DECISION-0007: use Postgres")).toBeNull()
  })

  it("finds ADR-0007 when the owner types ADR-7", () => {
    expect(normalizeDecisionRef("ADR-7")).toBe("ADR-0007")
    expect(normalizeDecisionRef("adr-0007")).toBe("ADR-0007")
    expect(classifySupersedingDecision("decision superseding adr-7: the lane is default")?.supersedes).toBe("ADR-0007")
  })
})

describe("a supersession it cannot resolve refuses instead of recording something else", () => {
  it.each([
    "record a decision superseding the old one: use Postgres for the queue",
    "record a decision superseding DECISION-0007: use Postgres for the queue",
    "decision superseding ADR-: use Postgres for the queue",
  ])("recognises the intent even when the reference is unusable: %j", (text) => {
    expect(classifySupersedingDecision(text)).toBeNull()
    expect(mentionsSupersession(text)).toBe(true)
  })

  it("still refuses anything that was only wondering aloud", () => {
    for (const text of [
      "should we record a decision superseding ADR-0007?",
      "can I record a decision superseding the old one",
    ]) expect(mentionsSupersession(text)).toBe(false)
  })

  it("does not claim supersession intent for an ordinary recording", () => {
    expect(mentionsSupersession("record a decision: we standardise on Postgres for the queue")).toBe(false)
    expect(mentionsSupersession("show me the decisions")).toBe(false)
  })

  it("would have recorded an unrelated decision without that refusal", () => {
    // The exact silent failure, pinned: the sentence IS a valid plain recording, which is why the
    // fall-through wrote a lineage-less record and called it a success.
    const wrong = classifyDecisionRecord("record a decision superseding the old one: use Postgres for the queue")
    expect(wrong).not.toBeNull()
    expect(wrong?.title).toContain("superseding the old one")
    // So the route must consult the intent BEFORE plain recording.
    expect(LINE_ROUTE.indexOf("mentionsSupersession(text)")).toBeLessThan(
      LINE_ROUTE.indexOf("} else if (classifyDecisionRecord(text)) {"),
    )
  })
})

describe("superseding from a sentence does not mint acceptance or inherit authority", () => {
  it("writes the replacement as proposed and advisory, the way the reply says it did", () => {
    // supersedeDecision's defaults are the governed FORM's defaults -- accepted, inheriting the
    // replaced decision's authority. From the Line those defaults made the reply false: the record
    // was accepted and possibly binding while the sentence said "proposed and advisory", and
    // getActiveDecisions() then fed it to the agent context injector as an active decision.
    const start = LINE_ROUTE.indexOf("await supersedeDecision(")
    expect(start).toBeGreaterThan(-1)
    const body = LINE_ROUTE.slice(start, LINE_ROUTE.indexOf("composeDecisionSuperseded(", start))
    expect(body).toContain('status: "proposed"')
    expect(body).toContain('authority: "advisory"')
  })

  it("keeps the accepted default for the governed path, which is not a typed sentence", () => {
    expect(ACTIONS).toContain('const status = input.status ?? "accepted"')
    // A proposal is not a decision, so it carries no decision date.
    expect(ACTIONS).toContain('decidedAt: status === "accepted" ? new Date() : null')
  })
})
