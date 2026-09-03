// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  RepositoryMapSurface,
  type RepositoryRelationship,
} from "@/components/workspace-shell/repository-map-surface"
import type { RepositoryShelfRepository } from "@/components/workspace-shell/repository-shelf"

const repositoryFixtures: readonly RepositoryShelfRepository[] = [
  {
    repositoryKey: "os-1", name: "terrafusion_os_1.0", canonicalIdentity: "bsvalues/terrafusion_os_1.0",
    role: "integrated-runtime", workingSet: true, active: false, readOnly: false, preview: "source", entries: [],
    mounts: [{ id: "os-1-hermes", node: "HERMES", label: "protected main", branch: "main", revision: "1111111111111111111111111111111111111111", status: "ready", cleanliness: "clean" }],
    agents: [{ id: "os-codex", name: "Codex", role: "integration", activity: "Prepared", state: "waiting" }],
  },
  {
    repositoryKey: "sovereign-os", name: "terrafusion-os", canonicalIdentity: "bsvalues/terrafusion-os",
    role: "sovereign-planning-and-promotion", workingSet: false, active: false, readOnly: true, preview: "none", entries: [],
    mounts: [{ id: "sovereign-hermes", node: "HERMES", label: "canon", branch: "main", revision: "2222222222222222222222222222222222222222", status: "ready", cleanliness: "clean" }],
    agents: [],
  },
  {
    repositoryKey: "atlas", name: "terrafusion-atlas", canonicalIdentity: "bsvalues/terrafusion-atlas",
    role: "suite-source", suite: "Atlas", workingSet: true, active: true, readOnly: false, preview: "not-assimilated", entries: [],
    mounts: [{ id: "atlas-worktree", node: "OMEN", label: "WO-ATLAS-001", branch: "codex/atlas-projection", revision: "3333333333333333333333333333333333333333", status: "ready", cleanliness: "modified", worktreeId: "wt-atlas-001" }],
    agents: [{ id: "atlas-codex", name: "Codex", role: "builder", activity: "Editing spatial projection", state: "working" }],
  },
  {
    repositoryKey: "forge", name: "terrafusion-forge", canonicalIdentity: "bsvalues/terrafusion-forge",
    role: "suite-source", suite: "Forge", workingSet: true, active: false, readOnly: false, preview: "assimilated", entries: [],
    mounts: [{ id: "forge-hermes", node: "HERMES", label: "protected main", branch: "main", revision: "4444444444444444444444444444444444444444", status: "stale", cleanliness: "unknown" }],
    agents: [],
  },
  {
    repositoryKey: "sync", name: "TerraFusionSync", canonicalIdentity: "bsvalues/TerraFusionSync",
    role: "attached-source", attachmentReason: "Historical migration reference", workingSet: false, active: false, readOnly: true, preview: "none", entries: [],
    mounts: [{ id: "sync-hermes", node: "HERMES", label: "historical checkout", branch: "main", revision: "5555555555555555555555555555555555555555", status: "ready", cleanliness: "clean" }],
    agents: [],
  },
]

const relationships: readonly RepositoryRelationship[] = [
  {
    id: "atlas-contract",
    fromRepositoryKey: "atlas",
    toRepositoryKey: "os-1",
    label: "atlas-feature-projection-v1",
    kind: "consumed-by",
    status: "waiting",
    detail: "OS consumer waits for the reviewed Atlas artifact.",
  },
  {
    id: "sovereign-promotion",
    fromRepositoryKey: "sovereign-os",
    toRepositoryKey: "os-1",
    label: "Promotion guidance",
    kind: "informs",
    status: "reference",
    detail: "Planning context only. It is not a runtime dependency.",
  },
]

afterEach(cleanup)

describe("Experience V2 repository map", () => {
  it("renders a summonable source relationship surface rather than a dashboard", () => {
    render(<RepositoryMapSurface repositories={repositoryFixtures} relationships={relationships} />)

    expect(screen.getByRole("region", { name: "Repository map" })).toBeTruthy()
    expect(screen.getByText("Source relationships")).toBeTruthy()
    expect(screen.getByText("4 Core Seven repositories · 1 attached source")).toBeTruthy()
    expect(screen.queryByText(/dashboard|KPI|system health/i)).toBeNull()
  })

  it("keeps OS 1.0 as the runnable integration hub and Sovereign OS visibly non-runtime", () => {
    render(<RepositoryMapSurface repositories={repositoryFixtures} relationships={relationships} />)

    const runtime = screen.getByRole("button", { name: /^Repository terrafusion_os_1\.0,/i })
    const sovereign = screen.getByRole("button", { name: /^Repository terrafusion-os,/i })
    expect(runtime.textContent).toContain("Integrated runtime")
    expect(runtime.textContent).toContain("Preview source")
    expect(sovereign.textContent).toContain("Planning and promotion")
    expect(sovereign.textContent).toContain("No Preview")
  })

  it("shows truthful agent activity, checkout readiness, and attached-source posture", () => {
    render(<RepositoryMapSurface repositories={repositoryFixtures} relationships={relationships} />)

    const atlas = screen.getByRole("button", { name: /^Repository terrafusion-atlas,/i })
    expect(atlas.textContent).toContain("Codex · Editing spatial projection")
    expect(atlas.textContent).toContain("Ready")
    const forge = screen.getByRole("button", { name: /^Repository terrafusion-forge,/i })
    expect(forge.textContent).toContain("Stale")
    const sync = screen.getByRole("button", { name: /^Repository TerraFusionSync,/i })
    expect(sync.textContent).toContain("Attached reference")
    expect(sync.textContent).toContain("Read only")
  })

  it("exposes dependency direction and integration readiness without claiming a completed fan-in", () => {
    render(<RepositoryMapSurface repositories={repositoryFixtures} relationships={relationships} />)

    const atlasFlow = screen.getByRole("listitem", { name: "terrafusion-atlas consumed by terrafusion_os_1.0" })
    expect(within(atlasFlow).getByText("atlas-feature-projection-v1")).toBeTruthy()
    expect(within(atlasFlow).getByText("Waiting")).toBeTruthy()
    expect(within(atlasFlow).getByText("OS consumer waits for the reviewed Atlas artifact.")).toBeTruthy()
    expect(screen.queryByText(/integrated complete|fan-in complete/i)).toBeNull()
  })

  it("lets the owner focus an exact repository from either the map or a relationship", async () => {
    const user = userEvent.setup()
    const onSelectRepository = vi.fn()
    render(
      <RepositoryMapSurface
        repositories={repositoryFixtures}
        relationships={relationships}
        onSelectRepository={onSelectRepository}
      />,
    )

    await user.click(screen.getByRole("button", { name: /^Repository terrafusion-atlas,/i }))
    await user.click(screen.getByRole("button", { name: "Focus terrafusion_os_1.0 from atlas-feature-projection-v1" }))
    expect(onSelectRepository).toHaveBeenNthCalledWith(1, "atlas")
    expect(onSelectRepository).toHaveBeenNthCalledWith(2, "os-1")
  })

  it("dismisses the summonable map without changing repository state", async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()
    render(<RepositoryMapSurface repositories={repositoryFixtures} relationships={relationships} onDismiss={onDismiss} />)

    await user.click(screen.getByRole("button", { name: "Dismiss Repository Map" }))
    expect(onDismiss).toHaveBeenCalledOnce()
  })
})
