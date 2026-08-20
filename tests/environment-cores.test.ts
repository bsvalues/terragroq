import { describe, expect, it } from "vitest"

import { resolveAmbiguity } from "@/lib/environment/assumption-policy"
import {
  createWorkingWorld,
  validateWorkingWorld,
  withSurface,
  withTurn,
} from "@/lib/environment/working-world"

/**
 * S1 and S6 are the first two architecture requirements of the Environment (#762), and both encode an
 * owner rule as refusable logic: the assumption triad so a model change cannot revive the
 * interrogation machine, and the meaning-only snapshot so chrome can never colonize restoration.
 */
describe("S1 — the assumption triad", () => {
  const candidates = [
    { id: "terrafusion", label: "TerraFusion's login", weight: 2 },
    { id: "williamos", label: "the WilliamOS operator sign-in", weight: 1 },
  ]

  it("assumes and states when a wrong guess is cheap, picking the weightier candidate", () => {
    const decision = resolveAmbiguity({ subject: "which login flow", candidates, costOfWrongGuess: "cheap" })
    expect(decision.mode).toBe("ASSUME_AND_STATE")
    if (decision.mode === "ASSUME_AND_STATE") {
      expect(decision.chosen.id).toBe("terrafusion")
      // The statement always names the assumption and the exit. This exact shape is the norm.
      expect(decision.statement).toBe("Taking this as TerraFusion's login — one word corrects me.")
    }
  })

  it("asks when the wrong guess is expensive, and says why", () => {
    const decision = resolveAmbiguity({ subject: "which database to migrate", candidates, costOfWrongGuess: "expensive" })
    expect(decision.mode).toBe("ASK")
    if (decision.mode === "ASK") expect(decision.question).toContain("isn't cheap to undo")
  })

  it("asks when the guess is irreversible, however obvious the candidate", () => {
    const one = [{ id: "only", label: "the only candidate", weight: 9 }]
    expect(resolveAmbiguity({ subject: "what to delete", candidates: one, costOfWrongGuess: "irreversible" }).mode).toBe("ASK")
  })

  it("never assumes across an authority boundary, even a cheap one", () => {
    const decision = resolveAmbiguity({
      subject: "which policy applies",
      candidates,
      costOfWrongGuess: "cheap",
      authorityBoundary: true,
    })
    expect(decision.mode).toBe("ASK")
  })

  it("asks honestly when there is nothing to assume, instead of inventing a candidate", () => {
    const decision = resolveAmbiguity({ subject: "which service", candidates: [], costOfWrongGuess: "cheap" })
    expect(decision.mode).toBe("ASK")
    if (decision.mode === "ASK") expect(decision.candidates).toHaveLength(0)
  })

  it("breaks ties toward the first listed candidate, so ordering is meaningful", () => {
    const tied = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]
    const decision = resolveAmbiguity({ subject: "which one", candidates: tied, costOfWrongGuess: "cheap" })
    if (decision.mode === "ASSUME_AND_STATE") expect(decision.chosen.id).toBe("a")
  })
})

describe("S6 — the snapshot holds meaning and refuses chrome", () => {
  it("creates a world from intent alone — no ceremony fields exist to fill in", () => {
    const world = createWorkingWorld({ intent: "fix the login flow", resources: ["bsvalues/terragroq"] })
    expect(world.intent).toBe("fix the login flow")
    expect(world.continuation).toBe("active")
    expect(validateWorkingWorld(world)).toBeTruthy()
  })

  it("refuses a world with no intent, because a world IS the named work", () => {
    expect(() => createWorkingWorld({ intent: "   " })).toThrow("WORLD_NEEDS_INTENT")
  })

  it("refuses chrome-shaped keys anywhere in the structure", () => {
    const world = createWorkingWorld({ intent: "x" }) as unknown as Record<string, unknown>
    const polluted = { ...world, surfaces: [{ kind: "editor", subject: "a.ts", paneWidth: 318 }] }
    expect(() => validateWorkingWorld(polluted)).toThrow(/WORLD_CHROME_REFUSED/)
  })

  it("refuses unknown top-level keys rather than carrying them silently", () => {
    const world = createWorkingWorld({ intent: "x" }) as unknown as Record<string, unknown>
    expect(() => validateWorkingWorld({ ...world, layoutRects: [] })).toThrow(/WORLD_UNKNOWN_KEY|WORLD_CHROME_REFUSED/)
  })

  it("keeps conversational position bounded and ordered", () => {
    let world = createWorkingWorld({ intent: "x" })
    for (let index = 0; index < 50; index += 1) {
      world = withTurn(world, index % 2 === 0 ? "owner" : "williamos", `turn ${index}`, () => `t${index}`)
    }
    expect(world.conversation).toHaveLength(40)
    expect(world.conversation[39].content).toBe("turn 49")
  })

  it("records surfaces by meaning, unique per kind and subject", () => {
    let world = createWorkingWorld({ intent: "x" })
    world = withSurface(world, { kind: "browser", subject: "/sign-in", because: "reproducing the failure" })
    world = withSurface(world, { kind: "browser", subject: "/sign-in", because: "rerunning after the fix" })
    expect(world.surfaces).toHaveLength(1)
    expect(world.surfaces[0].because).toBe("rerunning after the fix")
  })
})
