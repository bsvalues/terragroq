import { describe, expect, it } from "vitest"

import { parseAssignmentContextManifestView } from "@/components/workspace-shell/assignment-context-view"
import { createAssignmentContextManifest } from "@/lib/loom/assignment-context-manifest"

function manifest() {
  return createAssignmentContextManifest({
    assignment: {
      assignmentId: "codex-atlas-1",
      worldId: "space-terrafusion",
      workOrderId: 41,
      assignmentHash: "a".repeat(64),
      createdAt: "2026-09-02T12:00:00.000Z",
    },
    project: { id: 2, key: "terrafusion", name: "TerraFusion" },
    workOrder: {
      id: 41,
      ref: "WO-ATLAS-41",
      version: "2026-09-02T11:59:00.000Z",
      status: "active",
      content: '{"title":"Atlas change"}',
      contentHash: "babce273cb1fa9246f7be5317d4f5dcfa77a74d10cec841dadd81ba6542c4b1e",
    },
    targetRepository: {
      repositoryResourceId: 14,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      role: "suite-source",
      suite: "atlas",
    },
    checkout: {
      repositoryMountKey: "terrafusion:atlas:configured",
      nodeIdentity: "omen",
      worktreeKey: "codex-atlas-1",
      baseRevision: "b".repeat(40),
    },
    mutationPosture: { writablePaths: ["src/atlas.ts"], referenceRepositories: [] },
    sources: [{
      kind: "instruction",
      repositoryResourceId: 14,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      revisionIdentity: "b".repeat(40),
      path: "AGENTS.md",
      blobHash: "c".repeat(64),
    }],
  })
}

describe("browser-safe Assignment Context view", () => {
  it("accepts the exact evidence-only server manifest", () => {
    expect(parseAssignmentContextManifestView(manifest())).toEqual(manifest())
  })

  it("fails closed when the Work Order identity does not match the assignment", () => {
    expect(parseAssignmentContextManifestView({
      ...manifest(),
      workOrder: { ...manifest().workOrder!, id: 42 },
    })).toBeNull()
  })

  it.each([
    { authorityEffect: "write" },
    { targetRepository: { ...manifest().targetRepository, repositoryKey: "forge" } },
    { checkout: { ...manifest().checkout, baseRevision: "stale" } },
    { sources: [] },
    { mutationPosture: { ...manifest().mutationPosture, target: { ...manifest().mutationPosture.target, writablePaths: [] } } },
  ])("fails closed on malformed or authority-shaped browser evidence", (override) => {
    expect(parseAssignmentContextManifestView({ ...manifest(), ...override })).toBeNull()
  })
})
