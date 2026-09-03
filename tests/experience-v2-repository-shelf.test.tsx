// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  RepositoryShelf,
  type RepositoryShelfRepository,
} from "@/components/workspace-shell/repository-shelf"

export const repositoryFixtures: readonly RepositoryShelfRepository[] = [
  {
    repositoryKey: "os-1",
    name: "terrafusion_os_1.0",
    canonicalIdentity: "bsvalues/terrafusion_os_1.0",
    role: "integrated-runtime",
    workingSet: true,
    active: false,
    readOnly: false,
    preview: "source",
    mounts: [{
      id: "os-1-hermes",
      node: "HERMES",
      label: "protected main",
      branch: "main",
      revision: "1111111111111111111111111111111111111111",
      status: "ready",
      cleanliness: "clean",
    }],
    entries: [{ id: "os-backend", label: "backend", kind: "directory" }],
    agents: [{ id: "os-codex", name: "Codex", role: "integration", activity: "Prepared", state: "waiting" }],
  },
  {
    repositoryKey: "sovereign-os",
    name: "terrafusion-os",
    canonicalIdentity: "bsvalues/terrafusion-os",
    role: "sovereign-planning-and-promotion",
    workingSet: false,
    active: false,
    readOnly: true,
    preview: "none",
    mounts: [{
      id: "sovereign-hermes",
      node: "HERMES",
      label: "canon",
      branch: "main",
      revision: "2222222222222222222222222222222222222222",
      status: "ready",
      cleanliness: "clean",
    }],
    entries: [{ id: "sovereign-plan", label: "SOVEREIGN_PLAN.md", kind: "file" }],
    agents: [],
  },
  {
    repositoryKey: "atlas",
    name: "terrafusion-atlas",
    canonicalIdentity: "bsvalues/terrafusion-atlas",
    role: "suite-source",
    suite: "Atlas",
    workingSet: true,
    active: true,
    readOnly: false,
    preview: "not-assimilated",
    mounts: [{
      id: "atlas-worktree",
      node: "OMEN",
      label: "WO-ATLAS-001",
      branch: "codex/atlas-projection",
      revision: "3333333333333333333333333333333333333333",
      status: "ready",
      cleanliness: "modified",
      worktreeId: "wt-atlas-001",
    }],
    entries: [
      { id: "atlas-src", label: "src", kind: "directory" },
      { id: "atlas-tests", label: "tests", kind: "directory" },
    ],
    agents: [{ id: "atlas-codex", name: "Codex", role: "builder", activity: "Editing spatial projection", state: "working" }],
  },
  {
    repositoryKey: "forge",
    name: "terrafusion-forge",
    canonicalIdentity: "bsvalues/terrafusion-forge",
    role: "suite-source",
    suite: "Forge",
    workingSet: true,
    active: false,
    readOnly: false,
    preview: "assimilated",
    mounts: [{
      id: "forge-hermes",
      node: "HERMES",
      label: "protected main",
      branch: "main",
      revision: "4444444444444444444444444444444444444444",
      status: "stale",
      cleanliness: "unknown",
    }],
    entries: [{ id: "forge-src", label: "src", kind: "directory" }],
    agents: [],
  },
  {
    repositoryKey: "sync",
    name: "TerraFusionSync",
    canonicalIdentity: "bsvalues/TerraFusionSync",
    role: "attached-source",
    attachmentReason: "Historical migration reference",
    workingSet: false,
    active: false,
    readOnly: true,
    preview: "none",
    mounts: [{
      id: "sync-hermes",
      node: "HERMES",
      label: "historical checkout",
      branch: "main",
      revision: "5555555555555555555555555555555555555555",
      status: "ready",
      cleanliness: "clean",
    }],
    entries: [{ id: "sync-doc", label: "README.md", kind: "file" }],
    agents: [],
  },
]

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Experience V2 repository shelf", () => {
  it("opens on the small Working Set with repository details quiet", () => {
    render(<RepositoryShelf repositories={repositoryFixtures} />)

    expect(screen.getByRole("navigation", { name: "TerraFusion sources" })).toBeTruthy()
    expect(screen.getByRole("tab", { name: "Working Set, 3 repositories" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByRole("button", { name: /^Repository terrafusion-atlas,/i }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.getByRole("button", { name: /^Repository terrafusion_os_1\.0,/i }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByRole("group", { name: "terrafusion-atlas repository details" })).toBeNull()
    expect(screen.queryByText("backend")).toBeNull()
    expect(screen.queryByText("terrafusion-os")).toBeNull()
  })

  it("groups all Core Seven by their asymmetric product roles", async () => {
    const user = userEvent.setup()
    render(<RepositoryShelf repositories={repositoryFixtures} />)

    await user.click(screen.getByRole("tab", { name: "Core Seven, 4 repositories" }))
    expect(screen.getByRole("region", { name: "Integrated product repositories" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Sovereign planning and promotion repositories" })).toBeTruthy()
    expect(screen.getByRole("region", { name: "Suite source repositories" })).toBeTruthy()
    expect(screen.getByText("Runnable · Preview source")).toBeTruthy()
    expect(screen.getByText("Non-runnable · No Preview")).toBeTruthy()
    expect(screen.getByText("Suite source · Not assimilated")).toBeTruthy()
  })

  it("shows exact mount, revision, worktree, agent, and truth state after explicit expansion", async () => {
    const user = userEvent.setup()
    render(<RepositoryShelf repositories={repositoryFixtures} />)

    await user.click(screen.getByRole("button", { name: /^Repository terrafusion-atlas,/i }))
    const atlas = screen.getByRole("group", { name: "terrafusion-atlas repository details" })
    expect(within(atlas).getByText("OMEN")).toBeTruthy()
    expect(within(atlas).getByText("codex/atlas-projection")).toBeTruthy()
    expect(within(atlas).getByText("3333333333333333333333333333333333333333")).toBeTruthy()
    expect(within(atlas).getByText("wt-atlas-001")).toBeTruthy()
    expect(within(atlas).getByText("Modified")).toBeTruthy()
    expect(within(atlas).getByText("Codex · builder")).toBeTruthy()
    expect(within(atlas).getByText("Editing spatial projection")).toBeTruthy()
  })

  it("keeps historical attachments read-only and outside the Core Seven", async () => {
    const user = userEvent.setup()
    render(<RepositoryShelf repositories={repositoryFixtures} />)

    await user.click(screen.getByRole("tab", { name: "Attached Sources, 1 repository" }))
    const source = screen.getByRole("button", { name: /^Repository TerraFusionSync,/i })
    expect(source.textContent).toContain("Read only")
    expect(source.textContent).toContain("Historical migration reference")
    expect(screen.queryByText("Integrated product")).toBeNull()
  })

  it("moves through source-scope tabs with the keyboard", async () => {
    const user = userEvent.setup()
    render(<RepositoryShelf repositories={repositoryFixtures} />)

    const workingSet = screen.getByRole("tab", { name: "Working Set, 3 repositories" })
    workingSet.focus()
    await user.keyboard("{ArrowRight}")
    const coreSeven = screen.getByRole("tab", { name: "Core Seven, 4 repositories" })
    expect(document.activeElement).toBe(coreSeven)
    expect(coreSeven.getAttribute("aria-selected")).toBe("true")
    await user.keyboard("{End}")
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Attached Sources, 1 repository" }))
  })

  it("supports repository selection, expansion, and entry opening without inventing a combined tree", async () => {
    const user = userEvent.setup()
    const onSelectRepository = vi.fn()
    const onOpenEntry = vi.fn()
    render(
      <RepositoryShelf
        repositories={repositoryFixtures}
        onSelectRepository={onSelectRepository}
        onOpenEntry={onOpenEntry}
      />,
    )

    await user.click(screen.getByRole("button", { name: /^Repository terrafusion_os_1\.0,/i }))
    expect(onSelectRepository).toHaveBeenCalledWith("os-1")
    expect(screen.getByRole("button", { name: /^Repository terrafusion_os_1\.0,/i }).getAttribute("aria-expanded")).toBe("true")
    await user.click(screen.getByRole("button", { name: "Open backend in terrafusion_os_1.0" }))
    expect(onOpenEntry).toHaveBeenCalledWith("os-1", "os-backend")
    expect(screen.queryByText(/virtual monorepo|combined tree/i)).toBeNull()
  })

  it("searches only the current Working Set and opens a repository-qualified result", async () => {
    const user = userEvent.setup()
    const onOpenEntry = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost")
      expect(url.pathname).toBe("/api/loom/search")
      expect(url.searchParams.get("projectKey")).toBe("terrafusion")
      expect(url.searchParams.get("query")).toBe("parcel")
      expect(url.searchParams.getAll("repositoryKey")).toEqual(["os-1", "atlas", "forge"])
      return new Response(JSON.stringify({
        results: [{
          repositoryKey: "atlas",
          repositoryIdentity: "bsvalues/terrafusion-atlas",
          repositoryMountKey: "terrafusion:atlas:configured",
          observedRevision: "3".repeat(40),
          path: "src/project-atlas-feature.mjs",
          line: 14,
          excerpt: "export const parcelProjection = true",
        }],
        unavailable: [{ repositoryKey: "forge", reason: "WORKSPACE_REVISION_UNAVAILABLE" }],
        partial: [
          { repositoryKey: "os-1", reason: "WORKSPACE_SEARCH_TIMEOUT" },
          { repositoryKey: "atlas", reason: "WORKSPACE_SEARCH_UNREADABLE_PATHS" },
        ],
        truncated: false,
      }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    render(<RepositoryShelf repositories={repositoryFixtures} onOpenEntry={onOpenEntry} />)

    await user.type(screen.getByRole("searchbox", { name: "Search Working Set" }), "parcel")
    await user.click(screen.getByRole("button", { name: "Search 3 Working Set repositories" }))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole("button", { name: "Open src/project-atlas-feature.mjs in Atlas at line 14" })).toBeTruthy()
    expect(screen.getByText("Forge unavailable for this search.")).toBeTruthy()
    expect(screen.getByText("OS 1.0 search stopped before completion; results may be incomplete.")).toBeTruthy()
    expect(screen.getByText("Atlas search skipped unreadable paths; results may be incomplete.")).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Open src/project-atlas-feature.mjs in Atlas at line 14" }))
    expect(onOpenEntry).toHaveBeenCalledWith("atlas", "src/project-atlas-feature.mjs")
  })

  it("keeps search quiet until submitted and surfaces a truthful request failure", async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "SEARCH_UNAVAILABLE" }), { status: 503 }))
    vi.stubGlobal("fetch", fetchMock)
    render(<RepositoryShelf repositories={repositoryFixtures} />)

    expect(screen.queryByRole("region", { name: "Working Set search results" })).toBeNull()
    await user.type(screen.getByRole("searchbox", { name: "Search Working Set" }), "projection")
    expect(fetchMock).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")

    expect(await screen.findByText("Working Set search is unavailable.")).toBeTruthy()
    expect(screen.getByRole("searchbox", { name: "Search Working Set" })).toBeTruthy()
  })
})
