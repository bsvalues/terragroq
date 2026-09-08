import { createHash } from "node:crypto"

import { describe, expect, it } from "vitest"

import { hashRecord } from "@/lib/governance/hash"
import {
  WACO_PRODUCT_TERMINAL_BINDING,
  loadProtectedProductTerminalProof,
  validateProductTerminalReceipt,
  verifyProtectedProductTerminalArtifacts,
} from "@/lib/environment/external-product-terminal-receipt"

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex")

function validReceipt(profileSha256 = "a".repeat(64)) {
  const sha = (digit: string) => digit.repeat(64)
  const evidence = Array.from({ length: 16 }, (_, index) => ({
    id: `evidence-${index}`,
    root: index % 2 === 0 ? "source" : "evidence",
    path: `evidence/item-${index}.json`,
    sha256: sha(((index % 9) + 1).toString()),
    bytes: index + 1,
  }))
  const content = {
    schemaVersion: "terrafusion.product-terminal-receipt.v1",
    productId: "terrafusion",
    repository: "bsvalues/terrafusion_os_1.0",
    terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
    releaseId: "waco-2026",
    releaseSha: "35e32462d9758473e3a193388cd50786dc63cc17",
    deploymentId: "omen-waco-2026",
    machine: "OMEN",
    authority: {
      surface: "terracanon",
      mode: "local-maintenance",
      profileId: "waco-2026",
      profileSha256,
    },
    acceptedAt: "2026-09-07",
    countyPackage: {
      countyId: "b7c9fef3-cf48-45f4-967f-d3b9d265876d",
      county: "Benton",
      countyCode: "005",
      classification: "COUNTY_DERIVED_CONFERENCE_SAFE_BOUNDED_READ_ONLY_NOT_DOR_CERTIFIED",
      sales: 50,
      computableRatios: 0,
      manifestSha256: sha("b"),
      salesSha256: sha("c"),
      sourcePayloadSha256: sha("d"),
    },
    deployment: {
      scope: "Bounded local WACO conference release",
      containers: Array.from({ length: 6 }, (_, index) => ({
        name: `container-${index}`,
        id: sha(((index % 9) + 1).toString()),
        image: `sha256:${sha(((index + 1) % 9 + 1).toString())}`,
      })),
      restart: Array.from({ length: 4 }, (_, index) => ({
        name: `restart-${index}`,
        id: sha(((index % 9) + 1).toString()),
        image: `sha256:${sha(((index + 1) % 9 + 1).toString())}`,
        before: `before-${index}`,
        after: `after-${index}`,
      })),
      restorationProven: true,
    },
    assurance: {
      executionVerdict: "INDEPENDENT_F_BOUNDED_EXECUTION_PASS",
      sealVerdict: "SEAL_REVIEW_PASS",
      originalSealStatus: "FINAL_RC_LOCAL_SEAL_PENDING_INDEPENDENT_F",
      executionReviewSha256: sha("e"),
      sealReviewSha256: sha("f"),
    },
    recovery: {
      rollbackContainers: Array.from({ length: 3 }, (_, index) => ({
        name: `rollback-${index}`,
        id: sha(((index % 9) + 1).toString()),
        image: `sha256:${sha(((index + 1) % 9 + 1).toString())}`,
        original: `container-${index}`,
      })),
      archive: { sha256: sha("1"), bytes: 10, imageCount: 6, restoredFromArchive: false },
      databaseBackup: false,
      recoveryTested: false,
    },
    acceptanceEvidence: evidence,
    limitations: Array.from({ length: 8 }, (_, index) => `limitation-${index}`),
    statewideLaunchComplete: false,
    productionDeployed: false,
  } as const
  const contentSha256 = hashRecord(content)
  return { ...content, receiptId: `tf-product-terminal:${contentSha256}`, contentSha256 }
}

function validArtifacts() {
  const initialReceipt = validReceipt()
  const profileObject = {
    schemaVersion: 1,
    profileId: "waco-2026",
    productId: "terrafusion",
    repository: "bsvalues/terrafusion_os_1.0",
    releaseId: "waco-2026",
    terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
    releaseSha: "35e32462d9758473e3a193388cd50786dc63cc17",
    deploymentId: "omen-waco-2026",
    machine: "OMEN",
    acceptedAt: initialReceipt.acceptedAt,
    scope: initialReceipt.deployment.scope,
    countyId: initialReceipt.countyPackage.countyId,
    county: initialReceipt.countyPackage.county,
    countyCode: initialReceipt.countyPackage.countyCode,
    classification: initialReceipt.countyPackage.classification,
    // The canonical producer orders policy inventories for humans and receipt inventories
    // independently. Equivalent sets must verify without weakening any entry identity.
    containers: [...initialReceipt.deployment.containers].reverse(),
    restart: [...initialReceipt.deployment.restart].reverse(),
    rollback: [...initialReceipt.recovery.rollbackContainers].reverse(),
    limitations: [...initialReceipt.limitations].reverse(),
    files: [...initialReceipt.acceptanceEvidence].reverse().map((entry) => ({ ...entry, format: "json" })),
  }
  const profile = `${JSON.stringify(profileObject)}\n`
  const receipt = `${JSON.stringify(validReceipt(digest(profile)))}\n`
  const catalog = `${JSON.stringify({
    schemaVersion: "terrafusion.product-terminal-catalog.v1",
    productId: "terrafusion",
    repository: "bsvalues/terrafusion_os_1.0",
    releases: [{
      releaseId: "waco-2026",
      terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
      releaseSha: "35e32462d9758473e3a193388cd50786dc63cc17",
      deploymentId: "omen-waco-2026",
      receipt: {
        path: "os-platform/core/canon/release-closeout/receipts/waco-2026.product-terminal.json",
        sha256: digest(receipt),
      },
      profile: {
        path: "os-platform/core/canon/release-closeout/waco-2026.policy.json",
        sha256: digest(profile),
      },
    }],
  })}\n`
  return { catalog, receipt, profile }
}

describe("TerraFusion protected product terminal receipt", () => {
  it("accepts the exact WACO receipt and preserves its narrow limitations", () => {
    const receipt = validateProductTerminalReceipt(validReceipt())
    expect(receipt.receiptId).toBe(`tf-product-terminal:${receipt.contentSha256}`)
    expect(receipt.statewideLaunchComplete).toBe(false)
    expect(receipt.productionDeployed).toBe(false)
  })

  it.each([
    ["unknown field", (receipt: Record<string, unknown>) => { receipt.unreviewed = true }],
    ["semantic digest drift", (receipt: Record<string, unknown>) => { receipt.contentSha256 = "0".repeat(64) }],
    ["broader terminal claim", (receipt: Record<string, unknown>) => { receipt.productionDeployed = true }],
    ["different release", (receipt: Record<string, unknown>) => { receipt.releaseId = "statewide" }],
  ])("rejects %s", (_label, mutate) => {
    const receipt = structuredClone(validReceipt()) as unknown as Record<string, unknown>
    mutate(receipt)
    expect(() => validateProductTerminalReceipt(receipt)).toThrow("PRODUCT_TERMINAL_RECEIPT_INVALID")
  })

  it("binds catalog, receipt, and profile raw bytes to one immutable protected commit", () => {
    const artifacts = validArtifacts()
    expect(verifyProtectedProductTerminalArtifacts({
      protectedCommit: "1".repeat(40),
      catalogBytes: Buffer.from(artifacts.catalog),
      receiptBytes: Buffer.from(artifacts.receipt),
      profileBytes: Buffer.from(artifacts.profile),
      expected: WACO_PRODUCT_TERMINAL_BINDING,
    })).toMatchObject({
      protectedCommit: "1".repeat(40),
      receiptId: expect.stringMatching(/^tf-product-terminal:[0-9a-f]{64}$/),
      terminalState: "WACO_2026_TERRAFUSION_RELEASE_READY",
      releaseSha: "35e32462d9758473e3a193388cd50786dc63cc17",
    })
  })

  it("loads every protected artifact from the same server-resolved commit", async () => {
    const artifacts = validArtifacts()
    const commit = "1".repeat(40)
    const blobs = new Map([
      ["os-platform/core/canon/release-closeout/catalog.json", artifacts.catalog],
      ["os-platform/core/canon/release-closeout/receipts/waco-2026.product-terminal.json", artifacts.receipt],
      ["os-platform/core/canon/release-closeout/waco-2026.policy.json", artifacts.profile],
    ])
    const proof = await loadProtectedProductTerminalProof({
      workspaceRoot: "C:/verified/terrafusion",
      repository: "bsvalues/terrafusion_os_1.0",
    }, {
      resolveProtectedMain: async (root, repository) => {
        if (root !== "C:/verified/terrafusion" || repository !== "bsvalues/terrafusion_os_1.0") throw new Error("wrong binding")
        return commit
      },
      readBlob: async (root, requestedCommit, requestedPath) => {
        if (root !== "C:/verified/terrafusion" || requestedCommit !== commit) throw new Error("mixed commit")
        const value = blobs.get(requestedPath)
        if (!value) throw new Error("unexpected path")
        return Buffer.from(value)
      },
    })
    expect(proof.protectedCommit).toBe(commit)
    expect(proof.catalogSha256).toBe(digest(artifacts.catalog))
  })

  it.each([
    ["receipt raw bytes", (artifacts: ReturnType<typeof validArtifacts>) => { artifacts.receipt += "\n" }],
    ["profile raw bytes", (artifacts: ReturnType<typeof validArtifacts>) => { artifacts.profile += "\n" }],
    ["catalog-selected path", (artifacts: ReturnType<typeof validArtifacts>) => {
      artifacts.catalog = artifacts.catalog.replace(
        "os-platform/core/canon/release-closeout/receipts/waco-2026.product-terminal.json",
        "os-platform/core/canon/release-closeout/receipts/other.json",
      )
    }],
  ])("rejects drift in %s", (_label, mutate) => {
    const artifacts = validArtifacts()
    mutate(artifacts)
    expect(() => verifyProtectedProductTerminalArtifacts({
      protectedCommit: "1".repeat(40),
      catalogBytes: Buffer.from(artifacts.catalog),
      receiptBytes: Buffer.from(artifacts.receipt),
      profileBytes: Buffer.from(artifacts.profile),
      expected: WACO_PRODUCT_TERMINAL_BINDING,
    })).toThrow("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  })

  it.each([
    ["unknown profile field", (profile: Record<string, unknown>) => { profile.unreviewed = true }],
    ["profile county contradiction", (profile: Record<string, unknown>) => { profile.countyCode = "999" }],
    ["profile evidence omission", (profile: Record<string, unknown>) => {
      profile.files = (profile.files as unknown[]).slice(1)
    }],
  ])("rejects %s even when the catalog hash matches those bytes", (_label, mutate) => {
    const artifacts = validArtifacts()
    const profile = JSON.parse(artifacts.profile) as Record<string, unknown>
    mutate(profile)
    artifacts.profile = `${JSON.stringify(profile)}\n`
    const catalog = JSON.parse(artifacts.catalog) as {
      releases: Array<{ profile: { sha256: string } }>
    }
    catalog.releases[0].profile.sha256 = digest(artifacts.profile)
    artifacts.catalog = `${JSON.stringify(catalog)}\n`
    const receipt = JSON.parse(artifacts.receipt) as ReturnType<typeof validReceipt>
    const { receiptId: _receiptId, contentSha256: _contentSha256, ...content } = receipt
    receipt.authority.profileSha256 = digest(artifacts.profile)
    receipt.contentSha256 = hashRecord(content)
    receipt.receiptId = `tf-product-terminal:${receipt.contentSha256}`
    artifacts.receipt = `${JSON.stringify(receipt)}\n`
    catalog.releases[0].receipt.sha256 = digest(artifacts.receipt)
    artifacts.catalog = `${JSON.stringify(catalog)}\n`
    expect(() => verifyProtectedProductTerminalArtifacts({
      protectedCommit: "1".repeat(40),
      catalogBytes: Buffer.from(artifacts.catalog),
      receiptBytes: Buffer.from(artifacts.receipt),
      profileBytes: Buffer.from(artifacts.profile),
      expected: WACO_PRODUCT_TERMINAL_BINDING,
    })).toThrow("PRODUCT_TERMINAL_PROVENANCE_INVALID")
  })
})
