import { describe, expect, it, vi } from "vitest"

import {
  finalizeExternalProductTerminalOutcome,
  type ExternalProductTerminalSettlementDependencies,
} from "@/lib/environment/external-product-terminal-settlement"
import { WACO_PRODUCT_TERMINAL_BINDING } from "@/lib/environment/external-product-terminal-receipt"

const proof = {
  protectedCommit: "a".repeat(40),
  catalogPath: "os-platform/core/canon/release-closeout/catalog.json",
  catalogSha256: "1".repeat(64),
  receiptPath: WACO_PRODUCT_TERMINAL_BINDING.receiptPath,
  receiptSha256: "2".repeat(64),
  profilePath: WACO_PRODUCT_TERMINAL_BINDING.profilePath,
  profileSha256: "3".repeat(64),
  receiptId: `tf-product-terminal:${"4".repeat(64)}`,
  contentSha256: "4".repeat(64),
  productId: "terrafusion",
  repository: WACO_PRODUCT_TERMINAL_BINDING.repository,
  terminalState: WACO_PRODUCT_TERMINAL_BINDING.terminalState,
  releaseId: "waco-2026",
  releaseSha: WACO_PRODUCT_TERMINAL_BINDING.releaseSha,
  deploymentId: "omen-waco-2026",
  acceptedAt: "2026-09-06",
  limitations: ["not statewide", "not production"],
} as const

function dependencies(overrides: Partial<ExternalProductTerminalSettlementDependencies> = {}) {
  return {
    resolveWorkspaceBinding: vi.fn(async () => ({
      ok: true as const,
      binding: {
        workspaceRoot: "C:/TerraFusion",
        repositoryIdentity: WACO_PRODUCT_TERMINAL_BINDING.repository,
        repositoryResourceId: 7,
        projectId: 4,
      },
    })),
    loadProof: vi.fn(async () => proof),
    settle: vi.fn(async () => ({
      status: "PRODUCT_TERMINAL_SETTLED" as const,
      replayed: false,
      worldId: "world-waco",
      outcomeKey: `external:${WACO_PRODUCT_TERMINAL_BINDING.provenanceDigest}`,
      workOrderId: 101,
      terminalState: WACO_PRODUCT_TERMINAL_BINDING.terminalState,
      releaseSha: WACO_PRODUCT_TERMINAL_BINDING.releaseSha,
      protectedCommit: proof.protectedCommit,
    })),
    ...overrides,
  } satisfies ExternalProductTerminalSettlementDependencies
}

describe("external product terminal settlement", () => {
  it("derives the repository mount and protected proof server-side before settling", async () => {
    const deps = dependencies()
    await expect(finalizeExternalProductTerminalOutcome({
      userId: "owner", worldId: "world-waco",
    }, deps)).resolves.toMatchObject({ status: "PRODUCT_TERMINAL_SETTLED", replayed: false })

    expect(deps.resolveWorkspaceBinding).toHaveBeenCalledWith("owner")
    expect(deps.loadProof).toHaveBeenCalledWith({
      workspaceRoot: "C:/TerraFusion",
      repository: WACO_PRODUCT_TERMINAL_BINDING.repository,
    })
    expect(deps.settle).toHaveBeenCalledWith(expect.objectContaining({
      userId: "owner", worldId: "world-waco", projectId: 4,
      repositoryResourceId: 7, proof,
    }))
  })

  it("fails closed when the resolved mount is not the exact TerraFusion OS 1.0 repository", async () => {
    const deps = dependencies({
      resolveWorkspaceBinding: vi.fn(async () => ({
        ok: true as const,
        binding: {
          workspaceRoot: "C:/Wrong",
          repositoryIdentity: "bsvalues/terrafusion-os",
          repositoryResourceId: 8,
          projectId: 4,
        },
      })),
    })
    await expect(finalizeExternalProductTerminalOutcome({
      userId: "owner", worldId: "world-waco",
    }, deps)).rejects.toThrow("PRODUCT_TERMINAL_PROVENANCE_INVALID")
    expect(deps.loadProof).not.toHaveBeenCalled()
    expect(deps.settle).not.toHaveBeenCalled()
  })
})
