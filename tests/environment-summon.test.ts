import { describe, expect, it } from "vitest"

import { classifyDismissal, classifySummon } from "@/lib/environment/summon"

/**
 * Phase 3: Projects, Activity and the Inspector stop being applications and become surfaces the world
 * summons. The capabilities were never the problem — being PLACES was, because a product made of
 * places teaches everyone that WilliamOS is a website with sections.
 *
 * The discipline here was already paid for once in the identity classifier: a matcher that fires on
 * any appearance of a word does not help an operator, it hijacks their sentences.
 */
describe("summoning a surface instead of navigating to a page", () => {
  it.each([
    "show me the projects",
    "show TerraFusion projects",
    "what projects do we have?",
    "open the project registry",
    "pull up our projects",
  ])("summons the project surface: %j", (text) => {
    expect(classifySummon(text)).toBe("project")
  })

  it.each([
    "what is HERMES doing?",
    "what's the runtime doing",
    "show me the activity",
    "open execution",
    "what's running",
  ])("summons the activity surface: %j", (text) => {
    expect(classifySummon(text)).toBe("activity")
  })

  it.each([
    "show me the evidence",
    "i need the technical details",
    "give me the receipts",
    "open the proof",
    "what proves this passed",
  ])("summons the evidence surface: %j", (text) => {
    expect(classifySummon(text)).toBe("evidence")
  })
})

describe("it does not hijack sentences that merely contain the word", () => {
  it.each([
    "open the projects page source",
    "show me the project registry component",
    "which file holds the activity route",
    "edit the evidence record function",
    "what does the runtime repository import",
  ])("leaves the operational request alone: %j", (text) => {
    // These are requests about CODE. Answering them with a registry listing is the same failure as
    // answering "are you dispatching to the codex lane?" with a speech about identity.
    expect(classifySummon(text)).toBeNull()
  })

  it.each([
    "continue the highest-priority work",
    "fix the failing test",
    "what are we doing right now?",
    "merge it",
    "",
  ])("leaves ordinary work and conversation alone: %j", (text) => {
    expect(classifySummon(text)).toBeNull()
  })
})

describe("surfaces disappear when they stop being useful", () => {
  it.each([
    ["hide the browser", "browser"],
    ["close the diff", "diff"],
    ["get rid of the trace", "trace"],
    ["dismiss the project surface", "project"],
    ["drop the evidence panel", "evidence"],
  ] as const)("dismisses by name: %j", (text, expected) => {
    expect(classifyDismissal(text)).toBe(expected)
  })

  it("honours the owner's word for a thing, not ours", () => {
    // An owner says "logs"; the surface is called trace. Their vocabulary wins.
    expect(classifyDismissal("hide the logs")).toBe("trace")
    expect(classifyDismissal("close the tests")).toBe("tests")
  })

  it.each(["hide everything", "close them all", "get rid of all of it"])("clears everything: %j", (text) => {
    expect(classifyDismissal(text)).toBe("all")
  })

  it("does not dismiss on sentences that are not dismissals", () => {
    expect(classifyDismissal("show me the browser")).toBeNull()
    expect(classifyDismissal("the tests are failing")).toBeNull()
    expect(classifyDismissal("continue")).toBeNull()
  })
})

/**
 * Work-orders migration (bucket B, first capability).
 *
 * Parity is BY CONSTRUCTION here: the surface calls `getWorkOrders()` — the very reader the
 * /work-orders route called — rather than a reimplementation that could drift from the route it
 * replaces without anyone noticing until the two disagreed in front of the owner.
 */
describe("work orders became a surface", () => {
  it.each([
    "show me the work orders",
    "open work orders",
    "list the work orders",
    "what work orders are there",
    "pull up the work order queue",
    "show me the workorders",
  ])("summons the work-orders surface: %j", (text) => {
    expect(classifySummon(text)).toBe("work-orders")
  })

  it("does not hijack a sentence about the work-order source", () => {
    expect(classifySummon("open the work-orders route file")).toBeNull()
    expect(classifySummon("which component renders work orders")).toBeNull()
  })

  it("is dismissable like any other surface", () => {
    // Named precisely, not swept into "all": dismissing one surface must not clear the others.
    expect(classifyDismissal("hide the work orders")).toBe("work-orders")
    expect(classifyDismissal("close the work-order surface")).toBe("work-orders")
  })
})

/**
 * Decisions migration (bucket B). Parity by construction: the surface calls getDecisions(), the
 * reader /decisions called. The register is a governance artifact — authority, evidence, supersession
 * lineage — so the surface shows the record, not a summary of it.
 */
describe("the decision register became a surface", () => {
  it.each([
    "show me the decisions",
    "open the decision register",
    "list decisions",
    "what decisions have been recorded",
    "pull up the decision log",
  ])("summons the decisions surface: %j", (text) => {
    expect(classifySummon(text)).toBe("decisions")
  })

  it("does not hijack a sentence about decision code", () => {
    expect(classifySummon("open the decisions action file")).toBeNull()
    expect(classifySummon("which component renders decisions")).toBeNull()
  })

  it("is dismissed by name, not swept into all", () => {
    expect(classifyDismissal("hide the decisions")).toBe("decisions")
    expect(classifyDismissal("close the decision surface")).toBe("decisions")
  })
})

/**
 * Runtime trace migration (bucket B). Parity by construction: the surface calls
 * getRuntimeExecutions(), the reader /trace called. Lease and checkpoint travel with it because they
 * are what distinguishes a stalled execution from a failed one — the distinction the route existed
 * to make.
 */
describe("runtime trace became a surface", () => {
  it.each([
    "show me the trace",
    "open the runtime execution truth",
    "bring up the attempts",
    "show the checkpoints",
    "what happened on WO-HERMES-OUTCOME-29",
  ])("summons the runtime-trace surface: %j", (text) => {
    expect(classifySummon(text)).toBe("runtime-trace")
  })

  it("does not hijack a sentence about trace code", () => {
    expect(classifySummon("open the runtime trace projection file")).toBeNull()
    expect(classifySummon("which component renders the trace")).toBeNull()
  })
})
