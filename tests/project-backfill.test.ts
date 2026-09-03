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
          resourceKey: "williamos",
          role: "integrated-runtime",
          previewSource: true,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion_os_1.0",
          label: "OS 1.0",
          relationship: "primary-repo",
          resourceKey: "os-1",
          role: "integrated-runtime",
          previewSource: true,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion-os",
          label: "Sovereign OS",
          relationship: "sovereign-planning-and-promotion",
          resourceKey: "sovereign-os",
          role: "sovereign-planning-and-promotion",
          previewSource: false,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion-forge",
          label: "Forge",
          relationship: "suite-source",
          resourceKey: "forge",
          role: "suite-source",
          previewSource: false,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion-atlas",
          label: "Atlas",
          relationship: "suite-source",
          resourceKey: "atlas",
          role: "suite-source",
          previewSource: false,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion-dais",
          label: "Dais",
          relationship: "suite-source",
          resourceKey: "dais",
          role: "suite-source",
          previewSource: false,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion-dossier",
          label: "Dossier",
          relationship: "suite-source",
          resourceKey: "dossier",
          role: "suite-source",
          previewSource: false,
        },
        {
          projectKey: "terrafusion",
          type: "repo",
          canonicalIdentity: "bsvalues/terrafusion-gpt",
          label: "GPT",
          relationship: "suite-source",
          resourceKey: "gpt",
          role: "suite-source",
          previewSource: false,
        },
      ],
    })
  })

  it("requires an explicit tenant identity", () => {
    expect(() => buildProjectBackfill(" ")).toThrow("PROJECT_BACKFILL_USER_ID_REQUIRED")
  })
})
