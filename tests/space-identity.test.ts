import { describe, it, expect } from "vitest"

import {
  legacyStringMatch,
  spaceIntentForProject,
  worldMatchesProject,
  type ProjectIdentity,
  type WorldIdentityFields,
} from "@/lib/environment/space-identity"

const TERRAFUSION: ProjectIdentity = { id: 2, key: "terrafusion", name: "TerraFusion OS" }
const LOCALOPS: ProjectIdentity = { id: 4, key: "localops", name: "LocalOps" }

function world(over: Partial<WorldIdentityFields> = {}): WorldIdentityFields {
  return { projectId: 2, projectName: "TerraFusion OS", intent: "TerraFusion OS", resources: [], ...over }
}

describe("Space identity is decided by the Project, not a string regex", () => {
  it("matches by projectId when the world has one", () => {
    expect(worldMatchesProject(world({ projectId: 2 }), TERRAFUSION)).toBe(true)
  })

  it("does not match a different Project even with a similar name", () => {
    expect(worldMatchesProject(world({ projectId: 4 }), TERRAFUSION)).toBe(false)
  })

  it("ignores the strings entirely when a projectId is present", () => {
    // A world bound to project 4 whose text is full of "terrafusion" is still project 4's Space.
    const misleading = world({
      projectId: 4,
      projectName: "TerraFusion OS",
      intent: "TerraFusion",
      resources: ["bsvalues/terrafusion_os_1.0"],
    })
    expect(worldMatchesProject(misleading, TERRAFUSION)).toBe(false)
    expect(worldMatchesProject(misleading, LOCALOPS)).toBe(true)
  })

  it("a world containing 'terragroq' is NOT the TerraFusion Space", () => {
    // The exact old-regex false positive: /terrafusion|terragroq/i matched a terragroq resource.
    const legacy = world({
      projectId: null,
      projectName: null,
      intent: "some work",
      resources: ["bsvalues/terragroq"],
    })
    // Old regex matched "bsvalues/terragroq" by substring; whole-token matching does not.
    expect(worldMatchesProject(legacy, TERRAFUSION)).toBe(false)
  })
})

describe("legacy fallback, only for worlds with no projectId", () => {
  it("matches a legacy world by the Project's registered name as a whole token", () => {
    const legacy = world({ projectId: null, projectName: null, intent: "TerraFusion OS", resources: [] })
    expect(worldMatchesProject(legacy, TERRAFUSION)).toBe(true)
  })

  it("matches by the Project's key", () => {
    const legacy = world({ projectId: null, projectName: null, intent: "terrafusion", resources: [] })
    expect(legacyStringMatch(legacy, TERRAFUSION)).toBe(true)
  })

  it("does not match on a mere substring", () => {
    // "TerraFusionX" must not pass as "TerraFusion OS" — whole-token, not substring.
    const legacy = world({ projectId: null, projectName: null, intent: "TerraFusionX", resources: [] })
    expect(legacyStringMatch(legacy, TERRAFUSION)).toBe(false)
  })

  it("does not blanket-match 'looks like TerraFusion' for another Project", () => {
    const legacy = world({ projectId: null, projectName: null, intent: "TerraFusion OS", resources: [] })
    expect(legacyStringMatch(legacy, LOCALOPS)).toBe(false)
  })
})

describe("a new world is named for its Project", () => {
  it("uses the Project name, not the literal TerraFusion", () => {
    expect(spaceIntentForProject(LOCALOPS)).toBe("LocalOps")
    expect(spaceIntentForProject(TERRAFUSION)).toBe("TerraFusion OS")
  })
})
