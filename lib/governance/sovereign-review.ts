import crypto from "node:crypto"
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto"

/**
 * Sovereign independent-review attestation.
 *
 * Architectural contract (owner-specified):
 *  - A SEPARATE Ed25519 sovereign-reviewer key signs review attestations. The WilliamOS
 *    delivery-seal private key is NEVER reused and NEVER exposed here.
 *  - Cryptographic domain separation between REVIEW ATTESTATION and DELIVERY AUTHORIZATION: a
 *    review key can never validate a delivery seal, and a delivery key can never validate a review
 *    attestation. Separate artifactType + key purpose + trust ring, enforced at verify time.
 *  - The model (Kimi/Qwen/Hermes Agent/whatever) is NOT the signing authority. It produces the
 *    review. A trusted WilliamOS/HERMES attestation component validates execution provenance and
 *    signs the artifact. The model never receives either private key.
 *  - GitHub usernames are NOT the trust root. A signed artifact is the root; GitHub may receive a
 *    reference comment, nothing more.
 *  - The verifier explicitly proves reviewer context !== builder context.
 */

export const SOVEREIGN_REVIEW_ARTIFACT_TYPE = "WILLIAMOS_SOVEREIGN_REVIEW"
export const SOVEREIGN_REVIEW_SCHEMA_VERSION = 1
// Domain-separation tag baked into the signed bytes so a review signature can never be replayed as
// a delivery-seal signature (and vice versa) even if the same curve is used.
const REVIEW_DOMAIN = "williamos:domain:independent-review-attestation:v1"

export type SovereignReviewVerdict = "CLEAN" | "BLOCKING_FINDINGS"

export type SovereignReviewPayload = Readonly<{
  artifactType: string
  schemaVersion: number
  reviewerRole: string
  reviewerContextId: string
  builderContextId: string
  repository: string
  pullRequest: number
  reviewedHeadSha: string
  verdict: SovereignReviewVerdict
  findingsDigest: string
  requirementsDigest: string
  testEvidenceDigest: string
  issuedAt: string
  keyId: string
}>

export type SovereignReviewAttestation = Readonly<{
  payload: SovereignReviewPayload
  signature: string
}>

export type SovereignReviewerKeypair = Readonly<{
  keyId: string
  publicKeyBase64: string
  privateKeyBase64: string
}>

export type SovereignReviewerSigningKey = Readonly<{
  privateKey: KeyObject
  keyId: string
}>

export type SovereignReviewInput = Readonly<{
  reviewerRole: string
  reviewerContextId: string
  builderContextId: string
  repository: string
  pullRequest: number
  reviewedHeadSha: string
  verdict: SovereignReviewVerdict
  findingsDigest: string
  requirementsDigest: string
  testEvidenceDigest: string
  issuedAt?: string
}>

export type SovereignReviewVerifyResult =
  | Readonly<{ valid: true; reason: null; payload: SovereignReviewPayload }>
  | Readonly<{ valid: false; reason: string; payload?: never }>

function canonicalBytes(value: unknown): Buffer {
  // Deterministic canonical form: sorted keys, no whitespace.
  const canon = (v: unknown): string => {
    if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`
    if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",")}}`
    return JSON.stringify(v)
  }
  return Buffer.from(REVIEW_DOMAIN + "\n" + canon(value), "utf8")
}

/** Generate a fresh sovereign-reviewer Ed25519 keypair (attestation-service side only). */
export function generateSovereignReviewerKeypair(): SovereignReviewerKeypair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const publicDer = publicKey.export({ format: "der", type: "spki" })
  const privateDer = privateKey.export({ format: "der", type: "pkcs8" })
  return {
    keyId: "sovereign-reviewer-" + crypto.createHash("sha256").update(publicDer).digest("hex").slice(0, 24),
    publicKeyBase64: Buffer.from(publicDer).toString("base64"),
    privateKeyBase64: Buffer.from(privateDer).toString("base64"),
  }
}

export function sovereignReviewerSigningKeyFromBase64(value: string | undefined): SovereignReviewerSigningKey | null {
  if (!value?.trim()) return null
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(value.trim(), "base64"), format: "der", type: "pkcs8" })
    if (privateKey.asymmetricKeyType !== "ed25519") return null
    const publicKey = createPublicKey(privateKey)
    const publicDer = publicKey.export({ format: "der", type: "spki" })
    return { privateKey, keyId: "sovereign-reviewer-" + crypto.createHash("sha256").update(publicDer).digest("hex").slice(0, 24) }
  } catch { return null }
}

/**
 * Sign a sovereign review attestation. Called ONLY by the trusted attestation service, after it has
 * validated the review's execution provenance. The reviewer MODEL never calls this — it hands its
 * findings to the service, which verifies context separation and signs.
 */
export function signSovereignReview(review: SovereignReviewInput, signingKey: SovereignReviewerSigningKey | null): SovereignReviewAttestation {
  if (!signingKey?.privateKey) throw new Error("SOVEREIGN_REVIEW_KEY_REQUIRED")
  // Context separation is proven BEFORE signing — the attestation service refuses to attest a
  // review where the reviewer and builder are the same context.
  if (!review.reviewerContextId || !review.builderContextId) throw new Error("SOVEREIGN_REVIEW_CONTEXT_REQUIRED")
  if (review.reviewerContextId === review.builderContextId) throw new Error("SOVEREIGN_REVIEW_CONTEXT_NOT_SEPARATED")
  if (review.reviewerRole !== "INDEPENDENT_CODE_REVIEWER") throw new Error("SOVEREIGN_REVIEW_ROLE_INVALID")
  if (!["CLEAN", "BLOCKING_FINDINGS"].includes(review.verdict)) throw new Error("SOVEREIGN_REVIEW_VERDICT_INVALID")
  if (!/^[0-9a-f]{40}$/i.test(review.reviewedHeadSha)) throw new Error("SOVEREIGN_REVIEW_HEAD_INVALID")

  const payload: SovereignReviewPayload = {
    artifactType: SOVEREIGN_REVIEW_ARTIFACT_TYPE,
    schemaVersion: SOVEREIGN_REVIEW_SCHEMA_VERSION,
    reviewerRole: review.reviewerRole,
    reviewerContextId: review.reviewerContextId,
    builderContextId: review.builderContextId,
    repository: review.repository,
    pullRequest: review.pullRequest,
    reviewedHeadSha: review.reviewedHeadSha.toLowerCase(),
    verdict: review.verdict,
    findingsDigest: review.findingsDigest,
    requirementsDigest: review.requirementsDigest,
    testEvidenceDigest: review.testEvidenceDigest,
    issuedAt: review.issuedAt ?? new Date().toISOString(),
    keyId: signingKey.keyId,
  }
  return { payload, signature: sign(null, canonicalBytes(payload), signingKey.privateKey).toString("base64url") }
}

/**
 * Verify a sovereign review attestation. Hard domain separation:
 *  - the artifact must be WILLIAMOS_SOVEREIGN_REVIEW at the current schema version;
 *  - the key must be in the SOVEREIGN-REVIEWER trust ring (a SEPARATE namespace from the
 *    delivery-seal ring), looked up by the artifact's keyId;
 *  - the signature must verify over the domain-separated canonical bytes;
 *  - reviewer context must differ from builder context.
 *
 * A delivery-seal artifact or a delivery-seal key can never satisfy this — the artifactType and the
 * trust ring are disjoint.
 */
export function verifySovereignReview(
  attestation: SovereignReviewAttestation | null | undefined,
  sovereignReviewerPublicKeys: Readonly<Record<string, KeyObject | string>> | null | undefined,
): SovereignReviewVerifyResult {
  const payload = attestation?.payload
  if (!payload || payload.artifactType !== SOVEREIGN_REVIEW_ARTIFACT_TYPE) return { valid: false, reason: "artifact-type" }
  if (payload.schemaVersion !== SOVEREIGN_REVIEW_SCHEMA_VERSION) return { valid: false, reason: "schema-version" }
  if (payload.reviewerContextId === payload.builderContextId) return { valid: false, reason: "context-not-separated" }
  const configured = sovereignReviewerPublicKeys?.[payload.keyId]
  if (!configured) return { valid: false, reason: "key-not-in-reviewer-ring" }
  try {
    const key = typeof configured === "string" ? createPublicKey({ key: Buffer.from(configured, "base64"), format: "der", type: "spki" }) : configured
    const ok = key.asymmetricKeyType === "ed25519" && verify(null, canonicalBytes(payload), key, Buffer.from(attestation!.signature, "base64url"))
    return ok ? { valid: true, reason: null, payload } : { valid: false, reason: "signature" }
  } catch { return { valid: false, reason: "signature" } }
}

/** A delivery-seal artifact can NEVER be verified as a sovereign review (domain separation proof). */
export function assertDomainSeparation(attestation: SovereignReviewAttestation | null | undefined): boolean {
  return attestation?.payload?.artifactType === SOVEREIGN_REVIEW_ARTIFACT_TYPE
}
