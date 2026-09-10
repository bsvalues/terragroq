// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"

import { ContextLoadedPanel } from "@/components/workspace-shell/context-loaded-panel"
import { createAssignmentContextManifest } from "@/lib/loom/assignment-context-manifest"

const targetRevision = "1".repeat(40)
const referenceRevision = "2".repeat(40)
const manifest = createAssignmentContextManifest({
  assignment: {
    assignmentId: "assignment-atlas-001",
    worldId: "space-atlas-projection",
    workOrderId: 1109,
    assignmentHash: "a".repeat(64),
    createdAt: "2026-09-02T18:20:00.000Z",
  },
  project: { id: 7, key: "terrafusion", name: "TerraFusion" },
  workOrder: {
    id: 1109,
    ref: "WO-ATLAS-1109",
    version: "2026-09-02T18:20:00.000Z",
    status: "active",
    content: '{"title":"Atlas projection integration"}',
    contentHash: "357243cbd63925c4b7e256e45ba00da69f20fbae012d8702592ab12bd6bbf044",
  },
  targetRepository: {
    repositoryResourceId: 12,
    repositoryKey: "atlas",
    repositoryIdentity: "bsvalues/terrafusion-atlas",
    role: "suite-source",
    suite: "atlas",
  },
  checkout: {
    repositoryMountKey: "atlas-omen-main",
    nodeIdentity: "OMEN",
    worktreeKey: "wt-atlas-001",
    baseRevision: targetRevision,
  },
  mutationPosture: {
    writablePaths: [
      "src/spatial-read/project-atlas-feature.mjs",
      "tests/project-atlas-feature.test.mjs",
    ],
    referenceRepositories: [{
      repositoryResourceId: 10,
      repositoryKey: "os-1",
      repositoryIdentity: "bsvalues/terrafusion_os_1.0",
      role: "integrated-runtime",
      revisionIdentity: referenceRevision,
      access: "read-only",
    }],
  },
  sources: [
    {
      kind: "instruction",
      repositoryResourceId: 12,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      revisionIdentity: targetRevision,
      path: "AGENTS.md",
      blobHash: "b".repeat(64),
    },
    {
      kind: "cross-repository-contract",
      repositoryResourceId: 10,
      repositoryKey: "os-1",
      repositoryIdentity: "bsvalues/terrafusion_os_1.0",
      revisionIdentity: referenceRevision,
      path: "docs/contracts/atlas-projection-v1.md",
      blobHash: "c".repeat(64),
    },
  ],
})

afterEach(cleanup)

describe("Experience V2 assignment context Inspector panel", () => {
  it("discloses the immutable context evidence without implying authority", async () => {
    const user = userEvent.setup()
    render(<ContextLoadedPanel manifest={manifest} />)

    const disclosure = screen.getByRole("group", { name: /Context loaded/i })
    expect(disclosure.getAttribute("open")).toBeNull()
    expect(within(disclosure).getByText("Context evidence · does not grant authority.")).toBeTruthy()
    expect(within(disclosure).getByText("Authority effect").nextElementSibling?.textContent).toBe("none")

    await user.click(within(disclosure).getByText("Context loaded"))
    expect(disclosure.hasAttribute("open")).toBe(true)
  })

  it("shows the exact project, target repository, checkout, and write posture", () => {
    render(<ContextLoadedPanel manifest={manifest} initiallyOpen />)

    const panel = screen.getByRole("group", { name: /Context loaded/i })
    expect(within(panel).getByText("TerraFusion · terrafusion · Project 7")).toBeTruthy()
    expect(within(panel).getByText("WO-ATLAS-1109 · Work Order 1109")).toBeTruthy()
    expect(within(panel).getByText("357243cbd63925c4b7e256e45ba00da69f20fbae012d8702592ab12bd6bbf044")).toBeTruthy()
    expect(within(panel).getByText("bsvalues/terrafusion-atlas")).toBeTruthy()
    expect(within(panel).getByText("Suite source · Atlas")).toBeTruthy()
    expect(within(panel).getByText("atlas-omen-main · OMEN")).toBeTruthy()
    expect(within(panel).getByText("wt-atlas-001")).toBeTruthy()
    expect(within(panel).getByText(targetRevision)).toBeTruthy()
    expect(within(panel).getByText("src/spatial-read/project-atlas-feature.mjs")).toBeTruthy()
    expect(within(panel).getByText("tests/project-atlas-feature.test.mjs")).toBeTruthy()
    expect(within(panel).getByText("write under exact assignment reservation")).toBeTruthy()
  })

  it("shows read-only references and every loaded source with its exact blob identity", () => {
    render(<ContextLoadedPanel manifest={manifest} initiallyOpen />)

    const references = screen.getByRole("list", { name: "Read-only reference repositories" })
    expect(within(references).getByText("bsvalues/terrafusion_os_1.0")).toBeTruthy()
    expect(within(references).getByText(referenceRevision)).toBeTruthy()
    expect(within(references).getByText("Read only")).toBeTruthy()

    const sources = screen.getByRole("list", { name: "Required loaded sources" })
    expect(within(sources).getByText("AGENTS.md")).toBeTruthy()
    expect(within(sources).getByText("b".repeat(64))).toBeTruthy()
    expect(within(sources).getByText("docs/contracts/atlas-projection-v1.md")).toBeTruthy()
    expect(within(sources).getByText("c".repeat(64))).toBeTruthy()
    expect(within(sources).getByText("Instruction")).toBeTruthy()
    expect(within(sources).getByText("Cross-repository contract")).toBeTruthy()
  })

  it("renders an explicit empty reference posture without manufacturing context", () => {
    const isolated = createAssignmentContextManifest({
      assignment: { ...manifest.assignment, assignmentId: "assignment-atlas-isolated" },
      project: { ...manifest.project },
      targetRepository: { ...manifest.targetRepository },
      checkout: { ...manifest.checkout },
      mutationPosture: {
        writablePaths: [...manifest.mutationPosture.target.writablePaths],
        referenceRepositories: [],
      },
      sources: [manifest.sources[0]],
    })

    render(<ContextLoadedPanel manifest={isolated} initiallyOpen />)

    expect(screen.getByText("No read-only reference repositories were loaded.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /grant|authorize|write/i })).toBeNull()
  })
})
