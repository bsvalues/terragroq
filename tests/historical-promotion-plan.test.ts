import { describe, expect, it } from "vitest"

import {
  W24_REJECTION,
  buildHistoricalPromotionPlan,
  validateHistoricalPromotionStatus,
} from "@/lib/history/historical-promotion"
import { getHistoricalDoctrineCatalog } from "@/lib/history/historical-doctrine"
import { getHistoricalProjectContextCatalog } from "@/lib/history/historical-project-context"

const APPROVED_IDS = [
  "HKR-32a0add1327ffadd",
  "HKR-ada454f7cb889228",
  "HKR-d200030578f50efe",
  "HKR-eabf2e0c67a8a0f4",
  "HKR-f2ae70ee3f7b4bda",
  "HKR-0cd458c5fd967816",
  "HKR-ae689745256df0d2",
  "HKR-c823a84feb4a7e52",
  "HKR-31831586c5a2811b",
]

describe("combined historical promotion plan", () => {
  it("derives the exact three Doctrine and six private Project-context records from reviewed catalogs", () => {
    const plan = buildHistoricalPromotionPlan()

    expect(plan.counts).toEqual({ doctrine: 3, projectContext: 6, total: 9 })
    expect(plan.records.map((record) => record.candidate.candidateId)).toEqual(APPROVED_IDS)
    expect(plan.records.map((record) => record.owner)).toEqual([
      "doctrine", "doctrine", "doctrine",
      "private_project_context", "private_project_context", "private_project_context",
      "private_project_context", "private_project_context", "private_project_context",
    ])
    expect(plan.records.some((record) => record.candidate === undefined)).toBe(false)
  })

  it("keeps the exact W24 rejection separate from both approved catalogs", () => {
    const plan = buildHistoricalPromotionPlan()

    expect(W24_REJECTION).toEqual({
      candidateId: "HKR-ae7e0a5220b153cf",
      claimId: "HKR004-C027",
      rawSha256: "29d58c61dd04eb4e5297e34f05bb9e2ae7d673f682aea712378386634e4769cb",
      blobId: "97c8d8ee09ee0b3455f23cfef7196d6284a882d5",
      verdict: "REJECT_NO_CANONICAL_OWNER",
      owner: "NONE",
      state: "FROZEN_EXTERNAL_HISTORICAL_EVIDENCE_NO_CURRENT_MUTATION",
    })
    expect(plan.records.map((record) => record.candidate.candidateId)).not.toContain(W24_REJECTION.candidateId)
    expect(plan.records.map((record) => record.candidate.claimId)).not.toContain(W24_REJECTION.claimId)
    expect(plan.records.map((record) => record.candidate.provenance.rawSha256)).not.toContain(W24_REJECTION.rawSha256)
  })

  it("rejects duplicate identities, duplicate claims, and any catalog count other than 3 plus 6", () => {
    const doctrine = getHistoricalDoctrineCatalog()
    const projectContext = getHistoricalProjectContextCatalog()

    expect(() => buildHistoricalPromotionPlan({
      doctrine: [...doctrine, doctrine[0]],
      projectContext,
    })).toThrow("HISTORICAL_PROMOTION_COUNT_INVALID:4+6")

    expect(() => buildHistoricalPromotionPlan({
      doctrine,
      projectContext: projectContext.map((candidate, index) => index === 0
        ? { ...candidate, candidateId: doctrine[0].candidateId }
        : candidate),
    })).toThrow(`HISTORICAL_PROMOTION_DUPLICATE_CANDIDATE:${doctrine[0].candidateId}`)

    expect(() => buildHistoricalPromotionPlan({
      doctrine,
      projectContext: projectContext.map((candidate, index) => index === 0
        ? { ...candidate, claimId: doctrine[0].claimId }
        : candidate),
    })).toThrow(`HISTORICAL_PROMOTION_DUPLICATE_CLAIM:${doctrine[0].claimId}`)
  })

  it("rejects substituted identities even when catalog counts and ownership still match", () => {
    const doctrine = getHistoricalDoctrineCatalog()
    const projectContext = getHistoricalProjectContextCatalog()

    expect(() => buildHistoricalPromotionPlan({
      doctrine: doctrine.map((candidate, index) => index === 0
        ? { ...candidate, candidateId: "HKR-substituted-doctrine" }
        : candidate),
      projectContext,
    })).toThrow("HISTORICAL_PROMOTION_IDENTITY_SET_INVALID:doctrine")
    expect(() => buildHistoricalPromotionPlan({
      doctrine,
      projectContext: projectContext.map((candidate, index) => index === 5
        ? { ...candidate, candidateId: "HKR-substituted-project-context" }
        : candidate),
    })).toThrow("HISTORICAL_PROMOTION_IDENTITY_SET_INVALID:private_project_context")
  })

  it("rejects the W24 blob even when its candidate, claim, and digest are disguised", () => {
    const doctrine = getHistoricalDoctrineCatalog()
    const projectContext = getHistoricalProjectContextCatalog()

    expect(() => buildHistoricalPromotionPlan({
      doctrine: doctrine.map((candidate, index) => index === 0
        ? { ...candidate, provenance: { ...candidate.provenance, blobId: W24_REJECTION.blobId } }
        : candidate),
      projectContext,
    })).toThrow("HISTORICAL_PROMOTION_W24_CATALOG_FORBIDDEN")
  })

  it("validates exactly nine least-authority active states with W24 absent", () => {
    const plan = buildHistoricalPromotionPlan()
    const rows = plan.records.map((record) => ({
      candidateId: record.candidate.candidateId,
      claimId: record.candidate.claimId,
      owner: record.owner,
      status: record.owner === "doctrine" ? "historical_input" : "private_project_context",
    }))

    expect(validateHistoricalPromotionStatus({ rows, w24CanonicalHits: 0, w24EventHits: 0 }))
      .toEqual({ doctrine: 3, projectContext: 6, total: 9, w24Absent: true })
    expect(() => validateHistoricalPromotionStatus({ rows: rows.slice(1), w24CanonicalHits: 0, w24EventHits: 0 }))
      .toThrow(`HISTORICAL_PROMOTION_STATUS_MISSING:${APPROVED_IDS[0]}`)
    expect(() => validateHistoricalPromotionStatus({ rows, w24CanonicalHits: 1, w24EventHits: 0 }))
      .toThrow("HISTORICAL_PROMOTION_W24_PRESENT:1:0")
  })
})
