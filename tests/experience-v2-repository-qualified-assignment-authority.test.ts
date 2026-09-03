import { describe, expect, it } from "vitest"

import {
  deriveSpaceMutationAuthority,
  SpaceMutationAuthorityError,
  type SpaceMutationAuthorityRecord,
} from "@/lib/governance/space-mutation-authority"

const atlasRevision = "a".repeat(40)

const atlasBinding = {
  projectId: 7,
  projectKey: "terrafusion",
  repositoryResourceKey: "atlas",
  repositoryIdentity: "bsvalues/terrafusion-atlas",
  repositoryMountKey: "terrafusion:atlas:configured",
  observedRevision: atlasRevision,
  spaceIdentity: "c:/terrafusion",
}

function record(overrides: Partial<SpaceMutationAuthorityRecord> = {}): SpaceMutationAuthorityRecord {
  return {
    world: {
      revision: 12,
      projectId: 7,
      outcomeKey: "OUTCOME-ATLAS",
      workOrderId: 41,
      resources: ["williamos-workspace-root:v1:c:/terrafusion"],
      selectedPath: "src/project-atlas-feature.mjs",
      selectedFileRef: {
        projectIdentity: "c:/terrafusion",
        repositoryResourceKey: "atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        worktreeKey: null,
        observedRevision: atlasRevision,
        path: "src/project-atlas-feature.mjs",
      },
    },
    project: {
      id: 7,
      key: "terrafusion",
      repositoryResourceKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryRelationship: "suite-source",
    },
    outcome: { outcomeKey: "OUTCOME-ATLAS", lifecycleState: "active", activeWorkOrderId: 41 },
    workOrder: {
      id: 41,
      status: "active",
      authorityLevel: "A2_WRITE_OWN",
      authorityGrantId: 51,
      agent: "claude",
      allowed: ["src/project-atlas-feature.mjs"],
      forbidden: [],
    },
    grant: {
      id: 51,
      userId: "owner-1",
      workOrderId: 41,
      grantedTo: "claude",
      status: "active",
      authorityLevel: "A2_WRITE_OWN",
      allowed: ["src/project-atlas-feature.mjs"],
      blocked: [],
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      revokedAt: null,
    },
    ...overrides,
  }
}

const dependencies = (value: SpaceMutationAuthorityRecord | null) => ({
  loadRecord: async () => value,
  now: () => new Date("2030-01-01T00:00:00.000Z"),
})

describe("repository-qualified Space assignment authority", () => {
  it("binds the selected file to the exact server-verified repository, mount and revision", async () => {
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1",
      worldId: "space-atlas",
      binding: atlasBinding,
      expected: { actor: "claude", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: "src/project-atlas-feature.mjs" },
    }, dependencies(record()))).resolves.toMatchObject({
      repositoryResourceKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      observedRevision: atlasRevision,
      selectedPath: "src/project-atlas-feature.mjs",
    })
  })

  it.each([
    ["resource", { binding: { ...atlasBinding, repositoryResourceKey: "forge" } }],
    ["mount", { binding: { ...atlasBinding, repositoryMountKey: "terrafusion:atlas:other" } }],
    ["revision", { binding: { ...atlasBinding, observedRevision: "b".repeat(40) } }],
    ["persisted resource", {
      value: record({
        project: { ...record().project, repositoryResourceKey: "forge" },
      }),
    }],
  ])("refuses a mismatched %s before provider work", async (_label, fixture) => {
    const binding = "binding" in fixture ? fixture.binding : atlasBinding
    const value = "value" in fixture ? fixture.value : record()
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1",
      worldId: "space-atlas",
      binding,
      expected: { actor: "claude", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: "src/project-atlas-feature.mjs" },
    }, dependencies(value))).rejects.toBeInstanceOf(SpaceMutationAuthorityError)
  })

  it("keeps a legacy path-only selection on the persisted primary repository", async () => {
    const primary = record({
      world: { ...record().world, selectedFileRef: null },
      project: {
        ...record().project,
        repositoryResourceKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        repositoryRelationship: "primary-repo",
      },
    })
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1",
      worldId: "space-os1",
      binding: {
        ...atlasBinding,
        repositoryResourceKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        repositoryMountKey: "terrafusion:os-1:configured",
      },
      expected: { actor: "claude", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: "src/project-atlas-feature.mjs" },
    }, dependencies(primary))).resolves.toMatchObject({
      repositoryResourceKey: "os-1",
      repositoryIdentity: "bsvalues/terrafusion_os_1.0",
    })
  })

  it("does not let a legacy path-only selection bind a non-primary repository", async () => {
    const primary = record({
      world: { ...record().world, selectedFileRef: null },
      project: {
        ...record().project,
        repositoryResourceKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        repositoryRelationship: "primary-repo",
      },
    })
    await expect(deriveSpaceMutationAuthority({
      userId: "owner-1",
      worldId: "space-os1",
      binding: atlasBinding,
      expected: { actor: "claude", capability: "selected-file-change" },
      target: { kind: "selected-file", requestedPath: "src/project-atlas-feature.mjs" },
    }, dependencies(primary))).rejects.toBeInstanceOf(SpaceMutationAuthorityError)
  })
})
