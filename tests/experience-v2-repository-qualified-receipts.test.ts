import { beforeEach, describe, expect, it, vi } from "vitest"

const seams = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  poolQuery: vi.fn(),
  release: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  pool: { connect: seams.connect, query: seams.poolQuery },
}))
vi.mock("@/lib/governance/events", () => ({ appendGovernanceEvent: vi.fn() }))

import { commitLoomCodexSuccess, recordLoomCodexAssignment } from "@/lib/loom/receipts"
import { loomCodexThreadDescriptor, loomThreadDescriptor } from "@/lib/loom/threads"
import { createAssignmentContextManifest } from "@/lib/loom/assignment-context-manifest"

const atlasRepository = {
  repositoryResourceKey: "atlas",
  repositoryIdentity: "bsvalues/terrafusion-atlas",
  repositoryMountKey: "terrafusion:atlas:configured",
  observedRevision: "c".repeat(40),
} as const

const contextManifest = createAssignmentContextManifest({
  assignment: {
    assignmentId: "codex-thread-atlas",
    worldId: "world-atlas",
    workOrderId: 41,
    assignmentHash: "a".repeat(64),
    createdAt: "2026-09-02T12:00:00.000Z",
  },
  project: { id: 2, key: "terrafusion", name: "TerraFusion" },
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
    worktreeKey: "codex-thread-atlas",
    baseRevision: "c".repeat(40),
  },
  mutationPosture: {
    writablePaths: ["src/project-atlas-feature.mjs"],
    referenceRepositories: [],
  },
  sources: [{
    kind: "instruction",
    repositoryResourceId: 14,
    repositoryKey: "atlas",
    repositoryIdentity: "bsvalues/terrafusion-atlas",
    revisionIdentity: "c".repeat(40),
    path: "AGENTS.md",
    blobHash: "9".repeat(64),
  }],
})

const assignmentInput = {
  userId: "owner-1",
  threadId: "codex-thread-atlas",
  workspace: "C:/atlas",
  worldId: "world-atlas",
  spaceRevision: 7,
  outcomeId: 5,
  outcomeKey: "OUTCOME-ATLAS",
  outcomeVersion: 3,
  workOrderId: 41,
  workOrderRef: "WO-0041",
  workOrderVersion: "2026-09-02T12:00:00.000Z",
  grantId: 9,
  grantRef: "GRANT-0009",
  grantVersion: "grant-hash",
  allowed: ["src/project-atlas-feature.mjs"],
  forbidden: ["README.md"],
  contracts: [],
  environments: [],
  reservationVersion: "f".repeat(64),
  selectedPath: "src/project-atlas-feature.mjs",
  assignmentHash: "a".repeat(64),
  taskDigest: "d".repeat(64),
  taskText: "Implement the selected Atlas change.",
  executionBindingHash: "e".repeat(64),
  isolatedBaseSha: "c".repeat(40),
  resumed: false,
  contextManifest,
  ...atlasRepository,
}

const successInput = {
  userId: "owner-1",
  threadId: "codex-thread-atlas",
  workspace: "C:/atlas",
  resumed: false,
  worldId: "world-atlas",
  outcomeKey: "OUTCOME-ATLAS",
  workOrderId: 41,
  grantId: 9,
  assignmentHash: "a".repeat(64),
  selectedPath: "src/project-atlas-feature.mjs",
  promotionDigest: "b".repeat(64),
  baseSha: "c".repeat(40),
  taskDigest: "d".repeat(64),
  executionBindingHash: "e".repeat(64),
  contextManifest,
  promotionAudit: {
    userId: "owner-1",
    path: "src/project-atlas-feature.mjs",
    bytes: 26,
    startedAuditId: 77,
    outcome: "SAVED" as const,
    modifiedAt: "2026-09-02T12:01:00.000Z",
  },
  ...atlasRepository,
}

describe("repository-qualified durable Codex receipts", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    seams.connect.mockResolvedValue({ query: seams.query, release: seams.release })
    seams.query.mockResolvedValue({ rows: [] })
    seams.poolQuery.mockResolvedValue({ rows: [{ id: 123 }] })
  })

  it("persists the exact authorized repository mount and observed revision on assignment and ready evidence", async () => {
    await recordLoomCodexAssignment(assignmentInput)
    await commitLoomCodexSuccess(successInput)

    const assignment = JSON.parse(seams.poolQuery.mock.calls[0][1][2])
    const promotion = JSON.parse(seams.query.mock.calls[1][1][2])
    const ready = JSON.parse(seams.query.mock.calls[4][1][2])
    expect(assignment).toMatchObject(atlasRepository)
    expect(assignment.contextManifest).toEqual(contextManifest)
    expect(promotion).toMatchObject(atlasRepository)
    expect(ready).toMatchObject({ committed: true, ...atlasRepository })
    expect(ready.contextManifest).toEqual(contextManifest)
  })

  it("rejects repository-qualified receipts whose context evidence is absent or tampered", async () => {
    await expect(recordLoomCodexAssignment({ ...assignmentInput, contextManifest: undefined }))
      .rejects.toThrow("CODEX_ASSIGNMENT_RECEIPT_CONTEXT_INVALID")
    await expect(recordLoomCodexAssignment({
      ...assignmentInput,
      contextManifest: { ...contextManifest, manifestHash: "0".repeat(64) },
    })).rejects.toThrow("CODEX_ASSIGNMENT_RECEIPT_CONTEXT_INVALID")
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it.each<[Record<string, unknown>, string]>([
    [{ repositoryIdentity: undefined }, "missing identity"],
    [{ repositoryMountKey: undefined }, "missing mount"],
    [{ observedRevision: undefined }, "missing revision"],
    [{ repositoryIdentity: "bsvalues/terrafusion-forge" }, "wrong identity"],
    [{ repositoryMountKey: "terrafusion:forge:configured" }, "wrong mount"],
    [{ observedRevision: "not-a-sha" }, "malformed revision"],
  ])("refuses a secondary repository assignment with %s", async (override) => {
    await expect(recordLoomCodexAssignment({ ...assignmentInput, ...override })).rejects.toThrow(
      "CODEX_ASSIGNMENT_RECEIPT_REPOSITORY_INVALID",
    )
    expect(seams.poolQuery).not.toHaveBeenCalled()
  })

  it("refuses a secondary repository success that no longer matches the server catalog", async () => {
    await expect(commitLoomCodexSuccess({
      ...successInput,
      repositoryIdentity: "bsvalues/terrafusion-dais",
    })).rejects.toThrow("CODEX_SUCCESS_RECEIPT_REPOSITORY_INVALID")
    expect(seams.connect).not.toHaveBeenCalled()
  })

  it("projects an exact repository identity from a committed Codex ready record", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: {
        provider: "Codex",
        mode: "delegate",
        workspace: "C:/atlas",
        committed: true,
        worldId: "world-atlas",
        outcomeKey: "OUTCOME-ATLAS",
        workOrderId: 41,
        grantId: 9,
        assignmentHash: "a".repeat(64),
        selectedPath: "src/project-atlas-feature.mjs",
        ...atlasRepository,
      } }],
    })

    await expect(loomCodexThreadDescriptor("codex-thread-atlas")).resolves.toMatchObject(atlasRepository)
  })

  it("fails closed on partial or catalog-mismatched repository identity in a Codex ready record", async () => {
    for (const metadata of [
      { repositoryResourceKey: "atlas" },
      { ...atlasRepository, repositoryIdentity: "bsvalues/terrafusion-forge" },
    ]) {
      seams.poolQuery.mockResolvedValueOnce({
        rows: [{ userId: "owner-1", metadata: {
          provider: "Codex", mode: "delegate", workspace: "C:/atlas", committed: true,
          worldId: "world-atlas", outcomeKey: "OUTCOME-ATLAS", workOrderId: 41, grantId: 9,
          assignmentHash: "a".repeat(64), selectedPath: "src/project-atlas-feature.mjs",
          ...metadata,
        } }],
      })
      await expect(loomCodexThreadDescriptor("codex-thread-atlas")).resolves.toBeNull()
    }
  })

  it("projects the same exact repository identity for durable Claude thread resume", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: {
        provider: "Claude", mode: "agent", path: "src/project-atlas-feature.mjs",
        ...atlasRepository,
      } }],
    })

    await expect(loomThreadDescriptor("claude-thread-atlas")).resolves.toMatchObject(atlasRepository)
  })

  it("preserves a complete legacy primary-repository descriptor without inventing repository facts", async () => {
    seams.poolQuery.mockResolvedValueOnce({
      rows: [{ userId: "owner-1", metadata: {
        provider: "Codex", mode: "delegate", workspace: "C:/workspace", committed: true,
        worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9,
        assignmentHash: "a".repeat(64), selectedPath: "src/selected.ts",
      } }],
    })

    await expect(loomCodexThreadDescriptor("legacy-primary-thread")).resolves.toEqual({
      owner: "owner-1", provider: "Codex", mode: "delegate", workspace: "C:/workspace",
      worldId: "world-1", outcomeKey: "OUTCOME-1", workOrderId: 41, grantId: 9,
      assignmentHash: "a".repeat(64), selectedPath: "src/selected.ts",
    })
  })
})
