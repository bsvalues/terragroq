import { describe, expect, it } from "vitest"

import {
  classifyGrounded,
  composeCurrentWork,
  composeProjectsAnswer,
  groundedIdentity,
  groundingFacts,
  matchKnownProject,
  type ProjectRow,
  type WorkOrderRow,
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

const wos = (spec: Array<[string, string, string, string, string[]]>): WorkOrderRow[] =>
  spec.map(([ref, title, status, priority, evidence]) => ({ ref, title, status, priority, scope: null, lane: null, evidence }))

describe("composeCurrentWork reads real work orders (criterion 4)", () => {
  it("reports in-flight work highest priority first, with status and latest evidence", () => {
    const said = composeCurrentWork(wos([
      ["WO-10", "Parcel search", "in progress", "medium", ["screenshot-1"]],
      ["WO-11", "Permit intake", "active", "critical", ["diff-a", "tests-pass"]],
    ]))
    // critical sorts above medium
    expect(said.indexOf("Permit intake")).toBeLessThan(said.indexOf("Parcel search"))
    expect(said).toContain("WO-11")
    expect(said).toContain("tests-pass") // latest evidence, not the first
    expect(said.toLowerCase()).toContain("highest priority")
  })

  it("flags blocked work and excludes drafts/closed", () => {
    const said = composeCurrentWork(wos([
      ["WO-1", "Blocked thing", "blocked", "high", []],
      ["WO-2", "A draft", "draft", "critical", []],
      ["WO-3", "Closed thing", "closed", "high", []],
    ]))
    expect(said).toContain("BLOCKED")
    expect(said).not.toContain("A draft")
    expect(said).not.toContain("Closed thing")
  })

  it("scopes to the named project and says so honestly when nothing is in flight there", () => {
    const said = composeCurrentWork(
      [{ ref: "WO-9", title: "Atlas thing", status: "active", priority: "high", scope: "Atlas", lane: null, evidence: [] }],
      "TerraFusion",
    )
    expect(said.toLowerCase()).toContain("nothing is in flight on terrafusion")
    expect(said.toLowerCase()).toContain("won't")
    expect(said).not.toContain("Atlas thing")
  })

  it("never fabricates when the register is empty", () => {
    const said = composeCurrentWork([], "TerraFusion")
    for (const invented of ["chatbot", "customer support", "community event"]) {
      expect(said.toLowerCase()).not.toContain(invented)
    }
  })
})

describe("matchKnownProject extracts the scoped project", () => {
  const projects = rows([["TerraFusion OS", "standby"], ["WilliamOS", "active"], ["LocalOps", "standby"]])
  it("finds the project named in the question, longest match first", () => {
    expect(matchKnownProject("what are we doing right now on TerraFusion OS", projects)).toBe("TerraFusion OS")
    expect(matchKnownProject("what's in flight for LocalOps", projects)).toBe("LocalOps")
  })
  it("returns null when no known project is named", () => {
    expect(matchKnownProject("what are we working on right now", projects)).toBeNull()
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
