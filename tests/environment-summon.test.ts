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
