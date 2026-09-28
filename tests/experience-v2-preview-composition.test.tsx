// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { PreviewComposition } from "@/components/workspace-shell/preview-composition"

afterEach(cleanup)

describe("Experience V2 Preview composition", () => {
  it("anchors the running Preview to an exact OS 1.0 revision and actual consumed artifacts", () => {
    render(
      <PreviewComposition
        state="running"
        runtime={{
          repositoryName: "terrafusion_os_1.0",
          revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          instance: "preview-tf-atlas-014",
        }}
        consumedArtifacts={[
          {
            suite: "Atlas",
            repositoryKey: "atlas",
            artifactIdentity: "atlas-feature-projection-v1@sha256:actual-atlas",
            sourceRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
          {
            suite: "Forge",
            repositoryKey: "forge",
            artifactIdentity: "forge-model-v9@sha256:actual-forge",
            sourceRevision: "cccccccccccccccccccccccccccccccccccccccc",
          },
        ]}
        sovereignContext={{
          repositoryName: "terrafusion-os",
          revision: "dddddddddddddddddddddddddddddddddddddddd",
        }}
      />,
    )

    const runtime = screen.getByRole("region", { name: "Running OS 1.0 composition" })
    expect(within(runtime).getByText("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeTruthy()
    expect(within(runtime).getByText("preview-tf-atlas-014")).toBeTruthy()
    expect(screen.getByText("atlas-feature-projection-v1@sha256:actual-atlas")).toBeTruthy()
    expect(screen.getByText("forge-model-v9@sha256:actual-forge")).toBeTruthy()
    expect(screen.getByText("Preview actually running")).toBeTruthy()
  })

  it("keeps pending suite work outside the consumed runtime composition", () => {
    render(
      <PreviewComposition
        state="running"
        runtime={{
          repositoryName: "terrafusion_os_1.0",
          revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          instance: "preview-tf-atlas-014",
        }}
        consumedArtifacts={[
          {
            suite: "Atlas",
            repositoryKey: "atlas",
            artifactIdentity: "atlas-feature-projection-v1@sha256:running",
            sourceRevision: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          },
        ]}
        pendingSuiteChanges={[
          {
            suite: "Atlas",
            repositoryKey: "atlas",
            revision: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            state: "pr-merged",
            detail: "New branch head has not been assimilated by OS 1.0.",
          },
        ]}
        sovereignContext={{
          repositoryName: "terrafusion-os",
          revision: "dddddddddddddddddddddddddddddddddddddddd",
        }}
      />,
    )

    const composition = screen.getByRole("list", { name: "Consumed suite composition" })
    expect(within(composition).getByText("atlas-feature-projection-v1@sha256:running")).toBeTruthy()
    expect(within(composition).queryByText("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")).toBeNull()

    const pending = screen.getByRole("list", { name: "Pending suite changes" })
    expect(within(pending).getByText("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee")).toBeTruthy()
    expect(within(pending).getByText("PR merged · not assimilated")).toBeTruthy()
    expect(within(pending).queryByText(/integrated|running composition/i)).toBeNull()
  })

  it("shows Sovereign OS as context with no runtime dependency", () => {
    render(
      <PreviewComposition
        state="running"
        runtime={{ repositoryName: "terrafusion_os_1.0", revision: "a".repeat(40), instance: "preview-01" }}
        consumedArtifacts={[]}
        sovereignContext={{ repositoryName: "terrafusion-os", revision: "d".repeat(40) }}
      />,
    )

    const sovereign = screen.getByRole("region", { name: "Sovereign planning context" })
    expect(within(sovereign).getByText("d".repeat(40))).toBeTruthy()
    expect(within(sovereign).getByText("Runtime dependency: none")).toBeTruthy()
  })

  it("reports unavailable runtime and empty composition without fabricating integration", () => {
    render(
      <PreviewComposition
        state="unavailable"
        runtime={null}
        consumedArtifacts={[]}
        sovereignContext={null}
      />,
    )

    expect(screen.getByText("Preview unavailable")).toBeTruthy()
    expect(screen.getByText("No runtime identity is attached.")).toBeTruthy()
    expect(screen.getByText("No consumed suite artifact evidence is available.")).toBeTruthy()
    expect(screen.queryByText(/integrated|assimilated/i)).toBeNull()
  })

  it("distinguishes a reachable Preview from an attested runtime composition", () => {
    render(
      <PreviewComposition
        state="unverified"
        runtime={null}
        consumedArtifacts={[]}
        sovereignContext={null}
      />,
    )

    expect(screen.getByText("Composition unverified")).toBeTruthy()
    expect(screen.getByText("No runtime identity is attached.")).toBeTruthy()
    expect(screen.queryByText("Preview actually running")).toBeNull()
  })
})
