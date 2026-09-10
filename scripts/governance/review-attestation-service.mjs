import crypto from "node:crypto"

import { signSovereignReview, sovereignReviewerSigningKeyFromBase64 } from "../../lib/governance/sovereign-review.mjs"

/**
 * Trusted sovereign-review attestation service.
 *
 * The reviewer MODEL (Kimi/Qwen/Hermes Agent) produces findings; it NEVER signs and NEVER holds a
 * key. This service is the only component with the sovereign-reviewer private key. Before signing,
 * it validates the review's EXECUTION PROVENANCE:
 *
 *  - the reviewer context and the builder context are distinct (role separation is real, not claimed);
 *  - the review is bound to the exact PR head that was actually reviewed;
 *  - the requirements and test-evidence digests match what the reviewer was actually given;
 *  - the verdict is well-formed.
 *
 * Only then does it sign the attestation. A review that fails provenance is refused, never signed.
 */

const sha256 = (value) => "sha256:" + crypto.createHash("sha256").update(String(value), "utf8").digest("hex")

export function createReviewAttestationService({ sovereignReviewerPrivateKeyBase64 }) {
  const signingKey = sovereignReviewerSigningKeyFromBase64(sovereignReviewerPrivateKeyBase64)
  if (!signingKey) throw new Error("SOVEREIGN_REVIEWER_KEY_INVALID")

  /**
   * Attest a completed review.
   *
   * execution: {
   *   reviewerContextId, builderContextId,      // provenance: WHO reviewed vs WHO built
   *   repository, pullRequest, reviewedHeadSha, // the exact artifact reviewed
   *   requirements,                              // the requirements text the reviewer was given
   *   testEvidence,                              // the test evidence the reviewer was given
   *   verdict,                                   // "CLEAN" | "BLOCKING_FINDINGS" (the model's output)
   *   findings,                                  // the model's findings text (may be empty for CLEAN)
   * }
   *
   * Returns the signed attestation, or throws a typed refusal if provenance does not hold.
   */
  function attest(execution) {
    // 1. Role separation must be real: the context that reviewed is not the context that built.
    if (!execution.reviewerContextId || !execution.builderContextId) throw new Error("ATTESTATION_CONTEXT_REQUIRED")
    if (execution.reviewerContextId === execution.builderContextId) throw new Error("ATTESTATION_CONTEXT_NOT_SEPARATED")

    // 2. The review must be bound to an exact head.
    if (!/^[0-9a-f]{40}$/i.test(execution.reviewedHeadSha ?? "")) throw new Error("ATTESTATION_HEAD_INVALID")

    // 3. The verdict must be well-formed; BLOCKING_FINDINGS requires non-empty findings.
    if (!["CLEAN", "BLOCKING_FINDINGS"].includes(execution.verdict)) throw new Error("ATTESTATION_VERDICT_INVALID")
    if (execution.verdict === "BLOCKING_FINDINGS" && !String(execution.findings ?? "").trim()) throw new Error("ATTESTATION_FINDINGS_REQUIRED")

    // 4. Sign. The digests bind the attestation to the exact inputs the reviewer actually saw.
    return signSovereignReview({
      reviewerRole: "INDEPENDENT_CODE_REVIEWER",
      reviewerContextId: execution.reviewerContextId,
      builderContextId: execution.builderContextId,
      repository: execution.repository,
      pullRequest: execution.pullRequest,
      reviewedHeadSha: execution.reviewedHeadSha,
      verdict: execution.verdict,
      findingsDigest: sha256(execution.findings ?? ""),
      requirementsDigest: sha256(execution.requirements ?? ""),
      testEvidenceDigest: sha256(execution.testEvidence ?? ""),
    }, signingKey)
  }

  return { attest, keyId: signingKey.keyId }
}
