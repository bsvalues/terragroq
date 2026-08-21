import { describe, expect, it } from "vitest"

import {
  classifyGrounded,
  composeProjectsAnswer,
  groundedIdentity,
  groundingFacts,
  type ProjectRow,
} from "@/lib/environment/grounding"

/**
 * Real-operator acceptance (#762, 2026-08-21): a live test caught the Line answering as a generic
 * assistant and inventing projects. These lock the grounding: identity/project/current-work questions
 * are classified away from the free-form model (including paraphrases), operational requests are NOT
 * intercepted, answers respect lifecycle, and the model path itself carries grounding facts. The
 * owner's exact sentence is the named regression.
 */
describe("classifyGrounded routes grounded questions away from the free-form model", () => {
  it("catches the owner's exact regression sentence", () => {
    expect(classifyGrounded("tell me more about the projects we are currently working on")).toBe("projects")
  })

  it("catches common paraphrases the first cut missed (Codex P1)", () => {
    expect(classifyGrounded("are there any projects?")).toBe("projects")
    expect(classifyGrounded("name our projects")).toBe("projects")
    expect(classifyGrounded("who is WilliamOS?")).toBe("identity")
    expect(classifyGrounded("tell me about yourself")).toBe("identity")
  })

  it("classifies identity and current-work questions", () => {
    for (const q of ["who are you", "what can you do", "are you a chatbot"]) expect(classifyGrounded(q)).toBe("identity")
    for (const q of ["what are we working on right now", "what's in flight", "what are we doing"]) {
      expect(classifyGrounded(q)).toBe("current-work")
    }
  })

  it("does NOT intercept operational requests that merely mention projects/status (Codex P2)", () => {
    expect(classifyGrounded("show me the projects page source")).toBeNull()
    expect(classifyGrounded("what's the login status currently?")).toBeNull()
    expect(classifyGrounded("open the project route file")).toBeNull()
  })

  it("lets ordinary work sentences fall through", () => {
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

const rows = (spec: Array<[string, string]>): ProjectRow[] => spec.map(([name, lifecycle]) => ({ name, lifecycle }))

describe("composeProjectsAnswer is lifecycle-aware and never fabricates", () => {
  it("reports active as current and standby separately (Codex P2 lifecycle)", () => {
    const said = composeProjectsAnswer(rows([["TerraFusion", "active"], ["Atlas Migration", "standby"]]))
    expect(said).toContain("Currently active: TerraFusion")
    expect(said).toContain("standby: Atlas Migration")
  })

  it("does not report an archived project as ongoing", () => {
    const said = composeProjectsAnswer(rows([["Old Thing", "archived"]]))
    expect(said).not.toContain("Old Thing")
    expect(said.toLowerCase()).toContain("no active or standby")
  })

  it("says so honestly when there are none — never the live-failure fabrications", () => {
    const said = composeProjectsAnswer([])
    expect(said.toLowerCase()).toContain("won't")
    for (const invented of ["chatbot", "customer support", "community event", "local business"]) {
      expect(said.toLowerCase()).not.toContain(invented)
    }
  })
})

describe("groundingFacts is the model's second grounding layer", () => {
  it("carries the real register and forbids inventing beyond it", () => {
    const facts = groundingFacts(rows([["TerraFusion", "active"], ["Atlas", "standby"]]))
    expect(facts).toContain("WilliamOS")
    expect(facts).toContain("active: TerraFusion")
    expect(facts).toContain("standby: Atlas")
    expect(facts.toLowerCase()).toContain("do not name any project")
  })
})
