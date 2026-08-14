import { describe, expect, it } from "vitest"
import { buildProjectBackfill } from "../scripts/db/backfill-project-model.mjs"

describe("explicit Project P1 backfill", () => {
  it("contains only authority-backed project and repository bindings", () => {
    expect(buildProjectBackfill("primary-user")).toEqual({
      userId: "primary-user",
      projects: [
        { key: "williamos", name: "WilliamOS", lifecycle: "active" },
        { key: "terrafusion", name: "TerraFusion OS", lifecycle: "standby" },
      ],
      resources: [
        {
          projectKey: "williamos",
          type: "repo",
          canonicalIdentity: "bsvalues/terragroq",
          label: "WilliamOS repo",
          relationship: "primary-repo",
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion_os_1.0",
          label: "TerraFusion OS repo",
          relationship: "primary-repo",
        },
      ],
    })
  })

  it("requires an explicit tenant identity", () => {
    expect(() => buildProjectBackfill(" ")).toThrow("PROJECT_BACKFILL_USER_ID_REQUIRED")
  })
})
