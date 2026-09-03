import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  AssignmentContextManifestError,
  canonicalAssignmentContextManifestBytes,
  createAssignmentContextManifest,
  verifyAssignmentContextManifest,
  type AssignmentContextManifestInput,
} from "@/lib/loom/assignment-context-manifest"

const SHA_A = "a".repeat(40)
const SHA_B = "b".repeat(40)
const DIGEST_C = "c".repeat(64)
const DIGEST_D = "d".repeat(64)
const DIGEST_E = "e".repeat(64)
const DIGEST_F = "f".repeat(64)

function input(): AssignmentContextManifestInput {
  return {
    assignment: {
      assignmentId: "assignment-atlas-001",
      worldId: "space-atlas-integration",
      workOrderId: 1109,
      assignmentHash: DIGEST_C,
      createdAt: "2026-09-02T18:30:00.000Z",
    },
    project: { id: 2, key: "terrafusion", name: "TerraFusion" },
    workOrder: {
      id: 1109,
      ref: "WO-ATLAS-1109",
      version: "2026-09-02T18:20:00.000Z",
      status: "active",
      content: '{"title":"Atlas projection integration"}',
      contentHash: "357243cbd63925c4b7e256e45ba00da69f20fbae012d8702592ab12bd6bbf044",
    },
    targetRepository: {
      repositoryResourceId: 11,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      role: "suite-source",
      suite: "atlas",
    },
    checkout: {
      repositoryMountKey: "hermes:terrafusion-atlas:protected-main",
      nodeIdentity: "hermes",
      worktreeKey: "hermes:terrafusion-atlas:assignment-atlas-001",
      baseRevision: SHA_A,
    },
    mutationPosture: {
      writablePaths: ["src/spatial-read/**"],
      referenceRepositories: [{
        repositoryResourceId: 12,
        repositoryKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        role: "integrated-runtime",
        revisionIdentity: SHA_B,
        access: "read-only",
      }],
    },
    sources: [
      {
        kind: "cross-repository-contract",
        repositoryResourceId: 12,
        repositoryKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        revisionIdentity: SHA_B,
        path: "contracts/atlas-feature-projection.md",
        blobHash: DIGEST_F,
      },
      {
        kind: "instruction",
        repositoryResourceId: 11,
        repositoryKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        revisionIdentity: SHA_A,
        path: "AGENTS.md",
        blobHash: DIGEST_D,
      },
      {
        kind: "project-knowledge",
        repositoryResourceId: 11,
        repositoryKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        revisionIdentity: SHA_A,
        path: "docs/brain/ATLAS_CONTEXT.md",
        blobHash: DIGEST_E,
      },
    ],
  }
}

describe("Experience V2 Assignment Context Manifest", () => {
  it("creates immutable evidence that explicitly grants no mutation authority", () => {
    const manifest = createAssignmentContextManifest(input())

    expect(manifest.schemaVersion).toBe("williamos-assignment-context-manifest.v1")
    expect(manifest.authorityEffect).toBe("none")
    expect(manifest.workOrder).toEqual(input().workOrder)
    expect(manifest.targetRepository).toEqual({
      repositoryResourceId: 11,
      repositoryKey: "atlas",
      repositoryIdentity: "bsvalues/terrafusion-atlas",
      role: "suite-source",
      suite: "atlas",
    })
    expect(manifest.mutationPosture).toEqual({
      target: {
        repositoryResourceId: 11,
        repositoryKey: "atlas",
        repositoryIdentity: "bsvalues/terrafusion-atlas",
        access: "write-under-assignment-reservation",
        writablePaths: ["src/spatial-read/**"],
      },
      references: [{
        repositoryResourceId: 12,
        repositoryKey: "os-1",
        repositoryIdentity: "bsvalues/terrafusion_os_1.0",
        role: "integrated-runtime",
        revisionIdentity: SHA_B,
        access: "read-only",
      }],
    })
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.sources)).toBe(true)
    expect(Object.isFrozen(manifest.sources[0])).toBe(true)
    expect(Object.isFrozen(manifest.mutationPosture.target.writablePaths)).toBe(true)
  })

  it("canonicalizes unordered inputs to one hand-verified manifest digest", () => {
    const first = createAssignmentContextManifest(input())
    const reordered = input()
    reordered.sources.reverse()
    reordered.mutationPosture.writablePaths = ["src/spatial-read/**", "src/spatial-read/**"]
    const second = createAssignmentContextManifest(reordered)

    expect(first.manifestHash).toBe("926314983b659a46df830656cb13077d5620f4ef068f2500745fd4688aaa3fd8")
    expect(second.manifestHash).toBe(first.manifestHash)
    expect(canonicalAssignmentContextManifestBytes(first).toString("utf8")).toContain(
      '"authorityEffect":"none"',
    )
  })

  it("verifies the exact manifest and detects nested tampering", () => {
    const manifest = createAssignmentContextManifest(input())
    expect(verifyAssignmentContextManifest(manifest)).toEqual({ ok: true })

    const tampered = structuredClone(manifest) as unknown as {
      sources: Array<{ blobHash: string }>
    }
    tampered.sources[0].blobHash = "0".repeat(64)
    expect(verifyAssignmentContextManifest(tampered as never)).toEqual({
      ok: false,
      reason: "MANIFEST_HASH_MISMATCH",
    })
  })

  it("binds persisted Work Order content without turning it into authority", () => {
    const manifest = createAssignmentContextManifest(input())
    const tampered = structuredClone(manifest) as unknown as { workOrder: { content: string } }
    tampered.workOrder.content = '{"title":"widened work"}'

    expect(verifyAssignmentContextManifest(tampered as never)).toEqual({
      ok: false,
      reason: "INVALID_MANIFEST",
    })
    expect(manifest.authorityEffect).toBe("none")
  })

  it("rejects a structurally invalid manifest even when its digest is recomputed", () => {
    const malformed = structuredClone(createAssignmentContextManifest(input())) as unknown as Record<string, unknown>
    ;(malformed.targetRepository as Record<string, unknown>).role = "unknown-role"
    malformed.manifestHash = createHash("sha256")
      .update(canonicalAssignmentContextManifestBytes(malformed as never))
      .digest("hex")

    expect(verifyAssignmentContextManifest(malformed as never)).toEqual({
      ok: false,
      reason: "INVALID_MANIFEST",
    })
  })

  it("fails closed when checkout identity, repository role, or context source identity is incomplete", () => {
    const missingWorktree = input()
    missingWorktree.checkout.worktreeKey = ""
    expect(() => createAssignmentContextManifest(missingWorktree)).toThrowError(
      expect.objectContaining({ code: "INVALID_CHECKOUT_IDENTITY" }),
    )

    const suiteWithoutName = input()
    suiteWithoutName.targetRepository.suite = undefined
    expect(() => createAssignmentContextManifest(suiteWithoutName)).toThrowError(
      expect.objectContaining({ code: "INVALID_REPOSITORY_ROLE" }),
    )

    const unknownSourceRepository = input()
    unknownSourceRepository.sources[0].repositoryResourceId = 99
    expect(() => createAssignmentContextManifest(unknownSourceRepository)).toThrowError(
      new AssignmentContextManifestError(
        "UNKNOWN_CONTEXT_SOURCE_REPOSITORY",
        "context source 99 is not the target or a declared read-only reference",
      ),
    )
  })

  it("rejects missing instructions, malformed hashes, and non-canonical writable paths", () => {
    const noInstruction = input()
    noInstruction.sources = noInstruction.sources.filter((source) => source.kind !== "instruction")
    expect(() => createAssignmentContextManifest(noInstruction)).toThrowError(
      expect.objectContaining({ code: "REQUIRED_CONTEXT_MISSING" }),
    )

    const badBlobHash = input()
    badBlobHash.sources[0].blobHash = "not-a-blob-hash"
    expect(() => createAssignmentContextManifest(badBlobHash)).toThrowError(
      expect.objectContaining({ code: "INVALID_CONTEXT_SOURCE" }),
    )

    const escapingPath = input()
    escapingPath.mutationPosture.writablePaths = ["../terrafusion_os_1.0/**"]
    expect(() => createAssignmentContextManifest(escapingPath)).toThrowError(
      expect.objectContaining({ code: "INVALID_MUTATION_POSTURE" }),
    )
  })

  it("fails closed when one loaded document has conflicting blob identities", () => {
    const ambiguous = input()
    ambiguous.sources.push({
      ...ambiguous.sources.find((source) => source.path === "AGENTS.md")!,
      blobHash: DIGEST_F,
    })

    expect(() => createAssignmentContextManifest(ambiguous)).toThrowError(
      expect.objectContaining({ code: "INVALID_CONTEXT_SOURCE" }),
    )
  })
})
