import { describe, expect, it } from "vitest"

import { classifyGrounded } from "@/lib/environment/grounding"
import { classifySummon } from "@/lib/environment/summon"

/**
 * A summon must not steal a sentence the environment answers from canonical state.
 *
 * `grounding.ts` states the precedence its own classifier follows — "Current-work before projects:
 * 'what are we working on across the projects' is current-work" — but the Line route consults
 * `classifySummon` FIRST, and the project matcher fires on "what … projects". The exact sentence the
 * grounding rule is named after was therefore answered with the project registry instead of the
 * canonical project → thread → outcome → evidence read, and it dropped the retained start selection
 * with it, so the following "continue" had no work to start.
 *
 * The rule is enforced where the hijack happens rather than restated where it does not.
 */

describe("current work outranks every summon", () => {
  it.each([
    "what are we working on across the projects",
    "what are we working on in the projects right now",
    "what are we up to on the projects",
  ])("does not summon a surface for: %j", (text) => {
    expect(classifyGrounded(text)).toBe("current-work")
    expect(classifySummon(text)).toBeNull()
  })
})

describe("it gives up nothing else to do that", () => {
  it.each([
    ["show me the projects", "project"],
    ["list our work orders", "work-orders"],
    ["show me the decisions", "decisions"],
    ["what's next", "queue"],
    ["show me the evidence", "evidence"],
    ["what's the runtime doing", "activity"],
    ["what happened on that", "runtime-trace"],
  ] as const)("still summons %j", (text, surface) => {
    // The guard is narrow on purpose: "show me the projects" is a request for the REGISTRY and must
    // keep opening the project surface. Only the current-work question is taken back.
    expect(classifySummon(text)).toBe(surface)
  })

  it("leaves an operational request alone, as before", () => {
    expect(classifySummon("open the projects page source")).toBeNull()
  })
})
