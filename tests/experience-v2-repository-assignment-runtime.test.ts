import { describe, expect, it, vi } from "vitest"

import { createAssignmentContextManifest } from "@/lib/loom/assignment-context-manifest"
import {
  ActiveRepositoryAssignmentError,
  assessActiveRepositoryAssignment,
  deriveRepositoryAssignmentReservationClaims,
  projectActiveRepositoryAssignments,
  type RepositoryAssignmentEventRow,
} from "@/lib/loom/repository-assignment-runtime"
import type { AssignmentReservationSet } from "@/lib/loom/repository-reservations"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const DIGEST = "c".repeat(64)

function reservation(
  assignmentId: string,
  overrides: Partial<AssignmentReservationSet> = {},
): AssignmentReservationSet {
  return {
    assignmentId,
    repository: {
      repositoryResourceId: 14,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "terrafusion:atlas:configured",
      worktreeKey: `codex-${assignmentId}`,
      baseRevision: SHA_A,
    },
    paths: ["src/spatial-read/**"],
    contracts: [],
    environments: [],
    ...overrides,
  }
}

function codexAssignment(
  id: number,
  assignmentId: string,
  overrides: Record<string, unknown> = {},
): RepositoryAssignmentEventRow {
  const exact = reservation(assignmentId)
  const worldId = typeof overrides.worldId === "string" ? overrides.worldId : "space-terrafusion"
  const projectId = typeof overrides.projectId === "number" ? overrides.projectId : 2
  const contextManifest = createAssignmentContextManifest({
    assignment: {
      assignmentId,
      worldId,
      workOrderId: 1109,
      assignmentHash: DIGEST,
      createdAt: "2026-09-02T20:00:00.000Z",
    },
    project: { id: projectId, key: "terrafusion", name: "TerraFusion" },
    targetRepository: {
      repositoryResourceId: exact.repository.repositoryResourceId,
      repositoryKey: exact.repository.repositoryKey,
      repositoryIdentity: exact.repository.repositoryIdentity,
      role: "suite-source",
      suite: "atlas",
    },
    checkout: {
      repositoryMountKey: exact.repository.repositoryMountKey,
      nodeIdentity: "omen",
      worktreeKey: exact.repository.worktreeKey,
      baseRevision: exact.repository.baseRevision,
    },
    mutationPosture: { writablePaths: [...exact.paths], referenceRepositories: [] },
    sources: [{
      kind: "instruction",
      repositoryResourceId: exact.repository.repositoryResourceId,
      repositoryKey: exact.repository.repositoryKey,
      repositoryIdentity: exact.repository.repositoryIdentity,
      revisionIdentity: exact.repository.baseRevision,
      path: "AGENTS.md",
      blobHash: "d".repeat(64),
    }],
  })
  return {
    id,
    userId: "owner-1",
    eventType: "EVIDENCE_RECORDED",
    entityType: "loom_codex_assignment",
    entityId: assignmentId,
    metadata: {
      assignmentVersion: "loom-codex-assignment.v1",
      owner: "owner-1",
      threadId: assignmentId,
      worldId,
      workOrder: { id: 1109 },
      assignmentHash: DIGEST,
      isolatedBaseSha: SHA_A,
      repositoryResourceKey: exact.repository.repositoryKey,
      repositoryIdentity: exact.repository.repositoryIdentity,
      repositoryMountKey: exact.repository.repositoryMountKey,
      observedRevision: exact.repository.baseRevision,
      reservation: {
        allowed: [...exact.paths],
        forbidden: [],
        version: DIGEST,
        contracts: [...exact.contracts],
        environments: [...exact.environments],
      },
      contextManifest,
      ...overrides,
    },
    projectId,
    createdAt: "2026-09-02T20:00:00.000Z",
  }
}

function terminal(id: number, assignmentId: string, reason: string | null = null): RepositoryAssignmentEventRow {
  return {
    id,
    userId: "owner-1",
    eventType: "LOOP_STOPPED",
    entityType: "loom_agent",
    entityId: assignmentId,
    metadata: {
      provider: "Codex",
      worldId: "space-terrafusion",
      code: reason ? null : 0,
      reason,
    },
    projectId: 2,
    createdAt: "2026-09-02T20:01:00.000Z",
  }
}

function claudeAssignment(id: number, assignmentId: string): RepositoryAssignmentEventRow {
  const exact = reservation(assignmentId, { paths: ["src/spatial-read/project-atlas-feature.mjs"] })
  const contextManifest = createAssignmentContextManifest({
    assignment: {
      assignmentId,
      worldId: "space-terrafusion",
      workOrderId: 1109,
      assignmentHash: DIGEST,
      createdAt: "2026-09-02T20:00:00.000Z",
    },
    project: { id: 2, key: "terrafusion", name: "TerraFusion" },
    targetRepository: {
      repositoryResourceId: exact.repository.repositoryResourceId,
      repositoryKey: exact.repository.repositoryKey,
      repositoryIdentity: exact.repository.repositoryIdentity,
      role: "suite-source",
      suite: "atlas",
    },
    checkout: {
      repositoryMountKey: exact.repository.repositoryMountKey,
      nodeIdentity: "omen",
      worktreeKey: exact.repository.worktreeKey,
      baseRevision: exact.repository.baseRevision,
    },
    mutationPosture: { writablePaths: [...exact.paths], referenceRepositories: [] },
    sources: [{
      kind: "instruction",
      repositoryResourceId: exact.repository.repositoryResourceId,
      repositoryKey: exact.repository.repositoryKey,
      repositoryIdentity: exact.repository.repositoryIdentity,
      revisionIdentity: exact.repository.baseRevision,
      path: "AGENTS.md",
      blobHash: "d".repeat(64),
    }],
  })
  return {
    id,
    userId: "owner-1",
    eventType: "LOOP_STARTED",
    entityType: "loom_agent",
    entityId: assignmentId,
    metadata: {
      provider: "cloud",
      mode: "agent",
      assignmentVersion: "loom-claude-assignment.v1",
      assignmentId,
      assignmentHash: DIGEST,
      worldId: "space-terrafusion",
      workOrderId: 1109,
      path: "src/spatial-read/project-atlas-feature.mjs",
      repositoryResourceId: exact.repository.repositoryResourceId,
      repositoryResourceKey: exact.repository.repositoryKey,
      repositoryIdentity: exact.repository.repositoryIdentity,
      repositoryMountKey: exact.repository.repositoryMountKey,
      observedRevision: exact.repository.baseRevision,
      isolatedBaseSha: exact.repository.baseRevision,
      reservation: {
        allowed: [...exact.paths], forbidden: [], version: DIGEST, contracts: [], environments: [],
      },
      contextManifest,
    },
    projectId: 2,
    createdAt: "2026-09-02T20:00:00.000Z",
  }
}

describe("Experience V2 active repository assignment runtime", () => {
  it("projects the owner's active Space assignments as a durable set keyed by assignment id", () => {
    const active = codexAssignment(1, "atlas-active")
    const completed = codexAssignment(2, "atlas-complete")
    const projection = projectActiveRepositoryAssignments({
      userId: "owner-1",
      projectId: 2,
      events: [active, completed, terminal(3, "atlas-complete")],
    })

    expect(projection.status).toBe("READY")
    expect(Object.keys(projection.assignmentsById)).toEqual(["atlas-active"])
    expect(projection.assignmentsById["atlas-active"]).toEqual({
      ...reservation("atlas-active"),
      worldId: "space-terrafusion",
      projectId: 2,
    })
  })

  it.each(["FAILED", "CANCELLED"])("releases a %s assignment after its durable terminal event", (reason) => {
    const projection = projectActiveRepositoryAssignments({
      userId: "owner-1",
      projectId: 2,
      events: [codexAssignment(1, "atlas-terminal"), terminal(2, "atlas-terminal", reason)],
    })

    expect(projection).toMatchObject({ status: "READY", assignmentsById: {} })
  })

  it("assesses a candidate against current active path, contract, and environment reservations", async () => {
    const active = codexAssignment(1, "atlas-active", {
      reservation: {
        allowed: ["src/spatial-read/**"], forbidden: [], version: DIGEST,
        contracts: [{ contractIdentity: "atlas-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
        environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "shared-read" }],
      },
    })
    const loadEvents = vi.fn(async () => [active])
    const candidate = reservation("atlas-second", {
      paths: ["src/spatial-read/project-atlas-feature.mjs"],
      contracts: [{ contractIdentity: "atlas-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
      environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "exclusive" }],
    })

    const result = await assessActiveRepositoryAssignment({
      userId: "owner-1", worldId: "space-terrafusion", projectId: 2, candidate,
    }, { loadEvents })

    expect(loadEvents).toHaveBeenCalledWith("owner-1", 2)
    expect(result.status).toBe("BLOCKED")
    if (result.status === "BLOCKED") {
      expect(result.collisions.map((collision) => collision.kind)).toEqual(["contract", "environment", "path"])
    }
  })

  it("revalidates the same assignment id for promotion without colliding with itself", async () => {
    const candidate = reservation("atlas-active")
    const result = await assessActiveRepositoryAssignment({
      userId: "owner-1", worldId: "space-terrafusion", projectId: 2, candidate,
    }, { loadEvents: async () => [codexAssignment(1, "atlas-active")] })

    expect(result).toEqual({ status: "COMPATIBLE", activeAssignments: [], dependencies: [] })
  })

  it("fails closed when a persisted Codex repository or reservation record is partial", () => {
    const event = codexAssignment(1, "atlas-malformed")
    const metadata = event.metadata as Record<string, unknown>
    delete metadata.repositoryMountKey

    expect(() => projectActiveRepositoryAssignments({
      userId: "owner-1", projectId: 2, events: [event],
    })).toThrowError(new ActiveRepositoryAssignmentError(
      "MALFORMED_PERSISTED_ASSIGNMENT",
      "assignment atlas-malformed has a partial or inconsistent repository reservation",
    ))
  })

  it("does not infer an empty contract or environment reservation from omitted persisted facts", () => {
    const event = codexAssignment(1, "atlas-reservation-partial")
    const metadata = event.metadata as Record<string, unknown>
    const reservationMetadata = metadata.reservation as Record<string, unknown>
    delete reservationMetadata.environments

    expect(() => projectActiveRepositoryAssignments({
      userId: "owner-1", projectId: 2, events: [event],
    })).toThrowError(expect.objectContaining({ code: "MALFORMED_PERSISTED_ASSIGNMENT" }))
  })

  it("fails closed when the same assignment id is reused with changed reservation facts", async () => {
    const candidate = reservation("atlas-active", { paths: ["src/other.ts"] })

    await expect(assessActiveRepositoryAssignment({
      userId: "owner-1", worldId: "space-terrafusion", projectId: 2, candidate,
    }, { loadEvents: async () => [codexAssignment(1, "atlas-active")] }))
      .rejects.toMatchObject({ code: "ASSIGNMENT_IDENTITY_REUSED" })
  })

  it("returns a typed fail-closed limitation for an active Claude mutation lacking exact checkout facts", async () => {
    const result = await assessActiveRepositoryAssignment({
      userId: "owner-1",
      worldId: "space-terrafusion",
      projectId: 2,
      candidate: reservation("atlas-candidate"),
    }, { loadEvents: async () => [{
      id: 7,
      userId: "owner-1",
      eventType: "LOOP_STARTED",
      entityType: "loom_agent",
      entityId: "claude-atlas",
      metadata: {
        provider: "claude", mode: "agent", worldId: "space-terrafusion",
        path: "src/spatial-read/project-atlas-feature.mjs",
        repositoryResourceKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        repositoryMountKey: "terrafusion:atlas:configured",
        observedRevision: SHA_A,
      },
      projectId: 2,
      createdAt: "2026-09-02T20:00:00.000Z",
    }] })

    expect(result).toEqual({
      status: "LIMITED",
      activeAssignments: [],
      limitations: [{
        assignmentId: "claude-atlas",
        worldId: "space-terrafusion",
        projectId: 2,
        code: "CLAUDE_EXACT_RESERVATION_UNAVAILABLE",
        detail: "active Claude mutation does not persist an exact resource id, worktree, and reservation set",
      }],
    })
  })

  it("projects an exact Claude mutation and releases it by its recorded assignment identity", () => {
    const projection = projectActiveRepositoryAssignments({
      userId: "owner-1",
      projectId: 2,
      events: [
        claudeAssignment(1, "claude:atlas-exact"),
        {
          ...terminal(2, "claude-session-id"),
          metadata: {
            provider: "cloud",
            mode: "agent",
            worldId: "space-terrafusion",
            assignmentId: "claude:atlas-exact",
            code: 0,
            reason: null,
          },
        },
      ],
    })

    expect(projection).toMatchObject({ status: "READY", assignmentsById: {} })
  })

  it("blocks another assignment against an exact active Claude path reservation", async () => {
    const result = await assessActiveRepositoryAssignment({
      userId: "owner-1",
      worldId: "space-terrafusion",
      projectId: 2,
      candidate: reservation("codex-atlas-candidate", {
        paths: ["src/spatial-read/project-atlas-feature.mjs"],
      }),
    }, { loadEvents: async () => [claudeAssignment(1, "claude:atlas-exact")] })

    expect(result.status).toBe("BLOCKED")
    if (result.status === "BLOCKED") {
      expect(result.collisions).toEqual([expect.objectContaining({ kind: "path" })])
    }
  })

  it("assesses active assignments in another Space of the same owner and Project", async () => {
    const result = await assessActiveRepositoryAssignment({
      userId: "owner-1",
      worldId: "space-terrafusion",
      projectId: 2,
      candidate: reservation("space-a-candidate"),
    }, { loadEvents: async () => [codexAssignment(1, "space-b-active", { worldId: "space-other" })] })

    expect(result.status).toBe("BLOCKED")
    if (result.status === "BLOCKED") {
      expect(result.activeAssignments).toEqual([
        expect.objectContaining({ assignmentId: "space-b-active", worldId: "space-other", projectId: 2 }),
      ])
      expect(result.collisions).toEqual([expect.objectContaining({ kind: "path" })])
    }
  })

  it("does not let a terminal event from another Space release an active assignment", () => {
    const projection = projectActiveRepositoryAssignments({
      userId: "owner-1",
      projectId: 2,
      events: [
        codexAssignment(1, "atlas-active"),
        { ...terminal(2, "atlas-active"), metadata: { worldId: "space-other", reason: null, code: 0 } },
      ],
    })

    expect(projection.assignmentsById["atlas-active"]).toMatchObject({
      assignmentId: "atlas-active",
      worldId: "space-terrafusion",
      projectId: 2,
    })
  })

  it("fails closed when one assignment identity is reused by two Spaces", () => {
    expect(() => projectActiveRepositoryAssignments({
      userId: "owner-1",
      projectId: 2,
      events: [
        codexAssignment(1, "shared-identity"),
        codexAssignment(2, "shared-identity", { worldId: "space-other" }),
      ],
    })).toThrowError(expect.objectContaining({ code: "ASSIGNMENT_IDENTITY_REUSED" }))
  })

  it("ignores other owners and Projects while retaining other Spaces in the same Project", () => {
    const foreignOwner = { ...codexAssignment(1, "foreign-owner"), userId: "owner-2" }
    const foreignProject = codexAssignment(2, "foreign-project", { worldId: "space-other", projectId: 8 })
    const projection = projectActiveRepositoryAssignments({
      userId: "owner-1", projectId: 2, events: [foreignOwner, foreignProject],
    })

    expect(projection).toMatchObject({ status: "READY", assignmentsById: {} })
  })

  it("derives semantic and environment claims only from one exact server-owned grant scope", async () => {
    const claims = await deriveRepositoryAssignmentReservationClaims({
      userId: "owner-1", workOrderId: 1109, grantId: 55,
    }, { loadAuthority: async () => ({
      workOrderId: 1109,
      workOrderUserId: "owner-1",
      authorityGrantId: 55,
      grantId: 55,
      grantUserId: "owner-1",
      grantWorkOrderId: 1109,
      grantScope: JSON.stringify({
        version: "williamos-repository-reservation-scope.v1",
        contracts: [{ contractIdentity: "atlas-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
        environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "exclusive" }],
      }),
    }) })

    expect(claims).toEqual({
      contracts: [{ contractIdentity: "atlas-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
      environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "exclusive" }],
    })
  })

  it.each([
    ["missing", null],
    ["legacy prose", "WO-1109"],
    ["partial", JSON.stringify({ version: "williamos-repository-reservation-scope.v1", contracts: [] })],
  ])("fails closed when %s server-owned reservation claims cannot be proven", async (_label, grantScope) => {
    await expect(deriveRepositoryAssignmentReservationClaims({
      userId: "owner-1", workOrderId: 1109, grantId: 55,
    }, { loadAuthority: async () => grantScope === null ? null : ({
      workOrderId: 1109,
      workOrderUserId: "owner-1",
      authorityGrantId: 55,
      grantId: 55,
      grantUserId: "owner-1",
      grantWorkOrderId: 1109,
      grantScope,
    }) })).rejects.toMatchObject({ code: "ASSIGNMENT_RESERVATION_CLAIMS_UNAVAILABLE" })
  })
})
