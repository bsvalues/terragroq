import { describe, expect, it } from "vitest"

import {
  classifyGrounded,
  composeProjectsAnswer,
  groundedCurrentWork,
  groundedIdentity,
} from "@/lib/environment/grounding"

/**
 * Real-operator acceptance (#762, 2026-08-21): a live test caught the Line answering as a generic
 * assistant and inventing projects. These lock the grounding: identity/project/current-work questions
 * are classified away from the free-form model, and the project answer is real-or-honest, never
 * fabricated. The owner's exact sentence is the named regression.
 */
describe("classifyGrounded routes grounded questions away from the free-form model", () => {
  it("catches the owner's exact regression sentence as a projects question", () => {
    // This sentence returned three invented projects live. It must never reach converse() again.
    expect(classifyGrounded("tell me more about the projects we are currently working on")).toBe("projects")
  })

  it("classifies identity questions", () => {
    for (const q of ["who are you", "what can you do", "what are you?", "are you a chatbot"]) {
      expect(classifyGrounded(q)).toBe("identity")
    }
  })

  it("classifies current-work questions", () => {
    for (const q of ["what are we working on right now", "what's in flight", "what are we doing right now"]) {
      expect(classifyGrounded(q)).toBe("current-work")
    }
  })

  it("lets ordinary work sentences fall through to normal handling", () => {
    expect(classifyGrounded("the login flow is broken, fix it")).toBeNull()
    expect(classifyGrounded("add a dark mode toggle")).toBeNull()
  })
})

describe("groundedIdentity is WilliamOS in role, not a generic assistant", () => {
  it("names WilliamOS and refuses the generic-assistant framing", () => {
    const said = groundedIdentity()
    expect(said).toContain("WilliamOS")
    expect(said.toLowerCase()).not.toContain("digital assistant")
    expect(said.toLowerCase()).toContain("not a general")
  })
})

describe("composeProjectsAnswer never fabricates", () => {
  it("reports the real registered projects when there are some", () => {
    const said = composeProjectsAnswer([{ name: "TerraFusion" }, { name: "WilliamOS" }])
    expect(said).toContain("TerraFusion")
    expect(said).toContain("WilliamOS")
  })

  it("says so honestly when there are none — inventing a list is the failure this avoids", () => {
    const said = composeProjectsAnswer([])
    expect(said.toLowerCase()).toContain("no projects are registered")
    expect(said.toLowerCase()).toContain("won't")
    // None of the fabricated generics from the live failure may appear.
    for (const invented of ["chatbot", "customer support", "community event", "local business"]) {
      expect(said.toLowerCase()).not.toContain(invented)
    }
  })
})

describe("groundedCurrentWork is honest about the unwired seam", () => {
  it("refuses to invent in-flight work and says the state is not wired yet", () => {
    const said = groundedCurrentWork([{ name: "TerraFusion" }])
    expect(said.toLowerCase()).toContain("won't")
    expect(said.toLowerCase()).toMatch(/not (yet )?wired|don't have/)
    expect(said).toContain("TerraFusion")
  })
})
