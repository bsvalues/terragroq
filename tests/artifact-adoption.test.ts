import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it, vi } from "vitest"

import {
  authorizeProspectiveArtifactAdoption,
  issueProspectiveArtifactAdoptionSeal,
  previewProspectiveArtifactAdoption,
  recordProspectiveArtifactAdoptionEvidence,
  type ArtifactAdoptionDependencies,
} from "@/lib/governance/artifact-adoption"
import { verifyWilliamOSDeliverySeal } from "@/lib/governance/delivery-seal"

const digest = (value: string) => value.repeat(64).slice(0, 64)
const head = "2".repeat(40)
const base = "1".repeat(40)
const paths = ["app/a.ts", "lib/b.ts"]

const context = {
  owner: "owner-1", worldId: "space-1", spaceRevision: 9, workspace: "C:/repo",
  repository: "https://github.com/bsvalues/terragroq", pullRequest: 1117, admittedHeadSha: head,
  outcome: { id: 11, key: "EXPERIENCE_V2", version: 4 },
  workOrder: { id: 22, ref: "WO-22", version: "work-v1" },
  grant: { id: 33, ref: "GRANT-33", version: "grant-v1", expiresAt: "2026-09-01T00:00:00.000Z" },
  reservation: { allowed: paths, forbidden: ["terrafusion/**"], version: digest("a") },
} as const

const identity = { pullRequest: 1117, state: "OPEN" as const, headSha: head, baseSha: base, paths }
const evidence = {
  adoptionHash: digest("f"), pullRequest: 1117, state: "OPEN" as const, headSha: head, paths,
  checksGreen: true, checksComplete: true, reviewed: true, reviewCompleted: true,
  isDraft: false, reviewDecision: "",
  unresolvedThreadCount: 0, validationEvidenceDigest: digest("b"), reviewEvidenceDigest: digest("c"),
}

function dependencies(overrides: Partial<ArtifactAdoptionDependencies> = {}): ArtifactAdoptionDependencies {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return {
    loadContext: vi.fn().mockResolvedValue(context),
    inspectArtifactIdentity: vi.fn().mockResolvedValue(identity),
    recordAuthorization: vi.fn().mockImplementation(async (_user, authorization) => ({ eventId: 101, authorization })),
    loadAuthorization: vi.fn().mockResolvedValue(null),
    inspectAuthorizedEvidence: vi.fn().mockResolvedValue(evidence),
    recordEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103 }),
    loadEvidence: vi.fn().mockResolvedValue(null),
    inspectDelivery: vi.fn().mockResolvedValue({ repository: context.repository, baseSha: base, commitSha: head, paths, patchDigest: digest("d"), contentDigest: digest("e") }),
    signingKey: { privateKey, publicKey, keyId: "test-key" },
    recordSeal: vi.fn().mockImplementation(async (_user, _authorization, _validation, _review, seal) => seal),
    now: () => new Date("2026-08-31T20:00:00.000Z"),
    ...overrides,
  }
}

async function authorizeFixture(deps: ArtifactAdoptionDependencies) {
  const preview = await previewProspectiveArtifactAdoption({ userId: "owner-1", worldId: "space-1" }, deps)
  return (await authorizeProspectiveArtifactAdoption({
    userId: "owner-1", worldId: "space-1", idempotencyKey: "adopt-pr-1117-head",
    confirmedPreviewDigest: preview.previewDigest,
  }, deps)).authorization
}

describe("prospective exact-artifact adoption", () => {
  it("persists prospective authorization before any validation or review evidence is inspected", async () => {
    const order: string[] = []
    let persisted: { eventId: number; authorization: Awaited<ReturnType<typeof authorizeFixture>> } | null = null
    const deps = dependencies({
      recordAuthorization: vi.fn().mockImplementation(async (_user, authorization) => {
        order.push("authorized")
        persisted = { eventId: 101, authorization }
        return persisted
      }),
      loadAuthorization: vi.fn().mockImplementation(async () => persisted),
      inspectAuthorizedEvidence: vi.fn().mockImplementation(async (authorization) => {
        order.push("evidence-inspected")
        return { ...evidence, adoptionHash: authorization.adoptionHash }
      }),
    })
    const authorized = await authorizeFixture(deps)
    expect(order).toEqual(["authorized"])

    const recorded = await recordProspectiveArtifactAdoptionEvidence({
      userId: "owner-1", authorizationEventId: 101, authorization: authorized,
    }, deps)
    expect(order).toEqual(["authorized", "evidence-inspected"])
    expect(recorded.evidence.adoptionHash).toBe(authorized.adoptionHash)
    expect(deps.recordEvidence).toHaveBeenCalledWith("owner-1", 101, authorized, recorded.evidence)
  })

  it("issues v2 only from persisted post-authorization evidence bound to adoption hash, head, and paths", async () => {
    const authorization = await authorizeFixture(dependencies())
    const boundEvidence = { ...evidence, adoptionHash: authorization.adoptionHash }
    const deps = dependencies({
      loadAuthorization: vi.fn().mockResolvedValue({ eventId: 101, authorization }),
      loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: boundEvidence }),
    })
    const seal = await issueProspectiveArtifactAdoptionSeal({ userId: "owner-1", adoptionHash: authorization.adoptionHash }, deps)

    expect(seal.payload).toMatchObject({
      version: "williamos-delivery-seal.v2", authorityKind: "prospective_artifact_adoption",
      adoption: {
        adoptionHash: authorization.adoptionHash, owner: "owner-1", worldId: "space-1",
        artifact: { pullRequest: 1117, headSha: head, paths },
        evidence: { validationDigest: digest("b"), reviewDigest: digest("c"), validationHeadSha: head, reviewHeadSha: head },
      },
      delivery: { baseSha: base, commitSha: head, paths, patchDigest: digest("d") },
    })
    expect("assignment" in seal.payload).toBe(false)
    expect(verifyWilliamOSDeliverySeal(seal, { "test-key": deps.signingKey!.publicKey })).toBe(true)
  })

  it("rejects evidence before durable authorization and evidence bound to another adoption", async () => {
    const authorization = await authorizeFixture(dependencies())
    await expect(recordProspectiveArtifactAdoptionEvidence({
      userId: "owner-1", authorizationEventId: 0, authorization,
    }, dependencies())).rejects.toMatchObject({ code: "DELIVERY_SEAL_ASSIGNMENT_NOT_FOUND" })

    await expect(issueProspectiveArtifactAdoptionSeal({ userId: "owner-1", adoptionHash: authorization.adoptionHash }, dependencies({
      loadAuthorization: vi.fn().mockResolvedValue({ eventId: 101, authorization }),
      loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: digest("9") } }),
    }))).rejects.toMatchObject({ code: "DELIVERY_SEAL_EVIDENCE_INVALID" })
  })

  it("fails closed when head, paths, validation, review, or current Space authority drift", async () => {
    const authorization = await authorizeFixture(dependencies())
    const baseDeps = {
      loadAuthorization: vi.fn().mockResolvedValue({ eventId: 101, authorization }),
      loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: authorization.adoptionHash } }),
    }
    for (const override of [
      { inspectArtifactIdentity: vi.fn().mockResolvedValue({ ...identity, headSha: "3".repeat(40) }) },
      { inspectArtifactIdentity: vi.fn().mockResolvedValue({ ...identity, paths: [...paths, "escape.ts"] }) },
      { loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: authorization.adoptionHash, state: "CLOSED" } }) },
      { loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: authorization.adoptionHash, checksGreen: false } }) },
      { loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: authorization.adoptionHash, reviewed: false } }) },
      { loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: authorization.adoptionHash, isDraft: true } }) },
      { loadEvidence: vi.fn().mockResolvedValue({ validationEventId: 102, reviewEventId: 103, evidence: { ...evidence, adoptionHash: authorization.adoptionHash, reviewDecision: "CHANGES_REQUESTED" } }) },
      { loadContext: vi.fn().mockResolvedValue({ ...context, spaceRevision: 10 }) },
    ]) {
      await expect(issueProspectiveArtifactAdoptionSeal({ userId: "owner-1", adoptionHash: authorization.adoptionHash }, dependencies({ ...baseDeps, ...override })))
        .rejects.toMatchObject({ code: expect.stringMatching(/^DELIVERY_SEAL_/) })
    }
  })
})
