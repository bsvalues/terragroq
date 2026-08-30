import { getTableConfig } from "drizzle-orm/pg-core"
import { describe, expect, it } from "vitest"

import { doctrine } from "@/lib/db/schema"
import {
  assertGenericDoctrineMutationAllowed,
  assertHistoricalDoctrineReplay,
  buildHistoricalDoctrineArchiveUpdate,
  buildHistoricalDoctrineInsert,
  getHistoricalDoctrineCatalog,
} from "@/lib/history/historical-doctrine"

describe("historical Doctrine schema", () => {
  it("persists provenance-bound historical inputs behind tenant uniqueness and fail-closed checks", () => {
    const config = getTableConfig(doctrine)

    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      "historicalCandidateId",
      "historicalClaimId",
      "historicalProvenance",
    ]))
    expect(config.indexes.some((entry) => (
      entry.config.name === "doctrine_historical_candidate_user_idx"
      && entry.config.unique
    ))).toBe(true)
    expect(config.checks.map((entry) => entry.name)).toEqual(expect.arrayContaining([
      "doctrine_historical_identity_check",
      "doctrine_historical_safety_check",
    ]))
  })
})

describe("historical Doctrine catalog and lifecycle", () => {
  const identities = [
    {
      candidateId: "HKR-32a0add1327ffadd",
      claimId: "HKR004-C001",
      rawSha256: "6bbc9a2050221db1e54d41d38566bd45fc7a0a003ba7187b364b480fb4c2c064",
      blobId: "8e700caeeb06b826d5de852dd2f935ecaa90da66",
      statement: "Evidence chains must distinguish direct proof from inference, assumption, and unresolved uncertainty.",
    },
    {
      candidateId: "HKR-ada454f7cb889228",
      claimId: "HKR004-C002",
      rawSha256: "3aa279c9d57695c03fea2bdcdc8c3a89c831c0115e4fde8a3f0baad0186e7c5f",
      blobId: "3ec6e91f3c55d08fd01c959c4576eecddb440cf0",
      statement: "Complete and review the bounded authorized objective before expanding into adjacent work.",
    },
    {
      candidateId: "HKR-d200030578f50efe",
      claimId: "HKR004-C003",
      rawSha256: "993febf0f8641f0835775cc4bac4e3d5f5a43c069f22da1d3a94432b1e292abd",
      blobId: "b7557aaade3e08f32948f8e7734798ebbabce678",
      statement: "Public-facing work must be explainable, defensible, and worthy of trust.",
    },
  ] as const

  it("returns the three exact adapted candidates in deterministic claim order", () => {
    const catalog = getHistoricalDoctrineCatalog()

    expect(catalog.map((candidate) => ({
      candidateId: candidate.candidateId,
      claimId: candidate.claimId,
      rawSha256: candidate.provenance.rawSha256,
      blobId: candidate.provenance.blobId,
      statement: candidate.statement,
    }))).toEqual(identities)
    expect(catalog.map((candidate) => candidate.provenance)).toEqual(
      identities.map((identity) => ({
        sourceCommit: "7664e589bddbe35ea4b9f8b72fad2cfbb9ffe7f7",
        sourceTree: "de4bdd48108d12c35ea3f53e3f8b7d032cf2b674",
        provenanceCommits: [
          "d45981428d30b1c35714ea12b886720deb766419",
          "a1a9cc2d7f37b4311aea698a86314c27f85e340e",
        ],
        rawSha256: identity.rawSha256,
        blobId: identity.blobId,
        disposition: "PROMOTE_AS_PROPOSED",
        authority: "historical_non_authoritative",
      })),
    )
  })

  it("builds historical rows that cannot enter active Doctrine enforcement", () => {
    for (const candidate of getHistoricalDoctrineCatalog()) {
      expect(buildHistoricalDoctrineInsert("tenant-a", candidate)).toMatchObject({
        userId: "tenant-a",
        historicalCandidateId: candidate.candidateId,
        historicalClaimId: candidate.claimId,
        status: "historical_input",
        active: false,
        priority: 0,
        allowed: [],
        forbidden: [],
        requiresApproval: [],
        locked: false,
        supersedesId: null,
        supersededById: null,
      })
    }
  })

  it("accepts an exact replay and refuses content or provenance collisions", () => {
    const candidate = getHistoricalDoctrineCatalog()[0]
    const exact = buildHistoricalDoctrineInsert("tenant-a", candidate)

    expect(assertHistoricalDoctrineReplay(exact, candidate)).toBe(exact)
    expect(() => assertHistoricalDoctrineReplay(
      { ...exact, statement: "Conflicting adapted statement" },
      candidate,
    )).toThrow(`HISTORICAL_DOCTRINE_COLLISION:${candidate.candidateId}`)
    expect(() => assertHistoricalDoctrineReplay(
      {
        ...exact,
        historicalProvenance: { ...candidate.provenance, sourceTree: "conflicting-tree" },
      },
      candidate,
    )).toThrow(`HISTORICAL_DOCTRINE_COLLISION:${candidate.candidateId}`)
  })

  it("archives without activation and treats a repeated archive as a no-op", () => {
    const candidate = getHistoricalDoctrineCatalog()[1]
    const row = buildHistoricalDoctrineInsert("tenant-a", candidate)

    expect(buildHistoricalDoctrineArchiveUpdate(row)).toEqual({
      status: "historical_archived",
      active: false,
    })
    expect(buildHistoricalDoctrineArchiveUpdate({
      ...row,
      status: "historical_archived",
    })).toBeNull()
  })

  it("rejects every generic mutation for historical rows", () => {
    const historical = buildHistoricalDoctrineInsert(
      "tenant-a",
      getHistoricalDoctrineCatalog()[2],
    )

    expect(() => assertGenericDoctrineMutationAllowed(historical)).toThrow(
      "HISTORICAL_DOCTRINE_GENERIC_MUTATION_FORBIDDEN",
    )
    expect(() => assertGenericDoctrineMutationAllowed({
      historicalCandidateId: null,
      status: "active",
    })).not.toThrow()
  })
})
