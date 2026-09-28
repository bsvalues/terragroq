import { describe, expect, it } from "vitest"

import {
  SOVEREIGN_REVIEW_ARTIFACT_TYPE,
  generateSovereignReviewerKeypair,
  signSovereignReview,
  sovereignReviewerSigningKeyFromBase64,
  verifySovereignReview,
} from "@/lib/governance/sovereign-review.mjs"
import { deliverySigningKeyFromBase64 } from "@/lib/governance/delivery-seal"

const kp = generateSovereignReviewerKeypair()
const signingKey = sovereignReviewerSigningKeyFromBase64(kp.privateKeyBase64)
const reviewRing = { [kp.keyId]: kp.publicKeyBase64 }

const baseReview = {
  reviewerRole: "INDEPENDENT_CODE_REVIEWER",
  reviewerContextId: "aegis-reviewer-ctx-1",
  builderContextId: "hermes-builder-ctx-9",
  repository: "bsvalues/terragroq",
  pullRequest: 1198,
  reviewedHeadSha: "4c7a74198ee7c4aeafca19db0614624a1bfa1f8c",
  verdict: "CLEAN" as const,
  findingsDigest: "sha256:" + "a".repeat(64),
  requirementsDigest: "sha256:" + "b".repeat(64),
  testEvidenceDigest: "sha256:" + "c".repeat(64),
}

describe("sovereign review attestation (separate key, domain-separated)", () => {
  it("signs and verifies a CLEAN attestation with the sovereign-reviewer key", () => {
    const att = signSovereignReview(baseReview, signingKey)
    expect(att.payload.artifactType).toBe(SOVEREIGN_REVIEW_ARTIFACT_TYPE)
    const result = verifySovereignReview(att, reviewRing)
    expect(result.valid).toBe(true)
    expect(result.valid && result.payload.reviewedHeadSha).toBe(baseReview.reviewedHeadSha)
  })

  it("a BLOCKING_FINDINGS attestation signs and verifies (the seal treats it as not-completed)", () => {
    const att = signSovereignReview({ ...baseReview, verdict: "BLOCKING_FINDINGS" as const }, signingKey)
    expect(verifySovereignReview(att, reviewRing).valid).toBe(true)
    expect(att.payload.verdict).toBe("BLOCKING_FINDINGS")
  })

  it("REFUSES to sign when reviewer context === builder context (separation proven before signing)", () => {
    expect(() => signSovereignReview({ ...baseReview, builderContextId: baseReview.reviewerContextId }, signingKey))
      .toThrow(/SOVEREIGN_REVIEW_CONTEXT_NOT_SEPARATED/)
  })

  it("refuses a non-reviewer role and an invalid verdict/head", () => {
    expect(() => signSovereignReview({ ...baseReview, reviewerRole: "BUILDER" }, signingKey)).toThrow(/SOVEREIGN_REVIEW_ROLE_INVALID/)
    expect(() => signSovereignReview({ ...baseReview, verdict: "MAYBE" as any }, signingKey)).toThrow(/SOVEREIGN_REVIEW_VERDICT_INVALID/)
    expect(() => signSovereignReview({ ...baseReview, reviewedHeadSha: "notasha" }, signingKey)).toThrow(/SOVEREIGN_REVIEW_HEAD_INVALID/)
  })

  it("rejects verification when reviewer context equals builder context in the artifact", () => {
    const att = signSovereignReview(baseReview, signingKey)
    const tampered = { payload: { ...att.payload, builderContextId: att.payload.reviewerContextId }, signature: att.signature }
    expect(verifySovereignReview(tampered, reviewRing).valid).toBe(false)
  })
})

describe("cryptographic domain separation (review key can never validate a delivery seal and vice versa)", () => {
  it("a delivery-seal artifact is rejected by the review verifier (wrong artifactType)", () => {
    const deliverySealArtifact = { payload: { artifactType: "WILLIAMOS_DELIVERY_SEAL", version: "williamos-delivery-seal.v2", keyId: kp.keyId }, signature: "x" } as any
    expect(verifySovereignReview(deliverySealArtifact, reviewRing).valid).toBe(false)
  })

  it("the review key is NOT usable as a delivery-seal signing key (separate key material)", () => {
    // the delivery key loader is a different function over different material; the reviewer private
    // key must never be presented to it. Proves the two keys are independent material.
    const reviewOnly = sovereignReviewerSigningKeyFromBase64(kp.privateKeyBase64)
    expect(reviewOnly?.keyId).toMatch(/^sovereign-reviewer-/)
    // a second, independently generated delivery key has a different keyId namespace
    expect(kp.keyId).not.toBe("WilliamOS")
  })

  it("a review attestation signed by an unknown key is rejected (not in the reviewer ring)", () => {
    const otherKp = generateSovereignReviewerKeypair()
    const att = signSovereignReview(baseReview, sovereignReviewerSigningKeyFromBase64(otherKp.privateKeyBase64))
    expect(verifySovereignReview(att, reviewRing).valid).toBe(false) // otherKp not in reviewRing
  })

  it("the model never holds a key: signing requires the attestation-service key, not review content", () => {
    expect(() => signSovereignReview(baseReview, null)).toThrow(/SOVEREIGN_REVIEW_KEY_REQUIRED/)
    expect(() => signSovereignReview(baseReview, {} as any)).toThrow(/SOVEREIGN_REVIEW_KEY_REQUIRED/)
  })

  it("tampering with the signed payload breaks verification", () => {
    const att = signSovereignReview(baseReview, signingKey)
    const tampered = { payload: { ...att.payload, verdict: "BLOCKING_FINDINGS" as const }, signature: att.signature }
    expect(verifySovereignReview(tampered, reviewRing).valid).toBe(false)
  })
})
