// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ChangeSetSurface,
  type ChangeSetDeliveryUnit,
} from "@/components/workspace-shell/change-set-surface"

const units: readonly ChangeSetDeliveryUnit[] = [
  {
    id: "atlas-delivery",
    repositoryKey: "atlas",
    repositoryName: "terrafusion-atlas",
    repositoryRole: "Atlas suite source",
    branch: "codex/atlas-parcel-projection",
    revision: "1111111111111111111111111111111111111111",
    state: "artifact-produced",
    pullRequest: { number: 1421, status: "merged" },
    tests: { status: "passed", label: "Atlas contract · 38 passed" },
    review: { status: "approved", label: "Claude · approved" },
    produces: "atlas-feature-projection-v1@sha256:atlas-artifact",
  },
  {
    id: "os-consumer",
    repositoryKey: "os-1",
    repositoryName: "terrafusion_os_1.0",
    repositoryRole: "Integrated runtime",
    branch: "codex/consume-atlas-projection",
    revision: "2222222222222222222222222222222222222222",
    state: "os-consumer-updated",
    pullRequest: { number: 1429, status: "open" },
    tests: { status: "running", label: "OS integration · running" },
    review: { status: "pending", label: "Independent review · pending" },
    consumes: ["atlas-feature-projection-v1@sha256:atlas-artifact"],
    dependsOn: ["atlas-delivery"],
  },
]

afterEach(cleanup)

describe("Experience V2 cross-repository Change Set", () => {
  it("shows one owner outcome while preserving each repository as a separate Git delivery", () => {
    render(
      <ChangeSetSurface
        outcome="Atlas parcel projection integration"
        units={units}
      />,
    )

    expect(screen.getByRole("region", { name: "Change set for Atlas parcel projection integration" })).toBeTruthy()
    expect(screen.getAllByText("Atlas parcel projection integration")).toHaveLength(1)
    expect(screen.getByText("2 repositories · 2 separate Git deliveries")).toBeTruthy()

    const atlas = screen.getByRole("listitem", { name: "terrafusion-atlas delivery" })
    expect(within(atlas).getByText("codex/atlas-parcel-projection")).toBeTruthy()
    expect(within(atlas).getByText("1111111111111111111111111111111111111111")).toBeTruthy()
    expect(within(atlas).getByRole("link", { name: "PR #1421 · Merged" })).toBeTruthy()
    expect(within(atlas).getByText("Atlas contract · 38 passed")).toBeTruthy()
    expect(within(atlas).getByText("Claude · approved")).toBeTruthy()

    const os = screen.getByRole("listitem", { name: "terrafusion_os_1.0 delivery" })
    expect(within(os).getByRole("link", { name: "PR #1429 · Open" })).toBeTruthy()
    expect(screen.queryByText(/combined Git diff|single Git diff/i)).toBeNull()
  })

  it("makes artifact dependency direction and incomplete fan-in explicit", () => {
    render(
      <ChangeSetSurface
        outcome="Atlas parcel projection integration"
        units={units}
        preview={{ state: "waiting", label: "Waiting for OS review" }}
      />,
    )

    const dependency = screen.getByRole("listitem", {
      name: "terrafusion-atlas produces atlas-feature-projection-v1@sha256:atlas-artifact for terrafusion_os_1.0",
    })
    expect(within(dependency).getByText("Artifact produced")).toBeTruthy()
    expect(within(dependency).getByText("OS consumer updated")).toBeTruthy()
    expect(screen.getByText("Waiting for OS review")).toBeTruthy()
    expect(screen.queryByText(/change set complete|fan-in complete/i)).toBeNull()
  })

  it.each([
    ["repository-changed", "Repository changed"],
    ["pr-merged", "PR merged"],
    ["artifact-produced", "Artifact produced"],
    ["os-consumer-updated", "OS consumer updated"],
    ["artifact-assimilated", "Artifact assimilated"],
    ["preview-running", "Preview actually running"],
  ] as const)("renders %s as the truthful product state %s", (state, label) => {
    render(
      <ChangeSetSurface
        outcome="State proof"
        units={[{ ...units[0], id: state, state }]}
      />,
    )

    expect(screen.getByText(label)).toBeTruthy()
  })

  it("lets the owner focus the exact repository delivery", async () => {
    const user = userEvent.setup()
    const onSelectRepository = vi.fn()
    render(
      <ChangeSetSurface
        outcome="Atlas parcel projection integration"
        units={units}
        onSelectRepository={onSelectRepository}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Open terrafusion_os_1.0 delivery" }))
    expect(onSelectRepository).toHaveBeenCalledWith("os-1")
  })
})
