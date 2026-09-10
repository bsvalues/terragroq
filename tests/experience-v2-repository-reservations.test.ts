import { describe, expect, it } from "vitest"

import {
  RepositoryReservationError,
  assessRepositoryReservations,
  type AssignmentReservationSet,
} from "@/lib/loom/repository-reservations"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)

function reservation(
  assignmentId: string,
  overrides: Partial<AssignmentReservationSet> = {},
): AssignmentReservationSet {
  return {
    assignmentId,
    repository: {
      repositoryResourceId: 11,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      repositoryMountKey: "hermes:terrafusion-atlas:protected-main",
      worktreeKey: `hermes:terrafusion-atlas:${assignmentId}`,
      baseRevision: SHA_A,
    },
    paths: ["src/spatial-read/**"],
    contracts: [],
    environments: [],
    ...overrides,
  }
}

describe("Experience V2 repository reservations", () => {
  it("allows non-overlapping work in separate repositories", () => {
    const result = assessRepositoryReservations([
      reservation("atlas-builder"),
      reservation("os-integrator", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:os-integrator",
          baseRevision: SHA_B,
        },
        paths: ["backend/integration/AtlasProjectionConsumer.cs"],
      }),
    ])

    expect(result).toEqual({ status: "compatible", collisions: [], dependencies: [] })
  })

  it("blocks overlapping paths in one logical repository even across isolated worktrees", () => {
    const result = assessRepositoryReservations([
      reservation("atlas-builder"),
      reservation("atlas-second-builder", {
        repository: {
          repositoryResourceId: 11,
          repositoryKey: "atlas",
          repositoryIdentity: "bsvalues/terrafusion-atlas",
          repositoryMountKey: "aegis:terrafusion-atlas:protected-main",
          worktreeKey: "aegis:terrafusion-atlas:atlas-second-builder",
          baseRevision: SHA_A,
        },
        paths: ["src/spatial-read/project-atlas-feature.mjs"],
      }),
    ])

    expect(result).toEqual({
      status: "blocked",
      dependencies: [],
      collisions: [{
        kind: "path",
        leftAssignmentId: "atlas-builder",
        rightAssignmentId: "atlas-second-builder",
        identity: "bsvalues/terrafusion-atlas:src/spatial-read/**",
        reason: "repository path reservations overlap",
      }],
    })
  })

  it("records a producer to consumer dependency without blocking concurrent work", () => {
    const result = assessRepositoryReservations([
      reservation("atlas-builder", {
        contracts: [{
          contractIdentity: "atlas-feature-projection-v1",
          revisionIdentity: "1.0.0",
          role: "producer",
        }],
      }),
      reservation("os-integrator", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:os-integrator",
          baseRevision: SHA_B,
        },
        paths: ["backend/integration/AtlasProjectionConsumer.cs"],
        contracts: [{
          contractIdentity: "atlas-feature-projection-v1",
          revisionIdentity: "1.0.0",
          role: "consumer",
        }],
      }),
    ])

    expect(result).toEqual({
      status: "compatible",
      collisions: [],
      dependencies: [{
        contractIdentity: "atlas-feature-projection-v1",
        revisionIdentity: "1.0.0",
        producerAssignmentId: "atlas-builder",
        consumerAssignmentId: "os-integrator",
      }],
    })
  })

  it("blocks two producers for the same contract revision", () => {
    const contract = [{
      contractIdentity: "atlas-feature-projection-v1",
      revisionIdentity: "1.0.0",
      role: "producer" as const,
    }]
    const result = assessRepositoryReservations([
      reservation("atlas-builder", { contracts: contract }),
      reservation("os-contract-rewriter", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:os-contract-rewriter",
          baseRevision: SHA_B,
        },
        paths: ["contracts/atlas-feature-projection.json"],
        contracts: contract,
      }),
    ])

    expect(result.status).toBe("blocked")
    expect(result.collisions).toEqual([{
      kind: "contract",
      leftAssignmentId: "atlas-builder",
      rightAssignmentId: "os-contract-rewriter",
      identity: "atlas-feature-projection-v1@1.0.0",
      reason: "contract revision has multiple producers",
    }])
  })

  it("blocks competing producers that claim different revisions of one contract", () => {
    const result = assessRepositoryReservations([
      reservation("atlas-v1", {
        contracts: [{ contractIdentity: "atlas-feature-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
      }),
      reservation("os-v2", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:os-v2",
          baseRevision: SHA_B,
        },
        paths: ["contracts/atlas-feature-projection.json"],
        contracts: [{ contractIdentity: "atlas-feature-projection-v1", revisionIdentity: "2.0.0", role: "producer" }],
      }),
    ])

    expect(result.collisions).toEqual([{
      kind: "contract",
      leftAssignmentId: "atlas-v1",
      rightAssignmentId: "os-v2",
      identity: "atlas-feature-projection-v1",
      reason: "contract has competing producer revisions",
    }])
  })

  it("blocks a consumer bound to a different revision of a concurrently produced contract", () => {
    const result = assessRepositoryReservations([
      reservation("atlas-builder", {
        contracts: [{ contractIdentity: "atlas-feature-projection-v1", revisionIdentity: "1.0.0", role: "producer" }],
      }),
      reservation("os-integrator", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:os-integrator",
          baseRevision: SHA_B,
        },
        paths: ["backend/integration/AtlasProjectionConsumer.cs"],
        contracts: [{ contractIdentity: "atlas-feature-projection-v1", revisionIdentity: "0.9.0", role: "consumer" }],
      }),
    ])

    expect(result.collisions).toEqual([{
      kind: "contract",
      leftAssignmentId: "atlas-builder",
      rightAssignmentId: "os-integrator",
      identity: "atlas-feature-projection-v1",
      reason: "contract producer and consumer revisions differ",
    }])
  })

  it("allows shared readers but blocks exclusive use of the same environment", () => {
    const shared = assessRepositoryReservations([
      reservation("atlas-observer", {
        environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "shared-read" }],
      }),
      reservation("os-observer", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:os-observer",
          baseRevision: SHA_B,
        },
        paths: ["backend/integration/AtlasProjectionConsumer.cs"],
        environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "shared-read" }],
      }),
    ])
    expect(shared.status).toBe("compatible")

    const exclusive = assessRepositoryReservations([
      reservation("atlas-observer", {
        environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "shared-read" }],
      }),
      reservation("preview-runner", {
        repository: {
          repositoryResourceId: 12,
          repositoryKey: "os-1",
          repositoryIdentity: "bsvalues/terrafusion_os_1.0",
          repositoryMountKey: "hermes:terrafusion-os-1:protected-main",
          worktreeKey: "hermes:terrafusion-os-1:preview-runner",
          baseRevision: SHA_B,
        },
        paths: ["backend/integration/AtlasProjectionConsumer.cs"],
        environments: [{ environmentIdentity: "preview:terrafusion:3102", access: "exclusive" }],
      }),
    ])
    expect(exclusive.collisions).toEqual([{
      kind: "environment",
      leftAssignmentId: "atlas-observer",
      rightAssignmentId: "preview-runner",
      identity: "preview:terrafusion:3102",
      reason: "environment reservation requires exclusive access",
    }])
  })

  it("fails closed when one repository resource identity is ambiguous", () => {
    expect(() => assessRepositoryReservations([
      reservation("atlas-builder"),
      reservation("ambiguous", {
        repository: {
          repositoryResourceId: 11,
          repositoryKey: "forge",
          repositoryIdentity: "bsvalues/terrafusion-forge",
          repositoryMountKey: "hermes:terrafusion-forge:protected-main",
          worktreeKey: "hermes:terrafusion-forge:ambiguous",
          baseRevision: SHA_A,
        },
        paths: ["src/value.ts"],
      }),
    ])).toThrowError(new RepositoryReservationError(
      "AMBIGUOUS_REPOSITORY_IDENTITY",
      "repository resource 11 resolves to multiple canonical identities",
    ))
  })

  it("fails closed when one repository resource is presented under two repository keys", () => {
    expect(() => assessRepositoryReservations([
      reservation("atlas-builder"),
      reservation("miskeyed", {
        repository: {
          repositoryResourceId: 11,
          repositoryKey: "forge",
          repositoryIdentity: "bsvalues/terrafusion-atlas",
          repositoryMountKey: "aegis:terrafusion-atlas:protected-main",
          worktreeKey: "aegis:terrafusion-atlas:miskeyed",
          baseRevision: SHA_A,
        },
        paths: ["src/value.ts"],
      }),
    ])).toThrowError(expect.objectContaining({ code: "AMBIGUOUS_REPOSITORY_IDENTITY" }))
  })

  it("fails closed on non-canonical paths and unknown identities", () => {
    expect(() => assessRepositoryReservations([
      reservation("bad-path", { paths: ["../outside.ts"] }),
    ])).toThrowError(expect.objectContaining({ code: "INVALID_PATH_RESERVATION" }))

    expect(() => assessRepositoryReservations([
      reservation("unknown-environment", {
        environments: [{ environmentIdentity: " ", access: "exclusive" }],
      }),
    ])).toThrowError(expect.objectContaining({ code: "INVALID_RESERVATION_IDENTITY" }))
  })
})
